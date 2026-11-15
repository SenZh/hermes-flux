/**
 * 对话流事件与消息微距动作控制器纯单测 (Conversation Stream Controller Unit Test)
 * (packages/desktop/__tests__/unit/conversationStreamController.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationStreamController } from '../../dist/renderer/events/conversationStreamController.mjs';

function createMockDeps(overrides = {}) {
  let renderCount = 0;
  const notices = [];
  const copiedTexts = [];
  const selectedSessions = [];

  const state = {
    activeSessionId: 'sess-1',
    messages: [
      { id: 'u1', role: 'user', content: 'What is Hermes?', timestamp: '10:00' },
      { id: 'a1', role: 'assistant', content: 'Hermes is an AI workstation.', timestamp: '10:01' },
    ],
    profileName: 'default',
    activeFocus: { type: 'session', sessionId: 'sess-1' },
    rollbackArmed: null,
    ...(overrides.state || {}),
  };

  const sessionMessagesCache = new Map();
  sessionMessagesCache.set('sess-1', [...state.messages]);

  const deps = {
    getState: () => state,
    render: () => {
      renderCount += 1;
    },
    safeCopyText: async (text) => {
      copiedTexts.push(text);
      return true;
    },
    setTimedDockNotice: (msg) => {
      notices.push(msg);
    },
    isStreamingActiveForCurrentSession: () => false,
    t: (key) => key,
    getGatewayClient: () => ({ call: async () => ({}) }),
    getRpcCaller: () => ({ request: async () => ({}) }),
    getInteractiveService: () => ({
      forkSession: async () => ({ session_id: 'new-fork-id' }),
    }),
    selectSession: async (id) => {
      selectedSessions.push(id);
    },
    scheduleSessionsRefresh: () => {},
    getSessionMessagesCache: () => sessionMessagesCache,
    handleOpenFilePreview: async () => {},
    syncPromptNavigatorFromScroll: () => {},
    loadOlderMessages: async () => {},
    relocateMessageWindowToIndex: () => true,
    syncScrollTopToWindow: () => {},
    slideMessageWindowForward: () => {},
    expandMessageWindow: () => true,
    settleInitialBottom: () => {},
    scrollStreamToBottom: () => {},
    scheduleStreamBottomInset: () => {},
    layoutSignature: () => 'sig-1',
    ensureLiveSessionId: async () => 'live-1',
    getMessageWindowStart: () => 0,
    getMessageWindowEnd: () => 2,
    isMessageWindowUserExpanded: () => false,
    setMessageWindowUserExpanded: () => {},
    getAverageRowHeightPx: () => 96,
    isInitialBottomSettling: () => false,
    setInitialBottomSettling: () => {},
    getStreamScrollCooldown: () => false,
    setStreamScrollCooldown: () => {},
    getLastStreamScrollTop: () => 0,
    setLastStreamScrollTop: () => {},
    getProgrammaticScrollTarget: () => null,
    setProgrammaticScrollTarget: () => {},
    getProgrammaticScrollIgnoreUntil: () => 0,
    getLayoutDriftUntil: () => 0,
    getReaderScrolledSessionId: () => '',
    setReaderScrolledSessionId: () => {},
    setSettledLayoutSignature: () => {},
    STICK_TO_BOTTOM_THRESHOLD_PX: 48,
    MESSAGE_WINDOW_CAPACITY: 120,
    ...(overrides.deps || {}),
  };

  return {
    deps,
    state,
    getRenderCount: () => renderCount,
    notices,
    copiedTexts,
    selectedSessions,
    sessionMessagesCache,
  };
}

test('ConversationStreamController: handleCopyMessage 成功提取正文', async () => {
  const { deps, copiedTexts } = createMockDeps();
  const controller = createConversationStreamController(deps);

  const fakeBtn = {
    getAttribute: (attr) => (attr === 'data-msg-id' ? 'u1' : null),
    closest: () => null,
    querySelector: () => null,
  };

  await controller.handleCopyMessage(fakeBtn);
  assert.equal(copiedTexts.length, 1);
  assert.equal(copiedTexts[0], 'What is Hermes?');
});

test('ConversationStreamController: handleRollbackCancel 恢复快照并清空 banner', () => {
  const { deps, state, getRenderCount } = createMockDeps({
    state: {
      rollbackArmed: {
        sessionId: 'sess-1',
        targetId: 'u1',
        anchor: { kind: 'row', rowId: 10 },
        snapshot: [{ id: 'snap-1', content: 'restored' }],
        removedCount: 1,
        anchorLabel: '#10',
      },
    },
  });
  const controller = createConversationStreamController(deps);

  controller.handleRollbackCancel();
  assert.equal(state.rollbackArmed, null);
  assert.equal(state.messages[0].content, 'restored');
  assert.ok(getRenderCount() >= 1);
});

test('ConversationStreamController: handleForkMessage 分叉成功后切换新会话', async () => {
  const { deps, selectedSessions } = createMockDeps();
  const controller = createConversationStreamController(deps);

  const fakeBtn = {
    getAttribute: (attr) => (attr === 'data-msg-id' ? 'a1' : null),
    closest: () => null,
    querySelector: () => null,
  };

  await controller.handleForkMessage(fakeBtn);
  assert.deepEqual(selectedSessions, ['new-fork-id']);
});
