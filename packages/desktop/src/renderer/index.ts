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
  type ToggleProviderAgentResult,
  type GatewayDraft,
  type SettingsLoadable,
  type McpServerRow as SettingsMcpRow,
  type SkillRow as SettingsSkillRow,
  type SettingsProfileRow,
  type ProviderView as SettingsProviderView,
  type CustomEndpointRow as SettingsCustomEndpointRow,
  type OauthProviderRow as SettingsOauthProviderRow,
  buildLeftRailModel,
  formatLeftRailTime,
  renderModelPickerMenu,
  renderModelPickerTree,
  renderMarkdown,
  getCleanReasoningSummary,
  escapeHtml,
  MessageViewModel,
  InspectorTab,
  type LeftRailGroupRoom,
  type LeftRailActiveFocus,
  type LeftRailSession,
  type LeftRailProfile,
  type LeftRailProject,
  renderNewTaskModal,
  renderContextMenu,
  type ContextMenuProps,
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
  mountAgentPresence,
  type AgentPresenceSnapshot,
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
  loadActivityIndicatorVariant,
  saveActivityIndicatorVariant,
  resolveActivityIndicatorVariant,
  type ActivityIndicatorVariant,
  setLocale,
  collectTouchedFiles,
  messageKeyForVerdict,
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
import { buildGatewayWsUrl, createGatewayReconnectResolver } from './gatewayConnection.js';
import { createSettingsController, resolveGatewayPassword } from './settingsController.js';
import { createBotManagementController } from './botManagementController.js';
import { createProviderAdminRest } from './providerAdminRest.js';
import { createProviderAdminController, planDeleteTarget } from './providerAdminController.js';
import {
  planMessageWindow,
  expandMessageWindowStart,
  slideMessageWindowDown,
  windowEndFor,
  windowStartAroundIndex,
  computeHasOlderMessages,
  hasLegacyUnorderedCacheRows,
  shouldTreatOlderDropAsExhausted,
  computeOlderBatchWindowStart,
  planAverageRowHeightLock,
  computeExpandPrefetchPx,
  computeStillNearTop,
  planUpwardScrollAction,
  planOlderZeroMessagesAction,
  shouldKeepOlderMessagesAfterLoop,
  shouldExpandWindow,
  shouldSettleInitialBottom,
} from './messageWindow.js';
import { profilesDiffer } from './profileRefresh.js';
import {
  promptMessageIndexAtScrollTop,
  topmostRectTop,
  shouldRebuildPromptIndex,
  shiftWindowStartForPrepend,
  buildHostPromptNavigatorSnapshot,
  isHostPromptNavigatorMetaSame,
} from './promptNavigator.js';
import {
  ModalInteractionController,
  createModalInteractionController,
} from './events/modalInteractionController.js';
import {
  InputDockController,
  createInputDockController,
} from './events/inputDockController.js';
import {
  type AppState,
  createInitialState,
} from './state/appState.js';
import {
  createTurnExecutionService,
  type TurnExecutionService,
} from './services/turnExecutionService.js';
import {
  createGatewayEventDispatcher,
  type GatewayEventDispatcher,
} from './gateway/gatewayEventDispatcher.js';

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
  modelCatalogFingerprint,
  normalizeModelCatalog,
  deriveAgentPresence,
  presenceTone,
  resolveGroupSpeaker,
  type AgentPresence,
  buildProviderDirectory,
  buildMcpServerRows,
  buildSkillRows,
  normalizeAgentProfile,
  formatModelDisplayName,
  type AgentProfile,
  type BotDetailData,
  type BotDraftState,
  type BotManagementStatus,
  projectBotRoster,
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
  ActivityTransitionTracker,
  type ActivityState,
  type ActivityDomain,
  type ActivityTransition,
  GroupLogPollerManager,
  captureGroupLogBaseline,
  type GroupMessageEntry,
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
  sortByDisplayAsc,
  type CachedSessionSummary,
  type CachedAgentSummary,
  type CachedMessageRow,
  type CacheChannelRef,
  planOlderBatchPrependMerge,
  planOlderBatchPrependMergeDetailed,
  planOlderPagination,
  countLocalCoveredRows,
  resolveLineageChain,
  isKnownDisplayKind,
  type MessageDisplayKind,
  planBindingToggle,
  planProviderRemoval,
  normalizeEndpointId,
  draftForBindingAttach,
  classifyAttachWrite,
  type ProfilesConfigureParams,
} from '@hermes-flux/core';

import { parseTranscriptRows } from './transcriptRows.js';
import { createInputCompletion } from './completion/inputCompletion.js';
import { createBotActivityStore } from './persistence/botActivityStore.js';
import { createSessionDraftStore } from './persistence/sessionDrafts.js';
import { isStringArray, safeParseJson, resolveDurableOrderKey } from './persistence/persistedJson.js';
import { DesktopCacheStore } from './cache/DesktopCacheStore.js';
import { loadProviderCatalog } from './providerCatalog.js';
import {
  type MessageLoadingService,
  createMessageLoadingService,
} from './services/messageLoadingService.js';
import {
  type SessionOperationService,
  createSessionOperationService,
} from './services/sessionOperationService.js';
import {
  type MessageWindowManager,
  createMessageWindowManager,
} from './messageWindowManager.js';
import {
  type RenderCoordinator,
  createRenderCoordinator,
  type RenderMessagesSnapshot,
} from './renderCoordinator.js';
import {
  type DropdownKeybindController,
  createDropdownKeybindController,
} from './dropdownKeybindController.js';

/** 头像绑定/解绑写操作的在途合流表：同键同签名复用 promise，异签名拒绝重入。 */
const inFlightProviderBindings = new Map<string, { signature: string; promise: Promise<ToggleProviderAgentResult> }>();

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
  const orderKey = resolveDurableOrderKey(view);
  if (orderKey === null) return null;

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

/**
 * 把一次 REST 窗口写入持久化缓存（异步，失败只降级为纯内存）。
 *
 * 【缓存分桶纯洁性 (Rules)】只落盘明确属于本会话的行。父会话血缘行一旦写进本会话分桶，
 *   缓存恢复时丢失 sessionId，会被当成本会话覆盖量，把向早翻页的游标抬过服务端末尾。
 */
function persistMessagesToCache(
  ref: CacheChannelRef,
  messages: MessageViewModel[],
  fenceMax: number
): void {
  const rows: CachedMessageRow[] = [];
  for (const message of messages) {
    if (message.sessionId && message.sessionId !== ref.channelId) continue;
    const row = toCachedMessage(message, ref);
    if (row) {
      row.displaySeq = rows.length + 1;
      rows.push(row);
    }
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
    /** CDP 只读探针：读者回溯标记与布局漂移窗口，用于断言折叠未污染手势状态 */
    __fluxScrollState?: () => {
      readerScrolledSessionId: string;
      layoutDriftUntil: number;
      messageWindowStart: number;
      messageWindowEnd: number;
      now: number;
    };
    __fluxActivity?: {
      startTurn: (domain: ActivityDomain, entityId: string) => void;
      completeTurn: (domain: ActivityDomain, entityId: string, isFocused: boolean) => void;
      failTurn: (domain: ActivityDomain, entityId: string) => void;
      enterRead: (domain: ActivityDomain, entityId: string) => void;
    };
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
/** 左轨活动指示器动效变体；用户在外观设置里选择，随 render() 推进左轨快照。 */
let activityIndicatorVariant: ActivityIndicatorVariant = loadActivityIndicatorVariant();

/**
 * Agent 在场指示器布局偏好的持久化键。
 *
 * 【必须声明在 `state` 之前 (Rules)】`state` 的初始化会调用 `readPresenceLayout()`；
 *   若本常量声明在其后，打包成 `var` 后初始化时读到 `undefined`，`getItem(undefined)`
 *   恒为 null → 冷启动永远回落到 `stage`（真实缺陷：用户选了 dock，重启后又跳回顶部）。
 */
const PRESENCE_LAYOUT_STORAGE_KEY = 'hermes_flux_presence_layout';

const state: AppState = {
  ...createInitialState({
    platform: detectInitialPlatform(),
    leftRailCollapsedDefault: typeof window !== 'undefined' && window.innerWidth <= 768,
  }),
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
/**
 * CDP 验证钩子：读者回溯标记与布局漂移窗口。
 *
 * 【设计意图 (Why)】折叠原生 `<details>` 会让浏览器把 scrollTop 钳小并派发 scroll，
 *   与读者向上回溯同形。该事件是否被正确豁免，只能从内部标记观察，DOM 几何看不出来。
 * 【约束与规则 (Rules)】只读，禁止业务代码调用。
 */
window.__fluxScrollState = () => ({
  readerScrolledSessionId,
  layoutDriftUntil: Math.round(layoutDriftUntil),
  messageWindowStart,
  messageWindowEnd,
  now: Math.round(performance.now()),
});

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
/**
 * 会话草稿持久化。
 *
 * 【设计意图 (Why)】草稿的写入点分散在新建/切换/删除/发送成功等多处，
 *   原先每处都要「改 Map + 手动落盘」两步，漏掉第二步不会有任何报错，只会丢草稿。
 *   现在整簇搬到 persistence/sessionDrafts.ts，落盘合并进写操作，从结构上消除该失误面。
 */
const sessionDrafts = createSessionDraftStore({
  onPersistError: (err) => console.warn('[Flux] session draft persist failed:', err),
});
const unreadSessionIds = new Set<string>();
const unreadGroupRoomIds = new Set<string>();
const unreadBotNames = new Set<string>();
const activeRunningGroupRoomIds = new Set<string>();
const activeRunningSessionIds = new Set<string>();
const activeRunningBotNames = new Set<string>();

const activityTransitionTracker = new ActivityTransitionTracker({ windowMs: 850 });
let activityTransitionRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function clearTransitionRefreshTimer(): void {
  if (activityTransitionRefreshTimer !== null) {
    clearTimeout(activityTransitionRefreshTimer);
    activityTransitionRefreshTimer = null;
  }
}

function scheduleTransitionRefresh(): void {
  clearTransitionRefreshTimer();
  const delayMs = activityTransitionTracker.nextExpiryDelayMs(Date.now());
  if (delayMs === null) return;
  activityTransitionRefreshTimer = setTimeout(() => {
    activityTransitionRefreshTimer = null;
    scheduleTransitionRefresh();
    render();
  }, delayMs);
}

function completeEntityTurn(
  domain: ActivityDomain,
  running: Set<string>,
  unread: Set<string>,
  entityId: string,
  isFocused: boolean
): void {
  if (!entityId) return;
  const wasRunning = running.has(entityId) || (domain === 'session' && activeStreamingStoredSessionId === entityId);
  applyTurnCompleted(running, unread, entityId, isFocused);
  if (wasRunning) {
    activityTransitionTracker.recordCompleted(domain, entityId, isFocused ? 'read' : 'unread', Date.now());
    scheduleTransitionRefresh();
  }
}

window.__fluxActivity = {
  startTurn: (domain, entityId) => {
    const sets = domain === 'session'
      ? [activeRunningSessionIds, unreadSessionIds]
      : domain === 'bot'
      ? [activeRunningBotNames, unreadBotNames]
      : [activeRunningGroupRoomIds, unreadGroupRoomIds];
    applyTurnStarted(sets[0], sets[1], entityId);
    activityTransitionTracker.clear(domain, entityId);
    render();
  },
  completeTurn: (domain, entityId, isFocused) => {
    const sets = domain === 'session'
      ? [activeRunningSessionIds, unreadSessionIds]
      : domain === 'bot'
      ? [activeRunningBotNames, unreadBotNames]
      : [activeRunningGroupRoomIds, unreadGroupRoomIds];
    completeEntityTurn(domain, sets[0], sets[1], entityId, isFocused);
    render();
  },
  failTurn: (domain, entityId) => {
    const running = domain === 'session'
      ? activeRunningSessionIds
      : domain === 'bot'
      ? activeRunningBotNames
      : activeRunningGroupRoomIds;
    applyTurnFailed(running, entityId);
    activityTransitionTracker.clear(domain, entityId);
    render();
  },
  enterRead: (domain, entityId) => {
    const unread = domain === 'session'
      ? unreadSessionIds
      : domain === 'bot'
      ? unreadBotNames
      : unreadGroupRoomIds;
    applyEnteredRead(unread, entityId);
    activityTransitionTracker.clear(domain, entityId);
    render();
  },
};

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
 * Bot 主工位最新交互持久化。
 *
 * 【设计意图 (Why)】专职 Bot 主工位状态与普通旁聊严格正交，该模块只依赖
 *   「profile 列表读写 + 时间格式化」两个注入点，因此整簇搬到
 *   persistence/botActivityStore.ts 并可独立测试（抽出前它从未被直接执行过）。
 *
 * 【约束与规则 (Rules)】profile 以 getter/setter 注入，保证每次读到的是最新列表，
 *   不会因宿主整体替换 state.profiles 而持有过期快照。
 */
const botActivityStore = createBotActivityStore({
  profiles: () => state.profiles,
  setProfiles: (next) => {
    state.profiles = next;
  },
  formatTime: (ts) => formatSessionTime(ts),
  /**
   * 持久化失败的观测通道。
   *
   * 【为什么用英文标识而非中文文案】这是开发者诊断日志，不是用户界面文案。
   *   走 t() 会让每条诊断日志都依赖语言字典，既污染 i18n 键空间，
   *   也让日志在切换语言后变得不可 grep。
   */
  // gate-i18n-allow: 开发者诊断日志，非用户界面文案，不需要走 t() 字典
  onPersistError: (err) => console.warn('[Flux] bot activity persist failed:', err),
});

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
  inputDockController.restoreComposerFocus(desktopApi);
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
   * 安全线 = 输入舱顶边到 pod 底边的整段 + 呼吸位。
   * 16px 在字体放大或输入舱带通知栈时余量不足，末行会贴到输入舱边上。
   *
   * 【呼吸位必须随指示器布局取值 (Rules)】`dock` 变体把在场指示器绝对定位在输入舱上沿
   *   （`bottom: calc(100% + 8px)`），28px 头像向上侵占 36px。沿用 32px 呼吸位会让会话
   *   最后一行压进指示器 4px——那条取值是按旧 20px 头像（8 + 20 = 28px）定的，头像放大后
   *   被静默击穿，且 dock 文案没有字形阴影，叠字没有任何隔离。
   *   这里按变体取 40px（间距 8 + 头像 28 + 呼吸 4，全落 4px 网格）；
   *   `stage` 变体悬浮在对话区顶部，底部不需要为它多留空间。
   */
  const presenceReserve = state.presenceLayout === 'dock' ? 40 : 32;
  const baseInset = Math.round(pod.getBoundingClientRect().bottom - dock.getBoundingClientRect().top) + presenceReserve;
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
          botActivityStore.updateLatestActivity(curFocus.botName, cachedTarget.content, Date.now());
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
    markProgrammaticScroll(stream);
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
  sessionOperationService.scheduleSessionsRefresh(delayMs);
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

  // 4. 同步智能体最新对话副标题
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
  botActivityStore.withActivityMap((activityMap) => {
    state.profiles = syncBotProfiles({
      profiles: state.profiles,
      activityMap,
      foreverChatCache: botForeverChatCache,
      sessionMessagesCache,
      formatTime: formatSessionTime,
    });
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
    }));

    render();
  } catch (e) {
    // Failure Is Not Empty: 网络或网关故障时绝不可将 state.projects 抹杀为空数组伪装成没有项目
    console.warn('[Flux] fetchProjects failed:', e);
    // 保留上一次已拉取到的项目列表或提示错误，严禁静默覆盖为权威空
    render();
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
            if (!activeRunningGroupRoomIds.has(r.roomId)) {
              unreadGroupRoomIds.add(r.roomId);
            }
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

/**
 * 群聊当前说话者的唯一写入口。
 *
 * 【设计意图 (Why)】
 *   在场指示器在群聊里必须回答「谁在干活」。`groups.log` 的每条事件都带真实的
 *   `senderProfile`（来自官方 `actor.display_name || actor.profile`），
 *   因此「末条 assistant 事件的发送者」就是最权威的说话者事实。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 曾考虑用 `groups.send` 的响应当说话者——那是**人类用户自己**，不是 Agent 成员，
 *      会导致指示器高亮一个没在干活的头像。宁可 null 降级，也绝不伪造。
 *   2. `senderProfile` 可能是 **displayName**，而房间 `members` 存的是 **profile name**。
 *      直接写入会让组件侧的「说话者必须在成员列表里」守卫判定为未知而全量降级——
 *      接线看似通了、实际永远不高亮。因此这里必须做一次 displayName → member 归一化。
 *
 * 【约束与规则 (Rules)】
 *   1. 只在群聊域写；非群聊域一律置 null，避免跨域残留；
 *   2. 末条是用户消息（人类刚发话、成员尚未应答）时置 null——此刻确实没有 Agent 在说话；
 *   3. 归一化失败（sender 不在成员列表）时置 null，绝不沿用上一位。
 */
function syncActiveGroupSpeakerFromMessages(): void {
  if (state.activeFocus.type !== 'group') {
    state.activeGroupSpeaker = null;
    return;
  }
  const roomId = state.activeFocus.roomId;
  const members = state.groupRooms.find((g) => g.roomId === roomId)?.members ?? [];
  // 归一化与倒序查找全部在 core 的纯函数里（可单测，且符合「壳层不写域逻辑」的分层铁律）
  state.activeGroupSpeaker = resolveGroupSpeaker(state.messages, members, state.profiles);
}

/** 进入指定多 Agent 研讨会议室并载入研讨记录 */
async function openGroupRoom(roomId: string): Promise<void> {
  if (!roomId || !gatewayClient) return;
  // 切换焦点域前解除挂起回滚，防止普通会话的乐观裁撤横幅泄漏进群聊视图
  disarmRollbackOnLeave();
  state.activeFocus = { type: 'group', roomId };
  applyEnteredRead(unreadGroupRoomIds, roomId);
  activityTransitionTracker.clear('group', roomId);
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
  turnExecutionService.resetActiveGroupThread();
  // 【在场指示器】换房间立刻清空说话者：上一个房间的成员绝不能在新房间被高亮
  state.activeGroupSpeaker = null;

  // 从 groups.log 拉取官方事件流
  let fetchedLogs: GroupMessageEntry[] = [];
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
    fetchedLogs = logs ? [...logs] : [];
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
  // 【在场指示器】按真实日志末条事件推导说话者（详见 syncActiveGroupSpeakerFromMessages 注释）
  syncActiveGroupSpeakerFromMessages();
  render();

  if (hostedRoomIds.has(roomId) && activeRunningGroupRoomIds.has(roomId) && !groupPollerManager.isPolling(roomId)) {
    groupPollerManager.startAwaitReply(roomId, captureGroupLogBaseline(fetchedLogs));
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
  activityTransitionTracker.clear('bot', botProfile);

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
  for (const s of state.sessions) {
    if (!s.botName) continue;
    const profile = byName.get(s.botName.toLowerCase());
    if (profile && s.botDisplayName !== profile.displayName) {
      s.botDisplayName = profile.displayName;
    }
  }
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
          botActivityStore.updateLatestActivity(p.name, previewText, numTs);
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
let sessionSwitchPending = false;
let settleMinFrames = 0;
let streamScrollCooldown = false;
let lastStreamScrollTop = 0;
let initialBottomSettling = false;
let settledLayoutSignature = '';
let readerScrolledSessionId = '';
let programmaticScrollTarget: number | null = null;
let programmaticScrollIgnoreUntil = 0;
let olderLoadingStartedAt = 0;
let averageRowHeightPx = 96;
let averageRowHeightSessionId = '';
let averageRowHeightLocked = false;
let layoutDriftUntil = 0;
let observedWindowHeight = 0;

const messageWindowManager = createMessageWindowManager({
  getState: () => state,
  render: () => render(),
  isStreamNearBottom: (stream) => isStreamNearBottom(stream),
  scrollStreamToBottom: (reason) => scrollStreamToBottom(reason),
  scrollStreamToContentBottom: (stream, inset) => scrollStreamToContentBottom(stream, inset),
  settleInitialBottom: () => settleInitialBottom(),
  syncPromptNavigatorFromScroll: () => syncPromptNavigatorFromScroll(),
  setCanvasStructureDirty: (val) => { canvasStructureDirty = val; },
  setSuppressPinBottomOnce: (val) => { suppressPinBottomOnce = val; },
  setSessionSwitchPending: (val) => { sessionSwitchPending = val; },
  setSettleMinFrames: (val) => { settleMinFrames = val; },
  setInitialBottomSettling: (val) => { initialBottomSettling = val; },
  setSettledLayoutSignature: (val) => { settledLayoutSignature = val; },
  setLastStreamScrollTop: (val) => { lastStreamScrollTop = val; },
  setStreamScrollCooldown: (val) => { streamScrollCooldown = val; },
  logScroll,
});

function syncWindowLocalState(): void {
  messageWindowStart = messageWindowManager.getMessageWindowStart();
  messageWindowEnd = messageWindowManager.getMessageWindowEnd();
  messageWindowUserExpanded = messageWindowManager.isMessageWindowUserExpanded();
  averageRowHeightPx = messageWindowManager.getAverageRowHeightPx();
  averageRowHeightLocked = messageWindowManager.isAverageRowHeightLocked();
  layoutDriftUntil = messageWindowManager.getLayoutDriftUntil();
  programmaticScrollTarget = messageWindowManager.getProgrammaticScrollTarget();
  programmaticScrollIgnoreUntil = messageWindowManager.getProgrammaticScrollIgnoreUntil();
  readerScrolledSessionId = messageWindowManager.getReaderScrolledSessionId();
}

function layoutSignature(): string {
  return messageWindowManager.layoutSignature();
}

function markProgrammaticScroll(stream: HTMLElement): void {
  messageWindowManager.markProgrammaticScroll(stream);
  syncWindowLocalState();
}

function ensureMessageWindow(total: number): void {
  messageWindowManager.ensureMessageWindow(total);
  syncWindowLocalState();
}

function expandMessageWindow(): boolean {
  const result = messageWindowManager.expandMessageWindow();
  syncWindowLocalState();
  return result;
}

function slideMessageWindowForward(): void {
  messageWindowManager.slideMessageWindowForward();
  syncWindowLocalState();
}

function relocateMessageWindowToIndex(index: number): boolean {
  const result = messageWindowManager.relocateMessageWindowToIndex(index);
  syncWindowLocalState();
  return result;
}

function syncScrollTopToWindow(reason: string): void {
  messageWindowManager.syncScrollTopToWindow(reason);
  syncWindowLocalState();
}

function scheduleVirtualHeightSync(attempt = 0): void {
  messageWindowManager.scheduleVirtualHeightSync(attempt);
  syncWindowLocalState();
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
  hasOlder: false,
  isLoadingOlder: false,
});

/** 统一群聊研讨室三态判定：hostedRoomIds、groupRooms 列表或当前焦点为 group 均视为群聊域。 */
function isGroupConversationActive(sessionId = state.activeSessionId): boolean {
  return (
    hostedRoomIds.has(sessionId) ||
    state.groupRooms.some((g) => g.roomId === sessionId) ||
    state.activeFocus.type === 'group'
  );
}

function currentPromptNavigatorMeta() {
  return {
    locale: state.lang,
    hasOlderMessages: state.hasOlderMessages,
    isLoadingOlder: state.isLoadingOlder,
    isGroupRoom: isGroupConversationActive(),
  };
}

/** 统一构造导航器快照：三态隔离下群聊研讨室禁止暴露单会话翻页入口。 */
function buildPromptNavigatorSnapshot(
  prompts: readonly PromptEntry[],
  activeIndex: number
): PromptNavigatorSnapshot {
  return buildHostPromptNavigatorSnapshot(prompts, activeIndex, currentPromptNavigatorMeta());
}

/** 仅比较元信息（hasOlder / isLoadingOlder / locale），不变时避免重复重建快照对象。 */
function isPromptNavigatorMetaSame(snapshot: PromptNavigatorSnapshot | null): boolean {
  return isHostPromptNavigatorMetaSame(snapshot, currentPromptNavigatorMeta());
}

/** 同步导航器的加载态与历史余量元信息，不触发宿主全量 render。 */
function syncPromptNavigatorMeta(): void {
  const current = promptNavigatorSnapshot;
  if (!current) return;
  if (isPromptNavigatorMetaSame(current)) return;
  promptNavigatorSnapshot = buildPromptNavigatorSnapshot(current.prompts, current.activeIndex);
  syncPromptNavigator();
}

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
      ? buildPromptNavigatorSnapshot(promptNavigatorEntries, -1)
      : buildPromptNavigatorSnapshot(promptNavigatorEntries, promptNavigatorEntries.length - 1);
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
    if (
      promptNavigatorSnapshot &&
      (promptNavigatorSnapshot.prompts.length > 0 || !isPromptNavigatorMetaSame(promptNavigatorSnapshot))
    ) {
      promptNavigatorSnapshot = buildPromptNavigatorSnapshot(promptNavigatorEntries, -1);
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
  if (next === (promptNavigatorSnapshot?.activeIndex ?? -1) && isPromptNavigatorMetaSame(promptNavigatorSnapshot)) return;
  promptNavigatorSnapshot = buildPromptNavigatorSnapshot(promptNavigatorEntries, next);
  syncPromptNavigator();
}

/** 导航轨动作表：只传消息 id，宿主用 id 反查（下标会被前置翻页整体平移）。 */
function createPromptNavigatorActions(): PromptNavigatorActions {
  return {
    onSelect: (messageId: string) => {
      jumpToPrompt(messageId);
    },
    onLoadOlder: () => {
      void loadOlderMessages({ preserveViewportWindow: true });
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
      font-size: var(--fs-xs, 12px);
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

const sessionMessagesCache = new Map<string, MessageViewModel[]>();
let activeLoadMessagesGeneration = 0;

const messageLoadingService = createMessageLoadingService({
  getState: () => state,
  getGatewayClient: () => gatewayClient,
  render: () => render(),
  sessionMessagesCache,
  cacheService,
  persistMessagesToCache: (channelRef, messages, fenceMax) => persistMessagesToCache(channelRef, messages, fenceMax ?? 0),
  syncPromptNavigatorMeta: () => syncPromptNavigatorMeta(),
  syncPromptNavigatorFromScroll: () => syncPromptNavigatorFromScroll(),
  scrollStreamToBottom: (reason) => scrollStreamToBottom(reason ?? ''),
  setPendingScrollToBottom: (val) => { pendingScrollToBottom = val; },
  isStreamNearBottom: (el) => isStreamNearBottom(el),
  captureStreamAnchor: () => captureStreamAnchor(),
  applyStreamAnchor: (anchor, maintain) => applyStreamAnchor(anchor as StreamAnchor, maintain ?? false),
  getMessageWindowStart: () => messageWindowStart,
  setMessageWindowStart: (val) => { messageWindowStart = val; },
  getMessageWindowEnd: () => messageWindowEnd,
  setMessageWindowEnd: (val) => { messageWindowEnd = val; },
  setMessageWindowUserExpanded: (val) => { messageWindowUserExpanded = val; },
  setCanvasStructureDirty: (val) => { canvasStructureDirty = val; },
  setSuppressPinBottomOnce: (val) => { suppressPinBottomOnce = val; },
  isGroupConversationActive: (id) => isGroupConversationActive(id),
  hostedRoomIds,
  formatSessionTime,
  formatTimestamp: (ts) => formatTimestamp(ts),
  botActivityStore,
  botForeverChatCache,
  sessionPreviewCache,
  persistSessionPreviewCache: () => persistSessionPreviewCache(),
  getActiveStreamingStoredSessionId: () => activeStreamingStoredSessionId,
  defaultSessionHandleRegistry,
  activeRunningSessionIds,
  activityTransitionTracker,
  getGeneration: () => activeLoadMessagesGeneration,
  onGenerationIncremented: (gen: number) => { activeLoadMessagesGeneration = gen; },
  logSession,
  logScroll,
});

const sessionServerOffset = messageLoadingService.sessionServerOffset;
const sessionAuthoritativeOffset = messageLoadingService.sessionAuthoritativeOffset;
const sessionParentOffsetMap = messageLoadingService.sessionParentOffsetMap;
const sessionOvershootRetry = messageLoadingService.sessionOvershootRetry;
const sessionHistoryTrust = messageLoadingService.sessionHistoryTrust;
const untrustedOrderCacheSessions = messageLoadingService.untrustedOrderCacheSessions;

function forgetOlderCursorState(sessionId: string): void {
  messageLoadingService.forgetOlderCursorState(sessionId);
}

function syncUntrustedCacheOrderFlag(sessionId: string, rows: readonly CachedMessageRow[]): void {
  messageLoadingService.syncUntrustedCacheOrderFlag(sessionId, rows);
}

function hasRemainingParentLineage(sessionId: string): boolean {
  return messageLoadingService.hasRemainingParentLineage(sessionId);
}

const sessionOperationService = createSessionOperationService({
  getState: () => state,
  getGatewayClient: () => gatewayClient,
  getDesktopApi: () => desktopApi,
  getCurrentTicket: () => currentTicket ?? null,
  getEffectiveUrl: (url) => getEffectiveUrl(url ?? state.gatewayUrl),
  render: () => render(),
  t,
  showToast,
  setTimedDockNotice,
  restoreComposerFocus: () => restoreComposerFocus(),
  sessionDrafts,
  sessionMessagesCache,
  unreadSessionIds,
  activeRunningSessionIds,
  activityTransitionTracker,
  sessionHandleRegistry: defaultSessionHandleRegistry,
  cacheService,
  persistSessionsToCache: (sessions) => persistSessionsToCache(sessions),
  forgetOlderCursorState: (id) => messageLoadingService.forgetOlderCursorState(id),
  sessionListGeneration,
  getActiveStreamingStoredSessionId: () => activeStreamingStoredSessionId,
  resetActiveStreamingState: () => {
    tokenCoalescer.clear();
    disarmTurnWatchdog();
    activeStreamingMessageId = null;
    activeStreamingStoredSessionId = null;
    activeStreamingLiveId = null;
    activeStreamingBotName = null;
    state.isStreaming = false;
  },
  setPendingScrollToBottom: (val) => { pendingScrollToBottom = val; },
  setLastMessagesSnapshot: (val) => { lastMessagesSnapshot = val as RenderMessagesSnapshot | null; },
  loadMessages: (id, botName) => loadMessages(id, botName),
  openBotChat: (botName) => openBotChat(botName),
  ensureLiveSessionId: () => ensureLiveSessionId(),
  fetchSessions: () => fetchSessions(),
  incrementActiveLoadMessagesGeneration: () => {
    const next = messageLoadingService.incrementGeneration();
    activeLoadMessagesGeneration = next;
    return next;
  },
});
/** core 交互区领域服务单例（截断/分支/目录的唯一 wire 载荷构造入口） */
const interactiveService = new InteractiveService();

/**
 * 输入补全领域（斜杠命令 + 文件 mention）。
 *
 * 【设计意图 (Why)】该领域的状态全部写入点都在自己内部，因此整簇搬到
 * completion/inputCompletion.ts，宿主只注入「当前会话上下文」与「重绘」两个能力。
 * 这里以 getter 注入而非传值，保证 domain 每次读到的都是最新焦点，不会持有过期快照。
 */
const inputCompletion = createInputCompletion(
  {
    activeSessionId: () => state.activeSessionId,
    profileName: () => state.profileName,
    activeCwd: () => {
      const sess = state.sessions.find((s) => s.id === state.activeSessionId);
      if (sess?.cwd) return sess.cwd;
      const proj = state.projects.find(
        (p) => p.id === sess?.projectId || (sess?.projectName && p.name === sess.projectName),
      );
      return proj?.path || '';
    },
    openFiles: () => state.openFiles,
    agentMentionItems: () => state.mentionItems.filter((m) => m.type === 'agent'),
    inputText: () => {
      // 补全层只要"整段输入"，这里读取真实输入框；不存在时视为空串。
      const el = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
      return el ? el.value : '';
    },
    setMentionItems: (items) => {
      state.mentionItems = items;
    },
    setMentionPopperOpen: (open) => {
      state.mentionPopperOpen = open;
    },
    setSlashItems: (items) => {
      state.slashItems = items;
    },
    setSlashPopperOpen: (open) => {
      state.slashPopperOpen = open;
    },
    render: () => render(),
    isGatewayReady: () => Boolean(gatewayClient),
    rpcCaller: () => rpcCaller,
  },
  interactiveService,
);

function parseRawMessages(list: any[]): MessageViewModel[] {
  return messageLoadingService.parseRawMessages(list);
}

async function loadOlderMessages(options?: { preserveViewportWindow?: boolean }): Promise<void> {
  return messageLoadingService.loadOlderMessages(options);
}

function syncActiveSessionPreviewToRail(sessionId: string, messages: MessageViewModel[], botName?: string): void {
  messageLoadingService.syncActiveSessionPreviewToRail(sessionId, messages, botName);
}

async function loadMessages(sessionId: string, targetBotName?: string): Promise<void> {
  const cached = sessionId ? sessionMessagesCache.get(sessionId) : undefined;
  state.messagesPhase = cached && cached.length > 0 ? 'ready' : 'loading';
  const expectedGeneration = activeLoadMessagesGeneration + 1;
  try {
    await messageLoadingService.loadMessagesInner(sessionId, targetBotName);
  } finally {
    if (!sessionId || expectedGeneration === activeLoadMessagesGeneration) {
      state.messagesPhase = 'ready';
      render();
    }
  }
}

async function loadMessagesInner(sessionId: string, targetBotName?: string): Promise<void> {
  return messageLoadingService.loadMessagesInner(sessionId, targetBotName);
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
  return sessionOperationService.createNewSession(options);
}

async function deleteSession(id: string): Promise<void> {
  return sessionOperationService.deleteSession(id);
}

async function renameSession(id: string, currentTitle: string): Promise<void> {
  return sessionOperationService.renameSession(id, currentTitle);
}

async function copySessionId(id: string): Promise<void> {
  return sessionOperationService.copySessionId(id);
}

async function pinSession(id: string): Promise<void> {
  return sessionOperationService.pinSession(id);
}

async function exportMarkdown(id: string): Promise<void> {
  return sessionOperationService.exportMarkdown(id);
}

async function archiveSession(id: string): Promise<void> {
  return sessionOperationService.archiveSession(id);
}

function handleArmedOnDelete(id: string): void {
  sessionOperationService.handleArmedOnDelete(id);
}

function disarmRollbackOnLeave(outgoingSessionId?: string): void {
  sessionOperationService.disarmRollbackOnLeave(outgoingSessionId);
}

async function selectSession(id: string, options?: { preserveFocus?: boolean; botName?: string }): Promise<void> {
  return sessionOperationService.selectSession(id, options);
}

async function applyModelToLiveSession(model: string, provider?: string): Promise<void> {
  return sessionOperationService.applyModelToLiveSession(model, provider);
}

async function switchModel(model: string, provider?: string): Promise<void> {
  return sessionOperationService.switchModel(model, provider);
}

async function switchReasoning(effort: AppState['reasoningLevel']): Promise<void> {
  return sessionOperationService.switchReasoning(effort);
}

async function switchApproval(mode: 'manual' | 'smart' | 'off'): Promise<void> {
  return sessionOperationService.switchApproval(mode);
}


const turnExecutionService = createTurnExecutionService({
  getState: () => state,
  getGatewayClient: () => gatewayClient,
  getRpcCaller: () => rpcCaller,
  getInteractiveService: () => interactiveService,
  getCacheService: () => cacheService,
  getGroupRoomStore: () => groupRoomStore,
  getActivityTransitionTracker: () => activityTransitionTracker,
  getTokenCoalescer: () => tokenCoalescer,
  getSessionHandleRegistry: () => defaultSessionHandleRegistry,
  getSessionMessagesCache: () => sessionMessagesCache,
  getSessionDrafts: () => sessionDrafts,
  getBotActivityStore: () => botActivityStore,
  getHandoffService: () => handoffService,
  completeEntityTurn,

  getActiveRunningSessionIds: () => activeRunningSessionIds,
  getUnreadSessionIds: () => unreadSessionIds,
  getActiveRunningBotNames: () => activeRunningBotNames,
  getUnreadBotNames: () => unreadBotNames,
  getActiveRunningGroupRoomIds: () => activeRunningGroupRoomIds,
  getUnreadGroupRoomIds: () => unreadGroupRoomIds,

  getActiveStreamingContext: () => ({
    activeStreamingMessageId,
    activeStreamingStoredSessionId,
    activeStreamingLiveId,
    activeStreamingBotName,
  }),
  setActiveStreamingContext: (ctx) => {
    if ('activeStreamingMessageId' in ctx) activeStreamingMessageId = ctx.activeStreamingMessageId ?? null;
    if ('activeStreamingStoredSessionId' in ctx) activeStreamingStoredSessionId = ctx.activeStreamingStoredSessionId ?? null;
    if ('activeStreamingLiveId' in ctx) activeStreamingLiveId = ctx.activeStreamingLiveId ?? null;
    if ('activeStreamingBotName' in ctx) activeStreamingBotName = ctx.activeStreamingBotName ?? null;
  },
  getTurnStartedSessionId: () => turnStartedSessionId,
  setTurnStartedSessionId: (id) => { turnStartedSessionId = id; },

  getSessionHistoryTrust: () => sessionHistoryTrust,
  forgetOlderCursorState: (id) => messageLoadingService.forgetOlderCursorState(id),
  createNewSession: () => createNewSession(),
  ensureLiveSessionId: () => ensureLiveSessionId(),
  setMessageContent: (mid, content) => setMessageContent(mid, content),
  syncActiveGroupSpeakerFromMessages: () => syncActiveGroupSpeakerFromMessages(),
  resolveAgentAvatar: (name) => resolveAgentAvatar(name),
  scrollStreamToBottom: (reason) => scrollStreamToBottom(reason),
  setPendingScrollToBottom: (val) => { pendingScrollToBottom = val; },

  runSlashCommand: (cmd) => inputDockController.runSlashCommand(cmd),
  enqueueDraft: () => inputDockController.enqueueDraft(),
  handleQueueAction: (action, id) => inputDockController.handleQueueAction(action, id),

  render: () => render(),
  t,
  logStream,
});

const groupPollerManager = turnExecutionService.getGroupPollerManager();

const gatewayEventDispatcher = createGatewayEventDispatcher({
  getState: () => state,
  getGatewayClient: () => gatewayClient,
  setGatewayClient: (client) => { gatewayClient = client; },
  getCurrentTicket: () => currentTicket,
  setCurrentTicket: (ticket) => { currentTicket = ticket; },
  getDesktopApi: () => desktopApi,
  getEffectiveUrl: (url) => getEffectiveUrl(url ?? state.gatewayUrl),
  testConnection: (url, user, pass) => testConnection(url, user, pass),
  completeEntityTurn,

  getSessionHandleRegistry: () => defaultSessionHandleRegistry,
  getSessionMessagesCache: () => sessionMessagesCache,
  getTokenCoalescer: () => tokenCoalescer,
  getActivityTransitionTracker: () => activityTransitionTracker,
  getBotActivityStore: () => botActivityStore,
  getCacheService: () => cacheService,

  getActiveRunningSessionIds: () => activeRunningSessionIds,
  getUnreadSessionIds: () => unreadSessionIds,
  getActiveRunningBotNames: () => activeRunningBotNames,
  getUnreadBotNames: () => unreadBotNames,
  getActiveRunningGroupRoomIds: () => activeRunningGroupRoomIds,
  getUnreadGroupRoomIds: () => unreadGroupRoomIds,

  getActiveStreamingContext: () => ({
    activeStreamingMessageId,
    activeStreamingStoredSessionId,
    activeStreamingLiveId,
    activeStreamingBotName,
  }),
  setActiveStreamingContext: (ctx) => {
    if ('activeStreamingMessageId' in ctx) activeStreamingMessageId = ctx.activeStreamingMessageId ?? null;
    if ('activeStreamingStoredSessionId' in ctx) activeStreamingStoredSessionId = ctx.activeStreamingStoredSessionId ?? null;
    if ('activeStreamingLiveId' in ctx) activeStreamingLiveId = ctx.activeStreamingLiveId ?? null;
    if ('activeStreamingBotName' in ctx) activeStreamingBotName = ctx.activeStreamingBotName ?? null;
  },
  getTurnStartedSessionId: () => turnStartedSessionId,
  setTurnStartedSessionId: (id) => { turnStartedSessionId = id; },

  stopProfileAutoRefresh: () => stopProfileAutoRefresh(),
  startProfileAutoRefresh: () => startProfileAutoRefresh(),
  stopAllGroupPollers: () => groupPollerManager.stopAll(),
  clearTransitionRefreshTimer: () => clearTransitionRefreshTimer(),
  clearSessionsRefreshTimer: () => {
    if (sessionsRefreshTimer) {
      clearTimeout(sessionsRefreshTimer);
      sessionsRefreshTimer = null;
    }
  },
  scheduleSessionsRefresh: () => scheduleSessionsRefresh(),

  persistTurnToCache: (sid, bot, msgs) => persistTurnToCache(sid, bot, msgs),
  persistSessionsToCache: (sessions) => persistSessionsToCache(sessions),
  syncProfileLastMessages: () => syncProfileLastMessages(),
  syncAgentPresence: () => syncAgentPresence(),
  scheduleToolPatch: (mid) => scheduleToolPatch(mid),
  stopRunningToolTimers: () => stopRunningToolTimers(),
  setMessageContent: (mid, content) => setMessageContent(mid, content),
  toStoredSessionId: (id) => toStoredSessionId(id),

  applyColdStartFocus: () => applyColdStartFocus(),
  fetchProfiles: () => fetchProfiles(),
  fetchSessions: () => fetchSessions(),
  fetchGroupRooms: () => fetchGroupRooms(),
  fetchModelOptions: () => fetchModelOptions(),
  fetchProjects: () => fetchProjects(),
  prefetchSlashCatalog: () => inputCompletion.prefetchSlashCatalog(),

  armTurnWatchdog: () => turnExecutionService.armTurnWatchdog(),
  disarmTurnWatchdog: () => turnExecutionService.disarmTurnWatchdog(),
  clearPresenceTerminal: () => turnExecutionService.clearPresenceTerminal(),
  armPresenceTerminal: (terminal) => turnExecutionService.armPresenceTerminal(terminal),
  setTimedDockNotice: (msg, dur) => turnExecutionService.setTimedDockNotice(msg, dur),

  render: () => render(),
  t,
});

/** Force-unlocks the composer if a turn goes silent, so the UI can never latch. */
function armTurnWatchdog(): void {
  turnExecutionService.armTurnWatchdog();
}

function disarmTurnWatchdog(): void {
  turnExecutionService.disarmTurnWatchdog();
}

function isStreamingActiveForCurrentSession(): boolean {
  return turnExecutionService.isStreamingActiveForCurrentSession();
}

function clearPresenceTerminal(): void {
  turnExecutionService.clearPresenceTerminal();
}

function armPresenceTerminal(terminal: NonNullable<AppState['presenceTerminal']>): void {
  turnExecutionService.armPresenceTerminal(terminal);
}

function setTimedDockNotice(msg: string, durationMs = 4000): void {
  turnExecutionService.setTimedDockNotice(msg, durationMs);
}

/** Asks the gateway to stop the running turn (the composer turns into a stop button). */
async function interruptTurn(): Promise<void> {
  return turnExecutionService.interruptTurn();
}

/** 向托管群聊房间发送一条人类消息（官方 groups.send 契约） */
async function sendGroupMessage(roomId: string, text: string): Promise<void> {
  return turnExecutionService.sendGroupMessage(roomId, text);
}

function syncGroupRoomLogsToState(roomId: string, logs: readonly GroupMessageEntry[]): void {
  turnExecutionService.syncGroupRoomLogsToState(roomId, logs);
}

/** 回读群聊房间日志并增量刷新中间对话舱 */
async function refreshGroupRoomLog(roomId: string): Promise<number> {
  return turnExecutionService.refreshGroupRoomLog(roomId);
}

async function sendMessage(text: string): Promise<void> {
  return turnExecutionService.sendMessage(text);
}

async function routeSend(text: string): Promise<void> {
  return turnExecutionService.routeSend(text);
}

async function enqueueDraft(): Promise<void> {
  return turnExecutionService.enqueueDraft();
}

async function handleQueueAction(action: string, admissionId: string): Promise<void> {
  return turnExecutionService.handleQueueAction(action, admissionId);
}

async function runSlashCommand(command: string): Promise<void> {
  return inputDockController.runSlashCommand(command);
}

async function askSideAgent(
  kind: 'btw' | 'delegation',
  targetProfile: string,
  question: string
): Promise<void> {
  return turnExecutionService.askSideAgent(kind, targetProfile, question);
}

function armCapsuleTimers(taskId: string): void {
  turnExecutionService.armCapsuleTimers(taskId);
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
  gatewayEventDispatcher.applyTurnActions(actions);
}

/** Inspector-side events (artifacts, browser frames, workspace diffs). */
function handleInspectorEvent(params: unknown): void {
  gatewayEventDispatcher.handleInspectorEvent(params);
}

function getConnectionEpoch(): number {
  return gatewayEventDispatcher.getConnectionEpoch();
}

async function connect(targetUrl?: string): Promise<void> {
  return gatewayEventDispatcher.connect(targetUrl);
}

function disconnect(): void {
  gatewayEventDispatcher.disconnect();
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
    markProgrammaticScroll(stream);
    logScroll.debug('post-layout anchor drift absorbed', { id: anchor.id, drift: Math.round(drift) });
  }
}

let lastMessagesSnapshot: RenderMessagesSnapshot | null = null;
let lastInputDockSnapshot: RenderInputDockSnapshot | null = null;

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

async function disbandGroupRoom(roomId: string): Promise<void> {
  if (!gatewayClient) return;
  await groupRoomStore.disbandRoom(roomId, gatewayClient);
  groupPollerManager.stop(roomId);
  settleTurnTermination({
    runningSessionIds: activeRunningSessionIds,
    runningBotNames: activeRunningBotNames,
    runningGroupRoomIds: activeRunningGroupRoomIds,
    groupRoomId: roomId,
  });
  unreadGroupRoomIds.delete(roomId);
  activityTransitionTracker.clear('group', roomId);
  await fetchGroupRooms();
  if (state.activeFocus.type === 'group' && state.activeFocus.roomId === roomId) {
    if (state.sessions.length > 0) void selectSession(state.sessions[0].id);
  }
}

const modalInteractionController = createModalInteractionController({
  getState: () => state,
  commitState: (patch) => { Object.assign(state, patch); },
  requestRender: () => render(),
  restoreComposerFocus: () => restoreComposerFocus(),
  createNewSession: (opts) => createNewSession(opts),
  deleteSession: (id) => deleteSession(id),
  renameSession: (id, title) => renameSession(id, title),
  pinSession: (id) => pinSession(id),
  archiveSession: (id) => archiveSession(id),
  exportMarkdown: (id) => exportMarkdown(id),
  copySessionId: (id) => copySessionId(id),
  openBotChat: (profile) => openBotChat(profile),
  openBotSettings: (profile) => openBotSettings(profile),
  openGroupRoom: (roomId) => openGroupRoom(roomId),
  createGroupRoom: (title, members) => groupRoomStore.createRoom(title, members, gatewayClient!),
  disbandGroupRoom: (roomId) => disbandGroupRoom(roomId),
  fetchGroupRooms: () => fetchGroupRooms(),
  t: (key, params) => t(key, params),
});

function closeConfirmModal(action: 'ok' | 'cancel'): void {
  modalInteractionController.closeConfirmModal(action);
}

const inputDockController = createInputDockController({
  getState: () => state,
  commitState: (patch) => { Object.assign(state, patch); },
  requestRender: () => render(),
  routeSend: (text) => routeSend(text),
  interruptTurn: () => interruptTurn(),
  handleRollbackCancel: () => handleRollbackCancel(),
  requestSlashCompletion: (prefix) => inputCompletion.requestSlashCompletion(prefix),
  requestPathCompletion: (query, agentItems) => inputCompletion.requestPathCompletion(query, agentItems),
  isStreamingActiveForCurrentSession: () => isStreamingActiveForCurrentSession(),
  t: (key, params) => t(key, params),
  clearDockNoticeDismissTimer: () => {
    if (dockNoticeDismissTimer) {
      clearTimeout(dockNoticeDismissTimer);
      dockNoticeDismissTimer = null;
    }
  },
  setTimedDockNotice: (msg) => setTimedDockNotice(msg),
  getGatewayClient: () => gatewayClient,
  ensureLiveSessionId: () => ensureLiveSessionId(),
  createNewSession: () => createNewSession(),
  sendMessage: (text) => sendMessage(text),
  interactiveService: interactiveService,
  getRpcCaller: () => rpcCaller,
  describeRpcError: (err) => describeRpcError(err),
});

function syncComposerHeight(): void {
  const inputEl = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
  inputDockController.syncComposerHeight(inputEl);
}

function handleSend(source: 'button' | 'enter'): void {
  inputDockController.handleSend(source);
}

async function addInputAttachments(fileList: FileList | File[]): Promise<void> {
  await inputDockController.addInputAttachments(fileList);
}

function syncComposerPoppers(): void {
  inputDockController.syncComposerPoppers();
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
  activeSessionId: string;
  activeFocus: LeftRailActiveFocus;
  profileName: string;
  searchQuery: string;
  isSessionsGroupExpanded: boolean;
  isGroupsGroupExpanded: boolean;
  error: string;
  collapsed: boolean;
  editingGroupRoomId?: string;
  profilesPhase: DataPhase;
  sessionsPhase: DataPhase;
  activityVariant: ActivityIndicatorVariant;
}
let lastLeftRailSnapshot: LeftRailSnapshot | null = null;
let lastLeftRailInputs: LeftRailSnapshotInputs | null = null;

function sameLeftRailInputs(prev: LeftRailSnapshotInputs, next: LeftRailSnapshotInputs): boolean {
  return prev.sessions === next.sessions
    && prev.groups === next.groups
    && prev.profiles === next.profiles
    && prev.activeSessionId === next.activeSessionId
    && prev.activeFocus === next.activeFocus
    && prev.profileName === next.profileName
    && prev.searchQuery === next.searchQuery
    && prev.isSessionsGroupExpanded === next.isSessionsGroupExpanded
    && prev.isGroupsGroupExpanded === next.isGroupsGroupExpanded
    && prev.error === next.error
    && prev.collapsed === next.collapsed
    && prev.profilesPhase === next.profilesPhase
    && prev.sessionsPhase === next.sessionsPhase
    && prev.activityVariant === next.activityVariant
    && prev.editingGroupRoomId === next.editingGroupRoomId;
}

/** 元素引用完全一致时复用旧数组，保证行组件收到的数组 prop 也稳定。 */
function stableArray<T>(next: T[], previous: T[]): T[] {
  return next.length === previous.length && next.every((item, index) => item === previous[index]) ? previous : next;
}

function decorateRailSessions(nowMs: number): LeftRailSession[] {
  const next = state.sessions.map((s) => {
    const activityState = resolveActivityState(s.id, {
      runningIds: activeRunningSessionIds,
      unreadIds: unreadSessionIds,
      streamingId: activeStreamingStoredSessionId,
    });
    const transitionRes = activityTransitionTracker.resolveTransition('session', s.id, activityState, nowMs);
    const activityTransition: ActivityTransition = transitionRes.transition;
    const activityTransitionToken = transitionRes.transitionToken;
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
      && cached.value.activityState === activityState
      && cached.value.activityTransition === activityTransition
      && cached.value.activityTransitionToken === activityTransitionToken) {
      return cached.value;
    }
    const value: LeftRailSession = {
      ...s,
      isPinned: s.pinned,
      activityState,
      activityTransition,
      activityTransitionToken,
    };
    railSessionDecorCache.set(s, { stamp: '', value });
    return value;
  });
  lastDecoratedSessions = stableArray(next, lastDecoratedSessions);
  return lastDecoratedSessions;
}

function decorateRailGroups(nowMs: number): LeftRailGroupRoom[] {
  const next = state.groupRooms.map((g) => {
    const activityState = resolveActivityState(g.roomId, {
      runningIds: activeRunningGroupRoomIds,
      unreadIds: unreadGroupRoomIds,
    });
    const transitionRes = activityTransitionTracker.resolveTransition('group', g.roomId, activityState, nowMs);
    const activityTransition: ActivityTransition = transitionRes.transition;
    const activityTransitionToken = transitionRes.transitionToken;
    const stamp = [
      g.name,
      (g.members || []).join('\u0002'),
      g.lastMessage,
      g.updatedAt,
      g.createdAt,
      activityState,
      activityTransition,
      activityTransitionToken ?? '',
    ].join('\u0001');
    const cached = railGroupDecorCache.get(g);
    if (cached && cached.stamp === stamp) return cached.value;
    const value: LeftRailGroupRoom = {
      ...g,
      activityState,
      activityTransition,
      activityTransitionToken,
    };
    railGroupDecorCache.set(g, { stamp, value });
    return value;
  });
  lastDecoratedGroups = stableArray(next, lastDecoratedGroups);
  return lastDecoratedGroups;
}

function decorateRailProfiles(nowMs: number): LeftRailProfile[] {
  const next = state.profiles.map((p) => {
    const avatar = p.avatar || resolveAgentAvatar(p.name) || (p.displayName ? resolveAgentAvatar(p.displayName) : '') || '';
    const activityState = resolveActivityState(p.name, {
      runningIds: activeRunningBotNames,
      unreadIds: unreadBotNames,
    });
    const transitionRes = activityTransitionTracker.resolveTransition('bot', p.name, activityState, nowMs);
    const activityTransition: ActivityTransition = transitionRes.transition;
    const activityTransitionToken = transitionRes.transitionToken;
    const stamp = [
      p.name,
      p.displayName,
      avatar,
      p.description,
      p.lastMessage,
      p.lastTime,
      p.timestamp,
      p.isDefault ? 1 : 0,
      activityState,
      activityTransition,
      activityTransitionToken ?? '',
    ].join('\u0001');
    const cached = railProfileDecorCache.get(p);
    if (cached && cached.stamp === stamp) return cached.value;
    const value: LeftRailProfile = {
      ...p,
      avatar,
      activityState,
      activityTransition,
      activityTransitionToken,
    };
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
  const nowMs = Date.now();
  const sessions = decorateRailSessions(nowMs);
  const groups = decorateRailGroups(nowMs);
  const profiles = decorateRailProfiles(nowMs);
  const inputs: LeftRailSnapshotInputs = {
    sessions,
    groups,
    profiles,
    activeSessionId: state.activeSessionId,
    activeFocus: state.activeFocus,
    profileName: state.profileName,
    searchQuery: state.sessionSearchQuery,
    isSessionsGroupExpanded: state.isSessionsGroupExpanded !== false,
    isGroupsGroupExpanded: state.isGroupsGroupExpanded !== false,
    error: state.sessionListError,
    collapsed: state.leftRailCollapsed,
    editingGroupRoomId: state.editingGroupRoomId,
    profilesPhase: state.profilesPhase,
    sessionsPhase: state.sessionsPhase,
    activityVariant: activityIndicatorVariant,
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
    activityVariant: activityIndicatorVariant,
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

const renderCoordinator = createRenderCoordinator({
  getState: () => state,
  messageWindowManager,
  modalInteractionController,
  isStreamingActiveForCurrentSession: () => isStreamingActiveForCurrentSession(),
  resolveSessionKnownFiles: () => resolveSessionKnownFiles(),
  getTitlebarSnapshot: () => getTitlebarSnapshot(),
  onMinimizeWindow: () => desktopApi?.minimize(),
  onMaximizeWindow: async () => {
    if (!desktopApi) return;
    const result = await desktopApi.maximize();
    state.isMaximized = typeof result === 'boolean' ? result : await desktopApi.isMaximized();
    render();
  },
  onCloseWindow: () => desktopApi?.close(),
  onToggleTheme: () => {
    state.theme = getToggleTheme(state.theme);
    localStorage.setItem('hermes_flux_theme', state.theme);
    localStorage.setItem('hermes_aura_theme', state.theme);
    render();
  },
  getLeftRailSnapshot: () => getLeftRailSnapshot(),
  createLeftRailActions: () => createLeftRailActions(),
  getPromptNavigatorSnapshot: () => getPromptNavigatorSnapshot(),
  createPromptNavigatorActions: () => createPromptNavigatorActions(),
  rebuildPromptEntries: () => rebuildPromptEntries(),
  syncPromptNavigatorMeta: () => syncPromptNavigatorMeta(),
  syncPromptNavigator: () => syncPromptNavigator(),
  syncReactSettings: () => syncReactSettings(),
  ensureSettingsSectionData: (section) => ensureSettingsSectionData(section),
  syncAgentPresenceHost: () => syncAgentPresenceHost(),
  syncAgentPresence: () => syncAgentPresence(),
  captureStreamAnchor: () => captureStreamAnchor(),
  applyStreamAnchor: (anchor, pin) => applyStreamAnchor(anchor, pin),
  stabilizeStreamAnchor: (anchor) => stabilizeStreamAnchor(anchor),
  isStreamNearBottom: (stream) => isStreamNearBottom(stream),
  syncStreamBottomInset: () => syncStreamBottomInset(),
  settleInitialBottom: () => settleInitialBottom(),
  bindEvents: () => bindEvents(),
  syncComposerPoppers: () => syncComposerPoppers(),
  logRender,
});

function lockAverageRowHeight(): boolean {
  const result = messageWindowManager.lockAverageRowHeight();
  syncWindowLocalState();
  return result;
}

function syncCanvasVirtualHeight(): void {
  messageWindowManager.syncCanvasVirtualHeight();
}

function observeVirtualWindowGeometry(attempt = 0): void {
  messageWindowManager.observeVirtualWindowGeometry(attempt);
  syncWindowLocalState();
}

function computeContentOffsetPx(): number {
  return messageWindowManager.computeContentOffsetPx();
}

function computeVirtualHeightPx(): number {
  return messageWindowManager.computeVirtualHeightPx();
}

function buildConversationSnapshot(): ConversationSnapshot {
  return renderCoordinator.buildConversationSnapshot();
}

function syncReactMessageList(force = false): void {
  renderCoordinator.syncReactMessageList(force);
}

/* --------------------------------------------------------------------------
 * Agent 在场指示器：宿主快照、指纹去重与挂载
 * -------------------------------------------------------------------------- */

/** 布局变体持久化键（与其它 `hermes_flux_*` 偏好同族；声明在 `state` 之前，见那里的注释） */

/** 读取持久化的布局变体；缺省 `stage`（改造前行为），非法值一律回落 */
function readPresenceLayout(): 'stage' | 'dock' {
  try {
    const raw = localStorage.getItem(PRESENCE_LAYOUT_STORAGE_KEY);
    return raw === 'dock' ? 'dock' : 'stage';
  } catch (error) {
    // 【失败不可静默 (Rules)】只有 localStorage 不可用（隐私模式 / 沙箱）才走到这里，
    //   必须留痕；其它异常（如声明顺序错误导致的 TDZ）不得被吞成「默认 stage」。
    console.warn('[presence] failed to read layout preference; falling back to stage', error);
    return 'stage';
  }
}

/** 持久化布局变体（隐私模式 / 配额溢出时降级，但不静默：必须留痕） */
function writePresenceLayout(layout: 'stage' | 'dock'): void {
  try {
    localStorage.setItem(PRESENCE_LAYOUT_STORAGE_KEY, layout);
  } catch (error) {
    // 【失败不可静默 (Rules)】落盘失败不回滚内存状态（本次会话内切换仍有效），
    //   但必须留下可观测痕迹，禁止空 catch 把配额/隐私模式问题吞掉。
    //   日志走英文：i18n 门禁只允许面向用户的文案进字典，诊断日志不进字典。
    console.warn('[presence] failed to persist layout preference; session-only', error);
  }
}

/**
 * 校正 host 位置并按需重挂 React 岛。
 *
 * 【设计意图 (Why)】把「找 host → 引用比对 → 卸载/挂载 → 推首帧」收敛成单一出口，
 *   供 `render()` 在**输入舱替换前后**各调用一次。两次调用是必须的：
 *   替换前保证输入舱里有宿主，替换后把被 `outerHTML` 连带销毁的宿主补回来。
 *
 * 【约束与规则 (Rules)】
 *   1. 幂等：host 引用未变时不卸载、不重挂、不白推；
 *   2. host 脱离文档（`!isConnected`）时按「host 变了」处理，先卸载再重建，
 *      否则 root 会挂在已销毁的节点上继续渲染（指示器永久消失且泄漏）；
 *   3. 无 host 时把节拍器停到 idle，避免每秒空转。
 */
function syncAgentPresenceHost(): void {
  /*
   * 【必须用 ensure 的返回值 (Pitfall)】MiddlePod 模板里有一个同 id 的静态空宿主。
   *   若这里改成 `document.getElementById(...)` 再取一次，未连接时 `ensureAgentPresenceHost`
   *   返回的 null 会被那个空 div 覆盖，守卫形同不存在——首屏又会挂出一个假的在场指示器。
   *   `ensure` 的返回值才是「本次有没有可用的宿主」的唯一真值。
   */
  const presenceHost = ensureAgentPresenceHost(state.presenceLayout);
  if (presenceHost && presenceHost === agentPresenceHost && presenceHost.isConnected) return;

  // host 换了 / 被销毁了：旧 root 挂在脱离文档的节点上，必须先卸载（否则泄漏）
  presenceMountHandle?.unmount();
  presenceMountHandle = null;
  updateReactAgentPresence = null;
  agentPresenceHost = presenceHost;
  lastAgentPresenceFingerprint = '';
  if (presenceHost) {
    // 先立群聊回合时钟再挂载：mount 内部会立刻读一次快照，锚点晚一步会让首帧语气档为 0
    const initialDomain = resolvePresenceDomain();
    ensureGroupTurnClock(initialDomain.groupRoomId, initialDomain.isRunning);
    // 挂载前先算好首帧快照：mount 内部会同步调用一次 getSnapshot
    pendingPresenceSnapshot = buildAgentPresenceSnapshot();
    presenceMountHandle = mountAgentPresence(presenceHost, getAgentPresenceSnapshot);
    updateReactAgentPresence = presenceMountHandle.update;
    // 挂载时 mount 内部已渲染首帧：同步记录指纹，避免下一次 render 白推一遍
    lastAgentPresenceFingerprint = agentPresenceFingerprint(pendingPresenceSnapshot);
  } else {
    // host 消失（如切到无对话区布局）：节拍器必须一起停，否则每秒空转
    ensurePresenceTicker('idle');
    pendingPresenceSnapshot = null;
  }
}

/**
 * 把在场指示器的 host 放到当前布局要求的位置。
 *
 * 【设计意图 (Why)】`stage` 变体悬浮在对话区顶部，host 属于 `.flux-middle-pod` 模板；
 *   `dock` 变体贴在输入舱上方，host 必须是 `.input-dock-container` 的首个子元素——
 *   只有这样才能靠 `bottom: calc(100% + 8px)` 精确贴住输入舱上沿，且不参与它的 flex 流。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 输入舱内容变化时宿主会 `existingDock.outerHTML = nextDockHtml` 整块替换容器，
 *      host 作为其子节点会被一并销毁。因此每次 render 都要重新校正位置并重建 host，
 *      否则指示器会在一次模型切换后永久消失。
 *   2. host 变化必须发生在 `syncAgentPresence` 之前：那里的 host 引用比对依赖
 *      `getElementById` 拿到的新节点。
 *
 * 【约束与规则 (Rules)】
 *   1. 只创建、不复制：同一时刻只允许存在一个 `#react-conv-presence-host`；
 *   2. `stage` 回落位置固定为 `#conversation-stream` 之后，与 MiddlePod 模板一致。
 */
function ensureAgentPresenceHost(layout: 'stage' | 'dock'): HTMLElement | null {
  /*
   * 【未连接不渲染 (Rules)】指示器回答的是「谁在当前会话里干活」：网关没连上时既没有会话、
   *   也没有 Agent 在跑，此时渲染一条「在角落里等你派活」是假状态。更关键的是，未连接的
   *   首屏只有 onboarding 卡片，而 stage 指示器悬浮在对话区顶部——真实 Blink 实测
   *   卡片顶边 107px、指示器底边 160px，文案会直接压在卡片标题上（重叠 53px）。
   *   dock 变体本来就会随输入舱一起消失，这里把两个变体收敛成同一条规则。
   *
   * 【必须卸载而不是隐藏 (Pitfall)】只加 `display: none` 会让节拍器与 React root 继续空转
   *   （每秒一次无意义协调），且重连后指纹仍是旧值。这里显式 unmount + 移除节点 + 清指纹。
   */
  if (!state.gatewayConnected) {
    presenceMountHandle?.unmount();
    presenceMountHandle = null;
    updateReactAgentPresence = null;
    agentPresenceHost?.remove();
    agentPresenceHost = null;
    lastAgentPresenceFingerprint = '';
    pendingPresenceSnapshot = null;
    ensurePresenceTicker('idle');
    return null;
  }

  const pod = document.querySelector<HTMLElement>('.flux-middle-pod');
  const dock = document.querySelector<HTMLElement>('.input-dock-container');
  let host = document.getElementById('react-conv-presence-host');

  if (layout === 'dock') {
    if (!dock) return host;
    if (!host) {
      host = document.createElement('div');
      host.id = 'react-conv-presence-host';
    }
    host.classList.add('presence-host--dock');
    if (host.parentElement !== dock || dock.firstElementChild !== host) {
      dock.insertBefore(host, dock.firstElementChild);
    }
    return host;
  }

  host?.classList.remove('presence-host--dock');
  if (!pod) return host;
  if (!host) {
    host = document.createElement('div');
    host.id = 'react-conv-presence-host';
  }
  if (host.parentElement !== pod) {
    const stream = pod.querySelector('#conversation-stream');
    if (stream?.nextSibling) pod.insertBefore(host, stream.nextSibling);
    else pod.appendChild(host);
  }
  return host;
}

/** 在场指示器挂载句柄；null 表示 host 尚未出现（首帧模板还没落地） */
let updateReactAgentPresence: (() => void) | null = null;
/** 当前挂载实例：全量重建换 host 时必须先 unmount，否则 React root 挂在脱离文档的节点上泄漏 */
let presenceMountHandle: ConversationMount | null = null;
/** 当前挂载所在的 host 元素：全量重建会换掉 host，必须能识别并重挂 */
let agentPresenceHost: HTMLElement | null = null;
/**
 * 待渲染快照：`mountAgentPresence` 的 getSnapshot 回调只读它。
 *
 * 【设计意图 (Why)】若 getSnapshot 自己再构造一次，指纹与真正渲染出去的那份会是两个不同时刻的
 *   对象（`sinceMs`/`now` 每次调用都在变），跨语气档边界时会出现「指纹说变了、渲染却是旧的」。
 *   由 `syncAgentPresence` 构造一次、指纹与渲染共用同一份，语义才严密。
 */
let pendingPresenceSnapshot: AgentPresenceSnapshot | null = null;
/** 上一次推送给 React 的快照指纹：流式期间宿主每帧 render，不比对就会每帧协调一次 React 树 */
let lastAgentPresenceFingerprint = '';
/** 在场节拍器：只在存在非 idle 状态时运行（见 ensurePresenceTicker 注释） */
let presenceTickerTimer: ReturnType<typeof setInterval> | null = null;
/**
 * 群聊回合的本地开始时刻。
 *
 * 【设计意图 (Why)】群聊回合走 `groups.*` 协议，从不写 `state.isStreaming` 与
 *   `state.turnStartedAt`（那条链路属于单会话 `prompt.submit`）。若群聊直接借用
 *   `state.turnStartedAt`，用户一边看群聊、一边有后台单会话在跑时，群聊指示器会读到
 *   另一个域的时长，语气档直接错乱。
 *
 * 【约束与规则 (Rules)】只由 `ensureGroupTurnClock()` 维护：房间进入运行集合时立锚点、
 *   离开时清空。禁止在快照构造里写它（快照必须无副作用）。
 */
let groupTurnStartedAt: number | undefined;
/**
 * `state.turnStartedAt` 所属的会话 id。
 *
 * 【设计意图 (Why)】`turnStartedAt` 是全局单值，而会话是多个。用户在 A 发消息后切到 B，
 *   B 恰好也在流式（后台回合）时，快照会拿 A 的锚点算 B 的时长，语气档直接虚高到「还在想」。
 *
 * 【约束与规则 (Rules)】写入 `turnStartedAt` 时必须同步写本字段；快照构造时若与
 *   当前 `activeSessionId` 不一致，一律视为「时长未知」（undefined → sinceMs 记 0），
 *   绝不把别的会话的时长借用过来。
 */
let turnStartedSessionId: string | null = null;

/**
 * 在场节拍器周期。
 *
 * 【设计意图 (Why)】时长分层阈值是 8s / 30s，1s 的采样粒度足以在跨档后一秒内换语气，
 *   又不至于把宿主主线程拖进高频循环。
 */
const PRESENCE_TICK_MS = 1_000;

/**
 * 当前焦点域的「是否正在跑回合」与所属群聊房间。
 *
 * 【设计意图 (Why)】
 *   群聊回合从不写 `state.isStreaming`（那条链路属于单会话 prompt.submit），
 *   它的运行态真值在 `activeRunningGroupRoomIds`。若快照沿用单聊判定，
 *   群聊指示器会永久停在 idle——整个群聊形态直接失效。
 *
 * 【约束与规则 (Rules)】纯读取，不写任何状态；两个消费者（快照构造与节拍器）共用同一口径，
 *   禁止各写一份判定（否则「有没有在跑」会出现两种答案）。
 */
function resolvePresenceDomain(): { groupRoomId: string | null; isRunning: boolean } {
  const groupRoomId = state.activeFocus.type === 'group' ? state.activeFocus.roomId : null;
  return {
    groupRoomId,
    isRunning: groupRoomId ? activeRunningGroupRoomIds.has(groupRoomId) : isStreamingActiveForCurrentSession(),
  };
}

/**
 * 维护群聊回合时钟。
 *
 * 【约束与规则 (Rules)】
 *   1. 只在群聊运行中才立锚点；进入运行态那一刻取当前时间；
 *   2. 回合结束（或被切走）必须清空，否则下一次进群聊会继承上回的长度；
 *   3. 由 `syncAgentPresence` 调用——快照构造本身必须保持无副作用。
 */
function ensureGroupTurnClock(groupRoomId: string | null, isRunning: boolean): void {
  if (!groupRoomId || !isRunning) {
    groupTurnStartedAt = undefined;
    return;
  }
  if (typeof groupTurnStartedAt !== 'number') groupTurnStartedAt = Date.now();
}

/**
 * 按在场状态启停节拍器。
 *
 * 【设计意图 (Why)】
 *   `sinceMs` 与语气档是在宿主侧用 `Date.now()` 算出来的快照字段。而流式期间宿主**不会**
 *   每帧 `render()`（token 走 coalescer 直写 DOM、工具插槽走 rAF 补丁），
 *   因此若只靠 render 推送：① 语气永远停在「正在思考」不会升级；② 工具开始/结束不换文案。
 *   节拍器负责把这两类「无 render 事件的时间推进」补上。
 *
 * 【防范的历史坑 (Pitfall)】
 *   无条件常驻 `setInterval` 会在 idle 时也每秒唤醒主线程，属于典型空转；
 *   而且仓库已有「禁止无管制 infinite 动效」的能耗军规。
 *
 * 【约束与规则 (Rules)】
 *   1. 只有非 idle 才运行；进入 idle / 终态退场后必须 `clearInterval`；
 *   2. 推送走 `syncAgentPresence`，指纹去重保证「内容没变就不碰 React」；
 *   3. 禁止改用 `requestAnimationFrame` 常驻循环（会占满合成器）。
 */
function ensurePresenceTicker(kind: AgentPresence['kind']): void {
  const shouldRun = kind !== 'idle';
  if (shouldRun && !presenceTickerTimer) {
    presenceTickerTimer = setInterval(() => {
      syncAgentPresence();
    }, PRESENCE_TICK_MS);
    return;
  }
  if (!shouldRun && presenceTickerTimer) {
    clearInterval(presenceTickerTimer);
    presenceTickerTimer = null;
  }
}

/**
 * 当前会话所属 Agent 的展示身份。
 *
 * 【设计意图 (Why)】在场指示器的头像必须与左轨、标题栏是**同一个 Agent**，
 *   否则用户会看到「标题栏是小发王、对话区是默认 Bot」这种身份错位。
 *
 * 【约束与规则 (Rules)】
 *   1. 专职 Bot 工位直接读 `activeFocus.botName`；
 *   2. 普通会话读会话行上的 `botName / botDisplayName / botAvatar`（网关回填）；
 *   3. 全都没有时回落 `state.profileName`，但**绝不编造 displayName**——
 *      共享头像原语会用确定性图腾兜底，编造反而制造假身份。
 */
function resolvePresenceSoloIdentity(): { name: string; displayName?: string; avatar?: string } {
  const focus = state.activeFocus;
  const activeSession = state.sessions.find((s) => s.id === state.activeSessionId);
  const name =
    (focus.type === 'bot' ? focus.botName : '') ||
    activeSession?.botName ||
    state.profileName ||
    'default';

  const profile = state.profiles.find(
    (p) =>
      p.name.toLowerCase() === name.toLowerCase() ||
      (p.displayName && p.displayName.toLowerCase() === name.toLowerCase()),
  );

  return {
    name,
    displayName: profile?.displayName || activeSession?.botDisplayName || undefined,
    avatar: profile?.avatar || activeSession?.botAvatar || resolveAgentAvatar(name) || undefined,
  };
}

/**
 * 当前群聊房间的成员身份。
 *
 * 【约束与规则 (Rules)】成员列表只认 `state.groupRooms` 里的真实房间；
 *   房间还没到达时返回 null，由调用方降级到单聊身份，绝不凭空造成员。
 *   成员名保持 profile name（`groupService.ts` 归一化后的 `m.profile`），
 *   与 `activeGroupSpeaker` 同域，避免组件侧「说话者必须在成员里」的守卫误判降级。
 *
 * 【注意】说话者**不在**本函数内决定：它取决于「此刻是否真的有人在干活」，
 *   必须由调用方按运行态裁决（见 buildAgentPresenceSnapshot）。
 */
function resolvePresenceGroupIdentity(): {
  members: string[];
  profiles: Array<{ name: string; displayName?: string; avatar?: string }>;
} | null {
  const focus = state.activeFocus;
  const roomId = focus.type === 'group' ? focus.roomId : state.activeSessionId;
  const room = state.groupRooms.find((g) => g.roomId === roomId);
  if (!room) return null;
  const members = Array.isArray(room.members) ? room.members.filter((m) => typeof m === 'string' && m.length > 0) : [];
  if (members.length === 0) return null;
  return {
    members,
    profiles: state.profiles.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      avatar: p.avatar || resolveAgentAvatar(p.name) || undefined,
    })),
  };
}

/**
 * 构造在场指示器快照。
 *
 * 【设计意图 (Why)】
 *   宿主只负责把**原始事实**翻译成 core 的输入形状：是否流式、末条 assistant 消息、
 *   未收敛的子代理、终态。所有「该显示什么状态」的判断都在 core 的纯函数里，
 *   宿主一旦自己写 if/else 投影文案，就退回到双真值面时代。
 *
 * 【防范的历史坑 (Pitfall)】
 *   旧实现把状态投影散在「输入舱胶囊模板注入」与「InputDock 的活动状态字段」两处，
 *   各自演化出英文机器串（thinking / writing response / reading a file），
 *   且与工具轨迹胶囊的判定不一致。现在工具类别由 core 的 `classifyPresenceTool` 统一裁决。
 *
 * 【约束与规则 (Rules)】
 *   1. `message` 只取**末条 assistant 消息**：末条 user 消息的工具调用永远不属于本回合；
 *   2. 工具 `args` 必须是字符串（core 侧按 JSON 或纯文本解析）；
 *   3. 本函数必须无副作用，且可在任意 render 阶段被调用。
 */
function buildAgentPresenceSnapshot(): AgentPresenceSnapshot {
  const now = Date.now();
  const domain = resolvePresenceDomain();
  const isStreaming = domain.isRunning;

  let lastAssistant: MessageViewModel | null = null;
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    if (state.messages[i].role === 'assistant') {
      lastAssistant = state.messages[i];
      break;
    }
  }

  const pendingDelegations = state.sideAgentCapsules.filter(
    (capsule) => capsule.kind === 'delegation' && capsule.status === 'pending',
  );

  const terminal = state.presenceTerminal;
  const presence: AgentPresence = deriveAgentPresence({
    isStreaming,
    message: lastAssistant
      ? {
          thought: lastAssistant.thought,
          content: lastAssistant.content,
          toolCalls: (lastAssistant.toolCalls ?? []).map((call) => ({
            name: call.name,
            status: call.status,
            args: call.args,
          })),
        }
      : null,
    activeSubagents: pendingDelegations.length,
    subagentProfile: pendingDelegations[0]?.profile,
    lastError: terminal?.kind === 'failed' ? terminal.message : undefined,
    interrupted: terminal?.kind === 'interrupted',
    // 【域隔离 (Rules)】群聊读自己的回合时钟；单聊必须校验会话归属，绝不借用别的会话的锚点
    turnStartedAt: domain.groupRoomId
      ? groupTurnStartedAt
      : turnStartedSessionId === state.activeSessionId
        ? state.turnStartedAt
        : undefined,
    now,
  });

  const groupIdentity = isGroupConversationActive() ? resolvePresenceGroupIdentity() : null;
  const identity: AgentPresenceSnapshot['identity'] = groupIdentity
    ? {
        kind: 'group',
        members: groupIdentity.members,
        /**
         * 【铁律 (Rules)】说话者只在「此刻确实有 Agent 在干活」时才非 null：
         *   回合未运行时（idle / failed / interrupted）没人说话，必须走降级路径，
         *   否则用户会看到一个早就说完话的成员头像继续被高亮。
         *   未知一律 null，绝不沿用上一位，也绝不猜成员。
         */
        speaker: domain.isRunning ? (state.activeGroupSpeaker ?? null) : null,
        profiles: groupIdentity.profiles,
      }
    : { kind: 'solo', ...resolvePresenceSoloIdentity() };

  return { presence, identity, locale: state.lang, layout: state.presenceLayout };
}

/**
 * 在场快照指纹。
 *
 * 【设计意图 (Why)】流式期间宿主每帧都在 `render()`；若每帧都 `root.render()`，
 *   React 会把整棵指示器子树重新协调一次（眨眼时钟所在的组件也被反复调用），
 *   白白吃掉主线程预算。与 `lastTitlebarSnapshotJson` 同一手法，只把**影响呈现**的字段
 *   编进指纹。
 *
 * 【约束与规则 (Rules)】
 *   1. 指纹必须覆盖 presence.kind / 语气档 / 目标 / 失败原因 / 身份 / 说话者 / 成员数 / locale；
 *   2. 刻意**不**包含 `sinceMs`：它每毫秒都在变，进了指纹等于关掉去重；
 *      语气档（tone）已经承载了「时长是否跨档」这一唯一可感知变化；
 *   3. 不可序列化时降级为每次都推送（宁可多渲染，也绝不漏一次真实更新）。
 */
function agentPresenceFingerprint(snapshot: AgentPresenceSnapshot): string {
  const { presence, identity, locale } = snapshot;
  const detail =
    presence.kind === 'tool'
      ? `tool:${presence.tool}:${presence.target}:${presence.runningCount}`
      : presence.kind === 'delegating'
        ? `delegating:${presence.profile}:${presence.count}`
        : presence.kind === 'failed'
          ? `failed:${presence.message}`
          : presence.kind;

  const identityKey =
    identity.kind === 'group'
      ? `group:${identity.speaker ?? '-'}:${identity.members.length}:${identity.members.join(',')}:${identity.profiles.length}`
      : `solo:${identity.name}:${identity.displayName ?? ''}:${identity.avatar ?? ''}`;

  return snapshotFingerprint({
    kind: presence.kind,
    tone: presenceTone(presence),
    detail,
    identityKey,
    locale,
    // 布局切换必须触发一次重渲染：否则 host 换了位置、组件仍按旧变体渲染
    layout: snapshot.layout ?? 'stage',
  });
}

/**
 * 供 `mountAgentPresence` 读取的快照出口。
 *
 * 【约束与规则 (Rules)】禁止在此重新构造快照：只返回 `syncAgentPresence` 已算好的那一份，
 *   否则指纹与实际渲染的内容会错位（见 `pendingPresenceSnapshot` 注释）。
 *   尚无快照时（挂载前的极端时序）现算一次兜底，绝不返回 null。
 */
function getAgentPresenceSnapshot(): AgentPresenceSnapshot {
  if (!pendingPresenceSnapshot) pendingPresenceSnapshot = buildAgentPresenceSnapshot();
  return pendingPresenceSnapshot;
}

/**
 * 推送在场快照（唯一入口）。
 *
 * 【约束与规则 (Rules)】挂载与推送都走这里；指纹相同直接返回，不碰 React 树。
 */
function syncAgentPresence(): void {
  if (!updateReactAgentPresence) return;
  /*
   * 【宿主存活守卫 (Rules)】dock 变体的 host 会被输入舱的 `outerHTML` 替换连带销毁。
   *   若这里不校验 `isConnected`，每秒节拍与工具事件会持续往脱离文档的 root 渲染，
   *   表现为「指示器永久消失 + React root 泄漏」。销毁时按 host 消失处理并就地重挂。
   */
  if (!agentPresenceHost?.isConnected) {
    syncAgentPresenceHost();
    if (!updateReactAgentPresence) return;
  }
  const domain = resolvePresenceDomain();
  ensureGroupTurnClock(domain.groupRoomId, domain.isRunning);
  // 【唯一快照 (Rules)】指纹与渲染必须共用同一份快照对象（见 pendingPresenceSnapshot 注释）
  pendingPresenceSnapshot = buildAgentPresenceSnapshot();
  const snapshot = pendingPresenceSnapshot;
  const fingerprint = agentPresenceFingerprint(snapshot);
  ensurePresenceTicker(snapshot.presence.kind);
  if (fingerprint === lastAgentPresenceFingerprint) return;
  lastAgentPresenceFingerprint = fingerprint;
  updateReactAgentPresence();
}

/* --------------------------------------------------------------------------
 * 设置中心：快照构造、动作表与网关数据装载
 * -------------------------------------------------------------------------- */

let updateReactSettings: (() => void) | null = null;
let lastSettingsSnapshotJson = '';
let settingsController: ReturnType<typeof createSettingsController> | null = null;
let providerAdminController: ReturnType<typeof createProviderAdminController> | null = null;

/** 提供商配置的作用域 Bot：显式选中优先，否则跟随连接 profile。 */
function scopedProfileName(): string {
  return state.settingsScopedProfile || state.profileName || 'default';
}

/**
 * 订阅的共享 auth profile。
 * 【为什么不是 scopedProfile】订阅是账号级来源，登录态落在共享 auth，
 *   由 `share_auth` 回落到首个 profile；登录、轮询、退出都必须作用于它，
 *   否则会把令牌签进一个不参与共享的 profile，其他 Agent 仍然用不了。
 */
function subscriptionProfileName(): string {
  return botRoster()[0]?.profile || state.profileName || 'default';
}

/**
 * 提供商管理控制器（自定义端点 / 订阅账号）。
 * 【约束】REST 一律带 `profile`，禁止依赖网关进程的默认 profile，
 *   否则用户以为在配这个 Bot，实际写到了别的 Bot 上。
 */
function getProviderAdminController(): ReturnType<typeof createProviderAdminController> {
  if (providerAdminController) return providerAdminController;
  const rest = createProviderAdminRest({
    baseUrl: () => getEffectiveUrl(state.gatewayUrl),
    ticket: () => currentTicket ?? '',
    proxy: (options) => {
      if (!desktopApi?.httpProxy) throw new Error('Desktop REST proxy is unavailable');
      return desktopApi.httpProxy(options);
    },
  });
  providerAdminController = createProviderAdminController({
    rest,
    render: () => render(),
    describeError: (error) => describeRpcError(error),
    getEndpoints: () => state.settingsCustomEndpoints,
    setEndpoints: (value) => { state.settingsCustomEndpoints = value; },
    getOauth: () => state.settingsSubscriptionCatalog,
    setOauth: (value) => { state.settingsSubscriptionCatalog = value; },
    setBusy: (busy) => { state.settingsProviderAdminBusy = busy; },
    notify: (message) => showToast(message),
    warn: (message, meta) => bootLog.warn(message, meta),
    onCatalogChanged: () => { void fetchModelOptions({ clearNotice: false }); },
  });
  return providerAdminController;
}

/**
 * 装载统一提供商表。
 * 【设计意图】首屏要回答"我接了哪些模型来源、哪些 Agent 在用"，这需要每个 Agent 的
 *   `model.options` 加一份订阅目录加各 profile 的端点列表，全部并发拉取后归并。
 * 【规则】任一 Agent 失败都进 `settingsProviderFailures` 显式提示，
 *   不允许把"读取失败"渲染成"未配置"。
 */
async function reloadProviderCatalog(): Promise<void> {
  const agents = botRoster();
  state.settingsProviderViews = { status: 'loading' };
  render();
  try {
    const rest = createProviderAdminRest({
      baseUrl: () => getEffectiveUrl(state.gatewayUrl),
      ticket: () => currentTicket ?? '',
      proxy: (options) => {
        if (!desktopApi?.httpProxy) throw new Error('Desktop REST proxy is unavailable');
        return desktopApi.httpProxy(options);
      },
    });
    const result = await loadProviderCatalog({
      agents,
      rest,
      rpc: {
        call: <T,>(method: string, params?: Record<string, unknown>) => {
          if (!gatewayClient) return Promise.reject(new Error(t('settings.notConnected'))) as Promise<T>;
          return gatewayClient.call<T>(method, params);
        },
      },
      describeError: (error) => describeRpcError(error),
    });
    state.settingsProviderViews = { status: 'ready', data: result.views };
    state.settingsProviderFailures = result.failed;
    // 端点与订阅的**原始行**必须落进快照：编辑表单要 base_url / has_api_key，
    // 添加弹框要包含未登录项。用归并后的视图反推这两个域，正是"编辑打不开""弹框没得选"的根因。
    state.settingsCustomEndpoints = { status: 'ready', data: result.endpoints.map((entry) => entry.row) };
    state.settingsEndpointProfiles = Object.fromEntries(
      result.endpoints.map((entry) => [normalizeEndpointId(entry.row.id), [...entry.profiles]]),
    );
    state.settingsEndpointFailures = result.endpointFailures;
    state.settingsSubscriptionCatalog = result.subscriptionsOk
      ? { status: 'ready', data: result.subscriptions }
      : { status: 'error', message: result.subscriptionsError || t('settings.loadFailed') };
  } catch (error) {
    state.settingsProviderViews = { status: 'error', message: describeRpcError(error) };
    state.settingsProviderFailures = [];
    state.settingsCustomEndpoints = { status: 'error', message: describeRpcError(error) };
    state.settingsEndpointProfiles = {};
    state.settingsEndpointFailures = [];
    state.settingsSubscriptionCatalog = { status: 'error', message: describeRpcError(error) };
  }
  render();
}

/**
 * Bot 花名册的唯一投影：从 `state.profiles`（网关真实档案）派生。
 * 【规则】不另存一份 `settingsBots`：双真值必然漂移，头像条与扇出回显会各说一套。
 */
function botRoster(): Array<{ profile: string; displayName: string; avatar?: string }> {
  if (state.profiles.length === 0) {
    const name = state.profileName || 'default';
    return [{ profile: name, displayName: name }];
  }
  return state.profiles.map((profile) => ({
    profile: profile.name,
    displayName: profile.displayName || profile.name,
    avatar: profile.avatar,
  }));
}


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
    call: <T,>(method: string, params?: Record<string, unknown>) => {
      if (!gatewayClient) return Promise.reject(new Error(t('settings.loadFailed'))) as Promise<T>;
      return gatewayClient.call<T>(method, params);
    },
    render: () => render(),
    translate: (key) => t(key),
    describeError: (error) => describeRpcError(error),
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

/* --------------------------------------------------------------------------
 * BOT 配置中枢：宿主控制器（惰性单例）
 * -------------------------------------------------------------------------- */

let botManagementController: ReturnType<typeof createBotManagementController> | null = null;

/**
 * BOT 面板控制器（全进程单例）。
 * 【约束】状态仍以 AppState 为唯一真源，控制器只经 getState/setState 读写；
 *   所有网关调用都走 core 的 ProfileService，禁止在壳层手拼 RPC 参数。
 */
function getBotManagementController(): ReturnType<typeof createBotManagementController> {
  if (botManagementController) return botManagementController;

  botManagementController = createBotManagementController({
    isConnected: () => Boolean(gatewayClient) && state.gatewayConnected,
    // 花名册复用设置中心的 profiles.list 编排，避免两条数据通路各自持有加载态与令牌。
    loadProfiles: () => getSettingsController().loadProfiles(),
    getProfiles: () => state.settingsProfiles,
    getState: () => ({
      status: state.botManagementStatus,
      activeBotId: state.botManagementActiveBotId,
      activeDetail: state.botManagementDetail,
      drafts: state.botDrafts,
      errorBanner: state.botManagementError,
      confirmPending: state.botManagementConfirm,
      isBusy: state.botManagementBusy,
    }),
    setState: (patch) => {
      if (patch.status !== undefined) state.botManagementStatus = patch.status;
      if (patch.activeBotId !== undefined) state.botManagementActiveBotId = patch.activeBotId;
      // 显式 undefined 代表"清空详情/横幅"，必须用 in 判断，不能用 !== undefined 吞掉清除动作。
      if ('activeDetail' in patch) state.botManagementDetail = patch.activeDetail;
      if (patch.drafts !== undefined) state.botDrafts = patch.drafts;
      if ('errorBanner' in patch) state.botManagementError = patch.errorBanner;
      if ('confirmPending' in patch) state.botManagementConfirm = patch.confirmPending;
      if (patch.isBusy !== undefined) state.botManagementBusy = patch.isBusy;
    },
    describeBot: (botId, hint) => {
      if (!gatewayClient) return Promise.reject(new Error(t('settings.notConnected')));
      return profileService.describeBot(botId, gatewayClient, hint);
    },
    /**
     * 全局技能目录：只在 describe 未返回 skills 时用于补全展示。
     * 【规则】读取失败返回 null（界面保留非权威提示），绝不把失败当成空目录。
     */
    fetchSkillInventory: async (botId) => {
      if (!gatewayClient) return null;
      try {
        const result = await gatewayClient.request<{ skills?: Record<string, string[]> | null }>(
          'skills.manage',
          { profile: botId, action: 'list' },
        );
        const groups = result?.skills;
        if (!groups || typeof groups !== 'object') return null;
        const names: string[] = [];
        for (const value of Object.values(groups)) {
          if (!Array.isArray(value)) continue;
          for (const name of value) if (typeof name === 'string' && name) names.push(name);
        }
        return names;
      // gate-degrade: 技能目录读取失败只影响非权威清单的补全展示，界面会显示"清单读取不完整"；不阻塞 BOT 详情，也不伪装成空目录。
      } catch {
        return null;
      }
    },
    /**
     * MCP 探活：失败返回 null，界面显示"状态未知"。
     * 【契约】0.23.1 的运行时行用 `tools` 计工具数，`connected` 才是探活结论。
     */
    fetchMcpStatus: async (botId) => {
      if (!gatewayClient) return null;
      try {
        const result = await gatewayClient.request<{
          servers?: Array<{ name?: string; connected?: boolean; transport?: string; tools?: number }>;
        }>('mcp.servers.status', { profile: botId });
        if (!Array.isArray(result?.servers)) return null;
        return result.servers
          .filter((row) => typeof row?.name === 'string' && row.name)
          .map((row) => ({
            name: row.name as string,
            connected: row.connected === true,
            transport: typeof row.transport === 'string' ? row.transport : undefined,
            toolCount: typeof row.tools === 'number' ? row.tools : undefined,
          }));
      // gate-degrade: 探活失败等价于"状态未知"（online 保持 undefined），界面不得画红灯；已有清单照常展示。
      } catch {
        return null;
      }
    },
    configureBot: (params: ProfilesConfigureParams) => {
      if (!gatewayClient) return Promise.reject(new Error(t('settings.notConnected')));
      return profileService.configureBot(params, gatewayClient);
    },
    setAsset: (botId, dataUrl, clear) => {
      if (!gatewayClient) return Promise.reject(new Error(t('settings.notConnected')));
      return profileService.setAsset(botId, 'avatar', dataUrl, gatewayClient, { clear });
    },
    render: () => render(),
    translate: (key) => t(key),
    describeError: (error) => describeRpcError(error),
    notify: (message) => showToast(message),
    // 保存成功后刷左轨/花名册投影；fetchProfiles 自带 generation 令牌，不与控制器抢写。
    onProfilesChanged: () => { void fetchProfiles(); },
    /**
     * 头像资产不在 profiles.list 的回显里（网关只给 has_avatar），保存成功后必须主动同步
     * 内存缓存、花名册行与会话投影；否则左轨与选择器继续画旧头像，用户以为保存没生效。
     */
    onAvatarChanged: (botId, dataUrl) => {
      const key = botId.toLowerCase();
      if (dataUrl) profileAvatarCache.set(key, dataUrl);
      else profileAvatarCache.delete(key);
      const profile = state.profiles.find((item) => item.name === botId);
      if (profile) {
        profile.avatar = dataUrl;
        profile.hasAvatar = Boolean(dataUrl);
        if (profile.displayName) {
          const named = profile.displayName.toLowerCase();
          if (dataUrl) profileAvatarCache.set(named, dataUrl);
          else profileAvatarCache.delete(named);
        }
      }
      if (state.settingsProfiles.status === 'ready') {
        state.settingsProfiles = {
          status: 'ready',
          data: state.settingsProfiles.data.map((row) =>
            row.name === botId ? { ...row, avatar: dataUrl, hasAvatar: Boolean(dataUrl) } : row,
          ),
        };
      }
      for (const session of state.sessions) {
        if (session.botName === botId) session.botAvatar = dataUrl;
      }
      persistAvatarCache();
    },
    // 160ms 静止防抖：测试可注入假定时器，生产沿用宿主 setTimeout。
    schedule: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    },
  });
  return botManagementController;
}

/**
 * 打开设置中心的 BOT 面板并选中指定 BOT。
 * 【设计意图】左轨右键"编辑资料"与设置页花名册的"编辑"共用同一入口，
 *   避免出现两套打开逻辑（一套走弹窗、一套走面板）。
 * 【规则】立即取详情，不等 160ms 防抖——这是用户的显式意图，不是滑动落点。
 */
function openBotSettings(botId: string): void {
  state.isSettingsOpen = true;
  state.settingsSection = 'agents';

  // 先把目标写入 activeBotId：loadRoster 完成时会"保持仍在花名册中的 activeBotId"，
  // 因此不需要在列表未就绪时抢跑 describe，避免花名册与详情各打一次 RPC。
  state.botManagementActiveBotId = botId;
  const status = state.botManagementStatus.status;
  ensureSettingsSectionData('agents');
  if (status !== 'uninitialized' && status !== 'fetching_list') {
    getBotManagementController().selectBot(botId, { immediate: true });
  }
  render();
}

/**
 * BOT 面板渲染快照。
 * 【规则】只从 AppState 现算，不在这里发 RPC；草稿 hasDraft 必须来自草稿池，
 *   不能用"字段是否非空"猜测（空字符串也是合法草稿值）。
 */
function getBotManagementSnapshot(): SettingsSnapshot['botManagement'] {
  // 花名册投影走 core 的纯函数：hasDraft 由草稿池现算，且该函数有落盘测试。
  const roster: SettingsSnapshot['botManagement']['roster'] =
    state.settingsProfiles.status === 'ready'
      ? projectBotRoster(
          state.settingsProfiles.data.map((row) => ({
            name: row.name,
            displayName: row.displayName,
            // 模型优先取设置域行，其次回落到全局 profiles 投影（两条来源都可能先到）。
            model: row.model || state.profiles.find((item) => item.name === row.name)?.model || '',
            avatar: row.avatar || state.profiles.find((item) => item.name === row.name)?.avatar || undefined,
            isDefault: row.isDefault,
          })),
          state.botDrafts,
        )
      : [];

  // 模型目录按 provider 顺序聚合；同一 provider 下重复模型只保留首个。
  const availableModels: SettingsSnapshot['botManagement']['availableModels'] = [];
  const seenModels = new Set<string>();
  if (state.settingsProviderViews.status === 'ready') {
    for (const view of state.settingsProviderViews.data) {
      // 未配置/读取失败的 provider 不得进入下拉：选中也保存不了，等于给用户假选项。
      // 当前模型若属于这类 provider，UI 会用"[离线/不可用]"占位保留，不会被静默清空。
      if (view.availability !== 'active' && view.availability !== 'ready') continue;
      for (const modelId of view.models) {
        const key = `${view.id}\u0000${modelId}`;
        if (seenModels.has(key)) continue;
        seenModels.add(key);
        availableModels.push({
          id: modelId,
          name: formatModelDisplayName(modelId, view.name),
          provider: view.id,
          providerName: view.name,
        });
      }
    }
  }

  return {
    status: state.botManagementStatus,
    roster,
    activeBotId: state.botManagementActiveBotId,
    activeDetail: state.botManagementDetail,
    availableModels,
    // 草稿池整表不进快照：每个 render 都会 JSON.stringify 快照做指纹，
    // SOUL（64KB）进草稿后整表序列化会拖慢长会话。UI 只需要当前 BOT 的草稿；
    // 其它 BOT 的脏标记由 roster[].hasDraft 逐行表达，避免出现两份真值。
    activeDraft: state.botManagementActiveBotId
      ? state.botDrafts[state.botManagementActiveBotId]
      : undefined,
    // 本步不实现新建向导与离场弹窗：给受控组件的空默认，禁止用 undefined 让组件猜。
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
    errorBanner: state.botManagementError,
    confirmPending: state.botManagementConfirm,
    // 新建向导落地前没有"高亮新 BOT"的来源；显式 undefined 而非伪造一个 ID。
    highlightBotId: undefined,
    // 保存忙态独立于 status：UI 用它禁用保存按钮并锁输入，status 仍保持 idle/saving 语义。
    isBusy: state.botManagementBusy,
  };
}

function getSettingsSnapshot(): SettingsSnapshot {
  return {
    isOpen: state.isSettingsOpen,
    section: state.settingsSection,
    theme: state.theme,
    locale: state.lang === 'en' ? 'en' : 'zh',
    fontPrefs: fontPreferences,
    activityVariant: activityIndicatorVariant,
    // 提供商的旧 providers 域已并入统一表 providerViews，快照不再单列 providers。
    profiles: state.settingsProfiles,
    bots: botRoster(),
    botManagement: getBotManagementSnapshot(),
    scopedProfile: scopedProfileName(),
    providerViews: state.settingsProviderViews,
    providerFailures: state.settingsProviderFailures,
    subscriptionCatalog: state.settingsSubscriptionCatalog,
    customEndpoints: state.settingsCustomEndpoints,
    endpointProfiles: state.settingsEndpointProfiles,
    endpointFailures: state.settingsEndpointFailures,
    providerAdminBusy: state.settingsProviderAdminBusy,
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
    presenceLayout: state.presenceLayout,
  };
}

/**
 * 按当前 section 懒加载对应数据；幂等、并发收敛由控制器统一保证。
 * 【规则】提供商域只需一次统一装载：每个 Agent 的 model.options + 订阅目录 + 端点列表
 *   都在 loadProviderCatalog 内并发完成，不需要再单独跑端点/订阅的两次装载。
 */
function ensureSettingsSectionData(section: SettingsSectionId, force = false): void {
  // BOT 面板的花名册由 bot controller 统一编排：这里绝不能再调 settingsController.ensureSection('agents')，
  // 否则同一次进入面板会并发两次 profiles.list，两个令牌互相覆盖，列表可能闪回旧数据。
  if (section === 'agents') {
    getBotManagementController().ensureLoaded(force);
    // 模型绑定下拉的唯一数据源是统一提供商表；进入 BOT 面板必须确保目录已装载，
    // 否则首次进入只能看到空下拉（用户以为该 BOT 没有可选模型）。
    if (force || state.settingsProviderViews.status === 'idle') {
      void reloadProviderCatalog();
    }
    return;
  }
  getSettingsController().ensureSection(section, force);
  if (section !== 'providers') return;
  // 花名册是 Agent 槽位的来源；空列表时补拉一次，已有数据不重复请求。
  if (state.profiles.length === 0) void getSettingsController().loadProfiles();
  if (force || state.settingsProviderViews.status === 'idle') {
    void reloadProviderCatalog();
  }
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
    /**
     * 切换 Agent 状态指示器的位置变体。
     *
     * 【设计意图 (Why)】两套效果并存，由用户在外观设置里选。切换只改表现位置：
     *   状态机、文案、动效全部复用，因此这里只写偏好 + 重建 host 的落点。
     * 【约束与规则】必须先写持久化再 render：render 内的 `ensureAgentPresenceHost`
     *   读的是内存 state，落盘顺序不影响本次渲染，但顺序反了会在崩溃时丢失选择。
     */
    onPresenceLayoutChange: (layout) => {
      state.presenceLayout = layout === 'dock' ? 'dock' : 'stage';
      writePresenceLayout(state.presenceLayout);
      // host 位置变化必须让 React 重挂：先清空引用，render 时会按 host 比对重新 mount
      agentPresenceHost = null;
      lastAgentPresenceFingerprint = '';
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
    onActivityVariantChange: (variant) => {
      activityIndicatorVariant = resolveActivityIndicatorVariant(variant);
      saveActivityIndicatorVariant(activityIndicatorVariant);
      render();
    },
    // 设置页的"刷新"现在服务 BOT 面板：它会同时刷新花名册与当前详情。
    onRefreshProfiles: () => { void getBotManagementController().loadRoster(true); },
    onScopeProfileChange: (profile) => {
      state.settingsScopedProfile = profile;
      render();
    },
    onReloadProviders: () => {
      void reloadProviderCatalog();
    },
    onProbeEndpoint: (draft) => getProviderAdminController().probe(draft),
    onSaveEndpoint: async (draft, options) => {
      const outcome = await getProviderAdminController().save(scopedProfileName(), draft, {
        fanOutTo: options.fanOutTo,
        makeDefault: options.makeDefault,
        profileDisplayNames: Object.fromEntries(botRoster().map((bot) => [bot.profile, bot.displayName])),
      });
      if (outcome.currentOk === false) return { ok: false, message: outcome.current.message || t('settings.saveFailed') };
      void reloadProviderCatalog();
      return { ok: true, fanOut: [outcome.current, ...outcome.fanOut] };
    },
    /**
     * 使用：把选中 Agent 的主模型切到这个提供商。
     * 【规则】必须带具体模型。网关的 `custom-endpoints/{id}/activate` 只认自定义端点，
     *   订阅走它必然 404；统一走 `/api/model/set` 后才能覆盖订阅。
     * 【约束】只影响当前作用域那一个 Agent，不做跨 Agent 批量。
     * 【为什么不弹二次确认】模型选择弹窗已经把"让哪个 Agent 用哪个模型"写在标题上，
     *   再弹一次确认等于让用户点两遍同一个决定。
     */
    onActivateProvider: async (providerId, model, confirmExpensive) => {
      const controller = getProviderAdminController();
      const profile = scopedProfileName();
      const view = state.settingsProviderViews.status === 'ready'
        ? state.settingsProviderViews.data.find((item) => item.id === providerId)
        : undefined;
      const result = await controller.useMainModel(profile, {
        provider: providerId,
        model,
        baseUrl: view?.kind === 'custom' ? view.detail : undefined,
        confirmExpensive,
      });
      if (result.ok) {
        showToast(t('settings.providerUsed', { name: view?.name || providerId }));
        void reloadProviderCatalog();
      }
      return result;
    },
    /** 退出订阅：订阅是账号级来源，退出共享 auth 后所有 Agent 一起失去它。 */
    onLogoutProvider: (providerId) =>
      new Promise((resolve) => {
        const controller = getProviderAdminController();
        const profileAtOpen = subscriptionProfileName();
        const target = planDeleteTarget(
          profileAtOpen,
          botRoster().find((bot) => bot.profile === profileAtOpen)?.displayName ?? profileAtOpen,
        );
        const view = state.settingsProviderViews.status === 'ready'
          ? state.settingsProviderViews.data.find((item) => item.id === providerId)
          : undefined;
        if (view?.manualHint) {
          // 网关明确说这个订阅不能自动断开：显示它自己的做法，不假装能一键退出。
          state.confirmModal = {
            title: t('settings.logoutConfirmTitle'),
            message: t('settings.logoutManual', { command: view.manualHint }),
            confirmLabel: t('settings.close'),
            cancelLabel: t('settings.cancel'),
            isDanger: false,
            onConfirm: async () => resolve({ ok: false, cancelled: true }),
            onCancel: () => resolve({ ok: false, cancelled: true }),
          };
          render();
          return;
        }
        state.confirmModal = {
          title: t('settings.logoutConfirmTitle'),
          message: t('settings.logoutConfirmMessage', { bot: target.displayName, name: view?.name || providerId }),
          confirmLabel: t('settings.providerLogout'),
          cancelLabel: t('settings.cancel'),
          isDanger: true,
          onConfirm: async () => {
            const result = await controller.logoutOauth(target.profile, providerId);
            if (result.ok) {
              showToast(t('settings.logoutDone', { name: view?.name || providerId }));
              void reloadProviderCatalog();
            }
            resolve(result);
          },
          onCancel: () => resolve({ ok: false, cancelled: true }),
        };
        render();
      }),
    onStartLogin: (providerId) => getProviderAdminController().startLogin(subscriptionProfileName(), providerId),
    onPollLogin: (providerId, sessionId) =>
      getProviderAdminController().pollLogin(subscriptionProfileName(), providerId, sessionId),
    onCancelLogin: (sessionId) => getProviderAdminController().cancelLogin(subscriptionProfileName(), sessionId),
    onCopy: async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        bootLog.warn('clipboard write failed', { error: describeRpcError(error) });
        return false;
      }
    },
    /**
     * 删除端点：用户看到的是一行，删除就必须是整体删除。
     * 【规则】作用范围取 `view.agents` 里 active/ready 的 Agent（真正配了它的），
     *   不取"当前作用域"那一个——只删一个的话这行还在，用户会认为按钮没生效。
     * 【约束】读取失败的 Agent 不在删除范围内：读不到就不能猜着删。
     */
    onDeleteEndpoint: (id) =>
      new Promise((resolve) => {
        const controller = getProviderAdminController();
        const targetId = normalizeEndpointId(id);
        const view = state.settingsProviderViews.status === 'ready'
          ? state.settingsProviderViews.data.find((item) => normalizeEndpointId(item.id) === targetId)
          : undefined;
        if (!view) {
          // 视图里找不到这一行：说明快照已经过期，不能拿一个猜出来的 id 去删。
          showToast(t('settings.providerDeleteUnknown'));
          resolve({ ok: false, message: t('settings.providerDeleteUnknown') });
          return;
        }

        /**
         * 删除的作用域是**配置集合**，不是在用集合。
         * 【为什么】端点可以存在于某 profile 的配置里、却没进 model.options（未生效、未带模型）。
         *   用 profilesWithProvider 会得到空集，于是"能看见却删不掉"。
         */
        // 配置集合不完整时不许删：某个 Agent 的端点清单读失败，它的端点不在集合里，
        // 删除会漏掉它却报成功。读不到就不能猜着删。
        if (state.settingsEndpointFailures.length > 0) {
          const names = state.settingsEndpointFailures.map((item) => item.displayName).join('、');
          showToast(t('settings.providerDeleteScopeIncomplete', { agents: names }));
          resolve({ ok: false, message: t('settings.providerDeleteScopeIncomplete', { agents: names }) });
          return;
        }

        const plan = planProviderRemoval(view, state.settingsEndpointProfiles[targetId] ?? []);

        if (plan.kind === 'blocked-in-use') {
          const names = plan.agents
            .map((agent) => (agent.model ? `${agent.displayName}（${agent.model}）` : agent.displayName))
            .join('、');
          state.confirmModal = {
            title: t('settings.providerDeleteBlockedTitle'),
            message: t('settings.providerDeleteBlocked', { name: view.name, agents: names }),
            confirmLabel: t('settings.close'),
            cancelLabel: t('settings.cancel'),
            isDanger: false,
            onConfirm: async () => resolve({ ok: false, message: t('settings.providerDeleteBlockedShort') }),
            onCancel: () => resolve({ ok: false, cancelled: true }),
          };
          render();
          return;
        }

        if (plan.kind === 'empty') {
          // 数据不一致：行还在，但没有任何 profile 承认配置过它。既不能删，也不能说"没人在用"。
          showToast(t('settings.providerDeleteInconsistent'));
          resolve({ ok: false, message: t('settings.providerDeleteInconsistent') });
          return;
        }

        const names = plan.profiles.map(
          (profile) => botRoster().find((bot) => bot.profile === profile)?.displayName || profile,
        );
        state.confirmModal = {
          title: t('settings.providerDelete'),
          message: t('settings.providerDeleteConfirm', { name: view.name, agents: names.join('、') }),
          confirmLabel: t('settings.providerDelete'),
          cancelLabel: t('settings.cancel'),
          isDanger: true,
          onConfirm: async () => {
            const result = await controller.remove(plan.profiles, view.id);
            // 只有全部成功才算删掉。部分失败必须如实回显失败名单，不能先报"已删除"。
            if (result.ok) {
              showToast(t('settings.providerDeleted', { name: view.name }));
              void reloadProviderCatalog();
              resolve(result);
              return;
            }
            const detail = result.failed
              .map((item) => `${item.displayName}：${item.message || ''}`)
              .join('；');
            const message = result.failed.length > 0
              ? t('settings.providerDeletePartial', { detail })
              : result.message || t('settings.providerToggleFailed');
            void reloadProviderCatalog();
            resolve({ ok: false, message });
          },
          onCancel: () => resolve({ ok: false, cancelled: true }),
        };
        render();
      }),

    /**
     * 勾选 / 取消勾选某一个 Agent 的绑定。
     *
     * 【规则】判定全部交给 core 的 planBindingToggle，壳层只执行与回显：
     *   正在使用的 Agent 不允许取消（用户已确认的策略：先改模型再移除）；
     *   未配置的自定义端点必须带 `attachIntent`，缺意图一律返回 `confirmRequired: true` 且不写任何配置；
     *   自定义端点新增必须补密钥（网关不回明文）；订阅只能引导去登录。
     * 【规则】是否改写默认模型跟随 `plan.makeDefault`，模型取运行时目录里真实存在的那个
     *   （`resolveBindingDefaultModel`）；仅当 `plan.makeDefault` 为真时才校验 `currentIsDefault`。
     */
    onToggleProviderAgent: async (providerId, profile, nextChecked, apiKey, options) => {
      const controller = getProviderAdminController();
      const targetId = normalizeEndpointId(providerId);
      const view = state.settingsProviderViews.status === 'ready'
        ? state.settingsProviderViews.data.find((item) => normalizeEndpointId(item.id) === targetId)
        : undefined;
      if (!view) return { ok: false, message: t('settings.providerDeleteUnknown') };

      const plan = planBindingToggle(view, profile, nextChecked, options?.attachIntent);
      switch (plan.kind) {
        case 'noop':
          return { ok: true };
        case 'unknown-profile':
          return { ok: false, message: t('settings.providerToggleUnknownProfile', { profile }) };
        case 'blocked-active':
          return { ok: false, message: t('settings.providerToggleBlockedActive', { profile }) };
        case 'blocked-error':
          return { ok: false, message: plan.message || t('settings.providerToggleBlockedError', { profile }) };
        case 'login-required':
          return { ok: false, message: t('settings.providerToggleLoginRequired', { profile }) };
        case 'confirm-attach':
          return { ok: false, confirmRequired: true, message: t('settings.providerAttachConfirmRequired') };
        default:
          break;
      }

      const flightKey = `${targetId}\u0000${profile}`;
      const signature = plan.kind + (plan.kind === 'attach' ? plan.intent : '');
      const existing = inFlightProviderBindings.get(flightKey);
      if (existing) {
        if (existing.signature === signature) return existing.promise;
        return { ok: false, message: t('settings.providerAttachBusy') };
      }

      const promise = (async (): Promise<ToggleProviderAgentResult> => {
        switch (plan.kind) {
          case 'detach': {
            const result = await controller.remove([profile], view.id);
            if (result.ok) {
              // 等回读完成再清 pending：否则用户会看到"点了没反应"的旧勾选态。
              await reloadProviderCatalog();
              return { ok: true };
            }
            return { ok: false, message: result.message || t('settings.providerToggleFailed') };
          }
          case 'attach': {
            const row = state.settingsCustomEndpoints.status === 'ready'
              ? state.settingsCustomEndpoints.data.find(
                  (item) => normalizeEndpointId(item.id) === targetId,
                )
              : undefined;
            if (!row) return { ok: false, message: t('settings.providerEditUnavailable') };
            let key = (apiKey ?? '').trim();
            if (!key) {
              // 先尝试从其它成员复制：取消绑定会连密钥一起删，用户刚勾回来不该被要求重输。
              const sources = (state.settingsEndpointProfiles[targetId] ?? [])
                .filter((source) => source !== profile);
              const copied = await controller.resolveEndpointKey(view.id, sources);
              if (!copied.ok) {
                if (copied.reason === 'no-readable-key') {
                  // 确实没有可读来源（所有成员都缺密钥）：这时才让用户就地补一次。
                  return {
                    ok: false,
                    needsKey: true,
                    message: t('settings.providerToggleNeedsKey', { profile }),
                  };
                }
                // 读取故障必须原样透出，不能伪装成"请重输密钥"（Failure Is Not Empty）。
                return { ok: false, message: copied.message || t('settings.providerToggleFailed') };
              }
              key = copied.key;
            }
            // 模型取运行时目录里真实存在的那个；是否切换默认模型由 plan.makeDefault 决定。
            const draft = draftForBindingAttach(row, view.models, key);
            const outcome = await controller.save(profile, draft, { fanOutTo: [], makeDefault: plan.makeDefault });
            // 【规则】默认模型两条守卫的判定统一由 core 的 `classifyAttachWrite` 表达，
            //   壳层只做 `kind → i18n` 映射：这样"要求设默认却没设"与"只要求启用却被改成默认"
            //   两个方向共用同一份可穷举的真值，不会一边补了另一边忘掉。
            const verdict = classifyAttachWrite(plan, outcome);
            if (verdict.kind === 'failed') {
              return { ok: false, message: outcome.current.message || t('settings.providerToggleFailed') };
            }
            const verdictKey = messageKeyForVerdict(verdict);
            if (verdictKey) {
              // 【规则】失败也要先回读：端点已经写进网关，列表必须如实反映。
              //   错误本身由界面另存为行级提示，不依赖确认条存活——回读后目标格子不再是
              //   `absent`，确认条会被目录收敛清空，把错误挂在条上等于静默丢掉它。
              await reloadProviderCatalog();
              return { ok: false, message: t(verdictKey) };
            }
            // 等回读完成再清 pending：否则用户会看到"点了没反应"的旧勾选态。
            await reloadProviderCatalog();
            return { ok: true };
          }
          case 'logout-subscription': {
            // 订阅的绑定就是该 Agent 的 OAuth 登录态，只能走断开登录，不能删端点。
            const result = await controller.logoutOauth(profile, view.id);
            if (result.ok) {
              await reloadProviderCatalog();
              return { ok: true };
            }
            return { ok: false, message: result.message || t('settings.providerToggleFailed') };
          }
          default:
            return { ok: false, message: t('settings.providerToggleFailed') };
        }
      })();

      const entry = { signature, promise };
      inFlightProviderBindings.set(flightKey, entry);
      try {
        return await promise;
      } finally {
        if (inFlightProviderBindings.get(flightKey) === entry) {
          inFlightProviderBindings.delete(flightKey);
        }
      }
    },
    onNotify: (message) => showToast(message),

    /* ---- BOT 配置中枢（本步只实现基础信息与头像） ---- */
    /** 草稿实时写入；脏净判定由 core 的 isBotDraftDirty 统一决定。 */
    onBotDraftChange: (botId, patch) => getBotManagementController().updateDraft(botId, patch),
    /** 选择器静止吸附后的详情请求；160ms 防抖与并发令牌在控制器内。 */
    onSelectBotSettle: (botId) => getBotManagementController().selectBot(botId),
    /** 原子保存当前草稿（profiles.configure + profiles.set_asset）。 */
    onSaveBotConfig: (botId, options) => getBotManagementController().saveBot(botId, options),
    /** 丢弃当前 BOT 的草稿，表单回到权威快照。 */
    onResetBotDraft: (botId) => getBotManagementController().resetDraft(botId),
    /** 新建向导本步不实现功能：显式空实现，绝不假装已打开或已提交。 */
    onOpenBotWizard: () => {},
    onCloseBotWizard: () => {},
    onBotWizardDraftChange: () => {},
    /** 向导未落地时提交必须显式失败，禁止静默返回成功。 */
    onSubmitCreateBot: async () => ({ ok: false, message: t('bot.createFailed') }),
    /** 花名册重试：忽略缓存并重新装载。 */
    onRetryBotList: () => { void getBotManagementController().loadRoster(true); },
    onDismissBotError: () => getBotManagementController().dismissError(),
    onDismissBotConfirm: () => getBotManagementController().dismissConfirm(),
    /** 离场守卫本步不实现：没有脏守卫注册，就不会弹确认框。 */
    onConfirmBotExit: () => {},
    onCancelBotExit: () => {},
    onRegisterBotDirtyGuard: () => {},
    /** 花名册行内"编辑"：打开 BOT 面板并立即选中目标。 */
    onOpenAgent: (name) => {
      openBotSettings(name);
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
  renderCoordinator.mountReactShellComponents();
}

function render(): void {
  renderCoordinator.render();
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

  // 模态弹窗、任务创建与右键上下文菜单事件由控制器统一接管
  modalInteractionController.bindDomEvents();

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
      modelBtn.setAttribute('aria-expanded', state.modelMenuOpen ? 'true' : 'false');
      // 【状态对齐】modelBtn.onclick 直写 DOM 而不走整舱 render()（防失焦），
      // 若不同步对齐 lastInputDockSnapshot.modelMenuOpen，用户在打开后未做其它操作直接点空白或按 Esc 时，
      // render() 会对比 last(false) === curr(false) 误判快照未变而跳过重绘，菜单直接卡死无法收起。
      if (lastInputDockSnapshot) {
        lastInputDockSnapshot = { ...lastInputDockSnapshot, modelMenuOpen: state.modelMenuOpen };
      }
      if (state.modelMenuOpen) {
        resetModelSearchOnOpen();
        if (state.availableModels.length === 0) {
          void fetchModelOptions();
        }
        const search = document.getElementById('dock-model-search-input') as HTMLInputElement | null;
        if (search) {
          search.value = '';
          search.focus();
        }
      } else {
        hideModelCascade();
      }
    };
  }

  // Bind dropdown options
  bindModelDropdownEvents();

  // 【规则】「思考等级」不再占用输入舱 footer：入口已下沉到模型行右侧的二级级联，
  // 由 bindModelDropdownEvents() 统一绑定，这里不再有独立下拉。

  // 审批三态：manual / smart / off（网关唯一真值，历史 auto/ask/sandbox 已归一）
  const approvalBtn = document.getElementById('dock-approval-toggle-btn');
  const approvalDropdown = document.getElementById('dock-approval-dropdown');
  if (approvalBtn && approvalDropdown) {
    approvalBtn.onclick = (e) => {
      e.stopPropagation();
      const isOpen = approvalDropdown.style.display === 'block';
      approvalDropdown.style.display = isOpen ? 'none' : 'block';
      approvalBtn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
    };
    approvalDropdown.querySelectorAll<HTMLElement>('.composer-approval-option').forEach((opt) => {
      opt.onclick = (e) => {
        e.stopPropagation();
        const mode = opt.dataset.mode as AppState['approvalMode'] | undefined;
        approvalDropdown.style.display = 'none';
        approvalBtn.setAttribute('aria-expanded', 'false');
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

  // Event delegation on input-dock-container for notices, rollback cancel and queue actions
  const dockContainer = document.querySelector<HTMLElement>('.input-dock-container');
  if (dockContainer && !dockContainer.dataset.dockClickBound) {
    dockContainer.dataset.dockClickBound = 'true';
    dockContainer.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const cancelAction = target.closest<HTMLElement>('[data-action="rollback-cancel"]');
      if (cancelAction) {
        e.stopPropagation();
        e.preventDefault();
        handleRollbackCancel();
        return;
      }
      const queueAction = target.closest<HTMLElement>('.queue-action-btn');
      if (queueAction) {
        e.stopPropagation();
        e.preventDefault();
        const admissionId = queueAction.dataset.queueId || '';
        const action = queueAction.dataset.action || '';
        if (admissionId) void handleQueueAction(action, admissionId);
      }
    });
  }

  // 发送、入队、停止、IME防御、自适应高度、联想补全与附件移除委托给 inputDockController
  inputDockController.bindDomEvents();

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
      const isProgrammatic =
        (programmaticScrollTarget !== null && Math.abs(streamEl.scrollTop - programmaticScrollTarget) <= 2)
        || (performance.now() <= programmaticScrollIgnoreUntil && streamEl.scrollTop >= lastStreamScrollTop);
      if (programmaticScrollTarget !== null && Math.abs(streamEl.scrollTop - programmaticScrollTarget) <= 2) {
        programmaticScrollTarget = null;
      }
      const previousTop = lastStreamScrollTop;
      /**
       * 【控制权移交 (Rules)】读者的任意真实滚动都意味着"我要自己控制视口"：
       *   立即解除首屏落定；其中向上回溯额外记录该会话，此后同类补齐不再把读者拽回底部。
       */
      if (!isProgrammatic && performance.now() > layoutDriftUntil && Math.abs(streamEl.scrollTop - previousTop) > 4) {
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

      const viewportPrefetch = Math.max(800, streamEl.clientHeight * 1.0);
      const virtualWindowEl = document.querySelector<HTMLElement>('.conv-virtual-window');
      const expandPrefetch = computeExpandPrefetchPx(
        streamEl.clientHeight,
        virtualWindowEl?.getBoundingClientRect().height
      );

      /**
       * 【有界窗口下行回收 (Rules)】窗口是 [start, end) 有界区间，向下滚到区间尾部时
       * 必须整体前移，否则读者滚到底会撞上"没有更多内容"的空洞。
       * 判定用"距底部不足一屏"而不是精确触底，留出一屏余量做回收，避免读者看到空白。
       * 【占位块换算 (Rules)】底部占位块也计入 scrollHeight，因此这里用的是含占位的真实距离，
       * 与窗口前移后占位减少的量正好抵消，不会形成回收抖动。
       */
      if (messageWindowUserExpanded && messageWindowEnd < state.messages.length) {
        const distanceToEnd = streamEl.scrollHeight - streamEl.scrollTop - streamEl.clientHeight;
        if (distanceToEnd < viewportPrefetch) {
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
            const handoffToFetch =
              messageWindowStart === 0
              && streamEl.scrollTop < expandPrefetch
              && state.hasOlderMessages
              && readerScrolledSessionId === state.activeSessionId;
            if (!handoffToFetch) {
              requestAnimationFrame(() => {
                syncScrollTopToWindow('scrollbar jump');
                streamScrollCooldown = false;
              });
              return;
            }
            requestAnimationFrame(() => {
              syncScrollTopToWindow('scrollbar jump');
            });
          }
        }
      }

      const virtualWindowTop = Math.round(messageWindowStart * averageRowHeightPx);
      const upwardAction = planUpwardScrollAction({
        sessionId: state.activeSessionId,
        readerScrolledSessionId,
        total: state.messages.length,
        capacity: MESSAGE_WINDOW_CAPACITY,
        windowStart: messageWindowStart,
        hasOlderMessages: state.hasOlderMessages,
        scrollTop: streamEl.scrollTop,
        virtualWindowTopPx: virtualWindowTop,
        expandPrefetchPx: expandPrefetch,
      });

      if (upwardAction === 'none') return;
      // 【AGENTS.md 三态隔离】群聊研讨室严禁发起单会话翻页
      if (state.activeFocus.type === 'group') return;

      if (upwardAction === 'settle-bottom') {
        initialBottomSettling = true;
        settleInitialBottom();
        scrollStreamToBottom('initial window offscreen');
        return;
      }

      if (upwardAction === 'expand-local-window') {
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
        streamScrollCooldown = false;
        return;
      }

      streamScrollCooldown = true;
      requestAnimationFrame(async () => {
        try {
          // 【持续触顶连拉 (Rules)】用户停在顶部不松手时连续补页，直到
          //   ① 视口被新增内容顶离顶部 ② 历史真正耗尽 ③ 达到单手势上限。
          let chain = 0;
          do {
            const before = state.messages.length;
            await loadOlderMessages();
            chain += 1;
            const el = document.getElementById('conversation-stream');
            const stillNearTop = Boolean(el && computeStillNearTop(el.scrollTop, el.clientHeight));
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
    };

    // 短列表（不足一屏无滚动条）或已停在 scrollTop=0 时，向上滚轮仍应触发历史拉取
    streamEl.onwheel = (e: WheelEvent) => {
      if (e.deltaY >= 0 || streamScrollCooldown || state.isLoadingOlder) return;
      if (state.activeFocus.type === 'group' || !state.activeSessionId || !state.hasOlderMessages) return;
      const isShortNoOverflow = streamEl.scrollHeight <= streamEl.clientHeight + 4;
      if (isShortNoOverflow) {
        initialBottomSettling = false;
      }
      if (initialBottomSettling) return;
      if (streamEl.scrollTop <= 4 || isShortNoOverflow) {
        readerScrolledSessionId = state.activeSessionId;
        settledLayoutSignature = layoutSignature();
        streamEl.onscroll?.(new Event('scroll'));
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

const dropdownKeybindController = createDropdownKeybindController({
  getState: () => state,
  render: () => render(),
  switchModel: (model, provider) => switchModel(model, provider),
  switchReasoning: (level) => switchReasoning(level),
  modalInteractionController,
  ensureSettingsSectionData: (section) => ensureSettingsSectionData(section),
  getLastInputDockSnapshot: () => renderCoordinator.getLastInputDockSnapshot(),
  setLastInputDockSnapshot: (snapshot) => renderCoordinator.setLastInputDockSnapshot(snapshot),
});

function bindModelDropdownEvents(): void {
  dropdownKeybindController.bindModelDropdownEvents();
}

function pickReasoningLevel(item: HTMLElement): void {
  dropdownKeybindController.pickReasoningLevel(item);
}

function hideModelCascade(): void {
  dropdownKeybindController.hideModelCascade();
}

function scheduleHideModelCascade(): void {
  dropdownKeybindController.scheduleHideModelCascade();
}

function cancelHideModelCascade(): void {
  dropdownKeybindController.cancelHideModelCascade();
}

function resetModelSearchOnOpen(): void {
  dropdownKeybindController.resetModelSearchOnOpen();
}

function showModelCascade(row: HTMLElement): void {
  dropdownKeybindController.showModelCascade(row);
}

function closeModelMenu(): void {
  dropdownKeybindController.closeModelMenu();
}

function updateModelDropdownSubtree(): void {
  dropdownKeybindController.updateModelDropdownSubtree();
}

dropdownKeybindController.setupGlobalKeybinds();
dropdownKeybindController.setupOutsideClickHandlers();

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
  // 【规则】演示态必须带上真实的模型目录形状，否则模型选择器的折叠、搜索、思考级联
  // 在 `?demo=conversation` 下全是空列表，等于没法验收交互。这里走与网关完全相同的归一化入口。
  const demoEntries = normalizeModelCatalog({
    providers: [
      {
        slug: 'cpa',
        name: 'cpa',
        models: ['anthropic/claude-opus-5', 'gemini-3.8-flash', 'deepseek-v4.1-flash', 'qwen3-max'],
      },
      { slug: 'nous', name: 'Nous Portal', models: ['zai/glm-5.2', 'kimi-k2', 'openrouter/sonoma-sky'] },
      { slug: 'xai-oauth', name: 'xAI Grok OAuth', models: ['grok-4.20'] },
    ],
  });
  state.modelCatalog = demoEntries;
  state.availableModels = demoEntries.map((entry) => entry.id);
  state.modelDetails = demoEntries.map<ModelDetail>((entry) => ({
    id: entry.id,
    provider: entry.providerSlug,
    name: entry.displayName,
    displayName: entry.displayName,
  }));
  state.modelCatalogHash = modelCatalogFingerprint(demoEntries);
  state.currentProvider = 'cpa';
  state.selectedModel = 'gemini-3.8-flash';
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

  // 【在场指示器能耗管制】必须写一次初值：仅靠 visibilitychange 事件，
  // 冷启动时若页面已在后台（Electron 预创建窗口），CSS 的暂停规则永远收不到 true。
  document.documentElement.dataset.appHidden = String(document.visibilityState === 'hidden');

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

  const syncPageHiddenAttr = (): void => {
    if (document.visibilityState === 'hidden') {
      document.documentElement.dataset.pageHidden = 'true';
    } else {
      delete document.documentElement.dataset.pageHidden;
    }
  };
  syncPageHiddenAttr();

  // 页面从隐藏恢复但未触发窗口 focus 时，也要及时同步服务端改名/改描述。
  document.addEventListener('visibilitychange', () => {
    document.documentElement.dataset.appHidden = String(document.visibilityState === 'hidden');
    syncPageHiddenAttr();
    if (document.visibilityState === 'visible') void refreshProfilesFromServer();
  });
}

init();
