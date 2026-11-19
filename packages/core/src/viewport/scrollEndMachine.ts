/**
 * 会话流「回到底部」控件的纯状态机。
 *
 * 【设计意图 (Why)】
 *   按钮显隐与平滑回底是两条正交链路：显隐只认「视口离底部距离」，
 *   平滑会话只认「点击后是否已收敛」。把两者拆成独立判别联合并下沉到 core，
 *   可在 Node 里穷举随机事件交错，也避免宿主里散落的 boolean 拼凑状态。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 不能用 `distanceToBottom <= 阈值` 结束平滑会话：原生平滑在 48px → 0px
 *      的减速末段仍在推进，提前清状态会让 onscroll 把它误判成用户手势；
 *   2. 不能把 `markProgrammaticScroll`（记录起点 + 80~180ms 忽略窗）当作平滑会话载体，
 *      它只覆盖一次瞬时写入，覆盖不了 300~800ms 的原生动画；
 *   3. 切会话 / 断连不得向旧流写 `instant`：旧流即将被替换，写入只会制造多余的
 *      scroll 回调，甚至污染新会话的进入计划。
 *
 * 【约束与规则 (Rules)】
 *   1. 零 DOM、零 Timer、零 React，只接收已测量的几何值；
 *   2. 阈值由宿主注入既有 STICK_TO_BOTTOM_THRESHOLD_PX，本文件不重复声明；
 *   3. 所有转移必须带 ticket，旧帧 / 旧超时不得改写新会话。
 */

export const SCROLL_TO_END_ARRIVE_TOLERANCE_PX = 2;
export const SCROLL_TO_END_TIMEOUT_MS = 1200;

export interface ScrollGeometry {
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly scrollTop: number;
}

/**
 * 视口底部距离。
 * 【规则】负数一律钳为 0：弹性滚动 / 布局钳制会让 scrollTop 短暂越界。
 */
export function computeDistanceToBottom(geometry: ScrollGeometry): number {
  const distance = geometry.scrollHeight - geometry.clientHeight - geometry.scrollTop;
  return Number.isFinite(distance) ? Math.max(0, distance) : 0;
}

export type SmoothScrollStopMode = 'none' | 'instant-at-current' | 'converge-to-bottom';

export type SmoothScrollSessionState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'running';
      readonly ticket: number;
      readonly startedAtMs: number;
      readonly targetScrollHeight: number;
      readonly settledCloseFrames: number;
    };

export type SmoothScrollEvent =
  | ({ readonly type: 'CLICK'; readonly nowMs: number } & ScrollGeometry)
  | ({ readonly type: 'FRAME'; readonly ticket: number; readonly nowMs: number } & ScrollGeometry)
  | ({ readonly type: 'SCROLLEND'; readonly ticket: number; readonly nowMs: number } & ScrollGeometry)
  | ({ readonly type: 'TIMEOUT'; readonly ticket: number } & ScrollGeometry)
  | { readonly type: 'USER_INTERRUPT' }
  | { readonly type: 'SESSION_ENTER' }
  | { readonly type: 'DISCONNECT' };

export interface SmoothScrollEffect {
  readonly kind: 'none' | 'smooth-to' | 'stop';
  readonly scrollHeight?: number;
  readonly ticket?: number;
  readonly mode?: SmoothScrollStopMode;
}

export interface SmoothScrollTransition {
  readonly state: SmoothScrollSessionState;
  readonly effect: SmoothScrollEffect;
}

export interface SmoothScrollReducerOptions {
  readonly nextTicket: () => number;
  /** 由宿主注入既有贴底阈值，禁止在 core 重复声明 48 */
  readonly thresholdPx: number;
}

const IDLE: SmoothScrollSessionState = { status: 'idle' };
const NO_EFFECT: SmoothScrollEffect = { kind: 'none' };

function smoothTo(scrollHeight: number, ticket: number): SmoothScrollEffect {
  return { kind: 'smooth-to', scrollHeight, ticket };
}

function stop(mode: SmoothScrollStopMode): SmoothScrollEffect {
  return { kind: 'stop', mode };
}

export interface ScrollEndVisibilityInput extends ScrollGeometry {
  readonly gatewayConnected: boolean;
  readonly enterPending: boolean;
  readonly initialBottomSettling: boolean;
  /** 由 desktop 注入既有 STICK_TO_BOTTOM_THRESHOLD_PX */
  readonly thresholdPx: number;
  readonly force?: 'hidden';
}

/**
 * 按钮显隐裁决。
 * 【规则】断连 / 进入计划挂起 / 首屏落定 / 强制隐藏一律不可见；
 *   其余只由「离底距离 > 阈值」决定，与平滑会话生命周期无关。
 */
export function decideScrollEndVisibility(input: ScrollEndVisibilityInput): boolean {
  if (!input.gatewayConnected) return false;
  if (input.enterPending || input.initialBottomSettling) return false;
  if (input.force === 'hidden') return false;
  return computeDistanceToBottom(input) > input.thresholdPx;
}

/**
 * 平滑会话转移。
 *
 * 【关键不变量】`distance <= 48` 只由显隐裁决消费；
 *   本 reducer 只在 `<= 2px`（连续 2 帧）或 `scrollend` 才收敛，避免减速末段误判。
 */
export function reduceSmoothScrollSession(
  current: SmoothScrollSessionState,
  event: SmoothScrollEvent,
  options: SmoothScrollReducerOptions,
): SmoothScrollTransition {
  if (event.type === 'USER_INTERRUPT') {
    return { state: IDLE, effect: stop('instant-at-current') };
  }
  if (event.type === 'SESSION_ENTER' || event.type === 'DISCONNECT') {
    return { state: IDLE, effect: stop('none') };
  }

  if (event.type === 'CLICK') {
    const distance = computeDistanceToBottom(event);
    if (distance <= SCROLL_TO_END_ARRIVE_TOLERANCE_PX) {
      return { state: IDLE, effect: stop('none') };
    }
    const ticket = options.nextTicket();
    return {
      state: {
        status: 'running',
        ticket,
        startedAtMs: event.nowMs,
        targetScrollHeight: event.scrollHeight,
        settledCloseFrames: 0,
      },
      effect: smoothTo(event.scrollHeight, ticket),
    };
  }

  if (current.status !== 'running') return { state: current, effect: NO_EFFECT };
  if ('ticket' in event && event.ticket !== current.ticket) {
    return { state: current, effect: NO_EFFECT };
  }

  const distance = computeDistanceToBottom(event);

  if (event.type === 'FRAME') {
    if (event.nowMs - current.startedAtMs >= SCROLL_TO_END_TIMEOUT_MS) {
      return {
        state: IDLE,
        effect: distance > SCROLL_TO_END_ARRIVE_TOLERANCE_PX ? stop('converge-to-bottom') : stop('none'),
      };
    }
    if (distance <= SCROLL_TO_END_ARRIVE_TOLERANCE_PX) {
      const settled = current.settledCloseFrames + 1;
      if (settled >= 2) return { state: IDLE, effect: stop('none') };
      return { state: { ...current, settledCloseFrames: settled }, effect: NO_EFFECT };
    }
    if (event.scrollHeight !== current.targetScrollHeight && distance > options.thresholdPx) {
      return {
        state: { ...current, targetScrollHeight: event.scrollHeight, settledCloseFrames: 0 },
        effect: smoothTo(event.scrollHeight, current.ticket),
      };
    }
    return { state: { ...current, settledCloseFrames: 0 }, effect: NO_EFFECT };
  }

  if (event.type === 'SCROLLEND') {
    if (distance <= SCROLL_TO_END_ARRIVE_TOLERANCE_PX) {
      return { state: IDLE, effect: stop('none') };
    }
    if (distance > options.thresholdPx) {
      return {
        state: { ...current, targetScrollHeight: event.scrollHeight, settledCloseFrames: 0 },
        effect: smoothTo(event.scrollHeight, current.ticket),
      };
    }
    return { state: IDLE, effect: stop('converge-to-bottom') };
  }

  // TIMEOUT
  return {
    state: IDLE,
    effect: distance > SCROLL_TO_END_ARRIVE_TOLERANCE_PX ? stop('converge-to-bottom') : stop('none'),
  };
}
