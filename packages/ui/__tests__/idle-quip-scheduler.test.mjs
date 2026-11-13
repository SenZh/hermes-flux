/**
 * 空闲轮播调度器单测（packages/ui/__tests__/idle-quip-scheduler.test.mjs）
 *
 * 【测试什么】定时器语义——本模块唯一的真风险面，且它在 `renderToStaticMarkup` 下
 *   完全不可观测（effect 不执行）。因此调度逻辑被抽成注入式纯调度器，这里用**假定时器**
 *   逐拍推进，不需要 DOM 环境。
 *
 * 【不测什么】文案内容（那是 i18n）、React 渲染（那是组件契约测试）。
 *
 * 【变异杀伤力】把 stop() 里的复位删掉、把 visibilityChanged 的 hidden 分支改成空实现、
 *   把 start() 改成每次都新排一条链、把 turnMs 的定时器改成不清 —— 对应用例立刻变红。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdleQuipScheduler, IDLE_QUIP_REST } from '../dist/components-react/conversation/idleQuipScheduler.js';

/** 最小假定时器：手动推进，可断言残留数量 */
function createFakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map();

  return {
    setTimer(callback, delayMs) {
      seq += 1;
      pending.set(seq, { at: now + delayMs, callback });
      return seq;
    },
    clearTimer(handle) {
      pending.delete(handle);
    },
    /** 推进 ms 毫秒，按到期时间顺序执行所有到期回调 */
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let nextId = null;
        let nextAt = Infinity;
        for (const [id, entry] of pending) {
          if (entry.at <= target && entry.at < nextAt) {
            nextAt = entry.at;
            nextId = id;
          }
        }
        if (nextId === null) break;
        const entry = pending.get(nextId);
        pending.delete(nextId);
        now = entry.at;
        entry.callback();
      }
      now = target;
    },
    count() {
      return pending.size;
    },
  };
}

function createHarness({ hidden = false, intervalMs = 9000, turnMs = 420 } = {}) {
  const timers = createFakeTimers();
  const states = [];
  let hiddenNow = hidden;
  const scheduler = createIdleQuipScheduler({
    onState: (state) => states.push(state),
    setTimer: (callback, delayMs) => timers.setTimer(callback, delayMs),
    clearTimer: (handle) => timers.clearTimer(handle),
    isHidden: () => hiddenNow,
    intervalMs,
    turnMs,
  });
  return {
    scheduler,
    timers,
    states,
    setHidden: (value) => {
      hiddenNow = value;
    },
    last: () => states[states.length - 1],
  };
}

test('空闲轮播调度器', async (t) => {
  await t.test('1. 一个间隔后换句：tick+1 且 turning=true', () => {
    const h = createHarness();
    h.scheduler.start();
    assert.equal(h.timers.count(), 1, '启动后只允许一条换句定时器');
    h.timers.advance(9000);
    assert.deepEqual(h.last(), { tick: 1, turning: true }, '到点必须换句并起手侧头');
  });

  await t.test('2. 侧头窗口结束后 turning 归位，tick 不回退', () => {
    const h = createHarness();
    h.scheduler.start();
    h.timers.advance(9000);
    h.timers.advance(420);
    assert.deepEqual(h.last(), { tick: 1, turning: false }, '侧头结束必须只清 turning');
  });

  await t.test('3. 连续推进多个间隔：tick 单调递增，且不会双倍速', () => {
    const h = createHarness();
    h.scheduler.start();
    h.timers.advance(9000 * 3 + 420);
    assert.equal(h.scheduler.current().tick, 3, '三个间隔必须正好换三句（双排程会变成 5 句以上）');
    // 双排程的典型症状：每拍产生两条链，tick 增速超过 1/间隔
    assert.ok(h.timers.count() <= 1, `残留定时器 ${h.timers.count()} 条，必须至多 1 条`);
  });

  await t.test('4. 页面隐藏必须停表：不再换句，且不留任何定时器', () => {
    const h = createHarness();
    h.scheduler.start();
    h.setHidden(true);
    h.scheduler.visibilityChanged(true);
    assert.equal(h.timers.count(), 0, '隐藏后必须清空所有定时器（否则后台每 9s 醒一次 CPU）');
    h.timers.advance(9000 * 5);
    assert.equal(h.scheduler.current().tick, 0, '隐藏期间不得推进 tick');
  });

  await t.test('5. 隐藏时正处于侧头窗口：turning 必须立刻归位', () => {
    const h = createHarness();
    h.scheduler.start();
    h.timers.advance(9000);
    assert.equal(h.scheduler.current().turning, true);
    h.setHidden(true);
    h.scheduler.visibilityChanged(true);
    assert.deepEqual(h.scheduler.current(), { tick: 1, turning: false }, '隐藏时必须复位 turning');
    assert.equal(h.timers.count(), 0);
  });

  await t.test('6. 回到前台重排，不补播隐藏期间的节拍', () => {
    const h = createHarness();
    h.scheduler.start();
    h.setHidden(true);
    h.scheduler.visibilityChanged(true);
    h.timers.advance(9000 * 10);
    h.setHidden(false);
    h.scheduler.visibilityChanged(false);
    assert.equal(h.timers.count(), 1, '回到前台必须只排一条链');
    h.timers.advance(9000);
    assert.equal(h.scheduler.current().tick, 1, '隐藏期间的 10 个间隔不得补播');
  });

  await t.test('7. stop() 清空定时器并复位（否则落回 idle 时第一句从中间开始）', () => {
    const h = createHarness();
    h.scheduler.start();
    h.timers.advance(9000 * 2 + 420);
    assert.equal(h.scheduler.current().tick, 2);
    h.scheduler.stop();
    assert.equal(h.timers.count(), 0, 'stop 必须清空定时器');
    assert.deepEqual(h.scheduler.current(), IDLE_QUIP_REST, 'stop 必须复位 tick 与 turning');
    h.timers.advance(9000 * 3);
    assert.deepEqual(h.scheduler.current(), IDLE_QUIP_REST, 'stop 之后不得再产生回调');
  });

  await t.test('8. start() 幂等：重复调用不产生第二条定时器链', () => {
    const h = createHarness();
    h.scheduler.start();
    h.scheduler.start();
    h.scheduler.start();
    assert.equal(h.timers.count(), 1, '重复 start 不得叠加定时器');
    h.timers.advance(9000);
    assert.equal(h.scheduler.current().tick, 1, '重复 start 后增速必须仍是每间隔 1 句');
  });

  await t.test('9. 启动时已隐藏：不排任何定时器（避免后台窗口被唤醒）', () => {
    const h = createHarness({ hidden: true });
    h.scheduler.start();
    assert.equal(h.timers.count(), 0, '隐藏态启动不得排程');
    h.timers.advance(9000 * 3);
    assert.equal(h.scheduler.current().tick, 0);
  });

  await t.test('10. 未 start 时的 visibilityChanged 不得启动排程（状态机不允许侧门）', () => {
    const h = createHarness();
    h.scheduler.visibilityChanged(false);
    assert.equal(h.timers.count(), 0, '未 start 前不得被 visibilityChanged 启动');
  });

  await t.test('11. 隐藏态启动 → 转可见必须恢复排程（否则永久静止）', () => {
    const h = createHarness({ hidden: true });
    h.scheduler.start();
    assert.equal(h.timers.count(), 0, '隐藏态启动不排程');
    /*
     * 【真实缺陷回归】若 `start()` 里写 `running = !isHidden()`（而不是只置 running），
     *   那么「隐藏时进入 idle、之后切回前台」的路径会永久静止：
     *   用户切回来看到的是一个不再换句、也不侧头的死头像。visibilityChanged 依赖 running 为真，
     *   所以这条组合必须单独守住。
     */
    h.setHidden(false);
    h.scheduler.visibilityChanged(false);
    assert.equal(h.timers.count(), 1, '转可见后必须恢复一条换句定时器');
    h.timers.advance(9000);
    assert.equal(h.scheduler.current().tick, 1, '转可见后必须能真正推进');
  });
});
