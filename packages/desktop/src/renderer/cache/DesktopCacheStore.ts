/**
 * Desktop 缓存存储适配器（packages/desktop/src/renderer/cache/DesktopCacheStore.ts）
 *
 * 【设计意图 (Why)】
 *   索引类数据（会话/Agent/头像）体积小且首屏必须同步可用，放 localStorage；
 *   消息正文体积大（10 万行级），放 IndexedDB。两者组合成 core 定义的 `ICacheStore`，
 *   让 core 的 CacheService 不感知具体介质。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 把消息塞进 localStorage 会撞 5MB 配额，且配额失败是连坐的——
 *      同一次写入的索引会一起丢。
 *   2. IndexedDB 的游标范围必须用四元组前缀 + orderKey 区间精确限定，
 *      否则会把相邻通道的行带出来。
 *   3. localStorage 在隐私模式或配额满时抛异常，不能让它冒泡打断启动。
 *
 * 【约束与规则 (Rules)】
 *   - 索引读写失败时降级到内存 Map，并在读取时如实返回（不伪造空数据）；
 *   - 消息表的每次写操作必须是单个事务；
 *   - 本文件只在 renderer 环境运行，不得被 core 引用。
 */

import {
  buildChannelBounds,
  type CacheChannelRef,
  type CacheIndexKey,
  type CachedMessageRow,
  type ICacheStore,
  type MessageDeleteQuery,
  type MessageListQuery,
} from '@hermes-flux/core';

const INDEX_PREFIX = 'hermes_flux_cache_index_';
const DB_NAME = 'hermes_flux_cache';
const DB_VERSION = 1;
const STORE_MESSAGES = 'messages';

/** 数组主键：profile + channel + channelId + orderKey */
type MessageKeyTuple = [string, string, string, number];

export class DesktopCacheStore implements ICacheStore {
  /** localStorage 不可用时的降级容器 */
  private readonly memoryIndex = new Map<string, unknown>();

  private dbPromise: Promise<IDBDatabase> | null = null;

  // ───────────────────────── 索引 ─────────────────────────

  async readIndex(key: CacheIndexKey): Promise<unknown | null> {
    const storage = this.safeStorage();
    if (!storage) return this.memoryIndex.has(key) ? this.memoryIndex.get(key) : null;
    try {
      const raw = storage.getItem(`${INDEX_PREFIX}${key}`);
      if (raw === null) return null;
      return JSON.parse(raw) as unknown;
    // gate-degrade: 本地缓存 JSON 损坏无法恢复，视为不存在，由上层按版本不符丢弃重建
    } catch {
      return null;
    }
  }

  async writeIndex(key: CacheIndexKey, value: unknown): Promise<void> {
    const storage = this.safeStorage();
    if (!storage) {
      this.memoryIndex.set(key, value);
      return;
    }
    try {
      storage.setItem(`${INDEX_PREFIX}${key}`, JSON.stringify(value));
    // gate-degrade: 配额满或隐私模式写失败时降级到内存，保证本次会话功能不中断
    } catch {
      this.memoryIndex.set(key, value);
    }
  }

  async removeIndex(key: CacheIndexKey): Promise<void> {
    this.memoryIndex.delete(key);
    const storage = this.safeStorage();
    if (!storage) return;
    try {
      storage.removeItem(`${INDEX_PREFIX}${key}`);
    // gate-degrade: 删除失败不影响正确性，读取时上层会因版本不符或键缺失丢弃重建
    } catch {
      return;
    }
  }

  // ───────────────────────── 消息 ─────────────────────────

  async putMessages(rows: readonly CachedMessageRow[]): Promise<void> {
    if (rows.length === 0) return;
    const db = await this.openDb();
    await this.runTransaction(db, 'readwrite', (store) => {
      for (const row of rows) {
        // 主键由 keyPath 从行对象提取，禁止再传第二个参数（否则 IndexedDB 抛 DataError）
        store.put(row);
      }
    });
  }

  async listMessages(query: MessageListQuery): Promise<CachedMessageRow[]> {
    const limit = Math.max(0, Math.floor(query.limit));
    if (limit === 0) return [];

    const db = await this.openDb();
    const range = this.listRange(query, query.beforeOrderKey);

    return new Promise<CachedMessageRow[]>((resolve, reject) => {
      const rows: CachedMessageRow[] = [];
      const tx = db.transaction(STORE_MESSAGES, 'readonly');
      const request = tx.objectStore(STORE_MESSAGES).openCursor(range, 'prev');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || rows.length >= limit) {
          resolve(rows);
          return;
        }
        rows.push(cursor.value as CachedMessageRow);
        cursor.continue();
      };
    });
  }

  async deleteMessages(query: MessageDeleteQuery): Promise<number> {
    const db = await this.openDb();
    const range = this.aboveRange(query, query.aboveOrderKey);
    let removed = 0;
    await this.runTransaction(db, 'readwrite', (store) => {
      const request = store.openCursor(range, 'prev');
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        removed += 1;
        cursor.continue();
      };
    });
    return removed;
  }

  async countMessages(ref: CacheChannelRef): Promise<number> {
    const db = await this.openDb();
    const range = this.fullChannelRange(ref);
    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_MESSAGES, 'readonly');
      const request = tx.objectStore(STORE_MESSAGES).count(range);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async trimChannel(ref: CacheChannelRef, keep: number): Promise<number> {
    const safeKeep = Math.max(0, Math.floor(keep));
    const total = await this.countMessages(ref);
    if (total <= safeKeep) return 0;

    const toDelete = total - safeKeep;
    const db = await this.openDb();
    const range = this.fullChannelRange(ref);

    // 升序取最旧的 N 个主键，再在一个事务里删除
    const keys = await new Promise<MessageKeyTuple[]>((resolve, reject) => {
      const collected: MessageKeyTuple[] = [];
      const tx = db.transaction(STORE_MESSAGES, 'readonly');
      const request = tx.objectStore(STORE_MESSAGES).openCursor(range, 'next');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || collected.length >= toDelete) {
          resolve(collected);
          return;
        }
        collected.push(cursor.primaryKey as MessageKeyTuple);
        cursor.continue();
      };
    });

    if (keys.length === 0) return 0;
    await this.runTransaction(db, 'readwrite', (store) => {
      for (const key of keys) store.delete(key);
    });
    return keys.length;
  }

  async dropChannel(ref: CacheChannelRef): Promise<number> {
    const total = await this.countMessages(ref);
    if (total === 0) return 0;
    await this.deleteMessages({ ...ref });
    return total;
  }

  // ───────────────────────── 内部 ─────────────────────────

  private safeStorage(): Storage | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      // 探测写入能力：隐私模式下 getItem 可用但 setItem 抛错
      const probe = '__flux_cache_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    // gate-degrade: 隐私模式或存储被禁用时探测失败，回落到内存实现，不阻断启动
    } catch {
      return null;
    }
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
          db.createObjectStore(STORE_MESSAGES, {
            keyPath: ['profile', 'channel', 'channelId', 'orderKey'],
          });
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    return this.dbPromise;
  }

  /** 通道全量范围。四元组前缀保证不会跨到相邻通道。 */
  private fullChannelRange(ref: CacheChannelRef): IDBKeyRange {
    const bounds = buildChannelBounds(ref, 'full');
    return IDBKeyRange.bound(bounds.lower, bounds.upper);
  }

  /** 列表范围：`orderKey < beforeOrderKey`（无 before 则全量）。 */
  private listRange(ref: CacheChannelRef, beforeOrderKey?: number): IDBKeyRange {
    const bounds =
      typeof beforeOrderKey === 'number'
        ? buildChannelBounds(ref, 'list-before', beforeOrderKey)
        : buildChannelBounds(ref, 'full');
    return IDBKeyRange.bound(bounds.lower, bounds.upper);
  }

  /** 删除范围：`orderKey > aboveOrderKey`（无 above 则全量）。 */
  private aboveRange(ref: CacheChannelRef, aboveOrderKey?: number): IDBKeyRange {
    const bounds =
      typeof aboveOrderKey === 'number'
        ? buildChannelBounds(ref, 'delete-above', aboveOrderKey)
        : buildChannelBounds(ref, 'full');
    return IDBKeyRange.bound(bounds.lower, bounds.upper);
  }

  private runTransaction(
    db: IDBDatabase,
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore) => void
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_MESSAGES, mode);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      body(tx.objectStore(STORE_MESSAGES));
    });
  }
}
