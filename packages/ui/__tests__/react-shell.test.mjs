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
    platform: 'macos', title: 'Session', isMaximized: false, gatewayConnected: true, latencyMs: 18,
    activeAvatar: { kind: 'bot', name: 'aura', avatar: 'data:image/png;base64,mock' },
    onMinimize: () => calls.push('minimize'), onMaximize: () => calls.push('maximize'), onClose: () => calls.push('close'),
    onToggleLeftRail: () => calls.push('rail'), onToggleInspector: () => calls.push('inspector'),
    onOpenSettings: () => calls.push('settings'), onToggleTheme: () => calls.push('theme'),
  }));
  assert.match(markup, /traffic-close/);
  assert.match(markup, /data-testid="react-titlebar"/);
  assert.match(markup, /toggle-inspector-btn/);
  // 产品裁决（PR-3e）：顶栏承载低调延迟与真实头像，不再承载 profile 下拉与 session-live-pulse
  assert.doesNotMatch(markup, /titlebar-profile-select/);
  assert.doesNotMatch(markup, /session-live-pulse/);
  assert.match(markup, /titlebar-latency/);
  assert.match(markup, /18ms/);
  assert.match(markup, /titlebar-bot-avatar/);
  assert.deepEqual(calls, []);
});

test('Titlebar omits macOS traffic controls on Windows', () => {
  const markup = renderToStaticMarkup(React.createElement(Titlebar, {
    platform: 'windows', title: 'Session', isMaximized: false, gatewayConnected: false,
    onMinimize() {}, onMaximize() {}, onClose() {}, onToggleLeftRail() {}, onToggleInspector() {}, onOpenSettings() {}, onToggleTheme() {},
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
  assert.deepEqual(getTitlebarSnapshot({ platform: 'macos', title: 'Session', isMaximized: false, gatewayConnected: true }), {
    platform: 'macos', title: 'Session', isMaximized: false, gatewayConnected: true,
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
