/**
 * 客户端持久化缓存桥接领域（Desktop Cache Bridge）
 *
 * 【设计意图 (Why)】
 *   将客户端 IndexedDB 缓存存储与 UI 层实体视图之间的双向转换、
 *   冷启动快照恢复、串行写入链及分桶持久化逻辑从庞大的 renderer/index.ts 中完全剥离。
 *   保持领域逻辑无 DOM 依赖，使缓存同步具备纯 Node 单测验证能力。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 临时主键污染：没有真实 rowId 的消息（如 usr-/ast- 临时键）绝不落盘；
 *   2. 分桶纯洁性：血缘追溯的父会话消息不得混入当前会话分桶，否则翻页游标越界；
 *   3. 并发写入冲突：会话与群聊共享统一索引键，必须经由 enqueueIndexWrite 串行链执行。
 *
 * 【约束与规则 (Rules)】
 *   - 纯逻辑领域，不直接操作全局 document / window；
 *   - 转换函数纯净无副作用，缺失字段按领域默认值严格回退。
 */

import {
  type CachedMessageRow,
  type CachedSessionSummary,
  type CachedAgentSummary,
  type CacheChannelRef,
  type CacheService,
  type NormalizedSession,
  type AgentProfile,
  isKnownDisplayKind,
} from '@hermes-flux/core';
import {
  type LeftRailGroupRoom,
  type MessageViewModel,
  formatLeftRailTime,
} from '@hermes-flux/ui';
import { resolveDurableOrderKey } from '../persistence/persistedJson.js';

/** 格式化会话展示时间 */
export function formatSessionTime(timestamp: number): string {
  if (!timestamp || timestamp <= 0) return '';
  return formatLeftRailTime(timestamp);
}

/** 消息缓存上限：每会话 5000 行。 */
export const MESSAGE_CACHE_LIMIT = 5000;

/** 把缓存索引行还原成渲染层使用的会话结构。 */
export function toNormalizedSession(row: CachedSessionSummary): NormalizedSession {
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
export function toCachedSession(
  row: NormalizedSession,
  defaultProfile: string = 'default'
): CachedSessionSummary {
  return {
    id: row.id,
    profile: row.botName || defaultProfile,
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
export function toLeftRailGroupRoom(row: CachedSessionSummary): LeftRailGroupRoom {
  return {
    roomId: row.id,
    name: row.title,
    members: row.members ?? [],
    createdAt: row.timestamp,
    updatedAt: row.timestamp,
  };
}

/** 把左轨群聊结构收敛成缓存索引行（群聊不属于任何 profile，profile 固定空串）。 */
export function toCachedGroup(room: LeftRailGroupRoom): CachedSessionSummary {
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

/** 把缓存消息行还原成渲染层消息视图。 */
export function toMessageViewModel(row: CachedMessageRow): MessageViewModel {
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
export function toCachedMessage(
  view: MessageViewModel,
  ref: CacheChannelRef
): CachedMessageRow | null {
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

/** 把缓存 Agent 行还原成渲染层档案结构。 */
export function toAgentProfile(row: CachedAgentSummary): AgentProfile {
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

/** 串行索引写入链管理器 */
export class IndexWriteQueue {
  private tail: Promise<unknown> = Promise.resolve();

  public enqueue(task: () => Promise<void>): void {
    this.tail = this.tail.then(task, task).catch(() => undefined);
  }
}

/** 全局单例索引写入链 */
export const defaultIndexWriteQueue = new IndexWriteQueue();

/** 权威会话列表写入缓存：保留既有群聊行，只替换 session 行。 */
export function persistSessionsToCache(
  sessions: NormalizedSession[],
  cacheService: CacheService,
  defaultProfile: string = 'default',
  queue: IndexWriteQueue = defaultIndexWriteQueue
): void {
  const rows = sessions.map((s) => toCachedSession(s, defaultProfile));
  queue.enqueue(async () => {
    const existing = await cacheService.readSessions();
    const groups = existing.filter((row) => row.kind === 'group');
    await cacheService.writeSessions([...groups, ...rows]);
  });
}

/** 权威群聊列表写入缓存：保留既有会话行，只替换 group 行。 */
export function persistGroupsToCache(
  rooms: LeftRailGroupRoom[],
  cacheService: CacheService,
  queue: IndexWriteQueue = defaultIndexWriteQueue
): void {
  const rows = rooms.map(toCachedGroup);
  queue.enqueue(async () => {
    const existing = await cacheService.readSessions();
    const sessions = existing.filter((row) => row.kind === 'session');
    await cacheService.writeSessions([...sessions, ...rows]);
  });
}

/** 权威 Agent 列表写入缓存（异步，失败不影响渲染）。 */
export function persistAgentsToCache(
  profiles: AgentProfile[],
  cacheService: CacheService
): void {
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

/** 把一次 REST 窗口写入持久化缓存（异步，失败只降级为纯内存）。 */
export function persistMessagesToCache(
  ref: CacheChannelRef,
  messages: MessageViewModel[],
  fenceMax: number,
  cacheService: CacheService
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

/** 把当前流式回合已获权威 rowId 的消息写入客户端持久化缓存。 */
export function persistTurnToCache(
  sessionId: string,
  botName: string | undefined | null,
  messages: MessageViewModel[],
  cacheService: CacheService,
  isRoom: boolean,
  defaultProfile: string = 'default'
): void {
  if (!sessionId) return;
  const ref: CacheChannelRef = {
    profile: isRoom ? '' : (botName || defaultProfile || 'default'),
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
