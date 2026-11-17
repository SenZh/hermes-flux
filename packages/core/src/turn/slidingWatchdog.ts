/**
 * 动态心跳滑动看门狗状态机 (Sliding Active Watchdog)
 *
 * 【设计意图 (Why)】
 *   将回合流式看门狗从死板的单次 60s 绝对时间限制器，重构为双层滑动心跳看门狗。
 *   在长耗时推理（Thinking）或工具调用（Tool Execution）期间，当下行持续产生增量数据流时，
 *   通过滑动喂狗（touch/feed）不断续命；只有当真正出现无数据静默超时时才触发熔断。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 旧看门狗仅在 turn-started 时启动一次，后续持续产生 token 却从未喂狗，
 *      导致复杂长任务在整整 60 秒时突发中断；
 *   2. 若只提供无限滑动喂狗，若后端死循环无休止输出会导致前端永远无法释放；
 *      必须叠加单次回合绝对硬上限（如 30 分钟）作为最终故障保险丝；
 *   3. 高频 Token 流（每秒上百个 chunk）若无节制反复 clearTimeout/setTimeout 会导致时钟树抖动；
 *      内置微防抖机制，同一节拍内多事件合并为单次续期。
 *
 * 【约束与规则 (Rules)】
 *   - 纯 TypeScript：抽象系统时钟与定时器驱动，兼容 Node.js 与浏览器环境；
 *   - 严禁隐蔽状态：状态转移遵循清晰的判别联合（idle -> armed -> expired | disarmed）；
 *   - 零内存泄漏：在 disarm 与超时后确保清除所有系统定时器。
 */

export type WatchdogState = 'idle' | 'armed' | 'expired' | 'disarmed';

export type WatchdogTimeoutReason = 'inactivity' | 'hard-limit';

export type WatchdogTimeoutCallback = (reason: WatchdogTimeoutReason) => void;
export type WatchdogNowCallback = () => number;

export type SlidingWatchdogOptions = {
  idleTimeoutMs?: number;
  hardLimitMs?: number;
  throttleMs?: number;
  onTimeout: WatchdogTimeoutCallback;
  /** 时钟注入；显式传 null 表示回落到系统时钟（跨端桩与测试替身的退化场景）。 */
  now?: WatchdogNowCallback | null;
}

/** 默认时序参数；`now` 单独收敛成非空函数，避免默认值被 options 的可空类型污染。 */
const DEFAULT_WATCHDOG_OPTIONS: Required<Omit<SlidingWatchdogOptions, 'onTimeout'> & { now: WatchdogNowCallback }> = {
  idleTimeoutMs: 60_000,
  hardLimitMs: 30 * 60_000,
  throttleMs: 500,
  now: () => Date.now(),
};

export class SlidingActiveWatchdog {
  private readonly idleTimeoutMs: number;
  private readonly hardLimitMs: number;
  private readonly throttleMs: number;
  private readonly onTimeout: WatchdogTimeoutCallback;
  private readonly now: WatchdogNowCallback;

  private state: WatchdogState = 'idle';
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private hardTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFeedTestAt = 0;
  private turnStartedAt = 0;

  public constructor(options: SlidingWatchdogOptions) {
    const opts = Object.assign({}, DEFAULT_WATCHDOG_OPTIONS, options);
    this.onTimeout = opts.onTimeout;
    this.idleTimeoutMs = Math.max(10, opts.idleTimeoutMs);
    this.hardLimitMs = Math.max(this.idleTimeoutMs, opts.hardLimitMs);
    this.throttleMs = Math.max(0, opts.throttleMs);
    // 【防御性回落 (Rules)】时钟是唯一可能被调用方显式置空的注入项：
    //   `Object.assign` 会让显式 null 覆盖掉默认实现，随后 arm() 第一行就抛
    //   "this.now is not a function"，表现为回合一开始就崩在熔断器自身。
    this.now = opts.now ?? DEFAULT_WATCHDOG_OPTIONS.now;
  }

  /**
   * 启动看门狗守护（回合开始时调用）。
   */
  public arm(): void {
    this.disarm();

    const currentTime = this.now();
    this.turnStartedAt = currentTime;
    this.lastFeedTestAt = currentTime;
    this.state = 'armed';

    // 启动空闲定时器
    this.scheduleIdleTimer();

    // 启动单次回合绝对硬上限防线
    this.hardTimer = setTimeout(() => {
      this.handleTimeout('hard-limit');
    }, this.hardLimitMs);

    this.safeUnref(this.hardTimer);
  }

  /**
   * 喂狗（收到增量 Token、Thinking、Tool 执行、心跳等活跃数据流时调用）。
   */
  public feed(): boolean {
    if (this.state !== 'armed') return false;

    const currentTime = this.now();
    // 节流检查：如果在 throttleMs 窗口内已经喂过狗，则跳过反复重设定时器
    if (currentTime - this.lastFeedTestAt < this.throttleMs) {
      return true;
    }

    this.lastFeedTestAt = currentTime;
    this.scheduleIdleTimer();
    return true;
  }

  /**
   * 解除看门狗守护（回合正常结束或主动取消时调用）。
   */
  public disarm(): void {
    this.clearTimers();
    this.state = 'disarmed';
  }

  /**
   * 当前看门狗状态。
   */
  public getState(): WatchdogState {
    return this.state;
  }

  /**
   * 当前回合已持续运行的毫秒数。
   */
  public getElapsedMs(): number {
    if (this.state === 'idle') return 0;
    return Math.max(0, this.now() - this.turnStartedAt);
  }

  /**
   * 距离上次收到活跃数据已流逝的空闲毫秒数。
   */
  public getIdleElapsedMs(): number {
    if (this.state !== 'armed') return 0;
    return Math.max(0, this.now() - this.lastFeedTestAt);
  }

  private scheduleIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    this.idleTimer = setTimeout(() => {
      this.handleTimeout('inactivity');
    }, this.idleTimeoutMs);

    this.safeUnref(this.idleTimer);
  }

  private handleTimeout(reason: WatchdogTimeoutReason): void {
    if (this.state !== 'armed') return;
    this.clearTimers();
    this.state = 'expired';
    this.onTimeout(reason);
  }

  private clearTimers(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.hardTimer) {
      clearTimeout(this.hardTimer);
      this.hardTimer = null;
    }
  }

  private safeUnref(timer: unknown): void {
    const unref = (timer as { unref?: () => void })?.unref;
    if (typeof unref === 'function') {
      try {
        unref.call(timer);
      // gate-degrade: 浏览器环境下容忍无 unref 方法或跨端模拟定时器异常
      } catch {
        // 忽略非 Node 环境下的 unref 异常
      }
    }
  }
}
