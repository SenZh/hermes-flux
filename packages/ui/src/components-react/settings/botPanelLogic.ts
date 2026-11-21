/**
 * BOT 配置面板纯逻辑模块（零 DOM / 零 React）。
 *
 * 【设计意图 (Why)】
 *   BOT 成员选择栏与详情表单承载了头像草稿解析、roving tabindex 兜底、键盘回绕导航、
 *   滚轮/溢出步进计算、SOUL 光标插入与字节超限判定、以及非权威能力开关守卫。
 *   把这些可判定的规则收敛为纯函数，使单元测试与变异检验能直接命中每一个边界分支，
 *   不再把逻辑锁死在只能做静态 SSR 的 JSX 内部。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. `avatar.kind === 'clear'` 墓碑语义若被忽略，已清除的头像会从花名册复活；
 *   2. `activeBotId` 暂未命中花名册时若不回退首项，`tabIndex` 全部为 `-1`，键盘完全不可达；
 *   3. `countEnabledCapabilities` 若直接取 `draft.enabledToolsets.length`，脏数据会导致 `3 / 2 已启用`；
 *   4. `toggleCapabilityId` 若忽略 `list.authoritative === false`，只读清单会被界面篡改。
 *
 * 【约束与规则 (Rules)】
 *   1. 禁止引入 React、DOM 或网络副作用；
 *   2. 所有输入按只读处理，更新一律返回新数组或新对象；
 *   3. 阈值与上限在此单源导出，组件与测试必须消费同一常量。
 */

import type { BotCapabilityList, BotCapabilityRow, BotDraftState, BotManagementStatus } from '@hermes-flux/core';

/** 详情工作台扁平一级菜单页签。 */
export type BotDetailTab = 'basic' | 'soul' | 'toolsets' | 'skills' | 'mcp';
/** 能力矩阵分类。 */
export type BotCapCategory = 'toolsets' | 'skills' | 'mcp';
/** 能力矩阵状态筛选。 */
export type BotCapFilterMode = 'all' | 'enabled' | 'disabled';

/** SOUL.md 软上限：64KB（UTF-8 字节）。超出只警告，不阻断保存。 */
export const SOUL_SOFT_LIMIT_BYTES = 64 * 1024;
/** 成员栏横向溢出判定容差（px），吸收亚像素舍入误差。 */
export const OVERFLOW_THRESHOLD_PX = 2;

const UTF8_ENCODER = new TextEncoder();

/** 草稿头像优先：replace 用新图，clear 墓碑语义视为无头像，unchanged/缺省回落到花名册资产。 */
export function resolveBotAvatar(
  rosterAvatar: string | undefined,
  draft: BotDraftState | undefined,
): string | undefined {
  if (!draft) return rosterAvatar;
  if (draft.avatar.kind === 'replace') return draft.avatar.dataUrl;
  if (draft.avatar.kind === 'clear') return undefined;
  return rosterAvatar;
}

/** 解析展示标题：有草稿时取草稿显示名，空串一律回退为 BOT ID。 */
export function resolveBotDisplayTitle(
  rosterDisplayName: string,
  botId: string,
  draft: BotDraftState | undefined,
): string {
  const raw = draft ? draft.displayName : rosterDisplayName;
  return raw.trim() ? raw : botId;
}

/** 解析成员卡副标题：有模型绑定时走统一可读格式化，未绑定时展示 BOT ID。 */
export function resolveBotCardSubtitle(
  rosterModel: string,
  botId: string,
  draft: BotDraftState | undefined,
  formatModel: (modelId: string) => string,
): string {
  const model = (draft ? draft.model : rosterModel).trim();
  if (!model) return botId;
  const formatted = formatModel(model).trim();
  return formatted || model;
}

/**
 * 解析当前应持有 `tabIndex={0}` 的 BOT ID（roving tabindex 单一出口）。
 * 【规则】`activeBotId` 命中花名册返回自身；否则回落第一项，避免全部 tab 都是 `-1` 导致键盘失焦。
 */
export function resolveFocusableBotId(
  roster: ReadonlyArray<{ id: string }>,
  activeBotId: string,
): string {
  if (roster.length === 0) return '';
  if (roster.some((item) => item.id === activeBotId)) return activeBotId;
  return roster[0].id;
}

/** 计算成员栏键盘导航目标索引；同时支持横向（左右）与垂直微轨（上下）及 Home/End。 */
export function resolveCarouselKeyTarget(
  key: string,
  currentIndex: number,
  length: number,
): number {
  if (length <= 1 || currentIndex < 0 || currentIndex >= length) return -1;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (currentIndex - 1 + length) % length;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (currentIndex + 1) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return -1;
}

/** 计算横向滚动轨道左右翻页按钮显隐状态。 */
export function computeHorizontalOverflow(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
  threshold = OVERFLOW_THRESHOLD_PX,
): { left: boolean; right: boolean } {
  if (clientWidth <= 0 || scrollWidth <= clientWidth + threshold) {
    return { left: false, right: false };
  }
  return {
    left: scrollLeft > threshold,
    right: scrollLeft + clientWidth < scrollWidth - threshold,
  };
}

/** 把鼠标滚轮/触控板增量归一化为横向滚动像素值（`deltaMode`: 1=行, 2=页, 0=像素）。 */
export function computeWheelScrollDelta(deltaX: number, deltaY: number, deltaMode: number): number {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 100 : 1;
  const dominant = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  return dominant * unit;
}

/** 计算左右翻页箭头单次滚动步进（至少 200px，宽视口按 60% 容器宽推进）。 */
export function computeTrackScrollStep(clientWidth: number): number {
  if (!Number.isFinite(clientWidth) || clientWidth <= 0) return 200;
  return Math.max(200, Math.round(clientWidth * 0.6));
}

/** 精确计算 SOUL.md 的 UTF-8 字节长度（多字节中文按 UTF-8 实算）。 */
export function computeSoulByteLength(soul: string): number {
  return UTF8_ENCODER.encode(soul).length;
}

/** 是否超出 64KB 软上限（严格大于才超限）。 */
export function isSoulOverLimit(bytes: number): boolean {
  return bytes > SOUL_SOFT_LIMIT_BYTES;
}

/**
 * 在光标/选区位置插入片段并返回新文本与插入后光标位置。
 * 【规则】越界选区一律夹紧到 `[0, source.length]`，且保证 `end >= start`。
 */
export function insertTextAtSelection(
  source: string,
  insertion: string,
  selectionStart?: number | null,
  selectionEnd?: number | null,
): { value: string; caret: number } {
  const length = source.length;
  const clamp = (value: number | null | undefined, fallback: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(length, Math.trunc(value)));
  };
  const start = clamp(selectionStart, length);
  const end = Math.max(start, clamp(selectionEnd, start));
  return {
    value: source.slice(0, start) + insertion + source.slice(end),
    caret: start + insertion.length,
  };
}

/** 切换能力条目开关；非权威清单只读，返回原数组副本不改写。 */
export function toggleCapabilityId(
  list: BotCapabilityList,
  current: readonly string[],
  id: string,
  next: boolean,
): string[] {
  if (!list.authoritative) return [...current];
  const set = new Set(current);
  if (next) set.add(id);
  else set.delete(id);
  return Array.from(set);
}

/** 按清单行交集统计已启用条数，防止草稿中的陈旧 ID 造成计数大于总数。 */
export function countEnabledCapabilities(
  list: BotCapabilityList,
  enabledIds: readonly string[],
): number {
  const enabledSet = new Set(enabledIds);
  let count = 0;
  for (const row of list.rows) {
    if (enabledSet.has(row.id)) count += 1;
  }
  return count;
}

/** 判定当前是否允许执行「恢复默认头像」。 */
export function canResetBotAvatar(params: {
  activeId: string;
  hasDetail: boolean;
  draft: BotDraftState | null;
  effectiveAvatar: string | undefined;
  locked: boolean;
  status: BotManagementStatus['status'];
}): boolean {
  const { activeId, hasDetail, draft, effectiveAvatar, locked, status } = params;
  if (!activeId || !hasDetail || !draft || !effectiveAvatar) return false;
  if (draft.avatar.kind === 'clear') return false;
  if (locked) return false;
  return status !== 'detail_error' && status !== 'loading_detail';
}

/** 按关键词筛选微轨 BOT 花名册（大小写无关匹配显示名与 ID）。 */
export function filterBotRoster<T extends { id: string; displayName: string }>(
  roster: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...roster];
  return roster.filter(
    (item) =>
      item.displayName.toLowerCase().includes(needle) ||
      item.id.toLowerCase().includes(needle),
  );
}

/**
 * 面向 200+ 条目扩展的能力矩阵多维过滤（状态胶囊 × 关键词搜索）。
 * 【规则】严格遵循原始顺序，大小写无关包含匹配 id / label / description / transport。
 */
export function filterCapabilities(
  rows: readonly BotCapabilityRow[],
  enabledIds: readonly string[],
  filterMode: BotCapFilterMode,
  query: string,
): BotCapabilityRow[] {
  const enabledSet = new Set(enabledIds);
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    const isOn = enabledSet.has(row.id);
    if (filterMode === 'enabled' && !isOn) return false;
    if (filterMode === 'disabled' && isOn) return false;
    if (!needle) return true;
    return (
      row.id.toLowerCase().includes(needle) ||
      row.label.toLowerCase().includes(needle) ||
      (row.description ? row.description.toLowerCase().includes(needle) : false) ||
      (row.transport ? row.transport.toLowerCase().includes(needle) : false)
    );
  });
}

/** 计算 SOUL.md 总行数（至少 1 行，兼容 CRLF/CR/LF）。 */
export function computeSoulLineCount(soul: string): number {
  if (!soul) return 1;
  return soul.split(/\r\n|\r|\n/).length;
}

/** 将全局设置检索锚点映射为 BOT 面板一级目标 Tab。 */
export function resolveAnchorNavigation(anchorId: string): {
  tab: BotDetailTab;
} {
  switch (anchorId) {
    case 'bot-soul':
      return { tab: 'soul' };
    case 'bot-toolsets':
      return { tab: 'toolsets' };
    case 'bot-skills':
      return { tab: 'skills' };
    case 'bot-mcp':
      return { tab: 'mcp' };
    default:
      return { tab: 'basic' };
  }
}
