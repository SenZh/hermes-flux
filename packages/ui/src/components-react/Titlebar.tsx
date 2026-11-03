import * as React from 'react';
import { Minus, Square, X, PanelLeft, Settings2, PanelRight, Sun } from 'lucide-react';

export interface TitlebarProps {
  platform: 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'web';
  title: string;
  isMaximized: boolean;
  gatewayConnected: boolean;
  gatewayLatencyMs: number;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  onToggleLeftRail: () => void;
  onOpenSettings: () => void;
  onSwitchProfile: (profileName: string) => void;
  onToggleTheme: () => void;
}

export function Titlebar({ platform, title, isMaximized, gatewayConnected, gatewayLatencyMs, onMinimize, onMaximize, onClose, onToggleLeftRail, onOpenSettings, onToggleTheme }: TitlebarProps): React.ReactElement {
  const isWindows = platform === 'windows';
  return <header className="flux-titlebar" data-testid="react-titlebar">
    <div className="titlebar-left">
      <button id="toggle-left-rail-btn" className="icon-btn" title="切换侧栏" type="button" onClick={onToggleLeftRail}><PanelLeft size={14} /></button>
    </div>
    <div className="titlebar-center"><span className="session-live-pulse" data-connected={gatewayConnected} /><span className="titlebar-session-title">{title}</span></div>
    <div className="titlebar-right">
      <span className="titlebar-latency-pill">{gatewayLatencyMs ? `${gatewayLatencyMs}ms` : gatewayConnected ? '在线' : '离线'}</span>
      <button id="titlebar-theme-toggle-btn" className="icon-btn" title="切换主题" type="button" onClick={onToggleTheme}><Sun size={14} /></button>
      <button id="btn-open-settings" className="icon-btn" title="设置" type="button" onClick={onOpenSettings}><Settings2 size={14} /></button>
      <button id="toggle-inspector-btn" className="icon-btn" title="检查舱" type="button"><PanelRight size={14} /></button>
      {isWindows && <div className="win-caption-controls">
        <button className="win-cap-btn" id="win-min-btn" title="最小化" type="button" onClick={onMinimize}><Minus size={12} /></button>
        <button className="win-cap-btn" id="win-max-btn" title={isMaximized ? '向下还原' : '最大化'} type="button" onClick={onMaximize}><Square size={11} /></button>
        <button className="win-cap-btn win-cap-close" id="win-close-btn" title="关闭" type="button" onClick={onClose}><X size={12} /></button>
      </div>}
    </div>
  </header>;
}
