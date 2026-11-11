import test from 'node:test';
import assert from 'node:assert/strict';
import { planOlderBatchPrependMergeDetailed } from '../../dist/session/olderBatchMerge.js';

/**
 * 生产缺陷回归：网关的物理 id 不单调于 display order。
 *
 * 【实测依据】会话 20261020_150348_4fe41e（网关 0.22.5）真实链路：
 *   首屏 limit=100 offset=0 → 翻页 offset=100 → offset=600 → offset=1100。
 *   offset=1100 那一批返回 24 组：18541,18542,17400,17401,17402,17405,17417,...,17435。
 *   此时本地最早显示行恰好是 17436（与批次末尾 17435 相邻但不相交，无任何共享行），
 *   旧判据「rowId < 本地最早」把 18541/18542 判成「不比本地更早」直接丢弃，
 *   视图停在 584 条、最早时间 15:05:25，而服务端真实起点是 15:04:38。
 *
 * 【官方依据】hermes-agent gateway/session_stored_reads.py:179 明文：
 *   "a durable id is not monotonic in display order"
 *   （新写入的行 id 更大，却排在搬运来的旧副本之前）。
 *
 * 【修复判据】判定「更早」必须有方向证据，两种证据任一成立即算更早：
 *   1. 有共享持久行 —— 重叠点是可信显示序边界，整批按服务端顺序拼接；
 *   2. 无共享行 —— 用时间戳定向：本行时间严格早于本地最早行即为更早。
 *   两者都不成立才按更晚处理（宁丢弃不颠倒，下一轮仍可重拉）。
 */

const row = (rowId, sessionId = 'sess', rawTimestamp = rowId) => ({ id: `m-${rowId}`, rowId, sessionId, rawTimestamp });

// 真实时间戳（秒）：首问 18541 在 15:04:38，本地最早 17405/17436 在 15:05:25 之后。
const TS_150438 = 1792508678.504;
const TS_150505 = 1792508705.853;
const TS_150506 = 1792508706.657;
const TS_150525 = 1792508725.27;
const TS_150840 = 1792508920.0;

test('【真实缺陷】无共享行且 id 更大但时间更早时，批次必须前插（会话首问不可丢）', () => {
  // 真实形态：本地最早 17436，批次末尾 17435，相邻不相交
  const current = [
    row(17436, 'sess', TS_150840),
    row(17437, 'sess', TS_150840 + 1),
    row(17440, 'sess', TS_150840 + 2),
  ];
  const batch = [
    row(18541, 'sess', TS_150438),
    row(18542, 'sess', TS_150505),
    row(17400, 'sess', TS_150506),
    row(17401, 'sess', TS_150506),
    row(17402, 'sess', TS_150506),
    row(17405, 'sess', TS_150525),
    row(17417, 'sess', TS_150840 - 100),
    row(17435, 'sess', TS_150840 - 1),
  ];

  const res = planOlderBatchPrependMergeDetailed(batch, current, {
    timelineSessionId: 'sess',
    fallbackSessionId: 'sess',
  });

  assert.ok(
    res.merged.some((m) => m.rowId === 18541),
    `会话首问 18541 必须进入列表，实际首条 rowId=${res.merged[0]?.rowId}`
  );
  assert.deepEqual(
    res.merged.slice(0, 5).map((m) => m.rowId),
    [18541, 18542, 17400, 17401, 17402],
    '更早批次必须按服务端返回顺序整批前插'
  );
  assert.equal(res.merged.length, 11, '批次 8 条加本地 3 条，无重复');
});

test('【真实缺陷】有共享行时按服务端位置拼接，同秒且 id 更大的行也须保留', () => {
  const current = [row(17405, 'sess', TS_150525), row(17417, 'sess', TS_150525)];
  const batch = [
    row(18541, 'sess', TS_150438),
    row(18542, 'sess', TS_150505),
    row(17400, 'sess', TS_150525),
    row(17401, 'sess', TS_150525),
    row(17405, 'sess', TS_150525),
    row(17417, 'sess', TS_150525),
  ];

  const res = planOlderBatchPrependMergeDetailed(batch, current, {
    timelineSessionId: 'sess',
    fallbackSessionId: 'sess',
  });

  assert.deepEqual(
    res.merged.map((m) => m.rowId),
    [18541, 18542, 17400, 17401, 17405, 17417],
    '同秒且 id 更大的行必须靠共享行定位保留，共享边界之后的重复行必须切掉'
  );
  assert.equal(res.droppedCount, 0);
});

test('【真实事故】无共享行且时间也更晚时，整批丢弃（绝不把更晚的行搬到列表最前）', () => {
  // 事故形态：批次 id 与时间整体晚于本地，必须整批丢弃。
  const current = Array.from({ length: 130 }, (_, i) => row(1000 + i, 'sess', 1000 + i));
  const batch = Array.from({ length: 500 }, (_, i) => row(29884 + i, 'sess', 29884 + i));

  const res = planOlderBatchPrependMergeDetailed(batch, current, {
    timelineSessionId: 'sess',
    fallbackSessionId: 'sess',
  });

  assert.equal(res.merged.length, 130, '晚于本地首条的整批必须丢弃');
  assert.equal(res.merged[0].rowId, 1000, '本地首条必须保持不动');
  assert.equal(res.droppedCount, 500, '必须如实报告丢弃行数，供上层留痕');
});

test('父会话血缘行按 sessionId 隔离，不参与本会话时间与 id 边界', () => {
  const current = [row(17405, 'sess', TS_150525), row(17417, 'sess', TS_150525 + 100)];
  const batch = [
    row(900, 'parent', 100),
    row(901, 'parent', 200),
    row(18541, 'sess', TS_150438),
    row(17405, 'sess', TS_150525),
  ];

  const res = planOlderBatchPrependMergeDetailed(batch, current, {
    timelineSessionId: 'sess',
    fallbackSessionId: 'sess',
  });

  const ids = res.merged.map((m) => m.id);
  assert.ok(ids.includes('m-900'), '父会话行必须保留');
  assert.ok(ids.includes('m-18541'), '本会话首问必须保留');
  assert.equal(new Set(ids).size, ids.length, '不得产生重复行');
});

test('父会话血缘行时间晚于本会话锚点时，仍不得被当成「更晚」丢弃', () => {
  // 父会话行的 id 更大且时间也更晚，本会话边界判据会判它「不更早」，
  // 但它属于另一条时间线，必须由 sameTimeline 隔离放行并前置保留。
  const current = [row(17405, 'sess', TS_150438), row(17417, 'sess', TS_150525)];
  const batch = [
    row(99999, 'parent', TS_150525 + 100000),
    row(100000, 'parent', TS_150525 + 100001),
    row(18541, 'sess', TS_150438 - 1000),
    row(17405, 'sess', TS_150438),
  ];

  const res = planOlderBatchPrependMergeDetailed(batch, current, {
    timelineSessionId: 'sess',
    fallbackSessionId: 'sess',
  });

  const ids = res.merged.map((m) => m.id);
  assert.ok(ids.includes('m-99999'), '父会话行即便 id 更大、时间更晚也必须保留，它不属于本会话时间线');
  assert.equal(res.droppedCount, 0, '不得把跨会话行计入丢弃');
});

test('【真实缺陷】IDB 恢复行缺 sessionId 时，与服务端带 sessionId 的重叠页必须匹配，不得误报 droppedCount 掐死翻页', () => {
  // 真实复现：从 IDB 恢复出来的本地行没有 sessionId，服务端 REST 行带有 sessionId。
  // 旧 compositeKey 算出 "row::17467" 与 "sess::row::17467"，全部失配，
  // 导致 17467..17470 全被当成未见过且被边界过滤，droppedCount=4，上层直接置 exhausted=1 终止翻页！
  const currentFromIdb = [
    { id: 'row-17405', rowId: 17405, rawTimestamp: TS_150525 },
    { id: 'row-17467', rowId: 17467, rawTimestamp: TS_150840 },
    { id: 'row-17469', rowId: 17469, rawTimestamp: TS_150840 + 10 },
    { id: 'row-17471', rowId: 17471, rawTimestamp: TS_150840 + 20 },
  ];
  const remoteOverlapBatch = [
    row(17467, 'sess', TS_150840),
    row(17469, 'sess', TS_150840 + 10),
    row(17471, 'sess', TS_150840 + 20),
  ];

  const res = planOlderBatchPrependMergeDetailed(remoteOverlapBatch, currentFromIdb, {
    timelineSessionId: 'sess',
    fallbackSessionId: 'sess',
  });

  assert.equal(res.merged.length, 4, '重叠行不得重复插入');
  assert.equal(res.droppedCount, 0, '本地已持有的重叠行绝不能计入 droppedCount，否则会误杀后续翻页');
});

test('【真实缺陷】IDB 恢复的部分缓存继续向早翻页时，有交集批次必须精准去重并把 18541 前插进来', () => {
  // 场景：本地从 IDB 恢复了半截（不含 18541，最早是 17420），缺 sessionId；
  // 下一轮翻页批次包含 18541 与重叠的 17420。
  const currentFromIdb = [
    { id: 'row-17420', rowId: 17420, rawTimestamp: TS_150525 + 60 },
    { id: 'row-17436', rowId: 17436, rawTimestamp: TS_150840 },
  ];
  const remoteBatch = [
    row(18541, 'sess', TS_150438),
    row(17405, 'sess', TS_150525),
    row(17420, 'sess', TS_150525 + 60),
  ];

  const res = planOlderBatchPrependMergeDetailed(remoteBatch, currentFromIdb, {
    timelineSessionId: 'sess',
    fallbackSessionId: 'sess',
  });

  assert.deepEqual(
    res.merged.map((m) => m.rowId),
    [18541, 17405, 17420, 17436],
    '重叠行 17420 必须正确识别并切除，18541/17405 前插'
  );
  assert.equal(res.droppedCount, 0);
});
