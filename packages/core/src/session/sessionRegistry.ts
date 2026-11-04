/**
 * Session Registry Helpers
 *
 * The gateway distinguishes two identities for the same conversation:
 *
 *   - a *stored* id (`20261028_155631_8bcc62`) — what `session.list` returns and
 *     what the left rail renders;
 *   - a *live* id (`46546345`) — what `session.create` returns as `session_id`,
 *     and the only id accepted by `prompt.submit` and `config.set`.
 *
 * `session.resume({ session_id: <stored> })` bridges the two by returning the live
 * id. Losing that pairing is what makes a freshly created conversation invisible in
 * the rail and un-sendable on the second turn, so the mapping lives here, in pure
 * functions, instead of being re-derived by ad-hoc `res?.id` reads in the renderer.
 */

import type { NormalizedSession } from '../rpc/types.js';

export interface SessionHandles {
  /** Live transport id: required by prompt.submit / config.set. */
  liveId: string;
  /** Persisted id: what session.list exposes and the rail displays. */
  storedId: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asId(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/**
 * Reads the live/stored id pair out of a `session.create` or `session.resume`
 * result. Falls back to the supplied stored id when the backend omits it.
 */
export function readSessionHandles(result: unknown, fallbackStoredId = ''): SessionHandles | null {
  const payload = asRecord(result);
  const liveId = asId(payload.session_id) || asId(payload.id);
  const storedId = asId(payload.stored_session_id) || asId(payload.session_key) || asId(payload.resumed) || fallbackStoredId;

  if (!liveId && !storedId) return null;
  return { liveId: liveId || storedId, storedId: storedId || liveId };
}

/** Builds the rail entry shown for a conversation that was just created. */
export function toPendingSession(handles: SessionHandles, title = '新任务', now = Date.now()): NormalizedSession {
  return {
    id: handles.storedId,
    title,
    model: '',
    time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    preview: '',
    isArchived: false,
    timestamp: now,
  };
}

/**
 * Inserts `session` at the head of the rail, or merges it into an existing entry
 * with the same id. Never mutates the input list.
 */
export function upsertSession(list: NormalizedSession[], session: NormalizedSession): NormalizedSession[] {
  const index = list.findIndex((item) => item.id === session.id);
  if (index === -1) return [session, ...list];

  const next = list.slice();
  next[index] = { ...next[index], ...session };
  return next;
}

/**
 * Applies a `session.title` broadcast. The gateway may address the conversation by
 * either id, so both are matched. Returns the original list when nothing matched.
 */
export function applySessionTitle(
  list: NormalizedSession[],
  sessionId: string,
  title: string,
  aliasId = ''
): NormalizedSession[] {
  const trimmed = title.trim();
  if (!trimmed) return list;

  let matched = false;
  const next = list.map((item) => {
    if (item.id !== sessionId && (!aliasId || item.id !== aliasId)) return item;
    matched = true;
    return { ...item, title: trimmed };
  });

  return matched ? next : list;
}

/**
 * 传输层会话句柄双向注册管理类（Live ID ↔ Stored ID）。
 *
 * 设计意图 (Why)：网关 WebSocket 下行事件帧全量携带传输层 liveId，
 *   而抽屉、会话池与运行集合必须且只能以持久化 storedId 作为唯一键。
 *   纯逻辑层单例注册器提供双向映射与归一化解析，杜绝跨端/多壳层逻辑漂移。
 * 防范的历史坑 (Pitfall)：message.complete 携带 liveId 导致 applyTurnCompleted 无法从
 *   存放 storedId 的 activeRunningSessionIds 中移除会话，引发未读会话永久呈 running 闪烁（bg_xxxx 缺陷）。
 * 约束与规则 (Rules)：内存受控管理，支持注销已删除实体防止泄漏；提供严格不可变/纯函数查询。
 */
export class SessionHandleRegistry {
  private readonly liveToStored = new Map<string, string>();
  private readonly storedToLive = new Map<string, string>();

  /** 注册权威句柄对 */
  public register(handles: SessionHandles | null | undefined): void {
    if (!handles?.liveId || !handles?.storedId) return;
    this.liveToStored.set(handles.liveId, handles.storedId);
    this.storedToLive.set(handles.storedId, handles.liveId);
  }

  /** 注销已删除或已终结实体的映射，防止内存泄漏 */
  public unregister(id: string): void {
    if (!id) return;
    if (this.liveToStored.has(id)) {
      const stored = this.liveToStored.get(id)!;
      this.liveToStored.delete(id);
      this.storedToLive.delete(stored);
    } else if (this.storedToLive.has(id)) {
      const live = this.storedToLive.get(id)!;
      this.storedToLive.delete(id);
      this.liveToStored.delete(live);
    }
  }

  /** 将未知标识符（可能为 liveId 或 storedId）归一化解析为 storedId */
  public toStoredId(
    id: string | null | undefined,
    fallbackKnownStoredIds?: readonly string[]
  ): string | null {
    if (!id) return null;
    if (fallbackKnownStoredIds && fallbackKnownStoredIds.includes(id)) {
      return id;
    }
    if (this.liveToStored.has(id)) {
      return this.liveToStored.get(id)!;
    }
    return id;
  }

  /** 将 storedId 解析为其绑定的 liveId */
  public toLiveId(storedId: string | null | undefined): string | null {
    if (!storedId) return null;
    return this.storedToLive.get(storedId) ?? storedId;
  }

  /** 获取当前所有正在运行或已注册的所有 liveId 集合 */
  public getLiveIds(storedIds: Iterable<string>): string[] {
    const lives: string[] = [];
    for (const sid of storedIds) {
      const live = this.storedToLive.get(sid);
      if (live) lives.push(live);
    }
    return lives;
  }

  /** 清空注册表（仅供测试或重连初始化） */
  public clear(): void {
    this.liveToStored.clear();
    this.storedToLive.clear();
  }
}

/** 全局句柄注册器默认单例 */
export const defaultSessionHandleRegistry = new SessionHandleRegistry();
