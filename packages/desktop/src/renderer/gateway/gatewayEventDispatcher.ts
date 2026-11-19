/**
 * Hermes Flux 网关连接生命周期与 WebSocket 下行事件分发服务（Gateway Event Dispatcher · D6）
 *
 * 【设计意图 (Why)】
 *   将网关连接与断开生命周期管理（connect、disconnect、代际令牌维护）、下行事件解包流式分派
 *   （handleGatewayEvent、reduceGatewayEvent 消费、applyTurnActions、handleInspectorEvent）
 *   从 index.ts 中彻底解耦。
 *   使得下行网络事件通道与代际防污染机制可脱离 UI 单独验证，保证连接切换与重连时的绝对单调性与数据纯净度。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 维护严格自增的 connectionEpoch 代际令牌，异步探测和重连回调若代际过期必须当场丢弃，防止迟到包污染当前连接；
 *   2. 120 FPS 流式双轨分流：高频增量数据（append-content、append-thought）只能推入 tokenCoalescer，绝对禁止触发全量 render；
 *   3. 工具插槽更新 tool-start / tool-complete 只能触发局部 scheduleToolPatch，严禁破坏 messagesChanged 短路逻辑；
 *   4. 断线 disconnect 时必须彻底清空全部活跃运行与未读集合（activeRunningSessionIds 等），否则重连后残留呼吸动效与未读绿点；
 *   5. 回合完成时，若用户已切走会话，绝不能拿当前视口的 state.messages 覆盖后台会话缓存，必须用 sessionMessagesCache 正确落盘。
 *
 * 【约束与规则 (Rules)】
 *   1. 单向依赖：严禁反向 import index.js，所有状态读取与外部调度通过 GatewayEventDispatcherDeps 注入；
 *   2. 严格类型约束：0 TS 报错，严禁使用 as any；
 *   3. 零文本写死：提示与错误文案统一走 deps.t 国际化字典输出。
 */

import type { AppState } from '../state/appState.js';
import type { HermesDesktopBridge } from '../../preload/index.js';
import {
  type HermesGatewayClient,
  type TurnAction,
  type NormalizedSession,
  type SessionHandleRegistry,
  type ActivityTransitionTracker,
  type TokenCoalescer,
  type CacheChannelRef,
  type CacheService,
  HermesGatewayClient as GatewayClientImpl,
  reduceGatewayEvent,
  applyTurnFailed,
  applySessionTitle,
} from '@hermes-flux/core';
import { safeSetItem, type I18nKey, type MessageViewModel, type StorageWriteFailure } from '@hermes-flux/ui';
import { bindTurnRowIds } from '../rollbackTransaction.js';
import type { ActiveStreamingContext } from '../services/turnExecutionService.js';
import { formatTimestamp } from '../services/turnExecutionService.js';
import type { BotActivityStore } from '../persistence/botActivityStore.js';
import { buildGatewayWsUrl, createGatewayReconnectResolver, type GatewayAuthResponse } from '../gatewayConnection.js';

export type TurnWatchdogFeeder = () => void;

export interface GatewayEventDispatcherDeps {
  readonly getState: () => AppState;
  readonly getGatewayClient: () => HermesGatewayClient | null;
  readonly setGatewayClient: (client: HermesGatewayClient | null) => void;
  readonly getCurrentTicket: () => string | undefined;
  readonly setCurrentTicket: (ticket: string | undefined) => void;
  readonly getDesktopApi: () => HermesDesktopBridge | undefined;
  readonly getEffectiveUrl: (url?: string) => string;
  readonly testConnection: (url: string, user: string, pass: string) => Promise<GatewayAuthResponse>;
  readonly completeEntityTurn: (
    domain: 'session' | 'bot' | 'group',
    running: Set<string>,
    unread: Set<string>,
    entityId: string,
    focused: boolean
  ) => void;

  readonly getSessionHandleRegistry: () => SessionHandleRegistry;
  readonly getSessionMessagesCache: () => Map<string, MessageViewModel[]>;
  readonly getTokenCoalescer: () => TokenCoalescer;
  readonly getActivityTransitionTracker: () => ActivityTransitionTracker;
  readonly getBotActivityStore: () => BotActivityStore;
  readonly getCacheService: () => CacheService;

  readonly getActiveRunningSessionIds: () => Set<string>;
  readonly getUnreadSessionIds: () => Set<string>;
  readonly getActiveRunningBotNames: () => Set<string>;
  readonly getUnreadBotNames: () => Set<string>;
  readonly getActiveRunningGroupRoomIds: () => Set<string>;
  readonly getUnreadGroupRoomIds: () => Set<string>;

  readonly getActiveStreamingContext: () => ActiveStreamingContext;
  readonly setActiveStreamingContext: (ctx: Partial<ActiveStreamingContext>) => void;
  readonly getTurnStartedSessionId: () => string | null;
  readonly setTurnStartedSessionId: (id: string | null) => void;

  readonly stopProfileAutoRefresh: () => void;
  readonly startProfileAutoRefresh: () => void;
  readonly stopAllGroupPollers: () => void;
  readonly clearTransitionRefreshTimer: () => void;
  readonly clearSessionsRefreshTimer: () => void;
  readonly scheduleSessionsRefresh: () => void;

  readonly persistTurnToCache: (targetSessionId: string, botName: string | null, msgs: MessageViewModel[]) => void;
  readonly persistSessionsToCache: (sessions: NormalizedSession[]) => void;
  readonly syncProfileLastMessages: () => void;
  readonly syncAgentPresence: () => void;
  readonly scheduleToolPatch: (messageId: string) => void;
  readonly clearToolPatchQueue?: () => void;
  readonly stopRunningToolTimers: () => void;
  readonly setMessageContent: (messageId: string, content: string) => void;
  readonly toStoredSessionId: (id: string | null | undefined) => string | null;

  readonly applyColdStartFocus: () => Promise<void>;
  readonly fetchProfiles: () => Promise<void>;
  readonly fetchSessions: () => Promise<void>;
  readonly fetchGroupRooms: () => Promise<void>;
  readonly fetchModelOptions: () => Promise<void>;
  readonly fetchProjects: () => Promise<void>;
  readonly prefetchSlashCatalog: () => Promise<void>;

  readonly armTurnWatchdog: () => void;
  feedTurnWatchdog?: TurnWatchdogFeeder;
  readonly disarmTurnWatchdog: () => void;
  readonly clearPresenceTerminal: () => void;
  readonly armPresenceTerminal: (terminal: NonNullable<AppState['presenceTerminal']>) => void;
  readonly setTimedDockNotice: (msg: string, durationMs?: number, options?: { skipRender?: boolean }) => void;

  readonly isStreamNearBottom?: () => boolean;
  readonly setPendingScrollToBottom?: (val: boolean) => void;

  readonly render: () => void;
  readonly t: (key: I18nKey, params?: Record<string, string | number>) => string;
}

export interface GatewayEventDispatcher {
  connect(targetUrl?: string): Promise<void>;
  disconnect(): void;
  getConnectionEpoch(): number;
  handleGatewayEvent(params: unknown): void;
  applyTurnActions(actions: TurnAction[]): void;
  handleInspectorEvent(params: unknown): void;
}

export function createGatewayEventDispatcher(deps: GatewayEventDispatcherDeps): GatewayEventDispatcher {
  let connectionEpoch = 0;

  function handleInspectorEvent(params: unknown): void {
    if (!params || typeof params !== 'object') return;
    const frame = params as { type?: unknown; payload?: Record<string, unknown> };
    const type = typeof frame.type === 'string' ? frame.type : '';
    const payload = frame.payload || {};
    if (!type) return;

    const state = deps.getState();

    if (type === 'artifact.created' || type === 'artifact.updated') {
      const id = typeof payload.id === 'string' ? payload.id : '';
      const name = typeof payload.name === 'string' ? payload.name : '';
      if (!id || !name) return;
      const existing = state.artifacts.find((a) => a.id === id);
      if (existing) {
        Object.assign(existing, payload);
      } else {
        state.artifacts.unshift({
          id,
          name,
          type: typeof payload.type === 'string' ? payload.type : 'FILE',
          size: typeof payload.size === 'string' ? payload.size : '1KB',
          preview: typeof payload.preview === 'string' ? payload.preview : '',
        });
      }
      deps.render();
      return;
    }

    if ((type === 'browser.frame' || type === 'browser.navigate') && payload.url) {
      const url = typeof payload.url === 'string' ? payload.url : '';
      const title = typeof payload.title === 'string' ? payload.title : 'Page';
      const screenshotUrl = typeof payload.screenshotUrl === 'string'
        ? payload.screenshotUrl
        : (typeof payload.screenshot === 'string' ? payload.screenshot : undefined);
      state.browserFrame = {
        url,
        title,
        screenshotUrl,
      };
      deps.render();
      return;
    }

    if ((type === 'git.diff' || type === 'workspace.diff') && Array.isArray(payload.diffs)) {
      state.gitDiffs = payload.diffs;
      deps.render();
    }
  }

  function applyTurnActions(actions: TurnAction[]): void {
    let needsRender = false;
    let finalReplace: { messageId: string; text: string } | null = null;
    const state = deps.getState();
    const ctx = deps.getActiveStreamingContext();

    for (const action of actions) {
      switch (action.type) {
        case 'turn-started':
          if (!state.isStreaming) {
            state.isStreaming = true;
            needsRender = true;
          }
          state.turnStartedAt = Date.now();
          deps.setTurnStartedSessionId(ctx.activeStreamingStoredSessionId || state.activeSessionId);
          deps.clearPresenceTerminal();
          deps.armTurnWatchdog();
          break;

        case 'append-content':
          deps.feedTurnWatchdog?.();
          deps.getTokenCoalescer().push({ messageId: action.messageId, delta: action.text, isThought: false });
          break;

        case 'append-thought':
          deps.feedTurnWatchdog?.();
          deps.getTokenCoalescer().push({ messageId: action.messageId, delta: action.text, isThought: true });
          break;

        case 'tool-start': {
          deps.feedTurnWatchdog?.();
          const now = Date.now();
          const target = state.messages.find((m) => m.id === action.messageId);
          if (target) {
            if (!target.toolCalls) target.toolCalls = [];
            if (!target.toolCalls.some((tc) => tc.id === action.toolCall.id)) {
              target.toolCalls.push({
                id: action.toolCall.id,
                name: action.toolCall.name,
                status: 'running',
                args: action.toolCall.args,
                startTime: now,
              });
            }
            deps.scheduleToolPatch(action.messageId);
          }
          if (ctx.activeStreamingStoredSessionId) {
            const cached = deps.getSessionMessagesCache().get(ctx.activeStreamingStoredSessionId);
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
          deps.feedTurnWatchdog?.();
          const now = Date.now();
          const updateTc = (target?: MessageViewModel) => {
            if (target && target.toolCalls) {
              const tc = target.toolCalls.find((t) => action.toolCallId && t.id === action.toolCallId);
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
            deps.scheduleToolPatch(action.messageId);
          }
          if (ctx.activeStreamingStoredSessionId) {
            const cached = deps.getSessionMessagesCache().get(ctx.activeStreamingStoredSessionId);
            updateTc(cached?.find((m) => m.id === action.messageId));
          }
          break;
        }

        case 'persisted-turn': {
          let changed = bindTurnRowIds({
            messages: state.messages,
            assistantMessageId: action.messageId,
            userRowId: action.userRowId,
            assistantRowId: action.assistantRowId,
            rowIds: action.rowIds,
          });

          if (ctx.activeStreamingStoredSessionId) {
            const cached = deps.getSessionMessagesCache().get(ctx.activeStreamingStoredSessionId);
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
            const targetSessionId = ctx.activeStreamingStoredSessionId || state.activeSessionId;
            const msgsToPersist = targetSessionId === state.activeSessionId ? state.messages : (deps.getSessionMessagesCache().get(targetSessionId) || []);
            if (targetSessionId && msgsToPersist.length > 0) {
              deps.persistTurnToCache(targetSessionId, ctx.activeStreamingBotName, msgsToPersist);
            }
          }
          break;
        }

        case 'replace-content':
          finalReplace = { messageId: action.messageId, text: action.text };
          break;

        case 'turn-completed': {
          // 【贴底意图必须在 flush / finalReplace 改写 DOM 之前捕获 (Why)】
          //   flush() 与 setMessageContent() 会瞬间撑高 #msg-content-*，若等到 render()
          //   再测 isStreamNearBottom，新增高度超过 168px 就会被误判为「用户不在底部」，
          //   从而把视口锁回上方的用户提示词位置。
          const wasNearBottomBeforeSettle = deps.isStreamNearBottom?.() ?? false;
          deps.getTokenCoalescer().flush();
          // 【清理未执行的工具补丁 rAF (Pitfall)】防止回合结束后迟到 rAF 覆写 React 接管的 #msg-tools-*
          deps.clearToolPatchQueue?.();
          deps.stopRunningToolTimers();
          if (finalReplace) {
            const replacement = finalReplace;
            deps.setMessageContent(replacement.messageId, replacement.text);
            if (ctx.activeStreamingStoredSessionId) {
              const cached = deps.getSessionMessagesCache().get(ctx.activeStreamingStoredSessionId);
              const target = cached?.find((m) => m.id === replacement.messageId);
              if (target) target.content = replacement.text;
            }
          }
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
          const rawTargetId = action.sessionId || ctx.activeStreamingStoredSessionId;
          const completedTargetId = deps.toStoredSessionId(rawTargetId);
          if (completedTargetId) {
            const isFocused = completedTargetId === state.activeSessionId;
            if (isFocused && wasNearBottomBeforeSettle) {
              deps.setPendingScrollToBottom?.(true);
            }
            deps.completeEntityTurn('session', deps.getActiveRunningSessionIds(), deps.getUnreadSessionIds(), completedTargetId, isFocused);
            if (isFocused) {
              deps.getSessionMessagesCache().set(completedTargetId, [...state.messages]);
            }
            const msgsToPersist = isFocused ? state.messages : (deps.getSessionMessagesCache().get(completedTargetId) || []);
            if (msgsToPersist.length > 0) {
              deps.persistTurnToCache(completedTargetId, ctx.activeStreamingBotName, msgsToPersist);
            }
            const completedSess = state.sessions.find((s) => s.id === completedTargetId);
            if (completedSess) {
              const finalMsg = isFocused
                ? (state.messages.length > 0 ? state.messages[state.messages.length - 1] : null)
                : (deps.getSessionMessagesCache().get(completedTargetId)?.slice(-1)[0] || null);
              if (finalMsg?.content) {
                completedSess.preview = finalMsg.content;
              }
              completedSess.timestamp = Date.now();
              completedSess.time = formatTimestamp(Date.now());
              state.sessions = [completedSess, ...state.sessions.filter((s) => s.id !== completedSess.id)];
              deps.persistSessionsToCache(state.sessions);
            }
          }
          if (ctx.activeStreamingBotName) {
            const isBotFocused = state.activeFocus.type === 'bot' && state.activeFocus.botName === ctx.activeStreamingBotName;
            const finalMsg = isBotFocused
              ? (state.messages.length > 0 ? state.messages[state.messages.length - 1] : null)
              : (ctx.activeStreamingStoredSessionId ? deps.getSessionMessagesCache().get(ctx.activeStreamingStoredSessionId)?.slice(-1)[0] || null : null);
            if (finalMsg?.content) {
              deps.getBotActivityStore().updateLatestActivity(ctx.activeStreamingBotName, finalMsg.content, Date.now());
            }
            deps.completeEntityTurn('bot', deps.getActiveRunningBotNames(), deps.getUnreadBotNames(), ctx.activeStreamingBotName, isBotFocused);
            deps.setActiveStreamingContext({ activeStreamingBotName: null });
          }
          deps.syncProfileLastMessages();
          state.isStreaming = false;
          state.turnStartedAt = undefined;
          deps.setTurnStartedSessionId(null);
          deps.clearPresenceTerminal();
          deps.setActiveStreamingContext({
            activeStreamingMessageId: null,
            activeStreamingStoredSessionId: null,
            activeStreamingLiveId: null,
          });
          deps.disarmTurnWatchdog();
          needsRender = true;
          break;
        }

        case 'turn-failed': {
          const wasNearBottomBeforeFail = deps.isStreamNearBottom?.() ?? false;
          deps.getTokenCoalescer().flush();
          deps.clearToolPatchQueue?.();
          deps.stopRunningToolTimers();
          const pendingMsg = ctx.activeStreamingMessageId
            ? state.messages.find((m) => m.id === ctx.activeStreamingMessageId)
            : undefined;
          if (pendingMsg && !pendingMsg.content) {
            pendingMsg.content = deps.t('chat.turnFailedPrefix', { message: action.message });
          }
          const rawFailedId = action.sessionId || ctx.activeStreamingStoredSessionId;
          const failedTargetId = deps.toStoredSessionId(rawFailedId);
          if (failedTargetId) {
            if (failedTargetId === state.activeSessionId && wasNearBottomBeforeFail) {
              deps.setPendingScrollToBottom?.(true);
            }
            applyTurnFailed(deps.getActiveRunningSessionIds(), failedTargetId);
            deps.getActivityTransitionTracker().clear('session', failedTargetId);
          }
          if (ctx.activeStreamingBotName) {
            applyTurnFailed(deps.getActiveRunningBotNames(), ctx.activeStreamingBotName);
            deps.getActivityTransitionTracker().clear('bot', ctx.activeStreamingBotName);
            deps.setActiveStreamingContext({ activeStreamingBotName: null });
          }
          deps.syncProfileLastMessages();
          state.isStreaming = false;
          deps.armPresenceTerminal({ kind: 'failed', message: action.message });
          deps.setActiveStreamingContext({
            activeStreamingMessageId: null,
            activeStreamingStoredSessionId: null,
            activeStreamingLiveId: null,
          });
          // 【消除同步双 render (Pitfall)】setTimedDockNotice 默认会立即调用 render()，
          // 会提前消费 pendingScrollToBottom 并让批末 deps.render() 落在 messagesChanged=false 路径；
          // 传 skipRender: true 仅落盘通知与倒计时，由批末统一执行唯一一次 render()。
          deps.setTimedDockNotice(action.message, undefined, { skipRender: true });
          deps.disarmTurnWatchdog();
          needsRender = true;
          break;
        }

        case 'refresh-sessions':
          deps.scheduleSessionsRefresh();
          break;

        case 'session-title':
          state.sessions = applySessionTitle(state.sessions, action.sessionId, action.title);
          needsRender = true;
          break;

        case 'side-agent-complete': {
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

    if (needsRender) deps.render();
    deps.syncAgentPresence();
  }

  function handleGatewayEvent(params: unknown): void {
    const runningStoredIds = Array.from(deps.getActiveRunningSessionIds());
    const registry = deps.getSessionHandleRegistry();
    const runningLiveIds = registry.getLiveIds(runningStoredIds);
    const state = deps.getState();
    const ctx = deps.getActiveStreamingContext();

    const activeLiveMapped = state.activeSessionId ? registry.toLiveId(state.activeSessionId) : null;
    const activeStoredMapped = state.activeLiveSessionId ? registry.toStoredId(state.activeLiveSessionId) : null;
    const streamingLiveMapped = ctx.activeStreamingStoredSessionId ? registry.toLiveId(ctx.activeStreamingStoredSessionId) : null;
    const streamingStoredMapped = ctx.activeStreamingLiveId ? registry.toStoredId(ctx.activeStreamingLiveId) : null;

    const activeIds = [
      state.activeLiveSessionId,
      state.activeSessionId,
      activeLiveMapped,
      activeStoredMapped,
      ctx.activeStreamingLiveId,
      ctx.activeStreamingStoredSessionId,
      streamingLiveMapped,
      streamingStoredMapped,
      ...runningStoredIds,
      ...runningLiveIds,
    ].filter((id): id is string => Boolean(id));

    const actions = reduceGatewayEvent(params, {
      activeSessionIds: Array.from(new Set(activeIds)),
      activeStreamingMessageId: ctx.activeStreamingMessageId,
    });
    if (actions.length > 0) applyTurnActions(actions);

    handleInspectorEvent(params);
  }

  async function connect(targetUrl?: string): Promise<void> {
    const epoch = ++connectionEpoch;
    deps.stopProfileAutoRefresh();

    const oldClient = deps.getGatewayClient();
    if (oldClient) {
      oldClient.disconnect();
      deps.setGatewayClient(null);
    }

    const state = deps.getState();
    if (targetUrl) {
      state.gatewayUrl = targetUrl;
    }

    if (!deps.getEffectiveUrl(state.gatewayUrl)) {
      state.gatewayConnected = false;
      state.gatewayConnecting = false;
      state.profilesPhase = 'ready';
      state.sessionsPhase = 'ready';
      state.messagesPhase = 'ready';
      state.testStatus = undefined;
      void deps.applyColdStartFocus();
      deps.render();
      return;
    }

    // 连接成功后回写配置（P-032）：写盘失败只影响下次启动的记忆，不得中断连接流程。
    // 该路径是连接成功的副作用而非用户主动保存，失败只记日志、不弹窗打扰。
    let persistFailure: StorageWriteFailure = { ok: true };
    const persistedEntries: ReadonlyArray<readonly [string, string]> = [
      ['hermes_flux_gateway_url', state.gatewayUrl],
      ['hermes_flux_username', state.username],
      ['hermes_flux_password', state.password],
      ['hermes_flux_profile', state.profileName],
      ['hermes_aura_gateway_url', state.gatewayUrl],
      ['hermes_aura_username', state.username],
      ['hermes_aura_password', state.password],
      ['hermes_aura_profile', state.profileName],
    ];
    for (const [key, value] of persistedEntries) {
      const result = safeSetItem(key, value);
      if (!result.ok && persistFailure.ok) persistFailure = result;
      // 与 settingsDataService.writeGatewayDraft 同策略：SecurityError 不可恢复，首个失败即短路。
      if (!result.ok && result.reason === 'security') break;
    }
    if (!persistFailure.ok && persistFailure.reason !== 'unavailable') {
      console.warn('[gateway] failed to persist connection config; memory state is still active', {
        reason: persistFailure.reason,
        error: String(persistFailure.error),
      });
    }

    state.gatewayConnecting = true;
    state.testStatus = undefined;
    deps.render();

    try {
      const test = await deps.testConnection(
        state.gatewayUrl,
        state.username,
        state.password
      );

      if (epoch !== connectionEpoch) return;

      state.gatewayLatencyMs = test.latency;
      state.testStatus = test;

      if (!test.ok) {
        state.gatewayConnecting = false;
        state.gatewayConnected = false;
        state.profilesPhase = 'ready';
        state.sessionsPhase = 'ready';
        state.messagesPhase = 'ready';
        void deps.applyColdStartFocus();
        deps.render();
        return;
      }

      deps.setCurrentTicket(test.ticket);

      const baseUrl = deps.getEffectiveUrl(state.gatewayUrl);
      const desktopApi = deps.getDesktopApi();
      const buildWsUrl = (ticket?: string): string =>
        buildGatewayWsUrl(baseUrl, ticket, desktopApi?.proxyWebSocketUrl);

      const client = new GatewayClientImpl({
        url: buildWsUrl(test.ticket),
        resolveUrl: createGatewayReconnectResolver({
          epoch,
          getCurrentEpoch: () => connectionEpoch,
          authenticate: () => deps.testConnection(state.gatewayUrl, state.username, state.password),
          buildUrl: buildWsUrl,
          onRefreshed: (refreshed: GatewayAuthResponse) => {
            state.gatewayLatencyMs = refreshed.latency;
            state.testStatus = refreshed;
            if (refreshed.ok) {
              deps.setCurrentTicket(refreshed.ticket);
            }
          },
          fallbackErrorMessage: deps.t('chat.gatewayNotConnected'),
        }),
        autoConnect: true,
        timeoutMs: 25000,
      });

      deps.setGatewayClient(client);

      if (desktopApi?.httpProxy) {
        client.setRestFallbackHandler(async (path, opts) => {
          return await desktopApi.httpProxy({
            baseUrl,
            path,
            method: opts?.method,
            ticket: deps.getCurrentTicket(),
            params: opts?.params,
            body: opts?.body,
          });
        });
      }

      client.onNotification('event', (params: unknown) => {
        handleGatewayEvent(params);
      });

      client.getFsm().onStateChange((fsmState) => {
        if (epoch !== connectionEpoch) return;

        const isConnected = fsmState === 'CONNECTED' || fsmState === 'HANDSHAKING';
        const isConnecting = fsmState === 'CONNECTING';

        if (state.gatewayConnected !== isConnected || state.gatewayConnecting !== isConnecting) {
          state.gatewayConnected = isConnected;
          state.gatewayConnecting = isConnecting;

          const isUserEditing =
            typeof document !== 'undefined' &&
            document.activeElement &&
            (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
          if (state.isSettingsOpen && isUserEditing && !isConnected) {
            return;
          }

          deps.render();

          if (isConnected) {
            deps.startProfileAutoRefresh();
            Promise.allSettled([
              deps.fetchProfiles().then(() => Promise.allSettled([
                deps.fetchSessions(),
                deps.fetchGroupRooms(),
                deps.prefetchSlashCatalog(),
              ])),
              deps.fetchModelOptions(),
              deps.fetchProjects(),
            ]);
          }
        }
      });

      if (client.getState() === 'CONNECTED') {
        state.gatewayConnected = true;
        state.gatewayConnecting = false;
        deps.render();
        deps.startProfileAutoRefresh();
        Promise.allSettled([
          deps.fetchProfiles().then(() => Promise.allSettled([
            deps.fetchSessions(),
            deps.fetchGroupRooms(),
            deps.prefetchSlashCatalog(),
          ])),
          deps.fetchModelOptions(),
          deps.fetchProjects(),
        ]);
      }
    } catch (err: unknown) {
      console.error('[Flux Connect] Connection failed:', err);
      state.gatewayConnected = false;
      state.gatewayConnecting = false;
      state.profilesPhase = 'ready';
      state.sessionsPhase = 'ready';
      state.messagesPhase = 'ready';
      const errMsg = err instanceof Error ? err.message : String(err);
      state.testStatus = {
        ok: false,
        message: deps.t('chat.wsHandshakeFailed', { error: errMsg || deps.t('chat.networkError') }),
        latency: 0,
      };
    }

    deps.render();
  }

  function disconnect(): void {
    connectionEpoch++;
    deps.stopProfileAutoRefresh();
    const client = deps.getGatewayClient();
    if (client) {
      client.disconnect();
      deps.setGatewayClient(null);
    }
    deps.getTokenCoalescer().clear();
    deps.clearToolPatchQueue?.();
    deps.disarmTurnWatchdog();
    deps.stopAllGroupPollers();
    deps.getActivityTransitionTracker().clearAll();
    deps.clearTransitionRefreshTimer();
    deps.setActiveStreamingContext({
      activeStreamingMessageId: null,
      activeStreamingStoredSessionId: null,
      activeStreamingLiveId: null,
      activeStreamingBotName: null,
    });
    deps.getActiveRunningSessionIds().clear();
    deps.getUnreadSessionIds().clear();
    deps.getActiveRunningBotNames().clear();
    deps.getUnreadBotNames().clear();
    deps.getActiveRunningGroupRoomIds().clear();
    deps.getUnreadGroupRoomIds().clear();
    deps.clearSessionsRefreshTimer();

    const state = deps.getState();
    state.gatewayConnected = false;
    state.gatewayConnecting = false;
    state.gatewayLatencyMs = 0;
    state.messagesPhase = 'ready';
    state.sessions = [];
    state.messages = [];
    state.rollbackArmed = null;
    state.activeSessionId = '';
    state.activeLiveSessionId = '';
    state.pendingSessionIds = [];
    state.isStreaming = false;
    state.modelMenuOpen = false;
    state.sessionListError = '';
    state.dockNotice = '';
    deps.render();
  }

  return {
    connect,
    disconnect,
    getConnectionEpoch: () => connectionEpoch,
    handleGatewayEvent,
    applyTurnActions,
    handleInspectorEvent,
  };
}
