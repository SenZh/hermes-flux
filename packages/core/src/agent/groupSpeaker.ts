/**
 * 群聊说话者归一化（packages/core/src/agent/groupSpeaker.ts）
 *
 * 【设计意图 (Why)】
 *   群聊在场指示器需要知道「此刻是谁在干活」。这个判断本身是纯领域逻辑：
 *   从消息列表末尾倒推最后一位发言的成员，并把各种形态的 sender 名归一化到
 *   房间成员表里的 profile name。把它写进 Electron 壳层会导致两个后果：
 *     1. 无法单测（壳层没有可注入的纯入口）；
 *     2. 与「严禁在壳内编写应用级状态机」的分层铁律冲突。
 *   因此下沉到这里，壳层只负责「取 state 传参 + 写回 state」。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. `groups.send` 的响应代表**人类用户**发出的那条消息（`groupService` 写入的
 *      entry 带 `actorKind: 'user'`），拿它当说话者会高亮一个没在干活的头像，属伪造。
 *      因此说话者只能来自 **assistant 消息**的 sender。
 *   2. sender 可能是 displayName 也可能是 profile name，而房间 `members` 存的是
 *      profile name。不做双向归一化时，组件侧「说话者必须在成员列表里」的守卫
 *      会永远判定未知，接线看似通了实际永远不高亮。
 *   3. 末条是 user 消息说明成员还没应答，此时必须返回 null，不得沿用上一位。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯逻辑，零 DOM / 零 React / 零网络；
 *   2. 只认成员表里真实存在的名字：归一化失败一律 null，绝不猜测、绝不伪造；
 *   3. 只读入参，不修改传入数组。
 */

/** 归一化所需的最小消息形状 */
export interface GroupSpeakerMessage {
  role: 'user' | 'assistant' | 'system';
  sender?: string;
}

/** 归一化所需的最小 profile 形状 */
export interface GroupSpeakerProfile {
  name: string;
  displayName?: string;
}

/**
 * 从消息列表倒推当前说话者。
 *
 * 【约束与规则 (Rules)】
 *   1. 只从末尾往前找第一条 `user` 或 `assistant`；
 *   2. 命中 `user` 立即返回 null（成员尚未应答，此刻没有人在说话）；
 *   3. 命中 `assistant` 时把 sender 归一化到成员名，失败返回 null；
 *   4. 全是 `system` 或空列表时返回 null。
 *
 * @param messages 会话消息（顺序即真相，从旧到新）
 * @param members  房间成员 profile name 列表
 * @param profiles 已知 Agent profile（用于 displayName ↔ name 双向匹配）
 */
export function resolveGroupSpeaker(
  messages: readonly GroupSpeakerMessage[],
  members: readonly string[],
  profiles: readonly GroupSpeakerProfile[],
): string | null {
  if (members.length === 0) return null;

  /** sender（可能是 displayName 或 profile name）→ 成员表里的真实名字 */
  const toMemberName = (sender: string): string | null => {
    const lower = sender.trim().toLowerCase();
    if (!lower) return null;
    // 先直接匹配成员表：members 里存的已是 profile name
    const direct = members.find((member) => member.toLowerCase() === lower);
    if (direct) return direct;
    // 再借 profile 把 displayName 折回 profile name
    const profile = profiles.find(
      (candidate) =>
        candidate.name.toLowerCase() === lower ||
        (candidate.displayName ?? '').toLowerCase() === lower,
    );
    if (!profile) return null;
    const byName = members.find((member) => member.toLowerCase() === profile.name.toLowerCase());
    return byName ?? null;
  };

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'user') return null;
    if (message.role === 'assistant') {
      const sender = (message.sender ?? '').trim();
      return sender ? toMemberName(sender) : null;
    }
  }
  return null;
}
