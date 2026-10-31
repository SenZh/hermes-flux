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
  lastMessage?: string;
  lastTime?: string;
  isDefault?: boolean;
  /** 网关是否已为该 Bot 上传头像资产（profiles.list 的 has_avatar） */
  hasAvatar?: boolean;
  /**
   * 网关侧的 UI 元数据透传（原样保留，禁止在归一化层裁剪）。
   *
   * 【设计意图 (Why)】
   * 官方桌面端把"多 Agent 研讨群聊房间"持久化在 profile 的
   * `ui_meta['hermes-bots-groups'].rooms` 中，而不是 hosted room 服务里。
   *
   * 【防范的历史坑 (Pitfall)】
   * 归一化曾只挑 name/displayName/avatar 等少数字段，把 ui_meta 整体丢弃，
   * 导致旧群聊房间与其历史发言永远查不到（groups.log 对这类房间返回 4112）。
   *
   * 【规则 (Rules)】
   * 该字段必须原样透传，任何层都不得裁剪或重命名其内部键。
   */
  uiMeta?: ProfileUiMeta;
}

/** profile.ui_meta 的已知子结构（保留未知键，网关可能扩展） */
export interface ProfileUiMeta {
  'hermes-bots-groups'?: {
    rooms?: Record<string, HermesBotsGroupRoom>;
  };
  [key: string]: unknown;
}

/** 官方桌面端持久化在 ui_meta 中的群聊房间（含完整本地发言日志） */
export interface HermesBotsGroupRoom {
  roomId?: string;
  name?: string;
  members?: Array<string | { name?: string; handle?: string; profile?: string }>;
  log?: Array<{
    id?: string;
    from?: { kind?: string; name?: string };
    text?: string;
    at?: number;
    thread?: string;
  }>;
  createdAt?: number;
  updatedAt?: number;
  [key: string]: unknown;
}

export interface NormalizedSession {
  id: string;
  title: string;
  model: string;
  time: string;
  preview: string;
  isArchived: boolean;
  timestamp: number;
  botName?: string;
  botDisplayName?: string;
  botAvatar?: string;
  projectId?: string;
  projectName?: string;
  cwd?: string;
  parentSessionId?: string;
  source?: string;
  isSubagent?: boolean;
}

/**
 * 会话元数据与血缘契约 (Session Lineage & Metadata Contract)
 *
 * 设计意图 (Why):
 *   为了支持「普通会话（旁聊）」、「Bot 终身主会话（Forever Chat）」以及「多 Bot 群聊（Group Room）」的
 *   三态物理隔离与多设备跨端同步，必须在会话层固化父子血缘与专职 Bot 归属。
 *
 * 防范的历史坑 (Pitfall):
 *   多设备接力或刷新页面后丢失 parent_session_id，导致派生旁聊脱离所属 Bot 成为孤儿子会话，
 *   或者将 Bot 的 Forever Chat 误当成普通会话在列表里误删或归档。
 *
 * 约束与规则 (Rules):
 *   - parent_session_id 标识直接派生来源。
 *   - is_forever_chat=true 的会话受物理保护，前端严禁提供归档/删除操作。
 */
export interface SessionMetadataContract {
  parent_session_id?: string;
  bot_profile: string;
  is_forever_chat: boolean;
  spawn_source?: 'user' | 'subagent' | 'btw' | 'group_seed';
  workspace_path?: string;
}

/**
 * 子代理执行状态模型 (Subagent Task State Machine)
 *
 * 设计意图 (Why):
 *   为「会话内显示子代理执行卡片」与「穿透查看子代理执行流」提供确定性的状态驱动模型。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 丢失实体句柄：严禁把子代理降级为普通单次 tool 调用。
 *   2. 状态二义性：区分 thinking / tool_executing / running，保证进度条平滑。
 *
 * 约束与规则 (Rules):
 *   - subagentId 作为全局唯一检索主键。
 */
export type SubagentStatus =
  | 'requested'
  | 'running'
  | 'thinking'
  | 'tool_executing'
  | 'completed'
  | 'interrupted'
  | 'failed';

export interface SubagentTaskState {
  subagentId: string;
  parentSessionId: string;
  targetProfile: string;
  taskTitle: string;
  status: SubagentStatus;
  progressPercent: number;
  currentActionText: string;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  resultSummary?: string;
  error?: string;
}

export interface SubagentLogEntry {
  seq: number;
  timestamp: number;
  kind: 'stdout' | 'stderr' | 'thought' | 'tool_call' | 'tool_result' | 'status_change';
  text: string;
  payload?: Record<string, unknown>;
}

export interface SubagentSpawnParams {
  parent_session_id: string;
  target_profile: string;
  task_title: string;
  instruction: string;
  context_slice?: string;
}

export interface SubagentSpawnResult {
  subagent_id: string;
  status: SubagentStatus;
}

export interface SubagentListParams {
  session_id?: string;
}

export interface SubagentListResult {
  subagents: Array<{
    subagent_id: string;
    parent_session_id?: string;
    profile?: string;
    title?: string;
    status: SubagentStatus;
    progress?: number;
    current_action?: string;
    started_at?: number;
    updated_at?: number;
  }>;
  delegations?: unknown[];
}

export interface SubagentTailParams {
  subagent_id: string;
  session_id?: string;
  limit?: number;
  since_seq?: number;
}

export interface SubagentTailResult {
  subagent_id: string;
  available?: boolean;
  text?: string;
  truncated?: boolean;
  entries?: SubagentLogEntry[];
  has_more?: boolean;
  latest_seq?: number;
}

export interface SubagentSteerParams {
  subagent_id: string;
  session_id?: string;
  text?: string;
  instruction?: string;
}

export interface SubagentSteerResult {
  accepted?: boolean;
  status?: string;
  subagent_id?: string;
  text?: string;
  message?: string;
}

export interface SubagentInterruptParams {
  subagent_id: string;
  session_id?: string;
}

export interface SubagentInterruptResult {
  interrupted?: boolean;
  found?: boolean;
  subagent_id?: string;
}

export interface DelegationStatusResult {
  paused: boolean;
  active_subagent_count: number;
}

export interface DelegationPauseParams {
  paused: boolean;
}

export interface DelegationPauseResult {
  paused: boolean;
}

/**
 * 专职 Bot 与配置档契约 (Profiles & Bot Management Contracts)
 */
export interface AgentProfileDetail extends AgentProfile {
  systemPrompt?: string;
  soulContent?: string;
  tools?: string[];
  mcpServers?: string[];
  workingDirectory?: string;
}

export interface ProfilesListResult {
  profiles: AgentProfile[];
}

export interface ProfilesDescribeParams {
  name: string;
}

export interface ProfilesDescribeResult {
  profile?: AgentProfileDetail;
  name?: string;
  description?: string;
  soul?: string;
  toolsets?: Array<{ name: string }>;
  mcp_servers?: unknown[];
}

export interface ProfilesCreateParams {
  name: string;
  template?: string;
  display_name?: string;
  description?: string;
}

export interface ProfilesCreateResult {
  name: string;
  created: boolean;
}

export interface ProfilesConfigureParams {
  name: string;
  patch: Partial<AgentProfileDetail>;
}

export interface ProfilesConfigureResult {
  success: boolean;
}

export interface ProfilesGetAssetParams {
  name: string;
  key?: string;
  asset?: string;
}

export interface ProfilesGetAssetResult {
  found?: boolean;
  data?: string;
  mime?: string;
  asset_base64?: string;
  avatar?: string;
}

export interface ProfilesSetAssetParams {
  name: string;
  key: string;
  base64: string;
}

export interface ProfilesSetAssetResult {
  success: boolean;
}

/**
 * 多 Agent 群聊房间契约 (Group Room Contracts)
 */
export interface GroupRoomSummary {
  roomId: string;
  name: string;
  members: string[];
  createdAt: number;
  updatedAt: number;
  lastMessagePreview?: string;
  isDisbanded?: boolean;
}

export interface GroupMessageEntry {
  messageId: string;
  seq: number;
  senderProfile: string;
  timestamp: number;
  text: string;
  isSeed?: boolean;
  /** 官方 payload.thread_id，用于把同一轮研讨归组 */
  threadId?: string;
  /** actor.kind：user 表示人类发言，member 表示 Agent 发言 */
  actorKind?: 'user' | 'member' | 'system' | string;
}

export interface GroupsListResult {
  groups?: GroupRoomSummary[];
  rooms?: Array<{
    room_id: string;
    name: string;
    members?: Array<{ profile?: string; handle?: string }>;
    created_at?: number;
    updated_at?: number;
    disbanded_at?: number | null;
  }>;
  next_offset?: number | null;
}

export interface GroupsCreateParams {
  room_id?: string;
  name: string;
  members: Array<string | { member_id: string; profile: string; handle: string; display_name?: string }>;
}

export interface GroupsCreateResult {
  room_id: string;
  name: string;
  members: string[];
}

export interface GroupsStateParams {
  room_id: string;
}

export interface GroupsStateResult {
  room_id: string;
  name: string;
  members: string[];
  status: 'active' | 'paused' | 'disbanded';
  active_speaker?: string;
}

/**
 * 官方 groups.send 契约（源码 gateway/hosted_room_discussion.py::validate_user_payload）
 *
 * 【设计意图 (Why)】
 * 网关对 payload 执行"精确字段"校验（_USER_PAYLOAD_FIELDS = {text, thread_id}），
 * 任何多余或缺失字段都会被拒。
 *
 * 【防范的历史坑 (Pitfall)】
 * 曾把 text / sender_profile / is_seed 平铺在顶层，网关返回
 * `4000 text: Extra inputs are not permitted`；
 * 只传 payload:{text} 又返回 `5112 user payload is missing fields: thread_id`；
 * 不传 event_id 返回 `4111 event_id must be a string`。
 *
 * 【规则 (Rules)】
 * - 顶层只允许 room_id / event_id / payload（profile 可选）；
 * - payload 精确为 { text, thread_id }，thread_id 由客户端 mint（`t<base36>-<5位>`）。
 */
export interface GroupsSendParams {
  room_id: string;
  event_id: string;
  payload: {
    text: string;
    thread_id: string;
  };
}

/** 官方 groups.send 返回：{ event, client_event_id, accepted, driver_started } */
export interface GroupsSendResult {
  event?: {
    room_id?: string;
    seq?: number;
    event_id?: string;
    kind?: string;
    actor?: { kind?: string; id?: string; profile?: string; display_name?: string };
    payload?: { text?: string; thread_id?: string; [key: string]: unknown };
    created_at?: number;
  };
  client_event_id?: string | null;
  accepted?: boolean;
  driver_started?: boolean;
  /** 兼容旧字段（网关早期版本或本地回放） */
  message_id?: string;
  seq?: number;
}

export interface GroupsLogParams {
  room_id: string;
  since_seq?: number;
  limit?: number;
}

export interface GroupsLogResult {
  room_id?: string;
  entries?: GroupMessageEntry[];
  events?: Array<{
    room_id?: string;
    seq?: number;
    event_id?: string;
    kind?: string;
    actor?: { kind?: string; name?: string; profile?: string };
    payload?: { text?: string; [key: string]: unknown };
    created_at?: number;
  }>;
  latest_seq?: number;
  cursor?: number;
  has_more?: boolean;
}

export interface GroupsDisbandParams {
  room_id: string;
}

export interface GroupsDisbandResult {
  success: boolean;
}

export interface GroupsRenameParams {
  room_id: string;
  new_name: string;
}

export interface GroupsRenameResult {
  success: boolean;
}

/**
 * 项目与工作区管理契约 (Project & Workspace Contracts)
 */
export interface ProjectSummary {
  projectId: string;
  name: string;
  slug: string;
  primaryPath: string;
  additionalFolders: string[];
  gitRepoRoot?: string;
  activeBranch?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectDetail extends ProjectSummary {
  description?: string;
  icon?: string;
  color?: string;
  board_slug?: string;
  associatedSessionIds?: string[];
}

export interface ProjectsListResult {
  projects: Array<ProjectSummary & {
    id?: string;
    primary_path?: string;
    folders?: Array<{ path: string }>;
    is_active?: boolean;
    created_at?: number;
    updated_at?: number;
  }>;
}

export interface ProjectsGetParams {
  id?: string;
  project_id?: string;
}

export interface ProjectsGetResult {
  project: ProjectDetail & {
    id?: string;
    primary_path?: string;
    folders?: Array<{ path: string }>;
    is_active?: boolean;
    created_at?: number;
    updated_at?: number;
  };
}

export interface ProjectsCreateParams {
  name: string;
  path?: string;
  folders?: string[];
  primary_path?: string;
  description?: string;
  slug?: string;
  use?: boolean;
}

export interface ProjectsCreateResult {
  project?: {
    id: string;
    slug: string;
    name: string;
    primary_path: string;
    folders?: Array<{ path: string }>;
  };
  project_id?: string;
  name?: string;
  path?: string;
}

export interface ProjectsUpdateParams {
  id?: string;
  project_id?: string;
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  board_slug?: string;
  patch?: Partial<ProjectDetail>;
}

export interface ProjectsUpdateResult {
  success?: boolean;
  project?: ProjectDetail;
}

export interface ProjectsDeleteParams {
  id?: string;
  project_id?: string;
}

export interface ProjectsDeleteResult {
  success?: boolean;
}

export interface ProjectsSetActiveParams {
  id?: string;
  project_id?: string;
}

export interface ProjectsSetActiveResult {
  success?: boolean;
}

export interface ProjectsAddFolderParams {
  id?: string;
  project_id?: string;
  path: string;
  is_primary?: boolean;
  label?: string;
}

export interface ProjectsAddFolderResult {
  success?: boolean;
  project?: ProjectDetail;
}

export interface ProjectsRemoveFolderParams {
  id?: string;
  project_id?: string;
  path: string;
}

export interface ProjectsRemoveFolderResult {
  success?: boolean;
  project?: ProjectDetail;
}

export interface ProjectTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  children?: ProjectTreeNode[];
}

export interface ProjectsTreeParams {
  project_id?: string;
  relative_path?: string;
  depth?: number;
  preview_limit?: number;
  session_limit?: number;
  profile?: string;
}

export interface ProjectsTreeResult {
  tree?: ProjectTreeNode[];
  projects?: unknown[];
}

/**
 * 代码时光机与还原契约 (Rollback Contracts)
 */
export interface RollbackVersionEntry {
  versionId: string;
  sessionId: string;
  timestamp: number | string;
  commitHash?: string;
  title: string;
  filesChangedCount?: number;
}

export interface RollbackListParams {
  session_id: string;
  profile?: string;
}

export interface RollbackListResult {
  enabled?: boolean;
  checkpoints?: Array<{
    hash: string;
    timestamp: string;
    message: string;
  }>;
  versions?: RollbackVersionEntry[];
}

export interface RollbackDiffParams {
  session_id: string;
  hash: string;
  profile?: string;
}

export interface RollbackDiffResult {
  stat?: string;
  diff?: string;
  rendered?: string | null;
  files_changed?: number;
}

export interface RollbackRestoreParams {
  session_id: string;
  hash: string;
  file_path?: string;
  profile?: string;
}

export interface RollbackRestoreResult {
  success?: boolean;
  restored?: boolean;
  restored_to?: string | null;
  error?: string | null;
  version_id?: string;
}

/**
 * 旁路问答与接力分叉契约 (BTW & Handoff Contracts)
 */
export interface PromptBtwParams {
  session_id: string;
  text: string;
  target_profile?: string;
}

export interface PromptBtwResult {
  response: string;
  profile: string;
  token_count?: number;
}

export interface SessionBranchWholeParams {
  session_id: string;
  name?: string;
  title?: string;
  idempotency_key?: string;
}

export interface SessionBranchResult {
  session_id: string;
  stored_session_id?: string;
  parent_session_id?: string;
  parent?: string;
  title?: string;
}

/**
 * 通用 RPC 调用网桥接口 (Universal RPC Caller Bridge)
 */
export interface IRpcCaller {
  request<TResult = unknown, TParams = unknown>(method: string, params?: TParams): Promise<TResult>;
}




