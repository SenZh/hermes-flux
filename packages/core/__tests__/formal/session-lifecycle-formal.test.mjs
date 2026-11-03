import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { SessionLifecycleService, RpcErrorCode, SessionListGeneration } from '../../dist/index.js';

test('Formal invariant: repeated deletion converges and failures preserve successful prune ids', async () => {
  await fc.assert(fc.asyncProperty(
    fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }),
    async (succeeds) => {
      const profiles = succeeds.map((_, index) => `p${index}`);
      const deleted = new Set();
      const hidden = new Set();
      const service = new SessionLifecycleService({
        rpc: { call: async (method, params) => {
        if (method === 'session.delete') {
            const index = profiles.indexOf(params.profile);
            if (!succeeds[index]) throw Object.assign(new Error('session is missing'), { code: RpcErrorCode.SessionMissing });
            deleted.add(params.profile);
          }
          if (method === 'session.set_hidden') hidden.add(params.profile);
          return {};
        } },
        platformBridge: { httpProxy: async ({ path }) => {
          const profile = profiles.find((name) => path.endsWith(`profile=${name}`));
          if (!succeeds[profiles.indexOf(profile)]) throw new Error('REST deletion failed');
          return { ok: true };
        } },
      });
      const first = await service.deleteSession('S', profiles);
      const second = await service.deleteSession('S', profiles);
      const succeededProfiles = profiles.filter((_, index) => succeeds[index]);
      assert.deepEqual(second, first);
      assert.deepEqual(new Set([...deleted, ...hidden]), new Set(succeededProfiles));
      assert.deepEqual(new Set(first.pruneIds), succeeds.some(Boolean) ? new Set(['S']) : new Set());
      if (succeeds.some(Boolean) && succeeds.some((success) => !success)) assert.equal(first.status, 'partial');
      if (succeeds.some(Boolean) && !succeeds.every(Boolean)) {
        assert.deepEqual(first.failedProfiles, profiles.filter((_, index) => !succeeds[index]));
      }
    },
  ), { numRuns: 850 });
});

test('Formal invariant: a pre-delete full-list snapshot cannot resurrect a deleted session', () => {
  fc.assert(fc.property(
    fc.array(fc.string({ minLength: 1, maxLength: 16 }), { minLength: 0, maxLength: 80 }),
    (snapshotIds) => {
      const generation = new SessionListGeneration();
      const requestGeneration = generation.beginFetch();
      const deletedId = 'deleted-target';
      generation.invalidateForDelete();
      const canCommit = generation.mayCommit(requestGeneration);
      const nextSessions = canCommit ? snapshotIds : snapshotIds.filter((id) => id !== deletedId);
      assert.equal(canCommit, false);
      assert.equal(nextSessions.includes(deletedId), false);
    },
  ), { numRuns: 1000 });
});
