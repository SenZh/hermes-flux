/**
 * 对话区舞台
 *
 * 设计意图(Why)：
 *   统一三态分派（连接中 / 未连接 / 消息流），让外壳几何与状态钩子只有一处定义。
 *
 * 约束与规则(Rules)：
 *   1. 未连接态优先渲染宿主提供的 onboarding 节点，组件本身不实现网关表单；
 *   2. 消息按给定顺序渲染，不排序、不去重；
 *   3. 底部遮罩与输入舱槽位保持与旧模板一致的结构位置。
 */

import * as React from 'react';
import { t } from '../../i18n/index.js';
import type { ConversationActions, ConversationSnapshot } from './types.js';
import { ConversationSkeleton } from './ConversationSkeleton.js';
import { ConversationStream } from './ConversationStream.js';
import { TurnGroup, groupTurns } from './TurnGroup.js';
import { selectVisibleMessages } from './visibility.js';

export interface ConversationStageProps {
  snapshot: ConversationSnapshot;
  actions?: ConversationActions;
  /** 未连接态由宿主注入（旧 onboarding 表单），组件不实现网关连接逻辑 */
  onboarding?: React.ReactNode;
  /** 输入舱由宿主注入，保持不透明挂载 */
  dock?: React.ReactNode;
}

function StateBlock({ title, hint }: { title: string; hint?: string }): React.ReactElement {
  return (
    <div className="conv-state" data-conv-state="empty">
      <div className="conv-state__title">{title}</div>
      {hint ? <div className="conv-state__hint">{hint}</div> : null}
    </div>
  );
}

export function ConversationStage({
  snapshot,
  onboarding,
  dock,
}: ConversationStageProps): React.ReactElement {
  // 分组前剔除不上屏的行（display_kind='hidden'）：宿主保留它们只为维持与服务端逐行对应。
  const visibleMessages = React.useMemo(() => selectVisibleMessages(snapshot.messages), [snapshot.messages]);
  const turns = React.useMemo(() => groupTurns(visibleMessages), [visibleMessages]);

  return (
    <main className="flux-middle-pod conversation-pod" data-conv-layer="stage" data-conv-mode={snapshot.mode}>
      <ConversationStream snapshot={snapshot}>
        {snapshot.connection === 'disconnected' ? (
          (onboarding ?? (
            <StateBlock
              title={t('conversation.disconnected')}
              hint={t('conversation.disconnectedHint')}
            />
          ))
        ) : snapshot.messagesPhase === 'loading' && turns.length === 0 ? (
          // 连接中与历史拉取中都属于「内容尚未到达」：只给骨架，不给任何默认文案。
          // 已有消息（含流式中）时绝不覆盖，骨架只在真空窗里出现。
          <ConversationSkeleton />
        ) : snapshot.connection === 'connecting' ? (
          <StateBlock title={t('conversation.connecting')} />
        ) : turns.length === 0 ? (
          <StateBlock title={snapshot.emptyTitle ?? t('conversation.emptyTitle')} hint={snapshot.emptyHint} />
        ) : (
          <>
            {snapshot.isLoadingOlder ? (
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
                isLastTurn={index === turns.length - 1}
                isStreaming={snapshot.isStreaming && index === turns.length - 1}
              />
            ))}
          </>
        )}
      </ConversationStream>

      <div className="dock-scrim-fade conv-dock-scrim" data-conv-layer="scrim" />
      {dock}
    </main>
  );
}
