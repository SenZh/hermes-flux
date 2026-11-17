/**
 * Hermes Flux 对话流滚动与消息微距动作控制器 (Conversation Stream Controller)
 *
 * 【设计意图 (Why)】
 * 统一管理对话流视口滚动（`streamEl.onscroll` / `onwheel`）、向上回溯翻页调度、
 * 虚拟窗口边界回收、消息微距操作栏动作（复制、回滚回填、Fork 节点分支）、
 * 运行中工具高频秒表计时器（`updateRunningToolTimers`）以及流内元素点击事件委托。
 * 将原散落在 index.ts 中的数百行 DOM 滚动监听与微距状态机解耦，
 * 提供脱离 DOM 的单向依赖注入接口，使滚动步进与消息交互具备确定性单测验证能力。
 *
 * 【防范的历史坑 (Pitfall)】
 * 1. 程序滚动（贴底与锚点校正）会写 scrollTop 并派发 scroll 事件，必须按落地值识别，避免误判为读者手势；
 * 2. 读者的向上回溯滚动必须即刻解除首屏落定（initialBottomSettling），防范强制拉底抢夺读者控制权；
 * 3. 复制内容防范 HTML 属性截断：优先从 messages 内存列表中根据 data-msg-id 提取完整 content；
 * 4. Fork 分支防范 4008 守卫错误：计算截断条数 count = msgIdx + 1，杜绝传空或者传负数。
 *
 * 【约束与规则 (Rules)】
 * - 纯单向依赖，禁止反向 import index.ts；
 * - 0 as any，保持全栈严格类型推导；
 * - 遵循三要素中文注释规范。
 */

import {
  type HermesGatewayClient,
  type IRpcCaller,
  type InteractiveService,
  planTruncate,
  deriveSessionKind,
} from '@hermes-flux/core';
import {
  type MessageViewModel,
  type I18nKey,
} from '@hermes-flux/ui';
import {
  computeExpandPrefetchPx,
  computeStillNearTop,
  planUpwardScrollAction,
  shouldExpandWindow,
} from '../messageWindow.js';
import type { AppState } from '../state/appState.js';
import {
  messageActionController,
} from '../messageActions.js';
import {
  applyOptimisticCut,
  resolveRollbackTarget,
} from '../rollbackTransaction.js';

export interface ConversationStreamControllerDeps {
  getState: () => AppState;
  render: () => void;
  safeCopyText: (text: string) => Promise<boolean>;
  setTimedDockNotice: (msg: string, durationMs?: number) => void;
  isStreamingActiveForCurrentSession: () => boolean;
  t: (key: I18nKey) => string;
  getGatewayClient: () => HermesGatewayClient | null;
  getRpcCaller: () => IRpcCaller;
  getInteractiveService: () => InteractiveService;
  selectSession: (id: string) => Promise<void>;
  scheduleSessionsRefresh: () => void;
  getSessionMessagesCache: () => Map<string, MessageViewModel[]>;
  handleOpenFilePreview: (filePath: string, previewUrl?: string) => Promise<void>;
  syncPromptNavigatorFromScroll: () => void;
  loadOlderMessages: (options?: { preserveViewportWindow?: boolean }) => Promise<void>;
  relocateMessageWindowToIndex: (index: number) => boolean;
  syncScrollTopToWindow: (reason: string) => void;
  slideMessageWindowForward: () => void;
  expandMessageWindow: () => boolean;
  settleInitialBottom: () => void;
  scrollStreamToBottom: (reason: string) => void;
  scheduleStreamBottomInset: () => void;
  layoutSignature: () => string;
  ensureLiveSessionId: () => Promise<string>;
  getMessageWindowStart: () => number;
  getMessageWindowEnd: () => number;
  isMessageWindowUserExpanded: () => boolean;
  setMessageWindowUserExpanded: (val: boolean) => void;
  getAverageRowHeightPx: () => number;
  isInitialBottomSettling: () => boolean;
  setInitialBottomSettling: (val: boolean) => void;
  getStreamScrollCooldown: () => boolean;
  setStreamScrollCooldown: (val: boolean) => void;
  getLastStreamScrollTop: () => number;
  setLastStreamScrollTop: (val: number) => void;
  getProgrammaticScrollTarget: () => number | null;
  setProgrammaticScrollTarget: (val: number | null) => void;
  getProgrammaticScrollIgnoreUntil: () => number;
  getLayoutDriftUntil: () => number;
  getReaderScrolledSessionId: () => string;
  setReaderScrolledSessionId: (val: string) => void;
  setSettledLayoutSignature: (val: string) => void;
  cancelSessionEnter?: () => void;
  STICK_TO_BOTTOM_THRESHOLD_PX: number;
  MESSAGE_WINDOW_CAPACITY: number;
}

export interface ConversationStreamController {
  handleCopyMessage(btn: HTMLElement): Promise<void>;
  handleRollbackMessage(btn: HTMLElement): void;
  handleRollbackCancel(): void;
  handleForkMessage(btn: HTMLElement): Promise<void>;
  stopRunningToolTimers(): void;
  updateRunningToolTimers(): void;
  bindDomEvents(): void;
}

export function createConversationStreamController(
  deps: ConversationStreamControllerDeps
): ConversationStreamController {
  const {
    getState,
    render,
    safeCopyText,
    setTimedDockNotice,
    isStreamingActiveForCurrentSession,
    t,
    getGatewayClient,
    getRpcCaller,
    getInteractiveService,
    selectSession,
    scheduleSessionsRefresh,
    getSessionMessagesCache,
    handleOpenFilePreview,
    syncPromptNavigatorFromScroll,
    loadOlderMessages,
    relocateMessageWindowToIndex,
    syncScrollTopToWindow,
    slideMessageWindowForward,
    expandMessageWindow,
    settleInitialBottom,
    scrollStreamToBottom,
    scheduleStreamBottomInset,
    layoutSignature,
    ensureLiveSessionId,
    getMessageWindowStart,
    getMessageWindowEnd,
    isMessageWindowUserExpanded,
    setMessageWindowUserExpanded,
    getAverageRowHeightPx,
    isInitialBottomSettling,
    setInitialBottomSettling,
    getStreamScrollCooldown,
    setStreamScrollCooldown,
    getLastStreamScrollTop,
    setLastStreamScrollTop,
    getProgrammaticScrollTarget,
    setProgrammaticScrollTarget,
    getProgrammaticScrollIgnoreUntil,
    getLayoutDriftUntil,
    getReaderScrolledSessionId,
    setReaderScrolledSessionId,
    setSettledLayoutSignature,
    STICK_TO_BOTTOM_THRESHOLD_PX,
    MESSAGE_WINDOW_CAPACITY,
  } = deps;

  let runningToolTimerHandle: number | undefined;

  function stopRunningToolTimers(): void {
    if (runningToolTimerHandle !== undefined) {
      clearInterval(runningToolTimerHandle);
      runningToolTimerHandle = undefined;
    }
  }

  function updateRunningToolTimers(): void {
    if (typeof document === 'undefined') return;
    if (!isStreamingActiveForCurrentSession()) {
      stopRunningToolTimers();
      return;
    }

    const activeBadges = document.querySelectorAll<HTMLElement>('.tool-duration-badge[data-start-time]');
    if (activeBadges.length === 0) {
      stopRunningToolTimers();
      return;
    }

    const tick = () => {
      if (!isStreamingActiveForCurrentSession()) {
        stopRunningToolTimers();
        return;
      }

      const badges = document.querySelectorAll<HTMLElement>('.tool-duration-badge[data-start-time]');
      if (badges.length === 0) {
        stopRunningToolTimers();
        return;
      }
      const now = Date.now();
      badges.forEach((b) => {
        const startTime = Number(b.dataset.startTime);
        if (startTime && !isNaN(startTime)) {
          if (now - startTime > 10 * 60 * 1000) {
            b.removeAttribute('data-start-time');
            return;
          }
          const elapsedSec = Math.max(0.1, (now - startTime) / 1000);
          b.textContent = `${elapsedSec.toFixed(1)}s`;
        }
      });
    };

    tick();
    if (runningToolTimerHandle === undefined && typeof window !== 'undefined') {
      runningToolTimerHandle = window.setInterval(tick, 200);
    }
  }

  async function handleCopyMessage(btn: HTMLElement): Promise<void> {
    const state = getState();
    await messageActionController.executeCopy(
      btn,
      state.messages,
      safeCopyText,
      setTimedDockNotice,
      t('common.copied')
    );
  }

  function handleRollbackMessage(btn: HTMLElement): void {
    const state = getState();
    const rowEl = btn.closest<HTMLElement>('[data-msg-id]');
    const msgId = btn.getAttribute('data-msg-id') || rowEl?.getAttribute('data-msg-id') || '';
    const rawRowId = btn.getAttribute('data-row-id') || rowEl?.getAttribute('data-row-id');
    const btnRowId = rawRowId ? parseInt(rawRowId, 10) : undefined;

    const resolvedTarget = resolveRollbackTarget({
      messages: state.messages,
      msgId,
      btnRowId,
    });

    const effectiveTargetId = resolvedTarget?.targetMsg.id || msgId;

    const plan = planTruncate({
      messages: state.messages,
      targetId: effectiveTargetId,
      sessionKind: deriveSessionKind(state.activeFocus),
      isStreaming: isStreamingActiveForCurrentSession(),
    });

    if (plan.mode === 'blocked') {
      const reasonText =
        plan.reason === 'streaming'
          ? t('chat.rollbackBlockedStreaming')
          : plan.reason === 'unsupported-scope'
            ? t('chat.rollbackBlockedScope')
            : t('chat.rollback');
      setTimedDockNotice(reasonText);
      render();
      return;
    }

    const targetMsg = state.messages.find((m) => m.id === plan.targetId);
    const textarea = typeof document !== 'undefined'
      ? (document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null)
      : null;
    const refilled = messageActionController.executeRollback(
      btn,
      state.messages,
      textarea,
      setTimedDockNotice,
      t('chat.rollbackSuccess')
    );

    if (plan.mode === 'refill-only') {
      setTimedDockNotice(t('chat.rollbackNoAnchor'));
      render();
      return;
    }

    if (plan.anchor.kind !== 'row') return;
    const originalMessages = state.messages;
    const cut = applyOptimisticCut(originalMessages, plan.anchor);
    if (!cut) {
      setTimedDockNotice(t('chat.rollbackNoAnchor'));
      render();
      return;
    }

    state.messages = cut.kept;
    if (state.activeSessionId) {
      getSessionMessagesCache().set(state.activeSessionId, [...state.messages]);
    }
    void refilled;
    state.rollbackArmed = {
      sessionId: state.activeSessionId,
      targetId: plan.targetId,
      anchor: plan.anchor,
      snapshot: originalMessages.map((m) => ({ ...m })),
      removedCount: cut.removed.length,
      anchorLabel: targetMsg?.timestamp || `#${plan.anchor.rowId}`,
    };
    render();
  }

  function handleRollbackCancel(): void {
    const state = getState();
    const armed = state.rollbackArmed;
    if (!armed) return;
    if (armed.sessionId !== state.activeSessionId) {
      state.rollbackArmed = null;
      render();
      return;
    }
    state.messages = armed.snapshot.map((m) => ({ ...m }));
    getSessionMessagesCache().set(armed.sessionId, [...state.messages]);
    state.rollbackArmed = null;
    setTimedDockNotice(t('chat.rollbackCancelled'));
    render();
  }

  async function handleForkMessage(btn: HTMLElement): Promise<void> {
    const gatewayClient = getGatewayClient();
    if (!gatewayClient) {
      setTimedDockNotice(t('chat.gatewayNotConnected'));
      return;
    }
    const liveId = await ensureLiveSessionId();
    if (!liveId) {
      setTimedDockNotice(t('chat.forkNoLive'));
      render();
      return;
    }
    const state = getState();
    await messageActionController.executeFork(btn, {
      activeSessionId: liveId,
      profileName: state.profileName || 'default',
      messages: state.messages,
      forkSession: (input) =>
        getInteractiveService().forkSession(getRpcCaller(), {
          sessionId: input.sessionId,
          count: input.count,
          profile: input.profile,
          idempotencyKey: input.idempotencyKey,
        }),
      onSuccess: async (newSessionId) => {
        await selectSession(newSessionId);
        scheduleSessionsRefresh();
      },
      setNotice: setTimedDockNotice,
      labels: {
        notConnected: t('chat.gatewayNotConnected'),
        forking: t('chat.forking'),
        success: t('chat.forkSuccess'),
        failed: t('chat.forkFailed'),
      },
    });
  }

  function bindDomEvents(): void {
    if (typeof document === 'undefined') return;

    const state = getState();
    const streamEl = document.getElementById('conversation-stream');

    if (streamEl) {
      streamEl.onscroll = () => {
        syncPromptNavigatorFromScroll();

        const progTarget = getProgrammaticScrollTarget();
        /**
         * 【判定程序化滚动 (Why)】忽略窗口内必须把 scrollTop 的「向下回退」也视为程序化：
         *   布局 clamp（内容高度收缩 / 末行重排）会让 scrollTop 变小，若沿用
         *   `scrollTop >= lastStreamScrollTop` 的方向限制，这种 6px 回退会被误判成读者手势，
         *   直接 cancelSessionEnter() 杀掉进入计划（实测首屏因此永远落不到底）。
         * 【方向判别不可省 (Pitfall)】只按「窗口内 ⇒ 程序化」判定会反向误杀读者手势：
         *   贴底写入后 180ms 窗口内读者向上滚动也被吞掉，视口随即被 reassertActivePin 拽回底部，
         *   最坏情况在 armed 的 600 帧窗口内（约 10 秒）无法回溯历史。
         *   因此窗口内只豁免「小幅回退（布局 clamp）」，向上超过阈值的位移仍是读者手势。
         * 【同一时基 (Rules)】忽略截止由 markProgrammaticScroll 以 performance.now() 写入，
         *   这里的比较必须同域，禁止混用 Date.now()。
         * 【取样顺序 (Rules)】previousTop 必须先于判定取值：它同时是方向判别的基准与后续手势判据。
         */
        const previousTop = getLastStreamScrollTop();
        const inIgnoreWindow = performance.now() <= getProgrammaticScrollIgnoreUntil();
        const isLayoutClamp = inIgnoreWindow && streamEl.scrollTop >= previousTop - 8;
        const isProgrammatic =
          (progTarget !== null && Math.abs(streamEl.scrollTop - progTarget) <= 2)
          || isLayoutClamp;

        if (progTarget !== null && Math.abs(streamEl.scrollTop - progTarget) <= 2) {
          setProgrammaticScrollTarget(null);
        }

        if (!isProgrammatic && performance.now() > getLayoutDriftUntil() && Math.abs(streamEl.scrollTop - previousTop) > 4) {
          setInitialBottomSettling(false);
          deps.cancelSessionEnter?.();
          if (streamEl.scrollTop < previousTop - 4) {
            setReaderScrolledSessionId(state.activeSessionId);
            setSettledLayoutSignature(layoutSignature());
          }
        }
        setLastStreamScrollTop(streamEl.scrollTop);

        if (isInitialBottomSettling()) return;

        const distanceToBottom = streamEl.scrollHeight - streamEl.scrollTop - streamEl.clientHeight;
        const isNearBottomNow = distanceToBottom <= STICK_TO_BOTTOM_THRESHOLD_PX;

        if (isNearBottomNow) {
          scheduleStreamBottomInset();
          // 【双因子退出闭环 (Why)】当物理贴底且窗口已覆盖尾部时，宣告读者已回到最新对话流，
          //   解除 userExpanded 锁定并清空 readerScrolledSessionId，允许后续微漂移重新自动吸附。
          if (getMessageWindowEnd() >= state.messages.length) {
            if (isMessageWindowUserExpanded()) {
              setMessageWindowUserExpanded(false);
              setReaderScrolledSessionId('');
            }
          }
        }

        if (getStreamScrollCooldown() || state.isLoadingOlder) return;

        const viewportPrefetch = Math.max(800, streamEl.clientHeight * 1.0);
        const virtualWindowEl = document.querySelector<HTMLElement>('.conv-virtual-window');
        const expandPrefetch = computeExpandPrefetchPx(
          streamEl.clientHeight,
          virtualWindowEl?.getBoundingClientRect().height
        );

        const msgWindowEnd = getMessageWindowEnd();
        const msgWindowStart = getMessageWindowStart();
        const avgRowHeight = getAverageRowHeightPx();

        // 1. 获取当前挂载窗口的实际物理几何（优先取 DOM 实测高度，回退取切片名义估算）
        const virtualWindowTop = Math.round(msgWindowStart * avgRowHeight);
        const realWindowHeight = virtualWindowEl?.getBoundingClientRect().height;
        const windowHeight = typeof realWindowHeight === 'number' && Number.isFinite(realWindowHeight) && realWindowHeight > 0
          ? realWindowHeight
          : Math.max(1, msgWindowEnd - msgWindowStart) * avgRowHeight;
        const currentWindowBottom = virtualWindowTop + windowHeight;
        const currentViewportBottom = streamEl.scrollTop + streamEl.clientHeight;

        // 2. 真实计算视口底边距离当前挂载窗口底边的间距
        const distanceToWindowEnd = currentWindowBottom - currentViewportBottom;
        const isAtTail = msgWindowEnd >= state.messages.length;

        // 3. 【向下平滑滑窗 (Why)】当未到尾部且视口底边自然接近当前窗口底边时（在下沿预取带内），顺畅向前滑动窗口。
        //   若整个视口已深度跌出当前窗口之外（<-clientHeight * 0.5），则属于拖拽滚动条跨越式寻址，必须放行至下面的 outside 分支直接重定位。
        const isNearWindowBottomEdge = distanceToWindowEnd < viewportPrefetch
          && distanceToWindowEnd >= -streamEl.clientHeight * 0.5;

        if (!isAtTail && isNearWindowBottomEdge) {
          setStreamScrollCooldown(true);
          slideMessageWindowForward();
          if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(() => { setStreamScrollCooldown(false); });
          } else {
            setStreamScrollCooldown(false);
          }
          return;
        }

        if (state.messages.length > MESSAGE_WINDOW_CAPACITY) {
          // 【对齐真实物理底边 (Pitfall)】出界上限必须结合 realWindowBottom，防范包含万级像素巨型工具块时
          //   因名义 virtualBottom 远小于实际内容而误判出界提前卸载 DOM；下界扣除 clientHeight 消除死区空白。
          const realWindowBottom = Math.max(Math.round(msgWindowEnd * avgRowHeight), currentWindowBottom);
          const outside = streamEl.scrollTop < virtualWindowTop - streamEl.clientHeight * 1.5
            || streamEl.scrollTop > realWindowBottom + streamEl.clientHeight * 0.5;
          if (outside) {
            // 【解耦滚动条拖拽直接寻址 (Why)】当读者直接拖动滚动条跨越式跳转（Seek）时，这是显式定位意图，
            //   无条件放行 relocateMessageWindowToIndex，严禁退化回 scrollStreamToBottom 强行把滚动条踢到底部。
            const targetIndex = Math.floor(streamEl.scrollTop / Math.max(1, avgRowHeight));
            if (relocateMessageWindowToIndex(targetIndex)) {
              setStreamScrollCooldown(true);
              render();
              const handoffToFetch =
                msgWindowStart === 0
                && streamEl.scrollTop < expandPrefetch
                && state.hasOlderMessages
                && getReaderScrolledSessionId() === state.activeSessionId;
              if (!handoffToFetch) {
                if (typeof requestAnimationFrame !== 'undefined') {
                  requestAnimationFrame(() => {
                    syncScrollTopToWindow('scrollbar jump');
                    setStreamScrollCooldown(false);
                  });
                } else {
                  syncScrollTopToWindow('scrollbar jump');
                  setStreamScrollCooldown(false);
                }
                return;
              }
              if (typeof requestAnimationFrame !== 'undefined') {
                requestAnimationFrame(() => {
                  syncScrollTopToWindow('scrollbar jump');
                });
              } else {
                syncScrollTopToWindow('scrollbar jump');
              }
            }
          }
        }

        const upwardAction = planUpwardScrollAction({
          sessionId: state.activeSessionId,
          readerScrolledSessionId: getReaderScrolledSessionId(),
          total: state.messages.length,
          capacity: MESSAGE_WINDOW_CAPACITY,
          windowStart: msgWindowStart,
          hasOlderMessages: state.hasOlderMessages,
          scrollTop: streamEl.scrollTop,
          virtualWindowTopPx: virtualWindowTop,
          expandPrefetchPx: expandPrefetch,
        });

        if (upwardAction === 'none') return;
        if (state.activeFocus.type === 'group') return;

        if (upwardAction === 'settle-bottom') {
          setInitialBottomSettling(true);
          settleInitialBottom();
          scrollStreamToBottom('initial window offscreen');
          return;
        }

        if (upwardAction === 'expand-local-window') {
          setStreamScrollCooldown(true);
          const expanded = expandMessageWindow();
          if (expanded) {
            requestAnimationFrame(() => { setStreamScrollCooldown(false); });
            return;
          }
          setStreamScrollCooldown(false);
          return;
        }

        setStreamScrollCooldown(true);
        requestAnimationFrame(async () => {
          try {
            let chain = 0;
            do {
              const before = state.messages.length;
              await loadOlderMessages();
              chain += 1;
              const el = document.getElementById('conversation-stream');
              const stillNearTop = Boolean(el && computeStillNearTop(el.scrollTop, el.clientHeight));
              if (state.messages.length === before) break;
              if (!stillNearTop || !state.hasOlderMessages) break;
            } while (chain < 40);
          } finally {
            setTimeout(() => {
              setStreamScrollCooldown(false);
            }, 60);
          }
        });
      };

      /**
       * 【打断语义一致 (Why)】两个入口对「什么算用户手势」必须一致：只有向上滚动（或显著位移）
       *   才算读者接管视口；向下滚应保留 armed 贴底意图，否则读者一次向下微调就会把
       *   尚未落定的进入计划打死，首屏停在半空。
       * 【防范历史坑 (Pitfall)】旧实现把 cancel 放在 guard 之前无条件执行（含向下滚、含 cooldown 期），
       *   与 onscroll 的 `!isProgrammatic && 位移 > 4` 判据双标。
       * 【与下方 guard 同源 (Rules)】方向判据必须与 `e.deltaY >= 0` 的早退条件严格互补：
       *   `deltaY` 缺失（合成事件 / 旧内核）按读者手势处理，绝不静默吞掉取消。
       */
      streamEl.onwheel = (e: WheelEvent) => {
        const isDownwardWheel = Boolean(e && e.deltaY >= 0);
        if (!isDownwardWheel) deps.cancelSessionEnter?.();
        if (e && e.deltaY >= 0 || getStreamScrollCooldown() || state.isLoadingOlder) return;
        if (state.activeFocus.type === 'group' || !state.activeSessionId || !state.hasOlderMessages) return;
        const isShortNoOverflow = streamEl.scrollHeight <= streamEl.clientHeight + 4;
        if (isShortNoOverflow) {
          setInitialBottomSettling(false);
        }
        if (isInitialBottomSettling()) return;
        if (streamEl.scrollTop <= 4 || isShortNoOverflow) {
          setReaderScrolledSessionId(state.activeSessionId);
          setSettledLayoutSignature(layoutSignature());
          streamEl.onscroll?.(new Event('scroll'));
        }
      };
    }

    if (streamEl && streamEl.dataset.fileLinkDelegated !== 'true') {
      streamEl.dataset.fileLinkDelegated = 'true';
      streamEl.addEventListener('click', (e) => {
        const cancelBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-action="rollback-cancel"]');
        if (cancelBtn) {
          e.stopPropagation();
          e.preventDefault();
          handleRollbackCancel();
          return;
        }
        const actionBtn = (e.target as HTMLElement).closest<HTMLElement>('.msg-action-btn[data-action]');
        if (actionBtn) {
          const action = actionBtn.getAttribute('data-action');
          if (action === 'copy-msg') {
            e.stopPropagation();
            e.preventDefault();
            void handleCopyMessage(actionBtn);
            return;
          }
          if (action === 'rollback-msg') {
            e.stopPropagation();
            e.preventDefault();
            handleRollbackMessage(actionBtn);
            return;
          }
          if (action === 'fork-msg') {
            e.stopPropagation();
            e.preventDefault();
            void handleForkMessage(actionBtn);
            return;
          }
        }

        const linkEl = (e.target as HTMLElement).closest<HTMLElement>('.tool-file-link, [data-preview-file], [data-preview-url]');
        if (linkEl) {
          e.stopPropagation();
          e.preventDefault();
          const filePath = linkEl.getAttribute('data-preview-file') || linkEl.dataset.previewFile || '';
          const previewUrl = linkEl.getAttribute('data-preview-url') || linkEl.dataset.previewUrl || '';
          if (filePath || previewUrl) {
            void handleOpenFilePreview(filePath || previewUrl, previewUrl);
          }
        }
      });
    }

    document.querySelectorAll<HTMLElement>('.tool-file-link, [data-preview-file], [data-preview-url]').forEach((link) => {
      link.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        const filePath = link.getAttribute('data-preview-file') || link.dataset.previewFile || '';
        const previewUrl = link.getAttribute('data-preview-url') || link.dataset.previewUrl || '';
        if (filePath || previewUrl) {
          void handleOpenFilePreview(filePath || previewUrl, previewUrl);
        }
      };
    });

    updateRunningToolTimers();
  }

  return {
    handleCopyMessage,
    handleRollbackMessage,
    handleRollbackCancel,
    handleForkMessage,
    stopRunningToolTimers,
    updateRunningToolTimers,
    bindDomEvents,
  };
}
