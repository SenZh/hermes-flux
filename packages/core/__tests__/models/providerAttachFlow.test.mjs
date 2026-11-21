/**
 * 行内开启与补密钥状态机（providerAttachFlow）全分支验证。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginAttachFlow,
  isAttachFlowBusy,
  reconcileAttachFlow,
  reduceAttachFlow,
  routeAttachFailure,
  shouldShowAttachStrip,
} from '../../dist/models/providerAttachFlow.js';

const TARGET = {
  providerKey: 'custom:fn',
  providerId: 'fn',
  profile: 'aura',
};

function makeViews(auraState = 'absent') {
  return [
    {
      key: 'custom:fn',
      kind: 'custom',
      id: 'fn',
      name: 'fn',
      models: ['m1'],
      detail: 'http://gw/v1',
      availability: 'ready',
      agents: [
        { profile: 'default', displayName: 'default', state: 'ready' },
        { profile: 'aura', displayName: 'aura', state: auraState },
      ],
    },
  ];
}

test('beginAttachFlow 直接进入 submitting(direct)，不展开补密钥条但标记 busy', () => {
  const flow = beginAttachFlow(TARGET, 7);
  assert.deepEqual(flow, {
    phase: 'submitting',
    ...TARGET,
    token: 7,
    previousPhase: 'direct',
  });
  assert.equal(isAttachFlowBusy(flow), true);
  assert.equal(shouldShowAttachStrip(flow), false, '直接开启不得先弹补密钥条');
  assert.equal(shouldShowAttachStrip(null), false);
});

test('submitting 阶段防重入，过期 token 的 settle 必须原样忽略', () => {
  const submitting = beginAttachFlow(TARGET, 7);

  // submitting 下重复 submit 被忽略（防重入）。
  const reentered = reduceAttachFlow(submitting, { type: 'submit', token: 8 });
  assert.equal(reentered, submitting, '提交期间不得覆盖已有 token');

  // submitting 下 edit-key 被忽略
  assert.equal(reduceAttachFlow(submitting, { type: 'edit-key', draftKey: 'sk-ignored' }), submitting);

  // 过期 token 的 settle 原样返回。
  const stale = reduceAttachFlow(submitting, {
    type: 'settle',
    token: 6,
    outcome: { ok: true },
  });
  assert.equal(stale, submitting, '过期 token 不得提前收起或更改当前确认流');
});

test('settle 成功直接收起（返回 null）', () => {
  const submitting = beginAttachFlow(TARGET, 1);
  assert.equal(reduceAttachFlow(submitting, { type: 'settle', token: 1, outcome: { ok: true } }), null);
});

test('settle 需要密钥时切入 needs-key 并展开条，draftKey 置空，edit-key 与 submit 正确流转', () => {
  const submitting = beginAttachFlow(TARGET, 3);
  const needsKey = reduceAttachFlow(submitting, {
    type: 'settle',
    token: 3,
    outcome: { ok: false, needsKey: true, message: 'need key' },
  });
  assert.deepEqual(needsKey, {
    phase: 'needs-key',
    ...TARGET,
    token: 3,
    draftKey: '',
    error: undefined,
  });
  assert.equal(isAttachFlowBusy(needsKey), false);
  assert.equal(shouldShowAttachStrip(needsKey), true);

  const edited = reduceAttachFlow(needsKey, { type: 'edit-key', draftKey: 'sk-user-123' });
  assert.equal(edited.phase, 'needs-key');
  assert.equal(edited.draftKey, 'sk-user-123');

  const resubmitting = reduceAttachFlow(edited, { type: 'submit', token: 4 });
  assert.deepEqual(resubmitting, {
    phase: 'submitting',
    ...TARGET,
    token: 4,
    previousPhase: 'needs-key',
    draftKey: 'sk-user-123',
  });
  assert.equal(shouldShowAttachStrip(resubmitting), true, '补密钥提交期间必须继续展示条，避免输入框消失');
});

test('settle 普通失败：direct 提交收起为 null（交行级提示）；needs-key 提交留在 needs-key 并保留用户输入', () => {
  // 1. direct -> 普通失败 -> null
  const direct = beginAttachFlow(TARGET, 10);
  assert.equal(
    reduceAttachFlow(direct, {
      type: 'settle',
      token: 10,
      outcome: { ok: false, message: 'HTTP 500' },
    }),
    null,
  );

  // 2. needs-key -> edit-key -> submit -> 普通失败 -> 留在 needs-key 且保留草稿与错误
  const needsKey = reduceAttachFlow(direct, {
    type: 'settle',
    token: 10,
    outcome: { ok: false, needsKey: true },
  });
  const withDraft = reduceAttachFlow(needsKey, { type: 'edit-key', draftKey: 'sk-keep-me' });
  const subFromKey = reduceAttachFlow(withDraft, { type: 'submit', token: 11 });
  const backToKey = reduceAttachFlow(subFromKey, {
    type: 'settle',
    token: 11,
    outcome: { ok: false, message: 'HTTP 401: invalid key' },
  });
  assert.deepEqual(backToKey, {
    phase: 'needs-key',
    ...TARGET,
    token: 11,
    draftKey: 'sk-keep-me',
    error: 'HTTP 401: invalid key',
  });

  // 3. needs-key 二次仍报 needsKey：保留用户输入与新错误
  const stillNeedsKey = reduceAttachFlow(
    reduceAttachFlow(withDraft, { type: 'submit', token: 12 }),
    { type: 'settle', token: 12, outcome: { ok: false, needsKey: true, message: 'invalid format' } },
  );
  assert.deepEqual(stillNeedsKey, {
    phase: 'needs-key',
    ...TARGET,
    token: 12,
    draftKey: 'sk-keep-me',
    error: 'invalid format',
  });
});

test('cancel 在所有阶段恒返回 null', () => {
  const direct = beginAttachFlow(TARGET, 1);
  const needsKey = reduceAttachFlow(direct, { type: 'settle', token: 1, outcome: { ok: false, needsKey: true } });
  const subFromKey = reduceAttachFlow(needsKey, { type: 'submit', token: 2 });

  assert.equal(reduceAttachFlow(direct, { type: 'cancel' }), null);
  assert.equal(reduceAttachFlow(needsKey, { type: 'cancel' }), null);
  assert.equal(reduceAttachFlow(subFromKey, { type: 'cancel' }), null);
});

test('routeAttachFailure 三态分流：needs-key 落条内，direct 落 direct，不匹配落 row', () => {
  const direct = beginAttachFlow(TARGET, 1);
  assert.deepEqual(routeAttachFailure(direct, { providerKey: TARGET.providerKey, profile: TARGET.profile, token: 1 }), {
    kind: 'direct',
    providerKey: TARGET.providerKey,
  });

  const needsKey = reduceAttachFlow(direct, { type: 'settle', token: 1, outcome: { ok: false, needsKey: true } });
  const subFromKey = reduceAttachFlow(needsKey, { type: 'submit', token: 2 });
  assert.deepEqual(routeAttachFailure(subFromKey, { providerKey: TARGET.providerKey, profile: TARGET.profile, token: 2 }), {
    kind: 'strip',
  });

  assert.deepEqual(routeAttachFailure(subFromKey, { providerKey: TARGET.providerKey, profile: TARGET.profile, token: 1 }), {
    kind: 'row',
    providerKey: TARGET.providerKey,
  });
  assert.deepEqual(routeAttachFailure(needsKey, { providerKey: TARGET.providerKey, profile: TARGET.profile, token: 1 }), {
    kind: 'row',
    providerKey: TARGET.providerKey,
  });
});

test('reconcileAttachFlow：目录未知不清空；目标仍 absent 保留，变为 ready/active/error 或消失则收起', () => {
  const direct = beginAttachFlow(TARGET, 2);
  const needsKey = reduceAttachFlow(direct, { type: 'settle', token: 2, outcome: { ok: false, needsKey: true } });

  assert.equal(reconcileAttachFlow(null, makeViews('absent')), null);
  assert.equal(reconcileAttachFlow(direct, undefined), direct, '目录未就绪时未知，不得清空');
  assert.equal(reconcileAttachFlow(needsKey, undefined), needsKey);

  assert.equal(reconcileAttachFlow(direct, makeViews('absent')), direct);
  assert.equal(reconcileAttachFlow(needsKey, makeViews('absent')), needsKey);

  for (const nextState of ['ready', 'active', 'error']) {
    assert.equal(reconcileAttachFlow(direct, makeViews(nextState)), null, `目标变为 ${nextState} 时必须收起`);
    assert.equal(reconcileAttachFlow(needsKey, makeViews(nextState)), null, `目标变为 ${nextState} 时补密钥条也必须收起`);
  }

  assert.equal(reconcileAttachFlow(needsKey, []), null, '提供商行被删后必须收起');
});
