import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureGroupLogBaseline,
  hasNewAssistantReply,
  GroupLogPollerManager,
} from '../../dist/group/groupLogPollerManager.js';

function createFakeScheduler() {
  let nextHandle = 1;
  const timers = new Map();

  async function flushMicrotasks(rounds = 8) {
    for (let i = 0; i < rounds; i += 1) {
      await Promise.resolve();
    }
  }

  return {
    scheduler: {
      setTimeout(fn, ms) {
        const handle = nextHandle++;
        timers.set(handle, { fn, ms });
        return handle;
      },
      clearTimeout(handle) {
        timers.delete(handle);
      },
    },
    pendingCount() {
      return timers.size;
    },
    pendingDelays() {
      return [...timers.values()].map((entry) => entry.ms);
    },
    async runNext() {
      const next = timers.entries().next();
      if (next.done) return null;
      const [handle, entry] = next.value;
      timers.delete(handle);
      entry.fn();
      await flushMicrotasks();
      return entry.ms;
    },
    flushMicrotasks,
  };
}

test('captureGroupLogBaseline 与 hasNewAssistantReply - 基线采集与反退化判定', async (t) => {
  await t.test('1. 仅新增一条 user 消息使 count 与 seq 加 1，绝不误判为助手回复', () => {
    const initial = [
      { messageId: 'u1', seq: 1, actorKind: 'user', senderProfile: 'user' },
      { messageId: 'a1', seq: 2, actorKind: 'member', senderProfile: 'architect' },
    ];
    const baseline = captureGroupLogBaseline(initial);
    assert.deepEqual(baseline, {
      knownCount: 2,
      lastSeq: 2,
      lastAssistantMessageId: 'a1',
    });

    const withNewUser = [
      ...initial,
      { messageId: 'u2', seq: 3, actorKind: 'user', senderProfile: 'user' },
    ];
    assert.equal(
      hasNewAssistantReply(withNewUser, baseline),
      false,
      '新落盘用户消息不得触发完成（防 lastCount = -1 退化）'
    );

    const withActorUserOnly = [
      ...initial,
      { messageId: 'u3', seq: 4, actorKind: 'user', senderProfile: 'alice' },
    ];
    assert.equal(
      hasNewAssistantReply(withActorUserOnly, baseline),
      false,
      'actorKind === user 即使 senderProfile 非 user 也不得视为助手回复'
    );

    const withSenderUserOnly = [
      ...initial,
      { messageId: 'u4', seq: 5, senderProfile: 'user' },
    ];
    assert.equal(
      hasNewAssistantReply(withSenderUserOnly, baseline),
      false,
      'senderProfile === user 即使缺失 actorKind 也不得视为助手回复'
    );
  });

  await t.test('2. 新增非 user 消息（按切片/seq/messageId 任一命中）返回 true', () => {
    const baseline = captureGroupLogBaseline([
      { messageId: 'u1', seq: 1, actorKind: 'user', senderProfile: 'user' },
    ]);
    assert.equal(baseline.lastAssistantMessageId, null);

    assert.equal(
      hasNewAssistantReply(
        [
          { messageId: 'u1', seq: 1, actorKind: 'user', senderProfile: 'user' },
          { messageId: 'a1', seq: 2, actorKind: 'member', senderProfile: 'reviewer' },
        ],
        baseline
      ),
      true
    );

    assert.equal(
      hasNewAssistantReply(
        [{ messageId: 'a2', seq: 2, actorKind: 'member', senderProfile: 'reviewer' }],
        baseline
      ),
      true,
      '窗口裁剪导致总数未增但 seq/messageId 推进时仍须识别新回复'
    );
  });
});

test('GroupLogPollerManager - 仅发用户消息绝不误判完成，直至助手消息落地', async () => {
  const fake = createFakeScheduler();
  const initialLogs = [
    { messageId: 'u1', seq: 1, actorKind: 'user', senderProfile: 'user' },
  ];
  const baseline = captureGroupLogBaseline(initialLogs);

  let serverLogs = [...initialLogs];
  const synced = [];
  const completed = [];
  const failed = [];

  const poller = new GroupLogPollerManager({
    scheduler: fake.scheduler,
    fetchLogs: async () => serverLogs,
    isFocused: () => false,
    onSyncLogs: (roomId, logs) => synced.push({ roomId, count: logs.length }),
    onCompleted: (roomId, isFocused) => completed.push({ roomId, isFocused }),
    onFailed: (roomId) => failed.push(roomId),
  });

  poller.startAwaitReply('room-1', baseline);
  assert.equal(poller.isPolling('room-1'), true);

  serverLogs = [
    ...initialLogs,
    { messageId: 'u2', seq: 2, actorKind: 'user', senderProfile: 'user' },
  ];
  await fake.runNext();
  assert.equal(completed.length, 0, '仅见 user 消息 count+1 绝不可调用 onCompleted');
  assert.equal(failed.length, 0);
  assert.equal(poller.isPolling('room-1'), true);

  serverLogs = [
    ...serverLogs,
    { messageId: 'a1', seq: 3, actorKind: 'member', senderProfile: 'architect' },
  ];
  await fake.runNext();
  assert.deepEqual(completed, [{ roomId: 'room-1', isFocused: false }]);
  assert.equal(synced.length, 2);
  assert.equal(poller.isPolling('room-1'), false);
});

test('GroupLogPollerManager - 多房间并发轮询物理隔离互不取消', async () => {
  const fake = createFakeScheduler();
  const logsByRoom = new Map([
    ['room-a', [{ messageId: 'ua0', seq: 1, actorKind: 'user', senderProfile: 'user' }]],
    ['room-b', [{ messageId: 'ub0', seq: 1, actorKind: 'user', senderProfile: 'user' }]],
  ]);
  const completed = [];

  const poller = new GroupLogPollerManager({
    scheduler: fake.scheduler,
    fetchLogs: async (roomId) => logsByRoom.get(roomId) ?? [],
    isFocused: (roomId) => roomId === 'room-b',
    onSyncLogs: () => {},
    onCompleted: (roomId, isFocused) => completed.push({ roomId, isFocused }),
    onFailed: () => {},
  });

  poller.startAwaitReply('room-a', captureGroupLogBaseline(logsByRoom.get('room-a')));
  poller.startAwaitReply('room-b', captureGroupLogBaseline(logsByRoom.get('room-b')));

  assert.equal(poller.isPolling('room-a'), true);
  assert.equal(poller.isPolling('room-b'), true);
  assert.equal(fake.pendingCount(), 2, '两个房间各自持有独立定时任务');

  logsByRoom.set('room-a', [
    ...logsByRoom.get('room-a'),
    { messageId: 'aa1', seq: 2, actorKind: 'member', senderProfile: 'qa' },
  ]);
  await fake.runNext();
  assert.deepEqual(completed, [{ roomId: 'room-a', isFocused: false }]);
  assert.equal(poller.isPolling('room-a'), false);
  assert.equal(poller.isPolling('room-b'), true, 'room-a 结束绝不得影响 room-b 继续轮询');

  poller.stop('room-b');
  assert.equal(poller.isPolling('room-b'), false);
  assert.equal(fake.pendingCount(), 0);
});

test('GroupLogPollerManager - 同房间重入 CAS 废弃在途过期 fetchLogs', async () => {
  const fake = createFakeScheduler();
  const pendingResolvers = [];
  const synced = [];
  const completed = [];
  const failed = [];

  const poller = new GroupLogPollerManager({
    scheduler: fake.scheduler,
    fetchLogs: () =>
      new Promise((resolve) => {
        pendingResolvers.push(resolve);
      }),
    isFocused: () => false,
    onSyncLogs: (roomId, logs) => synced.push({ roomId, logs }),
    onCompleted: (roomId, isFocused) => completed.push({ roomId, isFocused }),
    onFailed: (roomId) => failed.push(roomId),
  });

  const baseline1 = captureGroupLogBaseline([]);
  poller.startAwaitReply('room-x', baseline1);
  await fake.runNext();
  assert.equal(pendingResolvers.length, 1);

  const baseline2 = captureGroupLogBaseline([
    { messageId: 'a-old', seq: 5, actorKind: 'member', senderProfile: 'architect' },
  ]);
  poller.startAwaitReply('room-x', baseline2);

  pendingResolvers[0]([
    { messageId: 'a-stale', seq: 2, actorKind: 'member', senderProfile: 'architect' },
  ]);
  await fake.flushMicrotasks();

  assert.equal(synced.length, 0, '旧 generation 的过期响应严禁回写 onSyncLogs');
  assert.equal(completed.length, 0, '旧 generation 的过期响应严禁误判完成');
  assert.equal(failed.length, 0);
  assert.equal(poller.isPolling('room-x'), true);

  await fake.runNext();
  assert.equal(pendingResolvers.length, 2);
  pendingResolvers[1]([
    { messageId: 'a-old', seq: 5, actorKind: 'member', senderProfile: 'architect' },
    { messageId: 'a-fresh', seq: 6, actorKind: 'member', senderProfile: 'reviewer' },
  ]);
  await fake.flushMicrotasks();

  assert.equal(synced.length, 1);
  assert.deepEqual(completed, [{ roomId: 'room-x', isFocused: false }]);
  assert.equal(poller.isPolling('room-x'), false);
});

test('GroupLogPollerManager - 聚焦态多 Agent 接力观察与去重结算', async () => {
  const fake = createFakeScheduler();
  let serverLogs = [
    { messageId: 'u1', seq: 1, actorKind: 'user', senderProfile: 'user' },
  ];
  const baseline = captureGroupLogBaseline(serverLogs);
  const syncedCounts = [];
  const completed = [];
  const failed = [];

  const poller = new GroupLogPollerManager({
    scheduler: fake.scheduler,
    fetchLogs: async () => serverLogs,
    isFocused: () => true,
    onSyncLogs: (_roomId, logs) => syncedCounts.push(logs.length),
    onCompleted: (roomId, isFocused) => completed.push({ roomId, isFocused }),
    onFailed: (roomId) => failed.push(roomId),
  });

  poller.startAwaitReply('room-focus', baseline);

  serverLogs = [
    ...serverLogs,
    { messageId: 'a1', seq: 2, actorKind: 'member', senderProfile: 'architect' },
  ];
  await fake.runNext();
  assert.deepEqual(completed, [{ roomId: 'room-focus', isFocused: true }]);
  assert.equal(poller.isPolling('room-focus'), true, '聚焦态首次回复后须继续短观察多 Agent 接力');

  await fake.runNext();
  assert.equal(completed.length, 1, '绝不重复触发 onCompleted');
  assert.equal(poller.isPolling('room-focus'), true, '仅 1 轮无新增时仍保持观察');

  serverLogs = [
    ...serverLogs,
    { messageId: 'a2', seq: 3, actorKind: 'member', senderProfile: 'reviewer' },
  ];
  await fake.runNext();
  assert.equal(completed.length, 1);
  assert.equal(syncedCounts.at(-1), 3, '多 Agent 接力新消息必须同步');

  await fake.runNext();
  assert.equal(poller.isPolling('room-focus'), true);
  await fake.runNext();
  assert.equal(poller.isPolling('room-focus'), false, '连续 2 轮无新增后自动清理任务');
  assert.equal(completed.length, 1);
  assert.equal(failed.length, 0);
});

test('GroupLogPollerManager - 超时与连续报错退避后触发 onFailed 且不触发 onCompleted', async () => {
  const fake = createFakeScheduler();
  const initialLogs = [
    { messageId: 'u1', seq: 1, actorKind: 'user', senderProfile: 'user' },
  ];
  const completed = [];
  const failed = [];

  const poller = new GroupLogPollerManager({
    scheduler: fake.scheduler,
    intervalMs: 1200,
    backoffIntervalMs: 2000,
    maxStagnantRounds: 6,
    fetchLogs: async () => {
      throw new Error('gateway timeout');
    },
    isFocused: () => false,
    onSyncLogs: () => {},
    onCompleted: (roomId, isFocused) => completed.push({ roomId, isFocused }),
    onFailed: (roomId) => failed.push(roomId),
  });

  poller.startAwaitReply('room-err', captureGroupLogBaseline(initialLogs));
  assert.deepEqual(fake.pendingDelays(), [1200]);

  for (let i = 1; i <= 5; i += 1) {
    await fake.runNext();
    assert.equal(failed.length, 0, `第 ${i} 轮空转尚未达 maxStagnantRounds 阈值`);
    assert.equal(poller.isPolling('room-err'), true);
    if (i > 2) {
      assert.deepEqual(fake.pendingDelays(), [2000], 'stagnantCount > 2 后必须切换至 backoffIntervalMs');
    } else {
      assert.deepEqual(fake.pendingDelays(), [1200]);
    }
  }

  await fake.runNext();
  assert.deepEqual(failed, ['room-err']);
  assert.equal(completed.length, 0);
  assert.equal(poller.isPolling('room-err'), false);

  const fakeSlow = createFakeScheduler();
  let slowLogs = [...initialLogs];
  const slowCompleted = [];
  const slowFailed = [];
  const pollerSlow = new GroupLogPollerManager({
    scheduler: fakeSlow.scheduler,
    fetchLogs: async () => slowLogs,
    isFocused: () => false,
    onSyncLogs: () => {},
    onCompleted: (roomId, isFocused) => slowCompleted.push({ roomId, isFocused }),
    onFailed: (roomId) => slowFailed.push(roomId),
  });
  pollerSlow.startAwaitReply('room-slow', captureGroupLogBaseline(initialLogs));
  for (let i = 0; i < 8; i += 1) {
    await fakeSlow.runNext();
  }
  assert.equal(slowFailed.length, 0, '长耗时群聊在 8 轮内绝不可早夭');
  slowLogs = [...slowLogs, { messageId: 'a-slow', seq: 2, actorKind: 'member', senderProfile: 'architect' }];
  await fakeSlow.runNext();
  assert.deepEqual(slowCompleted, [{ roomId: 'room-slow', isFocused: false }]);
  assert.equal(pollerSlow.isPolling('room-slow'), false);

  const fakeMax = createFakeScheduler();
  const completedMax = [];
  const failedMax = [];
  const pollerMax = new GroupLogPollerManager({
    scheduler: fakeMax.scheduler,
    maxRounds: 2,
    fetchLogs: async () => initialLogs,
    isFocused: () => true,
    onSyncLogs: () => {},
    onCompleted: (roomId, isFocused) => completedMax.push({ roomId, isFocused }),
    onFailed: (roomId) => failedMax.push(roomId),
  });

  pollerMax.startAwaitReply('room-max', captureGroupLogBaseline(initialLogs));
  await fakeMax.runNext();
  assert.equal(failedMax.length, 0);
  await fakeMax.runNext();
  assert.deepEqual(failedMax, ['room-max']);
  assert.equal(completedMax.length, 0);
  assert.equal(pollerMax.isPolling('room-max'), false);
});

test('GroupLogPollerManager - stopAll 清理全部房间并忽略空 roomId', () => {
  const fake = createFakeScheduler();
  const poller = new GroupLogPollerManager({
    scheduler: fake.scheduler,
    fetchLogs: async () => [],
    isFocused: () => false,
    onSyncLogs: () => {},
    onCompleted: () => {},
    onFailed: () => {},
  });

  poller.startAwaitReply('', captureGroupLogBaseline([]));
  assert.equal(fake.pendingCount(), 0);

  poller.startAwaitReply('r1', captureGroupLogBaseline([]));
  poller.startAwaitReply('r2', captureGroupLogBaseline([]));
  assert.equal(fake.pendingCount(), 2);

  poller.stopAll();
  assert.equal(fake.pendingCount(), 0);
  assert.equal(poller.isPolling('r1'), false);
  assert.equal(poller.isPolling('r2'), false);
});
