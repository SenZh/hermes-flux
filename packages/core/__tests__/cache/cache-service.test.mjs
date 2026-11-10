import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CACHE_SCHEMA_VERSION,
  CacheService,
  MemoryCacheStore,
  createEnvelope,
  messageKey,
} from '../../dist/index.js';

const PROFILE = 'default';
const REF = { profile: PROFILE, channel: 'session', channelId: 's1' };
const OTHER_REF = { profile: PROFILE, channel: 'session', channelId: 's2' };

function row(orderKey, overrides = {}) {
  return {
    profile: PROFILE,
    channel: 'session',
    channelId: 's1',
    orderKey,
    role: 'assistant',
    text: `text-${orderKey}`,
    timestamp: 1_700_000_000_000 + orderKey,
    status: 'complete',
    ...overrides,
  };
}

function summary(id, overrides = {}) {
  return {
    id,
    profile: PROFILE,
    kind: 'session',
    title: `title-${id}`,
    timestamp: 1_700_000_000_000,
    isArchived: false,
    hidden: false,
    pinned: false,
    unread: false,
    ...overrides,
  };
}

function agent(name, overrides = {}) {
  return { name, displayName: name.toUpperCase(), hasAvatar: false, ...overrides };
}

function makeService(options = {}) {
  const store = new MemoryCacheStore();
  const service = new CacheService(store, { now: () => 1_700_000_900_000, ...options });
  return { store, service };
}

test('索引：写入后可读，且带版本信封', async () => {
  const { store, service } = makeService();
  await service.writeSessions([summary('a'), summary('b')]);

  const raw = await store.readIndex('sessions');
  assert.equal(raw.v, CACHE_SCHEMA_VERSION);
  assert.equal(raw.items.length, 2);

  const back = await service.readSessions();
  assert.deepEqual(back.map((r) => r.id).sort(), ['a', 'b']);
});

test('索引：版本不符时丢弃而非按新结构读旧值', async () => {
  const { store, service } = makeService();
  await store.writeIndex('sessions', { v: CACHE_SCHEMA_VERSION + 1, savedAt: 0, items: [summary('old')] });

  const back = await service.readSessions();
  assert.deepEqual(back, []);
  assert.equal(await store.readIndex('sessions'), null, '损坏信封未被清除');
});

test('索引：字段非法的条目被逐条丢弃，合法条目保留', async () => {
  const { store, service } = makeService();
  await store.writeIndex('sessions', createEnvelope([summary('ok'), { id: 'bad' }], 0));

  const back = await service.readSessions();
  assert.deepEqual(back.map((r) => r.id), ['ok']);
});

test('索引：按上限按时间倒序裁剪', async () => {
  const { service } = makeService({ sessionCap: 2 });
  const rows = [
    summary('a', { timestamp: 100 }),
    summary('b', { timestamp: 300 }),
    summary('c', { timestamp: 200 }),
  ];
  const kept = await service.writeSessions(rows);
  assert.deepEqual(kept.map((r) => r.id), ['b', 'c']);
});

test('Agent 索引：写入后按原顺序可读', async () => {
  const { service } = makeService();
  await service.writeAgents([agent('hermes'), agent('aura', { hasAvatar: true })]);
  const back = await service.readAgents();
  assert.deepEqual(back.map((r) => r.name), ['hermes', 'aura']);
});

test('头像表：非 data:image 前缀的项写入时被丢弃', async () => {
  const { service } = makeService();
  await service.writeAvatars({
    hermes: 'data:image/png;base64,AAA',
    broken: 'https://example.com/a.png',
    half: 'data:image',
  });
  const back = await service.readAvatars();
  assert.deepEqual(Object.keys(back), ['hermes']);
});

test('消息：appendRows 写入后可倒序读出', async () => {
  const { service } = makeService();
  await service.appendRows(REF, [row(1), row(2), row(3)]);

  const { rows, fenceMax } = await service.openChannel(REF, 10);
  assert.deepEqual(rows.map((r) => r.orderKey), [3, 2, 1]);
  assert.equal(fenceMax, 3);
});

test('消息：appendRows 超过上限时淘汰最旧', async () => {
  const { service } = makeService({ messageCap: 3 });
  await service.appendRows(REF, [row(1), row(2), row(3)]);
  const result = await service.appendRows(REF, [row(4)]);

  assert.equal(result.evictedKeys.length, 1);
  assert.equal(result.evictedKeys[0], messageKey(row(1)));

  const { rows } = await service.openChannel(REF, 10);
  assert.deepEqual(rows.map((r) => r.orderKey), [4, 3, 2]);
});

test('消息：并发 append 不互相覆盖（通道串行锁）', async () => {
  const { service } = makeService();
  await Promise.all([
    service.appendRows(REF, [row(1)]),
    service.appendRows(REF, [row(2)]),
    service.appendRows(REF, [row(3)]),
    service.appendRows(REF, [row(4)]),
  ]);

  const { rows } = await service.openChannel(REF, 10);
  assert.deepEqual(rows.map((r) => r.orderKey).sort((a, b) => a - b), [1, 2, 3, 4]);
});

test('消息：不同通道并发互不影响', async () => {
  const { service } = makeService();
  await Promise.all([
    service.appendRows(REF, [row(1)]),
    service.appendRows(OTHER_REF, [row(1, { channelId: 's2' })]),
  ]);

  const a = await service.openChannel(REF, 10);
  const b = await service.openChannel(OTHER_REF, 10);
  assert.equal(a.rows.length, 1);
  assert.equal(b.rows.length, 1);
});

test('消息：applyRemoteWindow 剔除围栏内的幽灵行', async () => {
  const { service } = makeService();
  await service.appendRows(REF, [row(1), row(2), row(3), row(4)]);
  const { fenceMax } = await service.openChannel(REF, 10);

  const result = await service.applyRemoteWindow(REF, [row(1), row(2)], fenceMax);

  assert.equal(result.remoteMax, 2);
  const orders = result.rows.map((r) => r.orderKey).sort((a, b) => a - b);
  assert.deepEqual(orders, [1, 2]);
  assert.equal(result.evictedKeys.length, 2);
});

test('消息：applyRemoteWindow 保留拉取在途期间写入的行', async () => {
  const { service } = makeService();
  await service.appendRows(REF, [row(1), row(2)]);

  // 发起拉取时的基线
  const { fenceMax } = await service.openChannel(REF, 10);

  // 途中写入
  await service.appendRows(REF, [row(3)]);

  const result = await service.applyRemoteWindow(REF, [row(1), row(2)], fenceMax);
  const orders = result.rows.map((r) => r.orderKey).sort((a, b) => a - b);
  assert.deepEqual(orders, [1, 2, 3], '在途写入的 3 被围栏误删');
});

test('消息：applyRemoteWindow 对同一窗口幂等', async () => {
  const { service } = makeService();
  await service.appendRows(REF, [row(1), row(2), row(5)]);

  const first = await service.applyRemoteWindow(REF, [row(1), row(2)], 5);
  const second = await service.applyRemoteWindow(REF, [row(1), row(2)], 5);

  assert.deepEqual(
    second.rows.map((r) => r.orderKey),
    first.rows.map((r) => r.orderKey)
  );
  assert.deepEqual(second.evictedKeys, []);
});

test('消息：truncate 按 survivor 映射重绑定并删除 null 项', async () => {
  const { service } = makeService();
  await service.appendRows(REF, [row(1), row(2), row(3)]);

  const map = new Map([
    [1, 101],
    [2, null],
  ]);
  const result = await service.truncate(REF, 3, map);

  assert.deepEqual(result.rows.map((r) => r.orderKey), [101, 3]);
  assert.equal(result.removed, 1);

  const after = await service.openChannel(REF, 10);
  assert.deepEqual(after.rows.map((r) => r.orderKey), [101, 3]);
});

test('消息：truncate 无映射时按目标截断', async () => {
  const { service } = makeService();
  await service.appendRows(REF, [row(1), row(2), row(3)]);
  const result = await service.truncate(REF, 2, null);
  assert.deepEqual(result.rows.map((r) => r.orderKey), [2, 1]);
});

test('消息：dropChannel 清空该通道', async () => {
  const { service } = makeService();
  await service.appendRows(REF, [row(1), row(2)]);
  const removed = await service.dropChannel(REF);
  assert.equal(removed, 2);

  const { rows } = await service.openChannel(REF, 10);
  assert.deepEqual(rows, []);
});

test('消息：applyRemoteWindow 远端为空时清空围栏内全部本地行', async () => {
  const { service } = makeService();
  await service.appendRows(REF, [row(1), row(2)]);
  const { fenceMax } = await service.openChannel(REF, 10);

  const result = await service.applyRemoteWindow(REF, [], fenceMax);
  assert.deepEqual(result.rows, []);
  assert.equal(result.evictedKeys.length, 2);
});

test('readOlderRows：按 beforeOrderKey 倒序读取更早历史消息，且遵循通道隔离', async () => {
  const { service } = makeService();
  await service.appendRows(REF, [row(1), row(2), row(3), row(4), row(5)]);
  await service.appendRows(OTHER_REF, [row(10, { channelId: 's2' })]);

  // 从 orderKey 4 往前读 2 条 -> 应该拿到 3, 2（倒序）
  const older = await service.readOlderRows(REF, 4, 2);
  assert.equal(older.length, 2);
  assert.deepEqual(older.map((r) => r.orderKey), [3, 2]);

  // 读到边界，没有更早历史时返回空数组
  const none = await service.readOlderRows(REF, 1, 10);
  assert.deepEqual(none, []);

  // 跨通道查询互不干扰
  const otherOlder = await service.readOlderRows(OTHER_REF, 20, 10);
  assert.equal(otherOlder.length, 1);
  assert.equal(otherOlder[0].orderKey, 10);
});
