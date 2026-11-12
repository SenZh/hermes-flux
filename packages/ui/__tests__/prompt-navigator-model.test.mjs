/**
 * 提示词导航轨纯逻辑单测（覆盖设计文档 TC-001 ~ TC-016、TC-020、TC-024、TC-025）。
 *
 * 断言口径：
 *   1. 每条用例都断言可被证伪的具体数值或字符串，禁止 `assert.ok(x)` 这种恒真断言；
 *   2. 边界用例必须同时给出「合法输入」与「越界输入」两侧证据。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROMPT_PREVIEW_MAX_CHARS,
  RAIL_VISIBLE_TICKS,
  RAIL_TICK_PITCH_PX,
  TOP_LOAD_COOLDOWN_MS,
  normalizePromptPreview,
  buildPromptEntries,
  resolveActivePromptIndex,
  planTickWindow,
  planPromptPrependView,
  shouldTriggerLoadOlderAtTop,
  decidePanelWheelAction,
  decideGutterKeyAction,
  decideHotzonePointerAction,
  tickWidth,
} from '../dist/lib/promptNavigator.js';

test('Prompt navigator model - 常量契约', () => {
  assert.equal(PROMPT_PREVIEW_MAX_CHARS, 160);
  assert.equal(RAIL_VISIBLE_TICKS, 30);
  assert.equal(RAIL_TICK_PITCH_PX, 12);
});

test('TC-001 三条用户 + 两条助手，只产出三条 prompt', () => {
  const messages = [
    { id: 'u1', role: 'user', content: '第一问' },
    { id: 'a1', role: 'assistant', content: '答复一' },
    { id: 'u2', role: 'user', content: '第二问' },
    { id: 'a2', role: 'assistant', content: '答复二' },
    { id: 'u3', role: 'user', content: '第三问' },
  ];
  const entries = buildPromptEntries(messages);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((entry) => entry.id), ['u1', 'u2', 'u3']);
  // 下标必须是原数组下标（助手行占位），不是过滤后的序号
  assert.deepEqual(entries.map((entry) => entry.index), [0, 2, 4]);
  // 升序前置条件由本函数保证
  for (let i = 1; i < entries.length; i += 1) {
    assert.ok(entries[i].index > entries[i - 1].index, 'index 必须严格升序');
  }
});

test('TC-002 空数组返回空数组', () => {
  assert.deepEqual(buildPromptEntries([]), []);
});

test('TC-003 预览压空白并截断到 160（省略号不计入上限）', () => {
  const messy = '  第一行\n\n第二行\t\t第三行   ';
  assert.equal(normalizePromptPreview(messy), '第一行 第二行 第三行');

  const long = 'x'.repeat(200);
  const preview = normalizePromptPreview(long);
  assert.equal(preview.length, PROMPT_PREVIEW_MAX_CHARS + 1);
  assert.equal(preview.slice(0, PROMPT_PREVIEW_MAX_CHARS), 'x'.repeat(PROMPT_PREVIEW_MAX_CHARS));
  assert.equal(preview.endsWith('…'), true);

  // 恰好 160 字符不加省略号（边界另一侧）
  const exact = 'y'.repeat(PROMPT_PREVIEW_MAX_CHARS);
  assert.equal(normalizePromptPreview(exact), exact);
  assert.equal(normalizePromptPreview(exact).length, PROMPT_PREVIEW_MAX_CHARS);
});

test('TC-004 空内容返回空预览', () => {
  assert.equal(normalizePromptPreview(''), '');
  assert.equal(normalizePromptPreview('   \n\t  '), '');
  assert.equal(normalizePromptPreview(undefined), '');
});

test('TC-005 下标落在两条之间，归属前一条', () => {
  const entries = buildPromptEntries([
    { id: 'u1', role: 'user', content: 'a' },
    { id: 'a1', role: 'assistant', content: 'b' },
    { id: 'u2', role: 'user', content: 'c' },
  ]);
  assert.equal(resolveActivePromptIndex(entries, 0), 0);
  assert.equal(resolveActivePromptIndex(entries, 1), 0, '助手行归到引发它的那次提问');
  assert.equal(resolveActivePromptIndex(entries, 2), 1);
  // 非有限下标按 0 处理
  assert.equal(resolveActivePromptIndex(entries, Number.NaN), 0);
});

test('TC-006 下标小于首条，返回 0', () => {
  const entries = [
    { id: 'u1', index: 5, preview: 'a' },
    { id: 'u2', index: 9, preview: 'b' },
  ];
  assert.equal(resolveActivePromptIndex(entries, 0), 0);
  assert.equal(resolveActivePromptIndex(entries, 4), 0);
  assert.equal(resolveActivePromptIndex(entries, 9), 1);
  assert.equal(resolveActivePromptIndex(entries, 9999), 1);
});

test('TC-007 空 prompts 返回 -1', () => {
  assert.equal(resolveActivePromptIndex([], 0), -1);
  assert.equal(resolveActivePromptIndex([], 1024), -1);
});

test('TC-008 总数小于容量，窗口覆盖全部', () => {
  assert.deepEqual(planTickWindow(3, 1), {
    start: 0,
    end: 3,
    hasMoreAbove: false,
    hasMoreBelow: false,
  });
  assert.deepEqual(planTickWindow(0, 0), {
    start: 0,
    end: 0,
    hasMoreAbove: false,
    hasMoreBelow: false,
  });
});

test('TC-009 总数等于容量，窗口不越界', () => {
  const plan = planTickWindow(RAIL_VISIBLE_TICKS, 0);
  assert.equal(plan.start, 0);
  assert.equal(plan.end, RAIL_VISIBLE_TICKS);
  assert.equal(plan.hasMoreAbove, false);
  assert.equal(plan.hasMoreBelow, false);
  const tail = planTickWindow(RAIL_VISIBLE_TICKS, RAIL_VISIBLE_TICKS - 1);
  assert.equal(tail.end, RAIL_VISIBLE_TICKS);
});

test('TC-010 总数大于容量且当前项居中', () => {
  const total = 100;
  const cap = 30;
  const plan = planTickWindow(total, 50, cap);
  assert.equal(plan.end - plan.start, cap);
  assert.equal(plan.hasMoreAbove, true);
  assert.equal(plan.hasMoreBelow, true);
  // 当前项必须落在窗口内，且两侧余量差不超过 1
  assert.ok(plan.start <= 50 && 50 < plan.end, '当前项必须在窗口内');
  const above = 50 - plan.start;
  const below = plan.end - 1 - 50;
  assert.ok(Math.abs(above - below) <= 1, `居中偏差过大: above=${above} below=${below}`);
});

test('TC-011 当前项在首条，hasMoreAbove=false', () => {
  const plan = planTickWindow(100, 0, 30);
  assert.equal(plan.start, 0);
  assert.equal(plan.end, 30);
  assert.equal(plan.hasMoreAbove, false);
  assert.equal(plan.hasMoreBelow, true);
});

test('TC-012 当前项在末条，hasMoreBelow=false', () => {
  const plan = planTickWindow(100, 99, 30);
  assert.equal(plan.start, 70);
  assert.equal(plan.end, 100);
  assert.equal(plan.hasMoreAbove, true);
  assert.equal(plan.hasMoreBelow, false);
});

test('TC-013 无悬停时全部保持基准宽，不衰减', () => {
  assert.equal(tickWidth(0, false, false), 10);
  assert.equal(tickWidth(1, false, false), 10);
  assert.equal(tickWidth(29, false, false), 10);
  assert.equal(tickWidth(0, true, false), 14);
  // 负距离与非有限距离都不得变成负宽度
  assert.equal(tickWidth(-3, false, false), 10);
  assert.equal(tickWidth(Number.NaN, false, false), 10);
});

test('TC-014 悬停时中心 20，邻近按增量放大，距离 4 回到基准宽', () => {
  assert.equal(tickWidth(0, false, true, true), 20);
  assert.equal(tickWidth(0, true, true, true), 20, '当前项悬停同样 20');
  assert.equal(tickWidth(1, false, false, true), 16);
  assert.equal(tickWidth(2, false, false, true), 13.5);
  assert.equal(tickWidth(3, false, false, true), 11.5);
  assert.equal(tickWidth(4, false, false, true), 10, '距离 4 只保留基准宽，绝不归零');
  assert.equal(tickWidth(1, true, false, true), 17.6);
});

test('TC-015 预览含尖括号与引号时按纯文本输出', () => {
  const raw = '<img src=x onerror="alert(1)"> & \'quote\'';
  const preview = normalizePromptPreview(raw);
  // 纯文本：原样保留，不做 HTML 转义也不生成标签
  assert.equal(preview, raw);
  assert.equal(preview.includes('<img'), true);
  const entries = buildPromptEntries([{ id: 'u1', role: 'user', content: raw }]);
  assert.equal(entries[0].preview, raw);
});

test('TC-016 空 id 条目被剔除', () => {
  const entries = buildPromptEntries([
    { id: '', role: 'user', content: '空 id' },
    { id: '   ', role: 'user', content: '空白 id' },
    { id: undefined, role: 'user', content: '非字符串 id' },
    { id: 'ok', role: 'user', content: '有效' },
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'ok');
  assert.equal(entries[0].index, 3);
});

test('TC-021 非人类正文的 role=user 行不占导航横杠', () => {
  const entries = buildPromptEntries([
    { id: 'u1', role: 'user', content: '真实提问', displayKind: 'user' },
    { id: 'u2', role: 'user', content: '[System: model changed]', displayKind: 'model_switch' },
    { id: 'u3', role: 'user', content: '[OUT-OF-BAND]插话', displayKind: 'steer' },
    { id: 'u4', role: 'user', content: '', displayKind: 'hidden' },
    { id: 'a1', role: 'assistant', content: '回答' },
  ]);
  assert.equal(entries.length, 1, '只有真实提问占横杠');
  assert.equal(entries[0].id, 'u1');
});

test('TC-022 未带 displayKind 的旧消息仍按提问收录', () => {
  const entries = buildPromptEntries([{ id: 'u1', role: 'user', content: '旧数据' }]);
  assert.equal(entries.length, 1);
});

test('TC-020 38 条 prompt 时窗口长度不超过容量 30', () => {
  for (const activeIndex of [0, 1, 19, 36, 37]) {
    const plan = planTickWindow(38, activeIndex, RAIL_VISIBLE_TICKS);
    const length = plan.end - plan.start;
    assert.ok(length <= RAIL_VISIBLE_TICKS, `窗口长度越界: ${length}`);
    assert.ok(plan.start >= 0, 'start 不得为负');
    assert.ok(plan.end <= 38, 'end 不得越界');
    assert.ok(plan.start <= activeIndex && activeIndex < plan.end, '当前项必须在窗口内');
  }
});

test('TC-024 窗口容量为 1 时窗口恒等于当前项', () => {
  for (const activeIndex of [0, 7, 99]) {
    const plan = planTickWindow(100, activeIndex, 1);
    assert.equal(plan.start, activeIndex);
    assert.equal(plan.end, activeIndex + 1);
    assert.equal(plan.hasMoreAbove, activeIndex > 0);
    assert.equal(plan.hasMoreBelow, activeIndex < 99);
  }
});

test('TC-025 activeIndex=-1 时窗口对齐末条', () => {
  const plan = planTickWindow(100, -1, 30);
  assert.equal(plan.end, 100);
  assert.equal(plan.start, 70);
  assert.equal(plan.hasMoreBelow, false);
  // 越界下标同样按末条处理
  assert.deepEqual(planTickWindow(100, 500, 30), plan);
  // 非正容量回落到默认容量
  assert.equal(planTickWindow(100, 50, 0).end - planTickWindow(100, 50, 0).start, RAIL_VISIBLE_TICKS);
});

test('TC-026 shouldTriggerLoadOlderAtTop 守卫所有阻断条件与冷却边界', () => {
  assert.equal(TOP_LOAD_COOLDOWN_MS, 250);
  const valid = {
    hasOlder: true,
    isLoadingOlder: false,
    hasHandler: true,
    atTop: true,
    movingUpward: true,
    elapsedSinceLastTriggerMs: TOP_LOAD_COOLDOWN_MS,
  };
  assert.equal(shouldTriggerLoadOlderAtTop(valid), true, '全部条件满足且冷却期满时放行');
  assert.equal(shouldTriggerLoadOlderAtTop({ ...valid, elapsedSinceLastTriggerMs: undefined }), true);
  assert.equal(shouldTriggerLoadOlderAtTop({ ...valid, hasOlder: false }), false, '无更早历史时拦截');
  assert.equal(shouldTriggerLoadOlderAtTop({ ...valid, isLoadingOlder: true }), false, '加载中时拦截防重入');
  assert.equal(shouldTriggerLoadOlderAtTop({ ...valid, hasHandler: false }), false, '宿主未提供回调时拦截');
  assert.equal(shouldTriggerLoadOlderAtTop({ ...valid, atTop: false }), false, '未到达顶部时拦截');
  assert.equal(shouldTriggerLoadOlderAtTop({ ...valid, movingUpward: false }), false, '非向上意图时拦截');
  assert.equal(
    shouldTriggerLoadOlderAtTop({ ...valid, elapsedSinceLastTriggerMs: TOP_LOAD_COOLDOWN_MS - 1 }),
    false,
    '冷却期内拦截惯性连发'
  );
  assert.equal(shouldTriggerLoadOlderAtTop({ ...valid, elapsedSinceLastTriggerMs: -1 }), false, '负数间隔不放行');
  assert.equal(shouldTriggerLoadOlderAtTop({ ...valid, elapsedSinceLastTriggerMs: Number.NaN }), false, 'NaN 间隔不放行');
  // 自定义冷却阈值：有效值严格生效，负数/NaN 回落默认值 250ms
  assert.equal(shouldTriggerLoadOlderAtTop({ ...valid, elapsedSinceLastTriggerMs: 99, cooldownMs: 100 }), false);
  assert.equal(shouldTriggerLoadOlderAtTop({ ...valid, elapsedSinceLastTriggerMs: 100, cooldownMs: 100 }), true);
  assert.equal(shouldTriggerLoadOlderAtTop({ ...valid, elapsedSinceLastTriggerMs: 0, cooldownMs: 0 }), true);
  assert.equal(shouldTriggerLoadOlderAtTop({ ...valid, elapsedSinceLastTriggerMs: 249, cooldownMs: -50 }), false);
  assert.equal(shouldTriggerLoadOlderAtTop({ ...valid, elapsedSinceLastTriggerMs: 250, cooldownMs: Number.NaN }), true);
});

test('TC-027 planPromptPrependView 头部插入历史时区分顶部拉取与非顶部锚定', () => {
  // 场景 1：面板展开且停在顶部 (panelOffset=0)，前置拉回 10 条历史
  // 必须保留至多 2 行新历史上下文，避免一下甩回 0 点丢失连续感
  const atTopLarge = planPromptPrependView({
    previousTotal: 15,
    nextTotal: 25,
    capacity: 30,
    windowStart: 0,
    highlightedIndex: 0,
    panelOffset: 0,
    panelOpen: true,
  });
  assert.deepEqual(atTopLarge, { windowStart: 0, highlightedIndex: 10, panelOffset: 8 });

  // 场景 2：大轨道（40 -> 50 条）停在顶部拉取，windowStart 与 panelOffset 同步留 2 条新历史上下文
  const bigRailAtTop = planPromptPrependView({
    previousTotal: 40,
    nextTotal: 50,
    capacity: 30,
    windowStart: 0,
    highlightedIndex: 0,
    panelOffset: 0,
    panelOpen: true,
  });
  assert.deepEqual(bigRailAtTop, { windowStart: 8, highlightedIndex: 10, panelOffset: 8 });

  // 场景 3：仅拉回 1 条时，delta < 2 直接落到 0
  const atTopTiny = planPromptPrependView({
    previousTotal: 15,
    nextTotal: 16,
    capacity: 30,
    windowStart: 0,
    highlightedIndex: 0,
    panelOffset: 0,
    panelOpen: true,
  });
  assert.deepEqual(atTopTiny, { windowStart: 0, highlightedIndex: 1, panelOffset: 0 });

  // 场景 4：总条数仍不超过面板可见行数（2 -> 6），panelOffset 必须安全夹在 0
  const stillUnderOnePage = planPromptPrependView({
    previousTotal: 2,
    nextTotal: 6,
    capacity: 30,
    windowStart: 0,
    highlightedIndex: 0,
    panelOffset: 0,
    panelOpen: true,
  });
  assert.deepEqual(stillUnderOnePage, { windowStart: 0, highlightedIndex: 4, panelOffset: 0 });

  // 场景 5：面板非顶部或面板关闭但保留非零偏移时全额补偿 delta，保持阅读锚点静止
  const midScroll = planPromptPrependView({
    previousTotal: 40,
    nextTotal: 50,
    capacity: 30,
    windowStart: 5,
    highlightedIndex: 8,
    panelOffset: 4,
    panelOpen: true,
  });
  assert.deepEqual(midScroll, { windowStart: 15, highlightedIndex: 18, panelOffset: 14 });

  const closedWithOffset = planPromptPrependView({
    previousTotal: 40,
    nextTotal: 50,
    capacity: 30,
    windowStart: 2,
    highlightedIndex: 5,
    panelOffset: 3,
    panelOpen: false,
  });
  assert.deepEqual(closedWithOffset, { windowStart: 12, highlightedIndex: 15, panelOffset: 13 });

  const closedRail = planPromptPrependView({
    previousTotal: 40,
    nextTotal: 50,
    capacity: 30,
    windowStart: 0,
    highlightedIndex: null,
    panelOffset: 0,
    panelOpen: false,
  });
  assert.deepEqual(closedRail, { windowStart: 10, highlightedIndex: null, panelOffset: 0 });

  // 场景 6：空表 / delta <= 0 / previousTotal <= 0 安全夹取，不得出现负数或越界
  assert.deepEqual(
    planPromptPrependView({
      previousTotal: 5,
      nextTotal: 0,
      capacity: 30,
      windowStart: 3,
      highlightedIndex: 2,
      panelOffset: 1,
      panelOpen: true,
    }),
    { windowStart: 0, highlightedIndex: null, panelOffset: 0 }
  );
  assert.deepEqual(
    planPromptPrependView({
      previousTotal: 20,
      nextTotal: 15,
      capacity: 30,
      windowStart: 5,
      highlightedIndex: 19,
      panelOffset: 10,
      panelOpen: true,
    }),
    { windowStart: 0, highlightedIndex: 14, panelOffset: 7 }
  );
  assert.deepEqual(
    planPromptPrependView({
      previousTotal: 0,
      nextTotal: 10,
      capacity: 30,
      windowStart: 0,
      highlightedIndex: null,
      panelOffset: 0,
      panelOpen: false,
    }),
    { windowStart: 0, highlightedIndex: null, panelOffset: 0 }
  );
});

test('TC-028 decidePanelWheelAction 区分触顶拉取与面板滚动', () => {
  const base = {
    total: 20,
    panelOffset: 0,
    hasOlder: true,
    isLoadingOlder: false,
    hasHandler: true,
    elapsedSinceLastTriggerMs: 300,
  };
  // 面板在顶部且向上滚轮 -> 触发拉取
  assert.deepEqual(decidePanelWheelAction({ ...base, deltaY: -40 }), { type: 'load-older' });
  // 面板在顶部但向下滚轮 -> 正常滚动到第 1 行，绝不误触发拉取
  assert.deepEqual(decidePanelWheelAction({ ...base, deltaY: 40 }), { type: 'scroll', nextOffset: 1 });
  // 面板尚未到顶（offset=3）向上滚轮 -> 向上滚一行而不提前请求
  assert.deepEqual(decidePanelWheelAction({ ...base, panelOffset: 3, deltaY: -40 }), { type: 'scroll', nextOffset: 2 });
  // 到达底部夹紧至 total - 8 = 12
  assert.deepEqual(decidePanelWheelAction({ ...base, panelOffset: 12, deltaY: 40 }), { type: 'scroll', nextOffset: 12 });
  // 加载中 / 无更早历史 / 冷却期内均拦截为 noop
  assert.deepEqual(decidePanelWheelAction({ ...base, deltaY: -40, isLoadingOlder: true }), { type: 'noop' });
  assert.deepEqual(decidePanelWheelAction({ ...base, deltaY: -40, hasOlder: false }), { type: 'noop' });
  assert.deepEqual(decidePanelWheelAction({ ...base, deltaY: -40, elapsedSinceLastTriggerMs: 100 }), { type: 'noop' });
  // 空列表或零位移
  assert.deepEqual(decidePanelWheelAction({ ...base, total: 0, deltaY: -40 }), { type: 'noop' });
  assert.deepEqual(decidePanelWheelAction({ ...base, deltaY: 0 }), { type: 'noop' });
});

test('TC-029 decideGutterKeyAction 覆盖首条越顶拉取与全部导航键位', () => {
  const base = {
    anchor: 0,
    start: 0,
    total: 20,
    hasOlder: true,
    isLoadingOlder: false,
    hasHandler: true,
    elapsedSinceLastTriggerMs: 300,
  };
  // 停在全局第 0 条继续按 ArrowUp -> 触发拉取
  assert.deepEqual(decideGutterKeyAction({ ...base, key: 'ArrowUp' }), { type: 'load-older' });
  // 无更早历史时停在首条按 ArrowUp -> noop
  assert.deepEqual(decideGutterKeyAction({ ...base, key: 'ArrowUp', hasOlder: false }), { type: 'noop' });
  // 非首条按 ArrowUp -> 仅移动高亮
  assert.deepEqual(decideGutterKeyAction({ ...base, key: 'ArrowUp', anchor: 2, start: 0 }), { type: 'highlight', target: 1 });
  assert.deepEqual(decideGutterKeyAction({ ...base, key: 'ArrowUp', anchor: 5, start: 5 }), { type: 'highlight', target: 4 });
  // 其余键位
  assert.deepEqual(decideGutterKeyAction({ ...base, key: 'ArrowDown', anchor: 2 }), { type: 'highlight', target: 3 });
  assert.deepEqual(decideGutterKeyAction({ ...base, key: 'Home', anchor: 10 }), { type: 'highlight', target: 0 });
  assert.deepEqual(decideGutterKeyAction({ ...base, key: 'End', anchor: 2 }), { type: 'highlight', target: 19 });
  assert.deepEqual(decideGutterKeyAction({ ...base, key: 'Enter', anchor: 7 }), { type: 'select', target: 7 });
  assert.deepEqual(decideGutterKeyAction({ ...base, key: ' ', anchor: -1 }), { type: 'select', target: 0 });
  assert.deepEqual(decideGutterKeyAction({ ...base, key: 'Escape' }), { type: 'escape' });
  assert.deepEqual(decideGutterKeyAction({ ...base, key: 'Tab' }), { type: 'noop' });
  assert.deepEqual(decideGutterKeyAction({ ...base, key: 'ArrowUp', total: 0 }), { type: 'noop' });
});

test('TC-030 decideHotzonePointerAction 覆盖顶/底热区、触顶锁与复位后连续触发', () => {
  const base = {
    gutterHeight: 360,
    edgePx: 18,
    hasMoreAbove: false,
    topHotzoneTriggered: false,
    hasOlder: true,
    isLoadingOlder: false,
    hasHandler: true,
    elapsedSinceLastTriggerMs: 300,
  };
  // 顶部热区且本地已无上文 -> 触发拉取
  assert.deepEqual(decideHotzonePointerAction({ ...base, offsetY: 10 }), {
    type: 'top-load-older',
    shouldTrigger: true,
  });
  // 已触发锁定中，同一次悬停不得连发
  assert.deepEqual(decideHotzonePointerAction({ ...base, offsetY: 10, topHotzoneTriggered: true }), {
    type: 'top-load-older',
    shouldTrigger: false,
  });
  // 新历史插页复位 topHotzoneTriggered=false 后，允许继续探测下一批
  assert.deepEqual(decideHotzonePointerAction({ ...base, offsetY: 10, topHotzoneTriggered: false }), {
    type: 'top-load-older',
    shouldTrigger: true,
  });
  // 顶部仍有本地刻度时先向上轮播并复位锁定
  assert.deepEqual(decideHotzonePointerAction({ ...base, offsetY: 10, hasMoreAbove: true, topHotzoneTriggered: true }), {
    type: 'top-carousel',
    resetTriggered: true,
  });
  // 底部热区 -> 向下轮播并复位顶部触发锁
  assert.deepEqual(decideHotzonePointerAction({ ...base, offsetY: 350 }), {
    type: 'bottom-carousel',
    resetTriggered: true,
  });
  // 中间安全区 -> 停止轮播并复位触发锁
  assert.deepEqual(decideHotzonePointerAction({ ...base, offsetY: 180 }), {
    type: 'stop',
    resetTriggered: true,
  });
});
