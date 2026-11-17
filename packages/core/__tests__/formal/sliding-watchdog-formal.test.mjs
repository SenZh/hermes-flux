/**
 * 滑动看门狗的形式化不变量（Sliding Active Watchdog）
 *
 * 【守护什么】构造后的四个时序字段必须对任意入参成立：
 *   `idleTimeoutMs >= 10`、`hardLimitMs >= idleTimeoutMs`、`throttleMs >= 0`、
 *   `now` 恒为函数（显式传 null 也必须回落到系统时钟）。
 *
 * 【为什么必须属性测试】这四个值直接决定"回合会不会被提前掐断"或"永远不结束"。
 *   `Object.assign` 合并默认值时，显式 null 会覆盖默认时钟，`arm()` 第一行即抛
 *   `this.now is not a function`，表现为回合刚开始就崩在熔断器自身；
 *   而上下限倒挂会让硬上限早于空闲超时，等于把 30 分钟保险丝缩成几秒。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { SlidingActiveWatchdog } from '../../dist/turn/slidingWatchdog.js';

test('INV-WATCHDOG-01：构造后时序字段恒满足夹取与单调不变量', () => {
  fc.assert(
    fc.property(
      fc.double({ min: -100000, max: 600000, noNaN: true }),
      fc.double({ min: -100000, max: 600000, noNaN: true }),
      fc.double({ min: -5000, max: 5000, noNaN: true }),
      fc.boolean(),
      (idleTimeoutMs, hardLimitMs, throttleMs, injectClock) => {
        const watchdog = new SlidingActiveWatchdog({
          idleTimeoutMs,
          hardLimitMs,
          throttleMs,
          now: injectClock ? () => Date.now() : null,
          onTimeout: () => {},
        });

        const resolvedIdle = Reflect.get(watchdog, 'idleTimeoutMs');
        const resolvedHard = Reflect.get(watchdog, 'hardLimitMs');
        const resolvedThrottle = Reflect.get(watchdog, 'throttleMs');
        const resolvedNow = Reflect.get(watchdog, 'now');

        assert.ok(resolvedIdle >= 10, `空闲超时 ${resolvedIdle} 小于 10ms，会让正常回合被误杀`);
        assert.ok(resolvedHard >= resolvedIdle, `硬上限 ${resolvedHard} 早于空闲超时 ${resolvedIdle}`);
        assert.ok(resolvedThrottle >= 0, `节流窗口 ${resolvedThrottle} 不得为负`);
        assert.equal(typeof resolvedNow, 'function', '时钟注入为 null 时必须回落到系统时钟');
        assert.equal(watchdog.getState(), 'idle', '构造不得产生任何状态迁移');
      },
    ),
    { numRuns: 300 },
  );
});

test('INV-WATCHDOG-02：未 arm 时喂狗与查询恒为空操作', () => {
  fc.assert(
    fc.property(fc.double({ min: 10, max: 60000, noNaN: true }), (idleTimeoutMs) => {
      const watchdog = new SlidingActiveWatchdog({ idleTimeoutMs, onTimeout: () => {} });

      assert.equal(watchdog.feed(), false, 'idle 态喂狗必须返回 false');
      assert.equal(watchdog.getElapsedMs(), 0, 'idle 态已运行时长恒为 0');
      assert.equal(watchdog.getIdleElapsedMs(), 0, 'idle 态空闲时长恒为 0');

      watchdog.disarm();
      assert.equal(watchdog.getState(), 'disarmed');
      assert.equal(watchdog.feed(), false, 'disarmed 态喂狗不得复活看门狗');
    }),
    { numRuns: 150 },
  );
});
