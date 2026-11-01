/**
 * 真实网关 Node 侧客户端 (packages/desktop/__tests__/e2e/live-gateway-client.mjs)
 *
 * 【设计意图 (Why)】
 *   真实 Electron 进程里，网关认证（登录换 ticket）与 REST 代理由主进程经 IPC 完成，
 *   渲染层只面对 `window.hermesDesktop.authenticateGateway` / `httpProxy`。
 *   在没有 Electron 主进程的浏览器测试环境里，这两个能力由本模块承担，
 *   行为与主进程一致：持有会话 cookie、换取 WS ticket、代理 REST。
 *
 * 【约束与规则 (Rules)】
 *   - 网关地址、用户名、密码一律来自环境变量，绝不写进代码；
 *   - 只读优先：提供 listSessions / listProfiles / listGroups 供测试独立取"真值"做对账；
 *   - 写操作（建会话/发消息/删会话）由调用方显式决定，本模块不自己做任何破坏性动作。
 */

const base = () => process.env.FLUX_GATEWAY_URL || '';
const user = () => process.env.FLUX_GATEWAY_USER || '';
const pass = () => process.env.FLUX_GATEWAY_PASS || '';

export function liveGatewayEnvReady() {
  return Boolean(base() && user() && pass());
}

export function liveGatewayBase() {
  return base().replace(/\/$/, '');
}

/** 登录并拿 ticket；返回会话 cookie（供 REST 代理复用）与 ws ticket */
export async function login() {
  const b = liveGatewayBase();
  const res = await fetch(`${b}/auth/password-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: user(), password: pass(), provider: 'basic' }),
  });
  if (!res.ok) throw new Error(`login failed HTTP ${res.status}`);
  const setCookie = res.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  if (!cookie) throw new Error('login returned no session cookie');
  return { cookie };
}

export async function fetchTicket(cookie) {
  const b = liveGatewayBase();
  const res = await fetch(`${b}/api/auth/ws-ticket`, {
    method: 'POST',
    headers: { Accept: 'application/json', Cookie: cookie },
  });
  if (!res.ok) throw new Error(`ws-ticket failed HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ticket) throw new Error('ws-ticket returned no ticket');
  return data.ticket;
}

/** REST 代理：与 Electron 主进程 httpProxy 同语义（带 cookie，自动 JSON 解析） */
export async function httpProxy(cookie, { baseUrl, path: p, method = 'GET', params, body }) {
  const b = (baseUrl || liveGatewayBase()).replace(/\/$/, '');
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
  if (!res.ok) throw new Error(`httpProxy ${p} HTTP ${res.status}`);
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

/** 直连真实网关 WS 做 JSON-RPC（测试侧独立取真值，不经过渲染层） */
export function openRpc(cookie, ticket) {
  const wsUrl = `${liveGatewayBase().replace('http', 'ws')}/api/ws${ticket ? `?ticket=${encodeURIComponent(ticket)}` : ''}`;
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('ws error')));
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && pending.has(m.id)) {
        const { resolve: r, reject: j } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? j(Object.assign(new Error(m.error.message || 'rpc error'), m.error)) : r(m.result);
      }
    });
    setTimeout(() => reject(new Error('ws open timeout')), 8000);
  });
  return {
    ready,
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`${method} timeout`)); } }, 30000);
      });
    },
    close() { try { ws.close(); } catch { /* already closed */ } },
  };
}

/** 取测试对账真值：会话列表（归一化到与客户端相同的时间字段） */
export function normalizeSessions(result) {
  const raw = Array.isArray(result) ? result : Array.isArray(result?.sessions) ? result.sessions : Array.isArray(result?.data) ? result.data : [];
  return raw
    .filter((s) => s && (s.id || s.session_id))
    .map((s) => {
      const rawTs = s.last_active ?? s.started_at ?? s.created_at ?? 0;
      const numTs = typeof rawTs === 'number' ? (rawTs > 1e11 ? rawTs : rawTs * 1000) : Date.parse(rawTs) || 0;
      return {
        id: String(s.id || s.session_id),
        title: String(s.title || ''),
        preview: String(s.preview || ''),
        timestamp: numTs,
        archived: Boolean(s.archived || s.isArchived),
        hidden: Boolean(s.hidden),
        source: String(s.source || ''),
      };
    });
}
