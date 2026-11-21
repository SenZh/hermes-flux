/**
 * 自定义端点头像开启（绑定）的行内补密钥状态机。
 *
 * 【设计意图 (Why)】
 *   点击未开启的自定义端点头像时，直接向网关发起开启（优先从其他已开启成员复用密钥，不改默认模型）；
 *   若没有可复用的密钥，则在行内原位展开补密钥条，由用户输入 API Key 后提交。
 *   将流转状态收敛为纯函数状态机，避免在 React 组件里散落多个 boolean 与字符串状态，
 *   使每条不变量都能在无 DOM 环境中穷举验证。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 在途请求迟滞返回时可能覆盖新打开的另一行/另一个 Bot 的状态，必须用递增 `token` 门控 `settle`；
 *   2. 补输密钥提交遇到普通网络错误时若丢失 `draftKey` 或退回空白，用户必须重打密钥；
 *   3. 目录刷新后目标格子已从 `absent` 变为 `ready` / `active` 时，确认条必须自动收起，不残留过期状态。
 *   4. 直接点击开启（`previousPhase: 'direct'`）成功或直接复用密钥期间不得闪烁展开补密钥条。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯函数、零 DOM、零 React、零网络；
 *   2. `settle` 仅在 `phase === 'submitting' && flow.token === event.token` 时生效，其余原样返回；
 *   3. `submit` 在 `submitting` 阶段忽略（防重入）；在 `needs-key` 阶段保留草稿以便失败回退；
 *   4. `reconcileAttachFlow` 在 `views === undefined` 时原样保留（目录未知不清空）；目录已知时仅当目标仍为 `absent` 才保留。
 */

import type { ProviderView } from './providerViews.js';

export interface AttachTarget {
  /** `ProviderView.key`，用于防止跨行串台。 */
  providerKey: string;
  providerId: string;
  profile: string;
}

export type ProviderAttachFlow =
  | ({
      phase: 'submitting';
      token: number;
      /** 提交前所处阶段：direct 表示直接点头像开启（不展示条）；needs-key 表示补密钥后提交（保持条内输入框）。 */
      previousPhase: 'direct' | 'needs-key';
      draftKey?: string;
    } & AttachTarget)
  | ({ phase: 'needs-key'; token: number; draftKey: string; error?: string } & AttachTarget);

export type AttachFlowEvent =
  | { type: 'submit'; token: number }
  | { type: 'settle'; token: number; outcome: { ok: boolean; needsKey?: boolean; message?: string } }
  | { type: 'edit-key'; draftKey: string }
  | { type: 'cancel' };

/** 直接点头像开启：进入 direct 提交态（不展开行内条，若缺密钥再在 settle 时落到 needs-key）。 */
export function beginAttachFlow(target: AttachTarget, token: number): ProviderAttachFlow {
  return {
    phase: 'submitting',
    providerKey: target.providerKey,
    providerId: target.providerId,
    profile: target.profile,
    token,
    previousPhase: 'direct',
  };
}

/** 该确认流当前是否正等待壳层返回（对应头像必须锁定）。 */
export function isAttachFlowBusy(flow: ProviderAttachFlow): boolean {
  return flow.phase === 'submitting';
}

/** 是否应当在行内展开补密钥条。直接点击复用密钥期间返回 false，零布局跳动。 */
export function shouldShowAttachStrip(flow: ProviderAttachFlow | null): boolean {
  if (!flow) return false;
  return flow.phase === 'needs-key' || flow.previousPhase === 'needs-key';
}

/** 驱动开启/补密钥流状态迁移。 */
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

    case 'submit': {
      if (flow.phase === 'submitting') return flow;
      return {
        phase: 'submitting',
        providerKey: flow.providerKey,
        providerId: flow.providerId,
        profile: flow.profile,
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
          token: flow.token,
          draftKey: flow.draftKey ?? '',
          error: event.outcome.message,
        };
      }
      // direct 阶段的普通失败：收起状态流，由调用方通过 routeAttachFailure 转成行级错误。
      return null;
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
 * 【规则】只有确认流仍是「这次提交的那一条」时才允许按提交前阶段分发：
 *   - 补密钥提交（`previousPhase === 'needs-key'`）→ `strip`（错误留在补密钥条内）；
 *   - 直接点头像开启（`previousPhase === 'direct'`）→ `direct`（缺密钥时由条接管，普通失败收起并落到行级）；
 *   - 令牌/目标/阶段任一不匹配 → `row`（落到行级，绝不写进别的条或静默丢弃）。
 */
export type AttachFailureSurface =
  | { kind: 'strip' }
  | { kind: 'direct'; providerKey: string }
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
    return flow.previousPhase === 'needs-key'
      ? { kind: 'strip' }
      : { kind: 'direct', providerKey: target.providerKey };
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
