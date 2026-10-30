# Hermes Flux Desktop — 已知遗留项与后续路线

> 本文件记录 2026-10-29 那轮围绕 desktop 三个线上故障（模型菜单自动收起、会话第二轮无响应、会话栏不刷新）的修复过程中，
> **已经证实但尚未处理**的问题。每条都标注了证据来源，便于后续接手时不必重新排查。
>
> 协议基线：真实 Gateway v0.22.5（自建 dashboard 网关，地址、账号等连接信息只存在本机配置里，不入库）实测，
> 契约文档见 [gateway-api-and-features-matrix.md](./gateway-api-and-features-matrix.md)。

## 状态图例

- 🔴 会直接影响用户可用性（下一个迭代必须做）
- 🟠 正确性 / 一致性缺陷（数据可能对不上，但不至于白屏）
- 🟡 工程质量债（可维护性、可测性、可重复性）
- ✅ 已在本轮修复，列在此处仅为记录结论

---

## 一、进行中发现的协议事实（实现时必须遵守）

这一节是本轮用真实网关探针（`session.create / list / resume / config.set / prompt.submit` + 下行事件抓包）确认的事实，
与仓库里旧代码的假设不一致，后续实现请以此为准。

| 事实 | 证据 |
|---|---|
| 会话有两套 ID：`session.create` 返回 `session_id`（live，如 `46546345`）与 `stored_session_id`（如 `20261028_155631_8bcc62`）；`session.list` 只给 stored | 探针直接打印两组 ID |
| `prompt.submit` / `config.set` **只接受 live id**，传 stored id 报 `4001 session not found` | 探针实测 |
| `session.resume({session_id: <stored>})` 是唯一的桥：返回里带 live `session_id` | 探针实测 |
| 回合终态事件是 `message.complete`；`session.idle` / `agent.turn_end` **不存在** | 抓包：`message.start → message.delta → message.complete → session.info → sessions.changed` |
| 会话变更广播是 `sessions.changed`（一轮对话会推 3~4 次），轨道必须去抖刷新 | 抓包 |
| 新会话在首个回合落库前**不在 `session.list` 里**，必须本地乐观插入 | create 后立即 list 查不到 |
| `prompt.submit` 不接受 `reasoning_effort`（`4000 Extra inputs`），思考深度只能走 `config.set key=reasoning` | 探针实测 |
| `config.set key=model` 拒绝"被多个 provider 同时声明"的模型（`5001`），且**无法**通过额外参数指定 provider（`4000 Extra inputs`） | 探针实测，见下方 🟠-1 |
| `session.interrupt` 接受 live id，返回 `{status:'interrupted'}`，随后会补一个 `message.complete` | 探针实测 |
| `session.history` 不接受 `limit`（`4000`），无参则报会话不存在；历史只能走 `session.resume` | 探针实测 |
| `session.delete` 对仍在运行的会话报 `4023 cannot delete an active session` | 探针实测 |
| 多会话并行流式必须以 `storedId` 严格隔离缓存与 UI 挂载 | 2026-10-30 会话串台排查实测 |
| Tool 耗时与状态必须按 message/toolId 独立计时，文件读写联动 InspectionPod | 对标 OpenChamber 交互体验 |
| 空消息与工具调用下方严禁孤立渲染打字光标（避免绿色小块闪烁） | UI 视觉 Bug 实测修复 |

---

## 二、🔴 必须尽快处理

### 🔴-1 连接掉线后界面永久停在"未连接"

- **现象**：网关闪断（或代理断流）后，WS 客户端内部会自动重连，但界面不会恢复：输入舱消失（`gatewayConnected=false` 时不渲染 dock），必须手动去设置里点"保存并连接"。
- **根因**：[renderer/index.ts](../packages/desktop/src/renderer/index.ts) 在 `connect()` 里把 `open` / `close` / `error` 监听挂在
  `gatewayClient.getRawWebSocket()` 返回的**当时那个** `WebSocket` 实例上；而 [client.ts](../packages/core/src/rpc/client.ts) 的自动重连会
  `this.ws = new WebSocket(...)` 换掉实例，旧实例的监听再也不会触发。
- **建议**：让 `HermesGatewayClient` 通过 FSM 的 `onStateChange` 对外广播连接态（它已经有 `WebSocketFsm` 与 `onStateChange`），
  渲染层订阅 FSM 而不是裸 socket；重连成功后需要重新 `fetchSessions()` 并重置 `activeLiveSessionId`（live id 在服务端重连后可能失效，需重新 `session.resume` 兑换）。
- **影响文件**：`packages/desktop/src/renderer/index.ts`、`packages/core/src/rpc/client.ts`

### 🔴-2 删除"正在运行"的会话会让用户无从下手

- **现象**：点删除 → 后端返回 `4023 cannot delete an active session`，界面只弹一条错误 notice，用户不知道要先停。
- **建议**：删除前先 `session.interrupt`，再 `session.delete`；或删除按钮对 `running` 会话置灰并提示"请先停止本轮生成"。

---

## 三、🟠 正确性 / 一致性缺陷

### 🟠-1 切换"多 provider 同名模型"仍然切不动

- **现象**：模型列表里有 297 个模型（来自 4 个 provider，`nous / xai-oauth / cpa / custom:gitee-ai`），
  其中像 `deepseek-v4.1-flash` 这种被多个 provider 声明的，`config.set` 直接 `5001` 拒绝。
- **已验证**：`config.set` 的 params 是严格 schema，**无法**附加 `provider`（试过 `provider` 顶层参数、`value` 内嵌对象，均 `4000 Extra inputs`）；
  唯一能成功的是"全局唯一的模型 id"（例如 `claude-opus-4-6` → 实测切换成功且下一轮 `session.info.model` 生效）。
- **待办**：去官方客户端 `ModelPicker.tsx` / `config.yaml` 写入路径里确认真实换模型方式（候选：直接写 `config.yaml` 的 `model`/`provider` 字段，或存在尚未发现的 `model.*` RPC）。
  在确认之前，UI 应当：① 按 provider 分组展示、② 对歧义模型禁用或明确提示"该模型需在网关侧指定 provider"。
- **现状（本轮）**：失败原因已如实展示在输入舱的 notice 里，不再静默成功。

### 🟠-2 检查舱（InspectionPod）四个页签没有任何真实数据源

- **现象**：成果物 / 浏览器 / Git 变更 / 认知记忆 四个页签永远是空态。
- **根因**：渲染层监听的事件名 `artifact.created`、`artifact.updated`、`browser.frame`、`browser.navigate`、`git.diff`、`workspace.diff`
  **在网关契约里不存在**（见 [gateway-api-and-features-matrix.md](./gateway-api-and-features-matrix.md#四官方下行事件gateway--client-push-77-个全量清单与监听状态)）。
- **建议**：要么接真实事件（`tool.start` / `tool.complete` 派生成果物、`browser.progress`、`sessions.changed` 派生 diff），
  要么按 Gate 4「物理入口可达」原则先把空页签摘掉，不要摆一个点了没内容的入口。

### 🟠-3 契约里 77 个下行事件，目前只消费了少数几个

已接入：`message.start`、`message.delta`、`thinking.delta`、`reasoning.delta`、`message.complete`、`sessions.changed`、`session.title`、`error`。

建议下一批接入（按对桌面端价值排序）：

1. `session.info`（model / provider / running / cwd / usage，可用于顶部元信息与"运行中"指示）
2. `tool.start` / `tool.complete` / `tool.generating`（工具胶囊，`MessageViewModel.toolCalls` 的数据源）
3. `gateway.ready`（握手后第一帧，可用于判定"真正就绪"而非"TCP 已连"）
4. `status.update` / `notification.show`（状态栏呼吸态与 Toast）
5. `approval.pending` + `approval.respond`（审批策略目前只是写 `config.set`，没有真正的审批 UI）

### 🟠-4 会话历史里的思维链与工具调用会丢失

- **现象**：`session.resume` 返回的消息行结构只有 `{role, text, timestamp, row_id}`，没有 `thinking` / `tool_calls`；
  因此"重新打开历史会话"看不到当时的推理链与工具卡片（实时流式时是有的）。
- **待办**：确认是否有 `session.events.since` 之类的补拉接口能还原事件流，否则需在本地持久化。

---

## 四、🟡 工程质量债

### 🟡-1 渲染架构：整树 `innerHTML` 重建

`render()` 用字符串模板整体替换 `#aura-app-root`，然后手工重绑全部 `onclick`。本轮已经做了补救
（菜单开合进 state、草稿/焦点/光标/滚动位置恢复），但它仍是以下问题的根源：

- 输入法组合（IME）期间若恰好发生一次 `render()`，组合过程会被打断；
- 任何新的瞬时交互态都必须显式搬进 `AppState`，否则重蹈"模型菜单一点就收"的覆辙；
- 消息很多时每次 `render()` 都要重新解析全部 Markdown。

**建议**：把 `packages/ui` 的模块字符串组件替换为真实组件树（lit 或 React），保留现有 `renderMarkdown` 与设计 token。
这是本文件里最值得投入的一项，其余多数 🟠 项都会被它顺带解决。

### 🟡-2 实时网关 e2e 仍需人工兜底（凭据部分已整改）

- ✅ 已整改：`gateway-e2e.test.mjs` 不再硬编码地址 / 账号 / 内网 IP，改为只读 `HERMES_GATEWAY_URL`、`HERMES_USERNAME`、`HERMES_PASSWORD`；
  未设置时整组 `skip`，`npm test` 重新变成离线可重复。
- 遗留：断言依赖 `setTimeout(..., 10000)` 抢跑判断流式是否开始，网关稍慢就会假红（本轮实测偶发过一次）。建议改成等 `message.complete` 事件驱动。
- 遗留：用例会在真实网关上创建会话且跑完不清理，长期累积垃圾会话。

### 🟡-3 类型逃逸（Gate 1 名义通过、实质未达）

- `packages/desktop/src/preload/index.ts`：`body?: any`、`params?: any`、`httpProxy` 返回 `Promise<any>`。
- `packages/desktop/src/main/ipc.ts`：`statusData: any`、`(loginRes.headers as any).getSetCookie()`、`fetchOptions: any`。
- 建议为 `httpProxy` 定义 `HttpProxyRequest/HttpProxyResponse` 泛型，IPC 边界用 `unknown` + 校验函数收口。

### 🟡-4 `GatewayDaemonManager` 是一个假探测器

- `getStatus()` 里 `version: 'v0.9.4-rc'` 写死；`restart()` 只是重新 `ping()` 一次，并没有重启任何进程。
- 它 ping 的是 `127.0.0.1:8642/health`（本地 api_server），而应用实际连的是远端 dashboard（1519），二者并非同一对象。
- **建议**：要么接真实的本地守护进程管理（spawn + 端口探测 + 优雅退出），要么把这个模块降级为"本地端口探活"并如实命名。

### 🟡-5 双包管理器并存

仓库同时跟踪 `package-lock.json`（npm）与新出现的 `pnpm-lock.yaml` + `pnpm-workspace.yaml`，`package.json` 里又写着 `workspaces`。
三者混用会导致依赖树在 CI 与本地不一致。**建议**择一（推荐 pnpm，删掉 `package-lock.json` 与 `workspaces` 字段）。

### 🟡-6 UI 组件测试只断言"字符串包含"

`packages/ui/__tests__/layout.test.mjs` 全是 `html.includes('...')`，它能守住设计规范（740px、22px 等），
但无法发现行为缺陷——这正是三个线上 bug 期间测试**全绿**的原因。
本轮已补充有行为语义的用例（`inputdock-menu.test.mjs`、`session/*.test.mjs`），建议后续新增 UI 交互一律先写纯逻辑 reducer 再测。

---

## 五、✅ 本轮已修复（记录结论，便于回溯）

| 问题 | 根因 | 修复位置 |
|---|---|---|
| 模型菜单一点就自动收起 | 开合状态存在 DOM 上，`fetchModelOptions()` 触发整树重建把它销毁 | `modelMenuOpen` 进 `AppState`；[InputDock.ts](../packages/ui/src/components/InputDock/InputDock.ts) 由 state 决定 `display` |
| 第二轮输入无响应 | `isStreaming` 只等 `session.idle` / `agent.turn_end`（不存在），永久闩锁 | 改由 `reduceGatewayEvent` 处理 `message.complete` 解锁 + 10 分钟看门狗兜底；[eventReducer.ts](../packages/core/src/session/eventReducer.ts) |
| 会话栏不刷新、新会话不出现 | 未监听 `sessions.changed`；live/stored ID 混用；新会话未落库 | `sessions.changed` 去抖刷新 + 乐观插入 + 双 ID 统一；[sessionRegistry.ts](../packages/core/src/session/sessionRegistry.ts) |
| 流式时"停止"按钮点了没反应 | 没有 `session.interrupt` 调用 | 发送键在流式时执行中断；[index.ts](../packages/desktop/src/renderer/index.ts) `interruptTurn()` |
| 失败被静默吞掉 | 满屏 `.catch(console.warn)`；`listSessionsSafe` 把失败当空列表 | 输入舱 `notice` 条 + 会话栏失败态；`client.listSessions()` 返回 `{ok,error}` |
| 编造的兜底模型列表 | `defaultFallbackModels` 是假模型名 | 删除假数据，改为如实报错 |
| 仓库内硬编码个人网关地址 | 默认连接地址写死了自建域名，随源码进入公开仓库 | 统一改为中性默认 `http://127.0.0.1:9119`；连接信息只走本机 `localStorage` / 设置页，账号与内网地址一律不入库 |
| 对话区在发送与流式期间来回跳动 | `content-visibility: auto` + `contain-intrinsic-size` 让离屏行用估算高度，`scrollHeight` 随行进出视口反复变化；流式 flush 无条件 `scrollTop = scrollHeight`，与后台 `render()` 的锚点恢复互相拉扯 | 删除 `.message-row` 的 `content-visibility`；flush 仅在"距底 ≤ 48px"时跟随；`render()` 继承 follow 模式（渲染前在底部就渲染后贴底），否则走锚点校正 |

---

## 六、可观测性：分级日志与滚动诊断（2026-10-29 第二轮）

### 6.1 分级日志

- 实现：[logger.ts](../packages/core/src/log/logger.ts)，零依赖，主进程 / 渲染进程 / 单测共用。
- 级别：`silent < error < warn < info < debug < trace`，默认 `info`。
- 级别来源优先级：`?log=<level>` → `localStorage.hermes_flux_log_level` → `info`。
- 开发态自动开 `debug`：主进程在 `app.isPackaged === false` 时以 `loadFile(..., { query: { log: 'debug' } })` 打开窗口；
  可用 `FUS_LOG_LEVEL` 环境变量覆盖，打包版始终默认 `info`。
- 运行期切换：DevTools 里 `__fluxLog.setLevel('trace')`（同时写入 `localStorage` 持久化），`__fluxLog.level` 读当前值。
- 注意：`info` 走 `console.debug` 通道（避免 DevTools 把常规信息标成警告），所以 DevTools 里 `type=debug` 不等于级别是 `debug`。

### 6.2 已埋点位置

| 事件 | 位置 | 关键字段 |
|---|---|---|
| `renderer boot` | `init()` | 级别、主题、平台 |
| `session loaded` | `loadMessages()` | `fetched / parsed / mounted / older`、`rpcMs`、`parseMs`、`totalMs` |
| `session rendered from cache` | `loadMessages()` 缓存命中 | `total / mounted / ms` |
| `render` | `render()` | `ms`、`messages`、`htmlKB`、`forcedBottom`、`pinBottom`、`anchor` |
| `flush` | TokenCoalescer 回调（trace） | `ms`、`messages`、`chars`、`followBottom`、`scrollTop` |
| `layout shift` | PerformanceObserver(`layout-shift`) | `value`、`scrollTop`、`scrollHeight`、`streaming` |
| `pinned to bottom` / `anchor corrected` / `post-layout anchor drift absorbed` | 滚动路径 | 位移量与原因 |
| `older batch prepended` | `loadOlderMessages()` | `batch`、`addedHeight`、`residualDrift`、`ms` |

定位大会话"打开慢"时看 `session loaded`：`rpcMs` 高是网关往返，`parseMs` 高是消息解析，`render` 的 `ms`/`htmlKB` 高是 DOM 重建。
定位"跳动"时看 `layout shift` 与 `anchor corrected` 的时间相邻关系。

---

## 七、建议的下一步顺序

1. 🔴-1 断线自愈（FSM 订阅）—— 否则桌面端在弱网下不可用
2. 🟡-2 剩余部分（把 e2e 断言改成事件驱动、跑完清理会话）—— 凭据与地址泄漏面已收口
3. 🔴-2 删除活动会话
4. 🟠-1 模型切换 provider 歧义（需先确认官方写法）
5. 🟡-1 组件化改造（放长线，收益最大）
6. 🟠-2 / 🟠-3 / 🟠-4 事件与检查舱补齐
