/**
 * REST 适配器行为测试（真实模块，假 proxy）。
 *
 * 【为什么需要】providerAdminRest 是 URL 拼接、profile 作用域、错误归一与
 *   encodeURIComponent 的唯一实现点。它此前零测试，任何一处改错（把 detail 丢掉、
 *   把 profile 漏传、把空格 id 不编码）都不会让任何测试变红。
 *
 * 【口径】只断言注入 proxy 收到的参数与归一化后的结果，不碰网络。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProviderAdminRest,
  describeProviderAdminError,
  ProviderAdminError,
} from '../../dist/renderer/providerAdminRest.mjs';

function makeRest(responder) {
  const calls = [];
  const rest = createProviderAdminRest({
    baseUrl: () => 'https://gw.example:1519',
    ticket: () => 'ticket-1',
    proxy: async (options) => {
      calls.push(options);
      return responder(options);
    },
  });
  return { rest, calls };
}

const payload = {
  id: 'gw',
  name: '内部网关',
  base_url: 'https://llm.internal/v1',
  model: 'm1',
  api_mode: '',
  discover_models: true,
  make_default: false,
};

test('listEndpoints：必须带 profile，且打到端点列表路径', async () => {
  const { rest, calls } = makeRest(() => ({ endpoints: [{ id: 'gw', base_url: 'https://x/v1', model: 'm' }] }));
  const rows = await rest.listEndpoints('aura');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/providers/custom-endpoints');
  assert.deepEqual(calls[0].params, { profile: 'aura' }, '漏传 profile 会写到网关默认 profile');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].baseUrl, 'https://gw.example:1519');
  assert.equal(calls[0].ticket, 'ticket-1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'gw');
});

test('saveEndpoint：POST + profile，返回体缺 id 时回落到请求里的 id', async () => {
  const { rest, calls } = makeRest(() => ({ ok: true, endpoints: [] }));
  const saved = await rest.saveEndpoint('codeboy', payload);
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].params, { profile: 'codeboy' });
  assert.equal(calls[0].body.id, 'gw');
  assert.equal(saved.id, 'gw', '网关没回 id 时不得丢成空串');
});

test('probeEndpoint：探测不落盘，因此不得带 profile', async () => {
  const { rest, calls } = makeRest(() => ({ ok: true, reachable: true, models: ['a'], resolved_base_url: 'https://x/v1' }));
  const probe = await rest.probeEndpoint(payload);
  assert.equal(calls[0].path, '/api/providers/custom-endpoints/validate');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].params, undefined, '探测请求带 profile 会让网关按该 profile 的密钥解析，行为失真');
  assert.equal(probe.kind, 'ok');
});

test('deleteEndpoint：带空格的 id 必须 URL 编码，否则网关 404', async () => {
  const { rest, calls } = makeRest(() => ({ endpoints: [] }));
  await rest.deleteEndpoint('default', 'Local 8000');
  assert.equal(calls[0].path, '/api/providers/custom-endpoints/Local%208000', '原始空格会让路径断在空格处');
  assert.equal(calls[0].method, 'DELETE');
  assert.deepEqual(calls[0].params, { profile: 'default' });
});

test('activateEndpoint：POST 到 activate 路径并解析 provider/model', async () => {
  const { rest, calls } = makeRest(() => ({ ok: true, provider: 'gw', model: 'm1' }));
  const result = await rest.activateEndpoint('default', 'gw');
  assert.equal(calls[0].path, '/api/providers/custom-endpoints/gw/activate');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(result, { provider: 'gw', model: 'm1' });
});

test('setMainModel：走通用的 /api/model/set，scope=main 且带 profile', async () => {
  const { rest, calls } = makeRest(() => ({ ok: true, provider: 'xai-oauth', model: 'grok-4' }));
  const result = await rest.setMainModel('aura', { provider: 'xai-oauth', model: 'grok-4' });
  assert.equal(calls[0].path, '/api/model/set');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].params, { profile: 'aura' });
  assert.deepEqual(calls[0].body, { scope: 'main', provider: 'xai-oauth', model: 'grok-4' });
  assert.deepEqual(result, { provider: 'xai-oauth', model: 'grok-4', confirmRequired: false, confirmMessage: undefined });
});

test('setMainModel：自定义端点必须带上 base_url，否则网关会去猜路由', async () => {
  const { rest, calls } = makeRest(() => ({ ok: true }));
  await rest.setMainModel('default', { provider: 'fn', model: 'm1', baseUrl: 'http://gw/v1' });
  assert.equal(calls[0].body.base_url, 'http://gw/v1');
});

test('setMainModel：confirm_required 必须原样透出，不能当成功', async () => {
  const { rest } = makeRest(() => ({ ok: false, confirm_required: true, confirm_message: 'priced high' }));
  const result = await rest.setMainModel('default', { provider: 'openrouter', model: 'expensive/x' });
  assert.equal(result.confirmRequired, true);
  assert.equal(result.confirmMessage, 'priced high');
});

test('setMainModel：确认后带 confirm_expensive_model 重发', async () => {
  const { rest, calls } = makeRest(() => ({ ok: true }));
  await rest.setMainModel('default', { provider: 'openrouter', model: 'x', confirmExpensive: true });
  assert.equal(calls[0].body.confirm_expensive_model, true);
});

test('listOauthProviders：只读，带 profile', async () => {
  const { rest, calls } = makeRest(() => ({ providers: [{ id: 'nous', status: { logged_in: true } }] }));
  const rows = await rest.listOauthProviders('aura');
  assert.equal(calls[0].path, '/api/providers/oauth');
  assert.deepEqual(calls[0].params, { profile: 'aura' });
  assert.equal(rows[0].loggedIn, true);
});

test('describeProviderAdminError：剥离 Electron 的 IPC 包装前缀后取出 detail', () => {
  const wrapped = new Error(
    "Error invoking remote method 'gateway:http-proxy': Error: HTTP 400: base_url must include scheme and host",
  );
  const described = describeProviderAdminError(wrapped);
  assert.equal(described.status, 400);
  assert.equal(described.message, 'base_url must include scheme and host');
});

test('describeProviderAdminError：ProviderAdminError 直接透出，不二次解析', () => {
  const described = describeProviderAdminError(new ProviderAdminError(404, 'custom endpoint not found'));
  assert.deepEqual(described, { status: 404, message: 'custom endpoint not found' });
});

test('describeProviderAdminError：无状态码的纯文本错误保留原文', () => {
  assert.deepEqual(describeProviderAdminError(new Error('Desktop REST proxy is unavailable')), {
    status: 0,
    message: 'Desktop REST proxy is unavailable',
  });
});

test('所有方法在 proxy 抛错时统一转成 ProviderAdminError，禁止裸 Error 冒到 UI', async () => {
  const { rest } = makeRest(() => {
    throw new Error('HTTP 403: forbidden');
  });
  await assert.rejects(
    () => rest.listEndpoints('default'),
    (error) => error instanceof ProviderAdminError && error.status === 403 && error.detail === 'forbidden',
  );
  await assert.rejects(
    () => rest.deleteEndpoint('default', 'gw'),
    (error) => error instanceof ProviderAdminError && error.status === 403,
  );
});
