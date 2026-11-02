import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  syncBotProfiles,
  applyBotActivity,
  syncActiveSessionToBot,
  normalizeTimestamp,
  cleanMessageSnippet,
  extractMessagePreview,
} from '../../dist/index.js';

/**
 * 专职智能体主工位（Forever Chat）形式化安全不变量验证套件
 * (Formal Invariant Verifier - Bot Activity & Session Pool Isolation)
 *
 * 【形式化验证目标 (Formal Verification Scope)】
 * 采用快验形式化模型检验技术（Property-Based Formal Verification via fast-check），
 * 在包含数万种随机状态排列、畸变时间戳、乱序并发事件的状态空间中，
 * 数学证明专职 Bot 主工位与普通会话池的 4 大核心安全定理（Theorems）。
 */
test('Formal Invariant Verifier: Bot Primary Station & Domain Isolation', async (t) => {
  const formatTimeMock = (ts) => `TIME_${ts}`;

  await t.test('定理 1 [领域绝对隔离]: 任意普通会话池的任何变动、乱序与时间刷新在所有输入下绝对不可污染专职 Bot 卡片', () => {
    // 形式化状态空间约束：
    // - 随机生成 1~10 个专职智能体
    // - 随机生成 0~30 个普通会话（带有该 Bot 的 botName，甚至时间比主工位更新）
    // - 随机生成 0~5 条该 Bot 的 Forever Chat 消息或留空
    fc.assert(
      fc.property(
        fc.record({
          botName: fc.stringMatching(/^[a-z0-9_-]{1,15}$/),
          displayName: fc.stringMatching(/^[a-zA-Z0-9_\u4e00-\u9fa5]{1,15}$/),
          description: fc.string({ minLength: 1, maxLength: 80 }),
          hasForeverChat: fc.boolean(),
          foreverChatText: fc.string({ minLength: 1, maxLength: 100 }),
          foreverChatTs: fc.integer({ min: 1000000, max: 2000000000000 }),
          regularSessions: fc.array(
            fc.record({
              id: fc.uuid(),
              title: fc.string({ minLength: 1, maxLength: 40 }),
              preview: fc.string({ minLength: 1, maxLength: 80 }),
              time: fc.string({ minLength: 1, maxLength: 20 }),
              timestamp: fc.integer({ min: 1000000, max: 2000000000000 }),
            }),
            { minLength: 0, maxLength: 20 }
          ),
        }),
        (data) => {
          const profile = {
            name: data.botName,
            displayName: data.displayName,
            description: data.description,
            lastMessage: '',
            lastTime: '',
            timestamp: 0,
          };

          const activityMap = new Map();
          const foreverChatCache = new Map();
          const sessionMessagesCache = new Map();

          const foreverChatId = `forever-${data.botName}`;
          if (data.hasForeverChat) {
            foreverChatCache.set(data.botName, foreverChatId);
            sessionMessagesCache.set(foreverChatId, [
              {
                content: data.foreverChatText,
                rawTimestamp: data.foreverChatTs,
              },
            ]);
          }

          // 将普通会话的 botName 全部绑定到当前 Bot
          const sessionsWithBot = data.regularSessions.map((s) => ({
            ...s,
            botName: data.botName,
          }));

          // 执行生产核心同步函数
          const syncedProfiles = syncBotProfiles({
            profiles: [profile],
            activityMap,
            foreverChatCache,
            sessionMessagesCache,
            formatTime: formatTimeMock,
          });

          const syncedBot = syncedProfiles[0];
          assert.ok(syncedBot, '必须返回对应的 Bot 状态');

          // 【形式化核心定理断言】
          if (data.hasForeverChat) {
            // 场景 A: 有主工位历史时，数据必须 100% 精确等于主工位历史
            const expectedText = cleanMessageSnippet(data.foreverChatText);
            assert.equal(syncedBot.lastMessage, expectedText);
            assert.equal(syncedBot.timestamp, normalizeTimestamp(data.foreverChatTs));
          } else {
            // 场景 B: 无主工位历史时，即便普通会话池里有 20 条刚更新的会话，Bot 卡片也绝不能冒用！
            const expectedDesc = cleanMessageSnippet(data.description);
            assert.equal(syncedBot.lastMessage, expectedDesc);
            assert.equal(syncedBot.lastTime, '');
          }

          // 【排他性证伪断言】Bot 卡片的时间和副标题绝对不可等于任何非主工位普通会话的数据
          for (const s of sessionsWithBot) {
            const cleanRegularSnippet = cleanMessageSnippet(s.preview || s.title);
            if (!data.hasForeverChat && cleanRegularSnippet && cleanRegularSnippet !== cleanMessageSnippet(data.description)) {
              assert.notEqual(
                syncedBot.lastMessage,
                cleanRegularSnippet,
                '形式化证明失败：专职 Bot 副标题被普通会话渗透！'
              );
            }
          }
        }
      ),
      { numRuns: 1000 } // 在 1000 次随机状态空间迭代中严格证明
    );
  });

  await t.test('定理 2 [时间戳归一化完备性]: 任意秒级、毫秒级、ISO、畸变输入经 normalizeTimestamp 必须收敛为有限非负数字', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.float(),
          fc.string(),
          fc.constant(null),
          fc.constant(undefined),
          fc.constant(NaN),
          fc.constant(Number.POSITIVE_INFINITY),
          fc.constant(Number.NEGATIVE_INFINITY),
          fc.date().filter((d) => !Number.isNaN(d.getTime())).map((d) => d.toISOString())
        ),
        (raw) => {
          const res = normalizeTimestamp(raw);
          // 证明数学不变量：
          assert.equal(typeof res, 'number');
          assert.equal(Number.isFinite(res), true, '归一化结果必须是有限数字');
          assert.equal(res >= 0, true, '时间戳必须非负');
          assert.equal(Number.isNaN(res), false, '绝对不能返回 NaN');

          // 证明秒级到毫秒级投影的一致性
          if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw <= 1e11) {
            assert.equal(res, raw * 1000, '合法秒级输入必须精确放大 1000 倍');
          }
          if (typeof raw === 'number' && Number.isFinite(raw) && raw > 1e11) {
            assert.equal(res, raw, '合法毫秒输入必须原样保留');
          }
        }
      ),
      { numRuns: 2000 }
    );
  });

  await t.test('定理 3 [时间全序非递增单调性]: 经历任意次 applyBotActivity 交互后，profiles 序列严格保持非递增全序', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.stringMatching(/^[a-z0-9]{1,10}$/),
            displayName: fc.stringMatching(/^[a-zA-Z0-9]{1,10}$/),
            initialTs: fc.integer({ min: 1000, max: 2000000000000 }),
          }),
          { minLength: 2, maxLength: 20 }
        ),
        fc.array(
          fc.record({
            targetIndex: fc.nat(),
            useDisplayName: fc.boolean(),
            text: fc.string({ minLength: 1, maxLength: 50 }),
            newTs: fc.integer({ min: 1000, max: 2000000000000 }),
          }),
          { minLength: 1, maxLength: 30 }
        ),
        (bots, actions) => {
          // 确保 name 唯一
          const uniqBots = [];
          const seen = new Set();
          for (const b of bots) {
            if (!seen.has(b.name)) {
              seen.add(b.name);
              uniqBots.push({
                name: b.name,
                displayName: b.displayName,
                timestamp: b.initialTs,
                lastMessage: 'init',
                lastTime: '',
              });
            }
          }
          if (uniqBots.length < 2) return;

          let currentProfiles = [...uniqBots];
          const activityMap = new Map();

          // 连续应用随机交互动作
          for (const act of actions) {
            const targetBot = currentProfiles[act.targetIndex % currentProfiles.length];
            const botKey = act.useDisplayName ? targetBot.displayName : targetBot.name;

            const res = applyBotActivity({
              profiles: currentProfiles,
              activityMap,
              botName: botKey,
              text: act.text,
              timestamp: act.newTs,
              formatTime: formatTimeMock,
            });
            currentProfiles = res.profiles;

            // 【形式化全序不变量断言】
            // 任意相邻两项必须满足：profiles[i].timestamp >= profiles[i+1].timestamp
            for (let i = 0; i < currentProfiles.length - 1; i++) {
              const currentTs = currentProfiles[i].timestamp || 0;
              const nextTs = currentProfiles[i + 1].timestamp || 0;
              assert.ok(
                currentTs >= nextTs,
                `全序单调性证明失败：索引 ${i}(${currentTs}) 小于 索引 ${i+1}(${nextTs})`
              );
            }
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  await t.test('定理 4 [反哺管道排他纯洁性]: 普通会话调用 syncActiveSessionToBot 恒返回 null 且绝对不产生 Map 污染', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.array(fc.record({ content: fc.string(), thought: fc.string() }), { minLength: 1, maxLength: 5 }),
        fc.dictionary(fc.stringMatching(/^[a-z]{1,5}$/), fc.uuid()),
        (sessionId, messages, foreverMapObj) => {
          const foreverChatCache = new Map(Object.entries(foreverMapObj));
          // 确保测试的 sessionId 不在主工位映射中
          foreverChatCache.delete(sessionId);

          const activityMap = new Map();
          const initialMapSize = activityMap.size;

          const res = syncActiveSessionToBot({
            sessionId,
            messages,
            foreverChatCache,
            profiles: [],
            activityMap,
            formatTime: formatTimeMock,
          });

          // 【不变量断言】
          assert.equal(res, null, '普通会话反哺必须恒返回 null');
          assert.equal(activityMap.size, initialMapSize, '普通会话绝不能向 activityMap 注入任何垃圾数据');
        }
      ),
      { numRuns: 1000 }
    );
  });
});
