import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsModal } from '../dist/components-react/settings/SettingsModal.js';
import {
  SETTINGS_SECTIONS,
  filterSettingsSections,
  resolveSettingsSection,
} from '../dist/components-react/settings/settingsModel.js';
import { setLocale, t } from '../dist/i18n/index.js';

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

function snapshot(overrides = {}) {
  return {
    isOpen: true,
    section: 'appearance',
    theme: 'obsidian-gold',
    locale: 'zh',
    fontPrefs: { uiFont: 'geist-sans', monoFont: 'jetbrains-mono', sizeScale: 'medium' },
    providers: { status: 'idle' },
    profiles: { status: 'idle' },
    mcp: { status: 'idle' },
    skills: { status: 'idle' },
    gateway: {
      url: 'http://127.0.0.1:9119',
      username: '',
      hasStoredPassword: false,
      profileName: 'default',
      status: 'connected',
      latencyMs: 18,
    },
    appVersion: '0.1.0',
    platform: 'windows',
    busy: false,
    ...overrides,
  };
}

const noopActions = {
  onClose() {},
  onSelectSection() {},
  onThemeChange() {},
  onLocaleChange() {},
  onFontPrefsChange() {},
  onRefreshProviders() {},
  onSaveProviderKey: async () => ({ ok: true }),
  onDisconnectProvider: async () => ({ ok: true }),
  onRefreshProfiles() {},
  onOpenAgent() {},
  onRefreshExtensions() {},
  onReloadSkills: async () => ({ ok: true }),
  onTestGateway() {},
  onConnectGateway() {},
  onDisconnectGateway() {},
};

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(SettingsModal, { snapshot: snapshot(overrides), actions: noopActions }));
}

test('设置中心关闭时必须渲染空 DOM（不保留隐藏壳）', () => {
  setLocale('zh-CN');
  assert.equal(render({ isOpen: false }), '');
});

test('导航只有真实能力域：不出现竞品分组名，也不出现任何占位域', () => {
  setLocale('zh-CN');
  const html = render();
  assert.equal(SETTINGS_SECTIONS.length, 6);
  for (const section of SETTINGS_SECTIONS) {
    assert.ok(html.includes(`data-settings-section="${section.id}"`), `缺少导航项 ${section.id}`);
  }
  for (const banned of ['OPENCHAMBER', 'tunnels', 'websearch', 'notifications', 'usage', 'keybindings']) {
    assert.equal(html.includes(banned), false, `导航不得残留竞品域 ${banned}`);
  }
  assert.equal(html.includes(t('settings.sectionAppearance')), true);
});

test('图标必须是 lucide 描边 SVG，不得出现任何 emoji', () => {
  setLocale('zh-CN');
  const html = render();
  assert.ok(html.includes('<svg'), '设置页必须使用 lucide SVG 图标');
  assert.equal(EMOJI.test(html), false, '设置页不得出现 emoji 图标（与全站图标语言冲突）');
});

test('外观页渲染真实皮肤真值表：五张皮肤卡，激活态互斥', () => {
  setLocale('zh-CN');
  const html = render({ section: 'appearance', theme: 'ayu-light' });
  for (const id of ['obsidian-gold', 'jade-white', 'warm-paper', 'ayu-light', 'cyber-matrix']) {
    assert.ok(html.includes(`data-theme-option="${id}"`), `缺少皮肤 ${id}`);
  }
  const active = html.match(/aria-checked="true" data-theme-option="([^"]+)"/);
  assert.ok(active, '必须恰好有一个皮肤被标记为选中');
  assert.equal(active[1], 'ayu-light');
  assert.equal((html.match(/aria-checked="true"/g) || []).length, 1, '皮肤选中态必须互斥');
  assert.ok(html.includes('id="settings-ui-font"'));
  assert.ok(html.includes('id="settings-mono-font"'));
});

test('提供商页只渲染网关快照，未配置的提供商同样可见且带密钥入口', () => {
  setLocale('zh-CN');
  const html = render({
    section: 'providers',
    providers: {
      status: 'ready',
      data: [
        { slug: 'anthropic', name: 'Anthropic', authenticated: true, availableModelCount: 12, accounts: [], freeTier: false, isCurrent: true },
        {
          slug: 'deepseek',
          name: 'DeepSeek',
          authenticated: false,
          availableModelCount: 3,
          keyEnv: 'DEEPSEEK_API_KEY',
          warning: 'quota exhausted',
          accounts: [{ id: 'k1', state: 'limited' }],
          freeTier: false,
          isCurrent: false,
        },
      ],
    },
  });
  assert.ok(html.includes('data-provider-slug="anthropic"'));
  assert.ok(html.includes('data-provider-slug="deepseek"'));
  assert.ok(html.includes('DEEPSEEK_API_KEY'), '必须告诉用户密钥落到哪个环境变量');
  assert.ok(html.includes('quota exhausted'), '网关告警必须原样透出');
  assert.ok(html.includes(t('settings.providerAddKey')), '未认证的提供商必须给出配置密钥入口');
  assert.ok(html.includes(t('settings.providerCurrent')));
  for (const fake of ['jev', 'agnes-ai', 'magpie', 'ipraft', 'vpi']) {
    assert.equal(html.includes(fake), false, `不得出现硬编码的假提供商 ${fake}`);
  }
});

test('提供商列表排序：当前使用优先，其次已配置，未配置排在最后', () => {
  setLocale('zh-CN');
  const html = render({
    section: 'providers',
    providers: {
      status: 'ready',
      data: [
        { slug: 'zeta', name: 'Zeta', authenticated: false, availableModelCount: 0, accounts: [], freeTier: false, isCurrent: false },
        { slug: 'beta', name: 'Beta', authenticated: true, availableModelCount: 4, accounts: [], freeTier: false, isCurrent: false },
        { slug: 'alpha', name: 'Alpha', authenticated: true, availableModelCount: 9, accounts: [], freeTier: false, isCurrent: true },
      ],
    },
  });
  const order = [...html.matchAll(/data-provider-slug="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(order, ['alpha', 'beta', 'zeta']);
});

test('提供商页三态显式：空态与失败态不能长成同一张脸', () => {  setLocale('zh-CN');
  const empty = render({ section: 'providers', providers: { status: 'ready', data: [] } });
  assert.ok(empty.includes(t('settings.providersEmpty')));

  const failed = render({ section: 'providers', providers: { status: 'error', message: 'socket closed' } });
  assert.ok(failed.includes(t('settings.loadFailed')));
  assert.ok(failed.includes('socket closed'), '失败必须带原始原因（Failure Is Not Empty）');
  assert.ok(failed.includes(t('settings.retry')));
  assert.equal(failed.includes(t('settings.providersEmpty')), false);
});

test('连接页表单值来自快照，且给出真实连接状态', () => {
  setLocale('zh-CN');
  const html = render({ section: 'connection' });
  assert.ok(html.includes('id="settings-gateway-url"'));
  assert.ok(html.includes('http://127.0.0.1:9119'));
  assert.ok(html.includes(t('settings.gatewayConnected')));
  assert.ok(html.includes('18ms'));
  assert.ok(html.includes(t('settings.testConnection')));
  assert.ok(html.includes(t('settings.saveAndConnect')));
});

test('扩展页分别渲染 MCP 运行态与技能清单', () => {
  setLocale('zh-CN');
  const html = render({
    section: 'extensions',
    mcp: { status: 'ready', data: [{ name: 'github', transport: 'stdio', toolCount: 7, connected: true, disabled: false, status: 'connected' }] },
    skills: { status: 'ready', data: [{ name: 'code-review', category: 'builtin' }] },
  });
  assert.ok(html.includes('github'));
  assert.ok(html.includes('code-review'));
  assert.ok(html.includes(t('settings.mcpToolCount', { count: 7 })));
});

test('数字员工页只读展示真实档案，并提供打开编辑器入口', () => {
  setLocale('zh-CN');
  const html = render({
    section: 'agents',
    profiles: { status: 'ready', data: [{ name: 'default', displayName: 'Hermes', isDefault: true }] },
  });
  assert.ok(html.includes('Hermes'));
  assert.ok(html.includes(t('settings.agentDefault')));
  assert.ok(html.includes(t('settings.agentNoModel')));
  assert.ok(html.includes(t('settings.agentOpen')));
});

test('语言切换是真实生效的：同一份快照在两种 locale 下文案不同', () => {
  const zh = render({ locale: 'zh', section: 'about' });
  setLocale('en-US');
  const en = render({ locale: 'en', section: 'about' });
  setLocale('zh-CN');
  assert.notEqual(zh, en);
  assert.ok(zh.includes(t('settings.title')));
  assert.ok(en.includes('Settings'));
});

test('设置域注册表：未知 section 回落到第一个域，检索按当前语言过滤', () => {
  assert.equal(resolveSettingsSection('providers'), 'providers');
  assert.equal(resolveSettingsSection('tunnels'), 'appearance');
  assert.equal(resolveSettingsSection(undefined), 'appearance');

  setLocale('zh-CN');
  const translate = (key) => t(key);
  assert.equal(filterSettingsSections(SETTINGS_SECTIONS, '', translate).length, 6);
  assert.deepEqual(
    filterSettingsSections(SETTINGS_SECTIONS, '提供商', translate).map((section) => section.id),
    ['providers'],
  );
  assert.deepEqual(filterSettingsSections(SETTINGS_SECTIONS, 'zzz', translate), []);
  setLocale('en-US');
  assert.deepEqual(
    filterSettingsSections(SETTINGS_SECTIONS, 'extension', translate).map((section) => section.id),
    ['extensions'],
  );
  setLocale('zh-CN');
});


test('行级操作结局：成功清空草稿、失败保留、取消不打扰', async () => {
  const { resolveProviderRowOutcome } = await import('../dist/components-react/settings/settingsModel.js');
  assert.equal(resolveProviderRowOutcome({ ok: true }), 'clear');
  assert.equal(resolveProviderRowOutcome({ ok: false, message: 'bad key' }), 'keep');
  assert.equal(resolveProviderRowOutcome({ ok: false, cancelled: true }), 'ignore');
  assert.equal(resolveProviderRowOutcome({ ok: false, cancelled: true, message: 'x' }), 'ignore', '取消优先于错误文案');
});

test('提供商行状态机：保存成功清空、失败保留草稿、取消不报错', async () => {
  const { providerRowReducer, PROVIDER_ROW_INITIAL } = await import('../dist/components-react/settings/settingsModel.js');
  const typing = providerRowReducer(PROVIDER_ROW_INITIAL, { type: 'toggleEditing' });
  const withDraft = providerRowReducer(typing, { type: 'draftChange', value: 'sk-live' });
  assert.equal(withDraft.editing, true);
  assert.equal(withDraft.keyDraft, 'sk-live');

  const pending = providerRowReducer(withDraft, { type: 'submitStart' });
  assert.equal(pending.pending, true);
  assert.equal(pending.keyDraft, 'sk-live', '提交中不得清空草稿');

  const success = providerRowReducer(pending, { type: 'submitResult', result: { ok: true }, fallback: 'x' });
  assert.deepEqual(success, { editing: false, keyDraft: '', pending: false, error: '' });

  const failed = providerRowReducer(pending, {
    type: 'submitResult',
    result: { ok: false, message: '401 invalid key' },
    fallback: 'x',
  });
  assert.equal(failed.editing, true, '失败必须保留输入框');
  assert.equal(failed.keyDraft, 'sk-live', '失败必须保留用户已输入的密钥');
  assert.equal(failed.error, '401 invalid key');

  const failedNoMessage = providerRowReducer(pending, { type: 'submitResult', result: { ok: false }, fallback: '保存失败' });
  assert.equal(failedNoMessage.error, '保存失败', '网关没给原因时必须用兜底文案，不能静默');

  const cancelled = providerRowReducer(pending, {
    type: 'submitResult',
    result: { ok: false, cancelled: true, message: '不应显示' },
    fallback: 'x',
  });
  assert.equal(cancelled.editing, true);
  assert.equal(cancelled.keyDraft, 'sk-live');
  assert.equal(cancelled.error, '', '用户主动取消不是错误');
});

test('提供商行状态机：断开的失败与取消分支', async () => {
  const { providerRowReducer, PROVIDER_ROW_INITIAL } = await import('../dist/components-react/settings/settingsModel.js');
  const start = providerRowReducer(PROVIDER_ROW_INITIAL, { type: 'disconnectStart' });
  assert.equal(start.pending, true);

  const failed = providerRowReducer(start, {
    type: 'disconnectResult',
    result: { ok: false, message: '403 forbidden' },
    fallback: 'x',
  });
  assert.equal(failed.pending, false);
  assert.equal(failed.error, '403 forbidden');

  const cancelled = providerRowReducer(start, {
    type: 'disconnectResult',
    result: { ok: false, cancelled: true },
    fallback: 'x',
  });
  assert.equal(cancelled.error, '', '取消断开不得显示错误');
});
