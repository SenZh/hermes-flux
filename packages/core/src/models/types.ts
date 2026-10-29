import type { ModelDetail } from '../rpc/types.js';

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

export function extractModelDetails(payload: any): ModelDetail[] {
  const result: ModelDetail[] = [];
  const seen = new Set<string>();

  if (!payload || typeof payload !== 'object') return result;

  const rootProvider = typeof payload.provider === 'string' ? payload.provider.trim() : '';

  // 1. Providers list (most specific)
  if (Array.isArray(payload.providers)) {
    // Check if any provider in the list explicitly has configured === true or connected === true
    const hasExplicitConfiguredFlags = payload.providers.some(
      (p: any) => p && (p.configured === true || p.connected === true || p.is_configured === true || p.has_key === true)
    );

    const configuredSet = Array.isArray(payload.configured_providers)
      ? new Set(payload.configured_providers.map((s: any) => String(s).toLowerCase().trim()))
      : null;

    for (const p of payload.providers) {
      if (!p || typeof p !== 'object') continue;

      const pSlug = String(p.slug || p.provider || p.id || '').trim();
      const pSlugLower = pSlug.toLowerCase();

      // Check against explicit configured list if provided
      if (configuredSet && !configuredSet.has(pSlugLower)) {
        continue;
      }

      // Check explicit negative flags
      if (
        p.configured === false ||
        p.is_configured === false ||
        p.connected === false ||
        p.active === false ||
        p.ready === false ||
        p.enabled === false ||
        p.has_key === false
      ) {
        continue;
      }

      // Check string status
      if (typeof p.status === 'string') {
        const statusLower = p.status.toLowerCase();
        if (
          statusLower === 'unconfigured' ||
          statusLower === 'disabled' ||
          statusLower === 'disconnected' ||
          statusLower === 'inactive'
        ) {
          continue;
        }
      }

      // If the gateway uses positive flags and at least one provider has it, enforce positive flag
      if (
        hasExplicitConfiguredFlags &&
        p.configured !== true &&
        p.connected !== true &&
        p.is_configured !== true &&
        p.has_key !== true
      ) {
        continue;
      }

      if (Array.isArray(p.models) && p.models.length > 0) {
        for (const m of p.models) {
          const mId = typeof m === 'string' ? m.trim() : typeof m?.id === 'string' ? m.id.trim() : '';
          const mName = typeof m === 'object' && typeof m?.name === 'string' ? m.name.trim() : mId;
          const contextTokens =
            typeof m === 'object' &&
            (m?.context_length || m?.context_window || m?.max_tokens || m?.context_tokens);
          if (mId) {
            const key = pSlug ? `${pSlug}:${mId}` : mId;
            if (!seen.has(key)) {
              seen.add(key);
              result.push({
                id: mId,
                provider: pSlug,
                name: mName || mId,
                displayName: pSlug ? `${mName || mId} (${pSlug})` : (mName || mId),
                contextLength: typeof contextTokens === 'number' ? contextTokens : undefined,
              });
            }
          }
        }
      }
    }
  }

  // 2. Direct models array (merged and deduplicated)
  if (Array.isArray(payload.models)) {
    for (const m of payload.models) {
      const mId = typeof m === 'string' ? m.trim() : typeof m?.id === 'string' ? m.id.trim() : '';
      const mName = typeof m === 'object' && typeof m?.name === 'string' ? m.name.trim() : mId;
      if (mId && !seen.has(mId)) {
        seen.add(mId);
        result.push({
          id: mId,
          provider: rootProvider,
          name: mName || mId,
          displayName: rootProvider ? `${mName || mId} (${rootProvider})` : (mName || mId),
        });
      }
    }
  }

  // 3. Root model
  if (typeof payload.model === 'string' && payload.model.trim()) {
    const rootId = payload.model.trim();
    if (!seen.has(rootId)) {
      seen.add(rootId);
      result.unshift({
        id: rootId,
        provider: rootProvider,
        name: rootId,
        displayName: rootProvider ? `${rootId} (${rootProvider})` : rootId,
      });
    }
  }

  return result;
}

export function extractAvailableModels(payload: any, fallbackModels: string[] = []): string[] {
  const details = extractModelDetails(payload);
  if (details.length > 0) {
    const set = new Set<string>();
    for (const d of details) {
      set.add(d.id);
    }
    return Array.from(set);
  }

  if (fallbackModels.length > 0) {
    return [...fallbackModels];
  }

  return [];
}

