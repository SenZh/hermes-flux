/**
 * 同源 WebSocket 隧道代理（供浏览器直跑服务与 CDP 测试夹具复用）
 *
 * 【设计意图 (Why)】
 *   浏览器安全策略禁止 JS 伪造原生 WebSocket 的 `Origin` 请求头，页面跑在
 *   `http://127.0.0.1:<port>` 时跨源直连网关 `/api/ws` 会带上页面源。
 *   新版 Hermes 网关（v0.23.1+）对跨源 HTTP `Origin` 返回 403，因此由本地
 *   Node 服务通过 `/__gw/ws` 承接升级并向目标网关注入同源 `Origin`。
 *
 * 【防范的历史坑 (Pitfall)】
 *   仅代理 `/__gw/proxy` REST 请求而放任 WebSocket 直连，在网关启用反 CSWSH
 *   校验后会触发首次握手 403，并与重连退避叠加导致无限重试死循环。
 *
 * 【约束与规则 (Rules)】
 *   - 仅允许 `ws:` 与 `wss:` 目标协议，禁止转发非 WebSocket 协议及递归代理自身；
 *   - 若请求附带 Origin，仅接受本地回环源，防止外部网页借道偷取会话 Cookie；
 *   - 任意一端 socket 触发错误或关闭（含握手在途取消）时必须销毁对端，防止句柄泄漏。
 */

import http from 'node:http';
import https from 'node:https';

const PASSTHROUGH_HEADERS = [
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-protocol',
  'sec-websocket-extensions',
];

const UPSTREAM_HANDSHAKE_TIMEOUT_MS = 15000;

function isLoopbackOrigin(rawOrigin) {
  if (!rawOrigin) return true;
  try {
    const parsed = new URL(rawOrigin);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

function rejectUpgrade(clientSocket, statusCode, statusText) {
  if (!clientSocket.destroyed) {
    try {
      clientSocket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\n\r\n`);
    } catch {
      // 对端已提前关闭时忽略写错误并直接销毁句柄
    }
    clientSocket.destroy();
  }
}

/**
 * 为本地 HTTP 服务器挂载 `/__gw/ws` WebSocket 升级隧道。
 * @param {import('node:http').Server} server
 * @param {() => string} [getCookie] 获取当前会话 Cookie 字符串的回调
 * @param {() => string} [getAllowedCookieOrigin] 获取当前允许附带 Cookie 的目标网关 Origin
 */
export function attachGatewayWsProxy(server, getCookie, getAllowedCookieOrigin) {
  server.on('upgrade', (req, clientSocket, head) => {
    clientSocket.on('error', () => {});

    if (typeof req.headers.origin === 'string' && !isLoopbackOrigin(req.headers.origin)) {
      rejectUpgrade(clientSocket, 403, 'Forbidden');
      return;
    }

    let reqUrl;
    try {
      reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    } catch {
      rejectUpgrade(clientSocket, 400, 'Bad Request');
      return;
    }

    if (reqUrl.pathname !== '/__gw/ws') {
      rejectUpgrade(clientSocket, 404, 'Not Found');
      return;
    }

    const rawTarget = reqUrl.searchParams.get('target') || '';
    if (!rawTarget) {
      rejectUpgrade(clientSocket, 400, 'Bad Request');
      return;
    }

    let targetUrl;
    try {
      targetUrl = new URL(rawTarget);
    } catch {
      rejectUpgrade(clientSocket, 400, 'Bad Request');
      return;
    }

    if (targetUrl.protocol !== 'ws:' && targetUrl.protocol !== 'wss:') {
      rejectUpgrade(clientSocket, 400, 'Bad Request');
      return;
    }
    if (targetUrl.pathname === '/__gw/ws') {
      rejectUpgrade(clientSocket, 400, 'Bad Request');
      return;
    }

    const isTls = targetUrl.protocol === 'wss:';
    const transport = isTls ? https : http;
    const upstreamOrigin = `${isTls ? 'https:' : 'http:'}//${targetUrl.host}`;
    const headers = {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      Host: targetUrl.host,
      Origin: upstreamOrigin,
    };

    for (const key of PASSTHROUGH_HEADERS) {
      const value = req.headers[key];
      if (typeof value === 'string' && value) {
        headers[key] = value;
      }
    }

    const cookie = typeof getCookie === 'function' ? getCookie() : '';
    const allowedCookieOrigin = typeof getAllowedCookieOrigin === 'function' ? getAllowedCookieOrigin() : '';
    if (cookie && (!allowedCookieOrigin || allowedCookieOrigin === upstreamOrigin)) {
      headers.Cookie = cookie;
    }

    const upstreamReq = transport.request({
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isTls ? 443 : 80),
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: 'GET',
      headers,
    });

    const onClientEarlyClose = () => {
      upstreamReq.destroy();
    };
    clientSocket.once('close', onClientEarlyClose);

    upstreamReq.setTimeout(UPSTREAM_HANDSHAKE_TIMEOUT_MS, () => {
      upstreamReq.destroy(new Error('Upstream WebSocket handshake timeout'));
    });

    upstreamReq.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
      upstreamReq.setTimeout(0);
      clientSocket.removeListener('close', onClientEarlyClose);
      upstreamSocket.on('error', () => {});

      if (clientSocket.destroyed || clientSocket.writableEnded) {
        upstreamSocket.destroy();
        return;
      }

      let responseHead = 'HTTP/1.1 101 Switching Protocols\r\n';
      const rawHeaders = upstreamRes.rawHeaders || [];
      for (let i = 0; i < rawHeaders.length; i += 2) {
        responseHead += `${rawHeaders[i]}: ${rawHeaders[i + 1]}\r\n`;
      }
      responseHead += '\r\n';

      clientSocket.write(responseHead);
      if (upstreamHead && upstreamHead.length > 0) {
        clientSocket.write(upstreamHead);
      }
      if (head && head.length > 0) {
        upstreamSocket.write(head);
      }

      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);

      let tornDown = false;
      const teardown = () => {
        if (tornDown) return;
        tornDown = true;
        if (!clientSocket.destroyed) clientSocket.destroy();
        if (!upstreamSocket.destroyed) upstreamSocket.destroy();
      };
      clientSocket.on('end', teardown);
      clientSocket.on('error', teardown);
      clientSocket.on('close', teardown);
      upstreamSocket.on('end', teardown);
      upstreamSocket.on('error', teardown);
      upstreamSocket.on('close', teardown);
    });

    upstreamReq.on('response', (upstreamRes) => {
      upstreamReq.setTimeout(0);
      clientSocket.removeListener('close', onClientEarlyClose);
      const code = upstreamRes.statusCode || 502;
      const msg = upstreamRes.statusMessage || 'Bad Gateway';
      console.warn(`[Browser Live WS Proxy] Upstream rejected ${targetUrl.origin}${targetUrl.pathname}: HTTP ${code}`);
      upstreamRes.resume();
      rejectUpgrade(clientSocket, code, msg);
    });

    upstreamReq.on('error', (err) => {
      upstreamReq.setTimeout(0);
      clientSocket.removeListener('close', onClientEarlyClose);
      console.warn(`[Browser Live WS Proxy] Upstream error for ${targetUrl.origin}${targetUrl.pathname}: ${err.message}`);
      rejectUpgrade(clientSocket, 502, 'Bad Gateway');
    });

    upstreamReq.end();
  });
}
