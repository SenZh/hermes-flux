/**
 * Reusable Multi-Agent Group Room View
 * (packages/ui/src/components/Group/GroupRoomView.ts)
 *
 * 设计意图 (Why):
 *   呈现多智能体群聊会议室的独立研讨消息流、Room 0 种子备忘录与全员发言舱。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 滚动容器不得使用 CSS transform，防止 WebKit 键盘弹出卡死。
 *   2. 底部发言舱适配 env(safe-area-inset-bottom) 避让手势条。
 *   3. 零带色相硬编码，全量走 var(--token)。
 *
 * 约束与规则 (Rules):
 *   - 纯 Web 标准模板，全平台（Desktop / Mobile / Web）复用。
 */

import type { GroupRoomSummary, GroupMessageEntry } from '@hermes-flux/core';
import { t } from '../../i18n/index.js';
import { escapeHtml } from '../MiddlePod/MiddlePod.js';

export interface GroupRoomViewProps {
  room: GroupRoomSummary;
  entries: GroupMessageEntry[];
}

export function renderGroupRoomView(props: GroupRoomViewProps): string {
  const { room, entries } = props;
  const safeName = escapeHtml(room.name || t('group.roomTitle'));
  const safeRoomId = escapeHtml(room.roomId);
  const membersCount = Array.isArray(room.members) ? room.members.length : 0;

  const messagesHtml = entries.length === 0
    ? `<div style="color: var(--text-muted); font-style: italic; padding: 32px 16px; text-align: center;">${t('group.emptyFeed')}</div>`
    : entries
        .map((entry) => {
          const safeSender = escapeHtml(entry.senderProfile);
          const safeText = escapeHtml(entry.text);
          const isSeed = Boolean(entry.isSeed);

          if (isSeed) {
            return `
              <div class="group-seed-memo-card" style="
                margin: 12px 0;
                padding: 14px 16px;
                border-radius: 8px;
                background: var(--bg-card);
                border: 1px solid var(--accent-border);
                box-shadow: 0 0 12px var(--accent-subtle);
              ">
                <div style="font-size: 11px; font-weight: 600; color: var(--accent); margin-bottom: 6px;">
                  📌 ${t('group.seedMemoTitle')}
                </div>
                <div style="font-size: 12px; color: var(--text-main); white-space: pre-wrap; line-height: 1.6;">${safeText}</div>
              </div>
            `;
          }

          return `
            <div style="margin: 10px 0; display: flex; flex-direction: column; gap: 4px;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 11px; font-weight: 600; color: var(--accent);">@${safeSender}</span>
                <span style="font-size: 10px; color: var(--text-muted); font-family: monospace;">#${entry.seq}</span>
              </div>
              <div style="
                padding: 10px 14px;
                border-radius: 8px;
                background: var(--bg-card);
                border: 1px solid var(--border-subtle);
                color: var(--text-main);
                font-size: 13px;
                line-height: 1.5;
                white-space: pre-wrap;
              ">${safeText}</div>
            </div>
          `;
        })
        .join('');

  return `
    <div class="group-room-view" data-room-id="${safeRoomId}" style="
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--bg-window);
      color: var(--text-main);
      font-family: inherit;
      position: relative;
    ">
      <!-- 顶部研讨室控制条 -->
      <div style="
        height: 48px;
        min-height: 48px;
        padding: 0 16px;
        border-bottom: 1px solid var(--border-subtle);
        background: var(--bg-panel);
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
      ">
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
          <span style="font-size: 16px;">👥</span>
          <span style="font-weight: 600; font-size: 13px; color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${safeName}
          </span>
          <span style="
            font-size: 11px;
            padding: 2px 6px;
            border-radius: 4px;
            background: var(--bg-card);
            color: var(--text-secondary);
            border: 1px solid var(--border-subtle);
          ">${t('group.members', { count: membersCount })}</span>
        </div>
      </div>

      <!-- 中间消息流 -->
      <div class="group-message-stream" style="
        flex: 1;
        overflow-y: auto;
        padding: 14px 18px;
        background: var(--bg-window);
      ">
        ${messagesHtml}
      </div>

      <!-- 底部群聊发言舱 (适配安全区与44pt热区) -->
      <div style="
        padding: 12px 16px max(12px, env(safe-area-inset-bottom));
        border-top: 1px solid var(--border-subtle);
        background: var(--bg-panel);
        display: flex;
        gap: 10px;
        align-items: center;
        flex-shrink: 0;
      ">
        <input
          type="text"
          class="group-chat-input"
          placeholder="${t('group.placeholder')}"
          style="
            flex: 1;
            height: 44px;
            min-height: 44px;
            padding: 0 14px;
            border-radius: 6px;
            border: 1px solid var(--border-medium);
            background: var(--bg-input);
            color: var(--text-main);
            font-size: 13px;
            outline: none;
          "
        />
        <button
          type="button"
          class="group-btn-send"
          data-room-id="${safeRoomId}"
          style="
            height: 44px;
            min-width: 68px;
            min-height: 44px;
            padding: 0 18px;
            border-radius: 6px;
            border: 1px solid var(--border-medium);
            background: var(--accent);
            color: var(--text-main);
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          "
        >${t('group.send')}</button>
      </div>
    </div>
  `;
}
