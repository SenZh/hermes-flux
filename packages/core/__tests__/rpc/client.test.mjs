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
        result: { sessions: [{ id: 's-flux-01', title: 'Flux Real Session' }] },
      })
    );

    const result = await promise;
    assert.deepEqual(result, {
      sessions: [{ id: 's-flux-01', title: 'Flux Real Session' }],
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
          session_id: 's-flux-01',
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

  await t.test('listProfiles 必须原样透传 ui_meta 与 has_avatar（旧群聊房间的唯一来源）', async () => {
    const client = new HermesGatewayClient({
      url: 'ws://127.0.0.1:9119/api/ws',
      timeoutMs: 1000,
    });

    let sentFrame = null;
    client['ws'] = {
      readyState: 1,
      send(data) {
        sentFrame = JSON.parse(data);
      },
    };

    const promise = client.listProfiles();

    client['handleMessage'](
      JSON.stringify({
        jsonrpc: '2.0',
        id: sentFrame.id,
        result: {
          profiles: [
            {
              name: 'default',
              display_name: 'Hermes',
              has_avatar: true,
              ui_meta: {
                'hermes-bots-groups': {
                  rooms: {
                    'id:rmvvnkwv9-1xpyu': {
                      roomId: 'rmvvnkwv9-1xpyu',
                      name: 'Hermes, Aura',
                      members: [{ name: 'default' }, { name: 'aura' }],
                      log: [{ from: { kind: 'user', name: 'You' }, text: '历史发言', at: 1793406132119 }],
                    },
                  },
                },
              },
            },
            { name: 'xiaofawang', display_name: 'Xiaofawang', has_avatar: false },
          ],
        },
      })
    );

    const profiles = await promise;
    assert.equal(profiles.length, 2);

    const def = profiles.find((p) => p.name === 'default');
    assert.equal(def.hasAvatar, true, 'has_avatar 必须保留');
    assert.ok(def.uiMeta, 'ui_meta 必须保留，否则旧群聊永远查不到');

    const rooms = def.uiMeta['hermes-bots-groups'].rooms;
    assert.ok(rooms['id:rmvvnkwv9-1xpyu'], '旧群聊房间必须完整保留');
    assert.equal(rooms['id:rmvvnkwv9-1xpyu'].name, 'Hermes, Aura');
    assert.equal(rooms['id:rmvvnkwv9-1xpyu'].log.length, 1, '历史发言日志必须保留');

    const xfw = profiles.find((p) => p.name === 'xiaofawang');
    assert.equal(xfw.hasAvatar, false);
    assert.equal(xfw.uiMeta, undefined, '没有 ui_meta 时不得伪造空对象');
  });
});
