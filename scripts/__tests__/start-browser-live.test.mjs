import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachGatewayWsProxy } from '../lib/ws-proxy.mjs';

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

  await t.test('5. 本地工作区文件树列举与文件预览安全边界 (/__fs/list-directory & /__fs/read-file)', async () => {
    const dirRes = await postJson('/__fs/list-directory', {});
    assert.equal(dirRes.status, 200);
    assert.ok(Array.isArray(dirRes.data));
    assert.ok(dirRes.data.some((e) => e.name === 'package.json' && e.isDirectory === false));
    assert.ok(dirRes.data.some((e) => e.name === 'packages' && e.isDirectory === true));
    assert.equal(dirRes.data.some((e) => e.name === '.git' || e.name === '.env'), false);

    const escapeDir = await postJson('/__fs/list-directory', { dirPath: '../../../outside' });
    assert.equal(escapeDir.data, null);

    const evilDir = await fetch(`${baseUrl}/__fs/list-directory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
      body: '{}',
    });
    assert.equal(evilDir.status, 403);

    const fileRes = await postJson('/__fs/read-file', { filePath: 'package.json' });
    assert.equal(fileRes.status, 200);
    assert.ok(typeof fileRes.data?.content === 'string' && fileRes.data.content.includes('hermes-flux-monorepo'));

    const envFile = await postJson('/__fs/read-file', { filePath: '.env' });
    assert.equal(envFile.data?.content, null);

    const escapeFile = await postJson('/__fs/read-file', { filePath: '../outside.txt' });
    assert.equal(escapeFile.data?.content, null);
  });

  await t.test('6. 本地与远程流式附件下载 (/__fs/download & /__gw/download) 二进制字节无损校验', async () => {
    // 1. 先让 fake gateway 开放一个带 MZ/.exe 任意二进制字节的 /api/files/download（模拟 /api/fs/download 404 回退）
    const binaryPayload = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0xff, 0xfe, 0x00, 0x45, 0x4c, 0x46]);
    const binGwSeenHeaders = [];
    const binGw = http.createServer((req, res) => {
      binGwSeenHeaders.push({ url: req.url, cookie: req.headers.cookie });
      const reqUrl = new URL(req.url, 'http://127.0.0.1');
      if (reqUrl.pathname === '/api/files/download') {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(binaryPayload.length),
          'Content-Disposition': 'attachment; filename="agent-tool.exe"',
        });
        res.end(binaryPayload);
        return;
      }
      if (reqUrl.pathname === '/api/spa-fake.png') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body>SPA</body></html>');
        return;
      }
      if (reqUrl.pathname.endsWith('/api/status')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ auth_required: !reqUrl.pathname.includes('noauth') }));
        return;
      }
      if (reqUrl.pathname === '/api/auth/ws-ticket') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no_cookie' }));
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    const binGwPort = await listenDynamic(binGw);
    t.after(async () => {
      binGw.closeAllConnections?.();
      await new Promise((resolve) => binGw.close(resolve));
    });

    // 本地工作区流式下载 HEAD + GET
    const localHead = await fetch(`${baseUrl}/__fs/download?path=package.json`, { method: 'HEAD' });
    assert.equal(localHead.status, 200);
    assert.match(localHead.headers.get('content-disposition') || '', /attachment/);

    const localGet = await fetch(`${baseUrl}/__fs/download?path=package.json`);
    assert.equal(localGet.status, 200);
    assert.ok((await localGet.text()).includes('hermes-flux-monorepo'));

    const envDl = await fetch(`${baseUrl}/__fs/download?path=.env`);
    assert.equal(envDl.status, 404);

    // 先重新认证到主 gwPort（写入 sessionCookie & authenticatedOrigin），再验证跨 Origin 访问 binGwPort 绝不泄露 Cookie
    const reAuth = await postJson('/__gw/auth', {
      url: `http://127.0.0.1:${gwPort}`,
      username: 'alice',
      password: 'correct-horse',
    });
    assert.equal(reAuth.data.ok, true);

    // 远程网关二进制流式下载（包含 404 从 /api/fs/download 回退 /api/files/download，且不跨 Origin 带 Cookie）
    const gwBinRes = await fetch(
      `${baseUrl}/__gw/download?path=${encodeURIComponent('/opt/data/workspace/agent-tool.exe')}&baseUrl=${encodeURIComponent(`http://127.0.0.1:${binGwPort}`)}`,
    );
    assert.equal(gwBinRes.status, 200);
    assert.match(gwBinRes.headers.get('content-disposition') || '', /agent-tool\.exe/);
    const downloadedBuf = Buffer.from(await gwBinRes.arrayBuffer());
    assert.deepEqual(downloadedBuf, binaryPayload, '二进制下载必须逐字节无损还原（含 NUL 与 high-bit 字节）');
    assert.ok(binGwSeenHeaders.every((h) => !h.cookie), '不同 Origin 上游下载绝不得携带主网关 sessionCookie');

    // /__gw/proxy 遇到返回 text/html 的 .png URL 不得误转为 data:image base64，且同样隔离 Cookie
    const htmlImgProxy = await postJson('/__gw/proxy', {
      baseUrl: `http://127.0.0.1:${binGwPort}`,
      path: '/api/spa-fake.png',
      method: 'GET',
    });
    assert.equal(htmlImgProxy.data, '<html><body>SPA</body></html>');
    assert.equal(binGwSeenHeaders.at(-1).cookie, undefined);

    // 静态资源伺服：.env* 与路径越界必须统一返回 404
    const staticEnv = await fetch(`${baseUrl}/.env`);
    assert.equal(staticEnv.status, 404);
    const staticNestedEnv = await fetch(`${baseUrl}/packages/.env.local`);
    assert.equal(staticNestedEnv.status, 404);
    const staticEscape = await fetch(`${baseUrl}/../../../outside.txt`);
    assert.equal(staticEscape.status, 404);

    // 校验 /inject.js 暴露 saveFile 与强异常化 httpProxy，且 sourcePath 优先并禁止空内容 0 字节兜底
    const injectCode = await (await fetch(`${baseUrl}/inject.js`)).text();
    assert.match(injectCode, /saveFile\s*:/);
    assert.match(injectCode, /\/__gw\/download\?/);
    assert.match(injectCode, /if\s*\(sourcePath\)\s*\{/);
    assert.match(injectCode, /!remoteUrl\s*&&\s*!content/);
    assert.match(injectCode, /if\s*\(!r\.ok\)/);

    // 重连跨 Origin（空密码）绝不得将主网关 Cookie 发送到 binGwPort 的 /api/auth/ws-ticket，且须要求输入凭据
    const crossReconnect = await postJson('/__gw/auth', { url: `http://127.0.0.1:${binGwPort}` });
    assert.equal(crossReconnect.data.ok, false);
    assert.match(crossReconnect.data.message, /用户名与密码/);
    assert.ok(binGwSeenHeaders.every((h) => !h.cookie), '空密码跨 Origin 重连 ws-ticket 不得携带主网关 Cookie');

    // 主网关失败登录 (401) 后必须清空 sessionCookie 与 authenticatedOrigin
    const fail401 = await postJson('/__gw/auth', {
      url: `http://127.0.0.1:${gwPort}`,
      username: 'alice',
      password: 'wrong-password',
    });
    assert.equal(fail401.data.ok, false);
    await postJson('/__gw/proxy', { baseUrl: `http://127.0.0.1:${gwPort}`, path: '/api/probe', method: 'GET' });
    assert.equal(seen.proxy.at(-1).headers.cookie, undefined, '登录 401 后必须清空残留 sessionCookie');

    // 重新登录再切换免密服务时，也必须清空旧 Cookie
    await postJson('/__gw/auth', { url: `http://127.0.0.1:${gwPort}`, username: 'alice', password: 'correct-horse' });
    const noAuthSwitch = await postJson('/__gw/auth', { url: `http://127.0.0.1:${binGwPort}/noauth` });
    assert.equal(noAuthSwitch.data.ok, true);
    await postJson('/__gw/proxy', { baseUrl: `http://127.0.0.1:${gwPort}`, path: '/api/probe', method: 'GET' });
    assert.equal(seen.proxy.at(-1).headers.cookie, undefined, '切换免密网关时必须清理旧 sessionCookie');
  });

  await t.test('7. ws-proxy.mjs getAllowedCookieOrigin 严格闭环策略（空值/不匹配 fail-closed，大小写匹配与未传守卫放行）', async () => {
    const wsCookiesSeen = [];
    const upstreamSrv = http.createServer();
    upstreamSrv.on('upgrade', (req, socket) => {
      wsCookiesSeen.push(req.headers.cookie || '');
      const key = req.headers['sec-websocket-key'];
      const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      socket.end();
    });
    const upstreamPort = await listenDynamic(upstreamSrv);
    t.after(async () => {
      upstreamSrv.closeAllConnections?.();
      await new Promise((r) => upstreamSrv.close(r));
    });

    let allowedOrigin = '';
    const proxySrv = http.createServer();
    attachGatewayWsProxy(proxySrv, () => 'session=ws-secret', () => allowedOrigin);
    const proxyPort = await listenDynamic(proxySrv);
    t.after(async () => {
      proxySrv.closeAllConnections?.();
      await new Promise((r) => proxySrv.close(r));
    });

    const openWsOnce = (port) =>
      new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          path: `/__gw/ws?target=${encodeURIComponent(`ws://127.0.0.1:${upstreamPort}/api/ws`)}`,
          headers: {
            Origin: `http://127.0.0.1:${port}`,
            Connection: 'Upgrade',
            Upgrade: 'websocket',
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
          },
        });
        req.on('upgrade', (_res, sock) => {
          sock.destroy();
          resolve();
        });
        req.on('error', reject);
        req.end();
      });

    // 空 allowedOrigin 必须 fail-closed 拒绝携带 Cookie
    allowedOrigin = '';
    await openWsOnce(proxyPort);
    assert.equal(wsCookiesSeen.at(-1), '');

    // 不匹配 Origin 同样 fail-closed
    allowedOrigin = 'http://127.0.0.1:1';
    await openWsOnce(proxyPort);
    assert.equal(wsCookiesSeen.at(-1), '');

    // 大小写不一致但同 Origin 允许发送 Cookie
    allowedOrigin = `HTTP://127.0.0.1:${upstreamPort}`;
    await openWsOnce(proxyPort);
    assert.equal(wsCookiesSeen.at(-1), 'session=ws-secret');

    // 未传入 getAllowedCookieOrigin 时保持向后兼容允许发送 Cookie
    const openProxySrv = http.createServer();
    attachGatewayWsProxy(openProxySrv, () => 'session=legacy');
    const openProxyPort = await listenDynamic(openProxySrv);
    t.after(async () => {
      openProxySrv.closeAllConnections?.();
      await new Promise((r) => openProxySrv.close(r));
    });
    await openWsOnce(openProxyPort);
    assert.equal(wsCookiesSeen.at(-1), 'session=legacy');
  });
});
