import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planMessageWindow, expandMessageWindowStart } from '../../dist/renderer/messageWindow.mjs';
import { profilesDiffer } from '../../dist/renderer/profileRefresh.mjs';

/**
 * Agent 切换窗口与 Profile 刷新的行为级测试。
 *
 * 【设计意图 (Why)】
 *   源码字符串守卫只能证明“代码文本还在”，不能证明边界状态迁移正确。
 *   这里直接执行生产纯函数，对窗口起点、回滚截断、读者回溯、Profile 字段变化做四象限断言；
 *   任何把 `>=` 改回 `>`、把字段比较删掉、或把窗口起点算错的变异都会变红。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = { total: 100, start: 0, userExpanded: false, sessionChanged: false, followBottom: true, initialWindow: 24 };

test('消息窗口 - 空会话必须落在 0，不能产生负起点', () => {
  assert.deepEqual(planMessageWindow({ ...base, total: 0, start: 0 }), { start: 0, userExpanded: false });
  assert.deepEqual(planMessageWindow({ ...base, total: -5, start: 12 }), { start: 0, userExpanded: false });
});

test('消息窗口 - 切会话必须回到末尾窗口并解除扩展态', () => {
  assert.deepEqual(planMessageWindow({ ...base, sessionChanged: true, start: 3, userExpanded: true }), { start: 76, userExpanded: false });
});

test('消息窗口 - 贴底时跟随末尾，回溯时冻结起点', () => {
  assert.deepEqual(planMessageWindow({ ...base, start: 10, followBottom: true }), { start: 76, userExpanded: false });
  assert.deepEqual(planMessageWindow({ ...base, start: 10, followBottom: false }), { start: 10, userExpanded: false });
});

test('消息窗口 - 回滚截断到起点等于总长时必须收敛回末尾（空白会话回归守卫）', () => {
  assert.deepEqual(planMessageWindow({ ...base, total: 50, start: 50, userExpanded: true }), { start: 26, userExpanded: false });
  assert.deepEqual(planMessageWindow({ ...base, total: 100, start: 100, userExpanded: true }), { start: 76, userExpanded: false });
  assert.deepEqual(planMessageWindow({ ...base, total: 100, start: 120, userExpanded: true }), { start: 76, userExpanded: false });
});

test('消息窗口 - 已扩展且仍在范围内时保持起点', () => {
  assert.deepEqual(planMessageWindow({ ...base, start: 40, userExpanded: true }), { start: 40, userExpanded: true });
});

test('扩窗步进 - 逐批向 0 收敛且绝不越界', () => {
  assert.equal(expandMessageWindowStart(76, 40), 36);
  assert.equal(expandMessageWindowStart(10, 40), 0);
  assert.equal(expandMessageWindowStart(0, 40), 0);
  assert.equal(expandMessageWindowStart(-10, 40), 0);
  assert.equal(expandMessageWindowStart(76, 0), 76);
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
