import * as React from 'react';
import { t } from '../i18n/index.js';
import { renderBotAvatar, renderGroupCollageAvatar } from '../utils/botAvatar.js';
import {
  CloseGlyph,
  MaximizeGlyph,
  MinimizeGlyph,
  PanelLeftGlyph,
  PanelRightGlyph,
  RestoreGlyph,
  SettingsGlyph,
} from '../icons/titlebarGlyphs.js';

export interface TitlebarProps {
  platform: 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'web';
  title: string;
  isMaximized: boolean;
  gatewayConnected: boolean;
  /** 左栏折叠态：驱动顶栏左段宽度与折叠按钮呈现（快照单一供给，不读 DOM 属性）。 */
  leftRailCollapsed: boolean;
  /** 检查舱折叠态：驱动标题居中基准（折叠时右舱不占位，标题不得再减 420px）。 */
  inspectorCollapsed: boolean;
  /** 处于专职智能体工位或群聊工位时，顶栏呈现真实头像或拼图微头像。 */
  activeAvatar?: 
    | { kind: 'bot'; avatar?: string; name: string }
    | { kind: 'group'; members: string[]; profiles: Array<{ name: string; avatar?: string; displayName?: string }> };
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  onToggleLeftRail: () => void;
  onToggleInspector: () => void;
  onOpenSettings: () => void;
}

/**
 * 设计意图 (Why)：顶栏只承担窗口控制、全局开关与会话标题；身份切换入口收在左轨专职 Bot 卡片与设置弹窗内。
 * 防范的历史坑 (Pitfall)：
 *   1. 顶栏曾同时挂 profile 下拉与状态栏延迟读数，出现三处身份/延迟真值面互相漂移；
 *   2. macOS 交通灯曾由主进程与本组件各画一套，屏幕上出现 6 个圆点错位重叠（现统一保留系统原生三键）。
 * 约束与规则 (Rules)：
 *   1. 本组件不持有任何 profile 状态，标题与头像由快照单一供给；
 *   2. 顶栏读数只保留连接指示点，网关延迟数字已由用户裁决移除（2026-11-20），禁止再加回文字读数；
 *   3. 深浅色切换按钮已拔除——主题唯一入口收敛到设置中心，顶栏不再跑第二条换肤真值面；
 *   4. 左簇图标（☰ / 设置）与右簇图标（检查舱 / 窗控三键）共用同一 28px 热区与同一字形网格，
 *      保证顶栏内所有元素共享一条垂直中线。
 */
export function Titlebar({ platform, title, isMaximized, gatewayConnected, leftRailCollapsed, inspectorCollapsed, activeAvatar, onMinimize, onMaximize, onClose, onToggleLeftRail, onToggleInspector, onOpenSettings }: TitlebarProps): React.ReactElement {
  const isWindows = platform === 'windows';
  return <header className="flux-titlebar" data-testid="react-titlebar" data-left-rail-collapsed={leftRailCollapsed ? 'true' : 'false'} data-inspector-collapsed={inspectorCollapsed === false ? 'false' : 'true'}>
    <div className="titlebar-left">
      {/* macOS 交通灯由系统原生绘制（titleBarStyle: 'hiddenInset'），此处严禁再画一套。
          历史上系统三键与本组件自绘的三键同时存在，屏幕上出现 6 个圆点错位重叠。 */}
      <button id="toggle-left-rail-btn" className="icon-btn" title={t('titlebar.toggleLeftRail')} type="button" onClick={onToggleLeftRail}><PanelLeftGlyph /></button>
      <button id="btn-open-settings" className="icon-btn" title={t('titlebar.settings')} type="button" onClick={onOpenSettings}><SettingsGlyph /></button>
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
      <div className="titlebar-connection-box flex items-center px-1" title={gatewayConnected ? t('titlebar.online') : t('titlebar.offline')}>
        <span className="titlebar-connection-indicator" data-connected={gatewayConnected} />
      </div>
      <button id="toggle-inspector-btn" className="icon-btn" title={t('titlebar.toggleInspector')} type="button" onClick={onToggleInspector}><PanelRightGlyph /></button>
      {isWindows && <div className="win-caption-controls">
        <button className="win-cap-btn" id="win-min-btn" title={t('titlebar.minimize')} type="button" onClick={onMinimize}><MinimizeGlyph /></button>
        <button className="win-cap-btn" id="win-max-btn" title={isMaximized ? t('titlebar.restore') : t('titlebar.maximize')} type="button" onClick={onMaximize}>{isMaximized ? <RestoreGlyph /> : <MaximizeGlyph />}</button>
        <button className="win-cap-btn win-cap-close" id="win-close-btn" title={t('titlebar.close')} type="button" onClick={onClose}><CloseGlyph /></button>
      </div>}
    </div>
  </header>;
}
