# 下行事件流

> 本文件由 `npm run contract:doc` 从网关契约、探针结果与源码调用点自动生成，请勿手工编辑。
> 契约快照：e3cf16a3d983… · 同步于 2026-11-12T09:29:35.736Z

网关通过 JSON-RPC 通知 `event` 帧向下推送，payload 形状由 `BackendGatewayEventMap` 定义。

| 事件 | payload 类型 | 字段 | 本仓库消费 |
| --- | --- | --- | --- |
| `agent.print` | `AgentPrintPayload` | `text` |  |
| `agent.terminal.output` | `TerminalOutputPayload` | `process_id` `chunk` |  |
| `approval.cancelled` | `ApprovalCancelledPayload` | `session_id` `stored_session_id` `reason` `cancelled_count` `request_ids` |  |
| `background.complete` | `SideAgentCompletePayload` | `task_id` `text` `question` | ✅ |
| `billing.step_up.verification` | `BillingStepUpVerificationPayload` | `verification_url` `user_code` |  |
| `bot_relay.outbox.pending` | `ChangeSignalPayload` | — |  |
| `browser.progress` | `BrowserProgressPayload` | `message` `level` |  |
| `btw.complete` | `SideAgentCompletePayload` | `task_id` `text` `question` | ✅ |
| `connection.request` | `ConnectionRequestPayload` | `op_id` `seq` `deadline_at` `timeout_seconds` `targets` `tool_call_id` `display` |  |
| `connection.update` | `ConnectionUpdatePayload` | `op_id` `seq` `deadline_at` `settled` `settled_at` `settled_by` `targets` `owner` `target` `from` `to` `actor` `detail` |  |
| `cron.changed` | `ChangeSignalPayload` | — |  |
| `display.install.done` | `DisplayInstallDonePayload` | `profile_key` `code` `status` |  |
| `display.install.log` | `DisplayInstallLogPayload` | `profile_key` `line` |  |
| `display.lease` | `DisplayLeasePayload` | `profile_key` `lease` |  |
| `display.status` | `DisplayStatusPayload` | `profile` `supported` `installed` `missing` `running` `pid` `display` `socket` `geometry` `install_command` `browser` `blocker` `memory_available_mb` `memory_limit_mb` `placement` `image_switch` `lease` `profile_key` |  |
| `free_tier.challenge` | `FreeTierChallengePayload` | `type` `url` `required` `expires_in` `message` `attempt` |  |
| `gateway.ready` | `GatewayReadyPayload` | `skin` `change_events` `replay_epoch` `heartbeat` `session_authority` |  |
| `message.complete` | `MessageCompletePayload` | `text` `usage` `status` `reasoning` `warning` `response_previewed` `response_reused` `response_transformed` `billing` `failure_reason` `rendered` `error` `recoverable` `error_surface` `partial` `persisted_turn` | ✅ |
| `message.delta` | `MessageDeltaPayload` | `text` `rendered` `verbose` `turn_id` `segment` `offset` | ✅ |
| `message.interim` | `MessageInterimPayload` | `text` `already_streamed` `turn_id` `segment` |  |
| `message.reaction` | `MessageReactionPayload` | `row_id` `reactions` `role` |  |
| `message.start` | `MessageStartPayload` | `display_kind` `display_text` `notification_category` `text` `turn_id` | ✅ |
| `moa.aggregating` | `MoaAggregatingPayload` | `aggregator` |  |
| `moa.phase` | `MoaPhasePayload` | `phase` `refs_done` `refs_total` `aggregator` |  |
| `moa.progress` | `MoaProgressPayload` | `label` `refs_done` `refs_total` |  |
| `moa.reference` | `MoaReferencePayload` | `label` `text` `index` `count` |  |
| `notification.clear` | `NotificationClearPayload` | `key` |  |
| `notification.show` | `NotificationShowPayload` | `text` `level` `kind` `ttl_ms` `key` `id` `detail` |  |
| `onboarding.ended` | `OnboardingEndedPayload` | `run_id` `stored_session_id` `outcome` |  |
| `pairing.changed` | `ChangeSignalPayload` | — |  |
| `pane.reveal` | `PaneRevealPayload` | `pane` |  |
| `pet.changed` | `PetChangedPayload` | `enabled` `slug` `displayName` `scale` `spritesheetRevision` |  |
| `pet.generate.progress` | `PetGenerateProgressPayload` | `token` `count` `index` `dataUri` |  |
| `pet.hatch.progress` | `PetHatchProgressPayload` | `event` `detail` `state` `done` `total` |  |
| `platforms.changed` | `ChangeSignalPayload` | — |  |
| `preview.close` | `PreviewClosePayload` | `url` |  |
| `preview.open` | `PreviewOpenPayload` | `url` `label` |  |
| `preview.restart.complete` | `SideAgentCompletePayload` | `task_id` `text` `question` |  |
| `preview.restart.progress` | `PreviewRestartProgressPayload` | `task_id` `text` `level` |  |
| `projects.changed` | `ChangeSignalPayload` | — |  |
| `reasoning.available` | `StreamDeltaPayload` | `text` `rendered` `verbose` |  |
| `reasoning.delta` | `StreamDeltaPayload` | `text` `rendered` `verbose` | ✅ |
| `request.cancel` | `RequestCancelPayload` | `id` `method` `reason` |  |
| `review.summary` | `ReviewSummaryPayload` | `text` |  |
| `session.control.update` | `SessionControlUpdatePayload` | `control` |  |
| `session.info` | `SessionLiveInfo` | `model` `provider` `reasoning_effort` `reasoning_effort_wire` `service_tier` `fast` `yolo` `approval_mode` `tools` `skills` `cwd` `branch` `project` `terminal_backend` `personality` `running` `turn_started_at` `title` `stored_session_id` `desktop_contract` `version` `release_date` `update_behind` `update_command` `usage` `profile_name` `mcp_servers` `system_prompt` `credential_warning` `lazy` |  |
| `session.reclaimed` | `SessionReclaimedPayload` | `session_id` `stored_session_id` `reason` |  |
| `session.resume_progress` | `SessionResumeProgressPayload` | `phase` `status` `message_count` `message` |  |
| `session.title` | `SessionTitlePayload` | `session_id` `title` | ✅ |
| `session.usage` | `SessionUsagePayload` | `usage` `input_tokens` `output_tokens` `cache_read_tokens` `cache_write_tokens` `prompt_tokens` `completion_tokens` `total_tokens` `reasoning_tokens` `api_calls` `last_prompt_tokens` `context_tokens` `context_length` `config_context_length` `context_source` `compression_count` `avg_latency_s` `tokens_per_s` `last_turn_tokens` `rate_limit` `active_subagents` `model` `provider` `fallback_model` `plan_gauge` |  |
| `sessions.changed` | `ChangeSignalPayload` | — | ✅ |
| `setup.ready` | `SetupReadyPayload` | `provider_configured` `inference_provider` `free_tier_account` `free_tier_route` `has_identity` `other_providers` `error` `error_code` `retryable` `retry_after` `finished_at` |  |
| `skills.changed` | `ChangeSignalPayload` | — |  |
| `skin.changed` | `SkinPayload` | `name` `description` `colors` `light_colors` `dark_colors` `branding` `banner_logo` `banner_hero` `tool_prefix` `help_header` |  |
| `status.update` | `StatusUpdatePayload` | `kind` `text` |  |
| `subagent.complete` | `SubagentEventPayload` | `goal` `task_count` `task_index` `subagent_id` `parent_id` `child_session_id` `delegation_id` `depth` `model` `tool_count` `toolsets` `input_tokens` `output_tokens` `reasoning_tokens` `api_calls` `files_read` `files_written` `output_tail` `tool_name` `text` `status` `summary` `duration_seconds` `tool_preview` | ✅ |
| `subagent.progress` | `SubagentEventPayload` | `goal` `task_count` `task_index` `subagent_id` `parent_id` `child_session_id` `delegation_id` `depth` `model` `tool_count` `toolsets` `input_tokens` `output_tokens` `reasoning_tokens` `api_calls` `files_read` `files_written` `output_tail` `tool_name` `text` `status` `summary` `duration_seconds` `tool_preview` | ✅ |
| `subagent.spawn_requested` | `SubagentEventPayload` | `goal` `task_count` `task_index` `subagent_id` `parent_id` `child_session_id` `delegation_id` `depth` `model` `tool_count` `toolsets` `input_tokens` `output_tokens` `reasoning_tokens` `api_calls` `files_read` `files_written` `output_tail` `tool_name` `text` `status` `summary` `duration_seconds` `tool_preview` | ✅ |
| `subagent.start` | `SubagentEventPayload` | `goal` `task_count` `task_index` `subagent_id` `parent_id` `child_session_id` `delegation_id` `depth` `model` `tool_count` `toolsets` `input_tokens` `output_tokens` `reasoning_tokens` `api_calls` `files_read` `files_written` `output_tail` `tool_name` `text` `status` `summary` `duration_seconds` `tool_preview` | ✅ |
| `subagent.thinking` | `SubagentEventPayload` | `goal` `task_count` `task_index` `subagent_id` `parent_id` `child_session_id` `delegation_id` `depth` `model` `tool_count` `toolsets` `input_tokens` `output_tokens` `reasoning_tokens` `api_calls` `files_read` `files_written` `output_tail` `tool_name` `text` `status` `summary` `duration_seconds` `tool_preview` |  |
| `subagent.tool` | `SubagentEventPayload` | `goal` `task_count` `task_index` `subagent_id` `parent_id` `child_session_id` `delegation_id` `depth` `model` `tool_count` `toolsets` `input_tokens` `output_tokens` `reasoning_tokens` `api_calls` `files_read` `files_written` `output_tail` `tool_name` `text` `status` `summary` `duration_seconds` `tool_preview` | ✅ |
| `terminal.close` | `TerminalClosePayload` | `process_id` |  |
| `thinking.delta` | `StreamDeltaPayload` | `text` `rendered` `verbose` | ✅ |
| `tip.show` | `TipShowPayload` | `selector` `text` `title` `side` |  |
| `todo.updated` | `TodoUpdatedPayload` | `todos` `revision` |  |
| `tool.complete` | `ToolCompletePayload` | `tool_id` `name` `args` `duration_s` `result` `summary` `result_text` `inline_diff` `todos` `revision` `labels` `image_path` | ✅ |
| `tool.generating` | `ToolGeneratingPayload` | `name` |  |
| `tool.output_risk` | `ToolOutputRiskPayload` | `tool_id` `name` `risk` `findings` `redacted` |  |
| `tool.progress` | `ToolProgressPayload` | `tool_id` `name` `progress` `total` `percent` `message` |  |
| `tool.start` | `ToolStartPayload` | `tool_id` `name` `context` `args` `args_text` `preview` `labels` | ✅ |
| `voice.partial` | `VoicePartialPayload` | `text` |  |
| `voice.status` | `VoiceStatusPayload` | `state` |  |
| `voice.transcript` | `VoiceTranscriptPayload` | `text` `stop_phrase` `typed` `no_speech_limit` |  |
| `wake.detected` | `WakeDetectedPayload` | `phrase` `profile` `start_new_session` |  |

## 规则

- 消费任何事件前，payload 字段必须落在上表白名单内；
- 出现白名单之外的字段时，`eventReducer` 会记录 `event payload has fields outside the gateway contract` 告警，不中断事件流；
- 未登记的事件名只记 debug，说明网关新增了事件或该事件不属于本端。

