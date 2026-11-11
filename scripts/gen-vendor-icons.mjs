#!/usr/bin/env node
/**
 * 模型厂商图标资产同步器 (Vendor Icon Asset Sync)
 *
 * 【设计意图 (Why)】
 *   模型选择器需要按模型名自动展示厂商品牌图标。图标来源统一锁定为
 *   `@lobehub/icons-static-svg`（MIT，340+ AI 品牌）。本项目**不在运行时依赖**
 *   该 npm 包：资产一次性 vendored 进 `packages/ui/src/icons/lobe/`，
 *   使桌面/Web/iOS 三端完全离线可用，也避免每次构建重新拉包。
 *
 * 【为什么必须生成清单 (Pitfall)】
 *   渲染层是纯字符串模板，没有 fs 访问权，无法用「文件是否存在」决定
 *   该渲染彩色版还是 mono 版。而 lobe 的品牌变体并不齐整：
 *   - 部分厂商只有 mono（OpenAI / Anthropic / xAI / Moonshot，官方标识本身就是黑色）
 *   - 部分厂商的 -color 里含近黑色填充，深色皮肤下会「黑底黑图」
 *   因此必须在构建期把「有哪些变体 + 彩色版在暗色下是否可读」算成静态清单。
 *
 * 【约束与规则 (Rules)】
 *   - 只读网络一次（下载指定版本 tarball），产物全部落盘，脚本可重复执行且幂等；
 *   - 资产全量复制（含 -text / -brand 变体），不做人工裁剪，避免后续新增需求再翻包；
 *   - 清单只登记「基础族」（剔除 -text 字标与 -brand 底图），它们才是列表行可用的图标；
 *   - 生成文件首行标注 DO NOT EDIT，任何手工改动都会被下次同步覆盖。
 *
 * 用法：node scripts/gen-vendor-icons.mjs [--source <已解包的 package/icons 目录>]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const TARGET_DIR = path.join(REPO_ROOT, 'packages', 'ui', 'src', 'icons', 'lobe');
const MANIFEST_FILE = path.join(REPO_ROOT, 'packages', 'ui', 'src', 'icons', 'vendorIconAssets.ts');

const PACKAGE_NAME = '@lobehub/icons-static-svg';
const PACKAGE_VERSION = '1.102.0';
const LICENSE_URL = 'https://raw.githubusercontent.com/lobehub/lobe-icons/master/LICENSE';

/** 深色皮肤卡片底色与浅色皮肤卡片底色：对比度判定的两个基准面（不带 `#`，与解析出的色值同形）。 */
const DARK_SURFACE = '1B1C23';
const LIGHT_SURFACE = 'FFFFFF';

/** WCAG 最小可读对比度（非正文图形的通用门槛）。 */
const MIN_CONTRAST = 3;

/** sRGB 分量（0~255）→ 线性光，符合 WCAG 2.x 相对亮度定义。 */
function srgbToLinear(channel) {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** 十六进制色 → sRGB 相对亮度（0~1，已做 gamma 解码）。 */
function relativeLuminance(hex) {
  let r;
  let g;
  let b;
  if (hex.length === 3 || hex.length === 4) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  }
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** 两色的 WCAG 对比度。任一边无法解析时返回 1（按最不可读处理）。 */
function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  if (a === null || b === null) return 1;
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * 评估彩色版在两个皮肤下的可读性。
 *
 * 【设计意图 (Why)】
 *   品牌原色资产是「一次性画死的十六进制」。同一张图在深色底上可能黑到不可见
 *  （OpenAI / Anthropic / xAI 的标识本身是黑色），在浅色底上也可能白到不可见
 *  （OpenRouter 的荧光绿 `#C8FF00` 对白底仅 1.18:1）。只判一个方向就会在另一侧翻车。
 *
 * 【为什么用「多数色值达标」而不是「全部达标」(Pitfall)】
 *   多色 logo 的轮廓由多段色块共同支撑：Google 四色里只有黄 `#FBBC05` 对白底 1.71，
 *   其余三色全部达标，整盘降级成 mono 等于把一个官方允许白底四色的品牌抹平。
 *   反过来，单色低对比（OpenRouter 荧光绿、NVIDIA 亮绿）只有一种色值，
 *   多数规则必然判它不安全——这正是要拦的那类。
 *   因此判据是「达标色值数 >= 总数的一半」，且**按去重后的色值**计数，
 *   避免同一色值在多个 path 里重复出现时把权重放大。
 *
 * 【规则】
 *   - 不含任何色值（纯 path 继承黑）时，深色侧按不安全、浅色侧按安全处理——
 *     这与「官方标识是黑色」的实际分布一致。
 */
function evaluateColorAsset(svg) {
  const hexes = [...new Set(extractHexColors(svg))];
  if (hexes.length === 0) return { darkSafe: false, lightSafe: true };
  const needed = hexes.length / 2;
  const darkOk = hexes.filter((hex) => contrastRatio(hex, DARK_SURFACE) >= MIN_CONTRAST).length;
  const lightOk = hexes.filter((hex) => contrastRatio(hex, LIGHT_SURFACE) >= MIN_CONTRAST).length;
  return { darkSafe: darkOk >= needed, lightSafe: lightOk >= needed };
}

function parseArgs(argv) {
  const out = { source: '' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source' && argv[i + 1]) {
      out.source = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return out;
}

async function downloadPackage() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobe-icons-'));
  const tarballUrl = `https://registry.npmjs.org/${PACKAGE_NAME.replace('/', '%2F')}/-/${PACKAGE_NAME.split('/')[1]}-${PACKAGE_VERSION}.tgz`;
  const res = await fetch(tarballUrl);
  if (!res.ok) throw new Error(`下载 ${PACKAGE_NAME}@${PACKAGE_VERSION} 失败：HTTP ${res.status}`);
  const tgzPath = path.join(tmpDir, 'pkg.tgz');
  fs.writeFileSync(tgzPath, Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['-xzf', tgzPath, '-C', tmpDir]);
  return path.join(tmpDir, 'package', 'icons');
}

/**
 * 解析 SVG 内出现的所有十六进制色值。
 *
 * 【为什么不做属性限定】已实测核查 236 个彩色资产的全部 1168 次 `#hex` 出现，
 * 100% 落在 `fill= / stroke= / stop-color= / color=` 等颜色属性上下文，
 * 不存在 `href="#id"` 这类会污染判定的假色值。再加属性白名单只会让解析更脆。
 * 上游结构若变化，`vendor-icon.test.mjs` 的清单↔磁盘一致性断言不会兜住这一点，
 * 因此升级图标版本后应重跑本核查（脚本 `--source` 可离线）。
 */
function extractHexColors(svg) {
  const colors = [];
  for (const match of svg.matchAll(/#([0-9a-fA-F]{3,8})/g)) {
    colors.push(match[1]);
  }
  return colors;
}

/** 资产同步主流程：下载 → 复制 → 生成清单。幂等，可反复执行。 */
async function main() {
  const { source } = parseArgs(process.argv.slice(2));
  const iconsDir = source || (await downloadPackage());
  if (!fs.existsSync(iconsDir)) throw new Error(`图标目录不存在：${iconsDir}`);

  // 【规则】先清空再复制：上游升级会删改品牌文件，残留旧 SVG 会让「清单有、文件是旧版」
  // 这种半新半旧状态长期存在，且反向一致性测试也发现不了（文件确实存在）。
  fs.rmSync(TARGET_DIR, { recursive: true, force: true });
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  const files = fs.readdirSync(iconsDir).filter((name) => name.endsWith('.svg'));
  if (files.length === 0) throw new Error(`图标目录为空：${iconsDir}`);

  // 全量复制：含 -text 字标与 -brand 底图，保持与上游一致，便于后续按需启用。
  for (const name of files) {
    fs.copyFileSync(path.join(iconsDir, name), path.join(TARGET_DIR, name));
  }

  const license = await fetch(LICENSE_URL);
  if (!license.ok) throw new Error(`下载 LICENSE 失败：HTTP ${license.status}`);
  fs.writeFileSync(path.join(TARGET_DIR, 'LICENSE'), await license.text(), 'utf8');
  // 基础族 = 剔除 -text（文字标）与 -brand（带底图容器）后的模型/厂商 mark。
  const baseFiles = files.filter((name) => !name.includes('-text') && !name.includes('-brand'));
  const record = {};
  for (const name of baseFiles) {
    const isColor = name.endsWith('-color.svg');
    const slug = name.replace(/-color\.svg$/, '').replace(/\.svg$/, '');
    const entry = record[slug] ?? { color: false, mono: false, colorDarkSafe: false, colorLightSafe: false };
    if (isColor) {
      entry.color = true;
      const { darkSafe, lightSafe } = evaluateColorAsset(fs.readFileSync(path.join(iconsDir, name), 'utf8'));
      entry.colorDarkSafe = darkSafe;
      entry.colorLightSafe = lightSafe;
    } else {
      entry.mono = true;
    }
    record[slug] = entry;
  }

  const sortedSlugs = Object.keys(record).sort();
  const lines = [
    '/**',
    ' * 厂商图标资产清单 (Vendor Icon Asset Manifest) — 自动生成，请勿手工编辑。',
    ' *',
    ' * 生成器：scripts/gen-vendor-icons.mjs',
    ` * 来源：${PACKAGE_NAME}@${PACKAGE_VERSION}（MIT）`,
    ' *',
    ' * 【字段语义】',
    ' *   color          —— 存在 `-color` 变体（品牌原色）',
    ' *   mono           —— 存在 mono 变体（fill=currentColor，随文字色与皮肤变色）',
    ' *   colorDarkSafe  —— 彩色版所有色值对深色卡片底 #1B1C23 的对比度均 >= 3',
    ' *   colorLightSafe —— 彩色版所有色值对浅色卡片底 #FFFFFF 的对比度均 >= 3',
    ' *',
    ' * 【为什么要两个方向】品牌原色是画死的十六进制，两个方向会各自翻车：',
    ' *   OpenAI / Anthropic / xAI 的标识本身是黑色 → 深色底上不可见；',
    ' *   OpenRouter 的荧光绿 `#C8FF00` → 白底上仅 1.18:1，同样不可见。',
    ' * 只判一个方向，就会在另一侧留下「隐形图标」。',
    ' */',
    '',
    'export interface VendorIconAsset {',
    '  /** 存在品牌原色变体 */',
    '  color: boolean;',
    '  /** 存在 mono（currentColor）变体 */',
    '  mono: boolean;',
    '  /** 彩色版在深色皮肤下是否可读 */',
    '  colorDarkSafe: boolean;',
    '  /** 彩色版在浅色皮肤下是否可读 */',
    '  colorLightSafe: boolean;',
    '}',
    '',
    `export const VENDOR_ICON_SOURCE = '${PACKAGE_NAME}@${PACKAGE_VERSION}';`,
    '',
    'export const VENDOR_ICON_ASSETS: Readonly<Record<string, VendorIconAsset>> = {',
    ...sortedSlugs.map((slug) => {
      const { color, mono, colorDarkSafe, colorLightSafe } = record[slug];
      return (
        `  ${JSON.stringify(slug)}: { color: ${color}, mono: ${mono}, ` +
        `colorDarkSafe: ${colorDarkSafe}, colorLightSafe: ${colorLightSafe} },`
      );
    }),
    '};',
    '',
  ];
  fs.writeFileSync(MANIFEST_FILE, lines.join('\n'), 'utf8');

  const withColor = sortedSlugs.filter((slug) => record[slug].color).length;
  const bothSafe = sortedSlugs.filter(
    (slug) => record[slug].color && record[slug].colorDarkSafe && record[slug].colorLightSafe,
  ).length;
  const darkOnly = sortedSlugs.filter(
    (slug) => record[slug].color && record[slug].colorDarkSafe && !record[slug].colorLightSafe,
  ).length;
  const lightOnly = sortedSlugs.filter(
    (slug) => record[slug].color && !record[slug].colorDarkSafe && record[slug].colorLightSafe,
  ).length;
  const noneSafe = withColor - bothSafe - darkOnly - lightOnly;
  const monoOnly = sortedSlugs.length - withColor;

  // 资产目录自说明：这个文件由生成器维护，和 LICENSE 一样必须随目录一起存在。
  fs.writeFileSync(
    path.join(TARGET_DIR, 'README.md'),
    [
      '# 模型厂商图标资产 (Vendor Icon Assets)',
      '',
      `本目录是 [\`${PACKAGE_NAME}\`](https://github.com/lobehub/lobe-icons) 的原样拷贝，用于按厂商自动渲染品牌图标。`,
      '',
      '| 项 | 值 |',
      '|---|---|',
      `| 上游 | \`${PACKAGE_NAME}\` ${PACKAGE_VERSION} |`,
      '| 许可 | MIT（见同目录 `LICENSE`） |',
      `| 文件数 | ${files.length} 个 SVG（全量保留，含 \`-text\` 字标与 \`-brand\` 底图变体） |`,
      '| 生成器 | `scripts/gen-vendor-icons.mjs` |',
      '',
      '## 变体命名',
      '',
      '- `<slug>.svg` — mono 版，`fill="currentColor"`，随文字色与皮肤变色；',
      '- `<slug>-color.svg` — 品牌原色版；',
      '- `<slug>-text.svg` / `<slug>-text-cn.svg` — 图形 + 品牌文字的横向组合标；',
      '- `<slug>-brand.svg` / `<slug>-brand-color.svg` — 带背景容器的版本。',
      '',
      '列表行只用前两种，其余保留备用。',
      '',
      '## 为什么需要双轨（暗/浅两侧判定）',
      '',
      '彩色版是画死的十六进制，两个方向会各自翻车：OpenAI / Anthropic / xAI 的标识本身是黑色，',
      '深色底上不可见；OpenRouter 的荧光绿 `#C8FF00` 对白底仅 1.18:1，浅色底上同样不可见。',
      '因此清单对每个彩色资产同时记录 `colorDarkSafe` 与 `colorLightSafe`，',
      '渲染层据此在「永远彩色 / 深色出 mono / 浅色出 mono / 永远 mono」之间选择。',
      '',
      '判定采用「达标色值数 >= 总数一半」：多色 logo 的轮廓由多段色块共同支撑',
      '（Google 四色里只有黄色对白底不足），单色低对比（OpenRouter / NVIDIA）则必然被判不安全。',
      '',
      `当前分布（共 ${sortedSlugs.length} 个基础族）：`,
      '',
      '| 组合 | 数量 | 渲染形态 |',
      '|---|---|---|',
      `| 两侧都安全 | ${bothSafe} | 永远彩色 |`,
      `| 仅深色安全 | ${darkOnly} | 深色出彩色、浅色出 mono |`,
      `| 仅浅色安全 | ${lightOnly} | 浅色出彩色、深色出 mono |`,
      `| 两侧都不安全 | ${noneSafe} | 永远 mono |`,
      `| 只有 mono 变体 | ${monoOnly} | 永远 mono |`,
      '',
      '## 更新方式',
      '',
      '```bash',
      'node scripts/gen-vendor-icons.mjs',
      '```',
      '',
      '脚本会下载对应版本 tarball、清空并覆盖本目录、重新生成 `../vendorIconAssets.ts`。',
      '升级版本时修改脚本顶部的 `PACKAGE_VERSION`。',
      '',
    ].join('\n'),
    'utf8',
  );

  console.log(`✔ 复制 ${files.length} 个 SVG -> ${path.relative(REPO_ROOT, TARGET_DIR)}`);
  console.log(
    `✔ 清单 ${sortedSlugs.length} 个厂商（彩色 ${withColor}：两侧都安全 ${bothSafe} · 仅暗色安全 ${darkOnly} · 仅浅色安全 ${lightOnly} · 都不安全 ${noneSafe}）`,
  );
  console.log(`✔ 写入 ${path.relative(REPO_ROOT, MANIFEST_FILE)}`);
}

main().catch((err) => {
  console.error('[gen-vendor-icons]', err.message);
  process.exit(1);
});
