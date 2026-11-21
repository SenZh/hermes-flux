import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Titlebar } from '../dist/components-react/Titlebar.js';
import { StatusBar } from '../dist/components-react/StatusBar.js';
import { createShellMountUpdater, getStatusBarSnapshot, getTitlebarSnapshot } from '../dist/components-react/mount-shell-components.js';
import { resolveSkinId } from '../dist/tokens/skins.js';

test('Titlebar renders window controls, global toggles and no profile switcher', () => {
  const calls = [];
  const markup = renderToStaticMarkup(React.createElement(Titlebar, {
    platform: 'macos', title: 'Session', isMaximized: false, gatewayConnected: true, leftRailCollapsed: false,
    activeAvatar: { kind: 'bot', name: 'aura', avatar: 'data:image/png;base64,mock' },
    onMinimize: () => calls.push('minimize'), onMaximize: () => calls.push('maximize'), onClose: () => calls.push('close'),
    onToggleLeftRail: () => calls.push('rail'), onToggleInspector: () => calls.push('inspector'),
    onOpenSettings: () => calls.push('settings'),
  }));
  // 产品裁决（2026-11-20）：macOS 交通灯由系统原生绘制，组件严禁自绘（曾双重渲染成 6 个圆点）
  assert.doesNotMatch(markup, /mac-traffic-lights/);
  assert.doesNotMatch(markup, /traffic-close/);
  assert.match(markup, /data-testid="react-titlebar"/);
  assert.match(markup, /data-left-rail-collapsed="false"/);
  assert.match(markup, /toggle-inspector-btn/);
  // 产品裁决（2026-11-21）：顶栏居中保持纯粹空白，移除头像与会话标题
  assert.doesNotMatch(markup, /titlebar-profile-select/);
  assert.doesNotMatch(markup, /session-live-pulse/);
  assert.doesNotMatch(markup, /titlebar-bot-avatar/);
  assert.doesNotMatch(markup, /titlebar-session-title/);
  // 产品裁决（2026-11-20）：顶栏延迟数字与深浅色切换按钮全部拔除，
  // 设置键左移到左簇与 ☰ 同处一行；顶栏只保留连接指示点。
  assert.doesNotMatch(markup, /titlebar-latency/, '顶栏不得再渲染延迟数字读数');
  assert.doesNotMatch(markup, /18ms/, '顶栏不得再渲染 ms 数字');
  assert.doesNotMatch(markup, /titlebar-theme-toggle-btn/, '深浅色切换按钮必须已从顶栏删除');
  assert.match(markup, /titlebar-connection-indicator/, '连接状态仍以指示点表达');
  const leftCluster = /<div class="titlebar-left">([\s\S]*?)<\/div>/.exec(markup)?.[1] ?? '';
  assert.match(leftCluster, /toggle-left-rail-btn/, '左簇必须保留 ☰ 折叠键');
  assert.match(leftCluster, /btn-open-settings/, '设置键必须落在左簇');
  // 【必须整段截取】右簇内部含连接点内层 </div>，非贪婪正则会在那里提前结束，
  // 得到的片段永远不含任何按钮 —— 那样这条负向断言就是结构性恒真（审查实测：搬回右簇仍绿）。
  // 这里从右簇起点一直截到 header 收尾，保证覆盖整段右簇 DOM。
  const rightStart = markup.indexOf('class="titlebar-right"');
  assert.ok(rightStart > 0, '右簇必须存在');
  const rightCluster = markup.slice(rightStart);
  assert.equal(rightCluster.includes('btn-open-settings'), false, '设置键不得残留在右簇');
  assert.equal(rightCluster.includes('toggle-inspector-btn'), true, '右簇必须承载检查舱开关（截取区间正确性的正向对照）');
  assert.deepEqual(calls, []);
});

test('Titlebar 最大化态必须换成「还原」字形（双框），不得继续用单框', () => {
  const base = {
    platform: 'windows', title: 'Session', gatewayConnected: true, leftRailCollapsed: false, inspectorCollapsed: true,
    onMinimize() {}, onMaximize() {}, onClose() {}, onToggleLeftRail() {}, onToggleInspector() {}, onOpenSettings() {},
  };
  const maximized = renderToStaticMarkup(React.createElement(Titlebar, { ...base, isMaximized: true }));
  const normal = renderToStaticMarkup(React.createElement(Titlebar, { ...base, isMaximized: false }));

  // 还原字形：后框只画上半与左半（唯一路径 M2.6 10.2V4.6）；最大化字形：9.6px 单框（x="3.2" y="3.2"）。
  assert.match(maximized, /M2\.6 10\.2V4\.6/, '最大化态必须渲染还原双框路径');
  assert.equal(maximized.includes('x="3.2" y="3.2"'), false, '最大化态不得残留最大化单框');
  assert.match(normal, /x="3\.2" y="3\.2"/, '普通态必须渲染最大化单框');
  assert.equal(normal.includes('M2.6 10.2V4.6'), false, '普通态不得渲染还原双框');
  // 窗控三键与提示文案必须随状态切换，否则用户无法判断当前是还原还是最大化。
  assert.match(maximized, /向下还原/, '最大化态按钮 title 必须为「向下还原」');
  assert.match(normal, /最大化/, '普通态按钮 title 必须为「最大化」');
});

test('Titlebar 折叠态经 data 属性暴露左栏状态，供 CSS 切换顶栏左段宽度', () => {
  const base = {
    platform: 'windows', title: 'Session', isMaximized: false, gatewayConnected: false, inspectorCollapsed: true,
    onMinimize() {}, onMaximize() {}, onClose() {}, onToggleLeftRail() {}, onToggleInspector() {}, onOpenSettings() {},
  };
  const collapsed = renderToStaticMarkup(React.createElement(Titlebar, { ...base, leftRailCollapsed: true }));
  const expanded = renderToStaticMarkup(React.createElement(Titlebar, { ...base, leftRailCollapsed: false }));
  assert.match(collapsed, /data-left-rail-collapsed="true"/);
  assert.match(expanded, /data-left-rail-collapsed="false"/);
  // false 必须显式序列化，绝不能省略属性——CSS 选择器 [data-left-rail-collapsed="true"] 依赖它存在
  assert.equal((expanded.match(/data-left-rail-collapsed/g) ?? []).length, 1, '属性必须恰好出现一次且值为 false，不得省略');
});

test('Titlebar 检查舱折叠态经 data 属性驱动标题居中基准', () => {
  const base = {
    platform: 'windows', title: 'Session', isMaximized: false, gatewayConnected: false, leftRailCollapsed: false,
    onMinimize() {}, onMaximize() {}, onClose() {}, onToggleLeftRail() {}, onToggleInspector() {}, onOpenSettings() {},
  };
  const open = renderToStaticMarkup(React.createElement(Titlebar, { ...base, inspectorCollapsed: false }));
  const collapsed = renderToStaticMarkup(React.createElement(Titlebar, { ...base, inspectorCollapsed: true }));

  // 这条属性决定 --geo-titlebar-right-offset 是 0 还是 420px。
  // 若恒为 "true"，检查舱展开时标题会右偏 210px；若恒为 "false"，默认态左偏 210px。
  assert.match(open, /data-inspector-collapsed="false"/, '检查舱展开必须输出 false，否则 CSS 不让位');
  assert.match(collapsed, /data-inspector-collapsed="true"/, '检查舱折叠必须输出 true，否则标题偏左 210px');

  // 缺省（不传）必须视为「折叠」，与 appState.inspectorCollapsed 默认值 true 一致
  const omitted = renderToStaticMarkup(React.createElement(Titlebar, base));
  assert.match(omitted, /data-inspector-collapsed="true"/, '未传 inspectorCollapsed 时必须按折叠处理（与 appState 默认值一致）');
});

test('Titlebar omits macOS traffic controls on Windows', () => {
  const markup = renderToStaticMarkup(React.createElement(Titlebar, {
    platform: 'windows', title: 'Session', isMaximized: false, gatewayConnected: false, leftRailCollapsed: false,
    onMinimize() {}, onMaximize() {}, onClose() {}, onToggleLeftRail() {}, onToggleInspector() {}, onOpenSettings() {},
  }));
  assert.match(markup, /win-caption-controls/);
  assert.doesNotMatch(markup, /traffic-close/);
});

test('StatusBar renders the state via data-status and keeps latency in the status area', () => {
  const markup = renderToStaticMarkup(React.createElement(StatusBar, {
    connectionStatus: 'connected', latencyMs: 27, serverLocation: 'Local', onClickStatus() {},
  }));
  assert.match(markup, /status-bar-server-node/);
  assert.match(markup, /27ms/);
  // 连接态断言落在 data-status 上：文案随语言变化，属性不会
  assert.match(markup, /data-status="connected"/);
});

test('shell snapshot readers preserve platform, title, connection and status latency values', () => {
  assert.deepEqual(getTitlebarSnapshot({ platform: 'macos', title: 'Session', isMaximized: false, gatewayConnected: true, leftRailCollapsed: false }), {
    platform: 'macos', title: 'Session', isMaximized: false, gatewayConnected: true, leftRailCollapsed: false,
  });
  assert.deepEqual(getStatusBarSnapshot({ connectionStatus: 'connected', latencyMs: 18 }), { connectionStatus: 'connected', latencyMs: 18 });
});

test('theme archive validation rejects ghosts and preserves registered aliases', () => {
  assert.equal(resolveSkinId('not-a-skin'), 'obsidian-gold');
  assert.equal(resolveSkinId('suet-jade'), 'suet-jade');
  assert.equal(resolveSkinId('jade-white'), 'jade-white');
});

test('shell mount bridge rejects missing hosts and forwards render updates to the injected root', () => {
  assert.throws(() => createShellMountUpdater(null, 'first', () => ({ render() {} })), /host must be connected/);
  assert.throws(() => createShellMountUpdater({ isConnected: false }, 'first', () => ({ render() {} })), /host must be connected/);
  const renders = [];
  const host = { isConnected: true };
  const update = createShellMountUpdater(host, 'first', (receivedHost) => {
    assert.equal(receivedHost, host);
    return { render(value) { renders.push(value); } };
  });
  update('second');
  assert.deepEqual(renders, ['first', 'second']);
});

test('React color utilities compile from the theme map, and the probe detects a missing control selector', () => {
  const sourceDir = path.resolve(import.meta.dirname, '../src/components-react');
  const css = fs.readFileSync(path.resolve(import.meta.dirname, '../../desktop/dist/renderer/tailwind.css'), 'utf8');
  const sourceFiles = fs.readdirSync(sourceDir, { recursive: true }).filter((file) => file.endsWith('.tsx'));
  const utilityNames = new Set();
  for (const file of sourceFiles) {
    const source = fs.readFileSync(path.join(sourceDir, file), 'utf8');
    for (const match of source.matchAll(/\b(?:bg|text|border)-([a-z][a-z0-9-]*)\b/g)) {
      if (['body', 'caption'].includes(match[1])) continue;
      utilityNames.add(match[0]);
    }
  }
  for (const utility of utilityNames) assert.ok(css.includes(utility), `Tailwind output is missing ${utility}`);
  assert.ok(css.includes('.bg-backdrop\\/80'), 'positive control: the overlay color utility is present');
  assert.equal(css.includes('.bg-not-a-theme-token'), false, 'negative control: an absent utility stays absent');
});
