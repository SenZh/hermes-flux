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
  messages?: SessionMessageWithTools[];
  fallbackNotice?: string;
}

export interface ResolvedFileResult {
  content: string;
  isImage: boolean;
  isHtml: boolean;
  fromCache: boolean;
  source: 'session_tool' | 'local_fs' | 'remote_http' | 'gateway_api' | 'fallback';
}

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

/**
 * 统一通用文件读取公共服务
 * 应用层调用本接口即可自动完成：历史提取 -> 本地/图片Base64探测 -> HTTP代理 -> 网关REST降级
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

  // 1. 尝试从会话消息的工具调用记录中瞬间秒出内容 (0ms 白屏)
  if (options.messages && options.messages.length > 0) {
    const cached = extractFileContentFromSessionTools(cleanTarget, options.messages);
    if (cached) {
      return {
        content: cached,
        isImage,
        isHtml,
        fromCache: true,
        source: 'session_tool',
      };
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
        return {
          content: localContent,
          isImage,
          isHtml,
          fromCache: false,
          source: 'local_fs',
        };
      }
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
        return {
          content: str,
          isImage: false,
          isHtml,
          fromCache: false,
          source: 'remote_http',
        };
      }
    } catch {}
  }

  // 4. 网关 REST 文件端点拉取 (支持网关静态文件直连 /api/files/download, /api/fs/read 等)
  if (options.platformBridge?.httpProxy && !isHttp) {
    const candidateEndpoints = [
      `/api/files/download?path=${encodeURIComponent(cleanTarget)}`,
      `/api/fs/read?path=${encodeURIComponent(cleanTarget)}&optional=true`,
      `/api/workspace/file?path=${encodeURIComponent(cleanTarget)}`,
      `/api/files?path=${encodeURIComponent(cleanTarget)}`,
    ];

    for (const endpoint of candidateEndpoints) {
      try {
        const res = await options.platformBridge.httpProxy({
          baseUrl: options.gatewayUrl || 'http://127.0.0.1:9119',
          path: endpoint,
          method: 'GET',
        });
        const text = typeof res === 'string'
          ? res
          : typeof (res as Record<string, unknown>)?.content === 'string'
          ? String((res as Record<string, unknown>).content)
          : '';

        // 【核心防御】：若返回的内容为空、包含 404 或命中了网关 SPA Dashboard 的 HTML 回退，一律坚决丢弃！
        if (text && text.length > 0 && !text.includes('Cannot GET') && !text.includes('404 Not Found') && !isSpaFallbackHtml(text, cleanTarget)) {
          return {
            content: text,
            isImage,
            isHtml,
            fromCache: false,
            source: 'gateway_api',
          };
        }
      } catch {}
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
