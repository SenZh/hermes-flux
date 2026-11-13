import * as React from 'react';
import { Layers, Plus, Search, Users } from 'lucide-react';
import { t } from '../i18n/index.js';
import { useMotionPresence } from '../motion/index.js';
import { Button } from './primitives/Button.js';
import { Input } from './primitives/Input.js';
import { Skeleton } from './primitives/Skeleton.js';
import { ActivityIndicator, type ActivityEntityKind } from './primitives/ActivityIndicator.js';
import type { ActivityIndicatorVariant } from '../tokens/activityIndicator.js';
import { renderBotAvatar, renderGroupCollageAvatar } from '../utils/botAvatar.js';
import {
  formatLeftRailTime,
  isBotFocused,
  isAgentScopeActive,
  isGroupFocused,
  isSessionFocused,
  toSnippet,
  type ActivityTransition,
  type LeftRailGroupRoom,
  type LeftRailModel,
  type LeftRailProfile,
  type LeftRailSession,
} from './leftRailModel.js';

export interface LeftRailProps {
  model: LeftRailModel;
  collapsed: boolean;
  searchQuery: string;
  editingGroupRoomId?: string;
  /** 左轨会话指示器动效变体（默认为 cloud 积雨流云点阵）。 */
  activityVariant?: ActivityIndicatorVariant;
  /** 群聊拼图头像的成员资产来源；缺省时回退确定性字母块，不影响行可用性。 */
  groupAvatars?: LeftRailProfile[];
  onSelectSession: (sessionId: string, botName?: string) => void;
  onSelectBot: (profileName: string) => void;
  onSelectGroup: (roomId: string) => void;
  onOpenSessionMenu: (sessionId: string, title: string, x: number, y: number) => void;
  onOpenBotMenu: (profileName: string, x: number, y: number) => void;
  onOpenGroupMenu: (roomId: string, name: string, x: number, y: number) => void;
  onSearchChange: (value: string) => void;
  /** PR-3d：新建入口按甲板分型，会话 header 传 session、群聊 header 传 group。 */
  onNewChat: (kind: 'session' | 'group') => void;
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
 * 微轨 Agent 骨架的几何类。
 * 【约束与规则 (Rules)】必须与 AgentStationItem 的 42px 站点卡逐像素一致，
 * 直接复用同一个字面量，数据到达时不得产生布局跳动。
 */
// gate-theme-allow: 与 AgentStationItem 的 42px 站点卡逐像素对齐，骨架→真实卡不得跳动
const STATION_SKELETON_CLASS = 'size-[42px] shrink-0 rounded-panel';

/** 微轨 Agent 按钮单一实现，消灭大总管与其他 Agent 的双标分裂 */
const AgentStationItem = React.memo(function AgentStationItem({
  agent,
  active,
  activityVariant,
  onClick,
  onContextMenu,
}: {
  agent: LeftRailProfile;
  active: boolean;
  activityVariant?: ActivityIndicatorVariant;
  onClick: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}): React.ReactElement {
  return <Button
    variant="ghost"
    size="icon"
    className={`station-agent-badge rail-pinned-bot-row relative size-[42px] shrink-0 rounded-panel border p-0 transition-all duration-150 ${active ? 'active border-primary bg-primary-subtle' : 'border-transparent bg-transparent hover:bg-card-hover/70'}`}
    data-profile={agent.name}
    data-station-profile={agent.name}
    title={t('rail.enterBotChat', { name: agent.displayName || agent.name })}
    onClick={onClick}
    onContextMenu={onContextMenu}
  >
    <Avatar profile={agent} size={36} />
    <ActivityIndicator
      state={agent.activityState}
      transition={agent.activityTransition}
      transitionToken={agent.activityTransitionToken}
      placement="corner"
      entityKind="bot"
      variant={activityVariant}
    />
  </Button>;
}, (prev, next) => prev.agent === next.agent && prev.active === next.active && prev.activityVariant === next.activityVariant);

/**
 * 左侧实体行通用组件 (RailEntityRow)。
 * 设计意图 (Why)：普通会话、群聊会话与 Agent 主工位卡片在抽屉中垂直并列展示，
 *   必须保持 100% 相同的高度、内边距、圆角与排版字阶（以普通会话为基准），消除视觉错位与样式分叉。
 * 约束与规则 (Rules)：
 *   1. 尺寸与间距以普通会话为基准（min-h-12, px-2, py-1.5, gap-2, 标题副标题间距 gap-1.5）；
 *   2. 支持可选头像（avatar?: React.ReactNode），普通会话不传，群聊与 Agent 传入相应头像；
 *   3. 状态与交互遵循无边框纯对比色（active 为 bg-card-active，未选中为透明）。
 */
export interface RailEntityRowProps {
  className?: string;
  active: boolean;
  compact?: boolean;
  avatar?: React.ReactNode;
  title: string;
  subtitle?: string;
  timestamp?: number;
  timeFallback?: string;
  activityState?: LeftRailSession['activityState'];
  activityTransition?: ActivityTransition;
  activityTransitionToken?: number;
  entityKind?: ActivityEntityKind;
  activityVariant?: ActivityIndicatorVariant;
  titleAttr?: string;
  /**
   * 骨架占位行。
   * 【设计意图 (Why)】骨架必须与真实行共用同一个行组件，几何与字阶才有单一真值；
   *   自建第二条同构 DOM 就是样式漂移的开始（48px vs 实测 52px）。
   * 【约束与规则 (Rules)】loading 时禁用点击、不渲染时间与活动点，仅保留头像槽位与两条占位条。
   */
  loading?: boolean;
  /** 骨架行的 data-skeleton 标记（仅 loading 时输出），供探针区分会话行与主工位卡。 */
  skeletonSlot?: string;
  onClick?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  dataAttributes?: Record<string, string>;
}

export function RailEntityRow({
  className = '',
  active,
  compact,
  avatar,
  title,
  subtitle,
  timestamp,
  timeFallback,
  activityState,
  activityTransition,
  activityTransitionToken,
  entityKind,
  activityVariant,
  titleAttr,
  loading = false,
  skeletonSlot = 'session',
  onClick,
  onContextMenu,
  dataAttributes,
}: RailEntityRowProps): React.ReactElement {
  return <button
    type="button"
    disabled={loading}
    aria-busy={loading}
    className={`${className} group relative flex w-full items-center gap-2 rounded-card px-2 py-1.5 text-left transition-colors duration-150 ${compact ? 'min-h-8' : 'min-h-12'} ${loading ? '' : active ? 'active bg-card-active text-foreground' : 'hover:bg-card-hover/80 text-secondary-foreground hover:text-foreground'}`}
    title={titleAttr}
    onClick={loading ? undefined : onClick}
    onContextMenu={loading ? undefined : onContextMenu}
    {...(loading ? { 'data-skeleton': skeletonSlot } : dataAttributes)}
  >
    {avatar && <span aria-hidden="true" className="shrink-0 flex items-center justify-center">{avatar}</span>}
    {loading
      ? <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* h-5 / h-4 对齐真实行的 text-body(19px) 与 text-aux(16px) 行盒，骨架→真实行不跳动。 */}
        <Skeleton className="h-5 w-2/3 rounded-pill" />
        <Skeleton className="h-4 w-1/2 rounded-pill" />
      </span>
      : <span className="flux-rail-entity-col flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate text-body font-medium leading-snug text-foreground">{title}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <ActivityIndicator
              state={activityState}
              transition={activityTransition}
              transitionToken={activityTransitionToken}
              placement="inline"
              entityKind={entityKind}
              variant={activityVariant}
            />
            <RowTime timestamp={timestamp} fallback={timeFallback} />
          </span>
        </span>
        {!compact && subtitle && (
          <span className="truncate text-aux font-normal leading-snug text-muted-foreground/90">{subtitle}</span>
        )}
      </span>}
  </button>;
}

/**
 * 会话行（消费统一的 RailEntityRow 组件）。
 * 普通会话不支持头像，样式完全作为全局统一基准。
 */
const SessionRow = React.memo(function SessionRow({ session, active, compact, activityVariant, onSelect, onMenu }: {
  session: LeftRailSession;
  active: boolean;
  compact?: boolean;
  activityVariant?: ActivityIndicatorVariant;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
}): React.ReactElement {
  const subtitle = toSnippet(session.preview) || toSnippet(session.title);
  return <RailEntityRow
    className="session-item"
    active={active}
    compact={compact}
    title={session.title}
    subtitle={subtitle}
    timestamp={session.timestamp}
    timeFallback={session.time}
    activityState={session.activityState}
    activityTransition={session.activityTransition}
    activityTransitionToken={session.activityTransitionToken}
    entityKind="session"
    activityVariant={activityVariant}
    onClick={onSelect}
    onContextMenu={(event) => { event.preventDefault(); onMenu(event.clientX, event.clientY); }}
    dataAttributes={{
      'data-id': session.id,
      'data-title': session.title,
      'data-bot': session.botName || '',
    }}
  />;
}, (prev, next) => prev.session === next.session && prev.active === next.active && prev.compact === next.compact && prev.activityVariant === next.activityVariant);

/**
 * 群聊行（消费统一的 RailEntityRow 组件）。
 * 传入多人拼贴头像 CollageAvatar，其余尺寸排版与普通会话 100% 对齐。
 */
const GroupRow = React.memo(function GroupRow({ group, profiles, active, editing, activityVariant, onSelect, onMenu, onConfirmRename, onCancelRename }: {
  group: LeftRailGroupRoom;
  profiles: LeftRailProfile[];
  active: boolean;
  editing: boolean;
  activityVariant?: ActivityIndicatorVariant;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
  onStartRename: () => void;
  onConfirmRename: (name: string) => void;
  onCancelRename: () => void;
}): React.ReactElement {
  if (editing) {
    return <div className="rail-group-item rail-group-inline-rename-wrap active min-h-12 rounded-card bg-card-active px-2" data-room-id={group.roomId}>
      <RenameGroup initialName={group.name} roomId={group.roomId} onConfirm={onConfirmRename} onCancel={onCancelRename} />
    </div>;
  }
  const subtitle = toSnippet(group.lastMessage) || t('rail.groupsMembers', { count: String(group.members.length) });
  return <RailEntityRow
    className="rail-group-item"
    active={active}
    avatar={<CollageAvatar members={group.members} profiles={profiles} size={36} />}
    title={group.name}
    subtitle={subtitle}
    timestamp={group.updatedAt || group.createdAt}
    activityState={group.activityState}
    activityTransition={group.activityTransition}
    activityTransitionToken={group.activityTransitionToken}
    entityKind="group"
    activityVariant={activityVariant}
    onClick={onSelect}
    onContextMenu={(event) => { event.preventDefault(); onMenu(event.clientX, event.clientY); }}
    dataAttributes={{
      'data-room-id': group.roomId,
    }}
  />;
}, (prev, next) => prev.group === next.group && prev.profiles === next.profiles && prev.active === next.active && prev.editing === next.editing && prev.activityVariant === next.activityVariant);

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
      className="rail-group-rename-input h-7 min-w-0 flex-1 rounded-inner border-primary bg-panel px-1.5 text-aux"
      value={value}
      onChange={(event) => setValue(event.currentTarget.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onCancel(); } }}
      autoFocus
    />
    <Button type="submit" size="sm" className="btn-confirm-group-rename h-6 rounded-inner px-2 text-micro" title={t('common.confirm')}>{t('common.confirm')}</Button>
    <Button type="button" variant="ghost" size="sm" className="btn-cancel-group-rename h-6 rounded-inner px-1 text-micro text-muted-foreground" title={t('common.cancel')} onClick={onCancel}>{t('common.cancel')}</Button>
  </form>;
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
  /** Agent 域未就绪：微轨与主工位卡只出骨架，任何默认助理身份都不得出现。 */
  const profilesLoading = model.profilesPhase === 'loading';
  /** 会话域未就绪：会话区只出骨架行，"暂无历史会话"是数据到达后才能下的结论。 */
  const sessionsLoading = model.sessionsPhase === 'loading';
  const drawerPresence = useMotionPresence(!props.collapsed);
  // 微轨几何：内层微轨无条件补偿 1px 右边框 —— border-box 下该边框会吃掉内容区 1px，
  // 否则 42px 站点卡在（真值 clamp(58px, 4.2vw, 72px) 减 1px）的内容区里左右留白各差 0.5px。
  // fallback 与 :root 真值一致，避免变量缺失时退回旧值造成几何漂移。
  // 内外层必须引用同一常量，禁止第二条同构写法。
  const microRailWidth = 'calc(var(--geo-micro-rail, clamp(58px, 4.2vw, 72px)) + 1px)';
  const railWidth = props.collapsed ? microRailWidth : 'var(--rail-w-left, 264px)';

  const activeSessionBotName = focus.type === 'session'
    ? model.activeSessions.find((s) => s.id === focus.sessionId)?.botName
    : undefined;
  const isAgentActive = (name: string): boolean => isAgentScopeActive({
    agentName: name,
    focus,
    selectedAgentName: model.selectedAgent.name,
    activeSessionBotName,
  });

  const openBotMenu = (event: React.MouseEvent, name: string): void => {
    event.preventDefault();
    props.onOpenBotMenu(name, event.clientX, event.clientY);
  };

  return <aside
    id="flux-left-rail"
    className={`flux-left-rail relative flex h-full flex-row border-r border-border-subtle bg-sidebar overflow-hidden ${props.collapsed ? 'rail-collapsed' : ''}`}
    style={{ flex: `0 0 ${railWidth}`, width: railWidth, minWidth: railWidth, maxWidth: railWidth }}
    data-testid="react-left-rail"
  >
    <div id="flux-station-rail" className="flex shrink-0 flex-col items-center gap-2 border-r border-border-subtle bg-sidebar py-2.5" style={{ width: microRailWidth }} aria-busy={profilesLoading}>
      {profilesLoading ? <>
        {/* 与真实结构同形：首卡在滚动区外，其余在 flex-1 滚动区内，骨架不得让布局跳动。 */}
        <Skeleton slot="agent" className={STATION_SKELETON_CLASS} />
        <div className="station-agents-scroll flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Skeleton slot="agent" className={STATION_SKELETON_CLASS} />
          <Skeleton slot="agent" className={STATION_SKELETON_CLASS} />
        </div>
      </> : <>
        <AgentStationItem
          agent={model.defaultAgent}
          active={isAgentActive(model.defaultAgent.name)}
          activityVariant={props.activityVariant}
          onClick={() => props.onSelectBot('default')}
          onContextMenu={(event) => openBotMenu(event, 'default')}
        />
        <div className="station-agents-scroll flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {model.otherAgents.map((agent) => <AgentStationItem
            key={agent.name}
            agent={agent}
            active={isAgentActive(agent.name)}
            activityVariant={props.activityVariant}
            onClick={() => props.onSelectBot(agent.name)}
            onContextMenu={(event) => openBotMenu(event, agent.name)}
          />)}
        </div>
      </>}
      {/* 微轨底部导航区整体拔除（用户 2026-11-13 定案）。
          PR-3d 曾删掉"新建会话 +"与"‹ 折叠"；本次再删群聊 Users 与工程项目 Folder 两个入口。
          依据：群聊/会话本就并列渲染在同一抽屉里，群聊入口只做"切回聊天甲板"的复位动作，
          是同一状态的第二实现；项目甲板暂无可用数据源，留着只有空态。
          入口收编去向：群聊 ➔ 抽屉内"群聊"分节；折叠 ➔ 顶栏 PanelLeft 与 Ctrl+B。
          群聊 running/unread 汇总信号随按钮一并移除，抽屉内群聊行仍各自保留角标。 */}
    </div>

    {drawerPresence.isMounted && <div
      className="flux-context-drawer flex min-w-0 flex-1 flex-col overflow-hidden bg-sidebar"
      {...drawerPresence.motionProps}
    >
      <div className="flex flex-col gap-2 p-2.5 pb-1.5">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70" size={13} />
          <Input
            id="session-search-input"
            className="h-8 rounded-card border border-border-subtle bg-panel/70 pl-8 pr-2.5 text-aux transition-colors placeholder:text-muted-foreground/50 hover:border-border focus:border-primary/40 focus:bg-panel"
            placeholder={t('rail.searchPlaceholder')}
            value={props.searchQuery}
            onChange={(event) => props.onSearchChange(event.currentTarget.value)}
          />
        </label>
        {profilesLoading
          ? <RailEntityRow
            active={false}
            loading
            skeletonSlot="agent-card"
            avatar={<Skeleton className="size-9 shrink-0 rounded-pill" />}
            title=""
          />
          : <RailEntityRow
            className="rail-pinned-bot-row rail-primary-agent-card"
            active={isBotFocused(focus, profile.name)}
            avatar={<Avatar profile={profile} size={36} />}
            title={profile.displayName || profile.name}
            subtitle={toSnippet(profile.lastMessage || profile.description) || t('rail.defaultBotSnippet')}
            timestamp={profile.timestamp}
            timeFallback={profile.lastTime}
            activityState={profile.activityState}
            activityTransition={profile.activityTransition}
            activityTransitionToken={profile.activityTransitionToken}
            entityKind="bot"
            activityVariant={props.activityVariant}
            titleAttr={t('rail.enterBotChat', { name: profile.displayName || profile.name })}
            onClick={() => props.onSelectBot(profile.name)}
            onContextMenu={(event) => openBotMenu(event, profile.name)}
            dataAttributes={{
              'data-primary-bot': profile.name,
              'data-profile': profile.name,
            }}
          />}
      </div>

      <div className="session-scroll-area min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 mr-[var(--geo-resize-handle)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" id="session-list-container">
        {model.error && <div id="session-list-error" role="alert" className="m-1 rounded-card border border-border-strong bg-panel p-2 text-aux text-foreground">{model.error}</div>}

        {model.visibleGroups.length > 0 && <section className="mb-2">
          {/* PR-3d 用户定案：header 字号行高放大一档，删 ⌄/› 文本箭头（折叠态由列表显隐与点击整行表达），
              右侧 + 为新建群聊入口；计数徽标沿用既有 visibleGroups.length，非新增数据面。 */}
          <div className="flex w-full items-center justify-between gap-1 px-2 py-1 text-muted-foreground hover:text-foreground transition-colors mb-1">
            <button type="button" id="rail-groups-accordion-trigger" className="flex min-h-7 min-w-0 flex-1 items-center gap-2.5 text-left text-body font-semibold transition-colors" onClick={props.onToggleGroups}>
              <Users size={13} className="opacity-75 shrink-0" />
              <span>{t('rail.groups')}</span>
            </button>
            <Button variant="ghost" size="icon" className="rail-new-group-btn relative size-6 shrink-0 rounded p-0 text-muted-foreground hover:bg-card-hover hover:text-foreground transition-colors after:absolute after:-inset-1.5 after:content-['']" title={t('rail.newGroup')} aria-label={t('rail.newGroup')} onClick={() => props.onNewChat('group')}>
              <Plus size={13} />
            </Button>
          </div>
          <div id="rail-groups-nested-list" className="flex flex-col gap-2" style={{ display: model.isGroupsOpen ? 'flex' : 'none' }}>
            {model.visibleGroups.map((group) => <GroupRow
              key={group.roomId}
              group={group}
              profiles={props.groupAvatars || []}
              active={isGroupFocused(focus, group.roomId)}
              editing={props.editingGroupRoomId === group.roomId}
              activityVariant={props.activityVariant}
              onSelect={() => props.onSelectGroup(group.roomId)}
              onMenu={(x, y) => props.onOpenGroupMenu(group.roomId, group.name, x, y)}
              onStartRename={() => props.onStartGroupRename(group.roomId)}
              onConfirmRename={(name) => props.onConfirmGroupRename(group.roomId, name)}
              onCancelRename={props.onCancelGroupRename}
            />)}
          </div>
        </section>}

        <section className="mb-2">
          {/* 会话 header 同构：放大字号、删箭头、右侧 + 新建会话（复用 NewTaskModal solo 态）。 */}
          <div className="flex w-full items-center justify-between gap-1 px-2 py-1 text-muted-foreground hover:text-foreground transition-colors mb-1">
            <button type="button" id="rail-sessions-accordion-trigger" className="flex min-h-7 min-w-0 flex-1 items-center gap-2.5 text-left text-body font-semibold transition-colors" onClick={props.onToggleSessions}>
              <Layers size={13} className="opacity-75 shrink-0" />
              <span>{t('rail.conversations')}</span>
            </button>
            <Button variant="ghost" size="icon" className="rail-new-session-btn relative size-6 shrink-0 rounded p-0 text-muted-foreground hover:bg-card-hover hover:text-foreground transition-colors after:absolute after:-inset-1.5 after:content-['']" title={t('rail.newChat')} aria-label={t('rail.newChat')} onClick={() => props.onNewChat('session')}>
              <Plus size={13} />
            </Button>
          </div>
          <div id="rail-sessions-nested-list" className="flex flex-col gap-2" style={{ display: model.isSessionsOpen ? 'flex' : 'none' }}>
            {sessionsLoading
              ? <>{[0, 1, 2, 3].map((slot) => <RailEntityRow key={`session-skeleton-${slot}`} className="session-item" active={false} loading title="" />)}</>
              : model.activeSessions.length > 0
                ? model.activeSessions.map((session) => <SessionRow
                  key={session.id}
                  session={session}
                  active={isSessionFocused(focus, session.id)}
                  activityVariant={props.activityVariant}
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
            {model.archivedSessions.map((session) => <RailEntityRow
              key={session.id}
              className="session-item"
              active={isSessionFocused(focus, session.id)}
              compact
              title={session.title}
              onClick={() => props.onSelectSession(session.id, session.botName)}
              onContextMenu={(event) => { event.preventDefault(); props.onOpenSessionMenu(session.id, session.title, event.clientX, event.clientY); }}
              dataAttributes={{
                'data-id': session.id,
                'data-title': session.title,
                'data-bot': session.botName || '',
              }}
            />)}
          </div>
        </section>}
      </div>

    </div>}

    {/* 拖拽把手挂在 aside 直属层级：抽屉自身 overflow: hidden，放在抽屉内会被裁掉，
        导致命中测试落到抽屉上、物理拖拽完全失效（本次实测确认）。
        宽度与 hover 高亮一律由 styles.css 的 --geo-resize-handle 真值源驱动，组件内禁止再写宽度或偏移类；
        right-0 让把手完整落在轨道内，与右轨对称（历史坑：骑跨边界使蓝带视觉加宽）。
        滚动容器以 mr-[var(--geo-resize-handle)] 让出把手带：全局滚动条宽恰为 6px，若与把手全量重叠，
        pointer capture 会劫走滑块拖拽（双审 P1 命中竞态），滚动条必须落在把手带之外。 */}
    {!props.collapsed && <div className="rail-resize-handle absolute right-0 top-0 z-50 h-full cursor-col-resize touch-none" data-rail-handle="left" role="separator" aria-orientation="vertical" tabIndex={0} title={t('rail.resizeHandleTitle')} onPointerDown={props.onResizeStart} />}
  </aside>;
}
