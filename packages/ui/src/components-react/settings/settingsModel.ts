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
}

/** Bot 头像条的一行。`profile` 是网关的 profile 名，`avatar` 缺省时走确定性图腾。 */
export interface SettingsBotRow {
  profile: string;
  displayName: string;
  avatar?: string;
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
  profiles: SettingsLoadable<SettingsProfileRow[]>;
  mcp: SettingsLoadable<McpServerRow[]>;
  skills: SettingsLoadable<SkillRow[]>;
  /** Bot 花名册（提供商行的 Agent 槽位来源），由 profiles 列表实时派生。 */
  bots: SettingsBotRow[];
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
}

/** 连接表单草稿：只存在于组件内部，提交时才回到壳层。 */
export interface GatewayDraft {
  url: string;
  username: string;
  password: string;
  profileName: string;
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

/** 设置弹窗的全部副作用出口。壳层实现，组件只调用。 */
export interface SettingsActions {
  onClose: () => void;
  onSelectSection: (id: SettingsSectionId) => void;
  onThemeChange: (id: SkinId) => void;
  onLocaleChange: (locale: 'zh' | 'en') => void;
  onFontPrefsChange: (prefs: FontPreferences) => void;
  /** 切换左轨活动指示器动效变体；壳层负责持久化并向左轨推新快照。 */
  onActivityVariantChange: (variant: ActivityIndicatorVariant) => void;
  onRefreshProfiles: () => void;
  onOpenAgent: (name: string) => void;
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
