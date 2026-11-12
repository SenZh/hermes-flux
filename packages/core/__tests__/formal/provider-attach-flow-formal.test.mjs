import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  isAttachFlowBusy,
  openAttachFlow,
  reconcileAttachFlow,
  reduceAttachFlow,
} from '../../dist/models/providerAttachFlow.js';

/**
 * 行内绑定确认流的形式化不变量（定理 30~34）。
 *
 * 目标不是复刻实现，而是在随机事件交错下断言"任何实现都必须满足"的性质。
 * 每条定理对应一个真实会伤到用户的失效模式：
 *   定理 30 —— 迟滞响应把用户已经切走的确认条改掉（串台）；
 *   定理 31 —— 提交中用户换了意图，写下的默认模型与界面显示不一致；
 *   定理 32 —— 提交失败后用户必须重打密钥、重选意图；
 *   定理 33 —— 取消不生效（用户关不掉确认条）；
 *   定理 34 —— 目录已就绪时确认条挂在不再需要它的格子上。
 */

const TARGET = { providerKey: 'custom:fn', providerId: 'fn', profile: 'aura' };

const intentArb = fc.constantFrom('enable-only', 'enable-and-default');

const eventArb = fc.oneof(
  fc.record({ type: fc.constant('choose'), intent: intentArb, token: fc.integer({ min: 0, max: 20 }) }),
  fc.record({
    type: fc.constant('settle'),
    token: fc.integer({ min: 0, max: 20 }),
    outcome: fc.oneof(
      fc.record({ ok: fc.constant(true) }),
      fc.record({ ok: fc.constant(false), needsKey: fc.constant(true), message: fc.string() }),
      fc.record({ ok: fc.constant(false), message: fc.string() }),
    ),
  }),
  fc.record({ type: fc.constant('edit-key'), draftKey: fc.string({ maxLength: 8 }) }),
  fc.record({ type: fc.constant('cancel') }),
);

const targetArb = fc.record({
  providerKey: fc.constantFrom('custom:fn', 'custom:cpa', 'subscription:xai-oauth'),
  providerId: fc.constantFrom('fn', 'cpa', 'xai-oauth'),
  profile: fc.constantFrom('aura', 'default', 'koru'),
});

function makeViews(states) {
  return states.map(([key, profile, state]) => ({
    key,
    kind: key.startsWith('subscription:') ? 'subscription' : 'custom',
    id: key.split(':')[1],
    name: key.split(':')[1],
    models: ['m1'],
    detail: '',
    availability: 'ready',
    agents: [{ profile, displayName: profile, state }],
  }));
}

test('定理 30 [迟滞响应不串台]: 令牌不匹配的 settle 不得改变任何字段', () => {
  fc.assert(
    fc.property(
      fc.array(eventArb, { minLength: 1, maxLength: 10 }),
      fc.integer({ min: 0, max: 20 }),
      fc.record({
        ok: fc.constant(false),
        needsKey: fc.boolean(),
        message: fc.string(),
      }),
      (events, staleToken, outcome) => {
        let flow = openAttachFlow(TARGET);
        for (const event of events) {
          const next = reduceAttachFlow(flow, event);
          if (next === null) return; // 已收起，本序列不再有在途提交
          flow = next;
        }
        if (flow.phase !== 'submitting' || flow.token === staleToken) return;
        const after = reduceAttachFlow(flow, { type: 'settle', token: staleToken, outcome });
        assert.equal(after, flow, '过期令牌的 settle 必须原样返回同一个对象');
      },
    ),
    { numRuns: 400 },
  );
});

test('定理 31 [提交中意图不可变]: submitting 阶段的意图只来自进入提交时的那次选择', () => {
  fc.assert(
    fc.property(
      intentArb,
      intentArb,
      fc.integer({ min: 0, max: 20 }),
      (chosen, other, token) => {
        const submitting = reduceAttachFlow(openAttachFlow(TARGET), { type: 'choose', intent: chosen, token });
        assert.ok(submitting && submitting.phase === 'submitting');
        const reentered = reduceAttachFlow(submitting, { type: 'choose', intent: other, token: token + 1 });
        assert.equal(reentered, submitting, '提交期间再次选择必须被忽略');
        assert.equal(reentered.intent, chosen, '提交期间的意图不得被改写');

        // needs-key 阶段再点意图：意图锁死为进入 needs-key 时的那个，不得被换成另一个。
        const needsKey = reduceAttachFlow(submitting, {
          type: 'settle',
          token,
          outcome: { ok: false, needsKey: true, message: 'need key' },
        });
        assert.ok(needsKey && needsKey.phase === 'needs-key');
        assert.equal(needsKey.intent, chosen);
        const fromKey = reduceAttachFlow(needsKey, { type: 'choose', intent: other, token: token + 1 });
        assert.equal(fromKey.intent, chosen, '补密钥阶段提交必须沿用已锁定的意图');
      },
    ),
    { numRuns: 400 },
  );
});

test('定理 32 [失败不丢用户输入]: 普通失败回到进入提交前的阶段并保留密钥草稿与错误原因', () => {
  fc.assert(
    fc.property(
      intentArb,
      fc.string({ minLength: 1, maxLength: 8 }),
      fc.string({ minLength: 1, maxLength: 12 }),
      fc.integer({ min: 0, max: 20 }),
      (intent, draftKey, message, token) => {
        const firstKey = reduceAttachFlow(
          reduceAttachFlow(openAttachFlow(TARGET), { type: 'choose', intent, token }),
          { type: 'settle', token, outcome: { ok: false, needsKey: true, message: 'need key' } },
        );
        const withDraft = reduceAttachFlow(firstKey, { type: 'edit-key', draftKey });
        assert.equal(withDraft.draftKey, draftKey);

        // 1) 补密钥后普通失败：留在 needs-key，草稿与意图与错误都在。
        const submitting = reduceAttachFlow(withDraft, { type: 'choose', intent, token: token + 1 });
        const backToKey = reduceAttachFlow(submitting, {
          type: 'settle',
          token: token + 1,
          outcome: { ok: false, message },
        });
        assert.equal(backToKey.phase, 'needs-key', '补密钥失败必须留在密钥阶段');
        assert.equal(backToKey.draftKey, draftKey, '补密钥失败必须保留用户已输入的密钥');
        assert.equal(backToKey.intent, intent, '补密钥失败必须保留意图');
        assert.equal(backToKey.error, message, '补密钥失败必须显式给出原因');

        // 2) 补密钥后仍然缺密钥：同样保留草稿与原因，用户不必重打。
        const again = reduceAttachFlow(
          reduceAttachFlow(withDraft, { type: 'choose', intent, token: token + 2 }),
          { type: 'settle', token: token + 2, outcome: { ok: false, needsKey: true, message } },
        );
        assert.equal(again.phase, 'needs-key');
        assert.equal(again.draftKey, draftKey, '二次缺密钥不得清空用户已输入的密钥');
        assert.equal(again.error, message, '二次缺密钥必须说明原因');

        // 3) 首次从选择阶段失败：回到 choosing 并带错误，用户可重选。
        const fromChoose = reduceAttachFlow(
          reduceAttachFlow(openAttachFlow(TARGET), { type: 'choose', intent, token }),
          { type: 'settle', token, outcome: { ok: false, message } },
        );
        assert.equal(fromChoose.phase, 'choosing');
        assert.equal(fromChoose.error, message);
      },
    ),
    { numRuns: 400 },
  );
});

test('定理 33 [取消恒生效]: 任意可达状态上 cancel 都收起为 null，且 busy 只由 submitting 决定', () => {
  fc.assert(
    fc.property(fc.array(eventArb, { minLength: 0, maxLength: 12 }), (events) => {
      let flow = openAttachFlow(TARGET);
      for (const event of events) {
        const next = reduceAttachFlow(flow, event);
        if (next === null) break;
        flow = next;
        assert.equal(
          isAttachFlowBusy(flow),
          flow.phase === 'submitting',
          '只有提交阶段算忙：取消按钮在其余阶段必须可用',
        );
      }
      if (flow) {
        assert.equal(reduceAttachFlow(flow, { type: 'cancel' }), null, 'cancel 必须收起确认条');
      }
    }),
    { numRuns: 400 },
  );
});

test('定理 34 [目录收敛]: 目录就绪后确认条只可能挂在仍为 absent 的同一格子', () => {
  fc.assert(
    fc.property(
      targetArb,
      fc.array(eventArb, { minLength: 0, maxLength: 6 }),
      fc.constantFrom('absent', 'ready', 'active', 'error'),
      (target, events, state) => {
        let flow = openAttachFlow(target);
        for (const event of events) {
          const next = reduceAttachFlow(flow, event);
          if (next === null) return;
          flow = next;
        }

        // 目录未知：不得清空（未知 ≠ 空）。
        assert.equal(reconcileAttachFlow(flow, undefined), flow, '目录未就绪时不得清空');

        const kept = reconcileAttachFlow(flow, makeViews([[target.providerKey, target.profile, state]]));
        if (state === 'absent') {
          assert.equal(kept, flow, '目标仍为 absent 时必须保留确认条');
        } else {
          assert.equal(kept, null, `目标变为 ${state} 时必须收起确认条`);
        }

        // 目标行或 Agent 消失：同样收起。
        assert.equal(reconcileAttachFlow(flow, []), null, '提供商行消失必须收起');
        assert.equal(
          reconcileAttachFlow(flow, makeViews([[target.providerKey, 'other-bot', 'absent']])),
          null,
          'Agent 不在该行时必须收起',
        );
      },
    ),
    { numRuns: 400 },
  );
});
