/**
 * Hermes Flux Left Rail Component (v4.0 Production)
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
  profiles?: Array<{ name: string; displayName: string; avatar?: string; isDefault?: boolean }>;
  gatewayOnline: boolean;
  gatewayLatencyMs: number;
  /** Why the session list could not be loaded — an empty rail is not a failure. */
  error?: string;
  onNewChat?: () => void;
  onSelectSession?: (id: string) => void;
  onDeleteSession?: (id: string) => void;
  onOpenSettings?: () => void;
  onSwitchProfile?: (profileName: string) => void;
}

export function renderLeftRail(props: LeftRailProps): string {
  if (props.collapsed) {
    return `<aside id="flux-left-rail" class="rail-collapsed" style="width: 0px; min-width: 0px; display: none; overflow: hidden;"></aside>`;
  }

  const activeSessions = props.sessions.filter((s) => !s.isArchived);
  const archivedSessions = props.sessions.filter((s) => s.isArchived);
  const railError = (props.error || '').trim();

  return `
    <aside id="flux-left-rail" class="flux-left-rail" style="
      flex: 0 0 var(--rail-w-left, 260px);
      width: var(--rail-w-left, 260px);
      min-width: var(--rail-w-left, 260px);
      max-width: var(--rail-w-left, 260px);
      height: 100%;
      background: var(--bg-rail);
      border-right: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      user-select: none;
      transition: width 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      position: relative;
    ">
      <!-- Draggable Resize Handle (Left Rail Right Edge) -->
      <div class="rail-resize-handle" data-rail-handle="left" role="separator" aria-orientation="vertical" tabindex="0" title="拖拽调整左侧栏宽度 · 双击复位" style="
        position: absolute;
        right: -3px;
        top: 0;
        bottom: 0;
        width: 6px;
        z-index: 60;
        cursor: col-resize;
        background: transparent;
      "></div>
      <!-- New Chat Button & Search -->
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
          <div style="font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; padding: 6px 8px 4px;">对话列表 (${props.sessions.length})</div>
          
          <div style="display: flex; flex-direction: column; gap: 4px;">
            ${activeSessions
              .map((s) => {
                const isActive = s.id === props.activeSessionId;
                return `
                <div class="session-item ${isActive ? 'active' : ''}" data-id="${s.id}" data-title="${escapeHtml(s.title)}" style="
                  min-height: 38px;
                  height: 38px;
                  padding: 0 10px;
                  border-radius: 8px;
                  background: ${isActive ? 'var(--bg-card-active)' : 'transparent'};
                  border: 1px solid ${isActive ? 'var(--border-medium)' : 'transparent'};
                  cursor: pointer;
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  gap: 8px;
                  position: relative;
                  transition: background 0.12s ease, border-color 0.12s ease;
                ">
                  ${isActive ? '<div class="active-indicator" style="position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; background: var(--accent); border-radius: 0 2px 2px 0;"></div>' : ''}
                  
                  <span style="
                    font-size: 13px;
                    line-height: 20px;
                    font-weight: ${isActive ? '600' : '400'};
                    color: ${isActive ? 'var(--text-main)' : 'var(--text-secondary)'};
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    flex: 1;
                    padding-left: ${isActive ? '4px' : '0'};
                  ">${escapeHtml(s.title)}</span>

                  <span style="font-size: 10.5px; color: var(--text-faint); font-family: var(--font-mono); flex-shrink: 0;">${escapeHtml(s.time || '')}</span>
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
                    min-height: 38px;
                    height: 38px;
                    padding: 0 10px;
                    border-radius: 8px;
                    background: ${isActive ? 'var(--bg-card-active)' : 'transparent'};
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    opacity: 0.7;
                  ">
                    <span style="font-size: 13px; line-height: 20px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(s.title)}</span>
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

      <!-- Rail Bottom Spacer -->
      <div style="flex-shrink: 0; height: 10px;"></div>
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
