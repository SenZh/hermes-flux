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
  normalizePromptPreview,
  buildPromptEntries,
  resolveActivePromptIndex,
  planTickWindow,
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

test('TC-013 宽度衰减在距离 0 到 4 的取值', () => {
  assert.equal(tickWidth(0, false, false), 10);
  assert.equal(tickWidth(1, false, false), 6);
  assert.equal(tickWidth(2, false, false), 3.5);
  assert.equal(tickWidth(3, false, false), 1.5);
  assert.equal(tickWidth(4, false, false), 0);
  assert.equal(tickWidth(9, false, false), 0);
  // 负距离按 0 处理，不得变成负宽度
  assert.equal(tickWidth(-3, false, false), 10);
});

test('TC-014 当前 14、悬停 20、普通 10', () => {
  assert.equal(tickWidth(0, true, false), 14);
  assert.equal(tickWidth(0, false, true), 20);
  assert.equal(tickWidth(0, true, true), 20, '悬停优先于当前项');
  assert.equal(tickWidth(0, false, false), 10);
  assert.equal(tickWidth(1, true, false), 8.4);
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
