/**
 * 冷启动默认焦点裁决（纯函数，无 DOM、无 RPC）。
 *
 * 设计意图 (Why)：
 *   进程启动、数据到达后必须有一个确定的默认落点。产品口径是「默认选中第一个 Agent（第一个 profile），
 *   对话区直接显示该 Agent 的对话」。把裁决从渲染器里抽出来，才能对"上次选择仍在列表里"、
 *   "网关只剩会话没有 profile"、"两边都还没到"这些边界逐一证伪。
 *
 * 防范的历史坑 (Pitfall)：
 *   历史实现在会话列表到达时就打开"最新会话"，Profile 到达后再切一次工位，
 *   冷启动首屏会出现两次焦点跳变；更糟的是当网关不存在名为 default 的 profile 时，
 *   焦点会停在一个界面上不存在的 Agent 上，对话区永远空白。
 *
 * 约束与规则 (Rules)：
 *   1. profiles 非空即优先 profile：用仍在列表里的上次选择，否则第一个 profile（网关顺序为真值）；
 *   2. 仅当没有任何 profile 时才回退第一个会话；
 *   3. 两边都为空返回 none —— 由调用方等待下一批数据再裁决，不得凭空造目标。
 */

export interface ColdStartProfileCandidate {
  readonly name: string;
}

export interface ColdStartSessionCandidate {
  readonly id: string;
}

export type ColdStartFocus =
  | { readonly kind: 'bot'; readonly botName: string }
  | { readonly kind: 'session'; readonly sessionId: string }
  | { readonly kind: 'none' };

export interface ColdStartFocusInput {
  readonly profiles: ReadonlyArray<ColdStartProfileCandidate>;
  readonly sessions: ReadonlyArray<ColdStartSessionCandidate>;
  /** 上次落点的 profile 名（持久化值），无效时忽略。 */
  readonly savedProfileName?: string;
}

export function resolveColdStartFocus(input: ColdStartFocusInput): ColdStartFocus {
  const profiles = input.profiles ?? [];
  if (profiles.length > 0) {
    const saved = (input.savedProfileName ?? '').trim().toLowerCase();
    const remembered = saved
      ? profiles.find((profile) => profile.name.toLowerCase() === saved)
      : undefined;
    const target = remembered ?? profiles[0];
    if (target?.name) return { kind: 'bot', botName: target.name };
  }

  const firstSession = (input.sessions ?? [])[0];
  if (firstSession?.id) return { kind: 'session', sessionId: firstSession.id };

  return { kind: 'none' };
}
