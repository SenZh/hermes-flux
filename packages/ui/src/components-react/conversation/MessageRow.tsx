/**
 * 单条消息行
 *
 * 设计意图(Why)：
 *   用户气泡与助手通栏共用一套外壳；思考、工具、正文、页脚按固定顺序挂载。
 *   思考行与工具行统一由 StreamRow 渲染，避免两套行结构造成间距与字号漂移。
 *
 * 约束与规则(Rules)：
 *   1. 正文使用现有 Markdown 渲染器，经 dangerouslySetInnerHTML 注入；
 *   2. 保留 #msg-content-* / #msg-thought-* / #msg-tools-* 锚点，流式直写仍然有效；
 *   3. 操作按钮保留 data-action 属性，复用宿主的事件委托，不新增回调通道。
 */

import * as React from 'react';
import { t } from '../../i18n/index.js';
import { MarkdownBlock } from './MarkdownBlock.js';
import { StreamRow } from './StreamRow.js';
import { ToolSection } from './ToolCapsule.js';
import type { ConversationMode, ConversationMessageVM } from './types.js';

export interface MessageRowProps {
  message: ConversationMessageVM;
  isFirstInTurn: boolean;
  isLastInTurn: boolean;
  mode: ConversationMode;
  isStreaming: boolean;
}

function Icon({ name }: { name: 'copy' | 'rollback' | 'fork' }): React.ReactElement {
  if (name === 'copy') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </svg>
    );
  }
  if (name === 'rollback') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

function ActionButton({
  action,
  message,
  label,
}: {
  action: 'copy-msg' | 'rollback-msg' | 'fork-msg';
  message: ConversationMessageVM;
  label: string;
}): React.ReactElement {
  return (
    <button
      className="msg-action-btn"
      data-action={action}
      data-msg-id={message.id}
      data-row-id={message.rowId ?? ''}
      data-content={message.content}
      title={label}
      aria-label={label}
    >
      <Icon name={action === 'copy-msg' ? 'copy' : action === 'rollback-msg' ? 'rollback' : 'fork'} />
    </button>
  );
}

function MessageFooter({
  actions,
  meta,
  alignEnd = false,
  metaFirst = false,
  assistant = false,
}: {
  actions: React.ReactNode;
  meta?: React.ReactNode;
  alignEnd?: boolean;
  metaFirst?: boolean;
  /** 助手回合页脚额外挂 assistant-footer-bar，与既有 CSS 钩子对齐 */
  assistant?: boolean;
}): React.ReactElement {
  return (
    <div
      className={`conv-message__footer${alignEnd ? ' conv-message__footer--end' : ''}${
        assistant ? ' assistant-footer-bar' : ''
      }`}
    >
      {metaFirst && meta ? <span className="conv-message__meta">{meta}</span> : null}
      <span className="conv-message__actions">{actions}</span>
      {!metaFirst && meta ? <span className="conv-message__meta">{meta}</span> : null}
    </div>
  );
}

export function MessageRow({
  message,
  isFirstInTurn,
  isLastInTurn,
  mode,
  isStreaming,
}: MessageRowProps): React.ReactElement {
  const isUser = message.role === 'user';
  const isOrdinary = mode === 'scratchpad';
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
        <MessageFooter
          alignEnd
          metaFirst
          actions={
            <>
              <ActionButton action="copy-msg" message={message} label={t('chat.copy')} />
              {isOrdinary ? (
                <>
                  <ActionButton action="rollback-msg" message={message} label={t('chat.rollback')} />
                  <ActionButton action="fork-msg" message={message} label={t('chat.fork')} />
                </>
              ) : null}
            </>
          }
          meta={message.timestamp}
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

      <MarkdownBlock content={message.content} anchorId={`msg-content-${message.id}`} className="conv-message__body" />

      {isLastInTurn && !isStreaming ? (
        <MessageFooter
          assistant
          actions={
            <>
              <ActionButton action="copy-msg" message={message} label={t('chat.copy')} />
              {isOrdinary ? <ActionButton action="fork-msg" message={message} label={t('chat.fork')} /> : null}
            </>
          }
          meta={
            <>
              {message.model ? <span className="conv-message__model model-tag">{message.model}</span> : null}
              {message.durationMs ? (
                <span className="duration-tag">{(message.durationMs / 1000).toFixed(1)}s</span>
              ) : null}
              {message.timestamp ? <span className="time-tag">{message.timestamp}</span> : null}
            </>
          }
        />
      ) : null}
    </div>
  );
}
