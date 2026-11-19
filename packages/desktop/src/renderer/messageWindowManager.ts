/**
 * 对话流窗口管理服务 (Message Window Manager)
 *
 * 【当前事实 (2026-11-16 起)】已切换为「方案 1 纯原生流」：
 *   `messageWindowStart = 0`、`messageWindowEnd = total`、`computeVirtualHeightPx() = 0`，
 *   DOM 中不存在 `.conv-virtual-window`。历史文档里的「虚拟窗口」描述全部废弃，
 *   新逻辑必须按纯原生流 + `content-visibility: auto` 设计，禁止据此恢复切片窗口。
 *
 * 【设计意图 (Why)】
 *   将长会话（实测上千条消息）的窗口切片规划、平均行高锁定、占位高度计算、
 *   DOM ResizeObserver 几何观察与视口校正收敛于单一领域管理器。
 *   彻底解除 index.ts 中散落的模块级状态与几何逻辑，实现零反向依赖与单向注入。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 行高锁定未按真实同 ID 节点去重，导致包含复制/重试按钮的子节点被重复累加高度；
 *   2. ResizeObserver 展开/收起时在容器变矮瞬间未登记 layoutDriftUntil 豁免窗口，
 *      导致被浏览器钳制产生的 scroll 事件被误判为读者手动向上回溯；
 *   3. 切会话未重锁行高，沿用上一个会话口径导致贴底落在最后一条消息之后（整屏空白）。
 *
 * 【约束与规则 (Rules)】
 *   - 零反向依赖：不得 import index.ts，所有外部能力与宿主副作用一律通过 deps 注入；
 *   - 零 as any：所有类型严格校验，满足 TypeScript strict 类型安全；
 *   - 纯粹性：在没有 DOM 的纯 Node 环境下单测可安全执行（有守卫降级）。
 */

import {
  planMessageWindow,
  windowEndFor,
  expandMessageWindowStart,
  slideMessageWindowDown,
  windowStartAroundIndex,
  planAverageRowHeightLock,
} from './messageWindow.js';

export const INITIAL_RENDER_WINDOW = 24;
export const RENDER_WINDOW_STEP = 40;
export const MESSAGE_WINDOW_CAPACITY = 120;
export const STICK_TO_BOTTOM_THRESHOLD_PX = 48;

export interface MessageWindowManagerDeps {
  getState: () => {
    activeSessionId: string;
    messages: Array<{ id: string }>;
  };
  render: () => void;
  isStreamNearBottom: (stream: HTMLElement) => boolean;
  scrollStreamToBottom: (reason: string) => void;
  scrollStreamToContentBottom: (stream: HTMLElement, inset: number) => void;
  settleInitialBottom: () => void;
  syncPromptNavigatorFromScroll: () => void;
  onSessionSwitched?: () => void;
  setCanvasStructureDirty?: (val: boolean) => void;
  setSuppressPinBottomOnce?: (val: boolean) => void;
  setSessionSwitchPending?: (val: boolean) => void;
  setSettleMinFrames?: (val: number) => void;
  setInitialBottomSettling?: (val: boolean) => void;
  setSettledLayoutSignature?: (val: string) => void;
  setLastStreamScrollTop?: (val: number) => void;
  setStreamScrollCooldown?: (val: boolean) => void;
  logScroll?: {
    trace: (msg: string, meta?: unknown) => void;
    debug: (msg: string, meta?: unknown) => void;
  };
}

export interface MessageWindowManager {
  ensureMessageWindow(total: number): void;
  expandMessageWindow(): boolean;
  slideMessageWindowForward(): void;
  relocateMessageWindowToIndex(index: number): boolean;
  syncScrollTopToWindow(reason: string): void;
  scheduleVirtualHeightSync(attempt?: number): void;
  lockAverageRowHeight(): boolean;
  syncCanvasVirtualHeight(): void;
  observeVirtualWindowGeometry(attempt?: number): void;
  computeContentOffsetPx(): number;
  computeVirtualHeightPx(): number;
  layoutSignature(): string;
  markProgrammaticScroll(stream: HTMLElement): void;

  getMessageWindowStart(): number;
  setMessageWindowStart(val: number): void;
  getMessageWindowEnd(): number;
  setMessageWindowEnd(val: number): void;
  isMessageWindowUserExpanded(): boolean;
  setMessageWindowUserExpanded(val: boolean): void;
  getAverageRowHeightPx(): number;
  isAverageRowHeightLocked(): boolean;
  getLayoutDriftUntil(): number;
  setLayoutDriftUntil(val: number): void;
  getProgrammaticScrollTarget(): number | null;
  getProgrammaticScrollIgnoreUntil(): number;
  getReaderScrolledSessionId(): string;
  setReaderScrolledSessionId(val: string): void;
  dispose(): void;
}

export function createMessageWindowManager(deps: MessageWindowManagerDeps): MessageWindowManager {
  let messageWindowStart = 0;
  let messageWindowEnd = 0;
  let messageWindowUserExpanded = false;
  let messageWindowSessionId = '';

  let averageRowHeightPx = 96;
  let averageRowHeightSessionId = '';
  let averageRowHeightLocked = false;

  let virtualWindowObserver: ResizeObserver | null = null;
  let virtualWindowObserved: HTMLElement | null = null;
  let observedWindowHeight = 0;
  let layoutDriftUntil = 0;

  let programmaticScrollTarget: number | null = null;
  let programmaticScrollIgnoreUntil = 0;
  let readerScrolledSessionId = '';

  const logScroll = deps.logScroll ?? {
    trace: () => {},
    debug: () => {},
  };

  function layoutSignature(): string {
    const total = deps.getState().messages.length;
    return `${total}:${averageRowHeightLocked ? averageRowHeightPx.toFixed(2) : 'pending'}`;
  }

  function markProgrammaticScroll(stream: HTMLElement): void {
    programmaticScrollTarget = Math.round(stream.scrollTop);
    programmaticScrollIgnoreUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 80;
  }

  function ensureMessageWindow(total: number): void {
    const state = deps.getState();
    const sessionChanged = messageWindowSessionId !== state.activeSessionId;
    if (sessionChanged) {
      messageWindowSessionId = state.activeSessionId;
      averageRowHeightLocked = false;
      averageRowHeightSessionId = '';
      programmaticScrollTarget = null;
      programmaticScrollIgnoreUntil = 0;
      readerScrolledSessionId = '';
      observedWindowHeight = 0;
      layoutDriftUntil = 0;

      deps.onSessionSwitched?.();
      deps.setLastStreamScrollTop?.(0);
      deps.setSettledLayoutSignature?.('');
      deps.setInitialBottomSettling?.(false);
      deps.setStreamScrollCooldown?.(false);
      deps.setSessionSwitchPending?.(true);
      deps.setSettleMinFrames?.(8);

      if (typeof document !== 'undefined') {
        document.getElementById('conversation-stream')?.style.removeProperty('--conv-gutter-bottom');
      }
    }

    // 【方案 1 纯原生流】直接全量挂载，由 Chromium 内核 CSS content-visibility: auto 处理离屏遏制
    messageWindowStart = 0;
    messageWindowEnd = total;
    messageWindowUserExpanded = false;
  }

  function expandMessageWindow(): boolean {
    const total = deps.getState().messages.length;
    const nextStart = expandMessageWindowStart(
      messageWindowStart,
      RENDER_WINDOW_STEP,
      Math.max(0, total - MESSAGE_WINDOW_CAPACITY),
    );
    const nextEnd = windowEndFor(nextStart, total, MESSAGE_WINDOW_CAPACITY, INITIAL_RENDER_WINDOW);
    if (nextStart === messageWindowStart && nextEnd === messageWindowEnd) return false;
    messageWindowStart = nextStart;
    messageWindowEnd = nextEnd;
    messageWindowUserExpanded = true;
    deps.setCanvasStructureDirty?.(true);
    deps.setSuppressPinBottomOnce?.(true);
    deps.render();
    return true;
  }

  function slideMessageWindowForward(): void {
    const total = deps.getState().messages.length;
    const capacity = MESSAGE_WINDOW_CAPACITY;
    if (total <= capacity || messageWindowEnd >= total) return;
    const nextStart = slideMessageWindowDown(
      messageWindowStart,
      total,
      capacity,
      RENDER_WINDOW_STEP,
      INITIAL_RENDER_WINDOW,
    );
    if (nextStart === messageWindowStart) return;
    messageWindowStart = nextStart;
    messageWindowEnd = windowEndFor(nextStart, total, capacity, INITIAL_RENDER_WINDOW);
    // 【尾部自愈收敛 (Why)】若窗口向前滑动已彻底覆盖物理尾部，且视口处于贴底区间，
    //   解除 userExpanded 锁定，恢复自然流式尾部跟随。
    const maxStart = Math.max(0, total - capacity);
    if (nextStart >= maxStart) {
      const stream = typeof document !== 'undefined' ? document.getElementById('conversation-stream') : null;
      if (!stream || deps.isStreamNearBottom(stream)) {
        messageWindowUserExpanded = false;
      }
    }
    deps.setCanvasStructureDirty?.(true);
    deps.render();
    // 【禁止调用 syncScrollTopToWindow (Pitfall)】向下平滑滑窗是读者的自然连续手势，
    //   此时严禁调用 syncScrollTopToWindow 强改 stream.scrollTop！
    //   该函数依据粗暴平均行高估算，在包含巨型工具块的长会话中会导致实际位置远大于 virtualBottom，
    //   误判出界将读者瞬间反向弹飞数万像素（Rubber-banding Pop）。保持原生滚动惯性。
    logScroll.trace('window slid forward on downward scroll', {
      start: messageWindowStart,
      end: messageWindowEnd,
      total,
    });
  }

  function relocateMessageWindowToIndex(index: number): boolean {
    const total = deps.getState().messages.length;
    if (!Number.isFinite(index) || index < 0 || index >= total) return false;
    const nextStart = windowStartAroundIndex(index, total, MESSAGE_WINDOW_CAPACITY, 4, INITIAL_RENDER_WINDOW);
    const nextEnd = windowEndFor(nextStart, total, MESSAGE_WINDOW_CAPACITY, INITIAL_RENDER_WINDOW);
    if (nextStart === messageWindowStart && nextEnd === messageWindowEnd) return false;
    messageWindowStart = nextStart;
    messageWindowEnd = nextEnd;
    messageWindowUserExpanded = true;
    deps.setCanvasStructureDirty?.(true);
    return true;
  }

  function syncScrollTopToWindow(reason: string): void {
    // 【方案 1 纯原生流核心防御】严禁在用户滚动或窗口展开时修改 stream.scrollTop！
    // 杜绝任何反向弹飞与破坏浏览器原生惯性滚动的行为。
    logScroll.trace('syncScrollTopToWindow bypassed in native flow', { reason });
  }

  function scheduleVirtualHeightSync(_attempt = 0): void {
    // 方案 1 原生流下无需递归 8~90 帧拉扯，单帧安全收敛
    if (typeof requestAnimationFrame === 'undefined') {
      deps.settleInitialBottom();
      return;
    }
    requestAnimationFrame(() => {
      deps.settleInitialBottom();
    });
  }

  function lockAverageRowHeight(): boolean {
    const currentState = deps.getState();
    if (averageRowHeightLocked && averageRowHeightSessionId === currentState.activeSessionId) return false;
    if (averageRowHeightSessionId !== currentState.activeSessionId) {
      averageRowHeightSessionId = currentState.activeSessionId;
      averageRowHeightLocked = false;
      averageRowHeightPx = 96;
    }
    if (typeof document === 'undefined') return false;
    const canvas = document.querySelector<HTMLElement>('.conv-canvas');
    if (!canvas) return false;
    const rows = canvas.querySelectorAll<HTMLElement>('[data-msg-id]');
    if (rows.length < 5) return false;

    let contentH = 0;
    const seenIds = new Set<string>();
    const measuredIds: string[] = [];
    for (const row of rows) {
      const id = row.getAttribute('data-msg-id');
      if (id) {
        if (seenIds.has(id)) continue;
        const outerSame = row.parentElement?.closest('[data-msg-id]');
        if (outerSame && outerSame.getAttribute('data-msg-id') === id) continue;
        seenIds.add(id);
        measuredIds.push(id);
      }
      const h = row.getBoundingClientRect().height;
      if (Number.isFinite(h) && h > 0) contentH += h;
    }

    const plan = planAverageRowHeightLock({
      windowStart: messageWindowStart,
      windowEnd: messageWindowEnd,
      total: currentState.messages.length,
      contentHeightPx: contentH,
      measuredIds,
      windowIds: currentState.messages
        .slice(messageWindowStart, messageWindowEnd)
        .map((m) => m.id),
    });
    if (!plan.lock) return false;
    averageRowHeightPx = plan.averageRowHeightPx;
    averageRowHeightLocked = true;
    return true;
  }

  function syncCanvasVirtualHeight(): void {
    if (typeof document === 'undefined') return;
    const canvas = document.querySelector<HTMLElement>('.conv-canvas');
    if (!canvas) return;
    if (canvas.style.minHeight) canvas.style.minHeight = '';
  }

  function observeVirtualWindowGeometry(attempt = 0): void {
    if (typeof ResizeObserver === 'undefined' || typeof document === 'undefined') return;
    const windowEl = document.querySelector<HTMLElement>('.conv-virtual-window');
    if (!windowEl) {
      virtualWindowObserver?.disconnect();
      virtualWindowObserved = null;
      observedWindowHeight = 0;
      if (attempt < 8 && typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => observeVirtualWindowGeometry(attempt + 1));
      }
      return;
    }

    if (!virtualWindowObserver) {
      virtualWindowObserver = new ResizeObserver((entries) => {
        const height =
          entries[0]?.borderBoxSize?.[0]?.blockSize ??
          entries[0]?.contentRect.height ??
          0;
        const previousHeight = observedWindowHeight;
        const shrank = previousHeight > 0 && height < previousHeight - 1;
        observedWindowHeight = height;
        if (shrank) {
          layoutDriftUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 200;
        }

        const messages = deps.getState().messages;
        if (messageWindowEnd < messages.length) return;
        const stream = document.getElementById('conversation-stream');
        if (!stream) return;

        const heightDelta = previousHeight > 0 ? previousHeight - height : 0;
        const distanceBefore = stream.scrollHeight + heightDelta - stream.scrollTop - stream.clientHeight;
        const wasNearBottom = distanceBefore <= STICK_TO_BOTTOM_THRESHOLD_PX;

        const align = (): void => {
          if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(() => {
              const target = document.getElementById('conversation-stream');
              if (!target) return;
              deps.scrollStreamToContentBottom(target, parseFloat(getComputedStyle(target).paddingBottom) || 0);
            });
          }
        };

        if (!wasNearBottom) return;
        align();
      });
    }

    if (virtualWindowObserved !== windowEl) {
      virtualWindowObserver.disconnect();
      virtualWindowObserver.observe(windowEl);
      virtualWindowObserved = windowEl;
      observedWindowHeight = 0;
    }
  }

  function computeContentOffsetPx(): number {
    return 0;
  }

  function computeVirtualHeightPx(): number {
    return 0;
  }

  function dispose(): void {
    if (virtualWindowObserver) {
      virtualWindowObserver.disconnect();
      virtualWindowObserver = null;
      virtualWindowObserved = null;
    }
  }

  return {
    ensureMessageWindow,
    expandMessageWindow,
    slideMessageWindowForward,
    relocateMessageWindowToIndex,
    syncScrollTopToWindow,
    scheduleVirtualHeightSync,
    lockAverageRowHeight,
    syncCanvasVirtualHeight,
    observeVirtualWindowGeometry,
    computeContentOffsetPx,
    computeVirtualHeightPx,
    layoutSignature,
    markProgrammaticScroll,

    getMessageWindowStart: () => messageWindowStart,
    setMessageWindowStart: (val: number) => { messageWindowStart = val; },
    getMessageWindowEnd: () => messageWindowEnd,
    setMessageWindowEnd: (val: number) => { messageWindowEnd = val; },
    isMessageWindowUserExpanded: () => messageWindowUserExpanded,
    setMessageWindowUserExpanded: (val: boolean) => { messageWindowUserExpanded = val; },
    getAverageRowHeightPx: () => averageRowHeightPx,
    isAverageRowHeightLocked: () => averageRowHeightLocked,
    getLayoutDriftUntil: () => layoutDriftUntil,
    setLayoutDriftUntil: (val: number) => { layoutDriftUntil = val; },
    getProgrammaticScrollTarget: () => programmaticScrollTarget,
    getProgrammaticScrollIgnoreUntil: () => programmaticScrollIgnoreUntil,
    getReaderScrolledSessionId: () => readerScrolledSessionId,
    setReaderScrolledSessionId: (val: string) => { readerScrolledSessionId = val; },
    dispose,
  };
}
