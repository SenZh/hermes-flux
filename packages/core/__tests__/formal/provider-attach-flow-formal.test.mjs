import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  beginAttachFlow,
  isAttachFlowBusy,
  reconcileAttachFlow,
  reduceAttachFlow,
} from '../../dist/models/providerAttachFlow.js';
import { collectReplacementModels } from '../../dist/models/providerViews.js';
import { normalizeEndpointId } from '../../dist/index.js';

/**
 * 行内开启与补密钥状态机的形式化不变量（INV-ATTACH-01 ~ 05）。
 *
 * 目标不是复刻实现，而是在随机事件交错下断言"任何实现都必须满足"的性质。
 * 每条定理对应一个真实会伤到用户的失效模式：
 *   INV-ATTACH-01 —— 迟滞响应把用户已经切走的流程改掉（串台）；
 *   INV-ATTACH-02 —— 提交中不可重入，重复 submit 不得覆盖在途令牌与目标；
 *   INV-ATTACH-03 —— 补密钥失败后用户必须重打密钥；
 *   INV-ATTACH-04 —— 取消不生效（用户关不掉补密钥条），或空闲时仍锁死；
 *   INV-ATTACH-05 —— 目录已就绪时流程挂在不再需要它的格子上。
 */

const TARGET = { providerKey: 'custom:fn', providerId: 'fn', profile: 'aura' };

const eventArb = fc.oneof(
  fc.record({ type: fc.constant('submit'), token: fc.integer({ min: 0, max: 20 }) }),
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

test('INV-ATTACH-01 [迟滞响应不串台]: 令牌不匹配的 settle 不得改变任何字段', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 20 }),
      fc.array(eventArb, { minLength: 0, maxLength: 10 }),
      fc.integer({ min: 0, max: 20 }),
      fc.record({
        ok: fc.constant(false),
        needsKey: fc.boolean(),
        message: fc.string(),
      }),
      (initToken, events, staleToken, outcome) => {
        let flow = beginAttachFlow(TARGET, initToken);
        for (const event of events) {
          const next = reduceAttachFlow(flow, event);
          if (next === null) return;
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

test('INV-ATTACH-02 [提交中不可重入]: submitting 阶段的重复 submit 不得覆盖在途令牌与草稿', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 20 }),
      fc.integer({ min: 0, max: 20 }),
      fc.string({ minLength: 1, maxLength: 8 }),
      (token, otherToken, draftKey) => {
        const direct = beginAttachFlow(TARGET, token);
        const reenteredDirect = reduceAttachFlow(direct, { type: 'submit', token: otherToken });
        assert.equal(reenteredDirect, direct, 'direct 提交期间再次 submit 必须被忽略');
        assert.equal(reenteredDirect.token, token);

        const needsKey = reduceAttachFlow(direct, {
          type: 'settle',
          token,
          outcome: { ok: false, needsKey: true, message: 'need key' },
        });
        assert.ok(needsKey && needsKey.phase === 'needs-key');
        const withDraft = reduceAttachFlow(needsKey, { type: 'edit-key', draftKey });
        const fromKey = reduceAttachFlow(withDraft, { type: 'submit', token: token + 1 });
        assert.ok(fromKey && fromKey.phase === 'submitting');
        const reenteredKey = reduceAttachFlow(fromKey, { type: 'submit', token: otherToken });
        assert.equal(reenteredKey, fromKey, '补密钥提交期间再次 submit 必须被忽略');
        assert.equal(reenteredKey.token, token + 1);
        assert.equal(reenteredKey.draftKey, draftKey);
      },
    ),
    { numRuns: 400 },
  );
});

test('INV-ATTACH-03 [失败不丢用户输入]: 补密钥失败留在 needs-key 并保留密钥草稿与错误原因', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 8 }),
      fc.string({ minLength: 1, maxLength: 12 }),
      fc.integer({ min: 0, max: 20 }),
      (draftKey, message, token) => {
        const needsKey = reduceAttachFlow(
          beginAttachFlow(TARGET, token),
          { type: 'settle', token, outcome: { ok: false, needsKey: true, message: 'need key' } },
        );
        const withDraft = reduceAttachFlow(needsKey, { type: 'edit-key', draftKey });
        assert.equal(withDraft.draftKey, draftKey);

        // 1) 补密钥后普通失败：留在 needs-key，草稿与错误都在。
        const submitting = reduceAttachFlow(withDraft, { type: 'submit', token: token + 1 });
        const backToKey = reduceAttachFlow(submitting, {
          type: 'settle',
          token: token + 1,
          outcome: { ok: false, message },
        });
        assert.equal(backToKey.phase, 'needs-key', '补密钥失败必须留在密钥阶段');
        assert.equal(backToKey.draftKey, draftKey, '补密钥失败必须保留用户已输入的密钥');
        assert.equal(backToKey.error, message, '补密钥失败必须显式给出原因');

        // 2) 补密钥后仍然缺密钥：同样保留草稿与原因，用户不必重打。
        const again = reduceAttachFlow(
          reduceAttachFlow(withDraft, { type: 'submit', token: token + 2 }),
          { type: 'settle', token: token + 2, outcome: { ok: false, needsKey: true, message } },
        );
        assert.equal(again.phase, 'needs-key');
        assert.equal(again.draftKey, draftKey, '二次缺密钥不得清空用户已输入的密钥');
        assert.equal(again.error, message, '二次缺密钥必须说明原因');

        // 3) 首次直接点击开启普通失败：收起为 null，交由行级提示报错。
        const fromDirect = reduceAttachFlow(
          beginAttachFlow(TARGET, token),
          { type: 'settle', token, outcome: { ok: false, message } },
        );
        assert.equal(fromDirect, null);
      },
    ),
    { numRuns: 400 },
  );
});

test('INV-ATTACH-04 [取消恒生效]: 任意可达状态上 cancel 都收起为 null，且 busy 只由 submitting 决定', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 20 }),
      fc.array(eventArb, { minLength: 0, maxLength: 12 }),
      (initToken, events) => {
        let flow = beginAttachFlow(TARGET, initToken);
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
          assert.equal(reduceAttachFlow(flow, { type: 'cancel' }), null, 'cancel 必须收起状态流');
        }
      },
    ),
    { numRuns: 400 },
  );
});

test('INV-ATTACH-05 [目录收敛]: 目录就绪后状态流只可能挂在仍为 absent 的同一格子', () => {
  fc.assert(
    fc.property(
      targetArb,
      fc.integer({ min: 0, max: 20 }),
      fc.array(eventArb, { minLength: 0, maxLength: 6 }),
      fc.constantFrom('absent', 'ready', 'active', 'error'),
      (target, initToken, events, state) => {
        let flow = beginAttachFlow(target, initToken);
        for (const event of events) {
          const next = reduceAttachFlow(flow, event);
          if (next === null) return;
          flow = next;
        }

        // 目录未知：不得清空（未知 ≠ 空）。
        assert.equal(reconcileAttachFlow(flow, undefined), flow, '目录未就绪时不得清空');

        const kept = reconcileAttachFlow(flow, makeViews([[target.providerKey, target.profile, state]]));
        if (state === 'absent') {
          assert.equal(kept, flow, '目标仍为 absent 时必须保留');
        } else {
          assert.equal(kept, null, `目标变为 ${state} 时必须收起`);
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

test('INV-SWITCH-01 [替补模型候选]: 与数学集合规范严格等价（排除关闭目标、非 ready/active 与空模型组）', () => {
  const idArb = fc.constantFrom('relay', 'xai-oauth', 'openai', 'backup', 'custom:relay', 'LOCAL');
  const stateArb = fc.constantFrom('active', 'ready', 'absent', 'error');
  const viewArb = fc.record({
    id: idArb,
    kind: fc.constantFrom('custom', 'subscription'),
    name: fc.string({ minLength: 1, maxLength: 12 }),
    detail: fc.constantFrom('', 'https://gw.example/v1'),
    models: fc.array(fc.constantFrom('', '  ', 'm1', ' m1 ', 'm2', 'grok-3'), { maxLength: 6 }),
    state: stateArb,
    includeTarget: fc.boolean(),
  }).map((row) => {
    const cleanId = normalizeEndpointId(row.id);
    return {
      key: `${row.kind}:${cleanId}`,
      kind: row.kind,
      id: row.id,
      name: row.name,
      detail: row.detail,
      availability: row.state === 'active' ? 'active' : 'ready',
      models: row.models,
      agents: row.includeTarget ? [{ profile: 'xiaofawang', displayName: 'xiaofawang', state: row.state }] : [],
    };
  });

  fc.assert(
    fc.property(
      fc.array(viewArb, { maxLength: 10 }),
      fc.constantFrom('relay', 'custom:relay', 'xai-oauth', 'backup'),
      (views, excludeId) => {
        const excludeClean = normalizeEndpointId(excludeId);

        // 独立形式化规范：与实现解耦地推导全部合法替补组
        const expected = [];
        for (const v of views) {
          if (normalizeEndpointId(v.id) === excludeClean) continue;
          const targetAgent = v.agents.find((a) => a.profile === 'xiaofawang');
          if (!targetAgent || (targetAgent.state !== 'ready' && targetAgent.state !== 'active')) continue;
          const cleanModels = [...new Set(v.models.map((m) => m.trim()).filter(Boolean))];
          if (cleanModels.length === 0) continue;
          expected.push({
            providerId: v.id,
            providerKey: v.key,
            providerName: v.name,
            kind: v.kind,
            baseUrl: v.kind === 'custom' && v.detail ? v.detail : undefined,
            models: cleanModels,
          });
        }

        const groups = collectReplacementModels(views, excludeId, 'xiaofawang');
        assert.deepEqual(groups, expected, '输出替补组必须与数学规范严格等价（防多塞也防漏杀/空返回）');

        for (let i = 0; i < groups.length; i += 1) {
          const group = groups[i];
          assert.notEqual(normalizeEndpointId(group.providerId), excludeClean);
          assert.ok(group.models.length > 0);
          assert.equal(new Set(group.models).size, group.models.length);
          const matchingViews = views.filter((v) => v.id === group.providerId && v.key === group.providerKey);
          assert.ok(
            matchingViews.some((v) => {
              const ag = v.agents.find((a) => a.profile === 'xiaofawang');
              return ag && (ag.state === 'ready' || ag.state === 'active');
            }),
            '每个返回项必须有对应 BOT 处于 ready 或 active 状态',
          );
          if (group.kind === 'subscription') {
            assert.equal(group.baseUrl, undefined, '订阅候选项不得带自定义 baseUrl');
          }
        }
      },
    ),
    { numRuns: 400 },
  );
});
