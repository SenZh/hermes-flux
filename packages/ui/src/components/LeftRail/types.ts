/**
 * 左轨共享类型与输入契约（纯类型模块，零运行时依赖）。
 *
 * 设计意图 (Why)：抽屉与微轨的输入形状必须只有一份定义，React 组件、壳层快照与视图模型共用它。
 * 防范的历史坑 (Pitfall)：这些类型曾与 873 行字符串模板同居一个文件，模板迁移后类型也被迫留在僵尸文件里。
 * 约束与规则 (Rules)：本模块只放类型；任何渲染或派生逻辑请放 leftRailModel.ts 或 React 组件。
 */

export type ActivityState = 'running' | 'unread' | 'read';

/** 完成瞬态跃迁标记：用于列表行或状态点在刚完成时播放一次收敛动画 */
export type ActivityTransition = 'none' | 'just-completed';

export interface LeftRailSession {
  id: string;
  title: string;
  preview?: string;
  time?: string;
  timestamp?: number;
  isArchived?: boolean;
  isPinned?: boolean;
  botName?: string;
  botDisplayName?: string;
  botAvatar?: string;
  activityState?: ActivityState;
  activityTransition?: ActivityTransition;
  activityTransitionToken?: number;
}

export interface LeftRailGroupRoom {
  roomId: string;
  name: string;
  members: string[];
  lastMessage?: string;
  updatedAt?: number;
  createdAt?: number;
  activityState?: ActivityState;
  activityTransition?: ActivityTransition;
  activityTransitionToken?: number;
}

export interface LeftRailProject {
  id: string;
  name: string;
  path?: string;
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
  activityState?: ActivityState;
  activityTransition?: ActivityTransition;
  activityTransitionToken?: number;
}

export type LeftRailActiveFocus =
  | { type: 'bot'; botName: string }
  | { type: 'session'; sessionId: string }
  | { type: 'group'; roomId: string };

export type LeftRailTab = 'chats' | 'projects' | 'groups';
