import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SELF_PROOF_SAMPLES,
  auditWorkflow,
  findBashOnlySyntax,
  findMaskedCommands,
  parseSteps,
} from '../gates/verify-ci-workflow.mjs';

/**
 * CI workflow 可移植性探针的单元测试
 *
 * 【设计意图 (Why)】
 *   探针自身的价值在于「修复前三类真实缺陷都能被捕获，而合法写法不被误报」。
 *   本测试用修复前的真实 workflow 片段作为回归夹具，确保这三类缺陷不会再次溜进 CI：
 *   P-01 构建前 require 产物、P-02 bash 专有语法进 pwsh、P-03 多行 run 命令掩盖。
 *
 * 【防范的历史坑 (Pitfall)】
 *   前一版解析器把 step 缩进算错，解析出 0 个 step；若测试只断言
 *   「auditWorkflow 返回 failures 数组」，这个 bug 会完全隐形。
 *   因此每个用例都必须同时断言「解析出的 step 数量」与「命中的规则 id」。
 *
 * 【约束与规则 (Rules)】
 *   断言落在结构字段（steps 数、rule id、step 名）上，不断言中文文案，
 *   避免措辞调整导致假红；坏样本与好样本必须成对出现。
 */

const WORKFLOW_OK = `name: CI
jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install
        run: npm ci --ignore-scripts
      - name: Build
        run: npm run build
      - name: Smoke
        run: node -e "require.resolve('@hermes-flux/core')"
`;

test('解析器必须真正切出 step，而不是返回空数组', () => {
  const steps = parseSteps(WORKFLOW_OK);
  assert.equal(steps.length, 4, `应解析出 4 个 step，实际 ${steps.length}`);
  assert.deepEqual(
    steps.map((s) => s.name),
    ['', 'Install', 'Build', 'Smoke'],
    '每个 step 的名称必须被正确抽取',
  );
  assert.equal(steps[0].uses, 'actions/checkout@v4', 'uses 字段必须被抽取');
  assert.equal(steps[1].run, 'npm ci --ignore-scripts', '单行 run 必须被抽取');
});

test('作业归属必须正确：步骤要落回它所在的 job', () => {
  const steps = parseSteps(WORKFLOW_OK);
  assert.ok(steps.every((s) => s.job === 'gates'), '全部 step 都应归属 job=gates');
});

test('构建之后 require 产物属于合法写法，不得误报', () => {
  const { failures, steps } = auditWorkflow(WORKFLOW_OK);
  assert.equal(steps, 4);
  assert.deepEqual(failures, [], `合法 workflow 不得报错，实际：${JSON.stringify(failures)}`);
});

test('P-01：构建前 require workspace 产物必须被捕获', () => {
  const bad = `jobs:
  gates:
    steps:
      - name: links
        run: node -e "require.resolve('@hermes-flux/core')"
      - name: Build
        run: npm run build
`;
  const { failures } = auditWorkflow(bad);
  const hit = failures.find((f) => f.rule === 'ci/no-prebuild-artifact-read');
  assert.ok(hit, `必须命中 ci/no-prebuild-artifact-read，实际：${JSON.stringify(failures)}`);
  assert.equal(hit.step, 'links');
});

test('P-02：bash 专有语法在多行 run 中必须被捕获', () => {
  const bad = `jobs:
  gates:
    steps:
      - name: links
        run: |
          for p in core ui; do
            test -d "node_modules/@hermes-flux/$p" || exit 1
          done
`;
  const { failures } = auditWorkflow(bad);
  const hit = failures.find((f) => f.rule === 'ci/no-bash-only-syntax');
  assert.ok(hit, `必须命中 ci/no-bash-only-syntax，实际：${JSON.stringify(failures)}`);
});

test('P-02 反向：显式 shell: bash 的 step 不构成缺陷', () => {
  const ok = `jobs:
  gates:
    steps:
      - name: links
        shell: bash
        run: |
          for p in core ui; do
            test -d "node_modules/@hermes-flux/$p" || exit 1
          done
`;
  const step = parseSteps(ok)[0];
  assert.deepEqual(findBashOnlySyntax(step), [], '显式 bash 时不得报 bash 语法');
});

test('P-03：多行 run 连写多条命令必须被捕获', () => {
  const bad = `jobs:
  gates:
    steps:
      - name: contract
        run: |
          npm run contract:verify
          npm run contract:coverage
`;
  const { failures } = auditWorkflow(bad);
  const hit = failures.find((f) => f.rule === 'ci/no-masked-command');
  assert.ok(hit, `必须命中 ci/no-masked-command，实际：${JSON.stringify(failures)}`);
  assert.match(hit.detail, /2/, '原因必须给出连写的命令条数');
});

test('P-03 反向：拆成独立 step 后不得报错', () => {
  const ok = `jobs:
  gates:
    steps:
      - name: a
        run: npm run contract:verify
      - name: b
        run: npm run contract:coverage
`;
  const { failures } = auditWorkflow(ok);
  assert.deepEqual(failures, []);
});

test('P-03 反向：bash + set -e 的多行 run 合法', () => {
  const ok = `jobs:
  gates:
    steps:
      - name: a
        shell: bash
        run: |
          set -e
          npm run contract:verify
          npm run contract:coverage
`;
  assert.deepEqual(auditWorkflow(ok).failures, [], 'bash + set -e 时前一条失败会中止，不应报掩盖');
  assert.deepEqual(findMaskedCommands(parseSteps(ok)[0]), []);
});

test('注释中的 bash 关键字不得引发误报', () => {
  const ok = `jobs:
  gates:
    steps:
      - name: a
        run: |
          # 历史坑：曾写 for p in a b; do ... done
          npm run build
`;
  const { failures } = auditWorkflow(ok);
  assert.deepEqual(failures, [], '注释里的 bash 片段不是可执行代码，不得计入');
});

test('规则自证样本必须齐全且成对（坏样本命中 / 好样本放行）', () => {
  for (const [key, pair] of Object.entries(SELF_PROOF_SAMPLES)) {
    const badHit = auditWorkflow(pair.bad).failures.length > 0;
    const goodHit = auditWorkflow(pair.good).failures.length > 0;
    assert.equal(badHit, true, `${key}.bad 必须被规则命中`);
    assert.equal(goodHit, false, `${key}.good 必须被规则放行`);
  }
});
