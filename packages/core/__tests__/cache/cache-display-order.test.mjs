import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CacheService,
  MemoryCacheStore,
  mergeRemoteWindow,
  sortByDisplayAsc,
  upsertMessageRows,
} from '../../dist/index.js';

const REF = { profile: 'default', channel: 'session', channelId: 's-disp' };

function row(orderKey, overrides = {}) {
  return {
    profile: REF.profile,
    channel: REF.channel,
    channelId: REF.channelId,
    orderKey,
    role: 'assistant',
    text: `msg-${orderKey}`,
    timestamp: 1_700_000_000_000 + orderKey,
    status: 'complete',
    ...overrides,
  };
}

test('sortByDisplayAsc: 优先按 displaySeq 升序，id 更大的首问必须排在最前', () => {
  // 真实形态：首问 rowId=18541 在第 1 位，其后 17405/17420 物理 id 反而更小
  const stored = [
    row(17405, { displaySeq: 2 }),
    row(17420, { displaySeq: 3 }),
    row(18541, { displaySeq: 1 }),
  ];

  const display = sortByDisplayAsc(stored);
  assert.deepEqual(display.map((r) => r.orderKey), [18541, 17405, 17420]);
});

test('sortByDisplayAsc: 兼容没有 displaySeq 的旧数据/离线测试数据（回退 orderKey 升序）', () => {
  const legacy = [row(12), row(11)];
  const display = sortByDisplayAsc(legacy);
  assert.deepEqual(display.map((r) => r.orderKey), [11, 12]);
});

test('upsertMessageRows: 同主键更新时，即使旧行更丰富，也必须采纳最新 displaySeq', () => {
  // 场景：首屏先写了 17405(displaySeq=1, 带工具调用)，随后翻页前插 18541 后重编号 17405 为 displaySeq=2
  const prev = row(17405, {
    displaySeq: 1,
    toolCalls: [{ toolId: 't1', name: 'shell', status: 'done', resultText: 'ok' }],
  });
  const next = row(17405, { displaySeq: 2, toolCalls: undefined });

  const merged = upsertMessageRows([prev], [next]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].toolCalls?.length, 1, '富字段必须保留');
  assert.equal(merged[0].displaySeq, 2, 'displaySeq 必须更新为新次序 2，不能留旧值 1');
});

test('mergeRemoteWindow: 围栏保护的在途新消息，displaySeq 必须排在远端之后', () => {
  const local = [
    row(18541, { displaySeq: 1 }),
    row(17405, { displaySeq: 2 }),
    row(41900, { displaySeq: 3 }), // 拉取在途新发消息（orderKey > fenceMax）
  ];
  // 远端窗口这次只带 18541..17405，并把 displaySeq 重编号到了 1..10
  const remote = [
    row(18541, { displaySeq: 1 }),
    row(17405, { displaySeq: 10 }),
  ];

  const result = mergeRemoteWindow({
    local,
    remote,
    fenceMax: 18541,
    remoteMax: 18541,
    pendingKeys: new Set(),
  });

  const display = sortByDisplayAsc(result.rows);
  assert.deepEqual(
    display.map((r) => r.orderKey),
    [18541, 17405, 41900],
    '在途写入 41900 虽然原 displaySeq=3 小于 10，合并后必须排在 remote(10) 之后'
  );
});

test('CacheService.appendRows: 未传 displaySeq 的流式追加行必须排在已有消息之后', async () => {
  const store = new MemoryCacheStore();
  const service = new CacheService(store, { messageCap: 100 });

  // 先写入全量历史（displaySeq=1, 20, 30）
  await service.applyRemoteWindow(
    REF,
    [row(18541, { displaySeq: 1 }), row(17405, { displaySeq: 20 }), row(17420, { displaySeq: 30 })],
    0
  );

  // 随后流式追加一条 orderKey=15（数值小于已有 displaySeq=20/30）的新行；
  // 若不顺延 displaySeq 到 31，sortByDisplayAsc 会用 orderKey=15 把它错排到前面
  await service.appendRows(REF, [row(15), row(42000)]);

  const opened = await service.openChannel(REF, 100);
  const display = sortByDisplayAsc(opened.rows);
  assert.deepEqual(
    display.map((r) => r.orderKey),
    [18541, 17405, 17420, 15, 42000],
    'appendRows 追加行必须顺延到现有最大 displaySeq 之后，不得错插到前面'
  );
});

test('CacheService.appendRows: 空通道首次写入也必须分配 displaySeq，重复传全量列表时既有行绝不漂移', async () => {
  const store = new MemoryCacheStore();
  const service = new CacheService(store, { messageCap: 100 });

  // 1. 空通道首次流式写入两行（不带 displaySeq）
  await service.appendRows(REF, [row(18541), row(17405)]);
  const afterFirst = sortByDisplayAsc((await service.openChannel(REF, 100)).rows);
  assert.deepEqual(
    afterFirst.map((r) => ({ k: r.orderKey, s: r.displaySeq })),
    [{ k: 18541, s: 1 }, { k: 17405, s: 2 }],
    '空通道首次 appendRows 必须按传入顺序分配 1, 2，不得留下 undefined'
  );

  // 2. 模拟 persistTurnToCache 传入全量列表（含已有 18541/17405 + 新行 17420，全都不带 displaySeq）
  await service.appendRows(REF, [row(18541), row(17405), row(17420)]);
  const afterSecond = sortByDisplayAsc((await service.openChannel(REF, 100)).rows);
  assert.deepEqual(
    afterSecond.map((r) => ({ k: r.orderKey, s: r.displaySeq })),
    [{ k: 18541, s: 1 }, { k: 17405, s: 2 }, { k: 17420, s: 3 }],
    '重复传入既有行不得篡改其原有 displaySeq，仅新行顺延为 3'
  );
});

test('mergeRemoteWindow: 多条在途保留行同时包含低于与高于远端最大 displaySeq 时绝不碰撞且两次应用强幂等', () => {
  const local = [
    row(18541, { displaySeq: 1 }),
    row(17405, { displaySeq: 2 }),
    row(41900, { displaySeq: 5 }),  // 小于 remoteMaxDisplaySeq(10)
    row(41901, { displaySeq: 11 }), // 大于 remoteMaxDisplaySeq(10)
  ];
  const remote = [
    row(18541, { displaySeq: 1 }),
    row(17405, { displaySeq: 10 }),
  ];

  const first = mergeRemoteWindow({
    local,
    remote,
    fenceMax: 18541,
    remoteMax: 18541,
    pendingKeys: new Set(),
  });

  const seqs = first.rows.map((r) => r.displaySeq);
  assert.equal(new Set(seqs).size, seqs.length, `displaySeq 发生碰撞: ${JSON.stringify(seqs)}`);
  const row41900 = first.rows.find((r) => r.orderKey === 41900);
  const row41901 = first.rows.find((r) => r.orderKey === 41901);
  assert.ok(row41900.displaySeq > 10 && row41900.displaySeq !== row41901.displaySeq);

  const second = mergeRemoteWindow({
    local: first.rows,
    remote,
    fenceMax: 18541,
    remoteMax: 18541,
    pendingKeys: new Set(),
  });
  assert.deepEqual(second.rows, first.rows, 'mergeRemoteWindow 第二次调用必须对 displaySeq 完全幂等');
});

test('upsertMessageRows: 新行更丰富但缺 displaySeq 时，必须保留既有行的 displaySeq', () => {
  const prev = row(17405, { displaySeq: 7, text: 'hello' });
  const next = row(17405, {
    displaySeq: undefined,
    text: 'hello',
    toolCalls: [{ toolId: 't1', name: 'shell', status: 'done' }],
  });

  const merged = upsertMessageRows([prev], [next]);
  assert.equal(merged[0].toolCalls?.length, 1);
  assert.equal(merged[0].displaySeq, 7, '新行未携带 displaySeq 时不得把既有 displaySeq 抹成 undefined');
});
