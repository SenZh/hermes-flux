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
 */
export function parseAgentMention(inputText: string, knownProfiles: string[]): AgentMentionParseResult {
  if (!inputText || typeof inputText !== 'string') {
    return { hasMention: false, targetProfile: null, rawMention: '', cleanText: '' };
  }

  const trimmed = inputText.trim();
  // 匹配以 @ 紧随字符开头的 Pattern
  const mentionMatch = trimmed.match(/^@([a-zA-Z0-9_\u4e00-\u9fa5-]+)(\s+|$)/);
  if (!mentionMatch) {
    return { hasMention: false, targetProfile: null, rawMention: '', cleanText: trimmed };
  }

  const rawMention = mentionMatch[0].trim();
  const candidate = mentionMatch[1];
  const remainingText = trimmed.slice(mentionMatch[0].length).trim();

  // 若提供了已知 profile 清单，进行正向核实；否则直接采纳
  const matchedProfile = knownProfiles.length > 0
    ? knownProfiles.find((p) => p.toLowerCase() === candidate.toLowerCase()) || candidate
    : candidate;

  return {
    hasMention: true,
    targetProfile: matchedProfile,
    rawMention,
    cleanText: remainingText || trimmed,
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
