import test from 'node:test';
import assert from 'node:assert/strict';

test('Design System Tokens & Architectural Invariant Guardrails (Gate 4)', async (t) => {
  const { BUILTIN_SKINS, generateSkinCssVariables } = await import('../dist/tokens/themeRegistry.js');

  await t.test('All built-in skins must provide the complete 29-color token contract', () => {
    const requiredKeys = [
      'bgWindow',
      'bgRail',
      'bgPanel',
      'bgCard',
      'bgCardHover',
      'bgCardActive',
      'bgElevated',
      'bgInput',
      'bgCode',
      'bgBackdrop',
      'accent',
      'accentHover',
      'accentDim',
      'accentGlow',
      'accentSubtle',
      'accentBorder',
      'accentText',
      'textMain',
      'textSecondary',
      'textMuted',
      'textFaint',
      'borderSubtle',
      'borderMedium',
      'borderStrong',
      'shadowWindow',
      'shadowCard',
      'shadowDock',
      'jadePulse',
      'jadeGlow',
    ];

    const skinIds = Object.keys(BUILTIN_SKINS);
    assert.ok(skinIds.length >= 2, 'Must have at least dark and light skins registered');

    for (const id of skinIds) {
      const skin = BUILTIN_SKINS[id];
      assert.ok(skin.id, `Skin ${id} must declare id`);
      assert.ok(skin.name, `Skin ${id} must declare display name`);
      assert.ok(['dark', 'light'].includes(skin.variant), `Skin ${id} variant must be dark or light`);

      for (const key of requiredKeys) {
        assert.ok(
          typeof skin.colors[key] === 'string' && skin.colors[key].trim().length > 0,
          `Skin ${id} is missing mandatory token: ${key}`
        );
      }
    }
  });

  await t.test('CSS variable generation must emit all semantic CSS properties without undefined', () => {
    const expectedCssVars = [
      '--bg-window:',
      '--bg-rail:',
      '--bg-panel:',
      '--bg-card:',
      '--bg-elevated:',
      '--bg-input:',
      '--bg-code:',
      '--bg-backdrop:',
      '--accent:',
      '--accent-hover:',
      '--accent-glow:',
      '--accent-subtle:',
      '--accent-border:',
      '--accent-text:',
      '--text-main:',
      '--text-secondary:',
      '--text-muted:',
      '--text-faint:',
      '--border-subtle:',
      '--border-medium:',
      '--border-strong:',
      '--shadow-window:',
      '--shadow-card:',
      '--shadow-dock:',
      '--jade-pulse:',
      '--jade-glow:',
    ];

    for (const [id, skin] of Object.entries(BUILTIN_SKINS)) {
      const css = generateSkinCssVariables(skin);
      assert.ok(!css.includes('undefined'), `Skin ${id} CSS output must not contain undefined`);
      assert.ok(!css.includes('null'), `Skin ${id} CSS output must not contain null`);

      for (const cssVar of expectedCssVars) {
        assert.ok(css.includes(cssVar), `Skin ${id} must generate CSS variable ${cssVar}`);
      }
    }
  });

  await t.test('Color contrast polarity invariant (dark skins use light text, light skins use dark text)', () => {
    const darkSkin = BUILTIN_SKINS['obsidian-gold'];
    const lightSkin = BUILTIN_SKINS['jade-white'];

    // Dark skin text should be light hex
    assert.match(darkSkin.colors.textMain, /^#(F|E|D)/i, 'Dark skin textMain must be light high-contrast color');
    // Dark skin window background should be dark hex
    assert.match(darkSkin.colors.bgWindow, /^#(0|1)/i, 'Dark skin bgWindow must be deep dark color');

    // Light skin text should be dark hex
    assert.match(lightSkin.colors.textMain, /^#(0|1|2)/i, 'Light skin textMain must be dark high-contrast color');
    // Light skin window background should be light hex
    assert.match(lightSkin.colors.bgWindow, /^#(F|E)/i, 'Light skin bgWindow must be light paper color');
  });
});
