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
import { sanitizeCompactedMessage, isTimelineKind } from '@hermes-flux/core';

/**
 * 标注展开开关的键盘激活：role="button" 承诺 Enter 与 Space 可用。
 * Space 必须 preventDefault，否则会连带滚动会话流。
 */
function handleToggleKey(event: React.KeyboardEvent<HTMLElement>, toggle: () => void): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    toggle();
  }
}

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
  locale,
  isStreaming,
  knownFiles,
}: MessageRowProps): React.ReactElement | null {
  const isUser = message.role === 'user';
  const displayKind = message.displayKind ?? 'user';
  const thoughtSummary = message.thought ? message.thought.replace(/\s+/g, ' ').trim().slice(0, 60) : '';

  // 动态投影：剥离 [CONTEXT COMPACTION] 机器技术总结，气泡只展示人类提问。
  // 【规则】display_kind 已判定的行不再走文本兜底，避免两套判别互相覆盖。
  const compactedInfo = React.useMemo(() => {
    return isUser && displayKind === 'user' ? sanitizeCompactedMessage(message.content || '') : null;
  }, [isUser, displayKind, message.content]);

  const [isCompactedOpen, setIsCompactedOpen] = React.useState(false);
  const [isEventDetailOpen, setIsEventDetailOpen] = React.useState(false);

  // 时间线事件：网关自注入的换模型 / 后台回执 / 续跑提示，只画单行标记，不画气泡。
  // 【规则】标签一律走 i18n，网关的英文 display_text 只进可展开详情，避免中文界面出现英文句子。
  const timelineLabel = React.useMemo(() => {
    if (!isTimelineKind(displayKind)) return '';
    switch (displayKind) {
      case 'model_switch':
        return t('conversation.modelChanged');
      case 'process_complete':
        return t('conversation.backgroundFinished');
      case 'async_delegation_complete': {
        const count = message.displayMetadata?.task_count;
        return typeof count === 'number' && count > 0
          ? t('conversation.delegationFinishedCount', { count })
          : t('conversation.delegationFinished');
      }
      case 'auto_continue':
        return t('conversation.autoContinued');
      default:
        return t('conversation.systemNotice');
    }
  }, [displayKind, message.displayMetadata, locale]);

  if (displayKind === 'hidden') {
    return null;
  }

  if (isTimelineKind(displayKind)) {
    const displayText = message.displayMetadata?.display_text;
    const detail = [displayText, message.content?.trim()].filter(Boolean).join('\n\n');
    return (
      <div className="conv-event" data-role="event" data-msg-id={message.id} data-event-kind={displayKind}>
        <span className="conv-event__dot" />
        <span className="conv-event__label">{timelineLabel}</span>
        {detail ? (
          <span
            className="conv-annot-toggle"
            role="button"
            tabIndex={0}
            onClick={() => setIsEventDetailOpen((prev) => !prev)}
            onKeyDown={(event) => handleToggleKey(event, () => setIsEventDetailOpen((prev) => !prev))}
          >
            {isEventDetailOpen ? t('conversation.hideEventDetail') : t('conversation.viewEventDetail')}
          </span>
        ) : null}
        {detail && isEventDetailOpen ? <div className="conv-raw-panel conv-event__detail">{detail}</div> : null}
      </div>
    );
  }

  // 【消除空白占位 Bug 2 根因】：如果助手行既无正文、又无思考、且无工具调用，直接返回 null，严禁渲染空占位 DOM
  const hasContent = Boolean(message.content && message.content.trim());
  const hasThought = Boolean(message.thought && message.thought.trim());
  const hasTools = Boolean(message.toolCalls && message.toolCalls.length > 0);
  if (!isUser && !hasContent && !hasThought && !hasTools) {
    return null;
  }

  if (isUser) {
    const displayContent = compactedInfo?.isHandoffCompaction
      ? compactedInfo.displayContent
      : message.content;

    return (
      <div
        className="conv-message conv-message--user"
        data-role="user"
        data-msg-id={message.id}
        data-row-id={message.rowId ?? ''}
      >
        {compactedInfo?.isHandoffCompaction && compactedInfo.compactedSummary ? (
          <div>
            <div
              className="conv-handoff-pill"
              role="button"
              tabIndex={0}
              onClick={() => setIsCompactedOpen((prev) => !prev)}
              onKeyDown={(event) => handleToggleKey(event, () => setIsCompactedOpen((prev) => !prev))}
            >
              <span className="conv-handoff-pill__dot" />
              <span>{t('conversation.contextCompacted')}</span>
              <span style={{ opacity: 0.6 }}>
                {isCompactedOpen ? t('conversation.hideCompactedContext') : t('conversation.viewCompactedContext')}
              </span>
            </div>
            {isCompactedOpen ? (
              <div className="conv-raw-panel conv-handoff-panel">{compactedInfo.compactedSummary}</div>
            ) : null}
          </div>
        ) : null}

        {displayContent ? (
          <div className="conv-message__bubble">{displayContent}</div>
        ) : null}

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
