import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseTapFailures } from '../gates/census-check.mjs';

/**
 * 用真实 node:test 进程产出真实失败 TAP，验证失败提取器。
 *
 * 【设计意图 (Why)】
 *   前一版测试用的是手写 TAP 样本。手写样本永远"符合预期"，
 *   而真实 node:test 的 TAP 形态会随版本变化（父级用 `# Subtest:` 而非 `ok`）。
 *   只有让 node --test 真的跑一个会失败的测试文件，才能证明解析器对真实输出有效。
 *
 * 【防范的历史坑 (Pitfall)】
 *   上一版实现只跟 `ok` 行收集父级，实测真实输出里父级是 `# Subtest: outer`，
 *   于是失败名退化成 `inner case`，父级上下文整个丢失——而手写样本恰好
 *   写了 `ok` 风格的父级，把 bug 完全掩盖了。
 *
 * 【约束与规则 (Rules)】
 *   真实子进程测试；临时文件在 after 钩子清理。
 */

let tmpDir = null;

test.after(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runRealFailingTest() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-tap-'));
  const file = path.join(tmpDir, 'sample.test.mjs');
  fs.writeFileSync(file, `
import test from 'node:test';
import assert from 'node:assert/strict';

test('outer suite', async (t) => {
  await t.test('inner case', () => {
    assert.equal(3, 4, 'deliberate failure');
  });
});
`);
  const env = { ...process.env, FORCE_COLOR: '0' };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], {
    encoding: 'utf8',
    timeout: 60000,
    env,
  });
  return `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
}

test('真实失败的 TAP 必须被提取出用例名与断言原因', () => {
  const out = runRealFailingTest();
  const failures = parseTapFailures(out);

  assert.ok(failures.length >= 1, `必须提取到失败用例，实际输出片段：\n${out.slice(0, 800)}`);

  const blob = failures.map((f) => `${f.name}\n${f.details.join('\n')}`).join('\n---\n');
  assert.match(blob, /inner case/, '必须包含失败用例名');
  assert.match(blob, /outer suite/, '必须包含父级用例名（层级不能丢）');
  assert.match(blob, /3|4/, '必须带出断言涉及的期望/实际值');
});
