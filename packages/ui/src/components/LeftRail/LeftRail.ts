/**
 * Hermes Aura Left Rail Component (v4.0 Production)
 * Width: 260px, collapsible to 0px.
 * Features:
 * - Full-width "+ 新建会话" button (no inline collapse button).
 * - Real session list from Gateway (empty state when no sessions).
 * - Session delete action on hover.
 * - Active item indicator with 3px amber/jade highlight bar.
 * - Footer with active Profile badge, latency, and Settings button.
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
  /** Why the session list could not be loaded — an empty rail is not a failure. */
  error?: string;
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
  const railError = (props.error || '').trim();

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
          height: 36px;
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: 8px;
          color: var(--text-main);
          font-size: 13px;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
          box-shadow: var(--shadow-card);
          transition: border-color 0.15s ease, background 0.15s ease, transform 0.1s ease;
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
          railError
            ? `
          <div id="session-list-error" role="alert" style="
            margin: 6px 4px 10px;
            padding: 8px 10px;
            border-radius: 8px;
            border: 1px solid rgba(239, 68, 68, 0.28);
            background: rgba(239, 68, 68, 0.08);
            color: #F87171;
            font-size: 11px;
            line-height: 1.5;
            word-break: break-word;
          ">会话列表加载失败：${escapeHtml(railError)}</div>
        `
            : ''
        }
        ${
          props.sessions.length === 0
            ? `
          <div style="padding: 36px 12px; text-align: center; color: var(--text-muted); font-size: 12px; display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span>${railError ? '暂时无法显示历史会话' : '暂无历史会话'}</span>
            <span style="font-size: 11px; color: var(--text-faint);">${railError ? '请检查网关连接后重试' : '点击上方按钮开启全新会话任务'}</span>
          </div>
        `
            : `
          <div style="font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; padding: 6px 8px 4px;">近期任务 (${props.sessions.length})</div>
          
          <div style="display: flex; flex-direction: column; gap: 2px;">
            ${activeSessions
              .map((s) => {
                const isActive = s.id === props.activeSessionId;
                return `
                <div class="session-item ${isActive ? 'active' : ''}" data-id="${s.id}" style="
                  padding: 8px 10px;
                  border-radius: 8px;
                  background: ${isActive ? 'var(--bg-card-active)' : 'transparent'};
                  border: 1px solid ${isActive ? 'var(--border-medium)' : 'transparent'};
                  cursor: pointer;
                  display: flex;
                  flex-direction: column;
                  gap: 3px;
                  position: relative;
                  transition: background 0.12s ease;
                ">
                  ${isActive ? '<div class="active-indicator" style="position: absolute; left: 0; top: 6px; bottom: 6px; width: 3px; background: var(--accent); border-radius: 0 2px 2px 0;"></div>' : ''}
                  
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; padding-left: ${isActive ? '4px' : '0'};">
                    <span style="
                      font-size: 12.5px;
                      font-weight: ${isActive ? '600' : '500'};
                      color: ${isActive ? 'var(--text-main)' : 'var(--text-secondary)'};
                      white-space: nowrap;
                      overflow: hidden;
                      text-overflow: ellipsis;
                      flex: 1;
                    ">${escapeHtml(s.title)}</span>

                    <button class="btn-delete-session" data-id="${s.id}" title="删除会话" style="
                      background: transparent;
                      border: none;
                      color: var(--text-muted);
                      cursor: pointer;
                      padding: 2px 4px;
                      border-radius: 4px;
                      font-size: 10px;
                      opacity: 0.6;
                    ">✕</button>
                  </div>

                  <div style="display: flex; align-items: center; justify-content: space-between; font-size: 10.5px; color: var(--text-faint); padding-left: ${isActive ? '4px' : '0'};">
                    <span style="font-family: var(--font-mono);">${escapeHtml(s.model || 'hermes')}</span>
                    <span>${escapeHtml(s.time || '')}</span>
                  </div>
                </div>
              `;
              })
              .join('')}
          </div>

          ${
            archivedSessions.length > 0
              ? `
            <div style="font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; padding: 14px 8px 4px;">归档会话 (${archivedSessions.length})</div>
            <div style="display: flex; flex-direction: column; gap: 2px;">
              ${archivedSessions
                .map((s) => {
                  const isActive = s.id === props.activeSessionId;
                  return `
                  <div class="session-item ${isActive ? 'active' : ''}" data-id="${s.id}" style="
                    padding: 8px 10px;
                    border-radius: 8px;
                    background: ${isActive ? 'var(--bg-card-active)' : 'transparent'};
                    cursor: pointer;
                    display: flex;
                    flex-direction: column;
                    gap: 3px;
                    opacity: 0.7;
                  ">
                    <span style="font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(s.title)}</span>
                  </div>
                `;
                })
                .join('')}
            </div>
          `
              : ''
          }
        `
        }
      </div>

      <!-- Rail Footer: Profile & Settings -->
      <div class="rail-footer" style="
        padding: 10px 14px;
        border-top: 1px solid var(--border-subtle);
        background: var(--bg-rail);
        display: flex;
        align-items: center;
        justify-content: space-between;
      ">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="
            width: 24px;
            height: 24px;
            border-radius: 6px;
            background: var(--bg-card);
            border: 1px solid var(--border-subtle);
            color: var(--accent);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            font-weight: 700;
          ">
            ${(props.profileName || 'D')[0].toUpperCase()}
          </div>
          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 11.5px; font-weight: 600; color: var(--text-main);">${escapeHtml(props.profileName || 'Default')}</span>
            <span style="font-size: 10px; color: ${props.gatewayOnline ? '#10B981' : '#EF4444'};">
              ● ${props.gatewayOnline ? `在线 ${props.gatewayLatencyMs}ms` : '未连接'}
            </span>
          </div>
        </div>

        <button id="rail-footer-settings-btn" class="icon-btn" title="网关与系统设置" style="
          background: transparent;
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          color: var(--text-secondary);
          width: 26px;
          height: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        ">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
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
    .replace(/'/g, '&#039;');
}
