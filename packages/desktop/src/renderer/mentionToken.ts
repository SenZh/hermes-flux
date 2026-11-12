/**
 * 智能引用（@）的 token 解析与候选合并纯逻辑。
 *
 * 【设计意图 (Why)】
 *   `@` 之后既可能是 Bot 名，也可能是文件路径。路径 token 含 `/`、`~`、`.`、空格转义，
 *   用一条「只允许字母数字下划线」的正则去匹配，输入 `/opt` 时根本进不了补全分支，
 *   表现为「@ 对路径支持不好」。把解析抽成纯函数后，各种 token 形态都能用单测穷举。
 *
 * 【约束与规则 (Rules)】
 *   1. token 一旦含路径分隔符，就不再参与 Bot 名过滤 —— 否则输入 `@/opt` 会用 `/opt` 去筛 Bot；
 *   2. 网关返回的文件项是权威结果，不得再用 `includes` 二次过滤；
 *      本地降级时才做一次宽松匹配，且必须支持分段匹配（`opt` 能命中 `src/opt/a.ts`）；
 *   3. 合并顺序固定 Bot 在上、文件在下，两类各自保持网关返回顺序。
 */

import type { MentionReferenceOption } from '@hermes-flux/ui';

/**
 * 解析光标前的 `@` token。
 *
 * 【规则】`@` 必须出现在行首或空白之后；token 允许路径字符，
 *   遇到空白即结束（路径里带空格由 shell 转义承担，不在补全层猜）。
 */
export function parseMentionToken(textBeforeCursor: string): { query: string; isPath: boolean } | null {
  const match = /(?:^|\s)@([^\s]*)$/.exec(textBeforeCursor);
  if (!match) return null;
  const query = match[1];
  // 含路径分隔符或家目录前缀即视为路径查询
  const isPath = /[/\\~]/.test(query) || query.startsWith('.');
  return { query, isPath };
}

/**
 * 模糊匹配：把 query 与候选名都按路径分段，要求 query 的每一段
 * 都能在候选里按顺序找到，且最后一段允许前缀命中。
 *
 * 【规则】这样 `opt` 能命中 `src/opt/a.ts`、`srcopt` 不能；
 *   `renderer/index` 能命中 `packages/desktop/src/renderer/index.ts`。
 */
export function fuzzyPathMatch(candidate: string, query: string): boolean {
  if (!query) return true;
  const cand = candidate.toLowerCase();
  const segments = query
    .toLowerCase()
    .split(/[/\\]+/)
    .filter(Boolean);
  if (segments.length === 0) return true;
  let cursor = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    const found = cand.indexOf(seg, cursor);
    if (found < 0) return false;
    // 最后一段允许作为前缀（用户还在打字），中间段要求完整出现在路径里
    cursor = found + seg.length;
  }
  return true;
}

/**
 * 合并 Agent 与文件候选。
 *
 * 【规则】Agent 用 `includes`（名字短、容错友好）；文件在网关权威结果上不过滤，
 *   本地降级结果才用 `fuzzyPathMatch`。
 */
export function mergeMentionCandidates(input: {
  agentItems: ReadonlyArray<MentionReferenceOption>;
  fileItems: ReadonlyArray<MentionReferenceOption>;
  query: string;
  /** 文件项是否来自网关权威结果（权威结果不再二次过滤） */
  filesFromGateway: boolean;
  /** 上限，超长由滚动承担，这里只防极端膨胀 */
  limit?: number;
}): MentionReferenceOption[] {
  const q = input.query.toLowerCase();
  const filteredAgents = input.agentItems.filter((m) => m.name.toLowerCase().includes(q));
  const files = input.filesFromGateway
    ? [...input.fileItems]
    : input.fileItems.filter((f) => fuzzyPathMatch(f.name, input.query));
  const merged = [...filteredAgents, ...files];
  return input.limit ? merged.slice(0, input.limit) : merged;
}
