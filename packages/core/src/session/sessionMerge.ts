/**
 * Cross-Profile Session Merge (packages/core/src/session/sessionMerge.ts)
 *
 * 设计意图 (Why):
 *   一个网关可挂载多个 Bot Profile，每个 Profile 拥有独立的 SQLite 会话库。
 *   工作台需要把多库会话合并成一条时间线，供左侧栏统一浏览。
 *
 * 防范的历史坑 (Pitfall):
 *   会话 ID 形如 `20261031_082411_824c51`（时间戳前缀 + 短随机后缀），
 *   不同 Profile 各自独立生成，跨库碰撞是常态而非例外。
 *   曾用裸 sessionId 做全局去重：aura 的一条空白会话先返回并占住了 ID，
 *   xiaofawang 下真正有标题的《评估 Relay 技术商业化可行性》被当成重复项丢弃，
 *   随后空白项又被空标题过滤，最终整个会话在界面上彻底消失。
 *
 * 约束与规则 (Rules):
 *   - 去重键必须是 `profile::sessionId` 复合键；
 *   - 输出按时间戳降序，时间戳缺失视为 0（排在末尾）；
 *   - 纯函数，零 DOM / 零网络依赖，便于全平台复用与确定性测试。
 */

import type { NormalizedSession } from '../rpc/types.js';

/** 会话所属 Profile；缺省时回落到 default */
export function sessionProfileKey(session: NormalizedSession): string {
  return session.botName || 'default';
}

/**
 * 按 `profile::sessionId` 去重，保留首次出现的那条，并按时间戳降序排序。
 */
export function dedupeSessionsByProfile(sessions: NormalizedSession[]): NormalizedSession[] {
  const seen = new Set<string>();
  const merged: NormalizedSession[] = [];

  for (const session of sessions) {
    if (!session || !session.id) continue;
    const key = `${sessionProfileKey(session)}::${session.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(session);
  }

  merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return merged;
}
