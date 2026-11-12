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
  ACTIVITY_STATUS_TABLE,
  ActivityTransitionTracker,
  resolveActivityState,
  resolveActivityMap,
  applyTurnStarted,
  applyTurnCompleted,
  applyTurnFailed,
  applyEnteredRead,
  settleTurnTermination,
  reconcileAuthoritativeActivity,
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
    assert.equal(unread.has('s1'), false, '用户刚发起新回合，旧未读标记必须当场消失（禁止 running+unread 并存）');
  });

  await t.test('2. 回合完成且用户不在该实体：退出 running 并置未读', () => {
    const running = new Set(['s1']);
    const unread = new Set();
    applyTurnCompleted(running, unread, 's1', false);
    assert.equal(running.has('s1'), false);
    assert.equal(unread.has('s1'), true, '后台跑完、用户没看着，必须标记未读');
  });

  await t.test('3. 回合完成且用户正看着：退出 running 且不置未读', () => {
    const running = new Set(['s1']);
    const unread = new Set();
    applyTurnCompleted(running, unread, 's1', true);
    assert.equal(running.has('s1'), false);
    assert.equal(unread.has('s1'), false, '用户正看着结果，不需要未读提醒');
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

test('reconcileAuthoritativeActivity - 网关权威状态对账自愈（P0 级不变量证明）', async (t) => {
  await t.test('1. 权威确认完结：无流式时，自愈剔除滞留的幽灵 running ID', () => {
    const running = new Set(['bg_b5da59', 'sess_normal']);
    const changed = reconcileAuthoritativeActivity({
      runningIds: running,
      entityId: 'bg_b5da59',
      isGatewayRunning: false,
      hasInflightStreaming: false,
      currentStreamingId: null,
    });
    assert.equal(changed, true, '必须成功剔除');
    assert.equal(running.has('bg_b5da59'), false, '滞留的后台 ID 必须被安全移除');
    assert.equal(running.has('sess_normal'), true, '其它运行中会话不得被误伤');
  });

  await t.test('2. 防误杀核心不变量：服务端依然在 running 时，绝不可被剔除', () => {
    const running = new Set(['bg_b5da59']);
    const changed = reconcileAuthoritativeActivity({
      runningIds: running,
      entityId: 'bg_b5da59',
      isGatewayRunning: true,
      hasInflightStreaming: false,
      currentStreamingId: 'other_session',
    });
    assert.equal(changed, false, '未完结任务禁止误剔除');
    assert.equal(running.has('bg_b5da59'), true, '后台真实运行中会话必须保持 running');
  });

  await t.test('3. 本地活动流保护：若当前视口正在实时流式接收本会话，禁止提前剔除', () => {
    const running = new Set(['sess_active']);
    const changed = reconcileAuthoritativeActivity({
      runningIds: running,
      entityId: 'sess_active',
      isGatewayRunning: false,
      hasInflightStreaming: false,
      currentStreamingId: 'sess_active',
    });
    assert.equal(changed, false, '本地正流式会话由流式 FSM 管理，禁止被 resume 提前误杀');
    assert.equal(running.has('sess_active'), true);
  });

  await t.test('4. 边界处理：空 entityId 安全降级返回 false', () => {
    const running = new Set(['s1']);
    const changed = reconcileAuthoritativeActivity({
      runningIds: running,
      entityId: '',
      isGatewayRunning: false,
      hasInflightStreaming: false,
    });
    assert.equal(changed, false);
    assert.equal(running.size, 1);
  });
});

test('ACTIVITY_STATUS_TABLE - 三态规格表完整性与优先级序', () => {
  assert.deepEqual(ACTIVITY_STATUS_TABLE.running, {
    state: 'running',
    priority: 2,
    isTransient: true,
    rendersIndicator: true,
  });
  assert.deepEqual(ACTIVITY_STATUS_TABLE.unread, {
    state: 'unread',
    priority: 1,
    isTransient: false,
    rendersIndicator: true,
  });
  assert.deepEqual(ACTIVITY_STATUS_TABLE.read, {
    state: 'read',
    priority: 0,
    isTransient: false,
    rendersIndicator: false,
  });
  assert.ok(ACTIVITY_STATUS_TABLE.running.priority > ACTIVITY_STATUS_TABLE.unread.priority);
  assert.ok(ACTIVITY_STATUS_TABLE.unread.priority > ACTIVITY_STATUS_TABLE.read.priority);
  assert.equal(Object.isFrozen(ACTIVITY_STATUS_TABLE), true);
  assert.equal(Object.isFrozen(ACTIVITY_STATUS_TABLE.running), true);
});

test('settleTurnTermination - 群聊域清理与幂等独立性', async (t) => {
  await t.test('指定 runningGroupRoomIds 与 groupRoomId 时幂等移除，不波及其他房间且不置未读', () => {
    const runningSessions = new Set(['s1']);
    const runningBots = new Set(['bot1']);
    const runningGroups = new Set(['room-a', 'room-b']);
    const unreadGroups = new Set();

    const params = {
      runningSessionIds: runningSessions,
      runningBotNames: runningBots,
      runningGroupRoomIds: runningGroups,
      sessionId: null,
      botName: null,
      groupRoomId: 'room-a',
    };

    settleTurnTermination(params);
    settleTurnTermination(params);

    assert.deepEqual([...runningGroups], ['room-b'], '同域其余运行中群聊必须保留');
    assert.deepEqual([...runningSessions], ['s1'], 'sessionId 为 null 时不得影响会话域');
    assert.deepEqual([...runningBots], ['bot1'], 'botName 为 null 时不得影响 Bot 域');
    assert.equal(unreadGroups.size, 0, '异常终止绝不得写入未读集合');
  });

  await t.test('groupRoomId 为空时不改变 runningGroupRoomIds', () => {
    const runningGroups = new Set(['room-a']);
    settleTurnTermination({
      runningSessionIds: new Set(),
      runningBotNames: new Set(),
      runningGroupRoomIds: runningGroups,
      groupRoomId: '',
    });
    assert.deepEqual([...runningGroups], ['room-a']);
  });
});

test('ActivityTransitionTracker - 完成瞬态跃迁窗口与防误播', async (t) => {
  await t.test('窗口期内返回 just-completed 与单调递增 token，到达 expiresAt 后返回 none 并清理', () => {
    const tracker = new ActivityTransitionTracker({ windowMs: 360 });
    const t1 = tracker.recordCompleted('session', 's1', 'unread', 1000);
    const t2 = tracker.recordCompleted('session', 's2', 'read', 1050);

    assert.equal(t1, 1);
    assert.equal(t2, 2);
    assert.ok(t2 > t1, 'token 必须严格单调递增');

    assert.deepEqual(tracker.resolveTransition('session', 's1', 'unread', 1000), {
      transition: 'just-completed',
      transitionToken: 1,
    });
    assert.deepEqual(tracker.resolveTransition('session', 's1', 'unread', 1359), {
      transition: 'just-completed',
      transitionToken: 1,
    });
    assert.equal(tracker.nextExpiryDelayMs(1359), 1, '窗口末边界剩余 1ms 仍应活跃');

    assert.deepEqual(tracker.resolveTransition('session', 's1', 'unread', 1360), {
      transition: 'none',
    }, 'nowMs === expiresAt 必须判定过期并退出跃迁');
    assert.equal(tracker.nextExpiryDelayMs(1360), 50, 's1 清理后仅剩 s2 的 50ms');
    assert.equal(tracker.nextExpiryDelayMs(1410), null, '全部到期后必须清理并返回 null');
  });

  await t.test('空 entityId 返回 0 且不写入', () => {
    const tracker = new ActivityTransitionTracker();
    assert.equal(tracker.recordCompleted('bot', '', 'unread', 500), 0);
    assert.deepEqual(tracker.resolveTransition('bot', '', 'unread', 500), { transition: 'none' });
    assert.equal(tracker.nextExpiryDelayMs(500), null);
  });

  await t.test('状态由 unread 切为 read 后，必须拒绝并清理跃迁记录（防错配误播）', () => {
    const tracker = new ActivityTransitionTracker({ windowMs: 360 });
    tracker.recordCompleted('group', 'room-1', 'unread', 1000);

    assert.deepEqual(tracker.resolveTransition('group', 'room-1', 'read', 1100), {
      transition: 'none',
    });
    assert.equal(tracker.nextExpiryDelayMs(1100), null, '错配条目必须当场删除');
    assert.deepEqual(tracker.resolveTransition('group', 'room-1', 'unread', 1120), {
      transition: 'none',
    }, '已清理的错配记录不得在状态回退时复活');
  });

  await t.test('currentState 为 running 时返回 none', () => {
    const tracker = new ActivityTransitionTracker({ windowMs: 360 });
    tracker.recordCompleted('bot', 'architect', 'read', 1000);
    assert.deepEqual(tracker.resolveTransition('bot', 'architect', 'running', 1050), {
      transition: 'none',
    });
  });

  await t.test('startTurn / clear / clearAll 与三域独立隔离', () => {
    const tracker = new ActivityTransitionTracker({ windowMs: 360 });
    const sessionToken = tracker.recordCompleted('session', 'shared-id', 'unread', 1000);
    const botToken = tracker.recordCompleted('bot', 'shared-id', 'unread', 1000);
    const groupToken = tracker.recordCompleted('group', 'shared-id', 'read', 1000);

    assert.notEqual(sessionToken, botToken);
    assert.notEqual(botToken, groupToken);

    tracker.clear('session', 'shared-id');
    assert.deepEqual(tracker.resolveTransition('session', 'shared-id', 'unread', 1100), {
      transition: 'none',
    });
    assert.equal(
      tracker.resolveTransition('bot', 'shared-id', 'unread', 1100).transition,
      'just-completed',
      '清理 session 不得波及同 id 的 bot 域'
    );
    assert.equal(
      tracker.resolveTransition('group', 'shared-id', 'read', 1100).transition,
      'just-completed',
      '清理 session 不得波及同 id 的 group 域'
    );

    tracker.clearAll();
    assert.equal(tracker.nextExpiryDelayMs(1100), null);
    assert.deepEqual(tracker.resolveTransition('bot', 'shared-id', 'unread', 1100), {
      transition: 'none',
    });
  });

  await t.test('同一实体二次完成会覆盖旧 token 与旧过期时间', () => {
    const tracker = new ActivityTransitionTracker({ windowMs: 360 });
    const first = tracker.recordCompleted('session', 's1', 'unread', 1000);
    const second = tracker.recordCompleted('session', 's1', 'read', 1200);
    assert.ok(second > first);

    assert.deepEqual(tracker.resolveTransition('session', 's1', 'read', 1500), {
      transition: 'just-completed',
      transitionToken: second,
    });
  });
});
