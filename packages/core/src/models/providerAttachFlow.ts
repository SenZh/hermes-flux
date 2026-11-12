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
        return {
          phase: 'needs-key',
          providerKey: flow.providerKey,
          providerId: flow.providerId,
          profile: flow.profile,
          intent: flow.intent,
          token: flow.token,
          draftKey: '',
          error: flow.previousPhase === 'needs-key' ? event.outcome.message : undefined,
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
