/**
 * Agent 在场与语气状态机领域（Agent Presence Manager）
 *
 * 【设计意图 (Why)】
 *   将 Agent 在场状态派生、语气档跨层计算、React 协调指纹比对、
 *   单聊/群聊身份归一化以及节拍器启停调度从庞大的 renderer/index.ts 中完全剥离。
 *   使在场与语气总线成为独立、纯净、脱离浏览器 DOM 抓取的纯状态领域。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 指纹污染：指纹绝不包含 sinceMs 与正文，否则流式每帧都触发 React 协调重排；
 *   2. 时钟串域：群聊回合走独立本地锚点，严禁借用单聊会话的 turnStartedAt；
 *   3. 会话串时：写入 turnStartedAt 时必须校验会话归属，切会话后旧时长绝不借用；
 *   4. 节拍空转：仅在非 idle 状态运行节拍器，进入 idle / 终态后必须立即清除定时器。
 *
 * 【约束与规则 (Rules)】
 *   - 纯逻辑领域，通过 AgentPresenceHost 显式注入宿主上下文；
 *   - 指纹与渲染共用同一份 pendingSnapshot，保证数据时刻严格一致。
 */

import {
  type AgentPresence,
  type AgentProfile,
  type NormalizedSession,
  deriveAgentPresence,
  presenceTone,
} from '@hermes-flux/core';
import {
  type AgentPresenceSnapshot,
  type LeftRailGroupRoom,
  type MessageViewModel,
} from '@hermes-flux/ui';

export interface SideAgentCapsule {
  kind: string;
  status: string;
  profile?: string;
}

export interface AgentPresenceHost {
  activeFocus: { type: string; botName?: string; roomId?: string };
  activeSessionId: string;
  activeRunningGroupRoomIds: ReadonlySet<string>;
  isStreamingActiveForCurrentSession: () => boolean;
  messages: readonly MessageViewModel[];
  sideAgentCapsules: readonly SideAgentCapsule[];
  presenceTerminal?: { kind: 'failed' | 'interrupted'; message?: string } | null;
  turnStartedAt?: number;
  profiles: readonly AgentProfile[];
  sessions: readonly NormalizedSession[];
  groupRooms: readonly LeftRailGroupRoom[];
  profileName: string;
  lang: string;
  presenceLayout?: 'stage' | 'dock';
  activeGroupSpeaker?: string | null;
  resolveAgentAvatar: (name: string) => string | undefined;
  isGroupConversationActive: () => boolean;
  onUpdateReact?: () => void;
}

export const PRESENCE_TICK_MS = 1_000;

/** 序列化快照指纹辅助工具 */
function snapshotFingerprint(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return `__unserializable_${Date.now()}_${Math.random()}`;
  }
}

/**
 * 在场快照指纹。
 *
 * 【设计意图 (Why)】流式期间宿主每帧都在 `render()`；若每帧都 `root.render()`，
 *   React 会把整棵指示器子树重新协调一次（眨眼时钟所在的组件也被反复调用），
 *   白白吃掉主线程预算。与 `lastTitlebarSnapshotJson` 同一手法，只把影响呈现的字段编进指纹。
 *
 * 【约束与规则 (Rules)】
 *   1. 指纹必须覆盖 presence.kind / 语气档 / 目标 / 失败原因 / 身份 / 说话者 / 成员数 / locale；
 *   2. 刻意不包含 sinceMs：它每毫秒都在变，进了指纹等于关掉去重；
 *      语气档（tone）已经承载了「时长是否跨档」这一唯一可感知变化；
 *   3. 不可序列化时降级为每次都推送。
 */
function agentPresenceFingerprint(snapshot: AgentPresenceSnapshot): string {
  const { presence, identity, locale } = snapshot;
  const detail =
    presence.kind === 'tool'
      ? `tool:${presence.tool}:${presence.target}:${presence.runningCount}`
      : presence.kind === 'delegating'
        ? `delegating:${presence.profile}:${presence.count}`
        : presence.kind === 'failed'
          ? `failed:${presence.message}`
          : presence.kind;

  const identityKey =
    identity.kind === 'group'
      ? `group:${identity.speaker ?? '-'}:${identity.members.length}:${identity.members.join(',')}:${identity.profiles.length}`
      : `solo:${identity.name}:${identity.displayName ?? ''}:${identity.avatar ?? ''}`;

  return snapshotFingerprint({
    kind: presence.kind,
    tone: presenceTone(presence),
    detail,
    identityKey,
    locale,
    layout: snapshot.layout ?? 'stage',
  });
}

/** 当前焦点域的「是否正在跑回合」与所属群聊房间。 */
function resolvePresenceDomain(host: AgentPresenceHost): { groupRoomId: string | null; isRunning: boolean } {
  const groupRoomId = host.activeFocus.type === 'group' ? host.activeFocus.roomId || null : null;
  return {
    groupRoomId,
    isRunning: groupRoomId
      ? host.activeRunningGroupRoomIds.has(groupRoomId)
      : host.isStreamingActiveForCurrentSession(),
  };
}

/** 维护群聊回合时钟。 */
function ensureGroupTurnClock(
  groupRoomId: string | null,
  isRunning: boolean,
  currentClock?: number
): number | undefined {
  if (!groupRoomId || !isRunning) {
    return undefined;
  }
  return typeof currentClock === 'number' ? currentClock : Date.now();
}

/** 按在场状态启停节拍器。 */
function ensurePresenceTicker(
  kind: AgentPresence['kind'],
  currentTimer: ReturnType<typeof setInterval> | null,
  onTick: () => void
): ReturnType<typeof setInterval> | null {
  const shouldRun = kind !== 'idle';
  if (shouldRun && !currentTimer) {
    return setInterval(onTick, PRESENCE_TICK_MS);
  }
  if (!shouldRun && currentTimer) {
    clearInterval(currentTimer);
    return null;
  }
  return currentTimer;
}

/** 当前会话所属 Agent 的展示身份。 */
function resolvePresenceSoloIdentity(host: AgentPresenceHost): {
  name: string;
  displayName?: string;
  avatar?: string;
} {
  const focus = host.activeFocus;
  const activeSession = host.sessions.find((s) => s.id === host.activeSessionId);
  const name =
    (focus.type === 'bot' ? focus.botName : '') ||
    activeSession?.botName ||
    host.profileName ||
    'default';

  const profile = host.profiles.find(
    (p) =>
      p.name.toLowerCase() === name.toLowerCase() ||
      (p.displayName && p.displayName.toLowerCase() === name.toLowerCase()),
  );

  return {
    name,
    displayName: profile?.displayName || activeSession?.botDisplayName || undefined,
    avatar: profile?.avatar || activeSession?.botAvatar || host.resolveAgentAvatar(name) || undefined,
  };
}

/** 当前群聊房间的成员身份。 */
function resolvePresenceGroupIdentity(host: AgentPresenceHost): {
  members: string[];
  profiles: Array<{ name: string; displayName?: string; avatar?: string }>;
} | null {
  const focus = host.activeFocus;
  const roomId = focus.type === 'group' ? focus.roomId : host.activeSessionId;
  const room = host.groupRooms.find((g) => g.roomId === roomId);
  if (!room) return null;
  const members = Array.isArray(room.members) ? room.members.filter((m) => typeof m === 'string' && m.length > 0) : [];
  if (members.length === 0) return null;
  return {
    members,
    profiles: host.profiles.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      avatar: p.avatar || host.resolveAgentAvatar(p.name) || undefined,
    })),
  };
}

/** 构造在场指示器快照。 */
function buildAgentPresenceSnapshot(
  host: AgentPresenceHost,
  turnStartedSessionId: string | null = null,
  groupTurnStartedAt?: number
): AgentPresenceSnapshot {
  const now = Date.now();
  const domain = resolvePresenceDomain(host);
  const isStreaming = domain.isRunning;

  let lastAssistant: MessageViewModel | null = null;
  for (let i = host.messages.length - 1; i >= 0; i -= 1) {
    if (host.messages[i].role === 'assistant') {
      lastAssistant = host.messages[i];
      break;
    }
  }

  const pendingDelegations = host.sideAgentCapsules.filter(
    (capsule) => capsule.kind === 'delegation' && capsule.status === 'pending',
  );

  const terminal = host.presenceTerminal;
  const presence: AgentPresence = deriveAgentPresence({
    isStreaming,
    message: lastAssistant
      ? {
          thought: lastAssistant.thought,
          content: lastAssistant.content,
          toolCalls: (lastAssistant.toolCalls ?? []).map((call) => ({
            name: call.name,
            status: call.status,
            args: call.args,
          })),
        }
      : null,
    activeSubagents: pendingDelegations.length,
    subagentProfile: pendingDelegations[0]?.profile,
    lastError: terminal?.kind === 'failed' ? terminal.message : undefined,
    interrupted: terminal?.kind === 'interrupted',
    turnStartedAt: domain.groupRoomId
      ? groupTurnStartedAt
      : turnStartedSessionId === host.activeSessionId
        ? host.turnStartedAt
        : undefined,
    now,
  });

  const groupIdentity = host.isGroupConversationActive() ? resolvePresenceGroupIdentity(host) : null;
  const identity: AgentPresenceSnapshot['identity'] = groupIdentity
    ? {
        kind: 'group',
        members: groupIdentity.members,
        speaker: domain.isRunning ? (host.activeGroupSpeaker ?? null) : null,
        profiles: groupIdentity.profiles,
      }
    : { kind: 'solo', ...resolvePresenceSoloIdentity(host) };

  return {
    presence,
    identity,
    locale: host.lang,
    layout: host.presenceLayout,
  };
}

/** 集中式 Agent 在场与语气状态机管理器 */
class AgentPresenceManager {
  private host: AgentPresenceHost;
  public pendingPresenceSnapshot: AgentPresenceSnapshot | null = null;
  public lastAgentPresenceFingerprint: string = '';
  public presenceTickerTimer: ReturnType<typeof setInterval> | null = null;
  public groupTurnStartedAt: number | undefined;
  public turnStartedSessionId: string | null = null;

  constructor(host: AgentPresenceHost) {
    this.host = host;
  }

  public setHost(host: AgentPresenceHost): void {
    this.host = host;
  }

  public setTurnStartedSessionId(sessionId: string | null): void {
    this.turnStartedSessionId = sessionId;
  }

  public resolvePresenceDomain(): { groupRoomId: string | null; isRunning: boolean } {
    return resolvePresenceDomain(this.host);
  }

  public ensureGroupTurnClock(groupRoomId: string | null, isRunning: boolean): void {
    this.groupTurnStartedAt = ensureGroupTurnClock(groupRoomId, isRunning, this.groupTurnStartedAt);
  }

  public ensurePresenceTicker(kind: AgentPresence['kind']): void {
    this.presenceTickerTimer = ensurePresenceTicker(kind, this.presenceTickerTimer, () => {
      this.syncAgentPresence();
    });
  }

  public resolvePresenceSoloIdentity() {
    return resolvePresenceSoloIdentity(this.host);
  }

  public resolvePresenceGroupIdentity() {
    return resolvePresenceGroupIdentity(this.host);
  }

  public buildAgentPresenceSnapshot(): AgentPresenceSnapshot {
    return buildAgentPresenceSnapshot(this.host, this.turnStartedSessionId, this.groupTurnStartedAt);
  }

  public getAgentPresenceSnapshot(): AgentPresenceSnapshot {
    if (!this.pendingPresenceSnapshot) {
      this.pendingPresenceSnapshot = this.buildAgentPresenceSnapshot();
    }
    return this.pendingPresenceSnapshot;
  }

  public syncAgentPresence(): void {
    const domain = this.resolvePresenceDomain();
    this.ensureGroupTurnClock(domain.groupRoomId, domain.isRunning);
    this.pendingPresenceSnapshot = this.buildAgentPresenceSnapshot();
    const snapshot = this.pendingPresenceSnapshot;
    const fingerprint = agentPresenceFingerprint(snapshot);
    this.ensurePresenceTicker(snapshot.presence.kind);
    if (fingerprint === this.lastAgentPresenceFingerprint) return;
    this.lastAgentPresenceFingerprint = fingerprint;
    this.host.onUpdateReact?.();
  }

  public dispose(): void {
    if (this.presenceTickerTimer) {
      clearInterval(this.presenceTickerTimer);
      this.presenceTickerTimer = null;
    }
    this.pendingPresenceSnapshot = null;
    this.lastAgentPresenceFingerprint = '';
  }
}

export {
  snapshotFingerprint,
  agentPresenceFingerprint,
  resolvePresenceDomain,
  ensureGroupTurnClock,
  ensurePresenceTicker,
  resolvePresenceSoloIdentity,
  resolvePresenceGroupIdentity,
  buildAgentPresenceSnapshot,
  AgentPresenceManager,
};
