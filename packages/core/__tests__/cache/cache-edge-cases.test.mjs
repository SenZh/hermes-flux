import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CACHE_SCHEMA_VERSION,
  CacheService,
  MemoryCacheStore,
  createEnvelope,
  isReadableEnvelope,
  messageKey,
  upsertMessageRows,
} from '../../dist/index.js';

const REF = { profile: 'default', channel: 'session', channelId: 'edge' };

function row(orderKey, overrides = {}) {
  return {
    profile: REF.profile,
    channel: REF.channel,
    channelId: REF.channelId,
    orderKey,
    role: 'assistant',
    text: `t${orderKey}`,
    timestamp: 1_700_000_000_000 + orderKey,
    status: 'complete',
    ...overrides,
  };
}

function makeService(options = {}) {
  const store = new MemoryCacheStore();
  return { store, service: new CacheService(store, { now: () => 1_700_000_900_000, ...options }) };
}

test('信封：isReadableEnvelope 拒绝 null / 非对象 / 版本不符 / 缺 items', () => {
  assert.equal(isReadableEnvelope(null), false);
  assert.equal(isReadableEnvelope('x'), false);
  assert.equal(isReadableEnvelope({ v: CACHE_SCHEMA_VERSION + 1, items: [] }), false);
  assert.equal(isReadableEnvelope({ v: CACHE_SCHEMA_VERSION }), false);
  assert.equal(isReadableEnvelope(createEnvelope([], 0)), true);
});

test('索引：items 不是数组时返回空数组且不抛错', async () => {
  const { store, service } = makeService();
  await store.writeIndex('sessions', createEnvelope({ notArray: true }, 0));
  const back = await service.readSessions();
  assert.deepEqual(back, []);
});

test('索引：信封为 null（不存在）时不清除键', async () => {
  const { store, service } = makeService();
  assert.deepEqual(await service.readSessions(), []);
  assert.equal(await store.readIndex('sessions'), null);
});

test('索引：timestamp 为 NaN 的行被守卫丢弃', async () => {
  const { store, service } = makeService();
  const good = {
    id: 'ok',
    profile: 'default',
    kind: 'session',
    title: 't',
    timestamp: 1,
    isArchived: false,
    hidden: false,
    pinned: false,
    unread: false,
  };
  await store.writeIndex('sessions', createEnvelope([good, { ...good, id: 'bad', timestamp: NaN }], 0));
  const back = await service.readSessions();
  assert.deepEqual(back.map((r) => r.id), ['ok']);
});

test('Agent 索引：缺 displayName 的行被丢弃', async () => {
  const { store, service } = makeService();
  await store.writeIndex(
    'agents',
    createEnvelope([{ name: 'a', displayName: 'A', hasAvatar: false }, { name: 'b', hasAvatar: false }], 0)
  );
  const back = await service.readAgents();
  assert.deepEqual(back.map((r) => r.name), ['a']);
});

test('openChannel: limit=0 返回空数组，fenceMax=0', async () => {
  const { service } = makeService();
  await service.appendRows(REF, [row(1), row(2)]);
  const result = await service.openChannel(REF, 0);
  assert.deepEqual(result.rows, []);
  assert.equal(result.fenceMax, 0);
});

test('openChannel: 空通道返回空数组而非 undefined', async () => {
  const { service } = makeService();
  const result = await service.openChannel(REF, 10);
  assert.deepEqual(result.rows, []);
  assert.equal(result.fenceMax, 0);
});

test('appendRows: 空数组是幂等空操作', async () => {
  const { service } = makeService();
  const result = await service.appendRows(REF, []);
  assert.equal(result.written, 0);
  assert.deepEqual(result.evictedKeys, []);
  const { rows } = await service.openChannel(REF, 10);
  assert.deepEqual(rows, []);
});

test('appendRows: messageCap=1 时只保留最新一条', async () => {
  const { service } = makeService({ messageCap: 1 });
  await service.appendRows(REF, [row(1)]);
  await service.appendRows(REF, [row(2)]);
  const { rows } = await service.openChannel(REF, 10);
  assert.deepEqual(rows.map((r) => r.orderKey), [2]);
});

test('appendRows: 同主键重复写入不增加行数', async () => {
  const { service } = makeService();
  await service.appendRows(REF, [row(5)]);
  await service.appendRows(REF, [row(5)]);
  await service.appendRows(REF, [row(5)]);
  const { rows } = await service.openChannel(REF, 10);
  assert.equal(rows.length, 1);
});

test('applyRemoteWindow: 本地与远端都为空时不报错', async () => {
  const { service } = makeService();
  const result = await service.applyRemoteWindow(REF, [], 0);
  assert.deepEqual(result.rows, []);
  assert.equal(result.remoteMax, 0);
});

test('applyRemoteWindow: fenceMax=0 但本地为空时不清除任何东西', async () => {
  const { service } = makeService();
  await service.appendRows(REF, [row(7)]);
  // 人为把围栏基线设为 0，删除区间应为空
  const result = await service.applyRemoteWindow(REF, [], 0);
  assert.deepEqual(result.rows.map((r) => r.orderKey), [7]);
});

test('truncate: 目标低于最小 orderKey 时清空', async () => {
  const { service } = makeService();
  await service.appendRows(REF, [row(5), row(6)]);
  const result = await service.truncate(REF, 1, null);
  assert.deepEqual(result.rows, []);
  assert.equal(result.removed, 2);
});

test('truncate: 目标高于最大 orderKey 时全部保留', async () => {
  const { service } = makeService();
  await service.appendRows(REF, [row(1), row(2)]);
  const result = await service.truncate(REF, 99, null);
  assert.deepEqual(result.rows.map((r) => r.orderKey), [2, 1]);
  assert.equal(result.removed, 0);
});

test('truncate: survivor 映射指向空值集合时全部删除', async () => {
  const { service } = makeService();
  await service.appendRows(REF, [row(1), row(2)]);
  const map = new Map([
    [1, null],
    [2, null],
  ]);
  const result = await service.truncate(REF, 2, map);
  assert.deepEqual(result.rows, []);
});

test('dropChannel: 空通道返回 0 且不抛错', async () => {
  const { service } = makeService();
  assert.equal(await service.dropChannel(REF), 0);
});

test('并发：truncate 与 append 交错后行数一致', async () => {
  const { service } = makeService();
  await service.appendRows(REF, [row(1), row(2), row(3)]);

  await Promise.all([service.truncate(REF, 1, null), service.appendRows(REF, [row(4)])]);

  const { rows } = await service.openChannel(REF, 10);
  // 两种串行顺序结果不同，但都必须满足：不含 2、3 中任何一个
  assert.ok(!rows.some((r) => r.orderKey === 2 || r.orderKey === 3), '截断目标以上的行仍然存在');
});

test('upsertMessageRows: 空输入返回空数组', () => {
  assert.deepEqual(upsertMessageRows([], []), []);
});

test('upsertMessageRows: 只保留主键对应的单份，不产生重复键', () => {
  const merged = upsertMessageRows([row(1), row(1)], [row(1)]);
  assert.equal(merged.length, 1);
  assert.equal(messageKey(merged[0]), messageKey(row(1)));
});

test('消息：不同通道的同名 orderKey 互不覆盖', async () => {
  const { service } = makeService();
  const other = { ...REF, channelId: 'edge-2' };
  await service.appendRows(REF, [row(1)]);
  await service.appendRows(other, [row(1, { channelId: 'edge-2' })]);

  const a = await service.openChannel(REF, 10);
  const b = await service.openChannel(other, 10);
  assert.equal(a.rows.length, 1);
  assert.equal(b.rows.length, 1);
  assert.equal(a.rows[0].channelId, 'edge');
  assert.equal(b.rows[0].channelId, 'edge-2');
});
