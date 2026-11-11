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









test('ensureSection：提供商域不再由控制器自拉，避免与统一装载重复打网关', async () => {
  const h = makeHarness();
  h.controller.ensureSection('providers');
  h.controller.ensureSection('providers', true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(
    h.calls.filter((call) => call.method === 'model.options').length,
    0,
    '每个 Agent 的 model.options 由 renderer 的统一装载并发拉取，控制器再拉一次就是重复请求',
  );

  h.controller.ensureSection('appearance');
  assert.equal(h.calls.length, 0, '外观域是本地偏好，不得打网关');

  h.controller.ensureSection('agents');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(h.calls.filter((call) => call.method === 'profiles.list').length, 1, '数字员工域仍按 idle 才加载');
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


test('数字员工加载：display_name 缺省时回落到 name，并保留 isDefault', async () => {
  const h = makeHarness();
  await h.controller.loadProfiles();
  assert.equal(h.state.profiles.status, 'ready');
  assert.equal(h.state.profiles.data[0].displayName, 'Hermes');
  assert.equal(h.state.profiles.data[0].isDefault, true);
});



test('数字员工加载失败：落 error 并保留网关原因', async () => {
  const h = makeHarness({ call: () => { throw new Error('profiles down'); } });
  await h.controller.loadProfiles();
  assert.equal(h.state.profiles.status, 'error');
  assert.equal(h.state.profiles.message, 'profiles down');
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
