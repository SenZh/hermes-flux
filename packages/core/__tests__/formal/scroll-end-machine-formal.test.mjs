/**
 * 「回到底部」状态机的形式化不变量。
 *
 * 【守护什么】
 *   1. 显隐裁决只由「离底距离 > 阈值」与四个门控决定，与平滑会话生命周期无关；
 *   2. 切会话 / 断连之后，状态必为 idle，且任何情况都不得输出 instant；
 *   3. 用户打断必输出 instant 并回到 idle；
 *   4. 旧 ticket 的帧/超时不得改写当前会话。
 *
 * 【为什么必须属性测试】阈值边界（48/49）与原生平滑减速末段的交错是连续值域，
 *   示例式单测只能覆盖少数点；一旦把 48px 当成平滑会话终止条件，
 *   用户看到的是「滚到底了按钮还在」或「滚动被莫名停住」。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  decideScrollEndVisibility,
  reduceSmoothScrollSession,
  SCROLL_TO_END_ARRIVE_TOLERANCE_PX,
} from '../../dist/viewport/scrollEndMachine.js';

const GEOMETRY = {
  scrollHeight: fc.integer({ min: 0, max: 200000 }),
  clientHeight: fc.integer({ min: 0, max: 5000 }),
  scrollTop: fc.integer({ min: 0, max: 200000 }),
};

const THRESHOLD = fc.integer({ min: 1, max: 400 });

function reducerOptions(thresholdPx = 48) {
  let ticket = 0;
  return { thresholdPx, nextTicket: () => { ticket += 1; return ticket; } };
}

test('INV-VIEW-05：显隐只由离底距离与门控决定', () => {
  fc.assert(
    fc.property(
      GEOMETRY.scrollHeight,
      GEOMETRY.clientHeight,
      GEOMETRY.scrollTop,
      THRESHOLD,
      (scrollHeight, clientHeight, scrollTop, thresholdPx) => {
        const distance = Math.max(0, scrollHeight - clientHeight - scrollTop);
        const visible = decideScrollEndVisibility({
          gatewayConnected: true,
          enterPending: false,
          initialBottomSettling: false,
          thresholdPx,
          scrollHeight,
          clientHeight,
          scrollTop,
        });
        assert.equal(visible, distance > thresholdPx, '显隐必须严格等价于 distance > threshold');
      },
    ),
    { numRuns: 500 },
  );
});

test('INV-VIEW-06：切会话 / 断连必回 idle，且绝不输出 instant', () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom('SESSION_ENTER', 'DISCONNECT'), { minLength: 1, maxLength: 8 }),
      GEOMETRY.scrollHeight,
      GEOMETRY.clientHeight,
      GEOMETRY.scrollTop,
      (events, scrollHeight, clientHeight, scrollTop) => {
        let state = {
          status: 'running',
          ticket: 1,
          startedAtMs: 0,
          targetScrollHeight: scrollHeight,
          settledCloseFrames: 0,
        };
        for (const type of events) {
          const transition = reduceSmoothScrollSession(
            state,
            { type, scrollHeight, clientHeight, scrollTop },
            reducerOptions(),
          );
          assert.equal(transition.state.status, 'idle', `${type} 后必须回 idle`);
          assert.notEqual(transition.effect.mode, 'instant-at-current', `${type} 不得写 instant`);
          state = transition.state;
        }
      },
    ),
    { numRuns: 300 },
  );
});

test('用户打断必写 instant 并回 idle；<= 2px 才允许结束平滑会话', () => {
  fc.assert(
    fc.property(
      GEOMETRY.scrollHeight,
      GEOMETRY.clientHeight,
      GEOMETRY.scrollTop,
      (scrollHeight, clientHeight, scrollTop) => {
        const current = {
          status: 'running',
          ticket: 7,
          startedAtMs: 0,
          targetScrollHeight: scrollHeight,
          settledCloseFrames: 0,
        };
        const distance = Math.max(0, scrollHeight - clientHeight - scrollTop);

        const interrupted = reduceSmoothScrollSession(current, { type: 'USER_INTERRUPT' }, reducerOptions());
        assert.equal(interrupted.state.status, 'idle');
        assert.equal(interrupted.effect.mode, 'instant-at-current');

        if (distance > SCROLL_TO_END_ARRIVE_TOLERANCE_PX && distance <= 48) {
          const frame = reduceSmoothScrollSession(
            current,
            { type: 'FRAME', ticket: 7, nowMs: 10, scrollHeight, clientHeight, scrollTop },
            reducerOptions(),
          );
          assert.equal(frame.state.status, 'running', '48px 内但 > 2px 不得结束平滑会话');
        }

        const staleFrame = reduceSmoothScrollSession(
          current,
          { type: 'FRAME', ticket: 6, nowMs: 10, scrollHeight, clientHeight, scrollTop },
          reducerOptions(),
        );
        assert.equal(staleFrame.state.status, 'running', '旧 ticket 不得改写当前会话');
        assert.equal(staleFrame.effect.kind, 'none');
      },
    ),
    { numRuns: 300 },
  );
});
