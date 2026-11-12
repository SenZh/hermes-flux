/**
 * 网关 WebSocket 地址适配与重连续期决策纯函数模块。
 *
 * 【设计意图 (Why)】
 *   新版 Hermes 网关（v0.23.1+）强制一次性 ws-ticket 与同源 Origin 校验，
 *   将地址改写和重连代际校验逻辑从 renderer 大文件中剥离为独立纯模块，
 *   使单元测试可直接验证真实行为而不是仅靠源码文本正则。
 */

export interface GatewayAuthResponse {
  ok: boolean;
  message: string;
  latency: number;
  ticket?: string;
}

export function buildGatewayWsUrl(
  baseUrl: string,
  ticket?: string,
  proxyWebSocketUrl?: (wsUrl: string) => string
): string {
  let raw = baseUrl.replace('http://', 'ws://').replace('https://', 'wss://') + '/api/ws';
  if (ticket) {
    raw += `?ticket=${encodeURIComponent(ticket)}`;
  }
  return proxyWebSocketUrl ? proxyWebSocketUrl(raw) : raw;
}

export function createGatewayReconnectResolver(deps: {
  epoch: number;
  getCurrentEpoch: () => number;
  authenticate: () => Promise<GatewayAuthResponse>;
  buildUrl: (ticket?: string) => string;
  onRefreshed: (result: GatewayAuthResponse) => void;
  fallbackErrorMessage: string;
}): () => Promise<string | null> {
  return async () => {
    if (deps.epoch !== deps.getCurrentEpoch()) return null;
    const refreshed = await deps.authenticate();
    if (deps.epoch !== deps.getCurrentEpoch()) return null;
    deps.onRefreshed(refreshed);
    if (!refreshed.ok) {
      throw new Error(refreshed.message || deps.fallbackErrorMessage);
    }
    return deps.buildUrl(refreshed.ticket);
  };
}
