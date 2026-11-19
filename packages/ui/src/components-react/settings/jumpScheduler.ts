/**
 * 检索跳转的定时器调度器（纯逻辑，零 React / 零 DOM）。
 *
 * 【设计意图 (Why)】跳转定位需要"重试若干次 + 1.6s 后移除高亮"两类定时器，
 *   它们必须能被统一取消：弹窗关闭、组件卸载、用户再次发起跳转都要清空上一轮。
 *   把调度与取消收进一个可注入 timer 的对象后，测试可以用假 timer 断言
 *   "登记了几个、取消后剩几个"，而不是只 grep 符号是否存在。
 *
 * 【防范的历史坑 (Pitfall)】直接散落 `window.setTimeout` 时，清理只能靠"卸载 effect"，
 *   而设置弹窗关闭走 `return null`（组件仍挂载），关闭路径根本不会触发卸载清理。
 *
 * 【约束与规则 (Rules)】
 *   1. 每个 setTimeout 必须立刻登记 id，禁止绕过 schedule 直接调用宿主 timer；
 *   2. dispose 必须幂等：重复调用不得抛错、不得遗留 id；
 *   3. 本模块不持有 DOM 引用，宿主 timer 由调用方注入；
 *   4. 宿主 `setTimeout` 必须**异步**调用回调（与浏览器语义一致）。
 *      schedule 在回调里引用 `id` 做自身出队，同步回调会在赋值前访问 `id`（TDZ）。
 *   5. dispose 之后仍允许 schedule：设置弹窗关闭后可再次打开，调度器不锁死。
 */

export interface JumpTimerHost {
  /**
   * 必须异步调用回调（浏览器 setTimeout 语义）。
   * 同步实现会让 schedule 的回调在 `id` 赋值前访问它（TDZ）。
   */
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

export interface JumpScheduler {
  /** 安排一次回调并登记句柄。 */
  schedule: (fn: () => void, ms: number) => number;
  /** 取消全部已登记句柄并清空登记表（幂等）。 */
  dispose: () => void;
  /** 当前未执行的句柄数量（测试与调试用）。 */
  pending: () => number;
}

export function createJumpScheduler(host: JumpTimerHost): JumpScheduler {
  const ids: number[] = [];

  return {
    schedule(fn, ms) {
      const id = host.setTimeout(() => {
        // 执行后即出队：避免 dispose 对已执行句柄重复 clearTimeout。
        const index = ids.indexOf(id);
        if (index >= 0) ids.splice(index, 1);
        fn();
      }, ms);
      ids.push(id);
      return id;
    },
    dispose() {
      // try/finally：单个句柄取消失败时仍要清空登记表，否则二次 dispose 变成空转。
      // 异常照常向上冒泡（失败不可静默），只是不再遗留脏 id。
      try {
        for (const id of ids) host.clearTimeout(id);
      } finally {
        ids.length = 0;
      }
    },
    pending() {
      return ids.length;
    },
  };
}
