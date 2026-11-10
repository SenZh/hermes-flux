import test from 'node:test';
import assert from 'node:assert/strict';

import { RULES } from '../gates/rules.mjs';
import { stripComments } from '../gates/lib/scanner.mjs';

/**
 * 字体族契约单测（Gate 4e · font）
 *
 * 【设计意图 (Why)】
 *   全系统只承认两种字体角色：界面字体与代码字体，二者都是皮肤槽位 --font-sans / --font-mono，
 *   由设置页在运行时写进 :root。任何写死字体栈的写法都会让该组件永久脱离用户偏好。
 *   这两条规则分别守类名面与样式表面，缺一条就会出现"React 岛跟随、遗留样式不跟随"的分裂。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. `font-sans` 在 Tailwind 里是默认字体栈，看起来"很规范"，实则是绕开皮肤；
 *      只靠 code review 抓不住，必须由规则钉死；
 *   2. 样式表里的 @font-face 用 font-family 声明字体自身，若规则不豁免它，
 *      门禁会把字体注册当违规，第一条真违规反而被淹没。
 *
 * 【约束与规则 (Rules)】
 *   - 只用 synthetic ctx，不读写真实组件文件；
 *   - 每条规则都必须同时有违规样例（证明杀伤力）与合规样例（证明不误伤）。
 */

const TSX = 'packages/ui/src/components-react/__synthetic__/FontSample.tsx';
const CSS_UI = 'packages/ui/src/styles/__synthetic-font.css';

function makeCtx(src) {
  return { ...stripComments(src), warnings: [] };
}

function ruleOf(id) {
  const rule = RULES.find((r) => r.id === id);
  assert.ok(rule, `规则 ${id} 未注册进 RULES 导出`);
  return rule;
}

function runRule(id, src, file) {
  const ctx = makeCtx(src);
  const violations = ruleOf(id).check(file, ctx);
  return { violations, warnings: ctx.warnings };
}

test('visual/no-raw-font-family：Tailwind 默认字体栈必须被拦下', () => {
  const bad = `const cls = cn('font-ui', 'font-sans', 'font-serif', 'font-mono');`;
  const { violations } = runRule('visual/no-raw-font-family', bad, TSX);
  assert.equal(violations.length, 3, `应命中 3 条，实际 ${violations.length}`);
  for (const v of violations) {
    assert.match(v.message, /font-ui|font-code/, '修复指引必须给出合法写法');
  }
});

test('visual/no-raw-font-family：合法写法与近似词不得误伤', () => {
  const good = `
    const a = cn('font-ui', 'text-body');
    const b = cn('font-code', 'text-caption');
    const c = 'font-family: var(--font-sans)';
    const d = 'font-medium font-semibold';
  `;
  const { violations } = runRule('visual/no-raw-font-family', good, TSX);
  assert.equal(violations.length, 0, `合规样例不得命中，实际 ${JSON.stringify(violations.map((v) => v.message))}`);
});

test('visual/no-raw-font-family：注释里的示例不参与判定', () => {
  const src = `// 禁止 font-sans，改用 font-ui\nconst cls = cn('font-ui');`;
  const { violations } = runRule('visual/no-raw-font-family', src, TSX);
  assert.equal(violations.length, 0);
});

test('visual/no-raw-font-family-decl：样式表裸写字体栈必须被拦下', () => {
  const bad = `.title { font-family: "JetBrains Mono", Consolas, monospace; }`;
  const { violations } = runRule('visual/no-raw-font-family-decl', bad, CSS_UI);
  assert.equal(violations.length, 1, `应命中 1 条，实际 ${violations.length}`);
  assert.match(violations[0].message, /var\(--font-sans\)|var\(--font-mono\)/);
});

test('visual/no-raw-font-family-decl：@font-face 注册与全局关键字必须豁免', () => {
  const src = `
    @font-face { font-family: 'IBM Plex Sans'; src: url('x.woff2'); }
    .a { font-family: var(--font-sans); }
    .b { font-family: inherit; }
    .c { font-family: var(--font-mono); }
  `;
  const { violations } = runRule('visual/no-raw-font-family-decl', src, CSS_UI);
  assert.equal(violations.length, 0, `错误命中：${JSON.stringify(violations.map((v) => v.message))}`);
});

test('visual/no-raw-font-family-decl：只作用于样式表，不对 TSX 误判', () => {
  const src = `const s = "font-family: 'Inter', sans-serif";`;
  const { violations } = runRule('visual/no-raw-font-family-decl', src, TSX);
  assert.equal(violations.length, 0, '样式表规则不得在 TSX 上生效');
});

test('两条字体规则均为阻断型，且已注册进 RULES', () => {
  for (const id of ['visual/no-raw-font-family', 'visual/no-raw-font-family-decl']) {
    const rule = ruleOf(id);
    const ctx = makeCtx(`const cls = cn('font-sans');`);
    const out = rule.check(TSX, ctx);
    assert.ok(Array.isArray(out), `${id} 必须返回违规数组`);
  }
});
