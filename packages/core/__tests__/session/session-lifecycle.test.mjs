import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionLifecycleService, RpcErrorCode } from '../../dist/index.js';

test('deleteSession closes and interrupts before deleting each profile', async () => {
  const calls = [];
  const service = new SessionLifecycleService({
    rpc: { call: async (method, params) => { calls.push([method, params]); return {}; } },
    platformBridge: { httpProxy: async (request) => { calls.push(['REST', request]); return { ok: true }; } },
  });
  const outcome = await service.deleteSession('S', ['p1']);
  assert.deepEqual(calls.map(([method]) => method), ['session.close', 'session.interrupt', 'session.delete', 'REST']);
  assert.deepEqual(outcome, { status: 'deleted', pruneIds: ['S'], hiddenProfiles: [], failedProfiles: [] });
});

test('active rejection falls back to hidden and typed errors preserve partial failures', async () => {
  const calls = [];
  const service = new SessionLifecycleService({
    rpc: { call: async (method, params) => {
      calls.push([method, params]);
      if (method === 'session.delete' && params.profile === 'busy') throw { code: RpcErrorCode.ActiveSession };
      if (method === 'session.delete' && params.profile === 'broken') throw Object.assign(new Error('unexpected failure'), { code: 5000 });
      return {};
    } },
    platformBridge: { httpProxy: async ({ path }) => {
      if (path.includes('profile=broken')) throw new Error('REST deletion failed');
      return { ok: true };
    } },
  });
  const outcome = await service.deleteSession('S', ['busy', 'broken']);
  assert.deepEqual(outcome, { status: 'partial', pruneIds: ['S'], hiddenProfiles: ['busy'], failedProfiles: ['broken'] });
  assert.equal(calls.some(([method, params]) => method === 'session.set_hidden' && params.profile === 'broken'), false);
});
