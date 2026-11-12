/**
 * 自定义端点头像绑定的行内确认状态机。
 *
 * 【设计意图 (Why)】
 *   点击未启用的自定义端点头像时，需要在行内让用户明确选择「仅启用」还是「启用并设为默认」，
 *   如果该端点在其它成员上没有可复用密钥，还需在原位转为输入 API Key 后再提交。
 *   将流转状态收敛为纯函数状态机，避免在 React 组件里散落多个 boolean 与字符串状态，
 *   使每条不变量都能在无 DOM 环境中穷举验证。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 在途请求迟滞返回时可能覆盖新打开的另一行/另一个 Bot 的确认条，必须用递增 `token` 门控 `settle`；
 *   2. 补输密钥提交遇到普通网络错误时若丢失 `draftKey` 或退回 `choosing`，用户必须重打密钥并重选意图；
 *   3. 目录刷新后目标格子已从 `absent` 变为 `ready` / `active` 时，确认条必须自动收起，不残留过期状态。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯函数、零 DOM、零 React、零网络；
 *   2. `settle` 仅在 `phase === 'submitting' && flow.token === event.token` 时生效，其余原样返回；
 *   3. `choose` 在 `submitting` 阶段忽略（防重入）；在 `needs-key` 阶段锁死既有意图并保留草稿以便失败回退；
 *   4. `reconcileAttachFlow` 在 `views === undefined` 时原样保留（目录未知不清空）；目录已知时仅当目标仍为 `absent` 才保留。
 */

import type { BindingAttachIntent, ProviderView } from './providerViews.js';

export interface AttachTarget {
  /** `ProviderView.key`，用于防止跨行串台。 */
  providerKey: string;
  providerId: string;
  profile: string;
}

export type ProviderAttachFlow =
  | ({ phase: 'choosing'; error?: string } & AttachTarget)
  | ({
      phase: 'submitting';
      intent: BindingAttachIntent;
      token: number;
      /** 提交前所处阶段，用于普通失败时原位回退而不丢失用户输入的密钥草稿。 */
      previousPhase?: 'choosing' | 'needs-key';
      draftKey?: string;
    } & AttachTarget)
  | ({ phase: 'needs-key'; intent: BindingAttachIntent; token: number; draftKey: string; error?: string } & AttachTarget);

export type AttachFlowEvent =
  | { type: 'choose'; intent: BindingAttachIntent; token: number }
  | { type: 'settle'; token: number; outcome: { ok: boolean; needsKey?: boolean; message?: string } }
  | { type: 'edit-key'; draftKey: string }
  | { type: 'cancel' };

/** 打开指定目标的行内确认流，初始必为 `choosing`。 */
export function openAttachFlow(target: AttachTarget): ProviderAttachFlow {
  return {
    phase: 'choosing',
    providerKey: target.providerKey,
    providerId: target.providerId,
    profile: target.profile,
  };
}

/** 该确认条当前是否正等待壳层返回（按钮必须锁定）。 */
export function isAttachFlowBusy(flow: ProviderAttachFlow): boolean {
  return flow.phase === 'submitting';
}

/** 驱动确认流状态迁移。 */
export function reduceAttachFlow(
  flow: ProviderAttachFlow,
  event: AttachFlowEvent,
): ProviderAttachFlow | null {
  switch (event.type) {
    case 'cancel':
      return null;

    case 'edit-key': {
      if (flow.phase !== 'needs-key') return flow;
      return { ...flow, draftKey: event.draftKey };
    }

    case 'choose': {
      if (flow.phase === 'submitting') return flow;
      if (flow.phase === 'choosing') {
        return {
          phase: 'submitting',
          providerKey: flow.providerKey,
          providerId: flow.providerId,
          profile: flow.profile,
          intent: event.intent,
          token: event.token,
          previousPhase: 'choosing',
        };
      }
      // `needs-key` 阶段锁死已选意图，并暂存用户输入草稿以便提交失败时原位重试。
      return {
        phase: 'submitting',
        providerKey: flow.providerKey,
        providerId: flow.providerId,
        profile: flow.profile,
        intent: flow.intent,
        token: event.token,
        previousPhase: 'needs-key',
        draftKey: flow.draftKey,
      };
    }

    case 'settle': {
      if (flow.phase !== 'submitting' || flow.token !== event.token) return flow;
      if (event.outcome.ok) return null;
      if (event.outcome.needsKey) {
        // 首次进入补密钥阶段：清空草稿（此前没有可复用的输入）。
        // 二次仍缺密钥：保留用户刚输入的草稿与错误原因，否则用户要重打一遍密钥才知道为什么还是不行。
        const retry = flow.previousPhase === 'needs-key';
        return {
          phase: 'needs-key',
          providerKey: flow.providerKey,
          providerId: flow.providerId,
          profile: flow.profile,
          intent: flow.intent,
          token: flow.token,
          draftKey: retry ? flow.draftKey ?? '' : '',
          error: retry ? event.outcome.message : undefined,
        };
      }
      if (flow.previousPhase === 'needs-key') {
        return {
          phase: 'needs-key',
          providerKey: flow.providerKey,
          providerId: flow.providerId,
          profile: flow.profile,
          intent: flow.intent,
          token: flow.token,
          draftKey: flow.draftKey ?? '',
          error: event.outcome.message,
        };
      }
      return {
        phase: 'choosing',
        providerKey: flow.providerKey,
        providerId: flow.providerId,
        profile: flow.profile,
        error: event.outcome.message,
      };
    }
  }
}

/**
 * 根据最新目录快照收敛确认条。
 *
 * 【规则】
 *   1. `views === undefined` 表示目录尚未就绪（未知），原样返回、不清空；
 *   2. 目录就绪时必须命中 `providerKey` 且目标 `profile` 仍为 `absent` 才保留，否则一律收起（`null`）；
 *   3. 对 `submitting` 同样适用：只要写入已生效（目标不再为 `absent`），立即收起而不等迟滞响应。
 */
export function reconcileAttachFlow(
  flow: ProviderAttachFlow | null,
  views: readonly ProviderView[] | undefined,
): ProviderAttachFlow | null {
  if (!flow) return null;
  if (views === undefined) return flow;
  const view = views.find((item) => item.key === flow.providerKey);
  if (!view) return null;
  const agent = view.agents.find((item) => item.profile === flow.profile);
  if (!agent || agent.state !== 'absent') return null;
  return flow;
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
 * 失败该显示在哪里。
 *
 * 【规则】只有确认条仍是「这次提交的那一条」时才允许写在条内：
 *   同 provider、同 profile、仍处于提交阶段、且令牌一致，四个条件缺一不可。
 *   判据不能只看"存在确认条"——提交期间用户可能已经点开另一个头像，
 *   此时把错误塞进新条会被令牌门拒绝，错误就静默消失了。
 * 【规则】`providerKey` 与 `profile` 必须同时校验：同一 profile 可能挂在多条提供商上，
 *   只比其中一个会把错误写到另一行的条里。
 */
export type AttachFailureSurface =
  | { kind: 'strip' }
  | { kind: 'row'; providerKey: string };

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

/** 网关写入结果的三态判定。 */
export type AttachWriteVerdict =
  | { kind: 'failed' }
  | { kind: 'default-not-applied' }
  | { kind: 'default-changed' }
  | { kind: 'ok' };

/**
 * 写入结果判定（网关语义，属 core 领域）。
 *
 * 【规则】两条守卫都必须报失败，且方向对称：
 *   要求设默认却没设 → `default-not-applied`（否则留下"有勾无环"）；
 *   只要求启用却被设成默认 → `default-changed`（否则提示会说"默认模型未变"，等于撒谎）。
 * 【规则】`currentIsDefault` 为 `undefined` 时无法判断，按成功处理：
 *   不能因为网关没回这个字段就阻断一次真实成功的写入。
 * 【规则】写入本身失败优先，不进入默认模型判定。
 */
export function classifyAttachWrite(
  plan: { makeDefault: boolean },
  outcome: { currentOk: boolean; currentIsDefault?: boolean },
): AttachWriteVerdict {
  if (!outcome.currentOk) return { kind: 'failed' };
  if (plan.makeDefault && outcome.currentIsDefault === false) return { kind: 'default-not-applied' };
  if (!plan.makeDefault && outcome.currentIsDefault === true) return { kind: 'default-changed' };
  return { kind: 'ok' };
}
