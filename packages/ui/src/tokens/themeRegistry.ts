/**
 * Hermes Aura Extensible Theme Registry (v5.0 OpenChamber Architecture)
 * Provides schema-validated, hot-swappable skin definitions without touching hardcoded CSS.
 */

export interface SkinDefinition {
  id: string;
  name: string;
  variant: 'dark' | 'light';
  colors: {
    bgWindow: string;
    bgRail: string;
    bgPanel: string;
    bgCard: string;
    bgCardHover: string;
    bgCardActive: string;
    bgElevated: string;
    bgInput: string;
    bgCode: string;
    bgBackdrop: string;

    accent: string;
    accentHover: string;
    accentDim: string;
    accentGlow: string;
    accentSubtle: string;
    accentBorder: string;
    accentText: string;

    textMain: string;
    textSecondary: string;
    textMuted: string;
    textFaint: string;

    borderSubtle: string;
    borderMedium: string;
    borderStrong: string;

    shadowWindow: string;
    shadowCard: string;
    shadowDock: string;

    jadePulse: string;
    jadeGlow: string;
  };
}

export const BUILTIN_SKINS: Record<string, SkinDefinition> = {
  'obsidian-gold': {
    id: 'obsidian-gold',
    name: '黑曜琥珀',
    variant: 'dark',
    colors: {
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

      shadowWindow: '0 24px 70px -12px rgba(0, 0, 0, 0.85)',
      shadowCard: '0 4px 20px rgba(0, 0, 0, 0.45)',
      shadowDock: '0 20px 48px -10px rgba(0, 0, 0, 0.75)',

      jadePulse: '#10B981',
      jadeGlow: 'rgba(16, 185, 129, 0.45)',
    },
  },
  'jade-white': {
    id: 'jade-white',
    name: '羊脂白玉',
    variant: 'light',
    colors: {
      bgWindow: '#F4F6F9',
      bgRail: '#E9ECF2',
      bgPanel: '#FAFAFC',
      bgCard: '#FFFFFF',
      bgCardHover: '#F1F4F9',
      bgCardActive: '#E5E9F2',
      bgElevated: '#FFFFFF',
      bgInput: '#FFFFFF',
      bgCode: '#F4F6FA',
      bgBackdrop: 'rgba(255, 255, 255, 0.92)',

      accent: '#0D7A5E',
      accentHover: '#0B6850',
      accentDim: '#095743',
      accentGlow: 'rgba(13, 122, 94, 0.20)',
      accentSubtle: 'rgba(13, 122, 94, 0.08)',
      accentBorder: 'rgba(13, 122, 94, 0.32)',
      accentText: '#08523F',

      textMain: '#0F172A',
      textSecondary: '#475569',
      textMuted: '#64748B',
      textFaint: '#94A3B8',

      borderSubtle: 'rgba(0, 0, 0, 0.06)',
      borderMedium: 'rgba(0, 0, 0, 0.10)',
      borderStrong: 'rgba(0, 0, 0, 0.18)',

      shadowWindow: '0 24px 60px -12px rgba(15, 23, 42, 0.18)',
      shadowCard: '0 2px 12px rgba(15, 23, 42, 0.06)',
      shadowDock: '0 16px 40px -10px rgba(15, 23, 42, 0.14)',

      jadePulse: '#059669',
      jadeGlow: 'rgba(5, 150, 105, 0.40)',
    },
  },
  'cyber-matrix': {
    id: 'cyber-matrix',
    name: '赛博冷翠',
    variant: 'dark',
    colors: {
      bgWindow: '#080C0A',
      bgRail: '#0B120E',
      bgPanel: '#0E1712',
      bgCard: '#121D17',
      bgCardHover: '#18271F',
      bgCardActive: '#1F3329',
      bgElevated: '#17241D',
      bgInput: '#0E1712',
      bgCode: '#080C0A',
      bgBackdrop: 'rgba(14, 23, 18, 0.90)',

      accent: '#00E5FF',
      accentHover: '#33EBFF',
      accentDim: '#00B8CC',
      accentGlow: 'rgba(0, 229, 255, 0.25)',
      accentSubtle: 'rgba(0, 229, 255, 0.09)',
      accentBorder: 'rgba(0, 229, 255, 0.35)',
      accentText: '#E0FCFF',

      textMain: '#ECFDF5',
      textSecondary: '#86EFAC',
      textMuted: '#4ADE80',
      textFaint: '#166534',

      borderSubtle: 'rgba(74, 222, 128, 0.12)',
      borderMedium: 'rgba(74, 222, 128, 0.20)',
      borderStrong: 'rgba(74, 222, 128, 0.35)',

      shadowWindow: '0 24px 70px -12px rgba(0, 0, 0, 0.95)',
      shadowCard: '0 4px 20px rgba(0, 0, 0, 0.65)',
      shadowDock: '0 20px 48px -10px rgba(0, 0, 0, 0.85)',

      jadePulse: '#10B981',
      jadeGlow: 'rgba(16, 185, 129, 0.50)',
    },
  },
};

/** Generates standard CSS variable declarations for a given SkinDefinition */
export function generateSkinCssVariables(skin: SkinDefinition): string {
  const c = skin.colors;
  return `
    --bg-window: ${c.bgWindow};
    --bg-rail: ${c.bgRail};
    --bg-panel: ${c.bgPanel};
    --bg-card: ${c.bgCard};
    --bg-card-hover: ${c.bgCardHover};
    --bg-card-active: ${c.bgCardActive};
    --bg-elevated: ${c.bgElevated};
    --bg-input: ${c.bgInput};
    --bg-code: ${c.bgCode};
    --bg-backdrop: ${c.bgBackdrop};

    --accent: ${c.accent};
    --accent-hover: ${c.accentHover};
    --accent-dim: ${c.accentDim};
    --accent-glow: ${c.accentGlow};
    --accent-subtle: ${c.accentSubtle};
    --accent-border: ${c.accentBorder};
    --accent-text: ${c.accentText};

    --text-main: ${c.textMain};
    --text-secondary: ${c.textSecondary};
    --text-muted: ${c.textMuted};
    --text-faint: ${c.textFaint};

    --border-subtle: ${c.borderSubtle};
    --border-medium: ${c.borderMedium};
    --border-strong: ${c.borderStrong};

    --shadow-window: ${c.shadowWindow};
    --shadow-card: ${c.shadowCard};
    --shadow-dock: ${c.shadowDock};

    --jade-pulse: ${c.jadePulse};
    --jade-glow: ${c.jadeGlow};
  `;
}

/** Injects or updates active skin CSS variables directly into document head */
export function applySkinToDom(skin: SkinDefinition): void {
  if (typeof document === 'undefined') return;
  let styleEl = document.getElementById('aura-skin-variables') as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'aura-skin-variables';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `
    [data-theme="${skin.id}"],
    :root[data-theme="${skin.id}"] {
      ${generateSkinCssVariables(skin)}
    }
  `;
  document.documentElement.setAttribute('data-theme', skin.id);
  document.documentElement.setAttribute('data-variant', skin.variant);
}
