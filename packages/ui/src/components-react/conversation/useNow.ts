/**
 * 共享秒脉冲
 *
 * 设计意图(Why)：
 *   运行中的工具需要每秒推进一次耗时显示；若每个胶囊各开一个 setInterval，
 *   同一回合多个并发工具会叠加多个定时器。此 hook 只在存在 running 项时启用一个共享定时器。
 *
 * 约束与规则(Rules)：
 *   1. active=false 时不创建定时器；
 *   2. 卸载或 active 变化必须清理，禁止泄漏；
 *   3. 间隔固定 1000ms，不得用于动画帧驱动。
 */
import { useEffect, useState } from 'react';

export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);

  return now;
}
