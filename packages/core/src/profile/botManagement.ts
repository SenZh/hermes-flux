/**
 * BOT 配置中枢的纯领域模型（零 DOM / 零 React / 零网络）。
 *
 * 【设计意图 (Why)】
 *   BOT 面板同时承载"花名册滑动、单 Bot 详情、全量草稿、能力矩阵、新建向导"五件事。
 *   把这五件事的共享数据形状与判定收敛到 core，UI 与壳层只消费同一份真值：
 *   - 草稿是否脏、保存要提交哪些字段、哪些能力清单可信，全部由纯函数决定；
 *   - 网关的 snake_case 响应只在这里解析一次，避免 UI 与控制器各写一份归一化。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 旧编辑器把 `profiles.describe` 的 toolsets 压成 string[]，丢失 enabled/label，
 *      导致界面无法表达"哪些工具集被关掉"，保存时只能写空数组把用户配置清空。
 *   2. 草稿若只存在组件内，设置弹窗一关 React 树卸载，未保存修改全部蒸发。
 *      本文件把草稿定义成可序列化的完整快照，壳层可以跨挂载持有。
 *   3. `confirm_host_exit` 若把 `pendingAction` 函数塞进快照，renderer 的
 *      `JSON.stringify(snapshot)` 指纹会丢字段，确认弹窗状态与真实待执行动作脱节。
 *      这里的状态机只保留纯数据，待执行动作由壳层闭包持有。
 *
 * 【约束与规则 (Rules)】
 *   1. 所有导出必须是纯函数或纯类型，禁止引入 React / DOM / 网络；
 *   2. 草稿与详情都能安全 JSON 序列化（快照会做指纹比较与缓存）；
 *   3. "不知道"与"没有"必须可区分：能力清单用 `authoritative` 表达网关是否真的返回了该清单，
 *      非权威清单绝不允许参与保存，防止把读取缺口写成空配置；
 *   4. 只提交与权威快照不同的字段，避免全量覆盖把用户未看到的配置改掉。
 */

import type {
  ProfilesConfigureApplied,
  ProfilesConfigureParams,
  ProfilesConfigureResult,
} from '../rpc/types.js';

/** BOT 面板主状态（判别联合；纯数据，可进入渲染快照）。 */
export type BotManagementStatus =
  | { status: 'uninitialized' }
  | { status: 'fetching_list' }
  | { status: 'list_error'; message: string }
  | { status: 'empty_list' }
  | { status: 'idle'; activeBotId: string }
  | { status: 'loading_detail'; activeBotId: string }
  | { status: 'detail_error'; activeBotId: string; message: string }
  | { status: 'editing'; activeBotId: string }
  | { status: 'saving'; activeBotId: string };

/** 一行能力条目。`online` 只对 MCP 有意义；`undefined` 表示探活没有给出结论。 */
export interface BotCapabilityRow {
  id: string;
  label: string;
  enabled: boolean;
  description?: string;
  toolCount?: number;
  transport?: string;
  online?: boolean;
}

/**
 * 一类能力清单。
 *
 * 【规则】`authoritative` 为 false 时，`rows` 只能用于展示（例如全局技能目录补全），
 *   保存时必须省略对应字段；把它当权威写回会用"读取缺口"覆盖用户真实配置。
 */
export interface BotCapabilityList {
  authoritative: boolean;
  rows: BotCapabilityRow[];
}

/** 单个 BOT 的权威详情（来自 profiles.describe + 花名册身份字段）。 */
export interface BotDetailData {
  id: string;
  displayName: string;
  description: string;
  model: string;
  provider: string;
  soul: string;
  avatar?: string;
  isDefault: boolean;
  skills: BotCapabilityList;
  toolsets: BotCapabilityList;
  mcpServers: BotCapabilityList;
}

/** 头像草稿：三态判别联合，杜绝"既替换又清除"的非法组合。 */
export type BotAvatarDraft =
  | { kind: 'unchanged' }
  | { kind: 'replace'; dataUrl: string }
  | { kind: 'clear' };

/** 单个 BOT 的完整可编辑快照（跨挂载存活，可 JSON 序列化）。 */
export interface BotDraftState {
  displayName: string;
  description: string;
  model: string;
  provider: string;
  isDefault: boolean;
  soul: string;
  avatar: BotAvatarDraft;
  disabledSkills: string[];
  enabledToolsets: string[];
  enabledMcpServers: string[];
}

/** profiles.describe 解析时需要的身份字段（describe 本身不返回 title / is_default）。 */
export interface BotIdentityHint {
  id: string;
  displayName: string;
  avatar?: string;
  isDefault: boolean;
}

/** BOT ID 校验结果。 */
export type BotIdValidation =
  | { ok: true }
  | { ok: false; reason: 'format' | 'conflict' };

/** 需求 F-04 的 ID 口径：1~64 位英文字母、数字、下划线、短横线。 */
export const BOT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 去掉能力标签开头的装饰性 emoji。
 * 【为什么】网关的工具集 label 形如 `🔍 Web Search & Scraping`；设计系统要求图标一律用
 *   lucide 描边 SVG，正文中混入 emoji 会破坏排版基线，也让图标守卫误判。
 */
function stripLeadingEmoji(text: string): string {
  const stripped = text
    .replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\u{1F3FB}-\u{1F3FF}\u20E3\s]+/u, '')
    .trim();
  return stripped || text.trim();
}

/** 一行工具数：网关不同版本分别用 `tool_count`（describe）与 `tools`（mcp.servers.status）。 */
function readToolCount(record: Record<string, unknown>): number | undefined {
  if (typeof record.tool_count === 'number') return record.tool_count;
  if (typeof record.tools === 'number') return record.tools;
  return undefined;
}

/**
 * 解析一类能力清单。
 * 【规则】只有数组才算权威；字段缺失或形状畸形一律降级为非权威，绝不伪造空清单。
 */
function parseCapabilityList(raw: unknown): BotCapabilityList {
  if (!Array.isArray(raw)) return { authoritative: false, rows: [] };
  const rows: BotCapabilityRow[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    if (!record) continue;
    const id = asString(record.name);
    if (!id) continue;
    const toolCount = readToolCount(record);
    rows.push({
      id,
      label: stripLeadingEmoji(asString(record.label) || id),
      // 缺省视为开启：网关只回传"被关闭"的条目时，不能把其余条目误判为关闭。
      enabled: record.enabled !== false,
      description: asString(record.description) || undefined,
      toolCount,
      transport: asString(record.transport) || undefined,
    });
  }
  return { authoritative: true, rows };
}

/** 解析 model 字段：真实契约是 `{ provider?, default? }`，兼容早期网关的裸字符串。 */
function parseModelPin(raw: unknown): { model: string; provider: string } {
  if (typeof raw === 'string') return { model: raw, provider: '' };
  const record = asRecord(raw);
  if (!record) return { model: '', provider: '' };
  return {
    model: asString(record.default) || asString(record.model),
    provider: asString(record.provider),
  };
}

/**
 * 把 `profiles.describe` 响应解析为权威详情。
 *
 * 【兼容】新网关扁平返回 `{ name, description, soul, model, skills, toolsets, mcp_servers }`；
 *   旧路径可能包一层 `profile`。两者都接受，但只保留一套输出形状。
 */
export function parseBotDetail(payload: unknown, hint: BotIdentityHint): BotDetailData {
  const root = asRecord(payload);
  const profileRecord = root ? asRecord(root.profile) : null;
  const source = profileRecord ?? root ?? {};
  const modelPin = parseModelPin(source.model);
  const name = asString(source.name) || hint.id;
  return {
    id: hint.id || name,
    displayName: hint.displayName || name,
    description: asString(source.description),
    model: modelPin.model,
    provider: modelPin.provider,
    soul: asString(source.soul) || asString(source.systemPrompt) || asString(source.soulContent),
    avatar: hint.avatar,
    isDefault: hint.isDefault,
    skills: parseCapabilityList(source.skills),
    toolsets: parseCapabilityList(source.toolsets),
    mcpServers: parseCapabilityList(source.mcp_servers ?? source.mcpServers),
  };
}

/** 从权威详情生成初始草稿。 */
export function draftFromDetail(detail: BotDetailData): BotDraftState {
  return {
    displayName: detail.displayName,
    description: detail.description,
    model: detail.model,
    provider: detail.provider,
    isDefault: detail.isDefault,
    soul: detail.soul,
    avatar: { kind: 'unchanged' },
    disabledSkills: detail.skills.rows.filter((row) => !row.enabled).map((row) => row.id),
    enabledToolsets: detail.toolsets.rows.filter((row) => row.enabled).map((row) => row.id),
    enabledMcpServers: detail.mcpServers.rows.filter((row) => row.enabled).map((row) => row.id),
  };
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const set = new Set(left);
  return right.every((item) => set.has(item));
}

/**
 * 草稿是否仍然有未保存修改。
 * 【规则】头像只看判别联合的 kind；数组按集合比较，顺序不构成修改。
 */
export function isBotDraftDirty(detail: BotDetailData, draft: BotDraftState): boolean {
  const initial = draftFromDetail(detail);
  return (
    initial.displayName !== draft.displayName ||
    initial.description !== draft.description ||
    initial.model !== draft.model ||
    initial.provider !== draft.provider ||
    initial.isDefault !== draft.isDefault ||
    initial.soul !== draft.soul ||
    draft.avatar.kind !== 'unchanged' ||
    !sameStringSet(initial.disabledSkills, draft.disabledSkills) ||
    !sameStringSet(initial.enabledToolsets, draft.enabledToolsets) ||
    !sameStringSet(initial.enabledMcpServers, draft.enabledMcpServers)
  );
}

/** 合并 `ui_meta`，只触碰 `hermes-bots` 子键，绝不覆盖群聊房间等其它元数据。 */
export function mergeBotUiMeta(
  existing: Record<string, unknown> | undefined,
  patch: { title?: string; isDefault?: boolean },
): Record<string, unknown> {
  const base = existing ? { ...existing } : {};
  const bots = asRecord(base['hermes-bots']) ?? {};
  const nextBots: Record<string, unknown> = { ...bots };
  if (patch.title !== undefined) nextBots.title = patch.title;
  if (patch.isDefault !== undefined) nextBots.is_default = patch.isDefault;
  base['hermes-bots'] = nextBots;
  return base;
}

/**
 * 生成保存参数：只包含与权威详情不同的字段。
 *
 * 【规则】能力矩阵只有在 `authoritative` 时才能写；非权威清单省略对应字段，
 *   让网关保留原值，而不是被本地的"读取缺口"覆盖。
 */
export function buildBotConfigureParams(
  detail: BotDetailData,
  draft: BotDraftState,
  existingUiMeta?: Record<string, unknown>,
  options?: { confirmExpensive?: boolean },
): ProfilesConfigureParams | null {
  const params: ProfilesConfigureParams = { name: detail.id };
  let hasField = false;

  if (draft.description !== detail.description) {
    params.description = draft.description;
    hasField = true;
  }
  if (draft.soul !== detail.soul) {
    params.soul = draft.soul;
    hasField = true;
  }
  if (draft.model !== detail.model || draft.provider !== detail.provider) {
    params.model = draft.model;
    if (draft.provider) params.provider = draft.provider;
    hasField = true;
  }

  const initial = draftFromDetail(detail);
  if (detail.skills.authoritative && !sameStringSet(initial.disabledSkills, draft.disabledSkills)) {
    params.disabled_skills = [...draft.disabledSkills];
    hasField = true;
  }
  if (detail.toolsets.authoritative && !sameStringSet(initial.enabledToolsets, draft.enabledToolsets)) {
    params.enabled_toolsets = [...draft.enabledToolsets];
    hasField = true;
  }
  if (detail.mcpServers.authoritative && !sameStringSet(initial.enabledMcpServers, draft.enabledMcpServers)) {
    params.enabled_mcp_servers = [...draft.enabledMcpServers];
    hasField = true;
  }

  const uiMetaPatch: { title?: string; isDefault?: boolean } = {};
  if (draft.displayName !== detail.displayName) uiMetaPatch.title = draft.displayName;
  if (draft.isDefault !== detail.isDefault) uiMetaPatch.isDefault = draft.isDefault;
  if (uiMetaPatch.title !== undefined || uiMetaPatch.isDefault !== undefined) {
    params.ui_meta = mergeBotUiMeta(existingUiMeta, uiMetaPatch);
    hasField = true;
  }

  // 仅当用户在确认横幅上明确选择"仍然保存"时才带上旗标；
  // 普通保存绝不默认绕过网关的高价模型守卫。
  if (hasField && options?.confirmExpensive) params.confirm_expensive_model = true;

  return hasField ? params : null;
}

/** 保存成功后的本地详情投影：避免"保存后必须等一次远程回读才不脏"。 */
export function applyDraftToDetail(detail: BotDetailData, draft: BotDraftState): BotDetailData {
  const updateRows = (rows: BotCapabilityRow[], enabledIds: string[]): BotCapabilityRow[] => {
    const enabled = new Set(enabledIds);
    return rows.map((row) => ({ ...row, enabled: enabled.has(row.id) }));
  };
  return {
    ...detail,
    displayName: draft.displayName,
    description: draft.description,
    model: draft.model,
    provider: draft.provider,
    isDefault: draft.isDefault,
    soul: draft.soul,
    avatar:
      draft.avatar.kind === 'replace'
        ? draft.avatar.dataUrl
        : draft.avatar.kind === 'clear'
          ? undefined
          : detail.avatar,
    skills: detail.skills.authoritative
      ? {
          authoritative: true,
          rows: detail.skills.rows.map((row) => ({
            ...row,
            enabled: !draft.disabledSkills.includes(row.id),
          })),
        }
      : detail.skills,
    toolsets: detail.toolsets.authoritative
      ? { authoritative: true, rows: updateRows(detail.toolsets.rows, draft.enabledToolsets) }
      : detail.toolsets,
    mcpServers: detail.mcpServers.authoritative
      ? { authoritative: true, rows: updateRows(detail.mcpServers.rows, draft.enabledMcpServers) }
      : detail.mcpServers,
  };
}

/**
 * 用全局技能目录补全能力清单。
 * 【规则】describe 已给出权威清单时不做任何合并：全局目录可能包含该 Bot 不可见的技能，
 *   补进去会让用户以为自己关掉的技能仍然存在。
 */
export function mergeSkillInventory(skills: BotCapabilityList, names: readonly string[]): BotCapabilityList {
  if (skills.authoritative) return skills;
  const seen = new Set(skills.rows.map((row) => row.id));
  const extra = names
    .filter((name) => name && !seen.has(name))
    .map((name): BotCapabilityRow => ({ id: name, label: name, enabled: true }));
  return { authoritative: false, rows: [...skills.rows, ...extra] };
}

/**
 * 合并 MCP 探活状态。
 * 【规则】探活失败（`statusRows` 为 null）时保留原清单，`online` 保持 undefined，
 *   界面据此显示"状态未知"，绝不允许把失败画成红灯。
 */
export function mergeMcpStatus(
  servers: BotCapabilityList,
  statusRows: ReadonlyArray<{
    name: string;
    connected: boolean;
    transport?: string;
    toolCount?: number;
    tools?: number;
  }> | null,
): BotCapabilityList {
  if (!statusRows) return servers;
  if (!servers.authoritative) {
    return {
      authoritative: false,
      rows: statusRows.map((row) => ({
        id: row.name,
        label: row.name,
        enabled: true,
        transport: row.transport,
        toolCount: row.toolCount ?? row.tools,
        online: row.connected,
      })),
    };
  }
  const byName = new Map(statusRows.map((row) => [row.name, row]));
  return {
    authoritative: true,
    rows: servers.rows.map((row) => {
      const status = byName.get(row.id);
      return status
        ? {
            ...row,
            online: status.connected,
            transport: row.transport || status.transport,
            toolCount: status.toolCount ?? status.tools ?? row.toolCount,
          }
        : row;
    }),
  };
}

/** BOT ID 校验：格式优先，其次重名。 */
export function validateBotId(id: string, existingIds: readonly string[]): BotIdValidation {
  const trimmed = id.trim();
  if (!BOT_ID_PATTERN.test(trimmed)) return { ok: false, reason: 'format' };
  if (existingIds.some((existing) => existing === trimmed)) return { ok: false, reason: 'conflict' };
  return { ok: true };
}

/**
 * `profiles.configure` 的请求段（网关 applied 的键名，不是入参名）。
 * 【为什么单独定义】入参是 `disabled_skills`，网关回的是 `applied.skills`；
 *   直接用入参名对账会把"已写入"误判成"没写入"。
 */
export type BotConfigureSegment =
  | 'description'
  | 'soul'
  | 'model'
  | 'skills'
  | 'toolsets'
  | 'mcp_servers'
  | 'ui_meta';

/** 保存结论：成功 / 网关要求二次确认 / 整体失败 / 部分段未写入。 */
export type BotConfigureOutcome =
  | { ok: true }
  | { ok: false; kind: 'confirm'; message: string }
  | { ok: false; kind: 'failed'; message: string }
  | { ok: false; kind: 'partial'; missing: BotConfigureSegment[]; message: string };

/** 请求里带了哪些段。`ok:true` 只代表请求被接受，必须逐段核对 applied。 */
export function requestedConfigureSegments(
  params: ProfilesConfigureParams,
): BotConfigureSegment[] {
  const segments: BotConfigureSegment[] = [];
  if (params.description !== undefined) segments.push('description');
  if (params.soul !== undefined) segments.push('soul');
  if (params.model !== undefined || params.provider !== undefined) segments.push('model');
  if (params.disabled_skills !== undefined) segments.push('skills');
  if (params.enabled_toolsets !== undefined) segments.push('toolsets');
  if (params.enabled_mcp_servers !== undefined) segments.push('mcp_servers');
  if (params.ui_meta !== undefined) segments.push('ui_meta');
  return segments;
}

function appliedSegmentsOf(
  applied: ProfilesConfigureApplied | string[] | undefined,
): Set<string> | null {
  if (!applied) return null;
  if (Array.isArray(applied)) {
    // 早期网关回字符串数组，键名可能仍是入参名（disabled_skills），统一折算成段名。
    const alias: Record<string, BotConfigureSegment> = {
      disabled_skills: 'skills',
      enabled_toolsets: 'toolsets',
      enabled_mcp_servers: 'mcp_servers',
    };
    return new Set(applied.map((name) => alias[name] ?? name));
  }
  const set = new Set<string>();
  for (const [key, value] of Object.entries(applied)) {
    if (value === true) set.add(key);
  }
  return set;
}

/**
 * 判定一次 `profiles.configure` 是否真的写入。
 *
 * 【设计意图 (Why)】
 *   实测网关（0.23.1）会返回 `ok:true` 但只写入了部分段；也会在守卫模型上返回
 *   `confirm_required` 且一个字段都没写。只看 `ok` 会让界面把"没保存"画成"已保存"，
 *   用户关掉设置后修改凭空消失。
 *
 * 【规则】
 *   1. `confirm_required` 优先：网关没有写入，必须保留草稿并给出明确出路；
 *   2. `ok !== true` 一律失败——实测 `ui_meta:{}` 会回 `ok:false` 且 applied 仍为 true，
 *      applied 不能覆盖 ok；
 *   3. `ok:true` 时逐段核对，缺段返回 `partial`，绝不猜"应该写成功了吧"；
 *   4. `applied` 缺失视为协议不完整，显式失败（Failure Is Not Empty）。
 */
export function evaluateBotConfigureOutcome(
  params: ProfilesConfigureParams,
  result: ProfilesConfigureResult | null | undefined,
): BotConfigureOutcome {
  if (!result) {
    return { ok: false, kind: 'failed', message: '' };
  }
  if (result.confirm_required === true) {
    return { ok: false, kind: 'confirm', message: result.confirm_message || '' };
  }
  if (result.ok !== true) {
    return { ok: false, kind: 'failed', message: result.confirm_message || '' };
  }

  const requested = requestedConfigureSegments(params);
  const applied = appliedSegmentsOf(result.applied);
  if (!applied) {
    return { ok: false, kind: 'failed', message: '' };
  }
  const missing = requested.filter((segment) => !applied.has(segment));
  if (missing.length > 0) {
    return { ok: false, kind: 'partial', missing, message: '' };
  }
  return { ok: true };
}

/** 新建向导的提交结果：失败必须带原因，成功带新建 ID。 */
export type BotCreateOutcome = { ok: true; id: string } | { ok: false; message: string };

/**
 * 花名册投影的一行（与 UI 的 `BotRosterEntry` 结构同构）。
 *
 * 【为什么在 core 算】`hasDraft` 是"这个 BOT 有没有未保存修改"的唯一判据，
 *   由草稿池现算。它曾直接写在 renderer 的渲染函数里，只能靠读代码确认，
 *   无法用测试证伪（快照测试全是手填常量，等于自证）。抽成纯函数后可以真实验证。
 */
export interface BotRosterProjection {
  id: string;
  displayName: string;
  model: string;
  avatar?: string;
  isDefault: boolean;
  hasDraft: boolean;
}

/** 花名册投影的输入行（来自 `profiles.list` 归一化结果）。 */
export interface BotRosterSourceRow {
  name: string;
  displayName?: string;
  model?: string;
  avatar?: string;
  isDefault?: boolean;
}

/**
 * 把档案行与草稿池投影成花名册。
 *
 * 【规则】
 *   1. `hasDraft` 只认草稿池里是否真的存在该 key —— 空字符串字段也是合法草稿值，
 *      不能用"字段是否非空"猜测；
 *   2. 缺显示名时回落 profile 名，缺模型时给空串（不编造模型）；
 *   3. 顺序与输入一致，不做排序：滑动选择器的位置必须在刷新前后保持稳定。
 */
export function projectBotRoster(
  rows: readonly BotRosterSourceRow[],
  drafts: Readonly<Record<string, BotDraftState>>,
): BotRosterProjection[] {
  return rows.map((row) => ({
    id: row.name,
    displayName: row.displayName || row.name,
    model: row.model || '',
    avatar: row.avatar || undefined,
    isDefault: row.isDefault === true,
    hasDraft: Object.prototype.hasOwnProperty.call(drafts, row.name),
  }));
}
