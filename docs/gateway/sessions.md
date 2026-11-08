# 会话生命周期

> 本文件由 `npm run contract:doc` 从网关契约、探针结果与源码调用点自动生成，请勿手工编辑。
> 契约快照：4364a2dd0064… · 同步于 2026-11-01T01:48:16.956Z

| 方法 | 入参（契约） | 出参（契约） | 调用点 | 真实探针 |
| --- | --- | --- | --- | --- |
| `config.set` | `profile` `key` `value` `session_id` `scope` `confirm_expensive_model` | `key` `value` `warning` `confirm_required` `confirm_message` `scope` `deferred` `tool_progress` `cwd` `branch` `history_reset` `info` | `packages/desktop/src/renderer/index.ts:3403`<br>`packages/desktop/src/renderer/index.ts:3457`<br>`packages/desktop/src/renderer/index.ts:3495`<br>`packages/desktop/src/renderer/index.ts:3524` | ✅ 0.22.5 |
| `session.archive` | `session_id` `session_key` `archived` `profile` | `archived` `session_key` | `packages/desktop/src/renderer/index.ts:3288` | ✅ 0.22.5 |
| `session.branch_whole` | `session_id` `profile` `name` `idempotency_key` | `session_id` `stored_session_id` `title` `parent` `message_count` `messages_omitted` `info` | `packages/core/src/session/handoffService.ts:91` | ✅ 0.22.5 |
| `session.close` | `session_id` `profile` | `closed` `messages` | `packages/core/src/session/SessionLifecycleService.ts:40` | ✅ 0.22.5 |
| `session.create` | `profile` `cols` `source` `cwd` `cwd_explicit` `messages` `parent_session_id` `title` `model` `provider` `reasoning_effort` `fast` `service_tier` `close_on_disconnect` `hidden` `room_plumbing` `follow_profile_config` `idempotency_key` | `session_id` `stored_session_id` `message_count` `messages` `info` | `packages/core/src/profile/profileService.ts:272`<br>`packages/desktop/src/renderer/index.ts:2988`<br>`packages/desktop/src/renderer/index.ts:2992` | ✅ 0.22.5 |
| `session.delete` | `session_id` `profile` | `deleted` | `packages/core/src/session/SessionLifecycleService.ts:52` | ✅ 0.22.5 |
| `session.interrupt` | `session_id` `profile` `expected_hosted_task_id` | `status` `interrupted` `turn_isolation` | `packages/core/src/session/interactiveService.ts:193`<br>`packages/core/src/session/SessionLifecycleService.ts:45`<br>`packages/desktop/src/renderer/index.ts:3648` | ✅ 0.22.5 |
| `session.list` | `profile` `title` `limit` `include_hidden` | `sessions` | `packages/core/src/profile/profileService.ts:245`<br>`packages/core/src/rpc/client.ts:655` | ✅ 0.22.5 |
| `session.resume` | `session_id` `profile` `cols` `source` `lazy` `defer_history` `omit_messages` `eager_build` `close_on_disconnect` `inline_images` | `session_id` `message_count` `messages` `info` `stored_session_id` `resumed` `session_key` `messages_omitted` `hydrating` `running` `turn_started_at` `started_at` `status` `inflight` `queued` `pending_approval` `open_requests` `pending_connection` `todo_state` `auto_continue` | `packages/desktop/src/renderer/index.ts:2793`<br>`packages/desktop/src/renderer/index.ts:2800`<br>`packages/desktop/src/renderer/index.ts:2934`<br>`packages/desktop/src/renderer/index.ts:2936` | ✅ 0.22.5 |
| `session.set_hidden` | `session_id` `hidden` `profile` | `hidden` `session_key` | `packages/core/src/profile/profileService.ts:284`<br>`packages/core/src/session/SessionLifecycleService.ts:57` | ✅ 0.22.5 |
| `session.title` | `session_id` `profile` `title` | `title` `session_key` `pending` | `packages/desktop/src/renderer/index.ts:3196` | ✅ 0.22.5 |

## 明细

### `config.set`

- 参数类型：`ConfigSetParams`
- 结果类型：`ConfigSetResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/desktop/src/renderer/index.ts:3403`
  - `packages/desktop/src/renderer/index.ts:3457`
  - `packages/desktop/src/renderer/index.ts:3495`
  - `packages/desktop/src/renderer/index.ts:3524`

### `session.archive`

- 参数类型：`SessionArchiveParams`
- 结果类型：`SessionArchiveResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/desktop/src/renderer/index.ts:3288`

### `session.branch_whole`

- 参数类型：`SessionBranchWholeParams`
- 结果类型：`SessionBranchWholeResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 本次探针走的是守卫分支：错误码 `4008`（属于正确行为，不是失败）
- 调用点：
  - `packages/core/src/session/handoffService.ts:91`

### `session.close`

- 参数类型：`SessionCloseParams`
- 结果类型：`SessionCloseResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/session/SessionLifecycleService.ts:40`

### `session.create`

- 参数类型：`SessionCreateParams`
- 结果类型：`SessionCreateResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/profile/profileService.ts:272`
  - `packages/desktop/src/renderer/index.ts:2988`
  - `packages/desktop/src/renderer/index.ts:2992`

### `session.delete`

- 参数类型：`SessionDeleteParams`
- 结果类型：`SessionDeleteResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 本次探针走的是守卫分支：错误码 `4023`（属于正确行为，不是失败）
- 调用点：
  - `packages/core/src/session/SessionLifecycleService.ts:52`

### `session.interrupt`

- 参数类型：`SessionInterruptParams`
- 结果类型：`SessionInterruptResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/session/interactiveService.ts:193`
  - `packages/core/src/session/SessionLifecycleService.ts:45`
  - `packages/desktop/src/renderer/index.ts:3648`

### `session.list`

- 参数类型：`SessionListParams`
- 结果类型：`SessionListResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/profile/profileService.ts:245`
  - `packages/core/src/rpc/client.ts:655`

### `session.resume`

- 参数类型：`SessionResumeParams`
- 结果类型：`SessionResumeResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/desktop/src/renderer/index.ts:2793`
  - `packages/desktop/src/renderer/index.ts:2800`
  - `packages/desktop/src/renderer/index.ts:2934`
  - `packages/desktop/src/renderer/index.ts:2936`

### `session.set_hidden`

- 参数类型：`SessionSetHiddenParams`
- 结果类型：`SessionSetHiddenResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/profile/profileService.ts:284`
  - `packages/core/src/session/SessionLifecycleService.ts:57`

### `session.title`

- 参数类型：`SessionTitleParams`
- 结果类型：`SessionTitleResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/desktop/src/renderer/index.ts:3196`

