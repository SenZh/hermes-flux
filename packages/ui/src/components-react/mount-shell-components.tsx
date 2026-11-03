import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StatusBar, type StatusBarProps } from './StatusBar.js';
import { Titlebar, type TitlebarProps } from './Titlebar.js';

export type StatusBarSnapshot = Omit<StatusBarProps, 'onClickStatus'>;
export type TitlebarSnapshot = Omit<TitlebarProps, 'onMinimize' | 'onMaximize' | 'onClose' | 'onToggleLeftRail' | 'onToggleInspector' | 'onOpenSettings' | 'onSwitchProfile' | 'onToggleTheme'>;
export type ShellActions = Pick<TitlebarProps, 'onMinimize' | 'onMaximize' | 'onClose' | 'onToggleLeftRail' | 'onToggleInspector' | 'onOpenSettings' | 'onSwitchProfile' | 'onToggleTheme'>;

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
