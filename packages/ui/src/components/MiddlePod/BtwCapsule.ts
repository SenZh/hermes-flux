/**
 * Reusable BTW Isolated Specialist Advice Capsule
 * (packages/ui/src/components/MiddlePod/BtwCapsule.ts)
 *
 * 设计意图 (Why):
 *   当用户在主会话中通过 prompt.btw 呼叫外部专职专家时，
 *   应答内容不进入当前会话上下文窗口，以微距受光的外援只读胶囊呈现。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 样式规范：全量走 var(--token)，零带色相硬编码。
 *   2. 触控热区：引用按钮 min-height: 44px。
 *   3. 零内联中文：全量使用 t('key')。
 *
 * 约束与规则 (Rules):
 *   - 纯 Web 标准模板，全平台复用。
 */

import { t } from '../../i18n/index.js';
import { escapeHtml } from './MiddlePod.js';

export interface BtwCapsuleProps {
  targetProfile: string;
  response: string;
  tokenCount?: number;
}

export function renderBtwCapsule(props: BtwCapsuleProps): string {
  const { targetProfile, response, tokenCount } = props;
  const safeProfile = escapeHtml(targetProfile || 'Agent');
  const safeText = escapeHtml(response);

  return `
    <div class="btw-isolated-capsule" data-target-profile="${safeProfile}" style="
      margin: 10px 0;
      padding: 14px 16px;
      border-radius: 10px;
      background: var(--bg-card);
      border: 1px solid var(--border-medium);
      box-shadow: var(--shadow-card);
      display: flex;
      flex-direction: column;
      gap: 10px;
      color: var(--text-main);
      font-family: inherit;
    ">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="
            width: 24px;
            height: 24px;
            border-radius: 6px;
            background: var(--bg-card-hover);
            border: 1px solid var(--border-subtle);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
          ">💡</span>
          <span style="font-size: 13px; font-weight: 600; color: var(--text-main);">
            ${t('btw.capsuleTitle')}
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

        <span style="font-size: 11px; color: var(--accent); display: flex; align-items: center; gap: 4px;">
          🛡️ ${t('btw.isolatedNotice')}
        </span>
      </div>

      <div style="
        font-size: 13px;
        line-height: 1.6;
        color: var(--text-main);
        white-space: pre-wrap;
      ">${safeText}</div>

      <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--border-subtle); padding-top: 8px;">
        <span style="font-size: 10px; color: var(--text-muted); font-family: monospace;">
          ${tokenCount ? `${tokenCount} tokens` : ''}
        </span>
        <button
          type="button"
          class="btw-btn-quote"
          data-quote-text="${safeText}"
          style="
            min-height: 44px;
            padding: 0 14px;
            font-size: 12px;
            font-weight: 500;
            border-radius: 6px;
            border: 1px solid var(--border-subtle);
            background: var(--bg-card-hover);
            color: var(--text-main);
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 4px;
          "
        >${t('btw.copyAnswer')}</button>
      </div>
    </div>
  `;
}
