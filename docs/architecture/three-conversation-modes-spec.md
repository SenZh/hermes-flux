# Hermes Flux 三大对话模式系统架构与工程规范 (Three Conversation Modes Spec)

> **文档代号**：`FLUX-SPEC-CONV-MODES-v1`  
> **状态**：Normative（权威架构与单一真值源）  
> **适用终端**：Desktop (Electron), Web, Mobile (Capacitor)  
> **核心领域**：普通会话 (Scratchpad) · 专职 Bot 终身主工位 (Forever Chat) · 多 Agent 群聊研讨室 (Group Room)

---

## 一、 背景与架构痛点 (Context & Problem Statement)

在 Hermes Flux 工作台演进过程中，如果缺乏严格的领域实体正交性建模，极易滑入以下四大灾难性工程陷阱：

1. **实体混淆与冒名覆盖 (Entity Hijacking)**：
   扫描普通会话池（`state.sessions`）拿最近的旁聊时间或副标题覆盖微轨与抽屉顶部的专职 Bot 卡片（`rail-primary-agent-card`），导致专家人设时间倒退、副标题闪烁篡改。
2. **协议通道错配 (Channel Misalignment)**：
   将群聊房间 ID（`room_id`）误当成 `session_id` 发起 `prompt.submit`，触发网关 `[4001] session not found`；或者调用 `groups.send` 时将 `text` 平铺在顶层，触发网关 `4000 Extra inputs are not permitted` 与 `5112 missing thread_id`（见 `docs/architecture/pitfall-registry.md` P-002）。
3. **上下文与记忆污染 (Context & Memory Poisoning)**：
   在专职 Bot 的主工位中若直接混入外部 Agent，破坏 System Prompt 纯净性，导致长期记忆（`MEMORY.md`）毒化；或者在群聊中将多 Agent 辩论内容误写回单个 Bot 的私有记忆中。
4. **生命周期错乱 (Lifecycle Violation)**：
   在专职 Bot 工位或群聊房间中错误渲染“删除会话”、“归档”、“单步回滚”或“Fork 分支”操作，导致系统核心主干被破坏。

本规范作为全工作区单一真值源，彻底从底层数据模型、网关协议、业务状态机与前端表现层四个维度厘清三大对话模式的物理边界。

---

## 二、 核心实体与领域模型划分 (Core Entity & Domain Modeling)

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        Hermes Flux 三大会话领域实体拓扑模型                              │
├──────────────────────────┬──────────────────────────┬──────────────────────────────────┤
│ 1. 普通会话 (Scratchpad)  │ 2. 专职 Bot 主工位 (Bot) │ 3. 多 Agent 群聊 (Group Room)    │
├──────────────────────────┼──────────────────────────┼──────────────────────────────────┤
│ • 物理标识: session_id    │ • 物理标识: session_id   │ • 物理标识: room_id              │
│ • 网关库: 各 Profile 的   │ • 网关库: 该 Profile 的  │ • 网关库: 网关主数据库            │
│   state.db (sessions 表) │   state.db (sessions 表) │   hosted_rooms 表                │
│ • 特征: hidden=0, 随机UUID│ • 特征: hidden=1,        │ • 特征: 独立房间实体,             │
│   随用随走或归档删除      │   固定 title: 'Bot Chat' │   members 包含 ≥2 位专家         │
│ • 记忆: 仅存留于本会话    │ • 记忆: 唯一允许更新      │ • 记忆: 仅保存在 groups.log 流， │
│   上下文，不写 MEMORY.md │   该 Bot 长期 MEMORY.md  │   绝不回写单个 Bot 的 MEMORY.md  │
└──────────────────────────┴──────────────────────────┴──────────────────────────────────┘
```

### 1. 普通会话（Scratchpad / Side Session / 临时旁聊）
* **定位**：用户针对特定攻坚任务、单点排查、代码推演或临时提问建立的沙盒会话；
* **物理事实**：底层存在于指定 Profile（或默认 Profile）的 `state.db` 中，`hidden=0`，具备唯一的 `sessionId`（包含 `storedId` 与 `liveId`）；
* **生命周期**：一生独占归属于一个指定的 Profile；支持用户重命名、主动归档（`session.archive`）、彻底删除（`session.delete`）、分叉（`session.branch`）以及单步撤销与历史截断回滚。

### 2. 专职 Bot 终身主工位（Bot Forever Chat / Canonical Chat）
* **定位**：专职数字员工（Resident Agent，如架构老王、前端小美）唯一绑定的终身主工位，代表 Bot 本身的人设与核心对话流；
* **物理事实**：底层存在于该 Bot 专属 Profile 的 `state.db` 中，固定 `title: 'Bot Chat'` 且 `hidden: 1`（通过 `session.set_hidden` 物理保护）。前端通过 `profileService.resolveForeverChat(botProfile)` 解析并保证唯一性；
* **生命周期保护**：**受物理保护实体**。绝对禁止被删除（Delete）、归档（Archive）、历史回滚（Rollback）或分叉（Fork）。这些操作在 UI 表现层严格不渲染；
* **长期记忆权威**：全系统中，**仅且必须**通过专职 Bot 的主工位对话收敛更新该 Bot 的 `MEMORY.md` 长期记忆。

### 3. 多 Agent 群聊研讨室（Group Room / Hosted Room）
* **定位**：由 2 位及以上专职 Bot（或主助理与专家）共同参会的多智能体研讨会议室，围绕复杂业务进行头脑风暴、交叉质检与共识裁决；
* **物理事实**：底层由网关核心 Hosted Room Service 调度，存储在网关根层主数据库的 `hosted_rooms` 表中，**物理独立于任何单一 Profile 的本地存储**；
* **生命周期**：支持创建（`groups.create`）、更名（`groups.rename`）、解散（`groups.disband`）以及发言中断（`groups.stop`）；
* **记忆隔离铁律**：研讨流完全保存在房间日志（`groups.log`）中，**严禁向任何单个参会 Bot 的 `MEMORY.md` 反向回写**，杜绝群体争论毒化个体专业记忆。

---

## 三、 支持功能全景对比矩阵 (Feature Matrix)

| 功能特性维度 | 1. 普通会话 (Scratchpad) | 2. 专职 Bot 主工位 (Forever Chat) | 3. 多 Agent 群聊 (Group Room) | 架构与实现约束 |
|---|:---:|:---:|:---:|---|
| **会话重命名** | ✅ 支持 (`session.title`) | ❌ 物理锁定为 Bot 名称 | ✅ 支持 (`groups.rename`) | Bot 工位名称来自 Profile，不可改写底层 `Bot Chat` 标题 |
| **会话删除与归档** | ✅ 支持 (`session.delete`/`archive`) | ❌ **严格禁用** (受物理保护) | ✅ 仅支持解散 (`groups.disband`) | Bot 工位无删除按钮；群聊解散生成 tombstone |
| **单步撤销 (Undo)** | ✅ 支持 (`session.undo`) | ❌ 禁用 (保护终身记忆连续性) | ❌ 禁用 (多方发言不可单方撤销) | UI 层通过 `deriveSessionKind` 条件渲染 |
| **历史截断回滚 (Rollback)** | ✅ 支持 (回填输入框+截断) | ❌ 禁用 | ❌ 禁用 | 截断依赖单会话线序 `truncate_before_row_id` |
| **会话分叉 (Fork / Branch)** | ✅ 支持 (`session.branch`) | ❌ 禁用 | ❌ 禁用 | Fork 派生出新的普通会话，不能分叉 Bot 或群聊 |
| **流式生成打断 (Interrupt)** | ✅ 支持 (`session.interrupt`) | ✅ 支持 (`session.interrupt`) | ✅ 支持 (`groups.stop`) | 群聊打断是停止当前发言轮次调度驱动 |
| **待发送队列 (Queue)** | ✅ 支持 (QueueManager) | ✅ 支持 (QueueManager) | ⚠️ 降级 (仅本地按序串行发送) | 群聊发言取决于网关 driver 轮次调度 |
| **运行时纠偏 (Steering)** | ✅ 支持 (`session.correction`) | ✅ 支持 (`session.correction`) | ❌ 不适用 | 群聊纠偏直接通过下一次 `@Agent` 发言实现 |
| **`@file` 文件与代码引用** | ✅ 支持 (模糊匹配项目树) | ✅ 支持 (模糊匹配项目树) | ✅ 支持 (全员共享可见) | 统一以相对路径/上下文片段嵌入输入框 |
| **`@agent` 智能呼叫** | ✅ 走子代理委派 (`subagent_delegation`) | ✅ 走旁路外援胶囊 (`mention-btw`) | ✅ 走房间广播唤醒 (`group_broadcast_mention`) | 统一经 `planSendRoute` 分流，禁止表现层乱转 |
| **单聊一键拉群 (Promotion)** | ✅ 支持 (四阶工程管道) | ✅ 支持 (以本 Bot 为核心拉群) | ❌ 不适用 (已是群聊) | 提取种子备忘录 Room 0 并留存原会话锚点 |
| **长期记忆沉淀 (`MEMORY.md`)**| ❌ 严禁写入 (仅会话内上下文) | ✅ **唯一法定回写通道** | ❌ **严格禁止** (防止记忆毒化) | 架构分层守卫：非 Forever Chat 禁调记忆持久化 |
| **子代理透视 (Subagent)** | ✅ 呈现任务拓扑卡片与穿透终端 | ✅ 呈现任务拓扑卡片与穿透终端 | ⚠️ 成员原生即多 Agent，通常不套娃 | 客户端对子代理只可观察与干预，不可直接 spawn |

---

## 四、 展示形态与 UI/交互表现差异 (Presentation & Viewports)

### 4.1 左侧双轨导航 (Left Rail: 52px Station + 212px Drawer = 264px)

```text
                               【左侧双轨在 3 种模式下的呈现】
       ┌───────────────────────────────┬───────────────────────────────┐
       ▼                               ▼                               ▼
【选中 ✦ 主助理 / 🤖 专职 Bot】          【选中 👥 群聊中心】              【进入普通会话 / 旁聊】
• 52px 微轨：当前 Bot 高亮呼吸点        • 52px 微轨：所属 Bot 保持激活     • 微轨保持所属 Bot 激活态
• 抽屉顶部：恒定置顶展示该 Bot 的       • 抽屉顶部：[+ 创建群聊研讨室]     • 抽屉上半区：该旁聊呈现激活高亮
  👑 核心主工位 (Forever Chat) 卡片    • 抽屉列表：渲染所有已创建房间     • 抽屉下半区：若属于 Project，
• 抽屉上半区：严格仅展示该 Bot 名下旁聊  • 房间卡片：展示房间名、叠落头像、 • 联动高亮工程树对应节点
• 抽屉下半区：展示该 Bot 参与的项目树    更新时间与未读指示              • 提供三重回程通道回到 Bot 主工位
```

* **微轨 Station 行为差异**：
  * 普通会话与 Bot 主工位均锚定在其所属的 Bot 徽章下；
  * 群聊不再占用微轨独立入口，统一在抽屉内「群聊」分节呈现（2026-11-13 定案，微轨底部群聊/项目图标已拔除）。
* **双重回程通道 (Double Home Channels)**：
  在普通旁聊中工作时，随时可通过：① 抽屉顶部置顶卡片（`rail-primary-agent-card`）；② 再次点击微轨 Bot 头像（Click-Again），一键瞬切回 Bot 主工位。（注：历史草案中提及的“顶栏父级面包屑回退”在当前单标题栏实现中属于未落地设计，现状以置顶卡片与微轨再次点击为准）。

### 4.2 顶栏区域 (Titlebar: 42px)
* **普通会话**：展示所属 Bot 微标 ➔ 会话名称（如 `锁冲突排查`），右侧提供当前模型选择、上下文 Token 水位胶囊（如 `42k / 128k`）；
* **专职 Bot 主工位**：纯净呈现该 Bot 真实头像、彩色指纹与 `${name}`，**严禁携带 `(Forever Chat)` 冗余后缀与伪 emoji 占位**；
* **多 Agent 群聊**：展示群聊名称、参会成员头像叠落（Avatar Stack，最多 4 位，超出显示 `+N`）、成员管理入口、解散与改名菜单。

### 4.3 中间消息流 (Message Stream)
* **用户消息行 (User Message Row)**：
  * 普通会话：常驻微距操作栏包含【复制】、【回滚 (Rollback)】、【分支 (Fork)】；
  * Bot 主工位与群聊：常驻微距操作栏**仅保留【复制】**，物理剔除回滚与分支按钮。
* **助手消息行 (Assistant Message Row)**：
  * 普通会话 & Bot 工位：头栏展示 Hermes 极客徽标与主模型标签，下方依次为深度思考链、Markdown 正文、工具调用胶囊与 Token 仪表；
  * 群聊研讨室：
    * 头栏**强显出话 Agent 头像、专属角色昵称与颜色指纹标签**（如架构老王 靛青 `#4F46E5`、前端洋红 `#DB2777`）；
    * 房间初始位置渲染由四阶管道注入的 **Room 0 种子系统备忘录卡片**（`group-seed-memo-card`）；
    * 显示网关协同调度驱动状态（`driver_status`）。

### 4.4 悬浮输入舱 (Composer Dock: 740px 黄金限宽)
* **`@` 触发补全逻辑差异**：
  * 普通会话：唤出 `@file`（项目文件）与 `@agent`（所有已知 Profile 清单，用于单次委派）；
  * Bot 主工位：唤出 `@file`；若输入 `@agent`，自动分流为 `prompt.btw` 旁路外援；
  * 群聊研讨室：`@agent` **仅列出本房间已入驻的成员**，支持精准单点唤醒；支持输入 `@all` 或 `@everyone` 唤醒全员展开自由讨论。
* **模型选择器行为差异**：
  * 普通会话 & Bot 工位：允许切换主模型，并通过 `config.set` 持久化绑定到当前会话上下文；
  * 群聊研讨室：群内各 Bot 的模型由各自的 Profile 配置决定，**群聊界面切换模型仅更新客户端偏好，禁止向不存在的 session 发送 `config.set`**（见 `desktop/src/renderer/index.ts` 守卫）。

---

## 五、 Gateway 网关层接口与契约差异 (Gateway RPC & Protocols)

三大模式在网关通信层面是两套完全不同的协议体系：

```text
                               【Gateway 通信通道正交分流】
                                            │
               ┌────────────────────────────┴────────────────────────────┐
               ▼                                                         ▼
     【会话通道: Session Channel】                             【群聊通道: Group Channel】
     (普通会话 / 专职 Bot 主工位)                              (多 Agent 群聊会议室)
  • session.create / list / resume                          • groups.create / list / state
  • prompt.submit / session.interrupt                       • groups.send / groups.stop
  • session.history / session.events.since                  • groups.log (按序列号游标增量拉取)
  • rollback.restore / session.branch                       • groups.disband / groups.rename
```

### 5.1 网关 RPC 方法与入参出参对照表

| 场景分类 | 普通会话 (Scratchpad) | 专职 Bot 工位 (Forever Chat) | 多 Agent 群聊 (Group Room) |
|---|---|---|---|
| **实体寻址主键** | `sessionId` (liveId 与 storedId 区分) | `sessionId` (liveId 与 storedId 区分) | `roomId` (`r...`) |
| **创建实体** | `session.create(title, profile?)` | `session.create(title: 'Bot Chat', profile, hidden: true)` | `groups.create(room_id, name, members)` |
| **发送文本消息** | `prompt.submit({ session_id, text })` | `prompt.submit({ session_id, text })` | `groups.send({ room_id, event_id, payload: { text, thread_id } })` |
| **同步历史记录** | `session.history({ session_id, profile? })` | `session.history({ session_id, profile })` (必传 profile) | `groups.log({ room_id, since_seq?, limit? })` |
| **单点呼叫外援** | `subagent` 委派子任务 (由模型派生) | `prompt.btw({ profile, session_id, text })` 返回 `{ task_id }` | 广播 `@Agent` 唤醒成员 |
| **中断当前生成** | `session.interrupt({ session_id })` | `session.interrupt({ session_id })` | `groups.stop({ room_id, cancel_id? })` 返回 `{ cancelled }` |
| **人机安全审批** | `approval.respond({ request_id, choice })` | `approval.respond({ request_id, choice })` | `groups.approve({ room_id, member_id, task_id, execution_generation, choice, request_id })` |
| **状态与元信息** | `session.status` / `session.usage` | `session.status` / `session.usage` | `groups.state({ room_id })` |

### 5.2 核心入参反 AI 糊弄契约硬红线
1. **`groups.send` 契约硬红线（防范 P-002）**：
   * 严禁将 `text` 平铺在顶层参数中（网关报 4000）；
   * 必须在 `payload` 内同时提供 `text` 与由客户端铸造的 `thread_id`（以 `t` 开头）；
   * 必须提供全局唯一的 `event_id`（UUID 或 `evt-*`）。
2. **会话双 ID 寻址红线（防范 P-009 / P-014）**：
   * `session.resume` 必须且只能使用 **storedId**（时间戳命名的物理 ID，如 `20261101_013507_5635da`）；
   * `session.branch`、`prompt.submit`、`session.interrupt` 必须使用 **liveId**（活动句柄，如 `8b2728f4`）。
3. **回滚截断入参红线（防范 P-012）**：
   * 回滚必须由 core 层的 `planTruncate` 统一计算；
   * 仅能传入持久化的 `truncate_before_row_id`（数值类型）或服务端下发的 `truncate_before_message_id`；
   * 严禁将前端自造的临时 ID（如 `usr-173000...`）透传至网关，否则必报 `[4018]` 错误。
4. **群聊人机审批流独立协议红线（防范 P-020）**：
   * 单聊模式下安全审批走全局 `approval.respond`；
   * 多 Agent 群聊中，模型触发危险工具时，必须且只能走 **`groups.approve`** 专用接口；
   * 入参必须强绑定触发该操作的 `member_id` 以及当前单调递增的 `execution_generation` 代际令牌，严禁误调单聊接口导致群聊执行锁永久挂死。
5. **群聊异步驱动与日志回读时序契约（防范 P-021）**：
   * 普通会话：实时消费 WebSocket 下行 `delta` 推送，经 `TokenCoalescer` 合流打字上屏；
   * 群聊房间：`groups.send` 仅将人类消息写入日志（`driver_started=true`），多 Agent 回合发言由网关 Driver 异步推进。客户端必须通过 `pollGroupRoomUntilSettled` 实施有界轮询（上限 8 轮 × 2.5s），回读 `groups.log` 才能驱动多 Agent 消息增量上屏，禁止假设群聊会自动推送单会话的 `delta` 事件。
6. **群聊存储形态与非托管房间防崩红线**：
   * 网关正统群聊：由网关核心统一调度，落盘在 `hosted_rooms` 表中，支持全量 `groups.*` 协议；
   * 历史兼容本地房间：保存在各端 `ui_meta['hermes-bots-groups'].rooms`，此类房间未经网关托管，调用 `groups.log` 必报 `[4112] room not hosted`，前端必须走本地日志回放降级。

---

## 六、 架构共同点与不同点深度解析 (Shared Invariants vs Key Divergences)

### 6.1 共同点（System-Wide Invariants）
1. **连接承载同构**：全平台（Desktop, Web, Mobile）统一通过 `packages/core` 的 `HermesGatewayClient` 维持单链接 JSON-RPC 2.0 over WebSocket 通道，禁止业务组件内手写原生 Socket；
2. **核心几何限宽**：无论处于何种模式，中间输入舱严格锁定 **740px 黄金阅读限宽**；右侧场景检查舱基线统一为 **410px**；
3. **视觉与设计令牌一致**：100% 走 29 色 Design Tokens 与主题变量（`var(--accent)`、`var(--bg-card)` 等），严禁裸写 `#hex`，严格遵守 i18n 零硬编码规范；
4. **滚动与性能红线**：对话展示流严格遵循跟随模式（读者距底 $\le 48\text{px}$ 时流式贴底，远离时锁死绝对不自动滚动）；滚动容器禁止应用 CSS `transform`；所有呼吸动效统一接入集中式动画时钟；
5. **显式失败原则 (Failure Is Not Empty)**：网络中断、方法不存在或数据拉取失败时必须显式向上抛出错误或标记失败状态，绝对禁止通过 `catch { return []; }` 伪装成空数据。

### 6.2 关键差异（Key Divergences）

| 差异特征项 | 普通会话 (Scratchpad) | 专职 Bot 主工位 (Forever Chat) | 多 Agent 群聊 (Group Room) |
|---|---|---|---|
| **实体所有权** | 单用户 ➔ 指定单 Agent 拥有 | 专职 Bot Profile 终身拥有 | 多个入驻 Agent 联合参会 |
| **可破坏性操作** | 允许回滚、删除、归档、分支 | **受物理保护，绝对只增不删** | 仅允许解散与重命名，不可回滚 |
| **跨 Agent 调度** | 派生 Subagent 后台异步子任务 | 注入只读 `prompt.btw` 外援胶囊 | 房间内广播轮流出话发言 |
| **长期记忆沉淀** | 不沉淀记忆，随用随扔 | **沉淀到该 Bot 的 MEMORY.md** | 仅沉淀在 groups.log，不污染私聊 |
| **网关底层数据表** | `sessions` 表 (`hidden=0`) | `sessions` 表 (`hidden=1`, `Bot Chat`) | `hosted_rooms` 表与日志流 |
| **通信 RPC 族** | `session.*` + `prompt.submit` | `session.*` + `prompt.submit` | `groups.*` 系列专用调度引擎 |
| **模型切换作用域** | 绑定到当前会话 (`config.set`) | 绑定到当前 Profile (`config.set`) | 仅客户端偏好，禁止会话级推送 |

---

## 七、 关联踩坑与守卫探针映射 (Pitfalls & Test Guards)

| 对应坑位 | 失败模式与核心症状 | 本规范对应守卫与测试基线 |
|---|---|---|
| **P-002** | 把 `roomId` 当 `sessionId` 发送，群聊发不出去报 4001/4000 | `packages/core/src/group/groupService.ts` 严格封装 `groups.send` 参数契约；静态契约校验 |
| **P-006** | 凭空假设 `subagent.spawn` 接口存在 | 声明子代理仅支持观察与干预（`list`/`steer`/`interrupt`/`tail`），禁止前端直接创建 |
| **P-009** | 会话双 ID 混用导致 resume 4007、title 4001 | 严格区分 `storedId`（用于 resume）与 `liveId`（用于发送与分支）；`ensureLiveSessionId` 守卫 |
| **P-010** | 活跃会话直接删除报 4023 | 必须先 `session.close` 或在断开后删除；Bot 主工位物理杜绝删除操作 |
| **P-012** | 前端自造临时 ID 逃逸为截断锚点报 4018 | `InteractiveService.truncateAndSubmit` 与 `planTruncate` 统一构造，形式化定理 8/9 守卫 |
| **P-014** | `session.branch` 误传 storedId 导致 Fork 失败 | `ensureLiveSessionId()` 保证向网关传递 liveId，附带 `idempotency_key` 防重复分支 |
| **P-015** | `@Agent` 被当成普通文本发送给模型 | `agentRouter.ts` 的 `planSendRoute` 与 `parseAgentMention` 进行三态精准分流；形式化定理 11 守卫 |
| **P-020** | 群聊人机审批误调单聊接口导致执行锁永久挂死 | 严格路由至 `groups.approve`，并强绑定 `member_id` 与 `execution_generation` 代际令牌 |
| **P-021** | 群聊假设存在逐 Token 流式事件导致前端卡死 | 客户端改走 `pollGroupRoomUntilSettled` 有界轮询（8轮×2.5s）回读 `groups.log` 驱动增量上屏 |
