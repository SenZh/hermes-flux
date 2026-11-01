/**
 * Cross-Profile Session Merge (packages/core/src/session/sessionMerge.ts)
 *
 * 设计意图 (Why):
 *   一个网关可挂载多个 Bot Profile，每个 Profile 拥有独立的 SQLite 会话库。
 *   工作台需要把多库会话合并成一条时间线，供左侧栏统一浏览。
 *
 * 防范的历史坑 (Pitfall):
 *   会话 ID 形如 `20261031_082411_824c51`（时间戳前缀 + 短随机后缀），
 *   不同 Profile 各自独立生成，跨库碰撞是常态而非例外。
 *   曾用裸 sessionId 做全局去重：aura 的一条空白会话先返回并占住了 ID，
 *   xiaofawang 下真正有标题的《评估 Relay 技术商业化可行性》被当成重复项丢弃，
 *   随后空白项又被空标题过滤，最终整个会话在界面上彻底消失。
 *
 * 约束与规则 (Rules):
 *   - 去重键必须是 `profile::sessionId` 复合键；
 *   - 输出按时间戳降序，时间戳缺失视为 0（排在末尾）；
 *   - 纯函数，零 DOM / 零网络依赖，便于全平台复用与确定性测试。
 */

import type { NormalizedSession } from '../rpc/types.js';

/** 会话所属 Profile；缺省时回落到 default */
export function sessionProfileKey(session: NormalizedSession): string {
  return session.botName || 'default';
}

/**
 * 按 `profile::sessionId` 去重，保留首次出现的那条，并按时间戳降序排序。
 */
export function dedupeSessionsByProfile(sessions: NormalizedSession[]): NormalizedSession[] {
  return dedupeSessionsWithReport(sessions).sessions;
}

/** 被丢弃的会话及原因，用于对账 */
export interface DroppedSession {
  sessionId: string;
  profile: string;
  title: string;
  reason: 'duplicate-profile-session' | 'invalid-session' | 'superseded-by-authority';
}

export interface SessionDedupeReport {
  sessions: NormalizedSession[];
  dropped: DroppedSession[];
}

/**
 * 去重并返回对账报告。
 *
 * 【设计意图 (Why)】
 *   静默丢弃是本次"会话凭空消失"的根因。凡是会减少数据量的操作，
 *   都必须能回答"少了哪几条、为什么少"，否则线上只能靠肉眼比对。
 *
 * 【约束 (Rules)】
 *   调用方应把 dropped 数量写入 debug 日志；排查时可据此定位是哪条被合并。
 */
export function dedupeSessionsWithReport(sessions: NormalizedSession[]): SessionDedupeReport {
  const seen = new Set<string>();
  const merged: NormalizedSession[] = [];
  const dropped: DroppedSession[] = [];

  for (const session of sessions) {
    if (!session || !session.id) {
      dropped.push({
        sessionId: '',
        profile: 'unknown',
        title: '',
        reason: 'invalid-session',
      });
      continue;
    }
    const profile = sessionProfileKey(session);
    const key = `${profile}::${session.id}`;
    if (seen.has(key)) {
      dropped.push({
        sessionId: session.id,
        profile,
        title: session.title,
        reason: 'duplicate-profile-session',
      });
      continue;
    }
    seen.add(key);
    merged.push(session);
  }

  merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return { sessions: merged, dropped };
}

/**
 * 丢弃已被本次网关返回结果取代的本地旧会话。
 *
 * 【设计意图 (Why)】
 *   stored session id 代表同一条会话。同一条会话被移交/复制到另一个 Profile 后，
 *   原 Profile 里那份会被归档，`session.list` 只返回活跃的那一份。
 *   本地列表若继续保留旧副本，用户就会看到两条同名会话：头像不同，点开却是同一份内容。
 *
 * 【防范的历史坑 (Pitfall)】
 *   曾只按 `profile::sessionId` 判断"本次是否已返回"，归档副本永远不在返回集合里，
 *   于是被"防闪烁保留"逻辑无限期挂在列表上，刷新前都消不掉（default 归档 + aura 活跃 → 两条）。
 *
 * 【约束与规则 (Rules)】
 *   - `returned === null` 表示调用方明确拿不到权威结果：失败不等于"权威端确认没有会话"，必须原样返回本地列表。
 *     当前唯一生产调用方（reconcileSessionList）只在权威成功时传数组，null 分支保留为公共契约；
 *   - `returned` 是数组时表示权威结果（哪怕为空）：该 id 出现过就剔除本地旧条目，
 *     数组为空时同样返回空，让"已删除/已归档"的残影真正收敛；
 *   - 判定依据是 sessionId，不看 Profile：同 id 多 Profile 都活跃时两条都会出现在 returned 里，
 *     由 dedupeSessionsWithReport 各自保留，本函数只作用于本地旧列表；
 *   - 纯函数，零 DOM / 零网络依赖。
 */
export function pruneSupersededSessions<T extends NormalizedSession>(
  existing: T[],
  returned: NormalizedSession[] | null
): T[] {
  if (returned === null) return existing;
  if (returned.length === 0) return [];
  if (existing.length === 0) return existing;
  const returnedIds = new Set(returned.map((s) => s.id));
  return existing.filter((s) => !returnedIds.has(s.id));
}

// gate-i18n-allow: 用于识别子代理派生会话的日期流水线标题（数据分类，不是界面文案）
const SUBAGENT_DATE_TITLE_PATTERN = /^会话\s*\d{8}$/i;

/**
 * 会话是否属于活跃时间线（渲染可见性规则）。
 *
 * 【设计意图 (Why)】
 *   子代理派生、日期流水线占位、已归档、无标题的空白占位都不该出现在用户的时间线里。
 *   该规则原先散落在渲染壳层，无法被单测覆盖；下沉为纯函数后才能做确定性回归。
 *
 * 【防范的历史坑 (Pitfall)】
 *   归档会话若漏过滤，会与同 id 的活跃副本并存，表现为"两个名字一样、头像不同"的重复条目。
 *
 * 【约束与规则 (Rules)】
 *   - 只做可见性判定，不修改入参；`id` 缺失的条目一律不可见；
 *   - 与网关 `session.list` 的默认过滤保持一致（归档、内部 source 不返回）。
 */
export function isVisibleSession(session: NormalizedSession | null | undefined): boolean {
  if (!session || !session.id) return false;
  if (session.isSubagent || session.source === 'subagent') return false;
  if (session.isArchived) return false;
  if (!session.title || !session.title.trim()) return false;
  if (SUBAGENT_DATE_TITLE_PATTERN.test(session.title)) return false;
  return true;
}

/** 会话列表对账入参 */
export interface SessionReconcileInput {
  /** 本地当前列表（可能含归档残影与尚未落盘的临时会话） */
  previous: NormalizedSession[];
  /** 本轮网关返回的原始会话（只包含查询成功的 Profile） */
  fetched: NormalizedSession[];
  /** 本轮是否所有 Profile 都查询成功。false 时只合并展示成功结果，绝不剔除本地任何条目 */
  authoritative: boolean;
  /** 尚未落盘的本地临时会话 id */
  pendingIds?: string[];
  /** 当前选中的 Bot Profile，用于无 botName 条目的去重键兜底 */
  profileName?: string;
}

/** 会话列表对账结果 */
export interface SessionReconcileResult {
  sessions: NormalizedSession[];
  pendingIds: string[];
  /** 被去重丢弃的条目，供调用方写日志对账 */
  dropped: DroppedSession[];
  /** 被权威结果取代而剔除的本地残影，供调用方写日志对账 */
  pruned: DroppedSession[];
}

/**
 * 会话列表对账：把网关权威结果与本地列表合并成最终时间线。
 *
 * 【设计意图 (Why)】
 *   这段编排原先写在渲染壳层里，无法被单测覆盖，导致"归档残影不收敛"这类缺陷只能靠肉眼发现。
 *   下沉为纯函数后，权威结果、部分失败降级、临时会话、残影剔除四条规则都能被确定性回归钉死。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 用"过滤掉归档行"的集合去剔除本地副本，会让"该 id 已被权威端归档"这一事实丢失，
 *      本地活跃副本永远收敛不掉（幽灵会话）。剔除依据必须用未过滤的权威结果。
 *   2. 把"某个 Profile 查询失败"当成"权威端确认没有会话"，会连成功 Profile 的新会话一起冻结，
 *      一次局部抖动就让整个列表停止更新。部分失败只降级剔除，不降级展示。
 *
 * 【约束与规则 (Rules)】
 *   - `authoritative === false`：展示成功 Profile 的结果 + 保留全部本地可见会话，不做任何剔除；
 *   - `authoritative === true`：`fetched`（哪怕为空）即权威，该 id 出现过就不再保留本地同 id 旧条目；
 *   - 展示集合始终由 `isVisibleSession` 过滤归档/子代理/日期占位/空标题；
 *   - pending 会话优先于剔除保留，避免新建会话在首次落盘前闪烁消失；
 *   - 纯函数，零 DOM / 零网络依赖。
 */
export function reconcileSessionList(input: SessionReconcileInput): SessionReconcileResult {
  const previous = input.previous;
  const pendingIds = input.pendingIds ?? [];
  const profileName = input.profileName;

  const report = dedupeSessionsWithReport(input.fetched);
  const allMerged = report.sessions;
  const seenKeys = new Set(allMerged.map((s) => `${s.botName || 'default'}::${s.id}`));
  const isSeen = (s: NormalizedSession) =>
    seenKeys.has(`${s.botName || profileName || 'default'}::${s.id}`);

  const visible = allMerged.filter(isVisibleSession);

  // pending 是新建会话的乐观占位（必定有标题），始终可见；不与归档/子代理的可见性规则对齐
  const stillPending = previous.filter((s) => pendingIds.includes(s.id) && !isSeen(s));
  // 按 id 清理：已落盘的 pending 无论落在哪个 Profile，都不该继续留在待落盘集合里
  const nextPendingIds = pendingIds.filter((id) => !allMerged.some((s) => s.id === id));

  const retainCandidates = previous.filter((s) => !isSeen(s) && isVisibleSession(s));
  // 剔除依据是未过滤的权威结果：归档行同样是"该 id 已被权威端处置"的证据
  const retained = input.authoritative
    ? pruneSupersededSessions(retainCandidates, allMerged)
    : retainCandidates;

  const retainedKeys = new Set(retained.map((s) => `${s.botName || 'default'}::${s.id}`));
  const pruned: DroppedSession[] = input.authoritative
    ? retainCandidates
        .filter((s) => !retainedKeys.has(`${s.botName || 'default'}::${s.id}`))
        .map((s) => ({
          sessionId: s.id,
          profile: sessionProfileKey(s),
          title: s.title,
          reason: 'superseded-by-authority' as const,
        }))
    : [];

  const sessions = [...stillPending, ...visible];
  for (const oldS of retained) {
    if (!sessions.some((cur) => cur.id === oldS.id && cur.botName === oldS.botName)) {
      sessions.push(oldS);
    }
  }
  sessions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  return { sessions, pendingIds: nextPendingIds, dropped: report.dropped, pruned };
}
