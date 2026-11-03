/**
 * 左轨视图模型（纯函数，无 React、无 DOM）。
 *
 * 设计意图 (Why)：左轨的"呈现什么"是一套可穷举的派生子集（焦点解析 → 上下文隔离 → 搜索过滤 → 时间倒序），
 * 与"怎么画"彻底分层。模型定居此处后，React 组件只做映射，测试可直接对派生结果断言，无需切片字符串。
 * 防范的历史坑 (Pitfall)：模板时代把派生逻辑与 900 行 HTML 揉在同一函数里，任何改版都必须靠 substring 断言，
 * 一度出现"断言通过但界面错"的假绿。
 * 约束与规则 (Rules)：本模块禁止 import react / DOM；禁止推测数据管道（主工位卡数据仍由 core 的
 * botActivitySync 供给，这里只做展示层选择与排序）。
 */

import { t } from '../i18n/index.js';
import type {
  ActivityState,
  LeftRailActiveFocus,
  LeftRailGroupRoom,
  LeftRailProfile,
  LeftRailProject,
  LeftRailSession,
  LeftRailTab,
} from '../components/LeftRail/types.js';

export type {
  ActivityState,
  LeftRailActiveFocus,
  LeftRailGroupRoom,
  LeftRailProfile,
  LeftRailProject,
  LeftRailSession,
  LeftRailTab,
};

export interface LeftRailModelInput {
  activeSessionId: string;
  activeFocus?: LeftRailActiveFocus;
  sessions: LeftRailSession[];
  profileName: string;
  profiles: LeftRailProfile[];
  groups: LeftRailGroupRoom[];
  projects: LeftRailProject[];
  activeRailTab: LeftRailTab;
  searchQuery: string;
  isSessionsGroupExpanded?: boolean;
  isGroupsGroupExpanded?: boolean;
  error?: string;
}export interface LeftRailModel {
  currentFocus: LeftRailActiveFocus;
  selectedAgent: LeftRailProfile;
  isDefaultHq: boolean;
  defaultAgent: LeftRailProfile;
  otherAgents: LeftRailProfile[];
  activeSessions: LeftRailSession[];
  archivedSessions: LeftRailSession[];
  visibleGroups: LeftRailGroupRoom[];
  visibleProjects: LeftRailProject[];
  isSessionsOpen: boolean;
  isGroupsOpen: boolean;
  hasRunningGroup: boolean;
  hasUnreadGroup: boolean;
  /** 当前抽屉视图是否呈现项目卡片甲板 */
  showProjectsDeck: boolean;
  /** 当前抽屉视图是否呈现会话/群聊列表 */
  showChatDeck: boolean;
  error: string;
}

/**
 * 骨架清洗：把消息正文压成单行摘要。
 * 设计意图 (Why)：副标题的扫描价值是"快速定位聊到哪"，必须抹掉代码块与 Markdown 标题噪音。
 */
export function toSnippet(text: string | undefined, maxLen = 32): string {
  if (!text) return '';
  const cleaned = text
    .replace(/```[\s\S]*?```/g, t('common.codeBlock'))
    .replace(/^#+\s+/gm, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.length <= maxLen ? cleaned : `${cleaned.slice(0, maxLen)}...`;
}

/**
 * 紧凑时间：当日 HH:mm、同年跨日 M/D、跨年 YYYY/M/D。
 * 设计意图 (Why)：行内时间只承担"多久以前"的定位，钉在右缘后宽度必须可预测。
 * 防范的历史坑 (Pitfall)：曾用"昨天 16:20"这类两段式，把右侧时间列撑宽到挤掉标题。
 * 约束与规则 (Rules)：纯算术格式化，禁止 Intl / toLocaleString（渲染热路径）。
 */
export function formatLeftRailTime(timestamp?: number, now: Date = new Date()): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp > 1e11 ? timestamp : timestamp * 1000);
  if (!Number.isFinite(date.getTime())) return '';
  if (date.getFullYear() !== now.getFullYear()) {
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  }
  if (date.toDateString() !== now.toDateString()) {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 会话归属判定：Default 中枢持有通用会话，专职 Bot 只持有自身名下会话。 */
function belongsToAgent(session: LeftRailSession, agent: LeftRailProfile, isDefaultHq: boolean): boolean {
  const botName = (session.botName || 'default').toLowerCase();
  if (isDefaultHq) return botName === 'default' || !session.botName;
  const botDisplay = (session.botDisplayName || '').toLowerCase();
  const agentDisplay = (agent.displayName || '').toLowerCase();
  return botName === agent.name.toLowerCase() || (Boolean(agentDisplay) && botDisplay === agentDisplay);
}

/** 群聊归属判定：Default 中枢是主大厅，专职 Bot 只列自己参与的群。 */
function groupBelongsToAgent(group: LeftRailGroupRoom, agent: LeftRailProfile, isDefaultHq: boolean): boolean {
  if (isDefaultHq) return true;
  const members = (group.members || []).map((m) => m.toLowerCase());
  return members.includes(agent.name.toLowerCase())
    || Boolean(agent.displayName) && members.includes((agent.displayName || '').toLowerCase());
}

function matchesQuery(query: string, ...fields: Array<string | undefined>): boolean {
  if (!query) return true;
  return fields.some((field) => (field || '').toLowerCase().includes(query));
}

/**
 * 从壳层的原始快照派生抽屉与微轨的完整视图模型。
 * 【约束与规则】纯函数；同样的输入必须给出逐字节一致的排序结果（排序键包含稳定兜底）。
 */
export function buildLeftRailModel(input: LeftRailModelInput): LeftRailModel {
  const query = (input.searchQuery || '').toLowerCase().trim();
  const error = (input.error || '').trim();
  const profiles = input.profiles || [];
  const sessions = input.sessions || [];
  const groups = input.groups || [];
  const projects = input.projects || [];
  const activeRailTab = input.activeRailTab || 'chats';

  const currentFocus: LeftRailActiveFocus = input.activeFocus
    || (input.activeSessionId
      ? { type: 'session', sessionId: input.activeSessionId }
      : { type: 'bot', botName: input.profileName || 'default' });

  const activeSession = sessions.find((s) => s.id === input.activeSessionId);
  const currentAgentName = currentFocus.type === 'bot'
    ? currentFocus.botName
    : currentFocus.type === 'session'
      ? (activeSession?.botName || input.profileName || 'default')
      : (input.profileName || 'default');

  const selectedAgent: LeftRailProfile = profiles.find((p) => p.name.toLowerCase() === currentAgentName.toLowerCase())
    || profiles.find((p) => p.isDefault)
    || {
      name: currentAgentName,
      displayName: currentAgentName === 'default' ? t('rail.defaultAssistant') : currentAgentName,
      avatar: '',
      lastMessage: '',
      lastTime: '',
      activityState: 'read',
    };

  const defaultAgent: LeftRailProfile = profiles.find((p) => p.isDefault || p.name.toLowerCase() === 'default')
    || {
      name: 'default',
      displayName: t('rail.defaultAssistant'),
      avatar: '',
      activityState: 'read',
    };

  const isDefaultHq = selectedAgent.name.toLowerCase() === 'default';
  const byNewest = <T extends { timestamp?: number }>(a: T, b: T): number => (b.timestamp || 0) - (a.timestamp || 0);
  const byRoomUpdated = (a: LeftRailGroupRoom, b: LeftRailGroupRoom): number =>
    (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);

  const scoped = sessions.filter((s) => belongsToAgent(s, selectedAgent, isDefaultHq));
  const activeSessions = scoped
    .filter((s) => !s.isArchived && matchesQuery(query, s.title, s.preview))
    .sort(byNewest);
  const archivedSessions = scoped
    .filter((s) => Boolean(s.isArchived) && matchesQuery(query, s.title))
    .sort(byNewest);

  const visibleGroups = groups
    .filter((g) => groupBelongsToAgent(g, selectedAgent, isDefaultHq))
    .filter((g) => matchesQuery(query, g.name, g.lastMessage))
    .sort(byRoomUpdated);

  const otherAgents = profiles
    .filter((p) => !p.isDefault && p.name.toLowerCase() !== 'default')
    .filter((p) => matchesQuery(query, p.displayName, p.name, p.description, p.lastMessage))
    .sort(byNewest);

  const visibleProjects = projects
    .filter((p) => matchesQuery(query, p.name))
    .map((p) => ({
      ...p,
      sessions: (p.sessions || []).filter((s) => matchesQuery(query, s.title, s.preview)),
    }));

  const showProjectsDeck = activeRailTab === 'projects';
  return {
    currentFocus,
    selectedAgent,
    isDefaultHq,
    defaultAgent,
    otherAgents,
    activeSessions,
    archivedSessions,
    visibleGroups,
    visibleProjects,
    isSessionsOpen: input.isSessionsGroupExpanded !== false,
    isGroupsOpen: input.isGroupsGroupExpanded !== false,
    hasRunningGroup: visibleGroups.some((g) => g.activityState === 'running'),
    hasUnreadGroup: visibleGroups.some((g) => g.activityState === 'unread'),
    showProjectsDeck,
    showChatDeck: !showProjectsDeck,
    error,
  };
}

/** 焦点归属判定：用于行高亮与激活指示条，避免组件内出现三重 if 链。 */
export function isSessionFocused(focus: LeftRailActiveFocus, sessionId: string): boolean {
  return focus.type === 'session' && focus.sessionId === sessionId;
}

export function isGroupFocused(focus: LeftRailActiveFocus, roomId: string): boolean {
  return focus.type === 'group' && focus.roomId === roomId;
}

export function isBotFocused(focus: LeftRailActiveFocus, botName: string): boolean {
  return focus.type === 'bot' && focus.botName.toLowerCase() === botName.toLowerCase();
}
