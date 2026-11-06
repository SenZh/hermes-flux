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
  isStreaming: boolean;
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
