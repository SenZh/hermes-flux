/**
 * Hermes Flux Middle Conversation Pod (v4.0 Production)
 * Full-Bleed Fluid Canvas:
 * - Canvas spans 100% width edge-to-edge between left and right rails.
 * - Golden-width composer dock floating at bottom (740px).
 * - Shows Onboarding Connect Hero when disconnected.
 * - Shows Ready Welcome Screen when session is empty.
 * - Incremental DOM update hooks (msg-content-ID, msg-thought-ID).
 * - Meticulous typography, smooth Markdown rendering & thought details.
 */

import { t } from '../../i18n/index.js';
import { escapeHtml } from '../../utils/html.js';
import { renderMarkdownCore, formatInlineCodeOrLink as formatInlineCodeOrLinkLib, highlightCodeSyntax as highlightCodeSyntaxLib, type RenderMarkdownOptions } from '../../lib/markdown.js';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolBlocks } from '../../components-react/conversation/ToolCapsule.js';

export interface MessageViewModel {
  id: string;
  rowId?: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sender?: string;
  senderAvatar?: string;
  model?: string;
  thought?: string;
  thoughtDurationMs?: number;
  durationMs?: number;
  ttftMs?: number;
  toolCalls?: {
    id: string;
    name: string;
    status: 'running' | 'completed' | 'failed';
    args: string;
    output?: string;
    durationMs?: number;
    startTime?: number;
  }[];
  timestamp: string;
  rawTimestamp?: number;
  isGroupRoom?: boolean;
  isBotRoom?: boolean;
}

export interface ContextGaugeUsage {
  used: number;
  max: number;
  percent: number;
}

/** @Agent 旁路呼叫胶囊：BTW 只读外援与子代理委派共用的独立渲染域，严禁混入主消息流 */
export interface SideAgentCapsuleView {
  id: string;
  kind: 'btw' | 'delegation';
  profile: string;
  question: string;
  answer?: string;
  status: 'pending' | 'done' | 'failed' | 'expired';
  notice?: string;
}

export interface MiddlePodProps {
  gatewayConnected: boolean;
  gatewayConnecting?: boolean;
  gatewayUrl?: string;
  username?: string;
  password?: string;
  profileName?: string;
  messages: MessageViewModel[];
  testStatus?: { ok?: boolean; message?: string; latency?: number };
  dockHtml?: string;
  hasOlderMessages?: boolean;
  isLoadingOlder?: boolean;
  contextUsage?: ContextGaugeUsage;
  isStreaming?: boolean;
  sideAgentCapsules?: SideAgentCapsuleView[];
}

export function renderContextGauge(usage?: ContextGaugeUsage): string {
  if (!usage || !usage.max || usage.max <= 0) return '';
  const percent = Math.min(100, Math.max(0, Math.round(usage.percent ?? (usage.used / usage.max) * 100)));
  const formatTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(0)}k` : `${n}`);

  // 色阶计算：<70% 暗银灰，70-90% 琥珀暖金，>90% 高对比高亮
  let colorVar = 'var(--text-muted)';
  let bgVar = 'var(--bg-panel)';
  if (percent >= 90) {
    colorVar = 'var(--text-main)';
    bgVar = 'var(--bg-card-active)';
  } else if (percent >= 70) {
    colorVar = 'var(--accent)';
    bgVar = 'var(--accent-subtle)';
  }

  return `
    <div class="context-gauge-badge" title="${t('chat.contextGauge')}: ${usage.used} / ${usage.max} (${percent}%)" style="
      position: absolute;
      top: 10px;
      right: 18px;
      z-index: 10;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 9px;
      background: ${bgVar};
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      font-size: 10.5px;
      font-family: var(--font-mono);
      color: ${colorVar};
      user-select: none;
      backdrop-filter: blur(8px);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    ">
      <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${colorVar};"></span>
      <span>${formatTokens(usage.used)} / ${formatTokens(usage.max)}</span>
      <span style="opacity: 0.8;">(${percent}%)</span>
    </div>
  `;
}

/**
 * 对话画布：只负责三态骨架 + React 消息宿主。
 *
 * 【设计意图 (Why)】
 *   消息行已 100% 由 React 组件渲染，这里不再拼任何消息 HTML。
 *   模板只保留「连接中 / 未连接 / 空态」三种骨架状态，是同构外壳而不是第二套消息实现。
 *
 * 【约束与规则 (Rules)】
 *   1. 有消息时只输出 #react-message-list-host，消息内容由 mountMessageList 注入；
 *   2. 禁止在此函数内新增消息行渲染逻辑，否则又会分裂出第二套结构。
 */
export function renderConversationCanvas(props: MiddlePodProps): string {
  if (props.gatewayConnecting) {
    return `
      <div class="content-fluid-canvas conv-canvas" data-conv-layer="canvas">
        ${renderContextGauge(props.contextUsage)}
        <div style="max-width: 480px; margin: 120px auto 0; text-align: center; color: var(--text-muted); font-size: var(--text-meta); display: flex; flex-direction: column; align-items: center; gap: 10px;">
          <span style="font-size: 20px; animation: pulse 1.5s infinite;">⚡</span>
          <span>${t('conversation.connecting')}</span>
        </div>
      </div>
    `;
  }

  if (!props.gatewayConnected) {
    return `
      <div class="content-fluid-canvas conv-canvas" data-conv-layer="canvas">
        ${renderContextGauge(props.contextUsage)}
        ${renderGatewayOnboarding(props)}
      </div>
    `;
  }

  if (props.messages.length === 0) {
    return `
      <div class="content-fluid-canvas conv-canvas" data-conv-layer="canvas">
        ${renderContextGauge(props.contextUsage)}
        ${renderWelcomeEmptyState()}
      </div>
    `;
  }

  return `
    <div class="content-fluid-canvas conv-canvas" data-conv-layer="canvas">
      ${renderContextGauge(props.contextUsage)}
      <div id="react-message-list-host" style="display:contents"></div>
      ${(props.sideAgentCapsules || []).map(renderSideAgentCapsule).join('')}
    </div>
  `;
}

/**
 * @Agent 旁路胶囊（BTW 只读外援 / 子代理委派）。
 * 【约束与规则 (Rules)】胶囊内容绝不进入主消息流数据域，仅独立状态渲染，防上下文毒化。
 */
export function renderSideAgentCapsule(capsule: SideAgentCapsuleView): string {
  const statusTone =
    capsule.status === 'done' ? 'var(--success)' : capsule.status === 'failed' || capsule.status === 'expired' ? 'var(--text-muted)' : 'var(--accent)';
  const statusText =
    capsule.status === 'pending'
      ? t('capsule.pending')
      : capsule.status === 'done'
        ? t('capsule.done')
        : capsule.status === 'failed'
          ? t('capsule.failed')
          : t('capsule.expired');
  return `
    <div class="side-agent-capsule" data-capsule-id="${capsule.id}" data-capsule-status="${capsule.status}" style="
      align-self: flex-start;
      max-width: 560px;
      margin-top: 6px;
      padding: 8px 12px;
      background: var(--bg-panel);
      border: 1px solid var(--border-medium);
      border-left: 3px solid ${statusTone};
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    ">
      <div style="display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-muted);">
        <strong style="color: var(--text-main); font-size: 11.5px;">@${escapeHtml(capsule.profile)}</strong>
        <span style="padding: 1px 6px; background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border-subtle);">${capsule.kind === 'btw' ? t('capsule.btwTag') : t('capsule.delegationTag')}</span>
        <span style="margin-left: auto; color: ${statusTone};">${statusText}</span>
      </div>
      ${capsule.question ? `<div style="font-size: 11.5px; color: var(--text-muted);">“${escapeHtml(capsule.question)}”</div>` : ''}
      ${capsule.answer ? `<div class="capsule-answer prose-block" style="font-size: 12.5px; color: var(--text-main);">${renderMarkdown(capsule.answer)}</div>` : ''}
      ${capsule.notice ? `<div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(capsule.notice)}</div>` : ''}
    </div>
  `;
}

export function renderMiddlePod(props: MiddlePodProps): string {
  return `
    <main class="flux-middle-pod conversation-pod" data-conv-layer="stage">
      <!-- Conversation Scroll Stream (100% Full-bleed width) -->
      <div id="conversation-stream" class="messages-stream-area conv-stream" data-conv-layer="stream">
        ${renderConversationCanvas(props)}
      </div>

      <!-- Dock Scrim Fade (Bottom gradient to prevent card collision) -->
      <div class="dock-scrim-fade conv-dock-scrim" data-conv-layer="scrim"></div>

      <!-- Centered Input Dock mounted strictly inside the conversation pod -->
      ${props.dockHtml || ''}
    </main>
  `;
}

function renderGatewayOnboarding(props: MiddlePodProps): string {
  return `
    <div class="gateway-onboarding-card" style="
      max-width: 600px;
      margin: 40px auto 0;
      background: var(--bg-card);
      border: 1px solid var(--border-medium);
      border-radius: 16px;
      padding: 32px;
      box-shadow: var(--shadow-window);
      display: flex;
      flex-direction: column;
      gap: 20px;
    ">
      <!-- Header -->
      <div style="display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px;">
        <div style="
          width: 52px;
          height: 52px;
          border-radius: 14px;
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          color: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 4px;
          box-shadow: 0 0 20px var(--accent-glow);
        ">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>
        <h2 style="font-size: 19px; font-weight: 700; color: var(--text-main); margin: 0; letter-spacing: -0.01em;">连接至 Hermes Gateway</h2>
        <p style="font-size: 12.5px; color: var(--text-secondary); margin: 0; line-height: 1.55; max-width: 440px;">
          接入本地守护进程或远程云端的 Hermes 网关，开启真实的自主 Agent 会话、流式推理与工业级工具流。
        </p>
      </div>

      <!-- Form Inputs -->
      <div style="display: flex; flex-direction: column; gap: 14px;">
        <!-- Gateway URL -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <label style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary);">网关连接地址 (Gateway URL)</label>
            <span style="font-size: 10.5px; color: var(--text-muted); font-family: var(--font-mono);">${t('gateway.urlHint')}</span>
          </div>
          <input type="text" id="onboarding-gateway-url" value="${escapeHtml(props.gatewayUrl || '')}" placeholder="${t('gateway.urlPlaceholder')}" style="
            width: 100%;
            height: 38px;
            background: var(--bg-panel);
            border: 1px solid var(--border-medium);
            border-radius: 8px;
            padding: 0 12px;
            font-size: 12.5px;
            font-family: var(--font-mono);
            color: var(--text-main);
            outline: none;
            box-sizing: border-box;
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
          "/>
        </div>

        <!-- Gateway Auth: Username & Password -->
        <div id="onboarding-section-dashboard" style="display: flex; flex-direction: column; gap: 10px;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <label style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary);">用户名 (Username)</label>
              <input type="text" id="onboarding-username" value="${escapeHtml(props.username || '')}" placeholder="免密网关可留空" style="
                width: 100%;
                height: 36px;
                background: var(--bg-panel);
                border: 1px solid var(--border-medium);
                border-radius: 8px;
                padding: 0 12px;
                font-size: 12px;
                font-family: var(--font-mono);
                color: var(--text-main);
                outline: none;
                box-sizing: border-box;
              "/>
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <label style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary);">登录密码 (Password)</label>
              <input type="password" id="onboarding-password" value="${escapeHtml(props.password || '')}" placeholder="免密网关可留空" style="
                width: 100%;
                height: 36px;
                background: var(--bg-panel);
                border: 1px solid var(--border-medium);
                border-radius: 8px;
                padding: 0 12px;
                font-size: 12px;
                font-family: var(--font-mono);
                color: var(--text-main);
                outline: none;
                box-sizing: border-box;
              "/>
            </div>
          </div>
        </div>

      </div>

      <!-- Test Status Feedback -->
      <div id="onboarding-test-feedback" style="
        display: ${props.testStatus ? 'flex' : 'none'};
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 8px;
        background: color-mix(in oklab, ${props.testStatus?.ok ? 'var(--success)' : 'var(--destructive)'} 12%, transparent);
        border: 1px solid color-mix(in oklab, ${props.testStatus?.ok ? 'var(--success)' : 'var(--destructive)'} 30%, transparent);
        color: ${props.testStatus?.ok ? 'var(--success)' : 'var(--destructive)'};
        font-size: 12px;
      ">
        <span>${props.testStatus?.ok ? '✓' : '✕'}</span>
        <span>${escapeHtml(props.testStatus?.message || '')}</span>
      </div>

      <!-- Action Buttons -->
      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 6px;">
        <button id="btn-test-connection" style="
          height: 36px;
          padding: 0 16px;
          border-radius: 8px;
          background: var(--bg-panel);
          border: 1px solid var(--border-medium);
          color: var(--text-main);
          font-size: 12.5px;
          font-weight: 500;
          cursor: pointer;
        ">连通性测试</button>

        <button id="btn-save-and-connect" style="
          height: 36px;
          padding: 0 20px;
          border-radius: 8px;
          background: var(--accent);
          border: none;
          color: var(--theme-thumb-color, #090A0F);
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 1px 8px var(--accent-glow);
        ">${props.gatewayConnecting ? '正在连接...' : '保存并连接 ↗'}</button>
      </div>
    </div>
  `;
}

function renderWelcomeEmptyState(): string {
  return `
    <div style="
      max-width: 560px;
      margin: 80px auto 0;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      color: var(--text-muted);
    ">
      <div style="
        width: 58px;
        height: 58px;
        border-radius: 16px;
        background: var(--bg-card);
        border: 1px solid var(--border-medium);
        color: var(--accent);
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: var(--shadow-card);
      ">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      </div>
      <h3 style="font-size: 17px; font-weight: 700; color: var(--text-main); margin: 0; letter-spacing: -0.01em;">Hermes Flux 工作台已就绪</h3>
      <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin: 0; max-width: 480px;">
        在下方 740px 黄金限宽输入舱下达任务，按 Enter 发送。Hermes 将自主规划多步骤推理、调用工具链并流式呈现。
      </p>
    </div>
  `;
}

// Normalize and extract inline JSON tool payloads from raw message text (when raw LLM returns JSON tool execution payload directly)
function extractToolsFromContent(content: string): { cleanContent: string; extractedTools: MessageViewModel['toolCalls'] } {
  if (!content) return { cleanContent: '', extractedTools: [] };
  const trimmed = content.trim();

  // Strict check: only unwrap if it is unambiguously an execution result payload
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        ('output' in parsed || 'stdout' in parsed || 'exit_code' in parsed || ('diff' in parsed && 'resolved_path' in parsed))
      ) {
        let toolName = 'Shell Command';
        let cleanArgs = '';
        if ('diff' in parsed) {
          toolName = 'Edit File';
          cleanArgs = typeof parsed.resolved_path === 'string' ? parsed.resolved_path : '';
        }

        let out = parsed.output ?? parsed.stdout ?? parsed.diff ?? trimmed;
        if (typeof out !== 'string') out = JSON.stringify(out, null, 2);

        return {
          cleanContent: '',
          extractedTools: [
            {
              id: `tc-extracted-${Date.now()}`,
              name: toolName,
              status: 'completed',
              args: cleanArgs,
              output: out,
            },
          ],
        };
      }
    // gate-degrade: 工具参数解析失败时保留原始文本展示，不影响消息渲染
    } catch {}
  }

  return { cleanContent: content, extractedTools: [] };
}

export function getCleanReasoningSummary(text: string): string {
  if (!text) return '';
  const flat = text
    .replace(/```[\w]*\n?([\s\S]*?)```/g, (_, inner: string) => inner.trim())
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= 80) return flat;
  const cut = flat.lastIndexOf(' ', 80);
  const end = cut > 0 ? cut : 80;
  return `${flat.substring(0, end).trimEnd()}…`;
}

function calculateDiffStats(diffText: string): { adds: number; dels: number } | null {
  if (!diffText || !diffText.includes('\n')) return null;
  let adds = 0;
  let dels = 0;
  const lines = diffText.split('\n');
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) adds++;
    else if (line.startsWith('-') && !line.startsWith('---')) dels++;
  }
  if (adds === 0 && dels === 0) return null;
  return { adds, dels };
}





/**
 * 工具胶囊增量插槽渲染器（供流式期间局部 DOM 直写复用）。
 *
 * 【设计意图 (Why)】
 *   流式期间不推 React 快照（否则每 token 重渲染会掉帧），工具区改由本函数产出 HTML 直写。
 *   但它渲染的内容必须与全量 React 路径完全同构，否则流式时一套外观、收敛后又变一套。
 *   因此这里直接复用 ToolBlocks 组件做服务端静态渲染，而不是手写第二份字符串模板。
 *
 * 【防范的历史坑 (Pitfall)】
 *   旧实现手写 `timeline-row tool-row` 旧结构，与 React 的 `.conv-*` 完全不同，
 *   流式结束瞬间会整体换脸。
 *
 * 【约束与规则 (Rules)】
 *   1. 返回值是 #msg-tools-<id> 容器的 innerHTML，禁止包含外层锚点自身；
 *   2. 无工具时严格返回空字符串，避免污染锚点；
 *   3. 纯函数，无副作用。
 */
export function renderToolCapsuleSlot(m: MessageViewModel): string {
  const { extractedTools } = extractToolsFromContent(m.content);
  const combined = [...(m.toolCalls || []), ...(extractedTools || [])];
  if (combined.length === 0) return '';
  const tools = combined.map((tool) => ({
    id: tool.id,
    name: tool.name,
    status: tool.status,
    args: tool.args,
    output: tool.output,
    durationMs: tool.durationMs,
    startedAt: tool.startTime,
  }));
  return renderToStaticMarkup(React.createElement(ToolBlocks, { tools }));
}


export { escapeHtml };

const COMMON_FILE_EXTENSIONS = new Set([
  'html', 'htm', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp',
  'md', 'markdown', 'txt', 'log', 'pdf', 'csv',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'yaml', 'yml', 'toml', 'xml',
  'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'sh', 'bash', 'zsh', 'ps1',
  'css', 'scss', 'sass', 'less', 'sql', 'diff', 'patch', 'env', 'dockerfile', 'lock'
]);

/**
 * 校验目标字符串是否具备文件路径特征
 */
export function isLikelyFilePath(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  const trimmed = str.trim();
  if (trimmed.length < 2 || trimmed.length > 500 || /\s/.test(trimmed)) return false;
  if (trimmed.startsWith('-')) return false;

  // 1. Unix / Linux 绝对路径 (以 / 开头且至少含两层路径或常见目录)
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && (trimmed.includes('/', 1) || COMMON_FILE_EXTENSIONS.has((trimmed.split('.').pop() || '').toLowerCase()))) {
    return true;
  }

  // 2. Windows 绝对路径 (以 盘符: 开头)
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return true;
  }

  // 3. 显式相对路径
  if (trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('.\\') || trimmed.startsWith('..\\')) {
    return true;
  }

  // 4. 提取扩展名并比对
  const extMatch = trimmed.match(/\.([a-zA-Z0-9_-]+)$/);
  if (extMatch) {
    const ext = extMatch[1].toLowerCase();
    if (COMMON_FILE_EXTENSIONS.has(ext)) {
      return true;
    }
  }

  // 5. 常见源码目录结构
  if (/^(src|docs|packages|app|lib|components|utils|tests?|scripts)\//.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * 校验目标字符串是否为完整的 HTTP/HTTPS 链接
 */
export function isLikelyHttpUrl(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  const trimmed = str.trim();
  return /^https?:\/\/[^\s"'`<>]+$/i.test(trimmed);
}

export function formatInlineCodeOrLink(escapedContent: string): string {
  return formatInlineCodeOrLinkLib(escapedContent);
}

export function highlightCodeSyntax(code: string): string {
  return highlightCodeSyntaxLib(code);
}

export function renderMarkdown(md: string, options?: RenderMarkdownOptions): string {
  return renderMarkdownCore(md, options);
}
