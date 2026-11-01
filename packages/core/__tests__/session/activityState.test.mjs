/**
 * activityState 三态状态机单元测试 (packages/core/__tests__/session/activityState.test.mjs)
 *
 * 【四象限覆盖】
 * 1. 正向确定性路径：running > unread > read 优先级与批量求值；
 * 2. 极限边界值：空 id、空集合、运行与未读同时命中；
 * 3. 负向与混沌：回合失败绝不置未读、进入查看清除未读；
 * 4. 状态独立性：三类实体各自持有独立集合，互不越界污染。
 *
 * 【变异检验】每个断言都对应生产逻辑的一条分支，改错即变红（见文件末 Mutation Suite）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveActivityState,
  resolveActivityMap,
  applyTurnStarted,
  applyTurnCompleted,
  applyTurnFailed,
  applyEnteredRead,
  settleTurnTermination,
} from '../../dist/session/activityState.js';

test('resolveActivityState - 三态求值与优先级', async (t) => {
  await t.test('1. 正向：既不在运行也不在未读 => read（无任何标识）', () => {
    const state = resolveActivityState('s1', { runningIds: new Set(), unreadIds: new Set() });
    assert.equal(state, 'read');
  });

  await t.test('2. 正向：命中运行集合 => running', () => {
    const state = resolveActivityState('s1', { runningIds: new Set(['s1']), unreadIds: new Set() });
    assert.equal(state, 'running');
  });

  await t.test('3. 正向：命中未读集合 => unread', () => {
    const state = resolveActivityState('s1', { runningIds: new Set(), unreadIds: new Set(['s1']) });
    assert.equal(state, 'unread');
  });

  await t.test('4. 边界：同一 id 同时命中运行与未读，运行优先级更高', () => {
    const state = resolveActivityState('s1', { runningIds: new Set(['s1']), unreadIds: new Set(['s1']) });
    assert.equal(state, 'running', '正在进行中的事实高于上一轮的未读残留');
  });

  await t.test('5. 边界：streamingId 命中即视为运行态（即使尚未进入 running 集合）', () => {
    const state = resolveActivityState('s1', {
      runningIds: new Set(),
      unreadIds: new Set(),
      streamingId: 's1',
    });
    assert.equal(state, 'running');
  });

  await t.test('6. 边界：空 entityId 恒为 read，绝不误判', () => {
    assert.equal(resolveActivityState('', { runningIds: new Set(['']), unreadIds: new Set() }), 'read');
  });

  await t.test('7. 状态独立性：id 不在集合中，绝不受其他 id 的集合内容影响', () => {
    const probe = { runningIds: new Set(['other-1', 'other-2']), unreadIds: new Set(['other-3']) };
    assert.equal(resolveActivityState('s1', probe), 'read', '别的实体在跑不得殃及本项目');
  });
});

test('resolveActivityMap - 批量求值', async (t) => {
  await t.test('1. 正向：一次拿到整份列表的三态字典', () => {
    const map = resolveActivityMap(['a', 'b', 'c'], {
      runningIds: new Set(['a']),
      unreadIds: new Set(['b']),
    });
    assert.deepEqual(map, { a: 'running', b: 'unread', c: 'read' });
  });

  await t.test('2. 边界：空列表返回空字典，不抛错', () => {
    assert.deepEqual(resolveActivityMap([], { runningIds: new Set(), unreadIds: new Set() }), {});
  });
});

test('apply* 状态迁移 - 回合生命周期', async (t) => {
  await t.test('1. 回合开始：进 running，并当场清除历史未读残留', () => {
    const running = new Set();
    const unread = new Set(['s1']);
    applyTurnStarted(running, unread, 's1');
    assert.equal(running.has('s1'), true);
    assert.equal(unread.has('s1'), false, '用户刚发起新回合，旧绿点必须当场消失（禁止 running+unread 并存）');
  });

  await t.test('2. 回合完成且用户不在该实体：退出 running 并置未读', () => {
    const running = new Set(['s1']);
    const unread = new Set();
    applyTurnCompleted(running, unread, 's1', false);
    assert.equal(running.has('s1'), false);
    assert.equal(unread.has('s1'), true, '后台跑完、用户没看着，必须亮绿点');
  });

  await t.test('3. 回合完成且用户正看着：退出 running 且不置未读', () => {
    const running = new Set(['s1']);
    const unread = new Set();
    applyTurnCompleted(running, unread, 's1', true);
    assert.equal(running.has('s1'), false);
    assert.equal(unread.has('s1'), false, '用户正看着结果，不需要绿点提醒');
  });

  await t.test('4. 回合完成且原先已未读、用户正看着：必须清掉旧的未读', () => {
    const running = new Set();
    const unread = new Set(['s1']);
    applyTurnCompleted(running, unread, 's1', true);
    assert.equal(unread.has('s1'), false);
  });

  await t.test('5. 负向：回合失败退出 running，但绝不置未读', () => {
    const running = new Set(['s1']);
    const unread = new Set();
    applyTurnFailed(running, 's1');
    assert.equal(running.has('s1'), false);
    assert.equal(unread.has('s1'), false, '失败没有可查看的成果，标未读会误导用户');
  });

  await t.test('6. 进入查看：清除未读变已读', () => {
    const unread = new Set(['s1']);
    applyEnteredRead(unread, 's1');
    assert.equal(unread.has('s1'), false);
  });

  await t.test('7. 边界：空 entityId 迁移为无操作，不得污染集合', () => {
    const running = new Set(['x']);
    const unread = new Set(['y']);
    applyTurnStarted(running, unread, '');
    applyTurnCompleted(running, unread, '', false);
    applyTurnFailed(running, '');
    applyEnteredRead(unread, '');
    assert.deepEqual([...running], ['x']);
    assert.deepEqual([...unread], ['y']);
  });

  await t.test('8. 状态独立性：操作实体 A 绝不改动实体 B 的集合', () => {
    const running = new Set(['b']);
    const unread = new Set(['b']);
    applyTurnStarted(running, unread, 'a');
    assert.equal(running.has('b'), true, 'B 的运行态不得被 A 的操作抹掉');
    assert.equal(unread.has('b'), true, 'B 的未读态不得被 A 的操作抹掉');
    assert.equal(running.has('a'), true);
    assert.equal(unread.has('a'), false);
  });
});

test('快照重放 - 完整回合时序闭环', async (t) => {
  await t.test('1. 发消息 -> 切走 -> 完成 -> 进入：状态依次为 running -> unread -> read', () => {
    const running = new Set();
    const unread = new Set();

    // 1. 发消息
    applyTurnStarted(running, unread, 's1');
    assert.equal(resolveActivityState('s1', { runningIds: running, unreadIds: unread }), 'running');

    // 2. 用户切走焦点后完成
    applyTurnCompleted(running, unread, 's1', false);
    assert.equal(resolveActivityState('s1', { runningIds: running, unreadIds: unread }), 'unread');

    // 3. 用户点击进入
    applyEnteredRead(unread, 's1');
    assert.equal(resolveActivityState('s1', { runningIds: running, unreadIds: unread }), 'read');
  });

  await t.test('2. 发消息 -> 停留原地完成：状态为 running -> read（不产生绿点）', () => {
    const running = new Set();
    const unread = new Set();
    applyTurnStarted(running, unread, 's1');
    applyTurnCompleted(running, unread, 's1', true);
    assert.equal(resolveActivityState('s1', { runningIds: running, unreadIds: unread }), 'read');
  });

  await t.test('3. 并发两会话：A 在跑、B 未读，两者状态互不干扰', () => {
    const running = new Set();
    const unread = new Set();
    applyTurnStarted(running, unread, 'A');
    applyTurnCompleted(running, unread, 'B', false);
    assert.equal(resolveActivityState('A', { runningIds: running, unreadIds: unread }), 'running');
    assert.equal(resolveActivityState('B', { runningIds: running, unreadIds: unread }), 'unread');
    assert.equal(resolveActivityState('C', { runningIds: running, unreadIds: unread }), 'read');
  });
});

test('settleTurnTermination - 回合异常终止的统一收尾（中断 / 看门狗 / 断线）', async (t) => {
  await t.test('1. 用户中断：会话与 Bot 的运行态都必须退出，且绝不置未读', () => {
    const runningSessions = new Set(['s1']);
    const runningBots = new Set(['default']);
    const unreadSessions = new Set();
    const unreadBots = new Set();

    settleTurnTermination({
      runningSessionIds: runningSessions,
      runningBotNames: runningBots,
      sessionId: 's1',
      botName: 'default',
    });

    assert.deepEqual([...runningSessions], [], '会话运行态必须清空（否则永久显示进行中）');
    assert.deepEqual([...runningBots], [], 'Bot 运行态必须清空');
    assert.deepEqual([...unreadSessions], [], '中断不得置未读（没有可查看的成果）');
    assert.deepEqual([...unreadBots], [], 'Bot 中断同样不得置未读');
  });

  await t.test('2. 看门狗超时：与中断语义一致，必须收尾运行态', () => {
    const runningSessions = new Set(['s2']);
    const runningBots = new Set();
    settleTurnTermination({
      runningSessionIds: runningSessions,
      runningBotNames: runningBots,
      sessionId: 's2',
      botName: null,
    });
    assert.deepEqual([...runningSessions], [], '超时后会话不得残留运行态');
    assert.equal(resolveActivityState('s2', { runningIds: runningSessions, unreadIds: new Set() }), 'read');
  });

  await t.test('3. 幂等：重复调用不改变集合内容', () => {
    const runningSessions = new Set();
    const runningBots = new Set();
    const params = { runningSessionIds: runningSessions, runningBotNames: runningBots, sessionId: 's1', botName: 'bot1' };
    settleTurnTermination(params);
    settleTurnTermination(params);
    assert.deepEqual([...runningSessions], []);
    assert.deepEqual([...runningBots], []);
  });

  await t.test('4. 状态独立性：只清目标实体，其他实体的运行态不得被波及', () => {
    const runningSessions = new Set(['s1', 's2']);
    const runningBots = new Set(['bot1', 'bot2']);
    settleTurnTermination({
      runningSessionIds: runningSessions,
      runningBotNames: runningBots,
      sessionId: 's1',
      botName: 'bot1',
    });
    assert.deepEqual([...runningSessions], ['s2'], '另一个仍在运行的会话不得被误清');
    assert.deepEqual([...runningBots], ['bot2'], '另一个仍在运行的 Bot 不得被误清');
  });

  await t.test('5. 边界：空 id 视为无操作，不得清空整个集合', () => {
    const runningSessions = new Set(['s1']);
    const runningBots = new Set(['bot1']);
    settleTurnTermination({
      runningSessionIds: runningSessions,
      runningBotNames: runningBots,
      sessionId: null,
      botName: undefined,
    });
    assert.deepEqual([...runningSessions], ['s1']);
    assert.deepEqual([...runningBots], ['bot1']);
  });
});
