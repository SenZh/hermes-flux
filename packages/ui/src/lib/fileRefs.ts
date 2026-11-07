/**
 * 文件引用与会话真实读写文件的匹配
 *
 * 设计意图 (Why)：
 *   只有 Agent 在本次会话里真正读写过的文件才值得做成可点击引用。
 *   旧实现把所有「长得像路径」的行内代码都变成链接，满屏下划线与点击落空。
 *
 * 防范的历史坑 (Pitfall)：
 *   - 只按正则在正文里找路径会把命令里提到的一次性路径也变成链接；
 *   - 只有 basename（如 index.ts）时若集合里存在多个同名文件，链接会指向错误目标，
 *     因此同名命中必须唯一才允许判定为可点击。
 *
 * 约束与规则 (Rules)：
 *   1. 纯函数、零依赖（仅依赖 text.ts 的路径判定），Node 测试与浏览器共用；
 *   2. 只从文件类工具的参数与结果里取路径，不从命令文本里猜；
 *   3. 绝对路径用后缀匹配、相对路径用段后缀匹配，basename 命中必须唯一。
 */

import { isLikelyFilePath } from './text.js';

/** 只有这些工具的参数/结果被视为「真实读写文件」。 */
const FILE_TOOL_PATTERN = /(read|write|edit|patch|create|file|view|upload|apply)/i;
const PATH_FIELDS = ['resolved_path', 'file_path', 'filePath', 'path', 'file', 'target'];
const FILE_LIST_FIELDS = ['files_modified', 'files', 'changed_files', 'paths'];

export interface ToolFileSource {
  name: string;
  args: string;
  output?: string;
}

/** 统一路径写法：去引号、反斜杠、行号后缀与尾部斜杠。 */
export function normalizeFileRef(ref: string): string {
  let value = (ref || '').trim();
  if (!value) return '';
  value = value.replace(/^[`"']+|[`"']+$/g, '');
  value = value.replace(/\\/g, '/');
  value = value.replace(/:\d+(?::\d+)?$/, '');
  value = value.replace(/^\.\//, '');
  value = value.replace(/\/+$/, '');
  return value;
}

function pushPath(out: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return;
  const candidate = normalizeFileRef(value);
  if (!candidate) return;
  if (!candidate.startsWith('/') && !/^[a-zA-Z]:\//.test(candidate) && !isLikelyFilePath(candidate)) return;
  out.add(candidate);
}

function parseJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  // gate-degrade: 工具参数/结果不是 JSON 时按纯文本处理，这是设计内降级
  } catch {
    return undefined;
  }
}

function collectFromValue(value: unknown, out: Set<string>, depth = 0): void {
  if (value === null || value === undefined || depth > 3) return;

  if (typeof value === 'string') {
    const parsed = parseJson(value);
    if (parsed !== undefined) {
      collectFromValue(parsed, out, depth + 1);
      return;
    }
    pushPath(out, value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectFromValue(item, out, depth + 1);
    return;
  }

  if (typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  for (const key of PATH_FIELDS) pushPath(out, record[key]);
  for (const key of FILE_LIST_FIELDS) {
    const list = record[key];
    if (Array.isArray(list)) {
      for (const item of list) pushPath(out, item);
    }
  }
}

/**
 * 汇总一个会话里 Agent 真正读写过的文件。
 * 【约束与规则 (Rules)】只扫描文件类工具的 args / output，命令文本不参与。
 */
export function collectTouchedFiles(tools: readonly ToolFileSource[]): string[] {
  const out = new Set<string>();
  for (const tool of tools) {
    if (!tool || !FILE_TOOL_PATTERN.test(tool.name || '')) continue;
    collectFromValue(tool.args, out);
    if (tool.output) collectFromValue(tool.output, out);
  }
  return Array.from(out);
}

/** 正文中的文件引用是否命中会话真实读写过的文件。 */
export function isTouchedFileRef(ref: string, knownFiles: readonly string[]): boolean {
  if (!knownFiles.length) return false;
  const target = normalizeFileRef(ref);
  if (!target) return false;

  const absolute = target.startsWith('/') || /^[a-zA-Z]:\//.test(target);
  const targetBase = target.split('/').pop() || target;
  let basenameHits = 0;

  for (const raw of knownFiles) {
    const known = normalizeFileRef(raw);
    if (!known) continue;
    if (known === target) return true;
    if (absolute) {
      if (known.endsWith(target)) return true;
      continue;
    }
    // 相对路径带目录时按段后缀匹配；只有 basename 时走唯一性判定
    if (target.includes('/')) {
      if (known.endsWith(`/${target}`)) return true;
      continue;
    }
    if ((known.split('/').pop() || known) === targetBase) basenameHits += 1;
  }

  // basename 只有在集合里唯一时才可靠；多个同名文件宁可不可点击，也不指向错误目标
  return basenameHits === 1;
}
