/**
 * 门禁 freeze 路径回归守卫。
 * 为什么落在这个测试目录：npm test glob 只覆盖 packages/{core,ui,desktop}/__tests__，
 *   scripts/ 无测试挂点；本守卫测的是 scripts/gates/run.mjs 的 --update-baseline-dry 路径
 *   （二轮审查 P2：freeze 分支曾因 ctx 缺 warnings 崩溃且无守卫，属门禁工具自身缺陷）。
 * 断言：dry 模式退出 0、输出试算指纹数、且绝不改写 .baseline.json。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const BASELINE = path.join(ROOT, 'scripts/gates/.baseline.json');

test('gates --update-baseline-dry 零副作用退出 0', () => {
  const before = fs.readFileSync(BASELINE, 'utf8');
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/gates/run.mjs'), '--update-baseline-dry'], { encoding: 'utf8' });
  assert.match(out, /试算完成/);
  assert.match(out, /未写入基线/);
  const after = fs.readFileSync(BASELINE, 'utf8');
  assert.equal(after, before, 'dry 模式禁止触碰基线文件');
});
