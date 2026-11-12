import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractCookieHeader } from '../../dist/main/cookieHeader.mjs';
import { buildGatewayWsUrl, createGatewayReconnectResolver } from '../../dist/renderer/gatewayConnection.mjs';

/**
 * WebSocket 重连换票与 Cookie 解析行为测试 + 宿主接线守卫
 *
 * 【设计意图 (Why)】
 *   验证两层保证：1) extractCookieHeader 与 gatewayConnection 纯逻辑在真实输入、
 *   代际失效、鉴权失败下的可执行行为；2) renderer / preload / ipc 的接线未被误删。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererSource = readFileSync(
  path.resolve(__dirname, '../../src/renderer/index.ts'),
  'utf8'
);
const preloadSource = readFileSync(
  path.resolve(__dirname, '../../src/preload/index.ts'),
  'utf8'
);
const ipcSource = readFileSync(
  path.resolve(__dirname, '../../src/main/ipc.ts'),
  'utf8'
);

test('WebSocket 握手、重连续期与 Cookie 提取行为测试', async (t) => {
  await t.test('extractCookieHeader 正确剥离多条 Cookie 属性并兼容降级 Header', () => {
    const multi = new Headers();
    multi.getSetCookie = () => [
      ' hermes_session_at=at_val ; Path=/; HttpOnly; SameSite=Lax ',
      'hermes_session_rt="rt_val"; Path=/; Secure',
      '  ',
    ];
    assert.equal(
      extractCookieHeader(multi),
      'hermes_session_at=at_val; hermes_session_rt="rt_val"',
      '必须保留完整的多条 name=value 并剥离属性与多余空格'
    );

    const legacy = new Headers({ 'set-cookie': 'sid=abc123; Path=/; HttpOnly' });
    legacy.getSetCookie = undefined;
    assert.equal(extractCookieHeader(legacy), 'sid=abc123', '无 getSetCookie 时降级分支也必须剥离属性');

    const empty = new Headers();
    assert.equal(extractCookieHeader(empty), '', '无 Set-Cookie 时返回空串');
  });

  await t.test('buildGatewayWsUrl 正确转换协议、编码 ticket 并按宿主钩子代理改写', () => {
    assert.equal(
      buildGatewayWsUrl('https://gw.example.com:9119', 'a+b/c='),
      'wss://gw.example.com:9119/api/ws?ticket=a%2Bb%2Fc%3D'
    );
    assert.equal(
      buildGatewayWsUrl('http://192.168.50.106:9119', 't1', (u) => `ws://127.0.0.1:9120/__gw/ws?target=${encodeURIComponent(u)}`),
      'ws://127.0.0.1:9120/__gw/ws?target=ws%3A%2F%2F192.168.50.106%3A9119%2Fapi%2Fws%3Fticket%3Dt1'
    );
  });

  await t.test('createGatewayReconnectResolver 在正常续期、鉴权失败与连接断开代际失效时行为准确', async () => {
    let activeEpoch = 1;
    let ticketSeq = 0;
    const refreshedLog = [];

    const resolver = createGatewayReconnectResolver({
      epoch: 1,
      getCurrentEpoch: () => activeEpoch,
      authenticate: async () => ({
        ok: true,
        message: 'ok',
        latency: 42,
        ticket: `fresh-${++ticketSeq}`,
      }),
      buildUrl: (ticket) => buildGatewayWsUrl('http://192.168.50.106:9119', ticket),
      onRefreshed: (r) => refreshedLog.push(r),
      fallbackErrorMessage: 'fallback',
    });

    const nextUrl = await resolver();
    assert.equal(nextUrl, 'ws://192.168.50.106:9119/api/ws?ticket=fresh-1');
    assert.equal(refreshedLog.at(-1).ticket, 'fresh-1');

    const failResolver = createGatewayReconnectResolver({
      epoch: 1,
      getCurrentEpoch: () => activeEpoch,
      authenticate: async () => ({ ok: false, message: 'HTTP 401', latency: 10 }),
      buildUrl: (ticket) => buildGatewayWsUrl('http://192.168.50.106:9119', ticket),
      onRefreshed: (r) => refreshedLog.push(r),
      fallbackErrorMessage: 'fallback',
    });
    await assert.rejects(failResolver(), /HTTP 401/);

    let releasePending;
    let staleNotified = false;
    const staleResolver = createGatewayReconnectResolver({
      epoch: 1,
      getCurrentEpoch: () => activeEpoch,
      authenticate: () => new Promise((r) => { releasePending = () => r({ ok: true, message: 'ok', latency: 5, ticket: 'stale' }); }),
      buildUrl: (ticket) => buildGatewayWsUrl('http://192.168.50.106:9119', ticket),
      onRefreshed: () => { staleNotified = true; },
      fallbackErrorMessage: 'fallback',
    });

    const pendingPromise = staleResolver();
    activeEpoch = 2;
    releasePending();
    const staleResult = await pendingPromise;
    assert.equal(staleResult, null, '连接断开/切网关递增 epoch 后必须返回 null');
    assert.equal(staleNotified, false, '代际作废的在途认证绝不允许污染状态与 currentTicket');
  });

  await t.test('宿主接线守卫：renderer/preload/ipc 关键接点不可遗漏', () => {
    assert.match(rendererSource, /buildGatewayWsUrl\(baseUrl,\s*ticket,\s*desktopApi\?\.proxyWebSocketUrl\)/);
    assert.match(rendererSource, /createGatewayReconnectResolver\(\{/);
    assert.match(rendererSource, /function disconnect\(\): void \{\s*connectionEpoch\+\+;/);
    assert.match(preloadSource, /proxyWebSocketUrl\?\s*:\s*\(wsUrl:\s*string\)\s*=>\s*string/);
    assert.match(ipcSource, /extractCookieHeader\(loginRes\.headers\)/);
  });
});
