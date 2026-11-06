/**
 * 回合分组
 *
 * 设计意图(Why)：
 *   单聊中同角色连续消息共享头像与页脚；群聊中不同发送者即使都是 assistant 也必须断开回合。
 *
 * 防范的历史坑(Pitfall)：
 *   历史实现只比较 role，导致群聊第二位 Agent 的头像被误判为同回合而隐藏。
 *
 * 约束与规则(Rules)：
 *   memo 包裹，流式期间不因无关 props 重渲染；本组件只输出结构，不做数据解析。
 */

import * as React from 'react';
import type { ConversationMessageVM, ConversationMode } from './types.js';
import { MessageRow } from './MessageRow.js';

export interface TurnGroupProps {
  messages: ConversationMessageVM[];
  mode: ConversationMode;
  isLastTurn: boolean;
  isStreaming: boolean;
}

const areEqual = (prev: TurnGroupProps, next: TurnGroupProps): boolean => {
  if (prev.mode !== next.mode || prev.isLastTurn !== next.isLastTurn || prev.isStreaming !== next.isStreaming) {
    return false;
  }
  if (prev.messages.length !== next.messages.length) return false;
  for (let i = 0; i < prev.messages.length; i++) {
    const a = prev.messages[i];
    const b = next.messages[i];
    if (a === b) continue;
    if (a.id !== b.id || a.content !== b.content || a.thought !== b.thought || a.status !== b.status) return false;
    if (
      a.rowId !== b.rowId ||
      a.sender !== b.sender ||
      a.timestamp !== b.timestamp ||
      a.model !== b.model ||
      a.durationMs !== b.durationMs ||
      a.thoughtDurationMs !== b.thoughtDurationMs
    ) {
      return false;
    }
    if ((a.toolCalls?.length ?? 0) !== (b.toolCalls?.length ?? 0)) return false;
    if (a.toolCalls && b.toolCalls) {
      for (let j = 0; j < a.toolCalls.length; j++) {
        const ta = a.toolCalls[j];
        const tb = b.toolCalls[j];
        if (ta === tb) continue;
        if (
          ta.status !== tb.status ||
          ta.output !== tb.output ||
          ta.name !== tb.name ||
          ta.args !== tb.args ||
          ta.durationMs !== tb.durationMs
        ) {
          return false;
        }
      }
    }
  }
  return true;
};

export const TurnGroup = React.memo(function TurnGroup({
  messages,
  mode,
  isLastTurn,
  isStreaming,
}: TurnGroupProps): React.ReactElement {
  const lastIndex = messages.length - 1;
  return (
    <div
      className="conv-turn"
      data-conv-turn={messages[0]?.id ?? ''}
      data-conv-turn-last={isLastTurn ? 'true' : 'false'}
      data-conv-streaming={isStreaming ? 'true' : 'false'}
    >
      {messages.map((message, index) => (
        <MessageRow
          key={message.id}
          message={message}
          isFirstInTurn={index === 0}
          isLastInTurn={index === lastIndex}
          mode={mode}
          isStreaming={isStreaming && index === lastIndex}
        />
      ))}
    </div>
  );
}, areEqual);

export function groupTurns(messages: ConversationMessageVM[]): ConversationMessageVM[][] {
  const turns: ConversationMessageVM[][] = [];
  for (const message of messages) {
    const current = turns[turns.length - 1];
    const previous = current?.[current.length - 1];
    const differentSender = Boolean(previous?.sender && message.sender && previous.sender !== message.sender);
    if (!previous || previous.role !== message.role || differentSender) {
      turns.push([message]);
    } else {
      current.push(message);
    }
  }
  return turns;
}
