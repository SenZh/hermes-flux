/**
 * Hermes Aura Middle Conversation Pod (v3.5)
 * Full-Bleed Fluid Canvas:
 * - Canvas spans 100% width edge-to-edge between left and right rails.
 * - Golden-width composer dock floating at bottom.
 * - Shows Onboarding Connect Hero when disconnected.
 * - Shows Ready Welcome Screen when session is empty.
 * - Real streaming and message history rendering without mock data.
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
  gatewayType?: 'dashboard' | 'api';
  username?: string;
  password?: string;
  token?: string;
  profileName?: string;
  messages: MessageViewModel[];
  testStatus?: { ok?: boolean; message?: string; latency?: number };
}

export function renderMiddlePod(props: MiddlePodProps): string {
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
    ">
      <!-- Conversation Scroll Stream (100% Full-bleed width) -->
      <div id="conversation-stream" class="messages-stream-area" style="
        flex: 1;
        width: 100%;
        overflow-y: auto;
        overflow-x: hidden;
        display: flex;
        flex-direction: column;
        padding: 24px 32px 160px;
        scroll-behavior: smooth;
        box-sizing: border-box;
      ">
        <div class="content-fluid-canvas" style="width: 100%; display: flex; flex-direction: column; gap: 20px;">
          ${
            !props.gatewayConnected
              ? renderGatewayOnboarding(props)
              : props.messages.length === 0
              ? renderWelcomeEmptyState()
              : props.messages.map((m) => renderMessage(m)).join('')
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
      max-width: 580px;
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
        ">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>
        <h2 style="font-size: 18px; font-weight: 700; color: var(--text-main); margin: 0;">连接至 Hermes Gateway</h2>
        <p style="font-size: 12.5px; color: var(--text-secondary); margin: 0; line-height: 1.5; max-width: 440px;">
          配置本地守护进程或远程服务器的 Hermes 网关地址与鉴权凭证，开启真实的自主 Agent 会话与工业级能力。
        </p>
      </div>

      <!-- Form Inputs -->
      <div style="display: flex; flex-direction: column; gap: 14px;">
        <!-- Gateway URL -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <label style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary);">网关连接地址 (Gateway URL)</label>
            <span style="font-size: 10.5px; color: var(--text-muted); font-family: var(--font-mono);">推荐 9119 或反代域名</span>
          </div>
          <input type="text" id="onboarding-gateway-url" value="${escapeHtml(props.gatewayUrl || 'https://fn-ai.codepower.cloud:1519')}" placeholder="http://127.0.0.1:9119 或 https://..." style="
            width: 100%;
            height: 36px;
            background: var(--bg-panel);
            border: 1px solid var(--border-medium);
            border-radius: 8px;
            padding: 0 12px;
            font-size: 12.5px;
            font-family: var(--font-mono);
            color: var(--text-main);
            outline: none;
            box-sizing: border-box;
          "/>
        </div>

        <!-- Connection Channel Toggle -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <label style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary);">接入通道类型</label>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <button type="button" class="onboarding-channel-btn ${props.gatewayType === 'dashboard' || !props.gatewayType ? 'active' : ''}" data-type="dashboard" style="
              height: 38px;
              border-radius: 8px;
              border: 1px solid ${props.gatewayType === 'dashboard' || !props.gatewayType ? 'var(--accent)' : 'var(--border-medium)'};
              background: ${props.gatewayType === 'dashboard' || !props.gatewayType ? 'var(--accent-subtle)' : 'var(--bg-panel)'};
              color: ${props.gatewayType === 'dashboard' || !props.gatewayType ? 'var(--accent)' : 'var(--text-main)'};
              font-size: 11.5px;
              font-weight: 600;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 6px;
            ">
              <span>⚡ Dashboard 族 (9119 / WS 全功能)</span>
            </button>
            <button type="button" class="onboarding-channel-btn ${props.gatewayType === 'api' ? 'active' : ''}" data-type="api" style="
              height: 38px;
              border-radius: 8px;
              border: 1px solid ${props.gatewayType === 'api' ? 'var(--accent)' : 'var(--border-medium)'};
              background: ${props.gatewayType === 'api' ? 'var(--accent-subtle)' : 'var(--bg-panel)'};
              color: ${props.gatewayType === 'api' ? 'var(--accent)' : 'var(--text-main)'};
              font-size: 11.5px;
              font-weight: 600;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 6px;
            ">
              <span>🔑 API Server 族 (8642 / API Key)</span>
            </button>
          </div>
        </div>

        <!-- Dashboard Auth: Username & Password -->
        <div id="onboarding-section-dashboard" style="display: ${props.gatewayType === 'dashboard' || !props.gatewayType ? 'flex' : 'none'}; flex-direction: column; gap: 10px;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <label style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary);">用户名 (Username)</label>
              <input type="text" id="onboarding-username" value="${escapeHtml(props.username || '')}" placeholder="admin (公网/认证必填)" style="
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
              <input type="password" id="onboarding-password" value="${escapeHtml(props.password || '')}" placeholder="输入登录密码..." style="
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

        <!-- API Auth: Key -->
        <div id="onboarding-section-api" style="display: ${props.gatewayType === 'api' ? 'flex' : 'none'}; flex-direction: column; gap: 6px;">
          <label style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary);">API 静态密钥 (API_SERVER_KEY)</label>
          <input type="password" id="onboarding-api-key" value="${escapeHtml(props.token || '')}" placeholder="sk-..." style="
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

        <!-- Profile Selector -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <label style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary);">Profile 配置名称</label>
          <input type="text" id="onboarding-profile-name" value="${escapeHtml(props.profileName || 'default')}" placeholder="default, aura, 或自定义 profile" style="
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
          transition: background 0.15s ease;
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
          transition: transform 0.1s ease, filter 0.1s ease;
        ">${props.gatewayConnecting ? '正在连接...' : '保存并连接 ↗'}</button>
      </div>
    </div>
  `;
}

function renderWelcomeEmptyState(): string {
  return `
    <div style="
      max-width: 540px;
      margin: 80px auto 0;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      color: var(--text-muted);
    ">
      <div style="
        width: 54px;
        height: 54px;
        border-radius: 14px;
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        color: var(--accent);
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      </div>
      <h3 style="font-size: 16px; font-weight: 600; color: var(--text-main); margin: 0;">Hermes Aura 工作台已就绪</h3>
      <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin: 0;">
        已成功接入网关。在下方输入框中下达任务或按 Enter 发送，Hermes 将调用全栈工具集自主执行、流式推理并实时汇报。
      </p>
    </div>
  `;
}

function renderMessage(m: MessageViewModel): string {
  const isUser = m.role === 'user';

  if (isUser) {
    return `
      <div class="message-row user-row" style="display: flex; justify-content: flex-end; width: 100%;">
        <div class="user-bubble" style="
          max-width: 760px;
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: 12px 12px 2px 12px;
          padding: 12px 16px;
          color: var(--text-main);
          font-size: 13.5px;
          line-height: 1.6;
          box-shadow: var(--shadow-card);
        ">
          ${escapeHtml(m.content)}
        </div>
      </div>
    `;
  }

  // Assistant Message
  return `
    <div class="message-row assistant-row" style="display: flex; flex-direction: column; gap: 10px; width: 100%;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.05em; color: var(--accent); text-transform: uppercase;">HERMES AGENT</span>
        <span style="font-size: 10px; color: var(--text-muted);">${escapeHtml(m.timestamp)}</span>
      </div>

      <!-- Thinking Trace Fold (Optional) -->
      ${
        m.thought
          ? `
        <details class="thinking-fold" open style="
          background: var(--bg-panel);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 12px;
        ">
          <summary style="
            cursor: pointer;
            color: var(--text-muted);
            font-weight: 500;
            user-select: none;
            display: flex;
            align-items: center;
            gap: 6px;
          ">
            <span>🧠 思维链 (Chain-of-Thought)</span>
          </summary>
          <div style="
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid var(--border-subtle);
            color: var(--text-secondary);
            font-family: var(--font-mono);
            font-size: 11.5px;
            line-height: 1.6;
            white-space: pre-wrap;
          ">${escapeHtml(m.thought)}</div>
        </details>
      `
          : ''
      }

      <!-- Tool Execution Capsule (Optional) -->
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

      <!-- Core Content -->
      <div class="assistant-content prose-block" style="
        color: var(--text-main);
        font-size: 13.5px;
        line-height: 1.65;
        display: flex;
        flex-direction: column;
        gap: 12px;
      ">
        ${renderMarkdown(m.content)}
      </div>
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderMarkdown(md: string): string {
  let html = escapeHtml(md);

  // Triple backticks code block
  html = html.replace(/```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (_match, lang, code) => {
    return `
      <div style="border-radius: 8px; overflow: hidden; border: 1px solid var(--border-medium); margin: 8px 0; background: var(--bg-code);">
        <div style="padding: 6px 12px; background: var(--bg-elevated); font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); display: flex; justify-content: space-between;">
          <span>${lang || 'code'}</span>
        </div>
        <pre style="margin: 0; padding: 12px; overflow-x: auto; font-family: var(--font-mono); font-size: 12px; line-height: 1.5; color: #E2E8F0;"><code>${code}</code></pre>
      </div>
    `;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background: var(--bg-panel); border: 1px solid var(--border-subtle); padding: 2px 5px; border-radius: 4px; font-family: var(--font-mono); font-size: 12px; color: var(--accent);">$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Paragraphs
  const paragraphs = html.split('\n\n').filter((p) => p.trim().length > 0);
  return paragraphs.map((p) => `<p style="margin: 0;">${p.replace(/\n/g, '<br/>')}</p>`).join('');
}
