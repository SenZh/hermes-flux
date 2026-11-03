#!/usr/bin/env node
/**
 * 三源皮肤真值面审计杠杆 v2（PR-1a 准入工具）
 * 设计意图(Why)：槽位表定案基于"themeRegistry 声明面 + styles.css 运行时块 + 组件 var() 引用面"
 *   三方全量交集；审查已证明任两方对齐都会漏第三方的真实槽。
 * 防范的历史坑(Pitfall)：v1 两处解析失真——registry 槽名未加 -- 前缀致分类错位；
 *   以值内容(#F7F8F8)判块类型致纯声明块误入组件规则。v2 改为选择器文本判型、全链路 -- 前缀归一。
 * 约束与规则(Rules)：只读；解析失败显式列出；分类只有 GAP/ZOMBIE/DRIFT/OK 四类且可追溯。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CSS_PATH = path.join(ROOT, 'packages/desktop/src/renderer/styles.css');
const SKINS_PATH = path.join(ROOT, 'packages/ui/src/tokens/skins.ts');
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx|css)$/.test(e.name)) out.push(p);
  }
  return out;
};

/* ── 源1：skins.ts（原旧表已于 PR-1c 废弃，由 skins.ts 接管） ── */
const skinsSrc = fs.readFileSync(SKINS_PATH, 'utf8');
const slotMatch = skinsSrc.match(/export const SLOT_IDS = \[(.*?)\]/s);
const registrySlots = slotMatch ? [...slotMatch[1].matchAll(/'(--[a-z0-9-]+)'/g)].map((m) => m[1]) : [];
const registrySkins = {};

/* ── 源2：styles.css 块（选择器文本判型，不看值） ── */
const cssSrc = fs.readFileSync(CSS_PATH, 'utf8');
const blocks = cssSrc.match(/\[data-theme[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g) || [];
const cssSkinVars = {};
const cssComponentRules = {};
const parseFail = [];
for (const b of blocks) {
  const brace = b.indexOf('{');
  const sel = b.slice(0, brace).replace(/\s+/g, ' ').trim();
  const themes = [...new Set([...sel.matchAll(/\[data-theme="([^"]+)"\]/g)].map((m) => m[1]))];
  if (!themes.length) { parseFail.push(sel.slice(0, 80)); continue; }
  const stripped = sel.replace(/\[data-theme="[^"]+"\]/g, '').replace(/[,>~+ ]/g, '');
  const body = b.slice(brace + 1, b.lastIndexOf('}'));
  const decls = [...body.matchAll(/(--[a-z0-9-]+):\s*([^;{}]+);/gi)];
  if (!stripped && decls.length) {
    for (const t of themes) for (const d of decls) ((cssSkinVars[t] ??= {})[d[1]] = d[2].trim());
  } else {
    for (const t of themes) (cssComponentRules[t] ??= new Set()).add(sel.slice(0, 100));
  }
}

/* ── 源3：组件 var() 引用面 ── */
const refs = {};
for (const f of [...walk(path.join(ROOT, 'packages/ui/src')), ...walk(path.join(ROOT, 'packages/desktop/src'))]) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) (refs[m[1]] ??= new Set()).add(rel(f));
}

/* ── 对账 ── */
const cssVarUniverse = new Set(Object.values(cssSkinVars).flatMap((o) => Object.keys(o)));
const rootDef = new Set([...((cssSrc.match(/:root\s*\{[\s\S]*?\n\}/) ?? [''])[0]).matchAll(/(--[a-z0-9-]+):/gi)].map((m) => m[1]));
const allVars = [...new Set([...registrySlots, ...cssVarUniverse, ...Object.keys(refs)])].sort();
const rows = [];
for (const v of allVars) {
  const inReg = registrySlots.includes(v);
  const inCss = cssVarUniverse.has(v);
  const refCount = refs[v]?.size ?? 0;
  let cls = 'OK';
  if (inCss && !inReg && refCount) cls = 'GAP·CSS有值组件在用但注册表缺槽';
  else if (inReg && !inCss && refCount) cls = 'GAP·注册表有槽CSS块无值';
  else if (inReg && !refCount && !inCss) cls = 'ZOMBIE·注册表自嗨';
  else if (!inReg && !inCss && rootDef.has(v)) cls = 'OK·节奏层(:root 定义)';
  else if (!inReg && !inCss && /^--rail-w-/.test(v)) cls = 'OK·运行时几何(setProperty)';
  else if (!inReg && !inCss && refCount) cls = 'GAP·引用面裸奔（皮肤块/注册表/:root 三处都无值）';
  rows.push({ v, inReg, inCss, refCount, cls });
}
const gaps = rows.filter((r) => r.cls !== 'OK');

/* 值漂移：同槽 registry vs styles.css 对比 */
const drift = [];
for (const skin of Object.keys(registrySkins)) {
  const cssBlock = cssSkinVars[skin];
  if (!cssBlock) continue;
  for (const [v, val] of Object.entries(registrySkins[skin])) {
    if (cssBlock[v] && cssBlock[v] !== val) drift.push(`\`${v}\` @${skin}: registry \`${val}\` ≠ css \`${cssBlock[v]}\``);
  }
}

/* badge 族跨皮肤恒同裁决 */
const badgeVars = [...cssVarUniverse].filter((v) => v.startsWith('--badge-')).sort();
const badgeRows = badgeVars.map((v) => {
  const vals = Object.keys(cssSkinVars).map((t) => cssSkinVars[t]?.[v]).filter(Boolean);
  return `| \`${v}\` | ${vals.length} | ${new Set(vals).size} |`;
});

/* 其他扩展候选（CSS 有值非 registry） */
const extSlots = [...cssVarUniverse].filter((v) => !registrySlots.includes(v)).sort();

const regIds = Object.keys(registrySkins);
const cssIds = [...new Set([...Object.keys(cssSkinVars), ...Object.keys(cssComponentRules)])];
const md = [];
md.push('# 三源皮肤真值面审计报告 v3（scripts/design-audit/slot-audit.mjs 输出，可重跑）', '');
md.push(`生成时点：${new Date().toISOString()}。重跑本脚本会覆写本报告，引用时以时点为准。v3 变更：:root 节奏层与运行时几何白名单并入定义面，消 v2 "引用面裸奔"误报（审查 P1）。`, '');
md.push(`registry 槽数=${registrySlots.length} registry 皮肤=[${regIds.join(', ')}] css 皮肤=[${cssIds.join(', ')}] 变量宇宙=${allVars.length} OK=${rows.length - gaps.length}`, '');
md.push('', '## 非 OK 分类（槽表定案的直接输入）', '');
md.push('| 变量 | 注册表 | CSS块 | 引用文件数 | 分类 |', '|---|---|---|---|---|');
for (const r of gaps) md.push(`| \`${r.v}\` | ${r.inReg ? '✓' : ''} | ${r.inCss ? '✓' : ''} | ${r.refCount} | ${r.cls} |`);
md.push('', '## registry 与 styles.css 值漂移（F6 量化）', '');
md.push(...(drift.length ? drift.map((d) => '- ' + d) : ['- （无漂移或 registry 解析 0 皮肤，须核查）']));
md.push('', `## CSS 侧扩展槽候选（${extSlots.length} 个，均不在 registry 29 槽内）`, '');
md.push('- ' + extSlots.join('  `  ` ').replaceAll('`', '`') || '- 无');
md.push('', '## badge 族跨皮肤恒同裁决（不同值数=1 → 归并节奏层候选）', '');
md.push('| 变量 | 有值皮肤数 | 不同值数 |', '|---|---|---|');
md.push(...(badgeRows.length ? badgeRows : ['- （CSS 块未解析出 badge 族：核对源位置后回填）']));
md.push('', '## 皮肤专属组件规则（波①1a 逐条归槽/删除/diff 输入）', '');
for (const [t, s] of Object.entries(cssComponentRules)) md.push(`- **${t}**（${s.size} 条）：${[...s].map((x) => '`' + x + '`').join('; ')}`);
md.push('', '## 皮肤名对账', '');
md.push(`- 幽灵（CSS 有 registry 无）：${cssIds.filter((t) => !regIds.includes(t)).join(', ') || '无'}`);
md.push(`- 无运行时 CSS 块（registry 有 CSS 无）：${regIds.filter((t) => !cssIds.includes(t)).join(', ') || '无'}`);
if (parseFail.length) md.push('', `## 解析失败选择器（${parseFail.length} 个，人工核）`, ...parseFail.map((f) => '- ' + f));
const out = md.join('\n');
fs.writeFileSync(path.join(ROOT, 'docs/changes/2026-11-03_design-system-shadcn-migration/slot-audit-report.md'), out);
console.log(out.slice(0, 6000));
