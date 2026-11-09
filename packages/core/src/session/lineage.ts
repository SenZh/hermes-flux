/**
 * 会话多级血缘拓扑链条解析器 (packages/core/src/session/lineage.ts)
 *
 * 【设计意图 (Why)】
 *   当长会话因上下文超限发生重置（A -> B -> C -> D）或用户从历史消息分叉时，
 *   系统需要顺着 parentSessionId 将多级会话展开为一条从新到老的时间线。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 脏数据导致环形死链（A -> B -> A），无防护遍历直接跑满 CPU 并抛栈溢出；
 *   2. 悬空断链（D 指向的父 ID 不在本地列表缓存），盲目查找抛出 undefined 错误。
 *
 * 【约束与规则 (Rules)】
 *   - 纯函数，零 IO，零 DOM/React/Electron 依赖；
 *   - 严格使用 Set<string> 记录访问路径，遇到环即刻破环熔断；
 *   - 当节点不在注册表中时，将该父 ID 作为终端节点优雅截断输出。
 */

export interface SessionLineageItem {
  sessionId?: string;
  id?: string;
  parentSessionId?: string;
  _reset_from?: string;
  profile?: string;
  botName?: string;
}

/**
 * 将当前叶子会话 ID 顺着父级血缘展开为有序会话 ID 链条 [D, C, B, A]
 */
export function resolveLineageChain(
  leafSessionId: string,
  sessionRegistry: readonly SessionLineageItem[] | ReadonlyMap<string, SessionLineageItem>
): string[] {
  if (!leafSessionId || typeof leafSessionId !== 'string') {
    return [];
  }

  // 构造快速查找表
  const map = new Map<string, SessionLineageItem>();
  if (sessionRegistry instanceof Map) {
    for (const [k, v] of sessionRegistry) {
      map.set(k, v);
    }
  } else if (Array.isArray(sessionRegistry)) {
    for (const item of sessionRegistry) {
      const id = item.sessionId || item.id;
      if (id) map.set(id, item);
    }
  }

  const chain: string[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = leafSessionId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    chain.push(currentId);

    const node = map.get(currentId);
    const parentId = node?.parentSessionId || node?._reset_from;

    if (parentId && typeof parentId === 'string') {
      currentId = parentId;
    } else {
      currentId = undefined;
    }
  }

  return chain;
}
