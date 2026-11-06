# 对话内容数据面与渲染规范

> 适用对象：Hermes Flux Desktop / Web / Mobile 的会话流渲染层。
> 契约基线：网关 0.22.5，契约指纹 `4364a2dd0064…`，同步于 2026-11-01。
> 本文是设计前置研究，不含代码补丁。
>
> **合成说明（Arena）**：底稿取自候选 B（分类树、字段映射、竞品与 28 条差距）；移植候选 A 的三处结构：C19 未知类型、权威合并顺序、原始数据诊断区。跨家族盲评曾推荐 A，理由是 B"字段越界"；经逐条核对，被指越界的 `ConnectionOperationTarget`（契约 1035）、`RoomEvent`（1543）、`GroupsLogResult`（1629）、`PdfAttachResult`（2759）全部真实存在，属评审把摘录当穷举白名单的误判，故推翻盲评结论。同时修正 A 的四处反向错误：通知 payload、MoA 字段、`tool.context/preview`、`session.info.skills` 均真实存在于契约，A 误判为"未定义"。

## 0. 标注与硬边界

- 【事实】：在仓库源码或契约生成物中可直接核对。
- 【推断】：由契约注释、字段命名或现有实现反推，尚未探针证实。
- 【参考】：外部客户端做法，仅作对照，不代表本仓能力。
- 契约外字段一律标注「契约未定义，需探针验证」，不得进入实现假设。
- 工具 `args` 内部键（`path`、`command` 等）不在 `ToolStartPayload` 白名单内，属于**载荷内部结构**，全部标为待验证。

## 1. 数据源全景

### 1.1 权威级别

| 级别 | 名称 | 载体 | 冲突裁决 |
|---|---|---|---|
| L0 | 实时长连接 | JSON-RPC `event` 帧，唯一派发点 `packages/core/src/session/eventReducer.ts:152` | 唯一可覆盖在途流式状态的来源；同字段冲突时胜出 |
| L1 | 恢复快照 | `session.resume` / `session.activate` 返回值 | 只用于**冷启动对账**；不得覆盖已建立的 L0 增量 |
| L2 | 本地缓存与乐观态 | `sessionMessagesCache`、`chatQueueStore`、`state.attachments` | 仅做占位；收到 L0/L1 后必须让位 |

【事实】`eventReducer` 是纯函数，输出 `TurnAction[]`，由 `packages/desktop/src/renderer/index.ts:3818 applyTurnActions()` 消费。
【事实】`message.complete` 是回合终止的唯一权威信号；`session.idle` / `agent.turn_end` 在 0.22.5 不存在（`eventReducer.ts:4-7`）。

### 1.1.1 权威合并顺序（移植自 A）

1. 【事实】冲突裁决优先级：实时长连接 L0 > 恢复快照 L1 > 本地缓存 L2。
2. 【推断】同一内容只按稳定标识合并：`row_id`、`tool_id`、`subagent_id`、`op_id`、`seq`、`messageId`。没有稳定标识时只能按当前回合序列暂存，禁止用时间戳伪造身份或凭正文相似度跨消息合并。
3. 【推断】本地 `id` 只服务本地生命周期，不得替代 `row_id` 作为回滚/截断锚点。
4. 【推断】来源无法确认时显式显示"来源未确认"，不静默归并。
5. 【推断】契约外字段进入隔离诊断区（C19），不参与主视图状态转换。

### 1.2 五路来源

| 来源 | 关键字段 | 权威 | 刷新方式 |
|---|---|---|---|
| 下行事件 | `message.delta{text,rendered,verbose}`、`message.complete{...}`、`tool.start/complete`、`subagent.*`、`todo.updated`、`moa.*` | L0 | 推送，逐帧 |
| 历史 TranscriptMessage | `role,text,content,tool_call_id,timestamp,row_id,display_kind,display_metadata,name,context,args,labels,reasoning`（契约 3049-3064） | L1 | 打开会话、向上翻页 |
| 恢复态 | `running,turn_started_at,status,inflight,queued,pending_approval,open_requests,pending_connection,todo_state,auto_continue`（契约 3105-3126） | L1 | `session.resume` 一次返回 |
| 本地队列 | `QueuedMessageItem{id,sessionId,text,provider,model,profileName,attachments,thinkingVariant,enqueuedAt}`（`chatQueueStore.ts:37-53`） | L2 | 入队/出队/调序即时 |
| 附件 | `FileAttachResult`、`AttachedImageResult`、`PdfAttachResult`；历史侧 `inline_images` 参数 | L1/L2 | 附加时返回，发送时消费 |

【事实】历史消息与恢复态在**同一个 RPC 响应**里返回，但现有代码只把 `messages` 交给 `parseRawMessages`，其余兄弟字段几乎全部丢弃（`index.ts:2315-2330`）。

### 1.3 派发链路

```
event frame
  └─ reduceGatewayEvent()            // 契约白名单校验 + 会话隔离
      └─ TurnAction[]
          ├─ append-content  → TokenCoalescer → RAF flush → #msg-content-<id>
          ├─ append-thought  → TokenCoalescer → RAF flush → #msg-thought-<id>
          ├─ tool-start/complete → toolPatchQueue → #msg-tools-<id>
          ├─ replace-content → setMessageContent()（回合终局覆盖）
          └─ persisted-turn  → bindTurnRowIds()（回滚锚点）
```

### 1.4 必须先纠正的一处事实

【事实】`approval.pending` **不是下行事件**：`docs/gateway/events.md` 的事件表无此项，契约 5016 把它登记为 RPC 方法（入参 `session_id/profile`，出参 `approvals`）。审批卡的合法来源是恢复态 `pending_approval` 与 `open_requests`，以及 `approval.cancelled` 事件的撤销通知。

## 2. 内容类型分类树

分类依据是「数据结构是否可判别」，不是「工具叫什么名字」。禁止用工具名子串反推类型（契约 3065 明确要求渲染 `ToolLabel.text`，客户端不得自行解析工具名）。

```
会话内容
├─ 主消息流（进入对话画布）
│  ├─ 人类输入
│  │  ├─ C01 用户文本
│  │  ├─ C15 排队输入（尚未成为正式行）
│  │  └─ C17 图片与文件附件
│  ├─ 助手输出
│  │  ├─ C02 助手正文
│  │  ├─ C03 思考 / 推理
│  │  └─ C16 错误 / 中止 / 降级
│  └─ 执行轨迹
│     ├─ C04 工具调用（通用）
│     ├─ C05 文件读取
│     ├─ C06 文件变更（diff）
│     ├─ C07 命令执行 / 终端
│     ├─ C08 skill / connector / MCP 调用
│     └─ C09 子代理委派
├─ 旁路与聚合
│  ├─ C10 MoA 多模型聚合
│  └─ C13 通知 / 告警 / 评审摘要
├─ 阻塞式交互
│  ├─ C11 审批请求
│  └─ C12 连接请求
├─ 会话级面板
│  └─ C14 待办清单
└─ 独立数据域
   ├─ C18 群聊条目
   └─ C19 未知 / 未来类型（隔离诊断，不进入主视图状态）
```

### 2.1 分类判定顺序（唯一合法路径）

1. **专用事件族优先**：`subagent.*` → C09；`moa.*` → C10；审批/连接/待办 → C11/C12/C14；不要先看工具名。
2. **`ToolLabel.kind/action` 次之**：`connector`/`mcp` → C08；动作表达读取/写入/执行 → C05/C06/C07。
3. **`role=tool` 且带 `tool_call_id`**：归 C04，按 `tool_id` 与主消息流配对。
4. **`display_kind` 再次之**：仅用于「是否隐藏/是否为系统行」；枚举未定，未知值按普通行。
5. **`name` 只作展示兜底**：永远不参与分类决策（契约 3065）。

【推断】现有实现正好把第 5 步当成第 1 步，导致 `write_file` 被 `file` 先命中、`edit` 与 `patch` 混淆等漂移。

## 3. 分类规格（字段 → 解析 → 展示 → 降级）

### C01 用户文本

- **原始字段**：`prompt.submit.text`、`display_kind`、`surface`；历史 `TranscriptMessage{role,text,content,display_kind,display_metadata,row_id,timestamp}`；恢复 `InflightTurn.user`。
- **解析**：`text` 为 string 直接用；`content` 可能是 parts 数组（仅历史），逐 part 取 `text`；`row_id` 必须是正整数才登记为回滚锚点；无文本但有附件仍成行。
- **展示**：单列用户气泡，正文走 Markdown；附件缩略图排在正文之下；不承载工具与思考。
- **降级**：`text` 空且无附件 → 整行不建；`display_kind` 未知枚举（契约未定义枚举，需探针验证）→ 按普通用户消息显示，不得静默隐藏。

### C02 助手正文

- **原始字段**：`message.delta{text,rendered,verbose}`、`message.complete{text,status,partial,warning,response_previewed,response_reused,response_transformed}`；历史 `TranscriptMessage.text`。
- **解析**：delta 只追加；`message.complete.text` 是终局权威，必须**替换**而非追加；`rendered` 视为服务端预渲染 HTML，需消毒白名单后才可插入，默认仍走本地 Markdown；`partial=true` 单独标记。
- **展示**：通栏正文，Markdown 段落纵向排列；流式期间保持贴底跟随；`partial` 在尾部显示「未完成」标记；`response_reused/transformed` 在页脚显示提示。
- **降级**：只有 `rendered` 无 `text` → 提取纯文本；两者皆空但 `status=complete` → 保留气泡骨架，避免回合消失。

### C03 思考 / 推理

- **原始字段**：`reasoning.delta` / `thinking.delta{text,rendered,verbose}`、`reasoning.available`、`message.complete.reasoning`；历史 `TranscriptMessage.reasoning`（侧车字段）。
- **解析**：三类来源按 `messageId` 合并；`verbose=true` 表示完整推理，false 可能为摘要，需记录完整度；空串不建节点；`rendered` 同样只做消毒兜底。
- **展示**：默认折叠的 `details`，头部显示「思考」+ 首行摘要 + 时长；流式期间自动展开，允许手动收起；不进入正文排版。**现状缺陷**：增量到达时 `fold.open = true`（`index.ts:919-923`）会覆盖用户手动折叠，应改为仅在首次到达时展开一次。
- **降级**：无 reasoning → 整块隐藏；历史只有摘要 → 头部标注「摘要」，不伪装成完整思维链。

### C04 工具调用（通用）

- **原始字段**：`tool.start{tool_id,name,context,args,args_text,preview,labels}`、`tool.complete{tool_id,name,args,duration_s,result,summary,result_text,inline_diff,todos,revision,labels}`、`tool.generating{name}`、`tool.output_risk{tool_id,name,risk,findings,redacted}`。
- **解析**：`tool_id` 为唯一主键，start 与 complete 精确配对；未配对的 start 超过阈值后标 `unknown`，不得改配「最近的 running」；`labels` 优先于 `name`；`context` 是调用来源上下文，非展示正文。
- **展示**：单行胶囊：`labels.text`（或 app/action）+ 目标（`preview` 或 args 摘要）+ `duration_s` + 状态；详情折叠；同一回合的只读工具聚合为一行 chips。
- **降级**：`labels` 缺失 → 显示 `name` 原文，不本地化猜测；`args` 非法 JSON → 原文截断展示；`result` 非字符串 → JSON 美化后折叠。

### C05 文件读取

- **原始字段**：`tool.start.name`、`args`、`preview`、`labels`；`tool.complete.result_text`、`summary`。路径键名契约未定义，需探针验证（现有实现猜 `path/file/filePath/file_path/resolved_path`）。
- **解析**：仅当 `labels.kind='tool'` 且 `labels.action` 表达读取语义时归入此类；不得靠 `name.includes('read')` 判定。
- **展示**：静态单行，不设展开箭头（与 OpenChamber 的只读工具形态一致【参考】）；文件名可点击进入右侧检查舱；路径中间省略、文件名保留。
- **降级**：无路径 → 只显示 `labels.text`；无结果 → 显示「已读取」，不显示空白折叠区。

### C06 文件变更（diff）

- **原始字段**：`tool.complete.inline_diff`、`result_text`、`summary`、`args`；历史 `display_metadata`（可能承载 diff，契约未定义结构，需探针验证）、`display_kind`。
- **解析**：优先级 `inline_diff` > `result_text` 中的 diff 段 > `args` 重建预览（仅新建文件可重建）；行数统计从 diff 头计算，不从自然语言摘要猜。
- **展示**：文件路径 + `+N/-M` + 折叠的 hunk 视图；默认折叠，展开后等宽字体、保留行号；多文件变更按文件分组。
- **降级**：无 diff → 只显示「已修改 + 文件路径」，**禁止伪造 diff**；二进制/超长 diff → 显示统计与「在检查舱打开」。

### C07 命令执行 / 终端

- **原始字段**：`tool.start.args_text`、`args`、`preview`；`tool.complete.result`、`result_text`、`summary`、`duration_s`；`agent.terminal.output{process_id,chunk}`、`terminal.close{process_id}`。
- **解析**：命令文本优先 `args_text`，其次 `args` 内的命令键（键名未定义，需探针验证）；退出码不在契约白名单，只能从结果文本提取【推断】；终端流按 `process_id` 独立聚合。
- **展示**：`$ 命令` 单行 + 状态点 + 时长；输出默认折叠，展开显示尾部若干行；长时间运行显示流式追加与停止入口。
- **降级**：无命令文本 → 显示 `preview` 首行；无输出 → 显示退出状态未知；`process_id` 缺失 → 终端流不挂载，避免串流。

### C08 skill / connector / MCP 调用

- **原始字段**：`ToolLabel{kind:'connector'|'mcp'|'tool',app,action,emoji,text,name,preview}`；`tool.start.labels`、`tool.complete.labels`。
- **解析**：以 `kind` 分三态：`connector` 外部连接器、`mcp` 外部工具服务、`tool` 内置工具；`text` 是唯一权威展示文案；同一 `app` 的多次调用可聚合计数。
- **展示**：带 `emoji` 的 chip，主文案 `text`，副文案 `app/action`；聚合态显示「调用 X 次」，展开列每次调用。
- **降级**：无 labels → 退化为 C04；`text` 空但 `app/action` 有值 → 拼接显示，不显示空 chip。

### C09 子代理委派

- **原始字段**：`subagent.start/progress/thinking/tool/spawn_requested/complete`，统一 `SubagentEventPayload{goal,task_count,task_index,subagent_id,parent_id,child_session_id,delegation_id,depth,model,tool_count,toolsets,input_tokens,output_tokens,reasoning_tokens,api_calls,files_read,files_written,output_tail,tool_name,text,status,summary,duration_seconds,tool_preview}`。
- **解析**：`subagent_id` 为主键；`depth` 决定层级缩进；`task_index/task_count` 表达批次进度；`status` 驱动状态机；`goal` 是标题，不是 `profile/title`（后者为契约外字段）。
- **展示**：主流感一张委派卡：`goal` + 批次 `n/m` + 模型 + 工具数 + token；副行显示最近 `output_tail`；点击进入右侧穿透终端，保留思考/工具/结果分色。
- **降级**：`subagent_id` 缺失（旧发射器）→ 扁平渲染，不建树；`goal` 空 → 显示「子代理任务」；`status` 未知 → 按 running 处理但标灰。

### C10 MoA 多模型聚合

- **原始字段**：`moa.phase{phase,refs_done,refs_total,aggregator}`、`moa.progress{label,refs_done,refs_total}`、`moa.reference{label,text,index,count}`、`moa.aggregating{aggregator}`。
- **解析**：`phase` 是阶段状态；`refs_done/refs_total` 是唯一进度真值；`reference` 按 `index/count` 排序；`aggregator` 是聚合模型名。
- **展示**：聚合条：阶段名 + `n/total`；下方每个参考模型一张折叠卡（`label` 为标题）；聚合完成后只保留聚合正文与「N 个参考」入口。
- **降级**：无 `index/count` → 按到达顺序追加；缺 `refs_total` → 只显示计数不显示百分比；`text` 空 → 保留标签占位。

### C11 审批请求

- **原始字段**：恢复态 `pending_approval: PendingApproval{request_id,command,description,pattern_key,pattern_keys,allow_permanent,allow_session,smart_denied,choices,tool_name}`；`approval.cancelled{request_ids,cancelled_count,reason}`；响应侧 `approval.respond{choice:'once'|'session'|'always'|'deny',all,request_id}`。
- **解析**：`choices` 是服务端预计算的合法选项，必须原样、原序渲染；`command` 已脱敏，不得二次加工；`request_id` 为空时只能整批响应。
- **展示**：阻塞式内联卡（非 toast）：命令原文 + 风险说明 + 选项按钮；`allow_session/allow_permanent` 控制是否出现「本会话/永久」；`smart_denied` 时置灰并说明原因。
- **降级**：卡到达时若 `request_id` 缺失 → 禁用单条选择，仅保留 `all`；`approval.cancelled` 到达 → 原地灰化并标注「已随中断取消」，不静默移除。

### C12 连接请求

- **原始字段**：`connection.request{op_id,seq,deadline_at,timeout_seconds,targets,tool_call_id}`、`connection.update{op_id,seq,deadline_at,settled,settled_at,settled_by,targets,owner,target,from,to,actor,detail}`；恢复态 `pending_connection`。
- **解析**：`op_id` 为主键，`seq` 单调递增，旧 `seq` 丢弃；`targets[].state` 驱动单目标状态；`deadline_at` 是绝对时间，倒计时以本地时钟换算。
- **展示**：连接卡：每个 target 一行（`name/kind/action/state`），主行动按钮取 `connect_url`，无 URL 显示 `instructions`；顶部倒计时；settled 后折叠为结果行。
- **降级**：`deadline_at` 已过期 → 灰化并给「重新发起」；target 全部 `resolved` → 自动收起；`connection.update` 丢失 → 以 `pending_connection` 快照兜底。

### C13 通知 / 告警 / 评审摘要

- **原始字段**：`notification.show{text,level,kind,ttl_ms,key,id}`、`notification.clear{key}`、`notice{message}`、`review.summary{text}`、`status.update{kind,text}`。
- **解析**：`key` 相同的 show 覆盖旧通知；`kind='sticky'` 不自动消失，`ttl` 按 `ttl_ms` 计时；`level` 仅四种语义：info/warn/error/success。
- **展示**：三级落位——瞬时 toast（ttl）、状态条（sticky/session 级）、内联摘要卡（review.summary）；不使用模态。
- **降级**：`level` 未知 → info；`key` 缺失 → 按 `id` 去重，仍缺则单次展示不覆盖。

### C14 待办清单

- **原始字段**：`todo.updated{todos,revision}`、`tool.complete.todos/revision`、恢复态 `todo_state{todos,revision}`。`todos` 元素结构契约未定义，需探针验证。
- **解析**：`revision` 单调递增，小于当前值的帧丢弃；全量快照语义，不做增量合并；来源优先级 L0 `todo.updated` > L0 `tool.complete` > L1 `todo_state`。
- **展示**：会话级可折叠清单：已完成 / 进行中 / 待办三段；顶部显示 `done/total`；流式期间不打断阅读，仅在侧栏或输入舱上方显示计数。
- **降级**：条目字段不可识别 → 只渲染可读文本，未知字段收进「原始数据」折叠；`revision` 缺失 → 按到达顺序覆盖，并标记「可能乱序」。

### C15 排队输入

- **原始字段**：恢复态 `queued: QueuedPrompt{user}`（契约未声明条数上限，单条为【推断】，需探针验证）；本地 `QueuedMessageItem`；提交侧 `prompt.submit.queued` 与其返回的 `status`（枚举值契约未定义，需探针验证）。
- **解析**：L1 `queued.user` 是网关权威的单条待发；本地队列是多条 L2 快照，包含模型/附件冻结；两者不一致时以「本地可见条目 + 网关确认条数」呈现，不互相删除。
- **展示**：输入舱上方可折叠队列面板：`n queued`、拖拽手柄、编辑、删除、立即发送；出队瞬间保留灰色占位，直到该轮开始。
- **降级**：L1 只有 `user` 文本 → 不显示模型与附件；本地快照附件缺失 → 只显示文本，禁止显示损坏缩略图。

### C16 错误 / 中止 / 降级

- **原始字段**：`message.complete{status,error,failure_reason,recoverable,error_surface,partial,warning,billing}`；会话级 `session.reclaimed{reason}`、`session.resume_progress{phase,status,message_count,message}`。
- **解析**：`status` 三态 `complete|error|interrupted`；`error_surface` 是 `{layer,code,retryable,provider,model,resets_at}`，用于决定「重试/等待/换模型」；`failure_reason` 与 `error` 可能同时存在，展示以 `error` 为主、`failure_reason` 为副。
- **展示**：回合尾部错误条：一句人话 + 可执行动作（重试 / 继续 / 查看详情）；`resets_at` 显示到点时间；`billing` 显示计费提示与链接；`partial` 与错误并存时先标「部分完成」。
- **降级**：无 `error` 文本 → 用 `status` + `error_surface.code` 组合；`recoverable` 缺失 → 不显示重试按钮，避免误导；恢复进度失败 → 明确「历史未加载完成」，不显示空会话。

### C17 图片与文件附件

- **原始字段**：`file.attach` → `FileAttachResult{attached,name,path,ref_path,ref_text,uploaded}`；`image.attach` / `image.attach_bytes` → `AttachedImageResult{name,width,height,token_estimate,attached,path,count,remainder,text,bytes,message}`；`pdf.attach` → `PdfAttachResult{attached,filename,pages_attached,pages,count,text}`；历史侧 `session.resume.inline_images`。
- **解析**：`attached=false` 时 `message` 是唯一可信失败原因；`count/remainder` 表达批量附加的剩余；`token_estimate` 用于预算提示，不参与排版。
- **展示**：图片缩略图（按 `width/height` 保持比例）+ 文件名 + 字节数；文件/PDF 用类型 chip；点击在右侧检查舱预览；发送后附件行并入用户气泡。
- **降级**：无 `previewUrl` → 类型图标 + 文件名；`attached=false` → 红色状态 + `message`；历史图片未内联 → 显示占位并声明「历史图片未加载」。

### C18 群聊条目

- **原始字段**：`RoomEvent{room_id,seq,event_id,kind,actor{kind,id},authority_epoch,payload,created_at}`、`GroupsLogResult{events,cursor,latest_seq,has_more,authority}`；本地 `GroupMessageEntry{messageId,seq,senderProfile,timestamp,text,isSeed,threadId,actorKind}`。
- **解析**：`payload` 是开放字典，`payload.text` / `payload.thread_id` / `payload.is_seed` 属实现约定（契约未定义，需探针验证）；`kind` 以 `room.` 开头且无 text 的是房间事件，不进入发言流；`seq` 为排序与去重主键。
- **展示**：独立房间流：`@sender` + `#seq` + 正文；`threadId` 相同的发言归为一轮；seed 备忘录用独立卡片；`actorKind='user'` 与 Agent 发言视觉可分。
- **降级**：`payload` 无 text → 显示 `kind` 事件占位（如成员变更），不渲染空气泡；`seq` 缺失 → 用 `created_at` 排序并标「顺序不确定」。

### C19 未知 / 未来类型（移植自 A）

- **原始字段**：未命中 C01–C18 的任何事件名、历史行或 `display_kind` 值；原始 payload 原样保留。
- **解析**：先过 `BackendGatewayEventMap` 白名单；命中但类型未知 → 归 C19；完全未登记 → 只记 debug 并进诊断区，绝不参与状态转换。
- **展示**：默认折叠的"未识别内容"条：事件名 + 首行可读摘要 + 来源标记（实时/历史/恢复）。可见但低对比，不占据主视觉。
- **降级**：禁止静默丢弃、禁止用相似度跨消息合并；诊断区可复制原始 JSON。这是契约演进时的唯一安全出口。

### 3.19 跨类合并规则

- **同主键合并**：同 `tool_id` 的 start/complete 合成一张卡；同 `subagent_id` 的六类事件合成一个执行流；同 `op_id` 的连接更新只保留最新 `seq`。
- **同类聚合**：同一回合内连续只读工具（读取/检索）合并为一行，展开后逐项；写操作不聚合，必须逐条可见。
- **域隔离**：子代理的工具调用只进子代理穿透流，不得混入主消息流（现有 `subagent-log` 已体现该原则）。
- **非消息域**：审批、连接、通知、待办属于会话级状态，不写入 `messages`，也不参与历史分页。
- **禁止回写**：群聊记录只进房间日志，不得写入任何 Bot 的 `MEMORY.md`；这是三态隔离的硬边界。
- **快照覆盖**：待办、队列、连接均为「全量快照」语义，不做字段级增量合并，避免半新半旧。

## 4. 静态历史与流式增量的差异

### 4.1 字段差异

| 仅流式出现 | 仅历史出现 | 两边都有但语义不同 |
|---|---|---|
| `usage`、`billing`、`error_surface`、`recoverable`、`partial`、`warning` | `row_id`、`display_kind`、`display_metadata`、`tool_call_id`、`context` | `text`：delta 是片段，历史是整段 |
| `persisted_turn`、`response_previewed/reused/transformed` | `corrections`、`correction_offsets`、`turn_started_at` | `reasoning`：流式是增量，历史是侧车整段 |
| `tool.start.preview/args_text`、`tool.complete.inline_diff/result_text/summary/duration_s` | `labels`（历史 tool 行） | `args`：流式是对象，历史可能被投影成字符串 |
| `todo.updated`、`moa.*`、`notification.*`、`message.interim`、`connection.*` | `queued`、`pending_approval`、`pending_connection`、`todo_state`、`open_requests` | `status`：流式是回合结果，历史是行状态 |

【事实】历史侧 `labels`、`display_kind`、`display_metadata` 当前在 `parseRawMessages` 中完全未读取（`index.ts:2041-2051`）。

### 4.2 三条增量通道与刷新边界

| 通道 | 入口 | 合流器 | 刷新边界 | 不变量 |
|---|---|---|---|---|
| 正文 | `message.delta` → `append-content` | `TokenCoalescer`（`index.ts:838`） | 每 RAF 帧一次，2–6 字符自适应步长 | 只追加；`message.complete` 时先 flush 再整体替换 |
| 思考 | `reasoning.delta` / `thinking.delta` → `append-thought` | 同一 `TokenCoalescer` | 每 RAF 帧一次，思考整段投递 | 与正文共用 messageId 但独立缓冲；不得写入正文锚点 |
| 工具 | `tool.start` / `tool.complete` | `toolPatchQueue`（`index.ts:949-970`） | 下一帧局部重绘 `#msg-tools-<id>` | 同 id 不重复建卡；容器缺失时置 `canvasStructureDirty` 触发全量重建 |

【事实】正文每帧对**累计全文**调用 `renderMarkdown` 并整体写 `innerHTML`（`index.ts:909`），随回合增长呈 O(n²) 重解析。
【事实】思考增量写 `innerText`（`index.ts:918`），不复用 Markdown 渲染器，因此思考中的代码块不会高亮。

### 4.3 五条必须成立的不变量

1. **终局覆盖**：`message.complete.text` 只能替换，不能追加；替换前必须先 flush 合流器。
2. **主键配对**：`tool_id` / `subagent_id` / `op_id` / `messageId` 是配对唯一依据；禁止「最近一个 running」兜底。
3. **修订单调**：`todo.revision`、`connection.seq` 只接受更大值；旧帧丢弃。
4. **视口不打扰**：距底 ≤48px 才跟随；用户回溯时任何增量都不得改 `scrollTop`。
5. **失败不静默**：任何来源缺失必须留下可见的降级标记，禁止把「没数据」渲染成「没有发生」。

### 4.4 恢复与重放缺口

【事实】契约提供 `session.events.since{last_seen}` → `{events,latest_seq,truncated,count,epoch,open_requests}`（契约 3578-3590），但全仓无调用点。
【推断】因此 WebSocket 抖动期间丢失的 `tool.*`、`todo.updated`、`subagent.*` 无法回补；`message.complete.text` 只能修复正文，无法修复工具卡与待办。
【事实】`session.resume` 调用未传 `inline_images`（`index.ts:2289-2292`），历史图片默认不内联。

### 4.5 三种场景的刷新契约

| 场景 | 触发 | 允许写入 | 必须禁止 |
|---|---|---|---|
| 正常流式 | `message.start` → `message.complete` | 三个合流器各自的锚点；结束时 `replace-content` | 用 delta 拼接结果替代 `complete.text`；跨会话写入 |
| 断线重连 | 重连后 `session.resume` | 以 `messages` 重建画布；保留本地工具卡并标注残缺 | 静默清空在途工具/待办；把旧快照当增量追加 |
| 会话切换 | `activeSessionId` 变化 | 清空合流器与工具补丁队列；装载目标会话缓存 | 上一会话的迟到帧写入当前画布（`eventReducer.ts:183` 已有会话过滤） |
| 回滚 / 截断 | `prompt.submit.truncate_before_row_id` | 按 `row_id` 删除后缀；本地先乐观裁撤 | 用临时 id 当锚点；删除后又被慢响应复活 |
| 恢复时仍在跑 | `running=true` + `inflight.streaming` | 先建半截气泡，再接受后续 delta | 把 `inflight.assistant` 当终局文本 |

【事实】现有 `inflight` 只用于 `running` 对账，`inflight.assistant` 从未铺进画布（`index.ts:2315-2330`）。
【推断】这会造成「网关说在跑，界面却没有半截回复」的观感断裂，尤其在大模型首 token 较慢时。

## 5. 竞品客户端对标

> 下表全部为【参考】公开资料观察，不代表本仓能力；标注"未验证"的条目只说明方向，不作为设计依据。逐项来源见本节末尾。

| 客户端 | 工具调用 | 思考链 | diff | 子代理 | 排队输入 |
|---|---|---|---|---|---|
| Claude Code | 工具行；MCP 折叠为「Called slack 3 times」；`Ctrl+O` 展开细节与时间戳 | 折叠展示，`Alt+T` 切换扩展思考 | 内联 hunk；全屏模式旁侧 diff 面板 | 委派显示为 `name(任务描述)` 工具行 + 底部 subagent 面板 | 队列列在对话中，灰色直到开始处理；`Ctrl+Enter` 立即发送 |
| Codex CLI | 命令与 diff 随执行出现；审批中断执行 | 以 reasoning effort 控制，展示为执行流一部分 | 统一 diff（apply_patch 内部处理） | 原生 subagents，结果回流主会话 | 官方文档未明确队列形态（未验证） |
| Cursor | Agent 面板内工具步骤 | 折叠的思考块 | 编辑实时进入 diff 视图，可逐项 reject | 并行 subagents，各自上下文窗口 | 忙时可排队，支持拖拽调序 |
| Zed | 流式工具指示器 | 折叠展示 | Review Changes 折叠条：文件数 + 行数，逐 hunk accept/reject | 并行 Threads，独立上下文 | 默认排队；可编辑/删除；单条可切 Steer 提前插入 |
| Warp | Agent 对话内的 block，终端 block 与对话 block 分离 | 对话流内展示 | 内置 diff 编辑器，逐 hunk 导航，Accept/Refine/Edit | Agent questions + 多会话 | 独立队列面板：计数、拖拽、编辑、删除、立即发送；长命令后加「queued until the command finishes」后缀 |
| OpenChamber（参考实现） | 只读工具静态单行，命令截断 100 字符 | 折叠 | 工具胶囊 + `+N/-M` 统计 | 独立胶囊 | 本仓另有 `renderQueueTray`，形态接近 Warp |

**逐项说明**

- **Claude Code**【参考】：官方 Interactive mode 文档明确「队列消息在对话中列出，发送并排队时显示灰色，直到 Claude 开始响应」；`Ctrl+T` 切换任务清单；`Ctrl+O` 打开 transcript viewer，展开默认折叠的 MCP 调用。来源：`code.claude.com/docs/en/interactive-mode`。子代理委派形态见 `code.claude.com/docs/en/sub-agents`：「delegation appears as a tool call row showing the subagent's name followed by a short task description」。diff 形态来自 2.1.260 变更日志与社区观察，标为待复核【参考】。
- **Codex CLI**【参考】：官方 CLI 页写明「steer the active turn, inspect commands and diffs as they appear」；权限页给出 `Ask for approval` / `Approve for me` 两档审批语义。来源：`learn.chatgpt.com/docs/codex/cli`、`learn.chatgpt.com/docs/permission-modes`。思考链与排队形态官方页未细化，列入未验证。
- **Cursor**【参考】：官方 Agent 文档写明「Watch edits appear in the diff view as they happen」「Submit your next instruction while Agent is busy… You can drag to reorder queued messages」「Agent can spin up specialized subagents… each runs in its own context window」。来源：`cursor.com/help/ai-features/agent`。
- **Zed**【参考】：官方 Agent Panel 文档写明队列默认生效、单条可开 `Steer`、可编辑/删除/`Send Now`；变更审阅为「surface which files, how many of them, and how many lines」并支持逐 hunk accept/reject；压缩上下文会插入可展开的 `Context Compacted` 条目。来源：`zed.dev/docs/ai/agent-panel`。
- **Warp**【参考】：队列面板含计数、拖拽、编辑、删除、立即发送，长命令排队行带 `(queued until the command finishes)` 后缀；diff 在内置编辑器按 hunk 导航并 `Accept Changes`；`/fork`、`/compact` 等会话操作齐全。来源：`docs.warp.dev/agents/local-agents/interacting-with-agents/prompt-queueing/`、`.../code-diffs/`。

**对标结论**【推断】：成熟客户端的共同点是「默认极简、按需展开、状态可执行」，而不是把所有字段铺开。本仓的差距不在视觉，而在**字段没有进入视图模型**。

## 6. 与现有实现的差距（逐条可核对）

| # | 位置 | 现状 | 丢失/错误消费 |
|---|---|---|---|
| 1 | `eventReducer.ts:205-209` | `message.delta` 只取 `text` | `rendered`、`verbose` 丢弃 |
| 2 | `eventReducer.ts:211-216` | 思考事件只取 `text` | `rendered`、`verbose` 丢弃，无法标注摘要/完整 |
| 3 | `events.md:31` | `message.interim` 无任何消费 | `text`、`already_streamed` 全丢，工具旁白消失 |
| 4 | `eventReducer.ts:363-390` | `message.complete` 只取 `text` + `persisted_turn` | `usage/status/reasoning/warning/billing/failure_reason/rendered/error/recoverable/error_surface/partial/response_*` 全丢 |
| 5 | `eventReducer.ts:281-313` | `tool.start` 只取 `tool_id/name/args` | `context`、`args_text`、`preview`、`labels` 丢弃 |
| 6 | `eventReducer.ts:316-360` | `tool.complete` 只取 `result/text/error` 并 JSON 字符串化 | `duration_s`、`summary`、`result_text`、`inline_diff`、`todos`、`revision`、`labels` 全丢 |
| 7 | `eventReducer.ts:78` + `index.ts:3912` | `TurnAction.tool-complete.durationMs` 从未被赋值 | 时长永远走本地 `now-startTime` 估算，服务端精确值失效 |
| 8 | `eventReducer.ts:218-232` | 子代理读 `profile/target_profile/title/task_title` | 均为契约外字段，恒空；契约 `goal/task_count/task_index/depth/model/toolsets/tokens/files_*/output_tail/duration_seconds` 未用 |
| 9 | `eventReducer.ts:234-249` | 进度读 `progress/percent/action/current_action` | 全部契约外，进度恒 0、动作恒空 |
| 10 | `events.md:73` | `todo.updated` 未消费 | 待办清单完全不存在 |
| 11 | `events.md:32,34,53,38` | `moa.*`、`notification.*`、`review.summary`、`message.reaction` 未消费 | 聚合与告警不可见 |
| 12 | `events.md:75-76` | `tool.generating`、`tool.output_risk` 未消费 | 生成中占位、风险提示缺失 |
| 13 | `index.ts:2315-2330` | 恢复态只读 `running` 与 `inflight.streaming` | `queued`、`pending_approval`、`open_requests`、`pending_connection`、`todo_state`、`auto_continue` 全丢 |
| 14 | `index.ts:2041-2051` | `parseRawMessages` 只填 8 个字段 | `labels`、`display_kind`、`display_metadata`、`result_text`、`summary`、`duration_s`、`todos`、`revision`、`inline_diff` 不进模型 |
| 15 | `index.ts:2033-2035` | 非 assistant 且无文本即整行丢弃 | 纯工具行、纯附件行、空文本事件行消失 |
| 16 | `index.ts:1937-1975` | 用 JSON 文本启发式猜 `grep/edit/shell` | 类型靠字符串模式，误判即错卡 |
| 17 | `MiddlePod.ts:962-1009` | 按 `name.includes('read'/'write'/'edit')` 分类 | 违反契约 3065「客户端不得自行解析工具名」 |
| 18 | `index.ts:1905-1913`、`MiddlePod.ts:1016-1068` | 从 `args` 猜 `path/command/query` | `args` 内部键契约未定义，需探针验证 |
| 19 | `index.ts:909` | 每帧对累计全文 `renderMarkdown` 全量重解析 | 长回合 O(n²)，且思考/正文渲染器不一致 |
| 20 | `MiddlePod.ts:24-50` | `MessageViewModel` 无 `kind/status/usage/error` 字段 | 新增内容类型在类型层不可表达 |
| 21 | `index.ts` 全文无 `tokenMetrics/durationMs/ttftMs` 赋值 | `MiddlePod.ts:795/800` 的时长与 token 页脚永不显示 |
| 22 | `interactiveService.ts:278-290` 无调用者 | `session.usage` 从不拉取；`contextUsage` 从未传入 `MiddlePodProps` | 上下文水位仪表恒空 |
| 23 | `GroupRoomView.ts:32-77` | 只渲染 `senderProfile/text/seq/isSeed` | `actorKind`、`threadId`、`kind` 丢弃，无法分人类/Agent 与分轮 |
| 24 | `groupService.ts:299-326` | 从 `payload.text/thread_id` 取文本 | `payload` 为开放字典，字段属实现约定，契约未定义 |
| 25 | `index.ts:2289-2292` | `session.resume` 未传 `inline_images` | 历史图片不内联 |
| 26 | 全仓无 `session.events.since` 调用 | 断线无事件重放 | 工具/待办/子代理状态无法回补 |
| 27 | `InputDock.ts:26-31` | 队列视图模型只有 `id/text/model/attachmentsCount` | `provider/profileName/thinkingVariant/enqueuedAt` 与附件身份丢失；调序只有上下移，无拖拽 |
| 28 | `index.ts` 无 `queued` 对账 | 网关 `queued.user` 与本地队列互不校验 | 可能出现「网关还有一条待发、界面显示 0 条」 |

### 6.1 三条最严重的错误消费链

**链一：正文只认文本。** `message.complete` 的 `status=error` / `partial=true` / `warning` 全部丢失，`eventReducer.ts:363-390` 只保留 `text`；当回合以错误结束时 `text` 常为空，`replace-content` 不触发，界面表现为「回复凭空消失」。正确路径是先落 `status/error/error_surface`，再决定是否替换正文。

**链二：工具靠猜。** `tool.start` 丢 `labels/preview/args_text`（第 5 条），`tool.complete` 丢 `duration_s/summary/result_text/inline_diff`（第 6 条），随后 `MiddlePod.ts:962-1009` 用工具名子串重建语义。结果是：同一工具在流式与历史两种路径下可能显示成两种类型；diff 被 JSON 字符串化后无法按 hunk 渲染；时长永远是本地估算。

**链三：错误不可行动。** `recoverable/error_surface` 未消费，用户看不到「可重试 / 等配额恢复 / 换模型」的区别；`billing` 未消费，计费阻断被当成普通失败。这违反「失败不静默」原则。

## 7. 组件与解析器映射

| 内容类 | 解析器（目标） | 组件（目标） | 优先级 |
|---|---|---|---|
| C01 用户文本 | `parseTranscriptMessage` + 本地乐观行合并 | `renderMessage` 用户分支 | P0 |
| C02 助手正文 | `applyContentActions` + 终局替换 | `renderMessage` 正文 / `#msg-content-*` | P0（已具备，需补 status/partial） |
| C03 思考 | `mergeReasoningSources` | `renderThinkingFold` | P0（已具备，需补 verbose/rendered） |
| C04 工具通用 | `normalizeToolEvent`（以 `tool_id` 配对） | `renderToolCapsules` + `renderToolCapsuleSlot` | P0 |
| C05 文件读取 | `classifyToolLabel` | 只读静态胶囊 | P0 |
| C06 diff | `extractInlineDiff` + `computeDiffStats` | `renderToolOutputBody` 的 diff 分支 | P0 |
| C07 命令/终端 | `extractCommand` + 终端流聚合 | 命令胶囊 + 终端折叠面板 | P0 |
| C08 skill/MCP | `ToolLabel` 直读，不做名称推断 | chip + 聚合行 | P1 |
| C09 子代理 | `parseSubagentEvent`（契约字段） | 委派卡 + `SubagentTerminalView` | P1（现有链路需重接） |
| C10 MoA | `parseMoaFrame` | 聚合条 + 参考卡 | P2 |
| C11 审批 | `parsePendingApproval` | 新增审批卡组件 | P1（阻塞交互，不可缺） |
| C12 连接请求 | `parseConnectionOp` | 新增连接卡组件 | P1 |
| C13 通知 | `parseNotification` | Toast / 状态条 / 摘要卡 | P2 |
| C14 待办 | `parseTodoSnapshot`（等结构探针） | 待办清单面板 | P1 |
| C15 排队 | `ChatQueueStore` + `queued` 对账 | `renderQueueTray` + 输入舱 | P1（已有托盘，需补字段与对账） |
| C16 错误/中止 | `parseTurnOutcome` | 错误条 + 动作按钮 | P0（现状最易误导） |
| C17 附件 | `parseAttachmentResult` | `renderAttachmentTray` + 历史附件行 | P1 |
| C18 群聊 | `parseRoomEvent` | `renderGroupRoomView` | P2 |

**落地顺序建议**：先补 P0 的「解析器 → 视图模型」字段通路（C02/C04/C06/C07/C16），再补阻塞式 C11/C12，最后做 C09/C10/C14 的独立面板。理由：P0 是当前每一次会话都会经过的路径，缺失直接造成信息错误；P2 是低频且可折叠。

## 8. 未验证项与风险

1. **审批通道方向**：`approval.pending` 在契约中是 RPC 方法而非事件；它是否同时以 server→client request 形式到达，需探针验证。若只按事件实现，审批卡永远不会出现。
2. **`display_kind` 枚举**：契约仅声明 string，未给取值集。用它做隐藏/分组前必须探针取证，否则可能误藏用户消息。
3. **`display_metadata` 结构**：契约是 `unknown`。是否承载 diff、附件、引用，需按真实样本确认。
4. **`todos` 元素结构**：`unknown[]`。字段名、状态枚举、ID 规则均未定义，任何清单渲染都只能先做「未知字段折叠」。
5. **工具 `args` 键名**：`args` 是 `Record<string, unknown>`，`path/command/query` 均属实现约定。当前代码的路径与命令提取全部建立在未验证假设上。
6. **`rendered` 的安全性**：契约未声明其为可信 HTML。直接 `innerHTML` 会引入注入风险，必须消毒或忽略。
7. **MoA 信息量不足**：`moa.*` 只有标签、计数、聚合器名，没有每模型耗时、token、错误。若产品要求「多模型对比」，现有契约不够，需要新增字段或探针确认扩展位。
8. **群聊 `payload` 开放字典**：`text/thread_id/is_seed` 是客户端约定；网关若改键，群聊会静默空行。
9. **`ConnectionTargetState` 枚举未核对**：卡片状态色与按钮可用性依赖该枚举，需逐值验证。
10. **性能风险**：正文每帧全量 Markdown 重解析在长回合下会退化；补字段前应先确认是否需要增量渲染，否则新增卡片会放大主线程压力。
11. **权威冲突风险**：本地队列（L2）与 `queued`（L1）同时存在时，若简单「以本地为准」会与网关实际待发不一致；必须双读、单写、显式对账。
12. **外部对标时效**：Claude Code / Codex 的 UI 迭代快，本文引用页面的形态可能变化；所有【参考】结论只用于设计取向，不作为验收标准。
13. **多客户端并发**：`gateway.ready.replay_epoch` 与 `session.reclaimed` 说明同一会话可能被其他端接管；当前客户端未处理接管事件，两个客户端并存时可能各自追加同一回合。需探针验证实际推送范围后再定「只读跟随」策略。
14. **`session.reclaimed` 语义**：`{session_id,stored_session_id,reason}` 的 `reason` 取值集未核对；若把它当普通错误显示，会误导用户以为会话损坏。

---

## 附录 A：事件覆盖矩阵

【事实】`BackendGatewayEventMap` 共 **74** 个事件 key；`docs/gateway/events.md` 表格只有 **72** 行，漏列 `message.start`（payload 为 `Record<string, never>`）与 `voice.interrupted`。引用事件数时以 EventMap 为准。

### A.1 直接生成对话流单元的 25 个事件

| 事件 | 现有处理 | 事件 | 现有处理 |
|---|---|---|---|
| `message.delta` | 只取 text | `subagent.start` | 读契约外字段 |
| `message.interim` | 无分支 | `subagent.progress` | 读契约外字段 |
| `message.complete` | 只取 text + persisted_turn | `subagent.thinking` | 无分支 |
| `message.reaction` | 无分支 | `subagent.tool` | 读契约外字段 |
| `reasoning.delta` | 只取 text | `subagent.complete` | 读契约外字段 |
| `reasoning.available` | 无分支 | `btw.complete` | 有分支 |
| `thinking.delta` | 只取 text | `background.complete` | 有分支 |
| `tool.start` | 丢 preview/labels/context | `moa.aggregating` | 无分支 |
| `tool.complete` | 丢 summary/result_text/inline_diff/duration_s/todos | `moa.phase` | 无分支 |
| `tool.generating` | 无分支 | `moa.progress` | 无分支 |
| `tool.output_risk` | 无分支 | `moa.reference` | 无分支 |
| `subagent.spawn_requested` | 读契约外字段 | `todo.updated` | 无分支 |
|  |  | `review.summary` | 无分支 |

统计：有 case 分支 12 个，其中字段正确 7 个；5 个子代理分支读契约外字段；完全无分支 13 个。

### A.2 会话级状态（不进入对话气泡，但对话区必须响应）

`approval.cancelled`、`connection.request`、`connection.update`、`notification.show`、`notification.clear`、`agent.terminal.output`、`terminal.close`、`session.resume_progress`、`session.reclaimed`、`session.control.update`、`session.usage`、`session.info`、`session.title`、`sessions.changed`。

### A.3 被消费但不在 EventMap 的事件名

`subagent.log`、`subagent.stdout`、`subagent.stderr`、`subagent.failed`、`tool.end`、`tool.error` —— 六个都不是契约事件，`eventReducer` 的分支属于契约外路径，需探针确认网关是否真实下发。

### A.4 本次已核实的事实（Phase F）

- `session.events.since` 契约存在（5382），但全仓无调用点。
- `TokenCoalescer` 位于 `packages/desktop/src/renderer/index.ts:838`。
- `renderQueueTray` 位于 `packages/ui/src/components/InputDock/InputDock.ts:252/540`。
- `session.idle` / `agent.turn_end` 确认不存在。
- `PdfAttachResult`(2759)、`FileAttachResult`(2783)、`ConnectionOperationTarget`(1035)、`RoomEvent`(1543)、`GroupsLogResult`(1629) 均真实存在。
- 恢复态在 `index.ts:2315-2330` 只读 `running` 与 `inflight.streaming`，其余兄弟字段未消费。
