import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAgentMention,
  resolveMentionRoute,
  createChildSessionMetadata,
} from '../../dist/session/agentRouter.js';

test('AgentRouter - 跨 Agent @呼叫解析与三态会话路由契约', async (t) => {
  const knownProfiles = ['default', 'arch-wang', 'fe-zhang', 'sec-auditor'];

  await t.test('1. parseAgentMention：准确提取 @ 前缀与剩余内容', () => {
    // 匹配英文/横杠 profile
    const r1 = parseAgentMention('@arch-wang 请检查死锁', knownProfiles);
    assert.equal(r1.hasMention, true);
    assert.equal(r1.targetProfile, 'arch-wang');
    assert.equal(r1.cleanText, '请检查死锁');

    // 匹配中文 profile（不区分大小写与原样容错）
    const r2 = parseAgentMention('@架构老王 看看这个架构方案', []);
    assert.equal(r2.hasMention, true);
    assert.equal(r2.targetProfile, '架构老王');
    assert.equal(r2.cleanText, '看看这个架构方案');

    // 无 @ 呼叫
    const r3 = parseAgentMention('普通的问答内容', knownProfiles);
    assert.equal(r3.hasMention, false);
    assert.equal(r3.targetProfile, null);
    assert.equal(r3.cleanText, '普通的问答内容');

    // 空输入防崩
    const r4 = parseAgentMention('', knownProfiles);
    assert.equal(r4.hasMention, false);
    assert.equal(r4.cleanText, '');
  });

  await t.test('2. resolveMentionRoute：普通工作会话（scratchpad）走子代理委派', () => {
    const route = resolveMentionRoute('@fe-zhang 优化首屏渲染', 'scratchpad', knownProfiles);
    assert.equal(route.kind, 'subagent_delegation');
    if (route.kind === 'subagent_delegation') {
      assert.equal(route.targetProfile, 'fe-zhang');
      assert.equal(route.cleanText, '优化首屏渲染');
      assert.ok(route.taskTitle.includes('优化首屏渲染'));
    }
  });

  await t.test('3. resolveMentionRoute：Bot 终身主会话（bot_forever_chat）走 BTW 只读胶囊（防串味防记忆毒化）', () => {
    const route = resolveMentionRoute('@arch-wang 这个接口改动影响大吗？', 'bot_forever_chat', knownProfiles);
    assert.equal(route.kind, 'btw_isolated_capsule');
    if (route.kind === 'btw_isolated_capsule') {
      assert.equal(route.targetProfile, 'arch-wang');
      assert.equal(route.cleanText, '这个接口改动影响大吗？');
    }
  });

  await t.test('4. resolveMentionRoute：多 Bot 群聊（group_room）走公开房间广播', () => {
    const route = resolveMentionRoute('@sec-auditor 审查鉴权 Token 机制', 'group_room', knownProfiles);
    assert.equal(route.kind, 'group_broadcast_mention');
    if (route.kind === 'group_broadcast_mention') {
      assert.equal(route.targetProfile, 'sec-auditor');
      assert.equal(route.cleanText, '审查鉴权 Token 机制');
    }
  });

  await t.test('5. createChildSessionMetadata：父子血缘强契约构造与不可破坏约束', () => {
    // 正向生成
    const meta = createChildSessionMetadata('sess-parent-1', 'arch-wang', 'subagent');
    assert.equal(meta.parent_session_id, 'sess-parent-1');
    assert.equal(meta.bot_profile, 'arch-wang');
    assert.equal(meta.is_forever_chat, false, '派生会话绝对不可成为 forever_chat');
    assert.equal(meta.spawn_source, 'subagent');

    // 负向抛错：缺少 parentSessionId
    assert.throws(() => createChildSessionMetadata('', 'arch-wang', 'user'), /Parent session id is mandatory/);
  });
});
