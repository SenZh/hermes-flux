import type { AttachFailureSurface, AttachWriteVerdict } from '@hermes-flux/core';
import type { SettingsLoadable, ToggleProviderAgentResult } from './settingsModel.js';

/**
 * 提供商绑定的界面编排判定（纯函数，零 DOM / 零 React）。
 *
 * 【设计意图 (Why)】
 *   绑定确认条的关键规则原先散在 `ProvidersAdminPanel` 的 effect 与回调里。组件无法在
 *   无 DOM 环境挂载，于是这些规则既测不到也守不住：删掉任何一条，测试全绿，
 *   用户却会看到"点了没反应""取消后还弹出成功提示""提交中列表闪一下重建"。
 *   这里把「一次提交结束后该发生什么」收敛成一次纯计算，组件只负责执行返回值。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 每次写入后壳层会把目录置 loading，`LoadBoundary` 只渲染一行文案，
 *      整张表连同提交中的确认条被卸载重建。
 *   2. 用户取消后迟滞的成功响应仍会弹「已启用」，等于报告一条用户已经撤销的操作。
 *   3. 失败落点只判"有没有确认条"时，用户切到别的头像会让错误被令牌门丢弃、静默消失。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯函数、零副作用；不读时间、不读随机、不读环境；
 *   2. 网关语义（落点归属、写入结论）由 core 裁定，本文件只消费其结果；
 *   3. 返回值描述"该做什么"，不直接做。
 */

/**
 * 重读期间沿用上一帧目录。
 *
 * 【规则】只有"当前是 loading 且已有上一帧就绪数据"才替换；
 *   首次加载（从未 ready 过）必须走正常的加载态，不能显示空表。
 * 【规则】读取失败必须如实显示，但不清掉上一帧，重试仍可沿用。
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
 *   令牌归零或前进，一律不提示。零令牌永远不提示。
 */
export function shouldNotifyEnableOnly(
  result: ToggleProviderAgentResult,
  intent: 'enable-only' | 'enable-and-default',
  liveToken: number,
  token: number,
): boolean {
  return result.ok && intent === 'enable-only' && liveToken === token && token !== 0;
}

/** 一次提交结束后要执行的动作。 */
export type AttachSettlement =
  | { kind: 'settle-strip'; outcome: { ok: boolean; needsKey?: boolean; message?: string } }
  | { kind: 'row-error'; providerKey: string; message: string };

/**
 * 一次提交结果的落地方式。
 *
 * 【规则】成功一律回给确认条结算：成功后由目录收敛负责收起，界面不留手工残留。
 * 【规则】失败时落点由 core 的 `routeAttachFailure` 决定：
 *   条仍是这次提交的那一条就写条内，否则挂到行级——不能因为条没了就把错误丢掉。
 * 【规则】用户已取消（令牌归零）时仍然结算：界面必须如实反映网关已经发生的写入，
 *   只是不弹成功提示。这里不做"静默成功"的优化，静默等于撒谎。
 */
export function planAttachSettlement(
  result: ToggleProviderAgentResult,
  surface: AttachFailureSurface,
  failureMessage: string,
): AttachSettlement {
  if (result.ok) return { kind: 'settle-strip', outcome: result };
  if (surface.kind === 'strip') {
    return { kind: 'settle-strip', outcome: { ok: false, message: failureMessage } };
  }
  return { kind: 'row-error', providerKey: surface.providerKey, message: failureMessage };
}

/**
 * 写入结论对应的文案 key。
 *
 * 【规则】`ok` 不产出文案；其余三态各自有独立可读原因，禁止合并成一句"操作失败"。
 * 【规则】`failed` 的网关原文由调用方直接使用，这里只给兜底 key。
 */
export type AttachVerdictMessageKey =
  | 'settings.providerToggleNotDefault'
  | 'settings.providerAttachDefaultChanged'
  | 'settings.providerToggleFailed';

export function messageKeyForVerdict(verdict: AttachWriteVerdict): AttachVerdictMessageKey | null {
  if (verdict.kind === 'ok') return null;
  if (verdict.kind === 'default-not-applied') return 'settings.providerToggleNotDefault';
  if (verdict.kind === 'default-changed') return 'settings.providerAttachDefaultChanged';
  return 'settings.providerToggleFailed';
}
