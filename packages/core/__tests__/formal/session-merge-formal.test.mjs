import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  dedupeSessionsByProfile,
  reconcileSessionList,
  pruneSupersededSessions,
} from '../../dist/index.js';

/**
 * 跨 Profile 会话合并与对账形式化不变量验证套件
 * (Formal Invariant Verifier - Cross-Profile Session Merge & Failure Non-Emptiness)
 */
test('Formal Invariant Verifier: Session Merge & Failure Non-Emptiness', async (t) => {
  const sessionArbitrary = fc.record({
    id: fc.stringMatching(/^[a-z0-9_-]{1,15}$/),
    title: fc.string({ minLength: 1, maxLength: 30 }),
    model: fc.string(),
    time: fc.string(),
    preview: fc.string(),
    isArchived: fc.boolean(),
    timestamp: fc.integer({ min: 0, max: 2000000000000 }),
    timeSource: fc.constantFrom('last_active', 'started_at', 'created_at', 'none'),
    hidden: fc.boolean(),
    unread: fc.boolean(),
    pinned: fc.boolean(),
    botName: fc.stringMatching(/^[a-z0-9_-]{0,10}$/),
  });

  await t.test('定理 5 [跨 Profile 去重强幂等性]: 任意会话列表重复执行 dedupe 恒等于自身', () => {
    fc.assert(
      fc.property(fc.array(sessionArbitrary, { minLength: 0, maxLength: 50 }), (sessions) => {
        const once = dedupeSessionsByProfile(sessions);
        const twice = dedupeSessionsByProfile(once);

        // 形式化证明：dedupe(dedupe(S)) == dedupe(S)
        assert.equal(twice.length, once.length, '幂等性断言：长度必须严格守恒');
        for (let i = 0; i < once.length; i++) {
          assert.equal(twice[i].id, once[i].id);
          assert.equal(twice[i].botName, once[i].botName);
          assert.equal(twice[i].timestamp, once[i].timestamp);
        }
      }),
      { numRuns: 1000 }
    );
  });

  await t.test('定理 6 [失败不可致空 (Failure Is Not Empty)]: 非权威返回时，已有本地会话在所有输入下绝不可被抹除', () => {
    fc.assert(
      fc.property(
        fc.array(sessionArbitrary, { minLength: 1, maxLength: 20 }),
        fc.array(sessionArbitrary, { minLength: 0, maxLength: 10 }),
        (previousSessions, fetchedSessions) => {
          // 过滤掉隐藏和归档，保证均为有效可见会话
          const validPrevious = previousSessions.filter(
            (s) => !s.hidden && !s.isArchived && s.title && s.title.trim()
          );
          if (validPrevious.length === 0) return;

          // 模拟网关部分失败（authoritative = false）
          const reconciled = reconcileSessionList({
            previous: validPrevious,
            fetched: fetchedSessions,
            authoritative: false,
          });

          // 【核心安全定理证明】
          // 当权威拉取未完成或部分失败时，哪怕 fetched 为空，也绝对不能将本地会话置空！
          assert.ok(
            reconciled.sessions.length > 0,
            '形式化证明失败：网络失败导致本地会话被静默置空（违背 Failure Is Not Empty）！'
          );

          // 验证本地每个有效且不在 fetched 中的会话必须依然被保留
          for (const prev of validPrevious) {
            const stillExists = reconciled.sessions.some(
              (s) => s.id === prev.id && (s.botName || 'default') === (prev.botName || 'default')
            );
            assert.equal(
              stillExists,
              true,
              `形式化证明失败：非权威更新误丢弃了本地会话 ${prev.id}`
            );
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  await t.test('定理 7 [去重结果时间全序降序单调性]: 任意合法会话经 dedupe 后的时间戳单调非递增', () => {
    fc.assert(
      fc.property(fc.array(sessionArbitrary, { minLength: 2, maxLength: 50 }), (sessions) => {
        const merged = dedupeSessionsByProfile(sessions);
        for (let i = 0; i < merged.length - 1; i++) {
          const t1 = merged[i].timestamp || 0;
          const t2 = merged[i + 1].timestamp || 0;
          assert.ok(t1 >= t2, `时间全序单调性证明失败：第 ${i} 项 (${t1}) 小于 第 ${i+1} 项 (${t2})`);
        }
      }),
      { numRuns: 1000 }
    );
  });
});
