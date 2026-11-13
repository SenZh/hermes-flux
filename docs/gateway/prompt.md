# 对话提交与旁路

> 本文件由 `npm run contract:doc` 从网关契约、探针结果与源码调用点自动生成，请勿手工编辑。
> 契约快照：e3cf16a3d983… · 同步于 2026-11-12T09:29:35.736Z

| 方法 | 入参（契约） | 出参（契约） | 调用点 | 真实探针 |
| --- | --- | --- | --- | --- |
| `complete.path` | `profile` `word` `cwd` `session_id` | `items` | `packages/core/src/session/interactiveService.ts:251` | 跳过：文件路径补全依赖活跃会话的 cwd 与工作区文件系统实时遍历，离线探针无有效 cwd，显式跳过，由契约表与 CDP 场景守护 |
| `complete.slash` | `text` `session_id` `profile` | `items` `replace_from` | `packages/core/src/session/interactiveService.ts:231` | 跳过：斜杠实时补全需绑定活跃会话的 profile 与项目技能上下文，离线探针无会话可绑，显式跳过，由契约表与 CDP 场景守护 |
| `image.attach_bytes` | `session_id` `profile` `content_base64` `data` `filename` `ext` | `name` `width` `height` `token_estimate` `attached` `path` `count` `remainder` `text` `bytes` `message` | `packages/desktop/src/renderer/index.ts:5590` | 跳过：图片二进制字节附加通道需依赖在线活跃通道与图文模型，在离线探针下显式跳过，由契约表与 CDP 物理测试严格守护 |
| `prompt.background` | `session_id` `profile` `text` | `task_id` | `packages/desktop/src/renderer/index.ts:5940` | 跳过：后台子代理旁路呼叫需活跃会话与跨 profile 计算宿主，应答经事件流异步到达，离线探针显式跳过，由契约表与路由单测守护 |
| `prompt.btw` | `session_id` `profile` `text` | `task_id` | `packages/core/src/session/handoffService.ts:58` | ✅ 0.22.5 |
| `prompt.cancel` | `session_id` `admission_id` | `admission_id` `ref` `sequence` `status` `outcome` `authority_epoch` `execution_generation` | `packages/core/src/session/interactiveService.ts:314` | 跳过：未做真实网关验证：取消需要真实排队中的准入（仅在有在途回合时存在），离线探针造不出该状态，误传真实 admission_id 又会撤掉用户自己的排队消息；目前仅由本地参数构造单测与契约表守护 |
| `prompt.steer_queued` | `profile` `session_id` `admission_id` | `admission_id` `ref` `sequence` `status` `outcome` `authority_epoch` `execution_generation` | `packages/core/src/session/interactiveService.ts:340` | 跳过：未做真实网关验证：立即执行需要真实排队中的准入与在途回合，离线探针造不出该状态；目前仅由本地参数构造单测与契约表守护 |
| `prompt.submit` | `session_id` `profile` `text` `display_kind` `interrupted` `queued` `surface` `voice_context` `voice_turn` `title_preview` `truncate_before_user_ordinal` `truncate_before_row_id` `truncate_before_message_id` `confirm_truncate` `confirm_empty_truncate` `confirm_deep_truncate` `rebind_survivor_row_ids` `submission_id` `input_id` `attachments` `finite` `unattended` `turn_author` `api_text` `model_override` `clarify_batch` | `status` `voice_stopped` `user_row_id` `survivor_user_row_ids` `survivor_row_id_map` `turn_isolation` `admission_id` `forwarded` | `packages/core/src/session/interactiveService.ts:110`<br>`packages/desktop/src/renderer/index.ts:5614`<br>`packages/desktop/src/renderer/index.ts:5796` | ✅ 0.22.5 |
| `slash.exec` | `session_id` `command` `profile` | `output` `warning` `type` `target` `message` `notice` `display` `name` `status` | `packages/core/src/session/interactiveService.ts:275` | 跳过：斜杠指令执行需活跃会话与在线命令分发器（exec/alias/send/prefill/skill），离线探针显式跳过，由契约表与领域单测守护 |

## 明细

### `complete.path`

- 参数类型：`CompletePathParams`
- 结果类型：`CompletionItemsResult`
- 真实探针：跳过 —— 文件路径补全依赖活跃会话的 cwd 与工作区文件系统实时遍历，离线探针无有效 cwd，显式跳过，由契约表与 CDP 场景守护
- 调用点：
  - `packages/core/src/session/interactiveService.ts:251`

### `complete.slash`

- 参数类型：`CompleteSlashParams`
- 结果类型：`CompleteSlashResult`
- 真实探针：跳过 —— 斜杠实时补全需绑定活跃会话的 profile 与项目技能上下文，离线探针无会话可绑，显式跳过，由契约表与 CDP 场景守护
- 调用点：
  - `packages/core/src/session/interactiveService.ts:231`

### `image.attach_bytes`

- 参数类型：`ImageAttachBytesParams`
- 结果类型：`AttachedImageResult`
- 真实探针：跳过 —— 图片二进制字节附加通道需依赖在线活跃通道与图文模型，在离线探针下显式跳过，由契约表与 CDP 物理测试严格守护
- 调用点：
  - `packages/desktop/src/renderer/index.ts:5590`

### `prompt.background`

- 参数类型：`SideAgentParams`
- 结果类型：`TaskIdResult`
- 真实探针：跳过 —— 后台子代理旁路呼叫需活跃会话与跨 profile 计算宿主，应答经事件流异步到达，离线探针显式跳过，由契约表与路由单测守护
- 调用点：
  - `packages/desktop/src/renderer/index.ts:5940`

### `prompt.btw`

- 参数类型：`SideAgentParams`
- 结果类型：`TaskIdResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/session/handoffService.ts:58`

### `prompt.cancel`

- 参数类型：`PromptCancelParams`
- 结果类型：`AdmissionStatus`
- 真实探针：跳过 —— 未做真实网关验证：取消需要真实排队中的准入（仅在有在途回合时存在），离线探针造不出该状态，误传真实 admission_id 又会撤掉用户自己的排队消息；目前仅由本地参数构造单测与契约表守护
- 调用点：
  - `packages/core/src/session/interactiveService.ts:314`

### `prompt.steer_queued`

- 参数类型：`CanonicalSteerQueuedParams`
- 结果类型：`AdmissionStatus`
- 真实探针：跳过 —— 未做真实网关验证：立即执行需要真实排队中的准入与在途回合，离线探针造不出该状态；目前仅由本地参数构造单测与契约表守护
- 调用点：
  - `packages/core/src/session/interactiveService.ts:340`

### `prompt.submit`

- 参数类型：`PromptSubmitParams`
- 结果类型：`PromptSubmitResult`
- 真实探针：已通过（网关 0.22.5，录制于 2026-11-01T01:59:35.303Z）
- 调用点：
  - `packages/core/src/session/interactiveService.ts:110`
  - `packages/desktop/src/renderer/index.ts:5614`
  - `packages/desktop/src/renderer/index.ts:5796`

### `slash.exec`

- 参数类型：`SlashExecParams`
- 结果类型：`SlashExecResult`
- 真实探针：跳过 —— 斜杠指令执行需活跃会话与在线命令分发器（exec/alias/send/prefill/skill），离线探针显式跳过，由契约表与领域单测守护
- 调用点：
  - `packages/core/src/session/interactiveService.ts:275`

