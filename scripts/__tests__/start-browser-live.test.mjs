import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
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
  const seen = { login: [], ticket: [], proxy: [] };

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
});
