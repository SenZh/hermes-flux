/**
 * 历史截断锚点与回滚事务纯逻辑（packages/core/src/session/truncatePlan.ts）
 *
 * 【设计意图 (Why)】
 * 回滚 4018（target user message is no longer in session history）的根因是渲染层把
 * 前端临时 id（usr- 与 ast- 前缀）当成网关持久锚点透传。截断的一切判定（能不能截、用什么锚、
 * 切在哪、失败怎么恢复）必须收敛在这一层纯函数里，渲染层只消费计划、不构造载荷字段。
 *
 * 【防范的历史坑 (Pitfall)】
 * - usr-${Date.now()} 等本地主键只用于渲染与缓存合并，绝不能进入 wire；
 * - rowId 缺失时严禁“猜一个锚点”发出去，必须降级为 refill-only 或 blocked；
 * - 视图下标 ≠ 网关行序（工具行被折叠），切点必须用锚点重算，拒绝沿用旧下标。
 *
 * 【约束与规则 (Rules)】
 * - 纯 TypeScript，零 DOM / 零 RPC；wire payload 唯一构造点在 InteractiveService；
 * - truncate_before_row_id 与 truncate_before_message_id 严格互斥，只允许出现其一；
 * - 本文件所有函数对输入零变异，返回新数组（形式化定理 8 的前提）。
 */

export type TruncateAnchor =
  | { readonly kind: 'row'; readonly rowId: number }
  | { readonly kind: 'none' };

export interface TruncatePlanMessage {
  readonly id: string;
  readonly rowId?: number;
  readonly role: string;
}

/** 前端本地临时主键模式：渲染层自造，网关历史表中永不存在 */
const CLIENT_TEMP_ID = /^(usr|ast|tc|msg|tool|g_msg|att|q)-/;

export function isClientTempId(value: unknown): boolean {
  return typeof value === 'string' && CLIENT_TEMP_ID.test(value);
}

/** 网关持久行地址：必须是有限正整数（0 与负数都不是合法 row_id） */
export function isDurableRowId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** 从目标消息解析唯一可信锚点；无持久 rowId 时绝不退用临时 id */
export function resolveAnchor(target: TruncatePlanMessage | undefined | null): TruncateAnchor {
  if (target && isDurableRowId(target.rowId)) {
    return { kind: 'row', rowId: target.rowId };
  }
  return { kind: 'none' };
}

export type BlockReason =
  | 'unsupported-scope'
  | 'streaming'
  | 'not-found'
  | 'not-user'
  | 'no-anchor';

export type TruncatePlan =
  | {
      readonly mode: 'truncate';
      readonly anchor: { readonly kind: 'row'; readonly rowId: number };
      readonly cutIndex: number;
      readonly targetId: string;
    }
  | {
      /** 无持久锚点：仅回填文本让用户作为新提问发送，不携带任何 truncate 字段 */
      readonly mode: 'refill-only';
      readonly targetId: string;
      readonly reason: Extract<BlockReason, 'no-anchor'>;
    }
  | {
      readonly mode: 'blocked';
      readonly reason: BlockReason;
    };

export interface TruncatePlanInput {
  readonly messages: readonly TruncatePlanMessage[];
  readonly targetId: string;
  readonly sessionKind: 'scratchpad' | 'bot_forever_chat' | 'group_room';
  readonly isStreaming: boolean;
}

/**
 * 回滚截断的唯一裁决入口。
 * 决策序：作用域（仅普通会话）→ 流式互斥 → 目标存在 → 必须是 user 行 → 锚点存在。
 */
export function planTruncate(input: TruncatePlanInput): TruncatePlan {
  if (input.sessionKind !== 'scratchpad') {
    return { mode: 'blocked', reason: 'unsupported-scope' };
  }
  if (input.isStreaming) {
    return { mode: 'blocked', reason: 'streaming' };
  }
  const idx = input.messages.findIndex((m) => m.id === input.targetId);
  if (idx < 0) {
    return { mode: 'blocked', reason: 'not-found' };
  }
  const target = input.messages[idx];
  if (target.role !== 'user') {
    return { mode: 'blocked', reason: 'not-user' };
  }
  const anchor = resolveAnchor(target);
  if (anchor.kind === 'none') {
    return { mode: 'refill-only', targetId: target.id, reason: 'no-anchor' };
  }
  return { mode: 'truncate', anchor, cutIndex: idx, targetId: target.id };
}

/**
 * 发送时用锚点重算切点（拒绝沿用 armed 时记录的旧下标）。
 * 找不到锚点行返回 -1，调用方必须中止截断降级为普通发送。
 */
export function resolveCutIndexByAnchor(
  messages: readonly TruncatePlanMessage[],
  anchor: TruncateAnchor
): number {
  if (anchor.kind !== 'row') return -1;
  return messages.findIndex((m) => isDurableRowId(m.rowId) && m.rowId === anchor.rowId);
}

/** 前缀/后缀拆分：kept + removed 恒等于原列表（往返恒等，定理 8） */
export function splitAt<T>(list: readonly T[], index: number): { kept: T[]; removed: T[] } {
  const safe = Math.max(0, Math.min(index, list.length));
  return { kept: list.slice(0, safe), removed: list.slice(safe) };
}

/**
 * 截断成功后按 survivor_row_id_map 收敛本地行地址。
 * 契约语义：值为 null 表示该缓存 id 已被丢弃；键缺失表示保持不变。
 * rowId 为可选字段，丢弃即置 undefined（保持类型正确，无需断言逃逸）。
 */
export function applySurvivorMap<T extends TruncatePlanMessage>(
  messages: readonly T[],
  survivorMap: Readonly<Record<string, number | null>> | null | undefined
): T[] {
  if (!survivorMap) return messages.map((m) => ({ ...m }));
  return messages.map((m) => {
    if (!(m.id in survivorMap)) return { ...m };
    const nextRow = survivorMap[m.id];
    if (nextRow === null || nextRow === undefined) {
      return { ...m, rowId: undefined };
    }
    return { ...m, rowId: nextRow };
  });
}

/**
 * InteractiveService 构造 wire 载荷的合法性断言：
 * 临时 id 一旦试图逃逸为截断锚点，立即在发送前抛错拦截（宁可失败不可 4018 打到线上语义）。
 */
export function assertDurableTruncateAnchor(anchor: TruncateAnchor): asserts anchor is {
  kind: 'row';
  rowId: number;
} {
  if (anchor.kind !== 'row' || !isDurableRowId(anchor.rowId)) {
    throw new Error('truncate anchor must be a durable numeric row_id; client temp ids are forbidden');
  }
}
