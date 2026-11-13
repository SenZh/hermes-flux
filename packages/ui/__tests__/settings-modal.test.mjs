import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsModal } from '../dist/components-react/settings/SettingsModal.js';
import { FanOutMemberList } from '../dist/components-react/settings/FanOutMemberList.js';
import { AgentBindingGrid, describeDetail } from '../dist/components-react/settings/ProvidersAdminPanel.js';
import { ModelOptionRow, ModelPickerDialog, ModelPickerField, resolveModelPick } from '../dist/components-react/settings/ModelPicker.js';
import { renderModelVendorIcon } from '../dist/lib/vendorIcon.js';
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
    activityVariant: 'cloud',
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
    presenceLayout: 'stage',
    ...overrides,
  };
}

const noopActions = {
  onClose() {},
  onSelectSection() {},
  onThemeChange() {},
  onLocaleChange() {},
  onFontPrefsChange() {},
  onActivityVariantChange() {},
  onPresenceLayoutChange() {},
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
  assert.equal((html.match(/aria-checked="true" data-theme-option=/g) || []).length, 1, '皮肤选中态必须互斥');
  assert.equal((html.match(/aria-checked="false" data-theme-option=/g) || []).length, 4, '其余四张皮肤卡必须明确未选中');
  assert.ok(html.includes('id="settings-ui-font"'));
  assert.ok(html.includes('id="settings-mono-font"'));
});

test('外观页的活动指示器：六张变体卡互斥选中，且每张卡内渲染真实运行态动效', () => {
  setLocale('zh-CN');
  const html = render({ section: 'appearance', activityVariant: 'matrix' });
  const expected = ['cloud', 'gyro', 'orbit', 'synapse', 'spring', 'matrix'];
  for (const variant of expected) {
    assert.ok(html.includes(`data-activity-variant="${variant}"`), `缺少变体卡 ${variant}`);
    assert.ok(html.includes(`data-activity-preview="${variant}"`), `变体卡 ${variant} 必须内嵌真实预览`);
  }
  // 顺序必须与真值表一致：只有 includes 时把列表反转也照样全绿。
  const positions = expected.map((variant) => html.indexOf(`data-activity-variant="${variant}"`));
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index] > positions[index - 1], `变体卡顺序必须与真值表一致，${expected[index]} 位置错误`);
  }
  assert.equal((html.match(/aria-checked="true" data-activity-variant=/g) || []).length, 1, '变体选中态必须互斥');
  assert.ok(html.includes('aria-checked="true" data-activity-variant="matrix"'), '选中态必须来自快照而不是默认值');
  // 预览必须是真实组件：运行态标记与变体类名都要出现在卡片里，不能是静态占位图。
  assert.equal((html.match(/data-status="running"/g) || []).length, 6, '六张卡必须各自渲染运行态指示器');
  assert.ok(html.includes('flux-variant-synapse'));
  for (const variant of expected) {
    const start = html.indexOf(`data-activity-variant="${variant}"`);
    const card = html.slice(start, html.indexOf('</button>', start));
    assert.equal(card.includes('<svg'), false, `变体卡 ${variant} 沿用纯 HTML/CSS 约束，不得引入 SVG`);
  }
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

test('Agent 状态位置：外观分区渲染两个选项，选中态与快照一致', () => {
  setLocale('zh-CN');
  const stageHtml = render({ section: 'appearance', presenceLayout: 'stage' });
  assert.ok(stageHtml.includes(t('settings.presenceTitle')), '必须渲染「Agent 状态」段');
  assert.ok(stageHtml.includes(t('settings.presenceLayoutStage')), '必须渲染「对话区顶部」选项');
  assert.ok(stageHtml.includes(t('settings.presenceLayoutDock')), '必须渲染「输入框上方」选项');
  // 【变异杀伤力】把 snapshot.presenceLayout 改成 dock 后，选中态必须跟着换，
  //   否则「切换不生效」这类缺陷会全绿通过。
  const dockHtml = render({ section: 'appearance', presenceLayout: 'dock' });
  const pressedOf = (html, label) => {
    const match = new RegExp(`aria-pressed="(true|false)"[^>]*>${label}`).exec(html);
    return match?.[1] ?? null;
  };
  assert.equal(pressedOf(stageHtml, t('settings.presenceLayoutStage')), 'true', 'stage 快照下必须选中对话区顶部');
  assert.equal(pressedOf(stageHtml, t('settings.presenceLayoutDock')), 'false');
  assert.equal(pressedOf(dockHtml, t('settings.presenceLayoutDock')), 'true', 'dock 快照下必须选中输入框上方');
  assert.equal(pressedOf(dockHtml, t('settings.presenceLayoutStage')), 'false');
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
  const longName = 'auralis-infrastructure-ops';
  const html = render(providerSnapshot({
    providerViews: {
      status: 'ready',
      data: [providerView({
        agents: [
          { profile: 'default', displayName: longName, state: 'ready' },
          { profile: 'aura', displayName: '基础设施运维助手', state: 'active' },
          { profile: 'xiaofawang', displayName: 'xiaofawang', state: 'ready' },
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
  assert.ok(html.includes('auralis-i…'), '英文名按 10 个半角单位截断，与 64px 轨道匹配');
  assert.ok(html.includes('基础设施…'), '中文名按预算为省略号预留宽度');
  assert.ok(html.includes('>xiaofawang<'), '10 个半角字符必须完整显示，不得提前截断');
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
  assert.ok(html.includes('绿环'), '界面必须说明绿环的含义');
  assert.ok(html.includes('默认模型'), '绿环代表的必须是该 Bot 使用的默认模型');
  assert.equal(html.includes('勾选 = 已配置'), false, '已配置的解释按用户要求删除');
});

test('添加端点：成员选择与列表页同一套头像语义，保存目标用锁形角标区别于普通勾选', () => {
  setLocale('zh-CN');
  const html = renderToStaticMarkup(
    React.createElement(FanOutMemberList, {
      bots: [
        { profile: 'xiaofawang', displayName: 'xiaofawang' },
        { profile: 'ops', displayName: 'auralis-infrastructure-operations-team' },
      ],
      selected: ['xiaofawang'],
      lockedProfile: 'default',
      onToggle() {},
    }),
  );
  assert.ok(html.includes('title="xiaofawang"'), 'title 必须保留完整名称');
  assert.ok(html.includes('aria-label="xiaofawang"'), '勾选框的无障碍名称必须是全名');
  assert.ok(
    html.includes('title="auralis-infrastructure-operations-team"'),
    '超长名同样保留完整 title',
  );
  assert.ok(html.includes('auralis-infra'), '超长名按紧凑规格截断');
  const inputFor = (name) => {
    const match = html.match(new RegExp(`<input[^>]*aria-label="${name}"[^>]*/>`));
    assert.ok(match, `缺少 ${name} 的勾选框`);
    return match[0];
  };
  assert.ok(inputFor('xiaofawang').includes('checked'), '已选成员必须渲染为勾选');
  assert.equal(
    inputFor('auralis-infrastructure-operations-team').includes('checked'),
    false,
    '未选成员不得渲染为勾选',
  );
});

test('添加端点：保存目标本身必须出现、勾选且不可取消', () => {
  setLocale('zh-CN');
  const html = renderToStaticMarkup(
    React.createElement(FanOutMemberList, {
      bots: [
        { profile: 'default', displayName: 'default' },
        { profile: 'ops', displayName: 'ops' },
      ],
      selected: [],
      lockedProfile: 'default',
      onToggle() {},
    }),
  );
  const lockedInput = html.match(/<input[^>]*aria-label="default[^"]*"[^>]*\/>/);
  assert.ok(lockedInput, '保存目标必须出现在成员网格里');
  assert.ok(lockedInput[0].includes('checked'), '保存目标恒为勾选');
  assert.ok(lockedInput[0].includes('disabled'), '保存目标不可取消勾选');
  assert.ok(
    lockedInput[0].includes(t('settings.customEndpointApplyToLocked')),
    '锁定原因必须进入可访问名称，否则读屏只会说"复选框，已选中，不可用"',
  );
  const otherInput = html.match(/<input[^>]*aria-label="ops"[^>]*\/>/);
  assert.equal(otherInput[0].includes('disabled'), false, '其它成员必须可勾选');
});

test('添加端点：锁定格与普通勾选格的视觉必须可区分（锁 vs 对号）', () => {
  setLocale('zh-CN');
  const html = renderToStaticMarkup(
    React.createElement(FanOutMemberList, {
      bots: [
        { profile: 'default', displayName: 'default' },
        { profile: 'ops', displayName: 'ops' },
      ],
      selected: ['ops'],
      lockedProfile: 'default',
      onToggle() {},
    }),
  );
  assert.ok(html.includes('data-bot-badge="locked"'), '保存目标必须有独立的锁定角标');
  assert.ok(html.includes('data-bot-badge="checked"'), '普通勾选必须用对号角标');
  const lockedBadge = html.match(/data-bot-badge="locked"[^>]*>[\s\S]*?<\/span>/);
  assert.ok(lockedBadge, '锁定角标必须渲染出内容');
  assert.ok(lockedBadge[0].includes('<svg'), '锁定角标必须是图形，不能只是换个底色');
  assert.notEqual(
    lockedBadge[0].match(/class="[^"]*"/)[0],
    html.match(/data-bot-badge="checked"[^>]*>[\s\S]*?<\/span>/)[0].match(/class="[^"]*"/)[0],
    '锁定角标与勾选角标的样式必须不同，否则触屏与截图里读不出差别',
  );
});

test('模型行：显示计算后的可读名与厂商图标，绝不直出裸 ID', () => {
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
  assert.ok(html.includes('vendor-icon'), '模型行必须复用输入舱的厂商图标（lobe 品牌资产）');
  assert.ok(html.includes('icons/lobe/anthropic.svg'), '厂商图标必须指向真实的品牌资产，不能用通用描边图形冒充');
  assert.ok(html.includes(t('settings.providerCurrent')), '当前模型必须标注');
});

test('模型行：认不出厂商时回落首字母 badge，不留空洞', () => {
  setLocale('zh-CN');
  const html = renderToStaticMarkup(
    React.createElement(ModelOptionRow, { modelId: 'mystery-model-x', providerName: '' }),
  );
  assert.ok(html.includes('vendor-icon--badge'), '无官方图标时必须渲染 badge 兜底');
  assert.ok(html.includes('>?<'), '判不出厂商时用占位符，绝不返回空节点让行首塌陷');
});

test('厂商图标：React 设置页与输入舱字符串模板必须同构、同资产', () => {
  setLocale('zh-CN');
  const classTokens = (html) =>
    [...html.matchAll(/class="([^"]*)"/g)]
      .flatMap((match) => match[1].split(/\s+/))
      .filter((token) => token.startsWith('vendor-icon'))
      .join(' ');
  for (const [modelId, providerName] of [
    ['anthropic/claude-opus-4.8-fast', 'Anthropic'],
    ['gpt-5.6', 'OpenAI'],
    ['cpa/gemini-3.8-flash', 'cpa'],
    ['qwen/qwen3-32b', 'Qwen'],
    ['nvidia/nemotron-4', 'NVIDIA'],
  ]) {
    const react = renderToStaticMarkup(
      React.createElement(ModelOptionRow, { modelId, providerName }),
    );
    const template = renderModelVendorIcon(modelId, providerName);
    assert.equal(
      classTokens(react),
      classTokens(template),
      `${modelId} 的图标 class 序列必须一致（含 dual 内部 color→mono 顺序）`,
    );
    assert.equal(
      react.includes('icons/lobe/'),
      template.includes('icons/lobe/'),
      `${modelId} 的资产路径口径必须一致（都走 lobe，或都走 badge）`,
    );
  }
});

test('提供商行：名称/类型/模型数同排，URL 与配置文件路径退出列表', () => {
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
          detail: 'SuperGrok · /opt/data/auth.json',
          models: [],
          availability: 'ready',
        }),
      ],
    },
  }));
  assert.equal(html.includes('http://gw.example/v1'), false, '自定义端点地址不得出现在列表行');
  assert.equal(html.includes('/opt/data/auth.json'), false, '配置文件路径不得出现在列表行');
  assert.ok(html.includes('SuperGrok'), '订阅套餐仍要保留');
  assert.ok(html.includes(t('settings.providerModels', { count: 2 })), '模型数量必须展示');
  const title = html.slice(html.indexOf('data-provider-key="custom:fn"'));
  assert.ok(title.indexOf('>fn<') < title.indexOf(t('settings.providerKindCustom')), '顺序：名称 → 类型');
  assert.ok(
    title.indexOf(t('settings.providerKindCustom')) < title.indexOf(t('settings.providerModels', { count: 2 })),
    '顺序：类型 → 模型数（同一排，不再单独占一行）',
  );
});

test('describeDetail：自定义端点整段隐藏，订阅只去掉 URL/路径并保留套餐', () => {
  assert.equal(describeDetail({ kind: 'custom', detail: 'https://ai.codepower.cloud/v1' }), '', '端点地址不再进入列表');
  assert.equal(describeDetail({ kind: 'subscription', detail: 'deviceCode' }), '');
  assert.equal(describeDetail({ kind: 'subscription', detail: 'externalCli' }), '');
  assert.equal(
    describeDetail({ kind: 'subscription', detail: 'SuperGrok · /opt/data/auth.json' }),
    'SuperGrok',
    '凭据文件路径剔除，套餐保留',
  );
  assert.equal(
    describeDetail({ kind: 'subscription', detail: 'SuperGrok · Nous Portal' }),
    'SuperGrok · Nous Portal',
    '人类可读来源不得被误杀',
  );
  assert.equal(
    describeDetail({ kind: 'subscription', detail: 'C:\\Users\\me\\auth.json' }),
    '',
    'Windows 路径同样剔除',
  );
  assert.equal(describeDetail({ kind: 'subscription', detail: 'wss://gw.example/ws' }), '', 'WebSocket 地址剔除');
  assert.equal(describeDetail({ kind: 'subscription', detail: 'file:///opt/data/auth.json' }), '', 'file URL 剔除');
  assert.equal(describeDetail({ kind: 'subscription', detail: '~/data/auth.json' }), '', '家目录简写剔除');
  assert.equal(describeDetail({ kind: 'subscription', detail: '\\\\host\\share\\auth.json' }), '', 'UNC 路径剔除');
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
  assert.equal(html.includes('>设为默认<'), false, '不得再有笼统的「设为默认」动作按钮');
  assert.ok(html.includes(t('settings.providerModelsExpand')), '模型列表要有明确入口');
  assert.ok(html.includes('aria-haspopup="dialog"'), '入口必须打开弹框，不再在行内直接展开');
  assert.equal(html.includes('data-model-id='), false, '模型列表默认折叠，不能把所有模型铺在行里');
  assert.ok(html.includes(t('settings.providerEdit')), '编辑入口必须存在');
  assert.ok(html.includes(t('settings.providerDelete')), '删除入口必须存在');
  assert.equal(html.includes(t('settings.refresh')), false, '常驻刷新按钮已删除：动作后自动重拉，失败态有重试');
  assert.equal(t('settings.providerBindingHint').includes('勾选即'), false, '绑定提示不得再声称勾选即设为默认');
  assert.ok(
    t('settings.providerBindingHint').includes(t('settings.providerAttachEnableOnly')),
    '绑定提示必须说明存在仅启用与启用并设为默认两种选择',
  );
});

test('AgentBindingGrid：行内确认条三种相严格分流（needs-key 隐藏意图按钮，submitting 只留取消可点）', () => {
  setLocale('zh-CN');
  const view = providerView({
    agents: [
      { profile: 'default', displayName: 'default', state: 'active' },
      { profile: 'aura', displayName: 'aura', state: 'absent' },
    ],
  });
  const baseProps = {
    view,
    bots: [
      { profile: 'default', displayName: 'default' },
      { profile: 'aura', displayName: 'aura' },
    ],
    busy: false,
    onToggle: async () => ({ ok: true }),
    onRequestAttach() {},
    onConfirmAttach() {},
    onEditAttachKey() {},
    onCancelAttach() {},
  };

  // 1. choosing：有两个意图按钮，无 password 输入
  const choosingHtml = renderToStaticMarkup(
    React.createElement(AgentBindingGrid, {
      ...baseProps,
      attachFlow: {
        phase: 'choosing',
        providerKey: view.key,
        providerId: view.id,
        profile: 'aura',
      },
    }),
  );
  assert.ok(choosingHtml.includes(t('settings.providerAttachTitle', { provider: view.name, bot: 'aura' })));
  assert.ok(choosingHtml.includes(`>${t('settings.providerAttachEnableOnly')}</button>`), 'choosing 必须渲染仅启用按钮');
  assert.ok(choosingHtml.includes(`>${t('settings.providerAttachEnableAndDefault')}</button>`), 'choosing 必须渲染启用并设为默认按钮');
  assert.equal(choosingHtml.includes('type="password"'), false, 'choosing 不得渲染密码输入框');

  // 2. needs-key：有 password 输入框，严禁渲染两个意图按钮
  const needsKeyHtml = renderToStaticMarkup(
    React.createElement(AgentBindingGrid, {
      ...baseProps,
      attachFlow: {
        phase: 'needs-key',
        providerKey: view.key,
        providerId: view.id,
        profile: 'aura',
        intent: 'enable-only',
        token: 1,
        draftKey: '',
      },
    }),
  );
  assert.ok(needsKeyHtml.includes('type="password"'), 'needs-key 必须渲染密码输入框');
  assert.ok(needsKeyHtml.includes(`>${t('settings.providerAttachSaveAndEnable')}</button>`), 'needs-key 必须有唯一提交出口');
  assert.ok(
    needsKeyHtml.includes(t('settings.providerAttachNeedsKeyIntent', { intent: t('settings.providerAttachEnableOnly') })),
    'needs-key 必须写明当前将执行的意图',
  );
  assert.equal(
    needsKeyHtml.includes(`>${t('settings.providerAttachEnableOnly')}</button>`),
    false,
    'needs-key 阶段严禁同时渲染「仅启用」意图按钮',
  );
  assert.equal(
    needsKeyHtml.includes(`>${t('settings.providerAttachEnableAndDefault')}</button>`),
    false,
    'needs-key 阶段严禁同时渲染「启用并设为默认」意图按钮',
  );

  // 3. submitting：意图按钮必须禁用，但「取消」必须仍可点——REST 代理可能挂起，
  //    把取消也禁用会让用户被永久锁在设置弹窗里。
  const submittingHtml = renderToStaticMarkup(
    React.createElement(AgentBindingGrid, {
      ...baseProps,
      attachFlow: {
        phase: 'submitting',
        providerKey: view.key,
        providerId: view.id,
        profile: 'aura',
        intent: 'enable-and-default',
        token: 2,
      },
    }),
  );
  const attachSection = submittingHtml.slice(submittingHtml.indexOf('data-attach-phase="submitting"'));
  const buttons = [...attachSection.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)]
    .map((match) => ({ tag: match[0], label: match[1].replace(/<[^>]*>/g, '').trim() }));
  assert.ok(buttons.length >= 2, 'submitting 阶段必须有按钮占位');
  for (const { tag, label } of buttons) {
    // 【规则】提交中该按钮文案是「收起」而非「取消」：cancel 事件只作废本地令牌，
    //   在途 RPC 不会中止，网关照常写入，叫「取消」等于承诺一个做不到的语义。
    if (label === t('settings.providerAttachDismiss')) {
      assert.equal(/\sdisabled(=|>|\s)/.test(tag), false, '提交中必须仍能收起，否则用户被锁死在弹窗里');
      continue;
    }
    assert.ok(/\sdisabled(=|>|\s)/.test(tag), `submitting 阶段非收起按钮必须禁用: ${tag}`);
  }
});

test('AgentBindingGrid：壳层忙态下取消仍必须可点（真实锁死场景，busy=true）', () => {
  setLocale('zh-CN');
  const view = providerView({
    agents: [
      { profile: 'default', displayName: 'default', state: 'active' },
      { profile: 'aura', displayName: 'aura', state: 'absent' },
    ],
  });
  // 【为什么必须单独一条】上一条测试传的是 busy: false，而真实链路里
  //   ProviderRow 传下来的是 `busy || pending`，提交期间恒为 true。
  //   于是「取消跟着 busy 一起禁用」这个回归在旧测试下全绿，用户却被永久锁死：
  //   REST 一旦挂住，三个按钮同时 50% 灰掉，点取消毫无反应。
  const html = renderToStaticMarkup(
    React.createElement(AgentBindingGrid, {
      view,
      bots: [{ profile: 'aura', displayName: 'aura' }],
      busy: true,
      attachFlow: {
        phase: 'submitting',
        providerKey: view.key,
        providerId: view.id,
        profile: 'aura',
        intent: 'enable-only',
        token: 5,
      },
      onToggle: async () => ({ ok: true }),
      onRequestAttach() {},
      onConfirmAttach() {},
      onEditAttachKey() {},
      onCancelAttach() {},
    }),
  );
  const attachSection = html.slice(html.indexOf('data-attach-phase="submitting"'));
  const dismissTags = [...attachSection.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)]
    .filter((match) => match[1].replace(/<[^>]*>/g, '').trim() === t('settings.providerAttachDismiss'))
    .map((match) => match[0]);
  assert.equal(dismissTags.length, 1, '提交中必须有且只有一个收起出口');
  assert.equal(
    /\sdisabled(=|>|\s)/.test(dismissTags[0]),
    false,
    'busy=true 时收起仍不得禁用：收起只作废本地令牌，不与任何在途请求冲突',
  );
});

test('AgentBindingGrid：提交中必须有可宣告的进度文案，否则读屏用户看不到任何变化', () => {
  setLocale('zh-CN');
  const view = providerView({
    agents: [{ profile: 'aura', displayName: 'aura', state: 'absent' }],
  });
  const html = renderToStaticMarkup(
    React.createElement(AgentBindingGrid, {
      view,
      bots: [{ profile: 'aura', displayName: 'aura' }],
      busy: true,
      attachFlow: {
        phase: 'submitting',
        providerKey: view.key,
        providerId: view.id,
        profile: 'aura',
        intent: 'enable-only',
        token: 6,
      },
      onToggle: async () => ({ ok: true }),
      onRequestAttach() {},
      onConfirmAttach() {},
      onEditAttachKey() {},
      onCancelAttach() {},
    }),
  );
  assert.ok(html.includes(t('settings.providerAttachSubmitting')), '提交中必须显示「正在写入网关…」');
  assert.ok(html.includes('aria-live="polite"'), '进度文案必须是 aria-live 区域，否则读屏不宣告');
});

test('AgentBindingGrid：补密钥后提交（previousPhase=needs-key）同样必须宣告进度', () => {
  setLocale('zh-CN');
  const view = providerView({
    agents: [{ profile: 'aura', displayName: 'aura', state: 'absent' }],
  });
  // 【为什么必须单独一条】`keyForm` 在 `submitting && previousPhase === 'needs-key'` 时非空，
  //   若进度文案的判断排在 keyForm 之后，这条真实路径（补完密钥点保存）永远拿不到宣告：
  //   输入框与保存按钮一起变灰，读屏却仍念「将执行：仅启用」。上一条测试没有 previousPhase，
  //   结构上碰不到这个分支。
  const html = renderToStaticMarkup(
    React.createElement(AgentBindingGrid, {
      view,
      bots: [{ profile: 'aura', displayName: 'aura' }],
      busy: true,
      attachFlow: {
        phase: 'submitting',
        providerKey: view.key,
        providerId: view.id,
        profile: 'aura',
        intent: 'enable-only',
        token: 7,
        previousPhase: 'needs-key',
        draftKey: 'sk-draft',
      },
      onToggle: async () => ({ ok: true }),
      onRequestAttach() {},
      onConfirmAttach() {},
      onEditAttachKey() {},
      onCancelAttach() {},
    }),
  );
  assert.ok(html.includes(t('settings.providerAttachSubmitting')), '补密钥提交路径同样必须显示进度文案');
  assert.ok(html.includes('type="password"'), '提交中必须保持密钥形态，输入框不得被卸载');
});

test('AgentBindingGrid：补密钥后提交必须保持密钥形态，输入框不得消失', () => {
  setLocale('zh-CN');
  const view = providerView({
    agents: [
      { profile: 'default', displayName: 'default', state: 'active' },
      { profile: 'aura', displayName: 'aura', state: 'absent' },
    ],
  });
  const html = renderToStaticMarkup(
    React.createElement(AgentBindingGrid, {
      view,
      bots: [{ profile: 'aura', displayName: 'aura' }],
      busy: false,
      attachFlow: {
        phase: 'submitting',
        providerKey: view.key,
        providerId: view.id,
        profile: 'aura',
        intent: 'enable-only',
        token: 3,
        previousPhase: 'needs-key',
        draftKey: 'sk-draft',
      },
      onToggle: async () => ({ ok: true }),
      onRequestAttach() {},
      onConfirmAttach() {},
      onEditAttachKey() {},
      onCancelAttach() {},
    }),
  );
  assert.ok(html.includes('type="password"'), '从补密钥发起的提交必须保留密码框，不能换成意图按钮');
  assert.ok(html.includes('value="sk-draft"'), '已输入的密钥必须保留在框内');
  assert.equal(
    html.includes(`>${t('settings.providerAttachEnableOnly')}</button>`),
    false,
    '提交中不得再出现意图按钮',
  );
});

test('AgentBindingGrid：确认条必须可被读屏定位，密码框必须有名称，目标头像声明展开态', () => {
  setLocale('zh-CN');
  const view = providerView({
    agents: [
      { profile: 'default', displayName: 'default', state: 'active' },
      { profile: 'aura', displayName: 'aura', state: 'absent' },
    ],
  });
  const html = renderToStaticMarkup(
    React.createElement(AgentBindingGrid, {
      view,
      bots: [{ profile: 'aura', displayName: 'aura' }],
      busy: false,
      attachFlow: {
        phase: 'needs-key',
        providerKey: view.key,
        providerId: view.id,
        profile: 'aura',
        intent: 'enable-only',
        token: 4,
        draftKey: '',
      },
      onToggle: async () => ({ ok: true }),
      onRequestAttach() {},
      onConfirmAttach() {},
      onEditAttachKey() {},
      onCancelAttach() {},
    }),
  );
  assert.ok(html.includes('role="group"'), '确认条必须是一个有名字的分组，不能是裸 div');
  assert.ok(/aria-labelledby="attach-strip-[^"]+-title"/.test(html), '确认条必须用标题做可访问名称');
  assert.ok(
    html.includes(`aria-label="${t('settings.customEndpointKey')}"`),
    '密码框必须有可访问名称，否则读屏只说"编辑框"',
  );
  assert.ok(/aria-expanded="true"/.test(html), '展开确认条的头像必须声明 aria-expanded');
  assert.ok(/aria-controls="attach-strip-[^"]+"/.test(html), '头像必须指向它展开的那条确认条');
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
