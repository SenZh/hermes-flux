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

test('皮肤槽位契约与数据完整性校验：所有槽位具有合法格式，且单一真值源自洽', () => {
  const genSection = CSS.slice(CSS.indexOf(MARK_START), CSS.indexOf(MARK_END));
  for (const [skinId, def] of Object.entries(T.skins)) {
    assert.ok(def.label, `${skinId} 必须具有 label`);
    assert.ok(def.variant === 'dark' || def.variant === 'light', `${skinId} variant 必须为 dark 或 light`);
    for (const slot of T.slotIds) {
      if (slot === 'badge-palette') {
        assert.ok(typeof def.slots[slot] === 'string', `${skinId}.${slot} 必须为字符串`);
        continue;
      }
      const value = def.slots[slot];
      assert.ok(value && typeof value === 'string', `${skinId}.${slot} 槽位缺失有效值`);
      // 断言生成块中确实输出了该槽位
      assert.ok(genSection.includes(`${slot}:`), `${skinId} 生成块缺少槽位 ${slot}`);
    }
  }
});

test('改名锚点：幽灵旧名在组件文件清零，新槽名计数稳定（波③舱重写时随删）', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const dock = read('packages/ui/src/components/InputDock/InputDock.ts');
  const mid = read('packages/ui/src/components/MiddlePod/MiddlePod.ts');
  // 左舵迁 React 后模板文件已删除，锚点改到新组件与其视图模型
  const railReact = read('packages/ui/src/components-react/LeftRail.tsx');
  const railModel = read('packages/ui/src/components-react/leftRailModel.ts');
  for (const [name, src] of [['--bg-hover', dock], ['--bg-surface-1', dock], ['--bg-surface-1', mid], ['--bg-main', railReact], ['--bg-main', railModel]]) {
    assert.equal((src.match(new RegExp('var\\(' + name, 'g')) ?? []).length, 0, `幽灵旧名 ${name} 复活`);
  }
  // 【舱重写】输入舱的配色已整体归口 conversation.css 的语义类，模板不再逐处消费
  // --card-hover / --popover。这两个计数随重写删除，改为断言模板里不再出现裸色消费点：
  // 输入舱模板只允许输出语义类名，任何 var(--*) 都必须留在样式表里。
  assert.equal((dock.match(/var\(--card-hover\)/g) ?? []).length, 0, '输入舱模板不得再消费 --card-hover');
  assert.equal((dock.match(/var\(--popover\)/g) ?? []).length, 1, '输入舱模板仅模型分组标题保留一处 --popover');
  // 工具胶囊模板链路已整体删除（流式补丁通道改用 ToolBlocks 组件静态渲染），
  // 因此 MiddlePod 不再有任何 --popover 消费点。
  assert.equal((mid.match(/var\(--popover\)/g) ?? []).length, 0, 'MiddlePod 工具模板删除后不得再残留 --popover 消费');
  // 旧模板曾直接内联消费 var(--background) 作为行底色；React 版改用语义 Token（bg-sidebar / bg-panel）
  assert.equal((railReact.match(/var\(--background\)/g) ?? []).length, 0, 'React 左轨不得直接消费 --background');
  assert.ok((railReact.match(/bg-sidebar|bg-panel|bg-card/g) ?? []).length > 0, 'React 左轨必须走语义背景 Token');
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
