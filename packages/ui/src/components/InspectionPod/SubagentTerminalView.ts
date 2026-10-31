/**
 * Reusable Subagent Live Terminal & Steering View
 * (packages/ui/src/components/InspectionPod/SubagentTerminalView.ts)
 *
 * 设计意图 (Why):
 *   当用户点击卡片上的「⚡ 穿透查看执行流」时，无论在桌面端右侧栏还是在移动端底部抽屉，
 *   都必须能够以完全相同的模板和样式渲染子代理的独立思考、执行日志与实时干预输入舱。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 幽灵 Token 陷阱：严禁使用未注册的 CSS 变量，全量对接真实 Tokens（--bg-window、--bg-card、--accent、--text-main 等）。
 *   2. 移动端触控硬红线：输入框、发送按钮及关闭按钮物理热区严格 $\ge 44\text{pt}/48\text{dp}$。
 *   3. 移动端视口安全区：底部干预输入舱必须加上 env(safe-area-inset-bottom) 避让 Home Bar。
 *   4. 零硬编码文案：日志计数走 t('subagent.logCount', { count })，零内联英文单词。
 *
 * 约束与规则 (Rules):
 *   - 纯 Web 标准模板，零外部私有宿主 API。
 *   - 支持作为 InspectionPod Tab 或 Mobile BottomSheet 嵌入。
 */

import type { SubagentTaskState, SubagentLogEntry } from '@hermes-flux/core';
import { t } from '../../i18n/index.js';
import { escapeHtml } from '../MiddlePod/MiddlePod.js';

export interface SubagentTerminalViewProps {
  task: SubagentTaskState;
  logs: SubagentLogEntry[];
  isMobileSheet?: boolean;
}

export function renderSubagentTerminalView(props: SubagentTerminalViewProps): string {
  const { task, logs, isMobileSheet = false } = props;

  const safeTitle = escapeHtml(task.taskTitle || t('subagent.cardTitle'));
  const safeProfile = escapeHtml(task.targetProfile || 'Agent');
  const safeSubagentId = escapeHtml(task.subagentId);

  // 格式化日志行（严格使用 Design System 注册色值与语义 Token）
  const logLinesHtml = logs.length === 0
    ? `<div style="color: var(--text-muted); font-style: italic; padding: 32px 16px; text-align: center;">${t('subagent.emptyLogs')}</div>`
    : logs
        .map((entry) => {
          const safeText = escapeHtml(entry.text);
          let tagColor = 'var(--text-muted)';
          let tagLabel = 'STDOUT';

          if (entry.kind === 'thought') {
            tagColor = 'var(--accent-hover)';
            tagLabel = 'THOUGHT';
          } else if (entry.kind === 'tool_call') {
            tagColor = 'var(--accent)';
            tagLabel = 'TOOL';
          } else if (entry.kind === 'tool_result') {
            tagColor = 'var(--jade-pulse)';
            tagLabel = 'RESULT';
          } else if (entry.kind === 'stderr') {
            tagColor = 'var(--accent-dim)';
            tagLabel = 'STDERR';
          } else if (entry.kind === 'status_change') {
            tagColor = 'var(--text-secondary)';
            tagLabel = 'SYSTEM';
          }

          return `
            <div style="display: flex; gap: 10px; line-height: 1.6; padding: 2px 0;">
              <span style="color: ${tagColor}; font-size: 11px; font-weight: 600; flex-shrink: 0; min-width: 58px;">[${tagLabel}]</span>
              <span style="color: var(--text-main); word-break: break-all; white-space: pre-wrap;">${safeText}</span>
            </div>
          `;
        })
        .join('');

  return `
    <div class="subagent-terminal-view" data-subagent-id="${safeSubagentId}" style="
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--bg-window);
      color: var(--text-main);
      font-family: inherit;
      position: relative;
    ">
      <!-- 顶部控制条 -->
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
        <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
          <span style="
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--accent);
            box-shadow: 0 0 8px var(--accent);
            display: inline-block;
          "></span>
          <span style="font-weight: 600; font-size: 13px; color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${safeTitle}
          </span>
          <span style="
            font-size: 11px;
            padding: 2px 6px;
            border-radius: 4px;
            background: var(--bg-card);
            color: var(--text-secondary);
            border: 1px solid var(--border-subtle);
          ">@${safeProfile}</span>
        </div>

        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 11px; color: var(--text-muted); font-family: monospace;">
            ${t('subagent.logCount', { count: logs.length })}
          </span>
          ${isMobileSheet ? `
            <button type="button" class="subagent-btn-close-sheet" style="
              min-width: 44px;
              min-height: 44px;
              border: none;
              background: transparent;
              color: var(--text-secondary);
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 13px;
            ">${t('subagent.closeSheet')}</button>
          ` : ''}
        </div>
      </div>

      <!-- 中间流式日志控制台 -->
      <div class="subagent-terminal-stream" style="
        flex: 1;
        overflow-y: auto;
        padding: 14px 16px;
        font-family: monospace;
        font-size: 12px;
        background: var(--bg-code);
      ">
        ${logLinesHtml}
      </div>

      <!-- 底部实时干预输入舱 (保证移动端 44pt 触控热区与 Home Bar 安全区避让) -->
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
          class="subagent-steer-input"
          placeholder="${t('subagent.steerPlaceholder')}"
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
          class="subagent-btn-steer"
          data-subagent-id="${safeSubagentId}"
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
            transition: opacity 0.2s;
          "
        >${t('subagent.steerSend')}</button>
      </div>
    </div>
  `;
}
