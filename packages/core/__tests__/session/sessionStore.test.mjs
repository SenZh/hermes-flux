import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../../dist/session/sessionStore.js';

test('SessionStore Universal State Controller', async (t) => {
  await t.test('initializes with default multi-platform state', () => {
    const store = new SessionStore();
    const state = store.getState();
    assert.equal(state.platform, 'web');
    assert.equal(state.gatewayConnected, false);
    assert.equal(state.selectedModel, 'hermes-3-llama-3.1-8b');
    assert.equal(state.activeSessionId, '');
  });

  await t.test('updates state and notifies listeners correctly', () => {
    const store = new SessionStore();
    let notifiedState = null;
    const unsub = store.subscribe((s) => {
      notifiedState = s;
    });

    store.setActiveSession('sess_123', 'live_456');
    assert.ok(notifiedState);
    assert.equal(notifiedState.activeSessionId, 'sess_123');
    assert.equal(notifiedState.activeLiveSessionId, 'live_456');

    store.setGatewayStatus(true, false, 15);
    assert.equal(notifiedState.gatewayConnected, true);
    assert.equal(notifiedState.gatewayLatencyMs, 15);

    unsub();
    store.setActiveSession('sess_999');
    assert.equal(notifiedState.activeSessionId, 'sess_123', 'Unsubscribed listener should not be notified');
  });
});
