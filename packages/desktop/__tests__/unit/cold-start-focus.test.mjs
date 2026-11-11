/**
 * 冷启动默认落点裁决测试。
 *
 * 【测试什么】用户首屏最终停在哪里：
 *   第一个 Agent 优先、上次有效选择优先、没有 Profile 才回退会话、两边都没有时不出结论。
 * 【不测什么】内部函数名与调用顺序 —— 那是渲染器接线，由界面验证负责。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveColdStartFocus } from '../../dist/renderer/coldStartFocus.mjs';

const profiles = (...names) => names.map((name) => ({ name }));
const sessions = (...ids) => ids.map((id) => ({ id }));

test('默认选中第一个 profile（网关顺序为真值，不重排）', () => {
  assert.deepEqual(
    resolveColdStartFocus({ profiles: profiles('arch-wang', 'default', 'reviewer'), sessions: sessions('s1') }),
    { kind: 'bot', botName: 'arch-wang' }
  );
});

test('上次落点仍存在于列表时沿用，不强行拉回第一个', () => {
  assert.deepEqual(
    resolveColdStartFocus({
      profiles: profiles('arch-wang', 'reviewer'),
      sessions: sessions('s1'),
      savedProfileName: 'reviewer',
    }),
    { kind: 'bot', botName: 'reviewer' }
  );
});

test('上次落点已不存在（例如 default 被删）时回退第一个 profile', () => {
  assert.deepEqual(
    resolveColdStartFocus({
      profiles: profiles('arch-wang', 'reviewer'),
      sessions: sessions('s1'),
      savedProfileName: 'default',
    }),
    { kind: 'bot', botName: 'arch-wang' }
  );
});

test('显式保存过的 default 仍被尊重，不被"第一个"覆盖', () => {
  assert.deepEqual(
    resolveColdStartFocus({
      profiles: profiles('arch-wang', 'default'),
      sessions: sessions('s1'),
      savedProfileName: 'default',
    }),
    { kind: 'bot', botName: 'default' },
    '是否把 default 当成真实选择由调用方判定，纯函数只负责"传入即尊重"'
  );
});

test('没有任何 profile 时才回退第一个会话', () => {
  assert.deepEqual(
    resolveColdStartFocus({ profiles: [], sessions: sessions('s1', 's2') }),
    { kind: 'session', sessionId: 's1' }
  );
});

test('profile 与会话都为空：返回 none，由下一批数据再裁决', () => {
  assert.deepEqual(resolveColdStartFocus({ profiles: [], sessions: [] }), { kind: 'none' });
});

test('大小写与空白不敏感，非法名字不得命中', () => {
  assert.deepEqual(
    resolveColdStartFocus({ profiles: profiles('Arch-Wang'), sessions: [], savedProfileName: '  arch-wang  ' }),
    { kind: 'bot', botName: 'Arch-Wang' }
  );
  assert.deepEqual(
    resolveColdStartFocus({ profiles: profiles('Arch-Wang'), sessions: [], savedProfileName: '   ' }),
    { kind: 'bot', botName: 'Arch-Wang' }
  );
});
