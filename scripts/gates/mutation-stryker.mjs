#!/usr/bin/env node
/**
 * 基于 Stryker 的领域化变异测试执行器（Domain-Driven Mutation Runner）
 *
 * 【设计意图 (Why)】
 *   全量 15,000+ 变异体需跑数十分钟，无法放入常规流程。
 *   本脚本按领域（Domain）调度变异测试，支持：
 *     1. 默认或单领域运行：npm run mutation:stryker -- --domain=cache
 *     2. 查看存量领域清单：npm run mutation:stryker -- --list
 *     3. 存量逐步消减：每个领域耗时 10~60 秒，形成可逐个突破的存量消减基准。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 假 0 分假绿：必须设置 noCoverage < total 的硬哨兵。
 *   2. 配置漂移：动态注入 mutate 与 testFiles，保证测试与变异对象 100% 闭环。
 *   3. 状态隔离：每个领域运行前清理并写入专用的临时配置，防止多领域互相污染。
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MUTATION_DOMAINS } from './lib/mutation-domains.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const REPORT_FILE = path.join(REPO_ROOT, 'reports/mutation/mutation.json');
const DYNAMIC_CONFIG = path.join(REPO_ROOT, '.stryker.tmp.json');

const C = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
};

function printList() {
  console.log(`${C.cyan}${C.bold}Hermes Flux 变异测试存量领域清单 (Burndown Registry)${C.reset}\n`);
  console.log(`${'领域代码 (Domain)'.padEnd(16)} | ${'领域说明'.padEnd(30)} | ${'最低门禁分'}`);
  console.log(''.padEnd(65, '-'));
  for (const [key, d] of Object.entries(MUTATION_DOMAINS)) {
    console.log(`${key.padEnd(16)} | ${d.title.padEnd(30)} | ${d.minScore}%`);
  }
  console.log('\n运行单个领域: npm run mutation:stryker -- --domain=<name>');
}

function parseDomainArg() {
  for (const arg of process.argv.slice(2)) {
    if (arg === '--list') return { action: 'list' };
    if (arg.startsWith('--domain=')) {
      return { action: 'run', domain: arg.split('=')[1] };
    }
  }
  return { action: 'run', domain: 'cache' }; // 默认 cache
}

function main() {
  const req = parseDomainArg();
  if (req.action === 'list') {
    printList();
    return;
  }

  const domainConfig = MUTATION_DOMAINS[req.domain];
  if (!domainConfig) {
    console.error(`${C.red}✗ 未知领域: ${req.domain}${C.reset}`);
    printList();
    process.exit(1);
  }

  console.log(`${C.cyan}${C.bold}Stryker 领域化自动化变异测试${C.reset}`);
  console.log(`  目标领域: ${C.bold}${domainConfig.title}${C.reset} [${req.domain}]`);
  console.log(`  变异目标: ${domainConfig.mutate.join(', ')}`);
  console.log(`  驱动测试: ${domainConfig.testFiles.join(', ')}\n`);

  // 1. 生成该领域的动态 Stryker 配置
  const config = {
    $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
    /**
     * 【必须显式声明插件 (Why)】Stryker 10 在 bun 的嵌套 node_modules 布局下
     *   会找不到 `@stryker-mutator/tap-runner` 的自动发现入口，报
     *   "Could not inject ... Cannot find TestRunner plugin tap" 并直接退出（实测所有领域都受影响）。
     *   显式列出插件路径即可绕过自动发现。
     */
    plugins: ['@stryker-mutator/tap-runner'],
    testRunner: 'tap',
    tap: {
      testFiles: domainConfig.testFiles,
    },
    mutate: domainConfig.mutate,
    buildCommand: domainConfig.buildCommand || 'npm run build:core',
    reporters: ['progress', 'clear-text', 'json'],
    concurrency: 2,
    timeoutMS: 15000,
    ignorePatterns: [
      'packages/desktop/release/**',
      'artifacts/**',
      '.stryker-tmp/**',
      'dist/**',
    ],
    thresholds: {
      high: 80,
      low: 60,
      break: null,
    },
  };

  fs.writeFileSync(DYNAMIC_CONFIG, JSON.stringify(config, null, 2), 'utf8');

  // 2. 清理旧报告
  if (fs.existsSync(REPORT_FILE)) {
    fs.rmSync(REPORT_FILE, { force: true });
  }

  // 3. 执行 Stryker (使用 node 直接执行 binary，跨平台稳定无 shell 逃逸)
  const strykerBin = path.join(REPO_ROOT, 'node_modules/@stryker-mutator/core/bin/stryker.js');
  const args = [strykerBin, 'run', '.stryker.tmp.json'];

  console.log(`执行命令: node ${args.map((a) => path.relative(REPO_ROOT, a) || a).join(' ')}`);
  const start = Date.now();
  const r = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  // 无论如何清理临时配置文件
  if (fs.existsSync(DYNAMIC_CONFIG)) {
    fs.rmSync(DYNAMIC_CONFIG, { force: true });
  }

  const durationSec = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nStryker 变异测试完成，耗时: ${durationSec}s`);

  // 4. 读取报告与哨兵核查
  if (!fs.existsSync(REPORT_FILE)) {
    console.error(`${C.red}✗ 错误: 未生成变异报告 ${REPORT_FILE}${C.reset}`);
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
  const files = report.files || {};
  let totalMutants = 0;
  let killed = 0;
  let survived = 0;
  let noCoverage = 0;
  let timeout = 0;

  for (const fileData of Object.values(files)) {
    const mutants = fileData.mutants || [];
    totalMutants += mutants.length;
    for (const m of mutants) {
      if (m.status === 'Killed') killed += 1;
      else if (m.status === 'Survived') survived += 1;
      else if (m.status === 'NoCoverage') noCoverage += 1;
      else if (m.status === 'Timeout') timeout += 1;
    }
  }

  const effectiveTested = totalMutants - noCoverage;
  const mutationScore = totalMutants > 0 ? ((killed + timeout) / totalMutants) * 100 : 0;
  const coveredScore = effectiveTested > 0 ? ((killed + timeout) / effectiveTested) * 100 : 0;

  console.log(`\n${C.bold}变异度量统计 [${req.domain}]:${C.reset}`);
  console.log(`  总变异体数 (Total):      ${totalMutants}`);
  console.log(`  成功杀死数 (Killed):     ${C.green}${killed}${C.reset}`);
  console.log(`  存活变异体 (Survived):   ${survived > 0 ? C.yellow : C.green}${survived}${C.reset}`);
  console.log(`  未覆盖变异 (NoCoverage): ${noCoverage > 0 ? C.red : C.green}${noCoverage}${C.reset}`);
  console.log(`  全量变异得分 (Mutation Score): ${mutationScore >= domainConfig.minScore ? C.green : C.red}${mutationScore.toFixed(2)}%${C.reset}`);
  console.log(`  被测变异得分 (Covered Score):  ${coveredScore >= domainConfig.minScore ? C.green : C.red}${coveredScore.toFixed(2)}%${C.reset}`);

  // 哨兵 1: 必须有变异体被生成并测试
  if (totalMutants === 0) {
    console.error(`${C.red}✗ 哨兵失败: 未找到任何变异体，检查 mutate 配置路径${C.reset}`);
    process.exit(1);
  }

  // 哨兵 2: 绝不允许全部变异体处于 NoCoverage 状态
  if (noCoverage === totalMutants) {
    console.error(`${C.red}✗ 哨兵失败: 100% 变异体均为 NoCoverage，构建产物未被测试引用或 buildCommand 未生效！${C.reset}`);
    process.exit(1);
  }

  // 哨兵 3: 领域专属门禁分
  if (mutationScore < domainConfig.minScore) {
    console.error(`${C.red}✗ 门禁失败: 变异杀死得分 ${mutationScore.toFixed(2)}% 低于领域门禁阈值 ${domainConfig.minScore}%！${C.reset}`);
    process.exit(1);
  }

  console.log(`\n${C.green}✓ 领域 [${req.domain}] 变异测试门禁通过（得分 ${mutationScore.toFixed(2)}% ≥ ${domainConfig.minScore}%）${C.reset}`);
}

main();
