/**
 * BOT 面板「真网关 → 真 UI」只读验证。
 *
 * 【设计意图 (Why)】
 *   契约 fixture 能证明字段名，证明不了真实数据喂进真实组件后的形状：
 *   模型下拉是否认得当前模型、SOUL 是否完整显示、能力清单是否按权威性渲染、
 *   MCP 空清单是否被误写成"读取失败"、标签 emoji 是否被带进正文。
 *   本脚本连真实网关**只读**取数，用真实 React SSR + 真实皮肤 CSS 渲染并截图。
 *
 * 【约束与规则 (Rules)】
 *   - 不做任何写操作；目标默认 `flux-probe-bot`，可用 HERMES_PROBE_TARGET 覆盖；
 *   - 未配置 HERMES_GATEWAY_URL 时以退出码 0 跳过（本地无网关属正常）；
 *   - 凭据只从环境变量读取，绝不写进产物。
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseBotDetail, draftFromDetail, mergeMcpStatus, mergeSkillInventory } from '../../packages/core/dist/index.js';
import { normalizeAgentProfile } from '../../packages/core/dist/rpc/profileNormalize.js';
import { SettingsModal } from '../../packages/ui/dist/components-react/settings/SettingsModal.js';
import { setLocale } from '../../packages/ui/dist/i18n/index.js';

const BASE_URL = (process.env.HERMES_GATEWAY_URL || '').replace(/\/+$/, '');
const USER = process.env.HERMES_GATEWAY_USER || '';
const PASSWORD = process.env.HERMES_GATEWAY_PASSWORD || '';
const TARGET = process.env.HERMES_PROBE_TARGET || 'flux-probe-bot';

if (!BASE_URL) {
  console.log('[bot-panel-live] HERMES_GATEWAY_URL 未设置，跳过真实网关 UI 验证（这是允许的）。');
  process.exit(0);
}

/* ---------------- HTTP / WS ---------------- */

function request(pathname, { method = 'GET', body, headers = {} } = {}) {
  const url = new URL(pathname, BASE_URL);
  const payload = body ? JSON.stringify(body) : '';
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => {
          const cookieHeader = (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
          resolve({ status: res.statusCode, cookieHeader, text });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function connect() {
  const statusRes = await request('/api/status');
  let status = {};
  try {
    status = JSON.parse(statusRes.text);
  } catch {
    /* 非 JSON 状态响应按免密网关处理 */
  }

  let cookieHeader = '';
  let loopbackToken = '';
  if (status.auth_required) {
    if (!USER || !PASSWORD) throw new Error('网关要求认证，但未设置 HERMES_GATEWAY_USER / HERMES_GATEWAY_PASSWORD');
    const login = await request('/auth/password-login', {
      method: 'POST',
      body: { provider: 'basic', username: USER, password: PASSWORD },
    });
    if (login.status !== 200) throw new Error(`登录失败 HTTP ${login.status}`);
    cookieHeader = login.cookieHeader;
  } else {
    const home = await request('/');
    const match = /__HERMES_SESSION_TOKEN__\s*=\s*["']([^"']+)["']/.exec(home.text || '');
    loopbackToken = match ? match[1] : '';
  }

  const ticketRes = await request('/api/auth/ws-ticket', { method: 'POST', headers: { Cookie: cookieHeader } });
  let ticket = '';
  try {
    ticket = JSON.parse(ticketRes.text).ticket || '';
  } catch {
    /* ignore */
  }

  const wsUrl = new URL('/api/ws', BASE_URL);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  if (ticket) wsUrl.searchParams.set('ticket', ticket);
  else if (loopbackToken) wsUrl.searchParams.set('token', loopbackToken);

  const ws = new WebSocket(wsUrl.toString());
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) entry.reject(Object.assign(new Error(msg.error.message || 'RPC error'), msg.error));
      else entry.resolve(msg.result);
    }
  };
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket 连接超时')), 15000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('WebSocket 连接失败'));
    };
  });

  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });

  return { ws, call, version: status.version || 'unknown' };
}

/* ---------------- 真实数据 → 快照 ---------------- */

async function buildSnapshot(call) {
  const list = await call('profiles.list', {});
  const profiles = (Array.isArray(list?.profiles) ? list.profiles : []).map((row) => normalizeAgentProfile(row));
  const row = profiles.find((item) => item.name === TARGET);
  if (!row) throw new Error(`目标 BOT 不存在：${TARGET}（可用 HERMES_PROBE_TARGET 覆盖）`);

  const describe = await call('profiles.describe', { name: TARGET });
  let detail = parseBotDetail(describe, {
    id: TARGET,
    displayName: row.displayName,
    avatar: row.avatar || undefined,
    isDefault: row.isDefault,
  });

  // 技能清单非权威时才用全局目录补全展示（与壳层 enrichCapabilities 同一口径）。
  if (!detail.skills.authoritative) {
    const inventory = await call('skills.manage', { profile: TARGET, action: 'list' }).catch(() => null);
    const groups = inventory?.skills;
    if (groups && typeof groups === 'object') {
      const names = Object.values(groups).flatMap((value) => (Array.isArray(value) ? value : []));
      detail = { ...detail, skills: mergeSkillInventory(detail.skills, names.filter((name) => typeof name === 'string')) };
    }
  }

  const mcp = await call('mcp.servers.status', { profile: TARGET }).catch(() => null);
  if (Array.isArray(mcp?.servers)) {
    detail = {
      ...detail,
      mcpServers: mergeMcpStatus(
        detail.mcpServers,
        mcp.servers
          .filter((server) => typeof server?.name === 'string')
          .map((server) => ({
            name: server.name,
            connected: server.connected === true,
            transport: typeof server.transport === 'string' ? server.transport : undefined,
            tools: typeof server.tools === 'number' ? server.tools : undefined,
          })),
      ),
    };
  }

  const modelOptions = await call('model.options', { profile: TARGET, explicit_only: true }).catch(() => null);
  const availableModels = [];
  for (const provider of Array.isArray(modelOptions?.providers) ? modelOptions.providers : []) {
    for (const model of Array.isArray(provider?.models) ? provider.models : []) {
      if (typeof model !== 'string') continue;
      availableModels.push({
        id: model,
        name: model,
        provider: String(provider.slug || ''),
        providerName: String(provider.name || provider.slug || ''),
      });
    }
  }

  return { profiles, row, detail, availableModels };
}

/* ---------------- 静态渲染 ---------------- */

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'artifacts', 'verification');
const CSS_DIR = path.join(ROOT, 'packages', 'desktop', 'dist', 'renderer');
const BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

const uiRequire = createRequire(new URL('../../packages/ui/package.json', import.meta.url));
const React = uiRequire('react');
const { renderToStaticMarkup } = uiRequire('react-dom/server');
const actions = new Proxy({}, { get: () => () => {} });

function snapshot(theme, data) {
  const roster = data.profiles.map((profile) => ({
    id: profile.name,
    displayName: profile.displayName,
    model: profile.model,
    avatar: profile.avatar || undefined,
    isDefault: profile.isDefault,
    hasDraft: false,
  }));
  return {
    isOpen: true,
    section: 'agents',
    theme,
    locale: 'zh',
    fontPrefs: { uiFont: 'geist-sans', monoFont: 'jetbrains-mono', sizeScale: 'medium' },
    activityVariant: 'cloud',
    profiles: { status: 'ready', data: data.profiles.map((profile) => ({ name: profile.name, displayName: profile.displayName, isDefault: profile.isDefault })) },
    bots: roster.map((item) => ({ profile: item.id, displayName: item.displayName })),
    botManagement: {
      status: { status: 'idle', activeBotId: TARGET },
      roster,
      activeBotId: TARGET,
      activeDetail: data.detail,
      availableModels: data.availableModels,
      activeDraft: undefined,
      isBusy: false,
      wizard: {
        open: false,
        draft: {
          mode: 'blank', name: '', displayName: '', description: '', model: '', provider: '',
          cloneFrom: '', cloneChannels: false, mirrorCredentials: false,
        },
        busy: false,
      },
      exitPrompt: null,
      errorBanner: undefined,
      confirmPending: undefined,
      highlightBotId: undefined,
    },
    scopedProfile: TARGET,
    providerViews: { status: 'ready', data: [] },
    providerFailures: [],
    subscriptionCatalog: { status: 'ready', data: [] },
    customEndpoints: { status: 'ready', data: [] },
    endpointProfiles: {},
    endpointFailures: [],
    providerAdminBusy: false,
    mcp: { status: 'ready', data: [] },
    skills: { status: 'ready', data: [] },
    gateway: { url: BASE_URL, username: '', hasStoredPassword: false, profileName: TARGET, status: 'connected', latencyMs: 0 },
    appVersion: 'live',
    platform: process.platform,
    busy: false,
  };
}

function html(theme, data) {
  setLocale('zh-CN');
  const markup = renderToStaticMarkup(React.createElement(SettingsModal, { snapshot: snapshot(theme, data), actions }));
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${theme}">
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/conversation.css">
<link rel="stylesheet" href="/tailwind.css">
<style>
  html, body { margin: 0; background: var(--background); }
  .flux-settings { position: fixed; inset: 0; }
  [data-bot-section] > div.grid { grid-template-rows: 1fr !important; }
  [data-bot-section] > div.grid > div { visibility: visible !important; }
</style>
</head>
<body>${markup}</body>
</html>`;
}

function startServer(data) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/' || urlPath === '/light') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html(urlPath === '/light' ? 'jade-white' : 'obsidian-gold', data));
      return;
    }
    const filePath = path.join(CSS_DIR, path.basename(urlPath));
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': urlPath.endsWith('.css') ? 'text/css; charset=utf-8' : urlPath.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream',
    });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function waitForTarget(port) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {
      // 浏览器启动期 devtools 端口尚未监听，轮询重试是预期路径。
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('CDP page target 不可达');
}

async function capture(url, outputPath, data) {
  const browserPath = BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!browserPath) throw new Error('未找到 Edge/Chrome');
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const cdpPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  const userDataDir = path.resolve(os.tmpdir(), `flux-bot-live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const proc = spawn(browserPath, [
    `--remote-debugging-port=${cdpPort}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,1800',
    url,
  ], { stdio: 'ignore' });

  let ws = null;
  try {
    const wsUrl = await waitForTarget(cdpPort);
    ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    let nextId = 1;
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      const onMessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== id) return;
        ws.removeEventListener('message', onMessage);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      };
      ws.addEventListener('message', onMessage);
      ws.send(JSON.stringify({ id, method, params }));
    });

    await send('Page.enable');
    await send('Page.navigate', { url });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1800, deviceScaleFactor: 1, mobile: false });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const result = await send('Runtime.evaluate', {
      expression: `(() => {
        const model = document.querySelector('#bot-model');
        const soul = document.querySelector('#bot-soul');
        const labels = [...document.querySelectorAll('[data-bot-capability]')].map((node) => node.getAttribute('aria-label') || '');
        const authorative = [...document.querySelectorAll('[data-bot-section] p')].map((node) => node.textContent || '');
        return {
          modelValue: model ? model.value : '',
          modelHasValue: model ? [...model.options].some((option) => option.value === model.value && option.selected) : false,
          modelGroups: model ? model.querySelectorAll('optgroup').length : 0,
          soulLength: soul ? soul.value.length : -1,
          capabilityCount: document.querySelectorAll('[data-bot-capability]').length,
          labelsWithEmoji: labels.filter((text) => /^[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/u.test(text)).length,
          capabilityEmptyText: authorative.some((text) => text.includes('未配置任何条目') || text.includes('清单读取不完整')),
          overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      })()`,
      returnByValue: true,
    });
    const value = result.result.value;
    const expectedCapabilities =
      data.detail.skills.rows.length + data.detail.toolsets.rows.length + data.detail.mcpServers.rows.length;
    if (value.modelValue !== data.detail.model) throw new Error(`模型下拉未回显当前模型：${value.modelValue} != ${data.detail.model}`);
    if (!value.modelHasValue) throw new Error('模型下拉没有选中当前模型（可能被静默清空）');
    if (value.soulLength !== data.detail.soul.length) throw new Error(`SOUL 未完整渲染：${value.soulLength} != ${data.detail.soul.length}`);
    if (value.capabilityCount !== expectedCapabilities) throw new Error(`能力行数不一致：${value.capabilityCount} != ${expectedCapabilities}`);
    if (value.labelsWithEmoji > 0) throw new Error('能力标签仍带 emoji');
    if (value.overflowX) throw new Error('页面出现横向溢出');

    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(shot.data, 'base64'));
    return value;
  } finally {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ id: 999999, method: 'Browser.close' }));
        await new Promise((resolve) => setTimeout(resolve, 300));
        ws.close();
      }
    } catch {
      /* 收尾阶段关闭失败不覆盖已完成断言 */
    }
    try { proc.kill(); } catch {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
}

/* ---------------- 主流程 ---------------- */

const { ws, call, version } = await connect();
try {
  const data = await buildSnapshot(call);
  const server = await startServer(data);
  const port = server.address().port;
  try {
    const dark = await capture(`http://127.0.0.1:${port}/`, path.join(OUT_DIR, 'bot-panel-live-dark.png'), data);
    const light = await capture(`http://127.0.0.1:${port}/light`, path.join(OUT_DIR, 'bot-panel-live-light.png'), data);
    console.log(JSON.stringify({
      gatewayVersion: version,
      profile: TARGET,
      displayName: data.row.displayName,
      model: data.detail.model,
      provider: data.detail.provider,
      soulBytes: new TextEncoder().encode(data.detail.soul).length,
      skills: data.detail.skills.rows.length,
      skillsAuthoritative: data.detail.skills.authoritative,
      toolsets: data.detail.toolsets.rows.length,
      mcpServers: data.detail.mcpServers.rows.length,
      availableModels: data.availableModels.length,
      screenshots: ['artifacts/verification/bot-panel-live-dark.png', 'artifacts/verification/bot-panel-live-light.png'],
      dark,
      light,
    }, null, 2));
  } finally {
    server.close();
  }
} finally {
  ws.close();
}
