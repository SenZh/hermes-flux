import * as React from 'react';
import { Minus, Square, X, PanelLeft, Settings2, PanelRight, Sun } from 'lucide-react';
import { t } from '../i18n/index.js';
import { renderBotAvatar, renderGroupCollageAvatar } from '../utils/botAvatar.js';

export interface TitlebarProps {
  platform: 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'web';
  title: string;
  isMaximized: boolean;
  gatewayConnected: boolean;
  /** 左栏折叠态：驱动顶栏左段宽度与折叠按钮呈现（快照单一供给，不读 DOM 属性）。 */
  leftRailCollapsed: boolean;
  /** 检查舱折叠态：驱动标题居中基准（折叠时右舱不占位，标题不得再减 420px）。 */
  inspectorCollapsed: boolean;
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
 *   2026-11-20：macOS 交通灯曾由主进程（titleBarStyle:'hiddenInset'）与本组件各画一套，
 *   屏幕上出现 6 个圆点错位重叠；现统一保留系统原生三键，本组件不再自绘。
 * 约束与规则 (Rules)：本组件不持有任何 profile 状态，标题与头像由快照单一供给；
 *   macOS 严禁渲染 .mac-traffic-lights，交通灯一律由系统绘制。
 */
export function Titlebar({ platform, title, isMaximized, gatewayConnected, leftRailCollapsed, inspectorCollapsed, latencyMs, activeAvatar, onMinimize, onMaximize, onClose, onToggleLeftRail, onToggleInspector, onOpenSettings, onToggleTheme }: TitlebarProps): React.ReactElement {
  const isWindows = platform === 'windows';
  const showLatency = gatewayConnected && typeof latencyMs === 'number' && latencyMs >= 0;
  return <header className="flux-titlebar" data-testid="react-titlebar" data-left-rail-collapsed={leftRailCollapsed ? 'true' : 'false'} data-inspector-collapsed={inspectorCollapsed === false ? 'false' : 'true'}>
    <div className="titlebar-left">
      {/* macOS 交通灯由系统原生绘制（titleBarStyle: 'hiddenInset'），此处严禁再画一套。
          历史上系统三键与本组件自绘的三键同时存在，屏幕上出现 6 个圆点错位重叠。 */}
      <button id="toggle-left-rail-btn" className="icon-btn" title={t('titlebar.toggleLeftRail')} type="button" onClick={onToggleLeftRail}><PanelLeft size={14} /></button>
    </div>
    <div className="titlebar-center">
      {activeAvatar?.kind === 'bot' && <span
        className="titlebar-bot-avatar inline-flex shrink-0 items-center justify-center overflow-hidden rounded-inner"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: renderBotAvatar(activeAvatar.name, activeAvatar.name, activeAvatar.avatar, 16) }}
      />}
      {activeAvatar?.kind === 'group' && <span
        className="titlebar-group-avatar inline-flex shrink-0 items-center justify-center overflow-hidden rounded-inner"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: renderGroupCollageAvatar(activeAvatar.members, activeAvatar.profiles, 16) }}
      />}
      <span className="titlebar-session-title">{title}</span>
    </div>
    <div className="titlebar-right">
      <div className="titlebar-connection-box flex items-center gap-1 px-1" title={gatewayConnected ? (showLatency ? `${t('titlebar.online')} (${latencyMs}ms)` : t('titlebar.online')) : t('titlebar.offline')}>
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
