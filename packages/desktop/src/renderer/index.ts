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
  reasoningLevel: 'high',
  approvalMode: 'auto',
  isStreaming: false,
  gatewayConnected: false,
  gatewayConnecting: false,
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

async function loadMessages(sessionId: string): Promise<void> {
  if (!sessionId || !gatewayClient) {
    state.messages = [];
    render();
    return;
  }

  try {
    // `session.resume` accepts the stored id and answers with the live id, which is
    // the only id prompt.submit / config.set understand.
    const res = await gatewayClient.call<any>('session.resume', { session_id: sessionId });

    const handles = readSessionHandles(res, sessionId);
    if (handles) {
      state.activeLiveSessionId = handles.liveId;
    }

    const list = Array.isArray(res?.messages) ? res.messages : Array.isArray(res?.history) ? res.history : [];
    state.messages = list.map((m: any, idx: number) => {
      const thought = typeof m.thinking === 'string' ? m.thinking : typeof m.thought === 'string' ? m.thought : '';

      const toolCalls = Array.isArray(m.tool_calls)
        ? m.tool_calls.map((tc: any) => ({
            id: tc.id || `tc-${idx}`,
            name: tc.name || tc.function?.name || 'tool',
            status: (tc.status || 'completed') as any,
            args: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args || {}),
            output: tc.output ? String(tc.output) : undefined,
          }))
        : [];

      return {
        id: String(m.row_id ?? m.id ?? `msg-${idx}`),
        role: (m.role === 'user' || m.role === 'system' ? m.role : 'assistant') as MessageViewModel['role'],
        content: m.text ?? m.content ?? '',
        thought,
        thoughtDurationMs: m.thought_duration_ms,
        toolCalls,
        timestamp: formatTimestamp(m.timestamp ?? m.created_at ?? Date.now()),
      };
    });

    if (state.activeSessionId === sessionId) state.dockNotice = '';
    render();
    requestAnimationFrame(() => {
      const stream = document.getElementById('conversation-stream');
      if (stream) stream.scrollTop = stream.scrollHeight;
    });
  } catch (e) {
    console.warn('[Hermes Gateway] Failed to load messages via RPC:', e);
    state.messages = [];
    state.dockNotice = `载入会话历史失败: ${describeRpcError(e)}`;
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
    await gatewayClient.call('session.delete', { session_id: id });
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
  } catch (e) {
    console.error('[Hermes Gateway] Delete session failed:', e);
    state.dockNotice = `删除会话失败: ${describeRpcError(e)}`;
    render();
  }
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
  if (el) el.innerHTML = renderMarkdown(text);
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

  const railSettingsBtn = document.getElementById('rail-footer-settings-btn');
  if (railSettingsBtn) {
    railSettingsBtn.onclick = () => {
      state.isSettingsOpen = true;
      state.settingsTab = 'gateway';
      render();
    };
  }

  const statusBar = document.getElementById('app-status-bar');
  if (statusBar) {
    statusBar.onclick = () => {
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

  // Session items & New Chat
  const newChatBtn = document.getElementById('new-chat-btn');
  if (newChatBtn) newChatBtn.onclick = () => createNewSession();

  document.querySelectorAll('.session-item').forEach((item) => {
    (item as HTMLElement).onclick = (e) => {
      if ((e.target as HTMLElement).classList.contains('btn-delete-session')) return;
      const id = (item as HTMLElement).dataset.id;
      if (id) selectSession(id);
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
      state.modelMenuOpen = !state.modelMenuOpen;
      render();
      if (state.modelMenuOpen && state.availableModels.length === 0) {
        void fetchModelOptions();
      }
    };
  }

  document.querySelectorAll('.model-option').forEach((opt) => {
    (opt as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      const model = (e.currentTarget as HTMLElement).getAttribute('data-model');
      const provider = (e.currentTarget as HTMLElement).getAttribute('data-provider') || undefined;
      if (model) void switchModel(model, provider);
    };
  });

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

// Close the model menu when the pointer goes down outside of it. mousedown is used
// on purpose: it fires before the button's click handler, so the two never race.
document.addEventListener('mousedown', (e) => {
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
