import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelBounds } from '../../dist/index.js';

const REF = { profile: 'default', channel: 'session', channelId: 's1' };

const MAX = Number.MAX_SAFE_INTEGER;

test('buildChannelBounds: full 模式覆盖 [0, MAX]', () => {
  const bounds = buildChannelBounds(REF, 'full');
  assert.deepEqual(bounds.lower, ['default', 'session', 's1', 0]);
  assert.deepEqual(bounds.upper, ['default', 'session', 's1', MAX]);
});

test('buildChannelBounds: list-before 把上界减一（排除 boundary 本身）', () => {
  const bounds = buildChannelBounds(REF, 'list-before', 10);
  assert.deepEqual(bounds.lower, ['default', 'session', 's1', 0]);
  assert.deepEqual(bounds.upper, ['default', 'session', 's1', 9]);
});

test('buildChannelBounds: delete-above 把下界加一（排除 boundary 本身）', () => {
  const bounds = buildChannelBounds(REF, 'delete-above', 10);
  assert.deepEqual(bounds.lower, ['default', 'session', 's1', 11]);
  assert.deepEqual(bounds.upper, ['default', 'session', 's1', MAX]);
});

test('buildChannelBounds: 缺省 boundary 时退化为全量，不产生越界区间', () => {
  const list = buildChannelBounds(REF, 'list-before');
  const del = buildChannelBounds(REF, 'delete-above');
  assert.deepEqual(list.lower, ['default', 'session', 's1', 0]);
  assert.deepEqual(list.upper, ['default', 'session', 's1', MAX]);
  assert.deepEqual(del.lower, ['default', 'session', 's1', 0]);
  assert.deepEqual(del.upper, ['default', 'session', 's1', MAX]);
});

test('buildChannelBounds: 不同 channelId 的前缀严格隔离', () => {
  const a = buildChannelBounds({ ...REF, channelId: 'a' }, 'full');
  const b = buildChannelBounds({ ...REF, channelId: 'b' }, 'full');
  assert.notDeepEqual(a.lower.slice(0, 3), b.lower.slice(0, 3));
  assert.equal(a.lower[2], 'a');
  assert.equal(b.lower[2], 'b');
});

test('buildChannelBounds: 不同 channel 类型（session / room）前缀隔离', () => {
  const s = buildChannelBounds({ ...REF, channel: 'session' }, 'full');
  const r = buildChannelBounds({ ...REF, channel: 'room' }, 'full');
  assert.equal(s.lower[1], 'session');
  assert.equal(r.lower[1], 'room');
});

test('buildChannelBounds: 不同 profile 前缀隔离', () => {
  const a = buildChannelBounds({ ...REF, profile: 'default' }, 'full');
  const b = buildChannelBounds({ ...REF, profile: 'aura' }, 'full');
  assert.equal(a.lower[0], 'default');
  assert.equal(b.lower[0], 'aura');
});

test('buildChannelBounds: boundary=0 时 list-before 产生空区间（上界 -1）', () => {
  const bounds = buildChannelBounds(REF, 'list-before', 0);
  assert.equal(bounds.upper[3], -1);
  assert.ok(bounds.upper[3] < bounds.lower[3], '上界应低于下界，形成空区间');
});

test('buildChannelBounds: boundary=MAX 时 delete-above 产生空区间', () => {
  const bounds = buildChannelBounds(REF, 'delete-above', MAX);
  assert.equal(bounds.lower[3], MAX + 1);
  assert.ok(bounds.lower[3] > bounds.upper[3], '下界应高于上界，形成空区间');
});

test('buildChannelBounds: 不修改传入引用对象', () => {
  const ref = { profile: 'default', channel: 'session', channelId: 's1' };
  buildChannelBounds(ref, 'list-before', 5);
  assert.deepEqual(ref, { profile: 'default', channel: 'session', channelId: 's1' });
});
