/**
 * 头像尺寸解析（唯一实现，纯函数）。
 *
 * 【设计意图 (Why)】
 *   `renderBotAvatar` 的尺寸形参同时接受像素数字与 CSS 长度表达式：
 *   微轨站点卡随视口 clamp 缩放后，头像必须跟着卡走，只能下发 `var(--geo-station-avatar)`。
 *   但该值最终会被拼进 `style` 属性——不校验就等于把属性注入面开给调用方
 *   （`36px" onerror="alert(1)` 能闭合 style 再追加事件处理器）。
 *
 * 【防范的历史坑 (Pitfall)】
 *   放宽形参类型却不加白名单时，任意字符串都能落进 style；这里把「解析」与「渲染」拆开，
 *   让白名单可被单测与变异测试直接命中，而不是埋在 200 行 SVG 字符串里。
 *
 * 【约束与规则 (Rules)】
 *   1. 数字必须有限且为正，否则回退 36px；
 *   2. 字符串只放行 `var(--token[, fallback])` 与「数字 + 单位」，其余回退 36px；
 *   3. 回退必须可观测（console.warn），禁止静默吞掉；
 *   4. 数字形态保留 width/height 属性契约，字符串形态只能走 style（SVG 几何属性不接受 var()）。
 */

/** 回退尺寸：与历史默认值一致，保证非法入参的观感不突变。 */
export const AVATAR_SIZE_FALLBACK = '36px';

/**
 * 白名单：CSS 变量（可带简单 fallback）或带单位数值。
 * 刻意不放行 calc()/min()/max()/表达式与任何引号、分号、尖括号——注入面在此收口。
 * fallback 段用「非空白起首」的字符类一次吃掉逗号后的空格，避免 `\s*` 这类
 * 等价变异体（`\s*` ↔ `\S*` 在本形态下行为相同，留着只会污染变异得分）。
 */
const AVATAR_SIZE_PATTERN = /^(?:var\(--[\w-]+(?:,[^()"';]+)?\)|\d+(?:\.\d+)?(?:px|rem|em|%|vw|vh))$/;

/** 合法且为正的像素数字；其余返回 undefined（供属性分支判断）。 */
export function resolveAvatarPixelSize(size: number | string): number | undefined {
  return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : undefined;
}

/** 把两种形态统一成一条可安全插入 style 的 CSS 长度。 */
export function resolveAvatarSizeCss(size: number | string): string {
  const px = resolveAvatarPixelSize(size);
  if (px !== undefined) return `${px}px`;
  if (typeof size === 'string' && AVATAR_SIZE_PATTERN.test(size)) return size;
  console.warn('[botAvatar] 非法尺寸入参已回退 36px：', size);
  return AVATAR_SIZE_FALLBACK;
}

/**
 * SVG 侧宽高属性片段。
 * 数字形态下发 ` width="36" height="36"`（既有调用点与守卫测试以属性为准）；
 * 字符串形态返回空串，由 style 承担。回退尺寸按数字形态下发，保持标签自洽。
 */
export function resolveAvatarSizeAttributes(size: number | string): string {
  const px = resolveAvatarPixelSize(size);
  if (px !== undefined) return ` width="${px}" height="${px}"`;
  if (typeof size === 'string' && AVATAR_SIZE_PATTERN.test(size)) return '';
  return ` width="36" height="36"`;
}
