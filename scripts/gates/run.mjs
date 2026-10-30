#!/usr/bin/env node
/**
 * Hermes Flux 统一门禁执行器（Single Source of Truth）
 *
 * 设计意图 (Why):
 *   规则、执行、报告、债务冻结必须在同一处实现，否则 CI、pre-commit、
 *   Agent 自检会各自演化出三套口径，最终「本地绿、CI 红、Agent 说绿」。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 一次性把 150+ 条存量违规全部变红 -> 门禁当天被注释掉，永久失效。
 *      因此采用「债务冻结 + 新增零容忍」棘轮：存量记入 baseline 不阻断，
 *      新增一律阻断，且清偿后 baseline 自动收缩（不许回涨）。
 *   2. baseline 只按文件+规则计数 -> 修一条又加一条会互相抵消。
 *      因此按「规则 + 文件 + 行内容指纹」精确匹配，禁止用计数互相抵消。
 *
 * 用法：
 *   node scripts/gates/run.mjs                 # 全量扫描 + 债务棘轮
 *   node scripts/gates/run.mjs --changed       # 仅扫描改动文件
 *   node scripts/gates/run.mjs --staged        # 仅扫描暂存区（pre-commit）
 *   node scripts/gates/run.mjs --json          # 机器可读输出（Agent 消费）
 *   node scripts/gates/run.mjs --strict        # 存量债务也阻断（清偿模式）
 *   node scripts/gates/run.mjs --update-baseline  # 重新冻结债务（须人工确认）
 */

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, listSourceFiles, readSource, shortHash } from './lib/scanner.mjs';
import { changedFiles } from './lib/changed.mjs';
import { RULES } from './rules.mjs';
import {
  heading,
  formatViolation,
  formatRuleSummary,
  warnLine,
  okLine,
  paint,
  C,
} from './lib/reporter.mjs';

const BASELINE_PATH = path.join(REPO_ROOT, 'scripts/gates/.baseline.json');
/**
 * 扫描根目录。
 *
 * 关键：必须把 `scripts/gates` 自身也纳入扫描域。
 * 历史坑：门禁引擎曾完全不在扫描域内，导致「门禁代码自己写 as any、
 * 自己写死色值」无人拦截，这是典型的监管盲区。
 */
const SCAN_ROOTS = [
  'packages/core/src',
  'packages/ui/src',
  'packages/desktop/src',
  'scripts/gates',
];

/**
 * 引擎自身需要豁免的规则：
 *   - theme/i18n：门禁脚本里出现的色值/中文是**规则定义与诊断文案**，不是 UI 像素
 *   - perf：门禁脚本不渲染
 * 但 arch（类型逃逸）与依赖方向必须照常生效。
 */
const ENGINE_SELF_EXEMPT = {
  theme: (file) => file.startsWith('scripts/gates/'),
  i18n: (file) => file.startsWith('scripts/gates/'),
  perf: (file) => file.startsWith('scripts/gates/'),
  layout: (file) => file.startsWith('scripts/gates/'),
};

const argv = process.argv.slice(2);
const flags = {
  changed: argv.includes('--changed'),
  staged: argv.includes('--staged'),
  json: argv.includes('--json'),
  strict: argv.includes('--strict'),
  updateBaseline: argv.includes('--update-baseline'),
};

/* ---------------- 目标文件集合 ---------------- */
function resolveTargets() {
  if (flags.changed || flags.staged) {
    const changed = new Set(changedFiles({ stagedOnly: flags.staged }));
    const all = SCAN_ROOTS.flatMap((root) => listSourceFiles(root));
    return all.filter((f) => changed.has(f));
  }
  return SCAN_ROOTS.flatMap((root) => listSourceFiles(root));
}

/* ---------------- 债务基线 ---------------- */
function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return { version: 1, frozenAt: null, entries: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    if (!parsed || typeof parsed.entries !== 'object' || parsed.entries === null) {
      return { version: 1, frozenAt: null, entries: {} };
    }
    return parsed;
  } catch {
    return { version: 1, frozenAt: null, entries: {} };
  }
}

/**
 * 债务条目的稳定键。
 * 组成： ruleId + file + 行内容指纹
 * 不含行号 —— 上方插入一行代码不应让债务失效或凭空新增。
 */
function debtKey(v) {
  return `${v.ruleId}::${v.file}::${shortHash(v.snippet ?? '')}`;
}

function saveBaseline(violations) {
  const entries = {};
  for (const v of violations) {
    const key = debtKey(v);
    entries[key] = (entries[key] ?? 0) + 1;
  }
  const payload = {
    version: 1,
    frozenAt: new Date().toISOString().slice(0, 10),
    note: '存量债务冻结清单。新增违规一律阻断；本文件只允许收缩（--update-baseline 仅在人工确认清偿后使用）。',
    entries,
  };
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

/* ---------------- 执行 ---------------- */
function run() {
  const targets = resolveTargets();
  const baseline = loadBaseline();
  const frozenPool = { ...baseline.entries };

  const results = [];
  const allViolations = [];
  const layoutWarnings = [];

  for (const file of targets) {
    let ctx;
    try {
      const parsed = readSource(file);
      // warnings 通道用于「必须可见但不阻断」的已登记偏差
      ctx = { ...parsed, warnings: [] };
    } catch (err) {
      console.error(warnLine(`无法读取 ${file}: ${err.message}`));
      continue;
    }
    for (const rule of RULES) {
      // 引擎自身对 UI 类规则豁免（它不渲染像素），但架构规则照常约束
      if (ENGINE_SELF_EXEMPT[rule.id]?.(file)) continue;
      const found = rule.check(file, ctx);
      layoutWarnings.push(...ctx.warnings);
      ctx.warnings.length = 0;
      if (found.length === 0) continue;
      allViolations.push(...found);
      results.push({ rule, found });
    }
  }

  /* 棘轮判定：逐条把违规与冻结池对冲 */
  const blockingByRule = new Map();
  const frozenByRule = new Map();
  const removedKeys = new Set();

  for (const { rule, found } of results) {
    for (const v of found) {
      const key = debtKey(v);
      const remaining = frozenPool[key] ?? 0;
      if (remaining > 0) {
        frozenPool[key] = remaining - 1;
        frozenByRule.set(rule.id, (frozenByRule.get(rule.id) ?? 0) + 1);
      } else {
        blockingByRule.set(rule.id, (blockingByRule.get(rule.id) ?? 0) + 1);
        v.blocking = true;
        removedKeys.add(key);
      }
    }
  }

  // 冻结池里剩余未消费的条目 = 已被清偿的债务。
  // 注意：只有「全量扫描」才能断言债务已清偿。改动集/暂存区扫描只覆盖少数文件，
  // 未被覆盖的条目会大量剩在池里，若照样计入清偿数就会得出「一次提交清偿了 300 条」的假结论。
  const isFullScan = !flags.changed && !flags.staged;
  const paidOff = isFullScan
    ? Object.entries(frozenPool).reduce((sum, [, n]) => sum + Math.max(0, n), 0)
    : 0;

  // 逐规则统计已清偿数，避免所有规则平摊同一个全局数字
  const paidOffByRule = new Map();
  if (isFullScan) {
    for (const [key, remaining] of Object.entries(frozenPool)) {
      const n = Math.max(0, remaining);
      if (n === 0) continue;
      const ruleId = key.split('::')[0];
      // 基线里可能出现已不存在的规则 ID（规则被重写），归入 unknown 不影响判定
      paidOffByRule.set(ruleId, (paidOffByRule.get(ruleId) ?? 0) + n);
    }
  }

  const totalBlocking = [...blockingByRule.values()].reduce((a, b) => a + b, 0);
  const totalFrozen = [...frozenByRule.values()].reduce((a, b) => a + b, 0);

  /**
   * 实际阻断量。
   * 历史坑：这里曾只算 totalBlocking，导致 `--strict` 打印 314 条明细后
   * 仍输出「门禁通过」且退出码为 0——严格模式形同虚设，是最危险的一类假绿。
   * 因此 exitCode 与 ok 必须同时由 strict 模式下的冻结数驱动。
   */
  const effectiveBlocking = totalBlocking + (flags.strict ? totalFrozen : 0);
  const passed = effectiveBlocking === 0;

  /* ---------------- 输出 ---------------- */
  if (flags.json) {
    const payload = {
      ok: passed,
      scannedFiles: targets.length,
      mode: flags.staged ? 'staged' : flags.changed ? 'changed' : 'full',
      strict: flags.strict,
      summary: {
        blocking: totalBlocking,
        frozenDebt: totalFrozen,
        paidOff,
        effectiveBlocking,
      },
      byRule: RULES.map((r) => ({
        id: r.id,
        gate: r.gate,
        title: r.title,
        blocking: blockingByRule.get(r.id) ?? 0,
        frozen: frozenByRule.get(r.id) ?? 0,
      })),
      violations: allViolations
        .filter((v) => v.blocking || flags.strict)
        .map((v) => ({
          rule: v.ruleId,
          file: v.file,
          line: v.line,
          message: v.message,
          snippet: v.snippet,
        })),
      warnings: layoutWarnings.map((w) => ({
        rule: w.ruleId,
        file: w.file,
        message: w.message,
      })),
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exitCode = payload.ok ? 0 : 1;
    return;
  }

  console.log(heading('Hermes Flux Quality Gates'));
  console.log(
    paint(
      C.dim,
      `  扫描 ${targets.length} 个源文件 · ${flags.staged ? '暂存区' : flags.changed ? '改动集' : '全量'} · 债务基线 ${baseline.frozenAt ?? '未初始化'}`,
    ),
  );

  let currentGate = '';
  for (const rule of RULES) {
    const blocking = blockingByRule.get(rule.id) ?? 0;
    const frozen = frozenByRule.get(rule.id) ?? 0;
    const fixed = paidOffByRule.get(rule.id) ?? 0;
    if (rule.gate !== currentGate) {
      currentGate = rule.gate;
      console.log(heading(`${currentGate}`));
    }
    console.log(formatRuleSummary(rule.title, { blocking, frozen, fixed }));
  }

  const printable = allViolations.filter((v) => v.blocking || flags.strict);
  if (printable.length > 0) {
    console.log(heading(`违规明细（${printable.length} 条）`));
    const grouped = new Map();
    for (const v of printable) {
      if (!grouped.has(v.file)) grouped.set(v.file, []);
      grouped.get(v.file).push(v);
    }
    for (const [file, list] of [...grouped.entries()].sort()) {
      console.log(`\n  ${paint(C.bold, file)}`);
      for (const v of list.sort((a, b) => a.line - b.line)) console.log(formatViolation(v));
    }
  }

  // 已登记偏差：不阻断，但必须每次运行都可见，否则会被永久遗忘
  if (layoutWarnings.length > 0) {
    console.log(heading('规范偏差登记（不阻断，须择一对齐）'));
    for (const w of layoutWarnings) {
      console.log(warnLine(`${paint(C.dim, w.file)}  ${w.message}`));
    }
  }

  console.log('');
  if (passed) {
    console.log(okLine(paint(C.green + C.bold, '门禁通过：无新增违规')));
    if (totalFrozen > 0) {
      console.log(warnLine(`存量债务仍有 ${totalFrozen} 条（已冻结、不阻断）。清偿后请执行 --update-baseline 收缩基线。`));
    }
    if (paidOff > 0) {
      console.log(okLine(`本次已清偿 ${paidOff} 条存量债务，建议执行 --update-baseline 收缩基线。`));
    }
    process.exitCode = 0;
    return;
  }

  if (flags.strict && totalBlocking === 0 && totalFrozen > 0) {
    console.log(`  ${paint(C.red + C.bold, `严格模式失败：存量债务 ${totalFrozen} 条尚未清偿`)}`);
    console.log(paint(C.dim, '  这是预期的：--strict 用于量化剩余债务，全部清偿后才应为绿。'));
    process.exitCode = 1;
    return;
  }

  console.log(`  ${paint(C.red + C.bold, `门禁失败：${effectiveBlocking} 条违规必须修复`)}`);
  console.log(paint(C.dim, '  合法例外请在违规行上一行显式写：// gate-theme-allow: 理由'));
  process.exitCode = 1;
  return;
}

/* ---------------- 基线模式 ---------------- */
if (flags.updateBaseline) {
  const targets = SCAN_ROOTS.flatMap((root) => listSourceFiles(root));
  const all = [];
  for (const file of targets) {
    const ctx = readSource(file);
    for (const rule of RULES) all.push(...rule.check(file, ctx));
  }
  const payload = saveBaseline(all);
  const total = Object.values(payload.entries).reduce((a, b) => a + b, 0);
  console.log(okLine(`债务基线已刷新：${total} 条存量违规已冻结（${Object.keys(payload.entries).length} 个指纹）`));
  console.log(warnLine('该操作会吸收当前所有违规，仅可在人工确认「当前违规均为存量债务」后执行。'));
  process.exitCode = 0;
} else {
  run();
}
