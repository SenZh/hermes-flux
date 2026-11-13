#!/usr/bin/env node
/**
 * 性能基准的独立执行入口。
 *
 * 设计意图 (Why):
 *   性能基准测的是「这段代码要多久」，它要求**独占 CPU**。
 *   但 `npm test` 默认并发跑多个测试文件，基准进程只能分到约 1/3 的核。
 *   实测同一份代码：串行 15ms，并发 41~44ms（稳定慢约 3 倍）。
 *
 *   把基准塞进并发套件里，等于让「机器当时有几个核空闲」决定断言结果——
 *   它会持续假红，然后被人调松预算，最终失去意义。
 *
 * 处理方式:
 *   1. `npm test` 里只保留一条「基准仍可执行」的冒烟断言，不做准确测量；
 *   2. 真正的预算判定由本脚本单独运行（CI 中作为独立步骤）；
 *   3. 预算阈值只在实际测量的条件下生效，不做任何放宽。
 *
 * 防范的历史坑 (Pitfall):
 *   曾三次试图微调预算让它在并发套件里通过（3 次采样 → 7 次采样 → 最快中位数），
 *   每次都能短期变绿然后再次抖动。根因从来不是阈值，而是测量条件不匹配。
 *
 * 用法:
 *   npm run test:perf
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

const env = { ...process.env, NODE_ENV: 'production', FORCE_COLOR: '0' };
delete env.NODE_TEST_CONTEXT;

const r = spawnSync(process.execPath, [path.join(HERE, 'perf-benchmark.mjs')], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
  timeout: 10 * 60 * 1000,
  env,
});

process.stdout.write(`${r.stdout ?? ''}${r.stderr ?? ''}`);

if (r.status !== 0) {
  console.error('\n性能预算门禁未通过（本步骤在独占 CPU 下执行，结果可复现）');
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}
