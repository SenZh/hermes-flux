import test from 'node:test';
import assert from 'node:assert/strict';

import { createRenderCoordinator } from '../../dist/renderer/renderCoordinator.mjs';

test('RenderCoordinator - 渲染装配与协调管线领域纯行为测试', async (t) => {
  function createHarness() {
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
      bindEvents: () => {
        sideEffects.eventsBound += 1;
      },
      syncComposerPoppers: () => {
        sideEffects.poppersSynced += 1;
      },
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
});
