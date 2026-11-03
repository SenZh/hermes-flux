import * as React from 'react';
import { Folder, MessageSquare, MoreHorizontal, Plus, Search, Users } from 'lucide-react';
import { t } from '../i18n/index.js';

export interface LeftRailSession {
  id: string;
  title: string;
  preview?: string;
  timestamp?: number;
  isArchived?: boolean;
  isPinned?: boolean;
  botName?: string;
  botDisplayName?: string;
  activityState?: 'running' | 'unread' | 'read';
}

export interface LeftRailGroupRoom {
  roomId: string;
  name: string;
  members: string[];
  lastMessage?: string;
  updatedAt?: number;
  createdAt?: number;
  activityState?: 'running' | 'unread' | 'read';
}

export interface LeftRailProject {
  id: string;
  name: string;
  sessions?: LeftRailSession[];
}

export interface LeftRailProfile {
  name: string;
  displayName: string;
  avatar?: string;
  description?: string;
  lastMessage?: string;
  lastTime?: string;
  timestamp?: number;
  isDefault?: boolean;
  activityState?: 'running' | 'unread' | 'read';
}

export type LeftRailActiveFocus =
  | { type: 'bot'; botName: string }
  | { type: 'session'; sessionId: string }
  | { type: 'group'; roomId: string };

export interface LeftRailProps {
  collapsed: boolean;
  activeSessionId: string;
  activeFocus: LeftRailActiveFocus;
  sessions: LeftRailSession[];
  profileName: string;
  profiles: LeftRailProfile[];
  groups: LeftRailGroupRoom[];
  projects: LeftRailProject[];
  activeRailTab: 'chats' | 'projects' | 'groups';
  searchQuery: string;
  isSessionsGroupExpanded: boolean;
  isGroupsGroupExpanded: boolean;
  editingGroupRoomId?: string;
  error?: string;
  onToggleDrawer: () => void;
  onSelectSession: (sessionId: string, botName?: string) => void;
  onSelectBot: (profileName: string) => void;
  onSelectGroup: (roomId: string) => void;
  onOpenSessionMenu: (sessionId: string, title: string, x: number, y: number) => void;
  onOpenBotMenu: (profileName: string, x: number, y: number) => void;
  onOpenGroupMenu: (roomId: string, name: string, x: number, y: number) => void;
  onSearchChange: (value: string) => void;
  onNewChat: () => void;
  onSetTab: (tab: 'chats' | 'projects' | 'groups') => void;
  onToggleSessions: () => void;
  onToggleGroups: () => void;
  onStartGroupRename: (roomId: string) => void;
  onConfirmGroupRename: (roomId: string, name: string) => void;
  onCancelGroupRename: () => void;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export function formatLeftRailTime(timestamp?: number, now = new Date()): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp > 1e11 ? timestamp : timestamp * 1000);
  if (!Number.isFinite(date.getTime())) return '';
  if (date.getFullYear() !== now.getFullYear()) return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  if (date.toDateString() !== now.toDateString()) return `${date.getMonth() + 1}/${date.getDate()}`;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function snippet(text: string | undefined): string {
  return (text || '').replace(/```[\s\S]*?```/g, t('common.codeBlock')).replace(/^#+\s+/gm, '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function avatar(profile: Pick<LeftRailProfile, 'name' | 'displayName' | 'avatar'>, size: 'sm' | 'lg' = 'sm'): React.ReactElement {
  return profile.avatar
    ? <img className={size === 'lg' ? 'size-8 rounded-md object-cover' : 'size-7 rounded-md object-cover'} src={profile.avatar} alt={profile.displayName || profile.name} />
    : <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-md bg-primary-subtle text-primary">✦</span>;
}

function RowTime({ timestamp }: { timestamp?: number }): React.ReactElement | null {
  const value = formatLeftRailTime(timestamp);
  return value ? <time className="shrink-0 pl-2 font-code text-micro text-muted-foreground" dateTime={timestamp ? new Date(timestamp > 1e11 ? timestamp : timestamp * 1000).toISOString() : undefined}>{value}</time> : null;
}

function SessionRow({ session, active, compact, onSelect, onMenu }: {
  session: LeftRailSession;
  active: boolean;
  compact?: boolean;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
}): React.ReactElement {
  const preview = snippet(session.preview) || session.title;
  return <button type="button" className={`group relative flex ${compact ? 'min-h-8' : 'h-12'} w-full items-center rounded-md border px-2 text-left transition-colors ${active ? 'border-primary bg-card-active' : 'border-transparent hover:bg-card-hover'}`} data-session-row="true" data-session-id={session.id} data-session-key={session.id} onClick={onSelect} onContextMenu={(event) => { event.preventDefault(); onMenu(event.clientX, event.clientY); }}>
    {active && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-primary" />}
    <span className="flex min-w-0 flex-1 flex-col justify-center">
      <span className={`truncate text-aux ${active ? 'font-semibold text-foreground' : 'text-foreground'}`}>{session.title}</span>
      {!compact && <span className="truncate text-aux text-muted-foreground">{preview}</span>}
    </span>
    <RowTime timestamp={session.timestamp} />
    {!compact && <span className="ml-1 hidden shrink-0 text-muted-foreground group-hover:inline-flex" aria-hidden="true"><MoreHorizontal size={14} /></span>}
  </button>;
}

/** 左轨只呈现 renderer 提供的快照，所有状态变更经回调返回壳层。 */
export function LeftRail(props: LeftRailProps): React.ReactElement {
  const query = props.searchQuery.trim().toLocaleLowerCase();
  const focusedBot = props.activeFocus.type === 'bot' ? props.activeFocus.botName : props.profileName || 'default';
  const profile = props.profiles.find((item) => item.name.toLowerCase() === focusedBot.toLowerCase())
    || props.profiles.find((item) => item.isDefault)
    || { name: focusedBot, displayName: focusedBot, lastMessage: '', activityState: 'read' as const };
  const isDefault = profile.name.toLowerCase() === 'default';
  const visibleSessions = props.sessions.filter((item) => !item.isArchived && (!item.botName || item.botName.toLowerCase() === profile.name.toLowerCase()) && (!query || `${item.title} ${item.preview || ''} ${item.botName || ''}`.toLowerCase().includes(query)));
  const visibleGroups = props.groups.filter((item) => (isDefault || item.members.some((member) => member.toLowerCase() === profile.name.toLowerCase() || member.toLowerCase() === profile.displayName.toLowerCase())) && (!query || `${item.name} ${item.lastMessage || ''}`.toLowerCase().includes(query)));
  const agents = props.profiles.filter((item) => !item.isDefault && item.name.toLowerCase() !== 'default' && (!query || `${item.displayName} ${item.name} ${item.description || ''}`.toLowerCase().includes(query)));
  const sessionActive = (id: string): boolean => props.activeFocus.type === 'session' && props.activeFocus.sessionId === id;
  const onMenu = (event: React.MouseEvent, callback: (x: number, y: number) => void): void => {
    event.preventDefault();
    callback(event.clientX, event.clientY);
  };

  return <aside id="flux-left-rail" className={`flux-left-rail flex h-full flex-row border-r border-border-subtle bg-sidebar ${props.collapsed ? 'w-[var(--geo-micro-rail)]' : 'w-[var(--rail-w-left,264px)]'}`} data-testid="react-left-rail">
    <div className="flex w-[var(--geo-micro-rail)] shrink-0 flex-col items-center gap-2 border-r border-border-subtle bg-card py-2">
      <button type="button" className={`flex size-9 items-center justify-center rounded-md border ${focusedBot.toLowerCase() === 'default' ? 'border-primary bg-primary-subtle' : 'border-border-subtle bg-card'}`} data-profile="default" data-station-profile="default" title={t('rail.enterBotChat', { name: t('rail.defaultAssistant') })} onClick={() => props.onSelectBot('default')} onContextMenu={(event) => onMenu(event, (x, y) => props.onOpenBotMenu('default', x, y))}>
        {avatar(props.profiles.find((item) => item.isDefault || item.name === 'default') || { name: 'default', displayName: t('rail.defaultAssistant') })}
      </button>
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto py-1">
        {agents.map((agent) => <button key={agent.name} type="button" className={`relative flex size-9 shrink-0 items-center justify-center rounded-md border ${focusedBot.toLowerCase() === agent.name.toLowerCase() ? 'border-primary bg-primary-subtle' : 'border-border-subtle bg-card'}`} data-profile={agent.name} data-station-profile={agent.name} title={t('rail.enterBotChat', { name: agent.displayName })} onClick={() => props.onSelectBot(agent.name)} onContextMenu={(event) => onMenu(event, (x, y) => props.onOpenBotMenu(agent.name, x, y))}>
          {avatar(agent)}{agent.activityState === 'unread' && <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-success" data-status="unread" />}
        </button>)}
      </div>
      <div className="flex w-full flex-col items-center gap-2 border-t border-border-subtle pt-2">
        <button type="button" className="flex size-9 items-center justify-center rounded-md bg-panel text-secondary-foreground" title={t('rail.groups')} onClick={() => props.onSetTab(props.activeRailTab === 'groups' ? 'chats' : 'groups')}><Users size={15} /></button>
        <button type="button" className="flex size-9 items-center justify-center rounded-md bg-panel text-secondary-foreground" title={t('rail.projects')} onClick={() => props.onSetTab(props.activeRailTab === 'projects' ? 'chats' : 'projects')}><Folder size={15} /></button>
        <button type="button" className="flex size-9 items-center justify-center rounded-md border border-dashed border-border text-foreground" title={t('rail.newChat')} onClick={props.onNewChat}><Plus size={15} /></button>
        <button type="button" className="flex size-8 items-center justify-center text-muted-foreground" title={t('titlebar.toggleLeftRail')} onClick={props.onToggleDrawer} aria-label={t('titlebar.toggleLeftRail')}>›</button>
      </div>
    </div>
    {!props.collapsed && <div className="flux-context-drawer flex min-w-0 flex-1 flex-col overflow-hidden bg-sidebar">
      <div className="flex flex-col gap-2 p-2.5 pb-1.5">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={13} />
          <input id="session-search-input" className="h-8 w-full rounded-md border border-border-subtle bg-panel pl-7 pr-2 text-aux text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring" placeholder={t('rail.searchPlaceholder')} value={props.searchQuery} onChange={(event) => props.onSearchChange(event.currentTarget.value)} />
        </label>
        <button type="button" className={`rail-primary-agent-card flex min-h-12 items-center gap-2 rounded-lg border px-2 text-left ${props.activeFocus.type === 'bot' && props.activeFocus.botName === profile.name ? 'active border-primary bg-card-active' : 'border-border-subtle bg-panel'}`} data-primary-bot={profile.name} data-profile={profile.name} title={t('rail.enterBotChat', { name: profile.displayName })} onClick={() => props.onSelectBot(profile.name)} onContextMenu={(event) => onMenu(event, (x, y) => props.onOpenBotMenu(profile.name, x, y))}>
          {avatar(profile, 'lg')}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-aux font-semibold text-foreground">{profile.displayName || profile.name}</span>
            <span className="truncate text-aux text-muted-foreground">{snippet(profile.lastMessage || profile.description) || t('rail.defaultBotSnippet')}</span>
          </span>
          <RowTime timestamp={profile.timestamp} />
        </button>
      </div>
      <div className="session-scroll-area min-h-0 flex-1 overflow-y-auto px-1.5 pb-3" id="session-list-container">
        {(props.activeRailTab === 'chats' || props.activeRailTab === 'groups') && <>
          {props.error && <div role="alert" className="m-1 rounded-md border border-border-strong bg-panel p-2 text-aux text-foreground">{props.error}</div>}
          {visibleGroups.length > 0 && <section className="mb-2">
            <button type="button" id="rail-groups-accordion-trigger" className="flex w-full items-center justify-between px-1.5 py-1 text-overline font-bold uppercase tracking-wide text-muted-foreground" onClick={props.onToggleGroups}><span>{t('rail.groups')} ({visibleGroups.length})</span><span>{props.isGroupsGroupExpanded ? '⌄' : '›'}</span></button>
            {props.isGroupsGroupExpanded && <div className="flex flex-col gap-0.5">{visibleGroups.map((group) => <div key={group.roomId} className={`rail-group-item group flex min-h-10 items-center rounded-md border px-2 ${props.activeFocus.type === 'group' && props.activeFocus.roomId === group.roomId ? 'active border-primary bg-card-active' : 'border-transparent hover:bg-card-hover'}`} data-room-id={group.roomId}>
              {props.editingGroupRoomId === group.roomId ? <RenameGroup initialName={group.name} roomId={group.roomId} onConfirm={props.onConfirmGroupRename} onCancel={props.onCancelGroupRename} /> : <>
                <button type="button" className="flex min-w-0 flex-1 flex-col text-left" onClick={() => props.onSelectGroup(group.roomId)} onContextMenu={(event) => onMenu(event, (x, y) => props.onOpenGroupMenu(group.roomId, group.name, x, y))}>
                  <span className="truncate text-aux text-foreground">{group.name}<RowTime timestamp={group.updatedAt || group.createdAt} /></span>
                  <span className="truncate text-aux text-muted-foreground">{snippet(group.lastMessage) || t('rail.groupsMembers', { count: String(group.members.length) })}</span>
                </button>
                <button type="button" className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label={t('rail.groupActions')} onClick={() => props.onStartGroupRename(group.roomId)}><MoreHorizontal size={14} /></button>
              </>}
            </div>)}</div>}
          </section>}
          {props.activeRailTab !== 'groups' && <section className="mb-2">
            <button type="button" id="rail-sessions-accordion-trigger" className="flex w-full items-center justify-between px-1.5 py-1 text-overline font-bold uppercase tracking-wide text-muted-foreground" onClick={props.onToggleSessions}><span>{t('rail.conversations')} ({visibleSessions.length})</span><span>{props.isSessionsGroupExpanded ? '⌄' : '›'}</span></button>
            {props.isSessionsGroupExpanded && <div className="flex flex-col gap-0.5">{visibleSessions.length ? visibleSessions.map((session) => <SessionRow key={session.id} session={session} active={sessionActive(session.id)} onSelect={() => props.onSelectSession(session.id, { botName: session.botName } as never)} onMenu={(x, y) => props.onOpenSessionMenu(session.id, session.title, x, y)} />) : <p className="px-2 py-5 text-center text-aux text-muted-foreground">{props.error || t('rail.emptyTitle')}</p>}</div>}
          </section>}
        </>}
        {props.activeRailTab === 'projects' && <section className="flex flex-col gap-1.5 p-1">{props.projects.map((project) => <details key={project.id} className="project-accordion-unit overflow-hidden rounded-lg border border-border-subtle bg-card"><summary className="project-accordion-trigger flex cursor-pointer items-center gap-2 p-2 text-aux font-semibold"><Folder size={14} /><span className="truncate">{project.name}</span><span className="ml-auto text-muted-foreground">{project.sessions?.length || 0}</span></summary><div className="project-accordion-nested flex flex-col gap-0.5 px-2 pb-2">{project.sessions?.map((session) => <SessionRow key={session.id} session={session} compact active={sessionActive(session.id)} onSelect={() => props.onSelectSession(session.id)} onMenu={(x, y) => props.onOpenSessionMenu(session.id, session.title, x, y)} />)}</div></details>)}{props.projects.length === 0 && <p className="p-6 text-center text-aux text-muted-foreground">{t('rail.projectsEmpty')}</p>}</section>}
      </div>
      <div className="rail-resize-handle absolute -right-1 top-0 z-50 h-full w-2 cursor-col-resize touch-none" data-rail-handle="left" role="separator" aria-orientation="vertical" tabIndex={0} onPointerDown={props.onResizeStart} />
    </div>}
  </aside>;
}

function RenameGroup({ initialName, roomId, onConfirm, onCancel }: {
  initialName: string;
  roomId: string;
  onConfirm: (roomId: string, name: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [value, setValue] = React.useState(initialName);
  return <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={(event) => { event.preventDefault(); onConfirm(roomId, value.trim()); }}>
    <input id={`rail-group-rename-input-${roomId}`} className="h-7 min-w-0 flex-1 rounded border border-primary bg-panel px-1.5 text-aux text-foreground outline-none" value={value} onChange={(event) => setValue(event.currentTarget.value)} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onCancel(); } }} autoFocus />
    <button type="submit" className="rounded bg-primary px-2 py-1 text-micro text-primary-foreground" title={t('common.confirm')}>{t('common.confirm')}</button>
    <button type="button" className="rounded px-1 py-1 text-micro text-muted-foreground" title={t('common.cancel')} onClick={onCancel}>{t('common.cancel')}</button>
  </form>;
}
