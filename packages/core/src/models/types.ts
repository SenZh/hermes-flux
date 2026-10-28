/**
 * Domain Models for Hermes Aura
 */

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  isArchived: boolean;
  model: string;
  reasoningLevel: 'off' | 'low' | 'medium' | 'high';
  approvalMode: 'auto' | 'ask' | 'sandbox';
  unreadCount?: number;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thought?: string;
  toolCalls?: ToolExecution[];
  createdAt: number;
  isStreaming?: boolean;
}

export interface ToolExecution {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
  output?: string;
  status: 'running' | 'completed' | 'failed';
  durationMs?: number;
}

export interface ArtifactItem {
  id: string;
  title: string;
  type: 'code' | 'diff' | 'browser' | 'doc';
  language?: string;
  content: string;
  timestamp: number;
}

/**
 * Robust extraction and normalization helpers
 */
export function normalizeSessionsResult(payload: any): Array<{
  id: string;
  title: string;
  model: string;
  time: string;
  preview: string;
  isArchived: boolean;
  timestamp: number;
}> {
  if (!payload) return [];
  const rawList = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.sessions)
    ? payload.sessions
    : Array.isArray(payload.data)
    ? payload.data
    : [];

  return rawList
    .filter((s: any) => s && (s.id || s.session_id))
    .map((s: any) => {
      const id = String(s.id || s.session_id || '');
      const rawTitle = (s.title || '').trim();
      const title = rawTitle || (id ? `会话 ${id.slice(0, 8)}` : '新对话');
      const model = String(s.model || '');
      const rawTs = s.last_active ?? s.started_at ?? s.created_at ?? 0;
      const numTs = typeof rawTs === 'number' ? (rawTs > 1e11 ? rawTs : rawTs * 1000) : Date.parse(rawTs) || Date.now();
      
      const timeStr = numTs > 0 
        ? new Date(numTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '近期';

      return {
        id,
        title,
        model,
        time: timeStr,
        preview: String(s.preview || ''),
        isArchived: Boolean(s.archived || s.isArchived),
        timestamp: numTs,
      };
    });
}

export function extractAvailableModels(payload: any, fallbackModels: string[] = []): string[] {
  const set = new Set<string>();

  if (!payload) {
    return [...fallbackModels];
  }

  // 1. Direct model root
  if (typeof payload.model === 'string' && payload.model.trim()) {
    set.add(payload.model.trim());
  }

  // 2. models array
  if (Array.isArray(payload.models)) {
    for (const m of payload.models) {
      if (typeof m === 'string' && m.trim()) set.add(m.trim());
      else if (m && typeof m.id === 'string' && m.id.trim()) set.add(m.id.trim());
    }
  }

  // 3. providers array
  if (Array.isArray(payload.providers)) {
    for (const p of payload.providers) {
      if (Array.isArray(p.models)) {
        for (const m of p.models) {
          if (typeof m === 'string' && m.trim()) set.add(m.trim());
          else if (m && typeof m.id === 'string' && m.id.trim()) set.add(m.id.trim());
        }
      }
    }
  }

  // 4. data array
  if (Array.isArray(payload.data)) {
    for (const m of payload.data) {
      if (typeof m === 'string' && m.trim()) set.add(m.trim());
      else if (m && typeof m.id === 'string' && m.id.trim()) set.add(m.id.trim());
    }
  }

  if (set.size === 0 && fallbackModels.length > 0) {
    for (const fm of fallbackModels) {
      set.add(fm);
    }
  }

  return Array.from(set);
}

