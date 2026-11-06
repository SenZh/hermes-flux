/**
 * Hermes Flux 原生 DOM 动效控制器 (attachMotionController)
 *
 * 设计意图 (Why):
 *   为存量纯 TypeScript 字符串模板与原生 DOM 节点提供与框架无关的动效生命周期挂载层。
 *   实现靶心冒泡隔离、单调 CAS 状态收敛、退场保活及 HTML5 原生 inert 幽灵焦点治理。
 * 防范的历史坑 (Pitfall):
 *   1. 子元素（如按钮 hover、input focus）过渡触发 transitionend 冒泡到外层，导致外层弹窗被提前误杀；
 *   2. 模态框收起过程中按 Tab 键，焦点穿透进退场中的不可见表单项，破坏无障碍链路。
 * 约束与规则 (Rules):
 *   1. 必须三阶守卫 transitionend：target 靶心断言 ➔ 属性白名单 ➔ CAS 版本核验；
 *   2. 退场进入 exiting 瞬间必须注入 inert 属性与 aria-hidden="true"；
 *   3. 严禁使用类型逃逸（any）；
 */

import { MotionFSM } from '@hermes-flux/core';
import type { MotionStatus } from '@hermes-flux/core';
import { resolveMotionTokens, isReducedMotionPreferred } from './motion-tokens.js';

export interface MotionControllerOptions {
  /** 核心触发属性白名单（例如 'opacity'、'width'、'transform'），缺省时放行任意属性 */
  readonly triggerProperty?: string;
  /** 退场收敛完成后是否自动原路归还焦点给触发元素 */
  readonly returnFocus?: boolean;
  /** 入场终态回调 */
  readonly onEntered?: () => void;
  /** 退场终态回调（可用于在此执行 display: none 或物理清理） */
  readonly onExited?: () => void;
  /** 状态流转监听 */
  readonly onStatusChange?: (status: MotionStatus) => void;
}

export interface MotionController {
  readonly status: MotionStatus;
  readonly fsm: MotionFSM;
  enter(triggerElement?: HTMLElement | null): Promise<void>;
  exit(): Promise<void>;
  detach(): void;
}

export function attachMotionController(
  element: HTMLElement,
  options: MotionControllerOptions = {},
): MotionController {
  const fsm = new MotionFSM(
    (element.getAttribute('data-motion-state') as MotionStatus) || 'idle',
  );

  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let savedTriggerEl: HTMLElement | null = null;

  const clearFallbackTimer = (): void => {
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
  };

  const scheduleWatchdog = (expectedDurationMs: number, version: number): void => {
    clearFallbackTimer();
    const tokens = resolveMotionTokens(element);
    const timeoutMs = isReducedMotionPreferred() ? 0 : expectedDurationMs + tokens.fallbackBuffer;

    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      fsm.dispatch({ type: 'TIMEOUT_FALLBACK', version });
    }, Math.max(16, timeoutMs));
  };

  const syncDomAttributes = (status: MotionStatus): void => {
    element.setAttribute('data-motion-state', status);

    if (status === 'entering' || status === 'entered') {
      element.removeAttribute('inert');
      element.removeAttribute('aria-hidden');
    } else if (status === 'exiting' || status === 'exited') {
      element.setAttribute('inert', '');
      element.setAttribute('aria-hidden', 'true');
    }
  };

  // 状态机订阅通知
  const unsubscribeFsm = fsm.subscribe((state) => {
    syncDomAttributes(state.status);
    options.onStatusChange?.(state.status);

    if (state.status === 'entered') {
      clearFallbackTimer();
      options.onEntered?.();
    } else if (state.status === 'exited') {
      clearFallbackTimer();
      options.onExited?.();

      // Focus Return Protocol：退场完毕后微任务返还焦点
      if (options.returnFocus && savedTriggerEl && typeof savedTriggerEl.focus === 'function') {
        const trigger = savedTriggerEl;
        savedTriggerEl = null;
        queueMicrotask(() => {
          try {
            trigger.focus();
          // gate-degrade: 节点离架或处于隐藏状态时 focus 可能抛出异常，此时安全降级无需阻断
          } catch {
            // 忽略节点可能已离架的异常
          }
        });
      }
    }
  });

  // 三阶守卫的 transitionend 监听器
  const handleTransitionEnd = (event: TransitionEvent): void => {
    // 1. 靶心断言：物理触发源必须为当前绑定的宿主本身，彻底阻断子节点冒泡误杀
    if (event.target !== element) {
      return;
    }

    // 2. 主属性白名单过滤：忽略背景色等无关微变
    if (options.triggerProperty && event.propertyName !== options.triggerProperty) {
      return;
    }

    // 3. 版本 CAS 核验
    fsm.dispatch({
      type: 'TRANSITION_END',
      version: fsm.version,
      propertyName: event.propertyName,
    });
  };

  element.addEventListener('transitionend', handleTransitionEnd);

  // 初始 DOM 属性对齐
  syncDomAttributes(fsm.status);

  return {
    get status(): MotionStatus {
      return fsm.status;
    },
    get fsm(): MotionFSM {
      return fsm;
    },
    async enter(triggerElement?: HTMLElement | null): Promise<void> {
      if (triggerElement) {
        savedTriggerEl = triggerElement;
      } else if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
        savedTriggerEl = document.activeElement;
      }

      const tokens = resolveMotionTokens(element);
      const next = fsm.dispatch({ type: 'ENTER' });
      if (next.status === 'entering') {
        scheduleWatchdog(tokens.durationEnter, next.version);
      }
    },
    async exit(): Promise<void> {
      const tokens = resolveMotionTokens(element);
      const next = fsm.dispatch({ type: 'EXIT' });
      if (next.status === 'exiting') {
        scheduleWatchdog(tokens.durationExit, next.version);
      }
    },
    detach(): void {
      clearFallbackTimer();
      unsubscribeFsm();
      element.removeEventListener('transitionend', handleTransitionEnd);
    },
  };
}
