/**
 * 测试用消息渲染助手：把消息数组渲染成静态 HTML。
 *
 * 【设计意图 (Why)】
 *   消息行已 100% 由 React 组件渲染，模板路径已删除。
 *   测试必须断言真实组件输出，而不是另造一套字符串路径，否则测的是幽灵代码。
 *
 * 【约束与规则 (Rules)】
 *   1. 唯一入口渲染 ConversationMessageList，与生产同构；
 *   2. 参数形状与宿主 ConversationSnapshot 保持一致。
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConversationMessageList } from '../../dist/components-react/conversation/index.js';

/**
 * 渲染消息列表。
 * @param {Array} messages 消息数组
 * @param {{ mode?: 'scratchpad'|'foreground'|'group', isStreaming?: boolean }} options
 */
export function renderMessages(messages, options = {}) {
  const snapshot = {
    mode: options.mode ?? 'scratchpad',
    connection: 'connected',
    messages,
    isStreaming: Boolean(options.isStreaming),
    hasOlderMessages: Boolean(options.hasOlderMessages),
    isLoadingOlder: Boolean(options.isLoadingOlder),
  };
  return renderToStaticMarkup(React.createElement(ConversationMessageList, { snapshot }));
}

/**
 * 渲染单条消息（内部走同一份列表组件，保证与生产一致）。
 */
export function renderOne(message, options = {}) {
  return renderMessages([message], options);
}
