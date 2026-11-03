/**
 * PR-1b 新增 5 条门禁探针行为与变异杀伤力单测
 *
 * 覆盖规则：
 * 1. ui/no-new-template-export：未登记模板文件与未登记 renderXxx 导出精准拦截，已冻结清单放行
 * 2. theme/no-inline-hex：模板字符串内联 style 十六进制色（含单行与跨行）拦截，gate-theme-allow 豁免
 * 3. theme/no-raw-monospace：裸写 font-family: monospace 拦截，var(--font-mono) 与豁免注释放行
 * 4. typo/no-literal-font-size：字面量 font-size: <数字>px 拦截，tokens/ 白名单与豁免注释放行
 * 5. theme/ghost-token：未在定义面声明且无 fallback 的 var(--x) 拦截，合法与带回退放行
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../../../scripts/gates/rules.mjs';

function getRule(id) {
  const r = RULES.find((item) => item.id === id);
  assert.ok(r, `未找到规则 ${id}`);
  return r;
}

test('1. ui/no-new-template-export 探针：新文件与新增 renderXxx 导出检测', () => {
  const rule = getRule('ui-template');

  // 正向：合法存量文件与合法导出
  const validCtx = {
    rawLines: ['export function renderBotProfileCard() {}'],
    stripped: 'export function renderBotProfileCard() {}',
    warnings: [],
  };
  rule.check('packages/ui/src/components/Bot/BotProfileCard.ts', validCtx);
  assert.equal(validCtx.warnings.length, 0, '存量已冻结导出不应产生告警');

  // 变异 1：既有文件新增未登记的 renderFoo 导出
  const invalidExportCtx = {
    rawLines: ['export function renderNewSneakyWidget() {}'],
    stripped: 'export function renderNewSneakyWidget() {}',
    warnings: [],
  };
  rule.check('packages/ui/src/components/Bot/BotProfileCard.ts', invalidExportCtx);
  assert.equal(invalidExportCtx.warnings.length, 1, '新增 renderXxx 导出必须报警');
  assert.match(invalidExportCtx.warnings[0].message, /禁止新增模板函数导出 renderNewSneakyWidget/);

  // 变异 2：新增全新的模板文件 (.ts)
  const newFileCtx = {
    rawLines: ['export function renderBrandNewModal() {}'],
    stripped: 'export function renderBrandNewModal() {}',
    warnings: [],
  };
  rule.check('packages/ui/src/components/FakeNewDir/FakeModal.ts', newFileCtx);
  assert.equal(newFileCtx.warnings.length, 1, '新增模板文件必须报警');
  assert.match(newFileCtx.warnings[0].message, /禁止新增模板组件文件/);

  // 负向白名单：ui/ 下的 shadcn 组件 (.tsx) 不受限制
  const reactCtx = {
    rawLines: ['export function CustomReactComponent() {}'],
    stripped: 'export function CustomReactComponent() {}',
    warnings: [],
  };
  rule.check('packages/ui/src/components/ui/button.tsx', reactCtx);
  assert.equal(reactCtx.warnings.length, 0, '.tsx 组件不受模板导出探针约束');
});

test('2. theme/no-inline-hex 探针：模板字符串内联 style 十六进制色检测', () => {
  const rule = getRule('theme-inline-hex');

  // 变异 1：单行内联 style 带十六进制色
  const singleLineCtx = {
    rawLines: ['<div style="color: #38BDF8;">test</div>'],
    stripped: '<div style="color: #38BDF8;">test</div>',
    warnings: [],
  };
  rule.check('packages/ui/src/components/TestComp/TestComp.ts', singleLineCtx);
  assert.equal(singleLineCtx.warnings.length, 1);
  assert.match(singleLineCtx.warnings[0].message, /#38BDF8/);

  // 变异 2：跨行 style="..." 内联样式
  const multiLineCode = `<div style="
    display: flex;
    background: #10B981;
    color: #EF4444;
  ">test</div>`;
  const multiLineCtx = {
    rawLines: multiLineCode.split('\n'),
    stripped: multiLineCode,
    warnings: [],
  };
  rule.check('packages/ui/src/components/TestComp/TestComp.ts', multiLineCtx);
  assert.equal(multiLineCtx.warnings.length, 2, '跨行 style 属性内的所有十六进制色均须抓取');

  // 豁免验证：gate-theme-allow 注释放行
  const allowedCode = `// gate-theme-allow: 演示用固定色
  <div style="color: #38BDF8;">test</div>`;
  const allowedCtx = {
    rawLines: allowedCode.split('\n'),
    stripped: allowedCode,
    warnings: [],
  };
  rule.check('packages/ui/src/components/TestComp/TestComp.ts', allowedCtx);
  assert.equal(allowedCtx.warnings.length, 0, 'gate-theme-allow 必须有效豁免');
});

test('3. theme/no-raw-monospace 探针：裸写 font-family: monospace 拦截', () => {
  const rule = getRule('theme-monospace');

  // 变异 1：裸写 font-family: monospace
  const rawCtx = {
    rawLines: ['font-family: monospace;'],
    codeLines: ['font-family: monospace;'],
    warnings: [],
  };
  rule.check('packages/ui/src/components/TestComp/TestComp.ts', rawCtx);
  assert.equal(rawCtx.warnings.length, 1);
  assert.match(rawCtx.warnings[0].message, /禁止裸写 font-family: monospace/);

  // 正向：使用 var(--font-mono) 或 var(--font-mono, monospace) 回退
  const validCtx = {
    rawLines: ['font-family: var(--font-mono, monospace);'],
    codeLines: ['font-family: var(--font-mono, monospace);'],
    warnings: [],
  };
  rule.check('packages/ui/src/components/TestComp/TestComp.ts', validCtx);
  assert.equal(validCtx.warnings.length, 0, '使用 var(--font-mono) 不应告警');
});

test('4. typo/no-literal-font-size 探针：字面量字号检测与白名单', () => {
  const rule = getRule('typo-font-size');

  // 变异 1：普通组件内裸写 font-size: 10.5px
  const literalCtx = {
    rawLines: ['<span style="font-size: 10.5px;">test</span>'],
    codeLines: ['<span style="font-size: 10.5px;">test</span>'],
    warnings: [],
  };
  rule.check('packages/ui/src/components/TestComp/TestComp.ts', literalCtx);
  assert.equal(literalCtx.warnings.length, 1);
  assert.match(literalCtx.warnings[0].message, /10.5px/);

  // 正向 1：使用变量 var(--fs-body)
  const varCtx = {
    rawLines: ['font-size: var(--fs-body);'],
    codeLines: ['font-size: var(--fs-body);'],
    warnings: [],
  };
  rule.check('packages/ui/src/components/TestComp/TestComp.ts', varCtx);
  assert.equal(varCtx.warnings.length, 0);

  // 正向 2：tokens 目录白名单豁免
  const tokensCtx = {
    rawLines: ['font-size: 16px;'],
    codeLines: ['font-size: 16px;'],
    warnings: [],
  };
  rule.check('packages/ui/src/tokens/typography.ts', tokensCtx);
  assert.equal(tokensCtx.warnings.length, 0, 'tokens/ 目录必须豁免');
});

test('5. theme/ghost-token 探针：幽灵 CSS 变量引用检测', () => {
  const rule = getRule('theme-ghost-token');

  // 变异 1：引用完全不存在的 CSS 变量且无 fallback
  const ghostCtx = {
    rawLines: ['color: var(--completely-unheard-of-ghost-token-xyz);'],
    codeLines: ['color: var(--completely-unheard-of-ghost-token-xyz);'],
    warnings: [],
  };
  rule.check('packages/ui/src/components/TestComp/TestComp.ts', ghostCtx);
  assert.equal(ghostCtx.warnings.length, 1);
  assert.match(ghostCtx.warnings[0].message, /引用未定义 CSS 变量/);

  // 正向 1：引用已定义的 CSS 变量（如 --background）
  const definedCtx = {
    rawLines: ['background: var(--background);'],
    codeLines: ['background: var(--background);'],
    warnings: [],
  };
  rule.check('packages/ui/src/components/TestComp/TestComp.ts', definedCtx);
  assert.equal(definedCtx.warnings.length, 0, '引用已知变量不应报警');

  // 正向 2：带回退值 var(--unknown-var, #fff)
  const fallbackCtx = {
    rawLines: ['background: var(--unknown-var, #fff);'],
    codeLines: ['background: var(--unknown-var, #fff);'],
    warnings: [],
  };
  rule.check('packages/ui/src/components/TestComp/TestComp.ts', fallbackCtx);
  assert.equal(fallbackCtx.warnings.length, 0, '具备回退值的变量引用安全放行');
});
