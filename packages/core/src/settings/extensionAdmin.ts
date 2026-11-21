/**
 * 扩展（MCP 服务器 / 技能市场）纯领域逻辑（零 DOM / 零 React / 零网络）。
 *
 * 【设计意图 (Why)】
 *   MCP 新增/测试与技能搜索/安装在「BOT 能力矩阵」与「设置 › 扩展」两处复用同一套交互。
 *   把目录归一化、命令参数分词、环境变量解析、HTTP URL 校验与契约参数构造收敛到 core，
 *   UI 与壳层只消费单一真值：既避免两处表单各写一套校验漂移，又能直接用纯单测四象限覆盖。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 在 UI 里直接拼接 `args.split(' ')` 会把带引号路径（如 `"/path with space"`）拆碎；
 *   2. 向 `mcp.servers.add` 多传未定义或 `null` 意外字段会触发网关严格模式 4000 拒绝；
 *   3. `skills.manage` 的 `browse` 返回 `items[]`、`search` 返回 `results[]`，两套形状如果
 *      在组件里各自判断，必然出现"搜得到但 browse 空白"。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯函数、零 React / 零 DOM / 零原生模块；
 *   2. 所有网关响应必须全量防御，畸形响应不得抛出或伪造数据；
 *   3. `validateAndBuildMcpAddParams` 产出的参数键严格落在 `McpServersAddParams` 契约白名单内。
 */

/** MCP 预设目录条目（归一化自 `mcp.catalog`）。 */
export interface McpCatalogItem {
  name: string;
  description: string;
  connectorSlug?: string;
  installed: boolean;
  enabled: boolean;
  requires: string[];
  transport: string;
}

export type McpTransportKind = 'stdio' | 'http';

/** 新增 MCP 服务器的受控表单草稿。 */
export interface McpServerAddDraft {
  mode: 'preset' | 'custom';
  name: string;
  preset: string;
  transport: McpTransportKind;
  command: string;
  argsText: string;
  envText: string;
  url: string;
  bearerToken: string;
}

/** 严格对齐契约 `McpServersAddParams` 的 RPC 入参。 */
export interface McpServerAddRpcParams {
  profile?: string;
  name: string;
  preset?: string;
  config?: Record<string, unknown>;
  bearer_token?: string;
}

export type McpAddValidationErrorReason =
  | 'nameRequired'
  | 'nameInvalid'
  | 'presetRequired'
  | 'commandRequired'
  | 'urlRequired'
  | 'urlInvalid'
  | 'envInvalid';

export type McpAddValidationResult =
  | { ok: true; params: McpServerAddRpcParams }
  | { ok: false; reason: McpAddValidationErrorReason; invalidLine?: string };

/** `mcp.servers.test` 的归一化探活结果。 */
export interface McpTestResultView {
  ok: boolean;
  tools: Array<{ name: string; description: string }>;
  error?: string;
  prompts?: number;
  resources?: number;
  oauthNeeded: boolean;
}

/** `skills.manage`（browse / search）的归一化结果行。 */
export interface SkillHubSearchRow {
  name: string;
  description: string;
  source?: string;
  trust?: string;
  identifier?: string;
  installed: boolean;
}

export interface SkillHubSearchResult {
  rows: SkillHubSearchRow[];
  page: number;
  totalPages: number;
  total: number;
}

/** 技能详情查看视图（融合 `skills.manage { action: 'inspect' }` 与 `command.dispatch`）。 */
export interface SkillInspectView {
  name: string;
  description?: string;
  source?: string;
  identifier?: string;
  category?: string;
  tags: string[];
  markdown: string;
  isPreview: boolean;
}

const MCP_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 从 `mcp.catalog` 原始响应归一化可安装预设目录。 */
export function normalizeMcpCatalog(payload: unknown): McpCatalogItem[] {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root.servers)) return [];

  const items: McpCatalogItem[] = [];
  const seen = new Set<string>();
  for (const raw of root.servers) {
    const row = asRecord(raw);
    if (!row) continue;
    const name = asTrimmedString(row.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const requires = Array.isArray(row.requires)
      ? row.requires.map((item) => asTrimmedString(item)).filter(Boolean)
      : [];

    items.push({
      name,
      description: asTrimmedString(row.description),
      connectorSlug: asTrimmedString(row.connector_slug) || undefined,
      installed: row.installed === true,
      enabled: row.enabled === true,
      requires,
      transport: asTrimmedString(row.transport) || 'stdio',
    });
  }
  return items;
}

/**
 * 切分命令行参数文本（支持单双引号包裹含空格参数与反斜杠转义）。
 * 【规则】空输入返回空数组；未闭合引号不抛错，安全收敛至行尾。
 */
export function parseMcpArgsText(argsText: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < argsText.length; i += 1) {
    const ch = argsText[i];
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      } else if (ch === '\\' && quote === '"' && i + 1 < argsText.length) {
        i += 1;
        current += argsText[i];
      } else {
        current += ch;
      }
      continue;
    }

    if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      inToken = true;
      continue;
    }

    if (ch === '\\' && i + 1 < argsText.length) {
      i += 1;
      current += argsText[i];
      inToken = true;
      continue;
    }

    current += ch;
    inToken = true;
  }

  if (inToken) tokens.push(current);
  return tokens;
}

/**
 * 逐行解析环境变量（`KEY=VALUE`），跳过空行与 `#` 注释。
 * 【规则】遇到缺少 `=` 或变量名非法的行，立即返回首个非法行以供界面精确定位报错。
 */
export function parseMcpEnvLines(
  envText: string,
): { ok: true; env: Record<string, string> } | { ok: false; invalidLine: string } {
  const env: Record<string, string> = {};
  const lines = envText.split(/\r?\n/);

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) return { ok: false, invalidLine: trimmed };

    const key = trimmed.slice(0, eqIndex).trim();
    if (!ENV_KEY_PATTERN.test(key)) return { ok: false, invalidLine: trimmed };

    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return { ok: true, env };
}

function isValidHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0;
  // gate-degrade: new URL() 在非法输入时抛出 TypeError，校验函数将其降级为 false 以返回结构化 urlInvalid 错误
  } catch {
    return false;
  }
}

/**
 * 校验并构造 `mcp.servers.add` 契约请求体。
 * 【规则】只写出必要字段，不向契约对象塞入 undefined 之外的多余键。
 */
export function validateAndBuildMcpAddParams(
  draft: McpServerAddDraft,
  profile?: string,
): McpAddValidationResult {
  const name = draft.name.trim();
  if (!name) return { ok: false, reason: 'nameRequired' };
  if (!MCP_NAME_PATTERN.test(name)) return { ok: false, reason: 'nameInvalid' };

  const normalizedProfile = typeof profile === 'string' && profile.trim() ? profile.trim() : undefined;
  const bearerToken = draft.bearerToken.trim();

  if (draft.mode === 'preset') {
    const preset = draft.preset.trim();
    if (!preset) return { ok: false, reason: 'presetRequired' };
    const params: McpServerAddRpcParams = {
      name,
      preset,
      ...(normalizedProfile ? { profile: normalizedProfile } : {}),
      ...(bearerToken ? { bearer_token: bearerToken } : {}),
    };
    return { ok: true, params };
  }

  if (draft.transport === 'stdio') {
    const command = draft.command.trim();
    if (!command) return { ok: false, reason: 'commandRequired' };
    const parsedEnv = parseMcpEnvLines(draft.envText);
    if (!parsedEnv.ok) return { ok: false, reason: 'envInvalid', invalidLine: parsedEnv.invalidLine };

    const args = parseMcpArgsText(draft.argsText);
    const config: Record<string, unknown> = { command };
    if (args.length > 0) config.args = args;
    if (Object.keys(parsedEnv.env).length > 0) config.env = parsedEnv.env;

    return {
      ok: true,
      params: {
        name,
        config,
        ...(normalizedProfile ? { profile: normalizedProfile } : {}),
      },
    };
  }

  const url = draft.url.trim();
  if (!url) return { ok: false, reason: 'urlRequired' };
  if (!isValidHttpUrl(url)) return { ok: false, reason: 'urlInvalid' };

  return {
    ok: true,
    params: {
      name,
      config: { url, transport: 'http' },
      ...(normalizedProfile ? { profile: normalizedProfile } : {}),
      ...(bearerToken ? { bearer_token: bearerToken } : {}),
    },
  };
}

/** 归一化 `mcp.servers.test` 的探测响应。 */
export function normalizeMcpTestResult(payload: unknown): McpTestResultView {
  const root = asRecord(payload);
  if (!root) return { ok: false, tools: [], oauthNeeded: false };

  const tools: Array<{ name: string; description: string }> = [];
  if (Array.isArray(root.tools)) {
    for (const raw of root.tools) {
      const row = asRecord(raw);
      if (!row) continue;
      const name = asTrimmedString(row.name);
      if (!name) continue;
      tools.push({ name, description: asTrimmedString(row.description) });
    }
  }

  const prompts = typeof root.prompts === 'number' && Number.isFinite(root.prompts) ? root.prompts : undefined;
  const resources = typeof root.resources === 'number' && Number.isFinite(root.resources) ? root.resources : undefined;
  const error = asTrimmedString(root.error) || undefined;

  return {
    ok: root.ok === true,
    tools,
    error,
    prompts,
    resources,
    oauthNeeded: root.oauth_needed === true,
  };
}

/**
 * 归一化 `skills.manage` 的 `search`（`results[]`）与 `browse`（`items[]`）响应。
 * 【设计意图】两条路径都标注本地已知 `installedNames` 交集，避免已安装技能还能被重复点安装。
 */
export function normalizeSkillSearchResults(
  payload: unknown,
  installedNames: ReadonlySet<string> = new Set(),
): SkillHubSearchResult {
  const root = asRecord(payload);
  if (!root) return { rows: [], page: 1, totalPages: 1, total: 0 };

  const rawList = Array.isArray(root.items)
    ? root.items
    : Array.isArray(root.results)
      ? root.results
      : [];

  const rows: SkillHubSearchRow[] = [];
  const seen = new Set<string>();
  for (const raw of rawList) {
    const row = asRecord(raw);
    if (!row) continue;
    const name = asTrimmedString(row.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const identifier = asTrimmedString(row.identifier) || undefined;
    const isInstalled =
      row.installed === true ||
      installedNames.has(name) ||
      (identifier !== undefined && installedNames.has(identifier));

    rows.push({
      name,
      description: asTrimmedString(row.description),
      source: asTrimmedString(row.source) || undefined,
      trust: asTrimmedString(row.trust) || undefined,
      identifier,
      installed: isInstalled,
    });
  }

  const page = typeof root.page === 'number' && root.page >= 1 ? Math.floor(root.page) : 1;
  const totalPages = typeof root.total_pages === 'number' && root.total_pages >= 1 ? Math.floor(root.total_pages) : 1;
  const total = typeof root.total === 'number' && root.total >= 0 ? Math.floor(root.total) : rows.length;

  return { rows, page, totalPages, total };
}

/**
 * 拆解 `SKILL.md` 顶部的 YAML frontmatter 与 Markdown 正文。
 *
 * 【设计意图 (Why)】
 *   「原始源码」需要原封不动展示含 frontmatter 的全文；而「优雅预览」直接把
 *   YAML frontmatter 丢给 Markdown 解析器会把 `---` 渲染成分割线与裸键值对。
 *   拆离顶层 `key: value` 元数据供信息条独立排版，正文则保持干净的 Markdown 层次。
 * 【规则】仅当首段以 `---` 成对闭合且含合法 `key: value` 键时才视作 frontmatter，
 *   否则完整保留在 `body` 中，绝不误伤普通 Markdown 分割线。
 */
export function splitSkillMarkdownFrontmatter(markdown: string): {
  frontmatter: Array<{ key: string; value: string }>;
  body: string;
} {
  if (!markdown) return { frontmatter: [], body: '' };
  const match = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/.exec(markdown);
  if (!match) return { frontmatter: [], body: markdown };

  const block = match[1];
  const rest = (match[2] ?? '').replace(/^\r?\n+/, '');
  const frontmatter: Array<{ key: string; value: string }> = [];

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].trim();
    let value = kv[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (key && value) frontmatter.push({ key, value });
  }

  if (frontmatter.length === 0) {
    return { frontmatter: [], body: markdown };
  }
  return { frontmatter, body: rest };
}

/**
 * 归一化单个技能的详情响应（融合 `skills.manage { action: 'inspect' }` 与 `command.dispatch`）。
 *
 * 【设计意图 (Why)】
 *   Hub 技能 inspect 返回 `info.skill_md_preview`（部分版本带全文或截断预览），
 *   而本地已安装技能可通过 `command.dispatch` 拿到完整 `SKILL.md` 正文。
 *   统一收敛后 UI 无需关心网关版本差异，优先给出完整全文、次选完整预览、末尾优雅降级。
 */
export function normalizeSkillInspectResult(
  skillName: string,
  sources: {
    inspectPayload?: unknown;
    dispatchPayload?: unknown;
    fallbackDescription?: string;
  } = {},
): SkillInspectView {
  const inspectRoot = asRecord(sources.inspectPayload);
  const info = (inspectRoot && asRecord(inspectRoot.info)) ?? inspectRoot;
  const dispatch = asRecord(sources.dispatchPayload);

  const fullInfoMd = info
    ? asTrimmedString(info.skill_md) ||
      asTrimmedString(info.content) ||
      asTrimmedString(info.markdown) ||
      asTrimmedString(info.body)
    : '';
  const previewMd = info ? asTrimmedString(info.skill_md_preview) : '';
  const dispatchType = dispatch ? asTrimmedString(dispatch.type) : '';
  const dispatchMd =
    dispatch && (!dispatchType || dispatchType === 'skill')
      ? asTrimmedString(dispatch.message)
      : '';

  let markdown = '';
  let isPreview = false;
  if (fullInfoMd) {
    markdown = fullInfoMd;
  } else if (dispatchMd && (!previewMd || dispatchMd.length >= previewMd.length)) {
    markdown = dispatchMd;
  } else if (previewMd) {
    markdown = previewMd;
    isPreview = true;
  }

  const tags: string[] = [];
  if (info && Array.isArray(info.tags)) {
    const seenTags = new Set<string>();
    for (const rawTag of info.tags) {
      const tag = asTrimmedString(rawTag);
      if (!tag || seenTags.has(tag)) continue;
      seenTags.add(tag);
      tags.push(tag);
    }
  }

  const parsedFrontmatter = splitSkillMarkdownFrontmatter(markdown);
  const frontmatterDesc = parsedFrontmatter.frontmatter.find(
    (entry) => entry.key.toLowerCase() === 'description',
  )?.value;

  const description =
    (info ? asTrimmedString(info.description) : '') ||
    frontmatterDesc ||
    asTrimmedString(sources.fallbackDescription) ||
    undefined;

  return {
    name: (info ? asTrimmedString(info.name) : '') || (dispatch ? asTrimmedString(dispatch.name) : '') || skillName.trim(),
    description,
    source: (info ? asTrimmedString(info.source) : '') || undefined,
    identifier: (info ? asTrimmedString(info.identifier) : '') || undefined,
    category: (info ? asTrimmedString(info.category) : '') || undefined,
    tags,
    markdown,
    isPreview,
  };
}
