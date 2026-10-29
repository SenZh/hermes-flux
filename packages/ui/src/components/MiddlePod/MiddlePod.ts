/**
 * Hermes Aura Middle Conversation Pod (v4.0 Production)
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
}

export function renderMiddlePod(props: MiddlePodProps): string {
  const agentDisplayName = (props.profileName || 'default').toUpperCase();

  return `
    <main class="aura-middle-pod conversation-pod" style="
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
        scroll-behavior: smooth;
        box-sizing: border-box;
      ">
        <div class="content-fluid-canvas" style="width: 100%; max-width: 100%; margin: 0; display: flex; flex-direction: column; gap: 24px;">
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
              : props.messages
                  .map((m, idx, arr) => {
                    const prev = arr[idx - 1];
                    const next = arr[idx + 1];
                    const isFirstInTurn = !prev || prev.role !== m.role;
                    const isLastInTurn = !next || next.role !== m.role;
                    return renderMessage(m, agentDisplayName, { isFirstInTurn, isLastInTurn });
                  })
                  .join('')
          }
        </div>
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
      <h3 style="font-size: 17px; font-weight: 700; color: var(--text-main); margin: 0; letter-spacing: -0.01em;">Hermes Aura 工作台已就绪</h3>
      <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin: 0; max-width: 480px;">
        在下方 740px 黄金限宽输入舱下达任务，按 Enter 发送。Hermes 将自主规划多步骤推理、调用工具链并流式呈现。
      </p>
    </div>
  `;
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
      <div class="message-row user-row" style="display: flex; flex-direction: column; align-items: flex-end; width: 100%; margin: 6px 0;">
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

  return `
    <div class="message-row assistant-row" data-id="${m.id}" style="
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 100%;
      margin: 2px 0;
    ">
      <!-- Turn Header Time (Only shown at the beginning of an assistant turn, completely removing agent name capsule) -->
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
      ${renderToolCapsules(m)}

      <!-- Core Content (Incremental Anchor) -->
      ${
        m.content && m.content.trim()
          ? `
        <div id="msg-content-${m.id}" class="assistant-content prose-block" style="
          color: var(--text-main);
          font-size: 13.5px;
          line-height: 1.68;
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-top: 4px;
        ">
          ${renderMarkdown(m.content)}
        </div>
      `
          : `<div id="msg-content-${m.id}" class="assistant-content prose-block" style="display: none;"></div>`
      }

      <!-- Turn Footer (Optional subtle end time if needed) -->
      ${
        !isFirstInTurn && isLastInTurn && m.timestamp && m.content && m.content.trim()
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

function getCleanReasoningSummary(text: string): string {
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

function renderToolCapsules(m: MessageViewModel): string {
  if (!m.toolCalls || m.toolCalls.length === 0) return '';

  return m.toolCalls
    .map((tc) => {
      const rawName = String(tc.name || '').toLowerCase();
      let displayName = 'Tool Call';
      let iconSvg = '';

      if (rawName.includes('shell') || rawName.includes('bash') || rawName.includes('cmd') || rawName.includes('terminal')) {
        displayName = 'Shell Command';
        iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="3"/><path d="m7 10 3 2-3 2"/><path d="M12 14h5"/></svg>`;
      } else if (rawName.includes('edit') || rawName.includes('patch')) {
        displayName = 'Edit File';
        iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m10 15 5-5"/></svg>`;
      } else if (rawName.includes('read') || rawName.includes('file')) {
        displayName = 'Read File';
        iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`;
      } else if (rawName.includes('write')) {
        displayName = 'Write File';
        iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18h6"/></svg>`;
      } else if (rawName.includes('grep') || rawName.includes('search')) {
        displayName = 'Search Files';
        iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
      } else if (rawName.includes('glob') || rawName.includes('find')) {
        displayName = 'Find Files';
        iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
      } else if (rawName.includes('subagent') || rawName.includes('agent')) {
        displayName = 'Agent Task';
        iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="1.5"/><circle cx="15" cy="9" r="1.5"/><path d="M8 15h8"/></svg>`;
      } else {
        displayName = tc.name || 'Tool';
        iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
      }

      // Defensive arguments parsing: ensure cleanArgs is GUARANTEED to be a string
      let cleanArgs = '';
      if (typeof tc.args === 'string') {
        cleanArgs = tc.args;
        try {
          const parsed = JSON.parse(tc.args);
          if (parsed && typeof parsed === 'object') {
            const candidate = parsed.command ?? parsed.path ?? parsed.file ?? parsed.query ?? parsed.pattern ?? parsed.description ?? parsed.prompt;
            if (typeof candidate === 'string') {
              cleanArgs = candidate;
            } else if (candidate !== undefined) {
              cleanArgs = JSON.stringify(candidate);
            }
          }
        } catch {
          // keep string
        }
      } else if (tc.args != null) {
        cleanArgs = JSON.stringify(tc.args);
      }

      return `
        <details class="timeline-row tool-row tool-capsule" style="margin: 2px 0;">
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
              ${iconSvg}
            </span>
            <span style="font-weight: 500; color: #D1D5DB; flex-shrink: 0;">${displayName}</span>
            ${
              cleanArgs
                ? `<span style="color: #9CA3AF; font-family: var(--font-mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${escapeHtml(cleanArgs)}</span>`
                : ''
            }
          </summary>
          ${
            tc.output
              ? `
            <div style="
              margin-left: 7px;
              margin-top: 4px;
              margin-bottom: 6px;
              padding-left: 14px;
              border-left: 2px solid rgba(255, 255, 255, 0.08);
            ">
              ${renderToolOutputBody(String(tc.output))}
            </div>
          `
              : ''
          }
        </details>
      `;
    })
    .join('');
}

function renderToolOutputBody(output: string): string {
  if (!output) return '';

  // Check if output is a git diff
  if (output.includes('--- ') && output.includes('+++ ')) {
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

    return `
      <pre style="
        margin: 0;
        padding: 8px 10px;
        background: #080808;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 6px;
        font-family: var(--font-mono);
        font-size: 11.5px;
        line-height: 1.5;
        overflow-x: auto;
        max-height: 240px;
      "><code>${diffHtml}</code></pre>
    `;
  }

  return `
    <pre style="
      margin: 0;
      padding: 8px 10px;
      background: #080808;
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 6px;
      color: #9CA3AF;
      font-family: var(--font-mono);
      font-size: 11.5px;
      line-height: 1.5;
      overflow-x: auto;
      max-height: 240px;
    "><code>${escapeHtml(output)}</code></pre>
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

export function renderMarkdown(md: string): string {
  if (!md) return '';

  const protectedBlocks: Record<string, string> = {};
  let blockCounter = 0;

  // 1. Extract and protect code blocks
  let processed = md.replace(/```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (_match, lang, code) => {
    const key = `__AURA_CODE_${blockCounter++}__`;
    const highlighted = highlightCodeSyntax(code);

    const blockHtml = `
      <div class="code-block-wrapper" style="
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid var(--border-medium);
        margin: 12px 0;
        background: #080808;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
      ">
        <div style="
          padding: 6px 14px;
          background: #121212;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          font-size: 11px;
          color: var(--text-muted);
          font-family: var(--font-mono);
          display: flex;
          justify-content: space-between;
          align-items: center;
          user-select: none;
        ">
          <span style="text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em; color: var(--accent);">${lang || 'TEXT'}</span>
          <button class="btn-copy-code" onclick="navigator.clipboard.writeText(this.closest('.code-block-wrapper').querySelector('code').innerText)" style="
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
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
          color: #E2E8F0;
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

  // 8. Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background: rgba(255, 255, 255, 0.06); border: 1px solid var(--border-subtle); padding: 1.5px 5.5px; border-radius: 4px; font-family: var(--font-mono); font-size: 12px; color: var(--accent);">$1</code>');

  // 9. Bold, Italic & Strikethrough
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong style="color: var(--text-main); font-weight: 600;">$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em style="color: var(--text-secondary);">$1</em>');
  html = html.replace(/~~([^~]+)~~/g, '<del style="color: var(--text-muted);">$1</del>');

  // 10. Horizontal Rule
  html = html.replace(/^---$/gim, '<hr style="border: none; border-top: 1px solid var(--border-subtle); margin: 18px 0;" />');

  // 11. Paragraphs & Line Breaks on non-block content
  const rawParagraphs = html.split('\n\n').filter((p) => p.trim().length > 0);
  let renderedResult = '';

  if (rawParagraphs.length <= 1) {
    const withBreaks = html.replace(/\n/g, '<br/>');
    renderedResult = `<div style="margin: 0; line-height: 1.68;">${withBreaks}</div>`;
  } else {
    renderedResult = rawParagraphs
      .map((p) => {
        const withBreaks = p.replace(/\n/g, '<br/>');
        return `<div style="margin-bottom: 10px; line-height: 1.68;">${withBreaks}</div>`;
      })
      .join('');
  }

  // 12. Safely restore protected blocks using function replacement to prevent $& injection
  for (const [placeholder, blockContent] of Object.entries(protectedBlocks)) {
    renderedResult = renderedResult.replace(placeholder, () => blockContent);
  }

  return renderedResult;
}

/** Single-pass lexical tokenizer for code syntax highlighting that never corrupts HTML attributes */
function highlightCodeSyntax(code: string): string {
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
  cell = cell.replace(/`([^`]+)`/g, '<code style="background: rgba(255, 255, 255, 0.08); padding: 1px 4px; border-radius: 3px; font-family: var(--font-mono); font-size: 11px; color: var(--accent);">$1</code>');
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
