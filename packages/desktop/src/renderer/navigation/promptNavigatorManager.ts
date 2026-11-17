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
   */
  public syncFromScroll(): void {
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

    let messageIndex = -1;
    const streamTop = stream.getBoundingClientRect().top;
    const rows = stream.querySelectorAll<HTMLElement>('[data-msg-id]');
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rect = row.getBoundingClientRect();
      if (rect.bottom > streamTop + PROMPT_READ_LINE_PX) {
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
        this.syncFromScroll();
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
      this.host.onJumpSettlingChange?.(false);
    });
  }
}
