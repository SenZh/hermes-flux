import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsModal } from './SettingsModal.js';
import { createShellMountUpdater } from '../mount-shell-components.js';
import type { SettingsActions, SettingsSnapshot } from './settingsModel.js';

/**
 * 设置中心挂载桥（与顶栏/左轨同一套 React 岛约定）。
 *
 * 【设计意图 (Why)】壳层每帧只推一份新快照，React 侧按 props diff 更新；
 *   宿主节点引用不变，输入框、滚动位置与弹窗开合状态都不会被 DOM 重建打断。
 *
 * 【防范的历史坑 (Pitfall)】旧实现每次 render() 都对 #flux-settings-modal-root 做
 *   outerHTML 替换：输入框靠 render() 前后抢救焦点，语言按钮因为每次重建而永远
 *   绑定不上事件。改为常驻挂载 + 快照驱动后，这两类问题从结构上消失。
 *
 * 【约束与规则 (Rules)】
 *   1. 宿主必须在挂载前已连接（createShellMountUpdater 内断言）；
 *   2. 该宿主不得再被任何 innerHTML / outerHTML 覆写；
 *   3. 关闭态由组件返回 null 表达，桥本身不做 DOM 增删。
 */
export function mountSettingsModal(
  host: HTMLElement,
  getSnapshot: () => SettingsSnapshot,
  actions: SettingsActions,
): () => void {
  const render = (): React.ReactElement => <SettingsModal snapshot={getSnapshot()} actions={actions} />;
  const update = createShellMountUpdater(host, render(), (element) => createRoot(element));
  return () => update(render());
}
