/**
 * 行内豁免总额预算（Allow Budget）。
 *
 * 设计意图 (Why):
 *   `gate-*-allow` 是对门禁的合法例外，但它是"让门禁变绿"的最短路径：
 *   写一条注释就能吸收一条新增违规。逐行把它判成违规会误伤合法豁免，
 *   而完全不判则会让敞口无限膨胀。正确的度量是**总量**：敞口只能减小。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 与 baseline 棘轮不同，豁免注释没有"行内容指纹"可依赖——改写理由文字
 *      就会被当成新条目。因此这里按「文件 + 规则标签」计数，改理由不影响计数。
 *   2. 只统计真正的注释行：文档块里的写法示例（行首 `*`）与字符串字面量里的
 *      说明都不是豁免申请，若一并计入会虚高并让预算永远"超标"。
 *
 * 约束与规则 (Rules):
 *   - 预算写死在 BUDGET 里，超一即 FAIL。
 *   - 降低预算必须在同一提交内真实删掉对应豁免注释，禁止只改数字。
 *   - 新增豁免必须同时说明理由与失效条件（这是 review 的检查项，不是脚本能判的）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, listSourceFiles, stripComments } from './lib/scanner.mjs';

/**
 * 豁免敞口预算。
 *
 * 现状实测 7 条，全部是确有理由的技术豁免：
 * 逐像素对齐、Portal 层级、视口有界、用户文档底色、品牌固定色 ×2、骨架对齐。
 * 预算等于实测值而非留余量：留余量等于预授权新增一条豁免，
 * 而敞口应当只降不升。要新增一条，就必须先在此调低并真实删除一条。
 */
const BUDGET = 7;

const SCAN_ROOTS = [
  'packages/core/src',
  'packages/ui/src',
  'packages/desktop/src',
  'packages/mobile/src',
  'scripts/gates',
];

const ALLOW_RE = /gate-([a-z-]+)-allow\s*:/;

export function collectAllowances() {
  const rows = [];
  for (const root of SCAN_ROOTS) {
    for (const file of listSourceFiles(root)) {
      const abs = path.join(REPO_ROOT, file);
      if (!fs.existsSync(abs)) continue;
      const src = fs.readFileSync(abs, 'utf8');
      const { codeLines } = stripComments(src);
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        const m = ALLOW_RE.exec(line);
        if (!m) return;
        // 文档块（行首 `*`）里的写法示例不是豁免申请
        if (/^\s*\*/.test(line)) return;
        // 去注释后仍残留标记 => 它在字符串字面量里（例如门禁自己的诊断文案），不是豁免
        if (ALLOW_RE.test(codeLines[i] ?? '')) return;
        rows.push({ file, line: i + 1, tag: m[1], text: line.trim() });
      });
    }
  }
  return rows;
}

function main() {
  const rows = collectAllowances();
  const byTag = new Map();
  for (const r of rows) byTag.set(r.tag, (byTag.get(r.tag) ?? 0) + 1);

  console.log('行内豁免敞口统计');
  for (const [tag, n] of [...byTag].sort((a, b) => b[1] - a[1])) {
    console.log(`  gate-${tag}-allow: ${n}`);
  }
  console.log(`  合计 ${rows.length} / 预算 ${BUDGET}`);

  if (rows.length > BUDGET) {
    console.log('\n✘ 豁免敞口超预算。每条豁免都让门禁对一处代码失效，必须偿还：');
    for (const r of rows) console.log(`  ${r.file}:${r.line}  ${r.text.slice(0, 90)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n✔ 豁免敞口在预算内（余量 ${BUDGET - rows.length}）`);
  process.exitCode = 0;
}

if (process.argv[1]?.split(/[\\/]/).pop() === 'allow-budget.mjs') main();
