#!/usr/bin/env node
/**
 * 存量债务进度观测器（CI Job Summary Reporter）
 *
 * 【设计意图 (Why)】
 *   `run.mjs --strict` 在存在冻结存量债务时按设计返回非零退出码；若在 CI 中直接
 *   以 `continue-on-error: true` 执行，GitHub Checks 仍会把该 CheckRun 标红（FAILURE），
 *   干扰 PR 审阅者与自动化工具对阻断状态（Gate 0-5）的判断。
 *   本脚本调用 `run.mjs --strict --json` 采集完整指标，将明细写入 GitHub Actions
 *   Step Summary；只要无新增阻断违规（blocking === 0）且脚本执行正常，即退出 0。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 若静默吞掉子进程异常、NaN/负数计数或 JSON 解析失败并返回 0，会导致门禁脚本
 *      自身损坏时出现"假绿"。因此遇到缺失 summary、非非负整数计数、JSON 解析失败或
 *      阻断违规（blocking > 0）必须返回 1；
 *   2. 严格遵守 `scripts/gates` 扫描域约束（零 `any`、零静默 `catch`）。
 *
 * 【约束与规则 (Rules)】
 *   1. 导出纯函数 `evaluateDebtProgress` 与 `formatDebtSummaryMarkdown` 供单元测试校验；
 *   2. `main()` 仅在作为 CLI 入口直接运行时触发，支持 `--runner=<path>` 指定扫描脚本；
 *   3. 不篡改 `run.mjs --strict` 的既有语义。
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

const isNonNegativeInt = (value) => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * 判定债务观测报告的退出码与状态。
 */
export function evaluateDebtProgress(report) {
  if (!report || typeof report !== 'object' || !report.summary || typeof report.summary !== 'object') {
    return {
      exitCode: 1,
      status: 'invalid',
      blocking: -1,
      frozenDebt: -1,
      paidOff: 0,
    };
  }

  const { blocking, frozenDebt, paidOff } = report.summary;
  if (
    !isNonNegativeInt(blocking) ||
    !isNonNegativeInt(frozenDebt) ||
    (paidOff !== undefined && !isNonNegativeInt(paidOff))
  ) {
    return {
      exitCode: 1,
      status: 'invalid',
      blocking: -1,
      frozenDebt: -1,
      paidOff: 0,
    };
  }

  const normalizedPaidOff = paidOff ?? 0;

  if (blocking > 0) {
    return {
      exitCode: 1,
      status: 'blocking',
      blocking,
      frozenDebt,
      paidOff: normalizedPaidOff,
    };
  }

  return {
    exitCode: 0,
    status: frozenDebt > 0 ? 'debt-remaining' : 'clean',
    blocking: 0,
    frozenDebt,
    paidOff: normalizedPaidOff,
  };
}

/**
 * 将 JSON 报告格式化为 GitHub Step Summary Markdown。
 */
export function formatDebtSummaryMarkdown(report) {
  const evaluation = evaluateDebtProgress(report);
  if (evaluation.status === 'invalid') {
    return [
      '## 存量债务进度（Quality Gates Debt Progress）',
      '',
      '- 状态：报告格式异常（缺少或包含非法的 summary 统计）',
      '',
    ].join('\n');
  }

  const lines = [
    '## 存量债务进度（Quality Gates Debt Progress）',
    '',
    `- 新增阻断违规：${evaluation.blocking}`,
    `- 存量冻结债务：${evaluation.frozenDebt}`,
    `- 待收缩已清偿：${evaluation.paidOff}`,
    '',
  ];

  const escapeCell = (val) => String(val ?? '').replace(/\|/g, '\\|');
  const byRule = Array.isArray(report.byRule) ? report.byRule : [];
  const activeRules = byRule.filter(
    (r) => r && ((typeof r.blocking === 'number' && r.blocking > 0) || (typeof r.frozen === 'number' && r.frozen > 0)),
  );

  if (activeRules.length > 0) {
    lines.push('| 门禁 | 规则 | 新增阻断 | 存量冻结 |');
    lines.push('| --- | --- | ---: | ---: |');
    for (const r of activeRules) {
      lines.push(
        `| ${escapeCell(r.gate)} | ${escapeCell(r.title ?? r.id)} | ${r.blocking ?? 0} | ${r.frozen ?? 0} |`,
      );
    }
    lines.push('');
  } else if (evaluation.blocking === 0) {
    lines.push('0 条存量债务，已全部清偿。');
    lines.push('');
  }

  return lines.join('\n');
}

function resolveRunnerPath(argv) {
  const runnerArg = argv.find((a) => a.startsWith('--runner='));
  if (!runnerArg) return path.join(HERE, 'run.mjs');
  const raw = runnerArg.slice('--runner='.length).trim();
  if (!raw) return null;
  return path.resolve(REPO_ROOT, raw);
}

function main() {
  const runnerPath = resolveRunnerPath(process.argv.slice(2));
  if (!runnerPath) {
    console.error('✖ --runner 参数不能为空');
    process.exitCode = 1;
    return;
  }

  const result = spawnSync(process.execPath, [runnerPath, '--strict', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.error) {
    console.error(`✖ 执行门禁扫描失败: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  const stdout = (result.stdout || '').trim();
  if (!stdout) {
    console.error(`✖ 门禁未产出 JSON 报告（exit=${result.status}）`);
    if (result.stderr) console.error(result.stderr);
    process.exitCode = 1;
    return;
  }

  let report;
  try {
    report = JSON.parse(stdout);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`✖ 解析门禁 JSON 报告失败: ${message}`);
    if (result.stderr) console.error(result.stderr);
    process.exitCode = 1;
    return;
  }

  const evaluation = evaluateDebtProgress(report);
  const markdown = formatDebtSummaryMarkdown(report);
  console.log(markdown);

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile && summaryFile.trim().length > 0) {
    fs.appendFileSync(summaryFile, `${markdown}\n`, 'utf8');
  }

  if (evaluation.exitCode !== 0) {
    console.error(`✖ 检测到 ${evaluation.blocking} 条新增阻断违规或无效报告`);
  }
  process.exitCode = evaluation.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
