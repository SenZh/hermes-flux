import test from 'node:test';
import assert from 'node:assert/strict';
import { planAverageRowHeightLock } from '../../dist/renderer/messageWindow.mjs';

/**
 * 平均行高锁定判定。
 *
 * 【实测依据】会话 20261020_150348_4fe41e（网关 0.22.5）切换瞬间捕获：
 *   { windowCount: 1, rowNodes: 79, uniqueIds: 57, contentH: 10804,
 *     avg: 10804, start: 0, end: 0, total: 0 }
 *   切会话时 state.messages 还是空数组（total=0），窗口塌成 [0,0)，
 *   而 .conv-canvas 里还挂着上一个会话的 57 条 DOM 行。
 *   windowCount 兜底成 1，于是 10804 / 1 = 10804。
 *   该值按会话锁定一次后不再重算：586 条 × 10804 ≈ 633 万 px 虚拟高度，
 *   窗口起点 3 就对应 32412px 偏移，读者永远滚不到顶部。
 *
 * 【修复判据】只有「测量到的行」全部属于「当前窗口切片」时才允许锁定。
 *   这一条同时挡住两种错锁：窗口未建立（分母塌成 1），
 *   以及 DOM 还是上一个会话的残留（分子是别人的高度）。
 */

const win = (start, end) => ({ windowStart: start, windowEnd: end });

test('切会话瞬间窗口为空且 DOM 是上一会话残留时，绝不锁定行高', () => {
  const plan = planAverageRowHeightLock({
    ...win(0, 0),
    total: 0,
    contentHeightPx: 10804,
    measuredIds: ['row-18767', 'row-18769', 'row-18770', 'row-18771', 'row-18772'],
    windowIds: [],
  });

  assert.equal(plan.lock, false, '窗口为空时必须拒绝锁定，否则分母塌成 1');
  assert.equal(plan.averageRowHeightPx, 0, '未锁定不得产出平均值');
});

test('窗口已建立但 DOM 仍属于上一个会话时，绝不锁定行高', () => {
  const plan = planAverageRowHeightLock({
    ...win(0, 120),
    total: 586,
    contentHeightPx: 10804,
    measuredIds: ['row-18767', 'row-18769', 'row-18770', 'row-18771', 'row-18772'],
    windowIds: ['18541', '18542', '17405', '17419', '17420', '17421', '17422'],
  });

  assert.equal(plan.lock, false, '测量行没有任何一条在窗口内，说明 DOM 尚未提交到本会话');
});

test('切会话后真实窗口就位时，按窗口下标数正确锁定', () => {
  // 真实形态：窗口 [466, 586) 共 120 条，DOM 实测内容高 10804px。
  const windowIds = Array.from({ length: 120 }, (_, i) => `m-${466 + i}`);
  const measured = windowIds.slice(0, 57);
  const plan = planAverageRowHeightLock({
    ...win(466, 586),
    total: 586,
    contentHeightPx: 10804,
    measuredIds: measured,
    windowIds,
  });

  assert.equal(plan.lock, true, '窗口就位且测量行都在窗口内时必须锁定');
  assert.equal(plan.averageRowHeightPx, 10804 / 120, '分母必须是窗口下标条数，不是 1');
});

test('测量行只有部分是窗口外的僵尸节点时，同样拒绝锁定', () => {
  const windowIds = Array.from({ length: 10 }, (_, i) => `m-${i}`);
  const plan = planAverageRowHeightLock({
    ...win(0, 10),
    total: 10,
    contentHeightPx: 5000,
    measuredIds: ['m-0', 'm-1', 'm-2', 'm-3', 'ghost-9999'],
    windowIds,
  });

  assert.equal(plan.lock, false, '混入窗口外节点说明测量集合不纯净');
});

test('样本不足 5 条时保持不锁定', () => {
  const plan = planAverageRowHeightLock({
    ...win(0, 3),
    total: 3,
    contentHeightPx: 300,
    measuredIds: ['m-0', 'm-1', 'm-2'],
    windowIds: ['m-0', 'm-1', 'm-2'],
  });

  assert.equal(plan.lock, false, '少于 5 条样本时平均行高不稳，继续等下一帧');
});

test('内容高度为 0 或非法时不得锁定', () => {
  for (const h of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const plan = planAverageRowHeightLock({
      ...win(0, 6),
      total: 6,
      contentHeightPx: h,
      measuredIds: ['m-0', 'm-1', 'm-2', 'm-3', 'm-4', 'm-5'],
      windowIds: ['m-0', 'm-1', 'm-2', 'm-3', 'm-4', 'm-5'],
    });
    assert.equal(plan.lock, false, `contentHeightPx=${h} 时不得锁定`);
  }
});

test('锁定值有下限，避免极端小行把虚拟高度压到不可滚', () => {
  const windowIds = Array.from({ length: 120 }, (_, i) => `m-${i}`);
  const plan = planAverageRowHeightLock({
    ...win(0, 120),
    total: 120,
    contentHeightPx: 120,
    measuredIds: windowIds.slice(0, 10),
    windowIds,
  });

  assert.equal(plan.lock, true);
  assert.equal(plan.averageRowHeightPx, 24, '每行低于 24px 时按 24px 兜底');
});
