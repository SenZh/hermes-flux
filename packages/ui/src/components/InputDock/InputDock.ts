/**
 * Hermes Flux Floating Input Dock (v4.5 Refined)
 * Strict Golden Width Constraint:
 * - max-width: 740px; margin: 0 auto;
 * Embedded micro-control strip:
 * - Real model selector with accordion provider dropdown
 * - Reasoning depth: compact pill toggle (循环切换: 关/低/中/高)
 * - Approval mode: compact pill toggle (循环切换: 自动/询问/沙箱)
 * - Attachment tray & Pending queue tray
 * - Slash (/), Mention (@) Poppers
 */

import { t } from '../../i18n/index.js';

export interface InputAttachmentItem {
  id: string;
  name: string;
  label?: string;
  type: 'image' | 'file' | 'pdf';
  previewUrl?: string;
  sizeBytes?: number;
  filePath?: string;
  contentBase64?: string;
}

export interface InputQueuedItem {
  id: string;
  text: string;
  model?: string;
  attachmentsCount?: number;
}

export interface SlashCommandOption {
  name: string;
  description: string;
  isSkill?: boolean;
  /** 网关 complete.slash 的替换起始列；点选时据此精确替换光标 token */
  replaceFrom?: number;
}

export interface MentionReferenceOption {
  type: 'file' | 'agent';
  name: string;
  detail?: string;
  avatar?: string;
}

export interface RollbackBannerView {
  removedCount: number;
  anchorLabel: string;
}

export interface InputDockProps {
  selectedModel: string;
  models?: string[];
  modelDetails?: Array<{
    id: string;
    provider: string;
    name: string;
    displayName: string;
    contextLength?: number;
    supportsVision?: boolean;
  }>;
  favoriteModels?: string[];
  recentModels?: string[];
  modelSearchQuery?: string;
  collapsedProviders?: string[];
  reasoningLevel: 'default' | 'none' | 'low' | 'high' | 'max' | 'off' | 'medium';
  approvalMode: 'auto' | 'ask' | 'sandbox';
  isStreaming: boolean;
  disabled?: boolean;
  modelMenuOpen?: boolean;
  notice?: string;
  activityStatus?: string;
  attachments?: InputAttachmentItem[];
  queuedMessages?: InputQueuedItem[];
  slashPopperOpen?: boolean;
  slashItems?: SlashCommandOption[];
  mentionPopperOpen?: boolean;
  mentionItems?: MentionReferenceOption[];
  rollbackBanner?: RollbackBannerView | null;
}

export function renderRollbackNoticeBar(banner?: RollbackBannerView | null): string {
  if (!banner) return '';
  return `
    <div class="rollback-pending-banner" data-rollback-pending="true" data-count="${banner.removedCount}" style="
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 7px 12px;
      background: var(--bg-backdrop);
      border: 1px solid var(--border-medium);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 10px;
      font-size: 11.5px;
      color: var(--text-main);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
      animation: flux-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    ">
      <span style="display: inline-flex; align-items: center; gap: 8px; min-width: 0;">
        <span aria-hidden="true" style="color: var(--accent); font-weight: 700; font-size: 13px;">↺</span>
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;">${t('chat.rollbackArmed', { count: banner.removedCount, anchor: banner.anchorLabel })}</span>
      </span>
      <button class="rollback-banner-cancel" data-action="rollback-cancel" type="button" style="
        background: transparent;
        border: none;
        border-radius: 4px;
        color: var(--accent);
        font-size: 11.5px;
        font-weight: 600;
        padding: 4px 8px;
        cursor: pointer;
        white-space: nowrap;
        transition: opacity 0.15s ease;
      ">${t('chat.rollbackCancel')}</button>
    </div>
  `;
}

export function renderDockNoticeBar(notice?: string): string {
  const clean = (notice || '').trim();
  if (!clean) return '';
  return `
    <div id="dock-notice" role="status" style="
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 11.5px;
      line-height: 1.4;
      color: var(--text-secondary);
      background: var(--bg-backdrop);
      border: 1px solid var(--border-medium);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 10px;
      padding: 7px 12px;
      word-break: break-word;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
      animation: flux-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    ">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="color: var(--accent); font-size: 12px;">ℹ</span>
        <span style="font-weight: 500;">${escapeHtml(clean)}</span>
      </div>
      <button id="dock-notice-close" type="button" aria-label="${t('dock.noticeClose')}" title="${t('dock.noticeClose')}" style="
        background: transparent;
        border: none;
        cursor: pointer;
        color: var(--text-muted);
        opacity: 0.75;
        padding: 4px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 24px;
        min-height: 24px;
        border-radius: 4px;
        font-size: 14px;
        line-height: 1;
        transition: opacity 0.15s ease;
      ">×</button>
    </div>
  `;
}

export function renderInputDock(props: InputDockProps): string {
  const isStreaming = Boolean(props.isStreaming);
  const modelMenuOpen = Boolean(props.modelMenuOpen);
  const notice = (props.notice || '').trim();
  const activityStatus = (props.activityStatus || '').trim();

  // Model display label
  const selectedDetail = props.modelDetails?.find((m) => m.id === props.selectedModel);
  const modelLabel = selectedDetail ? selectedDetail.displayName || selectedDetail.name : props.selectedModel || 'Hermes Agent';

  const activityPillHtml = activityStatus
    ? `
      <div class="agent-activity-pill" style="
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: var(--bg-backdrop);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid var(--border-medium);
        border-radius: 9999px;
        padding: 3px 12px;
        font-size: 11px;
        color: var(--text-main);
        margin-bottom: 8px;
        pointer-events: auto;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25), var(--specular-line);
        user-select: none;
        animation: flux-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      ">
        <span class="activity-status-dot" style="
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #10B981;
          box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
          display: inline-block;
          animation: flux-pulse 2s infinite ease-in-out;
        "></span>
        <span style="font-weight: 500; letter-spacing: -0.01em;">${escapeHtml(modelLabel)}</span>
        <span style="color: var(--text-muted); opacity: 0.5;">·</span>
        <span style="color: var(--text-secondary); font-family: var(--font-mono, monospace); font-size: 10.5px;">${escapeHtml(activityStatus)}</span>
      </div>
    `
    : '';

  const rollbackBarHtml = renderRollbackNoticeBar(props.rollbackBanner);
  const dockNoticeHtml = renderDockNoticeBar(notice);
  const hasNotices = Boolean(rollbackBarHtml || dockNoticeHtml);

  const reasoningLabels: Record<string, string> = {
    default: '默认',
    none: 'None',
    off: 'None',
    low: 'Low',
    medium: 'High',
    high: 'High',
    max: 'Max',
  };

  const approvalLabels: Record<string, string> = {
    auto: '自动',
    ask: '询问',
    sandbox: '沙箱',
  };

  return `
    <div class="input-dock-container" style="
      position: absolute;
      bottom: 20px;
      left: 0;
      right: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0 24px;
      pointer-events: none;
      z-index: 40;
    ">
      ${activityPillHtml}

      <!-- Queue Tray (if any queued messages) -->
      ${renderQueueTray(props.queuedMessages)}

      <!-- Notice Stack (Rollback Banner & Timed Dock Notices strictly above composer box) -->
      ${
        hasNotices
          ? `<div class="dock-notice-stack" style="
              width: 100%;
              max-width: 740px;
              display: flex;
              flex-direction: column;
              gap: 6px;
              margin-bottom: 8px;
              pointer-events: auto;
              box-sizing: border-box;
            ">
              ${rollbackBarHtml}
              ${dockNoticeHtml}
            </div>`
          : ''
      }

      <div class="input-card-box composer-dock" style="
        pointer-events: auto;
        position: relative;
        box-sizing: border-box;
        width: 100%;
        max-width: 740px; /* 黄金限宽 740px 约束 */
        margin: 0 auto;
        background: var(--bg-backdrop);
        backdrop-filter: blur(28px);
        -webkit-backdrop-filter: blur(28px);
        border: 1px solid var(--border-medium);
        box-shadow: var(--shadow-dock), var(--specular-line);
        border-radius: 14px;
        padding: 12px 16px 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      ">
        <!-- Popper 固定挂载点：开合只替换本占位子树，绝不重建 textarea（键盘时序军规） -->
        <div id="composer-popper-mount">${renderSlashPopper(props.slashItems, props.slashPopperOpen)}${renderMentionPopper(props.mentionItems, props.mentionPopperOpen)}</div>

        <!-- Attachment Tray (if any attachments pending send) -->
        ${renderAttachmentTray(props.attachments)}

        <!-- Textarea Container & Smart Collapse Button -->
        <div style="position: relative; display: flex; flex-direction: column;">
          <textarea id="dock-prompt-input" rows="2" placeholder="${props.disabled ? '请先连接网关...' : '给 Hermes 下达任务... (Enter 发送, Shift+Enter 换行, 支持 Ctrl+V 粘贴/拖入附件, / 命令, @ 引用)'}" ${props.disabled ? 'disabled' : ''} style="
            width: 100%;
            min-height: 48px;
            max-height: 240px;
            border: none;
            background: transparent;
            color: var(--text-main);
            font-family: inherit;
            font-size: 13.5px;
            line-height: 1.5;
            resize: none;
            outline: none;
            box-sizing: border-box;
            overflow-y: auto;
            transition: height 0.12s ease;
          "></textarea>

          <button id="dock-input-collapse-toggle" type="button" style="
            display: none;
            align-self: flex-end;
            margin-top: 4px;
            background: var(--bg-panel);
            border: 1px solid var(--border-subtle);
            border-radius: 4px;
            color: var(--text-secondary);
            font-size: 11px;
            padding: 2px 8px;
            cursor: pointer;
            transition: all 0.12s ease;
          ">${t('dock.collapse')}</button>
        </div>

        <!-- Embedded Micro-Control Strip (Height: 28px) -->
        <div class="input-control-strip" style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 28px;
          padding-top: 6px;
          border-top: 1px solid var(--border-subtle);
        ">
          <!-- Left Control Pills -->
          <div style="display: flex; align-items: center; gap: 8px;">
            <!-- 1. Model Selector Pill -->
            <div class="pill-dropdown-wrapper" style="position: relative;">
              <button id="dock-model-selector-btn" class="micro-pill" title="点击切换模型" style="
                height: 24px;
                padding: 0 9px;
                border-radius: 6px;
                background: var(--bg-card);
                border: 1px solid var(--border-subtle);
                color: var(--text-main);
                font-size: 11px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 5px;
                cursor: pointer;
                transition: background 0.15s ease, border-color 0.15s ease;
              ">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent); flex-shrink: 0;"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/></svg>
                <span id="current-model-label">${escapeHtml(props.selectedModel || '选择模型')}</span>
                <span style="font-size: 8px; color: var(--text-muted); margin-left: 1px;">▾</span>
              </button>

              <div id="dock-model-dropdown" class="model-dropdown-menu" style="
                display: ${modelMenuOpen ? 'block' : 'none'};
                position: absolute;
                bottom: 34px;
                left: 0;
                width: 320px;
                background: var(--bg-card);
                border: 1px solid var(--border-strong);
                border-radius: 12px;
                box-shadow: var(--shadow-window), 0 0 0 1px var(--border-subtle);
                overflow: hidden;
                z-index: 200;
                user-select: none;
              ">
                <!-- Top Action & Search Bar -->
                <div style="padding: 10px 10px 6px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-surface-1);">
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                    <span id="btn-add-provider" style="font-size: 11.5px; color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; gap: 4px;">
                      <span style="font-size: 13px;">+</span> 添加新提供商
                    </span>
                    <span id="btn-refresh-models" style="font-size: 11px; color: var(--text-muted); cursor: pointer;" title="刷新列表">刷新 ↻</span>
                  </div>
                  <div style="position: relative; display: flex; align-items: center;">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position: absolute; left: 9px; color: var(--text-muted);"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input id="dock-model-search-input" type="text" placeholder="搜索模型" value="${escapeHtml(props.modelSearchQuery || '')}" style="
                      width: 100%;
                      height: 28px;
                      padding: 0 10px 0 28px;
                      border-radius: 6px;
                      border: 1px solid var(--border-medium);
                      background: var(--bg-panel);
                      color: var(--text-main);
                      font-size: 12px;
                      outline: none;
                      box-sizing: border-box;
                    " />
                  </div>
                </div>

                <!-- Scrollable Model Tree List (Accordion by Provider) -->
                <div id="model-picker-scroll-list" style="max-height: 320px; overflow-y: auto; padding: 6px 0;">
                  ${renderModelPickerTree(props)}
                </div>

                <!-- Bottom Navigation Hint -->
                <div style="
                  padding: 6px 12px;
                  border-top: 1px solid var(--border-subtle);
                  background: var(--bg-surface-1);
                  font-size: 10.5px;
                  color: var(--text-muted);
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                ">
                  <span>↑↓ 选择模型</span>
                  <span>Esc 关闭</span>
                </div>
              </div>
            </div>

            <!-- 2. Reasoning Dropdown Pill -->
            <div class="pill-dropdown-wrapper" style="position: relative;">
              <button id="dock-reasoning-toggle-btn" class="micro-pill" title="选择思考深度" style="
                height: 24px;
                padding: 0 8px;
                border-radius: 6px;
                background: var(--bg-card);
                border: 1px solid var(--border-subtle);
                color: var(--text-main);
                font-size: 11px;
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 5px;
                cursor: pointer;
                transition: background 0.15s ease, border-color 0.15s ease;
              ">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); flex-shrink: 0;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                <span id="current-reasoning-label" style="color: var(--text-main); font-weight: 500;">${reasoningLabels[props.reasoningLevel] || '默认'}</span>
                <span style="font-size: 8px; color: var(--text-muted);">▾</span>
              </button>

              <div id="dock-reasoning-dropdown" class="reasoning-dropdown-menu" style="
                display: none;
                position: absolute;
                bottom: 32px;
                left: 0;
                min-width: 140px;
                background: var(--bg-card);
                border: 1px solid var(--border-medium);
                border-radius: 10px;
                box-shadow: var(--shadow-window);
                padding: 6px;
                max-height: 240px;
                overflow-y: auto;
                z-index: 210;
                user-select: none;
              ">
                <div style="font-size: 11px; font-weight: 700; color: var(--text-main); padding: 4px 8px 6px; border-bottom: 1px solid var(--border-subtle);">思考</div>
                ${['default', 'none', 'low', 'high', 'max']
                  .map((lvl) => {
                    const isSelected = props.reasoningLevel === lvl || (lvl === 'default' && (!props.reasoningLevel || props.reasoningLevel === 'high')) || (lvl === 'none' && props.reasoningLevel === 'off');
                    return `
                  <div class="reasoning-option ${isSelected ? 'active' : ''}" data-level="${lvl}" style="
                    padding: 5px 8px;
                    border-radius: 6px;
                    font-size: 11.5px;
                    color: ${isSelected ? 'var(--accent)' : 'var(--text-main)'};
                    background: ${isSelected ? 'var(--accent-subtle)' : 'transparent'};
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 2px;
                  ">
                    <span>${reasoningLabels[lvl] || lvl}</span>
                    ${isSelected ? '<span style="font-weight: 700; font-size: 11px;">✓</span>' : ''}
                  </div>
                `;
                  })
                  .join('')}
              </div>
            </div>
          </div>

          <!-- Right Action Buttons -->
          <div style="display: flex; align-items: center; gap: 8px;">
            <!-- File Attach -->
            <button id="dock-attach-file-btn" class="icon-btn" title="${t('dock.attachTooltip')}" style="
              background: transparent;
              border: none;
              color: var(--text-muted);
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 4px;
              border-radius: 4px;
              transition: color 0.15s ease;
            ">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            </button>

            <!-- Send Action Button -->
            <button id="dock-send-btn" class="send-action-btn" title="${isStreaming ? '中断本轮生成' : '发送 (Enter)'}" ${props.disabled ? 'disabled' : ''} style="
              height: 28px;
              width: 28px;
              border-radius: 7px;
              background: ${isStreaming ? 'rgba(239, 68, 68, 0.14)' : 'rgba(56, 189, 248, 0.12)'};
              border: 1px solid ${isStreaming ? '#EF4444' : 'rgba(56, 189, 248, 0.38)'};
              color: ${isStreaming ? '#EF4444' : '#0284C7'};
              display: flex;
              align-items: center;
              justify-content: center;
              cursor: ${props.disabled ? 'not-allowed' : 'pointer'};
              box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
              transition: all 0.15s ease;
            ">
              ${
                isStreaming
                  ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`
                  : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * 待发送消息队列挂载托盘 (Queue Tray)
 */
export function renderQueueTray(queued?: InputQueuedItem[]): string {
  if (!queued || queued.length === 0) return '';

  return `
    <div class="pending-queue-tray" style="
      pointer-events: auto;
      width: 100%;
      max-width: 740px;
      margin: 0 auto 6px;
      background: var(--bg-card);
      border: 1px solid var(--border-medium);
      border-radius: 10px;
      padding: 6px 10px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(20px);
      display: flex;
      flex-direction: column;
      gap: 5px;
      animation: flux-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    ">
      <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; font-weight: 600; color: var(--text-secondary); border-bottom: 1px solid var(--border-subtle); padding-bottom: 4px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="color: var(--accent);">⏳</span>
          <span>${t('queue.title')} (${queued.length})</span>
        </div>
        <!-- 强行打断插队动作 -->
        <button class="queue-interrupt-push-btn" data-action="interrupt-and-push" title="${t('queue.interruptAndPush')}" style="
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          color: var(--accent);
          border-radius: 4px;
          padding: 1.5px 6px;
          font-size: 10px;
          font-family: var(--font-mono);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 3px;
        ">
          <span>⚡</span>
          <span>${t('queue.interruptAndPush')}</span>
        </button>
      </div>

      <div class="queue-items-list" style="display: flex; flex-direction: column; gap: 4px; max-height: 120px; overflow-y: auto;">
        ${queued
          .map((item, idx) => {
            const shortText = item.text.length > 50 ? `${item.text.slice(0, 50)}…` : item.text;
            return `
            <div class="queue-item-card" data-queue-id="${item.id}" style="
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 8px;
              padding: 3px 6px;
              background: var(--bg-panel);
              border: 1px solid var(--border-subtle);
              border-radius: 6px;
              font-size: 11px;
              font-family: var(--font-mono);
              color: var(--text-main);
            ">
              <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
                <span style="color: var(--text-muted); font-size: 10px;">#${idx + 1}</span>
                <span style="overflow: hidden; text-overflow: ellipsis;">${escapeHtml(shortText)}</span>
                ${item.model ? `<span style="font-size: 9.5px; padding: 0 4px; background: var(--bg-surface-1); border-radius: 3px; color: var(--text-muted);">${escapeHtml(item.model)}</span>` : ''}
              </div>
              <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                <button class="queue-action-btn" data-action="queue-up" data-queue-id="${item.id}" title="${t('queue.moveUp')}" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 1px 3px;">▲</button>
                <button class="queue-action-btn" data-action="queue-down" data-queue-id="${item.id}" title="${t('queue.moveDown')}" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 1px 3px;">▼</button>
                <button class="queue-action-btn" data-action="queue-edit" data-queue-id="${item.id}" title="${t('queue.edit')}" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 1px 3px; font-size: 10px;">✎</button>
                <button class="queue-action-btn" data-action="queue-cancel" data-queue-id="${item.id}" title="${t('queue.cancel')}" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 1px 3px; font-size: 12px;">×</button>
              </div>
            </div>
          `;
          })
          .join('')}
      </div>
    </div>
  `;
}

/**
 * 待发送附件暂存托盘 (Attachment Tray)
 *
 * 【设计意图 (Why)】
 * 1. 结构化展现用户粘贴或拖入的图片与文档资产；
 * 2. 采用微距双层卡片排版：上部呈现高质量微缩图，下部清晰标注逻辑序列标号（如 Image 1, Doc 1）与原始文件名；
 * 3. 方便 Agent 理解用户提问中针对具体图文指代的精确上下文。
 *
 * 【约束与规则 (Rules)】
 * - 纯 UI 表现层，严禁调用网络或原生 IPC；
 * - 样式使用主题 Token，严禁硬编码颜色值。
 */
export function renderAttachmentTray(attachments?: InputAttachmentItem[]): string {
  if (!attachments || attachments.length === 0) return '';

  let imgIndex = 0;
  let docIndex = 0;

  return `
    <div class="composer-attachment-tray" style="
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding-bottom: 6px;
      margin-bottom: 4px;
      border-bottom: 1px solid var(--border-subtle);
    ">
      ${attachments
        .map((att) => {
          const isImg = att.type === 'image';
          if (isImg) imgIndex++;
          else docIndex++;
          const defaultLabel = isImg ? `Image ${imgIndex}` : `Doc ${docIndex}`;
          const displayLabel = att.label || defaultLabel;

          return `
          <div class="composer-attachment-pill composer-attachment-card" data-att-id="${att.id}" style="
            display: inline-flex;
            flex-direction: column;
            width: 76px;
            background: var(--bg-panel);
            border: 1px solid var(--border-medium);
            border-radius: 6px;
            overflow: hidden;
            position: relative;
            user-select: none;
            transition: border-color 0.15s ease, background 0.15s ease;
          ">
            <!-- Top Thumbnail Box -->
            <div style="
              width: 100%;
              height: 48px;
              background: var(--bg-card);
              display: flex;
              align-items: center;
              justify-content: center;
              position: relative;
              overflow: hidden;
            ">
              ${
                isImg && att.previewUrl
                  ? `<img src="${att.previewUrl}" alt="${escapeHtml(att.name)}" style="width: 100%; height: 100%; object-fit: cover;" />`
                  : `<span style="font-size: 20px; line-height: 1; color: var(--accent); opacity: 0.85;">${att.type === 'pdf' ? '📕' : '📄'}</span>`
              }
              <button class="btn-remove-attachment" data-att-id="${att.id}" title="${t('common.remove')}" aria-label="${t('common.remove')}" style="
                position: absolute;
                top: 2px;
                right: 2px;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: var(--bg-backdrop);
                color: var(--text-main);
                border: 1px solid var(--border-subtle);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
                line-height: 1;
                cursor: pointer;
                padding: 0;
                opacity: 0.8;
                transition: opacity 0.15s ease, transform 0.1s ease;
              ">×</button>
            </div>
            <!-- Bottom Metadata Label & Filename -->
            <div style="
              padding: 3px 4px 4px;
              display: flex;
              flex-direction: column;
              gap: 1px;
              background: var(--bg-panel);
            ">
              <span class="attachment-index-label" style="
                font-size: 9.5px;
                font-weight: 700;
                font-family: var(--font-mono);
                color: var(--accent);
                line-height: 1.2;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              ">${escapeHtml(displayLabel)}</span>
              <span class="attachment-filename-label" title="${escapeHtml(att.name)}" style="
                font-size: 9px;
                font-family: var(--font-sans);
                color: var(--text-muted);
                line-height: 1.2;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              ">${escapeHtml(att.name)}</span>
            </div>
          </div>
        `;
        })
        .join('')}
    </div>
  `;
}

/**
 * 斜杠命令补全悬浮面板 (Slash Command Popper)
 */
export function renderSlashPopper(items?: SlashCommandOption[], open = false): string {
  if (!open || !items || items.length === 0) return '';

  return `
    <div class="composer-slash-popper" style="
      position: absolute;
      bottom: calc(100% + 6px);
      left: 12px;
      width: 260px;
      max-height: 220px;
      overflow-y: auto;
      background: var(--bg-card);
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      box-shadow: var(--shadow-window);
      padding: 4px;
      z-index: 100;
      user-select: none;
      backdrop-filter: blur(20px);
    ">
      <div style="font-size: 10.5px; font-weight: 600; color: var(--text-muted); padding: 4px 8px 3px; border-bottom: 1px solid var(--border-subtle);">
        ${t('dock.slashHeader')}
      </div>
      ${items
        .map((cmd) => {
          return `
          <div class="slash-item-option" data-command="${escapeHtml(cmd.name)}" data-replace-from="${cmd.replaceFrom ?? ''}" style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 5px 8px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 11.5px;
            color: var(--text-main);
            transition: background 0.1s ease;
          " onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='transparent'">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="color: var(--accent); font-weight: 600; font-family: var(--font-mono);">${escapeHtml(cmd.name)}</span>
              ${cmd.isSkill ? '<span style="font-size: 9px; padding: 1px 4px; background: var(--accent-subtle); color: var(--accent); border-radius: 3px;">SKILL</span>' : ''}
            </div>
            <span style="font-size: 10.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px;">${escapeHtml(cmd.description)}</span>
          </div>
        `;
        })
        .join('')}
    </div>
  `;
}

/**
 * @ 智能引用补全悬浮面板 (Mention Popper)
 */
export function renderMentionPopper(items?: MentionReferenceOption[], open = false): string {
  if (!open || !items || items.length === 0) return '';

  return `
    <div class="composer-mention-popper" style="
      position: absolute;
      bottom: calc(100% + 6px);
      left: 12px;
      width: 280px;
      max-height: 220px;
      overflow-y: auto;
      background: var(--bg-card);
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      box-shadow: var(--shadow-window);
      padding: 4px;
      z-index: 100;
      user-select: none;
      backdrop-filter: blur(20px);
    ">
      <div style="font-size: 10.5px; font-weight: 600; color: var(--text-muted); padding: 4px 8px 3px; border-bottom: 1px solid var(--border-subtle);">
        ${t('dock.mentionHeader')}
      </div>
      ${items
        .map((m) => {
          const isFile = m.type === 'file';
          return `
          <div class="mention-item-option" data-mention="${escapeHtml(m.name)}" data-type="${m.type}" style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 5px 8px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 11.5px;
            color: var(--text-main);
            transition: background 0.1s ease;
          " onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='transparent'">
            <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis;">
              <span style="color: ${isFile ? 'var(--text-muted)' : 'var(--accent)'}; font-size: 12px;">${isFile ? '📄' : '🤖'}</span>
              <span style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(m.name)}</span>
            </div>
            ${m.detail ? `<span style="font-size: 10px; color: var(--text-muted); flex-shrink: 0;">${escapeHtml(m.detail)}</span>` : ''}
          </div>
        `;
        })
        .join('')}
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

function formatContextLength(tokens?: number): string {
  if (!tokens || typeof tokens !== 'number') return '';
  if (tokens >= 10000) {
    const wan = (tokens / 10000).toFixed(1).replace(/\.0$/, '');
    return `${wan}万`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(0)}k`;
  }
  return String(tokens);
}

/**
 * Provider 折叠手风琴模型选择器 (Provider Accordion)
 */
export function renderModelPickerTree(props: InputDockProps): string {
  const query = (props.modelSearchQuery || '').trim().toLowerCase();
  let allDetails = props.modelDetails && props.modelDetails.length > 0 ? props.modelDetails : [];
  if (allDetails.length === 0 && props.models && props.models.length > 0) {
    allDetails = props.models.map((m) => ({
      id: m,
      provider: 'DEFAULT',
      name: m,
      displayName: m,
    }));
  }
  const favorites = new Set(props.favoriteModels || []);
  const recents = props.recentModels || [];
  const collapsedSet = new Set(props.collapsedProviders || []);

  // Filter models by search query
  const filtered = allDetails.filter((d) => {
    if (!query) return true;
    return (
      d.id.toLowerCase().includes(query) ||
      d.name.toLowerCase().includes(query) ||
      d.provider.toLowerCase().includes(query)
    );
  });

  // Group by provider
  const providerGroups: Record<string, typeof allDetails> = {};
  for (const d of filtered) {
    const p = d.provider || 'OTHER';
    if (!providerGroups[p]) providerGroups[p] = [];
    providerGroups[p].push(d);
  }

  // Favorite items
  const favoriteItems = allDetails.filter((d) => favorites.has(d.id));

  // Recent items
  const recentItems = recents
    .map((rId) => allDetails.find((d) => d.id === rId))
    .filter((d): d is NonNullable<typeof d> => Boolean(d));

  return `
    <!-- 1. Favorites Section -->
    ${
      !query && favoriteItems.length > 0
        ? `
      <div class="model-picker-section" style="margin-bottom: 6px;">
        <div style="padding: 4px 12px; font-size: 11px; font-weight: 700; color: #38BDF8; display: flex; align-items: center; gap: 6px;">
          <span>★</span>
          <span>收藏</span>
        </div>
        ${favoriteItems.map((item) => renderModelItemRow(item, props.selectedModel, true)).join('')}
      </div>
    `
        : ''
    }

    <!-- 2. Recents Section -->
    ${
      !query && recentItems.length > 0
        ? `
      <div class="model-picker-section" style="margin-bottom: 6px;">
        <div style="padding: 4px 12px; font-size: 11px; font-weight: 700; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
          <span>🕒</span>
          <span>最近</span>
        </div>
        ${recentItems.map((item) => renderModelItemRow(item, props.selectedModel, favorites.has(item.id))).join('')}
      </div>
    `
        : ''
    }

    <!-- 3. Provider Grouped Sections (Accordion Foldable) -->
    ${
      Object.keys(providerGroups).length > 0
        ? Object.entries(providerGroups)
            .map(([providerName, models]) => {
              const upperName = providerName.toUpperCase();
              const isCollapsed = collapsedSet.has(providerName);
              let icon = '⬡';
              if (upperName.includes('OPENCODE')) icon = '📱';
              else if (upperName.includes('CURSOR')) icon = '⬡';
              else if (upperName.includes('ANTHROPIC') || upperName.includes('CLAUDE')) icon = '🧠';
              else if (upperName.includes('OPENAI')) icon = '⚡';
              else if (upperName.includes('DEEPSEEK')) icon = '🐋';

              return `
            <div class="model-provider-group" data-provider="${escapeHtml(providerName)}" style="margin-bottom: 6px;">
              <!-- Accordion Header -->
              <div class="model-provider-group-header" data-provider="${escapeHtml(providerName)}" style="
                padding: 5px 12px;
                font-size: 11px;
                font-weight: 700;
                color: var(--text-muted);
                letter-spacing: 0.04em;
                display: flex;
                align-items: center;
                justify-content: space-between;
                background: var(--bg-surface-1);
                cursor: pointer;
                user-select: none;
              ">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span style="opacity: 0.5;">::</span>
                  <span>${icon}</span>
                  <span>${escapeHtml(upperName)}</span>
                  <span style="font-size: 10px; color: var(--text-muted); font-weight: 400;">(${models.length})</span>
                </div>
                <span class="provider-accordion-arrow" style="font-size: 9px; opacity: 0.6;">${isCollapsed ? '▸' : '▾'}</span>
              </div>
              <!-- Accordion Body -->
              <div class="model-provider-items" style="display: ${isCollapsed ? 'none' : 'block'};">
                ${models.map((item) => renderModelItemRow(item, props.selectedModel, favorites.has(item.id))).join('')}
              </div>
            </div>
          `;
            })
            .join('')
        : '<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 12px;">未找到匹配的模型</div>'
    }
  `;
}

export function renderModelPickerMenu(props: InputDockProps): string {
  return renderModelPickerTree(props);
}

function renderModelItemRow(
  item: { id: string; provider: string; name: string; contextLength?: number; supportsVision?: boolean },
  selectedModel: string,
  isFav: boolean
): string {
  const isSelected = item.id === selectedModel;
  const contextBadge = item.contextLength ? formatContextLength(item.contextLength) : '';

  return `
    <div class="model-option ${isSelected ? 'active' : ''}" data-model="${escapeHtml(item.id)}" data-provider="${escapeHtml(item.provider)}" style="
      padding: 6px 12px;
      font-size: 12px;
      color: ${isSelected ? 'var(--accent)' : 'var(--text-main)'};
      background: ${isSelected ? 'var(--accent-subtle)' : 'transparent'};
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: background 0.1s ease;
    " onmouseenter="if (!this.classList.contains('active')) this.style.background='var(--bg-hover)'" onmouseleave="if (!this.classList.contains('active')) this.style.background='transparent'">
      <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        <span class="btn-toggle-favorite" data-model="${escapeHtml(item.id)}" style="
          color: ${isFav ? 'var(--accent)' : 'var(--text-faint)'};
          font-size: 12px;
          cursor: pointer;
          flex-shrink: 0;
        ">${isFav ? '★' : '☆'}</span>
        <span style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; color: inherit;">${escapeHtml(item.name || item.id)}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
        ${item.supportsVision ? '<span style="font-size: 9.5px; padding: 0 4px; background: var(--accent-subtle); color: var(--accent); border-radius: 3px;">VISION</span>' : ''}
        ${
          contextBadge
            ? `<span style="font-size: 10.5px; color: var(--text-muted); font-family: var(--font-mono);">${contextBadge}</span>`
            : ''
        }
        ${isSelected ? '<span style="font-size: 11px; color: var(--accent); font-weight: 700;">✓</span>' : ''}
      </div>
    </div>
  `;
}

/**
 * 输入舱渲染快照接口 (RenderInputDockSnapshot)
 * 用于判断输入舱视觉与交互状态是否发生实质演变，防止非输入舱操作导致 DOM 物理全量重排
 */
export interface RenderInputDockSnapshot {
  selectedModel: string;
  reasoningLevel: string;
  approvalMode: string;
  isStreaming: boolean;
  disabled: boolean;
  modelMenuOpen: boolean;
  notice: string;
  activityStatus?: string;
  modelCount: number;
  modelSearchQuery: string;
  recentModelsHash: string;
  favoriteModelsHash: string;
  attachmentsCount?: number;
  attachmentsHash?: string;
  rollbackArmedHash?: string;
}

/**
 * 输入舱快照演变判断纯函数 (hasDockSnapshotChanged)
 *
 * 【设计意图 (Why)】
 * 在主工作台渲染管道中精确比对输入舱核心属性，只有在自身属性改变时才允许替换 outerHTML，
 * 保护 <textarea id="dock-prompt-input"> 原生 DOM 节点与 Blink Caret 选区拓扑持久稳定。
 *
 * 【防范的历史坑 (Pitfall)】
 * 历史代码每帧无条件执行 outerHTML = nextDockHtml，导致会话删除或列表刷新时输入框瞬间脱卸，
 * 焦点被浏览器重置至 document.body，引发“无光标无法输入文字”。
 * Popper 开合曾被计入本快照，导致每次按键整体重建 dock、textarea 连根替换、IME 组字被打断；
 * 现 Popper 走独立 #composer-popper-mount 子树直写，不再参与 dock 快照比对。
 *
 * 【约束与规则 (Rules)】
 * 仅在快照为 null、或任一影响呈现的物理字段演变时返回 true，未改变时严格返回 false。
 */
export function hasDockSnapshotChanged(
  last: RenderInputDockSnapshot | null | undefined,
  curr: RenderInputDockSnapshot
): boolean {
  if (!last) return true;
  return (
    last.selectedModel !== curr.selectedModel ||
    last.reasoningLevel !== curr.reasoningLevel ||
    last.approvalMode !== curr.approvalMode ||
    last.isStreaming !== curr.isStreaming ||
    last.disabled !== curr.disabled ||
    last.modelMenuOpen !== curr.modelMenuOpen ||
    last.notice !== curr.notice ||
    last.activityStatus !== curr.activityStatus ||
    last.modelCount !== curr.modelCount ||
    last.modelSearchQuery !== curr.modelSearchQuery ||
    last.recentModelsHash !== curr.recentModelsHash ||
    last.favoriteModelsHash !== curr.favoriteModelsHash ||
    last.attachmentsCount !== curr.attachmentsCount ||
    last.attachmentsHash !== curr.attachmentsHash ||
    last.rollbackArmedHash !== curr.rollbackArmedHash
  );
}
