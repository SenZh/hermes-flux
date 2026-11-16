#!/usr/bin/env node
/**
 * 增量覆盖率门禁：新增/修改的代码行必须被执行过。
 *
 * 设计意图 (Why):
 *   全局覆盖率是平均值，会被老代码污染：老代码拉低它，好代码被藏进高均值里。
 *   唯一能把责任落到"这次提交"的边界是增量——只看本分支相对基线的改动行。
 *   这不是"要求更严"，而是让每次提交对自己新增的那部分负责。
 *
 * 防范的历史坑 (Pitfall)（均有实测依据）:
 *   1. c8 / node 内置覆盖率记录的是**构建产物** dist/*.mjs 的行号，
 *      而 git diff 给的是 src/*.ts 的行号。不反解 sourcemap 时两边永不重合，
 *      判定会静默变成"新增 0 行"从而永远通过。
 *   2. lcov 的 SF 路径在 Windows 下是 `\` 分隔，必须 POSIX 化，否则路径永不匹配。
 *   3. 必须断言 lcov 的目标文件数 > 0。产物缺失或测试没导入时 lcov 为空，
 *      此时"没有任何未覆盖行"会伪装成"全部覆盖"。
 *   4. 豁免注释 `c8 ignore` 会让新增行根本不进 lcov，于是 hits===0 的判据失效。
 *      因此必须同时扫源码里的豁免注释并显式计数（由 test-integrity 规则与
 *      allow-budget 共同看住）。
 *
 * 用法:
 *   node scripts/verify/new-code-coverage.mjs --base=origin/dev/v0.1
 *   node scripts/verify/new-code-coverage.mjs            # 默认与 merge-base 比
 *
 * 约束与规则 (Rules):
 *   - 只统计真正的可执行行：注释、空行、纯类型声明不计入分母。
 *   - 新增文件若完全不在 lcov 中 → FAIL（说明测试根本没 import 它）。
 *   - 输出必须逐条列出「文件:行」，否则无法定位。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const require = createRequire(path.join(REPO_ROOT, 'package.json'));

const C = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
};

/** 计入覆盖率判定的源码扩展名。必须覆盖 tsx/mjs/css，否则整类文件被静默跳过。 */
const TRACKED_EXT = ['.ts', '.tsx', '.mjs', '.js'];

/** 不参与判定的路径（测试自身、产物、生成器输出、门禁工具自身） */
const EXCLUDE_PATH = [
  /^packages\/(core|ui|desktop|mobile)\/__tests__\//,
  /^scripts\/__tests__\//,
  /\.test\.(mjs|js|ts)$/,
  /\.generated\.ts$/,
  /\.d\.ts$/,
  /^docs\//,
  /^artifacts\//,
  /**
   * 门禁工具自身不参与增量覆盖判定。
   *
   * 【设计意图 (Why)】scripts/ 下的校验脚本由人工在提交前直接运行，
   * 它们不是"被测试覆盖的产物"，对它们要求行覆盖只会逼出"为了覆盖率而写的空跑"。
   * 这些脚本的可信度靠另一套机制保证：它们的判定必须能被证伪
   * （见 artifacts/tools 下的探针与 gates:mutation）。
   */
  /^scripts\/verify\//,
  /^scripts\/gates\//,
  /^scripts\/contract\//,
  /^scripts\/probe\//,
];

/* ---------------- 1. 取基线 ---------------- */
function resolveBase() {
  if (process.argv.includes('--staged')) return 'STAGED';
  const arg = process.argv.find((a) => a.startsWith('--base='));
  if (arg) return arg.slice('--base='.length);

  // GitHub Actions PR 环境变量
  if (process.env.GITHUB_BASE_REF) {
    return `origin/${process.env.GITHUB_BASE_REF}`;
  }

  try {
    const mb = execFileSync('git', ['merge-base', 'HEAD', 'origin/dev/v0.1'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    // 防范历史坑：当 mb === head 时说明分支与基准已对齐无领先 commit，
    // 若直接比对自身会导致 diff 为空从而静默通过。此时退回 HEAD~1。
    if (mb && mb !== head) return mb;
  } catch {
    // 没有远端分支时退回到 HEAD~1，保证本地可跑
  }
  return 'HEAD~1';
}

/* ---------------- 2. 取新增行 ---------------- */
/**
 * 用 `git diff -U0` 解析新增行区间。
 * 【规则】--diff-filter=ACMR 只取新增/复制/修改/重命名，删除的文件没有"新增行"。
 */
function collectAddedLines(base) {
  const customProbe = process.argv.find((a) => a.startsWith('--probe-files='));
  if (customProbe) {
    const files = new Map();
    const probeList = customProbe.slice('--probe-files='.length).split(',').map((s) => s.trim()).filter(Boolean);
    for (const rel of probeList) {
      const abs = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(abs)) continue;
      const total = fs.readFileSync(abs, 'utf8').split('\n').length;
      files.set(rel, Array.from({ length: total }, (_, i) => i + 1));
    }
    return files;
  }

  const diffArgs = base === 'STAGED'
    ? ['diff', '--cached', '--unified=0', '--diff-filter=ACMR', '--', ...TRACKED_EXT.map((e) => `*${e}`)]
    : ['diff', '--unified=0', '--diff-filter=ACMR', base, '--', ...TRACKED_EXT.map((e) => `*${e}`)];

  const tracked = execFileSync('git', diffArgs, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  const files = new Map();
  let current = null;
  const acceptFile = (rel) => {
    if (EXCLUDE_PATH.some((re) => re.test(rel))) return false;
    if (!TRACKED_EXT.some((e) => rel.endsWith(e))) return false;
    // 增量覆盖率严格约束生产逻辑（packages/*/src/），非生产脚本不计入产物覆盖判定
    if (!/^packages\/(core|ui|desktop|mobile)\/src\//.test(rel)) return false;
    return true;
  };

  for (const line of tracked.split('\n')) {
    if (line.startsWith('+++ b/')) {
      current = line.slice('+++ b/'.length).trim();
      if (!acceptFile(current)) current = null;
      else if (!files.has(current)) files.set(current, []);
      continue;
    }
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m || !current) continue;
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    if (count === 0) continue; // 纯删除
    const list = files.get(current);
    for (let i = 0; i < count; i += 1) list.push(start + i);
  }

  /**
   * 【防范的历史坑 (Pitfall)】`git diff` 完全看不到未跟踪文件。
   * 而"新增文件"恰恰永远是未跟踪的——只靠 diff 会让本门禁对新增模块
   * 一律报「改动 0 个文件」然后放行。实测：新增一个含未覆盖分支的模块，
   * 门禁静默通过。因此未跟踪文件必须按「整文件都是新增行」计入。
   */
  if (base !== 'STAGED') {
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    for (const rel of untracked.split('\n').map((s) => s.trim()).filter(Boolean)) {
      if (!acceptFile(rel)) continue;
      const abs = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(abs)) continue;
      const total = fs.readFileSync(abs, 'utf8').split('\n').length;
      files.set(rel, Array.from({ length: total }, (_, i) => i + 1));
    }
  }

  return files;
}

/* ---------------- 3. 采集覆盖率 ---------------- */
/**
 * 跑测试并采集 lcov。
 * 【约束】必须用 node 内置覆盖率（--experimental-test-coverage），不引入 c8：
 *   多一个依赖就多一处"装了但没用上"的风险，而内置能力已经够用。
 */
async function collectLcov(suite, targetFiles = []) {
  const outFile = path.join(os.tmpdir(), `flux-lcov-${Date.now()}.info`);
  const files = await listTestFilesForSuite(suite, targetFiles);
  if (files.length === 0) return { path: null, files: 0 };

  const env = { ...process.env, FORCE_COLOR: '0' };
  delete env.NODE_TEST_CONTEXT;

  const r = spawnSync(
    process.execPath,
    ['--test', '--experimental-test-coverage', '--test-reporter=lcov', `--test-reporter-destination=${outFile}`, ...files],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 60 * 1000, env },
  );
  if (!fs.existsSync(outFile)) return { path: null, files: files.length, status: r.status };
  return { path: outFile, files: files.length, status: r.status };
}

async function listTestFilesForSuite(suite, targetFiles = []) {
  const customFiles = process.argv.find((a) => a.startsWith('--test-files='));
  if (customFiles) {
    return customFiles.slice('--test-files='.length).split(',').map((f) => f.trim()).filter(Boolean);
  }
  // 复用 census 的单一真值源，避免两套 glob 口径
  const mod = await import('../gates/lib/test-targets.mjs');
  const allFiles = mod.listSuiteFiles(suite);

  // 性能优化：按改动文件所在的包精准圈定测试范围，避免无关包（如 scripts/ 下的多进程探针）拖慢门禁
  const packagesInvolved = new Set();
  for (const f of targetFiles) {
    const m = /^packages\/([^/]+)\//.exec(f);
    if (m) packagesInvolved.add(m[1]);
  }

  if (packagesInvolved.size > 0) {
    const matched = allFiles.filter((tf) => {
      return Array.from(packagesInvolved).some((pkg) => tf.startsWith(`packages/${pkg}/`));
    });
    if (matched.length > 0) return matched;
  }

  // 增量覆盖率只约束业务单元测试，默认排除 scripts/__tests__
  return allFiles.filter((tf) => tf.startsWith('packages/'));
}

/* ---------------- 4. 解析 lcov 为 dist 行与分支覆盖 ---------------- */
function parseLcov(lcovPath) {
  const text = fs.readFileSync(lcovPath, 'utf8');
  const records = new Map();
  for (const block of text.split('end_of_record')) {
    const sfMatch = /^SF:(.+)$/m.exec(block);
    if (!sfMatch) continue;
    const sf = sfMatch[1].trim().split(path.sep).join('/');
    const da = new Map();
    for (const m of block.matchAll(/^DA:(\d+),(\d+)/gm)) da.set(Number(m[1]), Number(m[2]));

    const brda = [];
    for (const m of block.matchAll(/^BRDA:(\d+),(\d+),(\d+),(\d+|-)/gm)) {
      const taken = m[4] === '-' ? 0 : Number(m[4]);
      brda.push({ distLine: Number(m[1]), block: Number(m[2]), branch: Number(m[3]), taken });
    }

    const brf = /^BRF:(\d+)$/m.exec(block);
    const brh = /^BRH:(\d+)$/m.exec(block);
    records.set(sf, { da, brda, brf: brf ? Number(brf[1]) : 0, brh: brh ? Number(brh[1]) : 0 });
  }
  return records;
}

/* ---------------- 5. dist 行/分支 -> src 行/分支（sourcemap 反解） ---------------- */
/**
 * 纯内置 Base64-VLQ 映射解析器，零外部第三方依赖。
 * 将 esbuild / tsc 产物的 sourcemap 逆向反解为生成的 generatedLine -> { source, line }。
 */
function parseSourceMapMappings(map) {
  if (!map || !map.mappings || !Array.isArray(map.sources)) return new Map();

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const charToVal = new Uint8Array(256);
  for (let i = 0; i < B64.length; i++) charToVal[B64.charCodeAt(i)] = i;

  const distToSrc = new Map();
  const lines = map.mappings.split(';');
  let sourceIndex = 0;
  let originalLine = 0;

  for (let genLine = 1; genLine <= lines.length; genLine++) {
    const segs = lines[genLine - 1].split(',');
    for (const seg of segs) {
      if (!seg) continue;
      let shift = 0;
      let value = 0;
      const vals = [];
      for (let i = 0; i < seg.length; i++) {
        const integer = charToVal[seg.charCodeAt(i)];
        const hasContinuation = integer & 32;
        value += (integer & 31) << shift;
        if (hasContinuation) {
          shift += 5;
        } else {
          vals.push((value & 1) ? -(value >>> 1) : (value >>> 1));
          value = 0;
          shift = 0;
        }
      }
      if (vals.length >= 4) {
        sourceIndex += vals[1];
        originalLine += vals[2];
        const srcFile = map.sources[sourceIndex];
        if (srcFile) {
          distToSrc.set(genLine, { source: srcFile, line: originalLine + 1 });
        }
      }
    }
  }
  return distToSrc;
}

/**
 * 用 esbuild/tsc 产物的 .map 把「dist 行覆盖」与「dist 分支覆盖」映射回「src 行覆盖与分支」。
 */
function buildSrcLineCoverage(records) {
  /** src 相对路径 -> Set<已覆盖行> */
  const srcCovered = new Map();
  /** src 相对路径 -> Set<可映射行>（用于区分"没跑到"与"没有可执行代码"） */
  const srcMapped = new Map();
  /** src 相对路径 -> Map<行号, number>（该行分支总数） */
  const srcBranchTotal = new Map();
  /** src 相对路径 -> Map<行号, number>（该行命中分支数） */
  const srcBranchHit = new Map();
  /** src 相对路径 -> Set<存在未覆盖分支的行号> */
  const srcBranchUncovered = new Map();

  let mappedRecords = 0;

  for (const [sf, rec] of records) {
    const mapPath = path.join(REPO_ROOT, sf);
    const mapFile = `${mapPath}.map`;
    if (!fs.existsSync(mapFile)) continue;

    let map;
    try {
      map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    } catch {
      continue;
    }
    const distToSrc = parseSourceMapMappings(map);
    if (distToSrc.size === 0) continue;
    mappedRecords += 1;

    const mapDir = path.dirname(sf);

    // 反解代码行 (DA)
    for (const [distLine, hits] of rec.da) {
      const hit = distToSrc.get(distLine);
      if (!hit) continue;
      // sourcemap 里的 source 是相对 map 文件的路径，归一成仓库相对 POSIX 路径
      const abs = path.resolve(REPO_ROOT, mapDir, hit.source);
      const rel = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
      if (!srcMapped.has(rel)) srcMapped.set(rel, new Set());
      srcMapped.get(rel).add(hit.line);
      if (hits > 0) {
        if (!srcCovered.has(rel)) srcCovered.set(rel, new Set());
        srcCovered.get(rel).add(hit.line);
      }
    }

    // 反解代码分支 (BRDA)
    for (const b of rec.brda) {
      const hit = distToSrc.get(b.distLine);
      if (!hit) continue;
      const abs = path.resolve(REPO_ROOT, mapDir, hit.source);
      const rel = path.relative(REPO_ROOT, abs).split(path.sep).join('/');

      if (!srcBranchTotal.has(rel)) srcBranchTotal.set(rel, new Map());
      const totalMap = srcBranchTotal.get(rel);
      totalMap.set(hit.line, (totalMap.get(hit.line) ?? 0) + 1);

      if (!srcBranchHit.has(rel)) srcBranchHit.set(rel, new Map());
      const hitMap = srcBranchHit.get(rel);
      if (b.taken > 0) {
        hitMap.set(hit.line, (hitMap.get(hit.line) ?? 0) + 1);
      } else {
        if (!srcBranchUncovered.has(rel)) srcBranchUncovered.set(rel, new Set());
        srcBranchUncovered.get(rel).add(hit.line);
      }
    }
  }

  return { srcCovered, srcMapped, srcBranchTotal, srcBranchHit, srcBranchUncovered, mappedRecords };
}

/* ---------------- 6. 判定可执行行 ---------------- */
/**
 * 查找某个源文件对应的构建产物（同目录同名的 .mjs / .js / .cjs）。
 *
 * 【设计意图 (Why)】"没有产物"与"有产物但没测试"是两种完全不同的缺陷，
 * 修复动作一个是改构建清单、一个是补测试。判定必须能把它们分开，
 * 否则报错文案会把人引向错误的方向。
 */
function findDistArtifacts(relSrc) {
  const base = relSrc.replace(/\.(ts|tsx)$/, '');
  const candidates = [];
  for (const ext of ['.mjs', '.js', '.cjs']) {
    const rel = `${base}${ext}`.replace('/src/', '/dist/');
    if (fs.existsSync(path.join(REPO_ROOT, rel))) candidates.push(rel);
  }
  return candidates;
}

/**
 * 判断某一行是否有可执行的判定价值。
 * 【规则】注释、空行、纯 import/export type、接口字段声明不计入分母：
 *   它们没有"被执行"的语义，强行统计只会逼出无意义的测试。
 */
function isCountableLine(raw) {
  const t = raw.trim();
  if (!t) return false;
  if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/')) return false;
  if (/^(import|export)\s+type\b/.test(t)) return false;
  if (/^export\s*\{[^}]*\}\s*;?$/.test(t) && !t.includes('from')) return false;
  if (/^\}?\s*$/.test(t)) return false;
  // 纯接口/类型块的字段行：以标识符+问号/冒号开头且行尾是 ; 或 ,
  if (/^[A-Za-z_$][\w$]*\??\s*:\s*[^=]+[;,]$/.test(t)) return false;
  return true;
}

/* ---------------- 主流程 ---------------- */
async function main() {
  const base = resolveBase();
  const added = collectAddedLines(base);

  console.log(`${C.cyan}${C.bold}增量覆盖率门禁${C.reset}`);
  console.log(`${C.dim}  基线 ${base.slice(0, 12)} · 改动文件 ${added.size} 个${C.reset}\n`);

  if (added.size === 0) {
    console.log(`${C.yellow}! 本次改动没有触及受控源码（.ts/.tsx/.mjs/.js），无需判定${C.reset}`);
    process.exitCode = 0;
    return;
  }

  const lcov = await collectLcov('unit', Array.from(added.keys()));
  if (!lcov.path) {
    console.error(`${C.red}✘ 未产出覆盖率数据（测试进程可能崩溃），无法判定新增行${C.reset}`);
    process.exitCode = 1;
    return;
  }

  const records = parseLcov(lcov.path);
  /**
   * 【失败不可静默】必须断言真的采到了数据。
   * lcov 为空时"没有任何未覆盖行"会伪装成"全部覆盖"，这是最危险的一类假绿。
   */
  if (records.size === 0) {
    console.error(`${C.red}✘ lcov 为空：没有任何文件被记录，判定不可信${C.reset}`);
    process.exitCode = 1;
    return;
  }

  const { srcCovered, srcMapped, srcBranchTotal, srcBranchHit, srcBranchUncovered, mappedRecords } = buildSrcLineCoverage(records);
  console.log(
    `${C.dim}  覆盖率采样：${records.size} 个产物记录，其中 ${mappedRecords} 个可反解 sourcemap；` +
      `${srcMapped.size} 个源文件有可映射行${C.reset}\n`,
  );

  /* ---------------- 判定 ---------------- */
  const failures = [];
  let countedLinesTotal = 0;
  let coveredLinesTotal = 0;
  let countedBranchesTotal = 0;
  let coveredBranchesTotal = 0;
  const skipped = [];

  for (const [file, lines] of added) {
    const abs = path.join(REPO_ROOT, file);
    if (!fs.existsSync(abs)) continue;
    const rawLines = fs.readFileSync(abs, 'utf8').split('\n');
    const covered = srcCovered.get(file) ?? new Set();
    const mapped = srcMapped.get(file) ?? new Set();
    const branchTotal = srcBranchTotal.get(file) ?? new Map();
    const branchHit = srcBranchHit.get(file) ?? new Map();
    const branchUncovered = srcBranchUncovered.get(file) ?? new Set();

    const countable = lines.filter((ln) => isCountableLine(rawLines[ln - 1] ?? ''));

    if (countable.length === 0) {
      skipped.push(file);
      continue;
    }

    /**
     * 若该文件完全没有可映射行，必须区分两种完全不同的原因：
     *
     *   a) 文件根本没有构建产物 —— 说明 esbuild 入口清单里没有它，
     *      测试即使写了 import 也跑不起来。修法是把它加进建构建清单。
     *   b) 有产物但测试从未 import —— 说明缺测试。
     *
     * 【防范的历史坑 (Pitfall)】原先两者共用一句"不在覆盖率数据中"，
     * 实测中真正的原因是 (a)，但文案把人引向"补测试"，
     * 于是补了测试仍然红，而根因（没构建）始终没被指出来。
     */
    if (mapped.size === 0) {
      const distCandidates = findDistArtifacts(file);
      const reason = distCandidates.length === 0
        ? `没有构建产物：该模块未登记进 esbuild 入口清单（packages/desktop/scripts/build.mjs），测试无法导入它`
        : `有构建产物（${distCandidates[0]}）但没有任何测试 import 它`;
      failures.push({ file, reason, lines: countable });
      countedLinesTotal += countable.length;
      continue;
    }

    // 1. 行覆盖判定
    const uncoveredLines = countable.filter((ln) => !covered.has(ln));
    countedLinesTotal += countable.length;
    coveredLinesTotal += countable.length - uncoveredLines.length;
    if (uncoveredLines.length > 0) {
      failures.push({ file, reason: `${uncoveredLines.length} 行新增代码未被任何测试执行 (Line Coverage < 100%)`, lines: uncoveredLines });
    }

    // 2. 分支覆盖判定（只对已执行的代码行判定其分支是否双向闭环）
    const branchUncoveredLines = [];
    for (const ln of countable) {
      const total = branchTotal.get(ln) ?? 0;
      const hit = branchHit.get(ln) ?? 0;
      if (total > 0) {
        countedBranchesTotal += total;
        coveredBranchesTotal += hit;
        if (covered.has(ln) && branchUncovered.has(ln)) {
          branchUncoveredLines.push(ln);
        }
      }
    }

    if (branchUncoveredLines.length > 0) {
      failures.push({
        file,
        reason: `${branchUncoveredLines.length} 处新增分支未全路径覆盖 (Branch Coverage < 100%)`,
        lines: branchUncoveredLines,
      });
    }
  }

  /* ---------------- 报告 ---------------- */
  const linePct = countedLinesTotal === 0 ? 100 : Math.round((coveredLinesTotal / countedLinesTotal) * 1000) / 10;
  const branchPct = countedBranchesTotal === 0 ? 100 : Math.round((coveredBranchesTotal / countedBranchesTotal) * 1000) / 10;

  console.log(`新增可执行行：${countedLinesTotal} · 已覆盖 ${coveredLinesTotal} · 行覆盖率 ${linePct}%`);
  console.log(`新增条件分支：${countedBranchesTotal} · 已命中 ${coveredBranchesTotal} · 分支覆盖率 ${branchPct}%`);
  if (skipped.length > 0) {
    console.log(`${C.dim}  跳过 ${skipped.length} 个无新增可执行行的文件${C.reset}`);
  }

  if (failures.length === 0) {
    console.log(`\n${C.green}${C.bold}✔ 增量覆盖达标：新增代码行与分支覆盖率均为 100%${C.reset}`);
    process.exitCode = 0;
    fs.rmSync(lcov.path, { force: true });
    return;
  }

  console.log(`\n${C.red}${C.bold}✘ 增量覆盖不达标 (必须达到 100% 行覆盖 + 100% 分支覆盖)${C.reset}`);
  for (const f of failures) {
    console.log(`  ${C.red}·${C.reset} ${f.file}  ${f.reason}`);
    console.log(`    ${C.dim}行：${f.lines.join(', ')}${C.reset}`);
  }
  console.log(`${C.dim}  补齐单测覆盖未执行行及未覆盖条件分支。${C.reset}`);
  process.exitCode = 1;
  fs.rmSync(lcov.path, { force: true });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
