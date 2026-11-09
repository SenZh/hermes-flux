/**
 * 机器压缩上下文交接信息智能过滤与视图投影纯函数 (packages/core/src/session/compactionFilter.ts)
 *
 * 【设计意图 (Why)】
 *   会话在发生上下文超限软重置（Context Compaction Handoff）时，网关会在子会话首条消息中
 *   注入长达数千字的 [CONTEXT COMPACTION] 机器指令、历史任务快照与恢复提示。
 *   若将大段机器技术背景直接显示在气泡中，会严重污染可读性。
 *   必须将机器技术总结与人类真实提问切分，表现层仅渲染人类提问并提供轻量折叠胶囊。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 曾在接入层直接修改 raw 消息正文，破坏了底层回滚（undo）、分支与 Markdown 复制的真实性；
 *   2. 采用过于宽泛的正则表达式导致普通用户提到 compaction 字眼时被误杀。
 *
 * 【约束与规则 (Rules)】
 *   - 纯函数，零 IO，输入不可变；
 *   - 仅作为 ViewModel / 表现层的动态视图投影，严禁直接篡改底层的持久化文本；
 *   - 严格匹配以 [CONTEXT COMPACTION 开头的系统交接模板。
 */

export interface ProcessedMessageContent {
  /** 人类用户真实输入（剥离机器上下文后的提问），用于主对话气泡渲染 */
  displayContent: string;
  /** 提取出的机器技术上下文摘要（如有），用于可选的折叠面板查看 */
  compactedSummary?: string;
  /** 是否为上下文压缩交接消息 */
  isHandoffCompaction: boolean;
}

const COMPACT_HEADER = '[CONTEXT COMPACTION';

export function sanitizeCompactedMessage(rawContent: string): ProcessedMessageContent {
  if (!rawContent || typeof rawContent !== 'string') {
    return { displayContent: '', isHandoffCompaction: false };
  }

  const trimmed = rawContent.trim();
  if (!trimmed.startsWith(COMPACT_HEADER)) {
    return { displayContent: rawContent, isHandoffCompaction: false };
  }

  // 匹配标准交接末尾的分割点（例如 ## Context Recovery 章节或双换行后的真实人类文本）
  // 模式：[CONTEXT COMPACTION ...] ... (直到 ## Context Recovery 末尾段落，或连续两个换行后的新起段落)
  const recoveryIndex = rawContent.indexOf('## Context Recovery');
  if (recoveryIndex !== -1) {
    // 从 ## Context Recovery 之后找到第一个双换行作为人类提问分界
    const afterRecovery = rawContent.slice(recoveryIndex);
    const doubleNewlineMatch = afterRecovery.match(/\n\s*\n([^\n#\s][\s\S]*)$/);
    if (doubleNewlineMatch && typeof doubleNewlineMatch.index === 'number') {
      const splitPos = recoveryIndex + doubleNewlineMatch.index;
      const summaryPart = rawContent.slice(0, splitPos).trim();
      const humanPart = rawContent.slice(splitPos).trim();
      return {
        displayContent: humanPart,
        compactedSummary: summaryPart,
        isHandoffCompaction: true,
      };
    }

    // 若 Context Recovery 后无独立段落人类提问
    return {
      displayContent: '',
      compactedSummary: rawContent.trim(),
      isHandoffCompaction: true,
    };
  }

  // 兜底：若无 ## Context Recovery，按首个双换行进行尝试切分
  const firstDoubleNewline = rawContent.indexOf('\n\n');
  if (firstDoubleNewline !== -1) {
    const summaryPart = rawContent.slice(0, firstDoubleNewline).trim();
    const humanPart = rawContent.slice(firstDoubleNewline + 2).trim();
    return {
      displayContent: humanPart,
      compactedSummary: summaryPart,
      isHandoffCompaction: true,
    };
  }

  return {
    displayContent: '',
    compactedSummary: rawContent.trim(),
    isHandoffCompaction: true,
  };
}
