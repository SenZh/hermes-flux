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

import { renderToStaticMarkup } from 'react-dom/server';
import { Titlebar } from '../../dist/components-react/Titlebar.js';
import { renderLeftRailHtml } from '../../dist/components-react/leftRailStaticRender.js';
import { renderMiddlePod } from '../../dist/components/MiddlePod/MiddlePod.js';
import { renderInputDock } from '../../dist/components/InputDock/InputDock.js';
import { renderContextMenu } from '../../dist/components/ContextMenu/ContextMenu.js';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ConversationMessageList } from '../../dist/components-react/conversation/index.js';

/**
 * 顶栏静态渲染：复用生产 React 组件，禁止再引入第二套字符串模板。
 * 【设计意图 (Why)】harness 渲染的 DOM 必须与发货实现逐字同源，否则断言的是不存在的视觉。
 * 【约束与规则 (Rules)】交互回调一律 noop：静态渲染不承载行为，harness 也不会绑顶栏按钮。
 */
function renderTitlebar(props = {}) {
  const noop = () => {};
  return renderToStaticMarkup(
    React.createElement(Titlebar, {
      platform: props.platform ?? 'windows',
      title: props.title ?? '',
      isMaximized: Boolean(props.isMaximized),
      gatewayConnected: Boolean(props.gatewayConnected),
      leftRailCollapsed: Boolean(props.leftRailCollapsed),
      inspectorCollapsed: props.inspectorCollapsed !== false,
      onMinimize: noop,
      onMaximize: noop,
      onClose: noop,
      onToggleLeftRail: noop,
      onToggleInspector: noop,
      onOpenSettings: noop,
    })
  );
}

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
