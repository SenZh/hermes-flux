import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderAdminController, emptyEndpointDraft, planDeleteTarget } from '../../dist/renderer/providerAdminController.mjs';

function makeDeps(overrides = {}) {
  const calls = [];
  const notifications = [];
  const warns = [];
  const state = {
    endpoints: { status: 'idle' },
    oauth: { status: 'idle' },
    busy: false,
    catalogChanges: 0,
    renders: 0,
  };
  const rest = {
    async listEndpoints(profile) {
      calls.push(['listEndpoints', profile]);
      if (overrides.failList?.includes(profile)) throw new Error(`HTTP 500: ${profile} list failed`);
      return overrides.endpoints?.[profile] ?? [];
    },
    async saveEndpoint(profile, payload) {
      calls.push(['saveEndpoint', profile, payload]);
      if (overrides.failOn?.includes(profile)) throw new Error(`HTTP 400: ${profile} failed`);
      return overrides.saveResponse ?? { endpoints: [], id: payload.id };
    },
    async probeEndpoint(payload) {
      calls.push(['probeEndpoint', payload]);
      if (overrides.probeThrows) throw new Error('HTTP 503: probe down');
      return { kind: 'ok', models: ['m1'], modelCount: 1 };
    },
    async activateEndpoint(profile, id) {
      calls.push(['activateEndpoint', profile, id]);
      if (overrides.failActivate) throw new Error('HTTP 404: custom endpoint not found');
      return { provider: id, model: 'm1' };
    },
    async setMainModel(profile, assignment) {
      calls.push(['setMainModel', profile, assignment]);
      if (overrides.failUse) throw new Error('HTTP 400: provider and model required for main');
      if (overrides.confirmRequired) {
        return { provider: assignment.provider, model: assignment.model, confirmRequired: true, confirmMessage: 'priced high' };
      }
      return { provider: assignment.provider, model: assignment.model, confirmRequired: false };
    },
    async deleteEndpoint(profile, id) {
      calls.push(['deleteEndpoint', profile, id]);
      const shouldFail = overrides.failDelete === true
        || (Array.isArray(overrides.failDelete) && overrides.failDelete.includes(profile));
      if (shouldFail) throw new Error('HTTP 500: delete failed');
      return [];
    },
    async revealEnv(profile, key) {
      calls.push(['revealEnv', profile, key]);
      if (overrides.failRevealHard === true) throw new Error('HTTP 500: reveal down');
      if (overrides.failReveal === true || (Array.isArray(overrides.failReveal) && overrides.failReveal.includes(profile))) {
        throw new Error(`HTTP 404: ${key} not found`);
      }
      return overrides.revealed?.[`${profile}:${key}`] ?? '';
    },
    async listOauthProviders(profile) {
      calls.push(['listOauthProviders', profile]);
      if (overrides.failOauth?.includes(profile)) throw new Error(`HTTP 500: ${profile} oauth failed`);
      return overrides.oauth?.[profile] ?? [];
    },
  };
  const controller = createProviderAdminController({
    rest,
    render: () => { state.renders += 1; },
    describeError: (error) => error.message,
    getEndpoints: () => state.endpoints,
    setEndpoints: (value) => { state.endpoints = value; },
    getOauth: () => state.oauth,
    setOauth: (value) => { state.oauth = value; },
    setBusy: (value) => { state.busy = value; },
    notify: (message) => notifications.push(message),
    warn: (message, meta) => warns.push([message, meta]),
    onCatalogChanged: () => { state.catalogChanges += 1; },
  });
  return { controller, calls, state, notifications, warns };
}

const draft = {
  ...emptyEndpointDraft(),
  name: 'Internal Gateway',
  baseUrl: 'https://llm.internal/v1/',
  model: 'm1',
  apiKey: { kind: 'set', value: 'sk-1' },
};

test('save：当前 Bot 的 make_default 跟随用户选择，扇出一律 false', async () => {
  const { controller, calls } = makeDeps();
  const outcome = await controller.save('default', draft, { fanOutTo: ['aura'], makeDefault: true });
  assert.equal(outcome.currentOk, true);
  assert.equal(outcome.overall, 'success');
  const saves = calls.filter((call) => call[0] === 'saveEndpoint');
  assert.deepEqual(saves.map((call) => call[1]), ['default', 'aura']);
  assert.equal(saves[0][2].make_default, true, '当前 Bot 才允许改主模型');
  assert.equal(saves[1][2].make_default, false, '扇出不得改目标 Bot 的主模型');
  assert.equal(saves[1][2].api_key, 'sk-1', '密钥随保存流程一次性带到目标 Bot');
  assert.equal(saves[1][2].discover_models, true);
  assert.equal(saves[1][2].api_mode, '');
  assert.equal(saves[1][2].base_url, 'https://llm.internal/v1');
});

test('save：makeDefault 为 false 时 payload 的 make_default 为 false，且不误刷新主模型目录', async () => {
  const { controller, calls, state } = makeDeps();
  const outcome = await controller.save('aura', draft, { fanOutTo: [], makeDefault: false });
  assert.equal(outcome.currentOk, true);
  assert.equal(outcome.overall, 'success');
  const saves = calls.filter((call) => call[0] === 'saveEndpoint');
  assert.equal(saves.length, 1);
  assert.equal(saves[0][2].make_default, false, '仅启用模式不得发送 make_default: true');
  assert.equal(state.catalogChanges, 0, '仅启用且响应未标记 current 时不应触发目录切主模型刷新');
});

test('save：网关写入成功但没把端点标成 current 时，必须如实报告而不是报成功', async () => {
  const endpointRow = {
    id: 'internal-gateway',
    name: 'Internal Gateway',
    baseUrl: 'https://llm.internal/v1',
    model: 'm1',
    models: ['m1'],
    apiMode: '',
    discoverModels: true,
    hasApiKey: false,
    isCurrent: false,
    source: 'providers',
  };
  const ignored = makeDeps({ saveResponse: { id: 'internal-gateway', endpoints: [endpointRow] } });
  const notDefault = await ignored.controller.save('default', draft, { fanOutTo: [], makeDefault: true });
  assert.equal(notDefault.currentOk, true);
  assert.equal(notDefault.currentIsDefault, false, '网关忽略了 make_default 时必须留下可观测结论');

  const applied = makeDeps({ saveResponse: { id: 'internal-gateway', endpoints: [{ ...endpointRow, isCurrent: true }] } });
  const isDefault = await applied.controller.save('default', draft, { fanOutTo: [], makeDefault: true });
  assert.equal(isDefault.currentIsDefault, true);

  const missing = makeDeps();
  const unknown = await missing.controller.save('default', draft, { fanOutTo: [], makeDefault: true });
  assert.equal(unknown.currentIsDefault, undefined, '响应里没有该端点行时无法判定，不能伪造结论');

  const prefixed = makeDeps({
    saveResponse: { id: 'internal-gateway', endpoints: [{ ...endpointRow, id: 'custom:internal-gateway', isCurrent: false }] },
  });
  const normalized = await prefixed.controller.save('default', draft, { fanOutTo: [], makeDefault: true });
  assert.equal(
    normalized.currentIsDefault,
    false,
    '网关把 id 回成 custom: 前缀时仍必须命中同一端点，否则默认模型校验会静默失效',
  );
});

test('save：当前 Bot 失败时必须停止，不得把草稿扩散到其他 Bot', async () => {
  const { controller, calls } = makeDeps({ failOn: ['default'] });
  const outcome = await controller.save('default', draft, { fanOutTo: ['aura', 'codeboy'], makeDefault: false });
  assert.equal(outcome.currentOk, false);
  assert.equal(outcome.overall, 'failed', '当前 Bot 未写入就是整体失败，不能报 partial');
  assert.equal(outcome.fanOut.length, 0);
  assert.equal(calls.filter((call) => call[0] === 'saveEndpoint').length, 1, '失败后不得继续写其他 Bot');
});

test('save：扇出中途失败要停下、报 partial，并如实报告是哪个 Bot', async () => {
  const { controller, warns } = makeDeps({ failOn: ['codeboy'] });
  const outcome = await controller.save('default', draft, { fanOutTo: ['aura', 'codeboy', 'later'], makeDefault: false });
  assert.equal(outcome.currentOk, true);
  assert.equal(outcome.overall, 'partial', '当前 Bot 成功但扇出失败，语义必须是 partial 而非 success');
  assert.deepEqual(outcome.fanOut.map((item) => [item.profile, item.ok]), [['aura', true], ['codeboy', false]]);
  assert.equal(outcome.fanOut.length, 2, '失败之后不得继续写');
  assert.equal(warns.length, 1, '部分失败必须留下可观测记录');
});

test('save：新建端点必须带明文密钥，keep 不得发出请求', async () => {
  const { controller, calls } = makeDeps();
  const outcome = await controller.save(
    'default',
    { ...draft, apiKey: { kind: 'keep' } },
    { fanOutTo: [], makeDefault: false },
  );
  assert.equal(outcome.currentOk, false);
  assert.equal(outcome.overall, 'failed');
  assert.ok(outcome.current.message.includes('apiKey'), '必须明确指出缺密钥');
  assert.equal(calls.length, 0, '禁止创建一条发不出请求的空密钥端点');
});

test('save：草稿不合法时一个请求都不发', async () => {
  const { controller, calls } = makeDeps();
  const outcome = await controller.save('default', { ...draft, baseUrl: 'llm.internal/v1' }, { fanOutTo: ['aura'], makeDefault: false });
  assert.equal(outcome.currentOk, false);
  assert.equal(outcome.overall, 'failed');
  assert.deepEqual(outcome.current.message, 'baseUrl');
  assert.equal(calls.length, 0, '本地校验不通过时禁止打网关');
});

test('probe：只做探测，不落盘', async () => {
  const { controller, calls } = makeDeps();
  const result = await controller.probe(draft);
  assert.equal(result.kind, 'ok');
  assert.deepEqual(calls.map((call) => call[0]), ['probeEndpoint']);
  assert.equal(calls[0][1].make_default, false, '探测请求不可能改主模型');
});

test('probe：REST 抛错必须收敛成 warning，不能把异常漏给 UI', async () => {
  const { controller } = makeDeps({ probeThrows: true });
  const result = await controller.probe(draft);
  assert.equal(result.kind, 'warning', '异常穿透会让 probePending 永久为 true，按钮从此不可点');
  assert.match(result.message, /probe down/, '状态码由 describeProviderAdminError 剥离，剩下的原因必须透出');
});

test('load：后发先至只写最后一次结果', async () => {
  const { controller, state } = makeDeps({ endpoints: { default: [{ id: 'a' }], aura: [{ id: 'b' }] } });
  await Promise.all([controller.load('default'), controller.load('aura')]);
  assert.equal(state.endpoints.status, 'ready');
  assert.deepEqual(state.endpoints.data.map((row) => row.id), ['b'], '较慢的第一次响应不得覆盖最后一次');
});

test('loadEndpoints：失败必须落 error 态且带原始原因，不得伪装成空列表', async () => {
  const { controller, state } = makeDeps({ failList: ['aura'] });
  await controller.load('aura');
  assert.equal(state.endpoints.status, 'error');
  assert.match(state.endpoints.message, /500/);
  assert.match(state.oauth.status === 'error' ? state.oauth.message : 'x', /x/);
});

test('loadOauth：失败必须落 error 态', async () => {
  const { controller, state } = makeDeps({ failOauth: ['aura'] });
  await controller.load('aura');
  assert.equal(state.oauth.status, 'error');
  assert.match(state.oauth.message, /500/);
});

test('resolveEndpointKey：从第一个持有 `${VAR}` 的成员复制明文，不让用户重输', async () => {
  const { controller, calls } = makeDeps({
    endpoints: {
      aura: [{ id: 'fn', name: 'fn', baseUrl: 'https://llm/v1', models: ['m1'], hasApiKey: true, apiKeyPreview: '${HERMES_CUSTOM_FN_API_KEY}' }],
    },
    revealed: { 'aura:HERMES_CUSTOM_FN_API_KEY': 'sk-copied' },
  });
  const result = await controller.resolveEndpointKey('custom:fn', ['aura']);
  assert.deepEqual(result, { ok: true, key: 'sk-copied', source: 'aura' });
  assert.deepEqual(
    calls.map((call) => call.slice(0, 2)),
    [['listEndpoints', 'aura'], ['revealEnv', 'aura']],
    '必须先读源成员的端点清单，再按 key_env 变量名 reveal',
  );
  assert.equal(calls[1][2], 'HERMES_CUSTOM_FN_API_KEY', '只接受 `${VAR}` 变量名，不能把预览串当密钥');
});

test('resolveEndpointKey：跳过缺密钥与脱敏预览的成员，继续找下一个可读来源', async () => {
  const { controller, calls } = makeDeps({
    endpoints: {
      default: [{ id: 'fn', name: 'fn', baseUrl: 'https://llm/v1', models: ['m1'], hasApiKey: true, apiKeyPreview: 'sk-…9f2c' }],
      aura: [{ id: 'fn', name: 'fn', baseUrl: 'https://llm/v1', models: ['m1'], hasApiKey: true, apiKeyPreview: '${HERMES_CUSTOM_FN_API_KEY}' }],
    },
    revealed: { 'aura:HERMES_CUSTOM_FN_API_KEY': 'sk-real' },
  });
  const result = await controller.resolveEndpointKey('fn', ['default', 'aura']);
  assert.equal(result.ok, true);
  assert.equal(result.source, 'aura');
  assert.equal(calls.filter((call) => call[0] === 'revealEnv').length, 1, '脱敏预览不得触发 reveal，更不得被当成密钥写回');
});

test('resolveEndpointKey：所有成员都不可读时失败，并把原因交回界面降级为手填', async () => {
  const { controller, calls } = makeDeps({
    endpoints: {
      aura: [{ id: 'fn', name: 'fn', baseUrl: 'https://llm/v1', models: ['m1'], hasApiKey: false }],
    },
  });
  const result = await controller.resolveEndpointKey('fn', ['aura', 'codeboy']);
  assert.deepEqual(result, { ok: false, reason: 'no-readable-key', message: 'keyMissing' });
  assert.equal(calls.filter((call) => call[0] === 'revealEnv').length, 0);
  assert.equal(JSON.stringify(result).includes('sk-'), false, '失败结果不得夹带任何密钥形态');
});

test('resolveEndpointKey：读取成员清单失败必须报 transport，不能降级成 needsKey', async () => {
  const { controller } = makeDeps({ failList: ['aura'] });
  const result = await controller.resolveEndpointKey('fn', ['aura']);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'transport', '网关 500/超时不能被伪装成"没有可读密钥"');
  assert.match(result.message, /500/, '真实故障原文必须透出（Failure Is Not Empty）');
});

test('resolveEndpointKey：reveal 非 404 故障报 transport，404 才允许用户手填', async () => {
  const endpoint = { id: 'fn', name: 'fn', baseUrl: 'https://llm/v1', models: ['m1'], hasApiKey: true, apiKeyPreview: '${HERMES_CUSTOM_FN_API_KEY}' };

  const hard = makeDeps({ endpoints: { aura: [endpoint] }, failRevealHard: true });
  const hardResult = await hard.controller.resolveEndpointKey('fn', ['aura']);
  assert.equal(hardResult.ok, false);
  assert.equal(hardResult.reason, 'transport', 'reveal 500 是故障，不是缺密钥');
  assert.match(hardResult.message, /reveal down/);

  const missing = makeDeps({ endpoints: { aura: [endpoint] }, failReveal: ['aura'] });
  const missingResult = await missing.controller.resolveEndpointKey('fn', ['aura']);
  assert.deepEqual(missingResult, { ok: false, reason: 'no-readable-key', message: 'keyMissing' }, '变量不在 .env 里时用户手填即可');
});

test('resolveEndpointKey：reveal 失败不影响下一个成员，最终失败原因可见', async () => {
  const { controller } = makeDeps({
    endpoints: {
      aura: [{ id: 'fn', name: 'fn', baseUrl: 'https://llm/v1', models: ['m1'], hasApiKey: true, apiKeyPreview: '${HERMES_CUSTOM_FN_API_KEY}' }],
      codeboy: [{ id: 'fn', name: 'fn', baseUrl: 'https://llm/v1', models: ['m1'], hasApiKey: true, apiKeyPreview: '${HERMES_CUSTOM_FN_API_KEY}' }],
    },
    failReveal: ['aura'],
    revealed: { 'codeboy:HERMES_CUSTOM_FN_API_KEY': 'sk-from-codeboy' },
  });
  const result = await controller.resolveEndpointKey('fn', ['aura', 'codeboy']);
  assert.equal(result.ok, true, '一个成员读取失败不能让整次复制失败');
  assert.equal(result.source, 'codeboy');
});

test('useMainModel：走通用 /api/model/set，订阅与端点共用一条路径', async () => {
  const ok = makeDeps();
  const success = await ok.controller.useMainModel('default', { provider: 'xai-oauth', model: 'grok-4' });
  assert.equal(success.ok, true);
  assert.equal(ok.state.catalogChanges, 1);
  const call = ok.calls.find((item) => item[0] === 'setMainModel');
  assert.deepEqual(call[1], 'default');
  assert.equal(call[2].provider, 'xai-oauth', '订阅也必须能切换，旧的 activate 接口对订阅必然 404');
  assert.equal(call[2].model, 'grok-4');

  const bad = makeDeps({ failUse: true });
  const failure = await bad.controller.useMainModel('default', { provider: 'ghost', model: 'm1' });
  assert.equal(failure.ok, false, '失败必须如实返回 false，否则 UI 会显示成功');
  assert.match(failure.message, /400/);
  assert.equal(bad.state.catalogChanges, 0, '失败不该刷模型目录');
});

test('useMainModel：没有模型时不发请求，直接给出原因', async () => {
  const { controller, calls } = makeDeps();
  const result = await controller.useMainModel('default', { provider: 'nous', model: '   ' });
  assert.equal(result.ok, false);
  assert.equal(result.message, 'noModels');
  assert.equal(calls.filter((call) => call[0] === 'setMainModel').length, 0, '空模型网关只会回 400，别浪费一次请求');
});

test('useMainModel：网关要求确认高价模型时不得当成功，也不刷新目录', async () => {
  const { controller, state } = makeDeps({ confirmRequired: true });
  const result = await controller.useMainModel('default', { provider: 'openrouter', model: 'expensive/x' });
  assert.equal(result.ok, false, '没落盘就不能返回成功，否则用户以为切了');
  assert.equal(result.confirmRequired, true);
  assert.equal(result.message, 'priced high');
  assert.equal(state.catalogChanges, 0, '未写入不该刷新模型目录');
});

test('remove：删除跨所有配过它的 Agent 一起执行', async () => {
  const { controller, calls, state } = makeDeps();
  const result = await controller.remove(['default', 'aura', 'aura'], 'fn');
  assert.equal(result.ok, true);
  const deletes = calls.filter((call) => call[0] === 'deleteEndpoint');
  assert.deepEqual(deletes.map((call) => call[1]), ['default', 'aura'], '重复的 Agent 只删一次');
  assert.equal(state.catalogChanges, 1);
});

test('remove：部分 Agent 失败时如实回报，不谎报成功', async () => {
  const { controller, calls } = makeDeps({ failDelete: true });
  const result = await controller.remove(['default', 'aura'], 'fn');
  assert.equal(result.ok, false);
  assert.equal(result.failed.length, 2);
  assert.equal(calls.filter((call) => call[0] === 'deleteEndpoint').length, 2, '一个失败不能让另一个不执行');
});

test('remove：没有目标时不能伪装成删除成功', async () => {
  const { controller, calls } = makeDeps();
  const result = await controller.remove([], 'fn');
  assert.equal(result.ok, false);
  assert.equal(result.message, 'noTargets');
  assert.equal(calls.length, 0);
});

test('remove：部分失败必须返回 ok:false 并带上失败名单，不能报"已删除"', async () => {
  const { controller, calls } = makeDeps({ failDelete: ['aura'] });
  const result = await controller.remove(['default', 'aura'], 'fn');
  assert.equal(result.ok, false, '1 成 1 败不是成功：调用方会据此 toast「已删除」');
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].profile, 'aura');
  assert.equal(calls.filter((call) => call[0] === 'deleteEndpoint').length, 2, '一个失败不能阻止下一个执行');
});

test('planDeleteTarget：目标 Bot 在打开弹窗的瞬间锁定，之后切换作用域不得改变它', () => {
  const target = planDeleteTarget('aura', '内容 Bot');
  assert.deepEqual(target, { profile: 'aura', displayName: '内容 Bot' }, '确认期间切换头像条不得改变被删的 Bot');
  assert.deepEqual(planDeleteTarget('default', ''), { profile: 'default', displayName: 'default' }, '缺显示名时回落 profile 名');
});
