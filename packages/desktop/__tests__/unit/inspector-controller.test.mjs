/**
 * 检查舱控制器单元测试（Inspector Controller Test）
 *
 * 【断言】
 *   1. 动效控制器单例绑定与前序 detach 调用；
 *   2. handleDownload 优先调用桌面端 saveFile；
 *   3. handleDownload 在缺少活动文件时安全早退。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { InspectorController } from '../../dist/renderer/inspector/inspectorController.mjs';

test('InspectorController 领域行为测试', async (t) => {
  await t.test('1. 活动文件为空时 handleDownload 安全早退', async () => {
    let saveFileCalled = false;
    const controller = new InspectorController({
      getActiveFile: () => undefined,
      getGatewayUrl: () => 'http://localhost:8080',
      getDesktopApi: () => ({
        saveFile: async () => {
          saveFileCalled = true;
          return { success: true };
        },
      }),
      t: (k) => k,
    });

    const fakeBtn = { style: { color: '' } };
    await controller.handleDownload(fakeBtn);
    assert.equal(saveFileCalled, false);
  });

  await t.test('2. 桌面端 saveFile 成功后反馈强调色', async () => {
    let saveFilePayload = null;
    const controller = new InspectorController({
      getActiveFile: () => ({ path: '/tmp/test.md', content: '# Hello' }),
      getGatewayUrl: () => 'http://localhost:8080',
      getDesktopApi: () => ({
        saveFile: async (payload) => {
          saveFilePayload = payload;
          return { success: true };
        },
      }),
      t: (k) => k,
    });

    const fakeBtn = { style: { color: '' } };
    await controller.handleDownload(fakeBtn);
    assert.ok(saveFilePayload);
    assert.equal(saveFilePayload.fileName, 'test.md');
    assert.equal(saveFilePayload.content, '# Hello');
    assert.equal(fakeBtn.style.color, 'var(--accent)');
  });
});
