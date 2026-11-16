/**
 * 左轨实体装饰与快照管理领域（Left Rail Snapshot Manager）
 *
 * 【设计意图 (Why)】
 *   将左轨微轨+抽屉的会话、群聊与 Agent 实体装饰、WeakMap 引用指纹复用、
 *   状态机过渡动画 Token 映射与快照判等逻辑从 `renderer/index.ts` 中完全解耦。
 *   实现零 DOM 依赖的纯数据流与缓存投影层，使左轨 42+ 个复杂实体在高频状态变迁
 *   （如流式 token 逐帧刷新、心跳探测、搜索过滤）下的引用稳定性可被单测直接验证。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 必须使用源对象 + 渲染字段复合指纹：会话的 preview 与 timestamp 会原地被改写，
 *      如果只做初次缓存会导致标题和副标题无法更新；
 *   2. 数组引用稳定性：元素全等时复用前序数组引用，防止 React.memo 在深层对比时全部击穿；
 *   3. 三态隔离：会话、群聊、Agent 的未读/运行中状态严格按集合隔离，禁止跨域冒泡。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯 TypeScript 领域模块，禁止任何 DOM 或平台特定 API 调用；
 *   2. 依赖项与外部状态全部通过 LeftRailSnapshotHost 注入；
 *   3. 严禁 `as any`，类型严格推导。
 */

import {
  buildLeftRailModel,
  type LeftRailSession,
  type LeftRailGroupRoom,
  type LeftRailProfile,
  type LeftRailActiveFocus,
  type LeftRailSnapshot,
  type ActivityTransition,
  type ActivityIndicatorVariant,
  type DataPhase,
} from '@hermes-flux/ui';

import {
  resolveActivityState,
  type NormalizedSession,
  type AgentProfile,
  type ActivityState,
} from '@hermes-flux/core';

export interface RailDecorCacheEntry<T> {
  stamp: string;
  value: T;
}

export interface LeftRailSnapshotInputs {
  sessions: LeftRailSession[];
  groups: LeftRailGroupRoom[];
  profiles: LeftRailProfile[];
  activeSessionId: string;
  activeFocus: LeftRailActiveFocus;
  profileName: string;
  searchQuery: string;
  isSessionsGroupExpanded: boolean;
  isGroupsGroupExpanded: boolean;
  error: string;
  collapsed: boolean;
  editingGroupRoomId?: string;
  profilesPhase: DataPhase;
  sessionsPhase: DataPhase;
  activityVariant: ActivityIndicatorVariant;
}

export interface LeftRailSnapshotHost {
  readonly getSessions: () => readonly NormalizedSession[];
  readonly getGroupRooms: () => readonly LeftRailGroupRoom[];
  readonly getProfiles: () => readonly AgentProfile[];
  readonly getActiveSessionId: () => string;
  readonly getActiveFocus: () => LeftRailActiveFocus;
  readonly getProfileName: () => string;
  readonly getSearchQuery: () => string;
  readonly isSessionsGroupExpanded: () => boolean;
  readonly isGroupsGroupExpanded: () => boolean;
  readonly getError: () => string;
  readonly isCollapsed: () => boolean;
  readonly getEditingGroupRoomId: () => string | undefined;
  readonly getProfilesPhase: () => DataPhase;
  readonly getSessionsPhase: () => DataPhase;
  readonly getActivityVariant: () => ActivityIndicatorVariant;
  readonly getActiveRunningSessionIds: () => ReadonlySet<string>;
  readonly getUnreadSessionIds: () => ReadonlySet<string>;
  readonly getActiveStreamingStoredSessionId: () => string | null;
  readonly getActiveRunningGroupRoomIds: () => ReadonlySet<string>;
  readonly getUnreadGroupRoomIds: () => ReadonlySet<string>;
  readonly getActiveRunningBotNames: () => ReadonlySet<string>;
  readonly getUnreadBotNames: () => ReadonlySet<string>;
  readonly resolveAgentAvatar: (name?: string) => string;
  readonly resolveTransition: (
    scope: 'session' | 'bot' | 'group',
    id: string,
    state: ActivityState,
    now: number
  ) => { transition: ActivityTransition; transitionToken?: number };
}

/** 元素引用完全一致时复用旧数组，保证行组件收到的数组 prop 也稳定。 */
export function stableArray<T>(next: T[], previous: T[]): T[] {
  return next.length === previous.length && next.every((item, index) => item === previous[index])
    ? previous
    : next;
}

export function sameLeftRailInputs(
  prev: LeftRailSnapshotInputs,
  next: LeftRailSnapshotInputs
): boolean {
  return (
    prev.sessions === next.sessions &&
    prev.groups === next.groups &&
    prev.profiles === next.profiles &&
    prev.activeSessionId === next.activeSessionId &&
    prev.activeFocus === next.activeFocus &&
    prev.profileName === next.profileName &&
    prev.searchQuery === next.searchQuery &&
    prev.isSessionsGroupExpanded === next.isSessionsGroupExpanded &&
    prev.isGroupsGroupExpanded === next.isGroupsGroupExpanded &&
    prev.error === next.error &&
    prev.collapsed === next.collapsed &&
    prev.profilesPhase === next.profilesPhase &&
    prev.sessionsPhase === next.sessionsPhase &&
    prev.activityVariant === next.activityVariant &&
    prev.editingGroupRoomId === next.editingGroupRoomId
  );
}

export class LeftRailSnapshotManager {
  private railSessionDecorCache = new WeakMap<NormalizedSession, RailDecorCacheEntry<LeftRailSession>>();
  private railGroupDecorCache = new WeakMap<LeftRailGroupRoom, RailDecorCacheEntry<LeftRailGroupRoom>>();
  private railProfileDecorCache = new WeakMap<AgentProfile, RailDecorCacheEntry<LeftRailProfile>>();

  private lastDecoratedSessions: LeftRailSession[] = [];
  private lastDecoratedGroups: LeftRailGroupRoom[] = [];
  private lastDecoratedProfiles: LeftRailProfile[] = [];

  private lastLeftRailSnapshot: LeftRailSnapshot | null = null;
  private lastLeftRailInputs: LeftRailSnapshotInputs | null = null;

  constructor(private readonly host: LeftRailSnapshotHost) {}

  public decorateSessions(nowMs: number): LeftRailSession[] {
    const rawSessions = this.host.getSessions();
    const runningIds = this.host.getActiveRunningSessionIds();
    const unreadIds = this.host.getUnreadSessionIds();
    const streamingId = this.host.getActiveStreamingStoredSessionId();

    const next = rawSessions.map((s) => {
      const activityState = resolveActivityState(s.id, {
        runningIds,
        unreadIds,
        streamingId,
      });
      const transitionRes = this.host.resolveTransition('session', s.id, activityState, nowMs);
      const activityTransition: ActivityTransition = transitionRes.transition;
      const activityTransitionToken = transitionRes.transitionToken;
      const cached = this.railSessionDecorCache.get(s);

      if (
        cached &&
        cached.value.title === s.title &&
        cached.value.preview === s.preview &&
        cached.value.time === s.time &&
        cached.value.timestamp === s.timestamp &&
        cached.value.isArchived === s.isArchived &&
        cached.value.isPinned === s.pinned &&
        cached.value.botName === s.botName &&
        cached.value.botDisplayName === s.botDisplayName &&
        cached.value.botAvatar === s.botAvatar &&
        cached.value.activityState === activityState &&
        cached.value.activityTransition === activityTransition &&
        cached.value.activityTransitionToken === activityTransitionToken
      ) {
        return cached.value;
      }
      const value: LeftRailSession = {
        ...s,
        isPinned: s.pinned,
        activityState,
        activityTransition,
        activityTransitionToken,
      };
      this.railSessionDecorCache.set(s, { stamp: '', value });
      return value;
    });

    this.lastDecoratedSessions = stableArray(next, this.lastDecoratedSessions);
    return this.lastDecoratedSessions;
  }

  public decorateGroups(nowMs: number): LeftRailGroupRoom[] {
    const rawGroups = this.host.getGroupRooms();
    const runningIds = this.host.getActiveRunningGroupRoomIds();
    const unreadIds = this.host.getUnreadGroupRoomIds();

    const next = rawGroups.map((g) => {
      const activityState = resolveActivityState(g.roomId, {
        runningIds,
        unreadIds,
      });
      const transitionRes = this.host.resolveTransition('group', g.roomId, activityState, nowMs);
      const activityTransition: ActivityTransition = transitionRes.transition;
      const activityTransitionToken = transitionRes.transitionToken;
      const stamp = [
        g.name,
        (g.members || []).join('\u0002'),
        g.lastMessage,
        g.updatedAt,
        g.createdAt,
        activityState,
        activityTransition,
        activityTransitionToken ?? '',
      ].join('\u0001');

      const cached = this.railGroupDecorCache.get(g);
      if (cached && cached.stamp === stamp) return cached.value;

      const value: LeftRailGroupRoom = {
        ...g,
        activityState,
        activityTransition,
        activityTransitionToken,
      };
      this.railGroupDecorCache.set(g, { stamp, value });
      return value;
    });

    this.lastDecoratedGroups = stableArray(next, this.lastDecoratedGroups);
    return this.lastDecoratedGroups;
  }

  public decorateProfiles(nowMs: number): LeftRailProfile[] {
    const rawProfiles = this.host.getProfiles();
    const runningIds = this.host.getActiveRunningBotNames();
    const unreadIds = this.host.getUnreadBotNames();

    const next = rawProfiles.map((p) => {
      const avatar =
        p.avatar ||
        this.host.resolveAgentAvatar(p.name) ||
        (p.displayName ? this.host.resolveAgentAvatar(p.displayName) : '') ||
        '';
      const activityState = resolveActivityState(p.name, {
        runningIds,
        unreadIds,
      });
      const transitionRes = this.host.resolveTransition('bot', p.name, activityState, nowMs);
      const activityTransition: ActivityTransition = transitionRes.transition;
      const activityTransitionToken = transitionRes.transitionToken;
      const stamp = [
        p.name,
        p.displayName,
        avatar,
        p.description,
        p.lastMessage,
        p.lastTime,
        p.timestamp,
        p.isDefault ? 1 : 0,
        activityState,
        activityTransition,
        activityTransitionToken ?? '',
      ].join('\u0001');

      const cached = this.railProfileDecorCache.get(p);
      if (cached && cached.stamp === stamp) return cached.value;

      const value: LeftRailProfile = {
        ...p,
        avatar,
        activityState,
        activityTransition,
        activityTransitionToken,
      };
      this.railProfileDecorCache.set(p, { stamp, value });
      return value;
    });

    this.lastDecoratedProfiles = stableArray(next, this.lastDecoratedProfiles);
    return this.lastDecoratedProfiles;
  }

  public getSnapshot(): LeftRailSnapshot {
    const nowMs = Date.now();
    const sessions = this.decorateSessions(nowMs);
    const groups = this.decorateGroups(nowMs);
    const profiles = this.decorateProfiles(nowMs);

    const inputs: LeftRailSnapshotInputs = {
      sessions,
      groups,
      profiles,
      activeSessionId: this.host.getActiveSessionId(),
      activeFocus: this.host.getActiveFocus(),
      profileName: this.host.getProfileName(),
      searchQuery: this.host.getSearchQuery(),
      isSessionsGroupExpanded: this.host.isSessionsGroupExpanded(),
      isGroupsGroupExpanded: this.host.isGroupsGroupExpanded(),
      error: this.host.getError(),
      collapsed: this.host.isCollapsed(),
      editingGroupRoomId: this.host.getEditingGroupRoomId(),
      profilesPhase: this.host.getProfilesPhase(),
      sessionsPhase: this.host.getSessionsPhase(),
      activityVariant: this.host.getActivityVariant(),
    };

    if (
      this.lastLeftRailSnapshot &&
      this.lastLeftRailInputs &&
      sameLeftRailInputs(this.lastLeftRailInputs, inputs)
    ) {
      return this.lastLeftRailSnapshot;
    }

    this.lastLeftRailInputs = inputs;
    this.lastLeftRailSnapshot = {
      model: buildLeftRailModel({
        activeSessionId: inputs.activeSessionId,
        activeFocus: inputs.activeFocus,
        sessions,
        profileName: inputs.profileName,
        profiles,
        groups,
        searchQuery: inputs.searchQuery,
        isSessionsGroupExpanded: inputs.isSessionsGroupExpanded,
        isGroupsGroupExpanded: inputs.isGroupsGroupExpanded,
        profilesPhase: inputs.profilesPhase,
        sessionsPhase: inputs.sessionsPhase,
        error: inputs.error,
      }),
      collapsed: inputs.collapsed,
      searchQuery: inputs.searchQuery,
      editingGroupRoomId: inputs.editingGroupRoomId,
      groupAvatars: profiles,
      activityVariant: inputs.activityVariant,
    };

    return this.lastLeftRailSnapshot;
  }
}
