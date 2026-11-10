/**
 * 消息微距操作栏业务逻辑与状态机领域模块 (packages/desktop/src/renderer/messageActions.ts)
 *
 * 【设计意图 (Why)】
 * 1. 从庞大的 index.ts 中将消息核心动作（复制纯文本/Markdown、回滚回填与截断定位、Fork 节点分支）彻底解耦；
 * 2. 纯逻辑与算法保持高内聚、易测试，单测与生产代码无条件真实引用同一实现，彻底根除假测试与循环自证；
 * 3. 集中管理并发互斥锁（isForkPending），严防用户快速双击引发的雪崩与网络竞态。
 *
 * 【防范的历史坑 (Pitfall)】
 * - 复制内容防范 HTML 属性截断：优先从 messages 内存列表中根据 data-msg-id 提取完整 content，仅在内存缺失时回退 data-content；
 * - Fork 分支防范 4008 守卫错误：计算截断条数 count = msgIdx + 1，杜绝传空、传负数或索引偏移；
 * - 回滚防范光标跳动与高度未刷新：填入 textarea 后触发 input 事件通知自适应高度计算并保持末尾光标，同时提取 rowId / messageId 供后续提交时物理原子截断；
 * - 移除不稳定重新生成：规避上下文跨轮截断歧义与模型幻觉。
 *
 * 【约束与规则 (Rules)】
 * - 纯 TypeScript / DOM 辅助函数，零硬编码外部依赖，便于依赖注入与自动化测试；
 * - 严格类型，严禁 as any。
 */

import type { MessageViewModel } from '@hermes-flux/ui';

export interface RollbackResult {
  success: boolean;
  text?: string;
  rowId?: number | null;
  messageId?: string;
}

/**
 * 提取待复制内容：内存优先，防范 HTML 属性转义截断
 */
export function resolveCopyContent(
  btn: HTMLElement,
  messages: readonly MessageViewModel[]
): string {
  const contentAttr = btn.getAttribute('data-content') || '';
  const rowEl = btn.closest<HTMLElement>('[data-msg-id]');
  const msgId = btn.getAttribute('data-msg-id') || rowEl?.getAttribute('data-msg-id');
  const targetMsg = msgId ? messages.find((m) => m.id === msgId) : undefined;
  return targetMsg?.content || contentAttr;
}

/**
 * 计算基于当前消息节点分叉时的截断条数
 * 当第 1 条消息分叉时 count = 1，第 N 条消息分叉时 count = N
 */
export function calculateForkCount(
  msgId: string | null | undefined,
  messages: readonly MessageViewModel[]
): number {
  if (!msgId) return messages.length;
  const msgIdx = messages.findIndex((m) => m.id === msgId);
  return msgIdx >= 0 ? msgIdx + 1 : messages.length;
}

/**
 * 逆序查找该 Assistant 消息所对应的上一轮最近 User 提问文本
 */
export function findPreviousUserPrompt(
  msgId: string | null | undefined,
  messages: readonly MessageViewModel[]
): string | null {
  const msgIdx = msgId ? messages.findIndex((m) => m.id === msgId) : -1;
  const slice = msgIdx >= 0 ? messages.slice(0, msgIdx) : messages;
  // 【规则】只认真实人类正文。steer 行与 [System: 行的 role 也是 user，
  // 取错会把机器文本回填进输入框，回滚后一提交就重放一遍信令。
  const prevUserMsg = slice.slice().reverse().find((m) => m.role === 'user' && (m.displayKind ?? 'user') === 'user');
  return prevUserMsg?.content || null;
}

/**
 * 消息动作状态机控制器接口与并发锁管理
 */
export class MessageActionController {
  private isForkPending = false;

  public get isForking(): boolean {
    return this.isForkPending;
  }

  /**
   * 执行回滚：将目标提问填回输入框，激活末尾光标并派发 input 事件，同时返回截断定位元数据
   */
  public executeRollback(
    btn: HTMLElement,
    messages: readonly MessageViewModel[],
    textarea: HTMLTextAreaElement | null,
    setNotice: (msg: string) => void,
    onSuccessNoticeText: string
  ): RollbackResult {
    const text = resolveCopyContent(btn, messages);
    if (!text || !textarea) return { success: false };

    const rowEl = btn.closest<HTMLElement>('[data-msg-id]');
    const msgId = btn.getAttribute('data-msg-id') || rowEl?.getAttribute('data-msg-id') || '';
    const rawRowId = btn.getAttribute('data-row-id');
    const parsedRowId = rawRowId ? parseInt(rawRowId, 10) : null;
    const targetMsg = msgId ? messages.find((m) => m.id === msgId) : undefined;
    const rowId =
      targetMsg && typeof targetMsg.rowId === 'number'
        ? targetMsg.rowId
        : parsedRowId !== null && Number.isFinite(parsedRowId)
        ? parsedRowId
        : null;

    textarea.value = text;
    textarea.focus();
    textarea.setSelectionRange(text.length, text.length);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof document !== 'undefined' && document.body) {
      document.body.setAttribute('data-last-rollback', text);
    }
    setNotice(onSuccessNoticeText);
    return {
      success: true,
      text,
      rowId,
      messageId: msgId,
    };
  }

  /**
   * 执行复制：调用剪贴板写入并呈现绿色勾选微反馈
   */
  public async executeCopy(
    btn: HTMLElement,
    messages: readonly MessageViewModel[],
    copyFn: (text: string) => Promise<boolean>,
    setNotice: (msg: string) => void,
    onSuccessNoticeText: string
  ): Promise<boolean> {
    const text = resolveCopyContent(btn, messages);
    if (!text) return false;

    const ok = await copyFn(text);
    if (ok) {
      const originalSvg = btn.innerHTML;
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      setNotice(onSuccessNoticeText);
      setTimeout(() => {
        btn.innerHTML = originalSvg;
      }, 1500);
      return true;
    }
    return false;
  }

  /**
   * 执行分叉派生新会话：带并发防重入锁与消息计数计算。
   * 【约束与规则 (Rules)】wire 载荷由注入的 forkSession（core InteractiveService.forkSession）单点构造，
   * 本控制器只负责计数与幂等键生成、并发锁、结果规约，杜绝 renderer 手拼 session.branch 字段。
   */
  public async executeFork(
    btn: HTMLElement,
    options: {
      activeSessionId: string | null;
      profileName: string;
      messages: readonly MessageViewModel[];
      forkSession: (input: {
        sessionId: string;
        count: number;
        profile: string;
        idempotencyKey: string;
      }) => Promise<{ session_id?: string; stored_session_id?: string }>;
      onSuccess: (newSessionId: string) => Promise<void>;
      setNotice: (msg: string) => void;
      labels: {
        notConnected: string;
        forking: string;
        success: string;
        failed: string;
      };
    }
  ): Promise<'success' | 'blocked' | 'error' | 'no-session'> {
    if (this.isForkPending) return 'blocked';
    if (!options.activeSessionId) {
      options.setNotice(options.labels.notConnected);
      return 'no-session';
    }

    this.isForkPending = true;
    const rowEl = btn.closest<HTMLElement>('[data-msg-id]');
    const msgId = btn.getAttribute('data-msg-id') || rowEl?.getAttribute('data-msg-id');
    const count = calculateForkCount(msgId, options.messages);

    try {
      options.setNotice(options.labels.forking);
      const branchRes = await options.forkSession({
        sessionId: options.activeSessionId,
        count,
        profile: options.profileName || 'default',
        idempotencyKey: `fork-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
      if (branchRes && (branchRes.session_id || branchRes.stored_session_id)) {
        const newSessionId = String(branchRes.stored_session_id || branchRes.session_id);
        await options.onSuccess(newSessionId);
        options.setNotice(options.labels.success);
        return 'success';
      }
      options.setNotice(options.labels.failed);
      return 'error';
    } catch (err) {
      options.setNotice(`${options.labels.failed}: ${String(err)}`);
      return 'error';
    } finally {
      this.isForkPending = false;
    }
  }
}

export const messageActionController = new MessageActionController();
