import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceGatewayEvent } from '../../dist/session/eventReducer.js';

const CTX = {
  activeSessionIds: ['live-42', '20261028_155631_8bcc62'],
  activeStreamingMessageId: 'ast-1',
};

test('Gateway event reducer - turn lifecycle', async (t) => {
  await t.test('message.complete terminates the turn, rewrites the final text and refreshes the rail', () => {
    // 1. Arrange
    const frame = {
      type: 'message.complete',
      session_id: 'live-42',
      payload: { text: '最终答复', usage: { total: 18 }, status: 'complete' },
    };

    // 2. Act
    const actions = reduceGatewayEvent(frame, CTX);

    // 3. Assert: the composer must be unlocked by this exact frame
    assert.deepEqual(
      actions.map((a) => a.type),
      ['replace-content', 'turn-completed', 'refresh-sessions'],
      'message.complete must replace content, unlock the turn and refresh sessions'
    );
    const replaced = actions.find((a) => a.type === 'replace-content');
    assert.equal(replaced.messageId, 'ast-1', 'Final text must target the streaming assistant message');
    assert.equal(replaced.text, '最终答复', 'Completion text is authoritative over coalesced deltas');
    const completed = actions.find((a) => a.type === 'turn-completed');
    assert.equal(completed.finalText, '最终答复', 'turn-completed must carry the final text');
  });

  await t.test('legacy session.idle / agent.turn_end frames are NOT turn terminators', () => {
    // 1. Arrange: the two event names the previous renderer relied on
    const legacyIdle = { type: 'session.idle', session_id: 'live-42', payload: {} };
    const legacyTurnEnd = { type: 'agent.turn_end', session_id: 'live-42', payload: {} };

    // 2. Act
    const idleActions = reduceGatewayEvent(legacyIdle, CTX);
    const turnEndActions = reduceGatewayEvent(legacyTurnEnd, CTX);

    // 3. Assert: neither is implemented by the gateway, so neither may unlock anything
    assert.deepEqual(idleActions, [], 'session.idle is not part of the gateway contract');
    assert.deepEqual(turnEndActions, [], 'agent.turn_end is not part of the gateway contract');
  });

  await t.test('message.complete without text unlocks the turn but keeps streamed deltas', () => {
    // 1. Arrange
    const frame = { type: 'message.complete', session_id: 'live-42', payload: { text: '', status: 'complete' } };

    // 2. Act
    const actions = reduceGatewayEvent(frame, CTX);

    // 3. Assert
    assert.deepEqual(actions.map((a) => a.type), ['turn-completed', 'refresh-sessions']);
    assert.equal(actions[0].finalText, undefined, 'Empty completion text must not overwrite the stream');
  });

  await t.test('message.start re-arms the busy state', () => {
    // 1. Arrange
    const frame = { type: 'message.start', session_id: 'live-42', payload: {} };

    // 2. Act
    const actions = reduceGatewayEvent(frame, CTX);

    // 3. Assert
    assert.deepEqual(actions, [{ type: 'turn-started' }]);
  });
});

test('Gateway event reducer - session isolation and global broadcasts', async (t) => {
  await t.test('deltas of another conversation never leak into the focused one', () => {
    // 1. Arrange
    const foreign = { type: 'message.delta', session_id: 'other-session', payload: { text: 'leak' } };

    // 2. Act
    const actions = reduceGatewayEvent(foreign, CTX);

    // 3. Assert
    assert.deepEqual(actions, [], 'A foreign session stream must be discarded');
  });

  await t.test('the stored id of the focused conversation is accepted as an alias', () => {
    // 1. Arrange
    const aliased = { type: 'message.delta', session_id: '20261028_155631_8bcc62', payload: { text: 'hi' } };

    // 2. Act
    const actions = reduceGatewayEvent(aliased, CTX);

    // 3. Assert
    assert.deepEqual(actions, [{ type: 'append-content', messageId: 'ast-1', text: 'hi' }]);
  });

  await t.test('sessions.changed refreshes the rail even when no conversation is focused', () => {
    // 1. Arrange
    const emptyCtx = { activeSessionIds: [], activeStreamingMessageId: null };

    // 2. Act
    const actions = reduceGatewayEvent({ type: 'sessions.changed', payload: {} }, emptyCtx);

    // 3. Assert
    assert.deepEqual(actions, [{ type: 'refresh-sessions' }], 'sessions.changed is the rail refresh trigger');
  });

  await t.test('session.title carries the new title for the rail', () => {
    // 1. Arrange
    const frame = { type: 'session.title', session_id: 'live-42', payload: { session_id: 'live-42', title: '  修复右侧栏  ' } };

    // 2. Act
    const actions = reduceGatewayEvent(frame, CTX);

    // 3. Assert
    assert.deepEqual(actions, [{ type: 'session-title', sessionId: 'live-42', title: '修复右侧栏' }]);
  });

  await t.test('session.title with a blank title is dropped instead of blanking the rail', () => {
    // 1. Arrange
    const frame = { type: 'session.title', session_id: 'live-42', payload: { title: '   ' } };

    // 2. Act & Assert
    assert.deepEqual(reduceGatewayEvent(frame, CTX), []);
  });
});

test('Gateway event reducer - negative and boundary inputs', async (t) => {
  await t.test('malformed frames yield no actions', () => {
    // 1. Arrange
    const samples = [null, undefined, 'event', 42, {}, { type: '' }, { payload: { text: 'x' } }];

    // 2. Act & Assert
    for (const sample of samples) {
      assert.deepEqual(reduceGatewayEvent(sample, CTX), [], `Frame ${JSON.stringify(sample)} must be ignored`);
    }
  });

  await t.test('a delta with no open assistant message is dropped', () => {
    // 1. Arrange
    const idleCtx = { activeSessionIds: ['live-42'], activeStreamingMessageId: null };

    // 2. Act
    const actions = reduceGatewayEvent({ type: 'message.delta', session_id: 'live-42', payload: { text: 'x' } }, idleCtx);

    // 3. Assert
    assert.deepEqual(actions, [], 'Deltas cannot be attached without an open message');
  });

  await t.test('error frames surface the gateway message and unlock the turn', () => {
    // 1. Arrange
    const frame = { type: 'error', payload: { message: 'gateway overloaded' } };

    // 2. Act
    const actions = reduceGatewayEvent(frame, CTX);

    // 3. Assert: Failure Is Not Empty — the reason must reach the user
    assert.deepEqual(actions, [{ type: 'turn-failed', message: 'gateway overloaded' }]);
  });

  await t.test('reasoning.delta and thinking.delta both feed the thought channel', () => {
    // 1. Arrange
    const modern = { type: 'reasoning.delta', session_id: 'live-42', payload: { text: '思考' } };
    const legacy = { type: 'thinking.delta', session_id: 'live-42', payload: { text: '思考' } };

    // 2. Act & Assert
    assert.deepEqual(reduceGatewayEvent(modern, CTX), [{ type: 'append-thought', messageId: 'ast-1', text: '思考' }]);
    assert.deepEqual(reduceGatewayEvent(legacy, CTX), [{ type: 'append-thought', messageId: 'ast-1', text: '思考' }]);
  });
});

test('Gateway event reducer - subagent delegation events', async (t) => {
  const CTX = {
    activeSessionIds: ['live-42'],
    activeStreamingMessageId: 'ast-1',
  };

  await t.test('subagent.spawn_requested produces structured subagent-spawn action', () => {
    const frame = {
      type: 'subagent.spawn_requested',
      session_id: 'live-42',
      payload: {
        subagent_id: 'sub-888',
        target_profile: 'arch-wang',
        task_title: '推演架构死锁',
      },
    };

    const actions = reduceGatewayEvent(frame, CTX);
    assert.equal(actions.length, 1);
    assert.deepEqual(actions[0], {
      type: 'subagent-spawn',
      subagentId: 'sub-888',
      profile: 'arch-wang',
      title: '推演架构死锁',
      parentSessionId: 'live-42',
      messageId: 'ast-1',
    });
  });

  await t.test('subagent.progress produces percentage and actionText update', () => {
    const frame = {
      type: 'subagent.progress',
      session_id: 'live-42',
      payload: {
        subagent_id: 'sub-888',
        progress: 45,
        action: '正在分析 call stack',
      },
    };

    const actions = reduceGatewayEvent(frame, CTX);
    assert.equal(actions.length, 1);
    assert.deepEqual(actions[0], {
      type: 'subagent-progress',
      subagentId: 'sub-888',
      progressPercent: 45,
      actionText: '正在分析 call stack',
    });
  });

  await t.test('subagent.log carries stdout and stderr with seq', () => {
    const frame = {
      type: 'subagent.log',
      session_id: 'live-42',
      payload: {
        subagent_id: 'sub-888',
        seq: 10,
        timestamp: 1000,
        text: 'build completed with 0 errors',
      },
    };

    const actions = reduceGatewayEvent(frame, CTX);
    assert.equal(actions.length, 1);
    assert.deepEqual(actions[0], {
      type: 'subagent-log',
      subagentId: 'sub-888',
      entry: {
        seq: 10,
        timestamp: 1000,
        kind: 'stdout',
        text: 'build completed with 0 errors',
      },
    });
  });

  await t.test('subagent.complete terminates subagent task and legacy tool-complete simultaneously', () => {
    const frame = {
      type: 'subagent.complete',
      session_id: 'live-42',
      payload: {
        subagent_id: 'sub-888',
        tool_call_id: 'call-1',
        output: '方案无死锁风险',
      },
    };

    const actions = reduceGatewayEvent(frame, CTX);
    // 既包含独立的 subagent-complete 与 subagent-log，也包含向后兼容的 tool-complete
    assert.ok(actions.some((a) => a.type === 'subagent-complete' && a.subagentId === 'sub-888'));
    assert.ok(actions.some((a) => a.type === 'tool-complete' && a.messageId === 'ast-1'));
  });

  await t.test('tool.end, tool.error 与复杂对象 output 格式化', () => {
    // 1. tool.end 支持且对象 output 自动 JSON.stringify 格式化
    const endFrame = {
      type: 'tool.end',
      session_id: 'live-42',
      payload: {
        id: 'tc-end-1',
        output: { status: 'success', linesModified: 42 },
      },
    };
    const endActions = reduceGatewayEvent(endFrame, CTX);
    assert.equal(endActions.length, 1);
    assert.equal(endActions[0].type, 'tool-complete');
    assert.equal(endActions[0].toolCallId, 'tc-end-1');
    assert.ok(endActions[0].output?.includes('"status": "success"'));
    assert.ok(endActions[0].output?.includes('"linesModified": 42'));

    // 2. tool.error 支持且从 error 字段安全取值
    const errFrame = {
      type: 'tool.error',
      session_id: 'live-42',
      payload: {
        id: 'tc-err-1',
        error: { code: -32000, message: 'Command timed out' },
      },
    };
    const errActions = reduceGatewayEvent(errFrame, CTX);
    assert.equal(errActions.length, 1);
    assert.equal(errActions[0].type, 'tool-complete');
    assert.equal(errActions[0].toolCallId, 'tc-err-1');
    assert.ok(errActions[0].output?.includes('Command timed out'));
  });
});

test('Gateway event contract guard - 事件 payload 必须落在契约白名单内', async (t) => {
  const { addLogSink, clearLogSinks, setLogLevel } = await import('../../dist/log/logger.js');
  const { resetEventContractReports } = await import('../../dist/session/eventReducer.js');

  function captureLogs(tt) {
    const records = [];
    const previous = setLogLevel('debug');
    clearLogSinks();
    addLogSink((r) => records.push(r), 'trace');
    tt.after(() => {
      clearLogSinks();
      setLogLevel(previous);
      resetEventContractReports();
    });
    return records;
  }

  await t.test('契约内的 payload 字段不产生告警', (tt) => {
    const records = captureLogs(tt);
    // message.delta 的契约字段是 text / rendered / verbose
    const actions = reduceGatewayEvent(
      { type: 'message.delta', session_id: 'live-42', payload: { text: '你好' } },
      CTX
    );
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'append-content');
    assert.equal(records.filter((r) => r.level === 'warn').length, 0, '合法字段不得告警');
  });

  await t.test('payload 出现契约外字段必须告警，但不中断事件流', (tt) => {
    const records = captureLogs(tt);
    const actions = reduceGatewayEvent(
      {
        type: 'message.delta',
        session_id: 'live-42',
        payload: { text: '你好', delta: '网关改名后的字段' },
      },
      CTX
    );

    // 行为不变：仍然按 text 解析
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'append-content');

    const warn = records.find((r) => r.level === 'warn' && r.message.includes('outside the gateway contract'));
    assert.ok(warn, '必须留下字段漂移的告警');
    assert.equal(warn.data.type, 'message.delta');
    assert.deepEqual(warn.data.unknownFields, ['delta']);
    assert.ok(warn.data.allowedFields.includes('text'));
  });

  await t.test('同一偏差只上报一次，避免高频事件刷爆日志', (tt) => {
    const records = captureLogs(tt);
    for (let i = 0; i < 5; i += 1) {
      reduceGatewayEvent(
        { type: 'message.delta', session_id: 'live-42', payload: { text: 'x', delta: 'y' } },
        CTX
      );
    }
    const warns = records.filter((r) => r.level === 'warn' && r.message.includes('outside the gateway contract'));
    assert.equal(warns.length, 1, `同一偏差只应上报一次，实际 ${warns.length} 次`);
  });

  await t.test('契约外的事件名只记 debug，不报错也不产生动作', (tt) => {
    const records = captureLogs(tt);
    const actions = reduceGatewayEvent(
      { type: 'brand.new.event', session_id: 'live-42', payload: { anything: 1 } },
      CTX
    );
    assert.deepEqual(actions, []);
    assert.equal(records.filter((r) => r.level === 'warn').length, 0, '未知事件不得告警');
    assert.ok(records.some((r) => r.level === 'debug' && r.message.includes('not in gateway contract')));
  });
});

