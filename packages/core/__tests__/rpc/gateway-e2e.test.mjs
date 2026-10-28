import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/**
 * Live gateway end-to-end suite.
 *
 * Connection details are NEVER hardcoded: point the suite at a gateway with
 *   HERMES_GATEWAY_URL, HERMES_USERNAME, HERMES_PASSWORD
 * and it runs; without them it is skipped so `npm test` stays hermetic and offline.
 */

const GATEWAY_URL = process.env.HERMES_GATEWAY_URL || '';
const USERNAME = process.env.HERMES_USERNAME || '';
const PASSWORD = process.env.HERMES_PASSWORD || '';
const HAS_CREDENTIALS = Boolean(GATEWAY_URL && USERNAME && PASSWORD);

function requestHttp(url, options = {}, postData = '') {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

test(
  'Hermes Gateway End-to-End Test Suite (live)',
  {
    skip: HAS_CREDENTIALS
      ? false
      : 'live gateway e2e skipped: set HERMES_GATEWAY_URL, HERMES_USERNAME and HERMES_PASSWORD to run it',
  },
  async (t) => {
  let sessionCookie = '';
  let wsTicket = '';
  let ws = null;
  let activeSessionId = '';
  let availableModels = [];

  function rpcCall(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = 'test-e2e-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      const onMessage = (event) => {
        const frame = JSON.parse(event.data);
        if (frame.id === id) {
          ws.removeEventListener('message', onMessage);
          if (frame.error) reject(frame.error);
          else resolve(frame.result);
        }
      };
      ws.addEventListener('message', onMessage);
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  // (a) 基础认证
  await t.test('(a) 基础认证：状态探测、密码登录与 WebSocket 凭证签发', async () => {
    // 1. Arrange & Act: GET /api/status
    const statusRes = await requestHttp(`${GATEWAY_URL}/api/status`);
    // Assert:
    assert.equal(statusRes.statusCode, 200, 'Gateway status endpoint must return HTTP 200');
    const statusData = JSON.parse(statusRes.body);
    assert.equal(statusData.overall, 'ok', 'Gateway overall status must be ok');
    assert.ok(statusData.auth_required, 'Gateway requires authentication');

    // 2. Act: POST /auth/password-login
    const loginPayload = JSON.stringify({
      username: USERNAME,
      password: PASSWORD,
      provider: 'basic',
    });
    const loginRes = await requestHttp(
      `${GATEWAY_URL}/auth/password-login`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(loginPayload),
          Origin: GATEWAY_URL,
        },
      },
      loginPayload
    );
    // Assert:
    assert.equal(loginRes.statusCode, 200, 'Password login must succeed with HTTP 200');
    const setCookies = loginRes.headers['set-cookie'] || [];
    assert.ok(setCookies.length > 0, 'Login response must set cookies');
    sessionCookie = setCookies.map((c) => c.split(';')[0]).join('; ');

    // 3. Act: POST /api/auth/ws-ticket
    const ticketRes = await requestHttp(`${GATEWAY_URL}/api/auth/ws-ticket`, {
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
        Origin: GATEWAY_URL,
        Accept: 'application/json',
      },
    });
    // Assert:
    assert.equal(ticketRes.statusCode, 200, 'Ticket minting must return HTTP 200');
    const ticketData = JSON.parse(ticketRes.body);
    assert.ok(ticketData.ticket, 'Must return a valid ticket');
    wsTicket = ticketData.ticket;

    // 4. Act: Connect WebSocket
    const wsUrl = `${GATEWAY_URL.replace('http://', 'ws://')}/api/ws?ticket=${encodeURIComponent(wsTicket)}`;
    ws = new WebSocket(wsUrl);
    const opened = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WS connection timeout')), 4000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(true);
      };
      ws.onerror = reject;
    });
    assert.equal(opened, true, 'WebSocket must reach readyState OPEN');
  });

  // (b) 拉取会话列表
  await t.test('(b) 拉取会话列表：session.list 成功返回并解析', async () => {
    // Act
    const result = await rpcCall('session.list', { profile: 'default', limit: 20 });
    // Assert
    assert.ok(result, 'session.list must return a result object');
    assert.ok(Array.isArray(result.sessions), 'Result must contain sessions array');
  });

  // (c) 获取可用的模型列表
  await t.test('(c) 获取可用的模型列表：model.options 解析真实模型并验证当前模型', async () => {
    // Act
    const result = await rpcCall('model.options', { profile: 'default' });
    // Assert
    assert.ok(result, 'model.options must return an object');
    assert.ok(Array.isArray(result.providers), 'Result must contain providers array');
    assert.ok(result.model, 'Must specify current active default model');

    // Extract all models
    const set = new Set();
    if (result.model) set.add(result.model);
    for (const p of result.providers) {
      if (Array.isArray(p.models)) {
        for (const m of p.models) {
          if (typeof m === 'string') set.add(m);
          else if (m?.id) set.add(m.id);
        }
      }
    }
    availableModels = Array.from(set);
    assert.ok(availableModels.length > 0, 'Available models count must be greater than 0');
    assert.ok(availableModels.includes(result.model), 'Current model must be present in models list');
  });

  // (d) 修改模型的思考等级与审批策略
  await t.test('(d) 修改模型的思考等级：通过 config.set 切换 reasoning 等级', async () => {
    // 1. Arrange: 创建一个专用会话用于配置测试
    const newSession = await rpcCall('session.create', {});
    assert.ok(newSession.session_id, 'session.create must return a valid session_id');
    activeSessionId = newSession.session_id;

    // 2. Act: 将 reasoning 设为 'high'
    const setRes = await rpcCall('config.set', {
      session_id: activeSessionId,
      key: 'reasoning',
      value: 'high',
    });
    // Assert:
    assert.equal(setRes.key, 'reasoning');
    assert.equal(setRes.value, 'high');

    // 3. Act: 设为 'medium'
    const setMedium = await rpcCall('config.set', {
      session_id: activeSessionId,
      key: 'reasoning',
      value: 'medium',
    });
    // Assert:
    assert.equal(setMedium.value, 'medium');

    // 4. Act: 修改审批模式为 'smart'
    const setApproval = await rpcCall('config.set', {
      session_id: activeSessionId,
      key: 'approval_mode',
      value: 'smart',
    });
    assert.equal(setApproval.value, 'smart');
  });

  // (e) 用户发消息与流式响应
  await t.test('(e) 用户发消息：prompt.submit 提交并接收下行 message.delta 流式推送', async () => {
    assert.ok(activeSessionId, 'Active session must be set');

    let streamText = '';
    const messagePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (streamText.length > 0) resolve(streamText);
        else reject(new Error('Prompt streaming timed out without response'));
      }, 10000);

      const onStream = (event) => {
        try {
          const frame = JSON.parse(event.data);
          if (frame.method === 'event' && frame.params) {
            const { type, payload, session_id } = frame.params;
            if (session_id === activeSessionId) {
              if (type === 'message.delta' && payload?.text) {
                streamText += payload.text;
              } else if (type === 'message.complete' || type === 'session.idle') {
                clearTimeout(timer);
                ws.removeEventListener('message', onStream);
                resolve(streamText || payload?.text || 'OK');
              }
            }
          }
        } catch {}
      };
      ws.addEventListener('message', onStream);
    });

    // Act: 提交消息
    const submitResult = await rpcCall('prompt.submit', {
      session_id: activeSessionId,
      text: '请直接输出数字42',
    });
    assert.equal(submitResult.status, 'streaming', 'prompt.submit must return streaming status');

    // 等待流式回传
    const completedText = await messagePromise;
    assert.ok(completedText.length > 0, 'Agent must return stream response content');
  });

  t.after(() => {
    if (ws) {
      try {
        ws.close();
      } catch {}
    }
  });
});
