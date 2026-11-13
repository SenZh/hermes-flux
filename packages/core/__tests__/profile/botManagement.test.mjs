import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDraftToDetail,
  buildBotConfigureParams,
  draftFromDetail,
  evaluateBotConfigureOutcome,
  isBotDraftDirty,
  mergeBotUiMeta,
  mergeMcpStatus,
  mergeSkillInventory,
  parseBotDetail,
  projectBotRoster,
  requestedConfigureSegments,
  validateBotId,
} from '../../dist/profile/botManagement.js';

const identity = { id: 'arch-wang', displayName: '架构老王', isDefault: false, avatar: 'data:image/png;base64,AA' };

function describePayload(overrides = {}) {
  return {
    name: 'arch-wang',
    description: '负责架构评审',
    soul: 'You are a senior architect.',
    model: { provider: 'anthropic', default: 'claude-opus-4.8' },
    skills: [
      { name: 'review', enabled: true },
      { name: 'dangerous-shell', enabled: false },
    ],
    toolsets: [
      { name: 'shell', enabled: true, label: '终端', tool_count: 12 },
      { name: 'web_search', enabled: false, label: '联网检索', tool_count: 3 },
    ],
    mcp_servers: [
      { name: 'github', enabled: true, transport: 'stdio' },
    ],
    ...overrides,
  };
}

test('parseBotDetail：真实契约字段完整落进领域模型，能力清单保留 enabled/label/tool_count', () => {
  const detail = parseBotDetail(describePayload(), identity);
  assert.equal(detail.id, 'arch-wang');
  assert.equal(detail.displayName, '架构老王');
  assert.equal(detail.description, '负责架构评审');
  assert.equal(detail.soul, 'You are a senior architect.');
  assert.equal(detail.model, 'claude-opus-4.8');
  assert.equal(detail.provider, 'anthropic');
  assert.equal(detail.avatar, 'data:image/png;base64,AA');
  assert.equal(detail.skills.authoritative, true);
  assert.deepEqual(detail.skills.rows.map((row) => [row.id, row.enabled]), [
    ['review', true],
    ['dangerous-shell', false],
  ]);
  assert.equal(detail.toolsets.rows[0].label, '终端');
  assert.equal(detail.toolsets.rows[0].toolCount, 12);
  assert.equal(detail.mcpServers.rows[0].transport, 'stdio');
});

test('parseBotDetail：网关标签开头的装饰 emoji 必须剥离，正文不混入图标', () => {
  const detail = parseBotDetail(
    {
      name: 'arch-wang',
      toolsets: [{ name: 'web', label: '🔍 Web Search & Scraping', enabled: true }],
    },
    identity,
  );
  assert.equal(detail.toolsets.rows[0].label, 'Web Search & Scraping');
  const noText = parseBotDetail(
    { name: 'arch-wang', toolsets: [{ name: 'web', label: '🔍', enabled: true }] },
    identity,
  );
  assert.equal(noText.toolsets.rows[0].label, '🔍', '纯 emoji 标签不得被剥成空串');
});

test('parseBotDetail：工具数同时兼容 tool_count（describe）与 tools（mcp.servers.status）', () => {
  const detail = parseBotDetail(
    {
      name: 'arch-wang',
      toolsets: [{ name: 'web', tool_count: 3, enabled: true }],
      mcp_servers: [{ name: 'github', tools: 9, enabled: true }, { name: 'bare', enabled: true }],
    },
    identity,
  );
  assert.equal(detail.toolsets.rows[0].toolCount, 3);
  assert.equal(detail.mcpServers.rows[0].toolCount, 9, '网关 0.23.1 的 MCP 行字段是 tools');
  assert.equal(detail.mcpServers.rows[1].toolCount, undefined, '两者都缺时必须是"不知道"，不能填 0');
});

test('parseBotDetail：缺失能力字段必须标记非权威，不得伪造空清单', () => {
  const detail = parseBotDetail({ name: 'arch-wang', soul: 'x' }, identity);
  assert.equal(detail.skills.authoritative, false);
  assert.equal(detail.toolsets.authoritative, false);
  assert.equal(detail.mcpServers.authoritative, false);
  assert.deepEqual(detail.skills.rows, []);
});

test('parseBotDetail：兼容旧网关的 profile 包装与裸字符串模型', () => {
  const detail = parseBotDetail({
    profile: { name: 'legacy', description: '旧档案', systemPrompt: 'legacy soul', model: 'gpt-5.6' },
  }, { ...identity, id: 'legacy', displayName: '旧档案' });
  assert.equal(detail.soul, 'legacy soul');
  assert.equal(detail.model, 'gpt-5.6');
  assert.equal(detail.provider, '');
});

test('draftFromDetail / isBotDraftDirty：初始草稿不脏，任一字段或头像变化即脏', () => {
  const detail = parseBotDetail(describePayload(), identity);
  const draft = draftFromDetail(detail);
  assert.equal(isBotDraftDirty(detail, draft), false);
  assert.deepEqual(draft.disabledSkills, ['dangerous-shell']);
  assert.deepEqual(draft.enabledToolsets, ['shell']);
  assert.deepEqual(draft.enabledMcpServers, ['github']);

  assert.equal(isBotDraftDirty(detail, { ...draft, description: '改过了' }), true);
  assert.equal(isBotDraftDirty(detail, { ...draft, avatar: { kind: 'clear' } }), true);
  assert.equal(
    isBotDraftDirty(detail, { ...draft, disabledSkills: [] }),
    true,
    '能力集合变化必须识别',
  );
  assert.equal(
    isBotDraftDirty(detail, { ...draft, disabledSkills: ['dangerous-shell'] }),
    false,
    '集合顺序不构成修改',
  );
});

test('buildBotConfigureParams：只提交与权威快照不同的字段', () => {
  const detail = parseBotDetail(describePayload(), identity);
  const draft = draftFromDetail(detail);
  assert.equal(buildBotConfigureParams(detail, draft), null, '没有改动时不得发 RPC');

  const params = buildBotConfigureParams(detail, { ...draft, description: '新描述' });
  assert.deepEqual(params, { name: 'arch-wang', description: '新描述' });
});

test('buildBotConfigureParams：能力清单非权威时省略对应字段，防止用读取缺口覆盖真实配置', () => {
  const detail = parseBotDetail({ name: 'arch-wang', soul: 'x' }, identity);
  const draft = draftFromDetail(detail);
  const params = buildBotConfigureParams(detail, {
    ...draft,
    disabledSkills: ['review'],
    enabledToolsets: [],
    enabledMcpServers: ['github'],
  });
  assert.equal(params, null, '非权威清单上的开关不得写回网关，否则会把未知状态写成空配置');
});

test('buildBotConfigureParams：显示名与默认标记合并进 ui_meta，保留群聊房间等其它键', () => {
  const detail = parseBotDetail(describePayload(), identity);
  const draft = draftFromDetail(detail);
  const params = buildBotConfigureParams(
    detail,
    { ...draft, displayName: '首席架构', isDefault: true },
    { 'hermes-bots-groups': { rooms: { r1: { name: '研讨' } } }, 'hermes-bots': { color: 'gold' } },
  );
  assert.ok(params);
  assert.deepEqual(params.ui_meta, {
    'hermes-bots-groups': { rooms: { r1: { name: '研讨' } } },
    'hermes-bots': { color: 'gold', title: '首席架构', is_default: true },
  });
  assert.equal(params.description, undefined, '未改动的字段不得进入请求');
});

test('mergeBotUiMeta：只改默认标记时不得抹掉已保存的 title', () => {
  assert.deepEqual(mergeBotUiMeta({ 'hermes-bots': { title: '老王' } }, { isDefault: true }), {
    'hermes-bots': { title: '老王', is_default: true },
  });
});

test('validateBotId：空串与纯空白必须落到 format 失败', () => {
  assert.deepEqual(validateBotId('', []), { ok: false, reason: 'format' });
  assert.deepEqual(validateBotId('   ', []), { ok: false, reason: 'format' });
});

test('validateBotId：格式与重名分别给出可区分的失败原因', () => {
  assert.deepEqual(validateBotId('arch-wang', []), { ok: true });
  assert.deepEqual(validateBotId('A_1-b', []), { ok: true });
  assert.deepEqual(validateBotId('架构老王', []), { ok: false, reason: 'format' });
  assert.deepEqual(validateBotId('has space', []), { ok: false, reason: 'format' });
  assert.deepEqual(validateBotId('-'.repeat(65), []), { ok: false, reason: 'format' });
  assert.deepEqual(validateBotId('arch-wang', ['arch-wang']), { ok: false, reason: 'conflict' });
  assert.deepEqual(validateBotId('arch-wang', ['default']), { ok: true });
});

test('mergeMcpStatus：探活失败保留原状态，绝不把失败画成红灯', () => {
  const detail = parseBotDetail(describePayload(), identity);
  const unchanged = mergeMcpStatus(detail.mcpServers, null);
  assert.equal(unchanged, detail.mcpServers, '探活失败必须原样返回');
  assert.equal(unchanged.rows[0].online, undefined, '失败时状态必须是未知，不是离线');

  const merged = mergeMcpStatus(detail.mcpServers, [{ name: 'github', connected: true, transport: 'http', toolCount: 9 }]);
  assert.equal(merged.rows[0].online, true);
  assert.equal(merged.rows[0].transport, 'stdio', 'describe 的传输方式优先于探活回显');
  assert.equal(merged.rows[0].toolCount, 9);
});

test('mergeSkillInventory：describe 权威时不合并全局目录，非权威时才补全展示项', () => {
  const detail = parseBotDetail(describePayload(), identity);
  const untouched = mergeSkillInventory(detail.skills, ['review', 'extra-skill']);
  assert.equal(untouched, detail.skills, '权威清单不得被全局目录污染');

  const nonAuthoritative = { authoritative: false, rows: [] };
  const merged = mergeSkillInventory(nonAuthoritative, ['review', 'extra-skill']);
  assert.equal(merged.authoritative, false);
  assert.deepEqual(merged.rows.map((row) => row.id), ['review', 'extra-skill']);
  assert.equal(merged.rows.every((row) => row.enabled), true);
});

test('applyDraftToDetail：保存成功后本地投影立即不脏，无需等待远程回读', () => {
  const detail = parseBotDetail(describePayload(), identity);
  const draft = {
    ...draftFromDetail(detail),
    displayName: '首席架构',
    avatar: { kind: 'replace', dataUrl: 'data:image/webp;base64,BB' },
    disabledSkills: ['review'],
    enabledToolsets: ['shell', 'web_search'],
  };
  const applied = applyDraftToDetail(detail, draft);
  assert.equal(applied.displayName, '首席架构');
  assert.equal(applied.avatar, 'data:image/webp;base64,BB');
  assert.equal(applied.skills.rows.find((row) => row.id === 'review').enabled, false);
  assert.equal(applied.toolsets.rows.find((row) => row.id === 'web_search').enabled, true);
  assert.equal(isBotDraftDirty(applied, draftFromDetail(applied)), false);
});

test('requestedConfigureSegments：入参名必须折算成网关 applied 的段名', () => {
  assert.deepEqual(
    requestedConfigureSegments({
      name: 'arch-wang',
      description: 'x',
      soul: 'y',
      model: 'm',
      provider: 'p',
      disabled_skills: ['a'],
      enabled_toolsets: ['b'],
      enabled_mcp_servers: ['c'],
      ui_meta: { 'hermes-bots': { title: 't' } },
    }),
    ['description', 'soul', 'model', 'skills', 'toolsets', 'mcp_servers', 'ui_meta'],
  );
  assert.deepEqual(requestedConfigureSegments({ name: 'arch-wang' }), []);
});

test('projectBotRoster：hasDraft 只认草稿池的 key，不靠字段非空猜测', () => {
  const rows = [
    { name: 'default', displayName: 'Hermes', model: 'm1', isDefault: true },
    { name: 'arch', model: 'm2' },
    { name: 'ops' },
  ];
  const drafts = {
    // 空字符串也是合法草稿值：显示名清空同样是"有修改"。
    arch: {
      displayName: '',
      description: '',
      model: '',
      provider: '',
      isDefault: false,
      soul: '',
      avatar: { kind: 'unchanged' },
      disabledSkills: [],
      enabledToolsets: [],
      enabledMcpServers: [],
    },
  };
  const roster = projectBotRoster(rows, drafts);
  assert.deepEqual(roster.map((row) => [row.id, row.hasDraft]), [
    ['default', false],
    ['arch', true],
    ['ops', false],
  ]);
  assert.equal(roster[1].displayName, 'arch', '缺显示名时回落 profile 名');
  assert.equal(roster[2].model, '', '缺模型时给空串，不编造');
  assert.deepEqual(roster.map((row) => row.id), ['default', 'arch', 'ops'], '顺序必须与输入一致');
});

test('projectBotRoster：草稿池里其它 BOT 的草稿不影响当前行', () => {
  const roster = projectBotRoster([{ name: 'arch' }], { other: { displayName: 'x' } });
  assert.equal(roster[0].hasDraft, false);
});

test('projectBotRoster：键存在即为有草稿，不得用真值判断替代存在性判断', () => {
  // 草稿对象本身可能被写成 undefined（壳层误赋值），但"这个 BOT 有草稿"仍然成立：
  // 用 Boolean(drafts[name]) 判断会在这里静默失明，脏点不亮、重置按钮变灰。
  const roster = projectBotRoster([{ name: 'ops' }], { ops: undefined });
  assert.equal(roster[0].hasDraft, true, '键存在即为有草稿，即便值是 undefined');
});

test('evaluateBotConfigureOutcome：ok:true 也要逐段核对，缺段必须报 partial 而不是成功', () => {
  const params = { name: 'arch-wang', description: 'x', disabled_skills: ['review'] };
  assert.deepEqual(
    evaluateBotConfigureOutcome(params, {
      ok: true,
      applied: { description: true },
    }),
    { ok: false, kind: 'partial', missing: ['skills'], message: '' },
    '网关只写了 description 时，界面不能宣称整包保存成功',
  );
  assert.deepEqual(
    evaluateBotConfigureOutcome(params, {
      ok: true,
      applied: { description: true, skills: true },
    }),
    { ok: true },
  );
});

test('evaluateBotConfigureOutcome：confirm_required 优先，网关没有写入时必须保留草稿并给出出路', () => {
  const outcome = evaluateBotConfigureOutcome(
    { name: 'arch-wang', model: 'expensive/model' },
    { ok: true, applied: {}, confirm_required: true, confirm_message: '该模型单价较高，需确认' },
  );
  assert.deepEqual(outcome, {
    ok: false,
    kind: 'confirm',
    message: '该模型单价较高，需确认',
  });
});

test('evaluateBotConfigureOutcome：ok:false 不得被 applied 覆盖；缺 applied 视为协议不完整', () => {
  assert.deepEqual(
    evaluateBotConfigureOutcome(
      { name: 'arch-wang', ui_meta: {} },
      // 实测 0.23.1：清空 ui_meta 返回 ok:false，但 applied.ui_meta 仍为 true。
      { ok: false, applied: { ui_meta: true } },
    ),
    { ok: false, kind: 'failed', message: '' },
  );
  assert.deepEqual(
    evaluateBotConfigureOutcome({ name: 'arch-wang', description: 'x' }, { ok: true }),
    { ok: false, kind: 'failed', message: '' },
    '缺少分段结果时不能猜成功',
  );
  assert.deepEqual(
    evaluateBotConfigureOutcome({ name: 'arch-wang', description: 'x' }, null),
    { ok: false, kind: 'failed', message: '' },
  );
});

test('evaluateBotConfigureOutcome：applied 为空对象时所有请求段都算缺失', () => {
  const params = { name: 'arch-wang', description: 'x', soul: 'y' };
  assert.deepEqual(
    evaluateBotConfigureOutcome(params, { ok: true, applied: {} }),
    { ok: false, kind: 'partial', missing: ['description', 'soul'], message: '' },
    'applied 是空对象（非缺失）时，界面必须报全部未写入',
  );
});

test('evaluateBotConfigureOutcome：兼容早期网关的字符串数组 applied（含入参名）', () => {
  assert.deepEqual(
    evaluateBotConfigureOutcome(
      { name: 'arch-wang', disabled_skills: ['review'], enabled_toolsets: ['shell'] },
      { ok: true, applied: ['disabled_skills', 'enabled_toolsets'] },
    ),
    { ok: true },
  );
});

test('buildBotConfigureParams：只有确认后才带 confirm_expensive_model，普通保存必须走网关守卫', () => {
  const detail = parseBotDetail(describePayload(), identity);
  const draft = { ...draftFromDetail(detail), model: 'expensive/model', provider: 'p' };
  const guarded = buildBotConfigureParams(detail, draft);
  assert.equal(guarded.confirm_expensive_model, undefined);
  const confirmed = buildBotConfigureParams(detail, draft, undefined, { confirmExpensive: true });
  assert.equal(confirmed.confirm_expensive_model, true);
  assert.equal(
    buildBotConfigureParams(detail, draftFromDetail(detail), undefined, { confirmExpensive: true }),
    null,
    '没有改动时即使带确认旗标也不得发 RPC',
  );
});

test('mergeMcpStatus：兼容网关 0.23.1 的 tools 字段', () => {
  const detail = parseBotDetail(describePayload(), identity);
  const merged = mergeMcpStatus(detail.mcpServers, [
    { name: 'github', connected: false, transport: 'http', tools: 7 },
  ]);
  assert.equal(merged.rows[0].online, false);
  assert.equal(merged.rows[0].toolCount, 7);
});
