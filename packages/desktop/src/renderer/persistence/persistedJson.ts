/**
 * 持久化值的解析与类型守卫。
 *
 * 【设计意图 (Why)】
 *   渲染层从 localStorage / IndexedDB 读回的数据一律是"外部输入"：
 *   格式可能来自旧版本、可能被用户手改、也可能是上一版写到一半。
 *   直接 `JSON.parse` 后当作已知类型使用，会让脏值一路传到渲染与网络层。
 *   把解析与守卫收敛到一个模块，是让"外部输入必须过类型闸门"成为可测试的事实
 *   而不是散落在各处的口头约定。
 *
 * 【从 index.ts 抽出的理由】
 *   这段逻辑原先内联在 12000 行的入口文件里，测试只能重写一份副本再断言副本，
 *   导致删掉生产代码里的守卫测试依然全绿（实测：删除调用处的 validate 后 12/12 通过）。
 *   抽出成模块后，测试直接验证生产实现，删掉守卫必然变红。
 *
 * 【约束与规则 (Rules)】
 *   - 纯函数，零 DOM / 零存储访问，可在 Node 直接测试。
 *   - 解析失败一律返回 fallback，绝不抛出（启动路径不得因脏存档中断）。
 *   - 守卫存在但校验不通过时同样返回 fallback，不得"降级"成未校验值。
 */

/** 判定值是否为字符串数组（用于模型列表、文件路径列表等持久化字段） */
export function isStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((item) => typeof item === 'string');
}

/**
 * 带类型守卫的 JSON 解析。
 *
 * @param raw 存储中的原始字符串；空值直接返回 fallback
 * @param fallback 解析失败或校验失败时的回落值
 * @param validate 可选的类型守卫；提供时校验不通过即回落
 *
 * 【规则】提供的守卫必须被真正调用。历史缺陷正是调用点漏写了 validate 参数，
 *   于是 "非数组的 JSON" 被当成字符串数组继续用，直到渲染时才发现。
 */
export function safeParseJson<T>(
  raw: string | null,
  fallback: T,
  validate?: (val: unknown) => val is T,
): T {
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (validate) {
      return validate(parsed) ? parsed : fallback;
    }
    return parsed as T;
  // gate-degrade: JSON 解析异常时回落到默认值，避免启动受阻
  } catch {
    return fallback;
  }
}

/**
 * 把消息视图的持久主键解析成可落盘的 orderKey。
 *
 * 【设计意图 (Why)】缓存行的可信度完全取决于这个键：临时主键（`usr-` / `ast-`）
 *   写进缓存后，下次启动会与真实行号对不上，表现为同一条消息出现两次。
 *   因此"什么算合法 rowId"必须是可单独测试的纯判定，而不是散在转换函数里的一段表达式。
 *
 * 【规则】
 *   1. 只有有限正数的 `rowId` 才算权威；
 *   2. 否则尝试从 `row-<n>` 形式的 id 解析；
 *   3. 其余（`usr-`、`ast-`、空串、负数、NaN）一律返回 null，调用方必须放弃落盘。
 */
export function resolveDurableOrderKey(view: { rowId?: number; id?: string }): number | null {
  const direct = typeof view.rowId === 'number' && Number.isFinite(view.rowId) && view.rowId > 0 ? view.rowId : null;
  if (direct !== null) return direct;

  const id = typeof view.id === 'string' ? view.id : '';
  const parsed = Number.parseInt(id.replace(/^row-/, ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}
