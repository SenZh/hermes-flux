/**
 * 窗口态广播的副作用层守卫。
 *
 * 设计意图 (Why)：
 *   纯函数 resolveTitlebarMaximized 只能证明"给定探针如何判定"。真正会回归的失败模式在
 *   副作用层：把窗口真值回读改回硬编码 false。这类改动没有任何行为测试能感知，
 *   只能用静态结构断言钉死"探针必须来自窗口、判定必须走纯函数"。
 *
 * 防范的历史坑 (Pitfall)：
 *   全屏退出时若广播 isMaximized:false，从最大化态进全屏再退出的窗口会显示"最大化"图标，
 *   点它什么也不会发生 —— 正是本次要修的按钮失活形态。
 *
 * 约束与规则 (Rules)：
 *   enter/leave-full-screen 一律经 resolveTitlebarMaximized 求值，且探针必须读 win 原生句柄；
 *   禁止在该两条分支内出现字面量 isMaximized: true|false。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 截取某个 `win.on('<event>', () => { ... })` 回调体（括号配平，避免正则跨块误匹配）。 */
function extractHandler(source, event) {
  const marker = `win.on('${event}'`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `window.ts 必须监听 ${event}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart, i + 1);
    }
  }
  assert.fail(`未能截取 ${event} 回调体`);
}

test('window.ts：全屏事件必须回读窗口真值并经纯函数求值', async (t) => {
  const src = read('packages/desktop/src/main/window.ts');

  for (const event of ['enter-full-screen', 'leave-full-screen']) {
    await t.test(event, () => {
      const body = extractHandler(src, event);
      assert.ok(
        body.includes('resolveTitlebarMaximized('),
        `${event} 必须经 resolveTitlebarMaximized 求值，禁止内联三元/字面量判定`,
      );
      assert.ok(body.includes('win.isMaximized()'), `${event} 的探针必须回读 win.isMaximized() 真值`);
      assert.equal(
        /\bisMaximized:\s*(true|false)\b/.test(body),
        false,
        `${event} 禁止广播字面量 isMaximized: true|false（会与真实窗口态撕裂）`,
      );
    });
  }
});

test('window.ts：进入全屏必须显式声明全屏探针为真', () => {
  const body = extractHandler(read('packages/desktop/src/main/window.ts'), 'enter-full-screen');
  assert.ok(body.includes('isFullScreen: true'), 'enter-full-screen 必须显式传入 isFullScreen: true');
});

test('window.ts：退出全屏必须显式声明全屏探针为假', () => {
  const body = extractHandler(read('packages/desktop/src/main/window.ts'), 'leave-full-screen');
  assert.ok(body.includes('isFullScreen: false'), 'leave-full-screen 必须显式传入 isFullScreen: false');
});

test('ipc.ts：最大化通道必须经纯决策层且返回值回读真值', () => {
  const src = read('packages/desktop/src/main/ipc.ts');
  const start = src.indexOf("ipcMain.handle('window:maximize'");
  assert.notEqual(start, -1, 'ipc.ts 必须注册 window:maximize');
  const end = src.indexOf("ipcMain.handle('window:unmaximize'", start);
  assert.notEqual(end, -1, 'window:maximize 之后必须紧跟 window:unmaximize');
  const body = src.slice(start, end);

  assert.ok(body.includes('resolveWindowToggle('), 'window:maximize 必须经 resolveWindowToggle 三向裁定');
  assert.ok(body.includes('readTitlebarMaximized(mainWindow)'), 'window:maximize 必须回读窗口真值，禁止硬编码返回值');
  assert.equal(/\breturn\s+(true|false)\s*;/.test(body), false, 'window:maximize 禁止返回字面量布尔值');
});
