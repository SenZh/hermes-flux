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

// 优先从环境变量取，兜底使用本地已对齐网关地址；凭据一律由用户在连接面板输入，绝不落盘
const GW_BASE = (process.env.FLUX_GATEWAY_URL || process.env.HERMES_GATEWAY_URL || 'https://fn-ai.codepower.cloud:1519').replace(/\/+$/, '');
const GW_USER = process.env.FLUX_GATEWAY_USER || 'zhangsen';
const PORT = Number(process.env.PORT) || 9120;

let sessionCookie = '';

/**
 * 【设计意图 (Why)】浏览器直跑模式下，凭据由用户在连接面板输入并经 PAL 桥透传到 /__gw/auth，
 *   服务端必须复刻桌面主进程 ipc.ts:167-216 的认证链路，而非依赖环境变量预登录。
 * 【防范的历史坑 (Pitfall)】旧实现用空密码预登录导致 /auth/password-login 返回 401，
 *   sessionCookie 为空，/api/auth/ws-ticket 返回 401 no_cookie；且 ticket 为空时仍返回
 *   ok:true，把鉴权失败伪装成成功，使前端拼出不带 ticket 的 WS URL 被网关拒绝握手。
 * 【约束与规则 (Rules)】登录 → 提取 Set-Cookie → 带 Cookie 换 ticket 三步必须全部成功；
 *   任一步失败都显式返回 ok:false，ticket 缺失等同失败，绝不降级为空字符串（Failure Is Not Empty）。
 */
async function authenticateWithCredentials(baseUrl, username, password) {
  const base = (baseUrl || GW_BASE).replace(/\/+$/, '');
  const loginRes = await fetch(`${base}/auth/password-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: base },
    body: JSON.stringify({ username, password, provider: 'basic' }),
  });
  if (loginRes.status === 401) {
    throw new Error('认证失败: 用户名或密码错误 (HTTP 401)');
  }
  if (!loginRes.ok) {
    throw new Error(`登录接口异常 HTTP ${loginRes.status}`);
  }

  // 仅取每条 Set-Cookie 的 name=value 段，剥离 Path/Expires/HttpOnly 等属性后拼成请求头
  const setCookies = typeof loginRes.headers.getSetCookie === 'function'
    ? loginRes.headers.getSetCookie()
    : [loginRes.headers.get('set-cookie') || ''];
  sessionCookie = setCookies.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
  if (!sessionCookie) {
    throw new Error('登录成功但网关未下发会话 Cookie，无法换取 WS ticket');
  }

  const ticketRes = await fetch(`${base}/api/auth/ws-ticket`, {
    method: 'POST',
    headers: { Accept: 'application/json', Cookie: sessionCookie, Origin: base },
  });
  if (!ticketRes.ok) {
    throw new Error(`获取 WebSocket 凭证失败 HTTP ${ticketRes.status}`);
  }
  const ticketData = await ticketRes.json().catch(() => ({}));
  if (typeof ticketData.ticket !== 'string' || !ticketData.ticket) {
    throw new Error('网关未返回有效的 WebSocket ticket');
  }
  return ticketData.ticket;
}

async function httpProxy(cookie, { baseUrl, path: p, method = 'GET', params, body, ticket }) {
  const b = (baseUrl || GW_BASE).replace(/\/$/, '');
  const url = new URL(`${b}${p}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  // REST 降级通道与桌面主进程 ipc.ts:268-270 对齐，透传 X-WS-Ticket，否则网关按无凭证拒绝
  const headers = { Accept: 'application/json', Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) };
  if (ticket) headers['X-WS-Ticket'] = ticket;
  const res = await fetch(url, {
    method,
    headers,
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
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const sendJson = (obj, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };

    // 1. 网关认证换票据接口：凭据来自连接面板，原样透传，不做环境变量预登录
    if (url.pathname === '/__gw/auth') {
      const startAt = Date.now();
      try {
        const body = await readBody(req);
        const ticket = await authenticateWithCredentials(
          body.url || body.baseUrl || GW_BASE,
          typeof body.username === 'string' ? body.username : '',
          typeof body.password === 'string' ? body.password : '',
        );
        return sendJson({ ok: true, ticket, latency: Date.now() - startAt, message: `认证就绪 · Gateway ${GW_BASE}` });
      } catch (e) {
        return sendJson({ ok: false, message: e.message, latency: Date.now() - startAt });
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
          ticket: body.ticket,
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

    // 自动打开浏览器；CI / 自动化探针通过 FLUX_NO_OPEN_BROWSER 关闭，避免拉起真实窗口
    if (!process.env.FLUX_NO_OPEN_BROWSER) {
      if (process.platform === 'win32') {
        spawn('cmd.exe', ['/c', 'start', liveUrl], { stdio: 'ignore', detached: true }).unref();
      } else if (process.platform === 'darwin') {
        spawn('open', [liveUrl], { stdio: 'ignore', detached: true }).unref();
      }
    }
  });
}

start().catch(console.error);
