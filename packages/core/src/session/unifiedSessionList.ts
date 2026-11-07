/**
 * Unified Session List Orchestrator (packages/core/src/session/unifiedSessionList.ts)
 *
 * 【设计意图 (Why)】
 * 客户端侧边栏/导航抽屉需要同时承载三大异构领域的实时信息：
 *   1. 专职数字员工 (Profiles / Bot Cards)：如 @hermes, @aura, @codeboy 等，置顶展示，具有终身主工位；
 *   2. 多 Agent 群聊房间 (Group Rooms)：多智能体联合协作会议室，居中展示；
 *   3. 个人普通会话流水 (Personal Timeline Sessions)：跨 Profile 聚合的普通历史任务，按时间全局倒序，居下展示。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 领域越界污染：普通会话更新时误篡改了专职 Bot 卡片的摘要；
 *   2. 幽灵会话死而复生：用户在本地删除了会话，由于网关 SWR 缓存有延迟，旧会话在下一次对账中被重新复活；
 *   3. 局部网络故障导致列表致空：某个 Profile 或接口超时返回空，盲目覆写导致本地数千条会话全白；
 *   4. 时间戳乱序与倒挂：直接用字符串格式化时间比较，导致昨天排在今天之前。
 *
 * 【约束与规则 (Rules)】
 *   - 纯函数与严格数据驱动，零 DOM / 零网络依赖，支持全平台共享；
 *   - 严格遵循定理 12~16 形式化不变量（互斥性、全序单调降序、墓碑不可侵犯、强幂等、失败不可致空）。
 */

import type { AgentProfile, NormalizedSession } from '../rpc/types.js';
import { dedupeSessionsWithReport, isVisibleSession, type DroppedSession } from './sessionMerge.js';

/**
 * 严格幂等的时间戳归一化函数 (Idempotent Timestamp Normalizer)
 *
 * 【数学性质 (Mathematical Property)】:
 *   ∀ ts ∈ ℝ, toIdempotentTimestamp(toIdempotentTimestamp(ts)) ≡ toIdempotentTimestamp(ts)
 * 解决原生秒级*1000在二次编排时发生复合放大的幂等性破缺。
 */
export function toIdempotentTimestamp(raw: number | string | undefined | null, fallback = 0): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw <= 0) return 0;
    // 严格界定秒级时间戳区间 [1e8, 1e11)（即 1973-03-03 至 5138-11-16）
    if (raw >= 1e8 && raw < 1e11) {
      return raw * 1000;
    }
    return raw;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

export interface GroupRoomItem {
  id: string;
  name: string;
  topic?: string;
  memberCount: number;
  lastMessageSnippet?: string;
  lastActiveTimestamp: number;
}

export interface BotCardItem {
  name: string;
  displayName: string;
  avatarUrl?: string;
  isOnline: boolean;
  lastActiveTimestamp: number;
  lastMessageSnippet?: string;
}

export interface UnifiedLeftRailInput {
  /** 专职数字员工原始列表 */
  profiles: AgentProfile[];
  /** 多 Agent 群聊原始列表 */
  groups: GroupRoomItem[];
  /** 普通跨 Profile 会话列表（当前本地或最新抓取） */
  sessions: NormalizedSession[];
  /** 本地已删除的会话墓碑 ID 集合（防幽灵死而复生） */
  tombstoneIds?: Iterable<string>;
  /** 尚未落盘的本地待决临时会话 ID 集合 */
  pendingIds?: Iterable<string>;
  /** 远端是否为权威且全量成功的响应。若为 false 则触发“失败不可致空”安全网 */
  authoritative: boolean;
  /** 本地历史缓存的兜底会话（用于非权威失败时合并保底） */
  previousCachedSessions?: NormalizedSession[];
}

export interface UnifiedLeftRailOutput {
  /** 置顶专职 Agent 序列（按最后活跃时间非递增全序排列） */
  botCards: BotCardItem[];
  /** 居中多 Agent 群聊序列（按最后活跃时间单调非递增排列） */
  groupRooms: GroupRoomItem[];
  /** 居下普通会话流水（严格过滤、去重、单调降序、无墓碑残留） */
  timelineSessions: NormalizedSession[];
  /** 审计与对账日志：丢弃的残影与非法条目 */
  dropped: DroppedSession[];
}

/**
 * 统一多层级会话列表聚合编排核心引擎
 */
export function orchestrateUnifiedLeftRail(input: UnifiedLeftRailInput): UnifiedLeftRailOutput {
  const tombstoneSet = new Set(input.tombstoneIds ?? []);
  const pendingSet = new Set(input.pendingIds ?? []);
  const allDropped: DroppedSession[] = [];

  // ==========================================
  // 1. 专职数字员工（Profiles / Bot Cards）编排
  // ==========================================
  const botCards: BotCardItem[] = (input.profiles || [])
    .filter((p) => p && typeof p.name === 'string' && p.name.trim().length > 0)
    .map((p) => {
      const lastActiveRaw = p.last_session?.last_active ?? p.last_session?.started_at ?? p.timestamp;
      const ts = toIdempotentTimestamp(lastActiveRaw, 0);
      const snippetRaw = p.lastMessage ?? p.last_session?.preview ?? '';
      return {
        name: p.name.trim(),
        displayName: p.displayName?.trim() || p.name.trim(),
        avatarUrl: p.hasAvatar ? `/api/profiles/${encodeURIComponent(p.name)}/avatar` : p.avatar,
        isOnline: true,
        lastActiveTimestamp: ts,
        lastMessageSnippet: typeof snippetRaw === 'string' ? snippetRaw : '',
      };
    });

  // 按专职工位最后活跃时间非递增全序排序
  botCards.sort((a, b) => b.lastActiveTimestamp - a.lastActiveTimestamp);

  // ==========================================
  // 2. 多 Agent 群聊房间（Groups）编排
  // ==========================================
  const groupRooms: GroupRoomItem[] = (input.groups || [])
    .filter((g) => g && typeof g.id === 'string' && g.id.trim().length > 0)
    .filter((g) => !tombstoneSet.has(g.id.trim())) // 墓碑彻底驱逐
    .map((g) => ({
      ...g,
      id: g.id.trim(),
      name: g.name?.trim() || '未命名群聊',
      lastActiveTimestamp: toIdempotentTimestamp(g.lastActiveTimestamp, 0),
    }));

  groupRooms.sort((a, b) => b.lastActiveTimestamp - a.lastActiveTimestamp);

  // ==========================================
  // 3. 普通跨 Profile 会话（Timeline Sessions）编排
  // ==========================================
  let candidateSessions: NormalizedSession[] = [];

  if (input.authoritative) {
    // 权威模式：直接使用输入的 sessions
    candidateSessions = input.sessions || [];
  } else {
    // 非权威降级模式（网络异常/部分失败）：
    // 【定理 16 形式化不变量 (Failure Non-Emptiness)】
    // 将已有本地缓存与本次部分成功的 sessions 执行容灾并集
    const prevValid = (input.previousCachedSessions || []).filter(isVisibleSession);
    const currValid = (input.sessions || []).filter(isVisibleSession);
    candidateSessions = [...currValid, ...prevValid];
  }

  // 执行复合键 (profile::id) 去重与对账
  const dedupeReport = dedupeSessionsWithReport(candidateSessions);
  allDropped.push(...dedupeReport.dropped);

  const finalTimeline: NormalizedSession[] = [];
  for (const session of dedupeReport.sessions) {
    if (!session || !session.id) continue;
    const sid = session.id.trim();

    // 【定理 14 墓碑不可侵犯性】：只要命中墓碑，绝不可复活
    if (tombstoneSet.has(sid)) {
      allDropped.push({
        sessionId: sid,
        profile: session.botName || 'default',
        title: session.title || '',
        reason: 'superseded-by-authority',
      });
      continue;
    }

    // 处于 pending 中的会话无条件保留（避免刚建会话被闪烁剔除）
    if (pendingSet.has(sid)) {
      finalTimeline.push({
        ...session,
        timestamp: toIdempotentTimestamp(session.timestamp, Date.now()),
      });
      continue;
    }

    // 遵循标准可见性过滤（隐藏内部工位、子代理流水、空标题）
    if (isVisibleSession(session)) {
      finalTimeline.push({
        ...session,
        timestamp: toIdempotentTimestamp(session.timestamp, 0),
      });
    }
  }

  // 【定理 13 时间全序单调降序保证】
  finalTimeline.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  return {
    botCards,
    groupRooms,
    timelineSessions: finalTimeline,
    dropped: allDropped,
  };
}
