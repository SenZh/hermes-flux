/**
 * 消息加载、历史分页漫游与副标题同步服务（Message Loading Service）脱离 DOM 纯逻辑单测
 * (packages/desktop/__tests__/unit/messageLoadingService.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessageLoadingService } from '../../dist/renderer/services/messageLoadingService.mjs';

function createMockDeps(overrides = {}) {
  const sessionMessagesCache = new Map();
  const sessionPreviewCache = new Map();
  const botForeverChatCache = new Map();
  const activeRunningSessionIds = new Set();
  const unreadSessionIds = new Set();
  const rendered = [];

  let windowStart = 0;
  let windowEnd = 30;
  let userExpanded = false;

  const state = {
    activeSessionId: 'sess-1',
    activeLiveSessionId: 'live-1',
    profileName: 'default',
    profiles: [{ name: 'default', displayName: 'Default Bot' }],
    sessions: [
      { id: 'sess-1', title: 'Task 1', botName: 'default', timestamp: 100 },
      { id: 'sess-parent', title: 'Parent Task', botName: 'default', timestamp: 50 },
    ],
    messages: [],
    hasOlderMessages: false,
    isLoadingOlder: false,
    messagesPhase: 'ready',
    activeFocus: { type: 'session', sessionId: 'sess-1' },
    dockNotice: '',
    ...(overrides.state || {}),
  };

  const rpcCalls = [];
  const gatewayClient = overrides.gatewayClient ?? {
    call: async (method, params) => {
      rpcCalls.push({ method, params });
      return {};
    },
    fetchSessionMessages: async (sessionId, opts) => {
      rpcCalls.push({ method: 'fetchSessionMessages', sessionId, opts });
      return {
        status: 'success',
        messages: [
          { id: 'msg-older-1', row_id: 1, role: 'user', content: 'older prompt' },
          { id: 'msg-older-2', row_id: 2, role: 'assistant', content: 'older reply' },
        ],
        pagination: { returned: 2, total: 2 },
      };
    },
  };

  const deps = {
    getState: () => state,
    getGatewayClient: () => gatewayClient,
    render: () => { rendered.push(Date.now()); },
    sessionMessagesCache,
    cacheService: {
      openChannel: async () => ({ rows: [], fenceMax: 0 }),
      readOlderRows: async () => [],
      dropChannel: async () => {},
      applyRemoteWindow: async () => {},
    },
    persistMessagesToCache: () => {},
    syncPromptNavigatorMeta: () => {},
    syncPromptNavigatorFromScroll: () => {},
    scrollStreamToBottom: () => {},
    setPendingScrollToBottom: () => {},
    isStreamNearBottom: () => true,
    captureStreamAnchor: () => ({}),
    applyStreamAnchor: () => {},
    getMessageWindowStart: () => windowStart,
    setMessageWindowStart: (val) => { windowStart = val; },
    getMessageWindowEnd: () => windowEnd,
    setMessageWindowEnd: (val) => { windowEnd = val; },
    setMessageWindowUserExpanded: (val) => { userExpanded = val; },
    setCanvasStructureDirty: () => {},
    setSuppressPinBottomOnce: () => {},
    isGroupConversationActive: () => false,
    hostedRoomIds: new Set(['room-group-1']),
    formatSessionTime: (ts) => `time-${ts}`,
    formatTimestamp: (ts) => `ts-${ts}`,
    botActivityStore: {
      withActivityMap: (fn) => fn(new Map()),
      persist: () => {},
    },
    botForeverChatCache,
    sessionPreviewCache,
    persistSessionPreviewCache: () => {},
    getActiveStreamingStoredSessionId: () => null,
    defaultSessionHandleRegistry: {
      register: () => {},
      unregister: () => {},
      toStoredSessionId: (id) => id,
    },
    activeRunningSessionIds,
    activityTransitionTracker: { clear: () => {} },
    ...overrides,
  };

  return { deps, state, rpcCalls, rendered, sessionMessagesCache, sessionPreviewCache };
}

test('MessageLoadingService - 消息加载与游标管理测试', async (t) => {
  await t.test('1. parseRawMessages: 转换原始网关行为视图模型', async () => {
    const { deps } = createMockDeps();
    const service = createMessageLoadingService(deps);

    const vms = service.parseRawMessages([
      { id: '1', row_id: 1, role: 'user', content: 'hello' },
      { id: '2', row_id: 2, role: 'assistant', content: 'hi' },
    ]);

    assert.equal(vms.length, 2);
    assert.equal(vms[0].role, 'user');
    assert.equal(vms[0].content, 'hello');
    assert.equal(vms[0].rowId, 1);
  });

  await t.test('2. syncActiveSessionPreviewToRail: 正确反哺最后一条可见人类消息为副标题', async () => {
    const { deps, state, sessionPreviewCache } = createMockDeps();
    const service = createMessageLoadingService(deps);

    const messages = [
      { id: '1', role: 'user', content: 'User question', rawTimestamp: 1000 },
      { id: '2', role: 'assistant', content: 'Agent response message', rawTimestamp: 2000 },
      { id: '3', role: 'system', displayKind: 'hidden', content: 'internal telemetry', rawTimestamp: 3000 },
    ];

    service.syncActiveSessionPreviewToRail('sess-1', messages, 'default');

    const sess = state.sessions.find((s) => s.id === 'sess-1');
    assert.equal(sess?.preview, 'Agent response message', '预览必须是最后一条非 hidden 真实内容');
    assert.equal(sess?.timestamp, 2000, '时间戳必须与最后一条可见人类消息对齐');
    const cached = sessionPreviewCache.get('sess-1');
    assert.equal(cached?.text, 'Agent response message', '缓存也必须记录权威副标题');
  });

  await t.test('3. forgetOlderCursorState: 彻底清理 offset 与 overshootRetry 状态', async () => {
    const { deps } = createMockDeps();
    const service = createMessageLoadingService(deps);

    service.sessionServerOffset.set('sess-1', 100);
    service.sessionAuthoritativeOffset.set('sess-1', 100);
    service.sessionOvershootRetry.add('sess-1:sess-1');
    service.sessionOvershootRetry.add('sess-other:sess-other');

    service.forgetOlderCursorState('sess-1');

    assert.equal(service.sessionServerOffset.has('sess-1'), false);
    assert.equal(service.sessionAuthoritativeOffset.has('sess-1'), false);
    assert.equal(service.sessionOvershootRetry.has('sess-1:sess-1'), false);
    assert.equal(service.sessionOvershootRetry.has('sess-other:sess-other'), true, '其它会话游标标记不得误删');
  });

  await t.test('4. syncUntrustedCacheOrderFlag: 识别旧版未排序缓存行', async () => {
    const { deps } = createMockDeps();
    const service = createMessageLoadingService(deps);

    service.syncUntrustedCacheOrderFlag('sess-clean', [{ orderKey: 1, displaySeq: 1 }]);
    assert.equal(service.untrustedOrderCacheSessions.has('sess-clean'), false, '具备合法 displaySeq 为干净缓存');

    service.syncUntrustedCacheOrderFlag('sess-dirty', [{ orderKey: 1 }]);
    assert.equal(service.untrustedOrderCacheSessions.has('sess-dirty'), true, '缺少 displaySeq 必须标记为不可信');
  });

  await t.test('5. loadMessages: 命中内存缓存时 0ms 呈现并收敛状态', async () => {
    const { deps, state, sessionMessagesCache } = createMockDeps();
    const cachedList = [
      { id: 'c1', rowId: 1, role: 'user', content: 'cached user' },
      { id: 'c2', rowId: 2, role: 'assistant', content: 'cached agent' },
    ];
    sessionMessagesCache.set('sess-1', cachedList);
    const service = createMessageLoadingService(deps);

    await service.loadMessages('sess-1');

    assert.equal(state.messages.length, 2, '必须立即上屏缓存消息');
    assert.equal(state.messagesPhase, 'ready', '缓存命中必须立即收敛为 ready 相位');
  });

  await t.test('6. loadOlderMessages: 群聊房间直接拦截，坚决不打单会话 REST', async () => {
    const { deps, state, rpcCalls } = createMockDeps();
    state.activeSessionId = 'room-group-1'; // 属于 hostedRoomIds
    const service = createMessageLoadingService(deps);

    await service.loadOlderMessages();

    assert.equal(rpcCalls.length, 0, '群聊研讨室绝对禁止发起单会话向早分页 REST');
    assert.equal(state.isLoadingOlder, false, '加载状态必须同步关闭');
  });
});
