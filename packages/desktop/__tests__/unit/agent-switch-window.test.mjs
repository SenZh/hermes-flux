import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  planMessageWindow,
  expandMessageWindowStart,
  slideMessageWindowDown,
  windowEndFor,
  windowStartAroundIndex,
} from '../../dist/renderer/messageWindow.mjs';
import { profilesDiffer } from '../../dist/renderer/profileRefresh.mjs';

/**
 * Agent 切换窗口与 Profile 刷新的行为级测试。
 *
 * 【设计意图 (Why)】
 *   源码字符串守卫只能证明“代码文本还在”，不能证明边界状态迁移正确。
 *   这里直接执行生产纯函数，对窗口区间、容量上限、双向滑动做四象限断言。
 *
 * 【防范的历史坑 (Pitfall)】
 *   旧实现窗口是开放区间 [start, total)，只扩不缩。真实会话（7745 条）回溯 28 轮后
 *   DOM 从 4059 节点涨到 11568、拖拽帧间隔从 28.9ms 恶化到 47.9ms，滑回底部仍不释放。
 *   下列容量断言就是防止该缺陷复发的闸门。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = {
  total: 100,
  start: 0,
  end: 100,
  userExpanded: false,
  sessionChanged: false,
  followBottom: true,
  initialWindow: 24,
  capacity: 120,
};

test('消息窗口 - 空会话必须落在 0，不能产生负区间', () => {
  assert.deepEqual(planMessageWindow({ ...base, total: 0, start: 0 }), { start: 0, end: 0, userExpanded: false });
  assert.deepEqual(planMessageWindow({ ...base, total: -5, start: 12 }), { start: 0, end: 0, userExpanded: false });
});

test('消息窗口 - 切会话必须回到末尾窗口并解除扩展态', () => {
  const plan = planMessageWindow({ ...base, total: 500, sessionChanged: true, start: 3, userExpanded: true });
  assert.equal(plan.start, 380, 'total 500、容量 120 时末尾窗口起点必须是 380');
  assert.equal(plan.end, 500, '末尾窗口末端必须等于总长');
  assert.equal(plan.userExpanded, false);
});

test('消息窗口 - 贴底且未扩展时跟随末尾，回溯时保持起点', () => {
  const tail = planMessageWindow({ ...base, total: 500, start: 10, followBottom: true });
  assert.deepEqual(tail, { start: 380, end: 500, userExpanded: false });

  const frozen = planMessageWindow({ ...base, total: 500, start: 100, followBottom: false, userExpanded: true });
  assert.equal(frozen.start, 100);
  assert.equal(frozen.end, 220);
});

test('消息窗口 - 容量是硬上限，区间长度永不突破', () => {
  // 各种极端起点下区间长度都必须 <= capacity
  for (const start of [0, 1, 50, 380, 999, 100000]) {
    const plan = planMessageWindow({ ...base, total: 500, start, userExpanded: true, followBottom: false, capacity: 120 });
    assert.ok(plan.end - plan.start <= 120, `start=${start} 时区间长度 ${plan.end - plan.start} 超过容量 120`);
  }
  // 起点被夹到 total - capacity，末端正好是 total
  const clamped = planMessageWindow({ ...base, total: 500, start: 999, userExpanded: true, followBottom: false, capacity: 120 });
  assert.deepEqual(clamped, { start: 380, end: 500, userExpanded: true });
});

test('消息窗口 - 回滚截断把总长压进窗口时必须收敛回末尾', () => {
  const plan = planMessageWindow({ ...base, total: 50, start: 50, userExpanded: true, followBottom: false });
  assert.equal(plan.end, 50, '末端必须收敛到新总长');
  assert.ok(plan.start <= 50);
});

test('扩窗步进 - 逐批向 0 收敛且不越过容量允许的最大起点', () => {
  assert.equal(expandMessageWindowStart(76, 40), 36);
  assert.equal(expandMessageWindowStart(10, 40), 0);
  assert.equal(expandMessageWindowStart(0, 40), 0);
  assert.equal(expandMessageWindowStart(-10, 40), 0);
  assert.equal(expandMessageWindowStart(76, 0), 76);
  // 上界约束：起点不得超过 total - capacity
  assert.equal(expandMessageWindowStart(500, 40, 380), 460 > 380 ? 380 : 460);
});

test('扩窗步进 - 反复扩展后区间长度恒等于容量（挂载量不随回溯增长）', () => {
  const total = 7745;
  const capacity = 120;
  let start = total - capacity;
  const roundsToTop = Math.ceil(start / 40);
  for (let i = 0; i < roundsToTop; i++) {
    start = expandMessageWindowStart(start, 40, Math.max(0, total - capacity));
    const end = windowEndFor(start, total, capacity, 24);
    assert.ok(end - start <= capacity, `第 ${i} 轮扩展后区间长度 ${end - start} 超过容量`);
  }
  assert.equal(start, 0, `${roundsToTop} 轮后应已顶到列表首部`);
});

test('窗口末端 - 唯一推导入口，受总长与容量双重约束', () => {
  assert.equal(windowEndFor(0, 500, 120, 24), 120);
  assert.equal(windowEndFor(400, 500, 120, 24), 500);
  assert.equal(windowEndFor(9999, 500, 120, 24), 500, '起点越界时末端不得超过总长');
  assert.equal(windowEndFor(0, 50, 120, 24), 50, '总长小于容量时末端即总长');
});

test('向下滑动 - 起点单调不减且不越过 total - capacity', () => {
  const total = 500;
  const capacity = 120;
  let start = 0;
  const seen = [start];
  for (let i = 0; i < 50; i++) {
    start = slideMessageWindowDown(start, total, capacity, 40, 24);
    seen.push(start);
  }
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1], '起点必须单调不减');
  }
  assert.equal(start, 380, '最终停在 total - capacity，窗口覆盖末尾');
});

test('向下滑动 - 总长不足一屏时保持原位，不产生负起点', () => {
  assert.equal(slideMessageWindowDown(0, 50, 120, 40, 24), 0);
  assert.equal(slideMessageWindowDown(0, 0, 120, 40, 24), 0);
});

test('跨窗口锚点 - 索引反查把窗口搬到目标附近并保留上文', () => {
  const total = 5000;
  const capacity = 120;
  // 目标在索引 3000，前留 8 行 -> 起点 2992，末端 3112
  const start = windowStartAroundIndex(3000, total, capacity, 8, 24);
  assert.equal(start, 2992);
  assert.equal(windowEndFor(start, total, capacity, 24), 3112);
  // 索引越界或负数时退化为 0，不得产生非法起点
  assert.equal(windowStartAroundIndex(-5, total, capacity, 8, 24), 0);
  assert.equal(windowStartAroundIndex(0, total, capacity, 8, 24), 0);
});

test('回归守卫 - 真实会话规模下窗口区间恒定（7745 条回溯 28 轮不增长）', () => {
  const total = 7745;
  const capacity = 120;
  let start = total - capacity;
  const lengths = [];
  for (let round = 0; round < 28; round++) {
    start = expandMessageWindowStart(start, 40, Math.max(0, total - capacity));
    const end = windowEndFor(start, total, capacity, 24);
    lengths.push(end - start);
  }
  const maxLen = Math.max(...lengths);
  const minLen = Math.min(...lengths);
  assert.ok(maxLen <= capacity, `区间长度上界 ${maxLen} 必须不超过容量 ${capacity}`);
  assert.equal(maxLen, minLen, '回溯过程中区间长度必须恒定，否则挂载量会随轮次增长');
});

const profile = (overrides = {}) => ({
  name: 'aura',
  displayName: 'Aura',
  description: 'design agent',
  model: 'deepseek',
  hasAvatar: false,
  ...overrides,
});

test('Profile 差异 - 同内容必须返回 false（避免每分钟无意义重绘）', () => {
  assert.equal(profilesDiffer([profile()], [profile()]), false);
});

test('Profile 差异 - 显示名、副标题、活跃时间与对象字段必须逐项可检出', () => {
  assert.equal(profilesDiffer([profile()], [profile({ displayName: 'Aura 2' })]), true);
  assert.equal(profilesDiffer([profile()], [profile({ lastMessage: '新回复' })]), true);
  assert.equal(profilesDiffer([profile()], [profile({ lastTime: '昨天' })]), true);
  assert.equal(profilesDiffer([profile()], [profile({ timestamp: 123 })]), true);
  assert.equal(profilesDiffer([profile()], [profile({ last_session: { preview: 'new' } })]), true);
  assert.equal(profilesDiffer([profile()], [profile({ uiMeta: { rooms: [{ id: 'r1' }] } })]), true);
});

test('Profile 差异 - 名称与数量变化必须刷新', () => {
  assert.equal(profilesDiffer([profile()], [profile({ name: 'Aura' })]), true);
  assert.equal(profilesDiffer([profile()], [profile(), profile({ name: 'codeboy', displayName: 'CodeBoy' })]), true);
});
