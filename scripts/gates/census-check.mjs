/**
 * 执行量统计层（Test Census）。
 *
 * 设计意图 (Why):
 *   一个测试命令能不能拦住缺陷，取决于「它真的执行了多少」。
 *   单元测试的断言只能证明「跑到的部分是对的」，无法证明「该跑的都跑了」。
 *   因此门禁必须先自证执行量：文件数、用例数、跳过数、失败数四项同时达标。
 *   这一步的成本是一条正则，却能同时堵住四类假绿。
 *
 * 防范的历史坑 (Pitfall)（全部实测，见 artifacts/tools/census-recheck.mjs）:
 *   1. 空 glob：`node --test "empty/**\/*.test.mjs"` 实测 exit=0 / tests=0。
 *      不加断言时，整个套件消失也算通过。
 *   2. 目录改名：旧 glob 命中 0 文件同样 exit=0，与上一条同形。
 *   3. 顶层 `process.exit(0)`：实测 exit=0 且汇总成 tests=1/pass=1，
 *      报告"一个测试通过"——真实的失败被彻底吞掉。
 *   4. `uncaughtException` 钩子里 `process.exit(0)`：同上，exit=0。
 *   5. 整文件 `t.skip()`：实测 exit=0 / pass=0 / skipped=2，在只判退出码的
 *      门禁眼里与"全部通过"等价（本项目 CI 曾在 ubuntu 上因此零执行仍全绿）。
 *
 * 约束与规则 (Rules):
 *   - 必须实际运行一次测试，不读历史报告，避免用过期产物自证。
 *   - 汇总行缺失即 FAIL（`cancelled` 早退、reporter 崩坏都属此类）。
 *   - skipped 只允许不超过登记上限，新增任何 skip 都会让本层失败。
 *   - 文件数下限来自 lib/test-targets.mjs 的单一真值源，禁止在命令行另写 glob。
 */

import { spawnSync } from 'node:child_process';
import { REPO_ROOT, SUITES, listSuiteFiles } from './lib/test-targets.mjs';

/**
 * 允许存在的 skip 数量上限。
 *
 * 现状：3 个 skip 全部来自「真实网关凭据缺失」与「本机无浏览器」两类外部前置，
 * 属于 Failure Is Not Explicit 的可接受降级（脚本会打印可见提示）。
 * 除这些前置外新增任何 skip 都必须先在此登记并说明原因，否则本层失败。
 */
const SKIP_BUDGET = {
  unit: 3,
  formal: 0,
};

const SKIP_REASONS = [
  '真实网关凭据缺失（.env 未提供）',
  '本机未安装 Edge/Chrome（GUI 用例）',
];

const C = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
};

/** 从 TAP 输出中读取汇总计数 */
export function parseTapSummary(output) {
  const grab = (key) => {
    const m = output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
    return m ? Number(m[1]) : null;
  };
  return {
    tests: grab('tests'),
    pass: grab('pass'),
    fail: grab('fail'),
    cancelled: grab('cancelled'),
    skipped: grab('skipped'),
    todo: grab('todo'),
  };
}

/**
 * 从 TAP 输出中提取失败用例的定位信息。
 *
 * 【设计意图 (Why)】
 *   汇总行只会说"失败 3 个用例"。在本地跑还能往上翻屏，在 CI 里那条日志
 *   早就被挤到几百行之外——排查的人要先下载整份日志、再手工 grep。
 *   断言失败时的第一需求是「哪个用例、哪条断言、期望什么」，必须直接给出。
 *
 * 【约束与规则 (Rules)】
 *   1. 解析 TAP 的 `not ok` 行取用例名（含子测试缩进层级，拼成完整路径）；
 *   2. 紧随其后的 `error:` / `code:` / `expected:` / `actual:` 一并带上，
 *      这是"失败原因对得上"的原始证据；
 *   3. 解析不出名字时返回空数组而不是猜——由上层保留原始汇总行的失败数。
 *
 * @param {string} output TAP 文本
 * @param {number} [limit] 最多返回多少条，避免刷屏
 * @returns {Array<{ name: string, details: string[] }>}
 */
export function parseTapFailures(output, limit = 12) {
  const lines = output.split(/\r?\n/);
  const failures = [];
  /** 子测试缩进栈：depth -> 名字 */
  const stack = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    /**
     * 【防范的历史坑 (Pitfall)】子测试的父级在 TAP 里既可能是 `ok N - name`，
     * 也可能是 `# Subtest: name`（node:test 对含子测试的父级用后者）。
     * 只跟 `ok` 行会让失败名退化成子级单独一行（实测：期望 "outer suite › inner case"，
     * 实际只拿到 "inner case"），父级上下文整个丢失。
     */
    const subtest = /^(\s*)# Subtest:\s*(.*)$/.exec(line);
    if (subtest) {
      const depth = Math.floor(subtest[1].length / 2);
      stack[depth] = subtest[2].trim();
      stack.length = depth + 1;
      continue;
    }

    const notOk = /^(\s*)not ok \d+ - (.*)$/.exec(line);
    if (notOk) {
      const depth = Math.floor(notOk[1].length / 2);
      stack[depth] = notOk[2].trim();
      stack.length = depth + 1;
      const name = stack.filter(Boolean).join(' › ');

      const details = [];
      // 逐行读紧随其后的缩进块，收集诊断字段
      for (let j = i + 1; j < lines.length && j < i + 40; j += 1) {
        const cur = lines[j];
        if (/^\s*not ok \d+ - /.test(cur) || /^\s*ok \d+ - /.test(cur) || /^# /.test(cur)) break;
        const m = /^\s*(error|code|failureType|expected|actual|stack):\s*(.*)$/.exec(cur);
        if (m) {
          const value = m[2].trim();
          if (value) details.push(`${m[1]}: ${value.slice(0, 220)}`);
        }
      }
      failures.push({ name, details });
      if (failures.length >= limit) break;
      continue;
    }

    const ok = /^(\s*)ok \d+ - (.*)$/.exec(line);
    if (ok) {
      const depth = Math.floor(ok[1].length / 2);
      stack[depth] = ok[2].trim();
      stack.length = depth + 1;
    }
  }

  return failures;
}

/**
 * 执行一个套件并断言其执行量。
 *
 * @param {string} suiteName SUITES 中的键
 * @param {{concurrency?: number, timeoutMs?: number}} [opts]
 * @returns {{ok: boolean, suite: string, files: number, summary: object|null, problems: string[]}}
 */
export function runCensus(suiteName, opts = {}) {
  const suite = SUITES[suiteName];
  if (!suite) throw new Error(`未登记的测试套件: ${suiteName}`);

  const files = listSuiteFiles(suiteName);
  const problems = [];

  /**
   * 文件数下限是第一道闸。
   * 它拦的是「glob 写错 / 目录被改名 / 文件被误删」——这三种情况下
   * node --test 都会安静地跑更少文件并退出 0。
   */
  if (files.length < suite.minFiles) {
    problems.push(
      `文件数 ${files.length} 低于登记下限 ${suite.minFiles}（目录改名或 glob 失效会让套件静默缩小）`,
    );
  }

  const args = ['--test', '--test-reporter=tap'];
  if (opts.concurrency) args.push(`--test-concurrency=${opts.concurrency}`);
  args.push(...files);

  const startedAt = Date.now();
  /**
   * 【防范的历史坑 (Pitfall)】先剥掉 `NODE_TEST_CONTEXT` 再 spawn。
   * 若 census 本身是在 node:test 里被调起（例如自证测试或嵌套 runner），该变量
   * 会被继承，子进程会直接执行测试文件而不产出 TAP 汇总行，汇总解析随即变成
   * 全 null —— 表现为"统计层总是失败"，且原因完全看不出是环境继承。
   */
  const childEnv = { ...process.env, FORCE_COLOR: '0' };
  delete childEnv.NODE_TEST_CONTEXT;

  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 30 * 60 * 1000,
    maxBuffer: 256 * 1024 * 1024,
    env: childEnv,
  });
  const elapsedMs = Date.now() - startedAt;
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const summary = parseTapSummary(output);

  /** 汇总行缺失：进程被提前结束、reporter 崩坏、或顶层 exit 抢先退出 */
  if (summary.tests === null) {
    problems.push('未产出 TAP 汇总行（进程被提前终止或 reporter 异常，无法证明执行量）');
  } else {
    if (summary.tests === 0) {
      problems.push('用例总数为 0：空 glob 或目录改名会让 node --test 退出 0，必须显式判失败');
    }
    if (summary.tests !== null && files.length > 0 && summary.tests < files.length) {
      problems.push(
        `用例数 ${summary.tests} 少于文件数 ${files.length}：至少有一个文件没有注册任何用例（顶层 exit 或空文件）`,
      );
    }
    if ((summary.fail ?? 0) > 0) problems.push(`失败 ${summary.fail} 个用例`);
    if ((summary.fail ?? 0) > 0) {
      const failures = parseTapFailures(output);
      if (failures.length > 0) {
        /** 直接给出「哪个用例、哪条断言」，避免 CI 里要翻整份日志 */
        problems.push(`失败用例：\n${failures.map((f) => `     - ${f.name}${f.details.length ? `\n       ${f.details.join('\n       ')}` : ''}`).join('\n')}`);
      }
    }
    if ((summary.cancelled ?? 0) > 0) problems.push(`被取消 ${summary.cancelled} 个用例`);
    const skipBudget = SKIP_BUDGET[suiteName] ?? 0;
    if ((summary.skipped ?? 0) > skipBudget) {
      problems.push(
        `跳过 ${summary.skipped} 个用例，超过登记上限 ${skipBudget}（允许的原因：${SKIP_REASONS.join('；')}）`,
      );
    }
  }

  if (result.status !== 0 && problems.length === 0) {
    problems.push(`测试进程退出码 ${result.status}，但汇总行显示全部通过（退出码与结果不一致）`);
  }

  return {
    ok: problems.length === 0,
    suite: suite.label,
    files: files.length,
    elapsedMs,
    summary,
    problems,
    failures: (summary.fail ?? 0) > 0 ? parseTapFailures(output) : [],
  };
}

/* ---------------- CLI ---------------- */
const SKIP_CLI_FLAGS = new Set(['census-check.mjs']);

function main() {
  const argv = process.argv.slice(2);
  const explicit = argv.filter((a) => !a.startsWith('--'));
  /**
   * 默认只跑 unit 套件：与原 `npm test` 的口径严格一致。
   * formal 由独立的 `verify:formal` 驱动，两者在 `npm run verify` 里串行执行，
   * 这样任一套件失败都能被定位到具体层，而不是混在一个命令里。
   * 需要一次跑全部时显式传 `all`。
   */
  const known = new Set([...Object.keys(SUITES), 'all']);
  const unknown = explicit.filter((a) => !known.has(a));
  /**
   * 【失败不可静默，也不可用抛栈失败】未登记的套件名（例如误传了空串或多余的
   * 命令行参数）必须给出可读诊断并退出 1。抛栈会让人以为是 census 自己崩了，
   * 而真实原因是调用方传错了参数。
   */
  if (unknown.length > 0) {
    console.error(`${C.red}未知的套件名: ${unknown.map((u) => JSON.stringify(u)).join(', ')}${C.reset}`);
    console.error(`${C.dim}  已登记: ${Object.keys(SUITES).join(', ')}（或 all 表示全部）${C.reset}`);
    process.exitCode = 1;
    return;
  }

  const targets = explicit.length > 0
    ? (explicit.includes('all') ? Object.keys(SUITES) : explicit)
    : ['unit'];
  const concurrency = argv.includes('--parallel') ? undefined : 1;

  console.log(`${C.cyan}${C.bold}执行量统计层 (Test Census)${C.reset}`);
  console.log(`${C.dim}  目的：证明测试真的执行过，而不是证明命令没报错${C.reset}\n`);

  const results = targets.map((name) => runCensus(name, { concurrency }));
  let failed = 0;

  for (const r of results) {
    const s = r.summary ?? {};
    const line = `[${r.suite}] 文件 ${r.files} · 用例 ${s.tests ?? '?'} · 通过 ${s.pass ?? '?'} · 失败 ${s.fail ?? '?'} · 跳过 ${s.skipped ?? '?'} · ${(r.elapsedMs / 1000).toFixed(1)}s`;
    if (r.ok) {
      console.log(`${C.green}✔${C.reset} ${line}`);
    } else {
      failed += 1;
      console.log(`${C.red}✘${C.reset} ${line}`);
      for (const p of r.problems) console.log(`   ${C.red}·${C.reset} ${p}`);
    }
  }

  console.log('');
  if (failed === 0) {
    console.log(`${C.green}${C.bold}✔ 执行量自证通过：套件数量、用例数量与跳过上限均达标${C.reset}`);
    process.exitCode = 0;
    return;
  }
  console.log(`${C.red}${C.bold}✘ 执行量自证失败：${failed} 个套件不满足底线${C.reset}`);
  console.log(`${C.dim}  这不是测试失败，而是"无法证明测试跑过"。禁止用放宽下限的方式消除它。${C.reset}`);
  process.exitCode = 1;
}

if (SKIP_CLI_FLAGS.has(process.argv[1]?.split(/[\\/]/).pop() ?? '')) {
  main();
}
