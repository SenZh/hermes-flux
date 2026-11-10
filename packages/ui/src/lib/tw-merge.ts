/**
 * tailwind-merge 的 Hermes Flux 语义扩展实例。
 *
 * 【设计意图 (Why)】
 *   `cn()` 的合并规则决定"后写的类赢"。tailwind-merge 只认识 Tailwind 的默认刻度，
 *   而本项目的字号档位是自定义语义名（text-body / text-title…），默认实例会把它们
 *   判定为**文本颜色**类。于是 `text-body text-secondary-foreground` 合并后只剩颜色，
 *   字号被静默删除，元素回落到浏览器默认（表单控件是 13.3333px），
 *   表现为"新写的组件字全小一号、行高不成套"，而任何静态门禁都看不出来。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 只给 tailwind-merge 加 font-size 组还不够：`rounded-inner` 与 `rounded-card`
 *      默认不同组，两个语义圆角同时出现时不会互相覆盖，后写的那个反而取决于 CSS 顺序；
 *      `shadow-card` / `shadow-window` 同理，必须显式登记为互斥组。
 *   2. 这套映射必须与 tailwind-entry.css 的 @theme 档位同源，任何一侧新增档位都要同步，
 *      否则新档位会再次被当作文本颜色吞掉。
 *
 * 【约束与规则 (Rules)】
 *   1. 组件一律使用本文件导出的 cn，禁止直接 import tailwind-merge 的 twMerge；
 *   2. 新增语义档位时，必须同时改 tailwind-entry.css 与本文件的 classGroups；
 *   3. 只扩展，不重写默认分组（extend 语义），避免破坏 shadcn 默认行为。
 */
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** 与 tailwind-entry.css 的 --text-* 档位一一对应。 */
export const TYPE_SCALE_TOKENS = ['hero', 'title', 'section', 'body', 'aux', 'caption', 'overline', 'micro'] as const;
/** 与 tailwind-entry.css 的 @utility rounded-* 一一对应。 */
export const RADIUS_TOKENS = ['inner', 'card', 'panel', 'window'] as const;
/** 与 tailwind-entry.css 的 @utility shadow-* 一一对应。 */
export const ELEVATION_TOKENS = ['card', 'window', 'dock'] as const;

const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...TYPE_SCALE_TOKENS] }],
      rounded: [{ rounded: [...RADIUS_TOKENS] }],
      shadow: [{ shadow: [...ELEVATION_TOKENS] }],
    },
  },
});

/**
 * 合并类名并正确处理语义档位冲突。
 * @param inputs clsx 支持的全部输入形态
 */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
