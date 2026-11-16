/**
 * Hermes Flux 全局桌面渲染层状态模型（App State Domain）
 *
 * 【设计意图 (Why)】
 *   将整座工作台 60+ 字段的宏观状态机契约、持久化恢复、冷启动推导
 *   与初始状态工厂从 `index.ts` 中彻底剥离。
 *   使状态契约作为底层单一真值源，被各 Service 切片安全导入，
 *   避免在庞大的入口文件中堆叠数百行类型声明与配置。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. `PRESENCE_LAYOUT_STORAGE_KEY` 必须先于状态读取声明，防止打包提升时产生 `undefined`；
 *   2. 骨架屏相位必须按三域独立 (`profilesPhase`, `sessionsPhase`, `messagesPhase`)；
 *   3. 敏感字段禁止明文逃逸，所有草稿与持久化需使用 safeParseJson 校验。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯数据模型与无副作用工厂，保持 100% 类型健全，严禁 `as any`；
 *   2. 不依赖任何 DOM 节点渲染逻辑。
 */

import {
  type SettingsSectionId,
  type SettingsLoadable,
  type McpServerRow as SettingsMcpRow,
  type SkillRow as SettingsSkillRow,
  type SettingsProfileRow,
  type ProviderView as SettingsProviderView,
  type CustomEndpointRow as SettingsCustomEndpointRow,
  type OauthProviderRow as SettingsOauthProviderRow,
  type InspectorTab,
  type LeftRailGroupRoom,
  type LeftRailActiveFocus,
  type LeftRailProfile,
  type LeftRailProject,
  type ContextMenuProps,
  type InputAttachmentItem,
  type SlashCommandOption,
  type MentionReferenceOption,
  type DataPhase,
  MessageViewModel,
  resolveSkinId,
} from '@hermes-flux/ui';

import {
  type NormalizedSession,
  type ModelDetail,
  type ModelCatalogEntry,
  type AgentProfile,
  type BotDetailData,
  type BotDraftState,
  type BotManagementStatus,
} from '@hermes-flux/core';

import { isStringArray, safeParseJson } from '../persistence/persistedJson.js';

export interface AppState {
  platform: 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'web';
  theme: 'obsidian-gold' | 'suet-jade' | 'jade-white' | 'warm-paper' | 'ayu-light' | 'cyber-matrix';
  lang: 'zh' | 'en';
  isMaximized: boolean;
  leftRailCollapsed: boolean;
  inspectorCollapsed: boolean;
  activeInspectorTab: InspectorTab;
  activeSessionId: string;
  activeLiveSessionId: string;
  selectedModel: string;
  availableModels: string[];
  modelDetails: ModelDetail[];
  modelCatalog: ModelCatalogEntry[];
  modelCatalogHash: string;
  currentProvider: string;
  profiles: AgentProfile[];
  profileName: string;
  projects: LeftRailProject[];
  groupRooms: LeftRailGroupRoom[];
  activeFocus: LeftRailActiveFocus;
  sessionSearchQuery: string;
  isBotsGroupExpanded: boolean;
  isSessionsGroupExpanded: boolean;
  isGroupsGroupExpanded: boolean;
  isMoreSessionsExpanded: boolean;
  isNewTaskModalOpen: boolean;
  newTaskModalTab: 'solo' | 'group';
  selectedNewTaskProjectId?: string;
  editingGroupRoomId?: string;
  modelMenuOpen: boolean;
  modelCascadeModel?: string;
  collapsedProviders: string[];
  sessionContextMenu?: ContextMenuProps;
  confirmModal?: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    isDanger?: boolean;
    onConfirm: () => void | Promise<void>;
    onCancel?: () => void;
  };
  dockNotice: string;
  sessionListError: string;
  profilesPhase: DataPhase;
  sessionsPhase: DataPhase;
  messagesPhase: DataPhase;
  pendingSessionIds: string[];
  reasoningLevel: 'default' | 'none' | 'low' | 'high' | 'max' | 'off' | 'medium';
  approvalMode: 'manual' | 'smart' | 'off';
  isStreaming: boolean;
  gatewayConnected: boolean;
  gatewayConnecting: boolean;
  gatewayLatencyMs: number;
  gatewayUrl: string;
  username: string;
  password: string;
  isSettingsOpen: boolean;
  settingsSection: SettingsSectionId;
  presenceLayout: 'stage' | 'dock';
  settingsProfiles: SettingsLoadable<SettingsProfileRow[]>;
  botManagementStatus: BotManagementStatus;
  botManagementActiveBotId: string;
  botManagementDetail?: BotDetailData;
  botDrafts: Record<string, BotDraftState>;
  botManagementError?: string;
  botManagementConfirm?: { message: string };
  botManagementBusy: boolean;
  settingsScopedProfile: string;
  settingsProviderViews: SettingsLoadable<SettingsProviderView[]>;
  settingsProviderFailures: Array<{ profile: string; displayName: string; message: string }>;
  settingsSubscriptionCatalog: SettingsLoadable<SettingsOauthProviderRow[]>;
  settingsCustomEndpoints: SettingsLoadable<SettingsCustomEndpointRow[]>;
  settingsEndpointProfiles: Record<string, string[]>;
  settingsEndpointFailures: Array<{ profile: string; displayName: string; message: string }>;
  settingsProviderAdminBusy: boolean;
  settingsMcp: SettingsLoadable<SettingsMcpRow[]>;
  settingsSkills: SettingsLoadable<SettingsSkillRow[]>;
  settingsBusy: boolean;
  appVersion?: string;
  sessions: NormalizedSession[];
  messages: MessageViewModel[];
  hasOlderMessages: boolean;
  isLoadingOlder: boolean;
  favoriteModels: string[];
  recentModels: string[];
  modelSearchQuery: string;
  testStatus?: { ok?: boolean; message?: string; latency?: number };
  artifacts: Array<{ id: string; name: string; type: string; size: string; preview?: string }>;
  browserFrame?: { url: string; title: string; screenshotUrl?: string };
  gitDiffs: Array<{ file: string; additions: number; deletions: number; patch?: string }>;
  memories: Array<{ category: string; content: string; updated?: string }>;
  turnStartedAt?: number;
  presenceTerminal?: { kind: 'failed'; message: string } | { kind: 'interrupted' };
  activeGroupSpeaker?: string | null;
  inspectorFullscreen?: boolean;
  openFiles: Array<{ id?: string; path: string; content: string; language?: string; isDiff?: boolean }>;
  activeFilePath: string;
  fileViewMode: 'rendered' | 'raw';
  fileShowLineNumbers: boolean;
  fileWordWrap: boolean;
  fileSearchOpen: boolean;
  fileSearchQuery: string;
  attachments: InputAttachmentItem[];
  queuedMessages: Array<{ id: string; admissionId: string; text: string }>;
  slashPopperOpen: boolean;
  slashItems: SlashCommandOption[];
  mentionPopperOpen: boolean;
  mentionItems: MentionReferenceOption[];
  rollbackArmed: {
    sessionId: string;
    targetId: string;
    anchor: { kind: 'row'; rowId: number };
    snapshot: MessageViewModel[];
    removedCount: number;
    anchorLabel: string;
  } | null;
  sideAgentCapsules: Array<{
    id: string;
    kind: 'btw' | 'delegation';
    profile: string;
    question: string;
    answer?: string;
    status: 'pending' | 'done' | 'failed' | 'expired';
    startedAt: number;
    notice?: string;
    hintTimer?: ReturnType<typeof setTimeout>;
    expireTimer?: ReturnType<typeof setTimeout>;
  }>;
  pickedMention: { profile: string; token: string } | null;
}

export const PRESENCE_LAYOUT_STORAGE_KEY = 'hermes_flux_presence_layout';

export function readPresenceLayout(): 'stage' | 'dock' {
  if (typeof localStorage === 'undefined') return 'stage';
  try {
    const raw = localStorage.getItem(PRESENCE_LAYOUT_STORAGE_KEY);
    return raw === 'dock' ? 'dock' : 'stage';
  } catch (error) {
    console.warn('[presence] failed to read layout preference; falling back to stage', error);
    return 'stage';
  }
}

export interface InitialStateParams {
  platform: 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'web';
  leftRailCollapsedDefault?: boolean;
}

export function createInitialState(params: InitialStateParams): AppState {
  const getStorage = (k: string) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null);

  const savedTheme = getStorage('hermes_flux_theme') || getStorage('hermes_aura_theme');
  const savedLang = getStorage('hermes_flux_lang') || getStorage('hermes_aura_lang');
  const savedProfile = getStorage('hermes_flux_profile') || getStorage('hermes_aura_profile') || 'default';
  const savedUrl = getStorage('hermes_flux_gateway_url') || getStorage('hermes_aura_gateway_url') || '';
  const savedUser = getStorage('hermes_flux_username') || getStorage('hermes_aura_username') || '';
  const savedPass = getStorage('hermes_flux_password') || getStorage('hermes_aura_password') || '';

  return {
    platform: params.platform,
    theme: resolveSkinId(savedTheme),
    lang: savedLang === 'en' ? 'en' : 'zh',
    isMaximized: false,
    leftRailCollapsed: params.leftRailCollapsedDefault ?? false,
    inspectorCollapsed: true,
    activeInspectorTab: 'artifacts',
    activeSessionId: '',
    activeLiveSessionId: '',
    selectedModel: '',
    availableModels: [],
    modelDetails: [],
    modelCatalog: [],
    modelCatalogHash: '',
    currentProvider: '',
    profiles: [],
    projects: [],
    groupRooms: [],
    activeFocus: { type: 'bot', botName: savedProfile },
    sessionSearchQuery: '',
    isBotsGroupExpanded: true,
    isSessionsGroupExpanded: true,
    isGroupsGroupExpanded: true,
    isMoreSessionsExpanded: false,
    isNewTaskModalOpen: false,
    newTaskModalTab: 'solo',
    editingGroupRoomId: undefined,
    profileName: savedProfile,
    modelMenuOpen: false,
    modelCascadeModel: undefined,
    collapsedProviders: [],
    dockNotice: '',
    sessionListError: '',
    profilesPhase: 'loading',
    sessionsPhase: 'loading',
    messagesPhase: 'loading',
    pendingSessionIds: [],
    favoriteModels: safeParseJson<string[]>(
      getStorage('hermes_flux_fav_models') || getStorage('hermes_aura_fav_models'),
      [],
      isStringArray
    ),
    recentModels: safeParseJson<string[]>(
      getStorage('hermes_flux_recent_models') || getStorage('hermes_aura_recent_models'),
      [],
      isStringArray
    ),
    modelSearchQuery: '',
    reasoningLevel: 'high',
    approvalMode: 'smart',
    isStreaming: false,
    gatewayConnected: false,
    gatewayConnecting: Boolean(savedUrl),
    gatewayLatencyMs: 0,
    gatewayUrl: savedUrl,
    username: savedUser,
    password: savedPass,
    isSettingsOpen: false,
    settingsSection: 'appearance',
    presenceLayout: readPresenceLayout(),
    settingsProfiles: { status: 'idle' },
    botManagementStatus: { status: 'uninitialized' },
    botManagementActiveBotId: '',
    botManagementDetail: undefined,
    botDrafts: {},
    botManagementError: undefined,
    botManagementConfirm: undefined,
    botManagementBusy: false,
    settingsScopedProfile: '',
    settingsProviderViews: { status: 'idle' },
    settingsProviderFailures: [],
    settingsSubscriptionCatalog: { status: 'idle' },
    settingsCustomEndpoints: { status: 'idle' },
    settingsEndpointProfiles: {},
    settingsEndpointFailures: [],
    settingsProviderAdminBusy: false,
    settingsMcp: { status: 'idle' },
    settingsSkills: { status: 'idle' },
    settingsBusy: false,
    appVersion: undefined,
    sessions: [],
    messages: [],
    hasOlderMessages: false,
    isLoadingOlder: false,
    inspectorFullscreen: false,
    openFiles: [],
    activeFilePath: '',
    fileViewMode: 'rendered',
    fileShowLineNumbers: true,
    fileWordWrap: false,
    fileSearchOpen: false,
    fileSearchQuery: '',
    testStatus: undefined,
    artifacts: [],
    browserFrame: undefined,
    gitDiffs: [],
    memories: [],
    attachments: [],
    queuedMessages: [],
    slashPopperOpen: false,
    slashItems: [],
    mentionPopperOpen: false,
    mentionItems: [],
    rollbackArmed: null,
    sideAgentCapsules: [],
    pickedMention: null,
  };
}
