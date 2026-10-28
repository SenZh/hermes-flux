/**
 * Hermes Aura Noise-Free Minimal Status Bar (v3.5)
 * Fixed 26px height.
 * Purified: Keeps ONLY real connection status indicator (red / yellow / green dot) + latency.
 * No mock HTTP2, no mock session id, no fake right-side metrics.
 */

export interface StatusBarProps {
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  latencyMs: number;
  onClickStatus?: () => void;
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

  return `
    <footer class="aura-status-bar" id="app-status-bar" style="
      height: 22px;
      min-height: 22px;
      background: var(--bg-rail);
      border-top: 1px solid var(--border-subtle);
      display: flex;
      align-items: center;
      justify-content: flex-start;
      padding: 0 14px;
      user-select: none;
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-muted);
      z-index: 50;
      cursor: pointer;
    " title="点击打开网关连接配置">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: ${dotColor};
          box-shadow: 0 0 6px ${dotColor}88;
          display: inline-block;
          ${pulseAnimation}
        "></span>
        <span style="color: ${props.connectionStatus === 'connected' ? 'var(--text-secondary)' : dotColor}; font-weight: 500;">
          ${statusText}
        </span>
        ${
          latencyText
            ? `
          <span style="color: var(--border-medium);">/</span>
          <span style="color: var(--text-muted);">${latencyText}</span>
        `
            : ''
        }
      </div>
    </footer>
  `;
}
