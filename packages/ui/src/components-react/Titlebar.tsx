import * as React from 'react';
import { Minus, Square, X, PanelLeft, Settings2, PanelRight, Sun } from 'lucide-react';
import { t } from '../i18n/index.js';
import { renderBotAvatar, renderGroupCollageAvatar } from '../utils/botAvatar.js';

export interface TitlebarProps {
  platform: 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'web';
  title: string;
  isMaximized: boolean;
  gatewayConnected: boolean;
  /** PR-3e：状态底栏拔除后，网关延迟低调移入顶栏右上角（不抢眼、仅作为指示）。 */
  latencyMs?: number;
  /** PR-3e：处于专职智能体工位或群聊工位时，顶栏呈现真实头像或拼图微头像。 */
  activeAvatar?: 
    | { kind: 'bot'; avatar?: string; name: string }
    | { kind: 'group'; members: string[]; profiles: Array<{ name: string; avatar?: string; displayName?: string }> };
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
 *   PR-3e 收敛：底栏删除后，顶栏右上角只以淡雅单色数字展示延迟，中轴呈现专职智能体真实头像。
 * 约束与规则 (Rules)：本组件不持有任何 profile 状态，标题与头像由快照单一供给。
 */
export function Titlebar({ platform, title, isMaximized, gatewayConnected, latencyMs, activeAvatar, onMinimize, onMaximize, onClose, onToggleLeftRail, onToggleInspector, onOpenSettings, onToggleTheme }: TitlebarProps): React.ReactElement {
  const isWindows = platform === 'windows';
  const showLatency = gatewayConnected && typeof latencyMs === 'number' && latencyMs >= 0;
  return <header className="flux-titlebar" data-testid="react-titlebar">
    <div className="titlebar-left">
      {platform === 'macos' && <div className="mac-traffic-lights" aria-label={t('titlebar.windowControls')}>
        <button className="traffic-btn traffic-close" type="button" aria-label={t('titlebar.close')} title={t('titlebar.close')} onClick={onClose} />
        <button className="traffic-btn traffic-min" type="button" aria-label={t('titlebar.minimize')} title={t('titlebar.minimize')} onClick={onMinimize} />
        <button className="traffic-btn traffic-max" type="button" aria-label={t('titlebar.fullscreen')} title={t('titlebar.fullscreen')} onClick={onMaximize} />
      </div>}
      <button id="toggle-left-rail-btn" className="icon-btn" title={t('titlebar.toggleLeftRail')} type="button" onClick={onToggleLeftRail}><PanelLeft size={14} /></button>
    </div>
    <div className="titlebar-center">
      {activeAvatar?.kind === 'bot' && <span
        className="titlebar-bot-avatar mr-1.5 inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: renderBotAvatar(activeAvatar.name, activeAvatar.name, activeAvatar.avatar, 16) }}
      />}
      {activeAvatar?.kind === 'group' && <span
        className="titlebar-group-avatar mr-1.5 inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: renderGroupCollageAvatar(activeAvatar.members, activeAvatar.profiles, 16) }}
      />}
      <span className="titlebar-session-title">{title}</span>
    </div>
    <div className="titlebar-right">
      <div className="titlebar-connection-box flex items-center gap-1.5 px-1" title={gatewayConnected ? (showLatency ? `${t('titlebar.online')} (${latencyMs}ms)` : t('titlebar.online')) : t('titlebar.offline')}>
        <span className="titlebar-connection-indicator" data-connected={gatewayConnected} />
        {showLatency && <span className="titlebar-latency text-caption text-muted-foreground/60 font-code tabular-nums select-none tracking-tight">{latencyMs}ms</span>}
      </div>
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
