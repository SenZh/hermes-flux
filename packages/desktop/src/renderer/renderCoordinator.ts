/**
 * 渲染装配与协调管线 (Render Coordinator)
 *
 * 【设计意图 (Why)】
 *   收敛桌面端表现层装配与生命周期协调主流程，包括：
 *   1. 对话区视图模型只读映射（`buildConversationSnapshot` 与 VM WeakMap 缓存）；
 *   2. React 消息列表的增量挂载与状态同步（`syncReactMessageList`）；
 *   3. React 壳层（标题栏、左轨、设置、在场指示器、导航轨）的生命周期协调（`mountReactShellComponents`）；
 *   4. 主 `render()` 流程：输入焦点与选区保护、两阶段检查舱动画、输入舱增量更新、会话流锚定恢复等。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 输入舱无条件全量 outerHTML 替换会导致光标丢失与无法输入文字；必须按快照指纹比较进行增量替换；
 *   2. 检查舱展开动画若未两阶段挂载会导致 0 到 420px 的过渡动画失效；
 *   3. 行高锁定与虚拟高度改变时必须强制更新 React 列表，否则视口将留在旧口径的空白区域。
 *
 * 【约束与规则 (Rules)】
 *   - 严格单向 Deps 依赖注入，禁止反向 import index.ts；
 *   - 0 TS 报错，严禁 as any；
 *   - 保持视口物理稳定性与 120 FPS 响应。
 */

import {
  mountTitlebar,
  mountLeftRail,
  mountMessageList,
  mountPromptNavigator,
  renderMiddlePod,
  renderInspectionPod,
  renderInputDock,
  renderConversationCanvas,
  hasDockSnapshotChanged,
  type LeftRailActions,
  type LeftRailSnapshot,
  type TitlebarSnapshot,
  type ConversationSnapshot,
  type ConversationMessageVM,
  type RenderInputDockSnapshot,
  type MessageViewModel,
  type DataPhase,
  resolveSkinId,
  SKINS,
  applyConversationWidthMode,
  attachMotionController,
  type PromptNavigatorSnapshot,
  type PromptNavigatorActions,
  type SettingsSectionId,
  t,
} from '@hermes-flux/ui';

import {
  resolveTitlebarTitle,
  doesSessionBelongToProject,
  decideViewportPin,
  chooseViewportAnchor,
} from '@hermes-flux/core';
import type { AppState } from './state/appState.js';
import { decideConversationPush } from './conversationPush.js';
import type { MessageWindowManager } from './messageWindowManager.js';
import type { ModalInteractionController } from './events/modalInteractionController.js';
import type { StreamAnchor } from './viewport/streamViewportManager.js';
import { createPostCommitPinObservers } from './viewport/postCommitPinObservers.js';

export interface RenderMessagesSnapshot {
  sessionId: string;
  count: number;
  lastMsgId: string;
  lastContentLen: number;
  isStreaming: boolean;
  gatewayConnected: boolean;
  gatewayConnecting: boolean;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  profileName: string;
  messagesPhase: DataPhase;
  rollbackActive: boolean;
  capsuleCount: number;
}

export type SessionEnterPendingProbe = () => boolean;
export type SessionEnterSettleProbe = (
  probeMessageId?: string,
  sessionId?: string,
  phase?: string,
  messagesCount?: number,
  authoritativeReady?: boolean
) => void;

export interface RenderCoordinatorDeps {
  getState: () => AppState;
  messageWindowManager: MessageWindowManager;
  modalInteractionController: ModalInteractionController;
  isStreamingActiveForCurrentSession: () => boolean;
  resolveSessionKnownFiles: () => readonly string[];

  // 标题栏操作
  getTitlebarSnapshot: () => TitlebarSnapshot;
  onMinimizeWindow?: () => void;
  onMaximizeWindow?: () => Promise<void>;
  onCloseWindow?: () => void;

  // 左轨操作
  getLeftRailSnapshot: () => LeftRailSnapshot;
  createLeftRailActions: () => LeftRailActions;

  // 提示词导航轨操作
  getPromptNavigatorSnapshot: () => PromptNavigatorSnapshot;
  createPromptNavigatorActions: () => PromptNavigatorActions;
  /**
   * 挂载成功后把 React 的 update 句柄回注给 PromptNavigatorManager。
   *
   * 可选：旧调用方（单测/迁移期）可不提供，此时仅本地持有句柄、不推送快照。
   */
  setPromptNavigatorUpdateHandler?: (handler: (() => void) | null) => void;
  rebuildPromptEntries: () => void;
  syncPromptNavigatorMeta: () => void;
  syncPromptNavigator: () => void;

  // 设置中心
  syncReactSettings: () => void;
  ensureSettingsSectionData: (section: SettingsSectionId) => void;

  // 在场指示器
  syncAgentPresenceHost: () => void;
  syncAgentPresence: () => void;

  // 视口与滚动控制
  captureStreamAnchor: () => StreamAnchor;
  applyStreamAnchor: (anchor: StreamAnchor, pinBottom: boolean) => void;
  stabilizeStreamAnchor: (anchor: StreamAnchor) => void;
  isStreamNearBottom: (stream: HTMLElement | null) => boolean;
  syncStreamBottomInset: () => void;
  settleInitialBottom: () => void;
  isSessionEnterPending: SessionEnterPendingProbe;
  settleSessionEnter: SessionEnterSettleProbe;
  markProgrammaticScroll?: (stream: HTMLElement) => void;
  /**
   * React 提交后重新对齐 armed 的贴底意图（幂等、无参）。
   * 可选：旧调用方（单测/迁移期）不提供时，提交后驱动降级为不动作。
   */
  reassertActivePin?: () => void;

  // 事件与 Popper
  bindEvents: () => void;
  syncComposerPoppers: () => void;
  syncComposerBadges?: () => void;

  // 日志
  logRender?: {
    debug: (msg: string, meta?: unknown) => void;
  };
}

export interface RenderCoordinator {
  render(): void;
  buildConversationSnapshot(): ConversationSnapshot;
  syncReactMessageList(force?: boolean): void;
  mountReactShellComponents(): void;

  getCanvasStructureDirty(): boolean;
  setCanvasStructureDirty(val: boolean): void;
  getSuppressPinBottomOnce(): boolean;
  setSuppressPinBottomOnce(val: boolean): void;
  getPendingScrollToBottom(): boolean;
  setPendingScrollToBottom(val: boolean): void;
  getSessionSwitchPending(): boolean;
  setSessionSwitchPending(val: boolean): void;
  setLastMessagesSnapshot(snapshot: RenderMessagesSnapshot | null): void;
  getLastInputDockSnapshot(): RenderInputDockSnapshot | null;
  setLastInputDockSnapshot(snapshot: RenderInputDockSnapshot | null): void;
  dispose(): void;
}

function snapshotFingerprint(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  // gate-degrade: 不可序列化时降级为唯一随机指纹强制推送
  } catch {
    return `__unserializable_${Date.now()}_${Math.random()}`;
  }
}

/**
 * 取「渲染层真正会挂载的最后一条可见消息」的 id。
 *
 * 【设计意图 (Why)】会话进入计划的探针必须是 DOM 里真实存在的行：若取 `messages` 原始末条，
 *   而它恰好是 `displayKind === 'hidden'` 的隐藏行，DOM 中根本没有对应 `[data-msg-id]`，
 *   探针永远等不到挂载，计划只能熔断收场（实测视口差 7958px）。
 *
 * 【约束与规则 (Rules)】本函数是唯一口径：`buildConversationSnapshot` 的最后可见行标记
 *   与 `settleSessionEnter` 的探针 id 必须共用同一实现，严禁各自维护一套倒序扫描逻辑。
 */
function lastVisibleMessageId(messages: readonly MessageViewModel[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const kind = messages[i].displayKind ?? 'user';
    if (kind !== 'hidden') return messages[i].id;
  }
  return undefined;
}

export function createRenderCoordinator(deps: RenderCoordinatorDeps): RenderCoordinator {
  const conversationVmCache = new WeakMap<
    MessageViewModel,
    {
      vm: ConversationMessageVM;
      content: string;
      thought?: string;
      toolsRef?: unknown;
      toolsSignature?: string;
      displayKind?: string;
      displayMetadata?: unknown;
    }
  >();

  let lastSeenLoadingOlder = false;
  let lastSeenMessagesPhase: DataPhase = 'ready';
  let lastSeenStreaming = false;
  let renderedMessageIds = new Set<string>();
  let reactMessageList: ReturnType<typeof mountMessageList> | null = null;
  let reactMessageListHost: HTMLElement | null = null;

  let canvasStructureDirty = false;
  let suppressPinBottomOnce = false;
  let pendingScrollToBottom = false;
  let sessionSwitchPending = false;

  let lastMessagesSnapshot: RenderMessagesSnapshot | null = null;
  let lastInputDockSnapshot: RenderInputDockSnapshot | null = null;
  let updateReactTitlebar: (() => void) | null = null;
  let updateReactLeftRail: (() => void) | null = null;
  let updateReactPromptNavigator: (() => void) | null = null;
  let lastTitlebarSnapshotJson = '';
  let lastPushedLeftRailSnapshot: LeftRailSnapshot | null = null;

  let lastInspectorCollapsed = true;
  let inspectorMotionController: ReturnType<typeof attachMotionController> | null = null;

  /**
   * 【单在途渲染后贴底句柄 (Why)】
   *   每次 `messagesChanged && pinBottom` 的渲染都会挂起多帧贴底收敛，
   *   旧实现用局部闭包各自收尾：连续两次渲染相隔不足 8 帧时，前一次的 cleanupPin
   *   会提前移除 `overflow-anchor: none`，甚至误清 `beginSessionEnter()` 正在使用的属性。
   * 【约束与规则 (Rules)】
   *   1. 任意时刻最多只有一个在途 post-render pin；启动新 pin、进入 enterPending、
   *      非贴底消息变动或 dispose() 时必须立刻取消旧句柄；
   *   2. cleanup 仅在 `!deps.isSessionEnterPending()` 时才移除 `overflow-anchor`。
   */
  let activePostRenderPinCleanup: (() => void) | null = null;
  let postRenderPinToken = 0;

  function cancelActivePostRenderPin(): void {
    const cleanup = activePostRenderPinCleanup;
    if (!cleanup) return;
    activePostRenderPinCleanup = null;
    cleanup();
  }

  function armPostRenderPinAnchor(): { token: number; isCancelled: () => boolean; cleanup: () => void } {
    cancelActivePostRenderPin();
    const token = ++postRenderPinToken;
    let cancelled = false;
    let cleaned = false;
    const boundStream = document.getElementById('conversation-stream');

    const onWheel = (event?: Event) => {
      const wheelEvent = event as WheelEvent | undefined;
      // 仅在向上滚轮（或无 deltaY 桩事件）时让权，向下滚轮不中断贴底收敛
      if (!wheelEvent || typeof wheelEvent.deltaY !== 'number' || wheelEvent.deltaY < 0) {
        cancelled = true;
      }
    };
    const onPointerOrTouch = () => {
      cancelled = true;
    };

    if (boundStream) {
      boundStream.style?.setProperty?.('overflow-anchor', 'none');
      boundStream.addEventListener?.('wheel', onWheel, { passive: true });
      boundStream.addEventListener?.('pointerdown', onPointerOrTouch, { passive: true, once: true });
      boundStream.addEventListener?.('touchstart', onPointerOrTouch, { passive: true, once: true });
    }

    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      cancelled = true;
      const currentStream = typeof document !== 'undefined' ? document.getElementById('conversation-stream') : null;
      const targets = new Set<HTMLElement>();
      if (boundStream) targets.add(boundStream);
      if (currentStream) targets.add(currentStream);
      for (const el of targets) {
        if (!deps.isSessionEnterPending()) {
          el.style?.removeProperty?.('overflow-anchor');
        }
        el.removeEventListener?.('wheel', onWheel);
        el.removeEventListener?.('pointerdown', onPointerOrTouch);
        el.removeEventListener?.('touchstart', onPointerOrTouch);
      }
      if (activePostRenderPinCleanup === cleanup) {
        activePostRenderPinCleanup = null;
      }
    };

    activePostRenderPinCleanup = cleanup;
    return {
      token,
      isCancelled: () => cancelled || token !== postRenderPinToken,
      cleanup,
    };
  }

  /**
   * 【提交后驱动 (Why)】React 的提交时机与 rAF 推进帧无固定先后：提交晚于推进帧时，
   *   单靠 render() 里的推进永远看不到真实末行（实测停在半空差 7958px）。
   *   观察器生命周期已剥离为 `viewport/postCommitPinObservers` 独立单元，
   *   使「挂载 / 重建 / 合并 / 释放」四契约可在无真实 DOM 内核时被确定性验证。
   */
  const postCommitPinObservers = deps.reassertActivePin
    ? createPostCommitPinObservers({
      getMessageHost: () => (typeof document === 'undefined' ? null : document.getElementById('react-message-list-host')),
      getCanvasElement: () => (typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.conv-canvas')),
      isSessionEnterPending: () => deps.isSessionEnterPending(),
      reassertActivePin: () => deps.reassertActivePin?.(),
    })
    : null;

  const logRender = deps.logRender ?? {
    debug: () => {},
  };

  /**
   * 幂等地挂载「提交后驱动」观察器。
   * 【约束与规则 (Rules)】`document` 缺失或宿主未接线时安全跳过；
   *   具体挂载 / 重建 / 合并语义由 postCommitPinObservers 承担。
   */
  function ensurePostCommitPinObservers(): void {
    if (typeof document === 'undefined' || !deps.reassertActivePin) return;
    postCommitPinObservers?.ensure();
  }

  function buildConversationSnapshot(): ConversationSnapshot {
    const state = deps.getState();
    const focusType = state.activeFocus.type;
    const streaming = deps.isStreamingActiveForCurrentSession();
    deps.messageWindowManager.ensureMessageWindow(state.messages.length);
    const messageWindowStart = deps.messageWindowManager.getMessageWindowStart();
    const messageWindowEnd = deps.messageWindowManager.getMessageWindowEnd();
    const windowedMessages = state.messages.slice(messageWindowStart, messageWindowEnd);

    const lastMessageId = lastVisibleMessageId(windowedMessages);

    return {
      mode: focusType === 'group' ? 'group' : focusType === 'bot' ? 'foreground' : 'scratchpad',
      connection: state.gatewayConnected ? 'connected' : state.gatewayConnecting ? 'connecting' : 'disconnected',
      isStreaming: streaming,
      hasOlderMessages: state.hasOlderMessages,
      isLoadingOlder: state.isLoadingOlder,
      messagesPhase: state.messagesPhase,
      profileName: state.profileName,
      contentOffsetPx: deps.messageWindowManager.computeContentOffsetPx(),
      virtualHeightPx: deps.messageWindowManager.computeVirtualHeightPx(),
      virtualWindowAtTail: messageWindowEnd >= state.messages.length,
      knownFiles: deps.resolveSessionKnownFiles(),
      locale: state.lang,
      messages: windowedMessages.map((m) => {
        const isLast = m.id === lastMessageId;
        const displayKind = m.displayKind ?? 'user';
        const toolsSignature =
          m.toolCalls
            ?.map((tc) => `${tc.id}:${tc.status}:${tc.output?.length ?? 0}:${tc.args?.length ?? 0}`)
            .join('|') ?? '';
        if (!isLast) {
          const cached = conversationVmCache.get(m);
          if (cached
            && cached.content === m.content
            && cached.thought === m.thought
            && cached.toolsRef === m.toolCalls
            && cached.toolsSignature === toolsSignature
            && cached.displayKind === displayKind
            && cached.displayMetadata === m.displayMetadata) {
            return cached.vm;
          }
        }
        const vm: ConversationMessageVM = {
          id: m.id,
          rowId: m.rowId,
          role: m.role,
          content: m.content,
          sender: m.sender,
          senderAvatar: m.senderAvatar,
          model: m.model,
          thought: m.thought,
          thoughtDurationMs: m.thoughtDurationMs,
          durationMs: m.durationMs,
          timestamp: m.timestamp,
          status: streaming && isLast ? 'streaming' : undefined,
          isStreaming: streaming && isLast,
          displayKind,
          displayMetadata: m.displayMetadata,
          toolCalls: m.toolCalls?.map((tc) => ({
            id: tc.id,
            name: tc.name,
            status: tc.status,
            args: tc.args,
            output: tc.output,
            durationMs: tc.durationMs,
            startedAt: tc.startTime,
          })),
        };
        if (!isLast) {
          conversationVmCache.set(m, {
            vm,
            content: m.content,
            thought: m.thought,
            toolsRef: m.toolCalls,
            toolsSignature,
            displayKind,
            displayMetadata: m.displayMetadata,
          });
        }
        return vm;
      }),
    };
  }

  function syncReactMessageList(force = false): void {
    if (typeof document === 'undefined') return;
    const host = document.getElementById('react-message-list-host');
    const state = deps.getState();
    if (!host) {
      reactMessageList?.unmount();
      reactMessageList = null;
      reactMessageListHost = null;
      renderedMessageIds = new Set();
      lastSeenStreaming = false;
      lastSeenLoadingOlder = false;
      lastSeenMessagesPhase = state.messagesPhase;
      return;
    }

    deps.messageWindowManager.ensureMessageWindow(state.messages.length);
    const start = deps.messageWindowManager.getMessageWindowStart();
    const end = deps.messageWindowManager.getMessageWindowEnd();
    const currentIds = state.messages.slice(start, end).map((m) => m.id);

    if (reactMessageListHost !== host) {
      reactMessageList?.unmount();
      reactMessageList = mountMessageList(host, buildConversationSnapshot);
      reactMessageListHost = host;
      renderedMessageIds = new Set(currentIds);
      lastSeenStreaming = deps.isStreamingActiveForCurrentSession();
      lastSeenLoadingOlder = state.isLoadingOlder;
      sessionSwitchPending = false;
      lastSeenMessagesPhase = state.messagesPhase;
      deps.messageWindowManager.scheduleVirtualHeightSync();
      return;
    }

    const streaming = deps.isStreamingActiveForCurrentSession();
    const justStoppedStreaming = lastSeenStreaming && !streaming;
    lastSeenStreaming = streaming;

    const loadingOlderChanged = lastSeenLoadingOlder !== state.isLoadingOlder;
    lastSeenLoadingOlder = state.isLoadingOlder;

    const messagesPhaseChanged = lastSeenMessagesPhase !== state.messagesPhase;
    lastSeenMessagesPhase = state.messagesPhase;

    const shouldPush = decideConversationPush({
      prevIds: renderedMessageIds,
      nextIds: currentIds,
      justStoppedStreaming,
      force: force || sessionSwitchPending,
      loadingOlderChanged,
      messagesPhaseChanged,
    });

    if (shouldPush && reactMessageList) {
      sessionSwitchPending = false;
      reactMessageList.update();
      renderedMessageIds = new Set(currentIds);
      deps.messageWindowManager.scheduleVirtualHeightSync();
    }
  }

  function bindInspectorController(el: HTMLElement): NonNullable<typeof inspectorMotionController> {
    if (inspectorMotionController) {
      inspectorMotionController.detach();
    }
    const controller = attachMotionController(el, {
      triggerProperty: 'width',
      onExited: () => {
        el.style.display = 'none';
        el.classList.add('inspector-collapsed');
      },
    });
    inspectorMotionController = controller;
    return controller;
  }

  function mountReactShellComponents(): void {
    if (typeof document === 'undefined') return;
    const titlebarHost = document.getElementById('react-titlebar-host');
    const leftRailHost = document.getElementById('react-leftrail-host');
    const state = deps.getState();

    if (titlebarHost && !updateReactTitlebar) {
      updateReactTitlebar = mountTitlebar(titlebarHost, deps.getTitlebarSnapshot, {
        onMinimize: () => deps.onMinimizeWindow?.(),
        onMaximize: async () => {
          await deps.onMaximizeWindow?.();
          render();
        },
        onClose: () => deps.onCloseWindow?.(),
        onToggleLeftRail: () => {
          state.leftRailCollapsed = !state.leftRailCollapsed;
          render();
        },
        onToggleInspector: () => {
          state.inspectorCollapsed = !state.inspectorCollapsed;
          render();
        },
        onOpenSettings: () => {
          state.isSettingsOpen = true;
          deps.ensureSettingsSectionData(state.settingsSection);
          render();
        },
      });
    }

    if (leftRailHost && !updateReactLeftRail) {
      updateReactLeftRail = mountLeftRail(leftRailHost, deps.getLeftRailSnapshot, deps.createLeftRailActions());
    }

    if (updateReactTitlebar) {
      const fingerprint = snapshotFingerprint(deps.getTitlebarSnapshot());
      if (fingerprint !== lastTitlebarSnapshotJson) {
        lastTitlebarSnapshotJson = fingerprint;
        updateReactTitlebar();
      }
    }

    if (updateReactLeftRail) {
      const snapshot = deps.getLeftRailSnapshot();
      if (snapshot !== lastPushedLeftRailSnapshot) {
        lastPushedLeftRailSnapshot = snapshot;
        updateReactLeftRail();
      }
    }

    deps.syncReactSettings();
    syncReactMessageList();
    deps.syncAgentPresenceHost();

    const navHost = document.getElementById('react-prompt-navigator-host');
    if (navHost && !updateReactPromptNavigator) {
      const promptNavigatorMount = mountPromptNavigator(
        navHost,
        deps.getPromptNavigatorSnapshot,
        deps.createPromptNavigatorActions(),
      );
      updateReactPromptNavigator = promptNavigatorMount.update;
      /**
       * 【设计意图 (Why)】
       *   导航器快照推送的唯一出口在 PromptNavigatorManager.sync()，它在没有 update 句柄时
       *   第一行直接 return。挂载成功后必须把句柄回注给管理器，否则快照永远停在空态。
       *
       * 【防范历史坑 (Pitfall)】
       *   Batch 5/7 把挂载搬进 renderCoordinator 时，只赋值了本地的 updateReactPromptNavigator，
       *   忘记调用 setUpdateHandler 回注；管理器侧 `if (!this.updateReactPromptNavigator) return;`
       *   使整条推送链静默短路，导航轨在所有会话下都不出现，且无任何报错。
       *
       * 【约束规则 (Rules)】
       *   每次挂载（含 React 树重建导致 navHost 换新）都必须重新回注，不得只做一次。
       */
      deps.setPromptNavigatorUpdateHandler?.(promptNavigatorMount.update);
    }

    deps.rebuildPromptEntries();
    deps.syncPromptNavigatorMeta();
    deps.syncPromptNavigator();

    deps.settleInitialBottom();
    deps.syncStreamBottomInset();
  }

  function render(): void {
    if (typeof document === 'undefined') return;
    const root = document.getElementById('flux-app-root');
    if (!root) return;
    const renderStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const state = deps.getState();
    // 提交后驱动：先确保观察器挂载，再走本轮 DOM 装配（首次装配的提交由观察器捕获）。
    ensurePostCommitPinObservers();

    const existingInput = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
    const draftText = existingInput ? existingInput.value : '';
    const inputHadFocus = Boolean(existingInput) && document.activeElement === existingInput;
    const caretStart = existingInput?.selectionStart ?? draftText.length;
    const caretEnd = existingInput?.selectionEnd ?? draftText.length;

    const activeEl = document.activeElement as HTMLElement | null;
    const activeInputId =
      activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') ? activeEl.id : null;
    const activeInputVal = activeEl && 'value' in activeEl ? (activeEl as HTMLInputElement).value : '';
    const activeCaretStart =
      activeEl && 'selectionStart' in activeEl ? (activeEl as HTMLInputElement).selectionStart : null;
    const activeCaretEnd =
      activeEl && 'selectionEnd' in activeEl ? (activeEl as HTMLInputElement).selectionEnd : null;

    const suppressPinOnce = suppressPinBottomOnce;
    suppressPinBottomOnce = false;
    const forcedBottom = suppressPinOnce ? false : pendingScrollToBottom;
    pendingScrollToBottom = false;
    const streamEl = document.getElementById('conversation-stream');
    const wasNearBottom = deps.isStreamNearBottom(streamEl);

    const rootEl = document.documentElement;
    // 平台标识：供 CSS 表达 macOS 专属几何（系统交通灯让位）。
    // 设计意图(Why)：styles.css 无法感知平台，而 macOS 折叠态/展开态的左段 padding 必须不同。
    // 约束与规则(Rules)：只在值变化时写入，避免高频 render 反复触发属性写与样式重算；
    //   全仓唯一写入点，禁止在事件处理器里另写一份（否则形成第二真值面）。
    if (rootEl.getAttribute?.('data-platform') !== state.platform) {
      rootEl.setAttribute('data-platform', state.platform);
    }
    const nextAppearance = SKINS[resolveSkinId(state.theme)]?.variant === 'light' ? 'light' : 'dark';
    if (rootEl.getAttribute?.('data-theme') !== state.theme) {
      rootEl.classList?.add('oc-theme-switching');
      rootEl.setAttribute('data-theme', state.theme);
      rootEl.setAttribute('data-appearance', nextAppearance);
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => rootEl.classList?.remove('oc-theme-switching'));
        });
      } else {
        rootEl.classList?.remove('oc-theme-switching');
      }
    } else {
      rootEl.setAttribute('data-appearance', nextAppearance);
    }
    document.documentElement.dataset.maximized = state.isMaximized ? 'true' : 'false';
    applyConversationWidthMode(state.conversationWidth, rootEl);

    const currentLastMsg = state.messages.length > 0 ? state.messages[state.messages.length - 1] : null;
    const currentMessagesSnapshot: RenderMessagesSnapshot = {
      sessionId: state.activeSessionId,
      count: state.messages.length,
      lastMsgId: currentLastMsg ? currentLastMsg.id : '',
      lastContentLen: currentLastMsg ? currentLastMsg.content?.length || 0 : 0,
      isStreaming: state.isStreaming,
      gatewayConnected: state.gatewayConnected,
      gatewayConnecting: state.gatewayConnecting,
      hasOlder: state.hasOlderMessages,
      isLoadingOlder: state.isLoadingOlder,
      profileName: state.profileName,
      messagesPhase: state.messagesPhase,
      rollbackActive: Boolean(state.rollbackArmed),
      capsuleCount: state.sideAgentCapsules.length,
    };

    const isStreamingCurrent = deps.isStreamingActiveForCurrentSession();
    const currentDockSnapshot: RenderInputDockSnapshot = {
      selectedModel: state.selectedModel,
      currentProvider: state.currentProvider,
      reasoningLevel: state.reasoningLevel,
      approvalMode: state.approvalMode,
      isStreaming: isStreamingCurrent,
      disabled: !state.gatewayConnected,
      modelMenuOpen: state.modelMenuOpen,
      notice: state.dockNotice,
      modelCount: state.availableModels.length,
      modelCatalogHash: state.modelCatalogHash,
      modelSearchQuery: state.modelSearchQuery,
      recentModelsHash: state.recentModels.join(','),
      favoriteModelsHash: state.favoriteModels.join(','),
      attachmentsCount: state.attachments.length,
      attachmentsHash: state.attachments.map((a) => `${a.id}:${a.name}`).join(','),
      queuedHash: state.queuedMessages.map((q) => `${q.admissionId}:${q.text}`).join('|'),
      rollbackArmedHash: state.rollbackArmed
        ? `${state.rollbackArmed.targetId}:${state.rollbackArmed.removedCount}`
        : '',
    };

    const inOngoingStreamingTurn =
      state.isStreaming &&
      lastMessagesSnapshot?.isStreaming &&
      lastMessagesSnapshot.sessionId === currentMessagesSnapshot.sessionId &&
      lastMessagesSnapshot.count === currentMessagesSnapshot.count;

    const structureDirty = canvasStructureDirty;
    const messagesChanged =
      (structureDirty || !inOngoingStreamingTurn) &&
      (structureDirty ||
        !lastMessagesSnapshot ||
        lastMessagesSnapshot.sessionId !== currentMessagesSnapshot.sessionId ||
        lastMessagesSnapshot.count !== currentMessagesSnapshot.count ||
        lastMessagesSnapshot.lastMsgId !== currentMessagesSnapshot.lastMsgId ||
        lastMessagesSnapshot.isStreaming !== currentMessagesSnapshot.isStreaming ||
        lastMessagesSnapshot.gatewayConnected !== currentMessagesSnapshot.gatewayConnected ||
        lastMessagesSnapshot.gatewayConnecting !== currentMessagesSnapshot.gatewayConnecting ||
        lastMessagesSnapshot.hasOlder !== currentMessagesSnapshot.hasOlder ||
        lastMessagesSnapshot.isLoadingOlder !== currentMessagesSnapshot.isLoadingOlder ||
        lastMessagesSnapshot.profileName !== currentMessagesSnapshot.profileName ||
        lastMessagesSnapshot.messagesPhase !== currentMessagesSnapshot.messagesPhase ||
        lastMessagesSnapshot.rollbackActive !== currentMessagesSnapshot.rollbackActive ||
        lastMessagesSnapshot.capsuleCount !== currentMessagesSnapshot.capsuleCount);

    // 【进入计划裁决 (Rules)】跨会话「进去之后视口在哪」由纯函数统一裁决：
    //   进入期不捕获旧 DOM、不重放锚点；非进入期沿用原有贴底/锚点语义。
    const scrollDecision = decideViewportPin({
      enterPending: deps.isSessionEnterPending(),
      forcedBottom,
      wasNearBottom,
      messagesChanged,
      hasRaf: typeof requestAnimationFrame !== 'undefined',
    });
    const pinBottom = scrollDecision.pinBottom;
    const shouldArmPostRenderPin = scrollDecision.advanceSessionEnter && pinBottom;
    if (!scrollDecision.capture || (messagesChanged && !pinBottom)) {
      cancelActivePostRenderPin();
    }
    let armedPostRenderPin: ReturnType<typeof armPostRenderPinAnchor> | null = null;
    const fallbackAnchor: StreamAnchor = { sessionId: state.activeSessionId, id: null, offset: 0, rawScrollTop: 0 };
    const streamAnchor = chooseViewportAnchor(scrollDecision, () => deps.captureStreamAnchor(), fallbackAnchor);
    // 单点 apply：三个渲染分支共用同一判定，避免分支漂移。
    const applyAnchorAfterDom = () => { if (scrollDecision.applyAnchor) deps.applyStreamAnchor(streamAnchor, pinBottom); };

    const bodyContainer = root.querySelector('.flux-body-container');

    if (!bodyContainer) {
      // 1. Initial full skeleton mount
      const html = `
        <div id="react-titlebar-host"></div>

        <div class="flux-body-container" style="flex: 1; display: flex; position: relative; overflow: hidden; width: 100%;">
          <div id="react-leftrail-host" style="display: contents;"></div>

          <!-- 右主块容器：检查舱全屏只覆盖本层，左栏保持可见（用户 2026-11-20 裁决） -->
          <div class="flux-main-block">
          ${renderMiddlePod({
            gatewayConnected: state.gatewayConnected,
            gatewayConnecting: state.gatewayConnecting,
            gatewayUrl: state.gatewayUrl,
            username: state.username,
            password: state.password,
            profileName: state.profileName,
            messages: state.messages,
            messagesPhase: state.messagesPhase,
            testStatus: state.testStatus,
            hasOlderMessages: state.hasOlderMessages,
            isLoadingOlder: state.isLoadingOlder,
            isStreaming: deps.isStreamingActiveForCurrentSession(),
            dockHtml: state.gatewayConnected
              ? renderInputDock({
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
                  isStreaming: deps.isStreamingActiveForCurrentSession(),
                  hasDraft: Boolean(draftText.trim()) || state.attachments.length > 0,
                  disabled: !state.gatewayConnected,
                  modelMenuOpen: state.modelMenuOpen,
                  notice: state.dockNotice,
                  attachments: state.attachments,
                  queuedMessages: state.queuedMessages,
                  slashPopperOpen: state.slashPopperOpen,
                  slashItems: state.slashItems,
                  mentionPopperOpen: state.mentionPopperOpen,
                  mentionItems: state.mentionItems,
                  rollbackBanner: state.rollbackArmed
                    ? { removedCount: state.rollbackArmed.removedCount, anchorLabel: state.rollbackArmed.anchorLabel }
                    : null,
                })
              : '',
          })}

          ${renderInspectionPod({
            collapsed: state.inspectorCollapsed,
            activeTab: state.activeInspectorTab,
            gatewayConnected: state.gatewayConnected,
            isFullscreen: state.inspectorFullscreen,
            openFiles: state.openFiles,
            activeFilePath: state.activeFilePath,
            viewMode: state.fileViewMode,
            showLineNumbers: state.fileShowLineNumbers,
            wordWrap: state.fileWordWrap,
            searchOpen: state.fileSearchOpen,
            searchQuery: state.fileSearchQuery,
            artifacts: state.artifacts,
            browserFrame: state.browserFrame,
            gitDiffs: state.gitDiffs,
            memories: state.memories,
          })}
          </div><!-- /.flux-main-block -->
        </div>

        <div id="react-settings-host" style="display: contents;"></div>

        ${deps.modalInteractionController.renderTaskModalHtml()}

        ${deps.modalInteractionController.renderContextMenuHtml()}

        ${deps.modalInteractionController.renderConfirmModalHtml()}
      `;

      root.innerHTML = html;
      // 【同步关闭 overflow-anchor (Pitfall)】mountReactShellComponents() 会立即调用 syncReactMessageList()，
      // 必须在 React 19 提交前同步关闭 overflow-anchor，防止替换 #msg-content-* 时被 Blink 锚回上方。
      if (shouldArmPostRenderPin) {
        armedPostRenderPin = armPostRenderPinAnchor();
      }
      mountReactShellComponents();
      lastMessagesSnapshot = currentMessagesSnapshot;
      lastInputDockSnapshot = currentDockSnapshot;
      applyAnchorAfterDom();
    } else {
      // 2. High-performance Subtree/Section Isolation Update
      if (shouldArmPostRenderPin) {
        armedPostRenderPin = armPostRenderPinAnchor();
      }
      mountReactShellComponents();

      const inspectEl = (root.querySelector('#flux-inspector-pod') ||
        root.querySelector('.flux-inspector-pod')) as HTMLElement | null;
      if (inspectEl) {
        if (lastInspectorCollapsed !== state.inspectorCollapsed) {
          if (!state.inspectorCollapsed) {
            inspectEl.outerHTML = renderInspectionPod({
              collapsed: false,
              activeTab: state.activeInspectorTab,
              gatewayConnected: state.gatewayConnected,
              isFullscreen: state.inspectorFullscreen,
              openFiles: state.openFiles,
              activeFilePath: state.activeFilePath,
              viewMode: state.fileViewMode,
              showLineNumbers: state.fileShowLineNumbers,
              wordWrap: state.fileWordWrap,
              searchOpen: state.fileSearchOpen,
              searchQuery: state.fileSearchQuery,
              artifacts: state.artifacts,
              browserFrame: state.browserFrame,
              gitDiffs: state.gitDiffs,
              memories: state.memories,
            });
            const nextInspectEl = root.querySelector('#flux-inspector-pod') as HTMLElement | null;
            if (nextInspectEl) {
              nextInspectEl.classList.add('inspector-collapsed');
              nextInspectEl.style.display = 'flex';
              void nextInspectEl.offsetWidth;
              const controller = bindInspectorController(nextInspectEl);
              nextInspectEl.classList.remove('inspector-collapsed');
              void controller.enter();
            }
          } else {
            const controller = inspectorMotionController || bindInspectorController(inspectEl);
            inspectEl.classList.add('inspector-collapsed');
            void controller.exit();
          }
          lastInspectorCollapsed = state.inspectorCollapsed;
        } else if (!state.inspectorCollapsed) {
          inspectEl.outerHTML = renderInspectionPod({
            collapsed: false,
            activeTab: state.activeInspectorTab,
            gatewayConnected: state.gatewayConnected,
            isFullscreen: state.inspectorFullscreen,
            openFiles: state.openFiles,
            activeFilePath: state.activeFilePath,
            viewMode: state.fileViewMode,
            showLineNumbers: state.fileShowLineNumbers,
            wordWrap: state.fileWordWrap,
            searchOpen: state.fileSearchOpen,
            searchQuery: state.fileSearchQuery,
            artifacts: state.artifacts,
            browserFrame: state.browserFrame,
            gitDiffs: state.gitDiffs,
            memories: state.memories,
          });
          const nextInspectEl = root.querySelector('#flux-inspector-pod') as HTMLElement | null;
          if (nextInspectEl) {
            bindInspectorController(nextInspectEl);
          }
        }
      }

      const existingDock = root.querySelector('.input-dock-container');
      const dockChanged = hasDockSnapshotChanged(lastInputDockSnapshot, currentDockSnapshot);
      const shouldBuildDock = state.gatewayConnected && (!existingDock || dockChanged);

      const nextDockHtml = shouldBuildDock
        ? renderInputDock({
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
            isStreaming: isStreamingCurrent,
            hasDraft: Boolean(draftText.trim()) || state.attachments.length > 0,
            disabled: !state.gatewayConnected,
            modelMenuOpen: state.modelMenuOpen,
            notice: state.dockNotice,
            attachments: state.attachments,
            queuedMessages: state.queuedMessages,
            slashPopperOpen: state.slashPopperOpen,
            slashItems: state.slashItems,
            mentionPopperOpen: state.mentionPopperOpen,
            mentionItems: state.mentionItems,
            rollbackBanner: state.rollbackArmed
              ? { removedCount: state.rollbackArmed.removedCount, anchorLabel: state.rollbackArmed.anchorLabel }
              : null,
          })
        : '';

      const applyInputDockUpdate = (): void => {
        if (existingDock) {
          if (!state.gatewayConnected) {
            existingDock.remove();
            lastInputDockSnapshot = null;
          } else if (dockChanged && nextDockHtml) {
            existingDock.outerHTML = nextDockHtml;
            lastInputDockSnapshot = currentDockSnapshot;
          }
        } else if (nextDockHtml) {
          const middlePod = root.querySelector('.flux-middle-pod');
          if (middlePod) middlePod.insertAdjacentHTML('beforeend', nextDockHtml);
          lastInputDockSnapshot = currentDockSnapshot;
        }
      };

    const syncAgentPresenceHost = (): void => deps.syncAgentPresenceHost();
    const syncAgentPresence = (): void => deps.syncAgentPresence();
    applyInputDockUpdate();
    syncAgentPresenceHost();
    syncAgentPresence();

      deps.modalInteractionController.updateModals(root);

      const activeStream = document.getElementById('conversation-stream');
      if (activeStream && messagesChanged) {
        const reactHost = document.getElementById('react-message-list-host');
        const canUseReactList =
          state.gatewayConnected && (state.messages.length > 0 || state.messagesPhase === 'loading');
        if (reactHost && canUseReactList) {
          syncReactMessageList(structureDirty);
          canvasStructureDirty = false;
        } else {
          activeStream.innerHTML = renderConversationCanvas({
            gatewayConnected: state.gatewayConnected,
            gatewayConnecting: state.gatewayConnecting,
            gatewayUrl: state.gatewayUrl,
            username: state.username,
            password: state.password,
            profileName: state.profileName,
            messages: state.messages,
            messagesPhase: state.messagesPhase,
            testStatus: state.testStatus,
            hasOlderMessages: state.hasOlderMessages,
            isLoadingOlder: state.isLoadingOlder,
            isStreaming: deps.isStreamingActiveForCurrentSession(),
            sideAgentCapsules: state.sideAgentCapsules,
          });
          canvasStructureDirty = false;
          syncReactMessageList(true);
        }
        applyAnchorAfterDom();
        lastMessagesSnapshot = currentMessagesSnapshot;
      }
    }

    const newInput = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
    if (newInput) {
      if (draftText && newInput.value !== draftText) newInput.value = draftText;
      if (inputHadFocus) {
        newInput.focus({ preventScroll: true });
        const max = newInput.value.length;
        newInput.setSelectionRange(Math.min(caretStart, max), Math.min(caretEnd, max));
      }
    }

    deps.bindEvents();

    if (activeInputId && activeInputId !== 'dock-prompt-input') {
      const restoredEl = document.getElementById(activeInputId) as HTMLInputElement | null;
      if (restoredEl) {
        if (typeof activeInputVal === 'string' && restoredEl.value !== activeInputVal) {
          restoredEl.value = activeInputVal;
        }
        restoredEl.focus({ preventScroll: true });
        if (activeCaretStart !== null && activeCaretEnd !== null) {
          try {
            restoredEl.setSelectionRange(activeCaretStart, activeCaretEnd);
          // gate-degrade: 元素不支持 selectionRange 时的安全回落，降级为默认聚焦
          } catch {
            // 忽略不支持选区的输入类型
          }
        }
      }
    }

    deps.syncComposerBadges?.();
    deps.syncComposerPoppers();

    // 【规则】进入计划挂起时即使消息快照未变也必须推进，否则缓存命中的切会话永远不落定；
    //   此时不再走「裸写 scrollTop = scrollHeight」的旧路径，交由 settleSessionEnter 多帧收敛。
    if (scrollDecision.advanceSessionEnter) {
      requestAnimationFrame(() => {
        if (!scrollDecision.capture) {
          /**
           * 【权威完成信号 (Rules)】`state.messagesPhase` 现在真正等于「权威页已到」：
           *   缓存命中但有网关时相位保持 'loading'，由 loadMessagesInner 结束后的 finally 收敛。
           *   因此这里按相位透传即可——`settleSessionEnter` 缺省（不传第 5 参）时以 phase 为判据，
           *   显式 `authoritativeReady` 仅留给需要更强信号的调用方。
           */
          deps.settleSessionEnter(
            lastVisibleMessageId(state.messages) ?? '',
            state.activeSessionId,
            state.messagesPhase,
            state.messages.length
          );
          return;
        }
        if (armedPostRenderPin) {
          // 【多帧防漂移收敛 (Why)】React 19 异步提交 + 虚拟窗口 ResizeObserver 重放可能晚于前 2 帧，
          //   且提交瞬间替换 #msg-content-* 节点时 Blink `overflow-anchor: auto` 会把视口锚定到上方用户提示词。
          //   overflow-anchor: none 已在 mountReactShellComponents() 前同步武装；此处复用单在途句柄，
          //   在 scrollHeight 连续 2 帧稳定（上限 8 帧）前持续贴底，一旦检测到用户向上手势或被新 pin 接管立即让权。
          const pinHandle = armedPostRenderPin;
          let lastHeight = -1;
          let stableFrames = 0;
          let frameCount = 0;
          const pin = () => {
            const stream = document.getElementById('conversation-stream');
            if (!stream || pinHandle.isCancelled()) {
              pinHandle.cleanup();
              return;
            }
            if (stream.scrollHeight > stream.clientHeight) {
              stream.scrollTop = stream.scrollHeight;
              if (deps.markProgrammaticScroll) {
                deps.markProgrammaticScroll(stream);
              } else {
                deps.messageWindowManager.markProgrammaticScroll(stream);
              }
            }
            const h = stream.scrollHeight;
            stableFrames = h === lastHeight ? stableFrames + 1 : 0;
            lastHeight = h;
            frameCount += 1;
            if ((stableFrames >= 2 && frameCount >= 3) || frameCount >= 8) {
              pinHandle.cleanup();
              return;
            }
            requestAnimationFrame(pin);
          };
          pin();
        } else {
          deps.stabilizeStreamAnchor(streamAnchor);
        }
      });
    }

    logRender.debug('render', {
      ms:
        Math.round(
          ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - renderStartedAt) * 10,
        ) / 10,
      messages: state.messages.length,
      messagesChanged,
      session: state.activeSessionId || '(none)',
      forcedBottom,
      pinBottom,
      anchor: streamAnchor.id,
    });
  }

  function dispose(): void {
    cancelActivePostRenderPin();
    postCommitPinObservers?.dispose();
    if (inspectorMotionController) {
      inspectorMotionController.detach();
      inspectorMotionController = null;
    }
    if (reactMessageList) {
      reactMessageList.unmount();
      reactMessageList = null;
      reactMessageListHost = null;
    }
  }

  return {
    render,
    buildConversationSnapshot,
    syncReactMessageList,
    mountReactShellComponents,

    getCanvasStructureDirty: () => canvasStructureDirty,
    setCanvasStructureDirty: (val: boolean) => { canvasStructureDirty = val; },
    getSuppressPinBottomOnce: () => suppressPinBottomOnce,
    setSuppressPinBottomOnce: (val: boolean) => { suppressPinBottomOnce = val; },
    getPendingScrollToBottom: () => pendingScrollToBottom,
    setPendingScrollToBottom: (val: boolean) => { pendingScrollToBottom = val; },
    getSessionSwitchPending: () => sessionSwitchPending,
    setSessionSwitchPending: (val: boolean) => { sessionSwitchPending = val; },
    setLastMessagesSnapshot: (snapshot: RenderMessagesSnapshot | null) => { lastMessagesSnapshot = snapshot; },
    getLastInputDockSnapshot: () => lastInputDockSnapshot,
    setLastInputDockSnapshot: (snapshot: RenderInputDockSnapshot | null) => { lastInputDockSnapshot = snapshot; },
    dispose,
  };
}
