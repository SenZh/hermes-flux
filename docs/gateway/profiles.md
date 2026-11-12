# Bot 档案与资产

> 本文件由 `npm run contract:doc` 从网关契约、探针结果与源码调用点自动生成，请勿手工编辑。
> 契约快照：e3cf16a3d983… · 同步于 2026-11-12T09:29:35.736Z

| 方法 | 入参（契约） | 出参（契约） | 调用点 | 真实探针 |
| --- | --- | --- | --- | --- |
| `profiles.configure` | `profile` `name` `ui_meta` `ui_meta_expected_revisions` `soul` `description` `model` `provider` `confirm_expensive_model` `disabled_skills` `enabled_toolsets` `enabled_mcp_servers` | `ok` `applied` `confirm_required` `confirm_message` | `packages/core/src/profile/profileService.ts:163` | ✅ 0.22.5 |
| `profiles.create` | `profile` `name` `description` `clone_from` `clone_all` `clone_channels` `no_skills` `no_alias` `soul` `model` `provider` `share_auth` `mirror_credentials` | `ok` `name` `path` `soul_written` `model_set` `mirrored` `warnings` | `packages/core/src/profile/profileService.ts:128` | ✅ 0.22.5 |
| `profiles.describe` | `profile` `name` | `name` `description` `soul` `model` `skills` `toolsets` `toolsets_pinned` `mcp_servers` | `packages/core/src/profile/profileService.ts:95` | ✅ 0.22.5 |
| `profiles.get_asset` | `profile` `name` `asset` | `found` `mime` `size` `data` | `packages/core/src/profile/profileService.ts:193` | ✅ 0.22.5 |
| `profiles.list` | `profile` `include_sessions` | `profiles` `bot_mode_protocol` `install_id` | `packages/core/src/profile/profileService.ts:71`<br>`packages/core/src/rpc/client.ts:985`<br>`packages/desktop/src/renderer/settingsController.ts:155` | ✅ 0.22.5 |
| `profiles.set_asset` | `profile` `name` `asset` `data` `clear` | `ok` `asset` `size` `removed` | `packages/core/src/profile/profileService.ts:214` | ✅ 0.22.5 |

## 明细

### `profiles.configure`

- 参数类型：`ProfilesConfigureParams`
- 结果类型：`ProfilesConfigureResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/profile/profileService.ts:163`

### `profiles.create`

- 参数类型：`ProfilesCreateParams`
- 结果类型：`ProfilesCreateResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 本次探针走的是守卫分支：错误码 `4062`（属于正确行为，不是失败）
- 调用点：
  - `packages/core/src/profile/profileService.ts:128`

### `profiles.describe`

- 参数类型：`ProfileNameParams`
- 结果类型：`ProfilesDescribeResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/profile/profileService.ts:95`

### `profiles.get_asset`

- 参数类型：`ProfilesGetAssetParams`
- 结果类型：`ProfilesGetAssetResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/profile/profileService.ts:193`

### `profiles.list`

- 参数类型：`ProfilesListParams`
- 结果类型：`ProfilesListResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/profile/profileService.ts:71`
  - `packages/core/src/rpc/client.ts:985`
  - `packages/desktop/src/renderer/settingsController.ts:155`

### `profiles.set_asset`

- 参数类型：`ProfilesSetAssetParams`
- 结果类型：`ProfilesSetAssetResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/profile/profileService.ts:214`

