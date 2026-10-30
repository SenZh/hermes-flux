/**
 * Hermes Flux Desktop Renderer Application Entry (v4.0 Production)
 * Fully powered by @hermes-flux/core and @hermes-flux/ui
 * Zero private WS glue code: Dual-channel fallback, TokenCoalescer 120 FPS stream, robust model & session lifecycle.
 */

import {
  renderTitlebar,
  renderLeftRail,
  renderMiddlePod,
  renderConversationCanvas,
  renderInputDock,
  renderInspectionPod,
  renderStatusBar,
  renderSettingsModal,
  renderModelPickerMenu,
  renderModelPickerTree,
  renderMessage,
  renderMarkdown,
  getCleanReasoningSummary,
  escapeHtml,
  MessageViewModel,
  InspectorTab,
} from '@hermes-flux/ui';

import {
  HermesGatewayClient,
  TokenCoalescer,
  reduceGatewayEvent,
  readSessionHandles,
  toPendingSession,
  upsertSession,
  applySessionTitle,
  createLogger,
  setLogLevel,
  getLogLevel,
  parseLogLevel,
  isLogLevelEnabled,
  type LogLevel,
  type TurnAction,
  type NormalizedSession,
  type ModelDetail,
  type AgentProfile,
} from '@hermes-flux/core';

import type { HermesDesktopBridge } from '../preload/index.js';

declare global {
  interface Window {
    hermesDesktop?: HermesDesktopBridge;
    /** Runtime log level control: `__fluxLog.setLevel('trace')` in DevTools. */
    __fluxLog?: {
      readonly level: LogLevel;
      setLevel(next: string): LogLevel;
    };
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
  reasoningLevel: 'default' | 'none' | 'low' | 'high' | 'max' | 'off' | 'medium';
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
  hasOlderMessages: boolean;
  isLoadingOlder: boolean;
  favoriteModels: string[];
  recentModels: string[];
  modelSearchQuery: string;
  testStatus?: { ok?: boolean; message?: string; latency?: number };
  artifacts: Array<{ id: string; name: string; type: string; size: string; preview?: string }>;
  browserFrame?: { url: string; title: string; screenshotUrl?: string };
  gitDiffs: Array<{ file: string; additions: number; deletions: number; patch?: string }>;
  memories: Array<{ category: string; content: string; updated?: string }>;
  agentActivityStatus?: string;
  inspectorFullscreen?: boolean;
  // Multi-tab file viewer & OpenChamber toolbar states
  openFiles: Array<{ id?: string; path: string; content: string; language?: string; isDiff?: boolean }>;
  activeFilePath: string;
  fileViewMode: 'rendered' | 'raw';
  fileShowLineNumbers: boolean;
  fileWordWrap: boolean;
  fileSearchOpen: boolean;
  fileSearchQuery: string;
}

const desktopApi: HermesDesktopBridge | undefined = window.hermesDesktop;

/* --------------------------------------------------------------------------
   Leveled diagnostics
   Level resolution order:
     1. `?log=<level>` on the URL — the unpackaged dev build passes `debug`.
     2. `localStorage.hermes_flux_log_level` — persisted runtime override.
     3. `info` in production.
   Change it live from DevTools with `__fluxLog.setLevel('trace')`.
   -------------------------------------------------------------------------- */

const LOG_LEVEL_STORAGE_KEY = 'hermes_flux_log_level';

function resolveInitialLogLevel(): LogLevel {
  const fromUrl = new URLSearchParams(window.location.search).get('log');
  if (fromUrl) return parseLogLevel(fromUrl, 'debug');
  const stored = window.localStorage.getItem(LOG_LEVEL_STORAGE_KEY);
  if (stored) return parseLogLevel(stored, 'info');
  return 'info';
}

setLogLevel(resolveInitialLogLevel());

const state: AppState = {
  platform: 'windows',
  theme: (localStorage.getItem('hermes_flux_theme') || localStorage.getItem('hermes_aura_theme') as any) || 'obsidian-gold',
  lang: (localStorage.getItem('hermes_flux_lang') || localStorage.getItem('hermes_aura_lang') as any) || 'zh',
  isMaximized: false,
  leftRailCollapsed: false,
  inspectorCollapsed: true,
  activeInspectorTab: 'artifacts',
  activeSessionId: '',
  activeLiveSessionId: '',
  selectedModel: '',
  availableModels: [],
  modelDetails: [],
  currentProvider: '',
  profiles: [],
  profileName: localStorage.getItem('hermes_flux_profile') || localStorage.getItem('hermes_aura_profile') || 'default',
  modelMenuOpen: false,
  dockNotice: '',
  sessionListError: '',
  pendingSessionIds: [],
  favoriteModels: JSON.parse(localStorage.getItem('hermes_flux_fav_models') || localStorage.getItem('hermes_aura_fav_models') || '[]'),
  recentModels: JSON.parse(localStorage.getItem('hermes_flux_recent_models') || localStorage.getItem('hermes_aura_recent_models') || '[]'),
  modelSearchQuery: '',
  reasoningLevel: 'high',
  approvalMode: 'auto',
  isStreaming: false,
  gatewayConnected: false,
  gatewayConnecting: Boolean(localStorage.getItem('hermes_flux_gateway_url') || localStorage.getItem('hermes_aura_gateway_url')),
  gatewayLatencyMs: 0,
  gatewayUrl: localStorage.getItem('hermes_flux_gateway_url') || localStorage.getItem('hermes_aura_gateway_url') || 'http://127.0.0.1:9119',
  username: localStorage.getItem('hermes_flux_username') || localStorage.getItem('hermes_aura_username') || '',
  password: localStorage.getItem('hermes_flux_password') || localStorage.getItem('hermes_aura_password') || '',
  isSettingsOpen: false,
  settingsTab: 'gateway',
  sessions: [],
  messages: [],
  hasOlderMessages: false,
  isLoadingOlder: false,
  inspectorFullscreen: false,
  openFiles: [],
  activeFilePath: '',
  fileViewMode: 'rendered',
  fileShowLineNumbers: true,
  fileWordWrap: false,
  fileSearchOpen: false,
  fileSearchQuery: '',
  testStatus: undefined,
  artifacts: [],
  browserFrame: undefined,
  gitDiffs: [],
  memories: [],
};

window.__fluxLog = {
  get level() {
    return getLogLevel();
  },
  setLevel(next: string) {
    const level = parseLogLevel(next, getLogLevel());
    setLogLevel(level);
    window.localStorage.setItem(LOG_LEVEL_STORAGE_KEY, level);
    return level;
  },
};

const logApp = createLogger('app');
const logRender = createLogger('render');
const logSession = createLogger('session');
const logStream = createLogger('stream');
const logScroll = createLogger('scroll');

(window as any).__fluxState = state;
(window as any).__fluxConnect = connect;

let gatewayClient: HermesGatewayClient | null = null;
let currentTicket: string | undefined = undefined;
let activeStreamingMessageId: string | null = null;
let activeStreamingStoredSessionId: string | null = null;
let activeStreamingLiveId: string | null = null;
const sessionDraftMap = new Map<string, string>();
let dockNoticeDismissTimer: ReturnType<typeof setTimeout> | null = null;
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


/**
 * Distance from the bottom, in px, inside which the stream counts as
 * "following the conversation". Anything further up means the reader scrolled
 * back deliberately and must not be dragged along by new tokens.
 */
const STICK_TO_BOTTOM_THRESHOLD_PX = 48;

/**
 * Set right before a render that must land at the newest message (session
 * switch, first load, sending a prompt). `applyStreamAnchor` consumes it so the
 * viewport never flashes at the old position for a frame.
 */
let pendingScrollToBottom = false;

function isStreamNearBottom(stream: HTMLElement | null): boolean {
  if (!stream) return false;
  return stream.scrollHeight - stream.scrollTop - stream.clientHeight <= STICK_TO_BOTTOM_THRESHOLD_PX;
}

/** Pins the stream to the newest message, then re-pins once layout settles. */
function scrollStreamToBottom(reason: string): void {
  const stream = document.getElementById('conversation-stream');
  if (!stream) return;
  stream.scrollTop = stream.scrollHeight;

  requestAnimationFrame(() => {
    const settled = document.getElementById('conversation-stream');
    if (!settled) return;
    const drift = settled.scrollHeight - settled.scrollTop - settled.clientHeight;
    if (drift > 1) {
      settled.scrollTop = settled.scrollHeight;
    }
    logScroll.debug('pinned to bottom', {
      reason,
      scrollHeight: settled.scrollHeight,
      clientHeight: settled.clientHeight,
      residualDrift: Math.round(drift),
    });
  });
}

/**
 * Chromium reports every unexplained layout shift; a viewport that "jumps" is
 * exactly a run of these. Logged so a jump can be traced to the frame that
 * caused it instead of guessed at.
 */
function installLayoutShiftDiagnostics(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  if (!isLogLevelEnabled('debug')) return;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
        const value = entry.value ?? 0;
        if (value < 0.0005 || entry.hadRecentInput) continue;
        const stream = document.getElementById('conversation-stream');
        logScroll.debug('layout shift', {
          value: Math.round(value * 1000) / 1000,
          scrollTop: stream ? Math.round(stream.scrollTop) : null,
          scrollHeight: stream ? stream.scrollHeight : null,
          streaming: state.isStreaming,
        });
      }
    });
    observer.observe({ type: 'layout-shift', buffered: true });
  } catch {
    // The API is Chromium-only; its absence is not an error.
  }
}

// Token coalescer for smooth 60-120fps stream updates
const tokenCoalescer = new TokenCoalescer((flushedMap) => {
  const flushStartedAt = performance.now();

  // Follow-or-not is decided BEFORE content mutates: a reader who scrolled up
  // must never be yanked back by an incoming token.
  const followBottom = isStreamNearBottom(document.getElementById('conversation-stream'));
  let renderedChars = 0;

  for (const [msgId, entry] of flushedMap.entries()) {
    // Session Isolation: Tokens belong only to the session that initiated the turn
    const isCurrentSessionActive = activeStreamingStoredSessionId === state.activeSessionId;
    let targetMsg: MessageViewModel | undefined;

    // Always keep background session cache updated with incoming chunks
    if (activeStreamingStoredSessionId) {
      let cached = sessionMessagesCache.get(activeStreamingStoredSessionId);
      if (!cached) {
        cached = [];
        sessionMessagesCache.set(activeStreamingStoredSessionId, cached);
      }
      let cachedTarget = cached.find((m) => m.id === msgId);
      if (!cachedTarget) {
        cachedTarget = {
          id: msgId,
          role: 'assistant',
          content: '',
          thought: '',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        };
        cached.push(cachedTarget);
      }
      if (entry.content) cachedTarget.content += entry.content;
      if (entry.thought) cachedTarget.thought = (cachedTarget.thought || '') + entry.thought;
    }

    if (isCurrentSessionActive) {
      targetMsg = state.messages.find((m) => m.id === msgId);
      if (!targetMsg && activeStreamingStoredSessionId) {
        const cached = sessionMessagesCache.get(activeStreamingStoredSessionId);
        targetMsg = cached?.find((m) => m.id === msgId);
        if (targetMsg && !state.messages.some((m) => m.id === msgId)) {
          state.messages.push(targetMsg);
        }
      }
    }

    if (!targetMsg || targetMsg.role !== 'assistant') continue;

    if (entry.content && isCurrentSessionActive) {
      renderedChars += entry.content.length;
      const contentEl = document.getElementById(`msg-content-${targetMsg.id}`);
      if (contentEl) {
        if (contentEl.style.display === 'none') {
          contentEl.style.display = 'flex';
        }
        // 关键规则：必须显式锁定 flexDirection = 'column'，严禁 flex 默认的 row 布局将多个 Markdown 段落横向排成多列
        if (contentEl.style.flexDirection !== 'column') {
          contentEl.style.flexDirection = 'column';
        }
        const rendered = renderMarkdown(targetMsg.content);
        contentEl.innerHTML = rendered;
      }
    }

    if (entry.thought && isCurrentSessionActive) {
      const thoughtEl = document.getElementById(`msg-thought-${targetMsg.id}`);
      if (thoughtEl) {
        thoughtEl.innerText = targetMsg.thought || '';
        const fold = thoughtEl.closest('details');
        if (fold) {
          fold.style.display = 'block';
          if (!fold.open) fold.open = true;
          const summaryEl = fold.querySelector('summary span:last-child') as HTMLElement | null;
          if (summaryEl) {
            summaryEl.innerText = getCleanReasoningSummary(targetMsg.thought || '');
          }
        }
      }
    }
  }

  const stream = document.getElementById('conversation-stream');
  if (stream && followBottom) {
    stream.scrollTop = stream.scrollHeight;
  }

  logStream.trace('flush', {
    ms: Math.round((performance.now() - flushStartedAt) * 10) / 10,
    messages: flushedMap.size,
    chars: renderedChars,
    followBottom,
    scrollTop: stream ? Math.round(stream.scrollTop) : null,
  });
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
    console.warn('[Flux] fetchProfiles failed:', e);
  }
}

async function switchProfile(name: string): Promise<void> {
  if (!name || state.profileName === name) return;
  state.profileName = name;
  localStorage.setItem('hermes_flux_profile', name);
  localStorage.setItem('hermes_aura_profile', name);
  render();
  await Promise.allSettled([fetchSessions(), fetchModelOptions()]);
}

// OpenChamber Standard Message Paging: Initial Window 50 items for instant cold launch
const INITIAL_WINDOW_PAGE_SIZE = 50;
const OLDER_BATCH_PAGE_SIZE = 30;
const sessionMessagesCache = new Map<string, MessageViewModel[]>();
const sessionServerOffset = new Map<string, number>();

function parseRawMessages(list: any[]): MessageViewModel[] {
  const parsedMessages: MessageViewModel[] = [];

  for (let idx = 0; idx < list.length; idx++) {
    const m = list[idx];
    if (!m || typeof m !== 'object') continue;

    const rawRole = String(m.role || '').toLowerCase();
    
    let rawText = '';
    if (typeof m.text === 'string') {
      rawText = m.text;
    } else if (typeof m.content === 'string') {
      rawText = m.content;
    } else if (Array.isArray(m.content)) {
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

    const thought = typeof m.thinking === 'string'
      ? m.thinking
      : typeof m.thought === 'string'
      ? m.thought
      : typeof m.reasoning === 'string'
      ? m.reasoning
      : '';

    const rawToolCalls = Array.isArray(m.tool_calls)
      ? m.tool_calls
      : Array.isArray(m.tools)
      ? m.tools
      : Array.isArray(m.tool_use)
      ? m.tool_use
      : [];

    const toolCalls = rawToolCalls.map((tc: any, tIdx: number) => {
      const toolName = tc.name || tc.function?.name || tc.tool || 'tool';
      let rawArgs = tc.args ?? tc.arguments ?? tc.function?.arguments ?? tc.input ?? tc.parameters ?? {};
      if (typeof rawArgs === 'string') {
        const trimmed = rawArgs.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
          try {
            rawArgs = JSON.parse(trimmed);
          } catch {}
        }
      }

      // Deeply extract command or target file path so the title line never shows empty
      let cleanArg = '';
      if (typeof rawArgs === 'object' && rawArgs !== null) {
        cleanArg = rawArgs.command || rawArgs.cmd || rawArgs.path || rawArgs.file || rawArgs.filePath || rawArgs.file_path || rawArgs.resolved_path || rawArgs.query || rawArgs.pattern || rawArgs.description || rawArgs.prompt || '';
      } else if (typeof rawArgs === 'string') {
        cleanArg = rawArgs;
      }

      const argsStr = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs);

      return {
        id: tc.id || tc.tool_call_id || `tc-${idx}-${tIdx}`,
        name: toolName,
        status: (tc.status || 'completed') as any,
        args: cleanArg ? cleanArg : argsStr,
        output: tc.output ? String(tc.output) : tc.result ? String(tc.result) : tc.stdout ? String(tc.stdout) : undefined,
      };
    });

    let isToolPayload = rawRole === 'tool' || rawRole === 'function';
    let synthesizedToolCall: any = null;

    if (!isToolPayload && rawText.trim().startsWith('{') && rawText.trim().endsWith('}')) {
      try {
        const parsed = JSON.parse(rawText.trim());
        if (
          parsed &&
          typeof parsed === 'object' &&
          ('output' in parsed || 'stdout' in parsed || 'exit_code' in parsed || 'exitCode' in parsed || 'diff' in parsed || 'files_modified' in parsed || 'total_count' in parsed || 'matches_text' in parsed || 'content' in parsed)
        ) {
          isToolPayload = true;
          let toolName = 'tool';
          let targetArg = '';

          if ('matches_text' in parsed || 'total_count' in parsed) {
            toolName = 'grep';
          } else if ('diff' in parsed || 'files_modified' in parsed) {
            toolName = 'edit';
            targetArg = parsed.resolved_path || (parsed.files_modified ? parsed.files_modified[0] : '') || '';
          } else if ('output' in parsed || 'stdout' in parsed) {
            toolName = 'shell';
          }

          let formattedOutput = parsed.output ?? parsed.stdout ?? parsed.diff ?? parsed.matches_text ?? rawText;
          if (typeof formattedOutput !== 'string') {
            formattedOutput = JSON.stringify(formattedOutput, null, 2);
          }

          synthesizedToolCall = {
            id: m.tool_call_id || `tc-synth-${idx}`,
            name: toolName,
            status: 'completed',
            args: targetArg,
            output: formattedOutput,
          };
        }
      } catch {
        // not json
      }
    }

    if (isToolPayload) {
      if (parsedMessages.length > 0 && parsedMessages[parsedMessages.length - 1].role === 'assistant') {
        const prev = parsedMessages[parsedMessages.length - 1];
        if (!prev.toolCalls) prev.toolCalls = [];

        if (synthesizedToolCall) {
          prev.toolCalls.push(synthesizedToolCall);
          continue;
        }

        const validToolOutput = rawText || m.output || (m.result && Object.keys(m.result).length > 0 ? JSON.stringify(m.result) : undefined);

        if (prev.toolCalls.length > 0) {
          const lastTool = prev.toolCalls[prev.toolCalls.length - 1];
          lastTool.output = validToolOutput;
          // If the last tool was missing arguments or targetArg, try extracting from the result
          if (!lastTool.args && synthesizedToolCall?.args) {
            lastTool.args = synthesizedToolCall.args;
          }
          continue;
        } else {
          prev.toolCalls.push({
            id: m.tool_call_id || `tc-${idx}`,
            name: synthesizedToolCall?.name || m.name || 'tool',
            status: 'completed',
            args: synthesizedToolCall?.args || '',
            output: validToolOutput,
          });
          continue;
        }
      } else if (synthesizedToolCall) {
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
        continue;
      }
    }

    const hasContent = Boolean(rawText && rawText.trim());
    const hasThought = Boolean(thought && thought.trim());
    const hasTools = toolCalls.length > 0;

    if (rawRole === 'assistant' && !hasContent && !hasThought && !hasTools) {
      continue;
    }

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

  return parsedMessages;
}

async function loadOlderMessages(): Promise<void> {
  const sessionId = state.activeSessionId;
  if (!sessionId || state.isLoadingOlder || !gatewayClient) return;

  const currentOffset = sessionServerOffset.get(sessionId) || 0;
  state.isLoadingOlder = true;
  const startedAt = performance.now();
  const stream = document.getElementById('conversation-stream');
  const prevScrollHeight = stream ? stream.scrollHeight : 0;
  const prevScrollTop = stream ? stream.scrollTop : 0;

  try {
    const outcome = await gatewayClient.fetchSessionMessages(sessionId, {
      limit: OLDER_BATCH_PAGE_SIZE,
      offset: currentOffset,
      order: 'latest',
    });

    if (outcome.ok && outcome.messages.length > 0) {
      const batch = parseRawMessages(outcome.messages);
      sessionServerOffset.set(sessionId, currentOffset + outcome.messages.length);
      state.hasOlderMessages = outcome.messages.length >= OLDER_BATCH_PAGE_SIZE;
      state.messages = [...batch, ...state.messages];
      render();

      requestAnimationFrame(() => {
        const nextStream = document.getElementById('conversation-stream');
        if (!nextStream) {
          state.isLoadingOlder = false;
          return;
        }
        const addedHeight = nextStream.scrollHeight - prevScrollHeight;
        nextStream.scrollTop = prevScrollTop + addedHeight;

        requestAnimationFrame(() => {
          const settled = document.getElementById('conversation-stream');
          if (settled) {
            const settledAdded = settled.scrollHeight - prevScrollHeight;
            const drift = settledAdded - addedHeight;
            if (Math.abs(drift) >= 1) settled.scrollTop += drift;
          }
          state.isLoadingOlder = false;

          logScroll.debug('older batch prepended via REST pagination', {
            batch: batch.length,
            totalLoaded: state.messages.length,
            ms: Math.round((performance.now() - startedAt) * 10) / 10,
          });
        });
      });
      return;
    }
  } catch (err) {
    console.warn('[Flux] loadOlderMessages failed:', err);
  }

  state.hasOlderMessages = false;
  state.isLoadingOlder = false;
  render();
}

async function loadMessages(sessionId: string): Promise<void> {
  if (!sessionId || !gatewayClient) {
    state.messages = [];
    state.hasOlderMessages = false;
    render();
    return;
  }

  const loadStartedAt = performance.now();
  state.activeSessionId = sessionId;

  // 1. Instant Cache Hit (0ms)
  const cached = sessionMessagesCache.get(sessionId);
  if (cached && cached.length > 0) {
    state.messages = [...cached];
    state.hasOlderMessages = (sessionServerOffset.get(sessionId) || 0) >= INITIAL_WINDOW_PAGE_SIZE;
    pendingScrollToBottom = true;
    render();
    scrollStreamToBottom('cache hit');
    logSession.debug('session rendered from cache', {
      sessionId,
      mounted: state.messages.length,
      ms: Math.round((performance.now() - loadStartedAt) * 10) / 10,
    });
  } else {
    // Session has no cache: clear messages immediately so old session's messages don't persist
    state.messages = [];
    state.hasOlderMessages = false;
    render();
  }

  // 2. If this session is currently actively streaming, DO NOT overwrite with stale REST history!
  if (activeStreamingStoredSessionId === sessionId) {
    logSession.info('session is actively streaming, preserving live state', { sessionId });
    return;
  }

  // 3. High-speed REST pagination: 50 items latest-first (<50ms vs 6500ms WS dump)
  let fastLoaded = false;
  try {
    const outcome = await gatewayClient.fetchSessionMessages(sessionId, {
      limit: INITIAL_WINDOW_PAGE_SIZE,
      order: 'latest',
    });

    if (outcome.ok && outcome.messages.length > 0) {
      const parsed = parseRawMessages(outcome.messages);
      sessionMessagesCache.set(sessionId, parsed);
      sessionServerOffset.set(sessionId, outcome.pagination?.returned || outcome.messages.length);
      state.messages = parsed;
      state.hasOlderMessages = Boolean(outcome.pagination && outcome.pagination.returned >= INITIAL_WINDOW_PAGE_SIZE);
      state.dockNotice = '';
      pendingScrollToBottom = true;
      render();
      scrollStreamToBottom('fast rest loaded');
      fastLoaded = true;

      logSession.info('session loaded via high-speed REST', {
        sessionId,
        returned: outcome.messages.length,
        mounted: parsed.length,
        ms: Math.round((performance.now() - loadStartedAt) * 10) / 10,
      });
    }
  } catch (err) {
    logSession.debug('fast REST load failed, falling back to session.resume', { err });
  }

  // 3. Background asynchronous session.resume for live session activation & handle resolution
  const resumePromise = (async () => {
    const rpcStartedAt = performance.now();
    try {
      let res: any;
      try {
        res = await gatewayClient.call<any>('session.resume', {
          session_id: sessionId,
          profile: state.profileName || 'default',
        });
      } catch (firstErr: any) {
        const firstMsg = describeRpcError(firstErr);
        if (firstMsg.includes('Extra inputs')) {
          res = await gatewayClient.call<any>('session.resume', { session_id: sessionId });
        } else {
          throw firstErr;
        }
      }

      const handles = readSessionHandles(res, sessionId);
      if (handles) {
        state.activeLiveSessionId = handles.liveId;
      } else {
        state.activeLiveSessionId = sessionId;
      }

      // If REST load did not succeed, fallback to mounting messages from WS result
      if (!fastLoaded) {
        const list = Array.isArray(res?.messages) ? res.messages : Array.isArray(res?.history) ? res.history : [];
        const parsed = parseRawMessages(list);
        sessionMessagesCache.set(sessionId, parsed);
        if (parsed.length > INITIAL_WINDOW_PAGE_SIZE) {
          state.messages = parsed.slice(-INITIAL_WINDOW_PAGE_SIZE);
          state.hasOlderMessages = true;
        } else {
          state.messages = parsed;
          state.hasOlderMessages = false;
        }
        pendingScrollToBottom = true;
        render();
        scrollStreamToBottom('ws fallback loaded');
      }

      logSession.debug('background session.resume activated', {
        sessionId,
        liveId: state.activeLiveSessionId,
        ms: Math.round((performance.now() - rpcStartedAt) * 10) / 10,
      });
    } catch (e) {
      if (!fastLoaded) {
        console.warn('[Hermes Gateway] Failed to load messages via RPC fallback:', e);
        const errText = describeRpcError(e);
        state.messages = [];
        state.dockNotice = `载入会话历史失败: ${errText}`;
        render();
      }
    }
  })();

  if (!fastLoaded) {
    await resumePromise;
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
    console.warn('[Flux] Failed to resolve live session id:', e);
  }
  return '';
}

async function createNewSession(): Promise<void> {
  if (!gatewayClient) {
    setTimedDockNotice('未连接网关，无法新建会话');
    render();
    return;
  }

  // Preserve draft for current session before creating new
  const currentInput = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
  if (state.activeSessionId && currentInput) {
    sessionDraftMap.set(state.activeSessionId, currentInput.value);
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
        console.warn('[Flux] Gateway rejected extra params on session.create, retrying minimal');
        res = await gatewayClient.call<any>('session.create', {});
      } else {
        throw firstErr;
      }
    }

    const handles = readSessionHandles(res);
    if (!handles) {
      setTimedDockNotice('网关没有返回新会话的标识，无法开始对话');
      render();
      return;
    }

    state.activeSessionId = handles.storedId;
    state.activeLiveSessionId = handles.liveId;
    state.messages = [];
    sessionMessagesCache.set(handles.storedId, []);
    state.dockNotice = '';
    state.modelMenuOpen = false;

    // Reset streaming indicators for the newly focused session
    state.isStreaming = activeStreamingStoredSessionId === handles.storedId;
    state.agentActivityStatus = isStreamingActiveForCurrentSession() ? state.agentActivityStatus : undefined;
    updateActivityPill(state.agentActivityStatus);

    // session.list does not expose a brand-new session until its first turn is
    // persisted, so the rail gets an optimistic entry right away.
    if (!state.pendingSessionIds.includes(handles.storedId)) {
      state.pendingSessionIds = [handles.storedId, ...state.pendingSessionIds];
    }
    state.sessions = upsertSession(state.sessions, toPendingSession(handles, '新任务'));

    pendingScrollToBottom = true;
    render();

    // Clear input for the new clean session
    const newInput = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
    if (newInput) {
      newInput.value = '';
      newInput.focus();
    }

    // Apply the model the user picked before the session existed.
    if (state.selectedModel) {
      await applyModelToLiveSession(state.selectedModel);
    }
  } catch (e) {
    console.error('[Hermes Gateway] Create session failed:', e);
    setTimedDockNotice(`新建会话失败: ${describeRpcError(e)}`);
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

  // Preserve draft for outgoing session
  const currentInput = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
  if (state.activeSessionId && currentInput) {
    sessionDraftMap.set(state.activeSessionId, currentInput.value);
  }

  state.activeSessionId = id;
  state.activeLiveSessionId = ''; // must be re-resolved through session.resume
  state.modelMenuOpen = false;

  // Sync isStreaming and agentActivityStatus with the target session
  state.isStreaming = activeStreamingStoredSessionId === id;
  state.agentActivityStatus = isStreamingActiveForCurrentSession() ? state.agentActivityStatus : undefined;
  updateActivityPill(state.agentActivityStatus);

  // Force reset messages snapshot to re-bind reactive DOM for streaming
  lastMessagesSnapshot = null;

  await loadMessages(id);

  // Restore draft for incoming session
  const restoredInput = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
  if (restoredInput) {
    restoredInput.value = sessionDraftMap.get(id) || '';
  }
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
  localStorage.setItem('hermes_flux_recent_models', JSON.stringify(state.recentModels));
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

async function switchReasoning(effort: AppState['reasoningLevel']): Promise<void> {
  state.reasoningLevel = effort;
  render();

  if (!gatewayClient || !state.activeSessionId) return;

  const liveId = await ensureLiveSessionId();
  if (!liveId) {
    state.dockNotice = '无法设置思考深度：当前会话没有可用的实时通道';
    render();
    return;
  }

  // Map internal UI level to gateway values
  const gatewayEffortMap: Record<string, string> = {
    default: 'default',
    none: 'off',
    off: 'off',
    low: 'low',
    medium: 'high',
    high: 'high',
    max: 'max',
  };

  try {
    await gatewayClient.call('config.set', {
      session_id: liveId,
      key: 'reasoning',
      value: gatewayEffortMap[effort] || 'default',
    });
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

function isStreamingActiveForCurrentSession(): boolean {
  return Boolean(
    activeStreamingStoredSessionId &&
    activeStreamingStoredSessionId === state.activeSessionId &&
    state.isStreaming
  );
}

function setTimedDockNotice(msg: string, durationMs = 4000): void {
  state.dockNotice = msg;
  if (dockNoticeDismissTimer) {
    clearTimeout(dockNoticeDismissTimer);
    dockNoticeDismissTimer = null;
  }
  if (msg && durationMs > 0) {
    dockNoticeDismissTimer = setTimeout(() => {
      dockNoticeDismissTimer = null;
      if (state.dockNotice === msg) {
        state.dockNotice = '';
        render();
      }
    }, durationMs);
  }
}

/** Asks the gateway to stop the running turn (the composer turns into a stop button). */
async function interruptTurn(): Promise<void> {
  const targetLiveId = activeStreamingLiveId || state.activeLiveSessionId;
  const targetStoredId = activeStreamingStoredSessionId || state.activeSessionId;

  // 1. Immediately force client-side cancellation & flush
  tokenCoalescer.flush();
  disarmTurnWatchdog();

  const isCurrent = activeStreamingStoredSessionId === state.activeSessionId;
  if (isCurrent && activeStreamingMessageId) {
    const target = state.messages.find((m) => m.id === activeStreamingMessageId);
    if (target) {
      if (!target.content) {
        target.content = '*(已中断本轮生成)*';
      } else {
        target.content += ' *(已中断)*';
      }
      setMessageContent(activeStreamingMessageId, target.content);
    }
  } else if (targetStoredId && activeStreamingMessageId) {
    const cached = sessionMessagesCache.get(targetStoredId);
    const target = cached?.find((m) => m.id === activeStreamingMessageId);
    if (target) {
      target.content = target.content ? target.content + ' *(已中断)*' : '*(已中断本轮生成)*';
    }
  }

  state.isStreaming = false;
  state.agentActivityStatus = undefined;
  updateActivityPill(undefined);
  activeStreamingMessageId = null;
  activeStreamingStoredSessionId = null;
  activeStreamingLiveId = null;

  setTimedDockNotice('本轮生成已中断');
  render();

  // 2. Notify remote gateway
  if (gatewayClient && targetLiveId) {
    try {
      await gatewayClient.call('session.interrupt', { session_id: targetLiveId });
    } catch (e) {
      console.warn('[Hermes Gateway] Remote interrupt notification ignored:', e);
    }
  }
}

async function sendMessage(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  if (!gatewayClient) {
    setTimedDockNotice('未连接网关，无法发送消息');
    render();
    return;
  }

  // A latched busy flag used to swallow every later message without feedback.
  if (state.isStreaming) {
    setTimedDockNotice('当前回合仍在生成中，请等待完成或稍后重试');
    render();
    return;
  }

  if (!state.activeSessionId) {
    await createNewSession();
  }

  const liveId = await ensureLiveSessionId();
  if (!liveId) {
    setTimedDockNotice('当前会话没有可用的实时通道，请重新选择会话后再发送');
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
  activeStreamingStoredSessionId = state.activeSessionId;
  activeStreamingLiveId = liveId;

  const assistantMsg: MessageViewModel = {
    id: assistantMsgId,
    role: 'assistant',
    content: '',
    thought: '',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
  state.messages.push(assistantMsg);

  // Sync session cache
  sessionMessagesCache.set(state.activeSessionId, [...state.messages]);

  state.isStreaming = true;
  state.agentActivityStatus = 'thinking';
  tokenCoalescer.clear();
  armTurnWatchdog();
  pendingScrollToBottom = true;
  render();
  updateActivityPill('thinking');
  scrollStreamToBottom('message sent');
  logStream.info('turn started', { session: state.activeLiveSessionId, chars: trimmed.length });

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
      state.agentActivityStatus = undefined;
      updateActivityPill(undefined);
      activeStreamingMessageId = null;
      activeStreamingStoredSessionId = null;
      activeStreamingLiveId = null;
      disarmTurnWatchdog();
      render();
    }
  } catch (err) {
    console.error('[Hermes Gateway] prompt.submit failed:', err);
    assistantMsg.content = `[提交失败] ${describeRpcError(err)}`;
    state.isStreaming = false;
    state.agentActivityStatus = undefined;
    updateActivityPill(undefined);
    activeStreamingMessageId = null;
    activeStreamingStoredSessionId = null;
    activeStreamingLiveId = null;
    disarmTurnWatchdog();
    render();
  }
}

function formatTimestamp(ts: number | string): string {
  if (typeof ts === 'string') return ts;
  const d = new Date(ts > 1e11 ? ts : ts * 1000);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}

function updateActivityPill(statusText?: string): void {
  const container = document.querySelector('.input-dock-container');
  if (!container) return;
  const existingPill = container.querySelector('.agent-activity-pill') as HTMLElement | null;

  // Only display pill if the focused session is the active streaming session
  const shouldShow = Boolean(statusText && isStreamingActiveForCurrentSession());

  if (!shouldShow) {
    if (existingPill) existingPill.remove();
    return;
  }

  const selectedDetail = state.modelDetails?.find((m) => m.id === state.selectedModel);
  const modelLabel = selectedDetail ? selectedDetail.displayName || selectedDetail.name : state.selectedModel || 'Hermes Agent';

  if (existingPill) {
    const textSpan = existingPill.querySelector('span:last-child');
    if (textSpan) textSpan.textContent = statusText || '';
  } else {
    const pillHtml = `
      <div class="agent-activity-pill" style="
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: var(--bg-backdrop);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid var(--border-medium);
        border-radius: 9999px;
        padding: 3px 12px;
        font-size: 11px;
        color: var(--text-main);
        margin-bottom: 8px;
        pointer-events: auto;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25), var(--specular-line);
        user-select: none;
        animation: flux-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      ">
        <span class="activity-status-dot" style="
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #10B981;
          box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
          display: inline-block;
          animation: flux-pulse 2s infinite ease-in-out;
        "></span>
        <span style="font-weight: 500; letter-spacing: -0.01em;">${escapeHtml(modelLabel)}</span>
        <span style="color: var(--text-muted); opacity: 0.5;">·</span>
        <span style="color: var(--text-secondary); font-family: var(--font-mono, monospace); font-size: 10.5px;">${escapeHtml(statusText || '')}</span>
      </div>
    `;
    container.insertAdjacentHTML('afterbegin', pillHtml);
  }
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
    // 关键规则：必须显式锁定 flexDirection = 'column'，严禁 flex 默认的 row 布局将多个 Markdown 段落横向排成多列
    if (el.style.flexDirection !== 'column') {
      el.style.flexDirection = 'column';
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
        state.agentActivityStatus = 'thinking';
        updateActivityPill('thinking');
        armTurnWatchdog();
        break;

      case 'append-content':
        if (state.agentActivityStatus !== 'writing response') {
          state.agentActivityStatus = 'writing response';
          updateActivityPill('writing response');
        }
        tokenCoalescer.push({ messageId: action.messageId, delta: action.text, isThought: false });
        break;

      case 'append-thought':
        if (state.agentActivityStatus !== 'thinking') {
          state.agentActivityStatus = 'thinking';
          updateActivityPill('thinking');
        }
        tokenCoalescer.push({ messageId: action.messageId, delta: action.text, isThought: true });
        break;

      case 'tool-start': {
        const rawName = String(action.toolCall.name || '').toLowerCase();
        let status = 'executing tool';
        if (rawName.includes('read') || rawName.includes('file')) status = 'reading a file';
        else if (rawName.includes('shell') || rawName.includes('bash') || rawName.includes('cmd') || rawName.includes('terminal')) status = 'running command';
        else if (rawName.includes('edit') || rawName.includes('patch') || rawName.includes('write')) status = 'editing a file';
        else if (rawName.includes('grep') || rawName.includes('search') || rawName.includes('find') || rawName.includes('glob')) status = 'searching files';
        state.agentActivityStatus = status;
        updateActivityPill(status);

        const now = Date.now();
        const target = state.messages.find((m) => m.id === action.messageId);
        if (target) {
          if (!target.toolCalls) target.toolCalls = [];
          target.toolCalls.push({
            id: action.toolCall.id,
            name: action.toolCall.name,
            status: 'running',
            args: action.toolCall.args,
            startTime: now,
          });
          needsRender = true;
        }
        // Also update background cache if not focused
        if (activeStreamingStoredSessionId) {
          const cached = sessionMessagesCache.get(activeStreamingStoredSessionId);
          const cachedTarget = cached?.find((m) => m.id === action.messageId);
          if (cachedTarget) {
            if (!cachedTarget.toolCalls) cachedTarget.toolCalls = [];
            if (!cachedTarget.toolCalls.some((t) => t.id === action.toolCall.id)) {
              cachedTarget.toolCalls.push({
                id: action.toolCall.id,
                name: action.toolCall.name,
                status: 'running',
                args: action.toolCall.args,
                startTime: now,
              });
            }
          }
        }
        break;
      }

      case 'tool-complete': {
        state.agentActivityStatus = 'thinking';
        updateActivityPill('thinking');

        const now = Date.now();
        const updateTc = (target?: MessageViewModel) => {
          if (target && target.toolCalls) {
            const tc = target.toolCalls.find((t) => !action.toolCallId || t.id === action.toolCallId);
            if (tc) {
              tc.status = 'completed';
              if (action.output) tc.output = action.output;
              if (tc.startTime) tc.durationMs = Math.max(100, now - tc.startTime);
            }
          }
        };

        const target = state.messages.find((m) => m.id === action.messageId);
        if (target) {
          updateTc(target);
          needsRender = true;
        }
        if (activeStreamingStoredSessionId) {
          const cached = sessionMessagesCache.get(activeStreamingStoredSessionId);
          updateTc(cached?.find((m) => m.id === action.messageId));
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
        if (finalReplace) {
          const replacement = finalReplace;
          setMessageContent(replacement.messageId, replacement.text);
          // Sync cache if completed in background
          if (activeStreamingStoredSessionId) {
            const cached = sessionMessagesCache.get(activeStreamingStoredSessionId);
            const target = cached?.find((m) => m.id === replacement.messageId);
            if (target) target.content = replacement.text;
          }
        }
        state.isStreaming = false;
        state.agentActivityStatus = undefined;
        updateActivityPill(undefined);
        activeStreamingMessageId = null;
        activeStreamingStoredSessionId = null;
        activeStreamingLiveId = null;
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
        state.agentActivityStatus = undefined;
        updateActivityPill(undefined);
        activeStreamingMessageId = null;
        activeStreamingStoredSessionId = null;
        activeStreamingLiveId = null;
        setTimedDockNotice(action.message);
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
    localStorage.setItem('hermes_flux_gateway_url', state.gatewayUrl);
    localStorage.setItem('hermes_flux_username', state.username);
    localStorage.setItem('hermes_flux_password', state.password);
    localStorage.setItem('hermes_flux_profile', state.profileName);
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
      const activeIds = [
        state.activeLiveSessionId,
        state.activeSessionId,
        activeStreamingLiveId,
        activeStreamingStoredSessionId,
      ].filter((id): id is string => Boolean(id));

      const actions = reduceGatewayEvent(params, {
        activeSessionIds: Array.from(new Set(activeIds)),
        activeStreamingMessageId,
      });
      if (actions.length > 0) applyTurnActions(actions);

      handleInspectorEvent(params);
    });

    // Subscribe to FSM transitions (CONNECTING, CONNECTED, DISCONNECTED)
    gatewayClient.getFsm().onStateChange((fsmState) => {
      const isConnected = fsmState === 'CONNECTED' || fsmState === 'HANDSHAKING';
      const isConnecting = fsmState === 'CONNECTING';

      if (state.gatewayConnected !== isConnected || state.gatewayConnecting !== isConnecting) {
        state.gatewayConnected = isConnected;
        state.gatewayConnecting = isConnecting;
        render();

        if (isConnected) {
          Promise.allSettled([fetchSessions(), fetchModelOptions(), fetchProfiles()]);
        }
      }
    });

    // Initial check
    if (gatewayClient.getState() === 'CONNECTED') {
      state.gatewayConnected = true;
      state.gatewayConnecting = false;
      render();
      Promise.allSettled([fetchSessions(), fetchModelOptions(), fetchProfiles()]);
    }
  } catch (err: any) {
    console.error('[Flux Connect] Connection failed:', err);
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
  activeStreamingMessageId = null;
  activeStreamingStoredSessionId = null;
  activeStreamingLiveId = null;
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

interface StreamAnchor {
  sessionId: string;
  id: string | null;
  offset: number;
  rawScrollTop: number;
}

function captureStreamAnchor(): StreamAnchor {
  const stream = document.getElementById('conversation-stream');
  if (!stream) return { sessionId: state.activeSessionId, id: null, offset: 0, rawScrollTop: 0 };
  const streamTop = stream.getBoundingClientRect().top;
  const rows = stream.querySelectorAll<HTMLElement>('[data-msg-id]');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rect = row.getBoundingClientRect();
    if (rect.bottom > streamTop) {
      return { sessionId: state.activeSessionId, id: row.getAttribute('data-msg-id'), offset: rect.top - streamTop, rawScrollTop: stream.scrollTop };
    }
  }
  return { sessionId: state.activeSessionId, id: null, offset: 0, rawScrollTop: stream.scrollTop };
}

function applyStreamAnchor(anchor: StreamAnchor, pinBottom: boolean): void {
  const stream = document.getElementById('conversation-stream');
  if (!stream) return;

  // Follow mode (a deliberate jump, or the reader was already at the bottom)
  // wins over position preservation. Without this a background re-render during
  // streaming restores the old scrollTop while the rows keep growing, and the
  // next token flush snaps back down — the "bouncing" conversation.
  if (pinBottom) {
    stream.scrollTop = stream.scrollHeight;
    logScroll.trace('pinned after render', { session: state.activeSessionId });
    return;
  }

  // If we switched to a different session, don't inherit old session scroll offset!
  if (anchor.sessionId !== state.activeSessionId) {
    stream.scrollTop = stream.scrollHeight;
    return;
  }

  if (anchor.id) {
    const target = stream.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(anchor.id)}"]`);
    if (target) {
      const streamTop = stream.getBoundingClientRect().top;
      const currentOffset = target.getBoundingClientRect().top - streamTop;
      const delta = currentOffset - anchor.offset;
      if (Math.abs(delta) >= 1) {
        stream.scrollTop += delta;
        logScroll.trace('anchor corrected', { id: anchor.id, delta: Math.round(delta) });
      }
      return;
    }
  }
  stream.scrollTop = anchor.rawScrollTop;
}

/**
 * After a full re-render the anchor is applied synchronously; late layout work
 * (web fonts, images, wrapped rows) can still move the pinned row a frame
 * later. Re-measure once and absorb the residual drift.
 */
function stabilizeStreamAnchor(anchor: StreamAnchor): void {
  if (!anchor.id) return;
  const stream = document.getElementById('conversation-stream');
  if (!stream) return;
  const target = stream.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(anchor.id)}"]`);
  if (!target) return;

  const streamTop = stream.getBoundingClientRect().top;
  const drift = (target.getBoundingClientRect().top - streamTop) - anchor.offset;
  if (Math.abs(drift) >= 1) {
    stream.scrollTop += drift;
    logScroll.debug('post-layout anchor drift absorbed', { id: anchor.id, drift: Math.round(drift) });
  }
}

interface RenderMessagesSnapshot {
  sessionId: string;
  count: number;
  lastMsgId: string;
  lastContentLen: number;
  isStreaming: boolean;
  gatewayConnected: boolean;
  gatewayConnecting: boolean;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  profileName: string;
}

let lastMessagesSnapshot: RenderMessagesSnapshot | null = null;

function renderContextMenuHtml(ctx?: AppState['sessionContextMenu']): string {
  if (!ctx) return '';
  return `
    <div id="session-context-menu" style="
      position: fixed;
      left: ${ctx.x}px;
      top: ${ctx.y}px;
      background: var(--bg-card);
      border: 1px solid var(--border-strong);
      border-radius: 9px;
      box-shadow: var(--shadow-window);
      padding: 4px;
      min-width: 160px;
      z-index: 2000;
      display: flex;
      flex-direction: column;
      gap: 1px;
      font-size: 12px;
      user-select: none;
      backdrop-filter: blur(20px);
      animation: flux-fade-in 0.15s cubic-bezier(0.16, 1, 0.3, 1);
    ">
      <button type="button" class="ctx-item" data-action="rename" style="padding: 6px 9px; border-radius: 6px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 9px; cursor: pointer; text-align: left; font-size: 12px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); flex-shrink: 0;"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
        <span>重命名</span>
      </button>
      <button type="button" class="ctx-item" data-action="copy-id" style="padding: 6px 9px; border-radius: 6px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 9px; cursor: pointer; text-align: left; font-size: 12px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); flex-shrink: 0;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        <span>复制会话 ID</span>
      </button>
      <button type="button" class="ctx-item" data-action="pin" style="padding: 6px 9px; border-radius: 6px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 9px; cursor: pointer; text-align: left; font-size: 12px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); flex-shrink: 0;"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>
        <span>置顶会话</span>
      </button>
      <button type="button" class="ctx-item" data-action="export" style="padding: 6px 9px; border-radius: 6px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 9px; cursor: pointer; text-align: left; font-size: 12px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); flex-shrink: 0;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <span>导出 Markdown</span>
      </button>
      <div style="height: 1px; background: var(--border-subtle); margin: 3px 0;"></div>
      <button type="button" class="ctx-item" data-action="archive" style="padding: 6px 9px; border-radius: 6px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 9px; cursor: pointer; text-align: left; font-size: 12px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); flex-shrink: 0;"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
        <span>归档</span>
      </button>
      <button type="button" class="ctx-item" data-action="delete" style="padding: 6px 9px; border-radius: 6px; border: none; background: transparent; color: #EF4444; display: flex; align-items: center; gap: 9px; cursor: pointer; text-align: left; font-size: 12px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #EF4444; flex-shrink: 0;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        <span>删除</span>
      </button>
    </div>
  `;
}

function render(): void {
  const root = document.getElementById('flux-app-root');
  if (!root) return;

  const renderStartedAt = performance.now();

  const existingInput = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
  const draftText = existingInput ? existingInput.value : '';
  const inputHadFocus = Boolean(existingInput) && document.activeElement === existingInput;
  const caretStart = existingInput?.selectionStart ?? draftText.length;
  const caretEnd = existingInput?.selectionEnd ?? draftText.length;

  const forcedBottom = pendingScrollToBottom;
  pendingScrollToBottom = false;
  const streamEl = document.getElementById('conversation-stream');
  const wasNearBottom = isStreamNearBottom(streamEl);
  const pinBottom = forcedBottom || wasNearBottom;
  const streamAnchor = captureStreamAnchor();

  document.documentElement.setAttribute('data-theme', state.theme);
  document.documentElement.dataset.maximized = state.isMaximized ? 'true' : 'false';

  const activeSession = state.sessions.find((s) => s.id === state.activeSessionId);
  const currentTitle = activeSession ? activeSession.title : (state.gatewayConnected ? 'Hermes Flux — 请选择或新建会话' : '未连接网关');

  const currentLastMsg = state.messages.length > 0 ? state.messages[state.messages.length - 1] : null;
  const currentMessagesSnapshot: RenderMessagesSnapshot = {
    sessionId: state.activeSessionId,
    count: state.messages.length,
    lastMsgId: currentLastMsg ? currentLastMsg.id : '',
    lastContentLen: currentLastMsg ? (currentLastMsg.content?.length || 0) : 0,
    isStreaming: state.isStreaming,
    gatewayConnected: state.gatewayConnected,
    gatewayConnecting: state.gatewayConnecting,
    hasOlder: state.hasOlderMessages,
    isLoadingOlder: state.isLoadingOlder,
    profileName: state.profileName,
  };

  const inOngoingStreamingTurn =
    state.isStreaming &&
    lastMessagesSnapshot?.isStreaming &&
    lastMessagesSnapshot.sessionId === currentMessagesSnapshot.sessionId &&
    lastMessagesSnapshot.count === currentMessagesSnapshot.count;

  const messagesChanged =
    !inOngoingStreamingTurn &&
    (!lastMessagesSnapshot ||
      lastMessagesSnapshot.sessionId !== currentMessagesSnapshot.sessionId ||
      lastMessagesSnapshot.count !== currentMessagesSnapshot.count ||
      lastMessagesSnapshot.lastMsgId !== currentMessagesSnapshot.lastMsgId ||
      lastMessagesSnapshot.isStreaming !== currentMessagesSnapshot.isStreaming ||
      lastMessagesSnapshot.gatewayConnected !== currentMessagesSnapshot.gatewayConnected ||
      lastMessagesSnapshot.gatewayConnecting !== currentMessagesSnapshot.gatewayConnecting ||
      lastMessagesSnapshot.hasOlder !== currentMessagesSnapshot.hasOlder ||
      lastMessagesSnapshot.isLoadingOlder !== currentMessagesSnapshot.isLoadingOlder ||
      lastMessagesSnapshot.profileName !== currentMessagesSnapshot.profileName);

  const bodyContainer = root.querySelector('.flux-body-container');

  if (!bodyContainer) {
    // 1. Initial full skeleton mount
    const html = `
      ${renderTitlebar({
        platform: state.platform,
        title: currentTitle,
        isMaximized: state.isMaximized,
        gatewayConnected: state.gatewayConnected,
        profileName: state.profileName,
        profiles: state.profiles,
      })}

      <div class="flux-body-container" style="flex: 1; display: flex; position: relative; overflow: hidden; width: 100%;">
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

        ${renderMiddlePod({
          gatewayConnected: state.gatewayConnected,
          gatewayConnecting: state.gatewayConnecting,
          gatewayUrl: state.gatewayUrl,
          username: state.username,
          password: state.password,
          profileName: state.profileName,
          messages: state.messages,
          testStatus: state.testStatus,
          hasOlderMessages: state.hasOlderMessages,
          isLoadingOlder: state.isLoadingOlder,
          dockHtml: state.gatewayConnected
            ? renderInputDock({
                selectedModel: state.selectedModel,
                models: state.availableModels,
                modelDetails: state.modelDetails,
                favoriteModels: state.favoriteModels,
                recentModels: state.recentModels,
                modelSearchQuery: state.modelSearchQuery,
                reasoningLevel: state.reasoningLevel,
                approvalMode: state.approvalMode,
                isStreaming: isStreamingActiveForCurrentSession(),
                disabled: !state.gatewayConnected,
                modelMenuOpen: state.modelMenuOpen,
                notice: state.dockNotice,
                activityStatus: isStreamingActiveForCurrentSession() ? state.agentActivityStatus : undefined,
              })
            : '',
        })}

        ${renderInspectionPod({
          collapsed: state.inspectorCollapsed,
          activeTab: state.activeInspectorTab,
          gatewayConnected: state.gatewayConnected,
          isFullscreen: state.inspectorFullscreen,
          openFiles: state.openFiles,
          activeFilePath: state.activeFilePath,
          viewMode: state.fileViewMode,
          showLineNumbers: state.fileShowLineNumbers,
          wordWrap: state.fileWordWrap,
          searchOpen: state.fileSearchOpen,
          searchQuery: state.fileSearchQuery,
          artifacts: state.artifacts,
          browserFrame: state.browserFrame,
          gitDiffs: state.gitDiffs,
          memories: state.memories,
        })}
      </div>

      ${renderStatusBar({
        connectionStatus: state.gatewayConnected ? 'connected' : state.gatewayConnecting ? 'connecting' : 'disconnected',
        latencyMs: state.gatewayLatencyMs,
      })}

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

      ${renderContextMenuHtml(state.sessionContextMenu)}
    `;

    root.innerHTML = html;
    lastMessagesSnapshot = currentMessagesSnapshot;
    applyStreamAnchor(streamAnchor, pinBottom);
  } else {
    // 2. High-performance Subtree/Section Isolation Update (Zero DOM thrashing on conversation stream)
    const titlebarEl = root.querySelector('.flux-titlebar');
    if (titlebarEl) {
      titlebarEl.outerHTML = renderTitlebar({
        platform: state.platform,
        title: currentTitle,
        isMaximized: state.isMaximized,
        gatewayConnected: state.gatewayConnected,
        profileName: state.profileName,
        profiles: state.profiles,
      });
    }

    const railEl = root.querySelector('#flux-left-rail') || root.querySelector('.flux-left-rail');
    if (railEl) {
      railEl.outerHTML = renderLeftRail({
        collapsed: state.leftRailCollapsed,
        activeSessionId: state.activeSessionId,
        sessions: state.sessions,
        profileName: state.profileName,
        profiles: state.profiles,
        gatewayOnline: state.gatewayConnected,
        gatewayLatencyMs: state.gatewayLatencyMs,
        error: state.sessionListError,
      });
    }

    const inspectEl = root.querySelector('#flux-inspector-pod') || root.querySelector('.flux-inspector-pod');
    if (inspectEl) {
      inspectEl.outerHTML = renderInspectionPod({
        collapsed: state.inspectorCollapsed,
        activeTab: state.activeInspectorTab,
        gatewayConnected: state.gatewayConnected,
        isFullscreen: state.inspectorFullscreen,
        openFiles: state.openFiles,
        activeFilePath: state.activeFilePath,
        viewMode: state.fileViewMode,
        showLineNumbers: state.fileShowLineNumbers,
        wordWrap: state.fileWordWrap,
        searchOpen: state.fileSearchOpen,
        searchQuery: state.fileSearchQuery,
        artifacts: state.artifacts,
        browserFrame: state.browserFrame,
        gitDiffs: state.gitDiffs,
        memories: state.memories,
      });
    }

    const statusEl = root.querySelector('.flux-status-bar');
    if (statusEl) {
      statusEl.outerHTML = renderStatusBar({
        connectionStatus: state.gatewayConnected ? 'connected' : state.gatewayConnecting ? 'connecting' : 'disconnected',
        latencyMs: state.gatewayLatencyMs,
      });
    }

    // Input Dock update
    const existingDock = root.querySelector('.input-dock-container');
    const nextDockHtml = state.gatewayConnected
      ? renderInputDock({
          selectedModel: state.selectedModel,
          models: state.availableModels,
          modelDetails: state.modelDetails,
          favoriteModels: state.favoriteModels,
          recentModels: state.recentModels,
          modelSearchQuery: state.modelSearchQuery,
          reasoningLevel: state.reasoningLevel,
          approvalMode: state.approvalMode,
          isStreaming: isStreamingActiveForCurrentSession(),
          disabled: !state.gatewayConnected,
          modelMenuOpen: state.modelMenuOpen,
          notice: state.dockNotice,
          activityStatus: isStreamingActiveForCurrentSession() ? state.agentActivityStatus : undefined,
        })
      : '';
    if (existingDock) {
      if (nextDockHtml) {
        existingDock.outerHTML = nextDockHtml;
      } else {
        existingDock.remove();
      }
    } else if (nextDockHtml) {
      const middlePod = root.querySelector('.flux-middle-pod');
      if (middlePod) middlePod.insertAdjacentHTML('beforeend', nextDockHtml);
    }

    // Settings Modal
    const modalRoot = document.getElementById('flux-settings-modal-root');
    const nextModalHtml = renderSettingsModal({
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
    });
    if (modalRoot) {
      modalRoot.outerHTML = nextModalHtml;
    } else {
      root.insertAdjacentHTML('beforeend', nextModalHtml);
    }

    // Context Menu
    const existingMenu = document.getElementById('session-context-menu');
    const nextMenuHtml = renderContextMenuHtml(state.sessionContextMenu);
    if (existingMenu) {
      if (nextMenuHtml) existingMenu.outerHTML = nextMenuHtml;
      else existingMenu.remove();
    } else if (nextMenuHtml) {
      root.insertAdjacentHTML('beforeend', nextMenuHtml);
    }

    // Conversation Stream: ONLY update if messages or connection state genuinely changed!
    const activeStream = document.getElementById('conversation-stream');
    if (activeStream && messagesChanged) {
      activeStream.innerHTML = renderConversationCanvas({
        gatewayConnected: state.gatewayConnected,
        gatewayConnecting: state.gatewayConnecting,
        gatewayUrl: state.gatewayUrl,
        username: state.username,
        password: state.password,
        profileName: state.profileName,
        messages: state.messages,
        testStatus: state.testStatus,
        hasOlderMessages: state.hasOlderMessages,
        isLoadingOlder: state.isLoadingOlder,
      });
      applyStreamAnchor(streamAnchor, pinBottom);
      lastMessagesSnapshot = currentMessagesSnapshot;
    }
  }

  // Restore the composer draft, its caret and its focus
  const newInput = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
  if (newInput) {
    if (draftText && newInput.value !== draftText) newInput.value = draftText;
    if (inputHadFocus) {
      newInput.focus({ preventScroll: true });
      const max = newInput.value.length;
      newInput.setSelectionRange(Math.min(caretStart, max), Math.min(caretEnd, max));
    }
  }

  bindEvents();

  if (messagesChanged) {
    requestAnimationFrame(() => {
      if (pinBottom) {
        const stream = document.getElementById('conversation-stream');
        if (stream) stream.scrollTop = stream.scrollHeight;
      } else {
        stabilizeStreamAnchor(streamAnchor);
      }
    });
  }

  logRender.debug('render', {
    ms: Math.round((performance.now() - renderStartedAt) * 10) / 10,
    messages: state.messages.length,
    messagesChanged,
    session: state.activeSessionId || '(none)',
    forcedBottom,
    pinBottom,
    anchor: streamAnchor.id,
  });
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
  const toggleInspectorClose = document.getElementById('toggle-inspector-close-btn');
  const toggleInspectorFullscreen = document.getElementById('toggle-inspector-fullscreen-btn');
  if (toggleInspector) {
    toggleInspector.onclick = () => {
      state.inspectorCollapsed = !state.inspectorCollapsed;
      render();
    };
  }
  if (toggleInspectorClose) {
    toggleInspectorClose.onclick = () => {
      state.inspectorCollapsed = true;
      state.inspectorFullscreen = false;
      render();
    };
  }
  if (toggleInspectorFullscreen) {
    toggleInspectorFullscreen.onclick = () => {
      state.inspectorFullscreen = !state.inspectorFullscreen;
      render();
    };
  }

  // --- OpenChamber Style Inspector Tabs & Toolbar Event Bindings ---
  // 1. File Tab Switch
  document.querySelectorAll<HTMLElement>('.inspector-file-tab').forEach((tabEl) => {
    tabEl.onclick = (e) => {
      // Ignore if clicking close button
      if ((e.target as HTMLElement).closest('.btn-close-file-tab')) return;
      const targetPath = tabEl.dataset.fileTab;
      if (targetPath && targetPath !== state.activeFilePath) {
        state.activeFilePath = targetPath;
        render();
      }
    };
  });

  // 2. File Tab Close
  document.querySelectorAll<HTMLElement>('.btn-close-file-tab').forEach((btnEl) => {
    btnEl.onclick = (e) => {
      e.stopPropagation();
      const targetPath = btnEl.dataset.closeTab;
      if (!targetPath) return;

      const idx = state.openFiles.findIndex((f) => f.path === targetPath);
      if (idx !== -1) {
        state.openFiles.splice(idx, 1);
        // Also remove from artifacts if matching
        state.artifacts = state.artifacts.filter((a) => a.name !== targetPath);
        if (state.activeFilePath === targetPath) {
          state.activeFilePath = state.openFiles[0]?.path || '';
        }
        if (state.openFiles.length === 0) {
          state.inspectorCollapsed = true;
          state.inspectorFullscreen = false;
        }
        render();
      }
    };
  });

  // 3. Toolbar: View Mode Toggle (Raw Code vs Rich Rendered)
  const btnToggleMode = document.getElementById('btn-file-toggle-mode');
  if (btnToggleMode) {
    btnToggleMode.onclick = () => {
      state.fileViewMode = state.fileViewMode === 'rendered' ? 'raw' : 'rendered';
      render();
    };
  }

  // 4. Toolbar: Search Toggle
  const btnSearch = document.getElementById('btn-file-search');
  if (btnSearch) {
    btnSearch.onclick = () => {
      state.fileSearchOpen = !state.fileSearchOpen;
      if (!state.fileSearchOpen) {
        state.fileSearchQuery = '';
      }
      render();
      if (state.fileSearchOpen) {
        setTimeout(() => {
          document.getElementById('inspector-search-input')?.focus();
        }, 50);
      }
    };
  }

  const btnCloseSearch = document.getElementById('btn-close-search');
  if (btnCloseSearch) {
    btnCloseSearch.onclick = () => {
      state.fileSearchOpen = false;
      state.fileSearchQuery = '';
      render();
    };
  }

  const inspectorSearchInput = document.getElementById('inspector-search-input') as HTMLInputElement | null;
  if (inspectorSearchInput) {
    inspectorSearchInput.oninput = () => {
      state.fileSearchQuery = inspectorSearchInput.value;
      render();
      // Keep focus on input after render
      const freshInput = document.getElementById('inspector-search-input') as HTMLInputElement | null;
      if (freshInput) {
        freshInput.focus();
        freshInput.selectionStart = freshInput.selectionEnd = freshInput.value.length;
      }
    };
  }

  // 5. Toolbar: Line Numbers Toggle
  const btnToggleLineNo = document.getElementById('btn-file-toggle-lineno');
  if (btnToggleLineNo) {
    btnToggleLineNo.onclick = () => {
      state.fileShowLineNumbers = !state.fileShowLineNumbers;
      render();
    };
  }

  // 6. Toolbar: Open Externally (System Default Viewer/Editor)
  const btnOpenExternal = document.getElementById('btn-file-open-external');
  if (btnOpenExternal) {
    btnOpenExternal.onclick = () => {
      const activeFile = state.openFiles.find((f) => f.path === state.activeFilePath) || state.openFiles[0];
      if (activeFile) {
        if (desktopApi?.openExternal) {
          void desktopApi.openExternal(activeFile.path);
        } else {
          void navigator.clipboard.writeText(activeFile.path);
        }
      }
    };
  }

  // 7. Toolbar: Copy Full Content (Silent Clipboard Copy, no dockNotice pollution)
  const btnCopyContent = document.getElementById('btn-file-copy-content');
  if (btnCopyContent) {
    btnCopyContent.onclick = () => {
      const activeFile = state.openFiles.find((f) => f.path === state.activeFilePath) || state.openFiles[0];
      if (activeFile) {
        void navigator.clipboard.writeText(activeFile.content);
        // Visual button feedback instead of polluting dockNotice
        btnCopyContent.style.color = 'var(--accent)';
        setTimeout(() => {
          btnCopyContent.style.color = '';
        }, 1200);
      }
    };
  }

  // 11. Toolbar: Copy Path
  const btnCopyPath = document.getElementById('btn-file-copy-path');
  if (btnCopyPath) {
    btnCopyPath.onclick = () => {
      const activeFile = state.openFiles.find((f) => f.path === state.activeFilePath) || state.openFiles[0];
      if (activeFile) {
        void navigator.clipboard.writeText(activeFile.path);
        btnCopyPath.style.color = 'var(--accent)';
        setTimeout(() => {
          btnCopyPath.style.color = '';
        }, 1200);
      }
    };
  }

  // 12. Toolbar: Download File
  const btnDownload = document.getElementById('btn-file-download');
  if (btnDownload) {
    btnDownload.onclick = () => {
      const activeFile = state.openFiles.find((f) => f.path === state.activeFilePath) || state.openFiles[0];
      if (activeFile) {
        const blob = new Blob([activeFile.content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = activeFile.path.split(/[/\\]/).pop() || 'download.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
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
        localStorage.setItem('hermes_flux_theme', theme);
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
        localStorage.setItem('hermes_flux_gateway_url', urlInput);
        localStorage.setItem('hermes_aura_gateway_url', urlInput);
      }
      if (userInput !== undefined) {
        state.username = userInput;
        localStorage.setItem('hermes_flux_username', userInput);
        localStorage.setItem('hermes_aura_username', userInput);
      }
      if (passInput !== undefined) {
        state.password = passInput;
        localStorage.setItem('hermes_flux_password', passInput);
        localStorage.setItem('hermes_aura_password', passInput);
      }
      if (profileInput !== undefined) {
        state.profileName = profileInput || 'default';
        localStorage.setItem('hermes_flux_profile', state.profileName);
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
        localStorage.setItem('hermes_flux_gateway_url', urlInput);
        localStorage.setItem('hermes_aura_gateway_url', urlInput);
      }
      if (userInput !== undefined) {
        state.username = userInput;
        localStorage.setItem('hermes_flux_username', userInput);
        localStorage.setItem('hermes_aura_username', userInput);
      }
      if (passInput !== undefined) {
        state.password = passInput;
        localStorage.setItem('hermes_flux_password', passInput);
        localStorage.setItem('hermes_aura_password', passInput);
      }
      if (profileInput !== undefined) {
        state.profileName = profileInput || 'default';
        localStorage.setItem('hermes_flux_profile', state.profileName);
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

  // Reasoning Dropdown Toggle (对标 OpenChamber 思考下拉卡片)
  const reasoningBtn = document.getElementById('dock-reasoning-toggle-btn');
  const reasoningDropdown = document.getElementById('dock-reasoning-dropdown');
  if (reasoningBtn && reasoningDropdown) {
    reasoningBtn.onclick = (e) => {
      e.stopPropagation();
      const isOpen = reasoningDropdown.style.display === 'block';
      reasoningDropdown.style.display = isOpen ? 'none' : 'block';
    };
    document.querySelectorAll('.reasoning-option').forEach((opt) => {
      (opt as HTMLElement).onclick = (e) => {
        e.stopPropagation();
        const level = (e.currentTarget as HTMLElement).getAttribute('data-level') as AppState['reasoningLevel'];
        reasoningDropdown.style.display = 'none';
        if (level) void switchReasoning(level);
      };
    });
  }

  // Approval Mode Dropdown Toggle
  const approvalBtn = document.getElementById('dock-approval-toggle-btn');
  const approvalDropdown = document.getElementById('dock-approval-dropdown');
  if (approvalBtn && approvalDropdown) {
    approvalBtn.onclick = (e) => {
      e.stopPropagation();
      const isOpen = approvalDropdown.style.display === 'block';
      approvalDropdown.style.display = isOpen ? 'none' : 'block';
    };
    document.querySelectorAll('.approval-option').forEach((opt) => {
      (opt as HTMLElement).onclick = (e) => {
        e.stopPropagation();
        const mode = (e.currentTarget as HTMLElement).getAttribute('data-mode') as AppState['approvalMode'];
        approvalDropdown.style.display = 'none';
        if (mode) void switchApproval(mode);
      };
    });
  }

  // Notice close button
  const noticeCloseBtn = document.getElementById('dock-notice-close');
  if (noticeCloseBtn) {
    noticeCloseBtn.onclick = () => {
      state.dockNotice = '';
      if (dockNoticeDismissTimer) {
        clearTimeout(dockNoticeDismissTimer);
        dockNoticeDismissTimer = null;
      }
      render();
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

  // Scroll stream: Auto-load older messages on top reach
  const streamEl = document.getElementById('conversation-stream');
  if (streamEl) {
    streamEl.onscroll = () => {
      if (streamEl.scrollTop < 120 && state.hasOlderMessages && !state.isLoadingOlder) {
        void loadOlderMessages();
      }
    };
  }

  // Tool file link click -> Inspect file in right Inspection Pod
  document.querySelectorAll<HTMLElement>('.tool-file-link').forEach((link) => {
    link.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      const filePath = link.dataset.previewFile;
      if (!filePath) return;

      // Try extracting existing content from messages toolCalls if already present in session
      let existingContent = '';
      for (const m of state.messages) {
        if (!m.toolCalls) continue;
        for (const tc of m.toolCalls) {
          const rawName = String(tc.name || '').toLowerCase();
          let tcPath = '';
          let tcArgsObj: any = null;
          if (typeof tc.args === 'string') {
            const trimmed = tc.args.trim();
            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
              try { tcArgsObj = JSON.parse(trimmed); } catch {}
              tcPath = tcArgsObj?.path || tcArgsObj?.file || tcArgsObj?.filePath || tcArgsObj?.file_path || tcArgsObj?.resolved_path || '';
            } else {
              tcPath = trimmed;
            }
          } else if (tc.args && typeof tc.args === 'object') {
            tcArgsObj = tc.args;
            tcPath = tcArgsObj?.path || tcArgsObj?.file || tcArgsObj?.filePath || tcArgsObj?.file_path || tcArgsObj?.resolved_path || '';
          }

          const isMatch = tcPath && (
            tcPath === filePath ||
            tcPath.endsWith(filePath) ||
            filePath.endsWith(tcPath) ||
            tcPath.split('/').pop() === filePath.split('/').pop()
          );

          // 1. If write tool and has input.content
          if (isMatch && (rawName.includes('write') || rawName.includes('create'))) {
            if (tcArgsObj && typeof tcArgsObj.content === 'string') {
              existingContent = tcArgsObj.content;
              break;
            }
          }

          // 2. If edit/patch tool and output has diff
          if (isMatch && (rawName.includes('edit') || rawName.includes('patch'))) {
            let outStr = typeof tc.output === 'string' ? tc.output : tc.output ? JSON.stringify(tc.output) : '';
            if (outStr.startsWith('{') && outStr.endsWith('}')) {
              try {
                const parsed = JSON.parse(outStr);
                if (typeof parsed.diff === 'string') outStr = parsed.diff;
                else if (typeof parsed.content === 'string') outStr = parsed.content;
              } catch {}
            }
            if (!outStr && tcArgsObj && typeof tcArgsObj.diff === 'string') {
              outStr = tcArgsObj.diff;
            }
            if (!outStr && tcArgsObj && typeof tcArgsObj.patch === 'string') {
              outStr = tcArgsObj.patch;
            }
            if (outStr) {
              existingContent = outStr;
              break;
            }
          }

          // 3. If read_file output matches target file
          if (isMatch && (rawName.includes('read') || rawName === 'file')) {
            let outStr = typeof tc.output === 'string' ? tc.output : tc.output ? JSON.stringify(tc.output) : '';
            if (outStr.startsWith('{') && outStr.endsWith('}')) {
              try {
                const parsed = JSON.parse(outStr);
                if (typeof parsed.content === 'string') outStr = parsed.content;
                else if (typeof parsed.text === 'string') outStr = parsed.text;
                else if (typeof parsed.output === 'string') outStr = parsed.output;
              } catch {}
            }
            if (!outStr && tcArgsObj && typeof tcArgsObj.content === 'string') {
              outStr = tcArgsObj.content;
            }
            if (outStr) {
              existingContent = outStr;
              break;
            }
          }
        }
        if (existingContent) break;
      }

      state.inspectorCollapsed = false;
      state.activeFilePath = filePath;
      // Sync into openFiles
      let existingOpenFile = state.openFiles.find((f) => f.path === filePath);
      if (!existingOpenFile) {
        existingOpenFile = {
          id: `file-${Date.now()}`,
          path: filePath,
          content: existingContent || `// ${filePath}\n\n正在从工作区加载最新版本内容...`,
        };
        state.openFiles.push(existingOpenFile);
      } else if (existingContent) {
        existingOpenFile.content = existingContent;
      }

      // Find or push artifact
      let existing = state.artifacts.find((a) => a.name === filePath);
      if (!existing) {
        existing = {
          id: `art-${Date.now()}`,
          name: filePath,
          type: 'FILE',
          size: '',
          preview: existingContent ? existingContent : `// ${filePath}\n\n正在从工作区加载最新版本内容...`,
        };
        state.artifacts.unshift(existing);
      } else {
        if (existingContent && (!existing.preview || existing.preview.includes('正在从工作区加载'))) {
          existing.preview = existingContent;
        }
        // Bring existing to the top so InspectionPod prioritizes viewing it
        state.artifacts = [existing, ...state.artifacts.filter((a) => a.name !== filePath)];
      }
      render();

      // Async fetch file content if available via local desktop bridge, gateway REST or RPC
      const fetchFileContent = async () => {
        // Attempt 0: Local Desktop File System Bridge (instant local file access)
        if (desktopApi?.readFile) {
          try {
            const localContent = await desktopApi.readFile(filePath);
            if (typeof localContent === 'string' && localContent.length > 0) {
              if (existing) existing.preview = localContent;
              if (existingOpenFile) existingOpenFile.content = localContent;
              render();
              return;
            }
          } catch {}
        }

        // Attempt 1: Standard OpenChamber /api/fs/read REST endpoint via desktop bridge
        if (desktopApi?.httpProxy) {
          try {
            const res = await desktopApi.httpProxy({
              baseUrl: state.gatewayUrl || 'http://127.0.0.1:9119',
              path: `/api/fs/read?path=${encodeURIComponent(filePath)}&optional=true`,
              method: 'GET',
            });
            const text = typeof res === 'string' ? res : typeof res?.content === 'string' ? res.content : '';
            if (text) {
              if (existing) existing.preview = text;
              if (existingOpenFile) existingOpenFile.content = text;
              render();
              return;
            }
          } catch {}
        }

        // Attempt 2: RPC workspace.readFile
        if (gatewayClient) {
          try {
            const res = await gatewayClient.call<any>('workspace.readFile', { path: filePath });
            const content = typeof res?.content === 'string' ? res.content : typeof res === 'string' ? res : '';
            if (content) {
              if (existing) existing.preview = content;
              if (existingOpenFile) existingOpenFile.content = content;
              render();
              return;
            }
          } catch {}
        }

        // Attempt 3: RPC file.read
        if (gatewayClient) {
          try {
            const res = await gatewayClient.call<any>('file.read', { path: filePath });
            const content = typeof res?.content === 'string' ? res.content : typeof res === 'string' ? res : '';
            if (content) {
              if (existing) existing.preview = content;
              if (existingOpenFile) existingOpenFile.content = content;
              render();
              return;
            }
          } catch {}
        }

        // If not fetchable from remote gateway backend but we have local session content, KEEP existingContent!
        if (existingContent) {
          if (existing) existing.preview = existingContent;
          if (existingOpenFile) existingOpenFile.content = existingContent;
          render();
          return;
        }

        if (existing && (!existing.preview || existing.preview.includes('正在从工作区加载'))) {
          const fallbackText = `// ${filePath}\n\n（该文件位于远程网关工作区，网关未开放直接文件读取通道）`;
          existing.preview = fallbackText;
          if (existingOpenFile) existingOpenFile.content = fallbackText;
          render();
        }
      };

      void fetchFileContent();
    };
  });

  // Dynamic live duration ticker for running tools (100ms interval for fluid stopwatch)
  updateRunningToolTimers();

  // Bind Draggable Rails
  bindRailResizeEvents();
}

let runningToolTimerHandle: number | undefined;

function updateRunningToolTimers(): void {
  const activeBadges = document.querySelectorAll<HTMLElement>('.tool-duration-badge[data-start-time]');
  if (activeBadges.length === 0) {
    if (runningToolTimerHandle !== undefined) {
      clearInterval(runningToolTimerHandle);
      runningToolTimerHandle = undefined;
    }
    return;
  }

  const tick = () => {
    const badges = document.querySelectorAll<HTMLElement>('.tool-duration-badge[data-start-time]');
    if (badges.length === 0) {
      if (runningToolTimerHandle !== undefined) {
        clearInterval(runningToolTimerHandle);
        runningToolTimerHandle = undefined;
      }
      return;
    }
    const now = Date.now();
    badges.forEach((b) => {
      const startTime = Number(b.dataset.startTime);
      if (startTime && !isNaN(startTime)) {
        const elapsedSec = Math.max(0.1, (now - startTime) / 1000);
        b.textContent = `${elapsedSec.toFixed(1)}s`;
      }
    });
  };

  tick();
  if (runningToolTimerHandle === undefined) {
    runningToolTimerHandle = window.setInterval(tick, 100);
  }
}

function bindRailResizeEvents(): void {
  document.querySelectorAll<HTMLElement>('.rail-resize-handle').forEach((handle) => {
    const isLeft = handle.dataset.railHandle === 'left';
    const cssVar = isLeft ? '--rail-w-left' : '--rail-w-right';
    const minW = isLeft ? 200 : 260;
    const maxW = isLeft ? 500 : Math.round(window.innerWidth * 0.85);
    const defaultW = isLeft ? 260 : 420;
    const storageKey = isLeft ? 'hermes_flux_rail_w_left' : 'hermes_flux_rail_w_right';

    handle.ondblclick = (e) => {
      e.stopPropagation();
      document.documentElement.style.setProperty(cssVar, `${defaultW}px`);
      localStorage.setItem(storageKey, String(defaultW));
    };

    handle.onpointerdown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();

      const startX = ev.clientX;
      const startWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar)) || defaultW;
      document.documentElement.setAttribute('data-rail-resizing', isLeft ? 'left' : 'right');

      let currentW = startWidth;

      const onPointerMove = (moveEv: PointerEvent) => {
        const delta = (moveEv.clientX - startX) * (isLeft ? 1 : -1);
        currentW = Math.max(minW, Math.min(maxW, startWidth + delta));
        document.documentElement.style.setProperty(cssVar, `${currentW}px`);
      };

      const onPointerUp = (upEv: PointerEvent) => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        document.documentElement.removeAttribute('data-rail-resizing');
        localStorage.setItem(storageKey, String(Math.round(currentW)));
      };

      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    };
  });
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

// Close the model menu, reasoning menu or context menu when the pointer goes down outside of it.
document.addEventListener('mousedown', (e) => {
  const reasoningDropdown = document.getElementById('dock-reasoning-dropdown');
  const reasoningBtn = document.getElementById('dock-reasoning-toggle-btn');
  if (reasoningDropdown && reasoningDropdown.style.display === 'block') {
    if (!reasoningDropdown.contains(e.target as Node) && !reasoningBtn?.contains(e.target as Node)) {
      reasoningDropdown.style.display = 'none';
    }
  }

  const approvalDropdown = document.getElementById('dock-approval-dropdown');
  const approvalBtn = document.getElementById('dock-approval-toggle-btn');
  if (approvalDropdown && approvalDropdown.style.display === 'block') {
    if (!approvalDropdown.contains(e.target as Node) && !approvalBtn?.contains(e.target as Node)) {
      approvalDropdown.style.display = 'none';
    }
  }

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
  logApp.info('renderer boot', {
    level: getLogLevel(),
    theme: state.theme,
    platform: navigator.platform,
    electron: navigator.userAgent.includes('Electron'),
  });
  installLayoutShiftDiagnostics();

  // Restore persisted rail widths
  const savedLeft = localStorage.getItem('hermes_flux_rail_w_left') || localStorage.getItem('hermes_aura_rail_w_left');
  if (savedLeft) document.documentElement.style.setProperty('--rail-w-left', `${savedLeft}px`);
  const savedRight = localStorage.getItem('hermes_flux_rail_w_right') || localStorage.getItem('hermes_aura_rail_w_right');
  if (savedRight) document.documentElement.style.setProperty('--rail-w-right', `${savedRight}px`);

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
