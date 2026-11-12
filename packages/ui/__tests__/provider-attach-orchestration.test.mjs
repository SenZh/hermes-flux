import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAttachWrite,
  routeAttachFailure,
  shouldClearAttachFlow,
} from '../../core/dist/models/providerAttachFlow.js';
import {
  messageKeyForVerdict,
  pickProviderViewsState,
  planAttachSettlement,
  shouldNotifyEnableOnly,
} from '../dist/components-react/settings/providerAttachOrchestration.js';

/**
 * 提供商绑定判定的穷举验证。
 *
 * 【为什么必须单独一份】这些判定原先散在无法挂载的 React 组件里，删掉任何一条
 *   测试都不会变红，而用户会看到"点了没反应""错误凭空消失""取消后还弹成功提示"。
 *   拆成 core（网关语义）+ ui（界面编排）两组纯函数后，每条规则都能被穷举与变异。
 *
 * 【覆盖策略】归属校验的四个维度各自单维用例：只让一个维度不匹配，
 *   确保每个 `&&` 都是被独立证伪过的，而不是靠别的维度顺带杀掉。
 */

const TARGET = { providerKey: 'custom:fn', profile: 'aura', token: 7 };

function submittingFlow(overrides = {}) {
  return {
    phase: 'submitting',
    providerKey: TARGET.providerKey,
    providerId: 'fn',
    profile: TARGET.profile,
    intent: 'enable-only',
    token: TARGET.token,
    ...overrides,
  };
}

function viewsWith(state, profile = TARGET.profile, key = TARGET.providerKey) {
  return [{
    key,
    kind: 'custom',
    id: key.split(':')[1],
    name: 'fn',
    models: ['m1'],
    detail: '',
    availability: 'ready',
    agents: [{ profile, displayName: profile, state }],
  }];
}

/* -------------------------------------------------------------------------- */
/* 失败落点：四个归属维度各自单维证伪                                            */
/* -------------------------------------------------------------------------- */

test('失败落点：四个维度全部匹配时写在条内', () => {
  assert.deepEqual(routeAttachFailure(submittingFlow(), TARGET), { kind: 'strip' });
});

test('失败落点：条已消失时落到行级', () => {
  assert.deepEqual(routeAttachFailure(null, TARGET), { kind: 'row', providerKey: TARGET.providerKey });
});

test('失败落点单维：只有 providerKey 不匹配 → 行级', () => {
  const other = submittingFlow({ providerKey: 'custom:cpa', providerId: 'cpa' });
  assert.deepEqual(
    routeAttachFailure(other, TARGET),
    { kind: 'row', providerKey: TARGET.providerKey },
    '错误绝不能写进另一条提供商的确认条',
  );
});

test('失败落点单维：只有 profile 不匹配 → 行级', () => {
  const other = submittingFlow({ profile: 'koru' });
  assert.deepEqual(
    routeAttachFailure(other, TARGET),
    { kind: 'row', providerKey: TARGET.providerKey },
    '同一提供商下另一个 Bot 的确认条不是这次提交的目标',
  );
});

test('失败落点单维：只有 token 不匹配 → 行级', () => {
  const stale = submittingFlow({ token: TARGET.token + 1 });
  assert.deepEqual(
    routeAttachFailure(stale, TARGET),
    { kind: 'row', providerKey: TARGET.providerKey },
    '被新一轮提交顶掉的令牌不得吞掉旧提交的失败',
  );
});

test('失败落点单维：只有 phase 不是 submitting → 行级', () => {
  for (const phase of ['choosing', 'needs-key']) {
    const flow = phase === 'choosing'
      ? { phase, providerKey: TARGET.providerKey, providerId: 'fn', profile: TARGET.profile }
      : {
          phase,
          providerKey: TARGET.providerKey,
          providerId: 'fn',
          profile: TARGET.profile,
          intent: 'enable-only',
          token: TARGET.token,
          draftKey: '',
        };
    assert.deepEqual(
      routeAttachFailure(flow, TARGET),
      { kind: 'row', providerKey: TARGET.providerKey },
      `${phase} 阶段的确认条不在等待这次提交的结果`,
    );
  }
});

/* -------------------------------------------------------------------------- */
/* 目录收敛                                                                     */
/* -------------------------------------------------------------------------- */

test('收敛回写：目标仍是未启用时不得清空，否则用户刚打开的条会瞬间消失', () => {
  assert.equal(shouldClearAttachFlow(submittingFlow(), viewsWith('absent')), false);
});

test('收敛回写：目录未知时不得清空（未知 ≠ 空）', () => {
  assert.equal(shouldClearAttachFlow(submittingFlow(), undefined), false);
});

test('收敛回写：写入已生效或行已消失时必须清空', () => {
  for (const state of ['ready', 'active', 'error']) {
    assert.equal(
      shouldClearAttachFlow(submittingFlow(), viewsWith(state)),
      true,
      `目标变为 ${state} 时必须收起`,
    );
  }
  assert.equal(shouldClearAttachFlow(submittingFlow(), []), true, '提供商行消失必须收起');
  assert.equal(
    shouldClearAttachFlow(submittingFlow(), viewsWith('absent', 'koru')),
    true,
    'Agent 不在该行必须收起',
  );
});

test('收敛回写：同 profile 但不同 providerKey 的行不得被误认成目标', () => {
  assert.equal(
    shouldClearAttachFlow(submittingFlow(), viewsWith('absent', TARGET.profile, 'custom:cpa')),
    true,
    '同名 Agent 挂在另一条提供商上时，目标已不存在，必须收起',
  );
});

test('收敛回写：本身没有确认条时永远不清空（避免无谓重渲染）', () => {
  assert.equal(shouldClearAttachFlow(null, viewsWith('ready')), false);
});

/* -------------------------------------------------------------------------- */
/* 重读期间沿用上一帧                                                            */
/* -------------------------------------------------------------------------- */

test('重读沿用：loading 期间保留上一帧，首次加载仍走加载态', () => {
  const previous = viewsWith('absent');

  const firstLoad = pickProviderViewsState({ status: 'loading' }, undefined);
  assert.equal(firstLoad.state.status, 'loading', '首次加载不得伪装成已就绪');
  assert.equal(firstLoad.lastReady, undefined);

  const reload = pickProviderViewsState({ status: 'loading' }, previous);
  assert.equal(reload.state.status, 'ready', '重读期间必须沿用上一帧，否则提交中的确认条会被卸载');
  assert.deepEqual(reload.state.data, previous);

  const ready = viewsWith('ready');
  const settled = pickProviderViewsState({ status: 'ready', data: ready }, previous);
  assert.equal(settled.state.status, 'ready');
  assert.deepEqual(settled.lastReady, ready, '就绪帧必须更新上一帧快照');

  const failed = pickProviderViewsState({ status: 'error', message: 'boom' }, previous);
  assert.equal(failed.state.status, 'error', '读取失败必须如实显示，不能拿旧数据冒充成功');
  assert.deepEqual(failed.lastReady, previous, '失败不得清掉上一帧，重试仍可沿用');
});

/* -------------------------------------------------------------------------- */
/* 迟滞结果                                                                     */
/* -------------------------------------------------------------------------- */

test('迟滞成功：只有本次意图、本次令牌、且仍成功才提示', () => {
  const ok = { ok: true };
  assert.equal(shouldNotifyEnableOnly(ok, 'enable-only', 7, 7), true);
  assert.equal(shouldNotifyEnableOnly(ok, 'enable-and-default', 7, 7), false, '切默认模型不需要额外提示');
  assert.equal(shouldNotifyEnableOnly(ok, 'enable-only', 0, 7), false, '取消后令牌归零，不得再提示');
  assert.equal(shouldNotifyEnableOnly(ok, 'enable-only', 8, 7), false, '已被新一轮提交顶掉的令牌不得提示');
  assert.equal(shouldNotifyEnableOnly({ ok: false }, 'enable-only', 7, 7), false, '失败不提示成功');
  assert.equal(shouldNotifyEnableOnly(ok, 'enable-only', 0, 0), false, '零令牌永不提示');
});

/* -------------------------------------------------------------------------- */
/* 提交结算                                                                     */
/* -------------------------------------------------------------------------- */

test('提交结算：成功一律回给确认条，由目录收敛负责收起', () => {
  assert.deepEqual(
    planAttachSettlement({ ok: true }, { kind: 'strip' }, 'boom'),
    { kind: 'settle-strip', outcome: { ok: true } },
  );
  assert.deepEqual(
    planAttachSettlement({ ok: true }, { kind: 'row', providerKey: 'custom:fn' }, 'boom'),
    { kind: 'settle-strip', outcome: { ok: true } },
    '成功不得变成行级错误',
  );
});

test('提交结算：失败时条还在就写条内', () => {
  assert.deepEqual(
    planAttachSettlement({ ok: false }, { kind: 'strip' }, 'boom'),
    { kind: 'settle-strip', outcome: { ok: false, message: 'boom' } },
  );
});

test('提交结算：失败时条已消失必须落到行级，不得静默丢弃', () => {
  assert.deepEqual(
    planAttachSettlement({ ok: false }, { kind: 'row', providerKey: 'custom:fn' }, 'boom'),
    { kind: 'row-error', providerKey: 'custom:fn', message: 'boom' },
  );
});

/* -------------------------------------------------------------------------- */
/* 写入结论：两个守卫的正交象限                                                  */
/* -------------------------------------------------------------------------- */

test('写入结论：要求设默认 + 网关没设 → default-not-applied', () => {
  assert.deepEqual(
    classifyAttachWrite({ makeDefault: true }, { currentOk: true, currentIsDefault: false }),
    { kind: 'default-not-applied' },
  );
});

test('写入结论：只要求启用 + 网关却设成默认 → default-changed', () => {
  assert.deepEqual(
    classifyAttachWrite({ makeDefault: false }, { currentOk: true, currentIsDefault: true }),
    { kind: 'default-changed' },
  );
});

test('写入结论：要求设默认 + 网关确实设了 → ok（该象限不得被误判）', () => {
  assert.deepEqual(
    classifyAttachWrite({ makeDefault: true }, { currentOk: true, currentIsDefault: true }),
    { kind: 'ok' },
  );
});

test('写入结论：只要求启用 + 网关没动默认 → ok（该象限不得被误判）', () => {
  assert.deepEqual(
    classifyAttachWrite({ makeDefault: false }, { currentOk: true, currentIsDefault: false }),
    { kind: 'ok' },
  );
});

test('写入结论：写入本身失败优先，不进入默认模型判定', () => {
  assert.deepEqual(
    classifyAttachWrite({ makeDefault: true }, { currentOk: false, currentIsDefault: false }),
    { kind: 'failed' },
  );
  assert.deepEqual(
    classifyAttachWrite({ makeDefault: false }, { currentOk: false, currentIsDefault: true }),
    { kind: 'failed' },
  );
});

test('写入结论：网关没回 currentIsDefault 时按成功处理，不得阻断真实成功的写入', () => {
  assert.deepEqual(classifyAttachWrite({ makeDefault: true }, { currentOk: true }), { kind: 'ok' });
  assert.deepEqual(classifyAttachWrite({ makeDefault: false }, { currentOk: true }), { kind: 'ok' });
});

/* -------------------------------------------------------------------------- */
/* 结论文案                                                                     */
/* -------------------------------------------------------------------------- */

test('结论文案：ok 不产出文案，其余三态各自有独立原因', () => {
  assert.equal(messageKeyForVerdict({ kind: 'ok' }), null);
  assert.equal(messageKeyForVerdict({ kind: 'default-not-applied' }), 'settings.providerToggleNotDefault');
  assert.equal(messageKeyForVerdict({ kind: 'default-changed' }), 'settings.providerAttachDefaultChanged');
  assert.equal(messageKeyForVerdict({ kind: 'failed' }), 'settings.providerToggleFailed');
  assert.notEqual(
    messageKeyForVerdict({ kind: 'default-not-applied' }),
    messageKeyForVerdict({ kind: 'default-changed' }),
    '两个方向的守卫必须给出不同原因，否则用户分不清网关做了什么',
  );
});
