/**
 * 窗口控制纯决策层（主进程）。
 *
 * 设计意图 (Why)：
 *   标题栏的"最大化/还原"按钮在三种窗口姿态下语义不同（普通 / 最大化 / 全屏），
 *   但 Electron 只有两个布尔探针。把这段三向决策从 ipc.ts 的副作用里抽出来，
 *   才能在不启动 Electron 的前提下对全部姿态组合落盘断言。
 *
 * 防范的历史坑 (Pitfall)：
 *   历史实现只判断 isMaximized()，全屏窗口两个分支都不命中——unmaximize() 对全屏无效、
 *   maximize() 被系统忽略，用户点按钮毫无反应，只能靠 ESC 逃生。
 *
 * 约束与规则 (Rules)：
 *   全屏优先级最高：只要 isFullScreen() 为真就必须退出全屏，不得同时触发 unmaximize()；
 *   本模块零 Electron 依赖，禁止在此引入 ipcMain / BrowserWindow 类型。
 */

/** 窗口"最大化/还原"按钮的三种决策结果。 */
export type WindowToggleDecision = 'exit-full-screen' | 'unmaximize' | 'maximize';

/** 窗口姿态探针：由调用方从真实 BrowserWindow 读取后注入。 */
export interface WindowStateProbe {
  readonly isFullScreen: boolean;
  readonly isMaximized: boolean;
}

/**
 * 依据当前窗口姿态决定"最大化/还原"按钮该做什么。
 *
 * 不变量：返回值集合恒为三态之一，不存在"无所作为"的第四态。
 */
export function resolveWindowToggle(state: WindowStateProbe): WindowToggleDecision {
  if (state.isFullScreen) return 'exit-full-screen';
  if (state.isMaximized) return 'unmaximize';
  return 'maximize';
}

/**
 * 标题栏图标应呈现"还原"还是"最大化"。
 *
 * 约束：全屏与最大化共享"还原"图标语义。只报 isMaximized() 会让启动同步
 * 或窗口态重广播把全屏窗口的图标打回"最大化"，与实际窗口状态撕裂。
 */
export function resolveTitlebarMaximized(state: WindowStateProbe): boolean {
  return state.isMaximized || state.isFullScreen;
}
