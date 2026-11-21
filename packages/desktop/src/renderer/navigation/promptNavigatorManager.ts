/**
 * 提示词导航状态机领域管理器（Prompt Navigator Manager）
 *
 * 【设计意图 (Why)】
 *   将提示词导航轨的快照派生、滚动步进换算、会话切换末条锁定、
 *   DOM 矩形多帧落定与跳转防抖逻辑从 1.1 万行的 `renderer/index.ts` 中完全解耦。
 *   使得导航器全生命周期的状态变迁（快照对比、去重推送、rAF 跳转序列防竞争）
 *   能够脱离 Electron/Browser 环境进行独立的确定性单元测试。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 空快照必须是冻结常量，禁止在 getSnapshot 现造对象，否则 React 岛被无意义重推；
 *   2. 切会话必须落到末条（因为读者未知）；普通数组替换按 scrollTop 重算；
 *   3. 滚动容器的 padding-top 必须仅实测一次后缓存，避免在滚动热路径反复触发 layout/reflow；
 *   4. 跳转落定时行高未锁定时必须递归等待落定，最多重试 8 帧，超时显式 warn 告警；
 *   5. 导航轨条目重建重入守卫：`syncFromScroll` 内部触发的重建不得递归调用自身。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯 TypeScript 无界模块，所有宿主上下文（state/DOM/定时器）均通过 PromptNavigatorHost 注入；
 *   2. 严禁 `as any`，入参严格防御；
 *   3. 导出单一纯类，保留完整的静态常量与接口定义。
 */

import {
  buildPromptEntries,
  resolveActivePromptIndex,
  type PromptEntry,
  type PromptNavigatorActions,
  type PromptNavigatorSnapshot,
} from '@hermes-flux/ui';

export const PROMPT_READ_LINE_PX = 100;

import {
  promptMessageIndexAtScrollTop,
  topmostRectTop,
  shouldRebuildPromptIndex,
  buildHostPromptNavigatorSnapshot,
  isHostPromptNavigatorMetaSame,
  type HostPromptNavigatorMetaInput,
} from '../promptNavigator.js';

export interface PromptNavigatorMessageItem {
  readonly id: string;
  readonly role: string;
  readonly content: string;
  readonly displayKind?: string;
}

export interface PromptNavigatorHost {
  readonly getActiveSessionId: () => string;
  readonly getMessages: () => readonly PromptNavigatorMessageItem[];
  readonly getLang: () => string;
  readonly hasOlderMessages: () => boolean;
  readonly isLoadingOlder: () => boolean;
  readonly isGroupConversationActive: (sessionId?: string) => boolean;
  readonly getAverageRowHeightPx: () => number;
  readonly isAverageRowHeightLocked: () => boolean;
  readonly getStreamElement: () => HTMLElement | null;
  readonly relocateMessageWindowToIndex: (index: number) => void;
  readonly triggerRenderForJump: () => void;
  readonly loadOlderMessages: (options: { preserveViewportWindow: boolean }) => Promise<unknown> | void;
  readonly onJumpSettlingChange?: (settling: boolean) => void;
  readonly logWarn?: (message: string, meta?: Record<string, unknown>) => void;
  readonly requestAnimationFrame?: (callback: () => void) => number;
}

export const EMPTY_PROMPT_NAVIGATOR_SNAPSHOT: PromptNavigatorSnapshot = Object.freeze({
  prompts: Object.freeze([]) as readonly PromptEntry[],
  activeIndex: -1,
  hasOlder: false,
  isLoadingOlder: false,
});

export class PromptNavigatorManager {
  private promptNavigatorSnapshot: PromptNavigatorSnapshot | null = null;
  private promptNavigatorEntries: PromptEntry[] = [];
  private promptNavigatorCache: { sessionId: string; messagesRef: readonly unknown[] } | null = null;
  private lastPromptNavigatorSnapshot: PromptNavigatorSnapshot | null = null;
  private updateReactPromptNavigator: (() => void) | null = null;

  /** 跳转序列号：丢弃迟到 rAF，连点两根 tick 时先到的回调不得覆盖后一次跳转。 */
  private promptJumpSeq = 0;
  /** 跳转落定状态。 */
  private promptJumpSettling = false;
  /**
   * 跳转意图锁定目标：点击/跳转落定后，只要目标位于视口内，优先保持该目标，
   * 防止因目标处于物理触底区未达 12px 留白而被 100px 固定阅读线反弹覆盖。
   */
  private activeJumpTargetMessageId: string | null = null;
  /** 滚动容器 padding-top 实测值。 */
  private streamPaddingTopPx = 24;
  private streamPaddingTopRead = false;
  /** 重建重入标记：syncFromScroll 内部触发的重建不得递归调用自身。 */
  private promptNavigatorRebuildDepth = 0;

  constructor(private readonly host: PromptNavigatorHost) {}

  public setUpdateHandler(handler: (() => void) | null): void {
    this.updateReactPromptNavigator = handler;
  }

  public isJumpSettling(): boolean {
    return this.promptJumpSettling;
  }

  public getSnapshot(): PromptNavigatorSnapshot {
    return this.promptNavigatorSnapshot ?? EMPTY_PROMPT_NAVIGATOR_SNAPSHOT;
  }

  public currentPromptNavigatorMeta(): HostPromptNavigatorMetaInput {
    return {
      locale: this.host.getLang(),
      hasOlderMessages: this.host.hasOlderMessages(),
      isLoadingOlder: this.host.isLoadingOlder(),
      isGroupRoom: this.host.isGroupConversationActive(),
    };
  }

  public buildSnapshot(
    prompts: readonly PromptEntry[],
    activeIndex: number
  ): PromptNavigatorSnapshot {
    return buildHostPromptNavigatorSnapshot(
      prompts,
      activeIndex,
      this.currentPromptNavigatorMeta()
    );
  }

  public isMetaSame(snapshot: PromptNavigatorSnapshot | null): boolean {
    return isHostPromptNavigatorMetaSame(snapshot, this.currentPromptNavigatorMeta());
  }

  /**
   * 同步导航器的加载态与历史余量元信息，不触发宿主全量 render。
   */
  public syncMeta(): void {
    const current = this.promptNavigatorSnapshot;
    if (!current) return;
    if (this.isMetaSame(current)) return;
    this.promptNavigatorSnapshot = this.buildSnapshot(current.prompts, current.activeIndex);
    this.sync();
  }

  /**
   * 快照推送唯一入口。
   */
  public sync(): void {
    if (!this.updateReactPromptNavigator) return;
    const snapshot = this.getSnapshot();
    if (snapshot === this.lastPromptNavigatorSnapshot) return;
    this.lastPromptNavigatorSnapshot = snapshot;
    this.updateReactPromptNavigator();
  }

  /**
   * 整表重建提示词条目。
   *
   * @returns true 表示已完成「切会话重置」，调用方不得再按 scrollTop 覆盖。
   */
  public rebuildEntries(): boolean {
    const activeSessionId = this.host.getActiveSessionId();
    const messages = this.host.getMessages();
    const shouldRebuild = shouldRebuildPromptIndex({
      sessionId: this.promptNavigatorCache?.sessionId ?? '',
      currentSessionId: activeSessionId,
      cachedMessagesRef: this.promptNavigatorCache?.messagesRef ?? null,
      messagesRef: messages,
    });
    if (!shouldRebuild) return false;

    const sessionChanged = this.promptNavigatorCache?.sessionId !== activeSessionId;
    this.promptNavigatorEntries = buildPromptEntries(messages);
    this.promptNavigatorCache = { sessionId: activeSessionId, messagesRef: messages };

    if (sessionChanged) {
      this.promptNavigatorSnapshot =
        this.promptNavigatorEntries.length === 0
          ? this.buildSnapshot(this.promptNavigatorEntries, -1)
          : this.buildSnapshot(
              this.promptNavigatorEntries,
              this.promptNavigatorEntries.length - 1
            );
      this.sync();
      return true;
    }

    if (this.promptNavigatorRebuildDepth > 0) return false;
    // 等长替换 / 回滚：按当前滚动位置重算，避免高亮停在已裁掉的下标上。
    this.syncFromScroll();
    return false;
  }

  /**
   * 按滚动位置刷新当前项。
   *
   * 【设计意图 (Why)】
   *   1. 意图锁定优先：用户主动跳转至某提问时，若目标在视口内（即使物理触底无法达到 12px 留白），优先确认该目标；
   *   2. 触底平滑收敛：当大会话滚到底部（距离底部 <= 48px）且可滚动时，收敛至最新提问，消除 100px 读线造成的末端盲区；
   *   3. 短会话免疫：当容器内容未超出一屏（canScroll = false）时，禁用触底盲目收敛，保持首屏精准定位。
   *
   * 【防范的历史坑 (Pitfall)】
   *   1. 顶部 100px 固定读线让大会话滚动到底部时被倒数第 3 条提问截断，无法激活最新提问；
   *   2. 跳转到底部提问后，固定读线再次重算引发高亮闪跳回弹；
   *   3. 盲目收敛若在短会话生效，会导致无论怎么点都会被强制吸附在末条。
   *
   * 【约束与规则 (Rules)】
   *   1. 纯 TypeScript 无界模块，入参防御；
   *   2. 仅在 canScroll（scrollHeight > clientHeight + 8）且 distanceToBottom <= 48 时触发触底收敛；
   *   3. 用户点击目标在视口内时，意图锁定高于触底收敛与固定读线。
   */
  public syncFromScroll(intendedMessageId?: string): void {
    const stream = this.host.getStreamElement();
    if (stream) this.ensureStreamPaddingTop(stream);
    this.promptNavigatorRebuildDepth += 1;
    let sessionReset = false;
    try {
      sessionReset = this.rebuildEntries();
    } finally {
      this.promptNavigatorRebuildDepth -= 1;
    }
    if (sessionReset) return;

    if (this.promptNavigatorEntries.length === 0) {
      if (
        this.promptNavigatorSnapshot &&
        (this.promptNavigatorSnapshot.prompts.length > 0 || !this.isMetaSame(this.promptNavigatorSnapshot))
      ) {
        this.promptNavigatorSnapshot = this.buildSnapshot(this.promptNavigatorEntries, -1);
        this.sync();
      }
      return;
    }

    const activeSessionId = this.host.getActiveSessionId();
    if (this.promptNavigatorCache?.sessionId !== activeSessionId) return;
    const messages = this.host.getMessages();
    const total = messages.length;
    if (total <= 0 || !stream) return;

    // 1. 【用户显式跳转意图优先】
    // 若来自点击跳转且目标节点在视口内可见，锁定为激活项，防止触底或 100px 读线回弹覆盖
    const targetId = intendedMessageId || this.activeJumpTargetMessageId;
    if (targetId) {
      const promptIdx = this.promptNavigatorEntries.findIndex((e) => e.id === targetId);
      if (promptIdx >= 0) {
        const escapedId =
          typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
            ? CSS.escape(targetId)
            : targetId.replace(/["\\]/g, '\\$&');
        const targetNode = stream.querySelector<HTMLElement>(`[data-msg-id="${escapedId}"]`);
        if (targetNode && typeof targetNode.getBoundingClientRect === 'function' && typeof stream.getBoundingClientRect === 'function') {
          const nodeRect = targetNode.getBoundingClientRect();
          const streamRect = stream.getBoundingClientRect();
          if (nodeRect.bottom > streamRect.top - 16 && nodeRect.top < streamRect.bottom + 16) {
            const next = promptIdx;
            if (
              next === (this.promptNavigatorSnapshot?.activeIndex ?? -1) &&
              this.isMetaSame(this.promptNavigatorSnapshot)
            ) {
              return;
            }
            this.promptNavigatorSnapshot = this.buildSnapshot(this.promptNavigatorEntries, next);
            this.sync();
            return;
          }
        }
      }
    }

    // 2. 【触底平滑收敛与短会话免疫】
    // 只有具有物理滚动余量的视口，在距离底部 <= 48px 时才收敛至末条提问；短会话（无法滚动）禁用此分支
    const canScroll = typeof stream.scrollHeight === 'number' &&
      typeof stream.clientHeight === 'number' &&
      stream.scrollHeight > stream.clientHeight + 8;

    if (canScroll) {
      const distanceToBottom = typeof stream.scrollTop === 'number'
        ? stream.scrollHeight - stream.scrollTop - stream.clientHeight
        : 1000;
      if (distanceToBottom <= 48) {
        const next = this.promptNavigatorEntries.length - 1;
        if (
          next === (this.promptNavigatorSnapshot?.activeIndex ?? -1) &&
          this.isMetaSame(this.promptNavigatorSnapshot)
        ) {
          return;
        }
        this.promptNavigatorSnapshot = this.buildSnapshot(this.promptNavigatorEntries, next);
        this.sync();
        return;
      }
    }

    let messageIndex = -1;
    const streamTop = stream.getBoundingClientRect().top;
    const readLineTop = streamTop + PROMPT_READ_LINE_PX;
    const turns = stream.querySelectorAll<HTMLElement>('.conv-turn');
    if (turns.length > 0 && typeof turns[0]?.querySelectorAll === 'function') {
      // 【二分查找 .conv-turn (Why)】content-visibility: auto 下子消息可能尚未布局，
      //   而 .conv-turn 容器盒在 .conv-canvas 中严格单调递增；先二分定位首个越过读线的回合，
      //   再只扫描该回合内的 1~3 个消息节点，将每次滚动的布局读取从 O(N) 降至 O(log N)。
      let lo = 0;
      let hi = turns.length - 1;
      let firstVisibleTurnIdx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const turnRect = turns[mid].getBoundingClientRect();
        if (turnRect.bottom > readLineTop) {
          firstVisibleTurnIdx = mid;
          hi = mid - 1;
        } else {
          lo = mid + 1;
        }
      }
      if (firstVisibleTurnIdx >= 0) {
        for (let t = firstVisibleTurnIdx; t < turns.length && messageIndex < 0; t++) {
          const turnRows = turns[t].querySelectorAll<HTMLElement>('[data-msg-id]:not(.msg-action-btn)');
          for (let i = 0; i < turnRows.length; i++) {
            const rect = turnRows[i].getBoundingClientRect();
            if (rect.bottom > readLineTop) {
              const id = turnRows[i].getAttribute('data-msg-id');
              if (id) {
                const found = messages.findIndex((m) => m.id === id);
                if (found >= 0) {
                  messageIndex = found;
                  break;
                }
              }
            }
          }
          // 若当前可见回合内部全为无匹配行，仅向后多探 1 个回合避免退化回 O(N)
          if (t > firstVisibleTurnIdx) break;
        }
      }
    } else {
      const rows = stream.querySelectorAll<HTMLElement>('[data-msg-id]:not(.msg-action-btn)');
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rect = row.getBoundingClientRect();
        if (rect.bottom > readLineTop) {
          const id = row.getAttribute('data-msg-id');
          if (id) {
            const found = messages.findIndex((m) => m.id === id);
            if (found >= 0) {
              messageIndex = found;
              break;
            }
          }
        }
      }
    }

    if (messageIndex < 0) {
      messageIndex = promptMessageIndexAtScrollTop({
        scrollTop: stream.scrollTop,
        rowHeight: this.host.getAverageRowHeightPx(),
        paddingTop: this.streamPaddingTopPx,
        readLinePx: PROMPT_READ_LINE_PX,
        total,
      });
    }

    const next = resolveActivePromptIndex(this.promptNavigatorEntries, messageIndex);
    if (
      next === (this.promptNavigatorSnapshot?.activeIndex ?? -1) &&
      this.isMetaSame(this.promptNavigatorSnapshot)
    ) {
      return;
    }
    this.promptNavigatorSnapshot = this.buildSnapshot(this.promptNavigatorEntries, next);
    this.sync();
  }

  /**
   * 构造导航轨交互动作表。
   */
  public createActions(): PromptNavigatorActions {
    return {
      onSelect: (messageId: string) => {
        this.jumpToPrompt(messageId);
      },
      onLoadOlder: () => {
        void this.host.loadOlderMessages({ preserveViewportWindow: true });
      },
    };
  }

  /**
   * 跳转到指定提示词消息。
   */
  public jumpToPrompt(messageId: string): void {
    const messages = this.host.getMessages();
    const index = messages.findIndex((m) => m.id === messageId);
    if (index < 0) return;

    this.promptJumpSeq += 1;
    const seq = this.promptJumpSeq;
    this.promptJumpSettling = true;
    this.activeJumpTargetMessageId = messageId;
    this.host.onJumpSettlingChange?.(true);

    this.host.relocateMessageWindowToIndex(index);
    this.host.triggerRenderForJump();
    this.settlePromptJump(messageId, seq, 0, 0);
  }

  /**
   * 读取一次滚动容器 padding-top 实测值。
   */
  private ensureStreamPaddingTop(stream: HTMLElement): void {
    if (this.streamPaddingTopRead) return;
    this.streamPaddingTopRead = true;
    try {
      if (typeof getComputedStyle === 'function') {
        const raw = Number.parseFloat(getComputedStyle(stream).paddingTop);
        if (Number.isFinite(raw) && raw >= 0) this.streamPaddingTopPx = raw;
      }
    // gate-degrade: 容忍非浏览器/单测测试环境缺省 getComputedStyle
    } catch {
      // 容忍非浏览器/单测测试环境缺省 getComputedStyle
    }
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

  private settlePromptJump(
    messageId: string,
    seq: number,
    attempt: number,
    wait: number
  ): void {
    this.runRaf(() => {
      if (seq !== this.promptJumpSeq) return;
      const messages = this.host.getMessages();
      const index = messages.findIndex((m) => m.id === messageId);
      if (index < 0) {
        this.releasePromptJump(seq);
        return;
      }

      if (!this.host.isAverageRowHeightLocked() && wait < 8) {
        this.settlePromptJump(messageId, seq, attempt, wait + 1);
        return;
      }

      const stream = this.host.getStreamElement();
      if (!stream) {
        this.releasePromptJump(seq);
        return;
      }

      this.ensureStreamPaddingTop(stream);

      const escapedId =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(messageId)
          : messageId.replace(/["\\]/g, '\\$&');
      const nodes = stream.querySelectorAll<HTMLElement>(`[data-msg-id="${escapedId}"]`);
      const top = topmostRectTop(
        Array.from(nodes, (node) => node.getBoundingClientRect())
      );
      if (top !== null) {
        const delta = top - stream.getBoundingClientRect().top;
        if (Math.abs(delta - 12) >= 1) {
          stream.scrollTop += delta - 12;
        }
        this.syncFromScroll(messageId);
        this.releasePromptJump(seq);
        return;
      }

      if (attempt === 0) {
        const rough = index * this.host.getAverageRowHeightPx();
        const safeRough = Math.max(0, Math.min(rough, stream.scrollHeight - stream.clientHeight));
        if (Math.abs(safeRough - stream.scrollTop) > 100) {
          stream.scrollTop = safeRough;
        }
      }

      if (attempt < 8) {
        this.settlePromptJump(messageId, seq, attempt + 1, wait);
        return;
      }

      this.host.logWarn?.('prompt jump target not mounted', { messageId, attempt });
      this.releasePromptJump(seq);
    });
  }

  private releasePromptJump(seq: number): void {
    this.runRaf(() => {
      if (seq !== this.promptJumpSeq) return;
      this.promptJumpSettling = false;
      this.activeJumpTargetMessageId = null;
      this.host.onJumpSettlingChange?.(false);
    });
  }
}
