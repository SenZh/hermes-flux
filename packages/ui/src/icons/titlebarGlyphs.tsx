import * as React from 'react';

/**
 * 顶栏图标集（唯一实现）。
 *
 * 【设计意图 (Why)】顶栏图标此前混用 lucide 的 11/12/14px 三档尺寸与统一 2px 线宽，
 *   放大到 1.25x 屏后出现「减号发胖、方块发虚、齿轮比面板图标粗」的视觉失衡；
 *   这里把顶栏全部字形收敛到同一张 16×16 网格、同一 1.25px 线宽与同一光学尺寸，
 *   使左右两簇按钮在 32px 顶栏内共享同一条视觉中线。
 * 【防范的历史坑 (Pitfall)】曾直接复用通用图标库默认尺寸，字形随按钮尺寸漂移，
 *   窗控三键与全局开关看起来像两套不同的设计语言。
 * 【约束与规则 (Rules)】
 *   1. 只承载顶栏字形，禁止把业务图标塞进来；
 *   2. 线宽只准写 1.25，尺寸只准由调用方传 size，组件内禁止自带 px 尺寸；
 *   3. 颜色只走 currentColor，禁止裸写色值（换肤必须自动跟随）。
 */
const GLYPH_PROPS = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.25,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: 'false' as const,
};

export interface TitlebarGlyphProps {
  size?: number;
}

/** 左轨折叠：面板 + 内侧分栏线，与 PanelRight 互为镜像。 */
export function PanelLeftGlyph({ size = 16 }: TitlebarGlyphProps): React.ReactElement {
  return <svg {...GLYPH_PROPS} width={size} height={size}>
    <rect x="2.5" y="3.5" width="11" height="9" rx="1.6" />
    <path d="M6.5 3.5v9" />
  </svg>;
}

/** 右侧检查舱：与 PanelLeftGlyph 同构镜像。 */
export function PanelRightGlyph({ size = 16 }: TitlebarGlyphProps): React.ReactElement {
  return <svg {...GLYPH_PROPS} width={size} height={size}>
    <rect x="2.5" y="3.5" width="11" height="9" rx="1.6" />
    <path d="M9.5 3.5v9" />
  </svg>;
}

/**
 * 设置：竖向双推子。
 * 【设计意图】「配置」的语义是调参而非开关，推子比齿轮更贴近本产品的参数化设置中心；
 *   竖向排列又能与顶栏的竖直节奏呼应。轨道在滑块处断开，避免线条穿过滑块形成噪点。
 */
export function SettingsGlyph({ size = 16 }: TitlebarGlyphProps): React.ReactElement {
  return <svg {...GLYPH_PROPS} width={size} height={size}>
    <path d="M5.5 2.6v2.1M5.5 7.3v6.1" />
    <circle cx="5.5" cy="6" r="1.35" />
    <path d="M10.5 2.6v5.1M10.5 11.3v2.1" />
    <circle cx="10.5" cy="10" r="1.35" />
  </svg>;
}

/** 最小化：与最大化方块等宽（9.6px）的单横线，保证两键光学等重。 */
export function MinimizeGlyph({ size = 16 }: TitlebarGlyphProps): React.ReactElement {
  return <svg {...GLYPH_PROPS} width={size} height={size}>
    <path d="M3.2 8h9.6" />
  </svg>;
}

/** 最大化：9.6px 见方、1.2 圆角的细框。 */
export function MaximizeGlyph({ size = 16 }: TitlebarGlyphProps): React.ReactElement {
  return <svg {...GLYPH_PROPS} width={size} height={size}>
    <rect x="3.2" y="3.2" width="9.6" height="9.6" rx="1.2" />
  </svg>;
}

/** 还原：双框叠压，后框只画上半与左半，避免 16px 下糊成一团。 */
export function RestoreGlyph({ size = 16 }: TitlebarGlyphProps): React.ReactElement {
  return <svg {...GLYPH_PROPS} width={size} height={size}>
    <rect x="5.4" y="5.4" width="8" height="8" rx="1.2" />
    <path d="M2.6 10.2V4.6a2 2 0 0 1 2-2h5.6" />
  </svg>;
}

/** 关闭：与最大化方块同外接尺寸的对角十字。 */
export function CloseGlyph({ size = 16 }: TitlebarGlyphProps): React.ReactElement {
  return <svg {...GLYPH_PROPS} width={size} height={size}>
    <path d="M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8" />
  </svg>;
}
