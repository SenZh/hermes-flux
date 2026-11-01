/**
 * 未进入生成契约、但网关确实存在的方法白名单
 *
 * 设计意图 (Why):
 *   网关有一批"轻量控制方法"在 `tui_gateway/methods_*.py` 里用 `@method(...)`
 *   直接注册，不经过 Pydantic 契约生成器，因此不会出现在 RpcMethods 注册表里。
 *   若不放行，契约校验会把它们误判为"不存在的方法"。
 *
 * 防范的历史坑 (Pitfall):
 *   曾把心跳方法写成不存在的 `system.ping`，网关返回 -32601 后被 catch 吞掉，
 *   导致半开连接看门狗从未生效。真正的方法是 `ping`（返回 { pong: true }）。
 *   这里必须逐条登记来源，禁止用通配符放行。
 *
 * 约束与规则 (Rules):
 *   - 每一条都必须写明网关源码位置与用途，供 review 审计；
 *   - 只登记"确认存在且稳定"的方法，不确定的一律不放行。
 */

export interface ExtraMethodSpec {
  /** 允许的顶层参数名 */
  readonly params: readonly string[];
  /** 网关源码出处与用途说明 */
  readonly source: string;
}

export const EXTRA_METHODS: Record<string, ExtraMethodSpec> = {
  /**
   * 最轻量存活探针，由 WS reader 线程直接应答，agent 忙于回合时同样可用。
   * 源码：tui_gateway/methods_voice.py `@method("ping")` -> `{ pong: true }`
   */
  ping: {
    params: [],
    source: 'tui_gateway/methods_voice.py @method("ping")',
  },
};
