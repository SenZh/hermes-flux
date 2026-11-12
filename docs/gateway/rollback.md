# 代码时光机

> 本文件由 `npm run contract:doc` 从网关契约、探针结果与源码调用点自动生成，请勿手工编辑。
> 契约快照：e3cf16a3d983… · 同步于 2026-11-12T09:29:35.736Z

| 方法 | 入参（契约） | 出参（契约） | 调用点 | 真实探针 |
| --- | --- | --- | --- | --- |
| `rollback.diff` | `session_id` `hash` `profile` | `stat` `diff` `rendered` | `packages/core/src/project/projectService.ts:334` | ✅ 0.22.5 |
| `rollback.list` | `session_id` `profile` `undo_since` `undo_message_id` | `enabled` `checkpoints` `undo_hint` | `packages/core/src/project/projectService.ts:307` | ✅ 0.22.5 |
| `rollback.restore` | `session_id` `hash` `file_path` `profile` `all` | `success` `restored_to` `reason` `directory` `file` `restored_files` `skipped_user_edits` `skipped_oversize` `failed_deletes` `history_removed` `error` `debug` | `packages/core/src/project/projectService.ts:352` | ✅ 0.22.5 |

## 明细

### `rollback.diff`

- 参数类型：`RollbackDiffParams`
- 结果类型：`RollbackDiffResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 本次探针走的是守卫分支：错误码 `4001`（属于正确行为，不是失败）
- 调用点：
  - `packages/core/src/project/projectService.ts:334`

### `rollback.list`

- 参数类型：`RollbackListParams`
- 结果类型：`RollbackListResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 本次探针走的是守卫分支：错误码 `4001`（属于正确行为，不是失败）
- 调用点：
  - `packages/core/src/project/projectService.ts:307`

### `rollback.restore`

- 参数类型：`RollbackRestoreParams`
- 结果类型：`RollbackRestoreResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 本次探针走的是守卫分支：错误码 `4001`（属于正确行为，不是失败）
- 调用点：
  - `packages/core/src/project/projectService.ts:352`

