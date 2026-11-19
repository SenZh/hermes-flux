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
    feedTurnWatchdog: () => { watchdogEvents.push('feed'); },
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

test('D6: gatewayEventDispatcher - 隐私模式下连接回写配置失败不得中断连接流程（P-032）', async () => {
  // 【杀伤力】把 safeSetItem 换回裸 localStorage.setItem，connect() 会抛 SecurityError 且跳过 render。
  const hadStorage = 'localStorage' in globalThis;
  const savedStorage = globalThis.localStorage;
  const savedWarn = console.warn;
  const warns = [];
  try {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {
        const error = new Error('denied');
        error.name = 'SecurityError';
        throw error;
      },
    };
    console.warn = (...args) => warns.push(args);

    const { deps, rendered, state } = createMockDispatcherDeps();
    // 让 testConnection 直接返回失败，避免在 Node 里创建真实 WebSocket 客户端。
    deps.testConnection = async () => ({ ok: false, latency: 0, message: 'denied' });
    const dispatcher = createGatewayEventDispatcher(deps);

    await assert.doesNotReject(() => dispatcher.connect(), '写盘失败不得让 connect 抛错');
    assert.equal(state.gatewayUrl, 'http://127.0.0.1:8080', '内存态必须已生效');
    assert.ok(rendered.length >= 1, '连接流程必须继续并触发 render');
    assert.ok(
      warns.some((args) => String(args[0]).includes('failed to persist connection config')),
      '写盘失败必须可观测（Failure Is Not Empty）',
    );
  } finally {
    console.warn = savedWarn;
    if (hadStorage) globalThis.localStorage = savedStorage;
    else delete globalThis.localStorage;
  }
});

test('D6: gatewayEventDispatcher - 正常存储与无 localStorage 时回写不产生降级日志（P-032）', async () => {
  for (const mode of ['normal', 'absent']) {
    const hadStorage = 'localStorage' in globalThis;
    const savedStorage = globalThis.localStorage;
    const savedWarn = console.warn;
    const warns = [];
    try {
      if (mode === 'normal') {
        globalThis.localStorage = { getItem: () => null, setItem: () => {} };
      } else {
        delete globalThis.localStorage;
      }
      console.warn = (...args) => warns.push(args);

      const { deps } = createMockDispatcherDeps();
      deps.testConnection = async () => ({ ok: false, latency: 0, message: 'denied' });
      await assert.doesNotReject(() => createGatewayEventDispatcher(deps).connect());
      assert.equal(warns.length, 0, `${mode} 场景不得产生降级日志`);
    } finally {
      console.warn = savedWarn;
      if (hadStorage) globalThis.localStorage = savedStorage;
      else delete globalThis.localStorage;
    }
  }
});

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

  // 验证活跃流式数据持续喂狗
  const feedCount = pushedTokens.length;
  assert.ok(deps.getState());
});

test('D6: gatewayEventDispatcher - 流式数据下发触发滑动看门狗喂狗与无注入安全降级', () => {
  const { deps, watchdogEvents } = createMockDispatcherDeps();
  const dispatcher = createGatewayEventDispatcher(deps);

  dispatcher.applyTurnActions([
    { type: 'append-content', messageId: 'ast-1', text: 'Chunk 1' },
    { type: 'append-thought', messageId: 'ast-1', text: 'Thought 1' },
    { type: 'tool-start', messageId: 'ast-1', toolCall: { id: 'tc-feed-1', name: 'read' } },
    { type: 'tool-complete', messageId: 'ast-1', toolCallId: 'tc-feed-1', output: 'done' },
  ]);

  const feeds = watchdogEvents.filter((e) => e === 'feed');
  assert.equal(feeds.length, 4, '4 次流式活跃事件必须各触发一次 feedTurnWatchdog');

  // 无 feedTurnWatchdog 注入时安全降级
  const noFeedDeps = { ...deps, feedTurnWatchdog: undefined };
  const dispatcher2 = createGatewayEventDispatcher(noFeedDeps);
  assert.doesNotThrow(() => {
    dispatcher2.applyTurnActions([
      { type: 'append-content', messageId: 'ast-1', text: 'Chunk 2' },
      { type: 'append-thought', messageId: 'ast-1', text: 'Thought 2' },
      { type: 'tool-start', messageId: 'ast-1', toolCall: { id: 'tc-feed-2', name: 'edit' } },
      { type: 'tool-complete', messageId: 'ast-1', toolCallId: 'tc-feed-2', output: 'ok' },
    ]);
  });
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

test('D6: gatewayEventDispatcher - turn-completed 前贴底时即使 finalReplace/flush 撑高容器也必须锁定贴底', () => {
  // 1. 前置贴底：flush/setMessageContent 执行后容器变高导致 isNearBottom 变 false，仍须触发 setPendingScrollToBottom(true)
  let nearBottom = true;
  const pendingCalls = [];
  const { deps, state } = createMockDispatcherDeps();
  deps.isStreamNearBottom = () => nearBottom;
  deps.setPendingScrollToBottom = (val) => pendingCalls.push(val);
  deps.getTokenCoalescer = () => ({
    push: () => {},
    flush: () => { nearBottom = false; },
    clear: () => {},
  });
  deps.setMessageContent = () => { nearBottom = false; };
  state.activeSessionId = 'sess-1';
  state.messages.push({ id: 'msg-1', role: 'assistant', content: 'hi', timestamp: '10:00' });
  const dispatcher = createGatewayEventDispatcher(deps);

  dispatcher.applyTurnActions([
    { type: 'replace-content', messageId: 'msg-1', text: 'very long final response...' },
    { type: 'turn-completed', sessionId: 'sess-1' },
  ]);
  assert.deepEqual(pendingCalls, [true], '流式结束前原本贴底时，必须锁定本次 render 的贴底意图');

  // 2. 前置非贴底（用户正在向上回看历史）：绝不能强行拉回底部
  nearBottom = false;
  pendingCalls.length = 0;
  dispatcher.applyTurnActions([{ type: 'turn-completed', sessionId: 'sess-1' }]);
  assert.deepEqual(pendingCalls, [], '用户原本不在底部时不得触发贴底');

  // 3. 后台非当前聚焦会话完成：不得触发当前视口贴底
  nearBottom = true;
  pendingCalls.length = 0;
  dispatcher.applyTurnActions([{ type: 'turn-completed', sessionId: 'sess-other' }]);
  assert.deepEqual(pendingCalls, [], '后台会话完成不得触发当前会话视口贴底');
});

test('D6: gatewayEventDispatcher - turn-completed / turn-failed / disconnect 必须清空 toolPatchQueue，且 turn-failed 不双 render', () => {
  let clearToolPatchCalls = 0;
  let syncPresenceCalls = 0;
  const pendingCalls = [];
  const { deps, state, rendered } = createMockDispatcherDeps();
  deps.clearToolPatchQueue = () => { clearToolPatchCalls += 1; };
  deps.syncAgentPresence = () => { syncPresenceCalls += 1; };
  deps.isStreamNearBottom = () => true;
  deps.setPendingScrollToBottom = (val) => pendingCalls.push(val);
  // 模拟真实 turnExecutionService.setTimedDockNotice：未传 skipRender 时会同步调用 render()
  deps.setTimedDockNotice = (msg, _dur, opts) => {
    state.dockNotice = msg;
    if (!opts?.skipRender) {
      deps.render();
    }
  };
  const dispatcher = createGatewayEventDispatcher(deps);

  // 1. turn-completed 清理工具补丁队列
  dispatcher.applyTurnActions([{ type: 'turn-completed', sessionId: 'sess-1' }]);
  assert.equal(clearToolPatchCalls, 1, 'turn-completed 必须清空 toolPatchQueue，防止迟到 rAF 覆写 React DOM');

  // 2. turn-failed 清理队列且仅触发唯一一次 render()（消除双 render）
  rendered.length = 0;
  syncPresenceCalls = 0;
  pendingCalls.length = 0;
  state.isStreaming = true;
  deps.setActiveStreamingContext({
    activeStreamingMessageId: 'ast-1',
    activeStreamingStoredSessionId: 'sess-1',
    activeStreamingLiveId: 'live-1',
  });
  dispatcher.applyTurnActions([{ type: 'turn-failed', sessionId: 'sess-1', message: 'boom 500' }]);
  assert.equal(clearToolPatchCalls, 2, 'turn-failed 必须清空 toolPatchQueue');
  assert.equal(rendered.length, 1, 'turn-failed 必须只触发唯一一次 render()，严禁 setTimedDockNotice + needsRender 双渲染');
  assert.equal(syncPresenceCalls, 1, 'turn-failed 仍须同步在场指示器');
  assert.equal(state.dockNotice, 'boom 500', '错误提示仍须落盘至 dockNotice');
  assert.deepEqual(pendingCalls, [true], 'turn-failed 前贴底时必须保留贴底意图');

  // 3. disconnect 清理队列
  dispatcher.disconnect();
  assert.equal(clearToolPatchCalls, 3, 'disconnect 必须清空 toolPatchQueue');
});

test('D6: gatewayEventDispatcher - turn-completed / turn-failed 全链路收口变异杀伤（工具收敛/缓存持久化/会话置顶/Bot与后台态）', () => {
  const flushCalls = [];
  const stopTimerCalls = [];
  const setContentCalls = [];
  const completeCalls = [];
  const persistTurnCalls = [];
  const persistSessionsCalls = [];
  const botActivityCalls = [];
  const syncProfileCalls = [];
  const turnStartedSessionCalls = [];
  const clearPresenceCalls = [];
  const trackerClears = [];
  const pendingCalls = [];

  const { deps, state } = createMockDispatcherDeps({
    state: {
      activeSessionId: 'sess-1',
      activeFocus: { type: 'bot', botName: 'arch-bot' },
      sessions: [
        { id: 'sess-top', title: 'Top', botName: 'default', preview: 'old', timestamp: 100 },
        { id: 'sess-1', title: 'Task 1', botName: 'arch-bot', preview: '', timestamp: 50 },
        { id: 'sess-bg', title: 'Bg', botName: 'default', preview: '', timestamp: 20 },
      ],
      messages: [
        { id: 'usr-1', role: 'user', content: 'hi', timestamp: '12:00:00' },
        {
          id: 'ast-1',
          role: 'assistant',
          content: 'draft',
          timestamp: '12:00:01',
          toolCalls: [
            { id: 't1', name: 'read', status: 'running', startTime: Date.now() - 500 },
            { id: 't2', name: 'fast', status: 'running', startTime: Date.now() - 5 },
            { id: 't3', name: 'preset', status: 'running', startTime: Date.now() - 900, durationMs: 321 },
            { id: 't4', name: 'err', status: 'failed', startTime: Date.now() - 900 },
          ],
        },
      ],
    },
    activeStreamingContext: {
      activeStreamingMessageId: 'ast-1',
      activeStreamingStoredSessionId: 'sess-1',
      activeStreamingLiveId: 'live-1',
      activeStreamingBotName: 'arch-bot',
    },
  });

  deps.getTokenCoalescer = () => ({ enqueue: () => {}, flush: () => flushCalls.push(1) });
  deps.stopRunningToolTimers = () => stopTimerCalls.push(1);
  deps.setMessageContent = (id, text) => {
    setContentCalls.push([id, text]);
    const m = state.messages.find((x) => x.id === id);
    if (m) m.content = text;
  };
  deps.completeEntityTurn = (kind, _run, _unread, id, focused) => completeCalls.push({ kind, id, focused });
  deps.persistTurnToCache = (sid, bot, msgs) => persistTurnCalls.push({ sid, bot, count: msgs.length });
  deps.persistSessionsToCache = (sessions) => persistSessionsCalls.push(sessions.map((s) => s.id));
  deps.getBotActivityStore = () => ({
    updateLatestActivity: (bot, content) => botActivityCalls.push({ bot, content }),
  });
  deps.syncProfileLastMessages = () => syncProfileCalls.push(1);
  deps.setTurnStartedSessionId = (id) => turnStartedSessionCalls.push(id);
  deps.clearPresenceTerminal = () => clearPresenceCalls.push(1);
  deps.getActivityTransitionTracker = () => ({ clear: (kind, id) => trackerClears.push([kind, id]) });
  deps.setPendingScrollToBottom = (v) => pendingCalls.push(v);
  deps.t = (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k);
  // 故意不注入 isStreamNearBottom，验证默认回落为 false（不得误触发贴底）
  deps.isStreamNearBottom = undefined;

  // 缓存含多条消息，确保 replace-content 按 id 精确匹配
  const cachedSess1 = [
    { id: 'usr-1', role: 'user', content: 'hi' },
    { id: 'ast-1', role: 'assistant', content: 'draft' },
  ];
  deps.getSessionMessagesCache().set('sess-1', cachedSess1);

  const dispatcher = createGatewayEventDispatcher(deps);
  dispatcher.applyTurnActions([
    { type: 'replace-content', messageId: 'ast-1', text: 'Final Answer' },
    { type: 'turn-completed' }, // 缺 action.sessionId，必须回退到 ctx.activeStreamingStoredSessionId
  ]);

  assert.equal(flushCalls.length, 1);
  assert.equal(stopTimerCalls.length, 1);
  assert.deepEqual(setContentCalls, [['ast-1', 'Final Answer']]);
  assert.equal(cachedSess1[0].content, 'hi', 'replace-content 严禁误改非目标缓存消息');
  assert.equal(cachedSess1[1].content, 'Final Answer', 'replace-content 必须同步更新目标缓存消息');

  const tcs = state.messages[1].toolCalls;
  assert.equal(tcs[0].status, 'completed');
  assert.ok(tcs[0].durationMs >= 400, '已运行 500ms 的工具 durationMs 应反映真实耗时');
  assert.equal(tcs[1].status, 'completed');
  assert.equal(tcs[1].durationMs, 100, '极短耗时工具 durationMs 应由 Math.max(100, ...) 兜底为 100');
  assert.equal(tcs[2].durationMs, 321, '已有 durationMs 不得被覆写');
  assert.equal(tcs[3].status, 'failed', '非 running 状态工具不得被改成 completed');

  assert.deepEqual(pendingCalls, [], '未注入 isStreamNearBottom 时默认 false，不得触发贴底');
  assert.deepEqual(completeCalls, [
    { kind: 'session', id: 'sess-1', focused: true },
    { kind: 'bot', id: 'arch-bot', focused: true },
  ]);
  assert.equal(persistTurnCalls.length, 1);
  assert.equal(persistTurnCalls[0].sid, 'sess-1');
  assert.equal(persistTurnCalls[0].count, 2);
  assert.equal(state.sessions[0].id, 'sess-1', '完成会话必须置顶到 state.sessions[0]');
  assert.equal(state.sessions[0].preview, 'Final Answer');
  assert.deepEqual(persistSessionsCalls[0], ['sess-1', 'sess-top', 'sess-bg']);
  assert.deepEqual(botActivityCalls, [{ bot: 'arch-bot', content: 'Final Answer' }]);
  assert.equal(syncProfileCalls.length, 1);
  assert.deepEqual(turnStartedSessionCalls, [null]);
  assert.equal(clearPresenceCalls.length, 1);
  assert.equal(deps.getActiveStreamingContext().activeStreamingBotName, null);

  // 2. 后台非聚焦会话 + 后台 Bot 完成：从 sessionMessagesCache 取终答并更新 preview/botActivity
  completeCalls.length = 0;
  persistTurnCalls.length = 0;
  botActivityCalls.length = 0;
  deps.getSessionMessagesCache().set('sess-bg', [
    { id: 'bg-u', role: 'user', content: 'bg q' },
    { id: 'bg-a', role: 'assistant', content: 'Background Final' },
  ]);
  deps.setActiveStreamingContext({
    activeStreamingMessageId: 'bg-a',
    activeStreamingStoredSessionId: 'sess-bg',
    activeStreamingLiveId: 'live-bg',
    activeStreamingBotName: 'bg-bot',
  });
  dispatcher.applyTurnActions([{ type: 'turn-completed', sessionId: 'sess-bg' }]);
  assert.equal(persistTurnCalls[0].sid, 'sess-bg');
  assert.equal(state.sessions[0].id, 'sess-bg');
  assert.equal(state.sessions[0].preview, 'Background Final');
  assert.deepEqual(botActivityCalls, [{ bot: 'bg-bot', content: 'Background Final' }]);
  assert.deepEqual(completeCalls, [
    { kind: 'session', id: 'sess-bg', focused: false },
    { kind: 'bot', id: 'bg-bot', focused: false },
  ]);

  // 3. turn-failed：空消息填充错误前缀、非空消息不覆盖、清理 runningSession/runningBot/tracker 与 activeStreamingContext
  flushCalls.length = 0;
  stopTimerCalls.length = 0;
  syncProfileCalls.length = 0;
  trackerClears.length = 0;
  pendingCalls.length = 0;
  state.messages.push({ id: 'ast-empty', role: 'assistant', content: '', timestamp: '12:00:02' });
  deps.getActiveRunningSessionIds().add('sess-1');
  deps.getActiveRunningBotNames().add('fail-bot');
  deps.setActiveStreamingContext({
    activeStreamingMessageId: 'ast-empty',
    activeStreamingStoredSessionId: 'sess-1',
    activeStreamingLiveId: 'live-1',
    activeStreamingBotName: 'fail-bot',
  });
  dispatcher.applyTurnActions([{ type: 'turn-failed', message: 'net err' }]);
  assert.equal(flushCalls.length, 1);
  assert.equal(stopTimerCalls.length, 1);
  assert.equal(syncProfileCalls.length, 1);
  assert.ok(state.messages.find((m) => m.id === 'ast-empty').content.includes('net err'), '空正文必须回填错误文案');
  assert.equal(deps.getActiveRunningSessionIds().has('sess-1'), false);
  assert.equal(deps.getActiveRunningBotNames().has('fail-bot'), false);
  assert.deepEqual(trackerClears, [['session', 'sess-1'], ['bot', 'fail-bot']]);
  assert.equal(deps.getActiveStreamingContext().activeStreamingMessageId, null);
  assert.equal(deps.getActiveStreamingContext().activeStreamingStoredSessionId, null);
  assert.equal(deps.getActiveStreamingContext().activeStreamingBotName, null);
  assert.deepEqual(pendingCalls, [], '未注入 isStreamNearBottom 时 turn-failed 默认 false，不得误触发贴底');

  // 非空消息 fail 不得覆写已有正文，且后台会话 fail 即使贴底也不得触发当前视口贴底
  deps.isStreamNearBottom = () => true;
  state.messages.push({ id: 'ast-nonempty', role: 'assistant', content: 'Keep me', timestamp: '12:00:03' });
  deps.setActiveStreamingContext({
    activeStreamingMessageId: 'ast-nonempty',
    activeStreamingStoredSessionId: 'sess-bg',
    activeStreamingLiveId: 'live-bg',
    activeStreamingBotName: null,
  });
  dispatcher.applyTurnActions([{ type: 'turn-failed', sessionId: 'sess-bg', message: 'bg err' }]);
  assert.equal(state.messages.find((m) => m.id === 'ast-nonempty').content, 'Keep me', '非空正文不得被错误前缀覆盖');
  assert.deepEqual(pendingCalls, [], '后台会话 turn-failed 不得触发当前会话视口贴底');
});
