import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTruncation,
  evictToCap,
  maxOrderKey,
  mergeRemoteWindow,
  sortByOrderAsc,
  upsertMessageRows,
  messageKey,
} from '../../dist/index.js';

const PROFILE = 'default';
const CHANNEL = 'session';
const CHANNEL_ID = 's1';

function row(orderKey, overrides = {}) {
  return {
    profile: PROFILE,
    channel: CHANNEL,
    channelId: CHANNEL_ID,
    orderKey,
    role: 'assistant',
    text: `text-${orderKey}`,
    timestamp: 1_700_000_000_000 + orderKey,
    status: 'complete',
    ...overrides,
  };
}

function keysOf(rows) {
  return rows.map(messageKey).sort();
}

test('upsertMessageRows: 同主键重复写入幂等', () => {
  const once = upsertMessageRows([], [row(1), row(2), row(3)]);
  const twice = upsertMessageRows(once, [row(1), row(2), row(3)]);

  assert.deepEqual(keysOf(twice), keysOf(once));
  assert.equal(twice.length, 3);
  for (let i = 0; i < once.length; i++) {
    assert.equal(twice[i].text, once[i].text);
    assert.equal(twice[i].orderKey, once[i].orderKey);
  }
});

test('upsertMessageRows: 工具调用版本胜过纯文本版本（防被空壳覆盖）', () => {
  const plain = row(5, { text: 'hi', toolCalls: undefined });
  const rich = row(5, {
    text: 'hi',
    reasoning: 'thinking',
    toolCalls: [{ toolId: 't1', name: 'read_file', status: 'done', resultText: 'ok' }],
  });

  const forward = upsertMessageRows([plain], [rich]);
  const backward = upsertMessageRows([rich], [plain]);

  assert.equal(forward[0].toolCalls?.length, 1);
  assert.equal(backward[0].toolCalls?.length, 1);
  assert.equal(backward[0].reasoning, 'thinking');
});

test('mergeRemoteWindow: 拉取在途期间写入的新消息不被误删（fence 核心）', () => {
  // 发起拉取时本地最大是 100
  const local = [row(99), row(100)];
  const remote = [row(99), row(100)];
  const fenceMax = 100;

  // 拉取在途期间用户发了一条，本地变成 101
  const inFlight = row(101);

  const result = mergeRemoteWindow({
    local: [...local, inFlight],
    remote,
    fenceMax,
    remoteMax: 100,
    pendingKeys: new Set(),
  });

  const orders = result.rows.map((r) => r.orderKey);
  assert.ok(orders.includes(101), '在途写入的 101 被误删了');
  assert.deepEqual(result.evictedKeys, []);
});

test('mergeRemoteWindow: 围栏内的确认多余行被剔除', () => {
  // 本地 100..105 存在，但远端完整窗口只到 100，说明 101..105 是幽灵
  const local = [row(98), row(99), row(100), row(101), row(102), row(105)];
  const remote = [row(98), row(99), row(100)];
  const fenceMax = 105;

  const result = mergeRemoteWindow({ local, remote, fenceMax, remoteMax: 100, pendingKeys: new Set() });

  const orders = result.rows.map((r) => r.orderKey).sort((a, b) => a - b);
  assert.deepEqual(orders, [98, 99, 100]);
  assert.equal(result.evictedKeys.length, 3);
});

test('mergeRemoteWindow: pending 行即使落在删除区间也不删', () => {
  const local = [row(100), row(101)];
  const remote = [row(100)];
  const pending = new Set([messageKey(row(101))]);

  const result = mergeRemoteWindow({ local, remote, fenceMax: 101, remoteMax: 100, pendingKeys: pending });

  assert.ok(result.rows.some((r) => r.orderKey === 101), 'pending 行被误删');
  assert.deepEqual(result.evictedKeys, []);
});

test('mergeRemoteWindow: remoteMax 大于 fenceMax 时不删任何行', () => {
  const local = [row(10), row(11)];
  const remote = [row(50), row(51)];
  const result = mergeRemoteWindow({ local, remote, fenceMax: 11, remoteMax: 51, pendingKeys: new Set() });

  const orders = result.rows.map((r) => r.orderKey).sort((a, b) => a - b);
  assert.deepEqual(orders, [10, 11, 50, 51]);
  assert.deepEqual(result.evictedKeys, []);
});

test('mergeRemoteWindow: 同一 remote 重复应用结果不变（幂等）', () => {
  const local = [row(1), row(2), row(3), row(9)];
  const remote = [row(1), row(2), row(3)];

  const first = mergeRemoteWindow({ local, remote, fenceMax: 9, remoteMax: 3, pendingKeys: new Set() });
  const second = mergeRemoteWindow({
    local: first.rows,
    remote,
    fenceMax: 9,
    remoteMax: 3,
    pendingKeys: new Set(),
  });

  assert.deepEqual(keysOf(second.rows), keysOf(first.rows));
  assert.deepEqual(second.evictedKeys, []);
});

test('applyTruncation: 无 survivorMap 时按目标截断', () => {
  const rows = [row(1), row(2), row(3), row(4)];
  const result = applyTruncation({ rows, targetOrderKey: 2, survivorMap: null });
  assert.deepEqual(result.map((r) => r.orderKey), [1, 2]);
});

test('applyTruncation: survivorMap 数字项重绑定到新行号', () => {
  // 网关把 1 重绑到 100，2 重绑到 101，3 被丢弃
  const rows = [row(1), row(2), row(3)];
  const map = new Map([
    [1, 100],
    [2, 101],
    [3, null],
  ]);

  const result = applyTruncation({ rows, targetOrderKey: 3, survivorMap: map });
  assert.deepEqual(result.map((r) => r.orderKey), [100, 101]);
  assert.equal(result[0].text, 'text-1');
  assert.equal(result[1].text, 'text-2');
});

test('applyTruncation: 重绑定产生同键冲突时只保留一份且择优', () => {
  const a = row(1, { text: 'a', toolCalls: [{ toolId: 't', name: 'x', status: 'done' }] });
  const b = row(2, { text: 'b' });
  const map = new Map([
    [1, 50],
    [2, 50],
  ]);

  const result = applyTruncation({ rows: [a, b], targetOrderKey: 2, survivorMap: map });
  assert.equal(result.length, 1);
  assert.equal(result[0].orderKey, 50);
  assert.equal(result[0].toolCalls?.length, 1, '择优失败：带工具调用的版本被覆盖');
});

test('applyTruncation: 不在映射且超出目标的行作为兜底删除', () => {
  const rows = [row(1), row(2), row(3)];
  const map = new Map([[1, 1]]);
  const result = applyTruncation({ rows, targetOrderKey: 2, survivorMap: map });
  assert.deepEqual(result.map((r) => r.orderKey), [1, 2]);
});

test('evictToCap: 保留 orderKey 最大的 cap 条', () => {
  const rows = [row(1), row(2), row(3), row(4), row(5)];
  const result = evictToCap(rows, 3);
  assert.deepEqual(result.rows.map((r) => r.orderKey), [3, 4, 5]);
  assert.equal(result.evictedKeys.length, 2);
});

test('evictToCap: cap 为 0 时清空', () => {
  const rows = [row(1), row(2)];
  const result = evictToCap(rows, 0);
  assert.equal(result.rows.length, 0);
  assert.equal(result.evictedKeys.length, 2);
});

test('maxOrderKey: 空数组返回 0', () => {
  assert.equal(maxOrderKey([]), 0);
  assert.equal(maxOrderKey([row(3), row(9), row(1)]), 9);
});

test('sortByOrderAsc: 不修改入参', () => {
  const input = [row(3), row(1), row(2)];
  const snapshot = input.map((r) => r.orderKey);
  const sorted = sortByOrderAsc(input);
  assert.deepEqual(sorted.map((r) => r.orderKey), [1, 2, 3]);
  assert.deepEqual(input.map((r) => r.orderKey), snapshot, '入参被原地排序');
});
