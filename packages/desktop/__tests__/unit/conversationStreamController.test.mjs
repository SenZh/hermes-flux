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

  let cancelSessionEnterCalls = 0;

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
    cancelSessionEnter: () => {
      cancelSessionEnterCalls += 1;
    },
    STICK_TO_BOTTOM_THRESHOLD_PX: 48,
    MESSAGE_WINDOW_CAPACITY: 120,
    ...(overrides.deps || {}),
  };

  return {
    deps,
    state,
    getRenderCount: () => renderCount,
    getCancelSessionEnterCalls: () => cancelSessionEnterCalls,
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

  await t.test('4. 用户滚轮交互 (onwheel) 必须即时调用 cancelSessionEnter', () => {
    const fakeStream = {
      scrollTop: 100,
      scrollHeight: 1000,
      clientHeight: 500,
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
      const { deps, getCancelSessionEnterCalls } = createMockDeps();
      const controller = createConversationStreamController(deps);
      controller.bindDomEvents();

      assert.equal(typeof fakeStream.onwheel, 'function', '必须绑定 onwheel 监听器');
      fakeStream.onwheel({});
      assert.equal(getCancelSessionEnterCalls(), 1, '用户触发滚轮时必须立即取消会话进入计划');
    } finally {
      globalThis.document = globalDoc;
    }
  });

  await t.test('5. 用户手动滚动 (>4px) 必须取消会话进入计划并重置落定标志', () => {
    let initialBottomSettling = true;
    const fakeStream = {
      scrollTop: 200,
      scrollHeight: 2000,
      clientHeight: 500,
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
      const { deps, getCancelSessionEnterCalls } = createMockDeps({
        deps: {
          getLastStreamScrollTop: () => 100, // 上一次位置 100，当前 200，差值 100 > 4px
          getLayoutDriftUntil: () => 0,
          getProgrammaticScrollTarget: () => null, // 非程序化滚动
          getProgrammaticScrollIgnoreUntil: () => 0,
          setInitialBottomSettling: (v) => { initialBottomSettling = v; },
        },
      });
      const controller = createConversationStreamController(deps);
      controller.bindDomEvents();

      fakeStream.onscroll();
      assert.equal(getCancelSessionEnterCalls(), 1, '手动滚动差值>4px时必须调用 cancelSessionEnter');
      assert.equal(initialBottomSettling, false, '手动滚动必须立即退出 initialBottomSettling');
    } finally {
      globalThis.document = globalDoc;
    }
  });

  await t.test('6. 程序化滚动忽略窗口按 performance.now() 判定：布局 clamp 不得被判为用户手势', () => {
    // 【实测缺陷复现（根因 6）】conversationStreamController 用 `performance.now() <= 忽略截止` 判定，
    //   而 index.ts:625 写入的是 `Date.now() + 180`。两套时钟混用后，
    //   布局 clamp 造成的 6px 回退被当成读者手势 → cancelSessionEnter() 直接杀死进入计划。
    // 场景 1（修复后语义）：忽略截止是 performance.now() 域的未来时间戳 → 必须识别为程序化滚动，不得取消。
    const fakeStream = {
      scrollTop: 794, // 相对上次 800 下降 6px（布局 clamp）
      scrollHeight: 2000,
      clientHeight: 500,
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
      const clampCase = createMockDeps({
        deps: {
          getLastStreamScrollTop: () => 800,
          getLayoutDriftUntil: () => 0,
          getProgrammaticScrollTarget: () => null,
          // 修复后语义：与 performance.now() 同域
          getProgrammaticScrollIgnoreUntil: () => performance.now() + 180,
        },
      });
      const clampController = createConversationStreamController(clampCase.deps);
      clampController.bindDomEvents();
      fakeStream.onscroll();
      assert.equal(clampCase.getCancelSessionEnterCalls(), 0, '程序化滚动忽略窗口内，布局 clamp 回退 6px 不得取消进入计划');

      // 场景 2（对照组）：忽略窗口为 0（纯用户手势）→ 同样的 6px 回退必须取消。
      fakeStream.scrollTop = 794;
      const gestureCase = createMockDeps({
        deps: {
          getLastStreamScrollTop: () => 800,
          getLayoutDriftUntil: () => 0,
          getProgrammaticScrollTarget: () => null,
          getProgrammaticScrollIgnoreUntil: () => 0,
        },
      });
      const gestureController = createConversationStreamController(gestureCase.deps);
      gestureController.bindDomEvents();
      fakeStream.onscroll();
      assert.equal(gestureCase.getCancelSessionEnterCalls(), 1, '忽略窗口为 0 时同样位移必须判为用户手势并取消计划');
    } finally {
      globalThis.document = globalDoc;
    }
  });

  await t.test('程序化忽略窗口内向上滚动 >8px 必须取消进入计划（布局 clamp 豁免不适用于向上）', () => {
    // 【实测缺陷复现（P1-1）】第二轮修复为了让「布局 clamp 的 6px 回退」不被误判成手势，
    //   删掉了 `scrollTop >= lastStreamScrollTop` 的方向约束。副作用是贴底写入后 180ms 窗口内，
    //   读者向上滚动也被判成程序化 → 不执行 cancelSessionEnter() → 视口被 reassertActivePin
    //   拽回底部；最坏情况在 armed 的 600 帧窗口内（约 10 秒）读者无法回溯历史。
    // 【裁决语义】忽略窗口只豁免「小幅向下回退（布局 clamp）」，向上超过阈值的位移仍是读者手势。
    const fakeStream = {
      scrollTop: 150, // 相对上次 200 向上 50px
      scrollHeight: 2000,
      clientHeight: 500,
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
      const { deps, getCancelSessionEnterCalls } = createMockDeps({
        deps: {
          getLastStreamScrollTop: () => 200,
          getLayoutDriftUntil: () => 0,
          getProgrammaticScrollTarget: () => null,
          getProgrammaticScrollIgnoreUntil: () => performance.now() + 500, // 窗口内
        },
      });
      const controller = createConversationStreamController(deps);
      controller.bindDomEvents();

      fakeStream.onscroll();
      assert.equal(
        getCancelSessionEnterCalls(),
        1,
        '忽略窗口内向上滚动 50px 仍是读者手势，必须取消进入计划（clamp 豁免只覆盖小幅向下回退）'
      );
    } finally {
      globalThis.document = globalDoc;
    }
  });

  await t.test('程序化忽略窗口内向下小幅回退 <=8px 不得取消（布局 clamp 豁免）', () => {
    // 【防护性对照】保护本轮修复不被回退：布局 clamp 会让 scrollTop 变小，
    //   忽略窗口内 8px 以内的小幅回退必须继续视为程序化滚动，否则首屏永远落不到底。
    const fakeStream = {
      scrollTop: 196, // 相对上次 200 回退 4px（属于布局 clamp）
      scrollHeight: 2000,
      clientHeight: 500,
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
      const { deps, getCancelSessionEnterCalls } = createMockDeps({
        deps: {
          getLastStreamScrollTop: () => 200,
          getLayoutDriftUntil: () => 0,
          getProgrammaticScrollTarget: () => null,
          getProgrammaticScrollIgnoreUntil: () => performance.now() + 500,
        },
      });
      const controller = createConversationStreamController(deps);
      controller.bindDomEvents();

      fakeStream.onscroll();
      assert.equal(
        getCancelSessionEnterCalls(),
        0,
        '忽略窗口内 4px 布局 clamp 回退不得取消进入计划，否则首屏贴底被读者手势误杀'
      );
    } finally {
      globalThis.document = globalDoc;
    }
  });

  await t.test('onwheel 向下滚动不得取消进入计划', () => {
    // 【实测缺陷复现（P1-4）】onwheel 在 guard 之前无条件 cancel（含向下滚、含 cooldown 期），
    //   而 onscroll 要 `!isProgrammatic && 位移 > 4` 才 cancel。两个入口语义必须一致：
    //   向下滚应保留 armed 贴底意图，只有向上（或显著位移）才算读者接管视口。
    const fakeStream = {
      scrollTop: 100,
      scrollHeight: 1000,
      clientHeight: 500,
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
      const { deps, getCancelSessionEnterCalls } = createMockDeps();
      const controller = createConversationStreamController(deps);
      controller.bindDomEvents();

      assert.equal(typeof fakeStream.onwheel, 'function', '必须绑定 onwheel 监听器');
      fakeStream.onwheel({ deltaY: 120 });
      assert.equal(getCancelSessionEnterCalls(), 0, '向下滚轮（deltaY >= 0）必须保留 armed 贴底意图，不得取消进入计划');
    } finally {
      globalThis.document = globalDoc;
    }
  });

  await t.test('onwheel 向上滚动必须取消进入计划', () => {
    // 【防护性对照】锁定既有语义：向上滚轮是显式读者接管，必须立即取消进入计划。
    const fakeStream = {
      scrollTop: 100,
      scrollHeight: 1000,
      clientHeight: 500,
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
      const { deps, getCancelSessionEnterCalls } = createMockDeps();
      const controller = createConversationStreamController(deps);
      controller.bindDomEvents();

      fakeStream.onwheel({ deltaY: -120 });
      assert.equal(getCancelSessionEnterCalls(), 1, '向上滚轮必须立即取消会话进入计划');
    } finally {
      globalThis.document = globalDoc;
    }
  });
});
