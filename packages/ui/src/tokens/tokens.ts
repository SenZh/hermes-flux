/**
 * Hermes Flux Design Tokens
 * Conforming strictly to desktop-design-system-spec.md (v3.0-Director Masterpiece)
 * DIMENSIONS 常量保留待波③几何单源时收编
 */

export const DIMENSIONS = {
  // 用户 2026-11-20 二次裁决：顶栏内容高 36 → 32（28px 按钮 + 上下各 2px 呼吸）。
  // 必须与 styles.css 的 --geo-titlebar 同值；含 1px 下边框后外围总高 = 33px。
  titlebarHeight: 32,
  leftRailWidth: 264,
  inspectorWidth: 410,
  inspectorRailWidth: 62,
  inspectorDetailWidth: 348,
  statusBarHeight: 0,
  inputDockMaxWidth: 740,
  conversationPaddingBottom: 180,
  dockScrimFadeHeight: 100,
  radiusWindow: 12,
  radiusCard: 6,
  radiusInner: 4,
  radiusPill: 9999,
};

