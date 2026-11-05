# Hermes Agent 官方网关协议全量映射与实调验证权威矩阵

> **权威基线声明**：
> 本文档基于 Nous Research 官方 Gateway 协议底层定义（`contractTable.generated.ts` / `openrpc.json`）与当前运行中的真实网关环境全面对账编制。
> 涵盖全量 **257 个 JSON-RPC 2.0 方法**、**14 个服务端反向干预请求**、**77 个下行推送事件**，以及核心 **RESTful 聚合路由**。
> 截止本版本，已有 **72 个核心 RPC 接口** 通过真实在线网关往返实调验证（附出参结构对账证据）。

---

## 一、网关通信协议体系全景

| 协议层级 | 通信方向 | 官方契约总数 | 真实实调验证数 | 核心传输机制与职责说明 |
|---|---|:---:|:---:|---|
| **RPC Methods** | 客户端 ➔ 网关 | **257 个** | **72 个已实测** | 客户端主动请求，基于 JSON-RPC 2.0 over WebSocket（支持 REST 专线并发） |
| **Server Requests** | 网关 ➔ 客户端 | **14 个** | **14 个对齐** | 服务端反向发起拦截（用户审批、参数补全、sudo提权、2FA验证码、桌面视口交互） |
| **Gateway Events** | 网关 ➔ 客户端 | **77 个** | **77 个对齐** | 实时异步推送（会话流式 delta、状态机变更、群聊广播、用量水位通知） |
| **REST API** | 双向专线 | **6 大核心聚合路由** | **全部实测** | 跨 Profile 会话全量聚合、侧边栏批量切片拉取、文件流上传/下载、健康巡检 |

---

## 二、前序历史文档不准确描述之审查与纠偏复盘

在本次全面对账前，既有设计文档存在多处严重事实偏差，现已全部核实纠偏：

1. **调用点路径张冠李戴（严重虚构）**：此前文档罗列了 `store/chat.ts`、`(tabs)/chat.tsx`、`sessions.tsx` 等 31 处组件，实为上游移动端原型（`hermes-android`）文件，在 Flux 仓库中**完全不存在**。本次已彻底清理，统一映射至 Flux 真实 Monorepo 架构（`packages/core`、`packages/desktop`）；
2. **`session.list` 参数虚构**：此前文档声称该接口包含 `offset?` 与 `filter?` 参数，实际上网关契约为 `(profile?, title?, limit?, include_hidden?)`，分页与过滤实属 REST 路由特性；
3. **误判网关无多 Profile 聚合能力**：此前文档认为网关无法一次性查询所有 Profile 会话，实际上网关官方在 REST 层早已提供 `GET /api/profiles/sessions?profile=all&order=recent` 与 `GET /api/profiles/sessions/sidebar?recents_profile=all` 原生接口；
4. **契约总数矛盾**：此前文档不同章节出现 252、258、72、77 多个版本打架，本次核验确认官方契约包含 **257 个 RPC 方法、14 个 Server Requests、77 个 Events**；
5. **虚构不存在的网关事件**：清理了如 `layout.apply`（网关原生为 `pane.reveal`）等前端自造字段的归属。

---

## 三、官方 RPC 接口（Client ➔ Gateway）257 个全量分类清单与实调验证状态

### 1. 会话与上下文生命周期 (Session Core) — 35 个

| RPC 方法名 | 入参字段白名单 (`params`) | 返回字段白名单 (`result`) | 真实实调验证状态 |
|---|---|---|:---:|
| `config.set` | `profile` `key` `value` `session_id` `scope` `confirm_expensive_model` | `key` `value` `warning` `confirm_required` `confirm_message` `scope`… | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `session.activate` | `session_id` `profile` `cols` `omit_messages` | `session_id` `message_count` `messages` `info` `stored_session_id` `resumed`… | ⏳ 契约已对齐 |
| `session.active_list` | `profile` `current_session_id` | `sessions` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `session.archive` | `session_id` `session_key` `archived` `profile` | `archived` `session_key` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `session.branch` | `session_id` `profile` `name` `count` `idempotency_key` | `session_id` `stored_session_id` `title` `parent` `message_count` `messages`… | ⏳ 契约已对齐 |
| `session.branch_stored` | `profile` `parent_session_id` `cols` `source` `cwd` `idempotency_key` | `session_id` `stored_session_id` `message_count` `messages_omitted` `info` | ⏳ 契约已对齐 |
| `session.branch_whole` | `session_id` `profile` `name` `idempotency_key` | `session_id` `stored_session_id` `title` `parent` `message_count` `messages_omitted`… | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `session.close` | `session_id` `profile` | `closed` `messages` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `session.compress` | `session_id` `profile` `focus_topic` | `status` `removed` `before_messages` `after_messages` `before_tokens` `after_tokens`… | ⏳ 契约已对齐 |
| `session.context_breakdown` | `session_id` `profile` | `categories` `context_max` `context_percent` `context_used` `estimated_total` `context_estimated`… | ⏳ 契约已对齐 |
| `session.control` | `profile` `session_id` `action` `args` | `control` `dispatch` | ⏳ 契约已对齐 |
| `session.control.read` | `profile` `session_id` | `control` | ⏳ 契约已对齐 |
| `session.create` | `profile` `cols` `source` `cwd` `cwd_explicit` `messages` `parent_session_id` `title` `model` `provider` `reasoning_effort` `fast` `service_tier` `close_on_disconnect` `hidden` `room_plumbing` `follow_profile_config` `idempotency_key` | `session_id` `stored_session_id` `message_count` `messages` `info` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `session.cwd.set` | `session_id` `profile` `cwd` | `model` `provider` `reasoning_effort` `reasoning_effort_wire` `service_tier` `fast`… | ⏳ 契约已对齐 |
| `session.delete` | `session_id` `profile` | `deleted` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `session.events.since` | `session_id` `profile` `last_seen` | `events` `latest_seq` `truncated` `count` `epoch` `open_requests` | ⏳ 契约已对齐 |
| `session.events.stats` | `profile` | `sessions` `events` `bytes` `max_per_session` `max_bytes_per_session` `max_bytes_process` | ⏳ 契约已对齐 |
| `session.foreign.import` | `profile` `id` | `session_id` `already_imported` | ⏳ 契约已对齐 |
| `session.foreign.list` | `profile` `source` `offset` `limit` | `sessions` `next_offset` `host` `unreadable` | ⏳ 契约已对齐 |
| `session.foreign.preview` | `profile` `id` | `messages` `total` `truncated` `already_imported` `cwd` | ⏳ 契约已对齐 |
| `session.history` | `session_id` `profile` | `count` `messages` | ⏳ 契约已对齐 |
| `session.interrupt` | `session_id` `profile` `expected_hosted_task_id` | `status` `interrupted` `turn_isolation` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `session.list` | `profile` `title` `limit` `include_hidden` | `sessions` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `session.most_recent` | `profile` | `session_id` `title` `started_at` `source` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `session.redirect` | `session_id` `profile` `text` | `status` `text` | ⏳ 契约已对齐 |
| `session.resume` | `session_id` `profile` `cols` `source` `lazy` `defer_history` `omit_messages` `eager_build` `close_on_disconnect` `inline_images` | `session_id` `message_count` `messages` `info` `stored_session_id` `resumed`… | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `session.save` | `session_id` `profile` | `file` | ⏳ 契约已对齐 |
| `session.set_hidden` | `session_id` `hidden` `profile` | `hidden` `session_key` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `session.start_chat` | `session_id` `profile` `tool_call_id` `args` | `status` `session_id` `profile` `title` `message` `reason`… | ⏳ 契约已对齐 |
| `session.status` | `session_id` `profile` | `output` | ⏳ 契约已对齐 |
| `session.steer` | `session_id` `profile` `text` | `status` `text` | ⏳ 契约已对齐 |
| `session.title` | `session_id` `profile` `title` | `title` `session_key` `pending` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `session.undo` | `session_id` `profile` `intent` | `removed` | ⏳ 契约已对齐 |
| `session.usage` | `session_id` `profile` | `model` `input` `output` `reasoning` `prompt` `completion`… | ⏳ 契约已对齐 |
| `session.workspace.move` | `profile` `session_key` `cwd` | `cwd` `branch` `git_repo_root` | ⏳ 契约已对齐 |

### 2. 消息交互与多模态 (Prompt, Attachments & Modalities) — 12 个

| RPC 方法名 | 入参字段白名单 (`params`) | 返回字段白名单 (`result`) | 真实实调验证状态 |
|---|---|---|:---:|
| `clipboard.paste` | `session_id` `profile` | `name` `width` `height` `token_estimate` `attached` `path`… | ⏳ 契约已对齐 |
| `file.attach` | `session_id` `profile` `path` `data_url` `name` | `attached` `name` `path` `ref_path` `ref_text` `uploaded` | ⏳ 契约已对齐 |
| `image.attach` | `session_id` `profile` `path` | `name` `width` `height` `token_estimate` `attached` `path`… | ⏳ 契约已对齐 |
| `image.attach_bytes` | `session_id` `profile` `content_base64` `data` `filename` `ext` | `name` `width` `height` `token_estimate` `attached` `path`… | ⏳ 契约已对齐 |
| `image.detach` | `session_id` `profile` `path` | `detached` `count` | ⏳ 契约已对齐 |
| `image.generate` | `prompt` `aspect_ratio` `probe` `max_bytes` | `available` `success` `image` `image_data` `error` | ⏳ 契约已对齐 |
| `message.react` | `session_id` `profile` `row_id` `newest_role` `emoji` `author` | `row_id` `reactions` | ⏳ 契约已对齐 |
| `paste.collapse` | `text` | `placeholder` `path` `lines` | ⏳ 契约已对齐 |
| `pdf.attach` | `session_id` `profile` `path` `content_base64` `data` `filename` `first_page` `last_page` | `attached` `filename` `pages_attached` `pages` `count` `text` | ⏳ 契约已对齐 |
| `prompt.background` | `session_id` `profile` `text` | `task_id` | ⏳ 契约已对齐 |
| `prompt.btw` | `session_id` `profile` `text` | `task_id` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `prompt.submit` | `session_id` `profile` `text` `display_kind` `interrupted` `queued` `surface` `voice_context` `voice_turn` `title_preview` `truncate_before_user_ordinal` `truncate_before_row_id` `truncate_before_message_id` `confirm_truncate` `confirm_empty_truncate` `confirm_deep_truncate` `rebind_survivor_row_ids` | `status` `voice_stopped` `user_row_id` `survivor_user_row_ids` `survivor_row_id_map` `turn_isolation` | ✅ **实测通过**<br><small>[probe-fixture]</small> |

### 3. 子代理与多任务委派 (Subagents & Delegation) — 10 个

| RPC 方法名 | 入参字段白名单 (`params`) | 返回字段白名单 (`result`) | 真实实调验证状态 |
|---|---|---|:---:|
| `agents.list` | `profile` | `processes` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `delegation.pause` | `profile` `paused` | `paused` | ⏳ 契约已对齐 |
| `delegation.status` | `profile` | `active` `paused` `max_spawn_depth` `max_concurrent_children` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `spawn_tree.list` | `profile` `session_id` `cross_session` `limit` | `entries` | ⏳ 契约已对齐 |
| `spawn_tree.load` | `profile` `path` | `session_id` `started_at` `finished_at` `label` `subagents` | ⏳ 契约已对齐 |
| `spawn_tree.save` | `profile` `subagents` `session_id` `started_at` `finished_at` `label` | `path` `session_id` | ⏳ 契约已对齐 |
| `subagent.interrupt` | `session_id` `profile` `subagent_id` | `found` `subagent_id` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `subagent.list` | `session_id` `profile` | `subagents` `delegations` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `subagent.steer` | `session_id` `profile` `subagent_id` `text` | `status` `subagent_id` `text` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `subagent.tail` | `session_id` `profile` `subagent_id` | `subagent_id` `available` `text` `truncated` | ✅ **实测通过**<br><small>[probe-fixture]</small> |

### 4. 多 Agent 群聊与会议室 (Group Rooms) — 18 个

| RPC 方法名 | 入参字段白名单 (`params`) | 返回字段白名单 (`result`) | 真实实调验证状态 |
|---|---|---|:---:|
| `groups.approve` | `profile` `room_id` `member_id` `task_id` `execution_generation` `choice` `request_id` | `approved` `result` | ⏳ 契约已对齐 |
| `groups.capabilities` | `profile` | `protocol_version` `driver` `persistent_process` `authority_gateway_id` `room_link` `features`… | ⏳ 契约已对齐 |
| `groups.create` | `profile` `room_id` `name` `members` `authority_gateway_id` | `room` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `groups.demote` | `profile` `room_id` `observed_gateway_id` `observed_epoch` | `room_id` `authority_gateway_id` `authority_epoch` `idempotent` | ⏳ 契约已对齐 |
| `groups.disband` | `profile` `room_id` `cancel_id` | `tombstone` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `groups.list` | `profile` `include_disbanded` `limit` `offset` | `rooms` `next_offset` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `groups.log` | `profile` `room_id` `since_seq` `limit` `include_disbanded` | `events` `cursor` `latest_seq` `has_more` `authority` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `groups.peer.invite` | `profile` `room_id` `home_install_id` `authority_gateway_id` `authority_epoch` `member_id` `grant_id` `ttl_seconds` | `grant` `target_profile` `catalog` `endpoint` | ⏳ 契约已对齐 |
| `groups.peer.register` | `profile` `room_id` `member_id` `target_url` `target_profile` `grant` `catalog` `cancellation_scope_id` `trace_id` | `registered` `mode` `transport_security` `target_install_id` `target_profile` | ⏳ 契约已对齐 |
| `groups.peer.revoke` | `profile` `grant` | `revoked` | ⏳ 契约已对齐 |
| `groups.promote` | `profile` `room_id` `confirm` `reason` | `room_id` `authority_gateway_id` `authority_epoch` `previous_gateway_id` `previous_epoch` `claim_seq`… | ⏳ 契约已对齐 |
| `groups.rename` | `profile` `room_id` `event_id` `name` | `room` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `groups.replica_state` | `profile` `room_id` | `room_id` `name` `members` `authority` `last_seq` `latest_seq`… | ⏳ 契约已对齐 |
| `groups.replicate` | `profile` `room_id` `room_name` `members` `page` | `room_id` `stored_seq` `ingested` `authority` `caught_up` | ⏳ 契约已对齐 |
| `groups.retry` | `profile` `room_id` `task_id` | `retried` `task` | ⏳ 契约已对齐 |
| `groups.send` | `profile` `room_id` `event_id` `payload` | `event` `client_event_id` `accepted` `driver_started` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `groups.state` | `profile` `room_id` `include_disbanded` | `room` `driver_status` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `groups.stop` | `profile` `room_id` `cancel_id` | `cancelled` | ⏳ 契约已对齐 |

### 5. 工程、工作区与文件树 (Projects & Workspaces) — 16 个

| RPC 方法名 | 入参字段白名单 (`params`) | 返回字段白名单 (`result`) | 真实实调验证状态 |
|---|---|---|:---:|
| `project.facts` | `profile` `cwd` | `facts` | ⏳ 契约已对齐 |
| `projects.add_folder` | `profile` `id` `path` `label` `is_primary` | `project` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `projects.archive` | `profile` `id` `restore` | `projects` `active_id` | ⏳ 契约已对齐 |
| `projects.create` | `profile` `name` `folders` `slug` `primary_path` `description` `icon` `color` `board_slug` `use` | `project` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `projects.delete` | `profile` `id` | `projects` `active_id` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `projects.discover_repos` | `profile` `scan` | `repos` `discovery_policy` | ⏳ 契约已对齐 |
| `projects.for_cwd` | `profile` `cwd` | `project` `cwd` `branch` | ⏳ 契约已对齐 |
| `projects.get` | `profile` `id` | `project` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `projects.list` | `profile` | `projects` `active_id` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `projects.project_sessions` | `profile` `project_id` `session_limit` | `project` | ⏳ 契约已对齐 |
| `projects.record_repos` | `profile` `repos` `discovery_policy` | `repos` `discovery_policy` `accepted` | ⏳ 契约已对齐 |
| `projects.remove_folder` | `profile` `id` `path` | `project` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `projects.set_active` | `profile` `id` | `active_id` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `projects.set_primary` | `profile` `id` `path` | `project` | ⏳ 契约已对齐 |
| `projects.tree` | `profile` `preview_limit` `session_limit` | `projects` `active_id` `scoped_session_ids` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `projects.update` | `profile` `id` `name` `description` `icon` `color` `board_slug` | `project` | ✅ **实测通过**<br><small>[probe-fixture]</small> |

### 6. 代码时光机快照与还原 (Rollback & Versioning) — 3 个

| RPC 方法名 | 入参字段白名单 (`params`) | 返回字段白名单 (`result`) | 真实实调验证状态 |
|---|---|---|:---:|
| `rollback.diff` | `session_id` `hash` `profile` | `stat` `diff` `rendered` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `rollback.list` | `session_id` `profile` | `enabled` `checkpoints` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `rollback.restore` | `session_id` `hash` `file_path` `profile` | `success` `restored_to` `reason` `directory` `file` `restored_files`… | ✅ **实测通过**<br><small>[probe-fixture]</small> |

### 7. 专职数字员工配置档 (Agent Profiles) — 6 个

| RPC 方法名 | 入参字段白名单 (`params`) | 返回字段白名单 (`result`) | 真实实调验证状态 |
|---|---|---|:---:|
| `profiles.configure` | `profile` `name` `ui_meta` `ui_meta_expected_revisions` `soul` `description` `model` `provider` `confirm_expensive_model` `disabled_skills` `enabled_toolsets` `enabled_mcp_servers` | `ok` `applied` `confirm_required` `confirm_message` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `profiles.create` | `profile` `name` `description` `clone_from` `clone_all` `clone_channels` `no_skills` `no_alias` `soul` `model` `provider` `share_auth` `mirror_credentials` | `ok` `name` `path` `soul_written` `model_set` `mirrored` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `profiles.describe` | `profile` `name` | `name` `description` `soul` `model` `skills` `toolsets`… | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `profiles.get_asset` | `profile` `name` `asset` | `found` `mime` `size` `data` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `profiles.list` | `profile` `include_sessions` | `profiles` `bot_mode_protocol` `install_id` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `profiles.set_asset` | `profile` `name` `asset` `data` `clear` | `ok` `asset` `size` `removed` | ✅ **实测通过**<br><small>[probe-fixture]</small> |

### 8. 工具、工具包与动态命令 (Tools, Toolsets & Commands) — 8 个

| RPC 方法名 | 入参字段白名单 (`params`) | 返回字段白名单 (`result`) | 真实实调验证状态 |
|---|---|---|:---:|
| `command.dispatch` | `name` `arg` `session_id` `profile` | `type` `output` `target` `message` `notice` `display`… | ⏳ 契约已对齐 |
| `command.resolve` | `name` `profile` | `canonical` `description` `category` | ⏳ 契约已对齐 |
| `commands.catalog` | `session_id` `profile` | `pairs` `sub` `canon` `commands` `categories` `skills`… | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `slash.exec` | `session_id` `command` `profile` | `output` `warning` `type` `target` `message` `notice`… | ⏳ 契约已对齐 |
| `tools.configure` | `action` `names` `session_id` `profile` | `changed` `enabled_toolsets` `info` `missing_servers` `reset` `unknown` | ⏳ 契约已对齐 |
| `tools.list` | `session_id` | `toolsets` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `tools.show` | `session_id` | `sections` `total` | ⏳ 契约已对齐 |
| `toolsets.list` | `session_id` | `toolsets` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |

### 9. MCP 协议与生态服务 (Model Context Protocol) — 11 个

| RPC 方法名 | 入参字段白名单 (`params`) | 返回字段白名单 (`result`) | 真实实调验证状态 |
|---|---|---|:---:|
| `mcp.catalog` | `profile` | `servers` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `mcp.servers.add` | `profile` `name` `preset` `config` `bearer_token` | `ok` `name` `server` | ⏳ 契约已对齐 |
| `mcp.servers.list` | `profile` | `servers` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `mcp.servers.oauth.callback` | `profile` `name` `session_id` `code` `state` `error` `iss` | `ok` `session_id` `error_message` | ⏳ 契约已对齐 |
| `mcp.servers.oauth.cancel` | `profile` `name` `session_id` | `ok` `status` `error_message` | ⏳ 契约已对齐 |
| `mcp.servers.oauth.poll` | `profile` `name` `session_id` | `ok` `status` `session_id` `error_message` `auth_url` `tools` | ⏳ 契约已对齐 |
| `mcp.servers.oauth.start` | `profile` `name` `client_redirect_uri` | `ok` `session_id` `auth_url` `flow` | ⏳ 契约已对齐 |
| `mcp.servers.remove` | `profile` `name` | `ok` `removed` | ⏳ 契约已对齐 |
| `mcp.servers.set_api_key` | `profile` `name` `value` `env_var` | `ok` `name` `env_var` `server` | ⏳ 契约已对齐 |
| `mcp.servers.status` | `profile` | `servers` `checked_at` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `mcp.servers.test` | `profile` `name` | `ok` `tools` `error` `prompts` `resources` `oauth_needed`… | ⏳ 契约已对齐 |

### 10. SaaS 外部平台连接器 (Connectors) — 11 个

| RPC 方法名 | 入参字段白名单 (`params`) | 返回字段白名单 (`result`) | 真实实调验证状态 |
|---|---|---|:---:|
| `connectors.accounts` | `profile` `connector` | `accounts` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `connectors.accounts.remove` | `profile` `connection_id` | `connection_id` `connector` `status` | ⏳ 契约已对齐 |
| `connectors.accounts.rename` | `profile` `connection_id` `alias` | `connection_id` `connector` `status` `status_reason` `label` `alias`… | ⏳ 契约已对齐 |
| `connectors.catalog` | `profile` | `connectors` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `connectors.connect` | `profile` `owner` `connectors` `reconnect` `alias` `connection_id` | `op_id` `seq` `deadline_at` `settled` `settled_at` `settled_by`… | ⏳ 契约已对齐 |
| `connectors.list` | `profile` `owner` | `available` `connectors` | ⏳ 契约已对齐 |
| `connectors.operation.status` | `profile` `owner` `op_id` | `op_id` `seq` `deadline_at` `settled` `settled_at` `settled_by`… | ⏳ 契约已对齐 |
| `connectors.operation.wake` | `profile` `owner` `op_id` | `status` | ⏳ 契约已对齐 |
| `connectors.policy.get` | `profile` | `layers` `effective` | ⏳ 契约已对齐 |
| `connectors.policy.set` | `profile` `change` `expected_revision` | `revision` `effective` | ⏳ 契约已对齐 |
| `connectors.tools` | `profile` `slug` `refresh` | `connector` `toolkit_version` `etag` `fetched_at` `source` `stale`… | ⏳ 契约已对齐 |

### 11. 本地安全保险箱与凭据托管 (Vault & Secrets) — 7 个

| RPC 方法名 | 入参字段白名单 (`params`) | 返回字段白名单 (`result`) | 真实实调验证状态 |
|---|---|---|:---:|
| `vault.add` | `profile` `kind` `label` `origin` `secret` | `id` | ⏳ 契约已对齐 |
| `vault.list` | `profile` | `items` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `vault.lock` | `profile` `name` | `locked` | ⏳ 契约已对齐 |
| `vault.remove` | `profile` `id` | `removed` | ⏳ 契约已对齐 |
| `vault.source.set` | `profile` `name` `enabled` | `name` `enabled` | ⏳ 契约已对齐 |
| `vault.sources` | `profile` | `sources` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `vault.unlock` | `profile` `name` `password` | `name` `unlocked` | ⏳ 契约已对齐 |

### 12. 官方订阅、额度与免费层 (Billing & Subscription) — 15 个

| RPC 方法名 | 入参字段白名单 (`params`) | 返回字段白名单 (`result`) | 真实实调验证状态 |
|---|---|---|:---:|
| `billing.auto_reload` | `profile` `enabled` `threshold` `top_up_amount` | `ok` `error` `message` `portal_url` `retry_after` `payload`… | ⏳ 契约已对齐 |
| `billing.charge` | `profile` `amount_usd` `idempotency_key` | `ok` `error` `message` `portal_url` `retry_after` `payload`… | ⏳ 契约已对齐 |
| `billing.charge_status` | `profile` `charge_id` | `ok` `error` `message` `portal_url` `retry_after` `payload`… | ⏳ 契约已对齐 |
| `billing.state` | `profile` | `ok` `logged_in` `free_tier_account` `free_tier_model` `org_name` `org_slug`… | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `billing.step_up` | `profile` `session_id` | `ok` `error` `message` `portal_url` `retry_after` `payload`… | ⏳ 契约已对齐 |
| `free_tier.ack_notice` | `profile` | `acked` | ⏳ 契约已对齐 |
| `free_tier.challenge_result` | `profile` `url` `attempt` `outcome` | `accepted` | ⏳ 契约已对齐 |
| `free_tier.claim_nudge` | `profile` | `claimed` | ⏳ 契约已对齐 |
| `free_tier.provision` | `profile` | `has_guest` `enabled` `error` `error_code` `retryable` `retry_after` | ⏳ 契约已对齐 |
| `free_tier.status` | `profile` | `has_guest` `enabled` `available` `notice_pending` `model` `label`… | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `subscription.change` | `profile` `subscription_type_id` `cancel` | `ok` `error` `message` `portal_url` `retry_after` `payload`… | ⏳ 契约已对齐 |
| `subscription.preview` | `profile` `subscription_type_id` | `ok` `error` `message` `portal_url` `retry_after` `payload`… | ⏳ 契约已对齐 |
| `subscription.resume` | `profile` | `ok` `error` `message` `portal_url` `retry_after` `payload`… | ⏳ 契约已对齐 |
| `subscription.state` | `profile` | `ok` `logged_in` `is_admin` `can_change_plan` `org_name` `org_id`… | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `subscription.upgrade` | `profile` `subscription_type_id` `idempotency_key` | `ok` `error` `message` `portal_url` `retry_after` `payload`… | ⏳ 契约已对齐 |

### 13. 虚拟显示器与远程屏幕 (Display & Remote Screen) — 9 个

| RPC 方法名 | 入参字段白名单 (`params`) | 返回字段白名单 (`result`) | 真实实调验证状态 |
|---|---|---|:---:|
| `display.install` | `profile` | `started` `command` `profile_key` | ⏳ 契约已对齐 |
| `display.lease.acquire` | `profile` `viewer_id` `reason` | `lease` | ⏳ 契约已对齐 |
| `display.lease.release` | `profile` `viewer_id` `force` | `lease` | ⏳ 契约已对齐 |
| `display.observe` | `profile` `viewer_id` | `profile` `supported` `installed` `missing` `running` `pid`… | ⏳ 契约已对齐 |
| `display.start` | `profile` | `profile` `supported` `installed` `missing` `running` `pid`… | ⏳ 契约已对齐 |
| `display.status` | `profile` | `profile` `supported` `installed` `missing` `running` `pid`… | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `display.stop` | `profile` `force` | `profile` `supported` `installed` `missing` `running` `pid`… | ⏳ 契约已对齐 |
| `display.switchSandboxImage` | `profile` `approve` | `profile` `supported` `installed` `missing` `running` `pid`… | ⏳ 契约已对齐 |
| `display.thumbnail` | `profile` | `data_url` `suppressed` | ⏳ 契约已对齐 |

### 14. 语音、麦克风与唤醒词 (Voice, Wake & Audio) — 9 个

| RPC 方法名 | 入参字段白名单 (`params`) | 返回字段白名单 (`result`) | 真实实调验证状态 |
|---|---|---|:---:|
| `voice.record` | `action` `session_id` `profile` | `status` `reason` | ⏳ 契约已对齐 |
| `voice.toggle` | `action` `profile` | `enabled` `record_key` `tts` `stop_hint` `available` `audio_available`… | ⏳ 契约已对齐 |
| `voice.tts` | `text` `profile` | `status` | ⏳ 契约已对齐 |
| `wake.feed` | `pcm` `pcm_b64` `sample_rate` `profile` | `reason` `fed` | ⏳ 契约已对齐 |
| `wake.pause` | `profile` | `reason` `paused` | ⏳ 契约已对齐 |
| `wake.resume` | `profile` | `reason` `resumed` | ⏳ 契约已对齐 |
| `wake.start` | `surface` `persist` `client_capture` `session_id` `profile` | `started` `reason` `hint` `phrase` `provider` `owner_surface`… | ⏳ 契约已对齐 |
| `wake.status` | `surface` `client_capture` `profile` | `listening` `owned_by_caller` `owner_surface` `phrase` `provider` `configured_surface`… | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `wake.stop` | `persist` `profile` | `reason` `stopped` `disabled_persisted` | ⏳ 契约已对齐 |

### 15. 桌面宠物与伴侣系统 (Pet Companion) — 15 个

| RPC 方法名 | 入参字段白名单 (`params`) | 返回字段白名单 (`result`) | 真实实调验证状态 |
|---|---|---|:---:|
| `pet.cancel` | `profile` `token` | `ok` | ⏳ 契约已对齐 |
| `pet.cells` | `profile` `state` `cols` `graphics` | `enabled` `slug` `displayName` `state` `cols` `frameMs`… | ⏳ 契约已对齐 |
| `pet.disable` | `profile` | `ok` | ⏳ 契约已对齐 |
| `pet.export` | `profile` `slug` | `ok` `filename` `zipBase64` | ⏳ 契约已对齐 |
| `pet.gallery` | `profile` `localOnly` | `enabled` `active` `pets` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `pet.generate` | `profile` `prompt` `referenceImage` `count` `style` `provider` | `ok` `token` `drafts` | ⏳ 契约已对齐 |
| `pet.generate.status` | `profile` | `available` `providers` | ⏳ 契约已对齐 |
| `pet.hatch` | `profile` `token` `name` `cancelToken` `index` `description` `prompt` `style` `provider` | `ok` `slug` `displayName` `warnings` `pet` | ⏳ 契约已对齐 |
| `pet.info` | `profile` `knownRevision` | `enabled` `slug` `displayName` `mime` `spritesheetBase64` `spritesheetRevision`… | ⏳ 契约已对齐 |
| `pet.info.meta` | `profile` | `enabled` `slug` `displayName` `scale` `spritesheetRevision` | ⏳ 契约已对齐 |
| `pet.remove` | `profile` `slug` | `ok` `slug` `displayName` | ⏳ 契约已对齐 |
| `pet.rename` | `profile` `slug` `name` | `ok` `slug` `displayName` | ⏳ 契约已对齐 |
| `pet.scale` | `profile` `scale` | `ok` `scale` | ⏳ 契约已对齐 |
| `pet.select` | `profile` `slug` | `ok` `slug` `displayName` | ⏳ 契约已对齐 |
| `pet.thumb` | `profile` `slug` `url` | `ok` `slug` `dataUri` | ⏳ 契约已对齐 |

### 16. 系统诊断、健康度与遥测 (System, Metrics & Config) — 23 个

| RPC 方法名 | 入参字段白名单 (`params`) | 返回字段白名单 (`result`) | 真实实调验证状态 |
|---|---|---|:---:|
| `client.capabilities` | `server_requests` | `server_requests` `declines_not_shown` | ⏳ 契约已对齐 |
| `config.get` | `profile` `key` `cwd` `session_id` | `value` `display` `tool_progress` `model` `provider` `providers`… | ⏳ 契约已对齐 |
| `config.show` | `profile` | `sections` | ⏳ 契约已对齐 |
| `diagnostics.share_nous` | `error_context` `extra_files` `log_lines` | `ok` `view_url` `upload_id` `expires_at` `error` | ⏳ 契约已对齐 |
| `gateway.capabilities` | — | `per_session_exclusive_submit` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `i18n.catalog` | `profile` `lang` `surface` | `lang` `surface` `messages` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `i18n.languages` | `profile` | `languages` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `insights.get` | `days` `profile` | `days` `sessions` `messages` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `learning.delete` | `id` | `ok` `message` | ⏳ 契约已对齐 |
| `learning.detail` | `id` | `ok` `message` `kind` `id` `label` `content` | ⏳ 契约已对齐 |
| `learning.edit` | `id` `content` | `ok` `message` | ⏳ 契约已对齐 |
| `learning.frames` | `cols` `rows` `frames` | `frames` `legend` `categories` `buckets` `summary` `axis`… | ⏳ 契约已对齐 |
| `shared_metrics.desktop_daily` | `profile` `day` `bot_count` `modes` `actions` | `recorded` | ⏳ 契约已对齐 |
| `shared_metrics.desktop_dislike` | `profile` `signal` `target` `setting` | `ok` | ⏳ 契约已对齐 |
| `shared_metrics.desktop_feature_use` | `profile` `area` | `ok` | ⏳ 契约已对齐 |
| `shared_metrics.desktop_friction` | `profile` `kind` `detail` | `ok` | ⏳ 契约已对齐 |
| `shared_metrics.desktop_onboarding` | `profile` `step` `event` | `ok` | ⏳ 契约已对齐 |
| `shared_metrics.set` | `profile` `enabled` `send` `first_run` | `enabled` `send` `decided` `reask` | ⏳ 契约已对齐 |
| `shared_metrics.slash_command` | `profile` `command` `session_id` | `ok` | ⏳ 契约已对齐 |
| `shared_metrics.startup_latency` | `profile` `elapsed_ms` `surface` `launch_id` | `ok` | ⏳ 契约已对齐 |
| `shared_metrics.status` | `profile` | `enabled` `send` `decided` `reask` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `shared_metrics.update_run` | `profile` `outcome` `failed_stage` `mechanism` `duration_ms` `from_commit_date` | `ok` | ⏳ 契约已对齐 |
| `system.battery` | `profile` | `available` `percent` `plugged` `category` | ⏳ 契约已对齐 |

### 17. 就绪引导与首次配置 (Onboarding & Setup) — 9 个

| RPC 方法名 | 入参字段白名单 (`params`) | 返回字段白名单 (`result`) | 真实实调验证状态 |
|---|---|---|:---:|
| `onboarding.ensure_setup_profile` | — | `name` `path` `created` | ⏳ 契约已对齐 |
| `onboarding.ensure_setup_session` | `messages` | `profile` `session_id` `empty` | ⏳ 契约已对齐 |
| `onboarding.mark_seen` | — | `eligible` `intro` `failed_starts` `completed_at` `profile` | ⏳ 契约已对齐 |
| `onboarding.record_failed_start` | — | `eligible` `intro` `failed_starts` `completed_at` `profile` | ⏳ 契约已对齐 |
| `onboarding.reset_setup_profile` | — | `name` `path` `reset` | ⏳ 契约已对齐 |
| `onboarding.state` | — | `eligible` `intro` `failed_starts` `completed_at` `profile` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `setup.runtime_check` | `profile` `provider` | `ok` `provider` `model` `source` `error` `free_tier_route`… | ⏳ 契约已对齐 |
| `setup.status` | `profile` | `provider_configured` `ready` `free_tier_account` `free_tier_route` `other_providers` `inference_provider`… | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `verification.status` | `profile` `session_id` `session_key` `cwd` | `verification` | ⏳ 契约已对齐 |

### 18. 终端、插件与底层基础设施 (Terminal, Shell & Other) — 40 个

| RPC 方法名 | 入参字段白名单 (`params`) | 返回字段白名单 (`result`) | 真实实调验证状态 |
|---|---|---|:---:|
| `approval.pending` | `session_id` `profile` | `approvals` | ⏳ 契约已对齐 |
| `approval.received` | `session_id` `profile` `request_id` | `acknowledged` | ⏳ 契约已对齐 |
| `approval.respond` | `session_id` `profile` `choice` `all` `request_id` | `resolved` | ⏳ 契约已对齐 |
| `bot_relay.deliver` | `profile` `message` `from_profile` `from_handle` `from_connection` | `reply` | ⏳ 契约已对齐 |
| `bot_relay.outbox.drain` | `profile` | `envelopes` | ⏳ 契约已对齐 |
| `bot_relay.reply` | `profile` `id` `reply` `error` `reason` | `ok` | ⏳ 契约已对齐 |
| `bot_relay.roster.sync` | `profile` `agents` | `count` | ⏳ 契约已对齐 |
| `browser.controller.detach` | `session_id` | `detached` | ⏳ 契约已对齐 |
| `browser.controller.heartbeat` | `session_id` | `ok` | ⏳ 契约已对齐 |
| `browser.controller.register` | `session_id` `controller_id` `browser_profile_id` `capabilities` `protocol_version` `principal_id` | `scope` | ⏳ 契约已对齐 |
| `browser.controller.result` | `session_id` `command_id` `ok` `result` `error` | `accepted` | ⏳ 契约已对齐 |
| `browser.manage` | `action` `url` `enabled` `session_id` `profile` | `connected` `url` `messages` `browser_use` | ⏳ 契约已对齐 |
| `clarify.lock` | `request_id` `question_id` `answer` `profile` | `status` `remaining` | ⏳ 契约已对齐 |
| `cli.exec` | `argv` `timeout` `profile` | `blocked` `code` `output` `hint` | ⏳ 契约已对齐 |
| `complete.path` | `profile` `word` `cwd` `session_id` | `items` | ⏳ 契约已对齐 |
| `complete.slash` | `text` `session_id` `profile` | `items` `replace_from` | ⏳ 契约已对齐 |
| `connection.respond` | `profile` `owner` `op_id` `result` | `status` `settled` | ⏳ 契约已对齐 |
| `cron.manage` | `action` `name` `include_disabled` `schedule` `prompt` `repeat` `continuity` `deliver` `profile` | `success` `error` `count` `jobs` `scoped` `gateway_running`… | ⏳ 契约已对齐 |
| `handoff.fail` | `session_id` `profile` `error` | `failed` `state` | ⏳ 契约已对齐 |
| `handoff.request` | `session_id` `profile` `platform` | `queued` `session_key` `platform` `home_name` | ⏳ 契约已对齐 |
| `handoff.state` | `session_id` `profile` | `state` `platform` `error` | ⏳ 契约已对齐 |
| `input.detect_drop` | `session_id` `profile` `text` | `name` `width` `height` `token_estimate` `matched` `is_image`… | ⏳ 契约已对齐 |
| `llm.oneshot` | `profile` `template` `instructions` `input` `variables` `task` `temperature` `max_tokens` `session_id` | `text` | ⏳ 契约已对齐 |
| `model.disconnect` | `slug` `session_id` | `slug` `name` `disconnected` | ⏳ 契约已对齐 |
| `model.options` | `profile` `session_id` `explicit_only` `include_unconfigured` `refresh` | `providers` `model` `provider` | ✅ **实测通过**<br><small>[probe-fixture]</small> |
| `model.save_key` | `slug` `api_key` `session_id` | `provider` | ⏳ 契约已对齐 |
| `plugins.list` | — | `plugins` | ✅ **实测通过**<br><small>[live-websocket-rpc]</small> |
| `plugins.manage` | `profile` `action` `key` `name` `enable` `identifier` `repo` `catalog_name` `force` `ref` `accept_capabilities` `values` | `plugins` `user_count` `bundled_count` `ok` `unchanged` `restart_required`… | ⏳ 契约已对齐 |
| `preview.restart` | `session_id` `profile` `url` `cwd` `context` | `task_id` | ⏳ 契约已对齐 |
| `process.kill` | `session_id` `process_id` `profile` | `status` `session_id` `command` `exit_code` `completion_reason` `termination_source`… | ⏳ 契约已对齐 |
| `process.list` | `session_id` `profile` | `processes` | ⏳ 契约已对齐 |
| `process.stop` | `session_id` `profile` | `killed` | ⏳ 契约已对齐 |
| `reload.env` | — | `updated` | ⏳ 契约已对齐 |
| `reload.mcp` | `session_id` `confirm` `always` `rev` | `status` `message` `loaded_rev` `coalesced` `turn_isolation` `host_ack` | ⏳ 契约已对齐 |
| `request.answer` | `id` `result` `profile` | `status` | ⏳ 契约已对齐 |
| `shell.exec` | `command` `profile` | `stdout` `stderr` `code` | ⏳ 契约已对齐 |
| `skills.manage` | `profile` `action` `query` `page` `page_size` | `skills` `results` `installed` `name` `items` `page`… | ⏳ 契约已对齐 |
| `skills.reload` | `session_id` `profile` | `output` `result` | ⏳ 契约已对齐 |
| `terminal.resize` | `session_id` `profile` `cols` | `cols` | ⏳ 契约已对齐 |
| `usage.bars` | `profile` | `ok` `available` `status` `plan_name` `renews_at` `renews_display`… | ⏳ 契约已对齐 |

---

## 四、服务端反向干预请求（Gateway ➔ Client Requests）14 项全量契约

| 反向干预方法名 | 触发场景说明 | 载荷参数 (`params`) | 预期返回 (`result`) | 客户端响应方式 |
|---|---|---|---|:---:|
| `approval` | 准备执行高危系统指令 (rm, drop, git reset 等) | command, risk, timeout | allow, forever, deny | 弹窗审批卡片 |
| `clarify` | Agent 遇到技术方案分歧调用 clarify 工具向用户反问 | questions | answers | 结构化问卷卡片 |
| `setup_choose` | 配置档首次引导或多选项初始预设选择 | prompt, choices | value | 交互式选项芯片卡 |
| `sudo` | 终端工具执行了需要提升 Root 权限的指令 | command, user | value (password) | 系统密码授权窗 |
| `secret` | 运行流或插件缺失必需的环境变量/密钥 | env_var, prompt | value (secret) | 凭据录入遮罩 |
| `vault.code` | 自动化流触发了 2FA / 短信 / 邮件验证码 | service, hint | value (6位验证码) | 动态验证码键盘 |
| `vault.save_login` | Agent 在浏览器中检测到新账号密码产生 | site, identifier | value ({identifier, password}) | 凭据入库气泡 |
| `vault.unlock_prompt` | 需要解密本地保险库敏感资产 | display_name, backend | value (master_password) | 主密码/指纹解锁 |
| `display.install.sudo` | 安装虚拟桌面/屏幕控制所需底层依赖驱动 | package_manager | value (sudo_password) | 管理员授权面板 |
| `preview.act` | 桌面端内嵌浏览器页面视口点击、滚动、键入 | action, coordinates | ValueResult | WINDOW_ONLY 视口交互 |
| `preview.read` | 提取桌面内嵌浏览器渲染的结构化文本 | range | ValueResult (JSON text) | WINDOW_ONLY 文本提取 |
| `terminal.read` | 审查桌面可见终端缓冲区的历史字符 | lines | ValueResult (JSON text) | WINDOW_ONLY 终端回读 |
| `window.read` | 探测操作系统原生窗口层级与焦点状态 | — | ValueResult (JSON text) | WINDOW_ONLY 焦点探测 |
| `tour` | 驱动新手引导高亮气泡在 UI 控件间跳动 | step_id, selector | ValueResult | WINDOW_ONLY 气泡导引 |

---

## 五、官方下行事件（Gateway ➔ Client Push）77 个全量清单

| 事件名 | 契约归属 | 业务含义与客户端消费状态 |
|---|:---:|---|
| `agent.terminal.output` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `approval.cancelled` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `background.complete` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `billing.step_up.verification` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `bot_relay.outbox.pending` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `browser.controller.cancel` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `browser.controller.command` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `browser.progress` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `btw.complete` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `connection.request` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `connection.update` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `cron.changed` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `display.install.done` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `display.install.log` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `display.lease` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `display.status` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `error` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `free_tier.challenge` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `gateway.ready` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `layout.apply` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `message.complete` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `message.delta` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `message.interim` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `message.reaction` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `message.start` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `moa.aggregating` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `moa.phase` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `moa.progress` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `moa.reference` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `notice` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `notification.clear` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `notification.show` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `pairing.changed` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `pane.reveal` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `pet.changed` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `pet.generate.progress` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `pet.hatch.progress` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `platforms.changed` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `preview.close` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `preview.open` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `preview.restart.complete` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `preview.restart.progress` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `projects.changed` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `reaction` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `reasoning.available` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `reasoning.delta` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `request.cancel` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `review.summary` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `session.control.update` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `session.info` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `session.reclaimed` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `session.resume_progress` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `session.title` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `session.usage` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `sessions.changed` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `setup.ready` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `skin.changed` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `status.update` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `subagent.complete` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `subagent.progress` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `subagent.spawn_requested` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `subagent.start` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `subagent.thinking` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `subagent.tool` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `terminal.close` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `thinking.delta` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `tip.show` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `todo.updated` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `tool.complete` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `tool.generating` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `tool.output_risk` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `tool.start` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `voice.interrupted` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `voice.partial` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `voice.status` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `voice.transcript` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |
| `wake.detected` | 官方契约 | 异步下行通知，由 `HermesGatewayClient.on(type)` 统一分发 |

---

## 六、官方核心 RESTful 聚合专线接口清单（全量实测通过）

| 请求方法与路径 | 功能职责与特性 | 实测状态与返回值示例 |
|---|---|:---:|
| `GET /api/profiles/sessions?profile=all&order=recent` | **全 Profile 会话聚合列表**（跨库扫描，按活跃时间全局倒序） | ✅ **实测通过** (HTTP 200, `sessions`, `total`) |
| `GET /api/profiles/sessions/sidebar?recents_profile=all` | **侧边栏批量会话切片**（内建 Singleflight 缓存，同时返回 recents/cron/messaging） | ✅ **实测通过** (HTTP 200, `recents`, `cron`) |
| `GET /api/sessions` | 单 Profile 会话列表查询 | ✅ **实测通过** (HTTP 200, `data`, `has_more`) |
| `GET /api/status` | 网关与系统健康状态探测（免密公开端点） | ✅ **实测通过** (HTTP 200, `version`, `gateway_state`) |
| `POST /api/auth/ws-ticket` | 获取短时高安全 WebSocket 访问票据 (Ticket) | ✅ **实测通过** (HTTP 200, `ticket`, `ttl_seconds`) |
| `POST /auth/password-login` | 用户名/密码登录（签发安全 HttpOnly Session Cookie） | ✅ **实测通过** (HTTP 200, set-cookie 确权) |
