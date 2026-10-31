/**
 * Hermes Flux New Task / Group Room Modal (v5.2 - Linear / shadcn Spec)
 * Allows the user to deterministically configure:
 * 1. Task Mode: Solo Agent Task vs. Multi-Agent Group Room
 * 2. Target Agent / Participating Members
 * 3. Associated Project / Workspace (CWD)
 * 4. Task Goal / Discussion Topic
 */

import { t } from '../../i18n/index.js';
import type { LeftRailProject } from '../LeftRail/LeftRail.js';

export interface NewTaskModalProps {
  isOpen: boolean;
  profiles: Array<{ name: string; displayName: string; avatar?: string; model?: string; isDefault?: boolean }>;
  projects: LeftRailProject[];
  selectedProfile: string;
  selectedProjectId?: string;
  onClose?: () => void;
  onSubmit?: (data: {
    type: 'solo' | 'group';
    profile: string;
    members?: string[];
    projectId?: string;
    taskTitle: string;
  }) => void;
}

export function renderNewTaskModal(props: NewTaskModalProps): string {
  if (!props.isOpen) return '';

  return `
    <div id="new-task-modal-overlay" style="
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.70);
      backdrop-filter: blur(8px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    ">
      <div id="new-task-modal-container" style="
        width: 100%;
        max-width: 520px;
        background: var(--bg-card);
        border: 1px solid var(--border-medium);
        border-radius: 12px;
        box-shadow: var(--shadow-window);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        user-select: none;
      ">
        <!-- Modal Header -->
        <div style="
          padding: 14px 18px;
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--bg-panel);
        ">
          <div style="font-size: 14px; font-weight: 600; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            <span>${t('modal.newTaskTitle')}</span>
          </div>
          <button id="btn-close-task-modal" type="button" style="
            background: transparent;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <!-- Modal Body Form -->
        <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; max-height: 75vh; overflow-y: auto;">
          <!-- 1. Task Mode Switcher [ 单会话 | 群聊 ] -->
          <div style="display: flex; background: var(--bg-panel); padding: 3px; border-radius: 8px; border: 1px solid var(--border-subtle); gap: 4px;">
            <button id="modal-tab-solo" type="button" class="modal-type-btn active" data-type="solo" style="
              flex: 1;
              height: 32px;
              border-radius: 6px;
              border: 1px solid var(--border-medium);
              background: var(--bg-card);
              color: var(--text-main);
              font-size: 12px;
              font-weight: 600;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 6px;
              cursor: pointer;
              transition: all 0.15s ease;
            ">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span>${t('modal.taskTypeSolo')}</span>
            </button>

            <button id="modal-tab-group" type="button" class="modal-type-btn" data-type="group" style="
              flex: 1;
              height: 32px;
              border-radius: 6px;
              border: 1px solid transparent;
              background: transparent;
              color: var(--text-muted);
              font-size: 12px;
              font-weight: 600;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 6px;
              cursor: pointer;
              transition: all 0.15s ease;
            ">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <span>${t('modal.taskTypeGroup')}</span>
            </button>
          </div>

          <!-- 2. Target Agent Selection (For Solo Mode) -->
          <div id="modal-section-solo-agent" style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary);">${t('modal.selectAgent')}</label>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px;">
              ${props.profiles
                .map((p) => {
                  const isSelected = p.name === props.selectedProfile;
                  return `
                  <div class="modal-agent-option ${isSelected ? 'selected' : ''}" data-profile="${escapeHtml(p.name)}" style="
                    padding: 8px 10px;
                    border-radius: 8px;
                    border: 1px solid ${isSelected ? 'var(--accent)' : 'var(--border-subtle)'};
                    background: ${isSelected ? 'var(--accent-subtle)' : 'var(--bg-panel)'};
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    transition: border-color 0.12s ease;
                  ">
                    <span style="
                      width: 20px;
                      height: 20px;
                      border-radius: 5px;
                      background: var(--bg-card);
                      border: 1px solid var(--border-subtle);
                      color: var(--accent);
                      font-size: 9px;
                      font-weight: 700;
                      display: inline-flex;
                      align-items: center;
                      justify-content: center;
                      flex-shrink: 0;
                    ">${(p.displayName || p.name).slice(0, 2).toUpperCase()}</span>
                    <div style="flex: 1; min-width: 0;">
                      <div style="font-size: 12px; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${escapeHtml(p.displayName || p.name)}
                      </div>
                    </div>
                  </div>
                `;
                })
                .join('')}
            </div>
          </div>

          <!-- 2b. Multi-Agent Group Members Selection (For Group Mode) -->
          <div id="modal-section-group-members" style="display: none; flex-direction: column; gap: 6px;">
            <label style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary);">${t('modal.selectMembers')}</label>
            <div style="display: flex; flex-direction: column; gap: 4px; background: var(--bg-panel); padding: 8px; border-radius: 8px; border: 1px solid var(--border-subtle);">
              ${props.profiles
                .map((p, idx) => {
                  const isChecked = idx < 2;
                  return `
                  <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-main); cursor: pointer; padding: 4px 6px; border-radius: 5px;">
                    <input type="checkbox" class="modal-group-member-checkbox" value="${escapeHtml(p.name)}" ${isChecked ? 'checked' : ''} style="cursor: pointer;" />
                    <span>${escapeHtml(p.displayName || p.name)}</span>
                    <span style="font-size: 11px; color: var(--text-muted); margin-left: auto;">${escapeHtml(p.model || 'Auto')}</span>
                  </label>
                `;
                })
                .join('')}
            </div>
          </div>

          <!-- 3. Associated Project / Workspace CWD -->
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary);">${t('modal.selectProject')}</label>
            <select id="modal-project-select" style="
              width: 100%;
              height: 32px;
              background: var(--bg-panel);
              border: 1px solid var(--border-subtle);
              border-radius: 6px;
              color: var(--text-main);
              font-size: 12px;
              padding: 0 8px;
              outline: none;
              cursor: pointer;
            ">
              <option value="">${t('modal.noProject')}</option>
              ${props.projects
                .map((p) => {
                  const isSelected = p.id === props.selectedProjectId;
                  return `<option value="${escapeHtml(p.id)}" ${isSelected ? 'selected' : ''}>${escapeHtml(p.name)} (${escapeHtml(p.path || 'Root')})</option>`;
                })
                .join('')}
            </select>
          </div>

          <!-- 4. Task Title / Goal Input -->
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary);">${t('modal.taskTitleLabel')}</label>
            <input type="text" id="modal-task-title-input" placeholder="${t('modal.taskTitlePlaceholder')}" value="" style="
              width: 100%;
              height: 32px;
              background: var(--bg-panel);
              border: 1px solid var(--border-subtle);
              border-radius: 6px;
              padding: 0 10px;
              color: var(--text-main);
              font-size: 12px;
              outline: none;
              box-sizing: border-box;
            " />
          </div>
        </div>

        <!-- Modal Footer Actions -->
        <div style="
          padding: 12px 18px;
          border-top: 1px solid var(--border-subtle);
          background: var(--bg-panel);
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
        ">
          <button id="btn-cancel-task-modal" type="button" style="
            height: 32px;
            padding: 0 14px;
            border-radius: 6px;
            border: 1px solid var(--border-subtle);
            background: transparent;
            color: var(--text-secondary);
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
          ">${t('modal.cancel')}</button>

          <button id="btn-submit-task-modal" type="button" style="
            height: 32px;
            padding: 0 16px;
            border-radius: 6px;
            border: 1px solid var(--border-medium);
            background: var(--text-main);
            color: var(--bg-window);
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            box-shadow: var(--shadow-card);
          ">
            <span>${t('modal.startTask')}</span>
          </button>
        </div>
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
    .replace(/'/g, '&#39;');
}
