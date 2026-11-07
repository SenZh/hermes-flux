/**
 * CDP 浏览器测试桥（esbuild 打包入口）
 *
 * 设计意图 (Why)：
 *   消息行已 100% 由 React 渲染，模板字符串路径已删除。
 *   浏览器内的物理验证与性能门禁必须挂载真实组件，而不是另造一套假渲染。
 *   浏览器无法直接解析裸模块说明符 'react'，因此由 esbuild 打成 IIFE 注入页面。
 *
 * 防范的历史坑 (Pitfall)：
 *   历史 harness 直接 import 已删除的 renderMessage，导致整个 CDP 套件静默全红。
 *
 * 约束与规则 (Rules)：
 *   1. 只暴露 window.__fluxReact / window.__fluxRenderers，不污染其它全局；
 *   2. snapshot 结构与生产 ConversationSnapshot 完全一致；
 *   3. ready 标志必须在全部导出就绪后最后设置。
 */

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConversationMessageList } from '../../dist/components-react/conversation/index.js';
import { renderToolCapsuleSlot, renderConversationCanvas } from '../../dist/components/MiddlePod/MiddlePod.js';
import { renderInputDock } from '../../dist/components/InputDock/InputDock.js';
import { applyFontPreferences, loadFontPreferences } from '../../dist/tokens/fontPreferences.js';
import { generateSynthetic5000Messages } from '../../../../scripts/gates/synthetic-messages.mjs';

// 字号与字体 Token 必须与生产同路径写入 :root，否则 harness 量的是没有语义字号的裸页面
applyFontPreferences(loadFontPreferences());

/** 组装与生产同构的对话快照 */
function buildSnapshot(messages, options = {}) {
  return {
    mode: options.mode || 'scratchpad',
    connection: 'connected',
    messages,
    isStreaming: Boolean(options.isStreaming),
    hasOlderMessages: Boolean(options.hasOlderMessages),
    isLoadingOlder: Boolean(options.isLoadingOlder),
  };
}

/** 静态渲染为 HTML 字符串（用于断言结构，不用于性能测量） */
function renderMessages(messages, options = {}) {
  return renderToStaticMarkup(
    React.createElement(ConversationMessageList, { snapshot: buildSnapshot(messages, options) })
  );
}

/**
 * 在指定宿主上真实挂载消息列表。
 * 返回 render() 以便测试主动触发重渲染。
 */
function mountMessages(host, messages, options = {}) {
  const root = createRoot(host);
  const render = (nextMessages = messages) => {
    root.render(
      React.createElement(ConversationMessageList, { snapshot: buildSnapshot(nextMessages, options) })
    );
  };
  render(messages);
  return { root, render, unmount: () => root.unmount() };
}

window.__fluxReact = {
  React,
  createRoot,
  renderToStaticMarkup,
  ConversationMessageList,
  buildSnapshot,
  renderMessages,
  mountMessages,
};

window.__fluxRenderers = {
  renderMessages,
  /** 兼容旧断言签名：单条消息渲染 */
  renderMessage: (message, _agentName, options = {}) => renderMessages([message], options),
  renderToolCapsuleSlot,
  renderConversationCanvas,
  renderInputDock,
};

/**
 * 性能门禁数据：取 5000 条合成会话的最后 50 条。
 * 【设计意图 (Why)】与生产窗口化窗口大小一致，且与 Node 侧 perf-benchmark 同源，
 *   两边跑同一份数据才能互相对照。
 */
window.__perfMessages = generateSynthetic5000Messages().slice(-50);

window.__stageReady = true;
