/**
 * e2e 验收测试桥（esbuild 打包入口）
 *
 * 设计意图 (Why)：
 *   壳层模板与左轨静态渲染都依赖 react / react-dom，浏览器无法解析裸模块说明符。
 *   这里把被测渲染器统一打包成 IIFE，页面通过 window.__e2e 取用。
 *
 * 约束与规则 (Rules)：
 *   1. 只暴露渲染函数，不承载任何测试逻辑；
 *   2. 必须使用生产 dist 产物，禁止 mock。
 */

import { renderTitlebar } from '../../dist/components/Titlebar/Titlebar.js';
import { renderLeftRailHtml } from '../../dist/components-react/leftRailStaticRender.js';
import { renderMiddlePod } from '../../dist/components/MiddlePod/MiddlePod.js';
import { renderInputDock } from '../../dist/components/InputDock/InputDock.js';
import { renderContextMenu } from '../../dist/components/ContextMenu/ContextMenu.js';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ConversationMessageList } from '../../dist/components-react/conversation/index.js';

/**
 * 消息列表真实挂载。
 * 【设计意图 (Why)】renderMiddlePod 只输出 #react-message-list-host 骨架，
 *   消息行 100% 由 React 渲染；不挂载就等于消息区空白。
 */
function mountMessages(host, messages, options = {}) {
  const root = createRoot(host);
  root.render(
    React.createElement(ConversationMessageList, {
      snapshot: {
        mode: options.mode || 'scratchpad',
        connection: 'connected',
        messages,
        isStreaming: Boolean(options.isStreaming),
      },
    })
  );
  return root;
}

window.__e2e = {
  renderTitlebar,
  renderLeftRailHtml,
  renderMiddlePod,
  renderInputDock,
  renderContextMenu,
  mountMessages,
};
