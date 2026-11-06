/**
 * Hermes Flux 单调递增 Version CAS 五态动效状态机
 *
 * 设计意图 (Why):
 *   消除进退场动画并发打断时的 Flapping 抖动与幽灵退场问题。
 *   通过单调自增整型版本戳 (Version CAS) 使得所有过期异步回调（如 transitionend、超时兜底）
 *   在版本比对失败时自动失效。
 * 防范的历史坑 (Pitfall):
 *   在 exiting 动画进行到一半时用户再次点击唤起，旧退场定时器在 100ms 后触发，
 *   若无版本核验，会将刚刚重新进入 entering/entered 态的容器强制拔除或置为 display: none。
 * 约束与规则 (Rules):
 *   1. 纯无界逻辑，零 DOM 依赖，支持 Node.js 环境毫秒级同步回归；
 *   2. 每次显式状态跃迁 (ENTER / EXIT) 强制递增 version；
 *   3. 异步收敛事件 (TRANSITION_END / TIMEOUT_FALLBACK) 必须核验 version === this.version；
 *   4. 严禁使用类型逃逸（any）；
 */

import type { MotionEvent, MotionListener, MotionState, MotionStatus } from './types.js';

export class MotionFSM {
  private _state: MotionState;
  private readonly listeners = new Set<MotionListener>();

  constructor(initialStatus: MotionStatus = 'idle', initialVersion = 0) {
    this._state = {
      status: initialStatus,
      version: initialVersion,
    };
  }

  public get state(): MotionState {
    return this._state;
  }

  public get status(): MotionStatus {
    return this._state.status;
  }

  public get version(): number {
    return this._state.version;
  }

  /**
   * 派发状态机事件。
   *
   * 设计意图 (Why):
   *   统一步进入口，根据状态转移表判定转移合法性并实施 Version CAS 防抖拦截。
   * 防范的历史坑 (Pitfall):
   *   在 exiting 阶段再次收到 ENTER 时，不能强制重置为起始帧跳跃，而是平滑转入 entering。
   * 约束与规则 (Rules):
   *   非状态变更操作不触发 listeners 通知。
   */
  public dispatch(event: MotionEvent): MotionState {
    const prev = this._state;

    switch (event.type) {
      case 'ENTER': {
        if (prev.status === 'entering' || prev.status === 'entered') {
          return prev;
        }
        const nextState: MotionState = {
          status: 'entering',
          version: prev.version + 1,
        };
        this._setState(nextState);
        return nextState;
      }

      case 'EXIT': {
        if (prev.status === 'exiting' || prev.status === 'exited' || prev.status === 'idle') {
          return prev;
        }
        const nextState: MotionState = {
          status: 'exiting',
          version: prev.version + 1,
        };
        this._setState(nextState);
        return nextState;
      }

      case 'TRANSITION_END':
      case 'TIMEOUT_FALLBACK': {
        // CAS 核验：非本轮版本的异步回调一律静默废弃
        if (event.version !== prev.version) {
          return prev;
        }

        if (prev.status === 'entering') {
          const nextState: MotionState = {
            status: 'entered',
            version: prev.version,
          };
          this._setState(nextState);
          return nextState;
        }

        if (prev.status === 'exiting') {
          const nextState: MotionState = {
            status: 'exited',
            version: prev.version,
          };
          this._setState(nextState);
          return nextState;
        }

        return prev;
      }
    }
  }

  /**
   * 订阅状态变更监听器。
   */
  public subscribe(listener: MotionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private _setState(next: MotionState): void {
    this._state = next;
    for (const listener of this.listeners) {
      try {
        listener(next);
      // gate-degrade: 隔离个别监听器内部异常，防范单个订阅方崩溃阻断后续派发链路
      } catch {
        // 隔离单个监听器异常
      }
    }
  }
}
