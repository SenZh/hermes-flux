/**
 * 跨会话视口记忆的形式化不变量（Session Scroll Memory）
 *
 * 【守护什么】`planSessionEnter` 的三条恢复语义必须对**任意**快照成立：
 *   贴底态一律 pin-to-bottom；有锚点且非贴底一律 restore-anchor（带合法比例与兜底位置）；
 *   其余一律 restore-scroll-top（位置等于归一化后的 scrollTop）。LRU 容量恒不越界。
 *
 * 【为什么必须属性测试】这三条是"切回会话到底贴底还是回原位"的唯一裁决点。
 *   示例式单测只能覆盖手写出来的几种组合，而真实快照的 scrollTop / 行高 / 锚点比例
 *   是连续值域；漏掉任何一个区间的语义反转，用户看到的就是白屏或跳到别处。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { SessionScrollMemory } from '../../dist/viewport/sessionScrollMemory.js';

const SESSION_ID = fc.string({ minLength: 1, maxLength: 12 });
const ANCHOR_ID = fc.option(fc.string({ minLength: 1, maxLength: 8 }), { nil: undefined });
const RATIO = fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined });

test('INV-VIEW-01：planSessionEnter 对任意快照都必须忠实还原恢复语义', () => {
  fc.assert(
    fc.property(
      SESSION_ID,
      fc.nat({ max: 20000 }),
      fc.integer({ min: 1, max: 4000 }),
      fc.integer({ min: 1, max: 4000 }),
      ANCHOR_ID,
      RATIO,
      (sessionId, scrollTop, scrollHeight, clientHeight, anchorMessageId, anchorOffsetRatio) => {
        const memory = new SessionScrollMemory();
        memory.recordSnapshot({
          sessionId,
          scrollTop,
          scrollHeight,
          clientHeight,
          anchorMessageId,
          anchorOffsetRatio,
        });

        const plan = memory.planSessionEnter(sessionId);
        const distanceToBottom = scrollHeight - (scrollTop + clientHeight);

        if (distanceToBottom <= 48) {
          assert.deepEqual(
            plan,
            { type: 'pin-to-bottom', reason: 'was-near-bottom' },
            '贴底态切回必须重新贴底，绝不能恢复旧像素位置',
          );
          return;
        }

        if (anchorMessageId) {
          assert.equal(plan.type, 'restore-anchor', '非贴底且有锚点时必须按锚点恢复');
          assert.equal(plan.anchorMessageId, anchorMessageId);
          assert.equal(plan.fallbackScrollTop, scrollTop, '锚点缺失时的兜底位置必须是记录的 scrollTop');
          assert.ok(plan.anchorOffsetRatio >= 0 && plan.anchorOffsetRatio <= 1, '锚点比例必须夹在 [0,1]');
          return;
        }

        assert.equal(plan.type, 'restore-scroll-top', '无锚点时只能按标量位置恢复');
        assert.equal(plan.scrollTop, scrollTop);
      },
    ),
    { numRuns: 300 },
  );
});

test('INV-VIEW-01b：LRU 容量与最新会话保留恒成立', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 20 }),
      fc.array(SESSION_ID, { minLength: 1, maxLength: 120 }),
      (maxEntries, sessionIds) => {
        const memory = new SessionScrollMemory({ maxEntries });
        for (const sessionId of sessionIds) {
          memory.recordSnapshot({ sessionId, scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
          assert.ok(memory.size <= maxEntries, `容量 ${memory.size} 越界（上限 ${maxEntries}）`);
        }
        const last = sessionIds[sessionIds.length - 1];
        assert.ok(memory.getSnapshot(last), '最后写入的会话必须仍在缓存里，否则切回即丢位置');
      },
    ),
    { numRuns: 200 },
  );
});

test('INV-VIEW-01c：未知会话必须回落到贴底而不是抛错', () => {
  fc.assert(
    fc.property(SESSION_ID, (sessionId) => {
      const memory = new SessionScrollMemory();
      assert.deepEqual(memory.planSessionEnter(sessionId), { type: 'pin-to-bottom', reason: 'new-session' });
      assert.deepEqual(memory.planSessionEnter(''), { type: 'pin-to-bottom', reason: 'new-session' });
      assert.equal(memory.deleteSession(sessionId), false, '删除不存在的会话必须如实返回 false');
    }),
    { numRuns: 100 },
  );
});
