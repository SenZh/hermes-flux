/**
 * 缓存服务（packages/core/src/cache/CacheService.ts）
 *
 * 【设计意图 (Why)】
 *   把"读旧值 → 算合并 → 写回"收敛到一个服务里，避免壳层各处自行编排。
 *   缓存最容易出的两类事故——并发写互相覆盖、删除时机错了——都源于
 *   合并与写入分散在多个调用点。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 两个并发拉取各自读旧值再写回，后写者会覆盖先写者。这里对同一通道加串行锁。
 *   2. 索引信封版本变化后强行按新结构读旧数据，产生静默错误值。这里版本不符直接丢弃。
 *   3. 淘汰只按条数不看 orderKey，会把刚写入的新消息当最旧删掉。淘汰只看 orderKey。
 *
 * 【约束与规则 (Rules)】
 *   - 所有写操作对同一通道串行；不同通道互不阻塞；
 *   - 索引写入是整键覆盖，由调用方传入完整数组；
 *   - 服务不做网络请求，不读协议，不判权威——权威判断属于调用方。
 */

import type { CacheChannelRef, CachedAgentSummary, CachedMessageRow, CachedSessionSummary } from './types.js';
import { CACHE_SCHEMA_VERSION, createEnvelope, isReadableEnvelope } from './types.js';
import type { ICacheStore } from './ICacheStore.js';
import { channelKey, messageKey } from './ICacheStore.js';
import { applyTruncation, evictToCap, maxOrderKey, mergeRemoteWindow, upsertMessageRows } from './cacheMerge.js';

/** 默认结构性上限。 */
export const DEFAULT_SESSION_CAP = 200;
export const DEFAULT_MESSAGE_CAP = 5000;

export interface CacheServiceOptions {
  /** 会话索引池上限（会话 + 群聊共享） */
  sessionCap?: number;
  /** 单通道消息行上限 */
  messageCap?: number;
  /** 时钟注入，便于测试 */
  now?: () => number;
}

/** 打开通道的结果：既有行 + 拉取围栏基线。 */
export interface OpenChannelResult {
  rows: CachedMessageRow[];
  /** 本地当前最大 orderKey，调用方必须在发起远端拉取前保存它 */
  fenceMax: number;
}

/** 追加结果。 */
export interface AppendResult {
  written: number;
  evictedKeys: string[];
}

/** 远端窗口应用结果。 */
export interface ApplyRemoteWindowResult {
  rows: CachedMessageRow[];
  evictedKeys: string[];
  remoteMax: number;
}

export class CacheService {
  private readonly store: ICacheStore;
  private readonly sessionCap: number;
  private readonly messageCap: number;
  private readonly now: () => number;

  /** 通道级串行锁：key → 队尾 promise */
  private readonly channelTails = new Map<string, Promise<unknown>>();

  constructor(store: ICacheStore, options: CacheServiceOptions = {}) {
    this.store = store;
    this.sessionCap = Math.max(1, options.sessionCap ?? DEFAULT_SESSION_CAP);
    this.messageCap = Math.max(1, options.messageCap ?? DEFAULT_MESSAGE_CAP);
    this.now = options.now ?? (() => Date.now());
  }

  // ────────────────────────────── 索引 ──────────────────────────────

  /** 读取会话索引；版本不符或损坏时返回空数组并清掉该键。 */
  async readSessions(): Promise<CachedSessionSummary[]> {
    return this.readIndexList<CachedSessionSummary>('sessions', isSessionSummary);
  }

  /** 写入会话索引，按上限裁剪（全局按 timestamp 倒序保留最新）。 */
  async writeSessions(rows: readonly CachedSessionSummary[]): Promise<CachedSessionSummary[]> {
    const sorted = [...rows].sort((a, b) => b.timestamp - a.timestamp);
    const kept = sorted.slice(0, this.sessionCap);
    await this.store.writeIndex('sessions', createEnvelope(kept, this.now()));
    return kept;
  }

  /** 读取 Agent 索引。 */
  async readAgents(): Promise<CachedAgentSummary[]> {
    return this.readIndexList<CachedAgentSummary>('agents', isAgentSummary);
  }

  /** 写入 Agent 索引。 */
  async writeAgents(rows: readonly CachedAgentSummary[]): Promise<void> {
    await this.store.writeIndex('agents', createEnvelope([...rows], this.now()));
  }

  /** 读取头像表（name → dataUrl）。 */
  async readAvatars(): Promise<Record<string, string>> {
    const raw = await this.store.readIndex('avatars');
    if (!isReadableEnvelope(raw)) {
      if (raw !== null) await this.store.removeIndex('avatars');
      return {};
    }
    const items = raw.items;
    if (!items || typeof items !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(items as Record<string, unknown>)) {
      if (isImageDataUrl(value)) {
        out[key] = value;
      }
    }
    return out;
  }

  /** 写入头像表。非 data:image/ 前缀的项会被丢弃，防止半截写入产生裂图。 */
  async writeAvatars(items: Record<string, string>): Promise<void> {
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(items)) {
      if (isImageDataUrl(value)) clean[key] = value;
    }
    await this.store.writeIndex('avatars', createEnvelope(clean, this.now()));
  }

  // ────────────────────────────── 消息 ──────────────────────────────

  /** 打开通道：倒序取最新 limit 行，并给出 fence 基线。 */
  async openChannel(ref: CacheChannelRef, limit: number): Promise<OpenChannelResult> {
    const rows = await this.store.listMessages({ ...ref, limit });
    return { rows, fenceMax: maxOrderKey(rows) };
  }

  /**
   * 向上翻页读取更早历史消息行。
   *
   * 【设计意图 (Why)】
   *   支持向上滚动时优先命中本地缓存，避免每翻一页都必须发起网络请求。
   * 【防范的历史坑 (Pitfall)】
   *   必须走 withChannelLock 通道串行锁，防止读取与并发写入产生脏交错。
   * 【约束与规则 (Rules)】
   *   按通道加串行锁；按 orderKey 倒序返回满足 orderKey < beforeOrderKey 的行。
   */
  async readOlderRows(
    ref: CacheChannelRef,
    beforeOrderKey: number,
    limit: number
  ): Promise<CachedMessageRow[]> {
    return this.withChannelLock(ref, async () => {
      return this.store.listMessages({ ...ref, beforeOrderKey, limit });
    });
  }

  /**
   * 追加/更新消息行（实时推送路径）。
   *
   * 【规则】写入后立即按 `messageCap` 淘汰最旧；淘汰只看 orderKey。
   */
  async appendRows(ref: CacheChannelRef, rows: readonly CachedMessageRow[]): Promise<AppendResult> {
    return this.withChannelLock(ref, async () => {
      if (rows.length === 0) return { written: 0, evictedKeys: [] };
      let toWrite: readonly CachedMessageRow[] = rows;
      if (rows.some((r) => typeof r.displaySeq !== 'number')) {
        const existing = await this.store.listMessages({ ...ref, limit: this.messageCap });
        const existingByKey = new Map<string, CachedMessageRow>();
        let maxSeq = 0;
        for (const r of existing) {
          existingByKey.set(messageKey(r), r);
          if (typeof r.displaySeq === 'number' && r.displaySeq > maxSeq) {
            maxSeq = r.displaySeq;
          }
        }
        for (const r of rows) {
          if (typeof r.displaySeq === 'number' && r.displaySeq > maxSeq) {
            maxSeq = r.displaySeq;
          }
        }
        toWrite = rows.map((r) => {
          if (typeof r.displaySeq === 'number') return r;
          const prev = existingByKey.get(messageKey(r));
          if (prev && typeof prev.displaySeq === 'number') {
            return { ...r, displaySeq: prev.displaySeq };
          }
          maxSeq += 1;
          return { ...r, displaySeq: maxSeq };
        });
      }
      await this.store.putMessages(toWrite);
      const evicted = await this.trimChannel(ref);
      return { written: toWrite.length, evictedKeys: evicted };
    });
  }

  /**
   * 应用一次远端窗口（打开会话 / 分页拉取）。
   *
   * 【核心】fenceMax 必须是调用方在**发起请求前**从 `openChannel` 或上一次结果中取得的基线；
   * 传响应到达时的本地最大值会把围栏失效。
   */
  async applyRemoteWindow(
    ref: CacheChannelRef,
    remote: readonly CachedMessageRow[],
    fenceMax: number,
    pendingKeys: ReadonlySet<string> = new Set<string>()
  ): Promise<ApplyRemoteWindowResult> {
    return this.withChannelLock(ref, async () => {
      const local = await this.store.listMessages({ ...ref, limit: this.messageCap });
      const remoteMax = maxOrderKey(remote);
      const merged = mergeRemoteWindow({ local, remote, fenceMax, remoteMax, pendingKeys });

      const trimmed = evictToCap(merged.rows, this.messageCap);
      const evictedKeys = [...merged.evictedKeys, ...trimmed.evictedKeys];

      // 整体替换该通道：先清后写，保证不残留被围栏判定为幽灵的旧行
      await this.store.deleteMessages({ ...ref });
      if (trimmed.rows.length > 0) await this.store.putMessages(trimmed.rows);

      return { rows: [...trimmed.rows].reverse(), evictedKeys, remoteMax };
    });
  }

  /**
   * 应用截断。
   *
   * 【规则】只在网关确认成功后调用；`armed` 阶段禁止触碰存储。
   */
  async truncate(
    ref: CacheChannelRef,
    targetOrderKey: number,
    survivorMap: ReadonlyMap<number, number | null> | null
  ): Promise<{ rows: CachedMessageRow[]; removed: number }> {
    return this.withChannelLock(ref, async () => {
      const local = await this.store.listMessages({ ...ref, limit: this.messageCap });
      const next = applyTruncation({ rows: local, targetOrderKey, survivorMap });
      const removed = local.length - next.length;

      await this.store.deleteMessages({ ...ref });
      if (next.length > 0) await this.store.putMessages(next);

      return { rows: [...next].reverse(), removed };
    });
  }

  /** 删除整个通道（删除会话时使用）。 */
  async dropChannel(ref: CacheChannelRef): Promise<number> {
    return this.withChannelLock(ref, async () => this.store.dropChannel(ref));
  }

  /** 复用纯函数做一次幂等 upsert（供调用方在本端合并时使用）。 */
  upsertLocal(rows: readonly CachedMessageRow[], incoming: readonly CachedMessageRow[]): CachedMessageRow[] {
    return upsertMessageRows(rows, incoming);
  }

  // ────────────────────────────── 内部 ──────────────────────────────

  private async readIndexList<T>(key: 'sessions' | 'agents', guard: (value: unknown) => boolean): Promise<T[]> {
    const raw = await this.store.readIndex(key);
    if (!isReadableEnvelope(raw)) {
      if (raw !== null) await this.store.removeIndex(key);
      return [];
    }
    const items = raw.items;
    if (!Array.isArray(items)) return [];
    return items.filter((item): item is T => guard(item));
  }

  private async trimChannel(ref: CacheChannelRef): Promise<string[]> {
    const count = await this.store.countMessages(ref);
    if (count <= this.messageCap) return [];
    const rows = await this.store.listMessages({ ...ref, limit: count });
    const asc = [...rows].sort((a, b) => a.orderKey - b.orderKey);
    const cut = asc.length - this.messageCap;
    const evicted = asc.slice(0, cut);
    await this.store.deleteMessages({ ...ref });
    const kept = asc.slice(cut);
    if (kept.length > 0) await this.store.putMessages(kept);
    return evicted.map(messageKey);
  }

  /** 通道级串行：同一通道的读改写串行执行，不同通道互不影响。 */
  private async withChannelLock<T>(ref: CacheChannelRef, fn: () => Promise<T>): Promise<T> {
    const key = channelKey(ref);
    const tail = this.channelTails.get(key) ?? Promise.resolve();
    const run = tail.then(fn, fn);
    this.channelTails.set(
      key,
      run.catch(() => undefined)
    );
    return run;
  }
}

/** 只接受合法 data URL 前缀；`data:image` 这种半截值必须丢弃，否则会渲染成裂图。 */
function isImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

/** 会话索引行守卫：只接受字段齐全、类型正确的条目。 */
export function isSessionSummary(value: unknown): value is CachedSessionSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    row.id.length > 0 &&
    typeof row.profile === 'string' &&
    (row.kind === 'session' || row.kind === 'group') &&
    typeof row.title === 'string' &&
    typeof row.timestamp === 'number' &&
    Number.isFinite(row.timestamp) &&
    typeof row.isArchived === 'boolean' &&
    typeof row.hidden === 'boolean' &&
    typeof row.pinned === 'boolean' &&
    typeof row.unread === 'boolean'
  );
}

/** Agent 索引行守卫。 */
export function isAgentSummary(value: unknown): value is CachedAgentSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.name === 'string' &&
    row.name.length > 0 &&
    typeof row.displayName === 'string' &&
    typeof row.hasAvatar === 'boolean'
  );
}

/** 当前 schema 版本，供壳层做迁移判定。 */
export const CACHE_VERSION = CACHE_SCHEMA_VERSION;
