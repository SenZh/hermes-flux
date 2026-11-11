import test from 'node:test';
import assert from 'node:assert/strict';

import { RULES, visualRules } from '../gates/rules.mjs';
import { stripComments } from '../gates/lib/scanner.mjs';

/**
 * Gate 4e「视觉契约」规则组单测
 *
 * 【设计意图 (Why)】
 *   这组规则的全部杀伤力都建立在两个易碎前提上：① 只分析「类名上下文」的字面量；
 *   ② 跨行 cn(...) 与同名 token 去重都要精确到行。二者任一退化都会让门禁变成
 *   「要么全员误报被注释掉、要么全程静默零命中」的假绿。因此每个规则都必须同时有
 *   违规样例（证明有杀伤力）与合规样例（证明不误伤设计系统本体的语义档）。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 曾经的探针只写「合规样例断言 0 条」，结果规则其实从未真正命中过任何违规
 *      （恒等式空断言），这里每个阻断规则都强制要求命中数严格等于 1；
 *   2. 注释里的示例代码（`// 禁止 rounded-md`）是最经典的误报源，单独设一项断言；
 *   3. text-center / text-foreground / rounded-full / shadow-none 是四类最容易被
 *      粗糙正则误伤的合法类，必须逐一钉死。
 *
 * 【约束与规则 (Rules)】
 *   - 只用 synthetic ctx（stripComments 构造），绝不读写工作区真实组件文件：
 *     并行迁移期间真实文件每天在变，把真实文件冻进断言会制造「红一天再被基线吃掉」的假门禁；
 *   - 真实仓库口径的命中数由 `node scripts/gates/run.mjs --json` 验收，不写进单测。
 */

const TSX = 'packages/ui/src/components-react/__synthetic__/Sample.tsx';
const CSS_UI = 'packages/ui/src/styles/__synthetic__.css';

/** 用与生产完全相同的注释剥离器构造 ctx，保证判定口径零偏差 */
function makeCtx(src) {
  return { ...stripComments(src), warnings: [] };
}

function ruleOf(id) {
  const rule = RULES.find((r) => r.id === id);
  assert.ok(rule, `规则 ${id} 未注册进 RULES 导出`);
  return rule;
}

/** 跑一条规则，返回 { violations, warnings } */
function runRule(id, src, file = TSX) {
  const ctx = makeCtx(src);
  const violations = ruleOf(id).check(file, ctx);
  return { violations, warnings: ctx.warnings };
}

/** 断言某条阻断规则在样例上精确命中 n 条 */
function assertHits(id, src, n, file = TSX) {
  const { violations, warnings } = runRule(id, src, file);
  assert.equal(violations.length, n, `${id} 命中数应为 ${n}，实际 ${violations.length}：${JSON.stringify(violations.map((v) => v.message))}`);
  assert.equal(warnings.length, 0, `${id} 是阻断规则，不得写入 warnings`);
  return violations;
}

/** 断言某条警告规则在样例上精确产出 n 条 ctx.warnings（且零阻断） */
function assertWarnings(id, src, n, file = TSX) {
  const { violations, warnings } = runRule(id, src, file);
  assert.equal(violations.length, 0, `${id} 是警告规则，必须返回空违规数组`);
  assert.equal(warnings.length, n, `${id} 警告数应为 ${n}，实际 ${warnings.length}`);
  return warnings;
}

/* ================================================================== *
 * 0. 规则组装配契约
 * ================================================================== */

test('visualRules 已全部装配进 RULES，且统一归属 Gate 4', () => {
  assert.equal(visualRules.length, 9);
  for (const rule of visualRules) {
    assert.ok(RULES.includes(rule), `${rule.id} 未进入 RULES 导出`);
    assert.equal(rule.gate, 'Gate 4', `${rule.id} 必须归属 Gate 4`);
    assert.equal(typeof rule.check, 'function');
  }
  const ids = visualRules.map((r) => r.id);
  assert.deepEqual(ids, [
    'visual/no-raw-palette',
    'visual/no-legacy-radius',
    'visual/no-shadow-scale',
    'visual/no-raw-font-scale',
    'visual/no-raw-font-family',
    'visual/no-raw-font-family-decl',
    'visual/token-fallback-drift',
    'visual/no-arbitrary-value',
    'visual/fractional-spacing',
  ]);
});

test('作用域外路径一律零命中（不波及 components/ 存量模板组件与 core）', () => {
  const src = `<div className="bg-zinc-800 rounded-md shadow-lg text-sm" />;`;
  for (const file of [
    'packages/ui/src/components/Legacy/Legacy.ts',
    'packages/core/src/session/displayKind.ts',
    'packages/desktop/src/renderer/index.ts',
    'scripts/gates/rules.mjs',
  ]) {
    for (const rule of visualRules) {
      const ctx = makeCtx(src);
      assert.deepEqual(rule.check(file, ctx), [], `${rule.id} 在 ${file} 上越界命中`);
      assert.equal(ctx.warnings.length, 0, `${rule.id} 在 ${file} 上越界告警`);
    }
  }
});

/* ================================================================== *
 * 1. 阻断规则：违规样例必须精确命中（杀伤力）
 * ================================================================== */

test('visual/no-raw-palette：原生调色板类必须阻断', () => {
  assertHits('visual/no-raw-palette', `<div className="bg-zinc-800" />;`, 1);
  assertHits('visual/no-raw-palette', `<div className="text-gray-400" />;`, 1);
  assertHits('visual/no-raw-palette', `<div className="border-neutral-700" />;`, 1);
  // /opacity 变体与 white|black 同样属于硬编码色相
  assertHits('visual/no-raw-palette', `<div className="bg-white/10" />;`, 1);
  assertHits('visual/no-raw-palette', `<div className="hover:bg-black/60" />;`, 1);
});

test('visual/no-legacy-radius：rounded-sm/md/lg/xl 旧档必须阻断（含方向变体）', () => {
  assertHits('visual/no-legacy-radius', `<div className="rounded-md" />;`, 1);
  assertHits('visual/no-legacy-radius', `<div className="rounded-2xl" />;`, 1);
  assertHits('visual/no-legacy-radius', `<div className="rounded-t-lg" />;`, 1);
});

test('visual/no-shadow-scale：shadow-sm/md/lg/xl 旧档必须阻断', () => {
  assertHits('visual/no-shadow-scale', `<div className="shadow-lg" />;`, 1);
  assertHits('visual/no-shadow-scale', `<div className="shadow-md" />;`, 1);
  assertHits('visual/no-shadow-scale', `<div className="shadow-inner" />;`, 1);
});

test('visual/no-raw-font-scale：text-xs/sm/base/lg/xl 原生字阶必须阻断', () => {
  assertHits('visual/no-raw-font-scale', `<div className="text-sm" />;`, 1);
  assertHits('visual/no-raw-font-scale', `<div className="text-base" />;`, 1);
  assertHits('visual/no-raw-font-scale', `<div className="text-2xl" />;`, 1);
});

test('每条阻断规则的 message 都是可执行修复指令（含目标档位与像素值）', () => {
  const [radius] = assertHits('visual/no-legacy-radius', `<div className="rounded-md" />;`, 1);
  assert.match(radius.message, /rounded-card/);
  assert.match(radius.message, /6px/);
  assert.match(radius.message, /rounded-inner/);
  assert.match(radius.message, /4px/);

  const [shadow] = assertHits('visual/no-shadow-scale', `<div className="shadow-lg" />;`, 1);
  assert.match(shadow.message, /shadow-window/);

  const [font] = assertHits('visual/no-raw-font-scale', `<div className="text-sm" />;`, 1);
  assert.match(font.message, /text-section/);
  assert.match(font.message, /14px/);

  const [palette] = assertHits('visual/no-raw-palette', `<div className="bg-zinc-800" />;`, 1);
  assert.match(palette.message, /bg-card/);
});

/* ================================================================== *
 * 2. 阻断规则：合规样例必须零命中（不误伤设计系统本体）
 * ================================================================== */

test('四类阻断规则在合法档位上零命中', () => {
  const legal = `<div className="rounded-card rounded-inner rounded-panel rounded-window rounded-full shadow-card shadow-window shadow-dock shadow-none text-hero text-title text-section text-body text-aux text-caption text-micro bg-card bg-panel text-foreground text-muted-foreground border-border-subtle" />;`;
  for (const id of ['visual/no-raw-palette', 'visual/no-legacy-radius', 'visual/no-shadow-scale', 'visual/no-raw-font-scale']) {
    assertHits(id, legal, 0);
  }
});

test('误报防护：text-center / text-foreground / rounded-full / shadow-none 一律不得命中', () => {
  const traps = `<div className="text-center text-foreground text-balance text-pretty rounded-full rounded-bl-full shadow-none border-transparent divide-y" />;`;
  for (const id of ['visual/no-raw-palette', 'visual/no-legacy-radius', 'visual/no-shadow-scale', 'visual/no-raw-font-scale']) {
    assertHits(id, traps, 0);
  }
});

test('误报防护：注释里的示例代码不得命中', () => {
  const src = [
    '// 反例：禁止 rounded-md / shadow-lg / text-sm / bg-zinc-800',
    '/* <div className="rounded-xl shadow-2xl text-xs bg-neutral-700" /> */',
    'const hint = "rounded-md";',
  ].join('\n');
  for (const id of ['visual/no-raw-palette', 'visual/no-legacy-radius', 'visual/no-shadow-scale', 'visual/no-raw-font-scale']) {
    assertHits(id, src, 0);
  }
});

test('误报防护：非类名上下文的字符串（i18n key / 属性值 / 正则）不得命中', () => {
  const src = [
    `const label = t('settings.text-sm');`,
    `const size = 'sm';`,
    `<Button size="md" variant="ghost" />;`,
    `const re = /rounded-md|shadow-lg/g;`,
  ].join('\n');
  for (const id of ['visual/no-raw-palette', 'visual/no-legacy-radius', 'visual/no-shadow-scale', 'visual/no-raw-font-scale']) {
    assertHits(id, src, 0);
  }
});

/* ================================================================== *
 * 3. 跨行 className（cn 换行写法）必须被捕获
 * ================================================================== */

test('跨行 cn(...) 的类名必须被捕获，且行号指向真实违规行', () => {
  const src = [
    'const Card = () => (',
    '  <div',
    '    className={cn(',
    `      'flex flex-col',`,
    `      active && 'rounded-md',`,
    `      'shadow-lg',`,
    '    )}',
    '  />',
    ');',
  ].join('\n');
  const radius = assertHits('visual/no-legacy-radius', src, 1);
  assert.equal(radius[0].line, 5);
  const shadow = assertHits('visual/no-shadow-scale', src, 1);
  assert.equal(shadow[0].line, 6);
});

test('cva(...) 变体表里的类名必须被捕获（变体键不得被当成类名）', () => {
  const src = [
    'const v = cva(\'inline-flex rounded-md\', {',
    '  variants: {',
    `    size: { sm: 'h-8 rounded-sm px-3', lg: 'h-10 rounded-lg' },`,
    '  },',
    '});',
  ].join('\n');
  const hits = assertHits('visual/no-legacy-radius', src, 3);
  assert.deepEqual(
    hits.map((h) => /禁止 (rounded-[a-z0-9]+)/.exec(h.message)?.[1]),
    ['rounded-md', 'rounded-sm', 'rounded-lg'],
  );
  // 变体键（sm/lg 单标识符）不得被当成类名单独上报
  assert.deepEqual([...new Set(hits.map((h) => h.line))], [1, 3]);
});

test('类名映射表（LEVEL_CLASS / TONE_CLASS）里的类名必须被捕获', () => {
  const src = [
    'const TONE_CLASS: Record<string, string> = {',
    `  danger: 'bg-red-500',`,
    `  calm: 'bg-card',`,
    '};',
  ].join('\n');
  // 键（danger/calm）不是类名列表，不得上报；值必须上报
  assertHits('visual/no-raw-palette', src, 1);
  assertHits('visual/no-raw-palette', `const v = { kind: 'ghost' };`, 0);
});

/* ================================================================== *
 * 4. 兜底值漂移（阻断）
 * ================================================================== */
test('visual/token-fallback-drift：兜底值与 :root 真值不一致必须阻断', () => {
  // :root 真值 --radius-inner: 4px（packages/desktop/src/renderer/styles.css）
  const bad = assertHits('visual/token-fallback-drift', '.x { border-radius: var(--radius-inner, 6px); }', 1, CSS_UI);
  assert.match(bad[0].message, /4px/);
  assert.match(bad[0].message, /6px/);
  // 一致则放行
  assertHits('visual/token-fallback-drift', '.x { border-radius: var(--radius-inner, 4px); }', 0, CSS_UI);
  // TSX 内联 style 里的同一漂移同样要抓
  assertHits('visual/token-fallback-drift', `<div style={{ borderRadius: 'var(--radius-inner, 6px)' }} />;`, 1);
});

test('visual/token-fallback-drift：未定义 Token 与复合值不归本规则管（避免与 ghost-token 抢活）', () => {
  assertHits('visual/token-fallback-drift', '.x { border-radius: var(--not-defined-token, 6px); }', 0, CSS_UI);
  assertHits('visual/token-fallback-drift', '.x { width: var(--geo-titlebar, calc(1px + 2px)); }', 0, CSS_UI);
  // 与真值一致的几何 Token 同样放行
  assertHits('visual/token-fallback-drift', '.x { height: var(--geo-titlebar, 42px); }', 0, CSS_UI);
});

/* ================================================================== *
 * 5. 行内豁免
 * ================================================================== */

test('gate-theme-allow 行内豁免（上一行写理由）对所有规则生效', () => {
  const src = [
    'const Card = () => (',
    '  // gate-theme-allow: 与 Figma 标注一一对应，产品已确认',
    `  <div className="rounded-md shadow-lg gap-1.5" />`,
    ');',
  ].join('\n');
  for (const rule of visualRules) {
    if (rule.id === 'visual/token-fallback-drift') continue;
    const ctx = makeCtx(src);
    assert.deepEqual(rule.check(TSX, ctx), [], `${rule.id} 未尊重行内豁免`);
    assert.equal(ctx.warnings.length, 0, `${rule.id} 未尊重行内豁免（warnings）`);
  }
});

test('gate-theme-allow 同行注解亦可豁免', () => {
  const src = `<div className="rounded-md" />; // gate-theme-allow: 第三方浮层对齐`;
  assertHits('visual/no-legacy-radius', src, 0);
});

/* ================================================================== *
 * 6. 警告型：不阻断但必须可见
 * ================================================================== */

test('visual/no-arbitrary-value：任意值只警告不阻断，Radix 变体语法豁免', () => {
  const [w] = assertWarnings('visual/no-arbitrary-value', `<div className="w-[212px]" />;`, 1);
  assert.equal(w.line, 1);
  assert.match(w.message, /w-\[212px\]/);
  assert.match(w.message, /gate-theme-allow/);

  // 豁免清单：data- / aria- / group-data- / peer-data- / has- / supports- / content-
  assertWarnings(
    'visual/no-arbitrary-value',
    `<div className="data-[state=open]:bg-card aria-[label=x]:p-2 group-data-[x=y]:p-1 peer-data-[a=b]:p-1 has-[>svg]:p-1 supports-[x=y]:p-1 content-['']:p-1" />;`,
    0,
  );
});

test('visual/fractional-spacing：小数间距只警告不阻断，4px 整数倍放行', () => {
  const warnings = assertWarnings('visual/fractional-spacing', `<div className="gap-1.5" />;`, 1);
  assert.match(warnings[0].message, /6px/);
  assert.match(warnings[0].message, /gap-1/);
  assert.match(warnings[0].message, /gap-2/);

  assertWarnings('visual/fractional-spacing', `<div className="gap-1 gap-2 p-4 px-3 size-8 top-0" />;`, 0);
  // 分数写法 w-1/2 不是小数档，不在本规则范围
  assertWarnings('visual/fractional-spacing', `<div className="w-1/2" />;`, 0);
});

test('警告型规则同样不得把命中写进阻断数组（否则门禁当天变红）', () => {
  const src = `<div className="w-[212px] gap-1.5" />;`;
  for (const id of ['visual/no-arbitrary-value', 'visual/fractional-spacing']) {
    const { violations } = runRule(id, src);
    assert.deepEqual(violations, [], `${id} 不得产出阻断违规`);
  }
});
