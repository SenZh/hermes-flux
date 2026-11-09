/**
 * 历史消息批次向上拼接与安全合并纯函数 (packages/core/src/session/olderBatchMerge.ts)
 *
 * 【设计意图 (Why)】
 *   向早翻页（Prepend）拉取回来的批次为更早的历史行，严禁使用正向追加的 planSessionLoadMerge，
 *   否则在批次较短且无重叠时会被判定为不同源而直接丢弃。
 *   必须专设纯函数处理头部拼接、重叠去重与时间线单调性。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. planSessionLoadMerge 短路分支将无重叠更早历史 100% 丢弃；
 *   2. 机械 [...batch, ...existing] 在分页重叠时导致同一条消息重复渲染两份；
 *   3. 临时无 rowId 消息被错误插到头部破坏列表顺序。
 *
 * 【约束与规则 (Rules)】
 *   - 纯函数，零 IO，输入不可变；
 *   - 以 rowId 或 id 作为唯一去重依据；
 *   - 保持持久行递增全序。
 */

export interface MinimalIdentifiedMessage {
  id: string;
  sessionId?: string;
  rowId?: number;
  rawTimestamp?: number;
  timestamp?: string | number;
}

export function planOlderBatchPrependMerge<T extends MinimalIdentifiedMessage>(
  olderBatch: readonly T[],
  currentMessages: readonly T[]
): T[] {
  if (!olderBatch || olderBatch.length === 0) {
    return currentMessages ? [...currentMessages] : [];
  }
  if (!currentMessages || currentMessages.length === 0) {
    return [...olderBatch];
  }

  // 确保 olderBatch 自身是按时间/行号升序排列（防御网关 order=latest 返回从新到旧的 DESC 序列）
  const normalizedOlder = [...olderBatch].sort((a, b) => {
    const ta = typeof a.rawTimestamp === 'number' ? a.rawTimestamp : 0;
    const tb = typeof b.rawTimestamp === 'number' ? b.rawTimestamp : 0;
    if (ta && tb && ta !== tb) return ta - tb;
    const ra = typeof a.rowId === 'number' && a.rowId > 0 ? a.rowId : 0;
    const rb = typeof b.rowId === 'number' && b.rowId > 0 ? b.rowId : 0;
    return ra - rb;
  });

  // 构造复合唯一去重键：(sessionId, rowId) 复合键优先，彻底杜绝父子会话局部 rowId 碰撞
  const compositeKey = (m: T): string => {
    const sess = m.sessionId || '';
    if (typeof m.rowId === 'number' && m.rowId > 0) {
      return sess ? `${sess}::row::${m.rowId}` : `row::${m.rowId}`;
    }
    return sess ? `${sess}::id::${m.id}` : `id::${m.id}`;
  };

  const matchKey = (a: T, b: T): boolean => {
    return compositeKey(a) === compositeKey(b);
  };

  // 1. 查找是否存在重叠消息
  // 从 currentMessages 头部取第一条消息，看是否在 normalizedOlder 中存在
  const firstCurrent = currentMessages[0];
  const overlapIdxInOlder = normalizedOlder.findIndex((m) => matchKey(m, firstCurrent));

  if (overlapIdxInOlder >= 0) {
    // normalizedOlder 的 [0, overlapIdxInOlder) 是纯更早的消息
    const pureOlderHead = normalizedOlder.slice(0, overlapIdxInOlder);
    return [...pureOlderHead, ...currentMessages];
  }

  // 2. 如果第一条未匹配，全量扫描 normalizedOlder 中是否包含任何已存在的消息
  const currentKeySet = new Set<string>();
  for (const m of currentMessages) {
    currentKeySet.add(compositeKey(m));
  }

  const deduplicatedOlder: T[] = [];
  for (const m of normalizedOlder) {
    if (!currentKeySet.has(compositeKey(m))) {
      deduplicatedOlder.push(m);
    }
  }

  return [...deduplicatedOlder, ...currentMessages];
}
