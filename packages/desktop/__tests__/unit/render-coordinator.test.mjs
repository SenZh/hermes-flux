import test from 'node:test';
import assert from 'node:assert/strict';

import { createRenderCoordinator } from '../../dist/renderer/renderCoordinator.mjs';
import { createPostCommitPinObservers } from '../../dist/renderer/viewport/postCommitPinObservers.mjs';
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
      conversationWidth: 'wide',
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

  await t.test('13. advanceSessionEnter 完整透传探针、会话、生命周期与消息数', () => {
    const dom = installDomStub();
    try {
      let capturedArgs = null;
      const { coordinator, state } = createHarness({
        isSessionEnterPending: () => true,
        settleSessionEnter: (...args) => {
          capturedArgs = args;
        },
      });
      state.activeSessionId = 'sess-active-xyz';
      state.messagesPhase = 'loading';
      state.messages = [{ id: 'm1' }, { id: 'm2' }];
      coordinator.render();

      assert.deepEqual(capturedArgs, ['m2', 'sess-active-xyz', 'loading', 2], '必须完整透传 probeMessageId, sessionId, messagesPhase, messages.length');
    } finally {
      dom.restore();
    }
  });

  /**
   * 【实测缺陷复现（根因 4）】renderCoordinator.ts:865 传给 settleSessionEnter 的 probeId
   * 取 `state.messages` 原始末条，而 buildConversationSnapshot（本文件 222-228 行）自己会跳过
   * `displayKind === 'hidden'`。末条为 hidden 时 DOM 里没有对应 `[data-msg-id]`，
   * 进入计划的探针永远等不到挂载 → 直落 30 帧熔断且不写位置。
   * 【裁决语义】探针必须是「渲染层真正会挂载的最后一条可见消息」的 id。
   */
  await t.test('14. 末条为 hidden 时探针必须跳过 hidden 取最后一条可见消息', () => {
    const dom = installDomStub();
    try {
      const settles = [];
      const { coordinator } = createHarness({
        isSessionEnterPending: () => true,
        settleSessionEnter: (...args) => { settles.push(args); },
      });

      // createHarness 默认消息：m-1(user) / m-2(assistant) / m-3(hidden)
      coordinator.render();

      assert.equal(settles.length, 1, '进入期必须推进一次进入计划');
      assert.equal(settles[0][0], 'm-2', 'probeId 必须是跳过 hidden 后的最后一条可见消息 id，而不是 hidden 末条');
      assert.notEqual(settles[0][0], 'm-3', 'hidden 末条不得作为探针（DOM 中没有该行，计划必然熔断失败）');
    } finally {
      dom.restore();
    }
  });

  /**
   * 提交后驱动观察器契约（P0-5 的观察器侧）。
   * 【设计意图 (Why)】R1「切换会话默认贴底」在真实 Blink 里能否落底，取决于
   *   MutationObserver / ResizeObserver 是否真的挂在「当前」宿主上、是否合并成一次 reassert。
   *   该生命周期已剥离为 `viewport/postCommitPinObservers` 独立单元（renderCoordinator 直接消费它），
   *   因此这里直接对该单元施加桩，把「挂载 / 重建 / 合并 / 释放」四契约钉死。
   * 【约束与规则 (Rules)】桩只记录调用序列，不改变任何真实语义；每个用例必须还原全局对象。
   */
  function installObserverStub() {
    const saved = { mo: globalThis.MutationObserver, ro: globalThis.ResizeObserver };
    const mutations = [];
    const resizes = [];
    class TrackedMutation {
      constructor(cb) { this.cb = cb; this.active = false; this.target = null; mutations.push(this); }
      observe(target) { this.active = true; this.target = target; }
      disconnect() { this.active = false; }
      /** 模拟一次真实 DOM 变更：仅当仍在 observe 状态才回调（与真实观察器一致）。 */
      fire() { if (this.active) this.cb([]); }
    }
    class TrackedResize {
      constructor(cb) { this.cb = cb; this.active = false; this.target = null; resizes.push(this); }
      observe(target) { this.active = true; this.target = target; }
      disconnect() { this.active = false; }
      fire() { if (this.active) this.cb([]); }
    }
    globalThis.MutationObserver = TrackedMutation;
    globalThis.ResizeObserver = TrackedResize;
    return {
      mutations,
      resizes,
      restore: () => {
        globalThis.MutationObserver = saved.mo;
        globalThis.ResizeObserver = saved.ro;
      },
    };
  }

  await t.test('15. 宿主元素重建时先 disconnect 旧观察器再 observe 新元素', () => {
    const stub = installObserverStub();
    try {
      const canvas = { id: 'conv-canvas' };
      const messageHostA = { id: 'react-message-list-host', variant: 'A' };
      const messageHostB = { id: 'react-message-list-host', variant: 'B' };
      let currentMessageHost = messageHostA;

      const reasserts = [];
      const observers = createPostCommitPinObservers({
        getMessageHost: () => currentMessageHost,
        getCanvasElement: () => canvas,
        isSessionEnterPending: () => true,
        reassertActivePin: () => reasserts.push(1),
        requestFrame: (cb) => { cb(); },
      });

      observers.ensure();
      assert.equal(stub.mutations.length, 1, '首次 ensure 必须为消息宿主建立 MutationObserver');
      assert.equal(stub.mutations[0].target, messageHostA, '必须观察当前宿主 A');
      assert.equal(stub.resizes.length, 1, '首次 ensure 必须为画布建立 ResizeObserver');
      assert.equal(stub.resizes[0].target, canvas, '必须观察 .conv-canvas');

      // React 岛重建：宿主元素被换成 B
      currentMessageHost = messageHostB;
      observers.ensure();

      assert.equal(stub.mutations.length, 2, '宿主重建必须新建观察器');
      assert.equal(stub.mutations[0].active, false, '旧观察器必须先 disconnect，绝不与新元素并存');
      assert.equal(stub.mutations[1].target, messageHostB, '新观察器必须挂在重建后的宿主 B');
      assert.equal(stub.resizes.length, 1, '画布未重建时不得重复 observe（重复 observe 会叠加回调）');
    } finally {
      stub.restore();
    }
  });

  await t.test('16. 连续多次 mutation 只触发一次 reassertActivePin（rAF 合并）', () => {
    const stub = installObserverStub();
    const rafQueue = [];
    try {
      const reasserts = [];
      const observers = createPostCommitPinObservers({
        getMessageHost: () => ({ id: 'react-message-list-host' }),
        getCanvasElement: () => null,
        isSessionEnterPending: () => true,
        reassertActivePin: () => reasserts.push(1),
        requestFrame: (cb) => { rafQueue.push(cb); },
      });
      observers.ensure();
      assert.equal(stub.mutations.length, 1, '必须先建立 MutationObserver');

      // 同一帧内连续 5 次 DOM 变更
      for (let i = 0; i < 5; i += 1) stub.mutations[0].fire();
      assert.equal(rafQueue.length, 1, '5 次变更必须只排一条 rAF（否则每帧反复对齐，计划被烧穿）');
      assert.equal(reasserts.length, 0, 'rAF 未执行前不得同步对齐');

      while (rafQueue.length > 0) rafQueue.shift()();
      assert.equal(reasserts.length, 1, '合并后只允许一次 reassertActivePin');

      // 下一帧再来 3 次：可以再合并一次，但同样只一次
      for (let i = 0; i < 3; i += 1) stub.mutations[0].fire();
      while (rafQueue.length > 0) rafQueue.shift()();
      assert.equal(reasserts.length, 2, '跨帧重新计数：每帧最多一次对齐');
    } finally {
      stub.restore();
    }
  });

  await t.test('17. 无挂起进入计划时观察器回调不调用 reassertActivePin', () => {
    const stub = installObserverStub();
    const rafQueue = [];
    try {
      const reasserts = [];
      const observers = createPostCommitPinObservers({
        getMessageHost: () => ({ id: 'react-message-list-host' }),
        getCanvasElement: () => ({ id: 'conv-canvas' }),
        isSessionEnterPending: () => false,
        reassertActivePin: () => reasserts.push(1),
        requestFrame: (cb) => { rafQueue.push(cb); },
      });
      observers.ensure();

      // 流式输出期：每帧都有大量 mutation / resize，但无 armed 计划 → 必须零额外开销
      for (let i = 0; i < 10; i += 1) stub.mutations[0].fire();
      for (const o of stub.resizes) o.fire();
      assert.equal(rafQueue.length, 0, '无挂起计划时不得排任何对齐帧（流式期零开销）');
      while (rafQueue.length > 0) rafQueue.shift()();
      assert.equal(reasserts.length, 0, '无挂起计划时观察器回调必须纯 no-op');
    } finally {
      stub.restore();
    }
  });

  await t.test('18. dispose() 后两个观察器均 disconnect 且不再响应变更', () => {
    const stub = installObserverStub();
    const rafQueue = [];
    try {
      const reasserts = [];
      const observers = createPostCommitPinObservers({
        getMessageHost: () => ({ id: 'react-message-list-host' }),
        getCanvasElement: () => ({ id: 'conv-canvas' }),
        isSessionEnterPending: () => true,
        reassertActivePin: () => reasserts.push(1),
        requestFrame: (cb) => { rafQueue.push(cb); },
      });
      observers.ensure();
      assert.equal(stub.mutations.length, 1);
      assert.equal(stub.resizes.length, 1);
      assert.equal(stub.mutations[0].active, true);
      assert.equal(stub.resizes[0].active, true);

      observers.dispose();

      assert.equal(stub.mutations[0].active, false, 'dispose 必须断开 MutationObserver，否则宿主卸载后仍在回调');
      assert.equal(stub.resizes[0].active, false, 'dispose 必须断开 ResizeObserver');
      assert.equal(observers.isReassertScheduled(), false, 'dispose 必须清空挂起标记');

      // 已断开的观察器不得再触发对齐
      stub.mutations[0].fire();
      stub.resizes[0].fire();
      assert.equal(rafQueue.length, 0, 'dispose 后不得再排对齐帧');
      assert.equal(reasserts.length, 0, 'dispose 后不得再调用 reassertActivePin');
    } finally {
      stub.restore();
    }
  });

  await t.test('19. overflow-anchor: none 必须在 mountReactShellComponents 之前同步武装，且不误清 sessionEnter 保护', () => {
    const dom = installDomStub();
    const rafQueue = [];
    const origRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
    try {
      const stream = dom.elements.get('conversation-stream');
      stream.scrollHeight = 2000;
      stream.clientHeight = 800;
      stream.scrollTop = 1200;
      const props = new Map();
      const events = [];
      const listeners = new Map();
      stream.style = {
        setProperty: (name, val) => {
          props.set(name, val);
          events.push(`set:${name}=${val}`);
        },
        getPropertyValue: (name) => props.get(name) ?? '',
        removeProperty: (name) => {
          props.delete(name);
          events.push(`remove:${name}`);
        },
      };
      stream.addEventListener = (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      };
      stream.removeEventListener = (type, fn) => {
        listeners.get(type)?.delete(fn);
      };

      let enterPending = false;
      const { coordinator, state } = createHarness({
        isSessionEnterPending: () => enterPending,
        isStreamNearBottom: () => true,
        // syncReactSettings 就在 mountReactShellComponents() 内、syncReactMessageList() 前一行执行，
        // 足以精确观测 overflow-anchor 是否已在 React 提交前同步武装。
        syncReactSettings: () => {
          events.push(`mount:overflow-anchor=${props.get('overflow-anchor') ?? ''}`);
        },
      });

      // 分支 1（首次全量渲染）：overflow-anchor 必须在 mountReactShellComponents 之前武装
      coordinator.render();
      const setIdx1 = events.indexOf('set:overflow-anchor=none');
      const mountIdx1 = events.indexOf('mount:overflow-anchor=none');
      assert.ok(setIdx1 >= 0 && mountIdx1 > setIdx1, '全量分支必须在 mountReactShellComponents 前同步设置 overflow-anchor: none');

      // 向下滚轮（deltaY > 0）不得取消 pin；推进 3 帧后正常收尾移除 overflow-anchor
      for (const fn of listeners.get('wheel') ?? []) fn({ deltaY: 40 });
      assert.equal(props.get('overflow-anchor'), 'none', '向下滚轮不得取消贴底收敛');
      let guard = 0;
      while (rafQueue.length > 0 && guard < 10) {
        rafQueue.shift()();
        guard += 1;
      }
      assert.equal(props.has('overflow-anchor'), false, '非 enterPending 收尾后应恢复 overflow-anchor');

      // 分支 2（增量更新渲染）：若收敛途中进入 isSessionEnterPending()，cleanup 不得移除 overflow-anchor
      events.length = 0;
      state.messages.push({ id: 'm-new', role: 'assistant', content: 'next' });
      coordinator.render();
      assert.ok(events.includes('mount:overflow-anchor=none'), '增量分支同样必须在 mountReactShellComponents 前同步武装 overflow-anchor: none');
      enterPending = true;
      // 向上滚轮（deltaY < 0）取消 pin，但因为 enterPending=true，不得剥离 overflow-anchor
      for (const fn of listeners.get('wheel') ?? []) fn({ deltaY: -30 });
      while (rafQueue.length > 0 && guard < 20) {
        rafQueue.shift()();
        guard += 1;
      }
      assert.equal(props.get('overflow-anchor'), 'none', 'isSessionEnterPending 为 true 时 post-render pin 收尾不得剥离 overflow-anchor');
    } finally {
      globalThis.requestAnimationFrame = origRaf;
      dom.restore();
    }
  });

  await t.test('20. 重叠的两次 pinBottom 渲染：第二次必须作废第一次循环，防止循环 1 提前剥离循环 2 的 overflow-anchor', () => {
    const dom = installDomStub();
    const rafQueue = [];
    const origRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
    // 预置 data-theme，避免换肤过渡向 rafQueue 插入额外的 oc-theme-switching 清理帧
    globalThis.document.documentElement.getAttribute = (name) => (name === 'data-theme' ? 'obsidian-gold' : null);
    try {
      const stream = dom.elements.get('conversation-stream');
      stream.scrollHeight = 2000;
      stream.clientHeight = 800;
      stream.scrollTop = 1200;
      const props = new Map();
      stream.style = {
        setProperty: (name, val) => props.set(name, val),
        getPropertyValue: (name) => props.get(name) ?? '',
        removeProperty: (name) => props.delete(name),
      };

      const { coordinator, state } = createHarness({
        isSessionEnterPending: () => false,
        isStreamNearBottom: () => true,
      });

      // 渲染 1 启动 pin #1，只推进 1 帧（尚未收尾）
      coordinator.render();
      assert.equal(props.get('overflow-anchor'), 'none');
      assert.equal(rafQueue.length, 1);
      rafQueue.shift()(); // 执行外层 rAF -> pin #1 第 1 帧，排队 pin #1 第 2 帧
      assert.equal(rafQueue.length, 1);

      // 渲染 2 在 pin #1 仍在进行时触发，武装 pin #2 并作废 pin #1
      state.messages.push({ id: 'm-overlap', role: 'assistant', content: 'overlap' });
      coordinator.render();
      assert.equal(props.get('overflow-anchor'), 'none', '渲染 2 必须重新武装 overflow-anchor: none');
      assert.equal(rafQueue.length, 2, '队列中含已作废的 pin #1 帧与新的 pin #2 外层帧');

      // 执行 pin #1 的残余帧：必须静默退出，绝不能剥离 pin #2 的 overflow-anchor
      rafQueue.shift()();
      assert.equal(props.get('overflow-anchor'), 'none', '已作废的 pin #1 绝不能清除 pin #2 持有的 overflow-anchor: none');
      assert.equal(rafQueue.length, 1, 'pin #1 作废后不得继续自排下一帧');

      // 跑完 pin #2 直到正常收敛，再恢复 overflow-anchor
      let steps = 0;
      while (rafQueue.length > 0 && steps < 10) {
        rafQueue.shift()();
        steps += 1;
      }
      assert.equal(props.has('overflow-anchor'), false, 'pin #2 正常收敛后应移除 overflow-anchor');
    } finally {
      globalThis.requestAnimationFrame = origRaf;
      dom.restore();
    }
  });

  await t.test('21. pointerdown/touchstart、非贴底消息变更、enterPending 切换与 dispose 均会正确取消在途 post-render pin', () => {
    const dom = installDomStub();
    const rafQueue = [];
    const origRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
    globalThis.document.documentElement.getAttribute = (name) => (name === 'data-theme' ? 'obsidian-gold' : null);
    try {
      const stream = dom.elements.get('conversation-stream');
      stream.scrollHeight = 700; // <= clientHeight (800)，验证非可滚容器不写 scrollTop
      stream.clientHeight = 800;
      stream.scrollTop = 0;
      const props = new Map();
      const listeners = new Map();
      stream.style = {
        setProperty: (name, val) => props.set(name, val),
        getPropertyValue: (name) => props.get(name) ?? '',
        removeProperty: (name) => props.delete(name),
      };
      stream.addEventListener = (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      };
      stream.removeEventListener = (type, fn) => {
        listeners.get(type)?.delete(fn);
      };

      let nearBottom = true;
      let enterPending = false;
      const { coordinator, state } = createHarness({
        isSessionEnterPending: () => enterPending,
        isStreamNearBottom: () => nearBottom,
      });

      // 1. pointerdown 触发 onPointerOrTouch -> 取消 pin，且非可滚容器 scrollTop 保持 0
      coordinator.render();
      assert.equal(props.get('overflow-anchor'), 'none');
      for (const fn of listeners.get('pointerdown') ?? []) fn();
      while (rafQueue.length > 0) rafQueue.shift()();
      assert.equal(props.has('overflow-anchor'), false, 'pointerdown 取消后应恢复 overflow-anchor');
      assert.equal(stream.scrollTop, 0, 'scrollHeight <= clientHeight 时 pin 不得写 scrollTop');

      // 2. 启动新 pin 后发生非贴底消息变更（messagesChanged && !pinBottom）-> 立即取消旧 pin
      stream.scrollHeight = 2000;
      state.messages.push({ id: 'm-pin-2', role: 'assistant', content: 'pin2' });
      coordinator.render();
      assert.equal(props.get('overflow-anchor'), 'none');
      nearBottom = false;
      state.messages.push({ id: 'm-nonpin', role: 'assistant', content: 'nonpin' });
      coordinator.render();
      assert.equal(props.has('overflow-anchor'), false, '非贴底消息变动必须立刻取消旧在途 pin');
      while (rafQueue.length > 0) rafQueue.shift()();

      // 3. 启动新 pin 后调用 dispose() -> 清理在途 pin 与 overflow-anchor
      nearBottom = true;
      state.messages.push({ id: 'm-pin-3', role: 'assistant', content: 'pin3' });
      coordinator.render();
      assert.equal(props.get('overflow-anchor'), 'none');
      coordinator.dispose();
      assert.equal(props.has('overflow-anchor'), false, 'dispose() 必须释放仍在途的 post-render pin');
      while (rafQueue.length > 0) rafQueue.shift()();

      // 4. 启动新 pin 后切入 enterPending -> 取消旧 pin 但不得剥离 overflow-anchor
      state.messages.push({ id: 'm-pin-4', role: 'assistant', content: 'pin4' });
      coordinator.render();
      assert.equal(props.get('overflow-anchor'), 'none');
      enterPending = true;
      coordinator.render();
      assert.equal(props.get('overflow-anchor'), 'none', '进入 enterPending 时取消旧 pin 不得剥离 overflow-anchor');
    } finally {
      globalThis.requestAnimationFrame = origRaf;
      dom.restore();
    }
  });

  await t.test('22. post-render pin 滚轮方向/手势让权、收敛帧边界(3/8帧)、markProgrammaticScroll 与监听清理变异杀伤', () => {
    const dom = installDomStub();
    const rafQueue = [];
    const origRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
    globalThis.document.documentElement.getAttribute = (name) => (name === 'data-theme' ? 'obsidian-gold' : null);
    try {
      const attachObservableStream = (el, initialHeight, clientHeight) => {
        const props = new Map();
        const listeners = new Map();
        const addedOpts = new Map();
        let _scrollTop = 100;
        let scrollTopWrites = 0;
        el.scrollHeight = initialHeight;
        el.clientHeight = clientHeight;
        Object.defineProperty(el, 'scrollTop', {
          configurable: true,
          get: () => _scrollTop,
          set: (v) => { scrollTopWrites += 1; _scrollTop = v; },
        });
        el.style = {
          setProperty: (k, v) => props.set(k, v),
          getPropertyValue: (k) => props.get(k) ?? '',
          removeProperty: (k) => props.delete(k),
        };
        el.addEventListener = (type, fn, opts) => {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type).add(fn);
          addedOpts.set(type, opts);
        };
        el.removeEventListener = (type, fn) => {
          listeners.get(type)?.delete(fn);
        };
        return {
          props,
          listeners,
          addedOpts,
          getScrollTopWrites: () => scrollTopWrites,
          resetWrites: () => { scrollTopWrites = 0; _scrollTop = 100; },
        };
      };

      const stream = dom.elements.get('conversation-stream');
      const obs = attachObservableStream(stream, 2000, 800);
      const directMarks = [];
      const traces = [];

      const { coordinator, state } = createHarness({
        isSessionEnterPending: () => false,
        isStreamNearBottom: () => true,
        markProgrammaticScroll: (el) => directMarks.push(el),
        logStream: { trace: (name, meta) => traces.push([name, meta]) },
      });

      // 1. 恒定高度 + deltaY === 0 / > 0 向下滚轮不得取消：精确跑 3 帧收口并全部写 scrollTop & markProgrammaticScroll
      coordinator.render();
      assert.deepEqual(obs.addedOpts.get('wheel'), { passive: true });
      assert.deepEqual(obs.addedOpts.get('pointerdown'), { passive: true, once: true });
      assert.deepEqual(obs.addedOpts.get('touchstart'), { passive: true, once: true });
      for (const fn of obs.listeners.get('wheel') ?? []) fn({ deltaY: 0 });
      for (const fn of obs.listeners.get('wheel') ?? []) fn({ deltaY: 25 });
      let frames = 0;
      while (rafQueue.length > 0 && frames < 15) {
        rafQueue.shift()();
        frames += 1;
      }
      assert.equal(frames, 3, '恒定高度下应精确在第 3 帧（stableFrames>=2 && frameCount>=3）收敛');
      assert.equal(stream.scrollTop, 2000, '向下滚轮不得取消贴底，必须将 scrollTop 写至 scrollHeight');
      assert.equal(obs.getScrollTopWrites(), 3, '3 帧内每帧都应写 scrollTop');
      assert.equal(directMarks.length, 3, '注入 deps.markProgrammaticScroll 时必须优先调用它');
      assert.equal(obs.listeners.get('wheel').size, 0, '收尾必须移除 wheel 监听');
      assert.equal(obs.listeners.get('pointerdown').size, 0, '收尾必须移除 pointerdown 监听');
      assert.equal(obs.listeners.get('touchstart').size, 0, '收尾必须移除 touchstart 监听');

      // 2. 向上滚轮（deltaY < 0）、无事件对象、pointerdown、touchstart 必须在第 1 帧就让权，0 次写入 scrollTop
      for (const trigger of [
        () => { for (const fn of obs.listeners.get('wheel') ?? []) fn({ deltaY: -1 }); },
        () => { for (const fn of obs.listeners.get('wheel') ?? []) fn(undefined); },
        () => { for (const fn of obs.listeners.get('wheel') ?? []) fn({ deltaY: 'bad' }); },
        () => { for (const fn of obs.listeners.get('pointerdown') ?? []) fn(); },
        () => { for (const fn of obs.listeners.get('touchstart') ?? []) fn(); },
      ]) {
        obs.resetWrites();
        directMarks.length = 0;
        state.messages.push({ id: `m-cancel-${Math.random()}`, role: 'assistant', content: 'x' });
        coordinator.render();
        trigger();
        let steps = 0;
        while (rafQueue.length > 0 && steps < 10) {
          rafQueue.shift()();
          steps += 1;
        }
        assert.equal(steps, 1, '取消后首帧即应退出，不得继续排后续帧');
        assert.equal(obs.getScrollTopWrites(), 0, '手势让权后严禁再写 scrollTop');
        assert.equal(directMarks.length, 0);
        assert.equal(obs.props.has('overflow-anchor'), false, '让权退出必须清理 overflow-anchor');
      }

      // 3. 高度每帧递增：必须持续到 8 帧硬上限才收口，并在 8 帧都执行贴底
      obs.resetWrites();
      directMarks.length = 0;
      stream.scrollHeight = 2000;
      state.messages.push({ id: 'm-grow', role: 'assistant', content: 'grow' });
      coordinator.render();
      let growFrames = 0;
      while (rafQueue.length > 0 && growFrames < 15) {
        stream.scrollHeight += 50;
        rafQueue.shift()();
        growFrames += 1;
      }
      assert.equal(growFrames, 8, '高度持续变化时必须在 8 帧硬上限收口');
      assert.equal(obs.getScrollTopWrites(), 8);
      assert.equal(obs.props.has('overflow-anchor'), false);

      // 4. 高度先变一次再稳定：必须在第 4 帧收敛（第 1 帧 2100 -> 第 2 帧 2200 重置 stableFrames -> 第 3/4 帧稳定）
      obs.resetWrites();
      stream.scrollHeight = 2100;
      state.messages.push({ id: 'm-grow-once', role: 'assistant', content: 'grow-once' });
      coordinator.render();
      let onceFrames = 0;
      while (rafQueue.length > 0 && onceFrames < 15) {
        if (onceFrames === 1) stream.scrollHeight = 2200;
        rafQueue.shift()();
        onceFrames += 1;
      }
      assert.equal(onceFrames, 4, '高度变化一次后应重置 stableFrames 并在第 4 帧收敛');

      // 5. scrollHeight === clientHeight 边界：不得写 scrollTop 或 markProgrammaticScroll
      obs.resetWrites();
      directMarks.length = 0;
      stream.scrollHeight = 800;
      stream.clientHeight = 800;
      state.messages.push({ id: 'm-eq-h', role: 'assistant', content: 'eq' });
      coordinator.render();
      while (rafQueue.length > 0) rafQueue.shift()();
      assert.equal(obs.getScrollTopWrites(), 0, 'scrollHeight === clientHeight 时绝不得写 scrollTop');
      assert.equal(directMarks.length, 0);

      // 6. 中途替换 #conversation-stream DOM：cleanup 必须同时清理旧 boundStream 与新 currentStream
      const stream2 = dom.elements.get('conversation-stream');
      const replacementStream = {
        id: 'conversation-stream',
        querySelector: () => null,
        querySelectorAll: () => [],
      };
      const obs2 = attachObservableStream(replacementStream, 2000, 800);
      stream2.scrollHeight = 2000;
      state.messages.push({ id: 'm-swap', role: 'assistant', content: 'swap' });
      coordinator.render();
      assert.equal(obs.props.get('overflow-anchor'), 'none');
      replacementStream.style.setProperty('overflow-anchor', 'none');
      dom.elements.set('conversation-stream', replacementStream);
      coordinator.dispose();
      assert.equal(obs.props.has('overflow-anchor'), false, 'cleanup 必须清理旧 boundStream 的 overflow-anchor');
      assert.equal(obs2.props.has('overflow-anchor'), false, 'cleanup 必须同步清理新 currentStream 的 overflow-anchor');
      assert.equal(obs.listeners.get('wheel').size, 0);

      // 7. 未注入 deps.markProgrammaticScroll 时回落到 messageWindowManager.markProgrammaticScroll，且非贴底消息变更触发 stabilizeStreamAnchor
      const fallbackMarks = [];
      const stabilized = [];
      dom.elements.set('conversation-stream', stream);
      stream.scrollHeight = 2000;
      let h2NearBottom = true;
      const h2 = createHarness({
        state: { activeSessionId: '' },
        isSessionEnterPending: () => false,
        isStreamNearBottom: () => h2NearBottom,
        stabilizeStreamAnchor: (anchor) => stabilized.push(anchor),
        messageWindowManager: {
          ensureMessageWindow: () => {},
          resetMessageWindow: () => {},
          markProgrammaticScroll: (el) => fallbackMarks.push(el),
          getState: () => ({ start: 0, end: 100, userExpanded: false }),
          syncWindowRange: () => {},
        },
      });
      h2.coordinator.render();
      while (rafQueue.length > 0) rafQueue.shift()();
      assert.equal(fallbackMarks.length, 3, '未注入 deps.markProgrammaticScroll 时必须回落到 messageWindowManager.markProgrammaticScroll');
      h2NearBottom = false;
      h2.state.messages.push({ id: 'm-stab', role: 'assistant', content: 'stab' });
      h2.coordinator.render();
      while (rafQueue.length > 0) rafQueue.shift()();
      assert.equal(stabilized.length, 1, '非贴底消息变更时 rAF 必须调用 stabilizeStreamAnchor 稳定视口');

      // 8. dispose() 时即使 document 已被销毁（undefined），cleanup 也不得抛错
      state.messages.push({ id: 'm-nodoc', role: 'assistant', content: 'nodoc' });
      coordinator.render();
      const savedDoc = globalThis.document;
      globalThis.document = undefined;
      try {
        coordinator.dispose();
      } finally {
        globalThis.document = savedDoc;
      }
      assert.equal(obs.props.has('overflow-anchor'), false);
    } finally {
      globalThis.requestAnimationFrame = origRaf;
      dom.restore();
    }
  });

  /**
   * 每次 render() 必须把 state.conversationWidth 同步到根节点（data-chat-layout + --chat-column-max）。
   * 【杀伤力】删掉 renderCoordinator 里的 applyConversationWidthMode 调用，
   * rootAttrs/rootProps 将保持空 Map，首条断言必红；删掉脏值收敛则最后两条必红。
   */
  await t.test('23. render() 按 state.conversationWidth 同步根节点宽度契约', () => {
    const dom = installDomStub();
    try {
      const { coordinator, state } = createHarness({ isSessionEnterPending: () => false });

      coordinator.render();
      assert.equal(dom.rootAttrs.get('data-chat-layout'), 'wide', '首帧必须按 state 写入 data-chat-layout');
      assert.equal(dom.rootProps.get('--chat-column-max'), '72rem', 'wide 档必须写 72rem');

      state.conversationWidth = 'full';
      coordinator.render();
      assert.equal(dom.rootAttrs.get('data-chat-layout'), 'full');
      assert.equal(dom.rootProps.get('--chat-column-max'), '100%');

      state.conversationWidth = 'narrow';
      coordinator.render();
      assert.equal(dom.rootAttrs.get('data-chat-layout'), 'narrow');
      assert.equal(dom.rootProps.get('--chat-column-max'), '48rem');

      state.conversationWidth = 'bogus-width';
      coordinator.render();
      assert.equal(dom.rootAttrs.get('data-chat-layout'), 'wide', '非法档位必须收敛为 wide');
      assert.equal(dom.rootProps.get('--chat-column-max'), '72rem');
    } finally {
      dom.restore();
    }
  });

  await t.test('24. 右侧检查舱增量展开、状态更新与收起保留常驻竖栏契约', () => {
    const dom = installDomStub();
    try {
      const rootEl = dom.elements.get('flux-app-root');
      const shellEl = { id: 'flux-inspector-shell', outerHTML: '' };
      const podEl = {
        id: 'flux-inspector-pod',
        outerHTML: '',
        offsetWidth: 0,
        style: {},
        classList: new Set(['flux-inspector-pod']),
        getAttribute: () => null,
        setAttribute() {},
        removeAttribute() {},
        addEventListener() {},
        removeEventListener() {},
      };
      podEl.classList = {
        add: () => {},
        remove: () => {},
        toggle: () => {},
        contains: () => false,
      };
      const removedClasses = [];
      const railAttrs = new Map();
      const railBtn = {
        classList: { remove: (c) => removedClasses.push(c) },
        setAttribute: (k, v) => railAttrs.set(k, v),
      };
      const origQuery = rootEl.querySelector.bind(rootEl);
      rootEl.querySelector = (sel) => {
        if (sel === '#flux-inspector-shell') return shellEl;
        if (sel === '#flux-inspector-pod') return podEl;
        return origQuery(sel);
      };
      rootEl.querySelectorAll = (sel) =>
        sel === '#flux-inspector-rail .vertical-tab-item' ? [railBtn] : [];

      const { coordinator, state } = createHarness({ isSessionEnterPending: () => false });
      try {
        state.sessions = [{ id: 'sess-test', cwd: '/ws/demo' }];

        // 首帧：收起态全量挂载（包含常驻竖栏）
        coordinator.render();
        assert.ok(rootEl.innerHTML.includes('id="flux-inspector-rail"'));
        assert.ok(rootEl.innerHTML.includes('class="flux-inspector-pod inspector-collapsed"'));

        // 展开：增量分支 true -> false
        state.inspectorCollapsed = false;
        state.fileTreeState = { status: 'ready', rootPath: '/ws/demo', source: 'local_fs', nodes: [] };
        state.fileTreeExpandedPaths = ['/ws/demo'];
        state.fileTreeFilterQuery = 'index';
        state.fileTreeCollapsed = false;
        coordinator.render();
        assert.ok(shellEl.outerHTML.includes('class="inspector-floating-window"'));
        assert.ok(shellEl.outerHTML.includes('demo'));

        // 保持展开二次更新：!state.inspectorCollapsed 分支
        state.fileTreeCollapsed = true;
        coordinator.render();
        assert.ok(shellEl.outerHTML.includes('id="btn-file-tree-expand"'));

        // 无本地 session cwd 时，workspaceRootName 必须回退取 fileTreeState.rootPath basename
        state.sessions = [];
        state.fileTreeCollapsed = false;
        state.fileTreeState = { status: 'ready', rootPath: '/opt/data', source: 'gateway_api', nodes: [] };
        coordinator.render();
        assert.ok(shellEl.outerHTML.includes('>data<'));

        // 收起：增量分支 false -> true，常驻竖栏按钮立即退出高亮
        state.inspectorCollapsed = true;
        coordinator.render();
        assert.deepEqual(removedClasses, ['active-tab']);
        assert.equal(railAttrs.get('aria-pressed'), 'false');
      } finally {
        coordinator.dispose();
      }
    } finally {
      dom.restore();
    }
  });

  function installDomStub() {
    const saved = {
      document: globalThis.document,
      window: globalThis.window,
      raf: globalThis.requestAnimationFrame,
      gcs: globalThis.getComputedStyle,
      htmlElement: globalThis.HTMLElement,
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
    const rootAttrs = new Map();
    const rootProps = new Map();
    globalThis.document = {
      getElementById: (id) => elements.get(id) ?? null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => makeEl(tag),
      addEventListener() {},
      removeEventListener() {},
      documentElement: {
        style: {
          setProperty(name, value) { rootProps.set(name, value); },
          getPropertyValue: () => '',
          removeProperty() {},
        },
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        setAttribute(name, value) { rootAttrs.set(name, value); },
        getAttribute: () => null,
        removeAttribute() {},
      },
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
    globalThis.HTMLElement = saved.htmlElement ?? class HTMLElement {};
    return {
      elements,
      rootAttrs,
      rootProps,
      restore: () => {
        globalThis.document = saved.document;
        globalThis.window = saved.window;
        globalThis.requestAnimationFrame = saved.raf;
        globalThis.getComputedStyle = saved.gcs;
        globalThis.HTMLElement = saved.htmlElement;
      },
    };
  }
});
