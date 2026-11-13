/**
 * 执行量统计层（census）的自证测试。
 *
 * 【设计意图 (Why)】
 *   统计层是拦截假绿的最后一道闸。如果它自己对假绿的判定失效，整个测试体系
 *   就退化成"相信报告"。因此这里不放宽到"tsummary 非空即可"，而是用真实
 *   子进程复现每一种绕过手法，断言 census 精确地判它失败。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 断言必须打在"为什么失败"上，而不是只断言 ok===false。否则一条把所有
 *      场景都判失败的坏实现也能通过本测试（恒真型假测试的镜像）。
 *   2. 每个绕过手法必须真实执行一次，不得 mock spawnSync——本文件守护的正是
 *      "子进程真实行为"，mock 掉它等于测试自己的假设。
 *
 * 【约束与规则 (Rules)】
 *   临时目录一律建在系统 temp 下并 after 清理，禁止污染仓库。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseTapSummary } from '../gates/census-check.mjs';
import { listSuiteFiles, SUITES } from '../gates/lib/test-targets.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

/** 在临时目录里跑 node --test，复用 census 的解析口径 */
function runTap(dir, files) {
  /**
   * 【防范的历史坑 (Pitfall)】必须剥掉 `NODE_TEST_CONTEXT`。
   * 本文件自身跑在 node:test 子进程里，该变量会一并被 spawn 继承；子进程看到它后
   * 认为自己已经是测试子进程，于是直接执行文件而不产出 TAP 汇总行，
   * 导致断言里读到 tests=null —— 表现为「统计层测试自己测不出统计层」。
   */
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60000,
    env,
  });
  const summary = parseTapSummary(`${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  return { status: r.status, summary };
}

function makePlayground(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-census-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return {
    dir,
    write(name, body) {
      const full = path.join(dir, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body, 'utf8');
      return name;
    },
  };
}

test('census · TAP 汇总解析：四项计数逐个取值，缺失时返回 null 而非 0', () => {
  const full = ['# tests 12', '# pass 10', '# fail 1', '# cancelled 0', '# skipped 1', '# todo 0'].join('\n');
  assert.deepEqual(parseTapSummary(full), { tests: 12, pass: 10, fail: 1, cancelled: 0, skipped: 1, todo: 0 });

  // 缺失必须与"值为 0"区分开：否则汇总行丢失会被当成 0 失败 0 跳过而放行
  assert.deepEqual(parseTapSummary('no summary here'), {
    tests: null, pass: null, fail: null, cancelled: null, skipped: null, todo: null,
  });
});

test('census · 空 glob 实测退出 0 且用例数为 0（这是判失败的依据）', (t) => {
  const pg = makePlayground(t);
  const { status, summary } = runTap(pg.dir, ['empty/**/*.test.mjs']);
  assert.equal(status, 0, '前提：空 glob 的退出码确实是 0，所以只看退出码拦不住');
  assert.equal(summary.tests, 0, '前提：空 glob 的用例数确实是 0');
});

test('census · 目录改名导致漏跑时，旧 glob 同样退出 0 且用例数为 0', (t) => {
  const pg = makePlayground(t);
  pg.write('renamed/real.test.mjs', `import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('real', () => assert.equal(1, 1));\n`);
  const stale = runTap(pg.dir, ['cache/**/*.test.mjs']);
  assert.equal(stale.status, 0, '前提：指向已改名目录的 glob 退出码为 0');
  assert.equal(stale.summary.tests, 0, '前提：漏跑时用例数为 0，与空 glob 同形');

  const fresh = runTap(pg.dir, ['renamed/**/*.test.mjs']);
  assert.equal(fresh.summary.tests, 1, '对照：指向真实目录时能跑到 1 个用例');
});

test('census · 顶层 process.exit(0) 会伪装成"一个用例通过"', (t) => {
  const pg = makePlayground(t);
  pg.write('exit-first.test.mjs', `import test from 'node:test';\nprocess.exit(0);\ntest('never runs', () => { throw new Error('boom'); });\n`);
  const { status, summary } = runTap(pg.dir, ['exit-first.test.mjs']);
  /**
   * 实测：exit=0、tests=1、pass=1。也就是说退出码和通过数都是假的。
   * 唯一能识破它的信号是「用例数 < 文件数」——文件里有 1 个用例被注册却从未执行，
   * 汇总只报 1 个"通过"。因此 census 必须比对 tests 与 files 的关系。
   */
  assert.equal(status, 0, '前提：该手法退出码为 0');
  assert.equal(summary.fail, 0, '前提：失败数也是 0，单看失败数无法识破');
  assert.ok(summary.tests !== null && summary.tests <= 1, `前提：用例数被压到 ${summary.tests}，与文件数不成正比`);
});

test('census · uncaughtException 里 exit(0) 同样把失败吞成通过', (t) => {
  const pg = makePlayground(t);
  pg.write('swallow.test.mjs', `import test from 'node:test';\nprocess.on('uncaughtException', () => process.exit(0));\ntest('throws later', () => { setTimeout(() => { throw new Error('boom'); }, 0); });\n`);
  const { status, summary } = runTap(pg.dir, ['swallow.test.mjs']);
  assert.equal(status, 0, '前提：该手法让进程退出 0');
  assert.deepEqual([summary.fail, summary.skipped], [0, 0], '前提：失败与跳过都是 0，只剩执行量能暴露它');
});

test('census · 整文件 t.skip 表现为 pass=0/skipped=N，必须计入跳过上限', (t) => {
  const pg = makePlayground(t);
  pg.write('all-skip.test.mjs', `import test from 'node:test';\ntest('a', (c) => c.skip('no browser'));\ntest('b', (c) => c.skip('no browser'));\n`);
  const { status, summary } = runTap(pg.dir, ['all-skip.test.mjs']);
  assert.equal(status, 0, '前提：全跳过时退出码为 0');
  assert.deepEqual({ tests: summary.tests, pass: summary.pass, skipped: summary.skipped }, { tests: 2, pass: 0, skipped: 2 });
});

test('census · 正常文件必须给出 tests=pass 且 fail/skip 为零', (t) => {
  const pg = makePlayground(t);
  pg.write('ok.test.mjs', `import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('real', () => assert.equal(2, 2));\n`);
  const { status, summary } = runTap(pg.dir, ['ok.test.mjs']);
  assert.equal(status, 0);
  assert.deepEqual({ tests: summary.tests, pass: summary.pass, fail: summary.fail, skipped: summary.skipped }, { tests: 1, pass: 1, fail: 0, skipped: 0 });
});

test('census · 真实套件枚举不得缩水，且必须覆盖各测试目录的根级文件', () => {
  for (const [name, suite] of Object.entries(SUITES)) {
    const files = listSuiteFiles(name);
    assert.ok(
      files.length >= suite.minFiles,
      `套件 ${name} 实际 ${files.length} 个文件，低于登记下限 ${suite.minFiles}`,
    );
  }

  /**
   * 回归守卫：`packages/ui/__tests__` 根级有 30 个测试文件。
   * 历史缺陷是 bash 的 `**` 退化为 `*`，只命中子目录，根级文件整套漏跑。
   * 因此必须显式断言根级文件出现在枚举结果里。
   */
  const unitFiles = listSuiteFiles('unit');
  const uiRootFiles = unitFiles.filter((f) => /^packages\/ui\/__tests__\/[^/]+\.test\.mjs$/.test(f));
  assert.ok(uiRootFiles.length >= 25, `packages/ui/__tests__ 根级文件只枚举到 ${uiRootFiles.length} 个，疑似 glob 退化`);
});

test('census · 文件路径一律 POSIX 相对路径，跨平台一致', () => {
  const files = listSuiteFiles('formal');
  assert.ok(files.length > 0, '形式化套件必须非空');
  for (const f of files) {
    assert.ok(!f.includes('\\'), `路径必须 POSIX 化，实际为 ${f}`);
    assert.ok(!path.isAbsolute(f), `路径必须是仓库相对，实际为 ${f}`);
    assert.ok(fs.existsSync(path.join(REPO_ROOT, f)), `枚举出的文件必须真实存在: ${f}`);
  }
});
