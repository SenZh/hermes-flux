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
    members: string[],
    bridge: IRpcCaller
  ): Promise<GroupsCreateResult> {
    if (!name || typeof name !== 'string') {
      throw new Error('Group name cannot be empty');
    }
    if (!Array.isArray(members) || members.length < 2) {
      throw new Error('Group room requires at least 2 members');
    }

    const res = await bridge.request<GroupsCreateResult, GroupsCreateParams>('groups.create', {
      name,
      members,
    });

    const summary: GroupRoomSummary = {
      roomId: res.room_id,
      name: res.name || name,
      members: res.members || members,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.rooms.set(res.room_id, summary);
    return res;
  }

  /**
   * 向指定群聊房间发送消息
   */
  public async sendMessage(
    roomId: string,
    text: string,
    senderProfile: string,
    bridge: IRpcCaller,
    isSeed = false
  ): Promise<GroupsSendResult> {
    if (!roomId || !text) {
      throw new Error('Room ID and text are mandatory for sendMessage');
    }

    const res = await bridge.request<GroupsSendResult, GroupsSendParams>('groups.send', {
      room_id: roomId,
      text,
      sender_profile: senderProfile || 'user',
      is_seed: isSeed,
    });

    const entry: GroupMessageEntry = {
      messageId: res.message_id || `msg-${Date.now()}`,
      seq: res.seq || Date.now(),
      senderProfile: senderProfile || 'user',
      timestamp: Date.now(),
      text,
      isSeed,
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

    if (res && Array.isArray(res.entries)) {
      for (const entry of res.entries) {
        this.appendEntry(roomId, entry);
      }
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
    await this.sendMessage(roomId, briefingMemo, 'system', bridge, true);

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
