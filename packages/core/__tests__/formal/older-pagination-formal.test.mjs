import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  planOlderPagination,
  countLocalCoveredRows,
} from '../../dist/session/olderBatchMerge.js';

/**
 * 向早翻页游标的形式化不变量验证。
 *
 * 【设计意图 (Why)】
 *   游标推进是纯算术，但一旦回退就会重复拉取整页，一旦越过 `queryOffset + returned`
 *   就会跳过从未落地历史且无法自我修复。用随机化验证代替人工场景枚举。
 */
test('Formal Invariant Verifier: Older Pagination Cursor', async (t) => {
  const positiveInt = fc.integer({ min: 0, max: 20000 });

  await t.test('定理 27 [游标单调不减]: nextOffset 恒 >= queryOffset', () => {
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

  await t.test('定理 28 [游标不越界]: nextOffset 恒 <= queryOffset + returned', () => {
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

  await t.test('定理 29 [覆盖下界]: queryOffset 恒 >= 本地可归属覆盖行数', () => {
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
});
