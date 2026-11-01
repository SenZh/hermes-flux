/**
 * 真实浏览器 + 真实网关 测试夹具 (packages/desktop/__tests__/e2e/browser-harness.mjs)
 *
 * 【设计意图 (Why)】
 *   左侧栏的顺序/时间/副标题/三态必须在"真实生产 renderer + 真实浏览器 + 真实网关"下验证。
 *   本夹具负责三件事：
 *     1. 用 headless Edge/Chrome 加载真实打包产物 `packages/desktop/dist/renderer/index.js`；
 *     2. 忠实复刻真实 Electron 主进程的两项能力——网关认证（换 WS ticket）与 REST 代理，
 *        经本地同源代理转发到真实网关（真实环境里这两件事由 preload 桥走 IPC 完成）；
 *     3. 只注入最小 `window.hermesDesktop` 桥，不注入任何业务假数据。
 *
 * 【为什么要本地代理】
 *   真实网关会话 cookie 是 `SameSite=lax`，浏览器从 127.0.0.1 跨站到网关 IP 不会带上它，
 *   所以 ws-ticket / REST 无法在页面里直接完成。真实 Electron 正是用主进程持有 cookie 解决的，
 *   这里用 Node 侧同源代理等价复刻。WebSocket 则带 ticket 直连真实网关（与真实渲染层一致）。
 *
 * 【约束与规则 (Rules)】
 *   - 网关地址与凭据只从环境变量读取，绝不落盘；
 *   - 端口与 user-data-dir 由系统分配，禁止硬编码；
 *   - 退出先发 CDP Browser.close 再 kill，释放 Windows 文件锁。
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { login, fetchTicket, httpProxy, liveGatewayBase, liveGatewayEnvReady } from './live-gateway-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BROWSER_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

export function findBrowser() {
  return BROWSER_PATHS.find((p) => fs.existsSync(p)) || null;
}

export { liveGatewayEnvReady };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readJsonBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (d) => { buf += d; });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); } });
  });
}

/**
 * 启动浏览器加载真实 renderer，并接入真实网关。
 * @param {object} options
 * @param {string} options.rootDir 仓库根目录（静态伺服 dist 产物）
 */
export async function launchLiveApp({ rootDir = path.resolve('.') } = {}) {
  const browserPath = findBrowser();
  if (!browserPath) throw new Error('no Edge/Chrome found');
  if (!liveGatewayEnvReady()) throw new Error('live gateway env not configured (FLUX_GATEWAY_URL/USER/PASS)');

  const gwBase = liveGatewayBase();
  // 主进程侧登录：持有 cookie（浏览器跨站带不上，必须由 Node 代理）
  const { cookie } = await login();

  // 同源代理：复刻 Electron 主进程的 authenticateGateway + httpProxy
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (obj, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };

    // 认证：换 WS ticket（对齐真实主进程 gateway:authenticate 语义）
    if (url.pathname === '/__gw/auth') {
      try {
        const body = await readJsonBody(req);
        const started = Date.now();
        // 重新登录一次，保证 cookie 新鲜（真实主进程同样按需登录）
        const fresh = await login();
        const ticket = await fetchTicket(fresh.cookie);
        server.__cookie = fresh.cookie;
        return json({ ok: true, ticket, latency: Date.now() - started, message: `认证成功 · Gateway ${gwBase}` });
      } catch (err) {
        return json({ ok: false, message: String(err), latency: 0 });
      }
    }

    // REST 代理：带 cookie 转发到真实网关
    if (url.pathname === '/__gw/proxy') {
      try {
        const body = await readJsonBody(req);
        const result = await httpProxy(server.__cookie || cookie, {
          baseUrl: body.baseUrl || gwBase,
          path: body.path,
          method: body.method,
          params: body.params,
          body: body.body,
        });
        return json(result ?? null);
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: String(err) }));
      }
    }

    // 页面与静态产物
    if (url.pathname === '/' || url.pathname === '/app.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html lang="zh-CN" data-theme="obsidian-gold"><head><meta charset="UTF-8">
<link rel="stylesheet" href="/packages/desktop/dist/renderer/styles.css"></head>
<body><div id="flux-app-root"></div>
<script src="/inject.js"></script>
<script type="module" src="/packages/desktop/dist/renderer/index.js"></script>
</body></html>`);
      return;
    }
    if (url.pathname === '/inject.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      // 注入最小桌面桥：认证与 REST 代理打到本地同源代理，WS 直连真实网关
      res.end(`
        window.hermesDesktop = {
          getSystemInfo: async () => ({ platform: 'windows', arch: 'x64' }),
          isMaximized: async () => false,
          onWindowStateChange: () => () => {},
          getDefaultGatewayConfig: async () => ({ url: '${gwBase}', key: '', profile: 'default' }),
          authenticateGateway: async (options) => {
            const r = await fetch('/__gw/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options || {}) });
            return await r.json();
          },
          httpProxy: async (options) => {
            const r = await fetch('/__gw/proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options || {}) });
            return await r.json();
          },
          appendLog: () => {},
          getLogDir: async () => null,
          clipboardWrite: async () => true,
          clipboardRead: async () => '',
        };
        try {
          localStorage.setItem('hermes_flux_gateway_url', '${gwBase}');
          localStorage.setItem('hermes_flux_profile', 'default');
          localStorage.setItem('hermes_flux_username', '');
          localStorage.setItem('hermes_flux_password', '');
        } catch (e) {}
      `);
      return;
    }

    const filePath = path.join(rootDir, url.pathname.replace(/^\//, ''));
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404); res.end('Not Found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.js' ? 'application/javascript; charset=utf-8'
      : ext === '.css' ? 'text/css; charset=utf-8'
      : ext === '.map' ? 'application/json' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  });
  server.__cookie = cookie;

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const webPort = server.address().port;

  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const debugPort = probe.address().port;
  await new Promise((r) => probe.close(r));

  const userDataDir = path.join(os.tmpdir(), `flux-live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const browser = spawn(browserPath, [
    `--remote-debugging-port=${debugPort}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: 'ignore' });

  const pageErrors = [];
  let ws = null;
  let closed = false;

  let version = null;
  for (let i = 0; i < 100 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); }
    catch { await sleep(120); }
  }
  if (!version) throw new Error('browser devtools endpoint not reachable');

  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  ws.addEventListener('message', (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push(m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text || 'exception');
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
      pageErrors.push((m.params.args || []).map((a) => a.value || a.description).join(' '));
    }
  });

  let seq = 0;
  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const onMsg = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id !== id) return;
        ws.removeEventListener('message', onMsg);
        if (m.error) reject(new Error(`${method}: ${JSON.stringify(m.error)}`));
        else resolve(m.result);
      };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${webPort}/app.html` });

  async function evaluate(expression) {
    const res = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) {
      throw new Error(`page eval failed: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
    }
    return res.result.value;
  }

  async function waitFor(expression, { timeoutMs = 8000, intervalMs = 80, label = expression } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await evaluate(expression);
        if (last) return last;
      } catch (err) { last = `eval error: ${err.message}`; }
      await sleep(intervalMs);
    }
    throw new Error(`waitFor timeout (${label}); last=${JSON.stringify(last)}`);
  }

  async function waitUntilReady() {
    await waitFor(`Boolean(window.__fluxState && window.__fluxState.gatewayConnected)`, { label: 'gateway connected', timeoutMs: 30000 });
  }

  async function close() {
    if (closed) return;
    closed = true;
    try { await cdp('Browser.close'); } catch { /* browser may be gone */ }
    try { ws.close(); } catch { /* already closed */ }
    try { browser.kill(); } catch { /* already exited */ }
    await new Promise((r) => server.close(r));
    await sleep(250);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* Windows lock */ }
  }

  return { cdp, evaluate, waitFor, waitUntilReady, pageErrors, close, webPort, debugPort, cookie, gwBase };
}
