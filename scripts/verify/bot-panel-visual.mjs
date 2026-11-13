/**
 * BOT 面板静态视觉验证（真实 Blink + 真实 React SSR 产物 + 真实皮肤 CSS）。
 *
 * 【设计意图 (Why)】
 *   SSR 不能证明 rAF 滑动，但能证明 148px 视口、5 槽位排布、基础字段、暗/亮
 *   两套皮肤与底部操作栏的物理布局。交互由 b ot-management-controller 与
 *   settings-modal 行为测试覆盖；本脚本只负责"看得见的地方没有塌"。
 *
 * 【约束与规则 (Rules)】
 *   - 只读取真实组件与 renderer 的 CSS 产物；
 *   - 截图输出到 artifacts/verification/（不入 Git）；
 *   - 断言失败必须非零退出。
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SettingsModal } from '../../packages/ui/dist/components-react/settings/SettingsModal.js';
import { setLocale } from '../../packages/ui/dist/i18n/index.js';

const uiRequire = createRequire(new URL('../../packages/ui/package.json', import.meta.url));
const React = uiRequire('react');
const { renderToStaticMarkup } = uiRequire('react-dom/server');

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'artifacts', 'verification');
const CSS_DIR = path.join(ROOT, 'packages', 'desktop', 'dist', 'renderer');
const BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

const noop = () => {};
const actions = new Proxy({}, { get: () => noop });

const detail = {
  id: 'arch',
  displayName: '架构老王',
  description: '负责跨端架构评审、契约基线与技术方案取舍',
  model: 'anthropic/claude-opus-4.8',
  provider: 'anthropic',
  soul: '你是一名严谨的软件架构师。先确认约束与边界，再给出可落地的方案。\n\n所有结论必须附带证据：源码、契约或实验。',
  avatar: undefined,
  isDefault: false,
  skills: {
    authoritative: true,
    rows: [
      { id: 'codebase-inspection', label: 'codebase-inspection', enabled: true },
      { id: 'github', label: 'github', enabled: true },
      { id: 'dogfood', label: 'dogfood', enabled: false },
    ],
  },
  toolsets: {
    authoritative: true,
    rows: [
      { id: 'web', label: '🔍 Web Search & Scraping', enabled: true, description: 'web_search, web_extract', toolCount: 2 },
      { id: 'terminal', label: '💻 Terminal & Processes', enabled: true, description: 'terminal, process', toolCount: 2 },
      { id: 'browser', label: '🌐 Browser Automation', enabled: false, description: 'navigate, click, type', toolCount: 4 },
    ],
  },
  mcpServers: {
    authoritative: true,
    rows: [
      { id: 'github-mcp', label: 'github-mcp', enabled: true, transport: 'stdio', toolCount: 9, online: true },
      { id: 'playwright', label: 'playwright', enabled: true, transport: 'http', toolCount: 21, online: undefined },
    ],
  },
};

const modelOptions = [
  { id: 'anthropic/claude-opus-4.8', name: 'Claude Opus 4.8', provider: 'anthropic', providerName: 'Anthropic' },
  { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'anthropic', providerName: 'Anthropic' },
  { id: 'openai/gpt-5.6', name: 'GPT-5.6', provider: 'openai', providerName: 'OpenAI' },
];

const roster = [
  { id: 'default', displayName: 'Hermes', model: '', isDefault: true, hasDraft: false },
  { id: 'arch', displayName: '架构老王', model: 'anthropic/claude-opus-4.8', isDefault: false, hasDraft: true },
  { id: 'frontend', displayName: '前端小张', model: 'openai/gpt-5.6', isDefault: false, hasDraft: false },
  { id: 'reviewer', displayName: '审查员', model: '', isDefault: false, hasDraft: false },
  { id: 'ops', displayName: '运维值守', model: '', isDefault: false, hasDraft: false },
];

function snapshot(theme) {
  return {
    isOpen: true,
    section: 'agents',
    theme,
    locale: 'zh',
    fontPrefs: { uiFont: 'geist-sans', monoFont: 'jetbrains-mono', sizeScale: 'medium' },
    activityVariant: 'cloud',
    profiles: { status: 'ready', data: roster.map((row) => ({ name: row.id, displayName: row.displayName, isDefault: row.isDefault })) },
    bots: roster.map((row) => ({ profile: row.id, displayName: row.displayName })),
    botManagement: {
      status: { status: 'idle', activeBotId: 'arch' },
      roster,
      activeBotId: 'arch',
      activeDetail: detail,
      availableModels: modelOptions,
      activeDraft: {
        displayName: '首席架构',
        description: detail.description,
        model: detail.model,
        provider: detail.provider,
        isDefault: false,
        soul: detail.soul,
        avatar: { kind: 'unchanged' },
        disabledSkills: ['dogfood'],
        enabledToolsets: ['web', 'terminal'],
        enabledMcpServers: ['github-mcp', 'playwright'],
      },
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
      highlightBotId: undefined,
    },
    scopedProfile: 'default',
    providerViews: { status: 'ready', data: [] },
    providerFailures: [],
    subscriptionCatalog: { status: 'ready', data: [] },
    customEndpoints: { status: 'ready', data: [] },
    endpointProfiles: {},
    endpointFailures: [],
    providerAdminBusy: false,
    mcp: { status: 'ready', data: [] },
    skills: { status: 'ready', data: [] },
    gateway: {
      url: 'http://127.0.0.1:9119', username: '', hasStoredPassword: false,
      profileName: 'default', status: 'connected', latencyMs: 12,
    },
    appVersion: '0.1.0',
    platform: 'win32',
    busy: false,
  };
}

function html(theme) {
  setLocale('zh-CN');
  const markup = renderToStaticMarkup(React.createElement(SettingsModal, { snapshot: snapshot(theme), actions }));
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
  /* 静态 SSR 没有 React 运行时，折叠区无法通过点击展开；视觉验证用同一套 Grid 契约强制展开。 */
  [data-bot-section] > div.grid { grid-template-rows: 1fr !important; }
  [data-bot-section] > div.grid > div { visibility: visible !important; }
</style>
</head>
<body>${markup}</body>
</html>`;
}

function startServer() {
  const server = http.createServer((request, response) => {
    const urlPath = decodeURIComponent((request.url || '/').split('?')[0]);
    if (urlPath === '/' || urlPath === '/light') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html(urlPath === '/light' ? 'jade-white' : 'obsidian-gold'));
      return;
    }
    const filePath = path.join(CSS_DIR, path.basename(urlPath));
    if (!fs.existsSync(filePath)) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    const mime = urlPath.endsWith('.css') ? 'text/css; charset=utf-8' : urlPath.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(response);
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

async function capture(url, outputPath, secondaryPath, tertiaryPath) {
  const browserPath = BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!browserPath) throw new Error('未找到 Edge/Chrome');
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const cdpPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  const userDataDir = path.resolve(os.tmpdir(), `flux-bot-panel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const proc = spawn(browserPath, [
    `--remote-debugging-port=${cdpPort}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,900',
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
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 1800, deviceScaleFactor: 1, mobile: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 折叠区由上面的静态 CSS 展开；这里只测量展开后的物理布局与第二步控件是否齐全。
    const probeResult = await send('Runtime.evaluate', {
      expression: `(() => {
        const slots = [...document.querySelectorAll('[data-bot-slot]')];
        const panel = document.querySelector('[data-bot-carousel]');
        const visible = slots.filter((node) => node.getAttribute('aria-hidden') !== 'true');
        const transforms = visible.map((node) => getComputedStyle(node).transform);
        const sections = [...document.querySelectorAll('[data-bot-section]')];
        const soulSection = document.querySelector('[data-bot-section="soul"]');
        const soulGrid = soulSection ? soulSection.querySelector('div.grid') : null;
        const model = document.querySelector('#bot-model');
        return {
          slots: slots.length,
          visibleSlots: visible.length,
          distinctTransforms: new Set(transforms).size,
          panelHeight: panel ? Math.round(panel.getBoundingClientRect().height) : 0,
          panelWidth: panel ? Math.round(panel.getBoundingClientRect().width) : 0,
          panelLeft: panel ? Math.round(panel.getBoundingClientRect().left) : 0,
          dialogWidth: document.querySelector('[data-testid="settings-dialog"]') ? Math.round(document.querySelector('[data-testid="settings-dialog"]').getBoundingClientRect().width) : 0,
          formWidth: document.querySelector('#bot-id') ? Math.round(document.querySelector('#bot-id').getBoundingClientRect().width) : 0,
          formLeft: document.querySelector('#bot-id') ? Math.round(document.querySelector('#bot-id').getBoundingClientRect().left) : 0,
          hasId: Boolean(document.querySelector('#bot-id')),
          hasName: Boolean(document.querySelector('#bot-display-name')),
          hasDescription: Boolean(document.querySelector('#bot-description')),
          hasModel: Boolean(model),
          modelGroups: model ? model.querySelectorAll('optgroup').length : 0,
          modelOptions: model ? model.querySelectorAll('option').length : 0,
          hasSoul: Boolean(document.querySelector('#bot-soul')),
          soulGridRows: soulGrid ? getComputedStyle(soulGrid).gridTemplateRows : '',
          sections: sections.length,
          openSections: sections.filter((node) => node.querySelector('button[aria-expanded="true"]')).length,
          capabilityRows: document.querySelectorAll('[data-bot-capability]').length,
          saveDisabled: [...document.querySelectorAll('button')].some((node) => node.textContent.includes('保存配置') && node.disabled),
          overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      })()`,
      returnByValue: true,
    });
    const value = probeResult.result.value;
    if (value.slots !== 5) throw new Error(`槽位必须固定 5 个，实际 ${value.slots}`);
    if (value.visibleSlots !== 5) throw new Error(`一行必须可见 5 个头像，实际 ${value.visibleSlots}`);
    if (value.distinctTransforms < 4) throw new Error(`槽位必须有近大远小的独立位移，实际只有 ${value.distinctTransforms} 种 transform`);
    if (value.panelHeight !== 148) throw new Error(`滑动视口必须 148px，实际 ${value.panelHeight}`);
    if (!value.hasId || !value.hasName || !value.hasDescription) throw new Error('基础身份字段缺失');
    if (value.overflowX) throw new Error('页面出现横向溢出');
    if (value.saveDisabled) throw new Error('存在草稿时保存按钮不得禁用');
    if (!value.hasModel || value.modelGroups < 2) throw new Error('模型下拉必须按 Provider 分组');
    if (!value.hasSoul) throw new Error('缺少 SOUL.md 编辑器');
    if (value.soulGridRows === '0px' || value.soulGridRows === '') throw new Error(`SOUL 抽屉展开失败，grid-template-rows=${value.soulGridRows}`);
    if (value.sections < 4) throw new Error(`能力矩阵折叠区缺失，实际 ${value.sections} 个`);
    if (value.capabilityRows < 6) throw new Error(`能力开关缺失，实际 ${value.capabilityRows} 个`);

    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(shot.data, 'base64'));

    // 第二张：滚到 SOUL/能力矩阵，证明第二步内容在真实 Blink 里可读、可点、无溢出。
    if (secondaryPath) {
      await send('Runtime.evaluate', {
        expression: `document.querySelector('[data-bot-section="soul"]').scrollIntoView({ block: 'start' })`,
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const lower = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      fs.writeFileSync(secondaryPath, Buffer.from(lower.data, 'base64'));
    }

    // 第三张：能力矩阵（工具集 / Skill / MCP / 长期记忆）。
    if (tertiaryPath) {
      await send('Runtime.evaluate', {
        expression: `document.querySelector('[data-bot-section="toolsets"]').scrollIntoView({ block: 'start' })`,
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const lower = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      fs.writeFileSync(tertiaryPath, Buffer.from(lower.data, 'base64'));
    }
    return value;
  } finally {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ id: 999999, method: 'Browser.close' }));
        await new Promise((resolve) => setTimeout(resolve, 300));
        ws.close();
      }
    } catch {
      // 收尾阶段的浏览器关闭失败不应覆盖已完成的断言。
    }
    try { proc.kill(); } catch {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
}

const server = await startServer();
const port = server.address().port;
try {
  const dark = await capture(
    `http://127.0.0.1:${port}/`,
    path.join(OUT_DIR, 'bot-panel-dark.png'),
    path.join(OUT_DIR, 'bot-panel-dark-soul.png'),
    path.join(OUT_DIR, 'bot-panel-dark-capabilities.png'),
  );
  const light = await capture(
    `http://127.0.0.1:${port}/light`,
    path.join(OUT_DIR, 'bot-panel-light.png'),
    path.join(OUT_DIR, 'bot-panel-light-soul.png'),
    path.join(OUT_DIR, 'bot-panel-light-capabilities.png'),
  );
  console.log(JSON.stringify({ dark, light }, null, 2));
} finally {
  server.close();
}
