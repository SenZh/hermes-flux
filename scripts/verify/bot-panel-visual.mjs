/**
 * BOT 面板静态视觉验证（真实 Blink + 真实 React SSR 产物 + 真实皮肤 CSS）。
 *
 * 【设计意图 (Why)】
 *   验证自适应 BOT 横向成员栏（>5 成员）、1:1 无外圈头像、身份主卡、双列能力矩阵、
 *   暗/亮两套皮肤与底部操作栏的真实计算几何与渲染质感。
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
import esbuild from 'esbuild';
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
      { id: 'codebase-inspection', label: 'codebase-inspection', enabled: true, description: '仓库源码检索与调用链定位' },
      { id: 'github', label: 'github', enabled: true, description: 'Pull Request、Issue 与 CI 协同' },
      { id: 'dogfood', label: 'dogfood', enabled: false, description: '端到端浏览器走查与回归复验' },
      ...Array.from({ length: 117 }, (_, index) => ({
        id: `skill-${String(index + 4).padStart(3, '0')}`,
        label: `hermes-skill-${String(index + 4).padStart(3, '0')}`,
        enabled: index % 3 !== 0,
        description: index % 2 === 0 ? '工作流扩展技能包与自动化编排' : '契约校验、代码审计与指标采集',
      })),
    ],
  },
  toolsets: {
    authoritative: true,
    rows: [
      { id: 'web', label: 'Web Search & Scraping', enabled: true, description: 'web_search, web_extract', toolCount: 2 },
      { id: 'terminal', label: 'Terminal & Processes', enabled: true, description: 'terminal, process', toolCount: 2 },
      { id: 'browser', label: 'Browser Automation', enabled: false, description: 'navigate, click, type', toolCount: 4 },
      { id: 'files', label: 'Filesystem & Search', enabled: true, description: 'read_file, search_files', toolCount: 5 },
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

const NON_SQUARE_AVATAR_DATA_URL =
  "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D'http%3A//www.w3.org/2000/svg'%20width%3D'200'%20height%3D'100'%20viewBox%3D'0%200%20200%20100'%3E%3Crect%20width%3D'200'%20height%3D'100'%20fill%3D'%23334155'/%3E%3Ccircle%20cx%3D'100'%20cy%3D'50'%20r%3D'32'%20fill%3D'%23e2e8f0'/%3E%3C/svg%3E";

const roster = [
  { id: 'default', displayName: 'Hermes', model: 'anthropic/claude-sonnet-5', isDefault: true, hasDraft: false },
  { id: 'arch', displayName: '架构老王', model: 'anthropic/claude-opus-4.8', isDefault: false, hasDraft: true },
  { id: 'frontend', displayName: '前端小张', model: 'openai/gpt-5.6', avatar: NON_SQUARE_AVATAR_DATA_URL, isDefault: false, hasDraft: false },
  { id: 'reviewer', displayName: '代码审查员', model: 'anthropic/claude-sonnet-5', isDefault: false, hasDraft: false },
  { id: 'ops', displayName: '运维值守', model: '', isDefault: false, hasDraft: false },
  { id: 'qa', displayName: '测试哨兵', model: '', isDefault: false, hasDraft: false },
  { id: 'docs', displayName: '文档工程师', model: '', isDefault: false, hasDraft: false },
];

function snapshot(theme) {
  return {
    isOpen: true,
    section: 'agents',
    theme,
    locale: 'zh',
    fontPrefs: { uiFont: 'geist-sans', monoFont: 'jetbrains-mono', sizeScale: 'medium' },
    activityVariant: 'cloud',
    conversationWidth: 'wide',
    presenceLayout: 'stage',
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
        disabledSkills: ['dogfood', ...Array.from({ length: 117 }, (_, index) => index).filter((i) => i % 3 === 0).map((i) => `skill-${String(i + 4).padStart(3, '0')}`)],
        enabledToolsets: ['web', 'terminal', 'files'],
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
</style>
</head>
<body>${markup}</body>
</html>`;
}

let dialogScrollBundlePromise = null;
async function getDialogScrollBundle() {
  if (!dialogScrollBundlePromise) {
    dialogScrollBundlePromise = esbuild.build({
      stdin: {
        contents: `
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { SkillInstallDialog, McpAddDialog, SettingsModal } from './packages/ui/dist/components-react/settings/index.js';
          import { applyFontPreferences } from './packages/ui/dist/tokens/fontPreferences.js';
          import { setLocale } from './packages/ui/dist/i18n/index.js';
          const params = new URLSearchParams(window.location.search);
          const kind = params.get('kind') || 'skill';
          if (kind === 'interactive') {
            setLocale('zh-CN');
            applyFontPreferences({ uiFont: 'geist-sans', monoFont: 'jetbrains-mono', sizeScale: 'medium' });
            const interactiveSnap = {
              isOpen: true,
              section: 'agents',
              theme: 'ayu-light',
              locale: 'zh',
              fontPrefs: { uiFont: 'geist-sans', monoFont: 'jetbrains-mono', sizeScale: 'medium' },
              activityVariant: 'cloud',
              conversationWidth: 'wide',
              presenceLayout: 'stage',
              profiles: {
                status: 'ready',
                data: [
                  { name: 'default', displayName: '大总管', isDefault: true, avatar: "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D'http%3A//www.w3.org/2000/svg'%20width%3D'64'%20height%3D'64'%3E%3Ccircle%20cx%3D'32'%20cy%3D'32'%20r%3D'32'%20fill%3D'%235FB978'/%3E%3C/svg%3E" },
                  { name: 'arch', displayName: '架构老王', isDefault: false },
                ],
              },
              bots: [{ profile: 'default', displayName: '大总管' }, { profile: 'arch', displayName: '架构老王' }],
              botManagement: {
                status: { status: 'idle', activeBotId: 'default' },
                roster: [
                  { id: 'default', displayName: '大总管', model: 'deepseek/deepseek-v4.1-flash', isDefault: true, hasDraft: false, avatar: "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D'http%3A//www.w3.org/2000/svg'%20width%3D'64'%20height%3D'64'%3E%3Ccircle%20cx%3D'32'%20cy%3D'32'%20r%3D'32'%20fill%3D'%235FB978'/%3E%3C/svg%3E" },
                  { id: 'arch', displayName: '架构老王', model: 'anthropic/claude-opus-4.8', isDefault: false, hasDraft: false },
                ],
                activeBotId: 'default',
                activeDetail: {
                  id: 'default',
                  displayName: '大总管',
                  description: '负责主工作区调度、需求拆解与跨端协调',
                  model: 'deepseek/deepseek-v4.1-flash',
                  provider: 'deepseek',
                  soul: '你是一名严谨的主控管家。',
                  avatar: "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D'http%3A//www.w3.org/2000/svg'%20width%3D'64'%20height%3D'64'%3E%3Ccircle%20cx%3D'32'%20cy%3D'32'%20r%3D'32'%20fill%3D'%235FB978'/%3E%3C/svg%3E",
                  isDefault: true,
                  skills: {
                    authoritative: true,
                    rows: [
                      { id: 'codebase-inspection', label: 'codebase-inspection', enabled: true, description: '仓库源码检索与调用链精确定位' },
                      { id: 'github', label: 'github', enabled: true, description: 'Pull Request、Issue 与 CI 协同' },
                      { id: 'dogfood', label: 'dogfood', enabled: false, description: '真实浏览器端到端回归测试' },
                    ],
                  },
                  toolsets: { authoritative: true, rows: [{ id: 'files', label: 'Filesystem', enabled: true, description: 'read_file, search_files', toolCount: 5 }] },
                  mcpServers: { authoritative: true, rows: [{ id: 'github-mcp', label: 'github-mcp', enabled: true, transport: 'stdio', toolCount: 9, online: true }] },
                },
                availableModels: [
                  { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', provider: 'deepseek', providerName: 'DeepSeek' },
                  { id: 'anthropic/claude-opus-4.8', name: 'Claude Opus 4.8', provider: 'anthropic', providerName: 'Anthropic' },
                  { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'anthropic', providerName: 'Anthropic' },
                  { id: 'openai/gpt-5.6', name: 'GPT-5.6', provider: 'openai', providerName: 'OpenAI' },
                  { id: 'cpa/gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'cpa', providerName: 'CPA 聚合代理' },
                ],
                isBusy: false,
                wizard: { open: false, draft: { mode: 'blank', name: '', displayName: '', description: '', model: '', provider: '', cloneFrom: '', cloneChannels: false, mirrorCredentials: false }, busy: false },
                exitPrompt: null,
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
              gateway: { url: 'http://127.0.0.1:9119', username: '', hasStoredPassword: false, profileName: 'default', status: 'connected', latencyMs: 12 },
              appVersion: '0.1.0',
              platform: 'win32',
              busy: false,
            };
            const interactiveActions = new Proxy({
              onInspectSkill: async (_profile, skillName) => ({
                ok: true,
                data: {
                  name: skillName,
                  description: '仓库源码检索与调用链精确定位',
                  source: 'official',
                  category: 'analysis',
                  tags: ['grep', 'ast', 'architecture'],
                  markdown: [
                    '---',
                    'name: codebase-inspection',
                    'description: 仓库源码检索与调用链精确定位',
                    'version: "2.1.0"',
                    '---',
                    '',
                    '# Codebase Inspection',
                    '',
                    '用于在复杂 Monorepo 中**快速定位入口、数据流与回归边界**。',
                    '',
                    '## 核心步骤',
                    '',
                    '- 检索导出符号与调用方链路',
                    '- 核对核心类型定义与单测覆盖',
                    '- 输出最小完整改动方案',
                    '',
                    '~~~typescript',
                    'export function traceCallSite(symbol: string): string[] {',
                    '  return ["core/" + symbol, "desktop/" + symbol];',
                    '}',
                    '~~~',
                    '',
                    '| 阶段 | 目标 | 验证手段 |',
                    '| --- | --- | --- |',
                    '| 定位 | 找到真值源 | git grep |',
                    '| 校验 | 全链绿灯 | npm run verify |',
                  ].join('\\n'),
                  isPreview: false,
                },
              }),
              onCopy: async () => true,
            }, {
              get: (target, prop) => (prop in target ? target[prop] : () => {}),
            });
            createRoot(document.getElementById('root')).render(
              React.createElement(SettingsModal, { snapshot: interactiveSnap, actions: interactiveActions }),
            );
          } else {
          const skills18 = Array.from({ length: 18 }, (_, i) => ({
            name: 'skill-' + String(i + 1).padStart(2, '0'),
            description: 'Scrollable skill description ' + (i + 1),
            source: 'official',
            installed: false,
          }));
          const mcp18 = Array.from({ length: 18 }, (_, i) => ({
            name: 'preset-' + String(i + 1).padStart(2, '0'),
            description: 'Scrollable MCP preset ' + (i + 1),
            requires: [],
            installed: false,
            enabled: false,
            transport: i % 2 === 0 ? 'stdio' : 'http',
          }));
          const root = createRoot(document.getElementById('root'));
          root.render(
            kind === 'mcp'
              ? React.createElement(McpAddDialog, {
                  open: true,
                  targetProfile: 'arch',
                  targetLabel: '架构老王',
                  installedNames: new Set(),
                  onFetchCatalog: async () => ({ ok: true, items: mcp18 }),
                  onAddServer: async () => ({ ok: true }),
                  onClose: () => {},
                  onNotify: () => {},
                })
              : React.createElement(SkillInstallDialog, {
                  open: true,
                  targetProfile: 'arch',
                  installedNames: new Set(),
                  onSearchSkills: async () => ({ ok: true, data: { rows: skills18, page: 1, totalPages: 1, total: 18 } }),
                  onInstallSkill: async () => ({ ok: true }),
                  onClose: () => {},
                  onNotify: () => {},
                }),
          );
          }
        `,
        resolveDir: ROOT,
        loader: 'js',
      },
      bundle: true,
      platform: 'browser',
      define: { 'process.env.NODE_ENV': '"production"' },
      write: false,
      format: 'iife',
    }).then((res) => res.outputFiles[0].text);
  }
  return dialogScrollBundlePromise;
}

function startServer() {
  const server = http.createServer(async (request, response) => {
    const urlPath = decodeURIComponent((request.url || '/').split('?')[0]);
    if (urlPath === '/dialog-scroll.js') {
      try {
        const code = await getDialogScrollBundle();
        response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        response.end(code);
      } catch (err) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(String(err));
      }
      return;
    }
    if (urlPath === '/dialog-scroll') {
      const theme = (request.url || '').includes('kind=interactive') ? 'ayu-light' : 'obsidian-gold';
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<!DOCTYPE html><html lang="zh-CN" data-theme="${theme}"><head><meta charset="UTF-8"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/conversation.css"><link rel="stylesheet" href="/tailwind.css"></head><body><div id="root"></div><script>window.__scrollErrs=[];window.addEventListener('error',e=>window.__scrollErrs.push(e.message));window.addEventListener('unhandledrejection',e=>window.__scrollErrs.push(String(e.reason)));</script><script defer src="/dialog-scroll.js"></script></body></html>`);
      return;
    }
    if (urlPath === '/' || urlPath === '/light' || urlPath === '/ayu-light') {
      const skin = urlPath === '/light' ? 'jade-white' : urlPath === '/ayu-light' ? 'ayu-light' : 'obsidian-gold';
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html(skin));
      return;
    }
    const relPath = urlPath.replace(/^\/+/, '');
    const filePath = path.resolve(CSS_DIR, relPath);
    if (!filePath.startsWith(CSS_DIR + path.sep) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    const mime = urlPath.endsWith('.css')
      ? 'text/css; charset=utf-8'
      : urlPath.endsWith('.woff2')
        ? 'font/woff2'
        : urlPath.endsWith('.svg')
          ? 'image/svg+xml'
          : 'application/octet-stream';
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
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    if (!outputPath) {
    // 专门验证 18 项真实列表场景下 SkillInstallDialog / McpAddDialog 滚动条真实可滚且不被 overflow-hidden 压缩裁切。
    const isMcp = url.includes('kind=mcp');
    const scrollSel = isMcp ? '[data-mcp-add-scroll="true"]' : '[data-skill-install-scroll="true"]';
    const deadline = Date.now() + 8000;
    let scrollReport = null;
    let lastDiag = null;
    while (Date.now() < deadline) {
      const evalRes = await send('Runtime.evaluate', {
        expression: `(() => {
          const box = document.querySelector('${scrollSel}');
          const surface = ${isMcp}
            ? [...document.querySelectorAll('[data-mcp-add-scroll="true"] > div > div > div')].at(-1) || null
            : document.querySelector('[data-skill-install-scroll="true"] > div > div');
          const rows = surface ? surface.children.length : 0;
          const diag = {
            hasBox: Boolean(box),
            hasSurface: Boolean(surface),
            rows,
            errs: window.__scrollErrs || [],
            rootSnippet: (document.getElementById('root')?.innerHTML || '').slice(0, 240),
          };
          if (!box || rows < 18) return { ready: false, diag };
          return {
            ready: true,
            clientHeight: box.clientHeight,
            scrollHeight: box.scrollHeight,
            surfaceHeight: surface ? Math.round(surface.getBoundingClientRect().height) : 0,
            rows,
            diag,
          };
        })()`,
        returnByValue: true,
      });
      const v = evalRes.result.value;
      lastDiag = v;
      if (v && v.ready) {
        scrollReport = v;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (
      !scrollReport ||
      scrollReport.scrollHeight <= scrollReport.clientHeight ||
      scrollReport.surfaceHeight <= scrollReport.clientHeight
    ) {
      throw new Error(`弹窗多行列表滚动被压缩裁切或未溢出 (${url}): ${JSON.stringify(scrollReport ?? lastDiag)}`);
    }
    return scrollReport;
  }

  const probeResult = await send('Runtime.evaluate', {
      expression: `(() => {
        const slots = [...document.querySelectorAll('[data-bot-slot]')];
        const avatars = [...document.querySelectorAll('[data-bot-avatar="true"]')];
        const avatarBoxes = avatars.map((node) => {
          const rect = node.getBoundingClientRect();
          const shadow = getComputedStyle(node).boxShadow;
          return {
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
            shadow,
          };
        });
        const imgAvatars = avatars.flatMap((node) => [...node.querySelectorAll('img')]).map((img) => {
          const rect = img.getBoundingClientRect();
          return {
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
            objectFit: getComputedStyle(img).objectFit,
          };
        });
        const panel = document.querySelector('[data-bot-carousel]');
        const railRect = panel ? panel.getBoundingClientRect() : null;
        const toggleBtn = document.querySelector('[data-bot-rail-toggle="true"]');
        const hasArrowIcon = Boolean(panel?.querySelector('svg.lucide-chevron-left, svg.lucide-chevron-right'));
        const topTabs = [...document.querySelectorAll('[data-bot-tab]')];
        const model = document.querySelector('#bot-model');
        const saveDock = document.querySelector('[data-bot-save-dock="true"]');
        return {
          slots: slots.length,
          railExpanded: panel ? panel.getAttribute('data-bot-rail-expanded') : null,
          railWidth: railRect ? Math.round(railRect.width) : 0,
          hasRailFilter: Boolean(document.querySelector('[data-bot-rail-filter="true"]')),
          hasRailToggle: Boolean(toggleBtn),
          hasArrowIcon,
          topTabsCount: topTabs.length,
          tabsWithDigits: topTabs.filter((n) => /\d/.test(n.textContent || '')).length,
          avatarsCount: avatars.length,
          imgAvatarsCount: imgAvatars.length,
          distortedImgAvatars: imgAvatars.filter((box) => Math.abs(box.width - box.height) > 0.5 || box.width === 0 || box.objectFit !== 'cover').length,
          distortedAvatars: avatarBoxes.filter((box) => Math.abs(box.width - box.height) > 0.5 || box.width === 0).length,
          avatarShadows: avatarBoxes.filter((box) => box.shadow && box.shadow !== 'none').length,
          panelHeight: railRect ? Math.round(railRect.height) : 0,
          dialogWidth: document.querySelector('[data-testid="settings-dialog"]') ? Math.round(document.querySelector('[data-testid="settings-dialog"]').getBoundingClientRect().width) : 0,
          hasId: Boolean(document.querySelector('#bot-id')),
          hasName: Boolean(document.querySelector('#bot-display-name')),
          hasDescription: Boolean(document.querySelector('#bot-description')),
          hasModel: Boolean(model),
          modelText: model ? model.textContent.trim() : '',
          hasSoul: Boolean(document.querySelector('#bot-soul')),
          hasSaveDock: Boolean(saveDock),
          skillsCapRows: document.querySelectorAll('[data-bot-section="skills"] [data-bot-capability]').length,
          mcpTestBtns: document.querySelectorAll('[data-mcp-test]').length,
          mcpRemoveBtns: document.querySelectorAll('[data-mcp-remove]').length,
          saveDisabled: [...document.querySelectorAll('button')].some((node) => node.textContent.includes('保存配置') && node.disabled),
          overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      })()`,
      returnByValue: true,
    });
    const value = probeResult.result.value;
    if (value.slots !== 7) throw new Error(`全量花名册应全部渲染（7 个），实际 ${value.slots}`);
    if (value.railExpanded !== 'true' || value.railWidth < 196 || value.railWidth > 212 || !value.hasRailFilter) {
      throw new Error(`BOT 列表默认应为 204px 展开态，实际 ${JSON.stringify(value)}`);
    }
    if (value.topTabsCount !== 5 || value.tabsWithDigits > 0) {
      throw new Error(`顶部菜单须扁平 5 项且零数字徽标，实际 count=${value.topTabsCount} digits=${value.tabsWithDigits}`);
    }
    if (!value.hasRailToggle) throw new Error('底部缺少展开/收起按钮');
    if (value.hasArrowIcon) throw new Error('折叠开关禁止出现箭头图标');
    if (value.avatarsCount < 8) throw new Error(`头像数量异常，实际 ${value.avatarsCount}`);
    if (value.imgAvatarsCount < 1) throw new Error('缺少真实图片头像验证用例');
    if (value.distortedImgAvatars > 0) throw new Error(`发现 ${value.distortedImgAvatars} 个拉伸变形的 <img> 头像`);
    if (value.distortedAvatars > 0) throw new Error(`发现 ${value.distortedAvatars} 个变形头像`);
    if (value.avatarShadows > 0) throw new Error(`头像外圈仍有 ${value.avatarShadows} 个 box-shadow ring`);
    if (!value.hasId || !value.hasName || !value.hasDescription) throw new Error('基础身份字段缺失');
    if (value.overflowX) throw new Error('页面出现横向溢出');
    if (!value.hasSaveDock || value.saveDisabled) throw new Error('存在草稿时悬浮保存胶囊须可见且按钮可点');
    if (!value.hasModel || !value.modelText) throw new Error('模型选择器回显异常');
    if (!value.hasSoul) throw new Error('缺少 SOUL.md 编辑器');
    if (value.skillsCapRows !== 120) throw new Error(`120 项技能清单应全量挂载，实际 ${value.skillsCapRows}`);
    if (value.mcpTestBtns < 2 || value.mcpRemoveBtns < 2) {
      throw new Error(`MCP 行内探活/删除按钮缺失，实际 test=${value.mcpTestBtns} remove=${value.mcpRemoveBtns}`);
    }

    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(shot.data, 'base64'));

    if (secondaryPath) {
      const soulCheck = await send('Runtime.evaluate', {
        expression: `(() => {
          const bTab = document.querySelector('[data-bot-tab="basic"]');
          const sTab = document.querySelector('[data-bot-tab="soul"]');
          const line = bTab?.querySelector('span[aria-hidden]');
          if (line && sTab) { sTab.appendChild(line); bTab.className = bTab.className.replace('font-semibold text-foreground', 'font-medium text-muted-foreground'); sTab.className = sTab.className.replace('font-medium text-muted-foreground', 'font-semibold text-foreground'); }
          document.querySelector('[data-bot-tabpanel="basic"]').className = 'hidden';
          const soulTab = document.querySelector('[data-bot-tabpanel="soul"]');
          soulTab.className = 'flex min-h-0 flex-1 flex-col px-6 pb-20 pt-4';
          const editor = document.querySelector('#bot-soul');
          const gutterLines = soulTab.querySelectorAll('.select-none > div').length;
          return {
            editorHeight: editor ? Math.round(editor.getBoundingClientRect().height) : 0,
            gutterLines,
          };
        })()`,
        returnByValue: true,
      });
      if (soulCheck.result.value.editorHeight < 180 || soulCheck.result.value.gutterLines < 14) {
        throw new Error(`Studio SOUL 编辑器异常: ${JSON.stringify(soulCheck.result.value)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      const lower = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      fs.writeFileSync(secondaryPath, Buffer.from(lower.data, 'base64'));
    }

    if (tertiaryPath) {
      const capsCheck = await send('Runtime.evaluate', {
        expression: `(() => {
          const prevTab = document.querySelector('[data-bot-tab="soul"] span[aria-hidden]')
            ? document.querySelector('[data-bot-tab="soul"]')
            : document.querySelector('[data-bot-tab="basic"]');
          const kTab = document.querySelector('[data-bot-tab="skills"]');
          const line = prevTab?.querySelector('span[aria-hidden]');
          if (line && kTab) { kTab.appendChild(line); prevTab.className = prevTab.className.replace('font-semibold text-foreground', 'font-medium text-muted-foreground'); kTab.className = kTab.className.replace('font-medium text-muted-foreground', 'font-semibold text-foreground'); }
          document.querySelector('[data-bot-tabpanel="basic"]').className = 'hidden';
          document.querySelector('[data-bot-tabpanel="soul"]').className = 'hidden';
          const skillsPanel = document.querySelector('[data-bot-tabpanel="skills"]');
          skillsPanel.className = 'flex min-h-0 flex-1 flex-col overflow-hidden px-6 pt-4';
          return {
            visibleSkills: [...skillsPanel.querySelectorAll('[data-bot-capability]')].filter((el) => el.getBoundingClientRect().height > 0).length,
            capRowsCount: skillsPanel.querySelectorAll('[data-bot-capability-row]').length,
            borderedCapRows: [...skillsPanel.querySelectorAll('[data-bot-capability-row]')].filter((el) => {
              const cs = getComputedStyle(el);
              return cs.borderTopWidth !== '0px' || cs.borderRightWidth !== '0px' || cs.borderBottomWidth !== '0px' || cs.borderLeftWidth !== '0px';
            }).length,
          };
        })()`,
        returnByValue: true,
      });
      if (capsCheck.result.value.visibleSkills !== 120 || capsCheck.result.value.capRowsCount !== 120) {
        throw new Error(`技能分页应直接渲染 120 条可见技能，实测 ${JSON.stringify(capsCheck.result.value)}`);
      }
      if (capsCheck.result.value.borderedCapRows > 0) {
        throw new Error(`已选中的 skill/MCP 行禁止绘制外框，实测 ${capsCheck.result.value.borderedCapRows} 行带边框`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
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

await getDialogScrollBundle();
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
  const ayuLight = await capture(
    `http://127.0.0.1:${port}/ayu-light`,
    path.join(OUT_DIR, 'bot-panel-ayu-light.png'),
    null,
    path.join(OUT_DIR, 'bot-panel-ayu-light-skills.png'),
  );
  const skillScroll = await capture(`http://127.0.0.1:${port}/dialog-scroll?kind=skill`, null, null, null);
  const mcpScroll = await capture(`http://127.0.0.1:${port}/dialog-scroll?kind=mcp`, null, null, null);

  // CSR 真实交互验收：模型双图标下拉框（宽度、厂商+模型图标、Esc 防穿透）+ 技能简介 + 点击查看完整 Markdown（优雅预览 vs 原始源码）
  const browserPath = BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  const probeSrv = http.createServer();
  await new Promise((resolve) => probeSrv.listen(0, '127.0.0.1', resolve));
  const cdpPort = probeSrv.address().port;
  await new Promise((resolve) => probeSrv.close(resolve));
  const interactiveDir = path.resolve(os.tmpdir(), `flux-bot-int-${Date.now()}`);
  const interactiveUrl = `http://127.0.0.1:${port}/dialog-scroll?kind=interactive`;
  const proc = spawn(browserPath, [
    `--remote-debugging-port=${cdpPort}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${interactiveDir}`,
    '--window-size=1440,900',
    interactiveUrl,
  ], { stdio: 'ignore' });
  let interactiveReport = null;
  let intWs = null;
  try {
    const wsUrl = await waitForTarget(cdpPort);
    intWs = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      intWs.addEventListener('open', resolve);
      intWs.addEventListener('error', reject);
    });
    let seq = 1;
    const sendInt = (method, params = {}) => new Promise((resolve, reject) => {
      const id = seq++;
      const handler = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id !== id) return;
        intWs.removeEventListener('message', handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      };
      intWs.addEventListener('message', handler);
      intWs.send(JSON.stringify({ id, method, params }));
    });
    await sendInt('Page.enable');
    await sendInt('Page.navigate', { url: interactiveUrl });
    await sendInt('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 1200));

    // 1. 打开模型下拉浮层，校验触发器双图标 + 浮层厂商/模型图标 + 宽度
    await sendInt('Runtime.evaluate', { expression: `document.querySelector('#bot-model')?.click()`, returnByValue: true });
    await new Promise((r) => setTimeout(r, 250));
    const modelCheck = await sendInt('Runtime.evaluate', {
      expression: `(() => {
        const dlg = document.querySelector('[data-testid="settings-dialog"]');
        const trig = document.querySelector('#bot-model');
        const pop = document.querySelector('[data-grouped-model-popover="true"]');
        const trigIcons = trig ? trig.querySelectorAll('.vendor-icon').length : 0;
        const popGroupIcons = pop ? pop.querySelectorAll('[data-model-group] .vendor-icon').length : 0;
        const popOptIcons = pop ? pop.querySelectorAll('[data-model-option] .vendor-icon').length : 0;
        const tRect = trig ? trig.getBoundingClientRect() : null;
        const pRect = pop ? pop.getBoundingClientRect() : null;
        return {
          trigWidth: tRect ? Math.round(tRect.width) : 0,
          popWidth: pRect ? Math.round(pRect.width) : 0,
          trigLeft: tRect ? Math.round(tRect.left) : 0,
          popLeft: pRect ? Math.round(pRect.left) : 0,
          dialogScrollLeft: dlg ? Math.round(dlg.scrollLeft) : 0,
          trigIcons,
          popGroupIcons,
          popOptIcons,
          hasSearch: Boolean(document.querySelector('[data-grouped-model-search="true"]')),
        };
      })()`,
      returnByValue: true,
    });
    const mc = modelCheck.result.value;
    if (
      !mc.popWidth ||
      mc.popWidth < 360 ||
      mc.dialogScrollLeft !== 0 ||
      Math.abs(mc.popLeft - mc.trigLeft) > 2 ||
      mc.trigIcons < 2 ||
      mc.popGroupIcons < 4 ||
      mc.popOptIcons < 5 ||
      !mc.hasSearch
    ) {
      throw new Error(`模型选择器视觉与双图标断言失败: ${JSON.stringify(mc)}`);
    }
    const modelShot = await sendInt('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(OUT_DIR, 'bot-panel-model-dropdown.png'), Buffer.from(modelShot.data, 'base64'));

    // Esc 关闭模型浮层但不能关闭整个设置弹窗
    await sendInt('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sendInt('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await new Promise((r) => setTimeout(r, 150));
    const afterEsc = await sendInt('Runtime.evaluate', {
      expression: `({ popoverOpen: Boolean(document.querySelector('[data-grouped-model-popover="true"]')), modalOpen: Boolean(document.querySelector('[data-testid="settings-dialog"]')) })`,
      returnByValue: true,
    });
    if (afterEsc.result.value.popoverOpen || !afterEsc.result.value.modalOpen) {
      throw new Error(`模型下拉 Esc 分层失败: ${JSON.stringify(afterEsc.result.value)}`);
    }

    // 2. 切到「技能」Tab：断言 Switch 绝对不是蓝色（ayu-light #4AA8C8 为 rgb(74, 168, 200)）+ 技能简介可见 + 打开详情
    await sendInt('Runtime.evaluate', { expression: `document.querySelector('[data-bot-tab="skills"]')?.click()`, returnByValue: true });
    await new Promise((r) => setTimeout(r, 250));
    const skillsCheck = await sendInt('Runtime.evaluate', {
      expression: `(() => {
        const sw = document.querySelector('[data-bot-section="skills"] [data-state="checked"]');
        const swBg = sw ? getComputedStyle(sw).backgroundColor : '';
        const text = document.querySelector('[data-bot-section="skills"]')?.textContent || '';
        return { swBg, hasDesc: text.includes('仓库源码检索与调用链精确定位') };
      })()`,
      returnByValue: true,
    });
    if (!skillsCheck.result.value.hasDesc || skillsCheck.result.value.swBg === 'rgb(74, 168, 200)') {
      throw new Error(`技能开关或简介校验失败: ${JSON.stringify(skillsCheck.result.value)}`);
    }

    await sendInt('Runtime.evaluate', { expression: `document.querySelector('[data-bot-capability-inspect="codebase-inspection"]')?.click()`, returnByValue: true });
    await new Promise((r) => setTimeout(r, 350));
    const renderedCheck = await sendInt('Runtime.evaluate', {
      expression: `(() => {
        const box = document.querySelector('[data-skill-markdown-rendered="true"]');
        return {
          hasRendered: Boolean(box),
          hasHeading: Boolean(box?.querySelector('h1')),
          hasCodeBlock: Boolean(box?.querySelector('pre code')),
          hasFrontmatterTable: Boolean(box?.textContent?.includes('version')),
          hasRawPre: Boolean(document.querySelector('[data-skill-markdown-raw="true"]')),
        };
      })()`,
      returnByValue: true,
    });
    if (!renderedCheck.result.value.hasRendered || !renderedCheck.result.value.hasHeading || !renderedCheck.result.value.hasCodeBlock || renderedCheck.result.value.hasRawPre) {
      throw new Error(`技能 Markdown 优雅预览失败: ${JSON.stringify(renderedCheck.result.value)}`);
    }
    const skillRenderedShot = await sendInt('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(OUT_DIR, 'bot-panel-skill-rendered.png'), Buffer.from(skillRenderedShot.data, 'base64'));

    await sendInt('Runtime.evaluate', { expression: `document.querySelector('[data-skill-detail-dialog="true"] [data-segmented-value="raw"]')?.click()`, returnByValue: true });
    await new Promise((r) => setTimeout(r, 250));
    const rawCheck = await sendInt('Runtime.evaluate', {
      expression: `(() => {
        const pre = document.querySelector('[data-skill-markdown-raw="true"]');
        return {
          hasRawPre: Boolean(pre),
          hasFrontmatterDashes: Boolean(pre?.textContent?.includes('---')),
          hasRendered: Boolean(document.querySelector('[data-skill-markdown-rendered="true"]')),
        };
      })()`,
      returnByValue: true,
    });
    if (!rawCheck.result.value.hasRawPre || !rawCheck.result.value.hasFrontmatterDashes || rawCheck.result.value.hasRendered) {
      throw new Error(`技能 Markdown 原始源码切换失败: ${JSON.stringify(rawCheck.result.value)}`);
    }
    const skillRawShot = await sendInt('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(OUT_DIR, 'bot-panel-skill-raw.png'), Buffer.from(skillRawShot.data, 'base64'));

    interactiveReport = { mc, afterEsc: afterEsc.result.value, skillsCheck: skillsCheck.result.value, renderedCheck: renderedCheck.result.value, rawCheck: rawCheck.result.value };
  } finally {
    try { if (intWs && intWs.readyState === WebSocket.OPEN) { intWs.send(JSON.stringify({ id: 999999, method: 'Browser.close' })); await new Promise((r) => setTimeout(r, 200)); intWs.close(); } } catch {}
    try { proc.kill(); } catch {}
    try { fs.rmSync(interactiveDir, { recursive: true, force: true }); } catch {}
  }

  console.log(JSON.stringify({ dark, light, ayuLight, dialogScroll: { skillScroll, mcpScroll }, interactiveReport }, null, 2));
} finally {
  server.close();
}
