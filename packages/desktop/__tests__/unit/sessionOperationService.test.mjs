/**
 * 会话生命周期与设置切换服务（Session Operation Service）脱离 DOM 纯逻辑单测
 * (packages/desktop/__tests__/unit/sessionOperationService.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionOperationService } from '../../dist/renderer/services/sessionOperationService.mjs';
import { SessionListGeneration, RpcErrorCode } from '@hermes-flux/core';

function createMockDeps(overrides = {}) {
  let promptInputValue = '';
  const storageMap = new Map();
  const sessionMessagesCache = new Map();
  const sessionDraftsMap = new Map();
  const toasts = [];
  const rendered = [];

  const state = {
    activeSessionId: 'sess-current',
    activeLiveSessionId: 'live-current',
    profileName: 'default',
    profiles: [{ name: 'default', displayName: 'Default Bot' }],
    sessions: [
      { id: 'sess-current', title: 'Current Task', botName: 'default', isArchived: false },
      { id: 'sess-next', title: 'Next Task', botName: 'default', isArchived: false },
    ],
    projects: [{ id: 'proj-1', path: '/workspace/project-1' }],
    pendingSessionIds: [],
    messages: [
      { id: 'm1', role: 'user', content: 'hello', timestamp: '12:00' },
      { id: 'm2', role: 'assistant', content: 'world', timestamp: '12:01' },
      { id: 'm3', role: 'system', displayKind: 'hidden', content: 'internal', timestamp: '12:02' },
    ],
    selectedModel: 'gpt-4o',
    currentProvider: 'openai',
    recentModels: [],
    reasoningLevel: 'default',
    approvalMode: 'manual',
    dockNotice: '',
    modelMenuOpen: false,
    isStreaming: false,
    activeFocus: { type: 'session', sessionId: 'sess-current' },
    rollbackArmed: null,
    gatewayUrl: 'http://127.0.0.1:8080',
    ...(overrides.state || {}),
  };

  const rpcCalls = [];
  const gatewayClient = overrides.gatewayClient ?? {
    call: async (method, params) => {
      rpcCalls.push({ method, params });
      if (method === 'session.create') {
        return { session_id: 'sess-new', id: 'sess-new', live_id: 'live-new' };
      }
      if (method === 'session.delete') {
        return { ok: true };
      }
      if (method === 'session.title') {
        return { ok: true };
      }
      if (method === 'session.archive') {
        return { ok: true };
      }
      if (method === 'config.set') {
        return { ok: true };
      }
      return {};
    },
    fetchSessionMessages: async () => ({ status: 'success', messages: [] }),
  };

  const deps = {
    getState: () => state,
    getGatewayClient: () => gatewayClient,
    getDesktopApi: () => undefined,
    getCurrentTicket: () => 'ticket-123',
    getEffectiveUrl: (url) => url || 'http://127.0.0.1:8080',
    render: () => { rendered.push(Date.now()); },
    t: (key, params) => `${key}:${JSON.stringify(params || {})}`,
    showToast: (msg) => { toasts.push(msg); },
    setTimedDockNotice: (msg) => { state.dockNotice = msg; },
    restoreComposerFocus: () => {},
    sessionDrafts: {
      get: (id) => sessionDraftsMap.get(id) || '',
      set: (id, val) => { sessionDraftsMap.set(id, val); },
      delete: (id) => { sessionDraftsMap.delete(id); },
      has: (id) => sessionDraftsMap.has(id),
    },
    sessionMessagesCache,
    unreadSessionIds: new Set(),
    activeRunningSessionIds: new Set(),
    activityTransitionTracker: { clear: () => {} },
    sessionHandleRegistry: {
      register: () => {},
      unregister: () => {},
      toStoredSessionId: (id) => id,
    },
    cacheService: {
      dropChannel: async () => {},
      writeSessions: async () => {},
    },
    persistSessionsToCache: () => {},
    forgetOlderCursorState: () => {},
    sessionListGeneration: new SessionListGeneration(),
    getActiveStreamingStoredSessionId: () => null,
    resetActiveStreamingState: () => { state.isStreaming = false; },
    setPendingScrollToBottom: () => {},
    setLastMessagesSnapshot: () => {},
    loadMessages: async () => {},
    openBotChat: async () => {},
    ensureLiveSessionId: async () => 'live-resolved',
    fetchSessions: async () => {},
    incrementActiveLoadMessagesGeneration: () => 1,
    getPromptInputValue: () => promptInputValue,
    setPromptInputValue: (val) => { promptInputValue = val; },
    focusPromptInput: () => {},
    promptDialog: (_title, defaultVal) => `${defaultVal} Renamed`,
    writeClipboardText: async (text) => { storageMap.set('clipboard', text); },
    storage: {
      getItem: (k) => storageMap.get(k) || null,
      setItem: (k, v) => { storageMap.set(k, v); },
    },
    ...overrides,
  };

  return { deps, state, rpcCalls, toasts, rendered, storageMap, sessionDraftsMap };
}

test('SessionOperationService - 核心生命周期与状态切换测试', async (t) => {
  await t.test('1. createNewSession: 暂存当前草稿、发起 session.create 并重置焦点与输入框', async () => {
    const enters = [];
    const { deps, state, rpcCalls } = createMockDeps({
      beginSessionEnter: (id, options) => enters.push({ id, options }),
    });
    deps.setPromptInputValue('未发送的当前草稿');
    const service = createSessionOperationService(deps);

    await service.createNewSession({ profile: 'default', title: '新建测试任务' });

    assert.equal(deps.sessionDrafts.get('sess-current'), '未发送的当前草稿', '切出会话前草稿必须被暂存');
    assert.equal(rpcCalls.some((c) => c.method === 'session.create'), true, '必须调用 session.create');
    assert.equal(state.activeSessionId, 'sess-new', 'activeSessionId 必须更新为新会话');
    assert.deepEqual(enters, [{ id: 'sess-new', options: { forcePinToBottom: true } }], '新建会话必须强制贴底');
    assert.equal(deps.getPromptInputValue(), '', '新会话输入框必须清空');
  });

  await t.test('2. deleteSession: 正确注销实体并平滑将焦点移交下一会话', async () => {
    const { deps, state } = createMockDeps();
    const service = createSessionOperationService(deps);

    await service.deleteSession('sess-current');

    assert.equal(state.sessions.some((s) => s.id === 'sess-current'), false, '已删会话必须从列表中移除');
    assert.equal(state.activeSessionId, 'sess-next', '删除当前活动会话后焦点平滑切换至下一会话');
  });

  await t.test('3. selectSession: 非破坏性草稿恢复，敲入新字时不被旧草稿覆盖，且离开前捕获锚点', async () => {
    let capturedAnchors = 0;
    const enters = [];
    const { deps, state } = createMockDeps({
      captureStreamAnchor: () => { capturedAnchors += 1; },
      beginSessionEnter: (id, options) => { enters.push({ id, options }); },
    });
    deps.sessionDrafts.set('sess-next', '旧会话草稿内容');
    const service = createSessionOperationService(deps);

    // 场景 A: 输入框为空时恢复草稿，且离开 sess-current 时调用 captureStreamAnchor
    deps.setPromptInputValue('');
    await service.selectSession('sess-next');
    assert.equal(capturedAnchors, 1, '切离活动会话前必须调用 captureStreamAnchor 捕获快照');
    assert.deepEqual(enters[0], { id: 'sess-next', options: undefined }, '切会话必须锁存进入计划');
    assert.equal(deps.getPromptInputValue(), '旧会话草稿内容', '空输入框切入时必须恢复旧草稿');

    // 场景 B: 用户已经键入文字时不被冲刷
    deps.sessionDrafts.set('sess-current', '更旧草稿');
    deps.setPromptInputValue('正在实时输入的文字');
    await service.selectSession('sess-current');
    assert.equal(capturedAnchors, 2, '再次切离会话时继续捕获快照');
    assert.equal(deps.getPromptInputValue(), '正在实时输入的文字', '非空输入框绝对不可被草稿冲刷');
  });

  await t.test('4. exportMarkdown: 导出口径与视图一致，过滤 hidden 机器行', async () => {
    const { deps, storageMap, toasts } = createMockDeps();
    const service = createSessionOperationService(deps);

    await service.exportMarkdown('sess-current');

    const exported = storageMap.get('clipboard') || '';
    assert.ok(exported.includes('hello'), '必须包含普通消息');
    assert.ok(exported.includes('world'), '必须包含助手消息');
    assert.equal(exported.includes('internal'), false, 'displayKind=hidden 的机器行绝对不得导出');
    assert.ok(toasts.length > 0, '导出完成后必须触发 Toast 反馈');
  });

  await t.test('5. pinSession & archiveSession: 列表顺序与归档标记正确更新', async () => {
    const { deps, state, rpcCalls } = createMockDeps();
    const service = createSessionOperationService(deps);

    await service.pinSession('sess-next');
    assert.equal(state.sessions[0].id, 'sess-next', '置顶项必须移动至首位');

    await service.archiveSession('sess-next');
    assert.equal(rpcCalls.some((c) => c.method === 'session.archive'), true, '必须调用 session.archive');
    const target = state.sessions.find((s) => s.id === 'sess-next');
    assert.equal(target?.isArchived, true, 'isArchived 状态必须乐观翻转');
  });

  await t.test('6. switchModel / switchReasoning: 群聊视口严格拦截向单聊发 config.set', async () => {
    const { deps, state, rpcCalls } = createMockDeps();
    state.activeFocus = { type: 'group', roomId: 'room-123' };
    const service = createSessionOperationService(deps);

    await service.switchModel('claude-3-5-sonnet');
    await service.switchReasoning('high');

    const configCalls = rpcCalls.filter((c) => c.method === 'config.set');
    assert.equal(configCalls.length, 0, '群聊视口中切换模型与思考级别绝对禁止向 session 发送 config.set');
    assert.equal(state.selectedModel, 'claude-3-5-sonnet', '客户端模型选择器状态仍应正确记录');
    assert.equal(state.reasoningLevel, 'high', '客户端思考级别状态仍应正确记录');
  });

  await t.test('7. disarmRollbackOnLeave: 离开会话时回滚快照安全恢复到原会话缓存', async () => {
    const { deps, state } = createMockDeps();
    state.rollbackArmed = {
      sessionId: 'sess-current',
      targetRowId: 10,
      targetMessageId: 'm10',
      snapshot: [{ id: 'm-restored', content: 'restored' }],
    };
    const service = createSessionOperationService(deps);

    service.disarmRollbackOnLeave('sess-current');

    assert.equal(state.rollbackArmed, null, '挂起回滚状态必须清空');
    const restored = deps.sessionMessagesCache.get('sess-current');
    assert.equal(restored?.length, 1, '快照必须被安全恢复到原会话缓存中');
  });

  await t.test('8. selectSession: 切回仍在流式运行且包含工具调用的会话时自动补排 scheduleToolPatch', async () => {
    const patchedIds = [];
    const { deps, state } = createMockDeps({
      getActiveStreamingStoredSessionId: () => 'sess-next',
      getActiveStreamingMessageId: () => 'ast-stream-1',
      scheduleToolPatch: (mid) => { patchedIds.push(mid); },
      loadMessages: async () => {
        state.messages = [
          {
            id: 'ast-stream-1',
            role: 'assistant',
            content: 'working...',
            toolCalls: [{ id: 'tc-1', name: 'terminal', status: 'running', args: '{}' }],
          },
        ];
      },
    });
    const service = createSessionOperationService(deps);

    await service.selectSession('sess-next');
    assert.equal(state.isStreaming, true);
    assert.deepEqual(patchedIds, ['ast-stream-1'], '切回流式运行且带工具调用的会话必须补刷 toolPatch');

    // 切回流式运行但无工具调用的会话：不得多余调度 scheduleToolPatch
    patchedIds.length = 0;
    const { deps: depsNoTools, state: stateNoTools } = createMockDeps({
      getActiveStreamingStoredSessionId: () => 'sess-next',
      getActiveStreamingMessageId: () => 'ast-stream-2',
      scheduleToolPatch: (mid) => { patchedIds.push(mid); },
      loadMessages: async () => {
        stateNoTools.messages = [{ id: 'ast-stream-2', role: 'assistant', content: 'plain' }];
      },
    });
    const serviceNoTools = createSessionOperationService(depsNoTools);
    await serviceNoTools.selectSession('sess-next');
    assert.deepEqual(patchedIds, [], '无工具调用时不触发 scheduleToolPatch');

    // 非流式会话（活跃流式会话是别的 id）即使存在带工具的活跃消息，也不得调度
    patchedIds.length = 0;
    const { deps: depsIdle, state: stateIdle } = createMockDeps({
      getActiveStreamingStoredSessionId: () => 'sess-other',
      getActiveStreamingMessageId: () => 'ast-idle-1',
      scheduleToolPatch: (mid) => { patchedIds.push(mid); },
      loadMessages: async () => {
        stateIdle.messages = [
          {
            id: 'ast-idle-1',
            role: 'assistant',
            content: 'done',
            toolCalls: [{ id: 'tc-9', name: 'terminal', status: 'completed', args: '{}' }],
          },
        ];
      },
    });
    const serviceIdle = createSessionOperationService(depsIdle);
    await serviceIdle.selectSession('sess-next');
    assert.equal(stateIdle.isStreaming, false, '活跃流式会话是其它 id 时本会话必须判为非流式');
    assert.deepEqual(patchedIds, [], '非流式会话选择不得调度 scheduleToolPatch（否则会覆写 React 已收口子树）');

    // 流式会话但活跃消息 ID 缺失：不得调度
    patchedIds.length = 0;
    const { deps: depsNoId, state: stateNoId } = createMockDeps({
      getActiveStreamingStoredSessionId: () => 'sess-next',
      getActiveStreamingMessageId: () => null,
      scheduleToolPatch: (mid) => { patchedIds.push(mid); },
      loadMessages: async () => {
        stateNoId.messages = [{ id: 'ast-x', role: 'assistant', content: 'x' }];
      },
    });
    await createSessionOperationService(depsNoId).selectSession('sess-next');
    assert.deepEqual(patchedIds, [], '无活跃流式消息 ID 时不得调度');

    // 流式会话且活跃消息 ID 指向不存在的消息：不得调度
    patchedIds.length = 0;
    const { deps: depsMiss, state: stateMiss } = createMockDeps({
      getActiveStreamingStoredSessionId: () => 'sess-next',
      getActiveStreamingMessageId: () => 'ast-missing',
      scheduleToolPatch: (mid) => { patchedIds.push(mid); },
      loadMessages: async () => {
        stateMiss.messages = [{ id: 'ast-x', role: 'assistant', content: 'x' }];
      },
    });
    await createSessionOperationService(depsMiss).selectSession('sess-next');
    assert.deepEqual(patchedIds, [], '活跃消息不在当前消息列表时不得调度');

    // 流式会话且工具数组为空：不得调度
    patchedIds.length = 0;
    const { deps: depsEmpty, state: stateEmpty } = createMockDeps({
      getActiveStreamingStoredSessionId: () => 'sess-next',
      getActiveStreamingMessageId: () => 'ast-empty',
      scheduleToolPatch: (mid) => { patchedIds.push(mid); },
      loadMessages: async () => {
        stateEmpty.messages = [{ id: 'ast-empty', role: 'assistant', content: 'x', toolCalls: [] }];
      },
    });
    await createSessionOperationService(depsEmpty).selectSession('sess-next');
    assert.deepEqual(patchedIds, [], '工具数组为空时不得调度');
  });
});
