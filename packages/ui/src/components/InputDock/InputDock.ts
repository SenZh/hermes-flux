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
  /** 网关三态；auto / ask / sandbox 仅作为历史入参兼容，渲染前统一归一。 */
  approvalMode: ApprovalMode | 'auto' | 'ask' | 'sandbox';
  isStreaming: boolean;
  /**
   * 运行中草稿是否有内容。
   *
   * 【设计意图 (Why)】
   *   运行态的主按钮列有两种形态：空草稿只有停止；有草稿时发送（入队）叠在停止上方。
   *   草稿文本只存在于 textarea 的 DOM 里，组件是纯渲染函数不能读 DOM，
   *   所以宿主必须把「有没有草稿」这一位显式传进来。
   */
  hasDraft?: boolean;
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
    <div class="rollback-pending-banner dock-banner" data-rollback-pending="true" data-count="${banner.removedCount}">
      <span class="dock-banner__body">
        <span class="dock-banner__glyph" aria-hidden="true">↺</span>
        <span class="dock-banner__text">${t('chat.rollbackArmed', { count: banner.removedCount, anchor: banner.anchorLabel })}</span>
      </span>
      <button class="rollback-banner-cancel dock-banner__action" data-action="rollback-cancel" type="button">${t('chat.rollbackCancel')}</button>
    </div>
  `;
}

export function renderDockNoticeBar(notice?: string): string {
  const clean = (notice || '').trim();
  if (!clean) return '';
  return `
    <div id="dock-notice" class="dock-banner" role="status">
      <span class="dock-banner__body">
        <span class="dock-banner__glyph" aria-hidden="true">ℹ</span>
        <span class="dock-banner__text">${escapeHtml(clean)}</span>
      </span>
      <button id="dock-notice-close" class="dock-banner__close" type="button" aria-label="${t('dock.noticeClose')}" title="${t('dock.noticeClose')}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
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

/**
 * 审批三态（唯一真值）
 *
 * 【设计意图 (Why)】
 *   Hermes 网关只认 `approvals.mode` 的三值：manual / smart / off。
 *   历史 UI 曾用 auto / ask / sandbox 三套别名，导致同一状态在不同面板叫不同名字。
 *   现在入口统一归一，展示与写回共用一个联合类型，非法状态在类型层不可表达。
 */
export const APPROVAL_MODES = ['manual', 'smart', 'off'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export function normalizeApprovalMode(mode?: string): ApprovalMode {
  if (mode === 'manual' || mode === 'smart' || mode === 'off') return mode;
  // 历史别名：sandbox = 每步询问，auto = 全放行，ask = 智能
  if (mode === 'sandbox') return 'manual';
  if (mode === 'auto') return 'off';
  return 'smart';
}

/** 主按钮只由「回合相位」决定：运行中永远是停止，空闲永远是发送（空草稿时禁用）。 */
export type ComposerPhase = 'idle' | 'running';
export type ComposerPrimaryAction = 'send' | 'stop';

export function resolveComposerPrimaryAction(phase: ComposerPhase): ComposerPrimaryAction {
  return phase === 'running' ? 'stop' : 'send';
}

/** 思考等级展示文案：五档唯一出口，标签与级联共用。 */
export function reasoningLevelLabel(level: InputDockProps['reasoningLevel'] | '' | undefined): string {
  switch (normalizeReasoningLevel(level)) {
    case 'none':
      return t('dock.reasoningNone');
    case 'low':
      return t('dock.reasoningLow');
    case 'high':
      return t('dock.reasoningHigh');
    case 'max':
      return t('dock.reasoningMax');
    default:
      return t('dock.reasoningDefault');
  }
}

const SEND_GLYPH = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M9 5.5 19.5 12 9 18.5Z"/><path d="M9 12h5.2"/></svg>`;

const CARET_GLYPH = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;

const PAPERCLIP_GLYPH = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M21.4 11.05 12.25 20.2a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.65 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.48-8.48"/></svg>`;

const LOCK_GLYPH = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`;

const SHIELD_CHECK_GLYPH = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.3 3 8.3 7.5 9.5 4.5-1.2 7.5-5.2 7.5-9.5V6L12 3Z"/><path d="m8.8 11.8 2.2 2.2 4.2-4.2"/></svg>`;

const FAST_FORWARD_GLYPH = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 5 7 7-7 7"/><path d="m13 5 7 7-7 7"/></svg>`;

const ENTER_GLYPH = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 5v6a2 2 0 0 1-2 2H5"/><path d="m9 9-4 4 4 4"/></svg>`;

const IMAGE_GLYPH = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5L5 20"/></svg>`;

const FILE_GLYPH = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/></svg>`;

const APPROVAL_ICON: Record<ApprovalMode, string> = {
  manual: LOCK_GLYPH,
  smart: SHIELD_CHECK_GLYPH,
  off: FAST_FORWARD_GLYPH,
};

const APPROVAL_LABEL_KEY = {
  manual: 'dock.approvalManual',
  smart: 'dock.approvalSmart',
  off: 'dock.approvalOff',
} as const;

const APPROVAL_HINT_KEY = {
  manual: 'dock.approvalManualHint',
  smart: 'dock.approvalSmartHint',
  off: 'dock.approvalOffHint',
} as const;

function renderApprovalMenu(active: ApprovalMode): string {
  return APPROVAL_MODES.map((mode) => {
    const on = mode === active;
    return `
      <button class="composer-approval-option${on ? ' is-active' : ''}" type="button" role="menuitemradio" aria-checked="${on ? 'true' : 'false'}" data-mode="${mode}">
        <span class="composer-approval-option__icon" aria-hidden="true">${APPROVAL_ICON[mode]}</span>
        <span class="composer-approval-option__text">
          <span class="composer-approval-option__label">${escapeHtml(t(APPROVAL_LABEL_KEY[mode]))}</span>
          <span class="composer-approval-option__hint">${escapeHtml(t(APPROVAL_HINT_KEY[mode]))}</span>
        </span>
        ${on ? '<span class="composer-approval-option__check" aria-hidden="true">✓</span>' : ''}
      </button>
    `;
  }).join('');
}

export function renderInputDock(props: InputDockProps): string {
  const isStreaming = Boolean(props.isStreaming);
  const modelMenuOpen = Boolean(props.modelMenuOpen);
  const notice = (props.notice || '').trim();
  const activityStatus = (props.activityStatus || '').trim();
  const phase: ComposerPhase = isStreaming ? 'running' : 'idle';
  const primary = resolveComposerPrimaryAction(phase);
  const approval = normalizeApprovalMode(props.approvalMode);
  const levelLabel = reasoningLevelLabel(props.reasoningLevel);

  // 模型名称与图标都必须来自同一条解析链：名称走 core 目录派生，图标走共享的厂商判定，
  // 与设置页 `ModelOptionRow` 保持同一套数据源，禁止在两处各写一遍。
  const modelLabel = resolveDockModelLabel(props);
  const modelIcon = props.selectedModel
    ? renderModelVendorIcon(props.selectedModel, props.currentProvider ?? '', { size: 16, suppressBadge: true })
    : `<svg class="composer-ctrl__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/></svg>`;

  const activityPillHtml = activityStatus
    ? `<div class="agent-activity-pill">
        <span class="agent-activity-pill__dot" aria-hidden="true"></span>
        <span class="agent-activity-pill__model">${escapeHtml(modelLabel)}</span>
        <span class="agent-activity-pill__sep" aria-hidden="true">·</span>
        <span class="agent-activity-pill__status">${escapeHtml(activityStatus)}</span>
      </div>`
    : '';

  const rollbackBarHtml = renderRollbackNoticeBar(props.rollbackBanner);
  const dockNoticeHtml = renderDockNoticeBar(notice);
  const hasNotices = Boolean(rollbackBarHtml || dockNoticeHtml);

  return `
    <div class="input-dock-container" data-phase="${phase}">
      ${activityPillHtml}

      ${renderQueueTray(props.queuedMessages)}

      ${
        hasNotices
          ? `<div class="dock-notice-stack">
              ${rollbackBarHtml}
              ${dockNoticeHtml}
            </div>`
          : ''
      }

      <!-- 附件轨在输入舱外部上方：缩略图不参与正文排版，也不与行内 @ 引用混排 -->
      ${renderAttachmentTray(props.attachments)}

      <div class="input-card-box composer-dock">
        <!-- Popper 固定挂载点：开合只替换本占位子树，绝不重建 textarea（键盘时序军规） -->
        <div id="composer-popper-mount">${renderSlashPopper(props.slashItems, props.slashPopperOpen)}${renderMentionPopper(props.mentionItems, props.mentionPopperOpen)}</div>

        <div class="composer-dock__editor">
          <textarea id="dock-prompt-input" class="composer-dock__textarea" rows="1" placeholder="${props.disabled ? t('dock.placeholderDisabled') : t('dock.placeholder')}" ${props.disabled ? 'disabled' : ''}></textarea>
        </div>

        <div class="composer-dock__footer">
          <div class="composer-dock__footer-group">
            <button id="dock-attach-file-btn" class="composer-icon-btn" type="button" title="${t('dock.attachTooltip')}" aria-label="${t('dock.attachTooltip')}">${PAPERCLIP_GLYPH}</button>

            <div class="pill-dropdown-wrapper">
              <button id="dock-approval-toggle-btn" class="composer-icon-btn" type="button" title="${t('dock.approval')}: ${escapeHtml(t(APPROVAL_LABEL_KEY[approval]))}" aria-label="${t('dock.approval')}: ${escapeHtml(t(APPROVAL_LABEL_KEY[approval]))}" aria-haspopup="menu" aria-expanded="false">
                ${APPROVAL_ICON[approval]}
              </button>
              <div id="dock-approval-dropdown" class="composer-approval-menu" role="menu" aria-label="${t('dock.approval')}" style="display: none;">
                ${renderApprovalMenu(approval)}
              </div>
            </div>
          </div>

          <div class="composer-dock__footer-group composer-dock__footer-group--end">
            <div class="pill-dropdown-wrapper">
              <button id="dock-model-selector-btn" class="composer-ctrl" type="button" title="${escapeHtml(modelLabel)} / ${escapeHtml(levelLabel)}" aria-haspopup="listbox" aria-expanded="${modelMenuOpen ? 'true' : 'false'}">
                ${modelIcon}
                <span id="current-model-label" class="composer-ctrl__label">${escapeHtml(modelLabel)}</span>
                <span class="composer-ctrl__sep" aria-hidden="true">/</span>
                <span class="composer-ctrl__level">${escapeHtml(levelLabel)}</span>
                <span class="composer-ctrl__caret" aria-hidden="true">${CARET_GLYPH}</span>
              </button>

              <div id="dock-model-dropdown" class="model-dropdown-menu" style="display: ${modelMenuOpen ? 'block' : 'none'};" role="listbox" aria-label="${t('dock.selectModel')}">
                <div class="model-dropdown__search">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                  <input id="dock-model-search-input" type="text" placeholder="${t('dock.searchModel')}" value="${escapeHtml(props.modelSearchQuery || '')}" aria-label="${t('dock.searchModel')}" />
                  <button id="btn-refresh-models" class="model-dropdown__refresh" type="button" title="${t('dock.refresh')}" aria-label="${t('dock.refresh')}">↻</button>
                </div>

                <div id="model-picker-scroll-list" class="model-dropdown__list" role="listbox" aria-label="${t('dock.selectModel')}">
                  ${renderModelPickerTree(props)}
                </div>

                <!-- 二级级联：思考等级。悬停/聚焦任意模型行时由桌面端定位到该行右侧，独立于行渲染 -->
                <div id="model-reasoning-cascade" class="model-cascade" role="menu" aria-label="${t('dock.reasoning')}" style="display: none;">
                  <div class="model-cascade__title" role="presentation">${t('dock.reasoning')}</div>
                  ${(['default', 'none', 'low', 'high', 'max'] as const)
                    .map((lvl) => {
                      const isSelected = normalizeReasoningLevel(props.reasoningLevel) === lvl;
                      return `
                        <div class="model-cascade__item${isSelected ? ' active' : ''}" role="menuitemradio" aria-checked="${isSelected ? 'true' : 'false'}" data-level="${lvl}" tabindex="0">
                          <span>${escapeHtml(lvl === 'default' ? t('dock.reasoningDefault') : lvl === 'none' ? t('dock.reasoningNone') : lvl === 'low' ? t('dock.reasoningLow') : lvl === 'high' ? t('dock.reasoningHigh') : t('dock.reasoningMax'))}</span>
                          ${isSelected ? '<span class="model-cascade__check" aria-hidden="true">✓</span>' : ''}
                        </div>
                      `;
                    })
                    .join('')}
                </div>

                <div class="model-dropdown__hint">
                  <span>↑↓ ${t('dock.modelHintMove')}</span>
                  <span>esc ${t('dock.modelHintClose')}</span>
                </div>
              </div>
            </div>

            <div class="composer-action-stack">
              ${
                primary === 'send'
                  ? `<button id="dock-send-btn" class="composer-send" type="button" title="${t('dock.send')}" aria-label="${t('dock.send')}" ${props.disabled ? 'disabled data-locked="true"' : ''}>${SEND_GLYPH}</button>`
                  : `<button id="dock-queue-btn" class="composer-send" type="button" title="${t('dock.queueSubmit')}" aria-label="${t('dock.queueSubmit')}"${props.hasDraft ? '' : ' hidden'}>${SEND_GLYPH}</button>
                     <button id="dock-stop-btn" class="composer-stop" type="button" title="${t('dock.stopTurn')}" aria-label="${t('dock.stopTurn')}"><span class="composer-stop__block" aria-hidden="true"></span></button>`
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * 待发送消息队列挂载托盘 (Queue Tray)
 *
 * 【规则】每行只有三个动作：放回编辑、立即发送、取消。
 *   顺序与主按钮一致（左到右 = 从轻到重），不再提供上下移动与「打断插队」。
 */
export function renderQueueTray(queued?: InputQueuedItem[]): string {
  if (!queued || queued.length === 0) return '';

  return `
    <div class="pending-queue-tray">
      <div class="pending-queue-tray__head">
        <span>${t('queue.title')} · ${queued.length}</span>
      </div>
      ${queued
        .map((item, idx) => {
          const shortText = item.text.length > 80 ? `${item.text.slice(0, 80)}…` : item.text;
          return `
            <div class="pending-queue-row" data-queue-id="${item.id}">
              <span class="pending-queue-row__index">${idx + 1}</span>
              <span class="pending-queue-row__text" title="${escapeHtml(item.text)}">${escapeHtml(shortText)}</span>
              <span class="pending-queue-row__actions">
                <button class="queue-action-btn" data-action="queue-replace" data-queue-id="${item.id}" title="${t('queue.edit')}" aria-label="${t('queue.edit')}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5v11.5"/><path d="m7.2 10.2 4.8 4.8 4.8-4.8"/><path d="M4.5 20.5h15"/></svg>
                </button>
                <button class="queue-action-btn" data-action="queue-steer" data-queue-id="${item.id}" title="${t('queue.interruptAndPush')}" aria-label="${t('queue.interruptAndPush')}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg>
                </button>
                <button class="queue-action-btn" data-action="queue-cancel" data-queue-id="${item.id}" title="${t('queue.cancel')}" aria-label="${t('queue.cancel')}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              </span>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

/**
 * 附件轨 (Attachment Rail)
 *
 * 【设计意图 (Why)】
 *   图片必须以缩略图出现在输入舱**外部上方**：它证明「这份图会随消息发出」，
 *   而不是正文里的一段文本。文档退化为同名胶囊，避免 56px 缩略图里塞一个文字盲盒。
 *
 * 【约束与规则 (Rules)】
 *   1. 图片 56×56、文档 38px 胶囊，两者共用 8px 圆角与 1px 发丝边；
 *   2. 删除按钮 16px，永远在缩略图右上角，不挤占文件名；
 *   3. 容器保留 `composer-attachment-pill` 类，宿主用它判断「当前是否有附件」。
 */
export function renderAttachmentTray(attachments?: InputAttachmentItem[]): string {
  if (!attachments || attachments.length === 0) return '';

  return `
    <div class="composer-attach-rail">
      ${attachments
        .map((att) => {
          const isImg = att.type === 'image';
          const removeBtn = `<button class="composer-attach__remove btn-remove-attachment" data-att-id="${att.id}" type="button" title="${t('common.remove')}" aria-label="${t('common.remove')}">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>`;

          if (isImg) {
            return `
              <div class="composer-attachment-pill composer-attach-thumb" data-att-id="${att.id}">
                ${att.previewUrl ? `<img class="composer-attach-thumb__img" src="${att.previewUrl}" alt="${escapeHtml(att.name)}" />` : `<span class="composer-attach-thumb__glyph" aria-hidden="true">${IMAGE_GLYPH}</span>`}
                ${removeBtn}
              </div>
            `;
          }

          return `
            <div class="composer-attachment-pill composer-attach-file" data-att-id="${att.id}">
              <span class="composer-attach-file__glyph" aria-hidden="true">${FILE_GLYPH}</span>
              <span class="composer-attach-file__name" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
              ${removeBtn}
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

/**
 * 斜杠命令补全浮层
 *
 * 【规则】命令名用主前景色 + 无衬线，描述退到 muted；底部提示统一使用矢量 Enter，
 *   不再出现 `SKILL` 标签或字符符号。
 */
export function renderSlashPopper(items?: SlashCommandOption[], open = false): string {
  if (!open || !items || items.length === 0) return '';

  return `
    <div class="composer-slash-popper composer-popper">
      <div class="composer-popper__head">/ ${t('dock.slashHeader')}</div>
      <div class="composer-popper__list">
        ${items
          .map(
            (cmd) => `
            <div class="slash-item-option composer-popper__row" data-command="${escapeHtml(cmd.name)}" data-replace-from="${cmd.replaceFrom ?? ''}" role="option" tabindex="0">
              <span class="composer-popper__name">${escapeHtml(cmd.name)}</span>
              <span class="composer-popper__desc">${escapeHtml(cmd.description)}</span>
            </div>
          `,
          )
          .join('')}
      </div>
      <div class="composer-popper__foot">
        <span>↑↓ ${t('dock.popperSelect')}</span>
        <span class="composer-popper__enter">${ENTER_GLYPH}${t('dock.popperInsert')}</span>
      </div>
    </div>
  `;
}

/**
 * @ 引用补全浮层
 *
 * 【规则】文件名一律主前景色（深色白字、浅色黑字），路径退到 muted；
 *   与命令浮层共用同一套行高、内距与底部提示，禁止两套视觉语言。
 */
export function renderMentionPopper(items?: MentionReferenceOption[], open = false): string {
  if (!open || !items || items.length === 0) return '';

  return `
    <div class="composer-mention-popper composer-popper">
      <div class="composer-popper__head">@ ${t('dock.mentionHeader')}</div>
      <div class="composer-popper__list">
        ${items
          .map((m) => {
            const isFile = m.type === 'file';
            return `
              <div class="mention-item-option composer-popper__row" data-mention="${escapeHtml(m.name)}" data-type="${m.type}" role="option" tabindex="0">
                <span class="composer-popper__glyph" aria-hidden="true">${isFile ? FILE_GLYPH : '<span class="composer-popper__avatar">' + escapeHtml(m.name.slice(0, 1)) + '</span>'}</span>
                <span class="composer-popper__name">${escapeHtml(m.name)}</span>
                ${m.detail ? `<span class="composer-popper__desc">${escapeHtml(m.detail)}</span>` : ''}
              </div>
            `;
          })
          .join('')}
      </div>
      <div class="composer-popper__foot">
        <span>↑↓ ${t('dock.popperSelect')}</span>
        <span class="composer-popper__enter">${ENTER_GLYPH}${t('dock.popperInsert')}</span>
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
        <div style="padding: 4px 12px; font-size: 11px; font-weight: 700; color: var(--muted-foreground); display: flex; align-items: center; gap: 6px;">
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
  activityStatus?: string;
  modelCount: number;
  modelSearchQuery: string;
  recentModelsHash: string;
  favoriteModelsHash: string;
  attachmentsCount?: number;
  attachmentsHash?: string;
  rollbackArmedHash?: string;
  /**
   * 运行态主按钮列的形态由草稿有无决定。
   *
   * 【规则】它**不参与**快照比对：草稿每个按键都会变，一旦参与就会整舱 outerHTML 重建，
   *   textarea 与光标一起被销毁。宿主在 input 事件里直接切 #dock-queue-btn 的 hidden。
   */
  hasDraft?: boolean;
  /** 队列指纹：条数与文本变化都要重绘托盘。 */
  queuedHash?: string;
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
    last.activityStatus !== curr.activityStatus ||
    last.modelCount !== curr.modelCount ||
    last.modelCatalogHash !== curr.modelCatalogHash ||
    last.modelSearchQuery !== curr.modelSearchQuery ||
    last.recentModelsHash !== curr.recentModelsHash ||
    last.favoriteModelsHash !== curr.favoriteModelsHash ||
    last.attachmentsCount !== curr.attachmentsCount ||
    last.attachmentsHash !== curr.attachmentsHash ||
    last.rollbackArmedHash !== curr.rollbackArmedHash ||
    last.queuedHash !== curr.queuedHash
  );
}
