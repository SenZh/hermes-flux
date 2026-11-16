/**
 * 网关连接生命周期与 WebSocket 下行事件分发服务（Gateway Event Dispatcher · D6）纯逻辑单测
 * (packages/desktop/__tests__/unit/gatewayEventDispatcher.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createGatewayEventDispatcher } from '../../dist/renderer/gateway/gatewayEventDispatcher.mjs';

function createMockDispatcherDeps(overrides = {}) {
  const rendered = [];
  const state = {
    activeSessionId: 'sess-1',
    activeLiveSessionId: 'live-1',
    profileName: 'default',
    profiles: [{ name: 'default', displayName: 'Default Bot' }],
    sessions: [
      { id: 'sess-1', title: 'Task 1', botName: 'default', preview: '', timestamp: 1000 },
    ],
    messages: [
      { id: 'usr-1', role: 'user', content: 'hello', timestamp: '12:00:00' },
      { id: 'ast-1', role: 'assistant', content: '', thought: '', timestamp: '12:00:01' },
    ],
    artifacts: [],
    browserFrame: undefined,
    gitDiffs: [],
    sideAgentCapsules: [],
    activeFocus: { type: 'session', sessionId: 'sess-1' },
    isStreaming: false,
    turnStartedAt: undefined,
    dockNotice: '',
    presenceTerminal: undefined,
    gatewayConnected: false,
    gatewayConnecting: false,
    gatewayUrl: 'http://127.0.0.1:8080',
    username: 'admin',
    password: 'pwd',
    ...(overrides.state || {}),
  };

  let activeStreamingContext = {
    activeStreamingMessageId: 'ast-1',
    activeStreamingStoredSessionId: 'sess-1',
    activeStreamingLiveId: 'live-1',
    activeStreamingBotName: null,
    ...(overrides.activeStreamingContext || {}),
  };

  let turnStartedSessionId = null;
  let currentTicket = undefined;
  let gatewayClient = null;

  const runningSessions = new Set(['sess-1']);
  const unreadSessions = new Set();
  const runningBots = new Set();
  const unreadBots = new Set();
  const runningGroups = new Set();
  const unreadGroups = new Set();

  const sessionMessagesCache = new Map();
  sessionMessagesCache.set('sess-1', [...state.messages]);

  const pushedTokens = [];
  const tokenCoalescer = {
    push(item) { pushedTokens.push(item); },
    flush() {},
    clear() {},
  };

  const activityTransitionTracker = {
    clearedAll: false,
    cleared: [],
    clear(domain, id) { this.cleared.push({ domain, id }); },
    clearAll() { this.clearedAll = true; },
  };

  const patchedTools = [];
  const scheduledSessionsRefreshes = [];
  const completedEntityTurns = [];
  const watchdogEvents = [];
  const presenceEvents = [];

  const deps = {
    getState: () => state,
    getGatewayClient: () => gatewayClient,
    setGatewayClient: (c) => { gatewayClient = c; },
    getCurrentTicket: () => currentTicket,
    setCurrentTicket: (t) => { currentTicket = t; },
    getDesktopApi: () => undefined,
    getEffectiveUrl: (url) => url || 'http://127.0.0.1:8080',
    testConnection: async (url, u, p) => ({ ok: true, latency: 15, ticket: 'ticket-xyz', message: 'ok' }),
    completeEntityTurn: (domain, running, unread, entityId, focused) => {
      completedEntityTurns.push({ domain, entityId, focused });
    },

    getSessionHandleRegistry: () => ({
      getLiveIds: (ids) => ids.map((id) => `live-${id}`),
      toLiveId: (id) => `live-${id}`,
      toStoredId: (id) => id.replace(/^live-/, ''),
      register: () => {},
    }),
    getSessionMessagesCache: () => sessionMessagesCache,
    getTokenCoalescer: () => tokenCoalescer,
    getActivityTransitionTracker: () => activityTransitionTracker,
    getBotActivityStore: () => ({ updateLatestActivity: () => {} }),
    getCacheService: () => ({ truncate: async () => {} }),

    getActiveRunningSessionIds: () => runningSessions,
    getUnreadSessionIds: () => unreadSessions,
    getActiveRunningBotNames: () => runningBots,
    getUnreadBotNames: () => unreadBots,
    getActiveRunningGroupRoomIds: () => runningGroups,
    getUnreadGroupRoomIds: () => unreadGroups,

    getActiveStreamingContext: () => activeStreamingContext,
    setActiveStreamingContext: (ctx) => {
      activeStreamingContext = { ...activeStreamingContext, ...ctx };
    },
    getTurnStartedSessionId: () => turnStartedSessionId,
    setTurnStartedSessionId: (id) => { turnStartedSessionId = id; },

    stopProfileAutoRefresh: () => {},
    startProfileAutoRefresh: () => {},
    stopAllGroupPollers: () => {},
    clearTransitionRefreshTimer: () => {},
    clearSessionsRefreshTimer: () => {},
    scheduleSessionsRefresh: () => { scheduledSessionsRefreshes.push(Date.now()); },

    persistTurnToCache: () => {},
    persistSessionsToCache: () => {},
    syncProfileLastMessages: () => {},
    syncAgentPresence: () => {},
    scheduleToolPatch: (mid) => { patchedTools.push(mid); },
    stopRunningToolTimers: () => {},
    setMessageContent: (mid, content) => {
      const msg = state.messages.find((m) => m.id === mid);
      if (msg) msg.content = content;
    },
    toStoredSessionId: (id) => id ? id.replace(/^live-/, '') : null,

    applyColdStartFocus: async () => {},
    fetchProfiles: async () => {},
    fetchSessions: async () => {},
    fetchGroupRooms: async () => {},
    fetchModelOptions: async () => {},
    fetchProjects: async () => {},
    prefetchSlashCatalog: async () => {},

    armTurnWatchdog: () => { watchdogEvents.push('arm'); },
    disarmTurnWatchdog: () => { watchdogEvents.push('disarm'); },
    clearPresenceTerminal: () => { presenceEvents.push('clear'); },
    armPresenceTerminal: (term) => { presenceEvents.push(term); },
    setTimedDockNotice: () => {},

    render: () => { rendered.push(Date.now()); },
    t: (key) => key,
  };

  return {
    state,
    deps,
    rendered,
    pushedTokens,
    patchedTools,
    completedEntityTurns,
    watchdogEvents,
    presenceEvents,
    activeStreamingContext: () => activeStreamingContext,
  };
}

test('D6: gatewayEventDispatcher - 120 FPS 双轨分流：高频 delta 严禁触发 render()', () => {
  const { deps, rendered, pushedTokens } = createMockDispatcherDeps();
  const dispatcher = createGatewayEventDispatcher(deps);

  dispatcher.applyTurnActions([
    { type: 'append-content', messageId: 'ast-1', text: 'Hello ' },
    { type: 'append-content', messageId: 'ast-1', text: 'World' },
    { type: 'append-thought', messageId: 'ast-1', text: 'Thinking...' },
  ]);

  assert.equal(rendered.length, 0, '高频增量 chunk 绝对禁止调用 render()');
  assert.equal(pushedTokens.length, 3);
  assert.equal(pushedTokens[0].delta, 'Hello ');
  assert.equal(pushedTokens[0].isThought, false);
  assert.equal(pushedTokens[2].isThought, true);
});

test('D6: gatewayEventDispatcher - 工具生命周期 tool-start / tool-complete 调度局部补丁', () => {
  const { deps, state, rendered, patchedTools } = createMockDispatcherDeps();
  const dispatcher = createGatewayEventDispatcher(deps);

  dispatcher.applyTurnActions([
    {
      type: 'tool-start',
      messageId: 'ast-1',
      toolCall: { id: 'tc-1', name: 'search', args: { q: 'Hermes' } },
    },
  ]);

  assert.equal(rendered.length, 0, '工具事件走 scheduleToolPatch，不触发全量 render');
  assert.equal(patchedTools.length, 1);
  assert.equal(patchedTools[0], 'ast-1');

  const astMsg = state.messages.find((m) => m.id === 'ast-1');
  assert.equal(astMsg.toolCalls?.length, 1);
  assert.equal(astMsg.toolCalls[0].name, 'search');
  assert.equal(astMsg.toolCalls[0].status, 'running');

  dispatcher.applyTurnActions([
    {
      type: 'tool-complete',
      messageId: 'ast-1',
      toolCallId: 'tc-1',
      output: 'Found 10 items',
      durationMs: 350,
    },
  ]);

  assert.equal(astMsg.toolCalls[0].status, 'completed');
  assert.equal(astMsg.toolCalls[0].output, 'Found 10 items');
  assert.equal(astMsg.toolCalls[0].durationMs, 350);
});

test('D6: gatewayEventDispatcher - 低频边界 turn-completed 触发 render 与状态收拢', () => {
  const { deps, state, rendered, completedEntityTurns, watchdogEvents, activeStreamingContext } = createMockDispatcherDeps();
  const dispatcher = createGatewayEventDispatcher(deps);

  dispatcher.applyTurnActions([
    {
      type: 'turn-completed',
      sessionId: 'sess-1',
    },
  ]);

  assert.ok(rendered.length > 0, 'turn-completed 必须调用 render()');
  assert.equal(state.isStreaming, false);
  assert.ok(watchdogEvents.includes('disarm'));
  assert.equal(activeStreamingContext().activeStreamingMessageId, null);
  assert.equal(completedEntityTurns.length, 1);
  assert.equal(completedEntityTurns[0].entityId, 'sess-1');
});

test('D6: gatewayEventDispatcher - turn-failed 落终态快照与错误呈现', () => {
  const { deps, state, rendered, presenceEvents, watchdogEvents } = createMockDispatcherDeps();
  const dispatcher = createGatewayEventDispatcher(deps);

  dispatcher.applyTurnActions([
    {
      type: 'turn-failed',
      sessionId: 'sess-1',
      message: 'Rate limit exceeded 429',
    },
  ]);

  assert.ok(rendered.length > 0);
  assert.equal(state.isStreaming, false);
  assert.ok(watchdogEvents.includes('disarm'));
  const failedPresence = presenceEvents.find((p) => p && typeof p === 'object' && p.kind === 'failed');
  assert.ok(failedPresence, '失败事件必须落入终态快照');
  assert.equal(failedPresence.message, 'Rate limit exceeded 429');
});

test('D6: gatewayEventDispatcher - disconnect 深度清空会话与未读运行集合', () => {
  const { deps, state, rendered } = createMockDispatcherDeps();
  const dispatcher = createGatewayEventDispatcher(deps);

  const prevEpoch = dispatcher.getConnectionEpoch();
  dispatcher.disconnect();

  assert.equal(dispatcher.getConnectionEpoch(), prevEpoch + 1, '断开连接必须自增 connectionEpoch');
  assert.equal(state.gatewayConnected, false);
  assert.equal(state.sessions.length, 0);
  assert.equal(state.messages.length, 0);
  assert.equal(deps.getActiveRunningSessionIds().size, 0, '运行中集合必须清空');
  assert.ok(rendered.length > 0);
});

test('D6: gatewayEventDispatcher - handleInspectorEvent 解包工件、浏览器帧与 Diff', () => {
  const { deps, state, rendered } = createMockDispatcherDeps();
  const dispatcher = createGatewayEventDispatcher(deps);

  dispatcher.handleInspectorEvent({
    type: 'artifact.created',
    payload: { id: 'art-1', name: 'report.pdf', type: 'FILE', size: '2MB' },
  });
  assert.equal(state.artifacts.length, 1);
  assert.equal(state.artifacts[0].name, 'report.pdf');

  dispatcher.handleInspectorEvent({
    type: 'browser.frame',
    payload: { url: 'https://example.com', title: 'Example Page' },
  });
  assert.equal(state.browserFrame?.url, 'https://example.com');
  assert.equal(state.browserFrame?.title, 'Example Page');

  dispatcher.handleInspectorEvent({
    type: 'git.diff',
    payload: { diffs: [{ file: 'index.ts', additions: 10, deletions: 5 }] },
  });
  assert.equal(state.gitDiffs.length, 1);
});
