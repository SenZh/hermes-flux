/**
 * Reusable Bot Profile & Forever Chat Card
 * (packages/ui/src/components/Bot/BotProfileCard.ts)
 *
 * 设计意图 (Why):
 *   呈现专职数字员工（Bot）的人格档案、专属技能及终身工位入口。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 幽灵 Token：全量使用注册 Token（--bg-card、--accent、--text-main 等）。
 *   2. 移动端触控：按钮热区 min-height: 44px。
 *   3. 零内联中文：全量走 t('key')。
 *
 * 约束与规则 (Rules):
 *   - 纯 Web 标准模板，零外部私有宿主 API。
 */

import type { AgentProfileDetail } from '@hermes-flux/core';
import { t } from '../../i18n/index.js';
import { escapeHtml } from '../MiddlePod/MiddlePod.js';

export interface BotProfileCardProps {
  profile: AgentProfileDetail;
  foreverChatSessionId?: string;
  onEnterForeverChat?: (botProfile: string, sessionId: string) => void;
}

export function renderBotProfileCard(props: BotProfileCardProps): string {
  const { profile, foreverChatSessionId } = props;
  const safeName = escapeHtml(profile.name);
  const safeDisplayName = escapeHtml(profile.displayName || profile.name);
  const safeDesc = escapeHtml(profile.description || '');
  const toolsCount = Array.isArray(profile.tools) ? profile.tools.length : 0;

  return `
    <div class="bot-profile-card" data-bot-profile="${safeName}" style="
      padding: 16px 18px;
      border-radius: 10px;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      box-shadow: var(--shadow-card);
      display: flex;
      flex-direction: column;
      gap: 12px;
      font-family: inherit;
      color: var(--text-main);
    ">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
          <div style="
            width: 36px;
            height: 36px;
            border-radius: 8px;
            background: var(--bg-card-hover);
            border: 1px solid var(--border-medium);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            flex-shrink: 0;
          ">🤖</div>
          <div style="min-width: 0;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-weight: 600; font-size: 14px; color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${safeDisplayName}
              </span>
              <span style="
                font-size: 11px;
                padding: 2px 6px;
                border-radius: 4px;
                background: var(--bg-card-hover);
                color: var(--text-secondary);
                border: 1px solid var(--border-subtle);
              ">@${safeName}</span>
            </div>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          <span style="
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: var(--jade-pulse);
            box-shadow: 0 0 6px var(--jade-glow);
            display: inline-block;
          "></span>
          <span style="font-size: 11px; color: var(--text-secondary);">${t('bot.foreverChat')}</span>
        </div>
      </div>

      ${safeDesc ? `
        <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.5;">
          ${safeDesc}
        </div>
      ` : ''}

      <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: var(--text-muted); border-top: 1px solid var(--border-subtle); padding-top: 10px;">
        <span>${t('bot.toolsCount', { count: toolsCount })}</span>
        <span style="display: flex; align-items: center; gap: 4px;">
          🔒 ${t('bot.memoryLocked')}
        </span>
      </div>

      <div style="display: flex; justify-content: flex-end; margin-top: 2px;">
        <button
          type="button"
          class="bot-btn-enter-forever-chat"
          data-bot-profile="${safeName}"
          data-session-id="${escapeHtml(foreverChatSessionId || '')}"
          style="
            min-height: 44px;
            padding: 0 16px;
            font-size: 12px;
            font-weight: 500;
            border-radius: 6px;
            border: 1px solid var(--border-medium);
            background: var(--bg-card-hover);
            color: var(--text-main);
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
          "
        >${t('bot.enterWorkspace')}</button>
      </div>
    </div>
  `;
}
