/**
 * Hermes Aura Desktop Renderer Application Entry (v4.0 Production)
 * Fully powered by @hermes-aura/core and @hermes-aura/ui
 * Zero private WS glue code: Dual-channel fallback, TokenCoalescer 120 FPS stream, robust model & session lifecycle.
 */

import {
  renderTitlebar,
  renderLeftRail,
  renderMiddlePod,
  renderInputDock,
  renderInspectionPod,
  renderStatusBar,
  renderSettingsModal,
  renderModelPickerMenu,
  renderModelPickerTree,
  renderMessage,
  renderMarkdown,
  MessageViewModel,
  InspectorTab,
} from '@hermes-aura/ui';

import {
  HermesGatewayClient,
  TokenCoalescer,
  reduceGatewayEvent,
  readSessionHandles,
  toPendingSession,
  upsertSession,
  applySessionTitle,
  type TurnAction,
  type NormalizedSession,
  type ModelDetail,
  type AgentProfile,
} from '@hermes-aura/core';

import type { HermesDesktopBridge } from '../preload/index.js';

declare global {
  interface Window {
    hermesDesktop?: HermesDesktopBridge;
  }
}

interface AppState {
  platform: 'windows' | 'macos' | 'linux';
  theme: 'obsidian-gold' | 'suet-jade' | 'jade-white';
  lang: 'zh' | 'en';
  isMaximized: boolean;
  leftRailCollapsed: boolean;
  inspectorCollapsed: boolean;
  activeInspectorTab: InspectorTab;
  /** Stored id of the focused conversation — the id the left rail lists. */
  activeSessionId: string;
  /** Live transport id of the focused conversation — required by prompt.submit / config.set. */
  activeLiveSessionId: string;
  selectedModel: string;
  availableModels: string[];
  modelDetails: ModelDetail[];
  currentProvider: string;
  profiles: AgentProfile[];
  profileName: string;
  /** Model menu visibility lives in state so a re-render cannot swallow it. */
  modelMenuOpen: boolean;
  /** Context menu for session item */
  sessionContextMenu?: { x: number; y: number; sessionId: string; sessionTitle: string };
  /** Inline failure line inside the dock (failure must never be silent). */
  dockNotice: string;
  /** Rail-level failure line, distinct from a legitimately empty session list. */
  sessionListError: string;
  /** Conversations optimistically inserted while the gateway persists them. */
  pendingSessionIds: string[];
  reasoningLevel: 'off' | 'low' | 'medium' | 'high';
  approvalMode: 'auto' | 'ask' | 'sandbox';
  isStreaming: boolean;
  gatewayConnected: boolean;
  gatewayConnecting: boolean;
  gatewayLatencyMs: number;
  gatewayUrl: string;
  username: string;
  password: string;
  isSettingsOpen: boolean;
  settingsTab: 'gateway' | 'appearance' | 'about';
  sessions: NormalizedSession[];
  messages: MessageViewModel[];
  favoriteModels: string[];
  recentModels: string[];
  modelSearchQuery: string;
  testStatus?: { ok?: boolean; message?: string; latency?: number };
  artifacts: Array<{ id: string; name: string; type: string; size: string; preview?: string }>;
  browserFrame?: { url: string; title: string; screenshotUrl?: string };
  gitDiffs: Array<{ file: string; additions: number; deletions: number; patch?: string }>;
  memories: Array<{ category: string; content: string; updated?: string }>;
}

const desktopApi: HermesDesktopBridge | undefined = window.hermesDesktop;

const state: AppState = {
  platform: 'windows',
  theme: (localStorage.getItem('hermes_aura_theme') as any) || 'obsidian-gold',
  lang: (localStorage.getItem('hermes_aura_lang') as any) || 'zh',
  isMaximized: false,
  leftRailCollapsed: false,
  inspectorCollapsed: false,
  activeInspectorTab: 'artifacts',
  activeSessionId: '',
  activeLiveSessionId: '',
  selectedModel: '',
  availableModels: [],
  modelDetails: [],
  currentProvider: '',
  profiles: [],
  profileName: localStorage.getItem('hermes_aura_profile') || 'default',
  modelMenuOpen: false,
  dockNotice: '',
  sessionListError: '',
  pendingSessionIds: [],
  favoriteModels: JSON.parse(localStorage.getItem('hermes_aura_fav_models') || '[]'),
  recentModels: JSON.parse(localStorage.getItem('hermes_aura_recent_models') || '[]'),
  modelSearchQuery: '',
  reasoningLevel: 'high',
  approvalMode: 'auto',
  isStreaming: false,
  gatewayConnected: false,
  gatewayConnecting: Boolean(localStorage.getItem('hermes_aura_gateway_url')),
  gatewayLatencyMs: 0,
  gatewayUrl: localStorage.getItem('hermes_aura_gateway_url') || 'http://127.0.0.1:9119',
  username: localStorage.getItem('hermes_aura_username') || '',
  password: localStorage.getItem('hermes_aura_password') || '',
  isSettingsOpen: false,
  settingsTab: 'gateway',
  sessions: [],
  messages: [],
  testStatus: undefined,
  artifacts: [],
  browserFrame: undefined,
  gitDiffs: [],
  memories: [],
};

let gatewayClient: HermesGatewayClient | null = null;
let currentTicket: string | undefined = undefined;
let activeStreamingMessageId: string | null = null;
let sessionsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let turnWatchdogTimer: ReturnType<typeof setTimeout> | null = null;

/** Upper bound for a silent turn before the composer is force-unlocked. */
const TURN_WATCHDOG_MS = 10 * 60 * 1000;

/** Extracts a human-readable reason out of a JSON-RPC error, an Error or a string. */
function describeRpcError(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; code?: unknown };
    if (typeof candidate.code !== 'undefined') {
      const code = String(candidate.code);
      const message = typeof candidate.message === 'string' ? candidate.message : '';
      return message ? `[${code}] ${message}` : `RPC 错误 ${code}`;
    }
    if (typeof candidate.message === 'string' && candidate.message.trim()) return candidate.message;
  }
  return typeof error === 'string' ? error : '未知错误';
}

/** The gateway rejects unknown params with a stable phrase; retry without them. */
function isExtraInputsError(error: unknown): boolean {
  const message = error && typeof error === 'object' ? (error as { message?: unknown }).message : undefined;
  return typeof message === 'string' && message.includes('Extra inputs');
}


// Token coalescer for smooth 60-120fps stream updates
const tokenCoalescer = new TokenCoalescer((flushedMap) => {
  for (const [msgId, entry] of flushedMap.entries()) {
    const targetMsg = state.messages.find((m) => m.id === msgId);
    if (!targetMsg || targetMsg.role !== 'assistant') continue;

    if (entry.content) {
      targetMsg.content += entry.content;
      const contentEl = document.getElementById(`msg-content-${targetMsg.id}`);
      if (contentEl) {
        if (contentEl.style.display === 'none') {
          contentEl.style.display = 'flex';
        }
        contentEl.innerHTML = renderMarkdown(targetMsg.content);
      }
    }

    if (entry.thought) {
      targetMsg.thought = (targetMsg.thought || '') + entry.thought;
      const thoughtEl = document.getElementById(`msg-thought-${targetMsg.id}`);
      if (thoughtEl) {
        thoughtEl.innerText = targetMsg.thought;
        const fold = thoughtEl.closest('details');
        if (fold) {
          fold.style.display = 'block';
          if (!fold.open) fold.open = true;
        }
      }
    }
  }

  const stream = document.getElementById('conversation-stream');
  if (stream) {
    stream.scrollTop = stream.scrollHeight;
  }
});

function getEffectiveUrl(base: string): string {
  let url = (base || 'http://127.0.0.1:9119').trim();
  if (url.startsWith('ws://')) url = url.replace('ws://', 'http://');
  if (url.startsWith('wss://')) url = url.replace('wss://', 'https://');
  if (!url.startsWith('http://') && !url.startsWith('https://')) url = `https://${url}`;
  return url.replace(/\/+$/, '');
}

async function testConnection(
  url: string,
  username: string,
  pass: string
): Promise<{ ok: boolean; message: string; latency: number; ticket?: string }> {
  if (desktopApi?.authenticateGateway) {
    try {
      const res = await desktopApi.authenticateGateway({
        url,
        username,
        password: pass,
      });
      return res;
    } catch (e: any) {
      console.warn('[Desktop PAL] authenticateGateway fallback:', e);
    }
  }

  const baseUrl = getEffectiveUrl(url);
  const startTime = Date.now();

  try {
    const statusRes = await fetch(`${baseUrl}/api/status`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const latency = Date.now() - startTime;
    if (!statusRes.ok) {
      return { ok: false, message: `网关返回异常 HTTP ${statusRes.status}`, latency };
    }

    const statusData = await statusRes.json().catch(() => ({}));
    if (statusData.auth_required) {
      if (!username || !pass) {
        return { ok: false, message: '该网关开启了安全拦截，必须输入用户名与密码', latency };
      }
      const loginRes = await fetch(`${baseUrl}/auth/password-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password: pass, provider: 'basic' }),
      });
      if (!loginRes.ok) {
        return { ok: false, message: `认证失败: HTTP ${loginRes.status}`, latency };
      }

      let ticket: string | undefined;
      try {
        const tRes = await fetch(`${baseUrl}/api/auth/ws-ticket`, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          credentials: 'include',
        });
        if (tRes.ok) {
          const td = await tRes.json();
          ticket = td.ticket;
        }
      } catch {}

      return {
        ok: true,
        ticket,
        message: `认证成功 · 延迟 ${latency}ms · Gateway v${statusData.version || '0.22.5'}`,
        latency,
      };
    }

    return {
      ok: true,
      message: `连接成功 (免密通道) · 延迟 ${latency}ms · Gateway v${statusData.version || '0.22.5'}`,
      latency,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: `无法连接网关: ${err.message || '网络连接超时或被拒绝'}`,
      latency: 0,
    };
  }
}

/**
 * Coalesces bursts of `sessions.changed` broadcasts into one list fetch.
 * The gateway emits several of them per turn, so an unthrottled refresh would
 * otherwise re-render the whole shell many times in a row.
 */
function scheduleSessionsRefresh(delayMs = 180): void {
  if (sessionsRefreshTimer) clearTimeout(sessionsRefreshTimer);
  sessionsRefreshTimer = setTimeout(() => {
    sessionsRefreshTimer = null;
    void fetchSessions();
  }, delayMs);
}

async function fetchSessions(): Promise<void> {
  if (!gatewayClient) return;

  const outcome = await gatewayClient.listSessions(state.profileName || 'default', 50);

  if (!outcome.ok) {
    // Failure is not empty: tell the user why the rail is not refreshing.
    state.sessionListError = outcome.error || '会话列表拉取失败';
    render();
    return;
  }

  state.sessionListError = '';

  // Keep conversations that were created locally but are not persisted yet; the
  // gateway only lists a session once its first turn has been stored.
  const serverIds = new Set(outcome.sessions.map((s) => s.id));
  const stillPending = state.sessions.filter(
    (s) => state.pendingSessionIds.includes(s.id) && !serverIds.has(s.id)
  );
  state.pendingSessionIds = state.pendingSessionIds.filter((id) => !serverIds.has(id));

  state.sessions = [...stillPending, ...outcome.sessions];

  if (!state.activeSessionId && state.sessions.length > 0) {
    await selectSession(state.sessions[0].id);
    return;
  }

  render();
}

async function fetchModelOptions(options: { clearNotice?: boolean } = {}): Promise<void> {
  if (!gatewayClient) {
    state.availableModels = [];
    state.modelDetails = [];
    state.dockNotice = '未连接网关，暂时无法获取模型列表';
    render();
    return;
  }

  const catalog = await gatewayClient.getModelCatalog(state.profileName || 'default');

  if (!catalog.ok) {
    // No fabricated fallback models: an invented list is worse than an honest error.
    state.dockNotice = `模型列表加载失败: ${catalog.error || '网关未返回数据'}`;
    render();
    return;
  }

  state.availableModels = catalog.models;
  state.modelDetails = catalog.details;
  state.currentProvider = catalog.currentProvider;
  if (catalog.currentModel) {
    state.selectedModel = catalog.currentModel;
  } else if (!state.selectedModel && catalog.models.length > 0) {
    state.selectedModel = catalog.models[0];
  }
  if (options.clearNotice !== false) state.dockNotice = '';
  render();
}

async function fetchProfiles(): Promise<void> {
  if (!gatewayClient) return;
  try {
    const list = await gatewayClient.listProfiles();
    state.profiles = list;
    render();
  } catch (e) {
    console.warn('[Aura] fetchProfiles failed:', e);
  }
}

async function switchProfile(name: string): Promise<void> {
  if (!name || state.profileName === name) return;
  state.profileName = name;
  localStorage.setItem('hermes_aura_profile', name);
  render();
  await Promise.allSettled([fetchSessions(), fetchModelOptions()]);
}

// In-memory LRU session messages cache to provide 0ms instant switching between conversations
const sessionMessagesCache = new Map<string, MessageViewModel[]>();

async function loadMessages(sessionId: string): Promise<void> {
  if (!sessionId || !gatewayClient) {
    state.messages = [];
    render();
    return;
  }

  // 1. Instant cache hit: render immediately from memory without waiting for network roundtrip
  const cached = sessionMessagesCache.get(sessionId);
  if (cached && cached.length > 0) {
    state.messages = [...cached];
    render();
  }

  try {
    let res: any;
    try {
      // 1. Try session.resume with profile parameter so the gateway resolves it in the active profile context
      res = await gatewayClient.call<any>('session.resume', {
        session_id: sessionId,
        profile: state.profileName || 'default',
      });
    } catch (firstErr: any) {
      const firstMsg = describeRpcError(firstErr);
      if (firstMsg.includes('Extra inputs')) {
        // Fallback without profile
        res = await gatewayClient.call<any>('session.resume', { session_id: sessionId });
      } else {
        // 2. Try REST history endpoint if session.resume gave 4007
        if (desktopApi?.httpProxy && (firstMsg.includes('4007') || firstMsg.includes('not found'))) {
          const baseUrl = getEffectiveUrl(state.gatewayUrl);
          const historyRes = await desktopApi.httpProxy({
            baseUrl,
            path: `/api/sessions/${encodeURIComponent(sessionId)}/history`,
            method: 'GET',
            ticket: currentTicket,
          }).catch(() => null);

          if (historyRes && (Array.isArray(historyRes.messages) || Array.isArray(historyRes.history))) {
            res = historyRes;
          } else {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }
    }

    const handles = readSessionHandles(res, sessionId);
    if (handles) {
      state.activeLiveSessionId = handles.liveId;
    } else {
      state.activeLiveSessionId = sessionId;
    }

    const list = Array.isArray(res?.messages) ? res.messages : Array.isArray(res?.history) ? res.history : [];
    
    // Filter and transform messages
    const parsedMessages: MessageViewModel[] = [];

    for (let idx = 0; idx < list.length; idx++) {
      const m = list[idx];
      if (!m || typeof m !== 'object') continue;

      // Extract raw role
      const rawRole = String(m.role || '').toLowerCase();
      
      // Determine content text from diverse gateway schemas
      let rawText = '';
      if (typeof m.text === 'string') {
        rawText = m.text;
      } else if (typeof m.content === 'string') {
        rawText = m.content;
      } else if (Array.isArray(m.content)) {
        // Multi-part content blocks (Anthropic / OpenAI format: [{type: 'text', text: '...'}])
        rawText = m.content
          .map((part: any) => {
            if (typeof part === 'string') return part;
            if (part && typeof part.text === 'string') return part.text;
            if (part && part.type === 'tool_use') return `[调用工具: ${part.name || 'tool'}]`;
            return '';
          })
          .filter(Boolean)
          .join('\n');
      } else if (typeof m.message === 'string') {
        rawText = m.message;
      } else if (m.delta && typeof m.delta.text === 'string') {
        rawText = m.delta.text;
      }

      // Extract thinking / reasoning
      const thought = typeof m.thinking === 'string'
        ? m.thinking
        : typeof m.thought === 'string'
        ? m.thought
        : typeof m.reasoning === 'string'
        ? m.reasoning
        : '';

      // Extract tool calls
      const rawToolCalls = Array.isArray(m.tool_calls)
        ? m.tool_calls
        : Array.isArray(m.tools)
        ? m.tools
        : Array.isArray(m.tool_use)
        ? m.tool_use
        : [];

      const toolCalls = rawToolCalls.map((tc: any, tIdx: number) => ({
        id: tc.id || `tc-${idx}-${tIdx}`,
        name: tc.name || tc.function?.name || 'tool',
        status: (tc.status || 'completed') as any,
        args: typeof tc.args === 'string' ? tc.args : typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.args || tc.arguments || tc.input || {}),
        output: tc.output ? String(tc.output) : tc.result ? String(tc.result) : undefined,
      }));

      // Internal intermediate messages (e.g. tool output without user text, pure protocol frames)
      // Check if this message is a tool response, or if rawText itself is a serialized tool output (JSON with diff/success/etc.)
      let isToolPayload = rawRole === 'tool' || rawRole === 'function';
      let synthesizedToolCall: any = null;

      if (!isToolPayload && rawText.trim().startsWith('{') && rawText.trim().endsWith('}')) {
        try {
          const parsed = JSON.parse(rawText.trim());
          if (
            parsed &&
            typeof parsed === 'object' &&
            ('success' in parsed || 'diff' in parsed || 'files_modified' in parsed || 'stdout' in parsed || 'exitCode' in parsed)
          ) {
            isToolPayload = true;
            const toolName = ('diff' in parsed || 'files_modified' in parsed) ? 'edit' : 'tool';
            const targetArg = parsed.resolved_path || (parsed.files_modified ? parsed.files_modified[0] : '') || '';
            synthesizedToolCall = {
              id: m.tool_call_id || `tc-synth-${idx}`,
              name: toolName,
              status: 'completed',
              args: targetArg,
              output: parsed.diff || rawText,
            };
          }
        } catch {
          // not json
        }
      }

      if (isToolPayload) {
        // Attach tool result to previous assistant message
        if (parsedMessages.length > 0 && parsedMessages[parsedMessages.length - 1].role === 'assistant') {
          const prev = parsedMessages[parsedMessages.length - 1];
          if (!prev.toolCalls) prev.toolCalls = [];

          if (synthesizedToolCall) {
            prev.toolCalls.push(synthesizedToolCall);
            continue;
          }

          if (prev.toolCalls.length > 0) {
            prev.toolCalls[prev.toolCalls.length - 1].output = rawText || m.output || JSON.stringify(m.result || {});
            continue;
          } else {
            prev.toolCalls.push({
              id: m.tool_call_id || `tc-${idx}`,
              name: m.name || 'tool',
              status: 'completed',
              args: '',
              output: rawText || m.output || JSON.stringify(m.result || {}),
            });
            continue;
          }
        } else if (synthesizedToolCall) {
          // If no previous assistant message, create one containing ONLY this tool call
          parsedMessages.push({
            id: String(m.row_id ?? m.id ?? `msg-${idx}`),
            role: 'assistant',
            content: '',
            thought: '',
            toolCalls: [synthesizedToolCall],
            timestamp: formatTimestamp(m.timestamp ?? m.created_at ?? Date.now()),
          });
          continue;
        } else {
          // Drop orphaned protocol frames
          continue;
        }
      }

      // If an assistant message is completely empty (no content, no thought, no tools), DO NOT render a blank ghost bubble
      const hasContent = Boolean(rawText && rawText.trim());
      const hasThought = Boolean(thought && thought.trim());
      const hasTools = toolCalls.length > 0;

      // Filter out empty assistant turn frames
      if (rawRole === 'assistant' && !hasContent && !hasThought && !hasTools) {
        continue;
      }

      // If user or system message has no text, skip as well
      if (rawRole !== 'assistant' && !hasContent) {
        continue;
      }

      parsedMessages.push({
        id: String(m.row_id ?? m.id ?? `msg-${idx}`),
        role: (rawRole === 'user' || rawRole === 'system' ? rawRole : 'assistant') as MessageViewModel['role'],
        content: rawText,
        thought,
        thoughtDurationMs: m.thought_duration_ms,
        toolCalls,
        timestamp: formatTimestamp(m.timestamp ?? m.created_at ?? Date.now()),
      });
    }

    state.messages = parsedMessages;
    sessionMessagesCache.set(sessionId, parsedMessages);

    if (state.activeSessionId === sessionId) state.dockNotice = '';
    render();
    requestAnimationFrame(() => {
      const stream = document.getElementById('conversation-stream');
      if (stream) stream.scrollTop = stream.scrollHeight;
    });
  } catch (e) {
    console.warn('[Hermes Gateway] Failed to load messages via RPC:', e);
    const errText = describeRpcError(e);
    state.messages = [];
    state.dockNotice = `载入会话历史失败: ${errText}`;
    render();
  }
}

/**
 * Resolves the live transport id for the focused conversation.
 *
 * The rail only holds stored ids, while prompt.submit / config.set reject those
 * with `4001 session not found`. `session.resume` is the documented bridge.
 */
async function ensureLiveSessionId(): Promise<string> {
  if (state.activeLiveSessionId) return state.activeLiveSessionId;
  if (!gatewayClient || !state.activeSessionId) return '';

  try {
    const res = await gatewayClient.call<any>('session.resume', { session_id: state.activeSessionId });
    const handles = readSessionHandles(res, state.activeSessionId);
    if (handles) {
      state.activeLiveSessionId = handles.liveId;
      return handles.liveId;
    }
  } catch (e) {
    console.warn('[Aura] Failed to resolve live session id:', e);
  }
  return '';
}

async function createNewSession(): Promise<void> {
  if (!gatewayClient) {
    state.dockNotice = '未连接网关，无法新建会话';
    render();
    return;
  }

  try {
    let res: any;
    try {
      res = await gatewayClient.call<any>('session.create', {
        title: '新任务',
        profile: state.profileName || 'default',
      });
    } catch (firstErr) {
      if (isExtraInputsError(firstErr)) {
        console.warn('[Aura] Gateway rejected extra params on session.create, retrying minimal');
        res = await gatewayClient.call<any>('session.create', {});
      } else {
        throw firstErr;
      }
    }

    const handles = readSessionHandles(res);
    if (!handles) {
      state.dockNotice = '网关没有返回新会话的标识，无法开始对话';
      render();
      return;
    }

    state.activeSessionId = handles.storedId;
    state.activeLiveSessionId = handles.liveId;
    state.messages = [];
    state.dockNotice = '';
    state.modelMenuOpen = false;

    // session.list does not expose a brand-new session until its first turn is
    // persisted, so the rail gets an optimistic entry right away.
    if (!state.pendingSessionIds.includes(handles.storedId)) {
      state.pendingSessionIds = [handles.storedId, ...state.pendingSessionIds];
    }
    state.sessions = upsertSession(state.sessions, toPendingSession(handles, '新任务'));

    render();

    // Apply the model the user picked before the session existed.
    if (state.selectedModel) {
      await applyModelToLiveSession(state.selectedModel);
    }
  } catch (e) {
    console.error('[Hermes Gateway] Create session failed:', e);
    state.dockNotice = `新建会话失败: ${describeRpcError(e)}`;
    render();
  }
}

async function deleteSession(id: string): Promise<void> {
  if (!gatewayClient || !id) return;

  try {
    // 1. If session is active/running, close/interrupt it first
    try {
      await gatewayClient.call('session.close', { session_id: id });
    } catch {}
    try {
      await gatewayClient.call('session.interrupt', { session_id: id });
    } catch {}

    // 2. Perform delete
    let deleted = false;
    try {
      await gatewayClient.call('session.delete', { session_id: id });
      deleted = true;
    } catch (delErr: any) {
      const delMsg = describeRpcError(delErr);
      // If 4023 cannot delete an active session, try session.set_hidden or REST
      if (delMsg.includes('4023') || delMsg.includes('active session')) {
        try {
          await gatewayClient.call('session.set_hidden', { session_id: id, hidden: true });
          deleted = true;
        } catch {
          // Try REST delete proxy
          if (desktopApi?.httpProxy) {
            const baseUrl = getEffectiveUrl(state.gatewayUrl);
            await desktopApi.httpProxy({
              baseUrl,
              path: `/api/sessions/${encodeURIComponent(id)}`,
              method: 'DELETE',
              ticket: currentTicket,
            }).catch(() => null);
            deleted = true;
          }
        }
      } else {
        throw delErr;
      }
    }

    state.sessions = state.sessions.filter((s) => s.id !== id);
    state.pendingSessionIds = state.pendingSessionIds.filter((pid) => pid !== id);

    if (state.activeSessionId === id) {
      state.activeSessionId = state.sessions[0]?.id || '';
      state.activeLiveSessionId = '';
      if (state.activeSessionId) {
        await selectSession(state.activeSessionId);
      } else {
        state.messages = [];
        render();
      }
    } else {
      render();
    }
  } catch (e: any) {
    console.error('[Hermes Gateway] Delete session failed:', e);
    const msg = describeRpcError(e);
    if (msg.includes('4007') || msg.includes('not found')) {
      state.sessions = state.sessions.filter((s) => s.id !== id);
      state.pendingSessionIds = state.pendingSessionIds.filter((pid) => pid !== id);
      if (state.activeSessionId === id) {
        state.activeSessionId = state.sessions[0]?.id || '';
        state.activeLiveSessionId = '';
      }
      render();
      return;
    }
    state.dockNotice = `删除会话失败: ${msg}`;
    render();
  }
}

async function renameSession(id: string, currentTitle: string): Promise<void> {
  const newTitle = prompt('重命名会话', currentTitle);
  if (!newTitle || newTitle.trim() === '' || newTitle.trim() === currentTitle) return;
  const trimmed = newTitle.trim();

  try {
    if (gatewayClient) {
      await gatewayClient.call('session.title', { session_id: id, title: trimmed });
    }
    state.sessions = state.sessions.map((s) => (s.id === id ? { ...s, title: trimmed } : s));
    render();
  } catch (e) {
    // Optimistically update locally even if server returns error
    state.sessions = state.sessions.map((s) => (s.id === id ? { ...s, title: trimmed } : s));
    render();
  }
}

async function copySessionId(id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(id);
    state.dockNotice = `已复制会话 ID: ${id}`;
    render();
  } catch {
    state.dockNotice = `会话 ID: ${id}`;
    render();
  }
}

async function pinSession(id: string): Promise<void> {
  const target = state.sessions.find((s) => s.id === id);
  if (!target) return;
  state.sessions = [target, ...state.sessions.filter((s) => s.id !== id)];
  state.dockNotice = `已将会话「${target.title}」置顶`;
  render();
}

async function exportMarkdown(id: string): Promise<void> {
  const activeTitle = state.sessions.find((s) => s.id === id)?.title || 'session';
  const mdContent = state.messages
    .map((m) => {
      const header = m.role === 'user' ? '### User' : `### Assistant (${state.profileName || 'Agent'})`;
      return `${header} - ${m.timestamp}\n\n${m.thought ? `> 思考链：\n> ${m.thought.replace(/\n/g, '\n> ')}\n\n` : ''}${m.content}\n`;
    })
    .join('\n---\n\n');

  try {
    await navigator.clipboard.writeText(mdContent);
    state.dockNotice = `已将「${activeTitle}」全量对话导出并复制至剪贴板`;
    render();
  } catch {
    state.dockNotice = '导出失败，请检查剪贴板权限';
    render();
  }
}

async function archiveSession(id: string): Promise<void> {
  try {
    if (gatewayClient) {
      await gatewayClient.call('session.archive', { session_id: id });
    }
  } catch {}
  state.sessions = state.sessions.map((s) => (s.id === id ? { ...s, isArchived: !s.isArchived } : s));
  state.dockNotice = `已更新会话归档状态`;
  render();
}

async function selectSession(id: string): Promise<void> {
  if (!id) return;
  if (state.activeSessionId === id && state.activeLiveSessionId && state.messages.length > 0) return;

  state.activeSessionId = id;
  state.activeLiveSessionId = ''; // must be re-resolved through session.resume
  state.modelMenuOpen = false;
  await loadMessages(id);
}

/**
 * Pushes the selected model onto the live session.
 *
 * Handles both plain model id and optional provider-specific configuration.
 */
async function applyModelToLiveSession(model: string, provider?: string): Promise<void> {
  if (!gatewayClient || !model) return;

  const liveId = await ensureLiveSessionId();
  if (!liveId) return;

  try {
    const payload: { session_id: string; key: string; value: string; provider?: string } = {
      session_id: liveId,
      key: 'model',
      value: model,
    };
    if (provider) {
      payload.provider = provider;
    }
    await gatewayClient.call('config.set', payload);
  } catch (e) {
    if (provider && isExtraInputsError(e)) {
      // Gateway rejected provider field, retry with bare model
      try {
        await gatewayClient.call('config.set', { session_id: liveId, key: 'model', value: model });
        return;
      } catch (retryErr) {
        state.dockNotice = `切换模型失败: ${describeRpcError(retryErr)}`;
        render();
        return;
      }
    }
    state.dockNotice = `切换模型失败: ${describeRpcError(e)}`;
    render();
  }
}

async function switchModel(model: string, provider?: string): Promise<void> {
  if (!model) return;

  const previous = state.selectedModel;
  state.selectedModel = model;
  if (provider) state.currentProvider = provider;
  state.modelMenuOpen = false;
  state.dockNotice = '';

  // Update recent models list (keep top 8, persist in localStorage)
  state.recentModels = [model, ...state.recentModels.filter((m) => m !== model)].slice(0, 8);
  localStorage.setItem('hermes_aura_recent_models', JSON.stringify(state.recentModels));

  render();

  if (previous === model && !provider) return;

  if (!gatewayClient || !state.activeSessionId) {
    // No live conversation yet: the choice is applied right after session.create.
    return;
  }

  const liveId = await ensureLiveSessionId();
  if (!liveId) {
    state.selectedModel = previous;
    state.dockNotice = '无法切换到该模型：当前会话没有可用的实时通道，请重新进入会话';
    render();
    return;
  }

  try {
    const payload: { session_id: string; key: string; value: string; provider?: string } = {
      session_id: liveId,
      key: 'model',
      value: model,
    };
    if (provider) {
      payload.provider = provider;
    }
    await gatewayClient.call('config.set', payload);
  } catch (e) {
    if (provider && isExtraInputsError(e)) {
      try {
        await gatewayClient.call('config.set', { session_id: liveId, key: 'model', value: model });
        return;
      } catch (retryErr) {
        state.selectedModel = previous;
        state.dockNotice = `切换模型失败: ${describeRpcError(retryErr)}`;
        render();
        return;
      }
    }
    state.selectedModel = previous;
    state.dockNotice = `切换模型失败: ${describeRpcError(e)}`;
    render();
  }
}

async function switchReasoning(effort: 'off' | 'low' | 'medium' | 'high'): Promise<void> {
  state.reasoningLevel = effort;
  render();

  if (!gatewayClient || !state.activeSessionId) return;

  const liveId = await ensureLiveSessionId();
  if (!liveId) {
    state.dockNotice = '无法设置思考深度：当前会话没有可用的实时通道';
    render();
    return;
  }

  try {
    await gatewayClient.call('config.set', { session_id: liveId, key: 'reasoning', value: effort });
    state.dockNotice = '';
  } catch (e) {
    state.dockNotice = `设置思考深度失败: ${describeRpcError(e)}`;
  }
  render();
}

async function switchApproval(mode: 'auto' | 'ask' | 'sandbox'): Promise<void> {
  state.approvalMode = mode;
  render();

  // Map internal UI mode to gateway approval_mode (off | smart | manual)
  const gatewayModeMap: Record<string, string> = { auto: 'off', ask: 'smart', sandbox: 'manual' };

  if (!gatewayClient || !state.activeSessionId) return;

  const liveId = await ensureLiveSessionId();
  if (!liveId) {
    state.dockNotice = '无法设置审批策略：当前会话没有可用的实时通道';
    render();
    return;
  }

  try {
    await gatewayClient.call('config.set', {
      session_id: liveId,
      key: 'approval_mode',
      value: gatewayModeMap[mode] || 'smart',
    });
    state.dockNotice = '';
  } catch (e) {
    state.dockNotice = `设置审批策略失败: ${describeRpcError(e)}`;
  }
  render();
}


/** Force-unlocks the composer if a turn goes silent, so the UI can never latch. */
function armTurnWatchdog(): void {
  if (turnWatchdogTimer) clearTimeout(turnWatchdogTimer);
  turnWatchdogTimer = setTimeout(() => {
    turnWatchdogTimer = null;
    if (!state.isStreaming) return;
    tokenCoalescer.flush();
    state.isStreaming = false;
    activeStreamingMessageId = null;
    state.dockNotice = '上游长时间没有回传本轮结果，已解除发送锁定；如需继续请重新发送';
    render();
  }, TURN_WATCHDOG_MS);
}

function disarmTurnWatchdog(): void {
  if (turnWatchdogTimer) {
    clearTimeout(turnWatchdogTimer);
    turnWatchdogTimer = null;
  }
}

/** Asks the gateway to stop the running turn (the composer turns into a stop button). */
async function interruptTurn(): Promise<void> {
  if (!gatewayClient) return;

  const liveId = await ensureLiveSessionId();
  if (!liveId) {
    state.dockNotice = '当前会话没有可中断的实时通道';
    render();
    return;
  }

  try {
    await gatewayClient.call('session.interrupt', { session_id: liveId });
    state.dockNotice = '已请求中断本轮生成';
  } catch (e) {
    state.dockNotice = `中断失败: ${describeRpcError(e)}`;
  }
  render();
}

async function sendMessage(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  if (!gatewayClient) {
    state.dockNotice = '未连接网关，无法发送消息';
    render();
    return;
  }

  // A latched busy flag used to swallow every later message without feedback.
  if (state.isStreaming) {
    state.dockNotice = '当前回合仍在生成中，请等待完成或稍后重试';
    render();
    return;
  }

  if (!state.activeSessionId) {
    await createNewSession();
  }

  const liveId = await ensureLiveSessionId();
  if (!liveId) {
    state.dockNotice = '当前会话没有可用的实时通道，请重新选择会话后再发送';
    render();
    return;
  }

  state.dockNotice = '';

  const userMsgId = `usr-${Date.now()}`;
  state.messages.push({
    id: userMsgId,
    role: 'user',
    content: trimmed,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  });

  const assistantMsgId = `ast-${Date.now()}`;
  activeStreamingMessageId = assistantMsgId;
  const assistantMsg: MessageViewModel = {
    id: assistantMsgId,
    role: 'assistant',
    content: '',
    thought: '',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
  state.messages.push(assistantMsg);

  state.isStreaming = true;
  tokenCoalescer.clear();
  armTurnWatchdog();
  render();

  requestAnimationFrame(() => {
    const stream = document.getElementById('conversation-stream');
    if (stream) stream.scrollTop = stream.scrollHeight;
  });

  try {
    // `reasoning_effort` is not part of PromptSubmitParams on this gateway
    // (it answers 4000 / Extra inputs), so reasoning is configured through
    // config.set instead of being smuggled into the submit payload.
    const submitResult = await gatewayClient.call<any>('prompt.submit', {
      session_id: liveId,
      text: trimmed,
    });

    if (submitResult?.status && submitResult.status !== 'streaming' && submitResult.status !== 'queued') {
      assistantMsg.content = `[网关未受理本轮] status=${String(submitResult.status)}`;
      state.isStreaming = false;
      activeStreamingMessageId = null;
      disarmTurnWatchdog();
      render();
    }
  } catch (err) {
    console.error('[Hermes Gateway] prompt.submit failed:', err);
    assistantMsg.content = `[提交失败] ${describeRpcError(err)}`;
    state.isStreaming = false;
    activeStreamingMessageId = null;
    disarmTurnWatchdog();
    render();
  }
}

function formatTimestamp(ts: number | string): string {
  if (typeof ts === 'string') return ts;
  const date = new Date(ts > 1e11 ? ts : ts * 1000);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Writes the authoritative turn text back into the streamed assistant bubble. */
function setMessageContent(messageId: string, text: string): void {
  const target = state.messages.find((m) => m.id === messageId);
  if (!target) return;
  target.content = text;
  const el = document.getElementById(`msg-content-${messageId}`);
  if (el) {
    if (el.style.display === 'none') {
      el.style.display = 'flex';
    }
    el.innerHTML = renderMarkdown(text);
  }
}

/** Applies the actions produced by the pure gateway-event reducer. */
function applyTurnActions(actions: TurnAction[]): void {
  let needsRender = false;
  let finalReplace: { messageId: string; text: string } | null = null;

  for (const action of actions) {
    switch (action.type) {
      case 'turn-started':
        if (!state.isStreaming) {
          state.isStreaming = true;
          needsRender = true;
        }
        armTurnWatchdog();
        break;

      case 'append-content':
        tokenCoalescer.push({ messageId: action.messageId, delta: action.text, isThought: false });
        break;

      case 'append-thought':
        tokenCoalescer.push({ messageId: action.messageId, delta: action.text, isThought: true });
        break;

      case 'tool-start': {
        const target = state.messages.find((m) => m.id === action.messageId);
        if (target) {
          if (!target.toolCalls) target.toolCalls = [];
          target.toolCalls.push({
            id: action.toolCall.id,
            name: action.toolCall.name,
            status: 'running',
            args: action.toolCall.args,
          });
          needsRender = true;
        }
        break;
      }

      case 'tool-complete': {
        const target = state.messages.find((m) => m.id === action.messageId);
        if (target && target.toolCalls) {
          const tc = target.toolCalls.find((t) => !action.toolCallId || t.id === action.toolCallId);
          if (tc) {
            tc.status = 'completed';
            if (action.output) tc.output = action.output;
            needsRender = true;
          }
        }
        break;
      }

      case 'replace-content':
        // Deferred: buffered deltas must be flushed first, otherwise they would be
        // appended on top of the authoritative text.
        finalReplace = { messageId: action.messageId, text: action.text };
        break;

      case 'turn-completed':
        tokenCoalescer.flush();
        if (finalReplace) setMessageContent(finalReplace.messageId, finalReplace.text);
        state.isStreaming = false;
        activeStreamingMessageId = null;
        disarmTurnWatchdog();
        needsRender = true;
        break;

      case 'turn-failed': {
        tokenCoalescer.flush();
        const pendingMsg = activeStreamingMessageId
          ? state.messages.find((m) => m.id === activeStreamingMessageId)
          : undefined;
        if (pendingMsg && !pendingMsg.content) {
          pendingMsg.content = `[回合中断] ${action.message}`;
        }
        state.isStreaming = false;
        activeStreamingMessageId = null;
        state.dockNotice = action.message;
        disarmTurnWatchdog();
        needsRender = true;
        break;
      }

      case 'refresh-sessions':
        scheduleSessionsRefresh();
        break;

      case 'session-title':
        state.sessions = applySessionTitle(state.sessions, action.sessionId, action.title);
        needsRender = true;
        break;
    }
  }

  if (needsRender) render();
}

/** Inspector-side events (artifacts, browser frames, workspace diffs). */
function handleInspectorEvent(params: unknown): void {
  if (!params || typeof params !== 'object') return;
  const frame = params as { type?: unknown; payload?: Record<string, any> };
  const type = typeof frame.type === 'string' ? frame.type : '';
  const payload = frame.payload || {};
  if (!type) return;

  if (type === 'artifact.created' || type === 'artifact.updated') {
    if (!payload.id || !payload.name) return;
    const existing = state.artifacts.find((a) => a.id === payload.id);
    if (existing) {
      Object.assign(existing, payload);
    } else {
      state.artifacts.unshift({
        id: payload.id,
        name: payload.name,
        type: payload.type || 'FILE',
        size: payload.size || '1KB',
        preview: payload.preview || '',
      });
    }
    render();
    return;
  }

  if ((type === 'browser.frame' || type === 'browser.navigate') && payload.url) {
    state.browserFrame = {
      url: payload.url,
      title: payload.title || 'Page',
      screenshotUrl: payload.screenshotUrl || payload.screenshot,
    };
    render();
    return;
  }

  if ((type === 'git.diff' || type === 'workspace.diff') && Array.isArray(payload.diffs)) {
    state.gitDiffs = payload.diffs;
    render();
  }
}

async function connect(): Promise<void> {
  state.gatewayConnecting = true;
  state.testStatus = undefined;
  render();

  try {
    const test = await testConnection(
      state.gatewayUrl,
      state.username,
      state.password
    );
    state.gatewayLatencyMs = test.latency;
    state.testStatus = test;

    if (!test.ok) {
      state.gatewayConnecting = false;
      state.gatewayConnected = false;
      render();
      return;
    }

    currentTicket = test.ticket;
    localStorage.setItem('hermes_aura_gateway_url', state.gatewayUrl);
    localStorage.setItem('hermes_aura_username', state.username);
    localStorage.setItem('hermes_aura_password', state.password);
    localStorage.setItem('hermes_aura_profile', state.profileName);

    // Build WS URL
    const baseUrl = getEffectiveUrl(state.gatewayUrl);
    let wsUrl = baseUrl.replace('http://', 'ws://').replace('https://', 'wss://') + '/api/ws';
    if (test.ticket) {
      wsUrl += `?ticket=${encodeURIComponent(test.ticket)}`;
    }

    if (gatewayClient) {
      gatewayClient.disconnect();
      gatewayClient = null;
    }

    gatewayClient = new HermesGatewayClient({
      url: wsUrl,
      autoConnect: true,
      timeoutMs: 25000,
    });

    // Mount desktop HTTP REST Proxy fallback
    if (desktopApi?.httpProxy) {
      gatewayClient.setRestFallbackHandler(async (path, opts) => {
        return await desktopApi!.httpProxy({
          baseUrl,
          path,
          method: opts?.method,
          ticket: currentTicket,
          params: opts?.params,
          body: opts?.body,
        });
      });
    }

    // Register event listeners for streaming
    gatewayClient.onNotification('event', (params: unknown) => {
      const actions = reduceGatewayEvent(params, {
        activeSessionIds: [state.activeLiveSessionId, state.activeSessionId].filter(
          (id): id is string => Boolean(id)
        ),
        activeStreamingMessageId,
      });
      if (actions.length > 0) applyTurnActions(actions);

      handleInspectorEvent(params);
    });

    // Check ready state
    const rawWs = gatewayClient.getRawWebSocket();
    if (rawWs) {
      if (rawWs.readyState === WebSocket.OPEN) {
        state.gatewayConnected = true;
        state.gatewayConnecting = false;
        render();
        Promise.allSettled([fetchSessions(), fetchModelOptions(), fetchProfiles()]);
      } else {
        rawWs.addEventListener('open', () => {
          state.gatewayConnected = true;
          state.gatewayConnecting = false;
          render();
          Promise.allSettled([fetchSessions(), fetchModelOptions(), fetchProfiles()]);
        });
      }

      rawWs.addEventListener('close', () => {
        state.gatewayConnected = false;
        state.gatewayConnecting = false;
        render();
      });

      rawWs.addEventListener('error', (err) => {
        console.warn('[Aura WS] Socket error:', err);
        state.gatewayConnected = false;
        state.gatewayConnecting = false;
        render();
      });
    } else {
      state.gatewayConnected = true;
      state.gatewayConnecting = false;
      render();
      await Promise.allSettled([fetchSessions(), fetchModelOptions(), fetchProfiles()]);
    }
  } catch (err: any) {
    console.error('[Aura Connect] Connection failed:', err);
    state.gatewayConnected = false;
    state.gatewayConnecting = false;
    state.testStatus = {
      ok: false,
      message: `WebSocket 连接握手失败: ${err.message || '网络异常'}`,
      latency: 0,
    };
  }

  render();
}

function disconnect(): void {
  if (gatewayClient) {
    gatewayClient.disconnect();
    gatewayClient = null;
  }
  tokenCoalescer.clear();
  disarmTurnWatchdog();
  if (sessionsRefreshTimer) {
    clearTimeout(sessionsRefreshTimer);
    sessionsRefreshTimer = null;
  }
  state.gatewayConnected = false;
  state.gatewayConnecting = false;
  state.gatewayLatencyMs = 0;
  state.sessions = [];
  state.messages = [];
  state.activeSessionId = '';
  state.activeLiveSessionId = '';
  state.pendingSessionIds = [];
  state.isStreaming = false;
  state.modelMenuOpen = false;
  state.sessionListError = '';
  state.dockNotice = '';
  activeStreamingMessageId = null;
  render();
}

function render(): void {
  const root = document.getElementById('aura-app-root');
  if (!root) return;

  // The shell re-renders by replacing innerHTML, so transient UI state (draft text,
  // caret, focus, scroll position) has to be captured and restored by hand.
  const existingInput = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
  const draftText = existingInput ? existingInput.value : '';
  const inputHadFocus = Boolean(existingInput) && document.activeElement === existingInput;
  const caretStart = existingInput?.selectionStart ?? draftText.length;
  const caretEnd = existingInput?.selectionEnd ?? draftText.length;

  const streamEl = document.getElementById('conversation-stream');
  const streamScrollTop = streamEl ? streamEl.scrollTop : 0;
  const streamPinnedToBottom = streamEl
    ? streamEl.scrollHeight - streamEl.scrollTop - streamEl.clientHeight < 80
    : true;

  document.documentElement.setAttribute('data-theme', state.theme);

  const activeSession = state.sessions.find((s) => s.id === state.activeSessionId);
  const currentTitle = activeSession ? activeSession.title : (state.gatewayConnected ? 'Hermes Aura — 请选择或新建会话' : '未连接网关');

  const html = `
    <!-- Top Purified Titlebar -->
    ${renderTitlebar({
      platform: state.platform,
      title: currentTitle,
      isMaximized: state.isMaximized,
      gatewayConnected: state.gatewayConnected,
      profileName: state.profileName,
      profiles: state.profiles,
    })}

    <!-- Main Body Container -->
    <div class="aura-body-container" style="flex: 1; display: flex; position: relative; overflow: hidden; width: 100%;">
      <!-- Left Rail -->
      ${renderLeftRail({
        collapsed: state.leftRailCollapsed,
        activeSessionId: state.activeSessionId,
        sessions: state.sessions,
        profileName: state.profileName,
        profiles: state.profiles,
        gatewayOnline: state.gatewayConnected,
        gatewayLatencyMs: state.gatewayLatencyMs,
        error: state.sessionListError,
      })}

      <!-- Middle Conversation Pod (Full Bleed Fluid Canvas) -->
      ${renderMiddlePod({
        gatewayConnected: state.gatewayConnected,
        gatewayConnecting: state.gatewayConnecting,
        gatewayUrl: state.gatewayUrl,
        username: state.username,
        password: state.password,
        profileName: state.profileName,
        messages: state.messages,
        testStatus: state.testStatus,
      })}

      <!-- Floating Input Dock (Strict Golden Width Constraint) -->
      ${
        state.gatewayConnected
          ? renderInputDock({
              selectedModel: state.selectedModel,
              models: state.availableModels,
              modelDetails: state.modelDetails,
              favoriteModels: state.favoriteModels,
              recentModels: state.recentModels,
              modelSearchQuery: state.modelSearchQuery,
              reasoningLevel: state.reasoningLevel,
              approvalMode: state.approvalMode,
              isStreaming: state.isStreaming,
              disabled: !state.gatewayConnected,
              modelMenuOpen: state.modelMenuOpen,
              notice: state.dockNotice,
            })
          : ''
      }

      <!-- Adaptive Inspection Pod (OpenChamber Vertical Tab Rail) -->
      ${renderInspectionPod({
        collapsed: state.inspectorCollapsed,
        activeTab: state.activeInspectorTab,
        gatewayConnected: state.gatewayConnected,
        artifacts: state.artifacts,
        browserFrame: state.browserFrame,
        gitDiffs: state.gitDiffs,
        memories: state.memories,
      })}
    </div>

    <!-- Bottom Minimal Status Bar -->
    ${renderStatusBar({
      connectionStatus: state.gatewayConnected ? 'connected' : state.gatewayConnecting ? 'connecting' : 'disconnected',
      latencyMs: state.gatewayLatencyMs,
    })}

    <!-- Settings Modal Drawer -->
    ${renderSettingsModal({
      isOpen: state.isSettingsOpen,
      activeTab: state.settingsTab,
      gatewayUrl: state.gatewayUrl,
      username: state.username,
      password: state.password,
      profileName: state.profileName,
      theme: state.theme,
      lang: state.lang,
      connectionStatus: state.gatewayConnected ? 'connected' : state.gatewayConnecting ? 'connecting' : 'disconnected',
      latencyMs: state.gatewayLatencyMs,
      testStatus: state.testStatus,
    })}

    <!-- Session Right-Click Context Menu (OpenChamber Style) -->
    ${
      state.sessionContextMenu
        ? `
      <div id="session-context-menu" style="
        position: fixed;
        left: ${state.sessionContextMenu.x}px;
        top: ${state.sessionContextMenu.y}px;
        background: var(--bg-card);
        border: 1px solid var(--border-strong);
        border-radius: 8px;
        box-shadow: var(--shadow-window);
        padding: 5px;
        min-width: 170px;
        z-index: 2000;
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 12px;
        user-select: none;
      ">
        <button type="button" class="ctx-item" data-action="rename" style="padding: 6px 10px; border-radius: 5px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 8px; cursor: pointer; text-align: left;">
          <span>✏️</span><span>重命名</span>
        </button>
        <button type="button" class="ctx-item" data-action="copy-id" style="padding: 6px 10px; border-radius: 5px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 8px; cursor: pointer; text-align: left;">
          <span>📋</span><span>复制会话 ID</span>
        </button>
        <button type="button" class="ctx-item" data-action="pin" style="padding: 6px 10px; border-radius: 5px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 8px; cursor: pointer; text-align: left;">
          <span>📌</span><span>置顶会话</span>
        </button>
        <button type="button" class="ctx-item" data-action="export" style="padding: 6px 10px; border-radius: 5px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 8px; cursor: pointer; text-align: left;">
          <span>📥</span><span>导出 Markdown</span>
        </button>
        <div style="height: 1px; background: var(--border-subtle); margin: 3px 0;"></div>
        <button type="button" class="ctx-item" data-action="archive" style="padding: 6px 10px; border-radius: 5px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 8px; cursor: pointer; text-align: left;">
          <span>🗄️</span><span>归档</span>
        </button>
        <button type="button" class="ctx-item" data-action="delete" style="padding: 6px 10px; border-radius: 5px; border: none; background: transparent; color: #EF4444; display: flex; align-items: center; gap: 8px; cursor: pointer; text-align: left;">
          <span>🗑️</span><span>删除</span>
        </button>
      </div>
    `
        : ''
    }
  `;

  root.innerHTML = html;

  // Restore the composer draft, its caret and its focus.
  const newInput = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
  if (newInput) {
    if (draftText) newInput.value = draftText;
    if (inputHadFocus) {
      newInput.focus();
      const max = newInput.value.length;
      newInput.setSelectionRange(Math.min(caretStart, max), Math.min(caretEnd, max));
    }
  }

  const newStream = document.getElementById('conversation-stream');
  if (newStream) {
    newStream.scrollTop = streamPinnedToBottom ? newStream.scrollHeight : streamScrollTop;
  }

  bindEvents();
}

function bindEvents(): void {
  // Caption Buttons
  const minBtn = document.getElementById('win-min-btn');
  const maxBtn = document.getElementById('win-max-btn');
  const closeBtn = document.getElementById('win-close-btn');

  if (minBtn) minBtn.onclick = () => desktopApi?.minimize();
  if (maxBtn) {
    maxBtn.onclick = async () => {
      if (desktopApi) {
        state.isMaximized = await desktopApi.maximize();
        render();
      }
    };
  }
  if (closeBtn) closeBtn.onclick = () => desktopApi?.close();

  // Traffic lights
  const macClose = document.querySelector('.traffic-close') as HTMLElement;
  const macMin = document.querySelector('.traffic-min') as HTMLElement;
  const macMax = document.querySelector('.traffic-max') as HTMLElement;
  if (macClose) macClose.onclick = () => desktopApi?.close();
  if (macMin) macMin.onclick = () => desktopApi?.minimize();
  if (macMax) {
    macMax.onclick = async () => {
      if (desktopApi) {
        state.isMaximized = await desktopApi.maximize();
        render();
      }
    };
  }

  // Toggles
  const toggleLeftRail = document.getElementById('toggle-left-rail-btn');
  if (toggleLeftRail) {
    toggleLeftRail.onclick = () => {
      state.leftRailCollapsed = !state.leftRailCollapsed;
      render();
    };
  }

  const toggleInspector = document.getElementById('toggle-inspector-btn');
  if (toggleInspector) {
    toggleInspector.onclick = () => {
      state.inspectorCollapsed = !state.inspectorCollapsed;
      render();
    };
  }

  // Settings
  const btnOpenSettings = document.getElementById('btn-open-settings');
  if (btnOpenSettings) {
    btnOpenSettings.onclick = () => {
      state.isSettingsOpen = true;
      state.settingsTab = 'gateway';
      render();
    };
  }

  // Status Bar Toolbar & Node
  const statusSettings = document.getElementById('status-bar-settings-btn');
  if (statusSettings) {
    statusSettings.onclick = (e) => {
      e.stopPropagation();
      state.isSettingsOpen = true;
      state.settingsTab = 'gateway';
      render();
    };
  }

  const statusMetrics = document.getElementById('status-bar-metrics-btn');
  if (statusMetrics) {
    statusMetrics.onclick = (e) => {
      e.stopPropagation();
      state.dockNotice = `网关延迟: ${state.gatewayLatencyMs}ms | 连接状态: ${state.gatewayConnected ? '已连接' : '未连接'}`;
      render();
    };
  }

  const statusShortcuts = document.getElementById('status-bar-shortcuts-btn');
  if (statusShortcuts) {
    statusShortcuts.onclick = (e) => {
      e.stopPropagation();
      state.dockNotice = '快捷键：Ctrl+B 折叠侧栏 | Ctrl+\\ 折叠检查舱 | Enter 发送 | Shift+Enter 换行';
      render();
    };
  }

  const statusInfo = document.getElementById('status-bar-info-btn');
  if (statusInfo) {
    statusInfo.onclick = (e) => {
      e.stopPropagation();
      state.isSettingsOpen = true;
      state.settingsTab = 'about';
      render();
    };
  }

  const statusServerNode = document.getElementById('status-bar-server-node');
  if (statusServerNode) {
    statusServerNode.onclick = (e) => {
      e.stopPropagation();
      state.isSettingsOpen = true;
      state.settingsTab = 'gateway';
      render();
    };
  }

  const btnCloseSettings = document.getElementById('btn-close-settings');
  if (btnCloseSettings) {
    btnCloseSettings.onclick = () => {
      state.isSettingsOpen = false;
      render();
    };
  }

  const modalBackdrop = document.querySelector('.settings-modal-backdrop') as HTMLElement;
  if (modalBackdrop) {
    modalBackdrop.onclick = (e) => {
      if (e.target === modalBackdrop) {
        state.isSettingsOpen = false;
        render();
      }
    };
  }

  document.querySelectorAll('.settings-tab-btn').forEach((btn) => {
    (btn as HTMLElement).onclick = (e) => {
      const tab = (e.currentTarget as HTMLElement).getAttribute('data-tab') as any;
      if (tab) {
        state.settingsTab = tab;
        render();
      }
    };
  });

  document.querySelectorAll('.settings-theme-btn').forEach((btn) => {
    (btn as HTMLElement).onclick = (e) => {
      const theme = (e.currentTarget as HTMLElement).getAttribute('data-theme') as any;
      if (theme) {
        state.theme = theme;
        localStorage.setItem('hermes_aura_theme', theme);
        render();
      }
    };
  });

  // Agent Profile Switcher Chips
  document.querySelectorAll('.btn-profile-chip').forEach((btn) => {
    (btn as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      const profile = (btn as HTMLElement).dataset.profile;
      if (profile) switchProfile(profile);
    };
  });

  // Settings: Test & Save Buttons
  const settingsTestBtn = document.getElementById('btn-settings-test-connection');
  if (settingsTestBtn) {
    settingsTestBtn.onclick = async () => {
      const urlInput = (document.getElementById('settings-gateway-url') as HTMLInputElement)?.value;
      const userInput = (document.getElementById('settings-username') as HTMLInputElement)?.value;
      const passInput = (document.getElementById('settings-password') as HTMLInputElement)?.value;
      const profileInput = (document.getElementById('settings-profile-name') as HTMLInputElement)?.value;

      if (urlInput) {
        state.gatewayUrl = urlInput;
        localStorage.setItem('hermes_aura_gateway_url', urlInput);
      }
      if (userInput !== undefined) {
        state.username = userInput;
        localStorage.setItem('hermes_aura_username', userInput);
      }
      if (passInput !== undefined) {
        state.password = passInput;
        localStorage.setItem('hermes_aura_password', passInput);
      }
      if (profileInput !== undefined) {
        state.profileName = profileInput || 'default';
        localStorage.setItem('hermes_aura_profile', state.profileName);
      }

      settingsTestBtn.innerText = '正在测试...';
      const res = await testConnection(urlInput, userInput, passInput);
      state.testStatus = res;
      settingsTestBtn.innerText = '连通性测试';
      render();
    };
  }

  const settingsSaveBtn = document.getElementById('btn-settings-save-connect');
  if (settingsSaveBtn) {
    settingsSaveBtn.onclick = () => {
      state.gatewayUrl = (document.getElementById('settings-gateway-url') as HTMLInputElement)?.value || state.gatewayUrl;
      state.username = (document.getElementById('settings-username') as HTMLInputElement)?.value || '';
      state.password = (document.getElementById('settings-password') as HTMLInputElement)?.value || '';
      state.profileName = (document.getElementById('settings-profile-name') as HTMLInputElement)?.value || 'default';
      state.isSettingsOpen = false;
      connect();
    };
  }

  const disconnectBtn = document.getElementById('btn-disconnect-gateway');
  if (disconnectBtn) {
    disconnectBtn.onclick = () => {
      disconnect();
    };
  }

  // Session search filter
  const searchInput = document.getElementById('session-search-input') as HTMLInputElement | null;
  if (searchInput) {
    searchInput.oninput = () => {
      const query = searchInput.value.toLowerCase().trim();
      document.querySelectorAll('.session-item').forEach((item) => {
        const title = item.querySelector('span')?.textContent?.toLowerCase() || '';
        (item as HTMLElement).style.display = title.includes(query) ? 'flex' : 'none';
      });
    };
  }

  // File attach button
  const attachBtn = document.getElementById('dock-attach-file-btn');
  if (attachBtn) {
    attachBtn.onclick = async () => {
      if (desktopApi?.openFileDialog) {
        const paths = await desktopApi.openFileDialog();
        if (paths && paths.length > 0) {
          const input = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
          if (input) {
            input.value += (input.value ? '\n' : '') + `[附加文件: ${paths.join(', ')}]`;
          }
        }
      }
    };
  }

  // Onboarding Buttons
  const onboardingTestBtn = document.getElementById('btn-test-connection');
  if (onboardingTestBtn) {
    onboardingTestBtn.onclick = async () => {
      const urlInput = (document.getElementById('onboarding-gateway-url') as HTMLInputElement)?.value;
      const userInput = (document.getElementById('onboarding-username') as HTMLInputElement)?.value;
      const passInput = (document.getElementById('onboarding-password') as HTMLInputElement)?.value;
      const profileInput = (document.getElementById('onboarding-profile-name') as HTMLInputElement)?.value;

      if (urlInput) {
        state.gatewayUrl = urlInput;
        localStorage.setItem('hermes_aura_gateway_url', urlInput);
      }
      if (userInput !== undefined) {
        state.username = userInput;
        localStorage.setItem('hermes_aura_username', userInput);
      }
      if (passInput !== undefined) {
        state.password = passInput;
        localStorage.setItem('hermes_aura_password', passInput);
      }
      if (profileInput !== undefined) {
        state.profileName = profileInput || 'default';
        localStorage.setItem('hermes_aura_profile', state.profileName);
      }

      onboardingTestBtn.innerText = '正在测试...';
      const res = await testConnection(urlInput, userInput, passInput);
      state.testStatus = res;
      onboardingTestBtn.innerText = '连通性测试';
      render();
    };
  }

  const onboardingSaveBtn = document.getElementById('btn-save-and-connect');
  if (onboardingSaveBtn) {
    onboardingSaveBtn.onclick = async () => {
      state.gatewayUrl = (document.getElementById('onboarding-gateway-url') as HTMLInputElement)?.value || state.gatewayUrl;
      state.username = (document.getElementById('onboarding-username') as HTMLInputElement)?.value || '';
      state.password = (document.getElementById('onboarding-password') as HTMLInputElement)?.value || '';
      state.profileName = (document.getElementById('onboarding-profile-name') as HTMLInputElement)?.value || 'default';
      connect();
    };
  }

  // Session items & Context Menu
  const newChatBtn = document.getElementById('new-chat-btn');
  if (newChatBtn) newChatBtn.onclick = () => createNewSession();

  document.querySelectorAll('.session-item').forEach((item) => {
    (item as HTMLElement).onclick = (e) => {
      if ((e.target as HTMLElement).classList.contains('btn-delete-session')) return;
      const id = (item as HTMLElement).dataset.id;
      if (id) selectSession(id);
    };

    (item as HTMLElement).oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = (item as HTMLElement).dataset.id;
      const title = (item as HTMLElement).dataset.title || '';
      if (id) {
        state.sessionContextMenu = {
          x: Math.min(e.clientX, window.innerWidth - 180),
          y: Math.min(e.clientY, window.innerHeight - 220),
          sessionId: id,
          sessionTitle: title,
        };
        render();
      }
    };
  });

  // Handle Context Menu Actions
  document.querySelectorAll('#session-context-menu .ctx-item').forEach((btn) => {
    (btn as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      const action = (btn as HTMLElement).dataset.action;
      const ctx = state.sessionContextMenu;
      state.sessionContextMenu = undefined;
      render();

      if (!ctx) return;
      if (action === 'rename') {
        void renameSession(ctx.sessionId, ctx.sessionTitle);
      } else if (action === 'copy-id') {
        void copySessionId(ctx.sessionId);
      } else if (action === 'pin') {
        void pinSession(ctx.sessionId);
      } else if (action === 'export') {
        void exportMarkdown(ctx.sessionId);
      } else if (action === 'archive') {
        void archiveSession(ctx.sessionId);
      } else if (action === 'delete') {
        if (confirm(`确定要删除会话「${ctx.sessionTitle || ctx.sessionId}」吗？`)) {
          void deleteSession(ctx.sessionId);
        }
      }
    };
  });

  document.querySelectorAll('.btn-delete-session').forEach((btn) => {
    (btn as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id;
      if (id && confirm('确定要删除此会话吗？')) {
        deleteSession(id);
      }
    };
  });

  // Inspector Tabs
  document.querySelectorAll('.vertical-tab-item').forEach((tab) => {
    (tab as HTMLElement).onclick = () => {
      const key = (tab as HTMLElement).dataset.tab as InspectorTab;
      if (key) {
        state.activeInspectorTab = key;
        render();
      }
    };
  });

  // Model Selector — visibility is application state, never raw DOM poking: every
  // click handler ends in render(), which rebuilds the subtree from state.
  const modelBtn = document.getElementById('dock-model-selector-btn');
  const refreshModelBtn = document.getElementById('btn-refresh-models');

  if (refreshModelBtn) {
    refreshModelBtn.onclick = (e) => {
      e.stopPropagation();
      void fetchModelOptions();
    };
  }

  if (modelBtn) {
    modelBtn.onclick = (e) => {
      e.stopPropagation();
      const dropdown = document.getElementById('dock-model-dropdown');
      if (!dropdown) return;
      state.modelMenuOpen = !state.modelMenuOpen;
      dropdown.style.display = state.modelMenuOpen ? 'block' : 'none';
      if (state.modelMenuOpen) {
        if (state.availableModels.length === 0) {
          void fetchModelOptions();
        }
        const search = document.getElementById('dock-model-search-input') as HTMLInputElement | null;
        if (search) search.focus();
      }
    };
  }

  // Bind dropdown options
  bindModelDropdownEvents();

  // Reasoning Cycle Toggle (关 -> 低 -> 中 -> 高)
  const reasoningBtn = document.getElementById('dock-reasoning-toggle-btn');
  if (reasoningBtn) {
    reasoningBtn.onclick = () => {
      const cycle: Record<AppState['reasoningLevel'], AppState['reasoningLevel']> = {
        off: 'low',
        low: 'medium',
        medium: 'high',
        high: 'off',
      };
      const nextLevel = cycle[state.reasoningLevel] || 'high';
      switchReasoning(nextLevel);
    };
  }

  // Approval Mode Cycle Toggle (自动 -> 询问 -> 沙箱)
  const approvalBtn = document.getElementById('dock-approval-toggle-btn');
  if (approvalBtn) {
    approvalBtn.onclick = () => {
      const cycle: Record<AppState['approvalMode'], AppState['approvalMode']> = {
        auto: 'ask',
        ask: 'sandbox',
        sandbox: 'auto',
      };
      const nextMode = cycle[state.approvalMode] || 'auto';
      switchApproval(nextMode);
    };
  }

  // Send message & IME Composition defense
  const sendBtn = document.getElementById('dock-send-btn');
  const inputEl = document.getElementById('dock-prompt-input') as HTMLTextAreaElement;
  let isComposing = false;

  const handleSend = (source: 'button' | 'enter') => {
    if (!inputEl) return;
    const text = inputEl.value.trim();

    if (state.isStreaming) {
      // Clicking the stop button interrupts; pressing Enter must not.
      if (source === 'button') {
        void interruptTurn();
      } else {
        state.dockNotice = '当前回合仍在生成中，可点击右侧停止按钮中断';
        render();
      }
      return;
    }

    if (!text) return;
    inputEl.value = '';
    void sendMessage(text);
  };

  if (sendBtn) sendBtn.onclick = () => handleSend('button');
  if (inputEl) {
    inputEl.addEventListener('compositionstart', () => { isComposing = true; });
    inputEl.addEventListener('compositionend', () => { isComposing = false; });
    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
        e.preventDefault();
        handleSend('enter');
      }
    };
  }
}

function bindModelDropdownEvents(): void {
  // Search model input
  const modelSearchInput = document.getElementById('dock-model-search-input') as HTMLInputElement | null;
  if (modelSearchInput) {
    modelSearchInput.onclick = (e) => e.stopPropagation();
    modelSearchInput.oninput = (e) => {
      e.stopPropagation();
      state.modelSearchQuery = (e.target as HTMLInputElement).value;
      updateModelDropdownSubtree();
    };
  }

  // Toggle favorite model
  document.querySelectorAll('.btn-toggle-favorite').forEach((btn) => {
    (btn as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      const modelId = (e.currentTarget as HTMLElement).getAttribute('data-model');
      if (modelId) {
        if (state.favoriteModels.includes(modelId)) {
          state.favoriteModels = state.favoriteModels.filter((m) => m !== modelId);
        } else {
          state.favoriteModels.push(modelId);
        }
        localStorage.setItem('hermes_aura_fav_models', JSON.stringify(state.favoriteModels));
        updateModelDropdownSubtree();
      }
    };
  });

  document.querySelectorAll('.model-option').forEach((opt) => {
    (opt as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      const model = (e.currentTarget as HTMLElement).getAttribute('data-model');
      const provider = (e.currentTarget as HTMLElement).getAttribute('data-provider') || undefined;
      const dropdown = document.getElementById('dock-model-dropdown');
      if (dropdown) dropdown.style.display = 'none';
      state.modelMenuOpen = false;
      if (model) void switchModel(model, provider);
    };
  });
}

function updateModelDropdownSubtree(): void {
  const scrollList = document.getElementById('model-picker-scroll-list');
  if (!scrollList) return;
  scrollList.innerHTML = renderModelPickerTree({
    selectedModel: state.selectedModel,
    models: state.availableModels,
    modelDetails: state.modelDetails,
    favoriteModels: state.favoriteModels,
    recentModels: state.recentModels,
    modelSearchQuery: state.modelSearchQuery,
    reasoningLevel: state.reasoningLevel,
    approvalMode: state.approvalMode,
    isStreaming: state.isStreaming,
  });
  bindModelDropdownEvents();
}

// Global keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    state.leftRailCollapsed = !state.leftRailCollapsed;
    render();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
    e.preventDefault();
    state.inspectorCollapsed = !state.inspectorCollapsed;
    render();
  }
  if (e.key === 'Escape' && state.isSettingsOpen) {
    state.isSettingsOpen = false;
    render();
  } else if (e.key === 'Escape' && state.modelMenuOpen) {
    state.modelMenuOpen = false;
    render();
  }
});

// Close the model menu or context menu when the pointer goes down outside of it.
document.addEventListener('mousedown', (e) => {
  if (state.sessionContextMenu) {
    const ctxMenu = document.getElementById('session-context-menu');
    if (!ctxMenu || !ctxMenu.contains(e.target as Node)) {
      state.sessionContextMenu = undefined;
      render();
    }
  }

  if (!state.modelMenuOpen) return;
  const wrapper = document.querySelector('.pill-dropdown-wrapper');
  if (wrapper && !wrapper.contains(e.target as Node)) {
    state.modelMenuOpen = false;
    render();
  }
});

async function init(): Promise<void> {
  if (desktopApi) {
    try {
      const sys = await desktopApi.getSystemInfo();
      state.platform = sys.platform || 'windows';
      state.isMaximized = await desktopApi.isMaximized();

      desktopApi.onWindowStateChange((ws) => {
        state.isMaximized = ws.isMaximized;
        render();
      });

      if (desktopApi?.getDefaultGatewayConfig) {
        const def = await desktopApi.getDefaultGatewayConfig();
        if (def) {
          if (def.url && !localStorage.getItem('hermes_aura_gateway_url')) state.gatewayUrl = def.url;
          if (def.profile && !localStorage.getItem('hermes_aura_profile')) state.profileName = def.profile;
        }
      }
    } catch (e) {
      console.warn('[Desktop PAL] Sync note:', e);
    }
  }

  connect();
}

init();
