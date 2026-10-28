import test from 'node:test';
import assert from 'node:assert/strict';

test('Hermes Live Gateway End-to-End WebSocket Integration', async (t) => {
  const baseUrl = process.env.HERMES_TEST_GATEWAY_URL || 'http://127.0.0.1:9119';
  const username = process.env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME;
  const password = process.env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD;

  if (!username || !password) {
    t.skip('Skipping live gateway integration test: credentials not provided in environment');
    return;
  }

  await t.test('Step 1: POST /auth/password-login against real Gateway 9119', async () => {
    const res = await fetch(`${baseUrl}/auth/password-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': baseUrl,
      },
      body: JSON.stringify({
        username,
        password,
        provider: 'basic',
      }),
    });

    assert.equal(res.status, 200, 'Password login must return HTTP 200');
    const data = await res.json();
    assert.equal(data.ok, true, 'Response body must contain ok: true');

    // Extract cookies from Set-Cookie header
    const setCookie = res.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('hermes_session_at'), 'Must receive hermes_session_at cookie');
  });

  await t.test('Step 2: Mint WS Ticket and Connect WebSocket JSON-RPC 2.0 to Real Gateway', async () => {
    // 1. Login to get cookie
    const loginRes = await fetch(`${baseUrl}/auth/password-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': baseUrl,
      },
      body: JSON.stringify({ username, password, provider: 'basic' }),
    });
    const cookie = loginRes.headers.get('set-cookie') || '';

    // 2. Mint single-use ticket
    const ticketRes = await fetch(`${baseUrl}/api/auth/ws-ticket`, {
      method: 'POST',
      headers: {
        'Cookie': cookie,
        'Accept': 'application/json',
        'Origin': baseUrl,
      },
    });
    assert.equal(ticketRes.status, 200, 'ws-ticket endpoint must return HTTP 200');
    const ticketData = await ticketRes.json();
    assert.ok(ticketData.ticket, 'Must receive a valid ticket string');
    assert.equal(typeof ticketData.ticket, 'string');

    // 3. Connect real WebSocket
    const wsUrl = `ws://127.0.0.1:9119/api/ws?ticket=${ticketData.ticket}`;
    const ws = new WebSocket(wsUrl);

    const connected = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), 3000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(true);
      };
      ws.onerror = (err) => {
        clearTimeout(timer);
        reject(err);
      };
    });
    assert.equal(connected, true, 'WebSocket must reach readyState OPEN');

    // 4. Send real session.list RPC
    const rpcPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('RPC session.list timeout')), 3000);
      ws.onmessage = (event) => {
        const frame = JSON.parse(event.data);
        if (frame.id === 'test-live-session-list') {
          clearTimeout(timer);
          resolve(frame);
        }
      };
      ws.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'test-live-session-list',
          method: 'session.list',
          params: { limit: 5 },
        })
      );
    });

    const rpcResult = await rpcPromise;
    assert.equal(rpcResult.jsonrpc, '2.0');
    assert.ok(rpcResult.result, 'RPC response must contain result');
    assert.ok(Array.isArray(rpcResult.result.sessions), 'Result must contain sessions array');
    assert.ok(rpcResult.result.sessions.length > 0, 'Real Gateway must return active sessions');

    // Clean close
    ws.close();
  });
});
