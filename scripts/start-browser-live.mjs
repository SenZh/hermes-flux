#!/usr/bin/env node
/**
 * Hermes Flux Desktop — 浏览器直跑开发服务器 (Browser Live Runner)
 * 
 * 【设计意图 (Why)】
 *   日常开发与视觉验收完全不需要打包为 exe！
 *   通过本脚本，前端桌面壳可直接在 Chrome / Edge 等标准浏览器中 100% 运行，
 *   并直连真实 Hermes 网关，修改源码后只需刷新浏览器即可即时验证。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// 优先从环境变量取，兜底使用本地已对齐网关与凭据
const GW_BASE = (process.env.FLUX_GATEWAY_URL || process.env.HERMES_GATEWAY_URL || 'https://fn-ai.codepower.cloud:1519').replace(/\/+$/, '');
const GW_USER = process.env.FLUX_GATEWAY_USER || 'zhangsen';
const GW_PASS = process.env.FLUX_GATEWAY_PASS || '';
const PORT = Number(process.env.PORT) || 9120;

let sessionCookie = '';

async function loginGateway() {
  try {
    const res = await fetch(`${GW_BASE}/auth/password-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: GW_BASE },
      body: JSON.stringify({ username: GW_USER, password: GW_PASS, provider: 'basic' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const setCookie = res.headers.get('set-cookie') || '';
    sessionCookie = setCookie.split(';')[0] || '';
    console.log(`[Live Server] 网关认证就绪 · ${GW_BASE}`);
  } catch (err) {
    console.warn(`[Live Server] 网关登录警告 (将按免密模式探测):`, err.message);
  }
}

async function fetchWsTicket() {
  const res = await fetch(`${GW_BASE}/api/auth/ws-ticket`, {
    method: 'POST',
    headers: { Accept: 'application/json', Cookie: sessionCookie },
  });
  const data = await res.json().catch(() => ({}));
  return data.ticket || '';
}

async function httpProxy(cookie, { baseUrl, path: p, method = 'GET', params, body }) {
  const b = (baseUrl || GW_BASE).replace(/\/$/, '');
  const url = new URL(`${b}${p}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    method,
    headers: { Accept: 'application/json', Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (d) => { buf += d; });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); } });
  });
}

async function start() {
  await loginGateway();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const sendJson = (obj, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };

    // 1. 网关认证换票据接口
    if (url.pathname === '/__gw/auth') {
      try {
        const ticket = await fetchWsTicket();
        return sendJson({ ok: true, ticket, latency: 45, message: `认证就绪 · Gateway ${GW_BASE}` });
      } catch (e) {
        return sendJson({ ok: false, message: e.message, latency: 0 });
      }
    }

    // 2. 网关 REST 代理
    if (url.pathname === '/__gw/proxy') {
      try {
        const body = await readBody(req);
        const result = await httpProxy(sessionCookie, {
          baseUrl: body.baseUrl || GW_BASE,
          path: body.path,
          method: body.method,
          params: body.params,
          body: body.body,
        });
        return sendJson(result ?? null);
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: String(err) }));
      }
    }

    // 3. 页面入口
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });
      const t = Date.now();
      res.end(`<!DOCTYPE html>
<html lang="zh-CN" data-theme="obsidian-gold">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hermes Flux — 桌面壳浏览器直跑模式</title>
  <link rel="stylesheet" href="/packages/desktop/dist/renderer/styles.css?v=${t}">
  <link rel="stylesheet" href="/packages/desktop/dist/renderer/tailwind.css?v=${t}">
</head>
<body>
  <div id="flux-app-root"></div>
  <script src="/inject.js?v=${t}"></script>
  <script type="module" src="/packages/desktop/dist/renderer/index.js?v=${t}"></script>
</body>
</html>`);
      return;
    }

    // 4. 桌面桥注入
    if (url.pathname === '/inject.js') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });
      res.end(`
        window.hermesDesktop = {
          getSystemInfo: async () => ({ platform: 'windows', arch: 'x64' }),
          isMaximized: async () => false,
          onWindowStateChange: () => () => {},
          getDefaultGatewayConfig: async () => ({ url: '${GW_BASE}', key: '', profile: 'default' }),
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
          clipboardWrite: async (t) => {
            try { await navigator.clipboard.writeText(t); return true; } catch { return false; }
          },
          clipboardRead: async () => {
            try { return await navigator.clipboard.readText(); } catch { return ''; }
          },
        };
        try {
          localStorage.setItem('hermes_flux_gateway_url', '${GW_BASE}');
          localStorage.setItem('hermes_flux_profile', 'default');
          localStorage.setItem('hermes_flux_username', '${GW_USER}');
          localStorage.setItem('hermes_flux_theme', 'obsidian-gold');
          // 默认进入随窗口大小弹性自适应模式
          const oldW = localStorage.getItem('hermes_flux_rail_w_left');
          if (oldW === '264' || oldW === '296') {
            localStorage.removeItem('hermes_flux_rail_w_left');
          }
        } catch (e) {}
      `);
      return;
    }

    // 5. 静态资源伺服
    const reqPath = url.pathname.replace(/^\//, '');
    const fullPath = path.join(ROOT, reqPath);
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const mimeMap = {
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
      '.json': 'application/json; charset=utf-8',
    };
    res.writeHead(200, {
      'Content-Type': mimeMap[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    fs.createReadStream(fullPath).pipe(res);
  });

  server.listen(PORT, '127.0.0.1', () => {
    const liveUrl = `http://127.0.0.1:${PORT}/`;
    console.log(`\n======================================================`);
    console.log(`🚀 Hermes Flux Desktop 桌面壳浏览器直跑服务已就绪！`);
    console.log(`👉 地址: ${liveUrl}`);
    console.log(`⚡ 无需打包 exe，浏览器刷新即可预览最新代码改动！`);
    console.log(`======================================================\n`);

    // 自动打开浏览器
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', liveUrl], { stdio: 'ignore', detached: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [liveUrl], { stdio: 'ignore', detached: true }).unref();
    }
  });
}

start().catch(console.error);
