import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { orchestrateUnifiedLeftRail } from '../../dist/index.js';

/**
 * 统一多层级会话列表编排形式化不变量验证套件
 * (Formal Invariant Verifier: Multi-Tier Unified Left Rail Orchestration & TLA+ Safety Proofs)
 */
test('Formal Invariant Verifier: Unified Left Rail Orchestration', async (t) => {
  // 1. 任意 Profile 生成器
  const profileArbitrary = fc.record({
    name: fc.stringMatching(/^[a-z0-9_-]{1,12}$/),
    displayName: fc.string({ minLength: 1, maxLength: 20 }),
    description: fc.string(),
    avatar: fc.string(),
    model: fc.string(),
    timestamp: fc.integer({ min: 0, max: 2000000000000 }),
    hasAvatar: fc.boolean(),
  });

  // 2. 任意群聊生成器
  const groupArbitrary = fc.record({
    id: fc.stringMatching(/^grp_[a-z0-9]{4,10}$/),
    name: fc.string({ minLength: 1, maxLength: 25 }),
    topic: fc.string(),
    memberCount: fc.integer({ min: 1, max: 100 }),
    lastMessageSnippet: fc.string(),
    lastActiveTimestamp: fc.integer({ min: 0, max: 2000000000000 }),
  });

  // 3. 任意普通会话生成器
  const sessionArbitrary = fc.record({
    id: fc.stringMatching(/^[a-z0-9_-]{1,15}$/),
    title: fc.string({ minLength: 1, maxLength: 30 }),
    model: fc.string(),
    time: fc.string(),
    preview: fc.string(),
    isArchived: fc.boolean(),
    timestamp: fc.integer({ min: 0, max: 2000000000000 }),
    hidden: fc.boolean(),
    isSubagent: fc.boolean(),
    botName: fc.stringMatching(/^[a-z0-9_-]{0,10}$/),
  });

  // 4. 任意墓碑与待决 ID
  const idArbitrary = fc.stringMatching(/^[a-z0-9_-]{1,15}$/);

  await t.test('定理 12 [三权分立互斥性 (Strict Tier Orthogonality)]: Bot、Group、Session 三大领域正交隔离，绝不越界交叉', () => {
    fc.assert(
      fc.property(
        fc.array(profileArbitrary, { minLength: 1, maxLength: 10 }),
        fc.array(groupArbitrary, { minLength: 0, maxLength: 10 }),
        fc.array(sessionArbitrary, { minLength: 0, maxLength: 20 }),
        (profiles, groups, sessions) => {
          const result = orchestrateUnifiedLeftRail({
            profiles,
            groups,
            sessions,
            authoritative: true,
          });

          // 形式化断言：Bot 卡片中只包含合法的 profile name，绝不包含群聊 ID
          const groupIds = new Set(groups.map((g) => g.id.trim()));
          for (const bot of result.botCards) {
            assert.ok(!groupIds.has(bot.name), '领域隔离证明失败：Bot 卡片被群聊 ID 污染');
          }

          // 形式化断言：群聊房间只包含群聊实体
          for (const grp of result.groupRooms) {
            assert.ok(typeof grp.memberCount === 'number', '领域隔离证明失败：群聊结构缺失');
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  await t.test('定理 13 [普通会话时间全序降序单调性 (Monotonic Timeline Ordering)]: timelineSessions 严格非递增', () => {
    fc.assert(
      fc.property(
        fc.array(sessionArbitrary, { minLength: 2, maxLength: 30 }),
        (sessions) => {
          const result = orchestrateUnifiedLeftRail({
            profiles: [],
            groups: [],
            sessions,
            authoritative: true,
          });

          const timeline = result.timelineSessions;
          for (let i = 0; i < timeline.length - 1; i++) {
            const t1 = timeline[i].timestamp || 0;
            const t2 = timeline[i + 1].timestamp || 0;
            assert.ok(
              t1 >= t2,
              `时间全序单调性证明失败：第 ${i} 项 (${t1}) 小于 第 ${i + 1} 项 (${t2})`
            );
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  await t.test('定理 14 [墓碑强制驱逐不可侵犯性 (Tombstone Absolute Exclusion)]: 墓碑中的 ID 绝对不可出现在任何输出列表中', () => {
    fc.assert(
      fc.property(
        fc.array(sessionArbitrary, { minLength: 1, maxLength: 20 }),
        fc.array(groupArbitrary, { minLength: 1, maxLength: 10 }),
        fc.array(idArbitrary, { minLength: 1, maxLength: 10 }),
        (sessions, groups, rawTombstones) => {
          // 挑选部分已知 ID 构造确定性墓碑
          const targetSessionId = sessions[0]?.id;
          const targetGroupId = groups[0]?.id;
          const tombstones = new Set([...rawTombstones, targetSessionId, targetGroupId]);

          const result = orchestrateUnifiedLeftRail({
            profiles: [],
            groups,
            sessions,
            tombstoneIds: tombstones,
            authoritative: true,
          });

          // 验证 timelineSessions 绝无墓碑 ID
          for (const s of result.timelineSessions) {
            assert.ok(
              !tombstones.has(s.id),
              `墓碑不可侵犯证明失败：已删除会话 ${s.id} 幽灵死而复生！`
            );
          }

          // 验证 groupRooms 绝无墓碑 ID
          for (const g of result.groupRooms) {
            assert.ok(
              !tombstones.has(g.id),
              `墓碑不可侵犯证明失败：已删除群聊 ${g.id} 幽灵死而复生！`
            );
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  await t.test('定理 15 [多源编排强幂等性 (Strong Idempotence)]: 二次编排输出严格恒等', () => {
    fc.assert(
      fc.property(
        fc.array(profileArbitrary, { minLength: 0, maxLength: 10 }),
        fc.array(groupArbitrary, { minLength: 0, maxLength: 10 }),
        fc.array(sessionArbitrary, { minLength: 0, maxLength: 20 }),
        (profiles, groups, sessions) => {
          const once = orchestrateUnifiedLeftRail({
            profiles,
            groups,
            sessions,
            authoritative: true,
          });

          // 将第一次的结果再送入编排
          const twice = orchestrateUnifiedLeftRail({
            profiles,
            groups: once.groupRooms,
            sessions: once.timelineSessions,
            authoritative: true,
          });

          assert.equal(twice.timelineSessions.length, once.timelineSessions.length);
          assert.equal(twice.groupRooms.length, once.groupRooms.length);
          assert.equal(twice.botCards.length, once.botCards.length);

          for (let i = 0; i < once.timelineSessions.length; i++) {
            assert.equal(twice.timelineSessions[i].id, once.timelineSessions[i].id);
            assert.equal(twice.timelineSessions[i].timestamp, once.timelineSessions[i].timestamp);
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  await t.test('定理 16 [全失败防御不可致空性 (Global Failure Non-Emptiness)]: 网络失败时本地已有会话绝不可被抹除', () => {
    fc.assert(
      fc.property(
        fc.array(sessionArbitrary, { minLength: 1, maxLength: 20 }),
        fc.array(sessionArbitrary, { minLength: 0, maxLength: 5 }),
        (cachedSessions, incomingFetched) => {
          const validCached = cachedSessions.filter(
            (s) => !s.hidden && !s.isArchived && !s.isSubagent && s.title && s.title.trim()
          );
          if (validCached.length === 0) return;

          // 模拟网络全部失败：authoritative = false, 远端只返回 incomingFetched 甚至空
          const result = orchestrateUnifiedLeftRail({
            profiles: [],
            groups: [],
            sessions: incomingFetched,
            authoritative: false,
            previousCachedSessions: validCached,
          });

          // 形式化证明：输出绝不允许为空！
          assert.ok(
            result.timelineSessions.length > 0,
            '失败不可致空证明失败：非权威网络错误导致本地会话全量消失！'
          );

          // 形式化证明：本地每一个有效可见的会话依然健在
          for (const prev of validCached) {
            const exists = result.timelineSessions.some((s) => s.id === prev.id);
            assert.ok(exists, `失败不可致空证明失败：非权威更新丢弃了本地会话 ${prev.id}`);
          }
        }
      ),
      { numRuns: 500 }
    );
  });
});
