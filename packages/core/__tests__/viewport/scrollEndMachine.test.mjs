/**
 * 「回到底部」纯状态机单测。
 *
 * 【断言与杀伤力】
 *   1. 显隐只认离底距离与强制门，不看平滑会话状态；
 *   2. 平滑会话必须靠无 2px 收敛 / scrollend / 超时结束，48px 不能提前终止；
 *   3. 旧 ticket 的帧与超时必须被忽略；
 *   4. 切会话 / 断连绝不输出 instant，用户打断必须输出 instant；
 *   5. scrollHeight 增长后续滚必须刷新目标并复用同一 ticket。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCROLL_TO_END_ARRIVE_TOLERANCE_PX,
  SCROLL_TO_END_TIMEOUT_MS,
  computeDistanceToBottom,
  decideScrollEndVisibility,
  reduceSmoothScrollSession,
} from '../../dist/index.js';

const IDLE = { status: 'idle' };

function running(ticket = 1, startedAtMs = 0, targetScrollHeight = 5000) {
  return { status: 'running', ticket, startedAtMs, targetScrollHeight, settledCloseFrames: 0 };
}

function options(thresholdPx = 48) {
  let ticket = 0;
  return {
    thresholdPx,
    nextTicket: () => {
      ticket += 1;
      return ticket;
    },
  };
}

function geometry(distance, scrollHeight = 5000, clientHeight = 600) {
  return { scrollHeight, clientHeight, scrollTop: scrollHeight - clientHeight - distance };
}

test('computeDistanceToBottom: 负数钳 0，非法值回落 0', () => {
  assert.equal(computeDistanceToBottom({ scrollHeight: 1000, clientHeight: 600, scrollTop: 400 }), 0);
  assert.equal(computeDistanceToBottom({ scrollHeight: 1000, clientHeight: 600, scrollTop: 900 }), 0);
  assert.equal(computeDistanceToBottom({ scrollHeight: Number.NaN, clientHeight: 600, scrollTop: 0 }), 0);
  assert.equal(computeDistanceToBottom({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 }), 400);
});

test('decideScrollEndVisibility: 门控与 48px 边界', async (t) => {
  const base = { gatewayConnected: true, enterPending: false, initialBottomSettling: false, thresholdPx: 48 };

  await t.test('1. 断连 / 进入期 / 落定期 / 强制隐藏一律不可见', () => {
    assert.equal(decideScrollEndVisibility({ ...base, gatewayConnected: false, ...geometry(500) }), false);
    assert.equal(decideScrollEndVisibility({ ...base, enterPending: true, ...geometry(500) }), false);
    assert.equal(decideScrollEndVisibility({ ...base, initialBottomSettling: true, ...geometry(500) }), false);
    assert.equal(decideScrollEndVisibility({ ...base, force: 'hidden', ...geometry(500) }), false);
  });

  await t.test('2. 48 / 49 边界', () => {
    assert.equal(decideScrollEndVisibility({ ...base, ...geometry(48) }), false, '48 视为贴底，不显示');
    assert.equal(decideScrollEndVisibility({ ...base, ...geometry(49) }), true, '49 必须显示');
    assert.equal(decideScrollEndVisibility({ ...base, ...geometry(0) }), false);
  });
});

test('reduceSmoothScrollSession: 点击与收敛', async (t) => {
  await t.test('1. 已贴底点击：不启动平滑', () => {
    const result = reduceSmoothScrollSession(IDLE, {
      type: 'CLICK', nowMs: 0, ...geometry(SCROLL_TO_END_ARRIVE_TOLERANCE_PX),
    }, options());
    assert.deepEqual(result.state, IDLE);
    assert.deepEqual(result.effect, { kind: 'stop', mode: 'none' });
  });

  await t.test('2. 远离底部点击：启动并分配 ticket', () => {
    const result = reduceSmoothScrollSession(IDLE, { type: 'CLICK', nowMs: 10, ...geometry(2000) }, options());
    assert.equal(result.state.status, 'running');
    assert.equal(result.state.ticket, 1);
    assert.deepEqual(result.effect, { kind: 'smooth-to', scrollHeight: 5000, ticket: 1 });
  });

  await t.test('3. 到达 <= 2px 需连续 2 帧才收敛', () => {
    let state = running();
    const first = reduceSmoothScrollSession(state, {
      type: 'FRAME', ticket: 1, nowMs: 20, ...geometry(1),
    }, options());
    assert.equal(first.state.status, 'running');
    assert.equal(first.state.settledCloseFrames, 1);

    state = first.state;
    const second = reduceSmoothScrollSession(state, {
      type: 'FRAME', ticket: 1, nowMs: 30, ...geometry(0),
    }, options());
    assert.deepEqual(second.state, IDLE);
    assert.deepEqual(second.effect, { kind: 'stop', mode: 'none' });
  });

  await t.test('4. 48px 内但 > 2px：不得提前结束', () => {
    const result = reduceSmoothScrollSession(running(), {
      type: 'FRAME', ticket: 1, nowMs: 20, ...geometry(40),
    }, options());
    assert.equal(result.state.status, 'running');
    assert.deepEqual(result.effect, { kind: 'none' });
  });

  await t.test('5. 旧 ticket 的帧必须被忽略', () => {
    const result = reduceSmoothScrollSession(running(2), {
      type: 'FRAME', ticket: 1, nowMs: 20, ...geometry(0),
    }, options());
    assert.equal(result.state.status, 'running');
    assert.deepEqual(result.effect, { kind: 'none' });
  });

  await t.test('6. scrollHeight 增长且距底 > 阈值：续滚到新底并复用 ticket', () => {
    const result = reduceSmoothScrollSession(running(1, 0, 5000), {
      type: 'FRAME', ticket: 1, nowMs: 100, ...geometry(3000, 8000),
    }, options());
    assert.equal(result.state.status, 'running');
    assert.equal(result.state.targetScrollHeight, 8000);
    assert.deepEqual(result.effect, { kind: 'smooth-to', scrollHeight: 8000, ticket: 1 });
  });

  await t.test('7. 帧推进超过 1200ms：收敛兜底', () => {
    const result = reduceSmoothScrollSession(running(1, 0), {
      type: 'FRAME', ticket: 1, nowMs: SCROLL_TO_END_TIMEOUT_MS, ...geometry(300),
    }, options());
    assert.deepEqual(result.state, IDLE);
    assert.deepEqual(result.effect, { kind: 'stop', mode: 'converge-to-bottom' });
  });
});

test('reduceSmoothScrollSession: scrollend / timeout / 打断 / 切会话', async (t) => {
  await t.test('1. scrollend 到达：直接收敛', () => {
    const result = reduceSmoothScrollSession(running(), {
      type: 'SCROLLEND', ticket: 1, nowMs: 200, ...geometry(0),
    }, options());
    assert.deepEqual(result.state, IDLE);
    assert.deepEqual(result.effect, { kind: 'stop', mode: 'none' });
  });

  await t.test('2. scrollend 距底 > 阈值：续滚', () => {
    const result = reduceSmoothScrollSession(running(1, 0, 5000), {
      type: 'SCROLLEND', ticket: 1, nowMs: 200, ...geometry(200, 6000),
    }, options());
    assert.equal(result.state.status, 'running');
    assert.deepEqual(result.effect, { kind: 'smooth-to', scrollHeight: 6000, ticket: 1 });
  });

  await t.test('3. scrollend 落在 2~48px：即时补齐残差', () => {
    const result = reduceSmoothScrollSession(running(), {
      type: 'SCROLLEND', ticket: 1, nowMs: 200, ...geometry(30),
    }, options());
    assert.deepEqual(result.state, IDLE);
    assert.deepEqual(result.effect, { kind: 'stop', mode: 'converge-to-bottom' });
  });

  await t.test('4. 用户打断：必须写 instant', () => {
    const result = reduceSmoothScrollSession(running(), { type: 'USER_INTERRUPT' }, options());
    assert.deepEqual(result.state, IDLE);
    assert.deepEqual(result.effect, { kind: 'stop', mode: 'instant-at-current' });
  });

  await t.test('5. 切会话 / 断连：绝不写 instant', () => {
    for (const type of ['SESSION_ENTER', 'DISCONNECT']) {
      const result = reduceSmoothScrollSession(running(), { type }, options());
      assert.deepEqual(result.state, IDLE);
      assert.deepEqual(result.effect, { kind: 'stop', mode: 'none' }, `${type} 不得写 instant`);
    }
  });

  await t.test('6. timeout 事件：距底 > 2px 时补齐', () => {
    const far = reduceSmoothScrollSession(running(), {
      type: 'TIMEOUT', ticket: 1, ...geometry(100),
    }, options());
    assert.deepEqual(far.effect, { kind: 'stop', mode: 'converge-to-bottom' });

    const near = reduceSmoothScrollSession(running(), {
      type: 'TIMEOUT', ticket: 1, ...geometry(0),
    }, options());
    assert.deepEqual(near.effect, { kind: 'stop', mode: 'none' });
  });
});
