/**
 * React 流式渲染 spike 运行器
 *
 * 流程：esbuild 打包 → 静态服务 → Edge headless → CDP 取结果 → 写 result.json
 * 结论用于决定 P1 的流式策略，不进入生产代码。
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const rootDir = path.resolve('.');
const requireFromDesktop = createRequire(path.resolve('packages/desktop/package.json'));
const esbuild = requireFromDesktop('esbuild');

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

function findBrowser() {
  return BROWSERS.find((p) => fs.existsSync(p)) || null;
}

async function bundle() {
  fs.mkdirSync(path.join(rootDir, 'artifacts', 'spike'), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'scripts', 'spike', 'entry.tsx')],
    outfile: path.join(rootDir, 'artifacts', 'spike', 'spike.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    jsx: 'automatic',
    minify: false,
    nodePaths: [path.join(rootDir, 'packages', 'ui', 'node_modules'), path.join(rootDir, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  console.log('[spike] bundle ok');
}

function serve() {
  const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (reqPath === '/') reqPath = '/scripts/spike/index.html';
    const filePath = path.join(rootDir, reqPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function main() {
  const browserPath = findBrowser();
  if (!browserPath) throw new Error('未找到 Chrome/Edge');

  await bundle();
  const { server, port } = await serve();

  const profile = path.join(os.tmpdir(), `flux-spike-${Date.now()}`);
  const cdpPort = 9600 + Math.floor(Math.random() * 300);
  const proc = spawn(
    browserPath,
    [
      `--remote-debugging-port=${cdpPort}`,
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      `--user-data-dir=${profile}`,
      '--window-size=1440,900',
      `http://127.0.0.1:${port}/`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  proc.stderr?.on('data', (d) => {
    const line = String(d).trim();
    if (line) console.error('[browser]', line.slice(0, 300));
  });
  proc.on('error', (e) => console.error('[spawn error]', e.message));
  proc.on('exit', (code, sig) => console.error('[spawn exit]', code, sig, 'pid=', proc.pid));

  let ws = null;
  const cleanup = async () => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    } catch {}
    proc.kill();
    server.close();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(profile, { recursive: true, force: true });
  };

  try {
    let targets = [];
    let lastErr = '';
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        const res = await fetch(`http://127.0.0.1:${cdpPort}/json`);
        if (res.ok) {
          targets = await res.json();
          if (targets.length) break;
        }
      } catch (e) {
        lastErr = e.message;
      }
    }
    if (!targets.length) throw new Error(`CDP target 未就绪 (port=${cdpPort}, last=${lastErr})`);
    const page = targets.find((t) => t.type === 'page') || targets[0];
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    let id = 1;
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const reqId = id++;
        const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 15000);
        const onMsg = (evt) => {
          const msg = JSON.parse(evt.data);
          if (msg.id !== reqId) return;
          clearTimeout(timer);
          ws.removeEventListener('message', onMsg);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        };
        ws.addEventListener('message', onMsg);
        ws.send(JSON.stringify({ id: reqId, method, params }));
      });

    let done = false;
    for (let i = 0; i < 120; i++) {
      const r = await send('Runtime.evaluate', { expression: 'window.__spikeDone === true', returnByValue: true });
      if (r?.result?.value) {
        done = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!done) throw new Error('spike 超时：页面未完成基准');

    const result = await send('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__spikeResults)',
      returnByValue: true,
    });
    const parsed = JSON.parse(result.result.value);
    fs.writeFileSync(
      path.join(rootDir, 'artifacts', 'spike', 'result.json'),
      JSON.stringify(parsed, null, 2),
      'utf8'
    );
    console.log(JSON.stringify(parsed, null, 2));
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error('[spike] failed:', err.message);
  process.exit(1);
});
