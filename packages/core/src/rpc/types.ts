/**
 * JSON-RPC 2.0 & Hermes Protocol Type Definitions
 */

export interface JsonRpcRequest<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: T;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcNotification<T = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: T;
}

export type GatewayEventName =
  | 'session.created'
  | 'session.updated'
  | 'session.deleted'
  | 'stream.token'
  | 'stream.thought'
  | 'tool.start'
  | 'tool.output'
  | 'tool.finish'
  | 'intervention.request'
  | 'intervention.resolved'
  | 'gateway.heartbeat';

export interface StreamTokenEvent {
  sessionId: string;
  messageId: string;
  delta: string;
  index: number;
  timestamp: number;
}

export interface StreamThoughtEvent {
  sessionId: string;
  messageId: string;
  delta: string;
  timestamp: number;
}

export interface ToolStartEvent {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  timestamp: number;
}

export interface ToolOutputEvent {
  sessionId: string;
  toolCallId: string;
  delta: string;
  timestamp: number;
}

export interface SessionItemPayload {
  id: string;
  title?: string;
  model?: string;
  started_at?: number | string;
  last_active?: number | string;
  created_at?: number | string;
  preview?: string;
  archived?: boolean;
}

export interface SessionListResult {
  sessions?: SessionItemPayload[];
  data?: SessionItemPayload[];
}

export interface ModelProviderOption {
  provider?: string;
  id?: string;
  models?: Array<string | { id: string; name?: string }>;
}

export interface ModelDetail {
  id: string;
  provider: string;
  name: string;
  displayName: string;
  contextLength?: number;
}

export interface ModelOptionsResult {
  model?: string;
  models?: string[];
  providers?: ModelProviderOption[];
  data?: Array<string | { id: string; name?: string }>;
}

export interface AgentProfile {
  name: string;
  displayName: string;
  description?: string;
  avatar?: string;
  model?: string;
  isDefault?: boolean;
}

export interface NormalizedSession {
  id: string;
  title: string;
  model: string;
  time: string;
  preview: string;
  isArchived: boolean;
  timestamp: number;
}

