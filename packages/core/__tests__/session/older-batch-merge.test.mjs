import test from 'node:test';
import assert from 'node:assert/strict';
import { planOlderBatchPrependMerge } from '../../dist/session/olderBatchMerge.js';

test('向早翻页合并 - 纯无重叠更早历史批次必须完整头插，绝不可吞噬丢弃', () => {
  const olderBatch = [
    { id: 'msg-10', rowId: 10, content: '历史第10条' },
    { id: 'msg-20', rowId: 20, content: '历史第20条' },
  ];
  const current = [
    { id: 'msg-60', rowId: 60, content: '当前第60条' },
    { id: 'msg-70', rowId: 70, content: '当前第70条' },
  ];

  const merged = planOlderBatchPrependMerge(olderBatch, current);
  assert.equal(merged.length, 4, '合并后总长必须为 4，绝不能丢弃更早历史');
  assert.deepEqual(
    merged.map((m) => m.id),
    ['msg-10', 'msg-20', 'msg-60', 'msg-70'],
    '更早批次必须完整拼接在当前消息之前'
  );
});

test('向早翻页合并 - 存在重叠切片时，以第一条当前消息为锚点切除重叠部分', () => {
  const olderBatch = [
    { id: 'msg-40', rowId: 40 },
    { id: 'msg-50', rowId: 50 },
    { id: 'msg-60', rowId: 60 }, // 重叠
    { id: 'msg-70', rowId: 70 }, // 重叠
  ];
  const current = [
    { id: 'msg-60', rowId: 60 },
    { id: 'msg-70', rowId: 70 },
    { id: 'msg-80', rowId: 80 },
  ];

  const merged = planOlderBatchPrependMerge(olderBatch, current);
  assert.equal(merged.length, 5, '重叠部分必须去重');
  assert.deepEqual(
    merged.map((m) => m.id),
    ['msg-40', 'msg-50', 'msg-60', 'msg-70', 'msg-80'],
    '重叠消息去重且顺序保持严格单调'
  );
});

test('向早翻页合并 - 跨父子会话局部 rowId 碰撞防御 (父会话 rowId:1 与子会话 rowId:1 必须共存)', () => {
  // 子会话 D 的第一条消息（局部 rowId: 1）
  const childMessages = [
    { id: 'child-1', sessionId: 'sess-D', rowId: 1, rawTimestamp: 2000, content: '子会话首条' },
    { id: 'child-2', sessionId: 'sess-D', rowId: 2, rawTimestamp: 3000, content: '子会话次条' },
  ];
  // 从父会话 C 穿透拉取的消息（局部 rowId: 1 与 rowId: 2）
  const parentOlderBatch = [
    { id: 'parent-1', sessionId: 'sess-C', rowId: 1, rawTimestamp: 500, content: '父会话第1条' },
    { id: 'parent-2', sessionId: 'sess-C', rowId: 2, rawTimestamp: 1000, content: '父会话第2条' },
  ];

  const merged = planOlderBatchPrependMerge(parentOlderBatch, childMessages);
  assert.equal(merged.length, 4, '父子会话即便局部 rowId 相同，也绝不能被误判去重！');
  assert.deepEqual(
    merged.map((m) => m.id),
    ['parent-1', 'parent-2', 'child-1', 'child-2'],
    '父会话历史必须按时间与复合键正确头插在子会话之前'
  );
});

test('向早翻页合并 - 空输入与边界极值安全性', () => {
  const current = [{ id: 'msg-1', rowId: 1 }];
  assert.deepEqual(planOlderBatchPrependMerge([], current), current);
  assert.deepEqual(planOlderBatchPrependMerge(null, current), current);
  assert.deepEqual(planOlderBatchPrependMerge(undefined, current), current);

  const older = [{ id: 'msg-0', rowId: 0 }];
  assert.deepEqual(planOlderBatchPrependMerge(older, []), older);
  assert.deepEqual(planOlderBatchPrependMerge(older, null), older);
  assert.deepEqual(planOlderBatchPrependMerge([], []), []);
});
