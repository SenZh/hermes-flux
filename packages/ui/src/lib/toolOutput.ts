/**
 * 工具结果归一化（协议 JSON → 人类可读形态）
 *
 * 设计意图 (Why)：
 *   网关把工具结果封装成 JSON 信封：
 *     terminal    → { output, exit_code, error, hint }
 *     search_files→ { total_count, matches_text | matches[] }
 *     patch       → { success, diff, files_modified }
 *     read_file   → { content, total_lines, truncated, error }
 *     write_file  → { bytes_written, resolved_path, files_modified }
 *   直接把这些字符串塞进 <pre> 等于让用户读协议。本模块只按「结果本身的形状」
 *   拆成五种可读形态：终端文本 / 差异 / 匹配 / 文件 / 字段。
 *
 * 防范的历史坑 (Pitfall)：
 *   旧实现把整个信封原样展示，用户看到的是 `{"output": "...", "exit_code": 0}`，
 *   既要自己找正文，又会被 approval/hint 等元字段淹没。
 *
 * 约束与规则 (Rules)：
 *   1. 纯函数、零依赖，Node 测试与浏览器共用；
 *   2. 未知结构必须安全兜底，禁止抛错、禁止丢失正文；
 *   3. 不猜工具语义，只看结果形状；解析深度上限 3 层，防止自引用死循环。
 */

export interface ToolMatch {
  path: string;
  line: number | null;
  text: string;
}

export interface ToolField {
  key: string;
  value: string;
}

export interface ToolOutputMeta {
  /** 命令退出码；仅数字化信封提供 */
  exitCode?: number;
  /** 失败原因或 Lint 错误，独立于正文渲染 */
  error?: string;
  /** 网关附加提示（如超时后如何调大 timeout），弱化展示 */
  note?: string;
}

export type ToolOutputView = ToolOutputMeta &
  (
    | { kind: 'empty' }
    | { kind: 'text'; text: string }
    | { kind: 'diff'; diff: string; files: string[] }
    | { kind: 'matches'; matches: ToolMatch[]; total: number }
    | { kind: 'files'; files: string[] }
    | { kind: 'fields'; fields: ToolField[] }
  );

const UNTRUSTED_WRAPPER = /^<untrusted_tool_result\b[^>]*>([\s\S]*?)<\/untrusted_tool_result>$/i;
const MAX_DEPTH = 3;
const MAX_FIELDS = 40;
const MAX_FIELD_LENGTH = 600;

/** 只解析「完整」的 JSON 文本，避免把带尾随日志的输出误判成 JSON。 */
function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  const looksObject = trimmed.startsWith('{') && trimmed.endsWith('}');
  const looksArray = trimmed.startsWith('[') && trimmed.endsWith(']');
  if (!looksObject && !looksArray) return undefined;
  if (trimmed.length < 2) return undefined;
  try {
    return JSON.parse(trimmed);
  // gate-degrade: 工具输出不是合法 JSON 时按纯文本展示，这是设计内降级
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

/** 从 unified diff 的 `+++ b/<path>` 头提取文件列表。 */
function diffFiles(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split('\n')) {
    const match = line.match(/^\+\+\+ (?:b\/)?(.+?)\s*$/);
    if (match && match[1] && match[1] !== '/dev/null') files.push(match[1]);
  }
  return files;
}

/**
 * 解析网关 path-grouped 的 matches_text：
 *   /path/to/file
 *     803:   "matched line"
 *   行首无缩进 = 文件路径，缩进 + `行号:` = 命中行。
 */
function parseGroupedMatches(text: string): ToolMatch[] {
  const matches: ToolMatch[] = [];
  let currentPath = '';
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const numbered = line.match(/^\s+(\d+):\s?(.*)$/);
    if (numbered) {
      matches.push({ path: currentPath, line: Number(numbered[1]), text: numbered[2] });
      continue;
    }
    // 非编号的缩进行是上一条命中的续行，保持可读但不新建条目
    if (/^\s/.test(line)) continue;
    currentPath = line.trim();
  }
  return matches;
}

function parseMatchArray(value: unknown[], total?: number): ToolOutputView | null {
  const matches: ToolMatch[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const path = typeof record.path === 'string'
      ? record.path
      : typeof record.file === 'string'
        ? record.file
        : '';
    const rawLine = record.line ?? record.line_number;
    const line = typeof rawLine === 'number' ? rawLine : null;
    const text = typeof record.content === 'string'
      ? record.content
      : typeof record.text === 'string'
        ? record.text
        : typeof record.match === 'string'
          ? record.match
          : '';
    if (!path && !text) continue;
    matches.push({ path, line, text });
  }
  if (matches.length === 0) return null;
  return { kind: 'matches', matches, total: typeof total === 'number' ? total : matches.length };
}

/** read_file 的正文带 `123|` 行号前缀；去掉前缀后才是人读的内容。 */
function stripLineNumberPrefixes(text: string): string {
  const lines = text.split('\n');
  const probe = lines.slice(0, 12).filter((line) => line.trim().length > 0);
  if (probe.length === 0) return text;
  const numbered = probe.filter((line) => /^\s*\d+\|/.test(line)).length;
  if (numbered < Math.min(3, probe.length)) return text;
  return lines.map((line) => line.replace(/^\s*\d+\|/, '')).join('\n');
}

function formatFieldValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string' || typeof item === 'number')) {
      return value.map((item) => String(item)).join(', ');
    }
    const items = value.map((item) => JSON.stringify(item));
    return items.length ? `[${items.join(', ')}]` : null;
  }
  if (typeof value === 'object') {
    const text = JSON.stringify(value);
    return text && text !== '{}' ? text : null;
  }
  return null;
}

/** 通用对象兜底：扁平化为 key: value，跳过协议噪声字段。 */
const SKIPPED_FIELDS = new Set(['matches_format', 'approval', '_warning']);

function toFields(record: Record<string, unknown>): ToolField[] {
  const fields: ToolField[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (SKIPPED_FIELDS.has(key)) continue;
    const formatted = formatFieldValue(value);
    if (!formatted) continue;
    fields.push({
      key,
      value: formatted.length > MAX_FIELD_LENGTH ? `${formatted.slice(0, MAX_FIELD_LENGTH)}…` : formatted,
    });
    if (fields.length >= MAX_FIELDS) break;
  }
  return fields;
}

function interpretString(raw: string, depth: number): ToolOutputView {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'empty' };

  const untrusted = trimmed.match(UNTRUSTED_WRAPPER);
  if (untrusted) return interpretString(untrusted[1].trim(), depth + 1);

  if (depth < MAX_DEPTH) {
    const parsed = tryParseJson(trimmed);
    if (parsed !== undefined) return interpretValue(parsed, depth + 1);
  }

  // 原始 diff 文本（历史会话可能直接落 diff 而不是信封）
  if (/^--- .+\n\+\+\+ /m.test(trimmed) && /^@@ /m.test(trimmed)) {
    return { kind: 'diff', diff: trimmed, files: diffFiles(trimmed) };
  }

  return { kind: 'text', text: raw };
}

function interpretArray(items: unknown[], depth: number): ToolOutputView {
  if (items.length === 0) return { kind: 'empty' };

  if (items.every((item) => typeof item === 'string')) {
    return { kind: 'files', files: items as string[] };
  }

  const matches = parseMatchArray(items);
  if (matches) return matches;

  const lines = items
    .map((item) => (typeof item === 'string' ? item : formatFieldValue(item) ?? ''))
    .filter(Boolean);
  if (lines.length === 0) return { kind: 'empty' };
  return { kind: 'text', text: lines.join('\n') };
}

function interpretObject(record: Record<string, unknown>, depth: number): ToolOutputView {
  const exitCode = typeof record.exit_code === 'number'
    ? record.exit_code
    : typeof record.exitCode === 'number'
      ? record.exitCode
      : undefined;
  const rawError = typeof record.error === 'string' && record.error.trim() ? record.error.trim() : undefined;
  const rawNote = typeof record.hint === 'string' && record.hint.trim() ? record.hint.trim() : undefined;

  const lint = asRecord(record.lint);
  const lintError = lint && lint.status === 'error' && typeof lint.output === 'string' && lint.output.trim()
    ? lint.output.trim()
    : undefined;

  const meta: ToolOutputMeta = {
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(rawError || lintError ? { error: rawError ?? lintError } : {}),
    ...(rawNote ? { note: rawNote } : {}),
  };

  // 1. 文件变更：diff 是唯一权威内容
  const diff = [record.diff, record.patch, record.inline_diff]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (diff) {
    const files = asStringList(record.files_modified);
    return { kind: 'diff', diff, files: files.length ? files : diffFiles(diff), ...meta };
  }

  // 2. 搜索命中：网关有两种形态（path-grouped 文本 / 结构化数组）
  if (typeof record.matches_text === 'string' && record.matches_text.trim()) {
    const matches = parseGroupedMatches(record.matches_text);
    const total = typeof record.total_count === 'number' ? record.total_count : matches.length;
    if (matches.length) return { kind: 'matches', matches, total, ...meta };
    return { kind: 'text', text: record.matches_text, ...meta };
  }
  if (Array.isArray(record.matches)) {
    const matches = parseMatchArray(record.matches, typeof record.total_count === 'number' ? record.total_count : undefined);
    if (matches) return { ...matches, ...meta };
  }
  if (record.total_count === 0) {
    return { kind: 'matches', matches: [], total: 0, ...meta };
  }

  // 3. 代码执行 / 终端信封：output 内层可能还是 JSON，递归拆解
  if (typeof record.output === 'string') {
    const inner = interpretString(record.output, depth + 1);
    if (inner.kind === 'empty') return { kind: 'empty', ...meta };
    return { ...inner, ...meta };
  }

  // 4. 读文件：content + 行数/大小元信息
  const isFileRead = 'content' in record
    && ('total_lines' in record || 'file_size' in record || 'truncated' in record || 'is_binary' in record || 'is_image' in record || 'not_found' in record);
  if (isFileRead && typeof record.content === 'string') {
    if (!record.content.trim()) {
      return rawError ? { kind: 'text', text: rawError, ...meta } : { kind: 'empty', ...meta };
    }
    return { kind: 'text', text: stripLineNumberPrefixes(record.content), ...meta };
  }

  // 5. 技能正文：content 是一整篇文档
  if (typeof record.content === 'string' && typeof record.name === 'string') {
    const heading = [record.name, typeof record.description === 'string' ? record.description : '']
      .filter(Boolean)
      .join(' — ');
    const body = record.content.trim();
    return { kind: 'text', text: heading && body ? `${heading}\n\n${body}` : body || heading, ...meta };
  }

  // 6. 写文件：只列改动文件，元信息不进正文
  const files = asStringList(record.files_modified);
  if (files.length && !('content' in record)) {
    return { kind: 'files', files, ...meta };
  }

  if (rawError) return { kind: 'text', text: rawError, ...meta };

  // 7. 通用兜底：扁平字段清单，绝不回退成裸 JSON 大括号
  const fields = toFields(record);
  if (fields.length === 0) return { kind: 'empty', ...meta };
  return { kind: 'fields', fields, ...meta };
}

function interpretValue(value: unknown, depth: number): ToolOutputView {
  if (value === null || value === undefined) return { kind: 'empty' };
  if (typeof value === 'string') return interpretString(value, depth);
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { kind: 'text', text: String(value) };
  }
  if (Array.isArray(value)) return interpretArray(value, depth);
  const record = asRecord(value);
  if (record) return interpretObject(record, depth);
  return { kind: 'empty' };
}

/**
 * 把任意工具结果归一化为可读视图。
 * 【约束与规则 (Rules)】永不抛出异常；无法识别的结构退化为字段清单，仍可展开查看。
 */
export function normalizeToolOutput(raw: unknown): ToolOutputView {
  try {
    return interpretValue(raw, 0);
  // gate-degrade: 归一化失败也必须保住原始文本，不能让工具行变成空白
  } catch {
    const text = typeof raw === 'string' ? raw : '';
    return text ? { kind: 'text', text } : { kind: 'empty' };
  }
}

/** 是否有可展开的内容（空视图不应该渲染展开箭头）。 */
export function hasToolOutput(view: ToolOutputView): boolean {
  return view.kind !== 'empty';
}
