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
  escapeMessageId,
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
  const warns = [];

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
    logWarn: (msg, meta) => warns.push({ msg, meta }),
    requestAnimationFrame: (cb) => {
      cb();
      return 1;
    },
    _setSessionId: (id) => { activeSessionId = id; },
    _setPromptJumpSettling: (s) => { isPromptJumpSettling = s; },
    _programmaticScrolls: programmaticScrolls,
    _traces: traces,
    _debugs: debugs,
    _warns: warns,
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

  await t.test('3. applyStreamAnchor 跨会话切换优先遵从 sessionScrollMemory 状态机恢复决策', () => {
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
    assert.ok(manager.getSessionScrollMemory());

    // 1. 新会话默认 pin-to-bottom
    const oldAnchor = {
      sessionId: 'sess-old',
      id: 'msg-1',
      offset: 15,
      rawScrollTop: 300,
    };
    manager.applyStreamAnchor(oldAnchor, false);
    assert.equal(fakeStream.scrollTop, 1500, '新会话切入必须直接置到底部');

    // 2. 目标会话之前记录了 restore-scroll-top 快照
    manager.getSessionScrollMemory().recordSnapshot({
      sessionId: 'sess-current',
      scrollTop: 450,
      scrollHeight: 1500,
      clientHeight: 400,
    });
    manager.applyStreamAnchor(oldAnchor, false);
    assert.equal(fakeStream.scrollTop, 450, '切入已记录回溯位置的会话必须恢复绝对位置');

    // 3. 目标会话之前记录了 restore-anchor 快照
    fakeStream.getBoundingClientRect = () => ({ top: 0, bottom: 400 });
    const targetElement = {
      getBoundingClientRect: () => ({ top: 80, height: 100 }),
    };
    fakeStream.querySelector = (selector) => {
      if (selector.includes('msg-target-42')) return targetElement;
      return null;
    };
    manager.getSessionScrollMemory().recordSnapshot({
      sessionId: 'sess-current',
      scrollTop: 600,
      scrollHeight: 2000,
      clientHeight: 400,
      anchorMessageId: 'msg-target-42',
      anchorOffsetRatio: 0.2, // 期望滚出视口顶部 100 * 0.2 = 20px，即 targetTop 期望为 -20px
    });
    // 当前 targetTop = 80, streamTop = 0, delta = (80 - 0) + 20 = 100. scrollTop 应从 500 增加 100 到 600
    fakeStream.scrollTop = 500;
    manager.applyStreamAnchor(oldAnchor, false);
    assert.equal(fakeStream.scrollTop, 600, '切入已记录锚点行的会话必须按比例恢复视口');

    // 4. 目标会话锚点节点未找到时降级为 fallbackScrollTop
    fakeStream.querySelector = () => null;
    manager.getSessionScrollMemory().recordSnapshot({
      sessionId: 'sess-current',
      scrollTop: 720,
      scrollHeight: 2000,
      clientHeight: 400,
      anchorMessageId: 'msg-missing',
    });
    manager.applyStreamAnchor(oldAnchor, false);
    assert.equal(fakeStream.scrollTop, 720, '锚点节点缺失时安全降级为 fallbackScrollTop');
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
    let cssVarVal = '';
    const rows = [
      { getAttribute: () => 'row-0', getBoundingClientRect: () => ({ top: -90, bottom: -20, height: 70 }) }, // 完全滚出视口
      { getAttribute: () => 'row-1', getBoundingClientRect: () => ({ top: -30, bottom: 25, height: 55 }) }, // 首条仍露出
      { getAttribute: () => 'row-2', getBoundingClientRect: () => ({ top: 40, bottom: 100, height: 60 }) },
    ];
    const fakeStream = {
      scrollTop: 640,
      scrollHeight: 2000,
      clientHeight: 500,
      style: {
        setProperty: (name, val) => {
          cssVarVal = `${name}:${val}`;
        },
      },
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
      querySelectorAll: () => rows,
    };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-42' });
    const manager = new StreamViewportManager(host);

    assert.equal(typeof manager.getMedianEstimator().getMedian, 'function');
    const anchor = manager.captureStreamAnchor();
    assert.equal(anchor.id, 'row-1', '必须跳过 bottom 未越过视口顶的行，取第一条仍可见的行');
    assert.equal(anchor.offset, -30, 'offset 必须是该行顶边相对视口顶边的距离（部分露出时为负）');
    assert.equal(anchor.rawScrollTop, 640);
    assert.equal(anchor.sessionId, 'sess-42');
    assert.equal(cssVarVal, '--conv-intrinsic-median-height:58px', '中位数必须取真实渲染行（55/60）的均值并四舍五入');
  });

  await t.test('22. captureStreamAnchor 全部行都滚出视口时返回空锚点', () => {
    const rows = [
      { getAttribute: () => 'row-0', getBoundingClientRect: () => ({ top: -90, bottom: -20, height: 70 }) },
    ];
    const fakeStream = {
      scrollTop: 900,
      scrollHeight: 2000,
      clientHeight: 500,
      style: { setProperty: () => {} },
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
      querySelectorAll: () => rows,
    };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-7' });
    const manager = new StreamViewportManager(host);

    const anchor = manager.captureStreamAnchor();
    assert.equal(anchor.id, null, '无可见行时必须返回空锚点，而不是错拿一行');
    assert.equal(anchor.rawScrollTop, 900, '空锚点仍须记录当前 scrollTop 供回落');
    assert.equal(manager.getMedianEstimator().sampleCount, 0, '完全滚出视口的行不得进入中位数样本');
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

  await t.test('31. 跨会话切换依据 memory 恢复 restore-anchor（命中/未命中锚点行）', () => {
    const fakeTarget = {
      getBoundingClientRect: () => ({ top: 120, height: 80 }),
    };
    const fakeStream = {
      scrollTop: 200,
      scrollHeight: 2000,
      clientHeight: 500,
      getBoundingClientRect: () => ({ top: 50, bottom: 550 }),
      querySelector: (sel) => (sel.includes('target-msg') ? fakeTarget : null),
    };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-restore' });
    const manager = new StreamViewportManager(host);

    manager.getSessionScrollMemory().recordSnapshot({
      sessionId: 'sess-restore',
      scrollTop: 300,
      scrollHeight: 2000,
      clientHeight: 500,
      anchorMessageId: 'target-msg',
      anchorOffsetRatio: 0.5,
    });

    // delta = (120 - 50) + 80 * 0.5 = 110 → 200 + 110 = 310
    manager.applyStreamAnchor({ sessionId: 'sess-other', id: 'other-msg', offset: 0, rawScrollTop: 0 }, false);
    assert.equal(fakeStream.scrollTop, 310, '必须按 顶边差 + 高度×比例 精确恢复锚点行');

    // 锚点行未挂载：降级回 fallbackScrollTop
    const missingStream = {
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 500,
      getBoundingClientRect: () => ({ top: 50, bottom: 550 }),
      querySelector: () => null,
    };
    const missingHost = createMockViewportHost({ streamElement: missingStream, activeSessionId: 'sess-missing' });
    const missingManager = new StreamViewportManager(missingHost);
    missingManager.getSessionScrollMemory().recordSnapshot({
      sessionId: 'sess-missing',
      scrollTop: 640,
      scrollHeight: 2000,
      clientHeight: 500,
      anchorMessageId: 'gone-msg',
      anchorOffsetRatio: 0.2,
    });
    missingManager.applyStreamAnchor({ sessionId: 'sess-other', id: null, offset: 0, rawScrollTop: 0 }, false);
    assert.equal(missingStream.scrollTop, 640, '锚点行缺失时必须降级为 fallbackScrollTop');
  });

  await t.test('32. 跨会话切换依据 memory 恢复 restore-scroll-top', () => {
    const fakeStream = {
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 500,
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
      querySelector: () => null,
    };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-top' });
    const manager = new StreamViewportManager(host);

    manager.getSessionScrollMemory().recordSnapshot({
      sessionId: 'sess-top',
      scrollTop: 450,
      scrollHeight: 2000,
      clientHeight: 500,
    });

    manager.applyStreamAnchor({ sessionId: 'sess-other', id: null, offset: 0, rawScrollTop: 100 }, false);
    assert.equal(fakeStream.scrollTop, 450, '必须准确恢复为 restore-scroll-top 的标量值');
  });

  await t.test('33. escapeMessageId 三种运行环境都必须产出可直接拼进属性选择器的值', () => {
    const originalCss = globalThis.CSS;
    try {
      // Node 单测环境没有 CSS 全局：回落到手写转义
      globalThis.CSS = undefined;
      assert.equal(escapeMessageId('a"b\\c'), 'a\\"b\\\\c', '引号与反斜杠必须被转义，否则选择器语法非法');
      assert.equal(escapeMessageId('plain-id'), 'plain-id', '普通 id 不得被改写');

      // 旧内核可能只暴露 CSS 却没有 escape：同样回落
      globalThis.CSS = {};
      assert.equal(escapeMessageId('x"y'), 'x\\"y', 'CSS 存在但缺 escape 时必须回落到手写转义');

      // 原生可用时优先原生
      globalThis.CSS = { escape: (value) => `escaped(${value})` };
      assert.equal(escapeMessageId('a b'), 'escaped(a b)', '原生 CSS.escape 存在时必须优先使用');
    } finally {
      globalThis.CSS = originalCss;
    }
  });

  await t.test('34. captureStreamAnchor 锚点行高度为 0 时比例归零且不污染中位数', () => {
    const writes = [];
    const rows = [
      { getAttribute: () => 'row-zero', getBoundingClientRect: () => ({ top: 10, bottom: 10, height: 0 }) },
    ];
    const fakeStream = {
      scrollTop: 640,
      scrollHeight: 2000,
      clientHeight: 500,
      style: { setProperty: (name, value) => writes.push({ name, value }) },
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
      querySelectorAll: () => rows,
    };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-zero' });
    const manager = new StreamViewportManager(host);

    const anchor = manager.captureStreamAnchor();

    assert.equal(anchor.id, 'row-zero', '高度为 0 但 bottom 越过视口顶的行仍然是锚点');
    assert.equal(anchor.offset, 10);
    assert.equal(manager.getMedianEstimator().sampleCount, 0, '高度为 0 的行不得进入中位数样本，否则内禀高度被拉低');
    assert.deepEqual(writes, [], '没有有效样本时不得写入 --conv-intrinsic-median-height');

    const snapshot = manager.getSessionScrollMemory().getSnapshot('sess-zero');
    assert.equal(snapshot?.anchorMessageId, 'row-zero', '锚点行必须原样落进跨会话记忆');
    assert.equal(snapshot?.anchorOffsetRatio, 0, '高度为 0 时必须记录 0 比例，绝不能写出 NaN 或越界值');
  });

  await t.test('35. captureStreamAnchor 元素缺少 style.setProperty 时安全跳过变量注入', () => {
    const rows = [
      { getAttribute: () => 'row-1', getBoundingClientRect: () => ({ top: 20, bottom: 80, height: 60 }) },
    ];
    const fakeStream = {
      scrollTop: 100,
      scrollHeight: 2000,
      clientHeight: 500,
      style: {},
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
      querySelectorAll: () => rows,
    };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-no-style' });
    const manager = new StreamViewportManager(host);

    assert.doesNotThrow(() => manager.captureStreamAnchor(), '宿主元素缺少 setProperty 时不得抛错中断锚点捕获');
    assert.equal(manager.getMedianEstimator().sampleCount, 1, '有效行高仍必须进入样本');
  });

  await t.test('36. captureStreamAnchor 无活跃会话时只返回锚点，不写跨会话记忆', () => {
    const rows = [
      { getAttribute: () => 'row-1', getBoundingClientRect: () => ({ top: 20, bottom: 80, height: 60 }) },
    ];
    const fakeStream = {
      scrollTop: 100,
      scrollHeight: 2000,
      clientHeight: 500,
      style: { setProperty: () => {} },
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
      querySelectorAll: () => rows,
    };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: '' });
    const manager = new StreamViewportManager(host);

    const anchor = manager.captureStreamAnchor();

    assert.equal(anchor.sessionId, '', '未定位会话时锚点会话 id 必须为空串');
    assert.equal(manager.getSessionScrollMemory().size, 0, '无会话 id 时不得写入记忆，否则会污染下一条会话');
  });

  await t.test('37. 跨会话 restore-anchor 在原生 CSS.escape 与 getComputedStyle 可用时按比例恢复', () => {
    const originalCss = globalThis.CSS;
    const originalGcs = globalThis.getComputedStyle;
    globalThis.CSS = { escape: (value) => `escaped(${value})` };
    globalThis.getComputedStyle = () => ({ paddingBottom: '12px' });
    try {
      const target = { getBoundingClientRect: () => ({ top: 120, height: 80 }) };
      let selector = '';
      const fakeStream = {
        scrollTop: 200,
        scrollHeight: 2000,
        clientHeight: 500,
        getBoundingClientRect: () => ({ top: 50, bottom: 550 }),
        querySelector: (sel) => {
          selector = sel;
          return sel.includes('escaped(target-msg)') ? target : null;
        },
      };
      const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-native' });
      const manager = new StreamViewportManager(host);
      manager.getSessionScrollMemory().recordSnapshot({
        sessionId: 'sess-native',
        scrollTop: 300,
        scrollHeight: 2000,
        clientHeight: 500,
        anchorMessageId: 'target-msg',
        anchorOffsetRatio: 0.5,
      });

      manager.applyStreamAnchor({ sessionId: 'sess-other', id: null, offset: 0, rawScrollTop: 0 }, false);

      assert.ok(selector.includes('escaped(target-msg)'), '恢复路径同样必须走原生转义');
      assert.equal(fakeStream.scrollTop, 310, 'delta = (120 - 50) + 80 × 0.5 = 110');
    } finally {
      globalThis.CSS = originalCss;
      globalThis.getComputedStyle = originalGcs;
    }
  });

  await t.test('38. captureStreamAnchor 元素完全没有 style 对象时安全跳过变量注入', () => {
    const rows = [
      { getAttribute: () => 'row-1', getBoundingClientRect: () => ({ top: 20, bottom: 80, height: 60 }) },
    ];
    const fakeStream = {
      scrollTop: 100,
      scrollHeight: 2000,
      clientHeight: 500,
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
      querySelectorAll: () => rows,
    };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-bare' });
    const manager = new StreamViewportManager(host);

    assert.doesNotThrow(() => manager.captureStreamAnchor(), '无 style 对象时不得抛错');
    assert.equal(manager.getMedianEstimator().sampleCount, 1, '行高样本与变量注入是两条独立通路');
  });

  await t.test('39. applyStreamAnchor 锚点与会话都为空时按当前会话回落，且不改写位置', () => {
    const fakeStream = {
      scrollTop: 500,
      scrollHeight: 2000,
      clientHeight: 500,
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
      querySelector: () => null,
    };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-live' });
    const manager = new StreamViewportManager(host);

    manager.applyStreamAnchor({ sessionId: '', id: null, offset: 0, rawScrollTop: 420 }, false);

    assert.equal(fakeStream.scrollTop, 420, '会话 id 缺失时必须按同会话路径回放原始位置');
  });

  await t.test('40. 跨会话恢复在 paddingBottom 为空串时归零并安全贴底', () => {
    const originalGcs = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({ paddingBottom: '' });
    try {
      const fakeStream = {
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 400,
        getBoundingClientRect: () => ({ top: 0, bottom: 400 }),
        querySelector: () => null,
      };
      const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-fresh' });
      const manager = new StreamViewportManager(host);

      manager.applyStreamAnchor({ sessionId: 'sess-old', id: null, offset: 0, rawScrollTop: 0 }, false);

      assert.equal(fakeStream.scrollTop, 1000, '空 paddingBottom 必须回落为 0 而不是 NaN');
    } finally {
      globalThis.getComputedStyle = originalGcs;
    }
  });

  await t.test('41. captureStreamAnchor 把「视口顶切掉的比例」精确写进跨会话记忆', () => {
    const rows = [
      { getAttribute: () => 'row-partial', getBoundingClientRect: () => ({ top: -30, bottom: 25, height: 55 }) },
    ];
    const fakeStream = {
      scrollTop: 700,
      scrollHeight: 2000,
      clientHeight: 500,
      style: { setProperty: () => {} },
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
      querySelectorAll: () => rows,
    };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-partial' });
    const manager = new StreamViewportManager(host);

    manager.captureStreamAnchor();

    const snapshot = manager.getSessionScrollMemory().getSnapshot('sess-partial');
    assert.equal(snapshot?.anchorMessageId, 'row-partial');
    assert.equal(snapshot?.anchorOffsetRatio, 30 / 55, '比例 = 被视口顶切掉的 30px / 行高 55px');
  });

  await t.test('42. captureStreamAnchor 锚点行完全露出时比例夹到 0（不得写出负值）', () => {
    const rows = [
      { getAttribute: () => 'row-below', getBoundingClientRect: () => ({ top: 40, bottom: 100, height: 60 }) },
    ];
    const fakeStream = {
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 500,
      style: { setProperty: () => {} },
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
      querySelectorAll: () => rows,
    };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-below' });
    const manager = new StreamViewportManager(host);

    manager.captureStreamAnchor();

    const snapshot = manager.getSessionScrollMemory().getSnapshot('sess-below');
    assert.equal(snapshot?.anchorOffsetRatio, 0, '行顶边在视口内时比例必须是 0，负比例会让恢复跳到更上方');
    assert.equal(snapshot?.anchorMessageId, 'row-below');
  });

  await t.test('43. captureStreamAnchor 视口下方的离屏行不得进入中位数', () => {
    const writes = [];
    const rows = [
      { getAttribute: () => 'row-visible', getBoundingClientRect: () => ({ top: 40, bottom: 100, height: 60 }) },
      { getAttribute: () => 'row-below', getBoundingClientRect: () => ({ top: 520, bottom: 590, height: 70 }) },
    ];
    const fakeStream = {
      scrollTop: 0,
      scrollHeight: 3000,
      clientHeight: 500,
      style: { setProperty: (name, value) => writes.push(`${name}:${value}`) },
      getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
      querySelectorAll: () => rows,
    };
    const host = createMockViewportHost({ streamElement: fakeStream, activeSessionId: 'sess-below-fold' });
    const manager = new StreamViewportManager(host);

    manager.captureStreamAnchor();

    assert.equal(manager.getMedianEstimator().sampleCount, 1, '视口下方的行拿到的是占位高度，同样不得喂给估算器');
    assert.equal(writes[0], '--conv-intrinsic-median-height:60px', '中位数只能来自视口内的真实渲染行');
  });
});

/**
 * 会话进入计划：跨会话「进去之后视口在哪」的裁决与多帧收敛。
 * 【断言与杀伤力】
 *   1. 无记忆 ⇒ pin-to-bottom；有回溯记忆 ⇒ restore-anchor / restore-scroll-top；
 *   2. probe 未挂载（React 尚未提交）时不得写位置、不得计数收敛；
 *   3. pin 必须等内容高度稳定才收敛，否则会停在途中（实测 1017/4858）；
 *   4. 锚点坐标越出 0.6 屏视为占位高度失真，退回 fallback 并继续迭代；
 *   5. 用户跳转（isPromptJumpSettling）与容器缺失必须立即放弃计划。
 */
test('会话进入计划 beginSessionEnter / settleSessionEnter', async (t) => {
  const makeStream = ({ scrollHeight = 2000, clientHeight = 800, rows = [] } = {}) => {
    let top = 0;
    /** 行几何必须在「被查询到的当下」绑定：用例会在计划推进中途 push 新行（模拟 React 提交）。 */
    const attachGeometry = (row) => {
      row.getBoundingClientRect = () => ({
        top: row.baseTop - top,
        height: row.height,
        bottom: row.baseTop - top + row.height,
      });
      return row;
    };
    const el = {
      scrollHeight,
      clientHeight,
      style: { setProperty() {}, getPropertyValue: () => '' },
      getBoundingClientRect: () => ({ top: 0, bottom: clientHeight }),
      querySelector: (selector) => {
        const row = rows.find((candidate) => selector.includes(`"${candidate.id}"`)) ?? null;
        return row ? attachGeometry(row) : null;
      },
      querySelectorAll: () => rows.map(attachGeometry),
    };
    Object.defineProperty(el, 'scrollTop', {
      get: () => top,
      set: (value) => { top = Math.max(0, Math.min(value, el.scrollHeight - el.clientHeight)); },
    });
    for (const row of rows) {
      attachGeometry(row);
    }
    return { el, rows, getTop: () => top };
  };

  /** 有界推进帧队列：只驱动已排队的帧，避免实现缺陷导致无限 rAF 把测试挂死。 */
  const drainFrames = (queue, limit = 120) => {
    let frames = 0;
    while (queue.length > 0 && frames < limit) {
      queue.shift()();
      frames += 1;
    }
    return frames;
  };

  await t.test('1. 生命周期：无记忆生成 pin-to-bottom，getPending 暴露类型，cancel 清空', () => {
    const stream = makeStream();
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);

    assert.equal(manager.isSessionEnterPending(), false);
    assert.equal(manager.getPendingSessionEnter(), null);

    manager.beginSessionEnter('s1');
    assert.equal(manager.isSessionEnterPending(), true);
    assert.deepEqual(manager.getPendingSessionEnter(), { sessionId: 's1', kind: 'pin-to-bottom' });

    manager.cancelSessionEnter();
    assert.equal(manager.isSessionEnterPending(), false);
    manager.settleSessionEnter();
    assert.equal(stream.getTop(), 0, '取消后推进必须无副作用');
  });

  await t.test('2. 空 sessionId 不建立计划', () => {
    const host = createMockViewportHost({ streamElement: makeStream().el });
    const manager = new StreamViewportManager(host);
    manager.beginSessionEnter('');
    assert.equal(manager.isSessionEnterPending(), false);
  });

  await t.test('3. pin-to-bottom：内容高度稳定后才收敛，且贴到真实底边', () => {
    const stream = makeStream({ scrollHeight: 2000, clientHeight: 800 });
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);

    manager.beginSessionEnter('s1');
    manager.settleSessionEnter('');
    assert.equal(stream.getTop(), 1200, 'pin 必须写到最后可滚动位置');
    assert.equal(manager.isSessionEnterPending(), false, '连续两帧稳定后必须收敛');
  });

  await t.test('4. probe 未挂载时不得写位置，挂载后才落定', () => {
    const stream = makeStream({ rows: [] });
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);
    // 用可手动推进的 rAF 模拟真实异步：同步 rAF 会在一次调用里直接跑满 30 帧熔断，
    // 测不出「React 尚未提交时保持挂起」这一关键行为。
    const queue = [];
    host.requestAnimationFrame = (cb) => { queue.push(cb); return 1; };

    manager.beginSessionEnter('s1');
    manager.settleSessionEnter('m9');
    assert.equal(stream.getTop(), 0, 'React 未提交时禁止在骨架高度上贴底');
    assert.equal(manager.isSessionEnterPending(), true, '未就绪不得收敛');

    stream.rows.push({ id: 'm9', baseTop: 0, height: 40 });
    while (queue.length > 0) {
      const next = queue.shift();
      next();
    }
    assert.equal(stream.getTop(), 1200, 'probe 挂载后再执行计划');
    assert.equal(manager.isSessionEnterPending(), false);
  });

  await t.test('5. restore-anchor：可信域内按行精确恢复', () => {
    const stream = makeStream({ rows: [{ id: 'm1', baseTop: 300, height: 100 }] });
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);

    manager.getSessionScrollMemory().recordSnapshot({
      sessionId: 's1', scrollTop: 300, scrollHeight: 2000, clientHeight: 800,
      anchorMessageId: 'm1', anchorOffsetRatio: 0,
    });
    manager.beginSessionEnter('s1');
    assert.equal(manager.getPendingSessionEnter().kind, 'restore-anchor');

    manager.settleSessionEnter('');
    assert.equal(stream.getTop(), 300, '锚点行必须回到视口首行');
    assert.equal(manager.isSessionEnterPending(), false);
  });

  await t.test('6. restore-anchor：占位高度导致超大 delta 时退回 fallback 并继续迭代', () => {
    const stream = makeStream({ rows: [{ id: 'm1', baseTop: 1900, height: 100 }] });
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);

    manager.getSessionScrollMemory().recordSnapshot({
      sessionId: 's1', scrollTop: 300, scrollHeight: 2000, clientHeight: 800,
      anchorMessageId: 'm1', anchorOffsetRatio: 0,
    });
    manager.beginSessionEnter('s1');
    manager.settleSessionEnter('');

    assert.equal(stream.getTop(), 300, '失真时必须退回记忆里的标量基准');
    assert.equal(manager.isSessionEnterPending(), false, '30 帧熔断后必须收口');
  });

  await t.test('7. restore-anchor：锚点行已不在当前序列时走 fallback', () => {
    const stream = makeStream({ rows: [] });
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);

    manager.getSessionScrollMemory().recordSnapshot({
      sessionId: 's1', scrollTop: 320, scrollHeight: 2000, clientHeight: 800,
      anchorMessageId: 'gone', anchorOffsetRatio: 0.5,
    });
    manager.beginSessionEnter('s1');
    manager.settleSessionEnter('');
    assert.equal(stream.getTop(), 320);
    assert.equal(manager.isSessionEnterPending(), false);
  });

  await t.test('8. restore-scroll-top：写回时按可滚动上界夹取', () => {
    const stream = makeStream({ scrollHeight: 1000, clientHeight: 800 });
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);

    // 快照记录时容器更高（distance=900，非贴底）；之后容器变矮，写回必须夹到新的上界。
    manager.getSessionScrollMemory().recordSnapshot({
      sessionId: 's1', scrollTop: 300, scrollHeight: 2000, clientHeight: 800,
    });
    manager.beginSessionEnter('s1');
    assert.equal(manager.getPendingSessionEnter().kind, 'restore-scroll-top');
    manager.settleSessionEnter('');
    assert.equal(stream.getTop(), 200, '超出可滚动上界必须夹到 maxScrollTop');
  });

  await t.test('9. 提示词跳转或容器缺失时立即放弃计划', () => {
    const jumpStream = makeStream();
    const jumpHost = createMockViewportHost({ streamElement: jumpStream.el, activeSessionId: 's1' });
    const jumpManager = new StreamViewportManager(jumpHost);
    jumpManager.beginSessionEnter('s1');
    jumpHost._setPromptJumpSettling(true);
    jumpManager.settleSessionEnter('');
    assert.equal(jumpManager.isSessionEnterPending(), false, '导航跳转必须夺取控制权');
    assert.equal(jumpStream.getTop(), 0, '夺取后不得再写位置');

    const missingHost = createMockViewportHost({ streamElement: null, activeSessionId: 's1' });
    const missingManager = new StreamViewportManager(missingHost);
    missingManager.beginSessionEnter('s1');
    missingManager.settleSessionEnter('');
    assert.equal(missingManager.isSessionEnterPending(), false, '容器缺失必须收口而不是无限 rAF');
  });

  await t.test('10. forcePinToBottom 覆盖回溯记忆', () => {
    const stream = makeStream({ rows: [{ id: 'm1', baseTop: 300, height: 100 }] });
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);

    manager.getSessionScrollMemory().recordSnapshot({
      sessionId: 's1', scrollTop: 300, scrollHeight: 2000, clientHeight: 800,
      anchorMessageId: 'm1', anchorOffsetRatio: 0,
    });
    manager.beginSessionEnter('s1', { forcePinToBottom: true });
    assert.equal(manager.getPendingSessionEnter().kind, 'pin-to-bottom');
    manager.settleSessionEnter('');
    assert.equal(stream.getTop(), 1200, '新建会话必须强制贴底');
  });

  await t.test('11. 旧票据的迟到帧不得写位置', () => {
    const stream = makeStream();
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);
    const queue = [];
    host.requestAnimationFrame = (cb) => { queue.push(cb); return 1; };

    manager.beginSessionEnter('s1');
    manager.settleSessionEnter('');
    const staleFrame = queue.shift();
    const before = stream.getTop();

    manager.beginSessionEnter('s2');
    staleFrame();
    assert.equal(stream.getTop(), before, '迟到帧必须比对 ticket 后静默退出');
    assert.equal(manager.isSessionEnterPending(), true, '新票据的计划仍在挂起');
  });

  await t.test('12. getComputedStyle 可用时读取 paddingBottom 作为安全线', () => {
    const saved = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({ paddingBottom: '24px' });
    try {
      const stream = makeStream({ scrollHeight: 2000, clientHeight: 800 });
      const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
      const manager = new StreamViewportManager(host);

      manager.beginSessionEnter('s1');
      manager.settleSessionEnter('');
      assert.equal(manager.isSessionEnterPending(), false, '有样式环境时同样必须收敛');
      assert.equal(stream.getTop(), 1200);
    } finally {
      if (saved === undefined) delete globalThis.getComputedStyle;
      else globalThis.getComputedStyle = saved;
    }
  });

  await t.test('13. paddingBottom 为 0 时安全线回落为 0', () => {
    const saved = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({ paddingBottom: '0px' });
    try {
      const stream = makeStream({ scrollHeight: 2000, clientHeight: 800 });
      const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
      const manager = new StreamViewportManager(host);

      manager.beginSessionEnter('s1');
      manager.settleSessionEnter('');
      assert.equal(stream.getTop(), 1200, 'padding 为 0 时贴底位置不变');
    } finally {
      if (saved === undefined) delete globalThis.getComputedStyle;
      else globalThis.getComputedStyle = saved;
    }
  });

  await t.test('14. isNearBottom 纳入输入舱安全线', () => {
    const saved = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({ paddingBottom: '120px' });
    try {
      const host = createMockViewportHost();
      const manager = new StreamViewportManager(host);
      // 安全线 120 → 阈值 128：几何距离 100 仍算视觉贴底，300 才算离开。
      assert.equal(manager.isNearBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 }), true);
      assert.equal(manager.isNearBottom({ scrollHeight: 1000, scrollTop: 300, clientHeight: 400 }), false);
      // 安全线为 0 时回落到 48px 常量阈值（覆盖 `|| 0` 的兜底分支）。
      globalThis.getComputedStyle = () => ({ paddingBottom: '0px' });
      assert.equal(manager.isNearBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 }), true);
      assert.equal(manager.isNearBottom(null), false, '空容器必须判为非贴底');
    } finally {
      if (saved === undefined) delete globalThis.getComputedStyle;
      else globalThis.getComputedStyle = saved;
    }
  });

  await t.test('15. TDD红灯守卫: Blink阶梯展开下末行未对齐安全底线严禁提前退出(防Early Exit)', () => {
    const saved = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({ paddingBottom: '160px' });
    try {
      // 模拟长对话：客户端高 800px，输入舱安全区 160px，期望安全底线为 800 - 160 = 640px
      // 末行消息 mLast 位于真实高度 4800px 处，高 200px
      const mLast = { id: 'mLast', baseTop: 4800, height: 200 };
      const stream = makeStream({ scrollHeight: 2000, clientHeight: 800, rows: [mLast] });
      const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
      const manager = new StreamViewportManager(host);
      const queue = [];
      host.requestAnimationFrame = (cb) => { queue.push(cb); return 1; };

      manager.beginSessionEnter('s1');
      // 首次以末行探针推进
      manager.settleSessionEnter('mLast', 's1', 'ready', 50);

      // 第 1 帧执行：此时 scrollHeight 是伪高度 2000，虽然 scrollTop 暂时跳到了 1200，但 mLast.bottom 远在视口下方深处
      if (queue.length > 0) queue.shift()();
      assert.equal(manager.isSessionEnterPending(), true, '第1帧末行未贴合安全底线，严禁收敛');

      // 模拟 Blink 第 2 帧：异步排版稍作延迟，scrollHeight 此时未变（差值为 0）
      // 旧代码会因 heightStable=true 而在第 2 帧错误销毁任务；新方案必须断言其保持存活！
      if (queue.length > 0) queue.shift()();
      assert.equal(manager.isSessionEnterPending(), true, '第2帧高度虽暂稳但末行未贴底，绝对严禁Early Exit');

      // 模拟 Blink 后续帧展开全部高度至 5160px (5000px 内容 + 160px paddingBottom)
      stream.el.scrollHeight = 5160;
      while (queue.length > 0) {
        queue.shift()();
      }

      // 全部收敛后，末行底边 4800 - scrollTop + 200 应严格对齐安全底线 640px，即 scrollTop === 4360
      assert.equal(stream.getTop(), 4360, '最终末行必须精准对齐输入舱上方安全底线(5000-800+160=4360)');
      assert.equal(manager.isSessionEnterPending(), false, '末行对齐安全底线后方可收敛');
    } finally {
      if (saved === undefined) delete globalThis.getComputedStyle;
      else globalThis.getComputedStyle = saved;
    }
  });

  await t.test('16. 权威消息数>0 但 DOM 尚未提交时严禁走短会话短路', () => {
    // 【实测缺陷复现（根因 1）】
    //   推进帧跑在 React 提交之前时读到空容器：scrollHeight == clientHeight == 762、rows == 0。
    //   旧实现用「DOM 高度 scrollHeight <= clientHeight」判定「不足一屏短会话」，
    //   于是写 scrollTop = 0、setInitialBottomSettling(false)、settledLayoutSignature = 当前签名、
    //   pendingSessionEnter = null —— 计划永久死亡；20ms 后 React 提交 50 行，此后无任何贴底动作。
    // 【本用例的裁决语义】权威消息数 50 说明内容一定存在，DOM 空只是「尚未提交」，
    //   绝不是「内容不足一屏」，计划必须存活到真实行挂载为止。
    const stream = makeStream({ scrollHeight: 762, clientHeight: 762, rows: [] });
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);
    const queue = [];
    host.requestAnimationFrame = (cb) => { queue.push(cb); return 1; };

    manager.beginSessionEnter('s1');
    manager.settleSessionEnter('m-last', 's1', 'ready', 50);

    assert.equal(manager.isSessionEnterPending(), true, '权威消息数 50 时计划必须存活，严禁按空 DOM 高度短路');
    assert.equal(manager.getSettledLayoutSignature(), '', '不得把空容器高度当成「已落定」写死');

    // React 提交 50 行：末行出现、内容撑高到 4000（远超一屏 762）
    stream.rows.push({ id: 'm-last', baseTop: 3900, height: 100 });
    stream.el.scrollHeight = 4000;

    manager.settleSessionEnter('m-last', 's1', 'ready', 50);
    let frames = 0;
    while (queue.length > 0 && frames < 120) { queue.shift()(); frames += 1; }

    const maxScrollTop = stream.el.scrollHeight - stream.el.clientHeight; // 4000 - 762 = 3238
    assert.equal(stream.getTop(), maxScrollTop, '提交后必须落到 scrollHeight - clientHeight = 3238（视口高恒为 762，不是 makeStream 默认的 800）');
    assert.equal(manager.isSessionEnterPending(), false, '真正落底后计划才允许收敛');
  });

  await t.test('17. TDD红灯守卫: 生命周期相位协同(loading冻结挂起 vs ready空会话优雅退出)', () => {
    const stream = makeStream();
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);
    const queue = [];
    host.requestAnimationFrame = (cb) => { queue.push(cb); return 1; };

    manager.beginSessionEnter('s1');

    // 场景 A：网络仍在 loading 且消息数 0，调用 settle 必须冻结挂起，不得触发 rAF 调度消耗 30 帧
    manager.settleSessionEnter('', 's1', 'loading', 0);
    assert.equal(manager.isSessionEnterPending(), true, '数据加载中必须保持挂起');
    assert.equal(queue.length, 0, '加载中严禁调度 rAF 消耗熔断配额');

    // 场景 B：确定已 ready 且真实 0 消息，调用 settle 必须立即收敛释放
    manager.settleSessionEnter('', 's1', 'ready', 0);
    assert.equal(manager.isSessionEnterPending(), false, '真实空会话就绪后必须优雅退出解除挂起');
  });

  await t.test('18. TDD红灯守卫: 跨会话防污染(SessionId校验)', () => {
    const stream = makeStream();
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's2' });
    const queue = [];
    host.requestAnimationFrame = (cb) => { queue.push(cb); return 1; };
    const manager = new StreamViewportManager(host);

    manager.beginSessionEnter('s2');
    assert.equal(manager.getPendingSessionEnter().sessionId, 's2');

    // 来自 s1 的延迟回调试图注入探针与调度推进
    manager.settleSessionEnter('probe-from-s1', 's1', 'ready', 10);

    // 【杀伤力断言】
    // 1. 跨会话非法调用必须被第一道防线丢弃，绝对不得调度任何 rAF 推进帧
    assert.equal(queue.length, 0, '跨会话非法调用不得调度 rAF 推进帧');
    // 2. 挂起状态对象上的探针 id 绝不得被改写为来自旧会话的 probe-from-s1
    assert.notEqual(manager.pendingSessionEnter?.probeMessageId, 'probe-from-s1', '跨会话迟到调用绝不得污染当前挂起探针');
  });

  await t.test('19. 真正的空会话（messagesCount=0 且 ready）仍必须首帧短路退出', () => {
    // 【防护性对照】修复「空 DOM 不得短路」时严禁把短会话短路一并删掉：
    //   权威消息数就是 0 且相位已 ready，说明会话确实为空，必须立即收敛、不得空转 rAF。
    const stream = makeStream({ scrollHeight: 762, clientHeight: 762, rows: [] });
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);
    const queue = [];
    host.requestAnimationFrame = (cb) => { queue.push(cb); return 1; };

    manager.beginSessionEnter('s1');
    manager.settleSessionEnter('', 's1', 'ready', 0);

    assert.equal(manager.isSessionEnterPending(), false, '真实空会话必须首帧立即收敛释放');
    assert.equal(stream.getTop(), 0, '空会话必须夹紧在顶部 0');
    assert.equal(queue.length, 0, '空会话不得调度后续多余帧');
  });

  await t.test('20. 探针行在 DOM 中缺失时必须降级贴底并留痕（禁止静默 no-op）', () => {
    // 【实测缺陷复现（根因 3 + 根因 4）】
    //   末条 displayKind === 'hidden' 时，buildConversationSnapshot 会跳过它，
    //   DOM 里没有对应 [data-msg-id]，于是 lastRow === null。
    //   旧实现的熔断分支判据 `else if (lastRow || !pending.probeMessageId)`：
    //   lastRow 为 null 且 probe 非空 → 恒假 → 不写位置、不打任何日志，
    //   却照样把 settledLayoutSignature 写成「已落定」，随后计划释放。
    // 【裁决语义】容器已有真实内容高度（scrollHeight > clientHeight）但探针行缺失时，
    //   唯一安全的降级是「贴到可滚动底部」，并且必须留下可观测痕迹。
    const stream = makeStream({ scrollHeight: 3000, clientHeight: 800, rows: [] });
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);
    const queue = [];
    host.requestAnimationFrame = (cb) => { queue.push(cb); return 1; };

    manager.beginSessionEnter('s1');
    manager.settleSessionEnter('m-hidden', 's1', 'ready', 50);
    // 熔断上限 30 帧，给足余量
    drainFrames(queue, 60);

    assert.equal(stream.getTop(), 2200, '探针行缺失时必须降级写 scrollTop = scrollHeight - clientHeight = 2200');
    const logCalls = host._traces.length + host._debugs.length + host._warns.length;
    assert.ok(logCalls > 0, '降级路径必须留痕（logTrace/logDebug/logWarn 至少一条），禁止静默 no-op');
    // 只禁止「静默写死已落定」这一组合：若实现把签名写成已落定，则必须真的贴到底。
    // （不做「签名必须不等于某值」的裸不等式，否则会把「合法降级后标记落定」也判红。）
    if (typeof manager.getSettledLayoutSignature === 'function' && manager.getSettledLayoutSignature() !== '') {
      assert.equal(stream.getTop(), 2200, '写下已落定签名时必须真的贴到底，禁止把 no-op 记成已对齐');
    }
  });

  await t.test('21. 占位高度逐帧展开时严禁按 errorPx<=2 提前收敛', () => {
    // 【实测缺陷复现（根因 2）】
    //   进入期 capture:false 使 content-visibility 的 contain-intrinsic-size 恒为兜底占位高度，
    //   末行 rect 只是占位坐标。当占位坐标恰好让 |row.bottom - safeBottom| <= 2 时，
    //   旧实现把「占位对齐」当成真对齐，连续 2 帧稳定即收敛；
    //   随后 Blink 逐帧展开真实高度（2000 → 2400 → 3200 → 4000），末行被顶到输入舱下方。
    const row = { id: 'm-last', baseTop: 700, height: 100 };
    const stream = makeStream({ scrollHeight: 2000, clientHeight: 800, rows: [row] });
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);
    const queue = [];
    host.requestAnimationFrame = (cb) => { queue.push(cb); return 1; };

    manager.beginSessionEnter('s1');
    manager.settleSessionEnter('m-last', 's1', 'ready', 50);

    // 第 1 帧：占位几何恰好贴合安全底线（row.bottom = 700 + 100 = 800 = safeBottom），误差 0
    const step = (queue) => { if (queue.length > 0) { queue.shift()(); return true; } return false; };
    assert.equal(step(queue), true, '首帧必须被调度（否则计划根本没在推进）');

    // 第 2 帧：内容开始逐帧展开，占位 rect 尚未更新
    stream.el.scrollHeight = 2400;
    step(queue);
    assert.equal(manager.isSessionEnterPending(), true, 'scrollHeight 仍在变化时严禁收敛（errorPx<=2 只是占位假象）');

    // 第 3 帧：继续展开
    stream.el.scrollHeight = 3200;
    step(queue);
    assert.equal(manager.isSessionEnterPending(), true, '第 3 个不同高度帧仍不得收敛，必须等高度连续 3 帧稳定');

    // 真实布局落定：末行真实位置 3900..4000，总高 4000，安全底线 800
    stream.el.scrollHeight = 4000;
    row.baseTop = 3900;
    drainFrames(queue);

    assert.equal(stream.getTop(), 3200, '最终必须停在 scrollTop === scrollHeight - clientHeight = 3200');
    const rowRect = stream.rows[0].getBoundingClientRect();
    assert.ok(
      Math.abs(rowRect.bottom - 800) <= 2,
      `末行底边必须贴合输入舱上方安全线 800（容差 2px），实测 ${rowRect.bottom}`
    );
    assert.equal(manager.isSessionEnterPending(), false, '高度连续稳定后计划才允许收敛');
  });

  await t.test('22. 缓存批次对齐后不得收敛：REST 最新页到达前计划必须存活', () => {
    // 【实测缺陷复现（根因 5）】
    //   旧实现的 loading 冻结只在 messagesCount === 0 生效。缓存批次（20 条、末条是用户提问、
    //   DOM 已可对齐）被当成终态收敛；REST 最新页到达（20 → 50）时计划早已释放，
    //   最新 agent 回复永远停在输入舱下方。
    const stream = makeStream({ scrollHeight: 2000, clientHeight: 800, rows: [{ id: 'm-user-20', baseTop: 1900, height: 100 }] });
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);
    const queue = [];
    host.requestAnimationFrame = (cb) => { queue.push(cb); return 1; };

    manager.beginSessionEnter('s1');

    // 场景 A：网络仍在 loading，缓存批次已对齐 —— 必须冻结挂起而不是收敛
    manager.settleSessionEnter('m-user-20', 's1', 'loading', 20);
    drainFrames(queue);
    assert.equal(manager.isSessionEnterPending(), true, 'loading 相位下即使缓存批次已对齐也不得收敛');

    /**
     * 【假绿铲除 (P0-4)】原「场景 B」声称测「缓存批次不收敛」，但它继承了场景 A 的 loading 冻结
     * （`lastSeenScrollHeight` 已被 loading 分支污染成 2000），所以看起来存活。
     * probe27 实测：纯 ready 起步时 6 帧就收敛，该场景对根因零杀伤力。
     * 「纯 ready 起步」已拆成独立用例 26（不继承任何 loading 状态），此处不得再保留靠副作用才绿的场景。
     */

    // 场景 C：REST 最新页到达（20 → 50），末条换成 agent 回复，内容撑高
    stream.rows.length = 0;
    stream.rows.push({ id: 'm-agent-50', baseTop: 4900, height: 100 });
    stream.el.scrollHeight = 5000;
    manager.settleSessionEnter('m-agent-50', 's1', 'ready', 50);
    drainFrames(queue);

    assert.equal(stream.getTop(), 4200, '最新页到达后必须落到 scrollHeight - clientHeight = 4200');
    assert.equal(manager.isSessionEnterPending(), false, '最新页真正落底后计划才允许收敛');
  });

  await t.test('23. reassertActivePin 幂等入口：armed 时重新对齐，取消后不得写入', () => {
    // 【契约】React 提交后的贴底驱动入口：无参、幂等、可重复调用；
    //   armed（计划存活）期间调用必须重新对齐一次；用户手势 cancelSessionEnter() 之后不得写入任何 scrollTop。
    const row = { id: 'm-last', baseTop: 3800, height: 100 };
    const stream = makeStream({ scrollHeight: 4000, clientHeight: 800, rows: [row] });
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);
    const queue = [];
    host.requestAnimationFrame = (cb) => { queue.push(cb); return 1; };

    assert.equal(typeof manager.reassertActivePin, 'function', '必须暴露无参幂等入口 reassertActivePin()');

    manager.beginSessionEnter('s1');
    manager.settleSessionEnter('m-last', 's1', 'ready', 50);
    if (queue.length > 0) queue.shift()();
    assert.equal(manager.isSessionEnterPending(), true, '先只推进一帧，计划必须仍在途');

    // React 提交后内容再次长高：末行真实位置下移、总高变化
    row.baseTop = 4500;
    stream.el.scrollHeight = 4600;
    manager.reassertActivePin();
    assert.equal(stream.getTop(), 3800, 'armed 期间调用必须重新对齐到 scrollHeight - clientHeight = 3800');

    // 幂等：无漂移重复调用不得改变位置，也不得抛错
    const topBeforeRepeat = stream.getTop();
    assert.doesNotThrow(() => manager.reassertActivePin(), 'reassertActivePin 必须可重复调用');
    assert.equal(stream.getTop(), topBeforeRepeat, '无漂移时重复调用必须幂等');

    // 用户手势取消后：不得再写任何 scrollTop
    manager.cancelSessionEnter();
    stream.el.scrollTop = 1000;
    manager.reassertActivePin();
    assert.equal(stream.el.scrollTop, 1000, '用户手势取消后 reassertActivePin 不得写入 scrollTop');
  });

  await t.test('24. reassertActivePin 重复调用不得并行出多条推进帧（armedFrames 每帧最多递增一次）', () => {
    // 【实测缺陷复现（P1-2）】
    //   runSessionEnterFrame 未收敛时会自己排下一帧；而 renderCoordinator 的 MutationObserver
    //   每帧都会调用 reassertActivePin()。旧实现让每次 reassert 同步推进并各自再排一条 rAF 链，
    //   于是同一 ticket 上并行出 N 条链，armedFrames 每帧递增 N 次，
    //   600 帧硬上限被 N 倍速提前耗尽 → 内容真正稳定前就被兜底截断。
    // 【裁决语义】同一 ticket 任意时刻最多一条在途推进帧。
    const row = { id: 'm-last', baseTop: 4500, height: 100 };
    // 末行永远贴不上安全线（4500 - 3200 + 100 = 1400 > safeBottom 800），计划全程保持 armed。
    const stream = makeStream({ scrollHeight: 4000, clientHeight: 800, rows: [row] });
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);
    const queue = [];
    host.requestAnimationFrame = (cb) => { queue.push(cb); return 1; };

    manager.beginSessionEnter('s1');
    manager.settleSessionEnter('m-last', 's1', 'ready', 50);
    assert.equal(manager.isSessionEnterPending(), true, '末行始终不贴安全线，计划必须保持 armed');
    assert.equal(queue.length, 1, '同步推进后只允许一条在途帧');

    for (let i = 0; i < 5; i += 1) manager.reassertActivePin();
    assert.equal(
      queue.length,
      1,
      'reassertActivePin 重复调用绝不可并行出多条推进帧（旧实现会累加成 5 条以上）'
    );

    queue.shift()();
    for (let i = 0; i < 3; i += 1) manager.reassertActivePin();
    assert.equal(queue.length, 1, '推进一帧后重入 reassertActivePin 同样只允许一条在途帧');
  });

  await t.test('25. cancelSessionEnter 后重入 reassertActivePin 不得重新起帧', () => {
    // 【契约】用户手势取消后，在途帧必须静默作废，reassertActivePin 必须保持纯 no-op。
    const row = { id: 'm-last', baseTop: 4500, height: 100 };
    const stream = makeStream({ scrollHeight: 4000, clientHeight: 800, rows: [row] });
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);
    const queue = [];
    host.requestAnimationFrame = (cb) => { queue.push(cb); return 1; };

    manager.beginSessionEnter('s1');
    manager.settleSessionEnter('m-last', 's1', 'ready', 50);
    assert.equal(queue.length, 1, '取消前必须存在一条在途帧');

    manager.cancelSessionEnter();
    drainFrames(queue, 10);
    assert.equal(queue.length, 0, '取消后在途帧必须静默作废，不得再排下一帧');

    for (let i = 0; i < 3; i += 1) manager.reassertActivePin();
    assert.equal(queue.length, 0, '取消后重入 reassertActivePin 不得重新起帧');
  });

  /**
   * 【实测缺陷复现（P0-1 / P0-4）】
   *   真实链路 `messageLoadingService.loadMessages` 命中内存缓存时直接把 `messagesPhase` 置为 `'ready'`，
   *   而 REST 最新页仍在路上。于是进入计划看到的是「纯 ready」：缓存批次（20 条）高度 2000→2100→2200
   *   稳定 3 帧后，`converged` 全部条件成立 → 第 6 帧 `pending=false`（probe27 实测）。
   *   随后 REST 到达（20 → 50、scrollHeight=5000）时计划已死，视口停在 1400 而非 4200。
   * 【裁决语义】`'ready'` 不再等于「权威页已到」：宿主必须显式声明权威完成信号；
   *   未拿到信号时只保持 armed（对齐 + 冻结），绝不写已落定签名。
   */
  await t.test('26. 缓存批次在纯 ready 相位下对齐后不得收敛（REST 权威页未到）', () => {
    const stream = makeStream({ scrollHeight: 2000, clientHeight: 800, rows: [{ id: 'm-user-20', baseTop: 1900, height: 100 }] });
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);
    const queue = [];
    host.requestAnimationFrame = (cb) => { queue.push(cb); return 1; };

    manager.beginSessionEnter('s1');
    // 缓存批次：宿主明确声明「权威页尚未到达」，全程不出现 'loading'
    manager.settleSessionEnter('m-user-20', 's1', 'ready', 20, false);

    // Blink 逐帧展开缓存批次的真实高度：2000 → 2100 → 2200 后稳定
    for (const height of [2000, 2100, 2200, 2200, 2200]) {
      stream.el.scrollHeight = height;
      drainFrames(queue, 60);
    }

    assert.equal(
      manager.isSessionEnterPending(),
      true,
      '缓存批次对齐后不得收敛：REST 权威页尚未到达（当前实现第 6 帧就会 false）'
    );
    assert.equal(manager.getSettledLayoutSignature(), '', '权威页未到前不得把缓存批次登记成「已落定」');

    // REST 最新页到达：20 → 50，末行换成 agent 回复，内容撑高到 5000
    stream.rows.length = 0;
    stream.rows.push({ id: 'm-agent-50', baseTop: 4900, height: 100 });
    stream.el.scrollHeight = 5000;
    manager.settleSessionEnter('m-agent-50', 's1', 'ready', 50, true);
    drainFrames(queue, 120);

    assert.equal(stream.getTop(), 4200, '权威页到达后必须落到 scrollHeight - clientHeight = 4200');
    assert.equal(manager.isSessionEnterPending(), false, '权威页真正落底后计划才允许收敛');
  });

  /**
   * 【实测缺陷复现（P0-2）】
   *   `trackPinStability` 的 loading 分支把 `lastSeenScrollHeight` 设成当前高度，
   *   切 ready 后高度没变 → `armedHeightChangedSinceArm` 永假 → 只能等 600 帧硬上限（约 10 秒）。
   *   期间 `decideViewportPin` 全程 `capture:false`，流式输出完全不跟随。
   * 【裁决语义】loading 期间只清稳定计数、不污染基线；相位切换到 ready 时重置基线，
   *   使「ready 之后的第一帧高度」就是可信的对比起点。
   */
  await t.test('27. loading 转 ready 且高度不变时必须在 10 帧内收敛（不得退化成 600 帧硬上限）', () => {
    const stream = makeStream({ scrollHeight: 2000, clientHeight: 800, rows: [{ id: 'm-last', baseTop: 1900, height: 100 }] });
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);
    const queue = [];
    host.requestAnimationFrame = (cb) => { queue.push(cb); return 1; };

    manager.beginSessionEnter('s1');
    // loading 期间高度恒为 2000：基线不得被这次「缓存批次高度」污染
    manager.settleSessionEnter('m-last', 's1', 'loading', 20);
    drainFrames(queue, 5);
    assert.equal(manager.isSessionEnterPending(), true, 'loading 相位下不得收敛');

    // 权威页到达：相位切 ready，高度没有变化（仍是 2000），末行已对齐安全底线
    manager.settleSessionEnter('m-last', 's1', 'ready', 20);
    drainFrames(queue, 10);

    assert.equal(
      manager.isSessionEnterPending(),
      false,
      'loading→ready 且高度不变时必须在 10 帧内收敛（当前实现恒假高度变化，只能等 600 帧）'
    );
    assert.equal(stream.getTop(), 1200, 'pin 必须写到最后可滚动位置 2000 - 800 = 1200');
  });

  /**
   * 【实测缺陷复现（P0-3）】
   *   restore-anchor 分支在锚点行尚未提交（`querySelector` 返回 null）时直接写 fallback 并把
   *   `errorPx` 判为 0；两帧后 `finishPinPlan()` 把「未恢复」登记成「已落定」。
   *   React 随后提交锚点行时计划已死，回溯恢复彻底丢失。
   * 【裁决语义】锚点行未提交 = 计划尚未就绪：只保持 armed，绝不写 fallback、绝不写已落定签名；
   *   由提交后驱动（reassertActivePin / 后续 settle）继续推进。
   */
  await t.test('28. restore-anchor 锚点行未提交时不得写 fallback 也不得写已落定签名', () => {
    const stream = makeStream({ scrollHeight: 2000, clientHeight: 800, rows: [] });
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);
    const queue = [];
    host.requestAnimationFrame = (cb) => { queue.push(cb); return 1; };

    manager.getSessionScrollMemory().recordSnapshot({
      sessionId: 's1', scrollTop: 300, scrollHeight: 2000, clientHeight: 800,
      anchorMessageId: 'm-anchor', anchorOffsetRatio: 0,
    });
    manager.beginSessionEnter('s1');
    assert.equal(manager.getPendingSessionEnter().kind, 'restore-anchor');

    // DOM 里没有 m-anchor：React 尚未提交目标会话的消息行
    manager.settleSessionEnter('m-anchor', 's1', 'ready', 40);
    drainFrames(queue, 10);

    assert.equal(manager.isSessionEnterPending(), true, '锚点行未提交时必须保持 armed（当前实现两帧后就 false）');
    assert.equal(stream.getTop(), 0, '锚点行未提交时绝不写 fallback 300');
    assert.equal(manager.getSettledLayoutSignature(), '', '锚点行未提交时绝不写已落定签名');

    // React 提交锚点行：位置在 450（delta = 450 - 0 + 0 = 450，仍在 0.6 屏可信域 480 内）
    stream.rows.push({ id: 'm-anchor', baseTop: 450, height: 100 });
    manager.settleSessionEnter('m-anchor', 's1', 'ready', 40);
    drainFrames(queue, 60);

    assert.equal(stream.getTop(), 450, '锚点行提交后必须按行精确恢复，而不是停在 fallback');
    assert.equal(manager.isSessionEnterPending(), false, '真正对齐后计划才允许收敛');
  });

  /**
   * 【有界兜底对照】锚点行在整个熔断窗口内都不出现（例如已被 session.undo 截断）：
   *   计划不得永久 armed（会冻结滚动记忆），必须在熔断帧数内按标量基准有界降级并收口。
   * 【杀伤力】把 `!target` 分支写成纯 return 会让 `isSessionEnterPending()` 永远为 true，本用例必红。
   */
  await t.test('29. restore-anchor 锚点行始终不提交时必须在熔断帧内按 fallback 有界收口', () => {
    const stream = makeStream({ scrollHeight: 2000, clientHeight: 800, rows: [] });
    const host = createMockViewportHost({ streamElement: stream.el, activeSessionId: 's1' });
    const manager = new StreamViewportManager(host);
    const queue = [];
    host.requestAnimationFrame = (cb) => { queue.push(cb); return 1; };

    manager.getSessionScrollMemory().recordSnapshot({
      sessionId: 's1', scrollTop: 320, scrollHeight: 2000, clientHeight: 800,
      anchorMessageId: 'gone', anchorOffsetRatio: 0.5,
    });
    manager.beginSessionEnter('s1');
    manager.settleSessionEnter('gone', 's1', 'ready', 40);
    drainFrames(queue, 80);

    assert.equal(stream.getTop(), 320, '熔断后必须按记忆里的标量基准有界降级，而不是永久 armed');
    assert.equal(manager.isSessionEnterPending(), false, '熔断后必须收口，否则滚动记忆被永久冻结');
  });
});
