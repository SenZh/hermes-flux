/**
 * 字体注册表与字号语义 Token（对标 OpenChamber lib/fontOptions.ts + lib/typography.ts）。
 *
 * 设计意图(Why)：
 *   字体与字号必须是可配置的数据。注册表决定"可选什么"，偏好层决定"选了什么"，
 *   应用层把结果写到 :root 变量上。界面要开放配置时只需接下拉框，不用改组件。
 *
 * 防范的历史坑(Pitfall)：
 *   1. 对话区曾写死字体名，与左侧栏不同源，用户无法统一调整；
 *   2. OpenChamber 源码里的 DEFAULT_* 只是出厂值，用户持久化后的偏好才是实际显示的字体，
 *      不能把源码默认值当成界面默认值；
 *   3. 非系统字体必须本地打包，禁止运行时走 CDN（桌面端离线可用）。
 *
 * 约束与规则(Rules)：
 *   1. 每个选项的 stack 末尾必须回落到系统字体，保证字体缺失时可降级；
 *   2. 带 source 的选项必须在 desktop 的 @fontsource 依赖中存在，并由构建脚本拷贝 woff2；
 *   3. 字号档位只定义语义名，消费方一律引用 CSS 变量，禁止裸 px。
 */

export type SansFontId =
  | 'system'
  | 'ibm-plex-sans'
  | 'inter'
  | 'geist-sans'
  | 'atkinson-hyperlegible'
  | 'source-sans-3'
  | 'roboto'
  | 'noto-sans'
  | 'dm-sans'
  | 'manrope';

export type MonoFontId =
  | 'system-mono'
  | 'ibm-plex-mono'
  | 'jetbrains-mono'
  | 'fira-code'
  | 'geist-mono'
  | 'commit-mono'
  | 'source-code-pro'
  | 'cascadia-code'
  | 'roboto-mono'
  | 'iosevka';

/** 界面字体可选范围：全部无衬线 + 全部等宽，允许把正文切成等宽观察效果。 */
export type UiFontId = SansFontId | MonoFontId;

export interface FontSource {
  /** @fontsource 包名，构建时据此定位 woff2 */
  packageName: string;
  /** woff2 文件名前缀，如 "inter" 对应 inter-latin-400-normal.woff2 */
  filePrefix: string;
  weights: readonly number[];
}

export interface FontOption<T extends string> {
  id: T;
  label: string;
  stack: string;
  source?: FontSource;
}

const SYSTEM_SANS_FALLBACK = '"Segoe UI", -apple-system, BlinkMacSystemFont, "Microsoft YaHei UI", "PingFang SC", sans-serif';
const SYSTEM_MONO_FALLBACK = 'Consolas, "Cascadia Mono", "SF Mono", monospace';

export const UI_FONT_OPTIONS: readonly FontOption<UiFontId>[] = [
  { id: 'system', label: '系统', stack: `system-ui, ${SYSTEM_SANS_FALLBACK}` },
  {
    id: 'ibm-plex-sans',
    label: 'IBM Plex Sans',
    stack: `"IBM Plex Sans", ${SYSTEM_SANS_FALLBACK}`,
    source: { packageName: '@fontsource/ibm-plex-sans', filePrefix: 'ibm-plex-sans', weights: [400, 500, 600] },
  },
  {
    id: 'inter',
    label: 'Inter',
    stack: `"Inter", ${SYSTEM_SANS_FALLBACK}`,
    source: { packageName: '@fontsource/inter', filePrefix: 'inter', weights: [400, 500, 600] },
  },
  {
    id: 'geist-sans',
    label: 'Geist Sans',
    stack: `"Geist Sans", ${SYSTEM_SANS_FALLBACK}`,
    source: { packageName: '@fontsource/geist-sans', filePrefix: 'geist-sans', weights: [400, 500, 600] },
  },
  {
    id: 'atkinson-hyperlegible',
    label: 'Atkinson Hyperlegible',
    stack: `"Atkinson Hyperlegible", ${SYSTEM_SANS_FALLBACK}`,
    source: { packageName: '@fontsource/atkinson-hyperlegible', filePrefix: 'atkinson-hyperlegible', weights: [400, 700] },
  },
  {
    id: 'source-sans-3',
    label: 'Source Sans 3',
    stack: `"Source Sans 3", ${SYSTEM_SANS_FALLBACK}`,
    source: { packageName: '@fontsource/source-sans-3', filePrefix: 'source-sans-3', weights: [400, 500, 600] },
  },
  {
    id: 'roboto',
    label: 'Roboto',
    stack: `"Roboto", ${SYSTEM_SANS_FALLBACK}`,
    source: { packageName: '@fontsource/roboto', filePrefix: 'roboto', weights: [400, 500, 600] },
  },
  {
    id: 'noto-sans',
    label: 'Noto Sans',
    stack: `"Noto Sans", ${SYSTEM_SANS_FALLBACK}`,
    source: { packageName: '@fontsource/noto-sans', filePrefix: 'noto-sans', weights: [400, 500, 600] },
  },
  {
    id: 'dm-sans',
    label: 'DM Sans',
    stack: `"DM Sans", ${SYSTEM_SANS_FALLBACK}`,
    source: { packageName: '@fontsource/dm-sans', filePrefix: 'dm-sans', weights: [400, 500, 600] },
  },
  {
    id: 'manrope',
    label: 'Manrope',
    stack: `"Manrope", ${SYSTEM_SANS_FALLBACK}`,
    source: { packageName: '@fontsource/manrope', filePrefix: 'manrope', weights: [400, 500, 600] },
  },
];



export const MONO_FONT_OPTIONS: readonly FontOption<MonoFontId>[] = [
  { id: 'system-mono', label: '系统等宽', stack: `ui-monospace, ${SYSTEM_MONO_FALLBACK}` },
  {
    id: 'ibm-plex-mono',
    label: 'IBM Plex Mono',
    stack: `"IBM Plex Mono", ${SYSTEM_MONO_FALLBACK}`,
    source: { packageName: '@fontsource/ibm-plex-mono', filePrefix: 'ibm-plex-mono', weights: [400, 500, 600] },
  },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    stack: `"JetBrains Mono", ${SYSTEM_MONO_FALLBACK}`,
    source: { packageName: '@fontsource/jetbrains-mono', filePrefix: 'jetbrains-mono', weights: [400, 500, 600] },
  },
  {
    id: 'fira-code',
    label: 'Fira Code',
    stack: `"Fira Code", ${SYSTEM_MONO_FALLBACK}`,
    source: { packageName: '@fontsource/fira-code', filePrefix: 'fira-code', weights: [400, 500, 600] },
  },
  {
    id: 'geist-mono',
    label: 'Geist Mono',
    stack: `"Geist Mono", ${SYSTEM_MONO_FALLBACK}`,
    source: { packageName: '@fontsource/geist-mono', filePrefix: 'geist-mono', weights: [400, 500, 600] },
  },
  {
    id: 'commit-mono',
    label: 'Commit Mono',
    stack: `"Commit Mono", ${SYSTEM_MONO_FALLBACK}`,
    source: { packageName: '@fontsource/commit-mono', filePrefix: 'commit-mono', weights: [400, 500, 600] },
  },
  {
    id: 'source-code-pro',
    label: 'Source Code Pro',
    stack: `"Source Code Pro", ${SYSTEM_MONO_FALLBACK}`,
    source: { packageName: '@fontsource/source-code-pro', filePrefix: 'source-code-pro', weights: [400, 500, 600] },
  },
  {
    id: 'cascadia-code',
    label: 'Cascadia Code',
    stack: `"Cascadia Code", ${SYSTEM_MONO_FALLBACK}`,
    source: { packageName: '@fontsource/cascadia-code', filePrefix: 'cascadia-code', weights: [400, 500, 600] },
  },
  {
    id: 'roboto-mono',
    label: 'Roboto Mono',
    stack: `"Roboto Mono", ${SYSTEM_MONO_FALLBACK}`,
    source: { packageName: '@fontsource/roboto-mono', filePrefix: 'roboto-mono', weights: [400, 500, 600] },
  },
  {
    id: 'iosevka',
    label: 'Iosevka',
    stack: `"Iosevka", ${SYSTEM_MONO_FALLBACK}`,
    source: { packageName: '@fontsource/iosevka', filePrefix: 'iosevka', weights: [400, 500, 600] },
  },
];

/**
 * 界面字体下拉的可选项：无衬线在前、等宽在后。
 * 【设计意图 (Why)】正文要不要用等宽是个人口味，只有放进同一个下拉才能直接对比。
 * 【约束与规则 (Rules)】等宽条目必须复用 MONO_FONT_OPTIONS，禁止复制一份字体栈，否则两处会漂移。
 *   用函数而非顶层常量，避免依赖 MONO_FONT_OPTIONS 的定义顺序。
 */
export function getUiFontSelectOptions(): readonly FontOption<UiFontId>[] {
  return [...UI_FONT_OPTIONS, ...MONO_FONT_OPTIONS];
}

/** 出厂默认：与用户实际偏好一致，界面字体与等宽字体都走系统栈。 */
export const DEFAULT_UI_FONT: UiFontId = 'system';
export const DEFAULT_MONO_FONT: MonoFontId = 'system-mono';

/** 字号语义档：正文、代码、界面标签、元数据、辅助文字。 */
export const TYPOGRAPHY_TOKENS = {
  markdown: '15px',
  code: '13px',
  uiLabel: '14px',
  meta: '13px',
  micro: '12px',
  caption: '11px',
} as const;

export const FONT_SIZE_SCALE_OPTIONS = {
  small: 0.9,
  medium: 1,
  large: 1.12,
} as const;

export type FontSizeScale = keyof typeof FONT_SIZE_SCALE_OPTIONS;

export function resolveFontStack<T extends string>(
  options: readonly FontOption<T>[],
  id: T,
  fallback: T
): string {
  const hit = options.find((option) => option.id === id);
  return (hit ?? options.find((option) => option.id === fallback))!.stack;
}
