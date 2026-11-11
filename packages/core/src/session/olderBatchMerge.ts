/**
 * 历史消息批次向上拼接与安全合并纯函数 (packages/core/src/session/olderBatchMerge.ts)
 *
 * 【设计意图 (Why)】
 *   向早翻页（Prepend）拉取回来的批次为更早的历史行，严禁使用正向追加的 planSessionLoadMerge，
 *   否则在批次较短且无重叠时会被判定为不同源而直接丢弃。
 *   必须专设纯函数处理头部拼接、重叠去重、分页游标推进与跨会话时间线隔离。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. planSessionLoadMerge 短路分支将无重叠更早历史 100% 丢弃；
 *   2. 机械 [...batch, ...existing] 在分页重叠时导致同一条消息重复渲染两份；
 *   3. 网关物理 rowId 不单调于 display order：用 rowId 大小猜测早晚会丢失首问或放行晚数天的消息；
 *   4. planOlderPagination 命中批内下标时方向算反（queryOffset + indexInBatch + 1），
 *      导致每次翻页只往前蠕动 1 到几条甚至 8 次重试耗尽提前断尾。
 *
 * 【约束与规则 (Rules)】
 *   - 纯函数，零 IO，输入不可变；
 *   - 忠实保留服务端返回展示序（仅在相邻时间戳多数递减时整体反转），严禁按 rowId 重排同秒消息；
 *   - 以 (sessionId, rowId) 复合键作唯一去重依据，杜绝父子会话局部 rowId 碰撞。
 */

export interface MinimalIdentifiedMessage {
  id: string;
  sessionId?: string;
  rowId?: number;
  rawTimestamp?: number;
  timestamp?: string | number;
  displayKind?: string;
}

/** 将秒级与毫秒级时间戳统一归一化到毫秒，仅用于边界方向对比。 */
function normalizeEpochMs(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined;
  return raw < 1e11 ? raw * 1000 : raw;
}

/**
 * 本地已覆盖行数下界。
 *
 * 【设计意图 (Why)】
 *   网关 `/messages` 的 offset 是「从最新端跳过的持久行数」，而本地列表是视图消息
 *   （工具行被吸收、隐藏行被过滤），条数只会少于行数。用视图条数作下界，
 *   保证翻页起点一定落在本地已覆盖区间内，绝不跳过未加载的真实历史。
 * 【约束与规则 (Rules)】只统计有持久 rowId 的行；带 sessionId 且不属于当前会话的行
 *   （父会话血缘）不计入。缺 sessionId 的缓存恢复行按计入处理，
 *   由翻页侧的一次性「高估回退」兜底，绝不因此把服务端仍有的一整段历史判成已到最早。
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
  /** 现有游标：已确认从最新端覆盖的原始行数 */
  storedOffset: number;
  /** 本地已覆盖行数下界（countLocalCoveredRows 的结果） */
  localCoveredRows: number;
  /** 本批网关返回原始行数；为 0 表示只求请求起点 */
  returned: number;
  /** 本批按展示序升序的持久行 id（保留参数兼容既有签名） */
  batchRowIds: readonly number[];
  /** 本地最早一条持久行 id（保留参数兼容既有签名） */
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
 *   网关 `/messages?order=latest` 按服务端展示序从最新端跳过 `offset` 行，再返回 `returned` 行
 *   （数组从旧到新排列）。只要本批 `returned` 行已完整交付合并，游标必须单调跳过这 `returned` 行。
 * 【防范的历史坑 (Pitfall)】
 *   旧实现误以为 `batchRowIds` 是按最新到最旧排列，命中本地最早行时写成 `queryOffset + indexInBatch + 1`：
 *   当本地早已覆盖到批首（`indexInBatch = 0`）时游标仅推进 1 行，导致每次只多拉 1~3 条消息蠕动，
 *   甚至消耗完 `MAX_PAGE_ATTEMPTS = 8` 后直接被判为已到最早历史而永久断尾。
 * 【约束与规则 (Rules)】
 *   1. 纯函数、零 IO；
 *   2. `queryOffset = Math.max(storedOffset, localCoveredRows)`；
 *   3. `nextOffset = queryOffset + returned`，严格满足单调不减且不越界上界。
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

  return { queryOffset, nextOffset: queryOffset + returned };
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

export interface OlderBatchMergeResult<T> {
  merged: T[];
  /**
   * 被「更早边界」丢弃且本地确实没有的行数。
   *
   * 【设计意图 (Why)】调用方必须能够区分两种「净增为 0」：整批都是已持有的重复行
   *   （游标可推进），与整批被边界过滤（推进游标就是永久丢掉这段历史）。
   */
  droppedCount: number;
}

export function planOlderBatchPrependMerge<T extends MinimalIdentifiedMessage>(
  olderBatch: readonly T[],
  currentMessages: readonly T[],
  options?: OlderBatchMergeOptions
): T[] {
  return planOlderBatchPrependMergeDetailed(olderBatch, currentMessages, options).merged;
}

/**
 * 保持服务端返回的展示序，仅当多数非 hidden 相邻行明确为降序（DESC）时整体反转。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 使用 `sort((a, b) => ta - tb || ra - rb)` 会把同秒且物理 id 逆序的服务端批次
 *      （如 `[18542, 17400]`）强行重排颠倒；
 *   2. 仅比较首尾两条时间戳，若批首恰好缺时间戳（回退成 `Date.now()`）会把整批升序历史倒置。
 */
function preserveAscendingOrder<T extends MinimalIdentifiedMessage>(
  batch: readonly T[],
  timelineId?: string,
  fallbackId?: string
): T[] {
  if (batch.length < 2) return [...batch];
  const inScope = timelineId
    ? batch.filter((m) => (m.sessionId ?? fallbackId) === timelineId)
    : batch;
  const target = inScope.length >= 2 ? inScope : batch;

  const visibleOrAll = target.filter((m) => m.displayKind !== 'hidden');
  const sample = visibleOrAll.length >= 2 ? visibleOrAll : target;

  let ascPairs = 0;
  let descPairs = 0;
  let prevTs: number | undefined;
  for (const row of sample) {
    const ts = normalizeEpochMs(row.rawTimestamp);
    if (ts === undefined) continue;
    if (prevTs !== undefined) {
      if (ts > prevTs) ascPairs += 1;
      else if (ts < prevTs) descPairs += 1;
    }
    prevTs = ts;
  }

  if (descPairs > ascPairs) {
    return [...batch].reverse();
  }
  return [...batch];
}

/**
 * 与 `planOlderBatchPrependMerge` 同源，额外回传被丢弃行数。
 *
 * 【约束与规则 (Rules)】纯函数、零 IO，两处导出共用同一份实现，禁止各写一套边界判定。
 */
export function planOlderBatchPrependMergeDetailed<T extends MinimalIdentifiedMessage>(
  olderBatch: readonly T[],
  currentMessages: readonly T[],
  options?: OlderBatchMergeOptions
): OlderBatchMergeResult<T> {
  const timelineId = options?.timelineSessionId;
  const fallbackId = options?.fallbackSessionId;
  const belongsToTimeline = (m: T): boolean =>
    Boolean(timelineId) && (m.sessionId ?? fallbackId) === timelineId;

  if (!olderBatch || olderBatch.length === 0) {
    return { merged: currentMessages ? [...currentMessages] : [], droppedCount: 0 };
  }
  if (!currentMessages || currentMessages.length === 0) {
    return { merged: preserveAscendingOrder(olderBatch, timelineId, fallbackId), droppedCount: 0 };
  }

  const normalizedOlder = preserveAscendingOrder(olderBatch, timelineId, fallbackId);

  // 构造复合唯一去重键：(sessionId, rowId) 复合键优先，彻底杜绝父子会话局部 rowId 碰撞
  const compositeKey = (m: T): string => {
    const sess = m.sessionId || fallbackId || '';
    if (typeof m.rowId === 'number' && m.rowId > 0) {
      return sess ? `${sess}::row::${m.rowId}` : `row::${m.rowId}`;
    }
    return sess ? `${sess}::id::${m.id}` : `id::${m.id}`;
  };

  const insertionIndex = (() => {
    if (!timelineId) return 0;
    const index = currentMessages.findIndex((m) => belongsToTimeline(m));
    return index >= 0 ? index : 0;
  })();

  const isDurableTimelineAnchor = (m: T): boolean =>
    typeof m.rowId === 'number' && m.rowId > 0 && (!timelineId || belongsToTimeline(m));

  /**
   * 选定无共享行时的时间线参考锚点。
   * 【约束】若首条持久行是 `hidden` 机器行且其时间戳反而比同时间线紧邻可见行更晚（压缩摘要常带
   *   压缩发生时刻），跳过该畸变机器行；若首条 `hidden` 确实更早则保留它作为上界。
   */
  const firstDurable = currentMessages.find(isDurableTimelineAnchor);
  const firstVisibleDurable = currentMessages.find((m) => isDurableTimelineAnchor(m) && m.displayKind !== 'hidden');
  const anchor = (() => {
    if (!firstDurable) return undefined;
    if (firstDurable.displayKind !== 'hidden' || !firstVisibleDurable) return firstDurable;
    const hiddenTs = normalizeEpochMs(firstDurable.rawTimestamp);
    const visibleTs = normalizeEpochMs(firstVisibleDurable.rawTimestamp);
    if (hiddenTs !== undefined && visibleTs !== undefined && hiddenTs > visibleTs) {
      return firstVisibleDurable;
    }
    return firstDurable;
  })();

  const isSameTimelineRow = (m: T): boolean => {
    if (!anchor) return false;
    return timelineId
      ? belongsToTimeline(m)
      : !m.sessionId || !anchor.sessionId || m.sessionId === anchor.sessionId;
  };

  const timelineHeldKeys = new Set<string>();
  const allHeldKeys = new Set<string>();
  for (const m of currentMessages) {
    const k = compositeKey(m);
    allHeldKeys.add(k);
    if (!timelineId || belongsToTimeline(m)) {
      timelineHeldKeys.add(k);
    }
  }

  /**
   * 方向与边界判定（两段式权威规则）：
   *
   * 【设计意图 (Why)】
   *   1. 存在共享行时：以服务端返回序列中首个命中的本地同时间线行作为精确边界，
   *      只放行该共享边界之前的行，绝不用物理 rowId 大小比较破坏乱序首问或同秒序；
   *   2. 无共享行时：禁止用 `m.rowId < anchor.rowId` 放行更晚行（实测在 41432 锚点前放行
   *      晚 17 天的 40695 制造时间倒挂），改用统一毫秒时间戳 `rowTs <= anchorTs` 判定，
   *      仅在任一方缺失数字时间戳时保守回退 `m.rowId < anchor.rowId`。
   *
   * 【约束与规则 (Rules)】跨时间线（父会话血缘）行不参与本会话边界过滤，直接保留并去重。
   */
  const firstTimelineOverlapIdx = normalizedOlder.findIndex(
    (m) => isSameTimelineRow(m) && timelineHeldKeys.has(compositeKey(m))
  );

  let boundedOlder: T[];
  let droppedUnseenCount = 0;

  if (firstTimelineOverlapIdx >= 0) {
    boundedOlder = normalizedOlder.filter((m, idx) => {
      if (!isSameTimelineRow(m)) return true;
      return idx < firstTimelineOverlapIdx;
    });
    droppedUnseenCount = normalizedOlder.filter((m, idx) => {
      if (!isSameTimelineRow(m)) return false;
      return idx >= firstTimelineOverlapIdx && !allHeldKeys.has(compositeKey(m));
    }).length;
  } else {
    const anchorTs = anchor ? normalizeEpochMs(anchor.rawTimestamp) : undefined;
    const isRowEarlier = (m: T): boolean => {
      if (!anchor || typeof anchor.rowId !== 'number') return true;
      if (typeof m.rowId !== 'number' || !(m.rowId > 0)) return true;
      if (!isSameTimelineRow(m)) return true;
      const rowTs = normalizeEpochMs(m.rawTimestamp);
      if (rowTs !== undefined && anchorTs !== undefined) {
        return rowTs <= anchorTs;
      }
      // 本行缺时间戳但同批后续同时间线可见行有有效更早时间戳时，沿用批方向放行，不被错序 rowId 误杀
      if (rowTs === undefined && anchorTs !== undefined) {
        const idx = normalizedOlder.indexOf(m);
        for (let j = idx + 1; j < normalizedOlder.length; j += 1) {
          const next = normalizedOlder[j];
          if (!isSameTimelineRow(next) || next.displayKind === 'hidden') continue;
          const nextTs = normalizeEpochMs(next.rawTimestamp);
          if (nextTs !== undefined) return nextTs <= anchorTs;
        }
      }
      return m.rowId < anchor.rowId;
    };

    // 无共享行时只取连续前缀：一旦本时间线遇到严格晚于锚点的非 hidden 行即截断其后本时间线行，
    // 既杜绝批尾混入更晚片段，又保证「首次无共享 -> 二次有共享」合并严格幂等。
    let cutoffIdx = normalizedOlder.length;
    for (let i = 0; i < normalizedOlder.length; i += 1) {
      const m = normalizedOlder[i];
      if (!isSameTimelineRow(m)) continue;
      if (m.displayKind === 'hidden') continue;
      if (!isRowEarlier(m)) {
        cutoffIdx = i;
        break;
      }
    }

    const hasAcceptedInPrefix = normalizedOlder.some((m, idx) =>
      idx < cutoffIdx && isSameTimelineRow(m) && isRowEarlier(m)
    );

    boundedOlder = normalizedOlder.filter((m, idx) => {
      if (!isSameTimelineRow(m)) return true;
      if (idx >= cutoffIdx) return false;
      if (m.displayKind === 'hidden' && hasAcceptedInPrefix) return true;
      return isRowEarlier(m);
    });
    const acceptedSet = new Set(boundedOlder);
    droppedUnseenCount = normalizedOlder.filter(
      (m) => !acceptedSet.has(m) && !allHeldKeys.has(compositeKey(m))
    ).length;
  }

  const spliceOlder = (older: readonly T[]): T[] => [
    ...currentMessages.slice(0, insertionIndex),
    ...older,
    ...currentMessages.slice(insertionIndex),
  ];

  const deduplicatedOlder: T[] = [];
  for (const m of boundedOlder) {
    if (!allHeldKeys.has(compositeKey(m))) {
      deduplicatedOlder.push(m);
    }
  }

  return { merged: spliceOlder(deduplicatedOlder), droppedCount: droppedUnseenCount };
}
