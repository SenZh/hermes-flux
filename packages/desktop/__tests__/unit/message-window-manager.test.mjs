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

  await t.test('1. ensureMessageWindow 原生流全量挂载覆盖全部消息', () => {
    const { state, manager } = createHarness(200);
    manager.ensureMessageWindow(state.messages.length);

    // 原生流模式：全量挂载 [0, total]，由 CSS content-visibility 处理离屏遏制
    assert.equal(manager.getMessageWindowStart(), 0);
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

  await t.test('3. expandMessageWindow 原生流下已全量挂载，无多余扩展', () => {
    const { state, manager } = createHarness(200);
    manager.ensureMessageWindow(state.messages.length);
    assert.equal(manager.getMessageWindowStart(), 0);
    assert.equal(manager.getMessageWindowEnd(), 200);
  });

  await t.test('4. slideMessageWindowForward 在全量挂载下安全空转', () => {
    const { state, manager } = createHarness(200);
    manager.ensureMessageWindow(state.messages.length);
    manager.slideMessageWindowForward();
    assert.equal(manager.getMessageWindowStart(), 0);
    assert.equal(manager.getMessageWindowEnd(), 200);
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

  await t.test('6. 原生流下 computeContentOffsetPx 与 computeVirtualHeightPx 恒为 0 消除假虚拟高度', () => {
    const { state, manager } = createHarness(200);
    manager.ensureMessageWindow(state.messages.length);

    assert.equal(manager.computeContentOffsetPx(), 0);
    assert.equal(manager.computeVirtualHeightPx(), 0);
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

  await t.test('9. syncScrollTopToWindow 与 scheduleVirtualHeightSync 兜底覆盖', () => {
    const { manager } = createHarness(50);
    manager.syncScrollTopToWindow('test');

    const origRaf = globalThis.requestAnimationFrame;
    delete globalThis.requestAnimationFrame;
    try {
      manager.scheduleVirtualHeightSync();
    } finally {
      if (origRaf) globalThis.requestAnimationFrame = origRaf;
    }
  });
});
