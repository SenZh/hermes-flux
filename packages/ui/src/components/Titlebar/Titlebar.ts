/**
 * Hermes Flux Purified Titlebar Component (v3.5)
 * Purified of clutter:
 * - Only window controls, sidebar collapse button, session title, settings gear icon, inspector toggle.
 * - Language and theme toggles moved inside Settings Modal.
 */

export interface TitlebarProps {
  platform: 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'web';
  title: string;
  isMaximized: boolean;
  gatewayConnected: boolean;
  profileName?: string;
  profiles?: Array<{ name: string; displayName: string; avatar?: string; isDefault?: boolean }>;
  onToggleLeftRail?: () => void;
  onToggleInspector?: () => void;
  onOpenSettings?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  onClose?: () => void;
  onSwitchProfile?: (profileName: string) => void;
}

export function renderTitlebar(props: TitlebarProps): string {
  const isWin = props.platform === 'windows';
  const isMac = props.platform === 'macos';
  const isMobile = props.platform === 'ios' || props.platform === 'android';
  const isWeb = props.platform === 'web';

  const macControls = `
    <div class="mac-traffic-lights" style="-webkit-app-region: no-drag; display: flex; gap: 7px; align-items: center; padding-left: 12px;">
      <span class="traffic-btn traffic-close" title="关闭" style="width: 12px; height: 12px; border-radius: 50%; background: #FF5F56; display: inline-block; cursor: pointer;"></span>
      <span class="traffic-btn traffic-min" title="最小化" style="width: 12px; height: 12px; border-radius: 50%; background: #FFBD2E; display: inline-block; cursor: pointer;"></span>
      <span class="traffic-btn traffic-max" title="全屏" style="width: 12px; height: 12px; border-radius: 50%; background: #27C93F; display: inline-block; cursor: pointer;"></span>
    </div>
  `;

  const winControls = `
    <div class="win-caption-controls" style="-webkit-app-region: no-drag; display: flex; align-items: center; height: 100%;">
      <button class="win-cap-btn" id="win-min-btn" title="最小化" style="width: 46px; height: 100%; border: none; background: transparent; color: var(--text-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.1s ease;">
        <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" stroke-width="1"/></svg>
      </button>
      <button class="win-cap-btn" id="win-max-btn" title="${props.isMaximized ? '向下还原' : '最大化'}" style="width: 46px; height: 100%; border: none; background: transparent; color: var(--text-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.1s ease;">
        ${
          props.isMaximized
            ? `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M2.5 2.5V0.5H9.5V7.5H7.5" />
                <rect x="0.5" y="2.5" width="7" height="7" />
              </svg>`
            : `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1">
                <rect x="0.5" y="0.5" width="9" height="9" />
              </svg>`
        }
      </button>
      <button class="win-cap-btn win-cap-close" id="win-close-btn" title="关闭" style="width: 46px; height: 100%; border: none; background: transparent; color: var(--text-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.1s ease, color 0.1s ease;">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1"><path d="M1 1L9 9M9 1L1 9"/></svg>
      </button>
    </div>
  `;

  const pulseColor = props.gatewayConnected ? '#10B981' : '#64748B';
  const pulseGlow = props.gatewayConnected ? 'rgba(16, 185, 129, 0.45)' : 'none';
  const displayTitle = props.title || (props.gatewayConnected ? 'Hermes Flux — 请选择或新建会话' : '未连接网关');

  return `
    <header class="flux-titlebar" style="
      height: calc(42px + env(safe-area-inset-top, 0px));
      min-height: 42px;
      padding-top: env(safe-area-inset-top, 0px);
      padding-left: env(safe-area-inset-left, 0px);
      padding-right: env(safe-area-inset-right, 0px);
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg-rail);
      user-select: none;
      -webkit-app-region: ${isMobile || isWeb ? 'no-drag' : 'drag'};
      position: relative;
      z-index: 50;
    ">
      <!-- Left Wing: Agent Profiles Align Left & Collapser -->
      <div class="titlebar-left" style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
        ${isMac ? macControls : ''}
        <button id="toggle-left-rail-btn" class="icon-btn" title="折叠/展开侧栏 (Ctrl+B)" style="
          -webkit-app-region: no-drag;
          margin-left: ${isWin ? '12px' : '6px'};
          background: transparent;
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          color: var(--text-secondary);
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
        ">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="2" width="12" height="12" rx="2"/>
            <line x1="6" y1="2" x2="6" y2="14"/>
          </svg>
        </button>

        <!-- Agent Profiles Switcher Pills Aligned Left -->
        ${
          props.profiles && props.profiles.length > 0
            ? `
          <div class="titlebar-agent-chips" style="-webkit-app-region: no-drag; display: flex; align-items: center; gap: 6px; background: var(--bg-card); padding: 3px 6px; border-radius: 20px; border: 1px solid var(--border-subtle); overflow-x: auto;">
            ${props.profiles
              .map((p) => {
                const isSelected = (props.profileName || 'default') === p.name;
                const avatarImg = p.avatar
                  ? `<img src="${escapeHtml(p.avatar)}" style="width: 18px; height: 18px; border-radius: 50%; object-fit: cover;" />`
                  : `<span style="
                      width: 18px;
                      height: 18px;
                      border-radius: 50%;
                      background: ${isSelected ? 'var(--accent)' : 'var(--border-medium)'};
                      color: ${isSelected ? '#000' : 'var(--text-main)'};
                      font-size: 10px;
                      font-weight: 700;
                      display: inline-flex;
                      align-items: center;
                      justify-content: center;
                    ">${(p.displayName || p.name || 'A')[0].toUpperCase()}</span>`;

                return `
                <button type="button" class="btn-profile-chip ${isSelected ? 'active' : ''}" data-profile="${escapeHtml(p.name)}" style="
                  height: 26px;
                  padding: 0 10px 0 4px;
                  border-radius: 13px;
                  background: ${isSelected ? 'var(--accent-subtle)' : 'transparent'};
                  border: 1px solid ${isSelected ? 'var(--accent)' : 'transparent'};
                  color: ${isSelected ? 'var(--accent)' : 'var(--text-secondary)'};
                  font-size: 11.5px;
                  font-weight: ${isSelected ? '600' : '400'};
                  display: flex;
                  align-items: center;
                  gap: 6px;
                  cursor: pointer;
                  white-space: nowrap;
                  transition: all 0.15s ease;
                " title="${escapeHtml(p.displayName || p.name)}">
                  ${avatarImg}
                  <span>${escapeHtml(p.displayName || p.name)}</span>
                </button>
              `;
              })
              .join('')}
          </div>
        `
            : ''
        }
      </div>

      <!-- Center Title -->
      <div class="titlebar-center" style="display: flex; align-items: center; justify-content: center; gap: 8px; flex-shrink: 0;">
        <span class="session-live-pulse" title="${props.gatewayConnected ? '网关已连接' : '网关未连接'}" style="
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: ${pulseColor};
          box-shadow: 0 0 8px ${pulseGlow};
          display: inline-block;
          flex-shrink: 0;
          ${props.gatewayConnected ? 'animation: flux-pulse 2.4s infinite cubic-bezier(0.4, 0, 0.6, 1);' : ''}
        "></span>
        <span class="session-title-text" style="
          font-size: 13px;
          font-weight: 500;
          color: var(--text-main);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 300px;
        ">${escapeHtml(displayTitle)}</span>
      </div>

      <!-- Right Global Auxiliary Area (250px) -->
      <div class="titlebar-right" style="display: flex; align-items: center; justify-content: flex-end; ${isMobile ? 'width: auto; min-width: 0;' : 'width: 250px; min-width: 250px;'} gap: 8px; height: 100%;">
        <div style="-webkit-app-region: no-drag; display: flex; align-items: center; gap: 6px; margin-right: 8px;">
          <!-- Settings gear icon button -->
          <button id="btn-open-settings" class="icon-btn" title="网关与系统设置" style="
            background: transparent;
            border: 1px solid var(--border-subtle);
            border-radius: 6px;
            color: var(--text-secondary);
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: color 0.15s ease, background 0.15s ease;
          ">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>

          <!-- Inspector toggle -->
          <button id="toggle-inspector-btn" class="icon-btn" title="检查舱 (Cmd/Ctrl+\\)" style="
            background: transparent;
            border: 1px solid var(--border-subtle);
            border-radius: 6px;
            color: var(--text-secondary);
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
          ">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="2" y="2" width="12" height="12" rx="2"/>
              <line x1="10" y1="2" x2="10" y2="14"/>
            </svg>
          </button>
        </div>

        ${isWin ? winControls : ''}
      </div>
    </header>
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
