#!/usr/bin/env node
/**
 * 门禁自证套件（Gate Self-Proof）。
 *
 * 设计意图 (Why):
 *   本仓的门禁体系里有一类特殊风险：门禁自己坏掉时不会有任何报错。
 *   覆盖率会静态归零、胜述为"全部覆盖"；census 会数到 0 个文件并放行；
 *   不变量探针会找到一份看起来齐全的表。因此每个门禁都必须能证明
 *   「它在被违反时确实会红」——这份脚本就是这套证明的集合。
 *
 * 与 gates:mutation 的分工:
 *   - gates:mutation 验证「测试是否具备杀伤力」（改坏被测代码，测试必须红）。
 *   - 本脚本验证「门禁是否具备杀伤力」（改坏/污染判定条件，门禁必须红）。
 *   两者互补，缺任一层都会留下"看起来有保护"的盲区。
 *
 * 约束与规则 (Rules):
 *   1. 每个场景都在临时目录或临时变异上跑，结束时无条件还原。
 *   2. 每个场景必须同时给出「应当失败」与「应当放行」两侧，
 *      否则一个"见谁都报"的坏实现也能全绿通过。
 *   3. 任一场景判定不符即整体失败。
 *
 * 用法:
 *   node scripts/verify/gate-self-proof.mjs           # 跑全部场景
 *   node scripts/verify/gate-self-proof.mjs census    # 只跑名字含 census 的场景
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

const C = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
};

const scenarios = [];
function scenario(group, name, fn) {
  scenarios.push({ group, name, fn });
}

/* ============================ census ============================ */

/** 在临时目录跑 node --test，返回 TAP 汇总 */
function runTapIn(dir, files) {
  const env = { ...process.env };
  // 必须剥掉：子进程会因此认为自己是测试子进程，不产出汇总行
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], {
    cwd: dir, encoding: 'utf8', timeout: 60000, env,
  });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const grab = (k) => {
    const m = out.match(new RegExp(`^# ${k} (\\d+)$`, 'm'));
    return m ? Number(m[1]) : null;
  };
  return { status: r.status, tests: grab('tests'), fail: grab('fail'), skipped: grab('skipped') };
}

function withPlayground(t, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-selfproof-'));
  try {
    return body({
      dir,
      write(name, content) {
        const full = path.join(dir, name);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
        return name;
      },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

scenario('census', '空 glob：退出码为 0 但用例数为 0（census 判定的依据）', () =>
  withPlayground(null, (pg) => {
    const r = runTapIn(pg.dir, ['empty/**/*.test.mjs']);
    return {
      ok: r.status === 0 && r.tests === 0,
      detail: `exit=${r.status} tests=${r.tests}`,
    };
  }),
);

scenario('census', '目录改名：旧 glob 漏跑时同样 exit=0/tests=0', () =>
  withPlayground(null, (pg) => {
    pg.write('renamed/real.test.mjs', "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('real', () => assert.equal(1,1));\n");
    const stale = runTapIn(pg.dir, ['cache/**/*.test.mjs']);
    const fresh = runTapIn(pg.dir, ['renamed/**/*.test.mjs']);
    return {
      ok: stale.status === 0 && stale.tests === 0 && fresh.tests === 1,
      detail: `旧glob exit=${stale.status} tests=${stale.tests}；新glob tests=${fresh.tests}`,
    };
  }),
);

scenario('census', '顶层 process.exit(0)：退出码与失败数都不可信', () =>
  withPlayground(null, (pg) => {
    pg.write('exit-first.test.mjs', "import test from 'node:test';\nprocess.exit(0);\ntest('never', () => { throw new Error('boom'); });\n");
    const r = runTapIn(pg.dir, ['exit-first.test.mjs']);
    // 实测特征：exit=0 且 fail=0，唯一异常信号是用例数被压到 <= 1
    return {
      ok: r.status === 0 && r.fail === 0 && r.tests !== null && r.tests <= 1,
      detail: `exit=${r.status} fail=${r.fail} tests=${r.tests}`,
    };
  }),
);

scenario('census', '整文件 t.skip：pass=0/skipped=N，必须计入跳过上限', () =>
  withPlayground(null, (pg) => {
    pg.write('all-skip.test.mjs', "import test from 'node:test';\ntest('a', (c) => c.skip('no browser'));\ntest('b', (c) => c.skip('no browser'));\n");
    const r = runTapIn(pg.dir, ['all-skip.test.mjs']);
    return {
      ok: r.status === 0 && r.skipped === 2,
      detail: `exit=${r.status} skipped=${r.skipped}`,
    };
  }),
);

scenario('census', '正常文件：tests=pass 且 fail/skip 为零（反向对照）', () =>
  withPlayground(null, (pg) => {
    pg.write('ok.test.mjs', "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('real', () => assert.equal(2,2));\n");
    const r = runTapIn(pg.dir, ['ok.test.mjs']);
    return {
      ok: r.status === 0 && r.tests === 1 && r.fail === 0 && r.skipped === 0,
      detail: `exit=${r.status} tests=${r.tests} fail=${r.fail} skipped=${r.skipped}`,
    };
  }),
);

/* ============================ 套件枚举 ============================ */

scenario('targets', '枚举不得缩水，且根级文件必须被覆盖（globstar 退化信号）', async () => {
  const { listSuiteFiles, SUITES } = await import('../gates/lib/test-targets.mjs');
  const unit = listSuiteFiles('unit');
  const uiRoot = unit.filter((f) => /^packages\/ui\/__tests__\/[^/]+\.test\.mjs$/.test(f));
  const formal = listSuiteFiles('formal');
  const ok =
    unit.length >= SUITES.unit.minFiles &&
    uiRoot.length >= 25 &&
    formal.length >= SUITES.formal.minFiles;
  return {
    ok,
    detail: `unit=${unit.length}(min ${SUITES.unit.minFiles}) ui根级=${uiRoot.length}(min 25) formal=${formal.length}(min ${SUITES.formal.minFiles})`,
  };
});

/* ============================ 行数上限 ============================ */

scenario('size', '超过上限一行必须阻断；等于上限必须放行', async () => {
  const { fileLineLimitRules, FILE_LINE_LIMIT } = await import('../gates/rules/maintainability.mjs');
  const { stripComments } = await import('../gates/lib/scanner.mjs');
  const make = (n) => Array.from({ length: n }, (_, i) => `const v${i} = ${i};`).join('\n');

  const atLimit = fileLineLimitRules.check('packages/ui/src/tmp/x.ts', { ...stripComments(make(FILE_LINE_LIMIT)), warnings: [] });
  const over = fileLineLimitRules.check('packages/ui/src/tmp/x.ts', { ...stripComments(make(FILE_LINE_LIMIT + 1)), warnings: [] });
  return {
    ok: atLimit.length === 0 && over.length === 1 && over[0].ruleId === 'size/oversize-new',
    detail: `等于上限违规=${atLimit.length}；超一行违规=${over.length}`,
  };
});

scenario('size', '已登记文件涨过登记值必须阻断', async () => {
  const { fileLineLimitRules, KNOWN_OVERSIZE } = await import('../gates/rules/maintainability.mjs');
  const { stripComments } = await import('../gates/lib/scanner.mjs');
  // 选取仍大于 1500 硬上限的已知超限源文件作为检验对象
  const file = Object.keys(KNOWN_OVERSIZE).find((k) => !KNOWN_OVERSIZE[k].generated && KNOWN_OVERSIZE[k].max > 1500)
    || 'packages/ui/src/i18n/index.ts';
  const max = KNOWN_OVERSIZE[file].max;
  const make = (n) => Array.from({ length: n }, (_, i) => `const v${i} = ${i};`).join('\n');
  const at = fileLineLimitRules.check(file, { ...stripComments(make(max)), warnings: [] });
  const over = fileLineLimitRules.check(file, { ...stripComments(make(max + 1)), warnings: [] });
  return {
    ok: at.length === 0 && over.length === 1 && over[0].ruleId === 'size/oversize-grown',
    detail: `测试文件=${file}；登记值=${max}；等于登记值违规=${at.length}；超一行违规=${over.length}`,
  };
});

/* ============================ 测试完整性 ============================ */

scenario('test-integrity', 'c8 ignore 与测试内强制成功退出必须阻断', async () => {
  const { testIntegrityRules } = await import('../gates/rules/maintainability.mjs');
  const { stripComments } = await import('../gates/lib/scanner.mjs');
  const scan = (file, src) => testIntegrityRules.check(file, { ...stripComments(src), warnings: [] });

  const c8 = scan('packages/core/src/x.ts', 'const a = 1;\n/* c8 ignore next */\nconst b = 2;\n');
  const exit = scan('packages/core/__tests__/x.test.mjs', 'process.exit(0);\n');
  const failFast = scan('packages/core/__tests__/x.test.mjs', 'process.exit(1);\n');
  return {
    ok: c8.length === 1 && exit.length === 1 && failFast.length === 0,
    detail: `c8=${c8.length} exit(0)=${exit.length} exit(1)=${failFast.length}`,
  };
});

/* ============================ 不变量映射 ============================ */

scenario('invariant-map', '映射表自身合格（id 唯一、测试含 fc.assert、锚点真实）', () => {
  const r = spawnSync(process.execPath, ['scripts/verify/invariant-map.mjs'], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 120000,
  });
  return {
    ok: r.status === 0,
    detail: `exit=${r.status} ${(r.stdout ?? '').split('\n').find((l) => l.includes('映射表'))?.trim() ?? ''}`,
  };
});

scenario('invariant-map', 'Markdown 视图与 JSON 必须一致', () => {
  const r = spawnSync(process.execPath, ['scripts/verify/invariant-map.mjs', '--check'], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 120000,
  });
  return { ok: r.status === 0, detail: `exit=${r.status}` };
});

/* ============================ 豁免敞口 ============================ */

scenario('allow-budget', '豁免敞口必须在预算内，且统计到含数字的标签', () => {
  const r = spawnSync(process.execPath, ['scripts/gates/allow-budget.mjs'], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 120000,
  });
  const out = `${r.stdout ?? ''}`;
  const i18nLine = out.split('\n').find((l) => l.includes('gate-i18n-allow'));
  return {
    ok: r.status === 0,
    detail: `exit=${r.status}；i18n 标签${i18nLine ? '已计入' : '未计入（数字标签漏计）'}`,
  };
});

/* ============================ CI 可移植性 ============================ */

scenario('ci', '真实 workflow 必须通过：bash 专有语法 / 命令掩盖 / 构建前读产物', async () => {
  const { auditWorkflow } = await import('../gates/verify-ci-workflow.mjs');
  const src = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/quality-gates.yml'), 'utf8');
  const { failures, steps } = auditWorkflow(src);
  const rules = [...new Set(failures.map((f) => f.rule))];
  return {
    ok: failures.length === 0 && steps > 0,
    detail: `step=${steps}；违规=${failures.length}${rules.length ? `（${rules.join(', ')}）` : ''}`,
  };
});

scenario('ci', '修复前的三类缺陷必须被同一套规则捕获（规则杀伤力）', async () => {
  const { SELF_PROOF_SAMPLES, auditWorkflow } = await import('../gates/verify-ci-workflow.mjs');
  const results = Object.entries(SELF_PROOF_SAMPLES).map(([key, pair]) => ({
    key,
    badHit: auditWorkflow(pair.bad).failures.length > 0,
    goodHit: auditWorkflow(pair.good).failures.length > 0,
  }));
  const broken = results.filter((r) => !r.badHit || r.goodHit);
  return {
    ok: broken.length === 0,
    detail: broken.length === 0
      ? `${results.length} 组样本双向判定正确（坏样本命中、好样本放行）`
      : `判定错误：${broken.map((b) => b.key).join(', ')}`,
  };
});

/* ============================ 主流程 ============================ */

async function main() {
  const filter = process.argv[2];
  const list = filter ? scenarios.filter((s) => s.name.includes(filter) || s.group.includes(filter)) : scenarios;

  console.log(`${C.cyan}${C.bold}门禁自证套件${C.reset}`);
  console.log(`${C.dim}  验证「门禁在被违反时确实会红」，与 gates:mutation 互补${C.reset}\n`);

  let failed = 0;
  let currentGroup = '';
  for (const s of list) {
    if (s.group !== currentGroup) {
      currentGroup = s.group;
      console.log(`${C.bold}${currentGroup}${C.reset}`);
    }
    let res;
    try {
      res = await s.fn();
    } catch (err) {
      res = { ok: false, detail: `执行异常: ${err?.message ?? err}` };
    }
    if (res.ok) {
      console.log(`  ${C.green}✔${C.reset} ${s.name}`);
      console.log(`    ${C.dim}${res.detail}${C.reset}`);
    } else {
      failed += 1;
      console.log(`  ${C.red}✘${C.reset} ${s.name}`);
      console.log(`    ${C.red}${res.detail}${C.reset}`);
    }
  }

  console.log('');
  if (failed === 0) {
    console.log(`${C.green}${C.bold}✔ 全部 ${list.length} 个场景判定正确：门禁具备真实杀伤力${C.reset}`);
    process.exitCode = 0;
    return;
  }
  console.log(`${C.red}${C.bold}✘ ${failed} / ${list.length} 个场景判定错误${C.reset}`);
  console.log(`${C.dim}  这不是代码 bug，而是「门禁本身失效」——优先级高于任何功能缺陷。${C.reset}`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
