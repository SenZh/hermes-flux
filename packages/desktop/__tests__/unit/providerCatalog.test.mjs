/**
 * 统一提供商目录装载的行为测试（真实模块，假网关）。
 *
 * 【为什么需要】这个文件决定"首屏发几次请求""哪个 Agent 读取失败会不会被吞"，
 *   两条都是线上事故的形态：串行会让设置页开得慢，静默会让用户对着一张
 *   "未配置"的对账表重复配置已经配好的端点。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProviderCatalog } from '../../dist/renderer/providerCatalog.mjs';

const agents = [
  { profile: 'default', displayName: 'default' },
  { profile: 'aura', displayName: 'aura' },
];

function fakeRpc(optionsByProfile, failProfiles = []) {
  const calls = [];
  return {
    calls,
    async call(method, params) {
      calls.push([method, params]);
      const profile = params?.profile;
      if (failProfiles.includes(profile)) throw new Error(`HTTP 500: ${profile} options failed`);
      return { providers: optionsByProfile[profile] ?? [] };
    },
  };
}

function fakeRest({ endpoints = {}, oauth = [], failEndpoints = [], failOauth = false } = {}) {
  const calls = [];
  return {
    calls,
    async listEndpoints(profile) {
      calls.push(['listEndpoints', profile]);
      if (failEndpoints.includes(profile)) throw new Error(`HTTP 500: ${profile} endpoints failed`);
      return endpoints[profile] ?? [];
    },
    async listOauthProviders(profile) {
      calls.push(['listOauthProviders', profile]);
      if (failOauth) throw new Error('HTTP 500: oauth failed');
      return oauth;
    },
    async saveEndpoint() { throw new Error('unused'); },
    async probeEndpoint() { throw new Error('unused'); },
    async activateEndpoint() { throw new Error('unused'); },
    async setMainModel() { throw new Error('unused'); },
    async deleteEndpoint() { throw new Error('unused'); },
    async startOauthLogin() { throw new Error('unused'); },
    async pollOauthLogin() { throw new Error('unused'); },
    async cancelOauthLogin() { throw new Error('unused'); },
    async disconnectOauth() { throw new Error('unused'); },
  };
}

const describeError = (error) => (error instanceof Error ? error.message : String(error));

test('首屏请求：每个 Agent 各一次 model.options（explicit_only），端点按 profile 拉，订阅只拉一份', async () => {
  const rpc = fakeRpc({
    default: [{ slug: 'fn', models: ['a'], is_current: true, is_user_defined: true }],
    aura: [{ slug: 'fn', models: ['a'], is_current: true, is_user_defined: true }],
  });
  const rest = fakeRest({ endpoints: { default: [], aura: [] } });

  const result = await loadProviderCatalog({ agents, rest, rpc, describeError });

  const optionCalls = rpc.calls.filter((call) => call[0] === 'model.options');
  assert.equal(optionCalls.length, 2);
  for (const call of optionCalls) {
    assert.equal(call[1].explicit_only, true, 'include_unconfigured 会掺进 54 个骨架行，掺进来就判不出谁真的配了');
    assert.ok(call[1].profile, '必须按 profile 作用域拉取');
  }
  assert.equal(rest.calls.filter((call) => call[0] === 'listEndpoints').length, 2);
  assert.equal(rest.calls.filter((call) => call[0] === 'listOauthProviders').length, 1, '订阅目录只需一份');
  assert.equal(result.views.length, 1);
});

test('单个 Agent 读取失败：必须进 failed 通道并在该 Agent 上标 error，不能折成未配置', async () => {
  const rpc = fakeRpc(
    { default: [{ slug: 'fn', models: ['a'], is_current: true, is_user_defined: true }] },
    ['aura'],
  );
  const rest = fakeRest({ endpoints: { default: [], aura: [] } });

  const result = await loadProviderCatalog({ agents, rest, rpc, describeError });
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].profile, 'aura');
  assert.match(result.failed[0].message, /options failed/);

  const fn = result.views.find((view) => view.id === 'fn');
  const aura = fn.agents.find((agent) => agent.profile === 'aura');
  assert.equal(aura.state, 'error', '读取失败被标成 absent 会诱使用户重复配置');
  assert.equal(fn.availability, 'error');
});

test('订阅目录拉取失败：其余数据照常返回，但必须显式标记失败', async () => {
  const rpc = fakeRpc({ default: [], aura: [] });
  const rest = fakeRest({ endpoints: { default: [], aura: [] }, failOauth: true });

  const result = await loadProviderCatalog({ agents, rest, rpc, describeError });
  assert.equal(result.subscriptionsOk, false);
  assert.match(result.subscriptionsError, /oauth failed/);
  assert.deepEqual(result.views, [], '订阅失败不得编造订阅行');
});

test('端点列表失败时该 profile 的端点不可见，但不得阻断整个目录', async () => {
  const rpc = fakeRpc({
    default: [{ slug: 'fn', models: ['a'], is_current: true, is_user_defined: true }],
    aura: [{ slug: 'fn', models: ['a'], is_current: true, is_user_defined: true }],
  });
  const rest = fakeRest({
    endpoints: { default: [{ id: 'fn', name: 'fn', baseUrl: 'http://gw/v1', models: ['a'], hasApiKey: true }] },
    failEndpoints: ['aura'],
  });

  const result = await loadProviderCatalog({ agents, rest, rpc, describeError });
  const fn = result.views.find((view) => view.id === 'fn');
  assert.equal(fn.name, 'fn', '默认 profile 拉到了，列表照常渲染');
  assert.equal(result.failed.length, 0, '端点失败不该冒充成 Agent 读取失败');
});

test('原始行必须随目录一起回传：编辑表单要 base_url，添加弹框要含未登录项', async () => {
  const rpc = fakeRpc({ default: [{ slug: 'fn', models: ['a'], is_current: true }] });
  const rest = fakeRest({
    endpoints: {
      default: [{ id: 'fn', name: 'fn', baseUrl: 'http://gw/v1', models: ['a'], hasApiKey: true }],
    },
    oauth: [
      { id: 'xai-oauth', name: 'xAI', flow: 'device_code', loggedIn: true },
      { id: 'nous', name: 'Nous Portal', flow: 'device_code', loggedIn: false },
    ],
  });

  const result = await loadProviderCatalog({ agents, rest, rpc, describeError });
  const fn = result.endpoints.find((entry) => entry.row.id === 'fn');
  assert.equal(fn.row.baseUrl, 'http://gw/v1', '没有 base_url，编辑弹框只能打开一个空表单');
  assert.deepEqual(fn.profiles, ['default'], '删除要知道这个端点出现在哪些 Agent 上');

  assert.equal(result.subscriptions.length, 2, '添加弹框必须能看到全部订阅，包括未登录的');
  assert.equal(
    result.views.some((view) => view.id === 'nous'),
    false,
    '未登录订阅只进添加弹框，不进主列表',
  );
});

test('同一端点被多个 Agent 返回时收敛成一条，并记录全部 Agent', async () => {
  const rpc = fakeRpc({
    default: [{ slug: 'fn', models: ['a'], is_current: true }],
    aura: [{ slug: 'fn', models: ['a', 'b'], is_current: true }],
  });
  const rest = fakeRest({
    endpoints: {
      default: [{ id: 'fn', name: 'fn', baseUrl: 'http://gw/v1', models: ['a'], hasApiKey: true }],
      aura: [{ id: 'fn', name: 'fn', baseUrl: 'http://gw/v1', models: ['a', 'b'], hasApiKey: true }],
    },
  });

  const result = await loadProviderCatalog({ agents, rest, rpc, describeError });
  assert.equal(result.endpoints.length, 1, '重复行会让用户以为配了两遍');
  assert.deepEqual(result.endpoints[0].profiles, ['default', 'aura']);
  assert.deepEqual(result.endpoints[0].row.models, ['a', 'b'], '模型取更全的那份');
});

test('端点清单读取失败必须进 endpointFailures：删除范围不完整时不许猜着删', async () => {
  const rpc = fakeRpc({
    default: [{ slug: 'fn', models: ['a'], is_current: true }],
    aura: [{ slug: 'fn', models: ['a'], is_current: true }],
  });
  const rest = fakeRest({
    endpoints: {
      default: [{ id: 'fn', name: 'fn', baseUrl: 'http://gw/v1', models: ['a'], hasApiKey: true }],
    },
    failEndpoints: ['aura'],
  });

  const result = await loadProviderCatalog({ agents, rest, rpc, describeError });
  assert.equal(result.endpointFailures.length, 1, '读不到的 Agent 必须单独成通道，不能静默跳过');
  assert.equal(result.endpointFailures[0].profile, 'aura');
  assert.ok(result.endpointFailures[0].message.includes('aura endpoints failed'));
  assert.deepEqual(
    result.endpoints[0].profiles,
    ['default'],
    '配置集合因此不完整：删除若放行会漏掉 aura 上的同一个端点',
  );
});

test('custom:fn 与 fn 是同一个端点：按归一化 id 收敛，配置集合不得被覆盖', async () => {
  const rpc = fakeRpc({
    default: [{ slug: 'custom:fn', models: ['a'], is_current: true }],
    aura: [{ slug: 'fn', models: ['a'], is_current: true }],
  });
  const rest = fakeRest({
    endpoints: {
      default: [{ id: 'custom:fn', name: 'fn', baseUrl: 'http://gw/v1', models: ['a'], hasApiKey: true }],
      aura: [{ id: 'fn', name: 'fn', baseUrl: 'http://gw/v1', models: ['a'], hasApiKey: true }],
    },
  });

  const result = await loadProviderCatalog({ agents, rest, rpc, describeError });
  assert.equal(result.endpoints.length, 1, '两种拼写必须收敛成一条');
  assert.deepEqual(result.endpoints[0].profiles, ['default', 'aura'], '否则配置集合会被 Object.fromEntries 覆盖成一份');
  assert.equal(result.endpoints[0].row.id, 'fn', '归一化后的 id 才能与视图层对齐');
});
