/**
 * 提供商目录归一化（设置中心 · 单一真值）
 *
 * 【设计意图 (Why)】
 *   输入舱的模型选择器只该出现"一选就能用"的 provider，因此 `normalizeModelCatalog`
 *   会丢弃未认证、以及全部模型被锁的 provider 行。设置中心的目标相反：
 *   它必须把**未配置的 provider 也列出来**，否则用户没有任何入口去填 API Key。
 *   两个场景对同一份 `model.options` 响应有相反的可见性要求，必须各自持有归一化口径，
 *   不能靠给模型目录加开关来复用。
 *
 * 【防范的历史坑 (Pitfall)】
 *   历史实现把提供商卡片写成 7 个字符串常量（jev / agnes-ai / CPA / FN / magpie …），
 *   与网关真实返回毫无关系：用户看到的提供商列表是编造的，且点任何一张卡都没有反应。
 *   本模块是那条路径的唯一替代品——列表里出现什么，完全由 `model.options` 决定。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯函数、零 DOM、零网络；未知字段一律忽略，绝不猜测；
 *   2. `authenticated` 缺省视为未知（保留该行），只有明确的 `false` 才标记为未认证；
 *   3. 模型数量只统计**可选项**（`models` 去掉 `unavailable_models`），
 *      但 `free_tier_pending` 期间锁名单是 fail-closed 占位，不得据此扣减；
 *   4. 不产出任何占位 provider：没有 `slug` 的行直接丢弃。
 */

/** 提供商账号池中单个账号的运行态（来自网关 `usage.accounts`）。 */
export interface ProviderAccountRow {
  id: string;
  label?: string;
  state: 'ready' | 'limited' | 'unknown' | 'unavailable';
  resetsAt?: string;
}

/** 设置中心渲染一行提供商所需的最小视图模型。 */
export interface ProviderDirectoryRow {
  slug: string;
  name: string;
  /** 明确 `authenticated === false` 时为 false；缺省视为未知但可用，保持 true。 */
  authenticated: boolean;
  /** 可选模型数量（已剔除明确不可用的模型）。 */
  availableModelCount: number;
  /** 网关声明的密钥环境变量名，用于告诉用户密钥会落到哪里。 */
  keyEnv?: string;
  apiUrl?: string;
  /** 网关自带告警（订阅不足、额度耗尽、entitlement 待定等），必须原样透出。 */
  warning?: string;
  source?: string;
  freeTier: boolean;
  isCurrent: boolean;
  accounts: ProviderAccountRow[];
  /** 账号级限流窗口的重置时间（若网关给出）。 */
  limitResetsAt?: string;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = typeof item === 'string' ? item.trim() : '';
    if (text) out.push(text);
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function normalizeAccount(raw: unknown): ProviderAccountRow | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asString(row.id) || asString(row.label);
  if (!id) return null;
  const rawState = asString(row.state).toLowerCase();
  const state: ProviderAccountRow['state'] =
    rawState === 'ready' || rawState === 'limited' || rawState === 'unavailable' ? rawState : 'unknown';
  return {
    id,
    label: asString(row.label) || undefined,
    state,
    resetsAt: asString(row.resets_at) || undefined,
  };
}

/**
 * 从 `model.options` 原始响应构建设置页的提供商目录。
 *
 * @param payload 网关 `model.options` 的原始结果（形状未知，函数内部全量防御）
 * @param currentProvider 当前生效的 provider slug，用于标记"使用中"
 */
export function buildProviderDirectory(payload: unknown, currentProvider = ''): ProviderDirectoryRow[] {
  const root = asRecord(payload);
  if (!root) return [];
  const providers = Array.isArray(root.providers) ? root.providers : [];
  const current = currentProvider.trim().toLowerCase();

  const rows: ProviderDirectoryRow[] = [];
  const seen = new Set<string>();

  for (const raw of providers) {
    const row = asRecord(raw);
    if (!row) continue;

    const slug = asString(row.slug);
    if (!slug) continue;
    const key = slug.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const models = asStringArray(row.models);
    const pending = row.free_tier_pending === true;
    const locked = pending ? new Set<string>() : new Set(asStringArray(row.unavailable_models));
    const availableModelCount = models.filter((id) => !locked.has(id)).length;

    const usage = asRecord(row.usage);
    const rawAccounts = usage && Array.isArray(usage.accounts) ? usage.accounts : [];
    const accounts = rawAccounts.map(normalizeAccount).filter((item): item is ProviderAccountRow => item !== null);

    const limit = asRecord(row.limit);

    rows.push({
      slug,
      name: asString(row.name) || slug,
      authenticated: row.authenticated !== false,
      availableModelCount,
      keyEnv: asString(row.key_env) || undefined,
      apiUrl: asString(row.api_url) || undefined,
      warning: asString(row.warning) || undefined,
      source: asString(row.source) || undefined,
      freeTier: row.free_tier === true,
      isCurrent: current.length > 0 && key === current,
      accounts,
      limitResetsAt: limit ? asString(limit.resets_at) || undefined : undefined,
    });
  }

  // 当前使用的提供商永远置顶，其余保持网关原始顺序（用户对顺序有肌肉记忆）
  return rows.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
}

/** MCP 服务器运行态行（设置中心只消费这一份投影）。 */
export interface McpServerRow {
  name: string;
  transport: string;
  toolCount: number;
  connected: boolean;
  disabled: boolean;
  status: string;
}

/** 从 `mcp.servers.status` 原始响应构建运行态列表。 */
export function buildMcpServerRows(payload: unknown): McpServerRow[] {
  const root = asRecord(payload);
  if (!root) return [];
  const servers = Array.isArray(root.servers) ? root.servers : [];
  const rows: McpServerRow[] = [];
  for (const raw of servers) {
    const row = asRecord(raw);
    if (!row) continue;
    const name = asString(row.name);
    if (!name) continue;
    rows.push({
      name,
      transport: asString(row.transport) || 'stdio',
      toolCount: typeof row.tools === 'number' ? row.tools : 0,
      connected: row.connected === true,
      disabled: row.disabled === true,
      status: asString(row.status) || 'configured',
    });
  }
  return rows;
}

/** 技能行（`skills.manage { action: 'list' }` 的投影）。 */
export interface SkillRow {
  name: string;
  category: string;
}

/**
 * 从 `skills.manage` 原始响应构建技能列表。
 *
 * 网关的 `skills` 字段是「分类 → 名称数组」的映射；也兼容 `items[]` 形状（browse/inspect 路径）。
 * 两种形状都拿不到时返回空数组，由调用方渲染显式空态，绝不伪造技能。
 */
export function buildSkillRows(payload: unknown): SkillRow[] {
  const root = asRecord(payload);
  if (!root) return [];
  const rows: SkillRow[] = [];

  const map = asRecord(root.skills);
  if (map) {
    for (const [category, value] of Object.entries(map)) {
      for (const name of asStringArray(value)) rows.push({ name, category });
    }
  }

  if (Array.isArray(root.items)) {
    for (const raw of root.items) {
      const row = asRecord(raw);
      if (!row) continue;
      const name = asString(row.name);
      if (!name) continue;
      rows.push({ name, category: asString(row.source) || 'installed' });
    }
  }

  const seen = new Set<string>();
  return rows.filter((row) => {
    // 网关在长列表里会返回 `<more:N>` 占位符，它不是技能名，必须剔除。
    if (row.name.startsWith('<more:')) return false;
    const key = `${row.category}\u0000${row.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
