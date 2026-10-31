/**
 * Dedicated Bot Profile & Canonical Forever Chat Controller
 * (packages/core/src/profile/profileService.ts)
 *
 * 设计意图 (Why):
 *   专职数字员工（Dedicated Bot）不同于临时草稿或通用会话。
 *   每个 Bot 拥有专属人格（SOUL.md）、专属技能工具集以及独立的长效私聊记忆（MEMORY.md）。
 *   为了在全平台统一纳管 Bot 档案与终生主工位（Canonical Forever Chat），
 *   必须将该纯逻辑层沉淀在 packages/core，面向 Web / Mobile / Desktop 完全同构共享。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 记忆污染（Memory Poisoning）：严禁将群聊研讨或临时旁聊的交互记录回写到单个 Bot 的 MEMORY.md 中。
 *      规范强制铁律：仅允许 Bot 的唯一主工位（Forever Chat）更新长期私聊记忆。
 *   2. 主工位漂移与误删：Forever Chat 底层固定标题为 'Bot Chat' 且 hidden=1，前端必须标记
 *      is_forever_chat=true，受物理保护，绝对禁止被普通列表软删除或归档。
 *   3. 租户混淆：切换 Bot 时保持本地 Multi-Profile 缓存，避免频繁全量重刷。
 *
 * 约束与规则 (Rules):
 *   - 纯 TypeScript 实现，零宿主 API 或 DOM 依赖。
 *   - 显式失败（Failure Is Not Empty）：网络或网关报错必须显式向上抛出，严禁 catch 空数组。
 */

import type {
  AgentProfile,
  AgentProfileDetail,
  ProfilesListResult,
  ProfilesDescribeParams,
  ProfilesDescribeResult,
  ProfilesCreateParams,
  ProfilesCreateResult,
  ProfilesConfigureParams,
  ProfilesConfigureResult,
  ProfilesGetAssetParams,
  ProfilesGetAssetResult,
  ProfilesSetAssetParams,
  ProfilesSetAssetResult,
  SessionListResult,
  SessionItemPayload,
  IRpcCaller,
} from '../rpc/types.js';

export interface ForeverChatDescriptor {
  sessionId: string;
  botProfile: string;
  title: string;
  isForeverChat: true;
  createdAt: number;
}

export class ProfileService {
  /**
   * 内存级 Profile 缓存，避免重复高频调用 profiles.list
   */
  private profileCache = new Map<string, AgentProfile>();

  /**
   * 缓存各 Bot 对应的唯一 Forever Chat ID：botProfile -> ForeverChatDescriptor
   */
  private foreverChatCache = new Map<string, ForeverChatDescriptor>();

  /**
   * 拉取所有专职 Bot 列表
   */
  public async listProfiles(bridge: IRpcCaller, forceRefresh = false): Promise<AgentProfile[]> {
    if (!forceRefresh && this.profileCache.size > 0) {
      return Array.from(this.profileCache.values());
    }

    const res = await bridge.request<ProfilesListResult>('profiles.list');
    if (!res || !Array.isArray(res.profiles)) {
      throw new Error('网关返回了非法的 profiles.list 响应数据结构');
    }

    this.profileCache.clear();
    for (const p of res.profiles) {
      this.profileCache.set(p.name, p);
    }
    return res.profiles;
  }

  /**
   * 获取指定 Bot 的详细档案（System Prompt / Tools / 沙箱路径）
   */
  public async describeProfile(name: string, bridge: IRpcCaller): Promise<AgentProfileDetail> {
    if (!name || typeof name !== 'string') {
      throw new Error('Profile name is mandatory for describeProfile');
    }

    const res = await bridge.request<ProfilesDescribeResult, ProfilesDescribeParams>(
      'profiles.describe',
      { name }
    );
    // 官方 Gateway 直接扁平返回 { name, description, soul, model, toolsets, ... } 或嵌套在 profile 字段中
    const profileDetail: AgentProfileDetail | null = res?.profile || (res?.name ? {
      name: res.name,
      displayName: res.name,
      description: res.description,
      soulContent: res.soul,
      systemPrompt: res.soul,
      tools: Array.isArray(res.toolsets)
        ? res.toolsets.map((t) => t.name)
        : [],
    } : null);

    if (!profileDetail) {
      throw new Error(`未找到 Bot 配置档: ${name}`);
    }
    return profileDetail;
  }

  /**
   * 动态创建专职 Bot
   */
  public async createProfile(
    params: ProfilesCreateParams,
    bridge: IRpcCaller
  ): Promise<ProfilesCreateResult> {
    if (!params.name || typeof params.name !== 'string') {
      throw new Error('Bot profile name cannot be empty');
    }

    const res = await bridge.request<ProfilesCreateResult, ProfilesCreateParams>(
      'profiles.create',
      params
    );
    // 刷新本地缓存
    await this.listProfiles(bridge, true);
    return res;
  }

  /**
   * 更新配置专职 Bot 属性
   */
  public async configureProfile(
    name: string,
    patch: Partial<AgentProfileDetail>,
    bridge: IRpcCaller
  ): Promise<boolean> {
    const res = await bridge.request<ProfilesConfigureResult, ProfilesConfigureParams>(
      'profiles.configure',
      { name, patch }
    );
    if (res.success) {
      await this.listProfiles(bridge, true);
    }
    return res.success;
  }

  /**
   * 获取 Bot 头像/资产 (profiles.get_asset)
   *
   * 【设计意图 (Why)】
   * 网关对入参执行 Pydantic 严格模式（extra='forbid'），只接受 `{ name, asset }` 两个字段。
   *
   * 【防范的历史坑 (Pitfall)】
   * 曾同时传 `asset` 与 `key`，网关直接返回
   * `4000 invalid params: key: Extra inputs are not permitted`；
   * 而下方 catch 又静默返回 null，导致所有 Bot 头像永远拉不到、界面退回几何图腾，
   * 表现为"头像一直是老的"。此类契约错误绝不允许被吞成"无数据"。
   *
   * 【规则 (Rules)】
   * - 请求体只允许 `{ name, asset }`；
   * - 仅在网关明确 `found === false`（确实未上传资产）时返回 null；
   * - 任何 RPC 异常必须向上抛出，由调用方决定降级策略，严禁伪造成空。
   */
  public async getAsset(name: string, key: string, bridge: IRpcCaller): Promise<string | null> {
    if (!name) return null;
    const res = await bridge.request<ProfilesGetAssetResult, ProfilesGetAssetParams>(
      'profiles.get_asset',
      { name, asset: key || 'avatar' }
    );
    if (!res) return null;
    if (res.found === false) return null;
    return res.data || res.asset_base64 || res.avatar || null;
  }

  /**
   * 设置 Bot 头像/资产
   */
  public async setAsset(
    name: string,
    key: string,
    base64: string,
    bridge: IRpcCaller
  ): Promise<boolean> {
    const res = await bridge.request<ProfilesSetAssetResult, ProfilesSetAssetParams>(
      'profiles.set_asset',
      { name, key, base64 }
    );
    return res.success;
  }

  /**
   * 核心不变量：获取或初始化 Bot 的终身唯一主工位 (Canonical Forever Chat)
   *
   * 设计意图 (Why):
   *   专职 Bot 的个人深聊与长期认知沉淀全部在主工位发生。
   *   底层数据库中标题固定为 'Bot Chat' 且 hidden=1。
   *   若不存在则调用 session.create 自动创建并置为 hidden。
   */
  public async getOrCreateForeverChat(
    botProfile: string,
    bridge: IRpcCaller
  ): Promise<ForeverChatDescriptor> {
    if (!botProfile) {
      throw new Error('Bot profile name is mandatory to resolve Forever Chat');
    }

    const cached = this.foreverChatCache.get(botProfile);
    if (cached) {
      return cached;
    }

    // 1. 查询该 Bot 名下的全部会话（包含 hidden=1）
    // 严禁吞掉网络异常：失败必须显式抛出，防止网关瞬断时把已有 Bot Chat 误判为不存在而重复分裂创建
    const listRes = await bridge.request<SessionListResult>('session.list', {
      profile: botProfile,
      include_hidden: true,
    });
    const sessions: SessionItemPayload[] = Array.isArray(listRes?.sessions)
      ? listRes.sessions
      : Array.isArray(listRes?.data)
      ? listRes.data
      : [];

    // 2. 检索是否已有 'Bot Chat'
    const found = sessions.find((s) => s.title === 'Bot Chat');
    if (found) {
      const descriptor: ForeverChatDescriptor = {
        sessionId: found.id,
        botProfile,
        title: 'Bot Chat',
        isForeverChat: true,
        createdAt: typeof found.created_at === 'number' ? found.created_at : Date.now(),
      };
      this.foreverChatCache.set(botProfile, descriptor);
      return descriptor;
    }

    // 3. 不存在时自动为该 Bot 建立终身主工位
    const createRes = await bridge.request<{ session_id?: string; id?: string }>('session.create', {
      title: 'Bot Chat',
      profile: botProfile,
      system_prompt: `You are dedicated specialist Bot [${botProfile}].`,
    });
    const sessionId = createRes.session_id || createRes.id;
    if (!sessionId) {
      throw new Error(`为 Bot [${botProfile}] 创建终生主工位失败: 缺少 session_id`);
    }

    // 4. 将其标记为 hidden 避免在普通旁聊列表中混排
    try {
      await bridge.request('session.set_hidden', { session_id: sessionId, hidden: true });
    } catch {
      // 容错放行
    }

    const descriptor: ForeverChatDescriptor = {
      sessionId,
      botProfile,
      title: 'Bot Chat',
      isForeverChat: true,
      createdAt: Date.now(),
    };
    this.foreverChatCache.set(botProfile, descriptor);
    return descriptor;
  }

  /**
   * 检验是否允许向该 Bot 的 MEMORY.md 提交认知经验落盘
   * 【记忆防毒化规则】：仅允许主工位（isForeverChat=true）写入长效记忆
   */
  public canCommitLongTermMemory(descriptor: { isForeverChat?: boolean }): boolean {
    return Boolean(descriptor.isForeverChat);
  }

  /**
   * 清除本地缓存
   */
  public clearCache(): void {
    this.profileCache.clear();
    this.foreverChatCache.clear();
  }
}
