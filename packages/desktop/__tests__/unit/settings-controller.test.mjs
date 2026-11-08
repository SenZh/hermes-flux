/**
 * 设置编排行为测试（真实模块，假网关）。
 *
 * 【为什么需要】renderer 里的设置编排此前只有"源码字符串存在性"守卫：
 *   把失败态改成空数组、把 reload.env 的降级改成静默、把并发令牌删掉，
 *   那些测试全部不会变红。本文件直接驱动编译产物，对**行为**下断言。
 *
 * 【口径】所有断言只观察 deps 的状态与调用记录，不依赖真实 DOM / 网关。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsController } from '../../dist/renderer/settingsController.mjs';

function makeHarness(overrides = {}) {
  const calls = [];
  const toasts = [];
  const warnings = [];
  const state = {
    connected: true,
    profile: 'default',
    currentProvider: 'openrouter',
    providers: { status: 'idle' },
    profiles: { status: 'idle' },
    mcp: { status: 'idle' },
    skills: { status: 'idle' },
    busy: false,
    renders: 0,
    catalogChanges: 0,
  };

  const deps = {
    isConnected: () => state.connected,
    profileName: () => state.profile,
    currentProvider: () => state.currentProvider,
    call: async (method, params) => {
      calls.push({ method, params });
      if (overrides.call) return overrides.call(method, params, state);
      if (method === 'model.options') return { providers: [{ slug: 'openrouter', name: 'OpenRouter', models: ['a'], authenticated: true }] };
      if (method === 'profiles.list') return { profiles: [{ name: 'default', display_name: 'Hermes', is_default: true }] };
      if (method === 'mcp.servers.status') return { servers: [{ name: 'github', transport: 'stdio', tools: 3, connected: true }] };
      if (method === 'skills.manage') return { skills: { builtin: ['review'] } };
      if (method === 'skills.reload') return { output: 'ok', result: {} };
      if (method === 'model.save_key') return { provider: 'openrouter' };
      if (method === 'model.disconnect') return { slug: 'openrouter', disconnected: true };
      if (method === 'reload.env') return { updated: true };
      return {};
    },
    render: () => { state.renders += 1; },
    translate: (key) => key,
    describeError: (error) => (error instanceof Error ? error.message : String(error)),
    getProviders: () => state.providers,
    setProviders: (value) => { state.providers = value; },
    getProfiles: () => state.profiles,
    setProfiles: (value) => { state.profiles = value; },
    getMcp: () => state.mcp,
    setMcp: (value) => { state.mcp = value; },
    getSkills: () => state.skills,
    setSkills: (value) => { state.skills = value; },
    setBusy: (busy) => { state.busy = busy; },
    onCatalogChanged: () => { state.catalogChanges += 1; },
    notify: (message) => { toasts.push(message); },
    warn: (message, meta) => { warnings.push({ message, meta }); },
    ...overrides.deps,
  };

  return { deps, state, calls, toasts, warnings, controller: createSettingsController(deps) };
}

test('未连接：进入 error 态，且不得向网关发任何请求', async () => {
  const h = makeHarness({ deps: { isConnected: () => false } });
  await h.controller.loadProviders();
  assert.equal(h.state.providers.status, 'error');
  assert.equal(h.state.providers.message, 'settings.notConnected');
  assert.deepEqual(h.calls, []);
});

test('提供商加载：携带 include_unconfigured，成功后归一化为 ready', async () => {
  const h = makeHarness();
  await h.controller.loadProviders();
  assert.deepEqual(h.calls[0], {
    method: 'model.options',
    params: { profile: 'default', include_unconfigured: true },
  });
  assert.equal(h.state.providers.status, 'ready');
  assert.equal(h.state.providers.data[0].slug, 'openrouter');
});

test('提供商加载失败：保留原始错误信息，绝不降级成空数组', async () => {
  const h = makeHarness({ call: () => { throw new Error('socket closed'); } });
  await h.controller.loadProviders();
  assert.equal(h.state.providers.status, 'error');
  assert.equal(h.state.providers.message, 'socket closed');
});

test('并发刷新：先发后至的旧响应不得覆盖最后一次结果', async () => {
  let resolveFirst;
  let resolveSecond;
  const h = makeHarness({
    call: (method) => {
      if (method !== 'model.options') return {};
      return new Promise((resolve) => {
        if (!resolveFirst) resolveFirst = resolve;
        else resolveSecond = resolve;
      });
    },
  });

  const first = h.controller.loadProviders();
  const second = h.controller.loadProviders();
  resolveSecond({ providers: [{ slug: 'newer', name: 'Newer', models: ['x'] }] });
  await second;
  resolveFirst({ providers: [{ slug: 'older', name: 'Older', models: ['y'] }] });
  await first;

  assert.equal(h.state.providers.status, 'ready');
  assert.equal(h.state.providers.data[0].slug, 'newer', '旧请求晚返回时必须被令牌丢弃');
});

test('保存密钥：成功后刷新目录并通知输入舱，busy 复位', async () => {
  const h = makeHarness();
  const result = await h.controller.saveProviderKey('openrouter', 'sk-live');
  assert.equal(result.ok, true);
  assert.deepEqual(
    h.calls.map((call) => call.method),
    ['model.save_key', 'reload.env', 'model.options'],
  );
  assert.equal(h.calls[0].params.api_key, 'sk-live');
  assert.equal(h.state.catalogChanges, 1);
  assert.equal(h.state.busy, false);
});

test('reload.env 失败：密钥已落盘，保存仍算成功，但必须显式记录降级', async () => {
  const h = makeHarness({
    call: (method) => {
      if (method === 'reload.env') throw new Error('env reload failed');
      if (method === 'model.save_key') return { provider: 'openrouter' };
      return { providers: [] };
    },
  });
  const result = await h.controller.saveProviderKey('openrouter', 'sk-live');
  assert.equal(result.ok, true);
  assert.equal(h.warnings.length, 1);
  assert.match(h.warnings[0].message, /reload\.env/);
});

test('保存失败：返回失败原因，且提供商表保持原样（不得整表替换成 error）', async () => {
  const existing = { status: 'ready', data: [{ slug: 'openrouter', name: 'OpenRouter' }] };
  const h = makeHarness({
    call: (method) => {
      if (method === 'model.save_key') throw new Error('401 invalid key');
      return {};
    },
  });
  h.state.providers = existing;

  const result = await h.controller.saveProviderKey('openrouter', 'bad-key');
  assert.equal(result.ok, false);
  assert.equal(result.message, '401 invalid key');
  assert.equal(h.state.providers, existing, '失败时不得把整表覆盖为错误态（用户已输入内容会随之丢失）');
  assert.equal(h.state.busy, false);
});

test('并发保存：非对称完成时忙态必须保持到最后一个请求结束', async () => {
  const releases = [];
  const h = makeHarness({
    call: (method) => {
      if (method !== 'model.save_key') {
        if (method === 'model.options') return { providers: [] };
        return {};
      }
      return new Promise((resolve) => { releases.push(resolve); });
    },
  });

  const first = h.controller.saveProviderKey('a', 'k1');
  const second = h.controller.saveProviderKey('b', 'k2');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(h.state.busy, true);

  // 只放行第一个：若实现退化成布尔，这里会错误地归零。
  releases[0]({ provider: 'a' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(h.state.busy, true, '第一个保存完成后，第二个仍在途，忙态不得归零');

  releases[1]({ provider: 'b' });
  await Promise.all([first, second]);
  assert.equal(h.state.busy, false, '所有请求结束后忙态必须清零');
});

test('ensureSection：idle 才加载；force 强制重拉；已 ready 不重复打网关', async () => {
  const h = makeHarness();
  h.controller.ensureSection('providers');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(h.calls.filter((call) => call.method === 'model.options').length, 1);

  h.controller.ensureSection('providers');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(h.calls.filter((call) => call.method === 'model.options').length, 1, '已 ready 不得重复拉取');

  h.controller.ensureSection('providers', true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(h.calls.filter((call) => call.method === 'model.options').length, 2, 'force 必须重拉');

  h.controller.ensureSection('appearance');
  assert.equal(h.calls.length, 2, '外观域是本地偏好，不得打网关');
});

test('扩展页：单边失败不得拖垮另一边（allSettled 语义）', async () => {
  const h = makeHarness({
    call: (method) => {
      if (method === 'mcp.servers.status') throw new Error('mcp down');
      if (method === 'skills.manage') return { skills: { builtin: ['review'] } };
      return {};
    },
  });
  await h.controller.loadExtensions();
  assert.equal(h.state.mcp.status, 'error');
  assert.equal(h.state.mcp.message, 'mcp down');
  assert.equal(h.state.skills.status, 'ready');
  assert.equal(h.state.skills.data[0].name, 'review');
});

test('技能重扫失败：返回失败原因，不弹成功提示', async () => {
  const h = makeHarness({
    call: (method) => {
      if (method === 'skills.reload') throw new Error('reload failed');
      return {};
    },
  });
  const result = await h.controller.reloadSkills();
  assert.equal(result.ok, false);
  assert.equal(result.message, 'reload failed');
  assert.deepEqual(h.toasts, []);
  assert.equal(h.state.busy, false);
});

test('技能重扫成功：刷新扩展页并给出一条成功提示', async () => {
  const h = makeHarness();
  const result = await h.controller.reloadSkills();
  assert.equal(result.ok, true);
  assert.deepEqual(h.toasts, ['settings.skillsReloaded']);
  assert.equal(h.state.skills.status, 'ready');
});

test('断开提供商成功：刷新目录并通知输入舱', async () => {
  const h = makeHarness();
  const result = await h.controller.disconnectProvider('openrouter');
  assert.equal(result.ok, true);
  assert.deepEqual(
    h.calls.map((call) => call.method),
    ['model.disconnect', 'model.options'],
  );
  assert.equal(h.state.catalogChanges, 1);
});

test('数字员工加载：display_name 缺省时回落到 name，并保留 isDefault', async () => {
  const h = makeHarness();
  await h.controller.loadProfiles();
  assert.equal(h.state.profiles.status, 'ready');
  assert.equal(h.state.profiles.data[0].displayName, 'Hermes');
  assert.equal(h.state.profiles.data[0].isDefault, true);
});

test('未连接：保存 / 断开 / 重扫都必须显式失败且不发请求', async () => {
  const h = makeHarness({ deps: { isConnected: () => false } });
  for (const [method, invoke] of [
    ['save', () => h.controller.saveProviderKey('x', 'k')],
    ['disconnect', () => h.controller.disconnectProvider('x')],
    ['reload', () => h.controller.reloadSkills()],
  ]) {
    const result = await invoke();
    assert.equal(result.ok, false, `${method} 未连接时必须失败`);
    assert.equal(result.message, 'settings.notConnected');
  }
  assert.deepEqual(h.calls, [], '未连接时不得向网关发任何请求');
});

test('断开失败：返回原因，提供商表原样保留，且不触发目录刷新', async () => {
  const existing = { status: 'ready', data: [{ slug: 'x', name: 'X' }] };
  const h = makeHarness({
    call: (method) => {
      if (method === 'model.disconnect') throw new Error('403 forbidden');
      return {};
    },
  });
  h.state.providers = existing;
  const result = await h.controller.disconnectProvider('x');
  assert.equal(result.ok, false);
  assert.equal(result.message, '403 forbidden');
  assert.equal(h.state.providers, existing);
  assert.equal(h.state.catalogChanges, 0, '失败时不得刷新输入舱目录');
  assert.equal(h.state.busy, false);
});

test('数字员工加载失败：落 error 并保留网关原因', async () => {
  const h = makeHarness({ call: () => { throw new Error('profiles down'); } });
  await h.controller.loadProfiles();
  assert.equal(h.state.profiles.status, 'error');
  assert.equal(h.state.profiles.message, 'profiles down');
});

test('协议成功但形状不符：必须显式失败，不得伪装成空列表', async () => {
  const malformedProviders = makeHarness({ call: () => ({}) });
  await malformedProviders.controller.loadProviders();
  assert.equal(malformedProviders.state.providers.status, 'error');
  assert.equal(malformedProviders.state.providers.message, 'settings.malformedResponse');

  const malformedProfiles = makeHarness({ call: () => null });
  await malformedProfiles.controller.loadProfiles();
  assert.equal(malformedProfiles.state.profiles.status, 'error');
  assert.equal(malformedProfiles.state.profiles.message, 'settings.malformedResponse');

  const emptyIsValid = makeHarness({ call: () => ({ providers: [] }) });
  await emptyIsValid.controller.loadProviders();
  assert.equal(emptyIsValid.state.providers.status, 'ready', '合法空列表必须是 ready，而不是 error');
  assert.deepEqual(emptyIsValid.state.providers.data, []);
});

test('扩展页未连接：MCP 与技能都落 error，不发请求', async () => {
  const h = makeHarness({ deps: { isConnected: () => false } });
  await h.controller.loadExtensions();
  assert.equal(h.state.mcp.status, 'error');
  assert.equal(h.state.skills.status, 'error');
  assert.equal(h.state.mcp.message, 'settings.notConnected');
  assert.deepEqual(h.calls, []);
});

test('扩展页并发：先发后至的旧响应不得覆盖最后一次结果', async () => {
  let resolveFirstMcp;
  let resolveSecondMcp;
  let round = 0;
  const h = makeHarness({
    call: (method) => {
      if (method === 'mcp.servers.status') {
        round += 1;
        return new Promise((resolve) => {
          if (round === 1) resolveFirstMcp = resolve;
          else resolveSecondMcp = resolve;
        });
      }
      if (method === 'skills.manage') return { skills: {} };
      return {};
    },
  });

  const first = h.controller.loadExtensions();
  const second = h.controller.loadExtensions();
  resolveSecondMcp({ servers: [{ name: 'newer', connected: true }] });
  await second;
  resolveFirstMcp({ servers: [{ name: 'older', connected: true }] });
  await first;

  assert.equal(h.state.mcp.status, 'ready');
  assert.equal(h.state.mcp.data[0].name, 'newer', '旧请求晚返回时必须被令牌丢弃');
});

test('单个数据源失败后，再次进入扩展页必须重试（不能被另一边的 ready 挡住）', async () => {
  let mcpAttempts = 0;
  const h = makeHarness({
    call: (method) => {
      if (method === 'mcp.servers.status') {
        mcpAttempts += 1;
        if (mcpAttempts === 1) throw new Error('mcp down');
        return { servers: [] };
      }
      if (method === 'skills.manage') return { skills: {} };
      return {};
    },
  });

  await h.controller.loadExtensions();
  assert.equal(h.state.mcp.status, 'error');
  h.controller.ensureSection('extensions');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(mcpAttempts, 2, '单边失败后必须允许重试');
});

test('密码继承：留空沿用旧密码，非空覆盖', async () => {
  const { resolveGatewayPassword } = await import('../../dist/renderer/settingsController.mjs');
  assert.equal(resolveGatewayPassword('', 'old-secret'), 'old-secret');
  assert.equal(resolveGatewayPassword('   ', 'old-secret'), 'old-secret');
  assert.equal(resolveGatewayPassword('new-secret', 'old-secret'), 'new-secret');
  assert.equal(resolveGatewayPassword('', ''), '');
});

test('数字员工数组元素畸变：只保留对象元素，不得把 null/数字伪造成员工', async () => {
  const h = makeHarness({
    call: () => ({ profiles: [null, 42, 'text', { name: 'ok', display_name: 'OK' }] }),
  });
  await h.controller.loadProfiles();
  assert.equal(h.state.profiles.status, 'ready');
  assert.equal(h.state.profiles.data.length, 1);
  assert.equal(h.state.profiles.data[0].name, 'ok');
});

test('扩展接口畸形响应：必须显式失败，不得伪装成空列表', async () => {
  const mcpMalformed = makeHarness({
    call: (method) => {
      if (method === 'mcp.servers.status') return { servers: 'nope' };
      if (method === 'skills.manage') return { skills: {} };
      return {};
    },
  });
  await mcpMalformed.controller.loadExtensions();
  assert.equal(mcpMalformed.state.mcp.status, 'error');
  assert.equal(mcpMalformed.state.mcp.message, 'settings.malformedResponse');
  assert.equal(mcpMalformed.state.skills.status, 'ready');

  const skillsMalformed = makeHarness({
    call: (method) => {
      if (method === 'mcp.servers.status') return { servers: [] };
      if (method === 'skills.manage') return { skills: 'nope' };
      return {};
    },
  });
  await skillsMalformed.controller.loadExtensions();
  assert.equal(skillsMalformed.state.skills.status, 'error');
  assert.equal(skillsMalformed.state.skills.message, 'settings.malformedResponse');
  assert.equal(skillsMalformed.state.mcp.status, 'ready');
});
