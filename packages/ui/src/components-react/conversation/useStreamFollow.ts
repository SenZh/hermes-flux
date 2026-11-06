/**
 * 滚动跟随 hook
 *
 * 设计意图(Why)：
 *   流式输出时用户贴底则跟随，回看历史则完全不打扰；阈值固定 48px。
 *
 * 防范的历史坑(Pitfall)：
 *   写 innerHTML 后立刻读 scrollHeight 会强制同步重排，高频流式下造成掉帧；
 *   因此只在需要跟随的帧写一次 scrollTop，写完不回读几何。
 *
 * 约束与规则(Rules)：
 *   1. 禁止 scroll-behavior: smooth；
 *   2. 禁止在滚动容器上写 transform；
 *   3. 阈值 48px 是全局不变量，不得按组件覆写。
 */

import { useEffect, useRef, type RefObject } from 'react';

export const STREAM_FOLLOW_THRESHOLD_PX = 48;

export interface StreamFollowBinding<T extends HTMLElement> {
  ref: RefObject<T | null>;
  onScroll: () => void;
}

export function useStreamFollow<T extends HTMLElement>(deps: readonly unknown[]): StreamFollowBinding<T> {
  const ref = useRef<T | null>(null);
  const followRef = useRef(true);

  const onScroll = (): void => {
    const el = ref.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    followRef.current = distance <= STREAM_FOLLOW_THRESHOLD_PX;
  };

  useEffect(() => {
    const el = ref.current;
    if (!el || !followRef.current) return;
    el.scrollTop = el.scrollHeight;
    // 不在此处读取任何几何值，避免强制重排
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ref, onScroll };
}
