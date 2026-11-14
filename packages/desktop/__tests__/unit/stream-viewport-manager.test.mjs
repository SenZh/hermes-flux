/**
 * 会话流视口滚动与锚定定位管理器单元测试（Stream Viewport Manager Test）
 *
 * 【断言与杀伤力】
 *   1. 48px 贴底判定不变量：≤48px 判定为贴底，>48px 判定离开底部；
 *   2. 贴底对齐计算：当窗口覆盖末尾时，按虚拟窗口真实底边与 reserve 对齐，而非粗暴估算；
 *   3. 锚点捕获与重放：同会话且目标行存在时根据 delta 增量调整 scrollTop；
 *   4. 切会话丢弃旧锚点：跨会话时直接贴到末尾，绝不继承旧会话 offset；
 *   5. 状态拦截门禁：promptJumpSettling 或 initialBottomSettling 为 true 时拦截锚点重放。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  StreamViewportManager,
  STICK_TO_BOTTOM_THRESHOLD_PX,
} from '../../dist/renderer/viewport/streamViewportManager.mjs';

function createMockViewportHost(overrides = {}) {
  let activeSessionId = overrides.activeSessionId ?? 'sess-1';
  let isPromptJumpSettling = overrides.isPromptJumpSettling ?? false;
  let windowEnd = overrides.windowEnd ?? 100;
  let totalMessages = overrides.totalMessages ?? 100;
  let presenceLayout = overrides.presenceLayout ?? 'dock';

  const programmaticScrolls = [];
  const traces = [];
  const debugs = [];

  const host = {
    getActiveSessionId: () => activeSessionId,
    getPresenceLayout: () => presenceLayout,
    isPromptJumpSettling: () => isPromptJumpSettling,
    getMessageWindowEnd: () => windowEnd,
    getTotalMessages: () => totalMessages,
    layoutSignature: () => 'sig-mock',
    getStreamElement: () => overrides.streamElement ?? null,
    getVirtualWindowElement: () => overrides.virtualWindowElement ?? null,
    markProgrammaticScroll: (stream) => programmaticScrolls.push(stream),
    logTrace: (msg, meta) => traces.push({ msg, meta }),
    logDebug: (msg, meta) => debugs.push({ msg, meta }),
    requestAnimationFrame: (cb) => {
      cb();
      return 1;
    },
    _setSessionId: (id) => { activeSessionId = id; },
    _setPromptJumpSettling: (s) => { isPromptJumpSettling = s; },
    _programmaticScrolls: programmaticScrolls,
    _traces: traces,
    _debugs: debugs,
  };

  return host;
}

test('StreamViewportManager 核心视口与锚点行为单测', async (t) => {
  await t.test('1. 48px 贴底判定不变量', () => {
    const host = createMockViewportHost();
    const manager = new StreamViewportManager(host);

    assert.equal(STICK_TO_BOTTOM_THRESHOLD_PX, 48);

    // 刚好在底部 (distance = 0 <= 48)
    const streamNear = { scrollHeight: 1000, scrollTop: 600, clientHeight: 400 };
    assert.equal(manager.isNearBottom(streamNear), true);

    // 距离底部 48px (刚好贴底阈值)
    const streamBorder = { scrollHeight: 1000, scrollTop: 552, clientHeight: 400 };
    assert.equal(manager.isNearBottom(streamBorder), true);

    // 距离底部 49px (已离开贴底区)
    const streamFar = { scrollHeight: 1000, scrollTop: 551, clientHeight: 400 };
    assert.equal(manager.isNearBottom(streamFar), false);
  });

  await t.test('2. scrollStreamToContentBottom 窗口覆盖末尾时按窗口底边对齐', () => {
    const fakeStream = {
      scrollTop: 500,
      scrollHeight: 2000,
      clientHeight: 500,
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
    };
    const fakeWindow = {
      getBoundingClientRect: () => ({ top: 100, bottom: 480 }),
    };

    const host = createMockViewportHost({
      streamElement: fakeStream,
      virtualWindowElement: fakeWindow,
      windowEnd: 100,
      totalMessages: 100,
    });
    const manager = new StreamViewportManager(host);

    // stream.bottom - reservePx = 500 - 32 = 468
    // window.bottom = 480. delta = 480 - 468 = +12
    manager.scrollStreamToContentBottom(fakeStream, 32);
    assert.equal(fakeStream.scrollTop, 512, 'scrollTop 必须增量加 12px 达到精确贴底');
    assert.equal(host._programmaticScrolls.length, 1);
  });

  await t.test('3. applyStreamAnchor 跨会话切换时直接重置到底部，不继承旧偏移', () => {
    const fakeStream = {
      scrollTop: 300,
      scrollHeight: 1500,
      clientHeight: 400,
    };
    const host = createMockViewportHost({
      streamElement: fakeStream,
      activeSessionId: 'sess-current',
    });
    const manager = new StreamViewportManager(host);

    const oldAnchor = {
      sessionId: 'sess-old',
      id: 'msg-1',
      offset: 15,
      rawScrollTop: 300,
    };

    manager.applyStreamAnchor(oldAnchor, false);
    assert.equal(fakeStream.scrollTop, 1500, '切会话后必须直接置到底部');
  });

  await t.test('4. 跳转落定 (promptJumpSettling) 或首屏落定 (initialBottomSettling) 拦截锚点重放', () => {
    const fakeStream = { scrollTop: 500 };
    const host = createMockViewportHost({
      streamElement: fakeStream,
      isPromptJumpSettling: true,
    });
    const manager = new StreamViewportManager(host);

    const anchor = { sessionId: 'sess-1', id: 'm1', offset: 10, rawScrollTop: 100 };
    manager.applyStreamAnchor(anchor, false);
    assert.equal(fakeStream.scrollTop, 500, 'promptJumpSettling 期间不得重放锚点');

    host._setPromptJumpSettling(false);
    manager.setInitialBottomSettling(true);
    manager.applyStreamAnchor(anchor, false);
    assert.equal(fakeStream.scrollTop, 500, 'initialBottomSettling 期间不得重放锚点');
  });
});
