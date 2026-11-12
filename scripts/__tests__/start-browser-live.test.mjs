import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 浏览器直跑服务鉴权链路的真实子进程集成测试
 *
 * 【设计意图 (Why)】
 * 浏览器直跑模式下，密码由用户在连接面板输入并经 PAL 桥透传到 /__gw/auth。本测试以本地
 * 假网关 + 真实子进程启动 start-browser-live.mjs，物理验证「登录 → Set-Cookie → 换 ticket
 * → REST 代理透传 X-WS-Ticket」全链路，杜绝仅靠源码文本断言的假安全。
 *
 * 【防范的历史坑 (Pitfall)】
 * 旧实现丢弃前端传入的凭据、改用空密码环境变量预登录，导致 /auth/password-login 401、
 * sessionCookie 为空、/api/auth/ws-ticket 401 no_cookie；且 ticket 为空时仍返回 ok:true，
 * 把鉴权失败伪装成成功，前端拼出不带 ticket 的 WS URL 被网关拒绝握手。
 *
 * 【约束与规则 (Rules)】
 * 端口全部由内核动态分配（listen(0)），禁止硬编码；退出钩子必须 kill 子进程并销毁 stdio
 * 管道、关闭假网关，防止残留句柄卡死 runner；失败分支必须断言 ok:false，禁止接受静默降级。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.resolve(__dirname, '../start-browser-live.mjs');

function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (d) => { buf += d; });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); } });
  });
}

function listenDynamic(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function freePort() {
  const probe = http.createServer((_req, res) => res.end());
  const port = await listenDynamic(probe);
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForServer(baseUrl, child, deadlineMs = 15000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Live Server 提前退出，code=${child.exitCode}`);
    try {
      const res = await fetch(`${baseUrl}/`);
      if (res.ok) return;
    } catch { /* 尚未监听，继续轮询 */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Live Server 启动超时');
}

test('浏览器直跑 /__gw/auth 凭据透传与失败显式化', { timeout: 40000 }, async (t) => {
  const seen = { login: [], ticket: [], proxy: [], wsUpgrade: [] };
  const activeWsSockets = new Set();

  const gateway = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const body = req.method === 'POST' ? await readBody(req) : {};
    const send = (status, obj, extra = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...extra });
      res.end(JSON.stringify(obj));
    };

    if (url.pathname === '/auth/password-login') {
      seen.login.push({ body, headers: req.headers });
      if (body.password !== 'correct-horse') return send(401, { detail: 'Invalid credentials' });
      if (body.username === 'no-cookie') return send(200, { ok: true });
      const cookie = body.username === 'no-ticket' ? 'session=sid-empty' : 'session=sid-42';
      return send(200, { ok: true }, { 'Set-Cookie': `${cookie}; Path=/; HttpOnly` });
    }

    if (url.pathname === '/api/auth/ws-ticket') {
      seen.ticket.push({ headers: req.headers });
      if (req.headers.cookie === 'session=sid-empty') return send(200, {});
      if (req.headers.cookie !== 'session=sid-42') {
        return send(401, { error: 'unauthenticated', reason: 'no_cookie' });
      }
      return send(200, { ticket: 'TICKET-XYZ' });
    }

    if (url.pathname === '/api/probe') {
      seen.proxy.push({ headers: req.headers, method: req.method });
      return send(200, { reached: true });
    }

    return send(404, { error: 'not_found' });
  });

  gateway.on('upgrade', (req, socket) => {
    const reqUrl = new URL(req.url, 'http://127.0.0.1');
    const origin = req.headers.origin || '';
    const ticket = reqUrl.searchParams.get('ticket') || '';
    const expectedOrigin = `http://127.0.0.1:${gateway.address().port}`;
    seen.wsUpgrade.push({ origin, ticket, cookie: req.headers.cookie || '' });

    if (origin !== expectedOrigin || ticket !== 'TICKET-XYZ') {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.on('error', () => {});
    socket.on('end', () => socket.end());
    activeWsSockets.add(socket);
    socket.on('close', () => activeWsSockets.delete(socket));
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    socket.on('data', (chunk) => {
      if (chunk.length >= 2 && (chunk[0] & 0x0f) === 0x01) {
        const msg = Buffer.from('{"pong":true}', 'utf8');
        socket.write(Buffer.concat([Buffer.from([0x81, msg.length]), msg]));
      }
    });
  });

  const gwPort = await listenDynamic(gateway);
  const livePort = await freePort();
  const baseUrl = `http://127.0.0.1:${livePort}`;

  const stdout = [];
  const child = spawn(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      FLUX_GATEWAY_URL: `http://127.0.0.1:${gwPort}`,
      FLUX_NO_OPEN_BROWSER: '1',
      PORT: String(livePort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => stdout.push(String(d)));
  child.stderr.on('data', (d) => stdout.push(String(d)));

  t.after(async () => {
    child.kill();
    child.stdout.destroy();
    child.stderr.destroy();
    for (const sock of activeWsSockets) {
      sock.destroy();
    }
    gateway.closeAllConnections?.();
    await new Promise((resolve) => gateway.close(resolve));
  });

  await waitForServer(baseUrl, child);

  const postJson = async (pathname, payload) => {
    const res = await fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: res.status, data: await res.json() };
  };

  await t.test('1. 输入框凭据被完整透传，链路换回真实 ticket', async () => {
    const { status, data } = await postJson('/__gw/auth', {
      url: `http://127.0.0.1:${gwPort}`,
      username: 'alice',
      password: 'correct-horse',
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true, '认证成功必须显式 ok:true');
    assert.equal(data.ticket, 'TICKET-XYZ', 'ticket 必须来自网关而非空字符串兜底');

    const login = seen.login.at(-1);
    assert.deepEqual(login.body, {
      username: 'alice',
      password: 'correct-horse',
      provider: 'basic',
    }, '严禁丢弃前端传入的 username/password 改用环境变量凭据');
    assert.equal(seen.ticket.at(-1).headers.cookie, 'session=sid-42',
      'ws-ticket 必须携带登录下发的 Cookie，否则网关返回 no_cookie');
  });

  await t.test('2. REST 降级代理透传 X-WS-Ticket 与会话 Cookie', async () => {
    const { data } = await postJson('/__gw/proxy', {
      baseUrl: `http://127.0.0.1:${gwPort}`,
      path: '/api/probe',
      method: 'GET',
      ticket: 'TICKET-XYZ',
    });
    assert.equal(data.reached, true);
    const probe = seen.proxy.at(-1);
    assert.equal(probe.headers['x-ws-ticket'], 'TICKET-XYZ', 'ticket 不得在代理层被丢弃');
    assert.equal(probe.headers.cookie, 'session=sid-42');
  });

  await t.test('3. 密码错误必须 ok:false，禁止伪装为成功空 ticket', async () => {
    const { data } = await postJson('/__gw/auth', {
      url: `http://127.0.0.1:${gwPort}`,
      username: 'alice',
      password: 'wrong',
    });
    assert.equal(data.ok, false);
    assert.match(data.message, /401/);
    assert.equal('ticket' in data, false, '失败响应绝不能携带 ticket 字段');
  });

  await t.test('4. 登录成功但未下发 Cookie 必须显式失败', async () => {
    const { data } = await postJson('/__gw/auth', {
      url: `http://127.0.0.1:${gwPort}`,
      username: 'no-cookie',
      password: 'correct-horse',
    });
    assert.equal(data.ok, false);
    assert.match(data.message, /Cookie/);
  });

  await t.test('5. ws-ticket 返回空 ticket 必须显式失败（Failure Is Not Empty）', async () => {
    const { data } = await postJson('/__gw/auth', {
      url: `http://127.0.0.1:${gwPort}`,
      username: 'no-ticket',
      password: 'correct-horse',
    });
    assert.equal(data.ok, false);
    assert.match(data.message, /ticket/);
  });

  await t.test('6. 启动阶段不再发起空密码预登录', () => {
    assert.equal(
      stdout.join('').includes('网关登录警告'),
      false,
      '旧实现的 401 预登录警告必须消失',
    );
  });

  await t.test('7. /inject.js 暴露 proxyWebSocketUrl 将跨源地址重写为同源 /__gw/ws', async () => {
    const injectRes = await fetch(`${baseUrl}/inject.js`);
    assert.equal(injectRes.status, 200);
    const injectCode = await injectRes.text();
    assert.match(injectCode, /proxyWebSocketUrl\s*:/, '必须注入 proxyWebSocketUrl 宿主钩子');
    assert.match(injectCode, /\/__gw\/ws\?target=/, '必须映射到同源 /__gw/ws 隧道');
  });

  await t.test('8. /__gw/ws 同源隧道覆盖跨源 Origin 并支持双向 WebSocket 通信', async () => {
    const authRes = await postJson('/__gw/auth', {
      url: `http://127.0.0.1:${gwPort}`,
      username: 'alice',
      password: 'correct-horse',
    });
    assert.equal(authRes.data.ok, true);
    const targetWsUrl = `ws://127.0.0.1:${gwPort}/api/ws?ticket=TICKET-XYZ`;
    const proxyUpgrade = (pathAndQuery, originHeader) =>
      new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: livePort,
            path: pathAndQuery,
            method: 'GET',
            headers: {
              Connection: 'Upgrade',
              Upgrade: 'websocket',
              'Sec-WebSocket-Version': '13',
              'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
              Origin: originHeader,
            },
          }
        );
        req.on('upgrade', (res, sock) => { sock.on('error', () => {}); resolve({ statusCode: res.statusCode, sock }); });
        req.on('response', (res) => {
          res.resume();
          resolve({ statusCode: res.statusCode, sock: null });
        });
        req.on('error', reject);
        req.end();
      });

    const directBlocked = await new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: gwPort,
        path: '/api/ws?ticket=TICKET-XYZ',
        method: 'GET',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
          Origin: baseUrl,
        },
      });
      req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
      req.on('upgrade', (_res, sock) => { sock.destroy(); resolve(101); });
      req.end();
    });
    assert.equal(directBlocked, 403, '不经隧道直接携带 9120 Origin 必须被假网关 403 拒绝');

    const proxied = await proxyUpgrade(`/__gw/ws?target=${encodeURIComponent(targetWsUrl)}`, baseUrl);
    assert.equal(proxied.statusCode, 101, '经 /__gw/ws 隧道必须完成 101 升级');
    const latestUpgrade = seen.wsUpgrade.at(-1);
    assert.equal(latestUpgrade.origin, `http://127.0.0.1:${gwPort}`, '隧道必须注入与网关同源的 Origin');
    assert.equal(latestUpgrade.cookie, 'session=sid-42', '隧道必须透传已登录会话 Cookie');

    const received = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WS 隧道双向收发超时')), 3000);
      proxied.sock.on('data', (chunk) => {
        if (chunk.length >= 2 && (chunk[0] & 0x0f) === 0x01) {
          clearTimeout(timer);
          const len = chunk[1] & 0x7f;
          resolve(chunk.subarray(2, 2 + len).toString('utf8'));
        }
      });
      const payload = Buffer.from('{"ping":1}', 'utf8');
      const mask = crypto.randomBytes(4);
      const masked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
      proxied.sock.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]));
    });
    proxied.sock.destroy();
    assert.equal(received, '{"pong":true}', '隧道必须完整透传双向 WebSocket 帧');

    const badProto = await proxyUpgrade(`/__gw/ws?target=${encodeURIComponent(`http://127.0.0.1:${gwPort}/api/ws`)}`, baseUrl);
    assert.equal(badProto.statusCode, 400, '非法目标协议必须被隧道拒绝 (400)');

    const missingTarget = await proxyUpgrade('/__gw/ws', baseUrl);
    assert.equal(missingTarget.statusCode, 400, '缺失 target 参数必须被拒绝 (400)');

    const malformedTarget = await proxyUpgrade('/__gw/ws?target=not%3A%2F%2F%5B', baseUrl);
    assert.equal(malformedTarget.statusCode, 400, '畸形 target URL 必须被拒绝 (400)');

    const selfProxy = await proxyUpgrade(`/__gw/ws?target=${encodeURIComponent(`ws://127.0.0.1:${livePort}/__gw/ws`)}`, baseUrl);
    assert.equal(selfProxy.statusCode, 400, '递归指向 /__gw/ws 必须被拒绝 (400)');

    const evilOrigin = await proxyUpgrade(`/__gw/ws?target=${encodeURIComponent(targetWsUrl)}`, 'https://evil.example.com');
    assert.equal(evilOrigin.statusCode, 403, '外部非回环 Origin 请求本地代理必须被拒绝 (403)');

    const upstreamRejected = await proxyUpgrade(`/__gw/ws?target=${encodeURIComponent(`ws://127.0.0.1:${gwPort}/api/ws?ticket=EXPIRED`)}`, baseUrl);
    assert.equal(upstreamRejected.statusCode, 403, '上游网关拒绝升级时必须透传 403 状态码');

    const unreachablePort = await freePort();
    const upstreamDown = await proxyUpgrade(`/__gw/ws?target=${encodeURIComponent(`ws://127.0.0.1:${unreachablePort}/api/ws`)}`, baseUrl);
    assert.equal(upstreamDown.statusCode, 502, '上游不可达时必须返回 502');

    const badPath = await proxyUpgrade('/__gw/unknown', baseUrl);
    assert.equal(badPath.statusCode, 404, '非 /__gw/ws 路径升级必须拒绝 (404)');

    const closingConn = await proxyUpgrade(`/__gw/ws?target=${encodeURIComponent(targetWsUrl)}`, baseUrl);
    assert.equal(closingConn.statusCode, 101);
    const serverSideSock = [...activeWsSockets].at(-1);
    const closedOnGateway = new Promise((resolve) => {
      serverSideSock.once('close', () => resolve(true));
      setTimeout(() => resolve(false), 2000);
    });
    closingConn.sock.destroy();
    assert.equal(await closedOnGateway, true, '客户端断开后代理必须同步销毁上游连接防止孤儿句柄泄漏');
  });
});
