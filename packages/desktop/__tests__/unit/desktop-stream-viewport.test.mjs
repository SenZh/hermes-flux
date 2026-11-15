/**
 * 桌面壳会话流视口装配单元测试（Desktop Stream Viewport Wiring Test）
 *
 * 【断言与杀伤力】
 *   1. 装配完整性（反向攻击 Batch 7 缺陷）：`createDesktopStreamViewport` 返回可用的
 *      StreamViewportManager 实例，且 `captureStreamAnchor` / `applyStreamAnchor` /
 *      `stabilizeStreamAnchor` / `syncStreamBottomInset` 均可在无 DOM 环境下安全调用，
 *      绝不因宿主能力缺失抛 TypeError（原缺陷正是 render 首帧直接崩溃、界面全黑）；
 *   2. 落定状态单一真值源：经管理器写入的 initialBottomSettling / settleMinFrames /
 *      settledLayoutSignature 必须落在共享的 streamSettleState 上，而不是类内部私有副本，
 *      否则 conversationStreamController 读不到、首屏贴底逐帧抖动；
 *   3. 宿主转发正确性：getStreamElement 走 `conversation-stream`，几何与日志委托真实反射 deps。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDesktopStreamViewport, streamSettleState } from '../../dist/renderer/viewport/desktopStreamViewport.mjs';

/**
 * 最小 document 桩：装配层用 `document.getElementById('conversation-stream')` 取宿主元素，
 * Node 单测无 DOM，这里给出显式空返回值而非静默跳过——保证「取不到容器」是受控分支。
 */
globalThis.document = {
  getElementById: () => null,
  querySelector: () => null,
};

function createDeps(overrides = {}) {  const traces = [];
  const debugs = [];
  const scrolls = [];
  let layoutSignatureCalls = 0;

  const state = {
    activeSessionId: overrides.activeSessionId ?? 'sess-a',
    presenceLayout: overrides.presenceLayout ?? 'dock',
    messages: overrides.messages ?? [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
  };

  return {
    getState: () => state,
    logScroll: {
      trace: (msg, meta) => traces.push({ msg, meta }),
      debug: (msg, meta) => debugs.push({ msg, meta }),
    },
    layoutSignature: () => {
      layoutSignatureCalls += 1;
      return `sig-${state.activeSessionId}-${state.messages.length}`;
    },
    markProgrammaticScroll: (stream) => scrolls.push(stream),
    isPromptJumpSettling: () => overrides.isPromptJumpSettling ?? false,
    getWindowGeom: () => overrides.windowGeom ?? { start: 0, end: 1, averageRowHeightPx: 72 },
    _state: state,
    _traces: traces,
    _debugs: debugs,
    _scrolls: scrolls,
    _layoutSignatureCalls: () => layoutSignatureCalls,
  };
}

test('DesktopStreamViewport 装配与单一真值源单测', async (t) => {
  await t.test('1. 装配完整性：所有公开方法在无 DOM 下不得抛错', () => {
    const manager = createDesktopStreamViewport(createDeps());

    assert.equal(typeof manager.captureStreamAnchor, 'function');
    assert.doesNotThrow(() => manager.captureStreamAnchor());
    assert.doesNotThrow(() => manager.applyStreamAnchor({ sessionId: 'sess-a', id: null, offset: 0, rawScrollTop: 0 }, false));
    assert.doesNotThrow(() => manager.stabilizeStreamAnchor({ sessionId: 'sess-a', id: null, offset: 0, rawScrollTop: 0 }));
    assert.doesNotThrow(() => manager.syncStreamBottomInset());
    assert.doesNotThrow(() => manager.scheduleStreamBottomInset());
    assert.doesNotThrow(() => manager.scrollStreamToBottom('unit-test'));
    assert.doesNotThrow(() => manager.settleInitialBottom());
    assert.doesNotThrow(() => manager.isNearBottom(null));
  });

  await t.test('2. 锚点捕获在无容器时返回当前会话的空锚点', () => {
    const deps = createDeps({ activeSessionId: 'sess-xyz' });
    const manager = createDesktopStreamViewport(deps);
    const anchor = manager.captureStreamAnchor();

    assert.equal(anchor.sessionId, 'sess-xyz');
    assert.equal(anchor.id, null);
    assert.equal(anchor.offset, 0);
    assert.equal(anchor.rawScrollTop, 0);
  });

  await t.test('3. 落定状态写入共享真值源，而非类私有副本', () => {
    // 归零后再验证，避免用例间污染
    streamSettleState.initialBottomSettling = false;
    streamSettleState.settleMinFrames = 0;
    streamSettleState.settledLayoutSignature = '';

    const manager = createDesktopStreamViewport(createDeps());

    manager.setInitialBottomSettling(true);
    assert.equal(streamSettleState.initialBottomSettling, true);
    assert.equal(manager.isInitialBottomSettling(), true);

    manager.setSettleMinFrames(7);
    assert.equal(streamSettleState.settleMinFrames, 7);
    assert.equal(manager.getSettleMinFrames(), 7);

    manager.setSettledLayoutSignature('sig-shared');
    assert.equal(streamSettleState.settledLayoutSignature, 'sig-shared');
    assert.equal(manager.getSettledLayoutSignature(), 'sig-shared');

    // 外部（conversationStreamController 路径）写入必须被管理器立即可见
    streamSettleState.initialBottomSettling = false;
    assert.equal(manager.isInitialBottomSettling(), false);
  });

  await t.test('4. 几何能力真实反射 deps：窗口几何驱动贴底对齐计算', () => {
    // 注入可测量的假 stream：窗口覆盖末尾时按虚拟窗口真实底边对齐
    const fakeStream = {
      scrollTop: 500,
      scrollHeight: 2000,
      clientHeight: 500,
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
    };
    const deps = createDeps({
      windowGeom: { start: 0, end: 100, averageRowHeightPx: 111 },
      messages: new Array(100).fill(null).map((_, i) => ({ id: `m${i}` })),
    });
    const manager = createDesktopStreamViewport(deps);

    // reservePx = 32 → stream.bottom - 32 = 468
    // 虚拟窗口底边 = 480 → delta = 480 - 468 = +12 → scrollTop 500 + 12 = 512
    const fakeWindow = { getBoundingClientRect: () => ({ top: 100, bottom: 480 }) };
    globalThis.document.querySelector = () => fakeWindow;

    manager.scrollStreamToContentBottom(fakeStream, 32);
    assert.equal(fakeStream.scrollTop, 512, '按虚拟窗口真实底边精确贴底，而非粗暴写 scrollHeight');
    assert.equal(deps._scrolls.length, 1, '程序化滚动必须被标记，否则会被误判为用户回溯');

    globalThis.document.querySelector = () => null;
  });

  await t.test('5. 日志能力真实反射 deps：贴底后写入 pinned to bottom 调试日志', async () => {
    const fakeStream = {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 1000,
      getBoundingClientRect: () => ({ top: 0, bottom: 1000 }),
    };
    const deps = createDeps({ windowGeom: { start: 0, end: 0, averageRowHeightPx: 80 } });
    const manager = createDesktopStreamViewport(deps);

    // 装配层用 document.getElementById 取容器；此处注入真实可测量元素
    globalThis.document.getElementById = () => fakeStream;
    manager.scrollStreamToBottom('日志反射校验');

    // 收尾日志走 runRaf（真实环境 requestAnimationFrame，Node 下退化为 setTimeout(16)），必须等一帧
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(deps._debugs.length, 1, '贴底后必须写入一条 debug 日志');
    assert.equal(deps._debugs[0].msg, 'pinned to bottom', '日志必须携带可定位的固定文案');
    assert.equal(deps._debugs[0].meta.reason, '日志反射校验', '日志必须透传调用方给的原因，便于回溯');

    globalThis.document.getElementById = () => null;
  });

  await t.test('6. 会话切换后锚点会话 id 跟随 deps 状态', () => {
    const deps = createDeps({ activeSessionId: 'sess-a' });
    const manager = createDesktopStreamViewport(deps);

    assert.equal(manager.captureStreamAnchor().sessionId, 'sess-a');
    deps._state.activeSessionId = 'sess-b';
    assert.equal(manager.captureStreamAnchor().sessionId, 'sess-b');
  });

  await t.test('7. 跨模块共享：messageWindowManager 侧的 settleMinFrames 重置对管理器立即可见', () => {
    // 反向攻击原缺陷：若 StreamViewportManager 自持私有副本，这条必然读到 0
    streamSettleState.settleMinFrames = 0;
    const manager = createDesktopStreamViewport(createDeps());

    streamSettleState.settleMinFrames = 8; // 模拟 messageWindowManager 的 setSettleMinFrames(8)
    assert.equal(manager.getSettleMinFrames(), 8, '共享真值源写入必须被管理器读到，而非类内旧副本 0');
  });

  await t.test('8. 跨模块共享：conversationStreamController 置 settling 后锚点重放被拦截', () => {
    const fakeStream = {
      scrollTop: 500,
      scrollHeight: 1500,
      clientHeight: 400,
      querySelectorAll: () => [],
    };
    const deps = createDeps({ messages: [{ id: 'm1' }] });
    const manager = createDesktopStreamViewport(deps);

    globalThis.document.getElementById = () => fakeStream;

    // 模拟 conversationStreamController.ts:423 setInitialBottomSettling(true)
    streamSettleState.initialBottomSettling = true;
    const anchor = { sessionId: 'sess-a', id: 'm1', offset: 10, rawScrollTop: 100 };
    manager.applyStreamAnchor(anchor, false);
    assert.equal(fakeStream.scrollTop, 500, '落定期内不得重放锚点，否则会与 settleInitialBottom 抢方向盘');

    streamSettleState.initialBottomSettling = false;
    globalThis.document.getElementById = () => null;
  });
});
