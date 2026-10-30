/**
 * Hermes Flux Noise-Free Minimal Status Bar (v3.5)
 * Fixed 26px height.
 * Purified: Keeps ONLY real connection status indicator (red / yellow / green dot) + latency.
 * No mock HTTP2, no mock session id, no fake right-side metrics.
 */

import { t } from '../../i18n/index.js';

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
    pulseAnimation = 'animation: flux-pulse 2.4s infinite cubic-bezier(0.4, 0, 0.6, 1);';
  } else if (props.connectionStatus === 'connecting') {
    dotColor = '#F59E0B'; // Amber
    statusText = '连接中...';
    pulseAnimation = 'animation: flux-pulse 1.2s infinite ease-in-out;';
  }

  const latencyText = props.connectionStatus === 'connected' ? `${props.latencyMs}ms` : '';
  const locationText = props.serverLocation || 'Local';

  return `
    <footer class="flux-status-bar" id="app-status-bar" style="
      height: 28px;
      min-height: 28px;
      background: var(--bg-rail);
      border-top: 1px solid var(--border-subtle);
      display: flex;
      align-items: center;
      justify-content: flex-start;
      padding: 0 16px;
      user-select: none;
      font-size: 11.5px;
      font-family: var(--font-mono);
      color: var(--text-muted);
      z-index: 50;
      gap: 16px;
    ">
      <!-- Consolidated Connection & Network Status Group (All on Left) -->
      <div id="status-bar-server-node" style="display: flex; align-items: center; gap: 8px; cursor: pointer;" title="${escapeHtml(t('status.configureGateway'))}">
        <span style="
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: ${dotColor};
          box-shadow: 0 0 6px ${dotColor}aa;
          display: inline-block;
          flex-shrink: 0;
          ${pulseAnimation}
        "></span>
        <span style="font-size: 11px; font-weight: 500; color: ${props.connectionStatus === 'connected' ? 'var(--text-main)' : 'var(--text-muted)'};">${escapeHtml(statusText)}</span>
        
        <span style="display: inline-flex; align-items: center; gap: 4px; padding-left: 6px; border-left: 1px solid var(--border-subtle);">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.75;">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
            <line x1="6" y1="6" x2="6.01" y2="6"/>
            <line x1="6" y1="18" x2="6.01" y2="18"/>
          </svg>
          <span style="font-size: 11px; color: var(--text-secondary); font-weight: 500;">
            ${escapeHtml(locationText)}
          </span>
        </span>

        ${
          latencyText
            ? `<span style="font-size: 11px; font-weight: 600; color: var(--accent); background: rgba(255, 255, 255, 0.05); padding: 1px 5px; border-radius: 4px; border: 1px solid var(--border-subtle);">${latencyText}</span>`
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
