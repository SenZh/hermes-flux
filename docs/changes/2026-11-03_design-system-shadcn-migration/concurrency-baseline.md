# Hermes Flux 前端并发与同步分析

> 合成说明：base 为候选B（arena cross-judge 推荐，置信度 0.82，与主 Agent 逐条评分一致）。移植候选A 五处：R-09 复活窗口的分级裁决、队列冻结字段级盘点、formal 定理适用边界、listSessionsSafe 失败语义、coalescer clear() 取消时机。评审与主 Agent 复核后的措辞收紧四处：跨窗口存储改条件推断、setLocale 调用点精确化、R-08 权威文本丢失加条件、chatQueueStore 单例结论改"零生产消费"。主 Agent 独立复核通过的关键断言：R-01、R-02、watchdog 装载点、eventReducer 双丢弃、代际守卫对照、verify:formal 不重建 dist、listSessionsSafe。

分析对象：`D:\ws\hermes-aura`（只读，未运行任何构建或测试）。
标注法：每条论断后缀 `【已核实】`＝我亲自读到该文件该行；`【推断】`＝基于已核实代码的推理，未在运行时验证。无标注的句子是对已标注事实的归纳。

---

## 0. 结论摘要

1. **前端并发模型是"单线程 + 七类异步边界"，不是"多线程共享内存"。** 全部真实交错都来自 `await` 恢复点、RAF 回调、定时器回调与跨运行时 IPC 响应。渲染层没有一次并发写，只有"读-改-写被 `await` 劈成两半"。
2. **项目已经沉淀了正确的解法（代际守卫 / 纯函数对账 / 不可变快照），但只覆盖了约一半的异步读路径。** `fetchSessions`（:1185/:1235）、`loadMessages`（:2193/:2240/:2295）、`enrichVisibleSessionPreviews`（:1128/:1159）有守卫；`loadOlderMessages`、`openGroupRoom`、`openBotChat`、`ensureLiveSessionId` 四个同样形态的路径**没有任何守卫**。这是本报告的最高价值发现：同一类缺陷的 4 个未修复实例。
3. **最严重的一条可达竞态会让用户的提问发进另一个会话**：`ensureLiveSessionId`（:2393-2415）在 `await session.resume` 之后不校验"当前会话是否仍是发起时的会话"，把 A 会话的 live id 写进全局槽位，随后 `sendMessage` 用它提交 B 会话的文本。触发前置条件明确（live id 为空 + resume 往返期间切会话）。
4. **`loadOlderMessages`（:2064-2123）在 `await` 之后直接把上一会话的历史批次拼进当前视口**（:2086），这是最容易复现的跨会话污染：滚到顶 → 立刻点另一个会话。
5. **`activeStreaming*` 是四个彼此独立的模块级 `let`（:491-502），不是原子对象。** 至少六处清空点各写各的（:2585-2589、:3017-3020、:3101-3104、:4016-4018、:4044-4046、:4247-4250），任何一处漏写就产生"半清空"中间态；这是结构性隐患而非单点 bug。
6. **回合看门狗是"总时长上限"，不是"静默检测"**：`armTurnWatchdog`（:3002-3024）只在回合开始（:3438）与 `turn-started`（:3811）装载，`append-content`（:3814-3820）不重置。注释自称 "if a turn goes silent"（:3001），实现是固定 10 分钟（:677）。超过 10 分钟的活跃回合会被强制解绑，之后到达的 delta 全部丢弃。
7. **形式化资产锁的是 11 条定理，但文档自述 7 条**（`AGENTS.md:34/109/131`）。且 `verify:formal`（`package.json:19`）不重建 `dist`，而三条定理文件全部 `import '../../dist/index.js'`（如 `session-merge-formal.test.mjs:8`）——单独运行该门禁验证的是磁盘上已有的构建产物。
8. **工程纪律文档承诺的三条并发军规在前端没有落地**：CAS/版本号、删除墓碑（Tombstone）、重试幂等键。全文 `packages/**/*.ts` 内 `tombstone` 仅出现在网关群聊契约（`core/src/rpc/types.ts:625`），`idempotency_key` 仅用于 `session.branch`（`core/src/session/interactiveService.ts:148`）；`prompt.submit`（`renderer/index.ts:3476`）与 `session.delete`（:2546）均不带幂等键。

---

## 1. 分析口径

判定一条"看起来并发"的代码是不是竞态，只用以下模型：

- 同一宏任务内、同一微任务队列内，代码顺序执行，**不可能交错**。
- 交错只发生在四种恢复点之后：`await`/`.then` 恢复（微任务）、`setTimeout`/`setInterval` 回调（宏任务）、`requestAnimationFrame` 回调（渲染帧）、IPC/WS 消息投递（宏任务）。
- 跨运行时（Electron main、Python gateway、WebView native 层）是**真并行**，但前端只通过消息通道观察其效果，因此在前端侧仍表现为"消息到达序 ≠ 请求发出序"。

因此本报告把"竞态"限定为：**某个异步恢复点之后，代码仍然依据恢复前的判断去写入共享状态，而该判断在恢复时已失效**。所有真实竞态条目都必须能写出 T1/T2 两个时刻的 actor 动作。

---

## 2. 并发模型：七类真实交错边界

### 2.1 WebSocket 下行帧

- 唯一入口：`gatewayClient.onNotification('event', ...)`，`renderer/index.ts:4186-4201`。每帧一个宏任务，帧内同步执行 `reduceGatewayEvent`（:4194）与 `applyTurnActions`（:4198）。【已核实】
- 帧到帧之间**没有任何队列或串行化**：`handleMessage`（`core/src/rpc/client.ts:839-864`）对每个 `onmessage` 直接同步分发。TCP 保序，所以同一 socket 上帧的到达序 = 网关发送序；但"到达序"与"本地 `await` 链的恢复序"无关。【已核实】
- 会话过滤发生在 reducer 内：`frameSessionId` 不在 `ctx.activeSessionIds` 时返回空数组（`core/src/session/eventReducer.ts:181-183`）。这是**唯一**的会话隔离闸门。【已核实】

### 2.2 JSON-RPC 在途响应

- 请求 id 单调递增（`client.ts:522`），响应按 id 精确匹配（:843-853），**不存在跨请求串包**。【已核实】
- 超时到期即从 `pendingRequests` 删除（:538-542），迟到的响应因 `has(data.id)` 为假被静默丢弃（:843）。这是正确的"超时不可复活"实现。【已核实】
- 但**完成序 ≠ 请求序**：多个并发 `call` 的 `.then` 按网络返回序恢复。渲染层有多处并发发起（`fetchSessions` 的 `Promise.allSettled`，:1210-1232；`enrichVisibleSessionPreviews` 的 `Promise.all`，:1142-1157），因此"后发的请求先返回"是常态而非异常。【已核实】
- 客户端超时 25s（:4168）。超时不等于网关未受理——这是 R-13 的根因。【已核实】

### 2.3 requestAnimationFrame

四条独立的 RAF 通道，彼此无协调：

| 通道 | 位置 | 写入对象 |
|---|---|---|
| 流式合流器步进 | `core/src/coalesce/tokenCoalescer.ts:62-66` → 回调 `renderer/index.ts:772-878` | `state.messages[*].content`、`sessionMessagesCache`、`state.sessions[*].preview`、DOM `#msg-content-*` |
| 工具胶囊补丁 | `renderer/index.ts:903` → `toolPatchQueue.ts:40-53` | DOM `#msg-tools-*` |
| 滚动贴底 / 锚点稳定 | `renderer/index.ts:725-738`、`:4952-4961` | `scrollTop` |
| 焦点恢复阶梯 | `renderer/index.ts:653-656` | `document.activeElement`、选区 |

【已核实】合流器回调在**帧内**读取 `activeStreamingStoredSessionId`（:782/:786/:805/:820），即"用帧时刻的全局槽位解释推入时刻的 token"。这是 R-07 与 R-08 造成错位的共同结构前提（另有一条同类双写见 §4.3）。

### 2.4 定时器与轮询

| 用途 | 周期 | 位置 |
|---|---|---|
| 会话列表合并刷新 | 180ms 防抖 | `renderer/index.ts:1006-1012` |
| 回合看门狗 | 10min 固定 | `:3004` |
| 群聊日志轮询 | 1200/2000ms，最多 30 轮 | `:3237-3306` |
| 侧代理胶囊提示 / 过期 | 15s / 600s | `:3698`、`:3705` |
| 运行中工具秒表 | 200ms `setInterval` | `:6839` |
| Toast / dockNotice 自动消失 | 2200ms / 4000ms | `:2709`、`:3052` |
| 斜杠 / 路径补全防抖 | 未固定 | `:1765`、`:1809` |
| 滚动冷却锁 | 150ms | `:6488` |
| RPC 超时 | 25s | `core/src/rpc/client.ts:538` |
| 心跳探测 / 半开看门狗 | 15s / 5s | `client.ts:318`、`:323` |
| 重连退避 | 0~30s 全抖动 | `client.ts:466-470` |
| 日志落盘轮询 | 20ms 忙等，上限 2s | `desktop/src/main/logFile.ts:125-127` |

【已核实】其中群聊轮询与回合看门狗是仅有的两处"会写业务状态"的长周期定时器；其余只写 DOM 或局部 UI 状态。

### 2.5 localStorage

- 全部读写同步（如 `:599`、`:1117`、`:539`），在单窗口内不可能交错，**不构成竞态来源**。【已核实】
- 真实风险是"整键覆盖"：`persistBotActivityToStorage`（:592-602）与 `persistSessionPreviewCache`（:1109-1120）每次都把整张 Map 序列化后整体 `setItem`。任何"读盘 → 改 → 写盘"的路径都会被并行写者覆盖；当前所有写者都从同一份内存 Map 派生，故未观察到丢失。【推断】
- 跨窗口/多实例（同一 Electron userData 开两个窗口、或 Web 端多标签）会通过 `storage` 事件形成真正的跨文档交错，代码中无任何监听与仲裁。【已核实：全仓无 `storage` 事件监听】但该风险以"存在共享同一 origin 与同一键的多窗口运行场景"为前提；desktop 当前单窗口、mobile 单 WebView，该场景是否存在未取证，此条按条件推断处理，不排期。【推断（移植候选A 的运行环境限定）】

### 2.6 平台 IPC（Electron main）

- `preload/index.ts:56-89` 全部 `ipcRenderer.invoke`，每个调用是一个独立往返；`appendLog` 用单向 `send`（:82）避免往返。【已核实】
- 主进程侧存在跨调用共享的可变状态：`activeGatewayCookies`（`main/ipc.ts:13`，写于 :188，读于 :262-264）。所有渲染层 REST 代理请求共用这一份 cookie。【已核实】
- 日志落盘是串行队列（`main/logFile.ts:85-108`，`writing` 闸门 + `while (queue.length)` 重入检查），顺序与产生序一致。【已核实】

### 2.7 生命周期与网络事件

- `visibilitychange`（`client.ts:238-243`）与 `online`（:246-251）会调用 `wakeImmediately`（:278-292），后者清退避定时器并立即 `connect()`。这是除定时器外唯一能"插入"连接状态机的 actor。【已核实】
- `wakeImmediately` 用 FSM 状态而非 socket `readyState` 做前置判断（:280-283），真正的防重入由 `connect()` 的 `readyState` 检查兜底（:380-382）。两条判断不同源，但目前组合后无重复建链。【已核实】

---

## 3. 并发共享可变状态清单

### 3.1 渲染层模块级内存态（`packages/desktop/src/renderer/index.ts`）

| 状态 | 定义行 | 写者（actor） | 跨任务共享 |
|---|---|---|---|
| `state`（AppState，约 40 个可变字段） | :377 | 几乎每个异步回调 | 是（全部） |
| `gatewayClient` | :489 | `connect` / `disconnect` | 是 |
| `currentTicket` | :490 | `connect` | 是（被 REST 闭包捕获，:4178） |
| `activeStreamingMessageId` | :491 | WS 事件、发送、看门狗、中断、删除、断线 | 是 |
| `activeStreamingStoredSessionId` | :492 | 同上 | 是 |
| `activeStreamingLiveId` | :493 | 同上 | 是 |
| `activeStreamingBotName` | :502 | 同上 | 是 |
| `sessionDraftMap` | :503 | 切会话、新建、删除 | 是 |
| `unreadSessionIds` / `unreadGroupRoomIds` / `unreadBotNames` | :504-506 | 回合开始/完成/失败、进入已读、断线 | 是 |
| `activeRunningSessionIds` / `activeRunningGroupRoomIds` / `activeRunningBotNames` | :507-509 | 同上 | 是 |
| `profileAvatarCache` | :512 | `fetchProfiles` 并发分支（:1626-1679） | 是（并发写同一 Map） |
| `botLatestActivityMap` | :561 | 合流器帧、发送、回合完成、`fetchProfiles` | 是 |
| `sessionPreviewCache` | :1083 | `enrichVisibleSessionPreviews`、`syncActiveSessionPreviewToRail`、`fetchSessions` | 是 |
| `activeFetchSessionsGeneration` | :1059 | `fetchSessions` | 是（守卫） |
| `enrichPreviewGeneration` | :1122 | `enrichVisibleSessionPreviews` | 是（守卫） |
| `botForeverChatCache` | :1532 | `openBotChat`、`fetchProfiles` | 是 |
| `sessionMessagesCache` | :1697 | 合流器帧、加载、合并、回滚、删除、切会话 | 是（**元素引用与 `state.messages` 共享**，:3433/:3984/:2806） |
| `sessionServerOffset` | :1698 | 加载、翻页、删除、截断提交 | 是 |
| `sessionHistoryTrust` | :1700 | 截断提交写（:3493）、加载时"读取即删除"（:2251/:2340/:2358） | 是 |
| `activeLoadMessagesGeneration` | :2183 | `loadMessages` | 是（守卫） |
| `activeGroupThreadId` / `activeGroupThreadAt` | :3122-3123 | `openGroupRoom`、`sendGroupMessage` | 是 |
| `activeGroupPollerTimer` | :3225 | 所有群聊轮询链（**单槽位复用**） | 是 |
| `hostedRoomIds` | :1414 | `fetchGroupRooms` | 是 |
| `pendingScrollToBottom` | :712 | 十余处 | 是（跨任务的"一次性意图"） |
| `canvasStructureDirty` | :881 | 工具补丁队列 → `render` | 是 |
| `lastMessagesSnapshot` / `lastInputDockSnapshot` | :4374-4375 | `render` | 是（渲染短路判据） |
| `turnWatchdogTimer` / `sessionsRefreshTimer` / `dockNoticeDismissTimer` / `toastTimer` | :674/:673/:672/:2674 | 各自装载点 | 是（单槽位） |
| `runningToolTimerHandle` | :6788 | 工具秒表 | 是（单槽位） |
| `scrollCooldown`（挂载闭包内） | :6476 | 滚动回调 → RAF → 定时器 | 是 |

**结构判断**：上述 29 项中，6 项是"代际计数器"（本身即守卫机制），5 项是"单槽位定时器句柄"（清 A 会误杀 B 的典型位置），其余 18 项是无仲裁的共享业务状态。【已核实定义与写入点】

### 3.2 持久态

| 键 | 定义 | 写者 |
|---|---|---|
| `hermes_flux_bot_activity` | :560，写 :599 | 合流器帧（每秒多帧）、发送、回合完成、`fetchProfiles` |
| `hermes_flux_session_previews` | :1077，写 :1117 | 预览回补、切会话反哺 |
| `hermes_flux_avatar_cache` | :511，写 :539 | `fetchProfiles` 并发分支（每个 Bot 成功即整表重写） |
| `hermes_flux_profile` / `hermes_aura_profile` | 读写 :1543、:1688、:4147、:5441 | 切 Bot、切 Profile、连接 |
| `hermes_flux_theme`、`_gateway_url`、`_username`、`_password`、`_rail_w_*`、`_fav_models`、`_recent_models`、`_log_level` | :5399、:5426、:5431、:5436、:6855、:6922、:2889、:474 | 各自设置面板 / 拖动 / 选择器 |

`persistAvatarCache`（:532-543）在并发分支里被调用 N 次，每次整表序列化；`profileAvatarCache` 本身是共享 Map，因此结果收敛，但写盘次数是 O(Bot 数) 而非 1。【已核实】

### 3.3 主进程

| 状态 | 定义 | 说明 |
|---|---|---|
| `activeGatewayCookies` | `main/ipc.ts:13` | 所有 `gateway:http-proxy` 请求共用；换网关时旧请求可能带上新 cookie |
| 日志队列 `queue` / `writing` | `main/logFile.ts:80-83` | 串行，顺序正确 |

### 3.4 core 单例

| 状态 | 定义 | 说明 |
|---|---|---|
| `WebSocketFsm.state` / `attemptCount` | `core/src/rpc/fsm.ts:27-28` | 无转移合法性校验（:40-50），非法转移照样广播 |
| `pendingRequests` / `nextId` / `ws` | `core/src/rpc/client.ts:127-137` | id 匹配正确 |
| `TokenCoalescer.buffer` / `rafId` | `core/src/coalesce/tokenCoalescer.ts:25-26` | 无容量上限；窗口不可见时无消费者 |
| `reportedEventDrift` / `reportedUnknownEvents` | `core/src/session/eventReducer.ts:26-28` | 只增不减的进程级 Set |
| `currentLocale` | `ui/src/i18n/index.ts:706` | `setLocale` 定义于 :708，但生产代码零调用点（仅 `ui/__tests__/i18n.test.mjs` 与 desktop CDP harness 引用，主 Agent 复核），因此运行时恒为 `'zh-CN'`；`state.lang` 对 `t()` 完全无效 |
| `GroupRoomStore.rooms` / `roomLogs` | `core/src/group/groupService.ts:87-97` | 被多条群聊轮询链并发读写 |

---

## 4. 竞态裁决

### 4.1 真实竞态（13 条，按严重度排序）

#### R-01 `loadOlderMessages` 把上一会话的历史拼进当前视口 —— 高

- 证据：`renderer/index.ts:2064-2123`。读取 `sessionId = state.activeSessionId`（:2065）→ `await fetchSessionMessages`（:2076）→ **无任何代际/会话校验** → `state.messages = [...batch, ...state.messages]`（:2086）。【已核实】
- 触发序列：
  - T1：会话 A 中滚到顶，`onscroll`（:6478）→ RAF（:6483）→ `loadOlderMessages()` 发出 REST 请求。
  - T2：请求在途（REST 往返，通常数十至数百毫秒），用户点击会话 B。`selectSession`（:2793）同步把 `state.activeSessionId` 改为 B 并 `await loadMessages(B)`，`state.messages` 变为 B 的消息。
  - T3：A 的批次返回，:2086 执行 `[...batch_A, ...messages_B]`。B 的视口顶部出现 A 的 30 条历史；`sessionServerOffset` 仍写 A（:2084），`state.hasOlderMessages` 被 A 的结果覆盖（:2085）。
- 对照：同文件 `loadMessages` 在完全同构的位置做了守卫（:2240、:2295）。说明这不是"设计取舍"，而是**遗漏**。【已核实】
- 后果：跨会话内容泄漏（B 的界面出现 A 的对话），且 `state.messages` 被污染后会被 `sessionMessagesCache` 回写（:2806 只在切走时写，故污染停留在内存视口，切走再回来即自愈）。【推断】

#### R-02 `ensureLiveSessionId` 捕获过期会话的 live id，导致提问发进别的会话 —— 高

- 证据：`:2393-2415`。入口读 `state.activeSessionId`（:2395/:2398），`await session.resume`（:2402/:2404），恢复后**不校验** `state.activeSessionId` 是否仍是同一个，直接 `state.activeLiveSessionId = handles.liveId`（:2408）并返回。【已核实】
- 触发序列：
  - T1：用户在会话 A 按 Enter。`sendMessage` 通过 `isStreaming` 检查（:3329），`await ensureLiveSessionId()`（:3339）。此时 `state.activeLiveSessionId` 为空（`selectSession` 在 :2811 主动置空，等待 `loadMessages` 的 resume 回填），于是发起 `session.resume(A)`。
  - T2：resume 在途，用户点击会话 B。`selectSession(B)` 置 `activeSessionId=B`、`activeLiveSessionId=''`（:2810-2811），随后 B 的 resume 回填 B 的 live id。
  - T3：A 的 resume 返回，:2408 把 **A 的 live id** 写入全局槽位并返回给 `sendMessage`。
  - T4：`sendMessage` 继续，`activeStreamingStoredSessionId = state.activeSessionId`（此时已是 **B**，:3398），`activeStreamingLiveId = liveId`（**A**，:3399），`prompt.submit({session_id: A 的 live id})`（:3477）。用户在 B 界面看到自己的提问与回复，实际写进了 A。
- 可达性：需要 `activeLiveSessionId` 为空。该窗口在每次 `selectSession` 的 `loadMessages` 期间存在（:2811 → :2828 之间，含 REST 往返）。代码注释自述网关 `session.resume` 在超大会话下"耗时高达 6~7 秒"（`core/src/rpc/client.ts:645`），窗口足够长。【已核实窗口存在；推断用户可命中】
- 加重因素：`sendMessage` 里 `isStreaming` 的判断（:3329）与置真（:3435）被 `await` 劈开，所以上述窗口内用户还能再发一次（R-07），两个回合共享同一个 `activeStreamingMessageId`。

#### R-03 `openGroupRoom` 把上一房间的日志写进当前房间 —— 中

- 证据：`:1467-1529`。置焦点（:1471-1476）→ `await fetchLogs`（:1484）→ **无校验** → `state.messages = logs.map(...)`（:1486）。【已核实】
- 触发：T1 点房间 A（慢 `groups.log`），T2 点房间 B（B 的 fetch 更快返回并渲染），T3 A 的日志返回并覆盖 `state.messages`，而 `activeFocus` 仍是 B。【推断：需 A 的日志请求比 B 慢】
- 同类第二处：`refreshGroupRoomLog`（:3174-3208）在 :3189 同样整体替换 `state.messages`，但它在赋值前有 `state.activeFocus.type==='group' && roomId` 的同步校验（:3188），**只有房间号匹配才写**——这是正确写法，可作为整改模板。【已核实】

#### R-04 `openBotChat` 在 `await` 之后回写焦点，覆盖用户后续选择 —— 中

- 证据：`:1535-1577`。缓存命中路径无 await（:1550-1556）；未命中路径 `await getOrCreateForeverChat`（:1562）→ `await selectSession`（:1566）→ **再次** `state.activeFocus = {type:'bot', botName}`（:1567）。【已核实】
- 触发：T1 点 Bot A（首次进入，走 RPC），T2 点 Bot B，T3 A 的 RPC 返回 → `selectSession(A 的主工位)` 把 `activeSessionId` 改成 A 的会话，:1567 把焦点改回 A。用户的 B 选择被静默撤销。【推断】
- 注意 :1565 也有一处重复写焦点（`await` 前），说明作者已意识到 `selectSession` 会改焦点，但没有解决"过期返回"这一半。

#### R-05 群聊轮询：多条链复用同一 timer 槽位 —— 中低

- 证据：`activeGroupPollerTimer` 单槽位（:3225），`pollGroupRoomLog` 入口 `clearGroupPoller()`（:3238）只清"已排队的定时器"，**无法取消已在 `await` 中的链**；恢复后旧链会在 :3261/:3298 重新赋值同一个槽位。【已核实】
- 触发：T1 房间 A 发送 → 链 1 启动并在 `await refreshGroupRoomLog` 中；T2 房间 B 发送 → `clearGroupPoller()` 清掉链 1 的待执行 timer，链 2 启动；T3 链 1 的 await 恢复，继续调度并覆盖 `activeGroupPollerTimer`。此后两条链并行，只有一条可被 `clearGroupPoller()` 杀掉。
- 后果：对同一房间并发 `fetchLogs`，各自在 :3189 整体替换 `state.messages`；较短的结果若后到会覆盖较长的（自愈于下一轮 1.2s，故列为中低）。旧链还会对 `activeRunningGroupRoomIds` 做 `applyTurnFailed`（:3290），可能清掉用户刚发起的新回合的运行态。【推断】

#### R-06 预览回补：缓存写入不在代际守卫内 —— 低

- 证据：`:1125-1176`。`gen` 在 :1128 取得，**写入 `sessionPreviewCache` 的 :1148 没有 gen 校验**；gen 校验只出现在 :1159（跳过落盘与渲染）与 :1172。【已核实】
- 触发：两轮 `enrich` 重叠（`fetchSessions` 在 :1305 每次都 `void enrich...`，且 `scheduleSessionsRefresh` 180ms 防抖可被连续触发）。A 轮慢、B 轮快，B 先写入新文本，A 后写入旧文本；A 因 gen 不符而不渲染，但**内存 Map 已被污染**，下一次 `fetchSessions` 在 :1290-1298 消费缓存时把旧文本刷回左栏。
- 放大条件：:1294 的 `tsDiff < 1000` 恰好只在"刚更新过"时生效，正是最需要正确的场景。【已核实条件】

#### R-07 `sendMessage` 的 `isStreaming` 检查与置真跨越 `await` —— 中低

- 证据：检查在 :3329，置真在 :3435，中间有 `await ensureLiveSessionId()`（:3339）与可能的 `await image.attach_bytes`（:3452）。【已核实】
- 触发：T1 发送 → 停在 :3339；T2 用户再次输入并回车（输入框已在 :6259 被同步清空，故需重新键入），事件层检查 `state.isStreaming` 仍为 false（:6247）→ 第二次 `sendMessage` 通过。
- 后果：两条 `prompt.submit` 同会话并发；`activeStreamingMessageId` 被第二次覆盖（:3397），reducer 用**当前**全局 id 解释所有 delta（:4196），第一回合的 token 会追加到第二回合的气泡里。【已核实机制；推断可达性依赖 resume 延迟】
- 已有缓解：事件层同步清空输入框（:6259）把"双击回车"这条最短路径堵死了，只剩"重新键入"路径。

#### R-08 回合看门狗是总时长而非静默检测 —— 中

- 证据：`TURN_WATCHDOG_MS = 10 * 60 * 1000`（:677），`armTurnWatchdog`（:3002-3024）只在 :3438 与 :3811 调用；`append-content`（:3814-3820）与 `append-thought`（:3822-3828）**不重置**。注释自称 "Force-unlocks the composer if a turn goes silent"（:3001）。【已核实】
- 触发：一个真实的长回合（多轮工具调用 > 10 分钟）。T1 第 10 分钟看门狗触发 → `tokenCoalescer.flush()`（:3007）→ 清空 `activeStreaming*`（:3017-3020）→ `isStreaming=false`（:3016）。T2 第 10 分 01 秒 delta 到达，reducer 的 `ctx.activeStreamingMessageId` 已是 null（:4196），`message.delta` 直接返回空（`eventReducer.ts:203-206`，主 Agent 复核）。T3 `message.complete` 到达时 `messageId` 为 null，`replace-content` 不产生（`eventReducer.ts:366-368`，主 Agent 复核）。后果限于本回合视口：权威文本不上屏，直到历史重载再展示；`persisted_turn` 锚点绑定（`eventReducer.ts:369-371`）不携带文本恢复分支，未见其他回合内恢复路径。【已核实机制；"权威文本完全不可见"以无其他恢复路径为条件】
- 后果：长回合的流式输出与最终文本都不上屏，直到重新加载历史。这与"看门狗防卡死"的设计目标正交，属于**语义错配**。【已核实机制】

#### R-09 删除会话无墓碑，特定交错下慢列表可复活 —— 中低（复活可达性有条件）

- 证据：`deleteSession`（:2519-2653）在多次 `await` 之后才 `state.sessions = state.sessions.filter(...)`（:2573）；删除过程不递增 `activeFetchSessionsGeneration`（:1059），也不写入任何删除标记。【已核实】
- 复活窗口是有条件的，不能下"必然复活"结论（移植自候选A 的分级裁决）：若删除动作或随后的 WS 通知触发了一轮新的 `fetchSessions`，在途的较旧列表请求会被代际门禁（:1185/:1234-1235）丢弃，不会复活；复活只发生在"删除全程没有新列表请求启动、且一条旧在途请求恰在 :2573 之后恢复提交"（:1260 写回）这一条序列上。【已核实两条保护；推断触发概率】该序列是否真实可达需一条交错用例确定，再决定墓碑的引入范围。
- 现状：`pruneSupersededSessions`（`core/src/session/sessionMerge.ts:113-122`）能处理"归档残影"，但依赖"权威列表已经不含该 id"，对"权威列表是删除前的快照"无效。【已核实】
- 与文档落差：`ENGINEERING_DISCIPLINE.md` 明确要求"逻辑删除墓碑（Tombstone）"，全仓无实现（见 §0 第 8 条）。

#### R-10 IPC cookie 跨网关串用 —— 低

- 证据：`main/ipc.ts:13` 定义、:188 写、:262-264 读；所有 `gateway:http-proxy` 请求共用。【已核实】
- 触发：T1 渲染层对网关 G1 发起 `/api/sessions`（在途）；T2 用户改地址重连到 G2，`gateway:authenticate` 把 `activeGatewayCookies` 覆盖为 G2 的 cookie；T3 G1 的请求实际带 G2 cookie → 401。反向（G2 请求带 G1 cookie）同理。
- 后果：偶发 401 被 `listSessions` 归类为"REST 失败"，静默回落 WS（`client.ts:609-626`），表现为"排序突然退化"而非报错。

#### R-11 焦点恢复阶梯在用户开始输入后仍抢选区 —— 低（但每次切会话都发生）

- 证据：`restoreComposerFocus`（:635-660）在同步、双帧 RAF（:653-656）与 50/200/400ms（:657-659）共 5 个时机执行 `input.focus()` + `setSelectionRange(len,len)`（:645-647）。**注释 :632-633 承诺"仅在当前活动元素非目标 input 时进行重聚焦"，代码里没有这个判断。**【已核实注释与实现的矛盾】
- 触发：T1 点击会话 → `selectSession` 末尾调用 `restoreComposerFocus`（:2849）；T2 用户在 50/200/400ms 内已把光标移到文本中部并开始输入；T3 定时器把光标强制拉到末尾并重设选区。
- 后果：输入内容不丢，但光标跳位；对中文输入法（composition 中）会打断候选。【推断】

#### R-12 `fetchSessions` 的自动选中与用户点击竞争 —— 低

- 证据：`:1307-1310` 在无活跃会话时 `await selectSession(state.sessions[0].id)`；`selectSession` 在 :2836 用 `sessionDraftMap.get(id)` 回填输入框，且**只判断当前输入框是否为空**，不判断当前会话是否仍是 `id`。【已核实】
- 触发：T1 冷启动 `fetchSessions` 完成，自动选中第一个会话并进入 `await loadMessages`；T2 用户点击会话 #3；T3 #1 的 `selectSession` 继续执行到 :2836，把 **#1 的草稿**写进 #3 的输入框（此时输入框为空）。【推断】
- 后果：草稿串会话；用户随后发送会把 A 的草稿发到 B。

#### R-13 RPC 超时不等于网关未受理 —— 中低

- 证据：`client.ts:538-542` 超时即 reject 并删除 pending；`sendMessage` 的 catch 分支（:3517-3535）把气泡写成 `[提交失败]`、清空 `activeStreaming*`、`disarmTurnWatchdog`。【已核实】
- 触发：网关受理了 `prompt.submit` 但 25s 内没回响应（大附件、网关排队）。T1 客户端判超时并解绑；T2 网关开始推送 delta → `messageId` 为 null → 全部丢弃（`eventReducer.ts:203-206`）；T3 回合在服务端正常结束，前端永远看不到。
- 同类：`disconnect()` 里的 `clearPendingRequests`（:433-439）把在途提交全部 reject，效果相同。【已核实】

### 4.2 伪并发（事件循环已保证顺序，不应作为竞态整改）

| 编号 | 现象 | 为什么不是竞态 |
|---|---|---|
| P-1 | 同一批 token 的 `push`（:3819）与 `step`（`tokenCoalescer.ts:70`）交错 | `push` 在 WS 宏任务内同步完成；`step` 只在 RAF 回调内执行。两者不共享一个执行片段。缓冲用 `Map` + 字符串累加，`step` 内不存在 `await`。【已核实】 |
| P-2 | 多个 `message.delta` 乱序导致文本错位 | 同一 socket 上帧序由 TCP 保证；`handleMessage` 同步分发（`client.ts:854-859`），缓冲按到达序累加。【已核实】 |
| P-3 | JSON-RPC 响应错配到别的请求 | id 单调递增且精确匹配（`client.ts:522`、:843-846）；超时项已删除，迟到响应被丢弃而非"复活"。这是**正确的防复活实现**，可作为 R-09 的参照。【已核实】 |
| P-4 | `message.complete` 的权威文本被缓冲 delta 覆盖 | `replace-content` 被**延迟**到 `turn-completed`，而 `turn-completed` 先 `tokenCoalescer.flush()`（:3952）再应用替换（:3954-3963）。顺序被显式钉死。【已核实】 |
| P-5 | 流式期间 `render()` 重建 DOM 与合流器写 `innerHTML` 撕裂 | `render()` 是同步函数（:4390-4972），与 RAF 回调不在同一执行片段；合流器每帧按 id 重新 `getElementById`（:834）。【已核实】 |
| P-6 | 删除会话后仍有 delta 写入 | reducer 在 :181-183 用 `activeSessionIds` 过滤；删除路径会清空 `activeStreaming*`（:2585-2589），且 `message.delta` 在 `messageId` 为 null 时返回空（`eventReducer.ts:205`）。三重防护。【已核实】 |
| P-7 | 工具 `start`/`complete` 乱序造成状态悬挂 | 以 `tool_id` 为唯一主键（`eventReducer.ts:285-286`、:321），并显式移除"改最近 running"兜底（`renderer/index.ts:3885`）。定理 10 已覆盖。【已核实】 |
| P-8 | 新建会话在首次落盘前闪烁消失 | `pendingIds` 在 `reconcileSessionList` 中优先保留（`sessionMerge.ts:319-321`）。【已核实】 |
| P-9 | `localStorage` 两个写者交错 | 同窗口内同步执行，无交错点。【已核实】 |
| P-10 | `render()` 与 `updateActivityPill()` 竞争同一 DOM | 两者同步，调用序即执行序；视觉顺序问题不构成数据竞态。【已核实】 |

### 4.3 非竞态但同类的重复写入（顺带发现，需运行验证）

合流器回调对**同一个** `msgId` 执行两次内容追加：

- 缓存分支：`cachedTarget.content += entry.content`（:804）。
- 视图分支：`targetMsg.content = (targetMsg.content || '') + entry.content`（:832）。
- 两者是否同一对象：发送时 `sessionMessagesCache.set(state.activeSessionId, [...state.messages])`（:3433）是**浅拷贝**，`cachedTarget` 与 `targetMsg` 指向同一 `MessageViewModel`。【已核实 3430→3433 顺序与浅拷贝语义】
- 结论：同一 chunk 被追加两次，流式文本翻倍，直到 `message.complete` 的 `replace-content`（:3956）把它纠正为权威文本。【推断：未运行验证；若存在某条路径在回合中把 `state.messages` 换成副本，则表现为"视口与缓存发散"而非翻倍，同样是缺陷】
- 影响面：仅流式期间的可读性，不影响落盘数据；但这解释了为什么"最终文本总是对的、过程文本可疑"。

---

## 5. 不变量锁定面

适用边界声明（移植自候选A）：下表锁定面来自三个 formal 文件的静态核对，定理以直接调用纯函数的属性测试建模，不建模 renderer 的异步调度、RAF 交错、localStorage 重载与焦点切换时序；本轮未执行任何测试命令，"已锁定"不等于"门禁当前通过"。【已核实】

### 5.1 已被 fast-check 数学锁定的 11 条

| # | 定理 | 证据 | 锁定的不变量 | 对应工程承诺 |
|---|---|---|---|---|
| 1 | 领域绝对隔离 | `core/__tests__/formal/bot-activity-formal.test.mjs:25` | 普通会话池任意变动不污染 Bot 卡片 | AGENTS.md「严禁冒名覆盖」 |
| 2 | 时间戳归一化完备性 | 同上 :123 | 任意畸形输入收敛为有限非负数 | — |
| 3 | 时间全序非递增单调性 | 同上 :158 | 任意次 `applyBotActivity` 后 profiles 保持降序 | — |
| 4 | 反哺管道排他纯洁性 | 同上 :231 | 普通会话调 `syncActiveSessionToBot` 恒返回 null 且不污染 Map | — |
| 5 | 跨 Profile 去重强幂等 | `session-merge-formal.test.mjs:30` | `dedupe(dedupe(S)) == dedupe(S)` | — |
| 6 | 失败不可致空 | 同上 :48 | 非权威返回时本地会话绝不被抹除 | ENGINEERING_DISCIPLINE「Failure Is Not Empty」 |
| 7 | 去重结果时间降序 | 同上 :91 | 输出单调非递增 | — |
| 8 | 回滚乐观截断往返恒等 | `interactive-stage-formal.test.mjs:73` | `kept+removed` 精确分解且重组恒等；非 user 行拒绝截断 | — |
| 9 | 截断锚点排他性 | 同上 :113 | row/message 锚互斥、临时 id 零逃逸 | 防 4018 |
| 10 | 流式工具状态机收敛 | 同上 :202 | 无幽灵 running、同 id 去重、全部 complete 后零残留 | — |
| 11 | @ 路由排他性 | 同上 :317 | 通道类型排他 + cleanText 不含 @token | — |

合计 `numRuns` 约 15,300 次随机采样（逐条累加：4500 + 3000 + 7800）。【已核实各 `numRuns` 字面量】

### 5.2 只有文档承诺、没有数学锁定的

| 不变量 | 承诺出处 | 实现状态 |
|---|---|---|
| WebSocket 5 态 FSM 的合法转移 | AGENTS.md 架构章节 | `transitionTo` 不校验前置态（`fsm.ts:40-50`）；`fsm.test.mjs` 仅 3 条示例断言（:6/:11/:36），非属性测试 |
| Token 合流的帧预算与"不丢字符" | 合流器头注释（`tokenCoalescer.ts:13-15`） | `tokenCoalescer.test.mjs` 仅 3 条示例测试；`clear()` 丢弃缓冲的语义已被示例固化（该文件 :45-56），但 `disconnect`（`renderer/index.ts:4245`）与 `deleteSession`（:2583）会在**活跃回合**上调用它，缓冲内容不可恢复——语义正确，使用场景需要复核；`clear()` 仅在 `rafId` 非空时 `cancelAnimationFrame`，已进入派发边界的 RAF 回调能否取消取决于浏览器是否已派发该回调（`tokenCoalescer.ts:118-136`）【移植候选A，已核实行段】 |
| 实体活动三态机（running > unread > read） | `activityState.ts:21-25` | `activityState.test.mjs` 示例测试；无属性测试 |
| 单调版本号 + CAS 写入 | ENGINEERING_DISCIPLINE 二·1 | **前端无实现**（全仓无版本号/409/冲突检测） |
| 删除墓碑防复活 | 同上 | **无实现**（见 R-09） |
| 重试携带幂等键 | 同上 | 仅 `session.branch` 有（`interactiveService.ts:148`）；`prompt.submit`（:3476）与 `session.delete`（:2546）无 |
| 单一集中式动画时钟 | ENGINEERING_DISCIPLINE 二·6 | 部分：工具秒表确为单 `setInterval(200)`（:6839），但 `flux-pulse` 仍是 CSS `infinite`（:3768） |
| 队列配置冻结 | AGENTS.md / `chatQueueStore.ts:1-19` | **该类零生产消费者**：`chatQueueStore` 在 `renderer/index.ts`、`packages/ui/src`、`packages/mobile/src` 中均无 import（仅 `core/src/index.ts:26` 再导出；主 Agent 复核 grep 一致）；实际行为是"流式中直接拒绝发送"（:3329-3333）。即便未来接入，item 字段仅覆盖 provider/model/profile/attachments/thinkingVariant，**无工具上下文字段、无持久化实现**（`chatQueueStore.ts:22-69`【移植候选A，已核实行段】），AGENTS.md 承诺的"挂载工具上下文"冻结在 Store 契约上不成立 |

### 5.3 文档与资产的漂移

1. `AGENTS.md:34`、`:109`、`:131` 三处写"7 大数学定理"，实际为 11 条（定理编号 1–11 见上表）。【已核实】
2. `package.json:19` 的 `verify:formal` 只跑测试、不构建；三条定理文件全部从 `dist` 导入（`session-merge-formal.test.mjs:8`、`bot-activity-formal.test.mjs:11`、`interactive-stage-formal.test.mjs:31`）。在完整 `verify` 链（`package.json:44`）中 `typecheck`（:29）会重建 `dist`，但**单独执行 `verify:formal`（AGENTS.md 列为"状态机必跑"）验证的是磁盘上已有的产物**。【已核实】
3. `ENGINEERING_DISCIPLINE.md` 的"权威状态与通道隔离"要求"实时通道派生活跃度"，而渲染层的活跃度来源是 6 个模块级 Set（:504-509），由 WS 事件、用户操作、看门狗、断线四个 actor 写入——语义正确，但没有单一收口函数（`settleTurnTermination`（`activityState.ts:152-161`）只覆盖了终止路径）。【已核实】

---

## 6. 风险排序与最小整改方向

只列方向与涉及文件，不含代码。

### P0（会造成跨会话数据错位，必须优先）

1. **把"代际守卫"抽成统一原语并覆盖全部 4 个缺口。** 涉及 `renderer/index.ts`：`loadOlderMessages`（:2064）、`openGroupRoom`（:1467）、`openBotChat`（:1535）、`ensureLiveSessionId`（:2393）。判据统一为"恢复后校验 `(activeSessionId, generation)` 未变，否则丢弃并记 debug"。可直接照抄 `loadMessages` 的写法（:2240/:2295）。
2. **把 `activeStreaming*` 四元组收进单一不可分割对象。** 涉及 `renderer/index.ts:491-502` 及全部清空点（:2585、:3017、:3101、:4016、:4044、:4247）。目标是消灭"半清空"中间态，让"有没有在途回合"只有一个判据。

### P1（可复现、影响可用性）

3. **群聊轮询改为按房间持有句柄**（`Map<roomId, handle>`），并在链内每次恢复后校验句柄仍是当前句柄。涉及 `renderer/index.ts:3225-3306`、`refreshGroupRoomLog:3174`。
4. **看门狗改为"最后事件时间"驱动**：`append-content`/`append-thought`/`tool-start` 都重置计时；或拆成"静默检测"与"总时长上限"两条独立策略，后者只提示不解除绑定。涉及 `:677`、`:3002-3024`、`:3811-3828`。
5. **删除路径先证实复活窗口，再做最小作废**：先写交错用例确定"删除全程不触发新列表请求"的序列是否真实可达（R-09 条件分支【移植候选A】）。可达则先做最小改动：删除开始即递增 `activeFetchSessionsGeneration`（:1059）作废在途列表；墓碑按验证结果决定引入范围。涉及 `:2519-2653`、`core/src/session/sessionMerge.ts:259`。
6. **提交超时与"网关是否受理"解耦**：`prompt.submit` 超时后不要立刻解绑流式槽位，改为进入"未知态"并等待首个 delta 或 `message.complete` 认领。涉及 `:3517-3535`、`core/src/rpc/client.ts:538`。同步收紧其余失败语义：`listSessionsSafe`（`core/src/rpc/client.ts:631-638`，主 Agent 复核）吞掉 `ok` 只回列表，其注释自述"需要区分空与失败时应改用 `listSessions`"，调用方逐个改用带结果的版本【移植候选A】。

### P2（低成本、可顺手做）

7. **IPC cookie 按 `baseUrl` 分桶**。涉及 `main/ipc.ts:13`、`:188`、`:262-264`。
8. **实现注释已承诺的焦点守卫**：`restoreComposerFocus` 的 5 个时机都加"当前活动元素是否已是目标 input 且用户已输入"的判断。涉及 `:632-660`。
9. **`fetchSessions` 自动选中改为"仅在仍无活跃会话时"**：`await selectSession` 之后校验 `state.activeSessionId` 是否被用户改动。涉及 `:1307-1310`、`:2836`。
10. **合流器双写修正**（§4.3）：明确"缓存是唯一写入者、视图从缓存派生"或反之，只保留一条追加路径。涉及 `:780-846`。

### P3（治理与文档）

11. **补齐形式化资产**：为 `WebSocketFsm` 合法转移、`TokenCoalescer` 帧预算/清空语义、`activityState` 三态迁移、`planSessionLoadMerge` 防复活各增一条属性测试；`verify:formal` 前置 `build:core`。涉及 `packages/core/__tests__/formal/`、`package.json:19`。
12. **订正文档**：`AGENTS.md` 的"7 大定理"→11；`ENGINEERING_DISCIPLINE.md` 的 CAS/墓碑/幂等键三条要么排期实现，要么显式标注"未落地"，避免后续 Agent 依据不存在的护栏做设计。

---

## 附录 A：对共享 grounding 锚点的核验结果

| grounding 陈述 | 核验 |
|---|---|
| `fsm.ts` FsmState :6、transitionTo :40-50 不校验前置态 | ✅ 完全一致 |
| `client.ts` 转移驱动 :385/:391/:397/:404/:423/:454，生命周期监听 :237-250 | ✅ 一致 |
| `tokenCoalescer.ts` RAF 节拍、自适应步长 | ✅ 一致（:62-66、:91） |
| `renderer/index.ts` 约 7,072 行 | ✅ 实测 7,072 行 |
| `:607 updateBotLatestActivity` | ✅ 一致 |
| `:3308` 发送逻辑 | ✅ 一致 |
| `:3819/:3827` 合流器写入 | ✅ 一致 |
| `:3940 flush 回调` | ⚠️ 实际 `turn-completed` 分支起始于 :3951，`flush()` 在 :3952 |
| `:1363 listProjects().catch(()=>[])` | ✅ 一致（且与 :1397 注释自相矛盾，见 A-1） |
| `:2390-2405 ensureLiveSessionId 对 4001 的恢复重试` | ⚠️ 该段实际是"带 profile 失败则去掉 profile 重试"（:2401-2405），**不是** 4001 专用恢复 |
| `:2534-2553 deleteSession 对 4023 降级软删` | ✅ 一致（:2550-2557） |
| `:940-967` 三处裸 fetch | ✅ 一致（:940/:955/:967，均为连接探测，无写） |
| `:546 botForeverChatCache` | ⚠️ 实际定义在 :1532 |
| `botActivitySync.ts` applyBotActivity :85 | ✅ 一致 |
| `renderer :592 写入 hermes_flux_bot_activity` | ⚠️ 函数在 :592，`setItem` 在 :599 |
| `chatQueueStore` 入队即快照 | ✅ 代码一致，但**零生产调用**（见 §5.2） |
| formal 三文件 11 定理 | ✅ 一致 |

A-1：`fetchProjects`（:1359-1402）在 :1363 用 `.catch(() => [])`，随后在 :1387 无条件 `state.projects = summaries.map(...)`；而 :1397 的注释写着"网络或网关故障时绝不可将 state.projects 抹杀为空数组"。函数自身的注释与实现冲突。【已核实】

## 附录 B：本次未覆盖

- 冷启动三源合流未单独裁决：localStorage 0ms 恢复、网关权威列表、过期在途请求三者对同一 Map 的先后关系。已知保护是代际守卫（:1185/:1234-1235）、`pendingIds` 保留（`sessionMerge.ts:319-321`）与定理 6；已知缺口是预览缓存写入越界（R-06）与删除复活（R-09）。bot 活动冷启动反哺（`fetchProfiles` 并发分支 :1626-1679）无专项交错验证。列为 P2 后续项。
- 移动端 bridge 脚本与 renderer bundle 在注入 HTML 中的加载先后与初始化依赖未追踪（`prepare-assets.mjs:27-59` 已核实复制与注入，未核实脚本顺序）。列为 P2 后续项。
- Python 网关侧的并发（`tui_gateway`）：不在仓库内，无法核实其事件发射顺序。
- Web/移动端实际运行时（`packages/mobile/src/capacitor-bridge.ts` 已读，但未验证 WebView 前后台切换对 RAF/定时器的节流行为）。
- 真实网络条件下的时序：所有"可达性"判断均为静态推理，未做运行时复现。
- 渲染性能（`render()` 全量重建的帧预算）：属于性能议题，未展开。
