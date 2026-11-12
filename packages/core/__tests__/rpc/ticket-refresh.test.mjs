import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { HermesGatewayClient } from '../../dist/rpc/client.js';

const WS_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeServerTextFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function decodeMaskedClientFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let len = second & 0x7f;
    let cursor = offset + 2;
    if (len === 126) {
      if (cursor + 2 > buffer.length) break;
      len = buffer.readUInt16BE(cursor);
      cursor += 2;
    }
    if (!masked || cursor + 4 + len > buffer.length) break;
    const mask = buffer.subarray(cursor, cursor + 4);
    cursor += 4;
    const data = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
      data[i] = buffer[cursor + i] ^ mask[i % 4];
    }
    frames.push({ opcode, text: data.toString('utf8') });
    offset = cursor + len;
  }
  return { frames, remaining: buffer.subarray(offset) };
}

function createSingleUseTicketWsServer() {
  const validTickets = new Set();
  const consumedTickets = new Set();
  const attempts = [];
  const activeSockets = new Set();
  let seq = 0;

  const server = http.createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });

  server.on('upgrade', (req, socket) => {
    const reqUrl = new URL(req.url, 'http://127.0.0.1');
    const ticket = reqUrl.searchParams.get('ticket') || '';
    const origin = req.headers.origin || '';
    attempts.push({ ticket, origin });

    if (!validTickets.has(ticket) || consumedTickets.has(ticket)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    consumedTickets.add(ticket);
    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(`${key}${WS_MAGIC_GUID}`).digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    activeSockets.add(socket);
    socket.on('close', () => activeSockets.delete(socket));

    let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      const parsed = decodeMaskedClientFrames(pending);
      pending = parsed.remaining;
      for (const frame of parsed.frames) {
        if (frame.opcode === 0x08) {
          socket.end();
          return;
        }
        if (frame.opcode === 0x01) {
          const msg = JSON.parse(frame.text);
          if (msg.method === 'ping' && msg.id) {
            socket.write(
              encodeServerTextFrame(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { pong: true } }))
            );
          }
        }
      }
    });
  });

  return {
    async start() {
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      return `ws://127.0.0.1:${port}/api/ws`;
    },
    mintTicket() {
      const t = `ticket-${++seq}`;
      validTickets.add(t);
      return t;
    },
    dropAllConnections() {
      for (const s of activeSockets) {
        s.destroy();
      }
      activeSockets.clear();
    },
    getAttempts() {
      return [...attempts];
    },
    async close() {
      this.dropAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}

async function waitUntil(pred, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
}

function observeStates(client) {
  const transitions = [];
  const waiters = [];
  const off = client.getFsm().onStateChange((next) => {
    transitions.push(next);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].target === next) {
        const { resolve, timer } = waiters.splice(i, 1)[0];
        clearTimeout(timer);
        resolve();
      }
    }
  });

  return {
    transitions,
    waitForNext(target, timeoutMs = 4000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.resolve === resolve);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(new Error(`waitForNext('${target}') timed out after ${timeoutMs}ms (seen: ${transitions.join('->')})`));
        }, timeoutMs);
        waiters.push({ target, resolve, timer });
      });
    },
    dispose: off,
  };
}

test('HermesGatewayClient 一次性 ws-ticket 重连续期行为验证', async (t) => {
  await t.test('断线重连及唤醒重连必须调用 resolveUrl 换取新 ticket，绝不复用已消费票据', async () => {
    const gw = createSingleUseTicketWsServer();
    const baseWs = await gw.start();
    const t1 = gw.mintTicket();
    let resolveCount = 0;

    const client = new HermesGatewayClient({
      url: `${baseWs}?ticket=${t1}`,
      resolveUrl: async () => {
        resolveCount++;
        const nextTicket = gw.mintTicket();
        return `${baseWs}?ticket=${nextTicket}`;
      },
      autoConnect: true,
      enableHeartbeat: false,
      enableLifecycleWake: false,
    });
    const obs = observeStates(client);

    try {
      await waitUntil(() => client.getState() === 'CONNECTED');
      assert.equal(resolveCount, 0, '初次建连应直接使用传入的初始票据而不重复刷新');

      const reconnecting = obs.waitForNext('RECONNECTING');
      const reconnected = obs.waitForNext('CONNECTED');
      gw.dropAllConnections();
      await reconnecting;

      client.wakeImmediately('test-reconnect');
      await reconnected;

      assert.equal(resolveCount, 1, '重连必须调用 resolveUrl 获取新一次性 ticket');
      const attempts = gw.getAttempts();
      assert.equal(attempts.length, 2, '应有两次独立 WS 握手请求');
      assert.notEqual(attempts[0].ticket, attempts[1].ticket, '重连禁止复用已消费的旧 ticket');
    } finally {
      obs.dispose();
      client.disconnect();
      await gw.close();
    }
  });

  await t.test('自动退避 scheduleReconnect 重连同样必须通过 resolveUrl 换取新 ticket', async () => {
    const gw = createSingleUseTicketWsServer();
    const baseWs = await gw.start();
    const t1 = gw.mintTicket();
    let resolveCount = 0;

    const client = new HermesGatewayClient({
      url: `${baseWs}?ticket=${t1}`,
      resolveUrl: async () => {
        resolveCount++;
        return `${baseWs}?ticket=${gw.mintTicket()}`;
      },
      autoConnect: true,
      enableHeartbeat: false,
      enableLifecycleWake: false,
    });
    const obs = observeStates(client);

    try {
      await waitUntil(() => client.getState() === 'CONNECTED');
      const reconnecting = obs.waitForNext('RECONNECTING');
      const reconnected = obs.waitForNext('CONNECTED');
      gw.dropAllConnections();
      await reconnecting;
      await reconnected;

      assert.equal(resolveCount, 1, '自动退避重连必须调用 resolveUrl 获取新 ticket');
      const attempts = gw.getAttempts();
      assert.equal(attempts.length, 2);
      assert.notEqual(attempts[0].ticket, attempts[1].ticket);
    } finally {
      obs.dispose();
      client.disconnect();
      await gw.close();
    }
  });

  await t.test('resolveUrl 抛错、返回 null 或空串时不得卡死在 CONNECTING，应在下次唤醒后恢复连接', async () => {
    const gw = createSingleUseTicketWsServer();
    const baseWs = await gw.start();
    const t1 = gw.mintTicket();
    let mode = 'throw';

    const client = new HermesGatewayClient({
      url: `${baseWs}?ticket=${t1}`,
      resolveUrl: async () => {
        if (mode === 'throw') throw new Error('temporary network failure');
        if (mode === 'null') return null;
        if (mode === 'empty') return '';
        return `${baseWs}?ticket=${gw.mintTicket()}`;
      },
      autoConnect: true,
      enableHeartbeat: false,
      enableLifecycleWake: false,
    });
    const obs = observeStates(client);

    try {
      await waitUntil(() => client.getState() === 'CONNECTED');
      const waitDrop = obs.waitForNext('RECONNECTING');
      gw.dropAllConnections();
      await waitDrop;

      const waitThrow = obs.waitForNext('RECONNECTING');
      client.wakeImmediately('fail-throw');
      await waitThrow;

      mode = 'null';
      const waitNull = obs.waitForNext('RECONNECTING');
      client.wakeImmediately('fail-null');
      await waitNull;

      mode = 'empty';
      const waitEmpty = obs.waitForNext('RECONNECTING');
      client.wakeImmediately('fail-empty');
      await waitEmpty;

      mode = 'ok';
      const waitRecover = obs.waitForNext('CONNECTED');
      client.wakeImmediately('recover-now');
      await waitRecover;
      assert.equal(client.getState(), 'CONNECTED', '票据恢复后必须能重新进入 CONNECTED');
    } finally {
      obs.dispose();
      client.disconnect();
      await gw.close();
    }
  });

  await t.test('resolveUrl 在途期间重复唤醒不得并发重入，disconnect() 后再 connect() 可正常恢复', async () => {
    const gw = createSingleUseTicketWsServer();
    const baseWs = await gw.start();
    const t1 = gw.mintTicket();
    let resolveCalls = 0;
    let releaseFirstResolve;

    const client = new HermesGatewayClient({
      url: `${baseWs}?ticket=${t1}`,
      resolveUrl: () => {
        resolveCalls++;
        if (resolveCalls === 1) {
          return new Promise((resolve) => {
            releaseFirstResolve = () => resolve(`${baseWs}?ticket=${gw.mintTicket()}`);
          });
        }
        return Promise.resolve(`${baseWs}?ticket=${gw.mintTicket()}`);
      },
      autoConnect: true,
      enableHeartbeat: false,
      enableLifecycleWake: false,
    });
    const obs = observeStates(client);

    try {
      await waitUntil(() => client.getState() === 'CONNECTED');
      const waitDrop = obs.waitForNext('RECONNECTING');
      gw.dropAllConnections();
      await waitDrop;

      client.wakeImmediately('first-wake');
      await waitUntil(() => resolveCalls === 1);
      client.wakeImmediately('duplicate-wake-1');
      client.connect();
      assert.equal(resolveCalls, 1, 'isResolvingUrl 在途期间不得并发重入多次调用 resolveUrl');

      client.disconnect();
      assert.equal(client.getState(), 'DISCONNECTED');
      releaseFirstResolve();
      await new Promise((r) => setTimeout(r, 50));

      const waitRecover = obs.waitForNext('CONNECTED');
      client.connect();
      await waitRecover;
      assert.equal(resolveCalls, 2, 'disconnect 后重新 connect 应能发起新的票据解析并建连成功');
    } finally {
      obs.dispose();
      client.disconnect();
      await gw.close();
    }
  });

  await t.test('disconnect() 必须在途中止 resolveUrl，返回后不得创建幽灵 WebSocket', async () => {
    const gw = createSingleUseTicketWsServer();
    const baseWs = await gw.start();
    const t1 = gw.mintTicket();
    let releaseResolve;

    const client = new HermesGatewayClient({
      url: `${baseWs}?ticket=${t1}`,
      resolveUrl: () =>
        new Promise((resolve) => {
          releaseResolve = () => resolve(`${baseWs}?ticket=${gw.mintTicket()}`);
        }),
      autoConnect: true,
      enableHeartbeat: false,
      enableLifecycleWake: false,
    });
    const obs = observeStates(client);

    try {
      await waitUntil(() => client.getState() === 'CONNECTED');
      const waitDrop = obs.waitForNext('RECONNECTING');
      gw.dropAllConnections();
      await waitDrop;

      client.wakeImmediately('trigger-pending-resolve');
      await waitUntil(() => typeof releaseResolve === 'function');

      client.disconnect();
      assert.equal(client.getState(), 'DISCONNECTED');

      releaseResolve();
      await new Promise((r) => setTimeout(r, 80));

      assert.equal(client.getState(), 'DISCONNECTED', '已断开客户端不得再被在途 resolveUrl 拉起');
      assert.equal(client.getRawWebSocket(), null, '不得生成未受控的幽灵 socket');
      assert.equal(gw.getAttempts().length, 1, '取消后不得向网关发起第二次 WS 握手');
    } finally {
      obs.dispose();
      client.disconnect();
      await gw.close();
    }
  });
});
