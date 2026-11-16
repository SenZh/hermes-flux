import test from 'node:test';
import assert from 'node:assert/strict';

import { testIntegrityRules } from '../gates/rules/maintainability.mjs';
import { stripComments } from '../gates/lib/scanner.mjs';

/**
 * `test-integrity/timezone-dependent` 规则的单元测试
 *
 * 【设计意图 (Why)】
 *   实测事故：`bot-primary-station-isolation.test.mjs` 用 `getHours()` 格式化
 *   一个 UTC 语义的绝对时间戳，本地（UTC+8）得到 `昨天 22:49` 通过，
 *   GitHub 的 UTC runner 得到 `昨天 14:49` 稳定失败。报错看起来像业务逻辑坏了，
 *   实际是测试把「跑测试的机器是哪个时区」当成了隐含前提。
 *
 * 【约束与规则 (Rules)】
 *   规则必须双向成立：坏样本命中、好样本放行。
 *   只断言"会报"的规则会误伤生产代码里的合法本地时间展示，
 *   只断言"不报"的规则则等于没有规则——两者都必须有用例。
 */

const scan = (file, src) => testIntegrityRules.check(file, { ...stripComments(src), warnings: [] });

const TEST_FILE = 'packages/desktop/__tests__/x.test.mjs';

test('测试文件用 getHours() 必须被拦', () => {
  const hits = scan(TEST_FILE, 'const h = d.getHours();\n');
  assert.equal(hits.length, 1, '必须命中 1 条');
  assert.equal(hits[0].ruleId, 'test-integrity/timezone-dependent');
});

test('测试文件用 toLocaleString() 必须被拦', () => {
  const hits = scan(TEST_FILE, "const s = d.toLocaleString('zh-CN');\n");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].ruleId, 'test-integrity/timezone-dependent');
});

test('getUTCHours() 等 UTC 取值必须放行', () => {
  assert.deepEqual(scan(TEST_FILE, 'const h = d.getUTCHours();\n'), []);
  assert.deepEqual(scan(TEST_FILE, 'const m = d.getUTCMinutes();\n'), []);
});

test('生产代码用本地时区属于合法展示行为，不得误伤', () => {
  assert.deepEqual(
    scan('packages/ui/src/components/Time.ts', 'const h = d.getHours();\n'),
    [],
    '生产代码展示本地时间是正确行为，规则只应约束测试断言',
  );
});

test('显式豁免注释必须被尊重', () => {
  const hits = scan(
    TEST_FILE,
    '// gate-tz-allow: 断言对象本身就是本地时区展示\nconst h = d.getHours();\n',
  );
  assert.deepEqual(hits, []);
});

test('非测试文件里的 toLocaleString 不得被拦', () => {
  assert.deepEqual(scan('scripts/gates/run.mjs', 'const s = new Date().toLocaleString();\n'), []);
});
