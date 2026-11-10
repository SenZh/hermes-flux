/**
 * 对话可见行投影 (packages/ui/src/components-react/conversation/visibility.ts)
 *
 * 【设计意图 (Why)】
 *   宿主为保持「本地数组与服务端数组逐行对应」会保留 display_kind='hidden' 的行，
 *   但表现层必须把它们剔除：否则会产出空的 data-conv-turn 容器，制造无意义间距，
 *   也会让末条判定落在一条永远不显示的记录上。
 *
 * 【约束与规则 (Rules)】
 *   只做过滤，不改顺序、不改对象；纯函数，可被两个挂载入口共用。
 */

import type { ConversationMessageVM } from './types.js';

export function selectVisibleMessages(messages: readonly ConversationMessageVM[]): ConversationMessageVM[] {
  return messages.filter((message) => (message.displayKind ?? 'user') !== 'hidden');
}
