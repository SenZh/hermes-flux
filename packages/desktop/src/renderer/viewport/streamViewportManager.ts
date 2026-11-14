/**
 * 会话流视口滚动与锚定定位管理器（Stream Viewport & Anchor Manager）
 *
 * 【设计意图 (Why)】
 *   将长消息流滚动容器的视口贴底跟随、DOM 锚点捕捉与防抖恢复（StreamAnchor）、
 *   首屏多帧平滑贴底（settleInitialBottom）、底部浮层安全内边距（syncStreamBottomInset）
 *   从 `renderer/index.ts` 中彻底剥离。
 *   实现跨端、跨分辨率与虚拟化窗口状态下视口位置的几何计算与状态机解耦，
 *   使锚点校正与贴底判定可脱离宿主进行确定性单元测试。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 贴底必须按真实窗口底边对齐，禁止直接写 `scrollTop = scrollHeight`，
 *      因为虚拟高度是「总条数 × 平均行高」的估算值，与真实窗口可差数千像素；
 *   2. 跳转落定或首屏落定期间，绝对禁止按旧锚点反推位移，否则会把贴好位置反向抵消；
 *   3. 锚点落在挂载窗口外时只做退化处理，绝不反向搬移窗口，防止向上回溯时出现行震荡；
 *   4. 输入舱高度变化必须通过 ResizeObserver 触发底部内边距重算，并保留 4px 死区吸收亚像素抖动。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯 TypeScript 无界模块，所有 DOM 与状态通过 StreamViewportHost 注入；
 *   2. 贴底阈值严格锁定为 48px（STICK_TO_BOTTOM_THRESHOLD_PX）；
 *   3. 严禁 `as any`，入参严格防御。
 */

export const STICK_TO_BOTTOM_THRESHOLD_PX = 48;

export interface StreamAnchor {
  sessionId: string;
  id: string | null;
  offset: number;
  rawScrollTop: number;
}

export interface StreamViewportHost {
  readonly getStreamElement: () => HTMLElement | null;
  readonly getVirtualWindowElement?: () => HTMLElement | null;
  readonly getMiddlePodElement?: () => HTMLElement | null;
  readonly getInputDockElement?: () => HTMLElement | null;
  readonly getActiveSessionId: () => string;
  readonly getPresenceLayout: () => 'stage' | 'dock';
  readonly isPromptJumpSettling: () => boolean;
  readonly getMessageWindowEnd: () => number;
  readonly getTotalMessages: () => number;
  readonly getMessageWindowStart?: () => number;
  readonly getAverageRowHeightPx?: () => number;
  readonly layoutSignature: () => string;
  readonly markProgrammaticScroll: (stream: HTMLElement) => void;
  readonly logTrace?: (message: string, meta?: Record<string, unknown>) => void;
  readonly logDebug?: (message: string, meta?: Record<string, unknown>) => void;
  readonly requestAnimationFrame?: (callback: () => void) => number;
  readonly getInitialBottomSettling?: () => boolean;
  readonly setInitialBottomSettling?: (val: boolean) => void;
  readonly getSettleMinFrames?: () => number;
  readonly setSettleMinFrames?: (val: number) => void;
  readonly getSettledLayoutSignature?: () => string;
  readonly setSettledLayoutSignature?: (val: string) => void;
}

export class StreamViewportManager {
  private initialBottomSettling = false;
  private settleMinFrames = 0;
  private settledLayoutSignature = '';

  private dockInsetObserver: ResizeObserver | null = null;
  private dockInsetTarget: HTMLElement | null = null;
  private insetSyncScheduled = false;

  constructor(private readonly host: StreamViewportHost) {}

  public isInitialBottomSettling(): boolean {
    return this.host.getInitialBottomSettling ? this.host.getInitialBottomSettling() : this.initialBottomSettling;
  }

  public setInitialBottomSettling(val: boolean): void {
    this.initialBottomSettling = val;
    this.host.setInitialBottomSettling?.(val);
  }

  public getSettleMinFrames(): number {
    return this.host.getSettleMinFrames ? this.host.getSettleMinFrames() : this.settleMinFrames;
  }

  public setSettleMinFrames(val: number): void {
    this.settleMinFrames = val;
    this.host.setSettleMinFrames?.(val);
  }

  public getSettledLayoutSignature(): string {
    return this.host.getSettledLayoutSignature ? this.host.getSettledLayoutSignature() : this.settledLayoutSignature;
  }

  public setSettledLayoutSignature(val: string): void {
    this.settledLayoutSignature = val;
    this.host.setSettledLayoutSignature?.(val);
  }

  private runRaf(callback: () => void): void {
    if (this.host.requestAnimationFrame) {
      this.host.requestAnimationFrame(callback);
    } else if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(callback);
    } else {
      setTimeout(callback, 16);
    }
  }

  public isNearBottom(stream: HTMLElement | null = this.host.getStreamElement()): boolean {
    if (!stream) return false;
    return stream.scrollHeight - stream.scrollTop - stream.clientHeight <= STICK_TO_BOTTOM_THRESHOLD_PX;
  }

  /**
   * 贴底：窗口覆盖末尾时把窗口真实底边对齐到「输入舱上方安全线」，否则滚到 scrollHeight。
   */
  public scrollStreamToContentBottom(stream: HTMLElement, reservePx: number): void {
    const virtualWindow = this.host.getVirtualWindowElement
      ? this.host.getVirtualWindowElement()
      : document.querySelector<HTMLElement>('.conv-virtual-window');
    const windowEnd = this.host.getMessageWindowEnd();
    const totalMessages = this.host.getTotalMessages();

    if (virtualWindow && windowEnd >= totalMessages) {
      const streamRect = stream.getBoundingClientRect();
      const windowRect = virtualWindow.getBoundingClientRect();
      const delta = Math.round(windowRect.bottom - (streamRect.bottom - reservePx));
      if (Math.abs(delta) > 2) {
        stream.scrollTop += delta;
        this.host.markProgrammaticScroll(stream);
      }
      return;
    }
    stream.scrollTop = stream.scrollHeight;
    this.host.markProgrammaticScroll(stream);
  }

  /**
   * 把会话流钉在最新消息处，并在下一帧布局落定后二次校正微小漂移。
   */
  public scrollStreamToBottom(reason: string): void {
    const stream = this.host.getStreamElement();
    if (!stream) return;
    const paddingBottom = typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(stream).paddingBottom) || 0 : 0;
    this.scrollStreamToContentBottom(stream, paddingBottom);

    this.runRaf(() => {
      const settled = this.host.getStreamElement();
      if (!settled) return;
      const drift = settled.scrollHeight - settled.scrollTop - settled.clientHeight;
      if (drift > 1) {
        const settledPadding = typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(settled).paddingBottom) || 0 : 0;
        this.scrollStreamToContentBottom(settled, settledPadding);
      }
      this.host.logDebug?.('pinned to bottom', {
        reason,
        scrollHeight: settled.scrollHeight,
        clientHeight: settled.clientHeight,
        residualDrift: Math.round(drift),
      });
    });
  }

  /**
   * 首屏落定：在落定期内逐帧把视口贴到最新消息。
   */
  public settleInitialBottom(attempt = 0): void {
    if (!this.initialBottomSettling) return;
    this.runRaf(() => {
      if (!this.initialBottomSettling) return;
      const stream = this.host.getStreamElement();
      if (!stream) {
        this.initialBottomSettling = false;
        this.settledLayoutSignature = this.host.layoutSignature();
        return;
      }
      const distance = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
      const reserve = typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(stream).paddingBottom) || 0 : 0;
      this.scrollStreamToContentBottom(stream, reserve);
      const after = Math.abs(stream.scrollHeight - stream.scrollTop - stream.clientHeight);

      if (this.settleMinFrames > 0) {
        this.settleMinFrames -= 1;
      } else if (after <= 2 || Math.abs(distance - after) <= 2) {
        const virtualWindow = this.host.getVirtualWindowElement
          ? this.host.getVirtualWindowElement()
          : document.querySelector<HTMLElement>('.conv-virtual-window');
        const windowBottom = virtualWindow?.getBoundingClientRect().bottom;
        const safeBottom = stream.getBoundingClientRect().bottom - reserve;
        if (windowBottom === undefined || Math.abs(windowBottom - safeBottom) <= 2) {
          this.initialBottomSettling = false;
          this.settledLayoutSignature = this.host.layoutSignature();
          return;
        }
      }

      if (attempt < 90) {
        this.settleInitialBottom(attempt + 1);
        return;
      }
      this.initialBottomSettling = false;
      this.settledLayoutSignature = this.host.layoutSignature();
      this.host.logDebug?.('initial bottom settled', {
        attempt,
        start: this.host.getMessageWindowStart?.() ?? 0,
        scrollHeight: stream.scrollHeight,
        averageRowHeight: Math.round((this.host.getAverageRowHeightPx?.() ?? 96) * 100) / 100,
      });
    });
  }

  /**
   * 会话流底部内边距跟随输入舱实测高度。
   */
  public syncStreamBottomInset(): void {
    const pod = this.host.getMiddlePodElement
      ? this.host.getMiddlePodElement()
      : document.querySelector<HTMLElement>('.flux-middle-pod');
    const dock = this.host.getInputDockElement
      ? this.host.getInputDockElement()
      : document.querySelector<HTMLElement>('.input-dock-container');
    const stream = this.host.getStreamElement();
    if (!pod || !dock || !stream) return;

    const presenceReserve = this.host.getPresenceLayout() === 'dock' ? 40 : 32;
    const baseInset = Math.round(pod.getBoundingClientRect().bottom - dock.getBoundingClientRect().top) + presenceReserve;
    const distance = stream.scrollHeight - stream.scrollTop - stream.clientHeight;

    if (distance <= STICK_TO_BOTTOM_THRESHOLD_PX) {
      const virtualWindow = this.host.getVirtualWindowElement
        ? this.host.getVirtualWindowElement()
        : document.querySelector<HTMLElement>('.conv-virtual-window');
      const contentBottom = virtualWindow
        ? virtualWindow.getBoundingClientRect().bottom
        : document.querySelector<HTMLElement>('.conv-canvas')?.getBoundingClientRect().bottom;
      if (contentBottom !== undefined) {
        const visibleBottom = stream.getBoundingClientRect().bottom - baseInset;
        const need = Math.ceil(contentBottom - visibleBottom);
        const currentPx = Math.round(parseFloat(stream.style.getPropertyValue('--conv-gutter-bottom')) || baseInset);
        const targetPx = Math.abs(need) > 4 ? Math.max(baseInset, currentPx + need) : currentPx;
        const next = `${targetPx}px`;
        const prev = stream.style.getPropertyValue('--conv-gutter-bottom');
        if (next !== prev) {
          stream.style.setProperty('--conv-gutter-bottom', next);
          this.initialBottomSettling = true;
          this.settleInitialBottom();
        }
      }
    }

    if (typeof ResizeObserver === 'undefined') return;
    if (!this.dockInsetObserver) {
      this.dockInsetObserver = new ResizeObserver(() => this.syncStreamBottomInset());
    }
    if (this.dockInsetTarget !== dock) {
      this.dockInsetObserver.disconnect();
      this.dockInsetObserver.observe(dock);
      this.dockInsetTarget = dock;
    }
  }

  /**
   * 将底部留白重算压进一帧。
   */
  public scheduleStreamBottomInset(): void {
    if (this.insetSyncScheduled) return;
    this.insetSyncScheduled = true;
    this.runRaf(() => {
      this.insetSyncScheduled = false;
      this.syncStreamBottomInset();
    });
  }

  /**
   * 捕获当前视口第一条可见消息的相对偏移作为锚点。
   */
  public captureStreamAnchor(): StreamAnchor {
    const activeSessionId = this.host.getActiveSessionId();
    const stream = this.host.getStreamElement();
    if (!stream) return { sessionId: activeSessionId, id: null, offset: 0, rawScrollTop: 0 };
    const streamTop = stream.getBoundingClientRect().top;
    const rows = stream.querySelectorAll<HTMLElement>('[data-msg-id]');
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rect = row.getBoundingClientRect();
      if (rect.bottom > streamTop) {
        return {
          sessionId: activeSessionId,
          id: row.getAttribute('data-msg-id'),
          offset: rect.top - streamTop,
          rawScrollTop: stream.scrollTop,
        };
      }
    }
    return { sessionId: activeSessionId, id: null, offset: 0, rawScrollTop: stream.scrollTop };
  }

  /**
   * 重放并校正流式视口锚点。
   */
  public applyStreamAnchor(anchor: StreamAnchor, pinBottom: boolean): void {
    if (this.host.isPromptJumpSettling()) return;
    if (this.initialBottomSettling) return;
    const stream = this.host.getStreamElement();
    if (!stream) return;

    if (pinBottom) {
      const paddingBottom = typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(stream).paddingBottom) || 0 : 0;
      this.scrollStreamToContentBottom(stream, paddingBottom);
      this.host.logTrace?.('pinned after render', { session: this.host.getActiveSessionId() });
      return;
    }

    if (anchor.sessionId !== this.host.getActiveSessionId()) {
      stream.scrollTop = stream.scrollHeight;
      this.host.markProgrammaticScroll(stream);
      return;
    }

    if (anchor.id) {
      const escapedId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(anchor.id)
        : anchor.id.replace(/["\\]/g, '\\$&');
      const target = stream.querySelector<HTMLElement>(`[data-msg-id="${escapedId}"]`);
      if (target) {
        const streamTop = stream.getBoundingClientRect().top;
        const currentOffset = target.getBoundingClientRect().top - streamTop;
        const delta = currentOffset - anchor.offset;
        if (Math.abs(delta) >= 1) {
          stream.scrollTop += delta;
          this.host.markProgrammaticScroll(stream);
          this.host.logTrace?.('anchor corrected', { id: anchor.id, delta: Math.round(delta) });
        }
        return;
      }
      this.host.logTrace?.('anchor outside mounted window', { id: anchor.id });
    }
    stream.scrollTop = anchor.rawScrollTop;
    this.host.markProgrammaticScroll(stream);
  }

  /**
   * 尾随布局落定后的残余漂移吸收。
   */
  public stabilizeStreamAnchor(anchor: StreamAnchor): void {
    if (this.host.isPromptJumpSettling()) return;
    if (this.initialBottomSettling) return;
    if (!anchor.id) return;
    const stream = this.host.getStreamElement();
    if (!stream) return;

    const escapedId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(anchor.id)
      : anchor.id.replace(/["\\]/g, '\\$&');
    const target = stream.querySelector<HTMLElement>(`[data-msg-id="${escapedId}"]`);
    if (!target) return;

    const streamTop = stream.getBoundingClientRect().top;
    const drift = target.getBoundingClientRect().top - streamTop - anchor.offset;
    if (Math.abs(drift) >= 1) {
      stream.scrollTop += drift;
      this.host.markProgrammaticScroll(stream);
      this.host.logDebug?.('post-layout anchor drift absorbed', { id: anchor.id, drift: Math.round(drift) });
    }
  }
}
