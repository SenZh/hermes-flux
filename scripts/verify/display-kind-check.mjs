#!/usr/bin/env node
/**
 * display_kind 渲染实证（真实 Blink 内核 + 真实编译产物）
 *
 * 【设计意图 (Why)】
 *   单测只能证明投影函数与结构钩子；气泡到底画成什么样，必须用真实渲染器在真实内核里跑一次。
 *   本脚本把四条真实样本按 parseRawMessages 的产出形状喂给真实产物的 mountMessages，
 *   截图留证，并断言 hidden 行没有 DOM、事件行不是用户气泡。
 *
 * 【约束与规则 (Rules)】
 *   - 只用 packages 各包的 dist 产物，禁止 mock 渲染层；
 *   - 证据写入 artifacts/verification/display-kind/，teardown 后仍可查；
 *   - 断言失败必须非零退出。
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { createDriveSession } from './control-flux.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const outDir = path.join(rootDir, 'artifacts/verification/display-kind');

// harness 的渲染桥必须现场打包成 IIFE：浏览器无法解析裸模块说明符。
const bundleOut = path.join(rootDir, 'packages/desktop/__tests__/cdp/.tmp/e2e-entry.js');
fs.mkdirSync(path.dirname(bundleOut), { recursive: true });
await esbuild.build({
  entryPoints: [path.join(rootDir, 'packages/ui/__tests__/cdp/e2e-entry.mjs')],
  outfile: bundleOut,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
});

/** 与 projectDisplay 的产出形状一致：parseRawMessages 写进 MessageViewModel 后的样子。 */
const MESSAGES = [
  { id: 'u1', role: 'user', content: '请把这段文案改得更有冲击力', displayKind: 'user', timestamp: '14:20:00' },
  { id: 'h1', role: 'user', content: '[System: The active model for this chat has changed to x]', displayKind: 'hidden', timestamp: '14:20:01' },
  { id: 'e1', role: 'user', content: '[System: model changed]', displayKind: 'model_switch', timestamp: '14:20:02' },
  { id: 'a1', role: 'assistant', content: '好的，我来改写。', displayKind: 'user', timestamp: '14:20:03' },
  { id: 'e2', role: 'user', content: '分段: 4 段，长度 [522, 527, 506, 129]', displayKind: 'process_complete', displayMetadata: { display_text: 'Background Process Finished: python3 humanizer.py' }, timestamp: '14:20:04' },
  { id: 's1', role: 'user', content: '我觉得我们应该先把文章写得更好一点', displayKind: 'steer', timestamp: '14:20:05' },
  { id: 'e3', role: 'user', content: '3 background agents finished', displayKind: 'async_delegation_complete', displayMetadata: { task_count: 3 }, timestamp: '14:20:06' },
];

const session = await createDriveSession({ width: 1280, height: 900 });
let failed = false;

try {
  await session.evaluate(`(() => {
    window.cdpApp.messages = ${JSON.stringify(MESSAGES)};
    window.cdpApp.render();
    return true;
  })()`);
  await session.waitFor('document.querySelectorAll("[data-msg-id]").length > 0', 15000, 'messages mounted');

  const probe = await session.evaluate(`(() => {
    const ids = Array.from(document.querySelectorAll('[data-msg-id]')).map((el) => el.getAttribute('data-msg-id'));
    const events = Array.from(document.querySelectorAll('[data-event-kind]')).map((el) => el.getAttribute('data-event-kind'));
    const bubbles = document.querySelectorAll('.conv-message__bubble');
    const bubbleTexts = Array.from(bubbles).map((el) => el.textContent.trim());
    const labels = Array.from(document.querySelectorAll('.conv-event__label')).map((el) => el.textContent.trim());
    return { ids, events, labels, bubbleCount: bubbles.length, bubbleTexts };
  })()`);

  const checks = [
    ['hidden 行不上屏', !probe.ids.includes('h1')],
    ['hidden 行不制造空回合', !probe.events.includes('hidden')],
    ['model_switch 画时间线标记', probe.events.includes('model_switch')],
    ['process_complete 画时间线标记', probe.events.includes('process_complete')],
    ['async_delegation_complete 画时间线标记', probe.events.includes('async_delegation_complete')],
    ['时间线事件集合精确匹配', JSON.stringify(probe.events) === JSON.stringify(['model_switch', 'process_complete', 'async_delegation_complete'])],
    ['steer 显示用户原话', probe.bubbleTexts.some((t) => t.includes('先把文章写得更好一点'))],
    ['用户气泡数量正确（u1 + steer）', probe.bubbleCount === 2],
    ['机器正文没有漏进气泡', !probe.bubbleTexts.some((t) => t.includes('Background Process') || t.includes('[System:') || t.includes('background agents'))],
    ['时间线标签已本地化（无网关英文原文）', !probe.labels.some((t) => /Background Process Finished|Model Changed|Background Agents Finished/.test(t))],
  ];

  for (const [label, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failed = true;
  }

  console.log('probe =', JSON.stringify(probe));
  const shot = await session.screenshot(path.join(outDir, 'display-kind.png'));
  console.log(`screenshot: ${path.relative(rootDir, shot)}`);

  fs.writeFileSync(
    path.join(outDir, 'evidence.json'),
    JSON.stringify(
      {
        feature: 'display-kind',
        capturedAt: new Date().toISOString(),
        surface: 'real Blink kernel + packages/*/dist build output',
        input: MESSAGES.map((m) => ({ id: m.id, displayKind: m.displayKind ?? 'user' })),
        dom: probe,
        assertions: checks.map(([label, ok]) => ({ label, ok })),
        screenshot: 'display-kind.png',
      },
      null,
      2
    ),
    'utf8'
  );
  console.log('evidence: artifacts/verification/display-kind/evidence.json');
} finally {
  await session.cleanup();
}

if (failed) {
  console.error('display_kind 渲染实证未通过');
  process.exit(1);
}
console.log('display_kind 渲染实证全部通过');
