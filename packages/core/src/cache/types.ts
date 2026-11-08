/**
 * 客户端缓存领域类型（packages/core/src/cache/types.ts）
 *
 * 【设计意图 (Why)】
 *   缓存层只做两件事：让冷启动不等网络、让离线有内容可看。
 *   为了做到这两件事，必须把"网关行"与"缓存行"的边界用类型钉死，
 *   否则实施时会出现"工具行被当成独立消息"、"群聊 seq 与单会话 rowId 混用"这类错。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 单会话与群聊是两套互不兼容的消息来源：前者用 rowId，后者用 seq。
 *      历史上用单一 id 字段承载两者，导致群聊消息与单会话消息主键碰撞。
 *   2. `hidden` 在 REST 返回里是数字 0/1，不是布尔。直接当布尔用会在严格比较时出错。
 *   3. `last_active` 是秒级浮点，未归一化会导致列表倒挂。
 *
 * 【约束与规则 (Rules)】
 *   - 本文件只声明类型，零运行时代码；
 *   - 禁止 any / unknown 作为对外字段类型；
 *   - 时间戳统一毫秒整数。
 */

/** 缓存信封版本。结构变更时提升，读到不匹配的值直接丢弃重建。 */
export const CACHE_SCHEMA_VERSION = 1 as const;

/** 消息所属通道。群聊与单会话的主键序号语义不同，必须显式区分。 */
export type CacheChannel = 'session' | 'room';

/** 会话索引行：message 的入口，不含正文。 */
export interface CachedSessionSummary {
  /** stored_session_id 或 room_id */
  id: string;
  /** 归属 profile；群聊房间固定为空串（hosted rooms 不属于任何 profile） */
  profile: string;
  kind: 'session' | 'group';
  title: string;
  /** 副标题，派生自真实最后一条消息 */
  preview?: string;
  /** 毫秒整数，已归一化 */
  timestamp: number;
  isArchived: boolean;
  hidden: boolean;
  pinned: boolean;
  unread: boolean;
  botName?: string;
  projectId?: string;
  /** 群聊游标，用于 groups.log 增量拉取 */
  latestSeq?: number;
  /** 群聊成员数 */
  memberCount?: number;
  /** 群聊成员名单，用于渲染拼图头像 */
  members?: string[];
}

/** Agent 索引行：左轨微轨与主工位卡的数据源。 */
export interface CachedAgentSummary {
  /** 网关侧唯一名 */
  name: string;
  displayName: string;
  description?: string;
  model?: string;
  /** 头像引用键，实体在头像表中 */
  avatar?: string;
  hasAvatar: boolean;
  /** 来源：last_session.last_active，毫秒整数 */
  lastSessionLastActive?: number;
}

/** 工具调用快照。arguments 保留原始 JSON 字符串，展示层再解析。 */
export interface CachedToolCall {
  toolId: string;
  name: string;
  argsText?: string;
  resultText?: string;
  status: 'running' | 'done' | 'error';
}

/** 消息缓存行。主键四元组 (profile, channel, channelId, orderKey)。 */
export interface CachedMessageRow {
  profile: string;
  channel: CacheChannel;
  channelId: string;
  /** session 为 rowId；room 为 seq。单调递增，唯一可靠的排序依据。 */
  orderKey: number;
  role: 'user' | 'assistant' | 'system';
  text: string;
  reasoning?: string;
  toolCalls?: CachedToolCall[];
  /** 毫秒整数 */
  timestamp: number;
  status: 'complete' | 'error' | 'interrupted';
  /** 正文因超长被截断 */
  truncated?: boolean;
}

/** 通道引用：定位一个会话或一个房间的消息集合。 */
export interface CacheChannelRef {
  /** 归属网关 ID（支持多网关独立隔离，可选向后兼容） */
  gatewayId?: string;
  profile: string;
  channel: CacheChannel;
  channelId: string;
}

/** 网关认证方式 */
export type GatewayAuthType = 'basic' | 'token' | 'none';

/** 单个网关连接档案配置实体 */
export interface GatewayConnectionProfile {
  id: string;
  name: string;
  url: string;
  authType: GatewayAuthType;
  username?: string;
  password?: string;
  token?: string;
  defaultProfile?: string;
  lastConnectedAt?: number;
  lastLatencyMs?: number;
  isDefault?: boolean;
}

/** 多网关注册表容器（存储在持久化信封中） */
export interface GatewayRosterState {
  activeGatewayId: string;
  defaultGatewayId: string;
  items: GatewayConnectionProfile[];
}

/** 持久化信封：所有索引类缓存统一使用，便于版本判定。 */
export interface CacheEnvelope<T> {
  v: number;
  savedAt: number;
  items: T;
}

/** 构造一个空信封。 */
export function createEnvelope<T>(items: T, savedAt: number): CacheEnvelope<T> {
  return { v: CACHE_SCHEMA_VERSION, savedAt, items };
}

/**
 * 判断信封是否可读。
 *
 * 【规则】版本不匹配一律视为不可读，由调用方丢弃重建；
 * 不写迁移代码——索引条目少，重建成本 = 一次网络请求。
 */
export function isReadableEnvelope(value: unknown): value is CacheEnvelope<unknown> {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.v === CACHE_SCHEMA_VERSION && 'items' in record;
}
