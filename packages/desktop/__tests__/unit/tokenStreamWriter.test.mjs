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
