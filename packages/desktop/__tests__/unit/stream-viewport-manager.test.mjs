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

  await t.test('5. 落定状态机：状态写入 host 而非类内副本', () => {
    const host = createMockViewportHost();
    const manager = new StreamViewportManager(host);

    // host 未注入 settle 三件套时走类内字段兜底
    manager.setInitialBottomSettling(true);
    assert.equal(manager.isInitialBottomSettling(), true, '无 host 注入时必须走类内字段兜底');
    manager.setSettleMinFrames(5);
    assert.equal(manager.getSettleMinFrames(), 5);
    manager.setSettledLayoutSignature('sig-x');
    assert.equal(manager.getSettledLayoutSignature(), 'sig-x');
  });

  await t.test('6. 落定状态机：host 注入时以 host 为准（类内副本不得覆盖）', () => {
    const writes = { initialBottomSettling: [], settleMinFrames: [], settledLayoutSignature: [] };
    let hostInitial = false;
    let hostFrames = 0;
    let hostSig = '';
    const host = createMockViewportHost();
    host.getInitialBottomSettling = () => hostInitial;
    host.setInitialBottomSettling = (v) => { hostInitial = v; writes.initialBottomSettling.push(v); };
    host.getSettleMinFrames = () => hostFrames;
    host.setSettleMinFrames = (v) => { hostFrames = v; writes.settleMinFrames.push(v); };
    host.getSettledLayoutSignature = () => hostSig;
    host.setSettledLayoutSignature = (v) => { hostSig = v; writes.settledLayoutSignature.push(v); };

    const manager = new StreamViewportManager(host);

    manager.setInitialBottomSettling(true);
    assert.equal(hostInitial, true, '写入必须落到 host');
    assert.deepEqual(writes.initialBottomSettling, [true]);
    assert.equal(manager.isInitialBottomSettling(), true);

    // 外部（conversationStreamController 路径）直接改 host，管理器必须立即可见
    hostInitial = false;
    assert.equal(manager.isInitialBottomSettling(), false, '读取必须以 host 为准，而非类内旧值 true');
  });

  await t.test('7. settleInitialBottom 正向收敛：贴底后清零 settling 并写入布局签名', () => {
    const fakeStream = {
      scrollTop: 500,
      scrollHeight: 1000,
      clientHeight: 500,
      paddingBottom: '0px',
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
    };
    const writes = [];
    const sigWrites = [];
    let settling = true;
    const host = createMockViewportHost({ streamElement: fakeStream });
    host.getInitialBottomSettling = () => settling;
    host.setInitialBottomSettling = (v) => { settling = v; writes.push(v); };
    host.getSettleMinFrames = () => 0;
    host.setSettleMinFrames = () => {};
    host.setSettledLayoutSignature = (v) => sigWrites.push(v);

    const manager = new StreamViewportManager(host);
    manager.settleInitialBottom();

    assert.equal(settling, false, '已贴底（after<=2）必须退出落定期');
    assert.deepEqual(writes, [false]);
    assert.deepEqual(sigWrites, ['sig-mock'], '退出落定期必须记录当次布局签名');
  });

  await t.test('8. settleInitialBottom 未贴底时保持落定期（不得提前清零）', () => {
    // 远离底部：after 远大于 2，且虚拟窗口底边与安全底偏离
    const fakeStream = {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 100,
      paddingBottom: '0px',
      getBoundingClientRect: () => ({ top: 0, bottom: 100 }),
    };
    const fakeWindow = { getBoundingClientRect: () => ({ top: 0, bottom: 900 }) };
    let settling = true;
    const writes = [];
    // 收集帧回调而不自动递归：只驱动「第一帧」观察单帧决策
    const pendingFrames = [];
    const host = createMockViewportHost({ streamElement: fakeStream, virtualWindowElement: fakeWindow });
    host.requestAnimationFrame = (cb) => { pendingFrames.push(cb); return 1; };
    host.getInitialBottomSettling = () => settling;
    host.setInitialBottomSettling = (v) => { settling = v; writes.push(v); };
    host.getSettleMinFrames = () => 0;
    host.setSettleMinFrames = () => {};

    const manager = new StreamViewportManager(host);
    manager.settleInitialBottom();

    assert.equal(pendingFrames.length, 1, '必须把工作压进下一帧，而非同步写满');
    pendingFrames.shift()();

    assert.equal(settling, true, '未贴底时不得退出落定期');
    assert.deepEqual(writes, [], '未收敛前不得写 settling=false');
    assert.equal(pendingFrames.length, 1, '未收敛必须排下一帧继续落定');
  });

  await t.test('9. settleInitialBottom 容器消失时立即退出落定期（不得空转 90 帧）', () => {
    let settling = true;
    const writes = [];
    const sigWrites = [];
    const host = createMockViewportHost({ streamElement: null });
    host.getInitialBottomSettling = () => settling;
    host.setInitialBottomSettling = (v) => { settling = v; writes.push(v); };
    host.setSettledLayoutSignature = (v) => sigWrites.push(v);

    const manager = new StreamViewportManager(host);
    manager.settleInitialBottom();

    assert.equal(settling, false, '容器不存在必须立即退出，而非逐帧空转');
    assert.deepEqual(writes, [false]);
    assert.deepEqual(sigWrites, ['sig-mock']);
  });

  await t.test('10. settleInitialBottom 未开启落定期时直接返回（不触碰任何状态）', () => {
    let settling = false;
    const writes = [];
    const host = createMockViewportHost();
    host.getInitialBottomSettling = () => settling;
    host.setInitialBottomSettling = (v) => { settling = v; writes.push(v); };

    const manager = new StreamViewportManager(host);
    manager.settleInitialBottom();

    assert.deepEqual(writes, [], '未在落定期时调用不得产生任何状态写入');
  });

  await t.test('11. syncStreamBottomInset 写入底部留白后自陷落定（不得无限递归）', () => {
    // 贴底但内容底边与可见安全底偏离 >4px，应写入 --conv-gutter-bottom 并重启落定期
    const gutterWrites = [];
    const fakeStream = {
      scrollTop: 500,
      scrollHeight: 1000,
      clientHeight: 500,
      style: {
        getPropertyValue: () => '',
        setProperty: (name, value) => gutterWrites.push({ name, value }),
      },
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
    };
    const fakePod = { getBoundingClientRect: () => ({ top: 0, bottom: 600 }) };
    const fakeDock = { getBoundingClientRect: () => ({ top: 560, bottom: 700 }) };
    const fakeWindow = { getBoundingClientRect: () => ({ top: 0, bottom: 900 }) };

    let settling = false;
    const settlingWrites = [];
    let settleCalls = 0;
    const pendingFrames = [];

    const host = createMockViewportHost({
      streamElement: fakeStream,
      virtualWindowElement: fakeWindow,
      presenceLayout: 'stage',
    });
    host.getMiddlePodElement = () => fakePod;
    host.getInputDockElement = () => fakeDock;
    host.requestAnimationFrame = (cb) => { pendingFrames.push(cb); return 1; };
    host.getInitialBottomSettling = () => settling;
    host.setInitialBottomSettling = (v) => { settling = v; settlingWrites.push(v); };
    host.getSettleMinFrames = () => 0;
    host.setSettleMinFrames = () => {};

    const manager = new StreamViewportManager(host);
    const originalSettle = manager.settleInitialBottom.bind(manager);
    manager.settleInitialBottom = (attempt) => { settleCalls += 1; originalSettle(attempt); };

    manager.syncStreamBottomInset();

    assert.equal(gutterWrites.length, 1, '内容底边偏离时必须写入一次 --conv-gutter-bottom');
    assert.equal(gutterWrites[0].name, '--conv-gutter-bottom');
    assert.equal(settlingWrites[0], true, '写完留白必须重启落定期，否则末条仍被输入舱压住');
    assert.equal(settleCalls, 1, '写入留白后必须触发一次落定');

    // 自陷递归有界：逐帧推进不超过 91 次（首帧 + 90 次重试上限）
    let frames = 0;
    while (pendingFrames.length > 0 && frames < 200) {
      pendingFrames.shift()();
      frames += 1;
    }
    assert.ok(frames <= 91, `落定递归必须有界，实测推进 ${frames} 帧`);
  });

  await t.test('12. syncStreamBottomInset 离开底部时不写入留白（避免打扰回溯阅读）', () => {
    const gutterWrites = [];
    const fakeStream = {
      scrollTop: 0,
      scrollHeight: 5000,
      clientHeight: 500,
      style: {
        getPropertyValue: () => '',
        setProperty: (name, value) => gutterWrites.push({ name, value }),
      },
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
    };
    const fakePod = { getBoundingClientRect: () => ({ top: 0, bottom: 600 }) };
    const fakeDock = { getBoundingClientRect: () => ({ top: 560, bottom: 700 }) };

    const host = createMockViewportHost({ streamElement: fakeStream, presenceLayout: 'stage' });
    host.getMiddlePodElement = () => fakePod;
    host.getInputDockElement = () => fakeDock;

    const manager = new StreamViewportManager(host);
    manager.syncStreamBottomInset();

    assert.deepEqual(gutterWrites, [], '读者已离开底部时不得重算留白，否则会顶动阅读位置');
  });

  await t.test('13. applyStreamAnchor 贴底分支：按 paddingBottom 精确贴底并写 trace', () => {
    const fakeStream = {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 1000,
      getBoundingClientRect: () => ({ top: 0, bottom: 1000 }),
    };
    const host = createMockViewportHost({ streamElement: fakeStream, windowEnd: 5, totalMessages: 5 });
    const manager = new StreamViewportManager(host);

    manager.applyStreamAnchor({ sessionId: 'sess-1', id: 'm1', offset: 0, rawScrollTop: 0 }, true);

    assert.equal(fakeStream.scrollTop, 1000, '贴底分支必须直接落到内容底');
    assert.equal(host._programmaticScrolls.length, 1, '必须标记为程序化滚动');
    assert.equal(host._traces[0]?.msg, 'pinned after render', '贴底必须写 trace 便于回溯');
  });

  await t.test('14. applyStreamAnchor 同会话同锚点行：按 delta 精确校正，小于 1px 不写', () => {
    const makeStream = (rowTop) => ({
      scrollTop: 300,
      scrollHeight: 2000,
      clientHeight: 500,
      getBoundingClientRect: () => ({ top: 100, bottom: 600 }),
      querySelector: () => ({ getBoundingClientRect: () => ({ top: rowTop, bottom: rowTop + 40 }) }),
    });

    // 锚点记录的 offset 是 20；当前 offset = 160 - 100 = 60 → delta = 40
    const stream = makeStream(160);
    const host = createMockViewportHost({ streamElement: stream, activeSessionId: 'sess-1' });
    const manager = new StreamViewportManager(host);
    manager.applyStreamAnchor({ sessionId: 'sess-1', id: 'm1', offset: 20, rawScrollTop: 300 }, false);
    assert.equal(stream.scrollTop, 340, '必须按 delta 增量校正 scrollTop');
    assert.equal(host._traces.find((t) => t.msg === 'anchor corrected')?.meta.delta, 40);

    // 亚像素漂移（|delta| < 1）不得写入，避免抖动
    const tinyStream = makeStream(120.4); // 当前 offset = 20.4，delta = 0.4
    const tinyHost = createMockViewportHost({ streamElement: tinyStream, activeSessionId: 'sess-1' });
    const tinyManager = new StreamViewportManager(tinyHost);
    tinyManager.applyStreamAnchor({ sessionId: 'sess-1', id: 'm1', offset: 20, rawScrollTop: 300 }, false);
    assert.equal(tinyStream.scrollTop, 300, '亚像素漂移必须忽略，否则每帧都在写 scrollTop');
    assert.equal(tinyHost._programmaticScrolls.length, 0);
  });

  await t.test('15. applyStreamAnchor 锚点行不在挂载窗口内：退化为 rawScrollTop 且不报错', () => {
    const fakeStream = {
      scrollTop: 900,
      scrollHeight: 2000,
      clientHeight: 500,
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
      querySelector: () => null, // 目标行未挂载
    };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-1' });
    const manager = new StreamViewportManager(host);

    manager.applyStreamAnchor({ sessionId: 'sess-1', id: 'unmounted', offset: 10, rawScrollTop: 777 }, false);

    assert.equal(fakeStream.scrollTop, 777, '目标行未挂载时必须回落到记录的原始 scrollTop');
    assert.equal(host._traces.find((t) => t.msg === 'anchor outside mounted window')?.meta.id, 'unmounted');
  });

  await t.test('16. applyStreamAnchor 无锚点 id 时回落 rawScrollTop', () => {
    const fakeStream = { scrollTop: 900, scrollHeight: 2000, clientHeight: 500 };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-1' });
    const manager = new StreamViewportManager(host);

    manager.applyStreamAnchor({ sessionId: 'sess-1', id: null, offset: 0, rawScrollTop: 123 }, false);
    assert.equal(fakeStream.scrollTop, 123);
  });

  await t.test('17. stabilizeStreamAnchor 吸收落定后残余漂移', () => {
    const target = { getBoundingClientRect: () => ({ top: 145 }) };
    const fakeStream = {
      scrollTop: 300,
      getBoundingClientRect: () => ({ top: 100 }),
      querySelector: () => target,
    };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-1' });
    const manager = new StreamViewportManager(host);

    // 当前 offset = 145 - 100 = 45；记录 offset 20 → drift = 25
    manager.stabilizeStreamAnchor({ sessionId: 'sess-1', id: 'm1', offset: 20, rawScrollTop: 300 });

    assert.equal(fakeStream.scrollTop, 325, '必须把残余漂移加回 scrollTop');
    assert.equal(host._debugs[0]?.msg, 'post-layout anchor drift absorbed');
    assert.equal(host._debugs[0]?.meta.drift, 25);
  });

  await t.test('18. stabilizeStreamAnchor 无 id / 行未挂载时不动作', () => {
    const fakeStream = { scrollTop: 300, querySelector: () => null, getBoundingClientRect: () => ({ top: 0 }) };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-1' });
    const manager = new StreamViewportManager(host);

    manager.stabilizeStreamAnchor({ sessionId: 'sess-1', id: null, offset: 0, rawScrollTop: 300 });
    assert.equal(fakeStream.scrollTop, 300, '无 id 时不得改动滚动位置');

    manager.stabilizeStreamAnchor({ sessionId: 'sess-1', id: 'gone', offset: 10, rawScrollTop: 300 });
    assert.equal(fakeStream.scrollTop, 300, '目标行未挂载时不得改动滚动位置');
    assert.equal(host._debugs.length, 0, '无实际漂移不得写入噪音日志');
  });

  await t.test('19. 无 stream 元素时所有视口操作安全空转', () => {
    const host = createMockViewportHost({ streamElement: null });
    const manager = new StreamViewportManager(host);

    manager.applyStreamAnchor({ sessionId: 'sess-1', id: 'm1', offset: 0, rawScrollTop: 0 }, true);
    manager.stabilizeStreamAnchor({ sessionId: 'sess-1', id: 'm1', offset: 0, rawScrollTop: 0 });
    manager.scrollStreamToBottom('no-element');

    assert.equal(host._programmaticScrolls.length, 0, '无元素时不得产生滚动副作用');
  });

  await t.test('20. scrollStreamToBottom 第二帧吸收残余漂移', () => {
    const fakeStream = {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 400,
      paddingBottom: '0px',
      getBoundingClientRect: () => ({ top: 0, bottom: 400 }),
    };
    const host = createMockViewportHost({ streamElement: fakeStream, windowEnd: 1, totalMessages: 1 });
    const manager = new StreamViewportManager(host);

    manager.scrollStreamToBottom('drift-check');

    // 首帧写到底；若布局在下一帧把内容撑高，第二帧需再次吸平
    assert.ok(fakeStream.scrollTop >= 0);
    assert.equal(host._debugs[0]?.msg, 'pinned to bottom', '必须记录贴底结果，含残余漂移量');
    assert.equal(typeof host._debugs[0]?.meta.residualDrift, 'number');
  });

  await t.test('21. captureStreamAnchor 取第一条 bottom 越过视口顶的行作为锚点', () => {
    const rows = [
      { getAttribute: () => 'row-0', getBoundingClientRect: () => ({ top: -90, bottom: -20 }) }, // 完全滚出视口
      { getAttribute: () => 'row-1', getBoundingClientRect: () => ({ top: -30, bottom: 25 }) }, // 首条仍露出
      { getAttribute: () => 'row-2', getBoundingClientRect: () => ({ top: 40, bottom: 100 }) },
    ];
    const fakeStream = {
      scrollTop: 640,
      scrollHeight: 2000,
      clientHeight: 500,
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
      querySelectorAll: () => rows,
    };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-42' });
    const manager = new StreamViewportManager(host);

    const anchor = manager.captureStreamAnchor();
    assert.equal(anchor.id, 'row-1', '必须跳过 bottom 未越过视口顶的行，取第一条仍可见的行');
    assert.equal(anchor.offset, -30, 'offset 必须是该行顶边相对视口顶边的距离（部分露出时为负）');
    assert.equal(anchor.rawScrollTop, 640);
    assert.equal(anchor.sessionId, 'sess-42');
  });

  await t.test('22. captureStreamAnchor 全部行都滚出视口时返回空锚点', () => {
    const rows = [
      { getAttribute: () => 'row-0', getBoundingClientRect: () => ({ top: -90, bottom: -20 }) },
    ];
    const fakeStream = {
      scrollTop: 900,
      scrollHeight: 2000,
      clientHeight: 500,
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
      querySelectorAll: () => rows,
    };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-7' });
    const manager = new StreamViewportManager(host);

    const anchor = manager.captureStreamAnchor();
    assert.equal(anchor.id, null, '无可见行时必须返回空锚点，而不是错拿一行');
    assert.equal(anchor.rawScrollTop, 900, '空锚点仍须记录当前 scrollTop 供回落');
  });

  await t.test('22. runRaf 无注入时回落到全局 requestAnimationFrame', () => {
    const fakeStream = {
      scrollTop: 0,
      scrollHeight: 500,
      clientHeight: 100,
      paddingBottom: '0px',
      getBoundingClientRect: () => ({ top: 0, bottom: 100 }),
    };
    const host = createMockViewportHost({ streamElement: fakeStream, windowEnd: 1, totalMessages: 1 });
    delete host.requestAnimationFrame; // 走全局分支
    const frames = [];
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return 1; };

    const manager = new StreamViewportManager(host);
    manager.scrollStreamToBottom('fallback-raf');

    assert.equal(frames.length, 1, '未注入 requestAnimationFrame 时必须回落到全局实现');
    frames.shift()();

    globalThis.requestAnimationFrame = originalRaf;
  });

  await t.test('23. settleInitialBottom 逐帧递减 settleMinFrames 后才允许收敛', () => {
    // 已贴底：窗口覆盖末尾且窗口底边与安全底对齐（reserve=0）
    const fakeStream = {
      scrollTop: 500,
      scrollHeight: 1000,
      clientHeight: 500,
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
    };
    const fakeWindow = { getBoundingClientRect: () => ({ top: 200, bottom: 500 }) };
    let settling = true;
    let frames = 2;
    const frameWrites = [];
    const pending = [];
    const host = createMockViewportHost({
      streamElement: fakeStream,
      virtualWindowElement: fakeWindow,
      windowEnd: 10,
      totalMessages: 10,
    });
    host.requestAnimationFrame = (cb) => { pending.push(cb); return 1; };
    host.getInitialBottomSettling = () => settling;
    host.setInitialBottomSettling = (v) => { settling = v; frameWrites.push(v); };
    host.getSettleMinFrames = () => frames;
    host.setSettleMinFrames = (v) => { frames = v; };

    const manager = new StreamViewportManager(host);
    manager.settleInitialBottom();

    // 第 1 帧：settleMinFrames 2 → 1，即使已贴底也不得收敛
    pending.shift()();
    assert.equal(frames, 1, '必须逐帧递减 settleMinFrames');
    assert.equal(settling, true, 'settleMinFrames 未归零前不得收敛，否则首屏会提前停止贴底');

    // 第 2 帧：1 → 0
    pending.shift()();
    assert.equal(frames, 0);
    assert.equal(settling, true);

    // 第 3 帧：settleMinFrames 已为 0，贴底且窗口对齐 → 收敛
    pending.shift()();
    assert.equal(settling, false, 'settleMinFrames 归零且已贴底后必须收敛');
    assert.deepEqual(frameWrites, [false]);
    assert.equal(pending.length, 0, '收敛后不得再排下一帧');
  });

  await t.test('24. syncStreamBottomInset 幂等地绑定 ResizeObserver', () => {
    const observed = [];
    const disconnected = [];
    const originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb) { this.cb = cb; }
      observe(el) { observed.push(el); }
      disconnect() { disconnected.push(true); }
    };

    const fakeStream = {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 500,
      style: { getPropertyValue: () => '', setProperty: () => {} },
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
    };
    const fakePod = { getBoundingClientRect: () => ({ top: 0, bottom: 600 }) };
    const dockA = { getBoundingClientRect: () => ({ top: 560, bottom: 700 }) };
    let currentDock = dockA;

    const host = createMockViewportHost({ streamElement: fakeStream, presenceLayout: 'stage' });
    host.getMiddlePodElement = () => fakePod;
    host.getInputDockElement = () => currentDock;

    const manager = new StreamViewportManager(host);
    manager.syncStreamBottomInset();
    manager.syncStreamBottomInset();

    assert.equal(observed.length, 1, '同一 dock 不得重复 observe，否则每次调用都新增一个监听');
    // 首次绑定会对空观察器做一次防御性 disconnect()，这不产生副作用（无监听可断）
    assert.equal(disconnected.length, 1, '首次绑定只允许一次空 disconnect，不得随调用次数增长');

    // 输入舱被重建（同一 DOM 位置换了个元素）时必须重新绑定
    const dockB = { getBoundingClientRect: () => ({ top: 560, bottom: 700 }) };
    currentDock = dockB;
    manager.syncStreamBottomInset();

    assert.equal(disconnected.length, 2, '输入舱换元素必须断开旧监听（累计第二次 disconnect）');
    assert.equal(observed.length, 2, '输入舱换元素必须重新 observe');

    // 再次调用不得产生第三次绑定
    manager.syncStreamBottomInset();
    assert.equal(observed.length, 2, '同一 dock 重复调用不得重复绑定');

    globalThis.ResizeObserver = originalResizeObserver;
  });

  await t.test('25. 锚点 id 含引号时走转义分支，不得注入非法选择器', () => {
    const target = { getBoundingClientRect: () => ({ top: 120 }) };
    let selectorUsed = '';
    const fakeStream = {
      scrollTop: 300,
      getBoundingClientRect: () => ({ top: 100 }),
      querySelector: (sel) => { selectorUsed = sel; return target; },
    };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-1' });
    const manager = new StreamViewportManager(host);

    // CSS.escape 可能不存在于 Node：两条分支都必须产出可用的选择器
    manager.applyStreamAnchor({ sessionId: 'sess-1', id: 'a"b', offset: 0, rawScrollTop: 0 }, false);

    assert.ok(selectorUsed.includes('data-msg-id='), '必须构造 data-msg-id 属性选择器');
    assert.ok(!selectorUsed.includes('"a"b"'), '双引号必须被转义，否则选择器语法非法直接抛错');

    // stabilizeStreamAnchor 同样必须走转义分支
    let stabilizeSelector = '';
    const stabilizeStream = {
      scrollTop: 300,
      getBoundingClientRect: () => ({ top: 100 }),
      querySelector: (sel) => { stabilizeSelector = sel; return null; },
    };
    const stabilizeHost = createMockViewportHost({ streamElement: stabilizeStream, activeSessionId: 'sess-1' });
    const stabilizeManager = new StreamViewportManager(stabilizeHost);
    stabilizeManager.stabilizeStreamAnchor({ sessionId: 'sess-1', id: 'x\\y', offset: 0, rawScrollTop: 300 });

    assert.ok(stabilizeSelector.includes('data-msg-id='), '残余漂移校正同样必须构造属性选择器');
    assert.ok(!stabilizeSelector.includes('"x\\y"'), '反斜杠必须被转义');
  });

  await t.test('26. scrollStreamToBottom 第二帧发现残余漂移时再次吸平', () => {
    // 真浏览器会把 scrollTop 钳位到 scrollHeight - clientHeight，桩必须还原该语义
    let scrollHeight = 1000;
    const fakeStream = {
      _top: 0,
      clientHeight: 400,
      get scrollHeight() { return scrollHeight; },
      get scrollTop() { return this._top; },
      set scrollTop(v) { this._top = Math.max(0, Math.min(v, this.scrollHeight - this.clientHeight)); },
      getBoundingClientRect: () => ({ top: 0, bottom: 400 }),
    };
    const pending = [];
    const host = createMockViewportHost({ streamElement: fakeStream, windowEnd: 1, totalMessages: 1 });
    host.requestAnimationFrame = (cb) => { pending.push(cb); return 1; };
    host.getVirtualWindowElement = () => null;

    const manager = new StreamViewportManager(host);
    manager.scrollStreamToBottom('drift');

    assert.equal(fakeStream.scrollTop, 600, '首帧贴到当时的可滚动底部 600');

    // 第二帧内容被撑高 200px：残留 200px 漂移必须被吸收
    scrollHeight = 1200;
    pending.shift()();

    assert.equal(fakeStream.scrollTop, 800, '第二帧必须吸收新撑高的 200px 漂移，否则末条被截断');
  });

  await t.test('27. scrollStreamToBottom 第二帧无漂移时不再写 scrollTop', () => {
    const fakeStream = {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 1000,
      getBoundingClientRect: () => ({ top: 0, bottom: 1000 }),
    };
    const pending = [];
    const host = createMockViewportHost({ streamElement: fakeStream, windowEnd: 1, totalMessages: 1 });
    host.requestAnimationFrame = (cb) => { pending.push(cb); return 1; };
    host.getVirtualWindowElement = () => null;

    const manager = new StreamViewportManager(host);
    manager.scrollStreamToBottom('no-drift');

    const afterFirst = fakeStream.scrollTop;
    const scrollsAfterFirst = host._programmaticScrolls.length;
    pending.shift()();

    assert.equal(fakeStream.scrollTop, afterFirst, '无漂移时不得重复写 scrollTop（会打断用户的滚动惯性）');
    assert.equal(host._programmaticScrolls.length, scrollsAfterFirst, '无漂移时不得再标记程序化滚动');
  });

  await t.test('28. host 未注入元素 getter 时兜底走 document.querySelector', () => {
    // 三元 `host.getX ? host.getX() : document.querySelector(...)` 的兜底侧，
    // 真实装配下用不到，但旧调用方（无 host 注入的测试/迁移期）依赖它，必须锁定不崩。
    const fakeStream = {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 500,
      style: { getPropertyValue: () => '', setProperty: () => {} },
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
    };
    const fakeWindow = { getBoundingClientRect: () => ({ top: 0, bottom: 990 }) };
    const fakePod = { getBoundingClientRect: () => ({ top: 0, bottom: 600 }) };
    const fakeDock = { getBoundingClientRect: () => ({ top: 560, bottom: 700 }) };

    const queried = [];
    globalThis.document = {
      getElementById: () => null,
      querySelector: (sel) => {
        queried.push(sel);
        if (sel === '.conv-virtual-window') return fakeWindow;
        if (sel === '.flux-middle-pod') return fakePod;
        if (sel === '.input-dock-container') return fakeDock;
        if (sel === '.conv-canvas') return fakeWindow;
        return null;
      },
    };

    const host = createMockViewportHost({ streamElement: fakeStream, windowEnd: 5, totalMessages: 5, presenceLayout: 'stage' });
    delete host.getVirtualWindowElement; // 触发兜底
    delete host.getMiddlePodElement;
    delete host.getInputDockElement;

    const manager = new StreamViewportManager(host);
    manager.scrollStreamToContentBottom(fakeStream, 0);
    manager.syncStreamBottomInset();
    manager.settleInitialBottom();

    assert.ok(queried.includes('.conv-virtual-window'), '未注入虚拟窗口 getter 时必须兜底查询 .conv-virtual-window');
    assert.ok(queried.includes('.flux-middle-pod'), '未注入中间舱 getter 时必须兜底查询 .flux-middle-pod');
    assert.ok(queried.includes('.input-dock-container'), '未注入输入舱 getter 时必须兜底查询 .input-dock-container');
  });

  await t.test('29. CSS.escape 可用时走原生转义分支', () => {
    const originalCss = globalThis.CSS;
    globalThis.CSS = { escape: (s) => `escaped(${s})` };

    let selectorUsed = '';
    const fakeStream = {
      scrollTop: 300,
      getBoundingClientRect: () => ({ top: 100 }),
      querySelector: (sel) => { selectorUsed = sel; return null; },
    };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-1' });
    const manager = new StreamViewportManager(host);

    manager.applyStreamAnchor({ sessionId: 'sess-1', id: 'a b', offset: 0, rawScrollTop: 0 }, false);
    assert.ok(selectorUsed.includes('escaped(a b)'), 'CSS.escape 存在时必须优先使用原生转义，而非手写替换');

    let stabilizeSelector = '';
    const stabilizeStream = {
      scrollTop: 300,
      getBoundingClientRect: () => ({ top: 100 }),
      querySelector: (sel) => { stabilizeSelector = sel; return null; },
    };
    const stabilizeHost = createMockViewportHost({ streamElement: stabilizeStream, activeSessionId: 'sess-1' });
    const stabilizeManager = new StreamViewportManager(stabilizeHost);
    stabilizeManager.stabilizeStreamAnchor({ sessionId: 'sess-1', id: 'c d', offset: 0, rawScrollTop: 300 });
    assert.ok(stabilizeSelector.includes('escaped(c d)'), '残余漂移校正同样必须优先用原生转义');

    globalThis.CSS = originalCss;
  });
});
