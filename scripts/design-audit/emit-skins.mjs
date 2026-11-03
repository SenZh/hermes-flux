#!/usr/bin/env node
/**
 * 皮肤单一真值表提取与生成杠杆（PR-1a 核心工具）
 * 设计意图(Why)：审查证明皮肤运行时真值只有 styles.css 手写块独自生效（registry 表零生产调用）。
 *   一次性提取生成 skins.ts，之后所有皮肤值只能由 skins.ts 生成，手写块被标记区替换。
 * 防范的历史坑(Pitfall)：skins.ts 若不接运行时即成第四张漂移表（pitfall-registry"存在≠生效"）；
 *   v2 审计以值内容判块型把纯声明块误判为组件规则，v3 改选择器文本判型并保留别名兼容。
 * 约束与规则(Rules)：
 *   - extract 模式幂等前提：styles.css 尚无标记区；有标记时拒绝再提取。
 *   - emit/--check 模式从 skins.ts 重新生成标记区并比对，测试用 --check 断言单一真值未被旁改。
 *   - 组件老变量名全部作为 alias 继续输出，本工具不做组件改名（改名是波③各舱迁移的职责）。
 *   - --accent 名位保留给品牌主色 alias 场景：shadcn 的 bg-accent 角色由波③ cva recipe 映射到
 *     --primary-subtle/--card-hover，皮肤表不产出 --accent，防双义。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CSS_PATH = path.join(ROOT, 'packages/desktop/src/renderer/styles.css');
const SKINS_TS_PATH = path.join(ROOT, 'packages/ui/src/tokens/skins.ts');
const SNAPSHOT_PATH = path.join(ROOT, 'docs/changes/2026-11-03_design-system-shadcn-migration/skins-prechange-snapshot.json');
const MARK_START = '/* ═══ AUTO-GENERATED SKIN TABLE — 唯一真值源 packages/ui/src/tokens/skins.ts — 手改无效 ═══ */';
const MARK_END = '/* ═══ END AUTO-GENERATED SKIN TABLE ═══ */';

const mode = process.argv[2] || 'emit';

/* 槽定义：final=规范名 extractFrom=提取来源(旧名数组,按序取首个命中) aliases=兼容输出的旧名 */
const SLOTS = [
  { final: '--background', extractFrom: ['--bg-window'], aliases: ['--bg-window'] },
  { final: '--card', extractFrom: ['--bg-card'], aliases: ['--bg-card'] },
  { final: '--card-hover', extractFrom: ['--bg-card-hover', '--bg-hover'], aliases: ['--bg-card-hover'] },
  { final: '--card-active', extractFrom: ['--bg-card-active'], aliases: ['--bg-card-active'] },
  { final: '--popover', extractFrom: ['--bg-elevated', '--bg-surface-1'], aliases: ['--bg-elevated'] },
  { final: '--sidebar', extractFrom: ['--bg-rail'], aliases: ['--bg-rail'] },
  { final: '--panel', extractFrom: ['--bg-panel'], aliases: ['--bg-panel'] },
  { final: '--input', extractFrom: ['--bg-input'], aliases: ['--bg-input'] },
  { final: '--code', extractFrom: ['--bg-code'], aliases: ['--bg-code'] },
  { final: '--backdrop', extractFrom: ['--bg-backdrop'], aliases: ['--bg-backdrop'] },
  { final: '--secondary', extractFrom: ['--bg-panel'], aliases: [] },
  { final: '--muted', extractFrom: ['--bg-elevated'], aliases: [] },
  { final: '--foreground', extractFrom: ['--text-main'], aliases: ['--text-main'] },
  { final: '--secondary-foreground', extractFrom: ['--text-secondary'], aliases: ['--text-secondary'] },
  { final: '--muted-foreground', extractFrom: ['--text-muted'], aliases: ['--text-muted'] },
  { final: '--faint', extractFrom: ['--text-faint'], aliases: ['--text-faint'] },
  { final: '--primary', extractFrom: ['--accent'], aliases: ['--accent'] },
  { final: '--primary-hover', extractFrom: ['--accent-hover'], aliases: ['--accent-hover'] },
  { final: '--primary-dim', extractFrom: ['--accent-dim'], aliases: ['--accent-dim'] },
  { final: '--primary-glow', extractFrom: ['--accent-glow'], aliases: ['--accent-glow'] },
  { final: '--primary-subtle', extractFrom: ['--accent-subtle'], aliases: ['--accent-subtle'] },
  { final: '--primary-border', extractFrom: ['--accent-border'], aliases: ['--accent-border'] },
  { final: '--primary-foreground', extractFrom: ['--accent-text'], aliases: ['--accent-text'] },
  { final: '--ring', extractFrom: ['--accent'], aliases: [] },
  { final: '--success', extractFrom: ['--jade-pulse'], aliases: ['--jade-pulse'] },
  { final: '--success-glow', extractFrom: ['--jade-glow'], aliases: ['--jade-glow'] },
  { final: '--warning', extractFrom: [], fallback: '#F59E0B', aliases: [] },
  { final: '--destructive', extractFrom: ['--danger-color'], fallback: '#EF4444', aliases: ['--danger-color'] },
  { final: '--border', extractFrom: ['--border-medium'], aliases: ['--border-medium'] },
  { final: '--border-subtle', extractFrom: ['--border-subtle'], aliases: [] },
  { final: '--border-strong', extractFrom: ['--border-strong'], aliases: [] },
  { final: '--shadow-window', extractFrom: ['--shadow-window'], aliases: [] },
  { final: '--shadow-card', extractFrom: ['--shadow-card'], aliases: [] },
  { final: '--shadow-dock', extractFrom: ['--shadow-dock'], aliases: [] },
  { final: '--hl-comment', extractFrom: ['--hl-comment'], aliases: [] },
  { final: '--hl-string', extractFrom: ['--hl-string'], aliases: [] },
  { final: '--hl-keyword', extractFrom: ['--hl-keyword'], aliases: [] },
  { final: '--hl-number', extractFrom: ['--hl-number'], aliases: [] },
  { final: '--hl-type', extractFrom: ['--hl-type'], fallbackFrom: '--hl-number', aliases: [] },
  { final: '--specular-line', extractFrom: ['--specular-line'], aliases: [] },
  { final: '--theme-thumb-color', extractFrom: ['--theme-thumb-color'], aliases: [] },
  { final: '--chat-user-message-bg', extractFrom: ['--chat-user-message-bg'], fallbackFrom: '--card', aliases: [] },
];
const SKIN_ALIAS_MAP = { 'suet-jade': 'jade-white' };
const BADGE_LANGS = ['ts', 'js', 'py', 'html', 'css'];
const badgeSlotName = (lang, part) => `--badge-${lang}-${part}`;
const SLOT_IDS = [...SLOTS.map((s) => s.final), 'badge-palette'];

/* 运行时块解析（选择器判型，不看值） */
function parseSkinBlocks(cssSrc) {
  const blocks = cssSrc.match(/\[data-theme[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g) || [];
  const perSkin = {};
  for (const b of blocks) {
    const brace = b.indexOf('{');
    const sel = b.slice(0, brace).replace(/\s+/g, ' ').trim();
    const themes = [...new Set([...sel.matchAll(/\[data-theme="([^"]+)"\]/g)].map((m) => m[1]))];
    if (!themes.length) continue;
    const stripped = sel.replace(/\[data-theme="[^"]+"\]/g, '').replace(/[,>~+ ]/g, '');
    if (stripped) continue;
    const body = b.slice(brace + 1, b.lastIndexOf('}'));
    const decls = {};
    for (const d of body.matchAll(/(--[a-z0-9-]+):\s*([^;{}]+);/gi)) decls[d[1]] = d[2].trim();
    if (!Object.keys(decls).length) continue;
    for (const t of themes) perSkin[t] = { ...(perSkin[t] ?? {}), ...decls };
  }
  return perSkin;
}

/* badge 调色板指纹折叠（空 colors 不建调色板：cyber-matrix 在 HEAD 无 badge 变量，凭空发色=未声明视觉 diff，P0/P1 审查裁决） */
function buildBadgePalettes(perSkin) {
  const palettes = {};
  const skins = {};
  for (const [skin, decls] of Object.entries(perSkin)) {
    const colors = {};
    for (const lang of BADGE_LANGS) {
      const bg = decls[badgeSlotName(lang, 'bg')];
      const text = decls[badgeSlotName(lang, 'text')];
      const border = decls[badgeSlotName(lang, 'border')];
      if (bg && text && border) colors[lang] = { bg, text, border };
    }
    if (!Object.keys(colors).length) continue;
    const key = JSON.stringify(colors);
    let id = Object.keys(palettes).find((p) => palettes[p].key === key);
    if (!id) {
      id = 'palette-' + (Object.keys(palettes).length + 1);
      palettes[id] = { key, colors };
    }
    skins[skin] = id;
  }
  return { palettes, skins };
}

const cssSrc = fs.readFileSync(CSS_PATH, 'utf8');
const regPath = path.join(ROOT, 'packages/ui/src/tokens/themeRegistry.ts');
const regSrc = fs.existsSync(regPath) ? fs.readFileSync(regPath, 'utf8') : '';
const hasMarker = cssSrc.includes(MARK_START);

if (mode === 'extract') {
  if (hasMarker) throw new Error('styles.css 已含标记区，拒绝二次提取（真值应改 skins.ts 后 --emit）');
  const perSkin = parseSkinBlocks(cssSrc);
  const nameMap = {};
  for (const m of regSrc.matchAll(/'([a-z0-9-]+)':\s*\{[^}]*?name:\s*'([^']+)'/g)) nameMap[m[1]] = m[2];
  /* variant 判据取 --background 槽亮度（双审 P0：原判据取 --text-main 方向反转且窗口够不到，五皮肤全错标 light） */
  const variantOfSlots = (slots) => {
    const hex = (slots['--background'] || '').match(/#([0-9a-f]{6})/i);
    if (!hex) return 'light';
    const n = parseInt(hex[1], 16);
    const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    return lum < 128 ? 'dark' : 'light';
  };
  const rootBlockSrc = (cssSrc.match(/:root\s*\{[\s\S]*?\n\}/) ?? [''])[0];
  const rootVars = {};
  for (const m of rootBlockSrc.matchAll(/(--[a-z0-9-]+):\s*([^;{}]+);/gi)) rootVars[m[1]] = m[2].trim();
  const { palettes, skins: skinPalette } = buildBadgePalettes(perSkin);
  const table = {};
  const snapshot = {};
  for (const [skin, decls] of Object.entries(perSkin)) {
    if (SKIN_ALIAS_MAP[skin]) continue;
    snapshot[skin] = decls;
    const slots = {};
    const origins = {};
    for (const s of SLOTS) {
      let val, origin;
      for (const src of s.extractFrom) if (decls[src]) { val = decls[src]; origin = 'HEAD:' + src; break; }
      if (!val && s.fallback) { val = s.fallback; origin = 'CONST:' + s.fallback; }
      if (val) slots[s.final] = val;
      origins[s.final] = origin;
    }
    for (const s of SLOTS) {
      if (!slots[s.final] && s.fallbackFrom && slots[s.fallbackFrom]) {
        const base = s.fallbackFrom;
        if (decls[base]) { slots[s.final] = decls[base]; origins[s.final] = 'HEAD:' + base; }
        else if (slots[base]) { slots[s.final] = slots[base]; origins[s.final] = 'DERIVE:' + base; }
      }
    }
    for (const s of SLOTS) {
      if (!slots[s.final] && rootVars[s.final]) { slots[s.final] = rootVars[s.final]; origins[s.final] = 'ROOT:' + s.final; }
    }
    const missing = SLOTS.filter((s) => !slots[s.final]).map((s) => s.final);
    if (missing.length) throw new Error(`[extract] ${skin} 缺槽且无派生路径: ${missing.join(',')} —— 审计结论不可落地，中止`);
    origins['badge-palette'] = 'PALETTE:' + (skinPalette[skin] ?? 'none');
    table[skin] = { variant: variantOfSlots(slots), slots, origins, badgePalette: skinPalette[skin] ?? null };
  }
  snapshot.__root__ = rootVars;
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  const ts = [];
  ts.push('/**');
  ts.push(' * Hermes Flux 皮肤单一真值表（PR-1a 起为唯一皮肤源）。');
  ts.push(' * 设计意图(Why)：审查证实运行时皮肤此前只有 styles.css 手写块生效、registry 表零调用；');
  ts.push('   本表由 scripts/design-audit/emit-skins.mjs 从运行时块一次性提取，此后 styles.css 的皮肤');
  ts.push('   标记区只能由本表再生成（--emit/--check），改皮肤=改这张表，缺槽=编译错。');
  ts.push(' * 防范的历史坑(Pitfall)：多源漂移（三源）、suet-jade 幽灵皮肤、--bg-surface-1 类幽灵 Token');
  ts.push('   （pitfall-registry：存在≠生效、定义≠引用）。');
  ts.push(' * 约束与规则(Rules)：');
  ts.push(' *   1. 本表是唯一皮肤真值，styles.css 标记区外的手写规则不得再定义皮肤级变量。');
  ts.push(' *   2. 新增皮肤必须填满 SkinSlots 全部键，TS 编译强制；别名皮肤只进 SKIN_ALIASES。');
  ts.push(' *   3. 旧变量名以 alias 形式继续输出，组件波③迁移时逐舱删除对应 alias。');
  ts.push(' */');
  ts.push(`export const SLOT_IDS = [${SLOT_IDS.map((s) => `'${s}'`).join(', ')}] as const;`);
  ts.push('export type SlotId = (typeof SLOT_IDS)[number];');
  ts.push('export const BADGE_LANGS = [' + BADGE_LANGS.map((l) => `'${l}'`).join(', ') + '] as const;');
  ts.push('export type BadgeLang = (typeof BADGE_LANGS)[number];');
  ts.push('export type BadgePalette = { [lang in BadgeLang]: { bg: string; text: string; border: string } };');
  ts.push(`export const BADGE_PALETTES: Record<string, BadgePalette> = ${JSON.stringify(Object.fromEntries(Object.entries(palettes).map(([id, p]) => [id, p.colors])), null, 2)};`);
  ts.push('export interface SkinDefinition { label: string; variant: \'dark\' | \'light\'; slots: Record<SlotId, string>; sources: Record<SlotId, string> }');
  ts.push(`export const SKINS: Record<string, SkinDefinition> = ${JSON.stringify(Object.fromEntries(Object.entries(table).map(([id, t]) => {
    const slots = Object.fromEntries(Object.entries(t.slots).concat([['badge-palette', t.badgePalette ?? 'none']]));
    const sources = Object.fromEntries(SLOTS.map((s) => [s.final, t.origins[s.final] ?? 'UNKNOWN']));
    sources['badge-palette'] = 'PALETTE:' + (t.badgePalette ?? 'none');
    return [id, { label: nameMap[id] ?? id, variant: t.variant, slots, sources }];
  })), null, 2)};`);
  const legacyNames = [...new Set(SLOTS.flatMap((s) => s.aliases).concat(BADGE_LANGS.flatMap((l) => ['bg', 'text', 'border'].map((p) => badgeSlotName(l, p)))))];
  ts.push(`export const LEGACY_VAR_NAMES = ${JSON.stringify(legacyNames)} as const;`);
  ts.push(`export const SKIN_ALIASES: Record<string, string> = ${JSON.stringify({ 'suet-jade': 'jade-white' })};`);
  ts.push('');
  fs.writeFileSync(SKINS_TS_PATH, ts.join('\n') + '\n');
  console.log(`[extract] skins.ts 写入，皮肤=${Object.keys(table).length} 槽=${SLOT_IDS.length} 调色板=${Object.keys(palettes).length} snapshot=${Object.keys(snapshot).length}套`);
  process.exit(0);
}

/* emit / --check：从 skins.ts 再生成标记区（真 .ts 导入，需 --experimental-strip-types） */
async function loadSkins() {
  try {
    return await import('file:///' + SKINS_TS_PATH.replace(/\\/g, '/'));
  } catch (e) {
    console.error('[emit] skins.ts 原生导入失败，确认用 node --experimental-strip-types 运行。' + (e instanceof Error ? e.message : String(e)));
    process.exit(1);
  }
}

const skins = await loadSkins();
const { SLOT_IDS: slotIds, SKINS: skinTable, BADGE_PALETTES: badgePalettes, SKIN_ALIASES: aliases } = skins;

function generateSection() {
  const out = [MARK_START];
  for (const [id, skin] of Object.entries(skinTable)) {
    const selectors = [`[data-theme="${id}"]`];
    for (const [aliasName, target] of Object.entries(aliases)) if (target === id) selectors.push(`[data-theme="${aliasName}"]`);
    const lines = [];
    for (const s of SLOTS) {
      const v = skin.slots[s.final];
      if (!v) throw new Error(`皮肤 ${id} 缺槽 ${s.final}，生成中止（不允许半成品皮肤上线）`);
      if (s.final === 'badge-palette') continue;
      lines.push(`  ${s.final}: ${v};`);
      for (const al of s.aliases) lines.push(`  ${al}: ${v};`);
    }
    const palId = skin.slots['badge-palette'];
    if (palId !== 'none') {
      const pal = badgePalettes[palId];
      if (!pal) throw new Error(`皮肤 ${id} 的 badge-palette=${palId} 未定义`);
      for (const lang of BADGE_LANGS) {
        lines.push(`  ${badgeSlotName(lang, 'bg')}: ${pal[lang].bg};`);
        lines.push(`  ${badgeSlotName(lang, 'text')}: ${pal[lang].text};`);
        lines.push(`  ${badgeSlotName(lang, 'border')}: ${pal[lang].border};`);
      }
    }
    out.push(selectors.join(',\n') + ' {', ...lines, '}');
  }
  out.push(MARK_END);
  return out.join('\n');
}

const generated = generateSection();
/* 换行归一比较：autocrlf 工作区（stash/pop、checkout 重写）与 LF 生成物必须等价判定，提交钩实证不对称会假红 */
const eol = cssSrc.includes('\r\n') ? '\r\n' : '\n';
const generatedForHost = generated.replace(/\n/g, eol);
const norm = (s) => s.replace(/\r\n/g, '\n');
if (mode === '--check' || mode === 'check') {
  const cur = cssSrc.slice(cssSrc.indexOf(MARK_START), cssSrc.indexOf(MARK_END) + MARK_END.length);
  if (norm(cur) === norm(generated)) { console.log('[check] OK：styles.css 标记区与 skins.ts 再生成一致（换行归一口径）'); process.exit(0); }
  console.error('[check] FAIL：styles.css 皮肤块被旁改，或 skins.ts 与运行时不一致');
  fs.writeFileSync(path.join(os.tmpdir(), 'hermes-skins-check-diff.txt'), cur + '\n---\n' + generated);
  process.exit(1);
}

let next;
if (hasMarker) {
  next = cssSrc.slice(0, cssSrc.indexOf(MARK_START)) + generatedForHost + cssSrc.slice(cssSrc.indexOf(MARK_END) + MARK_END.length);
} else {
  const perSkin = parseSkinBlocks(cssSrc);
  const firstBlockIdx = cssSrc.indexOf('[data-theme');
  const blocks = cssSrc.match(/\[data-theme[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g) || [];
  let removed = cssSrc;
  for (const b of blocks) {
    const sel = b.slice(0, b.indexOf('{')).replace(/\s+/g, ' ');
    if (sel.replace(/\[data-theme="[^"]+"\]/g, '').replace(/[,>~+ ]/g, '')) continue;
    removed = removed.replace(b, '');
  }
  next = removed.slice(0, firstBlockIdx) + generatedForHost + eol + eol + removed.slice(firstBlockIdx);
  void perSkin;
}
if (next !== cssSrc) {
  fs.writeFileSync(CSS_PATH, next);
  console.log('[emit] styles.css 皮肤标记区已再生成');
} else {
  console.log('[emit] styles.css 已是最新（幂等）');
}
