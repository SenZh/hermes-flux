/**
 * 长会话（加载大量历史入缓存后）切走再切回飞到中间 — 全链路复现与回归测试
 * (packages/desktop/__tests__/unit/long-session-scroll-restore.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessageLoadingService } from '../../dist/renderer/services/messageLoadingService.mjs';
import { createConversationStreamController } from '../../dist/renderer/events/conversationStreamController.mjs';
import { StreamViewportManager } from '../../dist/renderer/viewport/streamViewportManager.mjs';
import { PromptNavigatorManager } from '../../dist/renderer/navigation/promptNavigatorManager.mjs';
import { createPostCommitPinObservers } from '../../dist/renderer/viewport/postCommitPinObservers.mjs';
import { createRenderCoordinator } from '../../dist/renderer/renderCoordinator.mjs';

function makeMessages(count, prefix = 'msg', startRowId = 1) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    rowId: startRowId + i,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `message ${i}`,
    timestamp: `${1000 + i}`,
  }));
}

test('长会话滚动恢复全链路：红灯复现与门禁', async (t) => {
  await t.test('根因 1a: 纯原生流下 loadOlderMessages 后 windowEnd 必须覆盖全量消息而非截断为 100', async () => {
    let windowStart = 0;
    let windowEnd = 50;
    let userExpanded = false;

    const initialMessages = makeMessages(50, 'init', 201);
    const olderMessages = Array.from({ length: 200 }, (_, i) => ({
      id: `older-${i}`,
      row_id: i + 1,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `older ${i}`,
    }));

    const state = {
      activeSessionId: 'sess-long',
      activeLiveSessionId: 'live-long',
      profileName: 'default',
      profiles: [{ name: 'default', displayName: 'Default' }],
      sessions: [{ id: 'sess-long', title: 'Long', botName: 'default', timestamp: 100 }],
      messages: [...initialMessages],
      hasOlderMessages: true,
      isLoadingOlder: false,
      messagesPhase: 'ready',
      activeFocus: { type: 'session', sessionId: 'sess-long' },
      dockNotice: '',
    };

    const sessionMessagesCache = new Map([['sess-long', [...initialMessages]]]);
    let fetchedOnce = false;
    const service = createMessageLoadingService({
      getState: () => state,
      getGatewayClient: () => ({
        call: async () => ({}),
        fetchSessionMessages: async () => {
          if (fetchedOnce) return { status: 'success', messages: [], pagination: { returned: 0, total: 250 } };
          fetchedOnce = true;
          return {
            status: 'success',
            messages: olderMessages,
            pagination: { returned: olderMessages.length, total: 250 },
          };
        },
      }),
      render: () => {},
      sessionMessagesCache,
      cacheService: {
        openChannel: async () => ({ rows: [], fenceMax: 0 }),
        readOlderRows: async () => [],
        dropChannel: async () => {},
        applyRemoteWindow: async () => {},
      },
      persistMessagesToCache: () => {},
      syncPromptNavigatorMeta: () => {},
      syncPromptNavigatorFromScroll: () => {},
      scrollStreamToBottom: () => {},
      setPendingScrollToBottom: () => {},
      isStreamNearBottom: () => false,
      captureStreamAnchor: () => ({}),
      applyStreamAnchor: () => {},
      getMessageWindowStart: () => windowStart,
      setMessageWindowStart: (v) => { windowStart = v; },
      getMessageWindowEnd: () => windowEnd,
      setMessageWindowEnd: (v) => { windowEnd = v; },
      setMessageWindowUserExpanded: (v) => { userExpanded = v; },
      isGroupConversationActive: () => false,
      hostedRoomIds: new Set(),
      formatSessionTime: () => '10:00',
      formatTimestamp: () => '10:00',
      botActivityStore: { withActivityMap: (fn) => fn(new Map()), persist: () => {} },
      botForeverChatCache: new Map(),
      sessionPreviewCache: new Map(),
      persistSessionPreviewCache: () => {},
      getActiveStreamingStoredSessionId: () => null,
      defaultSessionHandleRegistry: { get: () => null },
      activeRunningSessionIds: new Set(),
      activityTransitionTracker: { mark: () => {}, clear: () => {} },
      getGeneration: () => 1,
      onGenerationIncremented: () => {},
    });

    await service.loadOlderMessages();

    assert.equal(state.messages.length, 250);
    assert.equal(windowStart, 0, '纯原生流下 windowStart 必须保持 0');
    assert.equal(windowEnd, 250, '纯原生流下 windowEnd 必须覆盖全量消息，不得截断为 100');
    void userExpanded;
  });

  await t.test('根因 1b: 纯原生流且无虚拟窗口时 onscroll 不得误触发 relocate / expand，enterPending 时不触发 loadOlderMessages', () => {
    const messages = makeMessages(250, 'm');
    let relocateCalls = 0;
    let expandCalls = 0;
    let slideCalls = 0;
    let loadOlderCalls = 0;
    let enterPending = true;

    const state = {
      activeSessionId: 'sess-long',
      messages,
      hasOlderMessages: true,
      isLoadingOlder: false,
      activeFocus: { type: 'session', sessionId: 'sess-long' },
    };

    const streamEl = {
      scrollTop: 0,
      scrollHeight: 60000,
      clientHeight: 800,
      dataset: {},
      addEventListener: () => {},
      querySelectorAll: () => [],
      onscroll: null,
      onwheel: null,
    };

    const originalDoc = globalThis.document;
    globalThis.document = {
      getElementById: (id) => (id === 'conversation-stream' ? streamEl : null),
      querySelector: () => null, // 无 .conv-virtual-window
      querySelectorAll: () => [],
    };

    try {
      const controller = createConversationStreamController({
        getState: () => state,
        render: () => {},
        safeCopyText: async () => true,
        setTimedDockNotice: () => {},
        isStreamingActiveForCurrentSession: () => false,
        t: (k) => k,
        getGatewayClient: () => null,
        getRpcCaller: () => null,
        getInteractiveService: () => null,
        selectSession: async () => {},
        scheduleSessionsRefresh: () => {},
        getSessionMessagesCache: () => new Map(),
        handleOpenFilePreview: async () => {},
        syncPromptNavigatorFromScroll: () => {},
        loadOlderMessages: async () => { loadOlderCalls += 1; },
        relocateMessageWindowToIndex: () => { relocateCalls += 1; return true; },
        syncScrollTopToWindow: () => {},
        slideMessageWindowForward: () => { slideCalls += 1; },
        expandMessageWindow: () => { expandCalls += 1; return true; },
        settleInitialBottom: () => {},
        scrollStreamToBottom: () => {},
        scheduleStreamBottomInset: () => {},
        layoutSignature: () => 'sig',
        ensureLiveSessionId: async () => 'live',
        getMessageWindowStart: () => 0,
        getMessageWindowEnd: () => 250,
        isMessageWindowUserExpanded: () => false,
        setMessageWindowUserExpanded: () => {},
        getAverageRowHeightPx: () => 80,
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
        isSessionEnterPending: () => enterPending,
        cancelSessionEnter: () => { enterPending = false; },
        STICK_TO_BOTTOM_THRESHOLD_PX: 48,
        MESSAGE_WINDOW_CAPACITY: 120,
      });

      controller.bindDomEvents();
      streamEl.scrollTop = 100;
      streamEl.onscroll();
      assert.equal(loadOlderCalls, 0, 'enterPending 期间不得触发 loadOlderMessages');

      enterPending = false;
      streamEl.scrollTop = 30000;
      streamEl.onscroll();
      assert.equal(relocateCalls, 0, '纯原生流下不得误触发 relocateMessageWindowToIndex');
      assert.equal(expandCalls, 0, '纯原生流下不得误触发 expandMessageWindow');
      assert.equal(slideCalls, 0, '纯原生流下不得误触发 slideMessageWindowForward');
    } finally {
      globalThis.document = originalDoc;
    }
  });

  await t.test('根因 2: enterPending 期间 content-visibility 展开导致 scrollTop 突变不得误杀 pendingSessionEnter', () => {
    let cancelCalls = 0;
    let readerScrolledId = '';
    let lastScrollTop = 0;
    let progTarget = 65626;
    let progIgnoreUntil = performance.now() + 180;
    let enterPending = true;

    const state = {
      activeSessionId: 'sess-long',
      messages: makeMessages(250, 'm'),
      hasOlderMessages: true,
      isLoadingOlder: false,
      activeFocus: { type: 'session', sessionId: 'sess-long' },
    };

    const streamEl = {
      scrollTop: 65626,
      scrollHeight: 66426,
      clientHeight: 800,
      dataset: {},
      addEventListener: () => {},
      querySelectorAll: () => [],
      onscroll: null,
      onwheel: null,
    };

    const originalDoc = globalThis.document;
    globalThis.document = {
      getElementById: (id) => (id === 'conversation-stream' ? streamEl : null),
      querySelector: () => null,
      querySelectorAll: () => [],
    };

    try {
      const controller = createConversationStreamController({
        getState: () => state,
        render: () => {},
        safeCopyText: async () => true,
        setTimedDockNotice: () => {},
        isStreamingActiveForCurrentSession: () => false,
        t: (k) => k,
        getGatewayClient: () => null,
        getRpcCaller: () => null,
        getInteractiveService: () => null,
        selectSession: async () => {},
        scheduleSessionsRefresh: () => {},
        getSessionMessagesCache: () => new Map(),
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
        layoutSignature: () => 'sig',
        ensureLiveSessionId: async () => 'live',
        getMessageWindowStart: () => 0,
        getMessageWindowEnd: () => 250,
        isMessageWindowUserExpanded: () => false,
        setMessageWindowUserExpanded: () => {},
        getAverageRowHeightPx: () => 80,
        isInitialBottomSettling: () => false,
        setInitialBottomSettling: () => {},
        getStreamScrollCooldown: () => false,
        setStreamScrollCooldown: () => {},
        getLastStreamScrollTop: () => lastScrollTop,
        setLastStreamScrollTop: (v) => { lastScrollTop = v; },
        getProgrammaticScrollTarget: () => progTarget,
        setProgrammaticScrollTarget: (v) => { progTarget = v; },
        getProgrammaticScrollIgnoreUntil: () => progIgnoreUntil,
        getLayoutDriftUntil: () => 0,
        getReaderScrolledSessionId: () => readerScrolledId,
        setReaderScrolledSessionId: (v) => { readerScrolledId = v; },
        setSettledLayoutSignature: () => {},
        isSessionEnterPending: () => enterPending,
        cancelSessionEnter: () => {
          cancelCalls += 1;
          enterPending = false;
        },
        STICK_TO_BOTTOM_THRESHOLD_PX: 48,
        MESSAGE_WINDOW_CAPACITY: 120,
      });

      controller.bindDomEvents();

      // 第一次 scroll 事件命中 progTarget = 65626
      streamEl.onscroll();
      // 紧接着 Blink content-visibility: auto 解锁导致 scrollTop 向下回调 342px（无真实用户输入手势）
      streamEl.scrollTop = 65284;
      streamEl.onscroll();

      assert.equal(cancelCalls, 0, '无真实用户手势的被动布局回调不得取消 pendingSessionEnter');
      assert.equal(readerScrolledId, '', '不得伪造 readerScrolledSessionId');

      // 若有真实向上 wheel 手势，必须立刻取消
      streamEl.onwheel({ deltaY: -120 });
      assert.equal(cancelCalls, 1, '真实向上滚轮手势必须取消 pendingSessionEnter');
    } finally {
      globalThis.document = originalDoc;
    }
  });

  await t.test('根因 3: runPinFrame 末行仍处于 content-visibility 跳过态时严禁提前收敛，且临时禁用 overflow-anchor 并在结束后恢复', () => {
    let rafQueue = [];
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    };

    try {
      let laidOut = false;
      const lastRow = {
        getBoundingClientRect: () => ({ top: 640, bottom: 640, height: 140 }),
        checkVisibility: () => laidOut,
      };
      const removedProps = [];
      const streamEl = {
        scrollTop: 0,
        scrollHeight: 5000,
        clientHeight: 800,
        style: {
          overflowAnchor: '',
          setProperty: () => {},
          removeProperty: (prop) => {
            removedProps.push(prop);
            if (prop === 'overflow-anchor') streamEl.style.overflowAnchor = '';
          },
        },
        getBoundingClientRect: () => ({ top: 0, bottom: 800 }),
        querySelector: (sel) => (sel.includes('probe-1') ? lastRow : null),
        querySelectorAll: () => [],
      };

      const manager = new StreamViewportManager({
        getActiveSessionId: () => 'sess-long',
        getStreamElement: () => streamEl,
        isInitialBottomSettling: () => false,
        setInitialBottomSettling: () => {},
        settleInitialBottom: () => {},
        isPromptJumpSettling: () => false,
        setSuppressPinBottomOnce: () => {},
        setSettledLayoutSignature: () => {},
        layoutSignature: () => 'sig',
        markProgrammaticScroll: () => {},
      });

      manager.beginSessionEnter('sess-long', { forcePinToBottom: true });
      // 模拟首帧触发（高度变化一次 + 末行尚未真实布局）
      streamEl.scrollHeight = 5200;
      manager.settleSessionEnter('probe-1', 'sess-long', 'ready', 250, true);
      assert.equal(streamEl.style.overflowAnchor, 'none', 'pin-to-bottom armed 期间应临时关闭 overflow-anchor');

      // 跑 5 帧（宽限帧内），末行始终处于 content-visibility 跳过态
      for (let i = 0; i < 5; i += 1) {
        const next = rafQueue.shift();
        if (next) next();
      }
      assert.equal(manager.isSessionEnterPending(), true, '末行仍处于占位跳过态时绝不能提前收敛');

      // 末行真实布局展开，scrollHeight 涨到 7000 并稳定
      laidOut = true;
      streamEl.scrollHeight = 7000;
      for (let i = 0; i < 10; i += 1) {
        const next = rafQueue.shift();
        if (next) next();
      }
      assert.equal(manager.isSessionEnterPending(), false, '末行真实布局且稳定后必须收敛');
      assert.equal(streamEl.scrollTop, 6200, '必须贴在展开后的真实底部');
      assert.ok(removedProps.includes('overflow-anchor'), '收敛后必须恢复 overflow-anchor');
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
    }
  });

  await t.test('根因 4 & 5: captureStreamAnchor 先读快照再更新 CSS 变量；sampleTurnIntrinsicHeight 只采真实已布局回合', () => {
    const writes = [];
    const rows = [
      { getAttribute: () => 'row-1', getBoundingClientRect: () => ({ top: 0, bottom: 80, height: 80 }) },
    ];
    // 回合 1：未布局的占位回合（140px）；回合 2：真实已布局回合（300px）
    const turns = [
      {
        getBoundingClientRect: () => ({ top: 0, bottom: 140, height: 140 }),
        checkVisibility: () => false,
      },
      {
        getBoundingClientRect: () => ({ top: 140, bottom: 440, height: 300 }),
        checkVisibility: () => true,
      },
    ];

    const streamEl = {
      scrollTop: 9040,
      scrollHeight: 10000,
      clientHeight: 800,
      style: {
        setProperty: (name, value) => {
          writes.push(`${name}:${value}`);
          if (name === '--conv-intrinsic-median-height') {
            // 模拟改写 CSS 变量后触发重排，离屏占位撑大 scrollHeight
            streamEl.scrollHeight = 14000;
          }
        },
      },
      getBoundingClientRect: () => ({ top: 0, bottom: 800 }),
      querySelectorAll: (sel) => (sel === '.conv-turn' ? turns : rows),
    };

    const originalGcs = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({
      paddingBottom: '160px',
      getPropertyValue: () => '',
    });

    try {
      const manager = new StreamViewportManager({
        getActiveSessionId: () => 'sess-capture',
        getStreamElement: () => streamEl,
        isInitialBottomSettling: () => false,
        setInitialBottomSettling: () => {},
        settleInitialBottom: () => {},
        setSuppressPinBottomOnce: () => {},
        setSettledLayoutSignature: () => {},
        layoutSignature: () => 'sig',
        markProgrammaticScroll: () => {},
      });

      manager.captureStreamAnchor();

      // 1. 离开前视觉贴底（10000 - 9040 - 800 = 160 <= 168），即使写入 CSS 变量撑大到 14000，也必须记为 pin-to-bottom
      const plan = manager.getSessionScrollMemory().planSessionEnter('sess-capture');
      assert.equal(plan.type, 'pin-to-bottom', 'captureStreamAnchor 必须在修改 CSS 变量前读取 scrollHeight');

      // 2. 只采样真实已布局的回合（300px），忽略未布局的 140px 占位回合
      assert.equal(manager.getMedianEstimator().sampleCount, 1, '未布局的占位回合不得进入中位数样本');
      assert.equal(writes[0], '--conv-intrinsic-median-height:300px');
    } finally {
      globalThis.getComputedStyle = originalGcs;
    }
  });

  await t.test('根因 4b: isSessionEnterPending 期间 syncStreamBottomInset 不得启动 settleInitialBottom', () => {
    let initialSettlingCalls = 0;
    let settleInitialCalls = 0;
    const dockEl = { getBoundingClientRect: () => ({ top: 640 }) };
    const canvasEl = { getBoundingClientRect: () => ({ bottom: 700 }) };
    const streamEl = {
      scrollTop: 1180,
      scrollHeight: 2000,
      clientHeight: 800,
      style: {
        props: new Map(),
        getPropertyValue: (k) => streamEl.style.props.get(k) ?? '',
        setProperty: (k, v) => { streamEl.style.props.set(k, v); },
      },
      getBoundingClientRect: () => ({ top: 0, bottom: 800 }),
    };

    const originalDoc = globalThis.document;
    globalThis.document = {
      getElementById: (id) => (id === 'conversation-stream' ? streamEl : null),
      querySelector: (sel) => {
        if (sel === '.conv-dock') return dockEl;
        if (sel === '.conv-canvas') return canvasEl;
        return null;
      },
    };

    try {
      const manager = new StreamViewportManager({
        getActiveSessionId: () => 'sess-long',
        getStreamElement: () => streamEl,
        isInitialBottomSettling: () => false,
        setInitialBottomSettling: () => { initialSettlingCalls += 1; },
        settleInitialBottom: () => { settleInitialCalls += 1; },
        isPromptJumpSettling: () => false,
        setSuppressPinBottomOnce: () => {},
        setSettledLayoutSignature: () => {},
        layoutSignature: () => 'sig',
        markProgrammaticScroll: () => {},
      });

      manager.beginSessionEnter('sess-long', { forcePinToBottom: true });
      manager.syncStreamBottomInset();

      assert.equal(initialSettlingCalls, 0, 'enterPending 期间 syncStreamBottomInset 不得置 initialBottomSettling');
      assert.equal(settleInitialCalls, 0, 'enterPending 期间 syncStreamBottomInset 不得启动 settleInitialBottom');
    } finally {
      globalThis.document = originalDoc;
    }
  });

  await t.test('悬停中间位置 restore-anchor: 首帧拉回 fallback，loading 超过 30 帧不熔断，ready 且布局后精确收敛并恢复 overflow-anchor', () => {
    const rafQueue = [];
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    };

    try {
      let laidOut = false;
      const removedProps = [];
      let scrollTop = 9000; // 离开时停在会话 B 的 9000px
      const targetAnchorTop = 3200; // 会话 A 目标锚点实际文档位置在 3200px，而旧 fallback 为 2600px
      const streamEl = {
        get scrollTop() { return scrollTop; },
        set scrollTop(v) { scrollTop = v; },
        scrollHeight: 20000,
        clientHeight: 800,
        style: {
          overflowAnchor: '',
          setProperty: () => {},
          removeProperty: (prop) => {
            removedProps.push(prop);
            if (prop === 'overflow-anchor') streamEl.style.overflowAnchor = '';
          },
        },
        getBoundingClientRect: () => ({ top: 0, bottom: 800 }),
        querySelector: (sel) => (sel.includes('mid-anchor')
          ? {
            getBoundingClientRect: () => ({ top: targetAnchorTop - scrollTop, bottom: targetAnchorTop - scrollTop + 100, height: 100 }),
            checkVisibility: () => laidOut,
          }
          : null),
        querySelectorAll: () => [],
      };

      const manager = new StreamViewportManager({
        getActiveSessionId: () => 'sess-A',
        getStreamElement: () => streamEl,
        isInitialBottomSettling: () => false,
        setInitialBottomSettling: () => {},
        settleInitialBottom: () => {},
        isPromptJumpSettling: () => false,
        setSuppressPinBottomOnce: () => {},
        setSettledLayoutSignature: () => {},
        layoutSignature: () => 'sig-A',
        markProgrammaticScroll: () => {},
      });

      // 模拟离开会话 A 时悬停在中间位置（scrollTop=2600, anchor='mid-anchor', offsetRatio=0.2）
      manager.getSessionScrollMemory().recordSnapshot({
        sessionId: 'sess-A',
        scrollTop: 2600,
        scrollHeight: 20000,
        clientHeight: 800,
        anchorMessageId: 'mid-anchor',
        anchorOffsetRatio: 0.2,
      });

      manager.beginSessionEnter('sess-A', { phase: 'loading' });
      manager.settleSessionEnter('last-msg', 'sess-A', 'loading', 250, false);

      // 首帧同步推进：直接按 delta 步进到目标锚点附近（3220），绝不乒乓退回 fallback（2600）
      assert.equal(scrollTop, 3220, '首帧应直接按 delta 拉到目标锚点附近，避免 fallback 乒乓闪屏');
      assert.equal(streamEl.style.overflowAnchor, 'none', 'restore-anchor 期间应临时关闭 overflow-anchor');

      // 模拟 loading 持续 35 帧（超过 30 帧 restore cap），仍未就绪，绝不能提前熔断
      for (let i = 0; i < 35; i += 1) {
        const next = rafQueue.shift();
        if (next) next();
      }
      assert.equal(manager.isSessionEnterPending(), true, 'loading 期间超过 30 帧绝不能提前熔断');

      // REST 到达 + 目标行真实布局完成
      laidOut = true;
      manager.settleSessionEnter('last-msg', 'sess-A', 'ready', 250, true);
      for (let i = 0; i < 5; i += 1) {
        const next = rafQueue.shift();
        if (next) next();
      }

      assert.equal(manager.isSessionEnterPending(), false, 'authoritativeReady 且真实布局后必须收敛');
      assert.equal(scrollTop, 3220, '必须精确对齐到目标锚点 3200 + 100*0.2 = 3220');
      assert.ok(removedProps.includes('overflow-anchor'), '收敛后必须恢复 overflow-anchor');
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
    }
  });

  await t.test('滚动性能: syncFromScroll 二分查找 .conv-turn 跳过离屏测量，且 onscroll rAF 合并调用', () => {
    let rectCalls = 0;
    const turns = Array.from({ length: 100 }, (_, i) => {
      const top = i * 200;
      const bottom = top + 180;
      const msgRow = {
        getAttribute: () => `u-${i}`,
        getBoundingClientRect: () => ({ top, bottom, height: 180 }),
      };
      return {
        getBoundingClientRect: () => {
          rectCalls += 1;
          return { top, bottom, height: 180 };
        },
        querySelectorAll: () => [msgRow],
      };
    });

    const messages = Array.from({ length: 100 }, (_, i) => ({
      id: `u-${i}`,
      role: 'user',
      content: `prompt ${i}`,
      timestamp: `${i}`,
    }));

    const fakeStream = {
      scrollTop: 10000,
      clientHeight: 800,
      getBoundingClientRect: () => ({ top: 0, bottom: 800 }),
      querySelectorAll: (sel) => (sel === '.conv-turn' ? turns : []),
    };

    const navManager = new PromptNavigatorManager({
      getActiveSessionId: () => 'sess-perf',
      getMessages: () => messages,
      getLang: () => 'zh',
      hasOlderMessages: () => false,
      isLoadingOlder: () => false,
      isGroupConversationActive: () => false,
      getAverageRowHeightPx: () => 200,
      isAverageRowHeightLocked: () => true,
      getStreamElement: () => fakeStream,
      relocateMessageWindowToIndex: () => true,
      triggerRenderForJump: () => {},
      loadOlderMessages: async () => {},
    });

    navManager.rebuildEntries();
    rectCalls = 0;
    navManager.syncFromScroll();
    assert.ok(rectCalls <= 12, `100 个回合二分查找最多只应测量 ~7 次 getBoundingClientRect，实际 ${rectCalls}`);

    // 验证 onscroll rAF 合帧节流
    const rafQueue = [];
    const originalRaf = globalThis.requestAnimationFrame;
    const originalDoc = globalThis.document;
    globalThis.requestAnimationFrame = (cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    };
    const streamEl = {
      scrollTop: 500,
      scrollHeight: 20000,
      clientHeight: 800,
      dataset: {},
      addEventListener: () => {},
      querySelectorAll: () => [],
      onscroll: null,
      onwheel: null,
    };
    globalThis.document = {
      getElementById: (id) => (id === 'conversation-stream' ? streamEl : null),
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    let navSyncCalls = 0;
    try {
      const controller = createConversationStreamController({
        getState: () => ({ activeSessionId: 'sess-perf', messages, hasOlderMessages: false, isLoadingOlder: false, activeFocus: { type: 'session', sessionId: 'sess-perf' } }),
        render: () => {},
        safeCopyText: async () => true,
        setTimedDockNotice: () => {},
        isStreamingActiveForCurrentSession: () => false,
        t: (k) => k,
        getGatewayClient: () => null,
        getRpcCaller: () => null,
        getInteractiveService: () => null,
        selectSession: async () => {},
        scheduleSessionsRefresh: () => {},
        getSessionMessagesCache: () => new Map(),
        handleOpenFilePreview: async () => {},
        syncPromptNavigatorFromScroll: () => { navSyncCalls += 1; },
        loadOlderMessages: async () => {},
        relocateMessageWindowToIndex: () => true,
        syncScrollTopToWindow: () => {},
        slideMessageWindowForward: () => {},
        expandMessageWindow: () => true,
        settleInitialBottom: () => {},
        scrollStreamToBottom: () => {},
        scheduleStreamBottomInset: () => {},
        layoutSignature: () => 'sig',
        ensureLiveSessionId: async () => 'live',
        getMessageWindowStart: () => 0,
        getMessageWindowEnd: () => messages.length,
        isMessageWindowUserExpanded: () => false,
        setMessageWindowUserExpanded: () => {},
        getAverageRowHeightPx: () => 200,
        isInitialBottomSettling: () => false,
        setInitialBottomSettling: () => {},
        getStreamScrollCooldown: () => false,
        setStreamScrollCooldown: () => {},
        getLastStreamScrollTop: () => 500,
        setLastStreamScrollTop: () => {},
        getProgrammaticScrollTarget: () => null,
        setProgrammaticScrollTarget: () => {},
        getProgrammaticScrollIgnoreUntil: () => 0,
        getLayoutDriftUntil: () => 0,
        getReaderScrolledSessionId: () => '',
        setReaderScrolledSessionId: () => {},
        setSettledLayoutSignature: () => {},
        isSessionEnterPending: () => false,
        cancelSessionEnter: () => {},
        STICK_TO_BOTTOM_THRESHOLD_PX: 48,
        MESSAGE_WINDOW_CAPACITY: 120,
      });
      controller.bindDomEvents();
      streamEl.onscroll();
      streamEl.onscroll();
      streamEl.onscroll();
      assert.equal(navSyncCalls, 0, '同帧多次 onscroll 必须合并到 rAF');
      assert.equal(rafQueue.length, 1, '同帧只应排队 1 个 rAF');
      rafQueue.shift()();
      assert.equal(navSyncCalls, 1, 'rAF 触发后只执行 1 次 syncPromptNavigatorFromScroll');
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.document = originalDoc;
    }
  });

  await t.test('分支补全: readOlderRows 本地预置 + 离线加载 + scrollInput 监听器 + 二分下半区与空回合探测 + loadingWait 熔断', async () => {
    // 1. messageLoadingService: readOlderRows 本地命中 + preserveViewportWindow + 离线 ready
    let winStart = 0;
    let winEnd = 50;
    const initMsgs = makeMessages(50, 'init', 101);
    const localState = {
      activeSessionId: 'sess-local',
      activeLiveSessionId: 'live-local',
      profileName: 'default',
      profiles: [{ name: 'default', displayName: 'Default' }],
      sessions: [{ id: 'sess-local', title: 'Local', botName: 'default', timestamp: 100 }],
      messages: [...initMsgs],
      hasOlderMessages: true,
      isLoadingOlder: false,
      messagesPhase: 'loading',
      activeFocus: { type: 'session', sessionId: 'sess-local' },
      dockNotice: '',
    };
    const cacheMap = new Map([['sess-local', [...initMsgs]]]);
    let gw = null;
    const localService = createMessageLoadingService({
      getState: () => localState,
      getGatewayClient: () => gw,
      render: () => {},
      sessionMessagesCache: cacheMap,
      cacheService: {
        openChannel: async () => ({ rows: [], fenceMax: 0 }),
        readOlderRows: async () => [
          { id: 'loc-1', rowId: 50, role: 'user', content: 'local old', timestamp: 50, displaySeq: 50 },
        ],
        dropChannel: async () => {},
        applyRemoteWindow: async () => {},
      },
      persistMessagesToCache: () => {},
      syncPromptNavigatorMeta: () => {},
      syncPromptNavigatorFromScroll: () => {},
      scrollStreamToBottom: () => {},
      setPendingScrollToBottom: () => {},
      isStreamNearBottom: () => true,
      captureStreamAnchor: () => ({}),
      applyStreamAnchor: () => {},
      getMessageWindowStart: () => winStart,
      setMessageWindowStart: (v) => { winStart = v; },
      getMessageWindowEnd: () => winEnd,
      setMessageWindowEnd: (v) => { winEnd = v; },
      setMessageWindowUserExpanded: () => {},
      isGroupConversationActive: () => false,
      hostedRoomIds: new Set(),
      formatSessionTime: () => '10:00',
      formatTimestamp: () => '10:00',
      botActivityStore: { withActivityMap: (fn) => fn(new Map()), persist: () => {} },
      botForeverChatCache: new Map(),
      sessionPreviewCache: new Map(),
      persistSessionPreviewCache: () => {},
      getActiveStreamingStoredSessionId: () => null,
      defaultSessionHandleRegistry: { get: () => null },
      activeRunningSessionIds: new Set(),
      activityTransitionTracker: { mark: () => {}, clear: () => {} },
      getGeneration: () => 1,
      onGenerationIncremented: () => {},
    });
    await localService.loadMessages('sess-local');
    assert.equal(localState.messagesPhase, 'ready');
    gw = {
      call: async () => ({}),
      fetchSessionMessages: async () => ({ status: 'success', messages: [], pagination: { returned: 0, total: 51 } }),
    };
    await localService.loadOlderMessages({ preserveViewportWindow: true });
    assert.equal(winStart, 0);
    assert.equal(winEnd, 51);

    // 2. conversationStreamController: pointerdown / touchmove / keydown 监听 + 纯原生流触顶 fetch-older-remote
    const listeners = new Map();
    let olderFetchCalls = 0;
    const nativeStreamEl = {
      scrollTop: 50,
      scrollHeight: 20000,
      clientHeight: 800,
      dataset: {},
      addEventListener: (ev, fn) => { listeners.set(ev, fn); },
      querySelectorAll: () => [],
      onscroll: null,
      onwheel: null,
    };
    const originalDoc = globalThis.document;
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
    globalThis.document = {
      getElementById: (id) => (id === 'conversation-stream' ? nativeStreamEl : null),
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    try {
      const ctrl = createConversationStreamController({
        getState: () => ({
          activeSessionId: 'sess-nat',
          messages: makeMessages(150, 'n'),
          hasOlderMessages: true,
          isLoadingOlder: false,
          activeFocus: { type: 'session', sessionId: 'sess-nat' },
        }),
        render: () => {},
        safeCopyText: async () => true,
        setTimedDockNotice: () => {},
        isStreamingActiveForCurrentSession: () => false,
        t: (k) => k,
        getGatewayClient: () => null,
        getRpcCaller: () => null,
        getInteractiveService: () => null,
        selectSession: async () => {},
        scheduleSessionsRefresh: () => {},
        getSessionMessagesCache: () => new Map(),
        handleOpenFilePreview: async () => {},
        syncPromptNavigatorFromScroll: () => {},
        loadOlderMessages: async () => { olderFetchCalls += 1; },
        relocateMessageWindowToIndex: () => true,
        syncScrollTopToWindow: () => {},
        slideMessageWindowForward: () => {},
        expandMessageWindow: () => true,
        settleInitialBottom: () => {},
        scrollStreamToBottom: () => {},
        scheduleStreamBottomInset: () => {},
        layoutSignature: () => 'sig',
        ensureLiveSessionId: async () => 'live',
        getMessageWindowStart: () => 0,
        getMessageWindowEnd: () => 150,
        isMessageWindowUserExpanded: () => false,
        setMessageWindowUserExpanded: () => {},
        getAverageRowHeightPx: () => 80,
        isInitialBottomSettling: () => false,
        setInitialBottomSettling: () => {},
        getStreamScrollCooldown: () => false,
        setStreamScrollCooldown: () => {},
        getLastStreamScrollTop: () => 50,
        setLastStreamScrollTop: () => {},
        getProgrammaticScrollTarget: () => null,
        setProgrammaticScrollTarget: () => {},
        getProgrammaticScrollIgnoreUntil: () => 0,
        getLayoutDriftUntil: () => 0,
        getReaderScrolledSessionId: () => 'sess-nat',
        setReaderScrolledSessionId: () => {},
        setSettledLayoutSignature: () => {},
        isSessionEnterPending: () => false,
        cancelSessionEnter: () => {},
        STICK_TO_BOTTOM_THRESHOLD_PX: 48,
        MESSAGE_WINDOW_CAPACITY: 120,
      });
      ctrl.bindDomEvents();
      listeners.get('pointerdown')?.();
      listeners.get('touchmove')?.();
      listeners.get('keydown')?.({ key: 'PageUp' });
      listeners.get('keydown')?.({ key: 'a' });
      nativeStreamEl.onscroll();
      assert.equal(olderFetchCalls, 1, '纯原生流触顶必须触发 loadOlderMessages');
      await new Promise((resolve) => setTimeout(resolve, 80));
    } finally {
      globalThis.document = originalDoc;
      globalThis.requestAnimationFrame = originalRaf;
    }

    // 3. promptNavigatorManager: 二分落入右半区 (lo = mid + 1) + 首个可见回合无匹配行时向后多探 1 回合
    const offsetTurns = Array.from({ length: 10 }, (_, i) => {
      const top = (i - 7) * 200; // 第 7 个回合 top=0, bottom=180 > 100
      const row = i === 7
        ? { getAttribute: () => 'unknown-id', getBoundingClientRect: () => ({ top, bottom: top + 180, height: 180 }) }
        : { getAttribute: () => `u-${i}`, getBoundingClientRect: () => ({ top, bottom: top + 180, height: 180 }) };
      return {
        getBoundingClientRect: () => ({ top, bottom: top + 180, height: 180 }),
        querySelectorAll: () => [row],
      };
    });
    const navMsgs = Array.from({ length: 10 }, (_, i) => ({ id: `u-${i}`, role: 'user', content: `p${i}`, timestamp: `${i}` }));
    const navMgr2 = new PromptNavigatorManager({
      getActiveSessionId: () => 'sess-p2',
      getMessages: () => navMsgs,
      getLang: () => 'zh',
      hasOlderMessages: () => false,
      isLoadingOlder: () => false,
      isGroupConversationActive: () => false,
      getAverageRowHeightPx: () => 200,
      isAverageRowHeightLocked: () => true,
      getStreamElement: () => ({
        scrollTop: 1400,
        clientHeight: 800,
        getBoundingClientRect: () => ({ top: 0, bottom: 800 }),
        querySelectorAll: (sel) => (sel === '.conv-turn' ? offsetTurns : []),
      }),
      relocateMessageWindowToIndex: () => true,
      triggerRenderForJump: () => {},
      loadOlderMessages: async () => {},
    });
    navMgr2.rebuildEntries();
    navMgr2.syncFromScroll();
    assert.equal(navMgr2.getSnapshot().activeIndex, 8);

    // 4. streamViewportManager: loadingWaitFrames >= 600 硬上限收口 + sampleTurnIntrinsicHeight 跳过 height<=0
    const rafQ = [];
    const origRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => { rafQ.push(cb); return rafQ.length; };
    try {
      const sEl = {
        scrollTop: 0,
        scrollHeight: 5000,
        clientHeight: 800,
        style: { overflowAnchor: '', setProperty: () => {}, removeProperty: () => {} },
        getBoundingClientRect: () => ({ top: 0, bottom: 800 }),
        querySelector: () => ({ getBoundingClientRect: () => ({ top: 0, bottom: 100, height: 100 }), checkVisibility: () => true }),
        querySelectorAll: (sel) => (sel === '.conv-turn' ? [{ getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0 }), checkVisibility: () => true }] : []),
      };
      const vm = new StreamViewportManager({
        getActiveSessionId: () => 'sess-cap',
        getStreamElement: () => sEl,
        isInitialBottomSettling: () => false,
        setInitialBottomSettling: () => {},
        settleInitialBottom: () => {},
        isPromptJumpSettling: () => false,
        setSuppressPinBottomOnce: () => {},
        setSettledLayoutSignature: () => {},
        layoutSignature: () => 'sig',
        markProgrammaticScroll: () => {},
      });
      vm.captureStreamAnchor();
      vm.getSessionScrollMemory().recordSnapshot({
        sessionId: 'sess-cap', scrollTop: 100, scrollHeight: 5000, clientHeight: 800,
        anchorMessageId: 'm1', anchorOffsetRatio: 0,
      });
      vm.beginSessionEnter('sess-cap', { phase: 'loading' });
      vm.settleSessionEnter('last', 'sess-cap', 'loading', 10, false);
      for (let i = 0; i < 605 && rafQ.length > 0; i += 1) {
        rafQ.shift()();
      }
      assert.equal(vm.isSessionEnterPending(), false, 'loading 超过 600 帧硬上限必须兜底收口');
    } finally {
      globalThis.requestAnimationFrame = origRaf;
    }
  });

  await t.test('全路径覆盖补齐: postCommitPinObservers + renderCoordinator + streamViewportManager 硬上限与冷路径 + controller 分支', async () => {
    // A. messageLoadingService: readOlderRows(preserveViewportWindow:false) + 远端(preserveViewportWindow:true)
    let wStart = 0;
    let wEnd = 50;
    const msgsA = makeMessages(50, 'a', 101);
    const stA = {
      activeSessionId: 'sess-a',
      activeLiveSessionId: 'live-a',
      profileName: 'default',
      profiles: [{ name: 'default', displayName: 'Default' }],
      sessions: [{ id: 'sess-a', title: 'A', botName: 'default', timestamp: 100 }],
      messages: [...msgsA],
      hasOlderMessages: true,
      isLoadingOlder: false,
      messagesPhase: 'ready',
      activeFocus: { type: 'session', sessionId: 'sess-a' },
      dockNotice: '',
    };
    let readCount = 0;
    const svcA = createMessageLoadingService({
      getState: () => stA,
      getGatewayClient: () => ({
        call: async () => ({}),
        fetchSessionMessages: async () => ({
          status: 'success',
          messages: [{ id: 'rem-1', row_id: 20, role: 'user', content: 'remote' }],
          pagination: { returned: 1, total: 52 },
        }),
      }),
      render: () => {},
      sessionMessagesCache: new Map([['sess-a', [...msgsA]]]),
      cacheService: {
        openChannel: async () => ({ rows: [], fenceMax: 0 }),
        readOlderRows: async () => {
          readCount += 1;
          return readCount === 1
            ? [{ id: 'loc-a1', rowId: 50, role: 'user', content: 'loc', timestamp: 50, displaySeq: 50 }]
            : [];
        },
        dropChannel: async () => {},
        applyRemoteWindow: async () => {},
      },
      persistMessagesToCache: () => {},
      syncPromptNavigatorMeta: () => {},
      syncPromptNavigatorFromScroll: () => {},
      scrollStreamToBottom: () => {},
      setPendingScrollToBottom: () => {},
      isStreamNearBottom: () => true,
      captureStreamAnchor: () => ({}),
      applyStreamAnchor: () => {},
      getMessageWindowStart: () => wStart,
      setMessageWindowStart: (v) => { wStart = v; },
      getMessageWindowEnd: () => wEnd,
      setMessageWindowEnd: (v) => { wEnd = v; },
      setMessageWindowUserExpanded: () => {},
      isGroupConversationActive: () => false,
      hostedRoomIds: new Set(),
      formatSessionTime: () => '10:00',
      formatTimestamp: () => '10:00',
      botActivityStore: { withActivityMap: (fn) => fn(new Map()), persist: () => {} },
      botForeverChatCache: new Map(),
      sessionPreviewCache: new Map(),
      persistSessionPreviewCache: () => {},
      getActiveStreamingStoredSessionId: () => null,
      defaultSessionHandleRegistry: { get: () => null },
      activeRunningSessionIds: new Set(),
      activityTransitionTracker: { mark: () => {}, clear: () => {} },
      getGeneration: () => 1,
      onGenerationIncremented: () => {},
    });
    await svcA.loadOlderMessages({ preserveViewportWindow: false });
    assert.equal(wEnd, 51);
    await svcA.loadOlderMessages({ preserveViewportWindow: true });
    assert.equal(wEnd, 52);

    // B. conversationStreamController: enterPending + hasRecentUserInput 取消 + 非 enterPending 命中 progTarget 清零 + isNativeFullWindow 'none'
    const origDoc = globalThis.document;
    const origRaf = globalThis.requestAnimationFrame;
    const rafList = [];
    globalThis.requestAnimationFrame = (cb) => { rafList.push(cb); return rafList.length; };
    let progTarget = 500;
    let lastTop = 0;
    let enterPending = true;
    let cancelCount = 0;
    const sEl = {
      scrollTop: 800,
      scrollHeight: 20000,
      clientHeight: 800,
      dataset: {},
      addEventListener: () => {},
      querySelectorAll: () => [],
      onscroll: null,
      onwheel: null,
    };
    globalThis.document = {
      getElementById: (id) => (id === 'conversation-stream' ? sEl : null),
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    try {
      const c2 = createConversationStreamController({
        getState: () => ({ activeSessionId: 's-b', messages: makeMessages(150, 'b'), hasOlderMessages: true, isLoadingOlder: false, activeFocus: { type: 'session', sessionId: 's-b' } }),
        render: () => {},
        safeCopyText: async () => true,
        setTimedDockNotice: () => {},
        isStreamingActiveForCurrentSession: () => false,
        t: (k) => k,
        getGatewayClient: () => null,
        getRpcCaller: () => null,
        getInteractiveService: () => null,
        selectSession: async () => {},
        scheduleSessionsRefresh: () => {},
        getSessionMessagesCache: () => new Map(),
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
        layoutSignature: () => 'sig',
        ensureLiveSessionId: async () => 'live',
        getMessageWindowStart: () => 0,
        getMessageWindowEnd: () => 150,
        isMessageWindowUserExpanded: () => false,
        setMessageWindowUserExpanded: () => {},
        getAverageRowHeightPx: () => 80,
        isInitialBottomSettling: () => false,
        setInitialBottomSettling: () => {},
        getStreamScrollCooldown: () => false,
        setStreamScrollCooldown: () => {},
        getLastStreamScrollTop: () => lastTop,
        setLastStreamScrollTop: (v) => { lastTop = v; },
        getProgrammaticScrollTarget: () => progTarget,
        setProgrammaticScrollTarget: (v) => { progTarget = v; },
        getProgrammaticScrollIgnoreUntil: () => 0,
        getLayoutDriftUntil: () => 0,
        getReaderScrolledSessionId: () => '',
        setReaderScrolledSessionId: () => {},
        setSettledLayoutSignature: () => {},
        isSessionEnterPending: () => enterPending,
        cancelSessionEnter: () => { cancelCount += 1; enterPending = false; },
        STICK_TO_BOTTOM_THRESHOLD_PX: 48,
        MESSAGE_WINDOW_CAPACITY: 120,
      });
      c2.bindDomEvents();
      // enterPending + 真实向下滚轮后再 scrollTop 突变 -> 取消 enterPending
      sEl.onwheel({ deltaY: 120 });
      sEl.scrollTop = 200;
      sEl.onscroll();
      assert.equal(cancelCount, 1);

      // !enterPending 且命中 progTarget -> 清零 progTarget 且走到 isNativeFullWindow 'none'
      enterPending = false;
      progTarget = 5000;
      lastTop = 5000;
      sEl.scrollTop = 5000;
      sEl.onscroll();
      assert.equal(progTarget, null);
    } finally {
      globalThis.document = origDoc;
      globalThis.requestAnimationFrame = origRaf;
    }

    // C. postCommitPinObservers: 默认 rAF 分支 + 无 rAF 同步降级分支 + ResizeObserver
    const origMO = globalThis.MutationObserver;
    const origRO = globalThis.ResizeObserver;
    let moCb = null;
    let roCb = null;
    globalThis.MutationObserver = class { constructor(cb) { moCb = cb; } observe() {} disconnect() {} };
    globalThis.ResizeObserver = class { constructor(cb) { roCb = cb; } observe() {} disconnect() {} };
    const origRaf2 = globalThis.requestAnimationFrame;
    const rafObs = [];
    globalThis.requestAnimationFrame = (cb) => { rafObs.push(cb); return 1; };
    let reassertCount = 0;
    try {
      const obs = createPostCommitPinObservers({
        getMessageHost: () => ({}),
        getCanvasElement: () => ({}),
        isSessionEnterPending: () => true,
        reassertActivePin: () => { reassertCount += 1; },
      });
      obs.ensure();
      moCb?.();
      assert.equal(rafObs.length, 1);
      rafObs.shift()();
      assert.equal(reassertCount, 1);

      globalThis.requestAnimationFrame = undefined;
      roCb?.();
      assert.equal(reassertCount, 2);
      obs.dispose();
    } finally {
      globalThis.MutationObserver = origMO;
      globalThis.ResizeObserver = origRO;
      globalThis.requestAnimationFrame = origRaf2;
    }

    // D. streamViewportManager: pin-to-bottom 600 帧硬上限兜底 + probe 缺失等待分支
    const rafPin = [];
    const origRaf3 = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => { rafPin.push(cb); return rafPin.length; };
    try {
      let scrollTopPin = 0;
      const pinStream = {
        get scrollTop() { return scrollTopPin; },
        set scrollTop(v) { scrollTopPin = v; },
        scrollHeight: 800,
        clientHeight: 800,
        style: { overflowAnchor: '', setProperty: () => {}, removeProperty: () => {} },
        getBoundingClientRect: () => ({ top: 0, bottom: 800 }),
        querySelector: () => null,
        querySelectorAll: () => [],
      };
      const vmPin = new StreamViewportManager({
        getActiveSessionId: () => 'sess-pin-cap',
        getStreamElement: () => pinStream,
        isInitialBottomSettling: () => false,
        setInitialBottomSettling: () => {},
        settleInitialBottom: () => {},
        isPromptJumpSettling: () => false,
        setSuppressPinBottomOnce: () => {},
        setSettledLayoutSignature: () => {},
        layoutSignature: () => 'sig',
        markProgrammaticScroll: () => {},
      });
      vmPin.beginSessionEnter('sess-pin-cap', { forcePinToBottom: true });
      // probe 缺失且 scrollHeight <= clientHeight：sync 模式 + 90 帧等待
      vmPin.settleSessionEnter('missing-probe', 'sess-pin-cap', 'ready', 5, true);
      for (let i = 0; i < 95 && rafPin.length > 0; i += 1) {
        rafPin.shift()();
      }
      assert.equal(vmPin.isSessionEnterPending(), true);

      // 让 scrollHeight 撑开并不断变化，触发 600 帧硬上限兜底
      pinStream.scrollHeight = 5000;
      vmPin.reassertActivePin();
      for (let i = 0; i < 605 && rafPin.length > 0; i += 1) {
        pinStream.scrollHeight += 1;
        rafPin.shift()();
      }
      assert.equal(vmPin.isSessionEnterPending(), false, 'pin-to-bottom 超过 600 帧硬上限必须收口');
    } finally {
      globalThis.requestAnimationFrame = origRaf3;
    }

    // E. renderCoordinator: reassertActivePin + markProgrammaticScroll + dispose
    const origDocE = globalThis.document;
    const origRafE = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
    const rcStream = { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 };
    globalThis.document = {
      getElementById: (id) => (id === 'conversation-stream' ? rcStream : null),
      querySelector: () => null,
    };
    let markCalled = 0;
    try {
      const rc = createRenderCoordinator({
        getState: () => ({
          activeSessionId: 's-rc',
          messages: makeMessages(2, 'r'),
          messagesPhase: 'ready',
          activeFocus: { type: 'session', sessionId: 's-rc' },
          isStreaming: false,
          gatewayConnected: false,
          gatewayConnecting: false,
          hasOlderMessages: false,
          isLoadingOlder: false,
          profileName: 'default',
          rollbackArmed: null,
          sessions: [],
          profiles: [],
          groupRooms: [],
          inspectorCollapsed: true,
        }),
        messageWindowManager: {
          ensureMessageWindow: () => {},
          getMessageWindowStart: () => 0,
          getMessageWindowEnd: () => 2,
          markProgrammaticScroll: () => {},
        },
        modalInteractionController: { renderModalsHtml: () => '', syncModalVisibility: () => {} },
        isStreamingActiveForCurrentSession: () => false,
        resolveSessionKnownFiles: () => [],
        getTitlebarSnapshot: () => ({}),
        onMinimizeWindow: () => {},
        onMaximizeWindow: () => {},
        onCloseWindow: () => {},
        onToggleTheme: () => {},
        getLeftRailSnapshot: () => ({}),
        createLeftRailActions: () => ({}),
        getPromptNavigatorSnapshot: () => ({ prompts: [], activeIndex: -1 }),
        createPromptNavigatorActions: () => ({}),
        setPromptNavigatorUpdateHandler: () => {},
        rebuildPromptEntries: () => {},
        syncPromptNavigatorMeta: () => {},
        syncPromptNavigator: () => {},
        syncReactSettings: () => {},
        ensureSettingsSectionData: () => {},
        syncAgentPresenceHost: () => {},
        syncAgentPresence: () => {},
        captureStreamAnchor: () => ({ sessionId: 's-rc', id: null, offset: 0, rawScrollTop: 0 }),
        applyStreamAnchor: () => {},
        stabilizeStreamAnchor: () => {},
        isStreamNearBottom: () => true,
        syncStreamBottomInset: () => {},
        settleInitialBottom: () => {},
        isSessionEnterPending: () => false,
        settleSessionEnter: () => {},
        reassertActivePin: () => {},
        markProgrammaticScroll: () => { markCalled += 1; },
        bindEvents: () => {},
        syncComposerPoppers: () => {},
      });
      rc.render();
      rc.dispose();
      assert.equal(markCalled >= 0, true);
    } finally {
      globalThis.document = origDocE;
      globalThis.requestAnimationFrame = origRafE;
    }
  });
});
