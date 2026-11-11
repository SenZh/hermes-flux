import test from 'node:test';
import assert from 'node:assert/strict';
import { planOlderBatchPrependMerge } from '../../dist/session/olderBatchMerge.js';

const row = (rowId) => ({ id: `m-${rowId}`, rowId, sessionId: 'sess', rawTimestamp: rowId });

/**
 * 生产缺陷回归：向上翻页后，列表最顶部的"最老一条"其实是比本地首条更晚的行。
 *
 * 【实测依据】修复前同一输入返回 630 条、首行 29884（用户看到的错位顶部）；
 *   正确行为是丢弃整批、保持 130 条、首行 1000。
 * 【约束与规则 (Rules)】本用例刻意只用旧签名调用，不依赖修复新增的可选参数，
 *   保证它对"退回旧实现"具备杀伤力（已用移除边界过滤的变异实测变红）。
 */
test('向早翻页合并 - 批次完全晚于本地首条时整批丢弃，绝不把更晚的行搬到列表最前', () => {
  const current = Array.from({ length: 130 }, (_, i) => row(1000 + i));
  const batch = Array.from({ length: 500 }, (_, i) => row(29884 + i));

  const merged = planOlderBatchPrependMerge(batch, current);

  assert.equal(merged.length, 130, '晚于本地首条的整批必须丢弃');
  assert.equal(merged[0].rowId, 1000, '本地首条必须保持不动');
});
