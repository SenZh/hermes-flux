# Hermes Flux 客户端双层缓存、多端协同与实时数据流转架构规范
(Client Double-Layer Cache, Multi-Client Fanout & Real-Time Sync Specification)

> **版本**：1.0.0-draft  
> **基线规范**：Hermes Gateway JSON-RPC 2.0 / RESTful 契约体系  
> **设计目标**：0ms 秒级启动、离线可用、弱网抗抖、多端毫秒级镜像同步、严格数学形式化不变量（TLA+ / PBT 可验证）

---

## 一、 核心问题与设计原则

在 Hermes Flux 跨平台客户端中，前端面临两大异构数据领域：
1. **会话列表集合（Session & Group & Agent Registry）**：
   - 涵盖：多 Agent 专职数字员工（Profiles）、群聊协同室（Groups）、普通对话（Sessions）。
   - 痛点：跨多个 Profile 甚至跨 SQLite 数据库分布，排序受活跃时间影响高频变动，网络抖动容易导致“列表闪烁甚至清空”。
2. **会话内部历史流水（Session Message & Run History）**：
   - 涵盖：用户提问（User）、流式推理与工具分片（Assistant/Tool）、多端并发协同（Multi-Client）。
   - 痛点：网关原生在 `prompt.submit` 接收用户提问时只落库不广播事件；多端同时登录打开会话时需实现无缝追赶与去重；回滚时光机需彻底杜绝幽灵消息复活。

### 核心设计原则（The Core Tenets）
* **P1. UI 唯一真相源原则（L1 Single Source of Truth）**：UI 视图层只且只能响应式读取 L1 内存 Store，禁止在渲染周期中直接发起异步磁盘/网络读取。
* **P2. 读路径 SWR 缓存穿透原则（Cache-First, Background Revalidate）**：首屏秒开依赖 L2 本地磁盘快照，后台静默拉取增量差异（Delta）并对账合并。
* **P3. 写路径乐观确权与 Outbox 原则（Optimistic Mutation with Outbox）**：本地分配临时 UUID 立即上屏，持久化至 L2 Outbox 离线队列，网络返回权威序号后原子替换。
* **P4. 权威序号全序定单（Authoritative Monotonic Sequencing）**：消息顺序以网关权威分配的单调递增 `seq` 为唯一依据，本地时间戳仅作为展示辅助。
* **P5. 失败不可致空不变量（Failure Is Not Empty Invariant）**：网络异常、超时或部分失败时，本地缓存绝对不得被全量清空，必须保留上一权威快照。

---

## 二、 架构全景：三层数据分级与数据流拓扑

客户端维护三层数据结构：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 【L0 实时在途流 (Ephemeral Stream)】                                        │
│  • WebSocket 原始帧与下行事件 (message.start, message.delta, tool.start)   │
│  • TokenCoalescer 环形帧率对齐缓冲池 (16ms Batch)                           │
│  • 内存独占，严禁任何形式的持久化落盘                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ 【L1 响应式内存模型 (Reactive In-Memory Store)】                            │
│  • 会话列表：ProfileCards (置顶) + ActiveSessions (有序列表) + Groups     │
│  • 会话明细：ActiveSessionMessages (按 seq 严格升序链表)                   │
│  • 交互状态机：InflightTurns (正在生成的助手状态) + PendingApproval 卡片   │
│  • 专职角色：UI 组件通过 selector (如 useSession(id)) 同步订阅             │
├─────────────────────────────────────────────────────────────────────────────┤
│ 【L2 跨平台持久化底座 (Persistent Storage)】                                │
│  • 桌面端：better-sqlite3 / node:sqlite (WAL 模式)                          │
│  • 移动端：op-sqlite (JSI 直通) + MMKV (高频元数据)                         │
│  • Web端：IndexedDB (idb/Dexie)                                             │
│  • 数据表：`sessions`, `messages`, `outbox`, `groups`, `profiles_cache`     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、 模块一：会话列表（Groups, Agents, Sessions）缓存与实时同步

### 1. 列表层级结构与分类加载策略

侧边栏/导航轨道的会话列表由三类数据投影而成：

```
                    会话侧边栏 (Left Rail & Sidebar)
                                 │
     ┌───────────────────────────┼───────────────────────────┐
     ▼                           ▼                           ▼
[专职 Agent 卡片区]         [多 Agent 群聊区]          [普通个人会话池]
Profiles / Bot Cards         Group Rooms                Personal Sessions
• 固定展示所有数字员工       • 房间元数据与成员          • 全局跨 Profile 倒序
• 徽标/未读/最后活跃         • 最近一条消息与状态        • 包含归档与分支
```

#### A. 专职数字员工（Profiles / Bot Cards）
- **数据来源**：RPC `profiles.list` + REST `GET /api/profiles`。
- **缓存策略**：
  - L2 缓存表 `profiles_cache`，存储 `name`, `display_name`, `avatar_url`, `ui_meta`, `last_active`。
  - 启动阶段：0ms 从 L2 恢复展示；后台静默调用 `profiles.list`。
  - 排序不变量：专职数字员工按最后一次交互活跃时间 `applyBotActivity` 动态维持非递增全序，但独立成区，绝不与普通会话混淆。

#### B. 多 Agent 群聊房间（Groups）
- **数据来源**：RPC `groups.list` + 网关事件广播 `groups.*`。
- **缓存策略**：
  - L2 缓存表 `groups_cache`，存储 `group_id`, `name`, `topic`, `members`, `last_message`。
  - 实时更新：监听 `groups.message`, `groups.rename`, `groups.member_join` 事件，局部原子 Patch L1 内存对应项，并异步落盘 L2。

#### C. 普通会话聚合池（Sessions）
- **数据来源**：
  - 核心专线：REST `GET /api/profiles/sessions/sidebar?recents_profile=all`（推荐，内置 Singleflight 缓存，同时切片拉取 recents、cron、messaging）；
  - 全量聚合：REST `GET /api/profiles/sessions?profile=all&order=recent`。
- **SWR 增量同步与去重算法**：
  1. 启动时从 L2 读取前 50 条本地已缓存会话填充 L1；
  2. 后台并发请求 `GET /api/profiles/sessions/sidebar?recents_profile=all`；
  3. 执行 `reconcileSessionList(previous, fetched, authoritative)`：
     - 使用 `(id, profile)` 作为复合唯一主键进行幂等合并；
     - 取网关与本地两者的最大时间戳 `Math.max(local.timestamp, fetched.timestamp)`；
     - 严格过滤已显式删除的墓碑标记（Tombstone）；
     - **安全网（Failure Is Not Empty）**：若 HTTP 状态非 200 或解析失败，`authoritative=false`，严格保留原有本地集合，绝不致空！

---

## 四、 模块二：会话历史记录（Messages & Inflight）缓存与多端实时协同

### 1. 核心流程：多端协同与“补齐”状态机

#### 痛点回顾
Hermes 网关在客户端执行 `prompt.submit` 时，将提问写入 SQLite 并返回 RPC 确认，**但不对 WebSocket 连接广播用户输入事件**，仅在模型开始推理时广播 `message.start` 和 `message.delta`。

#### 多端无缝镜像同步状态机（The Peer Catch-Up Machine）

当客户端收到 WebSocket 下行通知时，状态转移矩阵如下：

| 当前事件 | 客户端角色 | 前置 L1 状态 | 动作行为与数据流 | 目标 L1 状态 |
|---|---|---|---|---|
| **用户回车** | 发送端 (A) | 空闲 | 分配 `tmp_id` + `mutation_id`，乐观推入 L1，写入 L2 Outbox，发 RPC `prompt.submit` | `sending` (乐观) |
| **RPC 成功响应** | 发送端 (A) | `sending` | 收到 `{accepted: true, user_row_id: 42}`，替换正式 ID，移出 Outbox，落盘 L2 | `sent` (待响应) |
| **`message.start`** | 发送端 (A) | `sent` | 识别为自发回合，创建 Assistant 占位气泡 | `streaming` |
| **`message.start`** | 接收端 (B) | 任何状态 | **检测到上一条不是该用户的提问** ➔ 立即发起增量拉取（`session.events.since` 或 `session.history` 最新一条），注入 A 端提问，再创建 Assistant 占位气泡 | `streaming` |
| **`message.delta`** | 全体端 (A+B) | `streaming` | 经过 `TokenCoalescer`（16ms 节流），追加到 Assistant 内存气泡；**严格禁止落盘** | `streaming` |
| **`message.complete`** | 全体端 (A+B) | `streaming` | 取出 payload 中的 `text`, `reasoning`, `usage`，定格气泡状态；**触发一条原子事务批量写入 L2 数据库** | `committed` |
| **`session.interrupt`**| 全体端 (A+B) | `streaming` | 停止动画光标，标为 `interrupted`，截断保存当前已生成的文本至 L2 | `interrupted` |

---

## 五、 形式化模型定义与数学安全不变量 (TLA+ / TCA Specification)

我们将客户端缓存与同步系统抽象为一个离散转换状态机：

### 1. 形式化状态空间 (State Space)
设系统状态为四元组 $S = \langle M, L_1, L_2, G \rangle$，其中：
- $M \subset \text{Mutation}$：本地在途乐观操作集（Outbox）；
- $L_1$：前端响应式内存投影（当前呈现给用户的全部 Session/Message 序列）；
- $L_2$：本地磁盘持久化快照；
- $G$：网关权威服务端实际状态。

每个会话消息具备权威属性 $m = \langle id, seq, role, content, status \rangle$，其中 $seq \in \mathbb{N}$。

### 2. 状态机动作与转换关系 (Transitions)

1. $\text{Action: OptimisticSubmit}(text, mut\_id)$:
   $$M' = M \cup \{ mut\_id \}$$
   $$L_1' = L_1 \mathbin{\Vert} \langle tmp\_id, \infty, \text{'user'}, text, \text{'sending'} \rangle$$
2. $\text{Action: AuthoritativeAck}(mut\_id, row\_id, seq)$:
   $$M' = M \setminus \{ mut\_id \}$$
   $$L_1' = \text{Replace}(L_1, tmp\_id \to row\_id, seq, \text{'committed'})$$
   $$L_2' = L_2 \cup \{ row\_id \}$$
3. $\text{Action: PeerCatchUp}(fetched\_user\_msg)$:
   若接收端未捕获对应 $mut\_id$，则：
   $$L_1' = \text{InsertSortedBySeq}(L_1, fetched\_user\_msg)$$
   $$L_2' = L_2 \cup \{ fetched\_user\_msg \}$$
4. $\text{Action: Truncate}(to\_seq)$:
   $$L_1' = \{ m \in L_1 \mid m.seq \le to\_seq \}$$
   $$L_2' = \{ m \in L_2 \mid m.seq \le to\_seq \}$$

---

### 3. 五大核心数学安全不变量 (Safety & Liveness Invariants)

测试套件与形式化验证程序必须严格证明以下定理在全输入空间（包含网络随机丢包、乱序、延迟到达）下恒成立：

#### 定理 1. 全序单调递增性 (Strict Monotonic Sequence Invariant)
$$\forall i \in [0, |L_1| - 2]: \quad L_1[i].seq < L_1[i+1].seq$$
*证明目标*：排队合并后的消息序列严格单调递增，绝不允许出现 `seq` 倒挂、乱序。

#### 定理 2. 去重幂等恒等性 (Deduplication Idempotence)
$$\text{Dedupe}(\text{Dedupe}(S)) \equiv \text{Dedupe}(S)$$
*证明目标*：多端广播事件与本地网络拉取重复到达时，无论叠加多少次相同数据，内部投影严格不变。

#### 定理 3. 失败不可致空性 (Failure Non-Emptiness Invariant)
$$\text{If } \text{Prev} \ne \emptyset \land \text{NetworkError}(), \quad \text{Reconcile}(\text{Prev}, \text{Error}) \ne \emptyset$$
*证明目标*：在权威远端返回错误、网络断开或 payload 损坏时，客户端本地会话和历史绝不允许被意外抹除。

#### 定理 4. 截断无幽灵消息不变量 (No Ghost Resurrect Invariant)
$$\forall m \in \text{HistoricalPool}: \quad m.seq > to\_seq \implies m \notin L_1' \land m \notin L_2'$$
*证明目标*：执行回滚或撤销后，已被截断的脏历史在后续 SWR 刷新或重连对账中绝不可死而复生。

#### 定理 5. 最终一致性有界收敛 (Eventual Convergence Invariant)
设客户端 $A$ 与 $B$ 均连接至网关，且网络在有限时间 $T$ 后静默，则：
$$\lim_{t > T} L_1^{(A)}(t) \equiv L_1^{(B)}(t) \equiv G(t)$$
*证明目标*：任意端发出的消息、中断与流式结果，最终在所有正常客户端上呈现同构状态。

---

## 六、 渐进式实施路线（从基础到全量）

1. **Phase 1（最小基石）**：
   - 实现会话列表对账核心算法 `reconcileSessionList` 与多 Profile 去重合并；
   - 编写形式化数学验证用例（使用 `fast-check` 生成 10,000 次对抗测试），证明定理 1 ~ 定理 3。
2. **Phase 2（消息历史与多端补齐状态机）**：
   - 实现消息流水单向定序管道 `MessageLogPipeline` 与 `CatchUpBuffer`；
   - 模拟多端发问时 `message.start` 触发的异步增量补齐机制；
   - 证明定理 4（无幽灵复活）与定理 5（双端最终收敛）。
3. **Phase 3（L2 本地存储适配器）**：
   - 跨端存储抽象层（Electron 原生 SQLite、移动端 JSI、Web IndexedDB）；
   - 接入 Outbox 事务持久化与断网重放。

---

## 七、 专家评审改进意见吸收与工程细化 (Architecture Review Enhancements)

经分布式系统、前端存储与形式化方法专家评审，吸收以下三项工业级关键设计：

### 1. 流式微状态与宏观历史解耦 (Streaming Decoupling)
- **风险**：LLM 吐字频率达 50~100 tokens/s，若每 16ms 将 delta 合入全局不可变数组 `messages`，浅拷贝会导致 React 全树高频 Diff，造成掉帧与 GC 抖动。
- **解法**：在 L1 内部实行**双轨隔离**：
  - `committedMessages`: 静态历史链表，仅在回合开始/结束时发生低频变更；
  - `streamingDraft`: 独立原子引用（Atomic Draft），UI 中只有当前正在生成的那个 `StreamingBubble` 组件直接订阅它，其余历史气泡完全保持纯净不受渲染打扰。

### 2. 多端补齐的 CatchUpBuffer 乱序保护
- **风险**：当 B 端收到 `message.start` 发起异步补拉时，由于网络延迟，网关后续推送的 `message.delta` 可能早于补拉的 User 提问到达 B 端。
- **解法**：在 L0 设立 `CatchUpBuffer` 队列。在补齐 User 提问尚未落入 L1 之前，所有到达的 `message.delta` 暂存在 Buffer 中；一旦 User 消息确权插入，Buffer 内的 delta 立即顺序回放，确保渲染时序绝对正确。

### 3. TLA+ 离散规范与分支覆盖证明契约
- 状态机动作与分支必须在性质测试（Property-Based Testing）中达到 **100% 状态空间可达性证明**，通过 `fast-check` 生成全状态对抗用例，杜绝死锁与幽灵复活。
