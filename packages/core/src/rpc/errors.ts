/**
 * 能力与契约类错误
 *
 * 设计意图 (Why):
 *   有些失败不是"网络坏了"，而是"这个网关根本没有这个能力"。
 *   两者必须能被调用方区分：前者可重试，后者重试一万次也不会成功。
 *   用独立错误类型把"能力缺失"从业务失败里摘出来，避免被降级成模糊的
 *   "操作失败"，也避免被无限重试。
 *
 * 防范的历史坑 (Pitfall):
 *   曾向网关不存在的方法 `subagent.spawn` 发请求，返回 -32601 后被 catch
 *   包装成"唤起失败"，既查不出原因，也无法判断是否该重试。
 *
 * 约束与规则 (Rules):
 *   - 该错误不可重试，调用方必须显式提示"当前网关不支持"；
 *   - 严禁在 catch 中把它降级为空数据。
 */

export class UnsupportedCapabilityError extends Error {
  public readonly code = 'UNSUPPORTED_CAPABILITY';
  /** 被请求但网关不提供的方法名 */
  public readonly method: string;
  /** 面向用户的解释 */
  public readonly detail: string;

  constructor(method: string, detail: string) {
    super(`${method}: ${detail}`);
    this.name = 'UnsupportedCapabilityError';
    this.method = method;
    this.detail = detail;
  }
}

export function isUnsupportedCapabilityError(value: unknown): value is UnsupportedCapabilityError {
  return value instanceof UnsupportedCapabilityError;
}
