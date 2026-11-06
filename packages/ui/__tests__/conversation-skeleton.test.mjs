/**
 * 对话区骨架守卫测试（P0）
 *
 * 设计意图(Why)：
 *   静态门禁默认不扫 .css，`packages/ui/src/styles/` 也不在换肤扫描面内；
 *   没有守卫，裸色值、smooth 滚动、裸字号会静默进入产物。
 *
 * 约束与规则(Rules)：
 *   只断言结构与禁令，不断言具体像素值；像素由 CDP 计算样式断言负责。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('对话区 CSS：四个结构选择器、无裸色值、无 smooth、无裸字号', () => {
  const css = read('packages/ui/src/styles/conversation.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const sel of ['.conversation-pod', '.conv-stream', '.conv-canvas', '.conv-dock-scrim']) {
    assert.ok(css.includes(sel), `缺少结构选择器 ${sel}`);
  }
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'conversation.css 禁止色值字面量');
  assert.ok(!/\brgba?\(/.test(css), 'conversation.css 禁止 rgb/rgba 字面量');
  assert.ok(!/\bhsla?\(/.test(css), 'conversation.css 禁止 hsl 字面量');
  assert.ok(!/scroll-behavior:\s*smooth/.test(css), '滚动容器禁止 smooth');
  assert.ok(!/font-size:\s*\d+px/.test(css), '禁止裸字号，必须使用字阶变量');
});

test('MiddlePod 四容器：结构类与 data-conv-layer 钩子，几何不得留在模板', () => {
  const ts = read('packages/ui/src/components/MiddlePod/MiddlePod.ts');
  for (const layer of ['stage', 'canvas', 'stream', 'scrim']) {
    assert.ok(ts.includes(`data-conv-layer="${layer}"`), `缺少 data-conv-layer="${layer}"`);
  }
  assert.ok(!/padding:\s*24px 32px 180px/.test(ts), '画布内距必须迁入 CSS，不得留在模板');
  assert.ok(!/gap:\s*18px/.test(ts), '画布 gap 必须迁入 CSS');
});

test('构建与预览链路：conversation.css 三处接入且顺序正确', () => {
  const build = read('packages/desktop/scripts/build.mjs');
  assert.ok(build.includes("'conversation.css'"), 'build.mjs 必须复制 conversation.css');

  const html = read('packages/desktop/src/renderer/index.html');
  const iStyles = html.indexOf('href="styles.css"');
  const iConv = html.indexOf('href="conversation.css"');
  const iTailwind = html.indexOf('href="tailwind.css"');
  assert.ok(iStyles >= 0, 'index.html 缺少 styles.css');
  assert.ok(iConv > iStyles && iConv < iTailwind, 'CSS 顺序必须为 styles → conversation → tailwind');

  const live = read('scripts/start-browser-live.mjs');
  assert.ok(live.includes('/renderer/conversation.css'), '浏览器直跑链路必须加载 conversation.css');
});
