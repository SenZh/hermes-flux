# 网关与客户端交互协议全景
(Gateway ⇄ Client Interaction Protocol: Who Initiates, Push or Pull)

> **基线**：Hermes Gateway v0.22.5 实测 + 契约快照 `4364a2dd0064`
> **契约规模**：257 个 RPC 方法 · 14 个反向请求 · 77 个下行事件
> **配套文档**：`docs/gateway/events.md`（自动生成的事件清单）、`docs/gateway/sessions.md`（会话接口清单）
> **本文目的**：把每一次交互的 **发起方、方式（推还是拉）、接口名** 三者钉死，不再含糊。

---

## 零、先记住三种通信形态

整套协议只有三种交互形态。任何一次数据流动，先判断它属于哪一种，剩下的都能推出来。

| 形态 | 方向 | 谁发起 | 要不要应答 | 数据在哪 | 典型例子 |
|---|---|---|---|---|---|
| **接口调用** | 客户端 → 网关 | **客户端** | 要（request / response） | 在 `result` 里 | `session.list`、`session.resume`、`prompt.submit` |
| **事件推送** | 网关 → 客户端 | **网关** | **不要**（单向） | 在 `payload` 里，或干脆没有 | `sessions.changed`、`message.delta` |
| **反向请求** | 网关 → 客户端 | **网关** | **必须应答** `result` | 客户端返回给网关 | `approval`、`sudo`、`secret` |

三条铁律：

1. **客户端不能主动"上报事件"** —— 协议里不存在这个动作。客户端只能发起接口调用，或应答网关的反向请求。
2. **推送分两种**：带数据的推送（`message.delta` 带文本）和**只带信号的推送**（`sessions.changed` payload 是空对象）。后者必须由客户端再发一次接口调用去拉。
3. **同一条 WebSocket 同时承载这三种形态**，靠 `id` 字段区分：带 `id` 的是请求/响应或反向请求，无 `id` 的是事件推送。

---

## 一、连接生命周期

| # | 发起方 | 方式 | 名称 | 说明 | 代码 |
|---|---|---|---|---|---|
| 1 | 客户端 | 拉（连接） | `new WebSocket(url)` | TCP + HTTP Upgrade，建立长连接 | `rpc/client.ts:396` |
| 2 | — | — | FSM 状态迁移 | `CONNECTING` → `HANDSHAKING` | `rpc/fsm.ts` |
| 3 | 客户端 | 拉（接口） | `ping` | 最轻量存活探针，参数 `{}` | `rpc/client.ts:402` |
| 4 | 网关 | 应答 | `{ pong: true }` | 握手成功 | 0.22.5 实测 |
| 5 | — | — | FSM 状态迁移 | `HANDSHAKING` → `CONNECTED`，启动心跳 | `rpc/fsm.ts` |
| 6 | 客户端 | 拉（接口） | `profiles.list` | 铺专职 Bot 卡片 | `renderer/index.ts:4243` |
| 7 | 客户端 | 拉（接口） | `session.list`（逐 Profile 并发） | 铺普通会话列表 | `renderer/index.ts:1184` |

**心跳看门狗**（连接建立后持续运行）：

| 项 | 值 | 行为 |
|---|---|---|
| 探测间隔 | 15 000 ms | 定时发 `ping` |
| 判定超时 | 5 000 ms | 无响应则判定半开连接，主动 `close()` |
| 重连退避 | 初始 1 000 ms，×1.5，上限 30 000 ms，full jitter | 无限重试 |
| 状态迁移 | `CONNECTED → RECONNECTING → CONNECTING` | 退避到期后重新走第 1 步 |

> 注意：握手只用 `ping`，**没有消费 `gateway.ready`**。因此客户端无法区分"TCP 已连"和"网关真正就绪"，也拿不到网关的 `replay_epoch`（重放纪元）。见第九节缺口。

---

## 二、Session 的两层概念

### 2.1 传输连接 ≠ 业务会话

| 概念 | 是什么 | 生命周期 | 谁分配 |
|---|---|---|---|
| **WebSocket 连接** | 传输层管子，与具体对话无关 | 断线后由 FSM 重建 | 客户端发起 |
| **业务会话** | 存在网关 SQLite 里的对话 | 持久，重启不丢 | 网关 |

同一根管子上可以先后 `resume` 多个会话；同一个会话也可以被多台设备各自 `resume`。**管子断了，对话还在。**

### 2.2 业务会话的双 ID

| ID | 形态 | 什么时候有 | 用在哪些接口 |
|---|---|---|---|
| `stored_session_id` | `20261028_155631_8bcc62` | 落库后一直有 | `session.list`、REST 分页、`session.resume` 的入参 |
| `session_id`（live） | `46546345` | **只在 resume 之后才有**，属于本次连接 | `prompt.submit`、`config.set`、`session.interrupt` |

**唯一兑换途径**：`session.resume({ session_id: <stored> })`，返回里带 live id。

这是 0.22.5 探针打出来的硬事实：把 stored id 直接传给 `prompt.submit`，网关返回 `4001 session not found`。

**推论**：live id 会随连接消失。重连之后必须重新 resume，否则旧 live id 失效。

---

## 三、场景一：冷启动铺列表（存量对齐）

| # | 发起方 | 方式 | 名称 | 载荷 / 结果 |
|---|---|---|---|---|
| 1 | 客户端 | 拉（接口） | `profiles.list` | `{}` → `{ profiles: [...] }` |
| 2 | 客户端 | 拉（接口） | `session.list` × N 个 Profile 并发 | `{ profile, limit: 100 }` → `{ sessions: [...] }` |
| 3 | 客户端 | 本地计算 | 复合键去重 + 可见性过滤 + 时间归一化 | 纯函数，零网络 |
| 4 | 客户端 | 本地计算 | 写 L1 内存 + 异步落 L2 | — |

**没有推送参与**。这是一次纯粹的拉取，因为冷启动时网关不知道你是谁、关心哪些会话。

**部分失败的处理**：任一 Profile 的 `session.list` 失败，本轮标记 `authoritative = false`，只合并成功结果，**绝不删除本地任何条目**。

---

## 四、场景二：打开一个历史会话

这里同时用了**拉接口**的两条通道，且顺序固定。

| # | 发起方 | 方式 | 名称 | 说明 |
|---|---|---|---|---|
| 1 | 客户端 | 拉（REST） | `GET /api/sessions/{id}/messages?limit=50&order=latest` | **首选**。实测 < 50 ms，先上屏 |
| 2 | 客户端 | 拉（接口） | `session.resume({ session_id })` | **后台并发**。拿 live id + 权威运行态 |
| 3 | 网关 | 应答 | `{ session_id: <live>, stored_session_id, running, inflight, messages, ... }` | live id 存入句柄表 |
| 4 | 客户端 | 本地计算 | 用 `res.running` / `res.inflight` 校正本地幽灵运行态 | 防"永远转圈" |

**为什么不用 `session.resume` 拿首屏？**
`session.resume` 走 WS 全量 dump，实测约 6 500 ms；REST 分页 50 条 < 50 ms。差两个数量级。

**为什么 `session.history` 不能用？**
探针实测：传 `limit` 报 `4000 Extra inputs`，不传参报会话不存在。这个接口在当前版本不可用于分页。

---

## 五、场景三：发一条消息（推拉混合，最典型）

| # | 发起方 | 方式 | 名称 | 说明 |
|---|---|---|---|---|
| 1 | 客户端 | 本地 | 生成 `tmp_id`，乐观插入 L1 | 立刻上屏 |
| 2 | 客户端 | 拉（接口） | `prompt.submit({ session_id: <live>, text })` | **只认 live id** |
| 3 | 网关 | 应答 | `{ status: 'streaming', user_row_id, ... }` | 回执 |
| 4 | 网关 | 推（事件） | `message.start` | 回合开始，无数据 |
| 5 | 网关 | 推（事件） | `message.delta` × N | **带数据**：`{ text }` 流式片 |
| 6 | 网关 | 推（事件） | `thinking.delta` / `reasoning.delta` | **带数据**：思维链 |
| 7 | 网关 | 推（事件） | `tool.start` / `tool.complete` | **带数据**：工具调用 |
| 8 | 网关 | 推（事件） | `message.complete` | **带数据**：终态文本、usage、状态 |
| 9 | 网关 | 推（事件） | `session.info` | 刷新后的会话实时视图 |
| 10 | 网关 | 推（事件） | `sessions.changed` | **空 payload 信号**，表示列表需要刷新 |

实测抓包序列（0.22.5）：

```
prompt.submit → message.start → message.delta… → message.complete → session.info → sessions.changed
```

一轮对话 `sessions.changed` 会推 3~4 次，所以客户端必须去抖（现状 180 ms）。

**这里的关键分工**：消息内容靠**推送**（第 5~8 步），列表状态靠**信号 + 回拉**（第 10 步）。

---

## 六、场景四：在线期间列表发生变化

这是"推 → 拉"的组合模式，也是全文最容易被误解的地方。

| # | 发起方 | 方式 | 名称 | 说明 |
|---|---|---|---|---|
| 1 | 网关 | 推（事件） | `sessions.changed` | **payload 是空对象**，只说"变了"，不说"变了什么" |
| 2 | 客户端 | 本地 | 180 ms 去抖合并突发信号 | 防风暴 |
| 3 | 客户端 | 拉（接口） | `session.list` 重新全量拉 | 拿到真正的变更内容 |

**哪些推送带数据，哪些只是信号**：

| 类型 | 事件 | payload | 客户端动作 |
|---|---|---|---|
| **带数据** | `message.delta` / `message.complete` / `thinking.delta` / `reasoning.delta` | 文本、usage | 直接渲染 |
| **带数据** | `session.title` | `{ session_id, title }` | 原地 patch 标题 |
| **带数据** | `session.info` | 模型、运行态、usage 等 30 个字段 | 更新顶部元信息 |
| **带数据** | `tool.start` / `tool.complete` | 工具名、参数、结果 | 渲染工具胶囊 |
| **纯信号** | `sessions.changed` | 空 | **必须回拉 `session.list`** |
| **纯信号** | `projects.changed` | 空 | 回拉项目列表（未实装） |
| **纯信号** | `cron.changed` | 空 | 回拉定时任务（未实装） |
| **纯信号** | `pairing.changed` / `platforms.changed` | 空 | 回拉对应配置（未实装） |
| **纯信号** | `bot_relay.outbox.pending` | 空 | 回拉 outbox（未实装） |

**为什么这样设计？**
会话列表的变更可能来自任何一端、任何 Profile，网关不知道每个客户端持有哪个子集。发一个空信号让客户端自己拉，比维护"每个客户端关心什么"的订阅表简单得多。代价是客户端必须承受一次全量拉取。

---

## 七、场景五：多端协同（B 端如何看到 A 端的提问）

| # | 发起方 | 方式 | 名称 | 说明 |
|---|---|---|---|---|
| 1 | A 端 | 拉（接口） | `prompt.submit` | 用户提问落库 |
| 2 | 网关 | 推（事件） | `message.start` | **只推给所有订阅方，不含提问内容** |
| 3 | B 端 | 本地 | 判定"上一条不是该用户的提问" → 说明是别人发的 | — |
| 4 | B 端 | 拉（接口） | `session.events.since({ session_id, last_seen })` | **补拉缺失的提问** |
| 5 | 网关 | 应答 | `{ events, latest_seq, truncated, epoch }` | 增量事件 |
| 6 | B 端 | 本地 | 按 `seq` 插入提问 → 回放暂存的 delta | — |

**现状**：第 4 步**未实装**。B 端目前只能看到 AI 的回复，看不到 A 端问了什么。缺口见第九节。

---

## 八、场景六：断线重连后的对齐

| # | 发起方 | 方式 | 名称 | 现状 |
|---|---|---|---|---|
| 1 | 客户端 | 本地 | 心跳 5 s 超时 → 主动 `close()` | ✅ 已实装 |
| 2 | 客户端 | 本地 | FSM `RECONNECTING`，指数退避重连 | ✅ 已实装 |
| 3 | 客户端 | 拉（接口） | `profiles.list` 重新拉 | ✅ 已实装 |
| 4 | 客户端 | 拉（接口） | `session.list` 全量重建列表 | ✅ 已实装 |
| 5 | 客户端 | 拉（接口） | `session.resume` 重新兑换当前会话 live id | ❌ **未实装** |
| 6 | 客户端 | 拉（接口） | `session.events.since(last_seen)` 补齐离线期间消息 | ❌ **未实装** |
| 7 | 客户端 | 拉（REST） | `GET /api/sessions/{id}/messages` 重拉最近 50 条 | ⚠️ 部分（只在打开会话时拉） |

**第 5 步缺失的后果**：重连后用户继续在当前会话发消息，`prompt.submit` 拿旧 live id → `4001 session not found`。

**第 6 步缺失的后果**：离线期间产生的消息如果超过 50 条，中间永久缺一截，且因为没有序号，无法判断"缺没缺"。

---

## 九、增量对齐能力矩阵

| 能力 | 需要什么 | 接口 / 事件 | 现状 |
|---|---|---|---|
| 列表存量 | 全量拉 | `session.list` | ✅ |
| 列表变更通知 | 信号 | `sessions.changed`（推） | ✅ |
| 列表变更内容 | 信号后回拉 | `session.list` | ✅ |
| 标题变更 | 带数据推送 | `session.title`（推） | ✅ |
| 消息实时增量 | 带数据推送 | `message.delta`（推） | ✅ |
| **消息断点续传** | **游标 + 增量拉** | `session.events.since({ last_seen })` | ❌ 未接 |
| **重放纪元判定** | **纪元号** | `gateway.ready.replay_epoch`（推） | ❌ 未接 |
| 会话被回收 | 信号 | `session.reclaimed`（推） | ❌ 未接 |
| 连接真正就绪 | 握手帧 | `gateway.ready`（推） | ❌ 未接（用 ping 代打） |

### `session.events.since` 契约

| 项 | 内容 |
|---|---|
| 入参 | `session_id`（live）、`profile`、`last_seen`（上次已消费的最后一个 seq） |
| 出参 | `events[]`、`latest_seq`、`truncated`、`count`、`epoch`、`open_requests` |
| 语义 | `last_seen` 之前的事件不重发；`truncated=true` 表示网关缓存已滚掉，必须降级全量；`epoch` 变化表示网关重启过，本地序号全部作废 |

这是整套协议里**唯一能真正"追平"**的机制。没有它，断线后的补偿只能靠全量重拉，且无法证明补齐了。

---

## 十、速查表

### 10.1 客户端发起的接口（按场景）

| 接口 | 用途 | 发起方 | 方式 |
|---|---|---|---|
| `ping` | 握手 / 心跳探针 | 客户端 | 拉 |
| `profiles.list` | 专职 Bot 列表 | 客户端 | 拉 |
| `profiles.describe` | Bot 详细档案 | 客户端 | 拉 |
| `session.list` | 会话列表 | 客户端 | 拉 |
| `session.create` | 新建会话 | 客户端 | 拉 |
| `session.resume` | 兑换 live id + 拿历史与运行态 | 客户端 | 拉 |
| `session.delete` / `session.archive` / `session.title` | 生命周期操作 | 客户端 | 拉 |
| `session.interrupt` | 中断本轮 | 客户端 | 拉 |
| `prompt.submit` | 发送提问 | 客户端 | 拉 |
| `config.set` | 改模型 / 思考深度 | 客户端 | 拉 |
| `session.events.since` | **增量补拉** | 客户端 | 拉（未实装） |
| `GET /api/sessions/{id}/messages` | 历史分页 | 客户端 | 拉（REST） |
| `GET /api/profiles/sessions/sidebar` | 侧边栏切片聚合 | 客户端 | 拉（REST） |

### 10.2 网关推送的事件（与本文相关）

| 事件 | payload | 客户端已接 | 接法 |
|---|---|---|---|
| `sessions.changed` | 空 | ✅ | 信号 → 回拉列表 |
| `session.title` | `session_id` `title` | ✅ | 原地 patch |
| `message.start` | 无 | ✅ | 建占位气泡 |
| `message.delta` | `text` | ✅ | 追加流式 |
| `message.complete` | `text` `usage` `status` | ✅ | 定格 + 落盘 |
| `thinking.delta` / `reasoning.delta` | `text` | ✅ | 思维链 |
| `tool.start` / `tool.complete` | 工具信息 | ✅ | 工具胶囊 |
| `session.info` | 30 字段实时视图 | ❌ | 顶部元信息 |
| `session.reclaimed` | `session_id` `reason` | ❌ | 从列表移除 |
| `projects.changed` | 空 | ❌ | 回拉项目 |
| `gateway.ready` | `skin` `change_events` `replay_epoch` `heartbeat` | ❌ | 判定就绪 + 取纪元 |
| `error` | `message` | ✅ | 失败提示 |

完整 77 条见 `docs/gateway/events.md`。

### 10.3 网关反向请求（14 个，客户端必须应答）

| 方法 | 场景 | 客户端响应 |
|---|---|---|
| `approval` | 高危命令（rm、drop、git reset） | `allow` / `forever` / `deny` |
| `clarify` | Agent 反问用户 | `answers` |
| `setup_choose` | 首次引导选项 | `value` |
| `sudo` | 需要提权 | 密码 |
| `secret` | 缺密钥 | 密钥值 |
| `vault.code` | 2FA / 短信验证码 | 6 位码 |
| `vault.save_login` | 检测到新账号密码 | `{identifier, password}` |
| `vault.unlock_prompt` | 解锁本地保险库 | 主密码 |
| `display.install.sudo` | 安装虚拟桌面依赖 | sudo 密码 |
| `preview.act` | 内嵌浏览器点击/滚动/输入 | ValueResult |
| `preview.read` | 提取渲染文本 | JSON text |
| `terminal.read` | 读终端缓冲 | JSON text |
| `window.read` | 探测原生窗口 | JSON text |
| `tour` | 新手引导气泡 | ValueResult |

这 14 个是唯一"网关主动要你给数据"的通道。除此之外，网关不会向客户端索取任何东西。

---

## 十一、缺口与实施顺序

| 优先级 | 缺口 | 补法 | 依赖 |
|---|---|---|---|
| P0 | 重连后不重新 resume | 重连成功后对当前会话再调一次 `session.resume` | 无 |
| P0 | `listProfiles` 失败返回假 default | 改成抛错或返回 null，由调用方保留旧值 | 无 |
| P1 | `gateway.ready` 未接 | 握手后等首帧，取 `replay_epoch` 存本地 | 无 |
| P1 | `session.events.since` 未接 | 记住每会话 `latest_seq`，断线重连后带 `last_seen` 补拉 | 需要 P1 的 epoch 判定 |
| P2 | `session.reclaimed` 未接 | 空信号 → 从列表移除对应会话 | 无 |
| P2 | `projects.changed` 未接 | 空信号 → 回拉项目列表 | 无 |

**顺序不能颠倒**：`session.events.since` 的 `last_seen` 起点依赖 `epoch` 判定，而 `epoch` 来自 `gateway.ready`。先接 since 而不接 ready，会在网关重启后拿着作废的序号去拉，拿到错误的增量。

---

## 十二、术语表

| 术语 | 含义 |
|---|---|
| **拉（Pull）** | 客户端主动发接口调用，网关应答。数据在 `result` 里 |
| **推（Push）** | 网关主动发事件，客户端被动接收，不应答 |
| **纯信号（Signal）** | payload 为空的推送，只表示"某处变了"，必须由客户端回拉 |
| **反向请求** | 网关主动发起的请求，客户端必须返回 `result` |
| **live id** | `session.resume` 后得到的运行期句柄，随连接存亡 |
| **stored id** | 落库会话 ID，持久存在 |
| **last_seen** | 客户端已消费到的最后一个事件序号，`session.events.since` 的游标 |
| **epoch** | 网关重放纪元，网关重启后变化，用于判定本地序号是否作废 |
| **truncated** | 网关事件缓存已滚掉该游标之前的记录，必须降级全量拉 |
