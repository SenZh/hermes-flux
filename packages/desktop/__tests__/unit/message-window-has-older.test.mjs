import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHasOlderMessages } from '../../dist/renderer/messageWindow.mjs';

/**
 * computeHasOlderMessages 纯逻辑单测与边界变异测试。
 *
 * 【设计意图 (Why)】
 *   判定会话是否可能包含更早的远端服务端历史是长列表分页与状态机恢复的核心守卫。
 *   任何在切会话时误判（如忽略 rowId <= 1）、在单页未满时误判、或在 rowId 缺失时抛错的变异，
 *   都会导致界面顶部错误挂出“向上滚动查看更早历史”的误导指示器。
 *
 * 【约束与规则 (Rules)】
 *   1. messages[0].rowId <= 1 绝对不可判为有更早历史；
 *   2. offsetOrCount < pageSize 绝对不可判为有更早历史；
 *   3. 异常入参（空数组、非数组、负数、NaN）坚决兜底为 false，严禁抛出异常。
 */

test('历史存在判定 - 物理到达第一条（rowId <= 1）绝对无更早历史', () => {
  const fullPageReachedFirst = [{ rowId: 1 }, { rowId: 2 }, { rowId: 100 }];
  assert.equal(
    computeHasOlderMessages(fullPageReachedFirst, 100, 100),
    false,
    '最老消息 rowId 为 1 且达到满页时，必须判定无更早历史'
  );

  const zeroRowReached = [{ rowId: 0 }, { rowId: 1 }];
  assert.equal(
    computeHasOlderMessages(zeroRowReached, 100, 100),
    false,
    '最老消息 rowId 为 0 时，必须判定无更早历史'
  );
});

test('历史存在判定 - 未到达第一条且达到单页阈值，判定有更早历史', () => {
  const midPage = [{ rowId: 51 }, { rowId: 52 }, { rowId: 150 }];
  assert.equal(
    computeHasOlderMessages(midPage, 100, 100),
    true,
    '最老消息 rowId 为 51 且拉满单页，必须判定有更早历史'
  );

  // 超过单页
  assert.equal(
    computeHasOlderMessages(midPage, 150, 100),
    true,
    'offset 超过单页阈值且 rowId > 1 时必须判定为 true'
  );
});

test('历史存在判定 - 服务端返回 0 条证明确无更早历史，否则只要最老消息 rowId > 1 就代表有更早历史', () => {
  const shortPage = [{ rowId: 50 }, { rowId: 51 }];
  assert.equal(
    computeHasOlderMessages(shortPage, 0, 100),
    false,
    '当服务端明确返回 0 条时，必须判定无更早历史'
  );
  assert.equal(
    computeHasOlderMessages(shortPage, 50, 100),
    true,
    '虽然本次仅拉取 50 条小于 100，但只要 rowId 为 50 > 1，前面必然有历史，绝不能误判为 false（933 条会话守护）'
  );
});

test('历史存在判定 - 空数组与非法输入边界安全', () => {
  assert.equal(computeHasOlderMessages([], 100, 100), false, '空数组必须为 false');
  assert.equal(computeHasOlderMessages(null, 100, 100), false, 'null 必须为 false');
  assert.equal(computeHasOlderMessages(undefined, 100, 100), false, 'undefined 必须为 false');
  assert.equal(computeHasOlderMessages([{ rowId: 10 }], 0, 100), false, 'returned 0 必须为 false');
  assert.equal(computeHasOlderMessages([{ rowId: 10 }], 100, 0), true, 'rowId 为 10 必须为 true');
});

test('历史存在判定 - rowId 缺失（临时发送或非持久化行）但达到阈值时的安全降级', () => {
  const optimisticList = [{ rowId: undefined }, { rowId: 10 }];
  assert.equal(
    computeHasOlderMessages(optimisticList, 100, 100),
    true,
    '最老一条无 rowId 且达到单页阈值时，安全假定可能有更早历史'
  );
});

test('历史存在判定 - 未传入 offsetOrCount（如内存缓存命中尚未记录服务端游标）时，只要未达 rowId=1 不得误判见底', () => {
  assert.equal(
    computeHasOlderMessages([{ rowId: 50 }, { rowId: 100 }], undefined, 100),
    true,
    '未传 offsetOrCount 时不得当成服务端返回 0 条而误判已到头'
  );
});

test('历史存在判定 - 存在未耗尽父会话血缘时，即使本段首条 rowId===1 也仍有更早历史', () => {
  assert.equal(
    computeHasOlderMessages([{ rowId: 1 }], 1, 100, true),
    true,
    '短子会话首条 rowId===1 但仍有父会话血缘时，必须允许向上拉取父会话历史'
  );
});

test('历史存在判定 - 变异检验：防范 earliestRow <= 1 退化为 < 1', () => {
  // 如果代码被篡改为 earliestRow < 1，则 rowId === 1 会逃逸被误判为 true
  const boundaryRow1 = [{ rowId: 1 }];
  const result = computeHasOlderMessages(boundaryRow1, 100, 100);
  assert.equal(result, false, '当最老一条 rowId===1 且无父血缘时必须坚决返回 false，若变异为 < 1 则此测试必红');
});
