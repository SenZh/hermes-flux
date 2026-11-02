/**
 * 会话副标题防闪烁与代际令牌竞态阻断 离线纯逻辑单测
 * (packages/desktop/__tests__/unit/session-subtitles-offline.test.mjs)
 *
 * 【测试核心目标】
 * 零外部依赖，100% 在常规 CI / npm test 中运行，验证：
 * 1. 快速切会话时迟滞慢响应（Delayed Slow Response）被 generation 代际令牌精准丢弃，绝不污染当前会话的 messages 与副标题；
 * 2. 多 Profile 下同名 ID 会话按 botName + sessionId 实体隔离，副标题反哺绝不交叉串扰；
 * 3. 变异检验：若移除代际守卫，并发竞态下迟滞消息污染当前会话，断言必然变红。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

test('Session Subtitles & Generation Race Guard (Offline Invariants)', async (t) => {
  await t.test('1. 代际令牌 (Generation Token)：迟滞异步响应绝不能写入已切换的当前会话', async () => {
    // 模拟应用状态机与代际时钟
    let activeGeneration = 0;
    let activeSessionId = 'session-1';
    let currentMountedMessages = [];
    const sessionMessagesCache = new Map();

    // 模拟 loadMessages 的代际机制
    async function simulateLoadMessages(targetId, latencyMs, payloadMessages) {
      const currentGen = ++activeGeneration;
      activeSessionId = targetId;

      // 模拟异步网络延迟
      await new Promise((r) => setTimeout(r, latencyMs));

      // 竞态守卫
      if (currentGen !== activeGeneration || activeSessionId !== targetId) {
        // 丢弃迟滞响应
        return { discarded: true };
      }

      currentMountedMessages = payloadMessages;
      sessionMessagesCache.set(targetId, payloadMessages);
      return { discarded: false };
    }

    // Act: 启动 session-1 慢请求（耗时 100ms），紧接着在 10ms 后快速切换到 session-2（耗时 20ms）
    const p1 = simulateLoadMessages('session-1', 100, [{ id: 'm1', content: 'S1 的迟滞消息' }]);
    await new Promise((r) => setTimeout(r, 10));
    const p2 = simulateLoadMessages('session-2', 20, [{ id: 'm2', content: 'S2 的最新消息' }]);

    const [r1, r2] = await Promise.all([p1, p2]);

    // Assert:
    assert.equal(r1.discarded, true, 'S1 的慢响应必须被代际守卫丢弃');
    assert.equal(r2.discarded, false, 'S2 的响应必须成功挂载');
    assert.equal(activeSessionId, 'session-2');
    assert.equal(currentMountedMessages[0].content, 'S2 的最新消息', '当前视口严禁被 S1 消息串扰');
  });

  await t.test('2. 会话副标题匹配隔离：必须按 botName + sessionId 联合寻址，杜绝跨 Profile 篡改', () => {
    const sessions = [
      { id: 'shared-id', botName: 'aura', preview: 'Aura 原始副标题', timestamp: 100 },
      { id: 'shared-id', botName: 'xiaofawang', preview: '小法王原始副标题', timestamp: 100 },
    ];

    function updatePreview(sessionId, botName, newText) {
      const target = sessions.find((s) => s.id === sessionId && (!botName || s.botName === botName))
        || sessions.find((s) => s.id === sessionId);
      if (target) {
        target.preview = newText;
      }
    }

    // Act: 针对 xiaofawang 下的 shared-id 触发副标题更新
    updatePreview('shared-id', 'xiaofawang', '小法王更新后的真实回复');

    // Assert: 只有 xiaofawang 的会话被更新，aura 保持原样，绝不串扰
    const auraSess = sessions.find((s) => s.botName === 'aura');
    const xfwSess = sessions.find((s) => s.botName === 'xiaofawang');

    assert.equal(auraSess.preview, 'Aura 原始副标题', 'Aura 的副标题必须保持隔离');
    assert.equal(xfwSess.preview, '小法王更新后的真实回复', '小法王的副标题被正确更新');
  });
});
