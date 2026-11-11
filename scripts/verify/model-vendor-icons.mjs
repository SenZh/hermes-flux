#!/usr/bin/env node
/**
 * 模型厂商图标物理渲染验证 (Model Vendor Icons Verification)
 *
 * 【设计意图 (Why)】
 *   图标链路的三个致命断点全部发生在运行时、且静态测试看不见：
 *   1. `<img src="icons/lobe/x-color.svg">` 若 MIME 或路径错，Chromium 静默破图（不抛错）；
 *   2. CSS `mask-image: var(--vendor-icon-src)` 的 URL 基准若错，mono 图标直接消失；
 *   3. 双轨切换若 `data-appearance` 没同步，深色皮肤会把黑色品牌图贴成「黑底黑图」。
 *   本脚本在真实 Blink 内核里渲染组件产物并逐条断言上述三点，截图与 DOM 证据落盘。
 *
 * 【约束与规则 (Rules)】
 *   - 只驱动编译产物（各包的 dist 目录），不 mock 渲染逻辑；
 *   - 预览页写在 dist 目录内，保证 `icons/lobe/*` 的相对路径基准与真实应用一致；
 *   - 结束后清理预览页与浏览器临时目录，证据目录永久保留。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDriveSession } from './control-flux.mjs';
import { renderModelPickerTree } from '../../packages/ui/dist/components/InputDock/InputDock.js';
import { normalizeModelCatalog } from '../../packages/core/dist/models/modelCatalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PREVIEW_REL = 'packages/desktop/dist/renderer/__vendor-icons-preview.html';
const PREVIEW_ABS = path.join(ROOT, PREVIEW_REL);
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'verification', 'model-vendor-icons');

/**
 * 真实网关形状的 payload —— 全部字段由 core 的 `normalizeModelCatalog` 派生，
 * 脚本只声明"哪个模型挂在哪个 provider 下"，不手填 vendorId/形态。
 *
 * 【为什么必须这样】手填 vendorId 等于把被测对象自己当成了期望值：core 派生错了，
 * 预览页照样能渲染对，证据就是自我循环。这里的唯一真值是「模型 ID → 期望厂商 slug」
 * 这张外部事实表，派生结果必须与它逐条对齐。
 */
const RAW_PAYLOAD = {
  providers: [
    {
      slug: 'cpa',
      name: 'cpa',
      models: [
        'anthropic/claude-opus-5',
        'openai/gpt-6-astra-pro',
        'gemini-3.8-flash',
        'deepseek-v4.1-flash',
        'qwen3-max',
      ],
    },
    { slug: 'nous', name: 'Nous Portal', models: ['zai/glm-5.2', 'kimi-k2', 'openrouter/sonoma-sky'] },
    { slug: 'xai-oauth', name: 'xAI Grok OAuth', models: ['grok-4.20'] },
    { slug: 'proxy-x', name: 'proxy-x', models: ['ling-2'] },
  ],
};

/** 外部事实表：模型 ID → 期望厂商 slug（空串 = 无官方图标）。 */
const EXPECTED_VENDORS = {
  'anthropic/claude-opus-5': 'anthropic',
  'openai/gpt-6-astra-pro': 'openai',
  'gemini-3.8-flash': 'google',
  'deepseek-v4.1-flash': 'deepseek',
  'qwen3-max': 'qwen',
  'zai/glm-5.2': 'zhipu',
  'kimi-k2': 'moonshot',
  'openrouter/sonoma-sky': 'openrouter',
  'grok-4.20': 'xai',
  'ling-2': '',
};

const CATALOG = normalizeModelCatalog(RAW_PAYLOAD);

function buildPreviewHtml() {
  const tree = renderModelPickerTree({ modelCatalog: CATALOG, selectedModel: 'gemini-3.8-flash' });
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Vendor Icons Preview</title>
  <link rel="stylesheet" href="styles.css">
  <link rel="stylesheet" href="conversation.css">
  <style>
    body { margin: 0; display: flex; gap: 24px; padding: 24px; align-items: flex-start; }
    .panel { width: 340px; border-radius: 12px; padding: 8px; border: 1px solid var(--border); background: var(--popover); }
    .panel-label { font: 600 11px/14px var(--font-sans); color: var(--muted-foreground); padding: 4px 8px 10px; }
  </style>
</head>
<body>
  <div id="flux-app-root"></div>
  <section class="panel" data-theme="obsidian-gold" data-appearance="dark" id="panel-dark">
    <div class="panel-label">DARK · obsidian-gold · data-appearance=dark</div>
    ${tree}
  </section>
  <section class="panel" data-theme="ayu-light" data-appearance="light" id="panel-light">
    <div class="panel-label">LIGHT · ayu-light · data-appearance=light</div>
    ${tree}
  </section>
  <script>window.__fluxState = { preview: 'model-vendor-icons' };</script>
</body>
</html>`;
}

/** 在真实浏览器里逐条测量，返回结构化结论。 */
const PROBE = `(() => {
  const panels = ['dark', 'light'].map((mode) => {
    const root = document.getElementById('panel-' + mode);
    if (!root) return { mode, missing: true };
    const q = (sel) => [...root.querySelectorAll(sel)];
    const state = (el) => ({
      color: getComputedStyle(el.querySelector('.vendor-icon__color')).display !== 'none',
      mono: getComputedStyle(el.querySelector('.vendor-icon__mono')).display !== 'none',
    });
    const colorImgs = q('.vendor-icon__color');
    return {
      mode,
      rows: q('.model-option').length,
      dual: q('.vendor-icon--dual:not(.vendor-icon--dual-inverse)').map(state),
      dualInverse: q('.vendor-icon--dual-inverse').map(state),
      colorOnlyVisible: q('.vendor-icon:not(.vendor-icon--dual):not(.vendor-icon--badge)')
        .filter((el) => el.querySelector('.vendor-icon__color'))
        .map((el) => {
          const img = el.querySelector('.vendor-icon__color');
          return getComputedStyle(img).display !== 'none' && img.naturalWidth > 0;
        }),
      monoOnlyCount: q('.vendor-icon:not(.vendor-icon--dual):not(.vendor-icon--badge)').filter((el) => !el.querySelector('.vendor-icon__color')).length,
      rowBadges: q('.model-option .vendor-icon--badge').length,
      headerBadges: q('.model-provider-group-header .vendor-icon--badge').length,
      legacyEmoji: ['\\u{1F4F1}', '\\u{1F9E0}', '\\u{26A1}', '\\u{1F40B}', '\\u{1F916}', '\\u2726', '\\u2B21']
        .filter((ch) => (root.textContent || '').includes(ch)).length,
      monoMask: (() => {
        const m = root.querySelector('.vendor-icon__mono');
        return m ? (getComputedStyle(m).maskImage || getComputedStyle(m).webkitMaskImage || '') : '';
      })(),
      totalImgs: colorImgs.length,
      decodedImgs: colorImgs.filter((img) => img.complete && img.naturalWidth > 0).length,
      badgeBox: (() => {
        const badge = root.querySelector('.model-option .vendor-icon--badge');
        const icon = root.querySelector('.model-option .vendor-icon--dual, .model-option .vendor-icon:not(.vendor-icon--badge)');
        if (!badge) return null;
        const rect = badge.getBoundingClientRect();
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          iconWidth: icon ? Math.round(icon.getBoundingClientRect().width) : null,
          shadow: getComputedStyle(badge).boxShadow,
        };
      })(),
    };
  });
  return panels;
})()`;

async function main() {
  // 【第一道闸】先证明 core 派生正确：外部事实表逐条对齐，否则下面的渲染证据毫无意义。
  const wrongVendor = CATALOG.filter((entry) => entry.vendorId !== EXPECTED_VENDORS[entry.id]);
  if (wrongVendor.length > 0) {
    console.error(
      '❌ core 厂商派生与外部事实表不符：' +
        wrongVendor.map((e) => `${e.id} 期望「${EXPECTED_VENDORS[e.id]}」实得「${e.vendorId}」`).join('；'),
    );
    process.exit(1);
  }

  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(PREVIEW_ABS, buildPreviewHtml(), 'utf8');

  const session = await createDriveSession({ entry: '/' + PREVIEW_REL, width: 980, height: 760 });
  const startedAt = Date.now();
  try {
    await session.waitFor("document.querySelector('#panel-light .model-option') !== null", 10000, 'picker rows');

    const panels = await session.evaluate(PROBE);
    const screenshot = path.join(ARTIFACT_DIR, 'screenshot.png');
    await session.screenshot(screenshot);

    const failures = [];
    for (const panel of panels) {
      if (panel.missing) {
        failures.push(`${panel.mode}: 面板未挂载`);
        continue;
      }
      if (panel.rows !== CATALOG.length) failures.push(`${panel.mode}: 行数 ${panel.rows} != ${CATALOG.length}`);
      if (panel.totalImgs === 0) failures.push(`${panel.mode}: 没有任何彩色 img 节点`);
      if (panel.decodedImgs !== panel.totalImgs) {
        failures.push(`${panel.mode}: 彩色图标解码失败 ${panel.totalImgs - panel.decodedImgs}/${panel.totalImgs}（路径或 MIME 错误）`);
      }
      // 模型行必须恰好 1 个降级徽标（ling-2）；分组标题一律不补首字母徽标
      if (panel.rowBadges !== 1) failures.push(`${panel.mode}: 模型行降级徽标应恰好 1 个，实得 ${panel.rowBadges}`);
      if (panel.headerBadges !== 0) failures.push(`${panel.mode}: 分组标题不得出现首字母冗余徽标，实得 ${panel.headerBadges}`);
      if (panel.legacyEmoji > 0) failures.push(`${panel.mode}: 仍残留 ${panel.legacyEmoji} 个旧 emoji`);
      if (panel.monoOnlyCount < 1) failures.push(`${panel.mode}: 缺少只有 mono 变体的厂商样本`);
      if (!panel.monoMask || panel.monoMask === 'none') failures.push(`${panel.mode}: mono 的 mask 未生效`);
      else if (!panel.monoMask.includes('icons/lobe')) {
        failures.push(`${panel.mode}: mono 的 mask URL 未解析到 icons/lobe（实得 ${panel.monoMask}）`);
      }
      // 永远彩色的形态（deepseek / zhipu）：两种皮肤下都必须真的可见且解码成功
      if (panel.colorOnlyVisible.some((v) => v !== true)) {
        failures.push(`${panel.mode}: 两侧都可读的品牌被隐藏或破图（colorOnlyVisible=${JSON.stringify(panel.colorOnlyVisible)}）`);
      }
      // 徽标必须与图标同外径：`border` 在 content-box 下会撑成 16px，行内对齐随之跳动
      if (!panel.badgeBox) failures.push(`${panel.mode}: 缺少降级徽标样本`);
      else {
        if (panel.badgeBox.width !== 14 || panel.badgeBox.height !== 14) {
          failures.push(`${panel.mode}: 徽标外径 ${panel.badgeBox.width}×${panel.badgeBox.height} != 14×14（盒模型被边框撑破）`);
        }
        if (panel.badgeBox.iconWidth !== null && panel.badgeBox.iconWidth !== panel.badgeBox.width) {
          failures.push(`${panel.mode}: 徽标 ${panel.badgeBox.width}px != 图标 ${panel.badgeBox.iconWidth}px，行内会跳位`);
        }
        if (!panel.badgeBox.shadow.includes('inset')) {
          failures.push(`${panel.mode}: 徽标缺少 inset 发丝边框（会读成残缺图标）`);
        }
      }
    }

    const dark = panels.find((p) => p.mode === 'dark');
    const light = panels.find((p) => p.mode === 'light');
    if (dark && light) {
      // 正向双轨：深色出 mono，浅色出彩色
      const dualOk = (list, expectColor) => list.length > 0 && list.every((s) => s.color === expectColor && s.mono === !expectColor);
      if (!dualOk(dark.dual, false)) failures.push(`dark: 正向双轨未切到 mono（${JSON.stringify(dark.dual)}）`);
      if (!dualOk(light.dual, true)) failures.push(`light: 正向双轨未切到彩色（${JSON.stringify(light.dual)}）`);
      // 反向双轨：深色出彩色，浅色出 mono
      if (!dualOk(dark.dualInverse, true)) failures.push(`dark: 反向双轨未切到彩色（${JSON.stringify(dark.dualInverse)}）`);
      if (!dualOk(light.dualInverse, false)) failures.push(`light: 反向双轨未切到 mono（${JSON.stringify(light.dualInverse)}）`);
    }

    const evidence = {
      featureId: 'model-vendor-icons',
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      status: failures.length === 0 ? 'PASSED' : 'FAILED',
      failures,
      panels,
      screenshot,
    };
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');

    for (const panel of panels) {
      console.log(
        `  · ${panel.mode}: rows=${panel.rows} imgs=${panel.decodedImgs}/${panel.totalImgs} ` +
          `dual=${JSON.stringify(panel.dual)} inverse=${JSON.stringify(panel.dualInverse)} ` +
          `colorOnly=${JSON.stringify(panel.colorOnlyVisible)} rowBadges=${panel.rowBadges} headerBadges=${panel.headerBadges}`,
      );
    }
    if (failures.length > 0) {
      console.error('\n❌ 验证失败：');
      for (const f of failures) console.error('   - ' + f);
      process.exitCode = 1;
      return;
    }
    console.log(`\n✔ 验证通过，证据：${path.relative(ROOT, screenshot)}`);
  } finally {
    await session.cleanup();
    try {
      fs.rmSync(PREVIEW_ABS, { force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error('[model-vendor-icons]', err);
  process.exit(1);
});
