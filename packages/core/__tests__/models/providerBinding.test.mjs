/**
 * 绑定关系判定的穷举测试（勾选 / 取消 / 删除可行性）。
 *
 * 【为什么要单独一份】这四个状态 × 两个方向是界面上唯一会写配置的入口，
 *   错了就是"看着删掉了其实还在""把正在用的模型删了"。纯函数必须穷举。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planBindingToggle,
  planProviderRemoval,
  resolveBindingDefaultModel,
} from '../../dist/models/providerViews.js';

function view(overrides = {}) {
  return {
    key: overrides.key ?? 'custom:fn',
    kind: overrides.kind ?? 'custom',
    id: overrides.id ?? 'fn',
    name: overrides.name ?? 'fn',
    models: overrides.models ?? ['m1', 'm2'],
    detail: overrides.detail ?? 'http://gw/v1',
    availability: overrides.availability ?? 'ready',
    agents: overrides.agents ?? [
      { profile: 'default', displayName: 'default', state: 'ready' },
      { profile: 'aura', displayName: 'aura', state: 'absent' },
    ],
  };
}

test('勾选一个未配置的自定义端点且缺意图时：先要求二次确认，不猜默认意图', () => {
  assert.deepEqual(planBindingToggle(view(), 'aura', true), {
    kind: 'confirm-attach',
    profile: 'aura',
    requiresApiKey: true,
  });
});

test('勾选一个未配置的自定义端点并明确仅启用：写定义但不改默认模型', () => {
  assert.deepEqual(planBindingToggle(view(), 'aura', true, 'enable-only'), {
    kind: 'attach',
    profile: 'aura',
    requiresApiKey: true,
    makeDefault: false,
    intent: 'enable-only',
  });
});

test('勾选一个未配置的自定义端点并明确启用并设为默认：写定义且切换默认模型', () => {
  assert.deepEqual(planBindingToggle(view(), 'aura', true, 'enable-and-default'), {
    kind: 'attach',
    profile: 'aura',
    requiresApiKey: true,
    makeDefault: true,
    intent: 'enable-and-default',
  });
});

test('勾选时落哪个模型：声明值还在运行时目录就保留，否则退到目录首项', () => {
  assert.equal(resolveBindingDefaultModel('m2', ['m1', 'm2']), 'm2', '声明模型可用时必须尊重它');
  assert.equal(
    resolveBindingDefaultModel('deepseek-v4.1-flash', ['cpa/gemini-3.8-flash']),
    'cpa/gemini-3.8-flash',
    '声明模型已不在运行时目录时必须换到真实可选的模型',
  );
  assert.equal(resolveBindingDefaultModel('', ['m1']), 'm1', '声明为空时取目录首项');
  assert.equal(resolveBindingDefaultModel('m9', []), 'm9', '目录为空时保留声明值，由网关给出拒绝原因');
  assert.equal(resolveBindingDefaultModel('  ', []), '', '空声明不得被拼成空白 id');
});

test('勾选一个未配置的订阅：客户端无法复制登录态，只能引导去该 Agent 登录（即使传了意图）', () => {
  const sub = view({ kind: 'subscription', key: 'subscription:xai-oauth', id: 'xai-oauth' });
  assert.deepEqual(planBindingToggle(sub, 'aura', true), {
    kind: 'login-required',
    profile: 'aura',
  });
  assert.deepEqual(planBindingToggle(sub, 'aura', true, 'enable-only'), {
    kind: 'login-required',
    profile: 'aura',
  });
  assert.deepEqual(planBindingToggle(sub, 'aura', true, 'enable-and-default'), {
    kind: 'login-required',
    profile: 'aura',
  });
});

test('取消勾选一个已配置但非当前的 Agent：只移除这一条', () => {
  assert.deepEqual(planBindingToggle(view(), 'default', false), {
    kind: 'detach',
    profile: 'default',
  });
});

test('取消勾选已登录的订阅：走断开登录，绝不能去删端点（订阅不在端点清单里，必 404）', () => {
  const sub = view({ kind: 'subscription', key: 'subscription:xai-oauth', id: 'xai-oauth' });
  assert.deepEqual(planBindingToggle(sub, 'default', false), {
    kind: 'logout-subscription',
    profile: 'default',
  });
});

test('取消勾选正在用的 Agent：阻断，绝不把主模型指向不存在的 provider', () => {
  const active = view({
    agents: [
      { profile: 'default', displayName: 'default', state: 'active', detail: 'm1' },
      { profile: 'aura', displayName: 'aura', state: 'absent' },
    ],
  });
  assert.deepEqual(planBindingToggle(active, 'default', false), {
    kind: 'blocked-active',
    profile: 'default',
  });
});

test('对已经处于目标状态的勾选发 noop，不发无意义请求', () => {
  const active = view({
    agents: [
      { profile: 'default', displayName: 'default', state: 'active', detail: 'm1' },
      { profile: 'aura', displayName: 'aura', state: 'ready' },
    ],
  });
  assert.equal(planBindingToggle(active, 'default', true).kind, 'noop');
  assert.equal(planBindingToggle(active, 'aura', true).kind, 'noop');
  assert.equal(planBindingToggle(view(), 'aura', false).kind, 'noop');
});

test('取消勾选方向不受意图影响：带意图仍然只能是 detach', () => {
  assert.deepEqual(planBindingToggle(view(), 'default', false, 'enable-only'), {
    kind: 'detach',
    profile: 'default',
  });
  assert.deepEqual(planBindingToggle(view(), 'default', false, 'enable-and-default'), {
    kind: 'detach',
    profile: 'default',
  });
  const active = view({
    agents: [
      { profile: 'default', displayName: 'default', state: 'active', detail: 'm1' },
      { profile: 'aura', displayName: 'aura', state: 'absent' },
    ],
  });
  assert.equal(planBindingToggle(active, 'default', false, 'enable-only').kind, 'blocked-active');
});

test('读取失败的 Agent 两个方向都阻断，并把原始原因带出来', () => {
  const broken = view({
    agents: [
      { profile: 'default', displayName: 'default', state: 'error', detail: 'HTTP 500: boom' },
      { profile: 'aura', displayName: 'aura', state: 'absent' },
    ],
  });
  assert.deepEqual(planBindingToggle(broken, 'default', true), {
    kind: 'blocked-error',
    profile: 'default',
    message: 'HTTP 500: boom',
  });
  assert.deepEqual(planBindingToggle(broken, 'default', false), {
    kind: 'blocked-error',
    profile: 'default',
    message: 'HTTP 500: boom',
  });
});

test('不在花名册里的 profile：报 unknown-profile，由界面提示重读', () => {
  assert.deepEqual(planBindingToggle(view(), 'ghost', true), {
    kind: 'unknown-profile',
    profile: 'ghost',
  });
});

test('删除：有 Agent 正在用时阻断，并给出名单与当前模型', () => {
  const active = view({
    agents: [
      { profile: 'default', displayName: 'default', state: 'active', detail: 'gpt-5.4' },
      { profile: 'aura', displayName: 'aura', state: 'ready' },
    ],
  });
  assert.deepEqual(planProviderRemoval(active, ['default', 'aura']), {
    kind: 'blocked-in-use',
    agents: [{ profile: 'default', displayName: 'default', model: 'gpt-5.4' }],
  });
});

test('删除：无人正在用则按配置集合逐个移除，去空去重且保序', () => {
  const idle = view({
    agents: [
      { profile: 'default', displayName: 'default', state: 'ready' },
      { profile: 'aura', displayName: 'aura', state: 'ready' },
    ],
  });
  assert.deepEqual(planProviderRemoval(idle, ['aura', ' default ', 'aura', '', 'codeboy']), {
    kind: 'ready',
    profiles: ['aura', 'default', 'codeboy'],
  });
});

test('删除：配置集合为空且无人使用，返回 empty 而不是伪装成"没有 Agent 在用"', () => {
  const idle = view({
    agents: [
      { profile: 'default', displayName: 'default', state: 'absent' },
      { profile: 'aura', displayName: 'aura', state: 'absent' },
    ],
  });
  assert.deepEqual(planProviderRemoval(idle, []), { kind: 'empty' });
});

test('删除：读取不一致（在用但配置集合为空）时优先报"在用"，不放行部分删除', () => {
  const active = view({
    agents: [
      { profile: 'default', displayName: 'default', state: 'active', detail: 'm1' },
      { profile: 'aura', displayName: 'aura', state: 'absent' },
    ],
  });
  const plan = planProviderRemoval(active, []);
  assert.equal(plan.kind, 'blocked-in-use', '宁可按在用处理，也不能静默只删一部分');
});
