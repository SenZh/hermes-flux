import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTapFailures, parseTapSummary } from '../gates/census-check.mjs';

/**
 * 失败用例提取器的单元测试
 *
 * 【设计意图 (Why)】
 *   census 原先只报"失败 N 个用例"。在 CI 里这意味着排查者要下载整份日志、
 *   手工 grep 才能知道是哪个用例——考证成本极高，且容易误判成"偶发"。
 *   本测试用真实 node:test TAP 输出形态（含子测试层级、error/code/expected/actual）
 *   锁定解析结果，确保失败信息一次给全。
 *
 * 【约束与规则 (Rules)】
 *   断言落在 name 与 details 的关键片段上，不断言整段文案；
 *   解析不出时必须返回空数组而不是编造。
 */

const SAMPLE = `TAP version 13
# Subtest: outer suite
    # Subtest: inner case
    not ok 1 - inner case
      ---
      duration_ms: 1.2
      type: 'test'
      location: '/repo/x.test.mjs:10:3'
      failureType: 'testCodeFailure'
      error: 'expected 3 to equal 4'
      code: 'ERR_ASSERTION'
      expected: 4
      actual: 3
      ...
    1..1
not ok 1 - outer suite
  ---
  duration_ms: 5
  type: 'test'
  ...
1..1
# tests 1
# pass 0
# fail 1
# skipped 0
`;

test('汇总行计数必须被正确解析', () => {
  const s = parseTapSummary(SAMPLE);
  assert.equal(s.tests, 1);
  assert.equal(s.fail, 1);
  assert.equal(s.pass, 0);
});

test('失败用例必须给出完整层级名字', () => {
  const failures = parseTapFailures(SAMPLE);
  assert.ok(failures.length >= 1, '必须至少提取一条失败');
  assert.match(failures[0].name, /outer suite/, '名字必须包含父级');
  assert.match(failures[0].name, /inner case/, '名字必须包含子级');
});

test('失败用例必须带出断言原因，而不是只有名字', () => {
  const [first] = parseTapFailures(SAMPLE);
  const blob = first.details.join('\n');
  assert.match(blob, /expected 3 to equal 4/, '必须带出 error 字段');
  assert.match(blob, /ERR_ASSERTION/, '必须带出 error code');
});

test('全部通过时不得编造失败', () => {
  const passOnly = `TAP version 13
ok 1 - fine
1..1
# tests 1
# pass 1
# fail 0
`;
  assert.deepEqual(parseTapFailures(passOnly), []);
});

test('limit 必须生效，避免大量失败刷屏', () => {
  const many = Array.from({ length: 30 }, (_, i) => `not ok ${i + 1} - case ${i}`).join('\n');
  assert.equal(parseTapFailures(many, 5).length, 5);
});
