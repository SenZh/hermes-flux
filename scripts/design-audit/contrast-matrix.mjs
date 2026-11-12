#!/usr/bin/env node
/**
 * Token 对比度矩阵生成器
 *
 * 【设计意图 (Why)】
 *   「某个 token 在某套皮肤上塌到 1.0:1」这类洞，单靠人眼审不出来：
 *   warm-paper 的 --card-active 曾与 --popover 同为 #FFFFFF，选中行底色直接消失，
 *   而换肤门禁只查硬编码色相，完全拦不住。把矩阵算出来落盘，每次改皮肤都能一眼看见。
 *
 * 【约束与规则 (Rules)】
 *   1. 只读 SKINS，不写任何 token；
 *   2. 只计算真正会叠在一起的前景/背景对，不做全组合噪声；
 *   3. 输出 markdown 表，可直接贴进 docs/design-system/。
 *
 * 用法：
 *   node scripts/design-audit/contrast-matrix.mjs           # 打印表格
 *   node scripts/design-audit/contrast-matrix.mjs --check   # 有低于 AA 的对则以 1 退出
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const SKINS_PATH = path.join(REPO_ROOT, 'packages/ui/src/tokens/skins.ts');

/**
 * 真正会叠在一起的前景/背景对。
 * `need` 是 WCAG 口径：正文文字 4.5:1，非文本图形（图标、状态点、停止方块）3:1。
 * 混用两个阈值会产出假失败：把 10px 红方块按 4.5 判死，实际它只需 3:1。
 */
const PAIRS = [
  ['--foreground', '--panel', 'text'],
  ['--foreground', '--input', 'text'],
  ['--foreground', '--popover', 'text'],
  ['--secondary-foreground', '--panel', 'text'],
  ['--secondary-foreground', '--input', 'text'],
  ['--muted-foreground', '--panel', 'text'],
  ['--muted-foreground', '--input', 'text'],
  ['--muted-foreground', '--popover', 'text'],
  ['--destructive', '--input', 'graphic'],
  ['--success', '--input', 'graphic'],
];

const AA_TEXT = 4.5;
const AA_GRAPHIC = 3;
const needOf = (kind) => (kind === 'text' ? AA_TEXT : AA_GRAPHIC);

function parseHex(value) {
  const hex = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function loadSkins() {
  const src = fs.readFileSync(SKINS_PATH, 'utf8');
  const skins = {};
  const blockRe = /"([\w-]+)":\s*\{\s*\n\s*"label":\s*"([^"]*)",\s*\n\s*"variant":\s*"(\w+)",\s*\n\s*"slots":\s*\{([\s\S]*?)\n\s*\},/g;
  let m;
  while ((m = blockRe.exec(src)) !== null) {
    const [, id, label, variant, body] = m;
    const slots = {};
    for (const line of body.split('\n')) {
      const slot = /"(--[\w-]+)":\s*"([^"]+)"/.exec(line);
      if (slot) slots[slot[1]] = slot[2];
    }
    skins[id] = { label, variant, slots };
  }
  return skins;
}

const skins = loadSkins();
const ids = Object.keys(skins);
if (ids.length === 0) {
  console.error('[contrast-matrix] 未能从 skins.ts 解析出任何皮肤');
  process.exit(1);
}

const rows = [];
let failures = 0;
for (const [fgSlot, bgSlot, kind] of PAIRS) {
  const need = needOf(kind);
  const row = { pair: `${fgSlot} on ${bgSlot}`, kind, need, cells: [] };
  for (const id of ids) {
    const fgHex = skins[id].slots[fgSlot];
    const bgHex = skins[id].slots[bgSlot];
    const fg = fgHex ? parseHex(fgHex) : null;
    const bg = bgHex ? parseHex(bgHex) : null;
    if (!fg || !bg) {
      // 半透明 / 引用式 token 无法直接算，标 n/a 而不是假装通过。
      row.cells.push({ id, value: null, hex: `${fgHex ?? '?'} / ${bgHex ?? '?'}` });
      continue;
    }
    const ratio = contrast(fg, bg);
    if (ratio < need) failures += 1;
    row.cells.push({ id, value: ratio, hex: `${fgHex} / ${bgHex}` });
  }
  rows.push(row);
}

const header = `| 前景 on 背景 | 口径 | ${ids.map((id) => `${skins[id].label} (${id})`).join(' | ')} |`;
const divider = `|---|---|${ids.map(() => '---').join('|')}|`;
const body = rows
  .map(
    (r) =>
      `| \`${r.pair}\` | ${r.kind === 'text' ? '正文 4.5' : '图形 3.0'} | ` +
      `${r.cells.map((c) => (c.value === null ? 'n/a' : c.value.toFixed(2))).join(' | ')} |`,
  )
  .join('\n');

console.log('\nToken 对比度矩阵（正文 AA 4.5 / 图形 AA 3.0）\n');
console.log(header);
console.log(divider);
console.log(body);
console.log('');

const flagged = rows.flatMap((r) =>
  r.cells
    .filter((c) => c.value !== null && c.value < r.need)
    .map((c) => ({ pair: r.pair, id: c.id, value: c.value, need: r.need })),
);
if (flagged.length > 0) {
  console.log(`不达标的组合（${flagged.length} 条）：`);
  for (const f of flagged) console.log(`  · ${f.pair} @ ${f.id}: ${f.value.toFixed(2)} < ${f.need}`);
} else {
  console.log('所有登记的前景/背景对都达到各自口径的 AA 阈值。');
}

if (process.argv.includes('--check') && failures > 0) {
  console.error(`\n[contrast-matrix] ${failures} 组不达标`);
  process.exit(1);
}
