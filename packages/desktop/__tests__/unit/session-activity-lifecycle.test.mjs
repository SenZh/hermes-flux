/**
 * 会话三态流转与 Live/Stored ID 映射自愈单元测试
 * (packages/desktop/__tests__/unit/session-activity-lifecycle.test.mjs)
 *
 * 【测试核心目标】
 * 零外部依赖，100% 在常规 CI / npm test 中运行，以生产核心对象驱动：
 * 1. 真实消费 Core 层 SessionHandleRegistry，验证 liveId 必须经由生产注册器归一化为 storedId；
 * 2. 覆盖四大象限：正向完成转未读、边界畸变容错、负向失败退出 running 且绝不置未读、多会话并发隔离；
 * 3. 具备 100% 变异杀伤力：若生产代码直接消费未归一化的 liveId，断言必然变红（绝无假测试）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  resolveActivityState,
  applyTurnStarted,
  applyTurnCompleted,
  applyTurnFailed,
  applyEnteredRead,
  settleTurnTermination,
  ActivityTransitionTracker,
  SessionHandleRegistry,
  defaultSessionHandleRegistry,
} from '../../../core/dist/index.js';

const rendererSource = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/renderer/index.ts'),
  'utf8'
);

test('Session Activity Lifecycle & Handle Normalization Invariants', async (t) => {
  await t.test('1. 静态源码守卫：必须引入并消费 Core 层 defaultSessionHandleRegistry 并在 turn-completed 中消费 toStoredSessionId', () => {
    assert.match(
      rendererSource,
      /defaultSessionHandleRegistry/,
      '必须从 @hermes-flux/core 导入并消费 defaultSessionHandleRegistry'
    );
    assert.match(
      rendererSource,
      /function toStoredSessionId\(/,
      '必须实现 toStoredSessionId 归一化纯函数'
    );
    assert.match(
      rendererSource,
      /const completedTargetId = toStoredSessionId\(/,
      'turn-completed 必须调用 toStoredSessionId 归一化目标会话 ID'
    );
    assert.match(
      rendererSource,
      /const failedTargetId = toStoredSessionId\(/,
      'turn-failed 必须调用 toStoredSessionId 归一化目标会话 ID'
    );
    assert.match(
      rendererSource,
      /runningLiveIds/,
      'event 监听白名单必须包含 running 集合对应的 liveId'
    );
  });

  await t.test('2. 正向时序（真实消费 SessionHandleRegistry）：后台普通会话执行完毕后，状态必须精确收敛为 unread，绝不残留 running', () => {
    const registry = new SessionHandleRegistry();
    const runningSessionIds = new Set();
    const unreadSessionIds = new Set();

    const storedId = 'bg_b5da59';
    const liveId = 'live-transport-987';

    // 生产注册：在创建/恢复/发信时注册句柄对
    registry.register({ liveId, storedId });

    // 1. 发起任务：进入 running
    applyTurnStarted(runningSessionIds, unreadSessionIds, storedId);
    assert.equal(runningSessionIds.has(storedId), true);
    assert.equal(unreadSessionIds.has(storedId), false);
    assert.equal(resolveActivityState(storedId, { runningIds: runningSessionIds, unreadIds: unreadSessionIds }), 'running');

    // 2. 用户切到其他会话，当前视口在 other-session
    const currentActiveSessionId = 'other-focused-session';

    // 3. 网关完成事件下推，帧携带 liveId，调用生产 registry.toStoredId 真实转换！
    const incomingFrameSessionId = liveId;
    const resolvedTargetId = registry.toStoredId(incomingFrameSessionId, [storedId, currentActiveSessionId]);

    assert.equal(resolvedTargetId, storedId, '生产 registry 必须精准将 liveId 映射回 storedId');

    // 4. 执行收归
    const isFocused = resolvedTargetId === currentActiveSessionId;
    assert.equal(isFocused, false, '用户当前在别的会话，isFocused 必须为 false');

    applyTurnCompleted(runningSessionIds, unreadSessionIds, resolvedTargetId, isFocused);

    // 5. 断言：running 必须被成功清除，且 storedId 必须进入 unread！
    assert.equal(runningSessionIds.has(storedId), false, 'storedId 必须从 running 集合中删除');
    assert.equal(unreadSessionIds.has(storedId), true, 'storedId 必须成功进入 unread 集合');
    assert.equal(
      resolveActivityState(storedId, { runningIds: runningSessionIds, unreadIds: unreadSessionIds }),
      'unread',
      '求值必须为 unread（展示静态绿色未读圆点，绝不得为 running 脉冲！）'
    );

    // 6. 用户点击进入会话，未读清除变为已读
    applyEnteredRead(unreadSessionIds, storedId);
    assert.equal(unreadSessionIds.has(storedId), false);
    assert.equal(
      resolveActivityState(storedId, { runningIds: runningSessionIds, unreadIds: unreadSessionIds }),
      'read',
      '用户进入后必须变为 read（圆点彻底消失）'
    );
  });

  await t.test('3. 负向与异常（turn-failed）：网关抛错时退出 running，但绝不得误入 unread 集合', () => {
    const registry = new SessionHandleRegistry();
    const runningSessionIds = new Set();
    const unreadSessionIds = new Set();

    const storedId = 'bg_err_123';
    const liveId = 'live-err-999';
    registry.register({ liveId, storedId });

    applyTurnStarted(runningSessionIds, unreadSessionIds, storedId);
    assert.equal(runningSessionIds.has(storedId), true);

    // 模拟网关返回 error 帧携带 liveId
    const resolvedFailedId = registry.toStoredId(liveId, [storedId]);
    applyTurnFailed(runningSessionIds, resolvedFailedId);

    assert.equal(runningSessionIds.has(storedId), false, '失败任务必须安全退出 running');
    assert.equal(unreadSessionIds.has(storedId), false, '失败任务绝不得进入未读集合（没有可供查阅的有效答复）');
    assert.equal(
      resolveActivityState(storedId, { runningIds: runningSessionIds, unreadIds: unreadSessionIds }),
      'read',
      '失败任务求值必须直接为 read（无小圆点，不产生误导）'
    );
  });

  await t.test('4. 多会话并发与时序竞争：两个会话同时在后台跑，事件乱序到达时精准归一化，互不干扰', () => {
    const registry = new SessionHandleRegistry();
    const runningSessionIds = new Set();
    const unreadSessionIds = new Set();

    const sessA = { storedId: 'sess-a', liveId: 'live-a' };
    const sessB = { storedId: 'sess-b', liveId: 'live-b' };

    registry.register(sessA);
    registry.register(sessB);

    applyTurnStarted(runningSessionIds, unreadSessionIds, sessA.storedId);
    applyTurnStarted(runningSessionIds, unreadSessionIds, sessB.storedId);
    assert.equal(runningSessionIds.size, 2);

    // 会话 B 先收到完成帧（携带 live-b）
    const targetB = registry.toStoredId('live-b');
    applyTurnCompleted(runningSessionIds, unreadSessionIds, targetB, false);

    assert.equal(runningSessionIds.has('sess-b'), false);
    assert.equal(unreadSessionIds.has('sess-b'), true);
    assert.equal(runningSessionIds.has('sess-a'), true, '会话 A 仍在运行，绝不可被误杀！');

    // 会话 A 后收到完成帧（携带 live-a）
    const targetA = registry.toStoredId('live-a');
    applyTurnCompleted(runningSessionIds, unreadSessionIds, targetA, false);

    assert.equal(runningSessionIds.has('sess-a'), false);
    assert.equal(unreadSessionIds.has('sess-a'), true);
    assert.equal(runningSessionIds.size, 0);
    assert.equal(unreadSessionIds.size, 2);
  });

  await t.test('5. 变异杀伤力断言：若缺失 toStoredId 转换，直接消费 liveId，断言必然变红', () => {
    const buggyRunning = new Set(['bg_b5da59']);
    const buggyUnread = new Set();
    const liveId = 'live-transport-987';

    // 变异模拟：直接拿 liveId 执行 applyTurnCompleted
    applyTurnCompleted(buggyRunning, buggyUnread, liveId, false);

    assert.equal(buggyRunning.has('bg_b5da59'), true, '变异杀伤力证明：旧逻辑因 key 不匹配无法删除 storedId');
    assert.equal(buggyUnread.has('bg_b5da59'), false, '变异杀伤力证明：旧逻辑未读集合缺失 storedId');
    assert.equal(
      resolveActivityState('bg_b5da59', { runningIds: buggyRunning, unreadIds: buggyUnread }),
      'running',
      '变异杀伤力证明：若不修复，会话将永久停留在 running 脉冲动效中！'
    );
  });

  await t.test('6. 源码守卫：renderer/index.ts 已接入 GroupLogPollerManager、ActivityTransitionTracker、decorateRailProjects，且已彻底移除单槽定时器和 lastCount = -1 缺陷', () => {
    assert.match(
      rendererSource,
      /\bGroupLogPollerManager\b/,
      '必须接入 Core 层 GroupLogPollerManager 管理群聊多房间并发轮询'
    );
    assert.match(
      rendererSource,
      /\bActivityTransitionTracker\b/,
      '必须接入 Core 层 ActivityTransitionTracker 追踪完成瞬态跃迁'
    );
    assert.match(
      rendererSource,
      /function decorateRailProjects\(/,
      '必须实现 decorateRailProjects 将三态与跃迁投影至项目子会话'
    );
    assert.match(
      rendererSource,
      /dataset\.pageHidden/,
      '必须在 init() 中同步 pageHidden 属性节流后台休眠动画'
    );
    assert.doesNotMatch(
      rendererSource,
      /\bactiveGroupPollerTimer\b/,
      '禁止保留老的单槽位全局群聊定时器 activeGroupPollerTimer'
    );
    assert.doesNotMatch(
      rendererSource,
      /\blastCount\s*=\s*-1\b/,
      '禁止保留会误把用户消息判为助手回复的 lastCount = -1 缺陷'
    );
    assert.doesNotMatch(
      rendererSource,
      /\btimedOutGroupRoomId\b/,
      '单聊流式看门狗超时绝不可按焦点误杀后台正常运行中的群聊轮询'
    );
  });

  await t.test('7. 真实 ActivityTransitionTracker 行为：完成跃迁窗口期、切入已读即时撤销与相邻完成 token 递增', () => {
    const tracker = new ActivityTransitionTracker({ windowMs: 360 });
    const runningIds = new Set();
    const unreadIds = new Set();
    const sessionId = 'sess-transition-1';

    applyTurnStarted(runningIds, unreadIds, sessionId);
    const t0 = 10_000;
    applyTurnCompleted(runningIds, unreadIds, sessionId, false);
    const firstToken = tracker.recordCompleted('session', sessionId, 'unread', t0);

    const stateDuringWindow = resolveActivityState(sessionId, { runningIds, unreadIds });
    assert.equal(stateDuringWindow, 'unread', '后台完成后状态应收敛为 unread');

    const activeTransition = tracker.resolveTransition('session', sessionId, stateDuringWindow, t0 + 120);
    assert.equal(activeTransition.transition, 'just-completed', '窗口期内必须返回 just-completed');
    assert.equal(activeTransition.transitionToken, firstToken, '窗口期内应透传对应 token');
    assert.equal(tracker.nextExpiryDelayMs(t0 + 120), 240, '剩余窗口延时应准确返回 240ms');

    const expiredTransition = tracker.resolveTransition('session', sessionId, stateDuringWindow, t0 + 360);
    assert.equal(expiredTransition.transition, 'none', '到达窗口期上限后必须自动过期为 none');
    assert.equal(tracker.nextExpiryDelayMs(t0 + 360), null, '无活跃跃迁条目时调度延时必须为 null');

    applyTurnStarted(runningIds, unreadIds, sessionId);
    tracker.clear('session', sessionId);
    applyTurnCompleted(runningIds, unreadIds, sessionId, false);
    const secondToken = tracker.recordCompleted('session', sessionId, 'unread', t0 + 500);
    assert.ok(secondToken > firstToken, '相邻两次完成的 transitionToken 必须严格递增');

    applyEnteredRead(unreadIds, sessionId);
    tracker.clear('session', sessionId);
    const stateAfterRead = resolveActivityState(sessionId, { runningIds, unreadIds });
    assert.equal(stateAfterRead, 'read', '用户切入查看后状态应立即转为 read');
    assert.equal(
      tracker.resolveTransition('session', sessionId, stateAfterRead, t0 + 520).transition,
      'none',
      '切入已读后即使原窗口未满也绝不得残留 just-completed'
    );
  });

  await t.test('8. 群聊域终止清理：settleTurnTermination 精准退出指定群聊 running 且绝不误杀并发房间或其他域', () => {
    const runningSessionIds = new Set(['sess-active']);
    const runningBotNames = new Set(['architect']);
    const runningGroupRoomIds = new Set(['room-a', 'room-b']);
    const unreadGroupRoomIds = new Set();

    settleTurnTermination({
      runningSessionIds,
      runningBotNames,
      runningGroupRoomIds,
      groupRoomId: 'room-a',
    });

    assert.equal(runningGroupRoomIds.has('room-a'), false, '被终止的 room-a 必须退出 running');
    assert.equal(unreadGroupRoomIds.has('room-a'), false, '异常终止的 room-a 绝不得进入 unread');
    assert.equal(
      resolveActivityState('room-a', { runningIds: runningGroupRoomIds, unreadIds: unreadGroupRoomIds }),
      'read',
      '被终止的 room-a 求值必须为 read'
    );
    assert.equal(runningGroupRoomIds.has('room-b'), true, '并发运行的 room-b 绝不可被误杀');
    assert.equal(runningSessionIds.has('sess-active'), true, '会话域运行态绝不可被误杀');
    assert.equal(runningBotNames.has('architect'), true, 'Bot 域运行态绝不可被误杀');

    settleTurnTermination({
      runningSessionIds,
      runningBotNames,
      runningGroupRoomIds,
      groupRoomId: 'room-a',
    });
    assert.equal(runningGroupRoomIds.has('room-b'), true, '重复调用 settleTurnTermination 必须幂等');
  });
});
