#!/usr/bin/env node
/**
 * pre-commit 钩子（跨平台实现）
 *
 * 设计意图 (Why):
 *   原先的 .githooks/pre-commit 是 bash 脚本并调用 `npm`。
 *   在 Windows + PowerShell 环境下，`npm.ps1` 会被执行策略直接拒绝
 *   （实测报 UnauthorizedAccess: 禁止运行脚本），导致钩子完全失效——
 *   门禁看似存在，实际从未运行过。这是比「没有门禁」更危险的状态。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 调用 `npm` / `npm.cmd` 在部分 shell 下解析不一致 -> 统一走
 *      `process.platform === 'win32' ? 'npm.cmd' : 'npm'`。
 *   2. 只跑全量门禁会让每次提交都很慢，最终被人 `--no-verify` 跳过。
 *      -> 静态门禁走「暂存区改动集」，测试与类型走全量（保证不退化）。
 *   3. 钩子内部抛出未捕获异常会让 git 显示一堆堆栈 -> 统一 try/catch 并给出可读结论。
 *
 * 用法：git 会在提交时自动调用本文件。
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const C = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[36m',
};

function banner(text) {
  console.log(`\n${C.blue}▌${C.reset} ${C.bold}${text}${C.reset}`);
}

function run(label, command, args) {
  banner(label);
  // Windows 上 .cmd 批处理必须经 shell 才能被 spawn 执行，
  // 否则会抛 EINVAL（实测：spawnSync npm.cmd EINVAL）。
  const needsShell = process.platform === 'win32' && /\.cmd$/i.test(command);
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: needsShell,
  });
  if (result.error) {
    console.error(`${C.red}✗ ${label} 无法执行: ${result.error.message}${C.reset}`);
    return false;
  }
  return result.status === 0;
}

function main() {
  console.log(`${C.bold}══════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}🛡️  Hermes Flux Gatekeeper · pre-commit${C.reset}`);
  console.log(`${C.dim}   静态门禁走改动集 · 类型与测试走全量${C.reset}`);
  console.log(`${C.bold}══════════════════════════════════════════════════${C.reset}`);

  const gates = [
    ['Gate 0/4 · 静态门禁（架构/换肤/i18n/性能）', 'node', ['scripts/gates/run.mjs', '--staged']],
    ['Gate 1 · 全栈严格类型', NPM, ['run', 'typecheck']],
    ['Gate 2 · 单元与不变量测试', NPM, ['test']],
  ];

  const failures = [];
  for (const [label, cmd, args] of gates) {
    if (!run(label, cmd, args)) failures.push(label);
  }

  console.log(`\n${C.bold}══════════════════════════════════════════════════${C.reset}`);
  if (failures.length > 0) {
    console.log(`${C.red}${C.bold}✗ 提交被拒绝，以下门禁未通过：${C.reset}`);
    for (const f of failures) console.log(`  ${C.red}·${C.reset} ${f}`);
    console.log(`\n${C.yellow}修复后重新提交。禁止使用 --no-verify 绕过。${C.reset}`);
    console.log(`${C.dim}若判定为门禁误报，请在代码中显式添加豁免注释并说明理由。${C.reset}`);
    console.log(`${C.bold}══════════════════════════════════════════════════${C.reset}\n`);
    process.exit(1);
  }

  console.log(`${C.green}${C.bold}✓ 全部门禁通过，允许提交${C.reset}`);
  console.log(`${C.bold}══════════════════════════════════════════════════${C.reset}\n`);
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error(`${C.red}✗ pre-commit 钩子异常: ${err.message}${C.reset}`);
  process.exit(1);
}
