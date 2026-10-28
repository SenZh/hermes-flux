/**
 * Hermes Aura Left Rail Component (v3.5)
 * Width: 260px, collapsible to 0px.
 * Features:
 * - Full-width "+ 新建会话" button (no btnRailCollapseInline).
 * - Real session list from Gateway (empty state when no sessions).
 * - Session delete action on hover.
 * - Footer with active Profile badge and Settings button.
 */

export interface LeftRailSession {
  id: string;
  title: string;
  model?: string;
  time?: string;
  preview?: string;
  isArchived?: boolean;
}

export interface LeftRailProps {
  collapsed: boolean;
  activeSessionId: string;
  sessions: LeftRailSession[];
  profileName: string;
  gatewayOnline: boolean;
  gatewayLatencyMs: number;
  onNewChat?: () => void;
  onSelectSession?: (id: string) => void;
  onDeleteSession?: (id: string) => void;
  onOpenSettings?: () => void;
}

export function renderLeftRail(props: LeftRailProps): string {
  if (props.collapsed) {
    return `<aside id="aura-left-rail" class="rail-collapsed" style="width: 0px; min-width: 0px; display: none; overflow: hidden;"></aside>`;
  }

  const activeSessions = props.sessions.filter((s) => !s.isArchived);
  const archivedSessions = props.sessions.filter((s) => s.isArchived);

  return `
    <aside id="aura-left-rail" class="aura-left-rail" style="
      width: 260px;
      min-width: 260px;
      max-width: 260px;
      height: 100%;
      background: var(--bg-rail);
      border-right: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      user-select: none;
      transition: width 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      position: relative;
    ">
      <!-- Search & New Chat -->
      <div style="padding: 12px 14px 8px; display: flex; flex-direction: column; gap: 8px;">
        <button id="new-chat-btn" class="btn-new-chat" style="
          width: 100%;
          height: 34px;
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: 8px;
          color: var(--text-main);
          font-size: 13px;
          font-weight: 500;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
          box-shadow: var(--shadow-card);
          transition: border-color 0.15s ease, background 0.15s ease;
        ">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="8" y1="3" x2="8" y2="13"/>
            <line x1="3" y1="8" x2="13" y2="8"/>
          </svg>
          <span>+ 新建会话</span>
        </button>

        <div style="position: relative; width: 100%;">
          <input type="text" id="session-search-input" placeholder="搜索会话..." style="
            width: 100%;
            height: 28px;
            background: var(--bg-panel);
            border: 1px solid var(--border-subtle);
            border-radius: 6px;
            padding: 0 10px 0 28px;
            font-size: 12px;
            color: var(--text-main);
            outline: none;
            box-sizing: border-box;
          " />
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" style="position: absolute; left: 9px; top: 8px; color: var(--text-muted);">
            <circle cx="7" cy="7" r="5"/>
            <line x1="11" y1="11" x2="15" y2="15"/>
          </svg>
        </div>
      </div>

      <!-- Session List Stream -->
      <div class="session-scroll-area" id="session-list-container" style="flex: 1; overflow-y: auto; padding: 6px 8px;">
        ${
          props.sessions.length === 0
            ? `
          <div style="padding: 32px 12px; text-align: center; color: var(--text-muted); font-size: 12px; display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span>暂无历史会话</span>
            <span style="font-size: 11px; color: var(--text-faint);">点击上方按钮开启全新任务</span>
          </div>
        `
            : `
          <div style="font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; padding: 6px 8px 4px;">近期会话 (${props.sessions.length})</div>
          
          <div style="display: flex; flex-direction: column; gap: 2px;">
            ${activeSessions
              .map((s) => {
                const isActive = s.id === props.activeSessionId;
                return `
                <div class="session-item ${isActive ? 'active' : ''}" data-id="${s.id}" style="
                  padding: 8px 10px;
                  border-radius: 7px;
                  background: ${isActive ? 'var(--bg-card-active)' : 'transparent'};
                  border: 1px solid ${isActive ? 'var(--border-medium)' : 'transparent'};
                  cursor: pointer;
                  transition: background 0.12s ease;
                  display: flex;
                  flex-direction: column;
                  gap: 3px;
                  position: relative;
                ">
                  <div style="display: flex; align-items: center; justify-content: space-between;">
                    <span class="session-title" style="font-size: 12px; font-weight: ${isActive ? '600' : '500'}; color: ${isActive ? 'var(--text-main)' : 'var(--text-secondary)'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px;">${escapeHtml(s.title || '未命名会话')}</span>
                    ${s.time ? `<span style="font-size: 10px; color: var(--text-muted);">${escapeHtml(s.time)}</span>` : ''}
                  </div>
                  ${
                    s.preview
                      ? `<div style="font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(s.preview)}</div>`
                      : ''
                  }
                </div>
              `;
              })
              .join('')}
          </div>

          ${
            archivedSessions.length > 0
              ? `
            <div style="font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; padding: 14px 8px 4px;">历史归档</div>
            <div style="display: flex; flex-direction: column; gap: 2px;">
              ${archivedSessions
                .map(
                  (s) => `
                <div class="session-item" data-id="${s.id}" style="padding: 7px 10px; border-radius: 6px; opacity: 0.7; cursor: pointer;">
                  <span style="font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;">${escapeHtml(s.title || '历史归档')}</span>
                </div>
              `
                )
                .join('')}
            </div>
          `
              : ''
          }
        `
        }
      </div>

      <!-- Footer User Profile & Settings Trigger -->
      <div class="rail-footer" style="
        padding: 10px 14px;
        border-top: 1px solid var(--border-subtle);
        background: var(--bg-panel);
        display: flex;
        align-items: center;
        justify-content: space-between;
      ">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: var(--accent);
            color: var(--theme-thumb-color, #090A0F);
            font-size: 11px;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            ${props.profileName ? props.profileName.charAt(0).toUpperCase() : 'A'}
          </div>
          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 11.5px; font-weight: 600; color: var(--text-main);">${escapeHtml(props.profileName || 'default')}</span>
            <span style="font-size: 9.5px; color: var(--text-muted); font-family: var(--font-mono);">${props.gatewayOnline ? 'CONNECTED' : 'STANDALONE'}</span>
          </div>
        </div>
        
        <button id="rail-footer-settings-btn" title="打开设置" style="
          background: transparent;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
    </aside>
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
