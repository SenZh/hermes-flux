/**
 * 提示词导航轨的宿主侧纯逻辑（零 DOM、零 React）。
 *
 * 【设计意图 (Why)】
 *   导航轨的"当前位置"由滚动偏移反推，涉及行高兜底、padding 补偿与 clamp 三段易错算术；
 *   把它留在 `index.ts` 里只能靠肉眼审阅，放到独立模块后可以被行为级单测直接证伪。
 *   与 `messageWindow.ts` / `conversationPush.ts` 的先例同构。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 忽略 `padding-top` 会让"读到第几条"整体偏一条：会话流顶部有 24px 内边距，
 *      滚动到 0 时视口顶端并没有任何消息；
 *   2. 忽略"阅读基准线"会让刚滚到一条消息上沿时仍然归属上一条提问；
 *   3. 用 `messages.length` 当缓存 key 会漏掉等长替换（回滚、同长度刷新），
 *      轨道会对着一份已经不存在的消息表跳转。
 *
 * 【约束与规则 (Rules)】
 *   - 禁止 import DOM 类型、禁止读取全局状态；
 *   - 所有入参视为不可信，非有限数一律走兜底；
 *   - 返回结果必须落在 `[0, total - 1]` 内，绝不返回 NaN。
 */

/** 行高缺失时的兜底值，与宿主 `averageRowHeightPx` 的初始口径一致。 */
const DEFAULT_ROW_HEIGHT = 96;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export interface PromptMessageIndexInput {
  /** 滚动容器当前 scrollTop（虚拟坐标） */
  scrollTop: number;
  /** 当前会话的平均行高；小于 1 时按 96 处理 */
  rowHeight: number;
  /** 会话流 padding-top 实测值 */
  paddingTop: number;
  /** 阅读基准线：视口顶部往下多少像素算"正在读" */
  readLinePx: number;
  /** 会话消息总条数 */
  total: number;
}

/**
 * 把滚动偏移换算成"当前读到第几条消息"。
 *
 * 【设计意图 (Why)】
 *   虚拟化与非虚拟化两种模式必须共用同一个公式：非虚拟化时窗口起点恒为 0，
 *   滚动偏移直接就是内容偏移；虚拟化时 scrollTop 已经是全量虚拟坐标。
 *
 * 【防范的历史坑 (Pitfall)】
 *   早期版本对虚拟化分支额外减了一次 `windowStart * rowHeight`，结果双倍补偿，
 *   7745 条会话里滚动到中部却报告"还在第 3 条"。
 *
 * 【约束与规则 (Rules)】
 *   1. 公式 `floor(max(0, scrollTop - paddingTop + readLinePx) / rowHeight)`；
 *   2. 结果 clamp 到 `[0, total - 1]`；`total <= 0` 返回 0；
 *   3. `rowHeight` 非有限或小于 1 时按 96 处理；其余非有限入参按 0 处理。
 */
export function promptMessageIndexAtScrollTop(input: PromptMessageIndexInput): number {
  const total = isFiniteNumber(input.total) && input.total > 0 ? Math.floor(input.total) : 0;
  if (total === 0) return 0;
  const rowHeight = isFiniteNumber(input.rowHeight) && input.rowHeight >= 1
    ? input.rowHeight
    : DEFAULT_ROW_HEIGHT;
  const scrollTop = isFiniteNumber(input.scrollTop) ? input.scrollTop : 0;
  const paddingTop = isFiniteNumber(input.paddingTop) ? input.paddingTop : 0;
  const readLinePx = isFiniteNumber(input.readLinePx) ? input.readLinePx : 0;
  const offset = Math.max(0, scrollTop - paddingTop + readLinePx);
  const index = Math.floor(offset / rowHeight);
  if (index < 0) return 0;
  if (index > total - 1) return total - 1;
  return index;
}

/**
 * 从同一条消息的多个节点矩形里取最靠上的可见 top。
 *
 * 【设计意图 (Why)】
 *   一条消息会渲染出多个 `data-msg-id` 节点（行本体与页脚操作栏），
 *   页脚永远在行本体下方；跳转必须对到行本体，否则每跳一次就向下漂移一行页脚的高度。
 *
 * 【防范的历史坑 (Pitfall)】
 *   取"第一个节点"依赖 DOM 顺序，React 重排后顺序会变；取"最小 top"才与顺序无关。
 *
 * 【约束与规则 (Rules)】
 *   1. 只接受有限 top；无有效矩形时返回 null；
 *   2. 不修改入参数组。
 */
export function topmostRectTop(
  rects: readonly { top: number; height: number }[]
): number | null {
  if (!Array.isArray(rects) || rects.length === 0) return null;
  let top: number | null = null;
  for (const rect of rects) {
    if (!rect || !isFiniteNumber(rect.top)) continue;
    // 隐藏节点的 rect 全为 0；若不过滤，跳转会把 scrollTop 校正到视口顶部。
    if (!isFiniteNumber(rect.height) || rect.height <= 0) continue;
    if (top === null || rect.top < top) top = rect.top;
  }
  return top;
}

export interface PromptIndexRebuildInput {
  /** 上次建表时所属的会话 id */
  sessionId: string;
  /** 当前激活会话 id */
  currentSessionId: string;
  /** 上次建表时缓存的消息数组引用；从未建过表时为 null */
  cachedMessagesRef: readonly unknown[] | null;
  /** 本次 render 用的消息数组引用 */
  messagesRef: readonly unknown[];
}

/**
 * 判定提示词条目是否需要整表重建。
 *
 * 【设计意图 (Why)】
 *   缓存 key 用「会话 id + 消息数组引用」。数组引用是 O(1) 比较，且能捕获等长替换；
 *   长度 + 末条 id 的组合会漏掉"同长度回滚"这类真实场景。
 *
 * 【防范的历史坑 (Pitfall)】
 *   曾用 `messages.length` 做 key：回滚把数组换成等长新数组时命中缓存，
 *   轨道仍指向已被裁掉的消息 id，点击后 `findIndex` 返回 -1，表现为"点了没反应"。
 *
 * 【约束与规则 (Rules)】
 *   1. 会话变化必重建；
 *   2. 从未建表（缓存为 null）必重建；
 *   3. 数组引用变化必重建；引用相同时恒返回 false（流式 token 原地改写内容不重建）。
 */
export function shouldRebuildPromptIndex(input: PromptIndexRebuildInput): boolean {
  if (input.currentSessionId !== input.sessionId) return true;
  if (input.cachedMessagesRef === null) return true;
  return input.cachedMessagesRef !== input.messagesRef;
}

/**
 * 头部前置插入历史后平移挂载窗口起点，使当前视口内消息继续留在窗口中。
 *
 * 【设计意图 (Why)】
 *   用户通过提示词导航器触发历史拉取时，正文视口可能停在中部或尾部，而非顶部；
 *   若沿用滚到顶翻页的「重置到 0」策略，会把当前正读消息瞬间踢出挂载窗口。
 *   按新增条数 `added` 同幅后移 `previousStart`，即可保证原本挂载的消息 100% 留在新窗口内，
 *   配合元素锚点补偿实现正文视口零跳动。
 *
 * 【约束与规则 (Rules)】
 *   1. 非有限数一律兜底为 0 / 1；
 *   2. 结果严格夹在 `[0, max(0, total - capacity)]` 之内。
 */
export function shiftWindowStartForPrepend(
  previousStart: number,
  added: number,
  total: number,
  capacity: number
): number {
  const safeTotal = isFiniteNumber(total) && total > 0 ? Math.floor(total) : 0;
  const safeCap = isFiniteNumber(capacity) && capacity > 0 ? Math.floor(capacity) : 1;
  const maxStart = Math.max(0, safeTotal - safeCap);
  const base = isFiniteNumber(previousStart) && previousStart > 0 ? Math.floor(previousStart) : 0;
  const delta = isFiniteNumber(added) && added > 0 ? Math.floor(added) : 0;
  const shifted = base + delta;
  if (shifted <= 0) return 0;
  if (shifted >= maxStart) return maxStart;
  return shifted;
}

export interface HostPromptNavigatorMetaInput {
  locale: string;
  hasOlderMessages: boolean;
  isLoadingOlder: boolean;
  isGroupRoom: boolean;
}

export interface HostPromptNavigatorSnapshotLike<TEntry = unknown> {
  prompts: readonly TEntry[];
  activeIndex: number;
  locale?: string;
  hasOlder?: boolean;
  isLoadingOlder?: boolean;
}

/**
 * 统一构造宿主侧提示词导航器快照：群聊研讨室严格隔离，绝不暴露单会话翻页入口。
 */
export function buildHostPromptNavigatorSnapshot<TEntry>(
  prompts: readonly TEntry[],
  activeIndex: number,
  meta: HostPromptNavigatorMetaInput
): HostPromptNavigatorSnapshotLike<TEntry> {
  return {
    prompts,
    activeIndex,
    locale: meta.locale,
    hasOlder: Boolean(meta.hasOlderMessages && !meta.isGroupRoom),
    isLoadingOlder: Boolean(meta.isLoadingOlder),
  };
}

/**
 * 判断导航器元信息是否与当前宿主状态一致；一致时跳过快照引用切换，避免无意义重绘。
 */
export function isHostPromptNavigatorMetaSame(
  snapshot: HostPromptNavigatorSnapshotLike | null,
  meta: HostPromptNavigatorMetaInput
): boolean {
  if (!snapshot) return false;
  const expectedHasOlder = Boolean(meta.hasOlderMessages && !meta.isGroupRoom);
  return (
    Boolean(snapshot.hasOlder) === expectedHasOlder &&
    Boolean(snapshot.isLoadingOlder) === Boolean(meta.isLoadingOlder) &&
    snapshot.locale === meta.locale
  );
}
