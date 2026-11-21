/**
 * settingsDataService 扩展运维回调四象限运行时测试（直驱编译产物，100% 覆盖新增路径与分支）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsDataService } from '../../dist/renderer/services/settingsDataService.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

function makeState(overrides = {}) {
  return {
    platform: 'windows',
    theme: 'obsidian-gold',
    lang: 'zh',
    isMaximized: false,
    leftRailCollapsed: false,
    inspectorCollapsed: false,
    activeInspectorTab: 'files',
    activeSessionId: '',
    activeLiveSessionId: '',
    selectedModel: '',
    availableModels: [],
    modelDetails: [],
    modelCatalog: [],
    modelCatalogHash: '',
    currentProvider: '',
    profiles: [
      { name: 'default', displayName: 'Hermes', isDefault: true, hasAvatar: false },
      { name: 'arch', displayName: '架构老王', isDefault: false, hasAvatar: false },
    ],
    profileName: 'alt',
    projects: [],
    groupRooms: [],
    activeFocus: { kind: 'session', id: '' },
    sessionSearchQuery: '',
    isBotsGroupExpanded: true,
    isSessionsGroupExpanded: true,
    isGroupsGroupExpanded: false,
    isMoreSessionsExpanded: false,
    isNewTaskModalOpen: false,
    newTaskModalTab: 'solo',
    modelMenuOpen: false,
    collapsedProviders: [],
    isSettingsOpen: true,
    settingsSection: 'agents',
    settingsScopedProfile: 'other',
    settingsProfiles: { status: 'ready', data: [] },
    settingsProviderViews: { status: 'ready', data: [] },
    settingsProviderFailures: [],
    settingsSubscriptionCatalog: { status: 'ready', data: [] },
    settingsCustomEndpoints: { status: 'ready', data: [] },
    settingsEndpointProfiles: {},
    settingsEndpointFailures: [],
    settingsProviderAdminBusy: false,
    settingsMcp: { status: 'idle' },
    settingsSkills: { status: 'idle' },
    settingsBusy: false,
    botManagementStatus: { status: 'idle', activeBotId: 'arch' },
    botManagementActiveBotId: 'arch',
    botManagementDetail: {
      id: 'arch',
      displayName: '架构老王',
      description: '',
      model: '',
      provider: '',
      soul: '',
      avatar: undefined,
      isDefault: false,
      skills: { authoritative: true, rows: [{ id: 'github', label: 'github', enabled: true }] },
      toolsets: { authoritative: true, rows: [] },
      mcpServers: {
        authoritative: true,
        rows: [
          { id: 'github-mcp', label: 'github-mcp', enabled: true, transport: 'stdio', online: true },
          { id: 'old-mcp', label: 'old-mcp', enabled: true, transport: 'http', online: true },
        ],
      },
    },
    botDrafts: {
      arch: {
        displayName: '架构老王-草稿',
        description: '',
        model: '',
        provider: '',
        isDefault: false,
        soul: '',
        avatar: { kind: 'unchanged' },
        disabledSkills: [],
        enabledToolsets: [],
        enabledMcpServers: ['github-mcp', 'old-mcp'],
      },
    },
    botManagementBusy: false,
    gatewayUrl: 'http://127.0.0.1:9119',
    gatewayUsername: '',
    gatewayHasStoredPassword: false,
    gatewayConnected: true,
    gatewayLatencyMs: 12,
    appVersion: '0.1.0',
    ...overrides,
  };
}

function makeHarness(stateOverrides = {}, responder) {
  const state = makeState(stateOverrides);
  const rpcCalls = [];
  const warnings = [];
  const toasts = [];
  const persistAgentsCalls = [];
  let persistAvatarCacheCalls = 0;
  let clientPresent = stateOverrides.clientPresent !== false;

  const client = {
    request: async (method, params) => {
      rpcCalls.push({ kind: 'request', method, params });
      if (method === 'profiles.describe') {
        const overridden = responder ? await responder(method, params, rpcCalls) : null;
        if (overridden && typeof overridden === 'object' && 'mcp_servers' in overridden) return overridden;
        return {
          name: params.profile,
          display_name: params.profile,
          description: '',
          model: '',
          provider: '',
          soul: '',
          mcp_servers: [{ name: 'github-mcp', enabled: true, transport: 'stdio' }],
        };
      }
      if (responder) return responder(method, params, rpcCalls);
      return {};
    },
    call: async (method, params) => {
      rpcCalls.push({ kind: 'call', method, params });
      if (method === 'mcp.servers.status') return { servers: [] };
      if (method === 'skills.manage') return { skills: { core: ['alpha'] } };
      if (responder) return responder(method, params, rpcCalls);
      return {};
    },
  };

  const profileAvatarCache = new Map();
  const service = createSettingsDataService({
    getState: () => state,
    getGatewayClient: () => (clientPresent ? client : null),
    getCurrentTicket: () => null,
    getEffectiveUrl: (u) => u,
    render: () => {},
    t: (key) => key,
    describeRpcError: (err) => (err instanceof Error ? err.message : String(err)),
    showToast: (msg) => toasts.push(msg),
    bootLog: { warn: (msg, meta) => warnings.push({ msg, meta }) },
    fetchModelOptions: async () => {},
    fetchProfiles: async () => {},
    testConnection: async () => ({ ok: true }),
    connect: async () => {},
    disconnect: () => {},
    getFontPreferences: () => ({ uiFont: 'geist-sans', monoFont: 'jetbrains-mono', sizeScale: 'medium' }),
    setFontPreferences: () => {},
    applyFontPreferences: () => {},
    getActivityIndicatorVariant: () => 'cloud',
    setActivityIndicatorVariant: () => {},
    saveActivityIndicatorVariant: () => {},
    resolveActivityIndicatorVariant: () => 'cloud',
    resolveSkinId: () => 'obsidian-gold',
    writePresenceLayout: () => {},
    onPresenceLayoutChanged: () => {},
    profileAvatarCache,
    persistAvatarCache: () => {
      persistAvatarCacheCalls += 1;
      responder?.('__persist_avatar_hook__', {
        settingsProfiles: state.settingsProfiles.status === 'ready' ? state.settingsProfiles.data.map((r) => ({ ...r })) : null,
      }, rpcCalls);
    },
    persistAgentsToCache: (profiles) => {
      persistAgentsCalls.push(profiles.map((p) => ({ name: p.name, avatar: p.avatar, hasAvatar: p.hasAvatar })));
    },
  });

  const actions = service.createSettingsActions();
  return {
    state,
    rpcCalls,
    warnings,
    toasts,
    actions,
    service,
    profileAvatarCache,
    persistAgentsCalls,
    getPersistAvatarCacheCalls: () => persistAvatarCacheCalls,
    setClientPresent: (next) => {
      clientPresent = next;
    },
  };
}

test('onFetchMcpCatalog：覆盖断连、profile 三级回退、目录归一化与异常返回', async () => {
  const h = makeHarness({}, async () => ({
    servers: [{ name: 'github', description: 'GitHub', transport: 'http', requires: ['TOKEN'] }],
  }));

  h.setClientPresent(false);
  assert.deepEqual(await h.actions.onFetchMcpCatalog('arch'), {
    ok: false,
    items: [],
    message: 'settings.notConnected',
  });

  h.setClientPresent(true);
  h.state.gatewayConnected = false;
  assert.deepEqual(await h.actions.onFetchMcpCatalog('arch'), {
    ok: false,
    items: [],
    message: 'settings.notConnected',
  });

  h.state.gatewayConnected = true;
  const explicit = await h.actions.onFetchMcpCatalog('arch');
  assert.equal(explicit.ok, true);
  assert.equal(explicit.items[0].name, 'github');
  assert.deepEqual(h.rpcCalls.at(-1).params, { profile: 'arch' });

  // 空 profile 不应漂移到 scopedProfile('other')，须使用 state.profileName 或 'default'
  await h.actions.onFetchMcpCatalog('');
  assert.deepEqual(h.rpcCalls.at(-1).params, { profile: 'alt' });
  h.state.profileName = '';
  await h.actions.onFetchMcpCatalog('');
  assert.deepEqual(h.rpcCalls.at(-1).params, { profile: 'default' });

  const failing = makeHarness({}, async () => {
    throw new Error('catalog-timeout');
  });
  assert.deepEqual(await failing.actions.onFetchMcpCatalog('arch'), {
    ok: false,
    items: [],
    message: 'catalog-timeout',
  });
});

test('onAddMcpServer：覆盖断连、参数拼装、ok:false 畸形拒收、双控制器按需刷新与异常', async () => {
  const offline = makeHarness({ clientPresent: false });
  assert.deepEqual(await offline.actions.onAddMcpServer('arch', { name: 'gh', preset: 'github' }), {
    ok: false,
    message: 'settings.notConnected',
  });
  offline.setClientPresent(true);
  offline.state.gatewayConnected = false;
  assert.deepEqual(await offline.actions.onAddMcpServer('arch', { name: 'gh', preset: 'github' }), {
    ok: false,
    message: 'settings.notConnected',
  });

  // 网关明确返回 ok:false 必须拒收
  const rejected = makeHarness({}, async () => ({ ok: false }));
  assert.deepEqual(await rejected.actions.onAddMcpServer('arch', { name: 'gh', preset: 'github' }), {
    ok: false,
    message: 'settings.malformedResponse',
  });

  // 成功分支（扩展面板未就绪时不发 loadExtensions）+ result 缺 name 时回落 params.name + 已有草稿合并新增 MCP
  const okQuiet = makeHarness({}, async (method) => {
    if (method === 'profiles.describe') {
      return {
        name: 'arch',
        display_name: '架构老王',
        description: '',
        model: '',
        provider: '',
        soul: '',
        mcp_servers: [
          { name: 'github-mcp', enabled: true, transport: 'stdio' },
          { name: 'old-mcp', enabled: true, transport: 'http' },
          { name: 'fs-custom', enabled: true, transport: 'stdio' },
        ],
      };
    }
    return { ok: true };
  });
  const r1 = await okQuiet.actions.onAddMcpServer('arch', {
    name: 'fs-custom',
    config: { command: 'npx', args: ['-y', 'fs'] },
    bearer_token: 'tok',
  });
  await tick();
  assert.deepEqual(r1, { ok: true, name: 'fs-custom' });
  assert.deepEqual(okQuiet.state.botDrafts.arch.enabledMcpServers, ['github-mcp', 'old-mcp', 'fs-custom']);
  const addCall = okQuiet.rpcCalls.find((c) => c.method === 'mcp.servers.add');
  assert.deepEqual(addCall.params, {
    profile: 'arch',
    name: 'fs-custom',
    config: { command: 'npx', args: ['-y', 'fs'] },
    bearer_token: 'tok',
  });
  assert.ok(okQuiet.rpcCalls.some((c) => c.method === 'profiles.describe'));
  assert.equal(okQuiet.rpcCalls.some((c) => c.kind === 'call' && c.method === 'mcp.servers.status'), false);

  // extensions 面板处于 ready/当前激活时，同时刷新 loadExtensions，且保留服务端返回 name；空 profile fallback
  const okWithExt = makeHarness(
    { settingsMcp: { status: 'ready', data: [] }, profileName: '' },
    async () => ({ name: 'server-alias' }),
  );
  const r2 = await okWithExt.actions.onAddMcpServer('', { name: 'gh', preset: 'github' });
  await tick();
  assert.deepEqual(r2, { ok: true, name: 'server-alias' });
  assert.ok(okWithExt.rpcCalls.some((c) => c.kind === 'call' && c.method === 'mcp.servers.status'));

  const okWithSection = makeHarness({ settingsSection: 'extensions' }, async () => undefined);
  assert.deepEqual(await okWithSection.actions.onAddMcpServer('arch', { name: 'gh', preset: 'github' }), {
    ok: true,
    name: 'gh',
  });
  assert.ok(okWithSection.rpcCalls.some((c) => c.kind === 'call' && c.method === 'mcp.servers.status'));

  const throwing = makeHarness({}, async () => {
    throw new Error('add-failed-4000');
  });
  assert.deepEqual(await throwing.actions.onAddMcpServer('arch', { name: 'gh', preset: 'github' }), {
    ok: false,
    message: 'add-failed-4000',
  });
});

test('onRemoveMcpServer：覆盖断连、ok:false、removedMcpName 草稿剔除与扩展同步', async () => {
  const offline = makeHarness({ clientPresent: false });
  assert.deepEqual(await offline.actions.onRemoveMcpServer('arch', 'old-mcp'), {
    ok: false,
    message: 'settings.notConnected',
  });
  offline.setClientPresent(true);
  offline.state.gatewayConnected = false;
  assert.deepEqual(await offline.actions.onRemoveMcpServer('arch', 'old-mcp'), {
    ok: false,
    message: 'settings.notConnected',
  });

  const malformed = makeHarness({}, async () => ({ ok: false }));
  assert.deepEqual(await malformed.actions.onRemoveMcpServer('arch', 'old-mcp'), {
    ok: false,
    message: 'settings.malformedResponse',
  });

  // 从 arch 草稿移除 old-mcp 并同步扩展（settingsSection=extensions 分支）
  const h = makeHarness({ settingsSection: 'extensions' }, async () => ({ ok: true }));
  assert.deepEqual(await h.actions.onRemoveMcpServer('arch', 'old-mcp'), { ok: true });
  await tick();
  assert.deepEqual(h.state.botDrafts.arch.enabledMcpServers, ['github-mcp']);
  assert.ok(h.rpcCalls.some((c) => c.kind === 'call' && c.method === 'mcp.servers.status'));

  // settingsMcp ready 分支与未就绪静默分支 + 空 profile 回落
  const readyOnly = makeHarness({ settingsMcp: { status: 'ready', data: [] }, profileName: '' }, async () => null);
  assert.deepEqual(await readyOnly.actions.onRemoveMcpServer('', 'old-mcp'), { ok: true });
  assert.ok(readyOnly.rpcCalls.some((c) => c.kind === 'call' && c.method === 'mcp.servers.status'));

  const quiet = makeHarness({}, async () => ({ ok: true }));
  assert.deepEqual(await quiet.actions.onRemoveMcpServer('arch', 'old-mcp'), { ok: true });
  assert.equal(quiet.rpcCalls.some((c) => c.kind === 'call' && c.method === 'mcp.servers.status'), false);

  const errHarness = makeHarness({}, async () => {
    throw new Error('remove-denied');
  });
  assert.deepEqual(await errHarness.actions.onRemoveMcpServer('arch', 'old-mcp'), {
    ok: false,
    message: 'remove-denied',
  });
});

test('onTestMcpServer：覆盖断连、归一化探活结果、profile 回退与 RPC 异常', async () => {
  const offline = makeHarness({ clientPresent: false });
  assert.deepEqual(await offline.actions.onTestMcpServer('arch', 'github-mcp'), {
    ok: false,
    tools: [],
    oauthNeeded: false,
    error: 'settings.notConnected',
  });
  offline.setClientPresent(true);
  offline.state.gatewayConnected = false;
  assert.deepEqual(await offline.actions.onTestMcpServer('arch', 'github-mcp'), {
    ok: false,
    tools: [],
    oauthNeeded: false,
    error: 'settings.notConnected',
  });

  const h = makeHarness({ profileName: '' }, async () => ({
    ok: true,
    tools: [{ name: 'search', description: 'Search code' }],
    oauth_needed: true,
  }));
  const res = await h.actions.onTestMcpServer('', 'github-mcp');
  assert.equal(res.ok, true);
  assert.equal(res.oauthNeeded, true);
  assert.equal(res.tools.length, 1);
  assert.deepEqual(h.rpcCalls.at(-1).params, { profile: 'default', name: 'github-mcp' });

  const throwing = makeHarness({}, async () => {
    throw new Error('probe-hang');
  });
  assert.deepEqual(await throwing.actions.onTestMcpServer('arch', 'github-mcp'), {
    ok: false,
    tools: [],
    oauthNeeded: false,
    error: 'probe-hang',
  });
});

test('onSearchSkillsHub：覆盖断连、browse/search 分流、bot/extensions 已装交集与异常', async () => {
  const offline = makeHarness({ clientPresent: false });
  assert.deepEqual(await offline.actions.onSearchSkillsHub('arch', ''), {
    ok: false,
    message: 'settings.notConnected',
  });
  offline.setClientPresent(true);
  offline.state.gatewayConnected = false;
  assert.deepEqual(await offline.actions.onSearchSkillsHub('arch', ''), {
    ok: false,
    message: 'settings.notConnected',
  });

  // 空/空白 query 走 browse，合并匹配 BOT 的 skills 与已就绪全局 settingsSkills
  const h = makeHarness(
    {
      settingsSkills: { status: 'ready', data: [{ name: 'local-ext', description: '', source: 'local' }] },
      profileName: '',
    },
    async () => ({
      items: [
        { name: 'github', description: 'bot-installed' },
        { name: 'local-ext', description: 'global-installed' },
        { name: 'fresh', description: 'available' },
      ],
      page: 1,
      total_pages: 1,
      total: 3,
    }),
  );
  const browse = await h.actions.onSearchSkillsHub('arch', '   ');
  assert.equal(browse.ok, true);
  assert.equal(h.rpcCalls.at(-1).params.action, 'browse');
  assert.deepEqual(
    browse.data.rows.map((r) => [r.name, r.installed]),
    [
      ['github', true],
      ['local-ext', true],
      ['fresh', false],
    ],
  );

  // 非空 query 走 search，且当 detail.id 与 targetProfile 不匹配或不存在时，不得错误标记安装
  h.state.botManagementDetail = undefined;
  h.state.settingsSkills = { status: 'idle' };
  const search = await h.actions.onSearchSkillsHub('', '  docker  ', 2);
  assert.equal(search.ok, true);
  assert.equal(h.rpcCalls.at(-1).params.action, 'search');
  assert.equal(h.rpcCalls.at(-1).params.query, 'docker');
  assert.equal(h.rpcCalls.at(-1).params.page, 2);
  assert.equal(h.rpcCalls.at(-1).params.profile, 'default');
  assert.equal(search.data.rows[0].installed, false);

  const failing = makeHarness({}, async () => {
    throw new Error('hub-503');
  });
  assert.deepEqual(await failing.actions.onSearchSkillsHub('arch', 'x'), {
    ok: false,
    message: 'hub-503',
  });
});

test('onInstallSkill：覆盖断连、installed:false 拒收、skills.reload 成功/降级日志与双端刷新', async () => {
  const offline = makeHarness({ clientPresent: false });
  assert.deepEqual(await offline.actions.onInstallSkill('arch', 'org/sk'), {
    ok: false,
    message: 'settings.notConnected',
  });
  offline.setClientPresent(true);
  offline.state.gatewayConnected = false;
  assert.deepEqual(await offline.actions.onInstallSkill('arch', 'org/sk'), {
    ok: false,
    message: 'settings.notConnected',
  });

  const rejected = makeHarness({}, async () => ({ installed: false }));
  assert.deepEqual(await rejected.actions.onInstallSkill('arch', 'org/sk'), {
    ok: false,
    message: 'settings.malformedResponse',
  });

  // install 成功且 reload 成功，extensions 未激活时不额外加载 loadExtensions
  const okQuiet = makeHarness({}, async (method) => {
    if (method === 'skills.manage') return { installed: true };
    return {};
  });
  assert.deepEqual(await okQuiet.actions.onInstallSkill('arch', 'org/sk'), { ok: true });
  await tick();
  assert.ok(okQuiet.rpcCalls.some((c) => c.method === 'skills.reload'));
  assert.ok(okQuiet.rpcCalls.some((c) => c.method === 'profiles.describe'));
  assert.equal(okQuiet.rpcCalls.some((c) => c.kind === 'call' && c.method === 'mcp.servers.status'), false);
  assert.equal(okQuiet.warnings.length, 0);

  // reload 失败不得推翻安装结局，必须记 bootLog.warn 并继续刷新控制器与扩展页
  const degraded = makeHarness(
    { settingsSkills: { status: 'ready', data: [] }, profileName: '' },
    async (method) => {
      if (method === 'skills.reload') throw new Error('reload-timeout');
      return null;
    },
  );
  assert.deepEqual(await degraded.actions.onInstallSkill('', 'org/sk'), { ok: true });
  await tick();
  assert.equal(degraded.warnings.length, 1);
  assert.equal(degraded.warnings[0].msg, 'skills.reload after install failed');
  assert.equal(degraded.warnings[0].meta.profile, 'default');
  assert.ok(degraded.rpcCalls.some((c) => c.kind === 'call' && c.method === 'mcp.servers.status'));

  const extActive = makeHarness({ settingsSection: 'extensions' }, async () => ({ installed: true }));
  assert.deepEqual(await extActive.actions.onInstallSkill('arch', 'org/sk'), { ok: true });
  assert.ok(extActive.rpcCalls.some((c) => c.kind === 'call' && c.method === 'mcp.servers.status'));

  const fatal = makeHarness({}, async () => {
    throw new Error('install-failed');
  });
  assert.deepEqual(await fatal.actions.onInstallSkill('arch', 'org/sk'), {
    ok: false,
    message: 'install-failed',
  });
});

test('BOT 头像同源与清除闭环：实测 onSaveBotConfig(replace/clear)、6 分支解析、selectBot 直落与缓存不复活', async () => {
  const portraitA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const portraitB = 'data:image/png;base64,FRESH_PORTRAIT_B';
  const persistedSettingsAvatars = [];

  const h = makeHarness(
    {
      profileName: 'default',
      profiles: [
        { name: 'default', displayName: 'ProfileAlias', isDefault: true, hasAvatar: false },
        { name: 'MixedCaseBot', displayName: 'CaseDisplay', isDefault: false, hasAvatar: false },
      ],
      settingsProfiles: {
        status: 'ready',
        data: [
          { name: 'default', displayName: 'SettingsAlias', isDefault: true, hasAvatar: false },
          { name: 'MixedCaseBot', displayName: 'CaseDisplay', isDefault: false, hasAvatar: false },
        ],
      },
      sessions: [{ id: 's1', botName: 'default', botDisplayName: '大总管', botAvatar: undefined }],
      botManagementActiveBotId: 'default',
      botDrafts: {},
      botManagementDetail: {
        id: 'default',
        displayName: 'DetailAlias',
        description: '',
        model: '',
        provider: '',
        soul: '',
        avatar: undefined,
        isDefault: true,
        skills: { authoritative: true, rows: [] },
        toolsets: { authoritative: true, rows: [] },
        mcpServers: { authoritative: true, rows: [] },
      },
    },
    async (method, params) => {
      if (method === '__persist_avatar_hook__') {
        persistedSettingsAvatars.push(params.settingsProfiles?.find((r) => r.name === 'default')?.avatar);
        return null;
      }
      if (method === 'profiles.set_asset') return { ok: true };
      if (method === 'profiles.list') {
        return {
          profiles: [{ name: 'default', display_name: 'SettingsAlias', is_default: true, has_avatar: false }],
        };
      }
      if (method === 'profiles.describe') {
        return {
          name: params.profile,
          description: '',
          model: '',
          provider: '',
          soul: '',
          skills: [],
          toolsets: [],
          mcp_servers: [],
        };
      }
      return {};
    },
  );

  // 1. 真实驱动 onSaveBotConfig (replace)：校验 4 个 cache key、state.profiles、settingsProfiles、sessions、botManagementDetail 与双 persist 钩子
  h.actions.onBotDraftChange('default', { avatar: { kind: 'replace', dataUrl: portraitA } });
  const replaceSave = await h.actions.onSaveBotConfig('default');
  assert.equal(replaceSave.ok, true);
  assert.equal(h.profileAvatarCache.get('default'), portraitA);
  assert.equal(h.profileAvatarCache.get('profilealias'), portraitA);
  assert.equal(h.profileAvatarCache.get('settingsalias'), portraitA);
  assert.equal(h.profileAvatarCache.get('detailalias'), portraitA);
  assert.equal(h.state.profiles[0].avatar, portraitA);
  assert.equal(h.state.profiles[0].hasAvatar, true);
  assert.equal(h.state.sessions[0].botAvatar, portraitA);
  assert.equal(h.state.botManagementDetail.avatar, portraitA);
  assert.equal(persistedSettingsAvatars.at(-1), portraitA);
  assert.ok(h.getPersistAvatarCacheCalls() >= 1);
  assert.equal(h.persistAgentsCalls.at(-1)[0].avatar, portraitA);

  // 2. 真实驱动 onSaveBotConfig (clear)：必须同时删去 4 个 cache key，清空 state.profiles / sessions / detail 并写入 persistAgentsToCache
  await tick();
  h.state.botManagementDetail = { ...h.state.botManagementDetail, displayName: 'DetailAlias', avatar: portraitA };
  h.state.settingsProfiles = {
    status: 'ready',
    data: [{ name: 'default', displayName: 'SettingsAlias', isDefault: true, hasAvatar: true, avatar: portraitA }],
  };
  h.actions.onBotDraftChange('default', { avatar: { kind: 'clear' } });
  const clearSave = await h.actions.onSaveBotConfig('default');
  assert.equal(clearSave.ok, true);
  assert.equal(h.profileAvatarCache.has('default'), false);
  assert.equal(h.profileAvatarCache.has('profilealias'), false);
  assert.equal(h.profileAvatarCache.has('settingsalias'), false);
  assert.equal(h.profileAvatarCache.has('detailalias'), false);
  assert.equal(h.state.profiles[0].avatar, undefined);
  assert.equal(h.state.profiles[0].hasAvatar, false);
  assert.equal(h.state.sessions[0].botAvatar, undefined);
  assert.equal(h.state.botManagementDetail.avatar, undefined);
  assert.equal(persistedSettingsAvatars.at(-1), undefined);
  assert.equal(h.persistAgentsCalls.at(-1)[0].avatar, undefined);

  // 3. 覆盖 getBotManagementSnapshot 头像优先级：resolveProfileAvatar 更新鲜时必须覆盖陈旧 botManagementDetail.avatar
  await tick();
  h.state.botManagementDetail = { ...h.state.botManagementDetail, id: 'default', avatar: 'data:image/png;base64,STALE' };
  h.profileAvatarCache.set('default', portraitB);
  const freshSnap = h.service.getBotManagementSnapshot();
  assert.equal(freshSnap.roster[0].avatar, portraitB);
  assert.equal(freshSnap.activeDetail?.avatar, portraitB);

  // 4. selectBot 后直接断言 h.state.botManagementDetail.avatar（不经过 snapshot 遮掩）
  h.service.getBotManagementController().selectBot('default', { immediate: true });
  await tick();
  assert.equal(h.state.botManagementDetail.avatar, portraitB);

  // 5. 全覆盖 resolveProfileAvatar / roster 的其它分支（大小写 ID 缓存命中、profileRow displayName 缓存命中、settingsRow 与 settingsProfiles 非 ready）
  h.profileAvatarCache.clear();
  h.profileAvatarCache.set('mixedcasebot', portraitA);
  h.service.getBotManagementController().selectBot('MixedCaseBot', { immediate: true });
  await tick();
  assert.equal(h.state.botManagementDetail.avatar, portraitA);

  h.profileAvatarCache.clear();
  h.state.settingsProfiles = { status: 'loading' };
  h.profileAvatarCache.set('casedisplay', portraitB);
  h.service.getBotManagementController().selectBot('MixedCaseBot', { immediate: true });
  await tick();
  assert.equal(h.state.botManagementDetail.avatar, portraitB);

  // 6. 补齐 resolveProfileAvatar / onAvatarChanged / getBotManagementSnapshot 其余分支：
  //    settingsRow.avatar 直接命中、profileRow.avatar 直接命中、无 displayName / 空 botId 回落 undefined、settingsProfiles 非 ready 保存、undefined activeDetail
  const h2 = makeHarness(
    {
      profileName: 'direct-settings',
      profiles: [
        { name: 'direct-settings', displayName: '', isDefault: true, hasAvatar: true },
        { name: 'direct-profile', displayName: '', isDefault: false, hasAvatar: true, avatar: portraitB },
        { name: 'no-display', displayName: '', isDefault: false, hasAvatar: false },
      ],
      settingsProfiles: {
        status: 'ready',
        data: [
          { name: '', displayName: 'EmptyId', isDefault: false, hasAvatar: false },
          { name: 'direct-settings', displayName: 'DirectSettings', isDefault: true, hasAvatar: true, avatar: portraitA },
        ],
      },
      botManagementActiveBotId: 'direct-settings',
      botDrafts: {},
      sessions: [{ id: 's-other', botName: 'other', botAvatar: undefined }],
      botManagementDetail: undefined,
    },
    async (method, params) => {
      if (method === 'profiles.set_asset') return { ok: true };
      if (method === 'profiles.list') return { profiles: [{ name: 'direct-settings', is_default: true, has_avatar: true }] };
      if (method === 'profiles.describe') {
        return { name: params.profile, description: '', model: '', provider: '', soul: '', skills: [], toolsets: [], mcp_servers: [] };
      }
      return {};
    },
  );
  const emptyDetailSnap = h2.service.getBotManagementSnapshot();
  assert.equal(emptyDetailSnap.activeDetail, undefined);
  assert.equal(emptyDetailSnap.roster[0].avatar, undefined);
  assert.equal(emptyDetailSnap.roster[1].avatar, portraitA);

  h2.state.settingsProfiles = { status: 'loading' };
  h2.state.botManagementDetail = {
    id: 'direct-profile',
    displayName: '',
    description: '',
    model: '',
    provider: '',
    soul: '',
    avatar: undefined,
    isDefault: false,
    skills: { authoritative: true, rows: [] },
    toolsets: { authoritative: true, rows: [] },
    mcpServers: { authoritative: true, rows: [] },
  };
  h2.state.botManagementActiveBotId = 'direct-profile';
  assert.equal(h2.service.getBotManagementSnapshot().activeDetail?.avatar, portraitB);
  // 保存无 displayName 的 BOT（settingsProfiles 非 ready）覆蓋 !rawKey 与 status!=='ready' 分支
  h2.actions.onBotDraftChange('direct-profile', { avatar: { kind: 'replace', dataUrl: portraitA } });
  const nonReadySave = await h2.actions.onSaveBotConfig('direct-profile');
  assert.equal(nonReadySave.ok, true);
  assert.equal(h2.profileAvatarCache.get('direct-profile'), portraitA);
  // 无 displayName 且无头像缓存时返回 undefined
  h2.state.botManagementDetail = { ...h2.state.botManagementDetail, id: 'no-display', displayName: '', avatar: undefined };
  h2.state.botManagementActiveBotId = 'no-display';
  assert.equal(h2.service.getBotManagementSnapshot().activeDetail?.avatar, undefined);
});

test('complete.slash 技能简介补全与 onInspectSkill 详情读取四象限', async () => {
  const h = makeHarness(
    { profileName: 'default' },
    async (method, params) => {
      if (method === 'profiles.describe') {
        return {
          name: params.profile,
          description: '',
          model: '',
          provider: '',
          soul: '',
          skills: [
            { name: 'github', enabled: true },
            { name: 'empty-desc', enabled: false },
          ],
          toolsets: [],
          mcp_servers: [],
        };
      }
      if (method === 'complete.slash') {
        return {
          items: [
            { text: '/github', meta: 'PR & Issue automation', kind: 'skill' },
            { text: '/help', meta: 'Show help', kind: 'command' },
            { text: '/empty-desc', meta: '   ', kind: 'skill' },
          ],
        };
      }
      if (method === 'skills.manage' && params.action === 'inspect') {
        if (params.query === 'broken') throw new Error('inspect-404');
        if (params.query === 'dispatch-only') throw new Error('no-hub-inspect');
        if (params.query === 'preview-only') {
          return { info: { name: 'preview-only', source: 'hub', skill_md_preview: '## Preview Spec' } };
        }
        return {
          info: {
            name: 'github',
            source: 'official',
            tags: ['git'],
            skill_md_preview: '## Short',
          },
        };
      }
      if (method === 'command.dispatch') {
        if (params.name === 'broken') throw new Error('dispatch-404');
        if (params.name === 'preview-only') throw new Error('not-local');
        if (params.name === 'dispatch-only') {
          return { type: 'skill', name: 'dispatch-only', message: '# Dispatch Only Spec' };
        }
        return { type: 'skill', name: 'github', message: '---\ndescription: GitHub Skill\n---\n\n# GitHub\nFull body text' };
      }
      return {};
    },
  );

  // 1. selectBot 自动触发 complete.slash 并只填充 kind==='skill' 且非空的 meta
  h.service.getBotManagementController().selectBot('arch', { immediate: true });
  await tick();
  assert.deepEqual(
    h.state.botManagementDetail.skills.rows.map((r) => [r.id, r.description]),
    [
      ['github', 'PR & Issue automation'],
      ['empty-desc', undefined],
    ],
  );

  // 2. complete.slash 报错时优雅降级，不阻塞 BOT 详情
  const slashErr = makeHarness({}, async (method) => {
    if (method === 'complete.slash') throw new Error('slash-down');
    if (method === 'profiles.describe') {
      return { name: 'arch', skills: [{ name: 'github', enabled: true }], toolsets: [], mcp_servers: [] };
    }
    return {};
  });
  slashErr.service.getBotManagementController().selectBot('arch', { immediate: true });
  await tick();
  assert.equal(slashErr.state.botManagementDetail.skills.rows.length, 1);
  assert.equal(slashErr.state.botManagementDetail.skills.rows[0].description, undefined);

  // 3. onInspectSkill 断连与空白名拦截
  h.setClientPresent(false);
  assert.deepEqual(await h.actions.onInspectSkill('arch', 'github'), {
    ok: false,
    message: 'settings.notConnected',
  });
  h.setClientPresent(true);
  assert.deepEqual(await h.actions.onInspectSkill('arch', '   '), {
    ok: false,
    message: 'settings.malformedResponse',
  });

  // 4. onInspectSkill：inspect + dispatch 合并，dispatch 完整正文覆盖短预览；空 profile 回落 default
  const rich = await h.actions.onInspectSkill('', 'github');
  assert.equal(rich.ok, true);
  assert.equal(rich.data.isPreview, false);
  assert.equal(rich.data.source, 'official');
  assert.equal(rich.data.description, 'GitHub Skill');
  assert.ok(rich.data.markdown.includes('# GitHub'));

  // 5. dispatch 失败但 inspect 返回 skill_md_preview 时仍成功返回预览
  const preview = await h.actions.onInspectSkill('arch', 'preview-only', 'Fallback Desc');
  assert.equal(preview.ok, true);
  assert.equal(preview.data.isPreview, true);
  assert.equal(preview.data.description, 'Fallback Desc');

  // 6. 两条全部失败时显式失败
  const bothFail = await h.actions.onInspectSkill('arch', 'broken');
  assert.deepEqual(bothFail, { ok: false, message: 'inspect-404' });

  // 7. 空 profile 与空 state.profileName 回落 'default'，且仅 command.dispatch 成功时仍返回完整正文
  h.state.profileName = '';
  const dispatchOnly = await h.actions.onInspectSkill('', 'dispatch-only');
  assert.equal(dispatchOnly.ok, true);
  assert.equal(dispatchOnly.data.isPreview, false);
  assert.equal(dispatchOnly.data.markdown, '# Dispatch Only Spec');
  const lastDispatchCall = h.rpcCalls.filter((c) => c.method === 'command.dispatch').at(-1);
  assert.equal(lastDispatchCall.params.profile, 'default');

  // 8. complete.slash 返回无有效 skill 描述（count === 0）与中途断连均优雅返回 null
  const noSkillDesc = makeHarness({}, async (method) => {
    if (method === 'profiles.describe') {
      return { name: 'arch', skills: [{ name: 'github', enabled: true }], toolsets: [], mcp_servers: [] };
    }
    if (method === 'complete.slash') {
      return { items: [{ text: '/help', meta: 'Help', kind: 'command' }] };
    }
    return {};
  });
  noSkillDesc.service.getBotManagementController().selectBot('arch', { immediate: true });
  await tick();
  assert.equal(noSkillDesc.state.botManagementDetail.skills.rows[0].description, undefined);

  const clientDropped = makeHarness({}, async (method) => {
    if (method === 'profiles.describe') {
      clientDropped.setClientPresent(false);
      return { name: 'arch', skills: [{ name: 'github', enabled: true }], toolsets: [], mcp_servers: [] };
    }
    return {};
  });
  clientDropped.service.getBotManagementController().selectBot('arch', { immediate: true });
  await tick();
  assert.equal(clientDropped.state.botManagementDetail.skills.rows[0].description, undefined);
});
