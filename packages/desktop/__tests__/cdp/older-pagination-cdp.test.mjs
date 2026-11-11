/**
 * 向上滚动翻页闭环 E2E（真实 Blink CDP，驱动 packages/desktop/dist 真实产物）
 *
 * 【设计意图 (Why)】
 *   纯函数测试与源码文本扫描无法拦截控制流死锁（例如 `shouldExpandWindow` 在 `total <= 120`
 *   时跳过 `loadOlderMessages`）。本用例在标准 Node HTTP+WS 模拟网关下驱动真实编译产物，
 *   用真实鼠标滚轮验证「首屏 <= 120 条 + 重度工具折叠 + 非单调 rowId 首问」必须完整拉到开头。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const RENDERER_ENTRY = 'packages/desktop/dist/renderer/index.html';

function buildGatewayMessages(turns = 360) {
  const rows = [];
  for (let turn = 0; turn < turns; turn += 1) {
    const baseTs = 1792508678 + turn * 60;
    const userId = turn === 0 ? 18541 : 10000 + turn * 5;
    rows.push({
      id: userId,
      row_id: userId,
      session_id: 'sess-e2e-older',
      role: 'user',
      content: turn === 0 ? 'FIRST_QUESTION_18541' : `question-${turn}`,
      timestamp: baseTs,
    });
    const astToolId = 10000 + turn * 5 + 1;
    rows.push({
      id: astToolId,
      row_id: astToolId,
      session_id: 'sess-e2e-older',
      role: 'assistant',
      content: '',
      tool_calls: [{ id: `tc-${turn}`, name: 'shell', args: { cmd: 'ls' } }],
      timestamp: baseTs + 1,
    });
    for (let k = 0; k < 2; k += 1) {
      const toolId = 10000 + turn * 5 + 2 + k;
      rows.push({
        id: toolId,
        row_id: toolId,
        session_id: 'sess-e2e-older',
        role: 'tool',
        tool_call_id: `tc-${turn}`,
        content: `tool-out-${turn}-${k}`,
        timestamp: baseTs + 2 + k,
      });
    }
    const astFinalId = 10000 + turn * 5 + 4;
    rows.push({
      id: astFinalId,
      row_id: astFinalId,
      session_id: 'sess-e2e-older',
      role: 'assistant',
      content: `answer-${turn}`,
      timestamp: baseTs + 4,
    });
  }
  return rows;
}

function sendWsTextFrame(socket, text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function attachSimpleWsServer(httpServer, onJsonMessage) {
  httpServer.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '\r\n',
      ].join('\r\n')
    );

    let buffer = Buffer.alloc(0);
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 0x0f;
        const masked = (buffer[1] & 0x80) !== 0;
        let payloadLen = buffer[1] & 0x7f;
        let offset = 2;
        if (payloadLen === 126) {
          if (buffer.length < 4) return;
          payloadLen = buffer.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (buffer.length < 10) return;
          payloadLen = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        const maskLen = masked ? 4 : 0;
        if (buffer.length < offset + maskLen + payloadLen) return;
        const mask = masked ? buffer.subarray(offset, offset + 4) : null;
        const data = Buffer.from(buffer.subarray(offset + maskLen, offset + maskLen + payloadLen));
        buffer = buffer.subarray(offset + maskLen + payloadLen);
        if (opcode === 0x8) {
          socket.end();
          return;
        }
        if (opcode === 0x9) {
          socket.write(Buffer.from([0x8a, 0x00]));
          continue;
        }
        if (mask) {
          for (let i = 0; i < data.length; i += 1) data[i] ^= mask[i % 4];
        }
        if (opcode === 0x1) {
          try {
            const msg = JSON.parse(data.toString('utf8'));
            onJsonMessage(msg, (reply) => sendWsTextFrame(socket, JSON.stringify(reply)));
          } catch {}
        }
      }
    });
  });
}

async function waitFor(probe, deadlineMs = 15000, intervalMs = 150) {
  const started = Date.now();
  let last;
  while (Date.now() - started < deadlineMs) {
    last = await probe();
    if (last) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

function connectCdp(wsUrl) {
  let id = 0;
  const pending = new Map();
  const ws = new WebSocket(wsUrl);
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const reqId = ++id;
      pending.set(reqId, { resolve, reject });
      ws.send(JSON.stringify({ id: reqId, method, params }));
    });
  ws.addEventListener('message', (event) => {
    const data = JSON.parse(String(event.data));
    if (data.id && pending.has(data.id)) {
      const p = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error.message));
      else p.resolve(data.result);
    }
  });
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve({ ws, send }));
    ws.addEventListener('error', (err) => reject(err));
  });
}

test('older-pagination-cdp: 首屏折叠后 <= 120 条时，鼠标向上滚动必须触发翻页并抵达非单调首问 18541', async (t) => {
  const browserPath = BROWSER_CANDIDATES.find((p) => fs.existsSync(p));
  if (!browserPath) {
    t.skip('未找到 Edge/Chrome');
    return;
  }
  const rootDir = process.cwd();
  if (!fs.existsSync(path.join(rootDir, RENDERER_ENTRY))) {
    t.skip('renderer 产物缺失，先 npm run build');
    return;
  }
  const distJs = path.join(rootDir, 'packages/desktop/dist/renderer/index.js');
  const srcTs = path.join(rootDir, 'packages/desktop/src/renderer/index.ts');
  if (fs.existsSync(distJs) && fs.existsSync(srcTs)) {
    assert.ok(
      fs.statSync(distJs).mtimeMs >= fs.statSync(srcTs).mtimeMs - 2000,
      'renderer dist 产物陈旧，请先执行 npm run build 再运行 CDP 测试'
    );
  }

  // 360 回合 = 1800 条原始行（经工具折叠为 1080 条视图消息），跨越 4 次服务端分页请求并突破 120 容量限制
  const gatewayMessages = buildGatewayMessages(360);
  const pagedRequests = [];

  const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (reqPath === '/__gw/auth') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ticket: 'test-ticket', latency: 1 }));
      return;
    }
    if (reqPath === '/__gw/proxy') {
      let buf = '';
      req.on('data', (d) => { buf += d; });
      req.on('end', () => {
        const body = JSON.parse(buf || '{}');
        if (String(body.path || '').includes('/messages')) {
          const limit = Number(body.params?.limit ?? 100);
          const offset = Number(body.params?.offset ?? 0);
          pagedRequests.push({ offset, limit });
          const end = Math.max(0, gatewayMessages.length - offset);
          const start = Math.max(0, end - limit);
          const slice = gatewayMessages.slice(start, end);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            messages: slice,
            pagination: { limit, offset, order: 'latest', returned: slice.length },
          }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
      return;
    }
    if (reqPath === '/' || reqPath === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="zh-CN" data-theme="obsidian-gold">
<head>
  <meta charset="UTF-8">
  <title>Hermes Flux CDP Older Pagination</title>
  <link rel="stylesheet" href="/packages/desktop/dist/renderer/styles.css">
  <link rel="stylesheet" href="/packages/desktop/dist/renderer/conversation.css">
  <link rel="stylesheet" href="/packages/desktop/dist/renderer/tailwind.css">
</head>
<body>
  <div id="flux-app-root"></div>
  <script src="/inject.js"></script>
  <script type="module" src="/packages/desktop/dist/renderer/index.js"></script>
</body>
</html>`);
      return;
    }
    if (reqPath === '/inject.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(`
        window.hermesDesktop = {
          getSystemInfo: async () => ({ platform: 'windows', arch: 'x64' }),
          isMaximized: async () => false,
          authenticateGateway: async (args) => {
            const r = await fetch('/__gw/auth', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(args || {}) });
            return await r.json();
          },
          httpProxy: async (args) => {
            const r = await fetch('/__gw/proxy', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(args || {}) });
            return await r.json();
          },
        };
      `);
      return;
    }

    const filePath = path.join(rootDir, reqPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
    };
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });

  attachSimpleWsServer(server, (msg, sendReply) => {
    const { id, method } = msg;
    if (method === 'ping') {
      sendReply({ jsonrpc: '2.0', id, result: { pong: true } });
    } else if (method === 'profiles.list') {
      sendReply({ jsonrpc: '2.0', id, result: { profiles: [{ name: 'default', display_name: 'Default', is_default: true }] } });
    } else if (method === 'session.list') {
      sendReply({
        jsonrpc: '2.0',
        id,
        result: {
          sessions: [{
            session_id: 'sess-e2e-older',
            stored_session_id: 'sess-e2e-older',
            title: 'E2E Pagination',
            profile: 'default',
            last_active: 1792508678 + 120 * 60,
          }],
        },
      });
    } else if (method === 'session.resume') {
      sendReply({
        jsonrpc: '2.0',
        id,
        result: {
          session_id: 'live-e2e-1',
          stored_session_id: 'sess-e2e-older',
          running: false,
        },
      });
    } else if (method === 'groups.list') {
      sendReply({ jsonrpc: '2.0', id, result: { rooms: [] } });
    } else {
      sendReply({ jsonrpc: '2.0', id, result: {} });
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;

  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const cdpPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  const userDataDir = path.resolve(os.tmpdir(), `flux-older-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const proc = spawn(
    browserPath,
    [
      `--remote-debugging-port=${cdpPort}`,
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      `--user-data-dir=${userDataDir}`,
      '--window-size=1280,800',
      `http://127.0.0.1:${serverPort}/`,
    ],
    { stdio: 'ignore' }
  );

  let cdp = null;
  t.after(async () => {
    try { if (cdp) await cdp.send('Browser.close'); } catch {}
    try { cdp?.ws?.close(); } catch {}
    try { proc.kill('SIGKILL'); } catch {}
    try { server.close(); } catch {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  });

  const targets = await waitFor(async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
      const list = await r.json();
      return list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
    } catch {
      return null;
    }
  });
  assert.ok(targets, 'Blink CDP 页面靶标未就绪');
  cdp = await connectCdp(targets.webSocketDebuggerUrl);

  const evalJs = async (expr) => {
    const out = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (out.exceptionDetails) {
      throw new Error(out.exceptionDetails.text || JSON.stringify(out.exceptionDetails));
    }
    return out.result?.value;
  };

  await waitFor(() => evalJs('Boolean(window.__fluxState && window.__fluxConnect && window.__fluxSelectSession)'));
  await evalJs(`window.__fluxConnect('http://127.0.0.1:${serverPort}')`);
  const connected = await waitFor(() => evalJs('Boolean(window.__fluxState.gatewayConnected)'));
  assert.ok(connected, '假网关 WebSocket 握手未完成');

  await evalJs(`window.__fluxSelectSession('sess-e2e-older', 'default')`);
  const initOk = await waitFor(() =>
    evalJs(`(() => {
      const s = window.__fluxState;
      return s.messages.length >= 20 && s.messages.length <= 120 && s.hasOlderMessages === true
        ? { len: s.messages.length, hasOlder: s.hasOlderMessages }
        : null;
    })()`)
  );
  assert.ok(initOk, '首屏加载完成后消息数应落在 <= 120 条区间且 hasOlderMessages=true');

  const rect = await evalJs(`(() => {
    const el = document.getElementById('conversation-stream');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);

  for (let round = 0; round < 30; round += 1) {
    for (let i = 0; i < 8; i += 1) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: rect.x,
        y: rect.y,
        deltaX: 0,
        deltaY: -1500,
      });
      await new Promise((r) => setTimeout(r, 35));
    }
    await new Promise((r) => setTimeout(r, 250));
    // 若在多页扩窗途中视口仍落在虚拟窗口中段，则模拟拖滚动条靠近窗口上沿继续触发翻页
    await evalJs(`(() => {
      const el = document.getElementById('conversation-stream');
      if (el && el.scrollTop > 1200) el.scrollTop = Math.max(0, el.scrollTop - 8000);
    })()`);
    const done = await evalJs(`Boolean(
      window.__fluxState.messages[0]?.rowId === 18541
      && !window.__fluxState.isLoadingOlder
      && (document.querySelector('.conv-virtual-window [data-msg-id], .conv-canvas [data-msg-id]')?.innerText || '').includes('FIRST_QUESTION_18541')
    )`);
    if (done) break;
  }

  const finalState = await evalJs(`(() => {
    const s = window.__fluxState;
    const domRows = Array.from(document.querySelectorAll('.conv-virtual-window [data-msg-id], .conv-canvas [data-msg-id]'));
    return {
      total: s.messages.length,
      hasOlder: s.hasOlderMessages,
      headRowId: s.messages[0]?.rowId,
      firstDomId: domRows[0]?.getAttribute('data-msg-id'),
      firstDomText: domRows[0]?.innerText || '',
    };
  })()`);

  assert.ok(pagedRequests.some((r) => r.offset >= 100), `必须发出 offset>=100 的向早翻页请求，实际: ${JSON.stringify(pagedRequests)}`);
  assert.ok(pagedRequests.length >= 4, `1800 原始行至少应发出 4 次分页请求（100+500+500+500+200），实际: ${JSON.stringify(pagedRequests)}`);
  assert.equal(finalState.headRowId, 18541, `最终首条消息必须是 18541，实际: ${JSON.stringify(finalState)}`);
  assert.ok(finalState.firstDomText.includes('FIRST_QUESTION_18541'), '首问 18541 必须真实渲染在 DOM 顶部');
  assert.equal(finalState.total, 1080, '360 个回合 × 3 条视图消息（提问 + 工具助手 + 终答）= 1080 条，必须完整无漏');
});
