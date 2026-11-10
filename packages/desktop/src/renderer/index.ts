/**
 * Hermes Flux Desktop Renderer Application Entry (v4.0 Production)
 * Fully powered by @hermes-flux/core and @hermes-flux/ui
 * Zero private WS glue code: Dual-channel fallback, TokenCoalescer 120 FPS stream, robust model & session lifecycle.
 */

import type { IRpcCaller } from '@hermes-flux/core';

import {
  renderMiddlePod,
  renderConversationCanvas,
  renderInputDock,
  renderSlashPopper,
  renderMentionPopper,
  renderToolCapsuleSlot,
  renderInspectionPod,
  mountTitlebar,
  mountLeftRail,
  mountSettingsModal,
  type SettingsSectionId,
  type SettingsSnapshot,
  type SettingsActions,
  type GatewayDraft,
  type SettingsLoadable,
  type ProviderDirectoryRow as SettingsProviderRow,
  type McpServerRow as SettingsMcpRow,
  type SkillRow as SettingsSkillRow,
  type SettingsProfileRow,
  buildLeftRailModel,
  formatLeftRailTime,
  renderModelPickerMenu,
  renderModelPickerTree,
  renderMarkdown,
  getCleanReasoningSummary,
  escapeHtml,
  MessageViewModel,
  InspectorTab,
  type LeftRailProject,
  type LeftRailGroupRoom,
  type LeftRailActiveFocus,
  type LeftRailTab,
  type LeftRailSession,
  type LeftRailProfile,
  renderNewTaskModal,
  renderContextMenu,
  type ContextMenuProps,
  renderAgentProfileEditorModal,
  renderConfirmModal,
  t,
  hasDockSnapshotChanged,
  type RenderInputDockSnapshot,
  type InputAttachmentItem,
  type SlashCommandOption,
  type MentionReferenceOption,
  getToggleTheme,
  SKINS,
  SKIN_ALIASES,
  resolveSkinId,
  getTitlebarSnapshot as createTitlebarSnapshot,
  type LeftRailActions,
  type LeftRailSnapshot,
  type TitlebarSnapshot,
  attachMotionController,
  mountMessageList,
  mountPromptNavigator,
  buildPromptEntries,
  resolveActivePromptIndex,
  type PromptEntry,
  type PromptNavigatorActions,
  type PromptNavigatorSnapshot,
  type ConversationMount,
  type ConversationSnapshot,
  type ConversationMessageVM,
  type DataPhase,
  mountFileTypeSprite,
  warmUpHighlighting,
  loadFontPreferences,
  saveFontPreferences,
  applyFontPreferences,
  setLocale,
  collectTouchedFiles,
  type FontPreferences,
} from '@hermes-flux/ui';

import {
  messageActionController,
  resolveCopyContent,
  calculateForkCount,
  findPreviousUserPrompt,
} from './messageActions.js';
import { applyOptimisticCut, planSessionLoadMerge, planRollbackLeaveRestore, takeServerPriority, extractDurableRowId, bindTurnRowIds, resolveRollbackTarget } from './rollbackTransaction.js';
import { createToolPatchQueue } from './toolPatchQueue.js';
import { decideConversationPush } from './conversationPush.js';
import { resolveColdStartFocus } from './coldStartFocus.js';
import { createSettingsController, resolveGatewayPassword } from './settingsController.js';
import {
  planMessageWindow,
  expandMessageWindowStart,
  slideMessageWindowDown,
  windowEndFor,
  windowStartAroundIndex,
  computeHasOlderMessages,
  shouldExpandWindow,
  shouldSettleInitialBottom,
} from './messageWindow.js';
import { profilesDiffer } from './profileRefresh.js';
import { promptMessageIndexAtScrollTop, topmostRectTop, shouldRebuildPromptIndex } from './promptNavigator.js';

import {
  HermesGatewayClient,
  TokenCoalescer,
  reduceGatewayEvent,
  readSessionHandles,
  defaultSessionHandleRegistry,
  type SessionHandles,
  toPendingSession,
  upsertSession,
  applySessionTitle,
  createLogger,
  setLogLevel,
  addLogSink,
  getLogLevel,
  parseLogLevel,
  isLogLevelEnabled,
  type LogLevel,
  type TurnAction,
  type NormalizedSession,
  type ModelDetail,
  type ModelCatalogEntry,
  modelLabelFromCatalog,
  modelCatalogFingerprint,
  buildProviderDirectory,
  buildMcpServerRows,
  buildSkillRows,
  normalizeAgentProfile,
  type AgentProfile,
  type ProjectSummary,
  ProfileService,
  GroupRoomStore,
  ProjectService,
  reconcileSessionList,
  preserveRunningActivity,
  settleTurnTermination,
  resolveFileContent,
  doesSessionBelongToProject,
  resolveActivityState,
  applyTurnStarted,
  applyTurnCompleted,
  applyTurnFailed,
  applyEnteredRead,
  reconcileAuthoritativeActivity,
  type ActivityState,
  applyBotActivity,
  syncBotProfiles,
  syncActiveSessionToBot,
  resolveTitlebarTitle,
  resolveTitlebarAvatar,
  type BotActivityRecord,
  type AttachedImageResult,
  InteractiveService,
  HandoffService,
  type PromptSubmitResult,
  planTruncate,
  resolveCutIndexByAnchor,
  isDurableRowId,
  deriveSessionKind,
  planSendRoute,
  runGuarded,
  SessionLifecycleService,
  RpcErrorCode,
  SessionListGeneration,
  CacheService,
  type CachedSessionSummary,
  type CachedAgentSummary,
  type CachedMessageRow,
  type CacheChannelRef,
  planOlderBatchPrependMerge,
  resolveLineageChain,
  isKnownDisplayKind,
  type MessageDisplayKind,
} from '@hermes-flux/core';

import { parseTranscriptRows } from './transcriptRows.js';
import { DesktopCacheStore } from './cache/DesktopCacheStore.js';

/**
 * 客户端缓存服务（冷启动快照 + 消息正文）。
 *
 * 【设计意图 (Why)】
 *   冷启动先读本地快照直接出图，再让后台权威拉取覆盖，避免首屏等网络。
 *   运行期所有读仍走 `state`，缓存只负责"启动时喂一次"。
 *
 * 【防范的历史坑 (Pitfall)】
 *   缓存必须与权威结果同源写入，且删除必须双向传播；否则会出现
 *   "已删除的会话在重启后复活"。
 *
 * 【约束与规则 (Rules)】
 *   - 只在启动时读一次，不在渲染周期内读；
 *   - 写缓存失败不得影响主流程（由 DesktopCacheStore 内部降级）。
 */
const cacheService = new CacheService(new DesktopCacheStore(), { sessionCap: 500, messageCap: 2000 });

/** 把缓存索引行还原成渲染层使用的会话结构。 */
function toNormalizedSession(row: CachedSessionSummary): NormalizedSession {
  return {
    id: row.id,
    title: row.title,
    model: '',
    time: formatSessionTime(row.timestamp),
    preview: row.preview || '',
    isArchived: row.isArchived,
    timestamp: row.timestamp,
    hidden: row.hidden,
    unread: row.unread,
    pinned: row.pinned,
    botName: row.botName,
    projectId: row.projectId,
  };
}

/** 把渲染层会话结构收敛成缓存索引行。 */
function toCachedSession(row: NormalizedSession): CachedSessionSummary {
  return {
    id: row.id,
    profile: row.botName || state.profileName || 'default',
    kind: 'session',
    title: row.title,
    preview: row.preview || undefined,
    timestamp: row.timestamp,
    isArchived: Boolean(row.isArchived),
    hidden: Boolean(row.hidden),
    pinned: Boolean(row.pinned),
    unread: Boolean(row.unread),
    botName: row.botName,
    projectId: row.projectId,
  };
}

/** 把缓存群聊行还原成左轨群聊结构。 */
function toLeftRailGroupRoom(row: CachedSessionSummary): LeftRailGroupRoom {
  return {
    roomId: row.id,
    name: row.title,
    members: row.members ?? [],
    createdAt: row.timestamp,
    updatedAt: row.timestamp,
  };
}

/** 把左轨群聊结构收敛成缓存索引行（群聊不属于任何 profile，profile 固定空串）。 */
function toCachedGroup(room: LeftRailGroupRoom): CachedSessionSummary {
  return {
    id: room.roomId,
    profile: '',
    kind: 'group',
    title: room.name,
    timestamp: room.updatedAt ?? room.createdAt ?? Date.now(),
    isArchived: false,
    hidden: false,
    pinned: false,
    unread: false,
    members: room.members ?? [],
    memberCount: room.members?.length ?? 0,
  };
}

/** 消息缓存上限：每会话 5000 行。 */
const MESSAGE_CACHE_LIMIT = 5000;

/** 把缓存消息行还原成渲染层消息视图。 */
function toMessageViewModel(row: CachedMessageRow): MessageViewModel {
  return {
    id: `row-${row.orderKey}`,
    rowId: row.orderKey,
    role: row.role,
    content: row.text,
    thought: row.reasoning,
    toolCalls: row.toolCalls?.map((call) => ({
      id: call.toolId,
      name: call.name,
      status: call.status === 'done' ? 'completed' : call.status === 'error' ? 'failed' : 'running',
      args: call.argsText || '',
      output: call.resultText,
    })),
    timestamp: formatSessionTime(row.timestamp),
    rawTimestamp: row.timestamp,
    displayKind: isKnownDisplayKind(row.displayKind) ? row.displayKind : 'user',
    displayMetadata: row.displayMetadata,
  };
}

/**
 * 把渲染层消息视图收敛成缓存行。
 *
 * 【规则】没有可靠 `rowId` 的消息不落盘——临时主键（`usr-` / `ast-`）写进缓存后，
 * 下次启动会与真实行号对不上，产生重复消息。
 */
function toCachedMessage(view: MessageViewModel, ref: CacheChannelRef): CachedMessageRow | null {
  const orderKey = typeof view.rowId === 'number' && Number.isFinite(view.rowId) && view.rowId > 0
    ? view.rowId
    : Number.parseInt(view.id.replace(/^row-/, ''), 10);
  if (!Number.isFinite(orderKey) || orderKey <= 0) return null;

  return {
    profile: ref.profile,
    channel: ref.channel,
    channelId: ref.channelId,
    orderKey,
    role: view.role,
    text: view.content,
    reasoning: view.thought,
    toolCalls: view.toolCalls?.map((call) => ({
      toolId: call.id,
      name: call.name,
      argsText: call.args,
      resultText: call.output,
      status: call.status === 'completed' ? 'done' : call.status === 'failed' ? 'error' : 'running',
    })),
    timestamp: view.rawTimestamp ?? Date.now(),
    status: 'complete',
    displayKind: view.displayKind,
    displayMetadata: view.displayMetadata,
  };
}

/** 把一次 REST 窗口写入持久化缓存（异步，失败只降级为纯内存）。 */
function persistMessagesToCache(
  ref: CacheChannelRef,
  messages: MessageViewModel[],
  fenceMax: number
): void {
  const rows: CachedMessageRow[] = [];
  for (const message of messages) {
    const row = toCachedMessage(message, ref);
    if (row) rows.push(row);
  }
  void cacheService.applyRemoteWindow(ref, rows, fenceMax).catch(() => undefined);
}

/**
 * 把当前流式回合已获权威 rowId 的消息写入客户端持久化缓存。
 *
 * 【设计意图 (Why)】
 *   接手流式处理内容：使流式结束或回合落盘后的对话内容实时落盘到 IndexedDB，
 *   避免刷新或离线时丢失刚才对话的内容。
 *
 * 【防范的历史坑 (Pitfall)】
 *   没有真实 rowId 的消息不落盘，避免产生 usr-/ast- 临时主键污染。
 *   只有通过 bindTurnRowIds 绑定过网关权威 rowId 的消息才能落盘。
 *
 * 【约束与规则 (Rules)】
 *   - 异步写入，降级静默，不阻塞 UI 渲染循环；
 *   - 写入失败不影响内存状态与流式响应。
 */
function persistTurnToCache(
  sessionId: string,
  botName: string | undefined | null,
  messages: MessageViewModel[]
): void {
  if (!sessionId) return;
  const isRoom = hostedRoomIds.has(sessionId) || state.groupRooms.some((g) => g.roomId === sessionId);
  const ref: CacheChannelRef = {
    profile: isRoom ? '' : (botName || state.profileName || 'default'),
    channel: isRoom ? 'room' : 'session',
    channelId: sessionId,
  };
  const rows: CachedMessageRow[] = [];
  for (const message of messages) {
    const row = toCachedMessage(message, ref);
    if (row) rows.push(row);
  }
  if (rows.length > 0) {
    void cacheService.appendRows(ref, rows).catch(() => undefined);
  }
}

/** 把缓存 Agent 行还原成渲染层档案结构。 */
function toAgentProfile(row: CachedAgentSummary): AgentProfile {
  return {
    name: row.name,
    displayName: row.displayName,
    description: row.description || '',
    model: row.model || '',
    avatar: row.avatar,
    hasAvatar: row.hasAvatar,
    timestamp: row.lastSessionLastActive,
  };
}

/**
 * 冷启动恢复：把本地快照填进 state 并立即渲染。
 *
 * 【规则】只在 state 为空时填充，绝不覆盖已由网络拉到的数据；
 * 读取失败时静默跳过（缓存是可选加速，不是功能依赖）。
 */
async function restoreCacheToState(): Promise<void> {
  try {
    const [indexRows, agents, avatars] = await Promise.all([
      cacheService.readSessions(),
      cacheService.readAgents(),
      cacheService.readAvatars(),
    ]);
    let touched = false;

    if (avatars && Object.keys(avatars).length > 0) {
      for (const [k, v] of Object.entries(avatars)) {
        if (v && typeof v === 'string') {
          profileAvatarCache.set(k.toLowerCase(), v);
        }
      }
    }

    if (state.sessions.length === 0) {
      const cachedSessions = indexRows.filter((row) => row.kind === 'session');
      if (cachedSessions.length > 0) {
        state.sessions = cachedSessions.map(toNormalizedSession);
        touched = true;
      }
    }
    if (state.groupRooms.length === 0) {
      const cachedGroups = indexRows.filter((row) => row.kind === 'group');
      if (cachedGroups.length > 0) {
        state.groupRooms = cachedGroups.map(toLeftRailGroupRoom);
        touched = true;
      }
    }
    if (agents.length > 0 && state.profiles.length === 0) {
      state.profiles = agents.map(toAgentProfile);
      touched = true;
    }

    if (touched) {
      logApp.info('cold start cache snapshot restored', {
        sessions: state.sessions.length,
        groups: state.groupRooms.length,
        profiles: state.profiles.length,
        avatars: Object.keys(avatars || {}).length,
      });
      // 缓存命中即代表该域已有真实数据：骨架必须让位，否则秒开的卡片会被占位块盖住。
      if (state.profiles.length > 0) state.profilesPhase = 'ready';
      if (state.sessions.length > 0) state.sessionsPhase = 'ready';
      // 【冷启动落点单一裁决 (Rules)】这里不再抢先打开"最新会话"：
      //   落点统一交给 applyColdStartFocus（Profile 非空则第一个 Agent），避免首屏两次焦点跳变。
      render();
    }
  // gate-degrade: 本地缓存读取失败属于可选加速失效，回落到网络拉取即可
  } catch {
  } finally {
    // 缓存为空或失败时也可能由后续网络数据裁决；applyColdStartFocus 内部幂等且相位未就绪时直接返回。
    void applyColdStartFocus();
  }
}

/**
 * 索引写入串行链。
 *
 * 【设计意图 (Why)】会话与群聊共享同一个索引键，两个异步写并发会互相覆盖。
 * 【规则】所有索引写入必须经此链，禁止直接调 cacheService.writeSessions。
 */
let indexWriteTail: Promise<unknown> = Promise.resolve();
function enqueueIndexWrite(task: () => Promise<void>): void {
  indexWriteTail = indexWriteTail.then(task, task).catch(() => undefined);
}

/** 权威会话列表写入缓存：保留既有群聊行，只替换 session 行。 */
function persistSessionsToCache(sessions: NormalizedSession[]): void {
  const rows = sessions.map(toCachedSession);
  enqueueIndexWrite(async () => {
    const existing = await cacheService.readSessions();
    const groups = existing.filter((row) => row.kind === 'group');
    await cacheService.writeSessions([...groups, ...rows]);
  });
}

/** 权威群聊列表写入缓存：保留既有会话行，只替换 group 行。 */
function persistGroupsToCache(rooms: LeftRailGroupRoom[]): void {
  const rows = rooms.map(toCachedGroup);
  enqueueIndexWrite(async () => {
    const existing = await cacheService.readSessions();
    const sessions = existing.filter((row) => row.kind === 'session');
    await cacheService.writeSessions([...sessions, ...rows]);
  });
}

/** 权威 Agent 列表写入缓存（异步，失败不影响渲染）。 */
function persistAgentsToCache(profiles: AgentProfile[]): void {
  void cacheService.writeAgents(
    profiles.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      description: p.description,
      model: p.model,
      avatar: p.avatar,
      hasAvatar: Boolean(p.hasAvatar),
      lastSessionLastActive: p.last_session?.last_active ?? p.timestamp,
    }))
  );
}

import type { HermesDesktopBridge } from '../preload/index.js';

declare global {
  interface Window {
    hermesDesktop?: HermesDesktopBridge;
    /** Runtime log level control: `__fluxLog.setLevel('trace')` in DevTools. */
    __fluxLog?: {
      readonly level: LogLevel;
      setLevel(next: string): LogLevel;
    };
    /** Native & fallback safe clipboard copy helper. */
    __fluxCopyText?: (text: string) => Promise<boolean>;
    /** E2E / CDP 对账触发器：全量刷新并对账会话列表 */
    __fluxFetchSessions?: () => Promise<void>;
    __fluxRender?: () => void;
    __fluxSelectSession?: (id: string, options?: { preserveFocus?: boolean; botName?: string }) => Promise<void>;
    __fluxLoadOlderMessages?: () => Promise<void>;
    /** E2E / CDP 消息微操作栏动作派发器 */
    __fluxMessageActions?: {
      handleCopyMessage: (btn: HTMLElement) => Promise<void>;
      handleRollbackMessage: (btn: HTMLElement) => void;
      handleForkMessage: (btn: HTMLElement) => Promise<void>;
    };
  }
}

interface AppState {
  platform: 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'web';
  theme: 'obsidian-gold' | 'suet-jade' | 'jade-white' | 'warm-paper' | 'ayu-light' | 'cyber-matrix';
  activeRailTab: 'chats' | 'projects' | 'groups';
  lang: 'zh' | 'en';
  isMaximized: boolean;
  leftRailCollapsed: boolean;
  inspectorCollapsed: boolean;
  activeInspectorTab: InspectorTab;
  /** Stored id of the focused conversation — the id the left rail lists. */
  activeSessionId: string;
  /** Live transport id of the focused conversation — required by prompt.submit / config.set. */
  activeLiveSessionId: string;
  selectedModel: string;
  availableModels: string[];
  modelDetails: ModelDetail[];
  /** 归一化后的模型目录（带可读显示名 / 价格 / 能力），选择器与输入舱标签的唯一数据源 */
  modelCatalog: ModelCatalogEntry[];
  /**
   * 模型目录指纹，随 `modelCatalog` 一起在拉取时计算一次。
   *
   * 【设计意图 (Why)】
   *   `render()` 在流式输出期间每帧都会执行；若在快照里现算 `map().join()`，
   *   72 个模型的字符串拼接会被无意义地重复几十次/秒。
   *
   * 【规则 (Rules)】
   *   只允许在目录被赋值的地方同步更新，禁止在渲染路径里重算。
   */
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
  /** PR-3d：新建弹窗初始甲板（会话 header 的 + 传 solo，群聊 header 的 + 传 group），入队即快照、出队不重推。 */
  newTaskModalTab: 'solo' | 'group';
  selectedNewTaskProjectId?: string;
  isAgentEditorOpen: boolean;
  editingAgentProfileName?: string;
  editingGroupRoomId?: string;
  /** Model menu visibility lives in state so a re-render cannot swallow it. */
  modelMenuOpen: boolean;
  /** Context menu for session, bot or group room item */
  sessionContextMenu?: ContextMenuProps;
  /** 全局极客美学二次确认模态状态机，彻底替换 Win32 阻塞式原生 confirm */
  confirmModal?: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    isDanger?: boolean;
    onConfirm: () => void | Promise<void>;
    onCancel?: () => void;
  };
  /** Inline failure line inside the dock (failure must never be silent). */
  dockNotice: string;
  /** Rail-level failure line, distinct from a legitimately empty session list. */
  sessionListError: string;
  /**
   * 首屏三域的首次到达相位（与 settingsModel 的 SettingsLoadable 同源思路：加载 ≠ 空）。
   *
   * 【设计意图 (Why)】骨架屏只在数据尚未到达时出现；三域各自独立，因为 Profile 与会话
   *   是两批 RPC，用单一 boolean 会让先到的一方永远等后到的一方。
   * 【约束与规则 (Rules)】数据到达（含空结果或失败）必须切 ready，否则骨架永久假加载。
   */
  profilesPhase: DataPhase;
  sessionsPhase: DataPhase;
  messagesPhase: DataPhase;
  /** Conversations optimistically inserted while the gateway persists them. */
  pendingSessionIds: string[];
  reasoningLevel: 'default' | 'none' | 'low' | 'high' | 'max' | 'off' | 'medium';
  approvalMode: 'auto' | 'ask' | 'sandbox';
  isStreaming: boolean;
  gatewayConnected: boolean;
  gatewayConnecting: boolean;
  gatewayLatencyMs: number;
  gatewayUrl: string;
  username: string;
  password: string;
  isSettingsOpen: boolean;
  settingsSection: SettingsSectionId;
  /** 设置中心的网关数据快照：每个域各自持有加载态，禁止用一个 boolean 混住"没数据"与"加载失败"。 */
  settingsProviders: SettingsLoadable<SettingsProviderRow[]>;
  settingsProfiles: SettingsLoadable<SettingsProfileRow[]>;
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
  agentActivityStatus?: string;
  inspectorFullscreen?: boolean;
  // Multi-tab file viewer & OpenChamber toolbar states
  openFiles: Array<{ id?: string; path: string; content: string; language?: string; isDiff?: boolean }>;
  activeFilePath: string;
  fileViewMode: 'rendered' | 'raw';
  fileShowLineNumbers: boolean;
  fileWordWrap: boolean;
  fileSearchOpen: boolean;
  fileSearchQuery: string;
  attachments: InputAttachmentItem[];
  slashPopperOpen: boolean;
  slashItems: SlashCommandOption[];
  mentionPopperOpen: boolean;
  mentionItems: MentionReferenceOption[];
  /** 回滚事务的乐观裁撤状态；null 表示无挂起回滚 */
  rollbackArmed: {
    sessionId: string;
    targetId: string;
    anchor: { kind: 'row'; rowId: number };
    snapshot: MessageViewModel[];
    removedCount: number;
    anchorLabel: string;
  } | null;
  /** @Agent 旁路呼叫（BTW 只读外援 / 子代理委派）的独立渲染域，绝不混入主消息流 */
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
  /** popper 点选产生的显式 @Agent 提及，发送前校验并作为 planSendRoute 的权威输入 */
  pickedMention: { profile: string; token: string } | null;
}

const desktopApi: HermesDesktopBridge | undefined = window.hermesDesktop;

/** 启动阶段专用 logger（此时业务 logger 尚未初始化） */
const bootLog = createLogger('boot');

/* --------------------------------------------------------------------------
   Leveled diagnostics
   Level resolution order:
     1. `?log=<level>` on the URL — the unpackaged dev build passes `debug`.
     2. `localStorage.hermes_flux_log_level` — persisted runtime override.
     3. `info` in production.
   Change it live from DevTools with `__fluxLog.setLevel('trace')`.
   -------------------------------------------------------------------------- */

const LOG_LEVEL_STORAGE_KEY = 'hermes_flux_log_level';

/**
 * 左轨宽度唯一真值源。
 *
 * 设计意图 (Why)：微轨 52px 常驻 + 抽屉 212px 紧凑档 = 264 是默认值；
 * 上限 480 为 2026-11-04 用户定案（"左栏最大宽度太窄，要调大"），可容纳长标题会话行完整扫描；
 * 防范的历史坑 (Pitfall)：上限曾是 500 无夹取残留、后收紧到 320 又被实测判为过窄——宽度是产品决策，必须走定案而非拍脑袋；
 *   拖拽与恢复两条路径各自写死常量会漂移。
 * 约束与规则 (Rules)：拖拽（beginLeftRailResize/bindRailResizeEvents）与冷启动恢复（clampLeftRailWidth）必须同时读本常量，禁止任何一处再写字面量；CDP 回归 rail-handle-symmetry 的夹取断言随本值联动。
 */
const LEFT_RAIL_WIDTH = { min: 264, max: 480, defaultValue: 264 } as const;

/** 把任意存档宽度夹取回合法区间；非数字一律回落到默认值。 */
function clampLeftRailWidth(raw: string | null): number {
  const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) return LEFT_RAIL_WIDTH.defaultValue;
  return Math.round(Math.max(LEFT_RAIL_WIDTH.min, Math.min(LEFT_RAIL_WIDTH.max, parsed)));
}

function resolveInitialLogLevel(): LogLevel {
  const fromUrl = new URLSearchParams(window.location.search).get('log');
  if (fromUrl) return parseLogLevel(fromUrl, 'debug');
  const stored = window.localStorage.getItem(LOG_LEVEL_STORAGE_KEY);
  if (stored) return parseLogLevel(stored, 'info');
  return 'info';
}

setLogLevel(resolveInitialLogLevel());

/**
 * 渲染进程日志落盘：把结构化记录经 IPC 转发给主进程统一写入
 * `userData/logs/flux-YYYY-MM-DD.log`。
 *
 * 【设计意图 (Why)】
 * 用户现场出问题时不能要求他开 DevTools 手抄 console。日志落盘后，
 * 只要把日志目录发回来就能还原完整的 RPC 参数、错误码与状态迁移。
 *
 * 【约束 (Rules)】
 * sink 注册必须在任何业务代码之前完成，否则启动阶段的失败会丢失。
 */
if (desktopApi?.appendLog) {
  addLogSink((record) => desktopApi.appendLog?.(record), 'debug');
}

/**
 * 兜底捕获：未处理的异常与 Promise 拒绝同样必须进日志文件。
 * 这两个入口是"界面白屏但没有任何报错"的唯一线索。
 */
window.addEventListener('error', (event) => {
  bootLog.error('window.error', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error instanceof Error ? event.error.stack : undefined,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  bootLog.error('unhandledrejection', reason instanceof Error ? reason : { reason });
});

/**
 * 跨平台安全剪贴板写入工具 (Triple Fallback)
 * 1. desktopApi.clipboardWrite (Electron 原生剪贴板 IPC，不受窗口失焦和权限限制)
 * 2. navigator.clipboard.writeText
 * 3. 隐藏 textarea + document.execCommand('copy') 物理保底
 */
async function safeCopyText(text: string): Promise<boolean> {
  const content = typeof text === 'string' ? text : String(text || '');
  if (desktopApi?.clipboardWrite) {
    try {
      const ok = await desktopApi.clipboardWrite(content);
      if (ok) return true;
    // gate-degrade: localStorage 读取在隐私模式下会抛错，属于可选增强而非必需能力
    } catch {}
  }
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content);
      return true;
    // gate-degrade: 可选的本地偏好读取失败即回落到默认值
    } catch {}
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = content;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const success = document.execCommand('copy');
    document.body.removeChild(ta);
    if (success) return true;
  // gate-degrade: 可选的本地偏好读取失败即回落到默认值
  } catch {}
  return false;
}

window.__fluxCopyText = safeCopyText;

/**
 * Markdown 代码块复制按钮：事件委托。
 * 【设计意图 (Why)】渲染出的 HTML 会经过 DOMPurify 清洗，内联 onclick 会被剥离，
 *   按钮会变成一个点不动的装饰。改为 data 属性 + 全局委托，清洗不影响交互。
 * 【约束与规则 (Rules)】只处理 .md-codeblock__copy，不拦截其它点击事件。
 */
document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  const btn = target?.closest?.<HTMLElement>('.md-codeblock__copy');
  if (!btn) return;
  const code = btn.closest('.md-codeblock')?.querySelector('code')?.textContent ?? '';
  if (!code) return;
  const original = btn.textContent ?? '';
  void safeCopyText(code).then((ok) => {
    if (!ok) return;
    btn.textContent = t('common.copied');
    setTimeout(() => {
      btn.textContent = original;
    }, 1500);
  });
});

/**
 * 设计意图 (Why):
 *   跨端自适应探测当前宿主运行时平台（Windows / macOS / Linux / iOS / Android / Web）。
 *   当运行在移动端（手机浏览器或 Capacitor 容器）或小屏环境时，
 *   使 Titlebar 能精准剥离桌面专用的 Windows 三键或 Mac 红绿灯控件，并使左侧栏默认折叠收纳。
 *
 * 防范的历史坑 (Pitfall):
 *   历史硬编码 `platform: 'windows'` 导致在 Android/iOS WebView 中渲染了无效的桌面关闭与缩放按键，
 *   且初始在 390px 视口下强行展开 260px 左侧栏，挤扁对话流。
 *
 * 约束与规则 (Rules):
 *   - 当 window.hermesDesktop 存在时，首屏保持桌面推导，后续由 desktopApi.getSystemInfo() 确认；
 *   - 当 window.hermesDesktop 不存在且处于小屏时，自动推导为移动端（android / ios）。
 */
function isStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((item) => typeof item === 'string');
}

function safeParseJson<T>(
  raw: string | null,
  fallback: T,
  validate?: (val: unknown) => val is T
): T {
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (validate) {
      return validate(parsed) ? parsed : fallback;
    }
    return parsed as T;
  // gate-degrade: JSON 解析异常时回落到默认值，避免启动受阻
  } catch {
    return fallback;
  }
}

function detectInitialPlatform(): 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'web' {
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent.toLowerCase();
    if (/android/.test(ua)) return 'android';
    if (/iphone|ipad|ipod/.test(ua)) return 'ios';
    if (!desktopApi && typeof window !== 'undefined' && window.innerWidth <= 768) {
      return /macintosh|mac os x/.test(ua) ? 'ios' : 'android';
    }
    if (/macintosh|mac os x/.test(ua)) return 'macos';
    if (/linux/.test(ua)) return 'linux';
    if (/windows/.test(ua)) return 'windows';
  }
  return desktopApi ? 'windows' : 'web';
}

const profileService = new ProfileService();
const groupRoomStore = new GroupRoomStore();

let fontPreferences: FontPreferences = loadFontPreferences();

const state: AppState = {
  platform: detectInitialPlatform(),
  theme: (() => {
    const savedTheme = localStorage.getItem('hermes_flux_theme') || localStorage.getItem('hermes_aura_theme');
    return resolveSkinId(savedTheme);
  })(),
  activeRailTab: 'chats',
  lang: (localStorage.getItem('hermes_flux_lang') || localStorage.getItem('hermes_aura_lang') as any) || 'zh',
  isMaximized: false,
  leftRailCollapsed: typeof window !== 'undefined' && window.innerWidth <= 768,
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
  activeFocus: { type: 'bot', botName: localStorage.getItem('hermes_flux_profile') || 'default' },
  sessionSearchQuery: '',
  isBotsGroupExpanded: true,
  isSessionsGroupExpanded: true,
  isGroupsGroupExpanded: true,
  isMoreSessionsExpanded: false,
  isNewTaskModalOpen: false,
  newTaskModalTab: 'solo',
  isAgentEditorOpen: false,
  editingAgentProfileName: undefined,
  editingGroupRoomId: undefined,
  profileName: localStorage.getItem('hermes_flux_profile') || localStorage.getItem('hermes_aura_profile') || 'default',
  modelMenuOpen: false,
  dockNotice: '',
  sessionListError: '',
  profilesPhase: 'loading',
  sessionsPhase: 'loading',
  messagesPhase: 'loading',
  pendingSessionIds: [],
  favoriteModels: safeParseJson<string[]>(localStorage.getItem('hermes_flux_fav_models') || localStorage.getItem('hermes_aura_fav_models'), [], isStringArray),
  recentModels: safeParseJson<string[]>(localStorage.getItem('hermes_flux_recent_models') || localStorage.getItem('hermes_aura_recent_models'), [], isStringArray),
  modelSearchQuery: '',
  reasoningLevel: 'high',
  approvalMode: 'auto',
  isStreaming: false,
  gatewayConnected: false,
  gatewayConnecting: Boolean(localStorage.getItem('hermes_flux_gateway_url') || localStorage.getItem('hermes_aura_gateway_url')),
  gatewayLatencyMs: 0,
  gatewayUrl: localStorage.getItem('hermes_flux_gateway_url') || localStorage.getItem('hermes_aura_gateway_url') || '',
  username: localStorage.getItem('hermes_flux_username') || localStorage.getItem('hermes_aura_username') || '',
  password: localStorage.getItem('hermes_flux_password') || localStorage.getItem('hermes_aura_password') || '',
  isSettingsOpen: false,
  settingsSection: 'appearance',
  settingsProviders: { status: 'idle' },
  settingsProfiles: { status: 'idle' },
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
  slashPopperOpen: false,
  slashItems: [],
  mentionPopperOpen: false,
  mentionItems: [],
  rollbackArmed: null,
  sideAgentCapsules: [],
  pickedMention: null,
};

const handoffService = new HandoffService();

/**
 * 渲染层到 core IRpcCaller 的唯一适配缝隙。
 * 【设计意图 (Why)】截断/分支等 wire 载荷必须由 core InteractiveService 单点构造，
 * 渲染层只递交意图；此前渲染层手拼 truncate 字段导致前端临时 id 逃逸触发网关 4018。
 */
const rpcCaller: IRpcCaller = {
  request: <TResult, TParams>(method: string, params?: TParams): Promise<TResult> => {
    if (!gatewayClient) {
      return Promise.reject(new Error('Gateway client is not connected'));
    }
    return gatewayClient.call<TResult>(method, params);
  },
};

window.__fluxLog = {
  get level() {
    return getLogLevel();
  },
  setLevel(next: string) {
    const level = parseLogLevel(next, getLogLevel());
    setLogLevel(level);
    window.localStorage.setItem(LOG_LEVEL_STORAGE_KEY, level);
    return level;
  },
};

const logApp = createLogger('app');
const logRender = createLogger('render');
const logSession = createLogger('session');
const logStream = createLogger('stream');
const logScroll = createLogger('scroll');

(window as any).__fluxState = state;
(window as any).__fluxConnect = connect;
window.__fluxSelectSession = selectSession;
window.__fluxLoadOlderMessages = loadOlderMessages;
window.__fluxFetchSessions = fetchSessions;
/** CDP 验证钩子：与 __fluxState/__fluxConnect 同一调试面。verify-hermes-flux harness 已声明依赖 window.__fluxRender；
 *  禁止业务代码调用，仅测试驱动"注入快照 → 重绘 → 出图"取证链路使用。 */
window.__fluxRender = render;

let gatewayClient: HermesGatewayClient | null = null;
let currentTicket: string | undefined = undefined;
let activeStreamingMessageId: string | null = null;
let activeStreamingStoredSessionId: string | null = null;
let activeStreamingLiveId: string | null = null;
/**
 * 本回合归属的 Bot 名（仅当在 Bot 工位发起时记录）。
 *
 * 【设计意图 (Why)】
 *   Bot 的运行态必须在回合结束时收尾。若只在"当前焦点仍是该 Bot"时才收尾，
 *   用户一旦切走到别的会话，Bot 就会永远停在"进行中"，并且永远不会变成未读。
 *   因此把"发起方"记录在回合上，与焦点解耦。
 */
let activeStreamingBotName: string | null = null;
const sessionDraftMap = new Map<string, string>();
const SESSION_DRAFT_STORAGE_KEY = 'hermes_flux_session_drafts';

// 冷启动从本地存储恢复未发送的会话草稿，防止切走或重启丢失用户正在编辑的提问
try {
  const rawDrafts = typeof localStorage !== 'undefined' ? localStorage.getItem(SESSION_DRAFT_STORAGE_KEY) : null;
  if (rawDrafts) {
    const parsed = JSON.parse(rawDrafts);
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string' && v.trim()) {
          sessionDraftMap.set(k, v);
        }
      }
    }
  }
// gate-degrade: 本地草稿恢复失败时回落到空草稿，属于可选加速
} catch {}

function persistDraftsToStorage(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const obj: Record<string, string> = {};
    for (const [k, v] of sessionDraftMap.entries()) {
      if (v.trim()) obj[k] = v;
    }
    localStorage.setItem(SESSION_DRAFT_STORAGE_KEY, JSON.stringify(obj));
  // gate-degrade: 本地草稿存盘失败属于降级场景，不阻断主流程
  } catch {}
}
const unreadSessionIds = new Set<string>();
const unreadGroupRoomIds = new Set<string>();
const unreadBotNames = new Set<string>();
const activeRunningGroupRoomIds = new Set<string>();
const activeRunningSessionIds = new Set<string>();
const activeRunningBotNames = new Set<string>();

/**
 * 传输层到持久层的目标会话 ID 归一化（调用 Core 权威句柄注册器）。
 * 设计意图 (Why)：彻底消除 WebSocket 下行事件 liveId 与会话池 storedId 错配；
 * 约束与规则 (Rules)：优先由 defaultSessionHandleRegistry 裁决，带当前视口流式 fallback。
 */
function toStoredSessionId(id: string | null | undefined): string | null {
  if (!id) return null;
  const known = state.sessions.map((s) => s.id);
  const resolved = defaultSessionHandleRegistry.toStoredId(id, known);
  if (resolved && resolved !== id) return resolved;
  if (activeStreamingLiveId && id === activeStreamingLiveId && activeStreamingStoredSessionId) {
    return activeStreamingStoredSessionId;
  }
  if (state.activeLiveSessionId && id === state.activeLiveSessionId && state.activeSessionId) {
    return state.activeSessionId;
  }
  return resolved;
}

/** 全局头像资产缓存（name/displayName/id -> dataUrl），防重拉取与时序冲刷 */
const AVATAR_PERSISTENCE_KEY = 'hermes_flux_avatar_cache';
const profileAvatarCache = new Map<string, string>();

// 冷启动同步从持久化存储恢复头像，实现 0ms 瞬间带头像开屏，杜绝降级为几何方块
// gate-degrade: 读取本地头像缓存失败时回落到实时拉取，属于可选性能加速
try {
  const persistedAvatars = localStorage.getItem(AVATAR_PERSISTENCE_KEY);
  if (persistedAvatars) {
    const parsed = JSON.parse(persistedAvatars);
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && v.startsWith('data:image')) {
          profileAvatarCache.set(k.toLowerCase(), v);
        }
      }
    }
  }
} catch (e) {
  console.warn('[Flux] Read avatar persistence error:', e);
}

function persistAvatarCache(): void {
  // gate-degrade: localStorage 写满或无权限时静默忽略，不阻断主流程
  try {
    const obj: Record<string, string> = {};
    for (const [k, v] of profileAvatarCache.entries()) {
      obj[k] = v;
    }
    localStorage.setItem(AVATAR_PERSISTENCE_KEY, JSON.stringify(obj));
    void cacheService.writeAvatars(obj).catch(() => undefined);
  } catch (e) {
    console.warn('[Flux] Persist avatar cache failed:', e);
  }
}

/**
 * 智能体主工位最新交互映射表（持久化存储 + 运行时内存）
 *
 * 【设计意图 (Why)】
 * 专职 Bot 的主工位（Forever Chat）状态与普通旁聊会话严格正交。
 * 持久化记录各 Bot 主工位的最后真实对话文本与时间戳，彻底杜绝冷启动与页面刷新时
 * 因网络异步延迟而闪现旧时间戳（如 22:48）或被普通会话池串扰。
 *
 * 【防范的历史坑 (Pitfall)】
 * 历史上该 Map 仅为纯内存 Map，刷新页面后丢失，导致冷启动探查阶段回退到普通会话池，
 * 把无关旁聊（如奥特曼短剧方案）的时间和副标题覆盖到专职 Bot 卡片上。
 *
 * 【约束与规则 (Rules)】
 * 读写全部经由 updateBotLatestActivity 收敛，严禁在业务各处分散私自修改。
 */
const BOT_ACTIVITY_PERSISTENCE_KEY = 'hermes_flux_bot_activity';
const botLatestActivityMap = new Map<string, BotActivityRecord>();

interface PersistedBotActivityRecord {
  lastMessage?: string;
  timestamp?: number;
}

function initBotActivityFromStorage(): void {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(BOT_ACTIVITY_PERSISTENCE_KEY) : null;
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (v && typeof v === 'object' && 'timestamp' in v) {
            const rec = v as PersistedBotActivityRecord;
            if (typeof rec.timestamp === 'number') {
              botLatestActivityMap.set(k, {
                lastMessage: String(rec.lastMessage || ''),
                timestamp: rec.timestamp,
              });
            }
          }
        }
      }
    }
  // gate-degrade: 本地存储损坏或不可用时不中断启动，平滑回退到网络状态
  } catch {}
}
initBotActivityFromStorage();

function persistBotActivityToStorage(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const obj: Record<string, PersistedBotActivityRecord> = {};
    for (const [k, v] of botLatestActivityMap.entries()) {
      obj[k] = v;
    }
    localStorage.setItem(BOT_ACTIVITY_PERSISTENCE_KEY, JSON.stringify(obj));
  // gate-degrade: 存储配额超限或无写权限时静默降级，不阻断主线程
  } catch {}
}

/**
 * 原子性更新指定 Bot 的主工位最新交互状态（委托给 Core 核心领域纯函数）
 */
function updateBotLatestActivity(botName: string, text: string, rawTimestamp: number | string): void {
  const res = applyBotActivity({
    profiles: state.profiles,
    activityMap: botLatestActivityMap,
    botName,
    text,
    timestamp: rawTimestamp,
    formatTime: formatSessionTime,
  });
  state.profiles = res.profiles;
  persistBotActivityToStorage();
}

/**
 * 强力恢复输入舱光标与焦点
 *
 * 【设计意图 (Why)】
 * 在会话删除、新建会话、或者由模态弹窗/确认框（confirm）交还控制权后，
 * 重新激活 Chromium 窗口与输入舱文本框的聚焦状态，让光标显式闪烁并使键盘可直接键入。
 *
 * 【防范的历史坑 (Pitfall)】
 * 1. 历史代码调用了 `input.blur()`，这在 Chromium 事件循环交织中会主动派发失焦事件并将焦点移交至 body，若后续 focus 被丢弃则直接杀死光标；
 * 2. 单纯调用 `input.focus()` 未设置选区时，Chromium 在某些排版帧中不会重绘光标闪烁，必须通过 `setSelectionRange(len, len)` 激活绘制；
 * 3. 单帧执行可能与原生弹窗退回窗口的异步激活产生竞态，采用双阶 rAF 配合微任务与短定时器兜底。
 *
 * 【约束与规则 (Rules)】
 * 仅在当前活动元素非目标 input 时进行重聚焦，避免对用户正在操作的光标选区造成强制跳动。
 */
function restoreComposerFocus(): void {
  const restore = () => {
    if (desktopApi?.activateWindow) {
      void desktopApi.activateWindow().catch(() => {});
    }
    const input = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
    if (input) {
      if (typeof window !== 'undefined' && typeof window.focus === 'function') {
        window.focus();
      }
      input.focus({ preventScroll: true });
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  };
  // 同步先尝试立即聚焦
  restore();
  // 双阶 rAF：首帧等待 DOM 几何排版收敛，次帧在系统窗口与样式激活稳定时执行聚焦
  requestAnimationFrame(() => {
    restore();
    requestAnimationFrame(restore);
  });
  setTimeout(restore, 50);
  setTimeout(restore, 200);
  setTimeout(restore, 400);
}

/** 健壮的 Agent 头像解析器：按 ID、实名、显示名、别名双向穿透查找缓存，避免单聊/群聊匹配丢失 */
function resolveAgentAvatar(nameOrDisplayName?: string): string {
  if (!nameOrDisplayName) return '';
  const clean = nameOrDisplayName.toLowerCase().trim();
  const cached = profileAvatarCache.get(clean);
  if (cached) return cached;
  const match = state.profiles.find((p) => p.name.toLowerCase() === clean || (p.displayName && p.displayName.toLowerCase() === clean));
  if (match?.avatar) return match.avatar;
  return '';
}
let dockNoticeDismissTimer: ReturnType<typeof setTimeout> | null = null;
let sessionsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let turnWatchdogTimer: ReturnType<typeof setTimeout> | null = null;

/** Upper bound for a silent turn before the composer is force-unlocked. */
const TURN_WATCHDOG_MS = 10 * 60 * 1000;

/** Extracts a human-readable reason out of a JSON-RPC error, an Error or a string. */
function describeRpcError(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; code?: unknown };
    if (typeof candidate.code !== 'undefined') {
      const code = String(candidate.code);
      const message = typeof candidate.message === 'string' ? candidate.message : '';
      return message ? `[${code}] ${message}` : `RPC 错误 ${code}`;
    }
    if (typeof candidate.message === 'string' && candidate.message.trim()) return candidate.message;
  }
  return typeof error === 'string' ? error : '未知错误';
}

/** The gateway rejects unknown params with a stable phrase; retry without them. */
function isExtraInputsError(error: unknown): boolean {
  const message = error && typeof error === 'object' ? (error as { message?: unknown }).message : undefined;
  return typeof message === 'string' && message.includes('Extra inputs');
}


/**
 * Distance from the bottom, in px, inside which the stream counts as
 * "following the conversation". Anything further up means the reader scrolled
 * back deliberately and must not be dragged along by new tokens.
 */
const STICK_TO_BOTTOM_THRESHOLD_PX = 48;

/**
 * Set right before a render that must land at the newest message (session
 * switch, first load, sending a prompt). `applyStreamAnchor` consumes it so the
 * viewport never flashes at the old position for a frame.
 */
let pendingScrollToBottom = false;
/**
 * 一次性抑制“贴底跟随”。
 * 【设计意图 (Why)】窗口扩展时若当前恰好也满足“距底 ≤48px”，render 会误判为贴底并直接跳到底部，
 *   随后锚点补偿再拉回顶部，用户会看到一次“跳底再弹回”的闪跳。
 * 【约束与规则】只影响触发它的那一次 render，渲染结束立即复位。
 */
let suppressPinBottomOnce = false;

function isStreamNearBottom(stream: HTMLElement | null): boolean {
  if (!stream) return false;
  return stream.scrollHeight - stream.scrollTop - stream.clientHeight <= STICK_TO_BOTTOM_THRESHOLD_PX;
}

/** Pins the stream to the newest message, then re-pins once layout settles. */
function scrollStreamToBottom(reason: string): void {
  const stream = document.getElementById('conversation-stream');
  if (!stream) return;
  scrollStreamToContentBottom(stream, parseFloat(getComputedStyle(stream).paddingBottom) || 0);

  requestAnimationFrame(() => {
    const settled = document.getElementById('conversation-stream');
    if (!settled) return;
    const drift = settled.scrollHeight - settled.scrollTop - settled.clientHeight;
    if (drift > 1) {
      scrollStreamToContentBottom(settled, parseFloat(getComputedStyle(settled).paddingBottom) || 0);
    }
    logScroll.debug('pinned to bottom', {
      reason,
      scrollHeight: settled.scrollHeight,
      clientHeight: settled.clientHeight,
      residualDrift: Math.round(drift),
    });
  });
}

/**
 * 首屏落定：在落定期内每帧把视口贴到最新消息。
 *
 * 【设计意图 (Why)】虚拟全高是分几帧才写进 scrollHeight 的（实测先 111711、后 137621），
 *   若只在"全高已生效"时贴一次，等待期间 90 帧会被耗尽，之后读者永远停在旧口径的中部。
 *   每帧跟随贴底，任何一次高度增长都能被跟上。
 *
 * 【约束与规则 (Rules)】
 *   1. 只在 `initialBottomSettling` 期间工作，最多 90 帧；
 *   2. 每帧写 scrollTop 都登记为程序写入，避免被滚动处理器误判成读者手势；
 *   3. 读者一旦产生真实滚动（任意方向），滚动处理器立即解除落定，把控制权交还读者。
 */
function settleInitialBottom(attempt = 0): void {
  if (!initialBottomSettling) return;
  requestAnimationFrame(() => {
    if (!initialBottomSettling) return;
    const stream = document.getElementById('conversation-stream');
    if (!stream) {
      initialBottomSettling = false;
      settledLayoutSignature = layoutSignature();
      return;
    }
    const distance = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
    /**
     * 贴底走「窗口真实底边对齐」，不再依赖 scrollHeight：
     * 虚拟高度是估算值，与窗口实际高度可差出上千像素。
     */
    const reserve = parseFloat(getComputedStyle(stream).paddingBottom) || 0;
    scrollStreamToContentBottom(stream, reserve);
    const after = Math.abs(stream.scrollHeight - stream.scrollTop - stream.clientHeight);
    if (settleMinFrames > 0) {
      settleMinFrames -= 1;
    } else if (after <= 2 || Math.abs(distance - after) <= 2) {
      /**
       * 【收敛条件 (Rules)】视口已贴在内容底（或本次已无法再推进）时结束，
       *   不必空转满 90 帧。
       */
      const virtualWindow = document.querySelector<HTMLElement>('.conv-virtual-window');
      const windowBottom = virtualWindow?.getBoundingClientRect().bottom;
      const safeBottom = stream.getBoundingClientRect().bottom - reserve;
      if (windowBottom === undefined || Math.abs(windowBottom - safeBottom) <= 2) {
        initialBottomSettling = false;
        settledLayoutSignature = layoutSignature();
        return;
      }
    }
    if (attempt < 90) {
      settleInitialBottom(attempt + 1);
      return;
    }
    initialBottomSettling = false;
    settledLayoutSignature = layoutSignature();
    logScroll.debug('initial bottom settled', {
      attempt,
      start: messageWindowStart,
      scrollHeight: stream.scrollHeight,
      averageRowHeight: Math.round(averageRowHeightPx * 100) / 100,
    });
  });
}

/**
 * 会话流底部内边距跟随输入舱实测高度。
 *
 * 【设计意图 (Why)】输入舱是绝对定位的浮层，会话流必须用 padding 为它让出空间。
 *   原先写死 160px，而输入舱会随附件行、通知条、队列托盘、多行输入长高（实测 110px 起，
 *   加通知栈可到 200px 以上）。一旦超出，最后一行文字就被压在输入舱底下，拖到底也看不全。
 *
 * 【防范的历史坑 (Pitfall)】按输入框高度估算会漏掉它上方的队列托盘与通知栈，
 *   必须量「pod 底边到 dock 顶边」这一整段，而不是量输入卡片本身。
 *
 * 【约束与规则 (Rules)】
 *   1. 变量必须写在 `#conversation-stream` 上：该元素自己声明过同名 scoped token，
 *      写在 pod 上会被它自己的声明覆盖；
 *   2. 每次量完追加 16px 呼吸位，保证末行与输入舱之间有视觉间距；
 *   3. 输入舱尺寸变化（多行输入、通知出现）由 ResizeObserver 触发重算。
 */
let dockInsetObserver: ResizeObserver | null = null;
let dockInsetTarget: HTMLElement | null = null;
/**
 * 把「内容底超出输入舱上方安全线」的剩余溢出累加到当前底部留白。
 *
 * 【设计意图 (Why)】虚拟高度按 `总条数 × 平均行高` 估算，末尾这批消息的实测行高高于均值
 *   （实测 122 条窗口比估算份额高 288px），窗口底部会溢出画布，溢出部分不受 padding 保护，
 *   最后一条消息就被压在输入舱底下，拖到底也看不全。
 *
 * 【约束与规则 (Rules)】
 *   1. 增量按「当前 padding 下还剩多少溢出」计算并累加，这样无论内容多长都能一次补足；
 *   2. 只增不减，且切换会话时重置为基准值——减小会让内容重新被压住并来回震荡；
 *   3. 只在贴底时测量，读者回溯时不动他的阅读位置。
 */
function syncStreamBottomInset(): void {
  const pod = document.querySelector<HTMLElement>('.flux-middle-pod');
  const dock = document.querySelector<HTMLElement>('.input-dock-container');
  const stream = document.getElementById('conversation-stream');
  if (!pod || !dock || !stream) return;
  /**
   * 安全线 = 输入舱顶边到 pod 底边的整段 + 32px 呼吸位。
   * 16px 在字体放大或输入舱带通知栈时余量不足，末行会贴到输入舱边上。
   */
  const baseInset = Math.round(pod.getBoundingClientRect().bottom - dock.getBoundingClientRect().top) + 32;
  const distance = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
  if (distance <= STICK_TO_BOTTOM_THRESHOLD_PX) {
    const virtualWindow = document.querySelector<HTMLElement>('.conv-virtual-window');
    const contentBottom = virtualWindow
      ? virtualWindow.getBoundingClientRect().bottom
      : document.querySelector<HTMLElement>('.conv-canvas')?.getBoundingClientRect().bottom;
    if (contentBottom !== undefined) {
      const visibleBottom = stream.getBoundingClientRect().bottom - baseInset;
      const need = Math.ceil(contentBottom - visibleBottom);
      const currentPx = Math.round(parseFloat(stream.style.getPropertyValue('--conv-gutter-bottom')) || baseInset);
      /**
       * 贴底时内容底 = 视口底 − 留白 + 溢出量，因此「当前留白 + 剩余溢出」就是不动点，
       * 一次即可到位；内容变短时同样成立，所以允许回缩。
       * 4px 死区吸收测量取整与亚像素抖动，避免每帧来回追。
       */
      const targetPx = Math.abs(need) > 4 ? Math.max(baseInset, currentPx + need) : currentPx;
      const next = `${targetPx}px`;
      const prev = stream.style.getPropertyValue('--conv-gutter-bottom');
      if (next !== prev) {
        /**
         * 底部留白变化的瞬间会把内容顶离视口底；原本贴底的读者必须继续贴底。
         * 交给首屏落定的同一套循环：它连续跟踪几帧，吸收 padding 重排与锚点回写造成的漂移。
         */
        stream.style.setProperty('--conv-gutter-bottom', next);
        initialBottomSettling = true;
        settleInitialBottom();
      }
    }
  }
  if (typeof ResizeObserver === 'undefined') return;
  if (!dockInsetObserver) {
    dockInsetObserver = new ResizeObserver(() => syncStreamBottomInset());
  }
  if (dockInsetTarget !== dock) {
    dockInsetObserver.disconnect();
    dockInsetObserver.observe(dock);
    dockInsetTarget = dock;
  }
}

/**
 * 把底部留白的重算压进一帧。
 *
 * 【设计意图 (Why)】滚动处理器是高频路径，每次都量两次 rect 会掉帧。
 *   但「读者滚到底」这一下必须重算：输入舱可能在聚焦后变高，而 padding 只在 render 时才更新，
 *   不补这一步，读者滚到底看到的仍是按旧舱高留出的空白，末行照样被压住。
 */
let insetSyncScheduled = false;

function scheduleStreamBottomInset(): void {
  if (insetSyncScheduled) return;
  insetSyncScheduled = true;
  requestAnimationFrame(() => {
    insetSyncScheduled = false;
    syncStreamBottomInset();
  });
}

/**
 * 贴底：窗口覆盖末尾时把窗口真实底边对齐到「输入舱上方安全线」，否则滚到 scrollHeight。
 *
 * 【设计意图 (Why)】虚拟高度是「总条数 × 平均行高」的估算，而单条消息行高差异极大。
 *   实测 3538 条会话的末尾窗口真实高度 14451，估算份额却有 19068，两者差 4617。
 *   此时按 scrollHeight 贴底，视口会落到最后一条真实消息之后——整屏空白。
 *   直接测量窗口底边并对齐，与估算口径彻底解耦。
 *
 * 【约束与规则 (Rules)】只在窗口覆盖末尾时按测量值对齐；窗口在中间时仍以 scrollHeight 为准，
 *   保证读者能看到尾部占位而不是被钉在窗口内部。
 */
function scrollStreamToContentBottom(stream: HTMLElement, reservePx: number): void {
  const virtualWindow = document.querySelector<HTMLElement>('.conv-virtual-window');
  if (virtualWindow && messageWindowEnd >= state.messages.length) {
    const streamRect = stream.getBoundingClientRect();
    const windowRect = virtualWindow.getBoundingClientRect();
    /**
     * 上限保护：窗口若因渲染缺失远高于安全线（例如内容尚未提交完），
     * 一次性回拉过大反而会跳过内容，这里按一屏收敛。
     */
    const delta = Math.round(windowRect.bottom - (streamRect.bottom - reservePx));
    if (Math.abs(delta) > 2) {
      stream.scrollTop += delta;
      markProgrammaticScroll(stream);
    }
    return;
  }
  stream.scrollTop = stream.scrollHeight;
  markProgrammaticScroll(stream);
}

/**
 * Chromium reports every unexplained layout shift; a viewport that "jumps" is
 * exactly a run of these. Logged so a jump can be traced to the frame that
 * caused it instead of guessed at.
 */
function installLayoutShiftDiagnostics(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  if (!isLogLevelEnabled('debug')) return;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
        const value = entry.value ?? 0;
        if (value < 0.0005 || entry.hadRecentInput) continue;
        const stream = document.getElementById('conversation-stream');
        logScroll.debug('layout shift', {
          value: Math.round(value * 1000) / 1000,
          scrollTop: stream ? Math.round(stream.scrollTop) : null,
          scrollHeight: stream ? stream.scrollHeight : null,
          streaming: state.isStreaming,
        });
      }
    });
    observer.observe({ type: 'layout-shift', buffered: true });
  // gate-degrade: 剪贴板首选通道失败时必须继续尝试次选通道，属于三重降级链的一环
  } catch {
    // The API is Chromium-only; its absence is not an error.
  }
}

// Token coalescer for smooth 60-120fps stream updates
const tokenCoalescer = new TokenCoalescer((flushedMap) => {
  const flushStartedAt = performance.now();

  // Follow-or-not is decided BEFORE content mutates: a reader who scrolled up
  // must never be yanked back by an incoming token.
  const followBottom = isStreamNearBottom(document.getElementById('conversation-stream'));
  let renderedChars = 0;

  for (const [msgId, entry] of flushedMap.entries()) {
    // Session Isolation: Tokens belong only to the session that initiated the turn
    const isCurrentSessionActive = activeStreamingStoredSessionId === state.activeSessionId;
    let targetMsg: MessageViewModel | undefined;

    // Always keep background session cache updated with incoming chunks
    if (activeStreamingStoredSessionId) {
      let cached = sessionMessagesCache.get(activeStreamingStoredSessionId);
      if (!cached) {
        cached = [];
        sessionMessagesCache.set(activeStreamingStoredSessionId, cached);
      }
      let cachedTarget = cached.find((m) => m.id === msgId);
      if (!cachedTarget) {
        cachedTarget = {
          id: msgId,
          role: 'assistant',
          content: '',
          thought: '',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        };
        cached.push(cachedTarget);
      }
      if (entry.content) {
        cachedTarget.content += entry.content;
        const sess = state.sessions.find((s) => s.id === activeStreamingStoredSessionId);
        if (sess) {
          sess.preview = cachedTarget.content;
          sess.timestamp = Date.now();
        }
        const curFocus = state.activeFocus;
        if (curFocus.type === 'bot') {
          updateBotLatestActivity(curFocus.botName, cachedTarget.content, Date.now());
        }
      }
      if (entry.thought) cachedTarget.thought = (cachedTarget.thought || '') + entry.thought;
    }

    if (isCurrentSessionActive) {
      targetMsg = state.messages.find((m) => m.id === msgId);
      if (!targetMsg && activeStreamingStoredSessionId) {
        const cached = sessionMessagesCache.get(activeStreamingStoredSessionId);
        targetMsg = cached?.find((m) => m.id === msgId);
        if (targetMsg && !state.messages.some((m) => m.id === msgId)) {
          state.messages.push(targetMsg);
        }
      }
    }

    if (!targetMsg || targetMsg.role !== 'assistant') continue;

    if (entry.content && isCurrentSessionActive) {
      targetMsg.content = (targetMsg.content || '') + entry.content;
      renderedChars += entry.content.length;
      const contentEl = document.getElementById(`msg-content-${targetMsg.id}`);
      if (contentEl) {
        if (contentEl.style.display === 'none') {
          contentEl.style.display = 'flex';
        }
        // 关键规则：必须显式锁定 flexDirection = 'column'，严禁 flex 默认的 row 布局将多个 Markdown 段落横向排成多列
        if (contentEl.style.flexDirection !== 'column') {
          contentEl.style.flexDirection = 'column';
        }
        const rendered = renderMarkdown(targetMsg.content);
        contentEl.innerHTML = rendered;
      }
    }

    if (entry.thought && isCurrentSessionActive) {
      targetMsg.thought = (targetMsg.thought || '') + entry.thought;
      const thoughtEl = document.getElementById(`msg-thought-${targetMsg.id}`);
      if (thoughtEl) {
        thoughtEl.innerText = targetMsg.thought || '';
        const fold = thoughtEl.closest('details');
        if (fold) {
          fold.style.display = 'block';
          if (!fold.open) fold.open = true;
          const summaryEl = fold.querySelector('summary span:last-child') as HTMLElement | null;
          if (summaryEl) {
            summaryEl.innerText = getCleanReasoningSummary(targetMsg.thought || '');
          }
        }
      }
    }
  }

  const stream = document.getElementById('conversation-stream');
  if (stream && followBottom) {
    stream.scrollTop = stream.scrollHeight;
  }

  logStream.trace('flush', {
    ms: Math.round((performance.now() - flushStartedAt) * 10) / 10,
    messages: flushedMap.size,
    chars: renderedChars,
    followBottom,
    scrollTop: stream ? Math.round(stream.scrollTop) : null,
  });
});

/** 画布结构脏标记：工具补丁容器缺失时置真，驱动下一次全量重建兜底 */
let canvasStructureDirty = false;

const toolPatchQueue = createToolPatchQueue({
  renderSlot: (messageId) => {
    const msg =
      state.messages.find((m) => m.id === messageId) ||
      (activeStreamingStoredSessionId
        ? sessionMessagesCache.get(activeStreamingStoredSessionId)?.find((m) => m.id === messageId)
        : undefined);
    return msg ? renderToolCapsuleSlot(msg) : '';
  },
  patchElement: (messageId, html) => {
    const el = document.getElementById(`msg-tools-${messageId}`);
    if (!el) return false;
    el.innerHTML = html;
    return true;
  },
  isNearBottom: () => isStreamNearBottom(document.getElementById('conversation-stream')),
  scrollBottom: () => scrollStreamToBottom('tool patch'),
  markStructureDirty: () => {
    canvasStructureDirty = true;
  },
  schedule: (cb) => requestAnimationFrame(cb),
});

function scheduleToolPatch(messageId: string): void {
  toolPatchQueue.schedulePatch(messageId);
}

function getEffectiveUrl(base: string): string {
  // 开源项目不内置任何默认网关，空地址必须原样返回空，交给连接面板要求用户填写
  let url = (base || '').trim();
  if (!url) return '';
  if (url.startsWith('ws://')) url = url.replace('ws://', 'http://');
  if (url.startsWith('wss://')) url = url.replace('wss://', 'https://');
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    const isLoopback = /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(url) || url.startsWith('127.0.0.1:') || url.startsWith('localhost:');
    url = isLoopback ? `http://${url}` : `https://${url}`;
  }
  return url.replace(/\/+$/, '');
}

async function testConnection(
  url: string,
  username: string,
  pass: string
): Promise<{ ok: boolean; message: string; latency: number; ticket?: string }> {
  try {
    if (!desktopApi?.authenticateGateway) return { ok: false, message: t('chat.gatewayNotConnected'), latency: 0 };
    return await desktopApi.authenticateGateway({ url, username, password: pass });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : t('chat.gatewayNotConnected');
    return {
      ok: false,
      message: `${t('chat.gatewayNotConnected')}: ${message}`,
      latency: 0,
    };
  }
}

function rpcErrorCode(error: unknown): number | null {
  if (error instanceof Error && 'code' in error && typeof error.code === 'number') return error.code;
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'number') return error.code;
  return null;
}

/**
 * Coalesces bursts of `sessions.changed` broadcasts into one list fetch.
 * The gateway emits several of them per turn, so an unthrottled refresh would
 * otherwise re-render the whole shell many times in a row.
 */
function scheduleSessionsRefresh(delayMs = 180): void {
  if (sessionsRefreshTimer) clearTimeout(sessionsRefreshTimer);
  sessionsRefreshTimer = setTimeout(() => {
    sessionsRefreshTimer = null;
    void fetchSessions();
  }, delayMs);
}

/**
 * 时间格式化委托 ui 单一真值源 formatLeftRailTime（PR-3d 收敛）。
 * 设计意图 (Why)：本函数曾是第二份"昨天 23:30"两段式实现，行组件优先上游字符串导致长格式永远赢。
 * 防范的历史坑 (Pitfall)：两份格式化器漂移（本坑）；曾无条件本地覆盖上游时间致主工位卡与产物对不上。
 * 约束与规则 (Rules)：禁止在此再写任何日期分支；规格只改 leftRailModel.formatLeftRailTime 并同步其形式化定理。
 */
function formatSessionTime(timestamp: number): string {
  if (!timestamp || timestamp <= 0) return '';
  return formatLeftRailTime(timestamp);
}

const sessionListGeneration = new SessionListGeneration();

/**
 * 会话真实副标题缓存：sessionId -> { lastActive, text, botName }。
 *
 * 【设计意图 (Why)】
 *   左侧栏副标题必须是"真实最后一条消息"，而网关 REST 列表的 preview 只是最后一条用户提问输入。
 *   持久化缓存记录经过真实消息流或 fetchLastMessage 确认的 Agent 最新真实回复，
 *   避免每次刷新都重新发起大量网络拉取，并彻底阻断网关陈旧 preview 的冲刷覆盖。
 *
 * 【防范的历史坑 (Pitfall)】
 *   历史上曾经直接用网关自带的 preview，导致用户点击会话后修正的高清回复被下次列表刷新
 *   重新冲刷成"你好"，用户看到副标题反复闪烁、变来变去。
 *
 * 【约束与规则 (Rules)】
 *   - 冷启动同步从 localStorage 恢复，实现 0ms 瞬间带副标题开屏；
 *   - 更新统一落盘到 localStorage (SESSION_PREVIEW_PERSISTENCE_KEY)。
 */
const SESSION_PREVIEW_PERSISTENCE_KEY = 'hermes_flux_session_previews';
interface PersistedSessionPreview {
  lastActive: number;
  text: string;
  botName?: string;
}
const sessionPreviewCache = new Map<string, PersistedSessionPreview>();

// 冷启动从 localStorage 恢复会话副标题缓存，实现 0ms 瞬间带副标题开屏
// gate-degrade: 读取本地副标题缓存失败时回落到网络拉取，属于可选加速
try {
  const rawPrev = typeof localStorage !== 'undefined' ? localStorage.getItem(SESSION_PREVIEW_PERSISTENCE_KEY) : null;
  if (rawPrev) {
    const parsed: unknown = JSON.parse(rawPrev);
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (v && typeof v === 'object' && 'text' in v && 'lastActive' in v) {
          const rec = v as PersistedSessionPreview;
          if (typeof rec.text === 'string' && typeof rec.lastActive === 'number') {
            sessionPreviewCache.set(k, {
              lastActive: rec.lastActive,
              text: rec.text,
              botName: typeof rec.botName === 'string' ? rec.botName : undefined,
            });
          }
        }
      }
    }
  }
// gate-degrade: 本地副标题持久化读取失败时平滑回退，属于冷启动可选加速
} catch {}

function persistSessionPreviewCache(): void {
  // gate-degrade: localStorage 写满或无权限时静默降级，不阻断主流程
  try {
    if (typeof localStorage === 'undefined') return;
    const obj: Record<string, PersistedSessionPreview> = {};
    for (const [k, v] of sessionPreviewCache.entries()) {
      obj[k] = v;
    }
    localStorage.setItem(SESSION_PREVIEW_PERSISTENCE_KEY, JSON.stringify(obj));
  // gate-degrade: 存储配额超限或无写权限时静默降级，不阻断主线程
  } catch {}
}

let enrichPreviewGeneration = 0;

/** 轻量级按需回补当前 Agent 抽屉中可见的真实最后一条消息（带缓存与并发上限，杜绝 60 次全量轮询风暴） */
async function enrichVisibleSessionPreviews(): Promise<void> {
  const client = gatewayClient;
  if (!client) return;
  const gen = ++enrichPreviewGeneration;

  const currentBot = state.profileName || 'default';
  const targets = state.sessions
    .filter((s) => !s.isArchived && !s.hidden && (s.botName === currentBot || (!s.botName && currentBot === 'default')))
    .filter((s) => {
      const cached = sessionPreviewCache.get(s.id);
      return !cached || Math.abs((s.timestamp || 0) - cached.lastActive) >= 1000;
    })
    .slice(0, 10);

  if (targets.length === 0) return;

  const updates = new Map<string, { text: string; ts: number }>();
  await Promise.all(
    targets.map(async (t) => {
      try {
        const last = await client.fetchLastMessage(t.id, { profile: t.botName || 'default' });
        if (last && last.text) {
          updates.set(t.id, { text: last.text, ts: last.timestamp || t.timestamp });
          sessionPreviewCache.set(t.id, {
            lastActive: t.timestamp,
            text: last.text,
            botName: t.botName,
          });
        }
      // gate-degrade: 单条会话真实最后一条消息获取失败时保留网关原始副标题，不阻断其余会话
      } catch {}
    })
  );

  if (gen !== enrichPreviewGeneration || updates.size === 0) return;
  persistSessionPreviewCache();

  let changed = false;
  state.sessions = state.sessions.map((s) => {
    const upd = updates.get(s.id);
    if (upd && s.preview !== upd.text) {
      changed = true;
      return { ...s, preview: upd.text };
    }
    return s;
  });

  if (changed && gen === enrichPreviewGeneration) {
    syncProfileLastMessages();
    persistSessionsToCache(state.sessions);
    render();
  }
}

// 空会话列表常量：避免在多处写 `[] as NormalizedSession[]` 类型断言（调用方只读，不会原地修改）
const NO_SESSIONS: NormalizedSession[] = [];

async function fetchSessions(): Promise<void> {
  const client = gatewayClient;
  if (!client) return;

  const currentGen = sessionListGeneration.beginFetch();

  // 1. 若 profiles 尚未拉取，先动态拉取全量网关 Profile 列表
  if (state.profiles.length === 0) {
    try {
      state.profiles = await client.listProfiles();
      // 这里拿到了 Agent 域的真值：必须同步离开骨架相位，否则冷启动落点会一直等一个不会到来的 fetchProfiles。
      state.profilesPhase = 'ready';
    // gate-degrade: 读取本地会话缓存失败时回落到网络拉取，缓存本就是可选加速
    } catch {}
  }

  // 纯动态提取当前网关所有真实存在的 Profile 集合（零硬编码，通用支持任意网关部署）
  const targetProfiles = new Set<string>(['default']);
  if (state.profileName) targetProfiles.add(state.profileName);
  for (const p of state.profiles) {
    if (p.name) targetProfiles.add(p.name);
  }

  const profileMap = new Map<string, AgentProfile>();
  for (const p of state.profiles) {
    profileMap.set(p.name, p);
  }

  // 2. 并发向网关拉取所有当前已注册 Agent 的会话列表
  //    每个结果都保留 ok 标记：全部成功时本轮结果才是权威的；任一失败都不能把"失败"当成"没有会话"，
  //    否则一次网络抖动就会把用户看得见的会话全部抹掉（失败 ≠ 空）。
  const results = await Promise.allSettled(
    Array.from(targetProfiles).map(async (profName) => {
      const outcome = await client.listSessions(profName, 100);
      if (!outcome.ok || !outcome.sessions) {
        return { ok: false, profile: profName, error: outcome.error ?? 'unknown error', sessions: NO_SESSIONS };
      }
      const prof = profileMap.get(profName);
      const sessions = outcome.sessions.map((s) => {
        const botName = s.botName || profName;
        const matchingProfile = profileMap.get(botName) || prof;
        const timeWithDate = formatSessionTime(s.timestamp) || s.time;
        const resolvedAvatar = matchingProfile?.avatar || resolveAgentAvatar(botName) || resolveAgentAvatar(profName) || '';
        return {
          ...s,
          time: timeWithDate,
          botName,
          botDisplayName: matchingProfile?.displayName || botName,
          botAvatar: resolvedAvatar,
        };
      });
      return { ok: true, profile: profName, error: '', sessions };
    })
  );

  // 竞态守卫：如果本轮拉取期间已有更新的请求发出，放弃当前结果
  if (!sessionListGeneration.mayCommit(currentGen)) return;

  const settled = results.map((r) =>
    r.status === 'fulfilled'
      ? r.value
      : { ok: false, profile: 'unknown', error: String(r.reason), sessions: NO_SESSIONS }
  );
  const authoritative = settled.every((r) => r.ok);

  // 失败不可静默：具体是哪个 Bot、什么错误必须进日志，界面只保留通用提示
  if (!authoritative) {
    logSession.warn('session list partially failed', {
      profiles: settled.filter((r) => !r.ok).map((r) => ({ profile: r.profile, error: r.error })),
    });
  }

  // 3. 对账：权威结果与本地列表合并（去重、可见性、临时会话、归档残影剔除全部在 core 纯函数里完成）
  const previousSessions = state.sessions;
  const reconciled = reconcileSessionList({
    previous: state.sessions,
    fetched: settled.flatMap((r) => r.sessions),
    authoritative,
    pendingIds: state.pendingSessionIds,
    profileName: state.profileName,
  });
  state.sessions = reconciled.sessions;
  state.pendingSessionIds = reconciled.pendingIds;
  // 会话域已到达（含权威空列表）：离开骨架相位，空态才允许下"暂无历史会话"的结论。
  state.sessionsPhase = 'ready';
  // 权威结果落缓存：只在完整成功时覆盖，部分失败保留上一代快照（规则 1）
  if (authoritative) persistSessionsToCache(reconciled.sessions);

  // 运行中的会话以本地乐观时间戳为准，防止过期 last_active 把置顶冲掉
  if (activeRunningSessionIds.size > 0) {
    state.sessions = preserveRunningActivity(state.sessions, previousSessions, activeRunningSessionIds);
  }

  // 对账：任何被丢弃的会话都必须留痕，避免"会话凭空消失"
  if (reconciled.dropped.length > 0) {
    logSession.debug('session dedupe report', {
      dropped: reconciled.dropped.length,
      samples: reconciled.dropped.slice(0, 5),
    });
  }
  if (reconciled.pruned.length > 0) {
    logSession.debug('session superseded by authority', {
      pruned: reconciled.pruned.length,
      samples: reconciled.pruned.slice(0, 5),
    });
  }

  // 失败不可静默：任一 Profile 拉取失败时保留错误提示，只有全部成功才清空
  if (authoritative) {
    state.sessionListError = '';
  } else if (!state.sessionListError) {
    state.sessionListError = t('rail.errorSub');
  }

  // 消费持久化真实副标题缓存，彻底杜绝网关陈旧 preview 覆盖
  for (const s of state.sessions) {
    const cachedPrev = sessionPreviewCache.get(s.id);
    if (cachedPrev && cachedPrev.text) {
      const tsDiff = Math.abs((s.timestamp || 0) - (cachedPrev.lastActive || 0));
      if (tsDiff < 1000 || (cachedPrev.lastActive || 0) >= (s.timestamp || 0)) {
        s.preview = cachedPrev.text;
      }
    }
  }

  // 4. 同步刷新工程项目的关联会话与智能体最新对话副标题
  if (state.projects.length > 0) {
    syncProjectSessions();
  }
  syncProfileLastMessages();
  void enrichVisibleSessionPreviews();

  // 冷启动落点统一在此裁决：Profile 非空则落第一个 Agent 的终身主工位，否则退回第一个会话。
  // 【防范的历史坑 (Pitfall)】这里曾直接打开"最新会话"，与 Profile 到达后的工位切换叠加成首屏两次焦点跳变。
  if (state.profilesPhase === 'ready') {
    await applyColdStartFocus();
  }
  render();
}

interface ProjectRawRecord {
  id?: string;
  projectId?: string;
  name?: string;
  slug?: string;
  primary_path?: string;
  primaryPath?: string;
  path?: string;
}

interface ProjectsListResponse {
  projects?: ProjectRawRecord[];
  data?: ProjectRawRecord[];
}

/**
 * 智能体副标题与时间联动（严格实体领域隔离与单一事实来源）
 *
 * 【设计意图 (Why)】
 * 专职 Bot 的主工位（Forever Chat）与普通旁聊会话（Session）是相互正交的两个独立实体领域。
 * 抽屉顶部的专职 Bot 卡片（rail-primary-agent-card）展现的时间和副标题，仅且必须代表
 * 该 Bot 本身主工位（Forever Chat）的真实对话状态。
 *
 * 【防范的历史坑 (Pitfall)】
 * 历史上曾经在第 3 步扫描普通会话池（state.sessions）拿取最新普通会话覆盖 Bot 卡片，
 * 导致用户在专职主工位聊天时，左上角卡片显示着另一个旁聊会话（如“奥特曼反差猫短剧方案 昨天 23:54”）
 * 的时间和文案，造成严重的时间、副标题与内容不一致与闪烁回退。
 *
 * 【约束与规则 (Rules)】
 * 严禁使用普通会话列表覆盖 Bot 属性；Bot 时间必须经过 formatSessionTime 统一格式化。
 */
function syncProfileLastMessages(): void {
  state.profiles = syncBotProfiles({
    profiles: state.profiles,
    activityMap: botLatestActivityMap,
    foreverChatCache: botForeverChatCache,
    sessionMessagesCache,
    formatTime: formatSessionTime,
  });
}

const projectService = new ProjectService();

/** 真实拉取网关工程项目列表 (使用官方 ProjectService 契约通道) 并自动关联所属会话 */
async function fetchProjects(): Promise<void> {
  const client = gatewayClient;
  if (!client) return;
  try {
    let summaries: ProjectSummary[] = await projectService.listProjects(client, true).catch(() => []);

    // 容错兜底：若 Service 解析为空，尝试无参 raw 契约解析
    if (summaries.length === 0) {
      const rawRes = await client.call<ProjectsListResponse>('projects.list', {}).catch(() => null);
      const rawList = Array.isArray(rawRes?.projects)
        ? rawRes.projects
        : Array.isArray(rawRes?.data)
        ? rawRes.data
        : [];
      if (rawList.length > 0) {
        summaries = rawList.map((p) => ({
          projectId: String(p.id || p.projectId || ''),
          name: String(p.name || p.id || 'Project'),
          slug: String(p.slug || p.name || p.id || 'project'),
          primaryPath: String(p.primary_path || p.primaryPath || p.path || ''),
          additionalFolders: [],
          isActive: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }));
      }
    }

    state.projects = summaries.map((s) => ({
      id: s.projectId,
      name: s.name,
      path: s.primaryPath,
      sessions: [],
    }));

    syncProjectSessions();
    render();
  } catch (e) {
    // Failure Is Not Empty: 网络或网关故障时绝不可将 state.projects 抹杀为空数组伪装成没有项目
    console.warn('[Flux] fetchProjects failed:', e);
    // 保留上一次已拉取到的项目列表或提示错误，严禁静默覆盖为权威空
    render();
  }
}

/** 会话与项目归属动态映射：委派 core 纯函数进行多维度路径与标识映射 */
/** 项目成员关系版本：syncProjectSessions 原地改 proj.sessions，数组引用不变，必须靠版本号驱动快照失效。 */
let projectsVersion = 0;

function syncProjectSessions(): void {
  projectsVersion += 1;
  for (const proj of state.projects) {
    proj.sessions = state.sessions.filter((s: NormalizedSession) =>
      doesSessionBelongToProject(s, proj)
    );
  }
}

/** 网关托管房间 ID 集合：支持 groups.send / groups.log */
const hostedRoomIds = new Set<string>();

/** 真实拉取网关多 Agent 群聊房间列表 (以官方 groups.* 服务端托管为主) */
async function fetchGroupRooms(): Promise<void> {
  const client = gatewayClient;
  if (!client) return;
  try {
    if (state.profiles.length === 0) {
      try {
        state.profiles = await client.listProfiles();
      } catch (e) {
        console.warn('[Flux] listProfiles failed before fetchGroupRooms:', e);
      }
    }

    const mergedRoomsMap = new Map<string, LeftRailGroupRoom>();
    let groupsAuthoritative = false;

    // 1. 网关正统托管房间（支持 groups.send / groups.log / 真实多智能体协同调度）
    hostedRoomIds.clear();
    try {
      const rpcRooms = await groupRoomStore.listRooms(client);
      groupsAuthoritative = true;
      for (const r of rpcRooms) {
        hostedRoomIds.add(r.roomId);
        const existing = state.groupRooms.find((old) => old.roomId === r.roomId);
        if (existing && r.updatedAt && existing.updatedAt && r.updatedAt > existing.updatedAt) {
          if (state.activeFocus.type !== 'group' || state.activeFocus.roomId !== r.roomId) {
            unreadGroupRoomIds.add(r.roomId);
          }
        }
        const normUpdatedAt = typeof r.updatedAt === 'number' ? (r.updatedAt > 1e11 ? r.updatedAt : r.updatedAt * 1000) : Date.now();
        const normCreatedAt = typeof r.createdAt === 'number' ? (r.createdAt > 1e11 ? r.createdAt : r.createdAt * 1000) : Date.now();
        mergedRoomsMap.set(r.roomId, {
          roomId: r.roomId,
          name: r.name,
          members: r.members,
          createdAt: normCreatedAt,
          updatedAt: normUpdatedAt,
        });
      }
    } catch (e) {
      console.warn('[Flux] groups.list failed:', e);
    }

    // 权威门：只有 groups.list 完整成功才允许覆盖列表与写缓存；
    // 失败时保留既有群聊，避免一次弱网抖动把整列群聊清空（失败 ≠ 空）。
    if (groupsAuthoritative) {
      state.groupRooms = Array.from(mergedRoomsMap.values());
      persistGroupsToCache(state.groupRooms);
    }
    render();
  } catch (e) {
    console.warn('[Flux] fetchGroupRooms failed:', e);
    // 保留既有列表，不清空
    render();
  }
}

/** 进入指定多 Agent 研讨会议室并载入研讨记录 */
async function openGroupRoom(roomId: string): Promise<void> {
  if (!roomId || !gatewayClient) return;
  // 切换焦点域前解除挂起回滚，防止普通会话的乐观裁撤横幅泄漏进群聊视图
  disarmRollbackOnLeave();
  state.activeFocus = { type: 'group', roomId };
  applyEnteredRead(unreadGroupRoomIds, roomId);
  const targetRoom = state.groupRooms.find((r) => r.roomId === roomId);

  state.activeSessionId = roomId;
  state.activeLiveSessionId = roomId;
  state.isLoadingOlder = false;
  state.hasOlderMessages = false;
  // 研讨记录尚未到达：与普通会话同口径声明 loading，避免把"切换房间的空窗"读成空会话。
  state.messagesPhase = 'loading';
  const generation = ++activeLoadMessagesGeneration;
  const guard = { sessionId: roomId, generation };

  // 切换房间时重置线程上下文，避免跨房间误用同一 thread_id
  activeGroupThreadId = null;
  activeGroupThreadAt = 0;

  // 从 groups.log 拉取官方事件流
  try {
    const guarded = await runGuarded(
      guard,
      () => ({ sessionId: state.activeSessionId, generation: activeLoadMessagesGeneration }),
      () => undefined,
      () => groupRoomStore.fetchLogs(roomId, gatewayClient!),
      logSession,
    );
    if (guarded.status === 'discarded') return;
    const logs = guarded.value;
    if (logs && logs.length > 0) {
      state.messages = logs.map((entry, idx) => {
        const senderName = entry.senderProfile || 'Agent';
        return {
          id: entry.messageId || `g_msg_${idx}`,
          role: entry.actorKind === 'user' || entry.senderProfile === 'user' ? 'user' : 'assistant',
          content: entry.text,
          sender: senderName,
          senderAvatar: resolveAgentAvatar(senderName),
          timestamp: formatTimestamp(entry.timestamp || Date.now()),
        };
      });
    } else {
      const roomName = targetRoom?.name || t('group.defaultRoomName');
      const membersText = targetRoom?.members?.join('、') || '';
      state.messages = [
        {
          id: 'group_seed_notice',
          role: 'system',
          content: t('group.welcomeInit', { name: roomName, members: membersText }),
          timestamp: formatTimestamp(Date.now()),
        },
      ];
    }
  } catch {
    if (state.activeSessionId !== guard.sessionId || activeLoadMessagesGeneration !== guard.generation) return;
    const roomName = targetRoom?.name || t('group.defaultRoomName');
    const membersText = targetRoom?.members?.join('、') || '';
    state.messages = [
      {
        id: 'group_seed_notice',
        role: 'system',
        content: t('group.welcomeReady', { name: roomName, members: membersText }),
        timestamp: formatTimestamp(Date.now()),
      },
    ];
  }

  pendingScrollToBottom = true;
  // 无论拿到日志还是回落种子通知，研讨记录都已落地：离开骨架相位。
  state.messagesPhase = 'ready';
  render();

  // 若为托管房间，进入时自动启动持续同步
  if (hostedRoomIds.has(roomId)) {
    void pollGroupRoomLog(roomId);
  }
}

/** Bot 终身主工位内存秒开缓存 (消除串行 RPC 延迟，实现 0ms 瞬间切换) */
const botForeverChatCache = new Map<string, string>();

/** 点击指定 Bot 项直接进入该专职 Bot 的主工位对话界面 (Forever Chat 专属接口) */
async function openBotChat(botProfile: string): Promise<void> {
  const client = gatewayClient;
  if (!botProfile || !client) return;
  // 任何一次显式进入 Agent 都视为用户已表达意图，冷启动落点不得再抢焦点。
  cancelColdStartFocus();

  // 【失败回退 (Rules)】记录进入前的焦点与 Profile：冷路径失败时完整恢复，
  // 绝不把用户困在空白工位，也不让左侧选中 Agent 与实际 Profile 上下文错配。
  const outgoingFocus = state.activeFocus;
  const outgoingSessionId = state.activeSessionId;
  const outgoingProfileName = state.profileName;
  const wasBotFocused = state.activeFocus.type === 'bot' && state.activeFocus.botName === botProfile;

  state.profileName = botProfile;
  // 切入 Bot 专职工位前解除普通会话挂起回滚，防跨域泄漏
  disarmRollbackOnLeave();
  state.activeFocus = { type: 'bot', botName: botProfile };
  const generation = ++activeLoadMessagesGeneration;
  const guard = { sessionId: `bot:${botProfile}`, generation };
  localStorage.setItem('hermes_flux_profile', botProfile);
  localStorage.setItem('hermes_aura_profile', botProfile);

  // 清除属于该智能体的未读标记（仅针对该 Bot 本身，会话状态严格独立）
  applyEnteredRead(unreadBotNames, botProfile);

  // 1. 若内存缓存已持有该 Bot 的 Forever Chat ID，0ms 瞬间秒开切入！
  const cachedSessionId = botForeverChatCache.get(botProfile);
  if (cachedSessionId) {
    // 【设计意图 (Why)】selectSession 的同步段会经 loadMessages 渲染一次（缓存命中 2688 / 未命中清屏 2699）；
    // 只有它在 3329 行因“同一会话已挂载”早退时才需要补一次渲染。
    // 【防范的历史坑 (Pitfall)】这里曾无条件再 render() 一次，导致 Agent 点击链路每次多付一整轮
    // 左轨、标题栏与消息列表绘制，点击处理耗时约为普通会话的两倍。
    const alreadyMounted = state.activeSessionId === cachedSessionId
      && Boolean(state.activeLiveSessionId)
      && state.messages.length > 0;
    void selectSession(cachedSessionId, { preserveFocus: true });
    void fetchModelOptions({ clearNotice: true });
    if (alreadyMounted) {
      // selectSession 早退不会渲染；未读点已在 applyEnteredRead 中清除，这里同步刷新左轨并保持输入舱焦点。
      if (wasBotFocused) restoreComposerFocus();
      render();
    }
    return;
  }

  // 2. 首次探查前先给出首帧反馈：把旧会话落内存缓存、清空视口，再显示目标 Bot 的空态。
  // 【防范的历史坑 (Pitfall)】历史实现只 render() 不清空 messages，等待 session.list 的近 1 秒里
  //   “新 Bot 标题 + 旧会话内容”并置，用户会误以为点错或没点上。
  if (outgoingSessionId && state.messages.length > 0) {
    sessionMessagesCache.set(outgoingSessionId, [...state.messages]);
  }
  state.messages = [];
  state.hasOlderMessages = false;
  state.isLoadingOlder = false;
  state.activeSessionId = '';
  state.activeLiveSessionId = '';
  // 冷路径要等 session.list：这段空窗必须声明 loading，否则会先闪一张"开始新的对话"。
  state.messagesPhase = 'loading';
  pendingScrollToBottom = true;
  render();

  try {
    // 2. 首次探查并建立缓存
    const guarded = await runGuarded(
      guard,
      () => ({ sessionId: `bot:${state.activeFocus.type === 'bot' ? state.activeFocus.botName : ''}`, generation: activeLoadMessagesGeneration }),
      () => undefined,
      () => profileService.getOrCreateForeverChat(botProfile, client),
      logSession,
    );
    if (guarded.status === 'discarded') return;
    const foreverChat = guarded.value;
    botForeverChatCache.set(botProfile, foreverChat.sessionId);

    // 【竞态守卫 (Rules)】await 期间用户可能已切到别的 Bot/会话。只有仍瞄准本 Bot 时才提交焦点与渲染，
    // 否则迟到的冷路径会把视口和焦点掰回旧目标，造成“焦点在 A、内容在 B”的连点错配（历史坑）。
    if (state.activeFocus.type !== 'bot' || state.activeFocus.botName !== botProfile) return;
    state.activeFocus = { type: 'bot', botName: botProfile };
    await selectSession(foreverChat.sessionId, { preserveFocus: true });
    if (state.activeFocus.type !== 'bot' || state.activeFocus.botName !== botProfile) return;
    state.activeFocus = { type: 'bot', botName: botProfile };
    render();
  } catch (err) {
    if (activeLoadMessagesGeneration !== guard.generation || state.activeFocus.type !== 'bot' || state.activeFocus.botName !== botProfile) return;
    console.error('[Flux] Failed to resolve Forever Chat for bot:', botProfile, err);
    state.dockNotice = t('dock.enterBotChatFailed', { name: botProfile, error: describeRpcError(err) });
    // 失败不能停在空白工位：先恢复进入前的 Profile，再按原焦点回退；回退本身也走代际守卫。
    state.profileName = outgoingProfileName;
    localStorage.setItem('hermes_flux_profile', outgoingProfileName);
    localStorage.setItem('hermes_aura_profile', outgoingProfileName);
    if (outgoingFocus.type === 'session' && outgoingSessionId) {
      void selectSession(outgoingSessionId);
    } else if (outgoingFocus.type === 'group') {
      void openGroupRoom(outgoingFocus.roomId);
    } else if (outgoingFocus.type === 'bot') {
      const outgoingForeverId = botForeverChatCache.get(outgoingFocus.botName);
      if (outgoingForeverId) {
        state.activeFocus = { type: 'bot', botName: outgoingFocus.botName };
        void selectSession(outgoingForeverId, { preserveFocus: true });
        render();
      } else {
        // 上一个 Bot 也没有缓存：保持空态但不要递归触发第二次冷路径，避免失败风暴。
        // 【规则】失败必须离开 loading：否则界面把"进入主工位失败"伪装成"一直在加载"。
        state.messagesPhase = 'ready';
        render();
      }
    } else {
      state.messagesPhase = 'ready';
      render();
    }
    return;
  }

  void fetchModelOptions({ clearNotice: true });
}

/**
 * 冷启动默认落点是否仍待裁决。
 *
 * 【设计意图 (Why)】只有"用户尚未表达选择意图"时才允许自动落点；用户一旦点了任何会话、
 *   Agent 或群聊，迟到到达的 Profile 列表绝不允许把视口抢回第一个 Agent。
 */
let coldStartFocusPending = true;
let coldStartFocusApplied = false;

/** 用户主动选择任一会话 / Agent / 群聊：彻底关闭冷启动自动落点。 */
function cancelColdStartFocus(): void {
  coldStartFocusPending = false;
}

/**
 * 冷启动默认焦点：默认选中第一个 Agent（第一个 profile），对话区直接显示该 Agent 的对话。
 *
 * 【设计意图 (Why)】首屏要有确定落点，且落点必须来自真实 Profile 列表，不能是界面上的默认助理占位。
 * 【防范的历史坑 (Pitfall)】Profile 域尚未就绪就急着打开会话，会让首屏先落会话、Profile 到达后再切工位，
 *   用户看到两次焦点跳变；网关不存在名为 default 的 Profile 时，旧实现还会把焦点停在一个不存在的实体上。
 * 【约束与规则 (Rules)】只在 profilesPhase 已 ready 后裁决；裁决一次即封存（幂等），失败不回滚该标记，
 *   避免每次 Profile 刷新都重新抢焦点。
 */
async function applyColdStartFocus(): Promise<void> {
  if (!coldStartFocusPending || coldStartFocusApplied) return;
  if (state.profilesPhase !== 'ready') return;
  // 【防范的历史坑 (Pitfall)】曾经先封存再调用：本地有 Profile 缓存时，本函数在连接探测返回前就执行，
  //   openBotChat 因 gatewayClient 为空直接返回，而封存标记已置位，二次启动永远拿不到默认焦点。
  //   可执行性必须先于封存判断；客户端对象存在但传输尚未 OPEN 时 call 会立即 reject，同样不能封存。
  if (!gatewayClient || !getEffectiveUrl(state.gatewayUrl) || !state.gatewayConnected) return;
  // 只采用"用户真正保存过"的落点：state.profileName 的兜底字面量 'default' 不是用户选择。
  const storedProfileName = localStorage.getItem('hermes_flux_profile')
    || localStorage.getItem('hermes_aura_profile')
    || (state.profileName !== 'default' ? state.profileName : undefined);
  const target = resolveColdStartFocus({
    profiles: state.profiles,
    sessions: state.sessions,
    savedProfileName: storedProfileName,
  });
  if (target.kind === 'none') return;
  coldStartFocusApplied = true;
  if (target.kind === 'session') {
    await selectSession(target.sessionId);
    return;
  }
  await openBotChat(target.botName);
}

async function fetchModelOptions(options: { clearNotice?: boolean } = {}): Promise<void> {
  if (!gatewayClient) {
    state.availableModels = [];
    state.modelDetails = [];
    state.modelCatalog = [];
    state.modelCatalogHash = '';
    state.dockNotice = '未连接网关，暂时无法获取模型列表';
    render();
    return;
  }

  const catalog = await gatewayClient.getModelCatalog(state.profileName || 'default');

  if (!catalog.ok) {
    // No fabricated fallback models: an invented list is worse than an honest error.
    // 【规则】失败时同时清空目录与指纹：保留旧目录会让用户以为当前列表仍有效，
    // 而它可能已与网关真实状态脱节（切过去必然失败）。
    state.availableModels = [];
    state.modelDetails = [];
    state.modelCatalog = [];
    state.modelCatalogHash = '';
    state.dockNotice = `模型列表加载失败: ${catalog.error || '网关未返回数据'}`;
    render();
    return;
  }

  state.availableModels = catalog.models;
  state.modelDetails = catalog.details;
  state.modelCatalog = catalog.entries;
  state.modelCatalogHash = modelCatalogFingerprint(catalog.entries);
  state.currentProvider = catalog.currentProvider;
  if (catalog.currentModel) {
    state.selectedModel = catalog.currentModel;
  } else if (!state.selectedModel && catalog.models.length > 0) {
    state.selectedModel = catalog.models[0];
  }
  if (options.clearNotice !== false) state.dockNotice = '';
  render();
}

/** 服务端改了 Bot 显示名后，把旧会话上的 botDisplayName 一并收敛，避免左轨归属匹配失配。 */
function syncSessionBotDisplayNames(profiles: AgentProfile[]): void {
  const byName = new Map(profiles.map((p) => [p.name.toLowerCase(), p]));
  let changed = false;
  for (const s of state.sessions) {
    if (!s.botName) continue;
    const profile = byName.get(s.botName.toLowerCase());
    if (profile && s.botDisplayName !== profile.displayName) {
      s.botDisplayName = profile.displayName;
      changed = true;
    }
  }
  if (changed) syncProjectSessions();
}

async function fetchProfiles(options: { refresh?: boolean } = {}): Promise<void> {
  const client = gatewayClient;
  if (!client) return;
  const generation = ++profileFetchGeneration;
  try {
    const list = await client.listProfiles();
    if (generation !== profileFetchGeneration) return;
    // 1. 命中持久缓存，0ms 秒开回填头像资产
    for (const p of list) {
      if (!p.avatar) {
        const cached = profileAvatarCache.get(p.name.toLowerCase()) || (p.displayName ? profileAvatarCache.get(p.displayName.toLowerCase()) : undefined);
        if (cached) p.avatar = cached;
      }
    }
    // 定时/聚焦刷新：关键展示字段完全一致时直接返回，不产生 render、资产拉取与预取。
    if (options.refresh && !profilesDiffer(state.profiles, list)) return;
    const profileTopologyChanged = options.refresh && (
      state.profiles.length !== list.length
      || list.some((p) => !state.profiles.some((old) => old.name === p.name))
    );
    state.profiles = list;
    // 数据已到达（含空列表）：无论内容如何都必须离开骨架相位，否则永久假加载。
    state.profilesPhase = 'ready';
    persistAgentsToCache(list);
    syncSessionBotDisplayNames(list);
    syncProfileLastMessages();
    render();
    void applyColdStartFocus();

    // 2. 已有头像只回填内存缓存；缺失的才向网关拉取 (profiles.get_asset)。
    for (const p of list) {
      if (!p.avatar) continue;
      profileAvatarCache.set(p.name.toLowerCase(), p.avatar);
      if (p.displayName) profileAvatarCache.set(p.displayName.toLowerCase(), p.avatar);
    }
    // 主工位预取必须与头像拉取并行启动：任意一个头像请求慢/挂起，都不能阻塞 Forever Chat 缓存，
    // 否则首次点击 Agent 仍会掉回 session.list 冷路径（约 1 秒空窗）。
    void warmBotForeverChats(list, client);
    await Promise.allSettled(
      list.filter((p) => !p.avatar).map(async (p) => {
        try {
          const assetBase64 = await profileService.getAsset(p.name, 'avatar', client);
          if (assetBase64) {
            const finalUrl = assetBase64.startsWith('data:')
              ? assetBase64
              : `data:image/png;base64,${assetBase64}`;
            p.avatar = finalUrl;
            profileAvatarCache.set(p.name.toLowerCase(), finalUrl);
            if (p.displayName) profileAvatarCache.set(p.displayName.toLowerCase(), finalUrl);
            persistAvatarCache();

            // 同步将真实头像回填到会话列表中对应 Bot 的所有会话项，彻底消除占位图腾
            for (const s of state.sessions) {
              if (s.botName === p.name || (s.botDisplayName && s.botDisplayName === p.displayName)) {
                s.botAvatar = finalUrl;
              }
            }
            render();
          }
        } catch (e) {
          // 显式记录失败原因：头像拉取异常不得伪装成"没有头像"
          console.warn(`[Flux] profiles.get_asset failed for ${p.name}:`, e);
        }
      })
    );

    // 【防范的历史坑 (Pitfall)】历史实现把预取放在 `if (p.avatar) { …; return; }` 之后：
    //   头像一旦从持久缓存回填，该 return 就会永久跳过主工位预取，导致第二次启动起首次点击
    //   任一 Agent 必走 session.list 冷路径，出现约 1 秒空白。
    // 服务端新增/删除了 Agent（profile 主键变化）时，会话归属需要重新对齐。
    if (profileTopologyChanged) void fetchSessions();
  } catch (e) {
    console.warn('[Flux] fetchProfiles failed:', e);
    // 失败同样结束骨架相位：错误由错误行与日志表达，绝不能让骨架把故障伪装成慢。
    state.profilesPhase = 'ready';
    void applyColdStartFocus();
    render();
  }
}

/**
 * 后台预热每个 Bot 的终身主工位：建立 Forever Chat 缓存与卡片最近动态。
 * 【并发规则】最多 3 路并发，避免 Bot 数量增长时对网关造成瞬时惊群。
 * 【失败策略】单个 Bot 失败只跳过自身，不影响其余 Bot 与首屏（gate-degrade）。
 */
async function warmBotForeverChats(
  list: AgentProfile[],
  client: NonNullable<typeof gatewayClient>,
): Promise<void> {
  const queue = [...list];
  const worker = async (): Promise<void> => {
    for (;;) {
      const p = queue.shift();
      if (!p) return;
      // 已建立过主工位缓存的 Bot 无需重复探查，避免定时刷新在网关侧制造无意义 RPC。
      if (botForeverChatCache.has(p.name)) continue;
      try {
        const forever = await profileService.getOrCreateForeverChat(p.name, client);
        if (!forever?.sessionId) continue;
        botForeverChatCache.set(p.name, forever.sessionId);
        const histRes = await client.fetchSessionMessages(forever.sessionId, { limit: 1, offset: 0, order: 'latest', profile: p.name });
        if (histRes.status === 'success' && histRes.messages.length > 0) {
          const last = histRes.messages[0];
          const parts = Array.isArray(last.parts) ? (last.parts as Array<{ type?: string; text?: string }>) : [];
          const textPart = parts.find((pt) => pt.type === 'text');
          const previewText = textPart?.text || (typeof last.content === 'string' ? last.content : '');
          const ts = last.created_at || last.timestamp;
          const numTs = typeof ts === 'number' ? (ts > 1e11 ? ts : ts * 1000) : typeof ts === 'string' ? Date.parse(ts) || Date.now() : Date.now();
          updateBotLatestActivity(p.name, previewText, numTs);
          render();
        }
      // gate-degrade: 单条主工位探测失败按跳过处理，不影响其余 Bot 资产渲染
      } catch {
        // 容错放行
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, () => worker()));
}

/** 定时刷新 Bot Profile：服务端改名/改描述/换模型后，最迟一分钟内自动同步。 */
const PROFILE_REFRESH_INTERVAL_MS = 60_000;
const PROFILE_REFRESH_MIN_GAP_MS = 15_000;
let profileAutoRefreshTimer: ReturnType<typeof setInterval> | null = null;
let lastProfileRefreshAt = 0;
let profileRefreshInFlight = false;
/** Profile 拉取代际：先发后至的旧响应不得覆盖新快照。 */
let profileFetchGeneration = 0;

function stopProfileAutoRefresh(): void {
  if (profileAutoRefreshTimer) {
    clearInterval(profileAutoRefreshTimer);
    profileAutoRefreshTimer = null;
  }
}

function startProfileAutoRefresh(): void {
  stopProfileAutoRefresh();
  profileAutoRefreshTimer = setInterval(() => { void refreshProfilesFromServer(); }, PROFILE_REFRESH_INTERVAL_MS);
}

/**
 * 从网关重新读取 Agent Profile。
 * 【规则】只在已连接且页面可见时执行；15 秒冷却吸收窗口焦点抖动；
 *   失败静默（连接态由 FSM 负责），内容不变时 fetchProfiles 内部直接返回，不产生重绘。
 */
async function refreshProfilesFromServer(): Promise<void> {
  if (!gatewayClient || !state.gatewayConnected || profileRefreshInFlight) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  const now = Date.now();
  if (now - lastProfileRefreshAt < PROFILE_REFRESH_MIN_GAP_MS) return;
  lastProfileRefreshAt = now;
  profileRefreshInFlight = true;
  try {
    await fetchProfiles({ refresh: true });
  // gate-degrade: 定时刷新失败保持现状，下一轮继续；连接态由 FSM 负责。
  } catch {
    // 定时刷新失败保持现状，下一轮继续；连接态由 FSM 负责。
  } finally {
    profileRefreshInFlight = false;
  }
}

async function switchProfile(name: string): Promise<void> {
  if (!name || state.profileName === name) return;
  state.profileName = name;
  localStorage.setItem('hermes_flux_profile', name);
  localStorage.setItem('hermes_aura_profile', name);
  render();
  await Promise.allSettled([fetchSessions(), fetchModelOptions()]);
}

// OpenChamber Standard Message Paging: Initial Window 100 items for instant cold launch
const INITIAL_WINDOW_PAGE_SIZE = 100;
/** 向早翻页单页条数。网关 /messages 单页真实上限实测 500（超限静默截断到 500），取满把回溯轮次降到 1/5。 */
const OLDER_BATCH_PAGE_SIZE = 500;
/**
 * 消息列表初始挂载窗口。
 * 【设计意图 (Why)】Bot 终身主工位会累积上百条历史；进入会话时把整表一次挂载，
 *   会让点击路径承担全量组件与 Markdown 构建成本。首屏只挂最近 N 条，
 *   向上滚动时先扩展本地窗口、耗尽后再走服务端分页。
 * 【约束与规则 (Rules)】窗口必须覆盖最后一条消息，流式直写锚点才不会缺失。
 */
const INITIAL_RENDER_WINDOW = 24;
const RENDER_WINDOW_STEP = 40;
/**
 * 挂载容量硬上限。
 * 【设计意图 (Why)】长会话向上回溯时窗口只扩不缩，实测挂载到 105 回合 / 11568 节点后
 *   拖拽帧间隔从 16ms 恶化到 60ms。容量把每帧重排成本钉在常数级。
 * 【约束与规则 (Rules)】窗口区间 [start, end) 的长度永不突破此值。
 */
const MESSAGE_WINDOW_CAPACITY = 120;
let messageWindowSessionId = '';
let messageWindowStart = 0;
let messageWindowEnd = 0;
let messageWindowUserExpanded = false;
/**
 * 待处理的会话切换推送标记。
 *
 * 【设计意图 (Why)】切会话后窗口起点、平均行高与虚拟高度全部换了口径，
 *   必须向 React 推一次快照。只靠「消息 id 有变化」判定不够稳：
 *   一旦 `renderedMessageIds` 与新区间意外相同，列表就会停在旧窗口，
 *   正文与虚拟坐标脱节，贴底直接落到空白区（实测 2738 条会话切回后整屏空白）。
 *
 * 【约束与规则 (Rules)】由 `ensureMessageWindow` 在会话切换时置位，
 *   `syncReactMessageList` 推送后清空；不得跨会话残留。
 */
let sessionSwitchPending = false;
/** 切会话后允许落定循环忽略收敛判据的剩余帧数，见 ensureMessageWindow 注释。 */
let settleMinFrames = 0;
/**
 * 滚动扩窗锁必须是模块级：render() 每次都会重绑 onscroll，局部锁会被新闭包重置，
 * 同一次手势就能连续扩窗，把锚点补偿推到列表底部。
 */
let streamScrollCooldown = false;
let lastStreamScrollTop = 0;
/**
 * 首屏落定标志：切会话或冷启动恢复会话后，视口必须先落到最新消息。
 *
 * 【设计意图 (Why)】冷启动会直接渲染缓存的活跃会话，此时 `scrollTop` 初值为 0，
 *   而窗口已按末尾规划。滚动处理器把「视口在窗口上沿之上」判成读者向上回溯，
 *   连续扩窗把窗口搬离末尾并置真 `messageWindowUserExpanded`，
 *   行高锁定后那次贴底又因该标志被跳过，读者最终停在会话中部。
 *   实测 1128 条会话：窗口从 [1008,1128] 落到 [907,1027]，距底 25756px。
 *
 * 【约束与规则 (Rules)】只在首屏落定期间工作，贴底完成或超时即解除；
 *   期间滚动处理器只更新导航轨，不做扩窗、回收与跳转。
 */
let initialBottomSettling = false;
/**
 * 已完成首屏落定时的布局指纹（`消息条数:平均行高锁定状态`）。
 *
 * 【设计意图 (Why)】只用消息条数判定会漏掉行高锁定：条数不变，但 scrollHeight 会从
 *   96 的估算口径（1128×96≈108k）跳到实测口径（1128×122≈138k），
 *   残留的 scrollTop 就停在新旧口径之间的会话中部。
 *   冷启动的缓存恢复与分页补齐又是分批的，所以两个维度都要追踪。
 *
 * 【约束与规则 (Rules)】与 `readerScrolledSessionId` 配合：读者一旦主动向上回溯，
 *   本会话的自动贴底立即永久让位，绝不把正在回看的读者拽回底部。
 */
let settledLayoutSignature = '';
/** 布局指纹：条数 + 平均行高，任一变化都要求重新落定首屏。 */
function layoutSignature(): string {
  return `${state.messages.length}:${averageRowHeightLocked ? averageRowHeightPx.toFixed(2) : 'pending'}`;
}
/**
 * 读者主动向上回溯过的会话 id。
 *
 * 【设计意图 (Why)】只有读者的手势能证明「我不想在底部」。
 *   程序贴底时 scrollTop 单调增大，读者向上翻时单调减小，用方向即可区分，
 *   不必猜测是滚轮、触摸还是拖动滚动条。
 */
let readerScrolledSessionId = '';
/**
 * 最近一次程序写入 scrollTop 后实际落地的值（浏览器会夹到最大值）。
 *
 * 【设计意图 (Why)】锚点校正会把 scrollTop 改小几十到几百像素，
 *   在滚动处理器眼里与「读者向上回溯」完全同形。若不加区分，
 *   一次锚点校正就会把本会话永久标记成"读者已回溯"，首屏补齐后再也不贴底。
 *
 * 【约束与规则 (Rules)】只在程序写入后登记；滚动处理器消费一次即清空，
 *   读者真正滚动时 scrollTop 不会等于登记值，判定自然放行。
 */
let programmaticScrollTarget: number | null = null;

/** 程序写下 scrollTop 后登记落地值，供滚动处理器区分程序滚动与读者手势。 */
function markProgrammaticScroll(stream: HTMLElement): void {
  programmaticScrollTarget = Math.round(stream.scrollTop);
}
/** 上一轮"正在加载更早历史"的起始时刻，用于熔断被节流打断的陈旧加载锁 */
let olderLoadingStartedAt = 0;

/**
 * 维护消息挂载窗口。
 * 【规则】切会话回到末尾窗口；读者贴底且窗口未扩展时保持尾部窗口；
 *   其余情况保持起点并按容量上限截断末端。窗口是 [start, end) 有界区间，
 *   长度永不突破 MESSAGE_WINDOW_CAPACITY，因此每帧重排成本与历史总量解耦。
 */
function ensureMessageWindow(total: number): void {
  const sessionChanged = messageWindowSessionId !== state.activeSessionId;
  if (sessionChanged) {
    messageWindowSessionId = state.activeSessionId;
    /**
     * 【切会话必须重锁行高 (Rules)】平均行高按窗口内容实测得出，换会话后窗口内容整体不同；
     *   若沿用上一个会话的值，`总条数 × 平均行高` 与实际窗口高度就对不上，
     *   贴底时视口会落到最后一条真实消息之后（实测 2738 条会话切回后整屏空白）。
     *   这里只清锁定标记，真正的重量由 scheduleVirtualHeightSync 在 React 提交后执行。
     */
    averageRowHeightLocked = false;
    averageRowHeightSessionId = '';
    /** 切会话必须无条件推一次快照：窗口起点、行高、虚拟高度全部换了口径。 */
    sessionSwitchPending = true;
    /** 前 8 帧不判断收敛：此时 DOM 还是上一个会话的内容，容易误判"已经贴住"。 */
    settleMinFrames = 8;
  }
  const stream = document.getElementById('conversation-stream');
  const plan = planMessageWindow({
    total,
    start: messageWindowStart,
    end: messageWindowEnd,
    userExpanded: messageWindowUserExpanded,
    sessionChanged,
    followBottom: stream ? isStreamNearBottom(stream) : true,
    initialWindow: INITIAL_RENDER_WINDOW,
    capacity: MESSAGE_WINDOW_CAPACITY,
  });
  messageWindowStart = plan.start;
  messageWindowEnd = plan.end;
  messageWindowUserExpanded = plan.userExpanded;
}

/**
 * 向上扩展本地窗口；返回 true 表示本次滚动已由本地消息满足，无需请求服务端。
 *
 * 【竞态守卫 (Rules)】扩展只移动起点，末端由容量推导，因此区间长度恒定；
 *   读者向上翻时尾部自动滑出，挂载量不随回溯轮次增长。
 * 【虚拟坐标 (Rules)】画布高度钉成全高后，搬迁窗口必须把 scrollTop 同步到新起点的虚拟位置，
 *   否则读者会停在原处而内容已被换掉。
 */
function expandMessageWindow(): boolean {
  const total = state.messages.length;
  const nextStart = expandMessageWindowStart(messageWindowStart, RENDER_WINDOW_STEP, Math.max(0, total - MESSAGE_WINDOW_CAPACITY));
  const nextEnd = windowEndFor(nextStart, total, MESSAGE_WINDOW_CAPACITY, INITIAL_RENDER_WINDOW);
  if (nextStart === messageWindowStart && nextEnd === messageWindowEnd) return false;
  messageWindowStart = nextStart;
  messageWindowEnd = nextEnd;
  messageWindowUserExpanded = true;
  canvasStructureDirty = true;
  suppressPinBottomOnce = true;
  render();
  // 占位块已按新起点补偿，内容在虚拟坐标中的位置不变；仅当视口已落在窗口外时才校正。
  requestAnimationFrame(() => syncScrollTopToWindow('expand upward'));
  return true;
}

/**
 * 向下滑动窗口：读者从历史区滚回挂载区间尾部时整体前移窗口。
 *
 * 【设计意图 (Why)】有界窗口意味着向下滚动必须回收顶部，否则滚到底会撞上“没有更多”的空洞。
 * 【约束与规则 (Rules)】起点单调不减且不越过 total - capacity；只有已扩展过的窗口才滑动。
 *   搬迁后必须把 scrollTop 校正到新窗口的虚拟坐标，否则读者会被固定在原处。
 */
function slideMessageWindowForward(): void {
  if (!messageWindowUserExpanded) return;
  const total = state.messages.length;
  const capacity = MESSAGE_WINDOW_CAPACITY;
  if (total <= capacity) return;
  const nextStart = slideMessageWindowDown(
    messageWindowStart,
    total,
    capacity,
    RENDER_WINDOW_STEP,
    INITIAL_RENDER_WINDOW,
  );
  if (nextStart === messageWindowStart) return;
  messageWindowStart = nextStart;
  messageWindowEnd = windowEndFor(nextStart, total, capacity, INITIAL_RENDER_WINDOW);
  canvasStructureDirty = true;
  render();
  requestAnimationFrame(() => syncScrollTopToWindow('slide forward'));
  logScroll.trace('window slid forward on downward scroll', {
    start: messageWindowStart,
    end: messageWindowEnd,
    total,
  });
}

/**
 * 把窗口移动到指定消息索引周围（拖滚动条跳转时使用）。
 *
 * 【规则】前留少量上文行数，起点受容量约束；索引越界时不改窗口。
 */
function relocateMessageWindowToIndex(index: number): boolean {
  const total = state.messages.length;
  if (!Number.isFinite(index) || index < 0 || index >= total) return false;
  const nextStart = windowStartAroundIndex(index, total, MESSAGE_WINDOW_CAPACITY, 4, INITIAL_RENDER_WINDOW);
  const nextEnd = windowEndFor(nextStart, total, MESSAGE_WINDOW_CAPACITY, INITIAL_RENDER_WINDOW);
  if (nextStart === messageWindowStart && nextEnd === messageWindowEnd) return false;
  messageWindowStart = nextStart;
  messageWindowEnd = nextEnd;
  messageWindowUserExpanded = true;
  canvasStructureDirty = true;
  return true;
}

/**
 * 把窗口搬迁后校正 scrollTop（仅在视口已完全脱离窗口时兜底）。
 *
 * 【设计意图 (Why)】占位块已按新起点补偿，窗口搬迁不改变内容在虚拟坐标中的位置，
 *   因此正常滚动时绝不能改写 scrollTop —— 那会吞掉用户的滚动距离（实测滚 11050px 只推进 36 条）。
 *   只有视口彻底脱离窗口覆盖范围（拖滚动条、跳转）时才需要兜底定位。
 * 【约束与规则 (Rules)】视口落在窗口覆盖区间内时保持原样。
 */
function syncScrollTopToWindow(reason: string): void {
  const stream = document.getElementById('conversation-stream');
  if (!stream) return;
  const virtualTop = Math.round(messageWindowStart * averageRowHeightPx);
  const virtualBottom = Math.round(messageWindowEnd * averageRowHeightPx);
  if (stream.scrollTop >= virtualTop - stream.clientHeight && stream.scrollTop <= virtualBottom) return;
  const target = Math.max(0, Math.min(virtualTop, stream.scrollHeight - stream.clientHeight));
  stream.scrollTop = target;
  markProgrammaticScroll(stream);
  logScroll.debug('scrollTop synced to window', { reason, start: messageWindowStart, target });
}

/**
 * 安排一次虚拟高度同步，未锁定行高时逐帧重试。
 *
 * 【设计意图 (Why)】`mountMessageList` 返回时 React 可能尚未提交，rAF 里读不到行，
 *   一次性调用会永远错过锁定时机（实测 averageRowHeightPx 停在默认 96，
 *   导致滚动 11050px 只推进 36 条消息）。
 * 【约束与规则 (Rules)】最多重试 8 帧；锁定成功后不再重试。
 */
function scheduleVirtualHeightSync(attempt = 0): void {
  requestAnimationFrame(() => {
    const locked = lockAverageRowHeight();
    syncCanvasVirtualHeight();
    if (locked) {
      // 行高锁定会改变占位高度与画布虚拟高度，必须重渲染让占位块用上新值。
      canvasStructureDirty = true;
      render();
      /**
       * 【位置重算 (Rules)】行高从默认 96 变成实测值后，同一个 scrollTop 对应的消息下标完全变了；
       *   若 scrollTop 恰好停在底部，此后不会再产生 scroll 事件，导航会永久停在 96 的口径。
       */
      syncPromptNavigatorFromScroll();
      /**
       * 【首屏贴底 (Rules)】画布高度变成虚拟全高后，scrollTop 必须落到窗口在虚拟坐标中的
       *   真实位置（≈ 窗口起点 × 行高），否则会停在 0 也就是会话最开头，
       *   读者打开会话看到的是最早的记录而不是最新消息。
       */
      if (!messageWindowUserExpanded) {
        requestAnimationFrame(() => scrollStreamToBottom('virtual height locked'));
      }
      // 行高锁定后 scrollHeight 才等于虚拟全高，首屏落定必须按新口径重跑一次。
      settleInitialBottom();
      return;
    }
    if (!averageRowHeightLocked && attempt < 8) {
      scheduleVirtualHeightSync(attempt + 1);
      return;
    }
    // 行高迟迟锁不上时也要落定首屏，否则读者会停在旧口径的中部。
    settleInitialBottom();
  });
}

/* --------------------------------------------------------------------------
 * 提示词导航轨：模块级状态、快照推送、当前位置与跳转
 * -------------------------------------------------------------------------- */

/**
 * 阅读基准线（px）。
 *
 * 【设计意图 (Why)】读者视线并非贴在视口顶端，而是落在顶端往下约 100px 处；
 *   用这条基准线换算「当前读到第几条消息」，轨道高亮才与阅读感受一致。
 * 【约束与规则 (Rules)】与 48px 贴底跟随阈值语义、量纲都不同，禁止合并成一个常量：
 *   后者判定「是否自动贴底」，前者判定「读到哪一条」。
 */
const PROMPT_READ_LINE_PX = 100;

/**
 * 空快照必须是一个冻结常量。
 *
 * 【防范的历史坑 (Pitfall)】若在 getPromptNavigatorSnapshot 里现造空对象，
 *   每次 render 都会得到新引用，去重失效，React 岛被每个 render 推一次。
 */
const EMPTY_PROMPT_NAVIGATOR_SNAPSHOT: PromptNavigatorSnapshot = Object.freeze({
  prompts: Object.freeze([]) as readonly PromptEntry[],
  activeIndex: -1,
});

let promptNavigatorSnapshot: PromptNavigatorSnapshot | null = null;
let promptNavigatorEntries: PromptEntry[] = [];
let promptNavigatorCache: { sessionId: string; messagesRef: readonly unknown[] } | null = null;
let lastPromptNavigatorSnapshot: PromptNavigatorSnapshot | null = null;
let updateReactPromptNavigator: (() => void) | null = null;
/** 跳转序列号：丢弃迟到 rAF，连点两根 tick 时先到的回调不得覆盖后一次跳转。 */
let promptJumpSeq = 0;
/** 跳转落定期间屏蔽 render 自带的两处锚点写入者。 */
let promptJumpSettling = false;
/** `.conv-stream` 的 padding-top 实测值，首帧读取一次后缓存（切皮肤无需重读）。 */
let streamPaddingTopPx = 24;
let streamPaddingTopRead = false;
/** 重建重入标记：syncPromptNavigatorFromScroll 内部触发的重建不得递归调用自身。 */
let promptNavigatorRebuildDepth = 0;

/** 读取一次 `.conv-stream` 的 padding-top，用于滚动位置换算。 */
function ensureStreamPaddingTop(stream: HTMLElement): void {
  if (streamPaddingTopRead) return;
  streamPaddingTopRead = true;
  const raw = Number.parseFloat(getComputedStyle(stream).paddingTop);
  if (Number.isFinite(raw) && raw >= 0) streamPaddingTopPx = raw;
}

/**
 * 快照唯一出口：只返回模块级引用。
 *
 * 【约束与规则 (Rules)】禁止在此函数内构造新对象，否则引用去重失效。
 */
function getPromptNavigatorSnapshot(): PromptNavigatorSnapshot {
  return promptNavigatorSnapshot ?? EMPTY_PROMPT_NAVIGATOR_SNAPSHOT;
}

/**
 * 快照推送唯一入口。
 *
 * 【约束与规则 (Rules)】位置变化、重建、跳转落定全部走这里，禁止在别处直接调 update。
 */
function syncPromptNavigator(): void {
  if (!updateReactPromptNavigator) return;
  const snapshot = getPromptNavigatorSnapshot();
  if (snapshot === lastPromptNavigatorSnapshot) return;
  lastPromptNavigatorSnapshot = snapshot;
  updateReactPromptNavigator();
}

/**
 * 整表重建提示词条目。
 *
 * 【设计意图 (Why)】缓存 key 用「会话 id + 消息数组引用」，O(1) 判定；
 *   切会话必须把当前项落到末条（读者位置未知），其余重建按当前 scrollTop 重算。
 * 【防范的历史坑 (Pitfall)】前置翻页每次都返回新数组，若一律取末条，
 *   读者停在顶部时轨道会整体跳到末尾，且该路径不产生 scroll 事件，永不自我修复。
 * 【约束与规则 (Rules)】
 *   1. 本函数只写 `promptNavigatorEntries` 与 `promptNavigatorCache`；
 *   2. 切会话分支额外写一次「末条」快照并推送，其余分支交给滚动位置重算；
 *   3. 返回 true 表示已完成「切会话重置」，调用方不得再按 scrollTop 覆盖。
 */
function rebuildPromptEntries(): boolean {
  const shouldRebuild = shouldRebuildPromptIndex({
    sessionId: promptNavigatorCache?.sessionId ?? '',
    currentSessionId: state.activeSessionId,
    cachedMessagesRef: promptNavigatorCache?.messagesRef ?? null,
    messagesRef: state.messages,
  });
  if (!shouldRebuild) return false;
  const sessionChanged = promptNavigatorCache?.sessionId !== state.activeSessionId;
  promptNavigatorEntries = buildPromptEntries(state.messages);
  promptNavigatorCache = { sessionId: state.activeSessionId, messagesRef: state.messages };
  if (sessionChanged) {
    promptNavigatorSnapshot = promptNavigatorEntries.length === 0
      ? { prompts: promptNavigatorEntries, activeIndex: -1, locale: state.lang }
      : { prompts: promptNavigatorEntries, activeIndex: promptNavigatorEntries.length - 1, locale: state.lang };
    syncPromptNavigator();
    return true;
  }
  if (promptNavigatorRebuildDepth > 0) return false;
  // 等长替换 / 回滚：按当前滚动位置重算，避免高亮停在已裁掉的下标上。
  syncPromptNavigatorFromScroll();
  return false;
}

/**
 * 按滚动位置刷新当前项。
 *
 * 【设计意图 (Why)】滚动热路径只做整数算术与一次二分；只有跨过一条提问才换快照引用，
 *   滚动过程本身不触发 React 更新。
 * 【约束与规则 (Rules)】
 *   1. 重建与位置计算必须同一会话，否则会话切换瞬间会拿新会话的 total 算旧会话的 entries；
 *   2. entries 为空时快照也要清空，否则轨道仍指向上一会话的旧表；
 *   3. 同一 activeIndex 不换引用。
 */
function syncPromptNavigatorFromScroll(): void {
  const stream = document.getElementById('conversation-stream');
  if (stream) ensureStreamPaddingTop(stream);
  promptNavigatorRebuildDepth += 1;
  let sessionReset = false;
  try {
    sessionReset = rebuildPromptEntries();
  } finally {
    promptNavigatorRebuildDepth -= 1;
  }
  if (sessionReset) return;
  if (promptNavigatorEntries.length === 0) {
    if (promptNavigatorSnapshot && promptNavigatorSnapshot.prompts.length > 0) {
      promptNavigatorSnapshot = { prompts: promptNavigatorEntries, activeIndex: -1, locale: state.lang };
      syncPromptNavigator();
    }
    return;
  }
  if (promptNavigatorCache?.sessionId !== state.activeSessionId) return;
  const total = state.messages.length;
  if (total <= 0 || !stream) return;
  const messageIndex = promptMessageIndexAtScrollTop({
    scrollTop: stream.scrollTop,
    rowHeight: averageRowHeightPx,
    paddingTop: streamPaddingTopPx,
    readLinePx: PROMPT_READ_LINE_PX,
    total,
  });
  const next = resolveActivePromptIndex(promptNavigatorEntries, messageIndex);
  if (next === (promptNavigatorSnapshot?.activeIndex ?? -1)) return;
  promptNavigatorSnapshot = { prompts: promptNavigatorEntries, activeIndex: next, locale: state.lang };
  syncPromptNavigator();
}

/** 导航轨动作表：只传消息 id，宿主用 id 反查（下标会被前置翻页整体平移）。 */
function createPromptNavigatorActions(): PromptNavigatorActions {
  return {
    onSelect: (messageId: string) => {
      jumpToPrompt(messageId);
    },
  };
}

/**
 * 跳到指定用户消息。
 *
 * 【设计意图 (Why)】把消息窗口搬到目标索引附近，再用 DOM 实测校正 scrollTop，
 *   使目标行顶部与视口顶部相差不超过 12px。
 * 【防范的历史坑 (Pitfall)】见 settlePromptJump 的九条要点。
 * 【约束与规则 (Rules)】全程不改消息窗口容量、虚拟高度与缓存逻辑，只借用既有原语。
 */
function jumpToPrompt(messageId: string): void {
  const index = state.messages.findIndex((m) => m.id === messageId);
  if (index < 0) return;

  promptJumpSeq += 1;
  const seq = promptJumpSeq;
  promptJumpSettling = true;
  suppressPinBottomOnce = true;
  streamScrollCooldown = true;
  // 语义上读者已离开尾部，掐掉 scheduleVirtualHeightSync 里的 scrollStreamToBottom。
  messageWindowUserExpanded = true;
  relocateMessageWindowToIndex(index);
  canvasStructureDirty = true;
  render();
  settlePromptJump(messageId, seq, 0, 0);
}

/**
 * 跳转落定：逐帧等目标行挂载后按 DOM 实测校正。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 用入场下标会失效：前置翻页把历史插到数组头，闭包里的 index 已过期，因此每帧按 id 重查；
 *   2. 行高锁定帧会嵌套一次 render 并安排 stabilizeStreamAnchor，必须先等它落定；
 *   3. 单次 rAF 会错过 React 提交，最多重试 8 帧，超限显式告警不静默放弃；
 *   4. 一条消息有多个 `data-msg-id` 节点（行本体 + 页脚按钮），取最上矩形才是行本体。
 */
function settlePromptJump(messageId: string, seq: number, attempt: number, wait: number): void {
  requestAnimationFrame(() => {
    if (seq !== promptJumpSeq) return;
    // 跳转途中切会话或回滚时目标可能已不存在，每帧按 id 重查，不用入场时的下标。
    const index = state.messages.findIndex((m) => m.id === messageId);
    if (index < 0) {
      releasePromptJump(seq);
      return;
    }
    // 行高锁定帧会嵌套一次 render 并安排 stabilizeStreamAnchor，等它落定再定位。
    if (!averageRowHeightLocked && wait < 8) {
      settlePromptJump(messageId, seq, attempt, wait + 1);
      return;
    }
    const stream = document.getElementById('conversation-stream');
    if (!stream) {
      releasePromptJump(seq);
      return;
    }
    ensureStreamPaddingTop(stream);
    if (attempt === 0) {
      const rough = index * averageRowHeightPx;
      stream.scrollTop = Math.max(0, Math.min(rough, stream.scrollHeight - stream.clientHeight));
    }
    const nodes = stream.querySelectorAll<HTMLElement>(`[data-msg-id="${CSS.escape(messageId)}"]`);
    const top = topmostRectTop(Array.from(nodes, (node) => node.getBoundingClientRect()));
    if (top !== null) {
      const delta = top - stream.getBoundingClientRect().top;
      stream.scrollTop += delta - 12;
      syncPromptNavigatorFromScroll();
      releasePromptJump(seq);
      return;
    }
    if (attempt < 8) {
      settlePromptJump(messageId, seq, attempt + 1, wait);
      return;
    }
    logScroll.warn('prompt jump target not mounted', { messageId, attempt });
    releasePromptJump(seq);
  });
}

/**
 * 延迟一帧释放两个标志。
 *
 * 【防范的历史坑 (Pitfall)】锁定行高那一帧会再注册一次尾随锚点校正，它在下一帧运行；
 *   提前释放会让 stabilizeStreamAnchor 把刚写入的位移按反数抵消。
 *   自身写出的 scroll 事件也在下一帧派发，冷却锁必须活到那时，否则会触发一次多余扩窗。
 */
function releasePromptJump(seq: number): void {
  requestAnimationFrame(() => {
    if (seq !== promptJumpSeq) return;
    promptJumpSettling = false;
    streamScrollCooldown = false;
  });
}

const sessionMessagesCache = new Map<string, MessageViewModel[]>();
const sessionServerOffset = new Map<string, number>();
const sessionParentOffsetMap = new Map<string, number>();
/** 截断成功后的会话历史权威源标记：'server-priority' 时禁用“本地更长则保留”合并守卫 */
const sessionHistoryTrust = new Map<string, 'server-priority'>();
/** core 交互区领域服务单例（截断/分支/目录的唯一 wire 载荷构造入口） */
const interactiveService = new InteractiveService();

/** commands.catalog 预取的目录快照（本地降级检索源，complete.slash 不可用时兜底） */
let slashCatalogSnapshot: SlashCommandOption[] = [];
let slashCatalogLoaded = false;
let slashDebounce: ReturnType<typeof setTimeout> | undefined;
let pathDebounce: ReturnType<typeof setTimeout> | undefined;
// 序列号守卫：丢弃迟到的补全响应，防止旧结果覆盖新输入（竞态）
let slashSeq = 0;
let pathSeq = 0;

/** 解析当前活跃会话的工作目录，作为 complete.path 的 cwd 边界 */
function resolveActiveCwd(): string {
  const sess = state.sessions.find((s) => s.id === state.activeSessionId);
  if (sess?.cwd) return sess.cwd;
  const proj = state.projects.find((p) => p.id === sess?.projectId || (sess?.projectName && p.name === sess.projectName));
  return proj?.path || '';
}

/** 将文件补全项与 Agent 项合并进 mention popper（Agent 在上、文件在下，按 query 过滤） */
function mergeMentionFiles(fileItems: MentionReferenceOption[], query: string): void {
  const agentItems = state.mentionItems.filter((m) => m.type === 'agent');
  const q = query.toLowerCase();
  const filteredFiles = fileItems.filter((f) => f.name.toLowerCase().includes(q));
  state.mentionItems = [...agentItems, ...filteredFiles].slice(0, 12);
  state.mentionPopperOpen = state.mentionItems.length > 0;
  render();
}

async function prefetchSlashCatalog(): Promise<void> {
  if (!gatewayClient) return;
  try {
    const cat = await interactiveService.getCommandsCatalog(rpcCaller, state.activeSessionId || undefined, state.profileName || undefined);
    const items: SlashCommandOption[] = [];
    const pushCmd = (name: string, desc: string) => {
      if (!name) return;
      const normalized = name.startsWith('/') ? name : `/${name}`;
      items.push({ name: normalized, description: desc });
    };
    for (const pair of cat.pairs || []) {
      if (pair[0]) pushCmd(pair[0], pair[1] || '');
    }
    if (cat.commands) {
      for (const [name, meta] of Object.entries(cat.commands)) {
        pushCmd(name, meta?.desktop || '');
      }
    }
    for (const skillName of Object.keys(cat.skills || {})) {
      if (skillName) items.push({ name: skillName.startsWith('/') ? skillName : `/${skillName}`, description: 'Skill', isSkill: true });
    }
    const seen = new Set<string>();
    slashCatalogSnapshot = items.filter((it) => (seen.has(it.name) ? false : (seen.add(it.name), true)));
    slashCatalogLoaded = true;
  } catch {
    // gate-degrade: 目录预取失败属可选加速，回退到按键时实时补全，不阻断输入
    slashCatalogLoaded = false;
  }
}

/** 斜杠补全：优先 complete.slash（携带 replace_from），失败降级目录快照本地过滤 */
function requestSlashCompletion(query: string): void {
  if (slashDebounce) clearTimeout(slashDebounce);
  const token = inputTokenSnapshot();
  slashDebounce = setTimeout(async () => {
    const mySeq = ++slashSeq;
    let resolved: SlashCommandOption[] | null = null;
    if (gatewayClient) {
      try {
        const res = await interactiveService.getSlashCompletions(
          rpcCaller,
          token.fullText,
          state.activeSessionId || undefined,
          state.profileName || undefined
        );
        if (mySeq !== slashSeq) return;
        const replaceFrom = typeof res.replace_from === 'number' ? res.replace_from : undefined;
        resolved = (res.items || []).map((it) => ({
          name: it.text,
          description: it.meta || it.display || '',
          isSkill: it.kind === 'skill',
          replaceFrom: it.kind ? replaceFrom : undefined,
        }));
      } catch {
        // gate-degrade: complete.slash 失败降级到目录快照
        resolved = null;
      }
    }
    if (mySeq !== slashSeq) return;
    const base = resolved && resolved.length > 0
      ? resolved
      : slashCatalogSnapshot.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));
    state.slashItems = base.slice(0, 12);
    state.slashPopperOpen = state.slashItems.length > 0;
    render();
  }, 120);
}

function inputTokenSnapshot(): { fullText: string } {
  const el = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
  return { fullText: el ? el.value : '' };
}

/** 文件补全：complete.path 按当前 cwd + 光标 token 检索，失败降级最近打开文件 */
function requestPathCompletion(word: string): void {
  if (pathDebounce) clearTimeout(pathDebounce);
  const el = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
  const fullText = el ? el.value : '';
  pathDebounce = setTimeout(async () => {
    const mySeq = ++pathSeq;
    let fileItems: MentionReferenceOption[] = [];
    if (gatewayClient) {
      try {
        const cwd = resolveActiveCwd();
        const res = await interactiveService.getPathCompletions(
          rpcCaller,
          word,
          cwd || undefined,
          state.activeSessionId || undefined,
          state.profileName || undefined
        );
        if (mySeq !== pathSeq) return;
        fileItems = (res.items || []).map((it) => ({
          type: 'file' as const,
          name: it.text,
          detail: it.meta || '',
        }));
      } catch {
        // gate-degrade: complete.path 失败降级到已打开文件列表
        fileItems = state.openFiles.map((f) => ({ type: 'file' as const, name: f.path, detail: t('mention.recentFile') }));
      }
    } else {
      fileItems = state.openFiles.map((f) => ({ type: 'file' as const, name: f.path, detail: t('mention.recentFile') }));
    }
    if (mySeq !== pathSeq) return;
    mergeMentionFiles(fileItems, word);
  }, 120);
}

/**
 * 解析网关原始消息行为视图模型。
 * 【防范的历史坑 (Pitfall)】必须提取 row_id 为持久 rowId，回滚截断才有可信锚点；
 * 历史上此函数丢弃 row_id 导致回滚被迫用临时 id 触发 4018。
 * 作用域（是否 Bot/群聊）从当前焦点内联派生，避免跨调用残留过期标记。
 * 具体翻译逻辑在 transcriptRows.ts 的纯函数里，本函数只负责注入宿主作用域与时区格式化。
 */
function parseRawMessages(list: any[]): MessageViewModel[] {
  return parseTranscriptRows(list, {
    scope: {
      isGroupRoom: state.activeFocus.type === 'group',
      isBotRoom: state.activeFocus.type === 'bot',
    },
    formatTimestamp,
  });
}

async function loadOlderMessages(): Promise<void> {
  const sessionId = state.activeSessionId;
  if (!sessionId || !gatewayClient) return;
  if (state.isLoadingOlder) {
    // 【熔断 (Rules)】后台标签页会节流渲染帧，上一轮可能在关闭加载态前被打断。
    // 超过 20 秒仍是 true，视为陈旧锁，强制复位后继续拉取，避免永久卡在"正在加载更早历史"。
    if (performance.now() - olderLoadingStartedAt > 20000) {
      state.isLoadingOlder = false;
    } else {
      return;
    }
  }

  // 【AGENTS.md 三态隔离铁律】群聊研讨室严格走 groups.* 协议，绝对禁止打单会话 REST
  const isRoom = hostedRoomIds.has(sessionId) || state.groupRooms.some((g) => g.roomId === sessionId) || state.activeFocus.type === 'group';
  if (isRoom) {
    state.isLoadingOlder = false;
    return;
  }

  // 精准解析当前会话归属的 Profile（杜绝专职 Agent 漏传 profile 报 404 根因）
  const resolvedProfile = state.sessions.find((s) => s.id === sessionId)?.botName
    || (state.activeFocus.type === 'bot' ? state.activeFocus.botName : state.profileName)
    || 'default';

  const guard = { sessionId, generation: activeLoadMessagesGeneration };
  state.isLoadingOlder = true;
  olderLoadingStartedAt = performance.now();
  const startedAt = performance.now();
  const anchor = captureStreamAnchor();

  try {
    // 完整血缘链条 [D, C, B, A]，环形自动熔断
    const lineageChain = resolveLineageChain(sessionId, state.sessions);
    let batchAppended = false;

    // 0. 本地持久化缓存优先（Cache-First）：若本地 IndexedDB 存有比当前更早的行，0ms 极速呈现，避免网络往返
    const oldestRowId = state.messages.find((m) => typeof m.rowId === 'number' && m.rowId > 0)?.rowId;
    if (typeof oldestRowId === 'number' && oldestRowId > 1) {
      try {
        const cacheRef: CacheChannelRef = { profile: resolvedProfile, channel: 'session', channelId: sessionId };
        const localOlderRows = await cacheService.readOlderRows(cacheRef, oldestRowId, 100);
        if (localOlderRows.length > 0) {
          const cachedBatch = localOlderRows.map(toMessageViewModel).reverse();
          const before = state.messages.length;
          state.messages = planOlderBatchPrependMerge(cachedBatch, state.messages);
          const added = state.messages.length - before;
          if (added > 0) {
            // 新批次插在列表头部，窗口对齐到本批末尾附近，末端由容量推导保持区间有界
            messageWindowStart = Math.max(0, added - 8);
            messageWindowEnd = windowEndFor(messageWindowStart, state.messages.length, MESSAGE_WINDOW_CAPACITY, INITIAL_RENDER_WINDOW);
            messageWindowUserExpanded = true;
            sessionMessagesCache.set(sessionId, state.messages);
            state.hasOlderMessages = true;
            batchAppended = true;
          }
        }
      // gate-degrade: 本地缓存读取失败或未命中时平滑回退到远端 REST 拉取
      } catch {}
    }

    // 单次调用最多推进的页数：防止"整页都是已缓存重复"时无净增死循环
    let attempts = 0;
    const MAX_PAGE_ATTEMPTS = 8;

    for (const targetId of lineageChain) {
      if (batchAppended || attempts >= MAX_PAGE_ATTEMPTS) break;

      const cursorKey = `${sessionId}:${targetId}`;
      if (sessionServerOffset.get(`${cursorKey}:exhausted`) === 1) continue;

      while (attempts < MAX_PAGE_ATTEMPTS) {
        attempts += 1;

        const queryOffset = sessionParentOffsetMap.get(cursorKey)
          ?? (targetId === sessionId ? (sessionServerOffset.get(sessionId) ?? 0) : 0);

        const guarded = await runGuarded(
          guard,
          () => ({ sessionId: state.activeSessionId, generation: activeLoadMessagesGeneration }),
          () => undefined,
          () => gatewayClient!.fetchSessionMessages(targetId, {
            limit: OLDER_BATCH_PAGE_SIZE,
            offset: queryOffset,
            order: 'latest',
            profile: resolvedProfile,
            // 【根因修复】必须包含被上下文压缩归档的原始消息。
            // 默认 include_compacted=false 只返回活动表，翻到压缩摘要节点就"到底"，
            // 用户永远看不到更早的真实历史（这正是 10/17 之前拉不出来的原因）。
            includeCompacted: true,
          }),
          logSession,
        );
        if (guarded.status === 'discarded') {
          state.isLoadingOlder = false;
          return;
        }
        const outcome = guarded.value;

        if (outcome.status !== 'success' || outcome.messages.length === 0) {
          // 该节点已见底，转向上一级血缘
          sessionServerOffset.set(`${cursorKey}:exhausted`, 1);
          break;
        }

        const returned = outcome.pagination?.returned ?? outcome.messages.length;
        sessionParentOffsetMap.set(cursorKey, queryOffset + returned);
        if (targetId === sessionId) sessionServerOffset.set(sessionId, queryOffset + returned);

        // 压缩摘要节点是纯机器交接文本，原始消息已随 include_compacted 一并返回。
        // 【行序守恒 (Rules)】这里绝不能删 hidden 行：本地数组必须与服务端数组逐行对应，
        // 删行会让 fork 切点与分页 offset 漂移。hidden 行一律交给 visibility 层过滤。
        // 只保留「kind 缺失的存量行」前缀兜底，避免整块 [CONTEXT COMPACTION 措手无策。
        const payload = outcome.messages.filter((m) => {
          if (typeof m.display_kind === 'string' && m.display_kind.length > 0) return true;
          const text = typeof m.content === 'string' ? m.content : '';
          return !text.startsWith('[CONTEXT COMPACTION');
        });
        const batch = parseRawMessages(payload);

        const before = state.messages.length;
        state.messages = planOlderBatchPrependMerge(batch, state.messages);
        const added = state.messages.length - before;

        if (added <= 0) {
          // 整页都是本地缓存已有的行：游标已前进，继续拉下一页
          if (returned < OLDER_BATCH_PAGE_SIZE) {
            sessionServerOffset.set(`${cursorKey}:exhausted`, 1);
            break;
          }
          continue;
        }

        // 【挂载窗口预算 (Rules)】只把本轮新增的这批历史纳入挂载窗口，并保留少量上文做锚点缓冲。
        // 曾经直接置 0 会让 4000 行历史全量挂载，每轮渲染都在重建整棵 React 树，
        // 单轮耗时从 200ms 涨到 4s，观感等同于"翻不动"。
        messageWindowStart = Math.max(0, added - 8);
        messageWindowEnd = windowEndFor(messageWindowStart, state.messages.length, MESSAGE_WINDOW_CAPACITY, INITIAL_RENDER_WINDOW);
        messageWindowUserExpanded = true;
        sessionMessagesCache.set(sessionId, state.messages);

        // 缓存分桶纯洁性：只把当前会话自身的消息落盘，父会话历史只在内存合成
        if (targetId === sessionId) {
          persistMessagesToCache(
            { profile: resolvedProfile, channel: 'session', channelId: sessionId },
            state.messages,
            0,
          );
        }

        if (returned < OLDER_BATCH_PAGE_SIZE) {
          sessionServerOffset.set(`${cursorKey}:exhausted`, 1);
        }
        const remainingUnexhausted = lineageChain.some(
          (id) => sessionServerOffset.get(`${sessionId}:${id}:exhausted`) !== 1,
        );
        state.hasOlderMessages = returned >= OLDER_BATCH_PAGE_SIZE || remainingUnexhausted;
        batchAppended = true;
        break;
      }
    }

    if (batchAppended) {
      // 【状态收敛铁律】必须先同步关闭加载态再渲染：
      // rAF 在窗口不可见/后台标签页会被节流甚至永不触发，曾导致 isLoadingOlder 永久为 true，
      // 之后所有翻页请求在第一行守卫处被吞掉，界面永久卡在"正在加载更早历史"。
      state.isLoadingOlder = false;
      render();
      const reapplyAnchor = (): void => applyStreamAnchor(anchor, false);
      reapplyAnchor();
      requestAnimationFrame(() => {
        reapplyAnchor();
        requestAnimationFrame(reapplyAnchor);
      });
      logScroll.debug('older batch prepended via element anchor', {
        totalLoaded: state.messages.length,
        ms: Math.round((performance.now() - startedAt) * 10) / 10,
      });
      return;
    }
  } catch (err) {
    console.warn('[Flux] loadOlderMessages failed:', err);
  }

  // 全部血缘节点耗尽或拉取不到更早消息：彻底收敛，停掉顶部加载动画
  state.hasOlderMessages = false;
  state.isLoadingOlder = false;
  render();
}

/**
 * 将当前活动会话的最新真实消息与时间反哺给左侧栏对应的卡片实体（专职 Bot 或普通会话）
 *
 * 【设计意图 (Why)】
 * 无论是 0ms 内存秒开还是通过 REST 高速拉取完成，当前消息流中的最新一条消息
 * 均为该会话权威的历史真值。在此处触发反哺，可彻底保证无论何时切换会话、刷新页面
 * 或冷启动，左侧栏展示的副标题和时间与中间视口最新一条消息绝对 100% 强一致。
 *
 * 【防范的历史坑 (Pitfall)】
 * 1. 历史上 loadMessages 拉取到最新历史后从未回填给 Profile，导致 Bot 卡片一直停留在错误时间；
 * 2. 匹配会话时仅按裸 id 匹配，跨 Profile 同名 ID 时串扰改错其他 Profile 下的同名会话；
 * 3. 内存更新后未落盘，导致下次列表刷新被网关首句提问冲刷。
 *
 * 【约束与规则 (Rules)】
 * - 专职 Bot 与普通会话各归其位：仅当该 sessionId 属于 Bot 时更新 Bot，普通会话更新普通会话；
 * - 普通会话优先按 botName + sessionId 精准匹配；
 * - 更新同步写入 sessionPreviewCache 并持久化。
 */
function syncActiveSessionPreviewToRail(sessionId: string, messages: MessageViewModel[], botName?: string): void {
  if (!sessionId || messages.length === 0) return;

  // 【口径 (Rules)】预览只取可上屏的行。display_kind='hidden' 与时间线事件都不是人类内容，
  // 拿来当副标题会把 [System: ...] 或后台回执顶到左侧栏。
  const visibleMessages = messages.filter((m) => (m.displayKind ?? 'user') === 'user');
  if (visibleMessages.length === 0) return;

  // 1. 若当前会话为专职 Bot 的 Forever Chat，委托 core 领域逻辑更新
  const botRes = syncActiveSessionToBot({
    sessionId,
    messages: visibleMessages,
    foreverChatCache: botForeverChatCache,
    activeFocusBotName: state.activeFocus.type === 'bot' ? state.activeFocus.botName : undefined,
    profiles: state.profiles,
    activityMap: botLatestActivityMap,
    formatTime: formatSessionTime,
  });
  if (botRes) {
    state.profiles = botRes.profiles;
    persistBotActivityToStorage();
  }

  // 2. 若为普通会话，更新该普通会话的预览与时间戳（优先双重约束，防跨 Profile 串扰）
  const sess = state.sessions.find((s) => s.id === sessionId && (!botName || s.botName === botName))
    || state.sessions.find((s) => s.id === sessionId);
  if (sess) {
    const lastMsg = visibleMessages[visibleMessages.length - 1];
    const lastText = (lastMsg.content || lastMsg.thought || '').slice(0, 100).replace(/\s+/g, ' ').trim();
    const rawTs = lastMsg.rawTimestamp ?? Date.now();
    if (lastText) {
      sess.preview = lastText;
      sess.timestamp = rawTs;
      sess.time = formatSessionTime(rawTs);
      sessionPreviewCache.set(sessionId, {
        lastActive: rawTs,
        text: lastText,
        botName: sess.botName,
      });
      persistSessionPreviewCache();
    }
  }
}

/** 消息拉取代际计数器：彻底阻断切会话时迟滞慢响应串染当前视口与缓存的致命竞态 */
let activeLoadMessagesGeneration = 0;

/**
 * 会话历史加载入口：唯一负责 messagesPhase 进出的地方。
 *
 * 【设计意图 (Why)】宿主在"清空视口 → 历史落地"之间必须声明 loading，视图才用骨架占位；
 *   否则这段空窗会被渲染成"开始新的对话"，等于向用户断言会话是空的。
 * 【约束与规则 (Rules)】
 *   1. 命中内存缓存时直接视为 ready：没有空窗就不该闪一次骨架；
 *   2. finally 无条件收敛 ready（旧代际已被新会话接管时除外），任何分支都不得留下永久骨架。
 */
async function loadMessages(sessionId: string, targetBotName?: string): Promise<void> {
  const cached = sessionId ? sessionMessagesCache.get(sessionId) : undefined;
  state.messagesPhase = cached && cached.length > 0 ? 'ready' : 'loading';
  // loadMessagesInner 第一条语句就是 ++activeLoadMessagesGeneration，因此本次加载的代际可预知。
  // 【防范的坑】用 activeSessionId 判定会漏掉"同一会话被第二次加载"：旧代际的 finally 会把
  //   新代际的 loading 提前置 ready，骨架消失而视口仍空，闪一张"开始新的对话"。
  const expectedGeneration = activeLoadMessagesGeneration + 1;
  try {
    await loadMessagesInner(sessionId, targetBotName);
  } finally {
    if (!sessionId || expectedGeneration === activeLoadMessagesGeneration) {
      state.messagesPhase = 'ready';
      render();
    }
  }
}

async function loadMessagesInner(sessionId: string, targetBotName?: string): Promise<void> {
  // 离线也允许打开会话：历史由持久化缓存提供，没有网关不该直接清空
  if (!sessionId) {
    state.messages = [];
    state.hasOlderMessages = false;
    render();
    return;
  }

  const currentGen = ++activeLoadMessagesGeneration;
  const loadStartedAt = performance.now();
  state.activeSessionId = sessionId;

  // 精准解析当前会话归属的 Profile（解决专职 Agent 会话请求缺 profile 报 404 根因）
  const resolvedBotName = targetBotName
    || state.sessions.find((s) => s.id === sessionId)?.botName
    || (state.activeFocus.type === 'bot' ? state.activeFocus.botName : state.profileName)
    || 'default';

  // 1. Instant Cache Hit (0ms)
  const cached = sessionMessagesCache.get(sessionId);
  if (cached && cached.length > 0) {
    state.messages = [...cached];
    syncActiveSessionPreviewToRail(sessionId, state.messages, resolvedBotName);
    state.hasOlderMessages = computeHasOlderMessages(state.messages, sessionServerOffset.get(sessionId) || 0, INITIAL_WINDOW_PAGE_SIZE);
    pendingScrollToBottom = true;
    render();
    scrollStreamToBottom('cache hit');
    logSession.debug('session rendered from cache', {
      sessionId,
      mounted: state.messages.length,
      ms: Math.round((performance.now() - loadStartedAt) * 10) / 10,
    });
  } else {
    // Session has no cache: clear messages immediately so old session's messages don't persist
    state.messages = [];
    state.hasOlderMessages = false;
    render();
  }

  // 2. If this session is currently actively streaming, DO NOT overwrite with stale REST history!
  if (activeStreamingStoredSessionId === sessionId) {
    logSession.info('session is actively streaming, preserving live state', { sessionId });
    return;
  }

  // 2.5 持久化缓存命中（内存未命中时）：先把历史读出来，再拉最新
  const cacheRef: CacheChannelRef = { profile: resolvedBotName, channel: 'session', channelId: sessionId };
  let cacheFenceMax = 0;
  if (!cached || cached.length === 0) {
    try {
      const opened = await cacheService.openChannel(cacheRef, MESSAGE_CACHE_LIMIT);
      cacheFenceMax = opened.fenceMax;
      const stillCurrent = currentGen === activeLoadMessagesGeneration && state.activeSessionId === sessionId;
      // 只有当前视口仍为空时才渲染缓存，避免覆盖用户在新会话里已有的内容
      if (opened.rows.length > 0 && stillCurrent && state.messages.length === 0) {
        state.messages = opened.rows.map(toMessageViewModel).reverse();
        sessionMessagesCache.set(sessionId, state.messages);
        sessionServerOffset.set(sessionId, Math.max(sessionServerOffset.get(sessionId) || 0, opened.rows.length));
        state.hasOlderMessages = computeHasOlderMessages(state.messages, opened.rows.length, INITIAL_WINDOW_PAGE_SIZE);
        pendingScrollToBottom = true;
        render();
        scrollStreamToBottom('persistent cache hit');
        logSession.info('session rendered from persistent cache', {
          sessionId,
          mounted: state.messages.length,
          ms: Math.round((performance.now() - loadStartedAt) * 10) / 10,
        });
      }
    // gate-degrade: 持久化缓存读取失败时直接走 REST，属可选加速失效
    } catch {}
  }

  // 3. 无网关时到此为止：有缓存就已上屏，没有则保持空态（离线可读历史）
  if (!gatewayClient) {
    render();
    return;
  }

  // 4. High-speed REST pagination: 50 items latest-first (<50ms vs 6500ms WS dump)
  let fastLoaded = false;
  try {
    const outcome = await gatewayClient.fetchSessionMessages(sessionId, {
      limit: INITIAL_WINDOW_PAGE_SIZE,
      order: 'latest',
      profile: resolvedBotName,
      // 首屏与后续翻页必须同口径：包含被压缩归档的原始消息，否则 offset 基数错位
      includeCompacted: true,
    });

    // 竞态守卫：若在网络异步等待期间用户已切到其他会话，坚决终止，绝对禁止污染当前视口与缓存！
    if (currentGen !== activeLoadMessagesGeneration || state.activeSessionId !== sessionId) {
      logSession.debug('discarded stale REST history due to session switch', { sessionId, currentGen });
      return;
    }

    if (outcome.status === 'success' && outcome.messages.length > 0) {
      const parsed = parseRawMessages(outcome.messages);
      const existing = sessionMessagesCache.get(sessionId);
      // 【防范丢数据核心不变量 (Failure Is Not Empty) 与 P0-1 防复活】
      // 合并决策收敛到纯函数 planSessionLoadMerge：截断成功后首次加载以服务端为准（消费 server-priority），
      // 否则保留本地未落盘尾部。消费后清除标记。
      const serverPriority = takeServerPriority(sessionHistoryTrust, sessionId);
      const merged = planSessionLoadMerge(parsed, existing, serverPriority);
      sessionMessagesCache.set(sessionId, merged);
      persistMessagesToCache(cacheRef, merged, cacheFenceMax);
      syncActiveSessionPreviewToRail(sessionId, merged, resolvedBotName);
      const serverKnownCount = outcome.pagination?.returned ?? outcome.messages.length;
      // 【分页游标权威性 (Rules)】offset 保持单调递增，绝不能把本地已有持久化缓存的更大游标倒退覆盖成 100
      const currentKnown = Math.max(sessionServerOffset.get(sessionId) || 0, serverKnownCount);
      sessionServerOffset.set(sessionId, currentKnown);
      state.messages = merged;
      state.hasOlderMessages = merged.length > serverKnownCount
        ? true
        : computeHasOlderMessages(merged, serverKnownCount, INITIAL_WINDOW_PAGE_SIZE);
      state.dockNotice = '';
      pendingScrollToBottom = true;
      render();
      scrollStreamToBottom('fast rest loaded');
      fastLoaded = true;

      logSession.info('session loaded via high-speed REST', {
        sessionId,
        returned: outcome.messages.length,
        mounted: parsed.length,
        ms: Math.round((performance.now() - loadStartedAt) * 10) / 10,
      });
    }
  } catch (err) {
    logSession.debug('fast REST load failed, falling back to session.resume', { err });
  }

  // 3. Background asynchronous session.resume for live session activation & handle resolution
  const resumePromise = (async () => {
    const rpcStartedAt = performance.now();
    try {
      let res: any;
      try {
        res = await gatewayClient.call<any>('session.resume', {
          session_id: sessionId,
          profile: resolvedBotName,
        });
      } catch (firstErr: any) {
        const firstMsg = describeRpcError(firstErr);
        if (firstMsg.includes('Extra inputs')) {
          res = await gatewayClient.call<any>('session.resume', { session_id: sessionId });
        } else {
          throw firstErr;
        }
      }

      // 竞态守卫：核验代际与活跃会话 ID
      if (currentGen !== activeLoadMessagesGeneration || state.activeSessionId !== sessionId) {
        return;
      }

      const handles = readSessionHandles(res, sessionId);
      if (handles) {
        defaultSessionHandleRegistry.register(handles);
        state.activeLiveSessionId = handles.liveId;
      } else {
        state.activeLiveSessionId = sessionId;
      }

      // 权威状态对账自愈（P0 修复）：以网关权威返回 res.running 与 res.inflight 为准，彻底根治幽灵 running 锁死
      if (res && typeof res === 'object') {
        const isGwRunning = Boolean(res.running);
        const hasInflight = Boolean(res.inflight && res.inflight.streaming);
        const reconciled = reconcileAuthoritativeActivity({
          runningIds: activeRunningSessionIds,
          entityId: sessionId,
          isGatewayRunning: isGwRunning,
          hasInflightStreaming: hasInflight,
          currentStreamingId: activeStreamingStoredSessionId,
        });
        if (reconciled) {
          logSession.info('reconciled orphan running state via authoritative gateway status', { sessionId });
          render();
        }
      }

      // 同步提取 session.resume 返回的 cwd / project_id / project_name 元数据，丰富当前会话对象
      const rawInfo = (res && typeof res === 'object' && res.info && typeof res.info === 'object' ? res.info : res) as Record<string, unknown>;
      const resumedCwd = typeof rawInfo.cwd === 'string' ? rawInfo.cwd : typeof rawInfo.path === 'string' ? rawInfo.path : undefined;
      const resumedProjId = typeof rawInfo.project_id === 'string' ? rawInfo.project_id : typeof rawInfo.projectId === 'string' ? rawInfo.projectId : undefined;
      const resumedProjName = typeof rawInfo.project_name === 'string' ? rawInfo.project_name : typeof rawInfo.projectName === 'string' ? rawInfo.projectName : undefined;
      
      const currentActive = state.sessions.find((s) => s.id === sessionId && (!resolvedBotName || s.botName === resolvedBotName))
        || state.sessions.find((s) => s.id === sessionId);
      if (currentActive) {
        let changed = false;
        if (resumedCwd && !currentActive.cwd) {
          currentActive.cwd = resumedCwd;
          changed = true;
        }
        if (resumedProjId && !currentActive.projectId) {
          currentActive.projectId = resumedProjId;
          changed = true;
        }
        if (resumedProjName && !currentActive.projectName) {
          currentActive.projectName = resumedProjName;
          changed = true;
        }
        if (changed) {
          syncProjectSessions();
          render();
        }
      }

      // If REST load did not succeed, fallback to mounting messages from WS result
      if (!fastLoaded) {
        const list = Array.isArray(res?.messages) ? res.messages : Array.isArray(res?.history) ? res.history : [];
        if (list.length > 0) {
          const parsed = parseRawMessages(list);
          const existing = sessionMessagesCache.get(sessionId);
          const wsServerPriority = takeServerPriority(sessionHistoryTrust, sessionId);
          const merged = planSessionLoadMerge(parsed, existing, wsServerPriority);
          sessionMessagesCache.set(sessionId, merged);
          persistMessagesToCache(cacheRef, merged, cacheFenceMax);
          syncActiveSessionPreviewToRail(sessionId, merged, resolvedBotName);
          state.messages = merged;
          sessionServerOffset.set(sessionId, Math.max(sessionServerOffset.get(sessionId) || 0, merged.length));
          state.hasOlderMessages = computeHasOlderMessages(merged, merged.length, INITIAL_WINDOW_PAGE_SIZE);
          pendingScrollToBottom = true;
          render();
          scrollStreamToBottom('ws fallback loaded');
        } else {
          // Failure Is Not Empty: 当网关返回空消息时，绝对禁止把本地内存中已有的聊天记录抹杀为空白！
          // 但截断成功后的 server-priority 标记必须在此消费，否则悬挂到下次正常加载被误用。
          const existing = sessionMessagesCache.get(sessionId);
          takeServerPriority(sessionHistoryTrust, sessionId);
          if (existing && existing.length > 0) {
            state.messages = [...existing];
            render();
          }
        }
      }

      logSession.debug('background session.resume activated', {
        sessionId,
        liveId: state.activeLiveSessionId,
        ms: Math.round((performance.now() - rpcStartedAt) * 10) / 10,
      });
    } catch (e) {
      if (!fastLoaded && currentGen === activeLoadMessagesGeneration && state.activeSessionId === sessionId) {
        console.warn('[Hermes Gateway] Failed to load messages via RPC fallback:', e);
        const errText = describeRpcError(e);
        state.messages = [];
        state.dockNotice = `载入会话历史失败: ${errText}`;
        render();
      }
    }
  })();

  if (!fastLoaded) {
    await resumePromise;
  }
}

/**
 * Resolves the live transport id for the focused conversation.
 *
 * The rail only holds stored ids, while prompt.submit / config.set reject those
 * with `4001 session not found`. `session.resume` is the documented bridge.
 */
async function ensureLiveSessionId(): Promise<string> {
  if (state.activeLiveSessionId) return state.activeLiveSessionId;
  if (!gatewayClient || !state.activeSessionId) return '';

  const guard = { sessionId: state.activeSessionId, generation: activeLoadMessagesGeneration };
  try {
    const sess = state.sessions.find((s) => s.id === state.activeSessionId);
    const prof = sess?.botName || state.profileName || 'default';
    let res: Record<string, unknown> | null = null;
    try {
      res = await gatewayClient.call<Record<string, unknown>>('session.resume', { session_id: guard.sessionId, profile: prof });
    } catch {
      res = await gatewayClient.call<Record<string, unknown>>('session.resume', { session_id: guard.sessionId });
    }
    const handles = readSessionHandles(res, guard.sessionId);
    if (handles) {
      defaultSessionHandleRegistry.register(handles);
      let liveId = '';
      await runGuarded(guard, () => ({ sessionId: state.activeSessionId, generation: activeLoadMessagesGeneration }), () => {
        state.activeLiveSessionId = handles.liveId;
        liveId = handles.liveId;
      }, async () => undefined, logSession);
      return liveId;
    }
  } catch (e) {
    console.warn('[Flux] Failed to resolve live session id:', e);
  }
  return '';
}

async function createNewSession(options?: { profile?: string; projectId?: string; title?: string }): Promise<void> {
  if (!gatewayClient) {
    setTimedDockNotice('未连接网关，无法新建会话');
    render();
    return;
  }

  const targetProfile = options?.profile || state.profileName || 'default';
  const targetTitle = options?.title || t('chat.defaultTaskTitle');
  const targetProjectId = options?.projectId;

  let targetCwd: string | undefined;
  if (targetProjectId) {
    const proj = state.projects.find((p) => p.id === targetProjectId);
    if (proj?.path) targetCwd = proj.path;
  }

  // Preserve draft for current session before creating new
  const currentInput = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
  if (state.activeSessionId && currentInput) {
    sessionDraftMap.set(state.activeSessionId, currentInput.value);
    persistDraftsToStorage();
  }

  try {
    const createPayload: Record<string, unknown> = {
      title: targetTitle,
      profile: targetProfile,
    };
    if (targetProjectId) createPayload.project_id = targetProjectId;
    if (targetCwd) createPayload.cwd = targetCwd;

    let res: Record<string, unknown> | null = null;
    try {
      res = await gatewayClient.call<Record<string, unknown>>('session.create', createPayload);
    } catch (firstErr) {
      if (isExtraInputsError(firstErr)) {
        console.warn('[Flux] Gateway rejected extra params on session.create, retrying minimal');
        res = await gatewayClient.call<Record<string, unknown>>('session.create', { title: targetTitle, profile: targetProfile });
      } else {
        throw firstErr;
      }
    }

    const handles = readSessionHandles(res);
    if (!handles) {
      setTimedDockNotice('网关没有返回新会话的标识，无法开始对话');
      render();
      return;
    }
    defaultSessionHandleRegistry.register(handles);

    // 切到新会话前解除旧会话挂起回滚（P0-2 防横幅泄漏与快照丢失），必须在改写 activeSessionId 之前
    disarmRollbackOnLeave(state.activeSessionId);
    state.profileName = targetProfile;
    state.activeSessionId = handles.storedId;
    state.activeLiveSessionId = handles.liveId;
    state.activeFocus = { type: 'session', sessionId: handles.storedId };
    state.messages = [];
    sessionMessagesCache.set(handles.storedId, []);
    state.dockNotice = '';
    state.modelMenuOpen = false;

    // Reset streaming indicators for the newly focused session
    state.isStreaming = activeStreamingStoredSessionId === handles.storedId;
    state.agentActivityStatus = isStreamingActiveForCurrentSession() ? state.agentActivityStatus : undefined;
    updateActivityPill(state.agentActivityStatus);

    // session.list does not expose a brand-new session until its first turn is persisted
    if (!state.pendingSessionIds.includes(handles.storedId)) {
      state.pendingSessionIds = [handles.storedId, ...state.pendingSessionIds];
    }
    const matchingProfile = state.profiles.find((p) => p.name === targetProfile);
    const newSessionEntry: NormalizedSession = {
      ...toPendingSession(handles, targetTitle),
      botName: targetProfile,
      botDisplayName: matchingProfile?.displayName || targetProfile,
      botAvatar: matchingProfile?.avatar || '',
      projectId: targetProjectId,
      cwd: targetCwd,
    };
    state.sessions = upsertSession(state.sessions, newSessionEntry);

    pendingScrollToBottom = true;
    render();

    // Clear input for the new clean session
    const newInput = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
    if (newInput) {
      newInput.value = '';
      newInput.focus();
    }

    // Apply the model the user picked before the session existed.
    if (state.selectedModel) {
      await applyModelToLiveSession(state.selectedModel);
    }
  } catch (e) {
    console.error('[Hermes Gateway] Create session failed:', e);
    setTimedDockNotice(`新建会话失败: ${describeRpcError(e)}`);
    render();
  }
}

async function deleteSession(id: string): Promise<void> {
  if (!gatewayClient || !id) return;
  sessionListGeneration.invalidateForDelete();

  const targetSession = state.sessions.find((s) => s.id === id);
  const targetProfiles = new Set<string>();
  if (targetSession?.botName) targetProfiles.add(targetSession.botName);
  if (state.profileName) targetProfiles.add(state.profileName);
  targetProfiles.add('default');
  for (const p of state.profiles) {
    if (p.name) targetProfiles.add(p.name);
  }

  try {
    const lifecycle = new SessionLifecycleService({
      rpc: gatewayClient,
      platformBridge: desktopApi,
      restFallback: async (path, options) => {
        if (!desktopApi?.httpProxy) throw new Error('Desktop REST proxy is unavailable');
        return await desktopApi.httpProxy({
          baseUrl: getEffectiveUrl(state.gatewayUrl),
          path,
          method: options?.method,
          ticket: currentTicket,
          params: options?.params,
          body: options?.body,
        });
      },
      baseUrl: () => getEffectiveUrl(state.gatewayUrl),
      ticket: () => currentTicket,
    });
    const outcome = await lifecycle.deleteSession(id, [...targetProfiles]);
    for (const failedProfile of outcome.failedProfiles) {
      console.warn('[Flux] Session deletion failed for profile:', failedProfile);
    }
    if (outcome.status === 'failed') throw new Error(`Delete failed for profiles: ${outcome.failedProfiles.join(', ')}`);

    state.sessions = state.sessions.filter((s) => !outcome.pruneIds.includes(s.id));
    state.pendingSessionIds = state.pendingSessionIds.filter((pid) => pid !== id);
    sessionMessagesCache.delete(id);
    sessionServerOffset.delete(id);
    sessionDraftMap.delete(id);
    persistDraftsToStorage();
    unreadSessionIds.delete(id);
    activeRunningSessionIds.delete(id);
    defaultSessionHandleRegistry.unregister(id);

    // 持久化缓存清理：清空该会话在 IndexedDB 中的消息通道并持久化最新索引
    const deleteCacheRef: CacheChannelRef = {
      profile: targetSession?.botName || state.profileName || 'default',
      channel: 'session',
      channelId: id,
    };
    void cacheService.dropChannel(deleteCacheRef).catch(() => undefined);
    persistSessionsToCache(state.sessions);

    // 如果被删除的会话正在流式运行，安全重置流式看门狗与标志，彻底杜绝输入框被全局 isStreaming 锁死
    if (activeStreamingStoredSessionId === id) {
      tokenCoalescer.clear();
      disarmTurnWatchdog();
      activeStreamingMessageId = null;
      activeStreamingStoredSessionId = null;
      activeStreamingLiveId = null;
      activeStreamingBotName = null;
      state.isStreaming = false;
      state.agentActivityStatus = undefined;
      updateActivityPill(undefined);
    }

    if (state.activeSessionId === id) {
      handleArmedOnDelete(id);
      state.activeSessionId = state.sessions[0]?.id || '';
      state.activeLiveSessionId = '';
      if (state.activeSessionId) {
        await selectSession(state.activeSessionId);
      } else {
        // 当删除最后一条会话导致会话池为空时，干净平滑回退至默认智能体工位，拉取并激活 Forever Chat 终身会话通道
        const targetBot = state.profileName || 'default';
        await openBotChat(targetBot);
      }
    } else {
      render();
    }

    // 焦点重连保护：强力恢复输入舱光标与焦点，确保键盘可立即键入
    restoreComposerFocus();
  } catch (e: unknown) {
    console.error('[Hermes Gateway] Delete session failed:', e);
    const msg = describeRpcError(e);
    if (rpcErrorCode(e) === RpcErrorCode.SessionMissing) {
      state.sessions = state.sessions.filter((s) => s.id !== id);
      state.pendingSessionIds = state.pendingSessionIds.filter((pid) => pid !== id);
      sessionMessagesCache.delete(id);
      sessionServerOffset.delete(id);
      sessionDraftMap.delete(id);
      persistDraftsToStorage();
      unreadSessionIds.delete(id);
      activeRunningSessionIds.delete(id);
      if (activeStreamingStoredSessionId === id) {
        tokenCoalescer.clear();
        disarmTurnWatchdog();
        activeStreamingMessageId = null;
        activeStreamingStoredSessionId = null;
        activeStreamingLiveId = null;
        activeStreamingBotName = null;
        state.isStreaming = false;
        state.agentActivityStatus = undefined;
        updateActivityPill(undefined);
      }
      if (state.activeSessionId === id) {
        handleArmedOnDelete(id);
        state.activeSessionId = state.sessions[0]?.id || '';
        state.activeLiveSessionId = '';
        if (state.activeSessionId) {
          await selectSession(state.activeSessionId);
        } else {
          const targetBot = state.profileName || 'default';
          await openBotChat(targetBot);
        }
      } else {
        render();
      }
      restoreComposerFocus();
      return;
    }
    state.dockNotice = `删除会话失败: ${msg}`;
    render();
    restoreComposerFocus();
  }
}

async function renameSession(id: string, currentTitle: string): Promise<void> {
  const newTitle = prompt('重命名会话', currentTitle);
  if (!newTitle || newTitle.trim() === '' || newTitle.trim() === currentTitle) return;
  const trimmed = newTitle.trim();

  try {
    if (gatewayClient) {
      await gatewayClient.call('session.title', { session_id: id, title: trimmed });
    }
    state.sessions = state.sessions.map((s) => (s.id === id ? { ...s, title: trimmed } : s));
    render();
  } catch (e) {
    // Optimistically update locally even if server returns error
    state.sessions = state.sessions.map((s) => (s.id === id ? { ...s, title: trimmed } : s));
    render();
  }
}

/** 独立的轻量全局浮层 Toast，绝不污染输入舱 */
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(message: string, durationMs = 2200): void {
  let toastEl = document.getElementById('flux-floating-toast');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'flux-floating-toast';
    toastEl.style.cssText = `
      position: fixed;
      bottom: 96px;
      left: 50%;
      transform: translateX(-50%) translateY(10px);
      background: var(--bg-card);
      color: var(--text-main);
      border: 1px solid var(--border-strong);
      box-shadow: var(--shadow-window);
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 500;
      z-index: 3000;
      pointer-events: none;
      display: flex;
      align-items: center;
      gap: 6px;
      backdrop-filter: blur(16px);
      transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      opacity: 0;
    `;
    document.body.appendChild(toastEl);
  }
  toastEl.innerHTML = `<span style="color: var(--accent); font-weight: bold;">✓</span> <span>${escapeHtml(message)}</span>`;
  toastEl.style.opacity = '1';
  toastEl.style.transform = 'translateX(-50%) translateY(0)';

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (toastEl) {
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateX(-50%) translateY(10px)';
    }
  }, durationMs);
}

async function copySessionId(id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(id);
    showToast(t('toast.copied'));
  } catch {
    showToast(id);
  }
}

async function pinSession(id: string): Promise<void> {
  const target = state.sessions.find((s) => s.id === id);
  if (!target) return;
  state.sessions = [target, ...state.sessions.filter((s) => s.id !== id)];
  showToast(t('toast.pinned', { title: target.title }));
  render();
}

async function exportMarkdown(id: string): Promise<void> {
  const activeTitle = state.sessions.find((s) => s.id === id)?.title || 'session';
  const mdContent = state.messages
    // 【规则】导出口径与视图一致：hidden 行不导出，时间线事件单独标注，
    // 否则 [System: ...] 与后台回执会被导出成「### User」冒充用户发言。
    .filter((m) => (m.displayKind ?? 'user') !== 'hidden')
    .map((m) => {
      const kind = m.displayKind ?? 'user';
      const header = kind !== 'user'
        ? `### Event (${kind})`
        : m.role === 'user' ? '### User' : `### Assistant (${state.profileName || 'Agent'})`;
      return `${header} - ${m.timestamp}\n\n${m.thought ? `> 思考链：\n> ${m.thought.replace(/\n/g, '\n> ')}\n\n` : ''}${m.content}\n`;
    })
    .join('\n---\n\n');

  try {
    await navigator.clipboard.writeText(mdContent);
    showToast(t('toast.exported', { title: activeTitle }));
  } catch {
    showToast(t('toast.exportFailed'));
  }
}

async function archiveSession(id: string): Promise<void> {
  try {
    if (gatewayClient) {
      await gatewayClient.call('session.archive', { session_id: id });
    }
  } catch (archiveErr) {
    // gate-degrade: 归档为乐观更新，RPC 失败时仍按用户意图切换本地状态，但必须留下证据
    console.warn('[Flux] session.archive failed, applying optimistic local toggle:', archiveErr);
  }
  state.sessions = state.sessions.map((s) => (s.id === id ? { ...s, isArchived: !s.isArchived } : s));
  state.dockNotice = `已更新会话归档状态`;
  render();
}

/**
 * 删除会话时的挂起回滚处置（主路径与 4007 快速清理分支共用）。
 * 被删会话正是持有 armed 的会话：会话将消失，直接丢弃 armed，不往被删缓存回写；
 * 否则按离开语义处理（armed 属于别的会话时 planRollbackLeaveRestore 返回 null，仅丢弃）。
 */
function handleArmedOnDelete(id: string): void {
  if (state.rollbackArmed && state.rollbackArmed.sessionId === id) {
    state.rollbackArmed = null;
    return;
  }
  disarmRollbackOnLeave(id);
}

/**
 * 离开当前会话前解除挂起回滚：把被乐观裁撤的历史恢复到该会话缓存，防止横幅跨会话泄漏与快照污染。
 * outgoingSessionId 省略时用当前 activeSessionId。恢复决策收敛到纯函数 planRollbackLeaveRestore，
 * armed 不属于正在离开的会话时绝不把它的快照写进别的会话缓存。
 */
function disarmRollbackOnLeave(outgoingSessionId?: string): void {
  const armed = state.rollbackArmed;
  if (!armed) return;
  const plan = planRollbackLeaveRestore(armed, outgoingSessionId ?? state.activeSessionId);
  state.rollbackArmed = null;
  if (plan) {
    sessionMessagesCache.set(plan.restoreSessionId, plan.restore);
  }
}

async function selectSession(id: string, options?: { preserveFocus?: boolean; botName?: string }): Promise<void> {
  if (!id) return;
  if (state.activeSessionId === id && state.activeLiveSessionId && state.messages.length > 0) return;

  // Preserve draft & message snapshot for outgoing session
  const currentInput = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
  if (state.activeSessionId && state.activeSessionId !== id) {
    if (currentInput) {
      sessionDraftMap.set(state.activeSessionId, currentInput.value);
      persistDraftsToStorage();
    }
    if (state.rollbackArmed && state.rollbackArmed.sessionId === state.activeSessionId) {
      disarmRollbackOnLeave();
    } else if (state.messages.length > 0) {
      sessionMessagesCache.set(state.activeSessionId, [...state.messages]);
    }
  }

  state.activeSessionId = id;
  state.activeLiveSessionId = ''; // must be re-resolved through session.resume
  activeLoadMessagesGeneration += 1;
  applyEnteredRead(unreadSessionIds, id);
  state.modelMenuOpen = false;

  // 严格更新互斥单焦点：仅当未要求保持焦点时，更新为普通会话焦点
  if (!options?.preserveFocus) {
    state.activeFocus = { type: 'session', sessionId: id };
  }

  // Sync isStreaming and agentActivityStatus with the target session
  state.isStreaming = activeStreamingStoredSessionId === id;
  state.agentActivityStatus = isStreamingActiveForCurrentSession() ? state.agentActivityStatus : undefined;
  updateActivityPill(state.agentActivityStatus);

  // Force reset messages snapshot to re-bind reactive DOM for streaming
  lastMessagesSnapshot = null;

  await loadMessages(id, options?.botName);

  // 【竞态守卫 (Rules)】等待历史期间用户可能已经切走：迟到的会话绝对不得把草稿与焦点写进新会话的输入框。
  if (state.activeSessionId !== id) return;

  // Restore draft for incoming session without clobbering live typing
  const restoredInput = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
  if (restoredInput) {
    const currentVal = restoredInput.value;
    // 【非破坏性草稿恢复 (Non-Destructive Draft Restoration)】
    // 若用户在网络加载期间已在输入框敲入文字，绝对禁止用空草稿冲刷抹除实时输入！
    if (!currentVal.trim() && sessionDraftMap.has(id)) {
      restoredInput.value = sessionDraftMap.get(id) || '';
    }
  }

  // 【设计意图 (Why)】
  // 会话切换完成（包含删除当前会话后自动移交至下一会话）后，必须立即恢复输入舱光标与焦点，
  // 杜绝用户从列表切换进入会话后发现输入框无光标无法直接键入的痛点。
  // 【防范的陷阱 (Pitfall)】
  // 若未在此处主动聚焦，依赖外部可能丢失或时序未对齐的定时器，会导致输入框长期处于失焦脱敏态。
  // 【约束与规则 (Rules)】
  // 仅在当前会话未处于正在流式生成态时激活焦点。
  if (!state.isStreaming) {
    restoreComposerFocus();
  }
}

/**
 * Pushes the selected model onto the live session.
 *
 * Handles both plain model id and optional provider-specific configuration.
 */
async function applyModelToLiveSession(model: string, provider?: string): Promise<void> {
  if (!gatewayClient || !model) return;

  const liveId = await ensureLiveSessionId();
  if (!liveId) return;

  try {
    // 【网关契约约束】config.set 只接受 [profile, key, value, session_id, scope, confirm_expensive_model]
    // 严禁附加顶层 provider 字段，否则会被客户端运行期守卫抛出 CONTRACT_VIOLATION，或被网关报 4000 Extra inputs
    await gatewayClient.call('config.set', {
      session_id: liveId,
      key: 'model',
      value: model,
    });
  } catch (e) {
    state.dockNotice = `切换模型失败: ${describeRpcError(e)}`;
    render();
  }
}

async function switchModel(model: string, provider?: string): Promise<void> {
  if (!model) return;

  const previous = state.selectedModel;
  state.selectedModel = model;
  if (provider) state.currentProvider = provider;
  state.modelMenuOpen = false;
  state.dockNotice = '';

  // Update recent models list (keep top 8, persist in localStorage)
  state.recentModels = [model, ...state.recentModels.filter((m) => m !== model)].slice(0, 8);
  localStorage.setItem('hermes_flux_recent_models', JSON.stringify(state.recentModels));
  localStorage.setItem('hermes_aura_recent_models', JSON.stringify(state.recentModels));

  render();

  if (previous === model && !provider) return;

  if (!gatewayClient || !state.activeSessionId) {
    // No live conversation yet: the choice is applied right after session.create.
    return;
  }

  // 【设计意图 (Why)】
  // 群聊房间由网关 Group Chat Worker 调度各 Agent 自身绑定的模型，群聊本身不是 session 实体。
  // 【防范的历史坑 (Pitfall)】
  // 历史代码在群聊视口中调用 ensureLiveSessionId() -> session.resume，网关坚决抛出 4001 session not found。
  // 【规则 (Rules)】
  // 当处于群聊房间（activeFocus.type === 'group'）时，切换模型仅更新客户端选择器状态与近期偏好，禁止向不存在的 session 发送 config.set。
  if (state.activeFocus.type === 'group') {
    return;
  }

  const liveId = await ensureLiveSessionId();
  if (!liveId) {
    state.selectedModel = previous;
    state.dockNotice = '无法切换到该模型：当前会话没有可用的实时通道，请重新进入会话';
    render();
    return;
  }

  try {
    // 【网关契约约束】config.set 纯净传参，严禁注入未声明的 provider 字段
    await gatewayClient.call('config.set', {
      session_id: liveId,
      key: 'model',
      value: model,
    });
  } catch (e) {
    state.selectedModel = previous;
    state.dockNotice = `切换模型失败: ${describeRpcError(e)}`;
    render();
  }
}

async function switchReasoning(effort: AppState['reasoningLevel']): Promise<void> {
  state.reasoningLevel = effort;
  render();

  if (!gatewayClient || !state.activeSessionId) return;
  if (state.activeFocus.type === 'group') return;

  const liveId = await ensureLiveSessionId();
  if (!liveId) {
    state.dockNotice = '无法设置思考深度：当前会话没有可用的实时通道';
    render();
    return;
  }

  // Map internal UI level to gateway values
  const gatewayEffortMap: Record<string, string> = {
    default: 'default',
    none: 'off',
    off: 'off',
    low: 'low',
    medium: 'high',
    high: 'high',
    max: 'max',
  };

  try {
    await gatewayClient.call('config.set', {
      session_id: liveId,
      key: 'reasoning',
      value: gatewayEffortMap[effort] || 'default',
    });
    state.dockNotice = '';
  } catch (e) {
    state.dockNotice = `设置思考深度失败: ${describeRpcError(e)}`;
  }
  render();
}

async function switchApproval(mode: 'auto' | 'ask' | 'sandbox'): Promise<void> {
  state.approvalMode = mode;
  render();

  // Map internal UI mode to gateway approval_mode (off | smart | manual)
  const gatewayModeMap: Record<string, string> = { auto: 'off', ask: 'smart', sandbox: 'manual' };

  if (!gatewayClient || !state.activeSessionId) return;

  const liveId = await ensureLiveSessionId();
  if (!liveId) {
    state.dockNotice = '无法设置审批策略：当前会话没有可用的实时通道';
    render();
    return;
  }

  try {
    await gatewayClient.call('config.set', {
      session_id: liveId,
      key: 'approval_mode',
      value: gatewayModeMap[mode] || 'smart',
    });
    state.dockNotice = '';
  } catch (e) {
    state.dockNotice = `设置审批策略失败: ${describeRpcError(e)}`;
  }
  render();
}


/** Force-unlocks the composer if a turn goes silent, so the UI can never latch. */
function armTurnWatchdog(): void {
  if (turnWatchdogTimer) clearTimeout(turnWatchdogTimer);
  turnWatchdogTimer = setTimeout(() => {
    turnWatchdogTimer = null;
    if (!state.isStreaming) return;
    tokenCoalescer.flush();
    // 看门狗超时同样属于"回合异常终止"：必须收尾三个域的运行态，
    // 否则会话/Bot/群聊会永久停在"进行中"且永不进入未读（历史坑）。
    settleTurnTermination({
      runningSessionIds: activeRunningSessionIds,
      runningBotNames: activeRunningBotNames,
      sessionId: activeStreamingStoredSessionId,
      botName: activeStreamingBotName,
    });
    state.isStreaming = false;
    activeStreamingMessageId = null;
    activeStreamingStoredSessionId = null;
    activeStreamingLiveId = null;
    activeStreamingBotName = null;
    state.dockNotice = '上游长时间没有回传本轮结果，已解除发送锁定；如需继续请重新发送';
    render();
  }, TURN_WATCHDOG_MS);
}

function disarmTurnWatchdog(): void {
  if (turnWatchdogTimer) {
    clearTimeout(turnWatchdogTimer);
    turnWatchdogTimer = null;
  }
}

function isStreamingActiveForCurrentSession(): boolean {
  return Boolean(
    activeStreamingStoredSessionId &&
    activeStreamingStoredSessionId === state.activeSessionId &&
    state.isStreaming
  );
}

function setTimedDockNotice(msg: string, durationMs = 4000): void {
  state.dockNotice = msg;
  // 【防范的历史坑 (Pitfall)】F14：旧实现只写 state.dockNotice 不调 render()，
  // 依赖调用方顺带 render；Fork/回滚失败等纯提示路径因此永不上屏，用户误判“点了没反应”。
  // 现显式触发 render，保证任何一条 dock notice 都即时可见。
  render();
  if (dockNoticeDismissTimer) {
    clearTimeout(dockNoticeDismissTimer);
    dockNoticeDismissTimer = null;
  }
  if (msg && durationMs > 0) {
    dockNoticeDismissTimer = setTimeout(() => {
      dockNoticeDismissTimer = null;
      if (state.dockNotice === msg) {
        state.dockNotice = '';
        render();
      }
    }, durationMs);
  }
}

/** Asks the gateway to stop the running turn (the composer turns into a stop button). */
async function interruptTurn(): Promise<void> {
  const targetLiveId = activeStreamingLiveId || state.activeLiveSessionId;
  const targetStoredId = activeStreamingStoredSessionId || state.activeSessionId;

  // 1. Immediately force client-side cancellation & flush
  tokenCoalescer.flush();
  disarmTurnWatchdog();

  const isCurrent = activeStreamingStoredSessionId === state.activeSessionId;
  if (isCurrent && activeStreamingMessageId) {
    const target = state.messages.find((m) => m.id === activeStreamingMessageId);
    if (target) {
      if (!target.content) {
        target.content = '*(已中断本轮生成)*';
      } else {
        target.content += ' *(已中断)*';
      }
      setMessageContent(activeStreamingMessageId, target.content);
    }
  } else if (targetStoredId && activeStreamingMessageId) {
    const cached = sessionMessagesCache.get(targetStoredId);
    const target = cached?.find((m) => m.id === activeStreamingMessageId);
    if (target) {
      target.content = target.content ? target.content + ' *(已中断)*' : '*(已中断本轮生成)*';
    }
  }

  // 中断同样属于"回合终止"：必须收尾运行态，否则该会话/Bot 永久停在"进行中"
  settleTurnTermination({
    runningSessionIds: activeRunningSessionIds,
    runningBotNames: activeRunningBotNames,
    sessionId: activeStreamingStoredSessionId,
    botName: activeStreamingBotName,
  });

  state.isStreaming = false;
  state.agentActivityStatus = undefined;
  updateActivityPill(undefined);
  activeStreamingMessageId = null;
  activeStreamingStoredSessionId = null;
  activeStreamingLiveId = null;
  activeStreamingBotName = null;

  setTimedDockNotice('本轮生成已中断');
  render();

  // 2. Notify remote gateway
  if (gatewayClient && targetLiveId) {
    try {
      await gatewayClient.call('session.interrupt', { session_id: targetLiveId });
    } catch (e) {
      console.warn('[Hermes Gateway] Remote interrupt notification ignored:', e);
    }
  }
}

/**
 * 当前群聊线程上下文：15 分钟内的连续发言复用同一 thread_id（与官方桌面端分组规则一致）
 */
let activeGroupThreadId: string | null = null;
let activeGroupThreadAt = 0;
const GROUP_THREAD_GAP_MS = 15 * 60 * 1000;

/** 向托管群聊房间发送一条人类消息（官方 groups.send 契约） */
async function sendGroupMessage(roomId: string, text: string): Promise<void> {
  const client = gatewayClient;
  if (!client) return;

  const now = Date.now();
  const threadId = activeGroupThreadId && now - activeGroupThreadAt < GROUP_THREAD_GAP_MS
    ? activeGroupThreadId
    : undefined;

  const userMsgId = `grp-usr-${now}`;
  state.messages.push({
    id: userMsgId,
    role: 'user',
    content: text,
    timestamp: formatTimestamp(now),
  });
  pendingScrollToBottom = true;

  // 即时更新该群聊最新消息副标题与时间戳，并排在列表最前
  const targetRoom = state.groupRooms.find((r) => r.roomId === roomId);
  if (targetRoom) {
    targetRoom.lastMessage = text;
    targetRoom.updatedAt = now;
    state.groupRooms = [targetRoom, ...state.groupRooms.filter((r) => r.roomId !== roomId)];
  }
  applyTurnStarted(activeRunningGroupRoomIds, unreadGroupRoomIds, roomId);

  render();
  scrollStreamToBottom('group message sent');

  try {
    const res = await groupRoomStore.sendMessage(roomId, text, 'user', client, { threadId });
    activeGroupThreadId = res.event?.payload?.thread_id || threadId || null;
    activeGroupThreadAt = now;

    // 发送成功后回读房间日志，并有限轮询等待成员回合的回复落盘
    void refreshGroupRoomLog(roomId);
    void pollGroupRoomLog(roomId);
  } catch (err) {
    applyTurnFailed(activeRunningGroupRoomIds, roomId);
    console.error('[Flux] groups.send failed:', err);
    setTimedDockNotice(t('group.sendFailed', { error: describeRpcError(err) }));
    render();
  }
}

/** 回读群聊房间日志并增量刷新中间对话舱 */
async function refreshGroupRoomLog(roomId: string): Promise<number> {
  const client = gatewayClient;
  if (!client) return 0;
  try {
    const logs = await groupRoomStore.fetchLogs(roomId, client);
    if (!logs || logs.length === 0) return 0;
    const lastEntry = logs[logs.length - 1];
    const targetRoom = state.groupRooms.find((r) => r.roomId === roomId);
    if (targetRoom && lastEntry) {
      targetRoom.lastMessage = lastEntry.text;
      const rawEntryTs = lastEntry.timestamp || Date.now();
      targetRoom.updatedAt = typeof rawEntryTs === 'number' ? (rawEntryTs > 1e11 ? rawEntryTs : rawEntryTs * 1000) : Date.now();
      state.groupRooms = [targetRoom, ...state.groupRooms.filter((r) => r.roomId !== roomId)];
    }
    if (state.activeFocus.type === 'group' && state.activeFocus.roomId === roomId) {
      state.messages = logs.map((entry, idx) => {
        const senderName = entry.senderProfile || 'Agent';
        return {
          id: entry.messageId || `g_msg_${idx}`,
          role: entry.actorKind === 'user' || entry.senderProfile === 'user' ? 'user' : 'assistant',
          content: entry.text,
          sender: senderName,
          senderAvatar: resolveAgentAvatar(senderName),
          timestamp: formatTimestamp(entry.timestamp || Date.now()),
        };
      });
      pendingScrollToBottom = true;
      render();
    }
    return logs.length;
  } catch (e) {
    console.warn('[Flux] refreshGroupRoomLog failed:', e);
    return 0;
  }
}

/**
 * 有限轮询群聊日志，等待成员回合的回复落盘
 *
 * 【设计意图 (Why)】
 * groups.send 只是把人类消息写进房间日志（driver_started=true），
 * 成员的回复由网关 driver 异步产出，必须回读 groups.log 才能上屏。
 *
 * 【防范的历史坑 (Pitfall)】
 * 只读一次会永远看不到回复；用 setInterval 常驻轮询又会造成定时器泄漏与空转。
 * 这里采用有界轮询（最多 8 轮 × 2.5s），连续两轮无新增即提前结束。
 *
 * 【规则 (Rules)】
 * - 轮次与间隔必须硬编码上限，禁止无界等待；
 * - 房间切换后后台静默轮询直至结果落盘，自动标记为未读小绿点。
 */
let activeGroupPollerTimer: ReturnType<typeof setTimeout> | null = null;

function clearGroupPoller(): void {
  if (activeGroupPollerTimer) {
    clearTimeout(activeGroupPollerTimer);
    activeGroupPollerTimer = null;
  }
}

/**
 * 持续轮询群聊房间日志，直到房间不再处于激活态或连续空转超时
 */
async function pollGroupRoomLog(roomId: string, maxRounds = 30, intervalMs = 1200): Promise<void> {
  clearGroupPoller();
  let round = 0;
  let stagnantCount = 0;
  let lastCount = -1;

  const step = async () => {
    if (state.activeFocus.type !== 'group' || state.activeFocus.roomId !== roomId) {
      // 用户已切到其他界面，群聊在后台继续静默等待 Agent 回复落盘
      round++;
      const count = await refreshGroupRoomLog(roomId);
      if (count > lastCount) {
        // 后台完成：退出 running 并置未读小绿点（用户不在该房间）
        applyTurnCompleted(activeRunningGroupRoomIds, unreadGroupRoomIds, roomId, false);
        render();
        clearGroupPoller();
        return;
      }
      if (round >= maxRounds) {
        applyTurnFailed(activeRunningGroupRoomIds, roomId);
        render();
        clearGroupPoller();
        return;
      }
      activeGroupPollerTimer = setTimeout(() => {
        void step();
      }, intervalMs);
      return;
    }

    round++;
    const count = await refreshGroupRoomLog(roomId);
    const lastMsg = state.messages.length > 0 ? state.messages[state.messages.length - 1] : null;
    const hasAgentReplied = Boolean(lastMsg && lastMsg.role === 'assistant');

    if (count > lastCount) {
      lastCount = count;
      stagnantCount = 0;
      // 只要检测到已有 Agent 回复落盘，立即在首帧解除 running 状态！
      if (hasAgentReplied) {
        applyTurnCompleted(activeRunningGroupRoomIds, unreadGroupRoomIds, roomId, true);
        render();
      }
    } else {
      stagnantCount++;
    }

    // 若已经有回复且连续 2 轮无新消息，或者未回复但空转达到 6 轮，立即停止轮询，杜绝无界空转
    if ((hasAgentReplied && stagnantCount >= 2) || (stagnantCount >= 5 && round >= 6) || round >= maxRounds) {
      // 收尾：有回复走完成（当前聚焦即已读），无回复的超时视为失败而非未读
      if (hasAgentReplied) {
        applyTurnCompleted(activeRunningGroupRoomIds, unreadGroupRoomIds, roomId, true);
      } else {
        applyTurnFailed(activeRunningGroupRoomIds, roomId);
      }
      render();
      clearGroupPoller();
      return;
    }

    const nextInterval = stagnantCount > 2 ? 2000 : intervalMs;
    activeGroupPollerTimer = setTimeout(() => {
      void step();
    }, nextInterval);
  };

  activeGroupPollerTimer = setTimeout(() => {
    void step();
  }, intervalMs);
}

async function sendMessage(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  if (!gatewayClient) {
    setTimedDockNotice('未连接网关，无法发送消息');
    render();
    return;
  }

  // 群聊房间必须走官方 groups.send
  //
  // 【防范的历史坑 (Pitfall)】
  // 群聊的 roomId 不是 session_id。若沿用普通会话的 prompt.submit 通道，
  // 网关会把它当成会话去查，直接返回 `[4001] session not found`。
  if (state.activeFocus.type === 'group') {
    await sendGroupMessage(state.activeFocus.roomId, trimmed);
    return;
  }

  // A latched busy flag used to swallow every later message without feedback.
  if (state.isStreaming) {
    setTimedDockNotice('当前回合仍在生成中，请等待完成或稍后重试');
    render();
    return;
  }

  if (!state.activeSessionId) {
    await createNewSession();
  }

  const liveId = await ensureLiveSessionId();
  if (!liveId) {
    setTimedDockNotice('当前会话没有可用的实时通道，请重新选择会话后再发送');
    render();
    return;
  }

  state.dockNotice = '';

  // 挂起回滚事务：发送时以持久锚点重算切点，乐观裁撤本地尾部并保存快照供失败恢复。
  // 截断 wire 载荷一律由 core InteractiveService 单点构造，渲染层绝不手拼 truncate 字段。
  const armed =
    state.rollbackArmed && state.rollbackArmed.sessionId === state.activeSessionId
      ? state.rollbackArmed
      : null;
  let armedSnapshotForRestore: MessageViewModel[] | null = null;
  let armedRowId: number | null = null;
  if (armed && armed.anchor.kind === 'row') {
    // 两段式设计：点击回滚时已乐观裁撤（state.messages 已无该锚点行），
    // 故此处 resolveCutIndexByAnchor 返回 -1 是常态、不代表"无锚点降级"。
    // armedRowId 始终携带交由网关做权威截断校验；截断失败由下方 catch 原子恢复快照。
    // 这里再次 slice 仅覆盖"回滚后又有历史加载把该锚点行带回本地"的边缘情形。
    armedRowId = armed.anchor.rowId;
    armedSnapshotForRestore = armed.snapshot.map((m) => ({ ...m }));
    const cut = resolveCutIndexByAnchor(state.messages, armed.anchor);
    if (cut >= 0) {
      state.messages = state.messages.slice(0, cut);
    }
  }
  state.rollbackArmed = null;

  // 处理附件：若输入框暂存了图片或文档，提取图文清单并显式赋予结构化标号（如 Image 1, Doc 1）
  const currentAttachments = [...state.attachments];
  state.attachments = [];
  let finalText = trimmed;
  if (currentAttachments.length > 0) {
    let imgCount = 0;
    let docCount = 0;
    const attachmentLines = currentAttachments.map((att) => {
      const isImg = att.type === 'image';
      if (isImg) imgCount++;
      else docCount++;
      const label = att.label || (isImg ? `Image ${imgCount}` : `Doc ${docCount}`);
      return `- ${label}: ${att.name}`;
    });
    finalText = `[${t('dock.attachmentHeader')}]\n${attachmentLines.join('\n')}\n\n${trimmed}`;
  }

  if (state.activeSessionId) {
    sessionDraftMap.delete(state.activeSessionId);
    persistDraftsToStorage();
  }

  const userMsgId = `usr-${Date.now()}`;
  const userMsg: MessageViewModel = {
    id: userMsgId,
    role: 'user',
    content: trimmed,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
  state.messages.push(userMsg);

  const assistantMsgId = `ast-${Date.now()}`;
  activeStreamingMessageId = assistantMsgId;
  activeStreamingStoredSessionId = state.activeSessionId;
  activeStreamingLiveId = liveId;
  if (liveId && state.activeSessionId) {
    defaultSessionHandleRegistry.register({ liveId, storedId: state.activeSessionId });
  }
  if (state.activeSessionId) {
    // 回合开始：进入 running 并当场清除该会话的历史未读残留（禁止"运行中 + 未读绿点"并存）
    applyTurnStarted(activeRunningSessionIds, unreadSessionIds, state.activeSessionId);
    // 即时更新当前会话的最新消息副标题与时间戳，并排在会话列表最前
    const activeSess = state.sessions.find((s) => s.id === state.activeSessionId);
    if (activeSess) {
      activeSess.preview = trimmed;
      activeSess.timestamp = Date.now();
      activeSess.time = formatTimestamp(Date.now());
      state.sessions = [activeSess, ...state.sessions.filter((s) => s.id !== activeSess.id)];
    }
  }

  // 状态严格独立：仅当用户处于 Bot 专属工位时，才标记该 Bot 处于运行态
  const currentFocus = state.activeFocus;
  activeStreamingBotName = currentFocus.type === 'bot' ? currentFocus.botName : null;
  if (currentFocus.type === 'bot') {
    applyTurnStarted(activeRunningBotNames, unreadBotNames, currentFocus.botName);
    const focusBotName = currentFocus.botName;
    const nowMs = Date.now();
    updateBotLatestActivity(focusBotName, trimmed, nowMs);
  }

  const assistantMsg: MessageViewModel = {
    id: assistantMsgId,
    role: 'assistant',
    content: '',
    thought: '',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
  state.messages.push(assistantMsg);

  // Sync session cache
  sessionMessagesCache.set(state.activeSessionId, [...state.messages]);

  state.isStreaming = true;
  state.agentActivityStatus = 'thinking';
  tokenCoalescer.clear();
  armTurnWatchdog();
  pendingScrollToBottom = true;
  render();
  updateActivityPill('thinking');
  scrollStreamToBottom('message sent');
  logStream.info('turn started', { session: state.activeLiveSessionId, chars: trimmed.length });

  try {
    // 挂载图片附件（若存在）
    for (const att of currentAttachments) {
      if (att.type === 'image' && att.previewUrl?.startsWith('data:')) {
        const base64Data = att.previewUrl.split(',')[1];
        if (base64Data) {
          try {
            await gatewayClient.call<AttachedImageResult>('image.attach_bytes', {
              session_id: liveId,
              content_base64: base64Data,
              filename: att.name,
            });
          } catch (e) {
            logStream.warn('image.attach_bytes failed, continuing with prompt manifest', { error: String(e) });
          }
        }
      }
    }

    // `reasoning_effort` is not part of PromptSubmitParams on this gateway
    // (it answers 4000 / Extra inputs), so reasoning is configured through
    // config.set instead of being smuggled into the submit payload.
    let submitResult: PromptSubmitResult;
    if (armedRowId !== null) {
      // 回滚截断走 core 单点构造，持久 rowId 锚点唯一，杜绝临时 id 逃逸
      submitResult = await interactiveService.truncateAndSubmit(rpcCaller, {
        sessionId: liveId,
        text: finalText,
        rowId: armedRowId,
      });
    } else {
      submitResult = await gatewayClient.call<PromptSubmitResult>('prompt.submit', {
        session_id: liveId,
        text: finalText,
      });
    }

    // 截断/新轮成功后立刻把网关签发的权威 rowId 绑定回本地乐观用户行，形成下次回滚锚点
    if (typeof submitResult?.user_row_id === 'number' && submitResult.user_row_id > 0) {
      userMsg.rowId = submitResult.user_row_id;
      if (state.activeSessionId) {
        const cached = sessionMessagesCache.get(state.activeSessionId);
        const cachedUser = cached?.find((m) => m.id === userMsg.id);
        if (cachedUser) cachedUser.rowId = submitResult.user_row_id;
      }
    }
    if (armedRowId !== null && state.activeSessionId) {
      // 截断成功：本会话历史以服务端为准，禁用“本地更长则保留”合并守卫，防已删消息复活
      sessionHistoryTrust.set(state.activeSessionId, 'server-priority');
      sessionServerOffset.delete(state.activeSessionId);
      state.hasOlderMessages = false;

      // 截断成功同步驱逐持久化缓存中的被截断消息（定理 24，彻底避免冷启动复活）
      let survivorMap: Map<number, number | null> | null = null;
      if (submitResult?.survivor_row_id_map && typeof submitResult.survivor_row_id_map === 'object') {
        survivorMap = new Map();
        for (const [k, v] of Object.entries(submitResult.survivor_row_id_map)) {
          const numKey = Number(k);
          if (Number.isFinite(numKey)) {
            survivorMap.set(numKey, typeof v === 'number' && Number.isFinite(v) ? v : null);
          }
        }
      }
      const truncateCacheRef: CacheChannelRef = {
        profile: activeStreamingBotName || state.profileName || 'default',
        channel: 'session',
        channelId: state.activeSessionId,
      };
      void cacheService.truncate(truncateCacheRef, armedRowId, survivorMap).catch((e) => {
        console.warn('[Flux:cache] truncate cache failed:', e);
      });
    }

    if (submitResult?.status && submitResult.status !== 'streaming' && submitResult.status !== 'queued') {
      assistantMsg.content = `[网关未受理本轮] status=${String(submitResult.status)}`;
      state.isStreaming = false;
      state.agentActivityStatus = undefined;
      updateActivityPill(undefined);
      if (activeStreamingStoredSessionId) applyTurnFailed(activeRunningSessionIds, activeStreamingStoredSessionId);
      if (activeStreamingBotName) { applyTurnFailed(activeRunningBotNames, activeStreamingBotName); activeStreamingBotName = null; }
      activeStreamingMessageId = null;
      activeStreamingStoredSessionId = null;
      activeStreamingLiveId = null;
      disarmTurnWatchdog();
      // 网关未受理且有挂起回滚：按快照原子恢复，草稿绝不丢失
      if (armedSnapshotForRestore && state.activeSessionId) {
        state.messages = armedSnapshotForRestore;
        sessionMessagesCache.set(state.activeSessionId, [...state.messages]);
        setTimedDockNotice(t('chat.rollbackFailed', { reason: String(submitResult?.status ?? '') }));
      }
      render();
    }
  } catch (err) {
    console.error('[Hermes Gateway] prompt.submit failed:', err);
    assistantMsg.content = `[提交失败] ${describeRpcError(err)}`;
    state.isStreaming = false;
    state.agentActivityStatus = undefined;
    updateActivityPill(undefined);
    if (activeStreamingStoredSessionId) applyTurnFailed(activeRunningSessionIds, activeStreamingStoredSessionId);
    if (activeStreamingBotName) { applyTurnFailed(activeRunningBotNames, activeStreamingBotName); activeStreamingBotName = null; }
    activeStreamingMessageId = null;
    activeStreamingStoredSessionId = null;
    activeStreamingLiveId = null;
    disarmTurnWatchdog();
    // 截断失败自愈：恢复乐观裁撤前快照，用户可见“消息回来了 + 草稿还在”，杜绝静默丢历史
    if (armedSnapshotForRestore && state.activeSessionId) {
      state.messages = armedSnapshotForRestore;
      sessionMessagesCache.set(state.activeSessionId, [...state.messages]);
      setTimedDockNotice(t('chat.rollbackFailed', { reason: describeRpcError(err) }));
    }
    render();
  }
}

/**
 * 发送主分流入口（D4）。渲染层不再自行解析 '@'，统一交给 core planSendRoute 裁决，
 * 三态分别落 prompt.background / prompt.btw / groups.send，无提及走普通 prompt.submit。
 * 【防范的历史坑 (Pitfall)】旧实现把 "@架构王 ..." 原文当普通提问 prompt.submit，
 * 模型收到自然语言里的 @ 便答复"无法调用"，且从不调度被呼叫的 Agent。
 */
async function routeSend(text: string): Promise<void> {
  const sessionKind = deriveSessionKind(state.activeFocus);
  const knownProfiles = state.profiles.map((p) => p.name);
  for (const p of state.profiles) {
    if (p.displayName) knownProfiles.push(p.displayName);
  }
  const route = planSendRoute({
    text,
    sessionKind,
    knownProfiles,
    pickedMentionToken: state.pickedMention?.profile ?? null,
  });
  state.pickedMention = null;

  switch (route.kind) {
    case 'plain':
      if (route.text.startsWith('/') && gatewayClient) {
        await runSlashCommand(route.text);
        return;
      }
      await sendMessage(route.text);
      return;
    case 'group-message':
      if (state.activeFocus.type === 'group') await sendGroupMessage(state.activeFocus.roomId, route.text);
      else await sendMessage(route.text);
      return;
    case 'mention-group':
      if (state.activeFocus.type === 'group') await sendGroupMessage(state.activeFocus.roomId, route.text);
      return;
    case 'mention-btw':
      await askSideAgent('btw', route.targetProfile, route.cleanText);
      return;
    case 'mention-subagent':
      await askSideAgent('delegation', route.targetProfile, route.cleanText);
      return;
    default: {
      // 穷尽守卫：新增 SendRoute 变体若未在此处理，编译期即失败，绝不静默吞消息
      const exhaustive: never = route;
      void exhaustive;
      return;
    }
  }
}

/**
 * 执行斜杠指令并按 DispatchType 分派（契约：exec/plugin→output，alias→target，
 * send/prefill/skill→message，UI 展示 display 绝不展示 message 原文）。
 */
async function runSlashCommand(command: string): Promise<void> {
  const liveId = await ensureLiveSessionId();
  if (!liveId) {
    setTimedDockNotice(t('chat.forkNoLive'));
    render();
    return;
  }
  try {
    const res = await interactiveService.execSlash(rpcCaller, liveId, command, state.profileName || undefined);
    const type = res.type || 'exec';
    if (type === 'prefill') {
      const el = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
      if (el) el.value = res.target || res.message || '';
      setTimedDockNotice(res.display || res.notice || '');
      render();
      return;
    }
    if (type === 'send' || type === 'skill') {
      const text = res.message || res.output;
      if (text) await sendMessage(text);
      return;
    }
    if (type === 'alias') {
      if (res.target) await runSlashCommand(res.target);
      return;
    }
    // exec / plugin：以系统提示呈现 output，不产生回合
    const out = res.output || res.warning || '';
    setTimedDockNotice(out || res.display || t('dock.cmdHelp'));
    render();
  } catch (err) {
    setTimedDockNotice(`${t('chat.gatewayNotConnected')}: ${describeRpcError(err)}`);
  }
}

/** 旁路呼叫：BTW 只读外援 / 子代理委派。结果以独立胶囊呈现，严禁混入主消息流。 */
async function askSideAgent(
  kind: 'btw' | 'delegation',
  targetProfile: string,
  question: string
): Promise<void> {
  if (!gatewayClient) {
    setTimedDockNotice(t('chat.gatewayNotConnected'));
    return;
  }
  const liveId = await ensureLiveSessionId();
  if (!liveId) {
    setTimedDockNotice(t('chat.forkNoLive'));
    render();
    return;
  }

  // 解析 displayName → 真实 profile name（BTW/background 需要网关 profile 实名）
  const resolved =
    state.profiles.find((p) => p.name === targetProfile || p.displayName === targetProfile)?.name || targetProfile;

  try {
    let taskId: string;
    if (kind === 'btw') {
      const res = await handoffService.sendBtw(liveId, question, resolved, rpcCaller);
      taskId = res.task_id;
    } else {
      const res = await gatewayClient.call<{ task_id?: string }>('prompt.background', {
        session_id: liveId,
        text: question,
        profile: resolved,
      });
      if (!res?.task_id) throw new Error('prompt.background missing task_id');
      taskId = res.task_id;
    }

    state.sideAgentCapsules = [
      ...state.sideAgentCapsules,
      {
        id: taskId,
        kind,
        profile: resolved,
        question,
        status: 'pending',
        startedAt: Date.now(),
      },
    ];
    armCapsuleTimers(taskId);
    render();
  } catch (err) {
    state.sideAgentCapsules = [
      ...state.sideAgentCapsules,
      {
        id: `failed-${Date.now()}`,
        kind,
        profile: resolved,
        question,
        status: 'failed',
        startedAt: Date.now(),
        notice: describeRpcError(err),
      },
    ];
    render();
  }
}

/** 胶囊两档超时：15 秒提示仍在等待，10 分钟置 expired，杜绝永远转圈 */
function armCapsuleTimers(taskId: string): void {
  const cap = state.sideAgentCapsules.find((c) => c.id === taskId);
  if (!cap) return;
  cap.hintTimer = setTimeout(() => {
    const c = state.sideAgentCapsules.find((x) => x.id === taskId);
    if (c && c.status === 'pending') {
      c.notice = t('capsule.slowHint');
      render();
    }
  }, 15000);
  cap.expireTimer = setTimeout(() => {
    const c = state.sideAgentCapsules.find((x) => x.id === taskId);
    if (c && c.status === 'pending') {
      c.status = 'expired';
      render();
    }
  }, 600000);
}

/**
 * 用户输入与 Agent 输出时间格式化器
 * 【设计意图 (Why)】
 *   统一全端消息时间显示逻辑：当天消息只显示时间（HH:mm），跨天/往日消息必须展示日期+时间（M/d HH:mm），
 *   跨年消息显示完整年月日时间（yyyy/M/d HH:mm）。
 *   确保用户翻阅历史时，对过去的交互时间一目了然。
 */
function formatTimestamp(ts: number | string, now: Date = new Date()): string {
  if (typeof ts === 'string') return ts;
  if (!ts || !Number.isFinite(ts) || ts <= 0) return '';
  const d = new Date(ts > 1e11 ? ts : ts * 1000);
  if (!Number.isFinite(d.getTime())) return '';

  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const timeStr = `${h}:${m}`;

  const isSameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (isSameDay) {
    return timeStr;
  }

  const isSameYear = d.getFullYear() === now.getFullYear();
  if (isSameYear) {
    return `${d.getMonth() + 1}/${d.getDate()} ${timeStr}`;
  }

  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${timeStr}`;
}

function updateActivityPill(statusText?: string): void {
  const container = document.querySelector('.input-dock-container');
  if (!container) return;
  const existingPill = container.querySelector('.agent-activity-pill') as HTMLElement | null;

  // Only display pill if the focused session is the active streaming session
  const shouldShow = Boolean(statusText && isStreamingActiveForCurrentSession());

  if (!shouldShow) {
    if (existingPill) existingPill.remove();
    return;
  }

  // 【规则】显示名统一走 core 派生目录，禁止在此处各自拼 `displayName || name || id`
  const modelLabel =
    modelLabelFromCatalog(state.modelCatalog, state.selectedModel, state.currentProvider) ||
    state.selectedModel ||
    'Hermes Agent';

  if (existingPill) {
    const textSpan = existingPill.querySelector('span:last-child');
    if (textSpan) textSpan.textContent = statusText || '';
  } else {
    const pillHtml = `
      <div class="agent-activity-pill" style="
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: var(--bg-backdrop);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid var(--border-medium);
        border-radius: 9999px;
        padding: 3px 12px;
        font-size: 11px;
        color: var(--text-main);
        margin-bottom: 8px;
        pointer-events: auto;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25), var(--specular-line);
        user-select: none;
        animation: flux-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      ">
        <span class="activity-status-dot" style="
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--success);
          box-shadow: 0 0 8px var(--success-glow);
          display: inline-block;
          animation: flux-pulse 2s infinite ease-in-out;
        "></span>
        <span style="font-weight: 500; letter-spacing: -0.01em;">${escapeHtml(modelLabel)}</span>
        <span style="color: var(--text-muted); opacity: 0.5;">·</span>
        <span style="color: var(--text-secondary); font-family: var(--font-mono, monospace); font-size: 10.5px;">${escapeHtml(statusText || '')}</span>
      </div>
    `;
    container.insertAdjacentHTML('afterbegin', pillHtml);
  }
}

/** Writes the authoritative turn text back into the streamed assistant bubble. */
function setMessageContent(messageId: string, text: string): void {
  const target = state.messages.find((m) => m.id === messageId);
  if (!target) return;
  target.content = text;
  const el = document.getElementById(`msg-content-${messageId}`);
  if (el) {
    if (el.style.display === 'none') {
      el.style.display = 'flex';
    }
    // 关键规则：必须显式锁定 flexDirection = 'column'，严禁 flex 默认的 row 布局将多个 Markdown 段落横向排成多列
    if (el.style.flexDirection !== 'column') {
      el.style.flexDirection = 'column';
    }
    el.innerHTML = renderMarkdown(text);
  }
}

/** Applies the actions produced by the pure gateway-event reducer. */
function applyTurnActions(actions: TurnAction[]): void {
  let needsRender = false;
  let finalReplace: { messageId: string; text: string } | null = null;

  for (const action of actions) {
    switch (action.type) {
      case 'turn-started':
        if (!state.isStreaming) {
          state.isStreaming = true;
          needsRender = true;
        }
        state.agentActivityStatus = 'thinking';
        updateActivityPill('thinking');
        armTurnWatchdog();
        break;

      case 'append-content':
        if (state.agentActivityStatus !== 'writing response') {
          state.agentActivityStatus = 'writing response';
          updateActivityPill('writing response');
        }
        tokenCoalescer.push({ messageId: action.messageId, delta: action.text, isThought: false });
        break;

      case 'append-thought':
        if (state.agentActivityStatus !== 'thinking') {
          state.agentActivityStatus = 'thinking';
          updateActivityPill('thinking');
        }
        tokenCoalescer.push({ messageId: action.messageId, delta: action.text, isThought: true });
        break;

      case 'tool-start': {
        const rawName = String(action.toolCall.name || '').toLowerCase();
        let status = 'executing tool';
        if (rawName.includes('read') || rawName.includes('file')) status = 'reading a file';
        else if (rawName.includes('shell') || rawName.includes('bash') || rawName.includes('cmd') || rawName.includes('terminal')) status = 'running command';
        else if (rawName.includes('edit') || rawName.includes('patch') || rawName.includes('write')) status = 'editing a file';
        else if (rawName.includes('grep') || rawName.includes('search') || rawName.includes('find') || rawName.includes('glob')) status = 'searching files';
        state.agentActivityStatus = status;
        updateActivityPill(status);

        const now = Date.now();
        const target = state.messages.find((m) => m.id === action.messageId);
        if (target) {
          if (!target.toolCalls) target.toolCalls = [];
          // 同 id 重复 start 不新建第二枚胶囊（状态机收敛不变量，定理 10）
          if (!target.toolCalls.some((tc) => tc.id === action.toolCall.id)) {
            target.toolCalls.push({
              id: action.toolCall.id,
              name: action.toolCall.name,
              status: 'running',
              args: action.toolCall.args,
              startTime: now,
            });
          }
          // 流式期间增量直写工具插槽，绕开被短路的 messagesChanged 全量重建
          scheduleToolPatch(action.messageId);
        }
        // Also update background cache if not focused
        if (activeStreamingStoredSessionId) {
          const cached = sessionMessagesCache.get(activeStreamingStoredSessionId);
          const cachedTarget = cached?.find((m) => m.id === action.messageId);
          if (cachedTarget) {
            if (!cachedTarget.toolCalls) cachedTarget.toolCalls = [];
            if (!cachedTarget.toolCalls.some((t) => t.id === action.toolCall.id)) {
              cachedTarget.toolCalls.push({
                id: action.toolCall.id,
                name: action.toolCall.name,
                status: 'running',
                args: action.toolCall.args,
                startTime: now,
              });
            }
          }
        }
        break;
      }

      case 'tool-complete': {
        state.agentActivityStatus = 'thinking';
        updateActivityPill('thinking');

        const now = Date.now();
        const updateTc = (target?: MessageViewModel) => {
          if (target && target.toolCalls) {
            const tc = target.toolCalls.find((t) => action.toolCallId && t.id === action.toolCallId);
            // 契约 tool_id 精确匹配；未命中不再兜底改最近 running（防并发工具串态），仅记日志
            if (tc) {
              tc.status = 'completed';
              if (action.output) {
                tc.output = typeof action.output === 'object' ? JSON.stringify(action.output, null, 2) : String(action.output);
              }
              const serverMs = action.durationMs;
              if (typeof serverMs === 'number' && serverMs >= 0) {
                tc.durationMs = tc.durationMs !== undefined ? Math.max(tc.durationMs, serverMs) : serverMs;
              } else if (tc.startTime) {
                const computed = Math.max(100, now - tc.startTime);
                tc.durationMs = tc.durationMs !== undefined ? Math.max(tc.durationMs, computed) : computed;
              }
            }
          }
        };

        const target = state.messages.find((m) => m.id === action.messageId);
        if (target) {
          updateTc(target);
          scheduleToolPatch(action.messageId);
        }
        if (activeStreamingStoredSessionId) {
          const cached = sessionMessagesCache.get(activeStreamingStoredSessionId);
          updateTc(cached?.find((m) => m.id === action.messageId));
        }
        break;
      }

      case 'persisted-turn': {
        // 回合落盘权威行地址：把网关 rowId 绑定回本地乐观的 user / assistant 行，
        // 使下一轮回滚拥有可信持久锚点（D1 半环，杜绝把 usr- 临时 id 当锚点触发 4018）。
        let changed = bindTurnRowIds({
          messages: state.messages,
          assistantMessageId: action.messageId,
          userRowId: action.userRowId,
          assistantRowId: action.assistantRowId,
          rowIds: action.rowIds,
        });

        if (activeStreamingStoredSessionId) {
          const cached = sessionMessagesCache.get(activeStreamingStoredSessionId);
          if (cached && cached !== state.messages) {
            const cachedChanged = bindTurnRowIds({
              messages: cached,
              assistantMessageId: action.messageId,
              userRowId: action.userRowId,
              assistantRowId: action.assistantRowId,
              rowIds: action.rowIds,
            });
            if (cachedChanged) changed = true;
          }
        }

        if (changed) {
          needsRender = true;
          const targetSessionId = activeStreamingStoredSessionId || state.activeSessionId;
          const msgsToPersist = targetSessionId === state.activeSessionId ? state.messages : (sessionMessagesCache.get(targetSessionId) || []);
          if (targetSessionId && msgsToPersist.length > 0) {
            persistTurnToCache(targetSessionId, activeStreamingBotName, msgsToPersist);
          }
        }
        break;
      }

      case 'replace-content':
        // Deferred: buffered deltas must be flushed first, otherwise they would be
        // appended on top of the authoritative text.
        finalReplace = { messageId: action.messageId, text: action.text };
        break;

      case 'turn-completed':
        tokenCoalescer.flush();
        stopRunningToolTimers();
        if (finalReplace) {
          const replacement = finalReplace;
          setMessageContent(replacement.messageId, replacement.text);
          // Sync cache if completed in background
          if (activeStreamingStoredSessionId) {
            const cached = sessionMessagesCache.get(activeStreamingStoredSessionId);
            const target = cached?.find((m) => m.id === replacement.messageId);
            if (target) target.content = replacement.text;
          }
        }
        // 当回合终结时，所有消息内部若仍残留 status === 'running' 的工具，强制收拢为 completed 保证状态自愈
        for (const msg of state.messages) {
          if (msg.toolCalls) {
            for (const tc of msg.toolCalls) {
              if (tc.status === 'running') {
                tc.status = 'completed';
                if (tc.startTime && !tc.durationMs) {
                  tc.durationMs = Math.max(100, Date.now() - tc.startTime);
                }
              }
            }
          }
        }
        const rawTargetId = action.sessionId || activeStreamingStoredSessionId;
        const completedTargetId = toStoredSessionId(rawTargetId);
        if (completedTargetId) {
          // 回合完成：退出 running；焦点不在该会话时置未读（显式传入焦点判定，禁止函数内从全局反推）
          const isFocused = completedTargetId === state.activeSessionId;
          applyTurnCompleted(activeRunningSessionIds, unreadSessionIds, completedTargetId, isFocused);
          // 【核心隔离固化】仅当当前焦点处于该会话时，state.messages 才属于该会话！
          // 若用户已切到其他会话，绝不能拿当前会话的 state.messages 去覆盖后台会话的缓存！
          if (isFocused) {
            sessionMessagesCache.set(completedTargetId, [...state.messages]);
          }
          const msgsToPersist = isFocused ? state.messages : (sessionMessagesCache.get(completedTargetId) || []);
          if (msgsToPersist.length > 0) {
            persistTurnToCache(completedTargetId, activeStreamingBotName, msgsToPersist);
          }
          const completedSess = state.sessions.find((s) => s.id === completedTargetId);
          if (completedSess) {
            const finalMsg = isFocused
              ? (state.messages.length > 0 ? state.messages[state.messages.length - 1] : null)
              : (sessionMessagesCache.get(completedTargetId)?.slice(-1)[0] || null);
            if (finalMsg?.content) {
              completedSess.preview = finalMsg.content;
            }
            completedSess.timestamp = Date.now();
            completedSess.time = formatTimestamp(Date.now());
            state.sessions = [completedSess, ...state.sessions.filter((s) => s.id !== completedSess.id)];
            persistSessionsToCache(state.sessions);
          }
        }
        // 状态严格独立：用"回合发起时的 Bot"收尾，与当前焦点解耦。
        // 用户切走后仍能正确退出 running 并置未读；仍停在该 Bot 工位则直接已读。
        if (activeStreamingBotName) {
          const isBotFocused = state.activeFocus.type === 'bot' && state.activeFocus.botName === activeStreamingBotName;
          const finalMsg = isBotFocused
            ? (state.messages.length > 0 ? state.messages[state.messages.length - 1] : null)
            : (activeStreamingStoredSessionId ? sessionMessagesCache.get(activeStreamingStoredSessionId)?.slice(-1)[0] || null : null);
          if (finalMsg?.content) {
            updateBotLatestActivity(activeStreamingBotName, finalMsg.content, Date.now());
          }
          applyTurnCompleted(activeRunningBotNames, unreadBotNames, activeStreamingBotName, isBotFocused);
          activeStreamingBotName = null;
        }
        syncProfileLastMessages();
        state.isStreaming = false;
        state.agentActivityStatus = undefined;
        updateActivityPill(undefined);
        activeStreamingMessageId = null;
        activeStreamingStoredSessionId = null;
        activeStreamingLiveId = null;
        disarmTurnWatchdog();
        needsRender = true;
        break;

      case 'turn-failed': {
        tokenCoalescer.flush();
        stopRunningToolTimers();
        const pendingMsg = activeStreamingMessageId
          ? state.messages.find((m) => m.id === activeStreamingMessageId)
          : undefined;
        if (pendingMsg && !pendingMsg.content) {
          pendingMsg.content = `[回合中断] ${action.message}`;
        }
        const rawFailedId = action.sessionId || activeStreamingStoredSessionId;
        const failedTargetId = toStoredSessionId(rawFailedId);
        if (failedTargetId) {
          // 回合失败：退出 running，但绝不置未读（失败没有可查看的成果）
          applyTurnFailed(activeRunningSessionIds, failedTargetId);
        }
        if (activeStreamingBotName) {
          applyTurnFailed(activeRunningBotNames, activeStreamingBotName);
          activeStreamingBotName = null;
        }
        syncProfileLastMessages();
        state.isStreaming = false;
        state.agentActivityStatus = undefined;
        updateActivityPill(undefined);
        activeStreamingMessageId = null;
        activeStreamingStoredSessionId = null;
        activeStreamingLiveId = null;
        setTimedDockNotice(action.message);
        disarmTurnWatchdog();
        needsRender = true;
        break;
      }

      case 'refresh-sessions':
        scheduleSessionsRefresh();
        break;

      case 'session-title':
        state.sessions = applySessionTitle(state.sessions, action.sessionId, action.title);
        needsRender = true;
        break;

      case 'side-agent-complete': {
        // 旁路应答只更新独立胶囊状态，绝不写入 state.messages / 会话缓存（防上下文毒化）
        const capsule = state.sideAgentCapsules.find((c) => c.id === action.taskId);
        if (capsule) {
          capsule.status = action.text ? 'done' : 'failed';
          capsule.answer = action.text || undefined;
          if (capsule.hintTimer) { clearTimeout(capsule.hintTimer); capsule.hintTimer = undefined; }
          if (capsule.expireTimer) { clearTimeout(capsule.expireTimer); capsule.expireTimer = undefined; }
          needsRender = true;
        }
        break;
      }
    }
  }

  if (needsRender) render();
}

/** Inspector-side events (artifacts, browser frames, workspace diffs). */
function handleInspectorEvent(params: unknown): void {
  if (!params || typeof params !== 'object') return;
  const frame = params as { type?: unknown; payload?: Record<string, any> };
  const type = typeof frame.type === 'string' ? frame.type : '';
  const payload = frame.payload || {};
  if (!type) return;

  if (type === 'artifact.created' || type === 'artifact.updated') {
    if (!payload.id || !payload.name) return;
    const existing = state.artifacts.find((a) => a.id === payload.id);
    if (existing) {
      Object.assign(existing, payload);
    } else {
      state.artifacts.unshift({
        id: payload.id,
        name: payload.name,
        type: payload.type || 'FILE',
        size: payload.size || '1KB',
        preview: payload.preview || '',
      });
    }
    render();
    return;
  }

  if ((type === 'browser.frame' || type === 'browser.navigate') && payload.url) {
    state.browserFrame = {
      url: payload.url,
      title: payload.title || 'Page',
      screenshotUrl: payload.screenshotUrl || payload.screenshot,
    };
    render();
    return;
  }

  if ((type === 'git.diff' || type === 'workspace.diff') && Array.isArray(payload.diffs)) {
    state.gitDiffs = payload.diffs;
    render();
  }
}

let connectionEpoch = 0;

async function connect(targetUrl?: string): Promise<void> {
  const epoch = ++connectionEpoch;

  // 1. 彻底断开旧客户端，停止一切在途重连定时器与后台网络噪音
  stopProfileAutoRefresh();
  if (gatewayClient) {
    gatewayClient.disconnect();
    gatewayClient = null;
  }

  if (targetUrl) {
    state.gatewayUrl = targetUrl;
  }

  // 空地址不建立连接：地址必须由用户显式填写，首次启动停留在连接面板
  if (!getEffectiveUrl(state.gatewayUrl)) {
    state.gatewayConnected = false;
    state.gatewayConnecting = false;
    // 不会发起任何拉取，就绝不能停在骨架相位：否则永久假加载。
    state.profilesPhase = 'ready';
    state.sessionsPhase = 'ready';
    state.messagesPhase = 'ready';
    state.testStatus = undefined;
    void applyColdStartFocus();
    render();
    return;
  }

  // 确保新目标地址即时持久化，杜绝回退老地址
  localStorage.setItem('hermes_flux_gateway_url', state.gatewayUrl);
  localStorage.setItem('hermes_flux_username', state.username);
  localStorage.setItem('hermes_flux_password', state.password);
  localStorage.setItem('hermes_flux_profile', state.profileName);
  localStorage.setItem('hermes_aura_gateway_url', state.gatewayUrl);
  localStorage.setItem('hermes_aura_username', state.username);
  localStorage.setItem('hermes_aura_password', state.password);
  localStorage.setItem('hermes_aura_profile', state.profileName);

  state.gatewayConnecting = true;
  state.testStatus = undefined;
  render();

  try {
    const test = await testConnection(
      state.gatewayUrl,
      state.username,
      state.password
    );

    // 过期代际保护：若在探测期间用户触发了新连接，丢弃陈旧响应
    if (epoch !== connectionEpoch) return;

    state.gatewayLatencyMs = test.latency;
    state.testStatus = test;

    if (!test.ok) {
      state.gatewayConnecting = false;
      state.gatewayConnected = false;
      // 连接失败：没有数据会到达，骨架必须让位于错误提示与缓存快照。
      state.profilesPhase = 'ready';
      state.sessionsPhase = 'ready';
      state.messagesPhase = 'ready';
      void applyColdStartFocus();
      render();
      return;
    }

    currentTicket = test.ticket;

    // Build WS URL
    const baseUrl = getEffectiveUrl(state.gatewayUrl);
    let wsUrl = baseUrl.replace('http://', 'ws://').replace('https://', 'wss://') + '/api/ws';
    if (test.ticket) {
      wsUrl += `?ticket=${encodeURIComponent(test.ticket)}`;
    }

    gatewayClient = new HermesGatewayClient({
      url: wsUrl,
      autoConnect: true,
      timeoutMs: 25000,
    });

    // Mount desktop HTTP REST Proxy fallback
    if (desktopApi?.httpProxy) {
      gatewayClient.setRestFallbackHandler(async (path, opts) => {
        return await desktopApi!.httpProxy({
          baseUrl,
          path,
          method: opts?.method,
          ticket: currentTicket,
          params: opts?.params,
          body: opts?.body,
        });
      });
    }

    // Register event listeners for streaming
    gatewayClient.onNotification('event', (params: unknown) => {
      const runningStoredIds = Array.from(activeRunningSessionIds);
      const runningLiveIds = defaultSessionHandleRegistry.getLiveIds(runningStoredIds);
      const activeLiveMapped = state.activeSessionId ? defaultSessionHandleRegistry.toLiveId(state.activeSessionId) : null;
      const activeStoredMapped = state.activeLiveSessionId ? defaultSessionHandleRegistry.toStoredId(state.activeLiveSessionId) : null;
      const streamingLiveMapped = activeStreamingStoredSessionId ? defaultSessionHandleRegistry.toLiveId(activeStreamingStoredSessionId) : null;
      const streamingStoredMapped = activeStreamingLiveId ? defaultSessionHandleRegistry.toStoredId(activeStreamingLiveId) : null;

      const activeIds = [
        state.activeLiveSessionId,
        state.activeSessionId,
        activeLiveMapped,
        activeStoredMapped,
        activeStreamingLiveId,
        activeStreamingStoredSessionId,
        streamingLiveMapped,
        streamingStoredMapped,
        ...runningStoredIds,
        ...runningLiveIds,
      ].filter((id): id is string => Boolean(id));

      const actions = reduceGatewayEvent(params, {
        activeSessionIds: Array.from(new Set(activeIds)),
        activeStreamingMessageId,
      });
      if (actions.length > 0) applyTurnActions(actions);

      handleInspectorEvent(params);
    });

    // Subscribe to FSM transitions (CONNECTING, CONNECTED, DISCONNECTED)
    gatewayClient.getFsm().onStateChange((fsmState) => {
      // 过期代际保护
      if (epoch !== connectionEpoch) return;

      const isConnected = fsmState === 'CONNECTED' || fsmState === 'HANDSHAKING';
      const isConnecting = fsmState === 'CONNECTING';

      if (state.gatewayConnected !== isConnected || state.gatewayConnecting !== isConnecting) {
        state.gatewayConnected = isConnected;
        state.gatewayConnecting = isConnecting;

        // 防刷新保护：若用户正在弹窗或文本框打字，非连通变动不重绘 DOM 树
        const isUserEditing = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
        if (state.isSettingsOpen && isUserEditing && !isConnected) {
          return;
        }

        render();

        if (isConnected) {
          startProfileAutoRefresh();
          Promise.allSettled([fetchProfiles().then(() => Promise.allSettled([fetchSessions(), fetchGroupRooms(), prefetchSlashCatalog()])), fetchModelOptions(), fetchProjects()]);
        }
      }
    });

    // Initial check
    if (gatewayClient.getState() === 'CONNECTED') {
      state.gatewayConnected = true;
      state.gatewayConnecting = false;
      render();
      startProfileAutoRefresh();
      Promise.allSettled([fetchProfiles().then(() => Promise.allSettled([fetchSessions(), fetchGroupRooms(), prefetchSlashCatalog()])), fetchModelOptions(), fetchProjects()]);
    }
  } catch (err: any) {
    console.error('[Flux Connect] Connection failed:', err);
    state.gatewayConnected = false;
    state.gatewayConnecting = false;
    // 握手中断：不再有任何数据会到达，离开骨架相位，避免把网络故障伪装成加载中。
    state.profilesPhase = 'ready';
    state.sessionsPhase = 'ready';
    state.messagesPhase = 'ready';
    state.testStatus = {
      ok: false,
      message: `WebSocket 连接握手失败: ${err.message || '网络异常'}`,
      latency: 0,
    };
  }

  render();
}

function disconnect(): void {
  stopProfileAutoRefresh();
  if (gatewayClient) {
    gatewayClient.disconnect();
    gatewayClient = null;
  }
  tokenCoalescer.clear();
  disarmTurnWatchdog();
  activeStreamingMessageId = null;
  activeStreamingStoredSessionId = null;
  activeStreamingLiveId = null;
  activeStreamingBotName = null;
  // 断线时清空全部三态集合：连接已断，"进行中"不再有任何真实依据，
  // 残留会让重连后的界面继续显示呼吸动效与未读绿点（历史坑）。
  activeRunningSessionIds.clear();
  unreadSessionIds.clear();
  activeRunningBotNames.clear();
  unreadBotNames.clear();
  activeRunningGroupRoomIds.clear();
  unreadGroupRoomIds.clear();
  if (sessionsRefreshTimer) {
    clearTimeout(sessionsRefreshTimer);
    sessionsRefreshTimer = null;
  }
  state.gatewayConnected = false;
  state.gatewayConnecting = false;
  state.gatewayLatencyMs = 0;
  // 断线后不会再有历史到达：立刻离开 loading，避免骨架把断线表现成"一直在加载"。
  state.messagesPhase = 'ready';
  state.sessions = [];
  state.messages = [];
  // 断线即丢弃挂起回滚：会话通道已断，乐观裁撤快照不再有意义，残留会让重连后横幅跨会话泄漏
  state.rollbackArmed = null;
  state.activeSessionId = '';
  state.activeLiveSessionId = '';
  state.pendingSessionIds = [];
  state.isStreaming = false;
  state.modelMenuOpen = false;
  state.sessionListError = '';
  state.dockNotice = '';
  activeStreamingMessageId = null;
  render();
}

interface StreamAnchor {
  sessionId: string;
  id: string | null;
  offset: number;
  rawScrollTop: number;
}

function captureStreamAnchor(): StreamAnchor {
  const stream = document.getElementById('conversation-stream');
  if (!stream) return { sessionId: state.activeSessionId, id: null, offset: 0, rawScrollTop: 0 };
  const streamTop = stream.getBoundingClientRect().top;
  const rows = stream.querySelectorAll<HTMLElement>('[data-msg-id]');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rect = row.getBoundingClientRect();
    if (rect.bottom > streamTop) {
      return { sessionId: state.activeSessionId, id: row.getAttribute('data-msg-id'), offset: rect.top - streamTop, rawScrollTop: stream.scrollTop };
    }
  }
  return { sessionId: state.activeSessionId, id: null, offset: 0, rawScrollTop: stream.scrollTop };
}

function applyStreamAnchor(anchor: StreamAnchor, pinBottom: boolean): void {
  // 跳转落定期间禁止按跳转前捕获的锚点反推位移，否则刚写入的落点会被按反数抵消。
  if (promptJumpSettling) return;
  // 首屏落定期间 scrollTop 由 settleInitialBottom 统一驱动：此时锚点来自旧视口（缓存恢复时是 0），
  // 按它写回会把刚贴好的底部又拉回会话中部。
  if (initialBottomSettling) return;
  const stream = document.getElementById('conversation-stream');
  if (!stream) return;

  // Follow mode (a deliberate jump, or the reader was already at the bottom)
  // wins over position preservation. Without this a background re-render during
  // streaming restores the old scrollTop while the rows keep growing, and the
  // next token flush snaps back down — the "bouncing" conversation.
  if (pinBottom) {
    /**
     * 【贴底按测量对齐 (Rules)】流式输出期间也要经 `scrollStreamToContentBottom`：
     *   直接写 scrollHeight 用的是「总条数 × 平均行高」的估算值，与窗口真实高度可差上千像素，
     *   读者会看到最后一行被压在输入舱底下或停在空白处。
     */
    scrollStreamToContentBottom(stream, parseFloat(getComputedStyle(stream).paddingBottom) || 0);
    logScroll.trace('pinned after render', { session: state.activeSessionId });
    return;
  }

  // If we switched to a different session, don't inherit old session scroll offset!
  if (anchor.sessionId !== state.activeSessionId) {
    stream.scrollTop = stream.scrollHeight;
    markProgrammaticScroll(stream);
    return;
  }

  if (anchor.id) {
    const target = stream.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(anchor.id)}"]`);
    if (target) {
      const streamTop = stream.getBoundingClientRect().top;
      const currentOffset = target.getBoundingClientRect().top - streamTop;
      const delta = currentOffset - anchor.offset;
      if (Math.abs(delta) >= 1) {
        stream.scrollTop += delta;
        markProgrammaticScroll(stream);
        logScroll.trace('anchor corrected', { id: anchor.id, delta: Math.round(delta) });
      }
      return;
    }
    /**
     * 【锚点不得反推窗口 (Rules)】锚点落在挂载窗口外时只做退化处理，绝不据此移动窗口。
     * 窗口定位由 expandMessageWindow / slideMessageWindowForward / loadOlderMessages 显式决策；
     * 锚点反向搬窗口会与"加载更早批次跳到新内容"的意图打架，实测导致向上回溯时
     * 首条可见 rowId 在 30486~35221 之间来回震荡而不是单调变早。
     */
    logScroll.trace('anchor outside mounted window', { id: anchor.id });
  }
  stream.scrollTop = anchor.rawScrollTop;
  markProgrammaticScroll(stream);
}

/**
 * After a full re-render the anchor is applied synchronously; late layout work
 * (web fonts, images, wrapped rows) can still move the pinned row a frame
 * later. Re-measure once and absorb the residual drift.
 */
function stabilizeStreamAnchor(anchor: StreamAnchor): void {
  // 跳转落定期间锚点来自跳转前，尾随校正会把 settle 写入的位移按反数抵消。
  if (promptJumpSettling) return;
  if (initialBottomSettling) return;
  if (!anchor.id) return;
  const stream = document.getElementById('conversation-stream');
  if (!stream) return;
  const target = stream.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(anchor.id)}"]`);
  if (!target) return;

  const streamTop = stream.getBoundingClientRect().top;
  const drift = (target.getBoundingClientRect().top - streamTop) - anchor.offset;
  if (Math.abs(drift) >= 1) {
    stream.scrollTop += drift;
    logScroll.debug('post-layout anchor drift absorbed', { id: anchor.id, drift: Math.round(drift) });
  }
}

interface RenderMessagesSnapshot {
  sessionId: string;
  count: number;
  lastMsgId: string;
  lastContentLen: number;
  isStreaming: boolean;
  gatewayConnected: boolean;
  gatewayConnecting: boolean;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  profileName: string;
  messagesPhase: DataPhase;
  rollbackActive: boolean;
  capsuleCount: number;
}

let lastMessagesSnapshot: RenderMessagesSnapshot | null = null;
let lastInputDockSnapshot: RenderInputDockSnapshot | null = null;
let updateReactTitlebar: (() => void) | null = null;
let updateReactLeftRail: (() => void) | null = null;
/** 左轨/标题栏快照指纹：内容不变时跳过 React 推送，避免每次 render 都全量协调 42+ 行。 */
let lastTitlebarSnapshotJson = '';
let lastPushedLeftRailSnapshot: LeftRailSnapshot | null = null;

/**
 * 快照指纹。
 * 【规则】不可序列化时降级为“每次都推送”：宁可多渲染，也绝不能漏掉一次真实更新。
 */
function snapshotFingerprint(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return `__unserializable_${Date.now()}_${Math.random()}`;
  }
}

let inspectorMotionController: ReturnType<typeof attachMotionController> | null = null;
let lastInspectorCollapsed = true;

/**
 * 复合检查舱动效控制器生命周期绑定器。
 * 设计意图 (Why):
 *   统一构造并管理 InspectionPod 的动效控制器，确保任何时机挂载均持有完整的 onExited 兜底。
 * 防范的历史坑 (Pitfall):
 *   之前在展开与折叠两处各写一套 attach，导致 onExited 回调短路失效，节点退场无法安全收敛为 display: none；
 *   且高频 render 未 detach 旧实例造成潜在事件泄漏。
 * 约束与规则 (Rules):
 *   每次重新绑定前强制对前序实例执行 detach()。
 */
function bindInspectorController(el: HTMLElement): NonNullable<typeof inspectorMotionController> {
  if (inspectorMotionController) {
    inspectorMotionController.detach();
  }
  const controller = attachMotionController(el, {
    triggerProperty: 'width',
    onExited: () => {
      el.style.display = 'none';
      el.classList.add('inspector-collapsed');
    },
  });
  inspectorMotionController = controller;
  return controller;
}

/**
 * 左轨动作表：每个动作只改 state 再 render，事件语义由 React 侧保证。
 * 【约束与规则】点击 Bot/群聊/会话一律不自动展开抽屉（leftRailCollapsed 不动），保留用户当前折叠意图。
 */
function createLeftRailActions(): LeftRailActions {
  return {
    onSelectSession: (sessionId: string, botName?: string) => { cancelColdStartFocus(); void selectSession(sessionId, { botName }); },
    onSelectBot: (profileName: string) => { cancelColdStartFocus(); void openBotChat(profileName); },
    onSelectGroup: (roomId: string) => { cancelColdStartFocus(); void openGroupRoom(roomId); },
    onOpenSessionMenu: (sessionId: string, title: string, x: number, y: number) => {
      state.sessionContextMenu = { x, y, targetType: 'session', targetId: sessionId, targetName: title, sessionId, sessionTitle: title };
      render();
    },
    onOpenBotMenu: (profileName: string, x: number, y: number) => {
      state.sessionContextMenu = { x, y, targetType: 'bot', targetId: profileName, targetName: profileName };
      render();
    },
    onOpenGroupMenu: (roomId: string, name: string, x: number, y: number) => {
      state.sessionContextMenu = { x, y, targetType: 'group', targetId: roomId, targetName: name };
      render();
    },
    onSearchChange: (value: string) => { state.sessionSearchQuery = value; render(); },
    onNewChat: (kind: 'session' | 'group') => { cancelColdStartFocus(); void fetchProjects(); state.newTaskModalTab = kind === 'group' ? 'group' : 'solo'; state.isNewTaskModalOpen = true; render(); },
    onSetTab: (tab: LeftRailTab) => {
      state.activeRailTab = state.activeRailTab === tab ? 'chats' : tab;
      if (state.activeRailTab === 'projects') void fetchProjects();
      render();
    },
    onToggleSessions: () => { state.isSessionsGroupExpanded = !state.isSessionsGroupExpanded; render(); },
    onToggleGroups: () => { state.isGroupsGroupExpanded = !state.isGroupsGroupExpanded; render(); },
    onStartGroupRename: (roomId: string) => { state.editingGroupRoomId = roomId; render(); },
    onConfirmGroupRename: (roomId: string, name: string) => { void confirmGroupRename(roomId, name); },
    onCancelGroupRename: () => { state.editingGroupRoomId = undefined; render(); },
    onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => { beginLeftRailResize(event); },
  };
}

/**
 * 群聊重命名落库。
 * 【设计意图】先乐观更新本地房间名再发 RPC，用户键入后立刻看到结果；RPC 失败只提示不静默。
 * 【约束与规则】网关未连接时只关闭编辑态，不伪造成功。
 */
async function confirmGroupRename(roomId: string, name: string): Promise<void> {
  const newName = name.trim();
  state.editingGroupRoomId = undefined;
  if (!newName || !gatewayClient) {
    render();
    return;
  }
  const previousName = state.groupRooms.find((r) => r.roomId === roomId)?.name;
  state.groupRooms = state.groupRooms.map((r) => (r.roomId === roomId ? { ...r, name: newName } : r));
  render();
  try {
    await groupRoomStore.renameRoom(roomId, newName, gatewayClient);
    showToast(t('toast.groupRenamed'));
    await fetchGroupRooms();
  } catch (err) {
    // 乐观改名失败必须显式回滚，否则界面显示"改好了"而服务端还是旧名，刷新后打脸
    if (previousName !== undefined) {
      state.groupRooms = state.groupRooms.map((r) => (r.roomId === roomId ? { ...r, name: previousName } : r));
      render();
    }
    showToast(t('ctx.groupRenameFailed', { error: describeRpcError(err) }));
  }
}

/**
 * 斜杠与智能引用 Popper 的独立子树同步。
 * 【设计意图 (Why)】Popper 开合高频，绝不能触发整个 dock 的 outerHTML 替换（会重建 textarea、
 * 丢光标与 IME，违反键盘时序军规）。此处只写 #composer-popper-mount.innerHTML。
 */
function syncComposerPoppers(): void {
  const mount = document.getElementById('composer-popper-mount');
  if (!mount) return;
  mount.innerHTML =
    renderSlashPopper(state.slashItems, state.slashPopperOpen) +
    renderMentionPopper(state.mentionItems, state.mentionPopperOpen);
}

/**
 * 左轨实体装饰缓存。
 * 【设计意图 (Why)】左轨每一帧都把 42+ 个会话、群聊与 Agent 重新展开成新对象，
 *   React.memo 的行组件按引用比较会全部失效。按源对象 + 渲染字段指纹复用装饰对象，
 *   让未变化的行保持同一引用，只重渲染真正变化的行。
 * 【防范的历史坑 (Pitfall)】不能只缓存首次结果：会话 preview/timestamp 会被原地更新，
 *   必须把全部渲染字段纳入指纹。
 */
interface RailDecorCacheEntry<T> { stamp: string; value: T }
const railSessionDecorCache = new WeakMap<LeftRailSession, RailDecorCacheEntry<LeftRailSession>>();
const railGroupDecorCache = new WeakMap<LeftRailGroupRoom, RailDecorCacheEntry<LeftRailGroupRoom>>();
const railProfileDecorCache = new WeakMap<LeftRailProfile, RailDecorCacheEntry<LeftRailProfile>>();
let lastDecoratedSessions: LeftRailSession[] = [];
let lastDecoratedGroups: LeftRailGroupRoom[] = [];
let lastDecoratedProfiles: LeftRailProfile[] = [];

interface LeftRailSnapshotInputs {
  sessions: LeftRailSession[];
  groups: LeftRailGroupRoom[];
  profiles: LeftRailProfile[];
  projects: LeftRailProject[];
  projectsVersion: number;
  activeSessionId: string;
  activeFocus: LeftRailActiveFocus;
  profileName: string;
  activeRailTab: LeftRailTab;
  searchQuery: string;
  isSessionsGroupExpanded: boolean;
  isGroupsGroupExpanded: boolean;
  error: string;
  collapsed: boolean;
  editingGroupRoomId?: string;
  profilesPhase: DataPhase;
  sessionsPhase: DataPhase;
}
let lastLeftRailSnapshot: LeftRailSnapshot | null = null;
let lastLeftRailInputs: LeftRailSnapshotInputs | null = null;

function sameLeftRailInputs(prev: LeftRailSnapshotInputs, next: LeftRailSnapshotInputs): boolean {
  return prev.sessions === next.sessions
    && prev.groups === next.groups
    && prev.profiles === next.profiles
    && prev.projects === next.projects
    && prev.projectsVersion === next.projectsVersion
    && prev.activeSessionId === next.activeSessionId
    && prev.activeFocus === next.activeFocus
    && prev.profileName === next.profileName
    && prev.activeRailTab === next.activeRailTab
    && prev.searchQuery === next.searchQuery
    && prev.isSessionsGroupExpanded === next.isSessionsGroupExpanded
    && prev.isGroupsGroupExpanded === next.isGroupsGroupExpanded
    && prev.error === next.error
    && prev.collapsed === next.collapsed
    && prev.profilesPhase === next.profilesPhase
    && prev.sessionsPhase === next.sessionsPhase
    && prev.editingGroupRoomId === next.editingGroupRoomId;
}

/** 元素引用完全一致时复用旧数组，保证行组件收到的数组 prop 也稳定。 */
function stableArray<T>(next: T[], previous: T[]): T[] {
  return next.length === previous.length && next.every((item, index) => item === previous[index]) ? previous : next;
}

function decorateRailSessions(): LeftRailSession[] {
  const next = state.sessions.map((s) => {
    const activityState = resolveActivityState(s.id, {
      runningIds: activeRunningSessionIds,
      unreadIds: unreadSessionIds,
      streamingId: activeStreamingStoredSessionId,
    });
    const cached = railSessionDecorCache.get(s);
    if (cached
      && cached.value.title === s.title
      && cached.value.preview === s.preview
      && cached.value.time === s.time
      && cached.value.timestamp === s.timestamp
      && cached.value.isArchived === s.isArchived
      && cached.value.isPinned === s.pinned
      && cached.value.botName === s.botName
      && cached.value.botDisplayName === s.botDisplayName
      && cached.value.botAvatar === s.botAvatar
      && cached.value.activityState === activityState) {
      return cached.value;
    }
    const value: LeftRailSession = { ...s, isPinned: s.pinned, activityState };
    railSessionDecorCache.set(s, { stamp: '', value });
    return value;
  });
  lastDecoratedSessions = stableArray(next, lastDecoratedSessions);
  return lastDecoratedSessions;
}

function decorateRailGroups(): LeftRailGroupRoom[] {
  const next = state.groupRooms.map((g) => {
    const activityState = resolveActivityState(g.roomId, {
      runningIds: activeRunningGroupRoomIds,
      unreadIds: unreadGroupRoomIds,
    });
    const stamp = [g.name, (g.members || []).join('\u0002'), g.lastMessage, g.updatedAt, g.createdAt, activityState].join('\u0001');
    const cached = railGroupDecorCache.get(g);
    if (cached && cached.stamp === stamp) return cached.value;
    const value: LeftRailGroupRoom = { ...g, activityState };
    railGroupDecorCache.set(g, { stamp, value });
    return value;
  });
  lastDecoratedGroups = stableArray(next, lastDecoratedGroups);
  return lastDecoratedGroups;
}

function decorateRailProfiles(): LeftRailProfile[] {
  const next = state.profiles.map((p) => {
    const avatar = p.avatar || resolveAgentAvatar(p.name) || (p.displayName ? resolveAgentAvatar(p.displayName) : '') || '';
    const activityState = resolveActivityState(p.name, {
      runningIds: activeRunningBotNames,
      unreadIds: unreadBotNames,
    });
    const stamp = [p.name, p.displayName, avatar, p.description, p.lastMessage, p.lastTime, p.timestamp, p.isDefault ? 1 : 0, activityState].join('\u0001');
    const cached = railProfileDecorCache.get(p);
    if (cached && cached.stamp === stamp) return cached.value;
    const value: LeftRailProfile = { ...p, avatar, activityState };
    railProfileDecorCache.set(p, { stamp, value });
    return value;
  });
  lastDecoratedProfiles = stableArray(next, lastDecoratedProfiles);
  return lastDecoratedProfiles;
}

function getTitlebarSnapshot(): TitlebarSnapshot {
  return createTitlebarSnapshot({
    platform: state.platform,
    title: resolveTitlebarTitle({
      activeFocus: state.activeFocus,
      profiles: state.profiles,
      groupRooms: state.groupRooms,
      sessions: state.sessions,
      activeSessionId: state.activeSessionId,
      defaultTitle: t('titlebar.defaultTitle'),
      notConnectedTitle: t('titlebar.notConnected'),
      defaultRoomName: t('group.defaultRoomName'),
      isConnected: state.gatewayConnected,
      profileName: state.profileName,
    }),
    isMaximized: state.isMaximized,
    gatewayConnected: state.gatewayConnected,
    latencyMs: state.gatewayLatencyMs,
    activeAvatar: resolveTitlebarAvatar({
      activeFocus: state.activeFocus,
      profiles: state.profiles,
      groupRooms: state.groupRooms,
      profileName: state.profileName,
      activeSessionId: state.activeSessionId,
      sessions: state.sessions,
    }),
  });
}

/**
 * 左轨快照：只做"从 state 到视图模型"的纯映射。
 * 【约束与规则】主工位卡字段（lastMessage/lastTime/timestamp/activityState）原样透传装饰后的 profile；
 * 组件侧禁止再扫会话池；搜索过滤与排序由 buildLeftRailModel 统一裁决。
 * 三态装饰严格按域隔离：会话读会话集合、群聊读群聊集合、Bot 只读 Bot 集合，互不冒泡。
 */
function getLeftRailSnapshot(): LeftRailSnapshot {
  const sessions = decorateRailSessions();
  const groups = decorateRailGroups();
  // 强制穿透：优先从全局头像缓存解析真实头像资产，消除时序冲刷导致的头像丢失
  const profiles = decorateRailProfiles();
  const inputs: LeftRailSnapshotInputs = {
    sessions,
    groups,
    profiles,
    projects: state.projects,
    projectsVersion,
    activeSessionId: state.activeSessionId,
    activeFocus: state.activeFocus,
    profileName: state.profileName,
    activeRailTab: state.activeRailTab,
    searchQuery: state.sessionSearchQuery,
    isSessionsGroupExpanded: state.isSessionsGroupExpanded !== false,
    isGroupsGroupExpanded: state.isGroupsGroupExpanded !== false,
    error: state.sessionListError,
    collapsed: state.leftRailCollapsed,
    editingGroupRoomId: state.editingGroupRoomId,
    profilesPhase: state.profilesPhase,
    sessionsPhase: state.sessionsPhase,
  };
  if (lastLeftRailSnapshot && lastLeftRailInputs && sameLeftRailInputs(lastLeftRailInputs, inputs)) {
    return lastLeftRailSnapshot;
  }
  lastLeftRailInputs = inputs;
  lastLeftRailSnapshot = {
    model: buildLeftRailModel({
      activeSessionId: state.activeSessionId,
      activeFocus: state.activeFocus,
      sessions,
      profileName: state.profileName,
      profiles,
      groups,
      projects: state.projects,
      activeRailTab: state.activeRailTab,
      searchQuery: state.sessionSearchQuery,
      isSessionsGroupExpanded: state.isSessionsGroupExpanded,
      isGroupsGroupExpanded: state.isGroupsGroupExpanded,
      profilesPhase: state.profilesPhase,
      sessionsPhase: state.sessionsPhase,
      error: state.sessionListError,
    }),
    collapsed: state.leftRailCollapsed,
    searchQuery: state.sessionSearchQuery,
    editingGroupRoomId: state.editingGroupRoomId,
    groupAvatars: profiles,
  };
  return lastLeftRailSnapshot;
}

let reactMessageList: ConversationMount | null = null;
let reactMessageListHost: HTMLElement | null = null;
let renderedMessageIds = new Set<string>();
let lastSeenStreaming = false;

/**
 * 消息视图对象身份缓存。
 * 【设计意图 (Why)】TurnGroup / MessageRow 的 memo 按 message 对象引用比较；
 *   每次快照都 map 出新对象会让所有已挂载消息行整体失效，切换长会话时重复做全量 Markdown 渲染。
 * 【约束与规则 (Rules)】只缓存非末条消息：末条在流式期间内容原地增长且 status 会切换，必须重建。
 *   键使用源 MessageViewModel 对象引用；REST 合并/回滚替换源对象时缓存自然失效。
 */
const conversationVmCache = new WeakMap<MessageViewModel, {
  vm: ConversationMessageVM;
  content: string;
  thought?: string;
  toolsRef?: MessageViewModel['toolCalls'];
  toolsSignature: string;
  displayKind: MessageDisplayKind;
  displayMetadata?: MessageViewModel['displayMetadata'];
}>();

let knownFilesToolsRef: readonly (MessageViewModel['toolCalls'])[] = [];
let knownFilesValue: readonly string[] = [];

/**
 * 会话级文件引用集合。
 * 【设计意图 (Why)】knownFiles 的契约是“整个会话真实读写过的文件”，
 *   不能只扫窗口内 24 条消息，否则窗口外的工具调用会让窗口内引用错误地不可点击。
 * 【规则】按完整 state.messages 的 toolCalls 数组引用做稳定缓存，窗口收缩不影响结果。
 */
function resolveSessionKnownFiles(): readonly string[] {
  const tools = state.messages.map((message) => message.toolCalls);
  const unchanged = tools.length === knownFilesToolsRef.length
    && tools.every((tool, index) => tool === knownFilesToolsRef[index]);
  if (unchanged) return knownFilesValue;
  knownFilesToolsRef = tools;
  knownFilesValue = collectTouchedFiles(state.messages.flatMap((message) => message.toolCalls ?? []));
  return knownFilesValue;
}

/**
 * 已挂载消息的平均渲染高度（px），用于把窗口外历史折算成等效高度。
 *
 * 【设计意图 (Why)】窗口有界后原生滚动条只反映挂载部分（实测 scrollHeight 在 14k~33k 之间乱跳），
 *   必须让 scrollHeight 恒等于全量估算高度，thumb 长度与位置才稳定。
 * 【防范的历史坑 (Pitfall)】若每帧都从当前挂载行重测平均行高，滚动过程中估值会持续漂移，
 *   scrollHeight 随之从 1.0M 涨到 2.3M，滚动条照样乱飞。必须在同一会话内锁定。
 * 【约束与规则 (Rules)】每个会话只在首次拿到足够样本时锁定一次，切会话才重置。
 */
let averageRowHeightPx = 96;
let averageRowHeightSessionId = '';
let averageRowHeightLocked = false;

/** 锁定本会话的平均行高；返回 true 表示本次完成了锁定（需要重渲染以更新占位）。 */
function lockAverageRowHeight(): boolean {
  if (averageRowHeightLocked && averageRowHeightSessionId === state.activeSessionId) return false;
  if (averageRowHeightSessionId !== state.activeSessionId) {
    averageRowHeightSessionId = state.activeSessionId;
    averageRowHeightLocked = false;
    averageRowHeightPx = 96;
  }
  const canvas = document.querySelector<HTMLElement>('.conv-canvas');
  if (!canvas) return false;
  const windowCount = Math.max(1, messageWindowEnd - messageWindowStart);
  const rows = canvas.querySelectorAll<HTMLElement>('[data-msg-id]');
  if (rows.length < 5) return false;
  let contentH = 0;
  /**
   * 【按消息去重累加 (Rules)】同一条消息会在行内渲染多个带 `data-msg-id` 的节点
   *   （复制 / 重试 / 删除三个操作按钮都继承了该属性）。实测 120 条窗口里有 158 个节点、
   *   只对应 68 条消息，逐节点累加会把平均行高抬高 32%，虚拟全高随之虚高，
   *   贴底时视口落到最后一个真实内容之后（整屏空白）。
   *   只累加「最外层同 id 节点」一次，才是这条消息真正占的高度。
   */
  const seenIds = new Set<string>();
  for (const row of rows) {
    const id = row.getAttribute('data-msg-id');
    if (id) {
      if (seenIds.has(id)) continue;
      const outerSame = row.parentElement?.closest('[data-msg-id]');
      if (outerSame && outerSame.getAttribute('data-msg-id') === id) continue;
      seenIds.add(id);
    }
    const h = row.getBoundingClientRect().height;
    if (Number.isFinite(h) && h > 0) contentH += h;
  }
  // 【口径 (Rules)】必须用"窗口内消息条数"作分母，不是 DOM 行数：一条消息可能渲染成多个
  // data-msg-id 节点，用行数会把平均行高算小一半，导致滚动 1px 只走半条消息。
  // display_kind='hidden' 的行不上屏、也不贡献高度，但仍占一个窗口下标；虚拟坐标系本就按
  // 下标推进（见 computeContentOffsetPx / computeVirtualHeightPx），因此分母继续用下标条数，
  // 让"下标 × 平均行高"自洽。隐藏行是低频事件，偏差可忽略。
  if (contentH <= 0) return false;
  averageRowHeightPx = Math.max(24, contentH / windowCount);
  averageRowHeightLocked = true;
  return true;
}

/**
 * 虚拟高度由内层视口自撑（`.conv-virtual-viewport` 的 height），
 * 不再需要给画布写 min-height，避免两套高度互相打架。
 */
function syncCanvasVirtualHeight(): void {
  const canvas = document.querySelector<HTMLElement>('.conv-canvas');
  if (!canvas) return;
  if (canvas.style.minHeight) canvas.style.minHeight = '';
}

/** 计算窗口内容在虚拟坐标中的纵向偏移。 */
function computeContentOffsetPx(): number {
  if (messageWindowStart <= 0) return 0;
  return Math.round(messageWindowStart * averageRowHeightPx);
}

/**
 * 虚拟总高度；未超过容量时返回 0，表示不启用虚拟定位。
 *
 * 【设计意图 (Why)】长会话里同一窗口内各行高度差异极大（实测 120 条窗口真实高度 14451，
 *   而 `120 × 平均行高` 会算到 19000），单靠「总条数 × 平均行高」估算，
 *   窗口底与虚拟底会差出上千像素。此时贴底就是把视口放到最后一条真实消息之后——整屏空白。
 *   窗口覆盖末尾时改用「窗口偏移 + 窗口实测高度」，让虚拟底与内容底严格重合。
 *
 * 【约束与规则 (Rules)】
 *   1. 只有窗口覆盖末尾才生效；窗口在中间时仍用估算，尾部还有占位补偿；
 *   2. DOM 尚未提交时（拿不到窗口高度）回退到估算，绝不返回 0 以外的异常值。
 */
function computeVirtualHeightPx(): number {
  const total = state.messages.length;
  if (total <= MESSAGE_WINDOW_CAPACITY) return 0;
  if (messageWindowEnd >= total) {
    const virtualWindow = document.querySelector<HTMLElement>('.conv-virtual-window');
    const realHeight = virtualWindow?.getBoundingClientRect().height ?? 0;
    if (realHeight > 0) {
      return Math.round(computeContentOffsetPx() + realHeight);
    }
  }
  return Math.round(total * averageRowHeightPx);
}

/** 把当前会话状态映射为对话区只读视图模型；不做任何排序或解析。 */
function buildConversationSnapshot(): ConversationSnapshot {
  const focusType = state.activeFocus.type;
  const streaming = isStreamingActiveForCurrentSession();
  ensureMessageWindow(state.messages.length);
  const windowedMessages = state.messages.slice(messageWindowStart, messageWindowEnd);
  // 【末条判定 (Rules)】必须取窗口内最后一条可上屏的行：末条若被 display_kind 标成 hidden，
  // 真正可见的最后一条就拿不到页脚与流式态。
  const lastMessageId = (() => {
    for (let i = windowedMessages.length - 1; i >= 0; i--) {
      const kind = windowedMessages[i].displayKind ?? 'user';
      if (kind !== 'hidden') return windowedMessages[i].id;
    }
    return undefined;
  })();
  return {
    mode: focusType === 'group' ? 'group' : focusType === 'bot' ? 'foreground' : 'scratchpad',
    connection: state.gatewayConnected ? 'connected' : state.gatewayConnecting ? 'connecting' : 'disconnected',
    isStreaming: streaming,
    // 本地未挂载行由滚动事件中的 expandMessageWindow() 平滑物理延展，仅当服务端真有更早历史时才展示拉取提示
    hasOlderMessages: state.hasOlderMessages,
    isLoadingOlder: state.isLoadingOlder,
    messagesPhase: state.messagesPhase,
    profileName: state.profileName,
    contentOffsetPx: computeContentOffsetPx(),
    virtualHeightPx: computeVirtualHeightPx(),
    knownFiles: resolveSessionKnownFiles(),
    locale: state.lang,
    messages: windowedMessages.map((m) => {
      const isLast = m.id === lastMessageId;
      const displayKind = m.displayKind ?? 'user';
      const toolsSignature = m.toolCalls?.map((tc) => `${tc.id}:${tc.status}:${tc.output?.length ?? 0}:${tc.args?.length ?? 0}`).join('|') ?? '';
      if (!isLast) {
        const cached = conversationVmCache.get(m);
        if (cached
          && cached.content === m.content
          && cached.thought === m.thought
          && cached.toolsRef === m.toolCalls
          && cached.toolsSignature === toolsSignature
          && cached.displayKind === displayKind
          && cached.displayMetadata === m.displayMetadata) {
          return cached.vm;
        }
      }
      const vm: ConversationMessageVM = {
        id: m.id,
        rowId: m.rowId,
        role: m.role,
        content: m.content,
        sender: m.sender,
        senderAvatar: m.senderAvatar,
        model: m.model,
        thought: m.thought,
        thoughtDurationMs: m.thoughtDurationMs,
        durationMs: m.durationMs,
        timestamp: m.timestamp,
        status: streaming && isLast ? 'streaming' : undefined,
        isStreaming: streaming && isLast,
        displayKind,
        displayMetadata: m.displayMetadata,
        toolCalls: m.toolCalls?.map((tc) => ({
          id: tc.id,
          name: tc.name,
          status: tc.status,
          args: tc.args,
          output: tc.output,
          durationMs: tc.durationMs,
          startedAt: tc.startTime,
        })),
      };
      if (!isLast) {
        conversationVmCache.set(m, {
          vm,
          content: m.content,
          thought: m.thought,
          toolsRef: m.toolCalls,
          toolsSignature,
          displayKind,
          displayMetadata: m.displayMetadata,
        });
      }
      return vm;
    }),
  };
}

let lastSeenLoadingOlder = false;
let lastSeenMessagesPhase: DataPhase = 'ready';

/**
 * 同步 React 消息列表。
 * 【设计意图】流式期间不推送新快照，正文由锚点直写；只在出现新消息行或回合结束时收敛，
 * 避免 React 重渲染覆盖 ref / innerHTML 直写的内容。
 */
function syncReactMessageList(force = false): void {
  const host = document.getElementById('react-message-list-host');
  if (!host) {
    reactMessageList?.unmount();
    reactMessageList = null;
    reactMessageListHost = null;
    renderedMessageIds = new Set();
    lastSeenStreaming = false;
    lastSeenLoadingOlder = false;
    lastSeenMessagesPhase = state.messagesPhase;
    return;
  }
  ensureMessageWindow(state.messages.length);
  const currentIds = state.messages.slice(messageWindowStart, messageWindowEnd).map((m) => m.id);
  if (reactMessageListHost !== host) {
    reactMessageList?.unmount();
    reactMessageList = mountMessageList(host, buildConversationSnapshot);
    reactMessageListHost = host;
    renderedMessageIds = new Set(currentIds);
    lastSeenStreaming = isStreamingActiveForCurrentSession();
    lastSeenLoadingOlder = state.isLoadingOlder;
    sessionSwitchPending = false;
    lastSeenMessagesPhase = state.messagesPhase;
    // 【首挂必须也锁定行高 (Rules)】首次挂载若跳过锁定，虚拟高度永不生效，
    // 实测 scrollHeight 停在 751118（= 7625×96 的默认估值）、滚动 11050px 只推进 0 条。
    scheduleVirtualHeightSync();
    return;
  }
  const streaming = isStreamingActiveForCurrentSession();
  const justStoppedStreaming = lastSeenStreaming && !streaming;
  lastSeenStreaming = streaming;

  const loadingOlderChanged = lastSeenLoadingOlder !== state.isLoadingOlder;
  lastSeenLoadingOlder = state.isLoadingOlder;

  // 首屏相位翻转必须推送：骨架 ⇄ 真实空态/历史在不换 id 的情况下也要换脸。
  const messagesPhaseChanged = lastSeenMessagesPhase !== state.messagesPhase;
  lastSeenMessagesPhase = state.messagesPhase;

  const shouldPush = decideConversationPush({
    prevIds: renderedMessageIds,
    nextIds: currentIds,
    justStoppedStreaming,
    force: force || sessionSwitchPending,
    loadingOlderChanged,
    messagesPhaseChanged,
  });
  if (shouldPush && reactMessageList) {
    sessionSwitchPending = false;
    reactMessageList.update();
    renderedMessageIds = new Set(currentIds);
    // React 提交后锁定本会话平均行高并钉住画布虚拟高度，供占位与滚动条映射使用。
    scheduleVirtualHeightSync();
  }
}

/* --------------------------------------------------------------------------
 * 设置中心：快照构造、动作表与网关数据装载
 * -------------------------------------------------------------------------- */

let updateReactSettings: (() => void) | null = null;
let lastSettingsSnapshotJson = '';
let settingsController: ReturnType<typeof createSettingsController> | null = null;

/** 当前生效的语言：state.lang 是唯一真值，i18n 模块只做消费者。 */
function syncLocale(): void {
  setLocale(state.lang === 'en' ? 'en-US' : 'zh-CN');
}

/**
 * 设置编排控制器（惰性构造，全进程单例）。
 * 【约束】所有状态读写仍以 `state` 为唯一真源，控制器只通过 deps 操作它。
 */
function getSettingsController(): ReturnType<typeof createSettingsController> {
  if (settingsController) return settingsController;
  settingsController = createSettingsController({
    isConnected: () => Boolean(gatewayClient) && state.gatewayConnected,
    profileName: () => state.profileName || 'default',
    currentProvider: () => state.currentProvider,
    call: <T,>(method: string, params?: Record<string, unknown>) => {
      if (!gatewayClient) return Promise.reject(new Error(t('settings.loadFailed'))) as Promise<T>;
      return gatewayClient.call<T>(method, params);
    },
    render: () => render(),
    translate: (key) => t(key),
    describeError: (error) => describeRpcError(error),
    getProviders: () => state.settingsProviders,
    setProviders: (value) => { state.settingsProviders = value; },
    getProfiles: () => state.settingsProfiles,
    setProfiles: (value) => { state.settingsProfiles = value; },
    getMcp: () => state.settingsMcp,
    setMcp: (value) => { state.settingsMcp = value; },
    getSkills: () => state.settingsSkills,
    setSkills: (value) => { state.settingsSkills = value; },
    setBusy: (busy) => { state.settingsBusy = busy; },
    onCatalogChanged: () => { void fetchModelOptions({ clearNotice: false }); },
    notify: (message) => showToast(message),
    warn: (message, meta) => bootLog.warn(message, meta),
  });
  return settingsController;
}

function toSettingsProfileRows(profiles: AgentProfile[]): SettingsProfileRow[] {
  return profiles.map((profile) => ({
    name: profile.name,
    displayName: profile.displayName || profile.name,
    model: profile.model || undefined,
    description: profile.description || undefined,
    isDefault: profile.isDefault === true,
  }));
}

/**
 * 提供商行的"使用中"标记必须跟随**当前** provider，而不是装载那一刻的快照：
 * 目录可能在 `model.options` 回包前就加载完成，那时 currentProvider 仍为空，
 * 若不在此重算，界面会一直把错误的行标成使用中（真实网关 CDP 已复现）。
 */
function withCurrentProvider(
  value: SettingsSnapshot['providers'],
): SettingsSnapshot['providers'] {
  if (value.status !== 'ready' || !state.currentProvider) return value;
  const current = state.currentProvider.toLowerCase();
  let changed = false;
  const data = value.data.map((row) => {
    const isCurrent = row.slug.toLowerCase() === current;
    if (isCurrent === row.isCurrent) return row;
    changed = true;
    return { ...row, isCurrent };
  });
  return changed ? { ...value, data } : value;
}

function getSettingsSnapshot(): SettingsSnapshot {
  return {
    isOpen: state.isSettingsOpen,
    section: state.settingsSection,
    theme: state.theme,
    locale: state.lang === 'en' ? 'en' : 'zh',
    fontPrefs: fontPreferences,
    providers: withCurrentProvider(state.settingsProviders),
    profiles: state.settingsProfiles,
    mcp: state.settingsMcp,
    skills: state.settingsSkills,
    gateway: {
      url: state.gatewayUrl,
      username: state.username,
      // 密码永不进入快照 JSON（它会被指纹缓存、也可能被 DevTools 导出）。
      hasStoredPassword: Boolean(state.password),
      profileName: state.profileName,
      status: state.gatewayConnected ? 'connected' : state.gatewayConnecting ? 'connecting' : 'disconnected',
      latencyMs: state.gatewayLatencyMs,
      test: state.testStatus,
    },
    appVersion: state.appVersion,
    platform: state.platform,
    busy: state.settingsBusy,
  };
}

/**
 * 提供商目录装载。
 * 【设计意图】`include_unconfigured: true` 是设置页与模型选择器的唯一差别：
 *   选择器只列能用的，设置页必须把未配置的也列出来，否则用户没有入口填密钥。
 * 【约束与规则】失败必须落成 error 态并带原始信息，禁止降级成空数组。
 */
/** 按当前 section 懒加载对应数据；幂等、并发收敛由控制器统一保证。 */
function ensureSettingsSectionData(section: SettingsSectionId, force = false): void {
  getSettingsController().ensureSection(section, force);
}

/** 连接表单提交：先落 state + localStorage，再走真实 connect()。 */
function applyGatewayDraft(draft: GatewayDraft): void {
  state.gatewayUrl = draft.url.trim();
  state.username = draft.username;
  // 表单留空 = 沿用已保存的密码；避免把空密码写回、也避免把明文回填给 React。
  state.password = resolveGatewayPassword(draft.password, state.password);
  state.profileName = draft.profileName.trim() || 'default';
  localStorage.setItem('hermes_flux_gateway_url', state.gatewayUrl);
  localStorage.setItem('hermes_aura_gateway_url', state.gatewayUrl);
  localStorage.setItem('hermes_flux_username', state.username);
  localStorage.setItem('hermes_aura_username', state.username);
  localStorage.setItem('hermes_flux_password', state.password);
  localStorage.setItem('hermes_aura_password', state.password);
  localStorage.setItem('hermes_flux_profile', state.profileName);
  localStorage.setItem('hermes_aura_profile', state.profileName);
}

function createSettingsActions(): SettingsActions {
  return {
    onClose: () => {
      state.isSettingsOpen = false;
      render();
    },
    onSelectSection: (section) => {
      state.settingsSection = section;
      ensureSettingsSectionData(section);
      render();
    },
    onThemeChange: (theme) => {
      state.theme = resolveSkinId(theme);
      localStorage.setItem('hermes_flux_theme', state.theme);
      localStorage.setItem('hermes_aura_theme', state.theme);
      render();
    },
    onLocaleChange: (locale) => {
      state.lang = locale === 'en' ? 'en' : 'zh';
      localStorage.setItem('hermes_flux_lang', state.lang);
      syncLocale();
      render();
    },
    onFontPrefsChange: (prefs) => {
      fontPreferences = prefs;
      saveFontPreferences(prefs);
      applyFontPreferences(prefs);
      render();
    },
    onRefreshProviders: () => { void getSettingsController().loadProviders(); },
    onSaveProviderKey: (slug, apiKey) => getSettingsController().saveProviderKey(slug, apiKey),
    onDisconnectProvider: (slug) =>
      new Promise((resolve) => {
        const controller = getSettingsController();
        // 断开提供商会删除已保存的密钥且网关无还原接口，必须先二次确认。
        state.confirmModal = {
          title: t('settings.disconnectConfirmTitle'),
          message: t('settings.disconnectConfirmMessage', { slug }),
          confirmLabel: t('settings.disconnect'),
          cancelLabel: t('settings.cancel'),
          isDanger: true,
          onConfirm: async () => { resolve(await controller.disconnectProvider(slug)); },
          onCancel: () => resolve({ ok: false, cancelled: true }),
        };
        render();
      }),
    onRefreshProfiles: () => { void getSettingsController().loadProfiles(); },
    onOpenAgent: (name) => {
      state.isSettingsOpen = false;
      state.editingAgentProfileName = name;
      state.isAgentEditorOpen = true;
      render();
    },
    onRefreshExtensions: () => { void getSettingsController().loadExtensions(); },
    onReloadSkills: () => getSettingsController().reloadSkills(),
    onTestGateway: (draft) => {
      applyGatewayDraft(draft);
      void getSettingsController().runBusy(async () => {
        state.testStatus = await testConnection(state.gatewayUrl, state.username, state.password);
      });
    },
    onConnectGateway: (draft) => {
      applyGatewayDraft(draft);
      if (!state.gatewayUrl) {
        state.testStatus = { ok: false, message: t('gateway.urlRequired'), latency: 0 };
        render();
        return;
      }
      void connect();
    },
    onDisconnectGateway: () => { disconnect(); },
  };
}

/** 设置快照指纹：内容不变就不推 React，避免流式输出期间每帧重渲染整棵设置树。 */
function syncReactSettings(): void {
  const host = document.getElementById('react-settings-host');
  if (!host) return;
  if (!updateReactSettings) {
    updateReactSettings = mountSettingsModal(host, getSettingsSnapshot, createSettingsActions());
    lastSettingsSnapshotJson = '';
  }
  // 关闭态零成本：设置树整体卸载后没有必要每帧序列化一份 50+ provider 的快照。
  if (!state.isSettingsOpen) {
    if (lastSettingsSnapshotJson === '') return;
    lastSettingsSnapshotJson = '';
    updateReactSettings();
    return;
  }
  const snapshot = getSettingsSnapshot();
  const json = JSON.stringify(snapshot);
  if (json === lastSettingsSnapshotJson) return;
  lastSettingsSnapshotJson = json;
  updateReactSettings();
}

function mountReactShellComponents(): void {
  const titlebarHost = document.getElementById('react-titlebar-host');
  const leftRailHost = document.getElementById('react-leftrail-host');
  if (titlebarHost && !updateReactTitlebar) {
    updateReactTitlebar = mountTitlebar(titlebarHost, getTitlebarSnapshot, {
      onMinimize: () => desktopApi?.minimize(),
      onMaximize: async () => {
        if (!desktopApi) return;
        const result = await desktopApi.maximize();
        state.isMaximized = typeof result === 'boolean' ? result : await desktopApi.isMaximized();
        render();
      },
      onClose: () => desktopApi?.close(),
      onToggleLeftRail: () => { state.leftRailCollapsed = !state.leftRailCollapsed; render(); },
      onToggleInspector: () => { state.inspectorCollapsed = !state.inspectorCollapsed; render(); },
      onOpenSettings: () => {
        state.isSettingsOpen = true;
        ensureSettingsSectionData(state.settingsSection);
        render();
      },
      onToggleTheme: () => {
        state.theme = getToggleTheme(state.theme);
        localStorage.setItem('hermes_flux_theme', state.theme);
        localStorage.setItem('hermes_aura_theme', state.theme);
        render();
      },
    });
  }
  if (leftRailHost && !updateReactLeftRail) {
    updateReactLeftRail = mountLeftRail(leftRailHost, getLeftRailSnapshot, createLeftRailActions());
  }
  // 【设计意图 (Why)】绝大多数 render 并不改变左轨/标题栏内容（流式 token、dock 通知、消息追加等）。
  // 无条件 root.render 会把 42+ 行会话列表整棵协调一遍，白白占用主线程。
  // 【规则】左轨快照按输入引用缓存（O(1) 比较），绝不用 JSON.stringify 全量序列化——
  //   89 个会话的快照序列化实测 15~20ms，比它想省下的渲染还贵。
  if (updateReactTitlebar) {
    const fingerprint = snapshotFingerprint(getTitlebarSnapshot());
    if (fingerprint !== lastTitlebarSnapshotJson) {
      lastTitlebarSnapshotJson = fingerprint;
      updateReactTitlebar();
    }
  }
  if (updateReactLeftRail) {
    const snapshot = getLeftRailSnapshot();
    if (snapshot !== lastPushedLeftRailSnapshot) {
      lastPushedLeftRailSnapshot = snapshot;
      updateReactLeftRail();
    }
  }
  syncReactSettings();
  syncReactMessageList();

  /**
   * 提示词导航轨挂载与推送。
   * 【设计意图 (Why)】必须放在 syncReactMessageList 之后：首帧 host 已存在但消息列表还没建，
   *   提前挂载读到的是旧窗口信息。
   * 【约束与规则 (Rules)】host 常驻 pod 层，只挂一次；推送统一走 syncPromptNavigator。
   */
  const navHost = document.getElementById('react-prompt-navigator-host');
  if (navHost && !updateReactPromptNavigator) {
    const promptNavigatorMount = mountPromptNavigator(
      navHost,
      getPromptNavigatorSnapshot,
      createPromptNavigatorActions()
    );
    updateReactPromptNavigator = promptNavigatorMount.update;
  }
  // 缓存命中时是两次引用比较；未命中才整表重建并按 scrollTop 重算当前项。
  rebuildPromptEntries();
  syncPromptNavigator();
  /**
   * 首屏贴底不变式：窗口覆盖末尾 + 读者未回溯 ⇒ 视口应在底部。
   * 【触发点 (Rules)】按布局指纹判定，而不是会话切换那一刻：
   *   冷启动的缓存恢复、分页补齐与行高锁定都是分批到达的，首次规划发生在消息到位之前，
   *   那一刻触发会落空，之后口径变化时再也不会落定。
   * 【意图 (Why)】没有这一步，scrollTop 初值 0 会被滚动处理器判成读者向上回溯，
   *   窗口被连续扩离末尾，读者最终停在会话中部（实测 1128 条会话距底 25756px）。
   * 【兜底 (Rules)】脱离一屏以上说明旧口径残留，即便指纹已记录也重新落定一轮。
   */
  const streamForSettle = document.getElementById('conversation-stream');
  const atTail = messageWindowEnd >= state.messages.length && state.messages.length > MESSAGE_WINDOW_CAPACITY;
  const drifted = streamForSettle
    ? streamForSettle.scrollHeight - streamForSettle.scrollTop - streamForSettle.clientHeight > streamForSettle.clientHeight
    : false;
  if (shouldSettleInitialBottom({
    sessionId: state.activeSessionId,
    readerScrolledSessionId,
    atTail,
    settledSignature: settledLayoutSignature,
    currentSignature: layoutSignature(),
    drifted,
  })) {
    initialBottomSettling = true;
  }
  settleInitialBottom();
  // 输入舱高度决定会话流底部留白，必须在消息列表挂载后同步一次。
  syncStreamBottomInset();
}

function render(): void {
  const root = document.getElementById('flux-app-root');
  if (!root) return;
  const renderStartedAt = performance.now();

  const existingInput = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
  const draftText = existingInput ? existingInput.value : '';
  const inputHadFocus = Boolean(existingInput) && document.activeElement === existingInput;
  const caretStart = existingInput?.selectionStart ?? draftText.length;
  const caretEnd = existingInput?.selectionEnd ?? draftText.length;

  // 通用保护当前聚焦的任何输入框（避免设置弹窗打字时被后台事件冲刷丢失焦点与文本）
  const activeEl = document.activeElement as HTMLElement | null;
  const activeInputId = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') ? activeEl.id : null;
  const activeInputVal = activeEl && 'value' in activeEl ? (activeEl as HTMLInputElement).value : '';
  const activeCaretStart = activeEl && 'selectionStart' in activeEl ? (activeEl as HTMLInputElement).selectionStart : null;
  const activeCaretEnd = activeEl && 'selectionEnd' in activeEl ? (activeEl as HTMLInputElement).selectionEnd : null;

  const suppressPinOnce = suppressPinBottomOnce;
  suppressPinBottomOnce = false;
  const forcedBottom = suppressPinOnce ? false : pendingScrollToBottom;
  pendingScrollToBottom = false;
  const streamEl = document.getElementById('conversation-stream');
  const wasNearBottom = isStreamNearBottom(streamEl);
  // 【滚动不变量 (Rules)】窗口扩展触发的一次性抑制必须同时压住 forcedBottom 与 wasNearBottom：
  // 内容仅略超一屏时，scrollTop=0 同时满足“触顶扩展”与“贴底跟随”，只压前者仍会跳底再弹回。
  const pinBottom = suppressPinOnce ? false : (forcedBottom || wasNearBottom);
  const streamAnchor = captureStreamAnchor();

  document.documentElement.setAttribute('data-theme', state.theme);
  document.documentElement.dataset.maximized = state.isMaximized ? 'true' : 'false';

  let currentProjectName: string | undefined;
  let currentProjectPath: string | undefined;

  const currentTitle = resolveTitlebarTitle({
    activeFocus: state.activeFocus,
    profiles: state.profiles,
    groupRooms: state.groupRooms,
    sessions: state.sessions,
    activeSessionId: state.activeSessionId,
    defaultTitle: t('titlebar.defaultTitle'),
    notConnectedTitle: t('titlebar.notConnected'),
    defaultRoomName: t('group.defaultRoomName'),
    isConnected: state.gatewayConnected,
    profileName: state.profileName,
  });

  const activeSession = state.sessions.find((s) => s.id === state.activeSessionId);
  if (activeSession) {
    const currentProject = state.projects.find((p) => p.id === activeSession.projectId || (activeSession.projectName && p.name === activeSession.projectName) || doesSessionBelongToProject(activeSession, p));
    currentProjectName = currentProject ? currentProject.name : activeSession?.projectName;
    currentProjectPath = currentProject ? currentProject.path : undefined;

    // 兜底路径推断：若会话未关联项目实体，但拥有有效工作目录 cwd，从目录末端提取 Workspace 名称展示
    if (!currentProjectName && activeSession?.cwd) {
      const norm = activeSession.cwd.replace(/\\/g, '/').replace(/\/+$/, '');
      const folderName = norm.split('/').pop() || norm;
      if (folderName && folderName !== '/' && !folderName.endsWith(':')) {
        currentProjectName = folderName;
        currentProjectPath = norm;
      }
    }
  }

  const currentLastMsg = state.messages.length > 0 ? state.messages[state.messages.length - 1] : null;
  const currentMessagesSnapshot: RenderMessagesSnapshot = {
    sessionId: state.activeSessionId,
    count: state.messages.length,
    lastMsgId: currentLastMsg ? currentLastMsg.id : '',
    lastContentLen: currentLastMsg ? (currentLastMsg.content?.length || 0) : 0,
    isStreaming: state.isStreaming,
    gatewayConnected: state.gatewayConnected,
    gatewayConnecting: state.gatewayConnecting,
    hasOlder: state.hasOlderMessages,
    isLoadingOlder: state.isLoadingOlder,
    profileName: state.profileName,
    messagesPhase: state.messagesPhase,
    rollbackActive: Boolean(state.rollbackArmed),
    capsuleCount: state.sideAgentCapsules.length,
  };

  const isStreamingCurrent = isStreamingActiveForCurrentSession();
  const currentDockSnapshot: RenderInputDockSnapshot = {
    selectedModel: state.selectedModel,
    currentProvider: state.currentProvider,
    reasoningLevel: state.reasoningLevel,
    approvalMode: state.approvalMode,
    isStreaming: isStreamingCurrent,
    disabled: !state.gatewayConnected,
    modelMenuOpen: state.modelMenuOpen,
    notice: state.dockNotice,
    activityStatus: isStreamingCurrent ? state.agentActivityStatus : undefined,
    modelCount: state.availableModels.length,
    modelCatalogHash: state.modelCatalogHash,
    modelSearchQuery: state.modelSearchQuery,
    recentModelsHash: state.recentModels.join(','),
    favoriteModelsHash: state.favoriteModels.join(','),
    attachmentsCount: state.attachments.length,
    attachmentsHash: state.attachments.map((a) => `${a.id}:${a.name}`).join(','),
    rollbackArmedHash: state.rollbackArmed
      ? `${state.rollbackArmed.targetId}:${state.rollbackArmed.removedCount}`
      : '',
  };

  const inOngoingStreamingTurn =
    state.isStreaming &&
    lastMessagesSnapshot?.isStreaming &&
    lastMessagesSnapshot.sessionId === currentMessagesSnapshot.sessionId &&
    lastMessagesSnapshot.count === currentMessagesSnapshot.count;

  const structureDirty = canvasStructureDirty;
  const messagesChanged =
    (structureDirty || !inOngoingStreamingTurn) &&
    (structureDirty ||
      !lastMessagesSnapshot ||
      lastMessagesSnapshot.sessionId !== currentMessagesSnapshot.sessionId ||
      lastMessagesSnapshot.count !== currentMessagesSnapshot.count ||
      lastMessagesSnapshot.lastMsgId !== currentMessagesSnapshot.lastMsgId ||
      lastMessagesSnapshot.isStreaming !== currentMessagesSnapshot.isStreaming ||
      lastMessagesSnapshot.gatewayConnected !== currentMessagesSnapshot.gatewayConnected ||
      lastMessagesSnapshot.gatewayConnecting !== currentMessagesSnapshot.gatewayConnecting ||
      lastMessagesSnapshot.hasOlder !== currentMessagesSnapshot.hasOlder ||
      lastMessagesSnapshot.isLoadingOlder !== currentMessagesSnapshot.isLoadingOlder ||
      lastMessagesSnapshot.profileName !== currentMessagesSnapshot.profileName ||
      lastMessagesSnapshot.messagesPhase !== currentMessagesSnapshot.messagesPhase ||
      lastMessagesSnapshot.rollbackActive !== currentMessagesSnapshot.rollbackActive ||
      lastMessagesSnapshot.capsuleCount !== currentMessagesSnapshot.capsuleCount);

  const bodyContainer = root.querySelector('.flux-body-container');

  if (!bodyContainer) {
    // 1. Initial full skeleton mount
    const html = `
      <div id="react-titlebar-host"></div>

      <div class="flux-body-container" style="flex: 1; display: flex; position: relative; overflow: hidden; width: 100%;">
        <!-- React 左轨岛宿主：只做容器，绝不作为任何 innerHTML/outerHTML 的目标 -->
        <div id="react-leftrail-host" style="display: contents;"></div>

        ${renderMiddlePod({
          gatewayConnected: state.gatewayConnected,
          gatewayConnecting: state.gatewayConnecting,
          gatewayUrl: state.gatewayUrl,
          username: state.username,
          password: state.password,
          profileName: state.profileName,
          messages: state.messages,
          messagesPhase: state.messagesPhase,
          testStatus: state.testStatus,
          hasOlderMessages: state.hasOlderMessages,
          isLoadingOlder: state.isLoadingOlder,
          isStreaming: isStreamingActiveForCurrentSession(),
          dockHtml: state.gatewayConnected
            ? renderInputDock({
                selectedModel: state.selectedModel,
                models: state.availableModels,
                modelDetails: state.modelDetails,
                modelCatalog: state.modelCatalog,
                currentProvider: state.currentProvider,
                favoriteModels: state.favoriteModels,
                recentModels: state.recentModels,
                modelSearchQuery: state.modelSearchQuery,
                reasoningLevel: state.reasoningLevel,
                approvalMode: state.approvalMode,
                isStreaming: isStreamingActiveForCurrentSession(),
                disabled: !state.gatewayConnected,
                modelMenuOpen: state.modelMenuOpen,
                notice: state.dockNotice,
                activityStatus: isStreamingActiveForCurrentSession() ? state.agentActivityStatus : undefined,
                attachments: state.attachments,
                slashPopperOpen: state.slashPopperOpen,
                slashItems: state.slashItems,
                mentionPopperOpen: state.mentionPopperOpen,
                mentionItems: state.mentionItems,
                rollbackBanner: state.rollbackArmed
                  ? { removedCount: state.rollbackArmed.removedCount, anchorLabel: state.rollbackArmed.anchorLabel }
                  : null,
              })
            : '',
        })}

        ${renderInspectionPod({
          collapsed: state.inspectorCollapsed,
          activeTab: state.activeInspectorTab,
          gatewayConnected: state.gatewayConnected,
          isFullscreen: state.inspectorFullscreen,
          openFiles: state.openFiles,
          activeFilePath: state.activeFilePath,
          viewMode: state.fileViewMode,
          showLineNumbers: state.fileShowLineNumbers,
          wordWrap: state.fileWordWrap,
          searchOpen: state.fileSearchOpen,
          searchQuery: state.fileSearchQuery,
          artifacts: state.artifacts,
          browserFrame: state.browserFrame,
          gitDiffs: state.gitDiffs,
          memories: state.memories,
        })}
      </div>

      <!-- 设置中心 React 岛宿主：常驻挂载，关闭态由组件返回 null 表达，绝不 outerHTML 覆写 -->
      <div id="react-settings-host" style="display: contents;"></div>

      ${renderNewTaskModal({
        isOpen: state.isNewTaskModalOpen,
        profiles: state.profiles,
        projects: state.projects,
        selectedProfile: state.profileName || 'default',
        selectedProjectId: state.selectedNewTaskProjectId,
        initialType: state.newTaskModalTab,
      })}

      ${renderContextMenu(state.sessionContextMenu)}

      ${renderAgentProfileEditorModal({
        isOpen: state.isAgentEditorOpen,
        profile: state.editingAgentProfileName ? state.profiles.find((p) => p.name === state.editingAgentProfileName) : undefined,
        availableModels: state.availableModels,
      })}

      ${renderConfirmModal(state.confirmModal ? {
        isOpen: true,
        title: state.confirmModal.title,
        message: state.confirmModal.message,
        confirmLabel: state.confirmModal.confirmLabel,
        cancelLabel: state.confirmModal.cancelLabel,
        isDanger: state.confirmModal.isDanger,
      } : undefined)}
    `;

    root.innerHTML = html;
    mountReactShellComponents();
    lastMessagesSnapshot = currentMessagesSnapshot;
    lastInputDockSnapshot = currentDockSnapshot;
    applyStreamAnchor(streamAnchor, pinBottom);
  } else {
    // 2. High-performance Subtree/Section Isolation Update (Zero DOM thrashing on conversation stream)
    mountReactShellComponents();

    // 左轨由 React 岛自管子树，递增更新路径不再触碰其 DOM（不会重建滚动容器与输入框）。

    const inspectEl = (root.querySelector('#flux-inspector-pod') || root.querySelector('.flux-inspector-pod')) as HTMLElement | null;
    if (inspectEl) {
      if (lastInspectorCollapsed !== state.inspectorCollapsed) {
        if (!state.inspectorCollapsed) {
          // 折叠 ➔ 展开：构建新节点并实施两阶段挂载帧序，确保浏览器感知 0 到 420px 的 120ms 平滑展开
          inspectEl.outerHTML = renderInspectionPod({
            collapsed: false,
            activeTab: state.activeInspectorTab,
            gatewayConnected: state.gatewayConnected,
            isFullscreen: state.inspectorFullscreen,
            openFiles: state.openFiles,
            activeFilePath: state.activeFilePath,
            viewMode: state.fileViewMode,
            showLineNumbers: state.fileShowLineNumbers,
            wordWrap: state.fileWordWrap,
            searchOpen: state.fileSearchOpen,
            searchQuery: state.fileSearchQuery,
            artifacts: state.artifacts,
            browserFrame: state.browserFrame,
            gitDiffs: state.gitDiffs,
            memories: state.memories,
          });
          const nextInspectEl = root.querySelector('#flux-inspector-pod') as HTMLElement | null;
          if (nextInspectEl) {
            // 阶段 1：首帧强制折叠态 width: 0 并使容器立即可见
            nextInspectEl.classList.add('inspector-collapsed');
            nextInspectEl.style.display = 'flex';
            // 关键帧刷新：强制触发重绘，锁定 width: 0 为起始跃迁帧
            void nextInspectEl.offsetWidth;

            // 阶段 2：挂载控制器并移除折叠类，激发 120ms 平滑入场
            const controller = bindInspectorController(nextInspectEl);
            nextInspectEl.classList.remove('inspector-collapsed');
            void controller.enter();
          }
        } else {
          // 展开 ➔ 折叠：保持节点保活，触发 200ms 退场收缩，动画结束后 onExited 自动置为 display: none
          const controller = inspectorMotionController || bindInspectorController(inspectEl);
          inspectEl.classList.add('inspector-collapsed');
          void controller.exit();
        }
        lastInspectorCollapsed = state.inspectorCollapsed;
      } else if (!state.inspectorCollapsed) {
        // 展开状态下的内容增量更新（切换文件/Tab等）
        inspectEl.outerHTML = renderInspectionPod({
          collapsed: false,
          activeTab: state.activeInspectorTab,
          gatewayConnected: state.gatewayConnected,
          isFullscreen: state.inspectorFullscreen,
          openFiles: state.openFiles,
          activeFilePath: state.activeFilePath,
          viewMode: state.fileViewMode,
          showLineNumbers: state.fileShowLineNumbers,
          wordWrap: state.fileWordWrap,
          searchOpen: state.fileSearchOpen,
          searchQuery: state.fileSearchQuery,
          artifacts: state.artifacts,
          browserFrame: state.browserFrame,
          gitDiffs: state.gitDiffs,
          memories: state.memories,
        });
        const nextInspectEl = root.querySelector('#flux-inspector-pod') as HTMLElement | null;
        if (nextInspectEl) {
          bindInspectorController(nextInspectEl);
        }
      }
    }


    // Input Dock update (Zero DOM thrashing & caret preservation)
    // 【设计意图 (Why)】
    // 保护输入舱在非输入舱相关状态演变（如会话切换、侧边栏收缩、未读点刷新）时不被破坏性全量替换，
    // 保持真实的 <textarea> DOM 节点与 Blink Caret 选区拓扑 100% 物理稳定。
    // 【防范的历史坑 (Pitfall)】
    // 历史代码在每帧 render() 中无条件执行 existingDock.outerHTML = nextDockHtml，
    // 导致输入框被连根拔除重建，刚获得的焦点与输入法状态瞬间清空，引发“无光标无法输入文字”。
    // 【约束与规则 (Rules)】
    // 仅在 dockChanged（模型/流式/通知/禁用态变化）或不存在 existingDock 时执行替换，否则原生节点绝对不动。
    const existingDock = root.querySelector('.input-dock-container');
    const dockChanged = hasDockSnapshotChanged(lastInputDockSnapshot, currentDockSnapshot);
    // 【设计意图 (Why)】renderInputDock 会展开全 provider × 全模型的选择器 HTML；
    // 只有 dock 需要新增或内容指纹变化时才构建，避免每次 render（流式收敛、左轨交互）白付这笔字符串成本。
    const shouldBuildDock = state.gatewayConnected && (!existingDock || dockChanged);

    const nextDockHtml = shouldBuildDock
      ? renderInputDock({
          selectedModel: state.selectedModel,
          models: state.availableModels,
          modelDetails: state.modelDetails,
          modelCatalog: state.modelCatalog,
          currentProvider: state.currentProvider,
          favoriteModels: state.favoriteModels,
          recentModels: state.recentModels,
          modelSearchQuery: state.modelSearchQuery,
          reasoningLevel: state.reasoningLevel,
          approvalMode: state.approvalMode,
          isStreaming: isStreamingCurrent,
          disabled: !state.gatewayConnected,
          modelMenuOpen: state.modelMenuOpen,
          notice: state.dockNotice,
          activityStatus: isStreamingCurrent ? state.agentActivityStatus : undefined,
          attachments: state.attachments,
          slashPopperOpen: state.slashPopperOpen,
          slashItems: state.slashItems,
          mentionPopperOpen: state.mentionPopperOpen,
          mentionItems: state.mentionItems,
          rollbackBanner: state.rollbackArmed
            ? { removedCount: state.rollbackArmed.removedCount, anchorLabel: state.rollbackArmed.anchorLabel }
            : null,
        })
      : '';

    if (existingDock) {
      if (!state.gatewayConnected) {
        existingDock.remove();
        lastInputDockSnapshot = null;
      } else if (dockChanged && nextDockHtml) {
        existingDock.outerHTML = nextDockHtml;
        lastInputDockSnapshot = currentDockSnapshot;
      }
    } else if (nextDockHtml) {
      const middlePod = root.querySelector('.flux-middle-pod');
      if (middlePod) middlePod.insertAdjacentHTML('beforeend', nextDockHtml);
      lastInputDockSnapshot = currentDockSnapshot;
    }

    // 设置中心由 React 岛自管子树（见 mountReactSettings），此处不再做任何 DOM 替换。

    // New Task & Group Modal
    const taskModalRoot = document.getElementById('new-task-modal-overlay');
    const nextTaskModalHtml = renderNewTaskModal({
      isOpen: state.isNewTaskModalOpen,
      profiles: state.profiles,
      projects: state.projects,
      selectedProfile: state.profileName || 'default',
      selectedProjectId: state.selectedNewTaskProjectId,
      initialType: state.newTaskModalTab,
    });
    if (taskModalRoot) {
      if (nextTaskModalHtml) {
        taskModalRoot.outerHTML = nextTaskModalHtml;
      } else {
        taskModalRoot.remove();
      }
    } else if (nextTaskModalHtml) {
      root.insertAdjacentHTML('beforeend', nextTaskModalHtml);
    }

    // Agent Profile Editor Modal
    const agentEditorRoot = document.getElementById('agent-profile-editor-backdrop');
    const nextAgentEditorHtml = renderAgentProfileEditorModal({
      isOpen: state.isAgentEditorOpen,
      profile: state.editingAgentProfileName ? state.profiles.find((p) => p.name === state.editingAgentProfileName) : undefined,
      availableModels: state.availableModels,
    });
    if (agentEditorRoot) {
      if (nextAgentEditorHtml) {
        agentEditorRoot.outerHTML = nextAgentEditorHtml;
      } else {
        agentEditorRoot.remove();
      }
    } else if (nextAgentEditorHtml) {
      root.insertAdjacentHTML('beforeend', nextAgentEditorHtml);
    }

    // Confirm Modal
    const confirmModalRoot = document.getElementById('flux-confirm-modal-overlay');
    const nextConfirmModalHtml = renderConfirmModal(state.confirmModal ? {
      isOpen: true,
      title: state.confirmModal.title,
      message: state.confirmModal.message,
      confirmLabel: state.confirmModal.confirmLabel,
      cancelLabel: state.confirmModal.cancelLabel,
      isDanger: state.confirmModal.isDanger,
    } : undefined);
    if (confirmModalRoot) {
      if (nextConfirmModalHtml) {
        confirmModalRoot.outerHTML = nextConfirmModalHtml;
      } else {
        confirmModalRoot.remove();
      }
    } else if (nextConfirmModalHtml) {
      root.insertAdjacentHTML('beforeend', nextConfirmModalHtml);
    }

    // Context Menu
    const existingMenu = document.getElementById('session-context-menu');
    const nextMenuHtml = renderContextMenu(state.sessionContextMenu);
    if (existingMenu) {
      if (nextMenuHtml) existingMenu.outerHTML = nextMenuHtml;
      else existingMenu.remove();
    } else if (nextMenuHtml) {
      root.insertAdjacentHTML('beforeend', nextMenuHtml);
    }

    // Conversation Stream: React 列表已挂载时只更新列表，不重建 canvas（避免销毁 React root）
    const activeStream = document.getElementById('conversation-stream');
    if (activeStream && messagesChanged) {
      const reactHost = document.getElementById('react-message-list-host');
      // 【骨架也走 React 宿主 (Rules)】历史未到达时同样由宿主渲染骨架，
      // 否则 loading 相位会被模板的欢迎空态抢走，界面又对用户断言"没有对话"。
      const canUseReactList = state.gatewayConnected && (state.messages.length > 0 || state.messagesPhase === 'loading');
      if (reactHost && canUseReactList) {
        /**
         * 【结构变化必须强制推送 (Rules)】行高锁定会改写 `virtualHeightPx` 与 `contentOffsetPx`，
         *   但挂载窗口的消息 id 可能一个都没变（首屏 120 条原地不动）。
         *   若不强制推送，视口会一直停在旧口径的 scrollHeight 上，读者看到的是会话中部。
         */
        syncReactMessageList(structureDirty);
        canvasStructureDirty = false;
        applyStreamAnchor(streamAnchor, pinBottom);
        lastMessagesSnapshot = currentMessagesSnapshot;
      } else {
        activeStream.innerHTML = renderConversationCanvas({
          gatewayConnected: state.gatewayConnected,
          gatewayConnecting: state.gatewayConnecting,
          gatewayUrl: state.gatewayUrl,
          username: state.username,
          password: state.password,
          profileName: state.profileName,
          messages: state.messages,
          messagesPhase: state.messagesPhase,
          testStatus: state.testStatus,
          hasOlderMessages: state.hasOlderMessages,
          isLoadingOlder: state.isLoadingOlder,
          isStreaming: isStreamingActiveForCurrentSession(),
          sideAgentCapsules: state.sideAgentCapsules,
        });
        canvasStructureDirty = false;
        syncReactMessageList(true);
        applyStreamAnchor(streamAnchor, pinBottom);
        lastMessagesSnapshot = currentMessagesSnapshot;
      }
    }
  }

  // Restore the composer draft, its caret and its focus
  const newInput = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
  if (newInput) {
    if (draftText && newInput.value !== draftText) newInput.value = draftText;
    if (inputHadFocus) {
      newInput.focus({ preventScroll: true });
      const max = newInput.value.length;
      newInput.setSelectionRange(Math.min(caretStart, max), Math.min(caretEnd, max));
    }
  }

  bindEvents();

  // 恢复非 Dock 输入框的焦点与光标位置（防止设置弹窗打字被打断）
  if (activeInputId && activeInputId !== 'dock-prompt-input') {
    const restoredEl = document.getElementById(activeInputId) as HTMLInputElement | null;
    if (restoredEl) {
      if (typeof activeInputVal === 'string' && restoredEl.value !== activeInputVal) restoredEl.value = activeInputVal;
      restoredEl.focus({ preventScroll: true });
      if (activeCaretStart !== null && activeCaretEnd !== null) {
        // gate-degrade: 元素不支持 selectionRange 时的安全回落，降级为默认聚焦
        try { restoredEl.setSelectionRange(activeCaretStart, activeCaretEnd); } catch { /* 忽略不支持选区的输入类型 */ }
      }
    }
  }

  // Popper 增量同步：只替换 #composer-popper-mount 子树，绝不重建 dock / textarea
  syncComposerPoppers();

  if (messagesChanged) {
    requestAnimationFrame(() => {
      if (pinBottom) {
        const stream = document.getElementById('conversation-stream');
        if (stream) stream.scrollTop = stream.scrollHeight;
      } else {
        stabilizeStreamAnchor(streamAnchor);
      }
    });
  }

  logRender.debug('render', {
    ms: Math.round((performance.now() - renderStartedAt) * 10) / 10,
    messages: state.messages.length,
    messagesChanged,
    session: state.activeSessionId || '(none)',
    forcedBottom,
    pinBottom,
    anchor: streamAnchor.id,
  });
}

/**
 * 统一处理对话流或工具调用中的文件/超链接点击预览与下载挂载
 * 【设计意图 (Why)】
 * 用户点击对话流中的文件路径（无论来自工具胶囊还是正文中的行内代码/Markdown链接）或 HTTP 链接时，
 * 统一驱动右侧 Inspection Pod 自动展开，并根据文件类型（HTML 原型、PNG/JPG 截图、代码/Diff、网页）
 * 匹配最佳呈现模式并加载最新内容，同时保证顶部下载工具栏可以一键保存该文件。
 * 【防范的陷阱 (Pitfall)】
 * 1. HTML 原型文档必须默认启用 rendered 视图，避免用户看到一堆 HTML 源码而非设计界面；
 * 2. 图片格式支持 data:image/ 或 HTTP 直接渲染，规避 utf8 二进制乱码；
 * 3. 避免会话流重绘销毁导致的 DOM 重复绑定失效，配合事件委托机制实现无感响应。
 * 【约束与规则 (Rules)】
 * 更新 openFiles 与 artifacts 状态机，维护活动标签索引，严格保持单向数据流。
 */
async function handleOpenFilePreview(filePath: string, previewUrl?: string): Promise<void> {
  const target = (filePath || previewUrl || '').trim();
  if (!target) return;

  const isHttp = target.startsWith('http://') || target.startsWith('https://');
  const ext = (target.split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext);
  const isHtml = ext === 'html' || ext === 'htm';

  // 1. 自动展开右侧 Inspection Pod
  state.inspectorCollapsed = false;
  state.activeInspectorTab = 'preview';
  state.activeFilePath = target;

  // HTML 单文件原型默认开启富渲染模式，所见即所得
  if (isHtml) {
    state.fileViewMode = 'rendered';
  }

  // 2. 统一调用底层通用文件解析服务组件 (resolveFileContent)
  const initialResolved = await resolveFileContent(target, {
    platformBridge: desktopApi,
    gatewayClient,
    gatewayUrl: state.gatewayUrl,
    messages: state.messages,
    fallbackNotice: `// ${target}\n\n${t('inspector.loadingNotice')}`,
  });

  // 3. 挂载到 state.openFiles
  let existingOpenFile = state.openFiles.find((f) => f.path === target);
  if (!existingOpenFile) {
    existingOpenFile = {
      id: `file-${Date.now()}`,
      path: target,
      content: initialResolved.content,
    };
    state.openFiles.push(existingOpenFile);
  } else {
    existingOpenFile.content = initialResolved.content;
  }

  // 4. 挂载到 state.artifacts
  let existing = state.artifacts.find((a) => a.name === target);
  if (!existing) {
    existing = {
      id: `art-${Date.now()}`,
      name: target,
      type: isHttp ? 'LINK' : 'FILE',
      size: '',
      preview: initialResolved.content,
    };
    state.artifacts.unshift(existing);
  } else {
    existing.preview = initialResolved.content;
    state.artifacts = [existing, ...state.artifacts.filter((a) => a.name !== target)];
  }

  render();

  // 5. 若首次未从缓存或本地读取到，进行异步最终获取并刷新
  if (initialResolved.source === 'fallback') {
    const finalResolved = await resolveFileContent(target, {
      platformBridge: desktopApi,
      gatewayClient,
      gatewayUrl: state.gatewayUrl,
      messages: state.messages,
      fallbackNotice: `// ${target}\n\n${t('inspector.remoteNotice')}`,
    });

    if (existing) existing.preview = finalResolved.content;
    if (existingOpenFile) existingOpenFile.content = finalResolved.content;
    render();
  }
}

function bindEvents(): void {
  // Titlebar controls are bound through React props at mount time.

  const toggleInspectorClose = document.getElementById('toggle-inspector-close-btn');
  const toggleInspectorFullscreen = document.getElementById('toggle-inspector-fullscreen-btn');
  if (toggleInspectorClose) {
    toggleInspectorClose.onclick = () => {
      state.inspectorCollapsed = true;
      state.inspectorFullscreen = false;
      render();
    };
  }
  if (toggleInspectorFullscreen) {
    toggleInspectorFullscreen.onclick = () => {
      state.inspectorFullscreen = !state.inspectorFullscreen;
      render();
    };
  }

  // --- OpenChamber Style Inspector Tabs & Toolbar Event Bindings ---
  // 1. File Tab Switch
  document.querySelectorAll<HTMLElement>('.inspector-file-tab').forEach((tabEl) => {
    tabEl.onclick = (e) => {
      // Ignore if clicking close button
      if ((e.target as HTMLElement).closest('.btn-close-file-tab')) return;
      const targetPath = tabEl.dataset.fileTab;
      if (targetPath && targetPath !== state.activeFilePath) {
        state.activeFilePath = targetPath;
        render();
      }
    };
  });

  // 2. File Tab Close
  document.querySelectorAll<HTMLElement>('.btn-close-file-tab').forEach((btnEl) => {
    btnEl.onclick = (e) => {
      e.stopPropagation();
      const targetPath = btnEl.dataset.closeTab;
      if (!targetPath) return;

      const idx = state.openFiles.findIndex((f) => f.path === targetPath);
      if (idx !== -1) {
        state.openFiles.splice(idx, 1);
        // Also remove from artifacts if matching
        state.artifacts = state.artifacts.filter((a) => a.name !== targetPath);
        if (state.activeFilePath === targetPath) {
          state.activeFilePath = state.openFiles[0]?.path || '';
        }
        if (state.openFiles.length === 0) {
          state.inspectorCollapsed = true;
          state.inspectorFullscreen = false;
        }
        render();
      }
    };
  });

  // 3. Toolbar: View Mode Toggle (Raw Code vs Rich Rendered)
  const btnToggleMode = document.getElementById('btn-file-toggle-mode');
  if (btnToggleMode) {
    btnToggleMode.onclick = () => {
      state.fileViewMode = state.fileViewMode === 'rendered' ? 'raw' : 'rendered';
      render();
    };
  }

  // 4. Toolbar: Search Toggle
  const btnSearch = document.getElementById('btn-file-search');
  if (btnSearch) {
    btnSearch.onclick = () => {
      state.fileSearchOpen = !state.fileSearchOpen;
      if (!state.fileSearchOpen) {
        state.fileSearchQuery = '';
      }
      render();
      if (state.fileSearchOpen) {
        setTimeout(() => {
          document.getElementById('inspector-search-input')?.focus();
        }, 50);
      }
    };
  }

  const btnCloseSearch = document.getElementById('btn-close-search');
  if (btnCloseSearch) {
    btnCloseSearch.onclick = () => {
      state.fileSearchOpen = false;
      state.fileSearchQuery = '';
      render();
    };
  }

  const inspectorSearchInput = document.getElementById('inspector-search-input') as HTMLInputElement | null;
  if (inspectorSearchInput) {
    inspectorSearchInput.oninput = () => {
      state.fileSearchQuery = inspectorSearchInput.value;
      render();
      // Keep focus on input after render
      const freshInput = document.getElementById('inspector-search-input') as HTMLInputElement | null;
      if (freshInput) {
        freshInput.focus();
        freshInput.selectionStart = freshInput.selectionEnd = freshInput.value.length;
      }
    };
  }

  // 5. Toolbar: Line Numbers Toggle
  const btnToggleLineNo = document.getElementById('btn-file-toggle-lineno');
  if (btnToggleLineNo) {
    btnToggleLineNo.onclick = () => {
      state.fileShowLineNumbers = !state.fileShowLineNumbers;
      render();
    };
  }

  // 6. Toolbar: Open in Default App (System Default Viewer/Editor with fallback)
  const btnOpenExternal = document.getElementById('btn-file-open-external');
  if (btnOpenExternal) {
    btnOpenExternal.onclick = () => {
      const activeFile = state.openFiles.find((f) => f.path === state.activeFilePath) || state.openFiles[0];
      if (activeFile) {
        if (desktopApi?.openExternal) {
          void desktopApi.openExternal(activeFile.path, activeFile.content);
          btnOpenExternal.style.color = 'var(--accent)';
          setTimeout(() => {
            btnOpenExternal.style.color = '';
          }, 1000);
        } else {
          void navigator.clipboard.writeText(activeFile.path);
        }
      }
    };
  }

  // 7. Toolbar: Copy Full Content (Silent Clipboard Copy, no dockNotice pollution)
  const btnCopyContent = document.getElementById('btn-file-copy-content');
  if (btnCopyContent) {
    btnCopyContent.onclick = async () => {
      const activeFile = state.openFiles.find((f) => f.path === state.activeFilePath) || state.openFiles[0];
      if (activeFile) {
        await safeCopyText(activeFile.content);
        // Visual button feedback instead of polluting dockNotice
        btnCopyContent.style.color = 'var(--accent)';
        setTimeout(() => {
          btnCopyContent.style.color = '';
        }, 1200);
      }
    };
  }

  // 11. Toolbar: Copy Path
  const btnCopyPath = document.getElementById('btn-file-copy-path');
  if (btnCopyPath) {
    btnCopyPath.onclick = async () => {
      const activeFile = state.openFiles.find((f) => f.path === state.activeFilePath) || state.openFiles[0];
      if (activeFile) {
        await safeCopyText(activeFile.path);
        btnCopyPath.style.color = 'var(--accent)';
        setTimeout(() => {
          btnCopyPath.style.color = '';
        }, 1200);
      }
    };
  }

  // 12. Toolbar: Download / Save File (Enhanced for Native File Dialog & Binary Image Support)
  const btnDownload = document.getElementById('btn-file-download');
  if (btnDownload) {
    btnDownload.onclick = async () => {
      const activeFile = state.openFiles.find((f) => f.path === state.activeFilePath) || state.openFiles[0];
      if (!activeFile) return;

      const rawFileName = activeFile.path.split(/[/\\]/).pop() || 'download.txt';
      const isDataUrl = activeFile.content.startsWith('data:');
      const isHttp = activeFile.path.startsWith('http://') || activeFile.path.startsWith('https://');

      // 1. 优先调用桌面端原生 SaveDialog 另存为（支持原生文件选择、大文件二进制流式写入与远程 URL 直落）
      if (desktopApi?.saveFile) {
        try {
          const downloadPayload = isHttp
            ? activeFile.path
            : activeFile.content.includes(t('inspector.remoteNotice')) && state.gatewayUrl
            ? `${state.gatewayUrl}/api/files/download?path=${encodeURIComponent(activeFile.path)}`
            : activeFile.content;

          const res = await desktopApi.saveFile({
            fileName: rawFileName,
            content: downloadPayload,
            isBase64: isDataUrl,
          });
          if (res.success) {
            btnDownload.style.color = 'var(--accent)';
            setTimeout(() => {
              btnDownload.style.color = '';
            }, 1200);
            return;
          }
          if (res.canceled) return;
        } catch (e) {
          console.warn('[Desktop Save] Native save dialog failed, fallback to blob:', e);
        }
      }

      // 2. Web 浏览器或降级：Blob / Data URL 模拟下载
      if (isDataUrl) {
        const a = document.createElement('a');
        a.href = activeFile.content;
        a.download = rawFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        const ext = (rawFileName.split('.').pop() || '').toLowerCase();
        let mime = 'text/plain;charset=utf-8';
        if (ext === 'html' || ext === 'htm') mime = 'text/html;charset=utf-8';
        else if (ext === 'json') mime = 'application/json;charset=utf-8';
        else if (ext === 'md' || ext === 'markdown') mime = 'text/markdown;charset=utf-8';

        const blob = new Blob([activeFile.content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = rawFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      btnDownload.style.color = 'var(--accent)';
      setTimeout(() => {
        btnDownload.style.color = '';
      }, 1200);
    };
  }

  // 设置中心已由 React 岛接管：导航、主题、字体、语言、连接表单与提供商密钥全部走
  // mountSettingsModal 的 props/回调。此处严禁再注册第二套 DOM 事件，
  // 否则同一控件会同时存在模板 onclick 与 React 合成事件，产生双重派发。

  // 左轨（微轨 + 抽屉）已由 React 岛接管：搜索、手风琴、行点击、右键菜单、行内重命名、
  // 底部快捷入口与拖拽全部走 mountLeftRail 的 props/回调，这里严禁再注册第二套事件，
  // 否则同一元素会同时存在模板 onclick 与 React 合成事件，产生双重派发。

  // File attach button
  const attachBtn = document.getElementById('dock-attach-file-btn');
  if (attachBtn) {
    attachBtn.onclick = async () => {
      if (desktopApi?.openFileDialog) {
        const paths = await desktopApi.openFileDialog();
        if (paths && paths.length > 0) {
          const input = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
          if (input) {
            input.value += (input.value ? '\n' : '') + `[附加文件: ${paths.join(', ')}]`;
          }
        }
      }
    };
  }

  // Onboarding Live Inputs & Double Binding
  const obUrlInput = document.getElementById('onboarding-gateway-url') as HTMLInputElement | null;
  if (obUrlInput) {
    obUrlInput.oninput = () => {
      state.gatewayUrl = obUrlInput.value.trim();
      localStorage.setItem('hermes_flux_gateway_url', state.gatewayUrl);
      localStorage.setItem('hermes_aura_gateway_url', state.gatewayUrl);
    };
  }
  const obUserInput = document.getElementById('onboarding-username') as HTMLInputElement | null;
  if (obUserInput) {
    obUserInput.oninput = () => {
      state.username = obUserInput.value;
      localStorage.setItem('hermes_flux_username', state.username);
      localStorage.setItem('hermes_aura_username', state.username);
    };
  }
  const obPassInput = document.getElementById('onboarding-password') as HTMLInputElement | null;
  if (obPassInput) {
    obPassInput.oninput = () => {
      state.password = obPassInput.value;
      localStorage.setItem('hermes_flux_password', state.password);
      localStorage.setItem('hermes_aura_password', state.password);
    };
  }
  const obProfileInput = document.getElementById('onboarding-profile-name') as HTMLInputElement | null;
  if (obProfileInput) {
    obProfileInput.oninput = () => {
      state.profileName = obProfileInput.value || 'default';
      localStorage.setItem('hermes_flux_profile', state.profileName);
      localStorage.setItem('hermes_aura_profile', state.profileName);
    };
  }

  // Onboarding Buttons
  const onboardingTestBtn = document.getElementById('btn-test-connection');
  if (onboardingTestBtn) {
    onboardingTestBtn.onclick = async () => {
      const urlInput = ((document.getElementById('onboarding-gateway-url') as HTMLInputElement)?.value || '').trim();
      const userInput = (document.getElementById('onboarding-username') as HTMLInputElement)?.value;
      const passInput = (document.getElementById('onboarding-password') as HTMLInputElement)?.value;
      const profileInput = (document.getElementById('onboarding-profile-name') as HTMLInputElement)?.value;

      if (!urlInput) {
        state.testStatus = { ok: false, message: t('gateway.urlRequired'), latency: 0 };
        render();
        return;
      }
      state.gatewayUrl = urlInput;
      localStorage.setItem('hermes_flux_gateway_url', urlInput);
      localStorage.setItem('hermes_aura_gateway_url', urlInput);
      if (userInput !== undefined) {
        state.username = userInput;
        localStorage.setItem('hermes_flux_username', userInput);
        localStorage.setItem('hermes_aura_username', userInput);
      }
      if (passInput !== undefined) {
        state.password = passInput;
        localStorage.setItem('hermes_flux_password', passInput);
        localStorage.setItem('hermes_aura_password', passInput);
      }
      if (profileInput !== undefined) {
        state.profileName = profileInput || 'default';
        localStorage.setItem('hermes_flux_profile', state.profileName);
        localStorage.setItem('hermes_aura_profile', state.profileName);
      }

      onboardingTestBtn.innerText = '正在测试...';
      const res = await testConnection(urlInput, userInput, passInput);
      state.testStatus = res;
      onboardingTestBtn.innerText = '连通性测试';
      render();
    };
  }

  const onboardingSaveBtn = document.getElementById('btn-save-and-connect');
  if (onboardingSaveBtn) {
    onboardingSaveBtn.onclick = async () => {
      const urlInput = ((document.getElementById('onboarding-gateway-url') as HTMLInputElement)?.value || '').trim();
      if (!urlInput) {
        state.testStatus = { ok: false, message: t('gateway.urlRequired'), latency: 0 };
        render();
        return;
      }
      state.gatewayUrl = urlInput;
      state.username = (document.getElementById('onboarding-username') as HTMLInputElement)?.value || '';
      state.password = (document.getElementById('onboarding-password') as HTMLInputElement)?.value || '';
      state.profileName = (document.getElementById('onboarding-profile-name') as HTMLInputElement)?.value || 'default';
      connect();
    };
  }

  // Session items & Context Menu
  // PR-3d：#new-chat-btn 旧 DOM 死绑定清除——React 岛经 onNewChat 回调接管，此处再留一套
  // 就是第二个写入口（5470 注释已声明迁移完毕，此段是漏删的残肢）。

  // New Task & Group Modal Events
  const closeTaskModalBtn = document.getElementById('btn-close-task-modal');
  const cancelTaskModalBtn = document.getElementById('btn-cancel-task-modal');
  if (closeTaskModalBtn) closeTaskModalBtn.onclick = () => { state.isNewTaskModalOpen = false; render(); };
  if (cancelTaskModalBtn) cancelTaskModalBtn.onclick = () => { state.isNewTaskModalOpen = false; render(); };

  // Agent Profile Editor Modal Events
  const closeAgentEditorBtn = document.getElementById('btn-close-agent-editor');
  const cancelAgentEditorBtn = document.getElementById('btn-cancel-agent-editor');
  const agentEditorBackdrop = document.getElementById('agent-profile-editor-backdrop');
  const saveAgentEditorBtn = document.getElementById('btn-save-agent-editor');

  const closeAgentEditor = () => {
    state.isAgentEditorOpen = false;
    state.editingAgentProfileName = undefined;
    render();
  };

  if (closeAgentEditorBtn) closeAgentEditorBtn.onclick = closeAgentEditor;
  if (cancelAgentEditorBtn) cancelAgentEditorBtn.onclick = closeAgentEditor;
  if (agentEditorBackdrop) {
    agentEditorBackdrop.onclick = (e) => {
      if (e.target === agentEditorBackdrop) closeAgentEditor();
    };
  }

  if (saveAgentEditorBtn) {
    saveAgentEditorBtn.onclick = async () => {
      const targetName = state.editingAgentProfileName;
      if (!targetName) return;
      const targetProfile = state.profiles.find((p) => p.name === targetName);
      if (!targetProfile) return;

      const nameInput = document.getElementById('agent-editor-display-name') as HTMLInputElement | null;
      const descInput = document.getElementById('agent-editor-desc') as HTMLTextAreaElement | null;
      const modelSelect = document.getElementById('agent-editor-model-select') as HTMLSelectElement | null;
      const promptInput = document.getElementById('agent-editor-prompt') as HTMLTextAreaElement | null;

      const newDisplayName = nameInput?.value?.trim() || targetProfile.name;
      const newDesc = descInput?.value?.trim() || '';
      const newModel = modelSelect?.value?.trim() || '';
      const newPrompt = promptInput?.value?.trim() || '';

      // 1. 本地状态即刻响应更新
      targetProfile.displayName = newDisplayName;
      targetProfile.description = newDesc;
      targetProfile.model = newModel;

      // 2. 若底层网关在线，异步持久化至网关配置档
      if (gatewayClient) {
        void profileService.configureProfile(
          targetProfile.name,
          {
            displayName: newDisplayName,
            description: newDesc,
            model: newModel || undefined,
            soulContent: newPrompt || undefined,
          },
          gatewayClient
        ).catch((err) => {
          console.warn('[Flux] configureProfile failed:', err);
        });
      }

      showToast(t('agent.saveSuccess'));
      closeAgentEditor();
    };
  }

  // Confirm Modal Events
  const confirmModalOkBtn = document.getElementById('btn-confirm-modal-ok');
  const confirmModalCancelBtn = document.getElementById('btn-confirm-modal-cancel');
  const confirmModalCloseBtn = document.getElementById('btn-confirm-modal-close');
  const confirmModalOverlay = document.getElementById('flux-confirm-modal-overlay');

  const closeConfirmModal = (action: 'ok' | 'cancel') => {
    const modal = state.confirmModal;
    state.confirmModal = undefined;
    render();
    if (action === 'ok' && modal?.onConfirm) {
      void modal.onConfirm();
    } else if (action === 'cancel') {
      if (modal?.onCancel) modal.onCancel();
      else restoreComposerFocus();
    }
  };

  if (confirmModalOkBtn) confirmModalOkBtn.onclick = () => closeConfirmModal('ok');
  if (confirmModalCancelBtn) confirmModalCancelBtn.onclick = () => closeConfirmModal('cancel');
  if (confirmModalCloseBtn) confirmModalCloseBtn.onclick = () => closeConfirmModal('cancel');
  if (confirmModalOverlay) {
    confirmModalOverlay.onclick = (e) => {
      if (e.target === confirmModalOverlay) closeConfirmModal('cancel');
    };
  }

  let activeModalType: 'solo' | 'group' = state.newTaskModalTab;
  const modalTabSolo = document.getElementById('modal-tab-solo');
  const modalTabGroup = document.getElementById('modal-tab-group');
  const secSolo = document.getElementById('modal-section-solo-agent');
  const secGroup = document.getElementById('modal-section-group-members');

  if (modalTabSolo && modalTabGroup) {
    modalTabSolo.onclick = () => {
      activeModalType = 'solo'; state.newTaskModalTab = 'solo';
      modalTabSolo.classList.add('active');
      modalTabSolo.style.background = 'var(--bg-card)';
      modalTabSolo.style.borderColor = 'var(--border-medium)';
      modalTabSolo.style.color = 'var(--text-main)';
      modalTabGroup.classList.remove('active');
      modalTabGroup.style.background = 'transparent';
      modalTabGroup.style.borderColor = 'transparent';
      modalTabGroup.style.color = 'var(--text-muted)';
      if (secSolo) secSolo.style.display = 'flex';
      if (secGroup) secGroup.style.display = 'none';
    };
    modalTabGroup.onclick = () => {
      activeModalType = 'group'; state.newTaskModalTab = 'group';
      modalTabGroup.classList.add('active');
      modalTabGroup.style.background = 'var(--bg-card)';
      modalTabGroup.style.borderColor = 'var(--border-medium)';
      modalTabGroup.style.color = 'var(--text-main)';
      modalTabSolo.classList.remove('active');
      modalTabSolo.style.background = 'transparent';
      modalTabSolo.style.borderColor = 'transparent';
      modalTabSolo.style.color = 'var(--text-muted)';
      if (secSolo) secSolo.style.display = 'none';
      if (secGroup) secGroup.style.display = 'flex';
    };
  }

  let selectedModalAgent = state.profileName || 'default';
  document.querySelectorAll('.modal-agent-option').forEach((opt) => {
    (opt as HTMLElement).onclick = () => {
      document.querySelectorAll('.modal-agent-option').forEach((o) => {
        (o as HTMLElement).classList.remove('selected');
        (o as HTMLElement).style.borderColor = 'var(--border-subtle)';
        (o as HTMLElement).style.background = 'var(--bg-panel)';
      });
      (opt as HTMLElement).classList.add('selected');
      (opt as HTMLElement).style.borderColor = 'var(--accent)';
      (opt as HTMLElement).style.background = 'var(--accent-subtle)';
      selectedModalAgent = (opt as HTMLElement).dataset.profile || 'default';
    };
  });

  const submitTaskModalBtn = document.getElementById('btn-submit-task-modal');
  if (submitTaskModalBtn) {
    submitTaskModalBtn.onclick = async () => {
      const titleInput = (document.getElementById('modal-task-title-input') as HTMLInputElement)?.value.trim();
      const projSelect = (document.getElementById('modal-project-select') as HTMLSelectElement)?.value;
      state.isNewTaskModalOpen = false;

      if (activeModalType === 'solo') {
        await createNewSession({
          profile: selectedModalAgent,
          projectId: projSelect || undefined,
          title: titleInput || t('chat.defaultTaskTitle'),
        });
      } else {
        const checkedMembers: string[] = [];
        document.querySelectorAll('.modal-group-member-checkbox:checked').forEach((cb) => {
          checkedMembers.push((cb as HTMLInputElement).value);
        });
        const members = checkedMembers.length >= 2 ? checkedMembers : [selectedModalAgent, 'default'];
        try {
          const room = await groupRoomStore.createRoom(titleInput || t('chat.defaultGroupTitle'), members, gatewayClient!);
          await fetchGroupRooms();
          const roomId = room.room_id || '';
          if (roomId) await openGroupRoom(roomId);
        } catch (err) {
          state.dockNotice = t('dock.createGroupFailed', { error: describeRpcError(err) });
          render();
        }
      }
    };
  }

  // 以下左轨（微轨 + 抽屉）交互已迁移至 React 岛（mountLeftRail）：
  // 标签切换、手风琴折叠、展示更多、行点击、右键菜单、行内重命名与底部快捷入口
  // 全部由 React props 驱动，模板侧不得再注册同名 onclick，避免事件双派发。

  // Handle Context Menu Actions
  document.querySelectorAll('#session-context-menu .ctx-item').forEach((btn) => {
    (btn as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      const action = (btn as HTMLElement).dataset.action;
      const ctx = state.sessionContextMenu;
      state.sessionContextMenu = undefined;
      render();

      if (!ctx) return;
      if (action === 'bot-chat') {
        void openBotChat(ctx.targetId);
      } else if (action === 'bot-edit') {
        state.editingAgentProfileName = ctx.targetId;
        state.isAgentEditorOpen = true;
        render();

        // 【关键修复点】：右键点击查看/编辑资料瞬间，立即强制向网关远端同步最新的 Profile 数据并重绘弹窗
        if (gatewayClient) {
          void (async () => {
            try {
              const freshProfiles = await gatewayClient.listProfiles();
              if (Array.isArray(freshProfiles) && freshProfiles.length > 0) {
                state.profiles = freshProfiles;
                syncProfileLastMessages();
                if (state.isAgentEditorOpen && state.editingAgentProfileName === ctx.targetId) {
                  render();
                }
              }
            } catch (err) {
              console.warn('[Flux] Immediate fetch profile on open editor failed:', err);
            }
          })();
        }
      } else if (action === 'group-rename') {
        state.editingGroupRoomId = ctx.targetId;
        render();
        setTimeout(() => {
          const inputEl = document.getElementById(`rail-group-rename-input-${ctx.targetId}`) as HTMLInputElement | null;
          if (inputEl) {
            inputEl.focus();
            inputEl.select();
          }
        }, 40);
      } else if (action === 'disband-group') {
        state.confirmModal = {
          title: t('ctx.disbandGroupTitle'),
          message: t('ctx.confirmDisbandGroup', { name: ctx.targetName }),
          confirmLabel: t('ctx.disbandGroup'),
          cancelLabel: t('common.cancel'),
          isDanger: true,
          onConfirm: () => {
            restoreComposerFocus();
            if (gatewayClient) {
              void groupRoomStore.disbandRoom(ctx.targetId, gatewayClient).then(async () => {
                await fetchGroupRooms();
                if (state.activeFocus.type === 'group' && state.activeFocus.roomId === ctx.targetId) {
                  if (state.sessions.length > 0) void selectSession(state.sessions[0].id);
                }
              }).catch((err) => {
                state.dockNotice = t('ctx.disbandGroupFailed', { error: describeRpcError(err) });
                render();
              });
            }
          },
          onCancel: () => {
            restoreComposerFocus();
          },
        };
        render();
      } else if (action === 'rename') {
        void renameSession(ctx.targetId, ctx.targetName);
      } else if (action === 'copy-id') {
        void copySessionId(ctx.targetId);
      } else if (action === 'pin') {
        void pinSession(ctx.targetId);
      } else if (action === 'export') {
        void exportMarkdown(ctx.targetId);
      } else if (action === 'archive') {
        void archiveSession(ctx.targetId);
      } else if (action === 'delete') {
        state.confirmModal = {
          title: t('ctx.deleteSessionTitle'),
          message: t('ctx.confirmDeleteSession', { name: ctx.targetName || ctx.targetId }),
          confirmLabel: t('ctx.delete'),
          cancelLabel: t('common.cancel'),
          isDanger: true,
          onConfirm: () => {
            restoreComposerFocus();
            void deleteSession(ctx.targetId);
          },
          onCancel: () => {
            restoreComposerFocus();
          },
        };
        render();
      }
    };
  });

  document.querySelectorAll('.btn-delete-session').forEach((btn) => {
    (btn as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id;
      if (!id) return;
      const targetSess = state.sessions.find((s) => s.id === id);
      state.confirmModal = {
        title: t('ctx.deleteSessionTitle'),
        message: t('ctx.confirmDeleteSession', { name: targetSess?.title || id }),
        confirmLabel: t('ctx.delete'),
        cancelLabel: t('common.cancel'),
        isDanger: true,
        onConfirm: () => {
          restoreComposerFocus();
          void deleteSession(id);
        },
        onCancel: () => {
          restoreComposerFocus();
        },
      };
      render();
    };
  });

  // Inspector Tabs
  document.querySelectorAll('.vertical-tab-item').forEach((tab) => {
    (tab as HTMLElement).onclick = () => {
      const key = (tab as HTMLElement).dataset.tab as InspectorTab;
      if (key) {
        state.activeInspectorTab = key;
        render();
      }
    };
  });

  // Model Selector — visibility is application state, never raw DOM poking: every
  // click handler ends in render(), which rebuilds the subtree from state.
  const modelBtn = document.getElementById('dock-model-selector-btn');
  const refreshModelBtn = document.getElementById('btn-refresh-models');

  if (refreshModelBtn) {
    refreshModelBtn.onclick = (e) => {
      e.stopPropagation();
      void fetchModelOptions();
    };
  }

  if (modelBtn) {
    modelBtn.onclick = (e) => {
      e.stopPropagation();
      const dropdown = document.getElementById('dock-model-dropdown');
      if (!dropdown) return;
      state.modelMenuOpen = !state.modelMenuOpen;
      dropdown.style.display = state.modelMenuOpen ? 'block' : 'none';
      if (state.modelMenuOpen) {
        if (state.availableModels.length === 0) {
          void fetchModelOptions();
        }
        const search = document.getElementById('dock-model-search-input') as HTMLInputElement | null;
        if (search) search.focus();
      }
    };
  }

  // Bind dropdown options
  bindModelDropdownEvents();

  // Reasoning Dropdown Toggle (对标 OpenChamber 思考下拉卡片)
  const reasoningBtn = document.getElementById('dock-reasoning-toggle-btn');
  const reasoningDropdown = document.getElementById('dock-reasoning-dropdown');
  if (reasoningBtn && reasoningDropdown) {
    reasoningBtn.onclick = (e) => {
      e.stopPropagation();
      const isOpen = reasoningDropdown.style.display === 'block';
      reasoningDropdown.style.display = isOpen ? 'none' : 'block';
    };
    document.querySelectorAll('.reasoning-option').forEach((opt) => {
      (opt as HTMLElement).onclick = (e) => {
        e.stopPropagation();
        const level = (e.currentTarget as HTMLElement).getAttribute('data-level') as AppState['reasoningLevel'];
        reasoningDropdown.style.display = 'none';
        if (level) void switchReasoning(level);
      };
    });
  }

  // Approval Mode Dropdown Toggle
  const approvalBtn = document.getElementById('dock-approval-toggle-btn');
  const approvalDropdown = document.getElementById('dock-approval-dropdown');
  if (approvalBtn && approvalDropdown) {
    approvalBtn.onclick = (e) => {
      e.stopPropagation();
      const isOpen = approvalDropdown.style.display === 'block';
      approvalDropdown.style.display = isOpen ? 'none' : 'block';
    };
    document.querySelectorAll('.approval-option').forEach((opt) => {
      (opt as HTMLElement).onclick = (e) => {
        e.stopPropagation();
        const mode = (e.currentTarget as HTMLElement).getAttribute('data-mode') as AppState['approvalMode'];
        approvalDropdown.style.display = 'none';
        if (mode) void switchApproval(mode);
      };
    });
  }

  // Notice close button
  const noticeCloseBtn = document.getElementById('dock-notice-close');
  if (noticeCloseBtn) {
    noticeCloseBtn.onclick = () => {
      state.dockNotice = '';
      if (dockNoticeDismissTimer) {
        clearTimeout(dockNoticeDismissTimer);
        dockNoticeDismissTimer = null;
      }
      render();
    };
  }

  // Rollback cancel button inside dock notice stack
  const rollbackCancelBtn = document.querySelector<HTMLElement>('.rollback-banner-cancel[data-action="rollback-cancel"]');
  if (rollbackCancelBtn) {
    rollbackCancelBtn.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      handleRollbackCancel();
    };
  }

  // Event delegation on input-dock-container for notices and rollback cancel
  const dockContainer = document.querySelector<HTMLElement>('.input-dock-container');
  if (dockContainer && !dockContainer.dataset.dockClickBound) {
    dockContainer.dataset.dockClickBound = 'true';
    dockContainer.addEventListener('click', (e) => {
      const cancelAction = (e.target as HTMLElement).closest<HTMLElement>('[data-action="rollback-cancel"]');
      if (cancelAction) {
        e.stopPropagation();
        e.preventDefault();
        handleRollbackCancel();
      }
    });
  }

  // Send message & IME Composition defense
  const sendBtn = document.getElementById('dock-send-btn') as HTMLButtonElement | null;
  const inputEl = document.getElementById('dock-prompt-input') as HTMLTextAreaElement;
  let isComposing = false;

  const handleSend = (source: 'button' | 'enter') => {
    if (!inputEl) return;
    const text = inputEl.value.trim();

    if (state.isStreaming) {
      // Clicking the stop button interrupts; pressing Enter must not.
      if (source === 'button') {
        void interruptTurn();
      } else {
        state.dockNotice = '当前回合仍在生成中，可点击右侧停止按钮中断';
        render();
      }
      return;
    }

    if (!text) return;
    inputEl.value = '';
    void routeSend(text);
  };

  // 发送按钮可用性：与 OpenChamber 一致，空内容时降到 30% 不透明度且不可点。
  // 【防范的历史坑 (Pitfall)】流式期间按钮切换成中断动作，必须保持可点击；
  //   网关未连接时模板已写入 disabled + data-locked，这里不得擅自解锁。
  const syncSendAvailability = () => {
    if (!sendBtn || !inputEl || sendBtn.dataset.locked === 'true') return;
    const hasAttachments = Boolean(document.querySelector('.composer-attachment-pill'));
    sendBtn.disabled = !state.isStreaming && !inputEl.value.trim() && !hasAttachments;
  };

  if (sendBtn) sendBtn.onclick = () => handleSend('button');
  syncSendAvailability();
  if (inputEl) {
    if (inputEl.dataset.dockEventsBound !== 'true') {
      inputEl.addEventListener('input', syncSendAvailability);
      inputEl.dataset.dockEventsBound = 'true';
      const collapseBtn = document.getElementById('dock-input-collapse-toggle') as HTMLButtonElement | null;
      let isManuallyCollapsed = false;

      const adjustHeight = () => {
        if (isManuallyCollapsed) return;
        inputEl.style.height = 'auto';
        const scrollHeight = inputEl.scrollHeight;
        const targetHeight = Math.min(Math.max(scrollHeight, 52), 240);
        inputEl.style.height = `${targetHeight}px`;

        if (collapseBtn) {
          if (scrollHeight > 100) {
            collapseBtn.style.display = 'inline-block';
            collapseBtn.textContent = t('dock.collapse');
          } else {
            collapseBtn.style.display = 'none';
          }
        }
      };

      if (collapseBtn) {
        collapseBtn.onclick = (e) => {
          e.preventDefault();
          isManuallyCollapsed = !isManuallyCollapsed;
          if (isManuallyCollapsed) {
            inputEl.style.height = '64px';
            collapseBtn.textContent = t('dock.showMore');
          } else {
            adjustHeight();
            collapseBtn.textContent = t('dock.collapse');
          }
        };
      }

      inputEl.addEventListener('input', () => {
        adjustHeight();
        const textBeforeCursor = inputEl.value.slice(0, inputEl.selectionStart || inputEl.value.length);

        // 斜杠命令 (/): 处于开头或空格后 → complete.slash 动态补全（失败降级目录快照）
        const slashMatch = /(?:^|\s)\/([a-zA-Z0-9_-]*)$/.exec(textBeforeCursor);
        if (slashMatch) {
          state.mentionPopperOpen = false;
          requestSlashCompletion(slashMatch[1]);
          return;
        } else if (state.slashPopperOpen) {
          state.slashPopperOpen = false;
          render();
        }

        // 智能引用 (@): Agent 项本地枚举 + 文件项走 complete.path 动态检索
        const mentionMatch = /(?:^|\s)@([a-zA-Z0-9_\u4e00-\u9fa5\.-]*)$/.exec(textBeforeCursor);
        if (mentionMatch) {
          const query = mentionMatch[1].toLowerCase();
          const agentItems: MentionReferenceOption[] = [];
          const isBotChat = state.activeFocus.type === 'bot';
          const isGroupChat = state.activeFocus.type === 'group';

          if (isGroupChat) {
            agentItems.push({ type: 'agent', name: 'all', detail: t('mention.allDetail') });
            // 设计意图 (Why): 群聊内 @ 成员补全必须匹配当前聚焦的群聊房间成员。
            // 防范的历史坑 (Pitfall): 曾误用 editingGroupRoomId，导致常规打字时 currentRoom 恒为 undefined，参会 Bot 列表全部丢失。
            // 规则 (Rules): 严格从 state.activeFocus 提取 activeRoomId。
            const activeRoomId = state.activeFocus.type === 'group' ? state.activeFocus.roomId : undefined;
            const currentRoom = state.groupRooms.find((r) => r.roomId === activeRoomId);
            if (currentRoom) {
              for (const member of currentRoom.members) {
                agentItems.push({ type: 'agent', name: member, detail: t('mention.groupMember') });
              }
            }
          } else if (!isBotChat) {
            for (const p of state.profiles) {
              agentItems.push({ type: 'agent', name: p.displayName || p.name, detail: p.name });
            }
          }

          const filteredAgents = agentItems.filter((m) => m.name.toLowerCase().includes(query));
          state.mentionItems = filteredAgents;
          state.mentionPopperOpen = filteredAgents.length > 0;
          state.slashPopperOpen = false;
          render();
          requestPathCompletion(query);
          return;
        } else if (state.mentionPopperOpen) {
          state.mentionPopperOpen = false;
          render();
        }
      });

      // 剪贴板图片/文件粘贴监听 (Ctrl+V)
      inputEl.addEventListener('paste', (e) => {
        const files = e.clipboardData?.files;
        if (files && files.length > 0) {
          e.preventDefault();
          void addInputAttachments(files);
        }
      });

      // 拖拽支持 (Drag & Drop)
      const dockContainer = document.querySelector('.input-dock-container') as HTMLElement | null;
      if (dockContainer && dockContainer.dataset.dragBound !== 'true') {
        dockContainer.dataset.dragBound = 'true';
        dockContainer.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        dockContainer.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const files = e.dataTransfer?.files;
          if (files && files.length > 0) {
            void addInputAttachments(files);
          }
        });
      }

      // Initial auto adjustment for restored drafts
      adjustHeight();

      inputEl.addEventListener('compositionstart', () => { isComposing = true; });
      inputEl.addEventListener('compositionend', () => { isComposing = false; });
      inputEl.onkeydown = (e) => {
        if (e.key === 'Escape') {
          if (state.slashPopperOpen || state.mentionPopperOpen) {
            e.preventDefault();
            state.slashPopperOpen = false;
            state.mentionPopperOpen = false;
            render();
            return;
          }
        }
        if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
          if (state.slashPopperOpen || state.mentionPopperOpen) {
            state.slashPopperOpen = false;
            state.mentionPopperOpen = false;
          }
          e.preventDefault();
          handleSend('enter');
        }
      };
    }
  }

  // 附件移除与 Popper 补全委托
  const dockBox = document.querySelector('.input-dock-container');
  if (dockBox && !dockBox.hasAttribute('data-popper-delegated')) {
    dockBox.setAttribute('data-popper-delegated', 'true');
    dockBox.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      // 移除附件按钮
      const removeBtn = target.closest<HTMLElement>('.btn-remove-attachment');
      if (removeBtn) {
        e.stopPropagation();
        const attId = removeBtn.getAttribute('data-att-id');
        if (attId) {
          state.attachments = state.attachments.filter((a) => a.id !== attId);
          render();
        }
        return;
      }

      // 斜杠命令项点击：按网关 replace_from 精确替换光标 token
      const slashOption = target.closest<HTMLElement>('.slash-item-option');
      if (slashOption) {
        e.stopPropagation();
        const cmd = slashOption.getAttribute('data-command') || '';
        const replaceFromRaw = slashOption.getAttribute('data-replace-from');
        const replaceFrom = replaceFromRaw ? parseInt(replaceFromRaw, 10) : null;
        if (cmd && inputEl) {
          if (replaceFrom !== null && Number.isFinite(replaceFrom)) {
            const caret = inputEl.selectionStart ?? inputEl.value.length;
            inputEl.value = inputEl.value.slice(0, replaceFrom) + cmd + ' ' + inputEl.value.slice(caret);
            const pos = replaceFrom + cmd.length + 1;
            inputEl.setSelectionRange(pos, pos);
          } else {
            inputEl.value = `${cmd} `;
            inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
          }
          inputEl.focus();
          state.slashPopperOpen = false;
          render();
        }
        return;
      }

      // 智能引用项点击：区分 Agent（写 pickedMention 权威）与 File（插入相对路径）
      const mentionOption = target.closest<HTMLElement>('.mention-item-option');
      if (mentionOption) {
        e.stopPropagation();
        const mention = mentionOption.getAttribute('data-mention') || '';
        const mtype = mentionOption.getAttribute('data-type') || 'agent';
        if (mention && inputEl) {
          if (mtype === 'file') {
            const prefix = inputEl.value.replace(/@\S*$/, '');
            inputEl.value = `${prefix}@${mention} `;
            inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
          } else {
            const prefix = inputEl.value.replace(/@\S*$/, '');
            inputEl.value = `${prefix}@${mention} `;
            inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
            state.pickedMention = { profile: mention, token: `@${mention}` };
          }
          inputEl.focus();
          state.mentionPopperOpen = false;
          render();
        }
        return;
      }
    });
  }

  // Scroll stream: Auto-load older messages on top reach with requestAnimationFrame & cooldown lock
  const streamEl = document.getElementById('conversation-stream');
  if (streamEl) {
    streamEl.onscroll = () => {
      // 导航轨位置必须第一个算：下面的 handler 有 6 处 return，写在中段会被冷却期与加载期吃掉。
      syncPromptNavigatorFromScroll();
      /**
       * 【程序滚动识别 (Rules)】贴底、锚点校正都会写 scrollTop 并派发 scroll 事件。
       *   按落地值识别，避免把程序写入误判成读者手势。
       */
      const isProgrammatic = programmaticScrollTarget !== null
        && Math.abs(streamEl.scrollTop - programmaticScrollTarget) <= 2;
      programmaticScrollTarget = null;
      const previousTop = lastStreamScrollTop;
      /**
       * 【控制权移交 (Rules)】读者的任意真实滚动都意味着"我要自己控制视口"：
       *   立即解除首屏落定；其中向上回溯额外记录该会话，此后同类补齐不再把读者拽回底部。
       */
      if (!isProgrammatic && Math.abs(streamEl.scrollTop - previousTop) > 4) {
        initialBottomSettling = false;
        if (streamEl.scrollTop < previousTop - 4) {
          readerScrolledSessionId = state.activeSessionId;
          settledLayoutSignature = layoutSignature();
        }
      }
      // 下滑方向手势：即刻释放冷却锁，彻底消除手势对抗感（对标 OpenChamber 动量释放）
      if (streamEl.scrollTop > lastStreamScrollTop + 4) {
        streamScrollCooldown = false;
      }
      lastStreamScrollTop = streamEl.scrollTop;
      // 首屏落定期间 scrollTop 由 settleInitialBottom 驱动，不得当作读者回溯去扩窗。
      if (initialBottomSettling) return;
      /**
       * 读者贴到底部时补算一次底部留白：输入舱会在聚焦/多行输入后变高，
       * 而 padding 只在 render 时更新，不在这里补，滚到底看到的仍是按旧舱高留出的空白。
       */
      if (streamEl.scrollHeight - streamEl.scrollTop - streamEl.clientHeight <= STICK_TO_BOTTOM_THRESHOLD_PX) {
        scheduleStreamBottomInset();
      }

      if (streamScrollCooldown || state.isLoadingOlder) return;

      const prefetchThreshold = Math.max(800, streamEl.clientHeight * 1.0);

      /**
       * 【有界窗口下行回收 (Rules)】窗口是 [start, end) 有界区间，向下滚到区间尾部时
       * 必须整体前移，否则读者滚到底会撞上"没有更多内容"的空洞。
       * 判定用"距底部不足一屏"而不是精确触底，留出一屏余量做回收，避免读者看到空白。
       * 【占位块换算 (Rules)】底部占位块也计入 scrollHeight，因此这里用的是含占位的真实距离，
       * 与窗口前移后占位减少的量正好抵消，不会形成回收抖动。
       */
      if (messageWindowUserExpanded && messageWindowEnd < state.messages.length) {
        const distanceToEnd = streamEl.scrollHeight - streamEl.scrollTop - streamEl.clientHeight;
        if (distanceToEnd < prefetchThreshold) {
          streamScrollCooldown = true;
          slideMessageWindowForward();
          requestAnimationFrame(() => { streamScrollCooldown = false; });
          return;
        }
      }

      /**
       * 【拖滚动条跳转 (Rules)】画布高度钉成虚拟全高后，scrollTop 是"全量虚拟坐标"。
       *   用户把 thumb 拖到远处时，按行高换算出目标索引并搬迁窗口，
       *   再把 scrollTop 校正回该索引对应的虚拟位置，保证停靠点与看到的内容一致。
       */
      if (state.messages.length > MESSAGE_WINDOW_CAPACITY) {
        const virtualTop = Math.round(messageWindowStart * averageRowHeightPx);
        const virtualBottom = Math.round(messageWindowEnd * averageRowHeightPx);
        const outside = streamEl.scrollTop < virtualTop - streamEl.clientHeight * 2
          || streamEl.scrollTop > virtualBottom;
        if (outside) {
          /**
           * 【同一授权规则 (Rules)】读者没向上回溯过时，视口脱离窗口只可能是首屏未定位；
           *   此时搬迁窗口会把起点搬到会话顶部，必须改为贴底。
           */
          if (!shouldExpandWindow({
            sessionId: state.activeSessionId,
            readerScrolledSessionId,
            total: state.messages.length,
            capacity: MESSAGE_WINDOW_CAPACITY,
          })) {
            initialBottomSettling = true;
            settleInitialBottom();
            scrollStreamToBottom('initial scroll position offscreen');
            return;
          }
          const targetIndex = Math.floor(streamEl.scrollTop / Math.max(1, averageRowHeightPx));
          if (relocateMessageWindowToIndex(targetIndex)) {
            streamScrollCooldown = true;
            render();
            requestAnimationFrame(() => {
              syncScrollTopToWindow('scrollbar jump');
              streamScrollCooldown = false;
            });
            return;
          }
        }
      }

      /**
       * 【虚拟坐标判定 (Rules)】画布高度钉成虚拟全高后，scrollTop 是"全量虚拟坐标"，
       *   不能再用 scrollTop < 800 判断"接近顶部"。真实判据是：
       *   视口顶端已经进入窗口上沿之上（或紧贴），说明读者正在向上回溯，需要扩窗。
       */
      const virtualWindowTop = Math.round(messageWindowStart * averageRowHeightPx);
      const nearWindowTop = messageWindowStart > 0 && streamEl.scrollTop < virtualWindowTop + prefetchThreshold;
      const atTrueTop = messageWindowStart === 0 && streamEl.scrollTop < prefetchThreshold;

      if (nearWindowTop || atTrueTop) {
        // 【AGENTS.md 三态隔离】群聊研讨室严禁发起单会话翻页
        if (state.activeFocus.type === 'group') return;

        /**
         * 【扩窗必须由读者授权 (Rules)】只有读者真实向上回溯过，才允许把窗口起点往前搬。
         * 【设计意图 (Why)】冷启动先渲染缓存会话时 scrollTop 初值为 0，视口天然"落在窗口上沿之上"，
         *   这与"读者正在向上翻"在 scroll 事件里无法区分。实测 1128 条会话因此在首屏连扩三次，
         *   窗口从 [1008,1128] 落到 [907,1027]，读者看到的不是最新消息。
         * 【判据】`readerScrolledSessionId` 记录的反向滚动只可能来自读者手势：
         *   程序贴底只会让 scrollTop 增大。
         */
        if (!shouldExpandWindow({
          sessionId: state.activeSessionId,
          readerScrolledSessionId,
          total: state.messages.length,
          capacity: MESSAGE_WINDOW_CAPACITY,
        })) {
          // 视口尚未落到底部：这是首屏没定位，直接贴底，绝不扩窗。
          if (state.messages.length > MESSAGE_WINDOW_CAPACITY) {
            initialBottomSettling = true;
            settleInitialBottom();
            scrollStreamToBottom('initial window offscreen');
          }
          return;
        }

        // 先扩展本地挂载窗口：已加载但未挂载的更早消息无需请求服务端。
        // 【竞态守卫 (Rules)】必须先上锁再扩展：render 插入历史会同步触发新的 scroll 事件，
        // 若等 expand 返回后才上锁，同一次手势会连扩两批，把锚点补偿推到列表底部。
        streamScrollCooldown = true;
        const expanded = expandMessageWindow();
        if (expanded) {
          // 本地扩窗仅需吸收同帧 DOM 提交事件，下一帧立刻释放锁，杜绝手势对抗卡死感
          requestAnimationFrame(() => { streamScrollCooldown = false; });
          return;
        }
        // 窗口已顶到列表首部才需要向服务端要更早历史
        if (messageWindowStart > 0 || !state.hasOlderMessages) {
          streamScrollCooldown = false;
          return;
        }
        requestAnimationFrame(async () => {
          try {
            // 【持续触顶连拉 (Rules)】用户停在顶部不松手时连续补页，直到
            //   ① 视口被新增内容顶离顶部 ② 历史真正耗尽 ③ 达到单手势上限。
            //   压缩归档场景下一次手势最多跨越 40 页，否则 4000+ 行历史要滑几十次才到更早日期，
            //   用户看到的就是"一直转圈却翻不动"。
            let chain = 0;
            do {
              const before = state.messages.length;
              await loadOlderMessages();
              chain += 1;
              const el = document.getElementById('conversation-stream');
              const stillNearTop = Boolean(el && el.scrollTop < prefetchThreshold * 0.4);
              if (state.messages.length === before) break;
              if (!stillNearTop || !state.hasOlderMessages) break;
            } while (chain < 40);
          } finally {
            // Cool-down delay (60ms) to absorb momentum scroll bounce & prevent cascading re-entrancy
            setTimeout(() => {
              streamScrollCooldown = false;
            }, 60);
          }
        });
      }
    };
  }

  // Stream & Global Event Delegation: Click on any .tool-file-link / [data-preview-file] / [data-preview-url]
  if (streamEl && streamEl.dataset.fileLinkDelegated !== 'true') {
    streamEl.dataset.fileLinkDelegated = 'true';
    streamEl.addEventListener('click', (e) => {
      // 0. 回滚横幅取消：恢复乐观裁撤快照
      const cancelBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-action="rollback-cancel"]');
      if (cancelBtn) {
        e.stopPropagation();
        e.preventDefault();
        handleRollbackCancel();
        return;
      }
      // 1. 消息微距操作栏委托：复制、回滚、Fork 分支（选择器严格精准收敛）
      const actionBtn = (e.target as HTMLElement).closest<HTMLElement>('.msg-action-btn[data-action]');
      if (actionBtn) {
        const action = actionBtn.getAttribute('data-action');
        if (action === 'copy-msg') {
          e.stopPropagation();
          e.preventDefault();
          void handleCopyMessage(actionBtn);
          return;
        }
        if (action === 'rollback-msg') {
          e.stopPropagation();
          e.preventDefault();
          handleRollbackMessage(actionBtn);
          return;
        }
        if (action === 'fork-msg') {
          e.stopPropagation();
          e.preventDefault();
          void handleForkMessage(actionBtn);
          return;
        }
      }

      // 2. 工具文件预览链接委托
      const linkEl = (e.target as HTMLElement).closest<HTMLElement>('.tool-file-link, [data-preview-file], [data-preview-url]');
      if (linkEl) {
        e.stopPropagation();
        e.preventDefault();
        const filePath = linkEl.getAttribute('data-preview-file') || linkEl.dataset.previewFile || '';
        const previewUrl = linkEl.getAttribute('data-preview-url') || linkEl.dataset.previewUrl || '';
        if (filePath || previewUrl) {
          void handleOpenFilePreview(filePath || previewUrl, previewUrl);
        }
      }
    });
  }

  // Direct element binding fallback for pre-rendered tool capsules
  document.querySelectorAll<HTMLElement>('.tool-file-link, [data-preview-file], [data-preview-url]').forEach((link) => {
    link.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      const filePath = link.getAttribute('data-preview-file') || link.dataset.previewFile || '';
      const previewUrl = link.getAttribute('data-preview-url') || link.dataset.previewUrl || '';
      if (filePath || previewUrl) {
        void handleOpenFilePreview(filePath || previewUrl, previewUrl);
      }
    };
  });

  // Dynamic live duration ticker for running tools (100ms interval for fluid stopwatch)
  updateRunningToolTimers();

  // Bind Draggable Rails
  bindRailResizeEvents();
}

/**
 * 消息微距操作栏动作处理函数集（委托给 messageActions 核心领域模块）
 *
 * 【设计意图 (Why)】
 * 支撑对话流中每条消息的即时操作（复制纯文本/Markdown、回滚回填至输入框、基于消息节点分支会话、重新生成本轮回复）。
 * 通过委派给独立 messageActionController 领域控制器，实现生产运行与单元测试 100% 共享相同逻辑。
 *
 * 【防范的历史坑 (Pitfall)】
 * - 复制内容防范 HTML 属性截断：优先从 state.messages 模型内存中根据 data-msg-id 提取完整 content，仅在内存缺失时回退 data-content；
 * - Fork 分支防范 4008 守卫错误：计算截断条数 count = msgIdx + 1，杜绝传空或者传负数；
 * - 重新生成防范并发重入与上下文脱节：在当前流式中坚决拦截；向前逆序查找到最近一条 user 提问再调用 sendMessage 重新提交；
 * - 回滚防范光标跳动与高度未刷新：填入 textarea 后触发 input 事件通知自适应高度计算并保持末尾光标。
 *
 * 【约束与规则 (Rules)】
 * - 状态透明：无论成功还是失败，均通过 setTimedDockNotice 和按钮图标微动效给予用户明确反馈；
 * - 严格类型，严禁 as any。
 */
async function addInputAttachments(fileList: FileList | File[]): Promise<void> {
  const files = Array.from(fileList);
  if (files.length === 0) return;

  const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
  let imgIndex = state.attachments.filter((a) => a.type === 'image').length;
  let docIndex = state.attachments.filter((a) => a.type !== 'image').length;
  const newItems: InputAttachmentItem[] = [];

  for (const file of files) {
    const isImg = file.type.startsWith('image/');
    if (isImg && file.size > MAX_IMAGE_SIZE) {
      setTimedDockNotice(t('dock.imageTooLarge'));
      continue;
    }

    if (isImg) {
      imgIndex++;
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string) || '');
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });

      newItems.push({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name || `image_${imgIndex}.png`,
        label: `Image ${imgIndex}`,
        type: 'image',
        previewUrl: dataUrl,
        sizeBytes: file.size,
      });
    } else {
      docIndex++;
      newItems.push({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        label: `Doc ${docIndex}`,
        type: file.name.endsWith('.pdf') ? 'pdf' : 'file',
        sizeBytes: file.size,
      });
    }
  }

  if (newItems.length > 0) {
    state.attachments = [...state.attachments, ...newItems];
    render();
  }
}

async function handleCopyMessage(btn: HTMLElement): Promise<void> {
  await messageActionController.executeCopy(
    btn,
    state.messages,
    safeCopyText,
    setTimedDockNotice,
    t('common.copied')
  );
}

/**
 * 回滚：即时乐观裁撤目标提问及其后续消息（点击即消失），保留快照供取消/失败恢复，
 * 提问回填输入框。截断锚点必须为持久 rowId，否则降级为纯回填（不发截断字段）。
 */
function handleRollbackMessage(btn: HTMLElement): void {
  const rowEl = btn.closest<HTMLElement>('[data-msg-id]');
  const msgId = btn.getAttribute('data-msg-id') || rowEl?.getAttribute('data-msg-id') || '';
  const rawRowId = btn.getAttribute('data-row-id') || rowEl?.getAttribute('data-row-id');
  const btnRowId = rawRowId ? parseInt(rawRowId, 10) : undefined;

  // 自愈与定位：提取目标提问，若按钮持有有效持久 rowId 且内存丢失，安全回填自愈
  const resolvedTarget = resolveRollbackTarget({
    messages: state.messages,
    msgId,
    btnRowId,
  });

  const effectiveTargetId = resolvedTarget?.targetMsg.id || msgId;

  const plan = planTruncate({
    messages: state.messages,
    targetId: effectiveTargetId,
    sessionKind: deriveSessionKind(state.activeFocus),
    isStreaming: isStreamingActiveForCurrentSession(),
  });

  if (plan.mode === 'blocked') {
    const reasonText =
      plan.reason === 'streaming'
        ? t('chat.rollbackBlockedStreaming')
        : plan.reason === 'unsupported-scope'
          ? t('chat.rollbackBlockedScope')
          : t('chat.rollback');
    setTimedDockNotice(reasonText);
    render();
    return;
  }

  const targetMsg = state.messages.find((m) => m.id === plan.targetId);
  const textarea = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
  const refilled = messageActionController.executeRollback(
    btn,
    state.messages,
    textarea,
    setTimedDockNotice,
    t('chat.rollbackSuccess')
  );

  // refill-only：无持久锚点，仅回填文本作为新提问，不进入 armed，不发截断
  if (plan.mode === 'refill-only') {
    setTimedDockNotice(t('chat.rollbackNoAnchor'));
    render();
    return;
  }

  if (plan.anchor.kind !== 'row') return;
  const originalMessages = state.messages;
  const cut = applyOptimisticCut(originalMessages, plan.anchor);
  if (!cut) {
    setTimedDockNotice(t('chat.rollbackNoAnchor'));
    render();
    return;
  }

  state.messages = cut.kept;
  if (state.activeSessionId) {
    sessionMessagesCache.set(state.activeSessionId, [...state.messages]);
  }
  void refilled;
  state.rollbackArmed = {
    sessionId: state.activeSessionId,
    targetId: plan.targetId,
    anchor: plan.anchor,
    snapshot: originalMessages.map((m) => ({ ...m })),
    removedCount: cut.removed.length,
    anchorLabel: targetMsg?.timestamp || `#${plan.anchor.rowId}`,
  };
  render();
}

/** 取消挂起回滚：恢复快照并清除横幅 */
function handleRollbackCancel(): void {
  const armed = state.rollbackArmed;
  if (!armed) return;
  // 作用域守卫：只有横幅属于当前会话时才允许写回 state.messages
  if (armed.sessionId !== state.activeSessionId) {
    state.rollbackArmed = null;
    render();
    return;
  }
  state.messages = armed.snapshot.map((m) => ({ ...m }));
  sessionMessagesCache.set(armed.sessionId, [...state.messages]);
  state.rollbackArmed = null;
  setTimedDockNotice(t('chat.rollbackCancelled'));
  render();
}

async function handleForkMessage(btn: HTMLElement): Promise<void> {
  if (!gatewayClient) {
    setTimedDockNotice(t('chat.gatewayNotConnected'));
    return;
  }
  // Fork 必须作用于 live transport id：stored id 会被网关判为 session not found（4001）
  const liveId = await ensureLiveSessionId();
  if (!liveId) {
    setTimedDockNotice(t('chat.forkNoLive'));
    render();
    return;
  }
  await messageActionController.executeFork(btn, {
    activeSessionId: liveId,
    profileName: state.profileName || 'default',
    messages: state.messages,
    forkSession: (input) =>
      interactiveService.forkSession(rpcCaller, {
        sessionId: input.sessionId,
        count: input.count,
        profile: input.profile,
        idempotencyKey: input.idempotencyKey,
      }),
    onSuccess: async (newSessionId) => {
      // 成功即刻切换并刷新左轨；即时反馈由 setTimedDockNotice(现已触发 render) 提供
      await selectSession(newSessionId);
      scheduleSessionsRefresh();
    },
    setNotice: setTimedDockNotice,
    labels: {
      notConnected: t('chat.gatewayNotConnected'),
      forking: t('chat.forking'),
      success: t('chat.forkSuccess'),
      failed: t('chat.forkFailed'),
    },
  });
}

if (typeof window !== 'undefined') {
  window.__fluxMessageActions = {
    handleCopyMessage,
    handleRollbackMessage,
    handleForkMessage,
  };
}

let runningToolTimerHandle: number | undefined;

function stopRunningToolTimers(): void {
  if (runningToolTimerHandle !== undefined) {
    clearInterval(runningToolTimerHandle);
    runningToolTimerHandle = undefined;
  }
}

function updateRunningToolTimers(): void {
  // Only run active stopwatch if current session is actively streaming or busy!
  if (!isStreamingActiveForCurrentSession()) {
    stopRunningToolTimers();
    return;
  }

  const activeBadges = document.querySelectorAll<HTMLElement>('.tool-duration-badge[data-start-time]');
  if (activeBadges.length === 0) {
    stopRunningToolTimers();
    return;
  }

  const tick = () => {
    if (!isStreamingActiveForCurrentSession()) {
      stopRunningToolTimers();
      return;
    }

    const badges = document.querySelectorAll<HTMLElement>('.tool-duration-badge[data-start-time]');
    if (badges.length === 0) {
      stopRunningToolTimers();
      return;
    }
    const now = Date.now();
    badges.forEach((b) => {
      const startTime = Number(b.dataset.startTime);
      if (startTime && !isNaN(startTime)) {
        // Upper bound safety: if tool has been running over 10 minutes, stop polling it
        if (now - startTime > 10 * 60 * 1000) {
          b.removeAttribute('data-start-time');
          return;
        }
        const elapsedSec = Math.max(0.1, (now - startTime) / 1000);
        b.textContent = `${elapsedSec.toFixed(1)}s`;
      }
    });
  };

  tick();
  if (runningToolTimerHandle === undefined) {
    // 200ms interval saves 50% micro-task interrupts while keeping smooth 0.1s stopwatch precision
    runningToolTimerHandle = window.setInterval(tick, 200);
  }
}

/**
 * 拖拽调整左轨宽度。
 *
 * 设计意图 (Why)：宽度是"用户一次设定、长期沿用"的偏好，因此拖拽、双击复原、冷启动恢复必须共用同一组边界常量。
 * 防范的历史坑 (Pitfall)：旧实现把 [200,500] 与 260 默认值写死在事件回调里，恢复路径又各写一份，三者互相漂移；
 *   打包产物残留旧版时，用户实测到的仍是无夹取的旧行为（本次已用真实 Blink 复现确认）。
 * 约束与规则 (Rules)：本函数是左轨宽度的唯一写入口，边界只读 LEFT_RAIL_WIDTH；写入后立即持久化并夹取。
 */
function beginLeftRailResize(event: React.PointerEvent<HTMLDivElement>): void {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget;
  const startX = event.clientX;
  const cssVar = '--rail-w-left';
  const startWidth = clampLeftRailWidth(
    getComputedStyle(document.documentElement).getPropertyValue(cssVar) || String(LEFT_RAIL_WIDTH.defaultValue),
  );
  try {
    handle.setPointerCapture(event.pointerId);
  // gate-degrade: PointerCapture 在断开的指针或部分无头环境下会抛错，属可安全忽略的平台差异
  } catch {}

  document.documentElement.setAttribute('data-rail-resizing', 'left');
  let currentW = startWidth;
  let rafId = 0;

  /**
   * 【唯一写入口 (Rules)】宽度只能写 `--rail-w-left`，绝不能改边栏元素自身的内联几何。
   * React 已经把 width / flex / min-width / max-width 四件套内联绑到该变量上，另写一份会与
   * 残留的 `min-width: var(--rail-w-left)` 打架：变宽时旧值更小看不出问题，一旦收窄，
   * 上次提交的宽度就成了下限，拖动停在旧宽度（实测收窄 96px 时 12 帧纹丝不动）。
   */
  const onPointerMove = (moveEv: PointerEvent) => {
    currentW = clampLeftRailWidth(String(startWidth + (moveEv.clientX - startX)));
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        document.documentElement.style.setProperty(cssVar, `${currentW}px`);
        rafId = 0;
      });
    }
  };

  const onPointerUp = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    try {
      handle.releasePointerCapture(event.pointerId);
    // gate-degrade: 指针可能已被系统回收，释放失败不影响最终宽度写入
    } catch {}
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    const settled = clampLeftRailWidth(String(currentW));
    document.documentElement.style.setProperty(cssVar, `${settled}px`);
    localStorage.setItem('hermes_flux_rail_w_left', String(settled));
    // 【松手不回弹 (Rules)】先落定变量再撤 resizing 标记：反过来会让 0.12s 过渡从拖拽终点再播一次。
    requestAnimationFrame(() => document.documentElement.removeAttribute('data-rail-resizing'));
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

/** 双击手柄把左轨宽度复原为默认档。 */
function resetLeftRailWidth(): void {
  document.documentElement.style.setProperty('--rail-w-left', `${LEFT_RAIL_WIDTH.defaultValue}px`);
  localStorage.setItem('hermes_flux_rail_w_left', String(LEFT_RAIL_WIDTH.defaultValue));
}

function bindRailResizeEvents(): void {
  document.querySelectorAll<HTMLElement>('.rail-resize-handle').forEach((handle) => {
    if (handle.dataset.railHandle === 'left') {
      // 左轨把手已由 React 岛通过 onPointerDown 接管，这里只补双击复原。
      handle.ondblclick = (e) => { e.stopPropagation(); resetLeftRailWidth(); };
      return;
    }
    const cssVar = '--rail-w-right';
    // 约束与规则(Rules)：右轨维持现值，待波③与 410 规范一并对齐（不在本 PR 扩面）。
    const minW = 260;
    const maxW = Math.round(window.innerWidth * 0.85);
    const defaultW = 420;
    const storageKey = 'hermes_flux_rail_w_right';

    handle.ondblclick = (e) => {
      e.stopPropagation();
      document.documentElement.style.setProperty(cssVar, `${defaultW}px`);
      localStorage.setItem(storageKey, String(defaultW));
    };

    handle.onpointerdown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();

      try {
        handle.setPointerCapture(ev.pointerId);
      // gate-degrade: PointerCapture 在某些无头环境或断开时抛错属正常现象
      } catch {}

      const startX = ev.clientX;
      const startWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar)) || defaultW;
      document.documentElement.setAttribute('data-rail-resizing', 'right');

      let currentW = startWidth;
      let rafId = 0;

      /**
       * 【唯一写入口 (Rules)】同左轨：只写 `--rail-w-right`。
       * 边栏元素的内联几何由组件模板持有，另写一份会被残留的 `min-width` 反向钉死，
       * 表现为「拖到 A 点、边框停在 B 点」的非线性滞后。
       */
      const onPointerMove = (moveEv: PointerEvent) => {
        const delta = (moveEv.clientX - startX) * -1;
        currentW = Math.max(minW, Math.min(maxW, startWidth + delta));
        if (!rafId) {
          rafId = requestAnimationFrame(() => {
            document.documentElement.style.setProperty(cssVar, `${currentW}px`);
            rafId = 0;
          });
        }
      };

      const onPointerUp = (upEv: PointerEvent) => {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        try {
          handle.releasePointerCapture(upEv.pointerId);
        // gate-degrade: releasePointerCapture 容错处理
        } catch {}
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        document.documentElement.style.setProperty(cssVar, `${Math.round(currentW)}px`);
        localStorage.setItem(storageKey, String(Math.round(currentW)));
        requestAnimationFrame(() => document.documentElement.removeAttribute('data-rail-resizing'));
      };

      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    };
  });
}

function bindModelDropdownEvents(): void {
  // Search model input
  const modelSearchInput = document.getElementById('dock-model-search-input') as HTMLInputElement | null;
  if (modelSearchInput) {
    modelSearchInput.onclick = (e) => e.stopPropagation();
    modelSearchInput.oninput = (e) => {
      e.stopPropagation();
      state.modelSearchQuery = (e.target as HTMLInputElement).value;
      updateModelDropdownSubtree();
    };
  }

  // Toggle favorite model
  document.querySelectorAll('.btn-toggle-favorite').forEach((btn) => {
    (btn as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      const modelId = (e.currentTarget as HTMLElement).getAttribute('data-model');
      if (modelId) {
        if (state.favoriteModels.includes(modelId)) {
          state.favoriteModels = state.favoriteModels.filter((m) => m !== modelId);
        } else {
          state.favoriteModels.push(modelId);
        }
        localStorage.setItem('hermes_flux_fav_models', JSON.stringify(state.favoriteModels));
        localStorage.setItem('hermes_aura_fav_models', JSON.stringify(state.favoriteModels));
        updateModelDropdownSubtree();
      }
    };
  });

  document.querySelectorAll('.model-option').forEach((opt) => {
    (opt as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      const target = e.currentTarget as HTMLElement;
      // 【规则】网关标记不可用的模型禁止发起切换：必然被 config.set 拒绝，白跑一次失败
      if (target.dataset.locked === 'true') return;
      const model = target.getAttribute('data-model');
      const provider = target.getAttribute('data-provider') || undefined;
      const dropdown = document.getElementById('dock-model-dropdown');
      if (dropdown) dropdown.style.display = 'none';
      state.modelMenuOpen = false;
      if (model) void switchModel(model, provider);
    };
  });
}

function updateModelDropdownSubtree(): void {
  const scrollList = document.getElementById('model-picker-scroll-list');
  if (!scrollList) return;
  scrollList.innerHTML = renderModelPickerTree({
    selectedModel: state.selectedModel,
    models: state.availableModels,
    modelDetails: state.modelDetails,
    modelCatalog: state.modelCatalog,
    currentProvider: state.currentProvider,
    favoriteModels: state.favoriteModels,
    recentModels: state.recentModels,
    modelSearchQuery: state.modelSearchQuery,
    reasoningLevel: state.reasoningLevel,
    approvalMode: state.approvalMode,
    isStreaming: state.isStreaming,
  });
  bindModelDropdownEvents();
}

// Global keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    state.leftRailCollapsed = !state.leftRailCollapsed;
    render();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
    e.preventDefault();
    state.inspectorCollapsed = !state.inspectorCollapsed;
    render();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === ',') {
    e.preventDefault();
    state.isSettingsOpen = !state.isSettingsOpen;
    if (state.isSettingsOpen) ensureSettingsSectionData(state.settingsSection);
    render();
  }
  if (e.key === 'Escape') {
    if (state.confirmModal) {
      const modal = state.confirmModal;
      state.confirmModal = undefined;
      render();
      if (modal.onCancel) modal.onCancel();
      else restoreComposerFocus();
      return;
    }
    if (state.isSettingsOpen) {
      state.isSettingsOpen = false;
      render();
    } else if (state.modelMenuOpen) {
      state.modelMenuOpen = false;
      render();
    }
  }
  if (e.key === 'Enter' && state.confirmModal) {
    e.preventDefault();
    const modal = state.confirmModal;
    state.confirmModal = undefined;
    render();
    if (modal.onConfirm) void modal.onConfirm();
    return;
  }
});

// Close the model menu, reasoning menu or context menu when the pointer goes down outside of it.
document.addEventListener('mousedown', (e) => {
  const reasoningDropdown = document.getElementById('dock-reasoning-dropdown');
  const reasoningBtn = document.getElementById('dock-reasoning-toggle-btn');
  if (reasoningDropdown && reasoningDropdown.style.display === 'block') {
    if (!reasoningDropdown.contains(e.target as Node) && !reasoningBtn?.contains(e.target as Node)) {
      reasoningDropdown.style.display = 'none';
    }
  }

  const approvalDropdown = document.getElementById('dock-approval-dropdown');
  const approvalBtn = document.getElementById('dock-approval-toggle-btn');
  if (approvalDropdown && approvalDropdown.style.display === 'block') {
    if (!approvalDropdown.contains(e.target as Node) && !approvalBtn?.contains(e.target as Node)) {
      approvalDropdown.style.display = 'none';
    }
  }

  if (state.sessionContextMenu) {
    const ctxMenu = document.getElementById('session-context-menu');
    if (!ctxMenu || !ctxMenu.contains(e.target as Node)) {
      state.sessionContextMenu = undefined;
      render();
    }
  }

  if (!state.modelMenuOpen) return;
  const wrapper = document.querySelector('.pill-dropdown-wrapper');
  if (wrapper && !wrapper.contains(e.target as Node)) {
    state.modelMenuOpen = false;
    render();
  }
});

/**
 * 浏览器直跑演示模式：仅在 http(s) 且 URL 带 `?demo=conversation` 时生效。
 * 设计意图(Why)：网关凭据不可用时，仍能在真实壳里查看新的对话区渲染，不影响 Electron 生产路径。
 */
function isConversationDemoMode(): boolean {
  if (typeof location === 'undefined') return false;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return false;
  return new URLSearchParams(location.search).get('demo') === 'conversation';
}

function injectConversationDemo(): void {
  state.gatewayConnected = true;
  state.gatewayConnecting = false;
  state.profileName = 'default';
  state.activeFocus = { type: 'session', sessionId: 'demo-session' };
  state.hasOlderMessages = true;
  state.messages = [
    { id: 'demo-u1', role: 'user', content: 'Review the new conversation layout, spacing and bubble width.', timestamp: '10:24' },
    {
      id: 'demo-a1',
      role: 'assistant',
      content:
        'The structure is now Stage → Stream → Turn → Message.\n\n- User bubble right-aligned, max 80% / 820px\n- Assistant full width\n- Turn gap independent from message gap\n\nTool capsules and card containers mount into Turn next.',
      thought: 'Check container hierarchy first, then padding and width.',
      thoughtDurationMs: 1800,
      model: 'deepseek-v4.1-flash',
      durationMs: 2400,
      timestamp: '10:25',
      sender: 'Default',
      toolCalls: [
        { id: 'demo-t1', name: 'shell', status: 'completed', args: 'npm test', output: '664 passing', durationMs: 1200 },
        { id: 'demo-t2', name: 'read_file', status: 'completed', args: 'packages/ui/src/styles/conversation.css', durationMs: 80 },
        { id: 'demo-t3', name: 'grep', status: 'failed', args: 'ghost-token', output: 'no matches', durationMs: 40 },
      ],
    },
    { id: 'demo-a2', role: 'assistant', content: 'Streaming writes through ref, so the tree does not re-render.', timestamp: '10:25', sender: 'Default' },
    { id: 'demo-u2', role: 'user', content: 'Second user message for alignment and spacing.', timestamp: '10:26' },
    {
      id: 'demo-a3',
      role: 'assistant',
      content: 'Final assistant message, used to check the turn footer position.',
      model: 'deepseek-v4.1-flash',
      durationMs: 1200,
      timestamp: '10:27',
      sender: 'Default',
    },
  ];
}

async function init(): Promise<void> {
  logApp.info('renderer boot', {
    level: getLogLevel(),
    theme: state.theme,
    platform: navigator.platform,
    electron: navigator.userAgent.includes('Electron'),
  });
  installLayoutShiftDiagnostics();
  // 文件类型图标 sprite 只注入一次；Markdown 与工具行都靠 <use href="#id"> 引用。
  mountFileTypeSprite();
  applyFontPreferences(fontPreferences);
  // 语言是全局单例：启动时必须把持久化偏好写进 i18n 模块，否则 t() 永远返回默认语言。
  syncLocale();
  // 代码高亮引擎空闲预热：首屏先用轻量高亮，避免 300ms 的语法编译阻塞首屏。
  warmUpHighlighting();

  if (isConversationDemoMode()) {
    injectConversationDemo();
    render();
    return;
  }

  // Restore persisted rail widths — 夹取后才允许注入，防止历史越界存档复活（坑：恢复路径曾无 clamp）
  const clampRail = (raw: string | null, minW: number, maxW: number, fallback: number): number => {
    const parsed = raw ? Number.parseFloat(raw) : NaN;
    if (!Number.isFinite(parsed)) return fallback;
    return Math.round(Math.max(minW, Math.min(maxW, parsed)));
  };
  const railMaxW = Math.round(window.innerWidth * 0.85);
  const restoredLeft = clampLeftRailWidth(localStorage.getItem('hermes_flux_rail_w_left') || localStorage.getItem('hermes_aura_rail_w_left'));
  document.documentElement.style.setProperty('--rail-w-left', `${restoredLeft}px`);
  localStorage.setItem('hermes_flux_rail_w_left', String(restoredLeft));
  const restoredRight = clampRail(localStorage.getItem('hermes_flux_rail_w_right') || localStorage.getItem('hermes_aura_rail_w_right'), 260, railMaxW, 420);
  document.documentElement.style.setProperty('--rail-w-right', `${restoredRight}px`);
  localStorage.setItem('hermes_flux_rail_w_right', String(restoredRight));

  if (desktopApi) {
    try {
      const sys = await desktopApi.getSystemInfo();
      state.platform = sys.platform || 'windows';
      state.appVersion = typeof sys.appVersion === 'string' ? sys.appVersion : undefined;
      state.isMaximized = await desktopApi.isMaximized();

      desktopApi.onWindowStateChange((ws) => {
        state.isMaximized = ws.isMaximized;
        render();
      });

      if (desktopApi?.getDefaultGatewayConfig) {
        const def = await desktopApi.getDefaultGatewayConfig();
        if (def) {
          const savedUrl = localStorage.getItem('hermes_flux_gateway_url') || localStorage.getItem('hermes_aura_gateway_url');
          if (def.url && !savedUrl) state.gatewayUrl = def.url;
          const savedProfile = localStorage.getItem('hermes_flux_profile') || localStorage.getItem('hermes_aura_profile');
          if (def.profile && !savedProfile) state.profileName = def.profile;
        }
      }
    } catch (e) {
      console.warn('[Desktop PAL] Sync note:', e);
    }
  }

  // 冷启动先喂本地快照再连网：首屏不等网络（失败自动回落，不阻塞 connect）
  void restoreCacheToState();
  connect();

  let lastFocusRefreshAt = 0;
  window.addEventListener('focus', () => {
    const now = Date.now();
    // 5 秒冷却防抖：避免桌面端频繁切换窗口触发密集无意义的网关 RPC
    if (now - lastFocusRefreshAt < 5000) return;
    lastFocusRefreshAt = now;
    if (gatewayClient && !state.isStreaming) {
      void refreshProfilesFromServer();
    }
  });

  // 页面从隐藏恢复但未触发窗口 focus 时，也要及时同步服务端改名/改描述。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshProfilesFromServer();
  });
}

init();
