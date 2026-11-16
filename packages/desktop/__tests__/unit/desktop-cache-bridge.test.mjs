import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatSessionTime,
  toNormalizedSession,
  toCachedSession,
  toLeftRailGroupRoom,
  toCachedGroup,
  toMessageViewModel,
  toCachedMessage,
  toAgentProfile,
  IndexWriteQueue,
  persistMessagesToCache,
  persistSessionsToCache,
  persistGroupsToCache,
  persistAgentsToCache,
  persistTurnToCache,
} from '../../dist/renderer/cache/desktopCacheBridge.mjs';

test('DesktopCacheBridge 客户端缓存双向桥接测试套件', async (t) => {
  await t.test('1. toNormalizedSession 与 toCachedSession 往返双向保真', () => {
    const original = {
      id: 'session-123',
      profile: 'bot-alpha',
      kind: 'session',
      title: '架构重构研讨',
      preview: '第一步先引入变异测试',
      timestamp: 1_700_000_000_000,
      isArchived: false,
      hidden: false,
      pinned: true,
      unread: true,
      botName: 'bot-alpha',
      projectId: 'proj-omega',
    };

    const vm = toNormalizedSession(original);
    assert.equal(vm.id, 'session-123');
    assert.equal(vm.title, '架构重构研讨');
    assert.equal(vm.pinned, true);
    assert.equal(vm.botName, 'bot-alpha');
    assert.equal(vm.projectId, 'proj-omega');
    assert.ok(vm.time.length > 0, '时间必须经过本地化格式化');

    const back = toCachedSession(vm, 'fallback-bot');
    assert.equal(back.id, original.id);
    assert.equal(back.profile, 'bot-alpha');
    assert.equal(back.title, original.title);
    assert.equal(back.pinned, true);
    assert.equal(back.projectId, 'proj-omega');
  });

  await t.test('2. toLeftRailGroupRoom 与 toCachedGroup 成员与元数据一致', () => {
    const groupRow = {
      id: 'room-456',
      profile: '',
      kind: 'group',
      title: '多 Agent 群聊舱',
      timestamp: 1_700_000_100_000,
      members: ['bot-a', 'bot-b'],
      memberCount: 2,
    };

    const room = toLeftRailGroupRoom(groupRow);
    assert.equal(room.roomId, 'room-456');
    assert.equal(room.name, '多 Agent 群聊舱');
    assert.deepEqual(room.members, ['bot-a', 'bot-b']);

    const back = toCachedGroup(room);
    assert.equal(back.id, 'room-456');
    assert.equal(back.profile, '', '群聊 profile 必须为空串');
    assert.equal(back.kind, 'group');
    assert.deepEqual(back.members, ['bot-a', 'bot-b']);
  });

  await t.test('3. toCachedMessage 严格防范临时主键（无持久化 orderKey 绝不落盘）', () => {
    const ref = { profile: 'bot-a', channel: 'session', channelId: 'ses-1' };

    // 场景 A: 临时前台消息 (无 rowId)
    const tempMsg = {
      id: 'usr-temp-1',
      role: 'user',
      content: '临时未决消息',
    };
    assert.equal(toCachedMessage(tempMsg, ref), null, '临时主键不得落盘');

    // 场景 B: 权威持久化消息 (含数值型 rowId)
    const durableMsg = {
      id: 'msg-real-1',
      rowId: 42,
      role: 'assistant',
      content: '权威回复',
      thought: '思考过程',
      rawTimestamp: 1_700_000_200_000,
      displayKind: 'assistant',
    };
    const row = toCachedMessage(durableMsg, ref);
    assert.ok(row !== null);
    assert.equal(row.orderKey, 42);
    assert.equal(row.text, '权威回复');
    assert.equal(row.reasoning, '思考过程');
    assert.equal(row.status, 'complete');

    // 场景 C: 从 row 还原为 ViewModel
    const restoredVm = toMessageViewModel(row);
    assert.equal(restoredVm.rowId, 42);
    assert.equal(restoredVm.content, '权威回复');
    assert.equal(restoredVm.thought, '思考过程');
  });

  await t.test('4. persistMessagesToCache 强隔离会话分桶（父会话血缘消息不得写入当前桶）', () => {
    const ref = { profile: 'bot-a', channel: 'session', channelId: 'active-session-1' };
    const messages = [
      { id: '1', rowId: 101, role: 'user', content: '属于本会话', sessionId: 'active-session-1' },
      { id: '2', rowId: 102, role: 'assistant', content: '来自分叉父会话的血缘历史', sessionId: 'parent-session-9' },
      { id: '3', rowId: 103, role: 'assistant', content: '未标明会话的本窗口消息' },
    ];

    let appliedRows = [];
    const mockCacheService = {
      applyRemoteWindow: async (_ref, rows, _fenceMax) => {
        appliedRows = rows;
      },
    };

    persistMessagesToCache(ref, messages, 200, mockCacheService);
    assert.equal(appliedRows.length, 2, '外来父会话消息必须被完全过滤');
    assert.equal(appliedRows[0].orderKey, 101);
    assert.equal(appliedRows[1].orderKey, 103);
    assert.equal(appliedRows[0].displaySeq, 1);
    assert.equal(appliedRows[1].displaySeq, 2);
  });

  await t.test('5. IndexWriteQueue 保证写入串行，防止并发冲刷', async () => {
    const queue = new IndexWriteQueue();
    const executionOrder = [];

    const p1 = new Promise((resolve) => {
      queue.enqueue(async () => {
        await new Promise((r) => setTimeout(r, 20));
        executionOrder.push(1);
        resolve();
      });
    });

    const p2 = new Promise((resolve) => {
      queue.enqueue(async () => {
        executionOrder.push(2);
        resolve();
      });
    });

    await Promise.all([p1, p2]);
    assert.deepEqual(executionOrder, [1, 2], '索引写入必须严格保证 FIFO 串行');
  });

  await t.test('6. persistTurnToCache 处理群聊与单聊的分桶语义', () => {
    let appendedRef = null;
    let appendedRows = [];
    const mockCacheService = {
      appendRows: async (ref, rows) => {
        appendedRef = ref;
        appendedRows = rows;
      },
    };

    const messages = [
      { id: 'm1', rowId: 99, role: 'assistant', content: '回合回复' },
    ];

    // 场景 A: 群聊
    persistTurnToCache('room-1', 'bot-x', messages, mockCacheService, true, 'bot-x');
    assert.equal(appendedRef.channel, 'room');
    assert.equal(appendedRef.profile, '');
    assert.equal(appendedRows.length, 1);

    // 场景 B: 专职 Bot 单聊
    persistTurnToCache('ses-2', 'bot-master', messages, mockCacheService, false, 'bot-master');
    assert.equal(appendedRef.channel, 'session');
    assert.equal(appendedRef.profile, 'bot-master');
  });
});
