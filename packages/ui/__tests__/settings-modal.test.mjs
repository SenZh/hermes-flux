import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsModal } from '../dist/components-react/settings/SettingsModal.js';
import { Switch } from '../dist/components-react/primitives/Switch.js';
import { McpAddDialog } from '../dist/components-react/settings/McpAddDialog.js';
import { McpRemoveConfirmDialog } from '../dist/components-react/settings/McpRemoveConfirmDialog.js';
import { SkillDetailDialog } from '../dist/components-react/settings/SkillDetailDialog.js';
import { SkillInstallDialog } from '../dist/components-react/settings/SkillInstallDialog.js';
import { FanOutMemberList } from '../dist/components-react/settings/FanOutMemberList.js';
import { AgentBindingGrid, describeDetail } from '../dist/components-react/settings/ProvidersAdminPanel.js';
import {
  GroupedModelSelect,
  ModelOptionRow,
  ModelPickerDialog,
  ModelPickerField,
  ProviderVendorIcon,
  resolveModelPick,
} from '../dist/components-react/settings/ModelPicker.js';
import { renderModelVendorIcon } from '../dist/lib/vendorIcon.js';
import {
  SETTINGS_SECTIONS,
  SETTINGS_SEARCH_ENTRIES,
  buildModelSelectGroups,
  filterSettingsEntries,
  filterSettingsSections,
  isGatewayTestStale,
  resolveSettingsSection,
} from '../dist/components-react/settings/settingsModel.js';
import { setLocale, t } from '../dist/i18n/index.js';
import { CONVERSATION_WIDTH_MODES } from '../dist/tokens/conversationWidth.js';
import { cn } from '../dist/lib/tw-merge.js';
import { createJumpScheduler } from '../dist/components-react/settings/jumpScheduler.js';

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

const emptyBotManagement = () => ({
  status: { status: 'idle', activeBotId: 'default' },
  roster: [],
  activeBotId: 'default',
  activeDetail: undefined,
  availableModels: [],
  activeDraft: undefined,
  wizard: {
    open: false,
    draft: {
      mode: 'blank',
      name: '',
      displayName: '',
      description: '',
      model: '',
      provider: '',
      cloneFrom: '',
      cloneChannels: false,
      mirrorCredentials: false,
    },
    busy: false,
  },
  exitPrompt: null,
  errorBanner: undefined,
  highlightBotId: undefined,
  isBusy: false,
});

function snapshot(overrides = {}) {
  return {
    isOpen: true,
    section: 'appearance',
    theme: 'obsidian-gold',
    locale: 'zh',
    fontPrefs: { uiFont: 'geist-sans', monoFont: 'jetbrains-mono', sizeScale: 'medium' },
    activityVariant: 'cloud',
    conversationWidth: 'wide',
    providers: { status: 'idle' },
    profiles: { status: 'idle' },
    bots: [],
    botManagement: emptyBotManagement(),
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
  onConversationWidthChange() {},
  onPresenceLayoutChange() {},
  onRefreshProviders() {},
  onSaveProviderKey: async () => ({ ok: true }),
  onDisconnectProvider: async () => ({ ok: true }),
  onRefreshProfiles() {},
  onOpenAgent() {},
  onBotDraftChange() {},
  onSelectBotSettle() {},
  onSaveBotConfig: async () => ({ ok: true }),
  onResetBotDraft() {},
  onOpenBotWizard() {},
  onCloseBotWizard() {},
  onBotWizardDraftChange() {},
  onSubmitCreateBot: async () => ({ ok: false }),
  onRetryBotList() {},
  onDismissBotError() {},
  onDismissBotConfirm() {},
  onConfirmBotExit() {},
  onCancelBotExit() {},
  onRegisterBotDirtyGuard() {},
  onRefreshExtensions() {},
  onReloadSkills: async () => ({ ok: true }),
  onTestGateway() {},
  onConnectGateway() {},
  onDisconnectGateway() {},
};

function render(overrides = {}) {
  const { actionsOverride, ...snapshotOverrides } = overrides;
  return renderToStaticMarkup(
    React.createElement(SettingsModal, {
      snapshot: snapshot(snapshotOverrides),
      actions: actionsOverride ? { ...noopActions, ...actionsOverride } : noopActions,
    }),
  );
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
  for (const id of ['obsidian-gold', 'ayu-dark', 'jade-white', 'warm-paper', 'ayu-light']) {
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
  assert.ok(html.includes('data-skill-group="builtin"'), '技能必须按 category 分组，不能混排成一堆徽标');
  assert.ok(html.includes('data-atom="surface"'), 'MCP 行必须走 Surface 原子，与其他工作台卡片同一物理层级');
});

/** 构造 BOT 面板详情：能力清单显式标为非权威，避免测试把"没返回"当成"空配置"。 */
function botDetail(overrides = {}) {
  return {
    id: 'default',
    displayName: 'Hermes',
    description: '默认助手',
    model: '',
    provider: '',
    soul: '',
    avatar: undefined,
    isDefault: true,
    skills: { authoritative: false, rows: [] },
    toolsets: { authoritative: false, rows: [] },
    mcpServers: { authoritative: false, rows: [] },
    ...overrides,
  };
}

function botManagement(overrides = {}) {
  return {
    ...emptyBotManagement(),
    ...overrides,
  };
}

test('BOT 页渲染全量成员选择栏与基础身份字段，不再出现旧的只读员工列表', () => {
  setLocale('zh-CN');
  const html = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'arch' },
      activeBotId: 'arch',
      roster: [
        { id: 'default', displayName: 'Hermes', model: '', isDefault: true, hasDraft: false },
        { id: 'arch', displayName: '架构老王', model: '', isDefault: false, hasDraft: false },
      ],
      activeDetail: botDetail({ id: 'arch', displayName: '架构老王', description: '负责架构评审', isDefault: false }),
    }),
  });
  assert.ok(html.includes('data-bot-carousel="true"'), '必须有成员选择栏');
  assert.equal((html.match(/data-bot-slot=/g) || []).length, 2, 'N=2 时按实际数量平铺，不补空槽位也不截断');
  assert.equal(
    (html.match(/data-bot-id="default"/g) || []).length,
    1,
    'N=2 时按实际数量平铺，禁止重复克隆同一个 BOT',
  );
  assert.equal((html.match(/data-bot-id="arch"/g) || []).length, 1);
  assert.ok(html.includes('id="bot-id"'), 'BOT ID 只读展示');
  assert.ok(html.includes('id="bot-display-name"'), '显示名称可编辑');
  assert.ok(html.includes('id="bot-description"'), '职能描述可编辑');
  assert.ok(html.includes(t('bot.copyId')), 'ID 必须提供复制入口');
  assert.ok(html.includes(t('bot.saveBtn')));
  assert.ok(html.includes(t('bot.resetBtn')));
  assert.equal(html.includes(t('settings.agentOpen')), false, '旧的只读列表入口必须删除');
});

test('BOT 成员选择栏：超过 5 个全量展示不截断，头像 1:1 防变形且无选中外圈 ring', () => {
  setLocale('zh-CN');
  const roster = Array.from({ length: 7 }, (_, i) => ({
    id: `bot-${i + 1}`,
    displayName: `员工 ${i + 1}`,
    model: i === 3 ? 'anthropic/claude-sonnet-5' : '',
    isDefault: i === 0,
    hasDraft: i === 3,
  }));
  const html = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'bot-4' },
      activeBotId: 'bot-4',
      roster,
      activeDetail: botDetail({
        id: 'bot-4',
        displayName: '员工 4',
        model: 'anthropic/claude-sonnet-5',
        isDefault: false,
      }),
    }),
  });

  assert.equal((html.match(/data-bot-slot=/g) || []).length, 7, '超过 5 个 BOT 时必须全部渲染，不得截断为 5 槽位');
  for (const row of roster) {
    assert.ok(html.includes(`data-bot-id="${row.id}"`), `缺少成员 ${row.id}`);
  }
  assert.ok(html.includes('Sonnet 5'), '成员卡片必须展示人类可读的模型名');
  assert.equal(html.includes('anthropic/claude-sonnet-5'), false, '成员卡片不得直接裸露原始模型 ID');

  // 所有头像容器必须锁定 shrink-0 与 aspect-square，且禁止再套 ring 外圈。
  const avatarTags = html.match(/<span[^>]*data-bot-avatar="true"[^>]*>/g) ?? [];
  assert.equal(avatarTags.length, 8, '7 个成员栏头像 + 1 个身份卡头头像都必须带防变形标记');
  for (const tag of avatarTags) {
    assert.ok(tag.includes('shrink-0'), '头像容器必须声明 shrink-0，防止被 flex 压成椭圆');
    assert.ok(tag.includes('aspect-square'), '头像容器必须声明 aspect-square，锁定 1:1 正圆');
    assert.equal(/\bring-(?:primary|border-strong|1|2|offset)/.test(tag), false, '头像容器禁止套用选中外圈 ring');
  }

  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const carouselSource = stripComments(readSettingsSource('BotHeroCarousel.tsx'));
  assert.equal(/\bring-(?:primary|border-strong|offset-)/.test(carouselSource), false, 'BotHeroCarousel 严禁再给头像画选中圆圈');
  assert.ok(carouselSource.includes('scrollbar-thin'), '溢出头像微轨必须使用语义超细滚动条');
  assert.ok(
    carouselSource.includes('PanelLeftOpen') && carouselSource.includes('PanelLeftClose'),
    '展开/收起开关必须使用 PanelLeftOpen / PanelLeftClose 标准图标',
  );
  assert.equal(
    /ChevronLeft|ChevronRight|ArrowLeft|ArrowRight/.test(carouselSource),
    false,
    '折叠按钮严禁使用方向箭头图标',
  );
  assert.ok(html.includes('data-bot-rail-toggle="true"'), '列表底部必须渲染展开/收起开关');
  assert.ok(html.includes('data-bot-rail-expanded="true"'), 'BOT 列表默认处于展开态（带姓名与搜索框，不再只剩细头像条）');
  assert.ok(html.includes('data-bot-rail-filter="true"'), '默认展开态须直接展示 BOT 搜索输入框');
  assert.ok(carouselSource.includes('<Tooltip'), '列表收起为 64px 微轨时须为头像挂载 Tooltip 轻名片');

  const managerSource = stripComments(readSettingsSource('BotManagerView.tsx'));
  assert.equal(/\bring-(?:primary|border-strong|offset-)/.test(managerSource), false, '身份主卡头像严禁画常驻选中圆圈');
});

test('BOT 下方主体区：默认展开列表 + 扁平五菜单（零数字徽标）、SOUL Studio、长期记忆只读卡与悬浮胶囊保存条', () => {
  setLocale('zh-CN');
  const detail = botDetail({
    id: 'arch',
    displayName: '架构老王',
    isDefault: false,
    soul: 'hello',
    toolsets: {
      authoritative: true,
      rows: [
        { id: 'web', label: '联网检索', enabled: true },
        { id: 'browser', label: '浏览器', enabled: false },
      ],
    },
    skills: {
      authoritative: true,
      rows: [
        { id: 'codebase', label: 'codebase', enabled: true },
        { id: 'dogfood', label: 'dogfood', enabled: false },
      ],
    },
    mcpServers: {
      authoritative: false,
      rows: [],
    },
  });

  const cleanHtml = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'arch' },
      activeBotId: 'arch',
      roster: [{ id: 'arch', displayName: '架构老王', model: '', isDefault: false, hasDraft: false }],
      activeDetail: detail,
    }),
  });
  assert.equal(cleanHtml.includes(t('bot.draftNotice')), false, '无草稿时底栏不得提示未保存修改');

  const dirtyHtml = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'arch' },
      activeBotId: 'arch',
      roster: [{ id: 'arch', displayName: '架构老王', model: '', isDefault: false, hasDraft: true }],
      activeDetail: detail,
      activeDraft: {
        displayName: '首席架构',
        description: '',
        model: '',
        provider: '',
        isDefault: false,
        soul: 'hello',
        avatar: { kind: 'unchanged' },
        disabledSkills: ['dogfood'],
        enabledToolsets: ['web'],
        enabledMcpServers: [],
      },
    }),
  });
  for (const tab of ['basic', 'soul', 'toolsets', 'skills', 'mcp']) {
    assert.ok(dirtyHtml.includes(`data-bot-tab="${tab}"`), `缺少扁平一级菜单 ${tab}`);
    assert.ok(dirtyHtml.includes(`data-bot-tabpanel="${tab}"`), `缺少一级菜单对应内容页 ${tab}`);
  }
  const tabBtns = dirtyHtml.match(/<button[^>]*data-bot-tab="[^"]+"[^>]*>[\s\S]*?<\/button>/g) ?? [];
  assert.equal(tabBtns.length, 5, '顶部菜单栏必须固定为 5 个一级扁平菜单');
  for (const tabHtml of tabBtns) {
    const labelText = tabHtml.replace(/<[^>]+>/g, '').trim();
    assert.equal(/\d/.test(labelText), false, `顶部菜单项不得携带数字或徽标，实测 "${labelText}"`);
  }
  assert.equal(dirtyHtml.includes('data-bot-tab="caps"'), false, '禁止再出现二级聚合入口「能力矩阵」');
  assert.ok(dirtyHtml.includes('data-bot-save-dock="true"'), '必须渲染底部悬浮胶囊保存条');
  assert.ok(dirtyHtml.includes('data-bot-rail-toggle="true"'), '列表底部必须挂载展开/收起按钮');
  assert.ok(dirtyHtml.includes('data-bot-cap-search="skills"'), '技能分页必须提供即时搜索框');
  assert.ok(dirtyHtml.includes('data-bot-install-skill="true"'), '技能分页必须直出安装技能按钮');
  assert.ok(dirtyHtml.includes('data-bot-add-mcp="true"'), 'MCP 分页必须直出新增 MCP 按钮');
  assert.ok((dirtyHtml.match(/data-atom="surface"/g) || []).length >= 1, '长期记忆只读卡必须使用 Surface');
  assert.ok(dirtyHtml.includes('lg:grid-cols-2'), '能力开关列表在宽屏下必须走双列网格');
  assert.ok(dirtyHtml.includes(t('bot.capFilterAll', { count: 2 })), '分页筛选胶囊必须展示全部计数');
  assert.ok(dirtyHtml.includes(t('bot.capabilityReadonly')), '非权威能力区必须展示只读摘要');
  assert.ok(dirtyHtml.includes(t('bot.soulLines', { count: 1 })), 'SOUL Studio 页脚必须展示实时行数');
  assert.ok(dirtyHtml.includes(t('bot.soulCount', { bytes: 5 })), 'SOUL Studio 页脚必须展示实时字节数');
  assert.ok(dirtyHtml.includes(t('bot.draftNotice')), '有草稿时悬浮胶囊条必须提示未保存修改');
  assert.ok(dirtyHtml.includes(t('bot.memoryLocked')), '长期记忆只读卡必须直出隔离徽标');
  assert.equal(dirtyHtml.includes('data-bot-section="memory"'), false, '长期记忆不再藏进空洞折叠抽屉');
});

test('BOT 页草稿头像与状态回归：replace/clear 渲染、保存锁定态、跨组同名能力 ID 与 roving tabIndex', () => {
  setLocale('zh-CN');
  const detail = botDetail({
    id: 'arch',
    displayName: '架构老王',
    avatar: 'data:image/png;base64,OLD_AVATAR',
    isDefault: false,
    toolsets: { authoritative: true, rows: [{ id: 'github', label: 'GitHub 工具', enabled: true }] },
    skills: { authoritative: true, rows: [{ id: 'github', label: 'GitHub 技能', enabled: true }] },
    mcpServers: { authoritative: true, rows: [{ id: 'github', label: 'GitHub MCP', enabled: true, online: true }] },
  });
  const baseRoster = [
    { id: 'default', displayName: 'Hermes', model: '', avatar: 'data:image/png;base64,DEF', isDefault: true, hasDraft: false },
    { id: 'arch', displayName: '架构老王', model: '', avatar: 'data:image/png;base64,OLD_AVATAR', isDefault: false, hasDraft: true },
  ];
  const makeDraft = (avatar) => ({
    displayName: '架构老王',
    description: '',
    model: '',
    provider: '',
    isDefault: false,
    soul: '',
    avatar,
    disabledSkills: [],
    enabledToolsets: ['github'],
    enabledMcpServers: ['github'],
  });

  // 1. replace 草稿必须在成员栏与身份主卡同步显示新图，且跨组同名能力 ID 各自独立。
  const replacedHtml = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'arch' },
      activeBotId: 'arch',
      roster: baseRoster,
      activeDetail: detail,
      activeDraft: makeDraft({ kind: 'replace', dataUrl: 'data:image/png;base64,NEW_AVATAR' }),
    }),
  });
  assert.equal((replacedHtml.match(/NEW_AVATAR/g) || []).length, 2, '新头像必须同时出现在成员栏与身份主卡');
  assert.equal(replacedHtml.includes('OLD_AVATAR'), false, 'replace 必须覆盖旧头像');
  assert.ok(replacedHtml.includes('id="bot-capability-toolsets-github"'));
  assert.ok(replacedHtml.includes('for="bot-capability-toolsets-github"'));
  assert.ok(replacedHtml.includes('id="bot-capability-skills-github"'));
  assert.ok(replacedHtml.includes('for="bot-capability-skills-github"'));
  assert.ok(replacedHtml.includes('id="bot-capability-mcp-github"'));
  assert.ok(replacedHtml.includes('for="bot-capability-mcp-github"'));

  // 2. clear 墓碑必须抹除花名册与详情里的旧头像，且禁用「恢复默认头像」按钮。
  const clearedHtml = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'arch' },
      activeBotId: 'arch',
      roster: baseRoster,
      activeDetail: detail,
      activeDraft: makeDraft({ kind: 'clear' }),
    }),
  });
  assert.equal(clearedHtml.includes('OLD_AVATAR'), false, 'clear 墓碑必须阻止花名册旧图回显');
  assert.equal(clearedHtml.includes(t('bot.avatarReset')), false, '无自定义头像时头像旁不展示恢复默认头像图标');

  const customAvatarHtml = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'arch' },
      activeBotId: 'arch',
      roster: baseRoster,
      activeDetail: detail,
      activeDraft: makeDraft({ kind: 'replace', dataUrl: 'data:image/png;base64,NEWIMG' }),
    }),
  });
  assert.ok(
    customAvatarHtml.includes(`aria-label="${t('bot.avatarReset')}"`),
    '存在自定义头像时紧凑身份头必须显示可点击的恢复默认头像图标',
  );

  // 3. 保存锁定态：成员栏 tab、默认开关标签均须 disabled，保存按钮内不得挂载 ActivityIndicator。
  const savingHtml = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'saving', activeBotId: 'arch' },
      isBusy: true,
      activeBotId: 'arch',
      roster: baseRoster,
      activeDetail: detail,
      activeDraft: makeDraft({ kind: 'unchanged' }),
    }),
  });
  const tabTags = savingHtml.match(/<button[^>]*data-bot-slot="[^"]+"[^>]*>/g) ?? [];
  assert.equal(tabTags.length, 2);
  for (const tabTag of tabTags) {
    assert.ok(/\sdisabled(=|>|\s)/.test(tabTag), '保存中成员栏按钮必须全部禁用');
  }
  const labelBtnAt = savingHtml.indexOf(`>${t('bot.setDefault')}</button>`);
  assert.ok(labelBtnAt > 0);
  assert.ok(/\sdisabled(=|>|\s)/.test(savingHtml.slice(savingHtml.lastIndexOf('<button', labelBtnAt), labelBtnAt)), '锁定态下默认 BOT 标签按钮必须同步禁用');
  assert.equal(savingHtml.includes('flux-cloud'), false, '保存按钮内严禁再挂载 ActivityIndicator');

  // 4. activeBotId 暂未命中花名册时，首项仍须保持 tabIndex=0（roving tabindex 兜底）。
  const orphanHtml = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'missing-id' },
      activeBotId: 'missing-id',
      roster: baseRoster,
      activeDetail: detail,
    }),
  });
  const orphanTabs = orphanHtml.match(/<button[^>]*data-bot-slot="[^"]+"[^>]*>/g) ?? [];
  assert.ok(orphanTabs[0].includes('tabIndex="0"') || orphanTabs[0].includes('tabindex="0"'));
  assert.ok(orphanTabs[1].includes('tabIndex="-1"') || orphanTabs[1].includes('tabindex="-1"'));

  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.equal(stripComments(readSettingsSource('BotHeroCarousel.tsx')).includes('leading-tight'), false, 'Badge 禁止覆写 leading-tight 非整数行高');
  assert.equal(stripComments(readSettingsSource('BotManagerView.tsx')).includes('ActivityIndicator'), false, 'BotManagerView 不得再消费 ActivityIndicator');
});

test('BOT 左右栏头像对齐：activeDetail 缺头像时回落花名册头像，clear 墓碑仍清零两边显示', () => {
  setLocale('zh-CN');
  const uploadedUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk';
  const html = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'default' },
      activeBotId: 'default',
      roster: [{ id: 'default', displayName: '大总管', model: '', avatar: uploadedUrl, isDefault: true, hasDraft: false }],
      activeDetail: botDetail({ id: 'default', displayName: '大总管', avatar: undefined, isDefault: true }),
    }),
  });
  const matchedImgs = html.match(/src="data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"/g) ?? [];
  assert.equal(matchedImgs.length, 2, '左侧 BOT 列表与右侧身份头必须同时渲染同一张上传头像');

  // normalizeAgentProfile 无头像时会 emit 空串 ''，必须同样回落到花名册头像并保留「恢复默认头像」按钮
  const emptyStringHtml = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'default' },
      activeBotId: 'default',
      roster: [{ id: 'default', displayName: '大总管', model: '', avatar: uploadedUrl, isDefault: true, hasDraft: false }],
      activeDetail: botDetail({ id: 'default', displayName: '大总管', avatar: '', isDefault: true }),
    }),
  });
  const emptyImgs = emptyStringHtml.match(/src="data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"/g) ?? [];
  assert.equal(emptyImgs.length, 2, 'activeDetail.avatar 为空串时同样必须回落花名册头像');
  assert.ok(emptyStringHtml.includes(`aria-label="${t('bot.avatarReset')}"`), '回落出自定义头像时应展示恢复默认头像按钮');

  const clearedHtml = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'default' },
      activeBotId: 'default',
      roster: [{ id: 'default', displayName: '大总管', model: '', avatar: uploadedUrl, isDefault: true, hasDraft: true }],
      activeDetail: botDetail({ id: 'default', displayName: '大总管', avatar: undefined, isDefault: true }),
      activeDraft: {
        displayName: '大总管',
        description: '',
        model: '',
        provider: '',
        isDefault: true,
        soul: '',
        avatar: { kind: 'clear' },
        disabledSkills: [],
        enabledToolsets: [],
        enabledMcpServers: [],
      },
    }),
  });
  assert.equal(clearedHtml.includes(uploadedUrl), false, 'avatar=clear 墓碑语义下左右栏均不得回显旧头像');
  assert.equal(clearedHtml.includes(`aria-label="${t('bot.avatarReset')}"`), false, 'clear 墓碑下不得渲染恢复默认头像按钮');
});

test('BOT 页：有草稿时保存与重置可点，无草稿时禁用；保存中锁输入', () => {
  setLocale('zh-CN');
  const detail = botDetail({ id: 'arch', displayName: '架构老王', description: '负责架构评审', isDefault: false });
  const base = {
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'arch' },
      activeBotId: 'arch',
      roster: [{ id: 'arch', displayName: '架构老王', model: '', isDefault: false, hasDraft: true }],
      activeDetail: detail,
    }),
  };

  const clean = render(base);
  const buttonTag = (html, label) => {
    const at = html.indexOf(`>${label}</button>`);
    assert.ok(at > 0, `缺少按钮 ${label}`);
    return html.slice(html.lastIndexOf('<button', at), at);
  };
  const isDisabled = (tag) => /\sdisabled(=|>|\s)/.test(tag);
  assert.equal(isDisabled(buttonTag(clean, t('bot.saveBtn'))), true, '无草稿时保存必须禁用');

  const draft = {
    displayName: '首席架构',
    description: '负责架构评审',
    model: '',
    provider: '',
    isDefault: false,
    soul: '',
    avatar: { kind: 'unchanged' },
    disabledSkills: [],
    enabledToolsets: [],
    enabledMcpServers: [],
  };
  const dirty = render({
    ...base,
    botManagement: botManagement({
      ...base.botManagement,
      activeDraft: draft,
    }),
  });
  assert.equal(isDisabled(buttonTag(dirty, t('bot.saveBtn'))), false, '有草稿时保存必须可点');
  assert.ok(dirty.includes('value="首席架构"'), '输入框必须回显草稿值');

  const saving = render({
    ...base,
    botManagement: botManagement({
      ...base.botManagement,
      status: { status: 'saving', activeBotId: 'arch' },
      isBusy: true,
      activeDraft: draft,
    }),
  });
  assert.ok(saving.includes(t('bot.saving')), '保存中必须显示进度文案');
  assert.equal(/<input[^>]*id="bot-display-name"[^>]*disabled/.test(saving), true, '保存中显示名必须只读');
});

test('BOT 页空态与错误态显式分流：空态给创建引导，错误态给真实原因与重试', () => {
  setLocale('zh-CN');
  const empty = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'empty_list' },
      activeBotId: '',
      roster: [],
      activeDetail: undefined,
    }),
  });
  assert.ok(empty.includes(t('bot.emptyRoster')));
  assert.ok(empty.includes(t('bot.createFirst')));
  assert.ok(empty.includes('disabled'), '向导尚未接承时创建按钮必须禁用，禁止假可用');
  assert.equal(empty.includes('data-bot-carousel="true"'), false, '空花名册不得渲染选择器');

  const failed = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'list_error', message: 'socket closed' },
      activeBotId: '',
      roster: [],
      activeDetail: undefined,
    }),
  });
  assert.ok(failed.includes(t('bot.loadFailedTitle')));
  assert.ok(failed.includes('socket closed'), '失败必须带原始原因（Failure Is Not Empty）');
  assert.ok(failed.includes(t('bot.retry')));
  assert.equal(failed.includes(t('bot.emptyRoster')), false, '错误态不得伪装成空态');
});

test('BOT 模型绑定：按 Provider 分组，当前模型离线时置顶保留，不静默清空', () => {
  setLocale('zh-CN');
  const draft = {
    displayName: '架构老王',
    description: '负责架构评审',
    model: 'legacy/retired-model',
    provider: 'legacy',
    isDefault: false,
    soul: '',
    avatar: { kind: 'unchanged' },
    disabledSkills: [],
    enabledToolsets: [],
    enabledMcpServers: [],
  };
  const html = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'arch' },
      activeBotId: 'arch',
      roster: [{ id: 'arch', displayName: '架构老王', model: draft.model, isDefault: false, hasDraft: true }],
      activeDetail: botDetail({ id: 'arch', displayName: '架构老王', model: draft.model, provider: 'legacy', isDefault: false }),
      activeDraft: draft,
      availableModels: [
        { id: 'claude-opus-4.8', name: 'Claude Opus 4.8', provider: 'anthropic', providerName: 'Anthropic' },
        { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'anthropic', providerName: 'Anthropic' },
        { id: 'gpt-5.6', name: 'GPT-5.6', provider: 'openai', providerName: 'OpenAI' },
      ],
    }),
  });
  assert.ok(html.includes('id="bot-model"'), '必须有模型下拉');
  // 离线模型必须显示在触发器上（Select 的选项列表在 Portal 中，SSR 不渲染）。
  assert.ok(html.includes(t('bot.modelOffline', { model: 'legacy/retired-model' })), '离线模型必须保留并标注，不能静默清空');

  // 分组数据由纯函数构造，可直接断言：离线占位置顶且不可选，真实目录按 Provider 分组。
  const groups = buildModelSelectGroups({
    groups: [
      { name: 'Anthropic', models: [{ id: 'claude-opus-4.8', name: 'Claude Opus 4.8' }, { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' }] },
      { name: 'OpenAI', models: [{ id: 'gpt-5.6', name: 'GPT-5.6' }] },
    ],
    currentModel: 'legacy/retired-model',
    currentModelOffline: true,
    labels: { offline: 'OFFLINE', unbound: 'UNBOUND', catalogUnavailable: 'NO_CATALOG' },
  });
  assert.equal(groups[0].options[0].value, 'legacy/retired-model', '离线项必须置顶');
  assert.equal(groups[0].options[0].disabled, true, '离线占位不可选，禁止借它改写 provider');
  assert.equal(groups.filter((group) => group.label).length, 2, '必须按 Provider 分组');
  assert.deepEqual(groups.filter((group) => group.label).map((group) => group.label), ['Anthropic', 'OpenAI']);
});

test('BOT SOUL：等宽编辑器、字节计数、超 64KB 提示与变量/模板胶囊', () => {
  setLocale('zh-CN');
  const soul = 'x'.repeat(70_000);
  const draft = {
    displayName: '架构老王',
    description: '',
    model: '',
    provider: '',
    isDefault: false,
    soul,
    avatar: { kind: 'unchanged' },
    disabledSkills: [],
    enabledToolsets: [],
    enabledMcpServers: [],
  };
  const html = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'arch' },
      activeBotId: 'arch',
      roster: [{ id: 'arch', displayName: '架构老王', model: '', isDefault: false, hasDraft: true }],
      activeDetail: botDetail({ id: 'arch', displayName: '架构老王', isDefault: false }),
      activeDraft: draft,
    }),
  });
  assert.ok(html.includes('id="bot-soul"'), '必须有 SOUL 编辑器');
  assert.ok(html.includes(t('bot.soulCount', { bytes: 70_000 })), '必须给出真实字节数');
  assert.ok(html.includes(t('bot.soulLengthWarn')), '超过 64KB 必须有醒目提示');
  assert.ok(html.includes(t('bot.soulVarUserShort')));
  assert.ok(html.includes(t('bot.soulVarWorkspaceShort')));
  assert.ok(html.includes(t('bot.soulTemplates')));
  const botManagerSource = readSettingsSource('BotManagerView.tsx');
  assert.ok(
    botManagerSource.includes("t('bot.soulTemplateArchitect')") &&
      botManagerSource.includes("t('bot.soulTemplateReviewer')"),
    'SOUL Studio 模板菜单必须提供 Architect / Reviewer 预置模板',
  );
});

test('BOT 能力矩阵：逐项开关、非权威清单只读、MCP 未知不画红灯、长期记忆无编辑入口', () => {
  setLocale('zh-CN');
  const draft = {
    displayName: '架构老王',
    description: '',
    model: '',
    provider: '',
    isDefault: false,
    soul: '',
    avatar: { kind: 'unchanged' },
    disabledSkills: ['dogfood'],
    enabledToolsets: ['web'],
    enabledMcpServers: ['github-mcp'],
  };
  const html = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'arch' },
      activeBotId: 'arch',
      roster: [{ id: 'arch', displayName: '架构老王', model: '', isDefault: false, hasDraft: true }],
      activeDetail: botDetail({
        id: 'arch',
        displayName: '架构老王',
        isDefault: false,
        toolsets: {
          authoritative: true,
          rows: [
            { id: 'web', label: '联网检索', enabled: true, description: 'web_search', toolCount: 2 },
            { id: 'browser', label: '浏览器', enabled: false, description: 'navigate', toolCount: 4 },
          ],
        },
        skills: {
          authoritative: true,
          rows: [
            { id: 'codebase-inspection', label: 'codebase-inspection', enabled: true },
            { id: 'dogfood', label: 'dogfood', enabled: false },
          ],
        },
        mcpServers: {
          authoritative: true,
          rows: [
            { id: 'github-mcp', label: 'github-mcp', enabled: true, transport: 'stdio', toolCount: 9, online: true },
            { id: 'playwright', label: 'playwright', enabled: true, transport: 'http', online: undefined },
          ],
        },
      }),
      activeDraft: draft,
    }),
  });
  assert.equal((html.match(/data-bot-capability=/g) || []).length, 6, '三类清单都必须逐项渲染开关');
  assert.ok(html.includes('data-bot-capability="web"'));
  assert.ok(html.includes('data-bot-capability="dogfood"'));
  const capRowTags = html.match(/<div[^>]*data-bot-capability-row="[^"]+"[^>]*>/g) ?? [];
  assert.equal(capRowTags.length, 6, '三类清单的 6 个能力行都必须渲染 data-bot-capability-row');
  for (const tag of capRowTags) {
    assert.equal(tag.includes('border-primary-border'), false, `已启用 capability/skill/MCP 行不得画外框: ${tag}`);
    assert.equal(tag.includes('bg-primary-subtle'), false, `已启用 capability/skill/MCP 行不得画底色框: ${tag}`);
    assert.equal(/\bborder\b/.test(tag), false, `能力行容器不得含 border 类: ${tag}`);
  }
  const capListSrc = readSettingsSource('BotCapabilityList.tsx');
  assert.equal(capListSrc.includes('border-primary-border'), false, 'BotCapabilityList 不得为选中行添加外框');
  assert.equal(capListSrc.includes('bg-primary-subtle'), false, 'BotCapabilityList 不得为选中行添加底色框');
  assert.ok(html.includes(t('bot.mcpOnline')), '已连接 MCP 必须显示在线');
  assert.ok(html.includes(t('bot.mcpUnknown')), '探活没有结论时必须显示状态未知');
  assert.equal(html.includes(t('bot.mcpOffline')), false, '未知状态不得被画成离线红灯');
  assert.ok(html.includes(t('bot.memoryTitle')));
  assert.ok(html.includes(t('bot.memoryNotice')));
  assert.equal(html.includes('id="bot-memory"'), false, '长期记忆不得提供编辑入口');

  const readonly = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'arch' },
      activeBotId: 'arch',
      roster: [{ id: 'arch', displayName: '架构老王', model: '', isDefault: false, hasDraft: false }],
      activeDetail: botDetail({ id: 'arch', displayName: '架构老王', isDefault: false }),
    }),
  });
  assert.ok(readonly.includes(t('bot.capabilityReadonly')), '非权威清单必须提示只读');
});

test('BOT 确认横幅：网关要求二次确认时保留草稿并给出「仍然保存」', () => {
  setLocale('zh-CN');
  const draft = {
    displayName: '架构老王',
    description: '',
    model: 'expensive/model',
    provider: 'p',
    isDefault: false,
    soul: '',
    avatar: { kind: 'unchanged' },
    disabledSkills: [],
    enabledToolsets: [],
    enabledMcpServers: [],
  };
  const html = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'arch' },
      activeBotId: 'arch',
      roster: [{ id: 'arch', displayName: '架构老王', model: draft.model, isDefault: false, hasDraft: true }],
      activeDetail: botDetail({ id: 'arch', displayName: '架构老王', model: draft.model, provider: 'p', isDefault: false }),
      activeDraft: draft,
      confirmPending: { message: '该模型单价较高，需要确认' },
    }),
  });
  assert.ok(html.includes('data-bot-confirm="true"'));
  assert.ok(html.includes('该模型单价较高，需要确认'), '必须原样透出网关原文');
  assert.ok(html.includes(t('bot.confirmSave')));
  assert.ok(html.includes(t('bot.confirmDismiss')));
  assert.ok(
    /data-bot-confirm="true"[^>]*role="status"|role="status"[^>]*data-bot-confirm="true"/.test(html),
    '确认横幅必须是礼貌播报，不能与错误横幅抢 alert',
  );
});

test('BOT 横幅互斥：确认态存在时不得同时渲染错误横幅（避免双次打断式播报）', () => {
  setLocale('zh-CN');
  const draft = {
    displayName: '架构老王',
    description: '',
    model: 'expensive/model',
    provider: 'p',
    isDefault: false,
    soul: '',
    avatar: { kind: 'unchanged' },
    disabledSkills: [],
    enabledToolsets: [],
    enabledMcpServers: [],
  };
  const html = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'arch' },
      activeBotId: 'arch',
      roster: [{ id: 'arch', displayName: '架构老王', model: draft.model, isDefault: false, hasDraft: true }],
      activeDetail: botDetail({ id: 'arch', displayName: '架构老王', model: draft.model, provider: 'p', isDefault: false }),
      activeDraft: draft,
      errorBanner: 'gateway 500',
      confirmPending: { message: '需确认' },
    }),
  });
  assert.ok(html.includes('data-bot-confirm="true"'));
  assert.equal(html.includes('gateway 500'), false, '错误横幅与确认横幅不得同时出现');
});

test('BOT 状态位置：外观分区渲染两个选项，选中态与快照一致', () => {
  setLocale('zh-CN');
  const stageHtml = render({ section: 'appearance', presenceLayout: 'stage' });

  /**
   * 【为什么这里写死中文字面量而不是调 t()】
   * 组件与测试同时调 t() 会形成循环自证：某个 key 从字典里丢失时，两边会
   * 一起退化成同一个 key 字面量（`settings.presenceTitle`），断言仍然通过，
   * 于是「文案丢了」这种用户立刻能看见的缺陷在全绿里藏住。
   * 硬编码期望值让测试独立于字典，字典缺 key 时这里必然红。
   */
  assert.ok(stageHtml.includes('BOT 状态'), '必须渲染「BOT 状态」段（字典缺失时这里会红）');
  assert.ok(stageHtml.includes('对话区顶部'), '必须渲染「对话区顶部」选项');
  assert.ok(stageHtml.includes('输入框上方'), '必须渲染「输入框上方」选项');

  // 【变异杀伤力】把 snapshot.presenceLayout 改成 dock 后，选中态必须跟着换，
  //   否则「切换不生效」这类缺陷会全绿通过。
  const dockHtml = render({ section: 'appearance', presenceLayout: 'dock' });
  const pressedOf = (html, label) => {
    const match = new RegExp(`aria-pressed="(true|false)"[^>]*>${label}`).exec(html);
    return match?.[1] ?? null;
  };
  assert.equal(pressedOf(stageHtml, '对话区顶部'), 'true', 'stage 快照下必须选中对话区顶部');
  assert.equal(pressedOf(stageHtml, '输入框上方'), 'false');
  assert.equal(pressedOf(dockHtml, '输入框上方'), 'true', 'dock 快照下必须选中输入框上方');
  assert.equal(pressedOf(dockHtml, '对话区顶部'), 'false');
});

test('对话区宽度：外观分区渲染窄/较宽/全宽三档选项，选中态与快照一致', () => {
  const pressedOf = (html, label) => {
    const match = new RegExp(`aria-pressed="(true|false)"[^>]*>${label}`).exec(html);
    return match?.[1] ?? null;
  };

  setLocale('zh-CN');
  const narrowHtml = render({ section: 'appearance', conversationWidth: 'narrow' });
  const wideHtml = render({ section: 'appearance', conversationWidth: 'wide' });
  const fullHtml = render({ section: 'appearance', conversationWidth: 'full' });

  assert.ok(wideHtml.includes('对话区宽度'), '必须渲染「对话区宽度」标签');
  assert.equal(pressedOf(narrowHtml, '窄'), 'true');
  assert.equal(pressedOf(narrowHtml, '较宽'), 'false');
  assert.equal(pressedOf(narrowHtml, '全宽'), 'false');

  assert.equal(pressedOf(wideHtml, '窄'), 'false');
  assert.equal(pressedOf(wideHtml, '较宽'), 'true');
  assert.equal(pressedOf(wideHtml, '全宽'), 'false');

  assert.equal(pressedOf(fullHtml, '窄'), 'false');
  assert.equal(pressedOf(fullHtml, '较宽'), 'false');
  assert.equal(pressedOf(fullHtml, '全宽'), 'true');

  setLocale('en-US');
  const enHtml = render({ section: 'appearance', locale: 'en', conversationWidth: 'full' });
  assert.ok(enHtml.includes('Conversation width'));
  assert.equal(pressedOf(enHtml, 'Narrow'), 'false');
  assert.equal(pressedOf(enHtml, 'Wide'), 'false');
  assert.equal(pressedOf(enHtml, 'Full'), 'true');

  // 【真值表一致性】UI 档位必须与 CONVERSATION_WIDTH_MODES 同序同集：
  // 未来新增第 4 档而 SettingsModal 硬编码未跟随时，这里必红（当前仅 3 档时不会误报）。
  const renderedModes = (label, html) => {
    const group = new RegExp(`aria-label="${label}"[^>]*>([\\s\\S]*?)</div>`).exec(html)?.[1] ?? '';
    return [...group.matchAll(/data-segmented-value="([^"]+)"/g)].map((match) => match[1]);
  };
  assert.deepEqual(renderedModes('对话区宽度', wideHtml), [...CONVERSATION_WIDTH_MODES], 'zh 档位必须与真值表同序同集');
  assert.deepEqual(renderedModes('Conversation width', enHtml), [...CONVERSATION_WIDTH_MODES], 'en 档位必须与真值表同序同集');

  setLocale('zh-CN');
});

test('语言切换是真实生效的：同一份快照在两种 locale 下文案不同', () => {
  setLocale('zh-CN');
  const zh = render({ locale: 'zh', section: 'about' });
  setLocale('en-US');
  const en = render({ locale: 'en', section: 'about' });
  setLocale('zh-CN');

  assert.notEqual(zh, en, '两种语言必须产出不同文本');
  /**
   * 【规则】两侧都用硬编码锚点，不用 t()。
   * 中文侧断言"关于"，英文侧断言 "About"——任一语言字典缺 key 都会立刻红。
   */
  assert.ok(zh.includes('关于'), '中文界面必须显示「关于」');
  assert.ok(en.includes('About'), '英文界面必须显示 "About"');
  assert.equal(
    zh.includes('settings.about'),
    false,
    '中文界面不得出现未翻译的 key 字面量（这是字典缺 key 的直接症状）',
  );
  assert.equal(
    en.includes('settings.about'),
    false,
    '英文界面不得出现未翻译的 key 字面量',
  );
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

test('设置中心弹窗尺寸：按主窗口视口自适应放大，不再写死 900×680 小窗', () => {
  setLocale('zh-CN');
  const html = render();
  const dialogTagMatch = html.match(/<div[^>]*data-testid="settings-dialog"[^>]*>/);
  assert.ok(dialogTagMatch, '必须渲染 settings-dialog 容器');
  const dialogTag = dialogTagMatch[0];
  assert.ok(dialogTag.includes('clamp(900px, 88vw, 1440px)'), '弹窗宽度必须使用视口自适应 clamp(900px, 88vw, 1440px)');
  assert.ok(dialogTag.includes('clamp(620px, 86vh, 960px)'), '弹窗高度必须使用视口自适应 clamp(620px, 86vh, 960px)');
  assert.ok(dialogTag.includes('calc(100vw - 48px)'), '弹窗最大宽度必须约束在主窗口安全边距内');
  assert.ok(dialogTag.includes('calc(100vh - 48px)'), '弹窗最大高度必须约束在主窗口安全边距内');
  assert.equal(dialogTag.includes('min(680px, calc(100vh - 96px))'), false, '不得保留旧版 680px 固定高度上限');
  assert.equal(/width:\s*900px/.test(dialogTag), false, '不得保留旧版 900px 固定宽度');
  assert.ok(html.includes('class="flex w-56 shrink-0 flex-col border-r border-border-subtle bg-sidebar"'), '左侧导航栏应使用 8pt 对齐的 w-56 (224px)');
});

/* -------------------------------------------------------------------------- */
/* P0：弹窗族收编 primitives/Dialog 后的回归守卫                                */
/* -------------------------------------------------------------------------- */

const SETTINGS_SRC_DIR = path.resolve(import.meta.dirname, '../src/components-react/settings');
const DIALOG_FAMILY = [
  'SettingsModal.tsx',
  'ModelPicker.tsx',
  'ProvidersAdminPanel.tsx',
  'BotManagerView.tsx',
  'McpAddDialog.tsx',
  'McpRemoveConfirmDialog.tsx',
  'SkillDetailDialog.tsx',
  'SkillInstallDialog.tsx',
];

function readSettingsSource(file) {
  return fs.readFileSync(path.join(SETTINGS_SRC_DIR, file), 'utf8');
}

test('弹窗族遮罩只有一档：不得再手写 40% / 60% 遮罩或自拼 fixed 遮罩容器', () => {
  for (const file of DIALOG_FAMILY) {
    const source = readSettingsSource(file);
    assert.equal(source.includes('bg-backdrop/40'), false, `${file} 不得再手写 40% 遮罩（全族只有 /80 一档）`);
    assert.equal(source.includes('bg-backdrop/60'), false, `${file} 不得再手写 60% 遮罩（全族只有 /80 一档）`);
    assert.equal(
      source.includes('fixed inset-0 z-50 flex items-center justify-center bg-backdrop'),
      false,
      `${file} 不得自拼遮罩容器，必须使用 primitives/Dialog 的 DialogContent`,
    );
  }
  // 正向：主弹窗确实走 Dialog 原语，而不是只把字符串删干净。
  const modal = readSettingsSource('SettingsModal.tsx');
  assert.ok(modal.includes("from '../primitives/Dialog.js'"), 'SettingsModal 必须 import Dialog 原语');
  assert.ok(modal.includes('<DialogContent'), 'SettingsModal 必须渲染 DialogContent');
});

test('Esc 归属单一层栈：弹窗族不得再自持 window keydown 或手写 Escape 分支', () => {
  for (const file of DIALOG_FAMILY) {
    const source = readSettingsSource(file);
    assert.equal(
      /window\.addEventListener\(\s*['"]keydown['"]/.test(source),
      false,
      `${file} 不得自持 window keydown：同层多个监听会让 Esc 一次关掉两层`,
    );
    assert.equal(
      /if \(event\.key === ['"]Escape['"]\)/.test(source),
      false,
      `${file} 不得手写 Escape 分支，Esc 分层由 Radix DismissableLayer 栈负责`,
    );
  }
  // 正向：IME 保护仍然保留在 Dialog 的 onEscapeKeyDown 上，不能连它一起删。
  const modal = readSettingsSource('SettingsModal.tsx');
  assert.ok(modal.includes('onEscapeKeyDown'), '设置主弹窗必须保留输入法 Esc 保护钩子');
  assert.ok(modal.includes('isComposing'), 'Esc 保护必须识别输入法组合态');
});

test('关闭入口归位：左栏不再承担关闭职责，关闭按钮只出现在右侧顶栏', () => {
  setLocale('zh-CN');
  const html = render();
  const aside = html.match(/<aside[\s\S]*?<\/aside>/);
  assert.ok(aside, '必须渲染左侧导航栏');
  assert.equal(
    aside[0].includes(`aria-label="${t('settings.close')}"`),
    false,
    '左栏标题旁不得再放关闭按钮（与二级弹窗的右上角关闭习惯相悖）',
  );
  const sectionStart = html.indexOf('<section');
  assert.ok(sectionStart > 0, '必须渲染右侧内容区');
  assert.ok(
    html.slice(sectionStart).includes(`aria-label="${t('settings.close')}"`),
    '右侧顶栏必须有明确的关闭入口',
  );
});

test('BOT 离场确认：脏稿拦截命中时给出取消 / 保留草稿 / 放弃修改三条出路', () => {
  setLocale('zh-CN');
  const html = render({
    section: 'agents',
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'arch' },
      activeBotId: 'arch',
      roster: [{ id: 'arch', displayName: '架构老王', model: '', isDefault: false, hasDraft: true }],
      activeDetail: botDetail({ id: 'arch', displayName: '架构老王', isDefault: false }),
      exitPrompt: { target: { kind: 'close' } },
    }),
  });
  assert.ok(html.includes(t('bot.discardConfirmTitle')), '离场确认必须有标题');
  assert.ok(html.includes(t('bot.discardConfirmBody')), '离场确认必须说明两种后果');
  assert.ok(html.includes(t('bot.discardBtn')), '必须有「放弃修改」出路');
  assert.ok(html.includes(t('bot.keepDraftBtn')), '必须有「保留草稿并离开」出路');
  assert.ok(html.includes(t('settings.cancel')), '必须有「取消」留在当前');
  assert.equal(html.includes('data-bot-confirm="true"'), false, '离场确认与保存二次确认是两件事，不得复用同一横幅');
});

test('BOT 表单：设为默认开关双向绑定草稿 isDefault', () => {
  setLocale('zh-CN');
  const build = (isDefault) =>
    render({
      section: 'agents',
      botManagement: botManagement({
        status: { status: 'idle', activeBotId: 'arch' },
        activeBotId: 'arch',
        roster: [{ id: 'arch', displayName: '架构老王', model: '', isDefault, hasDraft: false }],
        activeDetail: botDetail({ id: 'arch', displayName: '架构老王', isDefault }),
      }),
    });

  const onHtml = build(true);
  assert.ok(onHtml.includes(t('bot.setDefault')), '表单必须渲染设为默认开关');
  assert.ok(onHtml.includes(t('bot.setDefaultHint')), '开关必须解释其作用范围');
  assert.ok(onHtml.includes('id="bot-set-default"'), '开关必须有可关联的 id');
  assert.ok(
    /role="switch"[^>]*aria-checked="true"/.test(onHtml) || /aria-checked="true"[^>]*role="switch"/.test(onHtml),
    '开启态必须来自草稿 isDefault',
  );

  // 反向用例：硬编码 checked={true} 会在这里变红。
  const offHtml = build(false);
  assert.ok(
    /role="switch"[^>]*aria-checked="false"/.test(offHtml) || /aria-checked="false"[^>]*role="switch"/.test(offHtml),
    '关闭态必须渲染 aria-checked="false"，开关必须真实双向绑定',
  );
});

test('连接测试结论失效判定：四个字段任一变更即作废，未测试过不作废', () => {
  const base = { url: 'http://127.0.0.1:9119', username: 'u', password: '', profileName: 'default' };
  assert.equal(isGatewayTestStale(null, base), false, '未点过测试时不得把外部产生的结论判为过期');
  assert.equal(isGatewayTestStale(base, { ...base }), false, '草稿未变时结论继续有效');
  for (const patch of [{ url: 'http://other:9119' }, { username: 'v' }, { password: 'p' }, { profileName: 'other' }]) {
    assert.equal(
      isGatewayTestStale(base, { ...base, ...patch }),
      true,
      `字段 ${Object.keys(patch)[0]} 变更后旧结论必须作废`,
    );
  }
});

test('连接表单草稿归属弹窗层：面板不得再自持 useState，测试指纹与草稿同生命周期', () => {
  const modal = readSettingsSource('SettingsModal.tsx');
  assert.ok(modal.includes('const [gatewayDraft, setGatewayDraft] = React.useState<GatewayDraft>'), '草稿必须提升到常驻的 SettingsModal');
  assert.ok(modal.includes('const [testedGatewayDraft, setTestedGatewayDraft]'), '测试指纹必须与草稿一起提升');
  assert.ok(modal.includes('testedDraft: testedGatewayDraft'), '测试指纹必须随绑定传入面板');
  const panelStart = modal.indexOf('function ConnectionPanel(');
  const panelEnd = modal.indexOf('function AboutPanel(');
  assert.ok(panelStart > 0 && panelEnd > panelStart, '必须能定位 ConnectionPanel 实现');
  const panel = modal.slice(panelStart, panelEnd);
  assert.equal(/React\.useState<GatewayDraft>/.test(panel), false, 'ConnectionPanel 不得再自持草稿 state（切 Tab 会卸载并丢失）');
  assert.ok(panel.includes('isGatewayTestStale(testedDraft, draft)'), '失效判定必须走纯函数，不能只留标识符');
});

test('设置项检索：真实配置项名可命中，且空查询不干扰导航', () => {
  setLocale('zh-CN');
  const hitsOf = (query) => filterSettingsEntries(SETTINGS_SEARCH_ENTRIES, query, (key) => t(key)).map((entry) => entry.id);

  assert.deepEqual(hitsOf('字号'), ['font-size'], '「字号」必须命中文字大小');
  assert.deepEqual(hitsOf('对话区宽度'), ['conversation-width'], '「对话区宽度」必须命中对话区宽度');
  assert.deepEqual(hitsOf('密码'), ['gateway-password'], '「密码」必须命中登录密码');
  assert.deepEqual(hitsOf('语言'), ['language']);
  assert.deepEqual(hitsOf('SOUL'), ['bot-soul'], '大小写无关');
  assert.deepEqual(hitsOf('版本'), ['about-version']);
  assert.deepEqual(hitsOf('soul'), ['bot-soul']);
  assert.equal(hitsOf('').length, 0, '空查询不返回条目（导航仍显示全量分区）');
  assert.equal(hitsOf('不存在的设置项').length, 0);

  setLocale('en-US');
  assert.deepEqual(
    filterSettingsEntries(SETTINGS_SEARCH_ENTRIES, 'password', (key) => t(key)).map((entry) => entry.id),
    ['gateway-password'],
    '英文查询同样命中',
  );
  assert.deepEqual(
    filterSettingsEntries(SETTINGS_SEARCH_ENTRIES, 'Conversation width', (key) => t(key)).map((entry) => entry.id),
    ['conversation-width'],
    '英文查询必须命中对话区宽度',
  );
  setLocale('zh-CN');
});

test('Select 必须使用单选语义：MenuRadioGroup + MenuRadioItem，禁止手绘选中图标', () => {
  const select = fs.readFileSync(path.resolve(import.meta.dirname, '../src/components-react/primitives/Select.tsx'), 'utf8');
  assert.ok(select.includes('MenuRadioGroup'), '必须用 RadioGroup 提供 role="menuitemradio" 语义');
  assert.ok(select.includes('MenuRadioItem'), '选项必须是 RadioItem，屏幕阅读器才能读到 aria-checked');
  assert.equal(/<Check\b/.test(select), false, '选中态不得由业务手绘 Check：ItemIndicator 负责指示器');
  const menu = fs.readFileSync(path.resolve(import.meta.dirname, '../src/components-react/primitives/Menu.tsx'), 'utf8');
  // 必须断言底层真的用了 Radix RadioItem：只查 ItemIndicator 时，把 RadioItem 换成 Item 仍然全绿。
  assert.ok(menu.includes('<MenuPrimitive.RadioItem'), '底层必须是 Radix RadioItem，否则 role/aria-checked 全丢');
  assert.ok(menu.includes('MenuPrimitive.ItemIndicator'), 'RadioItem 必须自带 ItemIndicator');
});

test('检索索引与锚点双向一致：索引项都能跳到，面板锚点也都可被搜到', () => {
  const allSource = [
    readSettingsSource('SettingsModal.tsx'),
    readSettingsSource('BotManagerView.tsx'),
    readSettingsSource('ProvidersAdminPanel.tsx'),
    readSettingsSource('ModelPicker.tsx'),
  ].join('\n');
  const entryIds = new Set(SETTINGS_SEARCH_ENTRIES.map((entry) => entry.id));

  // 正向：每个索引项都能在面板里找到字面量锚点。
  for (const entry of SETTINGS_SEARCH_ENTRIES) {
    const hasAnchor =
      allSource.includes(`anchorId="${entry.id}"`) || allSource.includes(`data-settings-anchor="${entry.id}"`);
    assert.ok(hasAnchor, `索引条目 ${entry.id} 找不到对应锚点：用户会搜到却跳不过去`);
  }

  // 反向：面板里每个字面量锚点都必须登记进索引，否则用户永远搜不到它。
  const literalAnchors = new Set(
    // 只接受字面量 id（小写字母/数字/连字符）：排除 `data-settings-anchor="${entry.id}"` 这类模板表达式。
    Array.from(allSource.matchAll(/(?:anchorId|data-settings-anchor)="([a-z0-9-]+)"/g)).map((match) => match[1]),
  );
  assert.ok(literalAnchors.size > 0, '必须能提取到锚点（防止正则失效后空循环假绿）');
  for (const anchor of literalAnchors) {
    assert.ok(entryIds.has(anchor), `锚点 ${anchor} 未登记进检索索引，用户搜不到它`);
  }
});

test('跳转调度器：每次 schedule 都登记，dispose 后全部取消且幂等', () => {
  const timers = new Map();
  const cleared = [];
  let nextId = 1;
  const scheduler = createJumpScheduler({
    setTimeout: (fn) => {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => {
      cleared.push(id);
      timers.delete(id);
    },
  });

  scheduler.schedule(() => {}, 60);
  scheduler.schedule(() => {}, 1600);
  assert.equal(scheduler.pending(), 2, '每个 schedule 都必须登记句柄');

  scheduler.dispose();
  assert.deepEqual(cleared.sort((a, b) => a - b), [1, 2], 'dispose 必须取消全部已登记句柄');
  assert.equal(scheduler.pending(), 0);

  scheduler.dispose();
  assert.equal(cleared.length, 2, 'dispose 必须幂等：重复调用不得再次取消');
});

test('跳转调度器：已执行的回调自行出队，不会被重复取消', () => {
  const timers = new Map();
  const cleared = [];
  let nextId = 1;
  const scheduler = createJumpScheduler({
    setTimeout: (fn) => {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => cleared.push(id),
  });

  let ran = 0;
  scheduler.schedule(() => {
    ran += 1;
  }, 10);
  const pendingFn = timers.get(1);
  assert.equal(typeof pendingFn, 'function');
  pendingFn();

  assert.equal(ran, 1);
  assert.equal(scheduler.pending(), 0, '执行后必须出队');
  scheduler.dispose();
  assert.deepEqual(cleared, [], '已执行句柄不得再被取消');
});

test('设置弹窗不得绕过调度器直接使用 window.setTimeout', () => {
  const modal = readSettingsSource('SettingsModal.tsx');
  assert.ok(modal.includes('createJumpScheduler'), '跳转定时器必须走可清理的调度器');
  assert.equal(
    /window\.setTimeout\(\(\) => scrollToAnchor/.test(modal),
    false,
    '递归重试不得绕过 schedule 封装',
  );

  /*
   * 按括号配平切出每个 useEffect 块，逐块断言。
   * 【为什么不用正则窗口】`[\s\S]{0,200}?` 会从卸载 effect 的空壳一路扫到下一个
   *   关闭 effect 的 dispose()，使"保留空壳、删掉 dispose"这种半吊子改动逃逸。
   */
  const blocks = [];
  for (let i = modal.indexOf('React.useEffect('); i >= 0; i = modal.indexOf('React.useEffect(', i + 1)) {
    let depth = 0;
    for (let j = i + 'React.useEffect'.length; j < modal.length; j += 1) {
      if (modal[j] === '(') depth += 1;
      else if (modal[j] === ')' && (depth -= 1) === 0) {
        blocks.push(modal.slice(i, j + 1));
        break;
      }
    }
  }
  assert.ok(blocks.length >= 2, '必须能切出 effect 块（防止解析失效后空循环假绿）');

  const unmountEffect = blocks.find((block) => /\(\) => \(\) => \{/.test(block));
  assert.ok(unmountEffect, '必须存在卸载清理 effect');
  assert.ok(unmountEffect.includes('jumpSchedulerRef.current?.dispose()'), '卸载 effect 必须调用 dispose');

  const closeEffect = blocks.find((block) => /if \(!snapshot\.isOpen\)/.test(block) && block.includes('jumpSchedulerRef'));
  assert.ok(closeEffect, '必须存在关闭清理 effect');
  assert.ok(closeEffect.includes('jumpSchedulerRef.current?.dispose()'), '关闭 effect 必须调用 dispose');
});

test('连点两次检索结果只保留最后一次跳转', () => {
  const modal = readSettingsSource('SettingsModal.tsx');
  assert.ok(
    /const scheduler = jumpSchedulerRef\.current;[\s\S]{0,120}?scheduler\.dispose\(\);/.test(modal),
    'jumpToEntry 必须先 dispose 上一轮，否则两次 scrollIntoView 会互相竞争',
  );
});

test('模型下拉占位互斥：空目录与未绑定叠加时只保留一个占位', () => {
  const labels = { offline: 'OFFLINE', unbound: 'UNBOUND', catalogUnavailable: 'NO_CATALOG' };

  const emptyAll = buildModelSelectGroups({ groups: [], currentModel: '', currentModelOffline: false, labels });
  assert.equal(emptyAll.length, 1, '空目录 + 未绑定只能产生一个分组，否则出现重复 key 与重复占位');
  assert.equal(emptyAll[0].options.length, 1);
  assert.equal(emptyAll[0].options[0].label, 'NO_CATALOG', '目录不可用优先于未绑定');
  assert.equal(emptyAll[0].options[0].disabled, true);

  const offline = buildModelSelectGroups({
    groups: [{ name: 'Anthropic', models: [{ id: 'claude-sonnet-5', name: 'Claude Sonnet 5' }] }],
    currentModel: 'legacy/retired',
    currentModelOffline: true,
    labels,
  });
  assert.equal(offline.length, 2, '离线占位 + 一个真实分组');
  assert.equal(offline[0].options[0].value, 'legacy/retired');
  assert.equal(offline[0].options[0].disabled, true);
  assert.equal(offline[1].options[0].value, 'claude-sonnet-5');

  // 目录正常但未绑定模型（新建 BOT 的默认态）：只能出 UNBOUND 占位，不得出 catalogUnavailable。
  const unbound = buildModelSelectGroups({
    groups: [{ name: 'Anthropic', models: [{ id: 'claude-sonnet-5', name: 'Claude Sonnet 5' }] }],
    currentModel: '',
    currentModelOffline: false,
    labels,
  });
  assert.equal(unbound.length, 2);
  assert.equal(unbound[0].options[0].label, 'UNBOUND');
  assert.equal(unbound[0].options[0].disabled, true);
  assert.equal(unbound[1].options[0].value, 'claude-sonnet-5');
});

test('提供商页作用域显性化：顶部提供「作用 BOT」切换器并消费花名册', () => {
  setLocale('zh-CN');
  const html = render({
    section: 'providers',
    providerViews: { status: 'ready', data: [] },
    bots: [
      { profile: 'arch', displayName: '架构老王' },
      { profile: 'ops', displayName: '运维老李' },
    ],
    scopedProfile: 'arch',
  });
  assert.ok(html.includes(`aria-label="${t('settings.viewByBot')}"`), '必须有作用域切换器，明确删除/设为默认作用于哪个 BOT');
  assert.ok(html.includes('架构老王'), '选项必须来自 BOT 花名册（当前作用域可见）');
});

test('卡片层级：提供商行与 MCP 行必须消费 Surface，主题卡靠受光线与投影撑层级', () => {
  const providers = readSettingsSource('ProvidersAdminPanel.tsx');
  assert.ok(
    providers.includes('<Surface level="raised" padding="normal" elevated'),
    'ProviderRow 必须消费 Surface 原子并使用 raised 档（card 与 popover 同值时靠派生色建立层级）',
  );
  assert.equal(
    providers.includes('specular-top rounded-card border border-border-subtle bg-card'),
    false,
    '禁止手写 Surface 同构串（双标实现）',
  );

  const modal = readSettingsSource('SettingsModal.tsx');
  assert.ok(
    modal.includes('specular-top shadow-card'),
    '主题卡必须带受光线与投影：默认皮肤下 card 与 popover 同色，只靠边框无法撑起层级',
  );
  assert.ok(modal.includes('xl:grid-cols-3'), '三列必须用 xl 断点，避免 1024~1280 视口下每列被压到 204px');
  assert.ok(
    modal.includes("classList.add('outline-2', 'outline-primary', 'outline-offset-2')"),
    '跳转高亮必须用 outline：ring 走 box-shadow，会覆盖 Surface 的 shadow-card',
  );
  assert.equal(/classList\.add\('ring-2'/.test(modal), false, '禁止用 ring 做高亮（阴影会闪失一次）');
  assert.equal(
    /node\.classList\.add\('ring-2', 'ring-primary', 'rounded-card'\)/.test(modal),
    false,
    '跳转高亮不得改圆角（会触发一次重排）',
  );

  // 派生表面：card 与 popover 同值的皮肤下，唯一不触碰全局色值的层级解法。
  const css = fs.readFileSync(path.resolve(import.meta.dirname, '../src/tailwind-entry.css'), 'utf8');
  assert.ok(css.includes('@utility surface-raised'), '派生表面必须在 Token 入口登记');
  assert.ok(
    css.includes('color-mix(in oklab, var(--card) 92%, var(--foreground) 8%)'),
    '派生色必须由既有 token 计算，不得写死色值',
  );
  assert.ok(
    /@utility surface-raised \{\s*background-color: var\(--card\);/.test(css),
    '必须保留 var(--card) 兜底：旧环境退化为原卡片色，而不是透明',
  );

  // surface-raised 与 bg-* 同属背景色，必须能被 cn 按书写顺序正确合并。
  assert.equal(cn('bg-primary-subtle', 'surface-raised'), 'surface-raised', '后写的派生表面必须胜出');
  assert.equal(cn('surface-raised', 'bg-primary-subtle'), 'bg-primary-subtle', '反向书写时后者同样胜出');
  assert.ok(
    modal.includes("'border-border-subtle surface-raised hover:bg-card-hover'"),
    '主题卡未选中态必须使用派生表面（浅色皮肤下 bg-card 与浮层同值）',
  );
});

test('术语基准：设置中心统一 BOT / Bot，技能与 MCP 服务器不再中英混用', () => {
  setLocale('zh-CN');
  // 硬编码期望值：与组件同时调 t() 会形成循环自证，字典丢 key 时两边一起退化。
  assert.equal(t('settings.presenceTitle'), 'BOT 状态');
  assert.equal(t('settings.providerScopeAll'), '所有 BOT 都在用');
  assert.equal(t('settings.providerBindingLegend'), '绿环 = 该 BOT 当前默认模型所属的提供商');
  assert.equal(t('settings.gatewayProfile'), '默认配置');
  assert.equal(t('settings.sectionProvidersDesc'), '提供商、密钥与可用模型');
  assert.equal(t('bot.skillsTitle'), '技能');
  assert.equal(t('bot.segment.skills'), '技能');
  assert.equal(t('bot.mcpTitle'), 'MCP 服务器');
  assert.equal(t('bot.segment.mcp_servers'), 'MCP 服务器');
  assert.equal(t('rail.pinnedBots'), 'BOT');

  setLocale('en-US');
  assert.equal(t('settings.presenceTitle'), 'BOT status');
  assert.equal(t('settings.providerScopeAll'), 'Used by every BOT');
  assert.equal(t('bot.skillsTitle'), 'Skills');
  assert.equal(t('bot.mcpTitle'), 'MCP servers');
  assert.equal(t('rail.pinnedBots'), 'Bots');
  setLocale('zh-CN');
});

test('设置中心组件不得硬编码实体称谓（必须全部走 t()）', () => {
  for (const file of [
    'SettingsModal.tsx',
    'BotManagerView.tsx',
    'ProvidersAdminPanel.tsx',
    'ModelPicker.tsx',
    'BotCapabilityList.tsx',
    'McpAddDialog.tsx',
    'McpRemoveConfirmDialog.tsx',
    'SkillDetailDialog.tsx',
    'SkillInstallDialog.tsx',
  ]) {
    const source = readSettingsSource(file);
    // 只看 JSX 文本节点：>Agent< / >智能体< / >Bot< 这类直出文案。
    assert.equal(/>\s*(Agent|智能体|Bot)\s*</.test(source), false, `${file} 不得硬编码实体称谓，必须走 t()`);
  }
});

test('全局 Esc 不得越过弹窗层：已消费的 Esc 必须早退，关闭设置页走脏稿出口', () => {
  const globalKeybinds = fs.readFileSync(
    path.resolve(import.meta.dirname, '../../desktop/src/renderer/dropdownKeybindController.ts'),
    'utf8',
  );
  assert.ok(
    globalKeybinds.includes('if (e.defaultPrevented) return;'),
    'Radix 已在 capture 阶段消费的 Esc 必须早退，否则一次 Esc 会同时关掉二级弹窗与整个设置页',
  );
  assert.equal(
    /state\.isSettingsOpen\s*=\s*false/.test(globalKeybinds),
    false,
    '全局快捷键不得直接关闭设置页，必须经过 requestSettingsExit 的脏稿拦截',
  );
  assert.ok(globalKeybinds.includes('deps.requestSettingsExit()'), 'Ctrl/Cmd+, 与全局 Esc 的关闭方向都必须走唯一出口');
});

test('配置内容必须自适应填满可用宽度：禁止限宽居中留白', () => {
  const modal = readSettingsSource('SettingsModal.tsx');
  assert.equal(/max-w-3xl|max-w-4xl|max-w-5xl/.test(modal), false, '内容区不得限宽：宽屏下必须填满可用宽度');
  assert.equal(/mx-auto/.test(modal), false, '不得用 mx-auto 居中留白');

  const bot = readSettingsSource('BotManagerView.tsx');
  assert.equal(/max-w-4xl|mx-auto/.test(bot), false, 'BOT 面板同样必须自适应，不能单独限宽');

  // 正向：内容容器仍是 flex-1 + 可滚动，收窄窗口时跟随父级收缩，agents 全高布局保留 flex-1 min-h-0。
  assert.ok(modal.includes("'flex-1 overflow-y-auto px-6 py-4 scrollbar-thin'"), '内容区必须保留 flex-1 自适应、滚动与超细滚动条');
  assert.ok(modal.includes("'flex-1 min-h-0'"), 'BOT 工作台须占满弹窗剩余高度');
});

test('二级弹窗高度收敛为语义档位：不得用任意值类或内联 maxHeight 规避审计', () => {
  for (const file of ['ModelPicker.tsx', 'ProvidersAdminPanel.tsx', 'McpAddDialog.tsx', 'McpRemoveConfirmDialog.tsx', 'SkillDetailDialog.tsx', 'SkillInstallDialog.tsx']) {
    const source = readSettingsSource(file);
    assert.equal(source.includes('max-h-['), false, `${file} 不得使用任意值 max-h-[...]`);
    assert.equal(/maxHeight:\s*'min\(/.test(source), false, `${file} 不得用内联 maxHeight 规避任意值审计`);
  }
  assert.ok(readSettingsSource('ModelPicker.tsx').includes('max-h-modal-sm'), '模型弹窗必须使用 max-h-modal-sm 语义档位');
  assert.ok(readSettingsSource('ProvidersAdminPanel.tsx').includes('max-h-modal-md'), '提供商弹窗必须使用 max-h-modal-md 语义档位');
  assert.ok(readSettingsSource('McpAddDialog.tsx').includes('max-h-modal-md'), 'MCP 新增弹窗必须使用 max-h-modal-md 语义档位');
  assert.ok(readSettingsSource('McpRemoveConfirmDialog.tsx').includes('max-h-modal-sm'), 'MCP 移除确认弹窗必须使用 max-h-modal-sm 语义档位');
  assert.ok(readSettingsSource('SkillDetailDialog.tsx').includes('max-h-modal-md'), '技能详情弹窗必须使用 max-h-modal-md 语义档位');
  assert.ok(readSettingsSource('SkillInstallDialog.tsx').includes('max-h-modal-md'), '技能安装弹窗必须使用 max-h-modal-md 语义档位');

  const css = fs.readFileSync(path.resolve(import.meta.dirname, '../src/tailwind-entry.css'), 'utf8');
  assert.ok(css.includes('@utility max-h-modal-sm'), '语义档位必须在 Token 入口登记（禁止散落在业务里）');
  assert.ok(css.includes('@utility max-h-modal-md'), '语义档位必须在 Token 入口登记（禁止散落在业务里）');
  // 值也必须守护：只断言类名存在时，把档位改成 100vh 仍然全绿。
  assert.ok(css.includes('max-height: min(560px, calc(100vh - 96px));'), 'max-h-modal-sm 必须相对视口有界并留出安全边距');
  assert.ok(css.includes('max-height: min(680px, calc(100vh - 96px));'), 'max-h-modal-md 必须相对视口有界并留出安全边距');

  // 新档位必须同时在 tw-merge 登记，否则 `max-h-64 max-h-modal-sm` 会退化为 CSS 顺序决定。
  assert.equal(cn('max-h-64', 'max-h-modal-sm'), 'max-h-modal-sm', '语义档位必须能在 cn() 中覆盖原生 max-h');
  assert.equal(cn('max-h-modal-sm', 'max-h-modal-md'), 'max-h-modal-md', '两个语义档位之间也必须可覆盖');

  // 浮层菜单层级同样收敛为语义档位，禁止业务回到 z-[1200] 任意值。
  assert.ok(css.includes('@utility z-menu'), '浮层菜单层级必须在 Token 入口登记');
  assert.ok(css.includes('z-index: 1200;'), 'z-menu 取值必须高于设置弹窗宿主（z-50）');
  assert.equal(cn('z-50', 'z-menu'), 'z-menu', 'z-menu 必须能覆盖原生 z-50');
});

test('扩展新增、移除确认与技能市场共用弹窗及 BOT 能力运维：SSR 分支与复用守卫', () => {
  setLocale('zh-CN');
  assert.equal(
    renderToStaticMarkup(
      React.createElement(McpAddDialog, {
        open: false,
        targetProfile: 'arch',
        targetLabel: '架构老王',
        installedNames: new Set(),
        onClose: () => {},
        onNotify: () => {},
      }),
    ),
    '',
  );
  const mcpHtml = renderToStaticMarkup(
    React.createElement(McpAddDialog, {
      open: true,
      targetProfile: 'arch',
      targetLabel: '架构老王',
      installedNames: new Set(['github-mcp']),
      onClose: () => {},
      onNotify: () => {},
    }),
  );
  assert.ok(mcpHtml.includes('data-mcp-add-dialog="true"'));
  assert.ok(mcpHtml.includes(t('bot.mcpAddTitle')));
  assert.ok(mcpHtml.includes(t('bot.mcpAddPresetTab')));
  assert.ok(mcpHtml.includes(t('bot.mcpAddCustomTab')));
  assert.ok(mcpHtml.includes('max-h-modal-md'));

  assert.equal(
    renderToStaticMarkup(
      React.createElement(SkillInstallDialog, {
        open: false,
        targetProfile: 'arch',
        installedNames: new Set(),
        onClose: () => {},
        onNotify: () => {},
      }),
    ),
    '',
  );
  const skillHtml = renderToStaticMarkup(
    React.createElement(SkillInstallDialog, {
      open: true,
      targetProfile: 'arch',
      installedNames: new Set(['github']),
      onClose: () => {},
      onNotify: () => {},
    }),
  );
  assert.ok(skillHtml.includes('data-skill-install-dialog="true"'));
  assert.ok(skillHtml.includes(t('bot.skillHubTitle')));
  assert.ok(skillHtml.includes(t('bot.skillHubSearchAction')));
  assert.ok(skillHtml.includes('max-h-modal-md'));

  assert.equal(
    renderToStaticMarkup(
      React.createElement(McpRemoveConfirmDialog, {
        serverName: null,
        busy: false,
        onCancel: () => {},
        onConfirm: () => {},
      }),
    ),
    '',
  );
  const rmOpenHtml = renderToStaticMarkup(
    React.createElement(McpRemoveConfirmDialog, {
      serverName: 'github-mcp',
      busy: false,
      onCancel: () => {},
      onConfirm: () => {},
    }),
  );
  assert.ok(rmOpenHtml.includes('data-mcp-remove-dialog="true"'));
  assert.ok(rmOpenHtml.includes(t('bot.mcpRemoveConfirmTitle')));
  assert.ok(rmOpenHtml.includes('github-mcp'));
  assert.ok(rmOpenHtml.includes(t('bot.mcpRemoveBtn')));
  const rmBusyHtml = renderToStaticMarkup(
    React.createElement(McpRemoveConfirmDialog, {
      serverName: 'github-mcp',
      busy: true,
      onCancel: () => {},
      onConfirm: () => {},
    }),
  );
  assert.ok(rmBusyHtml.includes(t('bot.mcpRemoving')));

  // 审查守卫：共享弹窗、100% 头像防裁切、焦点环、64KB 进度轨道色阶、扩展页作用域对齐及异步 try/catch/finally 锁保护
  const carouselSrc = readSettingsSource('BotHeroCarousel.tsx');
  const managerSrc = readSettingsSource('BotManagerView.tsx');
  const modalSrc = readSettingsSource('SettingsModal.tsx');
  const addDlgSrc = readSettingsSource('McpAddDialog.tsx');
  const skillDlgSrc = readSettingsSource('SkillInstallDialog.tsx');
  assert.ok(carouselSrc.includes("AVATAR_SIZE = '100%'"), '微轨头像尺寸须用 100% 自适应防 13px 字号下裁切');
  assert.ok(carouselSrc.includes('focus-visible:ring-2 focus-visible:ring-ring'), '微轨头像按钮须保留键盘焦点环');
  assert.ok(managerSrc.includes("IDENTITY_AVATAR_SIZE = '100%'"), '身份头头像须用 100% 自适应防裁切');
  assert.ok(managerSrc.includes('bg-card-active') && !managerSrc.includes('h-1 w-16 overflow-hidden rounded-full bg-secondary'), 'SOUL 进度轨道不得使用在 obsidian-gold 与 bg-panel 同色的 bg-secondary');
  assert.equal(managerSrc.includes('mcpRemoveConfirmTitle'), false, 'BotManagerView 必须复用 McpRemoveConfirmDialog，禁止内联拷贝确认弹窗');
  assert.equal(modalSrc.includes('mcpRemoveConfirmTitle'), false, 'SettingsModal 必须复用 McpRemoveConfirmDialog，禁止内联拷贝确认弹窗');
  assert.ok(modalSrc.includes('const targetProfile = snapshot.gateway.profileName'), 'ExtensionsPanel 必须消费主连接 gateway.profileName，不得受 scopedProfile 漂移污染');
  assert.ok(managerSrc.includes('probeEpochRef'), 'BotManagerView MCP 探活须带纪元令牌防止切换 BOT 后慢响应串台');
  assert.ok(managerSrc.includes('testingMcpId === id'), 'BotManagerView 在 MCP 探活期间须锁定同行删除按钮');
  assert.ok(/try\s*\{[\s\S]*finally\s*\{\s*setSubmitting\(false\)/.test(addDlgSrc), 'McpAddDialog 提交锁必须置于 finally 防止 reject 卡死弹窗');
  assert.ok(/try\s*\{[\s\S]*finally\s*\{\s*setInstallingId\(null\)/.test(skillDlgSrc), 'SkillInstallDialog 安装锁必须置于 finally 防止 reject 卡死弹窗');
  assert.ok(skillDlgSrc.includes('flex shrink-0 flex-col overflow-hidden'), 'SkillInstallDialog 列表 Surface 须声明 shrink-0 防止 flex 压缩裁切');
  assert.ok(addDlgSrc.includes('flex shrink-0 flex-col overflow-hidden'), 'McpAddDialog 目录 Surface 须声明 shrink-0 防止 flex 压缩裁切');
});

test('Switch 单色高对比样式、模型/厂商双图标选择器、技能简介与 SkillDetailDialog 全方位回归', () => {
  setLocale('zh-CN');

  // 1. Switch 不得使用高饱和刺眼蓝（bg-primary），必须使用高对比中性单色语义
  const switchSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/components-react/primitives/Switch.tsx'),
    'utf8',
  );
  assert.equal(switchSrc.includes('bg-primary'), false, 'Switch 开启态不得使用 bg-primary（ayu-light/warm-paper 会变刺眼蓝）');
  assert.ok(switchSrc.includes('data-[state=checked]:bg-foreground'), 'Switch 开启态轨底色应使用 --foreground');
  assert.ok(switchSrc.includes('data-[state=checked]:bg-background'), 'Switch 开启态滑块应使用 --background');
  const switchHtml = renderToStaticMarkup(React.createElement(Switch, { checked: true, ariaLabel: 'toggle' }));
  assert.ok(switchHtml.includes('data-state="checked"'));

  // 2. ProviderVendorIcon & GroupedModelSelect 触发器同时渲染模型图标 + 厂商图标
  const anthropicIcon = renderToStaticMarkup(
    React.createElement(ProviderVendorIcon, { providerSlug: 'anthropic', providerName: 'Anthropic' }),
  );
  assert.ok(anthropicIcon.includes('icons/lobe/anthropic.svg'), '已知厂商必须渲染官方 lobe 品牌 SVG');
  const proxyIcon = renderToStaticMarkup(
    React.createElement(ProviderVendorIcon, { providerSlug: 'cpa', providerName: 'CPA 代理' }),
  );
  assert.ok(proxyIcon.includes('vendor-icon--badge') && proxyIcon.includes('>C<'), '代理/转发厂商回落简洁首字母徽章');

  const triggerHtml = renderToStaticMarkup(
    React.createElement(GroupedModelSelect, {
      id: 'bot-model',
      value: 'deepseek-v4.1-flash',
      provider: 'openrouter',
      groups: [
        { id: 'openrouter', name: 'OpenRouter', models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }] },
      ],
      ariaLabel: '主推理模型',
      labels: {
        unbound: '未绑定模型',
        offline: '离线',
        catalogUnavailable: '不可用',
        searchPlaceholder: '搜索',
        emptySearch: '无结果',
      },
      onChange: () => {},
    }),
  );
  assert.ok(triggerHtml.includes('icons/lobe/deepseek'), '触发器必须渲染模型厂商图标');
  assert.ok(triggerHtml.includes('data-model-trigger-vendor="true"') && triggerHtml.includes('icons/lobe/openrouter'), '触发器必须同步渲染接入厂商图标胶囊');

  const unboundHtml = renderToStaticMarkup(
    React.createElement(GroupedModelSelect, {
      id: 'bot-model',
      value: '',
      groups: [{ id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-5.6', name: 'GPT-5.6' }] }],
      ariaLabel: '主推理模型',
      labels: {
        unbound: '未绑定模型',
        offline: '离线',
        catalogUnavailable: '不可用',
        searchPlaceholder: '搜索',
        emptySearch: '无结果',
      },
      onChange: () => {},
    }),
  );
  assert.ok(unboundHtml.includes('未绑定模型') && unboundHtml.includes('data-model-trigger-vendor') === false);

  // 3. BOT 技能分页展示简介与独立详情按钮（严禁嵌套进 label），扩展页支持点击技能打开详情弹窗
  const botHtml = render({
    section: 'agents',
    actionsOverride: { onInspectSkill: async () => ({ ok: true, data: { name: 'github', tags: [], markdown: '# Hi', isPreview: false } }) },
    botManagement: botManagement({
      status: { status: 'idle', activeBotId: 'arch' },
      activeBotId: 'arch',
      roster: [{ id: 'arch', displayName: '架构老王', model: 'deepseek-v4.1-flash', isDefault: false, hasDraft: false }],
      activeDetail: botDetail({
        id: 'arch',
        displayName: '架构老王',
        skills: {
          authoritative: true,
          rows: [{ id: 'github', label: 'github', enabled: true, description: '仓库 PR 与 Issue 协同助手' }],
        },
      }),
    }),
  });
  assert.ok(botHtml.includes('仓库 PR 与 Issue 协同助手'), '技能列表必须展示每项技能简介');
  assert.ok(botHtml.includes('data-bot-capability-inspect="github"'), '提供 onInspectSkill 时技能行须生成详情按钮');
  assert.ok(
    botHtml.includes('flex min-h-7 min-w-0 flex-1 cursor-pointer flex-col justify-center'),
    '能力详情按钮在无简介时仍须维持 ≥28px 触控热区并垂直居中',
  );
  const nestedButtonInLabel = Array.from(botHtml.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)).some((m) =>
    m[1].includes('<button'),
  );
  assert.equal(nestedButtonInLabel, false, '禁止把详情 button 嵌套进 Switch 的 label 内部');

  const extHtml = render({
    section: 'extensions',
    actionsOverride: { onInspectSkill: async () => ({ ok: true, data: { name: 'github', tags: [], markdown: '# Hi', isPreview: false } }) },
    skills: { status: 'ready', data: [{ name: 'github', category: 'official' }] },
  });
  assert.ok(extHtml.includes('data-ext-skill-inspect="github"'), '扩展页技能徽标在支持 inspect 时应可点击查看文档');
  assert.ok(
    extHtml.includes('inline-flex min-h-7 cursor-pointer items-center rounded-full'),
    '扩展页技能按钮热区须 ≥28px 且焦点环贴合胶囊圆角',
  );

  const pickerSrc = readSettingsSource('ModelPicker.tsx');
  assert.ok(pickerSrc.includes('data-model-group') && pickerSrc.includes('flex min-h-7 w-full items-center'), '模型分组标题按钮须维持 ≥28px 热区对齐 InputDock');
  assert.ok(pickerSrc.includes('event.isComposing || event.keyCode === 229'), '模型搜索浮层 Esc 处理须尊重 IME 组词状态');

  // 4. SkillDetailDialog 关闭态与打开态 SSR 及双视图源码契约守护
  assert.equal(
    renderToStaticMarkup(
      React.createElement(SkillDetailDialog, {
        skillName: null,
        targetProfile: 'arch',
        onClose: () => {},
      }),
    ),
    '',
  );
  const skillDetailHtml = renderToStaticMarkup(
    React.createElement(SkillDetailDialog, {
      skillName: 'codebase-inspection',
      targetProfile: 'arch',
      fallbackDescription: '快速追踪源码调用链',
      onClose: () => {},
      onCopy: async () => true,
    }),
  );
  assert.ok(skillDetailHtml.includes('data-skill-detail-dialog="true"'));
  assert.ok(skillDetailHtml.includes('data-skill-detail-scroll="true"'));
  assert.ok(skillDetailHtml.includes('快速追踪源码调用链'));
  assert.ok(skillDetailHtml.includes(t('bot.skillViewRendered')));
  assert.ok(skillDetailHtml.includes(t('bot.skillViewRaw')));
  assert.ok(skillDetailHtml.includes(t('bot.skillCopyMarkdown')));

  const detailDlgSrc = readSettingsSource('SkillDetailDialog.tsx');
  assert.ok(detailDlgSrc.includes('seqRef'), 'SkillDetailDialog 必须持请求序号防止切换技能串台');
  assert.ok(detailDlgSrc.includes('<MarkdownBlock'), '优雅预览必须复用全站唯一的 MarkdownBlock');
  assert.ok(detailDlgSrc.includes('splitSkillMarkdownFrontmatter'), '优雅预览须拆分 YAML frontmatter 防止分割线误渲染');
  assert.equal(detailDlgSrc.includes('content={parsed.body || markdown}'), false, '仅有 frontmatter 时不得回落到原始带分割线全文');
});
