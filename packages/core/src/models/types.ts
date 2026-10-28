/**
 * Domain Models for Hermes Aura
 */

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  isArchived: boolean;
  model: string;
  reasoningLevel: 'off' | 'low' | 'medium' | 'high';
  approvalMode: 'auto' | 'ask' | 'sandbox';
  unreadCount?: number;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thought?: string;
  toolCalls?: ToolExecution[];
  createdAt: number;
  isStreaming?: boolean;
}

export interface ToolExecution {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
  output?: string;
  status: 'running' | 'completed' | 'failed';
  durationMs?: number;
}

export interface ArtifactItem {
  id: string;
  title: string;
  type: 'code' | 'diff' | 'browser' | 'doc';
  language?: string;
  content: string;
  timestamp: number;
}
