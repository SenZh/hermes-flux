/**
 * 回滚事务纯逻辑（packages/desktop/src/renderer/rollbackTransaction.ts）
 *
 * 【设计意图 (Why)】
 * 回滚 UX 必须“点击即消失”：本地立即裁撤目标提问及其后续消息，同时保留完整快照，
 * 供取消回滚、发送失败、切换会话三条路径原子恢复。删除与恢复的分解律在这里一次定义，
 * 渲染层只做编排，单测/CDP 与生产共享同一实现。
 *
 * 【防范的历史坑 (Pitfall)】
 * - 只删不备：截断失败后消息永久丢失（上一版的真实事故）；
 * - 用旧下标当切点：armed 之后消息列表可能因流式追加/持久化对账变化，必须按锚点重算；
 * - 恢复写回时把快照与新行混插：恢复即“整体替换为该时刻快照 + 追加期间不动”，
 *   快照捕获的就是删除瞬间的完整列表。
 *
 * 【约束与规则 (Rules)】
 * - 纯函数零变异；wire 载荷字段绝不在此文件出现（截断参数由 core InteractiveService 构造）。
 */

import type { MessageViewModel } from '@hermes-flux/ui';
import {
  resolveCutIndexByAnchor,
  splitAt,
  type TruncateAnchor,
} from '@hermes-flux/core';

/**
 * 进入回滚：按锚点重算切点并乐观裁撤。
 * 锚点在列表中消失（被压缩/外部客户端删除）时返回 null，调用方必须放弃截断保持原状。
 */
export function applyOptimisticCut(
  messages: MessageViewModel[],
  anchor: TruncateAnchor
): { kept: MessageViewModel[]; removed: MessageViewModel[] } | null {
  const cut = resolveCutIndexByAnchor(messages, anchor);
  if (cut < 0) return null;
  return splitAt(messages, cut);
}

/**
 * 消费并清除某会话的 server-priority 权威标记（截断成功后的防复活一次性开关）。
 * 抽出为纯函数以便对"读取即删除"接线本身做落盘证伪（否则删掉接线两行测试仍全绿）。
 */
export function takeServerPriority(
  trust: Map<string, 'server-priority'>,
  sessionId: string
): boolean {
  const isPriority = trust.get(sessionId) === 'server-priority';
  if (isPriority) trust.delete(sessionId);
  return isPriority;
}

/**
 * 权威加载合并决策（P0-1 防复活核心不变量的唯一裁决点）。
 * 语义：
 * - serverPriority=true（刚发生历史截断成功）：无条件以服务端为准，绝不"保留更长本地"，
 *   否则会把被有意删除的消息复活；
 * - 否则维持 Failure-Is-Not-Empty：本地比权威长且能对齐服务端末尾时，保留本地未落盘尾部；
 *   无法对齐（不同源）则整体保留本地更长列表，等待后续对账。
 * 纯函数、零变异，供单测正向/负向/慢响应竞态穷尽证伪。
 */
export function planSessionLoadMerge<T extends { id: string; rowId?: number }>(
  parsed: readonly T[],
  existing: readonly T[] | undefined,
  serverPriority: boolean
): T[] {
  if (serverPriority) return [...parsed];
  if (!existing || existing.length === 0) return [...parsed];
  if (parsed.length === 0) return [...existing];

  const matchKey = (a: T, b: T): boolean => {
    if (a.id === b.id) return true;
    if (typeof a.rowId === 'number' && typeof b.rowId === 'number' && a.rowId > 0 && b.rowId > 0) {
      return a.rowId === b.rowId;
    }
    return false;
  };

  const lastParsed = parsed[parsed.length - 1];
  const matchIdx = lastParsed ? existing.findIndex((m) => matchKey(m, lastParsed)) : -1;

  if (existing.length > parsed.length) {
    if (matchIdx < 0) {
      // 检查 parsed 是否整体是 existing 之后的新消息（按 rowId 单调递增判定）
      const firstParsed = parsed[0];
      const lastExisting = existing[existing.length - 1];
      if (
        firstParsed &&
        lastExisting &&
        typeof firstParsed.rowId === 'number' &&
        typeof lastExisting.rowId === 'number' &&
        firstParsed.rowId > lastExisting.rowId
      ) {
        return [...existing, ...parsed];
      }
      // 检查 parsed 内部是否存在任何消息能够对齐 existing（向前兼容循环查找，避免调用 ES2023 findLastIndex）
      let anyMatchExistingIdx = -1;
      for (let i = existing.length - 1; i >= 0; i--) {
        if (parsed.some((p) => matchKey(p, existing[i]))) {
          anyMatchExistingIdx = i;
          break;
        }
      }
      if (anyMatchExistingIdx >= 0) {
        const matchedItem = existing[anyMatchExistingIdx];
        const matchedParsedIdx = parsed.findIndex((p) => matchKey(p, matchedItem));
        const head = existing.slice(0, anyMatchExistingIdx + 1);
        const middle = parsed.slice(matchedParsedIdx + 1);
        // 保护在途未落盘消息：如果 existing 尾部包含没有 rowId 的临时用户消息，必须保留
        const uncommittedTail = existing.slice(anyMatchExistingIdx + 1).filter((m) => typeof m.rowId !== 'number' || m.rowId <= 0);
        return [...head, ...middle, ...uncommittedTail];
      }
      return [...existing];
    }
    // 能对齐末尾且本地末尾还有未落盘尾部（例如刚发出的提问）
    if (matchIdx < existing.length - 1) {
      // 检查 parsed 前面是否有更早历史需要拼接
      const firstParsed = parsed[0];
      const firstMatchIdx = firstParsed ? existing.findIndex((m) => matchKey(m, firstParsed)) : -1;
      const head = firstMatchIdx > 0 ? existing.slice(0, firstMatchIdx) : [];
      return [...head, ...parsed, ...existing.slice(matchIdx + 1)];
    }
    // 能对齐末尾且 matchIdx === existing.length - 1：说明 existing 包含了比 parsed 更早的头部历史
    const firstParsed = parsed[0];
    const firstMatchIdx = firstParsed ? existing.findIndex((m) => matchKey(m, firstParsed)) : -1;
    if (firstMatchIdx > 0) {
      return [...existing.slice(0, firstMatchIdx), ...parsed];
    }
    return [...existing];
  }

  // parsed.length >= existing.length：检查本地是否有更早历史
  const firstParsed = parsed[0];
  const firstMatchIdx = firstParsed ? existing.findIndex((m) => matchKey(m, firstParsed)) : -1;
  const head = firstMatchIdx > 0 ? existing.slice(0, firstMatchIdx) : [];
  return [...head, ...parsed];
}

/**
 * 离开会话时对挂起回滚的恢复决策（P0-2 防跨会话泄漏的唯一裁决点）。
 * armed 为空或 sessionId 不匹配当前会话时不动消息，只丢弃 armed。
 */
export function planRollbackLeaveRestore(
  armed: { sessionId: string; snapshot: MessageViewModel[] } | null,
  outgoingSessionId: string | null
): { restoreSessionId: string; restore: MessageViewModel[] } | null {
  if (!armed) return null;
  if (outgoingSessionId && armed.sessionId !== outgoingSessionId) {
    // armed 不属于正在离开的会话：仅丢弃，绝不把它的快照写进别的会话缓存
    return null;
  }
  return {
    restoreSessionId: armed.sessionId,
    restore: armed.snapshot.map((m) => ({ ...m })),
  };
}

/**
 * 权威持久行号提取纯函数
 *
 * 【设计意图 (Why)】
 * 统一网关持久行地址的解析规范。网关 REST、WS 与历史会话协议在不同版本与序列化场景下，
 * 持久行地址可能落在 row_id、_row_id、id（当其为有限正整数时）或已存在的 rowId 字段；
 * 统一收敛解析，杜绝各消费点因字段名假设不全导致持久锚点丢失。
 *
 * 【防范的历史坑 (Pitfall)】
 * - 历史上仅读取 m.row_id，而网关 /api/sessions/:id/messages 返回主键名是 id (数字)，
 *   导致拉取历史消息后提问行号全部变为 undefined，回滚被迫降级为 refill-only；
 * - 前端自造的临时主键（usr- / ast- 等前缀）绝不可误判为行号，必须返回 undefined 拦截。
 *
 * 【约束与规则 (Rules)】
 * - 必须是有限正整数（Number.isInteger(v) && v > 0）；
 * - 零与负数均不是合法持久行号；
 * - 纯 TypeScript，零外部副作用。
 */
export function extractDurableRowId(raw: unknown): number | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;

  const candidates = [record.row_id, record._row_id, record.rowId, record.id];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return undefined;
}

export interface BindTurnRowIdsParams {
  messages: MessageViewModel[];
  assistantMessageId: string;
  userRowId?: number | null;
  assistantRowId?: number | null;
  rowIds?: readonly number[];
}

/**
 * 消息轮次持久行号绑定纯函数
 *
 * 【设计意图 (Why)】
 * 在网关 message.complete 下行事件推送 persisted_turn 权威行地址时，
 * 无论当前用户焦点是否停留在该会话，均对传入的目标消息列表精准绑定 assistant 与 user 行号。
 *
 * 【防范的历史坑 (Pitfall)】
 * - 历史上依赖 state.messages.findIndex 查找助手行，用户若在生成期间切走，
 *   当前视口变为其他会话，导致 asstIdx 为 -1 并彻底跳过绑定，会话缓存中的 userMsg 永远缺失锚点；
 * - 当 userRowId 缺失或为 null 但 rowIds 数组非空时，以 rowIds[0] 兜底提取用户行锚点。
 *
 * 【约束与规则 (Rules)】
 * - 原地更新匹配项的 rowId 字段；
 * - 逆序寻回 assistantMessageId 之前最近的一条 user 消息进行绑定；
 * - 若成功更新任何行号返回 true，否则返回 false。
 */
export function bindTurnRowIds(params: BindTurnRowIdsParams): boolean {
  const { messages, assistantMessageId, assistantRowId } = params;
  if (!messages || messages.length === 0 || !assistantMessageId) return false;

  const resolvedUserRowId =
    typeof params.userRowId === 'number' && Number.isInteger(params.userRowId) && params.userRowId > 0
      ? params.userRowId
      : Array.isArray(params.rowIds) && params.rowIds.length > 0 && typeof params.rowIds[0] === 'number' && params.rowIds[0] > 0
      ? params.rowIds[0]
      : null;

  let changed = false;
  const asstIdx = messages.findIndex((m) => m.id === assistantMessageId);

  // 1. 绑定 assistant 消息行号
  if (asstIdx >= 0 && typeof assistantRowId === 'number' && assistantRowId > 0) {
    if (messages[asstIdx].rowId !== assistantRowId) {
      messages[asstIdx].rowId = assistantRowId;
      changed = true;
    }
  }

  // 2. 绑定前序最近 user 消息行号
  // 【规则】必须只匹配真实人类正文：steer 与 [System: 行的 role 同样是 user，
  // 绑到它们会让下一次回滚截断在错误的行上。
  if (asstIdx > 0 && resolvedUserRowId !== null) {
    for (let i = asstIdx - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && (messages[i].displayKind ?? 'user') === 'user') {
        if (messages[i].rowId !== resolvedUserRowId) {
          messages[i].rowId = resolvedUserRowId;
          changed = true;
        }
        break;
      }
    }
  }

  return changed;
}

export interface ResolveRollbackTargetParams {
  messages: readonly MessageViewModel[];
  msgId: string;
  btnRowId?: number | null;
}

/**
 * 回滚目标定位与自愈纯函数
 *
 * 【设计意图 (Why)】
 * 用户点击回滚按钮时，精准寻回目标提问行。若目标存在但缺少 rowId，而 DOM 按钮上持有合法的
 * data-row-id（例如由消息初始渲染或后续补丁写入），安全自愈回填目标 rowId，避免误判降级。
 *
 * 【防范的历史坑 (Pitfall)】
 * - 历史上仅凭 state.messages 对象的内部字段判定，一旦缓存合并或异步刷新存在微秒级竞态，
 *   即使 DOM 按钮已持有持久行号，也会被误判为 no-anchor；
 * - 若 msgId 经由对账变化，允许通过 btnRowId 重新对齐找到目标行。
 *
 * 【约束与规则 (Rules)】
 * - 只有当 btnRowId 为有限正整数时才允许自愈，绝不接受非数字或临时 id。
 */
export function resolveRollbackTarget(
  params: ResolveRollbackTargetParams
): { targetMsg: MessageViewModel; durableRowId?: number } | null {
  const { messages, msgId, btnRowId } = params;
  if (!messages || messages.length === 0) return null;

  const validBtnRowId =
    typeof btnRowId === 'number' && Number.isInteger(btnRowId) && btnRowId > 0 ? btnRowId : undefined;

  let target = msgId ? messages.find((m) => m.id === msgId) : undefined;
  if (!target && validBtnRowId !== undefined) {
    target = messages.find((m) => m.rowId === validBtnRowId);
  }

  if (!target) return null;

  // 自愈：若内存中缺失 rowId 但按钮携带合法持久行号，安全回填
  if ((target.rowId === undefined || target.rowId === null) && validBtnRowId !== undefined) {
    target.rowId = validBtnRowId;
  }

  return {
    targetMsg: target,
    durableRowId: target.rowId,
  };
}
