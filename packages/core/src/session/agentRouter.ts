/**
 * Cross-Agent Mention & Delegation Router (packages/core/src/session/agentRouter.ts)
 *
 * 设计意图 (Why):
 *   当用户在输入框中键入 `@Agent` 时，普通会话、专职 Bot 主会话（Forever Chat）与群聊会议室（Group Room）
 *   具有截然不同的上下文纯净度要求与物理安全边界。
 *   必须通过统一的分流路由器进行前置判定，严禁在业务表现层手写胶水代码或随意拼接 System Prompt。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 致命人格与工具串味：在 Bot Forever Chat 中若直接把外部 Bot 注入当前上下文，
 *      会导致 System Prompt 冲突、MCP Tools 越权泄漏以及 MEMORY.md 毒化。
 *   2. 孤儿子会话挂死：派生或分支时必须强制注入 parent_session_id 与 bot_profile 强血缘契约。
 *
 * 约束与规则 (Rules):
 *   - 纯 TypeScript 实现，零宿主 API 或 DOM 依赖。
 *   - 严格遵循裁决矩阵：普通会话走 Subagent 委派，Bot 主会话走 BTW 只读胶囊或无损分叉。
 */

import type { SessionMetadataContract } from '../rpc/types.js';

export type SessionKind = 'scratchpad' | 'bot_forever_chat' | 'group_room';

/**
 * 从渲染层焦点判别会话类型（按钮可见性与路由分流的单一来源）。
 * 【防范的历史坑 (Pitfall)】历史 isOrdinarySession 恒真：视图模型从不携带作用域标记，
 * 导致回滚/Fork 按钮在 Bot 工位与群聊也渲染。统一从这里推导，禁止各处各判一次。
 */
export function deriveSessionKind(
  focus: { type: 'bot'; botName: string } | { type: 'session'; sessionId: string } | { type: 'group'; roomId: string } | undefined
): SessionKind {
  if (!focus) return 'scratchpad';
  if (focus.type === 'bot') return 'bot_forever_chat';
  if (focus.type === 'group') return 'group_room';
  return 'scratchpad';
}

export type MentionRoutingAction =
  | {
      kind: 'subagent_delegation';
      targetProfile: string;
      cleanText: string;
      taskTitle: string;
    }
  | {
      kind: 'btw_isolated_capsule';
      targetProfile: string;
      cleanText: string;
    }
  | {
      kind: 'group_broadcast_mention';
      targetProfile: string;
      cleanText: string;
    }
  | {
      kind: 'direct_chat';
      cleanText: string;
    };

export interface AgentMentionParseResult {
  hasMention: boolean;
  targetProfile: string | null;
  rawMention: string;
  cleanText: string;
}

/**
 * 从文本中提取首个有效的 @Agent 标识（例如 "@架构老王 请帮我排查" -> profile: "架构老王"）
 *
 * 【防范的历史坑 (Pitfall)】
 * 旧实现只认行首 `^@`，用户在句中提及（"请帮我 @架构王 看看"）会静默失效，
 * 整条文本原样发给模型，模型答复"无法调用它"（线上 D4 缺陷的第一根因）。
 * 现改为：任意位置扫描候选 token；提供 knownProfiles 时仅命中已知 profile 才算提及，
 * 杜绝把代码里的 @decorator / @2024 之类字面量误判为呼叫。
 */
export function parseAgentMention(inputText: string, knownProfiles: string[]): AgentMentionParseResult {
  if (!inputText || typeof inputText !== 'string') {
    return { hasMention: false, targetProfile: null, rawMention: '', cleanText: '' };
  }

  const trimmed = inputText.trim();
  const lowerKnown = knownProfiles.map((p) => p.toLowerCase());
  const tokenRe = /(^|\s)@([a-zA-Z0-9_\u4e00-\u9fa5-]+)/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(trimmed)) !== null) {
    const candidate = match[2];
    const isKnown = lowerKnown.length === 0
      // 未提供清单时维持旧语义：行首 @token 直接采纳
      ? match.index === 0
      : lowerKnown.includes(candidate.toLowerCase());
    if (!isKnown) continue;

    const matchedProfile = knownProfiles.find((p) => p.toLowerCase() === candidate.toLowerCase()) || candidate;
    const rawMention = `@${candidate}`;
    // 剥离 @token 本身并保留 match[1] 捕获的前置边界（行首为空串或原分隔空白），
    // 切勿把整个 match[0] 替换成空格——那会把 '@' 连同空白一起留下残影
    const head = match[1] ?? '';
    const cleanText = (trimmed.slice(0, match.index) + head + trimmed.slice(match.index + match[0].length))
      .replace(/\s+/g, ' ')
      .trim();

    return {
      hasMention: true,
      targetProfile: matchedProfile,
      rawMention,
      cleanText: cleanText || trimmed,
    };
  }

  return { hasMention: false, targetProfile: null, rawMention: '', cleanText: trimmed };
}

export type SendRoute =
  | { readonly kind: 'plain'; readonly text: string }
  | { readonly kind: 'group-message'; readonly text: string }
  | { readonly kind: 'mention-subagent'; readonly targetProfile: string; readonly cleanText: string; readonly taskTitle: string }
  | { readonly kind: 'mention-btw'; readonly targetProfile: string; readonly cleanText: string }
  | { readonly kind: 'mention-group'; readonly targetProfile: string; readonly text: string };

export interface SendRouteInput {
  readonly text: string;
  readonly sessionKind: SessionKind;
  readonly knownProfiles: readonly string[];
  /** popper 点选产生的显式提及 token（用户点选即权威，不再做已知性猜测） */
  readonly pickedMentionToken?: string | null;
}

/**
 * 发送链路唯一的路由裁决：先判 mention（点选权威优先），再按会话类型分派通道。
 * 渲染层拿到路由后只负责执行 RPC，禁止自行解析 '@'。
 */
export function planSendRoute(input: SendRouteInput): SendRoute {
  const text = input.text.trim();
  const known = [...input.knownProfiles];
  const parsed = parseAgentMention(text, known);
  const picked = input.pickedMentionToken?.trim();
  const pickedHit = picked ? known.find((p) => p.toLowerCase() === picked.toLowerCase()) : undefined;

  if (input.sessionKind === 'group_room') {
    if (pickedHit || parsed.hasMention) {
      // 判别收窄：hasMention 为真时 targetProfile 必为非空字符串（见 parseAgentMention 返回契约）
      if (pickedHit) {
        return { kind: 'mention-group', targetProfile: pickedHit, text };
      }
      if (parsed.targetProfile) {
        return { kind: 'mention-group', targetProfile: parsed.targetProfile, text };
      }
    }
    return { kind: 'group-message', text };
  }

  const targetProfile = pickedHit ?? (parsed.hasMention ? parsed.targetProfile : null);
  if (!targetProfile) {
    return { kind: 'plain', text };
  }

  // 点选的 token 若已被用户删掉，视同无提及普通发送，绝不把残缺文本静默改写
  if (pickedHit && !text.includes(`@${pickedHit}`) && !text.includes(pickedHit)) {
    return { kind: 'plain', text };
  }

  const cleanText = parsed.hasMention && parsed.targetProfile?.toLowerCase() === targetProfile.toLowerCase()
    ? parsed.cleanText
    : text.replace(new RegExp(`@${targetProfile}`, 'i'), '').trim() || text;

  if (input.sessionKind === 'bot_forever_chat') {
    return { kind: 'mention-btw', targetProfile, cleanText };
  }
  return {
    kind: 'mention-subagent',
    targetProfile,
    cleanText,
    taskTitle: cleanText.slice(0, 30) || `${targetProfile} 协助处理`,
  };
}

/**
 * 根据当前会话类型裁定 @Agent 的精确路由方案
 */
export function resolveMentionRoute(
  inputText: string,
  sessionKind: SessionKind,
  knownProfiles: string[]
): MentionRoutingAction {
  const parsed = parseAgentMention(inputText, knownProfiles);

  if (!parsed.hasMention || !parsed.targetProfile) {
    return { kind: 'direct_chat', cleanText: inputText.trim() };
  }

  const { targetProfile, cleanText } = parsed;

  switch (sessionKind) {
    case 'scratchpad':
      // 1. 普通工作会话 / 旁聊：作为子代理异步委派启动，不阻塞主会话
      return {
        kind: 'subagent_delegation',
        targetProfile,
        cleanText,
        taskTitle: cleanText.slice(0, 30) || `${targetProfile} 协助处理`,
      };

    case 'bot_forever_chat':
      // 2. 专职 Bot 终身主会话：走 prompt.btw 旁路只读外援胶囊，零 Token 污染当前 Bot 记忆
      return {
        kind: 'btw_isolated_capsule',
        targetProfile,
        cleanText,
      };

    case 'group_room':
      // 3. 多 Agent 研讨会议室：直接向房间广播公开 @ 消息
      return {
        kind: 'group_broadcast_mention',
        targetProfile,
        cleanText,
      };

    default:
      return { kind: 'direct_chat', cleanText: inputText.trim() };
  }
}

/**
 * 校验并构造父子会话血缘强契约元数据
 */
export function createChildSessionMetadata(
  parentSessionId: string,
  botProfile: string,
  spawnSource: 'user' | 'subagent' | 'btw' | 'group_seed'
): SessionMetadataContract {
  if (!parentSessionId || typeof parentSessionId !== 'string') {
    throw new Error('Parent session id is mandatory for child session lineage');
  }

  return {
    parent_session_id: parentSessionId,
    bot_profile: botProfile || 'default',
    is_forever_chat: false, // 派生或分支会话绝对禁止成为 forever_chat
    spawn_source: spawnSource,
  };
}
