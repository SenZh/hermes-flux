/**
 * 提交后驱动观察器（Post-Commit Pin Observers）
 *
 * 【设计意图 (Why)】
 *   React 的提交时机与 rAF 推进帧无固定先后：提交晚于推进帧时，单靠 `render()` 里的推进
 *   永远看不到真实末行（实测停在半空差 7958px）。这里用 MutationObserver 观察消息列表宿主、
 *   ResizeObserver 观察画布，在提交后合并成一帧再调用 `reassertActivePin()`，
 *   保证 armed 计划被真实 DOM 驱动。
 *
 *   从 `renderCoordinator.ts` 剥离为独立单元，使「挂载 / 重建 / 合并 / 释放」这四个契约
 *   可以在无真实 DOM 内核的环境里被确定性验证——它们此前只在真实 Blink 里才暴露，
 *   任何一处退化都表现为「切会话不贴底」，而 Node 侧全绿。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 宿主元素被 React 岛重建后不重绑：观察器仍挂在已卸载的旧节点上，
 *      提交回调永不再触发，armed 计划只能等 600 帧硬上限（约 10 秒不跟随）。
 *   2. 每次变更各自排一条 rAF：流式输出每帧数十次 mutation，对齐链被并行铺开，
 *      帧配额被 N 倍速烧穿，内容真正稳定前就被兜底截断。
 *   3. 无 armed 计划时仍回调：流式输出期每帧都有 mutation，造成全程无意义开销。
 *   4. dispose 后不断开：宿主卸载后观察器仍在回调，写已销毁的 DOM。
 *
 * 【约束与规则 (Rules)】
 *   1. 宿主元素变化时必须**先 disconnect 旧观察器再 observe 新元素**，绝不并存；
 *   2. 同一元素重复 ensure 不得重复 observe（重复 observe 会叠加回调）；
 *   3. 多次变更合并到同一帧：一帧内最多一次 `reassertActivePin()`；
 *   4. `isSessionEnterPending() === false` 时回调必须纯 no-op（流式期零额外开销）；
 *   5. 运行环境缺少 MutationObserver / ResizeObserver 时安全跳过（单测与旧内核）；
 *   6. 观察器只读事件、不直接写 DOM，具体对齐交由 streamViewportManager 裁决。
 */

export interface PostCommitPinObserverHost {
  /** 消息列表宿主（React 岛挂载点）。 */
  readonly getMessageHost: () => HTMLElement | null;
  /** 对话画布（`.conv-canvas`），用于捕捉内容高度变化。 */
  readonly getCanvasElement: () => HTMLElement | null;
  /** 是否有挂起的会话进入计划；false 时观察器回调必须是纯 no-op。 */
  readonly isSessionEnterPending: () => boolean;
  /** 提交后重新对齐 armed 计划（幂等、无参）。 */
  readonly reassertActivePin: () => void;
  /** 帧调度器，缺省走全局 requestAnimationFrame；两者都缺失时同步执行。 */
  readonly requestFrame?: (callback: () => void) => void;
}

export interface PostCommitPinObservers {
  /** 幂等地挂载 / 重建观察器；每帧 render 都可调用。 */
  ensure(): void;
  /** 断开全部观察器并清空挂起标记。 */
  dispose(): void;
  /** 是否有已排队但未执行的对齐帧（供宿主与单测观测）。 */
  isReassertScheduled(): boolean;
}

export function createPostCommitPinObservers(host: PostCommitPinObserverHost): PostCommitPinObservers {
  let mutationObserver: MutationObserver | null = null;
  let mutationTarget: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let resizeTarget: HTMLElement | null = null;
  let reassertScheduled = false;

  /**
   * 把多次 DOM 变更合并到同一帧。
   * 【规则】无 armed 计划时直接跳过；同一帧内只允许一条排队帧。
   */
  function scheduleReassert(): void {
    if (!host.isSessionEnterPending()) return;
    if (reassertScheduled) return;
    reassertScheduled = true;
    const flush = (): void => {
      reassertScheduled = false;
      host.reassertActivePin();
    };
    if (host.requestFrame) {
      host.requestFrame(flush);
      return;
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(flush);
      return;
    }
    flush();
  }

  function ensure(): void {
    const messageHost = host.getMessageHost();
    if (messageHost && typeof MutationObserver !== 'undefined' && mutationTarget !== messageHost) {
      // 【先断后挂 (Rules)】旧宿主可能已被 React 卸载，不断开就会留下一个永不回调的僵尸观察器。
      mutationObserver?.disconnect();
      mutationObserver = new MutationObserver(() => scheduleReassert());
      mutationObserver.observe(messageHost, { childList: true, subtree: true, characterData: true });
      mutationTarget = messageHost;
    }

    const canvas = host.getCanvasElement();
    if (canvas && typeof ResizeObserver !== 'undefined' && resizeTarget !== canvas) {
      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(() => scheduleReassert());
      resizeObserver.observe(canvas);
      resizeTarget = canvas;
    }
  }

  function dispose(): void {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
      mutationTarget = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
      resizeTarget = null;
    }
    reassertScheduled = false;
  }

  return {
    ensure,
    dispose,
    isReassertScheduled: () => reassertScheduled,
  };
}
