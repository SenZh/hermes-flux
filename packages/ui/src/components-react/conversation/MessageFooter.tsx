/**
 * 消息页脚（时间 + 操作按钮）· 全场景唯一实现
 *
 * 设计意图(Why)：
 *   用户消息、Bot 主工位、群聊研讨室、普通会话的页脚形态必须完全相同，
 *   差异只允许出现在「有哪些按钮」和「左右对齐」上。
 *   曾各自手写一套，导致时间格式、按钮尺寸、hover 反馈三处漂移。
 *
 * 防范的历史坑(Pitfall)：
 *   - 时间戳在助手行与用户行各出现一次，相邻消息之间出现两个时间锚点；
 *   - 按钮 hover 用整块底色，深色主题下像一块补丁；
 *   - 页脚常显，视觉噪音盖过正文。
 *
 * 约束与规则(Rules)：
 *   1. 页脚默认透明，仅在消息 hover / 内部 focus 时整体浮现；触屏设备常显；
 *   2. 时间前必须带时钟图标，与 OpenChamber 的 message-footer 一致；
 *   3. 按钮 hover 只改文字颜色，不画背景块、不加边框；
 *   4. 保留 .conv-message__footer / .assistant-footer-bar / .msg-action-btn /
 *      .time-tag / data-action 等既有钩子，宿主事件委托与测试依赖它们。
 */

import * as React from 'react';
import { t } from '../../i18n/index.js';
import type { ConversationMessageVM, ConversationMode } from './types.js';

function CopyIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function RollbackIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  );
}

function ForkIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

/** 时间前的时钟图标：14px，与 OpenChamber message-footer 同尺寸 */
function ClockIcon(): React.ReactElement {
  return (
    <svg
      className="conv-footer__clock"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7.5 12 12 15 13.5" />
    </svg>
  );
}

function ActionButton({
  action,
  message,
  label,
  children,
}: {
  action: 'copy-msg' | 'rollback-msg' | 'fork-msg';
  message: ConversationMessageVM;
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      className="msg-action-btn"
      data-action={action}
      data-msg-id={message.id}
      data-row-id={message.rowId ?? ''}
      data-content={message.content}
      data-tooltip={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

export interface ConversationMessageFooterProps {
  message: ConversationMessageVM;
  mode: ConversationMode;
  /** 角色只决定对齐方向与默认操作集，不产生第二套结构 */
  role: 'user' | 'assistant';
  /** 助手行额外信息：模型徽标、生成耗时 */
  meta?: React.ReactNode;
  /** 流式思考/中间步骤不渲染页脚，由调用方控制 */
  isStreaming?: boolean;
}

export function ConversationMessageFooter({
  message,
  mode,
  role,
  meta,
  isStreaming = false,
}: ConversationMessageFooterProps): React.ReactElement | null {
  const isUser = role === 'user';
  const isOrdinary = mode === 'scratchpad';
  if (isStreaming) return null;

  const actions = (
    <span className="conv-message__actions conv-footer__actions">
      <ActionButton action="copy-msg" message={message} label={t('chat.copy')}>
        <CopyIcon />
      </ActionButton>
      {isOrdinary ? (
        <ActionButton action="rollback-msg" message={message} label={t('chat.rollback')}>
          <RollbackIcon />
        </ActionButton>
      ) : null}
      {isOrdinary ? (
        <ActionButton action="fork-msg" message={message} label={t('chat.fork')}>
          <ForkIcon />
        </ActionButton>
      ) : null}
    </span>
  );

  // 每条消息都在自己页脚给出时间：用户与 Agent 输出共用同一时间样式
  const stamp = message.timestamp ? (
    <span className="conv-message__meta conv-footer__time time-tag">
      <ClockIcon />
      {message.timestamp}
    </span>
  ) : null;

  const info = meta || stamp ? (
    <span className="conv-footer__info">
      {meta}
      {stamp}
    </span>
  ) : null;

  return (
    <div
      className={`conv-message__footer conv-footer${isUser ? ' conv-footer--user' : ' conv-footer--assistant'}${isUser ? '' : ' assistant-footer-bar'}`}
    >
      {isUser ? (
        <>
          {info}
          {actions}
        </>
      ) : (
        <>
          {actions}
          {info}
        </>
      )}
    </div>
  );
}
