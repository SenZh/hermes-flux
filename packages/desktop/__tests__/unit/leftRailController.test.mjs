import test from 'node:test';
import assert from 'node:assert/strict';
import { createLeftRailController } from '../../dist/renderer/events/leftRailController.mjs';

function createMockDeps(overrides = {}) {
  const state = {
    sessions: [
      { id: 'sess-1', title: '会话 1', updatedAt: Date.now() },
    ],
    groupRooms: [
      { roomId: 'room-1', name: '群聊 1', memberCount: 3 },
    ],
    profiles: [
      { name: 'bot-1', displayName: '助理 1' },
    ],
    activeSessionId: 'sess-1',
    activeFocus: { type: 'session', sessionId: 'sess-1' },
    profileName: 'default',
    sessionSearchQuery: '',
    isSessionsGroupExpanded: true,
    isGroupsGroupExpanded: true,
    sessionListError: undefined,
    leftRailCollapsed: false,
    editingGroupRoomId: undefined,
    profilesPhase: 'ready',
    sessionsPhase: 'ready',
    sessionContextMenu: null,
    newTaskModalTab: 'solo',
    isNewTaskModalOpen: false,
    ...(overrides.initialState || {}),
  };

  const toasts = [];
  const calls = [];

  const deps = {
    getState: () => state,
    render: () => { calls.push('render'); },
    t: (key, params) => `${key}:${JSON.stringify(params || {})}`,
    showToast: (msg) => { toasts.push(msg); },
    describeRpcError: (err) => String(err),
    getGatewayClient: () => ({ call: async () => ({}) }),
    groupRoomStore: {
      renameRoom: async (roomId, newName, client) => {
        calls.push({ action: 'renameRoom', roomId, newName });
      },
    },
    cancelColdStartFocus: () => { calls.push('cancelColdStartFocus'); },
    selectSession: (id, opts) => { calls.push({ action: 'selectSession', id, opts }); },
    openBotChat: (p) => { calls.push({ action: 'openBotChat', p }); },
    openGroupRoom: (r) => { calls.push({ action: 'openGroupRoom', r }); },
    fetchProjects: () => { calls.push('fetchProjects'); },
    fetchGroupRooms: async () => { calls.push('fetchGroupRooms'); },
    beginLeftRailResize: () => { calls.push('beginLeftRailResize'); },
    getActivityVariant: () => 'halo',
    activeRunningSessionIds: new Set(),
    unreadSessionIds: new Set(),
    getActiveStreamingStoredSessionId: () => null,
    activeRunningGroupRoomIds: new Set(),
    unreadGroupRoomIds: new Set(),
    activeRunningBotNames: new Set(),
    unreadBotNames: new Set(),
    resolveAgentAvatar: (name) => `avatar:${name}`,
    activityTransitionTracker: {
      resolveTransition: (scope, id, st) => ({
        state: st,
        transition: 'none',
        transitionToken: undefined,
      }),
    },
    ...overrides,
  };

  return { state, deps, toasts, calls };
}

test('LeftRailController: 动作派发与状态更新验证', async () => {
  const { state, deps, calls } = createMockDeps();
  const controller = createLeftRailController(deps);
  const actions = controller.createLeftRailActions();

  // 1. 选择会话
  actions.onSelectSession('sess-1', 'bot-1');
  assert.ok(calls.includes('cancelColdStartFocus'));
  assert.ok(calls.some((c) => c.action === 'selectSession' && c.id === 'sess-1'));

  // 2. 选择 Bot
  actions.onSelectBot('bot-1');
  assert.ok(calls.some((c) => c.action === 'openBotChat' && c.p === 'bot-1'));

  // 3. 选择群聊
  actions.onSelectGroup('room-1');
  assert.ok(calls.some((c) => c.action === 'openGroupRoom' && c.r === 'room-1'));

  // 4. 搜索框变更
  actions.onSearchChange('query-123');
  assert.equal(state.sessionSearchQuery, 'query-123');

  // 5. 快速新建任务
  actions.onNewChat('group');
  assert.equal(state.newTaskModalTab, 'group');
  assert.equal(state.isNewTaskModalOpen, true);

  // 6. 手风琴折叠
  actions.onToggleSessions();
  assert.equal(state.isSessionsGroupExpanded, false);
  actions.onToggleGroups();
  assert.equal(state.isGroupsGroupExpanded, false);

  // 7. 快照与实体装饰
  const sessions = controller.decorateRailSessions(Date.now());
  const groups = controller.decorateRailGroups(Date.now());
  const profiles = controller.decorateRailProfiles(Date.now());
  assert.equal(sessions.length, 1);
  assert.equal(groups.length, 1);
  assert.equal(profiles.length, 1);

  const snapshot = controller.getLeftRailSnapshot();
  assert.ok(snapshot);
  assert.ok(snapshot.model);
});

test('LeftRailController: confirmGroupRename 乐观更新、成功通知与回滚防线', async () => {
  // 成功分支
  const { state, deps, toasts } = createMockDeps();
  const controller = createLeftRailController(deps);

  await controller.confirmGroupRename('room-1', '新群名');
  assert.equal(state.groupRooms[0].name, '新群名');
  assert.ok(toasts.some((t) => t.includes('toast.groupRenamed')));

  // 失败分支：乐观回滚
  const failDeps = createMockDeps({
    groupRoomStore: {
      renameRoom: async () => {
        throw new Error('网络超时');
      },
    },
  });
  const failController = createLeftRailController(failDeps.deps);
  await failController.confirmGroupRename('room-1', '必定失败的新名字');
  assert.equal(failDeps.state.groupRooms[0].name, '群聊 1', '重命名失败必须精确回滚旧名称');
  assert.ok(failDeps.toasts.some((t) => t.includes('ctx.groupRenameFailed')));
});
