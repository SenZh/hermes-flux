import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProviderDirectory,
  buildMcpServerRows,
  buildSkillRows,
} from '../../dist/models/providerDirectory.js';

test('buildProviderDirectory：未配置的提供商必须保留（设置页是唯一填密钥入口）', () => {
  const rows = buildProviderDirectory({
    providers: [
      { slug: 'anthropic', name: 'Anthropic', models: ['claude-1', 'claude-2'], authenticated: true },
      { slug: 'deepseek', name: 'DeepSeek', models: ['ds-1'], authenticated: false, key_env: 'DEEPSEEK_API_KEY' },
    ],
  });
  assert.equal(rows.length, 2, '未认证的 provider 不得被丢弃，否则用户无法在设置里配置它');
  const deepseek = rows.find((row) => row.slug === 'deepseek');
  assert.equal(deepseek.authenticated, false);
  assert.equal(deepseek.keyEnv, 'DEEPSEEK_API_KEY');
  assert.equal(deepseek.availableModelCount, 1);
});

test('buildProviderDirectory：非法输入返回空数组，绝不编造提供商', () => {
  assert.deepEqual(buildProviderDirectory(null), []);
  assert.deepEqual(buildProviderDirectory({}), []);
  assert.deepEqual(buildProviderDirectory({ providers: 'nope' }), []);
  assert.deepEqual(buildProviderDirectory({ providers: [{ name: 'no slug' }] }), []);
});

test('buildProviderDirectory：可选项计数剔除明确不可用模型，但 entitlement 待定时不得扣减', () => {
  const settled = buildProviderDirectory({
    providers: [
      { slug: 'nous', models: ['a', 'b', 'c'], authenticated: true, unavailable_models: ['b', 'c'] },
    ],
  });
  assert.equal(settled[0].availableModelCount, 1, '明确拒绝的模型必须从计数中剔除');

  const pending = buildProviderDirectory({
    providers: [
      { slug: 'nous', models: ['a', 'b', 'c'], authenticated: true, unavailable_models: ['a', 'b', 'c'], free_tier_pending: true },
    ],
  });
  assert.equal(pending[0].availableModelCount, 3, 'fail-closed 占位名单是未知态，不得据此扣减');
});

test('buildProviderDirectory：slug 去重、当前 provider 置顶且大小写不敏感', () => {
  const rows = buildProviderDirectory(
    {
      providers: [
        { slug: 'alpha', name: 'Alpha', models: ['a'] },
        { slug: 'Beta', name: 'Beta', models: ['b'] },
        { slug: 'ALPHA', name: 'Alpha duplicate', models: ['a'] },
      ],
    },
    'beta',
  );
  assert.deepEqual(rows.map((row) => row.slug), ['Beta', 'alpha']);
  assert.equal(rows[0].isCurrent, true);
  assert.equal(rows[1].isCurrent, false);
});

test('buildProviderDirectory：账号池与限流重置时间原样透出，未知 state 收敛为 unknown', () => {
  const rows = buildProviderDirectory({
    providers: [
      {
        slug: 'pool',
        models: [],
        usage: { accounts: [{ id: 'k1', state: 'ready' }, { id: 'k2', state: 'weird' }, { label: 'k3', state: 'limited', resets_at: '2026-01-01T00:00:00Z' }] },
        limit: { scope: 'account', resets_at: '2026-02-02T00:00:00Z' },
      },
    ],
  });
  assert.equal(rows[0].accounts.length, 3);
  assert.deepEqual(rows[0].accounts.map((account) => account.state), ['ready', 'unknown', 'limited']);
  assert.equal(rows[0].accounts[2].resetsAt, '2026-01-01T00:00:00Z');
  assert.equal(rows[0].limitResetsAt, '2026-02-02T00:00:00Z');
});

test('buildMcpServerRows：只投影运行态字段，缺名行丢弃', () => {
  const rows = buildMcpServerRows({
    servers: [
      { name: 'github', transport: 'stdio', tools: 12, connected: true, disabled: false, status: 'connected' },
      { transport: 'sse' },
      { name: 'slack', connected: false, disabled: true },
    ],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { name: 'github', transport: 'stdio', toolCount: 12, connected: true, disabled: false, status: 'connected' });
  assert.equal(rows[1].transport, 'stdio', '缺失 transport 时给出确定默认值而不是 undefined');
  assert.equal(rows[1].status, 'configured');
});

test('buildSkillRows：兼容分类映射与 items 两种形状并去重', () => {
  const fromMap = buildSkillRows({ skills: { builtin: ['review', 'diagnose'], global: ['review'] } });
  assert.deepEqual(fromMap, [
    { name: 'review', category: 'builtin' },
    { name: 'diagnose', category: 'builtin' },
    { name: 'review', category: 'global' },
  ]);

  const fromItems = buildSkillRows({ items: [{ name: 'tdd', source: 'hub' }, { name: 'tdd', source: 'hub' }, {}] });
  assert.deepEqual(fromItems, [{ name: 'tdd', category: 'hub' }]);

  assert.deepEqual(buildSkillRows(null), []);
  assert.deepEqual(buildSkillRows({ skills: null, items: null }), []);
});

test('provider 行字段缺省与透传：name 回落 slug、authenticated 缺省视为可用、告警原样保留', () => {
  const rows = buildProviderDirectory({
    providers: [
      { slug: 'bare' },
      {
        slug: 'noisy',
        name: 'Noisy',
        models: ['m1'],
        warning: 'quota exhausted',
        api_url: 'https://api.example.com',
        source: 'user',
        free_tier: true,
      },
    ],
  });
  assert.equal(rows[0].name, 'bare', 'name 缺省必须回落 slug');
  assert.equal(rows[0].authenticated, true, 'authenticated 缺省是未知，不得当成未认证');
  assert.equal(rows[1].warning, 'quota exhausted');
  assert.equal(rows[1].apiUrl, 'https://api.example.com');
  assert.equal(rows[1].source, 'user');
  assert.equal(rows[1].freeTier, true);
});

test('MCP 行：空输入与非法 tools 收敛为确定值', () => {
  assert.deepEqual(buildMcpServerRows(null), []);
  const rows = buildMcpServerRows({ servers: [{ name: 'x', tools: 'many' }] });
  assert.equal(rows[0].toolCount, 0, 'tools 非数字必须收敛为 0，不能渲染 NaN');
  assert.equal(rows[0].connected, false);
  assert.equal(rows[0].disabled, false);
});

test('技能行：网关 <more:N> 占位必须剔除，不得当成技能名渲染', () => {
  const rows = buildSkillRows({ skills: { creative: ['ascii-video', '<more:7>'] } });
  assert.deepEqual(rows, [{ name: 'ascii-video', category: 'creative' }]);
});
