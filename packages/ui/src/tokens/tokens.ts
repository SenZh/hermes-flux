/**
 * Hermes Aura Design Tokens
 * Conforming strictly to desktop-design-system-spec.md (v3.0-Director Masterpiece)
 */

export const THEME_OBSIDIAN_GOLD = {
  name: 'obsidian-gold',
  label: '黑曜琥珀',
  bgWindow: '#090A0F',
  bgRail: '#0E1015',
  bgPanel: '#111318',
  bgCard: '#151720',
  bgCardHover: '#1B1E29',
  bgCardActive: '#222634',
  bgElevated: '#1F2230',
  bgInput: '#12141A',
  bgCode: '#0A0B10',
  bgBackdrop: 'rgba(18, 20, 27, 0.88)',

  accent: '#F59E0B',
  accentHover: '#FBBF24',
  accentDim: '#D97706',
  accentGlow: 'rgba(245, 158, 11, 0.25)',
  accentSubtle: 'rgba(245, 158, 11, 0.09)',
  accentBorder: 'rgba(245, 158, 11, 0.35)',
  accentText: '#FEF3C7',

  textMain: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textFaint: '#334155',

  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  borderMedium: 'rgba(255, 255, 255, 0.09)',
  borderStrong: 'rgba(255, 255, 255, 0.16)',
  specularLine: 'inset 0 1px 0 0 rgba(255, 255, 255, 0.10)',

  shadowWindow: '0 24px 70px -12px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.07)',
  shadowCard: '0 4px 20px rgba(0, 0, 0, 0.45)',
  shadowDock: '0 20px 48px -10px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.09)',

  jadePulse: '#10B981',
  jadeGlow: 'rgba(16, 185, 129, 0.45)',
};

export const THEME_JADE_WHITE = {
  name: 'jade-white',
  label: '羊脂白玉',
  bgWindow: '#F4F5F7',
  bgRail: '#ECEEF2',
  bgPanel: '#FFFFFF',
  bgCard: '#FFFFFF',
  bgCardHover: '#F8FAFC',
  bgCardActive: '#F1F5F9',
  bgElevated: '#FFFFFF',
  bgInput: '#FAFAFA',
  bgCode: '#F8FAFC',
  bgBackdrop: 'rgba(255, 255, 255, 0.92)',

  accent: '#0D9488',
  accentHover: '#14B8A6',
  accentDim: '#0F766E',
  accentGlow: 'rgba(13, 148, 136, 0.20)',
  accentSubtle: 'rgba(13, 148, 136, 0.08)',
  accentBorder: 'rgba(13, 148, 136, 0.35)',
  accentText: '#134E4A',

  textMain: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#64748B',
  textFaint: '#CBD5E1',

  borderSubtle: 'rgba(0, 0, 0, 0.06)',
  borderMedium: 'rgba(0, 0, 0, 0.09)',
  borderStrong: 'rgba(0, 0, 0, 0.16)',
  specularLine: 'inset 0 1px 0 0 rgba(255, 255, 255, 0.80)',

  shadowWindow: '0 24px 60px -12px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.08)',
  shadowCard: '0 2px 12px rgba(15, 23, 42, 0.06)',
  shadowDock: '0 16px 40px -10px rgba(15, 23, 42, 0.14), 0 0 0 1px rgba(0, 0, 0, 0.08)',

  jadePulse: '#059669',
  jadeGlow: 'rgba(5, 150, 105, 0.40)',
};

export const DIMENSIONS = {
  titlebarHeight: 42,
  leftRailWidth: 260,
  inspectorWidth: 410,
  inspectorRailWidth: 62,
  inspectorDetailWidth: 348,
  statusBarHeight: 22,
  inputDockMaxWidth: 740,
  conversationPaddingBottom: 180,
  dockScrimFadeHeight: 120,
  radiusWindow: 14,
  radiusCard: 10,
  radiusInner: 6,
  radiusPill: 9999,
};
