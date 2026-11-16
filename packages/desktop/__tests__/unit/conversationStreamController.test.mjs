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

test('ConversationStreamController - 滚动几何与滑窗状态机回归守卫', async (t) => {
  await t.test('1. 物理底沿判定：视口接近当前挂载窗口底边时平滑触发向前滑窗', () => {
    let slideCalled = false;
    let windowExpanded = true;
    let currentScrollTop = 24000;

    const fakeStream = {
      scrollTop: currentScrollTop,
      scrollHeight: 133330, // 撑开的超大虚拟总高
      clientHeight: 800,
      onscroll: null,
      onwheel: null,
      dataset: {},
      addEventListener: () => {},
    };

    const fakeVirtualWindow = {
      getBoundingClientRect: () => ({ height: 12000 }), // 当前窗口真实物理高度 12000px
    };

    const globalDoc = globalThis.document;
    globalThis.document = {
      getElementById: (id) => (id === 'conversation-stream' ? fakeStream : null),
      querySelector: (sel) => (sel === '.conv-virtual-window' ? fakeVirtualWindow : null),
      querySelectorAll: () => [],
    };

    try {
      // 模拟当前窗口 [100, 220)，avgRowHeight=96 => virtualWindowTop = 9600px
      // 物理下边缘 currentWindowBottom = 9600 + 12000 = 21600px
      // 视口底部 currentViewportBottom = scrollTop + 800
      // 当 scrollTop=20200 时，currentViewportBottom = 21000px，distanceToWindowEnd = 600px < viewportPrefetch(800px)
      fakeStream.scrollTop = 20200;

      const { deps } = createMockDeps({
        state: {
          messages: Array.from({ length: 1000 }, (_, i) => ({ id: `m-${i}` })),
        },
        deps: {
          getMessageWindowStart: () => 100,
          getMessageWindowEnd: () => 220,
          isMessageWindowUserExpanded: () => windowExpanded,
          setMessageWindowUserExpanded: (val) => { windowExpanded = val; },
          getAverageRowHeightPx: () => 96,
          slideMessageWindowForward: () => { slideCalled = true; },
        },
      });

      const controller = createConversationStreamController(deps);
      controller.bindDomEvents();

      assert.ok(typeof fakeStream.onscroll === 'function', '必须绑定 onscroll 处理器');
      fakeStream.onscroll();

      assert.equal(slideCalled, true, '视口接近挂载窗口底边时必须触发 slideMessageWindowForward');
    } finally {
      globalThis.document = globalDoc;
    }
  });

  await t.test('2. 双因子贴底复位：滚到底部且窗口覆盖尾部时安全复位 userExpanded 并清空回溯标记', () => {
    let windowExpanded = true;
    let readerScrolledSessionId = 'sess-1';

    const fakeStream = {
      scrollTop: 95200,
      scrollHeight: 96000,
      clientHeight: 800, // distanceToBottom = 96000 - 95200 - 800 = 0 <= 48px (贴底)
      onscroll: null,
      onwheel: null,
      dataset: {},
      addEventListener: () => {},
    };

    const globalDoc = globalThis.document;
    globalThis.document = {
      getElementById: (id) => (id === 'conversation-stream' ? fakeStream : null),
      querySelector: () => null,
      querySelectorAll: () => [],
    };

    try {
      const { deps } = createMockDeps({
        state: {
          activeSessionId: 'sess-1',
          messages: Array.from({ length: 1000 }, (_, i) => ({ id: `m-${i}` })),
        },
        deps: {
          getMessageWindowStart: () => 880,
          getMessageWindowEnd: () => 1000, // 窗口已覆盖末尾
          isMessageWindowUserExpanded: () => windowExpanded,
          setMessageWindowUserExpanded: (val) => { windowExpanded = val; },
          getReaderScrolledSessionId: () => readerScrolledSessionId,
          setReaderScrolledSessionId: (val) => { readerScrolledSessionId = val; },
        },
      });

      const controller = createConversationStreamController(deps);
      controller.bindDomEvents();
      fakeStream.onscroll();

      assert.equal(windowExpanded, false, '贴底且到达尾部必须解除 userExpanded');
      assert.equal(readerScrolledSessionId, '', '贴底且到达尾部必须清空 readerScrolledSessionId 恢复自动吸平');
    } finally {
      globalThis.document = globalDoc;
    }
  });

  await t.test('3. 直接拖动滚动条寻址解耦：outside 分支无条件放行 relocateMessageWindowToIndex', () => {
    let relocatedIndex = -1;

    const fakeStream = {
      scrollTop: 80000, // 突然拖动到 80000px
      scrollHeight: 133330,
      clientHeight: 800,
      onscroll: null,
      onwheel: null,
      dataset: {},
      addEventListener: () => {},
    };

    const globalDoc = globalThis.document;
    globalThis.document = {
      getElementById: (id) => (id === 'conversation-stream' ? fakeStream : null),
      querySelector: () => null,
      querySelectorAll: () => [],
    };

    try {
      const { deps } = createMockDeps({
        state: {
          activeSessionId: 'sess-1',
          messages: Array.from({ length: 1000 }, (_, i) => ({ id: `m-${i}` })),
        },
        deps: {
          getMessageWindowStart: () => 100,
          getMessageWindowEnd: () => 220,
          getAverageRowHeightPx: () => 96,
          getReaderScrolledSessionId: () => '', // 用户此前未手动滚轮向上过
          relocateMessageWindowToIndex: (idx) => { relocatedIndex = idx; return true; },
          scrollStreamToBottom: () => {
            assert.fail('拖拽滚动条寻址绝不可被踢回底部');
          },
        },
      });

      const controller = createConversationStreamController(deps);
      controller.bindDomEvents();
      fakeStream.onscroll();

      assert.equal(relocatedIndex, Math.floor(80000 / 96), '应计算目标索引并放行 relocateMessageWindowToIndex');
    } finally {
      globalThis.document = globalDoc;
    }
  });
});
