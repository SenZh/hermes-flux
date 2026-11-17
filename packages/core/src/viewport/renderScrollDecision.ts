/**
 * 渲染期视口裁决（纯逻辑）。
 *
 * 【设计意图 (Why)】
 *   跨会话「进去之后视口在哪」的判定过去散落在 render 主体里：进入期是否捕获旧 DOM、
 *   非进入期是否贴底、rAF 是否推进进入计划。分支一多就既难穷举测试，也容易在重构中漂移。
 *   把这三个判定收敛成一次组合裁决，并把「按裁决取锚点」也收成一次调用，
 *   宿主只负责把 deps 与真实 DOM 递进来。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯逻辑：零 DOM、零 Timer、零 React，可在 Node 与属性测试中任意穷举；
 *   2. 进入计划挂起（enterPending）时绝不返回 capture=true —— 此时 activeSessionId 已是
 *      目标会话而 DOM 仍是上一会话，捕获会把旧位置以新会话 id 写进记忆；
 *   3. advanceSessionEnter 只取决于 rAF 是否可用：没有 rAF 时不推进、也不抛错。
 */

export type ViewportPinInput = {
  enterPending: boolean;
  forcedBottom: boolean;
  wasNearBottom: boolean;
  messagesChanged: boolean;
  hasRaf: boolean;
}

export type ViewportPinDecision = {
  capture: boolean;
  pinBottom: boolean;
  applyAnchor: boolean;
  advanceSessionEnter: boolean;
}

/**
 * 组合裁决：进入期/非进入期、贴底/回溯、是否推进进入计划。
 */
export function decideViewportPin(input: ViewportPinInput): ViewportPinDecision {
  if (input.enterPending) {
    return { capture: false, pinBottom: false, applyAnchor: false, advanceSessionEnter: input.hasRaf };
  }
  return {
    capture: true,
    pinBottom: input.forcedBottom || input.wasNearBottom,
    applyAnchor: true,
    advanceSessionEnter: input.hasRaf && input.messagesChanged,
  };
}

/**
 * 按裁决取锚点：capture 为真才真正调用捕获函数。
 * 【规则】捕获函数只在需要的分支被调用，避免进入期把旧 DOM 写进新会话记忆。
 */
export function chooseViewportAnchor<A>(decision: ViewportPinDecision, captureFn: () => A, fallback: A): A {
  if (decision.capture) return captureFn();
  return fallback;
}
