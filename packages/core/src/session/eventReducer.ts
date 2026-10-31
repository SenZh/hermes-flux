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
 */

export interface TurnEventContext {
  /** Every id identifying the conversation currently on screen (live id + stored id). */
  activeSessionIds: readonly string[];
  /** Assistant message that streamed deltas belong to, or null when no turn is open. */
  activeStreamingMessageId: string | null;
}

export type TurnAction =
  | { type: 'turn-started' }
  | { type: 'turn-completed'; finalText?: string }
  | { type: 'turn-failed'; message: string }
  | { type: 'append-content'; messageId: string; text: string }
  | { type: 'append-thought'; messageId: string; text: string }
  | { type: 'replace-content'; messageId: string; text: string }
  | { type: 'tool-start'; messageId: string; toolCall: { id: string; name: string; args: string } }
  | { type: 'tool-complete'; messageId: string; toolCallId: string; output?: string }
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
  | { type: 'session-title'; sessionId: string; title: string };

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
    return [{ type: 'turn-failed', message }];
  }

  // --- Turn-scoped events: ignore streams belonging to other sessions ------
  if (frameSessionId && ctx.activeSessionIds.length > 0 && !ctx.activeSessionIds.includes(frameSessionId)) {
    return [];
  }

  const messageId = ctx.activeStreamingMessageId;

  switch (type) {
    case 'message.start':
      return [{ type: 'turn-started' }];

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
      const toolId = asText(payload.id) || asText(payload.tool_call_id) || `tool-${Date.now()}`;
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
    case 'subagent.complete': {
      const actions: TurnAction[] = [];
      const subagentId = asText(payload.subagent_id);
      const toolCallId = asText(payload.id) || asText(payload.tool_call_id) || '';
      const output = payload.output
        ? String(payload.output)
        : payload.result
        ? String(payload.result)
        : payload.text
        ? String(payload.text)
        : undefined;

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
      actions.push({ type: 'turn-completed', finalText: finalText || undefined });
      // The turn usually produced the first persisted message of a new session,
      // so the rail must be refreshed at the same moment the composer unlocks.
      actions.push({ type: 'refresh-sessions' });
      return actions;
    }

    default:
      return [];
  }
}
