/**
 * Hermes Flux 流式 Token 写入与合流渲染器 (Token Stream Writer)
 *
 * 【设计意图 (Why)】
 * 统管 TokenCoalescer 120 FPS 高频下行流的 DOM 局部增量直写（contentEl.innerHTML = renderMarkdown）、
 * 思维链详情折叠（Thought Details 折叠面板与展开摘要更新）、
 * 后台未激活会话的内存缓存增量累加（sessionMessagesCache）、
 * 以及视口贴底跟随不变量判定。
 * 将高频流式热路径与 index.ts 主入口解耦，使流式写入具备纯 Node 确定性单测覆盖能力。
 *
 * 【防范的历史坑 (Pitfall)】
 * 1. 贴底判定必须在内容变动前测量（follow-or-not is decided BEFORE content mutates），
 *    读者向上回溯阅读时，绝不能被新涌入的 token 强制拖拽回底部；
 * 2. 消息内容容器必须显式锁定 flexDirection = 'column'，
 *    严禁 flex 默认的 row 布局将多个 Markdown 段落横向排成多列；
 * 3. 后台会话的流式块必须持续回填至 sessionMessagesCache，切会话时才不会丢失最新内容。
 *
 * 【约束与规则 (Rules)】
 * - 纯单向依赖，严禁反向 import index.ts；
 * - 0 as any，保持全栈严格类型推导；
 * - 遵循三要素中文注释规范。
 */

import { renderMarkdown, getCleanReasoningSummary, type MessageViewModel } from '@hermes-flux/ui';
import type { AppState } from '../state/appState.js';

export interface FlushedTokenEntry {
  content?: string;
  thought?: string;
}

export interface TokenStreamWriterDeps {
  getState: () => AppState;
  sessionMessagesCache: Map<string, MessageViewModel[]>;
  botActivityStore: { updateLatestActivity: (botName: string, content: string, ts: number) => void };
  getActiveStreamingStoredSessionId: () => string | null;
  isStreamNearBottom: (stream: HTMLElement | null) => boolean;
  markProgrammaticScroll: (stream: HTMLElement) => void;
  logStream?: { trace: (msg: string, meta?: unknown) => void };
}

export interface TokenStreamWriter {
  writeFlushedTokens(flushedMap: Map<string, FlushedTokenEntry>): void;
}

export function createTokenStreamWriter(deps: TokenStreamWriterDeps): TokenStreamWriter {
  const {
    getState,
    sessionMessagesCache,
    botActivityStore,
    getActiveStreamingStoredSessionId,
    isStreamNearBottom,
    markProgrammaticScroll,
    logStream,
  } = deps;

  function writeFlushedTokens(flushedMap: Map<string, FlushedTokenEntry>): void {
    const flushStartedAt = performance.now();
    const state = getState();
    const activeStreamingStoredSessionId = getActiveStreamingStoredSessionId();

    const streamEl = typeof document !== 'undefined' ? document.getElementById('conversation-stream') : null;
    const followBottom = isStreamNearBottom(streamEl);
    let renderedChars = 0;
    // 【Failure Is Not Empty】直写只 patch 已存在锚点；锚点缺失时必须留痕，
    // 否则"正文一次性上屏"与"流式正常"在日志上完全无法区分（见 findings.md P1-1）。
    let anchorsMissing = 0;

    for (const [msgId, entry] of flushedMap.entries()) {
      const isCurrentSessionActive = activeStreamingStoredSessionId === state.activeSessionId;
      let targetMsg: MessageViewModel | undefined;
      let cachedTarget: MessageViewModel | undefined;

      if (activeStreamingStoredSessionId) {
        let cached = sessionMessagesCache.get(activeStreamingStoredSessionId);
        if (!cached) {
          cached = [];
          sessionMessagesCache.set(activeStreamingStoredSessionId, cached);
        }
        cachedTarget = cached.find((m) => m.id === msgId);
        if (!cachedTarget) {
          const d = new Date();
          const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
          cachedTarget = {
            id: msgId,
            role: 'assistant',
            content: '',
            thought: '',
            timestamp: timeStr,
          };
          cached.push(cachedTarget);
        }
        if (entry.content) {
          cachedTarget.content += entry.content;
          const sess = state.sessions.find((s) => s.id === activeStreamingStoredSessionId);
          if (sess) {
            sess.preview = cachedTarget.content;
            sess.timestamp = Date.now();
          }
          const curFocus = state.activeFocus;
          if (curFocus.type === 'bot') {
            botActivityStore.updateLatestActivity(curFocus.botName, cachedTarget.content, Date.now());
          }
        }
        if (entry.thought) cachedTarget.thought = (cachedTarget.thought || '') + entry.thought;
      }

      if (isCurrentSessionActive) {
        targetMsg = state.messages.find((m) => m.id === msgId);
        if (!targetMsg && activeStreamingStoredSessionId) {
          const cached = sessionMessagesCache.get(activeStreamingStoredSessionId);
          targetMsg = cached?.find((m) => m.id === msgId);
          if (targetMsg && !state.messages.some((m) => m.id === msgId)) {
            state.messages.push(targetMsg);
          }
        }
      }

      if (!targetMsg || targetMsg.role !== 'assistant') continue;

      if (entry.content && isCurrentSessionActive) {
        if (targetMsg !== cachedTarget) {
          targetMsg.content = (targetMsg.content || '') + entry.content;
        }
        renderedChars += entry.content.length;
        if (typeof document !== 'undefined') {
          const contentEl = document.getElementById(`msg-content-${targetMsg.id}`);
          if (!contentEl) {
            // 锚点缺失：内容已进 state，但 DOM 无处落地。可能原因见 findings.md：
            // 空助手行被整行判空 / MarkdownBlock 空正文返回 null / 渲染提交未落地。
            anchorsMissing += 1;
            logStream?.trace('stream-anchor-miss', { id: targetMsg.id });
          } else {
            if (contentEl.style.display === 'none') {
              contentEl.style.display = 'flex';
            }
            if (contentEl.style.flexDirection !== 'column') {
              contentEl.style.flexDirection = 'column';
            }
            contentEl.innerHTML = renderMarkdown(targetMsg.content);
          }
        }
      }

      if (entry.thought && isCurrentSessionActive) {
        if (targetMsg !== cachedTarget) {
          targetMsg.thought = (targetMsg.thought || '') + entry.thought;
        }
        if (typeof document !== 'undefined') {
          const thoughtEl = document.getElementById(`msg-thought-${targetMsg.id}`);
          if (thoughtEl) {
            thoughtEl.innerText = targetMsg.thought || '';
            const fold = thoughtEl.closest('details');
            if (fold) {
              fold.style.display = 'block';
              if (!fold.open) fold.open = true;
              const summaryEl = fold.querySelector('summary span:last-child') as HTMLElement | null;
              if (summaryEl) {
                summaryEl.innerText = getCleanReasoningSummary(targetMsg.thought || '');
              }
            }
          }
        }
      }
    }

    if (streamEl && followBottom) {
      streamEl.scrollTop = streamEl.scrollHeight;
      markProgrammaticScroll(streamEl);
    }

    logStream?.trace('flush', {
      ms: Math.round((performance.now() - flushStartedAt) * 10) / 10,
      messages: flushedMap.size,
      chars: renderedChars,
      anchorsMissing,
      followBottom,
      scrollTop: streamEl ? Math.round(streamEl.scrollTop) : null,
    });
  }

  return {
    writeFlushedTokens,
  };
}
