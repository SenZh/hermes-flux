import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketFsm, DEFAULT_FSM_CONFIG } from '../../dist/rpc/fsm.js';

test('WebSocketFsm Finite State Machine Unit Tests', async (t) => {
  await t.test('FSM should initialize in DISCONNECTED state', () => {
    const fsm = new WebSocketFsm();
    assert.equal(fsm.getState(), 'DISCONNECTED');
  });

  await t.test('FSM should transition between states and notify listeners', () => {
    const fsm = new WebSocketFsm();
    const transitions = [];

    const unsubscribe = fsm.onStateChange((next, prev) => {
      transitions.push({ next, prev });
    });

    fsm.transitionTo('CONNECTING');
    fsm.transitionTo('HANDSHAKING');
    fsm.transitionTo('CONNECTED');

    assert.equal(fsm.getState(), 'CONNECTED');
    assert.deepEqual(transitions, [
      { next: 'CONNECTING', prev: 'DISCONNECTED' },
      { next: 'HANDSHAKING', prev: 'CONNECTING' },
      { next: 'CONNECTED', prev: 'HANDSHAKING' },
    ]);

    unsubscribe();
    fsm.transitionTo('DISCONNECTED');
    // transition count should still be 3 after unsubscribe
    assert.equal(transitions.length, 3);
  });

  await t.test('FSM should compute exponential backoff with full jitter within bounds', () => {
    const config = {
      initialDelayMs: 100,
      maxDelayMs: 1000,
      backoffFactor: 2,
    };
    const fsm = new WebSocketFsm(config);

    // Attempt 0: raw 100 * (2^0) = 100 => bounds [0, 100]
    const d0 = fsm.getNextBackoffMs();
    assert.ok(d0 >= 0 && d0 <= 100, `Delay d0=${d0} must be in [0, 100]`);

    // Attempt 1: raw 100 * (2^1) = 200 => bounds [0, 200]
    const d1 = fsm.getNextBackoffMs();
    assert.ok(d1 >= 0 && d1 <= 200, `Delay d1=${d1} must be in [0, 200]`);

    // Advance attempts to cap at maxDelayMs (1000)
    for (let i = 0; i < 10; i++) {
      fsm.getNextBackoffMs();
    }
    const dCapped = fsm.getNextBackoffMs();
    assert.ok(dCapped >= 0 && dCapped <= 1000, `Capped delay=${dCapped} must be in [0, 1000]`);

    // Reset attempts
    fsm.resetAttempts();
    const dReset = fsm.getNextBackoffMs();
    assert.ok(dReset >= 0 && dReset <= 100, `Reset delay=${dReset} must be in [0, 100]`);
  });
});
