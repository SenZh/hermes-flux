import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionFSM } from '../../dist/motion/MotionFSM.js';

test('MotionFSM：五态生命周期正向完整跃迁', () => {
  const fsm = new MotionFSM('idle');
  assert.equal(fsm.status, 'idle');
  assert.equal(fsm.version, 0);

  // 1. ENTER 跃迁进入 entering，版本自增
  const s1 = fsm.dispatch({ type: 'ENTER' });
  assert.equal(s1.status, 'entering');
  assert.equal(s1.version, 1);
  assert.equal(fsm.status, 'entering');

  // 2. 正常 TRANSITION_END 完成入场
  const s2 = fsm.dispatch({ type: 'TRANSITION_END', version: 1 });
  assert.equal(s2.status, 'entered');
  assert.equal(s2.version, 1);
  assert.equal(fsm.status, 'entered');

  // 3. EXIT 跃迁进入 exiting，版本自增
  const s3 = fsm.dispatch({ type: 'EXIT' });
  assert.equal(s3.status, 'exiting');
  assert.equal(s3.version, 2);
  assert.equal(fsm.status, 'exiting');

  // 4. TIMEOUT_FALLBACK 或 TRANSITION_END 完成退场
  const s4 = fsm.dispatch({ type: 'TRANSITION_END', version: 2 });
  assert.equal(s4.status, 'exited');
  assert.equal(s4.version, 2);
  assert.equal(fsm.status, 'exited');
});

test('MotionFSM：单调递增 Version CAS 机制与 Flapping 防抖（变异杀伤力断言）', () => {
  const fsm = new MotionFSM('idle');

  // 第一轮：进入并收敛
  fsm.dispatch({ type: 'ENTER' }); // version: 1
  fsm.dispatch({ type: 'TRANSITION_END', version: 1 }); // entered

  // 第二轮：触发退出
  const exitState = fsm.dispatch({ type: 'EXIT' }); // version: 2, status: exiting
  assert.equal(exitState.status, 'exiting');
  assert.equal(exitState.version, 2);

  // 模拟竞态打断：退场中途快速再次点击唤起 ENTER
  const reEnterState = fsm.dispatch({ type: 'ENTER' }); // version: 3, status: entering
  assert.equal(reEnterState.status, 'entering');
  assert.equal(reEnterState.version, 3);

  // 关键变异断言：旧版本 (version: 2) 的迟滞退场定时器触发，必须被 CAS 拦截，严禁杀死当前 entering
  const staleExitResult = fsm.dispatch({ type: 'TIMEOUT_FALLBACK', version: 2 });
  assert.equal(staleExitResult.status, 'entering', '旧版本退场回调必须被 CAS 静默过滤，不得篡改状态');
  assert.equal(fsm.status, 'entering');
  assert.equal(fsm.version, 3);

  // 正确版本收敛：version: 3 正常进入 entered
  const finalState = fsm.dispatch({ type: 'TRANSITION_END', version: 3 });
  assert.equal(finalState.status, 'entered');
  assert.equal(finalState.version, 3);
});

test('MotionFSM：非法转移守卫与幂等性', () => {
  const fsm = new MotionFSM('entered', 5);

  // 已处于 entered，重复 ENTER 保持幂等，版本不虚增
  const enterAgain = fsm.dispatch({ type: 'ENTER' });
  assert.equal(enterAgain.status, 'entered');
  assert.equal(enterAgain.version, 5);

  // 从 exited 状态重复 EXIT 保持幂等
  const fsmExited = new MotionFSM('exited', 1);
  const exitAgain = fsmExited.dispatch({ type: 'EXIT' });
  assert.equal(exitAgain.status, 'exited');
  assert.equal(exitAgain.version, 1);
});

test('MotionFSM：监听器精准通知与安全注销', () => {
  const fsm = new MotionFSM('idle');
  const recorded = [];

  const unsubscribe = fsm.subscribe((state) => {
    recorded.push({ status: state.status, version: state.version });
  });

  fsm.dispatch({ type: 'ENTER' });
  fsm.dispatch({ type: 'TRANSITION_END', version: 1 });
  unsubscribe();

  // 注销后不再收到通知
  fsm.dispatch({ type: 'EXIT' });

  assert.deepEqual(recorded, [
    { status: 'entering', version: 1 },
    { status: 'entered', version: 1 },
  ]);
});
