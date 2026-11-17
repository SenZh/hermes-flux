/**
 * Hermes Flux 群聊研讨室运维服务（Group Operation Service）
 *
 * 【设计意图 (Why)】
 *   将群聊房间生命周期（拉取列表、进入房间、群聊日志拉取与回读、说话者在场推导、
 *   未读管理与轮询状态调度）彻底从 index.ts 中解耦。
 *   使多智能体协同研讨室状态机能够脱离宿主 DOM 运行，具备可单测性与单向依赖纯度。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 权威门（Failure Is Not Empty）：只有 groups.list 完整成功才允许覆盖列表与写缓存；
 *      失败时保留既有群聊，避免一次弱网抖动把整列群聊清空；
 *   2. 群聊说话者推导（syncActiveGroupSpeakerFromMessages）：必须基于末条 assistant 消息的
 *      senderProfile 推导，严禁使用 groups.send 的人类发送者当作在场 Agent，
 *      且必须经由 core 的 resolveGroupSpeaker 归一化为房间成员名称，防止未知名称全量降级；
 *   3. 换房间必须先行调用 disarmRollbackOnLeave() 解除普通会话的挂起回滚横幅，防止跨域泄漏；
 *   4. 切换房间时必须清空 activeGroupSpeaker 并重置线程上下文（resetActiveGroupThread），
 *      避免上一个房间的成员在新房间被错误高亮，或跨房间复用 thread_id 造成死锁；
 *   5. runGuarded 代际守卫：在异步拉取 groups.log 期间若用户已切换到其他房间或会话，
 *      坚决丢弃迟到响应，防止会话错配与幽灵内容覆盖。
 *
 * 【约束与规则 (Rules)】
 *   1. 单向依赖：严禁反向 import index.js，所有外部状态读写与 UI 渲染通过 GroupOperationDeps 注入；
 *   2. 严格类型约束：0 TS 报错，严禁使用 `as any`；
 *   3. 零文本写死：系统通知与欢迎提示统一走 deps.t。
 */

import type { AppState } from '../state/appState.js';
import {
  type HermesGatewayClient,
  type GroupMessageEntry,
  type FluxLogger,
  type GuardedRunLogger,
  GroupRoomStore,
  resolveGroupSpeaker,
  applyEnteredRead,
  captureGroupLogBaseline,
  runGuarded,
} from '@hermes-flux/core';
import type { I18nKey, MessageViewModel, LeftRailGroupRoom } from '@hermes-flux/ui';

export type GroupAnchorCapturer = () => unknown;

export type SessionEnterBeginHook = (sessionId: string, options?: { forcePinToBottom?: boolean }) => void;

export interface GroupOperationDeps {
  readonly getState: () => AppState;
  readonly getGatewayClient: () => HermesGatewayClient | null;
  readonly render: () => void;
  readonly t: (key: I18nKey, params?: Record<string, string | number>) => string;
  readonly disarmRollbackOnLeave: () => void;
  readonly unreadGroupRoomIds: Set<string>;
  readonly activeRunningGroupRoomIds: Set<string>;
  readonly activityTransitionTracker: { clear(type: 'bot' | 'group' | 'session', id: string): void };
  readonly turnExecutionService: {
    resetActiveGroupThread(): void;
    syncGroupRoomLogsToState(roomId: string, logs: readonly GroupMessageEntry[]): void;
    refreshGroupRoomLog(roomId: string): Promise<number>;
    sendGroupMessage(roomId: string, text: string): Promise<void>;
  };
  readonly groupPollerManager: {
    isPolling(roomId: string): boolean;
    startAwaitReply(roomId: string, baseline: ReturnType<typeof captureGroupLogBaseline>): void;
    stop(roomId: string): void;
    stopAll(): void;
  };
  readonly persistGroupsToCache: (rooms: LeftRailGroupRoom[]) => void;
  readonly resolveAgentAvatar: (name: string) => string;
  readonly formatTimestamp: (ts: number | string) => string;
  readonly nextLoadMessagesGeneration: () => number;
  readonly getCurrentLoadMessagesGeneration: () => number;
  readonly logSession?: Pick<FluxLogger, 'debug'> | GuardedRunLogger;
  readonly setPendingScrollToBottom?: (pending: boolean) => void;
  beginSessionEnter?: SessionEnterBeginHook;
  captureStreamAnchor?: GroupAnchorCapturer;
}

export interface GroupOperationService {
  readonly hostedRoomIds: ReadonlySet<string>;
  isHostedRoom(id: string): boolean;
  fetchGroupRooms(): Promise<void>;
  syncActiveGroupSpeakerFromMessages(): void;
  openGroupRoom(roomId: string): Promise<void>;
  refreshGroupRoomLog(roomId: string): Promise<number>;
  syncGroupRoomLogsToState(roomId: string, logs: readonly GroupMessageEntry[]): void;
  sendGroupMessage(roomId: string, text: string): Promise<void>;
}

export function createGroupOperationService(deps: GroupOperationDeps): GroupOperationService {
  const hostedRoomIds = new Set<string>();
  const groupRoomStore = new GroupRoomStore();

  function isHostedRoom(id: string): boolean {
    return hostedRoomIds.has(id);
  }

  async function fetchGroupRooms(): Promise<void> {
    const client = deps.getGatewayClient();
    if (!client) return;
    const state = deps.getState();
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
              if (!deps.activeRunningGroupRoomIds.has(r.roomId)) {
                deps.unreadGroupRoomIds.add(r.roomId);
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
        deps.persistGroupsToCache(state.groupRooms);
      }
      deps.render();
    } catch (e) {
      console.warn('[Flux] fetchGroupRooms failed:', e);
      deps.render();
    }
  }

  function syncActiveGroupSpeakerFromMessages(): void {
    const state = deps.getState();
    if (state.activeFocus.type !== 'group') {
      state.activeGroupSpeaker = null;
      return;
    }
    const roomId = state.activeFocus.roomId;
    const members = state.groupRooms.find((g) => g.roomId === roomId)?.members ?? [];
    state.activeGroupSpeaker = resolveGroupSpeaker(state.messages, members, state.profiles);
  }

  async function openGroupRoom(roomId: string): Promise<void> {
    const client = deps.getGatewayClient();
    if (!roomId || !client) return;
    const state = deps.getState();

    // 切换焦点域前解除挂起回滚并捕获前序会话视口快照
    deps.disarmRollbackOnLeave();
    deps.captureStreamAnchor?.();
    state.activeFocus = { type: 'group', roomId };
    applyEnteredRead(deps.unreadGroupRoomIds, roomId);
    deps.activityTransitionTracker.clear('group', roomId);
    const targetRoom = state.groupRooms.find((r) => r.roomId === roomId);

    state.activeSessionId = roomId;
    state.activeLiveSessionId = roomId;
    // 【规则】群聊与普通会话共用同一套进入语义：首次进房间贴底，曾回溯则恢复原阅读位。
    deps.beginSessionEnter?.(roomId);
    state.isLoadingOlder = false;
    state.hasOlderMessages = false;
    // 研讨记录尚未到达：与普通会话同口径声明 loading，避免把"切换房间的空窗"读成空会话。
    state.messagesPhase = 'loading';
    const generation = deps.nextLoadMessagesGeneration();
    const guard = { sessionId: roomId, generation };

    // 切换房间时重置线程上下文，避免跨房间误用同一 thread_id
    deps.turnExecutionService.resetActiveGroupThread();
    // 【在场指示器】换房间立刻清空说话者：上一个房间的成员绝不能在新房间被高亮
    state.activeGroupSpeaker = null;

    // 从 groups.log 拉取官方事件流
    let fetchedLogs: GroupMessageEntry[] = [];
    try {
      const guarded = await runGuarded(
        guard,
        () => ({ sessionId: state.activeSessionId, generation: deps.getCurrentLoadMessagesGeneration() }),
        () => undefined,
        () => groupRoomStore.fetchLogs(roomId, client),
        deps.logSession,
      );
      if (guarded.status === 'discarded') return;
      const logs = guarded.value;
      fetchedLogs = logs ? [...logs] : [];
      if (logs && logs.length > 0) {
        state.messages = logs.map((entry, idx): MessageViewModel => {
          const senderName = entry.senderProfile || 'Agent';
          return {
            id: entry.messageId || `g_msg_${idx}`,
            role: entry.actorKind === 'user' || entry.senderProfile === 'user' ? 'user' : 'assistant',
            content: entry.text,
            sender: senderName,
            senderAvatar: deps.resolveAgentAvatar(senderName),
            timestamp: deps.formatTimestamp(entry.timestamp || Date.now()),
          };
        });
      } else {
        const roomName = targetRoom?.name || deps.t('group.defaultRoomName');
        const membersText = targetRoom?.members?.join('、') || '';
        state.messages = [
          {
            id: 'group_seed_notice',
            role: 'system',
            content: deps.t('group.welcomeInit', { name: roomName, members: membersText }),
            timestamp: deps.formatTimestamp(Date.now()),
          },
        ];
      }
    } catch {
      if (state.activeSessionId !== guard.sessionId || deps.getCurrentLoadMessagesGeneration() !== guard.generation) return;
      const roomName = targetRoom?.name || deps.t('group.defaultRoomName');
      const membersText = targetRoom?.members?.join('、') || '';
      state.messages = [
        {
          id: 'group_seed_notice',
          role: 'system',
          content: deps.t('group.welcomeReady', { name: roomName, members: membersText }),
          timestamp: deps.formatTimestamp(Date.now()),
        },
      ];
    }

    // 无论拿到日志还是回落种子通知，研讨记录都已落地：离开骨架相位。
    state.messagesPhase = 'ready';
    // 【在场指示器】按真实日志末条事件推导说话者
    syncActiveGroupSpeakerFromMessages();
    deps.render();

    if (hostedRoomIds.has(roomId) && deps.activeRunningGroupRoomIds.has(roomId) && !deps.groupPollerManager.isPolling(roomId)) {
      deps.groupPollerManager.startAwaitReply(roomId, captureGroupLogBaseline(fetchedLogs));
    }
  }

  async function refreshGroupRoomLog(roomId: string): Promise<number> {
    return deps.turnExecutionService.refreshGroupRoomLog(roomId);
  }

  function syncGroupRoomLogsToState(roomId: string, logs: readonly GroupMessageEntry[]): void {
    deps.turnExecutionService.syncGroupRoomLogsToState(roomId, logs);
  }

  async function sendGroupMessage(roomId: string, text: string): Promise<void> {
    return deps.turnExecutionService.sendGroupMessage(roomId, text);
  }

  return {
    hostedRoomIds,
    isHostedRoom,
    fetchGroupRooms,
    syncActiveGroupSpeakerFromMessages,
    openGroupRoom,
    refreshGroupRoomLog,
    syncGroupRoomLogsToState,
    sendGroupMessage,
  };
}
