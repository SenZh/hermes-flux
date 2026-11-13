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

  const name = String(obj.name || obj.id || 'default');
  const defaultDisplayName = name === 'default' ? 'Hermes' : name;
  const metaBots =
    uiMeta && typeof uiMeta === 'object' && uiMeta['hermes-bots'] && typeof uiMeta['hermes-bots'] === 'object'
      ? (uiMeta['hermes-bots'] as Record<string, unknown>)
      : undefined;
  // 【设计意图 (Why)】
  // 对齐官方 Desktop (labels.ts:displayName)：官方保存 bot 自定义名称的字段实名为 `title`，并以 `ui_meta['hermes-bots'].title` 为第一优先级。
  // 【防范的历史坑 (Pitfall)】
  // 曾误以为别名字段叫 `alias`，导致官方 Desktop 保存的 "大总管"（落在 title 字段）被忽略降级为 default。
  const titleFromMeta = metaBots?.title || metaBots?.alias || metaBots?.name;
  const displayName = String(titleFromMeta || obj.display_name || obj.title || obj.alias || defaultDisplayName);

  const lastSessionRaw = obj.last_session && typeof obj.last_session === 'object' ? (obj.last_session as Record<string, unknown>) : undefined;
  const lastSession = lastSessionRaw
    ? {
        preview: typeof lastSessionRaw.preview === 'string' ? lastSessionRaw.preview : undefined,
        title: typeof lastSessionRaw.title === 'string' ? lastSessionRaw.title : undefined,
        last_active: typeof lastSessionRaw.last_active === 'number' ? lastSessionRaw.last_active : undefined,
        started_at: typeof lastSessionRaw.started_at === 'number' ? lastSessionRaw.started_at : undefined,
      }
    : undefined;

  return {
    name,
    displayName,
    description: typeof obj.description === 'string' ? obj.description : '',
    avatar: rawAvatar,
    model: typeof obj.model === 'string' ? obj.model : '',
    // 【设计意图】BOT 面板的"设为默认"写入 ui_meta['hermes-bots'].is_default；
    //   归一化必须能读回同一个键，否则用户保存后徽章永远不出现（写读口径分裂）。
    // 【规则】显式 false 可以取消内置 default 的隐含默认，保证「唯一默认」可转移。
    isDefault:
      metaBots?.is_default === true ||
      Boolean(obj.is_default) ||
      (name === 'default' && metaBots?.is_default !== false),
    hasAvatar: obj.has_avatar === true,
    uiMeta,
    last_session: lastSession,
  };
}
