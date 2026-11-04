/**
 * Gateway Downstream Event Reducer
 *
 * The Hermes Gateway pushes a single JSON-RPC notification `event` whose params
 * look like `{ type, payload, session_id }`. A conversation turn is terminated by
 * `message.complete` (verified against a live v0.22.5 gateway); `session.idle` and
 * `agent.turn_end` do not exist.
 *
 * This reducer is pure: it turns one gateway frame into an ordered list of UI
 * actions. Keeping it out of the renderer makes the turn lifecycle testable
 * without a DOM or a socket.
 *
 * 事件契约守卫 (Event Contract Guard):
 *   网关契约里有 72 个下行事件的 payload 定义（BackendGatewayEventMap）。
 *   本模块只消费其中一部分，但**任何**事件的 payload 字段都必须落在契约白名单内。
 *   历史上字段名靠猜，一旦网关改名（如 text -> delta），界面只会安静地空白。
 *   因此这里在解析前做一次字段校验，并把偏差写进日志，而不是让它静默发生。
 */

import { CONTRACT_EVENTS } from '../rpc/contracts/contractTable.generated.js';
import { createLogger } from '../log/logger.js';

const log = createLogger('events');

/** 已上报过的事件偏差，避免高频事件把日志刷爆 */
const reportedEventDrift = new Set<string>();
/** 已上报过的未知事件名 */
const reportedUnknownEvents = new Set<string>();

/**
 * 校验一个 event 帧的 payload 字段是否落在契约白名单内。
 * 只记日志，不改变解析行为——事件流不能因为一个多余字段就中断。
 */
function checkEventContract(type: string, payload: Record<string, unknown>): void {
  const spec = CONTRACT_EVENTS[type];
  if (!spec) {
    if (!reportedUnknownEvents.has(type)) {
      reportedUnknownEvents.add(type);
      log.debug('event type not in gateway contract (may be newer or internal)', { type });
    }
    return;
  }
  const allowed = new Set(spec.payload);
  const unknown = Object.keys(payload).filter((k) => !allowed.has(k));
  if (unknown.length === 0) return;
  const key = `${type}::${unknown.join(',')}`;
  if (reportedEventDrift.has(key)) return;
  reportedEventDrift.add(key);
  log.warn('event payload has fields outside the gateway contract', {
    type,
    payloadType: spec.payloadType,
    unknownFields: unknown,
    allowedFields: spec.payload,
  });
}

/** 仅供测试：清空上报去重状态 */
export function resetEventContractReports(): void {
  reportedEventDrift.clear();
  reportedUnknownEvents.clear();
}

export interface TurnEventContext {
  /** Every id identifying the conversation currently on screen (live id + stored id). */
  activeSessionIds: readonly string[];
  /** Assistant message that streamed deltas belong to, or null when no turn is open. */
  activeStreamingMessageId: string | null;
}

export type TurnAction =
  | { type: 'turn-started' }
  | { type: 'turn-completed'; sessionId?: string; finalText?: string }
  | { type: 'turn-failed'; sessionId?: string; message: string }
  | { type: 'append-content'; messageId: string; text: string }
  | { type: 'append-thought'; messageId: string; text: string }
  | { type: 'replace-content'; messageId: string; text: string }
  | { type: 'tool-start'; messageId: string; toolCall: { id: string; name: string; args: string; title?: string } }
  | { type: 'tool-complete'; messageId: string; toolCallId: string; output?: string; durationMs?: number }
  | {
      /**
       * message.complete 携带的网关持久行地址：把 rowId 绑定回本地乐观行，
       * 使下一轮回滚/截断拥有可信锚点（D1 修复的落盘半环）。
       */
      type: 'persisted-turn';
      messageId: string;
      userRowId: number | null;
      assistantRowId: number | null;
      rowIds: number[];
    }
  | {
      type: 'subagent-spawn';
      subagentId: string;
      profile: string;
      title: string;
      parentSessionId: string;
      messageId?: string;
    }
  | {
      type: 'subagent-progress';
      subagentId: string;
      progressPercent: number;
      actionText: string;
    }
  | {
      type: 'subagent-log';
      subagentId: string;
      entry: {
        seq: number;
        timestamp: number;
        kind: 'stdout' | 'stderr' | 'thought' | 'tool_call' | 'tool_result' | 'status_change';
        text: string;
      };
    }
  | {
      type: 'subagent-complete';
      subagentId: string;
      summary?: string;
      output?: string;
    }
  | {
      type: 'subagent-failed';
      subagentId: string;
      error: string;
    }
  | { type: 'refresh-sessions' }
  | { type: 'session-title'; sessionId: string; title: string }
  | {
      /**
       * @Agent 旁路（BTW 只读外援 / background 子代理委派）应答到达。
       * 严禁写入 state.messages，仅供独立胶囊状态收敛，防上下文毒化。
       */
      type: 'side-agent-complete';
      channel: 'btw' | 'background';
      taskId: string;
      text: string;
    };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Reduces one gateway `event` notification into UI actions.
 *
 * Returns an empty array for frames that do not concern this client, are
 * malformed, or are events the desktop shell does not consume yet.
 */
export function reduceGatewayEvent(params: unknown, ctx: TurnEventContext): TurnAction[] {
  const frame = asRecord(params);
  const type = asText(frame.type);
  if (!type) return [];

  const payload = asRecord(frame.payload);
  const frameSessionId = asText(frame.session_id);

  // 契约守卫：payload 字段必须落在网关事件契约内（只记日志，不中断事件流）
  checkEventContract(type, payload);

  // --- Global broadcasts: independent of which conversation is focused ------
  if (type === 'sessions.changed') {
    return [{ type: 'refresh-sessions' }];
  }

  if (type === 'session.title') {
    const sessionId = frameSessionId || asText(payload.session_id);
    const title = asText(payload.title).trim();
    if (!sessionId || !title) return [];
    return [{ type: 'session-title', sessionId, title }];
  }

  if (type === 'error') {
    const message = asText(payload.message) || '网关返回了未标注内容的系统错误';
    const action: TurnAction = { type: 'turn-failed', message };
    if (frameSessionId) action.sessionId = frameSessionId;
    return [action];
  }

  // --- Turn-scoped events: ignore streams belonging to other sessions ------
  if (frameSessionId && ctx.activeSessionIds.length > 0 && !ctx.activeSessionIds.includes(frameSessionId)) {
    return [];
  }

  const messageId = ctx.activeStreamingMessageId;

  switch (type) {
    case 'message.start':
      return [{ type: 'turn-started' }];

    case 'btw.complete':
    case 'background.complete': {
      const taskId = asText(payload.task_id);
      if (!taskId) return [];
      return [{
        type: 'side-agent-complete',
        channel: type === 'btw.complete' ? 'btw' : 'background',
        taskId,
        text: asText(payload.text),
      }];
    }

    case 'message.delta': {
      const text = asText(payload.text);
      if (!text || !messageId) return [];
      return [{ type: 'append-content', messageId, text }];
    }

    case 'thinking.delta':
    case 'reasoning.delta': {
      const text = asText(payload.text);
      if (!text || !messageId) return [];
      return [{ type: 'append-thought', messageId, text }];
    }

    case 'subagent.spawn_requested':
    case 'subagent.start': {
      const subagentId = asText(payload.subagent_id) || asText(payload.id);
      if (!subagentId) return [];
      const profile = asText(payload.profile) || asText(payload.target_profile) || 'default';
      const title = asText(payload.title) || asText(payload.task_title) || '子代理任务';
      return [{
        type: 'subagent-spawn',
        subagentId,
        profile,
        title,
        parentSessionId: frameSessionId || asText(payload.parent_session_id),
        messageId: messageId || undefined,
      }];
    }

    case 'subagent.progress': {
      const subagentId = asText(payload.subagent_id) || asText(payload.id);
      if (!subagentId) return [];
      const progressPercent = typeof payload.progress === 'number'
        ? payload.progress
        : typeof payload.percent === 'number'
        ? payload.percent
        : 0;
      const actionText = asText(payload.action) || asText(payload.text) || asText(payload.current_action);
      return [{
        type: 'subagent-progress',
        subagentId,
        progressPercent,
        actionText,
      }];
    }

    case 'subagent.log':
    case 'subagent.stdout':
    case 'subagent.stderr': {
      const subagentId = asText(payload.subagent_id) || asText(payload.id);
      if (!subagentId) return [];
      const text = asText(payload.text) || asText(payload.line) || asText(payload.content);
      const kind = type === 'subagent.stderr' ? 'stderr' : 'stdout';
      return [{
        type: 'subagent-log',
        subagentId,
        entry: {
          seq: typeof payload.seq === 'number' ? payload.seq : Date.now(),
          timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
          kind,
          text,
        },
      }];
    }

    case 'subagent.failed': {
      const subagentId = asText(payload.subagent_id) || asText(payload.id);
      if (!subagentId) return [];
      const error = asText(payload.error) || asText(payload.message) || '子代理执行异常';
      return [{
        type: 'subagent-failed',
        subagentId,
        error,
      }];
    }

    case 'tool.start':
    case 'subagent.tool': {
      const actions: TurnAction[] = [];
      const subagentId = asText(payload.subagent_id);
      // 契约权威键是 tool_id（ToolStartPayload）；旧实现读 payload.id 恒空，
      // 时间戳兜底导致 complete 永不匹配 start、胶囊状态错乱的根因之一。
      const toolId =
        asText(payload.tool_id) || asText(payload.id) || asText(payload.tool_call_id) || `tool-${Date.now()}`;
      const name = asText(payload.name) || asText(payload.tool) || '工具执行';
      const args = typeof payload.args === 'string'
        ? payload.args
        : typeof payload.arguments === 'string'
        ? payload.arguments
        : JSON.stringify(payload.args || payload.parameters || payload.input || {});

      // 若为子代理工具调用，产出专职 subagent-log 保证独立执行流完整
      if (subagentId) {
        actions.push({
          type: 'subagent-log',
          subagentId,
          entry: {
            seq: Date.now(),
            timestamp: Date.now(),
            kind: 'tool_call',
            text: `[执行工具]: ${name}(${args})`,
          },
        });
      }

      if (messageId) {
        actions.push({ type: 'tool-start', messageId, toolCall: { id: toolId, name, args } });
      }
      return actions;
    }

    case 'tool.complete':
    case 'tool.end':
    case 'tool.error':
    case 'subagent.complete': {
      const actions: TurnAction[] = [];
      const subagentId = asText(payload.subagent_id);
      // ToolCompletePayload 权威键同样是 tool_id，与 start 保持同一主键才能精确配对
      const toolCallId = asText(payload.tool_id) || asText(payload.id) || asText(payload.tool_call_id) || '';
      
      const formatToolOutput = (val: unknown): string | undefined => {
        if (val === null || val === undefined) return undefined;
        if (typeof val === 'string') return val;
        try {
          return JSON.stringify(val, null, 2);
        } catch {
          return String(val);
        }
      };

      const output = formatToolOutput(payload.output ?? payload.result ?? payload.text ?? payload.error);

      // 若携带 subagentId，产出专职 subagent-complete 驱动子代理状态机完成
      if (subagentId) {
        actions.push({
          type: 'subagent-complete',
          subagentId,
          summary: output,
          output,
        });
        actions.push({
          type: 'subagent-log',
          subagentId,
          entry: {
            seq: Date.now(),
            timestamp: Date.now(),
            kind: 'tool_result',
            text: `[工具返回]: ${output ? output.slice(0, 300) : '完成'}`,
          },
        });
      }

      if (messageId) {
        actions.push({ type: 'tool-complete', messageId, toolCallId, output });
      }
      return actions;
    }

    case 'message.complete': {
      const finalText = asText(payload.text);
      const actions: TurnAction[] = [];
      // The completion payload carries the authoritative text of the turn; it
      // corrects any delta that was dropped while the socket was flapping.
      if (finalText && messageId) {
        actions.push({ type: 'replace-content', messageId, text: finalText });
      }
      // persisted_turn 是回合落盘后的权威行地址（user_row_id / final_assistant_row_id），
      // 渲染层据此把网关 rowId 绑定到本地乐观行，这是回滚截断锚点的唯一合法来源之一。
      const persisted = asRecord(payload.persisted_turn);
      const userRowId = typeof persisted.user_row_id === 'number' ? persisted.user_row_id : null;
      const assistantRowId =
        typeof persisted.final_assistant_row_id === 'number' ? persisted.final_assistant_row_id : null;
      const rowIds = Array.isArray(persisted.row_ids)
        ? persisted.row_ids.filter((v): v is number => typeof v === 'number')
        : [];
      if (messageId && (userRowId !== null || assistantRowId !== null || rowIds.length > 0)) {
        actions.push({ type: 'persisted-turn', messageId, userRowId, assistantRowId, rowIds });
      }
      const completeAction: TurnAction = { type: 'turn-completed' };
      if (frameSessionId) completeAction.sessionId = frameSessionId;
      if (finalText) completeAction.finalText = finalText;
      actions.push(completeAction);
      // The turn usually produced the first persisted message of a new session,
      // so the rail must be refreshed at the same moment the composer unlocks.
      actions.push({ type: 'refresh-sessions' });
      return actions;
    }

    default:
      return [];
  }
}
