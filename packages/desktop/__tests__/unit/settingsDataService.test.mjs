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
