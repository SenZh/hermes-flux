import test from 'node:test';
import assert from 'node:assert/strict';

test('i18n standard dictionary parity and placeholder interpolation', async (t) => {
  const { zhDict, enDict, t: translate, setLocale, getLocale } = await import('../dist/i18n/index.js');

  await t.test('enDict must maintain 100% key parity with zhDict', () => {
    const zhKeys = Object.keys(zhDict).sort();
    const enKeys = Object.keys(enDict).sort();

    assert.equal(zhKeys.length, enKeys.length, 'English dictionary key count must match Chinese');
    assert.deepEqual(zhKeys, enKeys, 'All keys between languages must be identical');
  });

  await t.test('t() function must resolve keys and format parameters', () => {
    setLocale('zh-CN');
    assert.equal(translate('rail.newChat'), '新建会话');

    setLocale('en-US');
    assert.equal(translate('rail.newChat'), 'New Session');

    // Switch back
    setLocale('zh-CN');
    assert.equal(getLocale(), 'zh-CN');
  });

  await t.test('All InspectorPod i18n keys must resolve properly in zh and en', () => {
    setLocale('zh-CN');
    assert.ok(translate('inspector.tabFiles').length > 0);
    assert.ok(translate('inspector.tabGit').length > 0);
    assert.ok(translate('inspector.enterFullscreen').length > 0);
    assert.ok(translate('inspector.exitFullscreen').length > 0);

    setLocale('en-US');
    assert.equal(translate('inspector.tabFiles'), 'Files');
    assert.equal(translate('inspector.tabGit'), 'Changes');
    assert.equal(translate('inspector.enterFullscreen'), 'Fullscreen preview');
    assert.equal(translate('inspector.exitFullscreen'), 'Exit fullscreen (Esc)');

    setLocale('zh-CN');
  });
});

test('Theme System standard skin definition validation', async (t) => {
  const { BUILTIN_SKINS, generateSkinCssVariables } = await import('../dist/tokens/themeRegistry.js');

  await t.test('Built-in skins must include dark and light variants and generate CSS variables', () => {
    const darkSkin = BUILTIN_SKINS['obsidian-gold'];
    const lightSkin = BUILTIN_SKINS['jade-white'];

    assert.ok(darkSkin, 'Must contain obsidian-gold dark skin');
    assert.ok(lightSkin, 'Must contain jade-white light skin');
    assert.equal(darkSkin.variant, 'dark');
    assert.equal(lightSkin.variant, 'light');

    const cssVars = generateSkinCssVariables(darkSkin);
    assert.ok(cssVars.includes('--bg-window:'), 'Must generate --bg-window');
    assert.ok(cssVars.includes('--bg-code:'), 'Must generate --bg-code');
    assert.ok(cssVars.includes('--text-main:'), 'Must generate --text-main');
  });
});
