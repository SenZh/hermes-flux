/**
 * Reusable Session-to-Group Promotion Dialog
 * (packages/ui/src/components/Group/GroupPromotionDialog.ts)
 *
 * 设计意图 (Why):
 *   当单聊探讨遇到深水区时，弹出四阶拉群对话框，
 *   支持专家勾选单（多选）、预填议题确认与一键创建研讨会议室。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 遮罩层使用合法 var(--bg-backdrop)，卡片走 var(--bg-card)。
 *   2. 操作按钮热区严格保持 >= 44pt/48dp。
 *   3. 零内联硬编码中文，全量调用 t('key')。
 *
 * 约束与规则 (Rules):
 *   - 纯 Web 标准模板，全平台复用。
 */

import type { AgentProfile } from '@hermes-flux/core';
import { t } from '../../i18n/index.js';
import { escapeHtml } from '../MiddlePod/MiddlePod.js';

export interface GroupPromotionDialogProps {
  parentSessionId: string;
  defaultTopic: string;
  availableProfiles: AgentProfile[];
}

export function renderGroupPromotionDialog(props: GroupPromotionDialogProps): string {
  const { parentSessionId, defaultTopic, availableProfiles } = props;
  const safeSessionId = escapeHtml(parentSessionId);
  const safeTopic = escapeHtml(defaultTopic);

  const memberCheckboxesHtml = availableProfiles
    .map((profile) => {
      const safeName = escapeHtml(profile.name);
      const safeDisplayName = escapeHtml(profile.displayName || profile.name);
      return `
        <label style="
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          border-radius: 6px;
          background: var(--bg-card-hover);
          border: 1px solid var(--border-subtle);
          cursor: pointer;
          min-height: 44px;
        ">
          <input
            type="checkbox"
            class="group-member-checkbox"
            value="${safeName}"
            style="width: 16px; height: 16px; cursor: pointer; accent-color: var(--accent);"
          />
          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 13px; font-weight: 500; color: var(--text-main);">${safeDisplayName}</span>
            <span style="font-size: 11px; color: var(--text-muted);">@${safeName}</span>
          </div>
        </label>
      `;
    })
    .join('');

  return `
    <div class="group-promotion-dialog-overlay" data-parent-session-id="${safeSessionId}" style="
      position: fixed;
      inset: 0;
      background: var(--bg-backdrop);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 16px;
      font-family: inherit;
    ">
      <div class="group-promotion-dialog" style="
        width: 100%;
        max-width: 480px;
        background: var(--bg-card);
        border: 1px solid var(--border-medium);
        border-radius: 12px;
        box-shadow: var(--shadow-dock);
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        color: var(--text-main);
      ">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px;">👥</span>
          <span style="font-size: 15px; font-weight: 600; color: var(--text-main);">
            ${t('group.dialogTitle')}
          </span>
        </div>

        <!-- 研讨议题输入 -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <label style="font-size: 12px; color: var(--text-secondary);">${t('group.dialogTopic')}</label>
          <input
            type="text"
            class="group-topic-input"
            value="${safeTopic}"
            style="
              height: 44px;
              min-height: 44px;
              padding: 0 12px;
              border-radius: 6px;
              border: 1px solid var(--border-medium);
              background: var(--bg-input);
              color: var(--text-main);
              font-size: 13px;
              outline: none;
            "
          />
        </div>

        <!-- 参会专家勾选单 -->
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <label style="font-size: 12px; color: var(--text-secondary);">${t('group.dialogSelectMembers')}</label>
          <div class="group-members-list" style="
            display: flex;
            flex-direction: column;
            gap: 6px;
            max-height: 180px;
            overflow-y: auto;
            padding-right: 4px;
          ">
            ${memberCheckboxesHtml}
          </div>
        </div>

        <!-- 动作按钮栏 (满足 44pt 触控红线) -->
        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px;">
          <button
            type="button"
            class="group-dialog-btn-cancel"
            style="
              min-height: 44px;
              padding: 0 16px;
              font-size: 13px;
              border-radius: 6px;
              border: 1px solid var(--border-subtle);
              background: transparent;
              color: var(--text-muted);
              cursor: pointer;
            "
          >${t('group.dialogCancel')}</button>
          <button
            type="button"
            class="group-dialog-btn-confirm"
            data-parent-session-id="${safeSessionId}"
            style="
              min-height: 44px;
              padding: 0 20px;
              font-size: 13px;
              font-weight: 600;
              border-radius: 6px;
              border: 1px solid var(--border-medium);
              background: var(--accent);
              color: var(--text-main);
              cursor: pointer;
            "
          >${t('group.dialogConfirm')}</button>
        </div>
      </div>
    </div>
  `;
}
