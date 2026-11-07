/**
 * 内存缓存存储实现（packages/core/src/cache/MemoryCacheStore.ts）
 *
 * 【设计意图 (Why)】
 *   1. 作为形式化验证与单测的确定性存储，不依赖浏览器 API；
 *   2. 作为持久化不可用时的降级实现（磁盘满、隐私模式），保证功能不中断；
 *   3. 作为其他平台适配器的行为基准——它的语义就是接口的定义。
 *
 * 【防范的历史坑 (Pitfall)】
 *   降级实现若把写入失败吞掉且不标记，用户会在不知情的情况下丢失缓存。
 *   这里不做吞异常：失败由调用方处理，内存实现本身不会"半写"。
 *
 * 【约束与规则 (Rules)】
 *   - `putMessages` 对同一主键覆盖；
 *   - `listMessages` 按 orderKey 倒序；
 *   - 所有方法同步完成、异步返回，保证测试可确定复现。
 */

import type { CacheChannelRef, CachedMessageRow } from './types.js';
import {
  channelKey,
  type CacheIndexKey,
  type ICacheStore,
  type MessageDeleteQuery,
  type MessageListQuery,
} from './ICacheStore.js';

export class MemoryCacheStore implements ICacheStore {
  private readonly index = new Map<string, unknown>();

  /** channelKey → (orderKey → row) */
  private readonly channels = new Map<string, Map<number, CachedMessageRow>>();

  async readIndex(key: CacheIndexKey): Promise<unknown | null> {
    return this.index.has(key) ? this.index.get(key) : null;
  }

  async writeIndex(key: CacheIndexKey, value: unknown): Promise<void> {
    this.index.set(key, value);
  }

  async removeIndex(key: CacheIndexKey): Promise<void> {
    this.index.delete(key);
  }

  async putMessages(rows: readonly CachedMessageRow[]): Promise<void> {
    if (rows.length === 0) return;
    // 先按通道聚合，再一次替换，避免逐条 set 造成的中间可见态
    const staged = new Map<string, Map<number, CachedMessageRow>>();
    for (const row of rows) {
      const key = channelKey(row);
      const bucket = staged.get(key) ?? new Map<number, CachedMessageRow>();
      const prev = bucket.get(row.orderKey);
      bucket.set(row.orderKey, prev ? this.pickNewer(prev, row) : row);
      staged.set(key, bucket);
    }
    for (const [key, bucket] of staged) {
      const target = this.channels.get(key) ?? new Map<number, CachedMessageRow>();
      for (const [order, row] of bucket) target.set(order, row);
      this.channels.set(key, target);
    }
  }

  async listMessages(query: MessageListQuery): Promise<CachedMessageRow[]> {
    const bucket = this.channels.get(channelKey(query));
    if (!bucket || bucket.size === 0) return [];
    const all = [...bucket.values()].sort((a, b) => b.orderKey - a.orderKey);
    const filtered =
      typeof query.beforeOrderKey === 'number'
        ? all.filter((row) => row.orderKey < query.beforeOrderKey!)
        : all;
    return filtered.slice(0, Math.max(0, query.limit));
  }

  async deleteMessages(query: MessageDeleteQuery): Promise<number> {
    const key = channelKey(query);
    const bucket = this.channels.get(key);
    if (!bucket) return 0;
    if (typeof query.aboveOrderKey !== 'number') {
      const removed = bucket.size;
      this.channels.delete(key);
      return removed;
    }
    let removed = 0;
    for (const order of [...bucket.keys()]) {
      if (order > query.aboveOrderKey) {
        bucket.delete(order);
        removed += 1;
      }
    }
    if (bucket.size === 0) this.channels.delete(key);
    return removed;
  }

  async countMessages(ref: CacheChannelRef): Promise<number> {
    return this.channels.get(channelKey(ref))?.size ?? 0;
  }

  async trimChannel(ref: CacheChannelRef, keep: number): Promise<number> {
    const key = channelKey(ref);
    const bucket = this.channels.get(key);
    if (!bucket) return 0;
    const safeKeep = Math.max(0, Math.floor(keep));
    if (bucket.size <= safeKeep) return 0;
    const orders = [...bucket.keys()].sort((a, b) => a - b);
    const cut = bucket.size - safeKeep;
    let removed = 0;
    for (const order of orders.slice(0, cut)) {
      bucket.delete(order);
      removed += 1;
    }
    if (bucket.size === 0) this.channels.delete(key);
    return removed;
  }

  async dropChannel(ref: CacheChannelRef): Promise<number> {
    const key = channelKey(ref);
    const bucket = this.channels.get(key);
    const removed = bucket?.size ?? 0;
    this.channels.delete(key);
    return removed;
  }

  /** 同主键覆盖时的择优：状态为 complete 且字段更多者优先，保持与纯函数一致。 */
  private pickNewer(prev: CachedMessageRow, next: CachedMessageRow): CachedMessageRow {
    const score = (row: CachedMessageRow): number => {
      let s = 0;
      if (row.text) s += 1;
      if (row.reasoning) s += 2;
      if (row.toolCalls && row.toolCalls.length > 0) s += 3;
      if (row.status === 'complete') s += 1;
      return s;
    };
    return score(next) >= score(prev) ? next : prev;
  }
}
