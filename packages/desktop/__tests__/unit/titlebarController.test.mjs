/**
 * 顶栏状态与窗口按键控制器纯单测 (Titlebar Controller Unit Test)
 * (packages/desktop/__tests__/unit/titlebarController.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createTitlebarController, detectInitialPlatform } from '../../dist/renderer/titlebarController.mjs';

function createMockDeps(overrides = {}) {
  let renderCount = 0;
  const state = {
    platform: 'windows',
    isMaximized: false,
    gatewayConnected: true,
    gatewayLatencyMs: 42,
    theme: 'obsidian-gold',
    activeFocus: { type: 'session', sessionId: 'sess-1' },
    profiles: [{ name: 'default', displayName: 'Default Bot' }],
    groupRooms: [],
    sessions: [{ id: 'sess-1', title: 'Work Session', botName: 'default' }],
    activeSessionId: 'sess-1',
    profileName: 'default',
    ...(overrides.state || {}),
  };

  let minimized = false;
  let closed = false;
  let windowStateChangeCb = null;

  const desktopApi = overrides.desktopApi ?? {
    minimize: () => {
      minimized = true;
    },
    maximize: async () => {
      return true;
    },
    isMaximized: async () => true,
    close: () => {
      closed = true;
    },
    getSystemInfo: async () => ({
      platform: 'windows',
      appVersion: '1.2.3',
    }),
    onWindowStateChange: (cb) => {
      windowStateChangeCb = cb;
    },
  };

  const deps = {
    getState: () => state,
    render: () => {
      renderCount += 1;
    },
    getDesktopApi: () => desktopApi,
    t: (key) => key,
  };

  return {
    deps,
    state,
    desktopApi,
    getRenderCount: () => renderCount,
    isMinimized: () => minimized,
    isClosed: () => closed,
    triggerWindowStateChange: (ws) => windowStateChangeCb?.(ws),
  };
}

test('TitlebarController: getTitlebarSnapshot 正确提取快照与平台状态', () => {
  const { deps, state } = createMockDeps();
  const controller = createTitlebarController(deps);

  const snapshot = controller.getTitlebarSnapshot();
  assert.equal(snapshot.platform, 'windows');
  assert.equal(snapshot.isMaximized, false);
  assert.equal(snapshot.gatewayConnected, true);
  assert.equal(snapshot.latencyMs, 42);
  assert.ok(snapshot.title.length > 0);
});

test('TitlebarController: 快照必须透传左栏与检查舱折叠态（顶栏几何的唯一驱动源）', () => {
  const { deps, state } = createMockDeps();
  const controller = createTitlebarController(deps);

  // 这两项驱动顶栏左段宽度与标题居中基准；一旦漏传，Titlebar 会按默认值渲染，
  // 展开态标题偏右 210px、折叠态左段宽度失真，且任何测试都不会变红。
  state.leftRailCollapsed = true;
  state.inspectorCollapsed = false;
  const snapshot = controller.getTitlebarSnapshot();
  assert.equal(snapshot.leftRailCollapsed, true, '必须透传 leftRailCollapsed');
  assert.equal(snapshot.inspectorCollapsed, false, '必须透传 inspectorCollapsed');

  state.leftRailCollapsed = false;
  state.inspectorCollapsed = true;
  const next = controller.getTitlebarSnapshot();
  assert.equal(next.leftRailCollapsed, false);
  assert.equal(next.inspectorCollapsed, true);
});

test('TitlebarController: 窗口最小化与关闭委托给 desktopApi', () => {
  const { deps, isMinimized, isClosed } = createMockDeps();
  const controller = createTitlebarController(deps);

  controller.onMinimizeWindow();
  assert.equal(isMinimized(), true);

  controller.onCloseWindow();
  assert.equal(isClosed(), true);
});

test('TitlebarController: onMaximizeWindow 切换最大化状态并触发 render', async () => {
  const { deps, state, getRenderCount } = createMockDeps();
  const controller = createTitlebarController(deps);

  await controller.onMaximizeWindow();
  assert.equal(state.isMaximized, true);
  assert.equal(getRenderCount(), 1);
});

test('TitlebarController: onToggleTheme 切换主题并触发 render', () => {
  const { deps, state, getRenderCount } = createMockDeps({
    state: { theme: 'obsidian-gold' },
  });
  const controller = createTitlebarController(deps);

  controller.onToggleTheme();
  assert.notEqual(state.theme, 'obsidian-gold');
  assert.equal(getRenderCount(), 1);
});

test('TitlebarController: syncSystemWindow 同步平台信息并监听窗口状态', async () => {
  const { deps, state, triggerWindowStateChange, getRenderCount } = createMockDeps();
  const controller = createTitlebarController(deps);

  await controller.syncSystemWindow();
  assert.equal(state.platform, 'windows');
  assert.equal(state.appVersion, '1.2.3');
  assert.equal(state.isMaximized, true);

  // 模拟窗口反最大化事件
  triggerWindowStateChange({ isMaximized: false });
  assert.equal(state.isMaximized, false);
  assert.ok(getRenderCount() >= 1);
});

test('TitlebarController: detectInitialPlatform 根据 desktopApi 推导平台', () => {
  assert.equal(detectInitialPlatform({}), 'windows');
  assert.equal(detectInitialPlatform(undefined), 'web');
});
