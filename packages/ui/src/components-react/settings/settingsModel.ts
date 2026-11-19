/**
 * 设置中心的域模型（纯数据，零 DOM / 零网络）。
 *
 * 【设计意图 (Why)】
 *   导航、检索、空态与错误态全部由这一份注册表推导，组件只负责把数据画出来。
 *   历史上设置页把 20 个导航项、7 张提供商卡片、4 个主题按钮全部写成散落的模板字符串，
 *   结果出现三件事：抄来的分组名（OPENCHAMBER / OPENCODE）留在产品里、
 *   点不动的假卡片占满屏幕、以及真正有接口的功能反而没有入口。
 *   把"有哪些设置域"收敛成一张表，增删一个域只改一行，不可能再出现导航与内容各写一套。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 导航项与面板实现分处两个 switch，导致 12 个导航项点进去只有"功能域就绪中"占位；
 *   2. 检索框只按按钮 textContent 做 display:none，切换 tab 后输入内容丢失；
 *   3. 语言切换按钮从未绑定事件（setLocale 全仓仅测试调用），点它没有任何反应。
 *
 * 【约束与规则 (Rules)】
 *   1. 本文件只放类型、注册表与纯函数，禁止引入 React / DOM / 网络；
 *   2. 每个 section 必须对应真实能力（本地偏好或已存在的网关契约），不允许占位域；
 *   3. 文案一律走 i18n key，注册表里只出现 key 名，不出现任何自然语言字面量。
 */

import type { I18nKey } from '../../i18n/index.js';
import type { FontPreferences } from '../../tokens/fontPreferences.js';
import type { ActivityIndicatorVariant } from '../../tokens/activityIndicator.js';
import type { ConversationWidthMode } from '../../tokens/conversationWidth.js';
import type { SkinId } from '../../tokens/skins.js';
import type {
  McpServerRow,
  SkillRow,
  CustomEndpointRow,
  OauthProviderRow,
  EndpointProbe,
  CustomEndpointDraft,
  ProviderView,
  BindingAttachIntent,
  BotDetailData,
  BotDraftState,
  BotManagementStatus,
  ProfileUiMeta,
} from '@hermes-flux/core';

export type { McpServerRow, SkillRow };
export type { CustomEndpointRow, OauthProviderRow, ProviderView };

/** 设置中心的一级域。只允许真实存在的能力。 */
export type SettingsSectionId = 'appearance' | 'providers' | 'agents' | 'extensions' | 'connection' | 'about';

/** 图标以名字登记，组件层再映射到具体图标组件，保持本文件零 React 依赖。 */
export type SettingsIconName = 'palette' | 'key' | 'bot' | 'blocks' | 'plug' | 'info';

export interface SettingsSectionDef {
  id: SettingsSectionId;
  icon: SettingsIconName;
  titleKey: I18nKey;
  descKey: I18nKey;
}

/**
 * 设置中心导航树（唯一真值）。
 * 顺序即用户从"日常最常改"到"最少改"的心理距离：外观 → 模型 → 员工 → 扩展 → 连接 → 关于。
 */
export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = Object.freeze([
  { id: 'appearance', icon: 'palette', titleKey: 'settings.sectionAppearance', descKey: 'settings.sectionAppearanceDesc' },
  { id: 'providers', icon: 'key', titleKey: 'settings.sectionProviders', descKey: 'settings.sectionProvidersDesc' },
  { id: 'agents', icon: 'bot', titleKey: 'settings.sectionAgents', descKey: 'settings.sectionAgentsDesc' },
  { id: 'extensions', icon: 'blocks', titleKey: 'settings.sectionExtensions', descKey: 'settings.sectionExtensionsDesc' },
  { id: 'connection', icon: 'plug', titleKey: 'settings.sectionConnection', descKey: 'settings.sectionConnectionDesc' },
  { id: 'about', icon: 'info', titleKey: 'settings.sectionAbout', descKey: 'settings.sectionAboutDesc' },
] as const);

const SECTION_IDS = new Set<string>(SETTINGS_SECTIONS.map((section) => section.id));

/** 把任意输入收敛为合法 section，未知值回落到第一个域（绝不渲染空白面板）。 */
export function resolveSettingsSection(value: string | undefined | null): SettingsSectionId {
  return value && SECTION_IDS.has(value) ? (value as SettingsSectionId) : 'appearance';
}

/** 按 i18n 当前语言过滤导航项。空查询返回全量。 */
export function filterSettingsSections(
  sections: readonly SettingsSectionDef[],
  query: string,
  translate: (key: I18nKey) => string,
): SettingsSectionDef[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...sections];
  return sections.filter((section) => {
    const haystack = `${translate(section.titleKey)} ${translate(section.descKey)}`.toLowerCase();
    return haystack.includes(needle);
  });
}

/**
 * 设置项检索索引（唯一真值）。
 *
 * 【设计意图 (Why)】只按一级分类名过滤时，输入「字号」「密码」「版本」「SOUL」全部落空，
 *   用户明明知道有这项设置却搜不到。索引把每个真实设置项登记为
 *   `{ 锚点 id, 分区, 标题 key }`，检索直接命中条目并可跳转定位。
 *
 * 【防范的历史坑 (Pitfall)】索引与控件各写一套文案会导致"搜到了但跳过去没有这一项"；
 *   这里的 `id` 必须与控件上的 `data-settings-anchor` 逐字一致（测试会校验）。
 *
 * 【约束与规则 (Rules)】只登记真实存在、可跳转的设置项；不登记纯说明文字与动态列表行。
 */
export interface SettingsSearchEntry {
  /** 与控件 `data-settings-anchor` 逐字一致的锚点 id。 */
  id: string;
  sectionId: SettingsSectionId;
  labelKey: I18nKey;
}

export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = Object.freeze([
  { id: 'theme', sectionId: 'appearance', labelKey: 'settings.themeTitle' },
  { id: 'activity', sectionId: 'appearance', labelKey: 'settings.activityTitle' },
  { id: 'ui-font', sectionId: 'appearance', labelKey: 'settings.uiFont' },
  { id: 'code-font', sectionId: 'appearance', labelKey: 'settings.codeFont' },
  { id: 'font-size', sectionId: 'appearance', labelKey: 'settings.textSize' },
  { id: 'conversation-width', sectionId: 'appearance', labelKey: 'settings.conversationWidth' },
  { id: 'presence-layout', sectionId: 'appearance', labelKey: 'settings.presenceLayout' },
  { id: 'language', sectionId: 'appearance', labelKey: 'settings.languageLabel' },
  { id: 'providers-list', sectionId: 'providers', labelKey: 'settings.sectionProviders' },
  { id: 'bot-id', sectionId: 'agents', labelKey: 'bot.idLabel' },
  { id: 'bot-name', sectionId: 'agents', labelKey: 'bot.nameLabel' },
  { id: 'bot-model', sectionId: 'agents', labelKey: 'bot.modelBinding' },
  { id: 'bot-desc', sectionId: 'agents', labelKey: 'bot.descLabel' },
  { id: 'bot-default', sectionId: 'agents', labelKey: 'bot.setDefault' },
  { id: 'bot-soul', sectionId: 'agents', labelKey: 'bot.soulTitle' },
  { id: 'bot-toolsets', sectionId: 'agents', labelKey: 'bot.toolsetsTitle' },
  { id: 'bot-skills', sectionId: 'agents', labelKey: 'bot.skillsTitle' },
  { id: 'bot-mcp', sectionId: 'agents', labelKey: 'bot.mcpTitle' },
  { id: 'bot-memory', sectionId: 'agents', labelKey: 'bot.memoryTitle' },
  { id: 'ext-mcp', sectionId: 'extensions', labelKey: 'settings.mcpTitle' },
  { id: 'ext-skills', sectionId: 'extensions', labelKey: 'settings.skillsTitle' },
  { id: 'gateway-url', sectionId: 'connection', labelKey: 'settings.gatewayUrl' },
  { id: 'gateway-username', sectionId: 'connection', labelKey: 'settings.gatewayUsername' },
  { id: 'gateway-password', sectionId: 'connection', labelKey: 'settings.gatewayPassword' },
  { id: 'gateway-profile', sectionId: 'connection', labelKey: 'settings.gatewayProfile' },
  { id: 'about-version', sectionId: 'about', labelKey: 'settings.aboutVersion' },
  { id: 'about-platform', sectionId: 'about', labelKey: 'settings.aboutPlatform' },
  { id: 'about-protocol', sectionId: 'about', labelKey: 'settings.aboutProtocol' },
] as const);

/**
 * 按当前语言过滤设置项索引。空查询返回空数组（不干扰导航的"全量"语义）。
 * 【规则】匹配是大小写无关的包含；不引入模糊匹配与拼音，避免"搜啥都有"。
 */
export function filterSettingsEntries(
  entries: readonly SettingsSearchEntry[],
  query: string,
  translate: (key: I18nKey) => string,
): SettingsSearchEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return entries.filter((entry) => translate(entry.labelKey).toLowerCase().includes(needle));
}

/** 网关数据的三态：显式区分"没数据"与"加载失败"。 */export type SettingsLoadable<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string };

/** 数字员工档案行（设置中心只读展示 + 打开编辑器入口）。 */
export interface SettingsProfileRow {
  name: string;
  displayName: string;
  model?: string;
  description?: string;
  isDefault?: boolean;
  avatar?: string;
  hasAvatar?: boolean;
  /** 网关原样透传的 ui_meta；保存显示名/默认标记时要基于它合并，不能整块覆盖。 */
  uiMeta?: ProfileUiMeta;
}

/** Bot 头像条的一行。`profile` 是网关的 profile 名，`avatar` 缺省时走确定性图腾。 */
export interface SettingsBotRow {
  profile: string;
  displayName: string;
  avatar?: string;
}

/** BOT 花名册的一行（快照派生；`hasDraft` 由壳层草稿池现算）。 */
export interface BotRosterEntry {
  id: string;
  displayName: string;
  model: string;
  avatar?: string;
  isDefault: boolean;
  hasDraft: boolean;
}

/** 模型下拉的一行。`provider` 是网关 provider id，`providerName` 只用于分组标题。 */
export interface BotModelOption {
  id: string;
  name: string;
  provider: string;
  providerName: string;
}

/** 新建/克隆向导的受控草稿。 */
export interface BotWizardDraft {
  mode: 'blank' | 'clone';
  name: string;
  displayName: string;
  description: string;
  model: string;
  provider: string;
  cloneFrom: string;
  cloneChannels: boolean;
  mirrorCredentials: boolean;
}

export interface BotWizardView {
  open: boolean;
  draft: BotWizardDraft;
  busy: boolean;
  error?: string;
}

/** 离场拦截的待执行目标（纯数据；真正的动作闭包由壳层持有）。 */
export type BotExitTarget =
  | { kind: 'close' }
  | { kind: 'section'; section: SettingsSectionId };

export interface BotManagementView {
  /** 主状态机（来自 core 的判别联合）。 */
  status: BotManagementStatus;
  roster: BotRosterEntry[];
  activeBotId: string;
  activeDetail?: BotDetailData;
  /** 按 Provider 分组的可选模型；当前模型离线时由 UI 追加离线项。 */
  availableModels: BotModelOption[];
  /**
   * 当前 BOT 的草稿；缺省表示未修改，UI 从 activeDetail 派生初始值。
   *
   * 【为什么只给当前一份】快照每次 render 都要 JSON.stringify 做指纹；SOUL 最长 64KB，
   *   整表草稿序列化会拖慢长会话。其它 BOT 是否脏由 `roster[].hasDraft` 逐行表达
   *   （壳层从同一份草稿池现算），不再额外复制一份 dirtyBotIds。
   */
  activeDraft?: BotDraftState;
  /** 壳层保存忙态；与状态机正交，用于禁用输入与保存按钮。 */
  isBusy: boolean;
  wizard: BotWizardView;
  /** 非空时渲染宿主离场确认弹窗。 */
  exitPrompt: { target: BotExitTarget } | null;
  /** 失败横幅（配置错误 / 读取失败），绝不随表单一起清空。 */
  errorBanner?: string;
  /** 网关要求二次确认：网关一个字段都没写，提供"仍然保存"出路。 */
  confirmPending?: { message: string };
  /** 新建成功后需要平滑滚动并高亮的目标。 */
  highlightBotId?: string;
}

/**
 * 设置弹窗的完整渲染输入（由壳层构造，组件不做任何取数）。
 *
 * 【设计意图】提供商只保留一个视角：一张跨 Agent 的归并表。
 *   上一版有"按 Bot / 按 Provider"两个视角 + 顶部头像条，用户要在两处对齐同一个概念，
 *   且"对哪些 Agent 生效"得自己点进去现算。现在 Agent 是行的字段，不需要切换。
 */
export interface SettingsSnapshot {
  isOpen: boolean;
  section: SettingsSectionId;
  theme: SkinId;
  locale: 'zh' | 'en';
  fontPrefs: FontPreferences;
  /** 左轨活动指示器动效变体（设置页卡片即真实预览，点击立即生效）。 */
  activityVariant: ActivityIndicatorVariant;
  /** 对话区列宽档位：narrow (48rem) / wide (72rem) / full (100%)。 */
  conversationWidth: ConversationWidthMode;
  profiles: SettingsLoadable<SettingsProfileRow[]>;
  mcp: SettingsLoadable<McpServerRow[]>;
  skills: SettingsLoadable<SkillRow[]>;
  /** Bot 花名册（提供商行的 Agent 槽位来源），由 profiles 列表实时派生。 */
  bots: SettingsBotRow[];
  /** BOT 配置中枢的完整视图（选择器、详情、草稿、向导、离场拦截）。 */
  botManagement: BotManagementView;
  /** 提供商配置当前作用到的 Bot（删除/设为默认/登录都作用于它）；空串表示跟随连接 profile。 */
  scopedProfile: string;
  /** 统一提供商表：订阅与自定义混排，包含每个 Agent 的生效状态。 */
  providerViews: SettingsLoadable<ProviderView[]>;
  /** 读取失败的 Agent；必须显式提示，不能折进"未配置"。 */
  providerFailures: Array<{ profile: string; displayName: string; message: string }>;
  /** 添加面板需要但主列表不需要的富信息：订阅目录（含未登录项）。 */
  subscriptionCatalog: SettingsLoadable<OauthProviderRow[]>;
  /** 端点表单编辑用的原始端点行（含 base_url / has_api_key）。 */
  customEndpoints: SettingsLoadable<CustomEndpointRow[]>;
  /**
   * 每个 provider 的**配置集合**：归一化 id → 配置了它的 profile 列表。
   *
   * 【为什么必须单独给】`providerViews[].agents` 是 `model.options` 的在用集合，
   *   端点存在于某 profile 的配置里却没进 options 时会漏掉它。删除必须按配置集合收敛，
   *   否则会误报"没有任何 Agent 在用"而拒绝删除。
   */
  endpointProfiles: Record<string, string[]>;
  /**
   * 端点清单读取失败的 Agent。
   * 【为什么必须显式】端点清单是删除的作用域来源；某个 Agent 读失败时，
   *   它的端点不在清单里，删除会漏删并报成功。读不到就不许猜着删。
   */
  endpointFailures: Array<{ profile: string; displayName: string; message: string }>;
  /** 提供商域的独立忙态，不锁整页。 */
  providerAdminBusy: boolean;
  gateway: {
    url: string;
    username: string;
    /** 已保存的密码永远不进入快照 JSON；表单留空即沿用旧密码。 */
    hasStoredPassword: boolean;
    profileName: string;
    status: 'connected' | 'connecting' | 'disconnected';
    latencyMs: number;
    test?: { ok?: boolean; message?: string; latency?: number };
  };
  appVersion?: string;
  platform: string;
  busy: boolean;
  /**
   * Agent 状态指示器的位置变体。
   *
   * 【约束与规则】`stage` = 对话区顶部悬浮（历史行为），`dock` = 输入舱上沿。
   *   外观面板据此渲染二选一控件；切换回调见 `SettingsActions.onPresenceLayoutChange`。
   */
  presenceLayout: 'stage' | 'dock';
}

/** 连接表单草稿：只存在于组件内部，提交时才回到壳层。 */
export interface GatewayDraft {
  url: string;
  username: string;
  password: string;
  profileName: string;
}

/**
 * 连接测试结论是否已被草稿修改作废。
 *
 * 【设计意图 (Why)】`testStatus` 由壳层持有，组件无权回写；把"点测试时的草稿指纹"与
 *   当前草稿比较，就能在不改快照结构的前提下让旧结论立即失效。
 * 【约束与规则】`tested === null` 表示本组件没发起过测试（结论可能来自连接流程），
 *   此时不得把结论判为过期。
 */
export function isGatewayTestStale(tested: GatewayDraft | null, draft: GatewayDraft): boolean {
  if (!tested) return false;
  return (
    tested.url !== draft.url ||
    tested.username !== draft.username ||
    tested.password !== draft.password ||
    tested.profileName !== draft.profileName
  );
}

/** 模型下拉的分组输入（文案由调用方翻译，本函数零 i18n 依赖）。 */
export interface ModelSelectGroupsInput {
  /** 按 Provider 归并后的可选模型。 */
  groups: ReadonlyArray<{ name: string; models: ReadonlyArray<{ id: string; name: string }> }>;
  currentModel: string;
  currentModelOffline: boolean;
  labels: {
    offline: string;
    unbound: string;
    catalogUnavailable: string;
  };
}

/**
 * 构造 BOT 模型下拉的分组数据。
 *
 * 【设计意图 (Why)】离线项、未绑定、目录不可用这三种"占位项"必须排在真实目录之前，
 *   且一律 disabled —— 它们只负责让用户看见当前绑定，不允许通过它们改写 provider。
 * 【约束与规则】纯函数，零 React / 零 i18n；文案全部由 labels 传入，可直接单测。
 */
export function buildModelSelectGroups(
  input: ModelSelectGroupsInput,
): Array<{ label: string; options: Array<{ value: string; label: string; disabled?: boolean }> }> {
  const { groups, currentModel, currentModelOffline, labels } = input;
  const result: Array<{ label: string; options: Array<{ value: string; label: string; disabled?: boolean }> }> = [];

  /*
   * 三个占位分支必须互斥。
   * 【为什么】`groups.length === 0` 与 `!currentModel` 可以同时成立；若各 push 一次，
   *   会产生两个 `value: ''` 的重复占位与两个空 label 分组（React 重复 key）。
   * 【优先级】目录不可用 > 未绑定 > 离线：目录都读不到时，"未绑定"没有可操作性。
   */
  if (groups.length === 0) {
    result.push({ label: '', options: [{ value: currentModel, label: labels.catalogUnavailable, disabled: true }] });
  } else if (!currentModel) {
    result.push({ label: '', options: [{ value: '', label: labels.unbound, disabled: true }] });
  } else if (currentModelOffline) {
    result.push({ label: '', options: [{ value: currentModel, label: labels.offline, disabled: true }] });
  }
  for (const group of groups) {
    result.push({ label: group.name, options: group.models.map((model) => ({ value: model.id, label: model.name })) });
  }
  return result;
}

/** 单次行级操作的结局：失败必须带原因；用户主动取消不算错误。 */
export interface SettingsActionResult {
  ok: boolean;
  message?: string;
  cancelled?: boolean;
  /**
   * 勾选未配置的自定义端点时，其它成员没有可复用的密钥，界面需要就地补一次。
   * 【规则】只有 `true` 才允许打开密钥输入框；普通失败不得被误当成"缺密钥"。
   */
  needsKey?: boolean;
}

/** 绑定未配置自定义端点时的附加意图参数。 */
export interface ToggleProviderAgentOptions {
  attachIntent?: BindingAttachIntent;
}

/** 绑定操作返回结构：缺意图时壳层返回 `confirmRequired: true` 且不写入任何配置。 */
export interface ToggleProviderAgentResult extends SettingsActionResult {
  confirmRequired?: boolean;
}

/** 对话区列宽切换回调类型。 */
export type ConversationWidthChangeHandler = (width: ConversationWidthMode) => void;

/** 设置弹窗的全部副作用出口。壳层实现，组件只调用。 */
export interface SettingsActions {
  onClose: () => void;
  onSelectSection: (id: SettingsSectionId) => void;
  onThemeChange: (id: SkinId) => void;
  onLocaleChange: (locale: 'zh' | 'en') => void;
  onFontPrefsChange: (prefs: FontPreferences) => void;
  /** 切换左轨活动指示器动效变体；壳层负责持久化并向左轨推新快照。 */
  onActivityVariantChange: (variant: ActivityIndicatorVariant) => void;
  /** 切换对话区列宽档位；壳层负责持久化并写入根节点样式与属性。 */
  onConversationWidthChange: ConversationWidthChangeHandler;
  /**
   * 切换 Agent 状态指示器的位置。
   *
   * 【规则】只改表现位置：状态机、文案与动效全部复用，禁止为另一套位置新增状态源。
   */
  onPresenceLayoutChange: (layout: 'stage' | 'dock') => void;
  onRefreshProfiles: () => void;
  onOpenAgent: (name: string) => void;

  /** 草稿实时写入（局部补丁；壳层负责与持久化快照深比较并清除空草稿）。 */
  onBotDraftChange: (botId: string, patch: Partial<BotDraftState>) => void;
  /** 选择器静止吸附后请求该 BOT 的完整详情（壳层做 160ms 防抖与令牌收敛）。 */
  onSelectBotSettle: (botId: string) => void;
  /** 原子保存当前草稿（profiles.configure + profiles.set_asset）。失败时草稿必须保留。 */
  onSaveBotConfig: (
    botId: string,
    options?: { confirmExpensive?: boolean },
  ) => Promise<SettingsActionResult>;
  /** 清空当前 BOT 的未保存修改（草稿池与表单一起回到权威快照）。 */
  onResetBotDraft: (botId: string) => void;
  /** 打开新建/克隆向导。 */
  onOpenBotWizard: (mode: 'blank' | 'clone') => void;
  /** 关闭向导（不提交任何内容）。 */
  onCloseBotWizard: () => void;
  /** 向导表单补丁。 */
  onBotWizardDraftChange: (patch: Partial<BotWizardDraft>) => void;
  /** 提交新建/克隆。成功后壳层负责刷新花名册并定位新 BOT。 */
  onSubmitCreateBot: () => Promise<SettingsActionResult>;
  /** 重新拉取花名册（错误态重试 / 手动刷新）。 */
  onRetryBotList: () => void;
  /** 关闭失败横幅（不触碰草稿）。 */
  onDismissBotError: () => void;
  /** 关闭二次确认横幅（"暂不保存"），只清确认态，不动草稿。 */
  onDismissBotConfirm: () => void;
  /** 宿主离场确认：放弃修改 / 保留草稿并离开。 */
  onConfirmBotExit: (choice: 'discard' | 'keep') => void;
  /** 留在当前（取消离场）。 */
  onCancelBotExit: () => void;
  /** BOT 面板注册宿主级脏检查钩子；卸载时传 null 注销。 */
  onRegisterBotDirtyGuard: (guard: (() => boolean) | null) => void;
  onRefreshExtensions: () => void;
  onReloadSkills: () => Promise<SettingsActionResult>;
  onTestGateway: (draft: GatewayDraft) => void;
  onConnectGateway: (draft: GatewayDraft) => void;
  onDisconnectGateway: () => void;

  /** 切换操作作用的 Agent（删除 / 设为默认 / 登录都作用于它）。 */
  onScopeProfileChange: (profile: string) => void;
  /** 重新装载统一提供商表。 */
  onReloadProviders: () => void;

  /** 探测端点，不落盘。 */
  onProbeEndpoint: (draft: CustomEndpointDraft) => Promise<EndpointProbe>;
  /** 保存端点；`fanOutTo` 非空时逐个写到目标 Agent。 */
  onSaveEndpoint: (
    draft: CustomEndpointDraft,
    options: { fanOutTo: readonly string[]; makeDefault: boolean },
  ) => Promise<SettingsActionResult & { fanOut?: Array<{ profile: string; displayName: string; ok: boolean; message?: string }> }>;
  /** 删除端点。用户看到一行，删除就是整体删除：壳层会跨所有配过它的 Agent 一起删。 */
  onDeleteEndpoint: (id: string) => Promise<SettingsActionResult>;
  /**
   * 勾选 / 取消勾选某一个 Agent 对某提供商的绑定。
   *
   * 【规则】`apiKey` 只在「把自定义端点配置到一个未配置的 Agent」且确实无法复用时才需要：
   *   壳层会先尝试从其它成员复制密钥；没有可读来源时返回 `needsKey`，界面再就地补一次。
   * 【规则】正在被当作当前主模型的 Agent 不允许取消，壳层会拒绝并给出原因。
   */
  onToggleProviderAgent: (
    providerId: string,
    profile: string,
    nextChecked: boolean,
    apiKey?: string,
    options?: ToggleProviderAgentOptions,
  ) => Promise<ToggleProviderAgentResult>;
  /**
   * 把某个 Agent 的主模型切到这个提供商。
   * 【规则】必须带具体模型：一个提供商下有多个模型，主模型槽位只能放一个。
   * 【规则】高价模型网关会要求二次确认；`confirmExpensive` 为真时才真正落盘。
   */
  onActivateProvider: (
    providerId: string,
    model: string,
    confirmExpensive?: boolean,
  ) => Promise<SettingsActionResult & { confirmRequired?: boolean }>;

  /** 发起订阅登录，作用于共享 auth；登录成功后所有 Agent 默认可用。 */
  onStartLogin: (providerId: string) => Promise<{ ok: boolean; sessionId?: string; userCode?: string; verificationUrl?: string; message?: string }>;
  /** 轮询一次登录会话。 */
  onPollLogin: (providerId: string, sessionId: string) => Promise<{ status: 'pending' | 'approved' | 'failed' | 'cancelled'; message?: string }>;
  /** 取消登录会话。 */
  onCancelLogin: (sessionId: string) => Promise<void>;
  /** 退出订阅登录：作用于共享 auth，退出后所有 Agent 一起失去该订阅。 */
  onLogoutProvider: (providerId: string) => Promise<SettingsActionResult>;

  /** 轻量用户提示（复制成功等），不改变任何业务状态。 */
  onNotify: (message: string) => void;
  /** 复制文本，由壳层决定用哪种剪贴板实现。 */
  onCopy: (text: string) => Promise<boolean>;
}
