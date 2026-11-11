import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planOlderBatchPrependMerge,
  planOlderBatchPrependMergeDetailed,
  planOlderPagination,
  countLocalCoveredRows,
} from '../../dist/session/olderBatchMerge.js';

const row = (rowId, sessionId = 'sess') => ({ id: `m-${rowId}`, rowId, sessionId, rawTimestamp: rowId });

test('向早翻页合并 - 批次混入比本地首条更晚的行时，只前置严格更早的行并保持全序单调', () => {
  // 复现：游标落后于本地已覆盖行数，网关批次 [800, 1300) 覆盖了本地 [1000, 1130) 的全部区间，
  // 旧实现会把 1000..1299 这些「比本地首条更晚」的行整块塞到列表头部，首行反而变大。
  const current = Array.from({ length: 130 }, (_, i) => row(1000 + i));
  const batch = Array.from({ length: 500 }, (_, i) => row(800 + i));

  const merged = planOlderBatchPrependMerge(batch, current);

  assert.equal(merged.length, 330, '只允许 800..999 这 200 行进入头部');
  assert.deepEqual(
    merged.slice(0, 3).map((m) => m.rowId),
    [800, 801, 802],
    '头部必须是严格更早的行'
  );
  assert.equal(merged[200].rowId, 1000, '本地首条必须紧跟在纯更早批次之后');
  for (let i = 1; i < merged.length; i += 1) {
    assert.ok(merged[i].rowId > merged[i - 1].rowId, `第 ${i} 项必须保持行号严格递增`);
  }
});

test('向早翻页合并 - 跨父子会话 rowId 倒挂时仍按时间线整体前置，不被行号边界误删', () => {
  const current = [{ id: 'child-1', sessionId: 'sess-D', rowId: 1, rawTimestamp: 5000 }];
  const parentBatch = [
    { id: 'parent-1', sessionId: 'sess-C', rowId: 900, rawTimestamp: 1000 },
    { id: 'parent-2', sessionId: 'sess-C', rowId: 901, rawTimestamp: 2000 },
  ];
  const merged = planOlderBatchPrependMerge(parentBatch, current);
  assert.deepEqual(merged.map((m) => m.id), ['parent-1', 'parent-2', 'child-1']);
});

test('向早翻页合并 - 批次完全晚于本地首条时整批丢弃，绝不把更晚的行搬到列表最前（生产缺陷回归）', () => {
  // 实测旧实现：len 630 / head 29884（用户看到的"最老一条其实不是最老"）。
  const current = Array.from({ length: 130 }, (_, i) => row(1000 + i));
  const batch = Array.from({ length: 500 }, (_, i) => row(29884 + i));

  const merged = planOlderBatchPrependMerge(batch, current, { timelineSessionId: 'sess' });

  assert.equal(merged.length, 130, '晚于本地首条的整批必须丢弃');
  assert.equal(merged[0].rowId, 1000, '本地首条必须保持不动');
});

test('向早翻页合并 - 列表头部是父会话血缘行时，本会话批次插到本会话首行之前而非父行之前', () => {
  const parent = { id: 'parent-1', rowId: 900, sessionId: 'sess-C', rawTimestamp: 500 };
  const current = [
    parent,
    { id: 'd-25000', rowId: 25000, sessionId: 'sess-D', rawTimestamp: 5000 },
    { id: 'd-25001', rowId: 25001, sessionId: 'sess-D', rawTimestamp: 5001 },
  ];
  const batch = [
    { id: 'd-24000', rowId: 24000, sessionId: 'sess-D', rawTimestamp: 4000 },
    { id: 'd-24001', rowId: 24001, sessionId: 'sess-D', rawTimestamp: 4001 },
  ];

  const merged = planOlderBatchPrependMerge(batch, current, { timelineSessionId: 'sess-D' });

  assert.deepEqual(
    merged.map((m) => m.id),
    ['parent-1', 'd-24000', 'd-24001', 'd-25000', 'd-25001'],
    '父会话行必须留在最前，本会话更早批次只能插在本会话首行之前'
  );
});

test('向早翻页合并 - 父会话行当头部且批次更晚时，锚点必须取本会话首行而不是父行', () => {
  const parent = { id: 'parent-1', rowId: 900, sessionId: 'sess-C', rawTimestamp: 500 };
  const current = [parent, { id: 'd-25000', rowId: 25000, sessionId: 'sess-D', rawTimestamp: 5000 }];
  const batch = [
    { id: 'd-26000', rowId: 26000, sessionId: 'sess-D', rawTimestamp: 6000 },
    { id: 'd-26001', rowId: 26001, sessionId: 'sess-D', rawTimestamp: 6001 },
  ];

  const merged = planOlderBatchPrependMerge(batch, current, { timelineSessionId: 'sess-D' });

  assert.deepEqual(merged.map((m) => m.id), ['parent-1', 'd-25000'], '更晚的本会话批次必须丢弃');
});

test('向早翻页合并 - 缓存恢复行（无 sessionId）按 fallback 归属当前会话，锚点与插入点不得错判', () => {
  const cached = { id: 'cache-25000', rowId: 25000 };
  const batch = [{ id: 'd-24000', rowId: 24000, sessionId: 'sess-D', rawTimestamp: 4000 }];

  const asLeaf = planOlderBatchPrependMerge(batch, [cached], { timelineSessionId: 'sess-D', fallbackSessionId: 'sess-D' });
  assert.deepEqual(asLeaf.map((m) => m.id), ['d-24000', 'cache-25000'], '缓存行属于叶子会话时必须作为锚点前的更早批次');

  const asParent = planOlderBatchPrependMerge(batch, [cached], { timelineSessionId: 'sess-C', fallbackSessionId: 'sess-D' });
  assert.deepEqual(asParent.map((m) => m.id), ['d-24000', 'cache-25000'], '父会话批次整体前置，缓存行不得被当成父行锚点');
});

test('向早翻页合并 - 首次翻父会话段且本地全是子会话行时，整批父行必须全部入列', () => {
  // 复现审查实测：锚点被跨会话兜底抢走后，父段批次按「父 rowId < 子会话锚点」比较，
  // 跨会话 rowId 空间无关，父行会被整批删光（实测 100 条父行 0 条入列），
  // 而游标照常推进 → 父会话历史在本会话生命周期内永久不可达。
  const current = [
    { id: 'd-25000', rowId: 25000, sessionId: 'sess-D', rawTimestamp: 5000 },
    { id: 'd-25001', rowId: 25001, sessionId: 'sess-D', rawTimestamp: 5001 },
  ];
  const batch = Array.from({ length: 100 }, (_, i) => ({
    id: `c-${30000 + i}`,
    rowId: 30000 + i,
    sessionId: 'sess-C',
    rawTimestamp: 4000 + i,
  }));

  const merged = planOlderBatchPrependMerge(batch, current, {
    timelineSessionId: 'sess-C',
    fallbackSessionId: 'sess-D',
  });

  assert.equal(merged.length, 102, '父会话段首批 100 行必须全部入列');
  assert.equal(merged[0].sessionId, 'sess-C', '父行必须排在子会话行之前');
  assert.equal(merged[100].id, 'd-25000', '子会话行紧随父段之后');
});

test('向早翻页合并 - 父段批次 rowId 全部小于叶会话锚点时仍按会话边界判定，不被跨会话比较误删', () => {
  const current = [{ id: 'd-25000', rowId: 25000, sessionId: 'sess-D', rawTimestamp: 5000 }];
  const batch = [
    { id: 'c-10', rowId: 10, sessionId: 'sess-C', rawTimestamp: 1000 },
    { id: 'c-11', rowId: 11, sessionId: 'sess-C', rawTimestamp: 1001 },
  ];

  const merged = planOlderBatchPrependMerge(batch, current, {
    timelineSessionId: 'sess-C',
    fallbackSessionId: 'sess-D',
  });

  assert.deepEqual(merged.map((m) => m.id), ['c-10', 'c-11', 'd-25000']);
});

test('向早翻页合并 - 详细版回传被丢弃行数，供上层区分「真重复」与「边界过滤」', () => {
  const current = Array.from({ length: 130 }, (_, i) => row(1000 + i));
  const laterBatch = Array.from({ length: 20 }, (_, i) => row(5000 + i));
  const droppedAll = planOlderBatchPrependMergeDetailed(laterBatch, current, { timelineSessionId: 'sess' });
  assert.equal(droppedAll.droppedCount, 20, '整批晚于锚点时丢弃行数必须如实回传');
  assert.equal(droppedAll.merged.length, 130, '合并结果不变');

  const duplicateBatch = current.slice(0, 10);
  const duplicateOnly = planOlderBatchPrependMergeDetailed(duplicateBatch, current, { timelineSessionId: 'sess' });
  assert.equal(duplicateOnly.droppedCount, 0, '纯重复批次不能被算作边界丢弃');
  assert.equal(duplicateOnly.merged.length, 130, '纯重复批次不改变列表');
});

test('本地已覆盖行数下界 - 无 sessionId 的缓存恢复行计入，父会话行排除', () => {
  const messages = [
    { id: 'a', rowId: 10, sessionId: 'sess-A' },
    { id: 'b', rowId: 11, sessionId: 'sess-A' },
    { id: 'temp', sessionId: 'sess-A' },
    { id: 'parent', rowId: 7, sessionId: 'sess-P' },
    { id: 'nolegacy', rowId: 0, sessionId: 'sess-A' },
    { id: 'cached', rowId: 12 },
  ];
  assert.equal(countLocalCoveredRows(messages, 'sess-A'), 3, '缓存恢复行无 sessionId，按计入处理（高估由翻页侧一次性回退兜底）');
});

test('翻页游标 - 请求起点必须抬到本地已覆盖行数，绝不从落后的 storedOffset 起步', () => {
  const plan = planOlderPagination({
    storedOffset: 100,
    localCoveredRows: 1130,
    returned: 0,
    batchRowIds: [],
    earliestLocalRowId: 30272,
  });
  assert.equal(plan.queryOffset, 1130, '本地已覆盖 1130 行时，offset=100 会重拉一整段并让游标越走越偏');
});

test('翻页游标 - 批次命中本地最早行时，本批已覆盖全部区间并交付合并，游标必须完整跳过 returned', () => {
  // 网关 order=latest 返回按展示序升序排列的 500 行（下标 0 最旧，下标 499 最新），
  // offset 是从最新端往最旧端跳过的行数。
  // 命中 20370（下标 370）意味着 20370..20499（最新端 130 行）已与本地重合，
  // 而 20000..20369（更早 370 行）刚随本批一起拿到，下一轮必须跳过整批 500 行到 2000，
  // 绝不能算成 1500+370+1=1871 造成反复重拉与单轮仅增几条的蠕动。
  const batchRowIds = Array.from({ length: 500 }, (_, i) => 20000 + i);
  const plan = planOlderPagination({
    storedOffset: 1500,
    localCoveredRows: 0,
    returned: 500,
    batchRowIds,
    earliestLocalRowId: 20370,
  });
  assert.equal(plan.nextOffset, 2000);
  assert.ok(plan.nextOffset > 1501, '绝不能退化为 queryOffset + 1 蠕动推进');
});

test('翻页游标 - 批次不含本地最早行时按 returned 推进，且永不回退', () => {
  const plan = planOlderPagination({
    storedOffset: 1500,
    localCoveredRows: 0,
    returned: 500,
    batchRowIds: Array.from({ length: 500 }, (_, i) => 10000 + i),
    earliestLocalRowId: 20370,
  });
  assert.equal(plan.nextOffset, 2000);
  assert.ok(plan.nextOffset >= plan.queryOffset, '游标只能单调前进');
});
