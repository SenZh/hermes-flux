/**
 * 动态心跳滑动看门狗 (SlidingActiveWatchdog) 行为与时序测试
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { SlidingActiveWatchdog } from '../../dist/turn/slidingWatchdog.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('SlidingActiveWatchdog Unit & Timing Tests', async (t) => {
  await t.test('1. arm 后进入 armed 状态，disarm 优雅关闭', () => {
    let timeoutReason = null;
    const watchdog = new SlidingActiveWatchdog({
      idleTimeoutMs: 100,
      onTimeout: (r) => { timeoutReason = r; },
    });

    assert.equal(watchdog.getState(), 'idle');
    assert.equal(watchdog.getElapsedMs(), 0);
    assert.equal(watchdog.getIdleElapsedMs(), 0);
    assert.equal(watchdog.feed(), false, '未 armed 状态下喂狗返回 false');

    watchdog.arm();
    assert.equal(watchdog.getState(), 'armed');
    assert.ok(watchdog.getElapsedMs() >= 0);
    assert.ok(watchdog.getIdleElapsedMs() >= 0);

    watchdog.disarm();
    assert.equal(watchdog.getState(), 'disarmed');
    assert.equal(timeoutReason, null);
  });

  await t.test('2. 静默超时触发 inactivity 熔断', async () => {
    let timeoutReason = null;
    const watchdog = new SlidingActiveWatchdog({
      idleTimeoutMs: 50,
      hardLimitMs: 500,
      throttleMs: 10,
      onTimeout: (r) => { timeoutReason = r; },
    });

    watchdog.arm();
    await sleep(80);

    assert.equal(watchdog.getState(), 'expired');
    assert.equal(timeoutReason, 'inactivity');
    assert.equal(watchdog.feed(), false, '已 expired 状态下喂狗返回 false');
  });

  await t.test('3. 持续活跃喂狗可连续续期不中断（含 throttle 节流分支覆盖）', async () => {
    let timeoutReason = null;
    const watchdog = new SlidingActiveWatchdog({
      idleTimeoutMs: 60,
      hardLimitMs: 500,
      throttleMs: 30, // 30ms 节流
      onTimeout: (r) => { timeoutReason = r; },
    });

    watchdog.arm();
    // 连续两次立即喂狗，命中 throttleMs 分支
    const feed1 = watchdog.feed();
    const feed2 = watchdog.feed();
    assert.equal(feed1, true);
    assert.equal(feed2, true);

    // 每 20ms 喂一次狗，持续 120ms (远超过 60ms 的单次超时)
    for (let i = 0; i < 4; i++) {
      await sleep(20);
      watchdog.feed();
      assert.equal(watchdog.getState(), 'armed');
    }

    assert.equal(timeoutReason, null, '喂狗保活期间不得超时');
    watchdog.disarm();
  });

  await t.test('4. 达到绝对硬上限时强制触发 hard-limit 熔断', async () => {
    let timeoutReason = null;
    const watchdog = new SlidingActiveWatchdog({
      idleTimeoutMs: 60,
      hardLimitMs: 100, // 100ms 硬上限
      throttleMs: 10,
      onTimeout: (r) => { timeoutReason = r; },
    });

    watchdog.arm();
    // 即使一直喂狗，超过 100ms 也必须被硬上限熔断
    for (let i = 0; i < 6; i++) {
      await sleep(20);
      watchdog.feed();
    }

    assert.equal(watchdog.getState(), 'expired');
    assert.equal(timeoutReason, 'hard-limit');
  });

  await t.test('5. 默认参数构造与跨端定时器解耦', () => {
    const watchdog = new SlidingActiveWatchdog({
      onTimeout: () => {},
    });
    assert.equal(watchdog.getState(), 'idle');
    watchdog.arm();
    assert.equal(watchdog.getState(), 'armed');
    watchdog.disarm();
  });

  await t.test('6. 完整参数构造、防御性分支与异常容忍覆盖', () => {
    // 覆盖全量参数传入与极限边界 (53, 54, 55, 56)
    let mockTime = 100000;
    const watchdog = new SlidingActiveWatchdog({
      idleTimeoutMs: 200,
      hardLimitMs: 400,
      throttleMs: 50,
      now: () => ++mockTime,
      onTimeout: () => {},
    });
    assert.equal(watchdog.getState(), 'idle');
    watchdog.arm();
    assert.equal(watchdog.getState(), 'armed');
    assert.ok(watchdog.getElapsedMs() >= 0);

    // 覆盖 disarm 后的 handleTimeout (state !== 'armed')
    watchdog.disarm();
    Reflect.get(watchdog, 'handleTimeout').call(watchdog, 'inactivity');
    assert.equal(watchdog.getState(), 'disarmed');

    // 覆盖边界越界三元分支 (idle < 10, hard < idle, throttle < 0)
    const clampedWatchdog = new SlidingActiveWatchdog({
      idleTimeoutMs: -10,
      hardLimitMs: -50,
      throttleMs: -5,
      now: null,
      onTimeout: () => {},
    });
    assert.equal(clampedWatchdog.getState(), 'idle');
    clampedWatchdog.arm();
    assert.equal(clampedWatchdog.getState(), 'armed');

    // 覆盖 safeUnref 的各级容忍分支
    const safeUnref = Reflect.get(watchdog, 'safeUnref').bind(watchdog);
    safeUnref(null);
    safeUnref({});
    safeUnref({ unref: () => {} });
    assert.doesNotThrow(() => {
      safeUnref({
        unref() {
          throw new Error('mock unref error');
        },
      });
    });
  });
});
