import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  hasLegacyUnorderedCacheRows,
  shouldTreatOlderDropAsExhausted,
  computeOlderBatchWindowStart,
} from '../../dist/renderer/messageWindow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererSource = readFileSync(
  path.resolve(__dirname, '../../src/renderer/index.ts'),
  'utf8'
);

test('hasLegacyUnorderedCacheRows: 正确识别缺少 displaySeq 的旧版毒缓存，空数组不误报', () => {
  assert.equal(hasLegacyUnorderedCacheRows([]), false, '空缓存不得误判为旧毒缓存');
  assert.equal(
    hasLegacyUnorderedCacheRows([{ displaySeq: 1 }, { displaySeq: 2 }]),
    false,
    '全部带有有限数字 displaySeq 时为干净缓存'
  );
  assert.equal(
    hasLegacyUnorderedCacheRows([{ displaySeq: 1 }, {}]),
    true,
    '任一行缺少 displaySeq 即必须判为旧毒缓存'
  );
  assert.equal(
    hasLegacyUnorderedCacheRows([{ displaySeq: Number.NaN }]),
    true,
    '非有限数字 displaySeq 同样视为不可信'
  );
});

test('shouldTreatOlderDropAsExhausted: 仅整批全被过滤才终止，部分重叠页的少数边界差异不得掐死翻页', () => {
  // 真实故障场景：265 条重叠页有 1 条批首合成行不在 heldKeys，droppedCount=1
  assert.equal(shouldTreatOlderDropAsExhausted(0, 265, 1), false, '部分丢行绝不可掐死后续翻页');
  assert.equal(shouldTreatOlderDropAsExhausted(0, 265, 264), false);
  assert.equal(shouldTreatOlderDropAsExhausted(0, 265, 265), true, '整批全被过滤必须终止防止跳段');
  assert.equal(shouldTreatOlderDropAsExhausted(3, 265, 265), false, '只要有净增就不算边界耗尽');
  assert.equal(shouldTreatOlderDropAsExhausted(0, 0, 0), false, '空批次不得误判');
});

test('computeOlderBatchWindowStart: 末轮新增可装入单窗口时起点直接对齐 0，中间页保留 8 行上文缓冲', () => {
  assert.equal(computeOlderBatchWindowStart(11, true, 120), 0, '末轮 11 条必须从 0 开始挂载，避免首问卡在窗口外');
  assert.equal(computeOlderBatchWindowStart(120, true, 120), 0);
  assert.equal(computeOlderBatchWindowStart(121, true, 120), 113, '超过单窗口容量仍保持 8 行缓冲');
  assert.equal(computeOlderBatchWindowStart(253, false, 120), 245, '非末轮保持 added - 8 缓冲');
  assert.equal(computeOlderBatchWindowStart(0, true, 120), 0);
});

test('渲染层接线守卫：旧毒缓存只可在远端权威响应成功后清洗，断网绝不毁掉离线缓存', () => {
  const openIdx = rendererSource.indexOf('cacheService.openChannel(cacheRef');
  const restIdx = rendererSource.indexOf('gatewayClient.fetchSessionMessages(sessionId');
  assert.ok(openIdx > 0 && restIdx > openIdx);

  // 第 2.5 步持久化读取到第 4 步发 REST 之间，绝对禁止出现 dropChannel
  const cacheHitBlock = rendererSource.slice(openIdx, restIdx);
  assert.equal(
    cacheHitBlock.includes('dropChannel('),
    false,
    '断网或服务端失败前严禁清空本地旧缓存，否则离线用户会直接白屏'
  );
  assert.ok(
    rendererSource.includes('hasLegacyUnorderedCacheRows(rows)'),
    '必须标记旧毒缓存待权威到达后清洗'
  );
  assert.ok(
    cacheHitBlock.includes('syncUntrustedCacheOrderFlag(sessionId, opened.rows)'),
    '读取持久缓存时必须检查并记录旧毒缓存标记'
  );
  assert.ok(
    cacheHitBlock.includes('sortByDisplayAsc(opened.rows)'),
    '持久化恢复必须走 sortByDisplayAsc，禁止直接按 orderKey 反转'
  );

  // REST 与 WS fallback 两个权威成功块内都必须消费 untrustedOrderCacheSessions 并清洗重建
  const restSuccessStart = rendererSource.indexOf("if (outcome.status === 'success' && outcome.messages.length > 0)");
  const restSuccessBlock = rendererSource.slice(restSuccessStart, restSuccessStart + 900);
  assert.ok(restSuccessBlock.includes('untrustedOrderCacheSessions.delete(sessionId)'));
  assert.ok(restSuccessBlock.includes('await cacheService.dropChannel(cacheRef)'));

  const wsFallbackStart = rendererSource.indexOf('if (!fastLoaded) {');
  const wsFallbackBlock = rendererSource.slice(wsFallbackStart, wsFallbackStart + 1000);
  assert.ok(wsFallbackBlock.includes('untrustedOrderCacheSessions.delete(sessionId)'));
  assert.ok(wsFallbackBlock.includes('await cacheService.dropChannel(cacheRef)'));

  // 翻页两处窗口起点与边界异常均接入纯函数
  assert.equal((rendererSource.match(/computeOlderBatchWindowStart\(/g) || []).length >= 2, true);
  assert.ok(rendererSource.includes('shouldTreatOlderDropAsExhausted(added, batch.length, mergeResult.droppedCount)'));
});
