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
            !props.gatewayConnected
              ? renderGatewayOnboarding(props)
              : props.messages.length === 0
              ? renderWelcomeEmptyState()
              : props.messages.map((m) => renderMessage(m, agentDisplayName)).join('')
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

export function renderMessage(m: MessageViewModel, agentDisplayName = 'HERMES AGENT'): string {
  const isUser = m.role === 'user';

  if (isUser) {
    return `
      <div class="message-row user-row" style="display: flex; justify-content: flex-end; width: 100%;">
        <div class="user-bubble" style="
          max-width: min(80%, 780px);
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
      gap: 12px;
      width: 100%;
    ">
      <!-- Agent Header Meta -->
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="
          font-size: 11px;
          font-weight: 700;
          color: var(--accent);
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          padding: 2px 8px;
          border-radius: 4px;
          letter-spacing: 0.05em;
        ">${escapeHtml(agentDisplayName)}</span>
        <span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${escapeHtml(m.timestamp)}</span>
      </div>

      <!-- Thinking Fold -->
      ${
        m.thought
          ? `
        <details class="thinking-fold" open style="
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 12px;
          box-shadow: var(--shadow-card);
        ">
          <summary style="cursor: pointer; color: var(--text-muted); font-weight: 600; display: flex; align-items: center; gap: 6px;">
            <span>🧠 思维推理链</span>
            ${m.thoughtDurationMs ? `<span style="font-size: 10.5px; font-weight: normal; color: var(--text-faint);">(${m.thoughtDurationMs}ms)</span>` : ''}
          </summary>
          <div id="msg-thought-${m.id}" style="
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid var(--border-subtle);
            color: var(--text-secondary);
            font-family: var(--font-mono);
            font-size: 11.5px;
            line-height: 1.6;
            white-space: pre-wrap;
          ">${escapeHtml(m.thought)}</div>
        </details>
      `
          : `<div id="msg-thought-${m.id}" style="display: none;"></div>`
      }

      <!-- Tool Execution Capsules -->
      ${
        m.toolCalls && m.toolCalls.length > 0
          ? m.toolCalls
              .map(
                (tc) => `
          <div class="tool-capsule" style="
            background: var(--bg-card);
            border: 1px solid var(--border-medium);
            border-radius: 8px;
            overflow: hidden;
            box-shadow: var(--shadow-card);
          ">
            <div style="
              padding: 8px 12px;
              display: flex;
              align-items: center;
              justify-content: space-between;
              background: var(--bg-elevated);
              font-size: 12px;
            ">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="color: var(--accent); font-weight: 600;">⚡ ${escapeHtml(tc.name)}</span>
                <span style="color: var(--text-muted); font-family: var(--font-mono); font-size: 11px;">${escapeHtml(tc.args)}</span>
              </div>
              <span style="
                font-size: 10px;
                padding: 2px 6px;
                border-radius: 4px;
                background: ${tc.status === 'completed' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)'};
                color: ${tc.status === 'completed' ? '#4ADE80' : '#F87171'};
                font-weight: 600;
              ">${tc.status === 'completed' ? 'DONE' : 'RUNNING'}</span>
            </div>
            ${
              tc.output
                ? `
              <pre style="
                margin: 0;
                padding: 10px 12px;
                background: var(--bg-code);
                color: #A6ACCD;
                font-family: var(--font-mono);
                font-size: 11.5px;
                line-height: 1.5;
                overflow-x: auto;
                max-height: 180px;
              "><code>${escapeHtml(tc.output)}</code></pre>
            `
                : ''
            }
          </div>
        `
              )
              .join('')
          : ''
      }

      <!-- Core Content (Incremental Anchor) -->
      <div id="msg-content-${m.id}" class="assistant-content prose-block" style="
        color: var(--text-main);
        font-size: 13.5px;
        line-height: 1.68;
        display: flex;
        flex-direction: column;
        gap: 12px;
      ">
        ${renderMarkdown(m.content)}
      </div>
    </div>
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
  let html = escapeHtml(md);

  // 1. Triple backticks code block with syntax and copy button
  html = html.replace(/```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (_match, lang, code) => {
    return `
      <div class="code-block-wrapper" style="border-radius: 10px; overflow: hidden; border: 1px solid var(--border-medium); margin: 12px 0; background: var(--bg-code); box-shadow: var(--shadow-card);">
        <div style="padding: 7px 14px; background: var(--bg-card); border-bottom: 1px solid var(--border-subtle); font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); display: flex; justify-content: space-between; align-items: center;">
          <span style="text-transform: uppercase; font-weight: 600;">${lang || 'code'}</span>
          <button class="btn-copy-code" onclick="navigator.clipboard.writeText(this.closest('.code-block-wrapper').querySelector('code').innerText)" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: 11px;">复制</button>
        </div>
        <pre style="margin: 0; padding: 14px; overflow-x: auto; font-family: var(--font-mono); font-size: 12.5px; line-height: 1.55; color: #E2E8F0;"><code>${code}</code></pre>
      </div>
    `;
  });

  // 2. Headings (###, ##, #)
  html = html.replace(/^### (.*$)/gim, '<h3 style="font-size: 1.15em; font-weight: 700; margin: 14px 0 6px; color: var(--text-main);">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 style="font-size: 1.3em; font-weight: 700; margin: 18px 0 8px; color: var(--text-main); border-bottom: 1px solid var(--border-subtle); padding-bottom: 4px;">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 style="font-size: 1.45em; font-weight: 800; margin: 20px 0 10px; color: var(--text-main);">$1</h1>');

  // 3. Blockquotes
  html = html.replace(/^\> (.*$)/gim, '<blockquote style="border-left: 3px solid var(--accent); padding-left: 12px; margin: 8px 0; color: var(--text-secondary); font-style: italic;">$1</blockquote>');

  // 4. Unordered & Ordered lists
  html = html.replace(/^\s*[\-\*]\s+(.*$)/gim, '<li style="margin-left: 20px; list-style-type: disc;">$1</li>');
  html = html.replace(/^\s*(\d+)\.\s+(.*$)/gim, '<li style="margin-left: 20px; list-style-type: decimal;">$2</li>');

  // 5. Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background: var(--bg-card); border: 1px solid var(--border-subtle); padding: 2px 6px; border-radius: 4px; font-family: var(--font-mono); font-size: 12px; color: var(--accent);">$1</code>');

  // 6. Bold & Italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong style="color: var(--text-main); font-weight: 600;">$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em style="color: var(--text-secondary);">$1</em>');

  // 7. Paragraphs
  const paragraphs = html.split('\n\n').filter((p) => p.trim().length > 0);
  if (paragraphs.length <= 1) {
    return `<div style="margin: 0; line-height: 1.68;">${html}</div>`;
  }

  return paragraphs
    .map((p) => `<div style="margin-bottom: 10px; line-height: 1.68;">${p}</div>`)
    .join('');
}
