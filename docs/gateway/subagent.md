# 子代理委派

> 本文件由 `npm run contract:doc` 从网关契约、探针结果与源码调用点自动生成，请勿手工编辑。
> 契约快照：e3cf16a3d983… · 同步于 2026-11-12T07:11:12.771Z

| 方法 | 入参（契约） | 出参（契约） | 调用点 | 真实探针 |
| --- | --- | --- | --- | --- |
| `subagent.interrupt` | `session_id` `profile` `subagent_id` | `found` `subagent_id` | `packages/core/src/subagent/subagentStore.ts:295` | ✅ 0.22.5 |
| `subagent.list` | `session_id` `profile` | `subagents` `delegations` | `packages/core/src/subagent/subagentStore.ts:319` | ✅ 0.22.5 |
| `subagent.steer` | `session_id` `profile` `subagent_id` `text` | `status` `subagent_id` `text` | `packages/core/src/subagent/subagentStore.ts:259` | ✅ 0.22.5 |
| `subagent.tail` | `session_id` `profile` `subagent_id` | `subagent_id` `available` `text` `truncated` | `packages/core/src/subagent/subagentStore.ts:350` | ✅ 0.22.5 |

## 明细

### `subagent.interrupt`

- 参数类型：`SubagentIdParams`
- 结果类型：`SubagentInterruptResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 本次探针走的是守卫分支：错误码 `4001`（属于正确行为，不是失败）
- 调用点：
  - `packages/core/src/subagent/subagentStore.ts:295`

### `subagent.list`

- 参数类型：`SessionParams`
- 结果类型：`SubagentListResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 本次探针走的是守卫分支：错误码 `4001`（属于正确行为，不是失败）
- 调用点：
  - `packages/core/src/subagent/subagentStore.ts:319`

### `subagent.steer`

- 参数类型：`SubagentSteerParams`
- 结果类型：`SubagentSteerResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 本次探针走的是守卫分支：错误码 `4001`（属于正确行为，不是失败）
- 调用点：
  - `packages/core/src/subagent/subagentStore.ts:259`

### `subagent.tail`

- 参数类型：`SubagentIdParams`
- 结果类型：`SubagentTailResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 本次探针走的是守卫分支：错误码 `4001`（属于正确行为，不是失败）
- 调用点：
  - `packages/core/src/subagent/subagentStore.ts:350`

