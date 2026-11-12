/**
 * 输入舱队列控制与高度自适应的纯决策层
 *
 * 【设计意图 (Why)】
 *   这些规则原本散在 `renderer/index.ts` 的事件回调里，只能靠手点浏览器验证。
 *   抽成纯函数后，每个分支都能用单测穷举：高度 clamp 的边界、队列三动作的
 *   调用顺序与状态迁移、入队成功/失败的草稿归属。
 *
 * 【约束与规则 (Rules)】
 *   1. 零 DOM、零网络、零副作用：只做决策，不执行；
 *   2. 入参是"已经读到的事实"（草稿文本、网关 id、回执），出参是"接下来做什么"；
 *   3. 任何失败路径都必须给出显式的用户可见原因，不允许返回空。
 */

/** 输入区高度边界，与 `conversation.css` 的 min-height / max-height 必须一致。 */
export const COMPOSER_MIN_HEIGHT = 66;
export const COMPOSER_MAX_HEIGHT = 220;

/**
 * 由 scrollHeight 算出应写入的高度。
 *
 * 【防范的历史坑 (Pitfall)】调用方必须先 `style.height = 'auto'` 再读 scrollHeight，
 *   否则回删时读到的是被旧高度撑住的滚动高度，高度会永久卡在上限。
 */
export function clampComposerHeight(scrollHeight: number): number {
  // NaN 意味着"没量到"，回落到下界；±Infinity 仍是单调的，按方向夹到两端。
  if (Number.isNaN(scrollHeight)) return COMPOSER_MIN_HEIGHT;
  return Math.min(Math.max(Math.round(scrollHeight), COMPOSER_MIN_HEIGHT), COMPOSER_MAX_HEIGHT);
}

/** 入队请求的决策结果。 */
export type EnqueuePlan =
  | { kind: 'skip' }
  | { kind: 'fail'; reasonKey: string }
  | { kind: 'submit'; text: string };

/**
 * 决定是否把当前草稿送进队列。
 *
 * 【规则】空草稿直接跳过（不是错误）；网关不可用与无实时通道是两种不同的失败，
 *   必须给出不同文案，否则用户无法判断该重连还是该切会话。
 */
export function planEnqueue(input: {
  text: string;
  hasGateway: boolean;
  hasLiveSession: boolean;
}): EnqueuePlan {
  const text = input.text.trim();
  if (!text) return { kind: 'skip' };
  if (!input.hasGateway) return { kind: 'fail', reasonKey: 'chat.gatewayNotConnected' };
  if (!input.hasLiveSession) return { kind: 'fail', reasonKey: 'dock.queueNoLive' };
  return { kind: 'submit', text };
}

/**
 * 入队回执落地。
 *
 * 【规则】没有 `admission_id` 就是没排上队：必须报失败并**保留草稿**，
 *   绝不能因为 HTTP 200 就清空输入框，把用户写的内容吞掉。
 */
export function applyEnqueueReceipt(receipt: { admission_id?: string } | null | undefined, text: string):
  | { kind: 'queued'; entry: { id: string; admissionId: string; text: string } }
  | { kind: 'failed'; reasonKey: string } {
  const admissionId = receipt?.admission_id;
  if (!admissionId) return { kind: 'failed', reasonKey: 'dock.queueFailed' };
  return { kind: 'queued', entry: { id: admissionId, admissionId, text } };
}

/** 队列三动作的调用计划。 */
export type QueueActionPlan =
  | { kind: 'steer'; method: 'prompt.steer_queued' }
  | { kind: 'cancel'; method: 'prompt.cancel' }
  | { kind: 'replace'; method: 'prompt.cancel'; restoreText: string }
  | { kind: 'unknown' };

/**
 * 把 `data-action` 翻译成 RPC 计划。
 *
 * 【设计意图 (Why)】
 *   「放回编辑」在网关侧就是"撤销这条准入"，再由客户端把文本写回输入舱；
 *   因此它复用 `prompt.cancel`，而不是 `prompt.replace_queued`——
 *   后者会把编辑结果作为**新**准入重新排到队尾，与"放回输入框让用户改"的语义不符。
 *
 * 【防范的历史坑 (Pitfall)】未知 action 必须显式返回 `unknown`，
 *   不能默认落到 cancel —— 否则新增按钮写错属性会静默撤销用户的排队消息。
 */
export function planQueueAction(action: string, entryText: string): QueueActionPlan {
  switch (action) {
    case 'queue-steer':
      return { kind: 'steer', method: 'prompt.steer_queued' };
    case 'queue-cancel':
      return { kind: 'cancel', method: 'prompt.cancel' };
    case 'queue-replace':
      return { kind: 'replace', method: 'prompt.cancel', restoreText: entryText };
    default:
      return { kind: 'unknown' };
  }
}

/**
 * 动作成功后应从队列移除哪些条目。
 *
 * 【规则】三种动作都会让该准入离开排队态：取消是撤销，放回编辑是撤销后转草稿，
 *   立即执行是被当前回合接走。三条都必须移除，否则界面会永久残留一条已经不在网关里的行。
 */
export function queuedAfterAction(
  queued: ReadonlyArray<{ admissionId: string }>,
  admissionId: string,
): Array<{ admissionId: string }> {
  return queued.filter((q) => q.admissionId !== admissionId);
}

/** 运行态主按钮列里「入队」是否可见。 */
export function shouldShowQueueButton(input: { text: string; attachmentCount: number }): boolean {
  return input.text.trim().length > 0 || input.attachmentCount > 0;
}

/** 空闲态发送是否可用。 */
export function canSendDraft(input: { text: string; attachmentCount: number }): boolean {
  return input.text.trim().length > 0 || input.attachmentCount > 0;
}

/**
 * 主按钮相位。
 *
 * 【设计意图 (Why)】
 *   `state.isStreaming` 与「本会话是否有活跃回合」是两个真值：前者只反映最近一次写入，
 *   切换会话后不会跟着变。渲染曾用后者、回车判定用前者，于是出现
 *   「界面是发送按钮，回车却弹回合进行中」的错位。
 *   把相位收成一个纯函数，渲染与按键读同一份输入，这类分歧在类型上就无法再写出来。
 */
export function resolveComposerPhase(input: {
  /** 本会话是否有活跃回合（isStreamingActiveForCurrentSession 的结果） */
  activeTurn: boolean;
}): 'idle' | 'running' {
  return input.activeTurn ? 'running' : 'idle';
}

/** 回车在给定相位下该做什么。 */
export type EnterAction =
  | { kind: 'submit' }
  | { kind: 'enqueue' }
  | { kind: 'ignore' };

/**
 * 回车分派。
 *
 * 【规则】运行态回车必须入队而不是弹阻断提示：停止是主按钮的职责，回车不承担中断。
 *   空草稿时不入队也不报错（跳过不是失败）。
 */
export function planEnterAction(input: {
  phase: 'idle' | 'running';
  text: string;
  attachmentCount: number;
}): EnterAction {
  const hasDraft = input.text.trim().length > 0 || input.attachmentCount > 0;
  if (input.phase === 'idle') return { kind: 'submit' };
  return hasDraft ? { kind: 'enqueue' } : { kind: 'ignore' };
}
