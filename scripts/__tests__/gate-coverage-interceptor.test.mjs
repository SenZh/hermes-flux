import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

/**
 * 增量覆盖率拦截器自证与证伪测试 (Self-Proof / Mutation Verification)
 *
 * 【设计意图 (Why)】
 *   拦截器本身的价值在于「代码行未覆盖必拦截、分支未覆盖必拦截、100% 双全覆盖才放行」。
 *   若拦截器无法在真实反例下变红，它就是假门禁。
 *   本测试用真实产物与测试用例验证拦截器的三项核心性质：
 *     1. 新增代码行未被执行时，拦截器必须硬阻断（Line Coverage < 100%）；
 *     2. 新增代码行虽执行但分支未全路径覆盖时，拦截器必须硬阻断（Branch Coverage < 100%）；
 *     3. 跨平台可移植性，不产生未捕获异常。
 */

test('拦截器证伪实证 1：存在未覆盖行时必须阻断并报告未执行或未导入', () => {
  const r = spawnSync(
    process.execPath,
    [
      'scripts/verify/new-code-coverage.mjs',
      '--probe-files=packages/core/src/agent/agentPresence.ts',
      '--test-files=packages/core/__tests__/profile/botManagement.test.mjs',
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );

  // 必须退出非 0
  assert.equal(r.status, 1, '未覆盖代码时门禁必须退出 1');
  assert.match(
    r.stdout,
    /(Line Coverage < 100%|没有任何测试 import 它)/,
    '必须明确报告未执行行或未被测试引用',
  );
  assert.match(
    r.stdout,
    /✘ 增量覆盖不达标/,
    '必须明确输出增量覆盖不达标标识',
  );
});

test('拦截器证伪实证 2：代码行已执行但存在未覆盖条件分支时，必须精准报告 Branch Coverage < 100%', () => {
  const r = spawnSync(
    process.execPath,
    [
      'scripts/verify/new-code-coverage.mjs',
      '--probe-files=packages/core/src/agent/agentPresence.ts',
      '--test-files=packages/core/__tests__/agent/agentPresence.test.mjs',
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );

  assert.equal(r.status, 1, '分支未全覆盖时门禁必须退出 1');
  assert.match(
    r.stdout,
    /Branch Coverage < 100%/,
    '必须明确报告分支覆盖未达 100%',
  );
  // 第 277 行为三元运算符单侧未命中分支（steps.length > 0 ? steps : [1]）
  assert.match(
    r.stdout,
    /行：.*277/,
    '必须精准定位到未覆盖分支所在的源码行号 277',
  );
});

test('拦截器健壮性：基线比对与参数解析在无源码变动时安全退出 0', () => {
  const r = spawnSync(
    process.execPath,
    ['scripts/verify/new-code-coverage.mjs', '--base=HEAD'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );

  assert.equal(r.status, 0, '比对无变动基线时应正常放行退出 0');
  assert.match(
    r.stdout,
    /无需判定/,
    '无受控源码改动时应输出无需判定提示',
  );
});
