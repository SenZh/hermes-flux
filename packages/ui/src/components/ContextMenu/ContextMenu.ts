/**
 * Hermes Flux Context Menu Component
 * Supports Session, Dedicated Bot and Multi-Agent Group context menus.
 */

import { t } from '../../i18n/index.js';

export interface ContextMenuProps {
  x: number;
  y: number;
  targetType: 'session' | 'bot' | 'group';
  targetId: string;
  targetName: string;
  sessionId?: string;
  sessionTitle?: string;
}

export function renderContextMenu(ctx?: ContextMenuProps): string {
  if (!ctx) return '';

  if (ctx.targetType === 'bot') {
    return `
      <div id="session-context-menu" class="flux-context-menu" style="
        position: fixed;
        left: ${ctx.x}px;
        top: ${ctx.y}px;
        background: var(--bg-card);
        border: 1px solid var(--border-strong);
        border-radius: 9px;
        box-shadow: var(--shadow-window);
        padding: 4px;
        min-width: 160px;
        z-index: 2000;
        display: flex;
        flex-direction: column;
        gap: 1px;
        font-size: 12px;
        user-select: none;
        backdrop-filter: blur(20px);
        animation: flux-fade-in 0.15s cubic-bezier(0.16, 1, 0.3, 1);
      ">
        <button type="button" class="ctx-item" data-action="bot-chat" style="padding: 6px 9px; border-radius: 6px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 9px; cursor: pointer; text-align: left; font-size: 12px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent); flex-shrink: 0;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span>${t('ctx.botChat')}</span>
        </button>
        <button type="button" class="ctx-item" data-action="copy-id" style="padding: 6px 9px; border-radius: 6px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 9px; cursor: pointer; text-align: left; font-size: 12px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); flex-shrink: 0;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>${t('ctx.copyId')}</span>
        </button>
        <div style="height: 1px; background: var(--border-subtle); margin: 3px 0;"></div>
        <button type="button" class="ctx-item" data-action="bot-edit" style="padding: 6px 9px; border-radius: 6px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 9px; cursor: pointer; text-align: left; font-size: 12px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); flex-shrink: 0;"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
          <span>${t('ctx.botConfig')}</span>
        </button>
      </div>
    `;
  }

  if (ctx.targetType === 'group') {
    return `
      <div id="session-context-menu" class="flux-context-menu" style="
        position: fixed;
        left: ${ctx.x}px;
        top: ${ctx.y}px;
        background: var(--bg-card);
        border: 1px solid var(--border-strong);
        border-radius: 9px;
        box-shadow: var(--shadow-window);
        padding: 4px;
        min-width: 160px;
        z-index: 2000;
        display: flex;
        flex-direction: column;
        gap: 1px;
        font-size: 12px;
        user-select: none;
        backdrop-filter: blur(20px);
        animation: flux-fade-in 0.15s cubic-bezier(0.16, 1, 0.3, 1);
      ">
        <button type="button" class="ctx-item" data-action="group-rename" style="padding: 6px 9px; border-radius: 6px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 9px; cursor: pointer; text-align: left; font-size: 12px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); flex-shrink: 0;"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
          <span>${t('ctx.rename')}</span>
        </button>
        <button type="button" class="ctx-item" data-action="copy-id" style="padding: 6px 9px; border-radius: 6px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 9px; cursor: pointer; text-align: left; font-size: 12px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); flex-shrink: 0;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>${t('ctx.copyId')}</span>
        </button>
        <div style="height: 1px; background: var(--border-subtle); margin: 3px 0;"></div>
        <button type="button" class="ctx-item ctx-danger-item" data-action="disband-group" style="padding: 6px 9px; border-radius: 6px; border: none; background: transparent; color: var(--danger-color, inherit); display: flex; align-items: center; gap: 9px; cursor: pointer; text-align: left; font-size: 12px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--danger-color, inherit); flex-shrink: 0;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          <span>${t('ctx.disbandGroup')}</span>
        </button>
      </div>
    `;
  }

  return `
    <div id="session-context-menu" class="flux-context-menu" style="
      position: fixed;
      left: ${ctx.x}px;
      top: ${ctx.y}px;
      background: var(--bg-card);
      border: 1px solid var(--border-strong);
      border-radius: 9px;
      box-shadow: var(--shadow-window);
      padding: 4px;
      min-width: 160px;
      z-index: 2000;
      display: flex;
      flex-direction: column;
      gap: 1px;
      font-size: 12px;
      user-select: none;
      backdrop-filter: blur(20px);
      animation: flux-fade-in 0.15s cubic-bezier(0.16, 1, 0.3, 1);
    ">
      <button type="button" class="ctx-item" data-action="rename" style="padding: 6px 9px; border-radius: 6px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 9px; cursor: pointer; text-align: left; font-size: 12px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); flex-shrink: 0;"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
        <span>${t('ctx.rename')}</span>
      </button>
      <button type="button" class="ctx-item" data-action="copy-id" style="padding: 6px 9px; border-radius: 6px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 9px; cursor: pointer; text-align: left; font-size: 12px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); flex-shrink: 0;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        <span>${t('ctx.copySessionId')}</span>
      </button>
      <button type="button" class="ctx-item" data-action="pin" style="padding: 6px 9px; border-radius: 6px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 9px; cursor: pointer; text-align: left; font-size: 12px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); flex-shrink: 0;"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>
        <span>${t('ctx.pin')}</span>
      </button>
      <button type="button" class="ctx-item" data-action="export" style="padding: 6px 9px; border-radius: 6px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 9px; cursor: pointer; text-align: left; font-size: 12px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); flex-shrink: 0;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <span>${t('ctx.export')}</span>
      </button>
      <div style="height: 1px; background: var(--border-subtle); margin: 3px 0;"></div>
      <button type="button" class="ctx-item" data-action="archive" style="padding: 6px 9px; border-radius: 6px; border: none; background: transparent; color: var(--text-main); display: flex; align-items: center; gap: 9px; cursor: pointer; text-align: left; font-size: 12px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); flex-shrink: 0;"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
        <span>${t('ctx.archive')}</span>
      </button>
      <button type="button" class="ctx-item ctx-danger-item" data-action="delete" style="padding: 6px 9px; border-radius: 6px; border: none; background: transparent; color: var(--danger-color, inherit); display: flex; align-items: center; gap: 9px; cursor: pointer; text-align: left; font-size: 12px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--danger-color, inherit); flex-shrink: 0;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        <span>${t('ctx.delete')}</span>
      </button>
    </div>
  `;
}
