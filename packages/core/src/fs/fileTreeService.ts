/**
 * 工作区文件树纯模型与四级解析服务 (packages/core/src/fs/fileTreeService.ts)
 *
 * 【设计意图 (Why)】
 *   提供跨 Desktop / Web / Mobile 共用的工作区目录树数据模型、确定性排序与过滤原语，
 *   并通过「本地 PAL 目录列举 -> 网关 HTTP 文件接口 -> 已签约 RPC complete.path -> 会话文件缓存」
 *   四级级联解析工作区目录，统一支撑右侧「文件树浏览 + 文件预览」一体工具窗。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. P-016: 严禁把 `projects.tree` 当作文件系统目录树（它只返回项目/仓库/会话节点）；
 *   2. P-001: 网关缺失接口常返回 200 OK + SPA Dashboard HTML，必须经 `isSpaFallbackHtml` 拦截丢弃；
 *   3. 排序严禁使用依赖系统 locale 的 `localeCompare()`，必须采用确定性码点全序比较。
 *
 * 【约束与规则 (Rules)】
 *   1. 零 DOM / React / Node fs 依赖，所有平台能力通过 `IPlatformBridge` 与回调注入；
 *   2. 失败不可静默：解析链全部失败时显式返回 `{ error }` 与日志告警，严禁伪造成功或静默吞错。
 */

import type { IPlatformBridge, WorkspaceDirEntry } from '../pal/IPlatformBridge.js';
import { isSpaFallbackHtml } from './fileService.js';

export type FileTreeSource = 'local_fs' | 'gateway_api' | 'gateway_rpc' | 'session_cache';

export interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  children?: FileTreeNode[];
  childrenLoaded?: boolean;
}

export type FileTreeLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; rootPath: string; nodes: FileTreeNode[]; source: FileTreeSource }
  | { status: 'error'; message: string };

export interface ResolveWorkspaceDirectoryOptions {
  platformBridge?: Pick<IPlatformBridge, 'listDirectory' | 'httpProxy'> | null;
  gatewayUrl?: string;
  profile?: string;
  completePath?: (dirPath: string) => Promise<readonly string[]>;
  fallbackPaths?: readonly string[];
  rootPathForFallback?: string;
}

export type ResolveWorkspaceDirectoryResult =
  | { nodes: FileTreeNode[]; rootPath: string; source: FileTreeSource }
  | { error: string };

/**
 * 判断网关地址是否指向本机回环（localhost / 127.0.0.1 / [::1]）。
 * 【设计意图 (Why)】当连接远程非回环网关且目标目录为空时，跳过本地 `listDirectory(undefined)`，
 *   防止将客户端本机工作区误当成远程网关默认目录呈现。
 */
export function isLoopbackGatewayUrl(rawUrl?: string): boolean {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return true;
  const hostMatch = /^(?:https?|wss?):\/\/(\[[^\]]+\]|[^/:?#]+)/i.exec(trimmed);
  const host = (hostMatch ? hostMatch[1] : trimmed.split(/[/:?#]/)[0]).toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function extractGatewayPayloadPath(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
  const p = (raw as Record<string, unknown>).path;
  return typeof p === 'string' ? normalizeWorkspacePath(p) : '';
}

const IGNORED_TREE_NAMES = new Set(['.', '..', '.git', '.DS_Store', 'Thumbs.db']);

function compareCodePoint(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * 统一规范化工作区路径分隔符为 `/`，并清理末尾多余斜杠（保留根 `/` 与盘符根 `C:/`）。
 */
export function normalizeWorkspacePath(rawPath: string): string {
  const replaced = String(rawPath || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!replaced) return '';
  if (replaced === '/' || /^[A-Za-z]:\/$/.test(replaced)) return replaced;
  return replaced.replace(/\/+$/, '');
}

/**
 * 拼接工作区父目录与子节点名称，产出确定性 POSIX 规范路径。
 */
export function joinWorkspacePath(parentDir: string, name: string): string {
  const cleanName = normalizeWorkspacePath(name).replace(/^\/+/, '');
  const normParent = normalizeWorkspacePath(parentDir);
  if (!normParent) return cleanName;
  if (!cleanName) return normParent;
  if (normParent === '/' || normParent.endsWith('/')) return `${normParent}${cleanName}`;
  return `${normParent}/${cleanName}`;
}

/**
 * 提取路径末段名称（用于节点显示与根节点标题展示）。
 */
export function extractPathBasename(rawPath: string): string {
  const norm = normalizeWorkspacePath(rawPath);
  if (!norm || norm === '/') return norm;
  const trimmed = /^[A-Za-z]:\/$/.test(norm) ? norm.slice(0, 2) : norm;
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/**
 * 判断节点名是否属于应自动跳过的系统噪音项（例如 `.git` 元数据目录）。
 */
export function isIgnoredTreeEntryName(name: string): boolean {
  return IGNORED_TREE_NAMES.has(name);
}

/**
 * 确定性文件树全序排序：目录严格优先于文件，同类按名称码点升序，不修改原数组。
 */
export function sortFileTreeNodes(nodes: readonly FileTreeNode[]): FileTreeNode[] {
  const copy = nodes.map((node): FileTreeNode =>
    node.children ? { ...node, children: sortFileTreeNodes(node.children) } : { ...node },
  );
  copy.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    const byName = compareCodePoint(a.name, b.name);
    if (byName !== 0) return byName;
    return compareCodePoint(a.path, b.path);
  });
  return copy;
}

/**
 * 将单层目录项列表转为规范化、去重且有序的 `FileTreeNode[]`。
 */
export function entriesToFileTreeNodes(entries: readonly WorkspaceDirEntry[]): FileTreeNode[] {
  const byPath = new Map<string, FileTreeNode>();
  for (const entry of entries) {
    const normPath = normalizeWorkspacePath(entry.path);
    const name = entry.name || extractPathBasename(normPath);
    if (!normPath || !name || isIgnoredTreeEntryName(name)) continue;
    const existing = byPath.get(normPath);
    if (existing) {
      if (entry.isDirectory && !existing.isDirectory) {
        byPath.set(normPath, {
          name,
          path: normPath,
          isDirectory: true,
          children: existing.children,
          childrenLoaded: false,
        });
      }
      continue;
    }
    byPath.set(normPath, {
      name,
      path: normPath,
      isDirectory: Boolean(entry.isDirectory),
      ...(typeof entry.size === 'number' ? { size: entry.size } : {}),
      ...(entry.isDirectory ? { childrenLoaded: false } : {}),
    });
  }
  return sortFileTreeNodes(Array.from(byPath.values()));
}

/**
 * 从一组扁平文件/目录路径构建去重且有序的层级文件树（用于补全结果与会话文件兜底）。
 */
export function buildTreeFromFlatPaths(
  rawPaths: readonly string[],
  rootPath = '',
): FileTreeNode[] {
  type BuilderNode =
    | { name: string; path: string; isDirectory: false }
    | { name: string; path: string; isDirectory: true; children: BuilderNode[]; childrenLoaded: true };

  const normRoot = normalizeWorkspacePath(rootPath);
  const roots: BuilderNode[] = [];

  for (const raw of rawPaths) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) continue;
    const isExplicitDir = trimmed.endsWith('/') || trimmed.endsWith('\\');
    const normItem = normalizeWorkspacePath(trimmed);
    if (!normItem || normItem === normRoot) continue;

    let rel = normItem;
    let basePrefix = normRoot;
    if (normRoot && normItem.startsWith(normRoot.endsWith('/') ? normRoot : `${normRoot}/`)) {
      rel = normItem.slice(normRoot.endsWith('/') ? normRoot.length : normRoot.length + 1);
    } else if (/^[A-Za-z]:\//.test(normItem) || normItem.startsWith('/')) {
      // 跨出当前根或无公共前缀的绝对路径，剥出相对段避免污染层深
      const m = /^([A-Za-z]:\/|\/)(.+)$/.exec(normItem);
      if (m) {
        basePrefix = m[1];
        rel = m[2];
      }
    }

    const segments = rel.split('/').filter(Boolean);
    if (segments.length === 0 || segments.some((s) => s === '.' || s === '..' || isIgnoredTreeEntryName(s))) {
      continue;
    }

    let cursorList = roots;
    let accumPath = basePrefix;
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      accumPath = joinWorkspacePath(accumPath, seg);
      const isLast = i === segments.length - 1;
      const shouldBeDir = !isLast || isExplicitDir;

      const existingIdx = cursorList.findIndex((n) => n.name === seg);
      let existing: BuilderNode | undefined = existingIdx >= 0 ? cursorList[existingIdx] : undefined;
      if (existing && !existing.isDirectory && shouldBeDir) {
        existing = {
          name: existing.name,
          path: existing.path,
          isDirectory: true,
          children: [],
          childrenLoaded: true,
        };
        cursorList[existingIdx] = existing;
      } else if (!existing) {
        existing = shouldBeDir
          ? { name: seg, path: accumPath, isDirectory: true, children: [], childrenLoaded: true }
          : { name: seg, path: accumPath, isDirectory: false };
        cursorList.push(existing);
      }
      if (existing.isDirectory) {
        cursorList = existing.children;
      }
    }
  }

  return sortFileTreeNodes(roots);
}

/**
 * 不可变地将懒加载到的子目录列表挂入目标目录节点，保留其余已加载子树并保持幂等与有序。
 */
export function mergeDirectoryChildren(
  nodes: readonly FileTreeNode[],
  targetDirPath: string,
  children: readonly FileTreeNode[],
): FileTreeNode[] {
  const normTarget = normalizeWorkspacePath(targetDirPath);
  if (!normTarget) return sortFileTreeNodes(nodes);

  const sortedChildren = sortFileTreeNodes(children);
  let changed = false;

  const walk = (list: readonly FileTreeNode[]): FileTreeNode[] =>
    list.map((node) => {
      if (!node.isDirectory) return node;
      if (normalizeWorkspacePath(node.path) === normTarget) {
        changed = true;
        return {
          ...node,
          children: sortedChildren,
          childrenLoaded: true,
        };
      }
      if (node.children && node.children.length > 0) {
        const nextChildren = walk(node.children);
        if (nextChildren !== node.children) {
          return { ...node, children: nextChildren };
        }
      }
      return node;
    });

  const next = walk(nodes);
  return changed ? sortFileTreeNodes(next) : sortFileTreeNodes(nodes);
}

/**
 * 按关键字不区分大小写过滤文件树：命中文件/目录及其全部祖先保留，命中目录则保留其已加载子节点。
 */
export function filterFileTree(
  nodes: readonly FileTreeNode[],
  query: string,
): FileTreeNode[] {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [...nodes];

  const out: FileTreeNode[] = [];
  for (const node of nodes) {
    const selfMatch =
      node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q);
    if (node.isDirectory) {
      if (selfMatch) {
        out.push(
          node.children
            ? { ...node, children: [...node.children] }
            : { ...node },
        );
        continue;
      }
      const matchedChildren = node.children ? filterFileTree(node.children, q) : [];
      if (matchedChildren.length > 0) {
        out.push({ ...node, children: matchedChildren });
      }
      continue;
    }
    if (selfMatch) {
      out.push({ ...node });
    }
  }
  return out;
}

/**
 * 推导目标文件路径从工作区根目录起的所有祖先目录路径，用于自动展开激活文件所在目录。
 */
export function collectAncestorDirectoryPaths(filePath: string, rootPath = ''): string[] {
  const normFile = normalizeWorkspacePath(filePath);
  if (!normFile) return [];
  const normRoot = normalizeWorkspacePath(rootPath);
  const ancestors: string[] = [];
  let cursor = normFile;

  for (;;) {
    const slash = cursor.lastIndexOf('/');
    if (slash <= 0) break;
    const parent = cursor.slice(0, slash);
    if (/^[A-Za-z]:$/.test(parent)) break;
    if (normRoot && parent === normRoot) break;
    if (normRoot && !parent.startsWith(normRoot.endsWith('/') ? normRoot : `${normRoot}/`)) {
      break;
    }
    ancestors.unshift(parent);
    cursor = parent;
  }

  return ancestors;
}

/**
 * 解析远程网关 HTTP `/api/files` 返回载荷并拦截 SPA HTML 回退劫持。
 */
export function parseGatewayFilesPayload(
  raw: unknown,
  parentPath: string,
): WorkspaceDirEntry[] | null {
  if (!raw) return null;

  let data: unknown = raw;
  if (typeof raw === 'string') {
    const probePath = parentPath ? `${parentPath}/index.json` : 'index.json';
    if (isSpaFallbackHtml(raw, probePath)) return null;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.warn('[fileTreeService] invalid gateway directory JSON:', err);
      return null;
    }
  }

  let items: unknown[] | null = null;
  if (Array.isArray(data)) {
    items = data;
  } else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.entries)) items = obj.entries;
    else if (Array.isArray(obj.files)) items = obj.files;
    else if (Array.isArray(obj.items)) items = obj.items;
    else if (Array.isArray(obj.data)) items = obj.data;
  }

  if (!items) return null;

  const entries: WorkspaceDirEntry[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      const cleanName = extractPathBasename(item);
      if (!cleanName || isIgnoredTreeEntryName(cleanName)) continue;
      const isAbsoluteItem = /^([A-Za-z]:[\\/]|\/)/.test(item.trim());
      entries.push({
        name: cleanName,
        path: isAbsoluteItem
          ? normalizeWorkspacePath(item)
          : joinWorkspacePath(parentPath, item),
        isDirectory: item.endsWith('/') || item.endsWith('\\'),
      });
      continue;
    }

    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const rawName = typeof rec.name === 'string'
      ? rec.name
      : typeof rec.filename === 'string'
        ? rec.filename
        : '';
    const rawPath = typeof rec.path === 'string'
      ? rec.path
      : typeof rec.file_path === 'string'
        ? rec.file_path
        : '';
    const cleanName = rawName || extractPathBasename(rawPath);
    if (!cleanName || isIgnoredTreeEntryName(cleanName)) continue;

    const typeStr = typeof rec.type === 'string' ? rec.type.toLowerCase() : '';
    const kindStr = typeof rec.kind === 'string' ? rec.kind.toLowerCase() : '';
    const isDir =
      rec.isDirectory === true ||
      rec.is_directory === true ||
      rec.is_dir === true ||
      rec.dir === true ||
      typeStr === 'directory' ||
      typeStr === 'dir' ||
      typeStr === 'folder' ||
      kindStr === 'directory' ||
      kindStr === 'dir' ||
      kindStr === 'folder';
    const normPath = rawPath ? normalizeWorkspacePath(rawPath) : joinWorkspacePath(parentPath, cleanName);
    const size =
      typeof rec.size === 'number' && Number.isFinite(rec.size) && rec.size >= 0
        ? rec.size
        : typeof rec.byteSize === 'number' && Number.isFinite(rec.byteSize) && rec.byteSize >= 0
          ? rec.byteSize
          : undefined;
    entries.push({
      name: cleanName,
      path: normPath,
      isDirectory: isDir,
      ...(size !== undefined ? { size } : {}),
    });
  }

  return entries;
}

/**
 * 解析并加载指定工作区目录的完整四级级联入口：
 *   Tier 1: Local PAL `platformBridge.listDirectory`（当指向远程网关且未指定目录时自动跳过本地兜底）
 *   Tier 2: Gateway HTTP `GET /api/files?path=...` ➔ `GET /api/fs/list?path=...`
 *   Tier 3: Gateway RPC `complete.path` 注入适配器
 *   Tier 4: 当前会话已知文件路径兜底（仅当查询根目录或提供有效相对项时生效）
 */
export async function resolveWorkspaceDirectory(
  targetDir: string,
  options: ResolveWorkspaceDirectoryOptions = {},
): Promise<ResolveWorkspaceDirectoryResult> {
  const normDir = normalizeWorkspacePath(targetDir);
  let lastError = '';

  // Tier 1: Local PAL physical directory listing
  const skipLocalDefault = !normDir && Boolean(options.gatewayUrl) && !isLoopbackGatewayUrl(options.gatewayUrl);
  if (!skipLocalDefault && options.platformBridge?.listDirectory) {
    try {
      const localEntries = await options.platformBridge.listDirectory(normDir || undefined);
      if (Array.isArray(localEntries)) {
        const rootPath = normDir || deriveCommonParent(localEntries);
        return {
          nodes: entriesToFileTreeNodes(localEntries),
          rootPath,
          source: 'local_fs',
        };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn('[fileTreeService] Tier 1 listDirectory failed:', lastError);
    }
  }

  // Tier 2: Gateway REST (/api/files 优先，超界或 SSH 专职配置自动回退 /api/fs/list)
  if (options.platformBridge?.httpProxy && options.gatewayUrl) {
    const profileSuffix = options.profile ? `&profile=${encodeURIComponent(options.profile)}` : '';
    const endpoints = [
      normDir ? `/api/files?path=${encodeURIComponent(normDir)}` : '/api/files',
      `/api/fs/list?path=${encodeURIComponent(normDir || '.')}${profileSuffix}`,
    ];
    for (const endpoint of endpoints) {
      try {
        const raw = await options.platformBridge.httpProxy({
          baseUrl: options.gatewayUrl,
          path: endpoint,
          method: 'GET',
        });
        const resolvedRoot = normDir || extractGatewayPayloadPath(raw);
        const parsed = parseGatewayFilesPayload(raw, resolvedRoot);
        if (parsed) {
          return {
            nodes: entriesToFileTreeNodes(parsed),
            rootPath: resolvedRoot,
            source: 'gateway_api',
          };
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.warn('[fileTreeService] Tier 2 gateway endpoint failed:', endpoint, lastError);
      }
    }
  }

  // Tier 3: Signed RPC `complete.path` adapter
  if (options.completePath) {
    try {
      const completed = await options.completePath(normDir);
      if (completed.length > 0) {
        return {
          nodes: buildTreeFromFlatPaths(completed, normDir),
          rootPath: normDir,
          source: 'gateway_rpc',
        };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn('[fileTreeService] Tier 3 complete.path failed:', lastError);
    }
  }

  // Tier 4: Session touched/open files virtual tree fallback
  if (options.fallbackPaths && options.fallbackPaths.length > 0) {
    const fallbackRoot = normalizeWorkspacePath(options.rootPathForFallback ?? normDir);
    const nodes = buildTreeFromFlatPaths(options.fallbackPaths, fallbackRoot);
    if (nodes.length > 0) {
      return {
        nodes,
        rootPath: fallbackRoot,
        source: 'session_cache',
      };
    }
  }

  return {
    error: lastError || 'Unable to read workspace directory',
  };
}

function deriveCommonParent(entries: readonly WorkspaceDirEntry[]): string {
  const first = entries[0];
  if (!first) return '';
  const norm = normalizeWorkspacePath(first.path);
  const slash = norm.lastIndexOf('/');
  if (slash < 0) return '';
  if (slash === 0) return '/';
  const parent = norm.slice(0, slash);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent;
}
