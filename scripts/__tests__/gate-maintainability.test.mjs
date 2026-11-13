/**
 * 可维护性与测试完整性门禁的证伪测试。
 *
 * 【设计意图 (Why)】
 *   这两条规则守护的是"项目还能不能被继续修改"：文件规模上限与防糊弄。
 *   规则本身若失效，不会有任何报错，只会让超限文件与作弊手法慢慢堆积，
 *   因此必须用真实判定证明它确实会红，而不是"看起来有这条规则"。
 *
 * 【防范的历史坑 (Pitfall)】
 *   断言必须打在"判定的那一维"上：只断言"违规非空"会让一条见谁都报的坏实现
 *   也通过本测试。每条用例都同时给出"应当命中"与"必须放行"两侧。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileLineLimitRules, testIntegrityRules, FILE_LINE_LIMIT } from '../gates/rules/maintainability.mjs';
import { stripComments } from '../gates/lib/scanner.mjs';

/** 构造最小扫描上下文，口径与 run.mjs 的 makeScanCtx 一致 */
function ctxOf(src) {
  return { ...stripComments(src), warnings: [] };
}

const checkFile = (rule, file, src) => rule.check(file, ctxOf(src));

/**
 * 生成"按 split('\n') 计恰好 n 行"的合法源码。
 *
 * 【约束与规则 (Rules)】行数口径必须与 run.mjs 一致（`ctx.rawLines.length`），
 * 也就是末尾换行会产生一个空项。这里显式对齐，避免边界测试整体差一行而
 * 变成"测了一个不是边界的边界"。
 */
function lines(n) {
  return Array.from({ length: n }, (_, i) => `const v${i} = ${i};`).join('\n');
}

/* ---------------- 单文件行数上限 ---------------- */

test('size · 恰好等于上限必须放行（边界闭合，避免"差一行也红"）', () => {
  const file = 'packages/ui/src/tmp/exactly-limit.ts';
  const found = checkFile(fileLineLimitRules, file, lines(FILE_LINE_LIMIT));
  assert.deepEqual(found, []);
});

test('size · 超过上限一行即阻断，且报出可执行的拆分指令', () => {
  const file = 'packages/ui/src/tmp/over-limit.ts';
  const found = checkFile(fileLineLimitRules, file, lines(FILE_LINE_LIMIT + 1));
  assert.equal(found.length, 1);
  assert.equal(found[0].ruleId, 'size/oversize-new');
  assert.match(found[0].message, /拆分为多个模块/);
  assert.equal(found[0].line, FILE_LINE_LIMIT + 1);
});

test('size · 已登记的存量文件在登记值内放行，涨过登记值即阻断', async () => {
  const { KNOWN_OVERSIZE } = await import('../gates/rules/maintainability.mjs');
  const file = 'packages/desktop/src/renderer/index.ts';
  const registered = KNOWN_OVERSIZE[file].max;

  // 等于登记值必须放行（边界闭合）
  const atLimit = checkFile(fileLineLimitRules, file, lines(registered));
  assert.deepEqual(atLimit, [], `等于登记值 ${registered} 必须放行`);

  const grown = checkFile(fileLineLimitRules, file, lines(registered + 1));
  assert.equal(grown.length, 1);
  assert.equal(grown[0].ruleId, 'size/oversize-grown');
  assert.match(grown[0].message, /只允许继续拆分/);
});

test('size · 已登记文件降到上限以下时给出"可移除登记"提示而非阻断', () => {
  const file = 'packages/ui/src/components/InspectionPod/InspectionPod.ts';
  const ctx = ctxOf(lines(800));
  const found = fileLineLimitRules.check(file, ctx);
  assert.deepEqual(found, [], '达标不得阻断');
  assert.equal(ctx.warnings.length, 1);
  assert.equal(ctx.warnings[0].ruleId, 'size/oversize-paid-off');
});

test('size · 生成产物豁免，样式表与文档不参与判定', () => {
  assert.deepEqual(
    checkFile(fileLineLimitRules, 'packages/core/src/rpc/contracts/gateway-contract.generated.ts', lines(9000)),
    [],
    '生成产物由生成器负责，人工拆分无意义',
  );
  assert.deepEqual(checkFile(fileLineLimitRules, 'packages/ui/src/styles/huge.css', lines(5000)), []);
  assert.deepEqual(checkFile(fileLineLimitRules, 'docs/huge.md', lines(5000)), []);
});

/* ---------------- 测试完整性 ---------------- */

test('test-integrity · 源码里的 c8 ignore 注释阻断；文档块与诊断文案不误报', () => {
  const hit = checkFile(
    testIntegrityRules,
    'packages/core/src/cache/x.ts',
    'const a = 1;\n/* c8 ignore next */\nconst b = 2;\n',
  );
  assert.equal(hit.length, 1);
  assert.equal(hit[0].ruleId, 'test-integrity/c8-ignore');

  // 文档块里的写法示例（行首 `*`）不是豁免申请
  const doc = checkFile(
    testIntegrityRules,
    'packages/core/src/cache/y.ts',
    '/**\n * 示例：用 /* c8 ignore next *\\/ 可以屏蔽\n */\nconst a = 1;\n',
  );
  assert.deepEqual(doc, [], '文档块里的示例不得计入');

  // 规则自己的诊断文案（字符串字面量）不是豁免申请
  const inString = checkFile(
    testIntegrityRules,
    'scripts/gates/rules/z.mjs',
    "const msg = '禁止写 /* c8 ignore next */，请补测试';\n",
  );
  assert.deepEqual(inString, [], '字符串里的说明不得计入');
});

test('test-integrity · 测试文件的强制成功退出阻断，显式失败退出放行', () => {
  const file = 'packages/core/__tests__/fake.test.mjs';

  const forced = checkFile(testIntegrityRules, file, "import test from 'node:test';\nprocess.exit(0);\n");
  assert.equal(forced.length, 1);
  assert.equal(forced[0].ruleId, 'test-integrity/test-exit');
  assert.match(forced[0].message, /吞成全绿/);

  const failFast = checkFile(testIntegrityRules, file, 'process.exit(1);\n');
  assert.deepEqual(failFast, [], '显式失败退出是合法的');

  const exitCode = checkFile(testIntegrityRules, file, 'process.exitCode = 1;\n');
  assert.deepEqual(exitCode, [], 'process.exitCode = 非 0 是合法的');
});

test('test-integrity · 生产代码的 process.exit 不受本规则限制', () => {
  const found = checkFile(testIntegrityRules, 'scripts/gates/run.mjs', 'process.exit(0);\n');
  assert.deepEqual(found, [], '门禁脚本本身需要退出码，不在拦截面内');
});

test('test-integrity · 豁免注释计入本文件警告计数，但文档块与字符串里的写法示例不计入', () => {
  const real = ctxOf('// gate-theme-allow: 与站点卡逐像素对齐\nconst a = 1;\n');
  const found = testIntegrityRules.check('packages/ui/src/components-react/LeftRail.tsx', real);
  assert.deepEqual(found, [], '合法豁免不得被判成违规（否则会逼人删掉本该保留的理由）');
  assert.equal(real.warnings.length, 1, '豁免条数必须每次运行都可见');
  assert.match(real.warnings[0].message, /1 条行内豁免/);

  // 文档块里的写法示例
  const doc = ctxOf('/**\n * 用法：写 `gate-theme-allow: 理由`\n */\n');
  assert.deepEqual(testIntegrityRules.check('scripts/gates/lib/scanner.mjs', doc), []);
  assert.deepEqual(doc.warnings, [], '文档示例不得计入敞口');

  // 门禁自己的诊断文案（字符串字面量）
  const inString = ctxOf("const msg = '请写 // gate-theme-allow: 理由';\n");
  assert.deepEqual(testIntegrityRules.check('scripts/gates/run.mjs', inString), []);
  assert.deepEqual(inString.warnings, [], '诊断文案不得计入敞口');
});

test('test-integrity · 两条规则均已注册进 RULES，且 id 唯一', async () => {
  const { RULES } = await import('../gates/rules.mjs');
  const ids = RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, '规则 id 必须唯一，否则 byRule 统计会串台');
  assert.ok(ids.includes('size'), 'size 规则必须已注册');
  assert.ok(ids.includes('test-integrity'), 'test-integrity 规则必须已注册');
});
