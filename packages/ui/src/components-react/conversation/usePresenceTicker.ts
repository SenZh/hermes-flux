/**
 * 眨眼节拍器（Presence Blink Ticker）
 *
 * 【设计意图 (Why)】
 *   形变是整体的，眨眼才是「有生命」的强信号。但眨眼不能写 CSS `animation: infinite`：
 *   CSS 无法表达非等距间隔，等距眨眼会像节拍器，反而更像机器。
 *   因此这里复用仓库既有的 `useNow` 集中时钟范式：一次只挂一个 `setTimeout` 链，
 *   间隔由 `core` 的纯函数 `nextBlinkDelayMs(seed)` 派生（落在 [2800, 5400) 的非等距抖动）。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 用 `requestAnimationFrame` 常驻循环驱动眨眼，会在整整一个回合里持续占用合成器，
 *      而眨眼的占空比只有约 3%。因此这里禁止 rAF，只允许 setTimeout 链。
 *   2. 页面隐藏后定时器若继续推进，Electron 后台窗口会持续唤醒 CPU。
 *      必须监听 `visibilitychange`：hidden 立即清定时器，visible 重排。
 *   3. `active` 变 false（终态 failed / interrupted）时必须立刻清定时器并回到睁眼，
 *      否则头像会在「已经停住了」的状态下继续眨眼，语义自相矛盾。
 *   4. 依赖数组漏掉 `seed` 会让换会话后节拍不重排，两个会话共用同一个假节拍。
 *
 * 【约束与规则 (Rules)】
 *   1. 返回 true 表示当前处于「闭眼」帧（约 140ms）；
 *   2. `active === false` 立即返回 false 且不创建任何定时器；
 *   3. 卸载必须清理定时器与事件监听，禁止泄漏；
 *   4. 服务端渲染（无 `document`）时恒返回 false，不抛错。
 */

import { useEffect, useState } from 'react';
import { nextBlinkDelayMs } from '@hermes-flux/core';

/** 闭眼持续时长（ms）：短促到不会被读成「卡住」 */
const BLINK_CLOSED_MS = 140;

/**
 * 眨眼时钟。
 *
 * @param active 是否允许眨眼（终态必须传 false）
 * @param seed   节拍种子（会话/群成员指纹），同一 seed 内节拍确定
 * @returns 是否处于闭眼帧
 */
export function usePresenceTicker(active: boolean, seed: string): boolean {
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    if (!active) {
      setBlinking(false);
      return;
    }
    // 服务端渲染 / 测试环境无 document：不推进节拍，也不报错
    if (typeof document === 'undefined') return;

    let disposed = false;
    let blinkTimer: ReturnType<typeof setTimeout> | null = null;
    let openTimer: ReturnType<typeof setTimeout> | null = null;
    let tickIndex = 0;

    const clearTimers = (): void => {
      if (blinkTimer !== null) {
        clearTimeout(blinkTimer);
        blinkTimer = null;
      }
      if (openTimer !== null) {
        clearTimeout(openTimer);
        openTimer = null;
      }
    };

    /** 排下一次眨眼；页面隐藏时不排（visibilitychange 回来时会重排） */
    const scheduleNext = (): void => {
      if (disposed || document.visibilityState === 'hidden') return;
      const delay = nextBlinkDelayMs(`${seed}:${tickIndex}`);
      tickIndex += 1;
      blinkTimer = setTimeout(() => {
        blinkTimer = null;
        if (disposed) return;
        setBlinking(true);
        openTimer = setTimeout(() => {
          openTimer = null;
          if (disposed) return;
          setBlinking(false);
          scheduleNext();
        }, BLINK_CLOSED_MS);
      }, delay);
    };

    const onVisibilityChange = (): void => {
      if (disposed) return;
      if (document.visibilityState === 'hidden') {
        clearTimers();
        setBlinking(false);
        return;
      }
      // 回到前台：从头重排一次，避免把隐藏期间的节拍一次性补播
      clearTimers();
      scheduleNext();
    };

    scheduleNext();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      disposed = true;
      clearTimers();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [active, seed]);

  return active && blinking;
}
