/**
 * Hermes Flux 全局模态弹窗与右键菜单交互控制器（Modal Interaction Domain）
 *
 * 【设计意图 (Why)】
 *   将二次确认弹窗（confirmModal）、新建会话/群聊弹窗（newTaskModal）与
 *   会话树右键上下文菜单（sessionContextMenu）的动作编排与状态生命周期彻底从 index.ts 中抽离。
 *   使得复杂的弹窗按键响应（Esc / Enter 拦截）、Tab 切换、成员收集与异步 RPC 发起
 *   可脱离真实 DOM 进行纯逻辑单测，同时防范多弹窗并发冲突。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 确认弹窗关闭时若未先将 state.confirmModal 置为 undefined 再触发回调，
 *      在回调内部若再弹新窗会导致前窗状态被意外覆盖或死循环；
 *   2. 取消时必须调用 restoreComposerFocus()，否则焦点逃逸至 body 破坏全键盘可达性；
 *   3. 新建群聊成员若不足 2 人需兜底当前所选 Agent 与 'default'，防止网关返回空群聊错误；
 *   4. 解散群聊必须先弹出二次危险确认（isDanger: true），严禁静默直接解散。
 *
 * 【约束与规则 (Rules)】
 *   1. 单向依赖：严禁反向 import index.ts，所有外部能力与全局状态通过 Deps 依赖注入；
 *   2. 严格类型约束：0 TS 报错，严禁使用 `as any`；
 *   3. 零纯文本写死：所有提示与错误通知必须通过 `deps.t` 国际化字典输出。
 */

import {
  type ContextMenuProps,
  type I18nKey,
  renderNewTaskModal,
  renderConfirmModal,
  renderContextMenu,
} from '@hermes-flux/ui';
import type { AppState } from '../state/appState.js';

export interface ModalInteractionDeps {
  readonly getState: () => AppState;
  readonly commitState: (patch: Partial<AppState>) => void;
  readonly requestRender: () => void;
  readonly restoreComposerFocus: () => void;
  readonly showToast?: (msg: string) => void;
  readonly createNewSession: (options: { profile?: string; projectId?: string; title?: string }) => Promise<void>;
  readonly deleteSession: (id: string) => Promise<void>;
  readonly renameSession: (id: string, title: string) => Promise<void>;
  readonly pinSession: (id: string) => Promise<void>;
  readonly archiveSession: (id: string) => Promise<void>;
  readonly exportMarkdown: (id: string) => Promise<void>;
  readonly copySessionId: (id: string) => Promise<void>;
  readonly openBotChat: (profile: string) => Promise<void> | void;
  readonly openBotSettings: (profile: string) => void;
  readonly openGroupRoom: (roomId: string) => Promise<void>;
  readonly createGroupRoom: (title: string, members: string[]) => Promise<{ room_id?: string; room?: { room_id?: string } }>;
  readonly disbandGroupRoom: (roomId: string) => Promise<void>;
  readonly fetchGroupRooms: () => Promise<void>;
  readonly t: (key: I18nKey, params?: Record<string, string | number>) => string;
}

export interface SubmitTaskModalInput {
  title?: string;
  projectId?: string;
  members?: string[];
}

export class ModalInteractionController {
  private activeModalTab: 'solo' | 'group' = 'solo';
  private selectedModalAgent = 'default';

  constructor(private readonly deps: ModalInteractionDeps) {
    const state = this.deps.getState();
    this.activeModalTab = state.newTaskModalTab || 'solo';
    this.selectedModalAgent = state.profileName || 'default';
  }

  /** 获取当前新建任务弹窗的激活 Tab */
  public getActiveModalTab(): 'solo' | 'group' {
    return this.activeModalTab;
  }

  /** 设置当前新建任务弹窗的激活 Tab */
  public setModalTab(tab: 'solo' | 'group'): void {
    this.activeModalTab = tab;
    this.deps.commitState({ newTaskModalTab: tab });
  }

  /** 获取当前新建任务弹窗选中的 Agent */
  public getSelectedAgent(): string {
    return this.selectedModalAgent;
  }

  /** 设置当前新建任务弹窗选中的 Agent */
  public setSelectedAgent(agent: string): void {
    this.selectedModalAgent = agent || 'default';
  }

  /**
   * 关闭二次确认模态窗并触发对应动作
   *
   * @param action 'ok' 代表点击确认，'cancel' 代表取消或点击遮罩关闭
   */
  public closeConfirmModal(action: 'ok' | 'cancel'): void {
    const state = this.deps.getState();
    const modal = state.confirmModal;
    this.deps.commitState({ confirmModal: undefined });
    this.deps.requestRender();

    if (action === 'ok' && modal?.onConfirm) {
      void modal.onConfirm();
    } else if (action === 'cancel') {
      if (modal?.onCancel) {
        modal.onCancel();
      } else {
        this.deps.restoreComposerFocus();
      }
    }
  }

  /**
   * 处理全局 Escape 按键对模态弹窗的响应
   * @returns 若确认弹窗被关闭则返回 true，否则返回 false
   */
  public handleGlobalEscape(): boolean {
    const state = this.deps.getState();
    if (state.confirmModal) {
      this.closeConfirmModal('cancel');
      return true;
    }
    return false;
  }

  /**
   * 处理全局 Enter 按键对确认弹窗的响应
   * @returns 若确认弹窗被确认则返回 true，否则返回 false
   */
  public handleGlobalEnter(): boolean {
    const state = this.deps.getState();
    if (state.confirmModal) {
      this.closeConfirmModal('ok');
      return true;
    }
    return false;
  }

  /**
   * 关闭新建任务/群聊弹窗
   */
  public closeTaskModal(): void {
    this.deps.commitState({ isNewTaskModalOpen: false });
    this.deps.requestRender();
  }

  /**
   * 提交新建任务/群聊弹窗
   *
   * @param input 若外部已提取则传入，否则支持在浏览器环境下从 DOM 提取
   */
  public async submitTaskModal(input?: SubmitTaskModalInput): Promise<void> {
    const state = this.deps.getState();
    this.deps.commitState({ isNewTaskModalOpen: false });

    let titleInput = input?.title?.trim();
    let projSelect = input?.projectId;
    let explicitMembers = input?.members;

    // 无头测试或纯调用模式下如果未传参且处于 DOM 环境，尝试自动抓取
    if (titleInput === undefined && typeof document !== 'undefined') {
      const titleEl = document.getElementById('modal-task-title-input');
      if (titleEl && 'value' in titleEl && typeof titleEl.value === 'string') {
        titleInput = titleEl.value.trim();
      }
    }

    if (projSelect === undefined && typeof document !== 'undefined') {
      const projEl = document.getElementById('modal-project-select');
      if (projEl && 'value' in projEl && typeof projEl.value === 'string') {
        projSelect = projEl.value;
      }
    }

    if (this.activeModalTab === 'solo') {
      const selectedAgent = this.selectedModalAgent || state.profileName || 'default';
      await this.deps.createNewSession({
        profile: selectedAgent,
        projectId: projSelect || undefined,
        title: titleInput || this.deps.t('chat.defaultTaskTitle'),
      });
    } else {
      let members: string[] = [];
      if (explicitMembers && explicitMembers.length > 0) {
        members = [...explicitMembers];
      } else if (typeof document !== 'undefined') {
        const checkedElements = document.querySelectorAll('.modal-group-member-checkbox:checked');
        checkedElements.forEach((cb) => {
          if ('value' in cb && typeof cb.value === 'string' && cb.value) {
            members.push(cb.value);
          }
        });
      }

      const finalMembers =
        members.length >= 2
          ? members
          : [this.selectedModalAgent || state.profileName || 'default', 'default'];

      try {
        const room = await this.deps.createGroupRoom(
          titleInput || this.deps.t('chat.defaultGroupTitle'),
          finalMembers,
        );
        await this.deps.fetchGroupRooms();
        const roomId = room?.room?.room_id || room?.room_id || '';
        if (roomId) {
          await this.deps.openGroupRoom(roomId);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.deps.commitState({
          dockNotice: this.deps.t('dock.createGroupFailed', { error: errorMessage }),
        });
        this.deps.requestRender();
      }
    }
  }

  /**
   * 处理会话/群聊/Bot 右键上下文菜单动作分发
   *
   * @param action 菜单项的 data-action
   * @param explicitCtx 可选的上下文快照，未传则读取当前 state.sessionContextMenu
   */
  public handleContextMenuAction(action: string, explicitCtx?: ContextMenuProps | null): void {
    const state = this.deps.getState();
    const ctx = explicitCtx || state.sessionContextMenu;
    this.deps.commitState({ sessionContextMenu: undefined });
    this.deps.requestRender();

    if (!ctx) return;

    if (action === 'bot-chat') {
      void this.deps.openBotChat(ctx.targetId);
    } else if (action === 'bot-edit') {
      this.deps.openBotSettings(ctx.targetId);
    } else if (action === 'group-rename') {
      this.deps.commitState({ editingGroupRoomId: ctx.targetId });
      this.deps.requestRender();
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          if (typeof document !== 'undefined') {
            const inputEl = document.getElementById(`rail-group-rename-input-${ctx.targetId}`);
            if (inputEl && 'focus' in inputEl && typeof inputEl.focus === 'function') {
              inputEl.focus();
              if ('select' in inputEl && typeof (inputEl as { select: () => void }).select === 'function') {
                (inputEl as { select: () => void }).select();
              }
            }
          }
        }, 40);
      }
    } else if (action === 'disband-group') {
      this.deps.commitState({
        confirmModal: {
          title: this.deps.t('ctx.disbandGroupTitle'),
          message: this.deps.t('ctx.confirmDisbandGroup', { name: ctx.targetName }),
          confirmLabel: this.deps.t('ctx.disbandGroup'),
          cancelLabel: this.deps.t('common.cancel'),
          isDanger: true,
          onConfirm: () => {
            this.deps.restoreComposerFocus();
            void this.deps.disbandGroupRoom(ctx.targetId).catch((err: unknown) => {
              const errorMessage = err instanceof Error ? err.message : String(err);
              this.deps.commitState({
                dockNotice: this.deps.t('ctx.disbandGroupFailed', { error: errorMessage }),
              });
              this.deps.requestRender();
            });
          },
          onCancel: () => {
            this.deps.restoreComposerFocus();
          },
        },
      });
      this.deps.requestRender();
    } else if (action === 'rename') {
      void this.deps.renameSession(ctx.targetId, ctx.targetName);
    } else if (action === 'copy-id') {
      void this.deps.copySessionId(ctx.targetId);
    } else if (action === 'pin') {
      void this.deps.pinSession(ctx.targetId);
    } else if (action === 'export') {
      void this.deps.exportMarkdown(ctx.targetId);
    } else if (action === 'archive') {
      void this.deps.archiveSession(ctx.targetId);
    } else if (action === 'delete') {
      this.requestDeleteSession(ctx.targetId, ctx.targetName || ctx.targetId);
    }
  }

  /**
   * 发起会话删除确认
   *
   * @param id 会话 ID
   * @param name 会话标题或名称（用于展示在二次确认窗中）
   */
  public requestDeleteSession(id: string, name?: string): void {
    const sessionName = name || id;
    this.deps.commitState({
      confirmModal: {
        title: this.deps.t('ctx.deleteSessionTitle'),
        message: this.deps.t('ctx.confirmDeleteSession', { name: sessionName }),
        confirmLabel: this.deps.t('ctx.delete'),
        cancelLabel: this.deps.t('common.cancel'),
        isDanger: true,
        onConfirm: () => {
          this.deps.restoreComposerFocus();
          void this.deps.deleteSession(id);
        },
        onCancel: () => {
          this.deps.restoreComposerFocus();
        },
      },
    });
    this.deps.requestRender();
  }

  /**
   * 点击空白处收起右键菜单判定
   *
   * @param target 点击的目标节点
   * @param menuElement 右键菜单根节点（可选）
   * @returns 若菜单在此次点击中被收起则返回 true
   */
  public closeContextMenuIfClickedOutside(target: Node | null, menuElement?: HTMLElement | null): boolean {
    const state = this.deps.getState();
    if (!state.sessionContextMenu) return false;

    const ctxMenu = menuElement || (typeof document !== 'undefined' ? document.getElementById('session-context-menu') : null);
    if (!ctxMenu || (target && !ctxMenu.contains(target))) {
      this.deps.commitState({ sessionContextMenu: undefined });
      this.deps.requestRender();
      return true;
    }
    return false;
  }

  /**
   * 生成新建任务/群聊弹窗的完整 HTML 模板
   */
  public renderTaskModalHtml(): string {
    const state = this.deps.getState();
    return renderNewTaskModal({
      isOpen: state.isNewTaskModalOpen,
      profiles: state.profiles,
      projects: state.projects,
      selectedProfile: state.profileName || 'default',
      selectedProjectId: state.selectedNewTaskProjectId,
      initialType: state.newTaskModalTab,
    });
  }

  /**
   * 生成二次确认弹窗的完整 HTML 模板
   */
  public renderConfirmModalHtml(): string {
    const state = this.deps.getState();
    return renderConfirmModal(
      state.confirmModal
        ? {
            isOpen: true,
            title: state.confirmModal.title,
            message: state.confirmModal.message,
            confirmLabel: state.confirmModal.confirmLabel,
            cancelLabel: state.confirmModal.cancelLabel,
            isDanger: state.confirmModal.isDanger,
          }
        : undefined
    );
  }

  /**
   * 生成右键上下文菜单的完整 HTML 模板
   */
  public renderContextMenuHtml(): string {
    const state = this.deps.getState();
    return renderContextMenu(state.sessionContextMenu);
  }

  /**
   * 局部增量同步弹窗与右键菜单 DOM 子树
   */
  public updateModals(root: HTMLElement): void {
    if (typeof document === 'undefined') return;

    // 1. New Task & Group Modal
    const taskModalRoot = document.getElementById('new-task-modal-overlay');
    const nextTaskModalHtml = this.renderTaskModalHtml();
    if (taskModalRoot) {
      if (nextTaskModalHtml) {
        taskModalRoot.outerHTML = nextTaskModalHtml;
      } else {
        taskModalRoot.remove();
      }
    } else if (nextTaskModalHtml) {
      root.insertAdjacentHTML('beforeend', nextTaskModalHtml);
    }

    // 2. Confirm Modal
    const confirmModalRoot = document.getElementById('flux-confirm-modal-overlay');
    const nextConfirmModalHtml = this.renderConfirmModalHtml();
    if (confirmModalRoot) {
      if (nextConfirmModalHtml) {
        confirmModalRoot.outerHTML = nextConfirmModalHtml;
      } else {
        confirmModalRoot.remove();
      }
    } else if (nextConfirmModalHtml) {
      root.insertAdjacentHTML('beforeend', nextConfirmModalHtml);
    }

    // 3. Context Menu
    const existingMenu = document.getElementById('session-context-menu');
    const nextMenuHtml = this.renderContextMenuHtml();
    if (existingMenu) {
      if (nextMenuHtml) existingMenu.outerHTML = nextMenuHtml;
      else existingMenu.remove();
    } else if (nextMenuHtml) {
      root.insertAdjacentHTML('beforeend', nextMenuHtml);
    }
  }

  /**
   * 绑定所有模态弹窗与右键菜单的 DOM 事件
   */
  public bindDomEvents(doc: Document = document): void {
    // 1. 关闭任务弹窗按钮
    const closeTaskModalBtn = doc.getElementById('btn-close-task-modal');
    const cancelTaskModalBtn = doc.getElementById('btn-cancel-task-modal');
    if (closeTaskModalBtn) closeTaskModalBtn.onclick = () => this.closeTaskModal();
    if (cancelTaskModalBtn) cancelTaskModalBtn.onclick = () => this.closeTaskModal();

    // 2. 确认模态窗按钮与遮罩
    const confirmModalOkBtn = doc.getElementById('btn-confirm-modal-ok');
    const confirmModalCancelBtn = doc.getElementById('btn-confirm-modal-cancel');
    const confirmModalCloseBtn = doc.getElementById('btn-confirm-modal-close');
    const confirmModalOverlay = doc.getElementById('flux-confirm-modal-overlay');

    if (confirmModalOkBtn) confirmModalOkBtn.onclick = () => this.closeConfirmModal('ok');
    if (confirmModalCancelBtn) confirmModalCancelBtn.onclick = () => this.closeConfirmModal('cancel');
    if (confirmModalCloseBtn) confirmModalCloseBtn.onclick = () => this.closeConfirmModal('cancel');
    if (confirmModalOverlay) {
      confirmModalOverlay.onclick = (e) => {
        if (e.target === confirmModalOverlay) this.closeConfirmModal('cancel');
      };
    }

    // 3. 新建任务弹窗 Tab 切换与 Agent 选项
    const modalTabSolo = doc.getElementById('modal-tab-solo');
    const modalTabGroup = doc.getElementById('modal-tab-group');
    const secSolo = doc.getElementById('modal-section-solo-agent');
    const secGroup = doc.getElementById('modal-section-group-members');

    if (modalTabSolo && modalTabGroup) {
      modalTabSolo.onclick = () => {
        this.setModalTab('solo');
        modalTabSolo.classList.add('active');
        modalTabSolo.style.background = 'var(--bg-card)';
        modalTabSolo.style.borderColor = 'var(--border-medium)';
        modalTabSolo.style.color = 'var(--text-main)';
        modalTabGroup.classList.remove('active');
        modalTabGroup.style.background = 'transparent';
        modalTabGroup.style.borderColor = 'transparent';
        modalTabGroup.style.color = 'var(--text-muted)';
        if (secSolo) secSolo.style.display = 'flex';
        if (secGroup) secGroup.style.display = 'none';
      };
      modalTabGroup.onclick = () => {
        this.setModalTab('group');
        modalTabGroup.classList.add('active');
        modalTabGroup.style.background = 'var(--bg-card)';
        modalTabGroup.style.borderColor = 'var(--border-medium)';
        modalTabGroup.style.color = 'var(--text-main)';
        modalTabSolo.classList.remove('active');
        modalTabSolo.style.background = 'transparent';
        modalTabSolo.style.borderColor = 'transparent';
        modalTabSolo.style.color = 'var(--text-muted)';
        if (secSolo) secSolo.style.display = 'none';
        if (secGroup) secGroup.style.display = 'flex';
      };
    }

    doc.querySelectorAll('.modal-agent-option').forEach((opt) => {
      const el = opt as HTMLElement;
      el.onclick = () => {
        doc.querySelectorAll('.modal-agent-option').forEach((o) => {
          const item = o as HTMLElement;
          item.classList.remove('selected');
          item.style.borderColor = 'var(--border-subtle)';
          item.style.background = 'var(--bg-panel)';
        });
        el.classList.add('selected');
        el.style.borderColor = 'var(--accent)';
        el.style.background = 'var(--accent-subtle)';
        this.setSelectedAgent(el.dataset.profile || 'default');
      };
    });

    const submitTaskModalBtn = doc.getElementById('btn-submit-task-modal');
    if (submitTaskModalBtn) {
      submitTaskModalBtn.onclick = async () => {
        await this.submitTaskModal();
      };
    }

    // 4. 右键菜单动作委托
    doc.querySelectorAll('#session-context-menu .ctx-item').forEach((btn) => {
      const el = btn as HTMLElement;
      el.onclick = (e) => {
        e.stopPropagation();
        const action = el.dataset.action;
        if (action) {
          this.handleContextMenuAction(action);
        }
      };
    });

    // 5. 快速删除按钮
    doc.querySelectorAll('.btn-delete-session').forEach((btn) => {
      const el = btn as HTMLElement;
      el.onclick = (e) => {
        e.stopPropagation();
        const id = el.dataset.id;
        if (!id) return;
        const state = this.deps.getState();
        const targetSess = state.sessions.find((s) => s.id === id);
        this.requestDeleteSession(id, targetSess?.title || id);
      };
    });
  }
}

export function createModalInteractionController(deps: ModalInteractionDeps): ModalInteractionController {
  return new ModalInteractionController(deps);
}
