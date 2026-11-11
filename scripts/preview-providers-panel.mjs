/**
 * 可交互的提供商面板预览（真实 React 组件 + 真实 CSS）。
 *
 * 【为什么需要】"编辑按钮打不开""删除不生效""使用是什么意思"这三条都是**交互**问题，
 *   静态 SSR 无法证明修好了。这里用同一个 ProvidersAdminPanel 真挂载 React，
 *   让浏览器可以真实点击，截图才有意义。
 *
 * 【约束】只用于验证，不进入产品产物。
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ProvidersAdminPanel } from '../packages/ui/dist/components-react/settings/ProvidersAdminPanel.js';
import { setLocale } from '../packages/ui/dist/i18n/index.js';

setLocale('zh-CN');

const agent = (profile, displayName, state, detail) => ({ profile, displayName, state, ...(detail ? { detail } : {}) });

const fnView = {
  key: 'custom:fn',
  kind: 'custom',
  id: 'fn',
  name: 'fn',
  models: ['gpt-5.4', 'claude-opus-4.6', 'deepseek-v4', 'qwen3-max', 'kimi-k2', 'glm-5', 'grok-4', 'gemini-3-pro', 'o4-mini', 'sonnet-4.5', 'haiku-4.5'],
  detail: 'https://llm.internal/v1',
  availability: 'active',
  agents: [
    agent('default', 'default', 'active', 'gpt-5.4'),
    agent('aura', 'aura', 'active', 'gpt-5.4'),
    agent('codeboy', 'codeboy', 'active', 'gpt-5.4'),
    agent('xiaofawang', 'xiaofawang', 'active', 'gpt-5.4'),
    agent('mobile', 'mobile', 'active', 'gpt-5.4'),
    agent('ops', 'ops', 'ready'),
    agent('writer', 'writer', 'absent'),
  ],
};

const cpaView = {
  key: 'custom:cpa',
  kind: 'custom',
  id: 'cpa',
  name: 'cpa',
  models: ['claude-opus-4.6'],
  detail: 'https://cpa.internal.example/v1',
  availability: 'ready',
  agents: [
    agent('default', 'default', 'ready'),
    agent('aura', 'aura', 'ready'),
    agent('codeboy', 'codeboy', 'ready'),
    agent('xiaofawang', 'xiaofawang', 'absent'),
    agent('mobile', 'mobile', 'absent'),
    agent('ops', 'ops', 'ready'),
    agent('writer', 'writer', 'absent'),
  ],
};

const xaiView = {
  key: 'subscription:xai-oauth',
  kind: 'subscription',
  id: 'xai-oauth',
  name: 'xAI Grok OAuth',
  models: ['grok-4', 'grok-4-fast', 'grok-code-fast-1'],
  detail: 'SuperGrok · /opt/data/auth.json',
  availability: 'ready',
  agents: [
    agent('default', 'default', 'ready'),
    agent('aura', 'aura', 'ready'),
    agent('codeboy', 'codeboy', 'ready'),
    agent('xiaofawang', 'xiaofawang', 'ready'),
    agent('mobile', 'mobile', 'ready'),
    agent('ops', 'ops', 'ready'),
    agent('writer', 'writer', 'ready'),
  ],
};

const avatar = (bg, accent) => `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${bg}"/><circle cx="32" cy="25" r="11" fill="${accent}"/><path d="M11 61c3-13 11-19 21-19s18 6 21 19" fill="${accent}"/></svg>`,
)}`;

const snapshot = {
  isOpen: true,
  section: 'providers',
  theme: 'obsidian-gold',
  locale: 'zh',
  fontPrefs: { uiFont: 'geist-sans', monoFont: 'jetbrains-mono', sizeScale: 'medium' },
  profiles: { status: 'ready', data: [] },
  mcp: { status: 'ready', data: [] },
  skills: { status: 'ready', data: [] },
  bots: [
    { profile: 'default', displayName: 'default', avatar: avatar('#4B5A6B', '#D7E0EA') },
    { profile: 'aura', displayName: 'aura', avatar: avatar('#6B5A4B', '#EADFD2') },
    { profile: 'codeboy', displayName: 'codeboy', avatar: avatar('#4B6B5A', '#D2EADF') },
    { profile: 'xiaofawang', displayName: 'xiaofawang', avatar: avatar('#5A4B6B', '#DFD2EA') },
    { profile: 'mobile', displayName: 'mobile', avatar: avatar('#6B4B5A', '#EAD2DF') },
    { profile: 'ops', displayName: 'ops', avatar: avatar('#4B6B6B', '#D2EAEA') },
    { profile: 'writer', displayName: 'writer', avatar: avatar('#6B6B4B', '#EAEAD2') },
  ],
  scopedProfile: 'default',
  providerViews: { status: 'ready', data: [fnView, cpaView, xaiView] },
  providerFailures: [],
  subscriptionCatalog: {
    status: 'ready',
    data: [
      { id: 'nous', name: 'Nous Portal', flow: 'device_code', loggedIn: false, freeTier: false },
      { id: 'openai-codex', name: 'ChatGPT or Codex Subscription', flow: 'device_code', loggedIn: false, freeTier: false },
      { id: 'qwen-oauth', name: 'Qwen (via Qwen CLI)', flow: 'external', loggedIn: false, freeTier: false, cliCommand: 'qwen login' },
    ],
  },
  customEndpoints: {
    status: 'ready',
    data: [
      {
        id: 'fn',
        name: 'fn',
        baseUrl: 'https://llm.internal/v1',
        model: 'gpt-5.4',
        models: fnView.models,
        apiMode: '',
        discoverModels: true,
        hasApiKey: true,
        isCurrent: true,
        source: 'providers',
      },
      {
        id: 'cpa',
        name: 'cpa',
        baseUrl: 'https://cpa.internal.example/v1',
        model: 'claude-opus-4.6',
        models: cpaView.models,
        apiMode: '',
        discoverModels: true,
        hasApiKey: true,
        isCurrent: false,
        source: 'providers',
      },
    ],
  },
  providerAdminBusy: false,
  gateway: {
    url: 'https://fn.hermesflux.com:1519',
    username: 'zhangsen',
    hasStoredPassword: true,
    profileName: 'default',
    status: 'connected',
    latencyMs: 18,
  },
  platform: 'win32',
  busy: false,
};

const log = [];
const actions = new Proxy(
  {
    onNotify: (message) => log.push(['notify', message]),
    onReloadProviders: () => log.push(['reload']),
  },
  {
    get: (target, prop) => {
      if (prop in target) return target[prop];
      return (...args) => {
        log.push([String(prop), args]);
        return Promise.resolve({ ok: true });
      };
    },
  },
);

window.__previewLog = log;
// 交互验证需要临时改写动作结果（例如模拟"没有可复用密钥"的分支）。
window.__previewActions = actions;

// 把运行时错误直接暴露到标题上：验证页面没有 DevTools，否则"点了没反应"只能靠猜。
window.addEventListener('error', (event) => {
  document.title = `ERR: ${event.message}`;
  log.push(['window.error', event.message]);
});
window.addEventListener('unhandledrejection', (event) => {
  document.title = `REJ: ${String(event.reason)}`;
  log.push(['unhandledrejection', String(event.reason)]);
});

const root = createRoot(document.getElementById('preview-root'));
function Preview() {
  return React.createElement(
    'div',
    { className: 'flux-settings p-6', 'data-theme': 'obsidian-gold' },
    React.createElement(ProvidersAdminPanel, { snapshot, actions }),
  );
}
root.render(React.createElement(Preview));
