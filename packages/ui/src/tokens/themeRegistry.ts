/**
 * Hermes Flux Extensible Theme Registry (v5.0 OpenChamber Architecture)
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
      bgWindow: '#0E0F12',
      bgRail: '#090A0D',
      bgPanel: '#111317',
      bgCard: '#14161C',
      bgCardHover: '#1A1D24',
      bgCardActive: '#20232B',
      bgElevated: '#161821',
      bgInput: '#121419',
      bgCode: '#090A0D',
      bgBackdrop: 'rgba(18, 20, 27, 0.90)',

      accent: '#D97706',
      accentHover: '#E58A13',
      accentDim: '#B45309',
      accentGlow: 'rgba(217, 119, 6, 0.20)',
      accentSubtle: 'rgba(217, 119, 6, 0.08)',
      accentBorder: 'rgba(217, 119, 6, 0.28)',
      accentText: '#FDE68A',

      textMain: '#F7F8F8',
      textSecondary: '#8A8F98',
      textMuted: '#5C6068',
      textFaint: '#3F434C',

      borderSubtle: 'rgba(255, 255, 255, 0.07)',
      borderMedium: 'rgba(255, 255, 255, 0.12)',
      borderStrong: 'rgba(255, 255, 255, 0.18)',

      shadowWindow: '0 24px 70px -12px rgba(0, 0, 0, 0.85)',
      shadowCard: '0 4px 20px rgba(0, 0, 0, 0.45)',
      shadowDock: '0 20px 48px -10px rgba(0, 0, 0, 0.75)',

      jadePulse: '#10B981',
      jadeGlow: 'rgba(16, 185, 129, 0.45)',
    },
  },
  'jade-white': {
    id: 'jade-white',
    name: '极简冷灰',
    variant: 'light',
    colors: {
      bgWindow: '#F8FAFC',
      bgRail: '#F1F5F9',
      bgPanel: '#EAEFF5',
      bgCard: '#FFFFFF',
      bgCardHover: '#F1F5F9',
      bgCardActive: '#E2E8F0',
      bgElevated: '#FFFFFF',
      bgInput: '#FFFFFF',
      bgCode: '#F8FAFC',
      bgBackdrop: 'rgba(248, 250, 252, 0.92)',

      accent: '#0D7A5E',
      accentHover: '#0B6850',
      accentDim: '#095743',
      accentGlow: 'rgba(13, 122, 94, 0.18)',
      accentSubtle: 'rgba(13, 122, 94, 0.08)',
      accentBorder: 'rgba(13, 122, 94, 0.28)',
      accentText: '#08523F',

      textMain: '#0F172A',
      textSecondary: '#334155',
      textMuted: '#64748B',
      textFaint: '#94A3B8',

      borderSubtle: 'rgba(15, 23, 42, 0.08)',
      borderMedium: 'rgba(15, 23, 42, 0.14)',
      borderStrong: 'rgba(15, 23, 42, 0.22)',

      shadowWindow: '0 24px 60px -12px rgba(15, 23, 42, 0.12)',
      shadowCard: '0 2px 8px rgba(15, 23, 42, 0.04)',
      shadowDock: '0 16px 40px -10px rgba(15, 23, 42, 0.10)',

      jadePulse: '#10B981',
      jadeGlow: 'rgba(16, 185, 129, 0.40)',
    },
  },
  'ayu-light': {
    id: 'ayu-light',
    name: 'Ayu 晨曦',
    variant: 'light',
    colors: {
      bgWindow: '#FAF9F8',
      bgRail: '#F4F4F3',
      bgPanel: '#EDEDEC',
      bgCard: '#FFFFFF',
      bgCardHover: '#EFEFEF',
      bgCardActive: '#E8E8E7',
      bgElevated: '#FFFFFF',
      bgInput: '#FFFFFF',
      bgCode: '#F4F4F3',
      bgBackdrop: 'rgba(250, 249, 248, 0.92)',

      accent: '#4AA8C8',
      accentHover: '#6EB8D1',
      accentDim: '#4394B0',
      accentGlow: 'rgba(74, 168, 200, 0.20)',
      accentSubtle: 'rgba(74, 168, 200, 0.08)',
      accentBorder: 'rgba(74, 168, 200, 0.35)',
      accentText: '#2F9BCE',

      textMain: '#24292F',
      textSecondary: '#57606A',
      textMuted: '#6E7781',
      textFaint: '#AFB8C1',

      borderSubtle: '#E4E4E2',
      borderMedium: '#D8D8D6',
      borderStrong: '#8C8C8A',

      shadowWindow: '0 20px 50px -10px rgba(36, 41, 47, 0.08)',
      shadowCard: '0 1px 3px rgba(36, 41, 47, 0.04), 0 0 0 1px #E4E4E2',
      shadowDock: '0 12px 32px -4px rgba(36, 41, 47, 0.07), 0 2px 8px rgba(36, 41, 47, 0.03)',

      jadePulse: '#5FB978',
      jadeGlow: 'rgba(95, 185, 120, 0.40)',
    },
  },
  'warm-paper': {
    id: 'warm-paper',
    name: '经典暖白',
    variant: 'light',
    colors: {
      bgWindow: '#F9F9F8',
      bgRail: '#F4F4F1',
      bgPanel: '#EEEDE8',
      bgCard: '#FFFFFF',
      bgCardHover: '#ECEBE5',
      bgCardActive: '#FFFFFF',
      bgElevated: '#FFFFFF',
      bgInput: '#FFFFFF',
      bgCode: '#F6F8FA',
      bgBackdrop: 'rgba(249, 249, 248, 0.90)',

      accent: '#2563EB',
      accentHover: '#1D4ED8',
      accentDim: '#1E40AF',
      accentGlow: 'rgba(37, 99, 235, 0.16)',
      accentSubtle: 'rgba(37, 99, 235, 0.08)',
      accentBorder: 'rgba(37, 99, 235, 0.28)',
      accentText: '#1D4ED8',

      textMain: '#1F2328',
      textSecondary: '#57606A',
      textMuted: '#8C959F',
      textFaint: '#AFB8C1',

      borderSubtle: 'rgba(31, 35, 40, 0.08)',
      borderMedium: 'rgba(31, 35, 40, 0.14)',
      borderStrong: 'rgba(31, 35, 40, 0.22)',

      shadowWindow: '0 20px 50px -10px rgba(31, 35, 40, 0.08)',
      shadowCard: '0 1px 3px rgba(31, 35, 40, 0.04), 0 0 0 1px rgba(31, 35, 40, 0.06)',
      shadowDock: '0 12px 32px -4px rgba(31, 35, 40, 0.06), 0 2px 8px rgba(31, 35, 40, 0.04)',

      jadePulse: '#10B981',
      jadeGlow: 'rgba(16, 185, 129, 0.40)',
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
  let styleEl = document.getElementById('flux-skin-variables') as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'flux-skin-variables';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `
    [data-theme="${skin.id}"],
    :root[data-theme="${skin.id}"] {
      ${generateSkinCssVariables(skin)}
    }

    @keyframes jadePulse {
      0%, 100% {
        transform: scale(1);
        opacity: 0.85;
      }
      50% {
        transform: scale(1.35);
        opacity: 1;
      }
    }
  `;
  document.documentElement.setAttribute('data-theme', skin.id);
  document.documentElement.setAttribute('data-variant', skin.variant);
}

/**
 * Resolves the next theme when toggling the quick theme button.
 * Smoothly transitions between dark and the primary light theme ('ayu-light').
 */
export function getNextToggleTheme(currentTheme: string): 'obsidian-gold' | 'ayu-light' {
  const isLightNow =
    currentTheme === 'ayu-light' ||
    currentTheme === 'warm-paper' ||
    currentTheme === 'jade-white' ||
    currentTheme === 'suet-jade';
  return isLightNow ? 'obsidian-gold' : 'ayu-light';
}
