/**
 * 缓存子系统入口（packages/core/src/cache/index.ts）
 *
 * 导出缓存类型、存储抽象、纯函数合并逻辑与服务。
 * 平台适配器（IndexedDB / localStorage / MMKV）由壳层实现 `ICacheStore` 后注入。
 */

export * from './types.js';
export * from './ICacheStore.js';
export * from './cacheMerge.js';
export * from './MemoryCacheStore.js';
export * from './CacheService.js';
