/**
 * Hermes Aura Noise-Free Minimal Status Bar (v3.5)
 * Fixed 26px height.
 * Purified: Keeps ONLY real connection status indicator (red / yellow / green dot) + latency.
 * No mock HTTP2, no mock session id, no fake right-side metrics.
 */

export interface StatusBarProps {
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  latencyMs: number;
  serverLocation?: string;
  onClickStatus?: () => void;
  onOpenSettings?: () => void;
}

export function renderStatusBar(props: StatusBarProps): string {
  let dotColor = '#EF4444'; // Red for disconnected/error
  let statusText = '未连接';
  let pulseAnimation = '';

  if (props.connectionStatus === 'connected') {
    dotColor = '#10B981'; // Green
    statusText = '已连接';
    pulseAnimation = 'animation: aura-pulse 2.4s infinite cubic-bezier(0.4, 0, 0.6, 1);';
  } else if (props.connectionStatus === 'connecting') {
    dotColor = '#F59E0B'; // Amber
    statusText = '连接中...';
    pulseAnimation = 'animation: aura-pulse 1.2s infinite ease-in-out;';
  }

  const latencyText = props.connectionStatus === 'connected' ? `${props.latencyMs}ms` : '';
  const locationText = props.serverLocation || 'Local';

  return `
    <footer class="aura-status-bar" id="app-status-bar" style="
      height: 28px;
      min-height: 28px;
      background: var(--bg-rail);
      border-top: 1px solid var(--border-subtle);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      user-select: none;
      font-size: 11.5px;
      font-family: var(--font-mono);
      color: var(--text-muted);
      z-index: 50;
    ">
      <!-- Left: OpenChamber Quick Toolbar (Settings, Metrics, Shortcuts, Info) -->
      <div style="display: flex; align-items: center; gap: 12px;">
        <button id="status-bar-settings-btn" class="status-icon-btn" title="系统设置" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; padding: 2px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <button id="status-bar-metrics-btn" class="status-icon-btn" title="延迟与性能指标" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; padding: 2px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
        </button>
        <button id="status-bar-shortcuts-btn" class="status-icon-btn" title="快捷键" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; padding: 2px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/>
          </svg>
        </button>
        <button id="status-bar-info-btn" class="status-icon-btn" title="关于与版本" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; padding: 2px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
        </button>
      </div>

      <!-- Right: Server Ingress Node (OpenChamber Style) -->
      <div id="status-bar-server-node" style="display: flex; align-items: center; gap: 6px; cursor: pointer;" title="点击配置网关服务器">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
          <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
          <line x1="6" y1="6" x2="6.01" y2="6"/>
          <line x1="6" y1="18" x2="6.01" y2="18"/>
        </svg>
        <span style="color: ${props.connectionStatus === 'connected' ? 'var(--text-main)' : 'var(--text-muted)'}; font-weight: 500;">
          ${escapeHtml(locationText)}
        </span>
        <span style="
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: ${dotColor};
          box-shadow: 0 0 5px ${dotColor}88;
          display: inline-block;
          margin-left: 2px;
          ${pulseAnimation}
        "></span>
        ${
          latencyText
            ? `<span style="font-size: 10px; color: var(--text-faint); margin-left: 2px;">${latencyText}</span>`
            : ''
        }
      </div>
    </footer>
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
