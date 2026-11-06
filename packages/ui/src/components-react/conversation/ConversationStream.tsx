/**
 * 对话流滚动容器
 *
 * 设计意图(Why)：
 *   把滚动容器、画布与跟随逻辑收在组件内，三端复用同一套滚动不变量。
 *
 * 约束与规则(Rules)：
 *   1. 滚动跟随阈值固定 48px，贴底才跟随；
 *   2. 不使用 smooth，不写 transform；
 *   3. 画布保持通栏，不做 740px 限宽（740 只属于输入舱）。
 */

import * as React from 'react';
import type { ConversationSnapshot } from './types.js';
import { useStreamFollow } from './useStreamFollow.js';

export interface ConversationStreamProps {
  snapshot: ConversationSnapshot;
  children: React.ReactNode;
}

export function ConversationStream({ snapshot, children }: ConversationStreamProps): React.ReactElement {
  const last = snapshot.messages[snapshot.messages.length - 1];
  const { ref, onScroll } = useStreamFollow<HTMLDivElement>([snapshot.messages.length, last?.content]);

  return (
    <div
      id="conversation-stream"
      className="messages-stream-area conv-stream"
      data-conv-layer="stream"
      ref={ref}
      onScroll={onScroll}
    >
      <div className="content-fluid-canvas conv-canvas" data-conv-layer="canvas">
        {children}
      </div>
    </div>
  );
}
