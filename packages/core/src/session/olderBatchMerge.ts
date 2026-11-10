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

/**
 * 本地已覆盖行数下界。
 *
 * 【设计意图 (Why)】
 *   网关 `/messages` 的 offset 是「从最新端跳过的持久行数」，而本地列表是视图消息
 *   （工具行被吸收、隐藏行被过滤），条数只会少于行数。用视图条数作下界，
 *   保证翻页起点一定落在本地已覆盖区间内，绝不跳过未加载的真实历史。
 * 【约束与规则 (Rules)】只统计有持久 rowId 的行；带 sessionId 且不属于当前会话的行
 *   （父会话血缘）不计入。缺 sessionId 的缓存恢复行按计入处理——它可能高估，
 *   由翻页侧的一次性"高估回退"兜底，绝不因此把服务端仍有的一整段历史判成已到最早。
 */
export function countLocalCoveredRows(
  messages: readonly MinimalIdentifiedMessage[] | null | undefined,
  sessionId?: string
): number {
  if (!Array.isArray(messages)) return 0;
  let covered = 0;
  for (const message of messages) {
    if (typeof message.rowId !== 'number' || !(message.rowId > 0)) continue;
    if (sessionId && message.sessionId && message.sessionId !== sessionId) continue;
    covered += 1;
  }
  return covered;
}

export interface OlderPaginationPlanInput {
  /** 现有游标：已确认从最新端覆盖的行数 */
  storedOffset: number;
  /** 本地已覆盖行数下界（countLocalCoveredRows 的结果） */
  localCoveredRows: number;
  /** 本批网关返回行数；为 0 表示只求请求起点 */
  returned: number;
  /** 本批按网关升序的持久行 id */
  batchRowIds: readonly number[];
  /** 本地最早一条持久行 id */
  earliestLocalRowId: number | null;
}

export interface OlderPaginationPlan {
  queryOffset: number;
  nextOffset: number;
}

/**
 * 向早翻页的游标规划。
 *
 * 【设计意图 (Why)】
 *   游标必须同时满足两条：① 请求起点不小于本地已覆盖行数，否则重复拉取且每次
 *   只推进一部分，缺口累积后直接跳过整段历史；② 批次命中本地最早行时按该行的
 *   精确位置收敛，避免每轮都从头重叠。
 * 【防范的历史坑 (Pitfall)】
 *   首屏 REST 只回 100 行而合并保留了本地 1130 条视图时，旧代码把游标记成 100，
 *   之后每轮 `offset += returned(500)`，游标很快越过本地真实覆盖边界，
 *   中途一整段历史永远不再加载，最终 `returned = 0` 被误判为「已到最早」。
 * 【约束与规则 (Rules)】
 *   1. 纯函数、零 IO；
 *   2. `nextOffset` 单调不减，且不超过 `queryOffset + returned`；
 *   3. 命中本地最早行时取「保守滞后」边界：宁可多拉一轮重叠，也不跳过该行之前尚未落地的行；
 *   4. 无法定位本地最早行时按 `returned` 推进，与网关分页语义一致。
 */
export function planOlderPagination(input: OlderPaginationPlanInput): OlderPaginationPlan {
  const storedOffset = Number.isFinite(input.storedOffset) && input.storedOffset > 0
    ? Math.floor(input.storedOffset)
    : 0;
  const localCoveredRows = Number.isFinite(input.localCoveredRows) && input.localCoveredRows > 0
    ? Math.floor(input.localCoveredRows)
    : 0;
  const queryOffset = Math.max(storedOffset, localCoveredRows);
  const returned = Number.isFinite(input.returned) && input.returned > 0 ? Math.floor(input.returned) : 0;

  let nextOffset = queryOffset + returned;
  const earliest = input.earliestLocalRowId;
  if (typeof earliest === 'number' && earliest > 0) {
    const indexInBatch = input.batchRowIds.findIndex((id) => id === earliest);
    if (indexInBatch >= 0) nextOffset = queryOffset + indexInBatch + 1;
  }
  // 上界硬约束：无论批内下标如何，单轮推进都不得超过本批实际返回的行数。
  return { queryOffset, nextOffset: Math.max(queryOffset, Math.min(nextOffset, queryOffset + returned)) };
}

export interface OlderBatchMergeOptions {
  /**
   * 批次所属会话 id。
   *
   * 【设计意图 (Why)】列表头部可能已经是更早的父会话血缘行；若用「第一条有 rowId 的行」
   *   当锚点，锚点会被父行夺走，本会话更晚的行就会被整批塞到父历史之前。
   * 【约束与规则 (Rules)】提供该 id 时，锚点与插入点都只按该会话的行判定；
   *   缺省保持旧行为，供既有调用方兼容。
   */
  timelineSessionId?: string;
  /**
   * 缺失 sessionId 的行的归属会话（通常是当前叶子会话）。
   *
   * 【设计意图 (Why)】持久缓存恢复出来的行不带 sessionId；把它们当成「属于任何时间线」
   *   会让父会话批次找到错误插入点，也会让本会话批次认错锚点。
   */
  fallbackSessionId?: string;
}

export function planOlderBatchPrependMerge<T extends MinimalIdentifiedMessage>(
  olderBatch: readonly T[],
  currentMessages: readonly T[],
  options?: OlderBatchMergeOptions
): T[] {
  if (!olderBatch || olderBatch.length === 0) {
    return currentMessages ? [...currentMessages] : [];
  }
  if (!currentMessages || currentMessages.length === 0) {
    return [...olderBatch];
  }

  const timelineId = options?.timelineSessionId;
  const fallbackId = options?.fallbackSessionId;
  const belongsToTimeline = (m: T): boolean =>
    Boolean(timelineId) && (m.sessionId ?? fallbackId) === timelineId;

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

  /**
   * 只接受「严格早于本会话在本地的最早持久行」的行。
   *
   * 【防范的历史坑 (Pitfall)】
   *   游标落后于本地已覆盖行数时，网关批次会同时包含更早行、已持有行和比本地最早行
   *   更晚的行。旧实现把所有「不在当前集合」的行一律头插，等于把更晚的行搬到列表
   *   最前面：首行 rowId 反而变大、时间线倒挂。宁可丢弃无法证明更早的行（下轮还能
   *   重新拉到），也绝不允许列表失序。
   * 【约束与规则 (Rules)】
   *   1. 锚点只取 `timelineSessionId` 对应会话的行，父会话血缘行不参与比较；
   *   2. 跨会话（父会话血缘）行不参与 rowId 边界比较，继续按时间线前置。
   */
  const anchor = (
    timelineId
      ? currentMessages.find((m) => belongsToTimeline(m) && typeof m.rowId === 'number' && m.rowId > 0)
      : undefined
  ) ?? currentMessages.find((m) => typeof m.rowId === 'number' && m.rowId > 0);
  const strictlyEarlier = (m: T): boolean => {
    if (!anchor || typeof anchor.rowId !== 'number') return true;
    if (typeof m.rowId !== 'number' || !(m.rowId > 0)) return true;
    const sameTimeline = timelineId
      ? belongsToTimeline(m)
      : !m.sessionId || !anchor.sessionId || m.sessionId === anchor.sessionId;
    if (!sameTimeline) return true;
    return m.rowId < anchor.rowId;
  };
  const boundedOlder = normalizedOlder.filter(strictlyEarlier);

  /**
   * 批次插入点：跳过列表头部更早的父会话血缘行，插到本会话第一行之前。
   *
   * 【防范的历史坑 (Pitfall)】无条件 `[...older, ...current]` 会把本会话更早的批次
   *   塞到父会话历史之前，冷启动后 exhausted 标记清零时会真实发生。
   */
  const insertionIndex = (() => {
    if (!timelineId) return 0;
    const index = currentMessages.findIndex((m) => belongsToTimeline(m));
    return index >= 0 ? index : 0;
  })();
  const spliceOlder = (older: readonly T[]): T[] => [
    ...currentMessages.slice(0, insertionIndex),
    ...older,
    ...currentMessages.slice(insertionIndex),
  ];

  // 1. 查找是否存在重叠消息
  // 从 currentMessages 头部取第一条消息，看是否在 boundedOlder 中存在
  const firstCurrent = currentMessages[0];
  const overlapIdxInOlder = boundedOlder.findIndex((m) => matchKey(m, firstCurrent));

  if (overlapIdxInOlder >= 0) {
    // boundedOlder 的 [0, overlapIdxInOlder) 是纯更早的消息
    const pureOlderHead = boundedOlder.slice(0, overlapIdxInOlder);
    return spliceOlder(pureOlderHead);
  }

  // 2. 如果第一条未匹配，全量扫描 boundedOlder 中是否包含任何已存在的消息
  const currentKeySet = new Set<string>();
  for (const m of currentMessages) {
    currentKeySet.add(compositeKey(m));
  }

  const deduplicatedOlder: T[] = [];
  for (const m of boundedOlder) {
    if (!currentKeySet.has(compositeKey(m))) {
      deduplicatedOlder.push(m);
    }
  }

  return spliceOlder(deduplicatedOlder);
}
