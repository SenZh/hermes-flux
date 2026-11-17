/**
 * 渲染期视口裁决单测。
 *
 * 【断言与杀伤力】
 *   1. 进入计划挂起时绝不捕获旧 DOM、绝不重放锚点；
 *   2. 非进入期：强制置底或贴底安全区都必须贴底，回溯态必须保留锚点；
 *   3. 没有 rAF 时不推进进入计划，也不抛错；
 *   4. 锚点选择必须由 capture 决定：进入期绝不能调用捕获函数。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { decideViewportPin, chooseViewportAnchor } from '../../dist/index.js';

test('decideViewportPin: 进入期与常规期的组合语义', async (t) => {
  await t.test('1. 进入计划挂起：不捕获、不重放，有 rAF 才推进', () => {
    const withRaf = decideViewportPin({
      enterPending: true, forcedBottom: true, wasNearBottom: true, messagesChanged: true, hasRaf: true,
    });
    assert.deepEqual(withRaf, {
      capture: false, pinBottom: false, applyAnchor: false, advanceSessionEnter: true,
    });

    const noRaf = decideViewportPin({
      enterPending: true, forcedBottom: false, wasNearBottom: false, messagesChanged: true, hasRaf: false,
    });
    assert.equal(noRaf.advanceSessionEnter, false, '没有 rAF 不得推进');
  });

  await t.test('2. 非进入期：强制置底与贴底安全区都必须贴底', () => {
    const forced = decideViewportPin({
      enterPending: false, forcedBottom: true, wasNearBottom: false, messagesChanged: true, hasRaf: true,
    });
    assert.deepEqual(forced, {
      capture: true, pinBottom: true, applyAnchor: true, advanceSessionEnter: true,
    });

    const nearBottom = decideViewportPin({
      enterPending: false, forcedBottom: false, wasNearBottom: true, messagesChanged: true, hasRaf: true,
    });
    assert.equal(nearBottom.pinBottom, true, '贴底安全区必须跟随');
  });

  await t.test('3. 非进入期回溯：不贴底，消息未变不推进', () => {
    const anchored = decideViewportPin({
      enterPending: false, forcedBottom: false, wasNearBottom: false, messagesChanged: false, hasRaf: true,
    });
    assert.equal(anchored.pinBottom, false, '回溯态不得贴底');
    assert.equal(anchored.applyAnchor, true, '回溯态仍要重放锚点');
    assert.equal(anchored.advanceSessionEnter, false, '消息未变不重复推进');

    const changed = decideViewportPin({
      enterPending: false, forcedBottom: false, wasNearBottom: false, messagesChanged: true, hasRaf: true,
    });
    assert.equal(changed.advanceSessionEnter, true, '消息变化必须推进');
  });
});

test('chooseViewportAnchor: 只有需要捕获时才调用捕获函数', async (t) => {
  await t.test('1. capture=true 时返回捕获结果并调用一次', () => {
    let calls = 0;
    const value = chooseViewportAnchor(
      { capture: true, pinBottom: false, applyAnchor: true, advanceSessionEnter: true },
      () => { calls += 1; return 'captured'; },
      'fallback',
    );
    assert.equal(value, 'captured');
    assert.equal(calls, 1);
  });

  await t.test('2. capture=false 时返回兜底且绝不调用捕获函数', () => {
    let calls = 0;
    const value = chooseViewportAnchor(
      { capture: false, pinBottom: false, applyAnchor: false, advanceSessionEnter: true },
      () => { calls += 1; return 'captured'; },
      'fallback',
    );
    assert.equal(value, 'fallback');
    assert.equal(calls, 0, '进入期调用捕获会把旧 DOM 写进新会话记忆');
  });
});
