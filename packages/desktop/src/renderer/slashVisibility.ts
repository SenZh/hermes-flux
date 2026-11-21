/**
 * 斜杠命令的桌面端可见性过滤（纯逻辑）。
 *
 * 【设计意图 (Why)】
 *   网关的 `commands.catalog.commands[name].desktop` 是**分级标记**，不是文案：
 *   实测取值 `hidden` / `terminal` / `advanced` / `composer-voice` / `settings` / `null`。
 *   客户端历史上把它当描述兜底（`meta?.desktop || ''`），于是 `hidden`、`terminal`
 *   这些标记被当成说明文字，同时真正的分级信息被丢掉 —— 结果 TUI 专属命令全部涌进
 *   GUI 弹框，用户看到 `/redraw`、`/mouse`、`/quit` 这类在桌面端无意义的条目。
 *
 * 【约束与规则 (Rules)】
 *   1. 只做展示过滤，**绝不拦截执行**：补全里隐藏的命令，手输仍然可用；
 *   2. 别名折叠按网关 `canon` 数据驱动，不写死名单；
 *   3. 过滤后为空必须与「请求失败」区分，否则调用方会回退到未过滤快照，隐藏静默失效。
 */

/** 网关 `desktop` 字段中，桌面端不应出现在补全列表的取值。 */
const HIDDEN_DESKTOP_MARKS = new Set(['hidden', 'terminal']);

/**
 * 桌面端不适用的 TUI 专属/冗余命令黑名单。
 *
 * 【设计意图 (Why)】
 *   网关的历史实现中，部分纯终端 TUI 命令未被标记为 desktop='terminal' 或 'hidden'（留空为 none），
 *   例如 /mouse、/density、/palette、/skin、/battery、/logs 等。
 *   同时，如 /model（有底部选择器）、/yolo /approvals（有审批下拉）、/reasoning（有思考下拉）
 *   在桌面端已有更精准直观的 GUI 控件承载，出现在斜杠菜单中会造成严重的心智干扰与样式冗余。
 *
 * 【防范的历史坑 (Pitfall)】
 *   若仅依赖网关 desktop 标记，上述 30+ 个终端命令将全部漏进桌面端补全菜单，造成极差的桌面用户体验。
 *
 * 【约束与规则 (Rules)】
 *   - 纯函数，零副作用；
 *   - 规范化命令名（去斜杠、小写）进行查表；
 *   - 仅屏蔽 TUI 专属控制命令，绝不误伤 85+ 个实际生产力 Skill 与核心工作流命令（/compress, /plan, /goal 等）。
 */
/**
 * 专职 Bot 终身主工位（hidden=1，Bot Forever Chat）专属排除命令黑名单。
 *
 * 【设计意图 (Why)】
 *   根据 docs/architecture/three-conversation-modes-spec.md 架构规范：
 *   专职 Bot 主工位是全系统唯一允许回写该 Bot MEMORY.md 长期记忆的物理载体。
 *   除了通用黑名单已屏蔽的 new/reset/undo/rollback/fork 之外，
 *   任何试图归档、交接或删除主工位的行为都将导致长期记忆断层或人设精神分裂。
 */
export const BOT_SESSION_EXCLUDED = new Set<string>([
  'handoff',
  'archive',
  'delete',
]);

/**
 * 多 Agent 群聊研讨室（Group Room · hosted_rooms）专属排除命令黑名单。
 *
 * 【设计意图 (Why)】
 *   群聊基于 groups.* 协议协同推进，在网关底层存储于 hosted_rooms 表（主键 room_id）。
 *   slash.exec 严格要求 session_id，传入 room_id 必报 [4001] session not found。
 *   同时，群聊为多 Agent 共识流，不存在单会话的上下文压缩、单方回滚、单人技能与目标规划。
 *
 * 【约束与规则 (Rules)】
 *   在群聊模式下，不仅屏蔽以下单会话控制指令，补全列表还会彻底过滤掉所有单会话 Skills (85+ 个)。
 */
export const GROUP_ROOM_EXCLUDED = new Set<string>([
  'compress',
  'compact',
  'btw',
  'retry',
  'plan',
  'goal',
  'review',
  'refine',
  'moa',
  'subgoal',
  'loop',
  'proactive',
  'blueprint',
  'bp',
  'init',
  'learn',
  'handoff',
]);

/**
 * 桌面端通用黑名单（Tier 1）：
 * 包含终端 TUI 渲染与硬件控制、以及桌面端已有成熟 GUI 控件承载的冗余/失效命令。
 */
export const UNIVERSAL_DESKTOP_EXCLUDED = new Set<string>([
  // 1. TUI 终端渲染与硬件控制
  'mouse',
  'density',
  'logs',
  'palette',
  'skin',
  'battery',
  'timestamps',
  'ts',
  'focus',
  'clear',
  'redraw',
  'statusbar',
  'sb',
  'footer',
  'indicator',
  'busy',
  'quit',
  'exit',
  'copy',
  'paste',
  'image',
  'update',
  'reload',
  'restart',
  'plugins',
  'toolsets',
  'cron',
  'sethome',
  'set-home',
  'worktree',
  'snapshot',
  'snap',
  'pet',
  'hatch',
  'generate-pet',

  // 2. 桌面 GUI 冗余/失效/已有原生控件承载的命令
  // 会话生命周期与回滚（桌面端侧边栏与消息卡片已有原生操作与 persistent rowId 锚点）
  'new',
  'reset',
  'undo',
  'rollback',
  'fork',
  'branch',
  'branch_whole',
  // 帮助与状态（/help 产生 1.3 万字符终端文本塞进 5 秒微型通知条导致截断溢出；/status 已有顶栏及 ContextGauge）
  'help',
  'status',
  // 运行态排队与插话（桌面端运行态按 Enter 自动入队；排队托盘卡片原生支持插话与取消）
  'q',
  'queue',
  'steer',
  's',
  'bg',
  'stop',
  'pause',
  // 底部输入舱/设置中心已有专门控件承载
  'model',
  'yolo',
  'approvals',
  'reasoning',
  'login',
  'topup',
  'subscription',
  'upgrade',
  'topic',
  'title',
  'discard',
  'approve',
  'deny',
  'fast',
  'voice',
  'autoprune',
  'resume',
  'sessions',
  'history',
  'save',
  'export',
  'import',
  'config',
  'platform',
  'platforms',
  'gateway',
  'version',
  'v',
  'debug',
  'codex-runtime',
  'codex_runtime',
  'personality',
  'wake',
  'heartbeat',
  'hb',
  'suggestions',
  'suggest',
  'egress',
  'context',
  'ctx',
  'whoami',
  'profile',
  'journey',
  'learning',
  'memory-graph',
  'memory',
  'curator',
  'kanban',
  'reload-mcp',
  'reload_mcp',
  'reload-skills',
  'reload_skills',
  'browser',
  'commands',
  'tools',
  'skills',
  'bundles',
]);

/** 兼容历史命名的别名引用 */
export const DESKTOP_EXCLUDED_COMMANDS = UNIVERSAL_DESKTOP_EXCLUDED;

/**
 * 依据当前会话模式（SessionKind）计算实际生效的黑名单并集。
 *
 * 【三层黑名单并集模型 (Union Model)】
 *   EffectiveBlacklist = UNIVERSAL ∪ (sessionKind === 'group_room' ? GROUP : (sessionKind === 'bot_forever_chat' ? BOT : ∅))
 */
export function getEffectiveExcludedCommands(options?: {
  sessionKind?: string | null;
}): Set<string> {
  const set = new Set<string>(UNIVERSAL_DESKTOP_EXCLUDED);
  const kind = options?.sessionKind;
  if (kind === 'bot_forever_chat' || kind === 'bot') {
    for (const cmd of BOT_SESSION_EXCLUDED) {
      set.add(cmd);
    }
  } else if (kind === 'group_room' || kind === 'group') {
    for (const cmd of GROUP_ROOM_EXCLUDED) {
      set.add(cmd);
    }
  }
  return set;
}

/**
 * 该命令是否应在桌面端补全列表中出现。
 *
 * 【规则】支持双重重载与会话模式扩展：
 *   - 传 (commandName, desktopMark, options) 时，结合会话模式并集黑名单与网关标记综合判定；
 *   - 传单个参数时，兼容历史测试。
 */
export function isDesktopVisible(
  commandNameOrMark?: string | null,
  maybeDesktopMark?: string | null,
  options?: { sessionKind?: string | null; isSkill?: boolean }
): boolean {
  const excluded = getEffectiveExcludedCommands(options);
  if (options?.sessionKind === 'group_room' && options?.isSkill) {
    return false;
  }
  if (maybeDesktopMark !== undefined) {
    const cmd = commandNameOrMark || '';
    const bare = normalizeCommandName(cmd).toLowerCase();
    if (bare && excluded.has(bare)) return false;
    if (maybeDesktopMark && HIDDEN_DESKTOP_MARKS.has(maybeDesktopMark)) return false;
    return true;
  }
  if (!commandNameOrMark) return true;
  if (HIDDEN_DESKTOP_MARKS.has(commandNameOrMark)) return false;
  const bare = normalizeCommandName(commandNameOrMark).toLowerCase();
  if (excluded.has(bare)) return false;
  return true;
}

/**
 * 从网关 `canon` 表构造「别名 → 主命令」集合。
 *
 * 【规则】键与值都统一去掉前导斜杠并 trim：
 *   网关实测存在 `"s "`、`"v "` 这类带尾随空格的条目，不归一就折叠不掉。
 */
export function buildAliasSet(canon: Record<string, string> | undefined): Set<string> {
  const aliases = new Set<string>();
  if (!canon) return aliases;
  for (const [name, canonical] of Object.entries(canon)) {
    const a = name.replace(/^\//, '').trim();
    const c = String(canonical || '').replace(/^\//, '').trim();
    if (a && c && a !== c) aliases.add(a);
  }
  return aliases;
}

/** 归一命令名：去前导斜杠、去尾随空格。 */
export function normalizeCommandName(raw: string): string {
  return String(raw || '').replace(/^\//, '').trim();
}

/**
 * 过滤补全条目。
 *
 * 【规则】别名只在主命令存在时折叠；主命令自己被隐藏时别名一并隐藏（走 visible 判定即可）。
 *   已收录进字典的命令说明仍由 i18n 提供，这里只决定「显示与否」。
 *   在群聊模式（group_room）下，单会话 Skills (it.isSkill) 彻底排除。
 */
export function filterDesktopCommands<T extends { name: string; isSkill?: boolean }>(input: {
  items: ReadonlyArray<T>;
  /** 网关 desktop 标记，键为归一后的命令名 */
  desktopMarks: ReadonlyMap<string, string | null | undefined>;
  aliases: ReadonlySet<string>;
  sessionKind?: string | null;
}): T[] {
  const isGroup = input.sessionKind === 'group_room' || input.sessionKind === 'group';

  return input.items.filter((it) => {
    if (isGroup && it.isSkill) return false;
    const bare = normalizeCommandName(it.name);
    if (!bare) return false;
    if (input.aliases.has(bare)) return false;
    return isDesktopVisible(bare, input.desktopMarks.get(bare), {
      sessionKind: input.sessionKind,
      isSkill: it.isSkill,
    });
  });
}

/**
 * 本地斜杠指令别名归一（命令分派前拦截）。
 *
 * 【设计意图 (Why)】
 *   1. 网关 `commands.catalog` 的 `canon` 中定义了命令别名映射（如 `/compact` -> `/compress`）；
 *   2. 实测网关 Python 服务端在处理别名 `/compact` 时存在内部崩溃 Bug（_pending_context_engine_compression_notification on NoneType）；
 *   3. 客户端在 `runSlashCommand` 发出前，基于网关 `canon` 映射表及内置安全映射先做一次别名归一，
 *      既能把 `/compact` 等别名无缝转换为官方主命令 `/compress`，又能保留参数（如 `/compact here 3` -> `/compress here 3`）。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 直接全词比对会丢掉后缀参数（如 `/compact here 3`、`/compact --preview`）；
 *   2. 若网关 `canon` 尚未就绪（如断线冷启动或快照加载中），硬编码兜底确保 `/compact` 永不击穿网关 Bug；
 *   3. 网关 `canon` 键值中可能带有首尾空格或前导斜杠，必须归一后查表。
 *
 * 【约束与规则 (Rules)】
 *   - 纯函数，零副作用；
 *   - 必须保留命令后的参数文本；
 *   - 未命中别名的命令原样返回，严禁擅自篡改非别名输入。
 */
function isReadonlyMap(canon: Record<string, string> | ReadonlyMap<string, string>): canon is ReadonlyMap<string, string> {
  return typeof (canon as ReadonlyMap<string, string>).get === 'function';
}

export function resolveCommandAlias(
  command: string,
  canon?: Record<string, string> | ReadonlyMap<string, string>,
): string {
  const trimmed = command.trim();
  if (!trimmed.startsWith('/')) return command;

  const match = trimmed.match(/^(\/[^\s]+)([\s\S]*)$/);
  if (!match) return command;

  const [, rawCmd, rest] = match;
  const bareCmd = normalizeCommandName(rawCmd);

  // 内置关键安全规约：网关服务端 /compact 存在已知 Python 崩溃，永远防御性映射到 /compress
  if (bareCmd === 'compact') {
    return `/compress${rest}`;
  }

  if (!canon) return command;

  let target: string | undefined;
  if (isReadonlyMap(canon)) {
    target = canon.get(bareCmd) || canon.get(rawCmd);
    if (!target) {
      for (const [k, v] of canon.entries()) {
        if (normalizeCommandName(k) === bareCmd) {
          target = v;
          break;
        }
      }
    }
  } else {
    target = canon[bareCmd] || canon[rawCmd];
    if (!target) {
      for (const [k, v] of Object.entries(canon)) {
        if (normalizeCommandName(k) === bareCmd) {
          target = v;
          break;
        }
      }
    }
  }

  if (target) {
    const normTarget = target.trim().startsWith('/') ? target.trim() : `/${target.trim()}`;
    return `${normTarget}${rest}`;
  }

  return command;
}
