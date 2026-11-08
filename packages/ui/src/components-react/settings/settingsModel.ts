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
import type { SkinId } from '../../tokens/skins.js';
import type { ProviderDirectoryRow, McpServerRow, SkillRow } from '@hermes-flux/core';

export type { ProviderDirectoryRow, McpServerRow, SkillRow };

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

/** 设置弹窗的完整渲染输入（由壳层构造，组件不做任何取数）。 */
export interface SettingsSnapshot {
  isOpen: boolean;
  section: SettingsSectionId;
  theme: SkinId;
  locale: 'zh' | 'en';
  fontPrefs: FontPreferences;
  providers: SettingsLoadable<ProviderDirectoryRow[]>;
  profiles: SettingsLoadable<SettingsProfileRow[]>;
  mcp: SettingsLoadable<McpServerRow[]>;
  skills: SettingsLoadable<SkillRow[]>;
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
}

/**
 * 行级操作结束后草稿的去留。
 * 【规则】只有成功才清空；失败必须保留用户输入；取消不改变任何状态。
 */
export type ProviderRowOutcome = 'clear' | 'keep' | 'ignore';

export function resolveProviderRowOutcome(result: SettingsActionResult): ProviderRowOutcome {
  if (result.ok) return 'clear';
  if (result.cancelled) return 'ignore';
  return 'keep';
}

/** 提供商行内的交互状态机（纯数据，组件用 useReducer 消费）。 */
export interface ProviderRowState {
  editing: boolean;
  keyDraft: string;
  pending: boolean;
  error: string;
}

export type ProviderRowAction =
  | { type: 'toggleEditing' }
  | { type: 'draftChange'; value: string }
  | { type: 'submitStart' }
  | { type: 'submitResult'; result: SettingsActionResult; fallback: string }
  | { type: 'disconnectStart' }
  | { type: 'disconnectResult'; result: SettingsActionResult; fallback: string };

export const PROVIDER_ROW_INITIAL: ProviderRowState = { editing: false, keyDraft: '', pending: false, error: '' };

export function providerRowReducer(state: ProviderRowState, action: ProviderRowAction): ProviderRowState {
  switch (action.type) {
    case 'toggleEditing':
      return { ...state, editing: !state.editing, error: '' };
    case 'draftChange':
      return { ...state, keyDraft: action.value };
    case 'submitStart':
    case 'disconnectStart':
      return { ...state, pending: true, error: '' };
    case 'submitResult': {
      const outcome = resolveProviderRowOutcome(action.result);
      if (outcome === 'clear') return { editing: false, keyDraft: '', pending: false, error: '' };
      if (outcome === 'ignore') return { ...state, pending: false };
      // 失败：保留草稿与输入框，只显示行级错误。
      return { ...state, pending: false, error: action.result.message || action.fallback };
    }
    case 'disconnectResult': {
      const outcome = resolveProviderRowOutcome(action.result);
      if (outcome === 'keep') return { ...state, pending: false, error: action.result.message || action.fallback };
      return { ...state, pending: false };
    }
    default:
      return state;
  }
}

/** 设置弹窗的全部副作用出口。壳层实现，组件只调用。 */
export interface SettingsActions {
  onClose: () => void;
  onSelectSection: (id: SettingsSectionId) => void;
  onThemeChange: (id: SkinId) => void;
  onLocaleChange: (locale: 'zh' | 'en') => void;
  onFontPrefsChange: (prefs: FontPreferences) => void;
  onRefreshProviders: () => void;
  onSaveProviderKey: (slug: string, apiKey: string) => Promise<SettingsActionResult>;
  onDisconnectProvider: (slug: string) => Promise<SettingsActionResult>;
  onRefreshProfiles: () => void;
  onOpenAgent: (name: string) => void;
  onRefreshExtensions: () => void;
  onReloadSkills: () => Promise<SettingsActionResult>;
  onTestGateway: (draft: GatewayDraft) => void;
  onConnectGateway: (draft: GatewayDraft) => void;
  onDisconnectGateway: () => void;
}
