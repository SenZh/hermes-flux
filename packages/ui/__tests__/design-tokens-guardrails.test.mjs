import test from 'node:test';
import assert from 'node:assert/strict';

test('Design System Tokens & Architectural Invariant Guardrails (Gate 4)', async (t) => {
  const { SKINS, SLOT_IDS, BADGE_LANGS, BADGE_PALETTES } = await import('../dist/tokens/skins.js');

  await t.test('All built-in skins must provide the complete 43-slot token contract', () => {
    assert.equal(SLOT_IDS.length, 43, 'SLOT_IDS must have exactly 43 semantic slots');

    const skinIds = Object.keys(SKINS);
    assert.ok(skinIds.length >= 2, 'Must have at least dark and light skins registered');

    for (const id of skinIds) {
      const skin = SKINS[id];
      assert.ok(skin.label, `Skin ${id} must declare label`);
      assert.ok(['dark', 'light'].includes(skin.variant), `Skin ${id} variant must be dark or light`);

      for (const slotId of SLOT_IDS) {
        assert.ok(
          typeof skin.slots[slotId] === 'string' && skin.slots[slotId].trim().length > 0,
          `Skin ${id} is missing mandatory slot: ${slotId}`
        );
      }

      const badgeVal = skin.slots['badge-palette'];
      if (badgeVal === 'none') {
        assert.equal(badgeVal, 'none', `Skin ${id} badge-palette is none`);
      } else {
        const palette = BADGE_PALETTES[badgeVal];
        assert.ok(palette, `Skin ${id} references unknown palette: ${badgeVal}`);
        for (const lang of BADGE_LANGS) {
          assert.ok(palette[lang], `Palette ${badgeVal} must define badge lang ${lang}`);
          assert.ok(palette[lang].bg, `Palette ${badgeVal} ${lang} missing bg`);
          assert.ok(palette[lang].text, `Palette ${badgeVal} ${lang} missing text`);
          assert.ok(palette[lang].border, `Palette ${badgeVal} ${lang} missing border`);
        }
      }
    }
  });

  await t.test('CSS variable slot definitions must be complete without undefined or null', () => {
    const expectedSlots = [
      '--background',
      '--sidebar',
      '--panel',
      '--card',
      '--popover',
      '--input',
      '--code',
      '--backdrop',
      '--primary',
      '--primary-hover',
      '--primary-glow',
      '--primary-subtle',
      '--primary-border',
      '--primary-foreground',
      '--foreground',
      '--secondary-foreground',
      '--muted-foreground',
      '--faint',
      '--border',
      '--border-subtle',
      '--border-strong',
      '--shadow-window',
      '--shadow-card',
      '--shadow-dock',
      '--success',
      '--success-glow',
    ];

    for (const [id, skin] of Object.entries(SKINS)) {
      for (const [slotKey, val] of Object.entries(skin.slots)) {
        assert.ok(val !== undefined, `Skin ${id} slot ${slotKey} must not be undefined`);
        assert.ok(val !== null, `Skin ${id} slot ${slotKey} must not be null`);
      }

      for (const slotKey of expectedSlots) {
        assert.ok(skin.slots[slotKey], `Skin ${id} must contain slot ${slotKey}`);
      }
    }
  });

  await t.test('Color contrast polarity invariant (dark skins use light text, light skins use dark text)', () => {
    const darkSkin = SKINS['obsidian-gold'];
    const lightSkin = SKINS['jade-white'];
    const ayuLight = SKINS['ayu-light'];
    const warmPaper = SKINS['warm-paper'];
    const cyberMatrix = SKINS['cyber-matrix'];

    // Dark skin text should be light hex
    assert.match(darkSkin.slots['--foreground'], /^#(F|E|D)/i, 'Dark skin foreground must be light high-contrast color');
    // Dark skin window background should be dark hex
    assert.match(darkSkin.slots['--background'], /^#(0|1)/i, 'Dark skin background must be deep dark color');

    assert.match(cyberMatrix.slots['--foreground'], /^#(F|E|D)/i, 'Cyber matrix foreground must be light high-contrast color');
    assert.match(cyberMatrix.slots['--background'], /^#(0|1)/i, 'Cyber matrix background must be deep dark color');

    // Light skin text should be dark hex
    assert.match(lightSkin.slots['--foreground'], /^#(0|1|2)/i, 'Light skin foreground must be dark high-contrast color');
    // Light skin window background should be light hex
    assert.match(lightSkin.slots['--background'], /^#(F|E)/i, 'Light skin background must be light paper color');

    assert.match(ayuLight.slots['--foreground'], /^#(0|1|2)/i, 'Ayu light foreground must be dark high-contrast color');
    assert.match(ayuLight.slots['--background'], /^#(F|E)/i, 'Ayu light background must be light porcelain color');

    assert.match(warmPaper.slots['--foreground'], /^#(0|1|2)/i, 'Warm paper foreground must be dark high-contrast color');
    assert.match(warmPaper.slots['--background'], /^#(F|E)/i, 'Warm paper background must be light ivory color');
  });

  await t.test('InspectionPod must strictly adhere to Design Tokens (zero hardcoded theme colors)', async () => {
    const { renderInspectionPod } = await import('../dist/components/InspectionPod/InspectionPod.js');
    const html = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      openFiles: [{ path: 'test.ts', content: 'const a = 1;' }],
      activeFilePath: 'test.ts',
    });

    // Prohibit hardcoded legacy panel backgrounds and borders
    assert.ok(!html.includes('background: #090A0F'), 'Must use var(--bg-rail) or var(--bg-panel), not hardcoded #090A0F');
    assert.ok(!html.includes('background: #111318'), 'Must use CSS variables, not hardcoded #111318');
    assert.ok(!html.includes('background: #151720'), 'Must use var(--bg-card), not hardcoded #151720');
    assert.ok(!html.includes('background: #12141A'), 'Must use var(--bg-input), not hardcoded #12141A');
    assert.ok(!html.includes('background: #0A0B10'), 'Must use var(--bg-code), not hardcoded #0A0B10');
    assert.ok(html.includes('var(--bg-panel)'), 'Must apply var(--bg-panel)');
    assert.ok(html.includes('var(--bg-card)'), 'Must apply var(--bg-card)');
    assert.ok(html.includes('var(--bg-code)'), 'Must apply var(--bg-code)');
  });
});
