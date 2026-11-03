import * as React from 'react';
import { Minus, Square, X, PanelLeft, Settings2, PanelRight, Sun } from 'lucide-react';
import { t } from '../i18n/index.js';

export interface TitlebarProps {
  platform: 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'web';
  title: string;
  isMaximized: boolean;
  gatewayConnected: boolean;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  onToggleLeftRail: () => void;
  onToggleInspector: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
}

/**
 * 设计意图 (Why)：顶栏只承担窗口控制、全局开关与会话标题；身份切换入口收在左轨专职 Bot 卡片与设置弹窗内。
 * 防范的历史坑 (Pitfall)：顶栏曾同时挂 profile 下拉与状态栏延迟读数，出现三处身份/延迟真值面互相漂移。
 * 约束与规则 (Rules)：本组件不持有任何 profile 状态，也不再渲染第二份网关延迟数字。
 */
export function Titlebar({ platform, title, isMaximized, gatewayConnected, onMinimize, onMaximize, onClose, onToggleLeftRail, onToggleInspector, onOpenSettings, onToggleTheme }: TitlebarProps): React.ReactElement {
  const isWindows = platform === 'windows';
  return <header className="flux-titlebar" data-testid="react-titlebar">
    <div className="titlebar-left">
      {platform === 'macos' && <div className="mac-traffic-lights" aria-label={t('titlebar.windowControls')}>
        <button className="traffic-btn traffic-close" type="button" aria-label={t('titlebar.close')} title={t('titlebar.close')} onClick={onClose} />
        <button className="traffic-btn traffic-min" type="button" aria-label={t('titlebar.minimize')} title={t('titlebar.minimize')} onClick={onMinimize} />
        <button className="traffic-btn traffic-max" type="button" aria-label={t('titlebar.fullscreen')} title={t('titlebar.fullscreen')} onClick={onMaximize} />
      </div>}
      <button id="toggle-left-rail-btn" className="icon-btn" title={t('titlebar.toggleLeftRail')} type="button" onClick={onToggleLeftRail}><PanelLeft size={14} /></button>
    </div>
      <div className="titlebar-center"><span className="session-live-pulse" data-connected={gatewayConnected} /><span className="titlebar-session-title">{title}</span></div>
    <div className="titlebar-right">
      <span className="titlebar-connection-indicator" data-connected={gatewayConnected} title={gatewayConnected ? t('titlebar.online') : t('titlebar.offline')} />
      <button id="titlebar-theme-toggle-btn" className="icon-btn" title={t('titlebar.toggleTheme')} type="button" onClick={onToggleTheme}><Sun size={14} /></button>
      <button id="btn-open-settings" className="icon-btn" title={t('titlebar.settings')} type="button" onClick={onOpenSettings}><Settings2 size={14} /></button>
      <button id="toggle-inspector-btn" className="icon-btn" title={t('titlebar.toggleInspector')} type="button" onClick={onToggleInspector}><PanelRight size={14} /></button>
      {isWindows && <div className="win-caption-controls">
        <button className="win-cap-btn" id="win-min-btn" title={t('titlebar.minimize')} type="button" onClick={onMinimize}><Minus size={12} /></button>
        <button className="win-cap-btn" id="win-max-btn" title={isMaximized ? t('titlebar.restore') : t('titlebar.maximize')} type="button" onClick={onMaximize}><Square size={11} /></button>
        <button className="win-cap-btn win-cap-close" id="win-close-btn" title={t('titlebar.close')} type="button" onClick={onClose}><X size={12} /></button>
      </div>}
    </div>
  </header>;
}
