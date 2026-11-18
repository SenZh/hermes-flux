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
 * 回合容器选择器。
 * 【设计意图 (Why)】`.conv-turn` 是 `content-visibility: auto` 与
 *   `contain-intrinsic-size` 的承载者（conversation.css:136-142），
 *   因此「离屏占位高度」的样本必须取自它，而不是消息行。
 * 【约束与规则 (Rules)】凡为 `--conv-intrinsic-median-height` 采集样本处，
 *   一律使用本常量；消息行选择器只用于锚点定位与行高统计。
 */
export const TURN_SELECTOR = '.conv-turn';

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
 * 会话进入计划的 pin 意图（供宿主与单测观测）。
 * 【约束与规则 (Rules)】'none' 表示当前没有挂起的进入计划，其余取值与 ScrollRestoreStrategy 同名。
 */
export type PinIntent = 'none' | 'pin-to-bottom' | 'restore-anchor' | 'restore-scroll-top';

/** 末行底边与安全线的判定容差（px）。 */
const SESSION_ENTER_ALIGN_TOLERANCE_PX = 2;
/** 对齐连续稳定帧数：单帧贴合可能是占位高度的假象。 */
const SESSION_ENTER_ALIGNED_STABLE_FRAMES = 2;
/** 内容高度连续稳定帧数：Blink 逐帧展开真实高度及首屏字体/布局落定期间严禁提前收口。 */
const SESSION_ENTER_HEIGHT_STABLE_FRAMES = 5;
/** 等 React 提交期间的帧轮询上限：超过后交给 MutationObserver 驱动，避免空转占满合成器。 */
const SESSION_ENTER_WAIT_FRAME_LIMIT = 90;
/** pin 计划的硬上限兜底帧数：防止永久 armed 把滚动记忆永久冻结。 */
const SESSION_ENTER_HARD_CAP_FRAMES = 600;
/** 回溯类计划（restore-anchor / restore-scroll-top）的熔断帧数，语义与旧实现保持一致。 */
const RESTORE_PLAN_HARD_CAP_FRAMES = 30;
/** 锚点行尚未被真实布局时允许等待的宽限帧数：超过后接受当前几何，避免被推向会话末尾。 */
const SESSION_ENTER_LAYOUT_GRACE_FRAMES = 8;

/** 一次「会话进入」的挂起计划（内部状态，不对外暴露）。 */
interface SessionEnterPlan {
  ticket: number;
  sessionId: string;
  plan: ScrollRestoreStrategy;
  probeMessageId: string;
  /** 最近一次推进时宿主上报的生命周期相位；'loading' 期间禁止收口。 */
  phase: string;
  /** 最近一次推进时宿主上报的权威消息数；>0 才允许「探针缺失」降级贴底。 */
  messagesCount?: number;
  /**
   * 权威完成信号：宿主明确声明「REST 权威页已到 / 已判定」。
   *
   * 【设计意图 (Why)】`messagesPhase === 'ready'` 在真实链路里曾同时表示两种完全不同的语义：
   *   ①「权威页已到」（可以收口）；②「内存缓存批次已上屏、REST 还在路上」（绝不能收口）。
   *   旧实现按 ② 收口，导致缓存批次被当终态，REST 到达后视口停在旧位置（实测 1400 而非 4200）。
   * 【约束与规则 (Rules)】缺省（undefined）视为「宿主未声明」：只有 phase 为 'ready' 才放行，
   *   显式 false 则一律不放行。这样旧调用方（不传该参数）仍保持既有语义，不会误杀。
   */
  authoritativeReady?: boolean;
}

/**
 * 会话进入计划。
 * 【设计意图 (Why)】跨会话「进去之后视口在哪」必须是一次显式、可收敛的裁决，
 *   不能再依赖「旧会话 DOM 的 wasNearBottom」或浏览器对旧 scrollTop 的继承：
 *   前者会把上一会话的贴底态串台，后者会留下 350px 这类继承值。
 * 【约束与规则 (Rules)】
 *   1. `probeMessageId` 是「React 已把目标会话提交进 DOM」的判据；未就绪时不写视口、不计数收敛；
 *   2. 严禁用「DOM 高度 scrollHeight <= clientHeight」推断短会话：权威消息数 > 0 时那只是尚未提交；
 *   3. pin 的收敛是「armed 意图 + 终态判据」：末行对齐连续稳定 + 内容高度连续稳定 + 权威完成信号
 *      + 自 armed 起确实观测到高度变化（或到达硬上限兜底），绝不按单条几何误差提前收口；
 *      权威完成信号由宿主的 `messagesPhase` 与显式 `authoritativeReady` 共同表达；
 *   4. 任何用户手势或导航跳转都能立即取消（见 cancelSessionEnter）。
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
  private pendingSessionEnter: SessionEnterPlan | null = null;
  private sessionEnterTicket = 0;

  /**
   * 【armed 意图状态机 (Rules)】这些计数只在「一次会话进入」的生命周期内有效：
   *   beginSessionEnter 全量重置、cancelSessionEnter 全量清除，
   *   保证 reassertActivePin() 在取消后是纯 no-op，也保证新旧计划绝不串台。
   */
  private armedFrames = 0;
  private loadingWaitFrames = 0;
  private readyFrames = 0;
  private alignedStableFrames = 0;
  private scrollHeightStableFrames = 0;
  private armedHeightChangedSinceArm = false;
  private lastSeenScrollHeight = 0;
  private probeMissingLogged = false;

  /**
   * 【单链推进闸门 (Why)】`runSessionEnterFrame` 未收敛时会自排下一帧，而宿主
   *   （renderCoordinator 的 MutationObserver / ResizeObserver）每帧还会调用
   *   `reassertActivePin()`。旧实现每次 reassert 都同步推进并各自再排一条 rAF 链，
   *   于是同一 ticket 上并行出 N 条链，`armedFrames` 每帧被递增 N 次，
   *   600 帧硬上限被 N 倍速提前耗尽 → 内容真正稳定前就被兜底截断。
   * 【约束与规则 (Rules)】
   *   1. `pinFrameInFlight` 是唯一在途闸门：同一 ticket 任意时刻最多一条排队推进帧，
   *      因此「每动画帧最多一次配额递增」由「每帧最多一个排队帧」结构性保证；
   *   2. 只有排队帧（advance 模式）消耗帧配额并裁决收敛；同步入口（settle / reassert）
   *      只做几何对齐，保住「提交后立刻对齐」语义，但不计数、不叠链；
   *   3. `pinFrameSerial` 让取消/重建计划后残留的旧回调静默作废，
   *      绝不把推进权带进新计划。
   */
  private pinFrameInFlight = false;
  private pinFrameSerial = 0;

  private readonly sessionScrollMemory = new SessionScrollMemory();
  private readonly medianEstimator = new AdaptiveMedianEstimator();
  /**
   * 【回合采样去重表 (Why)】每次非进入期 render() 都会调用 captureStreamAnchor()，
   *   若重复采样同一批已落定 `.conv-turn`，中位数会被当前视口内的短/长回合反复刷权而漂移，
   *   引发 `--conv-intrinsic-median-height` 震荡与离屏占位高度跳变。
   * 【约束与规则 (Rules)】按 `${sessionId}:${turnId}` 去重并设 2000 条 FIFO 上限防内存无限增长；
   *   无 `data-conv-turn` 属性的测试桩退化为 WeakSet 去重。
   */
  private static readonly MAX_SAMPLED_TURN_KEYS = 2000;
  private readonly sampledTurnKeys = new Set<string>();
  private readonly sampledTurnElements = new WeakSet<HTMLElement>();
  private lastAppliedIntrinsicValue = '';
  private lastAppliedIntrinsicStream: HTMLElement | null = null;

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

  /**
   * 回合采样去重表的当前键数量（诊断用）。
   *
   * 【设计意图 (Why)】去重表上限 2000 是「长会话不无限吃内存」的唯一实现，但集合大小
   *   无法从外部观测；仅靠中位数断言在样本窗口已满时是恒真的，淘汰逻辑删掉也测不出来。
   *   暴露只读计数后，可用 `2001 → 2000` 的支配性差值钉死淘汰分支。
   */
  public getSampledTurnKeyCount(): number {
    return this.sampledTurnKeys.size;
  }

  /** 指定去重键是否仍在表内（诊断用，用于断言 FIFO 淘汰的是最老键而非最新键）。 */
  public hasSampledTurnKey(key: string): boolean {
    return this.sampledTurnKeys.has(key);
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
   *
   * 【内容未提交时必须是 no-op (Why)】切回长会话的第一帧，React 尚未提交消息行，
   *   容器还是空的（`scrollHeight === clientHeight`）。此时 `scrollTop = scrollHeight`
   *   会被浏览器夹到 0，而后续内容提交时 `content-visibility: auto` 只展开视口附近的行，
   *   文档高度远小于真实值，视口就永久停在会话顶部（实测 scrollTop=0、
   *   scrollHeight 从 83994 塌到 36338，用户看到的就是"飞在中间"）。
   *   正确语义：没有可滚动余量时不写视口、不登记程序化滚动，
   *   等真实内容提交后由 `reassertActivePin` / `settleInitialBottom` 重新对齐。
   *
   * 【约束与规则 (Rules)】只有 `scrollHeight > clientHeight` 才允许写 `scrollTop`；
   *   这条守卫对「内容确实不足一屏」与「内容尚未提交」一视同仁——两者都不需要滚动。
   */
  public scrollStreamToContentBottom(stream: HTMLElement, reservePx: number): void {
    if (stream.scrollHeight <= stream.clientHeight) return;

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
          if (!this.isSessionEnterPending()) {
            this.setInitialBottomSettling(true);
            this.settleInitialBottom();
          }
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

  private recordSampledTurnKey(key: string): void {
    if (this.sampledTurnKeys.size >= StreamViewportManager.MAX_SAMPLED_TURN_KEYS) {
      const oldest = this.sampledTurnKeys.values().next().value;
      if (typeof oldest === 'string') {
        this.sampledTurnKeys.delete(oldest);
      }
    }
    this.sampledTurnKeys.add(key);
  }

  /**
   * 采样视口内「回合」的真实高度，写入 `.conv-turn` 占位高度变量。
   *
   * 【设计意图 (Why)】`--conv-intrinsic-median-height` 唯一消费方是 `.conv-turn` 的
   *   `contain-intrinsic-size`，所以样本必须来自回合容器本身。用一个回合的实测高度去
   *   估算另一个未渲染回合的高度，量纲才一致；拿消息行高去估回合，会把离屏回合压到
   *   真实值的 1/3（实测 241px → 80px），文档总高塌到 46%，切回视口只能落在
   *   "占位底部"——即用户报告的"飞在中间、很靠上"。
   *
   * 【防范的历史坑 (Pitfall)】
   *   1. 反复采样同一批已落定回合会让当前视口内局部回合反复刷权，导致中位数在每次
   *      `messagesChanged=false` 渲染时漂移并撑大 `scrollHeight`；
   *   2. 采样仍在流式增长的回合（`data-conv-streaming="true"`）会把未成形的中间高度写进中位数，
   *      并在流式途中拉高文档高度冲毁 `isNearBottom`。
   *
   * 【约束与规则 (Rules)】
   *   1. 跳过正在流式的回合（待其落定后再一次性采样）；
   *   2. 每个已落定回合每会话仅采样一次（仅在通过所有布局与自锁守卫后记入去重表）；
   *   3. 样本数 > 0 才写变量，绝不用 0 覆盖 CSS 兜底；
   *   4. 单测桩缺失 `getAttribute` 时退化为 WeakSet 去重。
   */
  private sampleTurnIntrinsicHeight(stream: HTMLElement, activeSessionId: string): void {
    /**
     * 【判据：全列表 + 自锁打断 (Why)】
     *   1. 不能用几何特征识别占位替身——实测 160/160 个回合（含被 `content-visibility`
     *      跳过的）都返回非零几何，任何几何判据都是恒真式；
     *   2. 也不能只采视口窗口——窗口内可能全是占位替身，样本数归零，变量永远停在兜底值
     *      （实测窗口判据下变量始终 140px）；
     *   3. 唯一可靠的识别是**值本身**：占位替身的高度恒等于当前注入的 CSS 变量值。
     *      因此全列表扫描 + 跳过「高度 ≈ 当前值」的样本。真实渲染过的回合（视口附近、
     *      以及 `contain-intrinsic-size: auto` 记住的历史高度）与当前值不等，会正常进入样本。
     */
    const current = this.readIntrinsicHeightVariable(stream);

    const turns = stream.querySelectorAll<HTMLElement>(TURN_SELECTOR);
    for (let i = 0; i < turns.length; i += 1) {
      const turn = turns[i];
      // 流式增长中的回合尚未定型，跳过采样直到其落定
      const isStreaming =
        typeof turn.getAttribute === 'function' && turn.getAttribute('data-conv-streaming') === 'true';
      if (isStreaming) continue;

      const turnId = typeof turn.getAttribute === 'function' ? (turn.getAttribute('data-conv-turn') || '') : '';
      const dedupKey = turnId ? `${activeSessionId}:${turnId}` : '';
      if (dedupKey ? this.sampledTurnKeys.has(dedupKey) : this.sampledTurnElements.has(turn)) {
        continue;
      }

      // 【只采真实已布局回合 (Rules)】优先使用 checkVisibility 过滤掉 content-visibility: auto 跳过的离屏占位回合；
      //   若环境缺失 checkVisibility，则退化为下面的「高度 ≈ 当前注入值」自锁打断。
      if (!this.isAnchorLaidOut(turn)) continue;
      const rect = turn.getBoundingClientRect();
      if (rect.height <= 0) continue;
      // 自锁打断：占位替身的高度恒等于当前注入值，绝不能当样本
      if (current !== null && Math.abs(rect.height - current) < 0.5) continue;

      this.medianEstimator.addSample(rect.height);
      if (dedupKey) {
        this.recordSampledTurnKey(dedupKey);
      } else {
        this.sampledTurnElements.add(turn);
      }
    }
  }

  /**
   * 读取当前生效的回合占位高度（px）。
   * 【约束与规则 (Rules)】`getComputedStyle` 缺失或值不可解析时返回 null，
   *   此时自锁打断退化为「不判」，采样仍受视口窗口约束。
   */
  private readIntrinsicHeightVariable(stream: HTMLElement): number | null {
    if (typeof getComputedStyle !== 'function') return null;
    const raw = getComputedStyle(stream).getPropertyValue('--conv-intrinsic-median-height');
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  /**
   * 把当前估算的回合占位高度写进 CSS 变量，并对因离屏占位高度变化引起的 scrollHeight 跳变做视口中性补偿。
   *
   * 【必须同时写根节点 (Why)】切会话时 React 会重建消息列表宿主，
   *   `#conversation-stream` 是一个**新元素**，其 inline style 随旧元素一起销毁，
   *   变量立刻回落到 CSS 兜底 140px。而真实平均回合高实测 241px，于是切回后
   *   离屏回合的占位高度只剩真实值的 58%，整篇文档 `scrollHeight` 从 32460 塌到 29632，
   *   同一个 `scrollTop` 指向了完全不同的内容——用户看到的就是"位置不对、飞在中间"。
   *   根节点不会被重建，写在那里可以跨会话切换存活；stream 自身仍写一份，
   *   保证既有单测与「变量就近可读」的语义不变。
   *
   * 【防范的历史坑 (Pitfall)】
   *   1. 流式结束或流式途中写入新 `--conv-intrinsic-median-height` 会同步改变离屏 `.conv-turn` 高度，
   *      若只涨 `scrollHeight` 不补 `scrollTop`（dSh > 0, dSt = 0），视口会被瞬间顶离底部安全区；
   *   2. 当新中位数变小导致 `scrollHeight` 收缩（dSh < 0）时，Blink 会自动向下夹紧 `scrollTop`，
   *      若不登记 `markProgrammaticScroll`，滚动控制器会把浏览器夹紧误判为用户主动上滚。
   *
   * 【约束与规则 (Rules)】
   *   1. 样本数 > 0 才写，绝不用 0 或兜底值覆盖；值未变化时跳过写入实现零布局开销；
   *   2. 仅当 `nextScrollHeight > clientHeight` 才允许写 `scrollTop`；
   *   3. 贴底态保持原距离 `prevDist` 不变；非贴底态按 `anchorRow` 偏移量做中性补偿；
   *   4. 凡最终 `stream.scrollTop !== prevScrollTop`（含浏览器负向夹紧）必须调用 `markProgrammaticScroll`；
   *   5. 目标元素缺 `setProperty` / `getPropertyValue` 时安全跳过或退化到实例缓存比较。
   */
  private applyIntrinsicHeightVariable(
    stream: HTMLElement,
    context: {
      wasNearBottom: boolean;
      prevScrollHeight: number;
      prevScrollTop: number;
      prevDist: number;
      anchorRow: HTMLElement | null;
      anchorOffset: number;
    }
  ): void {
    if (this.medianEstimator.sampleCount === 0) return;
    const value = `${this.medianEstimator.getMedian()}px`;

    const hasStreamGetter = typeof stream.style?.getPropertyValue === 'function';
    const needsStreamWrite =
      typeof stream.style?.setProperty === 'function' &&
      (hasStreamGetter
        ? stream.style.getPropertyValue('--conv-intrinsic-median-height') !== value
        : this.lastAppliedIntrinsicStream !== stream || this.lastAppliedIntrinsicValue !== value);

    const rootStyle = typeof document !== 'undefined' ? document.documentElement?.style : undefined;
    const hasRootGetter = typeof rootStyle?.getPropertyValue === 'function';
    const needsRootWrite =
      typeof rootStyle?.setProperty === 'function' &&
      (hasRootGetter
        ? rootStyle.getPropertyValue('--conv-intrinsic-median-height') !== value
        : this.lastAppliedIntrinsicValue !== value);

    if (!needsStreamWrite && !needsRootWrite) return;

    if (needsStreamWrite) {
      stream.style.setProperty('--conv-intrinsic-median-height', value);
    }
    if (needsRootWrite && rootStyle) {
      rootStyle.setProperty('--conv-intrinsic-median-height', value);
    }
    this.lastAppliedIntrinsicValue = value;
    this.lastAppliedIntrinsicStream = stream;

    const nextScrollHeight = stream.scrollHeight;
    if (nextScrollHeight === context.prevScrollHeight) return;

    // 【跳转落定期只写变量、不动视口 (Why)】提示词跳转的落定计划由 runSessionEnterFrame 独占视口，
    //   此处再写 scrollTop 会与它的多帧收敛互相拉扯；变量本身必须照写，否则离屏回合占位高度失真。
    //   仍未变化的 scrollTop 由下方统一登记，避免浏览器负向夹紧被误判成用户上滚。
    if (nextScrollHeight > stream.clientHeight && !this.host.isPromptJumpSettling()) {
      if (context.wasNearBottom) {
        const targetTop = Math.max(0, nextScrollHeight - stream.clientHeight - context.prevDist);
        if (Math.abs(stream.scrollTop - targetTop) >= 1) {
          stream.scrollTop = targetTop;
        }
      } else if (context.anchorRow) {
        const nextOffset = context.anchorRow.getBoundingClientRect().top - stream.getBoundingClientRect().top;
        const delta = nextOffset - context.anchorOffset;
        if (Math.abs(delta) >= 1) {
          stream.scrollTop += delta;
        }
      }
    }

    if (stream.scrollTop !== context.prevScrollTop) {
      this.host.markProgrammaticScroll(stream);
    }
  }

  /**
   * 判定锚点元素是否已真实布局（而非 `content-visibility: auto` 的占位替身）。
   *
   * 【判据为什么只能用 checkVisibility (Why)】占位替身的几何与真实布局同为非零
   *   （实测 160/160 个回合都返回非零几何），因此任何基于 `getBoundingClientRect()`
   *   的判据都是恒真式。`checkVisibility({ contentVisibilityAuto: true })` 是唯一
   *   能区分「被 content-visibility 跳过」的标准 API。
   *
   * 【约束与规则 (Rules)】API 缺失（旧内核 / 单测）时退化为 true，
   *   保持旧调用方语义不变；同时用于锚点收敛与真实回合采样。
   */
  private isAnchorLaidOut(target: HTMLElement): boolean {
    const probe = target as HTMLElement & {
      checkVisibility?: (options?: { contentVisibilityAuto?: boolean }) => boolean;
    };
    if (typeof probe.checkVisibility !== 'function') return true;
    return probe.checkVisibility({ contentVisibilityAuto: true });
  }

  /**
   * 读取贴底安全线（输入舱遮挡的那段 gutter）实测像素。
   *
   * 【设计意图 (Why)】`isNearBottom` 与 `scrollStreamToContentBottom` 都以它为基准，
   *   跨会话记忆的贴底判定必须同源，否则同一屏会同时被判成「贴底」和「回溯」。
   *
   * 【约束与规则 (Rules)】`getComputedStyle` 缺失或解析失败时回落 0，
   *   让记忆状态机退回 48px 既有语义（旧内核与单测环境不因此改变行为）。
   */
  private readBottomReservePx(stream: HTMLElement): number {
    if (typeof getComputedStyle !== 'function') return 0;
    const parsed = parseFloat(getComputedStyle(stream).paddingBottom);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  /**
   * 捕获当前视口第一条可见消息的相对偏移作为锚点。
   *
   * 【占位高度必须按「回合」采样 (Why)】`--conv-intrinsic-median-height` 的消费方是
   *   `.conv-turn`（回合容器）的 `contain-intrinsic-size`，而锚点扫描的是
   *   `[data-msg-id]`（消息行）。一个回合通常含提问 + 工具 + 终答 3 行，实测真实平均
   *   回合高 241px、平均行高 158px。若把行高当回合高注入，离屏回合占位只有真实值的
   *   1/3，整篇文档 `scrollHeight` 被压到真实的 46%，切回时浏览器只能把视口夹在
   *   "占位高度"的底部 —— 用户看到的就是"飞在中间、很靠上"。
   */
  public captureStreamAnchor(): StreamAnchor {
    const activeSessionId = this.host.getActiveSessionId();
    const stream = this.host.getStreamElement();
    if (!stream) return { sessionId: activeSessionId, id: null, offset: 0, rawScrollTop: 0 };
    const streamRect = stream.getBoundingClientRect();
    const streamTop = streamRect.top;
    const rows = stream.querySelectorAll<HTMLElement>(MESSAGE_ROW_SELECTOR);
    let anchorId: string | null = null;
    let anchorRow: HTMLElement | null = null;
    let anchorOffset = 0;
    let anchorOffsetRatio = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rect = row.getBoundingClientRect();
      if (anchorId === null && rect.bottom > streamTop) {
        anchorId = row.getAttribute('data-msg-id');
        anchorRow = row;
        anchorOffset = rect.top - streamTop;
        anchorOffsetRatio = rect.height > 0 ? Math.max(0, Math.min(1, (streamTop - rect.top) / rect.height)) : 0;
      }
    }

    const capturedScrollTop = stream.scrollTop;
    const capturedScrollHeight = stream.scrollHeight;
    const capturedClientHeight = stream.clientHeight;
    const capturedReservePx = this.readBottomReservePx(stream);
    const prevDist = capturedScrollHeight - capturedScrollTop - capturedClientHeight;
    const wasNearBottom = prevDist <= Math.max(STICK_TO_BOTTOM_THRESHOLD_PX, capturedReservePx + 8);

    if (activeSessionId) {
      this.sessionScrollMemory.recordSnapshot({
        sessionId: activeSessionId,
        scrollTop: capturedScrollTop,
        scrollHeight: capturedScrollHeight,
        clientHeight: capturedClientHeight,
        anchorMessageId: anchorId || undefined,
        anchorOffsetRatio,
        /**
         * 【贴底判据必须与贴底落点同源 (Rules)】贴底由 `scrollStreamToContentBottom` 按
         *   输入舱安全线对齐，几何距离恒等于 `paddingBottom`（实测 160px）。把实测值一并
         *   交给记忆状态机，才能让「用户就在最底部」被判成贴底而不是回溯态；否则切回时
         *   按陈旧锚点恢复，长会话表现为飞到中间。
         */
        nearBottomReservePx: capturedReservePx,
      });
    }

    // 【先读快照再写 CSS 变量 (Pitfall)】修改 --conv-intrinsic-median-height 会立即改变离屏占位高度，
    //   绝不能在 recordSnapshot 之前写入，否则刚读到的 scrollHeight 会被新变量撑大而误判为非贴底；
    //   写入后立刻按 prevDist / anchorRow 做视口中性补偿，并回传补偿后的 rawScrollTop。
    this.sampleTurnIntrinsicHeight(stream, activeSessionId);
    this.applyIntrinsicHeightVariable(stream, {
      wasNearBottom,
      prevScrollHeight: capturedScrollHeight,
      prevScrollTop: capturedScrollTop,
      prevDist,
      anchorRow,
      anchorOffset,
    });

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
  public beginSessionEnter(
    sessionId: string,
    options: { forcePinToBottom?: boolean; phase?: string } = {}
  ): void {
    if (!sessionId) {
      this.clearSessionEnter();
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
      phase: options.phase ?? 'ready',
    };
    this.resetArmedState();
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

  /** 当前 armed 的 pin 意图，'none' 表示没有挂起的进入计划。 */
  public getPinIntent(): PinIntent {
    const pending = this.pendingSessionEnter;
    return pending ? pending.plan.type : 'none';
  }

  public cancelSessionEnter(): void {
    this.clearSessionEnter();
  }

  /**
   * React 提交后的贴底驱动入口：无参、幂等。
   *
   * 【设计意图 (Why)】首屏内容由 React 异步提交，提交时刻既可能早于也可能晚于
   *   `settleSessionEnter` 的推进帧。若只靠渲染流程里的单次推进，提交晚于那一帧时
   *   视口就永远停在半空（实测差 7958px）。宿主通过 MutationObserver / ResizeObserver
   *   在提交后调用本方法，armed 计划会立刻重新对齐一次。
   *
   * 【约束与规则 (Rules)】
   *   1. 无 armed 计划（含 `cancelSessionEnter()` 之后）必须纯 no-op，绝不写 scrollTop；
   *   2. 同步执行一次**几何对齐**（sync 模式：不消耗帧配额、不裁决收敛），
   *      不重置 `armedHeightChangedSinceArm`（否则「内容确实长高过」的事实被抹掉）；
   *   3. 幂等：无漂移时重复调用不得改变位置；
   *   4. **绝不叠帧**：在途闸门 `pinFrameInFlight` 保证同一 ticket 任意时刻只有一条
   *      排队推进帧；重复调用只做同步对齐，不会并行出 N 条 rAF 链把 600 帧上限烧穿。
   */
  public reassertActivePin(): void {
    const pending = this.pendingSessionEnter;
    if (!pending) return;
    this.runSessionEnterFrame(pending.ticket, 'sync');
  }

  /**
   * 把下一帧推进排队（单链闸门）。
   * 【约束与规则 (Rules)】
   *   1. 同一 ticket 已有在途帧时直接返回，绝不叠链；
   *   2. 帧回调按 `pinFrameSerial` 作废旧计划残留：取消或重建计划后，迟到回调是纯 no-op，
   *      不写位置、不消耗配额、不把推进权带进新计划；
   *   3. 回调先释放闸门再推进，保证推进过程中新排的帧仍被同一闸门约束。
   */
  private schedulePinFrame(ticket: number): void {
    if (this.pinFrameInFlight) return;
    this.pinFrameInFlight = true;
    const serial = this.pinFrameSerial;
    this.runRaf(() => {
      if (serial !== this.pinFrameSerial) return;
      this.pinFrameInFlight = false;
      this.runSessionEnterFrame(ticket, 'advance');
    });
  }

  private resetArmedState(): void {
    this.armedFrames = 0;
    this.loadingWaitFrames = 0;
    this.readyFrames = 0;
    this.alignedStableFrames = 0;
    this.scrollHeightStableFrames = 0;
    this.armedHeightChangedSinceArm = false;
    this.lastSeenScrollHeight = 0;
    this.probeMissingLogged = false;
    // 【在途帧闸门必须同生命周期 (Rules)】armed 计数归零的同时必须作废在途帧：
    //   serial 递增后旧回调静默退出，绝不会把旧计划的推进权带进新计划。
    this.pinFrameInFlight = false;
    this.pinFrameSerial += 1;
  }

  private clearSessionEnter(): void {
    this.pendingSessionEnter = null;
    this.resetArmedState();
    const stream = this.host.getStreamElement();
    if (stream && typeof stream.style?.removeProperty === 'function') {
      stream.style.removeProperty('overflow-anchor');
    }
  }

  /**
   * 权威源短路：会话确实为空（消息数 0 且相位 ready）。
   * 【规则】只认权威消息数，绝不拿 DOM 高度推断；空会话必须夹紧在顶部并立即释放计划。
   */
  private completeEmptySession(): void {
    const stream = this.host.getStreamElement();
    if (stream) {
      stream.scrollTop = 0;
      this.host.markProgrammaticScroll(stream);
    }
    this.setInitialBottomSettling(false);
    this.setSettledLayoutSignature(this.host.layoutSignature());
    this.clearSessionEnter();
  }

  /**
   * 推进进入计划。
   * 【规则】
   *   1. 保持第一参数为 probeMessageId，完美兼容单测与旧装配契约；
   *   2. 跨会话防污染：校验可选的 sessionId，丢弃过期会话的延迟调用；
   *   3. 生命周期协同：loading 且 0 消息时冻结挂起（不消耗帧）；
   *   4. 真实空会话（ready 且 0 消息）走权威源短路，禁止状态机死锁挂起；
   *   5. 相位从 loading 切到 ready 时重置高度基线（见 resetHeightBaselineOnAuthoritativeReady）。
   */
  public settleSessionEnter(
    probeMessageId?: string,
    sessionId?: string,
    phase?: string,
    messagesCount?: number,
    authoritativeReady?: boolean
  ): void {
    const pending = this.pendingSessionEnter;
    if (!pending) return;

    // 跨会话防污染：校验可选的 sessionId，若与当前挂起计划不匹配则直接丢弃
    if (sessionId && sessionId !== pending.sessionId) {
      return;
    }

    const currentPhase = phase || 'ready';
    const previousPhase = pending.phase;
    pending.phase = currentPhase;
    if (typeof messagesCount === 'number') pending.messagesCount = messagesCount;
    if (typeof authoritativeReady === 'boolean') pending.authoritativeReady = authoritativeReady;

    /**
     * 【相位切换必须重置高度基线 (Rules)】
     *   loading 期间的内容高度是缓存批次的中间态，不构成终态判据（见 trackPinStability）。
     *   若基线停留在 loading 期间的高度，切 ready 后高度没变 → `armedHeightChangedSinceArm`
     *   永假 → 只能等 600 帧硬上限（约 10 秒），期间流式输出完全不跟随。
     *   因此相位首次进入 ready 时必须重置基线，让「ready 之后的第一帧高度」成为可信对比起点。
     *   `armedFrames` 刻意不清零：否则反复 settle 就能无限续命，绕过硬上限兜底。
     */
    if (previousPhase !== currentPhase && currentPhase === 'ready') {
      this.resetHeightBaselineOnAuthoritativeReady();
    }

    if (messagesCount === 0) {
      if (currentPhase === 'loading') return;
      this.completeEmptySession();
      return;
    }

    if (probeMessageId) pending.probeMessageId = probeMessageId;
    this.runSessionEnterFrame(pending.ticket, 'sync');
  }

  /**
   * 相位进入 ready 时重置高度基线。
   * 【约束与规则 (Rules)】只重置与「高度对比」相关的计数，绝不清零 `armedFrames`：
   *   后者是硬上限兜底的唯一依据，被清零就等于给了无限续命的通道。
   */
  private resetHeightBaselineOnAuthoritativeReady(): void {
    this.armedHeightChangedSinceArm = false;
    this.lastSeenScrollHeight = 0;
    this.scrollHeightStableFrames = 0;
    this.alignedStableFrames = 0;
    this.readyFrames = 0;
  }

  /**
   * 执行一帧 pin 对齐推进。
   *
   * 【两种模式 (Why)】
   *   - `advance`：唯一会消耗帧配额（`armedFrames` 与稳定性计数）、唯一有权裁决收敛的模式；
   *     它只由 `schedulePinFrame` 排出的排队帧触发，而排队帧受单链闸门约束，
   *     因此「armedFrames 每动画帧最多递增一次」由结构直接保证。
   *   - `sync`：宿主提交后的同步入口（`settleSessionEnter` / `reassertActivePin`）。
   *     它必须保住「提交后立刻对齐」的语义（否则首屏停在半空差 7958px），
   *     但不计数、不裁决收敛、不额外叠帧，因此不会把 600 帧上限烧穿。
   * 【规则】返回 true 表示本帧已收敛并释放计划，调用方不得再排下一帧。
   */
  private runPinFrame(
    stream: HTMLElement,
    pending: SessionEnterPlan,
    ticket: number,
    advance: boolean
  ): boolean {
    const padding = typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(stream).paddingBottom) || 0 : 0;
    const maxScroll = Math.max(0, stream.scrollHeight - stream.clientHeight);
    const probeId = pending.probeMessageId;
    const lastRow = probeId
      ? stream.querySelector<HTMLElement>(`[data-msg-id="${escapeMessageId(probeId)}"]:not(.msg-action-btn)`)
      : null;

    /**
     * 【React 尚未提交 (Rules)】指定了探针却查不到行，且没有权威消息数佐证内容已存在
     * （或容器高度还没撑出视口）时：只保持 armed，绝不写视口、不写已落定签名。
     * 帧轮询有上限，超过后由宿主提交后的 `reassertActivePin()` 继续驱动。
     */
    const authoritativeCount = pending.messagesCount ?? 0;
    if (probeId && !lastRow && (authoritativeCount === 0 || stream.scrollHeight <= stream.clientHeight)) {
      if (advance) {
        this.armedFrames += 1;
        if (this.armedFrames < SESSION_ENTER_WAIT_FRAME_LIMIT) this.schedulePinFrame(ticket);
      } else {
        // 同步帧不计数，但必须保证推进链存在，否则计划在途却无人推进。
        this.schedulePinFrame(ticket);
      }
      return false;
    }

    // 【防顶沿锚定下推 (Why)】pin-to-bottom armed 期间临时关闭 overflow-anchor，
    //   防止 Blink 选中视口顶沿回合为锚点、将新解锁的底部回合向下推离视口；
    //   计划结束或取消时在 clearSessionEnter 中成对 removeProperty 恢复。
    if (stream.style && stream.style.overflowAnchor !== 'none') {
      stream.style.overflowAnchor = 'none';
    }

    // 贴底地基：pin 意图绝不向上回退，先把视口压到当前可滚动底部。
    if (Math.abs(stream.scrollTop - maxScroll) > SESSION_ENTER_ALIGN_TOLERANCE_PX) {
      stream.scrollTop = maxScroll;
      this.host.markProgrammaticScroll(stream);
    }

    const safeBottom = stream.getBoundingClientRect().bottom - padding;
    let aligned: boolean;
    if (lastRow && typeof lastRow.getBoundingClientRect === 'function') {
      const delta = Math.round(lastRow.getBoundingClientRect().bottom - safeBottom);
      if (delta > SESSION_ENTER_ALIGN_TOLERANCE_PX) {
        // 末行仍被安全线截断：向下补齐，但受可滚动底部夹紧，绝不反向搬移
        const nextTop = Math.min(maxScroll, stream.scrollTop + delta);
        if (Math.abs(nextTop - stream.scrollTop) > SESSION_ENTER_ALIGN_TOLERANCE_PX) {
          stream.scrollTop = nextTop;
          this.host.markProgrammaticScroll(stream);
        }
      }
      const deltaAfter = Math.round(lastRow.getBoundingClientRect().bottom - safeBottom);
      /**
       * 【终态判据的几何部分 (Rules)】同时要求两项：
       *   1. 视口已在绝对底部（scrollTop === maxScroll，容差 2px）；
       *   2. 末行底边不在安全线下方（deltaAfter <= 2）：落在安全线上方属于「内容不足一屏」，
       *      此时再向上搬移只会破坏贴底，故不要求精确贴合。
       */
      const lastRowLaidOut = this.isAnchorLaidOut(lastRow) || this.readyFrames >= SESSION_ENTER_LAYOUT_GRACE_FRAMES;
      aligned = lastRowLaidOut
        && Math.abs(stream.scrollTop - maxScroll) <= SESSION_ENTER_ALIGN_TOLERANCE_PX
        && deltaAfter <= SESSION_ENTER_ALIGN_TOLERANCE_PX;
    } else {
      /**
       * 【降级贴底必须留痕 (Rules)】探针行缺失（displayKind === 'hidden' / 空行 / 已提交但无该行）时，
       * 唯一安全的降级是贴到可滚动底部；但严禁静默，每个进入计划只留一条可观测痕迹。
       */
      if (probeId && !this.probeMissingLogged) {
        this.probeMissingLogged = true;
        this.host.logDebug?.('session enter probe row missing', { reason: 'probe-row-missing', probeId, maxScroll });
      }
      aligned = Math.abs(stream.scrollTop - maxScroll) <= SESSION_ENTER_ALIGN_TOLERANCE_PX;
    }

    /**
     * 【同步模式只对齐不裁决 (Rules)】sync 帧到此为止：几何已对齐，
     *   但不消耗帧配额、不累计稳定性计数、不裁决收敛 —— 那些只属于排队帧。
     *   【链条不得断 (Rules)】仍需保证推进链存在：否则宿主只在提交时同步对齐一次，
     *   之后没有任何帧去累计稳定性计数，计划会永久 armed。
     */
    if (!advance) {
      this.schedulePinFrame(ticket);
      return false;
    }

    this.trackPinStability(stream, pending, aligned);

    if (this.armedFrames >= SESSION_ENTER_HARD_CAP_FRAMES) {
      // 硬上限兜底：最后一次贴底并留痕，避免永久 armed 冻结滚动记忆
      if (Math.abs(stream.scrollTop - maxScroll) > SESSION_ENTER_ALIGN_TOLERANCE_PX) {
        stream.scrollTop = maxScroll;
        this.host.markProgrammaticScroll(stream);
      }
      this.host.logDebug?.('session enter hard cap', {
        reason: 'session-enter-hard-cap',
        sessionId: pending.sessionId,
        probeId,
        maxScroll,
        aligned,
      });
      this.finishPinPlan();
      return true;
    }

    const converged = this.alignedStableFrames >= SESSION_ENTER_ALIGNED_STABLE_FRAMES
      && this.scrollHeightStableFrames >= SESSION_ENTER_HEIGHT_STABLE_FRAMES
      && this.isAuthoritativeReady(pending)
      && (this.armedHeightChangedSinceArm || this.armedFrames >= SESSION_ENTER_HARD_CAP_FRAMES);

    if (!converged) {
      this.schedulePinFrame(ticket);
      return false;
    }

    if (!aligned) {
      this.host.logDebug?.('session enter settled without aligned row', {
        reason: 'session-enter-settled-unaligned',
        sessionId: pending.sessionId,
        probeId,
        maxScroll,
        scrollTop: Math.round(stream.scrollTop),
      });
    }
    this.finishPinPlan();
    return true;
  }

  /**
   * 【终态判据的输入追踪 (Rules)】
   *   1. 内容高度变化即视为「自 armed 起确实发生过真实生长」，同时清零高度稳定计数；
   *   2. loading 相位的内容高度只是缓存批次的中间态，不构成终态判据：
   *      只清稳定计数，**绝不把基线设成当前高度**。
   *      旧实现写 `lastSeenScrollHeight = scrollHeight`，于是切 ready 后高度没变就恒等，
   *      `armedHeightChangedSinceArm` 永假 → 只能等 600 帧硬上限（约 10 秒不跟随）。
   */
  private trackPinStability(stream: HTMLElement, pending: SessionEnterPlan, aligned: boolean): void {
    const scrollHeight = stream.scrollHeight;
    if (pending.phase === 'loading') {
      this.scrollHeightStableFrames = 0;
    } else if (scrollHeight !== this.lastSeenScrollHeight) {
      this.armedHeightChangedSinceArm = true;
      this.scrollHeightStableFrames = 0;
      this.lastSeenScrollHeight = scrollHeight;
    } else {
      this.scrollHeightStableFrames += 1;
    }
    this.alignedStableFrames = aligned ? this.alignedStableFrames + 1 : 0;
    this.armedFrames += 1;
    if (this.isAuthoritativeReady(pending)) {
      this.readyFrames += 1;
    }
  }

  /**
   * 权威完成信号是否已到。
   * 【约束与规则 (Rules)】
   *   1. 显式 `authoritativeReady === false` 一律不放行（宿主明确说「权威页还在路上」）；
   *   2. 显式 `true` 直接放行；
   *   3. 未声明（undefined）时回落为 `phase === 'ready'`，保住旧调用方的既有语义。
   */
  private isAuthoritativeReady(pending: SessionEnterPlan): boolean {
    if (pending.authoritativeReady === false) return false;
    if (pending.authoritativeReady === true) return true;
    return pending.phase === 'ready';
  }

  private finishPinPlan(): void {
    this.setInitialBottomSettling(false);
    this.setSettledLayoutSignature(this.host.layoutSignature());
    this.clearSessionEnter();
  }

  private runSessionEnterFrame(ticket: number, mode: 'advance' | 'sync' = 'advance'): void {
    const pending = this.pendingSessionEnter;
    if (!pending || pending.ticket !== ticket) return;
    if (this.host.isPromptJumpSettling()) {
      this.clearSessionEnter();
      return;
    }
    const stream = this.host.getStreamElement();
    if (!stream) {
      this.clearSessionEnter();
      return;
    }

    const advance = mode === 'advance';

    // 【防锚定推走 (Why)】无论是贴底还是回溯恢复，armed 期间都必须临时关闭 overflow-anchor，
    //   防止 Blink 选中视口顶沿回合为锚点、将目标锚点或新解锁回合推离视口；
    //   计划结束或取消时在 clearSessionEnter 中成对 removeProperty 恢复。
    if (stream.style && stream.style.overflowAnchor !== 'none') {
      stream.style.overflowAnchor = 'none';
    }

    if (pending.plan.type === 'pin-to-bottom') {
      this.runPinFrame(stream, pending, ticket, advance);
      return;
    }

    const plan = pending.plan;
    let errorPx = Number.POSITIVE_INFINITY;

    if (plan.type === 'restore-scroll-top') {
      const max = Math.max(0, stream.scrollHeight - stream.clientHeight);
      stream.scrollTop = Math.max(0, Math.min(plan.scrollTop, max));
      errorPx = 0;
      this.host.markProgrammaticScroll(stream);
    } else {
      const target = stream.querySelector<HTMLElement>(`[data-msg-id="${escapeMessageId(plan.anchorMessageId)}"]:not(.msg-action-btn)`);
      const max = Math.max(0, stream.scrollHeight - stream.clientHeight);
      const fallback = Math.max(0, Math.min(plan.fallbackScrollTop, max));
      if (!target) {
        /**
         * 【提交后驱动 (Rules)】锚点行尚未提交（React 还没把目标会话的消息行挂进 DOM）：
         *   只保持 armed，绝不写 fallback、绝不写已落定签名。
         *   写 fallback 会让 errorPx=0 → 两帧后 finishPinPlan() 把「未恢复」登记成「已落定」，
         *   随后 React 提交锚点行时计划已死，回溯恢复彻底丢失。
         * 【有界兜底 (Rules)】但绝不能永久 armed（会冻结滚动记忆）：达到回溯熔断帧数后，
         *   按标量基准做一次有界降级并收口，语义与旧实现一致（锚点行确实已不在序列里）。
         */
        if (advance) {
          this.armedFrames += 1;
          if (this.armedFrames < RESTORE_PLAN_HARD_CAP_FRAMES) {
            this.schedulePinFrame(ticket);
            return;
          }
          stream.scrollTop = fallback;
          this.host.markProgrammaticScroll(stream);
          this.host.logDebug?.('restore anchor row never committed', {
            reason: 'restore-anchor-hard-cap',
            sessionId: pending.sessionId,
            anchorMessageId: plan.anchorMessageId,
            fallback,
          });
          this.finishPinPlan();
          return;
        }
        this.schedulePinFrame(ticket);
        return;
      }
      {
        const streamTop = stream.getBoundingClientRect().top;
        const rect = target.getBoundingClientRect();
        const delta = rect.top - streamTop + rect.height * plan.anchorOffsetRatio;
        /**
         * 【锚点可信域 (Rules)】`content-visibility: auto` 下，未渲染回合返回的是
         * `contain-intrinsic-size` 占位高度，锚点行坐标可能与真实排版差出上千像素。
         * 偏差超过 0.6 屏即视为估算失真：先退回标量基准，并**继续迭代**而不是就地收敛，
         * 等布局稳定后若 delta 落回可信域再做精确校正；熔断时停在 fallback。
         *
         * 【占位布局不得收敛 (Why)】锚点行即便已在 DOM 里，也可能仍处于
         *   `content-visibility: auto` 的跳过状态：此时它只是占位替身，坐标与真实排版
         *   相差可达数千像素，`delta` 却可能恰好很小，于是 errorPx 被误判为 0、两帧后
         *   计划收口，用户切回后落在错误的行上（实测锚点 20222 漂到 20250）。
         *   判据必须落在**锚点元素自身**的布局状态上，且只推进不裁决。
         *
         * 【必须有硬上限兜底 (Pitfall)】`checkVisibility` 对长会话里大部分行都返回 false，
         *   若仅凭它阻止收敛，计划会一直 armed 到熔断帧数，期间视口被反复推向底部
         *   （实测位置比 100%）。因此「未布局」只阻止**提前**收敛，
         *   超过宽限帧数仍未被布局就接受当前几何，避免把用户推到会话末尾。
         */
        // 【直达目标锚点，杜绝 fallback 乒乓闪屏 (Why)】只要目标锚点已在 DOM 中，
        //   即使离屏回合失去记忆高度导致 delta > 0.6 屏，也必须按 delta 步进把锚点拉入视口；
        //   旧实现退回 fallback 会导致「fallback ⇄ target」来回跳变闪屏，并在 30 帧熔断后停在错误位置。
        if (Math.abs(delta) >= 1) {
          stream.scrollTop = Math.max(0, Math.min(max, stream.scrollTop + delta));
        }
        if (!this.isAnchorLaidOut(target) && this.armedFrames < SESSION_ENTER_LAYOUT_GRACE_FRAMES) {
          errorPx = Number.POSITIVE_INFINITY;
        } else {
          errorPx = Math.abs(delta);
        }
      }
      this.host.markProgrammaticScroll(stream);
    }

    /**
     * 【同步模式只对齐不裁决 (Rules)】restore 类计划同样遵守该边界：
     *   几何已写回，但帧配额与收敛裁决只属于排队帧。
     *   【链条不得断 (Rules)】仍须把推进链续上，否则计划在途却无人推进。
     */
    if (!advance) {
      this.schedulePinFrame(ticket);
      return;
    }

    // 【权威就绪门控 (Rules)】loading 相位（REST 未返回前）绝不提前收口，也不消耗 30 帧回溯熔断配额；
    //   仅以 600 帧外层上限兜底，避免 REST 返回后把半途位置写回 SessionScrollMemory。
    if (!this.isAuthoritativeReady(pending)) {
      this.alignedStableFrames = 0;
      this.loadingWaitFrames += 1;
      if (this.loadingWaitFrames >= SESSION_ENTER_HARD_CAP_FRAMES) {
        this.finishPinPlan();
        return;
      }
      this.schedulePinFrame(ticket);
      return;
    }

    this.armedFrames += 1;
    this.alignedStableFrames = errorPx <= SESSION_ENTER_ALIGN_TOLERANCE_PX ? this.alignedStableFrames + 1 : 0;

    if ((this.alignedStableFrames >= 2 && this.armedFrames >= 2) || this.armedFrames >= RESTORE_PLAN_HARD_CAP_FRAMES) {
      this.finishPinPlan();
      return;
    }
    this.schedulePinFrame(ticket);
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
