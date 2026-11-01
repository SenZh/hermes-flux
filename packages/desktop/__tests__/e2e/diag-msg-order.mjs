import { login, httpProxy, liveGatewayBase } from './live-gateway-client.mjs';

const { cookie } = await login();
const base = liveGatewayBase();

// 找一个消息数量 > 5 的会话
const list = await httpProxy(cookie, { baseUrl: base, path: '/api/sessions', method: 'GET', params: { profile: 'default', limit: 20 } });
const candidates = (list?.sessions || []).filter((s) => s.message_count > 5);
const target = candidates[0];
console.log('Target session:', target.id, 'msgCount:', target.message_count);

const resLatest = await httpProxy(cookie, {
  baseUrl: base,
  path: `/api/sessions/${encodeURIComponent(target.id)}/messages`,
  method: 'GET',
  params: { limit: 5, offset: 0, order: 'latest' },
});

console.log('order=latest returned count:', resLatest?.messages?.length);
for (const [i, m] of (resLatest?.messages || []).entries()) {
  console.log(`[${i}] role=${m.role} id=${m.id || m.row_id} ts=${m.timestamp} text=${(m.content || m.text || '').slice(0, 30)}`);
}

const resOldest = await httpProxy(cookie, {
  baseUrl: base,
  path: `/api/sessions/${encodeURIComponent(target.id)}/messages`,
  method: 'GET',
  params: { limit: 5, offset: 0, order: 'oldest' },
});
console.log('\norder=oldest returned count:', resOldest?.messages?.length);
for (const [i, m] of (resOldest?.messages || []).entries()) {
  console.log(`[${i}] role=${m.role} id=${m.id || m.row_id} ts=${m.timestamp} text=${(m.content || m.text || '').slice(0, 30)}`);
}
