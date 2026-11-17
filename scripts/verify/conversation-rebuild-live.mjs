#!/usr/bin/env node
/**
 * 对话区原生重构 · 真实网关 + 真实 Blink 端到端验证 (conversation-rebuild-live)
 *
 * 【设计意图 (Why)】
 *   `docs/changes/2026-11-16_conversation-native-flow-rebuild/handoff.md` 第七节把「真实渲染验收」
 *   列为未完成项：切会话白屏/位置漂移、滚动非线性、流式中断、导航器落地偏移、回合末悬浮气泡被裁
 *   这五类缺陷全部只能在真实 Blink 排版 + 真实网关下行流里暴露，Node 单测与状态注入都无法证伪。
 *   本脚本因此不复用任何 window.__fluxState 注入（该注入点在当前构建中并不存在），
 *   全部断言只读真实 DOM 几何、真实滚动位置与真实网关推流后的文本增长。
 *
 * 【约束与规则 (Rules)】
 *   1. 凭据只从环境变量读取，绝不打印、绝不写入 artifacts/evidence.json；
 *   2. 全部交互走真实指针/键盘/滚轮事件，禁止调用 UI 内部私有 setter 伪造状态；
 *   3. 证据（截图 + 逐用例 PASS/FAIL/SKIP 明细）必须落盘 artifacts/verification/conversation-rebuild-live/；
 *   4. 缺网关或无长会话时一律显式 SKIP 并写明原因，禁止静默判过（Failure Is Not Empty）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const FEATURE_ID = 'conversation-rebuild-live';
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts/verification', FEATURE_ID);

const GATEWAY_URL_RAW = (process.env.FLUX_GATEWAY_URL || process.env.HERMES_GATEWAY_URL || '').trim();
const GATEWAY_URL = normalizeGatewayUrl(GATEWAY_URL_RAW);
const GATEWAY_USER = (process.env.FLUX_GATEWAY_USER || process.env.HERMES_GATEWAY_USER || '').trim();
const GATEWAY_PASS = process.env.FLUX_GATEWAY_PASS || process.env.HERMES_GATEWAY_PASSWORD || '';

const BROWSER_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

/**
 * 网关地址规范化。
 * 【规则】与 scripts/start-browser-live.mjs 的 normalizeGatewayUrl 保持一致：
 *   用户可能只给 host:port，必须补 http/https；ws/wss 一律映射到 http/https，
 *   否则 /__gw/auth 会拿 ws:// 去 fetch 而报不可诊断的协议错误。
 */
function normalizeGatewayUrl(rawUrl) {
  let base = (rawUrl || '').trim();
  if (!base) return '';
  if (base.startsWith('ws://')) base = base.replace('ws://', 'http://');
  if (base.startsWith('wss://')) base = base.replace('wss://', 'https://');
  if (!base.startsWith('http://') && !base.startsWith('https://')) {
    const isLoopback = /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(base);
    base = isLoopback ? `http://${base}` : `https://${base}`;
  }
  return base.replace(/\/+$/, '');
}

const results = [];
const screenshots = [];

function log(message) {
  console.log(message);
}

function record(id, title, status, detail, metrics) {
  results.push({ id, title, status, detail, metrics: metrics ?? null });
  const icon = status === 'PASS' ? '✔' : status === 'SKIP' ? '○' : '✖';
  log(`  ${icon} [${id}] ${title} — ${status}${detail ? `：${detail}` : ''}`);
}

async function caseRun(id, title, fn) {
  log(`  ▶ [${id}] ${title}`);
  try {
    const out = await fn();
    if (out && out.skip) record(id, title, 'SKIP', out.skip, out.metrics);
    else record(id, title, 'PASS', out?.detail ?? '', out?.metrics);
  } catch (error) {
    record(id, title, 'FAIL', error instanceof Error ? error.message : String(error), error?.metrics ?? null);
  }
}

/* ────────────────────────── 静态伺服：浏览器直跑 + 网关代理 ────────────────────────── */

function probePort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, '127.0.0.1');
  });
}

async function pickPort(start = 9131) {
  for (let port = start; port < start + 20; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await probePort(port))) return port;
  }
  throw new Error('找不到可用端口（9131~9150 全部占用）');
}

async function waitHttp(url, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* 尚未就绪 */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`等待 ${label} 超时（${timeoutMs}ms）：${url}`);
}

/**
 * 启动浏览器直跑服务。
 * 【规则】服务端必须持有 FLUX_GATEWAY_URL，前端连接面板再补账号口令；
 *   站点 root 必须与本仓一致，否则等于验证了别的 worktree 的产物。
 */
async function startLiveServer() {
  const port = await pickPort();
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/start-browser-live.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), FLUX_NO_OPEN_BROWSER: '1', FLUX_GATEWAY_URL: GATEWAY_URL },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += String(d); });
  child.stderr.on('data', (d) => { stderr += String(d); });
  child.on('exit', (code) => {
    if (code && code !== 0) log(`  [live-server] 退出码 ${code}：${stderr.split('\n').slice(-3).join(' | ')}`);
  });
  await waitHttp(`http://127.0.0.1:${port}/__live/identity`, 20000, '浏览器直跑服务');
  const identity = await (await fetch(`http://127.0.0.1:${port}/__live/identity`)).json();
  if (path.resolve(identity.root) !== ROOT) {
    child.kill();
    throw new Error(`端口 ${port} 服务的不是本仓产物：${identity.root}`);
  }
  return { port, child, baseUrl: `http://127.0.0.1:${port}` };
}

/* ────────────────────────── CDP 驱动 ────────────────────────── */

function findBrowser() {
  return BROWSER_PATHS.find((p) => fs.existsSync(p)) || null;
}

async function launchBrowser(baseUrl) {
  const browserPath = findBrowser();
  if (!browserPath) throw new Error('未找到 Edge/Chrome，无法执行真实 Blink 验证');
  const userDataDir = path.join(os.tmpdir(), `flux-live-verify-${Date.now()}`);

  const portProbe = http.createServer();
  await new Promise((r) => portProbe.listen(0, '127.0.0.1', r));
  const cdpPort = portProbe.address().port;
  await new Promise((r) => portProbe.close(r));

  const proc = spawn(browserPath, [
    `--remote-debugging-port=${cdpPort}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,900',
    baseUrl,
  ], { stdio: 'ignore' });

  let wsUrl = null;
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json`);
      if (res.ok) {
        const targets = await res.json();
        const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
      }
    } catch { /* 等待内核 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!wsUrl) {
    proc.kill();
    throw new Error('CDP 页面目标 20s 内未就绪');
  }

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  let msgId = 0;
  const pending = new Map();
  ws.addEventListener('message', (evt) => {
    try {
      const data = JSON.parse(evt.data);
      if (data.id && pending.has(data.id)) {
        const { resolve, reject } = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) reject(new Error(data.error.message || JSON.stringify(data.error)));
        else resolve(data.result);
      }
    } catch { /* 忽略非 JSON */ }
  });

  const send = (method, params = {}, timeoutMs = 15000) => new Promise((resolve, reject) => {
    const id = ++msgId;
    // 【为何必须有超时】CDP 在页面重排崩溃或渲染进程无响应时不会回包，
    // 裸 Promise 会让整个验证永久挂起（实测曾把 600s 的探针跑成僵尸进程）。
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP ${method} 超时 ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');

  const session = {
    send,
    async evaluate(expression) {
      const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'evaluate 异常');
      }
      return res.result?.value;
    },
    async waitFor(expression, timeoutMs, label) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        try {
          const v = await session.evaluate(expression);
          if (v) return v;
        } catch { /* 页面尚在挂载 */ }
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error(`等待「${label}」超时 ${timeoutMs}ms`);
    },
    async screenshot(name) {
      const res = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(ARTIFACTS_DIR, name);
      fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
      fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
      screenshots.push(file);
      return file;
    },
    async cleanup() {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          await send('Browser.close').catch(() => {});
          ws.close();
        }
      } catch { /* 忽略 */ }
      try { proc.kill(); } catch { /* 忽略 */ }
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
    },
  };
  return session;
}

/* ────────────────────────── 页面断言辅助 ────────────────────────── */

const STREAM = 'document.getElementById("conversation-stream")';

const helpers = {
  fill(selector, value) {
    return `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, ${JSON.stringify(value)}); else el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`;
  },
  click(selector) {
    return `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`;
  },
};

/**
 * 消息行选择器。
 * 【规则】`.msg-action-btn` 同样带 `data-msg-id`（MessageFooter.tsx:90-92），
 * 裸用 `[data-msg-id]` 会把 24px 操作按钮当成消息行：行计数虚高、
 * 锚点可能选中按钮、行高采样被按钮淹没（实测把中位数压死在 32px 下限）。
 */
const ROW_SELECTOR = '[data-msg-id]:not(.msg-action-btn)';

/** 记录当前会话真实消息几何，供多处断言复用。 */
const snapshotExpr = `(() => {
  const stream = ${STREAM};
  if (!stream) return { ok: false };
  const rows = [...stream.querySelectorAll('${ROW_SELECTOR}')];
  const turns = [...stream.querySelectorAll('.conv-turn')];
  const max = stream.scrollHeight - stream.clientHeight;
  return {
    ok: true,
    scrollTop: +stream.scrollTop.toFixed(2),
    scrollHeight: stream.scrollHeight,
    clientHeight: stream.clientHeight,
    maxScrollTop: +max.toFixed(2),
    distanceToBottom: +(max - stream.scrollTop).toFixed(2),
    rowCount: rows.length,
    turnCount: turns.length,
    lastRowTextLength: rows.length ? (rows[rows.length - 1].innerText || '').length : 0,
    streamTextLength: (stream.innerText || '').length,
    containerSame: window.__fluxStreamRef ? document.getElementById('conversation-stream') === window.__fluxStreamRef : null,
  };
})()`;

/**
 * 滚动写入探针。
 * 【设计意图 (Why)】`350px` 到底由 `renderCoordinator` 的 rAF 裸写产生，还是由
 *   `applyStreamAnchor` 末尾的 `rawScrollTop` 回写产生，光看结果无法区分。
 *   本探针包装 `Element.prototype.scrollTop` 的 setter，只记录 `#conversation-stream`
 *   上的写入（写入值、前后值、当时高度、调用栈前 4 帧），为根因判定提供直接证据。
 * 【约束与规则 (Rules)】
 *   1. 只读记录，绝不改变写入语义（先取 before，再原样 set，再取 after）；
 *   2. 环形缓冲上限 500 条，避免长跑撑爆页面内存与 evidence 体积；
 *   3. 探针自身不得抛错：任何异常都吞掉，不得影响被测行为。
 */
const INSTALL_SCROLL_PROBE = `(() => {
  if (window.__fluxScrollProbe) return { installed: false, reason: 'already' };
  const trace = { writes: [], startedAt: Date.now(), truncated: 0 };
  window.__fluxScrollProbe = trace;
  const proto = Element.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'scrollTop');
  if (!desc || !desc.set || !desc.get) return { installed: false, reason: 'no-descriptor' };
  Object.defineProperty(proto, 'scrollTop', {
    get: desc.get,
    set(value) {
      try {
        if (this && this.id === 'conversation-stream') {
          const before = desc.get.call(this);
          let stack = '';
          try {
            stack = String((new Error()).stack || '').split('\\n').slice(1, 6).join(' <- ');
          } catch {}
          desc.set.call(this, value);
          const after = desc.get.call(this);
          if (trace.writes.length >= 500) { trace.writes.shift(); trace.truncated += 1; }
          trace.writes.push({
            t: Date.now() - trace.startedAt,
            want: typeof value === 'number' ? +value.toFixed(1) : value,
            before: +before.toFixed(1),
            after: +after.toFixed(1),
            scrollHeight: this.scrollHeight,
            clientHeight: this.clientHeight,
            stack: stack.slice(0, 320),
          });
          return;
        }
        desc.set.call(this, value);
      } catch {
        desc.set.call(this, value);
      }
    },
    configurable: true,
    enumerable: desc.enumerable,
  });
  window.__fluxStreamRef = document.getElementById('conversation-stream');
  return { installed: true, hasRef: Boolean(window.__fluxStreamRef) };
})()`;

/** 帧级采样：0/16/50/100/200/300/1000/3000ms 八个时刻各读一次几何。 */
const FRAME_SERIES = `(async () => {
  const marks = [0, 16, 50, 100, 200, 300, 1000, 3000];
  const out = [];
  const t0 = performance.now();
  for (const mark of marks) {
    const wait = Math.max(0, mark - (performance.now() - t0));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const s = document.getElementById('conversation-stream');
    if (!s) { out.push({ at: mark, ok: false }); continue; }
    const max = s.scrollHeight - s.clientHeight;
    out.push({
      at: mark,
      ok: true,
      scrollTop: +s.scrollTop.toFixed(2),
      scrollHeight: s.scrollHeight,
      clientHeight: s.clientHeight,
      distanceToBottom: +(max - s.scrollTop).toFixed(2),
      rows: s.querySelectorAll('${ROW_SELECTOR}').length,
      containerSame: window.__fluxStreamRef ? s === window.__fluxStreamRef : null,
    });
  }
  return out;
})()`;

/** 读取并清空探针缓冲，返回窗口内的 scrollTop 写入序列。 */
const TAKE_SCROLL_TRACE = `(() => {
  const p = window.__fluxScrollProbe;
  if (!p) return { available: false, writes: [] };
  const writes = p.writes.slice();
  p.writes.length = 0;
  return { available: true, truncated: p.truncated, writes };
})()`;

/* ────────────────────────── 主流程 ────────────────────────── */

async function main() {
  if (!GATEWAY_URL) {
    console.error('✖ 未提供网关地址：需 FLUX_GATEWAY_URL（或 HERMES_GATEWAY_URL）。本脚本拒绝在无网关时假装通过。');
    process.exit(2);
  }
  log(`\n🚀 [对话区重构 · 真实网关验证] 目标网关：${GATEWAY_URL}`);

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  const server = await startLiveServer();
  log(`  · 浏览器直跑服务：${server.baseUrl}`);

  // 先用服务端认证通道做一次预检：把「地址不可达」与「凭据 401」在启动浏览器之前区分开，
  // 否则只能从页面文案反推，既慢又容易把地址错误误读成密码错误。
  const preflight = await (await fetch(`${server.baseUrl}/__gw/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: GATEWAY_URL, username: GATEWAY_USER, password: GATEWAY_PASS }),
  })).json();
  if (!preflight?.ok) {
    server.child.kill();
    console.error(`✖ 网关认证预检失败：${preflight?.message || '未知原因'}`);
    process.exit(2);
  }
  log(`  · 网关认证预检通过（${preflight.latency}ms，ticket ${preflight.ticket ? '已签发' : '免密'}）`);

  const session = await launchBrowser(server.baseUrl);

  try {
    await session.waitFor('document.getElementById("flux-app-root")?.childElementCount > 0', 30000, 'renderer 首帧');
    await session.screenshot('01-first-paint.png');

    /* —— 真网关连接 —— */
    let authError = '';
    const hasOnboarding = await session.evaluate('Boolean(document.getElementById("onboarding-gateway-url"))');
    if (hasOnboarding) {
      log('  1. 连接面板填写真实网关并保存连接…');
      await session.evaluate(helpers.fill('#onboarding-gateway-url', GATEWAY_URL));
      await session.evaluate(helpers.fill('#onboarding-username', GATEWAY_USER));
      await session.evaluate(helpers.fill('#onboarding-password', GATEWAY_PASS));
      await session.evaluate(helpers.click('#btn-save-and-connect'));
    } else {
      log('  1. 已有持久化连接配置，直接复用会话…');
    }

    try {
      await session.waitFor('document.querySelectorAll(".session-item").length > 0', 45000, '真实网关会话列表');
    } catch (error) {
      authError = await session.evaluate(`(() => {
        const body = document.body.innerText || '';
        const hints = ['认证失败', '连接失败', 'urlRequired', '无法连接', '超时', 'Unauthorized', '401', '鉴权'];
        const hit = hints.filter((h) => body.includes(h));
        return hit.join(',') || body.slice(0, 240);
      })()`);
      throw new Error(`真实网关未产出会话列表；页面提示：${authError}`);
    }

    const sessionCount = await session.evaluate('document.querySelectorAll(".session-item").length');
    record('A1', '接入真实网关并完成一次全量加载', 'PASS', `会话列表 ${sessionCount} 条`);
    await session.screenshot('02-gateway-connected.png');

    // 探针必须在任何会话切换之前安装：它要抓的正是「切换窗口内的 scrollTop 写入」。
    const probeInstall = await session.evaluate(INSTALL_SCROLL_PROBE);
    log(`  · 滚动写入探针：${probeInstall?.installed ? '已安装（Element.prototype.scrollTop 旁路记录）' : `未安装：${probeInstall?.reason}`}`);

    /* —— 选一个动静最大的会话（行数 + 可滚动高度双指标） —— */
    log('  2. 逐个抽样会话，定位消息最多、可滚动最深的会话…');
    const probeLimit = Math.min(sessionCount, 8);
    let best = { index: 0, rows: -1, id: '', max: 0 };
    for (let i = 0; i < probeLimit; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const id = await session.evaluate(`document.querySelectorAll('.session-item')[${i}]?.dataset?.id || ''`);
      await session.evaluate(`document.querySelectorAll('.session-item')[${i}]?.click()`);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 900));
      // eslint-disable-next-line no-await-in-loop
      const geom = await session.evaluate(`(() => {
        const s = ${STREAM};
        if (!s) return { rows: -1, max: 0 };
        return { rows: s.querySelectorAll('${ROW_SELECTOR}').length, max: s.scrollHeight - s.clientHeight };
      })()`);
      // 【为何用可滚动高度排序】行数多不等于可验证：短消息多行可能不足一屏，
      // 贴底/锚点恢复都不可区分；必须优先选真实可滚动深度最大的会话。
      if (Number(geom.rows) > best.rows || (Number(geom.rows) === best.rows && Number(geom.max) > best.max)) {
        best = { index: i, rows: Number(geom.rows), id: String(id), max: Number(geom.max) };
      }
    }
    const clickBest = `(() => {
      const el = document.querySelector('.session-item[data-id="${best.id}"]');
      if (!el) return false;
      el.click();
      return true;
    })()`;
    await session.evaluate(clickBest);
    await session.waitFor(`${STREAM} && ${STREAM}.querySelectorAll('${ROW_SELECTOR}').length > 0`, 25000, '目标会话消息渲染');
    log(`     · 目标会话：${best.id}（#${best.index}），真实消息行 ${best.rows}`);

    /* —— R1 切会话默认贴底（帧级序列 + 写入探针） —— */
    await caseRun('R1', '切换会话默认停在最新位置（贴底）', async () => {
      // 【先让目标会话落定再切走】否则离开时记录的是「上一次进入尚未收敛」的中途位置，
      // 切回自然恢复该中途位置——那是测量时序，不是「切会话不贴底」。
      await session.evaluate(clickBest);
      await new Promise((r) => setTimeout(r, 1500));
      const settled = await session.evaluate(snapshotExpr);
      // 【为何必须真的切换一次】R1 的语义是「切进去之后落在哪」，在已停留的会话里采样
      // 测不到切换窗口；先切到别的会话，再切回来，才覆盖 0~3000ms 的真实落定过程。
      const otherIndex = best.index === 0 ? 1 : 0;
      await session.evaluate(`document.querySelectorAll('.session-item')[${otherIndex}]?.click()`);
      await new Promise((r) => setTimeout(r, 800));
      await session.evaluate(TAKE_SCROLL_TRACE); // 丢弃非切换窗口的历史写入
      await session.evaluate(clickBest);

      const series = await session.evaluate(FRAME_SERIES);
      const trace = await session.evaluate(TAKE_SCROLL_TRACE);
      const metrics = { sessionId: best.id, rows: best.rows, settled, series, writes: trace.writes };

      const pinned = series.filter((s) => s.ok && Math.abs(s.distanceToBottom) <= 8);
      if (pinned.length === 0) {
        // 对照实验：手动钉到底后看是否被代码强行拉回，用以区分
        // 「从未触发落底」与「落底后被重置」两种完全不同的根因。
        await session.evaluate(`(() => { const s = ${STREAM}; s.scrollTop = s.scrollHeight; return true; })()`);
        await new Promise((r) => setTimeout(r, 1500));
        const manual = await session.evaluate(snapshotExpr);
        metrics.manualPin = { scrollTop: manual.scrollTop, max: manual.maxScrollTop, distanceToBottom: manual.distanceToBottom };
        const err = new Error(
          `3s 内从未贴底：${JSON.stringify(series.map((s) => `${s.at}ms top=${s.scrollTop}/${s.scrollHeight} dist=${s.distanceToBottom}`))}；`
          + `写入 ${trace.writes.length} 次；手动钉底后距底 ${manual.distanceToBottom}px（${Math.abs(manual.distanceToBottom) <= 8 ? '可保持，说明从未触发落底' : '被强行拉回'}）`,
        );
        err.metrics = metrics;
        throw err;
      }
      const last = series[series.length - 1];
      if (Math.abs(last.distanceToBottom) > 8) {
        const err = new Error(`曾贴底但随后被顶开：3000ms 时距底 ${last.distanceToBottom}px`);
        err.metrics = metrics;
        throw err;
      }
      const badIdentity = series.filter((s) => s.ok && s.containerSame === false);
      if (badIdentity.length > 0) {
        const err = new Error(`切换过程中 #conversation-stream 容器被替换 ${badIdentity.length} 次（${badIdentity.map((s) => `${s.at}ms`).join(',')}）`);
        err.metrics = metrics;
        throw err;
      }
      return {
        detail: `贴底帧 ${pinned.map((s) => `${s.at}ms`).join(',')}，末次距底 ${last.distanceToBottom}px，写入 ${trace.writes.length} 次，容器唯一`,
        metrics,
      };
    });

    /* —— R1b 从非贴底会话切入未访问会话 —— */
    await caseRun('R1b', '从非贴底会话切入未访问会话仍应贴底', async () => {
      const targetIndex = probeLimit;
      const targetId = await session.evaluate(`document.querySelectorAll('.session-item')[${targetIndex}]?.dataset?.id || ''`);
      if (!targetId) return { skip: `只有 ${sessionCount} 个会话，找不到第 ${targetIndex + 1} 个未抽样会话` };

      // 制造「离开时处于回溯态」：把当前 best 显式置顶且确认非贴底。
      await session.evaluate(clickBest);
      await new Promise((r) => setTimeout(r, 500));
      await session.evaluate(`(() => { const s = ${STREAM}; s.scrollTop = 0; return true; })()`);
      await new Promise((r) => setTimeout(r, 500));
      const pre = await session.evaluate(snapshotExpr);
      if (pre.maxScrollTop <= 48) return { skip: '前序会话不足一屏，无法制造非贴底状态', metrics: pre };
      if (pre.distanceToBottom <= 48) return { skip: '前序会话仍处于贴底安全区，无法制造回溯态', metrics: pre };

      await session.evaluate(TAKE_SCROLL_TRACE);
      await session.evaluate(`document.querySelectorAll('.session-item')[${targetIndex}]?.click()`);
      const series = await session.evaluate(FRAME_SERIES);
      const trace = await session.evaluate(TAKE_SCROLL_TRACE);
      const metrics = { targetId, pre, series, writes: trace.writes };

      const rows = series[series.length - 1]?.rows ?? 0;
      const deepest = Math.max(...series.map((s) => (s.ok ? s.scrollHeight - s.clientHeight : 0)), 0);
      if (rows <= 0) return { skip: `目标会话 ${targetId} 没有可渲染消息行，贴底语义不可判`, metrics };
      if (deepest <= 200) return { skip: `目标会话可滚动深度仅 ${deepest}px，贴底语义不可区分`, metrics };
      const pinned = series.filter((s) => s.ok && Math.abs(s.distanceToBottom) <= 8);
      if (pinned.length === 0) {
        const err = new Error(
          `从非贴底会话切入后 3s 内未贴底：${JSON.stringify(series.map((s) => `${s.at}ms top=${s.scrollTop}/${s.scrollHeight} dist=${s.distanceToBottom}`))}`,
        );
        err.metrics = metrics;
        throw err;
      }
      return { detail: `首帧 ${series[0]?.scrollTop}px，贴底帧 ${pinned.map((s) => `${s.at}ms`).join(',')}`, metrics };
    });

    /* —— R2 回溯后跨会话恢复原位 —— */
    await caseRun('R2', '回溯后切走再切回，视口恢复到原位置', async () => {
      // 【规则】R1b 可能已把焦点切到别的会话；R2 的基准必须与它切回的会话是同一个，
      // 否则会拿 A 会话的锚点去 B 会话里找，失败是脚本错位而不是产品缺陷。
      await session.evaluate(clickBest);
      await new Promise((r) => setTimeout(r, 900));
      const base = await session.evaluate(snapshotExpr);
      if (base.maxScrollTop <= 200) return { skip: '会话可滚动距离不足 200px，位置恢复无法区分', metrics: base };

      const anchorRatio = 0.4;
      const target = Math.round(base.maxScrollTop * anchorRatio);
      await session.evaluate(`(() => { const s = ${STREAM}; s.scrollTop = ${target}; return true; })()`);
      await new Promise((r) => setTimeout(r, 600));

      // 【为何记录顶部首行】用户语义是「回到我上次读的那一行」，不是「回到同一个像素」：
      // scrollHeight 会随排版与占位高度变化，只有行级锚点能跨会话稳定判定。
      const before = await session.evaluate(`(() => {
        const s = ${STREAM};
        const sr = s.getBoundingClientRect();
        const rows = [...s.querySelectorAll('${ROW_SELECTOR}')];
        const topRow = rows.find((r) => r.getBoundingClientRect().bottom > sr.top + 1);
        return {
          scrollTop: +s.scrollTop.toFixed(2),
          max: +(s.scrollHeight - s.clientHeight).toFixed(2),
          topId: topRow ? topRow.getAttribute('data-msg-id') : '',
          topOffset: topRow ? +(topRow.getBoundingClientRect().top - sr.top).toFixed(1) : null,
          topText: topRow ? (topRow.textContent || '').trim().slice(0, 40) : '',
        };
      })()`);

      const otherIndex = best.index === 0 ? 1 : 0;
      await session.evaluate(TAKE_SCROLL_TRACE);
      await session.evaluate(`document.querySelectorAll('.session-item')[${otherIndex}]?.click()`);

      // 【为何要采样中间会话驻留期】350px 这类"常数"往往来自中间会话的首帧高度/scrollTop，
      // 只读终点会把「中间会话把它钳住了」与「恢复逻辑写错了」混为一谈。
      const resident = [];
      for (let i = 0; i < 6; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 200));
        // eslint-disable-next-line no-await-in-loop
        resident.push(await session.evaluate(`(() => {
          const s = ${STREAM};
          if (!s) return { ok: false };
          const sr = s.getBoundingClientRect();
          const rows = [...s.querySelectorAll('${ROW_SELECTOR}')];
          const topRow = rows.find((r) => r.getBoundingClientRect().bottom > sr.top + 1);
          return {
            ok: true,
            scrollTop: +s.scrollTop.toFixed(1),
            max: +(s.scrollHeight - s.clientHeight).toFixed(1),
            topId: topRow ? topRow.getAttribute('data-msg-id') : '',
            rows: rows.length,
            containerSame: window.__fluxStreamRef ? s === window.__fluxStreamRef : null,
          };
        })()`));
      }

      await session.evaluate(clickBest);

      const samples = [];
      let prevAt = 0;
      for (const at of [200, 600, 1400, 2900, 5400]) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, at - prevAt));
        prevAt = at;
        // eslint-disable-next-line no-await-in-loop
        const snap = await session.evaluate(`(() => {
          const s = ${STREAM};
          if (!s) return { ok: false };
          const sr = s.getBoundingClientRect();
          const rows = [...s.querySelectorAll('${ROW_SELECTOR}')];
          const topRow = rows.find((r) => r.getBoundingClientRect().bottom > sr.top + 1);
          const anchorRow = ${JSON.stringify(before.topId)}
            ? s.querySelector('[data-msg-id="${before.topId}"]:not(.msg-action-btn)')
            : null;
          const ar = anchorRow ? anchorRow.getBoundingClientRect() : null;
          return {
            ok: true,
            scrollTop: +s.scrollTop.toFixed(2),
            max: +(s.scrollHeight - s.clientHeight).toFixed(2),
            topId: topRow ? topRow.getAttribute('data-msg-id') : '',
            anchorOffset: ar ? +(ar.top - sr.top).toFixed(1) : null,
            anchorInViewport: ar ? ar.bottom > sr.top && ar.top < sr.bottom : false,
            containerSame: window.__fluxStreamRef ? s === window.__fluxStreamRef : null,
          };
        })()`);
        samples.push({ at, ...snap });
      }

      const trace = await session.evaluate(TAKE_SCROLL_TRACE);
      const metrics = { anchorRatio, targetTop: target, before, resident, samples, writes: trace.writes };
      await session.screenshot('03-restore-anchor.png');

      const badIdentity = samples.filter((s) => s.ok && s.containerSame === false);
      if (badIdentity.length > 0) {
        const err = new Error(`切回过程中 #conversation-stream 容器被替换 ${badIdentity.length} 次（${badIdentity.map((s) => `${s.at}ms`).join(',')}）`);
        err.metrics = metrics;
        throw err;
      }

      // 中间会话驻留期若已经把 scrollTop 钉成某个常数，切回又原样继承，说明离开/进入边界仍然错位。
      const residentLocked = resident.filter((r) => r.ok && r.max > 0 && Math.abs(r.scrollTop - 350) < 2);
      const returnedToResidentValue = samples.filter((s) => s.ok && resident.length > 0 && Math.abs(s.scrollTop - 350) < 2);

      const restoredByAnchor = samples.filter((s) => s.ok && s.anchorInViewport && s.anchorOffset !== null
        && before.topOffset !== null && Math.abs(s.anchorOffset - before.topOffset) <= 40);
      const restoredByRatio = samples.filter((s) => s.ok && s.max > 0
        && Math.abs(s.scrollTop / s.max - anchorRatio) <= 0.03);
      if (restoredByAnchor.length === 0 && restoredByRatio.length === 0) {
        const err = new Error(
          `切回后既未按行锚点也未按比例恢复：${JSON.stringify(samples.map((s) => `${s.at}ms top=${s.scrollTop}/${s.max} anchor=${s.anchorOffset}`))}；`
          + `切走前锚点行 ${before.topId} 偏移 ${before.topOffset}px；`
          + `中间会话驻留 ${JSON.stringify(resident.map((r) => `${r.scrollTop}/${r.max}`))}；`
          + `写入 ${trace.writes.length} 次`,
        );
        err.metrics = metrics;
        throw err;
      }
      return {
        detail: `按行锚点恢复 ${restoredByAnchor.length} 帧（${restoredByAnchor.map((s) => `${s.at}ms Δ=${s.anchorOffset - before.topOffset}px`).join(', ') || '无'}）；按比例 ${restoredByRatio.length} 帧；`
          + `驻留期锁定 350 帧 ${residentLocked.length}、切回继承 350 帧 ${returnedToResidentValue.length}；写入 ${trace.writes.length} 次`,
        metrics,
      };
    });

    /* —— R3 滚轮线性、不越界 —— */
    await caseRun('R3', '真实滚轮滚动线性且不越界', async () => {
      const geom = await session.evaluate(`(() => {
        const s = ${STREAM};
        const r = s.getBoundingClientRect();
        // 【为何从 50% 起滚】从 scrollTop=0 起滚会立刻触顶并触发「加载更早历史」，
        // 历史批次插入会让 scrollHeight 一次性跃增，那是加载位移而不是滚轮非线性，
        // 直接拿它判红等于把测量污染当成产品缺陷。
        const max = s.scrollHeight - s.clientHeight;
        s.scrollTop = Math.round(max * 0.5);
        return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 200), max, start: s.scrollTop };
      })()`);
      if (geom.max <= 1200) return { skip: '会话可滚动距离不足 1200px，线性度无法区分', metrics: geom };

      await new Promise((r) => setTimeout(r, 400));
      await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: geom.x, y: geom.y, button: 'none' });
      const samples = [];
      for (let i = 0; i < 10; i += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await session.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel', x: geom.x, y: geom.y, deltaX: 0, deltaY: 120, button: 'none',
          }, 5000);
        } catch (error) {
          // 【为何判 SKIP 而不是 FAIL】CDP 输入通道无响应属宿主通道异常，
          // 与页面是否线性滚动无关；把它判红会把环境故障记成产品缺陷。
          return { skip: `CDP 输入通道无响应（${error.message}），滚轮线性无法验证`, metrics: { geom, failedAt: i } };
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 120));
        // eslint-disable-next-line no-await-in-loop
        samples.push(await session.evaluate(`(() => {
          const s = ${STREAM};
          return { top: +s.scrollTop.toFixed(2), max: s.scrollHeight - s.clientHeight, height: s.scrollHeight };
        })()`));
      }

      const steps = [];
      for (let i = 1; i < samples.length; i += 1) {
        const shifted = Math.abs(samples[i].height - samples[i - 1].height) > samples[i - 1].height * 0.02;
        steps.push({ delta: +(samples[i].top - samples[i - 1].top).toFixed(2), contentShifted: shifted });
      }
      const clean = steps.filter((s) => !s.contentShifted);
      const monotonic = clean.every((s) => s.delta >= 0);
      const overshoot = samples.filter((s) => s.top < -0.5 || s.top > s.max + 0.5);
      const biggestJump = clean.length > 0 ? Math.max(...clean.map((s) => Math.abs(s.delta))) : 0;
      const metrics = {
        startTop: samples[0].top,
        deltas: steps,
        cleanSteps: clean.length,
        biggestJump,
        overshootCount: overshoot.length,
      };

      if (overshoot.length > 0) throw new Error(`滚动越过边界 ${overshoot.length} 次：${JSON.stringify(overshoot.slice(0, 3))}`);
      if (clean.length < 5) return { skip: `10 次滚轮中有 ${10 - clean.length} 次触发内容加载位移，有效样本不足`, metrics };
      if (!monotonic) throw new Error(`滚轮向下出现回弹：${JSON.stringify(clean.map((s) => s.delta))}`);
      // 单次滚轮 120 在 762px 视口下实测位移应在一屏内；跨屏跳跃即「跳很远」的原始现象
      if (biggestJump > 800) {
        const err = new Error(`单步位移 ${biggestJump}px 超过一屏，属非线性跳跃`);
        err.metrics = metrics;
        throw err;
      }
      return { detail: `有效 ${clean.length} 步单调递增，最大单步 ${biggestJump}px`, metrics };
    });

    /* —— R4 离屏遏制与真实中位数注入 —— */
    await caseRun('R4', 'content-visibility 离屏遏制与真实行高中位数注入', async () => {
      const metrics = await session.evaluate(`(() => {
        const s = ${STREAM};
        const turn = s.querySelector('.conv-turn');
        const cs = turn ? getComputedStyle(turn) : null;
        const streamCs = getComputedStyle(s);
        return {
          contentVisibility: cs ? cs.contentVisibility : null,
          containIntrinsicSize: cs ? cs.containIntrinsicSize : null,
          overflowAnchor: streamCs.overflowAnchor,
          medianVar: s.style.getPropertyValue('--conv-intrinsic-median-height').trim(),
          medianComputed: streamCs.getPropertyValue('--conv-intrinsic-median-height').trim(),
        };
      })()`);
      if (metrics.contentVisibility !== 'auto') {
        throw new Error(`.conv-turn 必须 content-visibility:auto，实测 ${metrics.contentVisibility}`);
      }
      if (!/auto/.test(metrics.containIntrinsicSize || '')) {
        throw new Error(`contain-intrinsic-size 必须包含 auto 记忆项，实测 ${metrics.containIntrinsicSize}`);
      }
      if (metrics.overflowAnchor !== 'auto') {
        throw new Error(`滚动容器必须 overflow-anchor:auto，实测 ${metrics.overflowAnchor}`);
      }
      const median = metrics.medianVar || metrics.medianComputed;
      if (!median) throw new Error('--conv-intrinsic-median-height 未注入（真实中位数采样未运行）');
      const px = parseFloat(median);
      if (!(px > 0)) throw new Error(`中位数非法：${median}`);
      // 【软断言】32px 正是 `.msg-action-btn` 的 24px 被估算器下限钳制后的特征值：
      // 它证明 offscreen 遏制本身在跑，但也证明行高样本被操作按钮污染。修复前不判红，
      // 只如实记录，供修复后回归判据（要求 median > 32 且接近真实行高）。
      metrics.medianLooksContaminated = px <= 32;
      return {
        detail: `中位数 ${median}${metrics.medianLooksContaminated ? '（疑似被 24px 操作按钮污染，待修复后应 > 32px）' : ''}`,
        metrics,
      };
    });

    /* —— R5 长会话导航器远距跳转落点 —— */
    await caseRun('R5', '提示词导航器远距跳转落点在一屏内', async () => {
      const ticks = await session.evaluate('document.querySelectorAll(".conv-prompt-rail__tick").length');
      if (ticks < 5) return { skip: `导航轨只有 ${ticks} 个 tick，无法验证远距跳转`, metrics: { ticks } };

      const jump = await session.evaluate(`(async () => {
        const gutter = document.querySelector('.conv-prompt-rail__gutter');
        if (!gutter) return { mounted: false };
        const ticks = [...document.querySelectorAll('.conv-prompt-rail__tick')];
        // 【为何选「最远」而不是第一个】第一个 tick 可能正是当前 active 项，
        // 点击它不会改变 scrollTop，会让用例把「已同步」误判成「跳转失效」。
        const activeIdx = ticks.findIndex((t) => t.classList.contains('is-active'));
        const target = (activeIdx <= 0 ? ticks[ticks.length - 1] : ticks[0]);
        if (!target || target === ticks[activeIdx]) return { skipped: 'no-far-tick' };
        const label = target.getAttribute('aria-label') || '';
        const gr = gutter.getBoundingClientRect();
        const tr = target.getBoundingClientRect();
        gutter.dispatchEvent(new PointerEvent('pointermove', {
          clientX: gr.left + gr.width / 2, clientY: tr.top + tr.height / 2, bubbles: true,
        }));
        await new Promise((r) => setTimeout(r, 120));
        const before = document.getElementById('conversation-stream').scrollTop;
        gutter.dispatchEvent(new MouseEvent('click', {
          clientX: gr.left + gr.width / 2, clientY: tr.top + tr.height / 2, bubbles: true,
        }));
        await new Promise((r) => setTimeout(r, 900));
        const s = document.getElementById('conversation-stream');
        const sr = s.getBoundingClientRect();
        const needle = label.slice(0, 12);
        const turns = [...s.querySelectorAll('.conv-turn')];
        const hit = needle ? turns.find((t) => (t.innerText || '').includes(needle)) : null;
        const hr = hit ? hit.getBoundingClientRect() : null;
        return {
          mounted: true,
          before: +before.toFixed(1),
          after: +s.scrollTop.toFixed(1),
          activeCount: document.querySelectorAll('.conv-prompt-rail__tick.is-active').length,
          activeIndex: [...document.querySelectorAll('.conv-prompt-rail__tick')].findIndex((t) => t.classList.contains('is-active')),
          matched: Boolean(hit),
          targetTopRelative: hr ? +(hr.top - sr.top).toFixed(1) : null,
          viewportHeight: +sr.height.toFixed(1),
        };
      })()`);

      if (!jump.mounted) throw new Error('导航轨未挂载');
      if (jump.skipped) return { skip: '导航轨只有当前项或找不到远端 tick，无法验证远距跳转', metrics: jump };
      if (jump.activeCount !== 1) throw new Error(`跳转后当前 tick 必须唯一，实测 ${jump.activeCount}`);
      if (jump.after === jump.before) throw new Error(`点击远端 tick 后滚动位置未变化（仍为 ${jump.after}）`);
      if (!jump.matched) return { detail: `跳转生效，但目标提示词行未被 content-visibility 渲染（tick=${jump.activeIndex}）`, metrics: jump };
      if (jump.targetTopRelative < -40 || jump.targetTopRelative > jump.viewportHeight) {
        throw new Error(`落点在视口外：目标行相对视口顶 ${jump.targetTopRelative}px，视口高 ${jump.viewportHeight}px`);
      }
      return { detail: `目标行落于视口内 ${jump.targetTopRelative}px`, metrics: jump };
    });

    /* —— R6 回合末悬浮气泡向上弹出、不被 paint containment 裁掉 —— */
    await caseRun('R6', '回合末操作气泡朝正文方向弹出且不被裁切', async () => {
      // 【为何先滚到底】气泡只有落在视口内才可能被裁切；停在会话中段时最后回合在视口外，
      // 量到的「上方余量」是整段距离，根本证明不了临界场景。
      await session.evaluate(`(() => { const s = ${STREAM}; s.scrollTop = s.scrollHeight; return true; })()`);
      await new Promise((r) => setTimeout(r, 700));
      const probe = await session.evaluate(`(() => {
        const stream = ${STREAM};
        const turns = [...stream.querySelectorAll('.conv-turn')];
        if (turns.length === 0) return { ok: false, reason: 'no-turn' };
        const turn = turns[turns.length - 1];
        const btn = turn.querySelector('.msg-action-btn');
        if (!btn) return { ok: false, reason: 'no-action-btn' };
        const after = getComputedStyle(btn, '::after');
        const sr = stream.getBoundingClientRect();
        const tr = turn.getBoundingClientRect();
        return {
          ok: true,
          bottom: after.bottom,
          top: after.top,
          contentVisibility: getComputedStyle(turn).contentVisibility,
          roomAboveTurn: +(tr.top - sr.top).toFixed(1),
          turnHeight: +tr.height.toFixed(1),
          turnVisible: tr.bottom > sr.top && tr.top < sr.bottom,
        };
      })()`);
      if (!probe.ok) return { skip: `最后回合没有操作按钮（${probe.reason}），无法取证气泡方向`, metrics: probe };
      if (!probe.turnVisible) throw new Error('滚到底后最后回合仍不在视口内，无法取证气泡裁切');

      const bottomPx = parseFloat(probe.bottom);
      if (!(bottomPx > 0)) {
        throw new Error(`气泡必须向上弹出（bottom 应为正值），实测 bottom=${probe.bottom} top=${probe.top}`);
      }
      if (probe.contentVisibility !== 'auto') {
        throw new Error(`本用例前提是 paint containment 生效，实测 content-visibility=${probe.contentVisibility}`);
      }
      if (probe.roomAboveTurn < 40) {
        throw new Error(`回合上方仅剩 ${probe.roomAboveTurn}px，向上气泡仍会被裁切`);
      }
      await session.screenshot('05-bubble.png');
      return { detail: `气泡 bottom=${probe.bottom}，回合上方余量 ${probe.roomAboveTurn}px，回合高 ${probe.turnHeight}px`, metrics: probe };
    });

    /* —— R7 切换会话无白屏 —— */
    await caseRun('R7', '切换会话过程不出现空白会话区', async () => {
      const otherIndex = best.index === 0 ? 1 : 0;
      const samples = [];
      await session.evaluate(`document.querySelectorAll('.session-item')[${otherIndex}]?.click()`);
      for (let i = 0; i < 6; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 150));
        // eslint-disable-next-line no-await-in-loop
        samples.push(await session.evaluate(`(() => {
          const s = ${STREAM};
          if (!s) return { textLen: -1, nodes: 0 };
          return { textLen: (s.innerText || '').trim().length, nodes: s.querySelectorAll('${ROW_SELECTOR}, .conv-turn').length };
        })()`));
      }
      await session.screenshot('04-session-switch.png');
      const blank = samples.filter((s) => s.textLen === 0 && s.nodes === 0);
      if (blank.length > 0) throw new Error(`切换后出现 ${blank.length}/6 个空白采样帧（白屏）`);
      return { detail: `6 帧采样均非空`, metrics: { samples } };
    });

    /* —— R8 流式不中断（真实网关推流 + 跨会话保持） —— */
    await caseRun('R8', '长耗时流式输出持续不断且跨会话切回仍在增长', async () => {
      // 【为何要开关】R8 会向真实会话写入一条测试指令；回归脚本自身、
      // 或在无写权限环境跑前 7 项时，必须能显式跳过而不是被迫污染用户会话。
      if (process.env.FLUX_VERIFY_SKIP_SEND === '1') {
        return { skip: 'FLUX_VERIFY_SKIP_SEND=1：本轮不向真实会话发送测试指令' };
      }
      await session.evaluate(`document.querySelectorAll('.session-item')[${best.index}]?.click()`);
      await new Promise((r) => setTimeout(r, 900));

      const beforeRows = await session.evaluate(`(() => {
        const s = ${STREAM};
        return s ? s.querySelectorAll('${ROW_SELECTOR}').length : -1;
      })()`);

      const filled = await session.evaluate(helpers.fill(
        '#dock-prompt-input',
        '这次回复不要调用任何工具。请逐行输出 120 行，每行格式严格为「验证行 N: ok」，N 从 1 到 120，每行之间换行，不要省略任何一行。',
      ));
      if (!filled) return { skip: '输入舱不可用（#dock-prompt-input 缺失）' };
      const sent = await session.evaluate(helpers.click('#dock-send-btn'));
      if (!sent) return { skip: '发送按钮不可用（#dock-send-btn 缺失）' };

      // 先确认这一次发送真的落了消息行；否则「文本没增长」只是没发出去，不是流式中断。
      let afterRows = beforeRows;
      const sendDeadline = Date.now() + 12000;
      while (Date.now() < sendDeadline && afterRows <= beforeRows) {
        await new Promise((r) => setTimeout(r, 500));
        afterRows = await session.evaluate(`(() => {
          const s = ${STREAM};
          return s ? s.querySelectorAll('${ROW_SELECTOR}').length : -1;
        })()`);
      }
      if (afterRows <= beforeRows) {
        const notice = await session.evaluate(`(() => {
          const body = document.body.innerText || '';
          const hints = ['审批', 'approval', '网络', '错误', 'failed', 'Error', '请输入'];
          return hints.filter((h) => body.includes(h)).join(',') || body.slice(-200);
        })()`);
        return { skip: `发送后 12s 内未新增消息行（${beforeRows} → ${afterRows}），页面提示：${notice}`, metrics: { beforeRows, afterRows } };
      }

      const lengths = [];
      const totals = [];
      const rowCounts = [];
      const assistantRows = [];
      const running = [];
      let switchedAway = false;
      let switchedBack = false;
      let switchedAwayRunning = false;
      const startedAt = Date.now();
      const WINDOW_MS = 90000;
      while (Date.now() - startedAt < WINDOW_MS) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 3000));
        // eslint-disable-next-line no-await-in-loop
        const sample = await session.evaluate(`(() => {
          const s = ${STREAM};
          if (!s) return { rows: -1, lastNonEmpty: 0, total: 0, assistantRows: 0 };
          const rows = [...s.querySelectorAll('${ROW_SELECTOR}')];
          // 【为何取最后一条非空行】流式行里会混入 tool/事件占位行，行尾 textContent 为空；
          // 只盯最后一行会把「回复在长」误判成「一个字都没来」。
          const texts = rows.map((r) => (r.textContent || '').trim());
          const lastNonEmpty = [...texts].reverse().find((t) => t.length > 0) || '';
          return {
            rows: rows.length,
            lastNonEmpty: lastNonEmpty.length,
            total: texts.reduce((sum, t) => sum + t.length, 0),
            assistantRows: s.querySelectorAll('.conv-message--assistant, .assistant-row').length,
            isRunning: Boolean(document.querySelector('.activity-pulse-indicator')),
          };
        })()`);
        lengths.push(Number(sample.lastNonEmpty));
        totals.push(Number(sample.total));
        rowCounts.push(Number(sample.rows));
        assistantRows.push(Number(sample.assistantRows));
        running.push(Boolean(sample.isRunning));

        const elapsed = Date.now() - startedAt;
        if (!switchedAway && elapsed > 18000) {
          switchedAwayRunning = Boolean(await session.evaluate('Boolean(document.querySelector(".activity-pulse-indicator"))'));
          await session.evaluate(`document.querySelectorAll('.session-item')[${best.index === 0 ? 1 : 0}]?.click()`);
          switchedAway = true;
        } else if (switchedAway && !switchedBack && elapsed > 27000) {
          await session.evaluate(clickBest);
          switchedBack = true;
        }
      }
      await session.screenshot('06-streaming.png');

      // 【为何按 totals 分段判定】流式行的“最后一条非空行”会被 tool/事件行不断替换，
      // 单行长度会出现 551 → 495 → 89 的伪回退；只有会话内文本总长才是单调的续流证据。
      // 切换会话期间 DOM 换成另一会话，故以 rowCounts 最后一次变化为界切分前后两段。
      let tailStart = 0;
      for (let i = 1; i < rowCounts.length; i += 1) {
        if (rowCounts[i] !== rowCounts[i - 1]) tailStart = i;
      }
      let firstChange = totals.length;
      for (let i = 1; i < rowCounts.length; i += 1) {
        if (rowCounts[i] !== rowCounts[i - 1]) { firstChange = i; break; }
      }
      const growthOf = (arr, from, to) => arr.slice(from, to).filter((v, i, a) => i > 0 && v > a[i - 1]).length;
      // firstChange 本身是「新行出现的那一帧」，该帧通常已包含增长，必须计入前段。
      const preGrowth = growthOf(totals, 0, Math.min(firstChange + 1, totals.length));
      const postGrowth = switchedBack ? growthOf(totals, tailStart, totals.length) : 0;
      const postRunning = running.slice(tailStart).some(Boolean);
      const firstTotal = totals[0] ?? 0;
      const lastTotal = totals[totals.length - 1] ?? 0;

      const metrics = {
        beforeRows, afterRows, lengths, totals, rowCounts, assistantRows, running,
        tailStart, firstChange, preGrowth, postGrowth, postRunning, switchedAwayRunning, firstTotal, lastTotal,
        switchedAway, switchedBack, windowMs: WINDOW_MS,
      };

      if (preGrowth < 1) {
        const err = new Error(`切走前文本总长未增长（${firstTotal} 字符），流式从未推进`);
        err.metrics = metrics;
        throw err;
      }
      if (!switchedAway || !switchedBack) return { skip: '会话切换阶段未完成（会话数量不足），跨会话续流未取证', metrics };
      // 【为何以「切走时是否仍在运行」为前提】跨会话续流只有在流式尚未结束时才有观测窗口。
      // 若切走前运行指示已消失，说明该网关本次回复在 ~10s 内就完成了，用例前提不成立，
      // 必须显式 SKIP（并保留「会话内确实推进过」的正面证据），不得判过也不得判红。
      if (!switchedAwayRunning) {
        return {
          skip: `切走时流式已结束（运行指示消失），未形成长耗时观测窗口；会话内增长 ${preGrowth} 次（${firstTotal}→${totals[Math.min(firstChange, totals.length - 1)]} 字符）`,
          metrics,
        };
      }
      if (postGrowth >= 1) {
        return { detail: `切走前增长 ${preGrowth} 次；切回后继续增长 ${postGrowth} 次（${lastTotal} 字符）`, metrics };
      }
      if (postRunning) {
        const err = new Error(`切回后 60s 内文本总长零增长，但运行指示仍在（流式中断）：${JSON.stringify(totals.slice(tailStart))}`);
        err.metrics = metrics;
        throw err;
      }
      return { skip: '切回时回复已结束且无运行指示，无法区分「已完成」与「切换打断后完成」', metrics };
    });

    await session.screenshot('07-final.png');
  } finally {
    await session.cleanup();
    try { server.child.kill(); } catch { /* 忽略 */ }
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  const skipped = results.filter((r) => r.status === 'SKIP');
  const evidence = {
    featureId: FEATURE_ID,
    gatewayHost: new URL(GATEWAY_URL).origin,
    timestamp: new Date().toISOString(),
    status: failed.length === 0 ? 'PASSED' : 'FAILED',
    summary: { total: results.length, passed: results.length - failed.length - skipped.length, failed: failed.length, skipped: skipped.length },
    results,
    screenshots,
  };
  fs.writeFileSync(path.join(ARTIFACTS_DIR, 'evidence.json'), JSON.stringify(evidence, null, 2));

  log(`\n${failed.length === 0 ? '✔' : '✖'} 汇总：通过 ${evidence.summary.passed} / 失败 ${failed.length} / 跳过 ${skipped.length}`);
  log(`  证据：${path.join(ARTIFACTS_DIR, 'evidence.json')}`);
  for (const f of failed) log(`   ✖ ${f.id} ${f.title}：${f.detail}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\n✖ 验证驱动失败：', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
