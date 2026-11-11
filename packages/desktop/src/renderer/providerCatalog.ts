/**
 * 统一提供商目录装载（跨 Agent 归并）。
 *
 * 【设计意图 (Why)】
 *   用户要看的是一张"我接了哪些模型来源、它们在哪些 Agent 上生效"的表。
 *   这句话横跨三类真值：每个 Agent 的 `model.options`（谁在用）、
 *   `/api/providers/oauth`（订阅登录态）、`/api/providers/custom-endpoints`（自定义端点）。
 *   三者都在 profile 作用域下，必须按 Agent 并发拉取再归并，不能串行累加延迟。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 上一版把订阅与自定义拆成两块列表，用户要自己在两个视角间对齐同一个概念。
 *   2. 只拉"当前 Bot"的端点列表，于是别的 Agent 上存在的端点直接不可见，
 *      "对哪些 Agent 生效"根本无从回答。
 *   3. 单个 Agent 请求失败时静默跳过，会在对账表上显示成"未配置"，诱导用户重复配置。
 *      这里失败项必须带原因进入归并，由 core 标成 `error`。
 *   4. 归并后的视图只保留渲染字段，**不能反向充当编辑/登录的数据源**：
 *      上一版让主列表自己当端点与订阅目录，结果"编辑"按钮找不到原始 base_url、
 *      添加弹框拿不到可登录项。原始行必须一并回传。
 *
 * 【约束与规则 (Rules)】
 *   1. 零 React、零 DOM；网络全部经注入的 rest 与 call。
 *   2. 并发拉取，任一失败不阻断其余，但失败必须可观测。
 *   3. 归并逻辑全部在 core 的 mergeProviderViews，本文件不重复任何判定。
 *   4. `endpoints` 与 `subscriptions` 必须以**原始行**回传，各自附带其在哪些 Agent 上存在。
 */

import {
  mergeProviderViews,
  normalizeEndpointId,
  summarizeModelOptions,
  type OauthProviderRow,
  type ProviderView,
  type CustomEndpointRow,
  type ProfileModelOption,
} from '@hermes-flux/core';
import type { ProviderAdminRest } from './providerAdminRest.js';

export interface ProviderCatalogRpc {
  call<T>(method: string, params?: Record<string, unknown>): Promise<T>;
}

export interface ProviderCatalogAgent {
  profile: string;
  displayName: string;
}

/** 一条端点原始行，附带它出现在哪些 Agent 上。 */
export interface ProviderCatalogEndpoint {
  row: CustomEndpointRow;
  /** 配过这个端点的 Agent；删除要按这个范围收敛。 */
  profiles: string[];
}

export interface ProviderCatalogResult {
  views: ProviderView[];
  /** 端点原始行（含 base_url / has_api_key / model），编辑表单的唯一数据源。 */
  endpoints: ProviderCatalogEndpoint[];
  /**
   * 端点清单读取失败的 Agent。
   * 【为什么必须单独给】端点清单是删除的作用域来源。某个 Agent 读失败时，
   *   它的端点根本不在 `endpoints` 里，删除会漏掉它却报告成功。
   *   读不到就不能猜着删，所以这个通道必须一路上行到删除判定。
   */
  endpointFailures: Array<{ profile: string; displayName: string; message: string }>;
  /** 订阅目录原始行（含未登录项），添加弹框的唯一数据源。 */
  subscriptions: OauthProviderRow[];
  /** 拉取失败的 Agent，界面必须显式提示，不能折进"未配置"。 */
  failed: Array<{ profile: string; displayName: string; message: string }>;
  /** 订阅目录是否成功拉到；失败时添加弹框里没有可登录项。 */
  subscriptionsOk: boolean;
  subscriptionsError?: string;
}

export interface LoadProviderCatalogOptions {
  agents: readonly ProviderCatalogAgent[];
  /** 取端点与订阅用的 REST 适配器（profile 作用域由调用方保证）。 */
  rest: ProviderAdminRest;
  rpc: ProviderCatalogRpc;
  describeError(error: unknown): string;
  /** 只对某个 profile 拉端点列表。缺省为全部 Agent。 */
  endpointProfiles?: readonly string[];
}

/**
 * 并发拉取三份真值并归并成统一视图。
 * 【规则】`explicit_only` 是唯一能同时给出 `is_current` / 模型列表 / 自定义标记的口径；
 *   `include_unconfigured` 会掺入 54 个骨架行，掺进来就无法判断"谁真的配了"。
 */
export async function loadProviderCatalog(options: LoadProviderCatalogOptions): Promise<ProviderCatalogResult> {
  const { agents, rest, rpc, describeError } = options;
  const endpointProfiles = options.endpointProfiles ?? agents.map((agent) => agent.profile);

  const optionSettled = await Promise.allSettled(
    agents.map(async (agent) => {
      const payload = await rpc.call<unknown>('model.options', {
        profile: agent.profile,
        explicit_only: true,
      });
      return summarizeModelOptions(agent.profile, agent.displayName, payload);
    }),
  );

  const failed: ProviderCatalogResult['failed'] = [];
  const profileOptions: ProfileModelOption[] = [];
  optionSettled.forEach((item, index) => {
    const agent = agents[index];
    if (item.status === 'fulfilled') {
      profileOptions.push(item.value);
    } else {
      const message = describeError(item.reason);
      profileOptions.push({ profile: agent.profile, displayName: agent.displayName, rows: [], error: message });
      failed.push({ profile: agent.profile, displayName: agent.displayName, message });
    }
  });

  // 端点与订阅的读取口径不同：端点按 profile 各自拉（要回答"哪个 Agent 配了它"），
  // 订阅只需一份目录（每个 profile 的订阅目录相同，重复拉不带来新信息）。
  const primaryProfile = endpointProfiles[0] ?? agents[0]?.profile ?? 'default';
  const endpointSettled = await Promise.allSettled(
    endpointProfiles.map(async (profile) => ({ profile, rows: await rest.listEndpoints(profile) })),
  );

  // 按端点 id 收敛，记录每个端点出现在哪些 Agent 上。
  // 【规则】key 必须与视图层同口径（`normalizeEndpointId`）：同一端点在某个 Agent 上
  //   报 `custom:fn`、另一个报 `fn` 时，用原始字符串会收敛成两条，配置集合随后被覆盖。
  const byId = new Map<string, ProviderCatalogEndpoint>();
  const endpointFailures: ProviderCatalogResult['endpointFailures'] = [];
  endpointSettled.forEach((item, index) => {
    if (item.status !== 'fulfilled') {
      const agent = agents.find((entry) => entry.profile === endpointProfiles[index]);
      endpointFailures.push({
        profile: endpointProfiles[index],
        displayName: agent?.displayName || endpointProfiles[index],
        message: describeError(item.reason),
      });
      return;
    }
    for (const row of item.value.rows) {
      const id = normalizeEndpointId(row.id);
      if (!id) continue;
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, { row: { ...row, id }, profiles: [item.value.profile] });
        continue;
      }
      if (!existing.profiles.includes(item.value.profile)) existing.profiles.push(item.value.profile);
      // 模型列表取更全的那份；`hasApiKey` 必须取并集，否则"某 Agent 配了密钥"会被另一份覆盖掉。
      const keepApiKey = existing.row.hasApiKey || row.hasApiKey;
      const better = row.models.length > existing.row.models.length ? { ...row, id } : existing.row;
      existing.row = { ...better, hasApiKey: keepApiKey };
    }
  });
  const endpoints = [...byId.values()];

  let subscriptions: OauthProviderRow[] = [];
  let subscriptionsOk = true;
  let subscriptionsError: string | undefined;
  try {
    subscriptions = await rest.listOauthProviders(primaryProfile);
  } catch (error) {
    subscriptionsOk = false;
    subscriptionsError = describeError(error);
  }

  return {
    views: mergeProviderViews({
      roster: agents,
      options: profileOptions,
      subscriptions,
      endpoints: endpoints.map((entry) => entry.row),
    }),
    endpoints,
    endpointFailures,
    subscriptions,
    failed,
    subscriptionsOk,
    subscriptionsError,
  };
}
