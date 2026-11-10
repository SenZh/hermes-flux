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

export interface PromptNavigatorSnapshot {
  prompts: readonly PromptEntry[];
  /** 指向 prompts 的下标，-1 表示尚未定位 */
  activeIndex: number;
  locale?: string;
}

export interface PromptNavigatorActions {
  /** 传消息 id，不传易失下标 */
  onSelect: (messageId: string) => void;
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
 *   3. 按入参顺序编号，不排序、不去重；输出天然按 index 严格升序。
 */
export function buildPromptEntries(
  messages: readonly { id: string; role: string; content: string }[]
): PromptEntry[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const entries: PromptEntry[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (!message || message.role !== 'user') continue;
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
 * 计算一根横杠的视觉宽度。
 *
 * 【设计意图 (Why)】
 *   单纯等宽会让轨道变成一根没有焦点的刻度尺；用距离衰减把当前轮次做成视觉焦点，
 *   读者一眼就能看出"我读到的这一轮在哪里"。
 *
 * 【防范的历史坑 (Pitfall)】
 *   曾把衰减系数乘在已含悬停放大的宽度上，悬停时相邻横杠反而比当前项更宽，
 *   出现"高亮在左、视觉焦点在右"的错觉。
 *
 * 【约束与规则 (Rules)】
 *   1. 基准 10px，当前项 14px，悬停 20px（悬停优先于当前项）；
 *   2. 距离衰减 `[1, 0.6, 0.35, 0.15]`，距离 >= 4 归零；
 *   3. 距离非有限或为负按 0 处理，结果保留两位小数以稳定内联样式字符串。
 */
export function tickWidth(distance: number, isActive: boolean, isHighlighted: boolean): number {
  const base = isHighlighted ? 20 : isActive ? 14 : 10;
  const step = isFiniteNumber(distance) && distance > 0 ? Math.floor(distance) : 0;
  if (step >= TICK_WIDTH_DECAY.length) return 0;
  const factor = TICK_WIDTH_DECAY[step];
  return Math.round(base * factor * 100) / 100;
}
