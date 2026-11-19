/**
 * 设置中心业务装配与数据服务（Settings Data Service · D14）纯逻辑单测
 * (packages/desktop/__tests__/unit/settingsDataService.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsDataService } from '../../dist/renderer/services/settingsDataService.mjs';

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
  assert.equal(snapshot.bots.length, 1);
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
