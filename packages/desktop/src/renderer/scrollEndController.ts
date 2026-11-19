/**
 * 「回到底部」控件宿主控制器。
 *
 * 【设计意图 (Why)】
 *   把按钮的 DOM 装配、显隐同步、平滑会话推进、用户打断与监听生命周期收口到单一模块，
 *   让 `index.ts` 只做实例化与依赖注入。显隐真值来自 core 的纯裁决函数，
 *   平滑会话来自 core 的纯 reducer，本文件只负责真实 DOM 副作用。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 不能用 `markProgrammaticScroll` 承载平滑会话：它记录调用瞬间的起点、忽略窗仅
 *      80~180ms，覆盖不了 300~800ms 的原生动画；必须用独立的 smooth ticket；
 *   2. `distance <= 48` 只隐藏按钮，不结束平滑会话，否则减速末段会被 onscroll
 *      误判成用户手势并触发 cancelSessionEnter；
 *   3. 切会话 / 断连不得向旧流写 instant，旧流即将被替换；
 *   4. `ScrollToEndButton` 的 JSX 不声明 aria-hidden / tabindex，全部由本控制器写，
 *      否则 React 重渲染会覆盖命令式状态。
 *
 * 【约束与规则 (Rules)】
 *   1. 只通过 deps 访问宿主状态与滚动能力，禁止 import `index.ts`；
 *   2. 显隐写入用 lastVisible + 节点连通性双重去重，`outerHTML` 重建后必须重写；
 *   3. 所有定时器 / rAF / 监听在 dispose 时必须清理。
 */

import {
  SCROLL_TO_END_TIMEOUT_MS,
  decideScrollEndVisibility,
  reduceSmoothScrollSession,
  type ScrollGeometry,
  type SmoothScrollSessionState,
  type SmoothScrollTransition,
} from '@hermes-flux/core';
import { STICK_TO_BOTTOM_THRESHOLD_PX } from './viewport/streamViewportManager.js';
import type { ConversationMount, I18nKey } from '@hermes-flux/ui';

export interface ScrollEndButtonSnapshot {
  readonly label: string;
  readonly ariaLabel: string;
  readonly onClick: () => void;
  readonly onCommit?: () => void;
}

export interface ScrollEndControllerDeps {
  readonly isGatewayConnected: () => boolean;
  readonly getPresenceLayout: () => 'stage' | 'dock';
  readonly getLang: () => string;
  readonly t: (key: I18nKey) => string;
  readonly getStreamElement: () => HTMLElement | null;
  readonly getDockElement: () => HTMLElement | null;
  readonly isSessionEnterPending: () => boolean;
  readonly isInitialBottomSettling: () => boolean;
  readonly scrollStreamToEndSmooth: (targetScrollHeight: number) => boolean;
  readonly scrollStreamToBottomFallback: (reason: string) => void;
  readonly mountButton: (
    host: HTMLElement,
    getSnapshot: () => ScrollEndButtonSnapshot,
  ) => ConversationMount;
  readonly now?: () => number;
  readonly requestAnimationFrame?: (callback: () => void) => number;
  readonly cancelAnimationFrame?: (id: number) => void;
  readonly setTimeout?: (callback: () => void, ms: number) => number;
  readonly clearTimeout?: (id: number) => void;
}

export interface CancelSmoothScrollOptions {
  /** 用户打断传 true（对当前流写 instant）；切会话 / 断连必须传 false */
  readonly stopNativeSmooth: boolean;
  readonly hideImmediately?: boolean;
  /** 断连走 DISCONNECT，切会话走 SESSION_ENTER；两者都不得写 instant */
  readonly reason?: 'session' | 'disconnect';
}

export interface ScrollEndController {
  ensureActionbar(dock: HTMLElement): HTMLElement;
  syncHost(): void;
  syncVisibility(force?: 'hidden', forceDomWrite?: boolean): void;
  scrollToEnd(): void;
  isSmoothScrollActive(): boolean;
  cancelSmoothScroll(options: CancelSmoothScrollOptions): void;
  bindStreamListeners(stream: HTMLElement | null): void;
  dispose(): void;
}

const ACTIONBAR_CLASS = 'dock-actionbar';
const INNER_CLASS = 'dock-actionbar__inner';
const HOST_ID = 'react-scroll-end-host';
const BUTTON_SELECTOR = '.scroll-end';
const PRESENCE_HOST_ID = 'react-conv-presence-host';

export function createScrollEndController(deps: ScrollEndControllerDeps): ScrollEndController {
  let actionbarEl: HTMLElement | null = null;
  let innerEl: HTMLElement | null = null;
  let hostEl: HTMLElement | null = null;
  let mountHandle: ConversationMount | null = null;
  let mountedFingerprint = '';

  let lastVisible: boolean | null = null;
  let lastSyncedActionbar: HTMLElement | null = null;
  let lastSyncedButton: HTMLElement | null = null;

  let smoothState: SmoothScrollSessionState = { status: 'idle' };
  let ticketSeq = 0;
  let rafId: number | null = null;
  let timeoutId: number | null = null;
  let suppressTimerId: number | null = null;
  let resizeScheduled = false;

  let boundStream: HTMLElement | null = null;
  const disposers: Array<() => void> = [];

  const now = (): number => (deps.now ? deps.now() : performance.now());
  const raf = (callback: () => void): number =>
    deps.requestAnimationFrame ? deps.requestAnimationFrame(callback) : requestAnimationFrame(callback);
  const cancelRaf = (id: number): void => {
    if (deps.cancelAnimationFrame) deps.cancelAnimationFrame(id);
    else cancelAnimationFrame(id);
  };
  const later = (callback: () => void, ms: number): number =>
    deps.setTimeout ? deps.setTimeout(callback, ms) : window.setTimeout(callback, ms);
  const clearLater = (id: number): void => {
    if (deps.clearTimeout) deps.clearTimeout(id);
    else window.clearTimeout(id);
  };

  function readGeometry(stream: HTMLElement): ScrollGeometry {
    return {
      scrollHeight: stream.scrollHeight,
      clientHeight: stream.clientHeight,
      scrollTop: stream.scrollTop,
    };
  }

  function reducerOptions(): { nextTicket: () => number; thresholdPx: number } {
    return {
      nextTicket: () => {
        ticketSeq += 1;
        return ticketSeq;
      },
      thresholdPx: STICK_TO_BOTTOM_THRESHOLD_PX,
    };
  }

  function isSmoothScrollActive(): boolean {
    return smoothState.status === 'running';
  }

  function clearTimers(): void {
    if (rafId !== null) {
      cancelRaf(rafId);
      rafId = null;
    }
    if (timeoutId !== null) {
      clearLater(timeoutId);
      timeoutId = null;
    }
  }

  function suppressMotionBriefly(): void {
    if (!actionbarEl) return;
    actionbarEl.dataset.motionSuppressed = 'true';
    if (suppressTimerId !== null) clearLater(suppressTimerId);
    const clear = (): void => {
      suppressTimerId = null;
      if (actionbarEl) delete actionbarEl.dataset.motionSuppressed;
    };
    suppressTimerId = later(clear, 300);
  }

  function writeVisibility(visible: boolean, forceDomWrite = false): void {
    const actionbar = actionbarEl;
    const button = hostEl?.querySelector<HTMLElement>(BUTTON_SELECTOR) ?? null;
    if (!actionbar) return;

    const sameNode = lastSyncedActionbar === actionbar
      && lastSyncedButton === button
      && button?.isConnected === true;
    if (!forceDomWrite && lastVisible === visible && sameNode) return;

    actionbar.dataset.atBottom = visible ? 'false' : 'true';
    if (button) {
      button.setAttribute('aria-hidden', visible ? 'false' : 'true');
      button.setAttribute('tabindex', visible ? '0' : '-1');
      if (!visible && document.activeElement === button) button.blur();
    }
    lastVisible = visible;
    lastSyncedActionbar = actionbar;
    lastSyncedButton = button;
  }

  function syncVisibility(force?: 'hidden', forceDomWrite = false): void {
    if (!deps.isGatewayConnected()) {
      writeVisibility(false, forceDomWrite);
      return;
    }
    const stream = deps.getStreamElement();
    if (!stream) {
      writeVisibility(false, forceDomWrite);
      return;
    }
    const visible = decideScrollEndVisibility({
      gatewayConnected: true,
      enterPending: deps.isSessionEnterPending(),
      initialBottomSettling: deps.isInitialBottomSettling(),
      thresholdPx: STICK_TO_BOTTOM_THRESHOLD_PX,
      force,
      ...readGeometry(stream),
    });
    writeVisibility(visible, forceDomWrite);
  }

  function applyEffect(transition: SmoothScrollTransition): boolean {
    const effect = transition.effect;
    if (effect.kind === 'smooth-to' && typeof effect.scrollHeight === 'number') {
      const started = deps.scrollStreamToEndSmooth(effect.scrollHeight);
      if (!started) {
        smoothState = { status: 'idle' };
        return false;
      }
      return true;
    }
    if (effect.kind === 'stop' && effect.mode === 'converge-to-bottom') {
      deps.scrollStreamToBottomFallback('scroll-to-end-converge');
    }
    return false;
  }

  function scheduleTick(): void {
    if (smoothState.status !== 'running') return;
    if (rafId !== null) cancelRaf(rafId);
    rafId = raf(() => {
      rafId = null;
      const stream = deps.getStreamElement();
      if (!stream || smoothState.status !== 'running') {
        clearTimers();
        smoothState = { status: 'idle' };
        syncVisibility();
        return;
      }
      const transition = reduceSmoothScrollSession(
        smoothState,
        {
          type: 'FRAME',
          ticket: smoothState.ticket,
          nowMs: now(),
          ...readGeometry(stream),
        },
        reducerOptions(),
      );
      smoothState = transition.state;
      applyEffect(transition);
      syncVisibility();
      if (smoothState.status === 'running') scheduleTick();
      else clearTimers();
    });
  }

  function armTimeout(): void {
    if (timeoutId !== null) clearLater(timeoutId);
    timeoutId = later(() => {
      timeoutId = null;
      const stream = deps.getStreamElement();
      if (!stream || smoothState.status !== 'running') return;
      const transition = reduceSmoothScrollSession(
        smoothState,
        { type: 'TIMEOUT', ticket: smoothState.ticket, ...readGeometry(stream) },
        reducerOptions(),
      );
      smoothState = transition.state;
      applyEffect(transition);
      syncVisibility();
      clearTimers();
    }, SCROLL_TO_END_TIMEOUT_MS);
  }

  function scrollToEnd(): void {
    const stream = deps.getStreamElement();
    if (!stream) return;
    const transition = reduceSmoothScrollSession(
      smoothState,
      { type: 'CLICK', nowMs: now(), ...readGeometry(stream) },
      reducerOptions(),
    );
    smoothState = transition.state;
    const started = applyEffect(transition);
    if (smoothState.status === 'running' && started) {
      armTimeout();
      scheduleTick();
      syncVisibility();
    } else {
      clearTimers();
      syncVisibility('hidden');
    }
  }

  function cancelSmoothScroll(options: CancelSmoothScrollOptions): void {
    const stream = deps.getStreamElement();
    const eventType = options.stopNativeSmooth
      ? 'USER_INTERRUPT'
      : options.reason === 'disconnect'
        ? 'DISCONNECT'
        : 'SESSION_ENTER';
    const transition = reduceSmoothScrollSession(
      smoothState,
      { type: eventType },
      reducerOptions(),
    );
    smoothState = transition.state;
    if (transition.effect.kind === 'stop' && transition.effect.mode === 'instant-at-current' && stream) {
      stream.scrollTo({ top: stream.scrollTop, behavior: 'instant' });
    }
    clearTimers();
    if (options.hideImmediately) {
      suppressMotionBriefly();
      syncVisibility('hidden', true);
    } else {
      syncVisibility();
    }
  }

  function ensureActionbar(dock: HTMLElement): HTMLElement {
    const existing = Array.from(dock.children).find(
      (child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains(ACTIONBAR_CLASS),
    );
    if (existing) {
      const existingInner = existing.querySelector<HTMLElement>(`.${INNER_CLASS}`);
      const existingHost = existing.querySelector<HTMLElement>(`#${HOST_ID}`);
      if (existingInner && existingHost) {
        actionbarEl = existing;
        innerEl = existingInner;
        hostEl = existingHost;
        return existing;
      }
      // 【防重复 (Rules)】旧节点结构残缺时必须整体移除，否则 dock 内会出现两条 actionbar，
      //   CSS 与监听都会双份生效。
      existing.remove();
    }

    const actionbar = document.createElement('div');
    actionbar.className = ACTIONBAR_CLASS;
    // 【首帧稳定 (Rules)】首次挂载 lastVisible 为 null 时，必须先按真实几何算一次可见性，
    //   否则会先写可见态（头像让位 40px），随后 syncVisibility 才改回隐藏，首帧出现一次位移。
    let initialVisible = lastVisible;
    if (initialVisible === null) {
      const stream = deps.getStreamElement();
      initialVisible = stream
        ? decideScrollEndVisibility({
            gatewayConnected: deps.isGatewayConnected(),
            enterPending: deps.isSessionEnterPending(),
            initialBottomSettling: deps.isInitialBottomSettling(),
            thresholdPx: STICK_TO_BOTTOM_THRESHOLD_PX,
            ...readGeometry(stream),
          })
        : false;
    }
    actionbar.dataset.atBottom = initialVisible ? 'false' : 'true';
    actionbar.dataset.presenceLayout = deps.getPresenceLayout();

    const inner = document.createElement('div');
    inner.className = INNER_CLASS;

    const host = document.createElement('div');
    host.id = HOST_ID;

    inner.appendChild(host);
    actionbar.appendChild(inner);
    dock.insertBefore(actionbar, dock.firstElementChild);

    actionbarEl = actionbar;
    innerEl = inner;
    hostEl = host;
    lastSyncedActionbar = null;
    lastSyncedButton = null;
    return actionbar;
  }

  function mountOrUpdateButton(): void {
    if (!hostEl) return;
    const fingerprint = `${deps.getPresenceLayout()}:${deps.getLang()}`;
    if (!mountHandle) {
      mountHandle = deps.mountButton(hostEl, () => ({
        label: deps.t('conversation.scrollToEnd'),
        ariaLabel: deps.t('conversation.scrollToEndAria'),
        onClick: scrollToEnd,
        onCommit: () => syncVisibility(undefined, true),
      }));
      mountedFingerprint = fingerprint;
      return;
    }
    if (fingerprint !== mountedFingerprint) {
      mountedFingerprint = fingerprint;
      mountHandle.update();
    }
  }

  function syncHost(): void {
    if (!deps.isGatewayConnected()) {
      cancelSmoothScroll({ stopNativeSmooth: false, reason: 'disconnect' });
      unmountHost();
      return;
    }
    const dock = deps.getDockElement();
    if (!dock) {
      unmountHost();
      return;
    }
    if (!actionbarEl?.isConnected) {
      // 【重建自愈 (Rules)】input-dock outerHTML 重建后，旧 React root 的容器已脱离文档；
      //   必须卸载句柄并清指纹，否则 mountOrUpdateButton 会以为仍然挂载，按钮永久消失。
      mountHandle?.unmount();
      mountHandle = null;
      mountedFingerprint = '';
      actionbarEl = null;
      innerEl = null;
      hostEl = null;
      ensureActionbar(dock);
    }
    if (actionbarEl && actionbarEl.dataset.presenceLayout !== deps.getPresenceLayout()) {
      actionbarEl.dataset.presenceLayout = deps.getPresenceLayout();
    }
    if (innerEl && deps.getPresenceLayout() === 'dock') {
      const presenceHost = document.getElementById(PRESENCE_HOST_ID);
      if (presenceHost && presenceHost.parentElement !== innerEl) {
        innerEl.appendChild(presenceHost);
      }
    }
    mountOrUpdateButton();
    const stream = deps.getStreamElement();
    if (stream) bindStreamListeners(stream);
    syncVisibility();
  }

  function unmountHost(): void {
    mountHandle?.unmount();
    mountHandle = null;
    mountedFingerprint = '';
    actionbarEl?.remove();
    actionbarEl = null;
    innerEl = null;
    hostEl = null;
    lastVisible = null;
    lastSyncedActionbar = null;
    lastSyncedButton = null;
  }

  function bindStreamListeners(stream: HTMLElement | null): void {
    // 【规则】stream 变化时先解绑旧监听，再绑新流；scrollend 不支持时由 rAF + 超时兜底。
    if (!stream || stream === boundStream) return;
    for (const disposeListener of disposers.splice(0)) disposeListener();
    boundStream = stream;

    const onScrollEnd = (): void => {
      if (smoothState.status !== 'running') return;
      const target = deps.getStreamElement();
      if (!target) return;
      const transition = reduceSmoothScrollSession(
        smoothState,
        { type: 'SCROLLEND', ticket: smoothState.ticket, nowMs: now(), ...readGeometry(target) },
        reducerOptions(),
      );
      smoothState = transition.state;
      applyEffect(transition);
      syncVisibility();
      if (smoothState.status !== 'running') clearTimers();
    };

    const onInterrupt = (): void => {
      if (smoothState.status !== 'running') return;
      cancelSmoothScroll({ stopNativeSmooth: true });
    };

    const onToggle = (): void => {
      // 捕获阶段监听 <details> 开合：toggle 不冒泡，必须 capture。
      syncVisibility();
    };

    const onResize = (): void => {
      if (resizeScheduled) return;
      resizeScheduled = true;
      raf(() => {
        resizeScheduled = false;
        syncVisibility();
      });
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (smoothState.status !== 'running') return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) {
        cancelSmoothScroll({ stopNativeSmooth: true });
      }
    };

    stream.addEventListener('scrollend', onScrollEnd);
    stream.addEventListener('wheel', onInterrupt, { passive: true });
    stream.addEventListener('touchmove', onInterrupt, { passive: true });
    stream.addEventListener('pointerdown', onInterrupt, { passive: true });
    stream.addEventListener('toggle', onToggle, { capture: true, passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('keydown', onKeyDown, { capture: true });

    disposers.push(
      () => stream.removeEventListener('scrollend', onScrollEnd),
      () => stream.removeEventListener('wheel', onInterrupt),
      () => stream.removeEventListener('touchmove', onInterrupt),
      () => stream.removeEventListener('pointerdown', onInterrupt),
      () => stream.removeEventListener('toggle', onToggle, { capture: true }),
      () => window.removeEventListener('resize', onResize),
      () => window.removeEventListener('keydown', onKeyDown, { capture: true }),
    );
  }

  function dispose(): void {
    cancelSmoothScroll({ stopNativeSmooth: false });
    clearTimers();
    if (suppressTimerId !== null) {
      clearLater(suppressTimerId);
      suppressTimerId = null;
    }
    for (const disposeListener of disposers.splice(0)) disposeListener();
    boundStream = null;
    unmountHost();
  }

  return {
    ensureActionbar,
    syncHost,
    syncVisibility,
    scrollToEnd,
    isSmoothScrollActive,
    cancelSmoothScroll,
    bindStreamListeners,
    dispose,
  };
}
