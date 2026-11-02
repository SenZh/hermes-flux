/**
 * Chat Queue Store (packages/core/src/queue/chatQueueStore.ts)
 *
 * 【设计意图 (Why)】
 * 1. 当 Agent 处于繁忙状态（isGenerating 或 isToolRunning）时，用户可继续输入多条消息并入队；
 * 2. 消息进入队列瞬间必须“不可变快照冻结”当时的 Provider、Model、Agent、附件及输入文本，
 *    杜绝后续由于用户在界面切换模型或删除附件导致出队时发生配置漂移（指鹿为马）；
 * 3. 支持队列内多条消息的调序（Reorder）、单条取消（Delete，并触发内存释放）、重新编辑（Edit 回填）
 *    以及强制打断插队（调用 session.interrupt 紧急刹停当前轮次并立即顶入执行）。
 *
 * 【防范的历史坑 (Pitfall)】
 * - 规避排队时立即调用网关 attach 导致多个排队轮次的附件在第一轮被网关一次性全部消费；
 * - 规避排队消息出队时从全局活跃可变状态反向推断模型导致的配置漂移；
 * - 规避取消排队时附件内存（Object URL / Base64）未释放导致的内存泄漏。
 *
 * 【约束与规则 (Rules)】
 * - 纯 TypeScript 实现，零 DOM/React 依赖，全平台通用；
 * - 状态变更通过不可变对象复制（Immutable State Diff）并广播通知订阅者；
 * - 严格类型契约，禁止使用 any。
 */

export interface QueueAttachmentSnapshot {
  id: string;
  name: string;
  type: 'image' | 'file' | 'pdf';
  sizeBytes: number;
  /** 纯文本 Base64 编码数据（用于图片） */
  base64?: string;
  /** 宿主本地绝对路径（桌面端有效） */
  filePath?: string;
  /** Data URL（Web 沙箱端降级使用） */
  dataUrl?: string;
  /** 本地临时预览 URL（用于界面呈现，销毁时需释放） */
  previewUrl?: string;
}

export interface QueuedMessageItem {
  id: string;
  sessionId: string;
  text: string;
  /** 入队瞬间冻结的模型提供商 */
  provider: string;
  /** 入队瞬间冻结的模型标识符 */
  model: string;
  /** 入队瞬间绑定的专职 Agent Profile */
  profileName?: string;
  /** 附件快照数组 */
  attachments: QueueAttachmentSnapshot[];
  /** 思考深度变体（如 normal / deep） */
  thinkingVariant?: string;
  /** 入队时间戳（毫秒） */
  enqueuedAt: number;
}

export type QueueListener = (items: QueuedMessageItem[]) => void;

export interface IChatQueueStore {
  getItems(sessionId?: string): QueuedMessageItem[];
  enqueue(item: Omit<QueuedMessageItem, 'id' | 'enqueuedAt'>): QueuedMessageItem;
  remove(id: string): boolean;
  reorder(sessionId: string, sourceIndex: number, targetIndex: number): boolean;
  moveUp(id: string): boolean;
  moveDown(id: string): boolean;
  popNext(sessionId: string): QueuedMessageItem | null;
  peekNext(sessionId: string): QueuedMessageItem | null;
  clear(sessionId?: string): void;
  subscribe(listener: QueueListener): () => void;
  onAttachmentRevoke?: (attachment: QueueAttachmentSnapshot) => void;
}

export class ChatQueueStore implements IChatQueueStore {
  private queue: QueuedMessageItem[] = [];
  private listeners = new Set<QueueListener>();
  public onAttachmentRevoke?: (attachment: QueueAttachmentSnapshot) => void;

  /**
   * 获取排队列表（可按会话过滤）
   */
  public getItems(sessionId?: string): QueuedMessageItem[] {
    if (!sessionId) {
      return [...this.queue];
    }
    return this.queue.filter((item) => item.sessionId === sessionId);
  }

  /**
   * 消息入队并执行不可变配置快照冻结
   */
  public enqueue(item: Omit<QueuedMessageItem, 'id' | 'enqueuedAt'>): QueuedMessageItem {
    if (!item.sessionId) {
      throw new Error('Session ID is mandatory for enqueueing a message');
    }
    if (!item.text && (!item.attachments || item.attachments.length === 0)) {
      throw new Error('Cannot enqueue empty message without text or attachments');
    }

    const newItem: QueuedMessageItem = {
      ...item,
      id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      attachments: item.attachments ? item.attachments.map((att) => ({ ...att })) : [],
      enqueuedAt: Date.now(),
    };

    this.queue = [...this.queue, newItem];
    this.notify();
    return newItem;
  }

  /**
   * 取消指定排队项并触发附件销毁回调
   */
  public remove(id: string): boolean {
    const target = this.queue.find((item) => item.id === id);
    if (!target) return false;

    // 触发附件内存释放（防止内存泄漏）
    if (this.onAttachmentRevoke && target.attachments.length > 0) {
      for (const att of target.attachments) {
        this.onAttachmentRevoke(att);
      }
    }

    this.queue = this.queue.filter((item) => item.id !== id);
    this.notify();
    return true;
  }

  /**
   * 会话维度自由调序
   */
  public reorder(sessionId: string, sourceIndex: number, targetIndex: number): boolean {
    const sessionItems = this.getItems(sessionId);
    if (
      sourceIndex < 0 ||
      sourceIndex >= sessionItems.length ||
      targetIndex < 0 ||
      targetIndex >= sessionItems.length ||
      sourceIndex === targetIndex
    ) {
      return false;
    }

    const itemToMove = sessionItems[sourceIndex];
    const otherSessions = this.queue.filter((item) => item.sessionId !== sessionId);
    
    // 对当前会话的子列表进行调序
    const nextSessionItems = [...sessionItems];
    nextSessionItems.splice(sourceIndex, 1);
    nextSessionItems.splice(targetIndex, 0, itemToMove);

    this.queue = [...otherSessions, ...nextSessionItems];
    this.notify();
    return true;
  }

  /**
   * 单项上移
   */
  public moveUp(id: string): boolean {
    const item = this.queue.find((i) => i.id === id);
    if (!item) return false;
    const sessionItems = this.getItems(item.sessionId);
    const index = sessionItems.findIndex((i) => i.id === id);
    if (index <= 0) return false;
    return this.reorder(item.sessionId, index, index - 1);
  }

  /**
   * 单项下移
   */
  public moveDown(id: string): boolean {
    const item = this.queue.find((i) => i.id === id);
    if (!item) return false;
    const sessionItems = this.getItems(item.sessionId);
    const index = sessionItems.findIndex((i) => i.id === id);
    if (index === -1 || index >= sessionItems.length - 1) return false;
    return this.reorder(item.sessionId, index, index + 1);
  }

  /**
   * 弹出指定会话队列的第一项供出队执行
   */
  public popNext(sessionId: string): QueuedMessageItem | null {
    const index = this.queue.findIndex((item) => item.sessionId === sessionId);
    if (index === -1) return null;

    const [nextItem] = this.queue.splice(index, 1);
    this.notify();
    return nextItem;
  }

  /**
   * 预览指定会话队列的第一项
   */
  public peekNext(sessionId: string): QueuedMessageItem | null {
    const next = this.queue.find((item) => item.sessionId === sessionId);
    return next ? { ...next } : null;
  }

  /**
   * 清空队列
   */
  public clear(sessionId?: string): void {
    if (!sessionId) {
      if (this.onAttachmentRevoke) {
        for (const item of this.queue) {
          for (const att of item.attachments) {
            this.onAttachmentRevoke(att);
          }
        }
      }
      this.queue = [];
    } else {
      if (this.onAttachmentRevoke) {
        const toRemove = this.queue.filter((item) => item.sessionId === sessionId);
        for (const item of toRemove) {
          for (const att of item.attachments) {
            this.onAttachmentRevoke(att);
          }
        }
      }
      this.queue = this.queue.filter((item) => item.sessionId !== sessionId);
    }
    this.notify();
  }

  /**
   * 订阅队列状态变化
   */
  public subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = [...this.queue];
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('[ChatQueueStore] Listener notification error:', err);
      }
    }
  }
}

/** 单例默认导出，支持局部实例化 */
export const chatQueueStore = new ChatQueueStore();
