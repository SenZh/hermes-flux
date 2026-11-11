import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveEndpointId,
  diffEndpointAcrossProfiles,
  draftFromEndpoint,
  isValidBaseUrl,
  normalizeBaseUrl,
  normalizeCustomEndpoints,
  normalizeEndpointId,
  normalizeOauthProviders,
  normalizeProbe,
  toEndpointPayload,
  truncateProfileLabel,
  validateDraft,
} from '../../dist/models/providerAdmin.js';

test('normalizeCustomEndpoints：畸形响应一律丢弃，不编造端点', () => {
  assert.deepEqual(normalizeCustomEndpoints(null), []);
  assert.deepEqual(normalizeCustomEndpoints({}), []);
  assert.deepEqual(normalizeCustomEndpoints({ endpoints: 'nope' }), []);
  assert.deepEqual(
    normalizeCustomEndpoints({ endpoints: [{ name: '没有 id' }, { id: 'no-url', name: 'x' }] }),
    [],
    '缺 id 或缺 base_url 的行不是可管理端点',
  );
});

test('normalizeCustomEndpoints：非法 api_mode 收敛为空串（自动检测），discover_models 缺省为 true', () => {
  const [row] = normalizeCustomEndpoints({
    endpoints: [{ id: 'gw', name: '内部网关', base_url: 'https://llm.internal/v1', model: 'm1', api_mode: 'grpc' }],
  });
  assert.equal(row.apiMode, '', 'unknown mode 不得透传，运行时按 URL 自动检测');
  assert.equal(row.discoverModels, true, '缺省即自动获取模型');
  assert.equal(row.hasApiKey, false);
  assert.equal(row.isCurrent, false);
});

test('normalizeCustomEndpoints：has_api_key 只认严格 true，普通字符串不得冒充', () => {
  const rows = normalizeCustomEndpoints({
    endpoints: [
      { id: 'a', base_url: 'https://a/v1', has_api_key: 'yes' },
      { id: 'b', base_url: 'https://b/v1', has_api_key: true, api_key_preview: '${B_KEY}' },
    ],
  });
  assert.equal(rows[0].hasApiKey, false);
  assert.equal(rows[1].hasApiKey, true);
  assert.equal(rows[1].apiKeyPreview, '${B_KEY}');
});

test('normalizeEndpointId：custom: 前缀与裸 id 指同一个端点', () => {
  assert.equal(normalizeEndpointId('custom:fn'), 'fn');
  assert.equal(normalizeEndpointId('fn'), 'fn');
  assert.equal(normalizeEndpointId('  Custom:fn  '), 'fn');
  assert.equal(normalizeEndpointId('my-gw'), 'my-gw', '不得擅自改写用户写的 id');
});

test('deriveEndpointId：从显示名派生合法 id，纯中文派生为空', () => {
  assert.equal(deriveEndpointId('Internal Gateway'), 'internal-gateway');
  assert.equal(deriveEndpointId('内部网关'), '');
  assert.equal(deriveEndpointId('  a__b  '), 'a-b');
  assert.equal(deriveEndpointId('GW-1'), 'gw-1');
});

test('isValidBaseUrl：只接受带 scheme 与 host 的 http(s) 地址', () => {
  assert.equal(isValidBaseUrl('https://llm.internal/v1'), true);
  assert.equal(isValidBaseUrl('http://172.23.0.1:3425/v1'), true);
  assert.equal(isValidBaseUrl('llm.internal/v1'), false, '缺 scheme 必须拦截');
  assert.equal(isValidBaseUrl('ftp://x/y'), false);
  assert.equal(isValidBaseUrl(''), false);
  assert.equal(normalizeBaseUrl(' https://x/v1/// '), 'https://x/v1');
});

test('toEndpointPayload：三种密钥意图互不覆盖', () => {
  const base = {
    id: 'gw',
    name: '内部网关',
    baseUrl: 'https://llm.internal/v1/',
    model: 'm1',
    apiKey: { kind: 'keep' },
  };
  const kept = toEndpointPayload(base, { id: 'gw', makeDefault: false });
  assert.equal('api_key' in kept, false, 'keep 必须不写字段，网关才会保留原密钥');

  const cleared = toEndpointPayload({ ...base, apiKey: { kind: 'clear' } }, { id: 'gw', makeDefault: false });
  assert.equal(cleared.api_key, '', 'clear 必须显式写空串');

  const set = toEndpointPayload({ ...base, apiKey: { kind: 'set', value: '  sk-1  ' } }, { id: 'gw', makeDefault: false });
  assert.equal(set.api_key, 'sk-1');
});

test('toEndpointPayload：协议恒为自动检测，自动获取模型恒开，扇出不得改主模型', () => {
  const payload = toEndpointPayload(
    { id: '', name: 'n', baseUrl: 'https://x/v1', model: 'm', apiKey: { kind: 'keep' }, models: ['m', 'm2'] },
    { id: 'x', makeDefault: false },
  );
  assert.equal(payload.api_mode, '');
  assert.equal(payload.discover_models, true);
  assert.equal(payload.make_default, false, '跨 Bot 分发必须保持 false');
  assert.deepEqual(payload.models, ['m', 'm2']);
  assert.equal(payload.base_url, 'https://x/v1');
});

test('normalizeProbe：不可达、可警告、成功三态严格区分', () => {
  assert.deepEqual(
    normalizeProbe({ ok: false, reachable: false, message: 'Could not reach https://x/models.' }),
    { kind: 'unreachable', message: 'Could not reach https://x/models.' },
  );
  assert.deepEqual(
    normalizeProbe({ ok: false, reachable: true, message: 'The endpoint rejected the API key.' }),
    { kind: 'warning', message: 'The endpoint rejected the API key.' },
  );
  const ok = normalizeProbe({
    ok: true,
    reachable: true,
    message: '',
    models: ['a', 'b'],
    model_details: [{ id: 'a' }],
    resolved_base_url: 'https://x/v1',
    transport_checked: 'chat_completions',
  });
  assert.equal(ok.kind, 'ok');
  assert.equal(ok.modelCount, 2);
  assert.equal(ok.resolvedBaseUrl, 'https://x/v1');
  assert.equal(ok.transport, 'chat_completions');
});

test('normalizeProbe：ok=true 但附带传输告警时必须降级为 warning', () => {
  const probe = normalizeProbe({ ok: true, reachable: true, message: '/chat/completions returned 404', models: ['a'] });
  assert.equal(probe.kind, 'warning');
});

test('diffEndpointAcrossProfiles：一致、漂移、缺失三种状态按端点地址与模型判定', () => {
  const baseline = {
    id: 'fn',
    name: 'fn',
    baseUrl: 'http://172.23.0.1:3425/v1',
    model: 'group/deepseek-v4.1-flash',
    models: [],
    apiMode: '',
    discoverModels: true,
    hasApiKey: true,
    isCurrent: true,
    source: 'providers',
  };
  const cells = diffEndpointAcrossProfiles(baseline, {
    ok: [
      { profile: 'default', displayName: 'default', endpoints: [baseline] },
      { profile: 'aura', displayName: 'aura', endpoints: [{ ...baseline, baseUrl: 'https://other/v1' }] },
      { profile: 'codeboy', displayName: 'codeboy', endpoints: [{ ...baseline, model: 'other-model' }] },
      { profile: 'empty', displayName: 'empty', endpoints: [] },
    ],
    failed: [],
  });
  assert.deepEqual(
    cells.map((cell) => [cell.profile, cell.state, cell.detail]),
    [
      ['default', 'same', undefined],
      ['aura', 'drift', 'baseUrl'],
      ['codeboy', 'drift', 'model'],
      ['empty', 'missing', undefined],
    ],
  );
});

test('diffEndpointAcrossProfiles：自定义端点的两套拼写必须匹配同一个', () => {
  const baseline = {
    id: 'custom:fn',
    name: 'fn',
    baseUrl: 'https://x/v1',
    model: 'm',
    models: [],
    apiMode: '',
    discoverModels: true,
    hasApiKey: true,
    isCurrent: true,
    source: 'providers',
  };
  const [cell] = diffEndpointAcrossProfiles(baseline, {
    ok: [{ profile: 'aura', displayName: 'aura', endpoints: [{ ...baseline, id: 'fn' }] }],
    failed: [],
  });
  assert.equal(cell.state, 'same');
});

test('truncateProfileLabel：10 单位内完整显示，超出为省略号预留 1 单位', () => {
  assert.equal(truncateProfileLabel('运维'), '运维');
  assert.equal(truncateProfileLabel('运维机器'), '运维机器', '8 单位（4 汉字）不得截断');
  assert.equal(truncateProfileLabel('运维机器人'), '运维机器人', '10 单位（5 汉字）是完整显示上限');
  assert.equal(truncateProfileLabel('运维机器人一'), '运维机器…', '6 汉字刚超上限，截断为 4 汉字 + 省略号');
  assert.equal(truncateProfileLabel('运维机器人一号'), '运维机器…', '更长的名字仍保持 4 汉字 + 省略号');
  assert.equal(truncateProfileLabel('abcdefghi'), 'abcdefghi');
  assert.equal(truncateProfileLabel('abcdefghij'), 'abcdefghij', '10 个半角是完整显示上限');
  assert.equal(truncateProfileLabel('abcdefghijk'), 'abcdefghi…', '截断态为 9 单位内容 + 省略号');
  assert.equal(truncateProfileLabel('abcdefghij', 8), 'abcdefg…', '更窄槽位可显式传更小预算');
  assert.equal(truncateProfileLabel('abc', 0), '', '预算放不下省略号时返回空串，不得超预算');
  assert.equal(truncateProfileLabel('abc', 1), '…', '预算刚好容纳省略号时只返回省略号');
  assert.equal(truncateProfileLabel('   '), '');
});

test('validateDraft：名称、端点地址、模型缺一不可，留空密钥不算错', () => {
  const base = { id: '', name: 'n', baseUrl: 'https://x/v1', model: 'm', apiKey: { kind: 'keep' } };
  assert.deepEqual(validateDraft(base), []);
  assert.deepEqual(validateDraft({ ...base, name: '  ' }), ['name']);
  assert.deepEqual(validateDraft({ ...base, baseUrl: 'x' }), ['baseUrl']);
  assert.deepEqual(validateDraft({ ...base, model: '' }), ['model']);
  assert.deepEqual(validateDraft({ ...base, apiKey: { kind: 'set', value: '   ' } }), ['apiKey']);
});

test('normalizeOauthProviders：logged_in 只认严格 true，status 缺失不崩', () => {
  const rows = normalizeOauthProviders({
    providers: [
      { id: 'nous', name: 'Nous Portal', flow: 'device_code', status: { logged_in: true, account_tier: 'pro', source_label: 'Nous Portal' } },
      { id: 'qwen-oauth', name: 'Qwen', flow: 'external', status: { logged_in: 'yes' } },
      { id: 'bare', name: 'Bare' },
      { name: 'no id' },
    ],
  });
  assert.equal(rows.length, 3, '缺 id 的条目必须丢弃');
  assert.equal(rows[0].loggedIn, true);
  assert.equal(rows[0].accountTier, 'pro');
  assert.equal(rows[0].sourceLabel, 'Nous Portal');
  assert.equal(rows[0].flow, 'device_code');
  assert.equal(rows[1].loggedIn, false, "'yes' 不是 true，不得当成已登录（否则会隐藏登录入口）");
  assert.equal(rows[2].flow, 'unknown', '未知 flow 收敛为 unknown，不猜测');
  assert.equal(rows[2].loggedIn, false);
  assert.equal(rows[2].error, undefined);
});

test('normalizeOauthProviders：未知 flow 收敛为 unknown，free_tier 与 cli_command 正确映射', () => {
  const [row] = normalizeOauthProviders({
    providers: [
      { id: 'x', name: 'X', flow: 'carrier_pigeon', cli_command: 'hermes auth add x', docs_url: 'https://x', status: { free_tier: true, error: 'token expired' } },
    ],
  });
  assert.equal(row.flow, 'unknown');
  assert.equal(row.freeTier, true);
  assert.equal(row.error, 'token expired');
  assert.equal(row.cliCommand, 'hermes auth add x');
  assert.equal(row.docsUrl, 'https://x');
});

test('normalizeOauthProviders：畸形输入返回空数组，不编造账号', () => {
  assert.deepEqual(normalizeOauthProviders(null), []);
  assert.deepEqual(normalizeOauthProviders({}), []);
  assert.deepEqual(normalizeOauthProviders({ providers: 'nope' }), []);
});

test('normalizeCustomEndpoints：context_length 非正数或非数字一律丢弃', () => {
  const rows = normalizeCustomEndpoints({
    endpoints: [
      { id: 'a', base_url: 'https://a/v1', context_length: 0 },
      { id: 'b', base_url: 'https://b/v1', context_length: -5 },
      { id: 'c', base_url: 'https://c/v1', context_length: 'abc' },
      { id: 'd', base_url: 'https://d/v1', context_length: 128000 },
    ],
  });
  assert.deepEqual(rows.map((row) => row.contextLength), [undefined, undefined, undefined, 128000]);
});

test('normalizeProbe：根不是对象时按不可达处理，不抛错', () => {
  assert.deepEqual(normalizeProbe(null), { kind: 'unreachable', message: '' });
  assert.deepEqual(normalizeProbe('nope'), { kind: 'unreachable', message: '' });
});

test('diffEndpointAcrossProfiles：读取失败的 Bot 必须标 error，不能落进 missing', () => {
  const baseline = {
    id: 'fn',
    name: 'fn',
    baseUrl: 'https://x/v1',
    model: 'm',
    models: [],
    apiMode: '',
    discoverModels: true,
    hasApiKey: true,
    isCurrent: true,
    source: 'providers',
  };
  const cells = diffEndpointAcrossProfiles(baseline, {
    ok: [{ profile: 'default', displayName: 'default', endpoints: [baseline] }],
    failed: [{ profile: 'aura', displayName: 'aura', message: 'HTTP 500: boom' }],
  });
  assert.deepEqual(
    cells.map((cell) => [cell.profile, cell.state, cell.detail]),
    [
      ['default', 'same', undefined],
      ['aura', 'error', 'HTTP 500: boom'],
    ],
    '网络失败被渲染成"未配置"会诱导用户重复配置',
  );
});

test('toEndpointPayload：model_details 映射为 snake_case，不泄漏 camelCase', () => {
  const built = toEndpointPayload(
    {
      id: 'gw',
      name: 'n',
      baseUrl: 'https://x/v1',
      model: 'm',
      apiKey: { kind: 'keep' },
      modelDetails: [{ id: 'm-high', canonicalModel: 'm', reasoningEffort: 'high' }],
    },
    { id: 'gw', makeDefault: false },
  );
  assert.deepEqual(built.model_details, [{ id: 'm-high', canonical_model: 'm', reasoning_effort: 'high' }]);
});

test('draftFromEndpoint：GET 不回明文，草稿密钥必须是 keep', () => {
  const [row] = normalizeCustomEndpoints({
    endpoints: [{ id: 'gw', base_url: 'https://x/v1', model: 'm', has_api_key: true, api_key_preview: '${GW_KEY}' }],
  });
  const draft = draftFromEndpoint(row);
  assert.deepEqual(draft.apiKey, { kind: 'keep' });
  assert.equal(draft.id, 'gw');
});
