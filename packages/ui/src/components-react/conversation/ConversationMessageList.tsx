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
import { collectTouchedFiles } from '../../lib/fileRefs.js';

export function ConversationMessageList({ snapshot }: { snapshot: ConversationSnapshot }): React.ReactElement {
  const turns = React.useMemo(() => groupTurns(snapshot.messages), [snapshot.messages]);
  // 文件引用只在 Agent 真实读写过该文件时才可点击；按消息引用缓存，避免每次渲染重扫
  const knownFiles = React.useMemo(
    () => collectTouchedFiles(snapshot.messages.flatMap((message) => message.toolCalls ?? [])),
    [snapshot.messages]
  );

  return (
    <>
      {snapshot.hasOlderMessages ? (
        <div className="conv-history-indicator" data-loading={snapshot.isLoadingOlder ? 'true' : 'false'}>
          {snapshot.isLoadingOlder ? t('conversation.loadingOlder') : t('conversation.olderHint')}
        </div>
      ) : null}
      {turns.map((turn, index) => (
        <TurnGroup
          key={turn[0]?.id ?? `turn-${index}`}
          messages={turn}
          mode={snapshot.mode}
          isLastTurn={index === turns.length - 1}
          isStreaming={snapshot.isStreaming && index === turns.length - 1}
          knownFiles={knownFiles}
        />
      ))}
    </>
  );
}
