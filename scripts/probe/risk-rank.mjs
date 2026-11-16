/**
 * 回归基线风险排序探针（一次性脚本，验证「无缺陷历史」下的排序信号是否可用）
 *
 * 设计意图 (Why)：历史 issue 为空时，用 git 变更强度 + 体量 + 外部依赖 + 现有测试引用数
 *   作为可用替代信号，输出可复核的排序表，而不是凭直觉挑模块。
 * 约束 (Rules)：只读 git 与源码，不修改任何文件；不联网。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SINCE = process.argv[2] ?? '180 days ago';
const TOP = Number(process.argv[3] ?? 20);

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// 1) 统计每个源文件的提交次数与增删行（相对变更强度）
const numstat = git(['log', `--since=${SINCE}`, '--numstat', '--pretty=format:__C__']);
const churn = new Map();
const commits = new Map();
let current = 0;
for (const line of numstat.split(/\r?\n/)) {
  if (line.startsWith('__C__')) { current += 1; continue; }
  if (!line.trim()) continue;
  const [add, del, file] = line.split('\t');
  if (!file || add === '-') continue;
  if (!/\.(ts|tsx)$/.test(file)) continue;
  if (file.includes('__tests__') || file.endsWith('.d.ts')) continue;
  const prev = churn.get(file) ?? { adds: 0, dels: 0, commits: 0 };
  prev.adds += Number(add);
  prev.dels += Number(del);
  prev.commits += 1;
  churn.set(file, prev);
}

// 2) 编译产物存在与否 = 该文件当前是否被测试直接引用（间接信号）
const testFiles = git(['ls-files', '*__tests__*'])
  .split(/\r?\n/)
  .filter((f) => f.endsWith('.test.mjs'));
const testBodies = testFiles.map((f) => ({
  file: f,
  body: fs.readFileSync(path.join(ROOT, f), 'utf8'),
}));

function testRefs(file) {
  const base = path.basename(file).replace(/\.(ts|tsx)$/, '');
  const dir = path.basename(path.dirname(file));
  const tokens = [base, `${dir}/${base}`];
  let n = 0;
  for (const t of testBodies) if (tokens.some((k) => t.body.includes(k))) n += 1;
  return n;
}

// 3) 外部依赖数量（import 非相对路径的模块数，去重）
function externalDeps(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const deps = new Set();
  for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (!spec.startsWith('.')) deps.add(spec.replace(/^node:/, ''));
  }
  return deps.size;
}

function loc(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/).length;
}

const rows = [];
for (const [file, c] of churn) {
  if (!fs.existsSync(path.join(ROOT, file))) continue;
  const size = loc(file);
  const refs = testRefs(file);
  const deps = externalDeps(file);
  // 分数：变更强度 40% + 体量 20% + 外部依赖 20% + 测试缺口 20%
  const churnScore = Math.min(1, (c.adds + c.dels) / 2000);
  const sizeScore = Math.min(1, size / 800);
  const depScore = Math.min(1, deps / 8);
  const gapScore = refs === 0 ? 1 : Math.min(1, 1 / refs);
  const score = 0.4 * churnScore + 0.2 * sizeScore + 0.2 * depScore + 0.2 * gapScore;
  rows.push({ file, commits: c.commits, adds: c.adds, dels: c.dels, loc: size, deps, testRefs: refs, score: Number(score.toFixed(3)) });
}

rows.sort((a, b) => b.score - a.score);
console.log(`window=${SINCE}  files=${rows.length}  testFiles=${testFiles.length}`);
console.log('score | commits | +adds/-dels | loc | deps | testRefs | file');
for (const r of rows.slice(0, TOP)) {
  console.log(
    `${String(r.score).padEnd(5)} | ${String(r.commits).padStart(7)} | ${String(r.adds).padStart(5)}/${String(r.dels).padEnd(5)} | ${String(r.loc).padStart(3)} | ${String(r.deps).padStart(4)} | ${String(r.testRefs).padStart(8)} | ${r.file}`,
  );
}
const noTest = rows.filter((r) => r.testRefs === 0);
console.log(`\n无任何测试引用的源文件: ${noTest.length}/${rows.length} (${((100 * noTest.length) / rows.length).toFixed(1)}%)`);
