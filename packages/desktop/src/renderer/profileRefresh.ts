/**
 * Profile 定时刷新的纯比较逻辑。
 *
 * 【设计意图 (Why)】
 *   每 60 秒拉一次 profiles.list 不能变成“每分钟无条件重绘”。只有真正影响界面、
 *   会话归属或持久化快照的字段变化时才更新；同时不能漏字段，否则服务端仅改副标题、
 *   活跃时间或旧群聊 ui_meta 时，客户端会永远停在旧值。
 *
 * 【约束与规则 (Rules)】
 *   - 字段集合必须覆盖 AgentProfile 中所有渲染/持久化相关项；
 *   - 对象字段（last_session/uiMeta）做结构化比较，避免每次新对象引用造成假变化；
 *   - 同内容必须返回 false（可证伪的负向断言）。
 */

import type { AgentProfile } from '@hermes-flux/core';

export function profilesDiffer(previous: readonly AgentProfile[], next: readonly AgentProfile[]): boolean {
  if (previous.length !== next.length) return true;
  const byName = new Map(previous.map((profile) => [profile.name, profile]));
  return next.some((profile) => {
    const old = byName.get(profile.name);
    return !old
      || old.displayName !== profile.displayName
      || old.description !== profile.description
      || old.avatar !== profile.avatar
      || old.model !== profile.model
      || old.hasAvatar !== profile.hasAvatar
      || old.isDefault !== profile.isDefault
      || old.lastMessage !== profile.lastMessage
      || old.lastTime !== profile.lastTime
      || old.timestamp !== profile.timestamp
      || JSON.stringify(old.last_session) !== JSON.stringify(profile.last_session)
      || JSON.stringify(old.uiMeta) !== JSON.stringify(profile.uiMeta);
  });
}
