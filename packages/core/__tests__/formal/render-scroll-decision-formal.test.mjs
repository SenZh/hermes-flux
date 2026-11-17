/**
 * 渲染期视口裁决的属性证明。
 *
 * 【守护什么】
 *   1. INV-VIEW-08：`decideViewportPin` 对任意布尔组合都必须忠实于两条语义——
 *      进入计划挂起时绝不捕获/重放，非进入期的贴底等价于 `forcedBottom || wasNearBottom`；
 *   2. 推进条件恒等于「有 rAF」且（进入期 或 消息变化）；
 *   3. `chooseViewportAnchor` 在 capture=false 时绝不调用捕获函数（副作用隔离）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { decideViewportPin, chooseViewportAnchor } from '../../dist/index.js';

const inputArb = fc.record({
  enterPending: fc.boolean(),
  forcedBottom: fc.boolean(),
  wasNearBottom: fc.boolean(),
  messagesChanged: fc.boolean(),
  hasRaf: fc.boolean(),
});

test('INV-VIEW-08：裁决对任意布尔组合忠实于进入/常规两条语义', () => {
  fc.assert(
    fc.property(inputArb, (input) => {
      const decision = decideViewportPin(input);

      if (input.enterPending) {
        assert.equal(decision.capture, false, '进入期不得捕获旧 DOM');
        assert.equal(decision.applyAnchor, false, '进入期不得重放锚点');
        assert.equal(decision.pinBottom, false, '进入期由计划裁决位置，不做贴底');
        assert.equal(decision.advanceSessionEnter, input.hasRaf, '进入期推进只取决于 rAF');
        return;
      }

      assert.equal(decision.capture, true, '常规期必须捕获锚点');
      assert.equal(decision.applyAnchor, true, '常规期必须允许重放锚点');
      assert.equal(
        decision.pinBottom,
        input.forcedBottom || input.wasNearBottom,
        '常规期贴底等价于强制置底或贴底安全区',
      );
      assert.equal(
        decision.advanceSessionEnter,
        input.hasRaf && input.messagesChanged,
        '常规期推进等价于有 rAF 且消息变化',
      );
    }),
    { numRuns: 200 },
  );
});

test('chooseViewportAnchor：capture=false 时不得产生捕获副作用', () => {
  fc.assert(
    fc.property(inputArb, (input) => {
      let calls = 0;
      const capture = () => { calls += 1; return 'captured'; };
      const decision = decideViewportPin(input);
      const value = chooseViewportAnchor(decision, capture, 'fallback');

      if (decision.capture) {
        assert.equal(value, 'captured');
        assert.equal(calls, 1);
      } else {
        assert.equal(value, 'fallback');
        assert.equal(calls, 0);
      }
    }),
    { numRuns: 200 },
  );
});
