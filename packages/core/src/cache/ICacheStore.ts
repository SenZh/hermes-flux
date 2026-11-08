/**
 * 缓存存储抽象（packages/core/src/cache/ICacheStore.ts）
 *
 * 【设计意图 (Why)】
 *   core 层零 DOM / 零宿主持久化 API，但缓存逻辑必须跨端复用。
 *   因此把"存储怎么做"抽成接口：桌面用 IndexedDB，移动端可换 MMKV/SQLite，
 *   测试用内存实现。core 只依赖接口，不依赖任何具体介质。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 直接复用已有的 `IStorage`（纯 KV）会让消息查询退化为"全量 getKeys 再过滤"，
 *      10 万条消息每次打开会话都全扫一遍，主线程直接卡死。
 *   2. 让壳层各自实现"先读后写"的合并逻辑，会出现两端不同的对账结果。
 *      合并必须是纯函数，存储只负责搬字节。
 *
 * 【约束与规则 (Rules)】
 *   - 所有方法异步；实现必须保证单次 `putMessages` 内部原子（要么全写，要么不写）；
 *   - `listMessages` 必须按 `orderKey` 倒序（最新在前）；
 *   - 存储层不做任何业务判断（不判权威、不判墓碑、不判 fence）。
 */

import type { CacheChannelRef, CachedMessageRow } from './types.js';

/** 索引键：会话索引、Agent 索引、头像表、同步元数据、多网关注册表、通用设置。 */
export type CacheIndexKey = 'sessions' | 'agents' | 'avatars' | 'sync-meta' | 'gateways' | 'settings';

/** 消息列表查询。 */
export interface MessageListQuery extends CacheChannelRef {
  /** 最多返回多少条（倒序取最新） */
  limit: number;
  /** 只取 orderKey < beforeOrderKey 的行（分页用），缺省表示不限 */
  beforeOrderKey?: number;
}

/** 消息删除条件。不传 `aboveOrderKey` 表示删除该通道全部消息。 */
export interface MessageDeleteQuery extends CacheChannelRef {
  aboveOrderKey?: number;
}

export interface ICacheStore {
  /** 读取索引信封。返回 null 表示不存在或不可读。 */
  readIndex(key: CacheIndexKey): Promise<unknown | null>;

  /** 写入索引信封。实现必须整键覆盖，不做部分合并。 */
  writeIndex(key: CacheIndexKey, value: unknown): Promise<void>;

  /** 删除索引键（信封损坏或版本不符时使用）。 */
  removeIndex(key: CacheIndexKey): Promise<void>;

  /** 批量 upsert 消息行，主键冲突时覆盖。 */
  putMessages(rows: readonly CachedMessageRow[]): Promise<void>;

  /** 按通道倒序取消息。 */
  listMessages(query: MessageListQuery): Promise<CachedMessageRow[]>;

  /** 按条件删除消息，返回删除条数。 */
  deleteMessages(query: MessageDeleteQuery): Promise<number>;

  /** 统计通道消息条数。 */
  countMessages(ref: CacheChannelRef): Promise<number>;

  /** 只保留最近 `keep` 条，删除更旧的，返回删除条数。 */
  trimChannel(ref: CacheChannelRef, keep: number): Promise<number>;

  /** 清空该通道全部消息（删除会话时使用）。 */
  dropChannel(ref: CacheChannelRef): Promise<number>;
}

/** 把通道引用拼成稳定字符串键，供内存实现与日志使用。 */
export function channelKey(ref: CacheChannelRef): string {
  return `${ref.profile}\u0000${ref.channel}\u0000${ref.channelId}`;
}

/** 消息行主键，四元组。 */
export function messageKey(row: CachedMessageRow): string {
  return `${row.profile}\u0000${row.channel}\u0000${row.channelId}\u0000${row.orderKey}`;
}

/** 范围模式：全量 / 列表上界 / 删除下界。 */
export type ChannelBoundMode = 'full' | 'list-before' | 'delete-above';

/** 数组主键区间。 */
export interface ChannelBounds {
  /** [profile, channel, channelId, 下界 orderKey] */
  lower: [string, string, string, number];
  /** [profile, channel, channelId, 上界 orderKey] */
  upper: [string, string, string, number];
}

/**
 * 构造通道主键区间。
 *
 * 【设计意图 (Why)】
 *   IndexedDB 的游标区间边界写错不会报错，只会多带或少带一行。
 *   把它抽成纯函数，才能在 Node 里用确定性用例钉住，而不是依赖浏览器手测。
 *
 * 【规则】
 *   - 四元组前三项固定为该通道，保证不跨 profile / channel / channelId；
 *   - `list-before` 表示 `orderKey < boundary`，实现为 `upper = boundary - 1`；
 *   - `delete-above` 表示 `orderKey > boundary`，实现为 `lower = boundary + 1`；
 *   - 三种模式都使用闭区间，由调用方保证 boundary 为整数。
 */
export function buildChannelBounds(
  ref: CacheChannelRef,
  mode: ChannelBoundMode,
  boundary?: number
): ChannelBounds {
  const prefix: [string, string, string] = [ref.profile, ref.channel, ref.channelId];

  if (mode === 'list-before' && typeof boundary === 'number') {
    return {
      lower: [...prefix, 0],
      upper: [...prefix, boundary - 1],
    };
  }

  if (mode === 'delete-above' && typeof boundary === 'number') {
    return {
      lower: [...prefix, boundary + 1],
      upper: [...prefix, Number.MAX_SAFE_INTEGER],
    };
  }

  return {
    lower: [...prefix, 0],
    upper: [...prefix, Number.MAX_SAFE_INTEGER],
  };
}
