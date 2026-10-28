import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesGatewayClient } from '../../dist/rpc/client.js';

test('HermesGatewayClient JSON-RPC 2.0 Unit Tests', async (t) => {
  await t.test('Client should format standard JSON-RPC 2.0 call and resolve result', async () => {
    const client = new HermesGatewayClient({
      url: 'ws://127.0.0.1:9119/api/ws',
      timeoutMs: 1000,
    });

    let sentFrame = null;
    const mockWs = {
      readyState: 1, // WebSocket.OPEN
      send(data) {
        sentFrame = JSON.parse(data);
      },
    };

    // Inject active mock ws socket
    client['ws'] = mockWs;

    const promise = client.call('session.list', { profile: 'default' });

    assert.ok(sentFrame, 'Must have sent a frame');
    assert.equal(sentFrame.jsonrpc, '2.0');
    assert.equal(sentFrame.method, 'session.list');
    assert.deepEqual(sentFrame.params, { profile: 'default' });
    assert.ok(sentFrame.id);

    // Simulate incoming server JSON-RPC response
    client['handleMessage'](
      JSON.stringify({
        jsonrpc: '2.0',
        id: sentFrame.id,
        result: { sessions: [{ id: 's-aura-01', title: 'Aura Real Session' }] },
      })
    );

    const result = await promise;
    assert.deepEqual(result, {
      sessions: [{ id: 's-aura-01', title: 'Aura Real Session' }],
    });
  });

  await t.test('Client should reject on JSON-RPC error response', async () => {
    const client = new HermesGatewayClient({
      url: 'ws://127.0.0.1:9119/api/ws',
      timeoutMs: 1000,
    });

    let sentFrame = null;
    const mockWs = {
      readyState: 1,
      send(data) {
        sentFrame = JSON.parse(data);
      },
    };
    client['ws'] = mockWs;

    const promise = client.call('session.delete', { id: 'invalid-id' });

    client['handleMessage'](
      JSON.stringify({
        jsonrpc: '2.0',
        id: sentFrame.id,
        error: { code: -32602, message: 'Session not found' },
      })
    );

    await assert.rejects(promise, (err) => {
      assert.equal(err.code, -32602);
      assert.equal(err.message, 'Session not found');
      return true;
    });
  });

  await t.test('Client should deliver server notifications to registered handlers', async () => {
    const client = new HermesGatewayClient({
      url: 'ws://127.0.0.1:9119/api/ws',
    });

    let receivedData = null;
    const unsubscribe = client.onNotification('message.delta', (params) => {
      receivedData = params;
    });

    client['handleMessage'](
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'message.delta',
        params: {
          session_id: 's-aura-01',
          delta: '真实流式 Token',
        },
      })
    );

    assert.ok(receivedData);
    assert.equal(receivedData.delta, '真实流式 Token');

    // Unsubscribe verification
    unsubscribe();
    receivedData = null;
    client['handleMessage'](
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'message.delta',
        params: { delta: 'Should not receive' },
      })
    );
    assert.equal(receivedData, null, 'Must not receive after unsubscribe');
  });
});
