/**
 * 变异检验（Mutation Testing）：
 * 故意破坏 scanner / rules 的关键实现，验证测试是否真的会变红。
 * 若破坏后测试仍然全绿，说明该测试是假测试。
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const MUTATIONS = [
  {
    name: 'M1: 字符串闭合回退为 state=code（原 P0 缺陷）',
    file: 'scripts/gates/lib/scanner.mjs',
    from: '        leave();\n      }\n      continue;\n    }\n\n    if (state === \'htmlComment\')',
    to: '        state = \'code\';\n      }\n      continue;\n    }\n\n    if (state === \'htmlComment\')',
    expectFail: true,
  },
  {
    name: 'M2: 移除插值态处理（原 P0 缺陷）',
    file: 'scripts/gates/lib/scanner.mjs',
    from: "        if (c === '$' && next === '{') {\n          buf[i] = c;\n          buf[i + 1] = next;\n          i += 1;\n          interpDepths.push(0);\n          enter('interpolation');\n          continue;\n        }",
    to: '        // mutated: interpolation disabled',
    expectFail: true,
  },
  {
    name: 'M3: 十六进制色值退回 \\b 边界（原 P0 缺陷）',
    file: 'scripts/gates/rules.mjs',
    from: '/(?<![0-9a-zA-Z_&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-fA-F])/g,',
    to: '/#[0-9a-fA-F]{3}\\b/g,',
    expectFail: true,
  },
  {
    name: 'M4: 换肤规则直接 return []（规则空壳）',
    file: 'scripts/gates/rules.mjs',
    from: "  check(file, ctx) {\n    if (!isSkinSurface(file)) return [];\n    // 皮肤注册表与被剥离的调色板常量本身就是颜色权威源",
    to: "  check(file, ctx) {\n    if (true) return [];\n    if (!isSkinSurface(file)) return [];\n    // 皮肤注册表与被剥离的调色板常量本身就是颜色权威源",
    expectFail: true,
  },
  {
    name: 'M5: i18n 规则直接 return []（规则空壳）',
    file: 'scripts/gates/rules.mjs',
    from: "  check(file, ctx) {\n    if (!isSkinSurface(file)) return [];\n    if (I18N_EXEMPT.includes(file)) return [];",
    to: "  check(file, ctx) {\n    if (true) return [];\n    if (!isSkinSurface(file)) return [];\n    if (I18N_EXEMPT.includes(file)) return [];",
    expectFail: true,
  },
];

const TEST = 'packages/core/__tests__/architecture/gate-engine.test.mjs';
let survived = 0;

for (const m of MUTATIONS) {
  const orig = fs.readFileSync(m.file, 'utf8');
  if (!orig.includes(m.from)) {
    console.log(`  ⚠ 跳过（锚点未匹配）: ${m.name}`);
    continue;
  }
  fs.writeFileSync(m.file, orig.replace(m.from, m.to), 'utf8');
  let passed = true;
  try {
    execFileSync('node', ['--test', TEST], { encoding: 'utf8', stdio: 'pipe', timeout: 120000 });
  } catch {
    passed = false;
  } finally {
    fs.writeFileSync(m.file, orig, 'utf8');
  }
  const killed = m.expectFail ? !passed : passed;
  if (!killed) survived += 1;
  console.log(`  ${killed ? '✓ 已杀死' : '✗ 存活'}  ${m.name}`);
}

console.log(`\n变异体存活数: ${survived} / ${MUTATIONS.length}`);
console.log(survived === 0 ? '✓ 测试具备真实证伪能力' : '✗ 存在无效测试，必须补强');
process.exitCode = survived === 0 ? 0 : 1;
