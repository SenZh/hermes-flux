# 扩展（MCP / 技能 / 提供商凭据）

> 本文件由 `npm run contract:doc` 从网关契约、探针结果与源码调用点自动生成，请勿手工编辑。
> 契约快照：e3cf16a3d983… · 同步于 2026-11-12T09:29:35.736Z

| 方法 | 入参（契约） | 出参（契约） | 调用点 | 真实探针 |
| --- | --- | --- | --- | --- |
| `mcp.servers.status` | `profile` | `servers` `checked_at` | `packages/desktop/src/renderer/index.ts:8052`<br>`packages/desktop/src/renderer/settingsController.ts:209` | ✅ 0.21.6 |
| `skills.manage` | `profile` `action` `query` `page` `page_size` | `skills` `results` `installed` `name` `items` `page` `total_pages` `total` `info` | `packages/desktop/src/renderer/index.ts:8028`<br>`packages/desktop/src/renderer/settingsController.ts:210` | ✅ 0.21.6 |
| `skills.reload` | `session_id` `profile` | `output` `result` | `packages/desktop/src/renderer/settingsController.ts:257` | ✅ 0.21.6 |

## 明细

### `mcp.servers.status`

- 参数类型：`ProfileParams`
- 结果类型：`McpServersStatusResult`
- 真实探针：已通过（网关 0.21.6，录制于 2026-11-08T13:18:53.038Z）
- 备注：本机回环网关实测录制；主基线其余条目录制自 0.22.5
- 调用点：
  - `packages/desktop/src/renderer/index.ts:8052`
  - `packages/desktop/src/renderer/settingsController.ts:209`

### `skills.manage`

- 参数类型：`SkillsManageParams`
- 结果类型：`SkillsManageResult`
- 真实探针：已通过（网关 0.21.6，录制于 2026-11-08T13:18:53.038Z）
- 备注：本机回环网关实测录制；主基线其余条目录制自 0.22.5
- 调用点：
  - `packages/desktop/src/renderer/index.ts:8028`
  - `packages/desktop/src/renderer/settingsController.ts:210`

### `skills.reload`

- 参数类型：`SkillsReloadParams`
- 结果类型：`SkillsReloadResult`
- 真实探针：已通过（网关 0.21.6，录制于 2026-11-08T13:18:53.038Z）
- 备注：本机回环网关实测录制；主基线其余条目录制自 0.22.5
- 调用点：
  - `packages/desktop/src/renderer/settingsController.ts:257`

