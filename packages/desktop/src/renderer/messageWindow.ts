/**
 * 消息挂载窗口纯逻辑。
 *
 * 【设计意图 (Why)】
 *   窗口决定“DOM 里同时挂多少条消息”。长会话（实测 7745 条）向上回溯时，
 *   若窗口只扩不缩，挂载量随回溯轮次单调增长，每帧样式重算与布局成本线性上升，
 *   边栏拖拽这类改宽度的操作会从 16ms 恶化到 60ms 以上。窗口必须是有界滑动区间。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 旧实现窗口是 `[start, total)` 开放区间，`expandMessageWindowStart` 单向递减，
 *      回溯 28 轮后 scrollHeight 从 2245px 涨到 198268px，滑回底部也不释放；
 *   2. 收缩分支要求 `userExpanded === false`，而回溯一旦把它置真就再不回假，
 *      滑回底部永远进不去收缩路径，挂载量永不回收；
 *   3. 用“返回数 >= pageSize”判定见底，网关单页上限低于请求值时超长会话被误判到头。
 *
 * 【约束与规则 (Rules)】
 *   - 0 <= start <= end <= total（total 为 0 时 start 与 end 必须同为 0）；
 *   - end - start <= capacity，容量是硬上限，任何状态迁移都不得突破；
 *   - 切会话必须回到末尾窗口，绝不继承上一会话的阅读位置；
 *   - 贴底且窗口已覆盖末尾时回到尾部窗口，保证流式锚点永远有最后一条消息；
 *   - 回滚/截断把总长压到窗口内时必须收敛回末尾窗口。
 */

export interface MessageWindowPlanInput {
  total: number;
  start: number;
  /** 上次的窗口末端（不含），仅用于诊断与单调性校验 */
  end?: number;
  /** 用户是否已主动向上扩展过窗口 */
  userExpanded: boolean;
  /** 是否切换了会话（activeSessionId 变化） */
  sessionChanged: boolean;
  /** 当前视口是否贴近底部 */
  followBottom: boolean;
  /** 首屏窗口大小 */
  initialWindow: number;
  /** 挂载容量硬上限 */
  capacity: number;
}

export interface MessageWindowPlan {
  start: number;
  /** 窗口末端（不含），切片语义为 slice(start, end) */
  end: number;
  userExpanded: boolean;
}

/** 默认挂载容量：约 3 屏（120 条），平衡回溯手感与每帧重排成本。 */
export const DEFAULT_WINDOW_CAPACITY = 120;

const clampTotal = (total: number): number => (Number.isFinite(total) && total > 0 ? Math.floor(total) : 0);

const normalizeCapacity = (capacity: number, initialWindow: number): number => {
  const cap = Number.isFinite(capacity) && capacity > 0 ? Math.floor(capacity) : DEFAULT_WINDOW_CAPACITY;
  const floor = Number.isFinite(initialWindow) && initialWindow > 0 ? Math.floor(initialWindow) : 1;
  return Math.max(floor, cap);
};

const clampStart = (start: number, maxStart: number): number => {
  const s = Number.isFinite(start) && start > 0 ? Math.floor(start) : 0;
  return Math.max(0, Math.min(s, maxStart));
};

/** 尾部窗口起点：末尾 capacity 条的首索引。 */
const tailStart = (total: number, capacity: number): number => Math.max(0, total - capacity);

/**
 * 由起点推导窗口末端。这是 end 的唯一推导入口，禁止在别处另算一份。
 */
export function windowEndFor(start: number, total: number, capacity: number, initialWindow = 1): number {
  const t = clampTotal(total);
  const cap = normalizeCapacity(capacity, initialWindow);
  const s = clampStart(start, Math.max(0, t - 1));
  return Math.min(t, s + cap);
}

/**
 * 规划窗口区间。
 *
 * 【规则】切会话与贴底一律回到尾部窗口；其余情况保持起点并强制容量上限，
 *   超过容量时以起点为准截断末端（读者正在看的位置绝不因容量而被抽走）。
 */
export function planMessageWindow(input: MessageWindowPlanInput): MessageWindowPlan {
  const total = clampTotal(input.total);
  const capacity = normalizeCapacity(input.capacity, input.initialWindow);
  const maxStart = Math.max(0, total - capacity);
  const tail = tailStart(total, capacity);

  if (total === 0) {
    return { start: 0, end: 0, userExpanded: false };
  }
  if (input.sessionChanged) {
    return { start: tail, end: total, userExpanded: false };
  }
  // 贴底时窗口必须覆盖末尾，否则流式直写锚点找不到最后一条消息。
  if (input.followBottom && !input.userExpanded) {
    return { start: tail, end: total, userExpanded: false };
  }
  const start = clampStart(input.start, maxStart);
  const end = Math.min(total, start + capacity);
  return { start, end, userExpanded: input.userExpanded };
}

/** 向上扩展一屏；返回新的起点，绝不小于 0，也不越过容量允许的最大起点。 */
export function expandMessageWindowStart(start: number, step: number, total = Number.MAX_SAFE_INTEGER): number {
  const normalizedStart = Number.isFinite(start) && start > 0 ? Math.floor(start) : 0;
  const normalizedStep = Number.isFinite(step) && step > 0 ? Math.floor(step) : 0;
  const floor = Math.max(0, Math.min(normalizedStart - normalizedStep, total));
  return Math.max(0, floor);
}

/**
 * 向下滑动窗口：用户从历史里往回滚到挂载区间末端时，把窗口整体前移。
 *
 * 【规则】起点单调不减，且不超过 total - capacity，保证容量上限全程成立。
 */
export function slideMessageWindowDown(
  start: number,
  total: number,
  capacity: number,
  step: number,
  initialWindow = 1
): number {
  const t = clampTotal(total);
  const cap = normalizeCapacity(capacity, initialWindow);
  const maxStart = Math.max(0, t - cap);
  const normalizedStep = Number.isFinite(step) && step > 0 ? Math.floor(step) : 0;
  const s = clampStart(start, maxStart);
  return Math.min(maxStart, s + normalizedStep);
}

/** 把窗口落在某个消息索引周围，前留 leadRows 行上文；索引越界时退化为尾部窗口。 */
export function windowStartAroundIndex(
  index: number,
  total: number,
  capacity: number,
  leadRows: number,
  initialWindow = 1
): number {
  const t = clampTotal(total);
  const cap = normalizeCapacity(capacity, initialWindow);
  const maxStart = Math.max(0, t - cap);
  const idx = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
  const lead = Number.isFinite(leadRows) && leadRows > 0 ? Math.floor(leadRows) : 0;
  return clampStart(idx - lead, maxStart);
}

/**
 * 窗口是否允许把起点向前搬（读者向上回溯）。
 *
 * 【设计意图 (Why)】
 *   冷启动先渲染缓存会话时 `scrollTop` 初值为 0，视口天然"落在窗口上沿之上"，
 *   在 scroll 事件里与"读者正在向上翻"完全同形。若不加授权，
 *   首屏会连续扩窗并把窗口搬离末尾（实测 1128 条会话从 [1008,1128] 落到 [907,1027]），
 *   读者看到的不是最新消息。
 *
 * 【防范的历史坑 (Pitfall)】
 *   曾用 `scrollTop === 0` 判断"刚打开"：读者自己滚到顶同样是 0，会把真实回溯也挡住。
 *   现改为由读者手势产生的反向滚动记录来授权，与视口位置解耦。
 *
 * 【约束与规则 (Rules)】
 *   - 只有同一会话内记录过读者反向滚动，才允许扩窗；
 *   - 总数不超过容量时不存在"更早的未挂载内容"，一律不扩窗。
 */
export function shouldExpandWindow(input: {
  sessionId: string;
  readerScrolledSessionId: string;
  total: number;
  capacity: number;
}): boolean {
  if (!input.sessionId) return false;
  if (clampTotal(input.total) <= normalizeCapacity(input.capacity, 1)) return false;
  return input.readerScrolledSessionId === input.sessionId;
}

/**
 * 首屏是否还需要落定（把视口贴到最新消息）。
 *
 * 【设计意图 (Why)】
 *   缓存恢复、分页补齐与行高锁定都是分批到达的：条数变了、平均行高变了、
 *   或者视口已脱离一屏以上，都说明视口还停在旧口径上，必须重新落定。
 *
 * 【约束与规则 (Rules)】
 *   - 读者主动回溯过的会话永不自动落定，绝不把正在回看的人拽回底部；
 *   - 窗口必须覆盖末尾才有"最新消息"可贴。
 */
export function shouldSettleInitialBottom(input: {
  sessionId: string;
  readerScrolledSessionId: string;
  atTail: boolean;
  settledSignature: string;
  currentSignature: string;
  drifted: boolean;
}): boolean {
  if (!input.sessionId) return false;
  if (input.readerScrolledSessionId === input.sessionId) return false;
  if (!input.atTail) return false;
  return input.settledSignature !== input.currentSignature || input.drifted;
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
