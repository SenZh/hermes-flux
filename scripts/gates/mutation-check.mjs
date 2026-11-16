/**
 * 变异检验（Mutation Testing）：
 * 故意破坏 scanner / rules 的关键实现，验证测试是否真的会变红。
 * 若破坏后测试仍然全绿，说明该测试是假测试。
 *
 * 【防范的历史坑 (Pitfall)】锚点未匹配时曾打印警告后 `continue`，等于静默跳过该变异体：
 *   源码重构后所有锚点可能全部失配，脚本照样输出「存活 0/5，测试具备证伪能力」，
 *   而实际一个变异都没施加。这是门禁自证环节的假绿，必须改为硬失败。
 *
 * 【约束与规则 (Rules)】
 *   - 锚点必须唯一命中；命中 0 次或多次都判失败（多次会让 replace 改错位置）。
 *   - 变异体数量必须等于登记数量，少跑一个即失败。
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const MUTATIONS = [
  {
    name: 'M1: 字符串闭合回退为 state=code（原 P0 缺陷）',
    file: 'scripts/gates/lib/scanner.mjs',
    needle: 'leave();\n      }\n      continue;\n    }\n\n    if (state === \'htmlComment\')',
    replace: 'state = \'code\';\n      }\n      continue;\n    }\n\n    if (state === \'htmlComment\')',
    expectFail: true,
  },
  {
    name: 'M2: 移除插值态处理（原 P0 缺陷）',
    file: 'scripts/gates/lib/scanner.mjs',
    needle: "if (c === '$' && next === '{') {\n          buf[i] = c;\n          buf[i + 1] = next;\n          i += 1;\n          interpDepths.push(0);\n          enter('interpolation');\n          continue;\n        }",
    replace: '// mutated: interpolation disabled',
    expectFail: true,
  },
  {
    name: 'M3: 十六进制色值退回 \\b 边界（原 P0 缺陷）',
    file: 'scripts/gates/rules.mjs',
    needle: '/(?<![0-9a-zA-Z_&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-fA-F])/g,',
    replace: '/#[0-9a-fA-F]{3}\\b/g,',
    expectFail: true,
  },
  {
    name: 'M4: 换肤规则直接 return []（规则空壳）',
    file: 'scripts/gates/rules.mjs',
    needle: "const themeRules = {\n  id: 'theme',\n  gate: 'Gate 4',\n  title: '换肤一致性（零硬编码色相 / 全量走 Design Tokens）',\n  check(file, ctx) {\n    if (!isSkinSurface(file)) return [];",
    replace: "const themeRules = {\n  id: 'theme',\n  gate: 'Gate 4',\n  title: '换肤一致性（零硬编码色相 / 全量走 Design Tokens）',\n  check(file, ctx) {\n    return [];\n    if (!isSkinSurface(file)) return [];",
    expectFail: true,
  },
  {
    name: 'M5: i18n 规则直接 return []（规则空壳）',
    file: 'scripts/gates/rules.mjs',
    needle: "const i18nRules = {\n  id: 'i18n',\n  gate: 'Gate 4',\n  title: 'i18n（零硬编码文案，全量走 t() 字典）',\n  check(file, ctx) {\n    if (!isSkinSurface(file)) return [];",
    replace: "const i18nRules = {\n  id: 'i18n',\n  gate: 'Gate 4',\n  title: 'i18n（零硬编码文案，全量走 t() 字典）',\n  check(file, ctx) {\n    return [];\n    if (!isSkinSurface(file)) return [];",
    expectFail: true,
  },
];

const TEST = 'packages/core/__tests__/architecture/gate-engine.test.mjs';
let survived = 0;
let applied = 0;

for (const m of MUTATIONS) {
  const origRaw = fs.readFileSync(m.file, 'utf8');
  const isCrlf = origRaw.includes('\r\n');
  const normalized = origRaw.replace(/\r\n/g, '\n');

  /**
   * 锚点唯一性断言。
   * 源码被重构后锚点会失配，此时若继续"跳过"，本脚本会以 0 存活结束，
   * 报告出一种它其实从未验证过的置信度。因此失配必须是硬失败。
   */
  const occurrences = normalized.split(m.needle).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `变��体锚点失效（命中 ${occurrences} 次，必须恰好 1 次）: ${m.name}\n` +
        `  文件: ${m.file}\n` +
        '  处理方式：更新 needle 使其与当前源码一致。禁止删除该变异体或放宽为"跳过"。',
    );
  }

  const mutated = normalized.replace(m.needle, m.replace);
  fs.writeFileSync(m.file, isCrlf ? mutated.replace(/\n/g, '\r\n') : mutated, 'utf8');
  applied += 1;

  let passed = true;
  try {
    execFileSync('node', ['--test', TEST], { encoding: 'utf8', stdio: 'pipe', timeout: 120000 });
  } catch {
    passed = false;
  } finally {
    fs.writeFileSync(m.file, origRaw, 'utf8');
  }

  const killed = m.expectFail ? !passed : passed;
  if (!killed) survived += 1;
  console.log(`  ${killed ? '✓ 已杀死' : '✗ 存活'}  ${m.name}`);
}

console.log(`\n变异体存活数: ${survived} / ${MUTATIONS.length}（已施加 ${applied}）`);
if (applied !== MUTATIONS.length) {
  console.log(`✗ 只施加了 ${applied} / ${MUTATIONS.length} 个变异体，检验不完整`);
  process.exitCode = 1;
} else {
  console.log(survived === 0 ? '✓ 测试具备真实证伪能力' : '✗ 存在无效测试，必须补强');
  process.exitCode = survived === 0 ? 0 : 1;
}
