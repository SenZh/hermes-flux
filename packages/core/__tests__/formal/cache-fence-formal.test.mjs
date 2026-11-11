import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { CacheService, MemoryCacheStore, mergeRemoteWindow, messageKey } from '../../dist/index.js';

/**
 * 缓存子系统形式化不变量（定理 22~26）
 *
 * 目标不是复刻实现，而是在随机操作序列下断言"任何实现都必须满足"的性质。
 * 每条定理都对应一个真实会伤到用户的失效模式。
 */

const REF = { profile: 'default', channel: 'session', channelId: 'formal' };

function makeService(messageCap = 1000) {
  const store = new MemoryCacheStore();
  const service = new CacheService(store, { messageCap, sessionCap: 200, now: () => 1_700_000_000_000 });
  return { store, service };
}

const orderArb = fc.integer({ min: 1, max: 80 });

const rowArb = fc.record({
  orderKey: orderArb,
  displaySeq: fc.option(fc.integer({ min: 1, max: 200 }), { nil: undefined }),
  role: fc.constantFrom('user', 'assistant', 'system'),
  text: fc.string({ minLength: 0, maxLength: 12 }),
  timestamp: fc.integer({ min: 1_700_000_000_000, max: 1_700_000_100_000 }),
  status: fc.constantFrom('complete', 'interrupted'),
  withTools: fc.boolean(),
});

function toRow(spec, overrides = {}) {
  return {
    profile: REF.profile,
    channel: REF.channel,
    channelId: REF.channelId,
    orderKey: spec.orderKey,
    ...(typeof spec.displaySeq === 'number' ? { displaySeq: spec.displaySeq } : {}),
    role: spec.role,
    text: spec.text,
    timestamp: spec.timestamp,
    status: spec.status,
    toolCalls: spec.withTools
      ? [{ toolId: `t-${spec.orderKey}`, name: 'read_file', status: 'done' }]
      : undefined,
    ...overrides,
  };
}

function dedupe(rows) {
  const map = new Map();
  for (const row of rows) map.set(messageKey(row), row);
  return [...map.values()];
}

function maxOrder(rows) {
  return rows.reduce((max, row) => (row.orderKey > max ? row.orderKey : max), 0);
}

test('定理 22 [围栏不误删]: 调用前存在、且 orderKey > fenceMax 的行，在 applyRemoteWindow 后必须仍存在', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(rowArb, { minLength: 1, maxLength: 10 }),
      fc.array(rowArb, { minLength: 0, maxLength: 10 }),
      async (localSpecs, remoteSpecs) => {
        const { service } = makeService();

        const local = dedupe(localSpecs.map((s) => toRow(s)));
        await service.appendRows(REF, local);

        const { fenceMax } = await service.openChannel(REF, 1000);

        // 模拟"拉取在途期间写入"：所有新行严格大于围栏基线
        const inFlightSpec = { ...localSpecs[0], orderKey: fenceMax + 1 + (localSpecs[0].orderKey % 5) };
        const inFlight = toRow(inFlightSpec);
        await service.appendRows(REF, [inFlight]);

        const remote = dedupe(remoteSpecs.map((s) => toRow(s)));
        const result = await service.applyRemoteWindow(REF, remote, fenceMax);

        const present = new Set(result.rows.map(messageKey));
        assert.ok(
          present.has(messageKey(inFlight)),
          `在途写入的行 ${inFlight.orderKey} 被围栏误删`
        );
      }
    ),
    { numRuns: 200 }
  );
});

test('定理 23 [上限不变量]: 任意操作序列后，单通道行数不超过 messageCap', async () => {
  const CAP = 20;

  const opArb = fc.oneof(
    fc.record({ kind: fc.constant('append'), rows: fc.array(rowArb, { minLength: 1, maxLength: 6 }) }),
    fc.record({
      kind: fc.constant('remote'),
      rows: fc.array(rowArb, { minLength: 0, maxLength: 6 }),
    }),
    fc.record({ kind: fc.constant('truncate'), target: orderArb })
  );

  await fc.assert(
    fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 12 }), async (ops) => {
      const { service } = makeService(CAP);

      for (const op of ops) {
        if (op.kind === 'append') {
          await service.appendRows(REF, dedupe(op.rows.map((s) => toRow(s))));
        } else if (op.kind === 'remote') {
          const { fenceMax } = await service.openChannel(REF, 1000);
          await service.applyRemoteWindow(REF, dedupe(op.rows.map((s) => toRow(s))), fenceMax);
        } else {
          await service.truncate(REF, op.target, null);
        }

        const { rows } = await service.openChannel(REF, 1000);
        assert.ok(rows.length <= CAP, `行数 ${rows.length} 超过上限 ${CAP}`);
      }
    }),
    { numRuns: 150 }
  );
});

test('定理 24 [截断有界]: 无 survivor 映射时，截断后所有行 orderKey ≤ target', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(rowArb, { minLength: 0, maxLength: 12 }),
      orderArb,
      async (specs, target) => {
        const { service } = makeService();
        await service.appendRows(REF, dedupe(specs.map((s) => toRow(s))));

        const result = await service.truncate(REF, target, null);
        for (const row of result.rows) {
          assert.ok(row.orderKey <= target, `截断后仍残留 orderKey=${row.orderKey} > target=${target}`);
        }
      }
    ),
    { numRuns: 200 }
  );
});

test('定理 25 [窗口合并幂等]: 相同 (remote, fenceMax) 连续应用两次，第二次不再产生变化', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(rowArb, { minLength: 0, maxLength: 8 }),
      fc.array(rowArb, { minLength: 0, maxLength: 8 }),
      async (localSpecs, remoteSpecs) => {
        const { service } = makeService();
        const local = dedupe(localSpecs.map((s) => toRow(s)));
        await service.appendRows(REF, local);

        const { fenceMax } = await service.openChannel(REF, 1000);
        const remote = dedupe(remoteSpecs.map((s) => toRow(s)));

        const first = await service.applyRemoteWindow(REF, remote, fenceMax);
        const second = await service.applyRemoteWindow(REF, remote, fenceMax);

        assert.deepEqual(
          second.rows.map((r) => [r.orderKey, r.displaySeq]).sort((a, b) => a[0] - b[0]),
          first.rows.map((r) => [r.orderKey, r.displaySeq]).sort((a, b) => a[0] - b[0]),
          '第二次合并改变了行集合或 displaySeq'
        );
        assert.deepEqual(second.evictedKeys, [], '第二次合并仍在剔除行，说明不幂等');
      }
    ),
    { numRuns: 200 }
  );
});

test('定理 27 [在途展示序不碰撞与强保序]: mergeRemoteWindow 中所有在途保留行 displaySeq 严格大于 remote 且互不重复', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(rowArb, { minLength: 1, maxLength: 12 }),
      fc.array(rowArb, { minLength: 1, maxLength: 8 }),
      async (localSpecs, remoteSpecs) => {
        const local = dedupe(localSpecs.map((s) => toRow(s)));
        const remote = dedupe(remoteSpecs.map((s) => toRow(s))).map((r, idx) => ({ ...r, displaySeq: idx + 1 }));
        const remoteMax = maxOrder(remote);
        const remoteMaxSeq = remote.length;
        const remoteKeySet = new Set(remote.map(messageKey));

        // 构造全部视为在途或 pending 的场景（fenceMax < maxOrder(local)）
        const fenceMax = Math.max(0, remoteMax - 1);
        const first = mergeRemoteWindow({
          local,
          remote,
          fenceMax,
          remoteMax,
          pendingKeys: new Set(),
        });
        const second = mergeRemoteWindow({
          local: first.rows,
          remote,
          fenceMax,
          remoteMax,
          pendingKeys: new Set(),
        });

        const tailSeqs = [];
        for (const r of first.rows) {
          if (r.orderKey > remoteMax && !remoteKeySet.has(messageKey(r))) {
            assert.ok(
              typeof r.displaySeq === 'number' && r.displaySeq > remoteMaxSeq,
              `在途保留行 ${r.orderKey} 的 displaySeq=${r.displaySeq} 未严格大于 remoteMaxSeq=${remoteMaxSeq}`
            );
            tailSeqs.push(r.displaySeq);
          }
        }
        assert.equal(new Set(tailSeqs).size, tailSeqs.length, `在途保留行 displaySeq 发生碰撞: ${JSON.stringify(tailSeqs)}`);
        assert.deepEqual(second.rows, first.rows, 'mergeRemoteWindow 连续应用两次对 displaySeq 必须强幂等');
      }
    ),
    { numRuns: 1000 }
  );
});

test('定理 28 [appendRows 同键展示序不漂移]: 重复混入已有主键时保留原 displaySeq，仅新行严格递增', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(rowArb, { minLength: 1, maxLength: 10 }),
      fc.array(rowArb, { minLength: 1, maxLength: 8 }),
      async (initialSpecs, appendSpecs) => {
        const { service } = makeService();
        const initial = dedupe(initialSpecs.map((s) => toRow(s))).map((r, i) => ({ ...r, displaySeq: i + 1 }));
        await service.applyRemoteWindow(REF, initial, 0);

        const initialSeqByKey = new Map(initial.map((r) => [messageKey(r), r.displaySeq]));
        const maxInitialSeq = initial.length;

        // 模拟 persistTurnToCache：混入部分既有行与新行（均不带 displaySeq）
        const incoming = dedupe(appendSpecs.map((s) => toRow(s, { displaySeq: undefined })));
        await service.appendRows(REF, incoming);

        const { rows } = await service.openChannel(REF, 1000);
        const newSeqs = [];
        for (const r of rows) {
          const key = messageKey(r);
          if (initialSeqByKey.has(key)) {
            assert.equal(r.displaySeq, initialSeqByKey.get(key), `已有行 ${key} 的 displaySeq 被篡改`);
          } else {
            assert.ok(
              typeof r.displaySeq === 'number' && r.displaySeq > maxInitialSeq,
              `新增行 ${key} 的 displaySeq=${r.displaySeq} 必须大于既有最大值 ${maxInitialSeq}`
            );
            newSeqs.push(r.displaySeq);
          }
        }
        assert.equal(new Set(newSeqs).size, newSeqs.length, '新增行 displaySeq 之间不得碰撞');
      }
    ),
    { numRuns: 1000 }
  );
});

test('定理 26 [pending 不可删]: pending 集合中的行，在窗口合并后必须仍存在', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(rowArb, { minLength: 1, maxLength: 10 }),
      fc.array(rowArb, { minLength: 0, maxLength: 8 }),
      async (localSpecs, remoteSpecs) => {
        const { service } = makeService();
        const local = dedupe(localSpecs.map((s) => toRow(s)));
        await service.appendRows(REF, local);

        const { fenceMax } = await service.openChannel(REF, 1000);

        // 随机把一半本地行标为 pending
        const pending = new Set(local.filter((_, i) => i % 2 === 0).map(messageKey));

        const remote = dedupe(remoteSpecs.map((s) => toRow(s)));
        const result = await service.applyRemoteWindow(REF, remote, fenceMax, pending);

        const present = new Set(result.rows.map(messageKey));
        for (const key of pending) {
          assert.ok(present.has(key), `pending 行 ${key} 被删除`);
        }
      }
    ),
    { numRuns: 200 }
  );
});
