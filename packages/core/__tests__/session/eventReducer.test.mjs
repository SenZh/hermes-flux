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
