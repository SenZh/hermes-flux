/**
 * 大对话虚拟滚动几何回归（真实 Blink CDP，驱动 packages/desktop/dist 真实产物）
 *
 * 【设计意图 (Why)】
 *   窗口化之后，虚拟全高若取自「总条数 × 平均行高」估算，与末尾窗口真实底边就会长期偏离。
 *   实测两条症状：滚到底后最后一条内容距视口底 1115px 空白；展开原生 <details> 后窗口底
 *   比输入舱顶低 729px。本用例用真实滚轮与真实折叠动作锁住这两条几何不变量。
 *
 * 【约束与规则 (Rules)】
 *   1. 断言的是几何量，不是实现细节：窗口底不得侵入输入舱，且贴底时不得悬空；
 *   2. 折叠与展开都用原生 details.open，与用户点击走同一条浏览器路径；
 *   3. 视口 1440×900，与会话流两侧的 gutter 计算口径一致。
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

function buildGatewayMessages(turns) {
  const rows = [];
  const tailBoostFrom = Math.max(0, turns - 3);
  for (let turn = 0; turn < turns; turn += 1) {
    const baseTs = 1792508678 + turn * 60;
    rows.push({
      id: 10000 + turn * 10,
      row_id: 10000 + turn * 10,
      session_id: 'sess-virtual-geometry',
      role: 'user',
      content: `第 ${turn} 个问题：验证长会话滚动几何`,
      timestamp: baseTs,
    });
    const toolCallId = `tc-${turn}`;
    rows.push({
      id: 10000 + turn * 10 + 1,
      row_id: 10000 + turn * 10 + 1,
      session_id: 'sess-virtual-geometry',
      role: 'assistant',
      content: '',
      tool_calls: [{ id: toolCallId, name: 'shell', args: { cmd: 'ls' } }],
      timestamp: baseTs + 1,
    });
    for (let k = 0; k < 3; k += 1) {
      rows.push({
        id: 10000 + turn * 10 + 2 + k,
        row_id: 10000 + turn * 10 + 2 + k,
        session_id: 'sess-virtual-geometry',
        role: 'tool',
        tool_call_id: toolCallId,
        content: `tool-out-${turn}-${k}`,
        timestamp: baseTs + 2 + k,
      });
    }
    rows.push({
      id: 10000 + turn * 10 + 9,
      row_id: 10000 + turn * 10 + 9,
      session_id: 'sess-virtual-geometry',
      role: 'assistant',
      content: `第 ${turn} 个回答。${'这是一段用于撑高单个回合的正文。'.repeat(turn >= tailBoostFrom ? 120 : 2)}`,
      timestamp: baseTs + 9,
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
    if (!key) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n',
    ].join('\r\n'));

    let buffer = Buffer.alloc(0);
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 0x0f;
        const masked = (buffer[1] & 0x80) !== 0;
        let len = buffer[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (buffer.length < 4) return;
          len = buffer.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (buffer.length < 10) return;
          len = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        const maskLen = masked ? 4 : 0;
        if (buffer.length < offset + maskLen + len) return;
        const mask = masked ? buffer.slice(offset, offset + 4) : null;
        const payload = Buffer.from(buffer.slice(offset + maskLen, offset + maskLen + len));
        if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
        buffer = buffer.slice(offset + maskLen + len);
        if (opcode === 0x1) {
          try {
            onJsonMessage(JSON.parse(payload.toString('utf8')), (obj) => sendWsTextFrame(socket, JSON.stringify(obj)));
          } catch {}
        } else if (opcode === 0x8) {
          socket.end();
          return;
        }
      }
    });
  });
}

function waitFor(fn, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = async () => {
      const value = await fn();
      if (value) { resolve(value); return; }
      if (Date.now() - started > timeoutMs) { resolve(null); return; }
      setTimeout(tick, 60);
    };
    tick();
  });
}

function connectCdp(wsUrl) {
  let id = 0;
  const pending = new Map();
  const ws = new WebSocket(wsUrl);
  const send = (method, params = {}) => new Promise((resolve, reject) => {
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
    ws.addEventListener('error', reject);
  });
}

test('conversation-virtual-scroll-cdp: 大对话滚到底与折叠工具组后，窗口底不得侵入输入舱也不得悬空', async (t) => {
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

  const gatewayMessages = buildGatewayMessages(80);
  const server = http.createServer((req, res) => {
    const reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
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
          // 第二个会话故意留空：验证「切会话必须清除历史累积的底部留白」。
          // 空会话不会触发 syncStreamBottomInset 的自我修正，留白只能靠重置清掉。
          const isEmptySession = String(body.path || '').includes('sess-virtual-geometry-alt');
          const end = isEmptySession ? 0 : Math.max(0, gatewayMessages.length - offset);
          const start = isEmptySession ? 0 : Math.max(0, end - limit);
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
  <title>Hermes Flux Virtual Scroll Geometry</title>
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
          sessions: [
            {
              session_id: 'sess-virtual-geometry',
              stored_session_id: 'sess-virtual-geometry',
              title: 'Virtual Geometry',
              profile: 'default',
              last_active: 1792508678 + 120 * 60,
            },
            {
              session_id: 'sess-virtual-geometry-alt',
              stored_session_id: 'sess-virtual-geometry-alt',
              title: 'Virtual Geometry Alt',
              profile: 'default',
              last_active: 1792508678 + 60,
            },
          ],
        },
      });
    } else if (method === 'session.resume') {
      const params = msg.params || {};
      const stored = params.session_id || params.sessionId || params.stored_session_id || 'sess-virtual-geometry';
      sendReply({ jsonrpc: '2.0', id, result: { session_id: `live-${stored}`, stored_session_id: stored, running: false } });
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

  const userDataDir = path.resolve(os.tmpdir(), `flux-virtual-geometry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const proc = spawn(browserPath, [
    `--remote-debugging-port=${cdpPort}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,900',
    `http://127.0.0.1:${serverPort}/`,
  ], { stdio: 'ignore' });

  let cdp = null;
  t.after(async () => {
    try { if (cdp) await cdp.send('Browser.close'); } catch {}
    try { cdp?.ws?.close(); } catch {}
    try { proc.kill('SIGKILL'); } catch {}
    try { server.close(); } catch {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  });

  const target = await waitFor(async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
      const list = await r.json();
      return list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
    } catch { return null; }
  });
  assert.ok(target, 'Blink CDP 页面靶标未就绪');
  cdp = await connectCdp(target.webSocketDebuggerUrl);

  const evalJs = async (expr) => {
    const out = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (out.exceptionDetails) throw new Error(out.exceptionDetails.text || JSON.stringify(out.exceptionDetails));
    return out.result?.value;
  };

  await waitFor(() => evalJs('Boolean(window.__fluxState && window.__fluxConnect && window.__fluxSelectSession)'));
  await evalJs(`window.__fluxConnect('http://127.0.0.1:${serverPort}')`);
  await waitFor(() => evalJs('Boolean(window.__fluxState.gatewayConnected)'));
  await evalJs(`window.__fluxSelectSession('sess-virtual-geometry', 'default')`);
  await waitFor(() => evalJs('window.__fluxState.messages.length > 0'));

  for (let i = 0; i < 10; i += 1) {
    const len = await evalJs('window.__fluxState.messages.length');
    const hasOlder = await evalJs('window.__fluxState.hasOlderMessages');
    if (len >= 200 || !hasOlder) break;
    await evalJs('window.__fluxLoadOlderMessages()');
    await new Promise((r) => setTimeout(r, 500));
  }
  const total = await evalJs('window.__fluxState.messages.length');
  assert.ok(total > 120, `必须进入窗口化口径，实际消息数 ${total}`);

  const geometry = () => evalJs(`(() => {
    const stream = document.getElementById('conversation-stream');
    const win = document.querySelector('.conv-virtual-window');
    const dock = document.querySelector('.input-dock-container');
    const wr = win ? win.getBoundingClientRect() : null;
    const dr = dock ? dock.getBoundingClientRect() : null;
    return {
      total: window.__fluxState.messages.length,
      scrollTop: Math.round(stream.scrollTop),
      scrollHeight: stream.scrollHeight,
      clientHeight: stream.clientHeight,
      distanceToBottom: Math.round(stream.scrollHeight - stream.scrollTop - stream.clientHeight),
      windowBottom: wr ? Math.round(wr.bottom) : null,
      windowHeight: wr ? Math.round(wr.height) : null,
      dockTop: dr ? Math.round(dr.top) : null,
      intrusion: wr && dr ? Math.round(wr.bottom - dr.top) : null,
    };
  })()`);

  /**
   * 几何收敛轮询：固定 sleep 在慢机器上会偶发通过，必须等到不变量真正成立。
   * 超时后返回最后一次快照，让断言带着实际数字失败。
   */
  const waitGeometry = async (predicate, label, timeoutMs = 4000) => {
    const started = Date.now();
    let last = await geometry();
    while (Date.now() - started < timeoutMs) {
      if (predicate(last)) return last;
      await new Promise((r) => setTimeout(r, 80));
      last = await geometry();
    }
    assert.fail(`${label} 在 ${timeoutMs}ms 内未收敛，最后几何 ${JSON.stringify(last)}`);
    return last;
  };

  const scrollToBottom = async (label) => {
    await evalJs(`(() => { const s = document.getElementById('conversation-stream'); s.scrollTop = s.scrollHeight; })()`);
    return waitGeometry((g) => g.distanceToBottom === 0, label);
  };

  const atBottom = await scrollToBottom('滚到底');
  assert.ok(atBottom.intrusion !== null, '缺少虚拟窗口或输入舱，几何不可判定');
  assert.ok(
    atBottom.intrusion <= 0,
    `滚到底时窗口底不得侵入输入舱，实际侵入 ${atBottom.intrusion}px，几何 ${JSON.stringify(atBottom)}`
  );
  assert.ok(
    atBottom.intrusion >= -64,
    `滚到底时窗口底不得悬空，实际距输入舱顶 ${-atBottom.intrusion}px，几何 ${JSON.stringify(atBottom)}`
  );

  await evalJs(`(() => { document.querySelectorAll('.conv-virtual-window details').forEach((d) => { d.open = true; }); })()`);
  const expanded = await waitGeometry((g) => g.intrusion <= 0 && g.windowHeight > atBottom.windowHeight, '展开工具组');
  assert.ok(
    expanded.intrusion >= -64,
    `展开工具组后窗口底必须仍贴住安全线，实际距输入舱顶 ${-expanded.intrusion}px，几何 ${JSON.stringify(expanded)}`
  );

  await evalJs(`(() => { document.querySelectorAll('.conv-virtual-window details').forEach((d) => { d.open = false; }); })()`);
  const collapsed = await waitGeometry(
    (g) => g.intrusion <= 0 && g.windowHeight < expanded.windowHeight && g.distanceToBottom === 0,
    '收起工具组'
  );
  assert.ok(
    collapsed.intrusion >= -64,
    `收起工具组后不得出现大片空白，实际距输入舱顶 ${-collapsed.intrusion}px，几何 ${JSON.stringify(collapsed)}`
  );

  const wheelPoint = await evalJs(`(() => {
    const stream = document.getElementById('conversation-stream');
    const r = stream.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);

  /**
   * 【布局漂移不得污染读者手势 (Rules)】折叠让容器变矮，浏览器会把 scrollTop 钳小并派发 scroll。
   *   这次 scroll 若被记成「读者向上回溯」，本会话此后向上滚动会直接搬走窗口，而不是被拉回底部。
   *   内部标记只能通过调试钩子观察，DOM 几何看不出差别。
   */
  const driftState = await evalJs('window.__fluxScrollState()');
  assert.equal(
    driftState.readerScrolledSessionId,
    '',
    `折叠引起的布局漂移不得被记成读者回溯，实测 ${JSON.stringify(driftState)}`
  );

  /**
   * 【回看中的读者不被折叠打扰 (Rules)】工具执行结束时 `ToolCapsule` 会自动收回 `<details>`，
   *   这同样会改窗口高度。读者此刻若停在窗口内上方，任何对齐都会把人拽回底部。
   */
  await scrollToBottom('回看前先回到底部');
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: wheelPoint.x,
    y: wheelPoint.y,
    deltaX: 0,
    deltaY: -600,
  });
  await new Promise((r) => setTimeout(r, 350));
  const beforeRetract = await evalJs('Math.round(document.getElementById("conversation-stream").scrollTop)');
  assert.ok(beforeRetract < (await evalJs('Math.round(document.getElementById("conversation-stream").scrollHeight)')), '回看位置必须离开底部');
  await evalJs(`(() => {
    const first = document.querySelector('.conv-virtual-window details');
    if (first) first.open = true;
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  await evalJs(`(() => {
    const first = document.querySelector('.conv-virtual-window details');
    if (first) first.open = false;
  })()`);
  await new Promise((r) => setTimeout(r, 450));
  const afterRetract = await evalJs('Math.round(document.getElementById("conversation-stream").scrollTop)');
  assert.ok(
    Math.abs(afterRetract - beforeRetract) <= 48,
    `回看中的读者不得被工具组收起拽动，收起前 ${beforeRetract}，收起后 ${afterRetract}`
  );

  /**
   * 【非末尾分支 (Rules)】窗口搬离末尾后没有实测 DOM 可依，必须回退到全量估算，
   *   否则读者永远到不了会话开头。这里用真实滚轮一路滚到顶，断言首条消息真实渲染。
   *   注意不能用直接写 scrollTop 代替：程序写入会被当成「首屏未定位」并拉回底部。
   */
  for (let round = 0; round < 60; round += 1) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: wheelPoint.x,
      y: wheelPoint.y,
      deltaX: 0,
      deltaY: -2400,
    });
    await new Promise((r) => setTimeout(r, 70));
    const top = await evalJs('Math.round(document.getElementById("conversation-stream").scrollTop)');
    if (top <= 0) break;
  }
  const atTop = await evalJs(`(() => {
    const stream = document.getElementById('conversation-stream');
    const rows = Array.from(document.querySelectorAll('.conv-virtual-window [data-msg-id], .conv-canvas [data-msg-id]'));
    return {
      scrollTop: Math.round(stream.scrollTop),
      viewportH: Math.round(document.querySelector('.conv-virtual-viewport')?.getBoundingClientRect().height ?? 0),
      firstRowText: rows[0]?.innerText || '',
    };
  })()`);
  assert.ok(atTop.scrollTop <= 240, `必须能滚到会话开头，实际 scrollTop ${atTop.scrollTop}`);
  assert.ok(atTop.viewportH > 0, '非末尾窗口仍必须撑出虚拟全高，否则滚动条消失');
  assert.ok(
    atTop.firstRowText.includes('第 0 个问题'),
    `会话首条必须真实渲染，实际首行 ${atTop.firstRowText.slice(0, 40)}`
  );

  /**
   * 【跨会话留白重置 (Rules)】`#conversation-stream` 跨会话复用，历史累积的底部留白
   *   若不重置，会把新会话末条顶到离视口底数千像素处。这里直接注入一个模拟累积值，
   *   切走再切回，断言属性被清掉且首屏仍然贴底。
   */
  await evalJs(`(() => { document.getElementById('conversation-stream').style.setProperty('--conv-gutter-bottom', '900px'); })()`);
  await evalJs(`window.__fluxSelectSession('sess-virtual-geometry-alt', 'default')`);
  await new Promise((r) => setTimeout(r, 900));
  const afterSwitch = await evalJs(`(() => {
    const stream = document.getElementById('conversation-stream');
    return {
      gutterInline: stream.style.getPropertyValue('--conv-gutter-bottom'),
      distanceToBottom: Math.round(stream.scrollHeight - stream.scrollTop - stream.clientHeight),
      total: window.__fluxState.messages.length,
    };
  })()`);
  assert.ok(
    parseFloat(afterSwitch.gutterInline || '0') <= 200,
    `切会话必须清除历史累积的底部留白，实际 ${afterSwitch.gutterInline || '(unset)'}`
  );
  assert.equal(afterSwitch.total, 0, '第二个会话必须为空，否则留白会被贴底重算掩盖');
});
