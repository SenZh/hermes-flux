/**
 * Hermes Flux Left Rail Component (v7.0 Production - Pure Dual-Rail Architecture)
 *
 * 【终极架构设计 (True Dual-Rail & Context-Isolated Architecture)】
 * 1. 物理微轨 (Agents Station Rail): 固定 52px 宽度，永远常驻不可折叠！
 *    - 顶部 Default 助理，中间通过 station-agents-scroll 容器独立垂直滚动（支持无限个 Agent）；
 *    - 100% 消费并优先展示 Gateway 返回的真实自定义头像（img src=${avatar}），无 avatar 时安全回退；
 *    - 完整支持三态指示（running 脉冲 / unread 绿点 / read 纯净）；
 * 2. 动态抽屉 (Context Drawer): 212px 宽度，支持 Ctrl+B 或顶栏折叠（折叠后宽度 0px，不影响微轨）；
 *    - 彻底删除【智能体(N)】折叠行！不搞双重入口精神分裂；
 *    - 抽屉第 1 行展示当前选中的 Agent 核心大卡片（消费 Gateway 真实自定义头像、名称、最新摘要、时间、三态微标）；
 *    - 【严格数据隔离】：只展示当前选中的这个 Agent 专属的会话与专属群聊，绝不混入全局 86 条杂乱会话！
 */

import { t } from '../../i18n/index.js';

/**
 * 格式化最新一条记录的副标题摘要：
 * 1. 过滤 Markdown 代码块与标题符；
 * 2. 压缩连续换行与空白；
 * 3. 截断到指定字数（默认 36 字）并附加省略号。
 */
export function formatMessageSnippet(text?: string, maxLen = 36): string {
  if (!text) return '';
  const cleaned = text
    .replace(/```[\s\S]*?```/g, t('common.codeBlock'))
    .replace(/^#+\s+/gm, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen) + '...';
}

export interface LeftRailSession {
  id: string;
  title: string;
  model?: string;
  time?: string;
  preview?: string;
  isArchived?: boolean;
  isPinned?: boolean;
  botName?: string;
  botDisplayName?: string;
  botAvatar?: string;
  projectId?: string;
  projectName?: string;
  timestamp?: number;
  parentSessionId?: string;
  source?: string;
  isSubagent?: boolean;
  /** 执行与阅读三态: 'running' 正在回答 | 'unread' 已回答未读 | 'read' 已读 */
  activityState?: 'running' | 'unread' | 'read';
}

export interface LeftRailGroupRoom {
  roomId: string;
  name: string;
  members: string[];
  createdAt?: number;
  updatedAt?: number;
  lastMessage?: string;
  /** 执行与阅读三态: 'running' 正在回答 | 'unread' 已回答未读 | 'read' 已读 */
  activityState?: 'running' | 'unread' | 'read';
}

export interface LeftRailProject {
  id: string;
  name: string;
  path?: string;
  sessions?: LeftRailSession[];
}

export type LeftRailActiveFocus =
  | { type: 'bot'; botName: string }
  | { type: 'session'; sessionId: string }
  | { type: 'group'; roomId: string };

export interface LeftRailProps {
  collapsed: boolean;
  activeSessionId: string;
  activeFocus?: LeftRailActiveFocus;
  sessions: LeftRailSession[];
  profileName: string;
  profiles?: Array<{
    name: string;
    displayName: string;
    avatar?: string;
    model?: string;
    description?: string;
    lastMessage?: string;
    lastTime?: string;
    timestamp?: number;
    isDefault?: boolean;
    activityState?: 'running' | 'unread' | 'read';
  }>;
  groups?: LeftRailGroupRoom[];
  projects?: LeftRailProject[];
  activeRailTab?: 'chats' | 'projects' | 'groups';
  gatewayOnline: boolean;
  gatewayLatencyMs: number;
  searchQuery?: string;
  isBotsGroupExpanded?: boolean;
  isSessionsGroupExpanded?: boolean;
  isGroupsGroupExpanded?: boolean;
  isMoreSessionsExpanded?: boolean;
  editingGroupRoomId?: string;
  error?: string;
}

export function renderLeftRail(props: LeftRailProps): string {
  const query = (props.searchQuery || '').toLowerCase().trim();
  const railError = (props.error || '').trim();
  const isProjectsTab = props.activeRailTab === 'projects';
  const realProjects = props.projects || [];
  const realGroups = props.groups || [];

  // 1. 全部 Profiles 与排序
  const allProfiles = props.profiles ? [...props.profiles] : [];
  const filteredProfiles = (query
    ? allProfiles.filter(
        (p) =>
          (p.displayName || p.name).toLowerCase().includes(query) ||
          (p.description || '').toLowerCase().includes(query) ||
          (p.lastMessage || '').toLowerCase().includes(query)
      )
    : allProfiles
  ).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  // 2. 当前互斥焦点解析与当前选中的 Agent 实体判定
  const currentFocus: LeftRailActiveFocus = props.activeFocus || (
    props.activeSessionId
      ? { type: 'session', sessionId: props.activeSessionId }
      : { type: 'bot', botName: props.profileName || 'default' }
  );

  const currentActiveSession = props.sessions.find((s) => s.id === props.activeSessionId);
  const currentAgentName =
    currentFocus.type === 'bot'
      ? currentFocus.botName
      : currentFocus.type === 'session'
      ? (currentActiveSession?.botName || props.profileName || 'default')
      : (props.profileName || 'default');

  const selectedAgentProfile =
    allProfiles.find((p) => p.name.toLowerCase() === currentAgentName.toLowerCase()) ||
    allProfiles.find((p) => p.isDefault) || {
      name: currentAgentName,
      displayName: currentAgentName === 'default' ? t('rail.defaultAssistant') : currentAgentName,
      avatar: '',
      lastMessage: '',
      lastTime: '',
      activityState: 'read' as const,
    };

  const isDefaultHQ = selectedAgentProfile.name.toLowerCase() === 'default';

  // 3. 【核心上下文隔离】抽屉严格只呈现属于当前选中 Agent 的会话与群聊！
  // 会话隔离：Default HQ 显示通用/default会话，专职 Agent 只显示自身名下的会话
  const rawActiveSessions = props.sessions.filter((s) => !s.isArchived);
  const rawArchivedSessions = props.sessions.filter((s) => s.isArchived);

  const agentScopedActiveSessions = rawActiveSessions.filter((s) => {
    const bName = (s.botName || 'default').toLowerCase();
    const bDisplay = (s.botDisplayName || '').toLowerCase();
    const targetName = selectedAgentProfile.name.toLowerCase();
    const targetDisplay = (selectedAgentProfile.displayName || '').toLowerCase();
    if (isDefaultHQ) {
      return bName === 'default' || !s.botName;
    }
    return bName === targetName || (targetDisplay && bDisplay === targetDisplay);
  });

  const agentScopedArchivedSessions = rawArchivedSessions.filter((s) => {
    const bName = (s.botName || 'default').toLowerCase();
    const bDisplay = (s.botDisplayName || '').toLowerCase();
    const targetName = selectedAgentProfile.name.toLowerCase();
    const targetDisplay = (selectedAgentProfile.displayName || '').toLowerCase();
    if (isDefaultHQ) {
      return bName === 'default' || !s.botName;
    }
    return bName === targetName || (targetDisplay && bDisplay === targetDisplay);
  });

  // 搜索过滤与时间倒序
  const activeSessions = (query
    ? agentScopedActiveSessions.filter((s) => {
        const titleMatch = s.title.toLowerCase().includes(query);
        const prevMatch = (s.preview || '').toLowerCase().includes(query);
        return titleMatch || prevMatch;
      })
    : [...agentScopedActiveSessions]
  ).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const archivedSessions = (query
    ? agentScopedArchivedSessions.filter((s) => s.title.toLowerCase().includes(query))
    : [...agentScopedArchivedSessions]
  ).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  // 群聊隔离：Default 中枢展示全部群聊（作为主大厅），专职 Agent 严格只展示自身参与的群聊
  const agentScopedGroups = isDefaultHQ
    ? realGroups
    : realGroups.filter((g) => {
        const membersLower = (g.members || []).map((m) => m.toLowerCase());
        return (
          membersLower.includes(selectedAgentProfile.name.toLowerCase()) ||
          (selectedAgentProfile.displayName && membersLower.includes(selectedAgentProfile.displayName.toLowerCase()))
        );
      });

  const filteredGroups = (query
    ? agentScopedGroups.filter((g) => g.name.toLowerCase().includes(query) || (g.lastMessage || '').toLowerCase().includes(query))
    : [...agentScopedGroups]
  ).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

  const isSessionsOpen = props.isSessionsGroupExpanded !== false;
  const isGroupsOpen = props.isGroupsGroupExpanded !== false;

  // 微轨 Agent 列表（排除 default 主助理，作为微轨中间平滑滚动项）
  const otherAgents = filteredProfiles.filter((p) => !p.isDefault && p.name.toLowerCase() !== 'default');
  const defaultProfile = allProfiles.find((p) => p.isDefault || p.name.toLowerCase() === 'default') || {
    name: 'default',
    displayName: t('rail.defaultAssistant'),
    avatar: '',
    activityState: 'read' as const,
  };

  const hasActiveGroup = filteredGroups.some((g) => g.activityState === 'running');
  const hasUnreadGroup = filteredGroups.some((g) => g.activityState === 'unread');

  return `
    <aside id="flux-left-rail" class="flux-left-rail ${props.collapsed ? 'rail-collapsed' : ''}" style="
      flex: 0 0 ${props.collapsed ? '52px' : 'var(--rail-w-left, 264px)'};
      width: ${props.collapsed ? '52px' : 'var(--rail-w-left, 264px)'};
      min-width: ${props.collapsed ? '52px' : 'var(--rail-w-left, 264px)'};
      max-width: ${props.collapsed ? '52px' : 'var(--rail-w-left, 264px)'};
      height: 100%;
      background: var(--bg-rail);
      border-right: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: row;
      position: relative;
      user-select: none;
      -webkit-user-select: none;
    ">
      <!-- 1. 物理微轨 (Agents Station Rail): 固定 52px，永远常驻不可折叠！ -->
      <div id="flux-station-rail" class="flux-station-rail" style="
        width: 52px;
        min-width: 52px;
        max-width: 52px;
        height: 100%;
        background: var(--bg-card);
        border-right: 1px solid var(--border-subtle);
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 8px 0;
        gap: 8px;
        flex-shrink: 0;
        z-index: 20;
      ">
        <!-- 顶部固定位：Default 主中枢助理 (100% 消费 Gateway 真实自定义头像) -->
        <div class="station-sticky-top" style="display: flex; flex-direction: column; align-items: center; width: 100%; padding-bottom: 6px; border-bottom: 1px solid var(--border-subtle);">
          <div class="station-agent-badge rail-pinned-bot-row ${currentAgentName.toLowerCase() === 'default' ? 'active' : ''}" data-station-profile="default" data-profile="default" title="${t('rail.enterBotChat', { name: defaultProfile.displayName || 'Default' })}" style="
            width: 36px;
            height: 36px;
            border-radius: 10px;
            background: ${currentAgentName.toLowerCase() === 'default' ? 'var(--accent-subtle)' : 'var(--bg-card)'};
            border: 1.5px solid ${currentAgentName.toLowerCase() === 'default' ? 'var(--accent)' : 'var(--border-subtle)'};
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            position: relative;
            transition: all 0.15s ease;
          ">
            ${
              defaultProfile.avatar
                ? renderBotAvatar(defaultProfile.name, defaultProfile.displayName, defaultProfile.avatar, 30)
                : `<span style="font-size: 16px; color: ${currentAgentName.toLowerCase() === 'default' ? 'var(--accent)' : 'var(--text-main)'};">✦</span>`
            }
            ${
              defaultProfile.activityState === 'running'
                // gate-perf-allow: 智能体执行中呼吸指示器
                ? `<span class="activity-pulse-indicator" title="${t('rail.activityRunning')}" style="position: absolute; top: -2px; right: -2px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 6px var(--accent-glow); animation: jadePulse 1.2s infinite; z-index: 2;"></span>`
                : defaultProfile.activityState === 'unread'
                ? `<span class="activity-unread-badge" title="${t('rail.activityUnread')}" style="position: absolute; top: -2px; right: -2px; width: 7px; height: 7px; border-radius: 50%; background: var(--jade-pulse); box-shadow: 0 0 4px var(--jade-glow); z-index: 2;"></span>`
                : ''
            }
          </div>
        </div>

        <!-- 中间独立垂直平滑滚动区：所有专职 Agent 列表 (100% 消费 Gateway 真实自定义头像) -->
        <div class="station-agents-scroll" style="
          flex: 1;
          width: 100%;
          overflow-y: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 2px 0;
        ">
          ${otherAgents
            .map((p) => {
              const isSelected = currentAgentName.toLowerCase() === p.name.toLowerCase();
              return `
              <div class="station-agent-badge rail-pinned-bot-row ${isSelected ? 'active' : ''}" data-station-profile="${escapeHtml(p.name)}" data-profile="${escapeHtml(p.name)}" title="${t('rail.enterBotChat', { name: p.displayName || p.name })}" style="
                width: 36px;
                height: 36px;
                border-radius: 10px;
                background: ${isSelected ? 'var(--accent-subtle)' : 'var(--bg-card)'};
                border: 1.5px solid ${isSelected ? 'var(--accent)' : 'var(--border-subtle)'};
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                position: relative;
                transition: all 0.15s ease;
                flex-shrink: 0;
              ">
                ${renderBotAvatar(p.name, p.displayName, p.avatar, 30)}
                ${
                  p.activityState === 'running'
                    // gate-perf-allow: 智能体执行中呼吸指示器
                    ? `<span class="activity-pulse-indicator" title="${t('rail.activityRunning')}" style="position: absolute; top: -2px; right: -2px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 6px var(--accent-glow); animation: jadePulse 1.2s infinite; z-index: 2;"></span>`
                    : p.activityState === 'unread'
                    ? `<span class="activity-unread-badge" title="${t('rail.activityUnread')}" style="position: absolute; top: -2px; right: -2px; width: 7px; height: 7px; border-radius: 50%; background: var(--jade-pulse); box-shadow: 0 0 4px var(--jade-glow); z-index: 2;"></span>`
                    : ''
                }
              </div>
            `;
            })
            .join('')}
        </div>

        <!-- 底部固定位：群聊入口、工作区项目入口、新建按钮 -->
        <div class="station-sticky-bottom" style="display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; padding-top: 6px; border-top: 1px solid var(--border-subtle);">
          <div id="rail-station-groups-btn" class="station-bottom-badge" title="${t('rail.groups')}" style="
            width: 34px;
            height: 34px;
            border-radius: 8px;
            background: var(--bg-panel);
            border: 1px solid var(--border-subtle);
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            position: relative;
            transition: all 0.15s ease;
          ">
            <span style="font-size: 15px;">👥</span>
            ${
              hasActiveGroup
                // gate-perf-allow: 群聊活跃呼吸指示器
                ? `<span class="activity-pulse-indicator" style="position: absolute; top: -2px; right: -2px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 4px var(--accent-glow); animation: jadePulse 1.2s infinite;"></span>`
                : hasUnreadGroup
                ? `<span class="activity-unread-badge" style="position: absolute; top: -2px; right: -2px; width: 6px; height: 6px; border-radius: 50%; background: var(--jade-pulse); box-shadow: 0 0 3px var(--jade-glow);"></span>`
                : ''
            }
          </div>

          <div id="rail-station-projects-btn" class="station-bottom-badge" title="${t('rail.projects')}" style="
            width: 34px;
            height: 34px;
            border-radius: 8px;
            background: var(--bg-panel);
            border: 1px solid var(--border-subtle);
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.15s ease;
          ">
            <span style="font-size: 15px;">📁</span>
          </div>

          <button id="new-chat-btn" class="btn-new-chat" type="button" title="${t('rail.newChat')}" style="
            width: 34px;
            height: 34px;
            border-radius: 8px;
            background: var(--bg-card);
            border: 1px dashed var(--border-medium);
            color: var(--text-main);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.15s ease;
          ">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="8" y1="3" x2="8" y2="13"/>
              <line x1="3" y1="8" x2="13" y2="8"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- 2. 动态抽屉 (Context Drawer): 折叠时 width: 0px 且 display: none，展开时自适应填充剩余空间(由 --rail-w-left 动态驱动) -->
      <div class="flux-context-drawer" style="
        display: ${props.collapsed ? 'none' : 'flex'};
        width: ${props.collapsed ? '0px' : 'calc(100% - 52px)'};
        min-width: ${props.collapsed ? '0px' : '150px'};
        flex: ${props.collapsed ? '0 0 0px' : '1'};
        height: 100%;
        background: var(--bg-rail);
        flex-direction: column;
        overflow: hidden;
      ">
        <!-- 抽屉顶部搜索与快速操作栏 -->
        <div style="padding: 10px 10px 6px; display: flex; flex-direction: column; gap: 6px; -webkit-app-region: no-drag;">
          <div style="position: relative; width: 100%;">
            <input type="text" id="session-search-input" placeholder="${t('rail.searchPlaceholder')}" value="${escapeHtml(props.searchQuery || '')}" style="
              width: 100%;
              height: 28px;
              background: var(--bg-panel);
              border: 1px solid var(--border-subtle);
              border-radius: 6px;
              padding: 0 8px 0 26px;
              font-size: 11.5px;
              color: var(--text-main);
              outline: none;
              box-sizing: border-box;
              user-select: text;
              -webkit-user-select: text;
              cursor: text;
            " />
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" style="position: absolute; left: 8px; top: 8px; color: var(--text-muted); pointer-events: none;">
              <circle cx="7" cy="7" r="5"/>
              <line x1="11" y1="11" x2="15" y2="15"/>
            </svg>
          </div>
        </div>

        <!-- 抽屉滚动主体：单层平铺，彻底终结多层手风琴嵌套与虚假总数 -->
        <div class="session-scroll-area" id="session-list-container" style="
          flex: 1;
          overflow-y: auto;
          padding: 4px 6px 12px;
          display: ${isProjectsTab ? 'none' : 'block'};
        ">
          ${
            railError
              ? `
            <div id="session-list-error" role="alert" style="
              margin: 6px 4px 8px;
              padding: 6px 8px;
              border-radius: 6px;
              border: 1px solid var(--border-strong);
              background: var(--bg-panel);
              color: var(--text-main);
              font-size: 11px;
              line-height: 1.4;
              word-break: break-word;
            ">会话列表加载失败：${escapeHtml(railError)}</div>
          `
              : ''
          }

          <!-- 抽屉第一行：该 Agent 的核心主工位卡片 (100% 消费 Gateway 真实自定义头像) -->
          <div class="rail-pinned-bot-row rail-primary-agent-card ${currentFocus.type === 'bot' && currentFocus.botName === selectedAgentProfile.name ? 'active' : ''}" data-profile="${escapeHtml(selectedAgentProfile.name)}" data-primary-bot="${escapeHtml(selectedAgentProfile.name)}" title="${t('rail.enterBotChat', { name: selectedAgentProfile.displayName || selectedAgentProfile.name })}" style="
            min-height: 48px;
            padding: 6px 8px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            background: ${currentFocus.type === 'bot' && currentFocus.botName === selectedAgentProfile.name ? 'var(--bg-card-active)' : 'var(--bg-panel)'};
            border: 1px solid ${currentFocus.type === 'bot' && currentFocus.botName === selectedAgentProfile.name ? 'var(--accent)' : 'var(--border-subtle)'};
            position: relative;
            transition: background 0.12s ease;
            margin-bottom: 6px;
          ">
            <div style="position: relative; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;">
              ${renderBotAvatar(selectedAgentProfile.name, selectedAgentProfile.displayName, selectedAgentProfile.avatar, 32)}
              ${
                selectedAgentProfile.activityState === 'running'
                  // gate-perf-allow: 智能体主工位执行态指示器
                  ? `<span class="activity-pulse-indicator" title="${t('rail.activityRunning')}" style="position: absolute; top: -1px; right: -1px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 6px var(--accent-glow); animation: jadePulse 1.2s infinite; z-index: 2;"></span>`
                  : selectedAgentProfile.activityState === 'unread'
                  ? `<span class="activity-unread-badge" title="${t('rail.activityUnread')}" style="position: absolute; top: -1px; right: -1px; width: 7px; height: 7px; border-radius: 50%; background: var(--jade-pulse); box-shadow: 0 0 4px var(--jade-glow); z-index: 2;"></span>`
                  : ''
              }
            </div>
            <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 2px;">
              <div style="display: flex; align-items: center; justify-content: space-between; line-height: 1.2;">
                <span style="font-size: 12.5px; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${escapeHtml(selectedAgentProfile.displayName || selectedAgentProfile.name)}
                </span>
                ${selectedAgentProfile.lastTime ? `<span style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono); flex-shrink: 0; margin-left: 4px;">${escapeHtml(selectedAgentProfile.lastTime)}</span>` : ''}
              </div>
              <div style="font-size: 11px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3;">
                ${escapeHtml(formatMessageSnippet(selectedAgentProfile.lastMessage || selectedAgentProfile.description || t('rail.defaultBotSnippet'), 32))}
              </div>
            </div>
          </div>

          <!-- 群聊会议室组 (仅展示当前选中的这个 Agent 参与的群聊) -->
          ${
            filteredGroups.length > 0
              ? `
            <div class="groups-section-wrap" style="margin-bottom: 8px;">
              <div id="rail-groups-accordion-trigger" style="display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; cursor: pointer; user-select: none;">
                <div style="display: flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  <span>${t('rail.groups')} (${filteredGroups.length})</span>
                </div>
                <svg class="groups-chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-muted); transform: ${isGroupsOpen ? 'rotate(90deg)' : 'rotate(0deg)'}; transition: transform 0.2s ease;"><polyline points="9 18 15 12 9 6"/></svg>
              </div>

              <div id="rail-groups-nested-list" style="display: ${isGroupsOpen ? 'flex' : 'none'}; flex-direction: column; gap: 2px; padding: 2px 0 4px;">
                ${filteredGroups
                  .map((g) => {
                    const isActive = currentFocus.type === 'group' && currentFocus.roomId === g.roomId;
                    const isEditing = props.editingGroupRoomId === g.roomId;
                    const collageAvatar = renderGroupCollageAvatar(g.members, props.profiles, 28);
                    const timeStr = g.updatedAt ? formatSessionTime(g.updatedAt) : '';

                    if (isEditing) {
                      return `
                      <div class="rail-group-item editing active rail-group-inline-rename-wrap" data-room-id="${escapeHtml(g.roomId)}" style="
                        padding: 6px 8px;
                        border-radius: 6px;
                        background: var(--bg-card-active);
                        border: 1px solid var(--accent);
                        display: flex;
                        align-items: center;
                        gap: 6px;
                      ">
                        <input type="text" id="rail-group-rename-input-${escapeHtml(g.roomId)}" class="rail-group-rename-input" value="${escapeHtml(g.name)}" style="
                          flex: 1;
                          height: 24px;
                          background: var(--bg-panel);
                          border: 1px solid var(--accent);
                          border-radius: 4px;
                          color: var(--text-main);
                          font-size: 11px;
                          padding: 0 6px;
                          outline: none;
                        " />
                        <button class="btn-confirm-group-rename" data-room-id="${escapeHtml(g.roomId)}" title="${t('common.confirm')}" style="background: var(--accent); border: none; border-radius: 4px; color: var(--background); width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; cursor: pointer;">✓</button>
                        <button class="btn-cancel-group-rename" data-room-id="${escapeHtml(g.roomId)}" title="${t('common.cancel')}" style="background: transparent; border: 1px solid var(--border-subtle); border-radius: 4px; color: var(--text-muted); width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; cursor: pointer;">✕</button>
                      </div>
                    `;
                    }

                    return `
                    <div class="rail-group-item ${isActive ? 'active' : ''}" data-room-id="${escapeHtml(g.roomId)}" title="${escapeHtml(g.name)}" style="
                      min-height: 40px;
                      padding: 5px 8px;
                      border-radius: 6px;
                      background: ${isActive ? 'var(--bg-card-active)' : 'transparent'};
                      border: 1px solid ${isActive ? 'var(--accent)' : 'transparent'};
                      cursor: pointer;
                      display: flex;
                      align-items: center;
                      gap: 8px;
                      transition: background 0.12s ease;
                    ">
                      <div style="position: relative; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        ${collageAvatar}
                        ${
                          g.activityState === 'running'
                            // gate-perf-allow: 群聊执行中呼吸指示器
                            ? `<span class="activity-pulse-indicator" title="${t('rail.activityRunning')}" style="position: absolute; top: -1px; right: -1px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 6px var(--accent-glow); animation: jadePulse 1.2s infinite; z-index: 2;"></span>`
                            : g.activityState === 'unread'
                            ? `<span class="activity-unread-badge" title="${t('rail.activityUnread')}" style="position: absolute; top: -1px; right: -1px; width: 7px; height: 7px; border-radius: 50%; background: var(--jade-pulse); box-shadow: 0 0 4px var(--jade-glow); z-index: 2;"></span>`
                            : ''
                        }
                      </div>
                      <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center;">
                        <div style="display: flex; align-items: center; justify-content: space-between; line-height: 1.2;">
                          <span style="font-size: 12px; font-weight: ${isActive ? '600' : '400'}; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${escapeHtml(g.name)}
                          </span>
                          ${timeStr ? `<span style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono); margin-left: 4px; flex-shrink: 0;">${escapeHtml(timeStr)}</span>` : ''}
                        </div>
                        <div style="font-size: 10.5px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px;">
                          ${escapeHtml(formatMessageSnippet(g.lastMessage, 32) || t('rail.groupsMembers', { count: String(g.members.length) }))}
                        </div>
                      </div>
                    </div>
                  `;
                  })
                  .join('')}
              </div>
            </div>
          `
              : ''
          }

          <!-- 会话组 (仅展示当前选中的这个 Agent 专属的会话/任务) -->
          <div class="sessions-section-wrap" style="margin-bottom: 8px;">
            <div id="rail-sessions-accordion-trigger" style="display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; cursor: pointer; user-select: none;">
              <div style="display: flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span>${t('rail.conversations')} (${activeSessions.length})</span>
              </div>
              <svg class="sessions-chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-muted); transform: ${isSessionsOpen ? 'rotate(90deg)' : 'rotate(0deg)'}; transition: transform 0.2s ease;"><polyline points="9 18 15 12 9 6"/></svg>
            </div>

            <div id="rail-sessions-nested-list" style="display: ${isSessionsOpen ? 'flex' : 'none'}; flex-direction: column; gap: 2px; padding: 2px 0 4px;">
              ${
                activeSessions.length === 0
                  ? `
                <div style="padding: 20px 8px; text-align: center; color: var(--text-muted); font-size: 11px; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                  <span>${railError ? t('rail.errorTitle') : t('rail.emptyTitle')}</span>
                  <span style="font-size: 10.5px; color: var(--text-faint);">${railError ? t('rail.errorSub') : t('rail.emptySub')}</span>
                </div>
              `
                  : activeSessions.map((s) => renderSessionRow(s, currentFocus)).join('')
              }
            </div>
          </div>

          <!-- 归档历史折叠区 -->
          ${
            archivedSessions.length > 0
              ? `
            <div style="font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; padding: 8px 6px 2px;">${t('rail.archived')} (${archivedSessions.length})</div>
            <div style="display: flex; flex-direction: column; gap: 2px;">
              ${archivedSessions
                .map((s) => {
                  const isActive = currentFocus.type === 'session' && currentFocus.sessionId === s.id;
                  return `
                  <div class="session-item ${isActive ? 'active' : ''}" data-id="${s.id}" style="
                    min-height: 32px;
                    padding: 0 8px;
                    border-radius: 6px;
                    background: ${isActive ? 'var(--bg-card-active)' : 'transparent'};
                    border: 1px solid ${isActive ? 'var(--accent)' : 'transparent'};
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    opacity: 0.65;
                  ">
                    <span style="font-size: 11.5px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(s.title)}</span>
                  </div>
                `;
                })
                .join('')}
            </div>
          `
              : ''
          }
        </div>

        <!-- 项目卡片甲板 (View B: Projects Deck) -->
        <div id="rail-projects-deck" style="
          flex: 1;
          overflow-y: auto;
          padding: 6px 8px 12px;
          display: ${isProjectsTab ? 'block' : 'none'};
        ">
          <div style="font-size: 10.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; padding: 6px 8px 8px;">
            ${t('rail.projects')}
          </div>

          ${
            realProjects.length === 0
              ? `
            <div style="padding: 36px 12px; text-align: center; color: var(--text-muted); font-size: 12px; display: flex; flex-direction: column; align-items: center; gap: 8px;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              <span>${t('rail.projectsEmpty')}</span>
              <span style="font-size: 11px; color: var(--text-faint);">${t('rail.projectsEmptySub')}</span>
            </div>
          `
              : `
            <div style="display: flex; flex-direction: column; gap: 6px;">
              ${realProjects
                .map((proj, idx) => {
                  const isOpen = idx === 0;
                  const nestedSessions = proj.sessions || [];
                  return `
                  <div class="project-accordion-unit ${isOpen ? 'open' : ''}" id="rail-proj-${escapeHtml(proj.id)}" style="
                    border: 1px solid var(--border-subtle);
                    border-radius: 8px;
                    background: var(--bg-card);
                    overflow: hidden;
                  ">
                    <div class="project-accordion-trigger" data-project-id="${escapeHtml(proj.id)}" style="
                      padding: 8px 10px;
                      display: flex;
                      align-items: center;
                      justify-content: space-between;
                      cursor: pointer;
                    ">
                      <div style="font-size: 12px; font-weight: 600; color: var(--text-main); display: flex; align-items: center; gap: 6px;">
                        <span>📁</span>
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(proj.name)}</span>
                      </div>
                      <span style="font-size: 10px; color: var(--text-muted);">${nestedSessions.length}</span>
                    </div>
                    <div class="project-accordion-body" style="padding: 0 8px 8px; display: ${isOpen ? 'block' : 'none'};">
                      ${
                        nestedSessions.length > 0
                          ? `<div style="display: flex; flex-direction: column; gap: 2px;">
                              ${nestedSessions.map((s) => renderSessionRow(s, currentFocus, true)).join('')}
                            </div>`
                          : `<div style="padding: 10px 4px; text-align: center; color: var(--text-muted); font-size: 11px;">${t('rail.projectNoSessions')}</div>`
                      }
                    </div>
                  </div>
                `;
                })
                .join('')}
            </div>
          `
          }
        </div>
      </div>

      <!-- 可拖拽把手 (右侧边缘，加宽物理拾取热区至 10px，配置 touch-action 与 pointer-events 确保即触即拖) -->
      ${
        !props.collapsed
          ? `
        <div class="rail-resize-handle" data-rail-handle="left" role="separator" aria-orientation="vertical" tabindex="0" title="拖拽调整左侧栏宽度" style="
          position: absolute;
          right: -5px;
          top: 0;
          bottom: 0;
          width: 10px;
          z-index: 90;
          cursor: col-resize;
          background: transparent;
          touch-action: none;
          pointer-events: auto;
        "></div>
      `
          : ''
      }
    </aside>
  `;
}

function renderSessionRow(s: LeftRailSession, currentFocus: LeftRailActiveFocus, isCompact: boolean = false): string {
  const isActive = currentFocus.type === 'session' && currentFocus.sessionId === s.id;
  const avatarNode = renderBotAvatar(s.botName || 'default', s.botDisplayName, s.botAvatar, isCompact ? 18 : 24);

  return `
    <div class="session-item ${isActive ? 'active' : ''}" data-id="${s.id}" data-title="${escapeHtml(s.title)}" data-bot="${escapeHtml(s.botName || '')}" style="
      min-height: ${isCompact ? '30px' : '38px'};
      padding: ${isCompact ? '2px 6px' : '4px 6px'};
      border-radius: 6px;
      background: ${isActive ? 'var(--bg-card-active)' : 'transparent'};
      border: 1px solid ${isActive ? 'var(--accent)' : 'transparent'};
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      position: relative;
      transition: background 0.12s ease, border-color 0.12s ease;
    ">
      ${isActive ? '<div class="active-indicator" style="position: absolute; left: 0; top: 6px; bottom: 6px; width: 3px; background: var(--accent); border-radius: 0 2px 2px 0;"></div>' : ''}
      
      <div style="position: relative; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;">
        ${avatarNode}
        ${
          s.activityState === 'running'
            // gate-perf-allow: 会话执行态脉冲动画
            ? `<span class="activity-pulse-indicator" title="${t('rail.activityRunning')}" style="position: absolute; top: -1px; right: -1px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 6px var(--accent-glow); animation: jadePulse 1.2s infinite; z-index: 2;"></span>`
            : s.activityState === 'unread'
            ? `<span class="activity-unread-badge" title="${t('rail.activityUnread')}" style="position: absolute; top: -1px; right: -1px; width: 6px; height: 6px; border-radius: 50%; background: var(--jade-pulse); box-shadow: 0 0 4px var(--jade-glow); z-index: 2;"></span>`
            : ''
        }
      </div>

      <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center;">
        <div style="display: flex; justify-content: space-between; align-items: center; line-height: 1.2;">
          <span style="
            font-size: 12px;
            font-weight: ${isActive ? '600' : '400'};
            color: var(--text-main);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            flex: 1;
          ">${escapeHtml(s.title)}</span>
          ${s.time ? `<span style="font-size: 9.5px; color: var(--text-muted); font-family: var(--font-mono); margin-left: 4px; flex-shrink: 0;">${escapeHtml(s.time)}</span>` : ''}
        </div>
        ${
          !isCompact
            ? `
          <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 1px;">
            <span style="font-size: 10.5px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">
              ${escapeHtml(formatMessageSnippet(s.preview, 32) || formatMessageSnippet(s.title, 32))}
            </span>
          </div>
        `
            : ''
        }
      </div>
    </div>
  `;
}

// gate-theme-allow: 1:1对齐官方Xiaofawang黄色三角形头像
const XIAOFAWANG_YELLOW = '#FACC15';
// gate-theme-allow: 1:1对齐官方Bot双眼瞳孔自然黑色
const BOT_PUPIL_BLACK = '#18181B';

/**
 * 1:1 消费 Gateway 真实自定义头像资产：
 * 1. 优先消费 avatarUrl（Base64 Data URL / HTTP URL / Local File URL）渲染真实 <img>；
 * 2. 仅在明确未提供 avatarUrl 且名称为 xiaofawang 时渲染确定性黄色三角形；
 * 3. 其他兜底渲染基于名称生成的确定性几何图腾。
 */
export function renderBotAvatar(name: string, displayName?: string, avatarUrl?: string, size = 36): string {
  if (avatarUrl) {
    return `<img src="${escapeHtml(avatarUrl)}" style="
      width: ${size}px;
      height: ${size}px;
      border-radius: 8px;
      object-fit: cover;
      flex-shrink: 0;
      border: 1px solid var(--border-subtle);
      display: block;
    " alt="${escapeHtml(displayName || name)}" />`;
  }

  const cleanName = (name || 'agent').toLowerCase().trim();

  let hash = 0;
  for (const ch of cleanName) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  const shapes = ['circle', 'squircle', 'pill', 'triangle', 'hexagon', 'cloud', 'drop'];
  const pickedShape = shapes[hash % shapes.length];

  if (cleanName.includes('xiaofawang') || pickedShape === 'triangle') {
    return `
      <svg width="${size}" height="${size}" viewBox="0 0 36 36" fill="none" style="flex-shrink: 0; display: block;">
        <path d="M18 4.5 C19.2 2.5 21.8 2.5 23 4.5 L34 26 C35.2 28.2 33.8 31 31.2 31 L6.8 31 C4.2 31 2.8 28.2 4 26 Z" fill="${XIAOFAWANG_YELLOW}" />
        <circle cx="15" cy="18" r="1.8" fill="${BOT_PUPIL_BLACK}" />
        <circle cx="23" cy="18" r="1.8" fill="${BOT_PUPIL_BLACK}" />
      </svg>
    `;
  }

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 36 36" fill="none" style="flex-shrink: 0; display: block;">
      <rect width="36" height="36" rx="8" fill="var(--bg-panel)" />
      ${
        pickedShape === 'circle'
          ? `<circle cx="18" cy="18" r="13" fill="var(--accent)" />`
          : pickedShape === 'cloud'
          ? `<path d="M10 24 a6 6 0 0 1 -1 -12 a7.5 7.5 0 0 1 14 -1 a5.5 5.5 0 0 1 5 13 Z" fill="var(--accent)" />`
          : `<rect x="5" y="5" width="26" height="26" rx="6" fill="var(--accent)" />`
      }
      <circle cx="14" cy="17" r="1.8" fill="${BOT_PUPIL_BLACK}" />
      <circle cx="22" cy="17" r="1.8" fill="${BOT_PUPIL_BLACK}" />
    </svg>
  `;
}

function renderGroupCollageAvatar(
  members: string[],
  profiles?: Array<{ name: string; avatar?: string; displayName?: string }>,
  size = 28
): string {
  const profMap = new Map<string, string>();
  if (profiles) {
    for (const p of profiles) {
      if (p.avatar) {
        profMap.set(p.name.toLowerCase(), p.avatar);
        if (p.displayName) profMap.set(p.displayName.toLowerCase(), p.avatar);
      }
    }
  }

  const cleanMembers = (members || []).slice(0, 4);
  const count = cleanMembers.length;

  if (count === 0) {
    return `<span style="width: ${size}px; height: ${size}px; border-radius: 6px; background: var(--bg-card); border: 1px solid var(--border-subtle); display: inline-flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; color: var(--accent);">👥</span>`;
  }

  const cellHtmls = cleanMembers.map((m) => {
    const lower = m.toLowerCase().trim();
    const avatar = profMap.get(lower);
    if (avatar) {
      return `<img src="${escapeHtml(avatar)}" style="width: 100%; height: 100%; object-fit: cover; display: block;" alt="${escapeHtml(m)}" />`;
    }
    let hash = 0;
    for (const ch of lower) {
      hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    }
    const shapes = ['circle', 'squircle', 'pill', 'triangle', 'hexagon', 'cloud', 'drop'];
    const pickedShape = shapes[hash % shapes.length];

    if (lower.includes('xiaofawang') || pickedShape === 'triangle') {
      return `
        <svg viewBox="0 0 36 36" style="width: 100%; height: 100%; display: block;" fill="none">
          <path d="M18 4.5 C19.2 2.5 21.8 2.5 23 4.5 L34 26 C35.2 28.2 33.8 31 31.2 31 L6.8 31 C4.2 31 2.8 28.2 4 26 Z" fill="${XIAOFAWANG_YELLOW}" />
          <circle cx="15" cy="18" r="2.2" fill="${BOT_PUPIL_BLACK}" />
          <circle cx="23" cy="18" r="2.2" fill="${BOT_PUPIL_BLACK}" />
        </svg>
      `;
    }
    return `<span style="width: 100%; height: 100%; background: var(--accent-subtle); color: var(--accent); font-size: 8px; font-weight: 700; display: flex; align-items: center; justify-content: center; font-family: var(--font-mono);">${lower.slice(0, 1).toUpperCase()}</span>`;
  });

  if (count === 2) {
    return `
      <div style="width: ${size}px; height: ${size}px; border-radius: 6px; background: var(--bg-panel); border: 1px solid var(--border-subtle); display: flex; gap: 1px; padding: 1.5px; overflow: hidden; box-sizing: border-box; flex-shrink: 0;">
        <div style="flex: 1; height: 100%; overflow: hidden; border-radius: 2px;">${cellHtmls[0]}</div>
        <div style="flex: 1; height: 100%; overflow: hidden; border-radius: 2px;">${cellHtmls[1]}</div>
      </div>
    `;
  }

  return `
    <div style="width: ${size}px; height: ${size}px; border-radius: 6px; background: var(--bg-panel); border: 1px solid var(--border-subtle); display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 1px; padding: 1.5px; overflow: hidden; box-sizing: border-box; flex-shrink: 0;">
      ${cellHtmls.map((cell) => `<div style="width: 100%; height: 100%; overflow: hidden; border-radius: 2px;">${cell}</div>`).join('')}
    </div>
  `;
}

function formatSessionTime(timestamp: number): string {
  const norm = timestamp > 1e11 ? timestamp : timestamp * 1000;
  const d = new Date(norm);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${m}/${day}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
