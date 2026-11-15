/**
 * Hermes Flux 会话生命周期与设置切换服务（Session Operation Service）
 *
 * 【设计意图 (Why)】
 *   将会话 CRUD（新建、删除、重命名）、列表状态切换（置顶、归档、导出、复制 ID）、
 *   激活会话切换与焦点移交（selectSession，含草稿暂存/恢复与挂起回滚安全解除）、
 *   模型与思考级别切换（switchModel, switchReasoning, switchApproval）及
 *   会话列表刷新防抖调度彻底从 index.ts 中解耦。
 *   使得复杂的会话生命周期与 RPC 调度逻辑能够脱离 DOM 运行，具备可单测性与单向依赖纯度。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. deleteSession 必须在改写 activeSessionId 之前触发 handleArmedOnDelete 与
 *      sessionListGeneration.invalidateForDelete，防止删除在途的迟滞快照复活已删会话，
 *      且防范挂起回滚快照泄漏或跨会话污染；
 *   2. createNewSession 创建成功前必须先行调用 disarmRollbackOnLeave(state.activeSessionId)，
 *      解除当前挂起回滚，并在切入后设置 isStreaming = activeStreamingStoredSessionId === handles.storedId；
 *   3. selectSession 必须在离开前保存草稿，切入后仅当用户尚未输入新文字时（Non-Destructive）
 *      才恢复旧草稿，等待消息返回后若用户已切走，坚决丢弃迟到的焦点与草稿；
 *   4. switchModel / switchReasoning 在群聊视口（activeFocus.type === 'group'）时绝对禁止向
 *      不存在的 session 发送 config.set，群聊模型由网关调度，否则网关返回 4001 session not found；
 *   5. exportMarkdown 必须过滤掉 displayKind === 'hidden' 的行，避免机器事件和交接文本被导出为用户发言。
 *
 * 【约束与规则 (Rules)】
 *   1. 单向依赖：严禁反向 import index.js，所有外部状态读写与 UI 渲染通过 SessionOperationDeps 注入；
 *   2. 严格类型约束：0 TS 报错，严禁使用 `as any`；
 *   3. 零文本写死：通知、错误与占位提示优先经由 `deps.t` 国际化字典输出。
 */

import type { AppState } from '../state/appState.js';
import type { HermesDesktopBridge } from '../../preload/index.js';
import {
  type HermesGatewayClient,
  type NormalizedSession,
  type SessionHandleRegistry,
  type CacheChannelRef,
  type CacheService,
  type AgentProfile,
  SessionLifecycleService,
  RpcErrorCode,
  readSessionHandles,
  toPendingSession,
  upsertSession,
  applyEnteredRead,
  reconcileSessionList,
  preserveRunningActivity,
  SessionListGeneration,
} from '@hermes-flux/core';
import type { I18nKey, MessageViewModel } from '@hermes-flux/ui';
import { planRollbackLeaveRestore } from '../rollbackTransaction.js';
import type { SessionDraftStore } from '../persistence/sessionDrafts.js';

export function rpcErrorCode(error: unknown): number | null {
  if (error instanceof Error && 'code' in error && typeof error.code === 'number') return error.code;
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'number') return error.code;
  return null;
}

export function describeRpcError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    if ('message' in error && typeof error.message === 'string') return error.message;
    if ('code' in error && typeof error.code === 'number') return `RPC error ${error.code}`;
  }
  return String(error);
}

export function isExtraInputsError(error: unknown): boolean {
  const msg = describeRpcError(error);
  return msg.includes('Extra inputs');
}

export interface SessionOperationDeps {
  readonly getState: () => AppState;
  readonly getGatewayClient: () => HermesGatewayClient | null;
  readonly getDesktopApi?: () => HermesDesktopBridge | undefined;
  readonly getCurrentTicket: () => string | null;
  readonly getEffectiveUrl: (url?: string) => string;
  readonly render: () => void;
  readonly t: (key: I18nKey, params?: Record<string, string | number>) => string;
  readonly showToast: (message: string, durationMs?: number) => void;
  readonly setTimedDockNotice: (notice: string, durationMs?: number) => void;
  readonly restoreComposerFocus: () => void;

  readonly sessionDrafts: SessionDraftStore;
  readonly sessionMessagesCache: Map<string, MessageViewModel[]>;
  readonly unreadSessionIds: Set<string>;
  readonly activeRunningSessionIds: Set<string>;
  readonly activityTransitionTracker: { clear: (type: 'session' | 'group' | 'bot', id: string) => void };
  readonly sessionHandleRegistry: SessionHandleRegistry;
  readonly cacheService: CacheService;
  readonly persistSessionsToCache: (sessions: NormalizedSession[]) => void;
  readonly forgetOlderCursorState: (sessionId: string) => void;
  readonly sessionListGeneration: { invalidateForDelete: () => void };

  // 流式管理相关
  readonly getActiveStreamingStoredSessionId: () => string | null;
  readonly resetActiveStreamingState: () => void;

  // 视口与滚动控制
  readonly setPendingScrollToBottom: (val: boolean) => void;
  readonly setLastMessagesSnapshot: (val: unknown) => void;

  // 跨服务联动
  readonly loadMessages: (sessionId: string, targetBotName?: string) => Promise<void>;
  readonly openBotChat: (botName: string) => Promise<void>;
  readonly ensureLiveSessionId: () => Promise<string>;
  readonly fetchSessions?: () => Promise<void>;
  readonly incrementActiveLoadMessagesGeneration?: () => number;
  readonly sessionPreviewCache?: Map<string, { lastActive: number; text: string; botName?: string }>;
  readonly formatSessionTime?: (ts: number) => string;
  readonly resolveAgentAvatar?: (name?: string) => string;
  readonly syncProfileLastMessages?: () => void;
  readonly logSessionWarn?: (msg: string, meta?: Record<string, unknown>) => void;
  readonly logSessionDebug?: (msg: string, meta?: Record<string, unknown>) => void;

  // 可选 DOM/环境抽象（便于脱离 DOM 纯逻辑单测）
  readonly getPromptInputValue?: () => string;
  readonly setPromptInputValue?: (val: string) => void;
  readonly focusPromptInput?: () => void;
  readonly promptDialog?: (title: string, defaultVal: string) => string | null;
  readonly writeClipboardText?: (text: string) => Promise<void>;
  readonly storage?: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
  };
}

export class SessionOperationService {
  private sessionsRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: SessionOperationDeps) {}

  /** 离开当前会话前解除挂起回滚：把被乐观裁撤的历史恢复到该会话缓存，防止横幅跨会话泄漏与快照污染 */
  disarmRollbackOnLeave(outgoingSessionId?: string): void {
    const state = this.deps.getState();
    const armed = state.rollbackArmed;
    if (!armed) return;
    const plan = planRollbackLeaveRestore(armed, outgoingSessionId ?? state.activeSessionId);
    state.rollbackArmed = null;
    if (plan) {
      this.deps.sessionMessagesCache.set(plan.restoreSessionId, plan.restore);
    }
  }

  /**
   * 删除会话时的挂起回滚处置（主路径与 4007 快速清理分支共用）。
   * 被删会话正是持有 armed 的会话：会话将消失，直接丢弃 armed，不往被删缓存回写；
   * 否则按离开语义处理（armed 属于别的会话时 planRollbackLeaveRestore 返回 null，仅丢弃）。
   */
  handleArmedOnDelete(id: string): void {
    const state = this.deps.getState();
    if (state.rollbackArmed && state.rollbackArmed.sessionId === id) {
      state.rollbackArmed = null;
      return;
    }
    this.disarmRollbackOnLeave(id);
  }

  /** 创建新会话 */
  async createNewSession(options?: { profile?: string; projectId?: string; title?: string }): Promise<void> {
    const gatewayClient = this.deps.getGatewayClient();
    const state = this.deps.getState();

    if (!gatewayClient) {
      this.deps.setTimedDockNotice('Gateway not connected, cannot create session');
      this.deps.render();
      return;
    }

    const targetProfile = options?.profile || state.profileName || 'default';
    const targetTitle = options?.title || this.deps.t('chat.defaultTaskTitle');
    const targetProjectId = options?.projectId;

    let targetCwd: string | undefined;
    if (targetProjectId) {
      const proj = state.projects.find((p) => p.id === targetProjectId);
      if (proj?.path) targetCwd = proj.path;
    }

    // Preserve draft for current session before creating new
    const currentInputVal = this.getInputValue();
    if (state.activeSessionId && currentInputVal !== undefined) {
      this.deps.sessionDrafts.set(state.activeSessionId, currentInputVal);
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
        this.deps.setTimedDockNotice('Gateway did not return new session handle');
        this.deps.render();
        return;
      }
      this.deps.sessionHandleRegistry.register(handles);

      // 切到新会话前解除旧会话挂起回滚（P0-2 防横幅泄漏与快照丢失），必须在改写 activeSessionId 之前
      this.disarmRollbackOnLeave(state.activeSessionId);
      state.profileName = targetProfile;
      state.activeSessionId = handles.storedId;
      state.activeLiveSessionId = handles.liveId;
      state.activeFocus = { type: 'session', sessionId: handles.storedId };
      state.messages = [];
      this.deps.sessionMessagesCache.set(handles.storedId, []);
      state.dockNotice = '';
      state.modelMenuOpen = false;

      // Reset streaming indicators for the newly focused session
      state.isStreaming = this.deps.getActiveStreamingStoredSessionId() === handles.storedId;

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

      this.deps.setPendingScrollToBottom(true);
      this.deps.render();

      // Clear input for the new clean session
      this.setInputValue('');
      this.focusInput();

      // Apply the model the user picked before the session existed.
      if (state.selectedModel) {
        await this.applyModelToLiveSession(state.selectedModel);
      }
    } catch (e) {
      console.error('[Hermes Gateway] Create session failed:', e);
      this.deps.setTimedDockNotice(`Create session failed: ${describeRpcError(e)}`);
      this.deps.render();
    }
  }

  /** 删除会话 */
  async deleteSession(id: string): Promise<void> {
    const gatewayClient = this.deps.getGatewayClient();
    const state = this.deps.getState();
    if (!gatewayClient || !id) return;

    this.deps.sessionListGeneration.invalidateForDelete();

    const targetSession = state.sessions.find((s) => s.id === id);
    const targetProfiles = new Set<string>();
    if (targetSession?.botName) targetProfiles.add(targetSession.botName);
    if (state.profileName) targetProfiles.add(state.profileName);
    targetProfiles.add('default');
    for (const p of state.profiles) {
      if (p.name) targetProfiles.add(p.name);
    }

    const desktopApi = this.deps.getDesktopApi?.();

    try {
      const lifecycle = new SessionLifecycleService({
        rpc: gatewayClient,
        platformBridge: desktopApi,
        restFallback: async (path, options) => {
          if (!desktopApi?.httpProxy) throw new Error('Desktop REST proxy is unavailable');
          return await desktopApi.httpProxy({
            baseUrl: this.deps.getEffectiveUrl(state.gatewayUrl),
            path,
            method: options?.method,
            ticket: this.deps.getCurrentTicket() ?? '',
            params: options?.params,
            body: options?.body,
          });
        },
        baseUrl: () => this.deps.getEffectiveUrl(state.gatewayUrl),
        ticket: () => this.deps.getCurrentTicket() ?? '',
      });
      const outcome = await lifecycle.deleteSession(id, [...targetProfiles]);
      for (const failedProfile of outcome.failedProfiles) {
        console.warn('[Flux] Session deletion failed for profile:', failedProfile);
      }
      if (outcome.status === 'failed') throw new Error(`Delete failed for profiles: ${outcome.failedProfiles.join(', ')}`);

      state.sessions = state.sessions.filter((s) => !outcome.pruneIds.includes(s.id));
      state.pendingSessionIds = state.pendingSessionIds.filter((pid) => pid !== id);
      this.deps.sessionMessagesCache.delete(id);
      this.deps.forgetOlderCursorState(id);
      this.deps.sessionDrafts.delete(id);
      this.deps.unreadSessionIds.delete(id);
      this.deps.activeRunningSessionIds.delete(id);
      this.deps.activityTransitionTracker.clear('session', id);
      this.deps.sessionHandleRegistry.unregister(id);

      // 持久化缓存清理：清空该会话在 IndexedDB 中的消息通道并持久化最新索引
      const deleteCacheRef: CacheChannelRef = {
        profile: targetSession?.botName || state.profileName || 'default',
        channel: 'session',
        channelId: id,
      };
      void this.deps.cacheService.dropChannel(deleteCacheRef).catch(() => undefined);
      this.deps.persistSessionsToCache(state.sessions);

      // 如果被删除的会话正在流式运行，安全重置流式看门狗与标志，彻底杜绝输入框被全局 isStreaming 锁死
      if (this.deps.getActiveStreamingStoredSessionId() === id) {
        this.deps.resetActiveStreamingState();
      }

      if (state.activeSessionId === id) {
        this.handleArmedOnDelete(id);
        state.activeSessionId = state.sessions[0]?.id || '';
        state.activeLiveSessionId = '';
        if (state.activeSessionId) {
          await this.selectSession(state.activeSessionId);
        } else {
          // 当删除最后一条会话导致会话池为空时，干净平滑回退至默认智能体工位，拉取并激活 Forever Chat 终身会话通道
          const targetBot = state.profileName || 'default';
          await this.deps.openBotChat(targetBot);
        }
      } else {
        this.deps.render();
      }

      // 焦点重连保护：强力恢复输入舱光标与焦点，确保键盘可立即键入
      this.deps.restoreComposerFocus();
    } catch (e: unknown) {
      console.error('[Hermes Gateway] Delete session failed:', e);
      const msg = describeRpcError(e);
      if (rpcErrorCode(e) === RpcErrorCode.SessionMissing) {
        state.sessions = state.sessions.filter((s) => s.id !== id);
        state.pendingSessionIds = state.pendingSessionIds.filter((pid) => pid !== id);
        this.deps.sessionMessagesCache.delete(id);
        this.deps.forgetOlderCursorState(id);
        this.deps.sessionDrafts.delete(id);
        this.deps.unreadSessionIds.delete(id);
        this.deps.activeRunningSessionIds.delete(id);
        this.deps.activityTransitionTracker.clear('session', id);
        if (this.deps.getActiveStreamingStoredSessionId() === id) {
          this.deps.resetActiveStreamingState();
        }
        if (state.activeSessionId === id) {
          this.handleArmedOnDelete(id);
          state.activeSessionId = state.sessions[0]?.id || '';
          state.activeLiveSessionId = '';
          if (state.activeSessionId) {
            await this.selectSession(state.activeSessionId);
          } else {
            const targetBot = state.profileName || 'default';
            await this.deps.openBotChat(targetBot);
          }
        } else {
          this.deps.render();
        }
        this.deps.restoreComposerFocus();
        return;
      }
      state.dockNotice = `Delete session failed: ${msg}`;
      this.deps.render();
      this.deps.restoreComposerFocus();
    }
  }

  /** 重命名会话 */
  async renameSession(id: string, currentTitle: string): Promise<void> {
    const gatewayClient = this.deps.getGatewayClient();
    const state = this.deps.getState();

    let newTitle: string | null = null;
    if (this.deps.promptDialog) {
      newTitle = this.deps.promptDialog('Rename session', currentTitle);
    } else if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
      newTitle = window.prompt('Rename session', currentTitle);
    }

    if (!newTitle || newTitle.trim() === '' || newTitle.trim() === currentTitle) return;
    const trimmed = newTitle.trim();

    try {
      if (gatewayClient) {
        await gatewayClient.call('session.title', { session_id: id, title: trimmed });
      }
      state.sessions = state.sessions.map((s) => (s.id === id ? { ...s, title: trimmed } : s));
      this.deps.render();
    } catch {
      // Optimistically update locally even if server returns error
      state.sessions = state.sessions.map((s) => (s.id === id ? { ...s, title: trimmed } : s));
      this.deps.render();
    }
  }

  /** 复制会话 ID */
  async copySessionId(id: string): Promise<void> {
    try {
      if (this.deps.writeClipboardText) {
        await this.deps.writeClipboardText(id);
      } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(id);
      } else {
        throw new Error('Clipboard not supported');
      }
      this.deps.showToast(this.deps.t('toast.copied'));
    } catch {
      this.deps.showToast(id);
    }
  }

  /** 置顶会话 */
  async pinSession(id: string): Promise<void> {
    const state = this.deps.getState();
    const target = state.sessions.find((s) => s.id === id);
    if (!target) return;
    state.sessions = [target, ...state.sessions.filter((s) => s.id !== id)];
    this.deps.showToast(this.deps.t('toast.pinned', { title: target.title }));
    this.deps.render();
  }

  /** 导出会话 Markdown 历史 */
  async exportMarkdown(id: string): Promise<void> {
    const state = this.deps.getState();
    const activeTitle = state.sessions.find((s) => s.id === id)?.title || 'session';
    const mdContent = state.messages
      // 【规则】导出口径与视图一致：hidden 行不导出，时间线事件单独标注
      .filter((m) => (m.displayKind ?? 'user') !== 'hidden')
      .map((m) => {
        const kind = m.displayKind ?? 'user';
        const header = kind !== 'user'
          ? `### Event (${kind})`
          : m.role === 'user' ? '### User' : `### Assistant (${state.profileName || 'Agent'})`;
        return `${header} - ${m.timestamp}\n\n${m.thought ? `> Thought:\n> ${m.thought.replace(/\n/g, '\n> ')}\n\n` : ''}${m.content}\n`;
      })
      .join('\n---\n\n');

    try {
      if (this.deps.writeClipboardText) {
        await this.deps.writeClipboardText(mdContent);
      } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(mdContent);
      } else {
        throw new Error('Clipboard not supported');
      }
      this.deps.showToast(this.deps.t('toast.exported', { title: activeTitle }));
    } catch {
      this.deps.showToast(this.deps.t('toast.exportFailed'));
    }
  }

  /** 归档或取消归档会话 */
  async archiveSession(id: string): Promise<void> {
    const gatewayClient = this.deps.getGatewayClient();
    const state = this.deps.getState();
    try {
      if (gatewayClient) {
        await gatewayClient.call('session.archive', { session_id: id });
      }
    } catch (archiveErr) {
      // gate-degrade: 归档为乐观更新，RPC 失败时仍按用户意图切换本地状态，但必须留下证据
      console.warn('[Flux] session.archive failed, applying optimistic local toggle:', archiveErr);
    }
    state.sessions = state.sessions.map((s) => (s.id === id ? { ...s, isArchived: !s.isArchived } : s));
    state.dockNotice = 'Session archive status updated';
    this.deps.render();
  }

  /** 激活选中会话并加载消息 */
  async selectSession(id: string, options?: { preserveFocus?: boolean; botName?: string }): Promise<void> {
    if (!id) return;
    const state = this.deps.getState();
    if (state.activeSessionId === id && state.activeLiveSessionId && state.messages.length > 0) return;

    // Preserve draft & message snapshot for outgoing session
    const currentInputVal = this.getInputValue();
    if (state.activeSessionId && state.activeSessionId !== id) {
      if (currentInputVal !== undefined) {
        this.deps.sessionDrafts.set(state.activeSessionId, currentInputVal);
      }
      if (state.rollbackArmed && state.rollbackArmed.sessionId === state.activeSessionId) {
        this.disarmRollbackOnLeave();
      } else if (state.messages.length > 0) {
        this.deps.sessionMessagesCache.set(state.activeSessionId, [...state.messages]);
      }
    }

    state.activeSessionId = id;
    state.activeLiveSessionId = ''; // must be re-resolved through session.resume
    this.deps.incrementActiveLoadMessagesGeneration?.();
    applyEnteredRead(this.deps.unreadSessionIds, id);
    this.deps.activityTransitionTracker.clear('session', id);
    state.modelMenuOpen = false;

    // 严格更新互斥单焦点：仅当未要求保持焦点时，更新为普通会话焦点
    if (!options?.preserveFocus) {
      state.activeFocus = { type: 'session', sessionId: id };
    }

    // Sync isStreaming with the target session
    state.isStreaming = this.deps.getActiveStreamingStoredSessionId() === id;

    // Force reset messages snapshot to re-bind reactive DOM for streaming
    this.deps.setLastMessagesSnapshot(null);

    await this.deps.loadMessages(id, options?.botName);

    // 【竞态守卫 (Rules)】等待历史期间用户可能已经切走：迟到的会话绝对不得把草稿与焦点写进新会话的输入框。
    if (state.activeSessionId !== id) return;

    // Restore draft for incoming session without clobbering live typing
    const restoredCurrent = this.getInputValue();
    if (restoredCurrent !== undefined) {
      // 【非破坏性草稿恢复 (Non-Destructive Draft Restoration)】
      // 若用户在网络加载期间已在输入框敲入文字，绝对禁止用空草稿冲刷抹除实时输入！
      if (!restoredCurrent.trim() && this.deps.sessionDrafts.has(id)) {
        this.setInputValue(this.deps.sessionDrafts.get(id) || '');
      }
    }

    // 会话切换完成且未处于流式态时恢复输入舱光标与焦点
    if (!state.isStreaming) {
      this.deps.restoreComposerFocus();
    }
  }

  /** 将所选模型推送到活动实时会话 */
  async applyModelToLiveSession(model: string, _provider?: string): Promise<void> {
    const gatewayClient = this.deps.getGatewayClient();
    const state = this.deps.getState();
    if (!gatewayClient || !model) return;

    const liveId = await this.deps.ensureLiveSessionId();
    if (!liveId) return;

    try {
      // 【网关契约约束】config.set 只接受 [profile, key, value, session_id, scope, confirm_expensive_model]
      // 严禁附加顶层 provider 字段
      await gatewayClient.call('config.set', {
        session_id: liveId,
        key: 'model',
        value: model,
      });
    } catch (e) {
      state.dockNotice = `Switch model failed: ${describeRpcError(e)}`;
      this.deps.render();
    }
  }

  /** 切换全局/当前会话模型 */
  async switchModel(model: string, provider?: string): Promise<void> {
    if (!model) return;
    const state = this.deps.getState();
    const gatewayClient = this.deps.getGatewayClient();

    const previous = state.selectedModel;
    state.selectedModel = model;
    if (provider) state.currentProvider = provider;
    state.modelMenuOpen = false;
    state.dockNotice = '';

    // Update recent models list (keep top 8, persist in localStorage)
    state.recentModels = [model, ...state.recentModels.filter((m) => m !== model)].slice(0, 8);
    const storage = this.getStorage();
    if (storage) {
      storage.setItem('hermes_flux_recent_models', JSON.stringify(state.recentModels));
      storage.setItem('hermes_aura_recent_models', JSON.stringify(state.recentModels));
    }

    this.deps.render();

    if (previous === model && !provider) return;

    if (!gatewayClient || !state.activeSessionId) {
      // No live conversation yet: the choice is applied right after session.create.
      return;
    }

    // 【规则 (Rules)】群聊视口中切换模型仅更新选择器状态与近期偏好，禁止向不存在的 session 发送 config.set
    if (state.activeFocus.type === 'group') {
      return;
    }

    const liveId = await this.deps.ensureLiveSessionId();
    if (!liveId) {
      state.selectedModel = previous;
      state.dockNotice = 'Cannot switch model: live session channel unavailable';
      this.deps.render();
      return;
    }

    try {
      await gatewayClient.call('config.set', {
        session_id: liveId,
        key: 'model',
        value: model,
      });
    } catch (e) {
      state.selectedModel = previous;
      state.dockNotice = `Switch model failed: ${describeRpcError(e)}`;
      this.deps.render();
    }
  }

  /** 切换思考级别 */
  async switchReasoning(effort: AppState['reasoningLevel']): Promise<void> {
    const state = this.deps.getState();
    const gatewayClient = this.deps.getGatewayClient();

    state.reasoningLevel = effort;
    this.deps.render();

    if (!gatewayClient || !state.activeSessionId) return;
    if (state.activeFocus.type === 'group') return;

    const liveId = await this.deps.ensureLiveSessionId();
    if (!liveId) {
      state.dockNotice = 'Cannot set reasoning: live session channel unavailable';
      this.deps.render();
      return;
    }

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
      state.dockNotice = `Set reasoning failed: ${describeRpcError(e)}`;
    }
    this.deps.render();
  }

  /** 切换工具审批策略 */
  async switchApproval(mode: 'manual' | 'smart' | 'off'): Promise<void> {
    const state = this.deps.getState();
    const gatewayClient = this.deps.getGatewayClient();

    state.approvalMode = mode;
    this.deps.render();

    if (!gatewayClient || !state.activeSessionId) return;

    const liveId = await this.deps.ensureLiveSessionId();
    if (!liveId) {
      state.dockNotice = 'Cannot set approval mode: live session channel unavailable';
      this.deps.render();
      return;
    }

    try {
      await gatewayClient.call('config.set', {
        session_id: liveId,
        key: 'approval_mode',
        value: mode,
      });
      state.dockNotice = '';
    } catch (e) {
      state.dockNotice = `Set approval mode failed: ${describeRpcError(e)}`;
    }
    this.deps.render();
  }

  /** 会话变更防抖聚合刷新调度 */
  scheduleSessionsRefresh(delayMs = 180): void {
    if (this.sessionsRefreshTimer) clearTimeout(this.sessionsRefreshTimer);
    this.sessionsRefreshTimer = setTimeout(() => {
      this.sessionsRefreshTimer = null;
      void this.fetchSessions();
    }, delayMs);
  }

  private enrichPreviewGeneration = 0;

  persistSessionPreviewCache(): void {
    try {
      const storage = this.getStorage();
      if (!storage || !this.deps.sessionPreviewCache) return;
      const obj: Record<string, { lastActive: number; text: string; botName?: string }> = {};
      for (const [k, v] of this.deps.sessionPreviewCache.entries()) {
        obj[k] = v;
      }
      storage.setItem('hermes_flux_session_preview_cache', JSON.stringify(obj));
    // gate-degrade: 会话副标题持久化失败可降级
    } catch {}
  }

  async enrichVisibleSessionPreviews(): Promise<void> {
    const client = this.deps.getGatewayClient();
    if (!client || !this.deps.sessionPreviewCache) return;
    const gen = ++this.enrichPreviewGeneration;
    const state = this.deps.getState();

    const currentBot = state.profileName || 'default';
    const targets = state.sessions
      .filter((s) => !s.isArchived && !s.hidden && (s.botName === currentBot || (!s.botName && currentBot === 'default')))
      .filter((s) => {
        const cached = this.deps.sessionPreviewCache!.get(s.id);
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
            this.deps.sessionPreviewCache!.set(t.id, {
              lastActive: t.timestamp,
              text: last.text,
              botName: t.botName,
            });
          }
        // gate-degrade: 会话预览单条拉取失败平滑跳过
        } catch {}
      })
    );

    if (gen !== this.enrichPreviewGeneration || updates.size === 0) return;
    this.persistSessionPreviewCache();

    let changed = false;
    state.sessions = state.sessions.map((s) => {
      const upd = updates.get(s.id);
      if (upd && s.preview !== upd.text) {
        changed = true;
        return { ...s, preview: upd.text };
      }
      return s;
    });

    if (changed && gen === this.enrichPreviewGeneration) {
      this.deps.syncProfileLastMessages?.();
      this.deps.persistSessionsToCache(state.sessions);
      this.deps.render();
    }
  }

  async fetchSessions(): Promise<void> {
    if (this.deps.fetchSessions) {
      return this.deps.fetchSessions();
    }
    const client = this.deps.getGatewayClient();
    if (!client) return;
    const state = this.deps.getState();

    const currentGen = this.deps.sessionListGeneration instanceof SessionListGeneration
      ? this.deps.sessionListGeneration.beginFetch()
      : 0;

    // 1. 若 profiles 尚未拉取，先动态拉取全量网关 Profile 列表
    if (state.profiles.length === 0) {
      try {
        state.profiles = await client.listProfiles();
        state.profilesPhase = 'ready';
      // gate-degrade: 会话列表内联 Profile 拉取失败降级到后续主刷新
      } catch {}
    }

    const targetProfiles = new Set<string>(['default']);
    if (state.profileName) targetProfiles.add(state.profileName);
    for (const p of state.profiles) {
      if (p.name) targetProfiles.add(p.name);
    }

    const profileMap = new Map<string, AgentProfile>();
    for (const p of state.profiles) {
      profileMap.set(p.name, p);
    }

    const results = await Promise.allSettled(
      Array.from(targetProfiles).map(async (profName) => {
        const outcome = await client.listSessions(profName, 100);
        if (!outcome.ok || !outcome.sessions) {
          return { ok: false, profile: profName, error: outcome.error ?? 'unknown error', sessions: [] as NormalizedSession[] };
        }
        const prof = profileMap.get(profName);
        const sessions = outcome.sessions.map((s) => {
          const botName = s.botName || profName;
          const matchingProfile = profileMap.get(botName) || prof;
          const timeWithDate = (this.deps.formatSessionTime ? this.deps.formatSessionTime(s.timestamp) : '') || s.time;
          const resolvedAvatar = matchingProfile?.avatar || (this.deps.resolveAgentAvatar ? this.deps.resolveAgentAvatar(botName) || this.deps.resolveAgentAvatar(profName) : '') || '';
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

    if (this.deps.sessionListGeneration instanceof SessionListGeneration && !this.deps.sessionListGeneration.mayCommit(currentGen)) {
      return;
    }

    const settled = results.map((r) =>
      r.status === 'fulfilled'
        ? r.value
        : { ok: false, profile: 'unknown', error: String(r.reason), sessions: [] as NormalizedSession[] }
    );
    const authoritative = settled.every((r) => r.ok);

    if (!authoritative) {
      this.deps.logSessionWarn?.('session list partially failed', {
        profiles: settled.filter((r) => !r.ok).map((r) => ({ profile: r.profile, error: r.error })),
      });
    }

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
    state.sessionsPhase = 'ready';
    if (authoritative) this.deps.persistSessionsToCache(reconciled.sessions);

    if (this.deps.activeRunningSessionIds.size > 0) {
      state.sessions = preserveRunningActivity(state.sessions, previousSessions, this.deps.activeRunningSessionIds);
    }

    if (reconciled.dropped.length > 0) {
      this.deps.logSessionDebug?.('session dedupe report', {
        dropped: reconciled.dropped.length,
        samples: reconciled.dropped.slice(0, 5),
      });
    }
    if (reconciled.pruned.length > 0) {
      this.deps.logSessionDebug?.('session superseded by authority', {
        pruned: reconciled.pruned.length,
        samples: reconciled.pruned.slice(0, 5),
      });
    }

    if (authoritative) {
      state.sessionListError = '';
    } else if (!state.sessionListError) {
      state.sessionListError = this.deps.t('rail.errorSub');
    }

    if (this.deps.sessionPreviewCache) {
      for (const s of state.sessions) {
        const cachedPrev = this.deps.sessionPreviewCache.get(s.id);
        if (cachedPrev && cachedPrev.text) {
          const tsDiff = Math.abs((s.timestamp || 0) - (cachedPrev.lastActive || 0));
          if (tsDiff < 1000 || (cachedPrev.lastActive || 0) >= (s.timestamp || 0)) {
            s.preview = cachedPrev.text;
          }
        }
      }
    }

    this.deps.render();
    void this.enrichVisibleSessionPreviews();
  }

  /** 获取当前输入框内容（支持纯单测 mock） */
  private getInputValue(): string | undefined {
    if (this.deps.getPromptInputValue) {
      return this.deps.getPromptInputValue();
    }
    if (typeof document !== 'undefined') {
      const el = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
      return el ? el.value : undefined;
    }
    return undefined;
  }

  /** 设置输入框内容（支持纯单测 mock） */
  private setInputValue(val: string): void {
    if (this.deps.setPromptInputValue) {
      this.deps.setPromptInputValue(val);
      return;
    }
    if (typeof document !== 'undefined') {
      const el = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
      if (el) el.value = val;
    }
  }

  /** 聚焦输入框（支持纯单测 mock） */
  private focusInput(): void {
    if (this.deps.focusPromptInput) {
      this.deps.focusPromptInput();
      return;
    }
    if (typeof document !== 'undefined') {
      const el = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
      el?.focus();
    }
  }

  /** 获取 LocalStorage 引用（支持纯单测 mock） */
  private getStorage(): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } | null {
    if (this.deps.storage) return this.deps.storage;
    if (typeof localStorage !== 'undefined') return localStorage;
    return null;
  }
}

export function createSessionOperationService(deps: SessionOperationDeps): SessionOperationService {
  return new SessionOperationService(deps);
}
