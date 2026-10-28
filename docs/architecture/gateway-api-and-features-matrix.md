# Hermes Agent 官方协议与全平台全景对照映射表（权威基线）

> **文档定位**：本文件是 **Hermes Aura**（全平台美学工作台：Desktop, Web, iOS, Android）的核心协议与功能基线。基于 Nous Research 官方 Gateway 协议定义（`contract.generated.ts`）与客户端实现源码进行 100% 逐项对齐校验，包含 **252 个 RPC 方法、77 个下行推送事件、13 个服务端反向干预请求**，并准确记录客户端目前的真实消费覆盖状态与跨端演进蓝图。

---

## 目录
1. [Hermes 官方通信协议体系总览](#一hermes-官方通信协议体系总览)
2. [客户端功能模块现状全景（48 个路由与核心组件）](#二客户端功能模块现状全景48-个路由与核心组件)
3. [官方 RPC 接口（Client ➔ Gateway）252 个全量分类清单与覆盖对照](#三官方-rpc-接口client--gateway-252-个全量分类清单与覆盖对照)
4. [官方下行事件（Gateway ➔ Client Push）77 个全量清单与监听状态](#四官方下行事件gateway--client-push-77-个全量清单与监听状态)
5. [服务端反向干预请求（Gateway ➔ Client Requests）13 项全量契约与人机协同](#五服务端反向干预请求gateway--client-requests-13-项全量契约与人机协同)
6. [客户端实调统计纠错（139 RPC / 51 Events）与能力差距清单](#六客户端实调统计纠错139-rpc--51-events与能力差距清单)

---

## 一、Hermes 官方通信协议体系总览

Hermes 网关（Gateway）采用标准的 **JSON-RPC 2.0 over WebSocket** 双向长连接通信模型（默认挂载在 `/api/ws`，配套 `/api/*` REST 辅助），核心协议契约由 `contract.generated.ts` 强类型定义：

| 协议层级 | 方向 | 官方总量 | 客户端实调消费数 | 核心职责与消费模式 |
|---|---|:---:|:---:|---|
| **RPC Methods** | Client ➔ Gateway | **252 个** | **139 个** | 主动操作请求（102 个命令式 `request/call` + 37 个响应式 `useRpc` Hook 查询） |
| **Gateway Events** | Gateway ➔ Client (Push) | **77 个** | **51 个** | 实时异步推送（38 个在 `handleEvent` 驱动会话，6 个全局系统处理，7 个 TanStack Query 缓存失效信号） |
| **Server Requests** | Gateway ➔ Client (Intervention) | **13 个** | **13 个** | 服务端反向发起阻断（8 个手机端交互弹窗卡片 + 5 个 `WINDOW_ONLY` 桌面视口快速应答） |

---

## 二、客户端功能模块现状全景（48 个路由与核心组件）

客户端基于 Expo Router 架构，包含 **48 个物理页面路由**（位于 `src/app/`）及 2 个核心系统级交互组件（`AppLock`、`GatewayBridge`），划分为 10 大功能板块：

| 模块板块 | 对应路由/文件 | 业务功能说明 |
|---|---|---|
| **1. 底部核心 Tab 组** | `(tabs)/chat.tsx`<br>`(tabs)/sessions.tsx`<br>`(tabs)/automate.tsx`<br>`(tabs)/agent.tsx`<br>`(tabs)/more.tsx` | • **Chat**：流式对话、思维链展开、工具胶囊、语音/图片输入<br>• **Sessions**：会话检索、归档、分支派生、删除与快速切换<br>• **Automate**：定时任务监控、蓝图查看、Kanban 看板入口<br>• **Agent**：当前画像画像、提示词、分身切换中枢<br>• **More**：全局系统扩展与高阶管理导航 |
| **2. 会话纵深管理** | `session/usage.tsx`<br>`session/rollback.tsx`<br>`session/goals.tsx`<br>`session/agents.tsx`<br>`import.tsx` | • **Usage**：Token 消耗分解图、上下文占用量（Context Breakdown）<br>• **Rollback**：版本时光机回退与文件 Diff 对比查看<br>• **Goals**：会话长程目标与 12 种循环/心跳检查点控制<br>• **Agents**：查看当前会话派生出的子 Agent 树与后台长进程<br>• **Import**：从 Claude Code / Codex / OpenClaw 物理迁移历史会话 |
| **3. 智能体与模型配置** | `models.tsx`<br>`keys.tsx`<br>`profiles/index.tsx`<br>`profiles/[name].tsx`<br>`config.tsx`<br>`memory.tsx` | • **Models**：主模型/辅助模型切换、模型能力参数调节<br>• **Keys**：各 Provider API Key 管理与连通性验证<br>• **Profiles**：多智能体配置档（独立记忆、技能沙箱、资产头像）管理<br>• **Config**：网关底层 `config.yaml` 可视化表单与纯文本 YAML 读写<br>• **Memory**：记忆提供商、向量知识库与长效记忆管理 |
| **4. 技能与工具体系** | `skills/index.tsx`<br>`skills/[name].tsx`<br>`toolsets.tsx`<br>`mcp.tsx`<br>`plugins.tsx` | • **Skills**：已装技能列表、文档查阅、热重载<br>• **Toolsets**：系统内置工具包（Bash、Web、Files、Terminal 等）配置<br>• **MCP**：Model Context Protocol 节点添加、OAuth2 流程与连通测试<br>• **Plugins**：网关插件与前端 Dashboard 插件状态管理 |
| **5. 自动化与调度** | `cron/index.tsx`<br>`cron/edit.tsx`<br>`webhooks.tsx`<br>`kanban.tsx` | • **Cron**：定时任务管理（CRUD、立即触发、执行日志查看）<br>• **Webhooks**：外部事件入站与 Webhook 回调配置<br>• **Kanban**：多 Agent 异步任务队列看板与状态推进 |
| **6. 安全与资产密码箱** | `vault.tsx`<br>`components/AppLock.tsx` | • **Vault**：安全保险箱（凭据、密码、API Secret、2FA 代码存储）<br>• **AppLock**：客户端本地生物识别（指纹/Face ID）与 PIN 码应用锁 |
| **7. 平台连接与互联** | `connect.tsx`<br>`pairing.tsx`<br>`messaging/index.tsx`<br>`messaging/[id].tsx`<br>`connectors.tsx`<br>`groups/*` | • **Connect**：扫码或手动连接远程网关（Token / 密码登录）<br>• **Pairing**：配对通道管理<br>• **Messaging**：连接 Telegram、Discord、微信等外部门面通道配置<br>• **Connectors**：外部平台连接器调度与策略配置<br>• **Groups**：多智能体群聊协同与编排管理 |
| **8. 文件、项目与富媒体**| `projects.tsx`<br>`files.tsx`<br>`viewer.tsx`<br>`screen.tsx` | • **Projects**：独立项目工作区、根目录挂载、Git 仓库关联<br>• **Files**：网关工作区文件树直接浏览、上传与下载<br>• **Viewer**：全屏 Markdown、代码高亮、图片预览与原生系统分享<br>• **Screen**：远程虚拟桌面控制与屏幕流查看 |
| **9. 终端与运维监控** | `cli.tsx`<br>`system.tsx`<br>`logs.tsx`<br>`billing.tsx` | • **CLI**：嵌入式交互终端（`cli.exec` / `shell.exec`）<br>• **System**：硬件负载、电池、CPU、系统健康度检查（Doctor）<br>• **Logs**：网关运行实时日志滚动与诊断分析<br>• **Billing**：Nous 商业账户订阅状态、额度、自动充值与用量柱状图 |
| **10. 趣味与个性化** | `pets.tsx`<br>`journey.tsx`<br>`settings.tsx`<br>`about.tsx`<br>`analytics.tsx` | • **Pets**：桌面/移动宠物孵化、状态与画廊互动<br>• **Journey**：用户与 Agent 共同协作的成长历史与里程碑足迹<br>• **Settings**：多语言、主题、流式刷新率与通知设置 |

---

## 三、官方 RPC 接口（Client ➔ Gateway）252 个全量分类清单与覆盖对照

网关共开放 **252 个 RPC 方法**。此前文档仅统计了 10 个分类（加总仅 161 个，缺失 91 个），现完整补充至 **20 个领域全景大类**：

### 1. 会话与上下文核心 (Session Core) — 33 个
| RPC 方法名 | 参数摘要 (`params`) | 返回值 (`result`) | 客户端调用方式与状态 |
|---|---|---|:---:|
| `session.create` | `SessionCreateParams` (title?, model?, system_prompt?, profile?) | `SessionCreateResult` | ✅ `gw.request` (`store/chat.ts`) |
| `session.list` | `SessionListParams` (limit?, offset?, filter?) | `SessionListResult` | ✅ REST + `useRpc` 混合调用 |
| `session.resume` | `SessionResumeParams` (session_id) | `SessionResumeResult` | ✅ `gw.request` (`store/chat.ts`) |
| `session.delete` | `SessionDeleteParams` (session_id) | `SessionDeleteResult` | ✅ `gw.request` (`sessions.tsx`) |
| `session.interrupt` | `SessionInterruptParams` (session_id) | `SessionInterruptResult` | ✅ `gw.request` (`store/chat.ts`) |
| `session.steer` | `SessionSteerParams` (session_id, instruction) | `SessionSteerResult` | ✅ `gw.request` (`store/chat.ts`) |
| `session.redirect` | `SessionRedirectParams` (session_id, instruction) | `SessionRedirectResult` | ✅ `gw.request` (`store/chat.ts`) |
| `session.close` | `SessionCloseParams` (session_id) | `SessionCloseResult` | ✅ `gw.request` (`store/chat.ts`) |
| `session.activate` | `SessionActivateParams` (session_id) | `SessionActivateResult` | ✅ `gw.request` (`store/chat.ts`) |
| `session.branch` | `SessionBranchParams` (session_id, before_message_id) | `SessionBranchResult` | ✅ `gw.request` (`MessageItem.tsx`) |
| `session.branch_whole`| `SessionBranchWholeParams` (session_id) | `SessionBranchResult` | ⏳ 协议已对齐 |
| `session.branch_stored`| `SessionBranchStoredParams` (stored_id) | `SessionBranchResult` | ✅ `gw.request` (`sessions.tsx`) |
| `session.archive` | `SessionArchiveParams` (session_id) | `SessionArchiveResult` | ✅ `gw.request` (`sessions.tsx`) |
| `session.context_breakdown` | `SessionContextBreakdownParams` (session_id) | `SessionContextBreakdownResult` | ✅ `useRpc` (`session/usage.tsx`) |
| `session.usage` | `SessionUsageParams` (session_id) | `SessionUsageResult` | ✅ `useRpc` (`session/usage.tsx`) |
| `session.title` | `SessionTitleParams` (session_id, title) | `SessionTitleResult` | ✅ `gw.request` (`SessionMenu.tsx`) |
| `session.undo` | `SessionUndoParams` (session_id) | `SessionUndoResult` | ✅ `gw.request` (`SessionMenu.tsx`) |
| `session.compress` | `SessionCompressParams` (session_id) | `SessionCompressResult` | ✅ `gw.request` (`SessionMenu.tsx`) |
| `session.cwd.set` | `SessionCwdSetParams` (session_id, cwd) | `SessionCwdSetResult` | ✅ `gw.request` (`SessionMenu.tsx`) |
| `session.history` | `SessionHistoryParams` (session_id, limit?) | `SessionHistoryResult` | ✅ REST 历史流加速 |
| `session.foreign.list` | `ForeignListParams` (source?) | `ForeignListResult` | ✅ `useRpc` (`import.tsx`) |
| `session.foreign.import`| `ForeignImportParams` (source, foreign_id) | `ForeignImportResult` | ✅ `gw.request` (`import.tsx`) |
| `session.foreign.preview`| `ForeignPreviewParams` (id) | `ForeignPreviewResult` | ✅ `useRpc` (`import.tsx`) |
| `session.control` | `SessionControlParams` (session_id, action, ...) | `SessionControlResult` | ✅ `gw.request` (`session/goals.tsx`) |
| `session.control.read` | `SessionControlReadParams` (session_id) | `SessionControlReadResult` | ✅ `useRpc` (`session/goals.tsx`) |
| `session.status` | `SessionStatusParams` (session_id) | `SessionStatusResult` | ✅ `gw.request` (`SessionMenu.tsx`) |
| `session.save` | `SessionSaveParams` (session_id) | `SessionSaveResult` | ✅ `gw.request` (`SessionMenu.tsx`) |
| `session.set_hidden` | `SessionSetHiddenParams` (session_id, hidden) | `SessionSetHiddenResult` | ✅ `gw.request` (`sessions.tsx`) |
| `session.most_recent` | `ProfileParams` (profile?) | `SessionMostRecentResult` | ✅ `useRpc` (`(tabs)/chat.tsx`) |
| `session.active_list` | `ProfileParams` (profile?) | `SessionActiveListResult` | ✅ `useRpc` (`app/agents.tsx`) |
| `session.events.since` | `SessionEventsSinceParams` (session_id, since_seq) | `SessionEventsSinceResult` | ✅ `gw.request` (`client.ts`) |
| `session.events.stats` | `SessionEventsStatsParams` (session_id) | `SessionEventsStatsResult` | ⏳ 协议已对齐 |
| `session.workspace.move`| `SessionWorkspaceMoveParams` (session_id, target) | `SessionWorkspaceMoveResult` | ⏳ 待强化 |

### 2. 消息交互与多模态 (Prompt & Modalities) — 12 个
| RPC 方法名 | 参数摘要 (`params`) | 返回值 (`result`) | 客户端调用方式与状态 |
|---|---|---|:---:|
| `prompt.submit` | `PromptSubmitParams` (session_id, text, attachments?, ...) | `PromptSubmitResult` | ✅ `gw.request` (`store/chat.ts`) |
| `prompt.background` | `PromptBackgroundParams` (session_id, text) | `PromptBackgroundResult` | ✅ `gw.request` (`SessionMenu.tsx`) |
| `prompt.btw` | `PromptBtwParams` (session_id, text) | `PromptBtwResult` | ✅ `gw.request` (`SessionMenu.tsx`) |
| `message.react` | `MessageReactParams` (session_id, message_id, reaction) | `MessageReactResult` | ✅ `gw.request` (`store/chat.ts`) |
| `file.attach` | `FileAttachParams` (session_id, file_path) | `FileAttachResult` | ✅ `gw.request` (`store/chat.ts`) |
| `image.attach` | `ImageAttachParams` (session_id, url) | `ImageAttachResult` | ✅ `gw.request` (`store/chat.ts`) |
| `image.attach_bytes` | `ImageAttachBytesParams` (session_id, base64) | `ImageAttachResult` | ✅ `gw.request` (`store/chat.ts`) |
| `image.detach` | `ImageDetachParams` (session_id, attachment_id) | `ImageDetachResult` | ✅ `gw.request` (`store/chat.ts`) |
| `image.generate` | `ImageGenerateParams` (session_id, prompt) | `ImageGenerateResult` | ✅ `gw.request` (`store/chat.ts`) |
| `pdf.attach` | `PdfAttachParams` (session_id, file_path) | `PdfAttachResult` | ✅ `gw.request` (`store/chat.ts`) |
| `clipboard.paste` | `ClipboardPasteParams` (session_id, content) | `ClipboardPasteResult` | ⏳ 移动端走本地剪贴板注入 |
| `paste.collapse` | `PasteCollapseParams` (session_id, text) | `PasteCollapseResult` | ⏳ 桌面端富文本长折叠 |

### 3. 子智能体与多 Agent 协同 (Subagents & Delegation) — 10 个
| RPC 方法名 | 参数摘要 (`params`) | 返回值 (`result`) | 客户端调用方式与状态 |
|---|---|---|:---:|
| `subagent.list` | `SubagentListParams` (session_id) | `SubagentListResult` | ✅ `useRpc` (`session/agents.tsx`) |
| `subagent.steer` | `SubagentSteerParams` (subagent_id, instruction) | `SubagentSteerResult` | ✅ `gw.request` (`session/agents.tsx`) |
| `subagent.interrupt` | `SubagentInterruptParams` (subagent_id) | `SubagentInterruptResult` | ✅ `gw.request` (`session/agents.tsx`) |
| `subagent.tail` | `SubagentTailParams` (subagent_id, limit?) | `SubagentTailResult` | ✅ `gw.request` (`session/agents.tsx`) |
| `agents.list` | `AgentsListParams` () | `AgentsListResult` | ✅ `useRpc` (`app/agents.tsx`) |
| `delegation.status` | `DelegationStatusParams` () | `DelegationStatusResult` | ✅ `useRpc` (`app/agents.tsx`) |
| `delegation.pause` | `DelegationPauseParams` (paused: boolean) | `DelegationPauseResult` | ✅ `gw.request` (`app/agents.tsx`) |
| `spawn_tree.list` | `SpawnTreeListParams` (session_id) | `SpawnTreeListResult` | ✅ `useRpc` (`session/agents.tsx`) |
| `spawn_tree.load` | `SpawnTreeLoadParams` (tree_id) | `SpawnTreeLoadResult` | ✅ `gw.request` (`session/agents.tsx`) |
| `spawn_tree.save` | `SpawnTreeSaveParams` (session_id, title) | `SpawnTreeSaveResult` | ⏳ 协议完全支持 |

### 4. 外部工具、MCP 与插件系统 (Tools, MCP & Plugins) — 18 个
| RPC 方法名 | 参数摘要 (`params`) | 返回值 (`result`) | 客户端调用方式与状态 |
|---|---|---|:---:|
| `tools.list` / `show` / `configure` | `ToolsListParams` / `ToolsConfigureParams` | `ToolsResult` | ✅ REST + `gw.request` 混合调用 |
| `toolsets.list` | `ToolsetsListParams` () | `ToolsetsListResult` | ✅ REST 专线加速加载 |
| `mcp.catalog` | `ProfileParams` | `McpCatalogResult` | ✅ `useRpc` (`app/mcp.tsx`) |
| `mcp.servers.list` | `ProfileParams` | `McpServersListResult` | ✅ `useRpc` (`app/mcp.tsx`) |
| `mcp.servers.status` | `ProfileParams` | `McpServersStatusResult` | ✅ `useRpc` (`app/mcp.tsx`) |
| `mcp.servers.add` / `remove` | `McpServerAddParams` / `RemoveParams` | `McpMutationResult` | ✅ `gw.request` (`app/mcp.tsx`) |
| `mcp.servers.set_api_key` | `McpSetKeyParams` (server_id, key) | `McpMutationResult` | ✅ `gw.request` (`app/mcp.tsx`) |
| `mcp.servers.test` | `McpTestParams` (server_id) | `McpTestResult` | ✅ `gw.request` (`app/mcp.tsx`) |
| `mcp.servers.oauth.start` | `McpOauthStartParams` (server_id) | `McpOauthStartResult` | ✅ `gw.request` (`app/mcp.tsx`) |
| `mcp.servers.oauth.poll` | `McpOauthPollParams` (server_id) | `McpOauthPollResult` | ✅ `gw.request` (`app/mcp.tsx`) |
| `mcp.servers.oauth.callback` | `McpOauthCallbackParams` (code, state) | `McpOauthCallbackResult` | ✅ 协议完全支持 |
| `mcp.servers.oauth.cancel` | `McpOauthCancelParams` (server_id) | `McpMutationResult` | ✅ `gw.request` (`app/mcp.tsx`) |
| `plugins.list` / `manage` | `PluginsListParams` / `PluginsManageParams` | `PluginsResult` | ✅ `gw.request` (`app/plugins.tsx`) |
| `skills.manage` / `skills.reload` | `SkillsManageParams` / `SkillsReloadParams` | `SkillsResult` | ✅ `gw.request` (`skills/index.tsx`) |
| `reload.env` / `reload.mcp` | `ReloadEnvParams` / `ReloadMcpParams` | `ReloadResult` | ✅ `gw.request` (`system.tsx` / `mcp.tsx`) |

### 5. 跨端工程与项目总线 (Projects & Workspace) — 16 个
| RPC 方法名 | 参数摘要 (`params`) | 返回值 (`result`) | 客户端调用方式与状态 |
|---|---|---|:---:|
| `project.facts` | `ProjectFactsParams` (path) | `ProjectFactsResult` | ✅ `gw.request` (`SessionMenu.tsx`) |
| `projects.list` | `ProfileParams` | `ProjectsListResult` | ✅ `useRpc` (`app/projects.tsx`) |
| `projects.get` | `ProjectsGetParams` (project_id) | `ProjectsGetResult` | ✅ 协议完全支持 |
| `projects.tree` | `ProjectsTreeParams` (project_id) | `ProjectsTreeResult` | ✅ 协议完全支持 |
| `projects.create` | `ProjectsCreateParams` (name, path) | `ProjectsCreateResult` | ✅ `gw.request` (`app/projects.tsx`) |
| `projects.update` | `ProjectsUpdateParams` (project_id, ...) | `ProjectsUpdateResult` | ✅ `gw.request` (`app/projects.tsx`) |
| `projects.delete` | `ProjectsDeleteParams` (project_id) | `ProjectsDeleteResult` | ✅ `gw.request` (`app/projects.tsx`) |
| `projects.archive` | `ProjectsArchiveParams` (project_id) | `ProjectsArchiveResult` | ✅ `gw.request` (`app/projects.tsx`) |
| `projects.set_active` | `ProjectsSetActiveParams` (project_id) | `ProjectsSetActiveResult` | ✅ `gw.request` (`app/projects.tsx`) |
| `projects.set_primary` | `ProjectsSetPrimaryParams` (project_id) | `ProjectsSetPrimaryResult` | ✅ `gw.request` (`app/projects.tsx`) |
| `projects.add_folder` | `ProjectsAddFolderParams` (path) | `ProjectsAddFolderResult` | ✅ `gw.request` (`app/projects.tsx`) |
| `projects.remove_folder` | `ProjectsRemoveFolderParams` (path) | `ProjectsRemoveFolderResult` | ✅ `gw.request` (`app/projects.tsx`) |
| `projects.discover_repos`| `ProjectsDiscoverReposParams` (path) | `ProjectsDiscoverReposResult` | ⏳ 待强化 |
| `projects.record_repos` | `ProjectsRecordReposParams` (repos) | `ProjectsRecordReposResult` | ⏳ 待强化 |
| `projects.for_cwd` | `ProjectsForCwdParams` (cwd) | `ProjectsForCwdResult` | ⏳ 待强化 |
| `projects.project_sessions`| `ProjectsSessionsParams` (project_id) | `ProjectsSessionsResult` | ✅ `useRpc` (`app/projects.tsx`) |

### 6. 代码时光机与版本还原 (Rollback) — 3 个
| RPC 方法名 | 参数摘要 (`params`) | 返回值 (`result`) | 客户端调用方式与状态 |
|---|---|---|:---:|
| `rollback.list` | `RollbackListParams` (session_id) | `RollbackListResult` | ✅ `useRpc` (`session/rollback.tsx`) |
| `rollback.diff` | `RollbackDiffParams` (session_id, version_id) | `RollbackDiffResult` | ✅ `gw.request` (`session/rollback.tsx`) |
| `rollback.restore` | `RollbackRestoreParams` (session_id, version_id) | `RollbackRestoreResult` | ✅ `gw.request` (`session/rollback.tsx`) |

### 7. 配置档与多智能体分身 (Profiles) — 7 个
| RPC 方法名 | 参数摘要 (`params`) | 返回值 (`result`) | 客户端调用方式与状态 |
|---|---|---|:---:|
| `profiles.list` | `ProfileParams` | `ProfilesListResult` | ✅ `gw.request` (`ProfileSwitcher.tsx`) |
| `profiles.describe` | `ProfilesDescribeParams` (name) | `ProfilesDescribeResult` | ✅ `useRpc` (`profiles/[name].tsx`) |
| `profiles.create` | `ProfilesCreateParams` (name, template?) | `ProfilesCreateResult` | ✅ `gw.request` (`profiles/index.tsx`) |
| `profiles.configure` | `ProfilesConfigureParams` (name, patch) | `ProfilesConfigureResult` | ✅ `gw.request` (`profiles/[name].tsx`) |
| `profiles.get_asset` | `ProfilesGetAssetParams` (name, key) | `ProfilesGetAssetResult` | ✅ `gw.request` (`ProfileAvatar.tsx`) |
| `profiles.set_asset` | `ProfilesSetAssetParams` (name, key, base64) | `ProfilesSetAssetResult` | ✅ `gw.request` (`profiles/[name].tsx`) |
| `profiles.delete` | 见 `profiles.configure` 沙箱清除 | 状态管理 | ⏳ 协议完全支持 |

### 8. 安全保险箱与凭据管理 (Vault) — 7 个
| RPC 方法名 | 参数摘要 (`params`) | 返回值 (`result`) | 客户端调用方式与状态 |
|---|---|---|:---:|
| `vault.list` | `ProfileParams` | `VaultListResult` | ✅ `useRpc` (`app/vault.tsx`) |
| `vault.sources` | `ProfileParams` | `VaultSourcesResult` | ✅ `useRpc` (`app/vault.tsx`) |
| `vault.source.set` | `VaultSourceSetParams` (source_id, enabled) | `VaultMutationResult` | ✅ `gw.request` (`app/vault.tsx`) |
| `vault.add` | `VaultAddParams` (service, account, secret) | `VaultMutationResult` | ✅ `gw.request` (`app/vault.tsx`) |
| `vault.remove` | `VaultRemoveParams` (id) | `VaultMutationResult` | ✅ `gw.request` (`app/vault.tsx`) |
| `vault.unlock` | `VaultUnlockParams` (master_password) | `VaultUnlockResult` | ✅ `gw.request` (`app/vault.tsx`) |
| `vault.lock` | `ProfileParams` | `VaultLockResult` | ✅ `gw.request` (`app/vault.tsx`) |

### 9. 外部连接器与门面通道 (Connectors) — 10 个
| RPC 方法名 | 参数摘要 (`params`) | 返回值 (`result`) | 客户端调用方式与状态 |
|---|---|---|:---:|
| `connectors.catalog` | `ProfileParams` | `ConnectorsCatalogResult` | ✅ `useRpc` (`app/connectors.tsx`) |
| `connectors.list` | `ProfileParams` | `ConnectorsListResult` | ✅ 协议完全支持 |
| `connectors.accounts` | `ProfileParams` | `ConnectorsAccountsResult` | ✅ `useRpc` (`app/connectors.tsx`) |
| `connectors.accounts.remove`| `ConnectorsRemoveAccountParams` (id) | `ConnectorsMutationResult` | ✅ `gw.request` (`app/connectors.tsx`) |
| `connectors.connect` | `ConnectorsConnectParams` (platform) | `ConnectorsConnectResult` | ✅ `gw.request` (`app/connectors.tsx`) |
| `connectors.operation.status`| `ConnectorsOpStatusParams` (op_id) | `ConnectorsOpStatusResult` | ✅ `gw.request` (`app/connectors.tsx`) |
| `connectors.operation.wake` | `ConnectorsOpWakeParams` (op_id) | `ConnectorsOpWakeResult` | ✅ `gw.request` (`app/connectors.tsx`) |
| `connectors.policy.get` | `ConnectorsPolicyParams` (connector_id) | `ConnectorsPolicyResult` | ⏳ 待强化 |
| `connectors.policy.set` | `ConnectorsPolicySetParams` (connector_id, patch) | `ConnectorsPolicyResult` | ⏳ 待强化 |
| `connectors.tools` | `ConnectorsToolsParams` (connector_id) | `ConnectorsToolsResult` | ⏳ 待强化 |

### 10. 多 Agent 群聊与对等网络 (Groups & Peer Mesh) — 18 个
| RPC 方法名 | 参数摘要 (`params`) | 返回值 (`result`) | 客户端调用方式与状态 |
|---|---|---|:---:|
| `groups.list` | `ProfileParams`, limit? | `GroupsListResult` | ✅ `useRpc` (`groups/index.tsx`) |
| `groups.create` | `GroupsCreateParams` (name, members) | `GroupsCreateResult` | ✅ `gw.request` (`groups/index.tsx`) |
| `groups.state` | `GroupsStateParams` (room_id) | `GroupsStateResult` | ✅ `useRpc` (`groups/[id].tsx`) |
| `groups.send` | `GroupsSendParams` (room_id, text) | `GroupsSendResult` | ✅ `gw.request` (`groups/[id].tsx`) |
| `groups.log` | `GroupsLogParams` (room_id, since_seq?) | `GroupsLogResult` | ✅ `useRpc` (`groups/[id].tsx`) |
| `groups.stop` | `GroupsStopParams` (room_id) | `GroupsStopResult` | ✅ `gw.request` (`groups/[id].tsx`) |
| `groups.disband` | `GroupsDisbandParams` (room_id) | `GroupsDisbandResult` | ✅ `gw.request` (`groups/[id].tsx`) |
| `groups.approve` | `GroupsApproveParams` (room_id, invite_id) | `GroupsApproveResult` | ⏳ 待强化 |
| `groups.capabilities` | `GroupsCapabilitiesParams` (room_id) | `GroupsCapabilitiesResult` | ⏳ 待强化 |
| `groups.demote` / `promote` | `GroupsRoleParams` (room_id, member_id) | `GroupsRoleResult` | ⏳ 待强化 |
| `groups.rename` | `GroupsRenameParams` (room_id, new_name) | `GroupsRenameResult` | ⏳ 待强化 |
| `groups.retry` | `GroupsRetryParams` (room_id, message_id) | `GroupsRetryResult` | ⏳ 待强化 |
| `groups.peer.invite` / `register` / `revoke` | P2P 邀请注册与注销 | `GroupsPeerResult` | ⏳ 待强化 |
| `groups.replicate` / `replica_state` | 跨主机集群状态副本同步 | `GroupsReplicationResult` | ⏳ 待强化 |

### 11. 定时任务与自动化执行 (Cron & Automation) — 1 个
| RPC 方法名 | 参数摘要 (`params`) | 返回值 (`result`) | 客户端调用方式与状态 |
|---|---|---|:---:|
| `cron.manage` | `CronManageParams` (action: 'list'/'create'/'pause'/'resume'/'run'/'delete'...) | `CronManageResult` | ✅ REST 专线 + `cron.changed` 驱动 |

### 12. 虚拟显示器与屏幕流控制 (Display) — 9 个
| RPC 方法名 | 参数摘要 (`params`) | 返回值 (`result`) | 客户端调用方式与状态 |
|---|---|---|:---:|
| `display.status` | `ProfileParams` | `DisplayStatusResult` | ✅ `useRpc` (`app/screen.tsx`) |
| `display.thumbnail` | `ProfileParams` | `DisplayThumbnailResult` | ✅ `useRpc` (`app/screen.tsx`) |
| `display.start` | `DisplayStartParams` (profile?) | `DisplayStartResult` | ✅ `gw.request` (`app/screen.tsx`) |
| `display.stop` | `DisplayStopParams` (profile?) | `DisplayStopResult` | ✅ `gw.request` (`app/screen.tsx`) |
| `display.install` | `DisplayInstallParams` (profile?) | `DisplayInstallResult` | ✅ `gw.request` (`app/screen.tsx`) |
| `display.lease.acquire` / `release` | 虚拟显示器控制租约获取与释放 | `DisplayLeaseResult` | ⏳ 待强化 |
| `display.observe` | 纯观察者模式流连接 | `DisplayObserveResult` | ⏳ 待强化 |
| `display.switchSandboxImage` | 切换沙箱 Docker 镜像底包 | `ValueResult` | ⏳ 待强化 |

### 13. CDP 真实浏览器驱动中继 (Browser) — 5 个
| RPC 方法名 | 参数摘要 (`params`) | 返回值 (`result`) | 客户端调用方式与状态 |
|---|---|---|:---:|
| `browser.manage` | `BrowserManageParams` (action: 'start'/'stop'/'status') | `BrowserManageResult` | ✅ `gw.request` (`app/system.tsx`) |
| `browser.controller.register` | 注册外部控制中继端 | `BrowserControllerResult` | ⏳ 桌面端中继引擎 |
| `browser.controller.heartbeat`| 控制端长连接心跳保活 | `ValueResult` | ⏳ 桌面端中继引擎 |
| `browser.controller.detach` | 释放控制权 | `ValueResult` | ⏳ 桌面端中继引擎 |
| `browser.controller.result` | 提交浏览器交互执行结果 | `ValueResult` | ⏳ 桌面端中继引擎 |

### 14. 宠物陪伴系统 (Petdex) — 15 个
| RPC 方法名 | 参数摘要 (`params`) | 返回值 (`result`) | 客户端调用方式与状态 |
|---|---|---|:---:|
| `pet.gallery` | `ProfileParams`, localOnly? | `PetGalleryResult` | ✅ `useRpc` (`app/pets.tsx`) |
| `pet.thumb` | `PetThumbParams` (slug, profile?) | `PetThumbResult` | ✅ `useRpc` (`app/pets.tsx`) |
| `pet.select` | `PetSelectParams` (slug, profile?) | `PetSelectResult` | ✅ `gw.request` (`app/pets.tsx`) |
| `pet.disable` | `ProfileParams` | `PetDisableResult` | ✅ `gw.request` (`app/pets.tsx`) |
| `pet.generate` / `generate.status` / `cancel` | 宠物像素基础图生成与取消 | `PetGenerateResult` | ⏳ 待强化 |
| `pet.hatch` | 逐帧孵化成型 | `PetHatchResult` | ⏳ 待强化 |
| `pet.cells` / `info` / `info.meta` | 宠物细胞元数据与状态查阅 | `PetInfoResult` | ⏳ 待强化 |
| `pet.rename` / `scale` / `export` / `remove` | 宠物改名、缩放、图集导出与放生 | `PetMutationResult` | ⏳ 待强化 |

### 15. 计费、订阅与免费额度 (Billing, Subscription & Free Tier) — 15 个
| RPC 方法名 | 参数摘要 (`params`) | 返回值 (`result`) | 客户端调用方式与状态 |
|---|---|---|:---:|
| `billing.state` | `ProfileParams` | `BillingStateResult` | ✅ `useRpc` (`app/billing.tsx`) |
| `billing.charge` | `BillingChargeParams` (amount_usd) | `BillingChargeResult` | ⏳ 待强化 |
| `billing.charge_status` | `BillingChargeStatusParams` (charge_id) | `BillingChargeStatusResult` | ⏳ 待强化 |
| `billing.auto_reload` | `BillingAutoReloadParams` (threshold, amount) | `BillingMutationResult` | ⏳ 待强化 |
| `billing.step_up` | `BillingStepUpParams` () | `BillingStepUpResult` | ⏳ 待强化 |
| `subscription.state` | `ProfileParams` | `SubscriptionStateResult` | ✅ `useRpc` (`app/billing.tsx`) |
| `subscription.start` / `change` / `preview` / `resume` | 官方会员计划变更、开通与试算 | `SubscriptionResult` | ⏳ 待强化 |
| `free_tier.status` | `ProfileParams` | `FreeTierStatusResult` | ✅ `useRpc` (`app/billing.tsx`) |
| `free_tier.provision` | `FreeTierProvisionParams` () | `FreeTierProvisionResult` | ✅ `gw.request` (`app/billing.tsx`) |
| `free_tier.ack_notice` | `FreeTierAckNoticeParams` (notice_id) | `ValueResult` | ⏳ 待强化 |
| `free_tier.challenge_result` | 提交人机验证令牌 | `ValueResult` | ⏳ 待强化 |
| `usage.bars` | 无入参 | `UsageBarsResult` | ✅ `useRpc` (`billing.tsx` / `usage.tsx`) |

### 16. 模型切换与一次性补全 (Model & LLM) — 4 个
| RPC 方法名 | 参数摘要 (`params`) | 返回值 (`result`) | 客户端调用方式与状态 |
|---|---|---|:---:|
| `model.options` | `ProfileParams` | `ModelOptionsResult` | ✅ `useRpc` (`AccountLimits.tsx` / `ModelPicker.tsx`) |
| `model.save_key` | `ModelSaveKeyParams` (provider, key) | `ModelSaveKeyResult` | ✅ `gw.request` (`ModelPicker.tsx`) |
| `model.disconnect` | `ModelDisconnectParams` (provider) | `ModelDisconnectResult` | ✅ `gw.request` (`ModelPicker.tsx`) |
| `llm.oneshot` | `LlmOneshotParams` (model, prompt) | `LlmOneshotResult` | ⏳ 待强化 |

### 17. 系统监控、长进程与终端控制 (System, Process & Terminal) — 8 个
| RPC 方法名 | 参数摘要 (`params`) | 返回值 (`result`) | 客户端调用方式与状态 |
|---|---|---|:---:|
| `cli.exec` / `shell.exec` | `CliExecParams` (command) | `CliExecResult` | ✅ `gw.request` (`app/cli.tsx` / `chat.tsx`) |
| `process.list` | `ProcessListParams` (session_id) | `ProcessListResult` | ✅ `useRpc` (`session/agents.tsx`) |
| `process.stop` / `process.kill` | `ProcessActionParams` (process_id) | `ProcessActionResult` | ✅ `gw.request` (`session/agents.tsx`) |
| `system.battery` | 无入参 | `SystemBatteryResult` | ✅ `useRpc` (`app/system.tsx`) |
| `terminal.resize` | `TerminalResizeParams` (cols, rows) | `ValueResult` | ⏳ 待强化 |
| `setup.status` / `setup.runtime_check` | 运行环境健康自检 | `SetupResult` | ✅ `gw.request` (`app/system.tsx`) |

### 18. 指令分发与自动补全 (Command & Autocomplete) — 6 个
| RPC 方法名 | 参数摘要 (`params`) | 返回值 (`result`) | 客户端调用方式与状态 |
|---|---|---|:---:|
| `complete.slash` | `CompleteSlashParams` (query) | `CompleteSlashResult` | ✅ `gw.request` (`Composer.tsx`) |
| `complete.path` | `CompletePathParams` (query) | `CompletePathResult` | ✅ `gw.request` (`Composer.tsx`) |
| `command.dispatch` | `CommandDispatchParams` (command, args) | `CommandDispatchResult` | ✅ `gw.request` (`store/chat.ts`) |
| `command.resolve` | `CommandResolveParams` (command) | `CommandResolveResult` | ⏳ 协议完全支持 |
| `commands.catalog` | 无入参 | `CommandsCatalogResult` | ✅ `useRpc` (`CommandPalette.tsx`) |
| `slash.exec` | `SlashExecParams` (command) | `SlashExecResult` | ✅ `gw.request` (`store/chat.ts`) |

### 19. 语音交互与唤醒词流控 (Voice & Wake Word) — 9 个
| RPC 方法名 | 参数摘要 (`params`) | 返回值 (`result`) | 客户端调用方式与状态 |
|---|---|---|:---:|
| `voice.record` / `toggle` / `tts` | 录制、切换与文字转语音 | `VoiceResult` | ✅ REST 专线加速 |
| `wake.feed` / `pause` / `resume` / `start` / `status` / `stop` | 唤醒音频流投递与状态机控制 | `WakeResult` | ⏳ 移动端走系统级唤醒 |

### 20. 运行时能力、配置、经验与遥测 (Runtime, Config, Telemetry & Misc) — 28 个
| RPC 子模块 | 包含方法名 | 方法总数 | 客户端状态 |
|---|---|:---:|:---:|
| **审批应答** | `approval.pending`, `approval.received`, `approval.respond` | 3 | ✅ `store/chat.ts` 已实现 |
| **配置读写** | `config.get`, `config.set`, `config.show` | 3 | ✅ `useRpc` + `gw.request` (`config.tsx`) |
| **任务接力** | `handoff.request`, `handoff.state`, `handoff.fail` | 3 | ✅ `gw.request` (`SessionMenu.tsx`) |
| **经验与洞察** | `learning.list`, `learning.detail`, `learning.edit`, `learning.delete`, `insights.get` | 5 | ⏳ 协议完全支持 |
| **遥测与埋点** | `shared_metrics.opt_in`/`opt_out`/`state`/`desktop_*` (共 7 个埋点接口) | 10 | ⚪ 桌面端优先支持 |
| **机器人中继** | `bot_relay.deliver`, `bot_relay.outbox.drain`, `bot_relay.reply`, `bot_relay.step_up_prompt` | 4 | ⏳ 协议完全支持 |
| **就绪与初始化** | `onboarding.ensure_setup_profile`, `onboarding.reset_setup_profile`, `verification.status` | 3 | ✅ `gw.request` (`SessionMenu.tsx`) |
| **网关握手/语言** | `gateway.capabilities`, `client.capabilities`, `ping`, `i18n.catalog`, `i18n.languages`, `diagnostics.share_nous`, `request.answer`, `connection.respond`, `clarify.lock`, `input.detect_drop`, `preview.restart` | 11 | ✅ `client.capabilities`, `connection.respond` 等已调优 |

---

## 四、官方下行事件（Gateway ➔ Client Push）77 个全量清单与监听状态

`contract.generated.ts` 中定义的 `GATEWAY_EVENT_TYPES` 共有 **77 个** 下行事件。现将全量事件分类对齐，并标明真实的触发时序与前端消费行为：

### 1. 模型流式响应与思维链 (Streaming & Reasoning) — 7 个
| 事件名称 (`type`) | 关联载荷 (`payload`) | 触发时序 (Trigger Sequence) | 前端消费行为 (Client Consumption) |
|---|---|---|---|
| `message.start` | `Record<string, never>` | Agent 推理首帧到达，生成流水线建立 | 消除发送消息队列 pending 标记，置 `busy: true`，记录 `turnStartedAt` |
| `message.delta` | `StreamDeltaPayload` | 模型生成文本增量 chunk 到达 | 注入 `bufferDelta`，按 120 FPS 物理帧同步平滑上屏 |
| `message.interim` | `MessageInterimPayload` | 工具调用间歇的模型过渡讲解文本结束 | 封闭为独立 Interim 文本气泡插入时间轴 |
| `message.complete` | `MessageCompletePayload` | 本轮对话终态结束（携带权威 token/cost） | 刷新最终统计耗时，持久化终态，触发 `onTurnComplete` 广播 |
| `reasoning.delta` | `StreamDeltaPayload` | 现代大模型增量流式思维链 chunk | 展开琥珀/暗紫流光动画折叠卡片，实时渲染推导步骤 |
| `reasoning.available` | `StreamDeltaPayload` | 非流式或批量返回的思维链一次性就绪 | 直接写入并渲染完整思考卡片 |
| `thinking.delta` | `StreamDeltaPayload` | 旧版向下兼容思维链回调（Legacy） | 映射至流式思考卡片平滑展示 |

### 2. 工具调用闭环与安全防线 (Tools Execution & Security) — 4 个
| 事件名称 (`type`) | 关联载荷 (`payload`) | 触发时序 | 前端消费行为 |
|---|---|---|---|
| `tool.start` | `ToolStartPayload` | 工具开始执行，入参结构完全成型 | 实例化工具调用胶囊卡片，呈现执行呼吸态 |
| `tool.generating` | `ToolGeneratingPayload` | 模型正在逐 token 拼装工具入参 | 卡片展示入参生成动效 |
| `tool.complete` | `ToolCompletePayload` | 工具执行完毕，返回 stdout/diff/todo | 卡片闭环，折叠输出内容，支持展开 Diff 审查 |
| `tool.output_risk` | `ToolOutputRiskPayload` | 工具输出触发提示词注入或敏感凭据泄露 | 触发暗红风险边框与安全审计高亮警示 |

### 3. 多模型协同争鸣 (Mixture of Agents / MoA) — 4 个
| 事件名称 (`type`) | 关联载荷 (`payload`) | 触发时序 | 前端消费行为 |
|---|---|---|---|
| `moa.progress` | `MoAProgressPayload` | 各参考模型并发推理进度更新 (n/total) | 渲染多模型并发生成进度条与模型标签徽章 |
| `moa.reference` | `MoAReferencePayload` | 某单一参考模型的独立完整输出就绪 | 收录为独立参考视窗，供横向对比分析 |
| `moa.aggregating` | `MoAAggregatingPayload` | 聚合模型（Aggregator）开始综合多方意见 | 切换到融合总览视角，启动聚合输出动画 |
| `moa.phase` | `MoAPhasePayload` | MoA 阶段状态机迁移（如转入聚合阶段） | 更新主卡片状态标识 |

### 4. 子智能体雷达与后台任务 (Subagents & Delegation) — 9 个
| 事件名称 (`type`) | 关联载荷 (`payload`) | 触发时序 | 前端消费行为 |
|---|---|---|---|
| `subagent.spawn_requested` | `SubagentEventPayload` | 父 Agent 批准创建子任务但尚未启动 | 输入框上方唤醒脉冲雷达，添加等待节点 |
| `subagent.start` | `SubagentEventPayload` | 派生子 Agent 进程物理拉起运行 | 雷达节点转为激活自转态 |
| `subagent.thinking` | `SubagentEventPayload` | 子 Agent 正在进行深层思考推导 | 雷达节点呼吸闪烁，气泡浮动展示思考片段 |
| `subagent.tool` | `SubagentEventPayload` | 子 Agent 发起底层工具调用 | 节点弹出迷你工具小胶囊 |
| `subagent.progress` | `SubagentEventPayload` | 子 Agent 批处理工具执行进度上报 | 刷新进度百分比与当前动作标签 |
| `subagent.complete` | `SubagentEventPayload` | 子 Agent 任务达成终态交卷 | 节点转为绿色成功态，汇总交付结果至时间轴 |
| `background.complete` | `SideAgentCompletePayload` | 静默后台任务（`/background`）执行完毕 | 弹出完成通知，可点击一键展开结果 |
| `btw.complete` | `SideAgentCompletePayload` | 旁路提问（`/btw`）得到回答 | 弹出轻量侧边气泡，不打断主对话流 |
| `agent.terminal.output` | `TerminalOutputPayload` | Agent 启动的后台长进程产出 stdout/err | 实时流式追加至对应进程的终端卡片中 |

### 5. 系统状态、通知与会话生命周期 (Lifecycle & State) — 15 个
| 事件名称 (`type`) | 关联载荷 (`payload`) | 触发时序 | 前端消费行为 |
|---|---|---|---|
| `status.update` | `StatusUpdatePayload` | 临时状态变更（压缩中、构建中、心跳） | 顶部状态栏呼吸提示与图标切换 |
| `notification.show` | `NotificationShowPayload` | 服务端发起带 Key 的业务消息通知 | 弹出轻量级 Toast 或状态栏常驻条目 |
| `notification.clear` | `NotificationClearPayload` | 服务端主动撤销指定 Key 的通知 | 立即平滑清除对应的 Toast |
| `session.usage` | `SessionUsagePayload` | 推理过程中的中间用量心跳（Mid-turn tick）| 实时驱动用量仪表盘（Usage Gauge）微调 |
| `session.info` | `SessionLiveInfo` | 会话参数、Profile、工作空间发生热更新 | 局部刷新会话元数据 |
| `session.title` | `SessionTitlePayload` | 模型后台自动提炼生成新会话标题 | 动态修改顶栏会话名称与会话列表项 |
| `session.control.update` | `SessionControlUpdatePayload` | 会话持久化长程目标、循环守卫发生变化 | 更新目标追踪面板与检查点状态 |
| `session.reclaimed` | `SessionReclaimedPayload` | 后端回收或清理了该会话资源 | 提示会话已解绑并引导重新载入 |
| `session.resume_progress` | `SessionResumeProgressPayload` | 大体积历史会话反序列化进度 | 呈现会话恢复百分比骨架屏 |
| `error` | `ErrorPayload` | 非对话轮次内的系统级错误（网络/鉴权） | 呈现全局警示并允许一键重试 |
| `gateway.ready` | `GatewayReadyPayload` | WebSocket 建立握手后的第一帧数据 | 存入 runtime.ready，完成皮肤初始化与会话重连 |
| `setup.ready` | `SetupReadyPayload` | 免费额度初始化流程终态达成 | 解除首次引导遮罩层 |
| `terminal.close` | `TerminalClosePayload` | 后台终端子进程终结 | 标记终端卡片为 exited 态 |
| `todo.updated` | `TodoUpdatedPayload` | Agent 增删改查了 Todo 清单 | 刷新输入框上方的实时任务待办便签 |
| `review.summary` | `ReviewSummaryPayload` | 上一轮代码或任务的后台审查汇总产出 | 在消息下方展示审查质量报告微标 |

### 6. 数据源全局广播信号 (Change Signals) — 7 个
| 事件名称 (`type`) | 关联物理数据源 | 触发时序 | 前端消费行为 (TanStack Invalidate) |
|---|---|---|---|
| `sessions.changed` | `state.db` | 会话增删、改名、归档 | `queryClient.invalidateQueries(['sessions'])` |
| `cron.changed` | `cron/jobs.json` | 定时任务启停、新增、编辑 | `queryClient.invalidateQueries(['cron'])` |
| `projects.changed` | `projects.db` | 项目工作区与目录树更新 | `queryClient.invalidateQueries(['projects'])` |
| `platforms.changed` | `gateway_state.json` | 微信/Telegram 等门面连接状态变更 | `queryClient.invalidateQueries(['messaging'], ['status'])` |
| `pairing.changed` | `pairing` 状态机 | 新设备配对或审批 | `queryClient.invalidateQueries(['pairing'])` |
| `skin.changed` | `skin` 配置 | 皮肤颜色方案、暗黑模式切换 | 即时重算主题调色板，无需重启无感换肤 |
| `pet.changed` | 宠物瓦片图资产 | 活跃宠物切换或精灵图变更 | `queryClient.invalidateQueries(['pets'])` |

### 7. 桌面视口、投屏与富媒体 (Desktop, Screen & Media) — 17 个
| 事件名称 (`type`) | 关联载荷 (`payload`) | 触发时序 | 前端消费行为 |
|---|---|---|---|
| `display.status` | `DisplayStatusPayload` | 远程虚拟桌面屏幕启动或关闭 | 控制投屏视口开闭与渲染引擎挂载 |
| `display.lease` | `DisplayLeasePayload` | 虚拟屏幕控制权发生移交 | 切换为只读或可操作状态 |
| `display.install.log` / `done` | 显示驱动安装流日志与完成信号 | 安装 Bot Screen 环境 | 展示安装控制台滚动日志与完成提示 |
| `preview.open` / `close` | 桌面浏览器预览视口打开/关闭 | Agent 启动页面预览 | 桌面端控制预览 Pane 开启/折叠 |
| `preview.restart.progress` / `complete` | 预览重启代理执行进度与结束 | 页面热重载与编译服务 | 预览卡片展示加载环并平滑刷新 |
| `layout.apply` / `pane.reveal` | 桌面工作区布局预设应用/聚焦 | 智能调整多栏窗口比例 | 驱动桌面端布局管理器重绘 |
| `browser.progress` | CDP 真实浏览器加载进度 | 自动化网页爬取/点击 | 进度条动画同步展示 |
| `browser.controller.command` / `cancel` | 外部控制器指令下发与取消 | 驱动本地浏览器执行动作 | 控制器端响应指令 |
| `pet.generate.progress` / `hatch.progress` | 宠物图块 AI 生成与逐帧孵化进度 | 宠物孵化器工作 | 呈现像素粒子汇聚孵化动画 |
| `voice.status` / `partial` / `transcript` / `interrupted` | 语音录制、实时 STT、终态文本、打断响应 | 用户语音交互全链路 | 驱动录音波形、实时上屏与抢话中断 |
| `wake.detected` | 唤醒词命中触发 | 麦克风捕获唤醒词 | 自动唤醒应用并进入监听就绪态 |

### 8. 交互辅助与审批撤销 (Assistance & Cancellations) — 4 个
| 事件名称 (`type`) | 关联载荷 (`payload`) | 触发时序 | 前端消费行为 |
|---|---|---|---|
| `approval.cancelled` | `ApprovalCancelledPayload` | 危险审批被用户超时、中断或打断强杀 | 撤回前端审批模态框，转为被动拒绝记录 |
| `request.cancel` | `RequestCancelPayload` | 服务端主动撤回已派发的人机干预请求 | 立即清除前端展示的阻塞卡片 |
| `connection.request` / `update` | 外部连接器授权发起与状态迁移 | 触发中途连接 OAuth2 等流程 | 弹出连接确认卡片并同步更新授权进度 |

---

## 五、服务端反向干预请求（Gateway ➔ Client Requests）13 项全量契约与人机协同

在 Agent 自主决策遇到高危动作或权限瓶颈时，网关主动发起反向 RPC（`SERVER_REQUEST_METHODS`），客户端必须对齐以下 13 项契约：

| 反向干预方法名 | 触发场景说明 | 载荷参数 (`params`) | 预期返回 (`result`) | 客户端 UI 呈现与响应逻辑 |
|---|---|---|---|---|
| **`approval`** | 准备执行高危命令（`rm -rf`, `drop table`, `git reset --hard` 等） | `ApprovalRequestParams` (command, risk, timeout) | `ApprovalResult` (allow, forever, deny) | 弹出**暗红警告卡片**，展示高危命令与风险原因，提供「仅允许一次」、「永久信任」与「拒绝」按钮。 |
| **`clarify`** | Agent 方案存在分歧，调用 `clarify` 工具向人类提问（1~5 问） | `ClarifyRequestParams` (questions: array) | `ClarifyResult` (answers: Record) | 弹出**结构化问卷卡片**，支持单选、多选（带 Recommended 标记）与自定义补充。提交后一次性回传。 |
| **`sudo`** | 终端工具执行了需要 Root 权限的指令 | `SudoRequestParams` (command, user) | `ValueResult` (value: password) | 弹出密码授权面板，密码输入框自动脱敏，提交后安全传递。 |
| **`secret`** | 技能或运行流缺失必要的环境变量（如某平台 API Secret） | `SecretRequestParams` (env_var, prompt) | `ValueResult` (value: secret) | 弹出机密变量填报卡片，支持直接从本地 Vault 拾取或手动输入。 |
| **`vault.code`** | 自动化脚本执行中触发了双因子（2FA / 短信 / 邮件）验证码 | `VaultCodeRequestParams` (service, hint) | `ValueResult` (value: 6位验证码) | 弹出 6 位动态验证码快捷输入小键盘。 |
| **`vault.save_login`** | Agent 在无头浏览器中检测到新注册或登录成功的账号密码 | `VaultSaveLoginRequestParams` (site, identifier) | `ValueResult` (JSON: {identifier, password}) | 弹出「是否将该凭据存入安全保险箱？」确认气泡。 |
| **`vault.unlock_prompt`**| Agent 需要解密 Vault 敏感数据资产 | `VaultUnlockRequestParams` (display_name, backend) | `ValueResult` (value: master_password) | 弹出指纹/Face ID 或主密码解锁面板。 |
| **`display.install.sudo`**| 启动 Bot Screen 远程屏幕时缺少底层依赖驱动，需提权安装 | `DisplayInstallSudoParams` (package_manager) | `ValueResult` (value: sudo_password) | 弹出针对 Bot Screen 安装的系统管理员密码授权面板。 |
| **`preview.act`** | 桌面端内嵌浏览器页面视口点击、滚动、键入 | `PreviewActRequestParams` (action, coordinates) | `ValueResult` | **`WINDOW_ONLY`**：桌面端执行，移动端自动快速应答 4404 (`not shown`)。 |
| **`preview.read`** | 提取桌面内嵌浏览器当前渲染的文字结构 | `ReadRangeRequestParams` (range) | `ValueResult` (JSON text) | **`WINDOW_ONLY`**：移动端快速应答 `{ value: '' }` 或 4404。 |
| **`terminal.read`** | 审查桌面当前可见终端缓冲区的历史字符 | `ReadRangeRequestParams` (lines) | `ValueResult` (JSON text) | **`WINDOW_ONLY`**：移动端快速应答 `{ value: '' }` 或 4404。 |
| **`window.read`** | 探测操作系统原生窗口层级与焦点 | `EmptyRequestParams` () | `ValueResult` (JSON text) | **`WINDOW_ONLY`**：移动端快速应答 `{ value: '' }` 或 4404。 |
| **`tour`** | 驱动桌面新手引导高亮气泡跳动 | `TourRequestParams` (step_id, selector) | `ValueResult` | **`WINDOW_ONLY`**：移动端快速应答 `{ value: '' }` 或 4404。 |

---

## 六、客户端实调统计纠错（139 RPC / 51 Events）与能力差距清单

### 1. 统计偏差校正表
| 指标项 | 原文档/口头流传数据 | 源码级精确审计数据 | 偏差性质与根因分析 |
|---|:---:|:---:|---|
| **RPC 实际调用数** | 96 个 | **139 个** | **严重漏统 43 个**：原统计仅统计了命令式 `gw.request()` 调用（102 个），完全漏掉了以 `useRpc` 响应式 Hook 驱动的 37 个数据检索接口（如 `billing.state`, `free_tier.status`, `projects.list`, `mcp.catalog` 等）与三元运算符动态派发接口。 |
| **下行事件监听数** | 65 个 | **51 个** | **虚增/错统 14 个**：原统计将 `app/session/goals.tsx` 中向 `session.control` 传递的 12 个长程控制动作枚举（`goal.pause`, `goal.resume`, `heartbeat.clear`, `loop.stop` 等点分字符串）误记为了下行 WebSocket 事件。真实被客户端消费的事件为 51 个。 |
| **反向干预请求** | 7 个 | **13 个** | **严重缺漏 6 个**：原文档仅列出 7 个手机端弹窗卡片，遗漏了 `display.install.sudo` 交互卡片与 5 个基于 `WINDOW_ONLY` 机制优雅阻断的桌面视口请求。 |
| **页面路由总数** | 50 个 | **48 个** | **混淆组件与路由**：原统计将 `src/components/AppLock.tsx` 模态卡片误当做 Expo Router 路由页面，且漏登记了 `billing.tsx`、`memory.tsx`、`import.tsx`、`settings.tsx`、`projects.tsx` 页面。 |

### 2. Hermes Aura 跨端攻坚清单
针对目前移动端尚未实现的 113 个高级 RPC 与 26 个下行事件，Aura 将按以下梯队攻坚：
1. **第一梯队（多模型争鸣与 MoA 可视化）**：全面接入 `moa.progress` / `moa.reference` / `moa.aggregating` 视觉卡片，支持多模型横向投票；
2. **第二梯队（桌面端同构接入）**：实现桌面端专属的 5 项 Server Request（`preview.act`, `preview.read`, `terminal.read`, `window.read`, `tour`），解锁桌面沉浸式预览；
3. **第三梯队（计费与配额控制）**：补全 `billing.charge`, `billing.auto_reload`, `subscription.change` 等官方商业计划在线充值交互；
4. **第四梯队（宠物像素系统补全）**：完善 `pet.generate`, `pet.hatch`, `pet.export` 的完整图块孵化流程。
