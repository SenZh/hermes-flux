/**
 * 缓存合并纯函数（packages/core/src/cache/cacheMerge.ts）
 *
 * 【设计意图 (Why)】
 *   缓存最容易出错的不是"存"，而是"拉回来的和本地已有的怎么合"。
 *   把合并收敛成纯函数，才能用 fast-check 在随机交错下证明不变量
 *   （尤其是"拉取期间写入的新消息不被误删"）。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 用"远端最大序号"做删除上界，会删掉拉取在途期间新写入的消息。
 *      正确做法是把删除范围限制在 (remoteMax, fenceMax] 这个"确认多余"区间。
 *   2. 截断后幸存行的 rowId 会变。只删 `> 目标` 会让旧键与新键并存，同一消息显示两份。
 *      必须以网关返回的 survivor 映射为准做重绑定。
 *   3. 相同主键的两份数据直接后写覆盖，会把带思维链/工具调用的版本冲成空壳。
 *      必须按"字段完整度"择优。
 *
 * 【约束与规则 (Rules)】
 *   - 全部为纯函数，不修改入参，不做 IO；
 *   - 输出按 orderKey 升序，调用方负责持久化时再倒序；
 *   - 任何删除行为都必须有明确的"确认依据"，不允许"看起来多余就删"。
 */

import type { CachedMessageRow } from './types.js';
import { messageKey } from './ICacheStore.js';

/** 按 orderKey 升序排序，返回新数组。 */
export function sortByOrderAsc(rows: readonly CachedMessageRow[]): CachedMessageRow[] {
  return [...rows].sort((a, b) => a.orderKey - b.orderKey);
}

/**
 * 按展示顺序升序排列，返回新数组。
 *
 * 【设计意图 (Why)】
 *   网关 messages.id 与 display_order 不保证单调（官方 session_stored_reads.py:179），
 *   持久缓存恢复必须优先采用写入时记录的 `displaySeq`，缺失时回退 `orderKey`。
 * 【防范的历史坑 (Pitfall)】
 *   仅按 orderKey 排序会把物理 id 较大的会话首问（如 18541 > 17405）搬到列表中间。
 * 【约束与规则 (Rules)】
 *   纯函数，不修改入参；同 displaySeq 时以 orderKey 兜底保证稳定全序。
 */
export function sortByDisplayAsc(rows: readonly CachedMessageRow[]): CachedMessageRow[] {
  return [...rows].sort((a, b) => {
    const da = typeof a.displaySeq === 'number' ? a.displaySeq : a.orderKey;
    const db = typeof b.displaySeq === 'number' ? b.displaySeq : b.orderKey;
    if (da !== db) return da - db;
    return a.orderKey - b.orderKey;
  });
}

/**
 * 字段完整度评分：分数高者代表信息更全。
 *
 * 【规则】正文、思维链、工具调用分别计分且工具权重最高——
 * 因为工具调用一旦丢失无法从别处恢复，而正文通常还能从 REST 重拉。
 */
function richnessScore(row: CachedMessageRow): number {
  let score = 0;
  if (row.text) score += 1;
  if (row.reasoning) score += 2;
  if (row.toolCalls && row.toolCalls.length > 0) score += 3;
  if (row.status === 'complete') score += 1;
  return score;
}

/**
 * 同主键择优：分数高者胜；同分时后者胜（视为更新版本）。
 *
 * 【约束】不合并两份的字段（不做字段级并集），避免产生"半新半旧"的怪行。
 */
function pickRicher(a: CachedMessageRow, b: CachedMessageRow): CachedMessageRow {
  const winner = richnessScore(b) >= richnessScore(a) ? b : a;
  // 展示次序永远采纳最新窗口写入的 displaySeq；若新行未带 displaySeq，则保留已有值避免抹除。
  if (winner === a && typeof b.displaySeq === 'number' && a.displaySeq !== b.displaySeq) {
    return { ...a, displaySeq: b.displaySeq };
  }
  if (winner === b && typeof b.displaySeq !== 'number' && typeof a.displaySeq === 'number') {
    return { ...b, displaySeq: a.displaySeq };
  }
  return winner;
}

/**
 * 幂等 upsert：以 (profile, channel, channelId, orderKey) 为主键合并。
 *
 * 【数学性质】upsert(upsert(S, X), X) ≡ upsert(S, X)
 */
export function upsertMessageRows(
  existing: readonly CachedMessageRow[],
  incoming: readonly CachedMessageRow[]
): CachedMessageRow[] {
  const table = new Map<string, CachedMessageRow>();
  for (const row of existing) table.set(messageKey(row), row);
  for (const row of incoming) {
    const key = messageKey(row);
    const prev = table.get(key);
    table.set(key, prev ? pickRicher(prev, row) : row);
  }
  return sortByOrderAsc([...table.values()]);
}

/** 远端窗口合并入参。 */
export interface RemoteWindowMergeInput {
  /** 本地已有行 */
  local: readonly CachedMessageRow[];
  /** 本次远端返回的行（同一通道） */
  remote: readonly CachedMessageRow[];
  /**
   * 拉取发起时本地最大 orderKey。
   * 关键：它是"发请求那一刻"的快照，不是响应到达时的本地状态。
   */
  fenceMax: number;
  /** 本次远端返回的最大 orderKey；远端返回空时为 0 */
  remoteMax: number;
  /** 本端已提交但尚未被网关确认的行主键，永不被剔除 */
  pendingKeys: ReadonlySet<string>;
}

/** 远端窗口合并结果。 */
export interface RemoteWindowMergeResult {
  rows: CachedMessageRow[];
  /** 被判定为幽灵而剔除的行主键，供审计与日志 */
  evictedKeys: string[];
}

/**
 * 把一次远端窗口合并进本地，并按围栏剔除已确认的多余行。
 *
 * 【核心不变量 (Fence Invariant)】
 *   只删除同时满足以下三条的行：
 *     1. orderKey > remoteMax —— 远端完整窗口里没有它；
 *     2. orderKey <= fenceMax —— 它在本轮拉取发起前就已存在；
 *     3. 不在 pendingKeys —— 它不是本端刚提交待确认的。
 *
 * 【为什么不是 orderKey > remoteMax 全删】
 *   拉取在途期间写入的行 orderKey 必然 > fenceMax，若直接按 remoteMax 删就会误删。
 *   把上界收窄到 fenceMax，天然排除了"发起之后才出现"的行。
 *
 * 【反例（必须被此实现排除）】
 *   fenceMax=100、remoteMax=100，途中写入 101 → 删除区间 (100, 100] 为空 → 101 保留。
 */
export function mergeRemoteWindow(input: RemoteWindowMergeInput): RemoteWindowMergeResult {
  const merged = upsertMessageRows(input.local, input.remote);
  const evictedKeys: string[] = [];

  const lowerBound = input.remoteMax;
  const upperBound = Math.min(input.fenceMax, Number.MAX_SAFE_INTEGER);

  const remoteKeys = new Set<string>();
  let remoteMaxDisplaySeq: number | null = null;
  for (const r of input.remote) {
    remoteKeys.add(messageKey(r));
    if (typeof r.displaySeq === 'number') {
      remoteMaxDisplaySeq = remoteMaxDisplaySeq === null ? r.displaySeq : Math.max(remoteMaxDisplaySeq, r.displaySeq);
    }
  }

  const kept: CachedMessageRow[] = [];
  for (const row of merged) {
    const isBeyondRemote = row.orderKey > lowerBound;
    const isWithinFence = row.orderKey <= upperBound;
    const isPending = input.pendingKeys.has(messageKey(row));
    if (isBeyondRemote && isWithinFence && !isPending) {
      evictedKeys.push(messageKey(row));
      continue;
    }
    kept.push(row);
  }

  // 在途/pending 保留行若不在本次 remote 窗口内且在其之后（orderKey > remoteMax），
  // 保证其 displaySeq 严格大于 remote 最大 displaySeq 且彼此互不碰撞，既不插错又强幂等。
  if (remoteMaxDisplaySeq !== null) {
    let tailSeq = remoteMaxDisplaySeq;
    const seenTailSeq = new Set<number>();
    const toKeepTail = (row: CachedMessageRow): boolean =>
      row.orderKey > lowerBound && !remoteKeys.has(messageKey(row));
    for (const row of kept) {
      if (toKeepTail(row) && typeof row.displaySeq === 'number' && row.displaySeq > remoteMaxDisplaySeq) {
        tailSeq = Math.max(tailSeq, row.displaySeq);
      }
    }
    const adjusted = kept.map((row) => {
      if (toKeepTail(row)) {
        if (
          typeof row.displaySeq === 'number' &&
          row.displaySeq > remoteMaxDisplaySeq &&
          !seenTailSeq.has(row.displaySeq)
        ) {
          seenTailSeq.add(row.displaySeq);
          return row;
        }
        tailSeq += 1;
        seenTailSeq.add(tailSeq);
        return { ...row, displaySeq: tailSeq };
      }
      return row;
    });
    return { rows: adjusted, evictedKeys };
  }

  return { rows: kept, evictedKeys };
}

/** 截断入参。 */
export interface TruncationInput {
  rows: readonly CachedMessageRow[];
  /** 保留 orderKey <= targetOrderKey 的行（在应用 survivor 映射之后的语义） */
  targetOrderKey: number;
  /**
   * 网关 `prompt.submit` 返回的幸存行映射。
   * key 为旧 orderKey，value 为新 orderKey 或 null（null 表示该行已不可恢复）。
   * 传 null 表示没有映射可用，退化为按 target 截断。
   */
  survivorMap: ReadonlyMap<number, number | null> | null;
}

/**
 * 应用截断。
 *
 * 【设计意图 (Why)】
 *   网关在截断后会重编幸存行的 rowId。只按 target 删会留下旧键，
 *   与回拉得到的新键并存，同一消息显示两份。
 *
 * 【规则】
 *   - 有 survivorMap 时以它为唯一权威：数字 → 重绑定；null → 删除；
 *   - 不在映射里且 orderKey > target 的行，作为兜底删除；
 *   - 重绑定后若两行落到同一新键，按字段完整度择优，只保留一份。
 */
export function applyTruncation(input: TruncationInput): CachedMessageRow[] {
  const map = input.survivorMap;

  if (!map) {
    return sortByOrderAsc(input.rows.filter((row) => row.orderKey <= input.targetOrderKey));
  }

  const rebound: CachedMessageRow[] = [];
  for (const row of input.rows) {
    if (map.has(row.orderKey)) {
      const nextOrder = map.get(row.orderKey);
      if (nextOrder === null || nextOrder === undefined) continue;
      rebound.push({ ...row, orderKey: nextOrder });
      continue;
    }
    // 不在映射里：超过截断点的兜底删除
    if (row.orderKey > input.targetOrderKey) continue;
    rebound.push(row);
  }

  // 重绑定可能产生同键冲突，按主键去重并择优
  return upsertMessageRows([], rebound);
}

/**
 * 淘汰到上限：保留 orderKey 最大的 `cap` 条。
 *
 * 【规则】只按 orderKey，不看时间戳——时间戳可能同秒并列，无法定序。
 */
export function evictToCap(
  rows: readonly CachedMessageRow[],
  cap: number
): { rows: CachedMessageRow[]; evictedKeys: string[] } {
  if (cap <= 0) {
    return { rows: [], evictedKeys: rows.map(messageKey) };
  }
  const asc = sortByOrderAsc(rows);
  if (asc.length <= cap) {
    return { rows: asc, evictedKeys: [] };
  }
  const cut = asc.length - cap;
  return {
    rows: asc.slice(cut),
    evictedKeys: asc.slice(0, cut).map(messageKey),
  };
}

/** 取一组行的最大 orderKey；空数组返回 0。 */
export function maxOrderKey(rows: readonly CachedMessageRow[]): number {
  let max = 0;
  for (const row of rows) {
    if (row.orderKey > max) max = row.orderKey;
  }
  return max;
}
