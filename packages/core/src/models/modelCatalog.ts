/**
 * 模型目录归一化层 (packages/core/src/models/modelCatalog.ts)
 *
 * 【设计意图 (Why)】
 *   网关 `model.options` 的原始返回是"provider 分组 + 模型 ID 字符串数组"，
 *   而所有前端场景（输入舱切换器、设置页模型开关、Bot 绑定模型、群聊成员模型、MoA 槽位）
 *   需要的是**扁平、可直接渲染、带可读名称与能力元数据**的模型条目。
 *   把这一层收敛在 core，才能保证五个场景的显示完全一致，且前端不再各自拼字符串。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 仅提取模型 ID：`extractAvailableModels` 只返回 `string[]`，导致每个前端只能拿裸 ID 渲染，
 *      `group/deepseek-v4.1-flash` 这类机器串直接进用户视野。
 *   2. 显示名挂在 provider 上：`extractModelDetails` 曾用 `${name} (${provider})` 把 provider 名
 *      拼进 displayName，选择器里每行都拖着 `(cpa)` 尾巴。
 *   3. 丢字段：`pricing` / `capabilities` / `featured_models` / `unavailable_models` 属于 provider 行的
 *      合法元数据，归一化时**必须按模型 ID 挂到条目上**，否则前端要么重复解析原始 payload，
 *      要么干脆不显示价格与能力标签。
 *   4. **从名字里扣掉后缀**：展示名曾只保留主体（`Gemini 3.8`），把 `Flash` 挪进独立标签，
 *      用户认不出是哪个模型。现在 `displayName` 恒等于完整 `name`。
 *
 * 【约束与规则 (Rules)】
 *   - 纯函数，零网络 / 零 DOM；输入为未经信任的 `unknown`，输出必为强类型；
 *   - `id` 一字不改：它是 `config.set` / `session.create` 的唯一权威载荷，显示层改名绝不回写；
 *   - 排重以 `(provider, id)` 为键——同一 ID 可能被多个 provider 提供，且 `config.set` 会拒绝歧义模型；
 *   - 空输入返回空数组，不做任何虚构兜底（Failure Is Not Empty）。
 */

import type { ModelCapabilities, ModelPricing } from '../rpc/contracts/gateway-contract.generated.js';
import { parseModelDisplay } from './modelNaming.js';

/** 归一化后的单个可选项。前端只需渲染此结构，不再触碰原始 provider payload。 */
export interface ModelCatalogEntry {
  /** 原始模型 ID，权威载荷，禁止改写 */
  id: string;
  /** 拥有该模型的 provider slug（`cpa` / `nous` / `xai-oauth` …） */
  providerSlug: string;
  /** provider 展示名（`Nous Portal` / `cpa` …），供需要归属提示的场景使用 */
  providerName: string;
  /** 完整可读名，如 `Gemini 3.8 Flash` / `Opus 4.8 Fast`，ID 里的词一个不丢 */
  name: string;
  /** 变体标签，如 `Fast` / `Flash` / `Thinking`，无则为空串 */
  variant: string;
  /** 本地量化标签（GGUF），如 `Q4_K_M` */
  quant: string;
  /** 上下文窗口标签，如 `1M` */
  context: string;
  /** 路由标签，如 `US` / `free` */
  route: string;
  /** 日期快照标签，如 `0731` */
  date: string;
  /** 厂商展示名，如 `Anthropic` / `DeepSeek`；判不出时回退 provider 名 */
  vendor: string;
  /**
   * 厂商图标 slug（`anthropic` / `zhipu` / `xai` …），与 `packages/ui/src/icons/lobe/`
   * 的文件名一一对应。空串表示判不出厂商或上游无官方图标，UI 必须降级而非留白。
   */
  vendorId: string;
  /** 单行显示名；与 `name` 完全一致（后缀已在名字里，不再重复拼接） */
  displayName: string;
  /** 价格（$/Mtok 格式化字符串，网关原样给出），缺失则为 undefined */
  pricing?: ModelPricing;
  /** 能力位（fast / reasoning / can_disable_reasoning），缺失则为 undefined */
  capabilities?: ModelCapabilities;
  /** 上下文窗口 tokens；网关 model.options 不提供，由可选补充通道注入 */
  contextLength?: number;
  /** 是否支持视觉输入；同样为可选补充字段 */
  supportsVision?: boolean;
  /** 是否被列入 provider 的精选短名单 */
  featured: boolean;
  /**
   * 是否因订阅/免费层被网关标记为不可选。
   *
   * 【规则】归一化阶段已把这类模型**直接从 entries 剔除**，因此本字段在目录视图里
   * 恒为 `false`，只作为结构兼容与外部手工构造条目的防御位保留。
   */
  unavailable: boolean;
  /** 该 provider 的告警文案（如"paste XXX_KEY to activate"），命中时透传给条目 */
  providerWarning?: string;
}

/** 一次目录读取的完整结果。`ok=false` 时 `entries` 为空且必须携带 `error`。 */
export interface ModelCatalogView {
  entries: ModelCatalogEntry[];
  /** 去重后的模型 ID 列表，供只关心 ID 的旧调用方平滑迁移 */
  models: string[];
  /** 网关报告当前生效的模型与 provider */
  currentModel: string;
  currentProvider: string;
  /** true 表示数据来自网关真实响应；false 表示读取失败，调用方必须显式降级 */
  ok: boolean;
  error?: string;
}

/** 网关 provider 行的最小可信形状（其余字段一律忽略，不参与归一化）。 */
interface RawProviderRow {
  slug?: unknown;
  name?: unknown;
  models?: unknown;
  pricing?: unknown;
  capabilities?: unknown;
  featured_models?: unknown;
  unavailable_models?: unknown;
  warning?: unknown;
  authenticated?: unknown;
  models_hidden?: unknown;
  /** 订阅等级快照尚未拿到时网关置 true，并先把全部模型 fail-closed 标锁（瞬态未知，非拒绝） */
  free_tier_pending?: unknown;
  /** 价格尚未算完时的待定标志，同样属瞬态未知 */
  pricing_pending?: unknown;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = asString(item);
    if (text) out.push(text);
  }
  return out;
}

function asRecord<T>(value: unknown): Record<string, T> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, T>) : undefined;
}

/**
 * 伪 ID 判定：探针录制工具会把超长列表截断成 `<more:69>` 这类占位符。
 *
 * 【防范的历史坑 (Pitfall)】
 *   契约探针 `scripts/contract/probe.mjs::sanitize` 会把数组压成
 *   `[前三项, '<more:N>']`。若归一化层原样收纳，占位符会派生成 `<More:69>`
 *   这种条目混进真实选择器，用户点它必然切换失败。
 *
 * 【规则 (Rules)】
 *   任何以 `<` 开头、或以 `>` 结尾的 ID 都不是合法模型标识，一律丢弃。
 */
function isPlaceholderId(id: string): boolean {
  return id.startsWith('<') || id.endsWith('>');
}

/**
 * 该 provider 行的模型是否可选（Provider Selectability）
 *
 * 【设计意图 (Why)】
 *   `model.options` 默认会带上未配置的 provider 骨架行，它们的 `models` 可能非空但一选就失败。
 *   契约里的权威可判据只有 `authenticated`（`hermes_cli/inventory.py` 的
 *   `row["authenticated"] = not is_skeleton`），必须以此为准。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 旧 `extractModelDetails` 用 6 组启发式标志，其中 `hasExplicitConfiguredFlags`
 *      的"任一命中即全员必须命中"规则会在真实契约响应上**误杀全部 provider**
 *      （契约只给 `authenticated`，从不给 `configured`）。
 *   2. **只认 authenticated 不够**：真实响应里 `nous` 行是 `authenticated: true` +
 *      `unavailable_models` 覆盖全部 72 个模型（未购订阅），整行照样会被显示出来。
 *      这就是「用户看到一个买不起的 provider 占满整个选择器」的直接成因。
 *
 * 【约束与规则 (Rules)】
 *   1. `authenticated === false` → 整行丢弃（明确否定是权威的）；
 *   2. 全部模型都被 `unavailable_models` 锁住 → 整行丢弃（一个都选不了，展示无意义）；
 *   3. `authenticated === true` 且存在可选模型 → 保留；
 *   4. 缺省 `authenticated` 时，才看 `models_hidden` 与历史负向标志；
 *   5. 契约无 `models_hidden` 字段，它只用于兼容更早的网关形状。
 *
 * 【为什么"全锁"可以安全隐藏 (Safety)】
 *   上游 `check_nous_free_tier()` 的注释写明 "unknown/error → False so this never blocks users"，
 *   即**未知一律按可用来处理**，绝不会把可用误判成不可用。所以出现"全锁"只可能是两种情况：
 *   账号确实没有该 provider 的权限（真实拒绝），或缓存尚未预热（`free_tier_pending`）。
 *   后者见 `isProviderPending` —— 它单独放行，避免整行在预热门槛期间闪烁消失。
 */
function isProviderSelectable(row: RawProviderRow): boolean {
  if (row.authenticated === false) return false;

  // 未知态优先放行：宁可短暂多显示一行，也不要让真实可用的 provider 在预热期闪掉
  if (isProviderPending(row)) return row.authenticated !== false;

  const models = asStringArray(row.models);
  if (models.length > 0) {
    const locked = new Set(asStringArray(row.unavailable_models));
    // 全部被锁 = 一条都选不了，整行没有展示价值
    if (locked.size > 0 && models.every((id) => locked.has(id))) return false;
  }

  if (row.authenticated === true) return true;

  // 以下全部是 authenticated 缺省时的兼容路径
  if (row.models_hidden === true) return false;

  const root = row as Record<string, unknown>;
  if (root.configured === false || root.is_configured === false) return false;
  if (root.connected === false || root.has_key === false) return false;
  if (root.active === false || root.ready === false || root.enabled === false) return false;

  if (typeof root.status === 'string') {
    const status = root.status.toLowerCase();
    if (status === 'unconfigured' || status === 'disabled' || status === 'disconnected' || status === 'inactive') {
      return false;
    }
  }

  return true;
}

/**
 * 该 provider 的锁定状态是否只是"还没算出来"（Entitlement Pending）
 *
 * 【设计意图 (Why)】
 *   `free_tier_pending: true` 表示网关**尚未拿到**账号的订阅等级快照，于是 fail-closed
 *   先把全部模型标为不可选，并附一句 `Checking Nous plan entitlement…` 的 warning。
 *   这是瞬态未知，不是拒绝。若把它当成"全锁"去隐藏整行，用户会在冷启动/刷新瞬间
 *   看到 provider 忽隐忽现（网络稍慢就整行消失），体验比多显示一行差得多。
 *
 * 【防范的历史坑 (Pitfall)】
 *   上游注释明确写了 "Entitlement unknown: stay nonblocking but fail closed until the prewarm
 *   has populated both caches" —— 关键词是 **nonblocking**。客户端若据此做可见性决策，
 *   就违背了它"不阻塞用户"的设计前提。
 *
 * 【约束与规则 (Rules)】
 *   只认 `free_tier_pending`。它表示 `get_cached_nous_free_tier()` 返回 `None`——**订阅等级本身**
 *   还没算出来，网关 fail-closed 把全部模型临时标锁。这是"未知"，必须放行。
 *
 *   **不得把 `pricing_pending` 也算作 pending**：它是"价格缓存没热"，与权限无关。
 *   真实免费层用户在价格缓存冷启动时同样会 `pricing_pending: true`，但网关此时
 *   `free_tier: true` 且 `unavailable_models` 是**真拒绝名单**，必须照常过滤。
 *   把两者混为一谈会让免费用户短暂看到一堆付费模型。
 */
function isProviderPending(row: RawProviderRow): boolean {
  const root = row as Record<string, unknown>;
  return root.free_tier_pending === true;
}

/**
 * 从 `model.options` 原始响应归一化为扁平条目列表。
 *
 * 【规则】
 *   - 只认 `providers[]` 这一条权威路径（真实探针 0.22.5 只产这一种形状）；
 *     根层 `model` 仅代表"当前模型"，不当作可选列表项；
 *   - 同一 `(provider, id)` 只出现一次；跨 provider 的同名模型各自保留，
 *     因为切换时必须携带 provider 才能消除歧义；
 *   - `models` 里若混入对象形状（历史网关），按 `id` / `name` 弹性取值；
 *   - **`unavailable_models` 里的模型一律剔除**：用户要的是"能用的模型列表"，
 *     不是"所有模型 + 灰显标记"。provider 一条不剩时由 `isProviderSelectable` 整行丢弃；
 *   - `free_tier_pending` 是唯一例外：此时锁名单只是占位，不据此剔除。
 */
export function normalizeModelCatalog(payload: unknown): ModelCatalogEntry[] {
  if (!payload || typeof payload !== 'object') return [];

  const root = payload as { providers?: unknown };
  const providers = Array.isArray(root.providers) ? (root.providers as RawProviderRow[]) : [];

  const entries: ModelCatalogEntry[] = [];
  const seen = new Set<string>();

  for (const row of providers) {
    if (!row || typeof row !== 'object') continue;

    const providerSlug = asString(row.slug);
    const providerName = asString(row.name) || providerSlug;
    if (!providerSlug) continue;
    // 未认证/被隐藏的 provider 行整体跳过，避免可选列表混入一选就失败的模型
    if (!isProviderSelectable(row)) continue;

    const pricing = asRecord<ModelPricing>(row.pricing);
    const capabilities = asRecord<ModelCapabilities>(row.capabilities);
    const featuredSet = new Set(asStringArray(row.featured_models));
    // 【规则】`free_tier_pending` 下的锁名单是 fail-closed 占位，不是真实拒绝，不得据此剔除
    const unavailableSet = isProviderPending(row)
      ? new Set<string>()
      : new Set(asStringArray(row.unavailable_models));
    const providerWarning = asString(row.warning) || undefined;

    const rawModels = Array.isArray(row.models) ? row.models : [];
    for (const rawModel of rawModels) {
      const id =
        typeof rawModel === 'string'
          ? rawModel.trim()
          : asString((rawModel as { id?: unknown })?.id) || asString((rawModel as { name?: unknown })?.name);
      if (!id || isPlaceholderId(id)) continue;

      // 【规则】网关明确标记为不可选的模型**直接剔除**，不做灰显占位。
      // 这些是订阅档位挡住、额度耗尽或路由下架的模型——留在列表里只会让用户
      // 点一下才发现用不了。若某 provider 因此一条不剩，`isProviderSelectable`
      // 已在 provider 层把整行丢弃，两个层级口径一致。
      if (unavailableSet.has(id)) continue;

      const key = `${providerSlug.toLowerCase()}::${id.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const parts = parseModelDisplay(id, providerName);
      entries.push({
        id,
        providerSlug,
        providerName,
        name: parts.name,
        variant: parts.variant,
        quant: parts.quant,
        context: parts.context,
        route: parts.route,
        date: parts.date,
        vendor: parts.vendor,
        vendorId: parts.vendorId,
        displayName: parts.name,
        pricing: pricing?.[id],
        capabilities: capabilities?.[id],
        featured: featuredSet.has(id),
        unavailable: unavailableSet.has(id),
        providerWarning,
      });
    }
  }

  return disambiguateDisplayNames(entries);
}

/**
 * 消除「同一 provider 内两个不同 ID 派生出同一个显示名」的碰撞。
 *
 * 【设计意图 (Why)】
 *   同一 provider 下可能存在同一模型的两条路由：`group/deepseek-v4.1-flash`（走代理分组）
 *   与 `deepseek-v4.1-flash`（直连）。两者剥离前缀后都派生成 `DeepSeek V4.1 Flash`，
 *   在 320px 的选择器里就是两行完全一样、点哪行都不知道的条目。
 *
 * 【约束与规则 (Rules)】
 *   - 只在**同一 provider 内**去重（跨 provider 的重名由分组标题区分）；
 *   - 碰撞时给**有路径前缀的那一条**追加 `（前缀）`；无前缀那条保持原名；
 *   - 两条都无前缀时，回退为追加完整 ID，绝不留下同名项；
 *   - `id` 一律不改写。
 */
function disambiguateDisplayNames(entries: ModelCatalogEntry[]): ModelCatalogEntry[] {
  const groups = new Map<string, ModelCatalogEntry[]>();
  for (const entry of entries) {
    const key = `${entry.providerSlug.toLowerCase()}\u0000${entry.displayName}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(entry);
    else groups.set(key, [entry]);
  }

  const qualify = (entry: ModelCatalogEntry, qualifier: string): void => {
    entry.name = `${entry.name}（${qualifier}）`;
    entry.displayName = entry.name;
  };

  for (const bucket of groups.values()) {
    if (bucket.length <= 1) continue;

    for (const entry of bucket) {
      const slash = entry.id.lastIndexOf('/');
      if (slash > 0) {
        qualify(entry, entry.id.slice(0, slash));
      }
    }

    // 全部无路径前缀时仍可能同名（如大小写不同的同一名称）——用完整 ID 兜底
    const counts = new Map<string, number>();
    for (const entry of bucket) {
      counts.set(entry.displayName, (counts.get(entry.displayName) ?? 0) + 1);
    }
    for (const entry of bucket) {
      if ((counts.get(entry.displayName) ?? 0) > 1) {
        qualify(entry, entry.id);
      }
    }
  }

  return entries;
}

/** 从原始响应读取"当前生效的模型/provider"，缺失时返回空串而非猜测。 */
export function readCurrentSelection(payload: unknown): { model: string; provider: string } {
  if (!payload || typeof payload !== 'object') return { model: '', provider: '' };
  const root = payload as { model?: unknown; provider?: unknown };
  return { model: asString(root.model), provider: asString(root.provider) };
}

/**
 * 组装完整视图。成功路径与失败路径都从这里产出，调用方只判 `ok`，不自行拼接错误语义。
 */
export function buildModelCatalogView(
  payload: unknown,
  options: { error?: string } = {},
): ModelCatalogView {
  const entries = normalizeModelCatalog(payload);
  const { model, provider } = readCurrentSelection(payload);

  if (entries.length === 0) {
    return {
      entries: [],
      models: [],
      currentModel: model,
      currentProvider: provider,
      ok: false,
      error: options.error ?? '网关未返回任何可用模型',
    };
  }

  const models: string[] = [];
  const seenIds = new Set<string>();
  for (const entry of entries) {
    // 与 extractAvailableModels 的排重口径一致：模型 ID 大小写不敏感去重
    const key = entry.id.toLowerCase();
    if (seenIds.has(key)) continue;
    seenIds.add(key);
    models.push(entry.id);
  }

  // 【规则】根层 `model`（当前生效模型）必须并入 `models`，即使它没出现在任何
  // provider 的 `models[]` 里——网关对超长目录会截断，当前模型可能恰好落在被截断的尾部。
  // 注意：只补 `models`，**不为它伪造 `entries`**，显示层查不到时会回退为 ID 派生名。
  if (model && !seenIds.has(model.toLowerCase()) && !isPlaceholderId(model)) {
    models.push(model);
  }

  return {
    entries,
    models,
    currentModel: model,
    currentProvider: provider,
    ok: true,
  };
}

/**
 * 按当前模型定位条目。
 *
 * 【规则】先按 `(id, provider)` 精确匹配，再退化按 provider 展示名，最后仅按 `id` 匹配——
 * 网关可能把 provider 报成 `auto`（自动探测），此时只有 ID 可信。
 * 三轮都未命中必须返回 `undefined`，由调用方决定退回派生名显示。
 */
export function findCatalogEntry(
  entries: readonly ModelCatalogEntry[],
  model: string,
  provider = '',
): ModelCatalogEntry | undefined {
  const id = (model ?? '').trim();
  if (!id) return undefined;
  const slug = (provider ?? '').trim().toLowerCase();

  if (slug) {
    const exact = entries.find((e) => e.id === id && e.providerSlug.toLowerCase() === slug);
    if (exact) return exact;
    const alias = entries.find((e) => e.id === id && e.providerName.toLowerCase() === slug);
    if (alias) return alias;
  }

  return entries.find((e) => e.id === id);
}

/** 当前模型的单行标签；目录里查不到时回退为 ID 派生名，绝不返回裸空。 */
export function modelLabelFromCatalog(
  entries: readonly ModelCatalogEntry[],
  model: string,
  provider = '',
): string {
  const entry = findCatalogEntry(entries, model, provider);
  if (entry) return entry.displayName;
  return parseModelDisplay(model).name;
}

/** 按 provider 分组，保持网关给出的原始顺序（选择器分行依赖此顺序）。 */
export function groupCatalogByProvider(
  entries: readonly ModelCatalogEntry[],
): Array<{ slug: string; name: string; entries: ModelCatalogEntry[] }> {
  const groups = new Map<string, { slug: string; name: string; entries: ModelCatalogEntry[] }>();
  for (const entry of entries) {
    const key = entry.providerSlug;
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.set(key, { slug: entry.providerSlug, name: entry.providerName, entries: [entry] });
    }
  }
  return Array.from(groups.values());
}

/**
 * 目录指纹：把**所有参与渲染**的字段压成一个可比较字符串。
 *
 * 【设计意图 (Why)】
 *   渲染层靠"快照是否变化"决定要不要重绘输入舱。如果指纹只包含 `id`，
 *   那么网关把某个模型标记为不可用、发布新的量化版本、或上下文窗口变化时，
 *   指纹不变 → 不重绘 → 用户看到的是过期状态（例如模型已锁但仍显示为可点）。
 *
 * 【防范的历史坑 (Pitfall)】
 *   初版指纹只有 `providerSlug:id:displayName`，遗漏 `unavailable` / `quant` /
 *   `context` / `pricing` / `capabilities`，导致这些变化全部静默不刷新。
 *
 * 【约束与规则 (Rules)】
 *   - 必须覆盖每个字段的**渲染相关**取值；新增可见字段时必须同步加入这里；
 *   - 纯函数，输出稳定（同输入同输出），空数组返回空串；
 *   - 只在目录变化时调用一次，禁止放进每帧渲染热路径。
 */
export function modelCatalogFingerprint(entries: readonly ModelCatalogEntry[]): string {
  if (!entries || entries.length === 0) return '';
  return entries
    .map((e) =>
      [
        e.providerSlug,
        e.providerName,
        e.id,
        e.displayName,
        e.vendor,
        e.vendorId,
        e.variant,
        e.quant,
        e.context,
        e.route,
        e.date,
        e.unavailable ? '1' : '0',
        e.featured ? '1' : '0',
        e.pricing ? `${e.pricing.input}/${e.pricing.output}/${e.pricing.free ? 'free' : ''}` : '',
        e.capabilities ? `${e.capabilities.fast ? 'f' : ''}${e.capabilities.reasoning ? 'r' : ''}` : '',
        e.contextLength ?? '',
        e.supportsVision ? 'v' : '',
        e.providerWarning ?? '',
      ].join('\u0001'),
    )
    .join('\u0002');
}
