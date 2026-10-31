/**
 * Multi-Agent Group Room Service & 4-Stage Promotion Orchestrator
 * (packages/core/src/group/groupService.ts)
 *
 * 设计意图 (Why):
 *   当单个会话的深度探讨需要多位专家（如架构师、前端、安全审计）联合研讨时，
 *   不能在单会话内混杂上下文，必须通过官方 groups.* 协议建立独立房间实体（hosted_rooms）。
 *   为了让全平台（Desktop / Web / Mobile）无缝复用：
 *   1. 群聊生命周期（增删改查、发言、日志同步）；
 *   2. 单聊一键原地拉群（Session-to-Group Promotion）四阶工程管道；
 *   必须将该纯逻辑沉淀在 packages/core 中。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 记忆污染（Memory Poisoning）：群聊内任何对话只沉淀在 groups.log 中，
 *      严禁回写污染单个 Bot 的个人 MEMORY.md。
 *   2. 上下文断层：单聊拉群绝不是直接开一个空房间让用户重新打字，
 *      必须通过四阶管道自动提取前序对话精要，以 Room 0 种子系统备忘录注入。
 *   3. 权限与空名单：拉群成员必须至少包含 2 名专家，否则拒绝创建。
 *
 * 约束与规则 (Rules):
 *   - 纯 TypeScript 实现，零宿主 API 或 DOM 依赖。
 *   - 显式失败（Failure Is Not Empty）：网络或参数异常必须显式抛出。
 */

import type {
  GroupRoomSummary,
  GroupMessageEntry,
  GroupsListResult,
  GroupsCreateParams,
  GroupsCreateResult,
  GroupsStateParams,
  GroupsStateResult,
  GroupsSendParams,
  GroupsSendResult,
  GroupsLogParams,
  GroupsLogResult,
  GroupsDisbandParams,
  GroupsDisbandResult,
  GroupsRenameParams,
  GroupsRenameResult,
  IRpcCaller,
} from '../rpc/types.js';

export interface PromoteSessionToGroupParams {
  parentSessionId: string;
  originalTitle?: string;
  groupName: string;
  selectedMembers: string[];
  sourceMessages?: Array<{ role: string; content: string }>;
}

export interface PromoteSessionToGroupResult {
  roomId: string;
  groupName: string;
  members: string[];
  briefingMemo: string;
  anchorCardText: string;
}

export type GroupLogListener = (entry: GroupMessageEntry) => void;

/**
 * 铸造群聊线程 ID（与官方桌面端 1:1 对齐）
 *
 * 【设计意图 (Why)】
 * 网关要求 payload.thread_id 必须存在，且用它把同一轮研讨的多次发言归组。
 * 官方实现为 `t${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`。
 *
 * 【规则 (Rules)】
 * 前缀必须是字母 t，整体长度可控，禁止携带非法字符（网关 _identifier 会校验）。
 */
export function mintGroupThreadId(): string {
  return `t${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 铸造群聊事件 ID（幂等键，官方为 UUID） */
export function mintGroupEventId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class GroupRoomStore {
  /**
   * 房间信息缓存：roomId -> GroupRoomSummary
   */
  private rooms = new Map<string, GroupRoomSummary>();

  /**
   * 房间发言日志缓存：roomId -> GroupMessageEntry[]
   */
  private roomLogs = new Map<string, GroupMessageEntry[]>();

  /**
   * 活跃房间事件监听器：roomId -> Set<GroupLogListener>
   */
  private logListeners = new Map<string, Set<GroupLogListener>>();

  /**
   * 拉取所有多 Agent 群聊房间列表
   * 兼容官方 Gateway 返回结构：{ rooms: [...] } 与客户端解包结构 { groups: [...] }
   */
  public async listRooms(bridge: IRpcCaller): Promise<GroupRoomSummary[]> {
    const res = await bridge.request<GroupsListResult>('groups.list');
    const rawList = Array.isArray(res?.groups)
      ? res.groups
      : Array.isArray(res?.rooms)
      ? res.rooms.map((r) => ({
          roomId: r.room_id,
          name: r.name,
          members: Array.isArray(r.members)
            ? r.members.map((m) => m.profile || m.handle || 'member')
            : [],
          createdAt: typeof r.created_at === 'number' ? r.created_at * 1000 : Date.now(),
          updatedAt: typeof r.updated_at === 'number' ? r.updated_at * 1000 : Date.now(),
          isDisbanded: Boolean(r.disbanded_at),
        }))
      : null;

    if (!rawList) {
      throw new Error('网关返回了非法的 groups.list 响应数据结构');
    }

    this.rooms.clear();
    for (const room of rawList) {
      this.rooms.set(room.roomId, room);
    }
    return rawList;
  }

  /**
   * 获取指定群聊房间状态
   */
  public async getRoomState(roomId: string, bridge: IRpcCaller): Promise<GroupsStateResult> {
    if (!roomId) throw new Error('Room ID is mandatory for getRoomState');
    return bridge.request<GroupsStateResult, GroupsStateParams>('groups.state', {
      room_id: roomId,
    });
  }

  /**
   * 直接创建一个全新群聊房间
   */
  public async createRoom(
    name: string,
    members: Array<string | { member_id?: string; profile?: string; handle?: string; display_name?: string; name?: string }>,
    bridge: IRpcCaller,
    roomId?: string
  ): Promise<GroupsCreateResult> {
    if (!name || typeof name !== 'string') {
      throw new Error('Group name cannot be empty');
    }
    if (!Array.isArray(members) || members.length < 2) {
      throw new Error('Group room requires at least 2 members');
    }

    const assignedRoomId = roomId || `r${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    // 官方网关要求 member 必须是对象: { member_id, profile, handle, display_name }
    const formattedMembers: Array<{ member_id: string; profile: string; handle: string; display_name?: string }> = members.map((m, idx) => {
      if (typeof m === 'object' && m !== null) {
        const prof = m.profile || m.name || 'default';
        return {
          member_id: m.member_id || `m_${prof}_${idx}`,
          profile: prof,
          handle: m.handle || prof,
          display_name: m.display_name || prof,
        };
      }
      const prof = String(m);
      return {
        member_id: `m_${prof}_${idx}`,
        profile: prof,
        handle: prof,
        display_name: prof,
      };
    });

    const res = await bridge.request<GroupsCreateResult, GroupsCreateParams>('groups.create', {
      room_id: assignedRoomId,
      name,
      members: formattedMembers,
    });

    const summary: GroupRoomSummary = {
      roomId: res.room_id || assignedRoomId,
      name: res.name || name,
      members: Array.isArray(res.members)
        ? res.members.map((m) => {
            if (typeof m === 'string') return m;
            const obj = m as Record<string, unknown>;
            return String(obj.profile || obj.handle || obj.display_name || 'member');
          })
        : formattedMembers.map((m) => m.profile),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.rooms.set(summary.roomId, summary);
    return res;
  }

  /**
   * 向指定群聊房间发送一条人类消息
   *
   * 【设计意图 (Why)】
   * 官方 groups.send 只接受 `{ room_id, event_id, payload: { text, thread_id } }`。
   * thread_id 由客户端铸造，用于把同一轮研讨的多次发言归入同一线程。
   *
   * 【防范的历史坑 (Pitfall)】
   * 1. 把 text 平铺到顶层 → 网关 4000 Extra inputs are not permitted；
   * 2. 只传 payload.text → 5112 user payload is missing fields: thread_id；
   * 3. 不传 event_id → 4111 event_id must be a string。
   *    以上三种都会被上层误读成"群聊发不出去"，实际是契约不符。
   *
   * 【规则 (Rules)】
   * - 本方法只负责写房间日志，不负责触发成员回合（由网关 driver 决定）；
   * - 返回值优先取官方 `event.seq`，无则退回本地序号。
   */
  public async sendMessage(
    roomId: string,
    text: string,
    senderProfile: string,
    bridge: IRpcCaller,
    options: { threadId?: string; isSeed?: boolean } = {}
  ): Promise<GroupsSendResult> {
    const trimmed = (text || '').trim();
    if (!roomId || !trimmed) {
      throw new Error('Room ID and text are mandatory for sendMessage');
    }

    const threadId = options.threadId || mintGroupThreadId();
    const eventId = mintGroupEventId();

    const res = await bridge.request<GroupsSendResult, GroupsSendParams>('groups.send', {
      room_id: roomId,
      event_id: eventId,
      payload: { text: trimmed, thread_id: threadId },
    });

    const entry: GroupMessageEntry = {
      messageId: res.event?.event_id || res.message_id || eventId,
      seq: Number(res.event?.seq ?? res.seq ?? 0),
      senderProfile: senderProfile || 'user',
      timestamp: typeof res.event?.created_at === 'number'
        ? (res.event.created_at > 1e11 ? res.event.created_at : res.event.created_at * 1000)
        : Date.now(),
      text: trimmed,
      isSeed: Boolean(options.isSeed),
      threadId,
      actorKind: 'user',
    };

    this.appendEntry(roomId, entry);
    return res;
  }

  /**
   * 同步房间的历史日志流 (groups.log)
   */
  public async fetchLogs(
    roomId: string,
    bridge: IRpcCaller,
    sinceSeq?: number,
    limit = 100
  ): Promise<GroupMessageEntry[]> {
    if (!roomId) throw new Error('Room ID is mandatory for fetchLogs');

    const res = await bridge.request<GroupsLogResult, GroupsLogParams>('groups.log', {
      room_id: roomId,
      since_seq: sinceSeq,
      limit,
    });

    // 官方网关返回 { events: [...], cursor, latest_seq }，客户端本地结构支持 entries
    const rawEvents = Array.isArray(res?.events)
      ? res.events
      : Array.isArray(res?.entries)
      ? res.entries
      : [];

    for (const raw of rawEvents) {
      const r = raw as Record<string, unknown>;
      const actor = (r.actor && typeof r.actor === 'object' ? r.actor : {}) as Record<string, unknown>;
      const payload = (r.payload && typeof r.payload === 'object' ? r.payload : {}) as Record<string, unknown>;
      const text = String(payload.text || r.text || '');
      const kind = String(r.kind || '');
      // 过滤非消息类系统纯控制事件（room.created / room.activity 等没有正文的事件）
      if (!text && kind.startsWith('room.')) continue;
      if (!text) continue;

      // 官方 actor 形如 { kind: 'user'|'member', id, profile?, display_name? }，没有 name 字段
      const actorKind = String(actor.kind || '');
      const senderProfile = String(
        actor.display_name || actor.profile || actor.id || r.senderProfile || (actorKind === 'user' ? 'user' : 'Agent')
      );
      const timestamp = typeof r.created_at === 'number'
        ? (r.created_at > 1e11 ? r.created_at : r.created_at * 1000)
        : typeof r.timestamp === 'number'
        ? r.timestamp
        : Date.now();

      const entry: GroupMessageEntry = {
        messageId: String(r.event_id || r.messageId || `msg_${r.seq || Date.now()}`),
        seq: Number(r.seq || 0),
        senderProfile,
        timestamp,
        text,
        isSeed: Boolean(payload.is_seed || r.isSeed),
        threadId: typeof payload.thread_id === 'string' ? payload.thread_id : undefined,
        actorKind: actorKind || undefined,
      };
      this.appendEntry(roomId, entry);
    }

    return this.getLogs(roomId);
  }

  /**
   * 解散群聊房间
   */
  public async disbandRoom(roomId: string, bridge: IRpcCaller): Promise<boolean> {
    const res = await bridge.request<GroupsDisbandResult, GroupsDisbandParams>('groups.disband', {
      room_id: roomId,
    });
    if (res.success) {
      const existing = this.rooms.get(roomId);
      if (existing) {
        existing.isDisbanded = true;
      }
    }
    return res.success;
  }

  /**
   * 重命名群聊房间
   */
  public async renameRoom(roomId: string, newName: string, bridge: IRpcCaller): Promise<boolean> {
    const res = await bridge.request<GroupsRenameResult, GroupsRenameParams>('groups.rename', {
      room_id: roomId,
      new_name: newName,
    });
    if (res.success) {
      const existing = this.rooms.get(roomId);
      if (existing) {
        existing.name = newName;
      }
    }
    return res.success;
  }

  /**
   * 订阅指定房间的实时消息流
   */
  public subscribeRoom(roomId: string, listener: GroupLogListener): () => void {
    let set = this.logListeners.get(roomId);
    if (!set) {
      set = new Set();
      this.logListeners.set(roomId, set);
    }
    set.add(listener);

    return () => {
      const current = this.logListeners.get(roomId);
      if (current) {
        current.delete(listener);
        if (current.size === 0) {
          this.logListeners.delete(roomId);
        }
      }
    };
  }

  public getLogs(roomId: string): GroupMessageEntry[] {
    const logs = this.roomLogs.get(roomId);
    return logs ? [...logs] : [];
  }

  private appendEntry(roomId: string, entry: GroupMessageEntry): void {
    let list = this.roomLogs.get(roomId);
    if (!list) {
      list = [];
      this.roomLogs.set(roomId, list);
    }
    if (!list.some((e) => e.messageId === entry.messageId)) {
      list.push(entry);
      list.sort((a, b) => a.seq - b.seq);
    }

    const listeners = this.logListeners.get(roomId);
    if (listeners) {
      for (const l of listeners) {
        l(entry);
      }
    }
  }

  /**
   * 四阶单聊一键拉群升级编排管线 (Session-to-Group Promotion Pipeline)
   *
   * 设计意图 (Why):
   *   为解决单聊探讨遇到复杂深水区时，用户需要将单聊快速升级为多专家研讨房间的诉求。
   *
   * 防范的历史坑 (Pitfall):
   *   严禁无头创建空群！必须把单聊背景压缩成 Briefing Memo 种子系统消息固化到 Room 0，
   *   并在原单聊追加不可变锚点卡片。
   */
  public async promoteSessionToGroup(
    params: PromoteSessionToGroupParams,
    bridge: IRpcCaller
  ): Promise<PromoteSessionToGroupResult> {
    const { parentSessionId, originalTitle = '探索会话', groupName, selectedMembers, sourceMessages = [] } = params;

    if (!parentSessionId) {
      throw new Error('Parent session ID is required for promotion');
    }
    if (!selectedMembers || selectedMembers.length < 2) {
      throw new Error('多智能体群聊升级至少需要选择 2 位专家成员');
    }

    // 阶段二：背景简报提取与压缩 (Context Briefing Memo)
    let contextSummary = '';
    if (sourceMessages.length > 0) {
      // 提取核心对话片断
      const slice = sourceMessages.slice(-8);
      contextSummary = slice.map((m) => `${m.role}: ${m.content.slice(0, 150)}`).join('\n');
    } else {
      contextSummary = `基于前序会话 [${originalTitle}] 发起协同研讨。`;
    }

    const briefingMemo = [
      `### 📋 会议前序背景摘要 (From Session: ${originalTitle})`,
      `• **议题起源**: ${originalTitle}`,
      `• **参会专家**: ${selectedMembers.map((m) => `@${m}`).join(', ')}`,
      `• **前序关键上下文**:`,
      contextSummary,
      `• **本次群聊聚焦解决**: 针对上述技术方案开展多智能体协同推演与争议裁判。`,
    ].join('\n');

    // 阶段三：创建群房间与种子注入 (Group Creation & Seed Injection)
    const createRes = await this.createRoom(groupName, selectedMembers, bridge);
    const roomId = createRes.room_id;

    // 将 Briefing Memo 作为 Room 0 种子备忘录注入
    await this.sendMessage(roomId, briefingMemo, 'system', bridge, { isSeed: true });

    // 阶段四：构造原单聊末尾的不可变跳转锚点卡片
    const anchorCardText = `📌 本会话已升级为多Agent研讨群聊: [进入会议室 ➔] (room: ${roomId})`;

    return {
      roomId,
      groupName,
      members: selectedMembers,
      briefingMemo,
      anchorCardText,
    };
  }
}
