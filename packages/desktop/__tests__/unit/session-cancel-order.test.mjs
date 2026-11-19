/**
 * 切会话取消平滑会话的时序守卫。
 *
 * 【断言与杀伤力】`cancelSmoothScrollOnLeave` 必须出现在 `captureStreamAnchor` 之前；
 *   删掉该调用或把它挪到锚点捕获之后，本用例立刻失败。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SOURCE = fs.readFileSync('packages/desktop/src/renderer/services/sessionOperationService.ts', 'utf8');

test('切会话取消平滑必须早于 captureStreamAnchor', () => {
  const cancelAt = SOURCE.indexOf('this.deps.cancelSmoothScrollOnLeave?.()');
  const captureAt = SOURCE.indexOf('this.deps.captureStreamAnchor?.()');
  assert.ok(cancelAt >= 0, '必须存在取消调用');
  assert.ok(captureAt >= 0, '必须存在锚点捕获');
  assert.ok(cancelAt < captureAt, '取消必须早于锚点捕获，否则会写入平滑半路坐标');
});
