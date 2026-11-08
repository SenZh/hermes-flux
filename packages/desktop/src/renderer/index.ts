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
  extractToolTarget,
  renderInspectionPod,
  mountTitlebar,
  mountLeftRail,
  buildLeftRailModel,
  formatLeftRailTime,
  renderSettingsModal,
  type SettingsTab,
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
  type ConversationMount,
  type ConversationSnapshot,
  mountFileTypeSprite,
  warmUpHighlighting,
  loadFontPreferences,
  saveFontPreferences,
  applyFontPreferences,
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
} from '@hermes-flux/core';

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

/** 消息缓存上限：每会话 2000 行。 */
const MESSAGE_CACHE_LIMIT = 2000;

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
      // 若当前未激活会话且缓存中存在会话，预载首个会话消息以瞬间完成首屏渲染
      if (!state.activeSessionId && state.sessions.length > 0) {
        const firstSession = state.sessions[0];
        if (firstSession?.id) {
          state.activeSessionId = firstSession.id;
          state.activeLiveSessionId = '';
          void loadMessages(firstSession.id, firstSession.botName);
        }
      }
      render();
    }
  // gate-degrade: 本地缓存读取失败属于可选加速失效，回落到网络拉取即可
  } catch {}
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
  settingsTab: SettingsTab;
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
  gatewayUrl: localStorage.getItem('hermes_flux_gateway_url') || localStorage.getItem('hermes_aura_gateway_url') || 'http://127.0.0.1:9119',
  username: localStorage.getItem('hermes_flux_username') || localStorage.getItem('hermes_aura_username') || '',
  password: localStorage.getItem('hermes_flux_password') || localStorage.getItem('hermes_aura_password') || '',
  isSettingsOpen: false,
  settingsTab: 'providers',
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

function isStreamNearBottom(stream: HTMLElement | null): boolean {
  if (!stream) return false;
  return stream.scrollHeight - stream.scrollTop - stream.clientHeight <= STICK_TO_BOTTOM_THRESHOLD_PX;
}

/** Pins the stream to the newest message, then re-pins once layout settles. */
function scrollStreamToBottom(reason: string): void {
  const stream = document.getElementById('conversation-stream');
  if (!stream) return;
  stream.scrollTop = stream.scrollHeight;

  requestAnimationFrame(() => {
    const settled = document.getElementById('conversation-stream');
    if (!settled) return;
    const drift = settled.scrollHeight - settled.scrollTop - settled.clientHeight;
    if (drift > 1) {
      settled.scrollTop = settled.scrollHeight;
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
  let url = (base || 'http://127.0.0.1:9119').trim();
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
        const last = await client.fetchLastMessage(t.id, { profile: t.botName || currentBot });
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

  if (!state.activeSessionId && state.sessions.length > 0) {
    await selectSession(state.sessions[0].id);
    return;
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
function syncProjectSessions(): void {
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
    void selectSession(cachedSessionId, { preserveFocus: true });
    void fetchModelOptions({ clearNotice: true });
    render();
    return;
  }

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

    state.activeFocus = { type: 'bot', botName: botProfile };
    await selectSession(foreverChat.sessionId, { preserveFocus: true });
    state.activeFocus = { type: 'bot', botName: botProfile };
    render();
  } catch (err) {
    if (activeLoadMessagesGeneration !== guard.generation || state.activeFocus.type !== 'bot' || state.activeFocus.botName !== botProfile) return;
    console.error('[Flux] Failed to resolve Forever Chat for bot:', botProfile, err);
    state.dockNotice = t('dock.enterBotChatFailed', { name: botProfile, error: describeRpcError(err) });
    render();
    return;
  }

  void fetchModelOptions({ clearNotice: true });
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

async function fetchProfiles(): Promise<void> {
  const client = gatewayClient;
  if (!client) return;
  try {
    const list = await client.listProfiles();
    // 1. 命中持久缓存，0ms 秒开回填头像资产
    for (const p of list) {
      if (!p.avatar) {
        const cached = profileAvatarCache.get(p.name.toLowerCase()) || (p.displayName ? profileAvatarCache.get(p.displayName.toLowerCase()) : undefined);
        if (cached) p.avatar = cached;
      }
    }
    state.profiles = list;
    persistAgentsToCache(list);
    syncProfileLastMessages();
    render();

    // 2. 并发向网关拉取 Bot 真实高清头像资产 (profiles.get_asset)，严格 await 杜绝会话时序冲刷
    await Promise.allSettled(
      list.map(async (p) => {
        if (p.avatar) {
          profileAvatarCache.set(p.name.toLowerCase(), p.avatar);
          if (p.displayName) profileAvatarCache.set(p.displayName.toLowerCase(), p.avatar);
          return;
        }
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

        // 3. 异步探查该 Bot 的专职终身主工位最新真实对话（建立缓存与收敛状态）
        try {
          const forever = await profileService.getOrCreateForeverChat(p.name, client);
          if (forever && forever.sessionId) {
            botForeverChatCache.set(p.name, forever.sessionId);
            const histRes = await client.fetchSessionMessages(forever.sessionId, { limit: 1, offset: 0, order: 'latest' });
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
          }
        // gate-degrade: 单条主工位探测失败按跳过处理，不影响其余 Bot 资产渲染
        } catch {
          // 容错放行
        }
      })
    );
  } catch (e) {
    console.warn('[Flux] fetchProfiles failed:', e);
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
const OLDER_BATCH_PAGE_SIZE = 50;
const sessionMessagesCache = new Map<string, MessageViewModel[]>();
const sessionServerOffset = new Map<string, number>();
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
 */
function parseRawMessages(list: any[]): MessageViewModel[] {
  const messageScope = {
    isGroupRoom: state.activeFocus.type === 'group',
    isBotRoom: state.activeFocus.type === 'bot',
  };
  const parsedMessages: MessageViewModel[] = [];

  for (let idx = 0; idx < list.length; idx++) {
    const m = list[idx];
    if (!m || typeof m !== 'object') continue;

    const rawRole = String(m.role || '').toLowerCase();
    
    let rawText = '';
    if (typeof m.text === 'string') {
      rawText = m.text;
    } else if (typeof m.content === 'string') {
      rawText = m.content;
    } else if (Array.isArray(m.content)) {
      rawText = m.content
        .map((part: any) => {
          if (typeof part === 'string') return part;
          if (part && typeof part.text === 'string') return part.text;
          if (part && part.type === 'tool_use') return `[调用工具: ${part.name || 'tool'}]`;
          return '';
        })
        .filter(Boolean)
        .join('\n');
    } else if (typeof m.message === 'string') {
      rawText = m.message;
    } else if (m.delta && typeof m.delta.text === 'string') {
      rawText = m.delta.text;
    }

    const thought = typeof m.thinking === 'string'
      ? m.thinking
      : typeof m.thought === 'string'
      ? m.thought
      : typeof m.reasoning === 'string'
      ? m.reasoning
      : '';

    const rawToolCalls = Array.isArray(m.tool_calls)
      ? m.tool_calls
      : Array.isArray(m.tools)
      ? m.tools
      : Array.isArray(m.tool_use)
      ? m.tool_use
      : [];

    const toolCalls = rawToolCalls.map((tc: any, tIdx: number) => {
      const toolName = tc.name || tc.function?.name || tc.tool || 'tool';
      const rawArgs = tc.args ?? tc.arguments ?? tc.function?.arguments ?? tc.input ?? tc.parameters ?? {};
      // 【防范的历史坑 (Pitfall)】历史 args 形状不统一（顶层 command / 信封 args.command / JSON 字符串），
      // 旧实现取不到 key 就把整段 JSON 当目标显示。统一走深度提取，取不到留空。
      const cleanArg = extractToolTarget(rawArgs);

      const formatRawOutput = (val: unknown): string | undefined => {
        if (val === null || val === undefined) return undefined;
        if (typeof val === 'string') return val;
        try {
          return JSON.stringify(val, null, 2);
        } catch {
          return String(val);
        }
      };

      return {
        id: tc.id || tc.tool_call_id || `tc-${idx}-${tIdx}`,
        name: toolName,
        status: (tc.status || 'completed') as any,
        args: cleanArg,
        output: formatRawOutput(tc.output ?? tc.result ?? tc.stdout),
      };
    });

    let isToolPayload = rawRole === 'tool' || rawRole === 'function';
    let synthesizedToolCall: any = null;

    if (!isToolPayload && rawText.trim().startsWith('{') && rawText.trim().endsWith('}')) {
      try {
        const parsed = JSON.parse(rawText.trim());
        if (
          parsed &&
          typeof parsed === 'object' &&
          ('output' in parsed || 'stdout' in parsed || 'exit_code' in parsed || 'exitCode' in parsed || 'diff' in parsed || 'files_modified' in parsed || 'total_count' in parsed || 'matches_text' in parsed || 'content' in parsed)
        ) {
          isToolPayload = true;
          let toolName = 'tool';
          let targetArg = '';

          if ('matches_text' in parsed || 'total_count' in parsed) {
            toolName = 'grep';
          } else if ('diff' in parsed || 'files_modified' in parsed) {
            toolName = 'edit';
            targetArg = parsed.resolved_path || (parsed.files_modified ? parsed.files_modified[0] : '') || '';
          } else if ('output' in parsed || 'stdout' in parsed) {
            toolName = 'shell';
          }

          let formattedOutput = parsed.output ?? parsed.stdout ?? parsed.diff ?? parsed.matches_text ?? rawText;
          if (typeof formattedOutput !== 'string') {
            formattedOutput = JSON.stringify(formattedOutput, null, 2);
          }

          synthesizedToolCall = {
            id: m.tool_call_id || `tc-synth-${idx}`,
            name: toolName,
            status: 'completed',
            args: targetArg,
            output: formattedOutput,
          };
        }
      // gate-degrade: 跨库删除的容错分支，某个 profile 未持有该会话属正常
      } catch {
        // not json
      }
    }

    if (isToolPayload) {
      if (parsedMessages.length > 0 && parsedMessages[parsedMessages.length - 1].role === 'assistant') {
        const prev = parsedMessages[parsedMessages.length - 1];
        if (!prev.toolCalls) prev.toolCalls = [];

        if (synthesizedToolCall) {
          prev.toolCalls.push(synthesizedToolCall);
          continue;
        }

        const validToolOutput = rawText || m.output || (m.result && Object.keys(m.result).length > 0 ? JSON.stringify(m.result) : undefined);

        if (prev.toolCalls.length > 0) {
          const lastTool = prev.toolCalls[prev.toolCalls.length - 1];
          lastTool.output = validToolOutput;
          // If the last tool was missing arguments or targetArg, try extracting from the result
          if (!lastTool.args && synthesizedToolCall?.args) {
            lastTool.args = synthesizedToolCall.args;
          }
          continue;
        } else {
          prev.toolCalls.push({
            id: m.tool_call_id || `tc-${idx}`,
            name: synthesizedToolCall?.name || m.name || 'tool',
            status: 'completed',
            args: synthesizedToolCall?.args || '',
            output: validToolOutput,
          });
          continue;
        }
      } else if (synthesizedToolCall) {
        const rawTs = m.timestamp ?? m.created_at;
        const numTs = typeof rawTs === 'number' ? (rawTs > 1e11 ? rawTs : rawTs * 1000) : Date.parse(rawTs) || Date.now();
        parsedMessages.push({
          id: String(m.row_id ?? m.id ?? `msg-${idx}`),
          role: 'assistant',
          content: '',
          thought: '',
          toolCalls: [synthesizedToolCall],
          timestamp: formatTimestamp(numTs),
          rawTimestamp: numTs,
        });
        continue;
      } else {
        continue;
      }
    }

    const hasContent = Boolean(rawText && rawText.trim());
    const hasThought = Boolean(thought && thought.trim());
    const hasTools = toolCalls.length > 0;

    if (rawRole === 'assistant' && !hasContent && !hasThought && !hasTools) {
      continue;
    }

    if (rawRole !== 'assistant' && !hasContent) {
      continue;
    }

    const rawTs = m.timestamp ?? m.created_at;
    const numTs = typeof rawTs === 'number' ? (rawTs > 1e11 ? rawTs : rawTs * 1000) : Date.parse(rawTs) || Date.now();

    const rowIdNum = extractDurableRowId(m);
    const scopedMsg: MessageViewModel = {
      id: String(m.row_id ?? m.id ?? `msg-${idx}`),
      rowId: rowIdNum,
      role: (rawRole === 'user' || rawRole === 'system' ? rawRole : 'assistant') as MessageViewModel['role'],
      content: rawText,
      thought,
      thoughtDurationMs: m.thought_duration_ms,
      toolCalls,
      timestamp: formatTimestamp(numTs),
      rawTimestamp: numTs,
    };
    if (messageScope.isGroupRoom) scopedMsg.isGroupRoom = true;
    if (messageScope.isBotRoom) scopedMsg.isBotRoom = true;
    parsedMessages.push(scopedMsg);
  }

  return parsedMessages;
}

async function loadOlderMessages(): Promise<void> {
  const sessionId = state.activeSessionId;
  if (!sessionId || state.isLoadingOlder || !gatewayClient) return;

  const currentOffset = sessionServerOffset.get(sessionId) || 0;
  const guard = { sessionId, generation: activeLoadMessagesGeneration };
  state.isLoadingOlder = true;
  const startedAt = performance.now();
  const stream = document.getElementById('conversation-stream');
  const prevScrollHeight = stream ? stream.scrollHeight : 0;
  const prevScrollTop = stream ? stream.scrollTop : 0;

  try {
    const guarded = await runGuarded(
      guard,
      () => ({ sessionId: state.activeSessionId, generation: activeLoadMessagesGeneration }),
      () => undefined,
      () => gatewayClient!.fetchSessionMessages(sessionId, {
        limit: OLDER_BATCH_PAGE_SIZE,
        offset: currentOffset,
        order: 'latest',
      }),
      logSession,
    );
    if (guarded.status === 'discarded') {
      state.isLoadingOlder = false;
      return;
    }
    const outcome = guarded.value;

    if (outcome.status === 'success' && outcome.messages.length > 0) {
      const batch = parseRawMessages(outcome.messages);
      sessionServerOffset.set(sessionId, currentOffset + outcome.messages.length);
      state.messages = [...batch, ...state.messages];
      sessionMessagesCache.set(sessionId, state.messages);
      const isRoom = hostedRoomIds.has(sessionId) || state.groupRooms.some((g) => g.roomId === sessionId);
      const olderCacheRef: CacheChannelRef = {
        profile: isRoom ? '' : (state.profileName || 'default'),
        channel: isRoom ? 'room' : 'session',
        channelId: sessionId,
      };
      persistMessagesToCache(olderCacheRef, state.messages, 0);
      const earliestRow = state.messages[0]?.rowId;
      const isEarliestReached = typeof earliestRow === 'number' && earliestRow <= 1;
      state.hasOlderMessages = !isEarliestReached && outcome.messages.length >= OLDER_BATCH_PAGE_SIZE;
      render();

      requestAnimationFrame(() => {
        const nextStream = document.getElementById('conversation-stream');
        if (!nextStream) {
          state.isLoadingOlder = false;
          return;
        }
        const addedHeight = nextStream.scrollHeight - prevScrollHeight;
        nextStream.scrollTop = prevScrollTop + addedHeight;

        requestAnimationFrame(() => {
          const settled = document.getElementById('conversation-stream');
          if (settled) {
            const settledAdded = settled.scrollHeight - prevScrollHeight;
            const drift = settledAdded - addedHeight;
            if (Math.abs(drift) >= 1) settled.scrollTop += drift;
          }
          state.isLoadingOlder = false;

          logScroll.debug('older batch prepended via REST pagination', {
            batch: batch.length,
            totalLoaded: state.messages.length,
            ms: Math.round((performance.now() - startedAt) * 10) / 10,
          });
        });
      });
      return;
    }
  } catch (err) {
    console.warn('[Flux] loadOlderMessages failed:', err);
  }

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

  // 1. 若当前会话为专职 Bot 的 Forever Chat，委托 core 领域逻辑更新
  const botRes = syncActiveSessionToBot({
    sessionId,
    messages,
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
    const lastMsg = messages[messages.length - 1];
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

async function loadMessages(sessionId: string, targetBotName?: string): Promise<void> {
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
    state.hasOlderMessages = (sessionServerOffset.get(sessionId) || 0) >= INITIAL_WINDOW_PAGE_SIZE;
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
      sessionServerOffset.set(sessionId, Math.max(sessionServerOffset.get(sessionId) || 0, outcome.pagination?.returned || outcome.messages.length));
      state.messages = merged;
      const earliestRow = merged[0]?.rowId;
      const isEarliestReached = typeof earliestRow === 'number' && earliestRow <= 1;
      state.hasOlderMessages = !isEarliestReached && Boolean((outcome.pagination?.returned ?? outcome.messages.length) >= INITIAL_WINDOW_PAGE_SIZE);
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
          syncActiveSessionPreviewToRail(sessionId, merged, resolvedBotName);
          if (merged.length > INITIAL_WINDOW_PAGE_SIZE) {
            state.messages = merged.slice(-INITIAL_WINDOW_PAGE_SIZE);
            state.hasOlderMessages = true;
          } else {
            state.messages = merged;
            state.hasOlderMessages = false;
          }
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
    .map((m) => {
      const header = m.role === 'user' ? '### User' : `### Assistant (${state.profileName || 'Agent'})`;
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

function formatTimestamp(ts: number | string): string {
  if (typeof ts === 'string') return ts;
  const d = new Date(ts > 1e11 ? ts : ts * 1000);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
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
  if (gatewayClient) {
    gatewayClient.disconnect();
    gatewayClient = null;
  }

  if (targetUrl) {
    state.gatewayUrl = targetUrl;
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
          Promise.allSettled([fetchProfiles().then(() => Promise.allSettled([fetchSessions(), fetchGroupRooms(), prefetchSlashCatalog()])), fetchModelOptions(), fetchProjects()]);
        }
      }
    });

    // Initial check
    if (gatewayClient.getState() === 'CONNECTED') {
      state.gatewayConnected = true;
      state.gatewayConnecting = false;
      render();
      Promise.allSettled([fetchProfiles().then(() => Promise.allSettled([fetchSessions(), fetchGroupRooms(), prefetchSlashCatalog()])), fetchModelOptions(), fetchProjects()]);
    }
  } catch (err: any) {
    console.error('[Flux Connect] Connection failed:', err);
    state.gatewayConnected = false;
    state.gatewayConnecting = false;
    state.testStatus = {
      ok: false,
      message: `WebSocket 连接握手失败: ${err.message || '网络异常'}`,
      latency: 0,
    };
  }

  render();
}

function disconnect(): void {
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
  const stream = document.getElementById('conversation-stream');
  if (!stream) return;

  // Follow mode (a deliberate jump, or the reader was already at the bottom)
  // wins over position preservation. Without this a background re-render during
  // streaming restores the old scrollTop while the rows keep growing, and the
  // next token flush snaps back down — the "bouncing" conversation.
  if (pinBottom) {
    stream.scrollTop = stream.scrollHeight;
    logScroll.trace('pinned after render', { session: state.activeSessionId });
    return;
  }

  // If we switched to a different session, don't inherit old session scroll offset!
  if (anchor.sessionId !== state.activeSessionId) {
    stream.scrollTop = stream.scrollHeight;
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
        logScroll.trace('anchor corrected', { id: anchor.id, delta: Math.round(delta) });
      }
      return;
    }
  }
  stream.scrollTop = anchor.rawScrollTop;
}

/**
 * After a full re-render the anchor is applied synchronously; late layout work
 * (web fonts, images, wrapped rows) can still move the pinned row a frame
 * later. Re-measure once and absorb the residual drift.
 */
function stabilizeStreamAnchor(anchor: StreamAnchor): void {
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
  rollbackActive: boolean;
  capsuleCount: number;
}

let lastMessagesSnapshot: RenderMessagesSnapshot | null = null;
let lastInputDockSnapshot: RenderInputDockSnapshot | null = null;
let updateReactTitlebar: (() => void) | null = null;
let updateReactLeftRail: (() => void) | null = null;
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
    onSelectSession: (sessionId: string, botName?: string) => { void selectSession(sessionId, { botName }); },
    onSelectBot: (profileName: string) => { void openBotChat(profileName); },
    onSelectGroup: (roomId: string) => { void openGroupRoom(roomId); },
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
    onNewChat: (kind: 'session' | 'group') => { void fetchProjects(); state.newTaskModalTab = kind === 'group' ? 'group' : 'solo'; state.isNewTaskModalOpen = true; render(); },
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
  const sessions = state.sessions.map((s) => ({
    ...s,
    activityState: resolveActivityState(s.id, {
      runningIds: activeRunningSessionIds,
      unreadIds: unreadSessionIds,
      streamingId: activeStreamingStoredSessionId,
    }),
  }));
  const groups = state.groupRooms.map((g) => ({
    ...g,
    activityState: resolveActivityState(g.roomId, {
      runningIds: activeRunningGroupRoomIds,
      unreadIds: unreadGroupRoomIds,
    }),
  }));
  const profiles = state.profiles.map((p) => ({
    ...p,
    // 强制穿透：优先从全局头像缓存解析真实头像资产，消除时序冲刷导致的头像丢失
    avatar: p.avatar || resolveAgentAvatar(p.name) || (p.displayName ? resolveAgentAvatar(p.displayName) : '') || '',
    activityState: resolveActivityState(p.name, {
      runningIds: activeRunningBotNames,
      unreadIds: unreadBotNames,
    }),
  }));
  return {
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
      error: state.sessionListError,
    }),
    collapsed: state.leftRailCollapsed,
    searchQuery: state.sessionSearchQuery,
    editingGroupRoomId: state.editingGroupRoomId,
    groupAvatars: profiles,
  };
}

let reactMessageList: ConversationMount | null = null;
let reactMessageListHost: HTMLElement | null = null;
let renderedMessageIds = new Set<string>();
let lastSeenStreaming = false;

/** 把当前会话状态映射为对话区只读视图模型；不做任何排序或解析。 */
function buildConversationSnapshot(): ConversationSnapshot {
  const focusType = state.activeFocus.type;
  const streaming = isStreamingActiveForCurrentSession();
  const lastMessageId = state.messages[state.messages.length - 1]?.id;
  return {
    mode: focusType === 'group' ? 'group' : focusType === 'bot' ? 'foreground' : 'scratchpad',
    connection: state.gatewayConnected ? 'connected' : state.gatewayConnecting ? 'connecting' : 'disconnected',
    isStreaming: streaming,
    hasOlderMessages: state.hasOlderMessages,
    isLoadingOlder: state.isLoadingOlder,
    profileName: state.profileName,
    messages: state.messages.map((m) => ({
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
      status: streaming && m.id === lastMessageId ? 'streaming' : undefined,
      isStreaming: streaming && m.id === lastMessageId,
      toolCalls: m.toolCalls?.map((tc) => ({
        id: tc.id,
        name: tc.name,
        status: tc.status,
        args: tc.args,
        output: tc.output,
        durationMs: tc.durationMs,
        startedAt: tc.startTime,
      })),
    })),
  };
}

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
    return;
  }
  const currentIds = state.messages.map((m) => m.id);
  if (reactMessageListHost !== host) {
    reactMessageList?.unmount();
    reactMessageList = mountMessageList(host, buildConversationSnapshot);
    reactMessageListHost = host;
    renderedMessageIds = new Set(currentIds);
    lastSeenStreaming = isStreamingActiveForCurrentSession();
    return;
  }
  const streaming = isStreamingActiveForCurrentSession();
  const justStoppedStreaming = lastSeenStreaming && !streaming;
  lastSeenStreaming = streaming;
  const shouldPush = decideConversationPush({
    prevIds: renderedMessageIds,
    nextIds: currentIds,
    justStoppedStreaming,
    force,
  });
  if (shouldPush && reactMessageList) {
    reactMessageList.update();
    renderedMessageIds = new Set(currentIds);
  }
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
      onOpenSettings: () => { state.isSettingsOpen = true; state.settingsTab = 'providers'; render(); },
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
  updateReactTitlebar?.();
  updateReactLeftRail?.();
  syncReactMessageList();
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

  const forcedBottom = pendingScrollToBottom;
  pendingScrollToBottom = false;
  const streamEl = document.getElementById('conversation-stream');
  const wasNearBottom = isStreamNearBottom(streamEl);
  const pinBottom = forcedBottom || wasNearBottom;
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

      ${renderSettingsModal({
        isOpen: state.isSettingsOpen,
        activeTab: state.settingsTab,
        gatewayUrl: state.gatewayUrl,
        username: state.username,
        password: state.password,
        profileName: state.profileName,
        theme: state.theme,
        lang: state.lang,
        connectionStatus: state.gatewayConnected ? 'connected' : state.gatewayConnecting ? 'connecting' : 'disconnected',
        latencyMs: state.gatewayLatencyMs,
        testStatus: state.testStatus,
        fontPrefs: fontPreferences,
      })}

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

    const nextDockHtml = state.gatewayConnected
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
      if (!nextDockHtml) {
        existingDock.remove();
        lastInputDockSnapshot = null;
      } else if (dockChanged) {
        existingDock.outerHTML = nextDockHtml;
        lastInputDockSnapshot = currentDockSnapshot;
      }
    } else if (nextDockHtml) {
      const middlePod = root.querySelector('.flux-middle-pod');
      if (middlePod) middlePod.insertAdjacentHTML('beforeend', nextDockHtml);
      lastInputDockSnapshot = currentDockSnapshot;
    }

    // Settings Modal
    const modalRoot = document.getElementById('flux-settings-modal-root');
    const nextModalHtml = renderSettingsModal({
      isOpen: state.isSettingsOpen,
      activeTab: state.settingsTab,
      gatewayUrl: state.gatewayUrl,
      username: state.username,
      password: state.password,
      profileName: state.profileName,
      theme: state.theme,
      lang: state.lang,
      connectionStatus: state.gatewayConnected ? 'connected' : state.gatewayConnecting ? 'connecting' : 'disconnected',
      latencyMs: state.gatewayLatencyMs,
      testStatus: state.testStatus,
      fontPrefs: fontPreferences,
    });
    if (modalRoot) {
      modalRoot.outerHTML = nextModalHtml;
    } else {
      root.insertAdjacentHTML('beforeend', nextModalHtml);
    }

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
      const canUseReactList = state.gatewayConnected && state.messages.length > 0;
      if (reactHost && canUseReactList) {
        syncReactMessageList();
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

  // Settings
  const btnCloseSettings = document.getElementById('btn-close-settings');
  if (btnCloseSettings) {
    btnCloseSettings.onclick = () => {
      state.isSettingsOpen = false;
      render();
    };
  }

  const modalBackdrop = document.querySelector('.settings-modal-backdrop') as HTMLElement;
  if (modalBackdrop) {
    modalBackdrop.onclick = (e) => {
      if (e.target === modalBackdrop) {
        state.isSettingsOpen = false;
        render();
      }
    };
  }

  document.querySelectorAll('.settings-tab-btn').forEach((btn) => {
    (btn as HTMLElement).onclick = (e) => {
      const tab = (e.currentTarget as HTMLElement).getAttribute('data-tab') as any;
      if (tab) {
        state.settingsTab = tab;
        render();
      }
    };
  });

  document.querySelectorAll('.settings-theme-btn').forEach((btn) => {
    (btn as HTMLElement).onclick = (e) => {
      const theme = (e.currentTarget as HTMLElement).getAttribute('data-theme') as any;
      if (theme) {
        state.theme = theme;
        localStorage.setItem('hermes_flux_theme', theme);
        localStorage.setItem('hermes_aura_theme', theme);
        render();
      }
    };
  });

  // 字体配置：直接写 :root 并落盘，不触发整页重绘，保证改动即时可见且不丢滚动位置
  document.querySelectorAll<HTMLSelectElement>('.settings-font-select').forEach((select) => {
    select.onchange = () => {
      const kind = select.dataset.fontKind;
      const next = { ...fontPreferences };
      if (kind === 'ui') next.uiFont = select.value as typeof next.uiFont;
      if (kind === 'mono') next.monoFont = select.value as typeof next.monoFont;
      fontPreferences = next;
      saveFontPreferences(next);
      applyFontPreferences(next);
    };
  });

  document.querySelectorAll<HTMLButtonElement>('.settings-font-scale-btn').forEach((btn) => {
    btn.onclick = () => {
      const scale = btn.dataset.scale as typeof fontPreferences.sizeScale;
      const next = { ...fontPreferences, sizeScale: scale };
      fontPreferences = next;
      saveFontPreferences(next);
      applyFontPreferences(next);
      document.querySelectorAll('.settings-font-scale-btn').forEach((b) => {
        const active = (b as HTMLElement).dataset.scale === scale;
        b.classList.toggle('active', active);
      });
    };
  });

  // Agent Profile Switcher Chips
  document.querySelectorAll('.btn-profile-chip').forEach((btn) => {
    (btn as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      const profile = (btn as HTMLElement).dataset.profile;
      if (profile) switchProfile(profile);
    };
  });

  // Settings: Live Inputs & Double Binding
  const gwUrlInput = document.getElementById('settings-gateway-url') as HTMLInputElement | null;
  if (gwUrlInput) {
    gwUrlInput.oninput = () => {
      state.gatewayUrl = gwUrlInput.value.trim();
      localStorage.setItem('hermes_flux_gateway_url', state.gatewayUrl);
      localStorage.setItem('hermes_aura_gateway_url', state.gatewayUrl);
    };
  }
  const gwUserInput = document.getElementById('settings-username') as HTMLInputElement | null;
  if (gwUserInput) {
    gwUserInput.oninput = () => {
      state.username = gwUserInput.value;
      localStorage.setItem('hermes_flux_username', state.username);
      localStorage.setItem('hermes_aura_username', state.username);
    };
  }
  const gwPassInput = document.getElementById('settings-password') as HTMLInputElement | null;
  if (gwPassInput) {
    gwPassInput.oninput = () => {
      state.password = gwPassInput.value;
      localStorage.setItem('hermes_flux_password', state.password);
      localStorage.setItem('hermes_aura_password', state.password);
    };
  }
  const gwProfileInput = document.getElementById('settings-profile-name') as HTMLInputElement | null;
  if (gwProfileInput) {
    gwProfileInput.oninput = () => {
      state.profileName = gwProfileInput.value || 'default';
      localStorage.setItem('hermes_flux_profile', state.profileName);
      localStorage.setItem('hermes_aura_profile', state.profileName);
    };
  }
  const settingsMenuSearch = document.getElementById('settings-menu-search') as HTMLInputElement | null;
  if (settingsMenuSearch) {
    settingsMenuSearch.oninput = () => {
      const q = settingsMenuSearch.value.toLowerCase().trim();
      document.querySelectorAll('.settings-tab-btn').forEach((btn) => {
        const text = btn.textContent?.toLowerCase() || '';
        (btn as HTMLElement).style.display = (!q || text.includes(q)) ? 'flex' : 'none';
      });
    };
  }

  // Settings: Test & Save Buttons
  const settingsTestBtn = document.getElementById('btn-settings-test-connection');
  if (settingsTestBtn) {
    settingsTestBtn.onclick = async () => {
      const urlInput = (document.getElementById('settings-gateway-url') as HTMLInputElement)?.value;
      const userInput = (document.getElementById('settings-username') as HTMLInputElement)?.value;
      const passInput = (document.getElementById('settings-password') as HTMLInputElement)?.value;
      const profileInput = (document.getElementById('settings-profile-name') as HTMLInputElement)?.value;

      if (urlInput) {
        state.gatewayUrl = urlInput.trim();
        localStorage.setItem('hermes_flux_gateway_url', state.gatewayUrl);
        localStorage.setItem('hermes_aura_gateway_url', state.gatewayUrl);
      }
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

      settingsTestBtn.innerText = '正在测试...';
      const res = await testConnection(state.gatewayUrl, userInput, passInput);
      state.testStatus = res;
      settingsTestBtn.innerText = '连通性测试';
      render();
    };
  }

  const settingsSaveBtn = document.getElementById('btn-settings-save-connect');
  if (settingsSaveBtn) {
    settingsSaveBtn.onclick = () => {
      const urlInput = (document.getElementById('settings-gateway-url') as HTMLInputElement)?.value;
      if (urlInput) state.gatewayUrl = urlInput.trim();
      state.username = (document.getElementById('settings-username') as HTMLInputElement)?.value || '';
      state.password = (document.getElementById('settings-password') as HTMLInputElement)?.value || '';
      state.profileName = (document.getElementById('settings-profile-name') as HTMLInputElement)?.value || 'default';
      connect();
    };
  }

  const disconnectBtn = document.getElementById('btn-disconnect-gateway');
  if (disconnectBtn) {
    disconnectBtn.onclick = () => {
      disconnect();
    };
  }

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
      const urlInput = (document.getElementById('onboarding-gateway-url') as HTMLInputElement)?.value;
      const userInput = (document.getElementById('onboarding-username') as HTMLInputElement)?.value;
      const passInput = (document.getElementById('onboarding-password') as HTMLInputElement)?.value;
      const profileInput = (document.getElementById('onboarding-profile-name') as HTMLInputElement)?.value;

      if (urlInput) {
        state.gatewayUrl = urlInput;
        localStorage.setItem('hermes_flux_gateway_url', urlInput);
        localStorage.setItem('hermes_aura_gateway_url', urlInput);
      }
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
      state.gatewayUrl = (document.getElementById('onboarding-gateway-url') as HTMLInputElement)?.value || state.gatewayUrl;
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
  let scrollCooldown = false;
  if (streamEl) {
    streamEl.onscroll = () => {
      if (scrollCooldown || state.isLoadingOlder || !state.hasOlderMessages) return;

      if (streamEl.scrollTop < 120) {
        scrollCooldown = true;
        requestAnimationFrame(async () => {
          try {
            await loadOlderMessages();
          } finally {
            // Cool-down delay (150ms) to absorb momentum scroll bounce & prevent cascading re-entrancy
            setTimeout(() => {
              scrollCooldown = false;
            }, 150);
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

  const onPointerMove = (moveEv: PointerEvent) => {
    currentW = clampLeftRailWidth(String(startWidth + (moveEv.clientX - startX)));
    document.documentElement.style.setProperty(cssVar, `${currentW}px`);
  };

  const onPointerUp = () => {
    try {
      handle.releasePointerCapture(event.pointerId);
    // gate-degrade: 指针可能已被系统回收，释放失败不影响最终宽度写入
    } catch {}
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    document.documentElement.removeAttribute('data-rail-resizing');
    const settled = clampLeftRailWidth(String(currentW));
    document.documentElement.style.setProperty(cssVar, `${settled}px`);
    localStorage.setItem('hermes_flux_rail_w_left', String(settled));
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

      const onPointerMove = (moveEv: PointerEvent) => {
        const delta = (moveEv.clientX - startX) * -1;
        currentW = Math.max(minW, Math.min(maxW, startWidth + delta));
        document.documentElement.style.setProperty(cssVar, `${currentW}px`);
      };

      const onPointerUp = (upEv: PointerEvent) => {
        try {
          handle.releasePointerCapture(upEv.pointerId);
        // gate-degrade: releasePointerCapture 容错处理
        } catch {}
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        document.documentElement.removeAttribute('data-rail-resizing');
        localStorage.setItem(storageKey, String(Math.round(currentW)));
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
      void fetchProfiles().catch(() => undefined);
    }
  });
}

init();
