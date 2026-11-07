/**
 * 字体偏好：读取、持久化、应用到 :root（对标 OpenChamber useAppFontEffects）。
 *
 * 设计意图(Why)：
 *   偏好改动必须立刻生效，所以应用函数直接写 :root 的 CSS 变量，
 *   不依赖组件重渲染。对话区与左侧栏都消费同一组变量，天然同源。
 *
 * 防范的历史坑(Pitfall)：
 *   localStorage 在隐私模式下读写会抛错，必须降级为默认值而不是让启动失败。
 *
 * 约束与规则(Rules)：
 *   1. 存储键统一使用 hermes_flux_* 前缀，与既有偏好保持一致；
 *   2. 非法或缺失的值一律回落到默认值，禁止把脏数据写进 CSS；
 *   3. applyFontPreferences 是纯副作用函数，可被设置页直接调用。
 */

import {
  DEFAULT_MONO_FONT,
  DEFAULT_UI_FONT,
  FONT_SIZE_SCALE_OPTIONS,
  MONO_FONT_OPTIONS,
  TYPOGRAPHY_TOKENS,
  UI_FONT_OPTIONS,
  getUiFontSelectOptions,
  resolveFontStack,
  type FontOption,
  type FontSizeScale,
  type MonoFontId,
  type UiFontId,
} from './fonts.js';

const registeredFaces = new Set<string>();

/**
 * 字体文件所在目录。FontFace 的 src 相对于页面地址解析，不同于 CSS 相对于样式表解析，
 * 所以不能写死 "fonts/"：直跑页面（根路径 /）与 Electron 的 renderer 目录位置不同。
 * 这里以已加载的 styles.css 地址为基准，保证与构建产物位置一致。
 */
function resolveFontBaseUrl(): string {
  const sheet = typeof document === 'undefined'
    ? undefined
    : document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="styles.css"]');
  const href = sheet?.getAttribute('href') ?? 'styles.css';
  return new URL(`fonts/`, new URL(href, typeof location === 'undefined' ? 'file:///' : location.href)).href;
}

/**
 * 按需注册所选字体的 woff2。只有被选中的字体才会下载，避免启动时一次拉取全部 20 套字体。
 * 文件路径与 build.mjs 拷贝的位置一致（renderer/fonts/<prefix>-latin-<weight>-normal.woff2）。
 */
function ensureFontFaces<T extends string>(option: FontOption<T>): void {
  const source = option.source;
  if (!source || typeof document === 'undefined' || !document.fonts) return;
  const baseUrl = resolveFontBaseUrl();
  // 去重键用 packageName（稳定），不用 family 显示名：family 可能带引号，同一字体会被重复注册
  for (const weight of source.weights) {
    const key = `${source.packageName}:${weight}`;
    if (registeredFaces.has(key)) continue;
    registeredFaces.add(key);
    const face = new FontFace(
      option.label,
      `url('${baseUrl}${source.filePrefix}-latin-${weight}-normal.woff2') format('woff2')`,
      { style: 'normal', weight: String(weight), display: 'swap' }
    );
    document.fonts.add(face);
    face.load().catch(() => {
      // 加载失败：从 FontSet 移除失败实例并允许下次重试，栈中的系统字体继续生效
      document.fonts.delete(face);
      registeredFaces.delete(key);
    });
  }
}

export interface FontPreferences {
  uiFont: UiFontId;
  monoFont: MonoFontId;
  sizeScale: FontSizeScale;
}

export const FONT_PREFERENCE_KEYS = {
  uiFont: 'hermes_flux_font_ui',
  monoFont: 'hermes_flux_font_mono',
  sizeScale: 'hermes_flux_font_size_scale',
} as const;

export const DEFAULT_FONT_PREFERENCES: FontPreferences = {
  uiFont: DEFAULT_UI_FONT,
  monoFont: DEFAULT_MONO_FONT,
  sizeScale: 'medium',
};

function readStorage(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  // gate-degrade: localStorage 在隐私模式下读取会抛错，降级为默认偏好属可选增强失败
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  // gate-degrade: 隐私模式写入失败时偏好只在本次会话生效，不阻断界面
  } catch {
    // 写入失败不影响当前渲染
  }
}

export function loadFontPreferences(): FontPreferences {
  const uiRaw = readStorage(FONT_PREFERENCE_KEYS.uiFont);
  const monoRaw = readStorage(FONT_PREFERENCE_KEYS.monoFont);
  const scaleRaw = readStorage(FONT_PREFERENCE_KEYS.sizeScale);

  return {
    // 界面字体下拉包含等宽项，校验必须用合并后的全集，否则选中的等宽会被判非法而回落
    uiFont: getUiFontSelectOptions().some((o) => o.id === uiRaw) ? (uiRaw as UiFontId) : DEFAULT_UI_FONT,
    monoFont: MONO_FONT_OPTIONS.some((o) => o.id === monoRaw) ? (monoRaw as MonoFontId) : DEFAULT_MONO_FONT,
    sizeScale: scaleRaw && scaleRaw in FONT_SIZE_SCALE_OPTIONS ? (scaleRaw as FontSizeScale) : 'medium',
  };
}

export function saveFontPreferences(prefs: FontPreferences): void {
  writeStorage(FONT_PREFERENCE_KEYS.uiFont, prefs.uiFont);
  writeStorage(FONT_PREFERENCE_KEYS.monoFont, prefs.monoFont);
  writeStorage(FONT_PREFERENCE_KEYS.sizeScale, prefs.sizeScale);
}

function scalePx(base: string, factor: number): string {
  const value = Number.parseFloat(base) * factor;
  return `${Math.round(value * 10) / 10}px`;
}

/** 把偏好写入 :root。字号档位以乘数形式作用于 TYPOGRAPHY_TOKENS 的基准值。 */
export function applyFontPreferences(prefs: FontPreferences, root: HTMLElement = document.documentElement): void {
  const factor = FONT_SIZE_SCALE_OPTIONS[prefs.sizeScale];
  const uiOptions = getUiFontSelectOptions();
  const uiOption = uiOptions.find((o) => o.id === prefs.uiFont) ?? UI_FONT_OPTIONS[0];
  const monoOption = MONO_FONT_OPTIONS.find((o) => o.id === prefs.monoFont) ?? MONO_FONT_OPTIONS[0];
  ensureFontFaces(uiOption);
  ensureFontFaces(monoOption);
  const uiStack = resolveFontStack(uiOptions, prefs.uiFont, DEFAULT_UI_FONT);
  const monoStack = resolveFontStack(MONO_FONT_OPTIONS, prefs.monoFont, DEFAULT_MONO_FONT);

  root.style.setProperty('--font-sans', uiStack);
  root.style.setProperty('--font-mono', monoStack);
  root.style.setProperty('--text-markdown', scalePx(TYPOGRAPHY_TOKENS.markdown, factor));
  root.style.setProperty('--text-code', scalePx(TYPOGRAPHY_TOKENS.code, factor));
  root.style.setProperty('--text-ui-label', scalePx(TYPOGRAPHY_TOKENS.uiLabel, factor));
  root.style.setProperty('--text-meta', scalePx(TYPOGRAPHY_TOKENS.meta, factor));
  root.style.setProperty('--text-micro', scalePx(TYPOGRAPHY_TOKENS.micro, factor));
}
