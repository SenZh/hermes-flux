import test from 'node:test';
import assert from 'node:assert/strict';
import { InteractiveService } from '../../dist/session/interactiveService.js';

test('InteractiveService - 交互区领域服务全量契约测试', async (t) => {
  const calls = [];
  const mockBridge = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === 'prompt.submit') {
        return { status: 'streaming', user_row_id: 10 };
      }
      if (method === 'session.undo') {
        return { removed: 2 };
      }
      if (method === 'session.branch') {
        return { session_id: 'new-sess-42', parent: params.session_id, message_count: params.count };
      }
      if (method === 'session.steer') {
        return { status: 'queued', text: params.text };
      }
      if (method === 'session.interrupt') {
        return { status: 'interrupted' };
      }
      if (method === 'commands.catalog') {
        return { commands: { '/model': {} }, skills: { 'code-review': {} }, categories: [] };
      }
      if (method === 'session.usage') {
        return { context_used: 42000, context_max: 128000, avg_tps: 85.5 };
      }
      if (method === 'prompt.cancel' || method === 'prompt.steer_queued') {
        return { admission_id: params.admission_id, status: 'terminal', sequence: 1, outcome: 'cancelled', authority_epoch: 1, execution_generation: null, ref: { profile_id: 'default', session_id: params.session_id } };
      }
      throw new Error(`Unknown method: ${method}`);
    },
  };

  const service = new InteractiveService();

  await t.test('1. truncateAndSubmit: 唯一持久锚点 rowId 且严禁携带 message_id', async () => {
    calls.length = 0;
    const res = await service.truncateAndSubmit(mockBridge, {
      sessionId: 'sess-100',
      text: '改写后的提问',
      rowId: 5,
      profile: 'bot-coder',
    });

    assert.equal(res.status, 'streaming');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'prompt.submit');
    assert.deepEqual(calls[0].params, {
      session_id: 'sess-100',
      text: '改写后的提问',
      confirm_truncate: true,
      truncate_before_row_id: 5,
      profile: 'bot-coder',
    });
    assert.ok(!('truncate_before_message_id' in calls[0].params), '双锚点严格互斥：row 通道不得携带 message_id 键');
  });

  await t.test('2. undoLastTurn: 传递 intent: undo', async () => {
    calls.length = 0;
    const res = await service.undoLastTurn(mockBridge, 'sess-100');
    assert.equal(res.removed, 2);
    assert.equal(calls[0].method, 'session.undo');
    assert.deepEqual(calls[0].params, {
      session_id: 'sess-100',
      intent: 'undo',
      profile: null,
    });
  });

  await t.test('3. forkSession: 传递 count 与 name', async () => {
    calls.length = 0;
    const res = await service.forkSession(mockBridge, {
      sessionId: 'sess-100',
      count: 4,
      name: '分支会话',
    });
    assert.equal(res.session_id, 'new-sess-42');
    assert.equal(calls[0].method, 'session.branch');
    assert.deepEqual(calls[0].params, {
      session_id: 'sess-100',
      count: 4,
      name: '分支会话',
      profile: null,
      idempotency_key: null,
    });
  });

  await t.test('3b. forkSession: 显式传入幂等键时原样透传', async () => {
    calls.length = 0;
    await service.forkSession(mockBridge, {
      sessionId: 'sess-100',
      count: 2,
      idempotencyKey: 'idem-abc-123',
    });
    assert.equal(calls[0].params.idempotency_key, 'idem-abc-123');
  });

  await t.test('4. steerSession: 传递运行时纠偏指令', async () => {
    calls.length = 0;
    const res = await service.steerSession(mockBridge, 'sess-100', '请改用 TypeScript');
    assert.equal(res.status, 'queued');
    assert.equal(calls[0].method, 'session.steer');
    assert.deepEqual(calls[0].params, {
      session_id: 'sess-100',
      text: '请改用 TypeScript',
      profile: null,
    });
  });

  await t.test('5. interruptSession: 紧急打断', async () => {
    calls.length = 0;
    const res = await service.interruptSession(mockBridge, 'sess-100');
    assert.equal(res.status, 'interrupted');
    assert.equal(calls[0].method, 'session.interrupt');
    assert.deepEqual(calls[0].params, {
      session_id: 'sess-100',
      profile: null,
    });
  });

  await t.test('6. getCommandsCatalog 与 getSessionUsage', async () => {
    calls.length = 0;
    const catalog = await service.getCommandsCatalog(mockBridge, 'sess-100');
    assert.ok(catalog.skills['code-review']);
    assert.equal(calls[0].method, 'commands.catalog');

    const usage = await service.getSessionUsage(mockBridge, 'sess-100');
    assert.equal(usage.context_used, 42000);
    assert.equal(usage.context_max, 128000);
  });

  await t.test('7. truncateAndSubmit: 服务端签发字符串锚点窄通道（rowId 缺席时）', async () => {
    calls.length = 0;
    const res = await service.truncateAndSubmit(mockBridge, {
      sessionId: 'sess-100',
      text: '按消息ID截断',
      messageId: 'server-row-99',
    });
    assert.equal(res.status, 'streaming');
    assert.equal(calls[0].params.truncate_before_message_id, 'server-row-99');
    assert.ok(!('truncate_before_row_id' in calls[0].params), '双锚点互斥：message 通道不得携带 row_id 键');
  });

  await t.test('7b. truncateAndSubmit: 前端临时 id 逃逸为锚点必须发送前拦截（4018 回归守卫）', async () => {
    calls.length = 0;
    await assert.rejects(
      async () => service.truncateAndSubmit(mockBridge, {
        sessionId: 'sess-100',
        text: 'A',
        messageId: `usr-${Date.now()}`,
      }),
      /client temp ids are forbidden/
    );
    await assert.rejects(
      async () => service.truncateAndSubmit(mockBridge, {
        sessionId: 'sess-100',
        text: 'A',
        rowId: -7,
      }),
      /client temp ids are forbidden/
    );
    assert.equal(calls.length, 0, '非法锚点绝不许穿透到网络层');
  });

  await t.test('8. 负向守卫校验：缺失必填参数必须报错拒绝', async () => {
    await assert.rejects(
      async () => service.truncateAndSubmit(mockBridge, { sessionId: '', text: 'A' }),
      /Session ID is mandatory/
    );
    await assert.rejects(
      async () => service.truncateAndSubmit(mockBridge, { sessionId: 's1', text: 'A' }),
      /one durable target/
    );
    await assert.rejects(
      async () => service.forkSession(mockBridge, { sessionId: 's1', count: -1 }),
      /Valid message count is mandatory/
    );
    await assert.rejects(
      async () => service.steerSession(mockBridge, '', 'Text'),
      /Session ID and text are mandatory/
    );
    await assert.rejects(
      async () => service.undoLastTurn(mockBridge, ''),
      /Session ID is mandatory/
    );
    await assert.rejects(
      async () => service.interruptSession(mockBridge, ''),
      /Session ID is mandatory/
    );
    await assert.rejects(
      async () => service.getSessionUsage(mockBridge, ''),
      /Session ID is mandatory/
    );
  });

  await t.test('9. 队列控制：按准入 id 定位，缺一即拒绝', async () => {
    calls.length = 0;

    await service.cancelQueued(mockBridge, 'sess-1', 'adm-1');
    assert.deepEqual(calls.at(-1), {
      method: 'prompt.cancel',
      params: { session_id: 'sess-1', admission_id: 'adm-1' },
    });

    await service.steerQueued(mockBridge, 'sess-1', 'adm-2', 'default');
    assert.deepEqual(calls.at(-1), {
      method: 'prompt.steer_queued',
      params: { session_id: 'sess-1', admission_id: 'adm-2', profile: 'default' },
    });

    const before = calls.length;
    await assert.rejects(async () => service.cancelQueued(mockBridge, 'sess-1', ''), /admission ID are mandatory/);
    await assert.rejects(async () => service.cancelQueued(mockBridge, '', 'adm-1'), /admission ID are mandatory/);
    await assert.rejects(async () => service.steerQueued(mockBridge, 'sess-1', ''), /admission ID are mandatory/);
    assert.equal(calls.length, before, '缺参数绝不许穿透到网络层');
  });

  await t.test('10. execSlash 遇到 skill command 自动无缝降级转接 command.dispatch', async () => {
    calls.length = 0;

    // 10.1 模拟网关返回 4018: skill command: use command.dispatch for /human-writing
    const fallbackBridge = {
      request: async (method, params, timeoutMs) => {
        calls.push({ method, params, timeoutMs });
        if (method === 'slash.exec') {
          const err = new Error('skill command: use command.dispatch for /human-writing');
          err.code = 4018;
          throw err;
        }
        if (method === 'command.dispatch') {
          return {
            type: 'skill',
            name: params.name,
            message: `Loaded skill: ${params.name} with arg: ${params.arg}`,
            display: `/${params.name}`,
          };
        }
        return {};
      },
    };

    const res = await service.execSlash(fallbackBridge, 'sess-skill-1', '/human-writing 探讨小说结构', 'default', 120_000);
    assert.equal(res.type, 'skill');
    assert.equal(res.name, 'human-writing');
    assert.ok(res.message.includes('探讨小说结构'));

    // 验证调用链：第一次调 slash.exec，抛错后自动调 command.dispatch 且参数拆分精确无误
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'slash.exec');
    assert.equal(calls[0].params.command, '/human-writing 探讨小说结构');
    assert.equal(calls[1].method, 'command.dispatch');
    assert.deepEqual(calls[1].params, {
      session_id: 'sess-skill-1',
      name: 'human-writing',
      arg: '探讨小说结构',
      profile: 'default',
    });
    assert.equal(calls[1].timeoutMs, 120_000, '超时时间必须原样透传至 command.dispatch');

    // 10.2 验证显式 dispatchCommand
    calls.length = 0;
    const directRes = await service.dispatchCommand(fallbackBridge, 'sess-skill-2', '/code-review', 'src/main.ts');
    assert.equal(directRes.type, 'skill');
    assert.deepEqual(calls[0], {
      method: 'command.dispatch',
      params: {
        session_id: 'sess-skill-2',
        name: 'code-review',
        arg: 'src/main.ts',
        profile: null,
      },
      timeoutMs: undefined,
    });
  });
});
