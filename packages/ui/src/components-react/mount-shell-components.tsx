import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StatusBar, type StatusBarProps } from './StatusBar.js';
import { Titlebar, type TitlebarProps } from './Titlebar.js';
import { LeftRail, type LeftRailProps } from './LeftRail.js';

export type StatusBarSnapshot = Omit<StatusBarProps, 'onClickStatus'>;
export type TitlebarSnapshot = Omit<TitlebarProps, 'onMinimize' | 'onMaximize' | 'onClose' | 'onToggleLeftRail' | 'onToggleInspector' | 'onOpenSettings' | 'onToggleTheme'>;
export type ShellActions = Pick<TitlebarProps, 'onMinimize' | 'onMaximize' | 'onClose' | 'onToggleLeftRail' | 'onToggleInspector' | 'onOpenSettings' | 'onToggleTheme'>;
export type LeftRailSnapshot = Omit<LeftRailProps, 'onSelectSession' | 'onSelectBot' | 'onSelectGroup' | 'onOpenSessionMenu' | 'onOpenBotMenu' | 'onOpenGroupMenu' | 'onSearchChange' | 'onNewChat' | 'onToggleSessions' | 'onToggleGroups' | 'onStartGroupRename' | 'onConfirmGroupRename' | 'onCancelGroupRename' | 'onResizeStart'>;export type LeftRailActions = Pick<LeftRailProps, 'onSelectSession' | 'onSelectBot' | 'onSelectGroup' | 'onOpenSessionMenu' | 'onOpenBotMenu' | 'onOpenGroupMenu' | 'onSearchChange' | 'onNewChat' | 'onToggleSessions' | 'onToggleGroups' | 'onStartGroupRename' | 'onConfirmGroupRename' | 'onCancelGroupRename' | 'onResizeStart'>;

function createUpdater<T>(host: HTMLElement, initial: React.ReactElement): (element: React.ReactElement) => void {
  return createShellMountUpdater(host, initial, (element) => createRoot(element));
}

export function getTitlebarSnapshot(snapshot: TitlebarSnapshot): TitlebarSnapshot {
  return { ...snapshot };
}

export function getStatusBarSnapshot(snapshot: StatusBarSnapshot): StatusBarSnapshot {
  return { ...snapshot };
}

export function createShellMountUpdater<T>(
  host: HTMLElement | null,
  initial: T,
  createRootForHost: (element: HTMLElement) => { render(value: T): void },
): (value: T) => void {
  if (!host || !host.isConnected) throw new Error('React shell host must be connected before mounting');
  const root = createRootForHost(host);
  root.render(initial);
  return (value) => root.render(value);
}

/** React 岛只持有具名宿主，避免后续模板局部更新销毁组件与事件。 */
export function mountStatusBar(host: HTMLElement, getSnapshot: () => StatusBarSnapshot, onClickStatus: StatusBarProps['onClickStatus']): () => void {
  const update = createUpdater(host, <StatusBar {...getSnapshot()} onClickStatus={onClickStatus} />);
  return () => update(<StatusBar {...getSnapshot()} onClickStatus={onClickStatus} />);
}

/** 快照更新只改变 props，平台操作通过壳传入的真实回调执行。 */
export function mountTitlebar(host: HTMLElement, getSnapshot: () => TitlebarSnapshot, actions: ShellActions): () => void {
  const render = (): React.ReactElement => <Titlebar {...getSnapshot()} {...actions} />;
  const update = createUpdater(host, render());
  return () => update(render());
}

/**
 * 左轨挂载桥。
 * 【设计意图】快照与回调分离：壳层每次 render 只推新快照，React 侧按 props diff 更新，宿主节点引用不变。
 * 【防范的历史坑】模板时代每帧对 #flux-left-rail 做 outerHTML 替换，导致搜索输入、滚动位置、行内重命名被重建。
 * 【约束与规则】挂载前宿主必须已连接（createShellMountUpdater 内断言），且该宿主不得再被任何 innerHTML 覆写。
 */
export function mountLeftRail(host: HTMLElement, getSnapshot: () => LeftRailSnapshot, actions: LeftRailActions): () => void {
  const render = (): React.ReactElement => <LeftRail {...getSnapshot()} {...actions} />;
  const update = createUpdater(host, render());
  return () => update(render());
}
