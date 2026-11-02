/**
 * 流式工具胶囊增量补丁队列（packages/desktop/src/renderer/toolPatchQueue.ts）
 *
 * 【设计意图 (Why)】
 * 工具事件（tool.start / tool.complete）只改消息内部字段、不改消息条数，
 * 全量画布重建在流式期间被短路跳过，导致胶囊“整轮结束后才瞬间刷出”。
 * 本队列把每个受影响 messageId 合并到单帧一次直写其 #msg-tools-<id> 子树，
 * 让工具链在流式过程中实时上屏，同时避免逐事件触发全量 render。
 *
 * 【防范的历史坑 (Pitfall)】
 * - 每事件一次 RAF 会在高频工具流下每帧多次重写同一子树：用 Set 去重 + 单 RAF 合并；
 * - 帧内读 offsetHeight/getBoundingClientRect 会强制同步布局：本模块只在帧首读一次贴底布尔、
 *   帧尾写一次 scrollTop，绝不在写 innerHTML 后回读几何；
 * - 容器缺失（画布尚未挂载该行）时不可静默丢弃，必须回灌一个结构重绘请求交全量兜底。
 *
 * 【约束与规则 (Rules)】
 * - 纯 DOM 写入，不触碰 React/框架，不写高层 CSS 变量（防继承重排爆炸）；
 * - schedule 注入点由生产 requestAnimationFrame、测试可手动推进。
 */

export interface ToolPatchDeps {
  /** 渲染某消息的工具插槽 innerHTML；返回空串表示清空容器 */
  renderSlot: (messageId: string) => string;
  /** 容器存在则写入并返回 true；缺失返回 false，触发 structureDirty 兜底 */
  patchElement: (messageId: string, html: string) => boolean;
  /** 读者是否处于贴底吸附区（帧首读一次） */
  isNearBottom: () => boolean;
  /** 帧尾贴底（仅当帧首判定为贴底时调用） */
  scrollBottom: () => void;
  /** 标记需要一次全量结构重建（容器缺失时） */
  markStructureDirty: () => void;
  /** rAF 注入 */
  schedule: (cb: () => void) => void;
}

export function createToolPatchQueue(deps: ToolPatchDeps) {
  const pending = new Set<string>();
  let scheduled = false;

  function flush(): void {
    scheduled = false;
    if (pending.size === 0) return;
    // 帧首读一次布局状态，帧内不再读几何，杜绝强制同步布局
    const followBottom = deps.isNearBottom();
    const ids = [...pending];
    pending.clear();
    for (const id of ids) {
      const html = deps.renderSlot(id);
      const ok = deps.patchElement(id, html);
      if (!ok) deps.markStructureDirty();
    }
    if (followBottom) deps.scrollBottom();
  }

  function schedulePatch(messageId: string): void {
    if (!messageId) return;
    pending.add(messageId);
    if (scheduled) return;
    scheduled = true;
    deps.schedule(flush);
  }

  function clear(): void {
    pending.clear();
    scheduled = false;
  }

  return { schedulePatch, flush, clear, get size(): number { return pending.size; } };
}
