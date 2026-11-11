import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planUpwardScrollAction,
  computeExpandPrefetchPx,
  computeStillNearTop,
  planOlderZeroMessagesAction,
  shouldKeepOlderMessagesAfterLoop,
} from '../../dist/renderer/messageWindow.mjs';

test('planUpwardScrollAction: 首屏消息总数 <= 120 时，读者向上触顶必须允许 fetch-older-remote（打破死锁）', () => {
  for (const total of [5, 39, 57, 62, 100, 120]) {
    const action = planUpwardScrollAction({
      sessionId: 's1',
      readerScrolledSessionId: 's1',
      total,
      capacity: 120,
      windowStart: 0,
      hasOlderMessages: true,
      scrollTop: 0,
      virtualWindowTopPx: 0,
      expandPrefetchPx: 833,
    });
    assert.equal(
      action,
      'fetch-older-remote',
      `total=${total} <= 120 时绝不能被容量门禁拦死，必须触发远端翻页`
    );
  }
});

test('planUpwardScrollAction: 负向与边界变异守卫（hasOlder=false / 等于阈值 / 未超阈值 / 跨会话 / 空id）', () => {
  const base = {
    sessionId: 's1',
    readerScrolledSessionId: 's1',
    total: 57,
    capacity: 120,
    windowStart: 0,
    hasOlderMessages: true,
    scrollTop: 0,
    virtualWindowTopPx: 0,
    expandPrefetchPx: 833,
  };

  // 杀死「删掉 && input.hasOlderMessages」的变异
  assert.equal(
    planUpwardScrollAction({ ...base, hasOlderMessages: false }),
    'none',
    '已无更早历史时不得再触发远端请求'
  );

  // 杀死「删掉 scrollTop >= triggerBoundary」的变异
  assert.equal(
    planUpwardScrollAction({ ...base, scrollTop: 833 }),
    'none',
    'scrollTop 恰好等于触发边界时不得触发'
  );
  assert.equal(
    planUpwardScrollAction({ ...base, scrollTop: 2500 }),
    'none',
    '停留在列表底部远高于阈值时不得触发'
  );
  assert.equal(
    planUpwardScrollAction({ ...base, total: 586, windowStart: 466, virtualWindowTopPx: 44000, scrollTop: 49000, expandPrefetchPx: 5000 }),
    'none',
    '超容量窗口内未接近窗口上沿时不得触发扩窗'
  );

  // 跨会话授权隔离与空 id 防护
  assert.equal(
    planUpwardScrollAction({ ...base, readerScrolledSessionId: 's-other' }),
    'none',
    '其他会话的滚动授权绝不得泄漏给当前会话'
  );
  assert.equal(
    planUpwardScrollAction({ ...base, sessionId: '', readerScrolledSessionId: '' }),
    'none'
  );
});

test('planUpwardScrollAction: 首屏短会话未经读者主动向上滚动前不得自动拉历史，也不触发 settle-bottom', () => {
  const action = planUpwardScrollAction({
    sessionId: 's1',
    readerScrolledSessionId: '',
    total: 57,
    capacity: 120,
    windowStart: 0,
    hasOlderMessages: true,
    scrollTop: 0,
    virtualWindowTopPx: 0,
    expandPrefetchPx: 833,
  });
  assert.equal(action, 'none');
});

test('planUpwardScrollAction: 超过容量 120 且未授权时触发 settle-bottom；授权后 windowStart > 0 先本地扩窗', () => {
  const unauthed = planUpwardScrollAction({
    sessionId: 's1',
    readerScrolledSessionId: '',
    total: 586,
    capacity: 120,
    windowStart: 466,
    hasOlderMessages: true,
    scrollTop: 0,
    virtualWindowTopPx: 44000,
    expandPrefetchPx: 5000,
  });
  assert.equal(unauthed, 'settle-bottom');

  const expandLocal = planUpwardScrollAction({
    sessionId: 's1',
    readerScrolledSessionId: 's1',
    total: 586,
    capacity: 120,
    windowStart: 466,
    hasOlderMessages: true,
    scrollTop: 45000,
    virtualWindowTopPx: 44000,
    expandPrefetchPx: 5000,
  });
  assert.equal(expandLocal, 'expand-local-window');

  const fetchRemote = planUpwardScrollAction({
    sessionId: 's1',
    readerScrolledSessionId: 's1',
    total: 586,
    capacity: 120,
    windowStart: 0,
    hasOlderMessages: true,
    scrollTop: 100,
    virtualWindowTopPx: 0,
    expandPrefetchPx: 5000,
  });
  assert.equal(fetchRemote, 'fetch-older-remote');
});

test('computeExpandPrefetchPx 与 computeStillNearTop: 兜底、中间值、封顶与精确临界边界', () => {
  // 视口小于 800 或无挂载窗时按 800 兜底
  assert.equal(computeExpandPrefetchPx(500), 800);
  assert.equal(computeExpandPrefetchPx(0, 0), 800);
  assert.equal(computeExpandPrefetchPx(Number.NaN, Number.NaN), 800);

  // 未封顶中间值按挂载窗口高度的一半计算
  assert.equal(computeExpandPrefetchPx(833, 4000), 2000);

  // 即使挂载窗口是 51130px，本地扩窗预取封顶 16000px，绝不等于 50 万 px 虚拟高度的一半
  assert.equal(computeExpandPrefetchPx(833, 51130), 16000);

  // 连拉判定必须严格按视口（0.4 * max(800, clientHeight)），且包含 NaN 防护
  assert.equal(computeStillNearTop(319, 800), true);
  assert.equal(computeStillNearTop(320, 800), false);
  assert.equal(computeStillNearTop(27120, 833), false);
  assert.equal(computeStillNearTop(Number.NaN, 800), false);
});

test('planOlderZeroMessagesAction: 区分高估回退重拉与真正见底（防死循环与防丢历史）', () => {
  // 缓存高估导致 queryOffset (2500) > safeFallbackOffset (100)，首次返回 0 条必须退回 100 重拉
  assert.deepEqual(
    planOlderZeroMessagesAction({
      isTargetSelf: true,
      floorSuppressed: false,
      queryOffset: 2500,
      safeFallbackOffset: 100,
    }),
    { action: 'retry-fallback', fallbackOffset: 100 }
  );

  // 已回退过一次（floorSuppressed=true），再次 0 条不得无限重试
  assert.deepEqual(
    planOlderZeroMessagesAction({
      isTargetSelf: true,
      floorSuppressed: true,
      queryOffset: 2500,
      safeFallbackOffset: 100,
    }),
    { action: 'exhausted' }
  );

  // 起点已等于 safeFallbackOffset 或处于父会话段时，0 条直接标记耗尽
  assert.deepEqual(
    planOlderZeroMessagesAction({
      isTargetSelf: true,
      floorSuppressed: false,
      queryOffset: 100,
      safeFallbackOffset: 100,
    }),
    { action: 'exhausted' }
  );
  assert.deepEqual(
    planOlderZeroMessagesAction({
      isTargetSelf: false,
      floorSuppressed: false,
      queryOffset: 500,
      safeFallbackOffset: 100,
    }),
    { action: 'exhausted' }
  );
});

test('shouldKeepOlderMessagesAfterLoop: 8 轮全缓存重叠耗尽上限退出时绝不能置 hasOlderMessages=false 断尾', () => {
  // 无失败但血缘尚未标为 exhausted（如 MAX_PAGE_ATTEMPTS=8 全撞重叠退出）：必须保留 true
  assert.equal(
    shouldKeepOlderMessagesAfterLoop({ fetchFailed: false, anyLineageRemaining: true }),
    true
  );
  // 失败即使无血缘也必须保留入口
  assert.equal(
    shouldKeepOlderMessagesAfterLoop({ fetchFailed: true, anyLineageRemaining: false }),
    true
  );
  // 仅当无失败且所有血缘均已明确耗尽时才关闭
  assert.equal(
    shouldKeepOlderMessagesAfterLoop({ fetchFailed: false, anyLineageRemaining: false }),
    false
  );
});
