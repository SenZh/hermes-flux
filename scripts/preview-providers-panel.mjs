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

const agent = (profile, displayName, state) => ({ profile, displayName, state });

const fnView = {
  key: 'custom:fn',
  kind: 'custom',
  id: 'fn',
  name: 'fn',
  models: ['gpt-5.4', 'claude-opus-4.6', 'deepseek-v4', 'qwen3-max', 'kimi-k2', 'glm-5', 'grok-4', 'gemini-3-pro', 'o4-mini', 'sonnet-4.5', 'haiku-4.5'],
  detail: 'https://llm.internal/v1',
  availability: 'active',
  agents: [
    agent('default', 'default', 'active'),
    agent('aura', 'aura', 'active'),
    agent('codeboy', 'codeboy', 'active'),
    agent('xiaofawang', 'xiaofawang', 'active'),
    agent('mobile', 'mobile', 'active'),
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
  ],
};

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
    { profile: 'default', displayName: 'default' },
    { profile: 'aura', displayName: 'aura' },
    { profile: 'codeboy', displayName: 'codeboy' },
    { profile: 'xiaofawang', displayName: 'xiaofawang' },
    { profile: 'mobile', displayName: 'mobile' },
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
