/**
 * 消息挂载窗口纯逻辑。
 *
 * 【设计意图 (Why)】
 *   窗口起点决定“首屏挂多少条消息”。它同时受会话切换、新消息到达、读者是否贴底、
 *   是否主动向上翻阅、以及回滚截断影响。把状态迁移抽成纯函数，才能对边界做可证伪测试，
 *   避免再次出现“窗口起点等于总长 → 空白会话”或“读者回溯时顶部行被抽走”。
 *
 * 【约束与规则 (Rules)】
 *   - 0 <= start <= total（total 为 0 时 start 必须为 0）；
 *   - 切会话必须回到末尾窗口，绝不继承上一会话的阅读位置；
 *   - 读者离开底部回溯时冻结起点，新消息到达不得抽走顶部已挂载行；
 *   - 回滚/截断把总长压到与起点相等时，必须收敛回末尾窗口并解除“已扩展”状态。
 */

export interface MessageWindowPlanInput {
  total: number;
  start: number;
  /** 用户是否已主动向上扩展过窗口 */
  userExpanded: boolean;
  /** 是否切换了会话（activeSessionId 变化） */
  sessionChanged: boolean;
  /** 当前视口是否贴近底部 */
  followBottom: boolean;
  /** 首屏窗口大小 */
  initialWindow: number;
}

export interface MessageWindowPlan {
  start: number;
  userExpanded: boolean;
}

const clampTotal = (total: number): number => (Number.isFinite(total) && total > 0 ? Math.floor(total) : 0);
const tailStart = (total: number, initialWindow: number): number => Math.max(0, total - Math.max(1, initialWindow));

export function planMessageWindow(input: MessageWindowPlanInput): MessageWindowPlan {
  const total = clampTotal(input.total);
  const initialWindow = Math.max(1, Math.floor(input.initialWindow));
  const tail = tailStart(total, initialWindow);

  if (input.sessionChanged) {
    return { start: tail, userExpanded: false };
  }
  if (total === 0) {
    return { start: 0, userExpanded: false };
  }
  if (!input.userExpanded) {
    // 读者离开底部回溯：冻结起点，新消息到达只扩展尾部，不抽走顶部已挂载行。
    return { start: input.followBottom ? tail : Math.max(0, Math.min(input.start, tail)), userExpanded: false };
  }
  // 已主动扩展：起点越界（含 start === total，slice 会得到空数组）时收敛回末尾窗口。
  if (input.start >= total) {
    return { start: tail, userExpanded: false };
  }
  return { start: Math.max(0, input.start), userExpanded: true };
}

/** 向上扩展一批窗口；返回新的起点，绝不小于 0。 */
export function expandMessageWindowStart(start: number, step: number): number {
  const normalizedStart = Number.isFinite(start) && start > 0 ? Math.floor(start) : 0;
  const normalizedStep = Number.isFinite(step) && step > 0 ? Math.floor(step) : 0;
  return Math.max(0, normalizedStart - normalizedStep);
}

/**
 * 判定会话是否可能包含更早的远端服务端历史。
 *
 * 【设计意图 (Why)】
 *   将服务端更早历史存在性判定从散落的各个加载路径收敛为统一纯函数，
 *   彻底消除内存秒开恢复、持久化恢复、REST 返回与 WS 降级四处逻辑重复与边界双标。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 曾用 "返回数 >= pageSize" 判定见底：网关单页上限低于请求值时，超长会话被永久误判为已到头；
 *   2. 内存秒开时仅看 offset，忽略了 earliestRow <= 1，切回会话瞬间误弹更早历史提示；
 *   3. 将前端虚拟渲染窗口起点（messageWindowStart > 0）与远端历史混流，导致本地已缓存但首屏未挂载时误报；
 *   4. 弱网或空消息时因 rowId 缺失误报或抛错。
 *
 * 【约束与规则 (Rules)】
 *   - 唯一物理权威依据是最老一条有效 rowId 是否已达物理首行：<= 1 即见底，> 1 即仍有更早历史；
 *   - 若本次请求服务端显式返回 0 条（已到头），返回 false；
 *   - 严禁将本地虚拟窗口起点（messageWindowStart）混入此判定；
 *   - 必须为纯函数，具备可证伪测试能力。
 */
export function computeHasOlderMessages(
  messages: readonly { rowId?: number }[],
  offsetOrCount?: number,
  pageSize?: number
): boolean {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  // 若本次拉取明确返回 0 条，证明服务端已无更早历史
  if (typeof offsetOrCount === 'number' && offsetOrCount === 0) return false;
  let earliestRow: number | undefined;
  for (const m of messages) {
    if (typeof m.rowId === 'number' && Number.isInteger(m.rowId) && m.rowId > 0) {
      earliestRow = m.rowId;
      break;
    }
  }
  if (typeof earliestRow === 'number') {
    return earliestRow > 1;
  }
  // 兜底：无持久化数字 rowId 时，按是否有消息保守返回 true
  return true;
}

