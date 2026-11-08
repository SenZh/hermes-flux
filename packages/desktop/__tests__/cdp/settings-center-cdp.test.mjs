/**
 * 设置中心 CDP 端到端验收（真实 Blink + 真实打包产物，无网关）。
 *
 * 【设计意图 (Why)】设置页的问题从来不是"渲染不出来"，而是"看起来有、点了没用"：
 *   13 个占位导航、语言按钮零绑定、提供商卡片是 7 个硬编码字符串。
 *   静态单测能钉住结构与文案，但钉不住"点主题真的换肤、点语言真的换文案、
 *   没连网关时失败态真的可见"。这三条必须物理驱动。
 *
 * 【防范的历史坑 (Pitfall)】PR-3b 教训"测试全绿但截图全白方块"——凡触碰视觉必须出图，
 *   本测试把截图落盘 artifacts/verification/（不入 Git）。
 *
 * 【约束与规则 (Rules)】
 *   - 只经真实 DOM click 驱动，不直接调用内部函数；
 *   - 断言针对用户可观察的 DOM、文本与 documentElement 属性；
 *   - 截图目录不存在时自动创建，失败不阻断断言。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const RENDERER_ENTRY = 'packages/desktop/dist/renderer/index.html';

test('settings-center: 真实产物下的导航、换肤、语言与失败态（出图）', async (t) => {
  const browserPath = BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!browserPath) {
    t.skip('未找到 Edge/Chrome');
    return;
  }
  const rootDir = process.cwd();
  if (!fs.existsSync(path.join(rootDir, RENDERER_ENTRY))) {
    t.skip('renderer 产物缺失，先 npm run build');
    return;
  }

  const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (reqPath === '/') reqPath = `/${RENDERER_ENTRY}`;
    const filePath = path.join(rootDir, reqPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.map': 'application/json',
      '.png': 'image/png',
      '.woff2': 'font/woff2',
    };
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;

  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const cdpPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  const userDataDir = path.resolve(os.tmpdir(), `flux-settings-cdp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const proc = spawn(browserPath, [
    `--remote-debugging-port=${cdpPort}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,900',
    `http://127.0.0.1:${serverPort}/${RENDERER_ENTRY}`,
  ], { stdio: 'ignore' });

  let ws = null;
  t.after(async () => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ id: 999999, method: 'Browser.close' }));
        await new Promise((resolve) => setTimeout(resolve, 400));
        ws.close();
      }
    // gate-degrade: 收尾阶段的浏览器关闭失败不应让已完成的断言变成失败
    } catch {}
    try { proc.kill(); } catch {}
    try { server.close(); } catch {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  });

  let wsUrl = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !wsUrl) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json`);
      if (res.ok) {
        const targets = await res.json();
        const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
        if (page) wsUrl = page.webSocketDebuggerUrl;
      }
    // gate-degrade: 浏览器启动期 devtools 端口尚未监听，轮询重试是预期路径
    } catch {}
    if (!wsUrl) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(wsUrl, 'CDP page target 必须可达');

  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  let msgId = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      const handler = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) handler.reject(new Error(JSON.stringify(data.error)));
      else handler.resolve(data.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(`页面表达式异常: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
    }
    return result.result?.value;
  };
  const waitFor = async (expression, label, timeoutMs = 12000) => {
    const stop = Date.now() + timeoutMs;
    let last;
    while (Date.now() < stop) {
      last = await evaluate(expression);
      if (last) return last;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    throw new Error(`waitFor timeout: ${label}; last=${JSON.stringify(last)}`);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await waitFor('Boolean(window.__fluxState && window.__fluxRender)', 'renderer 调试面');

  // 打开设置：走顶栏真实按钮，不直接改 state
  await waitFor('Boolean(document.getElementById("btn-open-settings"))', '顶栏设置入口');
  await evaluate('document.getElementById("btn-open-settings").click()');
  await waitFor('Boolean(document.querySelector("[data-testid=settings-dialog]"))', '设置弹窗出现');

  const navIds = await evaluate(
    'Array.from(document.querySelectorAll("[data-settings-section]")).map((node) => node.getAttribute("data-settings-section"))',
  );
  assert.deepEqual(navIds, ['appearance', 'providers', 'agents', 'extensions', 'connection', 'about']);

  const navText = await evaluate(
    'document.querySelector("[data-settings-section]").closest("nav").textContent',
  );
  assert.ok(!/OPENCHAMBER|Tunnels|Web Search/i.test(navText), `导航不得残留竞品域: ${navText}`);

  const emojiFree = await evaluate(`(() => {
    const nav = document.querySelector('[data-settings-section]').closest('nav');
    const text = nav ? nav.textContent : '';
    return !/[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/u.test(text);
  })()`);
  assert.equal(emojiFree, true, '导航图标不得是 emoji');
  const iconCount = await evaluate('document.querySelectorAll("[data-settings-section] svg").length');
  assert.equal(iconCount, 6, '每个导航项必须有一个 lucide SVG 图标');

  // 换肤：点真实皮肤卡，documentElement 必须立刻换 data-theme
  const beforeTheme = await evaluate('document.documentElement.getAttribute("data-theme")');
  await evaluate('document.querySelector("[data-theme-option=ayu-light]").click()');
  await waitFor('document.documentElement.getAttribute("data-theme") === "ayu-light"', '切换皮肤到 ayu-light');
  const afterTheme = await evaluate('document.documentElement.getAttribute("data-theme")');
  assert.notEqual(afterTheme, beforeTheme);
  const persisted = await evaluate('localStorage.getItem("hermes_flux_theme")');
  assert.equal(persisted, 'ayu-light', '皮肤偏好必须落盘');

  // 语言：点 English 后导航文案必须真的变成英文
  await evaluate('document.querySelector("[data-segmented-value=en]").click()');
  await waitFor(
    'document.querySelector("[data-settings-section=appearance]").textContent.trim() === "Appearance"',
    '导航文案切到英文',
  );
  const langPersisted = await evaluate('localStorage.getItem("hermes_flux_lang")');
  assert.equal(langPersisted, 'en');
  assert.equal(await evaluate('document.documentElement.lang'), 'en-US');

  // 切回中文，避免影响后续截图与断言
  await evaluate('document.querySelector("[data-segmented-value=zh]").click()');
  await waitFor(
    'document.querySelector("[data-settings-section=appearance]").textContent.trim() === "外观"',
    '导航文案切回中文',
  );

  // 提供商页：没有网关时必须出现显式失败态与重试入口，而不是空屏或假卡片
  await evaluate('document.querySelector("[data-settings-section=providers]").click()');
  await waitFor('Boolean(document.body.textContent.includes("加载失败"))', '提供商失败态可见');
  const providersPanel = await evaluate('document.body.textContent');
  assert.ok(!/jev|agnes-ai|magpie/i.test(providersPanel), '不得出现硬编码的假提供商');

  // 连接页：表单与状态必须真实可见
  await evaluate('document.querySelector("[data-settings-section=connection]").click()');
  await waitFor('Boolean(document.getElementById("settings-gateway-url"))', '连接表单出现');

  // 截图留证。headless 截图可能返回上一帧，必须先等两帧 rAF + 一次样式提交，
  // 否则会拍到"内容已切换、导航高亮还没重绘"的中间态（实测踩到）。
  const settle = async () => {
    await evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await new Promise((resolve) => setTimeout(resolve, 120));
  };
  const shotDir = path.resolve(rootDir, 'artifacts/verification');
  fs.mkdirSync(shotDir, { recursive: true });

  await settle();
  const navState = await evaluate(
    'Array.from(document.querySelectorAll("[data-settings-section]")).filter((n) => n.getAttribute("aria-current") === "page").map((n) => n.getAttribute("data-settings-section"))',
  );
  assert.deepEqual(navState, ['connection'], '导航高亮必须与右侧面板同步，不能停在上一项');

  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(shotDir, 'settings-center-connection.png'), Buffer.from(shot.data, 'base64'));

  await evaluate('document.querySelector("[data-settings-section=appearance]").click()');
  await waitFor('document.querySelector("[data-settings-section=appearance]").getAttribute("aria-current") === "page"', '切到外观');
  await settle();
  const shot2 = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(shotDir, 'settings-center-appearance.png'), Buffer.from(shot2.data, 'base64'));

  // Esc 关闭
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
  await waitFor('!document.querySelector("[data-testid=settings-dialog]")', 'Esc 关闭设置');

  const pageErrors = await evaluate('Array.isArray(window.__fluxState.messages)');
  assert.equal(pageErrors, true, '页面状态必须仍然可读（无崩溃）');
});
