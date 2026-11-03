import * as React from 'react';

export interface StatusBarProps {
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  latencyMs: number;
  serverLocation?: string;
  onClickStatus: () => void;
}

export function StatusBar({ connectionStatus, latencyMs, serverLocation = 'Local', onClickStatus }: StatusBarProps): React.ReactElement {
  const connected = connectionStatus === 'connected';
  const connecting = connectionStatus === 'connecting';
  return <footer className="flux-status-bar" id="app-status-bar">
    <button className="status-bar-server-node" id="status-bar-server-node" type="button" onClick={onClickStatus}>
      <span id="status-dot" className="status-dot" data-status={connectionStatus} />
      <span>{connected ? '已连接' : connecting ? '连接中...' : '未连接'}</span>
      <span className="status-location">{serverLocation}</span>
      {connected && <span id="latency" className="status-latency">{latencyMs}ms</span>}
    </button>
  </footer>;
}
