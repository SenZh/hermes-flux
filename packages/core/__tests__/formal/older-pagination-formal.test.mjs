import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  planOlderPagination,
  countLocalCoveredRows,
  planOlderBatchPrependMergeDetailed,
} from '../../dist/session/olderBatchMerge.js';

/**
 * 向早翻页游标与合并边界的形式化不变量验证。
 *
 * 【设计意图 (Why)】
 *   游标推进与合并边界涉及非单调 rowId、同秒多行、父子血缘与量纲混用，
 *   用属性测试在 1000+ 随机状态空间中证明核心安全不变量成立。
 */
test('Formal Invariant Verifier: Older Pagination Cursor & Merge Boundary', async (t) => {
  const positiveInt = fc.integer({ min: 0, max: 20000 });

  await t.test('定理 30 [游标单调不减]: nextOffset 恒 >= queryOffset', () => {
    fc.assert(
      fc.property(
        positiveInt,
        positiveInt,
        fc.integer({ min: 0, max: 500 }),
        fc.array(fc.integer({ min: 1, max: 40000 }), { maxLength: 500 }),
        fc.option(fc.integer({ min: 1, max: 40000 }), { nil: null }),
        (storedOffset, localCoveredRows, returned, batchRowIds, earliestLocalRowId) => {
          const plan = planOlderPagination({ storedOffset, localCoveredRows, returned, batchRowIds, earliestLocalRowId });
          assert.ok(plan.nextOffset >= plan.queryOffset, `游标回退: ${plan.nextOffset} < ${plan.queryOffset}`);
          assert.ok(plan.queryOffset >= storedOffset, '请求起点不得低于已确认游标');
        }
      ),
      { numRuns: 2000 }
    );
  });

  await t.test('定理 31 [游标不越界]: nextOffset 恒 <= queryOffset + returned', () => {
    fc.assert(
      fc.property(
        positiveInt,
        positiveInt,
        fc.integer({ min: 0, max: 500 }),
        fc.array(fc.integer({ min: 1, max: 40000 }), { maxLength: 200 }),
        fc.option(fc.integer({ min: 1, max: 40000 }), { nil: null }),
        (storedOffset, localCoveredRows, returned, batchRowIds, earliestLocalRowId) => {
          const plan = planOlderPagination({ storedOffset, localCoveredRows, returned, batchRowIds, earliestLocalRowId });
          assert.ok(
            plan.nextOffset <= plan.queryOffset + returned,
            `游标越界: ${plan.nextOffset} > ${plan.queryOffset} + ${returned}，会跳过未加载的行`
          );
        }
      ),
      { numRuns: 2000 }
    );
  });

  await t.test('定理 32 [覆盖下界]: queryOffset 恒 >= 本地可归属覆盖行数', () => {
    fc.assert(
      fc.property(
        positiveInt,
        fc.array(fc.record({ id: fc.string(), rowId: fc.option(fc.integer({ min: -5, max: 40000 }), { nil: undefined }), sessionId: fc.constantFrom('A', 'B') }), { maxLength: 300 }),
        (storedOffset, messages) => {
          const covered = countLocalCoveredRows(messages, 'A');
          const plan = planOlderPagination({
            storedOffset,
            localCoveredRows: covered,
            returned: 0,
            batchRowIds: [],
            earliestLocalRowId: null,
          });
          assert.ok(plan.queryOffset >= covered, '请求起点必须覆盖本地已确认行数');
          assert.ok(covered >= 0 && covered <= messages.length, '覆盖计数必须落在物理范围内');
        }
      ),
      { numRuns: 1000 }
    );
  });

  const msgArb = fc.record({
    rowId: fc.integer({ min: 1, max: 50000 }),
    sessionId: fc.constantFrom('sess-D', 'sess-C'),
    rawTimestamp: fc.integer({ min: 1_700_000_000, max: 1_700_000_020 }),
    displayKind: fc.constantFrom('user', 'user', 'hidden'),
  }).map((r) => ({
    id: `${r.sessionId}-${r.rowId}`,
    ...r,
  }));

  const dedupeKeys = (arr) => {
    const seen = new Set();
    return arr.filter((m) => {
      const k = `${m.sessionId}::${m.rowId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  await t.test('定理 33 [合并无重键且父段不丢失、二次合并强幂等]', () => {
    fc.assert(
      fc.property(
        fc.array(msgArb, { minLength: 1, maxLength: 20 }),
        fc.array(msgArb, { minLength: 1, maxLength: 20 }),
        (rawBatch, rawCurrent) => {
          const batch = dedupeKeys(rawBatch);
          const current = dedupeKeys(rawCurrent);
          const res1 = planOlderBatchPrependMergeDetailed(batch, current, {
            timelineSessionId: 'sess-D',
            fallbackSessionId: 'sess-D',
          });
          const keys1 = res1.merged.map((m) => `${m.sessionId}::${m.rowId}`);
          assert.equal(new Set(keys1).size, keys1.length, '合并结果绝不允许出现重复复合键');

          // 任意父会话行必须全部保留，不可被本会话边界丢弃
          const keySet1 = new Set(keys1);
          for (const p of [...batch, ...current].filter((m) => m.sessionId === 'sess-C')) {
            assert.ok(keySet1.has(`${p.sessionId}::${p.rowId}`), '父会话行不得丢失');
          }

          // 二次合并同一批次强幂等（不引入新行且列表长度与元素不变）
          const res2 = planOlderBatchPrependMergeDetailed(batch, res1.merged, {
            timelineSessionId: 'sess-D',
            fallbackSessionId: 'sess-D',
          });
          assert.deepEqual(
            res2.merged.map((m) => `${m.sessionId}::${m.rowId}`),
            keys1,
            '相同批次连续合并两次必须幂等'
          );
        }
      ),
      { numRuns: 1000 }
    );
  });

  await t.test('定理 34 [无共享行时本时间线新增前插绝不放行晚于锚点的行]', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 50000 }), { minLength: 2, maxLength: 30 }),
        fc.array(fc.integer({ min: 1_700_000_000, max: 1_700_005_000 }), { minLength: 2, maxLength: 30 }),
        (uniqueIds, timestamps) => {
          const split = Math.max(1, Math.floor(uniqueIds.length / 2));
          const toMsg = (id, ts) => ({
            id: `row-${id}`,
            rowId: id,
            sessionId: 'sess-D',
            rawTimestamp: ts,
            displayKind: 'user',
          });
          const current = uniqueIds.slice(0, split).map((id, i) => toMsg(id, timestamps[i % timestamps.length]));
          // 构造升序批，确保不会被判定为 DESC 翻转，纯测试边界拦截
          const batchLen = uniqueIds.length - split;
          const batchTs = Array.from({ length: batchLen }, (_, i) => timestamps[i % timestamps.length]).sort((a, b) => a - b);
          const batch = uniqueIds.slice(split).map((id, i) => toMsg(id, batchTs[i]));

          const res = planOlderBatchPrependMergeDetailed(batch, current, {
            timelineSessionId: 'sess-D',
            fallbackSessionId: 'sess-D',
          });
          const anchorTs = current[0].rawTimestamp;
          const anchorPos = res.merged.findIndex((m) => m.rowId === current[0].rowId);
          for (let i = 0; i < anchorPos; i += 1) {
            assert.ok(
              res.merged[i].rawTimestamp <= anchorTs,
              `无共享行下前插行时间戳 ${res.merged[i].rawTimestamp} 晚于锚点 ${anchorTs}`
            );
          }
        }
      ),
      { numRuns: 1000 }
    );
  });
});
