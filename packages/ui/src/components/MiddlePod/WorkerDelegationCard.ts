/**
 * Reusable Worker Delegation Card (packages/ui/src/components/MiddlePod/WorkerDelegationCard.ts)
 *
 * 设计意图 (Why):
 *   当主会话派生子代理任务时，必须在消息流中呈现具有电影级暗黑质感、
 *   微距物理受光、实时状态更新且支持一键穿透查看的「子代理委派卡片」。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 幽灵 Token 陷阱：严禁使用主题注册表未定义的 CSS 变量（如 --bg-surface-1、--aura-amber）。
 *      必须使用真实注册 Token（如 var(--bg-card)、var(--accent)、var(--jade-pulse)、var(--text-main)）。
 *   2. 移动端触控硬红线：按钮点击热区不得低于 44pt/48dp，通过 min-height: 44px 与透明边界撑开。
 *   3. 零内联中文与硬编码色相：文案全量走 t('key')，色相全量走 Design Tokens。
 *
 * 约束与规则 (Rules):
 *   - 纯 Web 标准模板，零外部私有宿主 API。
 *   - 支持全平台（Desktop / Mobile / Web）复用。
 */

import type { SubagentTaskState } from '@hermes-flux/core';
import { t } from '../../i18n/index.js';
import { escapeHtml } from './MiddlePod.js';

export interface WorkerDelegationCardProps {
  task: SubagentTaskState;
  onViewStream?: (subagentId: string) => void;
  onInterrupt?: (subagentId: string) => void;
}

export function renderWorkerDelegationCard(task: SubagentTaskState): string {
  const { subagentId, targetProfile, taskTitle, status, progressPercent, currentActionText, error } = task;

  // 状态文案与指示点配色 Token 映射（严格使用主题注册表真实 Token）
  let statusText = t('subagent.statusRunning');
  let statusDotColor = 'var(--accent)';
  let isDone = false;

  if (status === 'thinking') {
    statusText = t('subagent.statusThinking');
    statusDotColor = 'var(--accent-hover)';
  } else if (status === 'completed') {
    statusText = t('subagent.statusCompleted');
    statusDotColor = 'var(--jade-pulse)';
    isDone = true;
  } else if (status === 'interrupted') {
    statusText = t('subagent.statusInterrupted');
    statusDotColor = 'var(--text-muted)';
    isDone = true;
  } else if (status === 'failed') {
    statusText = t('subagent.statusFailed');
    statusDotColor = 'var(--accent-dim)';
    isDone = true;
  }

  const safeTitle = escapeHtml(taskTitle || t('subagent.cardTitle'));
  const safeProfile = escapeHtml(targetProfile || 'Agent');
  const safeAction = escapeHtml(currentActionText || '');
  const safeError = error ? escapeHtml(error) : '';

  return `
    <div class="worker-delegation-card" data-subagent-id="${escapeHtml(subagentId)}" style="
      margin: 12px 0;
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
            width: 32px;
            height: 32px;
            border-radius: 8px;
            background: var(--bg-card-hover);
            border: 1px solid var(--border-subtle);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 15px;
            flex-shrink: 0;
          ">⚡</div>
          <div style="min-width: 0;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-weight: 600; font-size: 13px; color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${safeTitle}
              </span>
              <span style="
                font-size: 11px;
                padding: 2px 6px;
                border-radius: 4px;
                background: var(--bg-card-hover);
                color: var(--text-secondary);
                border: 1px solid var(--border-subtle);
              ">@${safeProfile}</span>
            </div>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          <span style="
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: ${statusDotColor};
            box-shadow: 0 0 8px ${statusDotColor};
            display: inline-block;
          "></span>
          <span style="font-size: 11px; color: var(--text-secondary);">${statusText}</span>
        </div>
      </div>

      <!-- 进度条与当前动作 -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted);">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80%;">
            ${safeAction}
          </span>
          <span>${progressPercent}%</span>
        </div>
        <div style="
          width: 100%;
          height: 4px;
          border-radius: 2px;
          background: var(--bg-card-hover);
          overflow: hidden;
        ">
          <div style="
            width: ${Math.max(0, Math.min(100, progressPercent))}%;
            height: 100%;
            background: ${statusDotColor};
            transition: width 0.3s ease;
          "></div>
        </div>
        ${safeError ? `<div style="font-size: 11px; color: var(--accent-dim); margin-top: 2px;">${safeError}</div>` : ''}
      </div>

      <!-- 操作按钮栏 (保证移动端触控点击热区 >= 44pt/48dp) -->
      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 4px;">
        ${!isDone ? `
          <button type="button" class="subagent-btn-interrupt" data-subagent-id="${escapeHtml(subagentId)}" style="
            min-height: 44px;
            padding: 0 14px;
            font-size: 12px;
            border-radius: 6px;
            border: 1px solid var(--border-subtle);
            background: transparent;
            color: var(--text-muted);
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
          ">${t('subagent.interrupt')}</button>
        ` : ''}

        <button type="button" class="subagent-btn-inspect" data-subagent-id="${escapeHtml(subagentId)}" style="
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
        ">${t('subagent.viewStream')}</button>
      </div>
    </div>
  `;
}
