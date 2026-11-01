/**
 * Profile 归一化（单一实现）
 *
 * 设计意图 (Why):
 *   网关返回的是 snake_case 原始结构（`ui_meta` / `has_avatar` / `display_name`），
 *   而 UI 层使用 camelCase 的 `AgentProfile`。转换必须只有一份实现，
 *   否则 `client.listProfiles()` 与 `ProfileService.listProfiles()` 会给出
 *   两种形状，调用方拿到的字段取决于走了哪条路径。
 *
 * 防范的历史坑 (Pitfall):
 *   归一化曾用"白名单挑字段"的方式实现，把 `ui_meta` 整块丢掉，
 *   导致官方桌面端持久化的历史群聊房间与其发言永远查不到，
 *   且没有任何报错——上游数据完好，下游读 undefined。
 *
 * 约束与规则 (Rules):
 *   - `ui_meta` 必须原样透传为 `uiMeta`，不得裁剪内部键；
 *   - `has_avatar` 必须保留，用于判断是否需要拉取资产；
 *   - 未知字段允许丢弃，但已知字段一个都不许漏。
 */

import type { AgentProfile, ProfileUiMeta } from './types.js';

export function normalizeAgentProfile(item: unknown): AgentProfile {
  const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;

  const rawAvatar =
    typeof obj.avatar === 'string' && obj.avatar
      ? obj.avatar
      : typeof obj.avatar_url === 'string' && obj.avatar_url
        ? obj.avatar_url
        : typeof obj.icon === 'string' && obj.icon
          ? obj.icon
          : typeof obj.image === 'string' && obj.image
            ? obj.image
            : '';

  const uiMeta =
    obj.ui_meta && typeof obj.ui_meta === 'object' ? (obj.ui_meta as ProfileUiMeta) : undefined;

  return {
    name: String(obj.name || obj.id || 'default'),
    displayName: String(obj.display_name || obj.title || obj.name || '默认 Agent'),
    description: typeof obj.description === 'string' ? obj.description : '',
    avatar: rawAvatar,
    model: typeof obj.model === 'string' ? obj.model : '',
    isDefault: Boolean(obj.is_default || obj.name === 'default'),
    hasAvatar: obj.has_avatar === true,
    uiMeta,
  };
}
