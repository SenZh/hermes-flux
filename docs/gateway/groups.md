# 多 Agent 群聊

> 本文件由 `npm run contract:doc` 从网关契约、探针结果与源码调用点自动生成，请勿手工编辑。
> 契约快照：4364a2dd0064… · 同步于 2026-11-01T01:48:16.956Z

| 方法 | 入参（契约） | 出参（契约） | 调用点 | 真实探针 |
| --- | --- | --- | --- | --- |
| `groups.create` | `profile` `room_id` `name` `members` `authority_gateway_id` | `room` | `packages/core/src/group/groupService.ts:191` | ✅ 0.22.5 |
| `groups.disband` | `profile` `room_id` `cancel_id` | `tombstone` | `packages/core/src/group/groupService.ts:338` | ✅ 0.22.5 |
| `groups.list` | `profile` `include_disbanded` `limit` `offset` | `rooms` `next_offset` | `packages/core/src/group/groupService.ts:104` | ✅ 0.22.5 |
| `groups.log` | `profile` `room_id` `since_seq` `limit` `include_disbanded` | `events` `cursor` `latest_seq` `has_more` `authority` | `packages/core/src/group/groupService.ts:284` | ✅ 0.22.5 |
| `groups.rename` | `profile` `room_id` `event_id` `name` | `room` | `packages/core/src/group/groupService.ts:359` | ✅ 0.22.5 |
| `groups.send` | `profile` `room_id` `event_id` `payload` | `event` `client_event_id` `accepted` `driver_started` | `packages/core/src/group/groupService.ts:250` | ✅ 0.22.5 |
| `groups.state` | `profile` `room_id` `include_disbanded` | `room` `driver_status` | `packages/core/src/group/groupService.ts:148` | ✅ 0.22.5 |

## 明细

### `groups.create`

- 参数类型：`GroupsCreateParams`
- 结果类型：`GroupsCreateResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/group/groupService.ts:191`

### `groups.disband`

- 参数类型：`GroupsDisbandParams`
- 结果类型：`GroupsDisbandResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/group/groupService.ts:338`

### `groups.list`

- 参数类型：`GroupsListParams`
- 结果类型：`GroupsListResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/group/groupService.ts:104`

### `groups.log`

- 参数类型：`GroupsLogParams`
- 结果类型：`GroupsLogResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/group/groupService.ts:284`

### `groups.rename`

- 参数类型：`GroupsRenameParams`
- 结果类型：`GroupsRenameResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/group/groupService.ts:359`

### `groups.send`

- 参数类型：`GroupsSendParams`
- 结果类型：`GroupsSendResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/group/groupService.ts:250`

### `groups.state`

- 参数类型：`GroupsStateParams`
- 结果类型：`GroupsStateResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/group/groupService.ts:148`

