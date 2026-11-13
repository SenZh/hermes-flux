#!/usr/bin/env node
/**
 * 测试目标枚举自检（CI 前置，不执行测试）。
 *
 * 设计意图 (Why):
 *   在跑任何测试之前先证明「该跑的文件都被枚举到了」。把这一步与真正的执行
 *   分开，是因为两类失败的定位成本差一个量级：枚举少了是 glob 写错或目录改了，
 *   跑失败了是代码有问题。混在一起时，前者会伪装成后者。
 *
 * 防范的历史坑 (Pitfall):
 *   bash 默认关闭 globstar 时 `**` 退化为 `*`，只能命中一层子目录。
 *   本项目 `packages/ui/__tests__` 有 30 个根级测试文件，在 ubuntu runner 上
 *   曾整套静默不跑而退出码仍为 0。因此这里显式断言根级文件数。
 *
 * 约束与规则 (Rules):
 *   只读枚举，不执行测试，不产生产物。
 */
import { listSuiteFiles, SUITES, REPO_ROOT } from './lib/test-targets.mjs';import fs from 'node:fs';
import path from 'node:path';

let failed = 0;

for (const [name, suite] of Object.entries(SUITES)) {
  const files = listSuiteFiles(name);
  const problems = [];

  if (files.length < suite.minFiles) {
    problems.push(`枚举到 ${files.length} 个文件，低于登记下限 ${suite.minFiles}`);
  }

  /**
   * 根级文件回归守卫：这是 glob 退化的最直接症状。
   * 只在 unit 套件上断言，因为只有它含 `packages/ui/__tests__` 这种大根级目录。
   */
  if (name === 'unit') {
    const uiRoot = files.filter((f) => /^packages\/ui\/__tests__\/[^/]+\.test\.mjs$/.test(f));
    if (uiRoot.length < 25) {
      problems.push(`packages/ui/__tests__ 根级只枚举到 ${uiRoot.length} 个文件（应 >= 25，疑似 globstar 退化）`);
    }
  }

  /** 枚举出的文件必须真实存在，防止把已删除路径算进下限 */
  const missing = files.filter((f) => !fs.existsSync(path.join(REPO_ROOT, f)));
  if (missing.length > 0) {
    problems.push(`枚举结果含 ${missing.length} 个不存在的文件: ${missing.slice(0, 3).join(', ')}`);
  }

  if (problems.length > 0) {
    failed += 1;
    console.error(`✘ [${suite.label}] ${files.length} 个文件`);
    for (const p of problems) console.error(`   · ${p}`);
  } else {
    console.log(`✔ [${suite.label}] ${files.length} 个文件（下限 ${suite.minFiles}）`);
  }
}

if (failed > 0) {
  console.error('\n测试目标枚举自检失败：这不是测试失败，而是「目标集合本身不完整」。');
  process.exitCode = 1;
} else {
  console.log('\n✔ 测试目标枚举自检通过');
  process.exitCode = 0;
}
