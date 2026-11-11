/**
 * 提供商管理域模型（自定义端点 + 跨 Bot 对账 + Bot 头像标签）。
 *
 * 【设计意图 (Why)】
 *   设置页的"提供商"域有两类真值来源：RPC `model.options` 给内置/自定义提供商的运行态，
 *   REST `/api/providers/custom-endpoints` 给自定义端点的可编辑结构。两者字段名与语义都不同，
 *   组件层如果各写一套解析，必然出现"列表显示已配置、表单却是空的"。
 *   本模块是这两份响应唯一的归一化入口，视图只消费归一化后的行。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 网关的 `model.options` 只在**未配置**的骨架行上带 `auth_type` / `key_env`，
 *      已配置行没有这两个字段；把它当必填会让已配置提供商全部渲染成"认证方式未知"。
 *   2. 自定义端点的当前标识有两套拼写（`fn` 与 `custom:fn`），只比 slug 会把使用中的端点
 *      标成未使用。归一化必须在 id 层完成，而不是在组件里补字符串。
 *   3. 删除端点、清空密钥、保留密钥是三种不同意图。用一个可空字符串表达会让"留空=保留"
 *      和"留空=清除"互相覆盖，用户填完密钥反而被清掉。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯函数、零 DOM、零网络；网关响应全量防御，形状不符返回空数组而不是抛出。
 *   2. `api_mode` 只接受契约声明的四个值，UI 恒传 `''`（运行时自动检测），不做协议选择器。
 *   3. `discover_models` 恒为 true（自动获取模型），不暴露开关。
 *   4. 任何"数量"字段只做展示，不参与判定；判定一律用原始的 id / url。
 */

/** 端点传输协议。`''` = 运行时按 URL 自动检测，这是 UI 唯一会提交的值。 */
export type CustomEndpointApiMode = '' | 'anthropic_messages' | 'chat_completions' | 'codex_responses';

const API_MODES: readonly CustomEndpointApiMode[] = ['', 'anthropic_messages', 'chat_completions', 'codex_responses'];

/** 归一化后的自定义端点行。字段全部必有或显式 undefined，方便视图直接渲染。 */
export interface CustomEndpointRow {
  id: string;
  name: string;
  baseUrl: string;
  /** 该端点默认模型（网关的 `model` 字段）。 */
  model: string;
  /** 网关当前已知的模型 id 列表；非当前端点通常只有声明过的那一个。 */
  models: string[];
  apiMode: CustomEndpointApiMode;
  contextLength?: number;
  discoverModels: boolean;
  hasApiKey: boolean;
  /** `${ENV_VAR}` 或脱敏预览，仅用于展示，永不含明文。 */
  apiKeyPreview?: string;
  isCurrent: boolean;
  /** `providers` 新格式，`custom_providers` 旧格式。 */
  source: string;
}

/** 探测结果的判别联合。非法组合不可表达。 */
export type EndpointProbe =
  | { kind: 'ok'; models: string[]; modelCount: number; resolvedBaseUrl?: string; transport?: CustomEndpointApiMode }
  | { kind: 'warning'; message: string }
  | { kind: 'unreachable'; message: string };

/** 密钥意图。三种状态互斥，杜绝"留空到底是保留还是清除"的歧义。 */
export type ApiKeyIntent = { kind: 'keep' } | { kind: 'set'; value: string } | { kind: 'clear' };

/** 表单草稿。`id` 为空表示新建。 */
export interface CustomEndpointDraft {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: ApiKeyIntent;
  contextLength?: number;
  /** 上次测试发现的模型列表，随保存一并交给网关，避免列表回退成单个模型。 */
  models?: string[];
  modelDetails?: CustomEndpointModelDetail[];
}

export interface CustomEndpointModelDetail {
  id: string;
  canonicalModel?: string;
  reasoningEffort?: string;
}

/** 提交给 `POST /api/providers/custom-endpoints` 的请求体。 */
export interface CustomEndpointPayload {
  id: string;
  name: string;
  base_url: string;
  model: string;
  api_mode: CustomEndpointApiMode;
  discover_models: true;
  make_default: boolean;
  context_length?: number;
  models?: string[];
  model_details?: Array<{ id: string; canonical_model?: string; reasoning_effort?: string }>;
  api_key?: string;
}

/** Bot（profile）与某个端点的关系。`error` 表示这次读取失败，绝不能被当成"未配置"。 */
export type EndpointProfileState = 'same' | 'drift' | 'missing' | 'error';

export interface EndpointProfileCell {
  profile: string;
  displayName: string;
  state: EndpointProfileState;
  /** drift 时说明差在哪，供 UI 直接展示。 */
  detail?: string;
}

export interface ProfileEndpoints {
  profile: string;
  displayName: string;
  endpoints: CustomEndpointRow[];
}

/** Provider 视角下的别名：同一个结构，按端点聚合时阅读更顺。 */
export type ProviderEndpoints = ProfileEndpoints;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
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

function normalizeApiMode(value: unknown): CustomEndpointApiMode {
  const text = asString(value);
  return (API_MODES as readonly string[]).includes(text) ? (text as CustomEndpointApiMode) : '';
}

/**
 * 端点 id 归一化：`custom:fn` 与 `fn` 指同一个端点。
 * 【规则】只去掉 `custom:` 前缀，其他字符原样保留（id 是用户可写的标识，不得擅自小写）。
 */
export function normalizeEndpointId(id: string): string {
  const text = id.trim();
  return text.toLowerCase().startsWith('custom:') ? text.slice('custom:'.length) : text;
}

/** 从 `GET /api/providers/custom-endpoints` 的原始响应构建行列表。 */
export function normalizeCustomEndpoints(payload: unknown): CustomEndpointRow[] {
  const root = asRecord(payload);
  if (!root) return [];
  const raw = Array.isArray(root.endpoints) ? root.endpoints : [];
  const rows: CustomEndpointRow[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row) continue;
    const id = asString(row.id);
    const baseUrl = asString(row.base_url);
    // 没有 id 或没有端点地址的条目不是可管理的端点，丢弃而不是编造。
    if (!id || !baseUrl) continue;
    const contextLength = typeof row.context_length === 'number' && row.context_length > 0 ? row.context_length : undefined;
    rows.push({
      id,
      name: asString(row.name) || id,
      baseUrl,
      model: asString(row.model),
      models: asStringArray(row.models),
      apiMode: normalizeApiMode(row.api_mode),
      contextLength,
      discoverModels: row.discover_models !== false,
      hasApiKey: row.has_api_key === true,
      apiKeyPreview: asString(row.api_key_preview) || undefined,
      isCurrent: row.is_current === true,
      source: asString(row.source) || 'providers',
    });
  }
  return rows;
}

/** 新建端点的空白草稿。密钥意图为 `keep`，等价于"本次不写密钥"。 */
export function emptyEndpointDraft(): CustomEndpointDraft {
  return { id: '', name: '', baseUrl: '', model: '', apiKey: { kind: 'keep' }, models: [] };
}

/**
 * 从端点行还原草稿。
 * 【规则】密钥恒为 `keep`：GET 不回明文，草稿不能假装有值。
 */
export function draftFromEndpoint(row: CustomEndpointRow): CustomEndpointDraft {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    model: row.model,
    apiKey: { kind: 'keep' },
    contextLength: row.contextLength,
    models: row.models,
  };
}

/** 端点地址规整：去空白、去尾斜杠。协议缺失原样返回，由提交前校验拦截。 */
export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function isValidBaseUrl(value: string): boolean {
  const text = normalizeBaseUrl(value);
  if (!text) return false;
  try {
    const url = new URL(text);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.host);
  // gate-degrade: 非法地址是用户输入的预期分支，返回 false 表示"校验不通过"，不是错误被吞
  } catch {
    return false;
  }
}

/**
 * 从显示名派生 provider id。
 * 【规则】只保留小写字母、数字与连字符；派生结果为空时返回空串，由调用方要求用户手填。
 */
export function deriveEndpointId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[\s_/\\]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug;
}

/** 草稿是否可以提交。返回空数组表示可提交。 */
export function validateDraft(draft: CustomEndpointDraft): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push('name');
  if (!isValidBaseUrl(draft.baseUrl)) errors.push('baseUrl');
  if (!draft.model.trim()) errors.push('model');
  if (draft.apiKey.kind === 'set' && !draft.apiKey.value.trim()) errors.push('apiKey');
  return errors;
}

/**
 * 构造提交体。
 * 【约束】`make_default` 只允许作用于当前 Bot：跨 Bot 扇出一律 false，否则一次保存会把所有 Bot 的主模型改掉。
 */
export function toEndpointPayload(
  draft: CustomEndpointDraft,
  options: { id: string; makeDefault: boolean },
): CustomEndpointPayload {
  const payload: CustomEndpointPayload = {
    id: options.id,
    name: draft.name.trim(),
    base_url: normalizeBaseUrl(draft.baseUrl),
    model: draft.model.trim(),
    api_mode: '',
    discover_models: true,
    make_default: options.makeDefault,
  };
  if (draft.contextLength && draft.contextLength > 0) payload.context_length = Math.floor(draft.contextLength);
  if (draft.models && draft.models.length > 0) payload.models = [...draft.models];
  if (draft.modelDetails && draft.modelDetails.length > 0) {
    payload.model_details = draft.modelDetails.map((detail) => ({
      id: detail.id,
      ...(detail.canonicalModel ? { canonical_model: detail.canonicalModel } : {}),
      ...(detail.reasoningEffort ? { reasoning_effort: detail.reasoningEffort } : {}),
    }));
  }
  if (draft.apiKey.kind === 'set') payload.api_key = draft.apiKey.value.trim();
  // `keep` 不写字段，网关按"保留原密钥"处理；`clear` 显式写空串。
  if (draft.apiKey.kind === 'clear') payload.api_key = '';
  return payload;
}

/** 从 `POST .../validate` 的原始响应构建探测结果。 */
export function normalizeProbe(payload: unknown): EndpointProbe {
  const root = asRecord(payload);
  if (!root) return { kind: 'unreachable', message: '' };
  const message = asString(root.message);
  const reachable = root.reachable !== false;
  if (!reachable) return { kind: 'unreachable', message };
  if (root.ok !== true) return { kind: 'warning', message };
  const models = asStringArray(root.models);
  const resolved = asString(root.resolved_base_url) || undefined;
  const transport = normalizeApiMode(root.transport_checked);
  const failedTransportCheck = Boolean(message);
  if (failedTransportCheck) return { kind: 'warning', message };
  return { kind: 'ok', models, modelCount: models.length, resolvedBaseUrl: resolved, transport };
}

function endpointFingerprint(row: CustomEndpointRow): string {
  return `${normalizeBaseUrl(row.baseUrl)}\u0000${row.model.trim()}`;
}

/** 一次跨 Bot 读取的完整结果：成功通道与失败通道并存，绝不把失败折叠成"未配置"。 */
export interface EndpointMatrix {
  ok: ProfileEndpoints[];
  failed: Array<{ profile: string; displayName: string; message: string }>;
}

/**
 * 计算某个端点在各 Bot 上的分布。
 * 【设计意图】"这个 provider 给哪些 Bot 用了"没有服务端反向索引，只能在客户端现算。
 * 逐 profile 拉一次列表再比对，永远以网关返回为准，本地不存任何绑定关系。
 * 【防范的历史坑】读取失败的 Bot 必须标 `error`，不能落进 `missing`：
 *   用户会把"网络失败"读成"这个 Bot 没配"，进而重复配置（Failure Is Not Empty）。
 */
export function diffEndpointAcrossProfiles(
  baseline: CustomEndpointRow,
  matrix: EndpointMatrix,
): EndpointProfileCell[] {
  const targetId = normalizeEndpointId(baseline.id).toLowerCase();
  const cells: EndpointProfileCell[] = matrix.ok.map((entry) => {
    const hit = entry.endpoints.find((row) => normalizeEndpointId(row.id).toLowerCase() === targetId);
    if (!hit) {
      return { profile: entry.profile, displayName: entry.displayName, state: 'missing' as const };
    }
    if (endpointFingerprint(hit) === endpointFingerprint(baseline)) {
      return { profile: entry.profile, displayName: entry.displayName, state: 'same' as const };
    }
    const detail = normalizeBaseUrl(hit.baseUrl) !== normalizeBaseUrl(baseline.baseUrl) ? 'baseUrl' : 'model';
    return { profile: entry.profile, displayName: entry.displayName, state: 'drift' as const, detail };
  });
  for (const item of matrix.failed) {
    cells.push({ profile: item.profile, displayName: item.displayName, state: 'error', detail: item.message });
  }
  return cells;
}

/**
 * Bot 名称的显示宽度预算（单位：汉字 = 2，半角字符 = 1）。
 *
 * 【算术依据（不再靠注释各说一套）】
 *   字阶 `text-caption` = 11px。汉字宽约等于字号（11px 量级），半角字符约 6.2px。
 *   槽宽真值在 `ProfileAvatarStrip` 里是 56px：
 *     · 完整显示 4 个汉字 = 44px，余 12px；
 *     · 完整显示 8 个半角 = 49.6px，余 6.4px；
 *     · 截断路径为省略号预留 2 单位，剩 6 单位 + `…`(≈8px) ≤ 45px，均不溢出。
 *   旧口径是 48px 槽宽配 8 单位：8 个半角字符顶到 49.6px，会被 CSS 二次裁切，
 *   用户看到"省略号被吃掉"。所以修的是槽宽而不是压缩预算。
 */
export const PROFILE_LABEL_MAX_UNITS = 8;

/** CJK 字符按 2 个宽度单位计，其余按 1 个计。 */
function charUnits(char: string): number {
  return /[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 2 : 1;
}

function textUnits(text: string): number {
  let units = 0;
  for (const char of text) units += charUnits(char);
  return units;
}

/** 按预算裁切，返回宽度不超过 budget 的前缀。 */
function fitUnits(text: string, budget: number): string {
  let units = 0;
  let out = '';
  for (const char of text) {
    const cost = charUnits(char);
    if (units + cost > budget) break;
    units += cost;
    out += char;
  }
  return out;
}

/**
 * 按显示宽度截断 Bot 名称。
 * 【设计意图】头像条是固定槽宽，名字必须单行等宽可预测，不能靠 CSS 各写各的。
 * 【规则】11px 字号下 4 个汉字约 44px，正好落在 48px 槽宽内；超出预算时必须
 *   为省略号预留其自身宽度，即展示 3 个汉字 + `…`，绝不撑破槽宽。
 */
export function truncateProfileLabel(name: string, maxUnits = PROFILE_LABEL_MAX_UNITS): string {
  const text = name.trim();
  if (!text) return '';
  if (textUnits(text) <= maxUnits) return text;
  const ellipsisUnits = charUnits('…');
  return `${fitUnits(text, Math.max(0, maxUnits - ellipsisUnits)).trimEnd()}…`;
}

/** 订阅型提供商的登录方式。`unknown` 只用于网关新增了客户端不认识的 flow。 */
export type OauthFlow = 'device_code' | 'external' | 'pkce' | 'unknown';

/** 一个订阅型提供商（Nous Portal / Codex / Qwen / MiniMax / xAI）的登录态。 */
export interface OauthProviderRow {
  id: string;
  name: string;
  flow: OauthFlow;
  loggedIn: boolean;
  /** 网关能说出套餐名时才有（目前只有 Nous）。 */
  accountTier?: string;
  expiresAt?: string;
  lastRefresh?: string;
  /** 登录凭据来源，例如 `Nous Portal` 或 `/opt/data/auth.json`。 */
  sourceLabel?: string;
  /** Nous 专用：令牌属于免费层身份，与"已登录"不矛盾。 */
  freeTier: boolean;
  cliCommand?: string;
  docsUrl?: string;
  error?: string;
}

function normalizeFlow(value: unknown): OauthFlow {
  const text = asString(value);
  return text === 'device_code' || text === 'external' || text === 'pkce' ? text : 'unknown';
}

/**
 * 从 `GET /api/providers/oauth` 的原始响应构建订阅账号行。
 * 【规则】`logged_in` 与 `model.options` 的 `authenticated` 不是同一件事，
 *   前者是"有 OAuth 令牌"，后者是"能发请求"。二者不得互相推导。
 */
export function normalizeOauthProviders(payload: unknown): OauthProviderRow[] {
  const root = asRecord(payload);
  if (!root) return [];
  const raw = Array.isArray(root.providers) ? root.providers : [];
  const rows: OauthProviderRow[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row) continue;
    const id = asString(row.id);
    if (!id) continue;
    const status = asRecord(row.status) ?? {};
    rows.push({
      id,
      name: asString(row.name) || id,
      flow: normalizeFlow(row.flow),
      loggedIn: status.logged_in === true,
      accountTier: asString(status.account_tier) || undefined,
      expiresAt: asString(status.expires_at) || undefined,
      lastRefresh: asString(status.last_refresh) || undefined,
      sourceLabel: asString(status.source_label) || undefined,
      freeTier: status.free_tier === true,
      cliCommand: asString(row.cli_command) || undefined,
      docsUrl: asString(row.docs_url) || undefined,
      error: asString(status.error) || undefined,
    });
  }
  return rows;
}
