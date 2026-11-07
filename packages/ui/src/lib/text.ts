/**
 * 纯文本判定与转义工具。
 * 【设计意图 (Why)】Markdown 渲染器与模板渲染都需要同一套「什么算文件路径 / 什么算 URL」判定，
 *   放在 MiddlePod 里会形成 markdown → MiddlePod → markdown 的循环依赖。
 * 【约束与规则 (Rules)】本模块零副作用、零 DOM 依赖，可同时在 Node（测试）与浏览器中使用。
 */

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const COMMON_FILE_EXTENSIONS = new Set([
  'html', 'htm', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp',
  'md', 'markdown', 'txt', 'log', 'pdf', 'csv',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'yaml', 'yml', 'toml', 'xml',
  'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'sh', 'bash', 'zsh', 'ps1',
  'css', 'scss', 'sass', 'less', 'sql', 'diff', 'patch', 'env', 'dockerfile', 'lock',
]);

/** 校验目标字符串是否具备文件路径特征。 */
export function isLikelyFilePath(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  const trimmed = str.trim();
  if (trimmed.length < 2 || trimmed.length > 500 || /\s/.test(trimmed)) return false;
  if (trimmed.startsWith('-')) return false;

  if (
    trimmed.startsWith('/') &&
    !trimmed.startsWith('//') &&
    (trimmed.includes('/', 1) || COMMON_FILE_EXTENSIONS.has((trimmed.split('.').pop() || '').toLowerCase()))
  ) {
    return true;
  }

  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return true;

  if (trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('.\\') || trimmed.startsWith('..\\')) {
    return true;
  }

  const extMatch = trimmed.match(/\.([a-zA-Z0-9_-]+)$/);
  if (extMatch && COMMON_FILE_EXTENSIONS.has(extMatch[1].toLowerCase())) return true;

  if (/^(src|docs|packages|app|lib|components|utils|tests?|scripts)\//.test(trimmed)) return true;

  return false;
}

/** 深度提取工具调用的主要参数（命令或目标文件路径）。 */
export function extractToolTarget(rawArgs: unknown): string {
  if (!rawArgs) return '';
  if (typeof rawArgs === 'string') {
    const trimmed = rawArgs.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          return extractToolTarget(parsed);
        }
      // gate-degrade: 工具 args 字符串非合法 JSON 时保留原始文本展示
      } catch {}
    }
    return rawArgs;
  }
  if (typeof rawArgs === 'object' && rawArgs !== null) {
    const o = rawArgs as Record<string, unknown>;
    const candidate =
      o.command ||
      o.cmd ||
      o.path ||
      o.file ||
      o.filePath ||
      o.file_path ||
      o.resolved_path ||
      o.query ||
      o.pattern ||
      o.description ||
      o.prompt;
    if (typeof candidate === 'string') return candidate;
  }
  return '';
}

/** 校验目标字符串是否为完整的 HTTP/HTTPS 链接。 */
export function isLikelyHttpUrl(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  return /^https?:\/\/[^\s"'`<>]+$/i.test(str.trim());
}
