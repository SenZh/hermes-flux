/**
 * 流式 DOM 单所有者判定与正文显隐翻转（纯函数层）
 *
 * 【设计意图 (Why)】
 *   这两条判定原本嵌在 `index.ts` 的装配闭包里，无法脱离宿主单测：
 *   1. `toolPatchQueue.patchElement` 的三分支守卫是「迟到 rAF 覆写 React `<ToolBlocks>`」的唯一防线；
 *   2. `setMessageContent` 的 display 翻转是「收口瞬间回合高度突变」的另一半根因。
 *   抽成纯函数后，三分支与 display 终态都能用行为断言钉死，杜绝「生产逻辑改了、测试没跟着改」。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 守卫若把「非当前活跃流式消息」判成可直写，迟到补丁会覆写 React 已提交的收口子树，
 *      再次出现 `toolsChildren === 2` 与 `removeChild` 失配；
 *   2. 正文锚点首写若回填 `flex` / `flexDirection`，收口时 React 清理内联样式会触发
 *      flex→block 边距折叠，回合高度突变把视口顶离底部安全区。
 *
 * 【约束与规则 (Rules)】
 *   1. 判定只依赖入参，不读全局状态、不触 DOM，保证可脱宿主单测；
 *   2. 正文容器只允许 none → block，绝不写 `flex` / `flexDirection`；
 *   3. 已处于可见态（非 none）时不得覆盖既有 display，保护既有布局语义。
 */

export interface StreamingToolPatchOwnership {
  /** 当前会话是否处于流式生成态 */
  isStreamingActive: boolean;
  /** 当前活跃流式消息 ID（无在途消息时为空） */
  activeStreamingMessageId: string | null;
  /** 本次补丁的目标消息 ID */
  messageId: string;
}

/**
 * 是否允许把工具补丁直写进 `#msg-tools-<id>`。
 *
 * 【为什么必须两者同时成立 (Why)】
 *   仅判「会话在流式」不足以定位唯一所有者：同一回合内多行都有工具锚点，
 *   只有 `activeStreamingMessageId` 对应的那一行由直写通道持有 DOM；
 *   其余行必须让位给 React 渲染，否则会覆盖已收口子树的子节点。
 */
export function shouldPatchStreamingTools(ownership: StreamingToolPatchOwnership): boolean {
  return ownership.isStreamingActive && ownership.activeStreamingMessageId === ownership.messageId;
}

/**
 * 把流式正文锚点从隐形态点亮为块级可见态。
 *
 * 【为什么只写 display:block (Why)】
 *   `.conv-markdown` 默认即为块级布局；写成 flex 会在收口时 React 清掉内联样式后
 *   发生 flex→block 的边距折叠，造成回合高度突变（实测 dSh=+528px、dSt=0）。
 */
export function revealStreamingContentDisplay(style: { display: string }): void {
  if (style.display === 'none') {
    style.display = 'block';
  }
}
