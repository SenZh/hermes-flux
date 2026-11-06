/**
 * 对话区快照推送决策（纯函数）
 *
 * 设计意图(Why)：
 *   流式期间不向 React 推快照，正文由锚点直写；只有出现新消息行、或流式刚结束那一帧才收敛。
 *   把判定抽成纯函数，才能用四象限用例真实证伪，而不是靠人工约定。
 *
 * 约束与规则(Rules)：
 *   1. force 优先；
 *   2. 出现新 id 必须推送（否则新消息没有锚点，token 无处可写）；
 *   3. 流式刚结束必须推送一次（收敛完整正文）；
 *   4. 其余情况（菜单开合、普通输入）不得推送。
 */

export interface ConversationPushInput {
  /** 上一轮已渲染的消息 id 集合 */
  prevIds: ReadonlySet<string>;
  /** 当前状态里的消息 id 顺序 */
  nextIds: readonly string[];
  /** 上一帧是否在流式，本帧是否已停止 */
  justStoppedStreaming: boolean;
  /** 强制推送（首次挂载、host 替换、状态切换） */
  force: boolean;
}

export function decideConversationPush(input: ConversationPushInput): boolean {
  if (input.force) return true;
  if (input.justStoppedStreaming) return true;
  // 集合收缩：回滚截断、取消回滚、快照恢复都会让消息变少或整体替换，
  // 没有新 id 也必须推送，否则 React 继续显示已被删除的消息。
  if (input.nextIds.length !== input.prevIds.size) return true;
  for (const id of input.nextIds) {
    if (!input.prevIds.has(id)) return true;
  }
  return false;
}
