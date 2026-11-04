# 工程与工作区

> 本文件由 `npm run contract:doc` 从网关契约、探针结果与源码调用点自动生成，请勿手工编辑。
> 契约快照：4364a2dd0064… · 同步于 2026-11-01T01:48:16.956Z

| 方法 | 入参（契约） | 出参（契约） | 调用点 | 真实探针 |
| --- | --- | --- | --- | --- |
| `projects.add_folder` | `profile` `id` `path` `label` `is_primary` | `project` | `packages/core/src/project/projectService.ts:246` | ✅ 0.22.5 |
| `projects.create` | `profile` `name` `folders` `slug` `primary_path` `description` `icon` `color` `board_slug` `use` | `project` | `packages/core/src/project/projectService.ts:160` | ✅ 0.22.5 |
| `projects.delete` | `profile` `id` | `projects` `active_id` | `packages/core/src/project/projectService.ts:202` | ✅ 0.22.5 |
| `projects.get` | `profile` `id` | `project` | `packages/core/src/project/projectService.ts:110` | ✅ 0.22.5 |
| `projects.list` | `profile` | `projects` `active_id` | `packages/core/src/project/projectService.ts:66`<br>`packages/desktop/src/renderer/index.ts:1318` | ✅ 0.22.5 |
| `projects.remove_folder` | `profile` `id` `path` | `project` | `packages/core/src/project/projectService.ts:268` | ✅ 0.22.5 |
| `projects.set_active` | `profile` `id` | `active_id` | `packages/core/src/project/projectService.ts:222` | ✅ 0.22.5 |
| `projects.tree` | `profile` `preview_limit` `session_limit` | `projects` `active_id` `scoped_session_ids` | `packages/core/src/project/projectService.ts:285` | ✅ 0.22.5 |
| `projects.update` | `profile` `id` `name` `description` `icon` `color` `board_slug` | `project` | `packages/core/src/project/projectService.ts:178` | ✅ 0.22.5 |

## 明细

### `projects.add_folder`

- 参数类型：`ProjectsAddFolderParams`
- 结果类型：`ProjectResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/project/projectService.ts:246`

### `projects.create`

- 参数类型：`ProjectsCreateParams`
- 结果类型：`OptionalProjectResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/project/projectService.ts:160`

### `projects.delete`

- 参数类型：`ProjectIdParams`
- 结果类型：`ProjectsPayload`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/project/projectService.ts:202`

### `projects.get`

- 参数类型：`ProjectIdParams`
- 结果类型：`ProjectResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/project/projectService.ts:110`

### `projects.list`

- 参数类型：`ProfileParams`
- 结果类型：`ProjectsPayload`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/project/projectService.ts:66`
  - `packages/desktop/src/renderer/index.ts:1318`

### `projects.remove_folder`

- 参数类型：`ProjectFolderParams`
- 结果类型：`ProjectResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/project/projectService.ts:268`

### `projects.set_active`

- 参数类型：`ProjectsSetActiveParams`
- 结果类型：`ActiveIdResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/project/projectService.ts:222`

### `projects.tree`

- 参数类型：`ProjectsTreeParams`
- 结果类型：`ProjectsTreeResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/project/projectService.ts:285`

### `projects.update`

- 参数类型：`ProjectsUpdateParams`
- 结果类型：`ProjectResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/project/projectService.ts:178`

