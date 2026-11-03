/**
 * 皮肤单一真值表守卫测试（PR-1a，双审二轮返工版）
 * 设计意图(Why)：守卫必须能独立证伪生成器——判据不复用生成器的选择器判型逻辑（二轮审查 P1：
 *   同源判型=同义反复，皮肤级变量藏进组件级 [data-theme] 块会双双失明）；新槽值按 HEAD 来源
 *   符号精确等值（值域包含式允许跨皮肤同值挪用，正是"皮肤串味"缺陷形态）。
 * 防范的历史坑(Pitfall)：marker 缺失时 indexOf=-1 令 slice 静默退化、报错指向伪因。
 * 约束与规则(Rules)：本 PR 一次性改名锚点用例（InputDock 7/MiddlePod 2/LeftRail 1）在波③舱迁移时随组件重写删除。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const CSS_REL = 'packages/desktop/src/renderer/styles.css';
const CSS = fs.readFileSync(path.join(ROOT, CSS_REL), 'utf8');
const MARK_START = '/* ═══ AUTO-GENERATED SKIN TABLE — 唯一真值源 packages/ui/src/tokens/skins.ts — 手改无效 ═══ */';
const MARK_END = '/* ═══ END AUTO-GENERATED SKIN TABLE ═══ */';

function loadSkinsTable() {
  const script = `import('file:///${path.join(ROOT, 'packages/ui/src/tokens/skins.ts').replace(/\\/g, '/')}').then(m => process.stdout.write(JSON.stringify({ slotIds: m.SLOT_IDS, skins: m.SKINS, palettes: m.BADGE_PALETTES, aliases: m.SKIN_ALIASES, legacy: m.LEGACY_VAR_NAMES })))`;
  return JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', '-e', script], { encoding: 'utf8' }));
}
const T = loadSkinsTable();

test('前置：标记区两个 marker 均存在且顺序正确（缺失即报本因，不许静默退化）', () => {
  const s = CSS.indexOf(MARK_START);
  const e = CSS.indexOf(MARK_END);
  assert.ok(s >= 0, 'styles.css 缺少 AUTO-GENERATED SKIN TABLE 起始标记');
  assert.ok(e > s, '结束标记缺失或先于起始标记');
});

test('槽表结构：43 槽、5 皮肤、别名表、字段仅 label/variant/slots/sources、中文名在表', () => {
  assert.equal(T.slotIds.length, 43);
  assert.equal(Object.keys(T.skins).length, 5);
  assert.deepEqual(T.aliases, { 'suet-jade': 'jade-white' });
  for (const skin of Object.values(T.skins)) {
    assert.deepEqual(Object.keys(skin).sort(), ['label', 'slots', 'sources', 'variant']);
  }
  assert.ok(T.skins['obsidian-gold'].label.includes('黑曜'));
});

test('variant 明暗精确断言', () => {
  assert.equal(T.skins['obsidian-gold'].variant, 'dark');
  assert.equal(T.skins['cyber-matrix'].variant, 'dark');
  for (const id of ['jade-white', 'ayu-light', 'warm-paper']) assert.equal(T.skins[id].variant, 'light');
});

test('槽完备 + 无 badge 皮肤显式 none + 调色板五语言齐全', () => {
  for (const [id, skin] of Object.entries(T.skins)) {
    for (const slot of T.slotIds) assert.ok(skin.slots[slot] && skin.slots[slot].length > 0, `${id} 缺槽 ${slot}`);
    const palId = skin.slots['badge-palette'];
    if (palId !== 'none') assert.equal(Object.keys(T.palettes[palId]).length, 5, `${palId} 五语言不齐`);
  }
  assert.equal(T.skins['cyber-matrix'].slots['badge-palette'], 'none');
});

test('再生成幂等：check 模式零差异', () => {
  execFileSync(process.execPath, ['--experimental-strip-types', path.join(ROOT, 'scripts/design-audit/emit-skins.mjs'), 'check'], { stdio: 'pipe' });
});

test('标记区外全文件禁止出现任何皮肤槽名（SLOT_IDS ∪ LEGACY 旧名）的 --x: 定义行——不依赖判型器的独立判据', () => {
  const outside = CSS.slice(0, CSS.indexOf(MARK_START)) + CSS.slice(CSS.indexOf(MARK_END) + MARK_END.length);
  const forbidden = new Set([...T.slotIds, ...T.legacy]);
  const hits = [...outside.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]).filter((n) => forbidden.has(n));
  assert.deepEqual(hits, [], `标记区外存在皮肤槽级定义（无论藏在何种选择器内均非法）: ${[...new Set(hits)].join(',')}`);
});

test('与 git HEAD 双向对账：旧名逐值等 + 新名按来源符号精确等值（HEAD/DERIVE/ROOT/CONST 白名单外一律红）', () => {
  const headSrc = execFileSync('git', ['show', `HEAD:${CSS_REL}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const rootBlock = (headSrc.match(/:root\s*\{[\s\S]*?\n\}/) ?? [''])[0];
  const rootVars = {};
  for (const m of rootBlock.matchAll(/(--[a-z0-9-]+):\s*([^;{}]+);/gi)) rootVars[m[1]] = m[2].trim();
  const headPer = {};
  for (const b of (headSrc.match(/\[data-theme[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g) ?? [])) {
    const sel = b.slice(0, b.indexOf('{')).replace(/\s+/g, ' ');
    const themes = [...new Set([...sel.matchAll(/\[data-theme="([^"]+)"\]/g)].map((m) => m[1]))];
    const body = b.slice(b.indexOf('{') + 1, b.lastIndexOf('}'));
    if (/\{/.test(body)) continue;
    const decls = {};
    for (const d of body.matchAll(/(--[a-z0-9-]+):\s*([^;{}]+);/gi)) decls[d[1]] = d[2].trim();
    if (!Object.keys(decls).length) continue;
    for (const t of themes) headPer[t] = { ...(headPer[t] ?? {}), ...decls };
  }
  const genSection = CSS.slice(CSS.indexOf(MARK_START), CSS.indexOf(MARK_END));
  const CONST_OK = { '--warning': '#F59E0B', '--destructive': '#EF4444' };
  for (const [skinId, def] of Object.entries(T.skins)) {
    const h = headPer[skinId];
    assert.ok(h, `HEAD 缺 ${skinId} 块`);
    for (const [name, value] of Object.entries(h)) {
      assert.ok(genSection.includes(`${name}: ${value};`), `${skinId} 旧名 ${name} 值漂移`);
    }
    for (const slot of T.slotIds) {
      if (slot === 'badge-palette') continue;
      const value = def.slots[slot];
      const origin = def.sources[slot];
      if (origin.startsWith('HEAD:')) {
        assert.equal(h[origin.slice(5)], value, `${skinId}.${slot} 来源 ${origin} 与 HEAD 等值断言失败`);
        assert.ok(!(slot in h) || h[slot] === value);
      } else if (origin.startsWith('DERIVE:')) {
        const base = origin.slice(7);
        assert.equal(value, def.slots[base], `${skinId}.${slot} 应等于本皮肤 ${base} 槽值`);
      } else if (origin.startsWith('ROOT:')) {
        assert.equal(rootVars[origin.slice(5)], value, `${skinId}.${slot} 应等于 HEAD :root 值`);
      } else if (origin.startsWith('CONST:')) {
        assert.equal(CONST_OK[slot], value, `${skinId}.${slot} 非常量白名单发明值`);
      } else {
        assert.fail(`${skinId}.${slot} 来源符号缺失(${origin})`);
      }
    }
  }
});

test('改名锚点：幽灵旧名在三个组件文件清零，新槽名计数=7/2/1（波③舱重写时随删）', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const dock = read('packages/ui/src/components/InputDock/InputDock.ts');
  const mid = read('packages/ui/src/components/MiddlePod/MiddlePod.ts');
  const rail = read('packages/ui/src/components/LeftRail/LeftRail.ts');
  for (const [name, src] of [['--bg-hover', dock], ['--bg-surface-1', dock], ['--bg-surface-1', mid], ['--bg-main', rail]]) {
    assert.equal((src.match(new RegExp('var\\(' + name, 'g')) ?? []).length, 0, `幽灵旧名 ${name} 复活`);
  }
  assert.equal((dock.match(/var\(--card-hover\)/g) ?? []).length, 3);
  assert.equal((dock.match(/var\(--popover\)/g) ?? []).length, 4);
  assert.equal((mid.match(/var\(--popover\)/g) ?? []).length, 2);
  assert.equal((rail.match(/var\(--background\)/g) ?? []).length, 1);
});

test('组件 var() 全部可解析：引用面 ⊆ 定义面（剥块注释/行尾注释；防新增悬空引用）', () => {
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out); else if (/\.(ts|css)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
  const defined = new Set();
  const referenced = new Map();
  for (const f of [...walk(path.join(ROOT, 'packages/ui/src')), ...walk(path.join(ROOT, 'packages/desktop/src'))]) {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1]);
    for (const m of src.matchAll(/setProperty\(\s*['"](--[a-z0-9-]+)['"]/g)) defined.add(m[1]);
    for (const m of src.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,)?/gi)) referenced.set(m[1], (referenced.get(m[1]) ?? false) || !m[2]);
  }
  const ghosts = [...referenced.entries()].filter(([name, noFallbackSeen]) => noFallbackSeen && !defined.has(name));
  assert.deepEqual(ghosts, [], `存在无定义的幽灵引用: ${ghosts.map((g) => g[0]).join(',')}`);
});
