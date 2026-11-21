/**
 * 会话草稿持久化。
 *
 * 【设计意图 (Why)】
 *   用户在输入舱里未发送的提问必须在切走会话、切换 Agent、重启应用后仍然存在。
 *   这类数据的特点是「写得很频繁、读得很局部、丢了很恼人」，
 *   因此把它收敛成一个带自动落盘的小 store：
 *   调用方只需 set/delete，落盘由 store 自己负责，避免出现"改了内存忘了落盘"。
 *
 * 【从 index.ts 抽出的理由】
 *   该领域的全部状态（草稿映射 + 存储键）与全部读写点都是闭合的，
 *   抽出后宿主只保留 6 处调用，且每处都从「改 Map 再手动落盘」简化为一次调用。
 *   抽出前它从未被直接执行过——19 个测试文件都只读源码做正则断言。
 *
 * 【防范的历史坑 (Pitfall)】
 *   历史实现是「调用方 set 完再手动调 persistDraftsToStorage()」：
 *   漏调任何一处就丢草稿，而漏调不会有任何报错。
 *   现在把落盘合并进写操作，从结构上消除这个失误面。
 *
 * 【约束与规则 (Rules)】
 *   1. 只存非空白草稿：空白草稿等于"没有草稿"，存进去会让会话看起来有待发送内容。
 *   2. 落盘失败必须可观测（经 onPersistError），但不得抛出——草稿是可选增强，
 *      存储配额超限不该阻断发送流程。
 *   3. 恢复只接受字符串值，脏数据逐条丢弃。
 */

export const SESSION_DRAFT_STORAGE_KEY = 'hermes_flux_session_drafts';

/**
 * 判定草稿文本是否为系统或指令执行报错（防范报错文本逃逸为持久草稿）
 *
 * 【防范的历史坑 (Pitfall)】
 *   指令失败提示（如 `/compress` 超时报错）可能在异常路径或用户反馈复制时进入输入框或草稿存储。
 *   若存入 SessionDraftStore，会在跨会话切换或重启应用后阴魂不散地反复向输入框回填。
 */
export function isCorruptedSystemErrorDraft(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return (
    /^(?:\u6307\u4ee4\s+\S+\s+\u6267\u884c\u5931\u8d25|Command\s+\S+\s+failed):/i.test(trimmed) ||
    /RPC request '.*?' with id \d+ timed out/i.test(trimmed) ||
    /skill command: use command\.dispatch for/i.test(trimmed)
  );
}

export interface SessionDraftStore {
  /** 读取指定会话的草稿；不存在返回空串 */
  get(sessionId: string): string;
  /** 是否存在非空草稿 */
  has(sessionId: string): boolean;
  /** 写入草稿并落盘；空白草稿等价于删除 */
  set(sessionId: string, text: string): void;
  /** 删除指定会话的草稿并落盘 */
  delete(sessionId: string): void;
  /** 当前所有非空草稿的只读快照（供测试与诊断） */
  snapshot(): ReadonlyMap<string, string>;
}

export interface SessionDraftOptions {
  /** 落盘失败的观测通道（不得静默） */
  onPersistError?(error: unknown): void;
  /** 存储实现，默认 globalThis.localStorage（测试可注入） */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | undefined;
}

export function createSessionDraftStore(options: SessionDraftOptions = {}): SessionDraftStore {
  const drafts = new Map<string, string>();

  const resolveStorage = () => (options.storage !== undefined ? options.storage : globalThis.localStorage);

  function persist(): void {
    try {
      const storage = resolveStorage();
      if (!storage) return;
      const obj: Record<string, string> = {};
      for (const [k, v] of drafts.entries()) {
        if (v.trim()) obj[k] = v;
      }
      storage.setItem(SESSION_DRAFT_STORAGE_KEY, JSON.stringify(obj));
    } catch (err) {
      // gate-degrade: 本地草稿存盘失败属于降级场景，不阻断主流程
      options.onPersistError?.(err);
    }
  }

  function restore(): void {
    try {
      const storage = resolveStorage();
      if (!storage) return;
      const raw = storage.getItem(SESSION_DRAFT_STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      let hasCorrupted = false;
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string' && v.trim()) {
          if (isCorruptedSystemErrorDraft(v)) {
            hasCorrupted = true;
          } else {
            drafts.set(k, v);
          }
        }
      }
      if (hasCorrupted) {
        persist();
      }
    } catch (err) {
      // gate-degrade: 本地草稿恢复失败时回落到空草稿，属于可选加速
      options.onPersistError?.(err);
    }
  }

  restore();

  return {
    get: (sessionId) => drafts.get(sessionId) ?? '',
    has: (sessionId) => {
      const v = drafts.get(sessionId);
      return typeof v === 'string' && v.trim().length > 0;
    },
    set: (sessionId, text) => {
      if (!sessionId) return;
      if (!text.trim() || isCorruptedSystemErrorDraft(text)) {
        // 空白草稿或系统错误等价于没有草稿：删掉它，避免报错阴魂不散
        if (!drafts.has(sessionId)) return;
        drafts.delete(sessionId);
        persist();
        return;
      }
      drafts.set(sessionId, text);
      persist();
    },
    delete: (sessionId) => {
      if (!sessionId || !drafts.has(sessionId)) return;
      drafts.delete(sessionId);
      persist();
    },
    snapshot: () => drafts,
  };
}
