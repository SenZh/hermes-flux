# 扩展（MCP / 技能 / 提供商凭据）

> 本文件由 `npm run contract:doc` 从网关契约、探针结果与源码调用点自动生成，请勿手工编辑。
> 契约快照：4364a2dd0064… · 同步于 2026-11-01T01:48:16.956Z

| 方法 | 入参（契约） | 出参（契约） | 调用点 | 真实探针 |
| --- | --- | --- | --- | --- |
| `mcp.servers.status` | `profile` | `servers` `checked_at` | `packages/desktop/src/renderer/settingsController.ts:229` | ✅ 0.21.6 |
| `model.disconnect` | `slug` `session_id` | `slug` `name` `disconnected` | `packages/desktop/src/renderer/settingsController.ts:297` | 跳过：断开提供商会破坏用户已配置的凭据，禁止在真实网关上执行 |
| `model.save_key` | `slug` `api_key` `session_id` | `provider` | `packages/desktop/src/renderer/settingsController.ts:277` | 跳过：写操作会覆盖用户真实 API Key 且无法还原，仅由 CDP 场景在无凭据沙箱手工验证 |
| `reload.env` | — | `updated` | `packages/desktop/src/renderer/settingsController.ts:279` | 跳过：环境热重载会改变运行中的凭据状态，须与 model.save_key 成对执行，禁止单独探针 |
| `skills.manage` | `profile` `action` `query` `page` `page_size` | `skills` `results` `installed` `name` `items` `page` `total_pages` `total` `info` | `packages/desktop/src/renderer/settingsController.ts:230` | ✅ 0.21.6 |
| `skills.reload` | `session_id` `profile` | `output` `result` | `packages/desktop/src/renderer/settingsController.ts:311` | ✅ 0.21.6 |

## 明细

### `mcp.servers.status`

- 参数类型：`ProfileParams`
- 结果类型：`McpServersStatusResult`
- 真实探针：已通过（网关 0.21.6，录制于 2026-11-08T13:18:53.038Z）
- 备注：本机回环网关实测录制；主基线其余条目录制自 0.22.5
- 调用点：
  - `packages/desktop/src/renderer/settingsController.ts:229`

### `model.disconnect`

- 参数类型：`ModelDisconnectParams`
- 结果类型：`ModelDisconnectResult`
- 真实探针：跳过 —— 断开提供商会破坏用户已配置的凭据，禁止在真实网关上执行
- 调用点：
  - `packages/desktop/src/renderer/settingsController.ts:297`

### `model.save_key`

- 参数类型：`ModelSaveKeyParams`
- 结果类型：`ModelSaveKeyResult`
- 真实探针：跳过 —— 写操作会覆盖用户真实 API Key 且无法还原，仅由 CDP 场景在无凭据沙箱手工验证
- 调用点：
  - `packages/desktop/src/renderer/settingsController.ts:277`

### `reload.env`

- 参数类型：`ReloadEnvParams`
- 结果类型：`ReloadEnvResult`
- 真实探针：跳过 —— 环境热重载会改变运行中的凭据状态，须与 model.save_key 成对执行，禁止单独探针
- 调用点：
  - `packages/desktop/src/renderer/settingsController.ts:279`

### `skills.manage`

- 参数类型：`SkillsManageParams`
- 结果类型：`SkillsManageResult`
- 真实探针：已通过（网关 0.21.6，录制于 2026-11-08T13:18:53.038Z）
- 备注：本机回环网关实测录制；主基线其余条目录制自 0.22.5
- 调用点：
  - `packages/desktop/src/renderer/settingsController.ts:230`

### `skills.reload`

- 参数类型：`SkillsReloadParams`
- 结果类型：`SkillsReloadResult`
- 真实探针：已通过（网关 0.21.6，录制于 2026-11-08T13:18:53.038Z）
- 备注：本机回环网关实测录制；主基线其余条目录制自 0.22.5
- 调用点：
  - `packages/desktop/src/renderer/settingsController.ts:311`

