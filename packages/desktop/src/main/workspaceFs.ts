/**
 * 桌面端主进程安全工作区目录读取模块 (packages/desktop/src/main/workspaceFs.ts)
 *
 * 【设计意图 (Why)】
 *   为右侧工具窗的文件树浏览器提供单层、确定性、低开销的物理目录列举能力，
 *   并与 `ipc.ts` 解耦，使得所有路径边界安全校验可在纯 Node 单测环境下直接验证。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 禁止在初次打开文件树时递归扫描全盘或深入 `node_modules`（大型仓库会瞬时卡死主进程）；
 *   2. 严格拦截空字节注入、`..` 越界遍历与系统根目录直读，防范敏感目录泄露；
 *   3. 跨平台统一导出 POSIX `/` 分隔符路径，杜绝 Windows 反斜杠在 Core 树模型中分裂成重复节点。
 *
 * 【约束与规则 (Rules)】
 *   - 每次仅读取目标目录直接子项（O(当前目录条目数)），深层目录按用户点击懒加载；
 *   - 返回有序 `WorkspaceDirEntry[]`（目录优先，按名称码点升序）；不可访问或非法路径返回 `null`。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { WorkspaceDirEntry } from '@hermes-flux/core';

const IGNORED_NAMES = new Set(['.git', '.DS_Store', 'Thumbs.db']);

function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

function compareCodePoint(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function isInsideParent(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isSystemSensitiveRoot(resolved: string): boolean {
  const norm = toPosixPath(resolved).replace(/\/+$/, '');
  if (!norm || norm === '/' || /^[A-Za-z]:$/.test(norm)) return true;
  const lower = norm.toLowerCase();
  const unixLike = lower.replace(/^[a-z]:/, '');
  const unixForbidden = ['/etc', '/proc', '/sys', '/dev', '/root'];
  if (unixForbidden.some((prefix) => unixLike === prefix || unixLike.startsWith(`${prefix}/`))) {
    return true;
  }
  const winForbidden = ['c:/windows', 'c:/program files'];
  return winForbidden.some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`));
}

/**
 * 校验待列举目录是否合法且安全。
 */
export function isSafeWorkspaceDirectory(rawDir: string | undefined, fallbackCwd: string): string | null {
  const candidate = typeof rawDir === 'string' ? rawDir.trim() : '';
  if (candidate.includes('\0')) return null;

  const baseCwd = path.resolve(fallbackCwd || process.cwd());
  if (!candidate) {
    return isSystemSensitiveRoot(baseCwd) ? null : baseCwd;
  }

  const segments = candidate.replace(/\\/g, '/').split('/');
  if (segments.includes('..')) {
    const resolvedTraversal = path.resolve(baseCwd, candidate);
    if (!isInsideParent(baseCwd, resolvedTraversal)) {
      return null;
    }
    return isSystemSensitiveRoot(resolvedTraversal) ? null : resolvedTraversal;
  }

  const resolved = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(baseCwd, candidate);

  if (isSystemSensitiveRoot(resolved)) return null;
  return resolved;
}

/**
 * 读取指定工作区目录的直接子项（单层非递归，目录优先 + 确定性码点排序）。
 */
export function listWorkspaceDirectory(
  dirPath?: string,
  options?: { cwd?: string },
): WorkspaceDirEntry[] | null {
  const safeDir = isSafeWorkspaceDirectory(dirPath, options?.cwd ?? process.cwd());
  if (!safeDir) return null;

  try {
    if (!fs.existsSync(safeDir)) return null;
    const dirStat = fs.statSync(safeDir);
    if (!dirStat.isDirectory()) return null;

    const dirents = fs.readdirSync(safeDir, { withFileTypes: true });
    const entries: WorkspaceDirEntry[] = [];

    for (const dirent of dirents) {
      if (IGNORED_NAMES.has(dirent.name)) continue;

      const absChild = path.join(safeDir, dirent.name);
      let isDirectory = dirent.isDirectory();
      let size: number | undefined;

      if (dirent.isSymbolicLink()) {
        try {
          const linkStat = fs.statSync(absChild);
          isDirectory = linkStat.isDirectory();
          if (!isDirectory) size = linkStat.size;
        } catch (err) {
          console.warn('[workspaceFs] broken symlink skipped:', absChild, err);
          continue;
        }
      } else if (!isDirectory) {
        try {
          size = fs.statSync(absChild).size;
        } catch (err) {
          console.warn('[workspaceFs] stat file size failed:', absChild, err);
        }
      }

      entries.push({
        name: dirent.name,
        path: toPosixPath(absChild),
        isDirectory,
        ...(size !== undefined ? { size } : {}),
      });
    }

    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return compareCodePoint(a.name, b.name);
    });

    return entries;
  } catch (err) {
    console.warn('[workspaceFs] readdir failed:', safeDir, err);
    return null;
  }
}

function isEnvSecretSegment(segment: string): boolean {
  const lower = segment.trim().toLowerCase();
  return lower === '.env' || (lower.startsWith('.env.') && lower !== '.env.example');
}

/**
 * 校验本地待保存/直拷源文件路径：支持非 `process.cwd()` 的合法本地工作区目录，
 * 同时通过 `realpathSync` 阻止符号链接逃逸，并严格屏蔽系统敏感根目录及 `.env*` 机密文件。
 */
export function resolveSafeLocalSourceFile(
  rawSourcePath: string | undefined,
  fallbackCwd?: string,
): string | null {
  const candidate = typeof rawSourcePath === 'string' ? rawSourcePath.trim() : '';
  if (!candidate || candidate.includes('\0')) return null;

  const lexSegments = toPosixPath(candidate).split('/').filter(Boolean);
  if (lexSegments.some(isEnvSecretSegment)) return null;

  const safeParent = isSafeWorkspaceDirectory(path.dirname(candidate), fallbackCwd ?? process.cwd());
  if (!safeParent) return null;

  const candidateFile = path.join(safeParent, path.basename(candidate));
  try {
    if (!fs.existsSync(candidateFile)) return null;
    const real = fs.realpathSync(candidateFile);
    if (isSystemSensitiveRoot(real)) return null;
    const realSegments = toPosixPath(real).split('/').filter(Boolean);
    if (realSegments.some(isEnvSecretSegment)) return null;
    return fs.statSync(real).isFile() ? real : null;
  } catch (err) {
    console.warn('[workspaceFs] resolve source file failed:', candidateFile, err);
    return null;
  }
}
