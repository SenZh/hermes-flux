import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeScope,
  mergeProviderViews,
  profilesWithProvider,
  summarizeCoverage,
  summarizeModelOptions,
} from '../../dist/models/providerViews.js';

const roster = [
  { profile: 'default', displayName: 'default' },
  { profile: 'aura', displayName: 'aura' },
  { profile: 'codeboy', displayName: 'codeboy' },
];

function options(profile, rows, error) {
  return { profile, displayName: profile, rows, error };
}

/** options 行构造器：`models` 是切主模型时要点名的候选。 */
function row(slug, models, isCurrent, userDefined = true) {
  return {
    slug,
    models,
    modelCount: models.length,
    isCurrent,
    userDefined,
  };
}

const endpoints = [
  { id: 'fn', name: 'fn', baseUrl: 'http://gw/v1', models: ['m1', 'm2'], hasApiKey: true },
  { id: 'cpa', name: 'cpa', baseUrl: 'https://cpa/v1', models: ['m3'], hasApiKey: true },
];

const subscriptions = [
  { id: 'xai-oauth', name: 'xAI Grok OAuth', flow: 'device_code', loggedIn: true, accountTier: 'SuperGrok' },
  { id: 'nous', name: 'Nous Portal', flow: 'device_code', loggedIn: false },
];

function build(overrides = {}) {
  return mergeProviderViews({
    roster,
    options: overrides.options ?? [
      options('default', [
        row('fn', ['m1', 'm2'], true),
        row('cpa', ['m3'], false),
        row('xai-oauth', ['grok-4', 'grok-4-fast'], false, false),
      ]),
      options('aura', [
        row('fn', ['m1', 'm2'], true),
        row('cpa', ['m3'], false),
        row('xai-oauth', ['grok-4', 'grok-4-fast'], false, false),
      ]),
      options('codeboy', [
        row('fn', ['m1', 'm2'], true),
        row('cpa', ['m3'], false),
        row('xai-oauth', ['grok-4', 'grok-4-fast'], false, false),
      ]),
    ],
    subscriptions: overrides.subscriptions ?? subscriptions,
    endpoints: overrides.endpoints ?? endpoints,
  });
}

test('mergeProviderViews：订阅与自定义混排成一张表，同一个 id 不因来源重复', () => {
  const views = build();
  assert.deepEqual(views.map((view) => view.key), [
    'custom:fn',
    'custom:cpa',
    'subscription:xai-oauth',
  ]);
  assert.equal(views.filter((view) => view.id === 'fn').length, 1);
});

test('mergeProviderViews：未登录订阅不进主列表', () => {
  const views = build();
  assert.equal(
    views.some((view) => view.id === 'nous'),
    false,
    '没登录过的订阅铺进主列表，用户会以为自己订了只是掉线',
  );
  assert.equal(views.some((view) => view.agents.some((agent) => agent.detail === 'loggedOut')), false);
});

test('mergeProviderViews：已登录订阅即使没被任何 Agent 选中也要显示', () => {
  const views = mergeProviderViews({
    roster,
    options: [
      options('default', [row('fn', ['m1'], true)]),
      options('aura', [row('fn', ['m1'], true)]),
      options('codeboy', [row('fn', ['m1'], true)]),
    ],
    subscriptions,
    endpoints: [],
  });
  const xai = views.find((view) => view.id === 'xai-oauth');
  assert.ok(xai, '登录过就是可用的模型来源，不在任何 Agent 的 options 里也要列出来');
  assert.equal(xai.availability, 'not_configured', '没被任何 Agent 选中，就是没在用');
  assert.deepEqual(xai.models, [], '种子缺失时没有模型可选，界面必须禁用"使用"');
});

test('mergeProviderViews：每个 Agent 槽位必须存在，长度恒等于花名册', () => {
  for (const view of build()) {
    assert.equal(view.agents.length, roster.length, `${view.key} 缺 Agent 槽位会被误读成未配置`);
    assert.deepEqual(view.agents.map((agent) => agent.profile), ['default', 'aura', 'codeboy']);
  }
});

test('mergeProviderViews：主模型指向即 active，配了但没选是 ready', () => {
  const fn = build().find((view) => view.id === 'fn');
  assert.deepEqual(fn.agents.map((agent) => agent.state), ['active', 'active', 'active']);
  assert.equal(fn.availability, 'active');

  const cpa = build().find((view) => view.id === 'cpa');
  assert.deepEqual(cpa.agents.map((agent) => agent.state), ['ready', 'ready', 'ready']);
  assert.equal(cpa.availability, 'ready');
});

test('mergeProviderViews：只有某个 profile 配过的端点，其余必须显式 absent', () => {
  const views = build({
    endpoints: [...endpoints, { id: 'gitee-ai', name: 'gitee-ai', baseUrl: 'https://gitee/v1', models: ['x'], hasApiKey: true }],
    options: [
      options('default', [row('fn', ['m1'], true)]),
      options('aura', [row('fn', ['m1'], true)]),
      options('codeboy', [row('fn', ['m1'], true)]),
    ],
  });
  const gitee = views.find((view) => view.id === 'gitee-ai');
  assert.deepEqual(gitee.agents.map((agent) => agent.state), ['absent', 'absent', 'absent']);
  assert.equal(gitee.availability, 'not_configured');
  assert.deepEqual(summarizeCoverage(gitee), { configured: 0, total: 3, failed: 0 });
  assert.deepEqual(profilesWithProvider(gitee), [], '没有任何 Agent 配它时，删除没有目标');
});

test('mergeProviderViews：读取失败的 profile 必须标 error，不能落进 absent', () => {
  const views = build({
    options: [
      options('default', [row('fn', ['m1'], true)]),
      options('aura', [], 'HTTP 500: boom'),
      options('codeboy', [row('fn', ['m1'], true)]),
    ],
  });
  const fn = views.find((view) => view.id === 'fn');
  assert.deepEqual(fn.agents.map((agent) => agent.state), ['active', 'error', 'active']);
  assert.equal(fn.availability, 'error', '有 Agent 读取失败时整体不能报"可用"，否则用户以为全配好了');
  assert.deepEqual(summarizeCoverage(fn), { configured: 2, total: 3, failed: 1 });
  assert.deepEqual(
    profilesWithProvider(fn),
    ['default', 'codeboy'],
    '读取失败的 Agent 不在删除范围里：读不到就不能猜着删',
  );
});

test('describeScope：所有 Agent / 两个 / 多个 / 没有 四种人话', () => {
  const fn = build().find((view) => view.id === 'fn');
  assert.deepEqual(describeScope(fn), { kind: 'all' }, '三个 Agent 全指向时必须说"所有"，不能说 3/3');

  const partial = build({
    options: [
      options('default', [row('fn', ['m1'], true)]),
      options('aura', [row('fn', ['m1'], false)]),
      options('codeboy', [row('fn', ['m1'], false)]),
    ],
  }).find((view) => view.id === 'fn');
  assert.deepEqual(describeScope(partial), { kind: 'named', profiles: ['default'] }, '只有一个 Agent 时直接列名字');

  const two = build({
    options: [
      options('default', [row('fn', ['m1'], true)]),
      options('aura', [row('fn', ['m1'], true)]),
      options('codeboy', [row('fn', ['m1'], false)]),
    ],
  }).find((view) => view.id === 'fn');
  assert.deepEqual(describeScope(two), { kind: 'named', profiles: ['default', 'aura'] });

  const cpa = build().find((view) => view.id === 'cpa');
  assert.deepEqual(describeScope(cpa), { kind: 'none' }, '配了但没人用它，就是未生效');
});

test('describeScope：超过两个 Agent 用数量表达，不再堆名字', () => {
  const wide = mergeProviderViews({
    roster: [
      { profile: 'a', displayName: 'a' },
      { profile: 'b', displayName: 'b' },
      { profile: 'c', displayName: 'c' },
      { profile: 'd', displayName: 'd' },
    ],
    options: ['a', 'b', 'c', 'd'].map((name, index) => options(name, [row('fn', ['m1'], index < 3)])),
    subscriptions: [],
    endpoints: [endpoints[0]],
  });
  const fn = wide.find((view) => view.id === 'fn');
  assert.deepEqual(describeScope(fn), { kind: 'count', count: 3, total: 4 });
});

test('mergeProviderViews：当前使用的排在最前', () => {
  const views = build({
    options: [
      options('default', [row('cpa', ['m3'], true)]),
      options('aura', [row('cpa', ['m3'], true)]),
      options('codeboy', [row('cpa', ['m3'], true)]),
    ],
  });
  assert.equal(views[0].id, 'cpa');
});

test('mergeProviderViews：模型列表取各 profile 里更全的那份', () => {
  const views = build({
    options: [
      options('default', [row('fn', ['m1'], true)]),
      options('aura', [row('fn', ['m1', 'm2', 'm3'], true)]),
      options('codeboy', [row('fn', ['m1', 'm2'], true)]),
    ],
    endpoints: [],
  });
  const fn = views.find((view) => view.id === 'fn');
  assert.deepEqual(fn.models, ['m1', 'm2', 'm3'], '页面若只剩一个模型，"使用"就点不出别的选择');
});

test('mergeProviderViews：空输入返回空数组，不编造提供商', () => {
  assert.deepEqual(
    mergeProviderViews({ roster: [], options: [], subscriptions: [], endpoints: [] }),
    [],
  );
});

test('mergeProviderViews：同一个端点被多个 profile 各返回一次时必须收敛成一行', () => {
  const dup = { id: 'fn', name: 'fn', baseUrl: 'http://gw/v1', models: ['m1'], hasApiKey: false };
  const views = mergeProviderViews({
    roster,
    options: [
      options('default', [row('fn', ['m1', 'm2'], true)]),
      options('aura', [row('fn', ['m1', 'm2'], true)]),
      options('codeboy', [row('fn', ['m1', 'm2'], true)]),
    ],
    subscriptions: [],
    endpoints: [dup, { ...dup, models: ['m1', 'm2'], hasApiKey: true }],
  });
  assert.equal(views.length, 1, '同一个 id 在每个 profile 上各返回一次，合并后必须只有一行');
  assert.deepEqual(views[0].models, ['m1', 'm2'], '模型取更全的那份');
});

test('summarizeModelOptions：缺 providers 数组时返回空行而不是抛错', () => {
  assert.deepEqual(summarizeModelOptions('default', 'default', null).rows, []);
  assert.deepEqual(summarizeModelOptions('default', 'default', { providers: 'nope' }).rows, []);
  const rows = summarizeModelOptions('default', 'default', {
    providers: [
      { slug: 'fn', models: ['a', 'b'], is_current: true, is_user_defined: true, api_url: 'http://gw/v1' },
      { slug: '' },
    ],
  }).rows;
  assert.deepEqual(rows, [
    {
      slug: 'fn',
      models: ['a', 'b'],
      modelCount: 2,
      isCurrent: true,
      userDefined: true,
      apiUrl: 'http://gw/v1',
      currentModel: undefined,
    },
  ]);
});

test('summarizeModelOptions：models 必须是字符串数组，混进对象就整段丢弃', () => {
  const rows = summarizeModelOptions('default', 'default', {
    providers: [{ slug: 'fn', models: ['a', { id: 'b' }, ''], is_current: false }],
  }).rows;
  assert.deepEqual(rows[0].models, ['a'], '不能让对象混进模型 id 列表，界面上会出现 [object Object]');
  assert.equal(rows[0].modelCount, 1);
});
