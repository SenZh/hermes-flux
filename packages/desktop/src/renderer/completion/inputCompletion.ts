/**
 * 输入补全领域（斜杠命令 + 文件 mention）。
 *
 * 【设计意图 (Why)】
 *   斜杠补全与文件 mention 补全是同一条链路的两半：都靠 `complete.*` 契约通道，
 *   都有「优先网关、失败回退本地快照」的降级语义，都用序列号守卫丢弃迟到响应。
 *   把它们放在一个模块里，"降级口径必须两侧一致"这条不变量才不会被拆散。
 *
 * 【从 index.ts 抽出的理由】
 *   该领域的状态（快照、别名集、分级标记、两个防抖句柄、两个序列号）写入点
 *   全部在本领域内，因此可以整簇搬走而无需共享可变状态；
 *   宿主只需注入「当前会话上下文」与「重绘」两个能力。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 降级通道与实时通道必须同源：别名折叠与 desktop 可见性都在快照上做一遍，
 *      否则断网时弹框会多出实时通道没有的条目。
 *   2. `resolved !== null` 才代表请求成功，哪怕过滤后为空。用 `length > 0` 判定
 *      会把「全部被隐藏」误判成「请求失败」，回退快照后隐藏静默失效。
 *   3. 不得截断补全结果：条数由网关按前缀决定，浮层用 max-height 承担高度，
 *      不靠丢数据换高度（历史实现写死 slice(0,12)，第 13 条起永远不可见）。
 *
 * 【约束与规则 (Rules)】
 *   - 本模块不直接读写宿主 `state`，全部经由 `InputCompletionHost` 注入。
 *   - 本模块不自己 import 渲染器入口，重绘通过 `host.render()` 触发。
 */

import type { InteractiveService } from '@hermes-flux/core';
import type { IRpcCaller } from '@hermes-flux/core';
import { t } from '@hermes-flux/ui';
import type { MentionReferenceOption, SlashCommandOption } from '@hermes-flux/ui';

import { localizeSlashDescription, toSlashOptions } from '../slashCatalog.js';
import { mergeMentionCandidates } from '../mentionToken.js';
import { buildAliasSet, filterDesktopCommands, normalizeCommandName } from '../slashVisibility.js';

/** 宿主任���：本领域需要的一切外部能力，显式声明而非隐式抓取 */
export interface InputCompletionHost {
  /** 当前活跃会话 id（可空，网关按会话过滤补全） */
  activeSessionId(): string;
  /** 当前 profile 名（可空） */
  profileName(): string;
  /** 当前活跃会话对应的项目/工作目录，作为 complete.path 的 cwd 边界 */
  activeCwd(): string;
  /** 当前已打开的文件，作为文件补全的降级数据源 */
  openFiles(): readonly { path: string }[];
  /** 当前 mention 候选中已有的 Agent 项（Agent 在上、文件在下） */
  agentMentionItems(): MentionReferenceOption[];
  /**
   * 输入框当前完整文本。
   *
   * 【设计意图 (Why)】网关的 complete.slash 需要"整段输入"而不是光标前的 token。
   *   让宿主提供而不是本领域直接读 DOM：本领域只负责补全协议与降级语义，
   *   "文本从哪来"属于宿主职责。这样领域可以在 Node 环境被完整测试，
   *   而历史上直接 `document.getElementById` 让它无法脱离浏览器验证。
   */
  inputText(): string;
  /** 把合并后的 mention 候选项回写宿主观测面 */
  setMentionItems(items: MentionReferenceOption[]): void;
  setMentionPopperOpen(open: boolean): void;
  /** 把斜杠补全结果回写宿主观测面 */
  setSlashItems(items: SlashCommandOption[]): void;
  setSlashPopperOpen(open: boolean): void;
  /** 触发一次宿主重绘 */
  render(): void;
  /** 网关客户端是否已连接（未连接时全部走本地降级） */
  isGatewayReady(): boolean;
  /** RPC 调用器 */
  rpcCaller(): IRpcCaller;
}

/**
 * 补全防抖时长。
 * 【约束与规则 (Rules)】两个通道共用同一时长，避免斜杠与文件补全的响应节奏不一致。
 */
const COMPLETION_DEBOUNCE_MS = 120;

export function createInputCompletion(host: InputCompletionHost, interactiveService: InteractiveService) {
  let slashCatalogSnapshot: SlashCommandOption[] = [];
  /** 网关 desktop 分级标记（键为归一命令名），决定桌面端是否展示 */
  let slashDesktopMarks = new Map<string, string | null | undefined>();
  /** 网关 canon 推导出的别名集合，别名不在补全列表重复出现 */
  let slashAliasSet = new Set<string>();
  let slashCatalogLoaded = false;
  let slashDebounce: ReturnType<typeof setTimeout> | undefined;
  let pathDebounce: ReturnType<typeof setTimeout> | undefined;
  /**
   * 序列号守卫：丢弃迟到的补全响应，防止旧结果覆盖新输入。
   * 【防范的历史坑 (Pitfall)】没有它时，快速连续输入会让先发后至的旧响应
   * 覆盖新结果，表现为"补全列表停在上一个字符的结果"。
   */
  let slashSeq = 0;
  let pathSeq = 0;

  /** 解析当前活跃会话的工作目录，作为 complete.path 的 cwd 边界 */
  function resolveActiveCwd(): string {
    return host.activeCwd();
  }

  /** 将文件补全项与 Agent 项合并进 mention popper（Agent 在上、文件在下） */
  function mergeMentionFiles(
    fileItems: MentionReferenceOption[],
    query: string,
    filesFromGateway: boolean,
    agentItems?: MentionReferenceOption[],
  ): void {
    /**
     * 【规则】网关返回的文件项是权威结果，不再二次过滤 —— 历史上这里用 includes 再筛一遍，
     * 把网关已经模糊命中的 `src/opt/a.ts` 又按字面 `opt` 筛掉，表现为「路径搜不到」。
     */
    const resolvedAgentItems = agentItems ?? host.agentMentionItems();
    host.setMentionItems(mergeMentionCandidates({ agentItems: resolvedAgentItems, fileItems, query, filesFromGateway }));
    host.setMentionPopperOpen(host.agentMentionItems().length > 0 || fileItems.length > 0);
    host.render();
  }

  async function prefetchSlashCatalog(): Promise<void> {
    if (!host.isGatewayReady()) return;
    try {
      const cat = await interactiveService.getCommandsCatalog(
        host.rpcCaller(),
        host.activeSessionId() || undefined,
        host.profileName() || undefined,
      );
      const items: SlashCommandOption[] = [];
      /**
       * 【规则】desktop 是分级标记，不是描述。历史上 `meta?.desktop || ''` 把
       * `hidden`/`terminal` 当文案用，既污染说明又丢掉了分级信息，
       * TUI 专属命令因此全部涌进 GUI 弹框。
       */
      const desktopMarks = new Map<string, string | null | undefined>();
      const descByCommand = new Map<string, string>();
      for (const pair of cat.pairs || []) {
        if (!pair[0]) continue;
        descByCommand.set(normalizeCommandName(pair[0]), pair[1] || '');
      }
      for (const [name, meta] of Object.entries(cat.commands || {})) {
        desktopMarks.set(normalizeCommandName(name), meta?.desktop);
      }
      const pushCmd = (name: string, desc: string) => {
        if (!name) return;
        const normalized = name.startsWith('/') ? name : `/${name}`;
        items.push({ name: normalized, description: localizeSlashDescription(normalized, desc, t) });
      };
      for (const pair of cat.pairs || []) {
        if (pair[0]) pushCmd(pair[0], pair[1] || '');
      }
      for (const name of Object.keys(cat.commands || {})) {
        // 说明取 pairs 的原文；desktop 只作分级，绝不回落到说明文字。
        pushCmd(name, descByCommand.get(normalizeCommandName(name)) || '');
      }
      for (const skillName of Object.keys(cat.skills || {})) {
        // 【规则】技能条目的说明走字典，不得裸写英文 'Skill' 混进中文界面。
        if (skillName) {
          items.push({
            name: skillName.startsWith('/') ? skillName : `/${skillName}`,
            description: t('slash.skillKind'),
            isSkill: true,
          });
        }
      }
      // 别名折叠与桌面可见性都在快照上做一遍：降级通道与实时通道必须同源。
      slashAliasSet = buildAliasSet(cat.canon);
      slashDesktopMarks = desktopMarks;
      const seen = new Set<string>();
      slashCatalogSnapshot = filterDesktopCommands({
        items: items.filter((it) => (seen.has(it.name) ? false : (seen.add(it.name), true))),
        desktopMarks,
        aliases: slashAliasSet,
      });
      slashCatalogLoaded = true;
    } catch {
      // gate-degrade: 目录预取失败属可选加速，回退到按键时实时补全，不阻断输入
      slashCatalogLoaded = false;
    }
  }

  function inputTokenSnapshot(): { fullText: string } {
    return { fullText: host.inputText() };
  }

  /** 斜杠补全：优先 complete.slash（携带 replace_from），失败降级目录快照本地过滤 */
  function requestSlashCompletion(query: string): void {
    if (slashDebounce) clearTimeout(slashDebounce);
    slashDebounce = setTimeout(async () => {
      const mySeq = ++slashSeq;
      let resolved: SlashCommandOption[] | null = null;
      if (host.isGatewayReady()) {
        try {
          const targetText = `/${query}`;
          const res = await interactiveService.getSlashCompletions(
            host.rpcCaller(),
            targetText,
            host.activeSessionId() || undefined,
            host.profileName() || undefined,
          );
          if (mySeq !== slashSeq) return;
          const replaceFrom = typeof res.replace_from === 'number' ? res.replace_from : undefined;
          resolved = toSlashOptions(res.items || [], replaceFrom, t);
        } catch {
          // gate-degrade: complete.slash 失败降级到目录快照
          resolved = null;
        }
      }
      if (mySeq !== slashSeq) return;
      // 【规则】`resolved !== null` 就代表请求成功，哪怕过滤后为空。
      let base = resolved !== null
        ? filterDesktopCommands({ items: resolved, desktopMarks: slashDesktopMarks, aliases: slashAliasSet })
        : slashCatalogSnapshot.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));
      // 补充匹配的技能项（若 gateway 返回的列表未包含该技能）
      if (resolved !== null && slashCatalogSnapshot.length > 0) {
        const existingNames = new Set(base.map((it) => it.name.toLowerCase()));
        const matchingSkills = slashCatalogSnapshot.filter(
          (c) => c.isSkill && c.name.toLowerCase().includes(query.toLowerCase()) && !existingNames.has(c.name.toLowerCase()),
        );
        if (matchingSkills.length > 0) {
          base = [...base, ...matchingSkills];
        }
      }
      host.setSlashItems(base);
      host.setSlashPopperOpen(base.length > 0);
      host.render();
    }, COMPLETION_DEBOUNCE_MS);
  }

  /** 文件补全：complete.path 按当前 cwd + 光标 token 检索，失败降级最近打开文件 */
  function requestPathCompletion(word: string, agentItems?: MentionReferenceOption[]): void {
    if (pathDebounce) clearTimeout(pathDebounce);
    pathDebounce = setTimeout(async () => {
      const mySeq = ++pathSeq;
      let fileItems: MentionReferenceOption[] = [];
      // 【规则】只有网关真的返回过结果才标记为权威，降级路径必须走本地模糊匹配。
      let fromGateway = false;
      if (host.isGatewayReady()) {
        try {
          const cwd = resolveActiveCwd();
          const res = await interactiveService.getPathCompletions(
            host.rpcCaller(),
            word,
            cwd || undefined,
            host.activeSessionId() || undefined,
            host.profileName() || undefined,
          );
          if (mySeq !== pathSeq) return;
          fileItems = (res.items || []).map((it) => ({
            type: 'file' as const,
            name: it.text,
            detail: it.meta || '',
          }));
          fromGateway = true;
        } catch {
          // gate-degrade: complete.path 失败降级到已打开文件列表
          fileItems = host.openFiles().map((f) => ({ type: 'file' as const, name: f.path, detail: t('mention.recentFile') }));
        }
      } else {
        fileItems = host.openFiles().map((f) => ({ type: 'file' as const, name: f.path, detail: t('mention.recentFile') }));
      }
      if (mySeq !== pathSeq) return;
      mergeMentionFiles(fileItems, word, fromGateway, agentItems);
    }, COMPLETION_DEBOUNCE_MS);
  }

  /** 销毁：清掉两个防抖句柄，避免窗口销毁后仍回调宿主 */
  function dispose(): void {
    if (slashDebounce) clearTimeout(slashDebounce);
    if (pathDebounce) clearTimeout(pathDebounce);
    slashDebounce = undefined;
    pathDebounce = undefined;
  }

  return {
    prefetchSlashCatalog,
    requestSlashCompletion,
    requestPathCompletion,
    dispose,
    /** 供测试与诊断读取，不参与业务判定 */
    snapshotState: () => ({
      catalogSize: slashCatalogSnapshot.length,
      loaded: slashCatalogLoaded,
      aliases: slashAliasSet.size,
      marks: slashDesktopMarks.size,
    }),
  };
}

export type InputCompletion = ReturnType<typeof createInputCompletion>;
