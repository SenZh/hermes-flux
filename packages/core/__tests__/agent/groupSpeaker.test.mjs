/**
 * 群聊说话者归一化单元测试 (packages/core/__tests__/agent/groupSpeaker.test.mjs)
 *
 * 【测试什么】「此刻是谁在干活」的四象限：
 *   正向（assistant 命中成员）、边界（空列表 / 全 system）、
 *   负向（末条是 user / sender 不在成员表）、归一化（displayName ↔ profile name）。
 *
 * 【变异杀伤力】把「末条 user 返回 null」删掉、把归一化改成直接返回 sender、
 *   把倒序循环改成正序，对应用例立刻变红。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGroupSpeaker } from '../../dist/agent/groupSpeaker.js';

const MEMBERS = ['alpha', 'beta', 'gamma'];
const PROFILES = [
  { name: 'alpha', displayName: 'Alpha 队长' },
  { name: 'beta', displayName: 'Beta 审查' },
  { name: 'gamma' },
];

test('resolveGroupSpeaker - 正向主路径', async (t) => {
  await t.test('末条 assistant 的 sender 是 profile name => 命中', () => {
    const speaker = resolveGroupSpeaker([{ role: 'user' }, { role: 'assistant', sender: 'beta' }], MEMBERS, PROFILES);
    assert.equal(speaker, 'beta');
  });

  await t.test('sender 是 displayName => 归一化到成员表里的 profile name', () => {
    const speaker = resolveGroupSpeaker(
      [{ role: 'user' }, { role: 'assistant', sender: 'Beta 审查' }],
      MEMBERS,
      PROFILES,
    );
    assert.equal(speaker, 'beta', '必须折回 profile name，否则组件侧「说话者必须在成员里」永远判定未知');
  });

  await t.test('多条 assistant 时取最后一条（倒序查找）', () => {
    const speaker = resolveGroupSpeaker(
      [
        { role: 'user' },
        { role: 'assistant', sender: 'alpha' },
        { role: 'assistant', sender: 'gamma' },
      ],
      MEMBERS,
      PROFILES,
    );
    assert.equal(speaker, 'gamma', '正序查找会错误返回 alpha');
  });

  await t.test('大小写不敏感', () => {
    const speaker = resolveGroupSpeaker(
      [{ role: 'user' }, { role: 'assistant', sender: 'BETA' }],
      MEMBERS,
      PROFILES,
    );
    assert.equal(speaker, 'beta');
  });
});

test('resolveGroupSpeaker - 负向与降级（绝不伪造）', async (t) => {
  await t.test('末条是 user => null（成员尚未应答，此刻没人在说话）', () => {
    const speaker = resolveGroupSpeaker(
      [{ role: 'assistant', sender: 'alpha' }, { role: 'user' }],
      MEMBERS,
      PROFILES,
    );
    assert.equal(speaker, null, '不得沿用上一位说话者');
  });

  await t.test('sender 不在成员表 => null（成员已退出或事件乱序）', () => {
    const speaker = resolveGroupSpeaker(
      [{ role: 'user' }, { role: 'assistant', sender: '已退出的成员' }],
      MEMBERS,
      PROFILES,
    );
    assert.equal(speaker, null);
  });

  await t.test('sender 是 displayName 但对应 profile 不在成员表 => null', () => {
    const speaker = resolveGroupSpeaker(
      [{ role: 'user' }, { role: 'assistant', sender: 'Outsider 外部' }],
      MEMBERS,
      [{ name: 'outsider', displayName: 'Outsider 外部' }],
    );
    assert.equal(speaker, null);
  });

  await t.test('assistant 无 sender => null', () => {
    assert.equal(resolveGroupSpeaker([{ role: 'assistant' }], MEMBERS, PROFILES), null);
    assert.equal(resolveGroupSpeaker([{ role: 'assistant', sender: '   ' }], MEMBERS, PROFILES), null);
  });
});

test('resolveGroupSpeaker - 边界值', async (t) => {
  await t.test('空消息列表 => null', () => {
    assert.equal(resolveGroupSpeaker([], MEMBERS, PROFILES), null);
  });

  await t.test('成员表为空 => null（房间还没到达，绝不凭空造人）', () => {
    assert.equal(
      resolveGroupSpeaker([{ role: 'assistant', sender: 'alpha' }], [], PROFILES),
      null,
    );
  });

  await t.test('全是 system 消息 => null', () => {
    assert.equal(
      resolveGroupSpeaker([{ role: 'system' }, { role: 'system' }], MEMBERS, PROFILES),
      null,
    );
  });

  await t.test('纯函数：不修改传入数组', () => {
    const messages = [{ role: 'user' }, { role: 'assistant', sender: 'alpha' }];
    const members = [...MEMBERS];
    const snapshot = JSON.stringify(messages);
    resolveGroupSpeaker(messages, members, PROFILES);
    assert.equal(JSON.stringify(messages), snapshot, '入参必须只读');
    assert.deepEqual(members, MEMBERS, '成员表必须只读');
  });
});
