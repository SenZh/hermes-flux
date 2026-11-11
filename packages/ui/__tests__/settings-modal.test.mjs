import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsModal } from '../dist/components-react/settings/SettingsModal.js';
import { ModelOptionRow, ModelPickerDialog, ModelPickerField, resolveModelPick } from '../dist/components-react/settings/ModelPicker.js';
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
    bots: [],
    scopedProfile: 'default',
    providerAdminView: 'bot',
    customEndpoints: { status: 'idle' },
    oauthProviders: { status: 'idle' },
    providerAdminBusy: false,
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

const providerSnapshot = (overrides = {}) => ({
  section: 'providers',
  ...overrides,
});

/** 造一行统一提供商视图：默认三个 Agent，可按状态覆盖。 */
function providerView(overrides = {}) {
  const agents = overrides.agents ?? [
    { profile: 'default', displayName: 'default', state: 'active' },
    { profile: 'aura', displayName: 'aura', state: 'ready' },
    { profile: 'codeboy', displayName: 'codeboy', state: 'ready' },
  ];
  return {
    key: overrides.key ?? 'custom:fn',
    kind: overrides.kind ?? 'custom',
    id: overrides.id ?? 'fn',
    name: overrides.name ?? 'fn',
    models: overrides.models ?? ['m1', 'm2'],
    detail: overrides.detail ?? 'http://gw.example/v1',
    availability: overrides.availability ?? 'active',
    agents,
    manualHint: overrides.manualHint,
    expiresAt: overrides.expiresAt,
  };
}

test('提供商页：订阅与自定义混排成一张表，同一行同时给出类型与生效范围', () => {
  setLocale('zh-CN');
  const html = render(providerSnapshot({
    providerViews: {
      status: 'ready',
      data: [
        providerView({}),
        providerView({
          key: 'subscription:xai-oauth',
          kind: 'subscription',
          id: 'xai-oauth',
          name: 'xAI Grok OAuth',
          detail: 'SuperGrok',
          models: [],
          availability: 'ready',
          agents: [
            { profile: 'default', displayName: 'default', state: 'ready' },
            { profile: 'aura', displayName: 'aura', state: 'ready' },
            { profile: 'codeboy', displayName: 'codeboy', state: 'ready' },
          ],
        }),
      ],
    },
  }));
  assert.ok(html.includes('data-provider-key="custom:fn"'));
  assert.ok(html.includes('data-provider-key="subscription:xai-oauth"'), '订阅与自定义必须在同一张表里');
  assert.ok(html.includes(t('settings.providerKindCustom')));
  assert.ok(html.includes(t('settings.providerKindSubscription')));
});

/** 取出某个 Agent 格子的 label 片段，用于断言勾选与禁用状态。 */
function agentCell(html, profile) {
  const at = html.indexOf(`data-agent-profile="${profile}"`);
  if (at < 0) return '';
  const open = html.lastIndexOf('<label', at);
  const end = html.indexOf('</label>', at);
  return html.slice(open, end);
}

test('生效范围是每个 Agent 一个格子：头像 + 名称 + 勾选框，不再用计数代替', () => {
  setLocale('zh-CN');
  const html = render(providerSnapshot({
    providerViews: {
      status: 'ready',
      data: [
        providerView({
          agents: [
            { profile: 'default', displayName: 'default', state: 'active' },
            { profile: 'aura', displayName: 'aura', state: 'ready' },
            { profile: 'codeboy', displayName: 'codeboy', state: 'absent' },
          ],
        }),
      ],
    },
  }));
  assert.ok(html.includes('data-agent-profile="default"'), '每个 Agent 必须是一个可勾选的格子');
  assert.ok(html.includes('data-agent-profile="aura"'));
  assert.ok(html.includes('data-agent-profile="codeboy"'));
  assert.ok(html.includes(t('settings.providerBindingTitleEditable')), '勾选区要有标题，说明它可操作');
  assert.equal(html.includes(t('settings.providerScopeAll')), false, '不得再用"N 个 Agent 在用"这类计数代替');

  const active = agentCell(html, 'default');
  assert.ok(active.includes('checked'), '当前模型必须勾选');
  assert.ok(active.includes('disabled'), '当前模型的格子必须锁定：取消会让主模型指向不存在的 provider');
  assert.ok(active.includes(t('settings.providerBindingActive')));

  const ready = agentCell(html, 'aura');
  assert.ok(ready.includes('checked'), '已配置必须勾选');
  assert.equal(ready.includes('disabled'), false, '已配置但非当前模型：可以取消勾选');

  const absent = agentCell(html, 'codeboy');
  assert.equal(absent.includes('checked'), false, '未配置不得勾选');
  assert.equal(/data-profile-slot=/.test(html), false, '不得再出现首字母头像槽位');
});

test('Agent 成员网格：44px 头像、64px 固定轨道、名称截断但 title 保留全名', () => {
  setLocale('zh-CN');
  const longName = 'Auralis-Infrastructure-Ops';
  const html = render(providerSnapshot({
    providerViews: {
      status: 'ready',
      data: [providerView({
        agents: [
          { profile: 'default', displayName: longName, state: 'ready' },
          { profile: 'aura', displayName: '基础设施运维助手', state: 'active' },
        ],
      })],
    },
  }));
  assert.ok(html.includes('w-16'), '成员宽度固定 64px，不随容器拉伸');
  assert.ok(html.includes('size-11'), '头像放大到 44px，不再被正方形卡片挤小');
  assert.equal(html.includes('min-h-15'), false, '不再保留 60px 高的正方形卡片');
  assert.equal(html.includes('w-20'), false, '不再保留 80px 宽的正方形卡片');
  assert.ok(html.includes('agent-grid'), '网格按 64px 固定轨道自动铺列，行数随数量增长');
  assert.ok(html.includes('--ui-text-caption'), '名称字号必须消费用户字号档位变量');
  assert.ok(html.includes('Auralis…'), '英文名按 8 个半角单位截断');
  assert.ok(html.includes('基础设…'), '中文名按预算为省略号预留宽度');
  assert.ok(html.includes(`title="${longName} · fn"`), '完整名称与 provider 保留在 title');
  assert.ok(html.includes('ring-success'), '当前模型用 success 环表达');
});

test('Agent 成员网格：勾选样式只有一种，绿色环单独表达「当前模型」', () => {
  setLocale('zh-CN');
  const html = render(providerSnapshot({
    providerViews: {
      status: 'ready',
      data: [providerView({
        agents: [
          { profile: 'default', displayName: 'default', state: 'active' },
          { profile: 'aura', displayName: 'aura', state: 'ready' },
        ],
      })],
    },
  }));
  const active = agentCell(html, 'default');
  const ready = agentCell(html, 'aura');
  assert.ok(active.includes('bg-primary text-primary-foreground'), '当前模型的勾选与普通已配置使用同一套视觉');
  assert.ok(ready.includes('bg-primary text-primary-foreground'), '已配置的勾选不得再画成另一种绿色空心对号');
  assert.equal(active.includes('border-success bg-success'), false, '不得再用绿色实底对号区分当前模型');
  assert.ok(active.includes('ring-success'), '当前模型改用头像外环表达');
  assert.ok(html.includes(t('settings.providerBindingLegend')), '界面必须说明绿环与勾选各自代表什么');
});

test('模型行：显示计算后的可读名与品牌图标，绝不直出裸 ID', () => {
  setLocale('zh-CN');
  const html = renderToStaticMarkup(
    React.createElement(ModelOptionRow, {
      modelId: 'anthropic/claude-opus-4.8-fast',
      providerName: 'Anthropic',
      current: true,
    }),
  );
  assert.ok(html.includes('Opus 4.8 Fast'), '必须显示 core 派生出的完整可读名');
  assert.equal((html.match(/Fast/g) ?? []).length, 1, '名字里已有 Fast，不得再叠一枚 Fast 标签');
  assert.equal(html.includes('>anthropic/claude-opus-4.8-fast<'), false, '裸 ID 不得作为可见文本');
  assert.ok(html.includes('<svg'), '模型行必须带品牌图标');
  assert.ok(html.includes(t('settings.providerCurrent')), '当前模型必须标注');
});

test('查看模型弹框：复用模型行、标注当前模型、列出可读名', () => {
  setLocale('zh-CN');
  const html = renderToStaticMarkup(
    React.createElement(ModelPickerDialog, {
      open: true,
      onClose() {},
      title: t('settings.providerModelsDialogTitle'),
      subtitle: t('settings.providerSetCurrentModelFor', { bot: 'default' }),
      providerName: 'Anthropic',
      models: ['anthropic/claude-opus-4.8-fast', 'anthropic/claude-sonnet-5'],
      currentModel: 'anthropic/claude-sonnet-5',
      onPick: async () => ({ ok: true }),
    }),
  );
  assert.ok(html.includes('Opus 4.8 Fast'));
  assert.ok(html.includes('Sonnet 5'));
  assert.ok(html.includes(t('settings.providerCurrent')), '当前模型必须在弹框里标注');
  assert.equal(html.includes('>anthropic/claude-opus-4.8-fast<'), false);
  assert.equal(html.includes('>anthropic/claude-sonnet-5<'), false);
  assert.ok(html.includes(`>${t('settings.close')}<`), '弹框必须有明确关闭入口');
});

test('端点编辑：默认模型选择器显示可读名，且可点开模型下拉', () => {
  setLocale('zh-CN');
  const html = renderToStaticMarkup(
    React.createElement(ModelPickerField, {
      value: 'anthropic/claude-opus-4.8-fast',
      models: ['anthropic/claude-opus-4.8-fast', 'anthropic/claude-sonnet-5'],
      providerName: 'Anthropic',
      ariaLabel: t('settings.customEndpointModel'),
      onChange() {},
    }),
  );
  assert.ok(html.includes('Opus 4.8 Fast'), '选中值必须显示计算后的名字');
  assert.equal(html.includes('>anthropic/claude-opus-4.8-fast<'), false, '选择器不得把裸 ID 当标签');
  assert.ok(html.includes('aria-haspopup="menu"'), '选择器必须是可展开的下拉，而不是只读文本');
});

test('弹框模型状态机：成功关闭、高价确认保窗、失败保窗并透出原因', () => {
  const fallback = { expensive: 'priced', failed: 'failed' };
  assert.deepEqual(resolveModelPick({ ok: true }, 'm1', fallback), { close: true });
  assert.deepEqual(
    resolveModelPick({ ok: false, confirmRequired: true, message: '网关原文' }, 'm1', fallback),
    { close: false, warning: '网关原文', error: '', pendingModel: 'm1' },
    'confirm_required 没落盘，弹窗必须保留',
  );
  assert.deepEqual(
    resolveModelPick({ ok: false, confirmRequired: true }, 'm1', fallback),
    { close: false, warning: 'priced', error: '', pendingModel: 'm1' },
    '网关没给原文时用本地兜底文案',
  );
  assert.deepEqual(
    resolveModelPick({ ok: false, message: 'HTTP 500' }, 'm2', fallback),
    { close: false, warning: '', error: 'HTTP 500', pendingModel: 'm2' },
    '失败保留弹窗并显示真实原因',
  );
  assert.deepEqual(
    resolveModelPick({ ok: false }, 'm2', fallback),
    { close: false, warning: '', error: 'failed', pendingModel: 'm2' },
    '没有原因时也不能静默关闭',
  );
});

test('端点编辑：没有模型列表时退化为输入框，不渲染空下拉', () => {
  setLocale('zh-CN');
  const html = renderToStaticMarkup(
    React.createElement(ModelPickerField, {
      value: '',
      models: [],
      providerName: 'fn',
      ariaLabel: t('settings.customEndpointModel'),
      onChange() {},
    }),
  );
  assert.ok(html.includes(t('settings.providerModelListHint')), '必须说明测试端点后才会出现模型');
  assert.equal(html.includes('aria-haspopup="menu"'), false, '没有模型时不得渲染空下拉');
  assert.ok(html.includes('<input'), '仍必须允许手填模型 ID');
});

test('提供商页三态显式：空态与失败态不能长成同一张脸', () => {
  setLocale('zh-CN');
  const empty = render({ section: 'providers', providerViews: { status: 'ready', data: [] } });
  assert.ok(empty.includes(t('settings.providersEmpty')));

  const failed = render({ section: 'providers', providerViews: { status: 'error', message: 'socket closed' } });
  assert.ok(failed.includes(t('settings.loadFailed')));
  assert.ok(failed.includes('socket closed'), '失败必须带原始原因（Failure Is Not Empty）');
  assert.ok(failed.includes(t('settings.retry')));
  assert.equal(failed.includes(t('settings.providersEmpty')), false);
});

test('某个 Agent 读取失败：格子锁定并带原始原因，不得折进"未配置"', () => {
  setLocale('zh-CN');
  const html = render({
    section: 'providers',
    providerViews: {
      status: 'ready',
      data: [providerView({
        availability: 'error',
        agents: [
          { profile: 'default', displayName: 'default', state: 'active' },
          { profile: 'aura', displayName: 'aura', state: 'error', detail: 'HTTP 500' },
          { profile: 'codeboy', displayName: 'codeboy', state: 'ready' },
        ],
      })],
    },
    providerFailures: [{ profile: 'aura', displayName: 'aura', message: 'HTTP 500: boom' }],
  });
  assert.ok(html.includes('HTTP 500: boom'), '失败原因必须透出');
  assert.ok(html.includes('data-agent-state="error"'), '读取失败必须是独立状态');

  const broken = agentCell(html, 'aura');
  assert.ok(broken.includes('disabled'), '读不到的 Agent 不能让人去勾选或取消');
  assert.ok(broken.includes('HTTP 500'), '格子自身要带原因，不能只靠列表上方的汇总');
});

test('添加提供商是按钮 + 弹框：默认不渲染表单，点开才出现', () => {
  setLocale('zh-CN');
  const closed = render(providerSnapshot({
    providerViews: { status: 'ready', data: [providerView()] },
    subscriptionCatalog: { status: 'ready', data: [] },
  }));
  assert.ok(closed.includes(t('settings.providerAdd')), '必须有添加入口按钮');
  assert.equal(closed.includes(t('settings.customEndpointUrl')), false, '未点开时不得常驻表单占位，表单只在弹框里出现');
});

test('行内不再有笼统的「使用」：模型列表按需展开，动作全部可自解释', () => {
  setLocale('zh-CN');
  const html = render(providerSnapshot({
    providerViews: { status: 'ready', data: [providerView()] },
  }));
  assert.equal(html.includes('>设为当前模型<'), false, '不得再有不说作用于哪个 Agent 的「使用」');
  assert.equal(html.includes('设为默认'), false, '用户明确问过"设为默认什么意思"，这个词不能再出现');
  assert.ok(html.includes(t('settings.providerModelsExpand')), '模型列表要有明确入口');
  assert.ok(html.includes('aria-haspopup="dialog"'), '入口必须打开弹框，不再在行内直接展开');
  assert.equal(html.includes('data-model-id='), false, '模型列表默认折叠，不能把所有模型铺在行里');
  assert.ok(html.includes(t('settings.providerEdit')), '编辑入口必须存在');
  assert.ok(html.includes(t('settings.providerDelete')), '删除入口必须存在');
  assert.equal(html.includes(t('settings.refresh')), false, '常驻刷新按钮已删除：动作后自动重拉，失败态有重试');
});

test('没有模型的提供商：模型区说明为空，且不存在可点的空列表', () => {
  setLocale('zh-CN');
  const html = render(providerSnapshot({
    providerViews: {
      status: 'ready',
      data: [providerView({ models: [], availability: 'ready' })],
    },
  }));
  assert.ok(html.includes(t('settings.providerNoModels')), '必须说明没有可用模型');
  assert.equal(html.includes('data-model-id='), false, '没有模型时不能渲染出可点条目');
});

test('B 策略在界面上先挡一道：有 Agent 正在用，删除按钮必须禁用', () => {
  setLocale('zh-CN');
  const deleteTag = (html) => {
    const at = html.indexOf(`>${t('settings.providerDelete')}</button>`);
    assert.ok(at > 0, '必须存在删除按钮');
    return html.slice(html.lastIndexOf('<button', at), at);
  };

  const isDisabled = (tag) => /\sdisabled(=|>|\s)/.test(tag);

  const busy = render(providerSnapshot({
    providerViews: { status: 'ready', data: [providerView()] },
  }));
  assert.ok(isDisabled(deleteTag(busy)), '有 active 的 Agent 时删除必须禁用，不能等壳层拒绝才告诉用户');

  const idle = render(providerSnapshot({
    providerViews: {
      status: 'ready',
      data: [providerView({
        agents: [
          { profile: 'default', displayName: 'default', state: 'ready' },
          { profile: 'aura', displayName: 'aura', state: 'ready' },
          { profile: 'codeboy', displayName: 'codeboy', state: 'absent' },
        ],
      })],
    },
  }));
  assert.equal(isDisabled(deleteTag(idle)), false, '没有任何 Agent 在用时，删除必须可点');
});

test('订阅默认对所有 Agent 生效：格子只读，不能逐 Agent 取消', () => {
  setLocale('zh-CN');
  const html = render(providerSnapshot({
    providerViews: {
      status: 'ready',
      data: [providerView({
        key: 'subscription:xai-oauth',
        kind: 'subscription',
        id: 'xai-oauth',
        name: 'xAI Grok OAuth',
        detail: 'SuperGrok',
        agents: [
          { profile: 'default', displayName: 'default', state: 'ready' },
          { profile: 'aura', displayName: 'aura', state: 'absent' },
          { profile: 'codeboy', displayName: 'codeboy', state: 'absent' },
        ],
      })],
    },
  }));
  const ready = agentCell(html, 'default');
  assert.ok(ready.includes('checked'), '订阅默认对所有 Agent 生效，格子必须已勾选');
  assert.ok(ready.includes('disabled'), '订阅没有按 Agent 可写的绑定，不能逐 Agent 取消');
  assert.ok(ready.includes(t('settings.providerBindingSubscriptionAll')), 'title 必须说明订阅对所有 Agent 生效');
  assert.ok(html.includes(t('settings.providerBindingTitleAll')), '订阅标题必须说明全部 Agent');
  const absent = agentCell(html, 'aura');
  assert.ok(absent.includes('disabled'), '订阅格子一律只读');
});
