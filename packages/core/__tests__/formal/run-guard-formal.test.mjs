import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { runGuarded } from '../../dist/index.js';

test('Formal invariant: changed session or generation discards, unchanged state commits', async () => {
  await fc.assert(fc.asyncProperty(
    fc.array(fc.boolean(), { minLength: 0, maxLength: 40 }),
    fc.integer({ min: 0, max: 100 }),
    async (changes, initialGeneration) => {
      let current = { sessionId: 'S', generation: initialGeneration };
      let writes = 0;
      const changed = changes.some(Boolean);
      const snapshot = { ...current };
      const result = await runGuarded(snapshot, () => current, () => { writes += 1; }, async () => {
        for (const change of changes) if (change) current = { sessionId: 'B', generation: current.generation + 1 };
      });
      assert.equal(result.status, changed ? 'discarded' : 'committed');
      assert.equal(writes, changed ? 0 : 1);
    },
  ), { numRuns: 1200 });
});
