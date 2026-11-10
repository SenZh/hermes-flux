/*
 * Gallery 审查入口（仅人工打开用，不进入生产挂载点）。
 *
 * 设计意图(Why)：
 *   给截图审查提供一条最小启动路径：宿主 HTML 只需一个 #root，本文件负责应用字体偏好、
 *   暴露偏好入口，再 createRoot 渲染样例页。
 *   之所以在渲染前先跑一次 applyFontPreferences，是因为"字体是否真的跟随设置"只能在
 *   真实内核里由计算样式证明；如果只把字体写在 CSS 里，验证不到用户改设置这条链路。
 *
 * 防范的历史坑(Pitfall)：
 *   直接写 `document.getElementById('root')!` 会引入非空断言，一旦宿主 id 改名，
 *   运行时报的是"Cannot read properties of null (reading 'render')"这种与根因无关的错误；
 *   这里改为显式判空，宿主缺失时什么也不做，问题停在"有没有 #root"这一层。
 *
 * 约束与规则(Rules)：
 *   1. 本文件不是库导出，禁止被 src/index.ts 或任何 mount-* 引用；
 *   2. 只允许一次 createRoot，禁止在渲染中重复创建；
 *   3. 暴露到 window 的 __fluxApplyFont 只用于验证器模拟"用户在设置里换字体"，不参与业务。
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { applyFontPreferences, type FontPreferences } from '../../tokens/fontPreferences.js';
import { Gallery } from './Gallery.js';

declare global {
  interface Window {
    /** 验证器用它模拟设置页的字体切换，证明组件会跟随而不是各自写死。 */
    __fluxApplyFont?: (prefs: FontPreferences) => void;
  }
}

/** 截图基线所用的字体组合：两个非系统字体，能一眼看出字体是否真的被应用。 */
export const GALLERY_FONT_PREFS: FontPreferences = {
  uiFont: 'inter',
  monoFont: 'jetbrains-mono',
  sizeScale: 'medium',
};

applyFontPreferences(GALLERY_FONT_PREFS);
window.__fluxApplyFont = applyFontPreferences;

const host = document.getElementById('root');
if (host) {
  createRoot(host).render(<Gallery />);
}
