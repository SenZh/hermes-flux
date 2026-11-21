/**
 * 存量债务进度报告器测试。
 * 为什么落在这个测试目录：npm test (census-check.mjs) 仅枚举 packages/{core,ui,desktop}/__tests__，
 *   scripts/ 无独立门禁单测挂点（与 gates-freeze-dry.test.mjs 同口径）。
 * 断言：纯判定（含 NaN/Infinity/负数拦截）与 CLI --runner 端到端退出码/Summary 写入全部具备变异杀伤力。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  evaluateDebtProgress,
  formatDebtSummaryMarkdown,
} from '../../../scripts/gates/report-debt-progress.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const REPORTER = path.join(ROOT, 'scripts/gates/report-debt-progress.mjs');

function runReporterCli({ args = [], summaryFile }) {
  const env = { ...process.env };
  if (summaryFile) env.GITHUB_STEP_SUMMARY = summaryFile;
  else delete env.GITHUB_STEP_SUMMARY;
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [REPORTER, ...args], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 120000,
  });
}

test('存量债务进度报告器：纯判定与 Summary 输出校验', async (t) => {
  await t.test('零阻断且零债务时返回退出码 0 并声明全部清偿', () => {
    const report = {
      summary: { blocking: 0, frozenDebt: 0, paidOff: 0 },
      byRule: [
        { id: 'arch', gate: 'Gate 0', title: '架构符合性', blocking: 0, frozen: 0 },
      ],
    };
    const res = evaluateDebtProgress(report);
    assert.equal(res.exitCode, 0);
    assert.equal(res.status, 'clean');

    const md = formatDebtSummaryMarkdown(report);
    assert.match(md, /存量债务进度/);
    assert.match(md, /0 条存量债务，已全部清偿/);
  });

  await t.test('零阻断但存在存量债务时返回退出码 0 并列出明细表（且转义管道符）', () => {
    const report = {
      summary: { blocking: 0, frozenDebt: 5, paidOff: 40 },
      byRule: [
        { id: 'arch', gate: 'Gate 0', title: '架构符合性 | 分层', blocking: 0, frozen: 5 },
        { id: 'i18n', gate: 'Gate 4', title: 'i18n', blocking: 0, frozen: 0 },
      ],
    };
    const res = evaluateDebtProgress(report);
    assert.equal(res.exitCode, 0);
    assert.equal(res.status, 'debt-remaining');
    assert.equal(res.frozenDebt, 5);

    const md = formatDebtSummaryMarkdown(report);
    assert.match(md, /存量冻结债务：5/);
    assert.match(md, /\| Gate 0 \| 架构符合性 \\\| 分层 \| 0 \| 5 \|/);
    assert.ok(!md.includes('| Gate 4 |'), '零债务规则不应混入明细表');
  });

  await t.test('出现新增阻断违规时必须返回退出码 1（不得假绿）', () => {
    const report = {
      summary: { blocking: 2, frozenDebt: 0, paidOff: 0 },
      byRule: [
        { id: 'theme', gate: 'Gate 4', title: '换肤一致性', blocking: 2, frozen: 0 },
      ],
    };
    const res = evaluateDebtProgress(report);
    assert.equal(res.exitCode, 1);
    assert.equal(res.status, 'blocking');
    assert.equal(res.blocking, 2);

    const md = formatDebtSummaryMarkdown(report);
    assert.match(md, /新增阻断违规：2/);
    assert.match(md, /\| Gate 4 \| 换肤一致性 \| 2 \| 0 \|/);
  });

  await t.test('畸形报告与 NaN/Infinity/负数/小数计数必须返回退出码 1（Failure Is Not Empty）', () => {
    const malformed = [
      null,
      undefined,
      {},
      { summary: {} },
      { summary: { blocking: '0', frozenDebt: 0 } },
      { summary: { blocking: Number.NaN, frozenDebt: 0 } },
      { summary: { blocking: Number.POSITIVE_INFINITY, frozenDebt: 0 } },
      { summary: { blocking: -1, frozenDebt: 0 } },
      { summary: { blocking: 0, frozenDebt: -3 } },
      { summary: { blocking: 1.5, frozenDebt: 0 } },
      { summary: { blocking: 0, frozenDebt: 0, paidOff: -1 } },
      { summary: { blocking: 0, frozenDebt: 0, paidOff: Number.NaN } },
    ];
    for (const bad of malformed) {
      const res = evaluateDebtProgress(bad);
      assert.equal(res.exitCode, 1, `畸形输入必须返回退出码 1: ${JSON.stringify(bad)}`);
      assert.equal(res.status, 'invalid');
    }
    const md = formatDebtSummaryMarkdown(null);
    assert.match(md, /报告格式异常/);
  });

  await t.test('CLI --runner 端到端校验：覆盖阻断失败、债务观察通过、非法 JSON、空输出与缺失脚本', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-debt-cli-'));
    try {
      const writeStub = (name, code) => {
        const filePath = path.join(tmpDir, name);
        fs.writeFileSync(filePath, code, 'utf8');
        return filePath;
      };

      // 1. 新增阻断违规 blocking: 2 -> 必须退出 1 并写 Summary
      const blockingStub = writeStub(
        'stub-blocking.mjs',
        'process.stdout.write(JSON.stringify({ summary: { blocking: 2, frozenDebt: 0, paidOff: 0 }, byRule: [{ id: "arch", gate: "Gate 0", title: "架构", blocking: 2, frozen: 0 }] })); process.exitCode = 1;\n',
      );
      const blockingSummary = path.join(tmpDir, 'blocking-summary.md');
      const blockingRun = runReporterCli({ args: [`--runner=${blockingStub}`], summaryFile: blockingSummary });
      assert.equal(blockingRun.status, 1, '存在 blocking 违规时 CLI 必须退出 1');
      assert.match(fs.readFileSync(blockingSummary, 'utf8'), /新增阻断违规：2/);

      // 2. 零阻断但有存量冻结债务 frozenDebt: 3 -> 必须退出 0 并写 Summary
      const debtStub = writeStub(
        'stub-debt.mjs',
        'process.stdout.write(JSON.stringify({ summary: { blocking: 0, frozenDebt: 3, paidOff: 1 }, byRule: [{ id: "i18n", gate: "Gate 4", title: "i18n", blocking: 0, frozen: 3 }] })); process.exitCode = 1;\n',
      );
      const debtSummary = path.join(tmpDir, 'debt-summary.md');
      const debtRun = runReporterCli({ args: [`--runner=${debtStub}`], summaryFile: debtSummary });
      assert.equal(debtRun.status, 0, '仅存量冻结债务时 CLI 必须退出 0 避免误报红灯');
      assert.match(fs.readFileSync(debtSummary, 'utf8'), /存量冻结债务：3/);

      // 3. 非法 JSON 输出 -> 必须退出 1
      const badJsonStub = writeStub('stub-bad-json.mjs', 'process.stdout.write("{not-json");\n');
      const badJsonRun = runReporterCli({ args: [`--runner=${badJsonStub}`] });
      assert.equal(badJsonRun.status, 1, 'JSON 解析失败时 CLI 必须退出 1');

      // 4. 空 stdout -> 必须退出 1
      const emptyStub = writeStub('stub-empty.mjs', 'process.exitCode = 0;\n');
      const emptyRun = runReporterCli({ args: [`--runner=${emptyStub}`] });
      assert.equal(emptyRun.status, 1, '无 JSON 产出时 CLI 必须退出 1');

      // 5. 负数 summary -> 必须退出 1
      const negStub = writeStub(
        'stub-negative.mjs',
        'process.stdout.write(JSON.stringify({ summary: { blocking: -1, frozenDebt: 0 } }));\n',
      );
      const negRun = runReporterCli({ args: [`--runner=${negStub}`] });
      assert.equal(negRun.status, 1, 'summary 含负数时 CLI 必须退出 1');

      // 6. 不存在的 runner 脚本 -> 必须退出 1
      const missingRun = runReporterCli({ args: [`--runner=${path.join(tmpDir, 'missing.mjs')}`] });
      assert.equal(missingRun.status, 1, 'runner 缺失时 CLI 必须退出 1');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('CLI 默认全量执行 report-debt-progress.mjs 写入 GITHUB_STEP_SUMMARY 并报告零债务', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-debt-summary-'));
    const summaryPath = path.join(tmpDir, 'summary.md');
    try {
      const run = runReporterCli({ summaryFile: summaryPath });
      assert.equal(run.status, 0, `期望退出码 0，实测 ${run.status}\n${run.stdout}\n${run.stderr}`);
      assert.ok(fs.existsSync(summaryPath), '必须创建并写入 GITHUB_STEP_SUMMARY');
      const md = fs.readFileSync(summaryPath, 'utf8');
      assert.match(md, /新增阻断违规：0/);
      assert.match(md, /存量冻结债务：0/);
      assert.match(md, /0 条存量债务，已全部清偿/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
