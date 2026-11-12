import type { ProviderAttachFlow, ProviderView } from '@hermes-flux/core';
import { reconcileAttachFlow } from '@hermes-flux/core';
import type { SettingsLoadable, ToggleProviderAgentResult } from './settingsModel.js';

/**
 * 提供商绑定的界面编排判定（纯函数，零 DOM / 零 React）。
 *
 * 【设计意图 (Why)】
 *   绑定确认条的几条关键规则——失败往哪显示、什么时候收起、重读期间显示什么、
 *   迟滞结果能不能弹提示——原先全部散在 `ProvidersAdminPanel` 的 effect 与回调里。
 *   组件无法在无 DOM 环境挂载，于是这些规则既测不到也守不住：删掉任何一条，
 *   测试全绿，用户却会看到"点了没反应"或"错误凭空消失"。
 *   把判定抽成纯函数后，每条规则都能在 Node 里穷举，组件只做取值与渲染。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 目录收敛结果只用于渲染、不回写 state，导致确认条能在用户从未点过的格子上复活。
 *   2. 提交失败时若确认条已被目录收敛清空，把错误塞回条里等于丢弃：
 *      用户看到绿环亮起、没有任何提示。
 *   3. 用户取消后迟滞的成功响应仍会弹「已启用」，等于报告一条用户已经撤销的操作。
 *   4. 每次写入后壳层会把目录置 loading，`LoadBoundary` 只渲染一行文案，
 *      整张表连同提交中的确认条被卸载重建。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯函数、零副作用；不读时间、不读随机、不读环境；
 *   2. 所有判定返回判别联合，不用多个布尔拼状态；
 *   3. 失败落点必须由「确认条是否仍是这次提交的那一条」决定，而不是"有没有确认条"。
 */

/** 失败该显示在哪里。 */
export type AttachFailureSurface =
  | { kind: 'strip' }
  | { kind: 'row'; providerKey: string };

/**
 * 失败落点判定。
 *
 * 【规则】只有确认条仍是「这次提交的那一条」时才允许写在条内：
 *   同 provider、同 profile 且令牌一致。否则一律落到行级提示。
 *   判据不能只看"存在确认条"——提交期间用户可能已经点开另一个头像，
 *   此时把错误塞进新条会被令牌门拒绝，错误就静默消失了。
 */
export function routeAttachFailure(
  flow: ProviderAttachFlow | null,
  target: { providerKey: string; profile: string; token: number },
): AttachFailureSurface {
  if (
    flow
    && flow.providerKey === target.providerKey
    && flow.profile === target.profile
    && flow.phase === 'submitting'
    && flow.token === target.token
  ) {
    return { kind: 'strip' };
  }
  return { kind: 'row', providerKey: target.providerKey };
}

/**
 * 确认条是否该被目录收敛清空。
 *
 * 【规则】只在派生为 null 且 state 仍非空时返回 true，避免无谓重渲染。
 * 【规则】目录未就绪（`undefined`）时不得清空：未知 ≠ 空。
 */
export function shouldClearAttachFlow(
  flow: ProviderAttachFlow | null,
  views: readonly ProviderView[] | undefined,
): boolean {
  if (!flow) return false;
  return reconcileAttachFlow(flow, views) === null;
}

/**
 * 重读期间沿用上一帧目录。
 *
 * 【规则】只有"当前是 loading 且已有上一帧就绪数据"才替换；
 *   首次加载（从未 ready 过）必须走正常的加载态，不能显示空表。
 */
export function pickProviderViewsState<T>(
  state: SettingsLoadable<T>,
  lastReady: T | undefined,
): { state: SettingsLoadable<T>; lastReady: T | undefined } {
  if (state.status === 'ready') return { state, lastReady: state.data };
  if (state.status === 'loading' && lastReady !== undefined) {
    return { state: { status: 'ready', data: lastReady }, lastReady };
  }
  return { state, lastReady };
}

/**
 * 迟滞的成功结果能否弹「已启用」提示。
 *
 * 【规则】必须是本次意图、本次令牌、且仍然成功；用户取消或切到别的格子后
 *   令牌归零或前进，一律不提示。
 */
export function shouldNotifyEnableOnly(
  result: ToggleProviderAgentResult,
  intent: 'enable-only' | 'enable-and-default',
  liveToken: number,
  token: number,
): boolean {
  return result.ok && intent === 'enable-only' && liveToken === token && token !== 0;
}

/** 写入结果的三态判定：成功、失败、成功但网关没按要求处理默认模型。 */
export type AttachWriteVerdict =
  | { kind: 'failed'; message: string }
  | { kind: 'default-not-applied' }
  | { kind: 'default-changed' }
  | { kind: 'ok' };

/**
 * 写入结果判定。
 *
 * 【规则】两条守卫都必须报失败，且方向对称：
 *   要求设默认却没设 → `default-not-applied`（否则留下"有勾无环"）；
 *   只要求启用却被设成默认 → `default-changed`（否则提示会说"默认模型未变"，等于撒谎）。
 * 【规则】`currentIsDefault` 为 `undefined` 时无法判断，按成功处理：
 *   不能因为网关没回这个字段就阻断一次真实成功的写入。
 */
export function classifyAttachWrite(
  plan: { makeDefault: boolean },
  outcome: { currentOk: boolean; currentIsDefault?: boolean },
): AttachWriteVerdict {
  if (!outcome.currentOk) return { kind: 'failed', message: '' };
  if (plan.makeDefault && outcome.currentIsDefault === false) return { kind: 'default-not-applied' };
  if (!plan.makeDefault && outcome.currentIsDefault === true) return { kind: 'default-changed' };
  return { kind: 'ok' };
}
