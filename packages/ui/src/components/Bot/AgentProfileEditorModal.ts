/**
 * Hermes Flux Universal Agent Profile Editor Modal (v4.0)
 * Allows customizing Display Name, ID, Description, Model Binding,
 * Skills/Tools toggles, and System Persona (Soul).
 */

import { t } from '../../i18n/index.js';
import { escapeHtml } from '../MiddlePod/MiddlePod.js';

export interface AgentProfileEditorSkill {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
}

export interface AgentProfileEditorProps {
  isOpen: boolean;
  profile?: {
    name: string;
    displayName: string;
    description?: string;
    avatar?: string;
    model?: string;
    systemPrompt?: string;
    skills?: AgentProfileEditorSkill[];
    isDefault?: boolean;
  };
  availableModels?: string[];
}

export function renderAgentProfileEditorModal(props: AgentProfileEditorProps): string {
  if (!props.isOpen || !props.profile) return '';

  const p = props.profile;
  const models = props.availableModels || [];
  const defaultSkills: AgentProfileEditorSkill[] = p.skills && p.skills.length > 0 ? p.skills : [
    { id: 'shell', name: t('agent.skillShell'), description: t('agent.skillShellDesc'), enabled: true },
    { id: 'file_ops', name: t('agent.skillFileOps'), description: t('agent.skillFileOpsDesc'), enabled: true },
    { id: 'web_search', name: t('agent.skillWebSearch'), description: t('agent.skillWebSearchDesc'), enabled: true },
    { id: 'code_review', name: t('agent.skillCodeReview'), description: t('agent.skillCodeReviewDesc'), enabled: true },
  ];

  const avatarDisplay = p.avatar
    ? `<img src="${escapeHtml(p.avatar)}" style="width: 56px; height: 56px; border-radius: 50%; object-fit: cover; border: 2px solid var(--accent);" />`
    : `<div style="width: 56px; height: 56px; border-radius: 50%; background: var(--bg-card-hover); border: 2px solid var(--accent); display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: bold; color: var(--accent);">${escapeHtml((p.displayName || p.name || 'A').slice(0, 1).toUpperCase())}</div>`;

  return `
    <div id="agent-profile-editor-backdrop" style="
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(8px);
      z-index: 2500;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      animation: flux-fade-in 0.15s cubic-bezier(0.16, 1, 0.3, 1);
    ">
      <div id="agent-profile-editor-modal" style="
        width: 540px;
        max-width: 95vw;
        max-height: 85vh;
        background: var(--bg-card);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-window, 12px);
        box-shadow: var(--shadow-window);
        display: flex;
        flex-direction: column;
        overflow: hidden;
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
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent);"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span style="font-size: 14px; font-weight: 600; color: var(--text-main);">${t('agent.editTitle')}</span>
          </div>
          <button id="btn-close-agent-editor" type="button" style="
            width: 24px;
            height: 24px;
            border: none;
            background: transparent;
            color: var(--text-muted);
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <!-- Form Body -->
        <div style="
          flex: 1;
          overflow-y: auto;
          padding: 16px 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        ">
          <!-- Visual Avatar & Identity Banner -->
          <div style="display: flex; align-items: center; gap: 16px; padding: 12px; background: var(--bg-panel); border-radius: 8px; border: 1px solid var(--border-subtle);">
            ${avatarDisplay}
            <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 11px; color: var(--text-muted);">${t('agent.profileId')}:</span>
                <span id="agent-editor-id-val" style="font-size: 11px; font-family: var(--font-mono); color: var(--text-secondary); background: var(--bg-card); padding: 1px 6px; border-radius: 4px; border: 1px solid var(--border-subtle);">${escapeHtml(p.name)}</span>
              </div>
              <div style="font-size: 11px; color: var(--text-muted);">
                ${p.isDefault ? t('agent.officialCoreAgent') : t('agent.customDedicatedAgent')}
              </div>
            </div>
          </div>

          <!-- Display Name Field (用户可以随时自由修改) -->
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 12px; font-weight: 500; color: var(--text-main);">${t('agent.displayName')} <span style="color: var(--accent);">*</span></label>
            <input
              type="text"
              id="agent-editor-display-name"
              value="${escapeHtml(p.displayName || p.name)}"
              placeholder="${t('agent.namePlaceholder')}"
              style="
                width: 100%;
                height: 32px;
                background: var(--bg-panel);
                border: 1px solid var(--border-medium);
                border-radius: 6px;
                padding: 0 10px;
                font-size: 12.5px;
                color: var(--text-main);
                outline: none;
                box-sizing: border-box;
              "
            />
          </div>

          <!-- Description Field -->
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 12px; font-weight: 500; color: var(--text-main);">${t('agent.description')}</label>
            <textarea
              id="agent-editor-desc"
              placeholder="${t('agent.descriptionPlaceholder')}"
              rows="2"
              style="
                width: 100%;
                background: var(--bg-panel);
                border: 1px solid var(--border-medium);
                border-radius: 6px;
                padding: 8px 10px;
                font-size: 12px;
                color: var(--text-main);
                outline: none;
                resize: vertical;
                font-family: var(--font-sans);
                box-sizing: border-box;
              "
            >${escapeHtml(p.description || '')}</textarea>
          </div>

          <!-- Model Binding (Optional) -->
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 12px; font-weight: 500; color: var(--text-main);">${t('agent.modelBinding')}</label>
            <select
              id="agent-editor-model-select"
              style="
                width: 100%;
                height: 32px;
                background: var(--bg-panel);
                border: 1px solid var(--border-medium);
                border-radius: 6px;
                padding: 0 8px;
                font-size: 12px;
                color: var(--text-main);
                outline: none;
              "
            >
              <option value="">${t('agent.defaultModel')}</option>
              ${models
                .map((m) => `<option value="${escapeHtml(m)}" ${p.model === m ? 'selected' : ''}>${escapeHtml(m)}</option>`)
                .join('')}
            </select>
          </div>

          <!-- Skills & Toolsets Toggles -->
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 12px; font-weight: 500; color: var(--text-main);">${t('agent.skillsAndTools')}</label>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px;">
              ${defaultSkills
                .map(
                  (sk) => `
                <label style="
                  display: flex;
                  align-items: center;
                  gap: 8px;
                  padding: 8px 10px;
                  background: var(--bg-panel);
                  border: 1px solid var(--border-subtle);
                  border-radius: 6px;
                  cursor: pointer;
                  font-size: 11.5px;
                ">
                  <input type="checkbox" class="agent-skill-checkbox" data-skill-id="${sk.id}" ${sk.enabled ? 'checked' : ''} style="accent-color: var(--accent); cursor: pointer;" />
                  <div style="display: flex; flex-direction: column;">
                    <span style="font-weight: 500; color: var(--text-main);">${escapeHtml(sk.name)}</span>
                    ${sk.description ? `<span style="font-size: 10px; color: var(--text-muted);">${escapeHtml(sk.description)}</span>` : ''}
                  </div>
                </label>
              `
                )
                .join('')}
            </div>
          </div>

          <!-- System Prompt / Persona -->
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 12px; font-weight: 500; color: var(--text-main);">${t('agent.systemPrompt')}</label>
            <textarea
              id="agent-editor-prompt"
              placeholder="${t('agent.systemPromptPlaceholder')}"
              rows="4"
              style="
                width: 100%;
                background: var(--bg-panel);
                border: 1px solid var(--border-medium);
                border-radius: 6px;
                padding: 8px 10px;
                font-size: 11.5px;
                color: var(--text-main);
                outline: none;
                resize: vertical;
                font-family: var(--font-mono);
                box-sizing: border-box;
                line-height: 1.4;
              "
            >${escapeHtml(p.systemPrompt || '')}</textarea>
          </div>
        </div>

        <!-- Footer Actions -->
        <div style="
          padding: 12px 18px;
          border-top: 1px solid var(--border-subtle);
          background: var(--bg-panel);
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
        ">
          <button id="btn-cancel-agent-editor" type="button" style="
            height: 32px;
            padding: 0 14px;
            border-radius: 6px;
            border: 1px solid var(--border-medium);
            background: transparent;
            color: var(--text-secondary);
            font-size: 12px;
            cursor: pointer;
          ">
            ${t('common.cancel')}
          </button>
          <button id="btn-save-agent-editor" type="button" style="
            height: 32px;
            padding: 0 16px;
            border-radius: 6px;
            border: none;
            background: var(--accent);
            color: var(--text-main);
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 2px 8px var(--accent-glow);
          ">
            ${t('agent.saveChanges')}
          </button>
        </div>
      </div>
    </div>
  `;
}
