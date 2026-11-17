/**
 * 会话视口滚动记忆状态机 (Session Scroll Memory)
 *
 * 【设计意图 (Why)】
 *   将多会话切换时的视口物理位置记忆、阅读进度锚定与恢复决策彻底从 DOM 中抽离，
 *   沉淀为纯 TypeScript 状态机。在用户离开会话时原子捕获快照，切回会话时推导无副作用的
 *   强类型判别联合恢复策略，彻底解决切会话白屏、跳变与阅读位置丢失问题。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 离开会话若处于贴底态（isNearBottom = true），切回时不应恢复旧的绝对像素 scrollTop，
 *      否则后续到达的增量流式消息会被推到视口下方看不到；必须强制输出 pin-to-bottom；
 *   2. 离开会话若处于回溯阅读态，仅记录绝对像素 scrollTop 会在窗口 Resize、字号变化或
 *      异构代码块渲染时产生数千像素漂移；必须记录锚点消息 ID 与高度百分比 anchorOffsetRatio；
 *   3. 锚点消息可能在离开期间被分支截断或撤销（session.undo），必须包含 fallbackScrollTop 兜底；
 *   4. 无限制创建会话会导致内存快照无限膨胀，内置严格的 LRU 淘汰机制。
 *
 * 【约束与规则 (Rules)】
 *   - 纯逻辑实现：严禁引用 window、document、HTMLElement 或任何 React/DOM API；
 *   - 强类型判别联合：恢复策略输出明确的 type 分支，非法恢复在编译期不可表达；
 *   - 严格可测：100% 支持在 Node 环境下进行单元测试与 fast-check 属性测试。
 */

export type SessionScrollSnapshot = {
  sessionId: string;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  isNearBottom: boolean;
  anchorMessageId?: string;
  anchorOffsetRatio?: number;
  capturedAt: number;
}

export type PinToBottomRestore = { type: 'pin-to-bottom'; reason: 'new-session' | 'was-near-bottom' }
export type RestoreAnchor = {
  type: 'restore-anchor';
  anchorMessageId: string;
  anchorOffsetRatio: number;
  fallbackScrollTop: number;
}
export type RestoreScrollTop = { type: 'restore-scroll-top'; scrollTop: number }
export type ScrollRestoreStrategy = PinToBottomRestore | RestoreAnchor | RestoreScrollTop;

export type SessionScrollMemoryOptions = {
  maxEntries?: number;
  nearBottomThresholdPx?: number;
}

export type RecordSnapshotInput = {
  sessionId: string;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  anchorMessageId?: string;
  anchorOffsetRatio?: number;
  capturedAt?: number;
  now?: number;
}

export class SessionScrollMemory {
  private readonly maxEntries: number;
  private readonly nearBottomThresholdPx: number;
  private readonly cache = new Map<string, SessionScrollSnapshot>();

  public constructor(options: SessionScrollMemoryOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 100);
    this.nearBottomThresholdPx = Math.max(0, options.nearBottomThresholdPx ?? 48);
  }

  /**
   * 记录离开会话时的视口物理快照。
   */
  public recordSnapshot(snapshot: RecordSnapshotInput): void {
    const { sessionId, scrollTop, scrollHeight, clientHeight, anchorMessageId, anchorOffsetRatio } = snapshot;
    if (!sessionId) return;

    const normalizedScrollTop = Math.max(0, scrollTop);
    const normalizedScrollHeight = Math.max(0, scrollHeight);
    const normalizedClientHeight = Math.max(0, clientHeight);

    // 计算是否处于贴底安全区
    const distanceToBottom = normalizedScrollHeight - (normalizedScrollTop + normalizedClientHeight);
    const isNearBottom = distanceToBottom <= this.nearBottomThresholdPx;

    // LRU 淘汰维护
    if (this.cache.has(sessionId)) {
      this.cache.delete(sessionId);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(sessionId, {
      sessionId,
      scrollTop: normalizedScrollTop,
      scrollHeight: normalizedScrollHeight,
      clientHeight: normalizedClientHeight,
      isNearBottom,
      anchorMessageId: anchorMessageId || undefined,
      anchorOffsetRatio: typeof anchorOffsetRatio === 'number' && Number.isFinite(anchorOffsetRatio)
        ? Math.max(0, Math.min(1, anchorOffsetRatio))
        : undefined,
      capturedAt: snapshot.now ?? Date.now(),
    });
  }

  /**
   * 纯推导进入会话时的视口恢复决策。
   */
  public planSessionEnter(sessionId: string): ScrollRestoreStrategy {
    if (!sessionId || !this.cache.has(sessionId)) {
      return { type: 'pin-to-bottom', reason: 'new-session' };
    }

    const snapshot = this.cache.get(sessionId)!;
    // 重新置入 Map 尾部，刷新 LRU 热度
    this.cache.delete(sessionId);
    this.cache.set(sessionId, snapshot);

    if (snapshot.isNearBottom) {
      return { type: 'pin-to-bottom', reason: 'was-near-bottom' };
    }

    if (snapshot.anchorMessageId) {
      return {
        type: 'restore-anchor',
        anchorMessageId: snapshot.anchorMessageId,
        anchorOffsetRatio: snapshot.anchorOffsetRatio ?? 0,
        fallbackScrollTop: snapshot.scrollTop,
      };
    }

    return {
      type: 'restore-scroll-top',
      scrollTop: snapshot.scrollTop,
    };
  }

  /**
   * 查询当前快照缓存（用于只读检查或单测断言）。
   */
  public getSnapshot(sessionId: string): SessionScrollSnapshot | undefined {
    return this.cache.get(sessionId);
  }

  /**
   * 清理指定会话的记忆（如会话彻底删除时）。
   */
  public deleteSession(sessionId: string): boolean {
    return this.cache.delete(sessionId);
  }

  /**
   * 清空所有快照。
   */
  public clear(): void {
    this.cache.clear();
  }

  /**
   * 当前缓存的会话数量。
   */
  public get size(): number {
    return this.cache.size;
  }
}
