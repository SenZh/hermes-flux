#!/usr/bin/env node
/**
 * Hermes Flux 子进程单测绝对隔离运行器 (Run Isolated Tests)
 *
 * 核心设计（深度吸收自 OpenChamber 12,000+ Stars 架构）：
 *   1. 模块级单例防污染 (Module-Level Singleton Isolation)：
 *      UI 的全局 Store、RPC 客户端、会话缓存与 IPC 桩在同一个 Node 进程中
 *      顺序执行必然发生内存单例泄漏，导致「单个文件跑全过，合在一起跑就按执行顺序偶发报错」；
 *   2. 独立子进程执行 (Process-Per-File)：
 *      每个测试文件在全新的 Node 子进程中独立拉起，彻底阻断跨文件状态污染；
 *   3. 机器并发度锁死为 4 (MAX_PARALLEL = 4)，防止打满 CPU 与内存导致机器冻结；
 *   4. 双阶段超时硬杀看门狗 (2 分钟超时 SIGKILL 杀进程，防死循环挂死 CI)。
 *
 * 用法：
 *   node scripts/gates/run-isolated-tests.mjs [roots...]
 *   npm run test:isolated
 */

import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEST_FILE = /\.(test|spec)\.(mjs|js|ts)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'release', 'build', '.git', 'preview']);
const MAX_PARALLEL = 4;
const FILE_TIMEOUT_MS = 120_000; // 单文件 2 分钟硬超时

const C = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[36m',
};

const collect = (dir, found = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collect(full, found);
      continue;
    }
    if (TEST_FILE.test(entry.name)) found.push(full);
  }
  return found;
};

const runOne = (file) => new Promise((resolve) => {
  const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
  const child = spawn(process.execPath, ['--test', file], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let output = '';
  let killed = false;

  const timer = setTimeout(() => {
    killed = true;
    child.kill('SIGKILL');
  }, FILE_TIMEOUT_MS);

  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  child.on('error', (err) => {
    clearTimeout(timer);
    resolve({ rel, code: 1, output: `${output}\n${err.message}` });
  });

  child.on('close', (code) => {
    clearTimeout(timer);
    if (killed) {
      resolve({ rel, code: 1, output: `${output}\n[TIMEOUT] 测试执行超过 120s 被硬杀！` });
    } else {
      resolve({ rel, code: code ?? 1, output });
    }
  });
});

async function main() {
  const customRoots = process.argv.slice(2);
  const defaultRoots = [
    path.join(REPO_ROOT, 'packages/core/__tests__'),
    path.join(REPO_ROOT, 'packages/ui/__tests__'),
  ];
  const roots = customRoots.length > 0
    ? customRoots.map((r) => path.resolve(REPO_ROOT, r))
    : defaultRoots;

  const files = [];
  for (const root of roots) {
    if (statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
      files.push(...collect(root));
    }
  }
  files.sort();

  if (files.length === 0) {
    console.error('run-isolated-tests: 未找到任何测试文件');
    process.exit(1);
  }

  console.log(`${C.bold}══════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}🛡️  Hermes Flux 隔离子进程测试运行器 (OpenChamber 架构)${C.reset}`);
  console.log(`${C.dim}   发现 ${files.length} 个测试套件 · 并发度 ${MAX_PARALLEL} · 单文件超时 120s${C.reset}`);
  console.log(`${C.bold}══════════════════════════════════════════════════${C.reset}\n`);

  let next = 0;
  let passed = 0;
  const failures = [];

  const worker = async () => {
    while (next < files.length) {
      const file = files[next++];
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      const res = await runOne(file);

      if (res.code === 0) {
        passed += 1;
        process.stdout.write(`  ${C.green}✓${C.reset} ${C.dim}${rel}${C.reset}\n`);
      } else {
        failures.push(res);
        process.stdout.write(`  ${C.red}✗${C.reset} ${C.bold}${rel}${C.reset}\n`);
      }
    }
  };

  const pool = Array.from({ length: Math.min(MAX_PARALLEL, files.length) }, worker);
  await Promise.all(pool);

  console.log(`\n${C.bold}══════════════════════════════════════════════════${C.reset}`);
  if (failures.length > 0) {
    console.log(`${C.red}${C.bold}✗ ${failures.length} 个测试文件失败：${C.reset}\n`);
    for (const f of failures) {
      console.log(`${C.red}▌ FAIL: ${f.rel}${C.reset}`);
      console.log(`${C.dim}${f.output.trim().slice(-1200)}${C.reset}\n`);
    }
    process.exit(1);
  }

  console.log(`${C.green}${C.bold}✓ 全部 ${passed}/${files.length} 个测试文件在独立子进程中 100% 绿灯通过！${C.reset}`);
  console.log(`${C.bold}══════════════════════════════════════════════════${C.reset}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`run-isolated-tests 致命异常: ${err.message}`);
  process.exit(1);
});
