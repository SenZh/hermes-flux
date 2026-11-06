/**
 * Hermes Flux React 动效保活 Hook (useMotionPresence)
 *
 * 设计意图 (Why):
 *   为 React 岛屿组件提供声明式进退场保活机制。
 *   当 isPresent 由 true 变为 false 时，组件不会被 React 立即卸载，
 *   而是进入 exiting 状态播放退场动画，待动画结束或超时收敛至 exited 后才正式解除挂载。
 * 防范的历史坑 (Pitfall):
 *   {!collapsed && <Drawer />} 导致组件在折叠时瞬间消失断头，所有退出动画完全失效。
 * 约束与规则 (Rules):
 *   1. 初始 isPresent 为 false 时必须直接保持未挂载（isMounted = false），
 *      确保 SSR 与测试静态快照中零空占位；
 *   2. 靶心断言：onTransitionEnd 必须严格核验 e.target === e.currentTarget；
 *   3. 严禁使用类型逃逸（any）。
 */

import * as React from 'react';
import { MotionFSM } from '@hermes-flux/core';
import type { MotionStatus } from '@hermes-flux/core';
import { resolveMotionTokens, isReducedMotionPreferred } from './motion-tokens.js';

export interface UseMotionPresenceOptions {
  /** 触发属性白名单 */
  readonly triggerProperty?: string;
  /** 自定义入场时长 (ms)，缺省时动态探测 CSS Token */
  readonly durationEnter?: number;
  /** 自定义退场时长 (ms)，缺省时动态探测 CSS Token */
  readonly durationExit?: number;
  /** 状态变更回调 */
  readonly onStatusChange?: (status: MotionStatus) => void;
}

export interface UseMotionPresenceResult {
  /** 当前动效五态 */
  readonly status: MotionStatus;
  /** 是否需要挂载 DOM 节点（exiting 期间保持 true 实现保活） */
  readonly isMounted: boolean;
  /** 挂载于动效容器节点上的标准属性集 */
  readonly motionProps: {
    readonly 'data-motion-state': MotionStatus;
    readonly onTransitionEnd: (event: React.TransitionEvent<HTMLElement>) => void;
    readonly inert?: boolean | undefined;
    readonly 'aria-hidden'?: 'true' | undefined;
  };
}

export function useMotionPresence(
  isPresent: boolean,
  options: UseMotionPresenceOptions = {},
): UseMotionPresenceResult {
  const fsmRef = React.useRef<MotionFSM | null>(null);
  if (!fsmRef.current) {
    fsmRef.current = new MotionFSM(isPresent ? 'entered' : 'exited');
  }
  const fsm = fsmRef.current;

  const [state, setState] = React.useState(fsm.state);
  const fallbackTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = React.useCallback((): void => {
    if (fallbackTimerRef.current !== null) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  // 监听 FSM 状态变更
  React.useEffect(() => {
    return fsm.subscribe((next) => {
      setState(next);
      options.onStatusChange?.(next.status);
    });
  }, [fsm, options]);

  // 响应 isPresent 变更
  React.useEffect(() => {
    clearTimer();

    if (isPresent) {
      const next = fsm.dispatch({ type: 'ENTER' });
      if (next.status === 'entering') {
        const timeout = isReducedMotionPreferred()
          ? 0
          : (options.durationEnter ?? resolveMotionTokens().durationEnter) + resolveMotionTokens().fallbackBuffer;

        fallbackTimerRef.current = setTimeout(() => {
          fallbackTimerRef.current = null;
          fsm.dispatch({ type: 'TIMEOUT_FALLBACK', version: next.version });
        }, Math.max(16, timeout));
      }
    } else {
      const next = fsm.dispatch({ type: 'EXIT' });
      if (next.status === 'exiting') {
        const timeout = isReducedMotionPreferred()
          ? 0
          : (options.durationExit ?? resolveMotionTokens().durationExit) + resolveMotionTokens().fallbackBuffer;

        fallbackTimerRef.current = setTimeout(() => {
          fallbackTimerRef.current = null;
          fsm.dispatch({ type: 'TIMEOUT_FALLBACK', version: next.version });
        }, Math.max(16, timeout));
      }
    }

    return clearTimer;
  }, [isPresent, fsm, clearTimer, options.durationEnter, options.durationExit]);

  const handleTransitionEnd = React.useCallback(
    (event: React.TransitionEvent<HTMLElement>): void => {
      // 1. 靶心断言
      if (event.target !== event.currentTarget) {
        return;
      }
      // 2. 属性过滤
      if (options.triggerProperty && event.propertyName !== options.triggerProperty) {
        return;
      }
      // 3. 版本核验派发
      clearTimer();
      fsm.dispatch({
        type: 'TRANSITION_END',
        version: fsm.version,
        propertyName: event.propertyName,
      });
    },
    [fsm, clearTimer, options.triggerProperty],
  );

  const isMounted = state.status !== 'exited' && state.status !== 'idle';
  const isInert = state.status === 'exiting' || state.status === 'exited';

  return {
    status: state.status,
    isMounted,
    motionProps: {
      'data-motion-state': state.status,
      onTransitionEnd: handleTransitionEnd,
      ...(isInert ? { inert: true, 'aria-hidden': 'true' as const } : {}),
    },
  };
}
