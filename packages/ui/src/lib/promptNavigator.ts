/**
 * 提示词导航轨纯逻辑模型（零 DOM、零 React，可直接单测）。
 *
 * 【设计意图 (Why)】
 *   7745 条消息的长会话里，滚动条是唯一的纵向定位手段，用户无法表达"我想回到第 2000 次提问"。
 *   导航轨把「每一次用户输入」折叠成一根横杠，位置换算、窗口裁剪与视觉宽度全部收敛成可证伪的纯函数，
 *   组件只负责把结果画出来，宿主只负责喂当前消息下标。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 若把窗口裁剪写在组件里，每次改容量都要回到 React 层验证，无法在单测里复现越界；
 *   2. 若用 `prompts.findIndex` 线性扫当前位置，每次滚动都是 O(n)（3870 次提问即 3870 次比较）；
 *   3. 若允许空 id 进入条目，`[data-msg-id=""]` 会一次命中所有空 id 节点，跳转落到第一条。
 *
 * 【约束与规则 (Rules)】
 *   - 本文件禁止 import 任何 DOM / React / 平台模块；
 *   - 所有函数必须无副作用，相同入参恒返回相同结果；
 *   - `buildPromptEntries` 保证输出按 index 严格升序，其余函数可依赖这一前置条件。
 */

/** 预览正文的最大字符数；末尾省略号不计入该上限。 */
export const PROMPT_PREVIEW_MAX_CHARS = 160;

/** 轨道同时渲染的 tick 上限（DOM 节点硬上限）。 */
export const RAIL_VISIBLE_TICKS = 30;

/** tick 纵向间距（px）；与 CSS `--conv-rail-pitch` 同源，禁止单边改动。 */
export const RAIL_TICK_PITCH_PX = 12;

/** 预览截断后补的省略号；与正文上限分开计数。 */
const ELLIPSIS = '…';

/** 宽度衰减表：距离 0~3 的系数，距离 >= 4 归零。 */
const TICK_WIDTH_DECAY = [1, 0.6, 0.35, 0.15] as const;

/** 一根横杠对应的最小单元。 */
export interface PromptEntry {
  /** 用户消息 id，同时作为 tick 的业务标识 */
  id: string;
  /** 该消息在 state.messages 中的下标，只用于渲染与位置换算 */
  index: number;
  /** 压成单行的预览，最长 160 字符（省略号不计） */
  preview: string;
}

/** 触发顶部历史拉取的最小节流间隔（ms），抑制惯性滚轮连发。 */
export const TOP_LOAD_COOLDOWN_MS = 250;

/** 头部前置插入新历史后，在顶部上下文中保留的新增行数。 */
const PREPEND_CONTEXT_ROWS = 2;

export interface PromptNavigatorSnapshot {
  prompts: readonly PromptEntry[];
  /** 指向 prompts 的下标，-1 表示尚未定位 */
  activeIndex: number;
  locale?: string;
  /** 是否仍存在更早历史（本地持久化缓存或远端） */
  hasOlder?: boolean;
  /** 当前是否正在查询更早历史 */
  isLoadingOlder?: boolean;
}

export interface PromptNavigatorActions {
  /** 传消息 id，不传易失下标 */
  onSelect: (messageId: string) => void;
  /** 导航器滑动到顶部边界后，通知宿主查询更早历史 */
  onLoadOlder?: () => void;
}

/** 有限数判定，非有限一律走兜底。 */
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** 夹取到 [min, max]；min 大于 max 时返回 min。 */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * 把任意消息正文压成单行预览。
 *
 * 【设计意图 (Why)】
 *   面板与 aria-label 都需要一行可读摘要；原文里的换行、制表符与连续空格会把行高撑爆，
 *   或者让 aria-label 变成一串无法朗读的空白。
 *
 * 【防范的历史坑 (Pitfall)】
 *   旧实现只做 `slice(0, 160)`，多行正文的第一行往往不足 20 字，预览几乎全空。
 *
 * 【约束与规则 (Rules)】
 *   1. 所有空白（含换行、制表符、全角空格）压成单个半角空格；
 *   2. 去首尾空白；空内容返回空串，绝不返回 `undefined`；
 *   3. 超过 160 字符截断并补省略号，省略号不计入 160。
 */
export function normalizePromptPreview(content: string): string {
  if (typeof content !== 'string' || content.length === 0) return '';
  const flat = content.replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return '';
  if (flat.length <= PROMPT_PREVIEW_MAX_CHARS) return flat;
  return `${flat.slice(0, PROMPT_PREVIEW_MAX_CHARS)}${ELLIPSIS}`;
}

/**
 * 从全量消息里抽取每一次用户提问。
 *
 * 【设计意图 (Why)】
 *   导航轨的粒度是「用户输入」，不是消息条数：一次提问后可能跟着十几条助手/工具行，
 *   把它们都画成横杠会让轨道失去分辨率。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 允许空 id 进表时，跳转选择器 `[data-msg-id=""]` 会命中整屏空 id 节点；
 *   2. 曾按内容去重，用户连续两次发送同一句话就少一根横杠，与"按位置导航"的语义冲突。
 *
 * 【约束与规则 (Rules)】
 *   1. 只保留 `role === 'user'`；
 *   2. id 非字符串或空白一律剔除，不做补造；
 *   3. 按入参顺序编号，不排序、不去重；输出天然按 index 严格升序；
 *   4. `displayKind` 非 'user' 的行（换模型提示、后台回执、steer 包装）不是人类提问，
 *      不得占一根横杠，否则导航轨数量与会话真实提问数不符。
 */
export function buildPromptEntries(
  messages: readonly { id: string; role: string; content: string; displayKind?: string }[]
): PromptEntry[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const entries: PromptEntry[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (!message || message.role !== 'user') continue;
    if (message.displayKind !== undefined && message.displayKind !== 'user') continue;
    const id = message.id;
    if (typeof id !== 'string' || id.trim().length === 0) continue;
    entries.push({ id, index: i, preview: normalizePromptPreview(message.content) });
  }
  return entries;
}

/**
 * 给定当前消息下标，反查它归属哪一次提问。
 *
 * 【设计意图 (Why)】
 *   视口顶部读到的往往是一条助手消息，导航轨要把它归到"引发它的那次提问"，
 *   所以取「最后一个 index <= messageIndex 的提问」，而不是最近一条。
 *
 * 【防范的历史坑 (Pitfall)】
 *   线性扫描在每次滚动时对 3870 条做比较；滚动一次 60 帧就接近 23 万次比较。
 *
 * 【约束与规则 (Rules)】
 *   1. 二分查找，O(log n)；
 *   2. `messageIndex` 非有限数按 0 处理；小于首条返回 0；大于末条返回最后一条；
 *   3. 空数组返回 -1。
 */
export function resolveActivePromptIndex(
  prompts: readonly PromptEntry[],
  messageIndex: number
): number {
  const total = prompts.length;
  if (total === 0) return -1;
  const target = isFiniteNumber(messageIndex) ? messageIndex : 0;
  if (target < prompts[0].index) return 0;
  let low = 0;
  let high = total - 1;
  let answer = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (prompts[mid].index <= target) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return answer;
}

/**
 * 规划 tick 窗口：只渲染有限根横杠，把当前项尽量居中。
 *
 * 【设计意图 (Why)】
 *   3870 次提问不可能全部挂 DOM；30 根横杠是视觉密度与节点数的平衡点。
 *   窗口外的提问由「边缘轮播 + 面板全量列表」两条通路覆盖。
 *
 * 【防范的历史坑 (Pitfall)】
 *   早期实现用 `start = activeIndex - capacity / 2` 直接切片，在首尾会产生负起点与越界末端，
 *   渲染时出现空白槽位与重复 key。
 *
 * 【约束与规则 (Rules)】
 *   1. `capacity` 非正数或非有限时取 `RAIL_VISIBLE_TICKS`；
 *   2. `total === 0` 返回全零窗口，两个 hasMore 均为 false；
 *   3. `activeIndex < 0` 或越界一律按 `total - 1` 处理；
 *   4. `total <= capacity` 时窗口覆盖全部；
 *   5. 否则 `start` 夹在 `0` 与 `total - capacity` 之间，让当前项尽量居中；
 *   6. `end - start <= capacity` 恒成立。
 */
export function planTickWindow(
  total: number,
  activeIndex: number,
  capacity: number = RAIL_VISIBLE_TICKS
): { start: number; end: number; hasMoreAbove: boolean; hasMoreBelow: boolean } {
  const count = isFiniteNumber(total) && total > 0 ? Math.floor(total) : 0;
  if (count === 0) {
    return { start: 0, end: 0, hasMoreAbove: false, hasMoreBelow: false };
  }
  const cap = isFiniteNumber(capacity) && capacity > 0
    ? Math.max(1, Math.floor(capacity))
    : RAIL_VISIBLE_TICKS;
  const index = isFiniteNumber(activeIndex) && activeIndex >= 0 && activeIndex < count
    ? Math.floor(activeIndex)
    : count - 1;
  if (count <= cap) {
    return { start: 0, end: count, hasMoreAbove: false, hasMoreBelow: false };
  }
  const offset = Math.floor((cap - 1) / 2);
  const maxStart = count - cap;
  const start = clamp(index - offset, 0, maxStart);
  const end = start + cap;
  return { start, end, hasMoreAbove: start > 0, hasMoreBelow: end < count };
}

/**
 * 面板可见行数与行高。
 *
 * 【设计意图 (Why)】
 *   面板高度 = 行高 × 可见行数，滚轮步进与 translateY 都按行高计算。
 *   这三个数值此前散落在组件 TS 常量、CSS 变量与文档三处，改任一处都会让滑行错位。
 *   统一收敛到纯模型导出，组件与 CSS 侧守卫用例都从这里取真值。
 *
 * 【约束与规则 (Rules)】
 *   1. 行高必须是 8pt 网格整数倍，落在 4px 网格上（40 = 8 × 5）；
 *   2. `PANEL_ROW_PX` 与 CSS `--conv-prompt-panel-row` 必须严格相等；
 *   3. `PANEL_VISIBLE_ROWS` 与 CSS `--conv-prompt-panel-visible` 必须严格相等。
 */
export const PANEL_VISIBLE_ROWS = 8;
export const PANEL_ROW_PX = 40;
/** 面板滚动时额外挂载的上下文行数，避免滑行瞬间露出空白。 */
export const PANEL_OVERSCAN_ROWS = 2;

/** 面板一行的渲染数据；只有预览正文，不含任何序号或行号字段。 */
export interface PromptPanelRow {
  id: string;
  /** 该行在 prompts 中的绝对下标，用于高亮判定与点击 */
  index: number;
  /** 纵向位置（px），等于绝对下标 × 行高 */
  top: number;
  /** 压成单行的预览正文，是这一行唯一的可见内容 */
  text: string;
  isActive: boolean;
  isHighlighted: boolean;
}

/**
 * 面板滚动偏移：高亮行保留上下 2 行上下文，只有贴近边缘才滑动。
 *
 * 【防范的历史坑 (Pitfall)】面板若跟随高亮逐行滚动，读者永远只能看到当前行与下方 7 行，
 *   无法形成"上下文感"；只有贴边才滑动才与参考实现一致。
 *
 * 【约束与规则 (Rules)】
 *   1. 结果恒夹在 `[0, total - PANEL_VISIBLE_ROWS]`；
 *   2. `total <= PANEL_VISIBLE_ROWS` 时恒为 0。
 */
export function ensurePanelOffset(target: number, offset: number, total: number): number {
  const maxOffset = Math.max(0, total - PANEL_VISIBLE_ROWS);
  const base = clamp(offset, 0, maxOffset);
  if (target - base < 2) return clamp(target - 2, 0, maxOffset);
  if (target - base > PANEL_VISIBLE_ROWS - 3) {
    return clamp(target - PANEL_VISIBLE_ROWS + 3, 0, maxOffset);
  }
  return base;
}

/**
 * 规划面板行：只产出可见行 ± overscan，且每行只带预览正文。
 *
 * 【设计意图 (Why)】
 *   3870 次提问不能全部进 DOM；同时面板行曾是「序号 + 正文」两段结构，
 *   序号在长列表里既无导航价值又挤掉 46px 正文宽度，本轮收敛为单段预览。
 *   把行的数据形状收敛成纯函数，是为了让「行里只有预览」这个决策可被单测证伪，
 *   而不是靠读产物字符串里的类名。
 *
 * 【防范的历史坑 (Pitfall)】
 *   曾为「可见行数 / overscan」开了可选入参，但没有任何调用方使用，
 *   等于给两个永不执行的分支写了归一逻辑；行数只该由模块常量决定。
 *
 * 【约束与规则 (Rules)】
 *   1. 起点夹在 `[0, total - 1]`，终点不超过 `total`；
 *   2. 挂载行数上限恒为 `PANEL_VISIBLE_ROWS + PANEL_OVERSCAN_ROWS`，不接受外部覆盖；
 *   3. 每行 `top` 由绝对下标 × 行高决定；面板整体的纵向位移由 `panel-track` 的
 *      `translateY(-offset × 行高)` 反向抵消，两者不在这里合并；
 *   4. `text` 与 `id` 必须非空；空 id 条目视为数据缺陷直接跳过，不补造；
 *   5. 小数 `offset` 向下取整，保证起点落在真实行上而不是行间。
 */
export function planPanelRows(
  prompts: readonly PromptEntry[],
  options: {
    offset: number;
    activeIndex: number;
    highlightedIndex: number | null;
    previewOf: (entry: PromptEntry) => string;
  }
): PromptPanelRow[] {
  const total = prompts.length;
  if (total === 0) return [];
  const start = clamp(Math.floor(options.offset), 0, Math.max(0, total - 1));
  // `Math.min` 与下文的 `!entry` 守卫语义等价（越界读只会得到 undefined 并被跳过）；
  // 保留它是为了让循环边界显式可读，而不是依赖「数组越界返回 undefined」这条隐式事实。
  const end = Math.min(total, start + PANEL_VISIBLE_ROWS + PANEL_OVERSCAN_ROWS);
  const highlighted = options.highlightedIndex;
  const rows: PromptPanelRow[] = [];
  for (let i = start; i < end; i += 1) {
    const entry = prompts[i];
    if (!entry || typeof entry.id !== 'string' || entry.id.length === 0) continue;
    rows.push({
      id: entry.id,
      index: i,
      top: i * PANEL_ROW_PX,
      text: options.previewOf(entry),
      isActive: i === options.activeIndex,
      isHighlighted: i === highlighted,
    });
  }
  return rows;
}

/**
 * 一行的渲染属性包：把行数据映射成 DOM 属性。
 *
 * 【设计意图 (Why)】
 *   面板只在 hover 时挂载，服务端静态渲染进不到该分支，渲染层契约此前零覆盖。
 *   把「行 → 属性」收敛成纯函数后，「不含序号、点击传 id、不进 Tab 序列、几何按行高算」
 *   这组契约可以被单测直接证伪，而不是靠读产物字符串里的类名。
 *
 * 【防范的历史坑 (Pitfall)】
 *   序号曾在渲染层以独立 span 回流，纯模型侧断言拦不住：模型产出不含序号，渲染时另加。
 *
 * 【约束与规则 (Rules)】
 *   1. `className` 只能由 `isActive` / `isHighlighted` 两个判别位算出；
 *   2. `selectId` 只携带消息 id，绝不携带易失下标（前置翻页会让下标整体平移）；
 *   3. 行不进 Tab 序列（`tabIndex = -1`），键盘通路统一走 gutter 的 listbox；
 *   4. `top` 必须由 `PANEL_ROW_PX` 推算，禁止出现第二份行高真值；
 *   5. 本函数的返回对象是行内按钮的**全部**可变量，组件不得在其外另加子节点。
 */
export function buildPanelRowProps(row: PromptPanelRow): PanelRowProps {
  return {
    className: `conv-prompt-rail__panel-row${row.isActive ? ' is-active' : ''}${row.isHighlighted ? ' is-highlighted' : ''}`,
    top: `${row.index * PANEL_ROW_PX}px`,
    tabIndex: -1,
    ariaCurrent: row.isActive ? 'true' : undefined,
    text: row.text,
    selectId: row.id,
  };
}

/** 面板行的 DOM 属性包；字段集是渲染层的完整可变面。 */
export interface PanelRowProps {
  className: string;
  /** 纵向位置，等于绝对下标 × 行高 */
  top: string;
  /** 恒为 -1：行不进 Tab 序列 */
  tabIndex: number;
  ariaCurrent: 'true' | undefined;
  /** 这一行唯一的可见内容 */
  text: string;
  /** 点击时回调的消息 id */
  selectId: string;
}

/**
 * 计算一根横杠的视觉宽度。
 *
 * 【设计意图 (Why)】
 *   单纯等宽会让轨道变成一根没有焦点的刻度尺；用邻近放大把鼠标所在轮次做成视觉焦点。
 *   没有悬停时全部保持基准宽，读者一眼就能看到完整轨道，而不是半截消失的刻度。
 *
 * 【防范的历史坑 (Pitfall)】
 *   曾把「邻近放大增量」当成「总宽度衰减」：`width = base * factor`，距离 4 直接归零。
 *   结果 30 根 tick 里只有焦点一侧的十几根可见，另一侧全是 0 宽，用户以为轨道没渲染。
 *
 * 【约束与规则 (Rules)】
 *   1. 基准 10px，当前项 14px，悬停中心 20px；
 *   2. 只放大，不缩小：`width = base + (20 - base) * factor`；
 *   3. 距离衰减 `[1, 0.6, 0.35, 0.15]`，距离 4 及以上增量归零但保留基准宽；
 *   4. `hasHighlight` 为假时不做邻近放大，所有 tick 保持基准宽。
 */
export function tickWidth(
  distance: number,
  isActive: boolean,
  isHighlighted: boolean,
  hasHighlight = false
): number {
  const base = isActive ? 14 : 10;
  if (!hasHighlight) return base;
  const step = isFiniteNumber(distance) && distance > 0 ? Math.floor(distance) : 0;
  const factor = step >= TICK_WIDTH_DECAY.length ? 0 : TICK_WIDTH_DECAY[step];
  return Math.round((base + (20 - base) * factor) * 100) / 100;
}

export interface TopBoundaryLoadCheckInput {
  /** 是否仍存在更早历史 */
  hasOlder: boolean;
  /** 是否已在加载中 */
  isLoadingOlder: boolean;
  /** 宿主是否提供拉取回调 */
  hasHandler: boolean;
  /** 当前是否位于顶部边界 */
  atTop: boolean;
  /** 当前意图是否向更早方向越顶 */
  movingUpward: boolean;
  /** 距上次触发的经过毫秒数；缺失视为已过冷却 */
  elapsedSinceLastTriggerMs?: number;
  /** 冷却阈值（ms），默认 TOP_LOAD_COOLDOWN_MS */
  cooldownMs?: number;
}

/**
 * 判定提示词导航器到达最顶部时是否应当自动触发拉取更早历史。
 *
 * 【设计意图 (Why)】
 *   把触顶拉取的前置守卫与节流逻辑收敛到纯函数，防止滚轮惯性事件连发或
 *   在 hasOlder=false / isLoadingOlder=true 时向宿主发出无效或并发请求。
 *
 * 【约束与规则 (Rules)】
 *   1. hasOlder / hasHandler 任一为假，或 isLoadingOlder 为真，恒返回 false；
 *   2. 必须同时满足处于顶部（atTop）且向更早方向移动（movingUpward）；
 *   3. 冷却期未满（0 <= elapsed < cooldown）拦截连发；非有限/负数间隔不触发误放行。
 */
export function shouldTriggerLoadOlderAtTop(input: TopBoundaryLoadCheckInput): boolean {
  if (!input.hasOlder || input.isLoadingOlder || !input.hasHandler) return false;
  if (!input.atTop || !input.movingUpward) return false;
  const cooldown = isFiniteNumber(input.cooldownMs) && input.cooldownMs >= 0
    ? input.cooldownMs
    : TOP_LOAD_COOLDOWN_MS;
  if (input.elapsedSinceLastTriggerMs !== undefined) {
    if (!isFiniteNumber(input.elapsedSinceLastTriggerMs) || input.elapsedSinceLastTriggerMs < 0) {
      return false;
    }
    if (input.elapsedSinceLastTriggerMs < cooldown) return false;
  }
  return true;
}

export interface PromptPrependViewInput {
  /** 插入前条目数 */
  previousTotal: number;
  /** 插入后条目数 */
  nextTotal: number;
  /** 轨道窗口容量 */
  capacity: number;
  /** 插入前轨道起点 */
  windowStart: number;
  /** 插入前高亮下标 */
  highlightedIndex: number | null;
  /** 插入前面板偏移 */
  panelOffset: number;
  /** 面板当前是否处于展开态 */
  panelOpen: boolean;
}

export interface PromptPrependViewResult {
  windowStart: number;
  highlightedIndex: number | null;
  panelOffset: number;
}

/**
 * 计算头部前置插入更早提问后的轨道窗口、高亮与面板偏移。
 *
 * 【设计意图 (Why)】
 *   用户在面板顶部触发拉取后，新历史插在数组头部，全部旧条目下标右移 delta：
 *   若只平移 windowStart / highlightedIndex 而忽略 panelOffset，面板会瞬间失去锚点；
 *   而若在 panelOffset=0 时盲目加满 delta，新拉到的历史又全部被藏到视口上方。
 *   在顶部触发时保留少量新历史上下文（2 行），让用户无缝沿着时间线继续上滑。
 *
 * 【约束与规则 (Rules)】
 *   1. delta <= 0 时仅对各值做安全夹取；
 *   2. panelOpen && panelOffset === 0 时，panelOffset 与 windowStart 回留至多 PREPEND_CONTEXT_ROWS 行新历史；
 *   3. 其余场景全额补偿 delta，保持当前阅读锚点静止。
 */
export function planPromptPrependView(input: PromptPrependViewInput): PromptPrependViewResult {
  const nextTotal = isFiniteNumber(input.nextTotal) && input.nextTotal > 0 ? Math.floor(input.nextTotal) : 0;
  const previousTotal = isFiniteNumber(input.previousTotal) && input.previousTotal > 0 ? Math.floor(input.previousTotal) : 0;
  const cap = isFiniteNumber(input.capacity) && input.capacity > 0 ? Math.max(1, Math.floor(input.capacity)) : RAIL_VISIBLE_TICKS;
  if (nextTotal === 0) {
    return { windowStart: 0, highlightedIndex: null, panelOffset: 0 };
  }

  const maxWindowStart = Math.max(0, nextTotal - cap);
  const maxPanelOffset = Math.max(0, nextTotal - PANEL_VISIBLE_ROWS);
  const baseWindow = isFiniteNumber(input.windowStart) ? Math.floor(input.windowStart) : 0;
  const baseOffset = isFiniteNumber(input.panelOffset) ? Math.floor(input.panelOffset) : 0;
  const baseHighlighted = input.highlightedIndex !== null && isFiniteNumber(input.highlightedIndex)
    ? Math.floor(input.highlightedIndex)
    : null;

  const delta = nextTotal - previousTotal;
  if (delta <= 0 || previousTotal <= 0) {
    return {
      windowStart: clamp(baseWindow, 0, maxWindowStart),
      highlightedIndex: baseHighlighted === null ? null : clamp(baseHighlighted, 0, nextTotal - 1),
      panelOffset: clamp(baseOffset, 0, maxPanelOffset),
    };
  }

  const nextHighlighted = baseHighlighted === null ? null : clamp(baseHighlighted + delta, 0, nextTotal - 1);
  if (input.panelOpen && baseOffset <= 0) {
    const contextReserve = Math.min(PREPEND_CONTEXT_ROWS, delta);
    return {
      windowStart: clamp(baseWindow + delta - contextReserve, 0, maxWindowStart),
      highlightedIndex: nextHighlighted,
      panelOffset: clamp(delta - contextReserve, 0, maxPanelOffset),
    };
  }

  return {
    windowStart: clamp(baseWindow + delta, 0, maxWindowStart),
    highlightedIndex: nextHighlighted,
    panelOffset: baseOffset > 0 ? clamp(baseOffset + delta, 0, maxPanelOffset) : 0,
  };
}

export type PanelWheelAction =
  | { type: 'noop' }
  | { type: 'load-older' }
  | { type: 'scroll'; nextOffset: number };

/**
 * 决策面板滚轮动作：已处于最顶行且继续向上滚轮时触发拉取更早历史，否则推进面板偏移。
 */
export function decidePanelWheelAction(input: {
  total: number;
  deltaY: number;
  panelOffset: number;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  hasHandler: boolean;
  elapsedSinceLastTriggerMs?: number;
  cooldownMs?: number;
}): PanelWheelAction {
  const total = isFiniteNumber(input.total) && input.total > 0 ? Math.floor(input.total) : 0;
  if (total === 0 || !isFiniteNumber(input.deltaY) || input.deltaY === 0) {
    return { type: 'noop' };
  }
  const step = input.deltaY > 0 ? 1 : -1;
  const currentOffset = isFiniteNumber(input.panelOffset) ? Math.floor(input.panelOffset) : 0;
  if (step < 0 && currentOffset <= 0) {
    const canLoad = shouldTriggerLoadOlderAtTop({
      hasOlder: input.hasOlder,
      isLoadingOlder: input.isLoadingOlder,
      hasHandler: input.hasHandler,
      atTop: true,
      movingUpward: true,
      elapsedSinceLastTriggerMs: input.elapsedSinceLastTriggerMs,
      cooldownMs: input.cooldownMs,
    });
    return canLoad ? { type: 'load-older' } : { type: 'noop' };
  }
  const maxOffset = Math.max(0, total - PANEL_VISIBLE_ROWS);
  return {
    type: 'scroll',
    nextOffset: clamp(currentOffset + step, 0, maxOffset),
  };
}

export type GutterKeyAction =
  | { type: 'noop' }
  | { type: 'load-older' }
  | { type: 'highlight'; target: number }
  | { type: 'select'; target: number }
  | { type: 'escape' };

/**
 * 决策轨道键盘动作：在窗口首条（anchor <= 0 && start === 0）继续按 ArrowUp 时触发更早历史拉取。
 */
export function decideGutterKeyAction(input: {
  key: string;
  anchor: number;
  start: number;
  total: number;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  hasHandler: boolean;
  elapsedSinceLastTriggerMs?: number;
  cooldownMs?: number;
}): GutterKeyAction {
  const total = isFiniteNumber(input.total) && input.total > 0 ? Math.floor(input.total) : 0;
  if (total === 0) return { type: 'noop' };
  const anchor = isFiniteNumber(input.anchor) ? Math.floor(input.anchor) : 0;
  const start = isFiniteNumber(input.start) ? Math.floor(input.start) : 0;

  switch (input.key) {
    case 'ArrowUp': {
      if (anchor <= 0 && start <= 0) {
        const canLoad = shouldTriggerLoadOlderAtTop({
          hasOlder: input.hasOlder,
          isLoadingOlder: input.isLoadingOlder,
          hasHandler: input.hasHandler,
          atTop: true,
          movingUpward: true,
          elapsedSinceLastTriggerMs: input.elapsedSinceLastTriggerMs,
          cooldownMs: input.cooldownMs,
        });
        return canLoad ? { type: 'load-older' } : { type: 'noop' };
      }
      return { type: 'highlight', target: clamp(anchor - 1, 0, total - 1) };
    }
    case 'ArrowDown':
      return { type: 'highlight', target: clamp(anchor + 1, 0, total - 1) };
    case 'Home':
      return { type: 'highlight', target: 0 };
    case 'End':
      return { type: 'highlight', target: total - 1 };
    case 'Enter':
    case ' ':
      return { type: 'select', target: anchor >= 0 ? clamp(anchor, 0, total - 1) : 0 };
    case 'Escape':
      return { type: 'escape' };
    default:
      return { type: 'noop' };
  }
}

export type HotzonePointerAction =
  | { type: 'top-carousel'; resetTriggered: true }
  | { type: 'top-load-older'; shouldTrigger: boolean }
  | { type: 'bottom-carousel'; resetTriggered: true }
  | { type: 'stop'; resetTriggered: true };

/**
 * 决策轨道热区悬停动作：指针位于顶部热区且已无更多本地上文刻度时，触发一轮更早历史拉取。
 */
export function decideHotzonePointerAction(input: {
  offsetY: number;
  gutterHeight: number;
  edgePx: number;
  hasMoreAbove: boolean;
  topHotzoneTriggered: boolean;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  hasHandler: boolean;
  elapsedSinceLastTriggerMs?: number;
  cooldownMs?: number;
}): HotzonePointerAction {
  const offsetY = isFiniteNumber(input.offsetY) ? input.offsetY : 0;
  const gutterHeight = isFiniteNumber(input.gutterHeight) ? input.gutterHeight : 0;
  const edgePx = isFiniteNumber(input.edgePx) && input.edgePx > 0 ? input.edgePx : 0;

  if (offsetY <= edgePx) {
    if (input.hasMoreAbove) {
      return { type: 'top-carousel', resetTriggered: true };
    }
    const shouldTrigger =
      !input.topHotzoneTriggered &&
      shouldTriggerLoadOlderAtTop({
        hasOlder: input.hasOlder,
        isLoadingOlder: input.isLoadingOlder,
        hasHandler: input.hasHandler,
        atTop: true,
        movingUpward: true,
        elapsedSinceLastTriggerMs: input.elapsedSinceLastTriggerMs,
        cooldownMs: input.cooldownMs,
      });
    return { type: 'top-load-older', shouldTrigger };
  }

  if (offsetY >= gutterHeight - edgePx) {
    return { type: 'bottom-carousel', resetTriggered: true };
  }

  return { type: 'stop', resetTriggered: true };
}
