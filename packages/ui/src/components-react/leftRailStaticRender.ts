/**
 * 左轨静态渲染辅助（仅供服务端/测试使用）。
 *
 * 设计意图 (Why)：壳层与测试需要"给定快照 → 左轨 HTML"的确定性入口，而 react / react-dom
 *   只安装在 @hermes-flux/ui 包内。把静态渲染收敛在这里，desktop 侧无需直接依赖 React，
 *   也避免把 react-dom/server 拖进浏览器打包产物（渲染器只走 mountLeftRail 客户端挂载）。
 * 防范的历史坑 (Pitfall)：desktop 测试若自行 import react，会在 workspace 依赖布局下直接 ERR_MODULE_NOT_FOUND。
 * 约束与规则 (Rules)：本模块禁止被 renderer 入口导入；它只允许出现在测试与服务端渲染路径。
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LeftRail, type LeftRailProps } from './LeftRail.js';
import { buildLeftRailModel, type LeftRailModelInput } from './leftRailModel.js';
import type { ActivityIndicatorVariant } from '../tokens/activityIndicator.js';

/** 快照输入：壳层需要提供的原始数据 + 少量交互态。 */
export interface LeftRailHtmlSnapshot extends LeftRailModelInput {
  collapsed: boolean;
  editingGroupRoomId?: string;
  /** 活动指示器变体；缺省时组件回落到 cloud，与客户端挂载的默认值一致。 */
  activityVariant?: ActivityIndicatorVariant;
}

/**
 * 把快照渲染成左轨 HTML 字符串。
 * 【约束与规则】交互回调一律为 noop：静态渲染不承载行为，行为由 mountLeftRail 注入。
 */
export function renderLeftRailHtml(snapshot: LeftRailHtmlSnapshot): string {
  const noop = (): void => {};
  const props: LeftRailProps = {
    model: buildLeftRailModel(snapshot),
    collapsed: snapshot.collapsed,
    searchQuery: snapshot.searchQuery,
    editingGroupRoomId: snapshot.editingGroupRoomId,
    groupAvatars: snapshot.profiles,
    activityVariant: snapshot.activityVariant,
    onSelectSession: noop,
    onSelectBot: noop,
    onSelectGroup: noop,
    onOpenSessionMenu: noop,
    onOpenBotMenu: noop,
    onOpenGroupMenu: noop,
    onSearchChange: noop,
    onNewChat: noop,
    onToggleSessions: noop,
    onToggleGroups: noop,
    onStartGroupRename: noop,
    onConfirmGroupRename: noop,
    onCancelGroupRename: noop,
    onResizeStart: noop,
  };
  return renderToStaticMarkup(React.createElement(LeftRail, props));
}
