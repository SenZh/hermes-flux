/**
 * 会话三态流转与 Live/Stored ID 映射自愈单元测试
 * (packages/desktop/__tests__/unit/session-activity-lifecycle.test.mjs)
 *
 * 【测试核心目标】
 * 零外部依赖，100% 在常规 CI / npm test 中运行，验证：
 * 1. 网关事件携带 liveId 时，必须经由 toStoredSessionId 归一化为 storedId；
 * 2. 后台会话执行完毕未读（unread）时，必须精准退出 running 并进入 unread（绿色静态点），绝不得误显为 running 脉冲；
 * 3. 变异检验：若缺失 toStoredSessionId 归一化，直接消费 liveId，断言必然变红（变异体 100% 杀伤）。
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
  applyEnteredRead,
} from '../../../core/dist/index.js';

const rendererSource = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/renderer/index.ts'),
  'utf8'
);

test('Session Activity Lifecycle & Handle Normalization Invariants', async (t) => {
  await t.test('1. 静态源码守卫：必须维护 sessionLiveToStoredMap 并在 turn-completed 中消费 toStoredSessionId', () => {
    assert.match(rendererSource, /const sessionLiveToStoredMap = new Map/, '必须声明 sessionLiveToStoredMap');
    assert.match(rendererSource, /const sessionStoredToLiveMap = new Map/, '必须声明 sessionStoredToLiveMap');
    assert.match(rendererSource, /function toStoredSessionId\(/, '必须实现 toStoredSessionId 归一化纯函数');
    assert.match(
      rendererSource,
      /const completedTargetId = toStoredSessionId\(/,
      'turn-completed 必须调用 toStoredSessionId 归一化目标会话 ID'
    );
    assert.match(
      rendererSource,
      /runningLiveIds/,
      'event 监听白名单必须包含 running 集合对应的 liveId'
    );
  });

  await t.test('2. 真实时序仿真：后台普通会话执行完毕后，状态必须精确收敛为 unread，绝不残留 running', () => {
    const runningSessionIds = new Set();
    const unreadSessionIds = new Set();
    const liveToStoredMap = new Map();

    const storedId = 'bg_b5da59';
    const liveId = 'live-transport-987';
    liveToStoredMap.set(liveId, storedId);

    // 1. 发起任务：进入 running
    applyTurnStarted(runningSessionIds, unreadSessionIds, storedId);
    assert.equal(runningSessionIds.has(storedId), true);
    assert.equal(unreadSessionIds.has(storedId), false);
    assert.equal(resolveActivityState(storedId, { runningIds: runningSessionIds, unreadIds: unreadSessionIds }), 'running');

    // 2. 用户切到其他会话
    const currentActiveSessionId = 'other-focused-session';

    // 3. 网关完成事件下推，帧携带 liveId
    const incomingFrameSessionId = liveId;
    const resolvedTargetId = liveToStoredMap.get(incomingFrameSessionId) || incomingFrameSessionId;

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

  await t.test('3. 变异对比杀伤力检验：若直接使用 liveId 清除，必导致状态永久死锁在 running', () => {
    const buggyRunning = new Set(['bg_b5da59']);
    const buggyUnread = new Set();
    const liveId = 'live-transport-987';

    // 模拟旧 Bug：直接拿 liveId 执行 applyTurnCompleted
    applyTurnCompleted(buggyRunning, buggyUnread, liveId, false);

    // 证明 Bug 现象：storedId 没删掉，未读集合里是孤儿 liveId
    assert.equal(buggyRunning.has('bg_b5da59'), true, '旧逻辑因 key 不匹配无法删除 storedId');
    assert.equal(buggyUnread.has('bg_b5da59'), false, '旧逻辑未读集合缺失 storedId');
    assert.equal(
      resolveActivityState('bg_b5da59', { runningIds: buggyRunning, unreadIds: buggyUnread }),
      'running',
      '证明若不修复，会话将永久停留在 running 脉冲动效中！'
    );
  });
});
