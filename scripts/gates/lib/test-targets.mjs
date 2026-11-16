/**
 * 测试目标清单（单一真值源）。
 *
 * 设计意图 (Why):
 *   `npm test`、`verify:formal`、执行量统计层与 CI 必须枚举同一批文件。
 *   若各自写一份 glob，就会出现「本地跑 156 个、CI 跑 126 个、统计层按第三份
 *   口径断言」的分裂，而这正是历史漏跑的成因。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 脚本里写裸 glob（`packages/ui/__tests__/**\/*.test.mjs`）时，不带引号会被
 *      shell 展开。bash 默认关闭 globstar，`**` 退化成 `*`，只能命中一层子目录，
 *      于是 `packages/ui/__tests__` 根级 30 个文件在 ubuntu 上静默不跑。
 *      本模块用 Node 自己枚举文件，彻底绕开 shell 的 glob 语义差异。
 *   2. 目录改名后旧 glob 命中 0 个文件，`node --test` 仍退出 0。因此枚举结果
 *      必须交给 census 与声明下限比对，而不是"没报错就算过"。
 *
 * 约束与规则 (Rules):
 *   - 只做文件枚举，不执行任何测试，不产生副作用。
 *   - 返回 POSIX 风格仓库相对路径，跨平台一致。
 *   - 新增测试目录必须登记到 SUITES，禁止在脚本里另写 glob。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录（scripts/gates/lib -> repo root 共 3 层） */
export const REPO_ROOT = path.resolve(HERE, '../../..');

/**
 * 测试套件登记表。
 *
 * `roots` 为要递归枚举的目录；`pattern` 为文件名判定；
 * `minFiles` 是文件数下限，用于拦截「目录改名导致静默漏跑」。
 * 下限只允许调高，调低必须在提交信息里给出理由。
 */
export const SUITES = {
  unit: {
    label: '单元与集成测试',
    roots: [
      'packages/core/__tests__',
      'packages/ui/__tests__',
      'packages/desktop/__tests__/unit',
      'scripts/__tests__',
    ],
    pattern: /\.test\.mjs$/,
    excludeDirs: ['formal'],
    // 实测 149 个（core 60 + ui 40 + desktop/unit 44 + scripts 5），用例 1922。
    // 下限只允许调高：删测试或目录改名会让枚举变少，本层随即失败。
    minFiles: 149,
  },
  formal: {
    label: '形式化不变量',
    roots: ['packages/core/__tests__/formal'],
    pattern: /\.test\.mjs$/,
    excludeDirs: [],
    minFiles: 10,
  },
};

/** 递归枚举目录，返回仓库相对 POSIX 路径（已排序，保证跨平台稳定） */
export function listTestFiles(root, opts = {}) {
  const absRoot = path.join(REPO_ROOT, root);
  const pattern = opts.pattern ?? /\.test\.mjs$/;
  const excludeDirs = new Set(opts.excludeDirs ?? []);
  const out = [];
  if (!fs.existsSync(absRoot)) return out;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || excludeDirs.has(entry.name)) continue;
        walk(abs);
        continue;
      }
      if (!entry.isFile() || !pattern.test(entry.name)) continue;
      out.push(path.relative(REPO_ROOT, abs).split(path.sep).join('/'));
    }
  };
  walk(absRoot);
  return out.sort();
}

/** 按套件名枚举，返回去重后的文件清单 */
export function listSuiteFiles(suiteName) {
  const suite = SUITES[suiteName];
  if (!suite) throw new Error(`未登记的测试套件: ${suiteName}`);
  const set = new Set();
  for (const root of suite.roots) {
    for (const file of listTestFiles(root, { pattern: suite.pattern, excludeDirs: suite.excludeDirs })) {
      set.add(file);
    }
  }
  return [...set].sort();
}
