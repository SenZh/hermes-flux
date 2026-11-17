import test from 'node:test';
import assert from 'node:assert/strict';

import { createRenderCoordinator } from '../../dist/renderer/renderCoordinator.mjs';
import { decideViewportPin, chooseViewportAnchor } from '@hermes-flux/core';

test('RenderCoordinator - 渲染装配与协调管线领域纯行为测试', async (t) => {
  function createHarness(overrides = {}) {
    const messages = [
      { id: 'm-1', role: 'user', content: 'hello' },
      { id: 'm-2', role: 'assistant', content: 'world', displayKind: 'assistant' },
      { id: 'm-3', role: 'assistant', content: 'steer tool call', displayKind: 'hidden' },
    ];

    const state = {
      activeSessionId: 'sess-test',
      activeFocus: { type: 'session', sessionId: 'sess-test' },
      messages,
      gatewayConnected: true,
      gatewayConnecting: false,
      hasOlderMessages: false,
      isLoadingOlder: false,
      messagesPhase: 'ready',
      profileName: 'default',
      lang: 'en',
      artifacts: [], attachments: [], availableModels: [], collapsedProviders: [], favoriteModels: [],
      gitDiffs: [], memories: [], mentionItems: [], modelCatalog: {}, modelDetails: [], openFiles: [],
      queuedMessages: [], recentModels: [], sideAgentCapsules: [], slashItems: [],
      browserFrame: null, rollbackArmed: null, testStatus: null, activeFilePath: '',
      activeInspectorTab: 'files', approvalMode: 'smart', currentProvider: 'auto', dockNotice: '',
      fileSearchOpen: false, fileSearchQuery: '', fileShowLineNumbers: false, fileViewMode: 'preview',
      fileWordWrap: false, inspectorCollapsed: true, inspectorFullscreen: false, isMaximized: false,
      isSettingsOpen: false, leftRailCollapsed: false, mentionPopperOpen: false, modelMenuOpen: false,
      modelSearchQuery: '', selectedModel: 'auto', reasoningLevel: 'medium', settingsSection: 'appearance',
      slashPopperOpen: false, theme: 'obsidian-gold', username: '', gatewayUrl: 'http://localhost', modelCatalogHash: '',
    };

    const messageWindowManager = {
      ensureMessageWindow: () => {},
      getMessageWindowStart: () => 0,
      getMessageWindowEnd: () => messages.length,
      computeContentOffsetPx: () => 0,
      computeVirtualHeightPx: () => 300,
      scheduleVirtualHeightSync: () => {},
      markProgrammaticScroll: () => {},
    };

    const modalInteractionController = {
      renderTaskModalHtml: () => '<!-- task modal -->',
      renderContextMenuHtml: () => '<!-- context menu -->',
      renderConfirmModalHtml: () => '<!-- confirm modal -->',
      updateModals: () => {},
    };

    const sideEffects = {
      eventsBound: 0,
      poppersSynced: 0,
    };

    const coordinator = createRenderCoordinator({
      getState: () => state,
      messageWindowManager,
      modalInteractionController,
      isStreamingActiveForCurrentSession: () => false,
      resolveSessionKnownFiles: () => ['file-a.ts'],
      getTitlebarSnapshot: () => ({ title: 'Flux' }),
      getLeftRailSnapshot: () => ({ items: [] }),
      createLeftRailActions: () => ({}),
      getPromptNavigatorSnapshot: () => ({ entries: [] }),
      createPromptNavigatorActions: () => ({}),
      rebuildPromptEntries: () => {},
      syncPromptNavigatorMeta: () => {},
      syncPromptNavigator: () => {},
      syncReactSettings: () => {},
      ensureSettingsSectionData: () => {},
      syncAgentPresenceHost: () => {},
      syncAgentPresence: () => {},
      captureStreamAnchor: () => ({ id: 'm-1', offset: 0 }),
      applyStreamAnchor: () => {},
      stabilizeStreamAnchor: () => {},
      isStreamNearBottom: () => true,
      syncStreamBottomInset: () => {},
      settleInitialBottom: () => {},
      isSessionEnterPending: () => false,
      settleSessionEnter: () => {},
      bindEvents: () => {
        sideEffects.eventsBound += 1;
      },
      syncComposerPoppers: () => {
        sideEffects.poppersSynced += 1;
      },
      ...overrides,
    });

    return { state, messageWindowManager, coordinator, sideEffects };
  }

  await t.test('1. buildConversationSnapshot 正确装配视图模型，跳过末尾 hidden 行并标记最后可见消息', () => {
    const { coordinator } = createHarness();
    const snapshot = coordinator.buildConversationSnapshot();

    assert.equal(snapshot.mode, 'scratchpad');
    assert.equal(snapshot.connection, 'connected');
    assert.equal(snapshot.isStreaming, false);
    assert.equal(snapshot.messages.length, 3);
    assert.deepEqual(snapshot.knownFiles, ['file-a.ts']);

    // m-3 是 hidden，最后可见行应该是 m-2
    const m2 = snapshot.messages.find((m) => m.id === 'm-2');
    assert.ok(m2);
    assert.equal(m2.isStreaming, false);
  });

  await t.test('2. 结构脏标记与置底标记的状态读写', () => {
    const { coordinator } = createHarness();
    assert.equal(coordinator.getCanvasStructureDirty(), false);
    coordinator.setCanvasStructureDirty(true);
    assert.equal(coordinator.getCanvasStructureDirty(), true);

    assert.equal(coordinator.getSuppressPinBottomOnce(), false);
    coordinator.setSuppressPinBottomOnce(true);
    assert.equal(coordinator.getSuppressPinBottomOnce(), true);

    assert.equal(coordinator.getPendingScrollToBottom(), false);
    coordinator.setPendingScrollToBottom(true);
    assert.equal(coordinator.getPendingScrollToBottom(), true);

    assert.equal(coordinator.getSessionSwitchPending(), false);
    coordinator.setSessionSwitchPending(true);
    assert.equal(coordinator.getSessionSwitchPending(), true);
  });

  await t.test('3. dispose 资源安全释放', () => {
    const { coordinator } = createHarness();
    assert.doesNotThrow(() => {
      coordinator.dispose();
    });
  });

  /**
   * 渲染期接线：进入计划挂起时不得捕获旧 DOM、不得重放锚点，且必须推进 settle。
   * 【杀伤力】删掉 `enterPending` 分支会让 `captureCalls/applyCalls` 立刻变 1，用例必红。
   */
  await t.test('4. 进入计划挂起时跳过旧 DOM 捕获与锚点重放，并由 rAF 推进 settle', () => {
    const dom = installDomStub();
    try {
      const calls = { capture: 0, apply: 0, settle: 0 };
      const { coordinator } = createHarness({
        isSessionEnterPending: () => true,
        settleSessionEnter: () => { calls.settle += 1; },
        captureStreamAnchor: () => { calls.capture += 1; return { sessionId: 'sess-test', id: 'm-1', offset: 0, rawScrollTop: 0 }; },
        applyStreamAnchor: () => { calls.apply += 1; },
      });

      coordinator.render();

      assert.equal(calls.capture, 0, '进入期绝不捕获：此时 DOM 仍是上一会话');
      assert.equal(calls.apply, 0, '进入期绝不重放旧锚点');
      assert.equal(calls.settle, 1, 'rAF 必须把控制权交给进入计划');
      assert.equal(dom.elements.get('flux-app-root').innerHTML.length > 0, true, '首帧由根节点全量渲染，画布必须在产物里');
    } finally {
      dom.restore();
    }
  });

  await t.test('5. 非进入期仍按原路径捕获并重放锚点，且首个渲染走全量分支', () => {
    const dom = installDomStub();
    try {
      const calls = { capture: 0, apply: 0, settle: 0 };
      const { coordinator, state } = createHarness({
        isSessionEnterPending: () => false,
        settleSessionEnter: () => { calls.settle += 1; },
        captureStreamAnchor: () => { calls.capture += 1; return { sessionId: 'sess-test', id: 'm-1', offset: 0, rawScrollTop: 0 }; },
        applyStreamAnchor: () => { calls.apply += 1; },
      });

      coordinator.render();
      assert.equal(calls.capture, 1, '非进入期必须捕获当前视口锚点');
      assert.equal(calls.apply, 1, '全量渲染分支必须重放锚点');
      assert.equal(calls.settle, 0, '非进入期不得派发进入计划');

      state.messages.push({ id: 'm-4', role: 'user', content: 'more' });
      // 强制走增量分支：结构脏或会话切换挂起会把渲染打回全量重建，
      // 那样只会覆盖首帧路径，测不到增量分支的锚点重放。
      coordinator.setCanvasStructureDirty(false);
      coordinator.setSessionSwitchPending(false);
      coordinator.render();
      assert.equal(calls.capture, 2, '增量渲染同样捕获锚点');
      assert.equal(calls.apply, 2, '增量渲染分支必须重放锚点');

      coordinator.render();
      assert.equal(calls.capture, 3, '每次非进入期渲染都会捕获锚点');
      assert.equal(calls.apply, 2, '消息与结构都没变时不再重放');
    } finally {
      dom.restore();
    }
  });

  await t.test('6. 进入期消息未变也会继续推进进入计划', () => {
    const dom = installDomStub();
    try {
      let capture = 0;
      let apply = 0;
      let settle = 0;
      const { coordinator } = createHarness({
        isSessionEnterPending: () => true,
        settleSessionEnter: () => { settle += 1; },
        captureStreamAnchor: () => { capture += 1; return { sessionId: 'sess-test', id: 'm-1', offset: 0, rawScrollTop: 0 }; },
        applyStreamAnchor: () => { apply += 1; },
      });

      coordinator.render();
      coordinator.render(); // 第二次 messagesChanged=false，但进入计划仍在挂起

      assert.equal(capture, 0, '进入期绝不捕获');
      assert.equal(apply, 0, '进入期绝不重放');
      assert.equal(settle, 2, '两次渲染都必须推进进入计划');
    } finally {
      dom.restore();
    }
  });

  await t.test('7. suppressPinBottomOnce 抑制贴底但保留锚点重放', () => {
    const dom = installDomStub();
    try {
      let capture = 0;
      let apply = 0;
      const { coordinator } = createHarness({
        captureStreamAnchor: () => { capture += 1; return { sessionId: 'sess-test', id: 'm-1', offset: 0, rawScrollTop: 0 }; },
        applyStreamAnchor: () => { apply += 1; },
      });

      coordinator.setSuppressPinBottomOnce(true);
      coordinator.render();

      assert.equal(capture, 1, '抑制期仍要捕获锚点');
      assert.equal(apply, 1, '抑制的是贴底，不是锚点重放');
    } finally {
      dom.restore();
    }
  });

  await t.test('8. 未接线进入计划且无 rAF 环境时仍按旧路径安全渲染', () => {
    const dom = installDomStub();
    try {
      delete globalThis.requestAnimationFrame;
      let capture = 0;
      let apply = 0;
      const { coordinator } = createHarness({
        captureStreamAnchor: () => { capture += 1; return { sessionId: 'sess-test', id: 'm-1', offset: 0, rawScrollTop: 0 }; },
        applyStreamAnchor: () => { apply += 1; },
        // 不传 isSessionEnterPending / settleSessionEnter：模拟尚未接线的宿主。
      });

      assert.doesNotThrow(() => coordinator.render());
      assert.equal(capture, 1, '未接线时按旧路径捕获');
      assert.equal(apply, 1, '未接线时按旧路径重放');
    } finally {
      dom.restore();
    }
  });

  await t.test('9. 进入期空会话：rAF 推进时探针为空串', () => {
    const dom = installDomStub();
    try {
      const settles = [];
      const { coordinator, state } = createHarness({
        isSessionEnterPending: () => true,
        settleSessionEnter: (probe) => settles.push(probe),
      });
      state.messages.length = 0;
      coordinator.render();
      assert.deepEqual(settles, [''], '空会话没有最后一条消息时探针必须是空串');
    } finally {
      dom.restore();
    }
  });

  await t.test('10. 无 rAF 且进入期挂起时不得推进，也不得抛错', () => {
    const dom = installDomStub();
    try {
      delete globalThis.requestAnimationFrame;
      const settles = [];
      const { coordinator } = createHarness({
        isSessionEnterPending: () => true,
        settleSessionEnter: (probe) => settles.push(probe),
      });
      assert.doesNotThrow(() => coordinator.render());
      assert.equal(settles.length, 0, '没有 rAF 时只能等下一帧，不得同步推进');
    } finally {
      dom.restore();
    }
  });

  await t.test('11. 离开底部且无强制置底时走非贴底分支', () => {
    const dom = installDomStub();
    try {
      let apply = 0;
      const { coordinator } = createHarness({
        isStreamNearBottom: () => false,
        applyStreamAnchor: () => { apply += 1; },
      });
      coordinator.render();
      assert.equal(apply, 1, '非贴底时仍要重放锚点以保住阅读位置');
    } finally {
      dom.restore();
    }
  });

  await t.test('12. 视口裁决组合穷举与锚点选择', () => {
    const entered = decideViewportPin({
      enterPending: true, forcedBottom: true, wasNearBottom: true,
      messagesChanged: true, hasRaf: true,
    });
    assert.equal(entered.capture, false, '进入期绝不捕获');
    assert.equal(entered.applyAnchor, false, '进入期绝不重放');
    assert.equal(entered.advanceSessionEnter, true, '有 rAF 就推进进入计划');

    const enteredNoRaf = decideViewportPin({
      enterPending: true, forcedBottom: false, wasNearBottom: false,
      messagesChanged: false, hasRaf: false,
    });
    assert.equal(enteredNoRaf.advanceSessionEnter, false, '没有 rAF 不得推进');

    const pinned = decideViewportPin({
      enterPending: false, forcedBottom: true, wasNearBottom: false,
      messagesChanged: true, hasRaf: true,
    });
    assert.equal(pinned.capture, true);
    assert.equal(pinned.pinBottom, true, '强制置底优先');
    assert.equal(pinned.applyAnchor, true);
    assert.equal(pinned.advanceSessionEnter, true);

    const nearBottom = decideViewportPin({
      enterPending: false, forcedBottom: false, wasNearBottom: true,
      messagesChanged: true, hasRaf: true,
    });
    assert.equal(nearBottom.pinBottom, true, '贴底安全区同样跟随');

    const anchored = decideViewportPin({
      enterPending: false, forcedBottom: false, wasNearBottom: false,
      messagesChanged: false, hasRaf: true,
    });
    assert.equal(anchored.pinBottom, false, '回溯态不得贴底');
    assert.equal(anchored.advanceSessionEnter, false, '消息未变不重复推进');

    let captureCalls = 0;
    const active = chooseViewportAnchor(anchored, () => { captureCalls += 1; return 'captured'; }, 'fallback');
    assert.equal(active, 'captured', '需捕获时调用捕获函数');
    assert.equal(captureCalls, 1);

    const idle = chooseViewportAnchor(entered, () => { captureCalls += 1; return 'captured'; }, 'fallback');
    assert.equal(idle, 'fallback', '进入期必须用兜底锚点');
    assert.equal(captureCalls, 1, '进入期绝不可调用捕获函数');
  });

  function installDomStub() {    const saved = {
      document: globalThis.document,
      window: globalThis.window,
      raf: globalThis.requestAnimationFrame,
      gcs: globalThis.getComputedStyle,
    };
    const elements = new Map();
    const makeEl = (id) => ({
      id,
      innerHTML: '',
      className: '',
      style: { setProperty() {}, getPropertyValue: () => '', removeProperty() {} },
      dataset: {},
      children: [],
      childElementCount: 0,
      setAttribute() {},
      getAttribute: () => null,
      removeAttribute() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      appendChild() {},
      removeChild() {},
      addEventListener() {},
      removeEventListener() {},
      focus() {},
      blur() {},
      click() {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    });
    // 只保留渲染根与滚动容器：React 岛宿主保持 null，让 render 走真实字符串画布分支，
    // 避免在 Node 里真的 createRoot 挂载 React（无 DOM 内核，必然抛 "not a DOM element"）。
    for (const id of ['flux-app-root', 'conversation-stream']) {
      elements.set(id, makeEl(id));
    }
    // 让第二次 render 走增量分支：全量分支的判据是根节点里能否找到 .flux-body-container。
    const bodyContainer = makeEl('flux-body-container');
    let bodyProbeCount = 0;
    elements.get('flux-app-root').querySelector = (selector) => {
      if (selector !== '.flux-body-container') return null;
      bodyProbeCount += 1;
      return bodyProbeCount > 1 ? bodyContainer : null;
    };
    globalThis.document = {
      getElementById: (id) => elements.get(id) ?? null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => makeEl(tag),
      addEventListener() {},
      removeEventListener() {},
      documentElement: { style: { setProperty() {} }, dataset: {}, setAttribute() {}, getAttribute: () => null },
      body: makeEl('body'),
      head: makeEl('head'),
    };
    globalThis.window = {
      addEventListener() {},
      removeEventListener() {},
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    };
    globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
    globalThis.getComputedStyle = () => ({ paddingBottom: '0px', getPropertyValue: () => '' });
    return {
      elements,
      restore: () => {
        globalThis.document = saved.document;
        globalThis.window = saved.window;
        globalThis.requestAnimationFrame = saved.raf;
        globalThis.getComputedStyle = saved.gcs;
      },
    };
  }
});
