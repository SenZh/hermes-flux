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
 * 该命令是否应在桌面端补全列表中出现。
 *
 * 【规则】`terminal` 是终端专属（`/redraw`、`/mouse`、`/quit` 等），`hidden` 是网关
 *   明确要求隐藏（如 `/model`，因为输入舱已有模型选择器）。
 */
export function isDesktopVisible(desktopMark: string | null | undefined): boolean {
  if (!desktopMark) return true;
  return !HIDDEN_DESKTOP_MARKS.has(desktopMark);
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
 */
export function filterDesktopCommands<T extends { name: string }>(input: {
  items: ReadonlyArray<T>;
  /** 网关 desktop 标记，键为归一后的命令名 */
  desktopMarks: ReadonlyMap<string, string | null | undefined>;
  aliases: ReadonlySet<string>;
}): T[] {
  return input.items.filter((it) => {
    const bare = normalizeCommandName(it.name);
    if (!bare) return false;
    if (input.aliases.has(bare)) return false;
    return isDesktopVisible(input.desktopMarks.get(bare));
  });
}
