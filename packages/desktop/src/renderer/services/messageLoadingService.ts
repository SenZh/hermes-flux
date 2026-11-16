/**
 * Hermes Flux 消息加载、历史分页漫游与副标题同步服务（Message Loading Service）
 *
 * 【设计意图 (Why)】
 *   将首屏消息极速装载（loadMessages / loadMessagesInner，包含 0ms 内存秒开、IndexedDB 优先读与权威 REST 对齐）、
 *   历史向上分页漫游（loadOlderMessages，包含血缘追溯、游标对齐、高估回退重拉、挂载窗口位移与锚点保持）、
 *   消息原始行解析与归一化（parseRawMessages）、
 *   会话副标题向左轨反哺同步（syncActiveSessionPreviewToRail）以及
 *   游标状态生命周期管理（forgetOlderCursorState）从 index.ts 中彻底解耦。
 *   实现零 DOM 依赖（或具备脱离 DOM 纯逻辑单测性），确保核心历史分页与权威合并状态机具备可形式化验证性。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 必须包含被上下文压缩归档的原始消息（includeCompacted: true），否则翻到压缩摘要节点就中断；
 *   2. 向上翻页网络失败绝不可判定为"已到最早"（Failure Is Not Empty），否则网络瞬断会导致更早历史永久丢失；
 *   3. 游标推进必须由 planOlderPagination 结合本地已覆盖行数计算，高估越界撞空时退回保守游标（planOlderZeroMessagesAction）；
 *   4. 切会话代际竞态：迟滞慢响应（Delayed Slow Response）必须由代际 generation 阻断，坚决不可污染新会话视口与缓存；
 *   5. 副标题反哺必须按 botName + sessionId 联合寻址，杜绝跨 Profile 同名 ID 篡改。
 *
 * 【约束与规则 (Rules)】
 *   1. 单向依赖：严禁反向 import index.js，所有状态读写与 UI 渲染通过 MessageLoadingDeps 依赖注入；
 *   2. 严格类型推导：0 TS 报错，严禁使用 `as any`；
 *   3. 加载态同步收敛：isLoadingOlder 必须在同步路径置 false 并触发 render，不可仅靠 requestAnimationFrame。
 */

import type { AppState } from '../state/appState.js';
import {
  type HermesGatewayClient,
  type SessionMessagesOutcome,
  type SessionMessageRecord,
  type CacheChannelRef,
  type CacheService,
  type CachedMessageRow,
  type SessionHandleRegistry,
  type BotActivityRecord,
  readSessionHandles,
  resolveLineageChain,
  planOlderBatchPrependMerge,
  planOlderBatchPrependMergeDetailed,
  planOlderPagination,
  countLocalCoveredRows,
  syncActiveSessionToBot,
  reconcileAuthoritativeActivity,
  runGuarded,
  sortByDisplayAsc,
} from '@hermes-flux/core';
import type { MessageViewModel } from '@hermes-flux/ui';
import {
  parseTranscriptRows,
} from '../transcriptRows.js';
import {
  hasLegacyUnorderedCacheRows,
  computeOlderBatchWindowStart,
  windowEndFor,
  computeHasOlderMessages,
  planOlderZeroMessagesAction,
  shouldTreatOlderDropAsExhausted,
  shouldKeepOlderMessagesAfterLoop,
} from '../messageWindow.js';
import {
  shiftWindowStartForPrepend,
} from '../promptNavigator.js';
import {
  takeServerPriority,
  planSessionLoadMerge,
  extractDurableRowId,
} from '../rollbackTransaction.js';
import {
  toMessageViewModel,
} from '../cache/desktopCacheBridge.js';
import {
  describeRpcError,
} from './sessionOperationService.js';

export const INITIAL_WINDOW_PAGE_SIZE = 50;
export const OLDER_BATCH_PAGE_SIZE = 500;
export const MESSAGE_WINDOW_CAPACITY = 100;
export const INITIAL_RENDER_WINDOW = 30;
export const MESSAGE_CACHE_LIMIT = 500;

export interface MessageLoadingDeps {
  readonly getState: () => AppState;
  readonly getGatewayClient: () => HermesGatewayClient | null;
  readonly render: () => void;

  readonly sessionMessagesCache: Map<string, MessageViewModel[]>;
  readonly cacheService: CacheService;
  readonly persistMessagesToCache: (channelRef: CacheChannelRef, messages: MessageViewModel[], fenceMax?: number) => void;

  // 提示词导航与视口管理
  readonly syncPromptNavigatorMeta: () => void;
  readonly syncPromptNavigatorFromScroll: () => void;
  readonly scrollStreamToBottom: (reason?: string) => void;
  readonly setPendingScrollToBottom: (val: boolean) => void;
  readonly isStreamNearBottom: (el: HTMLElement | null) => boolean;
  readonly captureStreamAnchor: () => unknown;
  readonly applyStreamAnchor: (anchor: unknown, maintainDistanceToBottom?: boolean) => void;

  // 消息窗口状态
  readonly getMessageWindowStart: () => number;
  readonly setMessageWindowStart: (val: number) => void;
  readonly getMessageWindowEnd: () => number;
  readonly setMessageWindowEnd: (val: number) => void;
  readonly setMessageWindowUserExpanded: (val: boolean) => void;
  readonly setCanvasStructureDirty?: (val: boolean) => void;
  readonly setSuppressPinBottomOnce?: (val: boolean) => void;

  // 会话与房间状态
  readonly isGroupConversationActive: (id: string) => boolean;
  readonly hostedRoomIds: Set<string>;
  readonly formatSessionTime: (timestamp: number) => string;
  readonly formatTimestamp: (ts: number | string) => string;

  // Bot 状态持久化
  readonly botActivityStore: {
    withActivityMap: <T>(fn: (map: Map<string, BotActivityRecord>) => T) => T;
    persist: () => void;
  };
  readonly botForeverChatCache: Map<string, string>;
  readonly sessionPreviewCache: Map<string, { lastActive: number; text: string; botName?: string }>;
  readonly persistSessionPreviewCache: () => void;

  // 流式与代际状态
  readonly getActiveStreamingStoredSessionId: () => string | null;
  readonly defaultSessionHandleRegistry: SessionHandleRegistry;
  readonly activeRunningSessionIds: Set<string>;
  readonly activityTransitionTracker: { clear: (type: 'session' | 'group' | 'bot', id: string) => void };
  readonly getGeneration?: () => number;
  readonly onGenerationIncremented?: (gen: number) => void;

  // 日志记录器
  readonly logSession?: {
    debug: (msg: string, ctx?: unknown) => void;
    info: (msg: string, ctx?: unknown) => void;
    warn: (msg: string, ctx?: unknown) => void;
    error: (msg: string, ctx?: unknown) => void;
  };
  readonly logScroll?: {
    debug: (msg: string, ctx?: unknown) => void;
    info: (msg: string, ctx?: unknown) => void;
    warn: (msg: string, ctx?: unknown) => void;
  };

  // DOM 容器引用（可选）
  readonly getConversationStreamElement?: () => HTMLElement | null;
}

export class MessageLoadingService {
  /** 记录各会话已确认的服务端消息下界偏移量 */
  readonly sessionServerOffset = new Map<string, number>();

  /** 记录服务端确认的最少已知总条数 */
  readonly sessionAuthoritativeOffset = new Map<string, number>();

  /** 记录父会话血缘遍历游标 */
  readonly sessionParentOffsetMap = new Map<string, number>();

  /** 记录高估下界标记 */
  readonly sessionOvershootRetry = new Set<string>();

  /** 截断成功后的会话历史权威源标记：'server-priority' 时禁用本地更长保留 */
  readonly sessionHistoryTrust = new Map<string, 'server-priority'>();

  /** 标记会话当前从旧版未带 displaySeq 持久化缓存临时恢复 */
  readonly untrustedOrderCacheSessions = new Set<string>();

  /** 消息拉取代际计数器 */
  private activeLoadMessagesGeneration = 0;

  /** 上一次历史向上漫游请求启动时间戳（用于陈旧超时熔断） */
  private olderLoadingStartedAt = 0;

  constructor(private readonly deps: MessageLoadingDeps) {
    this.activeLoadMessagesGeneration = this.deps.getGeneration?.() ?? 0;
  }

  /** 获取当前代际计数 */
  getActiveLoadMessagesGeneration(): number {
    return this.activeLoadMessagesGeneration;
  }

  /** 步进代际计数（供外部切会话时主动失效迟滞请求） */
  incrementGeneration(): number {
    const next = ++this.activeLoadMessagesGeneration;
    this.deps.onGenerationIncremented?.(next);
    return next;
  }

  /** 标记会话以服务端权威为准（消费 server-priority） */
  markSessionServerPriority(sessionId: string): void {
    this.sessionHistoryTrust.set(sessionId, 'server-priority');
  }

  /** 清理会话游标与高估回退标记 */
  forgetOlderCursorState(sessionId: string): void {
    this.sessionServerOffset.delete(sessionId);
    this.sessionAuthoritativeOffset.delete(sessionId);
    const prefix = `${sessionId}:`;
    for (const key of [...this.sessionOvershootRetry]) {
      if (key.startsWith(prefix)) this.sessionOvershootRetry.delete(key);
    }
  }

  /** 同步不可信缓存排序标记 */
  syncUntrustedCacheOrderFlag(sessionId: string, rows: readonly CachedMessageRow[]): void {
    if (hasLegacyUnorderedCacheRows(rows)) {
      this.untrustedOrderCacheSessions.add(sessionId);
    } else {
      this.untrustedOrderCacheSessions.delete(sessionId);
    }
  }

  /** 判定当前会话是否仍存在尚未耗尽的父会话血缘段 */
  hasRemainingParentLineage(sessionId: string): boolean {
    if (!sessionId) return false;
    const state = this.deps.getState();
    const parents = resolveLineageChain(sessionId, state.sessions).slice(1);
    return parents.some((id) => this.sessionServerOffset.get(`${sessionId}:${id}:exhausted`) !== 1);
  }

  /** 解析网关原始消息行 */
  parseRawMessages(list: unknown[]): MessageViewModel[] {
    const state = this.deps.getState();
    return parseTranscriptRows(list, {
      scope: {
        isGroupRoom: state.activeFocus.type === 'group',
        isBotRoom: state.activeFocus.type === 'bot',
      },
      formatTimestamp: this.deps.formatTimestamp,
    });
  }

  /** 会话历史加载入口 */
  async loadMessages(sessionId: string, targetBotName?: string): Promise<void> {
    const cached = sessionId ? this.deps.sessionMessagesCache.get(sessionId) : undefined;
    const state = this.deps.getState();
    state.messagesPhase = cached && cached.length > 0 ? 'ready' : 'loading';
    const expectedGeneration = this.activeLoadMessagesGeneration + 1;
    try {
      await this.loadMessagesInner(sessionId, targetBotName);
    } finally {
      if (!sessionId || expectedGeneration === this.activeLoadMessagesGeneration) {
        state.messagesPhase = 'ready';
        this.deps.render();
      }
    }
  }

  /** 会话历史加载内核 */
  async loadMessagesInner(sessionId: string, targetBotName?: string): Promise<void> {
    const state = this.deps.getState();
    const gatewayClient = this.deps.getGatewayClient();
    const cacheService = this.deps.cacheService;

    // 离线也允许打开会话：历史由持久化缓存提供
    if (!sessionId) {
      state.messages = [];
      state.hasOlderMessages = false;
      this.deps.render();
      return;
    }

    const currentGen = this.incrementGeneration();
    const loadStartedAt = performance.now();
    state.activeSessionId = sessionId;

    // 精准解析当前会话归属的 Profile
    const resolvedBotName = targetBotName
      || state.sessions.find((s) => s.id === sessionId)?.botName
      || (state.activeFocus.type === 'bot' ? state.activeFocus.botName : state.profileName)
      || 'default';

    // 1. Instant Cache Hit (0ms)
    const cached = this.deps.sessionMessagesCache.get(sessionId);
    if (cached && cached.length > 0) {
      state.messages = [...cached];
      this.syncActiveSessionPreviewToRail(sessionId, state.messages, resolvedBotName);
      state.hasOlderMessages = computeHasOlderMessages(
        state.messages,
        this.sessionServerOffset.get(sessionId),
        INITIAL_WINDOW_PAGE_SIZE,
        this.hasRemainingParentLineage(sessionId),
      );
      this.deps.setPendingScrollToBottom(true);
      this.deps.render();
      this.deps.scrollStreamToBottom('cache hit');
      this.deps.logSession?.debug('session rendered from cache', {
        sessionId,
        mounted: state.messages.length,
        ms: Math.round((performance.now() - loadStartedAt) * 10) / 10,
      });
    } else {
      state.messages = [];
      state.hasOlderMessages = false;
      this.deps.render();
    }

    // 2. If this session is currently actively streaming, DO NOT overwrite with stale REST history!
    if (this.deps.getActiveStreamingStoredSessionId() === sessionId) {
      this.deps.logSession?.info('session is actively streaming, preserving live state', { sessionId });
      return;
    }

    // 2.5 持久化缓存命中（内存未命中时）：先把历史读出来，再拉最新
    const cacheRef: CacheChannelRef = { profile: resolvedBotName, channel: 'session', channelId: sessionId };
    let cacheFenceMax = 0;
    if (!cached || cached.length === 0) {
      try {
        const opened = await this.deps.cacheService.openChannel(cacheRef, MESSAGE_CACHE_LIMIT);
        cacheFenceMax = opened.fenceMax;
        const stillCurrent = currentGen === this.activeLoadMessagesGeneration && state.activeSessionId === sessionId;
        if (opened.rows.length > 0 && stillCurrent && state.messages.length === 0) {
          this.syncUntrustedCacheOrderFlag(sessionId, opened.rows);
          state.messages = sortByDisplayAsc(opened.rows).map(toMessageViewModel);
          this.deps.sessionMessagesCache.set(sessionId, state.messages);
          this.sessionServerOffset.set(sessionId, Math.max(
            this.sessionServerOffset.get(sessionId) || 0,
            countLocalCoveredRows(state.messages, sessionId),
          ));
          state.hasOlderMessages = computeHasOlderMessages(
            state.messages,
            opened.rows.length,
            INITIAL_WINDOW_PAGE_SIZE,
            this.hasRemainingParentLineage(sessionId),
          );
          this.deps.setPendingScrollToBottom(true);
          this.deps.render();
          this.deps.scrollStreamToBottom('persistent cache hit');
          this.deps.logSession?.info('session rendered from persistent cache', {
            sessionId,
            mounted: state.messages.length,
            ms: Math.round((performance.now() - loadStartedAt) * 10) / 10,
          });
        }
      // gate-degrade: 本地缓存读取失败或未命中时平滑回退到远端 REST 拉取
      } catch {}
    }

    // 3. 无网关时到此为止：有缓存就已上屏，没有则保持空态
    if (!gatewayClient) {
      this.deps.render();
      return;
    }

    // 4. High-speed REST pagination: 50 items latest-first
    let fastLoaded = false;
    try {
      const outcome = await gatewayClient.fetchSessionMessages(sessionId, {
        limit: INITIAL_WINDOW_PAGE_SIZE,
        order: 'latest',
        profile: resolvedBotName,
        includeCompacted: true,
      });

      if (currentGen !== this.activeLoadMessagesGeneration || state.activeSessionId !== sessionId) {
        this.deps.logSession?.debug('discarded stale REST history due to session switch', { sessionId, currentGen });
        return;
      }

      if (outcome.status === 'success' && outcome.messages.length > 0) {
        const parsed = this.parseRawMessages(outcome.messages);
        const existing = this.deps.sessionMessagesCache.get(sessionId);
        const sessionHistoryTrust = this.sessionHistoryTrust;
        const serverPriority = takeServerPriority(sessionHistoryTrust, sessionId);
        const replaceUntrustedCache = this.untrustedOrderCacheSessions.delete(sessionId);
        if (replaceUntrustedCache) {
          await cacheService.dropChannel(cacheRef);
          if (currentGen !== this.activeLoadMessagesGeneration || state.activeSessionId !== sessionId) return;
          cacheFenceMax = 0;
          this.sessionServerOffset.delete(sessionId);
        }
        const merged = planSessionLoadMerge(parsed, existing, serverPriority || replaceUntrustedCache);
        this.deps.sessionMessagesCache.set(sessionId, merged);
        this.deps.persistMessagesToCache(cacheRef, merged, cacheFenceMax);
        this.syncActiveSessionPreviewToRail(sessionId, merged, resolvedBotName);
        const serverKnownCount = outcome.pagination?.returned ?? outcome.messages.length;
        this.sessionAuthoritativeOffset.set(
          sessionId,
          Math.max(this.sessionAuthoritativeOffset.get(sessionId) || 0, serverKnownCount),
        );
        const localCoveredRows = countLocalCoveredRows(merged, sessionId);
        const currentKnown = Math.max(this.sessionServerOffset.get(sessionId) || 0, serverKnownCount, localCoveredRows);
        this.sessionServerOffset.set(sessionId, currentKnown);
        state.messages = merged;
        state.hasOlderMessages = merged.length > serverKnownCount
          ? true
          : computeHasOlderMessages(merged, serverKnownCount, INITIAL_WINDOW_PAGE_SIZE, this.hasRemainingParentLineage(sessionId));
        state.dockNotice = '';
        this.deps.setPendingScrollToBottom(true);
        this.deps.render();
        this.deps.scrollStreamToBottom('fast rest loaded');
        fastLoaded = true;

        this.deps.logSession?.info('session loaded via high-speed REST', {
          sessionId,
          returned: outcome.messages.length,
          mounted: parsed.length,
          ms: Math.round((performance.now() - loadStartedAt) * 10) / 10,
        });
      }
    } catch (err) {
      this.deps.logSession?.debug('fast REST load failed, falling back to session.resume', { err });
    }

    // 5. Background asynchronous session.resume for live session activation & handle resolution
    const resumePromise = (async () => {
      const rpcStartedAt = performance.now();
      try {
        let res: Record<string, unknown> | null = null;
        try {
          res = await gatewayClient.call<Record<string, unknown>>('session.resume', {
            session_id: sessionId,
            profile: resolvedBotName,
          });
        } catch (firstErr: unknown) {
          const firstMsg = describeRpcError(firstErr);
          if (firstMsg.includes('Extra inputs')) {
            res = await gatewayClient.call<Record<string, unknown>>('session.resume', { session_id: sessionId });
          } else {
            throw firstErr;
          }
        }

        if (currentGen !== this.activeLoadMessagesGeneration || state.activeSessionId !== sessionId) {
          return;
        }

        const handles = readSessionHandles(res, sessionId);
        if (handles) {
          this.deps.defaultSessionHandleRegistry.register(handles);
          state.activeLiveSessionId = handles.liveId;
        } else {
          state.activeLiveSessionId = sessionId;
        }

        if (res && typeof res === 'object') {
          const isGwRunning = Boolean(res.running);
          const inflightObj = res.inflight && typeof res.inflight === 'object' ? (res.inflight as { streaming?: boolean }) : null;
          const hasInflight = Boolean(inflightObj && inflightObj.streaming);
          const reconciled = reconcileAuthoritativeActivity({
            runningIds: this.deps.activeRunningSessionIds,
            entityId: sessionId,
            isGatewayRunning: isGwRunning,
            hasInflightStreaming: hasInflight,
            currentStreamingId: this.deps.getActiveStreamingStoredSessionId(),
          });
          if (reconciled) {
            this.deps.activityTransitionTracker.clear('session', sessionId);
            this.deps.logSession?.info('reconciled orphan running state via authoritative gateway status', { sessionId });
            this.deps.render();
          }
        }

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
            this.deps.render();
          }
        }

        if (!fastLoaded) {
          const list = Array.isArray(res?.messages) ? res.messages : Array.isArray(res?.history) ? res.history : [];
          if (list.length > 0) {
            const parsed = this.parseRawMessages(list);
            const existing = this.deps.sessionMessagesCache.get(sessionId);
            const sessionHistoryTrust = this.sessionHistoryTrust;
            const wsServerPriority = takeServerPriority(sessionHistoryTrust, sessionId);
            const replaceUntrustedCache = this.untrustedOrderCacheSessions.delete(sessionId);
            if (replaceUntrustedCache) {
              await cacheService.dropChannel(cacheRef);
              if (currentGen !== this.activeLoadMessagesGeneration || state.activeSessionId !== sessionId) return;
              cacheFenceMax = 0;
              this.sessionServerOffset.delete(sessionId);
            }
            const merged = planSessionLoadMerge(parsed, existing, wsServerPriority || replaceUntrustedCache);
            this.deps.sessionMessagesCache.set(sessionId, merged);
            this.deps.persistMessagesToCache(cacheRef, merged, cacheFenceMax);
            this.syncActiveSessionPreviewToRail(sessionId, merged, resolvedBotName);
            state.messages = merged;
            this.sessionAuthoritativeOffset.set(
              sessionId,
              Math.max(this.sessionAuthoritativeOffset.get(sessionId) || 0, parsed.length),
            );
            this.sessionServerOffset.set(sessionId, Math.max(
              this.sessionServerOffset.get(sessionId) || 0,
              merged.length,
              countLocalCoveredRows(merged, sessionId),
            ));
            state.hasOlderMessages = computeHasOlderMessages(
              merged,
              merged.length,
              INITIAL_WINDOW_PAGE_SIZE,
              this.hasRemainingParentLineage(sessionId),
            );
            this.deps.setPendingScrollToBottom(true);
            this.deps.render();
            this.deps.scrollStreamToBottom('ws fallback loaded');
          } else {
            const existing = this.deps.sessionMessagesCache.get(sessionId);
            const sessionHistoryTrust = this.sessionHistoryTrust;
            takeServerPriority(sessionHistoryTrust, sessionId);
            if (existing && existing.length > 0) {
              state.messages = [...existing];
              this.deps.render();
            }
          }
        }

        this.deps.logSession?.debug('background session.resume activated', {
          sessionId,
          liveId: state.activeLiveSessionId,
          ms: Math.round((performance.now() - rpcStartedAt) * 10) / 10,
        });
      } catch (e) {
        if (!fastLoaded && currentGen === this.activeLoadMessagesGeneration && state.activeSessionId === sessionId) {
          console.warn('[Hermes Gateway] Failed to load messages via RPC fallback:', e);
          const errText = describeRpcError(e);
          state.messages = [];
          state.dockNotice = `Load session history failed: ${errText}`;
          this.deps.render();
        }
      }
    })();

    if (!fastLoaded) {
      await resumePromise;
    }
  }

  /** 向上翻页加载更早的历史记录 */
  async loadOlderMessages(options?: { preserveViewportWindow?: boolean }): Promise<void> {
    const state = this.deps.getState();
    const gatewayClient = this.deps.getGatewayClient();
    const sessionId = state.activeSessionId;
    if (!sessionId || !gatewayClient) return;

    if (state.isLoadingOlder) {
      if (performance.now() - this.olderLoadingStartedAt > 20000) {
        state.isLoadingOlder = false;
        this.deps.syncPromptNavigatorMeta();
      } else {
        return;
      }
    }

    if (this.deps.hostedRoomIds.has(sessionId) || this.deps.isGroupConversationActive(sessionId)) {
      state.isLoadingOlder = false;
      this.deps.syncPromptNavigatorMeta();
      return;
    }

    const resolvedProfile = state.sessions.find((s) => s.id === sessionId)?.botName
      || (state.activeFocus.type === 'bot' ? state.activeFocus.botName : state.profileName)
      || 'default';

    const guard = { sessionId, generation: this.activeLoadMessagesGeneration };
    const preserveViewportWindow = Boolean(options?.preserveViewportWindow);
    const streamEl = this.deps.getConversationStreamElement
      ? this.deps.getConversationStreamElement()
      : (typeof document !== 'undefined' ? document.getElementById('conversation-stream') : null);
    const wasNearBottomBeforeLoad = this.deps.isStreamNearBottom(streamEl);
    const render = (): void => this.deps.render();

    state.isLoadingOlder = true;
    this.olderLoadingStartedAt = performance.now();
    this.deps.syncPromptNavigatorMeta();
    const startedAt = performance.now();
    const anchor = this.deps.captureStreamAnchor();
    let fetchFailed = false;

    const sessionEarliestRowId = (): number | null => {
      for (const m of state.messages) {
        if (typeof m.rowId !== 'number' || m.rowId <= 0) continue;
        if (m.sessionId && m.sessionId !== sessionId) continue;
        return m.rowId;
      }
      return null;
    };

    const lineageChain = resolveLineageChain(sessionId, state.sessions);

    try {
      let batchAppended = false;

      // 0. 本地持久化缓存优先
      const oldestRowId = sessionEarliestRowId();
      if (typeof oldestRowId === 'number' && oldestRowId > 1) {
        try {
          const cacheRef: CacheChannelRef = { profile: resolvedProfile, channel: 'session', channelId: sessionId };
          const localOlderRows = await this.deps.cacheService.readOlderRows(cacheRef, oldestRowId, 100);
          if (localOlderRows.length > 0) {
            const cachedBatch = sortByDisplayAsc(localOlderRows).map(toMessageViewModel);
            const before = state.messages.length;
            state.messages = planOlderBatchPrependMerge(cachedBatch, state.messages, { timelineSessionId: sessionId, fallbackSessionId: sessionId });
            const added = state.messages.length - before;
            if (added > 0) {
              let start = this.deps.getMessageWindowStart();
              if (preserveViewportWindow) {
                start = shiftWindowStartForPrepend(start, added, state.messages.length, MESSAGE_WINDOW_CAPACITY);
                if (!wasNearBottomBeforeLoad) {
                  this.deps.setMessageWindowUserExpanded(true);
                }
              } else {
                start = computeOlderBatchWindowStart(added, localOlderRows.length < 100, MESSAGE_WINDOW_CAPACITY);
                this.deps.setMessageWindowUserExpanded(true);
              }
              this.deps.setMessageWindowStart(start);
              const end = windowEndFor(start, state.messages.length, MESSAGE_WINDOW_CAPACITY, INITIAL_RENDER_WINDOW);
              this.deps.setMessageWindowEnd(end);
              this.deps.sessionMessagesCache.set(sessionId, state.messages);
              state.hasOlderMessages = true;
              batchAppended = true;
            }
          }
        // gate-degrade: 本地缓存读取失败或未命中时平滑回退到远端 REST 拉取
        } catch {}
      }

      let attempts = 0;
      const MAX_PAGE_ATTEMPTS = 8;

      for (const targetId of lineageChain) {
        if (batchAppended || attempts >= MAX_PAGE_ATTEMPTS) break;

        const cursorKey = `${sessionId}:${targetId}`;
        if (this.sessionServerOffset.get(`${cursorKey}:exhausted`) === 1) continue;

        while (attempts < MAX_PAGE_ATTEMPTS) {
          attempts += 1;

          const storedOffset = this.sessionParentOffsetMap.get(cursorKey)
            ?? (targetId === sessionId ? (this.sessionServerOffset.get(sessionId) ?? 0) : 0);

          const earliestLocalRowId = targetId === sessionId ? sessionEarliestRowId() : null;
          const floorSuppressed = this.sessionOvershootRetry.has(cursorKey);
          const { queryOffset } = planOlderPagination({
            storedOffset,
            localCoveredRows: targetId === sessionId && !floorSuppressed
              ? countLocalCoveredRows(state.messages, sessionId)
              : 0,
            returned: 0,
            batchRowIds: [],
            earliestLocalRowId,
          });

          const guarded = await runGuarded<SessionMessagesOutcome>(
            guard,
            () => ({ sessionId: state.activeSessionId, generation: this.activeLoadMessagesGeneration }),
            () => undefined,
            () => gatewayClient.fetchSessionMessages(targetId, {
              limit: OLDER_BATCH_PAGE_SIZE,
              offset: queryOffset,
              order: 'latest',
              profile: resolvedProfile,
              includeCompacted: true,
            }),
            this.deps.logSession,
          );
          if (guarded.status === 'discarded') {
            state.isLoadingOlder = false;
            this.deps.syncPromptNavigatorMeta();
            return;
          }
          const outcome = guarded.value;

          if (outcome.status !== 'success') {
            fetchFailed = true;
            break;
          }
          if (outcome.messages.length === 0) {
            const zeroPlan = planOlderZeroMessagesAction({
              isTargetSelf: targetId === sessionId,
              floorSuppressed,
              queryOffset,
              safeFallbackOffset: this.sessionAuthoritativeOffset.get(sessionId) ?? 0,
            });
            if (zeroPlan.action === 'retry-fallback') {
              this.sessionOvershootRetry.add(cursorKey);
              this.sessionParentOffsetMap.delete(cursorKey);
              this.sessionServerOffset.set(sessionId, zeroPlan.fallbackOffset);
              continue;
            }
            this.sessionServerOffset.set(`${cursorKey}:exhausted`, 1);
            break;
          }

          const returned = outcome.pagination?.returned ?? outcome.messages.length;

          const payload = outcome.messages.filter((m: SessionMessageRecord) => {
            if (typeof m.display_kind === 'string' && m.display_kind.length > 0) return true;
            const text = typeof m.content === 'string' ? m.content : '';
            return !text.startsWith('[CONTEXT COMPACTION');
          });
          const batch = this.parseRawMessages(payload);

          const before = state.messages.length;
          const mergeResult = planOlderBatchPrependMergeDetailed(batch, state.messages, {
            timelineSessionId: targetId,
            fallbackSessionId: sessionId,
          });
          const added = mergeResult.merged.length - before;

          if (shouldTreatOlderDropAsExhausted(added, batch.length, mergeResult.droppedCount)) {
            this.deps.logSession?.warn('older batch fully dropped by earlier-boundary filter', {
              sessionId,
              targetId,
              queryOffset,
              returned,
              dropped: mergeResult.droppedCount,
            });
            this.sessionServerOffset.set(`${cursorKey}:exhausted`, 1);
            break;
          }

          const batchRowIds = outcome.messages
            .map((m: SessionMessageRecord) => extractDurableRowId(m))
            .filter((id: unknown): id is number => typeof id === 'number');
          const cursorPlan = planOlderPagination({
            storedOffset: queryOffset,
            localCoveredRows: 0,
            returned,
            batchRowIds,
            earliestLocalRowId: targetId === sessionId ? earliestLocalRowId : null,
          });
          this.sessionParentOffsetMap.set(cursorKey, cursorPlan.nextOffset);
          if (targetId === sessionId) {
            this.sessionServerOffset.set(sessionId, cursorPlan.nextOffset);
            this.sessionAuthoritativeOffset.set(
              sessionId,
              Math.max(this.sessionAuthoritativeOffset.get(sessionId) || 0, cursorPlan.nextOffset),
            );
          }

          state.messages = mergeResult.merged;

          if (added <= 0) {
            if (returned < OLDER_BATCH_PAGE_SIZE) {
              this.sessionServerOffset.set(`${cursorKey}:exhausted`, 1);
              break;
            }
            continue;
          }

          let start = this.deps.getMessageWindowStart();
          if (preserveViewportWindow) {
            start = shiftWindowStartForPrepend(start, added, state.messages.length, MESSAGE_WINDOW_CAPACITY);
            if (!wasNearBottomBeforeLoad) {
              this.deps.setMessageWindowUserExpanded(true);
            }
          } else {
            start = computeOlderBatchWindowStart(
              added,
              returned < OLDER_BATCH_PAGE_SIZE,
              MESSAGE_WINDOW_CAPACITY,
            );
            this.deps.setMessageWindowUserExpanded(true);
          }
          this.deps.setMessageWindowStart(start);
          const end = windowEndFor(start, state.messages.length, MESSAGE_WINDOW_CAPACITY, INITIAL_RENDER_WINDOW);
          this.deps.setMessageWindowEnd(end);
          this.deps.sessionMessagesCache.set(sessionId, state.messages);

          if (targetId === sessionId) {
            const ownMessages = state.messages.filter((m) => !m.sessionId || m.sessionId === sessionId);
            this.deps.persistMessagesToCache(
              { profile: resolvedProfile, channel: 'session', channelId: sessionId },
              ownMessages.slice(-MESSAGE_CACHE_LIMIT),
              0,
            );
          }

          if (returned < OLDER_BATCH_PAGE_SIZE) {
            this.sessionServerOffset.set(`${cursorKey}:exhausted`, 1);
          }
          const remainingUnexhausted = lineageChain.some(
            (id) => this.sessionServerOffset.get(`${sessionId}:${id}:exhausted`) !== 1,
          );
          state.hasOlderMessages = returned >= OLDER_BATCH_PAGE_SIZE || remainingUnexhausted;
          batchAppended = true;
          break;
        }
      }

      if (batchAppended) {
        if (preserveViewportWindow) {
          this.deps.setCanvasStructureDirty?.(true);
          if (!wasNearBottomBeforeLoad) {
            this.deps.setSuppressPinBottomOnce?.(true);
          }
        }
        state.isLoadingOlder = false;
        render();
        this.deps.syncPromptNavigatorMeta();
        const reapplyAnchor = preserveViewportWindow && wasNearBottomBeforeLoad
          ? (): void => this.deps.applyStreamAnchor(anchor, true)
          : (): void => this.deps.applyStreamAnchor(anchor, false);
        reapplyAnchor();
        this.deps.syncPromptNavigatorFromScroll();
        if (typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(() => {
            reapplyAnchor();
            this.deps.syncPromptNavigatorFromScroll();
            requestAnimationFrame(reapplyAnchor);
          });
        }
        this.deps.logScroll?.debug('older batch prepended via element anchor', {
          totalLoaded: state.messages.length,
          ms: Math.round((performance.now() - startedAt) * 10) / 10,
        });
        return;
      }
    } catch (err) {
      console.warn('[Flux] loadOlderMessages failed:', err);
      fetchFailed = true;
    }

    const anyLineageRemaining = lineageChain.some(
      (id) => this.sessionServerOffset.get(`${sessionId}:${id}:exhausted`) !== 1,
    );
    if (!shouldKeepOlderMessagesAfterLoop({ fetchFailed, anyLineageRemaining })) {
      state.hasOlderMessages = false;
    }
    state.isLoadingOlder = false;
    this.deps.render();
    this.deps.syncPromptNavigatorMeta();
  }

  /** 将当前活动会话的最新真实消息与时间反哺给左侧栏对应的卡片实体 */
  syncActiveSessionPreviewToRail(sessionId: string, messages: MessageViewModel[], botName?: string): void {
    if (!sessionId || messages.length === 0) return;
    const state = this.deps.getState();

    const visibleMessages = messages.filter((m) => (m.displayKind ?? 'user') === 'user');
    if (visibleMessages.length === 0) return;

    // 1. 若当前会话为专职 Bot 的 Forever Chat，委托 core 领域逻辑更新
    const botRes = this.deps.botActivityStore.withActivityMap((activityMap) => syncActiveSessionToBot({
      sessionId,
      messages: visibleMessages,
      foreverChatCache: this.deps.botForeverChatCache,
      activeFocusBotName: state.activeFocus.type === 'bot' ? state.activeFocus.botName : undefined,
      profiles: state.profiles,
      activityMap,
      formatTime: this.deps.formatSessionTime,
    }));
    if (botRes) {
      state.profiles = botRes.profiles;
      this.deps.botActivityStore.persist();
    }

    // 2. 若为普通会话，更新该普通会话的预览与时间戳
    const sess = state.sessions.find((s) => s.id === sessionId && (!botName || s.botName === botName))
      || state.sessions.find((s) => s.id === sessionId);
    if (sess) {
      const lastMsg = visibleMessages[visibleMessages.length - 1];
      const lastText = (lastMsg.content || lastMsg.thought || '').slice(0, 100).replace(/\s+/g, ' ').trim();
      const rawTs = lastMsg.rawTimestamp ?? Date.now();
      if (lastText) {
        sess.preview = lastText;
        sess.timestamp = rawTs;
        sess.time = this.deps.formatSessionTime(rawTs);
        this.deps.sessionPreviewCache.set(sessionId, {
          lastActive: rawTs,
          text: lastText,
          botName: sess.botName,
        });
        this.deps.persistSessionPreviewCache();
      }
    }
  }
}

export function createMessageLoadingService(deps: MessageLoadingDeps): MessageLoadingService {
  return new MessageLoadingService(deps);
}
