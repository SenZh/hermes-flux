import * as React from 'react';
import { ChevronLeft, Folder, MessageSquare, MoreHorizontal, Plus, Search, Users } from 'lucide-react';import { t } from '../i18n/index.js';
import { Badge } from './primitives/Badge.js';
import { Button } from './primitives/Button.js';
import { Input } from './primitives/Input.js';
import { renderBotAvatar, renderGroupCollageAvatar } from '../utils/botAvatar.js';
import {
  formatLeftRailTime,
  isBotFocused,
  isGroupFocused,
  isSessionFocused,
  toSnippet,
  type LeftRailGroupRoom,
  type LeftRailModel,
  type LeftRailProfile,
  type LeftRailProject,
  type LeftRailSession,
  type LeftRailTab,
} from './leftRailModel.js';

export interface LeftRailProps {
  model: LeftRailModel;
  collapsed: boolean;
  searchQuery: string;
  editingGroupRoomId?: string;
  /** 群聊拼图头像的成员资产来源；缺省时回退确定性字母块，不影响行可用性。 */
  groupAvatars?: LeftRailProfile[];
  onToggleDrawer: () => void;
  onSelectSession: (sessionId: string, botName?: string) => void;
  onSelectBot: (profileName: string) => void;
  onSelectGroup: (roomId: string) => void;
  onOpenSessionMenu: (sessionId: string, title: string, x: number, y: number) => void;
  onOpenBotMenu: (profileName: string, x: number, y: number) => void;
  onOpenGroupMenu: (roomId: string, name: string, x: number, y: number) => void;
  onSearchChange: (value: string) => void;
  onNewChat: () => void;
  onSetTab: (tab: LeftRailTab) => void;
  onToggleSessions: () => void;
  onToggleGroups: () => void;
  onStartGroupRename: (roomId: string) => void;
  onConfirmGroupRename: (roomId: string, name: string) => void;
  onCancelGroupRename: () => void;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
}

/** 头像只复用既有资产管线（真实 <img> / 几何图腾 SVG），避免第二套身份渲染分叉。 */
function Avatar({ profile, size }: { profile: Pick<LeftRailProfile, 'name' | 'displayName' | 'avatar'>; size: number }): React.ReactElement {
  return <span aria-hidden="true" className="inline-flex shrink-0" dangerouslySetInnerHTML={{ __html: renderBotAvatar(profile.name, profile.displayName, profile.avatar, size) }} />;
}

/**
 * 群聊拼图头像。
 * 【设计意图】群聊没有单一身份，多人拼贴是它唯一可辨识的视觉签名，必须与其它行区分开。
 * 【约束与规则】资产管线复用 botAvatar 的单一实现，组件内不自造第二套头像逻辑。
 */
function CollageAvatar({ members, profiles, size }: { members: string[]; profiles: LeftRailProfile[]; size: number }): React.ReactElement {
  return <span aria-hidden="true" className="inline-flex shrink-0" dangerouslySetInnerHTML={{ __html: renderGroupCollageAvatar(members, profiles, size) }} />;
}

/**
 * 活动指示点：running 呼吸点 / unread 翡翠点 / read 不渲染。
 * 设计意图 (Why)：会话行已去掉头像，指示器改为钉在时间列左侧的独立圆点，位置稳定不随标题长度漂移。
 * 约束与规则 (Rules)：class 语义与探针/测试约定一致（activity-pulse-indicator / activity-unread-badge），不得改名。
 */
function ActivityDot({ state }: { state?: LeftRailSession['activityState'] }): React.ReactElement | null {
  if (state === 'running') {
    return <span className="activity-pulse-indicator size-2 shrink-0 rounded-full bg-primary" title={t('rail.activityRunning')} data-status="running" />;
  }
  if (state === 'unread') {
    return <span className="activity-unread-badge size-1.5 shrink-0 rounded-full bg-success" title={t('rail.activityUnread')} data-status="unread" />;
  }
  return null;
}

/**
 * 行内时间。
 * 【设计意图】优先展示上游已经格式化好的时间串（core 的 syncBotProfiles 产出 lastTime，
 *   壳层 fetchSessions 产出 time），只有在完全没有字符串时才用本地紧凑格式兜底。
 * 【防范的历史坑】曾无条件用本地格式覆盖上游时间，导致主工位卡显示的"昨天 22:49"
 *   被改写成"10/28"，与生产同步产物对不上，也让同一时刻在不同舱位显示成两种时间。
 * 【约束与规则】时间是纯展示，禁止在这里做 Intl 或时区换算。
 */
function RowTime({ timestamp, fallback }: { timestamp?: number; fallback?: string }): React.ReactElement | null {
  const provided = (fallback || '').trim();
  const value = provided || formatLeftRailTime(timestamp);
  if (!value) return null;
  const iso = timestamp ? new Date(timestamp > 1e11 ? timestamp : timestamp * 1000).toISOString() : undefined;
  return <time className="shrink-0 font-code text-caption text-muted-foreground tabular-nums" dateTime={iso}>{value}</time>;
}

/**
 * 会话行（用户定案形态）。
 * 【设计意图】去掉行内头像：微轨与主工位卡已承载 Bot 身份，行内重复且挤压标题；主体=标题，副标题=12px muted 单行截断；
 *   时间紧凑化后钉右缘，行高 48px 保持触控与扫描节奏。
 * 【约束与规则】只消费传进来的快照，绝不改写数据管道；点击与右键一律交回壳层。
 */
function SessionRow({ session, active, compact, onSelect, onMenu }: {
  session: LeftRailSession;
  active: boolean;
  compact?: boolean;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
}): React.ReactElement {
  const subtitle = toSnippet(session.preview) || toSnippet(session.title);
  return <button
    type="button"
    className={`session-item group relative flex w-full items-center gap-2 rounded-md border px-2 text-left transition-colors ${compact ? 'min-h-8' : 'min-h-12'} ${active ? 'active border-primary bg-card-active' : 'border-transparent hover:bg-card-hover'}`}
    data-id={session.id}
    data-title={session.title}
    data-bot={session.botName || ''}
    onClick={onSelect}
    onContextMenu={(event) => { event.preventDefault(); onMenu(event.clientX, event.clientY); }}
  >
    {active && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-primary" />}
    <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
      <span className={`truncate text-body leading-tight ${active ? 'font-semibold text-foreground' : 'text-foreground'}`}>{session.title}</span>
      {!compact && <span className="truncate text-aux leading-tight text-muted-foreground">{subtitle}</span>}
    </span>
    <ActivityDot state={session.activityState} />
    <RowTime timestamp={session.timestamp} fallback={session.time} />
  </button>;
}

function GroupRow({ group, profiles, active, editing, onSelect, onMenu, onStartRename, onConfirmRename, onCancelRename }: {
  group: LeftRailGroupRoom;
  profiles: LeftRailProfile[];
  active: boolean;
  editing: boolean;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
  onStartRename: () => void;
  onConfirmRename: (name: string) => void;
  onCancelRename: () => void;
}): React.ReactElement {
  if (editing) {
    return <div className="rail-group-item rail-group-inline-rename-wrap active min-h-10 rounded-md border border-primary bg-card-active px-2" data-room-id={group.roomId}>
      <RenameGroup initialName={group.name} roomId={group.roomId} onConfirm={onConfirmRename} onCancel={onCancelRename} />
    </div>;
  }
  const subtitle = toSnippet(group.lastMessage) || t('rail.groupsMembers', { count: String(group.members.length) });
  return <div
    className={`rail-group-item group flex min-h-10 items-center gap-2 rounded-md border px-2 py-1 ${active ? 'active border-primary bg-card-active' : 'border-transparent hover:bg-card-hover'}`}
    data-room-id={group.roomId}
  >
    <CollageAvatar members={group.members} profiles={profiles} size={28} />
    <button type="button" className="flex min-w-0 flex-1 flex-col gap-0.5 text-left" onClick={onSelect} onContextMenu={(event) => { event.preventDefault(); onMenu(event.clientX, event.clientY); }}>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-body leading-tight text-foreground">{group.name}</span>
        <ActivityDot state={group.activityState} />
        <RowTime timestamp={group.updatedAt || group.createdAt} />
      </span>
      <span className="truncate text-aux leading-tight text-muted-foreground">{subtitle}</span>
    </button>
    <Button variant="ghost" size="icon" className="size-6 shrink-0 rounded p-0 text-muted-foreground hover:text-foreground" aria-label={t('rail.groupActions')} onClick={onStartRename}>
      <MoreHorizontal size={14} />
    </Button>
  </div>;
}

function RenameGroup({ initialName, roomId, onConfirm, onCancel }: {
  initialName: string;
  roomId: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [value, setValue] = React.useState(initialName);
  return <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={(event) => { event.preventDefault(); onConfirm(value.trim()); }}>
    <Input
      id={`rail-group-rename-input-${roomId}`}
      className="rail-group-rename-input h-7 min-w-0 flex-1 rounded-sm border-primary bg-panel px-1.5 text-aux"
      value={value}
      onChange={(event) => setValue(event.currentTarget.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onCancel(); } }}
      autoFocus
    />
    <Button type="submit" size="sm" className="h-6 rounded-sm px-2 text-micro" title={t('common.confirm')}>{t('common.confirm')}</Button>
    <Button type="button" variant="ghost" size="sm" className="h-6 rounded-sm px-1 text-micro text-muted-foreground" title={t('common.cancel')} onClick={onCancel}>{t('common.cancel')}</Button>
  </form>;
}

function ProjectCard({ project, focus, onSelectSession, onSessionMenu }: {
  project: LeftRailProject;
  focus: LeftRailModel['currentFocus'];
  onSelectSession: (session: LeftRailSession) => void;
  onSessionMenu: (session: LeftRailSession, x: number, y: number) => void;
}): React.ReactElement {
  const sessions = project.sessions || [];
  return <details id={`rail-proj-${project.id}`} className="project-accordion-unit overflow-hidden rounded-lg border border-border-subtle bg-card" data-project-id={project.id}>
    <summary className="project-accordion-trigger flex cursor-pointer items-center gap-2 p-2 text-body font-semibold text-foreground">
      <Folder size={14} className="shrink-0 text-muted-foreground" />
      <span className="truncate">{project.name}</span>
      <Badge variant="secondary" className="ml-auto">{sessions.length}</Badge>
    </summary>
    <div className="project-accordion-nested flex flex-col gap-0.5 px-2 pb-2">
      {sessions.length > 0
        ? sessions.map((session) => <SessionRow key={session.id} session={session} compact active={isSessionFocused(focus, session.id)} onSelect={() => onSelectSession(session)} onMenu={(x, y) => onSessionMenu(session, x, y)} />)
        : <p className="py-2 text-center text-aux text-muted-foreground">{t('rail.projectNoSessions')}</p>}
    </div>
  </details>;
}

/**
 * 左轨（微轨 + 上下文抽屉）。
 * 【设计意图】只呈现壳层给出的快照，所有状态变更经回调返回；抽屉内容严格按当前 Agent 隔离。
 * 【防范的历史坑】模板时代整个左轨每帧 outerHTML 重建，搜索、滚动位置、行内重命名输入全部被连根拔起。
 * 【约束与规则】主工位卡的数据（lastMessage/lastTime/timestamp/activityState）原样取自 profiles 快照，
 *   组件内不得再扫描普通会话池，杜绝"旁聊会话覆盖 Bot 卡片"的冒名污染。
 */
export function LeftRail(props: LeftRailProps): React.ReactElement {
  const { model } = props;
  const focus = model.currentFocus;
  const profile = model.selectedAgent;
  const railWidth = props.collapsed ? 'var(--geo-micro-rail, 52px)' : 'var(--rail-w-left, 264px)';

  const openBotMenu = (event: React.MouseEvent, name: string): void => {
    event.preventDefault();
    props.onOpenBotMenu(name, event.clientX, event.clientY);
  };

  return <aside
    id="flux-left-rail"
    className={`flux-left-rail relative flex h-full flex-row border-r border-border-subtle bg-sidebar ${props.collapsed ? 'rail-collapsed' : ''}`}
    style={{ flex: `0 0 ${railWidth}`, width: railWidth, minWidth: railWidth, maxWidth: railWidth }}
    data-testid="react-left-rail"
  >
    <div id="flux-station-rail" className="flex w-[var(--geo-micro-rail,52px)] shrink-0 flex-col items-center gap-2 border-r border-border-subtle bg-card py-2">
      <Button
        variant="ghost"
        size="icon"
        className={`size-9 rounded-md border ${isBotFocused(focus, model.defaultAgent.name) ? 'border-primary bg-primary-subtle' : 'border-border-subtle bg-card'}`}
        data-profile="default"
        data-station-profile="default"
        title={t('rail.enterBotChat', { name: model.defaultAgent.displayName || t('rail.defaultAssistant') })}
        onClick={() => props.onSelectBot('default')}
        onContextMenu={(event) => openBotMenu(event, 'default')}
      >
        <Avatar profile={model.defaultAgent} size={30} />
      </Button>
      <div className="station-agents-scroll flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto py-1 [scrollbar-width:none]">
        {model.otherAgents.map((agent) => <Button
          key={agent.name}
          variant="ghost"
          size="icon"
          className={`station-agent-badge rail-pinned-bot-row relative size-9 shrink-0 rounded-md border p-0 ${isBotFocused(focus, agent.name) ? 'active border-primary bg-primary-subtle' : 'border-border-subtle bg-card'}`}
          data-profile={agent.name}
          data-station-profile={agent.name}
          title={t('rail.enterBotChat', { name: agent.displayName || agent.name })}
          onClick={() => props.onSelectBot(agent.name)}
          onContextMenu={(event) => openBotMenu(event, agent.name)}
        >
          <Avatar profile={agent} size={30} />
          {agent.activityState === 'running' && <span className="activity-pulse-indicator absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary" title={t('rail.activityRunning')} data-status="running" />}
          {agent.activityState === 'unread' && <span className="activity-unread-badge absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-success" title={t('rail.activityUnread')} data-status="unread" />}
        </Button>)}
      </div>
      <div className="flex w-full flex-col items-center gap-2 border-t border-border-subtle pt-2">
        <Button id="rail-station-groups-btn" variant="ghost" size="icon" className="relative size-9 rounded-md bg-panel text-secondary-foreground" title={t('rail.groups')} onClick={() => props.onSetTab('groups')}>
          <Users size={15} />
          {model.hasRunningGroup && <span className="activity-pulse-indicator absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-primary" data-status="running" />}
          {!model.hasRunningGroup && model.hasUnreadGroup && <span className="activity-unread-badge absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-success" data-status="unread" />}
        </Button>
        <Button id="rail-station-projects-btn" variant="ghost" size="icon" className="size-9 rounded-md bg-panel text-secondary-foreground" title={t('rail.projects')} onClick={() => props.onSetTab('projects')}>
          <Folder size={15} />
        </Button>
        <Button id="new-chat-btn" variant="ghost" size="icon" className="size-9 rounded-md border border-dashed border-border bg-card text-foreground" title={t('rail.newChat')} onClick={props.onNewChat}>
          <Plus size={15} />
        </Button>
        <Button variant="ghost" size="icon" className="size-8 rounded-md p-0 text-muted-foreground" title={t('titlebar.toggleLeftRail')} aria-label={t('titlebar.toggleLeftRail')} onClick={props.onToggleDrawer}>
          <ChevronLeft size={14} />
        </Button>
      </div>
    </div>

    {!props.collapsed && <div className="flux-context-drawer flex min-w-0 flex-1 flex-col overflow-hidden bg-sidebar">
      <div className="flex flex-col gap-2 p-2.5 pb-1.5">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={13} />
          <Input
            id="session-search-input"
            className="h-8 rounded-md border border-border-subtle bg-panel pl-7 pr-2 text-aux"
            placeholder={t('rail.searchPlaceholder')}
            value={props.searchQuery}
            onChange={(event) => props.onSearchChange(event.currentTarget.value)}
          />
        </label>
        <Button
          variant="ghost"
          className={`rail-pinned-bot-row rail-primary-agent-card flex min-h-12 items-center justify-start gap-2 rounded-lg border px-2 text-left ${isBotFocused(focus, profile.name) ? 'active border-primary bg-card-active' : 'border-border-subtle bg-panel'}`}
          data-primary-bot={profile.name}
          data-profile={profile.name}
          title={t('rail.enterBotChat', { name: profile.displayName || profile.name })}
          onClick={() => props.onSelectBot(profile.name)}
          onContextMenu={(event) => openBotMenu(event, profile.name)}
        >
          <Avatar profile={profile} size={32} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-aux font-semibold text-foreground">{profile.displayName || profile.name}</span>
            <span className="truncate text-aux text-muted-foreground">{toSnippet(profile.lastMessage || profile.description) || t('rail.defaultBotSnippet')}</span>
          </span>
          <ActivityDot state={profile.activityState} />
          <RowTime timestamp={profile.timestamp} fallback={profile.lastTime} />
        </Button>
      </div>

      {model.showChatDeck && <div className="session-scroll-area min-h-0 flex-1 overflow-y-auto px-1.5 pb-3" id="session-list-container">
        {model.error && <div id="session-list-error" role="alert" className="m-1 rounded-md border border-border-strong bg-panel p-2 text-aux text-foreground">{model.error}</div>}

        {model.visibleGroups.length > 0 && <section className="mb-2">
          <button type="button" id="rail-groups-accordion-trigger" className="flex w-full items-center justify-between px-1.5 py-1 text-overline font-bold uppercase tracking-wide text-muted-foreground" onClick={props.onToggleGroups}>
            <span className="flex items-center gap-1.5"><Users size={12} />{t('rail.groups')} ({model.visibleGroups.length})</span>
            <span aria-hidden="true">{model.isGroupsOpen ? '⌄' : '›'}</span>
          </button>
          <div id="rail-groups-nested-list" className="flex flex-col gap-0.5" style={{ display: model.isGroupsOpen ? 'flex' : 'none' }}>
            {model.visibleGroups.map((group) => <GroupRow
              key={group.roomId}
              group={group}
              profiles={props.groupAvatars || []}
              active={isGroupFocused(focus, group.roomId)}
              editing={props.editingGroupRoomId === group.roomId}
              onSelect={() => props.onSelectGroup(group.roomId)}
              onMenu={(x, y) => props.onOpenGroupMenu(group.roomId, group.name, x, y)}
              onStartRename={() => props.onStartGroupRename(group.roomId)}
              onConfirmRename={(name) => props.onConfirmGroupRename(group.roomId, name)}
              onCancelRename={props.onCancelGroupRename}
            />)}
          </div>
        </section>}

        <section className="mb-2">
          <button type="button" id="rail-sessions-accordion-trigger" className="flex w-full items-center justify-between px-1.5 py-1 text-overline font-bold uppercase tracking-wide text-muted-foreground" onClick={props.onToggleSessions}>
            <span className="flex items-center gap-1.5"><MessageSquare size={12} />{t('rail.conversations')} ({model.activeSessions.length})</span>
            <span aria-hidden="true">{model.isSessionsOpen ? '⌄' : '›'}</span>
          </button>
          <div id="rail-sessions-nested-list" className="flex flex-col gap-0.5" style={{ display: model.isSessionsOpen ? 'flex' : 'none' }}>
            {model.activeSessions.length > 0
              ? model.activeSessions.map((session) => <SessionRow
                key={session.id}
                session={session}
                active={isSessionFocused(focus, session.id)}
                onSelect={() => props.onSelectSession(session.id, session.botName)}
                onMenu={(x, y) => props.onOpenSessionMenu(session.id, session.title, x, y)}
              />)
              : <div className="flex flex-col items-center gap-1 px-2 py-5 text-center">
                <span className="text-aux text-muted-foreground">{model.error ? t('rail.errorTitle') : t('rail.emptyTitle')}</span>
                <span className="text-caption text-faint">{model.error ? t('rail.errorSub') : t('rail.emptySub')}</span>
              </div>}
          </div>
        </section>

        {model.archivedSessions.length > 0 && <section>
          <div className="px-1.5 pb-0.5 pt-2 text-overline font-bold uppercase tracking-wide text-muted-foreground">{t('rail.archived')} ({model.archivedSessions.length})</div>
          <div className="flex flex-col gap-0.5 opacity-65">
            {model.archivedSessions.map((session) => <button
              key={session.id}
              type="button"
              className={`session-item flex min-h-8 items-center rounded-md border px-2 text-left ${isSessionFocused(focus, session.id) ? 'active border-primary bg-card-active' : 'border-transparent hover:bg-card-hover'}`}
              data-id={session.id}
              data-title={session.title}
              data-bot={session.botName || ''}
              onClick={() => props.onSelectSession(session.id, session.botName)}
              onContextMenu={(event) => { event.preventDefault(); props.onOpenSessionMenu(session.id, session.title, event.clientX, event.clientY); }}
            >
              <span className="truncate text-aux text-muted-foreground">{session.title}</span>
            </button>)}
          </div>
        </section>}
      </div>}

      {model.showProjectsDeck && <div id="rail-projects-deck" className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-2 py-1.5">
        <div className="px-1.5 pb-1 text-overline font-bold uppercase tracking-wide text-muted-foreground">{t('rail.projects')}</div>
        {model.visibleProjects.length > 0
          ? model.visibleProjects.map((project) => <ProjectCard
            key={project.id}
            project={project}
            focus={focus}
            onSelectSession={(session) => props.onSelectSession(session.id, session.botName)}
            onSessionMenu={(session, x, y) => props.onOpenSessionMenu(session.id, session.title, x, y)}
          />)
          : <div className="flex flex-col items-center gap-1 px-3 py-8 text-center">
            <Folder size={24} className="text-muted-foreground" />
            <span className="text-body text-muted-foreground">{t('rail.projectsEmpty')}</span>
            <span className="text-caption text-faint">{t('rail.projectsEmptySub')}</span>
          </div>}
      </div>}

    </div>}

    {/* 拖拽把手挂在 aside 直属层级：抽屉自身 overflow: hidden，放在抽屉内会被裁掉，
        导致命中测试落到抽屉上、物理拖拽完全失效（本次实测确认）。 */}
    {!props.collapsed && <div className="rail-resize-handle absolute -right-1 top-0 z-50 h-full w-2 cursor-col-resize touch-none" data-rail-handle="left" role="separator" aria-orientation="vertical" tabIndex={0} title={t('rail.resizeHandleTitle')} onPointerDown={props.onResizeStart} />}
  </aside>;
}
