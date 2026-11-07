# 客户端缓存设计方案
(Client Cache Design — Sessions, Agents & Messages)

> **版本**：v7.0.0
> **协议基线**：Hermes Gateway v0.22.5，契约快照 `4364a2dd0064`
> **配套文档**：[`gateway-client-interaction-protocol.md`](./gateway-client-interaction-protocol.md)
>
> **标注约定**：**【拉】** = 客户端发起调用；**【推】** = 网关主动发事件。
>
> **修订记录**：v7 修复 v6 复审的 3 个 BLOCKING（200 条路径未取证 / 截断漏用 `survivor_row_id_map` / 规则 7 无快照围栏）与 13 个 MAJOR。

---

## 一、范围

### 1.1 缓存什么

| 缓存 | 内容 | 上限 | 作用 |
|---|---|---|---|
| **会话索引** | 标题、时间、副标题、profile、隐藏/归档/置顶/未读、项目归属 | 全局池 200 条 | **消息入口** |
| **群聊索引** | 房间名、成员数、游标 `latestSeq`、最后消息摘要 | 并入同一 200 条池 | 群聊入口 |
| **Agent 索引** | 名称、显示名、描述、模型、头像引用 | 全部（通常 < 30） | 左轨与主工位卡 |
| **头像资产** | `data:image/...` | 与 Agent 数量相同 | 视觉资产 |
| **消息正文** | 单会话 500 行；群聊 500 事件 | 每会话 500 | 快速查看历史对话 |

### 1.2 200 条的可达性（已实测）

**实测结论（2026-11-06，网关 0.22.5，`fn-ai.codepower.cloud:1519`）**：

| 项 | 实测结果 |
|---|---|
| 单次 `limit` 上限 | **100**。`limit=101` 与 `limit=200` 均返回 `422`（`Input should be less than or equal to 100`） |
| `offset` 分页 | ✅ **可用**。`limit=10&offset=0` 与 `limit=10&offset=10` 返回 0 条重叠 |
| 响应 `total` | ✅ 返回总条数（样例 `total=76`），可用于判断是否还有下一页 |
| 跨 Profile 聚合 | ✅ `GET /api/profiles/sessions?profile=all&limit=100&offset=100` 正常返回（样例 102 条 = 100 + 2） |
| 单 Profile 实际条数 | 样例环境 76 条，`limit=100` 一次取完 |

**因此 200 条可达，路径确定**：

```text
GET /api/sessions?limit=100&offset=0      → 第 1 页（≤100）
GET /api/sessions?limit=100&offset=100    → 第 2 页（≤100）
直到 rows.length === 0 或累计 ≥ 200
```

或跨 Profile 直接用 `GET /api/profiles/sessions?profile=all&limit=100&offset=N`。两条路径都经实测。

**淘汰规则**：统一池按 `timestamp` 全局倒序，超出上限删尾部。群聊与会话共享同一池，不各占配额。

### 1.3 探针记录（已闭环，实施前无需重跑）

| # | 探针 | 结论 |
|---|---|---|
| P1 | `GET /api/sessions?limit=100&offset=100` | `offset` **生效**，翻页无重叠。`limit` 硬上限 100 |
| P2 | `GET /api/profiles/sessions?profile=all&limit=200` | 单次 200 → **422**；但 `limit=100&offset=100` 分页正常。聚合接口可达 |
| P3 | `GET /api/sessions/{id}/messages` 行字段 | **携带** `reasoning` / `reasoning_content` / `reasoning_details` 与 `tool_calls`（含 `function.name` / `arguments`）。主键字段为 `id`（数字） |

**附加实测**（会话行字段，用于 2.2）：

| 字段 | 实测值形态 |
|---|---|
| `last_active` | 秒级浮点（`1793792667.5529`），需 ×1000 归一化 |
| `unread` / `pinned` / `archived` | 布尔 |
| **`hidden`** | **数字 `0` / `1`，不是布尔** |
| `display_name` | 字符串或 `null` |
| `ended_at` | 秒级浮点或 `null` |

> 若网关升级，重跑方式见 `scripts/contract/probe.mjs`；本表结论对 0.22.5 有效。

### 1.4 不缓存什么

| 不缓存 | 原因 |
|---|---|
| 运行态 `running` / `inflight` | 进程重启后无法判断；唯一权威是 `session.resume` |
| 流式草稿 | `message.complete` 携带 `text` 全文；逐 delta 落盘是纯 I/O 浪费 |
| 模型目录 / 项目树 / Slash 目录 | 秒级可拉且高频变化 |
| Agent 的 `uiMeta` / `soulContent` / `systemPrompt` / `tools` | 敏感且体积大 |

**`uiMeta` 例外说明**：旧版群聊房间与其发言历史只存在于 `ui_meta['hermes-bots-groups'].rooms[].log`（`groups.log` 对这类房间返回 4112）。本方案**不缓存这部分**，如需支持应单独立项。

### 1.5 缓存的定位

> **缓存不参与列表与运行态读路径。运行期所有读走内存 `state`。**

唯一例外：打开会话时读一次消息正文（T2），用于立即显示历史。

### 1.6 存储介质

| 数据 | 介质 | 原因 |
|---|---|---|
| 会话索引 / 群聊索引 / Agent 索引 | `localStorage` | 合计 < 100KB，同步读取 |
| 头像资产 | `localStorage` | 通常 < 30 条 |
| 消息正文 | **`IndexedDB`** | 200 × 500 ≈ 10 万行，localStorage 装不下 |

**性能口径说明**：本文档不承诺具体毫秒数。`localStorage` 同步读取在 100KB 量级通常 < 10ms，但头像表接近 2MB 时 `JSON.parse` 可阻塞 50~120ms（低端移动设备）。实施后必须用 CDP 实测首屏可交互时间并回填，未测量前不得对外宣称"立即"。

**移动端补充**：Capacitor 与桌面共用同一 Web 产物。

- 启动时调用 `navigator.storage.persist()`；
- 返回 `false`、API 不存在、或用户在隐私模式 → 视为**易失存储**，每会话行数预算从 500 降到 100；
- `navigator.storage.estimate()` 剩余空间 < 50MB 时触发按会话 LRU 降级；
- **`localStorage` 不受 `persist()` 保护**，配额永远与旧键共享。

### 1.7 容量策略

**无全局配额上限**，只有结构性上限：

- 索引池 200 条（见 1.2）
- 单会话消息 500 行，按 `orderKey` 淘汰最旧
- 单条消息正文超过 512KB 时截断并标 `truncated`，**但见规则 9 的用户行豁免**
- 写入失败（磁盘满）降级纯内存 + 显式提示

---

## 二、数据模型

### 2.1 统一信封

```jsonc
{ "v": 1, "savedAt": 1730000000000, "items": { /* ... */ } }
```

`v` 不匹配则整体丢弃重建。

### 2.2 会话索引

```ts
interface CachedSession {
  id: string;
  profile: string;                // 复合主键 (profile, id)
  kind: 'session' | 'group';
  title: string;
  preview?: string;
  timestamp: number;              // 毫秒，已归一化
  isArchived: boolean;
  hidden: boolean;
  pinned: boolean;
  unread: boolean;
  botName?: string;
  projectId?: string;
  latestSeq?: number;             // 群聊游标
  memberCount?: number;
}
```

**字段来源**：

| 字段 | 权威来源 | 实测形态 |
|---|---|---|
| `last_active` | **REST `GET /api/sessions`** | 秒级浮点（`1793792667.5529`），×1000 归一化 |
| `hidden` | REST | **数字 `0` / `1`**，读取时转布尔 |
| `unread` / `pinned` / `archived` | REST | 布尔 |
| `title` / `display_name` / `preview` | REST 或 WS | `display_name` 可为 `null` |
| `latestSeq` / `memberCount` | `groups.list` | `Room` 含 `latest_seq` / `members`，无最后消息摘要 |

**WS `session.list` 不可作为索引权威源**：它只返回 `id / title / preview / started_at / message_count / source`，缺少上表全部状态字段（fixture `session_list.json` 实录）。

**快照取数点**：必须从 `reconcileSessionList` 的 `allMerged`（过滤前）取数，不能从 `state.sessions`（`isVisibleSession` 过滤后）取。否则归档与隐藏会话永不入索引，`isArchived` / `hidden` 会恒为 `false`。

### 2.3 Agent 索引

```ts
interface CachedAgent {
  name: string;
  displayName: string;
  description?: string;
  model?: string;
  avatar?: string;
  hasAvatar: boolean;
  lastSessionLastActive?: number;  // 来源 last_session.last_active
}
```

`AgentProfile` 没有 `timestamp` 字段，活跃时间来自 `last_session.last_active`。

### 2.4 消息存储（IndexedDB）

两套互不兼容的来源：

| 来源 | 主键 | 工具调用 |
|---|---|---|
| 单会话 | `rowId`（数字行号） | 可能有（见 2.5） |
| 群聊 | `seq`（房间内序号） | 无 |

```ts
interface CachedMessage {
  profile: string;          // 群聊固定为 ''（hosted rooms 不属于任何 Profile）
  channel: 'session' | 'room';
  channelId: string;
  orderKey: number;         // session → rowId；room → seq

  role: 'user' | 'assistant' | 'system';
  text: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  timestamp: number;
  status: 'complete' | 'error' | 'interrupted';
  truncated?: boolean;
}
```

**群聊的 `profile` 固定为 `''`**：hosted rooms 存于网关根库，`groups.list` 的 `profile` 参数也是可选的。写入端必须单点归一化，否则多端会写出不同键。

**`role` 不含 `'tool'`**：工具调用折叠进所属 assistant 行，不独立成行。

**`status` 取契约 `TurnStatus = 'complete' | 'error' | 'interrupted'`**。

**行计数口径**：500 行按**缓存行**计数（磁盘上实际存在的 user/assistant/system 行）。工具调用折叠进所属 assistant 行，不额外占配额。

**存储结构**：

```text
DB: hermes_flux_cache (version 1)
├── store: messages
│   └── keyPath: [profile, channel, channelId, orderKey]
│       （游标按 keyPath 序迭代，无需额外索引）
└── store: sync_meta
    └── keyPath: key          // 'schemaVersion' | 'lastFullSync' | 'fence'
```

### 2.5 消息写入来源矩阵

| 来源 | 能写什么 | 写入条件 | 备注 |
|---|---|---|---|
| 【推】`message.complete` | `text`、`reasoning`、`persisted_turn.row_ids` | `persisted_turn.complete === true` | **无 `session_id`、无 `toolCalls`、无单值 `rowId`** |
| 【推】`tool.start` / `tool.complete` | `tool_id` / `name` / `args` / `result` | 按到达顺序折叠进上一条 assistant | 无所属消息 id |
| 【推】`message.reaction` | `reactions` | 只更新既有行的字段 | 不新增行 |
| 【拉】REST `?limit=50` | `id`（数字行号）、`role`、`content`、`timestamp`、`reasoning` 系列、`tool_calls` **（已实测均存在）** | 成功即写 | 主键 `id`；`hidden` 类字段是数字 |
| 【拉】`session.resume` | 仅降级路径（`omit_messages: false`）才写 | 默认传 `omit_messages: true`，不写 | — |
| 【拉】`groups.log` | `seq` / `event_id` / `actor` / `payload.text` / `created_at` | 循环至 `has_more=false` | 无 `rowId`、无 `toolCalls` |
| 【拉】`prompt.submit` | `user_row_id`、`survivor_row_id_map` | 成功后写 user 行 + 按 map 重绑定 | 仅在截断场景有 map |
| 【拉】`session.compress` | `removed` / `before_messages` / `after_messages` | 成功后整会话重拉 | 见规则 7 中段洞 |
| 【拉】`session.undo` / `session.branch*` / `session.activate` | 变更结果 | 成功后整会话重拉 | 不逐行推导 |
| 【拉】T0 副标题 `?limit=1` | 仅 `preview` 字段 | 只更新索引，不写消息表 | — |

**REST 是否携带 `thinking` / `tool_calls`（已实测确认）**：

2026-11-06 探针确认，`GET /api/sessions/{id}/messages` 的行**确实携带**：

| 字段 | 实测 |
|---|---|
| `reasoning` / `reasoning_content` / `reasoning_details` | 存在，样例行有非空思维链 |
| `tool_calls` | 存在且可为非空数组，元素含 `id` / `function.name` / `function.arguments` |
| `tool_call_id` / `tool_name` / `tool_call_uids` | 存在 |
| `id` | 数字主键（如 `42409`），即 `rowId` |

现有解析器（`index.ts:1875-1889`）读取的候选字段名与实测一致。

**写入策略**：REST 行字段完整，**优先用 REST 版本写入**；`tool.*` 事件只用于补实时回合中尚未落库的部分。合并时"字段更完整者胜出"。

**注意**：`tool_calls[].function.arguments` 是 JSON **字符串**，落盘时保留原样，展示层再解析；不要在这一层反序列化后重写（会丢失原始格式与转义）。

### 2.6 网关行 → 缓存行映射

`persisted_turn` 提供的是行号数组，不是完整消息。映射规则必须写死：

| 网关字段 | 映射到 | 说明 |
|---|---|---|
| `persisted_turn.user_row_id` | 一条 `role: 'user'` 行 | 主键 `orderKey = user_row_id` |
| `persisted_turn.final_assistant_row_id` | 一条 `role: 'assistant'` 行 | 正文来自 `payload.text`，`reasoning` 来自 `payload.reasoning` |
| `persisted_turn.row_ids` 中其余项 | **仅记录行号，不构造行、不构造 `toolCalls`** | `row_ids` 是纯数字数组，没有工具正文；工具内容只能来自 `tool.*` 事件或 REST 行 |
| `message.complete` 的 `payload.text` | 仅写入 `final_assistant_row_id` 对应行 | 不按 `row_ids` 数组逐条复制 |

**必须显式承认的局限**：`row_ids` 中其余行的正文无法从 `message.complete` 获得。若要完整还原，只能依赖 REST 行（探针 P3）或 `session.events.since`。本方案优先用 REST，不在事件侧做二次推导。

### 2.7 取号函数

REST 行主键字段名是 `id`（数字），不是 `row_id`。必须统一：

```ts
function resolveRowId(row: unknown): number | undefined {
  // 候选序：row_id → _row_id → rowId → id
  // 仅接受正整数；数字字符串一律拒绝
}
```

与现存 `extractDurableRowId`（`rollbackTransaction.ts:115-126`）完全一致，不得另写。

`user_row_id` / `final_assistant_row_id` 是命名位置字段，**不得**传入 `resolveRowId`。

---

## 三、时序

### T0 首次安装

| # | 发起方 | 方式 | 名称 | 缓存动作 |
|---|---|---|---|---|
| 1 | 客户端 | 【拉】 | `new WebSocket` + `ping` | — |
| 2 | 客户端 | 【拉】 | `profiles.list` | 写 Agent 索引 |
| 3 | 客户端 | 【拉】 | `GET /api/sessions?profile=X&limit=100` × N Profile | 写会话索引 |
| 4 | 客户端 | 【拉】 | `groups.list` | 写群聊索引 |
| 5 | 客户端 | 【拉】 | `profiles.get_asset({ name, asset })` | 写头像表 |
| 6 | 客户端 | 【拉】 | `GET .../messages?limit=1`（可见会话 ≤ 10 个） | 仅写副标题 |

### T1 冷启动（有缓存）

#### T1.0 同步恢复（不依赖网络）

| # | 发起方 | 方式 | 名称 | 说明 |
|---|---|---|---|---|
| 1 | 客户端 | 本地 | 读索引池（会话 + 群聊） | 校验 `v`，填 `state` |
| 2 | 客户端 | 本地 | 读 Agent 索引 | — |
| 3 | 客户端 | 本地 | 读头像表 | — |
| 4 | 客户端 | 本地 | 同步 `render()` | 列表可见，不等待网络 |

#### T1.1 连接

`new WebSocket` → `ping` → `{pong:true}` → FSM CONNECTED → 心跳（15s / 5s）。

#### T1.2 后台对齐

| # | 发起方 | 方式 | 名称 | 缓存动作 |
|---|---|---|---|---|
| 1 | 客户端 | 【拉】 | `profiles.list` | 权威端不存在的 `name` 从本地删除 |
| 2 | 客户端 | 【拉】 | `GET /api/sessions?profile=X&limit=100` × N | 同 1.2 的上限规则 |
| 3 | 客户端 | 【拉】 | `groups.list` | 同群聊索引 |
| 4 | 客户端 | 本地 | 覆盖 `state`，有差异才重渲染 | — |
| 5 | 客户端 | 本地 | 异步写回磁盘 | — |

**任一 Profile 失败 → 本轮不作权威，不删除任何本地条目。**

### T2 打开一个会话

| # | 发起方 | 方式 | 名称 | 说明 |
|---|---|---|---|---|
| 1 | 客户端 | 本地 | IndexedDB 按 keyPath 倒序取 500 行 | — |
| 2 | 客户端 | 本地 | 命中则立即渲染 | — |
| 3 | 客户端 | 【拉】 | `GET /api/sessions/{id}/messages?limit=50&order=latest` | 同时进行 |
| 4 | 客户端 | 本地 | 按 `orderKey` 合并，执行规则 7 的 fence 判定 | 纯函数 |
| 5 | 客户端 | 本地 | upsert 写回 | — |
| 6 | 客户端 | 【拉】 | `session.resume({ session_id, omit_messages: true })` | **必须传** |
| 7 | 网关 | 应答 | `{ session_id: <live>, running, inflight }` | 校正运行态 |

**第 6 步不传 `omit_messages` 会触发全量 dump（实测 6~7 秒）**。

**第 3 步不能因缓存命中而跳过**。

### T3 运行期写入

| 触发 | 发起方 | 方式 | 名称 | 缓存动作 |
|---|---|---|---|---|
| 发送提问 | 客户端 | 【拉】 | `prompt.submit` | 成功后写 user 行；截断场景按 `survivor_row_id_map` 重绑定 |
| 流式吐字 | 网关 | 【推】 | `message.delta` × N | 不写盘 |
| 回合完成 | 网关 | 【推】 | `message.complete` | `complete=true` 才写 |
| 工具调用 | 网关 | 【推】 | `tool.start` / `tool.complete` | 聚合进上一条 assistant |
| 标题变化 | 网关 | 【推】 | `session.title` | 归一化 liveId → patch 索引 |
| 列表变化 | 网关 | 【推】 | `sessions.changed` | 立即回拉 |
| 群聊新消息 | 客户端 | 【拉】 | `groups.log({ since_seq })` | 循环至 `has_more=false` |

### T4 关闭

`visibilitychange` → hidden 与 `beforeunload` 各 flush 一次（幂等）。

顺序：**消息 → 索引 → Agent → 头像**。

---

## 四、实时更新

### 4.1 能保证的

| 数据 | 事件 | 路径 |
|---|---|---|
| 会话增删改 | `sessions.changed`（空 payload） | 收到即回拉 |
| 会话标题 | `session.title` | 归一化后 patch |
| 消息正文 | `message.complete` | 写 IndexedDB |
| 工具调用 | `tool.*` | 聚合写盘 |

### 4.2 不能保证的（协议无事件）

72 个契约事件（matrix 口径 77）中没有 `profiles.*`，也没有 `groups.*`。

| 数据 | 兜底 |
|---|---|
| Agent 列表 | 启动 / 重连 / `window.focus` / 进入设置页 |
| 群聊新消息 | `groups.log({ since_seq })` 轮询 |

### 4.3 `sessions.changed` 不做长去抖

收到信号**立即发起**拉取；在途期间的重复信号合并；返回后若又有信号，补一次。

---

## 五、一致性规则

### 规则 1：权威门覆盖四类

全量成功才允许删除本地条目。覆盖会话索引、群聊索引、Agent 索引、头像。

必须修的两处：

- `fetchGroupRooms` 内层 catch 吞异常并把 `state.groupRooms` 清空 → 改为保留 + 错误态；
- `listProfiles` 失败返回假 `default` → 改为抛错或 `null`。

### 规则 2：删除双向传播

| 场景 | 本地动作 | 时机 |
|---|---|---|
| 删除会话 | 删索引 + 删消息 + 记内存墓碑 | RPC 成功之后 |
| 回滚截断 | 按 `survivor_row_id_map` 重绑定 + 删超出部分 | RPC 成功之后（规则 6） |
| 权威回拉发现不存在 | 删索引 + 删消息 | 仅全量成功时 |
| 会话压缩 | 整会话重拉 | `session.compress` 成功后 |

### 规则 3：幂等 upsert

同一 `(profile, channel, channelId, orderKey)` 覆盖而非追加。**字段更完整者胜出**（带 `reasoning` / `toolCalls` 的版本优于不带的）。

### 规则 4：每会话 500 行

超出后删最小 `orderKey`。按网关行计数。

### 规则 5：不参与运行态判定

`running` / `inflight` 唯一权威是 `session.resume`。

**`running: true | false | unknown`**：

- `unknown` **不禁用发送**——否则 `session.resume` 持续失败会让用户永久无法发送，而发送本身是恢复链路的入口；
- `unknown` 允许提交，由 `prompt.submit` 的 4001 / 4002 回执纠正；
- `unknown` 设 3s 超时，退化为 `false` 并提示"运行态未确认"。

### 规则 6：截断以 `survivor_row_id_map` 为唯一权威

契约原文（`gateway-contract.generated.ts:2706`）：

> After a truncation the survivor row ids let the client rebind its cached `rowId`s (`None` map entries: drop the cached id).

```text
阶段 1  armed
    → 只改内存 + 存内存快照，IndexedDB 完全不动

阶段 2  prompt.submit 成功
    → 读 result.survivor_row_id_map
       值为数字 n  → 把旧 orderKey 的本地行 rebind 到 n
       值为 null    → 删除该本地行
    → 兜底：orderKey > 目标 且不在 map 中的行删除
    → 记录墓碑

阶段 3  RPC 失败 / 用户取消
    → 恢复内存快照，磁盘从未被触碰

阶段 4  RPC 超时（结果未知）
    → 内存标 stale
    → 立即回拉
    → 不恢复快照、不动磁盘
```

**为什么不能用"删 `> 目标`"替代**：截断后幸存行的 `rowId` 会变。只删 `> 目标` 会留下旧键与 REST 拉回的新键**并存**，同一消息出现两份。

### 规则 7：幽灵边界 + 快照围栏

单纯用"远端 max(orderKey)"做删除上界会产生确定性竞态：

```text
T0 本地 max = 100
T1 发起 REST 拉取（此刻服务端 max = 100）
T2 prompt.submit 返回 user_row_id = 101 → 写盘，本地 max = 101
T3 T1 响应到达，max = 100 → 规则判定 101 > 100 且已不在 pending → 删除刚写入的 101
```

**必须加围栏**，默认实现写死为**代际守卫**（改动最小，复用现有机制）：

1. **代际守卫（默认）**：剔除逻辑必须挂在现有 `activeLoadMessagesGeneration` 的代际比较之后，禁止另起一套判定；
2. 快照围栏（备选）：拉取发起时记录 `fenceMax = 本地 max(orderKey)`，仅当 `fenceMax >= 本次远端 max` 时才允许剔除；
3. 写入水位（备选）：本地维护 `lastLocalWriteAt`，远端响应的 `requestStartedAt` 早于它则跳过剔除。

**群聊的权威上界不同**：room 的剔除上界取 `latest_seq`，且必须同时校验 `authority.epoch`。`groups.promote` 更换 authority 后 seq 空间会改变，epoch 不一致时整房间重拉，不做剔除。

**中段洞检测**（防压缩导致的空洞）：合并时若本地连续区间 `[min, max]` 中出现服务端整段缺失，且该会话在服务端 `message_count` 变小，则**整会话重拉**，不做逐行剔除。

### 规则 8：`profilesLoaded` 门有两处

`state.profiles.length === 0` 在 `renderer/index.ts` 出现**两次**（约 1160 与 1393 行）。两处都必须改成显式 `profilesLoaded` 标记。

### 规则 9：用户行永不截断

- 512KB 截断**只作用于 assistant/tool 行**；
- `role: 'user'` 行超限时整行保留，宁可单条写入失败也不截断；
- `truncated: true` 的行**禁止用于回滚回填**（回滚会用正文填回输入框，截断后会把半截正文当新提问提交），必须先 REST 取全文；
- `truncated: true` 的行必须用 `truncated` 字段保存截断标记（供读取层判断，避免误判为完整内容后直接展示）；复制/导出时提示"内容已截断"。

### 规则 10：群聊游标循环

`groups.log` 单页 100 条，`has_more` 为真时必须继续拉，否则间隔超过 100 条事件就出现空洞。游标取响应的 `latest_seq`，不是本地最后一条事件的 `seq`。

---

## 六、与协议对齐

| 缓存项 | 权威源（【拉】） | 变更通知（【推】） | 状态 |
|---|---|---|---|
| 会话索引 | `GET /api/sessions`（REST） | `sessions.changed` | ✅ |
| 会话标题 | `session.title`（拉，即 `session.title` RPC） | `session.title`（推，同名事件） | ⚠️ 需 liveId→storedId |
| 群聊索引 | `groups.list` | ❌ 无事件 | ⚠️ 聚焦拉取 |
| 群聊消息 | `groups.log({since_seq})` | ❌ 无事件 | ⚠️ 轮询 + `has_more` |
| Agent 索引 | `profiles.list` | ❌ 无事件 | ⚠️ 聚焦拉取 |
| 头像 | `profiles.get_asset` | ❌ 无事件 | ⚠️ 同 Agent |
| 消息正文 | REST `?limit=50` + `message.complete` | 同左 | ⚠️ 见 2.5 |
| 消息删除 | 截断 RPC 的 `survivor_row_id_map` | ❌ 无专用事件 | ⚠️ 规则 6 |
| 网关纪元 `replay_epoch` | `gateway.ready` | 同左 | ❌ 未接，本方案不依赖 |

**为什么本方案不依赖 `replay_epoch`**：缓存键是 `(profile, channel, channelId, orderKey)`，`orderKey` 来自网关 SQLite 行号，进程重启不改行号。只有事件游标（`since_seq`）需要 epoch 判定，而本方案不存事件游标。

### 6.1 编排层处置

`packages/core/src/session/unifiedSessionList.ts` 的 `orchestrateUnifiedLeftRail` 已从 `core/src/index.ts:33` 公开导出，但 **desktop 0 处引用**，属"物理入口不可达"的门禁违规。配套定理 12~16 编码的不变量（墓碑驱逐、失败不致空、全序单调、幂等）与本规范规则 2/5/7 高度重叠。

**本方案的处置**：

1. **生产路径不变**：继续使用 `reconcileSessionList`，本方案不切换编排层（切换会改变列表排序/去重/可见性行为，超出缓存范围）。
2. **模块状态改为 `@deprecated`**，文件头标注"未被生产路径消费；若复用须先迁移本规范规则 2/5/7 的等价单测"。
3. **不变量等价要求**：本规范规则 2（删除传播）、规则 5（运行态不缓存）、规则 7（幽灵边界 + 围栏）必须在 `reconcileSessionList` 路径上各补一条可变红的单测，作为定理 12~16 的等价替代。
4. **清理动作单独立项**：决定"复用"或"删除模块 + 归档定理"，必须在本方案 P0 全部落地前给出结论，不允许长期悬挂。

---

## 七、实施清单

### P0

| # | 事项 |
|---|---|
| 1 | 三项探针已闭环（1.3），无需重跑 | 结论已回填 1.2 / 2.2 / 2.5 |
| 2 | 会话 + 群聊索引落盘（统一 200 池，带 `v`），快照取 `allMerged` |
| 3 | Agent 索引落盘（排除 `uiMeta`，用 `lastSessionLastActive`） |
| 4 | 头像表落盘 |
| 5 | 消息落 IndexedDB（`profile + channel + channelId + orderKey` 四元主键） |
| 6 | `resolveRowId` 唯一取号函数（拒绝数字字符串） |
| 7 | `message.complete` 仅 `complete=true` 写盘；行映射按 2.6 |
| 8 | `tool.*` 聚合进 assistant 行 |
| 9 | 群聊消息用 `seq`，`profile` 固定 `''`，不写 `toolCalls` |
| 10 | 两处 `profiles.length === 0` 改 `profilesLoaded` |
| 11 | `listProfiles` 失败不返回假 `default` |
| 12 | `groups.list` 失败不清空列表 |
| 13 | `groups.log` 传 `since_seq` + 循环至 `has_more=false` |
| 14 | `session.resume` 传 `omit_messages: true` |
| 15 | 截断按 `survivor_row_id_map` 重绑定（规则 6 四阶段） |
| 16 | 幽灵边界 + 快照围栏（规则 7，实施时写死一种实现） |
| 17 | 草稿清空时机修正（成功后清空、失败回填） |
| 18 | `sessions.changed` 立即回拉 |
| 19 | 三条等价单测（规则 2/5/7），替代定理 12~16 |
| 20 | 编排层 `@deprecated` 标注 + 清理立项 |

### P1

| # | 事项 |
|---|---|
| 21 | 窗口聚焦强制拉 `profiles.list` |
| 22 | `session.title` liveId→storedId 归一化 |
| 23 | 移动端 `persist()` 三分支降级 + `estimate()` 阈值 |
| 24 | 用户行豁免截断 + `truncated` 行禁止回填 |
| 25 | `running: unknown` 第三态（不禁用发送） |
| 26 | 旧键迁移（`previews` 按 `lastActive` 取前 200） |

---

## 八、验收测试

| # | 场景 | 通过标准 |
|---|---|---|
| T1 | 关网关冷启动（单 Profile） | 100 条会话 + Agent + 头像可见；多 Profile 环境 200 条 |
| T2 | 有 500 行缓存时打开会话 | 历史立即渲染，同时发 REST |
| T3 | 推 `sessions.changed` | 一次 RPC 往返内更新 |
| T4 | 推 `session.title`（liveId） | 正确 patch 到 storedId 条目 |
| T5 | 推 `message.complete`（`complete=true`） | 按 2.6 映射写入，`reasoning` 正确 |
| T6 | 推 `message.complete`（`complete=false`） | 不写盘，触发回拉 |
| T7 | REST 行主键为 `id` | `resolveRowId` 取到数字行号 |
| T8 | 群聊 300 条历史 | `seq` 主键，`profile=''`，无 `toolCalls` |
| T9 | 截断成功后 `survivor_row_id_map` 含数字与 null | 数字项被 rebind，null 项被删除 |
| T10 | 截断 RPC 失败 | 磁盘未被删除，内存恢复 |
| T11 | 截断 RPC 超时 | 内存标 stale 并回拉，磁盘不动 |
| T12 | 拉取期间写入新消息 | fence 生效，新消息不被误删 |
| T13 | 会话被压缩（`message_count` 变小） | 整会话重拉，无空洞 |
| T14 | 删除会话后重启 | 索引与消息均不存在 |
| T15 | 两来源同 `orderKey` | 不重复，字段更完整者胜出 |
| T16 | 写入第 501 行 | 最旧一行淘汰 |
| T17 | 某 Profile 拉取失败 | 本地列表不减少 |
| T18 | `groups.list` 失败 | 群聊列表不清空 |
| T19 | 新增 Agent（无事件） | 窗口聚焦后可见 |
| T20 | 发送时网络失败 | 输入框回填 |
| T21 | 缓存 JSON 损坏 | 丢弃重建，不崩溃 |
| T22 | assistant 行 5MB | 截断至 512KB + `truncated` |
| T23 | user 行 5MB | **不截断**，整行保留或整条失败 |
| T24 | `truncated` 行回滚 | 禁止回填，提示取全文 |

---

## 九、术语

| 术语 | 含义 |
|---|---|
| **`orderKey`** | 单会话为 `rowId`，群聊为 `seq`；唯一可靠的排序与去重依据 |
| **`survivor_row_id_map`** | 截断后幸存行的新旧行号映射；值为 `null` 表示该行已不可恢复 |
| **fence（快照围栏）** | 用"拉取发起时的本地最大序"约束剔除范围，防误删拉取期间新写入的行 |
| **权威门** | 只有全量成功的拉取才允许删除本地条目 |
| **`persisted_turn.complete`** | 网关声明本轮行号已确认；`false` 时行号不可信 |
| **stale** | 显示的是本地旧数据，尚未与权威对齐 |
