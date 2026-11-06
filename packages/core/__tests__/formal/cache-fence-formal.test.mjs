import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { CacheService, MemoryCacheStore, messageKey } from '../../dist/index.js';

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
          second.rows.map((r) => r.orderKey).sort((a, b) => a - b),
          first.rows.map((r) => r.orderKey).sort((a, b) => a - b),
          '第二次合并改变了行集合'
        );
        assert.deepEqual(second.evictedKeys, [], '第二次合并仍在剔除行，说明不幂等');
      }
    ),
    { numRuns: 200 }
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
