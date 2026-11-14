import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMessageWindowManager,
  INITIAL_RENDER_WINDOW,
  RENDER_WINDOW_STEP,
  MESSAGE_WINDOW_CAPACITY,
} from '../../dist/renderer/messageWindowManager.mjs';

test('MessageWindowManager - 虚拟化窗口管理领域纯行为测试', async (t) => {
  function createHarness(initialMessagesCount = 200) {
    const messages = Array.from({ length: initialMessagesCount }, (_, i) => ({
      id: `msg-${i + 1}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message content ${i + 1}`,
    }));

    const state = {
      activeSessionId: 'sess-1',
      messages,
    };

    const sideEffects = {
      renders: 0,
      switchedSessions: 0,
      canvasStructureDirty: false,
      suppressPinBottomOnce: false,
      bottomSettles: 0,
    };

    const manager = createMessageWindowManager({
      getState: () => state,
      render: () => {
        sideEffects.renders += 1;
      },
      isStreamNearBottom: () => true,
      scrollStreamToBottom: () => {},
      scrollStreamToContentBottom: () => {},
      settleInitialBottom: () => {
        sideEffects.bottomSettles += 1;
      },
      syncPromptNavigatorFromScroll: () => {},
      onSessionSwitched: () => {
        sideEffects.switchedSessions += 1;
      },
      setCanvasStructureDirty: (val) => {
        sideEffects.canvasStructureDirty = val;
      },
      setSuppressPinBottomOnce: (val) => {
        sideEffects.suppressPinBottomOnce = val;
      },
    });

    return { state, sideEffects, manager };
  }

  await t.test('1. ensureMessageWindow 首屏规划有界窗口覆盖末尾', () => {
    const { state, manager } = createHarness(200);
    manager.ensureMessageWindow(state.messages.length);

    // 200 条消息，尾部窗口应当从 200 - 120 = 80 开始，到 200
    assert.equal(manager.getMessageWindowStart(), 80);
    assert.equal(manager.getMessageWindowEnd(), 200);
    assert.equal(manager.isMessageWindowUserExpanded(), false);
  });

  await t.test('2. 切会话触发 onSessionSwitched 并重置行高与滚动状态', () => {
    const { state, sideEffects, manager } = createHarness(100);
    manager.ensureMessageWindow(state.messages.length);
    assert.equal(sideEffects.switchedSessions, 1);

    // 同一会话再次规划，不触发重置
    manager.ensureMessageWindow(state.messages.length);
    assert.equal(sideEffects.switchedSessions, 1);

    // 换会话
    state.activeSessionId = 'sess-2';
    manager.ensureMessageWindow(state.messages.length);
    assert.equal(sideEffects.switchedSessions, 2);
    assert.equal(manager.isAverageRowHeightLocked(), false);
  });

  await t.test('3. expandMessageWindow 向上扩展窗口并置位脏标记', () => {
    const { state, sideEffects, manager } = createHarness(200);
    manager.ensureMessageWindow(state.messages.length);
    const startBefore = manager.getMessageWindowStart();
    assert.equal(startBefore, 80);

    const expanded = manager.expandMessageWindow();
    assert.equal(expanded, true);
    // 步长 RENDER_WINDOW_STEP=40，起点应前推到 80 - 40 = 40
    assert.equal(manager.getMessageWindowStart(), 40);
    assert.equal(manager.isMessageWindowUserExpanded(), true);
    assert.equal(sideEffects.canvasStructureDirty, true);
    assert.equal(sideEffects.suppressPinBottomOnce, true);
    assert.ok(sideEffects.renders >= 1);
  });

  await t.test('4. slideMessageWindowForward 向下滑动有界窗口', () => {
    const { state, manager } = createHarness(200);
    manager.ensureMessageWindow(state.messages.length);
    manager.expandMessageWindow(); // start: 40
    manager.expandMessageWindow(); // start: 0

    assert.equal(manager.getMessageWindowStart(), 0);
    manager.slideMessageWindowForward();
    // 应该整体前移 RENDER_WINDOW_STEP = 40
    assert.equal(manager.getMessageWindowStart(), 40);
    assert.equal(manager.getMessageWindowEnd(), 160);
  });

  await t.test('5. relocateMessageWindowToIndex 在索引越界时拒绝，合法时定位', () => {
    const { state, manager } = createHarness(200);
    manager.ensureMessageWindow(state.messages.length);

    assert.equal(manager.relocateMessageWindowToIndex(-5), false);
    assert.equal(manager.relocateMessageWindowToIndex(999), false);

    const moved = manager.relocateMessageWindowToIndex(50);
    assert.equal(moved, true);
    assert.ok(manager.getMessageWindowStart() <= 50);
    assert.ok(manager.getMessageWindowEnd() > 50);
  });

  await t.test('6. computeContentOffsetPx 与 computeVirtualHeightPx 虚拟坐标换算', () => {
    const { state, manager } = createHarness(200);
    manager.ensureMessageWindow(state.messages.length);
    manager.setMessageWindowStart(10);

    // 默认 averageRowHeightPx = 96
    const offset = manager.computeContentOffsetPx();
    assert.equal(offset, 10 * 96);

    const vHeight = manager.computeVirtualHeightPx();
    assert.equal(vHeight, 200 * 96);
  });

  await t.test('7. layoutSignature 包含总数与 pending 状态', () => {
    const { state, manager } = createHarness(150);
    assert.equal(manager.layoutSignature(), '150:pending');
  });

  await t.test('8. markProgrammaticScroll 登记落地值与未来时间窗', () => {
    const { manager } = createHarness(50);
    const fakeStream = { scrollTop: 123.4 };
    manager.markProgrammaticScroll(fakeStream);

    assert.equal(manager.getProgrammaticScrollTarget(), 123);
    assert.ok(manager.getProgrammaticScrollIgnoreUntil() > 0);
  });
});
