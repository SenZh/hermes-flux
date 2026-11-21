/**
 * Unified Workspace File Service (packages/core/src/fs/fileService.ts)
 * 
 * 核心设计哲学 (Core Architecture):
 * 1. 单一职责与统一出口 (Single Entrypoint):
 *    整个应用层（无论桌面、Web 还是移动端）只调用一个方法 `fileService.resolveFileContent(target, options)`；
 * 2. 多级自动降级编排 (Deterministic Cascade Pipeline):
 *    - 优先阶梯 1: 会话工具调用历史提取 (Session Tool Call Cache - 0ms 瞬间直出最新 write/patch/read 生成物)
 *    - 优先阶梯 2: 本地物理文件与图片 Base64 探测 (Local PAL Bridge - 直接穿透物理硬盘与项目目录)
 *    - 优先阶梯 3: HTTP/HTTPS 网络资源代理 (Network Proxy - 网页代码与线上资源安全透传)
 *    - 优先阶梯 4: 远端网关工作区文件通道 (Gateway Storage Endpoints - /api/files, /api/workspace)
 * 3. 结果严格保真与非空保障 (Failure Is Explicit):
 *    解析失败返回 null 或带有错误指示的降级文本，严禁空泡静默吞没。
 */

import type { IPlatformBridge } from '../pal/IPlatformBridge.js';
import type { HermesGatewayClient } from '../rpc/client.js';

export interface ToolCallRecord {
  name: string;
  args?: unknown;
  output?: unknown;
}

export interface SessionMessageWithTools {
  toolCalls?: ToolCallRecord[];
}

export interface ResolveFileOptions {
  platformBridge?: IPlatformBridge | null;
  gatewayClient?: HermesGatewayClient | null;
  gatewayUrl?: string;
  profile?: string;
  sessionId?: string;
  knownSize?: number;
  messages?: SessionMessageWithTools[];
  fallbackNotice?: string;
}

export interface ResolvedFileResult {
  content: string;
  isImage: boolean;
  isHtml: boolean;
  isBinary?: boolean;
  isTooLarge?: boolean;
  isDirectory?: boolean;
  byteSize?: number;
  fromCache: boolean;
  source: 'session_tool' | 'local_fs' | 'remote_http' | 'gateway_api' | 'fallback';
}

export const MAX_PREVIEW_FILE_BYTES = 1024 * 1024;
export const MAX_PREVIEW_IMAGE_BYTES = 10 * 1024 * 1024;

const BINARY_EXTENSIONS = new Set([
  'exe', 'dll', 'so', 'dylib', 'msi', 'bin', 'dat', 'com', 'deb', 'rpm', 'apk', 'ipa', 'dmg', 'iso', 'img', 'wasm',
  'o', 'a', 'lib', 'obj', 'pdb', 'pyc', 'pyo', 'class', 'jar', 'war', 'whl',
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', '7z', 'rar', 'lz4', 'cab',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'epub',
  'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv',
  'ttf', 'otf', 'woff', 'woff2', 'eot', 'sqlite', 'sqlite3', 'db', 'parquet', 'arrow', 'npy', 'npz',
  'pt', 'pth', 'onnx', 'safetensors', 'gguf',
]);

/**
 * 校验目标路径是否为图片格式扩展名
 */
export function isImageExtension(filePath: string): boolean {
  if (!filePath || typeof filePath !== 'string') return false;
  const clean = filePath.split(/[?#]/)[0];
  const ext = (clean.split('.').pop() || '').toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext);
}

/**
 * 判断扩展名是否属于不可直接按文本预览的二进制格式（可执行程序、压缩包、音视频、字体、数据库等）。
 */
export function isBinaryExtension(filePath: string): boolean {
  if (!filePath || typeof filePath !== 'string') return false;
  const clean = filePath.split(/[?#]/)[0];
  if (isImageExtension(clean)) return false;
  const base = clean.split(/[/\\]/).pop() || '';
  const dotIdx = base.lastIndexOf('.');
  if (dotIdx <= 0) return false;
  const ext = base.slice(dotIdx + 1).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * 探测文本前段是否包含 NUL 空字节，用以拦截 Linux 无后缀二进制/ELF 可执行文件。
 */
export function hasBinaryNullBytes(sample: string): boolean {
  if (!sample || typeof sample !== 'string') return false;
  const limit = Math.min(sample.length, 8192);
  for (let i = 0; i < limit; i++) {
    if (sample.charCodeAt(i) === 0) return true;
  }
  return false;
}

/**
 * 确定性格式化文件字节数（B / KB / MB / GB）。
 */
export function formatFileSize(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * 解码网关 `/api/files/read` 返回的 `data:*;base64,...` 为 UTF-8 文本；失败返回 null 并显式告警。
 */
export function decodeDataUrlUtf8(dataUrl: string): string | null {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return null;
  const meta = dataUrl.slice(5, commaIdx).toLowerCase();
  const body = dataUrl.slice(commaIdx + 1);
  if (!meta.includes(';base64')) {
    try {
      return decodeURIComponent(body);
    } catch (err) {
      console.warn('[fileService] failed to decode URL-encoded data URL:', err);
      return null;
    }
  }
  try {
    const binaryStr = atob(body);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch (err) {
    console.warn('[fileService] failed to decode base64 data URL:', err);
    return null;
  }
}

/**
 * 将 ws/wss/裸主机形式的网关地址规范化为无尾斜杠 HTTP(S) 基址。
 */
export function normalizeHttpBaseUrl(rawUrl: string): string {
  let base = (rawUrl || '').trim();
  if (!base) return '';
  if (base.startsWith('ws://')) base = `http://${base.slice(5)}`;
  else if (base.startsWith('wss://')) base = `https://${base.slice(6)}`;
  else if (!/^https?:\/\//i.test(base)) {
    const isLoopback = /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(base);
    base = isLoopback ? `http://${base}` : `https://${base}`;
  }
  return base.replace(/\/+$/, '');
}

/**
 * 拼装远程工作区附件下载接口 URL（优先走支持 SSH 工作区与多 Profile 的 `/api/fs/download`）。
 */
export function buildGatewayDownloadUrl(
  gatewayUrl: string,
  filePath: string,
  profile?: string,
  sessionId?: string,
): string {
  const base = normalizeHttpBaseUrl(gatewayUrl);
  if (!base || !filePath) return '';
  const q = new URLSearchParams();
  q.set('path', filePath);
  if (profile) q.set('profile', profile);
  if (sessionId) q.set('session_id', sessionId);
  return `${base}/api/fs/download?${q.toString()}`;
}

export interface FilePreviewGuardInput {
  filePath: string;
  isImage: boolean;
  byteSize?: number;
  serverBinary?: boolean;
  serverTruncated?: boolean;
  sampleText?: string;
}

export interface FilePreviewGuardResult {
  status: 'ok' | 'binary' | 'too_large';
  byteSize?: number;
}

/**
 * 文件预览安全守卫（INV-FS-05 单一真值裁决）：
 *   1. 非图片文件只要命中二进制扩展名、服务端 `binary` 标记或 NUL 字节，一律优先裁定为 `binary`；
 *   2. 体积超过渲染上限（文本 1 MiB / 图片 10 MiB）或服务端已截断，裁定为 `too_large`；
 *   3. 杜绝把 `.exe` / 压缩包或数十 MB 大文件强行灌入前端源码表格。
 */
export function evaluateFilePreviewGuard(input: FilePreviewGuardInput): FilePreviewGuardResult {
  const knownSize =
    typeof input.byteSize === 'number' && Number.isFinite(input.byteSize) && input.byteSize >= 0
      ? input.byteSize
      : undefined;
  const measuredBytes =
    knownSize !== undefined
      ? knownSize
      : !input.isImage && typeof input.sampleText === 'string'
        ? new TextEncoder().encode(input.sampleText).byteLength
        : undefined;

  if (
    !input.isImage &&
    (input.serverBinary === true ||
      isBinaryExtension(input.filePath) ||
      (typeof input.sampleText === 'string' && hasBinaryNullBytes(input.sampleText)))
  ) {
    return {
      status: 'binary',
      ...(measuredBytes !== undefined ? { byteSize: measuredBytes } : {}),
    };
  }

  const maxBytes = input.isImage ? MAX_PREVIEW_IMAGE_BYTES : MAX_PREVIEW_FILE_BYTES;
  if ((measuredBytes !== undefined && measuredBytes > maxBytes) || input.serverTruncated === true) {
    return {
      status: 'too_large',
      ...(measuredBytes !== undefined ? { byteSize: measuredBytes } : {}),
    };
  }

  return {
    status: 'ok',
    ...(measuredBytes !== undefined ? { byteSize: measuredBytes } : {}),
  };
}

/**
 * 严格防范 SPA（单页应用）服务器对 404 路由的 HTML 回退劫持
 * 【设计意图 (Why)】
 * 现代 Web 网关对不存在的静态或 API 路由（如 /api/files/download 或 Linux 绝对路径）
 * 往往返回 200 OK + index.html (SPA Dashboard) 骨架。
 * 若请求的原本是 .py, .ts, .js, .json, .md 等非 HTML 源码文件，返回却包含 HTML 骨架或 Dashboard 标识，
 * 必须坚决拦截丢弃，杜绝将控制台 HTML 误当作源文件代码呈现给用户！
 * 【防范的陷阱 (Pitfall)】
 * 用户打开任意不同的文件，右侧检查舱显示的全部都是同一个 SPA Dashboard HTML 页面。
 * 【约束与规则 (Rules)】
 * 严禁将命中 SPA 规则的内容作为正常响应返回。
 */
export function isSpaFallbackHtml(content: string, targetPath: string): boolean {
  if (!content || typeof content !== 'string') return false;
  const trimmed = content.trim();
  const ext = (targetPath.split(/[?#]/)[0].split('.').pop() || '').toLowerCase();

  // Hermes Dashboard 独有的专有指纹特征
  const hasDashboardSignature =
    trimmed.includes('<title>Hermes Agent - Dashboard') ||
    trimmed.includes('Hermes Agent - Dashboard') ||
    trimmed.includes('__HERMES_DASHBOARD_') ||
    trimmed.includes('__HERMES_BASE_PATH__');

  // 通用 HTML 骨架特征
  const isDocTypeHtml =
    trimmed.startsWith('<!doctype html') ||
    trimmed.startsWith('<!DOCTYPE html') ||
    trimmed.startsWith('<html') ||
    trimmed.includes('<div id="root"></div>');

  // 1. 如果请求的不是 html/htm 网页文件，但返回了 HTML 网页骨架或 Dashboard 指纹，必定是网关 SPA 回退
  if (ext !== 'html' && ext !== 'htm') {
    if (isDocTypeHtml || hasDashboardSignature) {
      return true;
    }
  }

  // 2. 如果请求的本身就是 html 文件，只有命中了 Hermes Dashboard 的专有指纹时才判定为劫持（防范误杀正常的包含 <div id="root"> 的用户前端原型）
  if (hasDashboardSignature) {
    return true;
  }

  return false;
}

/**
 * 从会话的工具调用记录列表中反向提取生成/编辑的文件内容
 */
/**
 * 从会话的工具调用记录列表中反向提取生成/编辑的文件内容
 * 【设计意图 (Why)】
 * 智能体在处理大型代码文件时，通常使用带 offset/limit 的 read_file 分批次阅读关键函数片段。
 * 若仅简单保留最后一次读取，会导致后置切片（如 200~300 行）覆盖掉先前读取的前置内容（如 1~100 行），
 * 造成用户在右侧预览时看到“只从第 200 行返回，前面 1~199 行全丢失”的断层体验。
 * 本算法引入【智能多切片缝合引擎 (Multi-Slice Stitched Reconstruction)】：
 * 1. 优先提取全量写入 (write/create)，优先级最高；
 * 2. 收集会话中针对该文件的全部读取切片，按行号精准缝合，并在断层处插入显式占位提示；
 * 3. 彻底根治行号断层与内容丢失。
 * 【防范的陷阱 (Pitfall)】
 * 1. 杜绝简单的 length 覆盖，避免大 offset 切片吞噬第 1 行；
 * 2. 剥离行号前缀（如 308: 或 308|），映射真实行号，杜绝双行号污染。
 * 【约束与规则 (Rules)】
 * 纯算法实现，零 DOM/UI 依赖，保持 packages/core 平台无关性。
 */
export function extractFileContentFromSessionTools(
  targetPath: string,
  messages: SessionMessageWithTools[] = []
): string | null {
  if (!targetPath) return null;
  const normalizedTarget = targetPath.replace(/\\/g, '/');
  const targetBaseName = normalizedTarget.split('/').pop() || '';

  // 1. 全局第一优先级：寻找 write / create 全量写入记录（包含从第 1 行到结束的完整代码）
  for (const m of messages) {
    if (!m.toolCalls || !Array.isArray(m.toolCalls)) continue;
    for (const tc of m.toolCalls) {
      const rawName = String(tc.name || '').toLowerCase();
      if (!rawName.includes('write') && !rawName.includes('create')) continue;

      let tcPath = '';
      let tcArgsObj: Record<string, unknown> | null = null;
      if (typeof tc.args === 'string') {
        try {
          const parsed = JSON.parse(tc.args.trim());
          if (parsed && typeof parsed === 'object') {
            // SAFETY: parsed is checked as object above
            tcArgsObj = parsed as Record<string, unknown>;
            const candidate = tcArgsObj?.path || tcArgsObj?.file || tcArgsObj?.filePath || tcArgsObj?.file_path || tcArgsObj?.resolved_path;
            tcPath = typeof candidate === 'string' ? candidate : '';
          }
        // gate-degrade: 工具参数是模型产出的自由文本，解析失败即视为没有路径
        } catch {}
      } else if (tc.args && typeof tc.args === 'object') {
        // SAFETY: typeof check ensures object
        tcArgsObj = tc.args as Record<string, unknown>;
        const candidate = tcArgsObj?.path || tcArgsObj?.file || tcArgsObj?.filePath || tcArgsObj?.file_path || tcArgsObj?.resolved_path;
        tcPath = typeof candidate === 'string' ? candidate : '';
      }

      if (!tcPath) continue;
      const normTcPath = tcPath.replace(/\\/g, '/');
      const tcBaseName = normTcPath.split('/').pop() || '';
      const isMatch = normTcPath === normalizedTarget ||
        normTcPath.endsWith(normalizedTarget) ||
        normalizedTarget.endsWith(normTcPath) ||
        (targetBaseName && tcBaseName && targetBaseName === tcBaseName);

      if (isMatch && tcArgsObj && typeof tcArgsObj.content === 'string' && tcArgsObj.content.length > 0) {
        return tcArgsObj.content;
      }
    }
  }

  // 2. 多切片收集与缝合 (Multi-Slice Stitched Engine)
  const lineMap = new Map<number, string>();
  let hasFullUnnumberedContent: string | null = null;
  const prefixRegex = /^\s*(\d+)[:|]\s?(.*)$/;

  for (const m of messages) {
    if (!m.toolCalls || !Array.isArray(m.toolCalls)) continue;
    for (const tc of m.toolCalls) {
      const rawName = String(tc.name || '').toLowerCase();
      // 排除非文件读取工具（搜索/终端等绝不作为文件源）
      if (!rawName.includes('read') && rawName !== 'file' && !rawName.includes('cat')) continue;

      let tcPath = '';
      let tcArgsObj: Record<string, unknown> | null = null;
      if (typeof tc.args === 'string') {
        try {
          const parsed = JSON.parse(tc.args.trim());
          if (parsed && typeof parsed === 'object') {
            // SAFETY: parsed object checked
            tcArgsObj = parsed as Record<string, unknown>;
            const candidate = tcArgsObj?.path || tcArgsObj?.file || tcArgsObj?.filePath || tcArgsObj?.file_path || tcArgsObj?.resolved_path;
            tcPath = typeof candidate === 'string' ? candidate : '';
          }
        } catch {
          tcPath = tc.args.trim();
        }
      } else if (tc.args && typeof tc.args === 'object') {
        // SAFETY: typeof check ensures object
        tcArgsObj = tc.args as Record<string, unknown>;
        const candidate = tcArgsObj?.path || tcArgsObj?.file || tcArgsObj?.filePath || tcArgsObj?.file_path || tcArgsObj?.resolved_path;
        tcPath = typeof candidate === 'string' ? candidate : '';
      }

      if (!tcPath) continue;
      const normTcPath = tcPath.replace(/\\/g, '/');
      const tcBaseName = normTcPath.split('/').pop() || '';
      const isMatch = normTcPath === normalizedTarget ||
        normTcPath.endsWith(normalizedTarget) ||
        normalizedTarget.endsWith(normTcPath) ||
        (targetBaseName && tcBaseName && targetBaseName === tcBaseName);

      if (!isMatch) continue;

      let outStr = typeof tc.output === 'string' ? tc.output : tc.output ? JSON.stringify(tc.output) : '';
      if (outStr.startsWith('{') && outStr.endsWith('}')) {
        try {
          const parsed = JSON.parse(outStr);
          if (typeof parsed.content === 'string') outStr = parsed.content;
          else if (typeof parsed.text === 'string') outStr = parsed.text;
          else if (typeof parsed.output === 'string') outStr = parsed.output;
        // gate-degrade: 工具输出可能是非 JSON 文本，解析失败即原样使用
        } catch {}
      }
      if (!outStr && tcArgsObj && typeof tcArgsObj.content === 'string') {
        outStr = tcArgsObj.content;
      }

      if (!outStr || outStr.trim().length === 0) continue;

      const rawLines = outStr.split('\n');
      let startOffset = 1;
      if (tcArgsObj && 'offset' in tcArgsObj && Number(tcArgsObj.offset) > 0) {
        startOffset = Number(tcArgsObj.offset);
      }

      let detectedNumberedLines = 0;
      for (let i = 0; i < Math.min(rawLines.length, 10); i++) {
        if (prefixRegex.test(rawLines[i])) detectedNumberedLines++;
      }
      const hasPrefixNumbers = detectedNumberedLines >= 2;

      if (hasPrefixNumbers) {
        // 从行首精准抽取真实行号并录入行号映射表
        for (const rawLine of rawLines) {
          const match = prefixRegex.exec(rawLine);
          if (match) {
            const lineNo = parseInt(match[1], 10);
            const lineContent = match[2];
            if (!lineMap.has(lineNo)) {
              lineMap.set(lineNo, lineContent);
            }
          }
        }
      } else {
        // 无行号前缀，依据 offset 连续递增写入
        for (let i = 0; i < rawLines.length; i++) {
          const lineNo = startOffset + i;
          if (!lineMap.has(lineNo)) {
            lineMap.set(lineNo, rawLines[i]);
          }
        }
        if (startOffset === 1 && rawLines.length > 50) {
          hasFullUnnumberedContent = outStr;
        }
      }
    }
  }

  // 3. 缝合切片：若收集到了编号行，按真实行号顺序合成纯净代码行（携带行号前缀以供展示器精准对齐标尺）
  if (lineMap.size > 0) {
    const sortedLineNos = Array.from(lineMap.keys()).sort((a, b) => a - b);
    const minLine = sortedLineNos[0];
    const assembledLines: string[] = [];

    for (let i = 0; i < sortedLineNos.length; i++) {
      const currentLineNo = sortedLineNos[i];
      const code = lineMap.get(currentLineNo) ?? '';

      // 若起始行号大于 1（非第 1 行开头），保留行号前缀便于 InspectionPod 标尺精准对齐真实行号
      // 绝不注入任何伪造的中文注释行，保持代码本身 100% 纯净！
      if (minLine > 1) {
        assembledLines.push(`${currentLineNo}: ${code}`);
      } else {
        assembledLines.push(code);
      }
    }

    return assembledLines.join('\n');
  }

  return hasFullUnnumberedContent;
}

function buildGuardedResult(
  content: string,
  meta: {
    filePath: string;
    isImage: boolean;
    isHtml: boolean;
    fromCache: boolean;
    source: ResolvedFileResult['source'];
    byteSize?: number;
    serverBinary?: boolean;
    serverTruncated?: boolean;
  },
): ResolvedFileResult {
  const guard = evaluateFilePreviewGuard({
    filePath: meta.filePath,
    isImage: meta.isImage,
    byteSize: meta.byteSize,
    serverBinary: meta.serverBinary,
    serverTruncated: meta.serverTruncated,
    sampleText: content,
  });
  if (guard.status === 'binary') {
    return {
      content: '',
      isImage: false,
      isHtml: false,
      isBinary: true,
      ...(guard.byteSize !== undefined ? { byteSize: guard.byteSize } : {}),
      fromCache: meta.fromCache,
      source: meta.source,
    };
  }
  if (guard.status === 'too_large') {
    return {
      content: '',
      isImage: meta.isImage,
      isHtml: false,
      isTooLarge: true,
      ...(guard.byteSize !== undefined ? { byteSize: guard.byteSize } : {}),
      fromCache: meta.fromCache,
      source: meta.source,
    };
  }
  return {
    content,
    isImage: meta.isImage,
    isHtml: meta.isHtml,
    ...(guard.byteSize !== undefined ? { byteSize: guard.byteSize } : {}),
    fromCache: meta.fromCache,
    source: meta.source,
  };
}

/**
 * 统一通用文件读取公共服务
 * 应用层调用本接口即可自动完成：二进制/体积守卫 -> 历史提取 -> 本地/图片Base64探测 -> HTTP代理 -> 网关REST降级
 */
export async function resolveFileContent(
  target: string,
  options: ResolveFileOptions = {}
): Promise<ResolvedFileResult> {
  const cleanTarget = (target || '').trim();
  const ext = (cleanTarget.split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
  const isImage = isImageExtension(cleanTarget);
  const isHtml = ext === 'html' || ext === 'htm';
  const isHttp = cleanTarget.startsWith('http://') || cleanTarget.startsWith('https://');

  // 0. 前置二进制/超大文件阻断：已知为二进制或超限文件时直接返回下载卡片态，绝不消耗带宽与渲染节点
  const preGuard = evaluateFilePreviewGuard({
    filePath: cleanTarget,
    isImage,
    byteSize: options.knownSize,
  });
  if (preGuard.status !== 'ok') {
    return {
      content: '',
      isImage: preGuard.status === 'binary' ? false : isImage,
      isHtml: false,
      ...(preGuard.status === 'binary' ? { isBinary: true } : { isTooLarge: true }),
      ...(preGuard.byteSize !== undefined ? { byteSize: preGuard.byteSize } : {}),
      fromCache: false,
      source: isHttp ? 'remote_http' : 'fallback',
    };
  }

  // 1. 尝试从会话消息的工具调用记录中瞬间秒出内容 (0ms 白屏)
  if (options.messages && options.messages.length > 0) {
    const cached = extractFileContentFromSessionTools(cleanTarget, options.messages);
    if (cached) {
      return buildGuardedResult(cached, {
        filePath: cleanTarget,
        isImage,
        isHtml,
        fromCache: true,
        source: 'session_tool',
      });
    }
  }

  // 针对在线图片 URL，若已经为 http 且为图片类型，直接以 URL 作为 preview 内容供 img 标签使用
  if (isHttp && isImage) {
    return {
      content: cleanTarget,
      isImage: true,
      isHtml: false,
      fromCache: true,
      source: 'remote_http',
    };
  }

  // 2. 本地物理文件与图片 Base64 探测 (Local PAL Bridge)
  if (options.platformBridge?.readFile && !isHttp) {
    try {
      const localContent = await options.platformBridge.readFile(cleanTarget);
      if (typeof localContent === 'string' && localContent.length > 0) {
        return buildGuardedResult(localContent, {
          filePath: cleanTarget,
          isImage,
          isHtml,
          fromCache: false,
          source: 'local_fs',
          byteSize: isImage ? options.knownSize : undefined,
        });
      }
    // gate-degrade: 本地文件读取是四级回退链的一级，失败必须继续下一级
    } catch {}
  }

  // 3. 在线 HTTP/HTTPS 链接内容抓取 (若是文本/网页代码)
  if (isHttp && !isImage && options.platformBridge?.httpProxy) {
    try {
      const text = await options.platformBridge.httpProxy({
        baseUrl: cleanTarget,
        path: '',
        method: 'GET',
      });
      const str = typeof text === 'string' ? text : text ? JSON.stringify(text, null, 2) : '';
      if (str) {
        return buildGuardedResult(str, {
          filePath: cleanTarget,
          isImage: false,
          isHtml,
          fromCache: false,
          source: 'remote_http',
        });
      }
    // gate-degrade: HTTP 抓取是回退链的一环，失败继续走网关 REST 端点
    } catch {}
  }

  // 4. 网关 REST 文件端点拉取（对接真实网关 /api/fs/read-data-url、/api/fs/read-text、/api/files/read、/api/fs/download 等）
  if (options.platformBridge?.httpProxy && options.gatewayUrl && !isHttp) {
    const fsParams = new URLSearchParams({ path: cleanTarget });
    if (options.profile) fsParams.set('profile', options.profile);
    if (options.sessionId) fsParams.set('session_id', options.sessionId);
    const fsQuery = fsParams.toString();
    const encTarget = encodeURIComponent(cleanTarget);

    if (isImage) {
      const imageEndpoints = [
        `/api/fs/read-data-url?${fsQuery}`,
        `/api/files/read?path=${encTarget}`,
        `/api/files/download?path=${encTarget}`,
      ];
      for (const endpoint of imageEndpoints) {
        try {
          const res = await options.platformBridge.httpProxy({
            baseUrl: options.gatewayUrl,
            path: endpoint,
            method: 'GET',
          });
          const rec = res && typeof res === 'object' ? (res as Record<string, unknown>) : null;
          const dataUrl =
            rec && typeof rec.dataUrl === 'string'
              ? rec.dataUrl
              : rec && typeof rec.data_url === 'string'
                ? rec.data_url
                : typeof res === 'string' && res.startsWith('data:image/')
                  ? res
                  : '';
          const rawSize = rec ? (rec.size ?? rec.byteSize) : undefined;
          const byteSize =
            typeof rawSize === 'number' && Number.isFinite(rawSize) ? rawSize : options.knownSize;
          if (dataUrl) {
            return buildGuardedResult(dataUrl, {
              filePath: cleanTarget,
              isImage: true,
              isHtml: false,
              fromCache: false,
              source: 'gateway_api',
              byteSize,
            });
          }
        } catch (err) {
          console.warn('[fileService] gateway image endpoint failed:', endpoint, err);
        }
      }
    } else {
      // 4a. 首选 `/api/fs/read-text`：自带 binary/truncated/byteSize 元数据，安全高效
      try {
        const res = await options.platformBridge.httpProxy({
          baseUrl: options.gatewayUrl,
          path: `/api/fs/read-text?${fsQuery}`,
          method: 'GET',
        });
        if (res && typeof res === 'object') {
          const rec = res as Record<string, unknown>;
          const byteSize =
            typeof rec.byteSize === 'number' && Number.isFinite(rec.byteSize) ? rec.byteSize : options.knownSize;
          const serverBinary = rec.binary === true;
          const serverTruncated = rec.truncated === true;
          if (serverBinary || serverTruncated) {
            return buildGuardedResult('', {
              filePath: cleanTarget,
              isImage: false,
              isHtml,
              fromCache: false,
              source: 'gateway_api',
              byteSize,
              serverBinary,
              serverTruncated,
            });
          }
          if (typeof rec.text === 'string' && !isSpaFallbackHtml(rec.text, cleanTarget)) {
            return buildGuardedResult(rec.text, {
              filePath: cleanTarget,
              isImage: false,
              isHtml,
              fromCache: false,
              source: 'gateway_api',
              byteSize,
            });
          }
        }
      } catch (err) {
        console.warn('[fileService] gateway /api/fs/read-text failed:', err);
      }

      // 4b. 次选 `/api/files/read`：返回 data_url 与 size，先核验体积再解码 UTF-8
      try {
        const res = await options.platformBridge.httpProxy({
          baseUrl: options.gatewayUrl,
          path: `/api/files/read?path=${encTarget}`,
          method: 'GET',
        });
        if (res && typeof res === 'object') {
          const rec = res as Record<string, unknown>;
          const byteSize =
            typeof rec.size === 'number' && Number.isFinite(rec.size) ? rec.size : options.knownSize;
          const sizeGuard = evaluateFilePreviewGuard({
            filePath: cleanTarget,
            isImage: false,
            byteSize,
          });
          if (sizeGuard.status !== 'ok') {
            return buildGuardedResult('', {
              filePath: cleanTarget,
              isImage: false,
              isHtml,
              fromCache: false,
              source: 'gateway_api',
              byteSize: sizeGuard.byteSize,
            });
          }
          if (typeof rec.data_url === 'string') {
            const decoded = decodeDataUrlUtf8(rec.data_url);
            if (decoded !== null && !isSpaFallbackHtml(decoded, cleanTarget)) {
              return buildGuardedResult(decoded, {
                filePath: cleanTarget,
                isImage: false,
                isHtml,
                fromCache: false,
                source: 'gateway_api',
                byteSize,
              });
            }
          }
        }
      } catch (err) {
        console.warn('[fileService] gateway /api/files/read failed:', err);
      }

      // 4c. 兜底下载与目录鉴别（若 /api/files 返回 entries 数组，识别为目录防止误当文件报错）
      const fallbackEndpoints = [
        `/api/fs/download?${fsQuery}`,
        `/api/files/download?path=${encTarget}`,
        `/api/files?path=${encTarget}`,
      ];
      for (const endpoint of fallbackEndpoints) {
        try {
          const res = await options.platformBridge.httpProxy({
            baseUrl: options.gatewayUrl,
            path: endpoint,
            method: 'GET',
          });
          if (res && typeof res === 'object' && Array.isArray((res as Record<string, unknown>).entries)) {
            return {
              content: '',
              isImage: false,
              isHtml: false,
              isDirectory: true,
              fromCache: false,
              source: 'gateway_api',
            };
          }
          const text = typeof res === 'string'
            ? res
            : res && typeof (res as Record<string, unknown>).content === 'string'
              ? String((res as Record<string, unknown>).content)
              : '';
          if (text && !text.includes('Cannot GET') && !text.includes('404 Not Found') && !isSpaFallbackHtml(text, cleanTarget)) {
            return buildGuardedResult(text, {
              filePath: cleanTarget,
              isImage: false,
              isHtml,
              fromCache: false,
              source: 'gateway_api',
              byteSize: options.knownSize,
            });
          }
        } catch (err) {
          console.warn('[fileService] gateway fallback endpoint failed:', endpoint, err);
        }
      }
    }
  }

  // 5. 兜底回退文本
  const fallback = options.fallbackNotice || `// ${cleanTarget}\n\n（该文件位于远程网关工作区，网关未开放直接文件读取通道）`;
  return {
    content: fallback,
    isImage,
    isHtml,
    fromCache: false,
    source: 'fallback',
  };
}
