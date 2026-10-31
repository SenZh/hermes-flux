import test from 'node:test';
import assert from 'node:assert/strict';
import { HandoffService } from '../../dist/session/handoffService.js';

test('HandoffService - BTW 只读胶囊与 session.branch_whole 全权移交', async (t) => {
  await t.test('1. sendBtw：发起轻量旁路咨询与只读结果获取 (含畸变数据拦截)', async () => {
    const service = new HandoffService();
    let requestedPayload = null;

    const mockBridge = {
      async request(method, params) {
        assert.equal(method, 'prompt.btw');
        requestedPayload = params;
        return {
          response: '当前数据库索引结构合理，无死锁隐患。',
          profile: 'arch-wang',
          token_count: 42,
        };
      },
    };

    const res = await service.sendBtw(
      'sess-active-1',
      '帮我看看这个表结构设计',
      'arch-wang',
      mockBridge
    );

    assert.equal(res.profile, 'arch-wang');
    assert.ok(res.response.includes('无死锁隐患'));
    assert.equal(requestedPayload?.session_id, 'sess-active-1');
    assert.equal(requestedPayload?.target_profile, 'arch-wang');

    // 负向防护：空参数
    await assert.rejects(() => service.sendBtw('', '问句', 'arch-wang', mockBridge), /Session ID and text are mandatory/);
    await assert.rejects(() => service.sendBtw('sess-1', '', 'arch-wang', mockBridge), /Session ID and text are mandatory/);

    // 负向防护：网关返回畸变数据（非字符串 response）
    await assert.rejects(
      () => service.sendBtw('sess-1', '问句', 'arch-wang', { async request() { return {}; } }),
      /非法的 prompt.btw 响应数据/
    );
  });

  await t.test('2. handoffSession：全权接力移交与父子血缘强契约建立 (含畸变拦截)', async () => {
    const service = new HandoffService();
    let branchedPayload = null;

    const mockBridge = {
      async request(method, params) {
        assert.equal(method, 'session.branch_whole');
        branchedPayload = params;
        return {
          session_id: 'sess-branched-999',
          parent_session_id: 'sess-parent-42',
        };
      },
    };

    const res = await service.handoffSession(
      'sess-parent-42',
      'fe-zhang',
      mockBridge,
      '接力继续优化首屏渲染'
    );

    assert.equal(res.newSessionId, 'sess-branched-999');
    assert.equal(res.parentSessionId, 'sess-parent-42');
    assert.equal(res.targetProfile, 'fe-zhang');
    assert.equal(branchedPayload?.name, '接力继续优化首屏渲染');

    // 校验血缘强契约
    assert.equal(res.metadata.parent_session_id, 'sess-parent-42');
    assert.equal(res.metadata.bot_profile, 'fe-zhang');
    assert.equal(res.metadata.is_forever_chat, false, '派生会话绝对不可成为 forever chat');

    // 负向防护：参数缺失
    await assert.rejects(() => service.handoffSession('sess-1', '', mockBridge), /target profile are mandatory/);
    await assert.rejects(() => service.handoffSession('', 'fe-zhang', mockBridge), /target profile are mandatory/);

    // 负向防护：网关未返回合法的 new session_id
    await assert.rejects(
      () => service.handoffSession('sess-1', 'fe-zhang', { async request() { return {}; } }),
      /未返回合法的 new session_id/
    );
  });
});
