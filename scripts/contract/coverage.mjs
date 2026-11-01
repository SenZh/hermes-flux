#!/usr/bin/env node
/**
 * 探针覆盖率门禁（Probe Coverage Gate）
 *
 * 设计意图 (Why):
 *   "已验证过"必须可量化。源码里出现的每个 RPC 方法，要么有真实探针录下的
 *   fixture，要么在探针索引里带着明确原因被跳过。两者都没有 = 没人验证过。
 *
 * 防范的历史坑 (Pitfall):
 *   只覆盖 8 个方法就宣称"全部验证"，实际 43 个方法里有 35 个从未见过真实响应。
 *   覆盖率不做成断言，就会一直是"感觉覆盖了"。
 *
 * 约束与规则 (Rules):
 *   - 只统计源码中真实发起的调用（.call / .request 的字面量方法名）；
 *   - 跳过必须有原因（探针 index 里的 skipped.reason），空原因视为未覆盖；
 *   - 未覆盖且无原因 -> 退出码 1。
 *
 * 用法：
 *   node scripts/contract/coverage.mjs
 *   node scripts/contract/coverage.mjs --json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const FIXTURE_INDEX = path.join(REPO_ROOT, 'packages/core/__tests__/fixtures/gateway/index.json');

const SCAN_DIRS = ['packages/core/src', 'packages/ui/src', 'packages/desktop/src'];
const EXTS = ['.ts', '.tsx'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', 'contracts']);

const JSON_OUT = process.argv.includes('--json');

/** 收集源码中真实调用的 RPC 方法及其调用点 */
function collectUsedMethods() {
  const used = new Map();
  const walk = (dir) => {
    const abs = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const p = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.relative(REPO_ROOT, p).split(path.sep).join('/'));
        continue;
      }
      if (!EXTS.some((e) => entry.name.endsWith(e))) continue;
      const source = fs.readFileSync(p, 'utf8');
      const re = /(?:\.request|\.call)\s*(?:<[^()]*>)?\s*\(\s*(['"])([\w.]+)\1/g;
      let m;
      while ((m = re.exec(source)) !== null) {
        const line = source.slice(0, m.index).split('\n').length;
        const rel = path.relative(REPO_ROOT, p).split(path.sep).join('/');
        if (!used.has(m[2])) used.set(m[2], []);
        used.get(m[2]).push(`${rel}:${line}`);
      }
    }
  };
  for (const dir of SCAN_DIRS) walk(dir);
  return used;
}

function loadIndex() {
  if (!fs.existsSync(FIXTURE_INDEX)) return null;
  try {
    return JSON.parse(fs.readFileSync(FIXTURE_INDEX, 'utf8'));
  } catch {
    return null;
  }
}

const used = collectUsedMethods();
const index = loadIndex();

if (!index) {
  console.error(
    '[contract:coverage] 缺少探针索引 packages/core/__tests__/fixtures/gateway/index.json\n' +
      '  请先运行 npm run probe:gateway（需要真实网关），否则无法证明任何调用点被验证过。'
  );
  process.exit(1);
}

const covered = new Map();
const skipped = new Map();
for (const c of index.cases || []) {
  if (c.ok) covered.set(c.method, c.module);
  else if (c.skipped && typeof c.reason === 'string' && c.reason.trim()) skipped.set(c.method, c.reason);
}

const missing = [];
const skippedList = [];
for (const method of [...used.keys()].sort()) {
  if (covered.has(method)) continue;
  if (skipped.has(method)) {
    skippedList.push({ method, reason: skipped.get(method) });
    continue;
  }
  missing.push({ method, callSites: used.get(method) });
}

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        usedCount: used.size,
        coveredCount: [...used.keys()].filter((m) => covered.has(m)).length,
        skipped: skippedList,
        missing,
        gatewayVersion: index.gatewayVersion,
        recordedAt: index.recordedAt,
      },
      null,
      2
    )
  );
} else {
  const coveredCount = [...used.keys()].filter((m) => covered.has(m)).length;
  console.log(`[contract:coverage] 源码使用 ${used.size} 个方法 · 真实探针覆盖 ${coveredCount} 个`);
  console.log(`[contract:coverage] fixture 录制自网关 ${index.gatewayVersion} @ ${index.recordedAt}`);
  for (const s of skippedList) console.log(`  · 跳过 ${s.method}: ${s.reason}`);
  if (missing.length > 0) {
    console.error(`\n[contract:coverage] ${missing.length} 个方法从未被真实验证过：`);
    for (const m of missing) console.error(`  ✗ ${m.method}  调用点: ${m.callSites.join(', ')}`);
    console.error('\n修复方式：在 scripts/contract/probe.mjs 中补一个探针用例，然后运行 npm run probe:gateway');
    process.exit(1);
  }
  console.log('[contract:coverage] 通过：每个调用点都有真实响应证据或显式跳过原因');
}
