/**
 * 左侧栏实体活动三态状态机 (packages/core/src/session/activityState.ts)
 *
 * 【设计意图 (Why)】
 *   左侧栏同时呈现三类实体：普通会话、专职 Bot（Agents）、多 Agent 群聊。
 *   每类实体都需要表达"进行中 / 未读 / 已读"三态，且**实体之间状态必须完全独立**：
 *   一个会话在跑，不得把归属它的 Bot 也染成进行中；一个群聊未读，不得殃及任何会话。
 *
 *   本模块把"求值"与"迁移"两条规则从渲染层下沉为纯逻辑，
 *   使其可以被单元测试真实 import 并施加变异检验，而不是锁在 render() 的闭包里自证。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 历史实现把普通会话的运行态向上冒泡给 Bot（`state.sessions.some(s => s.botName === bot && running)`），
 *      结果"任意一个会话在跑 → 该 Bot 也一直闪"，用户以为 Bot 处于工作状态，实为串扰。
 *   2. 历史实现用 `state.isStreaming && state.activeSessionId === id` 求运行态，
 *      焦点一移开指示器立刻熄灭，后台真正在跑的会话反而看不到进行中。
 *      判定必须绑定"该实体自身的运行集合"，而不是"当前焦点"。
 *   3. 完成态若只在"焦点不在该实体"时置未读，而调用方把"焦点"算错（例如拿 live id 去比 stored id），
 *      就会出现"看完了还亮着绿点"或"没看就变已读"。判定条件必须显式入参，不允许函数内部猜。
 *
 * 【约束与规则 (Rules)】
 *   - 纯逻辑，零 DOM / 零 React / 零网络；
 *   - 求值优先级严格为：running > unread > read；
 *   - `apply*` 系列是**原地应用**到调用方持有的集合，语义明确写在函数名里；
 *   - 三类实体各自持有独立集合，本模块不做任何跨域（session ↔ bot ↔ group）推导。
 */

/** 实体活动三态 */
export type ActivityState = 'running' | 'unread' | 'read';

/** 实体域：会话 / 专职 Bot / 群聊房间，各自独立一整套集合 */
export type ActivityDomain = 'session' | 'bot' | 'group';

/** 求值输入：只读地消费运行集合与未读集合 */
export interface ActivityProbe {
  /** 正在运行的实体 id 集合 */
  runningIds: ReadonlySet<string>;
  /** 已完成后尚未被用户查看的实体 id 集合 */
  unreadIds: ReadonlySet<string>;
  /**
   * 正在流式产出的实体 id（会话域专用：流式开始时 id 可能尚未进入 runningIds）。
   * 群聊与 Bot 域不传即可。
   */
  streamingId?: string | null;
}

/**
 * 求单个实体的三态。
 *
 * 优先级严格为 running > unread > read：
 * 一个实体不可能同时"正在跑"又"已完成未读"；若两个集合同时命中，
 * 以运行态为准（正在进行中的事实高于上一轮的未读残留）。
 */
export function resolveActivityState(entityId: string, probe: ActivityProbe): ActivityState {
  if (!entityId) return 'read';
  if (probe.streamingId === entityId) return 'running';
  if (probe.runningIds.has(entityId)) return 'running';
  if (probe.unreadIds.has(entityId)) return 'unread';
  return 'read';
}

/**
 * 批量求值：把一组实体 id 映射为三态字典。
 * 供渲染层一次性拿到整个列表的状态，避免在模板里循环调用单点求值。
 */
export function resolveActivityMap(
  entityIds: readonly string[],
  probe: ActivityProbe
): Record<string, ActivityState> {
  const out: Record<string, ActivityState> = {};
  for (const id of entityIds) {
    out[id] = resolveActivityState(id, probe);
  }
  return out;
}

/**
 * 回合开始：实体进入 running，并立刻清除它的历史未读残留。
 *
 * 【规则】
 *   用户刚发起新回合，说明他已经在这个实体里操作，旧绿点必须当场消失，
 *   否则"正在跑 + 未读绿点"会同时出现，属于非法状态。
 */
export function applyTurnStarted(
  running: Set<string>,
  unread: Set<string>,
  entityId: string
): void {
  if (!entityId) return;
  running.add(entityId);
  unread.delete(entityId);
}

/**
 * 回合完成：实体退出 running；只有**用户当前不在该实体上**时才置为未读。
 *
 * 【规则】
 *   - `isFocused` 由调用方显式传入，禁止函数内部从全局焦点反推，避免 live/stored id 混用导致误判；
 *   - 已读语义 = 用户正看着它，结果直接呈现，不需要绿点提醒；
 *   - 无论是否置未读，都必须退出 running（失败与成功共用这条收尾）。
 */
export function applyTurnCompleted(
  running: Set<string>,
  unread: Set<string>,
  entityId: string,
  isFocused: boolean
): void {
  if (!entityId) return;
  running.delete(entityId);
  if (isFocused) {
    unread.delete(entityId);
  } else {
    unread.add(entityId);
  }
}

/**
 * 回合失败：实体退出 running，但**不得**置未读。
 *
 * 【设计意图 (Why)】
 *   未读绿点的语义是"有结果待查看"。回合失败没有可供查看的成果，
 *   标成未读会诱导用户点进去只看到一段错误提示。
 */
export function applyTurnFailed(running: Set<string>, entityId: string): void {
  if (!entityId) return;
  running.delete(entityId);
}

/**
 * 用户进入实体查看：清除未读，变为已读（无任何标识）。
 */
export function applyEnteredRead(unread: Set<string>, entityId: string): void {
  if (!entityId) return;
  unread.delete(entityId);
}

/**
 * 回合被提前终止（用户点停止 / 看门狗超时 / 断线）的统一收尾。
 *
 * 【设计意图 (Why)】
 *   渲染层有多条"回合没正常结束"的路径：interruptTurn、看门狗超时、会话删除、断线。
 *   这些路径都必须做同一件事：把三个域的运行态清掉，且**不得**置未读
 *   （没产出成果，绿点会误导用户点进去只看报错）。
 *   历史上这些路径各自手写、漏掉了集合收尾，导致会话/Bot 永久停在"进行中"。
 *   收敛成一个纯函数后，每条路径只需调用它，并且可以被确定性单测钉死。
 *
 * 【约束与规则 (Rules)】
 *   - 幂等：重复调用不改变集合内容（delete 本身幂等）；
 *   - 只退出运行态，绝不新增未读；
 *   - 空 id 视为无操作。
 */
export function settleTurnTermination(params: {
  runningSessionIds: Set<string>;
  runningBotNames: Set<string>;
  sessionId?: string | null;
  botName?: string | null;
}): void {
  const { runningSessionIds, runningBotNames, sessionId, botName } = params;
  if (sessionId) runningSessionIds.delete(sessionId);
  if (botName) runningBotNames.delete(botName);
}
