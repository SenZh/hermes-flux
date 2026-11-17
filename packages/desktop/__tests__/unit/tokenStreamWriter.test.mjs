/**
 * 流式 Token 写入器纯单测 (Token Stream Writer Unit Test)
 * (packages/desktop/__tests__/unit/tokenStreamWriter.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokenStreamWriter } from '../../dist/renderer/stream/tokenStreamWriter.mjs';

function createMockDeps(overrides = {}) {
  const state = {
    activeSessionId: 'sess-active',
    messages: [
      { id: 'm1', role: 'assistant', content: 'Hello ', thought: '' },
    ],
    sessions: [
      { id: 'sess-active', preview: '' },
    ],
    activeFocus: { type: 'session', sessionId: 'sess-active' },
    ...(overrides.state || {}),
  };

  const sessionMessagesCache = new Map();
  sessionMessagesCache.set('sess-active', state.messages.map((m) => ({ ...m })));

  const botActivityUpdates = [];
  const botActivityStore = {
    updateLatestActivity: (botName, content, ts) => {
      botActivityUpdates.push({ botName, content, ts });
    },
  };

  const deps = {
    getState: () => state,
    sessionMessagesCache,
    botActivityStore,
    getActiveStreamingStoredSessionId: () => 'sess-active',
    isStreamNearBottom: () => true,
    markProgrammaticScroll: () => {},
    logStream: { trace: () => {} },
    ...(overrides.deps || {}),
  };

  return {
    deps,
    state,
    sessionMessagesCache,
    botActivityUpdates,
  };
}

test('TokenStreamWriter: 能够将增量 token 写入活跃会话 assistant 消息', () => {
  const { deps, state } = createMockDeps();
  const writer = createTokenStreamWriter(deps);

  const flushedMap = new Map();
  flushedMap.set('m1', { content: 'world!', thought: 'pondering' });

  writer.writeFlushedTokens(flushedMap);

  assert.equal(state.messages[0].content, 'Hello world!');
  assert.equal(state.messages[0].thought, 'pondering');
});

test('TokenStreamWriter: 当 targetMsg 与 cachedTarget 为同一内存引用时，严禁重复拼接', () => {
  const sharedMsg = { id: 'm-shared', role: 'assistant', content: 'Start: ', thought: '' };
  const state = {
    activeSessionId: 'sess-1',
    messages: [sharedMsg],
    sessions: [{ id: 'sess-1', preview: '' }],
    activeFocus: { type: 'session', sessionId: 'sess-1' },
  };

  const sessionMessagesCache = new Map();
  // 浅拷贝：数组不同，但元素对象引用完全相同！
  sessionMessagesCache.set('sess-1', [sharedMsg]);

  const deps = {
    getState: () => state,
    sessionMessagesCache,
    botActivityStore: { updateLatestActivity: () => {} },
    getActiveStreamingStoredSessionId: () => 'sess-1',
    isStreamNearBottom: () => true,
    markProgrammaticScroll: () => {},
    logStream: { trace: () => {} },
  };

  const writer = createTokenStreamWriter(deps);
  const flushedMap = new Map();
  flushedMap.set('m-shared', { content: 'ChunkA', thought: 'ThinkingA' });

  writer.writeFlushedTokens(flushedMap);

  assert.equal(sharedMsg.content, 'Start: ChunkA', '同一对象引用必须仅累加一次，严禁出现 ChunkA 重复');
  assert.equal(sharedMsg.thought, 'ThinkingA');
});

test('TokenStreamWriter: 后台会话写入 sessionMessagesCache，不影响当前会话 messages', () => {
  const state = {
    activeSessionId: 'sess-current-viewing',
    messages: [{ id: 'm-current', role: 'user', content: 'Viewing' }],
    sessions: [{ id: 'sess-background-stream', preview: '' }],
    activeFocus: { type: 'session', sessionId: 'sess-current-viewing' },
  };

  const sessionMessagesCache = new Map();
  const bgMsg = { id: 'm-bg', role: 'assistant', content: 'Background: ', thought: '' };
  sessionMessagesCache.set('sess-background-stream', [bgMsg]);

  const deps = {
    getState: () => state,
    sessionMessagesCache,
    botActivityStore: { updateLatestActivity: () => {} },
    getActiveStreamingStoredSessionId: () => 'sess-background-stream',
    isStreamNearBottom: () => true,
    markProgrammaticScroll: () => {},
    logStream: { trace: () => {} },
  };

  const writer = createTokenStreamWriter(deps);
  const flushedMap = new Map();
  flushedMap.set('m-bg', { content: 'DeltaBg', thought: 'ThoughtBg' });

  writer.writeFlushedTokens(flushedMap);

  assert.equal(bgMsg.content, 'Background: DeltaBg', '后台缓存必须持续累加');
  assert.equal(state.messages.length, 1, '当前查看的前台会话不得被污染');
});

test('TokenStreamWriter: 当 targetMsg.content 初始为空字符串时触发假值回退分支', () => {
  const emptyMsg = { id: 'm-empty', role: 'assistant', content: '', thought: '' };
  const state = {
    activeSessionId: 'sess-empty',
    messages: [emptyMsg],
    sessions: [{ id: 'sess-empty', preview: '' }],
    activeFocus: { type: 'session', sessionId: 'sess-empty' },
  };
  const sessionMessagesCache = new Map();
  sessionMessagesCache.set('sess-empty', [{ ...emptyMsg }]);

  const deps = {
    getState: () => state,
    sessionMessagesCache,
    botActivityStore: { updateLatestActivity: () => {} },
    getActiveStreamingStoredSessionId: () => 'sess-empty',
    isStreamNearBottom: () => true,
    markProgrammaticScroll: () => {},
    logStream: { trace: () => {} },
  };

  const writer = createTokenStreamWriter(deps);
  const flushedMap = new Map();
  flushedMap.set('m-empty', { content: 'FirstToken', thought: '' });
  writer.writeFlushedTokens(flushedMap);

  assert.equal(emptyMsg.content, 'FirstToken');
});
