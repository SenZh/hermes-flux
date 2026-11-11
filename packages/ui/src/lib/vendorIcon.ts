/**
 * 模型厂商图标渲染层 (packages/ui/src/lib/vendorIcon.ts)
 *
 * 【为什么放在 lib 而不是 components】
 *   它不拥有独立的界面结构，只产出给既有字符串模板组件（InputDock / 设置页 / 群聊成员）
 *   复用的 HTML 片段，与同目录 `fileTypeIcons.ts`、`markdown.ts` 同类。
 *   放在 components/ 下会与「迁移期禁止新增字符串模板组件」的门禁语义冲突，
 *   而写成 .tsx 又无法在 renderXxx 里被调用——归类到 lib 是唯一自洽的位置。
 *
 * 【设计意图 (Why)】
 *   模型选择器、输入舱触发按钮、设置页模型行都需要「这个模型属于哪家厂商」的视觉锚点。
 *   文字名（`DeepSeek V4.1 Flash`）在 320px 宽的紧凑列表里辨识极慢，而厂商 logo 是
 *   用户已有的心智捷径。图标必须按 **模型身份** 自动判定，不能靠调用方手工传参——
 *   一旦手工传，新增模型就会漏配，最后变成满屏占位符。
 *
 * 【为什么是「双轨自适应」而不是单一套资源 (Pitfall)】
 *   图标来源 `@lobehub/icons-static-svg` 的品牌变体并不齐整，实测 357 个基础族中：
 *   - 121 个只有 mono（OpenAI / Anthropic / xAI / Moonshot —— 官方标识本身就是黑色）；
 *   - 236 个有彩色版，其中仅 135 个在深、浅两侧都够对比度（永远彩色）；
 *     69 个只在深色可读（浅色皮肤须退 mono）、32 个只在浅色可读（深色皮肤须退 mono）。
 *   因此渲染必须分四档：两侧可读 → 永远彩色；单侧可读 → 朝那一侧出彩色、另一侧退 mono；
 *   两侧都不可读 → mono。**一切双轨都默认 mono**：`data-appearance` 缺失时无法确定底色，
 *   绝不因为属性没同步就先把黑（或荧光）图标贴到底色上。
 *
 * 【约束与规则 (Rules)】
 *   - 颜色一律走 `currentColor`（mono 用 CSS mask）或品牌原色资产，本文件零硬编码色值；
 *   - `vendorId` 只来自 core 的稳定 slug，禁止在 UI 侧二次推断厂商；
 *   - 判不出厂商、或上游没有官方图标时必须渲染首字母 badge，**不允许留空、不允许回退 emoji**；
 *   - 纯字符串渲染，零 DOM / 零网络 / 零副作用，可在 desktop / web / mobile 同构复用。
 */

import { parseModelDisplay, resolveProviderVendorId } from '@hermes-flux/core';
import { VENDOR_ICON_ASSETS } from '../icons/vendorIconAssets.js';
import { escapeHtml } from '../utils/html.js';

/** 图标文件在渲染产物中的相对目录（相对 index.html 与 conversation.css 所在目录）。 */
const ICON_DIR = 'icons/lobe';

/** 列表行内的默认图标边长（px），与 12~13px 正文行高匹配。 */
const DEFAULT_ICON_SIZE = 14;

/** 合法尺寸区间：小于 10px 品牌细节糊成色块，大于 20px 会撑破列表行。 */
const MIN_ICON_SIZE = 10;
const MAX_ICON_SIZE = 20;

/**
 * 图标渲染形态。
 *
 * - `color`：彩色版在深色与浅色两侧都可读，直接渲染 `<img>`；
 * - `dual`：彩色版只在浅色皮肤可读（黑/深色标识），深色皮肤切 mono；
 * - `dual-inverse`：彩色版只在深色皮肤可读（荧光/浅色标识），浅色皮肤切 mono；
 * - `mono`：没有任何一侧可读的彩色版，或上游只有 mono 变体，用 CSS mask + `currentColor`；
 * - `badge`：无厂商标识或上游无图标，渲染首字母。
 */
export type VendorIconVariant = 'color' | 'dual' | 'dual-inverse' | 'mono' | 'badge';

/**
 * 判定某个厂商 slug 应走哪种渲染形态。
 *
 * 【规则】
 *   - 清单里查不到、或 slug 为空，一律 `badge`；清单本身就是「文件是否存在」的唯一权威；
 *   - 彩色版必须**两侧都可读**才敢无条件使用：只保证深色可读的品牌（OpenAI 式的黑标识）
 *     在白底上会变成灰色鬼影，只保证浅色可读的品牌（OpenRouter 的荧光绿 `#C8FF00`，
 *     白底 1.18:1）在深色底上同样隐形；
 *   - 只有一侧可读时退化为双轨，两侧都不可读时直接 mono——宁可朴素，不给用户看半截图标。
 */
export function resolveVendorIconVariant(vendorId: string): VendorIconVariant {
  if (!vendorId) return 'badge';
  const asset = VENDOR_ICON_ASSETS[vendorId];
  if (!asset) return 'badge';

  if (asset.color && asset.mono) {
    if (asset.colorDarkSafe && asset.colorLightSafe) return 'color';
    if (asset.colorDarkSafe) return 'dual-inverse';
    if (asset.colorLightSafe) return 'dual';
    return 'mono';
  }
  if (asset.mono) return 'mono';
  if (asset.color) {
    // 【防御】当前清单不存在「有彩色无 mono」的品牌（实测 0 条）。一旦上游新增，
    // 我们没有 mono 可以退，只能照常出彩色，并把可读性交给品牌方——留此分支是为了
    // 让未来新增变体时行为可预期，而不是静默落进 badge。
    return 'color';
  }
  return 'badge';
}

/**
 * 该厂商是否在图标清单内。
 *
 * @internal 供跨包一致性测试与未来的「图标可用性」诊断使用；
 *   生产渲染路径直接走 `resolveVendorIconVariant`（它会一并处理降级），
 *   不要用它做条件分支，否则会绕开 badge 兜底。
 */
export function hasVendorIcon(vendorId: string): boolean {
  return Boolean(vendorId) && Boolean(VENDOR_ICON_ASSETS[vendorId]);
}

/**
 * badge 首字符。
 *
 * 【规则】取展示名首字符（中文厂商名同样适用）；展示名与 slug 都为空时用 `?`，
 * 保证任何输入都能渲染出一个可点击、可对齐的方块，不留空洞。
 */
export function vendorIconBadgeLetter(label: string, vendorId: string): string {
  const source = (label || vendorId || '').trim();
  if (!source) return '?';
  return source.slice(0, 1).toUpperCase();
}

export interface RenderVendorIconOptions {
  /** core 派生的厂商 slug；空串走 badge 降级 */
  vendorId: string;
  /** 厂商展示名，用于 `title` / `aria-label` 与 badge 首字符 */
  label?: string;
  /** 边长 px，默认 14，自动夹在 10~20 */
  size?: number;
  /** 追加的额外 class（用于在具体容器里微调间距） */
  className?: string;
  /**
   * badge 降级时返回空串而非首字母方块。
   *
   * 【为什么需要】provider 分组标题里，右侧已经写着 provider 名，
   * 再补一个同首字母的方块就是「C cpa」「N nous」这种纯冗余装饰；
   * 设计系统要求无意义的装饰直接省略，而不是凑满版面。
   */
  suppressBadge?: boolean;
}

function clampSize(size: number | undefined): number {
  const value = Number.isFinite(size) ? Math.round(size as number) : DEFAULT_ICON_SIZE;
  return Math.min(MAX_ICON_SIZE, Math.max(MIN_ICON_SIZE, value));
}

/**
 * 渲染单个厂商图标。
 *
 * 【规则】输出始终是一个 `.vendor-icon` 方块，宽度高度由 `size` 固定，
 * 因此无论图标、徽标还是 badge，行内对齐都不会跳。
 */
export function renderVendorIcon(options: RenderVendorIconOptions): string {
  const { vendorId, label = '', size, className = '', suppressBadge = false } = options;
  const iconSize = clampSize(size);
  const variant = resolveVendorIconVariant(vendorId);
  // 【规则】`title` 只取调用方给的展示名：vendorId 是内部 slug，绝不能露给用户
  // （`title="anthropic"` 这种半成品提示比没有提示更糟）。label 为空则干脆不加 title。
  const title = label.trim();
  const classes = ['vendor-icon', className].filter(Boolean).join(' ');
  const boxStyle = `width:${iconSize}px;height:${iconSize}px;`;
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';

  // 【规则】图标一律 `aria-hidden="true"`：厂商归属已经由同一行的名称文本承担，
  // 再给图标挂 aria-label 只会让读屏把同一个名字念两遍。
  if (variant === 'badge') {
    if (suppressBadge) return '';
    const letter = vendorIconBadgeLetter(label, vendorId);
    return `<span class="${classes} vendor-icon--badge"${titleAttr} aria-hidden="true" style="${boxStyle}">${escapeHtml(letter)}</span>`;
  }

  const slug = escapeHtml(vendorId);
  // mono 用 CSS mask 绘制，颜色由 currentColor 决定，因此能随皮肤与选中态变色。
  const mono = `<span class="vendor-icon__mono" style="--vendor-icon-src:url('${ICON_DIR}/${slug}.svg');"></span>`;
  const color =
    `<img class="vendor-icon__color" src="${ICON_DIR}/${slug}-color.svg" alt="" ` +
    `width="${iconSize}" height="${iconSize}" draggable="false" decoding="async">`;

  if (variant === 'mono') {
    return `<span class="${classes}"${titleAttr} aria-hidden="true" style="${boxStyle}">${mono}</span>`;
  }
  if (variant === 'color') {
    return `<span class="${classes}"${titleAttr} aria-hidden="true" style="${boxStyle}">${color}</span>`;
  }
  // 双轨：两个节点都渲染，由 CSS 按 `data-appearance` 决定显示哪一个。
  const dualClass = variant === 'dual-inverse' ? 'vendor-icon--dual vendor-icon--dual-inverse' : 'vendor-icon--dual';
  return `<span class="${classes} ${dualClass}"${titleAttr} aria-hidden="true" style="${boxStyle}">${color}${mono}</span>`;
}

/**
 * 按模型 ID 渲染图标（模型行、触发按钮、设置页共用入口）。
 *
 * 【规则】厂商判定全部交给 core（`parseModelDisplay` 同时给出展示名与 slug），
 * UI 只做「slug → 图标」的纯查表，保证所有模型展示场景的口径完全一致；
 * `title` 用的也必须是展示名，绝不能把内部 slug 露给用户。
 */
export function renderModelVendorIcon(
  modelId: string,
  providerName = '',
  options: { size?: number; className?: string; label?: string; suppressBadge?: boolean } = {},
): string {
  const parts = parseModelDisplay(modelId, providerName);
  return renderVendorIcon({
    vendorId: parts.vendorId,
    label: options.label ?? parts.vendor,
    size: options.size,
    className: options.className,
    suppressBadge: options.suppressBadge,
  });
}

/**
 * 按 provider 渲染图标（选择器分组标题行）。
 *
 * 【规则】provider slug 与模型 ID 前缀是两套命名，这里走 provider 维度判定；
 * 判不出就降级 badge，绝不把 `cpa` / `nous` 硬套成某家厂商的 logo。
 */
export function renderProviderVendorIcon(
  providerSlug: string,
  providerName = '',
  options: { size?: number; className?: string } = {},
): string {
  const vendorId = resolveProviderVendorId(providerSlug, providerName);
  // 分组标题不补首字母徽标：provider 名就在右侧，重复首字母是纯装饰噪音。
  return renderVendorIcon({
    vendorId,
    label: providerName || providerSlug,
    size: options.size,
    className: options.className,
    suppressBadge: true,
  });
}
