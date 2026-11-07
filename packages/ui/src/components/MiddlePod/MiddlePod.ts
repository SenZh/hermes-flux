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
import { renderBotAvatar } from '../../utils/botAvatar.js';
import { renderMarkdownCore, formatInlineCodeOrLink as formatInlineCodeOrLinkLib, highlightCodeSyntax as highlightCodeSyntaxLib } from '../../lib/markdown.js';

export interface MessageTokenMetrics {
  total?: number;
  input?: number;
  output?: number;
  tps?: number;
  cacheHitPct?: number;
  cacheRead?: number;
}

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
  tokenMetrics?: MessageTokenMetrics;
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
  /** 接入开关：true 时消息列表交给 React 宿主；默认 false 保持旧模板，供测试与回退使用 */
  reactList?: boolean;
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

export function renderConversationCanvas(props: MiddlePodProps): string {
  // 接入期：开关打开且已连接有消息时，消息列表交给 React 宿主；其余状态保留旧渲染。
  if (props.reactList && props.gatewayConnected && props.messages.length > 0) {
    return `
      <div class="content-fluid-canvas conv-canvas" data-conv-layer="canvas">
        ${renderContextGauge(props.contextUsage)}
        <div id="react-message-list-host" style="display:contents"></div>
        ${(props.sideAgentCapsules || []).map(renderSideAgentCapsule).join('')}
      </div>
    `;
  }

  const agentDisplayName = (props.profileName || 'default').toUpperCase();

  return `
    <div class="content-fluid-canvas conv-canvas" data-conv-layer="canvas">
      ${renderContextGauge(props.contextUsage)}
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
                // 【设计意图 (Why)】
                // 在单聊中同角色连续消息合并头像；但在多 Agent 群聊中，不同 Agent 即使都是 assistant，各自发言也必须呈现对应头像与名称徽章！
                // 【防范的历史坑 (Pitfall)】
                // 历史代码仅判断 prev.role !== m.role，导致群聊中第二位发言的 Agent 头像被错误判定为同回合而惨遭隐藏。
                // 【规则 (Rules)】
                // 当两者角色不同，或者两者发言人 sender 不同时，严格判定为回合起点 isFirstInTurn = true。
                const isDifferentSender = Boolean(m.sender && prev?.sender && m.sender !== prev.sender);
                const isFirstInTurn = !prev || prev.role !== m.role || isDifferentSender;
                const isLastInTurn = !next || next.role !== m.role || Boolean(m.sender && next?.sender && m.sender !== next.sender);
                // 【设计意图 (Why)】
                // 当整体处于流式输出时，仅正在生成的最后一个回合/末尾消息标记为 isStreaming，防范生成中途过早暴露操作栏
                const isLastMessageOverall = idx === arr.length - 1;
                const isStreamingMessage = Boolean(props.isStreaming && isLastMessageOverall);
                return renderMessage(m, agentDisplayName, {
                  isFirstInTurn,
                  isLastInTurn,
                  isStreaming: isStreamingMessage,
                });
              })
              .join('')}
            ${(props.sideAgentCapsules || []).map(renderSideAgentCapsule).join('')}
          `
      }
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
    // gate-degrade: 工具参数解析失败时保留原始文本展示，不影响消息渲染
    } catch {}
  }

  return { cleanContent: content, extractedTools: [] };
}

export function renderTokenMetrics(metrics?: MessageTokenMetrics, modelName?: string): string {
  if (!metrics || (!metrics.total && !metrics.input && !metrics.output)) {
    return '';
  }

  const totalText = metrics.total ? `${metrics.total.toLocaleString()} tokens` : '';
  const tpsText = metrics.tps ? `${metrics.tps.toFixed(1)} tps` : '';
  const cacheHitText = metrics.cacheHitPct !== undefined && metrics.cacheHitPct !== null ? `${metrics.cacheHitPct}%` : '';

  return `
    <div class="collapsible-token-metrics" style="position: relative; display: inline-flex; align-items: center;">
      <!-- 外层常驻胶囊 -->
      <button class="token-metrics-pill" data-action="toggle-token-popover" style="
        background: var(--bg-panel);
        border: 1px solid var(--border-subtle);
        border-radius: 10px;
        padding: 1.5px 7px;
        font-size: 10px;
        font-family: var(--font-mono);
        color: var(--text-muted);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        transition: border-color 0.12s ease, color 0.12s ease;
      ">
        <span style="color: var(--accent); font-size: 10px;">⚡</span>
        <span>${escapeHtml(totalText || t('chat.tokens'))}</span>
      </button>

      <!-- Hover / 点击 Popover 详情面板 -->
      <div class="token-metrics-popover" style="
        display: none;
        position: absolute;
        bottom: calc(100% + 6px);
        right: 0;
        z-index: 50;
        width: 210px;
        background: var(--bg-card);
        border: 1px solid var(--border-medium);
        border-radius: 8px;
        padding: 8px 10px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        font-size: 11px;
        font-family: var(--font-mono);
        color: var(--text-main);
        backdrop-filter: blur(12px);
      ">
        <div style="font-weight: 600; color: var(--text-main); margin-bottom: 6px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 4px;">
          ${escapeHtml(modelName || t('chat.tokens'))}
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 3px; color: var(--text-secondary);">
          <span>${t('chat.tps')}:</span>
          <span style="color: var(--accent); font-weight: 500;">${tpsText || '—'}</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 3px; color: var(--text-secondary);">
          <span>${t('chat.inputTokens')} / ${t('chat.outputTokens')}:</span>
          <span>${metrics.input ?? '—'} / ${metrics.output ?? '—'}</span>
        </div>
        <div style="display: flex; justify-content: space-between; color: var(--text-secondary);">
          <span>${t('chat.cacheHit')}:</span>
          <span>${cacheHitText ? `${cacheHitText} (${metrics.cacheRead ?? 0})` : '—'}</span>
        </div>
      </div>
    </div>
  `;
}

export function renderMessage(
  m: MessageViewModel,
  _agentDisplayName = 'HERMES AGENT',
  options: { isFirstInTurn?: boolean; isLastInTurn?: boolean; isStreaming?: boolean } = {}
): string {
  const isUser = m.role === 'user';
  const isFirstInTurn = options.isFirstInTurn ?? true;
  const isLastInTurn = options.isLastInTurn ?? true;
  const isStreaming = options.isStreaming ?? false;
  const isOrdinarySession = !m.isGroupRoom && !m.isBotRoom;

  if (isUser) {
    return `
      <div class="message-row user-row" data-msg-id="${m.id}" data-row-id="${m.rowId ?? ''}" style="display: flex; flex-direction: column; align-items: flex-end; width: 100%; margin: 6px 0;">
        <div class="user-bubble" style="
          max-width: 82%;
          background: var(--chat-user-message-bg, var(--bg-card));
          border: 1px solid var(--border-medium);
          border-radius: 12px 12px 3px 12px;
          padding: 10px 14px;
          color: var(--text-main);
          font-size: 13.5px;
          line-height: 1.55;
          box-shadow: var(--shadow-card);
          word-break: break-word;
        ">
          ${escapeHtml(m.content)}
        </div>
        <!-- User Row Micro Action Bar (Pure Icon Buttons with Tooltips) -->
        <div class="user-action-bar" style="
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 3px;
          padding-right: 4px;
          font-size: 10.5px;
          font-family: var(--font-mono);
          color: var(--text-muted);
        ">
          ${m.timestamp ? `<span class="msg-timestamp" style="opacity: 0.8; font-size: 10px; margin-right: 2px;">${escapeHtml(m.timestamp)}</span>` : ''}
          <button class="msg-action-btn" data-action="copy-msg" data-content="${escapeHtml(m.content)}" title="${t('chat.copy')}" aria-label="${t('chat.copy')}" style="
            background: transparent;
            border: none;
            width: 22px;
            height: 22px;
            padding: 0;
            color: var(--text-muted);
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            transition: color 0.15s ease, background 0.15s ease;
          ">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          </button>
          ${
            isOrdinarySession
              ? `
            <button class="msg-action-btn" data-action="rollback-msg" data-row-id="${m.rowId ?? ''}" data-msg-id="${m.id}" data-content="${escapeHtml(m.content)}" title="${t('chat.rollback')}" aria-label="${t('chat.rollback')}" style="
              background: transparent;
              border: none;
              width: 22px;
              height: 22px;
              padding: 0;
              color: var(--text-muted);
              cursor: pointer;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              border-radius: 4px;
              transition: color 0.15s ease, background 0.15s ease;
            ">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            </button>
            <button class="msg-action-btn" data-action="fork-msg" data-msg-id="${m.id}" title="${t('chat.fork')}" aria-label="${t('chat.fork')}" style="
              background: transparent;
              border: none;
              width: 22px;
              height: 22px;
              padding: 0;
              color: var(--text-muted);
              cursor: pointer;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              border-radius: 4px;
              transition: color 0.15s ease, background 0.15s ease;
            ">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
            </button>
          `
              : ''
          }
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
      gap: 2px;
      width: 100%;
      margin: 1px 0;
    ">
      <!-- Turn Header Time & Sender Badge -->
      ${
        isFirstInTurn
          ? `
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 3px;">
          ${
            m.sender && m.sender !== 'user'
              ? `
            <div class="message-sender-badge" style="display: inline-flex; align-items: center; gap: 6px; padding: 2px 7px 2px 3px; background: var(--bg-panel); border: 1px solid var(--border-subtle); border-radius: 12px;">
              ${renderBotAvatar(m.sender, m.sender, m.senderAvatar, 18)}
              <span style="font-size: 11.5px; font-weight: 600; color: var(--text-main); line-height: 1.2;">${escapeHtml(m.sender)}</span>
            </div>
          `
              : ''
          }
          ${
            m.timestamp
              ? `<span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); opacity: 0.85;">${escapeHtml(m.timestamp)}</span>`
              : ''
          }
        </div>
      `
          : ''
      }

      <!-- Thinking Fold -->
      ${renderThinkingFold(m)}

      <!-- Tool Execution Capsules (常驻增量锚点，流式期间由补丁通道直写) -->
      <div id="msg-tools-${m.id}" class="tool-capsules-slot">
        ${renderToolCapsules(virtualMsg)}
      </div>

      <!-- Core Content (Incremental Anchor) -->
      ${
        cleanContent && cleanContent.trim()
          ? `
        <div id="msg-content-${m.id}" class="assistant-content prose-block" style="
          color: var(--text-main);
          font-size: 13.5px;
          line-height: 1.58;
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 3px;
        ">
          ${renderMarkdown(cleanContent)}
        </div>
      `
          : `
        <div id="msg-content-${m.id}" class="assistant-content prose-block" style="
          color: var(--text-main);
          font-size: 13.5px;
          line-height: 1.58;
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 2px;
        "></div>
      `
      }

      <!-- Assistant Row Micro Action Bar & Collapsible Token Metrics -->
      ${
        isLastInTurn && !isStreaming
          ? `
        <div class="assistant-footer-bar" style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: 4px;
          padding-top: 2px;
          font-size: 11px;
          font-family: var(--font-mono);
          color: var(--text-muted);
        ">
          <div style="display: flex; align-items: center; gap: 6px;">
            <button class="msg-action-btn" data-action="copy-msg" data-content="${escapeHtml(cleanContent)}" title="${t('chat.copy')}" aria-label="${t('chat.copy')}" style="
              background: transparent;
              border: none;
              width: 22px;
              height: 22px;
              padding: 0;
              color: var(--text-muted);
              cursor: pointer;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              border-radius: 4px;
              transition: color 0.15s ease, background 0.15s ease;
            ">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            </button>
            ${
              isOrdinarySession
                ? `
              <button class="msg-action-btn" data-action="fork-msg" data-msg-id="${m.id}" title="${t('chat.fork')}" aria-label="${t('chat.fork')}" style="
                background: transparent;
                border: none;
                width: 22px;
                height: 22px;
                padding: 0;
                color: var(--text-muted);
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
                transition: color 0.15s ease, background 0.15s ease;
              ">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
              </button>
            `
                : ''
            }
            ${m.model ? `<span class="meta-tag model-tag" style="padding: 1px 6px; background: var(--bg-panel); border: 1px solid var(--border-subtle); border-radius: 10px; font-size: 10px;">${escapeHtml(m.model)}</span>` : ''}
            ${m.durationMs ? `<span class="meta-tag duration-tag" style="opacity: 0.8; font-size: 10px;">${(m.durationMs / 1000).toFixed(1)}s</span>` : ''}
            ${m.timestamp ? `<span class="meta-tag time-tag" style="opacity: 0.7; font-size: 10px;">${escapeHtml(m.timestamp)}</span>` : ''}
          </div>

          <!-- Token Collapsible Metrics -->
          ${renderTokenMetrics(m.tokenMetrics, m.model)}
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
    <details class="timeline-row thinking-row" ${hasThought ? '' : 'style="display: none;"'} style="margin: 1.5px 0;">
      <summary style="
        list-style: none;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 0;
        cursor: pointer;
        user-select: none;
        font-size: 12.5px;
        line-height: 1.4;
      ">
        <span style="color: var(--text-secondary); display: inline-flex; align-items: center; flex-shrink: 0;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
          </svg>
        </span>
        <span style="font-weight: 500; color: var(--text-main); flex-shrink: 0;">${t('chat.thought')}</span>
        ${durationBadge}
        <span style="color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
          ${escapeHtml(summary)}
        </span>
      </summary>
      <div id="msg-thought-${m.id}" style="
        margin-left: 7px;
        margin-top: 2px;
        margin-bottom: 3px;
        padding-left: 12px;
        border-left: 2px solid rgba(255, 255, 255, 0.08);
        color: #9CA3AF;
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
      ">${escapeHtml(m.thought || '')}</div>
    </details>
  `;
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

function getFileBadge(pathStr: string): string {
  const match = pathStr.match(/\.([a-zA-Z0-9]+)(?:$|[?#:])/);
  if (!match) return '';
  const ext = match[1].toLowerCase();
  
  // OpenChamber 经典微距胶囊：带语义底色与清晰文字对比，全走 CSS 变量 Token
  const baseStyle = 'display: inline-flex; align-items: center; justify-content: center; font-size: 9.5px; font-weight: 700; padding: 1px 4.5px; border-radius: 4px; font-family: var(--font-mono); line-height: 1.2; flex-shrink: 0; letter-spacing: 0.02em;';

  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return `<span style="${baseStyle} background: var(--badge-js-bg, var(--accent-subtle)); color: var(--badge-js-text, var(--accent)); border: 1px solid var(--badge-js-border, var(--border-subtle));">JS</span>`;
    case 'ts':
    case 'mts':
    case 'cts':
    case 'tsx':
      return `<span style="${baseStyle} background: var(--badge-ts-bg, var(--accent-subtle)); color: var(--badge-ts-text, var(--accent)); border: 1px solid var(--badge-ts-border, var(--border-subtle));">TS</span>`;
    case 'py':
      return `<span style="${baseStyle} background: var(--badge-py-bg, var(--accent-subtle)); color: var(--badge-py-text, var(--accent)); border: 1px solid var(--badge-py-border, var(--border-subtle));">PY</span>`;
    case 'json':
      return `<span style="${baseStyle} background: rgba(255, 255, 255, 0.06); color: var(--text-secondary); border: 1px solid var(--border-subtle);">JSON</span>`;
    case 'md':
    case 'markdown':
      return `<span style="${baseStyle} background: rgba(255, 255, 255, 0.06); color: var(--text-secondary); border: 1px solid var(--border-subtle);">MD</span>`;
    case 'html':
    case 'htm':
      return `<span style="${baseStyle} background: var(--badge-html-bg, var(--accent-subtle)); color: var(--badge-html-text, var(--accent)); border: 1px solid var(--badge-html-border, var(--border-subtle));">HTML</span>`;
    case 'css':
    case 'scss':
      return `<span style="${baseStyle} background: var(--badge-css-bg, var(--accent-subtle)); color: var(--badge-css-text, var(--accent)); border: 1px solid var(--badge-css-border, var(--border-subtle));">CSS</span>`;
    default:
      return `<span style="${baseStyle} background: rgba(255, 255, 255, 0.05); color: var(--text-muted); border: 1px solid var(--border-subtle);">${ext.toUpperCase().slice(0, 4)}</span>`;
  }
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
    // Search Files 为搜索检索工具，非只读文件预览工具，禁止绑定文件链接，允许展开详情查阅搜索结果
    isFileTool = false;
    isReadOnly = false;
    iconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  } else if (rawName.includes('glob') || rawName.includes('find')) {
    displayName = 'Find Files';
    isFileTool = false;
    isReadOnly = false;
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
      // gate-degrade: 参数无法结构化时保留原始字符串作为展示值
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
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+/g, '/');
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

  const rawDisplay = cleanArgs && cleanArgs !== '{}' && cleanArgs !== '[object Object]' ? cleanArgs : '';
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
        margin: 1px 0;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2.5px 7px;
        background: var(--bg-panel);
        border: 1px solid var(--border-subtle);
        border-radius: 6px;
        font-size: 11.5px;
        line-height: 1.38;
        color: var(--text-secondary);
      ">
        <span class="tool-chevron" style="display: inline-flex; align-items: center; justify-content: center; width: 10px; font-size: 9px; color: var(--text-muted); opacity: 0.5; flex-shrink: 0;">
          •
        </span>
        <span style="color: var(--text-secondary); display: inline-flex; align-items: center; flex-shrink: 0; opacity: 0.85;">
          ${iconSvg}
        </span>
        <span style="font-weight: 500; color: var(--text-main); flex-shrink: 0;">${displayName}</span>
        ${
          durationStr
            ? `<span class="tool-duration-badge" ${parsed.status === 'running' && parsed.status && parsed.startTime ? `data-start-time="${parsed.startTime}"` : ''} style="font-size: 10.5px; color: var(--text-muted); font-family: var(--font-mono); flex-shrink: 0; opacity: 0.75;">${escapeHtml(durationStr)}</span>`
            : ''
        }
        ${fileBadge}
        ${
          effectivePath && (isFileTool || isLikelyFilePath(effectivePath))
            ? renderPathLikeGitChanges(effectivePath, true)
            : rawDisplay
            ? `<span style="color: var(--text-muted); font-family: var(--font-mono); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; opacity: 0.85;" title="${escapeHtml(rawDisplay)}">${escapeHtml(truncatedCommand)}</span>`
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
    ? `<span class="tool-duration-badge" ${parsed.status === 'running' && parsed.startTime ? `data-start-time="${parsed.startTime}"` : ''} style="font-size: 10.5px; color: var(--text-muted); font-family: var(--font-mono); flex-shrink: 0; opacity: 0.75;">${escapeHtml(durationStr)}</span>`
    : '';

  return `
    <details class="timeline-row tool-row tool-capsule flux-tool-capsule" style="margin: 1px 0;">
      <summary style="
        list-style: none;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2.5px 7px;
        background: var(--bg-panel);
        border: 1px solid var(--border-subtle);
        border-radius: 6px;
        cursor: pointer;
        user-select: none;
        font-size: 11.5px;
        line-height: 1.38;
        color: var(--text-secondary);
      ">
        <span class="tool-chevron" style="display: inline-flex; align-items: center; justify-content: center; width: 10px; font-size: 9px; color: var(--text-muted); opacity: 0.7; flex-shrink: 0;">
          ▸
        </span>
        <span style="color: var(--text-secondary); display: inline-flex; align-items: center; flex-shrink: 0; opacity: 0.85;">
          ${iconSvg}
        </span>
        <span style="font-weight: 500; color: var(--text-main); flex-shrink: 0;">${displayName}</span>
        ${durationBadge}
        ${fileBadge}
        ${
          effectivePath && (isFileTool || isLikelyFilePath(effectivePath))
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
        background: var(--popover);
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
    <details class="timeline-row tool-row tool-capsule flux-tool-capsule" style="margin: 1px 0;">
      <summary style="
        list-style: none;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2.5px 7px;
        background: var(--bg-panel);
        border: 1px solid var(--border-subtle);
        border-radius: 6px;
        cursor: pointer;
        user-select: none;
        font-size: 11.5px;
        line-height: 1.38;
        color: var(--text-secondary);
      ">
        <span class="tool-chevron" style="display: inline-flex; align-items: center; justify-content: center; width: 10px; font-size: 9px; color: var(--text-muted); opacity: 0.7; flex-shrink: 0;">
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
        padding: 4px 6px;
        border-bottom-left-radius: 6px;
        border-bottom-right-radius: 6px;
        overflow: hidden;
        background: var(--popover);
        border: 1px solid var(--border-subtle);
        border-top: none;
        display: flex;
        flex-direction: column;
        gap: 2px;
      ">
        ${items.map((it) => renderSingleToolCapsule(it)).join('')}
      </div>
    </details>
  `;
}

/**
 * 工具胶囊增量插槽渲染器（供流式期间局部 DOM 直写复用）。
 * 【设计意图 (Why)】全量画布 renderMessage 与流式补丁必须共用同一“工具组合 + 渲染”实现，
 * 否则增量通道与全量收敛会产生形态漂移（历史坑：工具事件不进 messagesChanged 时永久不刷新）。
 * 【约束与规则 (Rules)】返回值即 #msg-tools-<id> 容器 innerHTML；纯函数无副作用。
 */
export function renderToolCapsuleSlot(m: MessageViewModel): string {
  const { extractedTools } = extractToolsFromContent(m.content);
  const combined = [...(m.toolCalls || []), ...(extractedTools || [])];
  return renderToolCapsules({ ...m, toolCalls: combined });
}

function renderToolCapsules(m: MessageViewModel): string {
  if (!m.toolCalls || m.toolCalls.length === 0) return '';
  const parsedItems = m.toolCalls.map(parseToolItem);
  const totalCount = parsedItems.length;
  const runningCount = parsedItems.filter((it) => it.status === 'running').length;
  const completedCount = parsedItems.filter((it) => it.status === 'completed').length;
  const failedCount = parsedItems.filter((it) => it.status === 'failed').length;

  // 1. 若工具只有 1 项，直接展示单工具胶囊，不冗余多层打包
  if (totalCount === 1) {
    return `
      <div class="tool-capsules-group" style="display: flex; flex-direction: column; gap: 2px; margin: 2px 0;">
        ${renderSingleToolCapsule(parsedItems[0])}
      </div>
    `;
  }

  // 2. 存在多项工具调用时，对标官方 Desktop：打包为一个常驻执行卡片（显示正在执行与已执行总揽，默认展开若有正在执行，支持点击折叠/展开）
  const hasRunning = runningCount > 0;
  const runningItem = parsedItems.find((it) => it.status === 'running');
  const activeCommandOrPath = runningItem
    ? runningItem.targetPath || runningItem.cleanArgs || runningItem.displayName
    : '';

  const statusSummaryText = hasRunning
    ? t('tool.executingSummary', { running: String(runningCount), total: String(totalCount), completed: String(completedCount) })
    : failedCount > 0
    ? t('tool.completedWithFailed', { completed: String(completedCount), failed: String(failedCount) })
    : t('tool.completedAll', { completed: String(completedCount) });

  const blocks: string[] = [];
  let i = 0;
  while (i < parsedItems.length) {
    const item = parsedItems[i];
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

  return `
    <div class="tool-capsules-group" style="margin: 3px 0;">
      <details class="tool-execution-package-card" ${hasRunning ? 'open' : ''} style="
        border: 1px solid var(--border-medium);
        border-radius: 8px;
        background: var(--bg-card);
        overflow: hidden;
        box-shadow: var(--shadow-card);
      ">
        <summary style="
          list-style: none;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 10px;
          background: var(--bg-panel);
          cursor: pointer;
          user-select: none;
          font-size: 11.5px;
          font-weight: 600;
          color: var(--text-main);
          border-bottom: 1px solid var(--border-subtle);
        ">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="color: ${hasRunning ? 'var(--accent)' : 'var(--text-secondary)'}; display: inline-flex; align-items: center;">
              ${
                hasRunning
                  // gate-perf-allow: 运行中工具旋转动画
                  ? `<svg class="rotating-tool-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1.5s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`
                  : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`
              }
            </span>
            <span>${t('tool.packageTitle', { count: String(totalCount) })}</span>
            <span style="font-size: 11px; font-weight: normal; color: var(--text-secondary); opacity: 0.85;">${statusSummaryText}</span>
            ${
              hasRunning && activeCommandOrPath && activeCommandOrPath !== '[object Object]'
                ? `
              <span class="tool-active-cmd-badge" style="
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 1px 6px;
                border-radius: 4px;
                background: var(--bg-card);
                border: 1px solid var(--border-subtle);
                font-family: var(--font-mono);
                font-size: 10.5px;
                color: var(--accent);
                max-width: 300px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              " title="${escapeHtml(activeCommandOrPath)}">
                <span style="opacity: 0.6;">$</span>
                <span>${escapeHtml(activeCommandOrPath)}</span>
              </span>
            `
                : ''
            }
          </div>
          <span class="tool-package-chevron" style="font-size: 10px; color: var(--text-muted); opacity: 0.7;">
            ${hasRunning ? t('tool.collapse') : t('tool.expand')}
          </span>
        </summary>

        <div class="tool-package-body" style="padding: 4px 6px; display: flex; flex-direction: column; gap: 3px; background: var(--bg-window);">
          ${blocks.join('')}
        </div>
      </details>
    </div>
  `;
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
      // gate-degrade: 无法从参数解析路径时留空，由后续 normalizeToolOutput 补齐
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
      // gate-degrade: 输出无法解析成结构化字段时按原文展示
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
    } else if (cand !== undefined && cand !== null) {
      str = typeof cand === 'object' ? JSON.stringify(cand, null, 2) : String(cand).trim();
    } else {
      str = JSON.stringify(rec, null, 2);
    }
  } else {
    str = String(output).trim();
  }

  if (str === '[object Object]') {
    str = '';
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

export function renderMarkdown(md: string): string {
  return renderMarkdownCore(md);
}
