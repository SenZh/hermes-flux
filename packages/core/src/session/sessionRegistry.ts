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
