/**
 * Hermes Flux Mobile PlatformBridge - Full E2E Headless CDP & Gateway Simulation Test
 * 
 * 【检验目标】
 * 1. 真实验证 packages/mobile/dist/index.html 在无头移动端浏览器中的渲染表现
 * 2. 真实验证 window.hermesMobile 与 window.hermesDesktop 是否正确注入并同构
 * 3. 真实启动本地 Gateway Mock HTTP 服务器，验证 authenticateGateway 与 httpProxy 的网络调用闭环
 * 4. 验证移动端视口（Pixel 8 390x844）下的几何约束：桌面三键物理剥离、对话流占满
 * 5. 断言零 PageError、零未捕获异常
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BROWSER_PATH = fs.existsSync(CHROME_PATH) ? CHROME_PATH : EDGE_PATH;
const CDP_PORT = 9366;

test('Capacitor Mobile PlatformBridge - Live Headless Mobile CDP & Gateway Test', async (t) => {
  if (!fs.existsSync(EDGE_PATH)) {
    t.skip('Microsoft Edge not found on system');
    return;
  }

  // 1. 启动真实的 Mock Gateway HTTP 服务
  const gatewayServer = http.createServer((req, res) => {
    const url = req.url?.split('?')[0] || '';
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-WS-Ticket');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        version: '0.22.5',
        auth_required: true,
      }));
      return;
    }

    if (url === '/auth/password-login') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.username === 'admin' && parsed.password === 'pass123') {
            res.setHeader('Set-Cookie', 'hermes_session=token-abc-123; Path=/; HttpOnly');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, user: 'admin' }));
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
          }
        } catch {
          res.writeHead(400);
          res.end();
        }
      });
      return;
    }

    if (url === '/api/auth/ws-ticket') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ticket: 'ws-ticket-mobile-998877' }));
      return;
    }

    if (url === '/api/sessions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        sessions: [
          { id: 'sess_mob_1', title: 'Mobile Test Session', created_at: Date.now() },
          { id: 'sess_mob_2', title: 'Second Session', created_at: Date.now() - 1000 },
        ],
      }));
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  await new Promise(r => gatewayServer.listen(0, '127.0.0.1', r));
  const gwPort = gatewayServer.address().port;
  const gwUrl = `http://127.0.0.1:${gwPort}`;

  // 2. 启动托管 packages/mobile/dist 的静态 Web 服务器
  const mobileDist = path.resolve('packages/mobile/dist');
  const webServer = http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url?.split('?')[0] || '/');
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(mobileDist, reqPath);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise(r => webServer.listen(0, '127.0.0.1', r));
  const webPort = webServer.address().port;
  const webUrl = `http://127.0.0.1:${webPort}/`;

  // 3. 启动无头 Edge 浏览器，配置 Android 移动视口与 UA
  const tmpUserDataDir = path.resolve(os.tmpdir(), `mobile-cdp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const browserProc = spawn(BROWSER_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    `--user-data-dir=${tmpUserDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=390,844',
  ]);

  let ws = null;
  const cleanup = async () => {
    try { if (ws) ws.close(); } catch {}
    try {
      if (browserProc?.pid) {
        spawn('taskkill', ['/pid', String(browserProc.pid), '/f', '/t']);
      }
    } catch {}
    try { await new Promise(r => webServer.close(r)); } catch {}
    try { await new Promise(r => gatewayServer.close(r)); } catch {}
    try { fs.rmSync(tmpUserDataDir, { recursive: true, force: true }); } catch {}
  };

  t.after(cleanup);

  try {
    // 4. 等待 CDP 端口开放
  let connected = false;
  for (let i = 0; i < 30; i++) {
    try {
      const ver = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then(r => r.json());
      if (ver.webSocketDebuggerUrl) {
        connected = true;
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  assert.ok(connected, 'CDP remote debugging port must be responsive');

  // 5. 发现页面并建立 WebSocket 连接
  const tabs = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then(r => r.json());
  const pageTab = tabs.find(t => t.type === 'page') || tabs[0];
  assert.ok(pageTab?.webSocketDebuggerUrl, 'Must locate a valid page target');

  ws = new WebSocket(pageTab.webSocketDebuggerUrl);
  await new Promise((resolve) => {
    if (ws.readyState === 1) resolve();
    else ws.addEventListener('open', resolve, { once: true });
  });

  let msgId = 1;
  const pendingRequests = new Map();
  const consoleMessages = [];
  const pageErrors = [];

  ws.addEventListener('message', (event) => {
    const raw = typeof event.data === 'string' ? event.data : event.data.toString();
    const msg = JSON.parse(raw);
    if (msg.id && pendingRequests.has(msg.id)) {
      const { resolve, reject } = pendingRequests.get(msg.id);
      pendingRequests.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleMessages.push(msg.params);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(msg.params);
    }
  });

  const send = (method, params = {}) => {
    const id = ++msgId;
    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  // 6. 开启 Runtime、Page 与网络监听，并模拟 Pixel 8 移动视口
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');

  try {
    await send('Browser.grantPermissions', {
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
      origin: webUrl,
    });
  } catch {}

  // 模拟真实 Pixel 8 移动设备指标 (390 x 844, DPR=3, Touch=true, Mobile=true)
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    hasTouch: true,
  });

  await send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
  });

  // 7. 导航至本地移动端页面
  await send('Page.navigate', { url: webUrl });
  await new Promise(r => setTimeout(r, 1500));

  // 8. 断言 1: 检验 window.hermesMobile 与 window.hermesDesktop 注入有效性
  const bridgeCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const hasMob = typeof window.hermesMobile === 'object' && window.hermesMobile !== null;
      const hasDesk = typeof window.hermesDesktop === 'object' && window.hermesDesktop !== null;
      const isSame = window.hermesMobile === window.hermesDesktop;
      const methods = [
        'getSystemInfo', 'minimize', 'maximize', 'unmaximize', 'close',
        'isMaximized', 'onWindowStateChange', 'getDefaultGatewayConfig',
        'authenticateGateway', 'httpProxy', 'openExternal', 'openFileDialog',
        'readFile', 'saveFile', 'clipboardWrite', 'clipboardRead'
      ];
      const missing = methods.filter(m => typeof window.hermesMobile[m] !== 'function');
      return { hasMob, hasDesk, isSame, missing };
    })()`,
    returnByValue: true,
  });

  assert.ok(bridgeCheck.result.value.hasMob, 'window.hermesMobile must be present in WebView');
  assert.ok(bridgeCheck.result.value.hasDesk, 'window.hermesDesktop must be bridged for renderer compatibility');
  assert.ok(bridgeCheck.result.value.isSame, 'window.hermesMobile and window.hermesDesktop must reference the same bridge');
  assert.equal(bridgeCheck.result.value.missing.length, 0, `All 16 bridge methods must be implemented, missing: ${bridgeCheck.result.value.missing.join(', ')}`);

  // 9. 断言 2: 检验 getSystemInfo() 返回移动端身份
  const sysInfo = await send('Runtime.evaluate', {
    expression: `window.hermesMobile.getSystemInfo()`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(sysInfo.result.value.isMobile, true, 'isMobile must be true');
  assert.equal(sysInfo.result.value.isDesktop, false, 'isDesktop must be false');
  assert.ok(['android', 'ios', 'web'].includes(sysInfo.result.value.platform), 'Platform must be mobile/web');

  // 10. 断言 3: 真实调用 authenticateGateway 闭环测试
  const authGood = await send('Runtime.evaluate', {
    expression: `window.hermesMobile.authenticateGateway({
      url: '${gwUrl}',
      username: 'admin',
      password: 'pass123'
    })`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(authGood.result.value.ok, true, 'authenticateGateway must succeed with valid credentials');
  assert.equal(authGood.result.value.ticket, 'ws-ticket-mobile-998877', 'Must receive WS ticket from simulated gateway');

  // 密码错误反向测试 (证伪能力)
  const authBad = await send('Runtime.evaluate', {
    expression: `window.hermesMobile.authenticateGateway({
      url: '${gwUrl}',
      username: 'admin',
      password: 'wrong_password'
    })`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(authBad.result.value.ok, false, 'authenticateGateway must fail with wrong password');

  // 11. 断言 4: 真实调用 httpProxy 闭环拉取会话列表
  const proxyResult = await send('Runtime.evaluate', {
    expression: `window.hermesMobile.httpProxy({
      baseUrl: '${gwUrl}',
      path: '/api/sessions',
      method: 'GET'
    })`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.ok(Array.isArray(proxyResult.result.value.sessions), 'httpProxy must retrieve sessions array');
  assert.equal(proxyResult.result.value.sessions.length, 2, 'Must match mock gateway sessions count');

  // 12. 断言 5: 真实调用 clipboardWrite 验证剪贴板接口
  const clipResult = await send('Runtime.evaluate', {
    expression: `window.hermesMobile.clipboardWrite('Hello Hermes Mobile CDP')`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(clipResult.result.value, true, 'clipboardWrite must return true');

  // 13. 断言 6: 移动视口几何物理断言
  const geometry = await send('Runtime.evaluate', {
    expression: `(() => {
      // 桌面窗口三键在 390px 视口下必须被完全隐藏 (display: none)
      const winButtons = document.querySelectorAll('.win-cap-btn, #btn-win-min, #btn-win-max, #btn-win-close');
      let visibleButtons = 0;
      winButtons.forEach(b => {
        const style = window.getComputedStyle(b);
        if (style.display !== 'none' && style.visibility !== 'hidden') visibleButtons++;
      });
      return {
        visibleButtons,
        scrollWidth: document.documentElement.scrollWidth,
        windowWidth: window.innerWidth
      };
    })()`,
    returnByValue: true,
  });
  assert.equal(geometry.result.value.visibleButtons, 0, 'Desktop window caption buttons must be completely stripped in mobile viewport');
  assert.ok(geometry.result.value.scrollWidth <= geometry.result.value.windowWidth + 2, 'No horizontal scroll overflow in mobile viewport');

  // 14. 断言 7: 页面异常零容忍
  assert.equal(pageErrors.length, 0, `Page errors must be 0, encountered: ${JSON.stringify(pageErrors)}`);

  console.log('✔ All 14 Mobile CDP & Real Gateway assertions passed cleanly!');
  await cleanup();
} catch (err) {
  console.error('TEST ERROR TRACE:', err);
  await cleanup();
  throw err;
}
});
