/**
 * Platform Abstraction Layer (PAL) - Storage Interface
 * Unified key-value persistence interface for Desktop (SQLite/JSON), Mobile (MMKV), and Web (IndexedDB).
 */

export interface IStorage {
  getItem<T = string>(key: string): Promise<T | null>;
  setItem<T = string>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
  getAllKeys(): Promise<string[]>;
}
