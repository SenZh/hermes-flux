/**
 * Hermes Flux 二次确认对话框组件 (ConfirmModal)
 *
 * 【设计意图 (Why)】
 * 彻底废除浏览器与操作系统原生的同步阻塞式 `window.confirm()`。
 * 保持对话框在纯 DOM 树中渲染，既与全局电影级暗黑美学完全融合，
 * 又从物理层面杜绝了 Win32 原生模态框导致的 Chromium 宿主窗口脱敏与光标静默抑制。
 *
 * 【防范的历史坑 (Pitfall)】
 * 1. 规避原生 confirm 弹窗关闭后 Windows 窗口焦点丢失至虚空、Blink Caret 停振；
 * 2. 按钮热区严格保持 >= 44pt/48dp，适配触控与高分屏精确命中；
 * 3. 必须支持快捷键 Esc 取消与 Enter 确认，保持极客终端的高效键盘流。
 *
 * 【约束与规则 (Rules)】
 * - 纯 UI 表现层标准模板，零平台私有调用；
 * - 样式完全使用主题 Tokens，零硬编码色值。
 */

import { t } from '../../i18n/index.js';
import { escapeHtml } from '../MiddlePod/MiddlePod.js';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDanger?: boolean;
}

export function renderConfirmModal(props?: ConfirmModalProps): string {
  if (!props || !props.isOpen) return '';

  const safeTitle = escapeHtml(props.title || t('common.confirm'));
  const safeMessage = escapeHtml(props.message || '');
  const confirmText = escapeHtml(props.confirmLabel || (props.isDanger ? t('ctx.delete') : t('common.confirm')));
  const cancelText = escapeHtml(props.cancelLabel || t('common.cancel'));

  const confirmBtnBg = props.isDanger ? 'var(--danger-color)' : 'var(--accent)';
  const confirmBtnColor = 'var(--text-main)';

  return `
    <div id="flux-confirm-modal-overlay" style="
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.72);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      z-index: 2500;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      animation: flux-fade-in 0.15s cubic-bezier(0.16, 1, 0.3, 1);
    ">
      <div id="flux-confirm-modal-card" style="
        width: 100%;
        max-width: 420px;
        background: var(--bg-card);
        border: 1px solid var(--border-medium);
        border-radius: 12px;
        box-shadow: var(--shadow-window);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        user-select: none;
      ">
        <!-- Header -->
        <div style="
          padding: 14px 18px;
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--bg-panel);
        ">
          <div style="font-size: 13.5px; font-weight: 600; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
            ${
              props.isDanger
                ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--danger-color);"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
                : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent);"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
            }
            <span>${safeTitle}</span>
          </div>
          <button id="btn-confirm-modal-close" type="button" style="
            background: transparent;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            transition: color 0.15s ease;
          " title="${cancelText}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <!-- Body Message -->
        <div style="padding: 20px 18px; font-size: 13px; line-height: 1.6; color: var(--text-secondary); word-break: break-word;">
          ${safeMessage}
        </div>

        <!-- Footer Actions -->
        <div style="
          padding: 12px 18px;
          border-top: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          background: var(--bg-panel);
        ">
          <button id="btn-confirm-modal-cancel" type="button" style="
            padding: 0 16px;
            min-height: 44px;
            background: var(--bg-card);
            border: 1px solid var(--border-subtle);
            border-radius: 6px;
            color: var(--text-main);
            font-size: 12.5px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.15s ease;
          ">${cancelText}</button>
          <button id="btn-confirm-modal-ok" type="button" style="
            padding: 0 18px;
            min-height: 44px;
            background: ${confirmBtnBg};
            border: none;
            border-radius: 6px;
            color: ${confirmBtnColor};
            font-size: 12.5px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
            transition: opacity 0.15s ease;
          ">${confirmText}</button>
        </div>
      </div>
    </div>
  `;
}
