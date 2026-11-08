/**
 * 单条消息行
 *
 * 设计意图(Why)：
 *   用户气泡与助手通栏共用一套外壳；思考、工具、正文、页脚按固定顺序挂载。
 *   页脚（时间 + 操作按钮）收敛到 ConversationMessageFooter 唯一实现，
 *   用户 / Bot 主工位 / 群聊只通过 role 与 mode 适配，不再各自拼一份。
 *
 * 约束与规则(Rules)：
 *   1. 正文使用现有 Markdown 渲染器，经 dangerouslySetInnerHTML 注入；
 *   2. 保留 #msg-content-* / #msg-thought-* / #msg-tools-* 锚点，流式直写仍然有效；
 *   3. 操作按钮保留 data-action 属性，复用宿主的事件委托，不新增回调通道；
 *   4. 流式进行中不渲染页脚，避免生成过程中暴露操作与时间。
 */

import * as React from 'react';
import { t } from '../../i18n/index.js';
import { MarkdownBlock } from './MarkdownBlock.js';
import { StreamRow } from './StreamRow.js';
import { ToolSection } from './ToolCapsule.js';
import { ConversationMessageFooter } from './MessageFooter.js';
import type { ConversationMode, ConversationMessageVM } from './types.js';

export interface MessageRowProps {
  message: ConversationMessageVM;
  isFirstInTurn: boolean;
  isLastInTurn: boolean;
  mode: ConversationMode;
  /** 语言标识：参与 memo 浅比较，确保语言切换后已挂载行重新渲染。 */
  locale?: string;
  isStreaming: boolean;
  /** 会话内 Agent 真实读写过的文件（决定正文里的文件引用是否可点击） */
  knownFiles?: readonly string[];
}

export const MessageRow = React.memo(function MessageRow({
  message,
  isFirstInTurn,
  isLastInTurn,
  mode,
  isStreaming,
  knownFiles,
}: MessageRowProps): React.ReactElement {
  const isUser = message.role === 'user';
  const thoughtSummary = message.thought ? message.thought.replace(/\s+/g, ' ').trim().slice(0, 60) : '';

  if (isUser) {
    return (
      <div
        className="conv-message conv-message--user"
        data-role="user"
        data-msg-id={message.id}
        data-row-id={message.rowId ?? ''}
      >
        <div className="conv-message__bubble">{message.content}</div>
        <ConversationMessageFooter
          message={message}
          mode={mode}
          role="user"
          isStreaming={isStreaming}
        />
      </div>
    );
  }

  return (
    <div
      className="conv-message conv-message--assistant"
      data-role={message.role}
      data-msg-id={message.id}
      data-conv-status={message.status}
    >
      {isFirstInTurn && message.sender ? (
        <div className="conv-message__header message-sender-badge">
          {message.senderAvatar ? (
            <img className="conv-message__avatar" src={message.senderAvatar} alt={message.sender} />
          ) : null}
          <span className="conv-message__sender">{message.sender}</span>
        </div>
      ) : null}

      {message.thought ? (
        <StreamRow
          kind="thought"
          label={t('conversation.thought')}
          target={thoughtSummary || undefined}
          meta={message.thoughtDurationMs ? `${(message.thoughtDurationMs / 1000).toFixed(1)}s` : undefined}
          expandable
          title={thoughtSummary}
        >
          <div className="conv-row__thought" id={`msg-thought-${message.id}`}>
            {message.thought}
          </div>
        </StreamRow>
      ) : null}

      <ToolSection messageId={message.id} tools={message.toolCalls ?? []} />

      <MarkdownBlock content={message.content} anchorId={`msg-content-${message.id}`} className="conv-message__body" knownFiles={knownFiles} />

      {isLastInTurn && !isStreaming ? (
        <ConversationMessageFooter
          message={message}
          mode={mode}
          role="assistant"
          meta={
            <>
              {message.model ? <span className="conv-message__model model-tag">{message.model}</span> : null}
              {message.durationMs ? (
                <span className="duration-tag">{(message.durationMs / 1000).toFixed(1)}s</span>
              ) : null}
            </>
          }
        />
      ) : null}
    </div>
  );
});
