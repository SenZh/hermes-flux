import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countLocalCoveredRows,
  planOlderPagination,
  planOlderBatchPrependMergeDetailed,
} from '../../dist/session/olderBatchMerge.js';
import { parseTranscriptRows } from '../../../desktop/dist/renderer/transcriptRows.mjs';

function makeFoldedNonMonotonicGateway(totalTurns = 600) {
  const rows = [];
  for (let turn = 0; turn < totalTurns; turn += 1) {
    const baseTs = 1791988450 + turn * 60;
    const isFirstTurn = turn === 0;
    const isEarlyLargeIdTurn = turn === 1;
    const userRowId = isFirstTurn ? 41430 : isEarlyLargeIdTurn ? 41432 : 10000 + turn * 10;
    rows.push({
      id: userRowId,
      row_id: userRowId,
      session_id: 'sess-main',
      role: 'user',
      content: `q-${turn}`,
      timestamp: baseTs,
    });
    const astRowId = isFirstTurn ? 41431 : 10000 + turn * 10 + 1;
    rows.push({
      id: astRowId,
      row_id: astRowId,
      session_id: 'sess-main',
      role: 'assistant',
      content: '',
      tool_calls: [{ id: `tc-${turn}-1`, name: 'shell', args: { cmd: 'ls' } }],
      timestamp: baseTs + 1,
    });
    for (let k = 0; k < 7; k += 1) {
      const toolRowId = 10000 + turn * 10 + 2 + k;
      rows.push({
        id: toolRowId,
        row_id: toolRowId,
        session_id: 'sess-main',
        role: 'tool',
        tool_call_id: `tc-${turn}-1`,
        content: `ok-${turn}-${k}`,
        timestamp: baseTs + 2 + k,
      });
    }
    const finalAstRowId = 10000 + turn * 10 + 9;
    rows.push({
      id: finalAstRowId,
      row_id: finalAstRowId,
      session_id: 'sess-main',
      role: 'assistant',
      content: `a-${turn}`,
      timestamp: baseTs + 9,
    });
  }
  return rows;
}

function fetchPageFromGateway(allRows, limit, offset) {
  const end = Math.max(0, allRows.length - offset);
  const start = Math.max(0, end - limit);
  const slice = allRows.slice(start, end);
  return { messages: slice, returned: slice.length };
}

test('仿真网关闭环 - 重度工具折叠与非单调 rowId 下，多轮翻页必须快速收敛到首问且零倒挂', () => {
  const gatewayRows = makeFoldedNonMonotonicGateway(600);
  const expectedViews = parseTranscriptRows(gatewayRows, {
    scope: { isGroupRoom: false, isBotRoom: false },
    formatTimestamp: String,
  });

  const first = fetchPageFromGateway(gatewayRows, 100, 0);
  let messages = parseTranscriptRows(first.messages, {
    scope: { isGroupRoom: false, isBotRoom: false },
    formatTimestamp: String,
  });
  let serverOffset = first.returned;
  let rounds = 0;

  while (rounds < 30) {
    rounds += 1;
    let attempts = 0;
    let batchAppended = false;
    let exhausted = false;

    while (attempts < 8) {
      attempts += 1;
      const earliestLocalRowId = messages.find((m) => typeof m.rowId === 'number' && m.rowId > 0)?.rowId ?? null;
      const { queryOffset } = planOlderPagination({
        storedOffset: serverOffset,
        localCoveredRows: countLocalCoveredRows(messages, 'sess-main'),
        returned: 0,
        batchRowIds: [],
        earliestLocalRowId,
      });
      const res = fetchPageFromGateway(gatewayRows, 500, queryOffset);
      if (res.returned === 0) {
        exhausted = true;
        break;
      }
      const batch = parseTranscriptRows(res.messages, {
        scope: { isGroupRoom: false, isBotRoom: false },
        formatTimestamp: String,
      });
      const before = messages.length;
      const merged = planOlderBatchPrependMergeDetailed(batch, messages, {
        timelineSessionId: 'sess-main',
        fallbackSessionId: 'sess-main',
      });
      const cursorPlan = planOlderPagination({
        storedOffset: queryOffset,
        localCoveredRows: 0,
        returned: res.returned,
        batchRowIds: res.messages.map((m) => m.id),
        earliestLocalRowId,
      });
      serverOffset = cursorPlan.nextOffset;
      messages = merged.merged;
      const added = messages.length - before;
      if (added > 0) {
        batchAppended = true;
        if (res.returned < 500) exhausted = true;
        break;
      }
      if (res.returned < 500) {
        exhausted = true;
        break;
      }
    }

    if (exhausted || !batchAppended) break;
  }

  assert.ok(rounds <= 15, `6000 行最多只需 12~13 轮即应拉完，实际消耗 ${rounds} 轮说明存在蠕动翻页`);
  assert.equal(messages[0]?.rowId, 41430, `会话首问必须抵达 41430，实际首行 rowId=${messages[0]?.rowId}`);
  assert.equal(messages.length, expectedViews.length, '必须拉全全部展示行，绝不能提前断尾');
  assert.deepEqual(
    messages.map((m) => m.id),
    expectedViews.map((m) => m.id),
    '最终视图序列必须与网关权威展示序逐条完全一致，零倒挂零漏行'
  );
});

test('仿真网关闭环 - 已有 2500 行缓存（游标停在 100）时继续向上翻页，绝不能每次只新增 1~3 条蠕动', () => {
  const gatewayRows = makeFoldedNonMonotonicGateway(400);
  const expectedViews = parseTranscriptRows(gatewayRows, {
    scope: { isGroupRoom: false, isBotRoom: false },
    formatTimestamp: String,
  });

  let messages = expectedViews.slice(expectedViews.length - 500);
  let serverOffset = 100;
  const addedPerRound = [];

  for (let round = 0; round < 10; round += 1) {
    const earliestLocalRowId = messages.find((m) => typeof m.rowId === 'number' && m.rowId > 0)?.rowId ?? null;
    const { queryOffset } = planOlderPagination({
      storedOffset: serverOffset,
      localCoveredRows: countLocalCoveredRows(messages, 'sess-main'),
      returned: 0,
      batchRowIds: [],
      earliestLocalRowId,
    });
    const res = fetchPageFromGateway(gatewayRows, 500, queryOffset);
    if (res.returned === 0) break;
    const batch = parseTranscriptRows(res.messages, {
      scope: { isGroupRoom: false, isBotRoom: false },
      formatTimestamp: String,
    });
    const before = messages.length;
    const merged = planOlderBatchPrependMergeDetailed(batch, messages, {
      timelineSessionId: 'sess-main',
      fallbackSessionId: 'sess-main',
    });
    const cursorPlan = planOlderPagination({
      storedOffset: queryOffset,
      localCoveredRows: 0,
      returned: res.returned,
      batchRowIds: res.messages.map((m) => m.id),
      earliestLocalRowId,
    });
    serverOffset = cursorPlan.nextOffset;
    messages = merged.merged;
    addedPerRound.push(messages.length - before);
    if (res.returned < 500) break;
  }

  const positiveSteps = addedPerRound.filter((n) => n > 0);
  assert.ok(positiveSteps.length <= 5, `剩余历史应最多 4~5 轮拉完，实际轮数 ${positiveSteps.length}（每轮新增: ${JSON.stringify(addedPerRound)}）`);
  assert.deepEqual(messages.map((m) => m.id), expectedViews.map((m) => m.id));
});

test('仿真网关闭环 - 批首缺时间戳回退 Date.now() 时，不得把整批升序历史颠倒成 DESC', () => {
  const gatewayRows = makeFoldedNonMonotonicGateway(40);
  const brokenHeadBatch = gatewayRows.slice(0, 100).map((r, i) => (
    i === 0 ? { ...r, timestamp: undefined } : r
  ));
  const batch = parseTranscriptRows(brokenHeadBatch, {
    scope: { isGroupRoom: false, isBotRoom: false },
    formatTimestamp: String,
  });
  const tail = parseTranscriptRows(gatewayRows.slice(100), {
    scope: { isGroupRoom: false, isBotRoom: false },
    formatTimestamp: String,
  });

  const merged = planOlderBatchPrependMergeDetailed(batch, tail, {
    timelineSessionId: 'sess-main',
    fallbackSessionId: 'sess-main',
  });

  assert.equal(merged.merged[0]?.rowId, 41430, '批首回退 Date.now() 不得把升序批反转，首问 41430 必须仍在第一位');
});

test('仿真网关闭环 - 秒/毫秒混用无共享行时，正确按归一化时间判定早晚', () => {
  const current = [{ id: 'row-41432', rowId: 41432, sessionId: 'sess-main', rawTimestamp: 1791988474000 }];
  const batch = [
    { id: 'row-10955', rowId: 10955, sessionId: 'sess-main', rawTimestamp: 1791988473 },
    { id: 'row-40695', rowId: 40695, sessionId: 'sess-main', rawTimestamp: 1793452967 },
  ];

  const merged = planOlderBatchPrependMergeDetailed(batch, current, {
    timelineSessionId: 'sess-main',
    fallbackSessionId: 'sess-main',
  });
  assert.deepEqual(merged.merged.map((m) => m.rowId), [10955, 41432], '10 位秒级应归一后再比较，拦截晚数天的 40695');
});
