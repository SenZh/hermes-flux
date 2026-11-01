# 系统与能力探测

> 本文件由 `npm run contract:doc` 从网关契约、探针结果与源码调用点自动生成，请勿手工编辑。
> 契约快照：4364a2dd0064… · 同步于 2026-11-01T01:48:16.956Z

| 方法 | 入参（契约） | 出参（契约） | 调用点 | 真实探针 |
| --- | --- | --- | --- | --- |
| `model.options` | `profile` `session_id` `explicit_only` `include_unconfigured` `refresh` | `providers` `model` `provider` | `packages/core/src/rpc/client.ts:744` | ✅ 0.22.5 |
| `ping` | — | — | `packages/core/src/rpc/client.ts:339`<br>`packages/core/src/rpc/client.ts:394` | ✅ 0.22.5 |

## 明细

### `model.options`

- 参数类型：`ModelOptionsParams`
- 结果类型：`ModelOptionsResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/rpc/client.ts:744`

### `ping`

- 参数类型：`(网关额外方法)`
- 结果类型：`(未纳入生成契约)`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/rpc/client.ts:339`
  - `packages/core/src/rpc/client.ts:394`

