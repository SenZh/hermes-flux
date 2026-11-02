/**
 * 回滚事务纯逻辑（packages/desktop/src/renderer/rollbackTransaction.ts）
 *
 * 【设计意图 (Why)】
 * 回滚 UX 必须“点击即消失”：本地立即裁撤目标提问及其后续消息，同时保留完整快照，
 * 供取消回滚、发送失败、切换会话三条路径原子恢复。删除与恢复的分解律在这里一次定义，
 * 渲染层只做编排，单测/CDP 与生产共享同一实现。
 *
 * 【防范的历史坑 (Pitfall)】
 * - 只删不备：截断失败后消息永久丢失（上一版的真实事故）；
 * - 用旧下标当切点：armed 之后消息列表可能因流式追加/持久化对账变化，必须按锚点重算；
 * - 恢复写回时把快照与新行混插：恢复即“整体替换为该时刻快照 + 追加期间不动”，
 *   快照捕获的就是删除瞬间的完整列表。
 *
 * 【约束与规则 (Rules)】
 * - 纯函数零变异；wire 载荷字段绝不在此文件出现（截断参数由 core InteractiveService 构造）。
 */

import type { MessageViewModel } from '@hermes-flux/ui';
import {
  resolveCutIndexByAnchor,
  splitAt,
  type TruncateAnchor,
} from '@hermes-flux/core';

/**
 * 进入回滚：按锚点重算切点并乐观裁撤。
 * 锚点在列表中消失（被压缩/外部客户端删除）时返回 null，调用方必须放弃截断保持原状。
 */
export function applyOptimisticCut(
  messages: MessageViewModel[],
  anchor: TruncateAnchor
): { kept: MessageViewModel[]; removed: MessageViewModel[] } | null {
  const cut = resolveCutIndexByAnchor(messages, anchor);
  if (cut < 0) return null;
  return splitAt(messages, cut);
}

/**
 * 消费并清除某会话的 server-priority 权威标记（截断成功后的防复活一次性开关）。
 * 抽出为纯函数以便对"读取即删除"接线本身做落盘证伪（否则删掉接线两行测试仍全绿）。
 */
export function takeServerPriority(
  trust: Map<string, 'server-priority'>,
  sessionId: string
): boolean {
  const isPriority = trust.get(sessionId) === 'server-priority';
  if (isPriority) trust.delete(sessionId);
  return isPriority;
}

/**
 * 权威加载合并决策（P0-1 防复活核心不变量的唯一裁决点）。
 * 语义：
 * - serverPriority=true（刚发生历史截断成功）：无条件以服务端为准，绝不"保留更长本地"，
 *   否则会把被有意删除的消息复活；
 * - 否则维持 Failure-Is-Not-Empty：本地比权威长且能对齐服务端末尾时，保留本地未落盘尾部；
 *   无法对齐（不同源）则整体保留本地更长列表，等待后续对账。
 * 纯函数、零变异，供单测正向/负向/慢响应竞态穷尽证伪。
 */
export function planSessionLoadMerge<T extends { id: string }>(
  parsed: readonly T[],
  existing: readonly T[] | undefined,
  serverPriority: boolean
): T[] {
  if (serverPriority) return [...parsed];
  if (existing && existing.length > parsed.length) {
    const lastParsed = parsed[parsed.length - 1];
    const matchIdx = lastParsed ? existing.findIndex((m) => m.id === lastParsed.id) : -1;
    if (matchIdx >= 0 && matchIdx < existing.length - 1) {
      return [...parsed, ...existing.slice(matchIdx + 1)];
    }
    return [...existing];
  }
  return [...parsed];
}

/**
 * 离开会话时对挂起回滚的恢复决策（P0-2 防跨会话泄漏的唯一裁决点）。
 * armed 为空或 sessionId 不匹配当前会话时不动消息，只丢弃 armed。
 */
export function planRollbackLeaveRestore(
  armed: { sessionId: string; snapshot: MessageViewModel[] } | null,
  outgoingSessionId: string | null
): { restoreSessionId: string; restore: MessageViewModel[] } | null {
  if (!armed) return null;
  if (outgoingSessionId && armed.sessionId !== outgoingSessionId) {
    // armed 不属于正在离开的会话：仅丢弃，绝不把它的快照写进别的会话缓存
    return null;
  }
  return {
    restoreSessionId: armed.sessionId,
    restore: armed.snapshot.map((m) => ({ ...m })),
  };
}
