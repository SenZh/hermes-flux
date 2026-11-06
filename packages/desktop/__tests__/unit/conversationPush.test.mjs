/**
 * 对话区快照推送决策测试（四象限）
 *
 * 这组用例保护的是流式正确性：新消息必须推送以生成锚点，流式结束后必须收敛，
 * 其余渲染不得推送快照。删掉任一分支，对应用例必须变红。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { decideConversationPush } from '../../dist/renderer/conversationPush.mjs';

const ids = (...values) => new Set(values);

test('force 优先：首次挂载/宿主替换必须推送', () => {
  assert.equal(
    decideConversationPush({ prevIds: ids('a'), nextIds: ['a'], justStoppedStreaming: false, force: true }),
    true
  );
});

test('出现新消息 id 必须推送（否则新行没有锚点）', () => {
  assert.equal(
    decideConversationPush({ prevIds: ids('a'), nextIds: ['a', 'b'], justStoppedStreaming: false, force: false }),
    true
  );
});

test('流式刚结束必须收敛一次', () => {
  assert.equal(
    decideConversationPush({ prevIds: ids('a', 'b'), nextIds: ['a', 'b'], justStoppedStreaming: true, force: false }),
    true
  );
});

test('无新消息且未结束流式：不得推送（避免每帧全量重渲染）', () => {
  assert.equal(
    decideConversationPush({ prevIds: ids('a', 'b'), nextIds: ['a', 'b'], justStoppedStreaming: false, force: false }),
    false
  );
});

test('空消息集合：不推送也不崩溃', () => {
  assert.equal(
    decideConversationPush({ prevIds: new Set(), nextIds: [], justStoppedStreaming: false, force: false }),
    false
  );
});

test('集合收缩：回滚截断必须推送', () => {
  assert.equal(
    decideConversationPush({
      prevIds: ids('a', 'b', 'c'),
      nextIds: ['a', 'b'],
      justStoppedStreaming: false,
      force: false,
    }),
    true
  );
});

test('集合清空：清空会话必须推送', () => {
  assert.equal(
    decideConversationPush({ prevIds: ids('a', 'b'), nextIds: [], justStoppedStreaming: false, force: false }),
    true
  );
});
