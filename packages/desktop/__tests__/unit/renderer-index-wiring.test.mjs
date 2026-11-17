/**
 * 渲染进程入口装配守卫。
 *
 * 【设计意图 (Why)】
 *   历史坑：视口管理器曾漏掉实例化，`render()` 每帧调用 `captureStreamAnchor()` 直接
 *   TypeError，整屏白屏且在静态检查下完全不可见。这条测试守的是「入口装配真的能跑起来」。
 *
 * 【约束与规则 (Rules)】
 *   1. 必须真实 `require` 入口产物：静态断言拦不住「装配写在运行期才执行的路径」，
 *      而入口里 `captureStreamAnchor` / `feedTurnWatchdog` 的接线只在顶层对象字面量执行；
 *   2. 必须提供最小 window/document/localStorage 桩，否则模块级 DOM 访问直接抛错；
 *   3. 收尾 unref 残留 MessagePort，避免测试进程被句柄挂住。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

test('renderer index 顶层装配：入口必须真实构造视口管理器与看门狗接线', () => {
  if (!globalThis.window) {
    globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} };
  }
  if (!globalThis.document) {
    globalThis.document = {
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {} }),
      documentElement: { style: { setProperty: () => {} }, dataset: {} },
    };
  }
  if (!globalThis.localStorage) {
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  }

  const source = fs.readFileSync(new URL('../../src/renderer/index.ts', import.meta.url), 'utf8');
  assert.match(
    source,
    /streamViewportManager = createDesktopStreamViewport\(\{/,
    '入口必须真实构造视口管理器，否则 render() 每帧都会 TypeError'
  );
  assert.match(source, /feedTurnWatchdog: \(\) => turnExecutionService\.feedTurnWatchdog\(\)/, '入口必须把喂狗通道接进事件分发器');

  const req = createRequire(import.meta.url);
  try {
    assert.doesNotThrow(
      () => req('../../dist/renderer/index.js'),
      'renderer index.js 必须在 headless 运行时完成全部顶层装配而不抛错'
    );
  } finally {
    for (const h of process._getActiveHandles()) {
      if (h?.constructor?.name === 'MessagePort') {
        h.unref();
      }
    }
  }
});
