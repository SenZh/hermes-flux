# 扩展（MCP / 技能 / 提供商凭据）

> 本文件由 `npm run contract:doc` 从网关契约、探针结果与源码调用点自动生成，请勿手工编辑。
> 契约快照：e3cf16a3d983… · 同步于 2026-11-12T09:29:35.736Z

| 方法 | 入参（契约） | 出参（契约） | 调用点 | 真实探针 |
| --- | --- | --- | --- | --- |
| `mcp.catalog` | `profile` | `servers` | `packages/desktop/src/renderer/services/settingsDataService.ts:1091` | 跳过：新增 MCP 目录查询 RPC 在无 .env 离线探针下显式跳过，由契约白名单与核心/桌面端单测守护；连真实网关跑 probe:gateway 可补录 |
| `mcp.servers.add` | `profile` `name` `preset` `config` `bearer_token` | `ok` `name` `server` | `packages/desktop/src/renderer/services/settingsDataService.ts:1111` | 跳过：新增 MCP 服务器写操作在无 .env 离线探针下显式跳过，由契约白名单与参数构造单测守护；连真实网关跑 probe:gateway 可补录 |
| `mcp.servers.remove` | `profile` `name` | `ok` `removed` | `packages/desktop/src/renderer/services/settingsDataService.ts:1134` | 跳过：移除 MCP 服务器写操作在无 .env 离线探针下显式跳过，由契约白名单与控制器单测守护；连真实网关跑 probe:gateway 可补录 |
| `mcp.servers.status` | `profile` | `servers` `checked_at` | `packages/desktop/src/renderer/services/settingsDataService.ts:394`<br>`packages/desktop/src/renderer/settingsController.ts:209` | ✅ 0.21.6 |
| `mcp.servers.test` | `profile` `name` | `ok` `tools` `error` `prompts` `resources` `oauth_needed` `oauth_tokens_present` | `packages/desktop/src/renderer/services/settingsDataService.ts:1159` | 跳过：MCP 服务器探活 RPC 在无 .env 离线探针下显式跳过，由契约白名单与结果归一化单测守护；连真实网关跑 probe:gateway 可补录 |
| `skills.manage` | `profile` `action` `query` `page` `page_size` | `skills` `results` `installed` `name` `items` `page` `total_pages` `total` `info` | `packages/desktop/src/renderer/services/settingsDataService.ts:1182`<br>`packages/desktop/src/renderer/services/settingsDataService.ts:1189`<br>`packages/desktop/src/renderer/services/settingsDataService.ts:1214`<br>`packages/desktop/src/renderer/services/settingsDataService.ts:1253`<br>`packages/desktop/src/renderer/services/settingsDataService.ts:348`<br>`packages/desktop/src/renderer/settingsController.ts:210` | ✅ 0.21.6 |
| `skills.reload` | `session_id` `profile` | `output` `result` | `packages/desktop/src/renderer/services/settingsDataService.ts:1223`<br>`packages/desktop/src/renderer/settingsController.ts:257` | ✅ 0.21.6 |

## 明细

### `mcp.catalog`

- 参数类型：`ProfileParams`
- 结果类型：`McpCatalogResult`
- 真实探针：跳过 —— 新增 MCP 目录查询 RPC 在无 .env 离线探针下显式跳过，由契约白名单与核心/桌面端单测守护；连真实网关跑 probe:gateway 可补录
- 调用点：
  - `packages/desktop/src/renderer/services/settingsDataService.ts:1091`

### `mcp.servers.add`

- 参数类型：`McpServersAddParams`
- 结果类型：`McpServersAddResult`
- 真实探针：跳过 —— 新增 MCP 服务器写操作在无 .env 离线探针下显式跳过，由契约白名单与参数构造单测守护；连真实网关跑 probe:gateway 可补录
- 调用点：
  - `packages/desktop/src/renderer/services/settingsDataService.ts:1111`

### `mcp.servers.remove`

- 参数类型：`McpServerNameParams`
- 结果类型：`McpServersRemoveResult`
- 真实探针：跳过 —— 移除 MCP 服务器写操作在无 .env 离线探针下显式跳过，由契约白名单与控制器单测守护；连真实网关跑 probe:gateway 可补录
- 调用点：
  - `packages/desktop/src/renderer/services/settingsDataService.ts:1134`

### `mcp.servers.status`

- 参数类型：`ProfileParams`
- 结果类型：`McpServersStatusResult`
- 真实探针：已通过（网关 0.21.6，录制于 2026-11-08T13:18:53.038Z）
- 备注：本机回环网关实测录制；主基线其余条目录制自 0.22.5
- 调用点：
  - `packages/desktop/src/renderer/services/settingsDataService.ts:394`
  - `packages/desktop/src/renderer/settingsController.ts:209`

### `mcp.servers.test`

- 参数类型：`McpServerNameParams`
- 结果类型：`McpServersTestResult`
- 真实探针：跳过 —— MCP 服务器探活 RPC 在无 .env 离线探针下显式跳过，由契约白名单与结果归一化单测守护；连真实网关跑 probe:gateway 可补录
- 调用点：
  - `packages/desktop/src/renderer/services/settingsDataService.ts:1159`

### `skills.manage`

- 参数类型：`SkillsManageParams`
- 结果类型：`SkillsManageResult`
- 真实探针：已通过（网关 0.21.6，录制于 2026-11-08T13:18:53.038Z）
- 备注：本机回环网关实测录制；主基线其余条目录制自 0.22.5
- 调用点：
  - `packages/desktop/src/renderer/services/settingsDataService.ts:1182`
  - `packages/desktop/src/renderer/services/settingsDataService.ts:1189`
  - `packages/desktop/src/renderer/services/settingsDataService.ts:1214`
  - `packages/desktop/src/renderer/services/settingsDataService.ts:1253`
  - `packages/desktop/src/renderer/services/settingsDataService.ts:348`
  - `packages/desktop/src/renderer/settingsController.ts:210`

### `skills.reload`

- 参数类型：`SkillsReloadParams`
- 结果类型：`SkillsReloadResult`
- 真实探针：已通过（网关 0.21.6，录制于 2026-11-08T13:18:53.038Z）
- 备注：本机回环网关实测录制；主基线其余条目录制自 0.22.5
- 调用点：
  - `packages/desktop/src/renderer/services/settingsDataService.ts:1223`
  - `packages/desktop/src/renderer/settingsController.ts:257`

