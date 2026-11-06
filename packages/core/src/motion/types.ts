/**
 * Hermes Flux 动效核心类型契约
 * 
 * 设计意图 (Why):
 *   彻底消除多布尔标志位（如 isEntering && isExiting）产生的非法组合状态空间，
 *   建立数学自洽的判别联合五态状态机，保障跨宿主动效生命周期的确定性。
 * 防范的历史坑 (Pitfall):
 *   历史代码使用裸 transitionend 监听，在快速双击或动画中途打断时产生乱序回调，
 *   导致已展示的新弹窗被上一轮退场回调误杀。
 * 约束与规则 (Rules):
 *   纯 TypeScript 零 DOM 依赖，严格单向依赖 core ➔ ui ➔ desktop/mobile/web。
 */

export type MotionStatus = 'idle' | 'entering' | 'entered' | 'exiting' | 'exited';

export interface MotionState {
  readonly status: MotionStatus;
  readonly version: number;
}

export type MotionEvent =
  | { type: 'ENTER' }
  | { type: 'EXIT' }
  | { type: 'TRANSITION_END'; version: number; propertyName?: string }
  | { type: 'TIMEOUT_FALLBACK'; version: number };

export type MotionListener = (state: MotionState) => void;
