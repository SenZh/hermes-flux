#!/usr/bin/env node
/**
 * CI workflow 跨平台可移植性探针。
 *
 * 【设计意图 (Why)】
 *   本仓的 CI 跑 `ubuntu-latest + windows-latest` 矩阵，但 workflow 里的 shell
 *   语义差异不会在本地暴露：本地开发在 Windows 上用 PowerShell、在 CI 的 Windows
 *   上却是 pwsh，而 ubuntu 上是 bash。历史上已经出现过三次同类事故，
 *   都表现为「本地门禁全绿、CI 稳定红」，而红的原因与被测代码毫无关系：
 *
 *   P-01 `require.resolve('@hermes-flux/core')` 被写在 `npm run build` 之前。
 *        core 的 main 指向被 .gitignore 忽略的 dist/index.js，于是两个平台
 *        稳定 MODULE_NOT_FOUND——门禁自己造了一处假红。
 *   P-02 workflow 里内联 bash 的 `for p in ...; do ... done`。windows runner
 *        默认 shell 是 pwsh，同一段脚本直接 ParserError。
 *   P-03 多行 `run: |` 里连写多条命令。pwsh 的 step 结果取自**最后一条**原生命令
 *        的退出码，前面某条失败会被后面某条成功掩盖（实测：先 exit 1 再 exit 0，
 *        整步判定为成功）——这是假绿，比假红更危险。
 *
 * 【约束与规则 (Rules)】
 *   1. 只做静态解析与规则判定，不执行 workflow，不联网；
 *   2. 每条规则都必须同时给出「会命中的样本」与「不该命中的样本」，
 *      否则一个见谁都报的实现也能通过（与 gate-self-proof 同口径）；
 *   3. 判定只看结构（缩进块、shell 字段、命令序列），不对注释做模糊匹配，
 *      避免注释里出现 `for ... do` 就误报；
 *   4. 命中任何一条即非零退出，并逐条打印文件与行号。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

/**
 * bash 专有语法特征。出现即意味着该 step 在 pwsh 下会解析失败。
 * 刻意只收「bash 有、pwsh 没有」的构造，避免把两种 shell 都支持的写法误报。
 */
const BASH_ONLY_PATTERNS = [
  { re: /^\s*for\s+\w+\s+in\s+.*;\s*do\b/m, label: 'bash for ... in ...; do', hint: '改用 Node 脚本承载循环逻辑' },
  { re: /^\s*done\s*$/m, label: 'bash done', hint: '改用 Node 脚本承载循环逻辑' },
  { re: /^\s*(?:if|elif|while)\s+\[\[?[^\]]*\]\]?\s*;\s*then\b/m, label: 'bash if [[ ... ]]; then', hint: '改用 Node 脚本承载条件逻辑' },
  { re: /^\s*fi\s*$/m, label: 'bash fi', hint: '改用 Node 脚本承载条件逻辑' },
  { re: /\btest\s+-[defrsx]\s+/m, label: 'bash test -d/-f 等', hint: '改用 fs.existsSync 等 Node API' },
  { re: /\{\s*echo\s+"[^"]*"\s*;\s*exit\s+1\s*;\s*\}/m, label: 'bash { ...; exit 1; } 分组', hint: '改用 Node 脚本并以 process.exit(1) 退出' },
  { re: /^\s*export\s+[A-Z_][A-Z0-9_]*=/m, label: 'bash export VAR=', hint: '改用 step 级 env: 或 Node 脚本' },
];

const indentOf = (line) => line.length - line.trimStart().length;

/**
 * 解析 workflow 的 steps 结构。
 *
 * 实现方式是「按缩进定块」而非写完整 YAML 解析器：
 *   1. 找到 `steps:` 行，记下它的缩进；
 *   2. 其后所有「缩进更深且以 `- ` 开头」的行都是 step 条目起点，
 *      条目的缩进以第一条为准；
 *   3. 每个条目从其起点行到下一个同级条目之间的所有行都是它的正文；
 *   4. 正文里按「键: 值」抽取 name / run / shell / uses，`run: |` 的后续
 *      更深缩进行全部算作 run 内容。
 *
 * 【防范的历史坑 (Pitfall)】
 *   前一版把条目缩进判定写成 `indentOf(group + 'x') - 1 === stepsIndent`，
 *   在 `steps:` 缩进 4、条目缩进 6 的真实结构下算出 5 !== 4，
 *   于是解析出 0 个 step 并让规则自证失败——自证样本正是为此存在。
 *
 * @param {string} source workflow 文本
 * @returns {Array<{ job: string, name: string, run: string, shell: string|null, uses: string, startLine: number }>}
 */
export function parseSteps(source) {
  const lines = source.split(/\r?\n/);
  const steps = [];

  /** 每个 step 起点所在行号（0-based 索引） */
  const starts = [];
  let stepsIndent = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^\s*steps:\s*$/.test(line)) continue;
    stepsIndent = indentOf(line);

    // 收集该 steps: 块下的所有条目起点
    let itemIndent = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      const cur = lines[j];
      if (cur.trim() === '' || cur.trim().startsWith('#')) continue;
      const curIndent = indentOf(cur);
      // 回到 steps: 同级或更外层，块结束
      if (curIndent <= stepsIndent) break;
      const isItem = /^\s*-\s+\S/.test(cur) || /^\s*-\s*$/.test(cur);
      if (!isItem) continue;
      if (itemIndent === -1) itemIndent = curIndent;
      if (curIndent === itemIndent) starts.push(j);
    }
    break;
  }

  for (let s = 0; s < starts.length; s += 1) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : lines.length;
    const block = lines.slice(from, to).map((l) => (l === undefined ? '' : l));

    // job 归属：向上找最近的、缩进为 2 且形如 `name:` 的行
    let job = '';
    for (let k = from - 1; k >= 0; k -= 1) {
      const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[k]);
      if (m) { job = m[1]; break; }
    }

    const step = { job, name: '', run: '', shell: null, uses: '', startLine: from + 1 };

    // 第一段（`- key: value`）
    const head = block[0].replace(/^\s*-\s*/, '');
    const bodyLines = [head, ...block.slice(1)];

    for (let k = 0; k < bodyLines.length; k += 1) {
      const line = bodyLines[k];
      if (line.trim() === '' || line.trim().startsWith('#')) continue;
      const m = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (!m) continue;
      const key = m[2];
      const val = m[3].trim();

      if (key === 'run') {
        if (val === '|' || val === '>' || val.startsWith('|') || val.startsWith('>')) {
          const keyIndent = indentOf(line);
          const collected = [];
          for (let q = k + 1; q < bodyLines.length; q += 1) {
            const inner = bodyLines[q];
            if (inner.trim() === '') { collected.push(''); continue; }
            if (indentOf(inner) <= keyIndent) break;
            collected.push(inner);
          }
          step.run = collected.join('\n');
        } else {
          step.run = val;
        }
        continue;
      }
      if (key === 'name') { step.name = val; continue; }
      if (key === 'shell') { step.shell = val; continue; }
      if (key === 'uses') { step.uses = val; continue; }
    }

    steps.push(step);
  }

  return steps;
}

/**
 * 规则 1：run 内容里不得出现 bash 专有语法。
 *
 * 仅在 step 未显式指定 bash 时检查——显式 `shell: bash` 的 step 在 windows runner
 * 上也可以用 bash（GitHub 提供），那是合法写法，不构成缺陷。
 */
export function findBashOnlySyntax(step) {
  if (step.shell && /bash/.test(step.shell)) return [];
  const hits = [];
  for (const p of BASH_ONLY_PATTERNS) {
    if (p.re.test(step.run)) hits.push(p);
  }
  return hits;
}

/**
 * 规则 2：多行 run 里连写多条可失败命令时，前一条失败会被后一条成功掩盖。
 *
 * 判定：多行 run 中「可失败的原生命令」≥ 2 条。
 * 显式 `shell: bash` 且含 `set -e` 的 step 放行（bash 下失败即中止）。
 */
export function findMaskedCommands(step) {
  const lines = step.run
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const invocations = lines.filter(
    (l) => /^(npm|npx|node|tsc|git|gh)\s/.test(l) && !l.endsWith('\\') && !l.endsWith('&'),
  );
  if (invocations.length < 2) return [];
  const usesBashSetE = Boolean(step.shell && /bash/.test(step.shell)) && /^\s*set\s+-[a-z]*e/m.test(step.run);
  if (usesBashSetE) return [];
  return invocations;
}

/**
 * 规则 3：构建之前不得 require workspace 包的产物。
 *
 * 判据：run 中出现 `require.resolve('@hermes-flux/...')`，而该 step 位于首个构建 step 之前。
 */
export function findPreBuildArtifactRead(steps) {
  const buildIdx = steps.findIndex((s) => /npm\s+run\s+build|scripts\/build\.mjs/.test(s.run));
  const problems = [];
  steps.forEach((s, i) => {
    if (buildIdx !== -1 && i >= buildIdx) return;
    if (/require\.resolve\(\s*['"]@hermes-flux\//.test(s.run)) {
      problems.push({ step: s, pattern: 'require.resolve(@hermes-flux/*)', line: s.startLine });
    }
  });
  return problems;
}

/**
 * 对一份 workflow 源文本做全部规则判定。
 *
 * @param {string} source
 * @returns {{ failures: Array<{ rule: string, job: string, step: string, line: number, detail: string }>, steps: number }}
 */
export function auditWorkflow(source) {
  const steps = parseSteps(source);
  const failures = [];

  for (const step of steps) {
    const bashHits = findBashOnlySyntax(step);
    if (bashHits.length > 0) {
      failures.push({
        rule: 'ci/no-bash-only-syntax',
        job: step.job,
        step: step.name || '(unnamed)',
        line: step.startLine,
        detail: `bash 专有语法 ${bashHits.map((h) => h.label).join('、')}；${bashHits[0].hint}`,
      });
    }

    const masked = findMaskedCommands(step);
    if (masked.length > 0) {
      failures.push({
        rule: 'ci/no-masked-command',
        job: step.job,
        step: step.name || '(unnamed)',
        line: step.startLine,
        detail: `多行 run 连写 ${masked.length} 条命令（${masked.map((c) => c.split(/\s+/)[0]).join(', ')}）：前一条失败会被后一条成功掩盖，请拆成独立 step 或加 set -e（bash）`,
      });
    }
  }

  for (const p of findPreBuildArtifactRead(steps)) {
    failures.push({
      rule: 'ci/no-prebuild-artifact-read',
      job: p.step.job,
      step: p.step.name || '(unnamed)',
      line: p.line,
      detail: `${p.pattern} 在构建之前执行：dist/ 被 .gitignore 忽略，此判定必然失败且与被测代码无关`,
    });
  }

  return { failures, steps: steps.length };
}

/** 规则自证样本：每条规则都必须能命中「坏样本」且放行「好样本」 */
export const SELF_PROOF_SAMPLES = {
  bashOnly: {
    bad: 'jobs:\n  g:\n    steps:\n      - name: x\n        run: |\n          for p in a b; do\n            test -d "x/$p" || exit 1\n          done\n',
    good: 'jobs:\n  g:\n    steps:\n      - name: x\n        run: node scripts/gates/verify-workspace-links.mjs\n',
  },
  masked: {
    bad: 'jobs:\n  g:\n    steps:\n      - name: x\n        run: |\n          npm run a\n          npm run b\n',
    good: 'jobs:\n  g:\n    steps:\n      - name: x\n        run: npm run a\n      - name: y\n        run: npm run b\n',
  },
  prebuild: {
    bad: 'jobs:\n  g:\n    steps:\n      - name: link\n        run: node -e "require.resolve(\'@hermes-flux/core\')"\n      - name: build\n        run: npm run build\n',
    good: 'jobs:\n  g:\n    steps:\n      - name: build\n        run: npm run build\n      - name: smoke\n        run: node -e "require.resolve(\'@hermes-flux/core\')"\n',
  },
};

function main() {
  const workflowPath = path.join(REPO_ROOT, '.github/workflows/quality-gates.yml');
  if (!fs.existsSync(workflowPath)) {
    console.error(`✖ 未找到 workflow：${workflowPath}`);
    process.exit(1);
  }
  const source = fs.readFileSync(workflowPath, 'utf8');
  const { failures, steps } = auditWorkflow(source);

  // 规则自证：坏样本必须命中、好样本必须放行，否则规则本身不可信
  const selfProof = [];
  const check = (label, sample, expectHit) => {
    const { failures: f } = auditWorkflow(sample);
    const hit = f.length > 0;
    selfProof.push({ label, ok: hit === expectHit, detail: `命中=${hit} 期望=${expectHit}` });
  };
  check('bashOnly.bad', SELF_PROOF_SAMPLES.bashOnly.bad, true);
  check('bashOnly.good', SELF_PROOF_SAMPLES.bashOnly.good, false);
  check('masked.bad', SELF_PROOF_SAMPLES.masked.bad, true);
  check('masked.good', SELF_PROOF_SAMPLES.masked.good, false);
  check('prebuild.bad', SELF_PROOF_SAMPLES.prebuild.bad, true);
  check('prebuild.good', SELF_PROOF_SAMPLES.prebuild.good, false);

  const badProof = selfProof.filter((p) => !p.ok);
  if (badProof.length > 0) {
    console.error('✖ 规则自证失败——探针自身不可信：');
    for (const p of badProof) console.error(`  - ${p.label}: ${p.detail}`);
    process.exit(1);
  }

  if (failures.length > 0) {
    console.error(`✖ CI workflow 可移植性检查失败：${failures.length} 处（已解析 ${steps} 个 step）\n`);
    for (const f of failures) {
      console.error(`  [${f.rule}] .github/workflows/quality-gates.yml:${f.line}`);
      console.error(`    job=${f.job} step="${f.step}"`);
      console.error(`    ${f.detail}\n`);
    }
    process.exit(1);
  }

  console.log(`✓ CI workflow 可移植性检查通过（${steps} 个 step，规则自证 ${selfProof.length}/${selfProof.length}）`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
