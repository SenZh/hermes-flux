/**
 * Hermes Flux Desktop Renderer Application Entry (v4.0 Production)
 * Fully powered by @hermes-flux/core and @hermes-flux/ui
 * Zero private WS glue code: Dual-channel fallback, TokenCoalescer 120 FPS stream, robust model & session lifecycle.
 */

import type { IRpcCaller } from '@hermes-flux/core';
import {
  toNormalizedSession, toLeftRailGroupRoom, toAgentProfile,
  persistMessagesToCache as bridgePersistMessagesToCache,
  persistTurnToCache as bridgePersistTurnToCache,
  persistSessionsToCache as bridgePersistSessionsToCache,
  persistGroupsToCache as bridgePersistGroupsToCache,
  persistAgentsToCache as bridgePersistAgentsToCache, defaultIndexWriteQueue,
} from './cache/desktopCacheBridge.js';
import { createFileViewerService } from './services/fileViewerService.js';
import { createConversationStreamController } from './events/conversationStreamController.js';
import { createTokenStreamWriter } from './stream/tokenStreamWriter.js';
import { type StreamAnchor, type StreamViewportManager, STICK_TO_BOTTOM_THRESHOLD_PX } from './viewport/streamViewportManager.js';
import { createDesktopStreamViewport, streamSettleState } from './viewport/desktopStreamViewport.js';
import { PromptNavigatorManager } from './navigation/promptNavigatorManager.js';
import { createLeftRailController } from './events/leftRailController.js';
import { createPresenceController } from './events/presenceController.js';
import { createOnboardingController } from './events/onboardingController.js';
import { createTitlebarController } from './titlebarController.js';
import { createAppBootstrap } from './bootstrap/appBootstrap.js';
import {
  type SettingsSectionId, type SettingsSnapshot, type SettingsActions,
  renderMarkdown, escapeHtml, MessageViewModel, type LeftRailGroupRoom,
  type LeftRailSession, type LeftRailProfile, t, type RenderInputDockSnapshot,
  resolveSkinId, type LeftRailActions, type LeftRailSnapshot, type TitlebarSnapshot,
  mountAgentPresence, type AgentPresenceSnapshot, type PromptNavigatorSnapshot,
  type PromptNavigatorActions, type ConversationMount, type ConversationSnapshot,
  type ConversationMessageVM, loadFontPreferences, applyFontPreferences,
  loadActivityIndicatorVariant, saveActivityIndicatorVariant, resolveActivityIndicatorVariant,
  type ActivityIndicatorVariant, setLocale, collectTouchedFiles, type FontPreferences,
  renderToolCapsuleSlot, formatLeftRailTime,
} from '@hermes-flux/ui';
import { createToolPatchQueue } from './toolPatchQueue.js';
import { resolveColdStartFocus } from './coldStartFocus.js';
import { createModalInteractionController } from './events/modalInteractionController.js';
import { createInputDockController } from './events/inputDockController.js';
import { type AppState, createInitialState } from './state/appState.js';
import { createTurnExecutionService } from './services/turnExecutionService.js';
import { createGatewayEventDispatcher } from './gateway/gatewayEventDispatcher.js';
type GatewayAuthResponse = { ok: boolean; message: string; latency: number };
import { createProjectOperationService } from './services/projectOperationService.js';
import { createGroupOperationService } from './services/groupOperationService.js';
import { createProfileManagementService } from './services/profileManagementService.js';
import { createSettingsDataService } from './services/settingsDataService.js';
import {
  HermesGatewayClient, TokenCoalescer, readSessionHandles,
  defaultSessionHandleRegistry, createLogger, setLogLevel, addLogSink,
  getLogLevel, parseLogLevel, type LogLevel, type TurnAction,
  type NormalizedSession, modelCatalogFingerprint, type AgentPresence,
  type AgentProfile, ProfileService, GroupRoomStore, GroupLogPollerManager,
  settleTurnTermination, applyTurnCompleted, ActivityTransitionTracker,
  type ActivityDomain, type GroupMessageEntry, InteractiveService,
  HandoffService, runGuarded, SessionListGeneration, CacheService,
  type CachedMessageRow, type CacheChannelRef, type MessageDisplayKind,
} from '@hermes-flux/core';
import { profilesDiffer } from './profileRefresh.js';
import { createInputCompletion } from './completion/inputCompletion.js';
import { createBotActivityStore } from './persistence/botActivityStore.js';
import { createSessionDraftStore } from './persistence/sessionDrafts.js';
import { DesktopCacheStore } from './cache/DesktopCacheStore.js';
import { createMessageLoadingService } from './services/messageLoadingService.js';
import { type SessionOperationService, createSessionOperationService } from './services/sessionOperationService.js';
import { createMessageWindowManager } from './messageWindowManager.js';
import { createRenderCoordinator, type RenderMessagesSnapshot } from './renderCoordinator.js';
import { createDropdownKeybindController } from './dropdownKeybindController.js';
import type { HermesDesktopBridge } from '../preload/index.js';

const cacheService = new CacheService(new DesktopCacheStore(), { sessionCap: 500, messageCap: 2000 });

function persistMessagesToCache(ref: CacheChannelRef, messages: MessageViewModel[], fenceMax: number): void {
  bridgePersistMessagesToCache(ref, messages, fenceMax, cacheService);
}

function persistTurnToCache(sessionId: string, botName: string | undefined | null, messages: MessageViewModel[]): void {
  bridgePersistTurnToCache(sessionId, botName, messages, cacheService, isGroupConversationActive(sessionId), state.profileName || 'default');
}

async function restoreCacheToState(): Promise<void> {
  try {
    const [indexRows, agents, avatars] = await Promise.all([
      cacheService.readSessions(), cacheService.readAgents(), cacheService.readAvatars(),
    ]);
    let touched = false;
    if (avatars && Object.keys(avatars).length > 0) {
      for (const [k, v] of Object.entries(avatars)) {
        if (v && typeof v === 'string') profileAvatarCache.set(k.toLowerCase(), v);
      }
    }
    if (state.sessions.length === 0) {
      const cachedSessions = indexRows.filter((row) => row.kind === 'session');
      if (cachedSessions.length > 0) { state.sessions = cachedSessions.map(toNormalizedSession); touched = true; }
    }
    if (state.groupRooms.length === 0) {
      const cachedGroups = indexRows.filter((row) => row.kind === 'group');
      if (cachedGroups.length > 0) { state.groupRooms = cachedGroups.map(toLeftRailGroupRoom); touched = true; }
    }
    if (agents.length > 0 && state.profiles.length === 0) {
      state.profiles = agents.map(toAgentProfile); touched = true;
    }
    if (touched) {
      logApp.info('cold start cache snapshot restored', {
        sessions: state.sessions.length, groups: state.groupRooms.length,
        profiles: state.profiles.length, avatars: Object.keys(avatars || {}).length,
      });
      if (state.profiles.length > 0) state.profilesPhase = 'ready';
      if (state.sessions.length > 0) state.sessionsPhase = 'ready';
      render();
    }
  // gate-degrade: 本地快照读取失败安全回退到权威网络
  } catch {
  } finally {
    void applyColdStartFocus();
  }
}

function persistSessionsToCache(sessions: NormalizedSession[]): void {
  bridgePersistSessionsToCache(sessions, cacheService, state.profileName || 'default', defaultIndexWriteQueue);
}
function persistGroupsToCache(rooms: LeftRailGroupRoom[]): void {
  bridgePersistGroupsToCache(rooms, cacheService, defaultIndexWriteQueue);
}
function persistAgentsToCache(profiles: AgentProfile[]): void {
  bridgePersistAgentsToCache(profiles, cacheService);
}

declare global {
  interface Window {
    hermesDesktop?: HermesDesktopBridge;
    __fluxLog?: {
      readonly level: LogLevel;
      setLevel(next: string): LogLevel;
      getSinkCount(): number;
    };
    __fluxMessageActions?: {
      handleCopyMessage: (btn: HTMLElement) => Promise<void>;
      handleRollbackMessage: (btn: HTMLElement) => void;
      handleForkMessage: (btn: HTMLElement) => Promise<void>;
    };
  }
}

const desktopApi: HermesDesktopBridge | undefined =
  typeof window !== 'undefined' ? window.hermesDesktop : undefined;

const bootLog = createLogger('boot');
addLogSink((entry) => {
  if (entry.level === 'error') {
    console.error(`[Flux ${entry.scope}]`, entry.message, entry.data ?? '');
  } else if (entry.level === 'warn') {
    console.warn(`[Flux ${entry.scope}]`, entry.message, entry.data ?? '');
  } else if (entry.level === 'debug' || entry.level === 'trace') {
    console.debug(`[Flux ${entry.scope}]`, entry.message, entry.data ?? '');
  } else {
    console.log(`[Flux ${entry.scope}]`, entry.message, entry.data ?? '');
  }
});

const LOG_LEVEL_STORAGE_KEY = 'hermes_flux_log_level';
const LEFT_RAIL_WIDTH = { min: 264, max: 480, defaultValue: 264 } as const;

function clampLeftRailWidth(raw: string | null): number {
  const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) return LEFT_RAIL_WIDTH.defaultValue;
  return Math.round(Math.max(LEFT_RAIL_WIDTH.min, Math.min(LEFT_RAIL_WIDTH.max, parsed)));
}

function resolveInitialLogLevel(): LogLevel {
  try {
    const raw = localStorage.getItem(LOG_LEVEL_STORAGE_KEY);
    if (!raw) return 'info';
    const parsed = parseLogLevel(raw);
    return parsed ?? 'info';
  } catch {
    return 'info';
  }
}

const initialLogLevel = resolveInitialLogLevel();
setLogLevel(initialLogLevel);
bootLog.info('runtime log level initialized', { level: initialLogLevel });

if (typeof window !== 'undefined') {
  window.__fluxLog = {
    get level() { return getLogLevel(); },
    setLevel(next: string): LogLevel {
      const parsed = parseLogLevel(next);
      if (!parsed) throw new Error(`Invalid log level: "${next}". Expected: trace | debug | info | warn | error | silent`);
      setLogLevel(parsed);
      // gate-degrade: 日志等级持久化容错
      try { localStorage.setItem(LOG_LEVEL_STORAGE_KEY, parsed); } catch {}
      console.log('[Flux Log] level changed to', parsed);
      return parsed;
    },
    getSinkCount() { return 1; },
  };
}

async function safeCopyText(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  // gate-degrade: 主剪贴板通道不可用时降级
  } catch {}
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text; textarea.style.position = 'fixed'; textarea.style.left = '-9999px'; textarea.style.top = '-9999px';
    document.body.appendChild(textarea); textarea.focus(); textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea); return ok;
  // gate-degrade: 剪贴板降级通道失败
  } catch { return false; }
}

async function testConnection(url: string, user?: string, pass?: string): Promise<GatewayAuthResponse> {
  try {
    if (!desktopApi?.authenticateGateway) return { ok: false, message: t('chat.gatewayNotConnected'), latency: 0 };
    return await desktopApi.authenticateGateway({ url, username: user || '', password: pass || '' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : t('chat.gatewayNotConnected');
    return { ok: false, message, latency: 0 };
  }
}

function detectInitialPlatform(): 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'web' {
  if (typeof navigator === 'undefined') return 'windows';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('linux')) return 'linux';
  if (ua.includes('iphone') || ua.includes('ipad')) return 'ios';
  if (ua.includes('android')) return 'android';
  return 'windows';
}

const profileService = new ProfileService();
const groupRoomStore = new GroupRoomStore();

const PRESENCE_LAYOUT_STORAGE_KEY = 'hermes_flux_presence_layout';

function readPresenceLayout(): 'stage' | 'dock' {
  try {
    const raw = localStorage.getItem(PRESENCE_LAYOUT_STORAGE_KEY);
    return raw === 'dock' ? 'dock' : 'stage';
  } catch (error) {
    console.warn('[presence] failed to read layout preference; falling back to stage', error);
    return 'stage';
  }
}

function writePresenceLayout(layout: 'stage' | 'dock'): void {
  try {
    localStorage.setItem(PRESENCE_LAYOUT_STORAGE_KEY, layout);
  } catch (error) {
    console.warn('[presence] failed to persist layout preference; session-only', error);
  }
}

const titlebarController = createTitlebarController({
  getDesktopApi: () => desktopApi,
  render: () => render(),
  getState: () => state,
  t: (k) => t(k),
});

const getTitlebarSnapshot = (): TitlebarSnapshot => titlebarController.getTitlebarSnapshot();
const handoffService = new HandoffService();

let sessionOperationService!: SessionOperationService;
let fontPreferences: FontPreferences = loadFontPreferences();
let activityIndicatorVariant: ActivityIndicatorVariant = loadActivityIndicatorVariant();

const state: AppState = {
  ...createInitialState({ platform: detectInitialPlatform() }),
};

const logApp = createLogger('app'), logRender = createLogger('render'), logSession = createLogger('session'), logStream = createLogger('stream'), logScroll = createLogger('scroll');

let gatewayClient: HermesGatewayClient | null = null, currentTicket: string | null = null;
let sessionsRefreshTimer: ReturnType<typeof setTimeout> | null = null, dockNoticeDismissTimer: ReturnType<typeof setTimeout> | null = null;
let activeStreamingMessageId: string | null = null, activeStreamingStoredSessionId: string | null = null;
let activeStreamingLiveId: string | null = null, activeStreamingBotName: string | null = null, activeLoadMessagesGeneration = 0;

const rpcCaller: IRpcCaller = {
  request: <TResult = unknown, TParams = unknown>(method: string, params?: TParams): Promise<TResult> => {
    if (!gatewayClient) return Promise.reject(new Error('Gateway client not connected'));
    return gatewayClient.call<TResult>(method, params);
  },
};

const sessionDrafts = createSessionDraftStore({ onPersistError: (err) => console.warn('[Flux] session draft persist failed:', err) });
const unreadSessionIds = new Set<string>(), unreadGroupRoomIds = new Set<string>(), unreadBotNames = new Set<string>();
const activeRunningGroupRoomIds = new Set<string>(), activeRunningSessionIds = new Set<string>(), activeRunningBotNames = new Set<string>();

const activityTransitionTracker = new ActivityTransitionTracker({ windowMs: 850 });
let activityTransitionRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function clearTransitionRefreshTimer(): void {
  if (activityTransitionRefreshTimer !== null) { clearTimeout(activityTransitionRefreshTimer); activityTransitionRefreshTimer = null; }
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

function completeEntityTurn(domain: ActivityDomain, running: Set<string>, unread: Set<string>, entityId: string, isFocused: boolean): void {
  if (!entityId) return;
  const wasRunning = running.has(entityId) || (domain === 'session' && activeStreamingStoredSessionId === entityId);
  applyTurnCompleted(running, unread, entityId, isFocused);
  if (wasRunning) {
    activityTransitionTracker.recordCompleted(domain, entityId, isFocused ? 'read' : 'unread', Date.now());
    scheduleTransitionRefresh();
  }
}

function toStoredSessionId(id: string | null | undefined): string | null {
  if (!id) return null;
  const known = state.sessions.map((s) => s.id);
  const resolved = defaultSessionHandleRegistry.toStoredId(id, known);
  if (resolved && resolved !== id) return resolved;
  if (activeStreamingLiveId && id === activeStreamingLiveId && activeStreamingStoredSessionId) return activeStreamingStoredSessionId;
  if (state.activeLiveSessionId && id === state.activeLiveSessionId && state.activeSessionId) return state.activeSessionId;
  return resolved;
}

const AVATAR_PERSISTENCE_KEY = 'hermes_flux_avatar_cache';
const profileAvatarCache = new Map<string, string>();
try {
  const raw = localStorage.getItem(AVATAR_PERSISTENCE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) { if (typeof v === 'string') profileAvatarCache.set(k.toLowerCase(), v); }
    }
  }
// gate-degrade: 本地头像恢复失败可安全跳过
} catch {}

function persistAvatarCache(): void {
  try {
    const obj: Record<string, string> = {};
    for (const [k, v] of profileAvatarCache.entries()) obj[k] = v;
    localStorage.setItem(AVATAR_PERSISTENCE_KEY, JSON.stringify(obj));
    cacheService.writeAvatars(obj).catch(() => {});
  // gate-degrade: 头像写入持久化存储失败降级
  } catch {}
}

const botActivityStore = createBotActivityStore({
  profiles: () => state.profiles, setProfiles: (next) => { state.profiles = next; },
  formatTime: (ts) => formatSessionTime(ts), onPersistError: (err) => console.warn('[Flux] bot activity persist failed:', err),
});

function restoreComposerFocus(): void {
  setTimeout(() => {
    const input = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
    if (input && document.activeElement !== input) input.focus();
  }, 30);
}

function resolveAgentAvatar(nameOrDisplayName?: string): string {
  if (!nameOrDisplayName) return '';
  const key = nameOrDisplayName.trim().toLowerCase();
  const cached = profileAvatarCache.get(key);
  if (cached) return cached;
  const match = state.profiles.find((p) => p.name.toLowerCase() === key || p.displayName.toLowerCase() === key);
  if (match?.avatar) {
    profileAvatarCache.set(key, match.avatar);
    profileAvatarCache.set(match.name.toLowerCase(), match.avatar);
    profileAvatarCache.set(match.displayName.toLowerCase(), match.avatar);
    persistAvatarCache();
    return match.avatar;
  }
  return '';
}

const TURN_WATCHDOG_MS = 10 * 60 * 1000;
function describeRpcError(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    const code = typeof obj.code === 'number' ? ` (code: ${obj.code})` : '';
    if (typeof obj.message === 'string' && obj.message) return `${obj.message}${code}`;
    if (typeof obj.error === 'string' && obj.error) return `${obj.error}${code}`;
    // gate-degrade: JSON 序列化失败直接 String(error)
    try { return JSON.stringify(error); } catch {}
  }
  return String(error);
}

function isExtraInputsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const obj = error as Record<string, unknown>;
  const msg = typeof obj.message === 'string' ? obj.message : '';
  const data = typeof obj.data === 'string' ? obj.data : '';
  return obj.code === -32602 && (msg.includes('Extra inputs are not permitted') || data.includes('Extra inputs are not permitted'));
}

let streamViewportManager!: StreamViewportManager;

const isStreamNearBottom = (s: HTMLElement | null): boolean => (streamViewportManager ? streamViewportManager.isNearBottom(s) : false);
const scrollStreamToBottom = (r: string): void => { streamViewportManager?.scrollStreamToBottom(r); };
const settleInitialBottom = (attempt = 0): void => { streamViewportManager?.settleInitialBottom(attempt); };
const syncStreamBottomInset = (): void => { streamViewportManager?.syncStreamBottomInset(); };
const scheduleStreamBottomInset = (): void => { streamViewportManager?.scheduleStreamBottomInset(); };
const scrollStreamToContentBottom = (s: HTMLElement, r: number): void => { streamViewportManager?.scrollStreamToContentBottom(s, r); };

const sessionMessagesCache = new Map<string, MessageViewModel[]>();
const tokenStreamWriter = createTokenStreamWriter({
  getState: () => state, sessionMessagesCache, botActivityStore,
  getActiveStreamingStoredSessionId: () => activeStreamingStoredSessionId,
  isStreamNearBottom: (s) => isStreamNearBottom(s), markProgrammaticScroll: (s) => markProgrammaticScroll(s), logStream,
});

const tokenCoalescer = new TokenCoalescer((flushedMap) => { tokenStreamWriter.writeFlushedTokens(flushedMap); });

let canvasStructureDirty = false;
const toolPatchQueue = createToolPatchQueue({
  renderSlot: (messageId) => {
    const msg = state.messages.find((m) => m.id === messageId) || (activeStreamingStoredSessionId ? sessionMessagesCache.get(activeStreamingStoredSessionId)?.find((m) => m.id === messageId) : undefined);
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
  markStructureDirty: () => { canvasStructureDirty = true; }, schedule: (cb) => requestAnimationFrame(cb),
});

const scheduleToolPatch = (mid: string) => toolPatchQueue.schedulePatch(mid);

function getEffectiveUrl(base: string): string {
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

function rpcErrorCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const obj = error as Record<string, unknown>;
  return typeof obj.code === 'number' ? obj.code : null;
}

function scheduleSessionsRefresh(delayMs = 180): void {
  if (sessionsRefreshTimer) clearTimeout(sessionsRefreshTimer);
  sessionsRefreshTimer = setTimeout(() => { sessionsRefreshTimer = null; void fetchSessions(); }, delayMs);
}

function formatSessionTime(timestamp: number): string { return formatLeftRailTime(timestamp); }

const sessionListGeneration = new SessionListGeneration();
const sessionPreviewCache = new Map<string, { lastActive: number; text: string; botName?: string }>();
const persistSessionPreviewCache = (): void => {};

const botForeverChatCache = new Map<string, string>();
const projectOperationService = createProjectOperationService({
  getState: () => state,
  getGatewayClient: () => gatewayClient,
  render: () => render(),
  botActivityStore,
  botForeverChatCache,
  sessionMessagesCache,
  formatSessionTime,
});

const syncProfileLastMessages = () => projectOperationService.syncProfileLastMessages();
const fetchProjects = () => projectOperationService.fetchProjects();

const groupOperationService = createGroupOperationService({
  getState: () => state, getGatewayClient: () => gatewayClient, render: () => render(),
  t: (k, p) => t(k, p), disarmRollbackOnLeave: () => disarmRollbackOnLeave(),
  unreadGroupRoomIds, activeRunningGroupRoomIds, activityTransitionTracker,
  turnExecutionService: {
    resetActiveGroupThread: () => turnExecutionService.resetActiveGroupThread(),
    syncGroupRoomLogsToState: (r, l) => turnExecutionService.syncGroupRoomLogsToState(r, l),
    refreshGroupRoomLog: (r) => turnExecutionService.refreshGroupRoomLog(r),
    sendGroupMessage: (r, t) => turnExecutionService.sendGroupMessage(r, t),
  },
  groupPollerManager: {
    isPolling: (r) => groupPollerManager.isPolling(r),
    startAwaitReply: (r, b) => groupPollerManager.startAwaitReply(r, b),
    stop: (r) => groupPollerManager.stop(r),
    stopAll: () => groupPollerManager.stopAll(),
  },
  persistGroupsToCache: (r) => persistGroupsToCache(r), resolveAgentAvatar: (n) => resolveAgentAvatar(n),
  formatTimestamp: (ts) => formatTimestamp(ts), nextLoadMessagesGeneration: () => ++activeLoadMessagesGeneration,
  getCurrentLoadMessagesGeneration: () => activeLoadMessagesGeneration, logSession,
  setPendingScrollToBottom: (p) => renderCoordinator.setPendingScrollToBottom(p),
  captureStreamAnchor: () => captureStreamAnchor(),
  beginSessionEnter: (id, opts) => streamViewportManager.beginSessionEnter(id, opts),
});

const hostedRoomIds = groupOperationService.hostedRoomIds as Set<string>;
const fetchGroupRooms = () => groupOperationService.fetchGroupRooms();
const syncActiveGroupSpeakerFromMessages = () => groupOperationService.syncActiveGroupSpeakerFromMessages();
const openGroupRoom = (r: string) => groupOperationService.openGroupRoom(r);

const profileManagementService = createProfileManagementService({
  getState: () => state, getGatewayClient: () => gatewayClient, render: () => render(),
  t: (k, p) => t(k, p), describeRpcError: (e) => describeRpcError(e),
  botActivityStore, unreadBotNames, activityTransitionTracker, sessionMessagesCache,
  syncProfileLastMessages: () => syncProfileLastMessages(), applyColdStartFocus: async () => applyColdStartFocus(),
  cancelColdStartFocus: () => cancelColdStartFocus(), fetchSessions: async () => fetchSessions(),
  fetchModelOptions: async (opts) => fetchModelOptions(opts), selectSession: async (id, opts) => selectSession(id, opts),
  openGroupRoom: async (r) => openGroupRoom(r), restoreComposerFocus: () => restoreComposerFocus(),
  disarmRollbackOnLeave: () => disarmRollbackOnLeave(), persistAgentsToCache: (p) => persistAgentsToCache(p),
  persistAvatarCache: () => persistAvatarCache(), profileAvatarCache, botForeverChatCache,
  nextLoadMessagesGeneration: () => ++activeLoadMessagesGeneration, getCurrentLoadMessagesGeneration: () => activeLoadMessagesGeneration,
  logSession, setPendingScrollToBottom: (p) => renderCoordinator.setPendingScrollToBottom(p),
  captureStreamAnchor: () => captureStreamAnchor(),
});

const openBotChat = (p: string) => profileManagementService.openBotChat(p);

let coldStartFocusPending = true;
let coldStartFocusApplied = false;
const cancelColdStartFocus = (): void => { coldStartFocusPending = false; };

async function applyColdStartFocus(): Promise<void> {
  if (!coldStartFocusPending || coldStartFocusApplied) return;
  if (state.profilesPhase !== 'ready') return;
  if (!gatewayClient || !getEffectiveUrl(state.gatewayUrl) || !state.gatewayConnected) return;
  const storedProfileName = localStorage.getItem('hermes_flux_profile') || localStorage.getItem('hermes_aura_profile') || (state.profileName !== 'default' ? state.profileName : undefined);
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
    state.availableModels = []; state.modelDetails = []; state.modelCatalog = []; state.modelCatalogHash = '';
    state.dockNotice = t('chat.gatewayNotConnected'); render(); return;
  }
  const catalog = await gatewayClient.getModelCatalog(state.profileName || 'default');
  if (!catalog.ok) {
    state.availableModels = []; state.modelDetails = []; state.modelCatalog = []; state.modelCatalogHash = '';
    state.dockNotice = catalog.error || t('chat.gatewayNotConnected'); render(); return;
  }
  state.availableModels = catalog.models; state.modelDetails = catalog.details;
  state.modelCatalog = catalog.entries; state.modelCatalogHash = modelCatalogFingerprint(catalog.entries);
  state.currentProvider = catalog.currentProvider;
  if (catalog.currentModel) state.selectedModel = catalog.currentModel;
  else if (!state.selectedModel && catalog.models.length > 0) state.selectedModel = catalog.models[0];
  if (options.clearNotice !== false) state.dockNotice = '';
  render();
}

const syncSessionBotDisplayNames = (p: AgentProfile[]) => profileManagementService.syncSessionBotDisplayNames(p);
const fetchProfiles = (opts: { refresh?: boolean } = {}) => profileManagementService.fetchProfiles(opts);
const warmBotForeverChats = (list: AgentProfile[], client: NonNullable<typeof gatewayClient>) => profileManagementService.warmBotForeverChats(list, client);
const stopProfileAutoRefresh = () => profileManagementService.stopProfileAutoRefresh();
const startProfileAutoRefresh = () => profileManagementService.startProfileAutoRefresh();

const INITIAL_WINDOW_PAGE_SIZE = 100;
const OLDER_BATCH_PAGE_SIZE = 500;
const INITIAL_RENDER_WINDOW = 24;
const RENDER_WINDOW_STEP = 40;
const MESSAGE_WINDOW_CAPACITY = 120;

let messageWindowStart = 0;
let messageWindowEnd = 0;
let messageWindowUserExpanded = false;
let averageRowHeightPx = 80;
let streamScrollCooldown = 0;
let lastStreamScrollTop = 0;
let programmaticScrollTarget: number | null = null;
let programmaticScrollIgnoreUntil = 0;
let layoutDriftUntil = 0;
let readerScrolledSessionId: string | null = null;
let sessionSwitchPending = false;

const messageWindowManager = createMessageWindowManager({
  getState: () => state, render: () => render(),
  isStreamNearBottom: (stream) => isStreamNearBottom(stream), scrollStreamToBottom: (reason) => scrollStreamToBottom(reason),
  scrollStreamToContentBottom: (stream, inset) => scrollStreamToContentBottom(stream, inset),
  settleInitialBottom: () => settleInitialBottom(), syncPromptNavigatorFromScroll: () => syncPromptNavigatorFromScroll(),
  setCanvasStructureDirty: (val) => { canvasStructureDirty = val; }, setSuppressPinBottomOnce: (val) => renderCoordinator.setSuppressPinBottomOnce(val),
  setSessionSwitchPending: (val) => { sessionSwitchPending = val; }, setSettleMinFrames: (val) => { streamSettleState.settleMinFrames = val; },
  setInitialBottomSettling: (val) => { streamSettleState.initialBottomSettling = val; }, setSettledLayoutSignature: (val) => { streamSettleState.settledLayoutSignature = val; },
  setLastStreamScrollTop: (val) => { lastStreamScrollTop = val; },
  setStreamScrollCooldown: (val) => { streamScrollCooldown = val ? Date.now() + 180 : 0; },
  logScroll,
});

function syncWindowLocalState(): void {
  messageWindowStart = messageWindowManager.getMessageWindowStart();
  messageWindowEnd = messageWindowManager.getMessageWindowEnd();
  messageWindowUserExpanded = messageWindowManager.isMessageWindowUserExpanded();
  averageRowHeightPx = messageWindowManager.getAverageRowHeightPx();
}

const layoutSignature = (): string => `${state.activeSessionId ?? ''}:${state.messages.length}:${messageWindowStart}:${messageWindowEnd}`;
function markProgrammaticScroll(stream: HTMLElement): void {
  programmaticScrollTarget = Math.round(stream.scrollTop);
  programmaticScrollIgnoreUntil = Date.now() + 180;
}

const ensureMessageWindow = (total: number) => { messageWindowManager.ensureMessageWindow(total); syncWindowLocalState(); };
const expandMessageWindow = () => { const r = messageWindowManager.expandMessageWindow(); syncWindowLocalState(); return r; };
const slideMessageWindowForward = () => { messageWindowManager.slideMessageWindowForward(); syncWindowLocalState(); };
const relocateMessageWindowToIndex = (idx: number) => { const r = messageWindowManager.relocateMessageWindowToIndex(idx); syncWindowLocalState(); return r; };
const syncScrollTopToWindow = (reason: string) => { messageWindowManager.syncScrollTopToWindow(reason); syncWindowLocalState(); };
const scheduleVirtualHeightSync = (att = 0) => { messageWindowManager.scheduleVirtualHeightSync(att); syncWindowLocalState(); };

const PROMPT_READ_LINE_PX = 100;
const isGroupConversationActive = (sessionId = state.activeSessionId): boolean => {
  if (state.activeFocus.type === 'group') return true;
  if (!sessionId) return false;
  return Boolean(state.groupRooms.some((r) => r.roomId === sessionId) || hostedRoomIds.has(sessionId));
};

const promptNavigatorManager = new PromptNavigatorManager({
  getActiveSessionId: () => state.activeSessionId, getMessages: () => state.messages, getLang: () => state.lang,
  hasOlderMessages: () => state.hasOlderMessages, isLoadingOlder: () => state.isLoadingOlder,
  isGroupConversationActive: () => isGroupConversationActive(), getAverageRowHeightPx: () => averageRowHeightPx,
  isAverageRowHeightLocked: () => messageWindowManager.isAverageRowHeightLocked(),
  getStreamElement: () => document.getElementById('conversation-stream'),
  relocateMessageWindowToIndex: (idx) => relocateMessageWindowToIndex(idx),
  triggerRenderForJump: () => render(), loadOlderMessages: (options) => loadOlderMessages(options),
});

const currentPromptNavigatorMeta = () => promptNavigatorManager.currentPromptNavigatorMeta();
const syncPromptNavigatorMeta = () => promptNavigatorManager.syncMeta();
const getPromptNavigatorSnapshot = (): PromptNavigatorSnapshot => promptNavigatorManager.getSnapshot();
const syncPromptNavigator = () => promptNavigatorManager.sync();
const rebuildPromptEntries = () => promptNavigatorManager.rebuildEntries();
const syncPromptNavigatorFromScroll = () => promptNavigatorManager.syncFromScroll();
const createPromptNavigatorActions = (): PromptNavigatorActions => promptNavigatorManager.createActions();
const jumpToPrompt = (mid: string) => promptNavigatorManager.jumpToPrompt(mid);

/**
 * 会话流视口管理器装配，必须晚于 promptNavigatorManager（依赖 isJumpSettling）。
 * 历史坑与落定状态单一真值源说明见 viewport/desktopStreamViewport.ts。
 */
streamViewportManager = createDesktopStreamViewport({
  getState: () => state,
  logScroll,
  layoutSignature: () => layoutSignature(),
  markProgrammaticScroll: (stream) => markProgrammaticScroll(stream),
  isPromptJumpSettling: () => promptNavigatorManager.isJumpSettling(),
  getWindowGeom: () => ({ start: messageWindowStart, end: messageWindowEnd, averageRowHeightPx }),
});

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(message: string, durationMs = 2200): void {
  let toastEl = document.getElementById('flux-floating-toast');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'flux-floating-toast';
    toastEl.style.cssText = `
      position: fixed; bottom: 96px; left: 50%; transform: translateX(-50%) translateY(10px);
      background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border-strong);
      box-shadow: var(--shadow-window); padding: 6px 14px; border-radius: 9999px; font-size: var(--fs-xs, 12px);
      font-weight: 500; z-index: 3000; pointer-events: none; display: flex; align-items: center; gap: 6px;
      backdrop-filter: blur(16px); transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1); opacity: 0;
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

const messageLoadingService = createMessageLoadingService({
  getState: () => state, getGatewayClient: () => gatewayClient, render: () => render(),
  sessionMessagesCache, cacheService,
  persistMessagesToCache: (ref, msgs, fMax) => persistMessagesToCache(ref, msgs, fMax ?? 0),
  syncPromptNavigatorMeta: () => syncPromptNavigatorMeta(), syncPromptNavigatorFromScroll: () => syncPromptNavigatorFromScroll(),
  scrollStreamToBottom: (r) => scrollStreamToBottom(r ?? ''), setPendingScrollToBottom: (v) => renderCoordinator.setPendingScrollToBottom(v),
  isStreamNearBottom: (el) => isStreamNearBottom(el), captureStreamAnchor: () => captureStreamAnchor(),
  applyStreamAnchor: (a, m) => applyStreamAnchor(a as StreamAnchor, m ?? false),
  getMessageWindowStart: () => messageWindowStart, setMessageWindowStart: (v) => { messageWindowStart = v; },
  getMessageWindowEnd: () => messageWindowEnd, setMessageWindowEnd: (v) => { messageWindowEnd = v; },
  setMessageWindowUserExpanded: (v) => { messageWindowUserExpanded = v; },
  setCanvasStructureDirty: (v) => { canvasStructureDirty = v; }, setSuppressPinBottomOnce: (v) => renderCoordinator.setSuppressPinBottomOnce(v),
  isGroupConversationActive: (id) => isGroupConversationActive(id), hostedRoomIds, formatSessionTime, formatTimestamp: (ts) => formatTimestamp(ts),
  botActivityStore, botForeverChatCache, sessionPreviewCache,
  persistSessionPreviewCache: () => persistSessionPreviewCache(), getActiveStreamingStoredSessionId: () => activeStreamingStoredSessionId,
  defaultSessionHandleRegistry, activeRunningSessionIds, activityTransitionTracker,
  getGeneration: () => activeLoadMessagesGeneration, onGenerationIncremented: (g) => { activeLoadMessagesGeneration = g; },
  logSession, logScroll,
});

const sessionServerOffset = messageLoadingService.sessionServerOffset;
const sessionAuthoritativeOffset = messageLoadingService.sessionAuthoritativeOffset;
const sessionParentOffsetMap = messageLoadingService.sessionParentOffsetMap;
const sessionOvershootRetry = messageLoadingService.sessionOvershootRetry;
const sessionHistoryTrust = messageLoadingService.sessionHistoryTrust;
const untrustedOrderCacheSessions = messageLoadingService.untrustedOrderCacheSessions;
const forgetOlderCursorState = (id: string) => messageLoadingService.forgetOlderCursorState(id);
const syncUntrustedCacheOrderFlag = (id: string, r: readonly CachedMessageRow[]) => messageLoadingService.syncUntrustedCacheOrderFlag(id, r);
const hasRemainingParentLineage = (id: string) => messageLoadingService.hasRemainingParentLineage(id);

sessionOperationService = createSessionOperationService({
  getState: () => state, getGatewayClient: () => gatewayClient, getDesktopApi: () => desktopApi,
  getCurrentTicket: () => currentTicket ?? null, getEffectiveUrl: (url) => getEffectiveUrl(url ?? state.gatewayUrl),
  render: () => render(), t, showToast, setTimedDockNotice: (m, d) => setTimedDockNotice(m, d),
  restoreComposerFocus: () => restoreComposerFocus(), sessionDrafts, sessionMessagesCache,
  unreadSessionIds, activeRunningSessionIds, activityTransitionTracker,
  sessionHandleRegistry: defaultSessionHandleRegistry, cacheService,
  persistSessionsToCache: (s) => persistSessionsToCache(s),
  forgetOlderCursorState: (id) => messageLoadingService.forgetOlderCursorState(id),
  sessionListGeneration, getActiveStreamingStoredSessionId: () => activeStreamingStoredSessionId,
  resetActiveStreamingState: () => {
    tokenCoalescer.clear(); disarmTurnWatchdog();
    activeStreamingMessageId = null; activeStreamingStoredSessionId = null;
    activeStreamingLiveId = null; activeStreamingBotName = null; state.isStreaming = false;
  },
  setPendingScrollToBottom: (v) => renderCoordinator.setPendingScrollToBottom(v),
  setLastMessagesSnapshot: (v) => { lastMessagesSnapshot = v as RenderMessagesSnapshot | null; },
  captureStreamAnchor: () => captureStreamAnchor(),
  beginSessionEnter: (id, opts) => streamViewportManager.beginSessionEnter(id, opts),
  loadMessages: (id, bot) => loadMessages(id, bot), openBotChat: (bot) => openBotChat(bot),
  ensureLiveSessionId: () => ensureLiveSessionId(),
  incrementActiveLoadMessagesGeneration: () => {
    const next = messageLoadingService.incrementGeneration();
    activeLoadMessagesGeneration = next;
    return next;
  },
  sessionPreviewCache, formatSessionTime: (ts) => formatSessionTime(ts),
  resolveAgentAvatar: (n) => resolveAgentAvatar(n), syncProfileLastMessages: () => syncProfileLastMessages(),
  logSessionWarn: (m, meta) => logSession.warn(m, meta), logSessionDebug: (m, meta) => logSession.debug(m, meta),
});

async function fetchSessions(): Promise<void> {
  // state.sessionsPhase = 'ready';
  // state.profilesPhase = 'ready';
  return sessionOperationService.fetchSessions();
}

const interactiveService = new InteractiveService();
const inputCompletion = createInputCompletion(
  {
    activeSessionId: () => state.activeSessionId, profileName: () => state.profileName,
    activeCwd: () => {
      const sess = state.sessions.find((s) => s.id === state.activeSessionId);
      if (sess?.cwd) return sess.cwd;
      const proj = state.projects.find((p) => p.id === sess?.projectId || (sess?.projectName && p.name === sess.projectName));
      return proj?.path || '';
    },
    openFiles: () => state.openFiles, agentMentionItems: () => state.mentionItems.filter((m) => m.type === 'agent'),
    inputText: () => {
      const el = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
      return el ? el.value : '';
    },
    setMentionItems: (items) => { state.mentionItems = items; },
    setMentionPopperOpen: (open) => { state.mentionPopperOpen = open; },
    setSlashItems: (items) => { state.slashItems = items; },
    setSlashPopperOpen: (open) => { state.slashPopperOpen = open; },
    render: () => render(), isGatewayReady: () => Boolean(gatewayClient), rpcCaller: () => rpcCaller,
  },
  interactiveService,
);

const parseRawMessages = (l: Parameters<typeof messageLoadingService.parseRawMessages>[0]) => messageLoadingService.parseRawMessages(l);
const loadOlderMessages = (o?: { preserveViewportWindow?: boolean }) => messageLoadingService.loadOlderMessages(o);
const syncActiveSessionPreviewToRail = (s: string, m: MessageViewModel[], b?: string) => messageLoadingService.syncActiveSessionPreviewToRail(s, m, b);

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

const loadMessagesInner = (s: string, b?: string) => messageLoadingService.loadMessagesInner(s, b);

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
        state.activeLiveSessionId = handles.liveId; liveId = handles.liveId;
      }, async () => undefined, logSession);
      return liveId;
    }
  } catch (e) { console.warn('[Flux] Failed to resolve live session id:', e); }
  return '';
}

const createNewSession = (o?: { profile?: string; projectId?: string; title?: string }) => sessionOperationService.createNewSession(o);
const deleteSession = (id: string) => sessionOperationService.deleteSession(id);
const renameSession = (id: string, title: string) => sessionOperationService.renameSession(id, title);
const copySessionId = (id: string) => sessionOperationService.copySessionId(id);
const pinSession = (id: string) => sessionOperationService.pinSession(id);
const exportMarkdown = (id: string) => sessionOperationService.exportMarkdown(id);
const archiveSession = (id: string) => sessionOperationService.archiveSession(id);
const handleArmedOnDelete = (id: string) => sessionOperationService.handleArmedOnDelete(id);
const disarmRollbackOnLeave = (outId?: string) => sessionOperationService.disarmRollbackOnLeave(outId);
const selectSession = (id: string, o?: { preserveFocus?: boolean; botName?: string }) => sessionOperationService.selectSession(id, o);
const applyModelToLiveSession = (m: string, p?: string) => sessionOperationService.applyModelToLiveSession(m, p);
const switchModel = (m: string, p?: string) => sessionOperationService.switchModel(m, p);
const switchReasoning = (e: AppState['reasoningLevel']) => sessionOperationService.switchReasoning(e);
const switchApproval = (m: 'manual' | 'smart' | 'off') => sessionOperationService.switchApproval(m);

const turnExecutionService = createTurnExecutionService({
  getState: () => state, getGatewayClient: () => gatewayClient, getRpcCaller: () => rpcCaller,
  getInteractiveService: () => interactiveService, getCacheService: () => cacheService,
  getGroupRoomStore: () => groupRoomStore, getActivityTransitionTracker: () => activityTransitionTracker,
  getTokenCoalescer: () => tokenCoalescer, getSessionHandleRegistry: () => defaultSessionHandleRegistry,
  getSessionMessagesCache: () => sessionMessagesCache, getSessionDrafts: () => sessionDrafts,
  getBotActivityStore: () => botActivityStore, getHandoffService: () => handoffService,
  completeEntityTurn, getActiveRunningSessionIds: () => activeRunningSessionIds,
  getUnreadSessionIds: () => unreadSessionIds, getActiveRunningBotNames: () => activeRunningBotNames,
  getUnreadBotNames: () => unreadBotNames, getActiveRunningGroupRoomIds: () => activeRunningGroupRoomIds,
  getUnreadGroupRoomIds: () => unreadGroupRoomIds,
  getActiveStreamingContext: () => ({ activeStreamingMessageId, activeStreamingStoredSessionId, activeStreamingLiveId, activeStreamingBotName }),
  setActiveStreamingContext: (ctx) => {
    if ('activeStreamingMessageId' in ctx) activeStreamingMessageId = ctx.activeStreamingMessageId ?? null;
    if ('activeStreamingStoredSessionId' in ctx) activeStreamingStoredSessionId = ctx.activeStreamingStoredSessionId ?? null;
    if ('activeStreamingLiveId' in ctx) activeStreamingLiveId = ctx.activeStreamingLiveId ?? null;
    if ('activeStreamingBotName' in ctx) activeStreamingBotName = ctx.activeStreamingBotName ?? null;
  },
  getTurnStartedSessionId: () => turnStartedSessionId, setTurnStartedSessionId: (id) => { turnStartedSessionId = id; },
  getSessionHistoryTrust: () => sessionHistoryTrust, forgetOlderCursorState: (id) => messageLoadingService.forgetOlderCursorState(id),
  createNewSession: () => createNewSession(), ensureLiveSessionId: () => ensureLiveSessionId(),
  setMessageContent: (mid, content) => setMessageContent(mid, content),
  syncActiveGroupSpeakerFromMessages: () => syncActiveGroupSpeakerFromMessages(),
  resolveAgentAvatar: (name) => resolveAgentAvatar(name), scrollStreamToBottom: (reason) => scrollStreamToBottom(reason),
  setPendingScrollToBottom: (val) => renderCoordinator.setPendingScrollToBottom(val), runSlashCommand: (cmd) => inputDockController.runSlashCommand(cmd),
  enqueueDraft: () => inputDockController.enqueueDraft(), handleQueueAction: (action, id) => inputDockController.handleQueueAction(action, id),
  setMessageWindowUserExpanded: (val) => { messageWindowUserExpanded = val; }, ensureMessageWindow: (total) => ensureMessageWindow(total),
  render: () => render(), t, logStream,
});

const groupPollerManager = turnExecutionService.getGroupPollerManager();

const gatewayEventDispatcher = createGatewayEventDispatcher({
  getState: () => state, getGatewayClient: () => gatewayClient, setGatewayClient: (client) => { gatewayClient = client; },
  getCurrentTicket: () => currentTicket ?? undefined, setCurrentTicket: (ticket) => { currentTicket = ticket ?? null; },
  getDesktopApi: () => desktopApi, getEffectiveUrl: (url) => getEffectiveUrl(url ?? state.gatewayUrl),
  testConnection: (url, user, pass) => testConnection(url, user, pass), completeEntityTurn,
  getSessionHandleRegistry: () => defaultSessionHandleRegistry, getSessionMessagesCache: () => sessionMessagesCache,
  getTokenCoalescer: () => tokenCoalescer, getActivityTransitionTracker: () => activityTransitionTracker,
  getBotActivityStore: () => botActivityStore, getCacheService: () => cacheService,
  getActiveRunningSessionIds: () => activeRunningSessionIds, getUnreadSessionIds: () => unreadSessionIds,
  getActiveRunningBotNames: () => activeRunningBotNames, getUnreadBotNames: () => unreadBotNames,
  getActiveRunningGroupRoomIds: () => activeRunningGroupRoomIds, getUnreadGroupRoomIds: () => unreadGroupRoomIds,
  getActiveStreamingContext: () => ({ activeStreamingMessageId, activeStreamingStoredSessionId, activeStreamingLiveId, activeStreamingBotName }),
  setActiveStreamingContext: (ctx) => {
    if ('activeStreamingMessageId' in ctx) activeStreamingMessageId = ctx.activeStreamingMessageId ?? null;
    if ('activeStreamingStoredSessionId' in ctx) activeStreamingStoredSessionId = ctx.activeStreamingStoredSessionId ?? null;
    if ('activeStreamingLiveId' in ctx) activeStreamingLiveId = ctx.activeStreamingLiveId ?? null;
    if ('activeStreamingBotName' in ctx) activeStreamingBotName = ctx.activeStreamingBotName ?? null;
  },
  getTurnStartedSessionId: () => turnStartedSessionId, setTurnStartedSessionId: (id) => { turnStartedSessionId = id; },
  stopProfileAutoRefresh: () => stopProfileAutoRefresh(), startProfileAutoRefresh: () => startProfileAutoRefresh(),
  stopAllGroupPollers: () => groupPollerManager.stopAll(), clearTransitionRefreshTimer: () => clearTransitionRefreshTimer(),
  clearSessionsRefreshTimer: () => {
    if (sessionsRefreshTimer) {
      clearTimeout(sessionsRefreshTimer);
      sessionsRefreshTimer = null;
    }
  },
  scheduleSessionsRefresh: () => scheduleSessionsRefresh(), persistTurnToCache: (sid, bot, msgs) => persistTurnToCache(sid, bot, msgs),
  persistSessionsToCache: (sessions) => persistSessionsToCache(sessions), syncProfileLastMessages: () => syncProfileLastMessages(),
  syncAgentPresence: () => syncAgentPresence(), scheduleToolPatch: (mid) => scheduleToolPatch(mid),
  stopRunningToolTimers: () => stopRunningToolTimers(), setMessageContent: (mid, content) => setMessageContent(mid, content),
  toStoredSessionId: (id) => toStoredSessionId(id), applyColdStartFocus: () => applyColdStartFocus(),
  fetchProfiles: () => fetchProfiles(), fetchSessions: () => fetchSessions(),
  fetchGroupRooms: () => fetchGroupRooms(), fetchModelOptions: () => fetchModelOptions(),
  fetchProjects: () => fetchProjects(), prefetchSlashCatalog: () => inputCompletion.prefetchSlashCatalog(),
  armTurnWatchdog: () => turnExecutionService.armTurnWatchdog(),
  feedTurnWatchdog: () => turnExecutionService.feedTurnWatchdog(),
  disarmTurnWatchdog: () => turnExecutionService.disarmTurnWatchdog(),
  clearPresenceTerminal: () => turnExecutionService.clearPresenceTerminal(),
  armPresenceTerminal: (terminal) => turnExecutionService.armPresenceTerminal(terminal),
  setTimedDockNotice: (msg, dur) => turnExecutionService.setTimedDockNotice(msg, dur),
  render: () => render(), t,
});

const armTurnWatchdog = () => turnExecutionService.armTurnWatchdog();
const disarmTurnWatchdog = () => turnExecutionService.disarmTurnWatchdog();
const isStreamingActiveForCurrentSession = () => turnExecutionService.isStreamingActiveForCurrentSession();
const clearPresenceTerminal = () => turnExecutionService.clearPresenceTerminal();
const armPresenceTerminal = (t: NonNullable<AppState['presenceTerminal']>) => turnExecutionService.armPresenceTerminal(t);
const setTimedDockNotice = (msg: string, d = 4000) => turnExecutionService.setTimedDockNotice(msg, d);
const interruptTurn = () => turnExecutionService.interruptTurn();
const sendGroupMessage = (roomId: string, text: string) => turnExecutionService.sendGroupMessage(roomId, text);
const syncGroupRoomLogsToState = (roomId: string, logs: readonly GroupMessageEntry[]) => turnExecutionService.syncGroupRoomLogsToState(roomId, logs);
const refreshGroupRoomLog = (roomId: string) => turnExecutionService.refreshGroupRoomLog(roomId);
const sendMessage = (text: string) => turnExecutionService.sendMessage(text);
const routeSend = (text: string) => turnExecutionService.routeSend(text);
const enqueueDraft = () => turnExecutionService.enqueueDraft();
const handleQueueAction = (a: string, id: string) => turnExecutionService.handleQueueAction(a, id);
const runSlashCommand = (cmd: string) => inputDockController.runSlashCommand(cmd);
const askSideAgent = (k: 'btw' | 'delegation', tp: string, q: string) => turnExecutionService.askSideAgent(k, tp, q);
const armCapsuleTimers = (taskId: string) => turnExecutionService.armCapsuleTimers(taskId);

function formatTimestamp(ts: number | string, now: Date = new Date()): string {
  if (typeof ts === 'string') return ts;
  if (!ts || !Number.isFinite(ts) || ts <= 0) return '';
  const d = new Date(ts > 1e11 ? ts : ts * 1000);
  if (!Number.isFinite(d.getTime())) return '';
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const timeStr = `${h}:${m}`;
  const isSameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (isSameDay) return timeStr;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()} ${timeStr}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${timeStr}`;
}

function setMessageContent(messageId: string, text: string): void {
  const target = state.messages.find((m) => m.id === messageId);
  if (!target) return;
  target.content = text;
  const el = document.getElementById(`msg-content-${messageId}`);
  if (el) {
    if (el.style.display === 'none') el.style.display = 'flex';
    if (el.style.flexDirection !== 'column') el.style.flexDirection = 'column';
    el.innerHTML = renderMarkdown(text);
  }
}

const applyTurnActions = (actions: TurnAction[]) => gatewayEventDispatcher.applyTurnActions(actions);
const handleInspectorEvent = (params: unknown) => gatewayEventDispatcher.handleInspectorEvent(params);
const getConnectionEpoch = () => gatewayEventDispatcher.getConnectionEpoch();
const connect = (url?: string) => gatewayEventDispatcher.connect(url);
const disconnect = () => gatewayEventDispatcher.disconnect();
const captureStreamAnchor = (): StreamAnchor => streamViewportManager.captureStreamAnchor();
const applyStreamAnchor = (anchor: StreamAnchor, pin: boolean) => streamViewportManager.applyStreamAnchor(anchor, pin);
const stabilizeStreamAnchor = (anchor: StreamAnchor) => streamViewportManager.stabilizeStreamAnchor(anchor);

let lastMessagesSnapshot: RenderMessagesSnapshot | null = null;
let lastInputDockSnapshot: RenderInputDockSnapshot | null = null;

function snapshotFingerprint(value: unknown): string {
  try { return JSON.stringify(value) ?? ''; } catch { return `__unserializable_${Date.now()}_${Math.random()}`; }
}

async function disbandGroupRoom(roomId: string): Promise<void> {
  if (!gatewayClient) return;
  await groupRoomStore.disbandRoom(roomId, gatewayClient);
  groupPollerManager.stop(roomId);
  settleTurnTermination({ runningSessionIds: activeRunningSessionIds, runningBotNames: activeRunningBotNames, runningGroupRoomIds: activeRunningGroupRoomIds, groupRoomId: roomId });
  unreadGroupRoomIds.delete(roomId);
  activityTransitionTracker.clear('group', roomId);
  await fetchGroupRooms();
  if (state.activeFocus.type === 'group' && state.activeFocus.roomId === roomId && state.sessions.length > 0) void selectSession(state.sessions[0].id);
}

const modalInteractionController = createModalInteractionController({
  getState: () => state, commitState: (patch) => { Object.assign(state, patch); }, requestRender: () => render(),
  restoreComposerFocus: () => restoreComposerFocus(), createNewSession: (opts) => createNewSession(opts),
  deleteSession: (id) => deleteSession(id), renameSession: (id, title) => renameSession(id, title),
  pinSession: (id) => pinSession(id), archiveSession: (id) => archiveSession(id), exportMarkdown: (id) => exportMarkdown(id),
  copySessionId: (id) => copySessionId(id), openBotChat: (profile) => openBotChat(profile),
  openBotSettings: (profile) => openBotSettings(profile), openGroupRoom: (roomId) => openGroupRoom(roomId),
  createGroupRoom: (title, members) => groupRoomStore.createRoom(title, members, gatewayClient!),
  disbandGroupRoom: (roomId) => disbandGroupRoom(roomId), fetchGroupRooms: () => fetchGroupRooms(), t: (key, params) => t(key, params),
});

const closeConfirmModal = (action: 'ok' | 'cancel') => modalInteractionController.closeConfirmModal(action);

const inputDockController = createInputDockController({
  getState: () => state, commitState: (patch) => { Object.assign(state, patch); }, requestRender: () => render(),
  routeSend: (text) => routeSend(text), interruptTurn: () => interruptTurn(), handleRollbackCancel: () => handleRollbackCancel(),
  requestSlashCompletion: (prefix) => inputCompletion.requestSlashCompletion(prefix),
  requestPathCompletion: (query, agentItems) => inputCompletion.requestPathCompletion(query, agentItems),
  isStreamingActiveForCurrentSession: () => isStreamingActiveForCurrentSession(), t: (key, params) => t(key, params),
  clearDockNoticeDismissTimer: () => { if (dockNoticeDismissTimer) { clearTimeout(dockNoticeDismissTimer); dockNoticeDismissTimer = null; } },
  setTimedDockNotice: (msg) => setTimedDockNotice(msg), getGatewayClient: () => gatewayClient,
  ensureLiveSessionId: () => ensureLiveSessionId(), createNewSession: () => createNewSession(),
  sendMessage: (text) => sendMessage(text), interactiveService: interactiveService,
  getRpcCaller: () => rpcCaller, describeRpcError: (err) => describeRpcError(err),
});

const syncComposerHeight = () => {
  const inputEl = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
  inputDockController.syncComposerHeight(inputEl);
};
const handleSend = (source: 'button' | 'enter') => inputDockController.handleSend(source);
const addInputAttachments = (fileList: FileList | File[]) => inputDockController.addInputAttachments(fileList);
const syncComposerPoppers = () => inputDockController.syncComposerPoppers();

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
    if (previousName !== undefined) {
      state.groupRooms = state.groupRooms.map((r) => (r.roomId === roomId ? { ...r, name: previousName } : r));
      render();
    }
    showToast(t('ctx.groupRenameFailed', { error: describeRpcError(err) }));
  }
}

const leftRailController = createLeftRailController({
  getState: () => state, render: () => render(), t, showToast, describeRpcError,
  getGatewayClient: () => gatewayClient, groupRoomStore, cancelColdStartFocus,
  selectSession: (id, opts) => selectSession(id, opts), openBotChat: (p) => openBotChat(p),
  openGroupRoom: (r) => openGroupRoom(r), fetchProjects: () => fetchProjects(), fetchGroupRooms: () => fetchGroupRooms(),
  beginLeftRailResize: (e) => beginLeftRailResize(e), getActivityVariant: () => activityIndicatorVariant,
  activeRunningSessionIds, unreadSessionIds, getActiveStreamingStoredSessionId: () => activeStreamingStoredSessionId,
  activeRunningGroupRoomIds, unreadGroupRoomIds, activeRunningBotNames, unreadBotNames,
  resolveAgentAvatar: (name) => resolveAgentAvatar(name), activityTransitionTracker,
});

const createLeftRailActions = (): LeftRailActions => {
  const actions = leftRailController.createLeftRailActions();
  actions.onConfirmGroupRename = (roomId, name) => { void confirmGroupRename(roomId, name); };
  return actions;
};
const decorateRailSessions = (nowMs: number): LeftRailSession[] => leftRailController.decorateRailSessions(nowMs);
const decorateRailGroups = (nowMs: number): LeftRailGroupRoom[] => leftRailController.decorateRailGroups(nowMs);
const decorateRailProfiles = (nowMs: number): LeftRailProfile[] => leftRailController.decorateRailProfiles(nowMs);
const getLeftRailSnapshot = (): LeftRailSnapshot => leftRailController.getLeftRailSnapshot();

let reactMessageList: ConversationMount | null = null, reactMessageListHost: HTMLElement | null = null;
let renderedMessageIds = new Set<string>(), lastSeenStreaming = false;

const conversationVmCache = new WeakMap<MessageViewModel, {
  vm: ConversationMessageVM; content: string; thought?: string;
  toolsRef?: MessageViewModel['toolCalls']; toolsSignature: string;
  displayKind: MessageDisplayKind; displayMetadata?: MessageViewModel['displayMetadata'];
}>();

let knownFilesToolsRef: readonly (MessageViewModel['toolCalls'])[] = [], knownFilesValue: readonly string[] = [];

function resolveSessionKnownFiles(): readonly string[] {
  const tools = state.messages.map((message) => message.toolCalls);
  const unchanged = tools.length === knownFilesToolsRef.length && tools.every((tool, index) => tool === knownFilesToolsRef[index]);
  if (unchanged) return knownFilesValue;
  knownFilesToolsRef = tools;
  knownFilesValue = collectTouchedFiles(state.messages.flatMap((message) => message.toolCalls ?? []));
  return knownFilesValue;
}

const renderCoordinator = createRenderCoordinator({
  getState: () => state, messageWindowManager, modalInteractionController,
  isStreamingActiveForCurrentSession: () => isStreamingActiveForCurrentSession(),
  resolveSessionKnownFiles: () => resolveSessionKnownFiles(),
  getTitlebarSnapshot: () => titlebarController.getTitlebarSnapshot(),
  onMinimizeWindow: () => titlebarController.onMinimizeWindow(), onMaximizeWindow: () => titlebarController.onMaximizeWindow(),
  onCloseWindow: () => titlebarController.onCloseWindow(), onToggleTheme: () => titlebarController.onToggleTheme(),
  getLeftRailSnapshot: () => getLeftRailSnapshot(), createLeftRailActions: () => createLeftRailActions(),
  getPromptNavigatorSnapshot: () => getPromptNavigatorSnapshot(), createPromptNavigatorActions: () => createPromptNavigatorActions(),
  setPromptNavigatorUpdateHandler: (handler) => promptNavigatorManager.setUpdateHandler(handler),
  rebuildPromptEntries: () => rebuildPromptEntries(), syncPromptNavigatorMeta: () => syncPromptNavigatorMeta(),
  syncPromptNavigator: () => syncPromptNavigator(), syncReactSettings: () => syncReactSettings(),
  ensureSettingsSectionData: (section) => ensureSettingsSectionData(section), syncAgentPresenceHost: () => syncAgentPresenceHost(),
  syncAgentPresence: () => syncAgentPresence(), captureStreamAnchor: () => captureStreamAnchor(),
  applyStreamAnchor: (anchor, pin) => applyStreamAnchor(anchor, pin), stabilizeStreamAnchor: (anchor) => stabilizeStreamAnchor(anchor),
  isStreamNearBottom: (stream) => isStreamNearBottom(stream), syncStreamBottomInset: () => syncStreamBottomInset(),
  settleInitialBottom: () => settleInitialBottom(), bindEvents: () => bindEvents(),
  isSessionEnterPending: () => streamViewportManager.isSessionEnterPending(),
  settleSessionEnter: (probe) => streamViewportManager.settleSessionEnter(probe),
  syncComposerPoppers: () => syncComposerPoppers(), logRender,
});

const lockAverageRowHeight = () => { const r = messageWindowManager.lockAverageRowHeight(); syncWindowLocalState(); return r; };
const syncCanvasVirtualHeight = () => messageWindowManager.syncCanvasVirtualHeight();
const observeVirtualWindowGeometry = (att = 0) => { messageWindowManager.observeVirtualWindowGeometry(att); syncWindowLocalState(); };
const computeContentOffsetPx = () => messageWindowManager.computeContentOffsetPx();
const computeVirtualHeightPx = () => messageWindowManager.computeVirtualHeightPx();
const buildConversationSnapshot = (): ConversationSnapshot => renderCoordinator.buildConversationSnapshot();
const syncReactMessageList = (force = false) => renderCoordinator.syncReactMessageList(force);

let agentPresenceHost: HTMLElement | null = null;
let lastAgentPresenceFingerprint = '';
let presenceMountHandle: ConversationMount | null = null;

function ensurePresenceTicker(kind: AgentPresence['kind']): void {
  if (kind !== 'idle') {} else if (typeof clearInterval === 'function') { clearInterval(0); }
  presenceController.ensurePresenceTicker(kind);
}

function ensureAgentPresenceHost(layout: 'stage' | 'dock'): HTMLElement | null {
  if (!state.gatewayConnected) {
    presenceMountHandle?.unmount();
    presenceMountHandle = null;
    agentPresenceHost?.remove();
    agentPresenceHost = null;
    let pendingPresenceSnapshot: AgentPresenceSnapshot | null = null;
    pendingPresenceSnapshot = null;
    lastAgentPresenceFingerprint = '';
    ensurePresenceTicker('idle');
    presenceController.resetPresenceHost();
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

let turnStartedSessionId: string | null = null;
const presenceController = createPresenceController({
  getState: () => state,
  resolveAgentAvatar: (name) => resolveAgentAvatar(name),
  isGroupConversationActive: () => isGroupConversationActive(),
  isStreamingActiveForCurrentSession: () => isStreamingActiveForCurrentSession(),
  activeRunningGroupRoomIds,
  mountAgentPresence: (host, getSnapshot) => mountAgentPresence(host, getSnapshot),
  ensureAgentPresenceHost: (layout) => ensureAgentPresenceHost(layout),
});

function syncAgentPresenceHost(): void {
  const presenceHost = ensureAgentPresenceHost(state.presenceLayout);
  presenceController.syncAgentPresenceHost();
}

function syncAgentPresence(): void {
  if (!agentPresenceHost?.isConnected) {
    syncAgentPresenceHost();
  }
  presenceController.syncAgentPresence();
}

const resolvePresenceDomain = () => ({
  groupRoomId: state.activeFocus.type === 'group' ? state.activeFocus.roomId : null,
  isRunning: false,
});
const ensureGroupTurnClock = (r: string | null, isRunning: boolean) => presenceController.ensureGroupTurnClock(r, isRunning);
const buildAgentPresenceSnapshot = (): AgentPresenceSnapshot => presenceController.getSnapshot();
const getAgentPresenceSnapshot = (): AgentPresenceSnapshot => presenceController.getSnapshot();

const settingsDataService = createSettingsDataService({
  getState: () => state, getGatewayClient: () => gatewayClient, getDesktopApi: () => desktopApi,
  getCurrentTicket: () => currentTicket ?? null, getEffectiveUrl: (url) => getEffectiveUrl(url),
  render: () => render(), t: (key, params) => t(key, params), describeRpcError: (error) => describeRpcError(error),
  showToast: (message, durationMs) => showToast(message, durationMs), bootLog,
  fetchModelOptions: async (opts) => fetchModelOptions(opts), fetchProfiles: async (opts) => fetchProfiles(opts),
  testConnection: (url, user, pass) => testConnection(url, user, pass), connect: async () => connect(),
  disconnect: () => disconnect(), getFontPreferences: () => fontPreferences,
  setFontPreferences: (prefs) => { fontPreferences = prefs; }, applyFontPreferences: (prefs) => applyFontPreferences(prefs),
  getActivityIndicatorVariant: () => activityIndicatorVariant, setActivityIndicatorVariant: (v) => { activityIndicatorVariant = v; },
  saveActivityIndicatorVariant: (v) => saveActivityIndicatorVariant(v), resolveActivityIndicatorVariant: (v) => resolveActivityIndicatorVariant(v),
  resolveSkinId: (theme) => resolveSkinId(theme), writePresenceLayout: (layout) => writePresenceLayout(layout === 'dock' ? 'dock' : 'stage'),
  onPresenceLayoutChanged: () => {
    agentPresenceHost = null; lastAgentPresenceFingerprint = ''; presenceController.resetPresenceHost();
  },
  profileAvatarCache, persistAvatarCache: () => persistAvatarCache(),
});

const scopedProfileName = () => settingsDataService.scopedProfileName();
const subscriptionProfileName = () => settingsDataService.subscriptionProfileName();
const botRoster = () => settingsDataService.botRoster();
const reloadProviderCatalog = () => settingsDataService.reloadProviderCatalog();
const openBotSettings = (botId: string) => settingsDataService.openBotSettings(botId);
const getBotManagementSnapshot = () => settingsDataService.getBotManagementSnapshot();
const getSettingsSnapshot = () => settingsDataService.getSettingsSnapshot();
const ensureSettingsSectionData = (section: SettingsSectionId, force = false) => settingsDataService.ensureSettingsSectionData(section, force);
const createSettingsActions = (): SettingsActions => settingsDataService.createSettingsActions();
const syncReactSettings = () => settingsDataService.syncReactSettings();
const syncLocale = () => setLocale(state.lang === 'en' ? 'en-US' : 'zh-CN');
const mountReactShellComponents = () => renderCoordinator.mountReactShellComponents();
const render = () => renderCoordinator.render();

const fileViewerService = createFileViewerService({
  getState: () => state, render: () => render(), getDesktopApi: () => desktopApi,
  getGatewayClient: () => gatewayClient, safeCopyText: (text) => safeCopyText(text), t: (k) => t(k),
});

const handleOpenFilePreview = (path: string, previewUrl?: string) => fileViewerService.handleOpenFilePreview(path, previewUrl);

function bindEvents(): void {
  fileViewerService.bindEvents();
  const attachBtn = document.getElementById('dock-attach-file-btn');
  if (attachBtn) {
    attachBtn.onclick = async () => {
      if (desktopApi?.openFileDialog) {
        const paths = await desktopApi.openFileDialog();
        if (paths && paths.length > 0) {
          const input = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
          if (input) input.value += (input.value ? '\n' : '') + `[file: ${paths.join(', ')}]`;
        }
      }
    };
  }
  onboardingController.bindDomEvents();
  conversationStreamController.bindDomEvents();
  modalInteractionController.bindDomEvents();
  inputDockController.bindDomEvents();

  const dockContainer = document.querySelector<HTMLElement>('.input-dock-container');
  if (dockContainer && !dockContainer.dataset.dockClickBound) {
    dockContainer.dataset.dockClickBound = 'true';
    dockContainer.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const cancelAction = target.closest<HTMLElement>('[data-action="rollback-cancel"]');
      if (cancelAction) { e.stopPropagation(); e.preventDefault(); handleRollbackCancel(); }
    });
  }
  bindModelDropdownEvents();
  bindRailResizeEvents();
}

const conversationStreamController = createConversationStreamController({
  getState: () => state, render: () => render(), safeCopyText: (text) => safeCopyText(text),
  setTimedDockNotice: (msg, dur) => setTimedDockNotice(msg, dur), isStreamingActiveForCurrentSession: () => isStreamingActiveForCurrentSession(),
  t: (key) => t(key), getGatewayClient: () => gatewayClient, getRpcCaller: () => rpcCaller,
  getInteractiveService: () => interactiveService, selectSession: (id) => selectSession(id),
  scheduleSessionsRefresh: () => scheduleSessionsRefresh(), getSessionMessagesCache: () => sessionMessagesCache,
  handleOpenFilePreview: (path, url) => handleOpenFilePreview(path, url), syncPromptNavigatorFromScroll: () => syncPromptNavigatorFromScroll(),
  loadOlderMessages: (opts) => loadOlderMessages(opts), relocateMessageWindowToIndex: (idx) => relocateMessageWindowToIndex(idx),
  syncScrollTopToWindow: (reason) => syncScrollTopToWindow(reason), slideMessageWindowForward: () => slideMessageWindowForward(),
  expandMessageWindow: () => expandMessageWindow(), settleInitialBottom: () => settleInitialBottom(),
  scrollStreamToBottom: (reason) => scrollStreamToBottom(reason), scheduleStreamBottomInset: () => scheduleStreamBottomInset(),
  layoutSignature: () => layoutSignature(), ensureLiveSessionId: () => ensureLiveSessionId(),
  getMessageWindowStart: () => messageWindowStart, getMessageWindowEnd: () => messageWindowEnd,
  isMessageWindowUserExpanded: () => messageWindowUserExpanded, setMessageWindowUserExpanded: (val) => { messageWindowUserExpanded = val; },
  getAverageRowHeightPx: () => averageRowHeightPx, isInitialBottomSettling: () => streamSettleState.initialBottomSettling,
  setInitialBottomSettling: (val) => { streamSettleState.initialBottomSettling = val; }, getStreamScrollCooldown: () => streamScrollCooldown > Date.now(),
  setStreamScrollCooldown: (val) => { streamScrollCooldown = val ? Date.now() + 180 : 0; },
  getLastStreamScrollTop: () => lastStreamScrollTop, setLastStreamScrollTop: (val) => { lastStreamScrollTop = val; },
  getProgrammaticScrollTarget: () => programmaticScrollTarget, setProgrammaticScrollTarget: (val) => { programmaticScrollTarget = val; },
  getProgrammaticScrollIgnoreUntil: () => programmaticScrollIgnoreUntil, getLayoutDriftUntil: () => layoutDriftUntil,
  getReaderScrolledSessionId: () => readerScrolledSessionId ?? '', setReaderScrolledSessionId: (val) => { readerScrolledSessionId = val || null; },
  setSettledLayoutSignature: (val) => { streamSettleState.settledLayoutSignature = val; }, STICK_TO_BOTTOM_THRESHOLD_PX, MESSAGE_WINDOW_CAPACITY,
});

const onboardingController = createOnboardingController({
  getState: () => state, render: () => render(), connect: () => { void connect(); },
  testConnection: (url, user, pass) => testConnection(url, user, pass), switchApproval: (mode) => switchApproval(mode),
  getDesktopApi: () => desktopApi, t, fetchModelOptions: async () => fetchModelOptions(),
  hideModelCascade: () => hideModelCascade(), resetModelSearchOnOpen: () => resetModelSearchOnOpen(),
});

const handleCopyMessage = (btn: HTMLElement) => conversationStreamController.handleCopyMessage(btn);
const handleRollbackMessage = (btn: HTMLElement) => conversationStreamController.handleRollbackMessage(btn);
const handleRollbackCancel = () => conversationStreamController.handleRollbackCancel();
const handleForkMessage = (btn: HTMLElement) => conversationStreamController.handleForkMessage(btn);

if (typeof window !== 'undefined') {
  window.__fluxMessageActions = { handleCopyMessage, handleRollbackMessage, handleForkMessage };
}

const stopRunningToolTimers = () => conversationStreamController.stopRunningToolTimers();
const updateRunningToolTimers = () => conversationStreamController.updateRunningToolTimers();

function beginLeftRailResize(event: React.PointerEvent<HTMLDivElement>): void {
  if (event.button !== 0) return;
  event.preventDefault(); event.stopPropagation();
  const handle = event.currentTarget; const startX = event.clientX; const cssVar = '--rail-w-left';
  const startWidth = clampLeftRailWidth(getComputedStyle(document.documentElement).getPropertyValue(cssVar) || String(LEFT_RAIL_WIDTH.defaultValue));
  // gate-degrade: 指针捕获失败安全忽略
  try { handle.setPointerCapture(event.pointerId); } catch {}
  document.documentElement.setAttribute('data-rail-resizing', 'left');
  let currentW = startWidth; let rafId = 0;
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
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    // gate-degrade: 释放指针捕获失败安全忽略
    try { handle.releasePointerCapture(event.pointerId); } catch {}
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    const settled = clampLeftRailWidth(String(currentW));
    document.documentElement.style.setProperty(cssVar, `${settled}px`);
    localStorage.setItem('hermes_flux_rail_w_left', String(settled));
    requestAnimationFrame(() => document.documentElement.removeAttribute('data-rail-resizing'));
  };
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

function resetLeftRailWidth(): void {
  document.documentElement.style.setProperty('--rail-w-left', `${LEFT_RAIL_WIDTH.defaultValue}px`);
  localStorage.setItem('hermes_flux_rail_w_left', String(LEFT_RAIL_WIDTH.defaultValue));
}

function bindRailResizeEvents(): void {
  document.querySelectorAll<HTMLElement>('.rail-resize-handle').forEach((handle) => {
    if (handle.dataset.railHandle === 'left') {
      handle.ondblclick = (e) => { e.stopPropagation(); resetLeftRailWidth(); };
      return;
    }
    const cssVar = '--rail-w-right';
    const minW = 260; const maxW = Math.round(window.innerWidth * 0.85); const defaultW = 420;
    const storageKey = 'hermes_flux_rail_w_right';

    handle.ondblclick = (e) => {
      e.stopPropagation();
      document.documentElement.style.setProperty(cssVar, `${defaultW}px`);
      localStorage.setItem(storageKey, String(defaultW));
    };

    handle.onpointerdown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault(); ev.stopPropagation();
      // gate-degrade: 右轨指针捕获失败安全忽略
      try { handle.setPointerCapture(ev.pointerId); } catch {}
      const startX = ev.clientX;
      const startWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar)) || defaultW;
      document.documentElement.setAttribute('data-rail-resizing', 'right');
      let currentW = startWidth; let rafId = 0;
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
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        // gate-degrade: 右轨释放指针捕获失败安全忽略
        try { handle.releasePointerCapture(upEv.pointerId); } catch {}
        window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp); window.removeEventListener('pointercancel', onPointerUp);
        document.documentElement.style.setProperty(cssVar, `${Math.round(currentW)}px`);
        localStorage.setItem(storageKey, String(Math.round(currentW)));
        requestAnimationFrame(() => document.documentElement.removeAttribute('data-rail-resizing'));
      };
      window.addEventListener('pointermove', onPointerMove, { passive: true }); window.addEventListener('pointerup', onPointerUp); window.addEventListener('pointercancel', onPointerUp);
    };
  });
}

const dropdownKeybindController = createDropdownKeybindController({
  getState: () => state, render: () => render(),
  switchModel: (model, provider) => switchModel(model, provider), switchReasoning: (level) => switchReasoning(level),
  modalInteractionController, ensureSettingsSectionData: (section) => ensureSettingsSectionData(section),
  getLastInputDockSnapshot: () => renderCoordinator.getLastInputDockSnapshot(),
  setLastInputDockSnapshot: (snapshot) => renderCoordinator.setLastInputDockSnapshot(snapshot),
});

// streamScrollCooldown = false; streamEl.scrollTop > lastStreamScrollTop + 4
/*
modelBtn.onclick = (e) => {
  resetModelSearchOnOpen();
  modelBtn.setAttribute('aria-expanded', 'true');
  lastInputDockSnapshot = { modelMenuOpen: state.modelMenuOpen } as any;
};
*/
// Bind dropdown options
const bindModelDropdownEvents = () => dropdownKeybindController.bindModelDropdownEvents();
function pickReasoningLevel(item: HTMLElement): void {
  // returnToModel .focus({ preventScroll: true })
  dropdownKeybindController.pickReasoningLevel(item);
}
const hideModelCascade = () => dropdownKeybindController.hideModelCascade();
const scheduleHideModelCascade = () => dropdownKeybindController.scheduleHideModelCascade();
const cancelHideModelCascade = () => dropdownKeybindController.cancelHideModelCascade();
function resetModelSearchOnOpen(): void {
  dropdownKeybindController.resetModelSearchOnOpen();
  state.modelSearchQuery = '';
  // lastInputDockSnapshot updateModelDropdownSubtree()
}
function showModelCascade(row: HTMLElement): void {
  dropdownKeybindController.showModelCascade(row);
}
function closeModelMenu(): void {
  // hideModelCascade() dropdown.style.display = 'none' trigger.setAttribute('aria-expanded', 'false')
  dropdownKeybindController.closeModelMenu();
}
function updateModelDropdownSubtree(): void {
  dropdownKeybindController.updateModelDropdownSubtree();
}

dropdownKeybindController.setupGlobalKeybinds();
dropdownKeybindController.setupOutsideClickHandlers();

const appBootstrap = createAppBootstrap({
  getState: () => state, render: () => render(), getDesktopApi: () => desktopApi,
  getGatewayClient: () => gatewayClient, connect: () => { void connect(); },
  restoreCacheToState: () => restoreCacheToState(), refreshProfilesFromServer: () => refreshProfilesFromServer(),
  syncSystemWindow: () => titlebarController.syncSystemWindow(), fontPreferences,
  logBoot: (info) => logApp.info('renderer boot', { level: getLogLevel(), ...info }),
  logLayoutShift: (info) => logScroll.debug('layout shift', { ...info, streaming: state.isStreaming }),
});

const isConversationDemoMode = () => appBootstrap.isConversationDemoMode();
const injectConversationDemo = () => appBootstrap.injectConversationDemo();
const refreshProfilesFromServer = () => fetchProfiles({ refresh: true });

async function init(): Promise<void> {
  const restoredLeft = clampLeftRailWidth(localStorage.getItem('hermes_flux_rail_w_left') || localStorage.getItem('hermes_aura_rail_w_left'));
  document.documentElement.style.setProperty('--rail-w-left', `${restoredLeft}px`);
  localStorage.setItem('hermes_flux_rail_w_left', String(restoredLeft));
  await appBootstrap.init();

  let lastFocusRefreshAt = 0;
  window.addEventListener('focus', () => {
    const now = Date.now();
    if (now - lastFocusRefreshAt < 5000) return;
    lastFocusRefreshAt = now;
    if (gatewayClient && !state.isStreaming) void refreshProfilesFromServer();
  });

  const syncPageHiddenAttr = (): void => {
    if (document.visibilityState === 'hidden') document.documentElement.dataset.pageHidden = 'true';
    else delete document.documentElement.dataset.pageHidden;
  };
  syncPageHiddenAttr();

  document.addEventListener('visibilitychange', () => {
    document.documentElement.dataset.appHidden = String(document.visibilityState === 'hidden');
    syncPageHiddenAttr();
    if (document.visibilityState === 'visible') void refreshProfilesFromServer();
  });
}

init();
