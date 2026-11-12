/**
 * 统一提供商视图（订阅 + 自定义端点，单一列表）。
 *
 * 【设计意图 (Why)】
 *   用户心智里「订阅」和「自定义端点」都是"我给这个工作台接的模型来源"，差别只在接入方式：
 *   订阅走 OAuth 登录，自定义填地址与密钥。把它们拆成两套列表，用户就得在两处找同一个概念，
 *   而且"哪些 Agent 在用"这个问题在两处各答一遍、口径还不同。
 *   本模块是这两类来源唯一的归并入口：输入两份原始响应，输出一张可以直接渲染的表。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 上一版把 Agent 维度做成顶部头像条 + 视角切换，于是"这个 provider 对哪些 Agent 生效"
 *      要用户自己点进第二个视角现算。归并后 Agent 变成行的一个字段，不需要切换。
 *   2. 生效范围一度写成"N/M 生效"，用户读不懂分母是什么。范围必须落成人话：
 *      所有 Agent / 2 个 Agent / 仅 aura。
 *   3. 订阅的登录态是**按 profile 独立**的（实测 default 读 /opt/data/auth.json，
 *      其余读 /opt/data/profiles/<name>/auth.json）。所以"订阅对所有 Agent 生效"这句话
 *      只能由实测数据支撑，不能写死成文案。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯函数、零 DOM、零网络；畸形输入返回空数组而不是抛出。
 *   2. 归并主键是 provider id；同一个 id 在多个 profile 上出现时合并成一行。
 *   3. 每个 Agent 槽位必有一个状态，长度恒等于 roster 长度，绝不缺项。
 *   4. 计数只用于排序，判定一律用状态枚举。
 */

/** 提供商的接入方式。这是唯一需要区分的类型差异。 */
export type ProviderKind = 'subscription' | 'custom';

/**
 * 端点 id 归一化：`custom:fn` 与 `fn` 指同一个端点。
 * 【规则】只去掉 `custom:` 前缀，其余字符原样保留（id 是用户可写的标识，不得擅自小写）。
 * 【为什么在这里重复一份】`providerAdmin.ts` 已导出同名函数，但本文件需要它参与归并键，
 *   而 providerAdmin 的导出面向"端点表单"，二者语义一致但分属两个域。为避免循环依赖
 *   与跨域耦合，这里保留同构实现，并由单测锁定两者行为一致。
 */
function normalizeEndpointId(id: string): string {
  const text = id.trim();
  return text.toLowerCase().startsWith('custom:') ? text.slice('custom:'.length) : text;
}

/**
 * 某个 Agent 与某个提供商的关系。
 *
 * - `active`：该 Agent 的主模型正指向此提供商（网关 `model.options.is_current`）。
 * - `ready`  ：已配置或已登录，可用但不是当前主模型。
 * - `absent` ：该 Agent 没有这个提供商（例如只在别的 profile 上配过）。
 * - `error`  ：这次读取失败，未知而非不存在（Failure Is Not Empty）。
 */
export type AgentBindingState = 'active' | 'ready' | 'absent' | 'error';

export interface AgentBinding {
  profile: string;
  displayName: string;
  state: AgentBindingState;
  /** `error` 时是原始原因；`active` 时是正在使用的主模型。 */
  detail?: string;
}

/** 提供商自身的可用性，与"哪个 Agent 在用"正交。 */
export type ProviderAvailability = 'active' | 'ready' | 'not_configured' | 'error';

/** 生效范围：由各 Agent 槽位现算，供界面直接说人话。 */
export type ProviderScope =
  | { kind: 'all' }
  | { kind: 'some'; profiles: string[] }
  | { kind: 'none' };

export interface ProviderView {
  /** 稳定主键：`subscription:<id>` / `custom:<id>`，跨来源不会撞。 */
  key: string;
  kind: ProviderKind;
  /** 网关给的原始 id（自定义端点已去掉 `custom:` 前缀）。 */
  id: string;
  name: string;
  /**
   * 该提供商的可用模型 id 列表（切换主模型必须点名一个具体模型，空列表即表示不可切换）。
   *
   * 【权威来源】运行时目录（`model.options`）优先，端点清单的声明目录只作兜底：
   *   端点换过上游时声明目录会保留旧模型，展示它会让用户点到一个选不到的 id。
   */
  models: string[];
  /** 一行副标题数据：自定义是端点地址，订阅是套餐与凭据来源。UI 决定展示哪一部分。 */
  detail: string;
  availability: ProviderAvailability;
  /** 长度恒等于 roster 长度。 */
  agents: AgentBinding[];
  /** 订阅专用：不可自动断开时网关给的手动做法。 */
  manualHint?: string;
  /** 订阅专用：登录 token 是否快过期，供界面提示重新登录。 */
  expiresAt?: string;
}

/** 一个 Agent 的身份，来自 `profiles.list`。 */
export interface ProviderAgentRef {
  profile: string;
  displayName: string;
}

/** 单个 profile 的 `model.options?explicit_only=true` 摘要。 */
export interface ProfileModelOption {
  profile: string;
  displayName: string;
  /**
   * 该 profile 当前主模型 id（`model.options` 顶层 `model`）。
   *
   * 【为什么必须留在这里】网关只在顶层给出"这一份目录的当前模型"，provider 行内没有
   * `current_model` 字段。读不到它，`active` 槽位就只能说"在用"却说不出在用哪个模型，
   * 模型弹框里的"当前模型"标记也会整片消失。
   */
  currentModel?: string;
  /** 该 profile 已配置的 provider slug → 详情。 */
  rows: Array<{
    slug: string;
    modelCount: number;
    /** 模型 id 列表。切换主模型必须点名一个具体模型，空列表时不能假装能切。 */
    models: string[];
    isCurrent: boolean;
    userDefined: boolean;
    apiUrl?: string;
    /** 网关记录的当前主模型 id，与 `isCurrent` 同时为真（部分网关版本不返回）。 */
    currentModel?: string;
  }>;
  /** 读取失败时的原始原因。 */
  error?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 只接受字符串数组；其它类型整体丢弃，不把对象塞进模型列表。 */
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = asString(item);
    if (text) out.push(text);
  }
  return out;
}

/**
 * 从 `model.options` 的原始响应里抽出该 profile 的 provider 摘要。
 * 【规则】只看 `providers` 数组；缺字段的行丢弃而不是猜。
 */
export function summarizeModelOptions(
  profile: string,
  displayName: string,
  payload: unknown,
): ProfileModelOption {
  const root = asRecord(payload);
  const raw = root && Array.isArray(root.providers) ? root.providers : [];
  const rows: ProfileModelOption['rows'] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row) continue;
    const slug = asString(row.slug);
    if (!slug) continue;
    const models = asStringArray(row.models);
    rows.push({
      slug,
      modelCount: models.length,
      models,
      isCurrent: row.is_current === true,
      userDefined: row.is_user_defined === true,
      apiUrl: asString(row.api_url) || undefined,
      currentModel: asString(row.current_model) || undefined,
    });
  }
  return {
    profile,
    displayName,
    currentModel: asString(root?.model) || undefined,
    rows,
  };
}

/** 订阅与自定义的归一化输入。二者都在 profile 作用域下读取。 */
export interface ProviderSourceInput {
  roster: readonly ProviderAgentRef[];
  /** 每个 profile 的 `model.options` 摘要，含失败项。 */
  options: readonly ProfileModelOption[];
  /** 订阅目录（含未登录项），来自 `/api/providers/oauth`。 */
  subscriptions: readonly OauthProviderRowLike[];
  /** 自定义端点列表，来自 `/api/providers/custom-endpoints`（已归一化）。 */
  endpoints: readonly CustomEndpointRowLike[];
}

/** 只取归并用得到的字段，避免 core 依赖 desktop 的类型。 */
export interface OauthProviderRowLike {
  id: string;
  name: string;
  flow: string;
  loggedIn: boolean;
  accountTier?: string;
  expiresAt?: string;
  sourceLabel?: string;
  cliCommand?: string;
  error?: string;
}

export interface CustomEndpointRowLike {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  hasApiKey: boolean;
}

function bindingFor(
  ref: ProviderAgentRef,
  state: AgentBindingState,
  detail?: string,
): AgentBinding {
  return { profile: ref.profile, displayName: ref.displayName, state, detail };
}

/**
 * 判断某个 provider 在某个 profile 上的状态。
 * 【规则】profile 读取失败时是 `error`，不是 `absent`。
 * 【规则】`custom:fn` 与 `fn` 是同一个端点，槽位匹配必须走同一套归一化，
 *   否则端点以 `custom:` 形态出现在 `model.options` 时会被误判成未配置。
 */
function stateForProfile(option: ProfileModelOption | undefined, slug: string): AgentBindingState {
  if (!option) return 'error';
  if (option.error) return 'error';
  const hit = option.rows.find((row) => normalizeEndpointId(row.slug) === normalizeEndpointId(slug));
  if (!hit) return 'absent';
  return hit.isCurrent ? 'active' : 'ready';
}

/**
 * 订阅槽位：登录一次默认对所有 Agent 生效。
 *
 * 【为什么与自定义端点不同】订阅是账号级来源，登录态落在共享 auth（`share_auth` 回落），
 *   其他 profile 只读共享，不各自持有一份可写的端点记录。因此“未登录该订阅”不等于
 *   “该 Agent 没有这个来源”：只要订阅已登录，所有 Agent 默认可用。
 *   这里只在 `model.options` 读取失败时标 error；主模型指向它时标 active；其余 ready。
 *
 * 【规则】读取失败绝不能被渲染成“未配置”（Failure Is Not Empty）。
 */
function subscriptionStateForProfile(option: ProfileModelOption | undefined, slug: string): AgentBindingState {
  if (!option || option.error) return 'error';
  const hit = option.rows.find((row) => normalizeEndpointId(row.slug) === normalizeEndpointId(slug));
  return hit?.isCurrent ? 'active' : 'ready';
}

function apiUrlFor(options: readonly ProfileModelOption[], slug: string): string {
  for (const option of options) {
    const hit = option.rows.find((row) => row.slug === slug);
    if (hit?.apiUrl) return hit.apiUrl;
  }
  return '';
}

/**
 * 把订阅与自定义端点归并成一张表。
 *
 * 【归并的基座是 `model.options`，不是端点列表】
 *   `model.options?explicit_only=true` 才是"这个 Agent 真的配了什么、能不能用"的唯一权威：
 *   自定义端点会以 `fn` 或 `custom:fn` 出现，订阅以 `xai-oauth` 出现。
 *   `/api/providers/custom-endpoints` 与 `/api/providers/oauth` 只是**编辑用的富信息**
 *   （端点地址、是否有密钥、登录态、不可断开时的手动做法）。
 *   若以端点列表为基座，一旦端点列表只拉了部分 profile 或请求失败，那些确实在用的
 *   provider 会整行消失——用户会以为模型来源没了。
 *
 * 【规则】
 *   1. 先铺基座：所有 profile 的 options 行按归一化 id 去重；
 *   2. 再用端点与订阅补充富信息，补齐尚未出现的项（未登录订阅、未配置的端点）；
 *   3. 类型判定：出现在订阅目录即 `subscription`，否则 `custom`；
 *   4. 排序：当前使用的在前，其次可用，最后待配置。
 */
export function mergeProviderViews(input: ProviderSourceInput): ProviderView[] {
  const { roster, options, subscriptions, endpoints } = input;
  const byProfile = new Map<string, ProfileModelOption>();
  for (const option of options) byProfile.set(option.profile, option);

  // 端点可能被多个 profile 各返回一次，先按归一化 id 收敛并取并集。
  const endpointById = new Map<string, CustomEndpointRowLike>();
  for (const endpoint of endpoints) {
    if (!endpoint.id) continue;
    const id = normalizeEndpointId(endpoint.id);
    const existing = endpointById.get(id);
    if (!existing) {
      endpointById.set(id, { ...endpoint, id });
      continue;
    }
    endpointById.set(id, {
      ...existing,
      models: existing.models.length >= endpoint.models.length ? existing.models : endpoint.models,
      hasApiKey: existing.hasApiKey || endpoint.hasApiKey,
    });
  }

  const subscriptionById = new Map<string, OauthProviderRowLike>();
  for (const sub of subscriptions) {
    if (!sub.id) continue;
    const id = normalizeEndpointId(sub.id);
    if (!subscriptionById.has(id)) subscriptionById.set(id, { ...sub, id });
  }

  // 基座：每个在用 provider 的归一化 id → 见过的最全信息。
  const seed = new Map<string, { models: string[]; userDefined: boolean; apiUrl: string; currentModel?: string }>();
  for (const option of options) {
    for (const row of option.rows) {
      const id = normalizeEndpointId(row.slug);
      const prev = seed.get(id);
      if (!prev) {
        seed.set(id, {
          models: [...row.models],
          userDefined: row.userDefined,
          apiUrl: row.apiUrl ?? '',
          currentModel: row.currentModel,
        });
        continue;
      }
      seed.set(id, {
        // 不同 profile 可能装不同版本的同一 provider，模型列表取更全的那份。
        models: prev.models.length >= row.models.length ? prev.models : [...row.models],
        userDefined: prev.userDefined || row.userDefined,
        apiUrl: prev.apiUrl || row.apiUrl || '',
        currentModel: prev.currentModel || row.currentModel,
      });
    }
  }

  /**
   * 进主列表的 id 集合。
   * 【规则】未登录的订阅不进主列表：`/api/providers/oauth` 返回的是全部订阅目录，
   *   把从未登录过的也铺进来，用户会看到一排「未登录」，误以为自己订了只是掉线。
   *   只有真的登录过（出现在某个 Agent 的 options 里，或目录标记 loggedIn）才算一条可用来源；
   *   其余留给添加弹框——那里才是"去登录"的正确语境。
   */
  const ids = new Set<string>([...seed.keys(), ...endpointById.keys()]);
  for (const [id, sub] of subscriptionById) {
    if (sub.loggedIn || seed.has(id)) ids.add(id);
  }

  const views: ProviderView[] = [];

  for (const id of ids) {
    const sub = subscriptionById.get(id);
    const endpoint = endpointById.get(id);
    const seeded = seed.get(id);
    const kind: ProviderKind = sub ? 'subscription' : 'custom';

    // 订阅默认对所有 Agent 生效；自定义端点只对配置过它的 Agent 存在。
    const agents = roster.map((ref) => {
      const option = byProfile.get(ref.profile);
      const state = kind === 'subscription'
        ? subscriptionStateForProfile(option, id)
        : stateForProfile(option, id);
      // `active` 的 detail 必须是正在使用的模型：模型选择器靠它标「当前模型」。
      // 缺失时用户只能看到"使用中"却不知道是哪个模型，等于把主模型信息丢了。
      // 【规则】先读 provider 行的 `current_model`，网关不返回时回落到该 profile 的顶层
      //   `model`——`is_current` 与顶层 `model` 描述的是同一个选择。
      const activeRow = state === 'active'
        ? option?.rows.find((row) => normalizeEndpointId(row.slug) === id)
        : undefined;
      const currentModel = state === 'active'
        ? activeRow?.currentModel || option?.currentModel
        : undefined;
      return bindingFor(ref, state, currentModel);
    });

    if (kind === 'subscription') {
      views.push({
        key: `subscription:${id}`,
        kind,
        id,
        name: sub?.name || id,
        // 订阅的模型列表来自 options 的种子：切换主模型必须点名一个具体模型。
        models: seeded ? [...seeded.models] : [],
        detail: subscriptionDetail(sub!),
        availability: resolveAvailability(agents, true),
        agents,
        manualHint: sub?.flow === 'external' ? sub.cliCommand : undefined,
        expiresAt: sub?.expiresAt,
      });
      continue;
    }

    views.push({
      key: `custom:${id}`,
      kind,
      id,
      name: endpoint?.name || id,
      /**
       * 【规则】运行时目录优先，端点清单只是兜底。
       *   端点清单的 `models` 是 config.yaml 里声明过的静态目录，端点改过上游或换了代理后
       *   会保留旧模型（实测 cpa 声明 `deepseek-v4.1-flash`，运行时只有 `cpa/gemini-3.8-flash`），
       *   直接展示会让用户去点一个根本选不到的模型。`model.options` 是网关现算的可用目录，
       *   只有它完全缺失（该端点没在任何 profile 生效）时才退回声明值。
       */
      models: seeded && seeded.models.length > 0
        ? [...seeded.models]
        : endpoint
          ? [...endpoint.models]
          : [],
      // 端点列表没拉到时用 options 里的 api_url 兜底，副标题不留空。
      detail: endpoint?.baseUrl || seeded?.apiUrl || '',
      availability: resolveAvailability(agents, endpoint ? endpoint.hasApiKey : seeded !== undefined),
      agents,
    });
  }

  return views.sort((left, right) => rank(left.availability) - rank(right.availability));
}

function subscriptionDetail(sub: OauthProviderRowLike): string {
  const parts: string[] = [];
  if (sub.accountTier) parts.push(sub.accountTier);
  if (sub.sourceLabel) parts.push(sub.sourceLabel);
  return parts.join(' · ');
}

function resolveAvailability(agents: readonly AgentBinding[], configured: boolean): ProviderAvailability {
  if (agents.some((agent) => agent.state === 'error')) return 'error';
  if (agents.some((agent) => agent.state === 'active')) return 'active';
  if (configured && agents.some((agent) => agent.state === 'ready')) return 'ready';
  return 'not_configured';
}

function rank(availability: ProviderAvailability): number {
  switch (availability) {
    case 'active':
      return 0;
    case 'ready':
      return 1;
    case 'error':
      return 2;
    default:
      return 3;
  }
}

/**
 * 生效范围：谁的主模型正指向这个提供商。
 * 【规则】只看 `active`。`ready` 是"能选但没选"，不能算生效。
 */
export function providerScope(view: ProviderView): ProviderScope {
  const active = view.agents.filter((agent) => agent.state === 'active').map((agent) => agent.profile);
  if (active.length === 0) return { kind: 'none' };
  if (active.length === view.agents.length && view.agents.length > 0) return { kind: 'all' };
  return { kind: 'some', profiles: active };
}

/**
 * 生效范围的可读标签。
 * 【设计意图】用户看不懂"N/5 生效"。这里直接给句子：
 *   · 全部 Agent 都指向它 → "所有 Agent"
 *   · 部分 → 数量（超过 2 个时给"等 N 个"，2 个以内直接列名）
 *   · 没有 → "未生效"
 * 【规则】返回的是文案 key 与参数，不返回自然语言，i18n 由调用方决定。
 */
export type ProviderScopeLabel =
  | { kind: 'all' }
  | { kind: 'named'; profiles: string[] }
  | { kind: 'count'; count: number; total: number }
  | { kind: 'none' };

export function describeScope(view: ProviderView): ProviderScopeLabel {
  const scope = providerScope(view);
  if (scope.kind === 'all') return { kind: 'all' };
  if (scope.kind === 'none') return { kind: 'none' };
  if (scope.profiles.length <= 2) return { kind: 'named', profiles: scope.profiles };
  return { kind: 'count', count: scope.profiles.length, total: view.agents.length };
}

/**
 * 这个提供商在哪些 Agent 上真实存在（active 或 ready）。
 *
 * 【为什么不再用于删除】这是 `model.options` 的**在用集合**，不是配置集合。
 *   端点存在于某个 profile 的配置里、却没进 `model.options`（未生效、未带模型）时，
 *   这个集合会漏掉它，删除于是被判定成"没有任何 Agent 在用"而拒绝——用户看着一行删不掉。
 *   删除必须用 `ProviderCatalogEndpoint.profiles`（端点清单算出的配置集合）。
 *   本函数仅保留给"哪些 Agent 上可以立刻切换模型"这类在用语义使用。
 *
 * 【规则】`error` 的 Agent 必须排除：读不到的不能猜。
 */
export function profilesWithProvider(view: ProviderView): string[] {
  return view.agents
    .filter((agent) => agent.state === 'active' || agent.state === 'ready')
    .map((agent) => agent.profile);
}

/**
 * 勾选/取消勾选某一个 Agent 时应当发生什么。
 *
 * 【设计意图 (Why)】
 *   界面上一个勾选框同时承担三件事：新增绑定、移除绑定、以及"这件事现在做不了"。
 *   把判定放在纯函数里，视图只负责渲染，测试才能穷举四种状态 × 两个方向。
 *   把"配置给这个 Bot"与"切为这个 Bot 的默认模型"拆成两步意图，防止误点直接覆盖当前主模型。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. `active` 的 Agent 一旦被取消勾选，它的当前主模型就指向一个不存在的 provider。
 *      用户已确认的策略是"先改模型再移除"，所以这里必须阻断，而不是交给网关报错。
 *   2. `error` 的 Agent 与 `absent` 长得像，但前者是"读不到"，不能当成"没配"去写。
 *   3. 自定义端点的新增需要明文密钥（GET 不回密钥），订阅不需要（登录态按 profile 回落）。
 *      这个差异必须在计划里显式表达，不能由视图自己猜。
 *   4. 点击未启用头像曾直接按 `makeDefault: true` 落盘，只想给 Bot 挂载备选提供商时被迫改掉主模型。
 *      现在必须由用户显式给出意图，缺意图一律先走 `confirm-attach`。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯函数，不做任何网络与状态写入；
 *   2. 已处于目标状态的点击返回 `noop`，不发无意义请求；
 *   3. 未知 profile 返回 `unknown-profile`，由调用方提示重读，不静默忽略；
 *   4. 勾选未配置的自定义端点且缺少 `attachIntent` 时，必须返回 `confirm-attach`，不得猜默认意图。
 */
export type BindingAttachIntent = 'enable-only' | 'enable-and-default';

export type BindingTogglePlan =
  | { kind: 'confirm-attach'; profile: string; requiresApiKey: boolean }
  | { kind: 'attach'; profile: string; requiresApiKey: boolean; makeDefault: boolean; intent: BindingAttachIntent }
  | { kind: 'login-required'; profile: string }
  | { kind: 'detach'; profile: string }
  | { kind: 'logout-subscription'; profile: string }
  | { kind: 'blocked-active'; profile: string }
  | { kind: 'blocked-error'; profile: string; message: string }
  | { kind: 'noop'; profile: string }
  | { kind: 'unknown-profile'; profile: string };

/**
 * 勾选一个未配置的 Agent 时该落到哪个模型。
 *
 * 【设计意图 (Why)】
 *   勾选同时要回答"用哪个模型"，否则只能建立配置关系、主模型纹丝不动，用户点完看到
 *   没有绿环，会认为点击失灵。默认模型优先取端点自己声明的 `model`，但它可能已经不在
 *   运行时目录里（端点换过上游/代理），此时必须退到运行时目录的第一个，绝不把主模型
 *   指向一个选不到的 id。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯函数：只做集合判定，不猜别名、不规范化大小写（模型 id 区分大小写）；
 *   2. 目录为空时原样返回声明值，由网关做最终校验并给出真实拒绝原因；
 *   3. 声明值为空时直接取目录第一个。
 */
export function resolveBindingDefaultModel(declared: string, models: readonly string[]): string {
  const wanted = declared.trim();
  const catalog = models.map((model) => model.trim()).filter(Boolean);
  if (catalog.length === 0) return wanted;
  if (wanted && catalog.includes(wanted)) return wanted;
  return catalog[0];
}

export function planBindingToggle(
  view: ProviderView,
  profile: string,
  nextChecked: boolean,
  attachIntent?: BindingAttachIntent,
): BindingTogglePlan {
  const agent = view.agents.find((item) => item.profile === profile);
  if (!agent) return { kind: 'unknown-profile', profile };
  if (agent.state === 'error') {
    return { kind: 'blocked-error', profile, message: agent.detail || '' };
  }

  if (nextChecked) {
    if (agent.state === 'active' || agent.state === 'ready') return { kind: 'noop', profile };
    // 订阅没有可写的端点记录：它的绑定由该 profile 上的 OAuth 登录态决定，
    // 客户端没有任何接口能把"登录态"复制到另一个 Agent。所以只能引导去登录。
    if (view.kind === 'subscription') return { kind: 'login-required', profile };
    if (!attachIntent) return { kind: 'confirm-attach', profile, requiresApiKey: true };
    return {
      kind: 'attach',
      profile,
      requiresApiKey: true,
      makeDefault: attachIntent === 'enable-and-default',
      intent: attachIntent,
    };
  }

  if (agent.state === 'active') return { kind: 'blocked-active', profile };
  if (agent.state === 'ready') {
    // 订阅的"取消绑定"就是断开该 Agent 的 OAuth 登录；
    // 走 `DELETE custom-endpoints/{id}` 必然 404，因为订阅根本不在端点清单里。
    return view.kind === 'subscription'
      ? { kind: 'logout-subscription', profile }
      : { kind: 'detach', profile };
  }
  return { kind: 'noop', profile };
}

/**
 * 删除一个 provider 的可行性判定。
 *
 * 【设计意图】删除的对象是 **provider 实体**，不是"某些 Agent 上的绑定"。
 *   因为 provider 没有全局实体，物理上就是各 profile 配置里的副本，
 *   所以"完全删除"= 从所有配置了它的 Agent 上移除。
 *
 * 【用户已确认的策略】有 Agent 正在用它时**禁止删除**，要求先把这些 Agent 改到别的模型。
 *   所以 `active` 判定必须排在"配置集合为空"之前：读取不一致时宁可报告"在用"，
 *   也不能因为集合为空就放行一次静默的部分删除。
 *
 * 【规则】
 *   1. `configuredProfiles` 是配置集合（端点清单来源），不是在用集合；
 *   2. 去空、去重，保持首次出现顺序（写入顺序可预期）；
 *   3. 配置集合为空且无 active：返回 `empty`，由调用方记录数据不一致，不弹"没有 Agent 在用"。
 */
export type ProviderRemovalPlan =
  | { kind: 'blocked-in-use'; agents: Array<{ profile: string; displayName: string; model?: string }> }
  | { kind: 'ready'; profiles: string[] }
  | { kind: 'empty' };

export function planProviderRemoval(
  view: ProviderView,
  configuredProfiles: readonly string[],
): ProviderRemovalPlan {
  const inUse = view.agents
    .filter((agent) => agent.state === 'active')
    .map((agent) => ({ profile: agent.profile, displayName: agent.displayName, model: agent.detail }));
  if (inUse.length > 0) return { kind: 'blocked-in-use', agents: inUse };

  const profiles: string[] = [];
  for (const profile of configuredProfiles) {
    const name = profile.trim();
    if (name && !profiles.includes(name)) profiles.push(name);
  }
  if (profiles.length === 0) return { kind: 'empty' };
  return { kind: 'ready', profiles };
}

/**
 * 某个提供商在各 Agent 上的配置覆盖情况，用于说明"为什么在某些 Agent 上不可用"。
 * 【规则】只统计 `absent`，`error` 单独算，绝不混为一谈。
 */
export function summarizeCoverage(view: ProviderView): { configured: number; total: number; failed: number } {
  const total = view.agents.length;
  const failed = view.agents.filter((agent) => agent.state === 'error').length;
  const configured = view.agents.filter((agent) => agent.state !== 'absent' && agent.state !== 'error').length;
  return { configured, total, failed };
}
