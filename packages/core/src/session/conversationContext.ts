/**
 * 会话多态寻址与领域边界模型 (packages/core/src/session/conversationContext.ts)
 *
 * 【设计意图 (Why)】
 *   将普通临时会话、专职数字员工主工位（Forever Chat）与多智能体协同研讨室（Group Room）
 *   定义为判别联合，在类型系统层面彻底杜绝裸 string sessionId 导致的参数漏传与跨域串扰。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 专职 Agent 向上翻页时因上下文丢失而漏传 profile，网关按 default 查报 404；
 *   2. 群聊 roomId 穿透打单会话 REST 接口，导致 404 跨域污染；
 *   3. 散落拼装导致新增会话模式时出现双标实现。
 *
 * 【约束与规则 (Rules)】
 *   - 严格使用 kind 字段做类型守卫判别；
 *   - 纯领域无界模型，禁止引入任何 DOM 或 Electron 依赖。
 */

export type ConversationContextRef =
  | { kind: 'session'; sessionId: string; profile: string }
  | { kind: 'bot'; sessionId: string; botName: string }
  | { kind: 'group'; roomId: string };

/**
 * 判断指定上下文是否为群聊研讨室
 */
export function isGroupConversation(context: ConversationContextRef): context is { kind: 'group'; roomId: string } {
  return context.kind === 'group';
}

/**
 * 从会话上下文中提取适用于会话 REST API 的 Profile 参数
 */
export function resolveConversationProfile(context: ConversationContextRef): string {
  if (context.kind === 'bot') {
    return context.botName || 'default';
  }
  if (context.kind === 'session') {
    return context.profile || 'default';
  }
  return '';
}
