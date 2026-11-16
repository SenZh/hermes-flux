/**
 * 启动自举与模块组装中心纯单测 (App Bootstrap Unit Test)
 * (packages/desktop/__tests__/unit/appBootstrap.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampLeftRailWidth,
  clampRail,
  isConversationDemoMode,
  injectConversationDemo,
  createAppBootstrap,
  LEFT_RAIL_WIDTH,
} from '../../dist/renderer/bootstrap/appBootstrap.mjs';

function createMockDeps(overrides = {}) {
  let renderCount = 0;
  let connectCount = 0;
  let restoreCacheCount = 0;
  let syncSystemWindowCount = 0;
  const boots = [];

  const state = {
    theme: 'obsidian-gold',
    lang: 'zh',
    platform: 'windows',
    gatewayConnected: false,
    gatewayConnecting: false,
    profileName: 'default',
    messages: [],
    availableModels: [],
    modelCatalog: [],
    gatewayUrl: 'http://127.0.0.1:8080',
    ...(overrides.state || {}),
  };

  const desktopApi = overrides.desktopApi ?? {
    getDefaultGatewayConfig: async () => ({
      url: 'http://127.0.0.1:9999',
      profile: 'test-profile',
    }),
  };

  const deps = {
    getState: () => state,
    render: () => {
      renderCount += 1;
    },
    getDesktopApi: () => desktopApi,
    getGatewayClient: () => null,
    connect: () => {
      connectCount += 1;
    },
    restoreCacheToState: async () => {
      restoreCacheCount += 1;
    },
    refreshProfilesFromServer: async () => {},
    syncSystemWindow: async () => {
      syncSystemWindowCount += 1;
    },
    fontPreferences: { family: 'sans-serif', size: 14 },
    logBoot: (info) => {
      boots.push(info);
    },
  };

  return {
    deps,
    state,
    desktopApi,
    getRenderCount: () => renderCount,
    getConnectCount: () => connectCount,
    getRestoreCacheCount: () => restoreCacheCount,
    getSyncSystemWindowCount: () => syncSystemWindowCount,
    boots,
  };
}

test('AppBootstrap: clampLeftRailWidth 与 clampRail 边界防护与兜底', () => {
  // 左轨宽度夹取测试
  assert.equal(clampLeftRailWidth(null), LEFT_RAIL_WIDTH.defaultValue);
  assert.equal(clampLeftRailWidth('invalid'), LEFT_RAIL_WIDTH.defaultValue);
  assert.equal(clampLeftRailWidth('100'), LEFT_RAIL_WIDTH.min);
  assert.equal(clampLeftRailWidth('1000'), LEFT_RAIL_WIDTH.max);
  assert.equal(clampLeftRailWidth('300'), 300);

  // 通用轨宽度夹取测试
  assert.equal(clampRail(null, 200, 500, 300), 300);
  assert.equal(clampRail('150', 200, 500, 300), 200);
  assert.equal(clampRail('600', 200, 500, 300), 500);
  assert.equal(clampRail('350', 200, 500, 300), 350);
});

test('AppBootstrap: isConversationDemoMode 非 demo 环境安全回退', () => {
  assert.equal(isConversationDemoMode(), false);
});

test('AppBootstrap: injectConversationDemo 注入完整演示模型与对话消息', () => {
  const state = {
    gatewayConnected: false,
    gatewayConnecting: true,
    profileName: '',
    messages: [],
    availableModels: [],
    modelCatalog: [],
  };

  injectConversationDemo(state);

  assert.equal(state.gatewayConnected, true);
  assert.equal(state.gatewayConnecting, false);
  assert.equal(state.profileName, 'default');
  assert.ok(state.availableModels.length > 0);
  assert.ok(state.modelCatalog.length > 0);
  assert.ok(state.messages.length >= 4);
});

test('AppBootstrap: init 正常执行自举流水线，触发缓存恢复与连接建立', async () => {
  const { deps, boots, getConnectCount, getRestoreCacheCount, getSyncSystemWindowCount } = createMockDeps();
  const bootstrap = createAppBootstrap(deps);

  await bootstrap.init();

  assert.equal(boots.length, 1);
  assert.equal(getSyncSystemWindowCount(), 1);
  assert.equal(getRestoreCacheCount(), 1);
  assert.equal(getConnectCount(), 1);
});
