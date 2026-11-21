/**
 * 设置中心业务装配与数据服务（Settings Data Service · D14）纯逻辑单测
 * (packages/desktop/__tests__/unit/settingsDataService.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsDataService } from '../../dist/renderer/services/settingsDataService.mjs';
import { setLocale } from '@hermes-flux/ui';

function createMockSettingsDeps(overrides = {}) {
  let renderCount = 0;
  const state = {
    isSettingsOpen: false,
    settingsSection: 'general',
    theme: 'dark-default',
    lang: 'zh',
    profiles: [
      { name: 'bot-1', displayName: 'Bot Alpha', avatar: 'data:image/avatar1', isDefault: true },
    ],
    profileName: 'bot-1',
    settingsScopedProfile: '',
    settingsProfiles: { status: 'idle' },
    settingsProviderViews: { status: 'idle' },
    settingsProviderFailures: [],
    settingsSubscriptionCatalog: { status: 'idle' },
    settingsCustomEndpoints: { status: 'idle' },
    settingsEndpointProfiles: {},
    settingsEndpointFailures: [],
    settingsProviderAdminBusy: false,
    settingsMcp: { status: 'idle' },
    settingsSkills: { status: 'idle' },
    settingsBusy: false,
    botManagementStatus: { status: 'uninitialized' },
    botManagementActiveBotId: 'bot-1',
    botManagementDetail: null,
    botDrafts: {},
    botManagementError: null,
    botManagementConfirm: null,
    botManagementBusy: false,
    gatewayUrl: 'http://127.0.0.1:8080',
    username: 'admin',
    password: '',
    gatewayConnected: true,
    gatewayConnecting: false,
    gatewayLatencyMs: 5,
    testStatus: null,
    appVersion: '1.0.0',
    platform: 'desktop',
    presenceLayout: 'dock',
    conversationWidth: 'wide',
    confirmModal: null,
    ...(overrides.state || {}),
  };

  const gatewayClient = overrides.gatewayClient ?? {
    call: async (method) => {
      if (method === 'profiles.list') return { profiles: [] };
      return null;
    },
    request: async () => null,
  };

  return {
    getState: () => state,
    getGatewayClient: () => gatewayClient,
    getDesktopApi: () => undefined,
    getCurrentTicket: () => 'test-ticket',
    getEffectiveUrl: (url) => url,
    render: () => { renderCount++; },
    getRenderCount: () => renderCount,
    t: (key, params) => `${key}:${JSON.stringify(params ?? {})}`,
    describeRpcError: (err) => String(err),
    showToast: () => {},
    bootLog: { warn: () => {} },
    fetchModelOptions: async () => {},
    fetchProfiles: async () => {},
    testConnection: async () => ({ ok: true, latency: 10 }),
    connect: async () => {},
    disconnect: () => {},
    getFontPreferences: () => ({ fontFamily: 'sans-serif', fontSize: 14 }),
    setFontPreferences: () => {},
    applyFontPreferences: () => {},
    getActivityIndicatorVariant: () => 'pulse',
    setActivityIndicatorVariant: () => {},
    saveActivityIndicatorVariant: () => {},
    resolveActivityIndicatorVariant: (v) => v,
    resolveSkinId: (theme) => theme,
    writePresenceLayout: () => {},
    onPresenceLayoutChanged: () => {},
    profileAvatarCache: new Map(),
    persistAvatarCache: () => {},
  };
}

test('settingsDataService: botRoster and scopedProfileName derivation', () => {
  const deps = createMockSettingsDeps();
  const service = createSettingsDataService(deps);

  const roster = service.botRoster();
  assert.equal(roster.length, 1);
  assert.equal(roster[0].profile, 'bot-1');
  assert.equal(roster[0].displayName, 'Bot Alpha');

  assert.equal(service.scopedProfileName(), 'bot-1');
  assert.equal(service.subscriptionProfileName(), 'bot-1');
});

test('settingsDataService: openBotSettings opens settings and switches to agents section', () => {
  const deps = createMockSettingsDeps();
  const service = createSettingsDataService(deps);

  service.openBotSettings('bot-1');

  const state = deps.getState();
  assert.equal(state.isSettingsOpen, true);
  assert.equal(state.settingsSection, 'agents');
  assert.equal(state.botManagementActiveBotId, 'bot-1');
  assert.equal(deps.getRenderCount() > 0, true);
});

test('settingsDataService: getSettingsSnapshot constructs snapshot with active state', () => {
  const deps = createMockSettingsDeps();
  const service = createSettingsDataService(deps);

  const snapshot = service.getSettingsSnapshot();
  assert.equal(snapshot.gateway.url, 'http://127.0.0.1:8080');
  assert.equal(snapshot.gateway.status, 'connected');
  assert.equal(snapshot.locale, 'zh');
  assert.equal(snapshot.conversationWidth, 'wide');
  assert.equal(snapshot.bots.length, 1);
});

test('settingsDataService: onConversationWidthChange updates state, snapshot and triggers render', () => {
  const deps = createMockSettingsDeps();
  const service = createSettingsDataService(deps);
  const actions = service.createSettingsActions();

  actions.onConversationWidthChange('full');
  assert.equal(deps.getState().conversationWidth, 'full');
  assert.equal(service.getSettingsSnapshot().conversationWidth, 'full');
  assert.equal(deps.getRenderCount(), 1);

  actions.onConversationWidthChange('narrow');
  assert.equal(deps.getState().conversationWidth, 'narrow');
  assert.equal(service.getSettingsSnapshot().conversationWidth, 'narrow');
  assert.equal(deps.getRenderCount(), 2);
});

test('settingsDataService: onConversationWidthChange 持久化偏好并写入根节点宽度契约', () => {
  // 【杀伤力】删掉 saveConversationWidthMode 或 applyConversationWidthMode 调用，
  // writes / data-chat-layout / --chat-column-max 三条断言会立刻变红。
  const hadStorage = 'localStorage' in globalThis;
  const savedStorage = globalThis.localStorage;
  const hadDocument = 'document' in globalThis;
  const savedDocument = globalThis.document;
  try {
    const writes = [];
    globalThis.localStorage = {
      getItem: () => null,
      setItem: (key, value) => { writes.push([key, value]); },
    };
    const attrs = new Map();
    const props = new Map();
    globalThis.document = {
      documentElement: {
        setAttribute: (name, value) => { attrs.set(name, value); },
        style: { setProperty: (name, value) => { props.set(name, value); } },
      },
    };

    const deps = createMockSettingsDeps();
    const service = createSettingsDataService(deps);
    const actions = service.createSettingsActions();

    actions.onConversationWidthChange('narrow');
    assert.deepEqual(writes, [['hermes_flux_conversation_width', 'narrow']]);
    assert.equal(attrs.get('data-chat-layout'), 'narrow');
    assert.equal(props.get('--chat-column-max'), '48rem');
    assert.equal(deps.getState().conversationWidth, 'narrow');

    actions.onConversationWidthChange('full');
    assert.deepEqual(writes.at(-1), ['hermes_flux_conversation_width', 'full']);
    assert.equal(attrs.get('data-chat-layout'), 'full');
    assert.equal(props.get('--chat-column-max'), '100%');

    actions.onConversationWidthChange('bogus-width');
    assert.deepEqual(writes.at(-1), ['hermes_flux_conversation_width', 'wide'], '非法值必须收敛为 wide 后持久化');
    assert.equal(attrs.get('data-chat-layout'), 'wide');
    assert.equal(props.get('--chat-column-max'), '72rem');
    assert.equal(deps.getState().conversationWidth, 'wide');
  } finally {
    if (hadStorage) globalThis.localStorage = savedStorage;
    else delete globalThis.localStorage;
    if (hadDocument) globalThis.document = savedDocument;
    else delete globalThis.document;
  }
});

test('settingsDataService: 隐私模式下主题/语言/网关草稿写盘失败不得中断 render（P-032）', () => {
  // 【杀伤力】把 safeSetItem 换回裸 localStorage.setItem，三条 doesNotThrow 立刻抛 SecurityError 变红。
  const hadStorage = 'localStorage' in globalThis;
  const savedStorage = globalThis.localStorage;
  const warns = [];
  const toasts = [];
  try {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {
        const error = new Error('denied');
        error.name = 'SecurityError';
        throw error;
      },
    };
    const deps = createMockSettingsDeps();
    deps.bootLog = { warn: (...args) => warns.push(args) };
    deps.showToast = (...args) => toasts.push(args);
    const service = createSettingsDataService(deps);
    const actions = service.createSettingsActions();

    assert.doesNotThrow(() => actions.onThemeChange('obsidian-gold'), '主题写盘失败不得外抛');
    assert.equal(deps.getState().theme, 'obsidian-gold', '内存态必须已生效');
    assert.equal(deps.getRenderCount(), 1, 'render 必须仍被调用（「点了没反应」的根因）');
    assert.equal(warns.length, 1, '主题两次写入只聚合一条降级日志');
    assert.equal(toasts.length, 0, '主题切换有即时视觉反馈，不弹窗');

    assert.doesNotThrow(() => actions.onLocaleChange('en'), '语言写盘失败不得外抛');
    assert.equal(deps.getState().lang, 'en');
    assert.equal(deps.getRenderCount(), 2);

    assert.doesNotThrow(
      () => actions.onConnectGateway({ url: 'http://x:1', username: 'u', password: 'p', profileName: 'd' }),
      '网关草稿写盘失败不得中断连接流程',
    );
    assert.equal(deps.getState().gatewayUrl, 'http://x:1', '内存态必须已生效');
    assert.equal(toasts.length, 1, '网关配置是用户主动保存，失败必须提示一次');
    assert.equal(warns.at(-1)[1].scope, 'gateway');
    assert.equal(warns.at(-1)[1].reason, 'security');
  } finally {
    if (hadStorage) globalThis.localStorage = savedStorage;
    else delete globalThis.localStorage;
    setLocale('zh-CN');
  }
});

test('settingsDataService: 配额写满时网关草稿必须提示，主题仍只记日志（P-032）', () => {
  const hadStorage = 'localStorage' in globalThis;
  const savedStorage = globalThis.localStorage;
  const warns = [];
  const toasts = [];
  try {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {
        const error = new Error('full');
        error.name = 'QuotaExceededError';
        throw error;
      },
    };
    const deps = createMockSettingsDeps();
    deps.bootLog = { warn: (...args) => warns.push(args) };
    deps.showToast = (...args) => toasts.push(args);
    const actions = createSettingsDataService(deps).createSettingsActions();

    actions.onThemeChange('obsidian-gold');
    assert.equal(toasts.length, 0, '主题切换不弹窗');

    actions.onConnectGateway({ url: 'http://x:2', username: 'u', password: 'p', profileName: 'd' });
    assert.equal(toasts.length, 1, '配额写满会让全部设置静默不保存，必须提示');
    assert.equal(warns.at(-1)[1].reason, 'quota');
  } finally {
    if (hadStorage) globalThis.localStorage = savedStorage;
    else delete globalThis.localStorage;
  }
});

test('settingsDataService: 无 localStorage 环境（单测/SSR）静默降级且不弹窗（P-032）', () => {
  const hadStorage = 'localStorage' in globalThis;
  const savedStorage = globalThis.localStorage;
  const warns = [];
  const toasts = [];
  try {
    delete globalThis.localStorage;
    const deps = createMockSettingsDeps();
    deps.bootLog = { warn: (...args) => warns.push(args) };
    deps.showToast = (...args) => toasts.push(args);
    const actions = createSettingsDataService(deps).createSettingsActions();

    assert.doesNotThrow(() => actions.onThemeChange('obsidian-gold'));
    assert.doesNotThrow(
      () => actions.onConnectGateway({ url: 'http://x:3', username: 'u', password: 'p', profileName: 'd' }),
    );
    assert.equal(warns.length, 0, 'unavailable 不属降级，不记日志');
    assert.equal(toasts.length, 0, 'unavailable 不属降级，不弹窗');
  } finally {
    if (hadStorage) globalThis.localStorage = savedStorage;
    else delete globalThis.localStorage;
  }
});

test('settingsDataService: 正常存储时主题切换成功且不产生降级日志（P-032 成功路径）', () => {
  const hadStorage = 'localStorage' in globalThis;
  const savedStorage = globalThis.localStorage;
  const writes = [];
  const warns = [];
  const toasts = [];
  try {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: (key, value) => writes.push([key, value]),
    };
    const deps = createMockSettingsDeps();
    deps.bootLog = { warn: (...args) => warns.push(args) };
    deps.showToast = (...args) => toasts.push(args);
    const actions = createSettingsDataService(deps).createSettingsActions();

    actions.onThemeChange('obsidian-gold');
    assert.deepEqual(writes, [
      ['hermes_flux_theme', 'obsidian-gold'],
      ['hermes_aura_theme', 'obsidian-gold'],
    ]);
    assert.equal(warns.length, 0, '成功路径不得产生降级日志');
    assert.equal(toasts.length, 0);

    actions.onConnectGateway({ url: 'http://x:9', username: 'u', password: 'p', profileName: 'd' });
    assert.equal(writes.filter(([key]) => key === 'hermes_flux_gateway_url').length, 1, '网关草稿必须落盘');
    assert.equal(warns.length, 0, '网关草稿成功时不得产生降级日志');
    assert.equal(toasts.length, 0);
  } finally {
    if (hadStorage) globalThis.localStorage = savedStorage;
    else delete globalThis.localStorage;
  }
});

test('settingsDataService: createSettingsActions provides working section switcher', () => {
  const deps = createMockSettingsDeps();
  const service = createSettingsDataService(deps);

  const actions = service.createSettingsActions();
  actions.onSelectSection('providers');

  const state = deps.getState();
  assert.equal(state.settingsSection, 'providers');
  assert.equal(deps.getRenderCount() > 0, true);
});

/* -------------------------------------------------------------------------- */
/* 离场拦截状态机（P0）：脏稿挂起 / 三种裁决 / 目标覆盖 / 重开不残留            */
/* -------------------------------------------------------------------------- */

const BOT_DRAFT = {
  displayName: '架构老王',
  description: '',
  model: '',
  provider: '',
  isDefault: false,
  soul: '',
  avatar: { kind: 'unchanged' },
  disabledSkills: [],
  enabledToolsets: [],
  enabledMcpServers: [],
};

function createAgentsService(extraState = {}) {
  const deps = createMockSettingsDeps({
    state: {
      isSettingsOpen: true,
      settingsSection: 'agents',
      botDrafts: { 'bot-1': { ...BOT_DRAFT } },
      ...extraState,
    },
  });
  const service = createSettingsDataService(deps);
  return { deps, service, actions: service.createSettingsActions() };
}

test('离场拦截：非 agents 域直接关闭，不询问脏稿', () => {
  const { deps, service, actions } = createAgentsService({ settingsSection: 'appearance' });
  actions.onClose();
  assert.equal(deps.getState().isSettingsOpen, false);
  assert.equal(service.getBotManagementSnapshot().exitPrompt, null);
});

test('离场拦截：agents 域有草稿时挂起目标且不关窗', () => {
  const { deps, service, actions } = createAgentsService();
  actions.onClose();
  const state = deps.getState();
  assert.equal(state.isSettingsOpen, true, '命中脏稿时不得直接关闭');
  assert.deepEqual(service.getBotManagementSnapshot().exitPrompt, { target: { kind: 'close' } });
});

test('离场拦截：切导航同样挂起，目标记录为 section', () => {
  const { deps, service, actions } = createAgentsService();
  actions.onSelectSection('providers');
  const state = deps.getState();
  assert.equal(state.settingsSection, 'agents', '确认前不得改导航');
  assert.deepEqual(service.getBotManagementSnapshot().exitPrompt, { target: { kind: 'section', section: 'providers' } });
});

test('离场拦截：保留草稿并离开 —— 关窗且草稿仍在', () => {
  const { deps, service, actions } = createAgentsService();
  actions.onClose();
  actions.onConfirmBotExit('keep');
  const state = deps.getState();
  assert.equal(state.isSettingsOpen, false);
  assert.deepEqual(Object.keys(state.botDrafts), ['bot-1'], '保留草稿必须原样留在本地');
  assert.equal(service.getBotManagementSnapshot().exitPrompt, null);
});

test('离场拦截：放弃修改 —— 关窗且清空整个草稿池（含非 active BOT）', () => {
  const { deps, service, actions } = createAgentsService({
    botDrafts: { 'bot-1': { ...BOT_DRAFT }, 'bot-2': { ...BOT_DRAFT } },
  });
  actions.onClose();
  actions.onConfirmBotExit('discard');
  const state = deps.getState();
  assert.equal(state.isSettingsOpen, false);
  assert.deepEqual(state.botDrafts, {}, '放弃修改必须清空全池，不能只清 active bot');
  assert.equal(service.getBotManagementSnapshot().exitPrompt, null);
});

test('离场拦截：取消留在当前 —— 不关窗、不改导航、挂起目标清空', () => {
  const { deps, service, actions } = createAgentsService();
  actions.onSelectSection('providers');
  actions.onCancelBotExit();
  const state = deps.getState();
  assert.equal(state.isSettingsOpen, true);
  assert.equal(state.settingsSection, 'agents');
  assert.equal(service.getBotManagementSnapshot().exitPrompt, null);
});

test('离场拦截：点击当前域不构成离场，不弹确认框', () => {
  const { deps, service, actions } = createAgentsService();
  actions.onSelectSection('agents');
  assert.equal(service.getBotManagementSnapshot().exitPrompt, null);
  assert.equal(deps.getState().settingsSection, 'agents');
});

test('离场拦截：连续两次请求以最后一次目标为准', () => {
  const { deps, service, actions } = createAgentsService();
  actions.onSelectSection('providers');
  actions.onClose();
  assert.deepEqual(service.getBotManagementSnapshot().exitPrompt, { target: { kind: 'close' } });
  actions.onConfirmBotExit('keep');
  assert.equal(deps.getState().isSettingsOpen, false, '确认后应执行最后挂起的 close 目标');
  assert.equal(deps.getState().settingsSection, 'agents');
});

test('离场拦截：外部路径关窗后重开不得残留确认框', () => {
  const { deps, service, actions } = createAgentsService();
  actions.onClose();
  assert.ok(service.getBotManagementSnapshot().exitPrompt, '先制造挂起目标');
  // 模拟未来新增的关闭入口（直接写状态）：快照兜底必须让挂起目标失效。
  deps.getState().isSettingsOpen = false;
  assert.equal(service.getSettingsSnapshot().botManagement.exitPrompt, null, '关窗后的快照不得再带确认框');
  service.openBotSettings('bot-1');
  assert.equal(service.getSettingsSnapshot().botManagement.exitPrompt, null, '重开设置不得凭空弹上一轮的确认框');
});

test('离场拦截：非 active BOT 的脏稿同样拦截（全池判定）', () => {
  const { deps, service, actions } = createAgentsService({
    botManagementActiveBotId: 'bot-2',
    botDrafts: { 'bot-1': { ...BOT_DRAFT } },
  });
  actions.onClose();
  assert.equal(deps.getState().isSettingsOpen, true, 'active 无草稿但其它 BOT 有草稿时也必须拦截');
  assert.ok(service.getBotManagementSnapshot().exitPrompt);
});

test('离场拦截：面板注册的守卫为真时，即使草稿池为空也要拦截', () => {
  const { deps, service, actions } = createAgentsService({ botDrafts: {} });
  actions.onRegisterBotDirtyGuard(() => true);
  actions.onClose();
  assert.equal(deps.getState().isSettingsOpen, true, '表单本地未落池的改动也必须拦住离场');
  assert.ok(service.getBotManagementSnapshot().exitPrompt);
});

test('离场拦截：公开出口 requestSettingsExit 直调同样命中脏稿拦截', () => {
  const { deps, service } = createAgentsService();
  // 全局快捷键与标题栏注入的正是这个公开方法，不能被绕过。
  service.requestSettingsExit({ kind: 'close' });
  assert.equal(deps.getState().isSettingsOpen, true);
  assert.deepEqual(service.getBotManagementSnapshot().exitPrompt, { target: { kind: 'close' } });
});

test('settingsDataService: onSaveEndpoint 优先写 targetProfiles 且不改默认模型', async () => {
  const httpCalls = [];
  const deps = createMockSettingsDeps({
    state: {
      profiles: [
        { name: 'bot-1', displayName: '大总管', isDefault: true },
        { name: 'bot-2', displayName: '小助手', isDefault: false },
      ],
      settingsScopedProfile: 'bot-1',
    },
    gatewayClient: {
      call: async (method) => (method === 'model.options' ? { providers: [], model: '' } : { profiles: [] }),
      request: async () => null,
    },
  });
  deps.getDesktopApi = () => ({
    httpProxy: async (opts) => {
      httpCalls.push(opts);
      if (opts.path === '/api/providers/custom-endpoints' && opts.method === 'POST') {
        return { id: 'gw', endpoints: [{ id: 'gw', name: 'GW', base_url: 'https://gw.example/v1', model: 'm1', has_api_key: true, is_current: false }] };
      }
      return { endpoints: [], providers: [] };
    },
  });
  const service = createSettingsDataService(deps);
  const actions = service.createSettingsActions();

  const res = await actions.onSaveEndpoint(
    {
      id: 'gw',
      name: 'GW',
      baseUrl: 'https://gw.example/v1',
      model: 'm1',
      models: ['m1'],
      apiKey: { kind: 'set', value: 'sk-secret' },
    },
    { targetProfiles: ['bot-2'], fanOutTo: [], makeDefault: false },
  );
  assert.equal(res.ok, true);
  const postCall = httpCalls.find((call) => call.path === '/api/providers/custom-endpoints' && call.method === 'POST');
  assert.ok(postCall);
  assert.equal(postCall.params.profile, 'bot-2', '必须写入 targetProfiles 而非隐式 scopedProfile');
  assert.equal(postCall.body.make_default, false, '保存端点不得切换默认模型');
});

test('settingsDataService: onToggleProviderAgent 直接开启优先复用密钥，无密钥回 needsKey，关闭使用中 BOT 给 displayName 提示', async () => {
  const httpCalls = [];
  const deps = createMockSettingsDeps({
    state: {
      profiles: [
        { name: 'bot-1', displayName: '大总管', isDefault: true },
        { name: 'bot-2', displayName: '小助手', isDefault: false },
      ],
      settingsCustomEndpoints: {
        status: 'ready',
        data: [
          {
            id: 'gw',
            name: 'GW',
            baseUrl: 'https://gw.example/v1',
            model: 'm1',
            models: ['m1'],
            apiMode: '',
            hasApiKey: true,
            apiKeyPreview: '${GW_KEY}',
            isCurrent: true,
          },
        ],
      },
      settingsEndpointProfiles: { gw: ['bot-1'] },
      settingsProviderViews: {
        status: 'ready',
        data: [
          {
            key: 'custom:gw',
            kind: 'custom',
            id: 'gw',
            name: 'GW',
            models: ['m1'],
            detail: 'https://gw.example/v1',
            availability: 'active',
            agents: [
              { profile: 'bot-1', displayName: '大总管', state: 'active' },
              { profile: 'bot-2', displayName: '小助手', state: 'absent' },
            ],
          },
        ],
      },
    },
    gatewayClient: {
      call: async (method) => (method === 'model.options' ? { providers: [], model: '' } : { profiles: [] }),
      request: async () => null,
    },
  });
  deps.getDesktopApi = () => ({
    httpProxy: async (opts) => {
      httpCalls.push(opts);
      if (opts.path === '/api/providers/custom-endpoints' && opts.method === 'GET' && opts.params?.profile === 'bot-1') {
        return {
          endpoints: [
            { id: 'gw', name: 'GW', base_url: 'https://gw.example/v1', model: 'm1', has_api_key: true, api_key_preview: '${GW_KEY}' },
          ],
        };
      }
      if (opts.path === '/api/env/reveal' && opts.method === 'POST') {
        return { value: 'sk-copied' };
      }
      if (opts.path === '/api/providers/custom-endpoints' && opts.method === 'POST') {
        return {
          id: 'gw',
          endpoints: [
            { id: 'gw', name: 'GW', base_url: 'https://gw.example/v1', model: 'm1', has_api_key: true, is_current: false },
          ],
        };
      }
      if (opts.path === '/api/providers/custom-endpoints/gw' && opts.method === 'DELETE') {
        return { endpoints: [] };
      }
      return { endpoints: [], providers: [] };
    },
  });

  const service = createSettingsDataService(deps);
  const actions = service.createSettingsActions();

  // 1. 点击 active BOT 关闭 -> 拦截并返回可读 displayName，不发 DELETE
  const blocked = await actions.onToggleProviderAgent('gw', 'bot-1', false);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.message.includes('大总管'), '阻断提示应包含 BOT 可读显示名');
  assert.equal(httpCalls.some((c) => c.method === 'DELETE'), false);

  // 2. 点击 absent BOT 开启 -> 自动从 bot-1 复用密钥并以 make_default=false 写入 bot-2
  const attached = await actions.onToggleProviderAgent('gw', 'bot-2', true);
  assert.equal(attached.ok, true);
  assert.equal('confirmRequired' in attached, false);
  const saveCall = httpCalls.find((c) => c.path === '/api/providers/custom-endpoints' && c.method === 'POST');
  assert.equal(saveCall.params.profile, 'bot-2');
  assert.equal(saveCall.body.api_key, 'sk-copied');
  assert.equal(saveCall.body.make_default, false);

  // 3. 当没有可读密钥来源时，直接返回 needsKey: true
  deps.getState().settingsEndpointProfiles = { gw: [] };
  const needKey = await actions.onToggleProviderAgent('gw', 'bot-2', true);
  assert.equal(needKey.ok, false);
  assert.equal(needKey.needsKey, true);

  // 4. 用户手动输入 apiKey 后重发 -> 不再调用 revealEnv，直接用输入密钥且 make_default=false 写入
  httpCalls.length = 0;
  const manualAttached = await actions.onToggleProviderAgent('gw', 'bot-2', true, 'sk-manual-123');
  assert.equal(manualAttached.ok, true);
  assert.equal(httpCalls.some((c) => c.path === '/api/env/reveal'), false);
  const manualSave = httpCalls.find((c) => c.path === '/api/providers/custom-endpoints' && c.method === 'POST');
  assert.equal(manualSave.body.api_key, 'sk-manual-123');
  assert.equal(manualSave.body.make_default, false);

  // 5. 点击 ready BOT 关闭 -> 发 DELETE 移除该 BOT 上的端点绑定
  deps.getState().settingsProviderViews = {
    status: 'ready',
    data: [
      {
        key: 'custom:gw',
        kind: 'custom',
        id: 'gw',
        name: 'GW',
        models: ['m1'],
        detail: 'https://gw.example/v1',
        availability: 'active',
        agents: [
          { profile: 'bot-1', displayName: '大总管', state: 'active' },
          { profile: 'bot-2', displayName: '小助手', state: 'ready' },
        ],
      },
    ],
  };
  const detached = await actions.onToggleProviderAgent('gw', 'bot-2', false);
  assert.equal(detached.ok, true);
  const delCall = httpCalls.find((c) => c.method === 'DELETE');
  assert.ok(delCall);
  assert.equal(delCall.params.profile, 'bot-2');
});

test('settingsDataService: onToggleProviderAgent 网关违背 make_default=false 返回 default-changed 警示且合流在途请求', async () => {
  let releasePost;
  let postCount = 0;
  let forceDefaultApplied = false;
  const deps = createMockSettingsDeps({
    state: {
      profiles: [
        { name: 'bot-1', displayName: '大总管', isDefault: true },
        { name: 'bot-2', displayName: '小助手', isDefault: false },
      ],
      settingsCustomEndpoints: {
        status: 'ready',
        data: [
          {
            id: 'gw',
            name: 'GW',
            baseUrl: 'https://gw.example/v1',
            model: 'm1',
            models: ['m1'],
            apiMode: '',
            hasApiKey: true,
            isCurrent: true,
          },
        ],
      },
      settingsEndpointProfiles: { gw: ['bot-1'] },
      settingsProviderViews: {
        status: 'ready',
        data: [
          {
            key: 'custom:gw',
            kind: 'custom',
            id: 'gw',
            name: 'GW',
            models: ['m1'],
            detail: 'https://gw.example/v1',
            availability: 'active',
            agents: [
              { profile: 'bot-1', displayName: '大总管', state: 'active' },
              { profile: 'bot-2', displayName: '小助手', state: 'absent' },
            ],
          },
        ],
      },
    },
    gatewayClient: {
      call: async (method) => (method === 'model.options' ? { providers: [], model: '' } : { profiles: [] }),
      request: async () => null,
    },
  });
  deps.getDesktopApi = () => ({
    httpProxy: async (opts) => {
      if (opts.path === '/api/providers/custom-endpoints' && opts.method === 'POST') {
        postCount += 1;
        await new Promise((resolve) => { releasePost = resolve; });
        return {
          id: 'gw',
          endpoints: [
            {
              id: 'gw',
              name: 'GW',
              base_url: 'https://gw.example/v1',
              model: 'm1',
              has_api_key: true,
              is_current: forceDefaultApplied,
            },
          ],
        };
      }
      return { endpoints: [], providers: [] };
    },
  });

  const service = createSettingsDataService(deps);
  const actions = service.createSettingsActions();

  // 1. 网关违背 make_default=false 返回 is_current: true -> 必须返回 providerAttachDefaultChanged 错误
  forceDefaultApplied = true;
  const pDefaultChanged = actions.onToggleProviderAgent('gw', 'bot-2', true, 'sk-1');
  await Promise.resolve();
  assert.ok(releasePost, '应已发出 POST 请求');

  // 并发同方向合流应返回同一个在途结果；反方向 / 不同意图应返回 providerAttachBusy
  const pDuplicate = actions.onToggleProviderAgent('gw', 'bot-2', true, 'sk-1');
  deps.getState().settingsProviderViews.data[0].agents[1].state = 'ready';
  const pConflict = await actions.onToggleProviderAgent('gw', 'bot-2', false);
  assert.equal(pConflict.ok, false);
  assert.ok(pConflict.message.includes('settings.providerAttachBusy'));

  releasePost();
  const [res1, res2] = await Promise.all([pDefaultChanged, pDuplicate]);
  assert.equal(postCount, 1, '同签名并发点击必须只发送一次 POST');
  assert.equal(res1.ok, false);
  assert.equal(res2.ok, false);
  assert.ok(res1.message.includes('settings.providerAttachDefaultChanged'));
});

test('settingsDataService: 保存 BOT 配置与切回提供商页必须同步刷新 providerViews，且丢弃乱序旧响应', async () => {
  let activeProviderForXiaofawang = 'relay';
  let modelOptionsCalls = 0;
  let releaseFirstCatalog;
  let blockFirstModelOptions = false;
  let fetchProfilesCalls = 0;

  const deps = createMockSettingsDeps({
    state: {
      profiles: [{ name: 'xiaofawang', displayName: 'xiaofawang', isDefault: false }],
      profileName: 'xiaofawang',
      settingsSection: 'agents',
      botManagementActiveBotId: 'xiaofawang',
      botManagementStatus: { status: 'idle', activeBotId: 'xiaofawang' },
      botManagementDetail: {
        id: 'xiaofawang',
        displayName: 'xiaofawang',
        description: '',
        model: 'm-old',
        provider: 'relay',
        isDefault: false,
        soul: '',
        skills: { authoritative: false, rows: [] },
        toolsets: { authoritative: false, rows: [] },
        mcpServers: { authoritative: false, rows: [] },
      },
      botDrafts: {
        xiaofawang: {
          displayName: 'xiaofawang',
          description: '',
          model: 'grok-3',
          provider: 'xai-oauth',
          isDefault: false,
          soul: '',
          avatar: { kind: 'unchanged' },
          disabledSkills: [],
          enabledToolsets: [],
          enabledMcpServers: [],
        },
      },
    },
    gatewayClient: (() => {
      const handleRpc = async (method) => {
        if (method === 'profiles.configure') {
          activeProviderForXiaofawang = 'xai-oauth';
          return { ok: true, applied: { model: true } };
        }
        if (method === 'profiles.list') {
          return { profiles: [{ name: 'xiaofawang', display_name: 'xiaofawang' }] };
        }
        if (method === 'profiles.describe') {
          return { name: 'xiaofawang', model: 'grok-3', provider: 'xai-oauth' };
        }
        if (method === 'model.options') {
          modelOptionsCalls += 1;
          const callNo = modelOptionsCalls;
          if (blockFirstModelOptions && callNo === 1) {
            await new Promise((resolve) => { releaseFirstCatalog = resolve; });
            return {
              model: 'm-old',
              provider: 'relay',
              providers: [
                { slug: 'relay', models: ['m-old'], is_current: true },
                { slug: 'xai-oauth', models: ['grok-3'], is_current: false },
              ],
            };
          }
          return {
            model: activeProviderForXiaofawang === 'xai-oauth' ? 'grok-3' : 'm-old',
            provider: activeProviderForXiaofawang,
            providers: [
              { slug: 'relay', models: ['m-old'], is_current: activeProviderForXiaofawang === 'relay' },
              { slug: 'xai-oauth', models: ['grok-3'], is_current: activeProviderForXiaofawang === 'xai-oauth' },
            ],
          };
        }
        return {};
      };
      return {
        call: handleRpc,
        request: handleRpc,
      };
    })(),
  });
  deps.fetchProfiles = async () => { fetchProfilesCalls += 1; };
  deps.getDesktopApi = () => ({
    httpProxy: async (opts) => {
      if (opts.path === '/api/providers/custom-endpoints') {
        return {
          endpoints: [
            { id: 'relay', name: 'Relay', base_url: 'https://relay.example/v1', model: 'm-old', models: ['m-old'], has_api_key: true },
          ],
        };
      }
      if (opts.path === '/api/providers/oauth') {
        return { providers: [{ id: 'xai-oauth', name: 'xAI Grok', flow: 'device_code', logged_in: true }] };
      }
      return {};
    },
  });

  const service = createSettingsDataService(deps);
  const actions = service.createSettingsActions();

  // 1. 首次进入 providers（即使之前是 ready，每次切入 providers 也要刷新）
  await service.reloadProviderCatalog();
  const relayBefore = deps.getState().settingsProviderViews.data.find((v) => v.id === 'relay');
  assert.equal(relayBefore.agents[0].state, 'active');

  // 2. 在 BOT 配置页保存为 xai-oauth / grok-3 -> onProfilesChanged 必须触发 reloadProviderCatalog()
  const saved = await actions.onSaveBotConfig('xiaofawang');
  assert.equal(saved.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(fetchProfilesCalls >= 1);
  const relayAfterSave = deps.getState().settingsProviderViews.data.find((v) => v.id === 'relay');
  assert.equal(relayAfterSave.agents[0].state, 'ready', '保存 BOT 默认模型后，原提供商快照必须实时从 active 降回 ready');

  // 3. 即使状态已经是 ready，切回 providers 页（ensureSettingsSectionData('providers')）仍应发刷新、不闪骨架且防重复并发
  activeProviderForXiaofawang = 'relay';
  deps.getState().settingsProviderViews = { status: 'ready', data: deps.getState().settingsProviderViews.data };
  modelOptionsCalls = 0;
  blockFirstModelOptions = true;
  service.ensureSettingsSectionData('providers');
  assert.equal(deps.getState().settingsProviderViews.status, 'ready', '已有就绪数据时背景刷新不得闪回 loading 骨架');
  service.ensureSettingsSectionData('providers');
  await Promise.resolve();
  assert.ok(releaseFirstCatalog, 'status 已是 ready 时切入 providers 页仍应刷新目录');
  assert.equal(modelOptionsCalls, 1, '在途刷新未结束前重复切入不得发出第二次并发拉取');

  // 第二次强制刷新先回来（设为 xai-oauth），第一次挂起的旧响应（relay）稍后到达时必须被丢弃
  activeProviderForXiaofawang = 'xai-oauth';
  await service.reloadProviderCatalog();
  releaseFirstCatalog();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const relayAfterRace = deps.getState().settingsProviderViews.data.find((v) => v.id === 'relay');
  assert.equal(relayAfterRace.agents[0].state, 'ready', '迟到的旧 reload 响应不得覆盖最新目录');

  // 4. 捕获异常后 status 变为 error 且必须在 finally 释放 inFlight 锁，后续切页可自动恢复
  const origDesktopApi = deps.getDesktopApi;
  deps.getDesktopApi = () => { throw new Error('desktop bridge down'); };
  await service.reloadProviderCatalog();
  assert.equal(deps.getState().settingsProviderViews.status, 'error');
  deps.getDesktopApi = origDesktopApi;
  blockFirstModelOptions = false;
  service.ensureSettingsSectionData('providers');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(deps.getState().settingsProviderViews.status, 'ready', '异常解锁后再次切入 providers 必须成功恢复目录');
});

test('settingsDataService: onSwitchDefaultAndDisableProvider 严格串行先切默认再关闭，失败分步拦截并刷新目录', async () => {
  const httpCalls = [];
  let setModelMode = 'confirm-required';
  let confirmWithoutMessage = false;
  let blockModelSet = false;
  let releaseModelSet;
  let deleteShouldFail = false;
  let currentProvider = 'relay';
  let fetchProfilesCount = 0;

  const relayView = {
    key: 'custom:relay',
    kind: 'custom',
    id: 'relay',
    name: 'Claude Relay',
    models: ['claude-sonnet-4'],
    detail: 'https://relay.example/v1',
    availability: 'active',
    agents: [{ profile: 'xiaofawang', displayName: 'xiaofawang', state: 'active', detail: 'claude-sonnet-4' }],
  };
  const grokView = {
    key: 'subscription:xai-oauth',
    kind: 'subscription',
    id: 'xai-oauth',
    name: 'xAI Grok',
    models: ['grok-3'],
    detail: '',
    availability: 'ready',
    agents: [{ profile: 'xiaofawang', displayName: 'xiaofawang', state: 'ready' }],
  };
  const backupView = {
    key: 'custom:backup',
    kind: 'custom',
    id: 'backup',
    name: 'Backup Relay',
    models: ['b1'],
    detail: 'https://backup.example/v1',
    availability: 'ready',
    agents: [{ profile: 'xiaofawang', displayName: 'xiaofawang', state: 'ready' }],
  };

  const deps = createMockSettingsDeps({
    state: {
      profiles: [{ name: 'xiaofawang', displayName: 'xiaofawang', isDefault: false }],
      settingsProviderViews: { status: 'ready', data: [relayView, grokView, backupView] },
      settingsCustomEndpoints: {
        status: 'ready',
        data: [
          { id: 'relay', name: 'Claude Relay', baseUrl: 'https://relay.example/v1', model: 'claude-sonnet-4', models: ['claude-sonnet-4'], apiMode: '', hasApiKey: true, isCurrent: true },
          { id: 'backup', name: 'Backup Relay', baseUrl: 'https://backup.example/v1', model: 'b1', models: ['b1'], apiMode: '', hasApiKey: true, isCurrent: false },
        ],
      },
      settingsEndpointProfiles: { relay: ['xiaofawang'], backup: ['xiaofawang'] },
    },
    gatewayClient: {
      call: async (method) => {
        if (method === 'model.options') {
          return {
            model: currentProvider === 'xai-oauth' ? 'grok-3' : 'claude-sonnet-4',
            provider: currentProvider,
            providers: [
              ...(currentProvider === 'relay' ? [{ slug: 'relay', models: ['claude-sonnet-4'], is_current: true }] : []),
              { slug: 'xai-oauth', models: ['grok-3'], is_current: currentProvider === 'xai-oauth' },
            ],
          };
        }
        return { profiles: [] };
      },
      request: async () => null,
    },
  });
  deps.describeRpcError = (err) => (err instanceof Error ? err.message : String(err));
  deps.fetchProfiles = async () => { fetchProfilesCount += 1; };
  deps.getDesktopApi = () => ({
    httpProxy: async (opts) => {
      httpCalls.push({ method: opts.method, path: opts.path, params: opts.params, body: opts.body });
      if (opts.path === '/api/model/set' && opts.method === 'POST') {
        if (blockModelSet) {
          await new Promise((resolve) => { releaseModelSet = resolve; });
        }
        if (setModelMode === 'confirm-required' && !opts.body?.confirm_expensive_model) {
          return confirmWithoutMessage
            ? { confirm_required: true }
            : { confirm_required: true, confirm_message: 'Expensive model confirm' };
        }
        if (setModelMode === 'error') {
          throw new Error('model switch rejected');
        }
        if (setModelMode === 'error-empty') {
          throw new Error('');
        }
        currentProvider = opts.body?.provider;
        return { provider: opts.body?.provider, model: opts.body?.model };
      }
      if (opts.path === '/api/providers/custom-endpoints/relay' && opts.method === 'DELETE') {
        if (deleteShouldFail) {
          throw new Error('delete endpoint failed');
        }
        return { endpoints: [] };
      }
      if (opts.path === '/api/providers/custom-endpoints') {
        return {
          endpoints: currentProvider === 'relay'
            ? [{ id: 'relay', name: 'Claude Relay', base_url: 'https://relay.example/v1', model: 'claude-sonnet-4', has_api_key: true }]
            : [],
        };
      }
      if (opts.path === '/api/providers/oauth') {
        return { providers: [{ id: 'xai-oauth', name: 'xAI Grok', flow: 'device_code', logged_in: true }] };
      }
      return {};
    },
  });

  const service = createSettingsDataService(deps);
  const actions = service.createSettingsActions();

  // 1. 第一步需要高价确认 -> 返回 confirmRequired，绝不发 DELETE
  const needConfirm = await actions.onSwitchDefaultAndDisableProvider({
    profile: 'xiaofawang',
    disableProviderId: 'relay',
    newProviderId: 'xai-oauth',
    newModel: 'grok-3',
  });
  assert.equal(needConfirm.ok, false);
  assert.equal(needConfirm.confirmRequired, true);
  assert.equal(needConfirm.step, 'switch');
  assert.equal(httpCalls.some((c) => c.method === 'DELETE'), false, '高价确认未落盘时绝不能提前关闭原提供商');

  // 2. 第一步网络/网关报错 -> 返回 step='switch'，绝不发 DELETE
  httpCalls.length = 0;
  setModelMode = 'error';
  const step1Fail = await actions.onSwitchDefaultAndDisableProvider({
    profile: 'xiaofawang',
    disableProviderId: 'relay',
    newProviderId: 'xai-oauth',
    newModel: 'grok-3',
  });
  assert.equal(step1Fail.ok, false);
  assert.equal(step1Fail.step, 'switch');
  assert.ok(step1Fail.message.includes('model switch rejected'));
  assert.equal(httpCalls.some((c) => c.method === 'DELETE'), false, '切模型失败绝不能提前关闭原提供商');

  // 3. 第一步成功、第二步 DELETE 失败 -> 返回 step='disable'，且无条件重拉目录反映新默认模型
  httpCalls.length = 0;
  setModelMode = 'ok';
  deleteShouldFail = true;
  const step2Fail = await actions.onSwitchDefaultAndDisableProvider({
    profile: 'xiaofawang',
    disableProviderId: 'relay',
    newProviderId: 'xai-oauth',
    newModel: 'grok-3',
  });
  assert.equal(step2Fail.ok, false);
  assert.equal(step2Fail.step, 'disable');
  assert.ok(step2Fail.message.includes('delete endpoint failed'));
  const grokAfterPartial = deps.getState().settingsProviderViews.data.find((v) => v.id === 'xai-oauth');
  assert.equal(grokAfterPartial.agents[0].state, 'active', '即使第二步失败，也必须刷新目录体现新默认提供方');

  // 4. 高价二次确认闭环（confirmExpensive: true）+ 自定义端点 base_url 透传：先 POST /api/model/set 再 DELETE
  httpCalls.length = 0;
  currentProvider = 'relay';
  deps.getState().settingsProviderViews = { status: 'ready', data: [relayView, grokView, backupView] };
  deleteShouldFail = false;
  setModelMode = 'confirm-required';
  const beforeFetches = fetchProfilesCount;
  const done = await actions.onSwitchDefaultAndDisableProvider({
    profile: 'xiaofawang',
    disableProviderId: 'relay',
    newProviderId: 'backup',
    newModel: 'b1',
    confirmExpensive: true,
  });
  assert.equal(done.ok, true);
  const modelSetIdx = httpCalls.findIndex((c) => c.path === '/api/model/set');
  const deleteIdx = httpCalls.findIndex((c) => c.method === 'DELETE');
  assert.ok(modelSetIdx !== -1 && deleteIdx > modelSetIdx, '必须先调 /api/model/set 再 DELETE 原提供商');
  assert.equal(httpCalls[modelSetIdx].body?.confirm_expensive_model, true, 'confirmExpensive 必须透传到 /api/model/set');
  assert.equal(httpCalls[modelSetIdx].body?.base_url, 'https://backup.example/v1', '切到自定义端点时必须透传 base_url');
  assert.ok(fetchProfilesCount > beforeFetches, '切换完成后须同步刷新 BOT 花名册');

  // 5. 防御拒止：同提供商、空模型与订阅项禁止走 DELETE
  httpCalls.length = 0;
  deps.getState().settingsProviderViews = { status: 'ready', data: [relayView, grokView, backupView] };
  const sameRes = await actions.onSwitchDefaultAndDisableProvider({
    profile: 'xiaofawang',
    disableProviderId: 'relay',
    newProviderId: 'custom:relay',
    newModel: 'claude-sonnet-4',
  });
  const emptyRes = await actions.onSwitchDefaultAndDisableProvider({
    profile: 'xiaofawang',
    disableProviderId: 'relay',
    newProviderId: 'xai-oauth',
    newModel: '   ',
  });
  const subDisableRes = await actions.onSwitchDefaultAndDisableProvider({
    profile: 'xiaofawang',
    disableProviderId: 'xai-oauth',
    newProviderId: 'backup',
    newModel: 'b1',
  });
  assert.equal(sameRes.ok, false);
  assert.equal(emptyRes.ok, false);
  assert.equal(subDisableRes.ok, false);
  assert.equal(subDisableRes.step, 'disable');
  assert.equal(httpCalls.length, 0, '非法参数与订阅关闭拒止不得发出任何 HTTP 请求');

  // 6. 目录未就绪、未知 ID 及异常默认文案兜底
  deps.getState().settingsProviderViews = { status: 'loading' };
  const notReadyRes = await actions.onSwitchDefaultAndDisableProvider({
    profile: 'xiaofawang',
    disableProviderId: 'relay',
    newProviderId: 'xai-oauth',
    newModel: 'grok-3',
  });
  deps.getState().settingsProviderViews = { status: 'ready', data: [relayView, grokView, backupView] };
  const unknownTargetRes = await actions.onSwitchDefaultAndDisableProvider({
    profile: 'xiaofawang',
    disableProviderId: 'relay',
    newProviderId: 'missing-id',
    newModel: 'm',
  });
  assert.equal(notReadyRes.ok, false);
  assert.equal(unknownTargetRes.ok, false);
  assert.ok(notReadyRes.message.includes('settings.providerDeleteUnknown'));
  assert.ok(unknownTargetRes.message.includes('settings.providerDeleteUnknown'));

  setModelMode = 'confirm-required';
  confirmWithoutMessage = true;
  const confirmFallback = await actions.onSwitchDefaultAndDisableProvider({
    profile: 'xiaofawang',
    disableProviderId: 'relay',
    newProviderId: 'xai-oauth',
    newModel: 'grok-3',
  });
  assert.equal(confirmFallback.confirmRequired, true);
  assert.ok(confirmFallback.message.includes('settings.providerExpensiveWarning'));
  confirmWithoutMessage = false;

  const origDescribeRpcError = deps.describeRpcError;
  deps.describeRpcError = () => '';
  setModelMode = 'error-empty';
  let emptyErrFallback;
  try {
    emptyErrFallback = await actions.onSwitchDefaultAndDisableProvider({
      profile: 'xiaofawang',
      disableProviderId: 'relay',
      newProviderId: 'xai-oauth',
      newModel: 'grok-3',
    });
  } finally {
    deps.describeRpcError = origDescribeRpcError;
  }
  assert.equal(emptyErrFallback.ok, false);
  assert.equal(emptyErrFallback.step, 'switch');
  assert.ok(emptyErrFallback.message.includes('settings.providerToggleFailed'));

  // 7. 并发在途锁定：同签名复用 promise（只发一次 POST），异签名立刻拒止 busy
  httpCalls.length = 0;
  setModelMode = 'ok';
  blockModelSet = true;
  releaseModelSet = undefined;
  const pSame1 = actions.onSwitchDefaultAndDisableProvider({
    profile: 'xiaofawang',
    disableProviderId: 'relay',
    newProviderId: 'xai-oauth',
    newModel: 'grok-3',
  });
  const pSame2 = actions.onSwitchDefaultAndDisableProvider({
    profile: 'xiaofawang',
    disableProviderId: 'relay',
    newProviderId: 'xai-oauth',
    newModel: 'grok-3',
  });
  const pConflict = await actions.onSwitchDefaultAndDisableProvider({
    profile: 'xiaofawang',
    disableProviderId: 'relay',
    newProviderId: 'backup',
    newModel: 'b1',
  });
  assert.equal(pConflict.ok, false);
  assert.equal(pConflict.step, 'switch');
  assert.ok(pConflict.message.includes('settings.providerAttachBusy'));
  await Promise.resolve();
  assert.ok(releaseModelSet, '首个切换请求应在途等待');
  blockModelSet = false;
  releaseModelSet();
  const [sameOut1, sameOut2] = await Promise.all([pSame1, pSame2]);
  assert.equal(sameOut1.ok, true);
  assert.equal(sameOut2.ok, true);
  assert.equal(httpCalls.filter((c) => c.path === '/api/model/set').length, 1, '同签名并发只得发出一次 /api/model/set');
});
