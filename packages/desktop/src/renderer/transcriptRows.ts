/**
 * 网关原始消息行 → 视图模型（packages/desktop/src/renderer/transcriptRows.ts）
 *
 * 【设计意图 (Why)】
 *   REST `/api/sessions/{id}/messages` 与 RPC `session.resume` 两条接入路径在这里汇合，
 *   是全客户端唯一一处「把网关行翻译成可渲染行」的地方。
 *   显示类型判别（display_kind）也只在这里做一次，避免多处各判一套而漂移。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 必须提取 row_id 为持久 rowId，否则回滚截断只能拿临时 id，网关直接回 4018；
 *   2. 历史上历史 args 形状不统一（顶层 command / 信封 args.command / JSON 字符串），
 *      取不到键就把整段 JSON 当目标显示，统一走深度提取；
 *   3. 空正文守卫若不判 kind，会把官方投影成 `content:""` + `display_kind:"hidden"`
 *      的压缩摘要删掉，本地数组与服务端数组不再逐行对应，fork 切点与分页 offset 漂移；
 *   4. tool-payload 合成必须在 kind 判定之后：机器行正文若是 JSON，会被误吞并进上一条 assistant。
 *
 * 【约束与规则 (Rules)】
 *   - 纯函数：不读全局状态，作用域与时间格式化由调用方注入；
 *   - 只贴标签、不改正文语义、不删非 user 行；
 *   - 未知 display_kind 一律回落 user，绝不静默隐藏用户消息。
 */

import { extractToolTarget, t, type MessageViewModel } from '@hermes-flux/ui';
import { projectDisplay, type MessageDisplayKind } from '@hermes-flux/core';
import { extractDurableRowId } from './rollbackTransaction.js';

export interface TranscriptScope {
  isGroupRoom: boolean;
  isBotRoom: boolean;
}

export interface ParseTranscriptOptions {
  scope: TranscriptScope;
  /** 时间戳格式化；由宿主注入，避免本模块依赖渲染层的时区实现。 */
  formatTimestamp: (ts: number) => string;
}

/** 网关行是外部输入：进本模块时一律 unknown，用窄化守卫逐步取字段。 */
interface RawRow {
  [key: string]: unknown;
}

function asRecord(value: unknown): RawRow | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RawRow) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** 结构化 content 里的一行文本；非对象形态返回空串。 */
function textFromPart(part: unknown): string {
  if (typeof part === 'string') return part;
  const record = asRecord(part);
  if (!record) return '';
  if (typeof record.text === 'string') return record.text;
  if (record.type === 'tool_use') return t('conversation.toolCallPlaceholder', { name: asString(record.name) || 'tool' });
  return '';
}

function formatRawOutput(val: unknown): string | undefined {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'string') return val;
  try {
    return JSON.stringify(val, null, 2);
  // gate-degrade: 工具输出可能是循环引用的非 JSON 值，降级成字符串而不是丢掉整段结果
  } catch {
    return String(val);
  }
}

interface NormalizedToolCall {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed';
  args: string;
  output?: string;
}

export function parseTranscriptRows(list: readonly unknown[], options: ParseTranscriptOptions): MessageViewModel[] {
  const { scope, formatTimestamp } = options;
  const parsedMessages: MessageViewModel[] = [];

  for (let idx = 0; idx < list.length; idx++) {
    const m = list[idx];
    const row = asRecord(m);
    if (!row) continue;

    const rawRole = String(row.role || '').toLowerCase();

    let rawText = '';
    if (typeof row.text === 'string') {
      rawText = row.text;
    } else if (typeof row.content === 'string') {
      rawText = row.content;
    } else if (Array.isArray(row.content)) {
      rawText = row.content
        .map(textFromPart)
        .filter(Boolean)
        .join('\n');
    } else if (typeof row.message === 'string') {
      rawText = row.message;
    } else if (asRecord(row.delta) && typeof (row.delta as RawRow).text === 'string') {
      rawText = (row.delta as RawRow).text as string;
    }

    // 显示类型投影：唯一判别点。正文取 display_content → text → content，只贴标签不改行序。
    const projection = projectDisplay({
      role: rawRole,
      displayKind: row.display_kind,
      displayContent: row.display_content,
      text: rawText,
      content: row.content,
      metadata: row.display_metadata,
    });
    rawText = projection.text;
    const isMachineRow = projection.kind !== 'user';

    const thought = typeof row.thinking === 'string'
      ? row.thinking
      : typeof row.thought === 'string'
      ? row.thought
      : typeof row.reasoning === 'string'
      ? row.reasoning
      : '';

    const rawToolCalls: unknown[] = Array.isArray(row.tool_calls)
      ? row.tool_calls
      : Array.isArray(row.tools)
      ? row.tools
      : Array.isArray(row.tool_use)
      ? row.tool_use
      : [];

    const toolCalls: NormalizedToolCall[] = rawToolCalls.map((rawCall, tIdx) => {
      const tc = asRecord(rawCall) ?? {};
      const fn = asRecord(tc.function) ?? {};
      const toolName = asString(tc.name) || asString(fn.name) || asString(tc.tool) || 'tool';
      const rawArgs = tc.args ?? tc.arguments ?? fn.arguments ?? tc.input ?? tc.parameters ?? {};
      const status = asString(tc.status);
      return {
        id: asString(tc.id) || asString(tc.tool_call_id) || `tc-${idx}-${tIdx}`,
        name: toolName,
        status: status === 'running' || status === 'completed' || status === 'failed' ? status : 'completed',
        args: extractToolTarget(rawArgs),
        output: formatRawOutput(tc.output ?? tc.result ?? tc.stdout),
      };
    });

    // 【规则】机器行不参与 tool-payload 合成：它的正文是网关信令，不是工具结果。
    let isToolPayload = !isMachineRow && (rawRole === 'tool' || rawRole === 'function');
    let synthesizedToolCall: NormalizedToolCall | null = null;

    if (!isMachineRow && !isToolPayload && rawText.trim().startsWith('{') && rawText.trim().endsWith('}')) {
      try {
        const parsed = asRecord(JSON.parse(rawText.trim()));
        if (
          parsed &&
          ('output' in parsed || 'stdout' in parsed || 'exit_code' in parsed || 'exitCode' in parsed || 'diff' in parsed || 'files_modified' in parsed || 'total_count' in parsed || 'matches_text' in parsed || 'content' in parsed)
        ) {
          isToolPayload = true;
          let toolName = 'tool';
          let targetArg = '';

          if ('matches_text' in parsed || 'total_count' in parsed) {
            toolName = 'grep';
          } else if ('diff' in parsed || 'files_modified' in parsed) {
            toolName = 'edit';
            const filesModified = parsed.files_modified;
            targetArg = asString(parsed.resolved_path)
              || (Array.isArray(filesModified) ? asString(filesModified[0]) ?? '' : '')
              || '';
          } else if ('output' in parsed || 'stdout' in parsed) {
            toolName = 'shell';
          }

          const outputCandidate = parsed.output ?? parsed.stdout ?? parsed.diff ?? parsed.matches_text ?? rawText;
          const formattedOutput = typeof outputCandidate === 'string'
            ? outputCandidate
            : JSON.stringify(outputCandidate, null, 2);

          synthesizedToolCall = {
            id: asString(row.tool_call_id) || `tc-synth-${idx}`,
            name: toolName,
            status: 'completed',
            args: targetArg,
            output: formattedOutput,
          };
        }
      // gate-degrade: 跨库删除的容错分支，某个 profile 未持有该会话属正常
      } catch {
        // not json
      }
    }

    if (isToolPayload) {
      if (parsedMessages.length > 0 && parsedMessages[parsedMessages.length - 1].role === 'assistant') {
        const prev = parsedMessages[parsedMessages.length - 1];
        if (!prev.toolCalls) prev.toolCalls = [];

        if (synthesizedToolCall) {
          prev.toolCalls.push(synthesizedToolCall);
          continue;
        }

        const resultObj = asRecord(row.result);
        const validToolOutput = rawText
          || asString(row.output)
          || (resultObj && Object.keys(resultObj).length > 0 ? JSON.stringify(resultObj) : undefined);
        // 走到这里 synthesizedToolCall 必为 null（上面的分支已 continue），保留兜底文案即可。
        const fallbackName = asString(row.name) || 'tool';

        if (prev.toolCalls.length > 0) {
          const lastTool = prev.toolCalls[prev.toolCalls.length - 1];
          lastTool.output = validToolOutput;
          continue;
        }
        prev.toolCalls.push({
          id: asString(row.tool_call_id) || `tc-${idx}`,
          name: fallbackName,
          status: 'completed',
          args: '',
          output: validToolOutput,
        });
        continue;
      }
      if (synthesizedToolCall) {
        const rawTs = row.timestamp ?? row.created_at;
        const parsedTs = typeof rawTs === 'number'
          ? (Number.isFinite(rawTs) && rawTs > 0 ? (rawTs > 1e11 ? rawTs : rawTs * 1000) : undefined)
          : (rawTs !== undefined && rawTs !== null ? (Date.parse(String(rawTs)) || undefined) : undefined);
        parsedMessages.push({
          id: String(row.row_id ?? row.id ?? `msg-${idx}`),
          rowId: extractDurableRowId(row),
          role: 'assistant',
          content: '',
          thought: '',
          toolCalls: [synthesizedToolCall],
          timestamp: parsedTs !== undefined ? formatTimestamp(parsedTs) : '',
          rawTimestamp: parsedTs,
          displayKind: 'user',
        });
        continue;
      }
      continue;
    }

    const hasContent = Boolean(rawText && rawText.trim());
    const hasThought = Boolean(thought && thought.trim());
    const hasTools = toolCalls.length > 0;

    // 【行序守恒 (Rules)】只有真实人类/助手行才按「无内容即丢弃」处理。
    // display_kind 已判定为机器行的记录无条件保留，否则本地数组会少行。
    if (!isMachineRow) {
      if (rawRole === 'assistant' && !hasContent && !hasThought && !hasTools) continue;
      if (rawRole !== 'assistant' && !hasContent) continue;
    }

    const rawTs = row.timestamp ?? row.created_at;
    const parsedTs = typeof rawTs === 'number'
      ? (Number.isFinite(rawTs) && rawTs > 0 ? (rawTs > 1e11 ? rawTs : rawTs * 1000) : undefined)
      : (rawTs !== undefined && rawTs !== null ? (Date.parse(String(rawTs)) || undefined) : undefined);

    const scopedMsg: MessageViewModel = {
      id: String(row.row_id ?? row.id ?? `msg-${idx}`),
      sessionId: typeof row.session_id === 'string' ? row.session_id : undefined,
      rowId: extractDurableRowId(row),
      role: (rawRole === 'user' || rawRole === 'system' ? rawRole : 'assistant') as MessageViewModel['role'],
      content: rawText,
      thought,
      thoughtDurationMs: typeof row.thought_duration_ms === 'number' ? row.thought_duration_ms : undefined,
      toolCalls,
      timestamp: parsedTs !== undefined ? formatTimestamp(parsedTs) : '',
      rawTimestamp: parsedTs,
      // assistant 行也记 'user'（意为「非机器行」），时间线分派只对 role=user 生效。
      displayKind: projection.kind as MessageDisplayKind,
      displayMetadata: projection.metadata,
    };
    if (scope.isGroupRoom) scopedMsg.isGroupRoom = true;
    if (scope.isBotRoom) scopedMsg.isBotRoom = true;
    parsedMessages.push(scopedMsg);
  }

  return parsedMessages;
}
