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
      <!-- Left: Clean and Minimal Brand Indicator -->
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 11px; color: var(--text-muted); opacity: 0.65;">HERMES AURA</span>
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
