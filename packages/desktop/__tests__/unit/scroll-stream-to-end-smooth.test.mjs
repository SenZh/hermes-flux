/**
 * 平滑回底写入的落盘断言。
 *
 * 【断言与杀伤力】
 *   1. 必须真实调用 `scrollTo({ top, behavior: 'smooth' })`，目标为 scrollHeight - clientHeight；
 *   2. 必须调用 markProgrammaticScroll，供既有忽略窗识别；
 *   3. stream 缺失或内容不足一屏时必须返回 false，调用方据此回 idle。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { StreamViewportManager } from '../../dist/renderer/viewport/streamViewportManager.mjs';

function makeManager(stream) {
  const marked = [];
  const manager = new StreamViewportManager({
    getStreamElement: () => stream,
    getActiveSessionId: () => 'session-1',
    getPresenceLayout: () => 'stage',
    isPromptJumpSettling: () => false,
    getMessageWindowEnd: () => 0,
    getTotalMessages: () => 0,
    layoutSignature: () => '',
    markProgrammaticScroll: (el) => marked.push(el),
  });
  return { manager, marked };
}

test('scrollStreamToEndSmooth: 参数、标记与失败分支', async (t) => {
  await t.test('1. 正常路径写入最新底边并标记程序化滚动', () => {
    const calls = [];
    const stream = { scrollHeight: 1000, clientHeight: 400, scrollTo: (options) => calls.push(options) };
    const { manager, marked } = makeManager(stream);

    assert.equal(manager.scrollStreamToEndSmooth(1000), true);
    assert.deepEqual(calls, [{ top: 600, behavior: 'smooth' }]);
    assert.equal(marked.length, 1, '必须标记程序化滚动');
  });

  await t.test('2. 未传目标时取当前 scrollHeight', () => {
    const calls = [];
    const stream = { scrollHeight: 900, clientHeight: 300, scrollTo: (options) => calls.push(options) };
    const { manager } = makeManager(stream);

    assert.equal(manager.scrollStreamToEndSmooth(), true);
    assert.deepEqual(calls, [{ top: 600, behavior: 'smooth' }]);
  });

  await t.test('3. 无 stream 或内容不足一屏时返回 false', () => {
    const { manager: noStream } = makeManager(null);
    assert.equal(noStream.scrollStreamToEndSmooth(1000), false);

    const shortStream = { scrollHeight: 300, clientHeight: 400, scrollTo: () => { throw new Error('不得调用'); } };
    const { manager: shortManager } = makeManager(shortStream);
    assert.equal(shortManager.scrollStreamToEndSmooth(300), false);
  });
});
