# 对话提交与旁路

> 本文件由 `npm run contract:doc` 从网关契约、探针结果与源码调用点自动生成，请勿手工编辑。
> 契约快照：4364a2dd0064… · 同步于 2026-11-01T01:48:16.956Z

| 方法 | 入参（契约） | 出参（契约） | 调用点 | 真实探针 |
| --- | --- | --- | --- | --- |
| `complete.path` | `profile` `word` `cwd` `session_id` | `items` | `packages/core/src/session/interactiveService.ts:248` | 跳过：文件路径补全依赖活跃会话的 cwd 与工作区文件系统实时遍历，离线探针无有效 cwd，显式跳过，由契约表与 CDP 场景守护 |
| `complete.slash` | `text` `session_id` `profile` | `items` `replace_from` | `packages/core/src/session/interactiveService.ts:228` | 跳过：斜杠实时补全需绑定活跃会话的 profile 与项目技能上下文，离线探针无会话可绑，显式跳过，由契约表与 CDP 场景守护 |
| `image.attach_bytes` | `session_id` `profile` `content_base64` `data` `filename` `ext` | `name` `width` `height` `token_estimate` `attached` `path` `count` `remainder` `text` `bytes` `message` | `packages/desktop/src/renderer/index.ts:3473` | 跳过：图片二进制字节附加通道需依赖在线活跃通道与图文模型，在离线探针下显式跳过，由契约表与 CDP 物理测试严格守护 |
| `prompt.background` | `session_id` `profile` `text` | `task_id` | `packages/desktop/src/renderer/index.ts:3676` | 跳过：后台子代理旁路呼叫需活跃会话与跨 profile 计算宿主，应答经事件流异步到达，离线探针显式跳过，由契约表与路由单测守护 |
| `prompt.btw` | `session_id` `profile` `text` | `task_id` | `packages/core/src/session/handoffService.ts:58` | ✅ 0.22.5 |
| `prompt.submit` | `session_id` `profile` `text` `display_kind` `interrupted` `queued` `surface` `voice_context` `voice_turn` `title_preview` `truncate_before_user_ordinal` `truncate_before_row_id` `truncate_before_message_id` `confirm_truncate` `confirm_empty_truncate` `confirm_deep_truncate` `rebind_survivor_row_ids` | `status` `voice_stopped` `user_row_id` `survivor_user_row_ids` `survivor_row_id_map` `turn_isolation` | `packages/core/src/session/interactiveService.ts:107`<br>`packages/desktop/src/renderer/index.ts:3497` | ✅ 0.22.5 |
| `slash.exec` | `session_id` `command` `profile` | `output` `warning` `type` `target` `message` `notice` `display` `name` `status` | `packages/core/src/session/interactiveService.ts:272` | 跳过：斜杠指令执行需活跃会话与在线命令分发器（exec/alias/send/prefill/skill），离线探针显式跳过，由契约表与领域单测守护 |

## 明细

### `complete.path`

- 参数类型：`CompletePathParams`
- 结果类型：`CompletionItemsResult`
- 真实探针：跳过 —— 文件路径补全依赖活跃会话的 cwd 与工作区文件系统实时遍历，离线探针无有效 cwd，显式跳过，由契约表与 CDP 场景守护
- 调用点：
  - `packages/core/src/session/interactiveService.ts:248`

### `complete.slash`

- 参数类型：`CompleteSlashParams`
- 结果类型：`CompleteSlashResult`
- 真实探针：跳过 —— 斜杠实时补全需绑定活跃会话的 profile 与项目技能上下文，离线探针无会话可绑，显式跳过，由契约表与 CDP 场景守护
- 调用点：
  - `packages/core/src/session/interactiveService.ts:228`

### `image.attach_bytes`

- 参数类型：`ImageAttachBytesParams`
- 结果类型：`AttachedImageResult`
- 真实探针：跳过 —— 图片二进制字节附加通道需依赖在线活跃通道与图文模型，在离线探针下显式跳过，由契约表与 CDP 物理测试严格守护
- 调用点：
  - `packages/desktop/src/renderer/index.ts:3473`

### `prompt.background`

- 参数类型：`SideAgentParams`
- 结果类型：`TaskIdResult`
- 真实探针：跳过 —— 后台子代理旁路呼叫需活跃会话与跨 profile 计算宿主，应答经事件流异步到达，离线探针显式跳过，由契约表与路由单测守护
- 调用点：
  - `packages/desktop/src/renderer/index.ts:3676`

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
  - `packages/core/src/session/interactiveService.ts:107`
  - `packages/desktop/src/renderer/index.ts:3497`

### `slash.exec`

- 参数类型：`SlashExecParams`
- 结果类型：`SlashExecResult`
- 真实探针：跳过 —— 斜杠指令执行需活跃会话与在线命令分发器（exec/alias/send/prefill/skill），离线探针显式跳过，由契约表与领域单测守护
- 调用点：
  - `packages/core/src/session/interactiveService.ts:272`

