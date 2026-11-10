import * as React from 'react';
import { Skeleton } from '../primitives/Skeleton.js';

/**
 * 对话区首屏骨架。
 *
 * 设计意图 (Why)：
 *   会话历史尚在拉取时，绝不能把"开始新的对话"当成真相——那会让用户以为会话是空的，
 *   甚至误以为历史被清掉了。骨架以真实回合节奏占位，数据到达后原位替换。
 *
 * 约束与规则 (Rules)：
 *   1. 固定三个回合，尺寸与消息行节奏对齐（用户短条靠右、助手多行靠左）；
 *   2. 纯装饰：无文案、aria-hidden，读屏器不会读出假消息；
 *   3. 只在「本帧尚无任何消息」时渲染，已有消息时绝不覆盖。
 */
export function ConversationSkeleton(): React.ReactElement {
  return (
    <div className="conv-skeleton flex flex-col gap-8 py-2" aria-hidden="true" data-conv-skeleton="true">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex flex-col gap-3">
          <div className="flex justify-end">
            <Skeleton className="h-3 w-2/5 rounded-pill" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-24 rounded-pill" />
            <Skeleton className="h-3 w-full rounded-pill" />
            <Skeleton className="h-3 w-4/5 rounded-pill" />
          </div>
        </div>
      ))}
    </div>
  );
}
