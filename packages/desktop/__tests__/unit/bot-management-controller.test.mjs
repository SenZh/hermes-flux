/**
 * BOT 面板壳层编排的行为测试（真实模块，假网关）。
 *
 * 【为什么需要】renderer 里的接线只能证明"方法名存在"，证明不了：
 *   160ms 防抖真的生效、迟到响应真的被令牌丢弃、保存失败真的保留草稿、
 *   无草稿时真的不发 RPC。这些分支必须直接驱动控制器并观察副作用。
 *
 * 【口径】所有断言只观察注入的 state 与调用记录，不依赖真实 DOM / 网关。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotManagementController } from '../../dist/renderer/botManagementController.mjs';

const detail = (overrides = {}) => ({
  id: 'arch',
  displayName: '架构老王',
  description: '负责架构评审',
  model: '',
  provider: '',
  soul: '',
  avatar: undefined,
  isDefault: false,
  skills: { authoritative: false, rows: [] },
  toolsets: { authoritative: false, rows: [] },
  mcpServers: { authoritative: false, rows: [] },
  ...overrides,
});

const roster = (overrides = []) => (overrides.length > 0
  ? overrides
  : [
      { name: 'default', displayName: 'Hermes', isDefault: true },
      { name: 'arch', displayName: '架构老王', isDefault: false },
    ]);

function makeHarness(options = {}) {
  const state = {
    status: { status: 'uninitialized' },
    activeBotId: '',
    activeDetail: undefined,
    drafts: {},
    errorBanner: undefined,
    confirmPending: undefined,
    isBusy: false,
  };
  const profiles = { status: 'idle' };
  const calls = [];
  const toasts = [];
  const schedules = [];
  const avatarChanges = [];
  let renders = 0;

  /** 真实网关只回请求里携带的段；默认成功必须逐段回 true，否则严格判定会失败。 */
  const appliedFromParams = (params) => {
    const applied = {};
    if (params.description !== undefined) applied.description = true;
    if (params.soul !== undefined) applied.soul = true;
    if (params.model !== undefined || params.provider !== undefined) applied.model = true;
    if (params.disabled_skills !== undefined) applied.skills = true;
    if (params.enabled_toolsets !== undefined) applied.toolsets = true;
    if (params.enabled_mcp_servers !== undefined) applied.mcp_servers = true;
    if (params.ui_meta !== undefined) applied.ui_meta = true;
    return applied;
  };

  const deps = {
    isConnected: () => options.connected !== false,
    loadProfiles: async () => {
      profiles.status = options.listError ? 'error' : 'ready';
      if (options.listError) profiles.message = options.listError;
      else profiles.data = options.profiles ?? [];
    },
    getProfiles: () => profiles,
    getState: () => ({ ...state }),
    setState: (patch) => {
      Object.assign(state, patch);
    },
    describeBot: async (botId, hint) => {
      calls.push({ method: 'profiles.describe', botId, hint });
      if (options.describeError) throw new Error(options.describeError);
      return options.describeDetail ?? detail({ id: botId, displayName: hint.displayName });
    },
    fetchSkillInventory: async (botId) => {
      calls.push({ method: 'skills.manage', botId });
      if (options.skillInventoryError) throw new Error(options.skillInventoryError);
      return options.skillInventory ?? null;
    },
    fetchMcpStatus: async (botId) => {
      calls.push({ method: 'mcp.servers.status', botId });
      if (options.mcpStatusError) throw new Error(options.mcpStatusError);
      return options.mcpStatus ?? null;
    },
    configureBot: async (params) => {
      calls.push({ method: 'profiles.configure', params });
      if (options.configureError) throw new Error(options.configureError);
      return options.configureResult ?? { ok: true, applied: appliedFromParams(params) };
    },
    setAsset: async (botId, dataUrl, clear) => {
      calls.push({ method: 'profiles.set_asset', botId, dataUrl, clear });
      return options.setAssetOk !== false;
    },
    render: () => {
      renders += 1;
    },
    translate: (key) => key,
    describeError: (error) => (error instanceof Error ? error.message : String(error)),
    notify: (message) => toasts.push(message),
    onProfilesChanged: () => {
      calls.push({ method: 'profiles.changed' });
    },
    onAvatarChanged: (botId, dataUrl) => {
      avatarChanges.push({ botId, dataUrl });
    },
    schedule: (fn, ms) => {
      const entry = { fn, ms, cancelled: false };
      schedules.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  };

  const controller = createBotManagementController(deps);

  return {
    controller,
    deps,
    state,
    profiles,
    calls,
    toasts,
    schedules,
    avatarChanges,
    get renders() {
      return renders;
    },
    flushSchedules() {
      for (const entry of schedules) {
        if (!entry.cancelled) entry.fn();
      }
      schedules.length = 0;
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('未连接：落 list_error 且不发任何 RPC', async () => {
  const h = makeHarness({ connected: false });
  await h.controller.loadRoster();
  assert.deepEqual(h.state.status, { status: 'list_error', message: 'settings.notConnected' });
  assert.deepEqual(h.calls, []);
});

test('空花名册：落 empty_list，不伪造默认 BOT', async () => {
  const h = makeHarness({ profiles: [] });
  await h.controller.loadRoster();
  assert.deepEqual(h.state.status, { status: 'empty_list' });
  assert.equal(h.state.activeBotId, '');
  assert.equal(h.state.activeDetail, undefined);
});

test('列表失败：落 list_error 并保留真实原因', async () => {
  const h = makeHarness({ listError: 'profiles down' });
  await h.controller.loadRoster();
  assert.deepEqual(h.state.status, { status: 'list_error', message: 'profiles down' });
});

test('花名册就绪：默认选中首项并立即进入 loading_detail，160ms 后才发 describe', async () => {
  const h = makeHarness({ profiles: roster() });
  await h.controller.loadRoster();
  assert.equal(h.state.activeBotId, 'default');
  assert.deepEqual(h.state.status, { status: 'loading_detail', activeBotId: 'default' });
  assert.equal(h.calls.filter((call) => call.method === 'profiles.describe').length, 0, '防抖窗口内不得发 RPC');
  assert.equal(h.schedules[0].ms, 160);

  h.flushSchedules();
  await tick();
  assert.equal(h.calls.filter((call) => call.method === 'profiles.describe').length, 1);
  assert.deepEqual(h.state.status, { status: 'idle', activeBotId: 'default' });
  assert.equal(h.state.activeDetail.id, 'default');
});

test('详情并发：迟到的旧响应不得覆盖新选择', async () => {
  const pending = [];
  const h = makeHarness({ profiles: roster() });
  h.deps.describeBot = (botId, hint) =>
    new Promise((resolve) => {
      pending.push({ botId, resolve: () => resolve(detail({ id: botId, displayName: hint.displayName })) });
    });

  await h.controller.loadRoster();
  h.flushSchedules();
  await tick();
  h.controller.selectBot('arch', { immediate: true });
  await tick();

  // 先返回新选择，再返回旧选择：旧响应必须被令牌丢弃。
  pending[1].resolve();
  await tick();
  pending[0].resolve();
  await tick();

  assert.equal(h.state.activeBotId, 'arch');
  assert.equal(h.state.activeDetail.id, 'arch');
});

test('详情失败：落 detail_error 带原始原因，草稿绝不清理', async () => {
  const h = makeHarness({ profiles: roster(), describeError: 'describe boom' });
  h.state.drafts = { arch: { displayName: '草稿' } };
  await h.controller.loadRoster();
  h.flushSchedules();
  await tick();
  assert.deepEqual(h.state.status, { status: 'detail_error', activeBotId: 'default', message: 'describe boom' });
  assert.deepEqual(h.state.drafts, { arch: { displayName: '草稿' } });
});

test('草稿：改动入池、改回原值自动清池、无详情时忽略', () => {
  const h = makeHarness({ profiles: roster() });
  h.state.activeDetail = detail();
  h.state.activeBotId = 'arch';

  h.controller.updateDraft('arch', { displayName: '首席架构' });
  assert.equal(h.state.drafts.arch.displayName, '首席架构');

  h.controller.updateDraft('arch', { displayName: '架构老王' });
  assert.equal('arch' in h.state.drafts, false, '改回权威值后不得继续亮脏点');

  h.controller.updateDraft('default', { displayName: '错人' });
  assert.equal('default' in h.state.drafts, false, '非 activeDetail 的补丁必须忽略');
});

test('保存：无草稿不发 RPC，直接成功', async () => {
  const h = makeHarness({ profiles: roster() });
  const result = await h.controller.saveBot('arch');
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(h.calls, []);
});

test('保存成功：只提交差异字段，头像走 set_asset，成功后清草稿并通知', async () => {
  const h = makeHarness({ profiles: roster() });
  h.state.activeDetail = detail();
  h.state.activeBotId = 'arch';
  h.state.status = { status: 'idle', activeBotId: 'arch' };
  h.state.drafts = {
    arch: {
      displayName: '首席架构',
      description: '负责架构评审',
      model: '',
      provider: '',
      isDefault: false,
      soul: '',
      avatar: { kind: 'replace', dataUrl: 'data:image/webp;base64,BB' },
      disabledSkills: [],
      enabledToolsets: [],
      enabledMcpServers: [],
    },
  };

  const result = await h.controller.saveBot('arch');
  assert.deepEqual(result, { ok: true });

  const configure = h.calls.find((call) => call.method === 'profiles.configure');
  assert.ok(configure);
  assert.equal(configure.params.name, 'arch');
  assert.equal(configure.params.description, undefined, '未改动字段不得提交');
  assert.deepEqual(configure.params.ui_meta, { 'hermes-bots': { title: '首席架构' } });

  const asset = h.calls.find((call) => call.method === 'profiles.set_asset');
  assert.equal(asset.dataUrl, 'data:image/webp;base64,BB');
  assert.equal(asset.clear, false);

  assert.equal('arch' in h.state.drafts, false, '保存成功必须删除草稿，否则脏点复活');
  assert.equal(h.state.activeDetail.displayName, '首席架构');
  assert.equal(h.state.isBusy, false);
  assert.deepEqual(h.toasts, ['bot.saved']);
  assert.ok(h.calls.some((call) => call.method === 'profiles.changed'));
  assert.deepEqual(h.avatarChanges, [{ botId: 'arch', dataUrl: 'data:image/webp;base64,BB' }], '头像保存后必须同步本地缓存');
});

test('保存失败：保留草稿、挂失败横幅、恢复可交互状态', async () => {
  const h = makeHarness({ profiles: roster(), configureError: 'gateway 500' });
  h.state.activeDetail = detail();
  h.state.activeBotId = 'arch';
  h.state.status = { status: 'idle', activeBotId: 'arch' };
  const draft = {
    displayName: '首席架构',
    description: '负责架构评审',
    model: '',
    provider: '',
    isDefault: false,
    soul: '',
    avatar: { kind: 'unchanged' },
    disabledSkills: [],
    enabledToolsets: [],
    enabledMcpServers: [],
  };
  h.state.drafts = { arch: draft };

  const result = await h.controller.saveBot('arch');
  assert.deepEqual(result, { ok: false, message: 'gateway 500' });
  assert.deepEqual(h.state.drafts.arch, draft, '失败必须 100% 保留草稿');
  assert.equal(h.state.errorBanner, 'gateway 500');
  assert.equal(h.state.isBusy, false);
  assert.deepEqual(h.state.status, { status: 'idle', activeBotId: 'arch' });
});

test('保存头像清除：必须显式 clear=true', async () => {
  const h = makeHarness({ profiles: roster() });
  h.state.activeDetail = detail();
  h.state.activeBotId = 'arch';
  h.state.status = { status: 'idle', activeBotId: 'arch' };
  h.state.drafts = {
    arch: {
      displayName: '架构老王',
      description: '负责架构评审',
      model: '',
      provider: '',
      isDefault: false,
      soul: '',
      avatar: { kind: 'clear' },
      disabledSkills: [],
      enabledToolsets: [],
      enabledMcpServers: [],
    },
  };

  const result = await h.controller.saveBot('arch');
  assert.deepEqual(result, { ok: true });
  const asset = h.calls.find((call) => call.method === 'profiles.set_asset');
  assert.equal(asset.clear, true);
  assert.equal(asset.dataUrl, '');
  assert.equal(h.calls.some((call) => call.method === 'profiles.configure'), false, '只改头像时不得发 configure');
});

test('保存防重入：saving 状态下再次保存被拒绝且不发第二个 RPC', async () => {
  const h = makeHarness({ profiles: roster() });
  h.state.activeDetail = detail();
  h.state.activeBotId = 'arch';
  h.state.status = { status: 'saving', activeBotId: 'arch' };
  h.state.drafts = {
    arch: {
      displayName: '首席架构',
      description: '负责架构评审',
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

  const result = await h.controller.saveBot('arch');
  assert.equal(result.ok, false);
  assert.deepEqual(h.calls, []);
});

test('保存 displayName 时合并现有 ui_meta，不抹掉群聊房间', async () => {
  const h = makeHarness({
    profiles: [
      {
        name: 'arch',
        displayName: '架构老王',
        isDefault: false,
        uiMeta: { 'hermes-bots-groups': { rooms: { r1: { name: '研讨' } } }, 'hermes-bots': { color: 'gold' } },
      },
    ],
  });
  h.state.activeDetail = detail();
  h.state.activeBotId = 'arch';
  h.state.status = { status: 'idle', activeBotId: 'arch' };
  // 保存时要读取花名册行的 ui_meta；先走一次真实装载，避免用 idle 空表掩盖合并逻辑。
  await h.deps.loadProfiles();
  h.state.drafts = {
    arch: {
      displayName: '首席架构',
      description: '负责架构评审',
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

  await h.controller.saveBot('arch');
  const configure = h.calls.find((call) => call.method === 'profiles.configure');
  assert.deepEqual(configure.params.ui_meta, {
    'hermes-bots-groups': { rooms: { r1: { name: '研讨' } } },
    'hermes-bots': { color: 'gold', title: '首席架构' },
  });
});

test('能力补全：保存成功后迟到的探活结果不得覆盖新投影', async () => {
  const mcpDetail = detail({
    mcpServers: {
      authoritative: true,
      rows: [{ id: 'github', label: 'github', enabled: true, transport: 'stdio' }],
    },
  });
  let releaseProbe;
  const h = makeHarness({
    profiles: roster(),
    describeDetail: mcpDetail,
    mcpStatus: [{ name: 'github', connected: true, tools: 9 }],
  });
  // 首次补全改为手动放行，模拟探活比保存慢。
  h.deps.fetchMcpStatus = () =>
    new Promise((resolve) => {
      releaseProbe = () => resolve([{ name: 'github', connected: true, tools: 9 }]);
    });

  await h.controller.selectBot('arch', { immediate: true });
  await tick();

  h.state.status = { status: 'idle', activeBotId: 'arch' };
  h.state.drafts = { arch: fullDraft({ description: '新描述' }) };
  const result = await h.controller.saveBot('arch');
  assert.equal(result.ok, true);

  releaseProbe();
  await tick();
  assert.equal(
    h.state.activeDetail.mcpServers.rows[0].online,
    undefined,
    '保存后的新投影不得被迟到的旧探活结果覆盖',
  );
});

test('重置草稿：只清当前 BOT，其它草稿不受影响', () => {
  const h = makeHarness({ profiles: roster() });
  h.state.drafts = { arch: { displayName: 'a' }, other: { displayName: 'b' } };
  h.controller.resetDraft('arch');
  assert.equal('arch' in h.state.drafts, false);
  assert.equal('other' in h.state.drafts, true);
});

test('ensureLoaded：未初始化才拉列表，已有详情不重复取数', async () => {
  const h = makeHarness({ profiles: roster() });
  h.controller.ensureLoaded();
  await tick();
  assert.equal(h.calls.filter((call) => call.method === 'profiles.describe').length, 0, '先走防抖');
  h.flushSchedules();
  await tick();
  const describeCount = h.calls.filter((call) => call.method === 'profiles.describe').length;
  assert.equal(describeCount, 1);

  h.controller.ensureLoaded();
  await tick();
  assert.equal(
    h.calls.filter((call) => call.method === 'profiles.describe').length,
    describeCount,
    '已有 idle + 详情时不得重复取数',
  );
});

test('dismissError：只清失败横幅，确认横幅与草稿都不动', () => {
  const h = makeHarness({ profiles: roster() });
  h.state.errorBanner = 'boom';
  h.state.confirmPending = { message: 'guard' };
  h.state.drafts = { arch: { displayName: 'a' } };
  h.state.activeDetail = detail();
  h.controller.dismissError();
  assert.equal(h.state.errorBanner, undefined);
  assert.deepEqual(h.state.confirmPending, { message: 'guard' }, '关闭错误不得顺带清掉确认态');
  assert.equal('arch' in h.state.drafts, true);
  assert.equal(h.state.activeDetail.id, 'arch');
});

test('dismissConfirm：只清确认横幅，错误横幅与草稿都不动', () => {
  const h = makeHarness({ profiles: roster() });
  h.state.errorBanner = 'boom';
  h.state.confirmPending = { message: 'guard' };
  h.state.drafts = { arch: { displayName: 'a' } };
  h.controller.dismissConfirm();
  assert.equal(h.state.confirmPending, undefined);
  assert.equal(h.state.errorBanner, 'boom', '确认关闭动作不得顺带清掉错误横幅');
  assert.equal('arch' in h.state.drafts, true, '草稿必须保留');
});

/** 构造一个字段齐全的草稿，避免每个用例重复铺 13 个字段。 */
const fullDraft = (overrides = {}) => ({
  displayName: '架构老王',
  description: '负责架构评审',
  model: '',
  provider: '',
  isDefault: false,
  soul: '',
  avatar: { kind: 'unchanged' },
  disabledSkills: [],
  enabledToolsets: [],
  enabledMcpServers: [],
  ...overrides,
});

test('保存部分写入：ok:true 但 applied 缺段时必须报失败并保留草稿', async () => {
  const h = makeHarness({
    profiles: roster(),
    // 只写了 description，soul 没写：界面不能宣称整包保存成功。
    configureResult: { ok: true, applied: { description: true } },
  });
  h.state.activeDetail = detail();
  h.state.activeBotId = 'arch';
  h.state.status = { status: 'idle', activeBotId: 'arch' };
  h.state.drafts = { arch: fullDraft({ description: '新描述', soul: '新灵魂' }) };

  const result = await h.controller.saveBot('arch');
  assert.equal(result.ok, false);
  assert.equal(h.state.errorBanner, 'bot.savePartial');
  assert.equal('arch' in h.state.drafts, true, '部分写入不是成功，草稿必须保留');
  assert.equal(h.calls.some((call) => call.method === 'profiles.set_asset'), false);
});

test('保存等待确认：confirm_required 时一个字段都没写，保留草稿并给确认出路', async () => {
  const h = makeHarness({
    profiles: roster(),
    configureResult: {
      ok: true,
      applied: {},
      confirm_required: true,
      confirm_message: '该模型单价较高，需要确认',
    },
  });
  h.state.activeDetail = detail();
  h.state.activeBotId = 'arch';
  h.state.status = { status: 'idle', activeBotId: 'arch' };
  h.state.drafts = { arch: fullDraft({ model: 'expensive/model', provider: 'p' }) };

  const result = await h.controller.saveBot('arch');
  assert.equal(result.ok, false);
  assert.equal(result.message, '该模型单价较高，需要确认');
  assert.deepEqual(h.state.confirmPending, { message: '该模型单价较高，需要确认' });
  assert.equal(h.state.errorBanner, undefined, '确认不是错误横幅，必须单独呈现');
  assert.equal('arch' in h.state.drafts, true);
  assert.equal(h.calls.some((call) => call.method === 'profiles.set_asset'), false);
});

test('确认后重发：confirmExpensive 必须转成 confirm_expensive_model=true', async () => {
  const h = makeHarness({ profiles: roster() });
  h.state.activeDetail = detail();
  h.state.activeBotId = 'arch';
  h.state.status = { status: 'idle', activeBotId: 'arch' };
  h.state.drafts = { arch: fullDraft({ model: 'expensive/model', provider: 'p' }) };

  await h.controller.saveBot('arch', { confirmExpensive: true });
  const configure = h.calls.find((call) => call.method === 'profiles.configure');
  assert.equal(configure.params.confirm_expensive_model, true);
});

test('能力补全：MCP 探活写入 online/toolCount；探活失败保持未知，不画红灯', async () => {
  const mcpDetail = detail({
    mcpServers: {
      authoritative: true,
      rows: [{ id: 'github', label: 'github', enabled: true, transport: 'stdio' }],
    },
  });
  const ok = makeHarness({
    profiles: roster(),
    describeDetail: mcpDetail,
    mcpStatus: [{ name: 'github', connected: true, tools: 9 }],
  });
  await ok.controller.selectBot('arch', { immediate: true });
  await tick();
  assert.equal(ok.state.activeDetail.mcpServers.rows[0].online, true);
  assert.equal(ok.state.activeDetail.mcpServers.rows[0].toolCount, 9);

  const failed = makeHarness({ profiles: roster(), describeDetail: mcpDetail, mcpStatusError: 'probe down' });
  await failed.controller.selectBot('arch', { immediate: true });
  await tick();
  assert.equal(
    failed.state.activeDetail.mcpServers.rows[0].online,
    undefined,
    '探活失败必须保持 undefined（状态未知），不能画成离线',
  );
});

test('能力补全：技能清单非权威时才拉全局目录，权威清单不得被污染', async () => {
  const nonAuthoritative = makeHarness({
    profiles: roster(),
    describeDetail: detail(),
    skillInventory: ['alpha', 'beta'],
  });
  await nonAuthoritative.controller.selectBot('arch', { immediate: true });
  await tick();
  assert.deepEqual(
    nonAuthoritative.state.activeDetail.skills.rows.map((row) => row.id),
    ['alpha', 'beta'],
  );
  assert.equal(nonAuthoritative.state.activeDetail.skills.authoritative, false);

  const authoritative = makeHarness({
    profiles: roster(),
    describeDetail: detail({
      skills: { authoritative: true, rows: [{ id: 'alpha', label: 'alpha', enabled: true }] },
    }),
    skillInventory: ['alpha', 'beta'],
  });
  await authoritative.controller.selectBot('arch', { immediate: true });
  await tick();
  assert.deepEqual(
    authoritative.state.activeDetail.skills.rows.map((row) => row.id),
    ['alpha'],
    'describe 已给出权威清单时不得合并全局目录',
  );
  assert.equal(
    authoritative.calls.some((call) => call.method === 'skills.manage'),
    false,
    '权威清单不需要额外 RPC',
  );
});
