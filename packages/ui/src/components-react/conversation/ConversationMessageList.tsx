/**
 * 消息列表（嵌入式）
 *
 * 设计意图(Why)：
 *   接入期只接管消息列表本身，保留旧模板的 main / 滚动容器 / 输入舱，
 *   避免一次性重写 render() 分支；结构稳定后再升级为 ConversationStage。
 *
 * 约束与规则(Rules)：
 *   流式期间宿主不推送新快照，正文由 #msg-content-* 锚点直写。
 */

import * as React from 'react';
import { t } from '../../i18n/index.js';
import type { ConversationSnapshot } from './types.js';
import { TurnGroup, groupTurns } from './TurnGroup.js';
import { selectVisibleMessages } from './visibility.js';
import { collectTouchedFiles } from '../../lib/fileRefs.js';

export function ConversationMessageList({ snapshot }: { snapshot: ConversationSnapshot }): React.ReactElement {
  // 【规则】分组前剔除不上屏的行（display_kind='hidden'）。宿主保留它们在 state.messages 里
  // 以维持与服务端逐行对应，但视图层若也保留，会产出空的 data-conv-turn 容器，制造无意义间距。
  const visibleMessages = React.useMemo(
    () => selectVisibleMessages(snapshot.messages),
    [snapshot.messages]
  );
  const turns = React.useMemo(() => groupTurns(visibleMessages), [visibleMessages]);
  // 文件引用只在 Agent 真实读写过该文件时才可点击；按工具数组引用缓存，避免每次渲染重扫。
  // 【设计意图 (Why)】knownFiles 保持稳定引用，让 TurnGroup / MessageRow 的 memo 在消息与工具都未变时
  //   真正跳过 Markdown 重算；否则每次快照都返回新数组，已挂载消息会整屏重算。
  // 【约束与规则 (Rules)】仅在工具调用数组引用变化时重算。流式末条的 toolCalls 会随回合收敛重建，
  //   此时 knownFiles 换引用并触发一次全量校正是必要成本——工具输出可能新增文件，不能沿用旧集合。
  const knownFilesRef = React.useRef<{ tools: ReadonlyArray<unknown>; files: readonly string[] }>({ tools: [], files: [] });
  const computedKnownFiles = React.useMemo(() => {
    const tools = snapshot.messages.map((message) => message.toolCalls);
    const previous = knownFilesRef.current;
    const unchanged = tools.length === previous.tools.length
      && tools.every((tool, index) => tool === previous.tools[index]);
    if (unchanged) return previous.files;
    const files = collectTouchedFiles(snapshot.messages.flatMap((message) => message.toolCalls ?? []));
    knownFilesRef.current = { tools, files };
    return files;
  }, [snapshot.messages]);
  // 宿主按完整会话计算 knownFiles（窗口外工具也会影响可点击性）；旧调用方无此字段时回退到窗口内自算。
  const knownFiles = snapshot.knownFiles ?? computedKnownFiles;

  // 【加载提示延迟出现 (Why)】桌面端单页往返 600~900ms，若每轮都立刻闪出转圈，
  // 用户看到的是持续闪烁的"正在加载"，观感等同于卡死。
  // 约定：超过 400ms 仍未完成才显示，快速页完全无感。
  const [showLoading, setShowLoading] = React.useState(false);
  React.useEffect(() => {
    if (!snapshot.isLoadingOlder) {
      setShowLoading(false);
      return;
    }
    const timer = setTimeout(() => setShowLoading(true), 400);
    return () => clearTimeout(timer);
  }, [snapshot.isLoadingOlder]);

  const virtualHeight = snapshot.virtualHeightPx && snapshot.virtualHeightPx > 0 ? snapshot.virtualHeightPx : 0;
  const offset = snapshot.contentOffsetPx && snapshot.contentOffsetPx > 0 ? snapshot.contentOffsetPx : 0;

  const content = (
    <>
      {showLoading ? (
        <div className="conv-history-indicator" data-loading="true">
          <span className="conv-history-indicator__spinner" />
          <span>{t('conversation.loadingOlder')}</span>
        </div>
      ) : null}
      {turns.map((turn, index) => (
        <TurnGroup
          key={turn[0]?.id ?? `turn-${index}`}
          messages={turn}
          mode={snapshot.mode}
          locale={snapshot.locale}
          isLastTurn={index === turns.length - 1}
          isStreaming={snapshot.isStreaming && index === turns.length - 1}
          knownFiles={knownFiles}
        />
      ))}
    </>
  );

  /**
   * 【虚拟高度定位 (Rules)】长会话下窗口只挂载一段，必须把这段内容绝对定位到它在
   *   全量历史中的真实纵向位置，同时把外层撑到"总条数 × 平均行高"。
   *   这样 scrollHeight 恒定、滚动条比例稳定，且滚到任意位置都能看到对应内容而不是空白。
   */
  if (virtualHeight > 0) {
    return (
      <div className="conv-virtual-viewport" style={{ height: `${virtualHeight}px` }}>
        <div className="conv-virtual-window" style={{ top: `${offset}px` }}>
          {content}
        </div>
      </div>
    );
  }

  return content;
}
