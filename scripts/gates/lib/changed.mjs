/**
 * 门禁变更集识别（changed-set resolution）
 *
 * 设计意图 (Why):
 *   CI 与 pre-commit 执行门禁时不能全量扫描（噪声大、噪音会掩盖新增违规），
 *   必须能精确算出「本次改动触及的文件集合」，再叠加「债务棘轮」只拦新增违规。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 未跟踪文件（git ls-files --others）如果漏掉，新建的违规文件可以直接绕过门禁。
 *   2. Windows 下 git 输出为 `\` 分隔且相对仓库根，必须统一 POSIX 化，否则与 baseline 键不匹配。
 *   3. 在无 git 环境（CI 归档包 / shard 检出）执行时必须优雅降级到全量扫描，而不是崩掉。
 *
 * 约束与规则 (Rules):
 *   - 只做只读 git 查询，绝不执行任何写操作。
 *   - 返回的路径一定存在于磁盘（已过滤删除文件），调用方无需再判断。
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, toRel } from './scanner.mjs';

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** 是否存在可用的 git 工作区 */
export function hasGit() {
  return git(['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';
}

/** 解析 git 输出为仓库相对 POSIX 路径数组，并过滤已删除文件 */
function normalize(output) {
  if (!output) return [];
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((p) => p.split(path.sep).join('/'))
    .filter((rel) => fs.existsSync(path.join(REPO_ROOT, rel)));
}

/**
 * 计算本次改动集合。
 * @param {{stagedOnly?: boolean}} [opts] stagedOnly=true 时仅取暂存区（pre-commit 语义）
 * @returns {string[]} 仓库相对路径
 */
export function changedFiles(opts = {}) {
  if (!hasGit()) return [];

  const sets = [];
  if (opts.stagedOnly) {
    sets.push(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']));
  } else {
    sets.push(git(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']));
    sets.push(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']));
    sets.push(git(['ls-files', '--others', '--exclude-standard']));
  }

  const merged = new Set();
  for (const set of sets) {
    for (const rel of normalize(set)) merged.add(rel);
  }
  return [...merged].sort();
}

/**
 * 判断是否为「样式/视觉相关」改动。
 *
 * 用途：驱动「样式改动后必须子 Agent review」的强制门禁。
 * 判定不能只看扩展名 —— 本项目 UI 是 TS 模板字符串直出 HTML/CSS，
 * 所以组件 .ts、token 定义、以及渲染层都算样式面。
 *
 * @param {string} rel 仓库相对路径
 */
export function isStyleSurface(rel) {
  const posix = rel.split(path.sep).join('/');
  if (posix.endsWith('.css') || posix.endsWith('.scss') || posix.endsWith('.less')) return true;
  if (posix.includes('packages/ui/src/tokens/')) return true;
  if (posix.includes('packages/ui/src/components/')) return true;
  // 渲染层直接拼装 HTML/CSS，视觉回归同样落在它身上
  if (posix.includes('packages/desktop/src/renderer/')) return true;
  return false;
}

/** 判断是否为「需要按工程规则审查」的代码改动 */
export function isCodeSurface(rel) {
  const posix = rel.split(path.sep).join('/');
  if (posix.startsWith('docs/')) return false;
  if (posix.startsWith('.opencode/')) return false;
  if (posix.endsWith('.md')) return false;
  if (posix.endsWith('.json') && !posix.includes('package')) return false;
  return /\.(ts|tsx|mjs|cjs|js|css|scss|less)$/.test(posix);
}

export { toRel };
