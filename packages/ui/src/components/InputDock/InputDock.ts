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
import { formatModelDisplayName, modelLabelFromCatalog, parseModelDisplay, type ModelCatalogEntry } from '@hermes-flux/core';
import { renderModelVendorIcon, renderProviderVendorIcon, renderVendorIcon } from '../../lib/vendorIcon.js';

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
  /**
   * 归一化模型目录（core `getModelCatalog().entries`）。
   *
   * 【设计意图 (Why)】
   *   这是唯一能同时给出「完整可读名 + 价格 + 能力」的数据源。
   *   传入后输入舱标签与选择器行一律按它渲染，不再从 `models` 裸 ID 现拼字符串。
   *
   * 【规则 (Rules)】
   *   优先级高于 `modelDetails` / `models`；缺失时回退到 core 的纯函数派生。
   */
  modelCatalog?: ModelCatalogEntry[];
  /**
   * 当前 provider slug（网关 `model.options` 根层的 `provider`）。
   *
   * 【规则 (Rules)】
   *   同一模型 ID 可能被多个 provider 提供，显示时以 `(model, provider)` 二元组定位条目；
   *   为空/`auto` 时退化为仅按模型 ID 匹配。
   */
  currentProvider?: string;
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

/**
 * 思考等级归一（唯一真值）
 *
 * 【设计意图 (Why)】
 *   `off` / `medium` 是历史遗留别名：`off` 等价 `none`，`medium` 在网关映射表里落到 `high`。
 *   级联面板只有五档，任何未归一的取值都会导致「五档全暗」——用户看不出当前到底哪一档。
 *
 * 【约束与规则 (Rules)】
 *   纯函数、无副作用；未知取值回退 `default`（而不是留空），保证面板永远有且只有一个高亮项。
 */
export function normalizeReasoningLevel(
  level: InputDockProps['reasoningLevel'] | '' | undefined,
): 'default' | 'none' | 'low' | 'high' | 'max' {
  switch (level) {
    case 'none':
    case 'off':
      return 'none';
    case 'low':
      return 'low';
    case 'medium':
    case 'high':
      return 'high';
    case 'max':
      return 'max';
    default:
      return 'default';
  }
}

export function renderInputDock(props: InputDockProps): string {
  const isStreaming = Boolean(props.isStreaming);
  const modelMenuOpen = Boolean(props.modelMenuOpen);
  const notice = (props.notice || '').trim();

  // Model display label
  // 【规则】统一走 core 派生：目录命中优先，未命中按 ID 派生；绝不把裸 ID 直接显示给用户
  const modelLabel = resolveDockModelLabel(props);
  // 【规则】触发按钮左侧展示当前模型的厂商图标；只有判定出真实厂商才替换齿轮，
  // 判不出（未选模型 / 未知厂商）保留齿轮表示"通用模型入口"，绝不硬套首字母徽标。
  // 这里用 suppressBadge 让渲染层直接返回空串，省掉一次额外的 vendorId 预判。
  const modelIcon = props.selectedModel
    ? renderModelVendorIcon(props.selectedModel, props.currentProvider ?? '', { size: 16, suppressBadge: true })
    : '';

  const rollbackBarHtml = renderRollbackNoticeBar(props.rollbackBanner);
  const dockNoticeHtml = renderDockNoticeBar(notice);
  const hasNotices = Boolean(rollbackBarHtml || dockNoticeHtml);

  const reasoningLabels: Record<string, string> = {
    default: t('dock.reasoningDefault'),
    none: t('dock.reasoningNone'),
    off: t('dock.reasoningNone'),
    low: t('dock.reasoningLow'),
    medium: t('dock.reasoningHigh'),
    high: t('dock.reasoningHigh'),
    max: t('dock.reasoningMax'),
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

      <div class="input-card-box composer-dock">
        <!-- Popper 固定挂载点：开合只替换本占位子树，绝不重建 textarea（键盘时序军规） -->
        <div id="composer-popper-mount">${renderSlashPopper(props.slashItems, props.slashPopperOpen)}${renderMentionPopper(props.mentionItems, props.mentionPopperOpen)}</div>

        <!-- Attachment Tray (if any attachments pending send) -->
        ${renderAttachmentTray(props.attachments)}

        <!-- 编辑器区：与 OpenChamber 一致，只承担输入与内边距 -->
        <div class="composer-dock__editor">
          <textarea id="dock-prompt-input" class="composer-dock__textarea" rows="1" placeholder="${props.disabled ? t('dock.placeholderDisabled') : t('dock.placeholder')}" ${props.disabled ? 'disabled' : ''}></textarea>

          <button id="dock-input-collapse-toggle" class="composer-dock__collapse" type="button" style="display: none;">${t('dock.collapse')}</button>
        </div>

        <!-- Footer：左侧附件，右侧模型 / 思考 / 发送（对标 OpenChamber） -->
        <div class="composer-dock__footer">
          <div class="composer-dock__footer-group">
            <!-- File Attach -->
            <button id="dock-attach-file-btn" class="composer-icon-btn" title="${t('dock.attachTooltip')}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            </button>
          </div>

          <div class="composer-dock__footer-group composer-dock__footer-group--end">
            <!-- 1. Model Selector -->
            <div class="pill-dropdown-wrapper">
              <button id="dock-model-selector-btn" class="composer-ctrl" title="${t('dock.selectModel')}" aria-haspopup="listbox" aria-expanded="${modelMenuOpen ? 'true' : 'false'}">
                ${modelIcon || `<svg class="composer-ctrl__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/></svg>`}
                <span id="current-model-label" class="composer-ctrl__label">${escapeHtml(modelLabel)}</span>
                <span class="composer-ctrl__caret" style="font-size: 9px;">▾</span>
              </button>

              <div id="dock-model-dropdown" class="model-dropdown-menu" style="
                display: ${modelMenuOpen ? 'block' : 'none'};
                position: absolute;
                bottom: calc(100% + 8px);
                right: 0;
                width: 320px;
                background: var(--bg-card);
                border: 1px solid var(--border-strong);
                border-radius: 12px;
                box-shadow: var(--shadow-window), 0 0 0 1px var(--border-subtle);
                overflow: visible;
                z-index: 200;
                user-select: none;
              ">
                <!-- Top Action & Search Bar -->
                <div style="padding: 10px 10px 6px; border-bottom: 1px solid var(--border-subtle); background: var(--popover); border-radius: 12px 12px 0 0;">
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
                <div id="model-picker-scroll-list" role="listbox" aria-label="${escapeHtml(t('dock.selectModel'))}" style="max-height: 320px; overflow-y: auto; padding: 6px 0;">
                  ${renderModelPickerTree(props)}
                </div>

                <!-- 二级级联：思考等级。悬停/聚焦任意模型行时由桌面端定位到该行右侧。
                     独立于行内渲染，避免 300 行 × 5 项重复 DOM。 -->
                <div id="model-reasoning-cascade" class="model-cascade" role="menu" aria-label="${escapeHtml(t('dock.reasoning'))}" style="display: none;">
                  <div class="model-cascade__title" role="presentation">${t('dock.reasoning')}</div>
                  ${['default', 'none', 'low', 'high', 'max']
                    .map((lvl) => {
                      // 【规则】单值高亮：`high` 与 `default` 不能同时勾上，否则用户看不出当前到底哪一档。
                      // `off` 与 `medium` 是历史别名，必须先归一再比对——否则 `medium` 会五档全暗。
                      const normalized = normalizeReasoningLevel(props.reasoningLevel);
                      const isSelected = normalized === lvl;
                      return `
                    <div class="model-cascade__item${isSelected ? ' active' : ''}" role="menuitemradio" aria-checked="${isSelected ? 'true' : 'false'}" data-level="${lvl}" tabindex="0">
                      <span>${escapeHtml(reasoningLabels[lvl] || lvl)}</span>
                      ${isSelected ? '<span class="model-cascade__check">✓</span>' : ''}
                    </div>
                  `;
                    })
                    .join('')}
                </div>

                <!-- Bottom Navigation Hint -->
                <div style="
                  padding: 6px 12px;
                  border-top: 1px solid var(--border-subtle);
                  background: var(--popover);
                  border-radius: 0 0 12px 12px;
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

            <!-- 2. 思考等级不再占用输入舱：改为模型行 hover 时右侧弹出的二级级联面板
                 （见 #model-reasoning-cascade），避免在 740px 的输入舱里再塞一个下拉。 -->

            <!-- Send Action Button：与模型按钮同归右端紧凑组，避免去掉思考按钮后中间出现几百像素空洞 -->
            <button id="dock-send-btn" class="composer-send${isStreaming ? ' composer-send--stop' : ''}" title="${isStreaming ? t('dock.stop') : t('dock.send')}" ${props.disabled ? 'disabled data-locked="true"' : ''}>
              ${
                isStreaming
                  ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>`
                  : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`
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
                ${item.model ? `<span style="font-size: 9.5px; padding: 0 4px; background: var(--popover); border-radius: 3px; color: var(--text-muted);">${escapeHtml(item.model)}</span>` : ''}
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
          " onmouseenter="this.style.background='var(--card-hover)'" onmouseleave="this.style.background='transparent'">
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
          " onmouseenter="this.style.background='var(--card-hover)'" onmouseleave="this.style.background='transparent'">
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
 * 模型选择器与输入舱标签的统一显示解析 (Dock Model Label Resolution)
 *
 * 【设计意图 (Why)】
 *   输入舱标签与选择器行必须共用同一条解析链，否则同一模型会出现两种写法
 *   （标签写 `Gemini 3.8 Flash`、菜单里写 `gemini-3.8-flash`）。
 *
 * 【防范的历史坑 (Pitfall)】
 *   旧实现只查 `modelDetails`，而 `modelDetails` 的 `displayName` 曾被拼成
 *   `${name} (${provider})`，导致标签拖着 `(cpa)` 尾巴；且 `modelDetails` 缺失时直接落到裸 ID。
 *
 * 【约束与规则 (Rules)】
 *   1. 目录命中 → 用目录 `displayName`（完整可读名，含全部后缀）；
 *   2. 目录未命中 → 用 core 纯函数按 ID 派生，保证任何情况都不是机器串直出；
 *   3. 定位条目一律走 core 的 `modelLabelFromCatalog`，禁止在 ui 侧另写一套匹配规则。
 */
export function resolveDockModelLabel(
  props: Pick<InputDockProps, 'selectedModel' | 'modelCatalog' | 'currentProvider'>,
): string {
  const { selectedModel } = props;
  if (!selectedModel) return t('dock.selectModel');

  if (props.modelCatalog && props.modelCatalog.length > 0) {
    return modelLabelFromCatalog(props.modelCatalog, selectedModel, props.currentProvider ?? '');
  }

  return formatModelDisplayName(selectedModel) || selectedModel;
}

/** 选择器行的统一形状：无论数据来自 `modelCatalog` 还是历史 `modelDetails`，都归一到这一结构。 */
interface ModelPickerRow {
  id: string;
  provider: string;
  /** provider 展示名（`Nous Portal` / `xAI Grok OAuth` …），用于分组标题 */
  providerName: string;
  name: string;
  displayName: string;
  variant: string;
  quant: string;
  context: string;
  route: string;
  date: string;
  vendor: string;
  /** 厂商图标 slug；空串表示判不出或上游无图标，渲染层降级首字母 badge */
  vendorId: string;
  contextLength?: number;
  supportsVision?: boolean;
  unavailable?: boolean;
  featured?: boolean;
  providerWarning?: string;
}

/**
 * 把三种历史数据源收敛为统一选择器行 (Picker Row Resolution)
 *
 * 【设计意图 (Why)】
 *   选择器同时被"新目录"与"旧 modelDetails / 裸 models"三种入参驱动。
 *   若各分支各自拼显示名，会出现同一模型在不同入参下名不一致。
 *
 * 【防范的历史坑 (Pitfall)】
 *   旧实现直接拿 `d.name` 渲染，而 `name` 往往是完整 ID（如 `group/deepseek-v4.1-flash`）；
 *   降级分支更是直接把裸 ID 当 displayName，等于把机器串原样呈现。
 *
 * 【约束与规则 (Rules)】
 *   - `modelCatalog` 优先，其已含派生结果，直接复用不重算；
 *   - 其余分支统一过一次 core 派生，保证显示名风格一致；
 *   - **`name` 必须是完整可读名**，标签（variant/quant/context）只做视觉强调，不得从名字里扣掉。
 */
export function resolveModelPickerRows(
  props: Pick<InputDockProps, 'modelCatalog' | 'modelDetails' | 'models'>,
): ModelPickerRow[] {
  if (props.modelCatalog && props.modelCatalog.length > 0) {
    return props.modelCatalog.map((entry) => ({
      id: entry.id,
      provider: entry.providerSlug,
      providerName: entry.providerName,
      name: entry.name,
      displayName: entry.displayName,
      variant: entry.variant,
      quant: entry.quant,
      context: entry.context,
      route: entry.route,
      date: entry.date,
      vendor: entry.vendor,
      vendorId: entry.vendorId ?? '',
      contextLength: entry.contextLength,
      supportsVision: entry.supportsVision,
      unavailable: entry.unavailable,
      featured: entry.featured,
      providerWarning: entry.providerWarning,
    }));
  }

  if (props.modelDetails && props.modelDetails.length > 0) {
    // 【规则】历史 modelDetails 一律重派生，不复用其 displayName：
    // 旧值可能是 `${name} (${provider})` 这类拼接串，属不可靠数据。
    return props.modelDetails.map((detail) => {
      const parts = parseModelDisplay(detail.id, detail.provider);
      return {
        id: detail.id,
        provider: detail.provider,
        providerName: detail.provider || 'DEFAULT',
        name: parts.name || detail.name,
        displayName: parts.name,
        variant: parts.variant,
        quant: parts.quant,
        context: parts.context,
        route: parts.route,
        date: parts.date,
        vendor: parts.vendor,
        vendorId: parts.vendorId,
        contextLength: detail.contextLength,
        supportsVision: detail.supportsVision,
      };
    });
  }

  const ids = props.models && props.models.length > 0 ? props.models : [];
  return ids.map((id) => {
    const parts = parseModelDisplay(id);
    return {
      id,
      provider: 'DEFAULT',
      providerName: 'DEFAULT',
      name: parts.name || id,
      displayName: parts.name || id,
      variant: parts.variant,
      quant: parts.quant,
      context: parts.context,
      route: parts.route,
      date: parts.date,
      vendor: parts.vendor,
      vendorId: parts.vendorId,
    };
  });
}

/**
 * Provider 折叠手风琴模型选择器 (Provider Accordion)
 */
export function renderModelPickerTree(props: InputDockProps): string {
  const query = (props.modelSearchQuery || '').trim().toLowerCase();
  const allDetails = resolveModelPickerRows(props);
  const favorites = new Set(props.favoriteModels || []);
  const recents = props.recentModels || [];
  // 【规则】搜索时必须无视折叠状态：命中的模型被折叠起来，等于搜索「没结果」，
  // 用户只能靠再点开分组才知道东西其实在。
  const collapsedSet = query ? new Set<string>() : new Set(props.collapsedProviders || []);

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
      <div class="model-picker-section" role="group" aria-label="${escapeHtml(t('dock.favorites'))}" style="margin-bottom: 6px;">
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
      <div class="model-picker-section" role="group" aria-label="${escapeHtml(t('dock.recents'))}" style="margin-bottom: 6px;">
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
            .map(([providerSlug, models]) => {
              // 【规则】分组标题用 provider 展示名（`Nous Portal` / `xAI Grok OAuth`），
              // 而不是大写 slug（`CPA` / `NOUS` / `XAI-OAUTH`）——slug 是路由标识，不是给人看的名字。
              const displayName = models[0]?.providerName || providerSlug;
              const isCollapsed = collapsedSet.has(providerSlug);
              // 搜索期间折叠被临时忽略：此时标题不再是折叠开关，视觉上必须同步退化，
              // 否则用户点它毫无反应，会认为控件坏了。
              const searchForcedOpen = Boolean(query);
              // 【规则】标题图标走 provider 维度判定：命中的厂商出品牌 logo，
              // 判不出（`cpa` / `nous` 这类接入入口）渲染首字母 badge。
              // 这里彻底移除 emoji —— emoji 与品牌标识语义不符，且各平台字形与基线不一致。
              const providerIcon = renderProviderVendorIcon(providerSlug, displayName, { size: 13 });

              return `
            <div class="model-provider-group" data-provider="${escapeHtml(providerSlug)}" style="margin-bottom: 6px;">
              <!-- Accordion Header -->
              <div class="model-provider-group-header" data-provider="${escapeHtml(providerSlug)}" data-collapsed="${isCollapsed ? 'true' : 'false'}" data-search-open="${searchForcedOpen ? 'true' : 'false'}" role="button" tabindex="0" aria-expanded="${isCollapsed ? 'false' : 'true'}" aria-disabled="${searchForcedOpen ? 'true' : 'false'}" style="
                padding: 5px 12px;
                font-size: 11px;
                font-weight: 700;
                color: var(--text-muted);
                letter-spacing: 0.04em;
                display: flex;
                align-items: center;
                justify-content: space-between;
                background: var(--popover);
                cursor: pointer;
                user-select: none;
              ">
                <div style="display: flex; align-items: center; gap: 6px;">
                  ${providerIcon}
                  <span>${escapeHtml(displayName)}</span>
                  <span style="font-size: 10px; color: var(--text-muted); font-weight: 400;">(${models.length})</span>
                </div>
                <span class="provider-accordion-arrow" aria-hidden="true">${isCollapsed ? '▸' : '▾'}</span>
              </div>
              <!-- Accordion Body -->
              <div class="model-provider-items" role="group" aria-label="${escapeHtml(displayName)}" style="display: ${isCollapsed ? 'none' : 'block'};">
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
  item: ModelPickerRow,
  selectedModel: string,
  isFav: boolean
): string {
  const isSelected = item.id === selectedModel;
  const contextBadge = item.contextLength ? formatContextLength(item.contextLength) : '';
  const locked = Boolean(item.unavailable);
  const lockHint = locked
    ? escapeHtml(item.providerWarning || t('dock.modelUnavailable'))
    : escapeHtml(item.id);
  // 【规则】每行左侧的厂商图标按模型身份判定，与分组标题（provider 维度）互不影响：
  // 同一个 provider 下可能挂着多家厂商的模型（`cpa` 代理同时提供 Gemini 与 DeepSeek）。
  const vendorIcon = renderVendorIcon({ vendorId: item.vendorId, label: item.vendor, size: 14 });

  return `
    <div class="model-option${isSelected ? ' active' : ''}${locked ? ' is-locked' : ''}" data-model="${escapeHtml(item.id)}" data-provider="${escapeHtml(item.provider)}" data-locked="${locked ? 'true' : 'false'}" title="${lockHint}" role="option" aria-selected="${isSelected ? 'true' : 'false'}" aria-disabled="${locked ? 'true' : 'false'}" tabindex="0"${locked ? '' : ' aria-haspopup="menu"'} style="
      padding: 6px 12px;
      font-size: 12px;
      color: ${isSelected ? 'var(--accent)' : 'var(--text-main)'};
      cursor: ${locked ? 'not-allowed' : 'pointer'};
      opacity: ${locked ? '0.45' : '1'};
      display: flex;
      align-items: center;
      justify-content: space-between;
    ">
      <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; min-width: 0; flex: 1 1 auto; white-space: nowrap;">
        <span class="btn-toggle-favorite" data-model="${escapeHtml(item.id)}" style="
          color: ${isFav ? 'var(--accent)' : 'var(--text-faint)'};
          font-size: var(--fs-caption);
          cursor: pointer;
          flex-shrink: 0;
        ">${isFav ? '★' : '☆'}</span>
        ${vendorIcon}
        <span style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 0 1 auto; color: inherit;">${escapeHtml(item.name)}</span>
        ${renderModelBadge(item.variant, 'var(--foreground)', 'var(--secondary)')}
        ${renderModelBadge([item.quant, item.context].filter(Boolean).join(' · '), 'var(--muted-foreground)', 'var(--secondary)')}
      </div>
      <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
        ${locked ? `<span style="font-size: var(--fs-micro); padding: 0 4px; background: var(--secondary); color: var(--muted-foreground); border-radius: 4px;">${escapeHtml(t('dock.modelLockedBadge'))}</span>` : ''}
        ${item.supportsVision ? '<span style="font-size: var(--fs-micro); padding: 0 4px; background: var(--secondary); color: var(--muted-foreground); border-radius: 4px;">VISION</span>' : ''}
        ${
          contextBadge
            ? `<span style="font-size: var(--fs-micro); color: var(--muted-foreground); font-family: var(--font-mono);">${contextBadge}</span>`
            : ''
        }
        ${isSelected ? '<span style="font-size: var(--fs-caption); color: var(--accent); font-weight: 700;">✓</span>' : ''}
        <span class="model-option__cascade" aria-hidden="true">›</span>
      </div>
    </div>
  `;
}

/**
 * 行内标签 (Inline Model Badge)
 *
 * 【设计意图 (Why)】
 *   变体（Fast / Flash）、量化（Q4_K_M）、上下文（1M）在完整名字里已经出现过，
 *   标签只是**视觉强调**，让眼睛快速抓到型号差异；它不承担信息完整性责任。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 标签未声明 `flex-shrink: 0`：flex 默认 `shrink:1`，窄容器下标签被压扁裁切，
 *      文字溢出自带背景的框外。必须禁止收缩，让**名字**去省略。
 *   2. 用 accent/primary 作前景 + 其 subtle 变体作底：obsidian 主题下两者都是 `#FFFFFF`，
 *      其 subtle 是 6% 白底 —— 白字压 6% 白底，完全不可读。
 *      必须用「实底表面 + 前景文字」：`--secondary` 作底，`--foreground` / `--muted-foreground` 作字。
 *   3. 用规格外字号：设计系统只有 7 档，标签必须落在 `--fs-micro`。
 *
 * 【约束与规则 (Rules)】
 *   文案为空时严格返回空串，不留空标签占位。
 */
function renderModelBadge(text: string, color: string, background: string): string {
  if (!text) return '';
  return `<span style="flex-shrink: 0; white-space: nowrap; font-size: var(--fs-micro); line-height: 1.4; padding: 0 4px; border-radius: 4px; color: ${color}; background: ${background};">${escapeHtml(text)}</span>`;
}

/**
 * 输入舱渲染快照接口 (RenderInputDockSnapshot)
 * 用于判断输入舱视觉与交互状态是否发生实质演变，防止非输入舱操作导致 DOM 物理全量重排
 */
export interface RenderInputDockSnapshot {
  selectedModel: string;
  /**
   * 当前 provider slug。
   *
   * 【设计意图 (Why)】
   *   同一模型 ID 可能被多个 provider 提供，切换 provider 而不换模型时，
   *   标签与归属必须随之刷新——否则界面会停在旧 provider 的价格与能力上。
   */
  currentProvider?: string;
  /**
   * 模型目录指纹（由 core `modelCatalogFingerprint` 计算）。
   *
   * 【设计意图 (Why)】
   *   目录刷新后即使 `selectedModel` 未变，显示名或可选状态也可能变化。
   *   仅比对 `modelCount` 会漏掉"数量相同但内容不同"的刷新。
   */
  modelCatalogHash?: string;
  reasoningLevel: string;
  approvalMode: string;
  isStreaming: boolean;
  disabled: boolean;
  modelMenuOpen: boolean;
  notice: string;
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
    last.currentProvider !== curr.currentProvider ||
    last.reasoningLevel !== curr.reasoningLevel ||
    last.approvalMode !== curr.approvalMode ||
    last.isStreaming !== curr.isStreaming ||
    last.disabled !== curr.disabled ||
    last.modelMenuOpen !== curr.modelMenuOpen ||
    last.notice !== curr.notice ||
    last.modelCount !== curr.modelCount ||
    last.modelCatalogHash !== curr.modelCatalogHash ||
    last.modelSearchQuery !== curr.modelSearchQuery ||
    last.recentModelsHash !== curr.recentModelsHash ||
    last.favoriteModelsHash !== curr.favoriteModelsHash ||
    last.attachmentsCount !== curr.attachmentsCount ||
    last.attachmentsHash !== curr.attachmentsHash ||
    last.rollbackArmedHash !== curr.rollbackArmedHash
  );
}
