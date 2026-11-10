/**
 * 对话区视图模型（表现层只读契约）
 *
 * 设计意图(Why)：
 *   对话区只消费已成形数据，不解析事件、不推断业务类型；字段缺失时降级为骨架。
 *
 * 约束与规则(Rules)：
 *   1. 所有字段由宿主提供，组件内不得调用 RPC、读写全局 Store；
 *   2. 顺序即真相：按 messages 给定顺序渲染，不排序、不去重；
 *   3. 缺失即降级：不得用正文相似度或时间戳补造身份。
 */

import type { MessageDisplayKind, MessageDisplayMetadata } from '@hermes-flux/core';
import type { DataPhase } from '../loadPhase.js';

export type ConversationMode = 'scratchpad' | 'foreground' | 'group';
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';
export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error' | 'interrupted';

export interface ConversationToolVM {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed';
  args: string;
  output?: string;
  durationMs?: number;
  /** tool.start 到达时的本地毫秒时间戳；运行中据此实时累加，complete 后以 durationMs 为准 */
  startedAt?: number;
}

export interface ConversationMessageVM {
  id: string;
  rowId?: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sender?: string;
  senderAvatar?: string;
  model?: string;
  thought?: string;
  thoughtDurationMs?: number;
  durationMs?: number;
  timestamp?: string;
  status?: MessageStatus;
  isStreaming?: boolean;
  toolCalls?: ConversationToolVM[];
  /**
   * 网关显示类型。缺失即 'user'（真实人类正文）。
   *
   * 【设计意图 (Why)】网关把换模型、后台进程回执、当中插话等信令与人类正文存在同一列，
   *   靠 display_kind 区分。表现层据此决定画气泡、画时间线标记，还是整行跳过。
   *
   * 【约束与规则 (Rules)】未知值必须按 'user' 显示，严禁静默隐藏用户消息。
   */
  displayKind?: MessageDisplayKind;
  /** 窄化后的展示元数据，仅时间线类事件使用。 */
  displayMetadata?: MessageDisplayMetadata;
}

export interface ContextUsageVM {
  used: number;
  max: number;
  percent: number;
}

export interface ConversationSnapshot {
  mode: ConversationMode;
  connection: ConnectionStatus;
  messages: ConversationMessageVM[];
  /**
   * 窗口内容在虚拟坐标中的纵向偏移（px）。
   * 【设计意图 (Why)】窗口只挂载一部分消息时，原生滚动条只反映已挂载部分，
   *   长会话滚动时 thumb 长度与位置会剧烈跳动。把内容绝对定位到"起点 × 平均行高"处，
   *   容器高度固定为"总条数 × 平均行高"，scrollHeight 恒定，滚动条才稳定。
   * 【约束与规则 (Rules)】由宿主按实测平均行高计算，组件不得自算。
   */
  contentOffsetPx?: number;
  /** 虚拟总高度（px）= 总条数 × 平均行高；仅在消息数超过窗口容量时由宿主提供。 */
  virtualHeightPx?: number;
  /** 整个会话真实读写过的文件；必须由宿主按完整消息集合计算，不能随窗口收缩。 */
  knownFiles?: readonly string[];
  /** 当前语言标识；纳入行组件比较，切换语言后已挂载消息也要重新渲染。 */
  locale?: string;
  isStreaming: boolean;
  /**
   * 当前会话历史的到达相位。
   *
   * 【设计意图 (Why)】宿主在清空视口到历史落地之间必须声明 loading，视图才能用骨架占位；
   *   否则这段空窗会被渲染成"开始新的对话"的空态，等于向用户断言会话是空的。
   *
   * 【约束与规则 (Rules)】缺省 ready：旧调用方行为不变；只有本帧没有任何消息时才出骨架。
   */
  messagesPhase?: DataPhase;
  hasOlderMessages?: boolean;
  isLoadingOlder?: boolean;
  profileName?: string;
  contextUsage?: ContextUsageVM;
  emptyTitle?: string;
  emptyHint?: string;
}

export interface ConversationActions {
  onCopyMessage?: (messageId: string) => void;
  onRollbackMessage?: (messageId: string) => void;
  onForkMessage?: (messageId: string) => void;
  onLoadOlder?: () => void;
}
