import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeSessionsByProfile, sessionProfileKey } from '../../dist/session/sessionMerge.js';

function session(id, botName, title, timestamp) {
  return { id, botName, title, timestamp, model: '', time: '', preview: '', isArchived: false };
}

test('sessionMerge - 跨 Profile 会话合并与去重', async (t) => {
  await t.test('1. 跨 Profile 同 ID 会话必须全部保留（不得互相顶掉）', () => {
    // Arrange: 复刻真实网关数据形态——同一 sessionId 在两个 Profile 下各自存在
    const sessions = [
      session('20261031_082411_824c51', 'aura', '会话 20261031', 1793445296360),
      session('20261031_082411_824c51', 'xiaofawang', '评估 Relay 技术商业化可行性', 1793435052233),
      session('20261029_025716_6d9179', 'default', '会话 20261029', 1793448216472),
      session('20261029_025716_6d9179', 'aura', '新任务', 1793242639342),
      session('20261029_025716_6d9179', 'xiaofawang', '会话 20261029', 1793445495089),
    ];

    // Act
    const merged = dedupeSessionsByProfile(sessions);

    // Assert: 5 条 profile::id 组合各自唯一，必须全部保留；Relay 会话不得被 aura 的空白会话顶掉
    assert.equal(merged.length, 5, '跨 Profile 同 ID 必须各自保留（5 条），而不是被压成 1 条');
    const relay = merged.find((s) => s.title === '评估 Relay 技术商业化可行性');
    assert.ok(relay, '《评估 Relay 技术商业化可行性》必须存活');
    assert.equal(relay.botName, 'xiaofawang');
  });

  await t.test('2. 同 Profile 内重复 ID 仍必须去重', () => {
    const sessions = [
      session('dup-1', 'aura', '第一条', 100),
      session('dup-1', 'aura', '重复项', 200),
    ];

    const merged = dedupeSessionsByProfile(sessions);

    assert.equal(merged.length, 1, '同一 Profile 内同 ID 属于真重复，必须去重');
    assert.equal(merged[0].title, '第一条', '保留首次出现的记录');
  });

  await t.test('3. 结果必须按时间戳降序，缺失时间戳排末尾', () => {
    const sessions = [
      session('a', 'default', 'old', 100),
      session('b', 'default', 'newest', 900),
      session('c', 'default', 'middle', 500),
      { ...session('d', 'default', 'no-ts', 0), timestamp: undefined },
    ];

    const merged = dedupeSessionsByProfile(sessions);

    assert.deepEqual(
      merged.map((s) => s.title),
      ['newest', 'middle', 'old', 'no-ts']
    );
  });

  await t.test('4. 空输入与非法条目必须安全跳过', () => {
    assert.deepEqual(dedupeSessionsByProfile([]), []);
    const merged = dedupeSessionsByProfile([
      null,
      { id: '', botName: 'aura', title: 'no id', timestamp: 1 },
      session('ok-1', 'aura', 'valid', 1),
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, 'ok-1');
  });

  await t.test('5. botName 缺失时按 default 归类', () => {
    assert.equal(sessionProfileKey({ id: 'x', timestamp: 0 }), 'default');
    const merged = dedupeSessionsByProfile([
      session('same', undefined, '无归属', 10),
      session('same', 'default', '显式 default', 20),
    ]);
    assert.equal(merged.length, 1, '无归属与 default 视为同一 Profile，必须去重');
  });
});
