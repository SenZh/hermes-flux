/**
 * 空闲轮播调度器（Idle Quip Ticker）
 *
 * 【设计意图 (Why)】
 *   空闲态没有真实状态可播报，但完全静止的头像读起来像「进程挂了」。这里按固定间隔推进
 *   `tick`（换一句短句），并在换句的同一拍把 `turning` 置真一小段时间（驱动头像侧头）。
 *
 *   之所以把调度逻辑从 React hook 里抽出来，是因为「定时器语义」是本模块唯一的真风险面
 *   （重复排程、隐藏不停表、卸载泄漏、非空闲不复位），而这些在 `renderToStaticMarkup`
 *   下完全不可观测（effect 根本不执行）。抽成注入式调度器后，可用假定时器在 node 里
 *   逐拍断言，不需要 DOM 环境。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. `setState` 里直接排下一个定时器，会在 hidden 期间继续排队 → 后台窗口持续唤醒 CPU。
 *      因此 hidden 时必须同时清掉「换句」与「回位」两个定时器，visible 时从头重排。
 *   2. 每次 `start()` 不清旧句柄会导致双排程：一次可见切换后 tick 以 2 倍速推进。
 *   3. 非空闲必须回到 REST：否则从 running 落回 idle 时会沿用上次 tick，第一句从中间开始。
 *
 * 【约束与规则 (Rules)】
 *   1. 本模块不读时钟、不读随机数、不直接触碰 DOM：所有外部能力由调用方注入；
 *   2. `start()` 幂等：重复调用不会产生第二条定时器链；
 *   3. `stop()` 后不再产生任何回调（`disposed` 之后回调一律丢弃）。
 */

/** 空闲轮播状态：`tick` 每换一句 +1；`turning` 在换句后的短窗口内为 true */
export interface IdleQuipState {
  tick: number;
  turning: boolean;
}

/** 静止态：非空闲、隐藏、卸载后统一回到这里 */
export const IDLE_QUIP_REST: IdleQuipState = Object.freeze({ tick: 0, turning: false });

export interface IdleQuipSchedulerOptions {
  /** 每次状态变化回调（由 hook 转成 setState） */
  onState: (state: IdleQuipState) => void;
  /** 排一个一次性定时器，返回可清除的句柄 */
  setTimer: (callback: () => void, delayMs: number) => unknown;
  /** 清除 `setTimer` 返回的句柄；句柄为 null 时不得调用 */
  clearTimer: (handle: unknown) => void;
  /** 当前是否处于页面隐藏态（隐藏时不得排程） */
  isHidden: () => boolean;
  /** 换句间隔（毫秒），默认由调用方给 `IDLE_QUIP_INTERVAL_MS` */
  intervalMs: number;
  /** 换句后 `turning` 保持时长（毫秒） */
  turnMs: number;
}

export interface IdleQuipScheduler {
  /** 开始/恢复推进（幂等） */
  start: () => void;
  /** 停止并清空所有定时器（幂等） */
  stop: () => void;
  /** 可见性变化时调用：hidden 停表，visible 重排 */
  visibilityChanged: (hidden: boolean) => void;
  /** 当前状态（只读，便于测试断言） */
  current: () => IdleQuipState;
}

export function createIdleQuipScheduler(options: IdleQuipSchedulerOptions): IdleQuipScheduler {
  const { onState, setTimer, clearTimer, isHidden, intervalMs, turnMs } = options;
  let state: IdleQuipState = IDLE_QUIP_REST;
  let quipTimer: unknown = null;
  let turnTimer: unknown = null;
  let running = false;

  const clearTimers = (): void => {
    if (quipTimer !== null) {
      clearTimer(quipTimer);
      quipTimer = null;
    }
    if (turnTimer !== null) {
      clearTimer(turnTimer);
      turnTimer = null;
    }
  };

  const emit = (next: IdleQuipState): void => {
    state = next;
    onState(next);
  };

  const scheduleNext = (): void => {
    if (!running || isHidden()) return;
    quipTimer = setTimer(() => {
      quipTimer = null;
      if (!running) return;
      // 换句 + 起手侧头
      emit({ tick: state.tick + 1, turning: true });
      turnTimer = setTimer(() => {
        turnTimer = null;
        if (!running) return;
        emit({ tick: state.tick, turning: false });
      }, turnMs);
      scheduleNext();
    }, intervalMs);
  };

  return {
    start: () => {
      if (running) return;
      running = true;
      clearTimers();
      scheduleNext();
    },
    stop: () => {
      running = false;
      clearTimers();
      // 【规则】非空闲必须复位：否则落回 idle 时沿用旧 tick，第一句从中间开始
      if (state.tick !== 0 || state.turning) emit(IDLE_QUIP_REST);
    },
    visibilityChanged: (hidden) => {
      if (!running) return;
      if (hidden) {
        clearTimers();
        if (state.turning) emit({ tick: state.tick, turning: false });
        return;
      }
      // 回到前台：从头重排，避免把隐藏期间的节拍一次性补播
      clearTimers();
      scheduleNext();
    },
    current: () => state,
  };
}
