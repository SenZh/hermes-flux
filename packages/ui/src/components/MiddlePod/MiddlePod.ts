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

export interface MessageViewModel {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thought?: string;
  thoughtDurationMs?: number;
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
}

export function renderConversationCanvas(props: MiddlePodProps): string {
  const agentDisplayName = (props.profileName || 'default').toUpperCase();

  return `
    <div class="content-fluid-canvas" style="width: 100%; max-width: 100%; margin: 0; display: flex; flex-direction: column; gap: 14px;">
      ${
        props.gatewayConnecting
          ? `<div style="max-width: 480px; margin: 120px auto 0; text-align: center; color: var(--text-muted); font-size: 13px; display: flex; flex-direction: column; align-items: center; gap: 10px;">
              <span style="font-size: 20px; animation: pulse 1.5s infinite;">⚡</span>
              <span>正在连接 Hermes 网关...</span>
            </div>`
          : !props.gatewayConnected
          ? renderGatewayOnboarding(props)
          : props.messages.length === 0
          ? renderWelcomeEmptyState()
          : `
            ${
              props.hasOlderMessages
                ? `<div class="older-history-indicator" style="text-align: center; padding: 6px; font-size: 11px; color: var(--text-muted); opacity: 0.75; font-family: var(--font-mono);">
                    ${props.isLoadingOlder ? '正在加载更早历史...' : '↑ 向上滚动查看更早历史'}
                   </div>`
                : ''
            }
            ${props.messages
              .map((m, idx, arr) => {
                const prev = arr[idx - 1];
                const next = arr[idx + 1];
                const isFirstInTurn = !prev || prev.role !== m.role;
                const isLastInTurn = !next || next.role !== m.role;
                return renderMessage(m, agentDisplayName, { isFirstInTurn, isLastInTurn });
              })
              .join('')}
          `
      }
    </div>
  `;
}

export function renderMiddlePod(props: MiddlePodProps): string {
  return `
    <main class="flux-middle-pod conversation-pod" style="
      flex: 1 1 0%;
      min-width: 0;
      height: 100%;
      position: relative;
      display: flex;
      flex-direction: column;
      background: var(--bg-window);
      overflow: hidden;
      width: 100%;
    ">
      <!-- Conversation Scroll Stream (100% Full-bleed width) -->
      <div id="conversation-stream" class="messages-stream-area" style="
        flex: 1;
        width: 100%;
        overflow-y: auto;
        overflow-x: hidden;
        display: flex;
        flex-direction: column;
        padding: 24px 32px 180px;
        box-sizing: border-box;
      ">
        ${renderConversationCanvas(props)}
      </div>

      <!-- Dock Scrim Fade (Bottom gradient to prevent card collision) -->
      <div class="dock-scrim-fade" style="
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 120px;
        background: linear-gradient(to top, var(--bg-window) 30%, transparent 100%);
        pointer-events: none;
        z-index: 30;
      "></div>

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
            <span style="font-size: 10.5px; color: var(--text-muted); font-family: var(--font-mono);">支持 9119 / 8642 / 反代域名</span>
          </div>
          <input type="text" id="onboarding-gateway-url" value="${escapeHtml(props.gatewayUrl || 'http://127.0.0.1:9119')}" placeholder="http://127.0.0.1:9119 或 https://..." style="
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

        <!-- Gateway 9119 Auth: Username & Password -->
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
        background: ${props.testStatus?.ok ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)'};
        border: 1px solid ${props.testStatus?.ok ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'};
        color: ${props.testStatus?.ok ? '#10B981' : '#EF4444'};
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
    } catch {}
  }

  return { cleanContent: content, extractedTools: [] };
}

export function renderMessage(
  m: MessageViewModel,
  _agentDisplayName = 'HERMES AGENT',
  options: { isFirstInTurn?: boolean; isLastInTurn?: boolean } = {}
): string {
  const isUser = m.role === 'user';
  const isFirstInTurn = options.isFirstInTurn ?? true;
  const isLastInTurn = options.isLastInTurn ?? true;

  if (isUser) {
    return `
      <div class="message-row user-row" data-msg-id="${m.id}" style="display: flex; flex-direction: column; align-items: flex-end; width: 100%; margin: 6px 0;">
        ${
          m.timestamp
            ? `<span style="font-size: 10.5px; color: var(--text-muted); font-family: var(--font-mono); margin-bottom: 4px; padding-right: 4px;">${escapeHtml(m.timestamp)}</span>`
            : ''
        }
        <div class="user-bubble" style="
          max-width: 85%;
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: 14px 14px 3px 14px;
          padding: 12px 18px;
          color: var(--text-main);
          font-size: 13.5px;
          line-height: 1.6;
          box-shadow: var(--shadow-card);
          word-break: break-word;
        ">
          ${escapeHtml(m.content)}
        </div>
      </div>
    `;
  }

  // Pre-process inline json tool dumps
  const { cleanContent, extractedTools } = extractToolsFromContent(m.content);
  const combinedTools = [...(m.toolCalls || []), ...(extractedTools || [])];
  const virtualMsg = { ...m, toolCalls: combinedTools };

  return `
    <div class="message-row assistant-row" data-id="${m.id}" data-msg-id="${m.id}" style="
      display: flex;
      flex-direction: column;
      gap: 3px;
      width: 100%;
      margin: 1px 0;
    ">
      <!-- Turn Header Time -->
      ${
        isFirstInTurn && m.timestamp
          ? `
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
          <span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); opacity: 0.85;">${escapeHtml(m.timestamp)}</span>
        </div>
      `
          : ''
      }

      <!-- Thinking Fold -->
      ${renderThinkingFold(m)}

      <!-- Tool Execution Capsules -->
      ${renderToolCapsules(virtualMsg)}

      <!-- Core Content (Incremental Anchor) -->
      ${
        cleanContent && cleanContent.trim()
          ? `
        <div id="msg-content-${m.id}" class="assistant-content prose-block" style="
          color: var(--text-main);
          font-size: 13.5px;
          line-height: 1.6;
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 4px;
        ">
          ${renderMarkdown(cleanContent)}
        </div>
      `
          : `
        <div id="msg-content-${m.id}" class="assistant-content prose-block" style="
          color: var(--text-main);
          font-size: 13.5px;
          line-height: 1.6;
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 2px;
        "></div>
      `
      }

      <!-- Turn Footer -->
      ${
        !isFirstInTurn && isLastInTurn && m.timestamp && cleanContent && cleanContent.trim()
          ? `
        <div style="display: flex; justify-content: flex-end; margin-top: 2px;">
          <span style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono); opacity: 0.65;">${escapeHtml(m.timestamp)}</span>
        </div>
      `
          : ''
      }
    </div>
  `;
}

function renderThinkingFold(m: MessageViewModel): string {
  const hasThought = Boolean(m.thought && m.thought.trim());
  const summary = getCleanReasoningSummary(m.thought || '');
  const durationBadge = m.thoughtDurationMs
    ? `<span style="font-size: 12px; color: #6B7280; font-family: var(--font-mono); flex-shrink: 0;">${(m.thoughtDurationMs / 1000).toFixed(1)}s</span>`
    : '';

  return `
    <details class="timeline-row thinking-row" ${hasThought ? '' : 'style="display: none;"'} style="margin: 2px 0;">
      <summary style="
        list-style: none;
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 3px 0;
        cursor: pointer;
        user-select: none;
        font-size: 13px;
        line-height: 1.5;
      ">
        <span style="color: #9CA3AF; display: inline-flex; align-items: center; flex-shrink: 0;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
          </svg>
        </span>
        <span style="font-weight: 500; color: #D1D5DB; flex-shrink: 0;">推理</span>
        ${durationBadge}
        <span style="color: #9CA3AF; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
          ${escapeHtml(summary)}
        </span>
      </summary>
      <div id="msg-thought-${m.id}" style="
        margin-left: 7px;
        margin-top: 4px;
        margin-bottom: 6px;
        padding-left: 14px;
        border-left: 2px solid rgba(255, 255, 255, 0.08);
        color: #9CA3AF;
        font-size: 12.5px;
        line-height: 1.62;
        white-space: pre-wrap;
        word-break: break-word;
      ">${escapeHtml(m.thought || '')}</div>
    </details>
  `;
}

export function getCleanReasoningSummary(text: string): string {
  if (!text) return '';
  const clean = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[#*_\->]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= 75) return clean;
  return `${clean.substring(0, 75).trimEnd()}…`;
}

function getFileBadge(pathStr: string): string {
  const match = pathStr.match(/\.([a-zA-Z0-9]+)(?:$|[?#:])/);
  if (!match) return '';
  const ext = match[1].toLowerCase();
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') {
    return `<span style="background: #EAB308; color: #000; font-size: 9px; font-weight: 700; padding: 1px 3.5px; border-radius: 3px; font-family: var(--font-mono); line-height: 1.1; flex-shrink: 0;">JS</span>`;
  }
  if (ext === 'ts' || ext === 'mts' || ext === 'cts' || ext === 'tsx') {
    return `<span style="background: #3B82F6; color: #fff; font-size: 9px; font-weight: 700; padding: 1px 3.5px; border-radius: 3px; font-family: var(--font-mono); line-height: 1.1; flex-shrink: 0;">TS</span>`;
  }
  if (ext === 'py') {
    return `<span style="background: #38BDF8; color: #000; font-size: 9px; font-weight: 700; padding: 1px 3.5px; border-radius: 3px; font-family: var(--font-mono); line-height: 1.1; flex-shrink: 0;">PY</span>`;
  }
  if (ext === 'json') {
    return `<span style="background: #F59E0B; color: #000; font-size: 9px; font-weight: 700; padding: 1px 3.5px; border-radius: 3px; font-family: var(--font-mono); line-height: 1.1; flex-shrink: 0;">JSON</span>`;
  }
  if (ext === 'md') {
    return `<span style="background: #6B7280; color: #fff; font-size: 9px; font-weight: 700; padding: 1px 3.5px; border-radius: 3px; font-family: var(--font-mono); line-height: 1.1; flex-shrink: 0;">MD</span>`;
  }
  return '';
}

function buildWritePreviewPatch(filePath: string | undefined, content: string): string | undefined {
  const normalizedContent = content.replace(/\r\n/g, '\n');
  if (!normalizedContent.trim()) {
    return undefined;
  }

  const normalizedPath = (() => {
    const candidate = (filePath ?? '').trim();
    if (!candidate) {
      return 'new-file';
    }
    return candidate.startsWith('/') ? candidate.slice(1) : candidate;
  })();

  const lines = normalizedContent.split('\n');
  const hunkSize = lines.length;
  const body = lines.map((line) => `+${line}`).join('\n');

  return [
    '--- /dev/null',
    `+++ b/${normalizedPath}`,
    `@@ -0,0 +1,${hunkSize} @@`,
    body,
  ].join('\n');
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

interface ParsedToolItem {
  id: string;
  name: string;
  displayName: string;
  iconSvg: string;
  status: 'running' | 'completed' | 'failed';
  startTime?: number;
  cleanArgs: string;
  targetPath: string;
  fileBadge: string;
  durationStr: string;
  norm: { text: string; isEmpty: boolean; isDiff: boolean; extractedCommand?: string; extractedPath?: string };
  diffStats: { adds: number; dels: number } | null;
  canExpand: boolean;
  isFileTool: boolean;
  isReadOnly: boolean;
}

function parseToolItem(tc: NonNullable<MessageViewModel['toolCalls']>[0]): ParsedToolItem {
  const rawName = String(tc.name || '').toLowerCase();
  let displayName = 'Tool Call';
  let iconSvg = '';
  let isFileTool = false;
  let isReadOnly = false;

  // 1. Shell & terminal tools
  if (rawName.includes('shell') || rawName.includes('bash') || rawName.includes('cmd') || rawName.includes('terminal')) {
    displayName = 'Shell Command';
    iconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;
  }
  // 2. Write & edit tools MUST take precedence before generic 'file' match to prevent write_file from being miscategorized as read-only!
  else if (rawName.includes('write')) {
    displayName = 'Write File';
    isFileTool = true;
    isReadOnly = false;
    iconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="16" y2="18"/></svg>`;
  } else if (rawName.includes('edit') || rawName.includes('patch')) {
    displayName = 'Edit File';
    isFileTool = true;
    isReadOnly = false;
    iconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
  }
  // 3. Read & search read-only tools
  else if (rawName.includes('read') || rawName.includes('cat') || rawName === 'file') {
    displayName = 'Read File';
    isFileTool = true;
    isReadOnly = true;
    iconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
  } else if (rawName.includes('grep') || rawName.includes('search')) {
    displayName = 'Search Files';
    isReadOnly = true;
    iconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  } else if (rawName.includes('glob') || rawName.includes('find')) {
    displayName = 'Find Files';
    isReadOnly = true;
    iconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  } else if (rawName.includes('subagent') || rawName.includes('agent')) {
    displayName = 'Agent Task';
    iconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="1.5"/><circle cx="15" cy="9" r="1.5"/><path d="M8 15h8"/></svg>`;
  } else {
    displayName = tc.name || 'Tool';
    iconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
  }

  // Defensive arguments parsing: extract target command or file path
  let cleanArgs = '';
  let targetPath = '';
  let writeContent = '';

  if (typeof tc.args === 'string') {
    cleanArgs = tc.args.trim();
    if (cleanArgs.startsWith('{') && cleanArgs.endsWith('}')) {
      try {
        const parsed = JSON.parse(cleanArgs);
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.path === 'string') targetPath = parsed.path;
          else if (typeof parsed.file === 'string') targetPath = parsed.file;
          else if (typeof parsed.filePath === 'string') targetPath = parsed.filePath;
          else if (typeof parsed.file_path === 'string') targetPath = parsed.file_path;
          else if (typeof parsed.resolved_path === 'string') targetPath = parsed.resolved_path;
          else if (Array.isArray(parsed.files_modified) && typeof parsed.files_modified[0] === 'string') targetPath = parsed.files_modified[0];

          if (typeof parsed.content === 'string') {
            writeContent = parsed.content;
          }

          const candidate = parsed.command ?? parsed.cmd ?? parsed.query ?? parsed.pattern ?? parsed.path ?? parsed.file ?? parsed.filePath ?? parsed.file_path ?? parsed.resolved_path ?? parsed.description ?? parsed.prompt;
          if (typeof candidate === 'string') {
            cleanArgs = candidate;
          } else if (candidate !== undefined) {
            cleanArgs = JSON.stringify(candidate);
          }
        }
      } catch {
        // keep raw string
      }
    }
  } else if (tc.args != null && typeof tc.args === 'object') {
    const parsed = tc.args as Record<string, unknown>;
    if (typeof parsed.path === 'string') targetPath = parsed.path;
    else if (typeof parsed.file === 'string') targetPath = parsed.file;
    else if (typeof parsed.filePath === 'string') targetPath = parsed.filePath;
    else if (typeof parsed.file_path === 'string') targetPath = parsed.file_path;
    else if (typeof parsed.resolved_path === 'string') targetPath = parsed.resolved_path;
    else if (Array.isArray(parsed.files_modified) && typeof parsed.files_modified[0] === 'string') targetPath = parsed.files_modified[0];

    if (typeof parsed.content === 'string') {
      writeContent = parsed.content;
    }

    const candidate = parsed.command ?? parsed.cmd ?? parsed.query ?? parsed.pattern ?? parsed.path ?? parsed.file ?? parsed.filePath ?? parsed.file_path ?? parsed.resolved_path ?? parsed.description ?? parsed.prompt;
    if (typeof candidate === 'string') {
      cleanArgs = candidate;
    } else if (candidate !== undefined) {
      cleanArgs = JSON.stringify(candidate);
    } else {
      cleanArgs = JSON.stringify(tc.args);
    }
  } else if (tc.args != null) {
    cleanArgs = String(tc.args);
  }

  // If write tool and has written content, synthesize OpenChamber new-file diff patch for visual rendering
  let synthesizedWritePatch = '';
  if (displayName === 'Write File' && writeContent) {
    synthesizedWritePatch = buildWritePreviewPatch(targetPath, writeContent) || '';
  }

  const norm = normalizeToolOutput(tc.output, displayName === 'Write File');
  if (!cleanArgs && norm.extractedCommand) cleanArgs = norm.extractedCommand;
  if (!targetPath && norm.extractedPath) {
    targetPath = norm.extractedPath;
    if (!cleanArgs) cleanArgs = targetPath;
  }

  // If path was resolved from output or args, keep cleanArgs matching targetPath for file tools
  if (isFileTool && targetPath && !cleanArgs) {
    cleanArgs = targetPath;
  }

  const fileBadge = getFileBadge(cleanArgs || targetPath);
  const effectiveOutput = synthesizedWritePatch ? synthesizedWritePatch : norm.text;
  const isDiff = synthesizedWritePatch ? true : norm.isDiff;
  const diffStats = isDiff ? calculateDiffStats(effectiveOutput) : null;
  // Always expandable if has output OR has non-trivial args/command
  const hasDetails = Boolean(effectiveOutput || (cleanArgs && cleanArgs !== '{}'));
  const canExpand = Boolean(hasDetails);

  const durationStr = tc.durationMs
    ? `${(tc.durationMs / 1000).toFixed(1)}s`
    : tc.startTime
    ? `${Math.max(0.1, (Date.now() - tc.startTime) / 1000).toFixed(1)}s`
    : tc.status === 'running'
    ? 'running...'
    : '';

  return {
    id: tc.id,
    name: tc.name,
    displayName,
    iconSvg,
    status: tc.status,
    startTime: tc.startTime,
    cleanArgs,
    targetPath,
    fileBadge,
    durationStr,
    norm: {
      text: effectiveOutput,
      isEmpty: !effectiveOutput,
      isDiff,
      extractedCommand: norm.extractedCommand,
      extractedPath: norm.extractedPath,
    },
    diffStats,
    canExpand,
    isFileTool,
    isReadOnly,
  };
}

function renderPathLikeGitChanges(filePath: string, isToolLink = true): string {
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash === -1) {
    const linkAttr = isToolLink ? `class="tool-file-link" data-preview-file="${escapeHtml(normalized)}" title="点击在右侧检查舱预览文件"` : '';
    return `<span ${linkAttr} style="font-family: var(--font-mono); font-size: 11.5px; font-weight: 500; color: var(--text-main); cursor: pointer; text-decoration: underline; text-decoration-color: var(--border-medium); text-underline-offset: 2px;">${escapeHtml(normalized)}</span>`;
  }

  const dir = normalized.slice(0, lastSlash);
  const fileName = normalized.slice(lastSlash + 1);
  const linkAttr = isToolLink ? `class="tool-file-link" data-preview-file="${escapeHtml(normalized)}" title="点击在右侧检查舱预览: ${escapeHtml(normalized)}"` : '';

  return `
    <span ${linkAttr} style="display: inline-flex; align-items: baseline; min-width: 0; max-width: 100%; overflow: hidden; font-family: var(--font-mono); font-size: 11.5px; cursor: pointer; text-decoration: underline; text-decoration-color: var(--border-medium); text-underline-offset: 2px;">
      <span style="color: var(--text-muted); opacity: 0.75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left;">${escapeHtml(dir)}</span>
      <span style="color: var(--text-muted); opacity: 0.75; flex-shrink: 0; margin: 0 1px;">/</span>
      <span style="color: var(--text-main); font-weight: 500; flex-shrink: 0;">${escapeHtml(fileName)}</span>
    </span>
  `;
}

function renderSingleToolCapsule(parsed: ParsedToolItem): string {
  const { displayName, iconSvg, durationStr, fileBadge, cleanArgs, targetPath, diffStats, canExpand, isFileTool, isReadOnly, norm } = parsed;

  const rawDisplay = cleanArgs && cleanArgs !== '{}' ? cleanArgs : '';
  const firstLine = rawDisplay ? rawDisplay.split('\n')[0].trim() : '';
  const isCommand = !isFileTool && firstLine;
  // OpenChamber MAX_COMMAND_LENGTH = 100
  const truncatedCommand = isCommand && firstLine.length > 95 ? `${firstLine.slice(0, 95)}…` : firstLine;

  const detailBodyHtml = renderToolOutputBody(norm.text, norm.isDiff);

  // In OpenChamber: read tools are static compact single-line, not expandable details
  const isStaticCompact = isReadOnly || !canExpand;

  const effectivePath = targetPath || (isFileTool ? rawDisplay : '');

  if (isStaticCompact) {
    return `
      <div class="timeline-row tool-row tool-capsule flux-tool-capsule" style="
        margin: 1.5px 0;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 6px;
        background: var(--bg-panel);
        border: 1px solid var(--border-subtle);
        border-radius: 6px;
        font-size: 12px;
        line-height: 1.45;
        color: var(--text-secondary);
      ">
        <span class="tool-chevron" style="display: inline-flex; align-items: center; justify-content: center; width: 12px; font-size: 9px; color: var(--text-muted); opacity: 0.5; flex-shrink: 0;">
          •
        </span>
        <span style="color: var(--text-secondary); display: inline-flex; align-items: center; flex-shrink: 0; opacity: 0.85;">
          ${iconSvg}
        </span>
        <span style="font-weight: 500; color: var(--text-main); flex-shrink: 0;">${displayName}</span>
        ${
          durationStr
            ? `<span class="tool-duration-badge" ${parsed.status === 'running' && parsed.status && parsed.startTime ? `data-start-time="${parsed.startTime}"` : ''} style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); flex-shrink: 0; opacity: 0.75;">${escapeHtml(durationStr)}</span>`
            : ''
        }
        ${fileBadge}
        ${
          effectivePath && isFileTool
            ? renderPathLikeGitChanges(effectivePath, true)
            : rawDisplay
            ? `<span style="color: var(--text-muted); font-family: var(--font-mono); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; opacity: 0.85;" title="${escapeHtml(rawDisplay)}">${escapeHtml(truncatedCommand)}</span>`
            : ''
        }
        ${
          diffStats
            ? `<span style="font-size: 11px; font-family: var(--font-mono); font-weight: 600; display: inline-flex; gap: 4px; flex-shrink: 0; margin-left: 6px;">
                <span style="color: #22C55E;">+${diffStats.adds}</span>
                <span style="color: #EF4444;">-${diffStats.dels}</span>
               </span>`
            : ''
        }
      </div>
    `;
  }

  const durationBadge = durationStr
    ? `<span class="tool-duration-badge" ${parsed.status === 'running' && parsed.startTime ? `data-start-time="${parsed.startTime}"` : ''} style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); flex-shrink: 0; opacity: 0.75;">${escapeHtml(durationStr)}</span>`
    : '';

  return `
    <details class="timeline-row tool-row tool-capsule flux-tool-capsule" style="margin: 1.5px 0;">
      <summary style="
        list-style: none;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 6px;
        background: var(--bg-panel);
        border: 1px solid var(--border-subtle);
        border-radius: 6px;
        cursor: pointer;
        user-select: none;
        font-size: 12px;
        line-height: 1.45;
        color: var(--text-secondary);
      ">
        <span class="tool-chevron" style="display: inline-flex; align-items: center; justify-content: center; width: 12px; font-size: 9px; color: var(--text-muted); opacity: 0.7; flex-shrink: 0;">
          ▸
        </span>
        <span style="color: var(--text-secondary); display: inline-flex; align-items: center; flex-shrink: 0; opacity: 0.85;">
          ${iconSvg}
        </span>
        <span style="font-weight: 500; color: var(--text-main); flex-shrink: 0;">${displayName}</span>
        ${durationBadge}
        ${fileBadge}
        ${
          effectivePath && isFileTool
            ? renderPathLikeGitChanges(effectivePath, true)
            : rawDisplay
            ? `<span style="color: var(--text-muted); font-family: var(--font-mono); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; opacity: 0.85;" title="${escapeHtml(rawDisplay)}">${escapeHtml(truncatedCommand)}</span>`
            : ''
        }
        ${
          diffStats
            ? `<span style="font-size: 11px; font-family: var(--font-mono); font-weight: 600; display: inline-flex; gap: 4px; flex-shrink: 0; margin-left: 6px;">
                <span style="color: #22C55E;">+${diffStats.adds}</span>
                <span style="color: #EF4444;">-${diffStats.dels}</span>
               </span>`
            : ''
        }
      </summary>
      <div class="tool-output-container" style="
        margin: 0;
        border-bottom-left-radius: 6px;
        border-bottom-right-radius: 6px;
        overflow: hidden;
        background: var(--bg-surface-1, var(--bg-card));
        border: 1px solid var(--border-subtle);
        border-top: none;
      ">
        ${detailBodyHtml}
      </div>
    </details>
  `;
}

function renderReadOnlyToolGroup(items: ParsedToolItem[]): string {
  if (items.length === 1) {
    return renderSingleToolCapsule(items[0]);
  }

  // Aggregate read-only tools into a clean single line with tag chips
  const totalCount = items.length;
  const chipHtml = items
    .map((item) => {
      const fullPath = item.targetPath || item.cleanArgs || item.displayName;
      const fileName = fullPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || fullPath;
      const isFile = Boolean(item.targetPath);
      return `
        <span class="${isFile ? 'tool-file-link tool-changed-chip' : 'tool-changed-chip'}" ${isFile ? `data-preview-file="${escapeHtml(item.targetPath)}"` : ''} title="${escapeHtml(fullPath)}" style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${item.fileBadge}
          <span>${escapeHtml(fileName)}</span>
        </span>
      `;
    })
    .join('');

  return `
    <details class="timeline-row tool-row tool-capsule flux-tool-capsule" style="margin: 2px 0;">
      <summary style="
        list-style: none;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 6px;
        background: var(--bg-panel);
        border: 1px solid var(--border-subtle);
        border-radius: 6px;
        cursor: pointer;
        user-select: none;
        font-size: 12px;
        line-height: 1.45;
        color: var(--text-secondary);
      ">
        <span class="tool-chevron" style="display: inline-flex; align-items: center; justify-content: center; width: 12px; font-size: 9px; color: var(--text-muted); opacity: 0.7; flex-shrink: 0;">
          ▸
        </span>
        <span style="color: var(--accent); display: inline-flex; align-items: center; flex-shrink: 0;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>
        </span>
        <span style="font-weight: 500; color: var(--text-main); flex-shrink: 0;">检索与阅读 (${totalCount}项)</span>
        <div style="display: flex; gap: 4px; overflow: hidden; white-space: nowrap; flex: 1; align-items: center; padding: 0 4px;">
          ${chipHtml}
        </div>
      </summary>
      <div class="tool-output-container" style="
        margin: 0;
        padding: 6px 8px;
        border-bottom-left-radius: 6px;
        border-bottom-right-radius: 6px;
        overflow: hidden;
        background: var(--bg-surface-1, var(--bg-card));
        border: 1px solid var(--border-subtle);
        border-top: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
      ">
        ${items.map((it) => renderSingleToolCapsule(it)).join('')}
      </div>
    </details>
  `;
}

function renderToolCapsules(m: MessageViewModel): string {
  if (!m.toolCalls || m.toolCalls.length === 0) return '';

  const parsedItems = m.toolCalls.map(parseToolItem);
  const blocks: string[] = [];

  let i = 0;
  while (i < parsedItems.length) {
    const item = parsedItems[i];
    // If consecutive read-only items (read, grep, glob), aggregate them
    if (item.isReadOnly && i + 1 < parsedItems.length && parsedItems[i + 1].isReadOnly) {
      const readGroup: ParsedToolItem[] = [];
      while (i < parsedItems.length && parsedItems[i].isReadOnly) {
        readGroup.push(parsedItems[i]);
        i++;
      }
      blocks.push(renderReadOnlyToolGroup(readGroup));
    } else {
      blocks.push(renderSingleToolCapsule(item));
      i++;
    }
  }

  return blocks.join('');
}

function renderChangedFilesBar(m: MessageViewModel): string {
  if (!m.toolCalls || m.toolCalls.length === 0) return '';

  const modifiedMap = new Map<string, { adds: number; dels: number }>();

  for (const tc of m.toolCalls) {
    const rawName = String(tc.name || '').toLowerCase();
    if (!rawName.includes('edit') && !rawName.includes('patch') && !rawName.includes('write')) continue;

    let targetPath = '';
    if (typeof tc.args === 'string') {
      try {
        const parsed = JSON.parse(tc.args);
        if (parsed && typeof parsed === 'object') {
          targetPath = parsed.path || parsed.file || parsed.resolved_path || (parsed.files_modified ? parsed.files_modified[0] : '');
        }
      } catch {}
    }

    const norm = normalizeToolOutput(tc.output);
    if (!targetPath && norm.extractedPath) targetPath = norm.extractedPath;

    if (targetPath) {
      const stats = norm.isDiff ? calculateDiffStats(norm.text) : null;
      const current = modifiedMap.get(targetPath) || { adds: 0, dels: 0 };
      if (stats) {
        current.adds += stats.adds;
        current.dels += stats.dels;
      }
      modifiedMap.set(targetPath, current);
    }
  }

  if (modifiedMap.size === 0) return '';

  const chips = Array.from(modifiedMap.entries()).map(([path, stats]) => {
    const fileName = path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || path;
    const fileBadge = getFileBadge(path);
    const diffStatHtml = stats.adds > 0 || stats.dels > 0
      ? `<span style="font-size: 10px; font-family: var(--font-mono); font-weight: 600; display: inline-flex; gap: 2px;">
           <span style="color: #22C55E;">+${stats.adds}</span>
           <span style="color: #EF4444;">-${stats.dels}</span>
         </span>`
      : '';

    return `
      <div class="tool-changed-chip tool-file-link" data-preview-file="${escapeHtml(path)}" title="点击预览: ${escapeHtml(path)}">
        ${fileBadge}
        <span>${escapeHtml(fileName)}</span>
        ${diffStatHtml}
      </div>
    `;
  });

  return `
    <div class="tool-changed-files-bar">
      <span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); margin-right: 2px;">已修改文件:</span>
      ${chips.join('')}
    </div>
  `;
}

// Normalize tool result to prevent raw JSON wrappers from being displayed as raw text
function normalizeToolOutput(output: unknown, isWriteTool = false): { text: string; isEmpty: boolean; isDiff: boolean; extractedCommand?: string; extractedPath?: string } {
  if (output === null || output === undefined || output === '') {
    return { text: '', isEmpty: true, isDiff: false };
  }
  let str = '';
  let extractedCommand = '';
  let extractedPath = '';

  if (typeof output === 'string') {
    str = output.trim();
    if (str === '{}' || str === 'null' || str === 'undefined') {
      return { text: '', isEmpty: true, isDiff: false };
    }
    // Attempt to unwrap if output itself is a serialized JSON object like {"output": "...", "command": "..."}
    if (str.startsWith('{') && str.endsWith('}')) {
      try {
        const parsed = JSON.parse(str);
        if (parsed && typeof parsed === 'object') {
          const rec = parsed as Record<string, unknown>;
          if (typeof rec.command === 'string') extractedCommand = rec.command;
          if (typeof rec.path === 'string') extractedPath = rec.path;
          else if (typeof rec.file === 'string') extractedPath = rec.file;
          else if (typeof rec.resolved_path === 'string') extractedPath = rec.resolved_path;

          // For write tools, file-system status like bytes_written, verified, lint are metadata; ignore from text dump
          if (isWriteTool && ('bytes_written' in rec || 'dirs_created' in rec)) {
            return { text: '', isEmpty: true, isDiff: false, extractedCommand, extractedPath };
          }

          const cand = rec.output ?? rec.stdout ?? rec.matches_text ?? rec.diff ?? rec.text ?? rec.result;
          if (typeof cand === 'string') {
            str = cand.trim();
          } else if (cand !== undefined) {
            str = JSON.stringify(cand, null, 2);
          } else {
            str = '';
          }
        }
      } catch {}
    }
  } else if (typeof output === 'object') {
    const rec = output as Record<string, unknown>;
    if (typeof rec.command === 'string') extractedCommand = rec.command;
    if (typeof rec.path === 'string') extractedPath = rec.path;
    else if (typeof rec.file === 'string') extractedPath = rec.file;
    else if (typeof rec.resolved_path === 'string') extractedPath = rec.resolved_path;

    // For write tools, file-system status like bytes_written, verified, lint are metadata; ignore from text dump
    if (isWriteTool && ('bytes_written' in rec || 'dirs_created' in rec)) {
      return { text: '', isEmpty: true, isDiff: false, extractedCommand, extractedPath };
    }

    const cand = rec.output ?? rec.stdout ?? rec.matches_text ?? rec.diff ?? rec.text ?? rec.result ?? rec.message;
    if (typeof cand === 'string' && cand.trim() && cand.trim() !== '{}') {
      str = cand.trim();
    } else if (typeof rec.diff === 'string') {
      return { text: rec.diff.trim(), isEmpty: false, isDiff: true, extractedCommand, extractedPath };
    } else {
      str = '';
    }
  } else {
    str = String(output).trim();
  }

  const isDiff = str.includes('--- ') && str.includes('+++ ');
  return { text: str, isEmpty: str.length === 0, isDiff, extractedCommand, extractedPath };
}

function renderToolOutputBody(output: string, isDiff = false, commandText = ''): string {
  let contentHtml = '';

  if (isDiff || (output.includes('--- ') && output.includes('+++ '))) {
    const lines = escapeHtml(output).split('\n');
    const diffHtml = lines
      .map((line) => {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          return `<div style="background: rgba(34, 197, 94, 0.15); color: #4ADE80; padding: 0 4px;">${line}</div>`;
        }
        if (line.startsWith('-') && !line.startsWith('---')) {
          return `<div style="background: rgba(239, 68, 68, 0.15); color: #F87171; padding: 0 4px;">${line}</div>`;
        }
        if (line.startsWith('@@')) {
          return `<div style="color: #60A5FA; padding: 0 4px; font-weight: 600;">${line}</div>`;
        }
        return `<div style="color: #9CA3AF; padding: 0 4px;">${line}</div>`;
      })
      .join('');
    contentHtml = diffHtml;
  } else if (output) {
    contentHtml = escapeHtml(output);
  } else {
    contentHtml = '<span style="color: var(--text-muted); opacity: 0.6;">(已执行完成，无输出文本)</span>';
  }

  const commandBanner = commandText
    ? `
      <div style="
        padding: 5px 10px;
        background: var(--bg-elevated);
        border-bottom: 1px solid var(--border-subtle);
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--text-secondary);
        display: flex;
        align-items: center;
        gap: 6px;
      ">
        <span style="color: var(--accent); opacity: 0.85;">$</span>
        <span style="word-break: break-all; flex: 1;">${escapeHtml(commandText)}</span>
      </div>
    `
    : '';

  return `
    ${commandBanner}
    <pre style="
      margin: 0;
      padding: 8px 10px;
      background: var(--bg-code);
      font-family: var(--font-mono);
      font-size: 11.5px;
      line-height: 1.5;
      overflow-x: auto;
      max-height: 260px;
      color: var(--text-main);
    "><code>${contentHtml}</code></pre>
  `;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const markdownRenderCache = new Map<string, string>();
const MARKDOWN_CACHE_MAX = 500;

export function renderMarkdown(md: string): string {
  if (!md) return '';
  const cached = markdownRenderCache.get(md);
  if (cached !== undefined) return cached;

  const protectedBlocks: Record<string, string> = {};
  let blockCounter = 0;

  // 1. Extract and protect code blocks
  let processed = md.replace(/```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (_match, lang, code) => {
    const key = `__AURA_CODE_${blockCounter++}__`;
    const cleanLang = (lang || '').toLowerCase().trim();
    // Fast-path bypass for plain logs or oversized text (prevents catastrophic regex backtracking on giant Android Logcat)
    const isPlainLog = ['log', 'txt', 'text', 'logcat', 'output'].includes(cleanLang);
    const isOversized = code.length > 25000;
    const highlighted = (isPlainLog || isOversized) ? escapeHtml(code) : highlightCodeSyntax(code);

    const blockHtml = `
      <div class="code-block-wrapper" style="
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid var(--border-medium);
        margin: 12px 0;
        background: var(--bg-code);
        box-shadow: var(--shadow-card);
      ">
        <div style="
          padding: 6px 14px;
          background: var(--bg-elevated);
          border-bottom: 1px solid var(--border-subtle);
          font-size: 11px;
          color: var(--text-muted);
          font-family: var(--font-mono);
          display: flex;
          justify-content: space-between;
          align-items: center;
          user-select: none;
        ">
          <span style="text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; color: #94A3B8;">${lang || 'TEXT'}</span>
          <button class="btn-copy-code" onclick="navigator.clipboard.writeText(this.closest('.code-block-wrapper').querySelector('code').innerText)" style="
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid var(--border-subtle);
            color: var(--text-secondary);
            border-radius: 4px;
            padding: 2px 8px;
            cursor: pointer;
            font-size: 10.5px;
            font-family: var(--font-sans);
            transition: all 0.15s ease;
          ">复制</button>
        </div>
        <pre style="
          margin: 0;
          padding: 14px 16px;
          overflow-x: auto;
          font-family: var(--font-mono);
          font-size: 12px;
          line-height: 1.6;
          color: var(--text-main);
        "><code>${highlighted}</code></pre>
      </div>
    `;
    protectedBlocks[key] = blockHtml;
    return key;
  });

  // 2. Extract and protect GFM Tables (ensuring last line without trailing newline is captured)
  processed = extractAndProtectTables(processed, protectedBlocks, () => `__AURA_TBL_${blockCounter++}__`);

  // 3. Escape HTML on the rest of markdown content
  let html = escapeHtml(processed);

  // 4. Full range of Headings (######, #####, ####, ###, ##, #)
  html = html.replace(/^###### (.*$)/gim, '<h6 style="font-size: 0.95em; font-weight: 700; margin: 10px 0 4px; color: var(--text-muted);">$1</h6>');
  html = html.replace(/^##### (.*$)/gim, '<h5 style="font-size: 1.0em; font-weight: 700; margin: 12px 0 4px; color: var(--text-main);">$1</h5>');
  html = html.replace(/^#### (.*$)/gim, '<h4 style="font-size: 1.08em; font-weight: 700; margin: 14px 0 6px; color: var(--text-main);">$1</h4>');
  html = html.replace(/^### (.*$)/gim, '<h3 style="font-size: 1.15em; font-weight: 700; margin: 16px 0 6px; color: var(--text-main); letter-spacing: -0.01em;">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 style="font-size: 1.3em; font-weight: 700; margin: 20px 0 8px; color: var(--text-main); border-bottom: 1px solid var(--border-subtle); padding-bottom: 6px; letter-spacing: -0.01em;">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 style="font-size: 1.45em; font-weight: 800; margin: 24px 0 10px; color: var(--text-main); letter-spacing: -0.02em;">$1</h1>');

  // 5. Blockquotes
  html = html.replace(/^\&gt;\s?(.*$)/gim, '<blockquote style="border-left: 3px solid var(--accent); padding: 4px 12px; margin: 8px 0; color: var(--text-secondary); background: rgba(255, 191, 0, 0.03); border-radius: 0 6px 6px 0;">$1</blockquote>');

  // 6. Task lists (- [ ] / - [x])
  html = html.replace(/^\s*[\-\*]\s+\[ \]\s+(.*$)/gim, '<li style="margin-left: 20px; list-style-type: none;"><span style="display: inline-block; width: 13px; height: 13px; border: 1.5px solid var(--text-muted); border-radius: 3px; vertical-align: middle; margin-right: 6px;"></span>$1</li>');
  html = html.replace(/^\s*[\-\*]\s+\[x\]\s+(.*$)/gim, '<li style="margin-left: 20px; list-style-type: none;"><span style="display: inline-flex; align-items: center; justify-content: center; width: 13px; height: 13px; background: var(--accent); border-radius: 3px; vertical-align: middle; margin-right: 6px; color: #000; font-size: 9px; font-weight: bold;">✓</span>$1</li>');

  // 7. Regular Unordered & Ordered lists
  html = html.replace(/^\s*[\-\*]\s+(.*$)/gim, '<li style="margin-left: 20px; list-style-type: disc;">$1</li>');
  html = html.replace(/^\s*(\d+)\.\s+(.*$)/gim, '<li style="margin-left: 20px; list-style-type: decimal;">$2</li>');

  // 8. Inline code (Refined Clean Ice-Blue High-Contrast Accent)
  html = html.replace(/`([^`]+)`/g, '<code style="background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.2); padding: 1.5px 5.5px; border-radius: 4px; font-family: var(--font-mono); font-size: 12px; color: #38BDF8;">$1</code>');

  // 9. Bold, Italic & Strikethrough
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong style="color: var(--text-main); font-weight: 600;">$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em style="color: var(--text-secondary);">$1</em>');
  html = html.replace(/~~([^~]+)~~/g, '<del style="color: var(--text-muted);">$1</del>');

  // 10. Horizontal Rule
  html = html.replace(/^---$/gim, '<hr style="border: none; border-top: 1px solid var(--border-subtle); margin: 18px 0;" />');

  // 11. Paragraphs & Line Breaks on non-block content (OpenChamber Compact Rhythm)
  const rawParagraphs = html.split('\n\n').filter((p) => p.trim().length > 0);
  let renderedResult = '';

  if (rawParagraphs.length <= 1) {
    const withBreaks = html.replace(/\n/g, '<br/>');
    renderedResult = `<div style="margin: 0; line-height: 1.58;">${withBreaks}</div>`;
  } else {
    renderedResult = rawParagraphs
      .map((p) => {
        const withBreaks = p.replace(/\n/g, '<br/>');
        return `<div style="margin-bottom: 6px; line-height: 1.58;">${withBreaks}</div>`;
      })
      .join('');
  }

  // 12. Safely restore protected blocks using function replacement to prevent $& injection
  for (const [placeholder, blockContent] of Object.entries(protectedBlocks)) {
    renderedResult = renderedResult.replace(placeholder, () => blockContent);
  }

  if (markdownRenderCache.size >= MARKDOWN_CACHE_MAX) {
    const oldestKey = markdownRenderCache.keys().next().value;
    if (oldestKey) markdownRenderCache.delete(oldestKey);
  }
  markdownRenderCache.set(md, renderedResult);

  return renderedResult;
}

/** Single-pass lexical tokenizer for code syntax highlighting that never corrupts HTML attributes */
export function highlightCodeSyntax(code: string): string {
  if (!code) return '';

  // Token definition regex: Comments, Strings, Keywords, Numbers
  const tokenRegex = /(\/\/[^\n]*)|(["'`][\s\S]*?["'`])|\b(const|let|var|function|return|if|else|for|while|import|from|export|default|class|async|await|try|catch|type|interface|extends|implements)\b|\b(\d+)\b/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let output = '';

  while ((match = tokenRegex.exec(code)) !== null) {
    // Escape and append plain code text before match
    if (match.index > lastIndex) {
      output += escapeHtml(code.slice(lastIndex, match.index));
    }

    const [fullMatch, comment, stringLit, keyword, numberLit] = match;

    if (comment) {
      output += `<span style="color: #6272A4; font-style: italic;">${escapeHtml(comment)}</span>`;
    } else if (stringLit) {
      output += `<span style="color: #F1FA8C;">${escapeHtml(stringLit)}</span>`;
    } else if (keyword) {
      output += `<span style="color: #FF79C6; font-weight: 600;">${escapeHtml(keyword)}</span>`;
    } else if (numberLit) {
      output += `<span style="color: #BD93F9;">${escapeHtml(numberLit)}</span>`;
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < code.length) {
    output += escapeHtml(code.slice(lastIndex));
  }

  return output;
}

/** Helper to format inline markdown within table cells safely */
function formatCellInlineMarkdown(rawCell: string): string {
  let cell = escapeHtml(rawCell.trim());
  cell = cell.replace(/`([^`]+)`/g, '<code style="background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.2); padding: 1px 4px; border-radius: 3px; font-family: var(--font-mono); font-size: 11px; color: #38BDF8;">$1</code>');
  cell = cell.replace(/\*\*([^*]+)\*\*/g, '<strong style="color: var(--text-main); font-weight: 600;">$1</strong>');
  cell = cell.replace(/\*([^*]+)\*/g, '<em style="color: var(--text-secondary);">$1</em>');
  return cell;
}

/** Extracts GFM tables & TSV tables, compiles them directly to clean HTML, and stores them in protected map */
function extractAndProtectTables(
  content: string,
  blockMap: Record<string, string>,
  keyGen: () => string
): string {
  // 1. Matches consecutive lines starting and ending with pipe, ending with newline or EOF
  const pipeTableRegex = /((?:\|.+?\|(?:\r?\n|$))+)/g;

  let result = content.replace(pipeTableRegex, (rawTable) => {
    const lines = rawTable
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length < 2) return rawTable;

    const headerLine = lines[0];
    const separatorLine = lines[1];
    if (!separatorLine.includes('-')) return rawTable;

    const parseRow = (line: string): string[] =>
      line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(formatCellInlineMarkdown);

    const headers = parseRow(headerLine);
    const rows = lines.slice(2).map(parseRow);

    const theadHtml = `
      <tr style="background: rgba(255, 255, 255, 0.04); border-bottom: 1.5px solid var(--border-medium);">
        ${headers.map((h) => `<th style="padding: 8px 12px; font-weight: 700; color: var(--text-main); font-size: 12px; text-align: left;">${h}</th>`).join('')}
      </tr>
    `;

    const tbodyHtml = rows
      .map(
        (r, idx) => `
      <tr style="background: ${idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.015)'}; border-bottom: 1px solid var(--border-subtle);">
        ${r.map((c) => `<td style="padding: 7px 12px; color: var(--text-secondary); font-size: 12px;">${c}</td>`).join('')}
      </tr>
    `
      )
      .join('');

    const tableHtml = `
      <div style="overflow-x: auto; margin: 14px 0; border: 1px solid var(--border-medium); border-radius: 8px; box-shadow: var(--shadow-card);">
        <table style="width: 100%; border-collapse: collapse; text-align: left;">
          <thead>${theadHtml}</thead>
          <tbody>${tbodyHtml}</tbody>
        </table>
      </div>
    `;

    const key = keyGen();
    blockMap[key] = tableHtml;
    return key;
  });

  // 2. Matches TSV (Tab-separated) tables (consecutive lines with at least one tab each)
  const tsvTableRegex = /((?:[^\n\r]+\t[^\n\r]+(?:\r?\n|$)){2,})/g;
  result = result.replace(tsvTableRegex, (rawTsv) => {
    const lines = rawTsv
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes('\t'));

    if (lines.length < 2) return rawTsv;

    const parseTsvRow = (line: string): string[] => line.split('\t').map(formatCellInlineMarkdown);

    const headers = parseTsvRow(lines[0]);
    const rows = lines.slice(1).map(parseTsvRow);

    const theadHtml = `
      <tr style="background: rgba(255, 255, 255, 0.05); border-bottom: 1.5px solid var(--border-medium);">
        ${headers.map((h) => `<th style="padding: 8px 12px; font-weight: 700; color: var(--text-main); font-size: 12px; text-align: left;">${h}</th>`).join('')}
      </tr>
    `;

    const tbodyHtml = rows
      .map(
        (r, idx) => `
      <tr style="background: ${idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.015)'}; border-bottom: 1px solid var(--border-subtle);">
        ${r.map((c) => `<td style="padding: 7px 12px; color: var(--text-secondary); font-size: 12px; line-height: 1.5;">${c}</td>`).join('')}
      </tr>
    `
      )
      .join('');

    const tableHtml = `
      <div style="overflow-x: auto; margin: 14px 0; border: 1px solid var(--border-medium); border-radius: 8px; box-shadow: var(--shadow-card);">
        <table style="width: 100%; border-collapse: collapse; text-align: left;">
          <thead>${theadHtml}</thead>
          <tbody>${tbodyHtml}</tbody>
        </table>
      </div>
    `;

    const key = keyGen();
    blockMap[key] = tableHtml;
    return key;
  });

  return result;
}
