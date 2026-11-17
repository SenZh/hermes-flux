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

import { SessionScrollMemory, AdaptiveMedianEstimator, type ScrollRestoreStrategy } from '@hermes-flux/core';

export const STICK_TO_BOTTOM_THRESHOLD_PX = 48;

/**
 * 消息行选择器。
 * 【设计意图 (Why)】`.msg-action-btn` 也带 `data-msg-id`（MessageFooter.tsx:90-92），
 *   裸用 `[data-msg-id]` 会把 24px 操作按钮当成消息行：锚点可能选中按钮、
 *   行高样本被按钮淹没（实测把 --conv-intrinsic-median-height 压死在 32px 下限）。
 * 【约束与规则 (Rules)】凡按「消息行」读取几何、选择锚点、统计行数的地方，
 *   一律使用本常量；需要按 id 精确查找时也必须追加 `:not(.msg-action-btn)`。
 */
export const MESSAGE_ROW_SELECTOR = '[data-msg-id]:not(.msg-action-btn)';

/**
 * 把消息 id 转义成可安全拼进 `[data-msg-id="..."]` 的属性选择器值。
 *
 * 【设计意图 (Why)】行 id 由网关下发，可能含引号或反斜杠；直接拼接会让
 *   `querySelector` 抛 SyntaxError，而抛错点正好在切换会话的恢复路径上，
 *   用户看到的是"切过去就白屏"，与真实根因（id 未转义）相距很远。
 *
 * 【约束与规则 (Rules)】优先用原生 `CSS.escape`（Node 单测与旧内核可能没有）；
 *   缺失时回落到只转义引号与反斜杠的手写实现，两条路径必须产出同样可用的选择器。
 */
export function escapeMessageId(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(id);
  return id.replace(/["\\]/g, '\\$&');
}

export interface StreamAnchor {
  sessionId: string;
  id: string | null;
  offset: number;
  rawScrollTop: number;
}

/**
 * 会话进入计划。
 * 【设计意图 (Why)】跨会话「进去之后视口在哪」必须是一次显式、可收敛的裁决，
 *   不能再依赖「旧会话 DOM 的 wasNearBottom」或浏览器对旧 scrollTop 的继承：
 *   前者会把上一会话的贴底态串台，后者会留下 350px 这类继承值。
 * 【约束与规则 (Rules)】
 *   1. `probeMessageId` 是「React 已把目标会话提交进 DOM」的判据；未就绪时不计数、不收敛；
 *   2. 收敛条件是连续 2 帧误差 ≤ 2px，硬熔断 30 帧，绝不无限 rAF；
 *   3. 任何用户手势或导航跳转都能立即取消（见 cancelSessionEnter）。
 */

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
  private pendingSessionEnter: { ticket: number; sessionId: string; plan: ScrollRestoreStrategy; probeMessageId: string; frames: number; stableFrames: number; prevScrollHeight: number } | null = null;
  private sessionEnterTicket = 0;

  private readonly sessionScrollMemory = new SessionScrollMemory();
  private readonly medianEstimator = new AdaptiveMedianEstimator();

  private dockInsetObserver: ResizeObserver | null = null;
  private dockInsetTarget: HTMLElement | null = null;
  private insetSyncScheduled = false;

  constructor(private readonly host: StreamViewportHost) {}

  public getSessionScrollMemory(): SessionScrollMemory {
    return this.sessionScrollMemory;
  }

  public getMedianEstimator(): AdaptiveMedianEstimator {
    return this.medianEstimator;
  }

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

  /**
   * 是否处于贴底安全区。
   * 【规则】贴底落点由 `scrollStreamToContentBottom` 按输入舱安全线（`padding-bottom`）对齐，
   *   因此判据必须包含同一个 reserve：只比几何底（`scrollHeight - clientHeight`）会在
   *   安全线大于 48px 时把「视觉贴底」误判成「不在底部」，流式跟随随即断开。
   */
  public isNearBottom(stream: HTMLElement | null = this.host.getStreamElement()): boolean {
    if (!stream) return false;
    const distance = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
    let padding = 0;
    if (typeof getComputedStyle === 'function') {
      padding = parseFloat(getComputedStyle(stream).paddingBottom) || 0;
    }
    return distance <= Math.max(STICK_TO_BOTTOM_THRESHOLD_PX, padding + 8);
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
    if (!this.isInitialBottomSettling()) return;
    this.runRaf(() => {
      if (!this.isInitialBottomSettling()) return;
      const stream = this.host.getStreamElement();
      if (!stream) {
        this.setInitialBottomSettling(false);
        this.setSettledLayoutSignature(this.host.layoutSignature());
        return;
      }
      const distance = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
      const reserve = typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(stream).paddingBottom) || 0 : 0;
      this.scrollStreamToContentBottom(stream, reserve);
      const after = Math.abs(stream.scrollHeight - stream.scrollTop - stream.clientHeight);

      if (this.getSettleMinFrames() > 0) {
        this.setSettleMinFrames(this.getSettleMinFrames() - 1);
      } else if (after <= 2 || Math.abs(distance - after) <= 2) {
        const virtualWindow = this.host.getVirtualWindowElement
          ? this.host.getVirtualWindowElement()
          : document.querySelector<HTMLElement>('.conv-virtual-window');
        const windowBottom = virtualWindow?.getBoundingClientRect().bottom;
        const safeBottom = stream.getBoundingClientRect().bottom - reserve;
        if (windowBottom === undefined || Math.abs(windowBottom - safeBottom) <= 2) {
          this.setInitialBottomSettling(false);
          this.setSettledLayoutSignature(this.host.layoutSignature());
          return;
        }
      }

      if (attempt < 90) {
        this.settleInitialBottom(attempt + 1);
        return;
      }
      this.setInitialBottomSettling(false);
      this.setSettledLayoutSignature(this.host.layoutSignature());
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
          this.setInitialBottomSettling(true);
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
    const streamRect = stream.getBoundingClientRect();
    const streamTop = streamRect.top;
    const streamBottom = streamRect.bottom;
    const rows = stream.querySelectorAll<HTMLElement>(MESSAGE_ROW_SELECTOR);
    let anchorId: string | null = null;
    let anchorOffset = 0;
    let anchorOffsetRatio = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rect = row.getBoundingClientRect();
      /**
       * 【只采样真实渲染行 (Rules)】`content-visibility: auto` 下离屏行的
       * `getBoundingClientRect()` 返回的是 `contain-intrinsic-size` 占位高度（恒等于兜底值）。
       * 若把占位值一并喂给估算器，中位数会被同一个常量淹没，CSS 变量永远等于兜底值，
       * 估算器名义上在跑、实际对滚动条抖动零贡献。
       */
      const intersectsViewport = rect.bottom > streamTop && rect.top < streamBottom;
      if (intersectsViewport && rect.height > 0) {
        this.medianEstimator.addSample(rect.height);
      }
      if (anchorId === null && rect.bottom > streamTop) {
        anchorId = row.getAttribute('data-msg-id');
        anchorOffset = rect.top - streamTop;
        anchorOffsetRatio = rect.height > 0 ? Math.max(0, Math.min(1, (streamTop - rect.top) / rect.height)) : 0;
      }
    }

    if (this.medianEstimator.sampleCount > 0 && typeof stream.style?.setProperty === 'function') {
      stream.style.setProperty('--conv-intrinsic-median-height', `${this.medianEstimator.getMedian()}px`);
    }

    if (activeSessionId) {
      this.sessionScrollMemory.recordSnapshot({
        sessionId: activeSessionId,
        scrollTop: stream.scrollTop,
        scrollHeight: stream.scrollHeight,
        clientHeight: stream.clientHeight,
        anchorMessageId: anchorId || undefined,
        anchorOffsetRatio,
      });
    }

    return {
      sessionId: activeSessionId,
      id: anchorId,
      offset: anchorOffset,
      rawScrollTop: stream.scrollTop,
    };
  }

  /**
   * 重放并校正流式视口锚点。
   */
  /**
   * 开始一次会话进入：生成并锁存视口恢复计划。
   * 【规则】必须在 `state.activeSessionId` 已经切到目标会话、且目标会话记忆已由离开侧写入之后调用；
   *   本方法只读记忆，不读 DOM，因此不受「DOM 尚未替换」的时序影响。
   */
  public beginSessionEnter(sessionId: string, options: { forcePinToBottom?: boolean } = {}): void {
    if (!sessionId) {
      this.pendingSessionEnter = null;
      return;
    }
    const ticket = ++this.sessionEnterTicket;
    let plan: ScrollRestoreStrategy;
    if (options.forcePinToBottom) {
      plan = { type: 'pin-to-bottom', reason: 'new-session' };
    } else {
      plan = this.sessionScrollMemory.planSessionEnter(sessionId);
    }
    this.pendingSessionEnter = {
      ticket,
      sessionId,
      plan,
      probeMessageId: '',
      frames: 0,
      stableFrames: 0,
      prevScrollHeight: 0,
    };
    // 回溯类计划必须关闭落底门禁，否则 settleInitialBottom 会把它拽回底部。
    if (plan.type !== 'pin-to-bottom') this.setInitialBottomSettling(false);
  }

  public isSessionEnterPending(): boolean {
    return this.pendingSessionEnter !== null;
  }

  public getPendingSessionEnter(): { sessionId: string; kind: ScrollRestoreStrategy['type'] } | null {
    const pending = this.pendingSessionEnter;
    return pending ? { sessionId: pending.sessionId, kind: pending.plan.type } : null;
  }

  public cancelSessionEnter(): void {
    this.pendingSessionEnter = null;
  }

  /**
   * 推进进入计划。
   * 【规则】`probeMessageId` 由宿主在每次 render 时喂入（目标会话最后一条可见消息 id）：
   *   它挂载之前一律视为「React 尚未提交」，不写位置也不计数收敛，避免在骨架高度上贴成 0。
   */
  public settleSessionEnter(probeMessageId?: string): void {
    const pending = this.pendingSessionEnter;
    if (!pending) return;
    if (probeMessageId) pending.probeMessageId = probeMessageId;
    this.runSessionEnterFrame(pending.ticket);
  }

  private isProbeReady(stream: HTMLElement, probeMessageId: string): boolean {
    if (!probeMessageId) return true;
    return Boolean(stream.querySelector(`[data-msg-id="${escapeMessageId(probeMessageId)}"]:not(.msg-action-btn)`));
  }

  private runSessionEnterFrame(ticket: number): void {
    const pending = this.pendingSessionEnter;
    if (!pending || pending.ticket !== ticket) return;
    if (this.host.isPromptJumpSettling()) {
      this.pendingSessionEnter = null;
      return;
    }
    const stream = this.host.getStreamElement();
    if (!stream) {
      this.pendingSessionEnter = null;
      return;
    }

    const plan = pending.plan;
    let padding = 0;
    if (typeof getComputedStyle === 'function') {
      padding = parseFloat(getComputedStyle(stream).paddingBottom) || 0;
    }
    const probeReady = this.isProbeReady(stream, pending.probeMessageId);
    let errorPx = Number.POSITIVE_INFINITY;

    if (probeReady) {
      if (plan.type === 'pin-to-bottom') {
        this.scrollStreamToContentBottom(stream, padding);
        errorPx = Math.abs(stream.scrollHeight - stream.scrollTop - stream.clientHeight);
      } else if (plan.type === 'restore-anchor') {
        const target = stream.querySelector<HTMLElement>(`[data-msg-id="${escapeMessageId(plan.anchorMessageId)}"]:not(.msg-action-btn)`);
        const max = Math.max(0, stream.scrollHeight - stream.clientHeight);
        const fallback = Math.max(0, Math.min(plan.fallbackScrollTop, max));
        if (target) {
          const streamTop = stream.getBoundingClientRect().top;
          const rect = target.getBoundingClientRect();
          const delta = rect.top - streamTop + rect.height * plan.anchorOffsetRatio;
          /**
           * 【锚点可信域 (Rules)】`content-visibility: auto` 下，未渲染回合返回的是
           * `contain-intrinsic-size` 占位高度，锚点行坐标可能与真实排版差出上千像素。
           * 偏差超过 0.6 屏即视为估算失真：先退回标量基准，并**继续迭代**而不是就地收敛，
           * 等布局稳定后若 delta 落回可信域再做精确校正；30 帧熔断时停在 fallback。
           */
          if (Math.abs(delta) > stream.clientHeight * 0.6) {
            stream.scrollTop = fallback;
            errorPx = Number.POSITIVE_INFINITY;
          } else {
            if (Math.abs(delta) >= 1) stream.scrollTop += delta;
            errorPx = Math.abs(delta);
          }
        } else {
          stream.scrollTop = fallback;
          errorPx = 0;
        }
      } else {
        const max = Math.max(0, stream.scrollHeight - stream.clientHeight);
        stream.scrollTop = Math.max(0, Math.min(plan.scrollTop, max));
        errorPx = 0;
      }
      this.host.markProgrammaticScroll(stream);
    }

    pending.frames += 1;
    // pin 分支还要求内容高度已稳定：React 提交后离屏回合会继续撑高 scrollHeight，
    // 只看「此刻是否贴底」会在中途误判收敛（实测停在 1017/4858）。
    const heightStable = pending.prevScrollHeight > 0 && Math.abs(stream.scrollHeight - pending.prevScrollHeight) <= 2;
    pending.prevScrollHeight = stream.scrollHeight;
    const stable = probeReady && errorPx <= 2 && (plan.type !== 'pin-to-bottom' || heightStable);
    pending.stableFrames = stable ? pending.stableFrames + 1 : 0;

    if ((pending.stableFrames >= 2 && pending.frames >= 2) || pending.frames >= 30) {
      if (plan.type === 'pin-to-bottom') {
        // 熔断时补一次贴底：30 帧内内容仍在长高时，至少不要停在半空。
        // probe 未就绪说明 React 还没提交，此时补底只会在骨架高度上贴成 0，必须不动。
        if (probeReady) this.scrollStreamToContentBottom(stream, padding);
        this.setInitialBottomSettling(false);
        this.setSettledLayoutSignature(this.host.layoutSignature());
      }
      this.pendingSessionEnter = null;
      return;
    }
    this.runRaf(() => this.runSessionEnterFrame(ticket));
  }

  public applyStreamAnchor(anchor: StreamAnchor, pinBottom: boolean): void {
    if (this.host.isPromptJumpSettling()) return;
    if (this.isInitialBottomSettling()) return;
    const stream = this.host.getStreamElement();
    if (!stream) return;

    const isSessionSwitch = Boolean(anchor.sessionId && anchor.sessionId !== this.host.getActiveSessionId());

    // 【跨会话切换优先遵从状态机记忆】若为切换会话，绝对优先由 sessionScrollMemory 决策；
    // 严禁旧会话的 wasNearBottom 状态污染目标会话的视口恢复
    if (isSessionSwitch) {
      const currentSessionId = this.host.getActiveSessionId();
      const plan = this.sessionScrollMemory.planSessionEnter(currentSessionId);
      const paddingBottom = typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(stream).paddingBottom) || 0 : 0;

      if (plan.type === 'pin-to-bottom') {
        this.scrollStreamToContentBottom(stream, paddingBottom);
        this.host.markProgrammaticScroll(stream);
        this.host.logTrace?.('session switched: pinned to bottom', { session: currentSessionId, reason: plan.reason });
        return;
      }

      if (plan.type === 'restore-anchor') {
        const target = stream.querySelector<HTMLElement>(`[data-msg-id="${escapeMessageId(plan.anchorMessageId)}"]:not(.msg-action-btn)`);
        if (target) {
          const streamTop = stream.getBoundingClientRect().top;
          const targetTop = target.getBoundingClientRect().top;
          const targetHeight = target.getBoundingClientRect().height;
          const delta = targetTop - streamTop + (targetHeight * plan.anchorOffsetRatio);
          if (Math.abs(delta) >= 1) {
            stream.scrollTop += delta;
            this.host.markProgrammaticScroll(stream);
          }
          this.host.logTrace?.('session switched: anchor restored', { id: plan.anchorMessageId });
          return;
        }
        stream.scrollTop = plan.fallbackScrollTop;
        this.host.markProgrammaticScroll(stream);
        return;
      }

      if (plan.type === 'restore-scroll-top') {
        stream.scrollTop = plan.scrollTop;
        this.host.markProgrammaticScroll(stream);
        return;
      }
    }

    if (pinBottom) {
      const paddingBottom = typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(stream).paddingBottom) || 0 : 0;
      this.scrollStreamToContentBottom(stream, paddingBottom);
      this.host.logTrace?.('pinned after render', { session: this.host.getActiveSessionId() });
      return;
    }

    if (anchor.id) {
      const target = stream.querySelector<HTMLElement>(`[data-msg-id="${escapeMessageId(anchor.id)}"]:not(.msg-action-btn)`);
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
    if (this.isInitialBottomSettling()) return;
    if (!anchor.id) return;
    const stream = this.host.getStreamElement();
    if (!stream) return;

    const target = stream.querySelector<HTMLElement>(`[data-msg-id="${escapeMessageId(anchor.id)}"]:not(.msg-action-btn)`);
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
