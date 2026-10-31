/**
 * 移动端多平台响应式、断点选择器真实性与桌面窗口控件剥离测试 (Gate 0-Mobile & Gate 4)
 *
 * 覆盖四大象限：
 * 1. 正向路径：Android / iOS 移动端平台下，Titlebar 彻底剥离桌面 Windows 三键与 Mac 三色灯；
 * 2. 桌面对比：Windows 平台保留 win-caption-controls，macOS 平台保留 mac-traffic-lights；
 * 3. 边界值断言：CSS 媒体查询选择器实名一致性，严禁出现 .left-rail / .input-dock 等失效死选择器；
 * 4. 变异检验：故意改错平台判断或保留死选择器时，本测试必须 100% 变红。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTitlebar } from '../dist/components/Titlebar/Titlebar.js';
import { renderLeftRail } from '../dist/components/LeftRail/LeftRail.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');

test('Mobile & Cross-Platform Responsive Layout Invariants', async (t) => {
  await t.test('1. 移动端平台必须彻底剥离 Windows 缩放三键与 macOS 交通灯', () => {
    // 1. Arrange & Act: 渲染 Android 移动端标题栏
    const androidHtml = renderTitlebar({
      platform: 'android',
      title: 'Hermes Flux 移动端测试',
      gatewayConnected: true,
      isMaximized: false,
    });

    // 3. Assert: 移动端绝不能出现桌面窗控按钮
    assert.equal(
      androidHtml.includes('win-caption-controls'),
      false,
      'Android 平台 Titlebar 严禁包含 win-caption-controls 桌面窗控'
    );
    assert.equal(
      androidHtml.includes('win-cap-btn'),
      false,
      'Android 平台 Titlebar 严禁包含 win-cap-btn 按钮'
    );
    assert.equal(
      androidHtml.includes('mac-traffic-lights'),
      false,
      'Android 平台 Titlebar 严禁包含 mac-traffic-lights 交通灯'
    );

    // 1. Arrange & Act: 渲染 iOS 移动端标题栏
    const iosHtml = renderTitlebar({
      platform: 'ios',
      title: 'Hermes Flux iOS 测试',
      gatewayConnected: true,
      isMaximized: false,
    });

    // 3. Assert: iOS 移动端绝不能出现桌面窗控按钮
    assert.equal(
      iosHtml.includes('win-caption-controls'),
      false,
      'iOS 平台 Titlebar 严禁包含 win-caption-controls 桌面窗控'
    );
    assert.equal(
      iosHtml.includes('mac-traffic-lights'),
      false,
      'iOS 平台 Titlebar 严禁包含 mac-traffic-lights 交通灯'
    );
  });

  await t.test('2. 桌面平台必须正确保留各自专属的原生窗控控件', () => {
    // Windows 平台必须包含 winControls
    const winHtml = renderTitlebar({
      platform: 'windows',
      title: 'Hermes Flux Windows',
      gatewayConnected: true,
      isMaximized: false,
    });
    assert.ok(winHtml.includes('win-caption-controls'), 'Windows 平台必须渲染 win-caption-controls');
    assert.ok(winHtml.includes('id="win-min-btn"'), 'Windows 平台必须包含 win-min-btn');
    assert.ok(winHtml.includes('id="win-max-btn"'), 'Windows 平台必须包含 win-max-btn');
    assert.ok(winHtml.includes('id="win-close-btn"'), 'Windows 平台必须包含 win-close-btn');

    // macOS 平台必须包含 macControls
    const macHtml = renderTitlebar({
      platform: 'macos',
      title: 'Hermes Flux macOS',
      gatewayConnected: true,
      isMaximized: false,
    });
    assert.ok(macHtml.includes('mac-traffic-lights'), 'macOS 平台必须渲染 mac-traffic-lights');
    assert.equal(macHtml.includes('win-caption-controls'), false, 'macOS 平台不应渲染 win-caption-controls');
  });

  await t.test('3. 移动端 CSS 媒体查询实名选择器一致性（严禁死选择器）', () => {
    // 读取生产环境 styles.css 并剥离注释，确保只对有效 CSS 规则断言
    const cssPath = path.join(REPO_ROOT, 'packages/desktop/src/renderer/styles.css');
    const rawCss = fs.readFileSync(cssPath, 'utf8');
    const cleanCss = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

    // 提取 @media (max-width: 768px) 块
    const mqMatch = /@media\s*\(\s*max-width\s*:\s*768px\s*\)\s*\{([\s\S]*?)\n\}/.exec(cleanCss);
    assert.ok(mqMatch, 'styles.css 中必须包含 @media (max-width: 768px) 移动端响应式适配块');

    const mqBody = mqMatch[1];

    // 断言严禁存在历史遗留的死类名选择器（注意 CSS 类名包含破折号，不能用单纯的 \b 判定）
    assert.equal(
      /\.left-rail(?![a-zA-Z0-9_-])/.test(mqBody),
      false,
      '媒体查询中严禁使用失效死选择器 .left-rail，必须对齐实际 DOM #flux-left-rail / .flux-left-rail'
    );
    assert.equal(
      /\.input-dock(?![a-zA-Z0-9_-])/.test(mqBody),
      false,
      '媒体查询中严禁使用失效死选择器 .input-dock，必须对齐实际 DOM .input-dock-container / .composer-dock'
    );

    // 断言必须存在真实 DOM 样式规则
    assert.ok(mqBody.includes('#flux-left-rail'), '媒体查询中必须包含 #flux-left-rail 规则');
    assert.ok(mqBody.includes('.gateway-onboarding-card'), '媒体查询中必须包含 .gateway-onboarding-card 自适应规则');
    assert.ok(mqBody.includes('#conversation-stream'), '媒体查询中必须包含 #conversation-stream 通栏撑满规则');
  });

  await t.test('4. 移动端左轨折叠态必须包含 display: none 避免空占位', () => {
    const collapsedHtml = renderLeftRail({
      collapsed: true,
      activeSessionId: '',
      sessions: [],
      profileName: 'default',
      gatewayOnline: false,
      gatewayLatencyMs: 0,
    });

    assert.ok(collapsedHtml.includes('rail-collapsed'), '折叠态必须带有 rail-collapsed 类');
    assert.match(collapsedHtml, /display:\s*none/, '折叠态必须包含 display: none 样式');
    assert.match(collapsedHtml, /width:\s*0px/, '折叠态必须宽度收敛为 0px');
  });
});
