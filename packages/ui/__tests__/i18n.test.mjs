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

  await t.test('输入舱新增键必须双语齐备且非空', () => {
    // 这些键由输入舱重设计引入；任一侧漏写都会让界面出现裸 key 或空标签。
    const dockKeys = [
      'dock.approval',
      'dock.approvalManual',
      'dock.approvalSmart',
      'dock.approvalOff',
      'dock.approvalManualHint',
      'dock.approvalSmartHint',
      'dock.approvalOffHint',
      'dock.stopTurn',
      'dock.popperSelect',
      'dock.popperInsert',
      'dock.modelHintMove',
      'dock.modelHintClose',
      'dock.noModelMatch',
      'dock.queueSubmit',
      'dock.queueFailed',
      'dock.queueActionFailed',
      'dock.queueNoLive',
      'dock.busyEnterBlocked',
    ];
    for (const key of dockKeys) {
      assert.ok(key in zhDict, `zhDict 缺少 ${key}`);
      assert.ok(key in enDict, `enDict 缺少 ${key}`);
      assert.ok(zhDict[key].trim().length > 0, `${key} 的中文不能为空`);
      assert.ok(enDict[key].trim().length > 0, `${key} 的英文不能为空`);
    }
    // 审批三态文案必须三档互不相同，否则用户看不出切换了哪一档
    const labels = [zhDict['dock.approvalManual'], zhDict['dock.approvalSmart'], zhDict['dock.approvalOff']];
    assert.equal(new Set(labels).size, 3, '审批三态的中文文案必须互不相同');
  });

  await t.test('斜杠命令说明必须跟随界面语言，命令名保持原文', () => {
    // 【规则】命令名是技术标识（/compress），说明是自然语言。
    //   历史上说明直接取网关英文原文，中文界面里出现整句英文 CLI 帮助文本。
    const commands = ['new', 'reset', 'save', 'retry', 'undo', 'title', 'branch', 'fork', 'compress', 'compact', 'rollback', 'stop'];
    for (const name of commands) {
      const key = `slash.${name}`;
      assert.ok(key in zhDict, `zhDict 缺少 ${key}`);
      assert.ok(key in enDict, `enDict 缺少 ${key}`);
      assert.ok(!/[\u4e00-\u9fa5]/.test(zhDict[key]) === false, `${key} 的中文说明必须是中文`);
      assert.ok(!/[A-Za-z]{4,}/.test(zhDict[key].replace(/\/[a-z]+/g, '')), `${key} 的中文说明不得残留英文句子`);
    }
    // 中英说明必须不同，否则等于没本地化
    for (const name of commands) {
      assert.notEqual(zhDict[`slash.${name}`], enDict[`slash.${name}`], `slash.${name} 的中英说明不得相同`);
    }
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

  await t.test('Strict Zero-Hardcoded-Text Gate: InspectionPod source code must not contain hardcoded Chinese text literals', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const inspectionPodSrcPath = path.resolve('packages/ui/src/components/InspectionPod/InspectionPod.ts');
    const code = fs.readFileSync(inspectionPodSrcPath, 'utf8');

    // Remove JS comments and template HTML comments (<!-- ... -->)
    const codeWithoutComments = code
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    // Match any Chinese character inside code logic or HTML templates
    const chineseMatches = codeWithoutComments.match(/[\u4e00-\u9fa5]/g);
    assert.equal(
      chineseMatches,
      null,
      `InspectionPod.ts must NOT contain any hardcoded Chinese text literals! Found: ${chineseMatches ? chineseMatches.slice(0, 10).join(', ') : ''}. All UI strings must strictly go through t('...')!`
    );
  });
});

test('Theme System standard skin definition validation', async (t) => {
  const { SKINS, SLOT_IDS } = await import('../dist/tokens/skins.js');

  await t.test('Built-in skins must include dark and light variants with complete slot contract', () => {
    const darkSkin = SKINS['obsidian-gold'];
    const lightSkin = SKINS['jade-white'];

    assert.ok(darkSkin, 'Must contain obsidian-gold dark skin');
    assert.ok(lightSkin, 'Must contain jade-white light skin');
    assert.equal(darkSkin.variant, 'dark');
    assert.equal(lightSkin.variant, 'light');
    assert.equal(SLOT_IDS.length, 43, 'Must define exactly 43 slots');

    assert.ok(darkSkin.slots['--background'], 'Must define --background');
    assert.ok(darkSkin.slots['--code'], 'Must define --code');
    assert.ok(darkSkin.slots['--foreground'], 'Must define --foreground');
  });
});
