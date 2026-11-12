import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAttachWrite,
  pickProviderViewsState,
  routeAttachFailure,
  shouldClearAttachFlow,
  shouldNotifyEnableOnly,
} from '../dist/components-react/settings/providerAttachOrchestration.js';

/**
 * 提供商绑定界面编排的穷举验证。
 *
 * 【为什么必须单独一份】这五条判定原先散在无法挂载的 React 组件里，
 *   删掉任何一条测试都不会变红，而用户会看到"点了没反应""错误凭空消失"
 *   "取消后还弹出成功提示""提交中列表闪一下重建"。
 *   抽成纯函数后，每条规则都能在 Node 里被穷举与变异。
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
/* 失败落点                                                                     */
/* -------------------------------------------------------------------------- */

test('失败落点：确认条仍是这次提交的那一条时写在条内', () => {
  assert.deepEqual(routeAttachFailure(submittingFlow(), TARGET), { kind: 'strip' });
});

test('失败落点：条已消失时必须落到行级，不能静默丢弃', () => {
  assert.deepEqual(routeAttachFailure(null, TARGET), { kind: 'row', providerKey: TARGET.providerKey });
});

test('失败落点：用户已切到另一个头像时不得把错误塞进别人的条', () => {
  const other = submittingFlow({ profile: 'koru', token: 9 });
  assert.deepEqual(routeAttachFailure(other, TARGET), { kind: 'row', providerKey: TARGET.providerKey });

  const otherProvider = submittingFlow({ providerKey: 'custom:cpa', providerId: 'cpa' });
  assert.deepEqual(routeAttachFailure(otherProvider, TARGET), { kind: 'row', providerKey: TARGET.providerKey });
});

test('失败落点：令牌已被新一轮提交顶掉时同样落行级', () => {
  const stale = submittingFlow({ token: TARGET.token + 1 });
  assert.deepEqual(routeAttachFailure(stale, TARGET), { kind: 'row', providerKey: TARGET.providerKey });
});

test('失败落点：确认条停在 choosing（未提交）时不得吞掉提交失败', () => {
  const choosing = { phase: 'choosing', providerKey: TARGET.providerKey, providerId: 'fn', profile: TARGET.profile };
  assert.deepEqual(routeAttachFailure(choosing, TARGET), { kind: 'row', providerKey: TARGET.providerKey });
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
/* 写入结果                                                                     */
/* -------------------------------------------------------------------------- */

test('写入结果：要求设默认却没设，必须报失败（否则留下有勾无环）', () => {
  assert.deepEqual(
    classifyAttachWrite({ makeDefault: true }, { currentOk: true, currentIsDefault: false }),
    { kind: 'default-not-applied' },
  );
});

test('写入结果：只要求启用却被改成默认，必须报失败（否则提示会说默认未变）', () => {
  assert.deepEqual(
    classifyAttachWrite({ makeDefault: false }, { currentOk: true, currentIsDefault: true }),
    { kind: 'default-changed' },
  );
});

test('写入结果：写入本身失败优先，不进入默认模型判定', () => {
  assert.deepEqual(
    classifyAttachWrite({ makeDefault: true }, { currentOk: false, currentIsDefault: false }),
    { kind: 'failed', message: '' },
  );
});

test('写入结果：网关没回 currentIsDefault 时按成功处理，不得阻断真实成功的写入', () => {
  assert.deepEqual(
    classifyAttachWrite({ makeDefault: true }, { currentOk: true }),
    { kind: 'ok' },
  );
  assert.deepEqual(
    classifyAttachWrite({ makeDefault: false }, { currentOk: true }),
    { kind: 'ok' },
  );
});
