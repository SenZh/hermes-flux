/**
 * 行内绑定确认流状态机（providerAttachFlow）全分支验证。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAttachFlowBusy,
  openAttachFlow,
  reconcileAttachFlow,
  reduceAttachFlow,
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

test('openAttachFlow 初始处于 choosing 且非 busy', () => {
  const flow = openAttachFlow(TARGET);
  assert.deepEqual(flow, { phase: 'choosing', ...TARGET });
  assert.equal(isAttachFlowBusy(flow), false);
});

test('choose 进入 submitting 并防重入，过期 token 的 settle 必须丢弃', () => {
  const choosing = openAttachFlow(TARGET);
  const submitting = reduceAttachFlow(choosing, { type: 'choose', intent: 'enable-only', token: 7 });
  assert.ok(submitting && submitting.phase === 'submitting');
  assert.equal(isAttachFlowBusy(submitting), true);
  assert.equal(submitting.intent, 'enable-only');
  assert.equal(submitting.token, 7);

  // submitting 下重复 choose 被忽略（防重入）。
  const reentered = reduceAttachFlow(submitting, { type: 'choose', intent: 'enable-and-default', token: 8 });
  assert.equal(reentered, submitting, '提交期间不得覆盖已有 intent 与 token');

  // 过期 token 的 settle 原样返回。
  const stale = reduceAttachFlow(submitting, {
    type: 'settle',
    token: 6,
    outcome: { ok: true },
  });
  assert.equal(stale, submitting, '过期 token 不得提前收起或更改当前确认流');
});

test('settle 成功直接收起（返回 null）', () => {
  const submitting = reduceAttachFlow(openAttachFlow(TARGET), {
    type: 'choose',
    intent: 'enable-and-default',
    token: 1,
  });
  assert.equal(reduceAttachFlow(submitting, { type: 'settle', token: 1, outcome: { ok: true } }), null);
});

test('settle 需要密钥时切入 needs-key，继承原意图且 draftKey 置空，edit-key 仅在 needs-key 生效', () => {
  const choosing = openAttachFlow(TARGET);
  // choosing 下 edit-key 忽略
  assert.equal(reduceAttachFlow(choosing, { type: 'edit-key', draftKey: 'sk-ignored' }), choosing);

  const submitting = reduceAttachFlow(choosing, {
    type: 'choose',
    intent: 'enable-only',
    token: 3,
  });
  // submitting 下 edit-key 忽略
  assert.equal(reduceAttachFlow(submitting, { type: 'edit-key', draftKey: 'sk-ignored' }), submitting);

  const needsKey = reduceAttachFlow(submitting, {
    type: 'settle',
    token: 3,
    outcome: { ok: false, needsKey: true, message: 'need key' },
  });
  assert.deepEqual(needsKey, {
    phase: 'needs-key',
    ...TARGET,
    intent: 'enable-only',
    token: 3,
    draftKey: '',
    error: undefined,
  });

  const edited = reduceAttachFlow(needsKey, { type: 'edit-key', draftKey: 'sk-user-123' });
  assert.equal(edited.phase, 'needs-key');
  assert.equal(edited.draftKey, 'sk-user-123');
});

test('settle 普通失败：从 choosing 提交回 choosing；从 needs-key 提交留在 needs-key 并保留用户输入', () => {
  // 1. choosing -> submitting -> 普通失败 -> choosing
  const subFromChoose = reduceAttachFlow(openAttachFlow(TARGET), {
    type: 'choose',
    intent: 'enable-and-default',
    token: 10,
  });
  const backToChoose = reduceAttachFlow(subFromChoose, {
    type: 'settle',
    token: 10,
    outcome: { ok: false, message: 'HTTP 500' },
  });
  assert.deepEqual(backToChoose, {
    phase: 'choosing',
    ...TARGET,
    error: 'HTTP 500',
  });

  // 2. needs-key -> edit-key -> submitting -> 普通失败 -> 留在 needs-key 且保留草稿与意图
  const needsKey = reduceAttachFlow(subFromChoose, {
    type: 'settle',
    token: 10,
    outcome: { ok: false, needsKey: true },
  });
  const withDraft = reduceAttachFlow(needsKey, { type: 'edit-key', draftKey: 'sk-keep-me' });
  const subFromKey = reduceAttachFlow(withDraft, {
    type: 'choose',
    intent: 'enable-and-default',
    token: 11,
  });
  const backToKey = reduceAttachFlow(subFromKey, {
    type: 'settle',
    token: 11,
    outcome: { ok: false, message: 'HTTP 401: invalid key' },
  });
  assert.deepEqual(backToKey, {
    phase: 'needs-key',
    ...TARGET,
    intent: 'enable-and-default',
    token: 11,
    draftKey: 'sk-keep-me',
    error: 'HTTP 401: invalid key',
  });
});

test('cancel 在所有阶段恒返回 null', () => {
  const choosing = openAttachFlow(TARGET);
  const submitting = reduceAttachFlow(choosing, { type: 'choose', intent: 'enable-only', token: 1 });
  const needsKey = reduceAttachFlow(submitting, { type: 'settle', token: 1, outcome: { ok: false, needsKey: true } });

  assert.equal(reduceAttachFlow(choosing, { type: 'cancel' }), null);
  assert.equal(reduceAttachFlow(submitting, { type: 'cancel' }), null);
  assert.equal(reduceAttachFlow(needsKey, { type: 'cancel' }), null);
});

test('reconcileAttachFlow：目录未知不清空；目标仍 absent 保留，变为 ready/active/error 或消失则收起', () => {
  const choosing = openAttachFlow(TARGET);
  const submitting = reduceAttachFlow(choosing, { type: 'choose', intent: 'enable-only', token: 2 });

  assert.equal(reconcileAttachFlow(null, makeViews('absent')), null);
  assert.equal(reconcileAttachFlow(choosing, undefined), choosing, '目录未就绪时未知，不得清空确认条');
  assert.equal(reconcileAttachFlow(submitting, undefined), submitting);

  assert.equal(reconcileAttachFlow(choosing, makeViews('absent')), choosing);
  assert.equal(reconcileAttachFlow(submitting, makeViews('absent')), submitting);

  for (const nextState of ['ready', 'active', 'error']) {
    assert.equal(reconcileAttachFlow(choosing, makeViews(nextState)), null, `目标变为 ${nextState} 时必须收起`);
    assert.equal(reconcileAttachFlow(submitting, makeViews(nextState)), null, `submitting 时目标已变为 ${nextState} 也必须立即收起`);
  }

  assert.equal(reconcileAttachFlow(choosing, []), null, '提供商行被删后必须收起');
});
