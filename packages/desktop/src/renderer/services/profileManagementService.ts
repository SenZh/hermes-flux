/**
 * Hermes Flux 数字员工与 Profile 管理服务（Profile Management Service）
 *
 * 【设计意图 (Why)】
 *   将 Agent Profile 列表拉取、定时静默轮询、头像资产多级缓存与持久化、
 *   Bot 终身主工位（Forever Chat）并发预热、主工位 0ms 秒开切换（openBotChat）、
 *   以及全局 Profile 切换彻底从 index.ts 中解耦。
 *   使数字员工领域模型与主工位状态机脱离 DOM 运行，具备可单测性与单向依赖纯度。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 主工位预取时序：主工位预取（warmBotForeverChats）必须与头像拉取并行启动，
 *      任意一个头像请求慢或挂起绝不能阻塞 Forever Chat 缓存，否则首次点击 Agent 会掉回冷路径；
 *   2. 头像缓存与预取陷阱：严禁把预取放在头像缓存早退之后，否则第二次启动起预取被跳过；
 *   3. 终身主工位 0ms 瞬间秒开：内存缓存持有 Forever Chat ID 时瞬间切入；冷路径探查前必须先清空视口
 *      并置 messagesPhase = 'loading'，避免出现"新 Bot 标题 + 旧会话内容"闪烁并置；
 *   4. openBotChat 失败回退：冷路径解析失败时必须完整回退至进入前的焦点与 Profile，
 *      绝不能将用户困在空白工位或导致侧边栏选中错配；
 *   5. runGuarded 代际守卫：在异步拉取期间若用户已切换到其他 Bot 或会话，坚决丢弃迟到响应。
 *
 * 【约束与规则 (Rules)】
 *   1. 单向依赖：严禁反向 import index.js，所有外部状态读写与 UI 渲染通过 ProfileManagementDeps 注入；
 *   2. 严格类型约束：0 TS 报错，严禁使用 `as any`；
 *   3. 零文本写死：通知、错误提示通过 deps.t 国际化输出。
 */

import type { AppState } from '../state/appState.js';
import {
  type HermesGatewayClient,
  type AgentProfile,
  type FluxLogger,
  type GuardedRunLogger,
  ProfileService,
  applyEnteredRead,
  runGuarded,
} from '@hermes-flux/core';
import type { I18nKey, MessageViewModel } from '@hermes-flux/ui';
import { profilesDiffer } from '../profileRefresh.js';
import type { BotActivityStore } from '../persistence/botActivityStore.js';

export interface ProfileManagementDeps {
  readonly getState: () => AppState;
  readonly getGatewayClient: () => HermesGatewayClient | null;
  readonly render: () => void;
  readonly t: (key: I18nKey, params?: Record<string, string | number>) => string;
  readonly describeRpcError: (error: unknown) => string;
  readonly botActivityStore: BotActivityStore;
  readonly unreadBotNames: Set<string>;
  readonly activityTransitionTracker: { clear(type: 'bot' | 'group' | 'session', id: string): void };
  readonly sessionMessagesCache: Map<string, MessageViewModel[]>;
  readonly syncProfileLastMessages: () => void;
  readonly applyColdStartFocus: () => Promise<void>;
  readonly cancelColdStartFocus: () => void;
  readonly fetchSessions: () => Promise<void>;
  readonly fetchModelOptions: (options?: { clearNotice?: boolean }) => Promise<void>;
  readonly selectSession: (sessionId: string, options?: { preserveFocus?: boolean }) => Promise<void>;
  readonly openGroupRoom: (roomId: string) => Promise<void>;
  readonly restoreComposerFocus: () => void;
  readonly disarmRollbackOnLeave: () => void;
  readonly persistAgentsToCache: (profiles: AgentProfile[]) => void;
  readonly persistAvatarCache: () => void;
  readonly profileAvatarCache?: Map<string, string>;
  readonly botForeverChatCache?: Map<string, string>;
  readonly nextLoadMessagesGeneration: () => number;
  readonly getCurrentLoadMessagesGeneration: () => number;
  readonly logSession?: Pick<FluxLogger, 'debug'> | GuardedRunLogger;
  readonly setPendingScrollToBottom?: (pending: boolean) => void;
}

export interface ProfileManagementService {
  readonly botForeverChatCache: Map<string, string>;
  readonly profileAvatarCache: Map<string, string>;
  syncSessionBotDisplayNames(profiles: AgentProfile[]): void;
  fetchProfiles(options?: { refresh?: boolean }): Promise<void>;
  warmBotForeverChats(list: AgentProfile[], client: HermesGatewayClient): Promise<void>;
  startProfileAutoRefresh(): void;
  stopProfileAutoRefresh(): void;
  refreshProfilesFromServer(): Promise<void>;
  switchProfile(name: string): Promise<void>;
  openBotChat(botProfile: string): Promise<void>;
}

export function createProfileManagementService(deps: ProfileManagementDeps): ProfileManagementService {
  const profileService = new ProfileService();
  const botForeverChatCache = deps.botForeverChatCache ?? new Map<string, string>();
  const profileAvatarCache = deps.profileAvatarCache ?? new Map<string, string>();

  const PROFILE_REFRESH_INTERVAL_MS = 60_000;
  const PROFILE_REFRESH_MIN_GAP_MS = 15_000;
  let profileAutoRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let lastProfileRefreshAt = 0;
  let profileRefreshInFlight = false;
  let profileFetchGeneration = 0;

  function syncSessionBotDisplayNames(profiles: AgentProfile[]): void {
    const state = deps.getState();
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
    const client = deps.getGatewayClient();
    if (!client) return;
    const state = deps.getState();
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
      deps.persistAgentsToCache(list);
      syncSessionBotDisplayNames(list);
      deps.syncProfileLastMessages();
      deps.render();
      void deps.applyColdStartFocus();

      // 2. 已有头像只回填内存缓存；缺失的才向网关拉取 (profiles.get_asset)。
      for (const p of list) {
        if (!p.avatar) continue;
        profileAvatarCache.set(p.name.toLowerCase(), p.avatar);
        if (p.displayName) profileAvatarCache.set(p.displayName.toLowerCase(), p.avatar);
      }

      // 主工位预取必须与头像拉取并行启动：任意一个头像请求慢/挂起，都不能阻塞 Forever Chat 缓存
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
              deps.persistAvatarCache();

              // 同步将真实头像回填到会话列表中对应 Bot 的所有会话项，彻底消除占位图腾
              for (const s of state.sessions) {
                if (s.botName === p.name || (s.botDisplayName && s.botDisplayName === p.displayName)) {
                  s.botAvatar = finalUrl;
                }
              }
              deps.render();
            }
          } catch (e) {
            console.warn(`[Flux] profiles.get_asset failed for ${p.name}:`, e);
          }
        }),
      );

      if (profileTopologyChanged) void deps.fetchSessions();
    } catch (e) {
      console.warn('[Flux] fetchProfiles failed:', e);
      state.profilesPhase = 'ready';
      void deps.applyColdStartFocus();
      deps.render();
    }
  }

  async function warmBotForeverChats(
    list: AgentProfile[],
    client: HermesGatewayClient,
  ): Promise<void> {
    const queue = [...list];
    const worker = async (): Promise<void> => {
      for (;;) {
        const p = queue.shift();
        if (!p) return;
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
            deps.botActivityStore.updateLatestActivity(p.name, previewText, numTs);
            deps.render();
          }
        // gate-degrade: 单条主工位探测失败按跳过处理，不影响其余 Bot 资产渲染
        } catch {
          // 容错放行
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, () => worker()));
  }

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

  async function refreshProfilesFromServer(): Promise<void> {
    const client = deps.getGatewayClient();
    const state = deps.getState();
    if (!client || !state.gatewayConnected || profileRefreshInFlight) return;
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
    const state = deps.getState();
    if (!name || state.profileName === name) return;
    state.profileName = name;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('hermes_flux_profile', name);
      localStorage.setItem('hermes_aura_profile', name);
    }
    deps.render();
    await Promise.allSettled([deps.fetchSessions(), deps.fetchModelOptions()]);
  }

  async function openBotChat(botProfile: string): Promise<void> {
    const client = deps.getGatewayClient();
    if (!botProfile || !client) return;
    deps.cancelColdStartFocus();

    const state = deps.getState();
    const outgoingFocus = state.activeFocus;
    const outgoingSessionId = state.activeSessionId;
    const outgoingProfileName = state.profileName;
    const wasBotFocused = state.activeFocus.type === 'bot' && state.activeFocus.botName === botProfile;

    state.profileName = botProfile;
    deps.disarmRollbackOnLeave();
    state.activeFocus = { type: 'bot', botName: botProfile };
    const generation = deps.nextLoadMessagesGeneration();
    const guard = { sessionId: `bot:${botProfile}`, generation };
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('hermes_flux_profile', botProfile);
      localStorage.setItem('hermes_aura_profile', botProfile);
    }

    applyEnteredRead(deps.unreadBotNames, botProfile);
    deps.activityTransitionTracker.clear('bot', botProfile);

    // 1. 若内存缓存已持有该 Bot 的 Forever Chat ID，0ms 瞬间秒开切入！
    const cachedSessionId = botForeverChatCache.get(botProfile);
    if (cachedSessionId) {
      const alreadyMounted = state.activeSessionId === cachedSessionId
        && Boolean(state.activeLiveSessionId)
        && state.messages.length > 0;
      void deps.selectSession(cachedSessionId, { preserveFocus: true });
      void deps.fetchModelOptions({ clearNotice: true });
      if (alreadyMounted) {
        if (wasBotFocused) deps.restoreComposerFocus();
        deps.render();
      }
      return;
    }

    // 2. 首次探查前清空视口并进入 loading
    if (outgoingSessionId && state.messages.length > 0) {
      deps.sessionMessagesCache.set(outgoingSessionId, [...state.messages]);
    }
    state.messages = [];
    state.hasOlderMessages = false;
    state.isLoadingOlder = false;
    state.activeSessionId = '';
    state.activeLiveSessionId = '';
    state.messagesPhase = 'loading';
    if (deps.setPendingScrollToBottom) {
      deps.setPendingScrollToBottom(true);
    }
    deps.render();

    try {
      const guarded = await runGuarded(
        guard,
        () => ({
          sessionId: `bot:${state.activeFocus.type === 'bot' ? state.activeFocus.botName : ''}`,
          generation: deps.getCurrentLoadMessagesGeneration(),
        }),
        () => undefined,
        () => profileService.getOrCreateForeverChat(botProfile, client),
        deps.logSession,
      );
      if (guarded.status === 'discarded') return;
      const foreverChat = guarded.value;
      botForeverChatCache.set(botProfile, foreverChat.sessionId);

      if (state.activeFocus.type !== 'bot' || state.activeFocus.botName !== botProfile) return;
      state.activeFocus = { type: 'bot', botName: botProfile };
      await deps.selectSession(foreverChat.sessionId, { preserveFocus: true });
      if (state.activeFocus.type !== 'bot' || state.activeFocus.botName !== botProfile) return;
      state.activeFocus = { type: 'bot', botName: botProfile };
      deps.render();
    } catch (err) {
      if (deps.getCurrentLoadMessagesGeneration() !== guard.generation || state.activeFocus.type !== 'bot' || state.activeFocus.botName !== botProfile) return;
      console.error('[Flux] Failed to resolve Forever Chat for bot:', botProfile, err);
      state.dockNotice = deps.t('dock.enterBotChatFailed', { name: botProfile, error: deps.describeRpcError(err) });
      state.profileName = outgoingProfileName;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('hermes_flux_profile', outgoingProfileName);
        localStorage.setItem('hermes_aura_profile', outgoingProfileName);
      }
      if (outgoingFocus.type === 'session' && outgoingSessionId) {
        void deps.selectSession(outgoingSessionId);
      } else if (outgoingFocus.type === 'group') {
        void deps.openGroupRoom(outgoingFocus.roomId);
      } else if (outgoingFocus.type === 'bot') {
        const outgoingForeverId = botForeverChatCache.get(outgoingFocus.botName);
        if (outgoingForeverId) {
          state.activeFocus = { type: 'bot', botName: outgoingFocus.botName };
          void deps.selectSession(outgoingForeverId, { preserveFocus: true });
          deps.render();
        } else {
          state.messagesPhase = 'ready';
          deps.render();
        }
      } else {
        state.messagesPhase = 'ready';
        deps.render();
      }
      return;
    }

    void deps.fetchModelOptions({ clearNotice: true });
  }

  return {
    botForeverChatCache,
    profileAvatarCache,
    syncSessionBotDisplayNames,
    fetchProfiles,
    warmBotForeverChats,
    startProfileAutoRefresh,
    stopProfileAutoRefresh,
    refreshProfilesFromServer,
    switchProfile,
    openBotChat,
  };
}
