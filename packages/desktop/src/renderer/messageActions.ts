/**
 * 消息微距操作栏业务逻辑与状态机领域模块 (packages/desktop/src/renderer/messageActions.ts)
 *
 * 【设计意图 (Why)】
 * 1. 从庞大的 index.ts 中将 4 大消息操作动作（复制纯文本/Markdown、回滚回填、Fork 节点截断分支、重新生成提问追溯）彻底解耦；
 * 2. 纯逻辑与算法保持高内聚、易测试，单测与生产代码无条件真实引用同一实现，彻底根除假测试与循环自证；
 * 3. 集中管理并发互斥锁（isForkPending, isRegeneratePending），严防用户快速双击引发的雪崩与网络竞态。
 *
 * 【防范的历史坑 (Pitfall)】
 * - 复制内容防范 HTML 属性截断：优先从 messages 内存列表中根据 data-msg-id 提取完整 content，仅在内存缺失时回退 data-content；
 * - Fork 分支防范 4008 守卫错误：计算截断条数 count = msgIdx + 1，杜绝传空、传负数或索引偏移；
 * - 重新生成防范并发重入与上下文脱节：在当前流式中坚决拦截；向前逆序查找到最近一条 user 提问再重新提交；
 * - 回滚防范光标跳动与高度未刷新：填入 textarea 后触发 input 事件通知自适应高度计算并保持末尾光标。
 *
 * 【约束与规则 (Rules)】
 * - 纯 TypeScript / DOM 辅助函数，零硬编码外部依赖，便于依赖注入与自动化测试；
 * - 严格类型，严禁 as any。
 */

import type { MessageViewModel } from '@hermes-flux/ui';

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
  const prevUserMsg = slice.slice().reverse().find((m) => m.role === 'user');
  return prevUserMsg?.content || null;
}

/**
 * 消息动作状态机控制器接口与并发锁管理
 */
export class MessageActionController {
  private isForkPending = false;
  private isRegeneratePending = false;

  public get isForking(): boolean {
    return this.isForkPending;
  }

  public get isRegenerating(): boolean {
    return this.isRegeneratePending;
  }

  /**
   * 执行回滚：将目标提问填回输入框，激活末尾光标并派发 input 事件
   */
  public executeRollback(
    btn: HTMLElement,
    messages: readonly MessageViewModel[],
    textarea: HTMLTextAreaElement | null,
    setNotice: (msg: string) => void,
    onSuccessNoticeText: string
  ): boolean {
    const text = resolveCopyContent(btn, messages);
    if (!text || !textarea) return false;

    textarea.value = text;
    textarea.focus();
    textarea.setSelectionRange(text.length, text.length);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof document !== 'undefined' && document.body) {
      document.body.setAttribute('data-last-rollback', text);
    }
    setNotice(onSuccessNoticeText);
    return true;
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
   * 执行分叉派生新会话：带并发防重入锁与消息计数计算
   */
  public async executeFork(
    btn: HTMLElement,
    options: {
      activeSessionId: string | null;
      profileName: string;
      messages: readonly MessageViewModel[];
      callRpc: (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
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
      const branchRes = await options.callRpc('session.branch', {
        session_id: options.activeSessionId,
        count,
        profile: options.profileName || 'default',
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

  /**
   * 执行重新生成：带并发互斥锁、流式态互斥与上轮提问回溯
   */
  public async executeRegenerate(
    btn: HTMLElement,
    options: {
      activeSessionId: string | null;
      isStreaming: boolean;
      messages: readonly MessageViewModel[];
      sendPrompt: (text: string) => Promise<void>;
      setNotice: (msg: string) => void;
      labels: {
        notConnected: string;
        streamingBusy: string;
        regenerating: string;
        promptNotFound: string;
      };
    }
  ): Promise<'success' | 'blocked' | 'busy' | 'prompt-not-found' | 'no-session'> {
    if (this.isRegeneratePending) return 'blocked';
    if (!options.activeSessionId) {
      options.setNotice(options.labels.notConnected);
      return 'no-session';
    }
    if (options.isStreaming) {
      options.setNotice(options.labels.streamingBusy);
      return 'busy';
    }

    this.isRegeneratePending = true;
    const rowEl = btn.closest<HTMLElement>('[data-msg-id]');
    const msgId = btn.getAttribute('data-msg-id') || rowEl?.getAttribute('data-msg-id');
    const promptText = findPreviousUserPrompt(msgId, options.messages);

    try {
      if (promptText) {
        options.setNotice(options.labels.regenerating);
        await options.sendPrompt(promptText);
        return 'success';
      }
      options.setNotice(options.labels.promptNotFound);
      return 'prompt-not-found';
    } finally {
      this.isRegeneratePending = false;
    }
  }
}

export const messageActionController = new MessageActionController();
