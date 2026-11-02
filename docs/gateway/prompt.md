# 对话提交与旁路

> 本文件由 `npm run contract:doc` 从网关契约、探针结果与源码调用点自动生成，请勿手工编辑。
> 契约快照：4364a2dd0064… · 同步于 2026-11-01T01:48:16.956Z

| 方法 | 入参（契约） | 出参（契约） | 调用点 | 真实探针 |
| --- | --- | --- | --- | --- |
| `prompt.btw` | `session_id` `profile` `text` | `task_id` | `packages/core/src/session/handoffService.ts:58` | ✅ 0.22.5 |
| `prompt.submit` | `session_id` `profile` `text` `display_kind` `interrupted` `queued` `surface` `voice_context` `voice_turn` `title_preview` `truncate_before_user_ordinal` `truncate_before_row_id` `truncate_before_message_id` `confirm_truncate` `confirm_empty_truncate` `confirm_deep_truncate` `rebind_survivor_row_ids` | `status` `voice_stopped` `user_row_id` `survivor_user_row_ids` `survivor_row_id_map` `turn_isolation` | `packages/core/src/session/interactiveService.ts:80`<br>`packages/desktop/src/renderer/index.ts:3113` | ✅ 0.22.5 |

## 明细

### `prompt.btw`

- 参数类型：`SideAgentParams`
- 结果类型：`TaskIdResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/session/handoffService.ts:58`

### `prompt.submit`

- 参数类型：`PromptSubmitParams`
- 结果类型：`PromptSubmitResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/session/interactiveService.ts:80`
  - `packages/desktop/src/renderer/index.ts:3113`

