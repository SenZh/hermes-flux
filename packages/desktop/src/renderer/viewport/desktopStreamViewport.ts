/**
 * 桌面壳会话流视口管理器的宿主装配（Desktop Stream Viewport Wiring）
 *
 * 【设计意图 (Why)】
 *   `StreamViewportManager` 是纯领域类，只声明宿主能力（StreamViewportHost）而不碰真实 DOM 与全局状态。
 *   把「谁来满足这些能力」的装配代码收敛到本文件，`renderer/index.ts` 只留一次调用，
 *   既满足 1500 行模块上限，也让领域类保持可单测、装配关系可一眼读完。
 *
 * 【防范历史坑 (Pitfall)】
 *   Batch 7 拆分时遗漏了实例化，`streamViewportManager` 仅声明未赋值：
 *   `render()` 首帧调用 `captureStreamAnchor()` 立刻抛 TypeError，整棵渲染树中断、界面全黑，
 *   而构建、类型推导、全量单测全绿——静态门禁无法发现「只声明未装配」的运行时缺口。
 *
 * 【约束规则 (Rules)】
 *   1. 落定三状态（initialBottomSettling / settleMinFrames / settledLayoutSignature）必须由
 *      `streamSettleState` 单一真值源承载：conversationStreamController 与 messageWindowManager
 *      都直接读写它，若领域类自持副本，两方互不可见，首屏贴底会逐帧抖动；
 *   2. 本文件禁止 import 任何 `index.ts` 符号，只允许通过 deps 反向注入，保持单向分层。
 */

import type { FluxLogger } from '@hermes-flux/core';
import { type AppState, resolveActiveViewportKey } from '../state/appState.js';
import { StreamViewportManager } from './streamViewportManager.js';

type ScrollLogger = Pick<FluxLogger, 'trace' | 'debug'>;

/** 首屏落定与稳定帧计数的单一真值源，跨模块共享同一对象引用。 */
export interface StreamSettleState {
  initialBottomSettling: boolean;
  settleMinFrames: number;
  settledLayoutSignature: string;
}

export const streamSettleState: StreamSettleState = {
  initialBottomSettling: false,
  settleMinFrames: 0,
  settledLayoutSignature: '',
};

export interface DesktopStreamViewportDeps {
  readonly getState: () => AppState;
  readonly logScroll: ScrollLogger;
  readonly layoutSignature: () => string;
  readonly markProgrammaticScroll: (stream: HTMLElement) => void;
  readonly isPromptJumpSettling: () => boolean;
  readonly getWindowGeom: () => { start: number; end: number; averageRowHeightPx: number };
  readonly onBeforeSessionEnter?: () => void;
  readonly onViewportSettled?: () => void;
}

/**
 * 按桌面壳的真实 DOM 结构装配视口管理器。
 *
 * 【约束规则 (Rules)】虚拟窗口 / 中间舱 / 输入舱一律交给领域类内部 `document.querySelector` 兜底，
 *   此处不重复注入选择器，避免两处选择器字符串漂移。
 */
export function createDesktopStreamViewport(deps: DesktopStreamViewportDeps): StreamViewportManager {
  const settle = streamSettleState;
  return new StreamViewportManager({
    getStreamElement: () => document.getElementById('conversation-stream'),
    getActiveSessionId: () => resolveActiveViewportKey(deps.getState()),
    getPresenceLayout: () => deps.getState().presenceLayout,
    isPromptJumpSettling: () => deps.isPromptJumpSettling(),
    getMessageWindowEnd: () => deps.getWindowGeom().end,
    getMessageWindowStart: () => deps.getWindowGeom().start,
    getTotalMessages: () => deps.getState().messages.length,
    getAverageRowHeightPx: () => deps.getWindowGeom().averageRowHeightPx,
    layoutSignature: () => deps.layoutSignature(),
    markProgrammaticScroll: (stream) => deps.markProgrammaticScroll(stream),
    logTrace: (msg, meta) => deps.logScroll.trace(msg, meta),
    logDebug: (msg, meta) => deps.logScroll.debug(msg, meta),
    getInitialBottomSettling: () => settle.initialBottomSettling,
    setInitialBottomSettling: (val) => { settle.initialBottomSettling = val; },
    getSettleMinFrames: () => settle.settleMinFrames,
    setSettleMinFrames: (val) => { settle.settleMinFrames = val; },
    getSettledLayoutSignature: () => settle.settledLayoutSignature,
    setSettledLayoutSignature: (val) => { settle.settledLayoutSignature = val; },
    onBeforeSessionEnter: deps.onBeforeSessionEnter,
    onViewportSettled: deps.onViewportSettled,
  });
}
