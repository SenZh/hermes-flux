/**
 * Hermes Flux 输入舱交互控制器（Input Dock Interaction Domain）
 *
 * 【设计意图 (Why)】
 *   将输入舱（InputDock）高度自适应、按键行为调度（Enter/Shift+Enter 发送与入队）、
 *   IME 输入法组合态防御锁、斜杠命令与 @ 智能引用实时联想补全、
 *   剪贴板图片粘贴与附件管理、模型下拉树过滤、思考等级二级级联定位及审批策略切换
 *   彻底从 index.ts 中抽离。
 *   让核心输入事件分派逻辑具备 100% 独立可测性，并杜绝长会话输入卡顿与状态竞争。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 输入框高度同步时必须先设为 auto 再量取 scrollHeight，否则文字回删时高度会被旧尺寸卡在上限无法回缩；
 *   2. 中文输入法（IME）在 composition 过程中如果按 Enter，严禁触发消息发送或命令执行；
 *   3. 会话切换后若按键直接读 state.isStreaming，会与当前会话的真实流式状态产生分歧，导致界面与按键动作撕裂；
 *   4. @ 补全必须区分群聊房间（从 activeFocus 提取 activeRoomId）与普通会话，并在专职工位中排除当前 Bot 自身；
 *   5. 二级思考等级级联面板在失焦时必须校验面板当前是否属于该行，防止键盘快速下移时误杀刚为下一行打开的面板。
 *
 * 【约束与规则 (Rules)】
 *   1. 单向依赖：严禁反向 import index.ts，所有宿主副作用与上下文通过 Deps 注入；
 *   2. 0 TS 报错，严禁使用 `as any`；
 *   3. 运行时所有按键动作与输入可用性校验必须与纯领域 queueControl 计算保持单一真值源对齐。
 */

import {
  type MentionReferenceOption,
  type InputAttachmentItem,
  type I18nKey,
  type RenderInputDockSnapshot,
  type ComposerBadgeItem,
  renderModelPickerTree,
  renderInputDock,
  hasDockSnapshotChanged,
  renderSlashPopper,
  renderMentionPopper,
  renderComposerBadges,
} from '@hermes-flux/ui';
import { type IRpcCaller, type InteractiveService, deriveSessionKind } from '@hermes-flux/core';
import type { AppState } from '../state/appState.js';
import {
  canSendDraft,
  clampComposerHeight,
  planEnterAction,
  resolveComposerPhase,
  shouldShowQueueButton,
  applyEnqueueReceipt,
  planEnqueue,
  planQueueAction,
  queuedAfterAction,
} from '../queueControl.js';
import { parseMentionToken } from '../mentionToken.js';
import { dispatchSlashCommand } from './slashCommandRunner.js';
export { dispatchSlashCommand };
import { ModelCascadeManager } from '../cascade/modelCascadeManager.js';

export interface InputDockControllerDeps {
  readonly getState: () => AppState;
  readonly commitState: (patch: Partial<AppState>) => void;
  readonly requestRender: () => void;
  readonly routeSend: (text: string) => Promise<void>;
  readonly enqueueDraft?: () => Promise<void>;
  readonly interruptTurn: () => Promise<void>;
  readonly handleRollbackCancel: () => void;
  readonly handleQueueAction?: (action: string, id: string) => Promise<void>;
  readonly requestSlashCompletion: (prefix: string) => void;
  readonly requestPathCompletion: (query: string, agentItems: MentionReferenceOption[]) => void;
  readonly isStreamingActiveForCurrentSession: () => boolean;
  readonly t: (key: I18nKey, params?: Record<string, string | number>) => string;
  readonly clearDockNoticeDismissTimer?: () => void;
  readonly setTimedDockNotice?: (msg: string, durationMs?: number) => void;
  readonly getSlashCanon?: () => Record<string, string> | undefined;
  readonly reloadSessionMessages?: (sessionId: string) => Promise<void>;
  readonly fetchModelOptions?: () => Promise<void>;
  readonly switchModel?: (model: string, provider?: string) => Promise<void>;
  readonly switchApproval?: (mode: 'manual' | 'smart' | 'off') => Promise<void>;
  readonly switchReasoning?: (level: AppState['reasoningLevel']) => Promise<void>;
  readonly onModelMenuStateChange?: (open: boolean) => void;
  readonly getGatewayClient?: () => { call: <TResult = unknown, TParams = unknown>(method: string, params?: TParams) => Promise<TResult> } | null;
  readonly ensureLiveSessionId?: () => Promise<string | null>;
  readonly createNewSession?: () => Promise<void>;
  readonly sendMessage?: (text: string) => Promise<void>;
  readonly interactiveService?: InteractiveService;
  readonly getRpcCaller?: () => IRpcCaller;
  readonly describeRpcError?: (err: unknown) => string;
}

export class InputDockController {
  private isComposing = false;
  private readonly modelCascadeManager: ModelCascadeManager;

  constructor(private readonly deps: InputDockControllerDeps) {
    this.modelCascadeManager = new ModelCascadeManager({
      getCascadeElement: () => (typeof document !== 'undefined' ? document.getElementById('model-reasoning-cascade') : null),
      getDropdownElement: () => (typeof document !== 'undefined' ? document.getElementById('dock-model-dropdown') : null),
      onModelChange: (model) => {
        this.deps.commitState({ modelCascadeModel: model });
      },
    });
  }

  /** 查询当前是否处于 IME 组合输入状态 */
  public getIsComposing(): boolean {
    return this.isComposing;
  }

  /** 设置 IME 组合输入状态 */
  public setIsComposing(composing: boolean): void {
    this.isComposing = composing;
  }

  /**
   * 同步输入框自适应高度（66px 起步至 220px 封顶）
   * 先设为 auto 再按 scrollHeight 夹取，防止删除内容后高度无法回缩
   */
  public syncComposerHeight(inputEl: HTMLTextAreaElement | null): void {
    if (!inputEl || !inputEl.style) return;
    inputEl.style.height = 'auto';
    inputEl.style.height = `${clampComposerHeight(inputEl.scrollHeight || 66)}px`;
  }

  /**
   * 将当前前置 Token 徽章与输入框文本组合为待发送草稿文本
   */
  public assembleDraftText(inputValue: string): string {
    const state = this.deps.getState();
    const badges = state.composerBadges || [];
    const commandBadge = badges.find((b) => b.type === 'command');
    const otherBadges = badges.filter((b) => b.type !== 'command');

    const parts: string[] = [];
    if (commandBadge) {
      parts.push(commandBadge.rawText);
    }
    for (const b of otherBadges) {
      parts.push(b.rawText);
    }
    const trimmed = (inputValue || '').trim();
    if (trimmed) {
      parts.push(trimmed);
    }
    return parts.join(' ').trim();
  }

  /**
   * 提交草稿文本并清空输入框
   */
  public submitDraft(inputEl?: HTMLTextAreaElement | null): void {
    const el = inputEl || (typeof document !== 'undefined' ? (document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null) : null);
    if (!el) return;
    const text = this.assembleDraftText(el.value);
    if (!text) return;
    el.value = '';
    this.deps.commitState({ composerBadges: [] });
    this.syncComposerBadges();
    this.syncComposerHeight(el);
    this.syncSendAvailability(undefined, el);
    this.syncQueueButtonVisibility(undefined, el);
    void this.deps.routeSend(text);
  }

  /**
   * 发送或入队调度（统一入口）
   *
   * @param source 触发源：'button' 点击或 'enter' 回车
   * @param inputEl 输入框元素
   */
  public handleSend(source: 'button' | 'enter', inputEl?: HTMLTextAreaElement | null): void {
    const el = inputEl || (typeof document !== 'undefined' ? (document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null) : null);
    if (!el) return;

    const state = this.deps.getState();
    const fullText = this.assembleDraftText(el.value);
    const badgeCount = (state.composerBadges || []).length;
    const action = planEnterAction({
      phase: resolveComposerPhase({ activeTurn: this.deps.isStreamingActiveForCurrentSession() }),
      text: fullText,
      attachmentCount: state.attachments.length + badgeCount,
    });

    if (action.kind === 'submit') {
      this.submitDraft(el);
    } else if (action.kind === 'enqueue') {
      void this.enqueueDraft();
    }
  }

  /**
   * 将当前输入框草稿加入待发送队列（运行中专用）
   */
  public async enqueueDraft(): Promise<void> {
    if (this.deps.enqueueDraft) {
      await this.deps.enqueueDraft();
      return;
    }

    const state = this.deps.getState();
    const gatewayClient = this.deps.getGatewayClient ? this.deps.getGatewayClient() : null;
    const el = typeof document !== 'undefined' ? (document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null) : null;
    const fullText = this.assembleDraftText(el?.value ?? '');
    const draft = planEnqueue({
      text: fullText,
      hasGateway: Boolean(gatewayClient),
      hasLiveSession: true,
    });

    if (draft.kind === 'skip') return;
    if (draft.kind === 'fail') {
      if (this.deps.setTimedDockNotice) {
        this.deps.setTimedDockNotice(this.deps.t(draft.reasonKey as I18nKey));
      }
      this.deps.requestRender();
      return;
    }

    if (state.activeFocus.type === 'group') {
      if (this.deps.setTimedDockNotice) {
        this.deps.setTimedDockNotice(this.deps.t('dock.cmdNotSupportedInGroup'), 4000);
      }
      this.deps.requestRender();
      return;
    }

    if (!state.activeSessionId && this.deps.createNewSession) {
      await this.deps.createNewSession();
    }

    const liveId = this.deps.ensureLiveSessionId ? await this.deps.ensureLiveSessionId() : null;
    if (!liveId) {
      if (this.deps.setTimedDockNotice) {
        this.deps.setTimedDockNotice(this.deps.t('dock.queueNoLive'));
      }
      this.deps.requestRender();
      return;
    }

    try {
      const receipt = await gatewayClient!.call<{
        admission_id?: string | null;
        status?: string | null;
        user_row_id?: number | null;
      }>('prompt.submit', {
        session_id: liveId,
        text: draft.text,
        queued: true,
      });

      const outcome = applyEnqueueReceipt(receipt, draft.text);
      if (outcome.kind === 'failed') {
        if (this.deps.setTimedDockNotice) {
          this.deps.setTimedDockNotice(this.deps.t(outcome.reasonKey as I18nKey));
        }
        this.deps.requestRender();
        return;
      }

      this.deps.commitState({
        queuedMessages: [...state.queuedMessages, outcome.entry],
        composerBadges: [],
      });
      this.syncComposerBadges();
      if (el) {
        el.value = '';
        el.style.height = '';
      }
      if (this.deps.setTimedDockNotice) {
        this.deps.setTimedDockNotice('');
      }
      this.deps.requestRender();
    } catch (err) {
      const errMsg = this.deps.describeRpcError ? this.deps.describeRpcError(err) : String(err);
      if (this.deps.setTimedDockNotice) {
        this.deps.setTimedDockNotice(`${this.deps.t('dock.queueFailed')}: ${errMsg}`);
      }
      this.deps.requestRender();
    }
  }

  /**
   * 队列行的三个动作调度（放回编辑 / 立即发送 / 取消）
   */
  public async handleQueueAction(action: string, admissionId: string): Promise<void> {
    if (this.deps.handleQueueAction) {
      await this.deps.handleQueueAction(action, admissionId);
      return;
    }

    const state = this.deps.getState();
    const entry = state.queuedMessages.find((q) => q.admissionId === admissionId);
    if (!entry) return;
    const plan = planQueueAction(action, entry.text);
    if (plan.kind === 'unknown') return;

    const liveId = this.deps.ensureLiveSessionId ? await this.deps.ensureLiveSessionId() : null;
    if (!liveId) {
      if (this.deps.setTimedDockNotice) {
        this.deps.setTimedDockNotice(this.deps.t('chat.forkNoLive'));
      }
      this.deps.requestRender();
      return;
    }

    const interactive = this.deps.interactiveService;
    const rpc = this.deps.getRpcCaller ? this.deps.getRpcCaller() : null;
    if (!interactive || !rpc) return;

    try {
      if (plan.kind === 'steer') {
        await interactive.steerQueued(rpc, liveId, admissionId, state.profileName || undefined);
      } else {
        await interactive.cancelQueued(rpc, liveId, admissionId);
      }

      this.deps.commitState({
        queuedMessages: queuedAfterAction(state.queuedMessages, admissionId) as typeof state.queuedMessages,
      });

      if (plan.kind === 'replace' && typeof document !== 'undefined') {
        const el = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
        if (el) {
          el.value = plan.restoreText;
          el.focus({ preventScroll: true });
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      this.deps.requestRender();
    } catch (err) {
      const errMsg = this.deps.describeRpcError ? this.deps.describeRpcError(err) : String(err);
      if (this.deps.setTimedDockNotice) {
        this.deps.setTimedDockNotice(`${this.deps.t('dock.queueActionFailed')}: ${errMsg}`);
      }
      this.deps.requestRender();
    }
  }

  /**
   * 执行斜杠指令分派
   */
  public async runSlashCommand(rawCommand: string): Promise<void> {
    await dispatchSlashCommand(rawCommand, {
      ensureLiveSessionId: this.deps.ensureLiveSessionId,
      getRpcCaller: this.deps.getRpcCaller,
      interactiveService: this.deps.interactiveService,
      getSlashCanon: this.deps.getSlashCanon,
      getProfileName: () => this.deps.getState().profileName || undefined,
      getActiveSessionId: () => this.deps.getState().activeSessionId,
      getSessionKind: () => deriveSessionKind(this.deps.getState().activeFocus),
      setTimedDockNotice: this.deps.setTimedDockNotice,
      requestRender: this.deps.requestRender,
      sendMessage: this.deps.sendMessage,
      reloadSessionMessages: this.deps.reloadSessionMessages,
      describeRpcError: this.deps.describeRpcError,
      t: this.deps.t,
    });
  }

  /**
   * 同步发送按钮的可用状态
   */
  public syncSendAvailability(sendBtn?: HTMLElement | null, inputEl?: HTMLTextAreaElement | null): void {
    const btn = sendBtn || (typeof document !== 'undefined' ? (document.getElementById('dock-send-btn') as HTMLButtonElement | null) : null);
    const el = inputEl || (typeof document !== 'undefined' ? (document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null) : null);
    if (!btn || !el || btn.dataset.locked === 'true') return;

    const state = this.deps.getState();
    const fullText = this.assembleDraftText(el.value);
    const badgeCount = (state.composerBadges || []).length;
    const canSend = canSendDraft({
      text: fullText,
      attachmentCount: state.attachments.length + badgeCount,
    });

    if ('disabled' in btn) {
      (btn as HTMLButtonElement).disabled = !canSend;
    }
  }

  /**
   * 同步入队按钮的显隐状态
   */
  public syncQueueButtonVisibility(queueBtn?: HTMLElement | null, inputEl?: HTMLTextAreaElement | null): void {
    const btn = queueBtn || (typeof document !== 'undefined' ? (document.getElementById('dock-queue-btn') as HTMLButtonElement | null) : null);
    const el = inputEl || (typeof document !== 'undefined' ? (document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null) : null);
    if (!btn || !el) return;

    const state = this.deps.getState();
    const fullText = this.assembleDraftText(el.value);
    const badgeCount = (state.composerBadges || []).length;
    const visible = shouldShowQueueButton({
      text: fullText,
      attachmentCount: state.attachments.length + badgeCount,
    });

    btn.hidden = !visible;
  }

  /**
   * 响应输入框的内容变更（input 事件）
   * 执行高度同步、发送/入队按钮可用性，并触发斜杠与 @ 智能引用实时联想补全
   */
  public handleInput(inputEl: HTMLTextAreaElement): void {
    if (!this.isComposing) {
      this.syncComposerHeight(inputEl);
    }
    this.syncSendAvailability(undefined, inputEl);
    this.syncQueueButtonVisibility(undefined, inputEl);

    const state = this.deps.getState();
    const textBeforeCursor = inputEl.value.slice(0, inputEl.selectionStart || inputEl.value.length);

    // 1. 斜杠命令 (/): 处于开头或空格后 → 请求 complete.slash 动态补全
    const slashMatch = /(?:^|\s)\/([a-zA-Z0-9_-]*)$/.exec(textBeforeCursor);
    if (slashMatch) {
      this.deps.commitState({ mentionPopperOpen: false });
      this.deps.requestSlashCompletion(slashMatch[1]);
      return;
    } else if (state.slashPopperOpen) {
      this.deps.commitState({ slashPopperOpen: false });
      this.deps.requestRender();
    }

    // 2. 智能引用 (@): Agent 项本地枚举 + 文件项走 complete.path 动态检索
    const mentionToken = parseMentionToken(textBeforeCursor);
    if (mentionToken) {
      const query = mentionToken.query;
      const agentItems: MentionReferenceOption[] = [];
      const isGroupChat = state.activeFocus.type === 'group';

      if (!mentionToken.isPath) {
        if (isGroupChat) {
          agentItems.push({ type: 'agent', name: 'all', detail: this.deps.t('mention.allDetail') });
          const activeRoomId = state.activeFocus.type === 'group' ? state.activeFocus.roomId : undefined;
          const currentRoom = state.groupRooms.find((r) => r.roomId === activeRoomId);
          if (currentRoom) {
            for (const member of currentRoom.members) {
              agentItems.push({ type: 'agent', name: member, detail: this.deps.t('mention.groupMember') });
            }
          }
        } else {
          const selfName = state.activeFocus.type === 'bot' ? state.activeFocus.botName : null;
          for (const p of state.profiles) {
            if (selfName && (p.name === selfName || p.displayName === selfName)) continue;
            agentItems.push({ type: 'agent', name: p.displayName || p.name, detail: p.name });
          }
        }
      }

      const filteredAgents = agentItems.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));
      this.deps.commitState({
        mentionItems: filteredAgents,
        mentionPopperOpen: filteredAgents.length > 0,
        slashPopperOpen: false,
      });
      this.deps.requestRender();
      this.deps.requestPathCompletion(query, agentItems);
      return;
    } else if (state.mentionPopperOpen) {
      this.deps.commitState({ mentionPopperOpen: false });
      this.deps.requestRender();
    }
  }

  /**
   * 键盘上下键在补全浮层中循环切换活跃选中项
   */
  public navigatePopperSelection(direction: 1 | -1): void {
    if (typeof document === 'undefined') return;
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.composer-popper .composer-popper__row'));
    if (rows.length === 0) return;
    const currentIndex = rows.findIndex((r) => r.classList.contains('is-active'));
    let nextIndex = 0;
    if (currentIndex >= 0) {
      nextIndex = (currentIndex + direction + rows.length) % rows.length;
    } else {
      nextIndex = direction === 1 ? 0 : rows.length - 1;
    }
    rows.forEach((r, idx) => {
      if (idx === nextIndex) {
        r.classList.add('is-active');
        r.scrollIntoView({ block: 'nearest' });
      } else {
        r.classList.remove('is-active');
      }
    });
  }

  /**
   * 按回车或 Tab 选定当前浮层中的高亮项
   */
  public selectActivePopperOption(inputEl?: HTMLTextAreaElement | null): boolean {
    if (typeof document === 'undefined') return false;
    const activeRow = document.querySelector<HTMLElement>('.composer-popper .composer-popper__row.is-active')
      || document.querySelector<HTMLElement>('.composer-popper .composer-popper__row');
    if (!activeRow) return false;
    return this.handleContainerClick(activeRow, inputEl);
  }

  /**
   * 清除输入框光标前刚刚键入的斜杠 token
   */
  public clearActiveSlashToken(el: HTMLTextAreaElement): void {
    const caret = el.selectionStart ?? el.value.length;
    const textBefore = el.value.slice(0, caret);
    const textAfter = el.value.slice(caret);
    const slashMatch = /(?:^|\s)\/([a-zA-Z0-9_-]*)$/.exec(textBefore);
    if (slashMatch) {
      const slashIdx = slashMatch.index + (slashMatch[0].startsWith('/') ? 0 : 1);
      const remainingBefore = el.value.slice(0, slashIdx).trimEnd();
      const remainingAfter = textAfter.trimStart();
      el.value = remainingBefore + (remainingBefore && remainingAfter ? ' ' : '') + remainingAfter;
      const newPos = remainingBefore ? remainingBefore.length + (remainingAfter ? 1 : 0) : 0;
      el.setSelectionRange(newPos, newPos);
    } else {
      el.value = '';
    }
    this.syncComposerHeight(el);
  }

  /**
   * 清除输入框光标前刚刚键入的 @token
   */
  public clearActiveMentionToken(el: HTMLTextAreaElement): void {
    const caret = el.selectionStart ?? el.value.length;
    const textBefore = el.value.slice(0, caret);
    const textAfter = el.value.slice(caret);
    const atMatch = /(?:^|\s)@([^\s]*)$/.exec(textBefore);
    if (atMatch) {
      const atIdx = atMatch.index + (atMatch[0].startsWith('@') ? 0 : 1);
      const remainingBefore = el.value.slice(0, atIdx).trimEnd();
      const remainingAfter = textAfter.trimStart();
      el.value = remainingBefore + (remainingBefore && remainingAfter ? ' ' : '') + remainingAfter;
      const newPos = remainingBefore ? remainingBefore.length + (remainingAfter ? 1 : 0) : 0;
      el.setSelectionRange(newPos, newPos);
    } else {
      el.value = '';
    }
    this.syncComposerHeight(el);
  }

  /**
   * 处理按键事件 (keydown)
   *
   * @returns 若按键已被输入舱消费并阻止默认行为则返回 true
   */
  public handleKeyDown(e: KeyboardEvent, inputEl?: HTMLTextAreaElement | null): boolean {
    const el = inputEl || (typeof document !== 'undefined' ? (document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null) : null);
    const state = this.deps.getState();

    if (e.key === 'Escape') {
      if (state.slashPopperOpen || state.mentionPopperOpen) {
        e.preventDefault();
        this.deps.commitState({
          slashPopperOpen: false,
          mentionPopperOpen: false,
        });
        this.deps.requestRender();
        return true;
      }
    }

    if (state.slashPopperOpen || state.mentionPopperOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.navigatePopperSelection(e.key === 'ArrowDown' ? 1 : -1);
        return true;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !this.isComposing) {
        const handled = this.selectActivePopperOption(el);
        if (handled) {
          e.preventDefault();
          return true;
        }
      }
    }

    if (e.key === 'Backspace' && el && el.selectionStart === 0 && el.selectionEnd === 0) {
      const badges = state.composerBadges || [];
      if (badges.length > 0) {
        e.preventDefault();
        const nextBadges = badges.slice(0, -1);
        this.deps.commitState({ composerBadges: nextBadges });
        this.syncComposerBadges();
        this.syncSendAvailability(undefined, el);
        this.syncQueueButtonVisibility(undefined, el);
        return true;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !this.isComposing) {
      if (state.slashPopperOpen || state.mentionPopperOpen) {
        this.deps.commitState({
          slashPopperOpen: false,
          mentionPopperOpen: false,
        });
      }
      e.preventDefault();
      this.handleSend('enter', el);
      return true;
    }

    return false;
  }

  /**
   * 解析并添加输入舱文件/图片附件
   */
  public async addInputAttachments(fileList: FileList | File[]): Promise<void> {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const state = this.deps.getState();
    const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
    let imgIndex = state.attachments.filter((a) => a.type === 'image').length;
    let docIndex = state.attachments.filter((a) => a.type !== 'image').length;
    const newItems: InputAttachmentItem[] = [];

    for (const file of files) {
      const isImg = file.type.startsWith('image/');
      if (isImg && file.size > MAX_IMAGE_SIZE) {
        if (this.deps.setTimedDockNotice) {
          this.deps.setTimedDockNotice(this.deps.t('dock.imageTooLarge'));
        }
        continue;
      }

      if (isImg) {
        imgIndex++;
        const dataUrl = await new Promise<string>((resolve) => {
          if (typeof FileReader === 'undefined') {
            resolve('');
            return;
          }
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string) || '');
          reader.onerror = () => resolve('');
          reader.readAsDataURL(file);
        });

        newItems.push({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: file.name || `image_${imgIndex}.png`,
          label: `Image ${imgIndex}`,
          type: 'image',
          previewUrl: dataUrl,
          sizeBytes: file.size,
        });
      } else {
        docIndex++;
        newItems.push({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: file.name,
          label: `Doc ${docIndex}`,
          type: file.name.endsWith('.pdf') ? 'pdf' : 'file',
          sizeBytes: file.size,
        });
      }
    }

    if (newItems.length > 0) {
      this.deps.commitState({
        attachments: [...state.attachments, ...newItems],
      });
      this.deps.requestRender();
    }
  }

  /**
   * 处理输入舱容器的事件委托（包含通知关闭、回滚取消、队列操作、附件移除与联想补全项点击）
   */
  public handleContainerClick(target: HTMLElement, inputEl?: HTMLTextAreaElement | null): boolean {
    const el = inputEl || (typeof document !== 'undefined' ? (document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null) : null);

    // 0. 移除前置 Token 徽章
    const removeBadgeBtn = target.closest<HTMLElement>('[data-action="remove-badge"]');
    if (removeBadgeBtn) {
      const badgeId = removeBadgeBtn.getAttribute('data-badge-id');
      if (badgeId) {
        const state = this.deps.getState();
        const nextBadges = (state.composerBadges || []).filter((b) => b.id !== badgeId);
        this.deps.commitState({ composerBadges: nextBadges });
        this.syncComposerBadges();
        this.syncSendAvailability(undefined, el);
        this.syncQueueButtonVisibility(undefined, el);
        el?.focus();
        return true;
      }
    }

    // 1. 回滚取消
    const cancelAction = target.closest<HTMLElement>('[data-action="rollback-cancel"]');
    if (cancelAction) {
      this.deps.handleRollbackCancel();
      return true;
    }

    // 2. 队列操作
    const queueAction = target.closest<HTMLElement>('.queue-action-btn');
    if (queueAction) {
      const admissionId = queueAction.dataset.queueId || '';
      const action = queueAction.dataset.action || '';
      if (admissionId) {
        void this.handleQueueAction(action, admissionId);
        return true;
      }
    }

    // 3. 移除附件
    const removeBtn = target.closest<HTMLElement>('.btn-remove-attachment');
    if (removeBtn) {
      const attId = removeBtn.getAttribute('data-att-id');
      if (attId) {
        const state = this.deps.getState();
        this.deps.commitState({
          attachments: state.attachments.filter((a) => a.id !== attId),
        });
        this.deps.requestRender();
        return true;
      }
    }

    // 4. 斜杠命令项点击
    const slashOption = target.closest<HTMLElement>('.slash-item-option');
    if (slashOption && el) {
      const cmd = slashOption.getAttribute('data-command') || '';
      const isSkill = slashOption.getAttribute('data-is-skill') === 'true';
      if (cmd) {
        const state = this.deps.getState();
        const existingBadges = state.composerBadges || [];
        if (isSkill) {
          const skillName = cmd.replace(/^\//, '');
          const newBadge: ComposerBadgeItem = {
            id: `badge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'skill',
            name: skillName,
            rawText: cmd,
          };
          this.deps.commitState({
            composerBadges: [...existingBadges, newBadge],
            slashPopperOpen: false,
          });
        } else {
          const commandBadge: ComposerBadgeItem = {
            id: `badge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'command',
            name: cmd.startsWith('/') ? cmd : `/${cmd}`,
            rawText: cmd.startsWith('/') ? cmd : `/${cmd}`,
          };
          const nonCmdBadges = existingBadges.filter((b) => b.type !== 'command');
          this.deps.commitState({
            composerBadges: [commandBadge, ...nonCmdBadges],
            slashPopperOpen: false,
          });
        }
        this.clearActiveSlashToken(el);
        this.syncComposerBadges();
        this.syncComposerPoppers();
        this.syncSendAvailability(undefined, el);
        this.syncQueueButtonVisibility(undefined, el);
        el.focus();
        return true;
      }
    }

    // 5. 智能引用项点击
    const mentionOption = target.closest<HTMLElement>('.mention-item-option');
    if (mentionOption && el) {
      const mention = mentionOption.getAttribute('data-mention') || '';
      const mtype = mentionOption.getAttribute('data-type') || 'agent';
      if (mention) {
        const state = this.deps.getState();
        const existingBadges = state.composerBadges || [];
        const isFile = mtype === 'file';
        const basename = isFile ? (mention.split(/[/\\]/).pop() || mention) : mention;
        const newBadge: ComposerBadgeItem = {
          id: `badge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: isFile ? 'file' : 'agent',
          name: basename,
          path: isFile ? mention : undefined,
          rawText: `@${mention}`,
        };
        this.deps.commitState({
          composerBadges: [...existingBadges, newBadge],
          mentionPopperOpen: false,
          ...(isFile ? {} : { pickedMention: { profile: mention, token: `@${mention}` } }),
        });
        this.clearActiveMentionToken(el);
        this.syncComposerBadges();
        this.syncComposerPoppers();
        this.syncSendAvailability(undefined, el);
        this.syncQueueButtonVisibility(undefined, el);
        el.focus();
        return true;
      }
    }

    // 6. 点击输入区空白处（包括徽章空白间隙）自动聚焦输入框
    const inlineArea = target.closest<HTMLElement>('.composer-dock__inline-area');
    if (inlineArea && !target.closest('button') && !target.closest('.composer-badge-pill') && !target.closest('.composer-badge-command')) {
      el?.focus();
      return true;
    }

    return false;
  }

  /**
   * 模型搜索清空与展开对齐
   */
  public resetModelSearchOnOpen(): void {
    this.deps.commitState({ modelSearchQuery: '' });
    this.deps.onModelMenuStateChange?.(true);
    this.updateModelDropdownSubtree();
  }

  /**
   * 关闭模型选择菜单
   */
  public closeModelMenu(): void {
    this.modelCascadeManager.hide();
    this.deps.commitState({ modelMenuOpen: false });
    if (typeof document !== 'undefined') {
      const dropdown = document.getElementById('dock-model-dropdown');
      if (dropdown) dropdown.style.display = 'none';
      const trigger = document.getElementById('dock-model-selector-btn');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
    this.deps.onModelMenuStateChange?.(false);
    this.deps.requestRender();
  }

  /**
   * 重建并更新模型选择下拉子树
   */
  public updateModelDropdownSubtree(): void {
    if (typeof document === 'undefined') return;
    const scrollList = document.getElementById('model-picker-scroll-list');
    if (!scrollList) return;
    const state = this.deps.getState();
    scrollList.innerHTML = renderModelPickerTree({
      selectedModel: state.selectedModel,
      models: state.availableModels,
      modelDetails: state.modelDetails,
      modelCatalog: state.modelCatalog,
      currentProvider: state.currentProvider,
      favoriteModels: state.favoriteModels,
      recentModels: state.recentModels,
      modelSearchQuery: state.modelSearchQuery,
      collapsedProviders: state.collapsedProviders,
      reasoningLevel: state.reasoningLevel,
      approvalMode: state.approvalMode,
      isStreaming: state.isStreaming,
    });
    this.bindModelDropdownEvents();
  }

  /**
   * 应用某个思考等级
   */
  public pickReasoningLevel(item: HTMLElement): void {
    const LEVELS: ReadonlySet<string> = new Set(['default', 'none', 'low', 'high', 'max']);
    const raw = item.getAttribute('data-level');
    if (!raw || !LEVELS.has(raw)) return;
    const level = raw as AppState['reasoningLevel'];
    const state = this.deps.getState();
    const returnToModel = state.modelCascadeModel ?? null;

    this.modelCascadeManager.armSuppression(null, 600);
    this.modelCascadeManager.hide();
    if (this.deps.switchReasoning) {
      void this.deps.switchReasoning(level);
    }

    if (returnToModel && typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        if (typeof document !== 'undefined') {
          const row = document.querySelector<HTMLElement>(`.model-option[data-model="${CSS.escape(returnToModel)}"]`);
          row?.focus({ preventScroll: true });
        }
      });
    }
  }

  /**
   * 绑定模型下拉菜单各选项与思考等级事件
   */
  public bindModelDropdownEvents(): void {
    if (typeof document === 'undefined') return;

    // 1. 搜索框
    const modelSearchInput = document.getElementById('dock-model-search-input') as HTMLInputElement | null;
    if (modelSearchInput) {
      modelSearchInput.onclick = (e) => e.stopPropagation();
      modelSearchInput.oninput = (e) => {
        e.stopPropagation();
        this.deps.commitState({ modelSearchQuery: (e.target as HTMLInputElement).value });
        this.updateModelDropdownSubtree();
      };
    }

    // 2. 收藏切换
    const state = this.deps.getState();
    document.querySelectorAll('.btn-toggle-favorite').forEach((btn) => {
      const el = btn as HTMLElement;
      el.onclick = (e) => {
        e.stopPropagation();
        const modelId = el.getAttribute('data-model');
        if (modelId) {
          let updatedFavs: string[];
          if (state.favoriteModels.includes(modelId)) {
            updatedFavs = state.favoriteModels.filter((m) => m !== modelId);
          } else {
            updatedFavs = [...state.favoriteModels, modelId];
          }
          this.deps.commitState({ favoriteModels: updatedFavs });
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('hermes_flux_fav_models', JSON.stringify(updatedFavs));
            localStorage.setItem('hermes_aura_fav_models', JSON.stringify(updatedFavs));
          }
          this.updateModelDropdownSubtree();
        }
      };
    });

    // 3. 滚动收起级联
    const scrollList = document.getElementById('model-picker-scroll-list');
    if (scrollList && !scrollList.dataset.cascadeScrollBound) {
      scrollList.dataset.cascadeScrollBound = 'true';
      scrollList.addEventListener('scroll', () => this.modelCascadeManager.hide(), { passive: true });
    }

    // 4. Provider 分组折叠
    document.querySelectorAll('.model-provider-group-header').forEach((header) => {
      const el = header as HTMLElement;
      const toggle = () => {
        if (el.getAttribute('data-search-open') === 'true') return;
        const slug = el.getAttribute('data-provider');
        if (!slug) return;
        const collapsed = [...state.collapsedProviders];
        const idx = collapsed.indexOf(slug);
        if (idx >= 0) collapsed.splice(idx, 1);
        else collapsed.push(slug);
        this.deps.commitState({ collapsedProviders: collapsed });
        this.modelCascadeManager.hide();
        this.updateModelDropdownSubtree();
      };
      el.onclick = (e) => {
        e.stopPropagation();
        toggle();
      };
      el.onkeydown = (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        toggle();
      };
    });

    // 5. 模型行点击与级联
    document.querySelectorAll('.model-option').forEach((opt) => {
      const el = opt as HTMLElement;
      el.onclick = (e) => {
        e.stopPropagation();
        if (el.dataset.locked === 'true') return;
        const model = el.getAttribute('data-model');
        const provider = el.getAttribute('data-provider') || undefined;
        this.modelCascadeManager.hide();
        this.deps.commitState({ modelMenuOpen: false });
        if (model && this.deps.switchModel) {
          void this.deps.switchModel(model, provider);
        } else {
          this.deps.requestRender();
        }
      };
      el.onmouseenter = () => {
        if (el.dataset.locked === 'true') return;
        this.modelCascadeManager.show(el);
      };
      el.onmouseleave = () => {
        this.modelCascadeManager.scheduleHide();
      };
      el.onfocus = () => {
        if (el.dataset.locked === 'true') return;
        this.modelCascadeManager.show(el);
      };
      el.onblur = () => {
        const ownerModel = el.getAttribute('data-model') || undefined;
        if (typeof window !== 'undefined') {
          window.setTimeout(() => {
            const cascade = document.getElementById('model-reasoning-cascade');
            if (cascade && cascade.contains(document.activeElement)) return;
            if (this.deps.getState().modelCascadeModel !== ownerModel) return;
            this.modelCascadeManager.scheduleHide();
          }, 0);
        }
      };
      el.onkeydown = (e) => {
        if (e.key === 'ArrowRight') {
          if (el.dataset.locked === 'true') return;
          const cascade = document.getElementById('model-reasoning-cascade');
          const first = cascade?.querySelector<HTMLElement>('.model-cascade__item');
          if (first) {
            e.preventDefault();
            e.stopPropagation();
            this.modelCascadeManager.show(el);
            first.focus();
          }
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          el.click();
          return;
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
        e.preventDefault();
        const rows = [...document.querySelectorAll<HTMLElement>('.model-option')].filter((r) => r.offsetParent !== null);
        const current = rows.indexOf(el);
        if (current < 0) return;
        const next =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? rows.length - 1
              : e.key === 'ArrowDown'
                ? Math.min(rows.length - 1, current + 1)
                : Math.max(0, current - 1);
        rows[next]?.focus();
      };
    });

    // 6. 二级级联内部事件
    const cascade = document.getElementById('model-reasoning-cascade');
    if (cascade) {
      cascade.onmouseenter = () => this.modelCascadeManager.cancelHide();
      cascade.onmouseleave = () => this.modelCascadeManager.scheduleHide();
      const items = [...cascade.querySelectorAll<HTMLElement>('.model-cascade__item')];
      items.forEach((el, index) => {
        el.onclick = (e) => {
          e.stopPropagation();
          this.pickReasoningLevel(el);
        };
        el.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            this.pickReasoningLevel(el);
            return;
          }
          if (e.key === 'Escape' || e.key === 'ArrowLeft') {
            e.preventDefault();
            e.stopPropagation();
            const currModel = this.deps.getState().modelCascadeModel;
            if (currModel) {
              this.modelCascadeManager.armSuppression(currModel, 400);
            }
            this.modelCascadeManager.hide();
            if (currModel) {
              document.querySelector<HTMLElement>(`.model-option[data-model="${CSS.escape(currModel)}"]`)?.focus({
                preventScroll: true,
              });
            }
            return;
          }
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
          e.preventDefault();
          const next =
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? items.length - 1
                : e.key === 'ArrowDown'
                  ? Math.min(items.length - 1, index + 1)
                  : Math.max(0, index - 1);
          items[next]?.focus();
        };
      });
    }
  }

  /**
   * 绑定审批模式下拉菜单
   */
  public bindApprovalDropdownEvents(): void {
    if (typeof document === 'undefined') return;
    const approvalBtn = document.getElementById('dock-approval-toggle-btn');
    const approvalDropdown = document.getElementById('dock-approval-dropdown');
    if (approvalBtn && approvalDropdown) {
      approvalBtn.onclick = (e) => {
        e.stopPropagation();
        const isOpen = approvalDropdown.style.display === 'block';
        approvalDropdown.style.display = isOpen ? 'none' : 'block';
        approvalBtn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      };
      approvalDropdown.querySelectorAll<HTMLElement>('.composer-approval-option').forEach((opt) => {
        opt.onclick = (e) => {
          e.stopPropagation();
          const mode = opt.dataset.mode as AppState['approvalMode'] | undefined;
          approvalDropdown.style.display = 'none';
          approvalBtn.setAttribute('aria-expanded', 'false');
          if (mode && this.deps.switchApproval) {
            void this.deps.switchApproval(mode);
          }
        };
      });
    }
  }

  /**
   * 处理全局 pointerdown 外部点击收起模型选择菜单
   */
  public handlePointerDownOutside(target: Node | null): void {
    const state = this.deps.getState();
    if (!state.modelMenuOpen || !target || typeof document === 'undefined') return;
    const dropdown = document.getElementById('dock-model-dropdown');
    const trigger = document.getElementById('dock-model-selector-btn');
    const cascade = document.getElementById('model-reasoning-cascade');
    if (dropdown?.contains(target) || trigger?.contains(target) || cascade?.contains(target)) return;
    this.closeModelMenu();
  }

  /**
   * 处理全局 mousedown 外部点击收起审批下拉与联想 popper
   */
  public handleMouseDownOutside(target: Node | null): void {
    if (!target || typeof document === 'undefined') return;

    // 审批下拉关闭
    const approvalDropdown = document.getElementById('dock-approval-dropdown');
    const approvalBtn = document.getElementById('dock-approval-toggle-btn');
    if (approvalDropdown && approvalDropdown.style.display === 'block') {
      if (!approvalDropdown.contains(target) && !approvalBtn?.contains(target)) {
        approvalDropdown.style.display = 'none';
      }
    }

    // 联想浮层关闭
    const state = this.deps.getState();
    if (state.slashPopperOpen || state.mentionPopperOpen) {
      const popper = document.querySelector('.composer-popper');
      const dock = document.querySelector('.input-dock-container');
      const insidePopper = popper ? popper.contains(target) : false;
      const insideDock = dock ? dock.contains(target) : false;
      if (!insidePopper && !insideDock) {
        this.deps.commitState({
          slashPopperOpen: false,
          mentionPopperOpen: false,
        });
        this.deps.requestRender();
      }
    }
  }

  /**
   * 绑定所有输入舱 DOM 节点事件
   */
  public bindDomEvents(doc: Document = document): void {
    // 1. 横幅提示关闭
    const noticeCloseBtn = doc.getElementById('dock-notice-close');
    if (noticeCloseBtn) {
      noticeCloseBtn.onclick = () => {
        this.deps.commitState({ dockNotice: '' });
        if (this.deps.clearDockNoticeDismissTimer) {
          this.deps.clearDockNoticeDismissTimer();
        }
        this.deps.requestRender();
      };
    }

    // 2. 发送、入队与停止按钮及输入框
    const sendBtn = doc.getElementById('dock-send-btn') as HTMLButtonElement | null;
    const queueBtn = doc.getElementById('dock-queue-btn') as HTMLButtonElement | null;
    const stopBtn = doc.getElementById('dock-stop-btn') as HTMLButtonElement | null;
    const inputEl = doc.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;

    if (sendBtn) sendBtn.onclick = () => this.handleSend('button', inputEl);
    if (queueBtn) queueBtn.onclick = () => { void this.enqueueDraft(); };
    if (stopBtn) stopBtn.onclick = () => { void this.deps.interruptTurn(); };

    // 3. 容器事件委托（回滚取消、队列操作、Token 移除与补全项选择）
    const dockContainer = doc.querySelector<HTMLElement>('.input-dock-container');
    if (dockContainer && !dockContainer.dataset.dockClickBound) {
      dockContainer.dataset.dockClickBound = 'true';
      dockContainer.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const handled = this.handleContainerClick(target, inputEl);
        if (handled) {
          e.stopPropagation();
          e.preventDefault();
        }
      });
    }

    // 4. 输入框状态与监听绑定
    this.syncSendAvailability(sendBtn, inputEl);
    this.syncComposerHeight(inputEl);
    this.syncQueueButtonVisibility(queueBtn, inputEl);

    if (inputEl && inputEl.dataset.dockEventsBound !== 'true') {
      inputEl.dataset.dockEventsBound = 'true';

      inputEl.addEventListener('compositionstart', () => {
        this.setIsComposing(true);
      });
      inputEl.addEventListener('compositionend', () => {
        this.setIsComposing(false);
        this.syncComposerHeight(inputEl);
      });

      inputEl.addEventListener('input', () => {
        this.handleInput(inputEl);
      });

      inputEl.addEventListener('paste', (e) => {
        const files = e.clipboardData?.files;
        if (files && files.length > 0) {
          e.preventDefault();
          void this.addInputAttachments(files);
        }
      });

      inputEl.onkeydown = (e) => {
        this.handleKeyDown(e, inputEl);
      };
    }

    // 5. 拖拽添加文件
    if (dockContainer && dockContainer.dataset.dragBound !== 'true') {
      dockContainer.dataset.dragBound = 'true';
      dockContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      dockContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
          void this.addInputAttachments(files);
        }
      });
    }

    // 7. 底部模型选择器与刷新按钮
    const modelBtn = doc.getElementById('dock-model-selector-btn');
    const refreshModelBtn = doc.getElementById('btn-refresh-models');

    if (refreshModelBtn) {
      refreshModelBtn.onclick = (e) => {
        e.stopPropagation();
        if (this.deps.fetchModelOptions) {
          void this.deps.fetchModelOptions();
        }
      };
    }

    if (modelBtn) {
      modelBtn.onclick = (e) => {
        e.stopPropagation();
        const dropdown = doc.getElementById('dock-model-dropdown');
        if (!dropdown) return;
        const state = this.deps.getState();
        const nextOpen = !state.modelMenuOpen;
        this.deps.commitState({ modelMenuOpen: nextOpen });
        dropdown.style.display = nextOpen ? 'block' : 'none';
        modelBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        this.deps.onModelMenuStateChange?.(nextOpen);

        if (nextOpen) {
          this.resetModelSearchOnOpen();
          if (state.availableModels.length === 0 && this.deps.fetchModelOptions) {
            void this.deps.fetchModelOptions();
          }
          const search = doc.getElementById('dock-model-search-input') as HTMLInputElement | null;
          if (search) {
            search.value = '';
            search.focus();
          }
        } else {
          this.modelCascadeManager.hide();
        }
      };
    }

    // 8. 模型下拉选项与级联
    this.bindModelDropdownEvents();

    // 9. 审批模式下拉
    this.bindApprovalDropdownEvents();
  }

  /**
   * 生成输入舱的完整 HTML 模板
   */
  public buildDockHtml(hasDraft: boolean): string {
    const state = this.deps.getState();
    if (!state.gatewayConnected) return '';
    return renderInputDock({
      selectedModel: state.selectedModel,
      models: state.availableModels,
      modelDetails: state.modelDetails,
      modelCatalog: state.modelCatalog,
      currentProvider: state.currentProvider,
      favoriteModels: state.favoriteModels,
      recentModels: state.recentModels,
      modelSearchQuery: state.modelSearchQuery,
      collapsedProviders: state.collapsedProviders,
      reasoningLevel: state.reasoningLevel,
      approvalMode: state.approvalMode,
      isStreaming: this.deps.isStreamingActiveForCurrentSession(),
      hasDraft,
      disabled: !state.gatewayConnected,
      modelMenuOpen: state.modelMenuOpen,
      notice: state.dockNotice,
      attachments: state.attachments,
      badges: state.composerBadges,
      queuedMessages: state.queuedMessages,
      slashPopperOpen: state.slashPopperOpen,
      slashItems: state.slashItems,
      mentionPopperOpen: state.mentionPopperOpen,
      mentionItems: state.mentionItems,
      rollbackBanner: state.rollbackArmed
        ? { removedCount: state.rollbackArmed.removedCount, anchorLabel: state.rollbackArmed.anchorLabel }
        : null,
    });
  }

  /**
   * 构建当前输入舱的状态快照（用于增量重绘对比）
   */
  public buildDockSnapshot(): RenderInputDockSnapshot {
    const state = this.deps.getState();
    return {
      selectedModel: state.selectedModel,
      currentProvider: state.currentProvider,
      reasoningLevel: state.reasoningLevel,
      approvalMode: state.approvalMode,
      isStreaming: this.deps.isStreamingActiveForCurrentSession(),
      disabled: !state.gatewayConnected,
      modelMenuOpen: state.modelMenuOpen,
      notice: state.dockNotice,
      modelCount: state.availableModels.length,
      modelCatalogHash: state.modelCatalogHash,
      modelSearchQuery: state.modelSearchQuery,
      recentModelsHash: state.recentModels?.join(',') ?? '',
      favoriteModelsHash: state.favoriteModels?.join(',') ?? '',
      attachmentsCount: state.attachments?.length ?? 0,
      attachmentsHash: state.attachments?.map((a) => `${a.id}:${a.name}`).join(',') ?? '',
      queuedHash: state.queuedMessages?.map((q) => `${q.admissionId}:${q.text}`).join('|') ?? '',
      rollbackArmedHash: state.rollbackArmed
        ? `${state.rollbackArmed.targetId}:${state.rollbackArmed.removedCount}`
        : '',
    };
  }

  /**
   * 局部增量更新输入舱 DOM（保护 textarea 与选区不被整舱摧毁）
   *
   * @returns 更新后的新快照
   */
  public updateDock(
    root: HTMLElement,
    hasDraft: boolean,
    lastSnapshot: RenderInputDockSnapshot | null
  ): RenderInputDockSnapshot | null {
    if (typeof document === 'undefined') return lastSnapshot;

    const state = this.deps.getState();
    const existingDock = root.querySelector('.input-dock-container');
    const currentSnapshot = this.buildDockSnapshot();
    const dockChanged = hasDockSnapshotChanged(lastSnapshot, currentSnapshot);
    const shouldBuildDock = state.gatewayConnected && (!existingDock || dockChanged);
    const nextDockHtml = shouldBuildDock ? this.buildDockHtml(hasDraft) : '';

    if (existingDock) {
      if (!state.gatewayConnected) {
        existingDock.remove();
        return null;
      } else if (dockChanged && nextDockHtml) {
        existingDock.outerHTML = nextDockHtml;
        return currentSnapshot;
      }
    } else if (nextDockHtml) {
      const middlePod = root.querySelector('.flux-middle-pod');
      if (middlePod) middlePod.insertAdjacentHTML('beforeend', nextDockHtml);
      return currentSnapshot;
    }

    return lastSnapshot;
  }

  /**
   * 斜杠与智能引用 Popper 的独立子树同步
   */
  public syncComposerPoppers(): void {
    if (typeof document === 'undefined') return;
    const mount = document.getElementById('composer-popper-mount');
    if (!mount) return;
    const state = this.deps.getState();
    mount.innerHTML =
      renderSlashPopper(state.slashItems, state.slashPopperOpen) +
      renderMentionPopper(state.mentionItems, state.mentionPopperOpen);
  }

  /**
   * 输入舱 Token 徽章的独立子树同步
   */
  public syncComposerBadges(): void {
    if (typeof document === 'undefined') return;
    const mount = document.getElementById('dock-badges-mount');
    const inputEl = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
    const state = this.deps.getState();
    const badges = state.composerBadges || [];
    if (mount) {
      mount.innerHTML = renderComposerBadges(badges);
    }
    if (inputEl) {
      const defaultPlaceholder = !state.gatewayConnected ? this.deps.t('dock.placeholderDisabled') : this.deps.t('dock.placeholder');
      inputEl.placeholder = badges.length > 0 ? '' : defaultPlaceholder;
    }
  }

  /**
   * 稳健聚焦输入框并恢复光标（双阶 rAF 兜底）
   */
  public restoreComposerFocus(desktopApi?: { activateWindow?: () => Promise<unknown> }): void {
    const restore = () => {
      if (desktopApi?.activateWindow) {
        void desktopApi.activateWindow().catch(() => {});
      }
      if (typeof document === 'undefined') return;
      const input = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
      if (input) {
        if (typeof window !== 'undefined' && typeof window.focus === 'function') {
          window.focus();
        }
        input.focus({ preventScroll: true });
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    };

    restore();
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        restore();
        requestAnimationFrame(restore);
      });
    }
    if (typeof setTimeout !== 'undefined') {
      setTimeout(restore, 50);
    }
  }

  /**
   * 恢复输入框草稿文本与光标选区
   */
  public restoreInputDraftAndCaret(
    draftText: string,
    caretStart: number,
    caretEnd: number,
    inputHadFocus: boolean
  ): void {
    if (typeof document === 'undefined') return;
    const newInput = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
    if (newInput) {
      if (draftText && newInput.value !== draftText) newInput.value = draftText;
      if (inputHadFocus) {
        newInput.focus({ preventScroll: true });
        const max = newInput.value.length;
        newInput.setSelectionRange(Math.min(caretStart, max), Math.min(caretEnd, max));
      }
    }
  }
}

export function createInputDockController(deps: InputDockControllerDeps): InputDockController {
  return new InputDockController(deps);
}
