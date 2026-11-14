/**
 * 回合执行与队列控制服务（Turn Execution Service · D5）纯逻辑单测
 * (packages/desktop/__tests__/unit/turnExecutionService.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createTurnExecutionService } from '../../dist/renderer/services/turnExecutionService.mjs';

function createMockTurnDeps(overrides = {}) {
  const rendered = [];
  const state = {
    activeSessionId: 'sess-1',
    activeLiveSessionId: 'live-1',
    profileName: 'default',
    profiles: [{ name: 'default', displayName: 'Default Bot' }, { name: 'arch-bot', displayName: '架构师' }],
    sessions: [
      { id: 'sess-1', title: 'Task 1', botName: 'default', preview: '', timestamp: 1000 },
    ],
    groupRooms: [
      { roomId: 'room-1', name: 'General', lastMessage: '', updatedAt: 1000 },
    ],
    messages: [
      { id: 'usr-1', role: 'user', content: 'hello', timestamp: '12:00:00' },
    ],
    attachments: [],
    sideAgentCapsules: [],
    activeFocus: { type: 'session', sessionId: 'sess-1' },
    isStreaming: false,
    turnStartedAt: undefined,
    dockNotice: '',
    presenceTerminal: undefined,
    rollbackArmed: null,
    hasOlderMessages: false,
    pickedMention: null,
    ...(overrides.state || {}),
  };

  const rpcCalls = [];
  const gatewayClient = overrides.gatewayClient ?? {
    call: async (method, params) => {
      rpcCalls.push({ method, params });
      if (method === 'prompt.submit') {
        return { status: 'streaming', user_row_id: 42 };
      }
      if (method === 'session.interrupt') {
        return { ok: true };
      }
      if (method === 'image.attach_bytes') {
        return { ok: true, id: 'att-1' };
      }
      if (method === 'prompt.background') {
        return { task_id: 'task-bg-1' };
      }
      return {};
    },
  };

  let activeStreamingContext = {
    activeStreamingMessageId: null,
    activeStreamingStoredSessionId: null,
    activeStreamingLiveId: null,
    activeStreamingBotName: null,
    ...(overrides.activeStreamingContext || {}),
  };

  let turnStartedSessionId = null;
  const runningSessions = new Set();
  const unreadSessions = new Set();
  const runningBots = new Set();
  const unreadBots = new Set();
  const runningGroups = new Set();
  const unreadGroups = new Set();

  const sessionMessagesCache = new Map();
  const sessionDraftsMap = new Map();
  const sessionHistoryTrust = new Map();

  const tokenCoalescer = {
    flushed: false,
    cleared: false,
    flush() { this.flushed = true; },
    clear() { this.cleared = true; },
  };

  const activityTransitionTracker = {
    cleared: [],
    clear(domain, id) { this.cleared.push({ domain, id }); },
  };

  const sessionHandleRegistry = {
    registered: [],
    register(pair) { this.registered.push(pair); },
    toLiveId: (id) => `live-${id}`,
    toStoredId: (id) => id.replace(/^live-/, ''),
    getLiveIds: (ids) => ids.map((id) => `live-${id}`),
  };

  const botActivityStore = {
    updated: [],
    updateLatestActivity(botName, content, ts) {
      this.updated.push({ botName, content, ts });
    },
  };

  const interactiveService = {
    truncateCalls: [],
    truncateAndSubmit: async (caller, params) => {
      interactiveService.truncateCalls.push(params);
      return { status: 'streaming', user_row_id: 88 };
    },
  };

  const cacheService = {
    truncated: [],
    truncate: async (ref, rowId, survivorMap) => {
      cacheService.truncated.push({ ref, rowId, survivorMap });
    },
  };

  const groupRoomStore = {
    sent: [],
    logs: new Map(),
    getLogs(roomId) { return groupRoomStore.logs.get(roomId) || []; },
    fetchLogs: async (roomId) => groupRoomStore.logs.get(roomId) || [],
    sendMessage: async (roomId, text, actor, client, opts) => {
      groupRoomStore.sent.push({ roomId, text, opts });
      return { event: { payload: { thread_id: 'thread-123' } } };
    },
  };

  const handoffService = {
    sendBtw: async (liveId, question, profile) => {
      return { task_id: 'task-btw-1' };
    },
  };

  const completedTurns = [];

  const deps = {
    getState: () => state,
    getGatewayClient: () => gatewayClient,
    getRpcCaller: () => ({ call: (m, p) => gatewayClient.call(m, p) }),
    getInteractiveService: () => interactiveService,
    getCacheService: () => cacheService,
    getGroupRoomStore: () => groupRoomStore,
    getActivityTransitionTracker: () => activityTransitionTracker,
    getTokenCoalescer: () => tokenCoalescer,
    getSessionHandleRegistry: () => sessionHandleRegistry,
    getSessionMessagesCache: () => sessionMessagesCache,
    getSessionDrafts: () => ({
      get: (id) => sessionDraftsMap.get(id),
      set: (id, val) => sessionDraftsMap.set(id, val),
      delete: (id) => sessionDraftsMap.delete(id),
    }),
    getBotActivityStore: () => botActivityStore,
    getHandoffService: () => handoffService,
    completeEntityTurn: (domain, running, unread, entityId, focused) => {
      completedTurns.push({ domain, entityId, focused });
    },

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

    getSessionHistoryTrust: () => sessionHistoryTrust,
    forgetOlderCursorState: () => {},
    createNewSession: async () => {},
    ensureLiveSessionId: async () => 'live-1',
    setMessageContent: (mid, content) => {
      const target = state.messages.find((m) => m.id === mid);
      if (target) target.content = content;
    },
    syncActiveGroupSpeakerFromMessages: () => {},
    resolveAgentAvatar: () => '',
    scrollStreamToBottom: () => {},
    setPendingScrollToBottom: () => {},

    runSlashCommand: async () => {},
    enqueueDraft: async () => {},
    handleQueueAction: async () => {},

    render: () => { rendered.push(Date.now()); },
    t: (key, params) => {
      if (key === 'chat.interruptedSuffix') return ' *(已中断)*';
      if (key === 'chat.interruptedEmpty') return '*(已中断本轮生成)*';
      return `${key}${params ? JSON.stringify(params) : ''}`;
    },
  };

  return {
    state,
    deps,
    rpcCalls,
    interactiveService,
    cacheService,
    groupRoomStore,
    tokenCoalescer,
    botActivityStore,
    rendered,
    activeStreamingContext: () => activeStreamingContext,
  };
}

test('D5: turnExecutionService - armPresenceTerminal 与 clearPresenceTerminal 生命周期', () => {
  const { deps, state, rendered } = createMockTurnDeps();
  const service = createTurnExecutionService(deps);

  service.armPresenceTerminal({ kind: 'interrupted' });
  assert.equal(state.presenceTerminal?.kind, 'interrupted');

  service.clearPresenceTerminal();
  assert.equal(state.presenceTerminal, undefined);

  service.setTimedDockNotice('通知测试', 0);
  assert.equal(state.dockNotice, '通知测试');
});

test('D5: turnExecutionService - interruptTurn 终止当前流式并更新消息标记', async () => {
  const { deps, state, rpcCalls, activeStreamingContext } = createMockTurnDeps({
    state: {
      isStreaming: true,
      messages: [
        { id: 'ast-1', role: 'assistant', content: '生成中内容' },
      ],
    },
    activeStreamingContext: {
      activeStreamingMessageId: 'ast-1',
      activeStreamingStoredSessionId: 'sess-1',
      activeStreamingLiveId: 'live-1',
    },
  });

  const service = createTurnExecutionService(deps);
  await service.interruptTurn();

  assert.equal(state.isStreaming, false);
  assert.equal(state.presenceTerminal?.kind, 'interrupted');
  const msg = state.messages.find((m) => m.id === 'ast-1');
  assert.match(msg.content, /\*\(已中断\)\*/);
  assert.equal(activeStreamingContext().activeStreamingMessageId, null);

  const interruptRpc = rpcCalls.find((c) => c.method === 'session.interrupt');
  assert.ok(interruptRpc, '必须调用 remote session.interrupt');
  assert.equal(interruptRpc.params.session_id, 'live-1');
});

test('D5: turnExecutionService - sendMessage 发送单聊并挂载流式上下文', async () => {
  const { deps, state, rpcCalls, activeStreamingContext } = createMockTurnDeps();
  const service = createTurnExecutionService(deps);

  await service.sendMessage('请帮我分析这段架构');

  assert.equal(state.isStreaming, true);
  assert.ok(state.turnStartedAt > 0);
  assert.equal(state.messages.length, 3); // usr-1 + new user + new assistant
  const userMsg = state.messages[1];
  assert.equal(userMsg.role, 'user');
  assert.equal(userMsg.content, '请帮我分析这段架构');
  assert.equal(userMsg.rowId, 42, '网关权威 user_row_id 必须绑定回用户行');

  const submitRpc = rpcCalls.find((c) => c.method === 'prompt.submit');
  assert.ok(submitRpc);
  assert.equal(submitRpc.params.text, '请帮我分析这段架构');
  assert.equal(activeStreamingContext().activeStreamingStoredSessionId, 'sess-1');

  service.disarmTurnWatchdog();
  service.clearPresenceTerminal();
});

test('D5: turnExecutionService - routeSend 分流裁决与 BTW 旁路调用', async () => {
  const { deps, state } = createMockTurnDeps({
    state: {
      activeFocus: { type: 'bot', botName: 'default' },
    },
  });
  const service = createTurnExecutionService(deps);

  // Bot 工位中的 @ 提及分流为 BTW 外援胶囊
  await service.routeSend('@Default Bot 帮我看一眼');
  assert.equal(state.sideAgentCapsules.length, 1);
  assert.equal(state.sideAgentCapsules[0].id, 'task-btw-1');
  assert.equal(state.sideAgentCapsules[0].status, 'pending');

  for (const c of state.sideAgentCapsules) {
    if (c.hintTimer) clearTimeout(c.hintTimer);
    if (c.expireTimer) clearTimeout(c.expireTimer);
  }
});

test('D5: turnExecutionService - sendGroupMessage 严格走 groups.send', async () => {
  const { deps, state, groupRoomStore } = createMockTurnDeps({
    state: {
      activeFocus: { type: 'group', roomId: 'room-1' },
    },
  });
  const service = createTurnExecutionService(deps);

  await service.sendGroupMessage('room-1', '各位 Agent 好');

  assert.equal(groupRoomStore.sent.length, 1);
  assert.equal(groupRoomStore.sent[0].roomId, 'room-1');
  assert.equal(groupRoomStore.sent[0].text, '各位 Agent 好');
  const targetRoom = state.groupRooms.find((r) => r.roomId === 'room-1');
  assert.equal(targetRoom.lastMessage, '各位 Agent 好');

  service.getGroupPollerManager().stopAll();
});

test('D5: turnExecutionService - sendMessage 截断失败时原子恢复快照', async () => {
  const { deps, state, interactiveService } = createMockTurnDeps({
    state: {
      rollbackArmed: {
        sessionId: 'sess-1',
        anchor: { kind: 'row', rowId: 10 },
        snapshot: [
          { id: 'snap-1', role: 'user', content: '原提问' },
          { id: 'snap-2', role: 'assistant', content: '原回答' },
        ],
      },
    },
  });
  interactiveService.truncateAndSubmit = async () => {
    throw new Error('截断失败 502');
  };

  const service = createTurnExecutionService(deps);
  await service.sendMessage('重试发言');

  assert.equal(state.isStreaming, false);
  assert.equal(state.presenceTerminal?.kind, 'failed');
  assert.equal(state.messages.length, 2, '截断失败必须原子恢复快照，杜绝静默丢消息');
  assert.equal(state.messages[0].content, '原提问');
});
