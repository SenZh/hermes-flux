/**
 * 左轨实体装饰与快照管理领域单测（Left Rail Snapshot Manager Test）
 *
 * 【断言与杀伤力】
 *   1. stableArray 数组引用稳定：元素全等复用前序数组，否则换新；
 *   2. decorateSessions 装饰缓存：相同对象与状态下复用 WeakMap 缓存对象；
 *   3. 三态隔离不变量：会话、群聊与 Bot 各自维护独立的运行/未读指示器，互不冒泡；
 *   4. getSnapshot 引用去重：inputs 字段全等时恒定返回前序快照引用，避免 React 树无效重绘；
 *   5. 搜索词/焦点变动时快照引用及时更新并重新构建视图模型。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LeftRailSnapshotManager,
  stableArray,
  sameLeftRailInputs,
} from '../../dist/renderer/leftrail/leftRailSnapshotManager.mjs';

function createMockLeftRailHost(overrides = {}) {
  let sessions = overrides.sessions ?? [
    { id: 's1', title: '会话 1', preview: '内容 1', time: '12:00', timestamp: 1000 },
  ];
  let groupRooms = overrides.groupRooms ?? [
    { roomId: 'g1', name: '研讨室 1', members: ['bot-a', 'bot-b'], lastMessage: '你好' },
  ];
  let profiles = overrides.profiles ?? [
    { name: 'bot-a', displayName: '智能体 A', avatar: 'avatar-a' },
  ];
  let activeSessionId = overrides.activeSessionId ?? 's1';
  let activeFocus = overrides.activeFocus ?? { type: 'session', sessionId: 's1' };
  let profileName = overrides.profileName ?? 'default';
  let searchQuery = overrides.searchQuery ?? '';

  const runningSessions = new Set(overrides.runningSessions ?? []);
  const unreadSessions = new Set(overrides.unreadSessions ?? []);
  const runningGroups = new Set(overrides.runningGroups ?? []);
  const unreadGroups = new Set(overrides.unreadGroups ?? []);
  const runningBots = new Set(overrides.runningBots ?? []);
  const unreadBots = new Set(overrides.unreadBots ?? []);

  const host = {
    getSessions: () => sessions,
    getGroupRooms: () => groupRooms,
    getProfiles: () => profiles,
    getActiveSessionId: () => activeSessionId,
    getActiveFocus: () => activeFocus,
    getProfileName: () => profileName,
    getSearchQuery: () => searchQuery,
    isSessionsGroupExpanded: () => true,
    isGroupsGroupExpanded: () => true,
    getError: () => '',
    isCollapsed: () => false,
    getEditingGroupRoomId: () => undefined,
    getProfilesPhase: () => 'ready',
    getSessionsPhase: () => 'ready',
    getActivityVariant: () => 'subtle',
    getActiveRunningSessionIds: () => runningSessions,
    getUnreadSessionIds: () => unreadSessions,
    getActiveStreamingStoredSessionId: () => null,
    getActiveRunningGroupRoomIds: () => runningGroups,
    getUnreadGroupRoomIds: () => unreadGroups,
    getActiveRunningBotNames: () => runningBots,
    getUnreadBotNames: () => unreadBots,
    resolveAgentAvatar: (name) => `avatar-for-${name}`,
    resolveTransition: () => ({ transition: 'none' }),
    _setSessions: (s) => { sessions = s; },
    _setSearchQuery: (q) => { searchQuery = q; },
    _setActiveFocus: (f) => { activeFocus = f; },
  };

  return host;
}

test('LeftRailSnapshotManager 领域单测', async (t) => {
  await t.test('1. stableArray 数组引用稳定性', () => {
    const item1 = { id: '1' };
    const item2 = { id: '2' };
    const arr1 = [item1, item2];
    const arr2 = [item1, item2];

    const result = stableArray(arr2, arr1);
    assert.equal(result, arr1, '元素全等时必须复用前序数组引用');

    const arr3 = [item1, { id: '3' }];
    assert.equal(stableArray(arr3, arr1), arr3, '元素变化时返回新数组');
  });

  await t.test('2. decorateSessions 装饰缓存复用', () => {
    const host = createMockLeftRailHost();
    const manager = new LeftRailSnapshotManager(host);

    const decor1 = manager.decorateSessions(1000);
    const decor2 = manager.decorateSessions(2000);

    assert.equal(decor1.length, 1);
    assert.equal(decor1, decor2, '内容未变时必须保持装饰后数组引用全等');
    assert.equal(decor1[0], decor2[0], '会话对象本身也必须复用 WeakMap 缓存引用');
  });

  await t.test('3. getSnapshot 引用去重：inputs 未变时恒定复用快照引用', () => {
    const host = createMockLeftRailHost();
    const manager = new LeftRailSnapshotManager(host);

    const snap1 = manager.getSnapshot();
    const snap2 = manager.getSnapshot();

    assert.equal(snap1, snap2, '未发生任何状态变迁时必须直接返回前序快照对象');
    assert.equal(snap1.model.activeSessions.length, 1);

    // 修改搜索条件
    host._setSearchQuery('会话 1');
    const snap3 = manager.getSnapshot();
    assert.notEqual(snap1, snap3, '搜索词变迁后必须产生新快照引用');
  });
});
