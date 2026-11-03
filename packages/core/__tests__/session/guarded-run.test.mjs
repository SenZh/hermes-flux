import test from 'node:test';
import assert from 'node:assert/strict';
import { runGuarded } from '../../dist/index.js';

test('runGuarded commits when the captured session and generation stay current', async () => {
  let writes = 0;
  const result = await runGuarded({ sessionId: 'S', generation: 4 }, () => ({ sessionId: 'S', generation: 4 }), () => { writes += 1; }, async () => 3);
  assert.deepEqual(result, { status: 'committed', value: 3 });
  assert.equal(writes, 1);
});

test('runGuarded discards after session or generation changes and records debug context', async () => {
  for (const current of [{ sessionId: 'B', generation: 4 }, { sessionId: 'S', generation: 5 }]) {
    let writes = 0;
    const logs = [];
    const result = await runGuarded(
      { sessionId: 'S', generation: 4 },
      () => current,
      () => { writes += 1; },
      async () => 3,
      { debug: (_message, details) => logs.push(details) },
    );
    assert.deepEqual(result, { status: 'discarded' });
    assert.equal(writes, 0);
    assert.deepEqual(logs, [{ sessionId: 'S', generation: 4 }]);
  }
});

test('runGuarded snapshots guard values before the async operation', async () => {
  let generation = 8;
  let writes = 0;
  const promise = runGuarded(
    { sessionId: 'S', generation },
    () => ({ sessionId: 'S', generation }),
    () => { writes += 1; },
    async () => { generation += 1; },
  );
  const result = await promise;
  assert.deepEqual(result, { status: 'discarded' });
  assert.equal(writes, 0);
});
