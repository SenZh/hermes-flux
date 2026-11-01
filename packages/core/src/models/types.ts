import type { ModelDetail } from '../rpc/types.js';

/**
 * Domain Models for Hermes Flux
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
 *
 * 【设计意图 (Why)】
 *   网关有两条会话列表通道，字段完备度不同：
 *   - WS `session.list` 只给 `started_at`（会话创建时间），没有 last_active / unread；
 *   - REST `/api/sessions`（profileService.listSessions 走的就是它）额外给 `last_active`、
 *     `unread`、`last_read_at`、`hidden`、`pinned`、`archived`。
 *   "列表按最后活跃时间倒序"与"未读态"都依赖后者，因此归一化必须优先取 `last_active`，
 *   并保留 hidden / unread 等字段，供上层做可见性与状态判定。
 *
 * 【防范的历史坑 (Pitfall)】
 *   曾把 `last_active ?? started_at` 写成同优先级、且丢弃 unread/hidden：
 *   一旦上游只拿到 WS 结果，列表就退化成"按创建时间排序"，用户看到的顺序与真实最后消息时间不符。
 *
 * 【约束与规则 (Rules)】
 *   - `timestamp` 语义固定为"最后活跃时间(ms)"，来源优先级 last_active > started_at > created_at；
 *   - `hidden`/`unread`/`pinned` 原样透传，供上层过滤与三态判定，不在本层做业务决策；
 *   - 纯函数，零 DOM / 零网络依赖。
 */
export function normalizeSessionsResult(payload: any): Array<{
  id: string;
  title: string;
  model: string;
  time: string;
  preview: string;
  isArchived: boolean;
  timestamp: number;
  hidden: boolean;
  unread: boolean;
  pinned: boolean;
  botName?: string;
  projectId?: string;
  projectName?: string;
  cwd?: string;
  parentSessionId?: string;
  source?: string;
  isSubagent?: boolean;
  /** 时间戳取自哪个字段，便于诊断排序依据（last_active / started_at / created_at / none） */
  timeSource: string;
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
      // 时间来源固定优先级：last_active 是"最后一条消息时间"，started_at/created_at 只是创建时间
      const timeSource = typeof s.last_active === 'number' ? 'last_active'
        : typeof s.started_at === 'number' ? 'started_at'
        : typeof s.created_at === 'number' ? 'created_at'
        : 'none';
      const rawTs = s.last_active ?? s.started_at ?? s.created_at ?? 0;
      const numTs = typeof rawTs === 'number' ? (rawTs > 1e11 ? rawTs : rawTs * 1000) : Date.parse(rawTs) || 0;

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
        timeSource,
        hidden: Boolean(s.hidden || s.isHidden),
        unread: Boolean(s.unread),
        pinned: Boolean(s.pinned),
        botName: typeof s.profile === 'string' ? s.profile : typeof s.bot_name === 'string' ? s.bot_name : undefined,
        projectId: typeof s.project_id === 'string' ? s.project_id : typeof s.projectId === 'string' ? s.projectId : undefined,
        projectName: typeof s.project_name === 'string' ? s.project_name : typeof s.projectName === 'string' ? s.projectName : undefined,
        cwd: typeof s.cwd === 'string' ? s.cwd : typeof s.path === 'string' ? s.path : undefined,
        parentSessionId: typeof s.parent_session_id === 'string' ? s.parent_session_id : undefined,
        source: typeof s.source === 'string' ? s.source : undefined,
        isSubagent: Boolean(s.is_subagent || s.is_internal_child || s.source === 'subagent'),
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

      // System default provider (nous) is only valid if explicitly configured with credentials
      if (pSlugLower === 'nous' || pSlugLower === 'system') {
        if (p.configured !== true && p.has_key !== true && p.connected !== true && !p.api_key) {
          continue;
        }
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
            const lowerId = mId.toLowerCase();
            if (!seen.has(lowerId)) {
              seen.add(lowerId);
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
      if (mId) {
        const lowerId = mId.toLowerCase();
        if (!seen.has(lowerId)) {
          seen.add(lowerId);
          result.push({
            id: mId,
            provider: rootProvider,
            name: mName || mId,
            displayName: rootProvider ? `${mName || mId} (${rootProvider})` : (mName || mId),
          });
        }
      }
    }
  }

  // 3. Root model
  if (typeof payload.model === 'string' && payload.model.trim()) {
    const rootId = payload.model.trim();
    const lowerId = rootId.toLowerCase();
    if (!seen.has(lowerId)) {
      seen.add(lowerId);
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

