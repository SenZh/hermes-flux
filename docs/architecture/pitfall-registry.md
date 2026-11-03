# 坑位登记册（Pitfall Registry）

> 每一条都必须是"踩过的真实坑"，并且必须能回答三个问题：
> **症状是什么 / 根因是什么 / 现在由哪个探针守着**。
> 没有守卫的条目不算登记完成——只写文档不改门禁，等于没修。

## 使用规则

1. 新增条目必须同时提交守卫（门禁规则 / 单测 / fixture 断言）之一，否则 PR 打回；
2. 条目只增不删。问题彻底不可能复发时，在条目末尾标注 `已消除` 并说明原因；
3. 排查新问题时先来这里搜症状关键词，避免重复推理。

---

## P-001 契约错误被降级成空数据（头像永远是旧的）

| 项目 | 内容 |
|---|---|
| 症状 | 所有 Bot 头像一直显示几何占位图，界面无任何报错 |
| 根因 | `profiles.get_asset` 多传 `key` 字段 → 网关 `4000 Extra inputs are not permitted` → `catch { return null }` 把错误伪装成"没有资产" |
| 识别特征 | 上游有数据、下游为空、日志里什么都没有 |
| 守卫 | ① `integrity/silent-catch` 门禁禁止空 catch；② `contract:verify` 校验字段白名单；③ 运行时请求守卫在发送前抛 `ContractViolationError`；④ fixture 测试断言 `found/data` 形状 |
| 复现命令 | `HERMES_GATEWAY_URL=... npm run probe:gateway`（负向探针会打印 4000） |

## P-002 通道错配：把 roomId 当 sessionId（群聊发不出去）

| 项目 | 内容 |
|---|---|
| 症状 | 群聊发送返回 `[4001] session not found` |
| 根因 | 群聊消息走了普通会话的 `prompt.submit`，而 roomId 不是 session；同时 `groups.send` 参数平铺 `text`，契约要求 `payload: { text, thread_id }` |
| 识别特征 | 错误码指向会话层，但实际是路由层错误 |
| 守卫 | ① `sendMessage` 显式按 `activeFocus.type === 'group'` 分流；② `contract:verify` 校验 `groups.send` 字段；③ 单测断言 `payload.text` 与 `payload.thread_id` 同时存在；④ 探针负向用例证明平铺 `text` 会被 4000 |
| 真实契约 | `GroupsSendParams { room_id, event_id, payload: { text, thread_id } }` |

## P-003 归一化层静默丢字段（旧群聊查不到）

| 项目 | 内容 |
|---|---|
| 症状 | 官方桌面端创建的群聊房间在列表里不存在，历史发言也没有 |
| 根因 | `listProfiles()` 用白名单挑字段，把 `ui_meta` 整块丢弃；而旧群聊只存在于 `ui_meta['hermes-bots-groups'].rooms` |
| 识别特征 | 上游响应里字段存在，下游读 `undefined`，中间零断言 |
| 守卫 | ① `normalizeAgentProfile` 单一实现，两条路径共用；② fixture 测试断言 `uiMeta` 原样透传；③ `AgentProfile` 类型显式声明 `uiMeta`/`hasAvatar` |
| 注意 | 这类房间不是网关托管房间，`groups.log` 对其返回 `4112`，发言流只能取自 `ui_meta` 本地日志 |

## P-004 去重键作用域错误（会话凭空消失）

| 项目 | 内容 |
|---|---|
| 症状 | 某条真实会话在列表里找不到，但接口确实返回了它 |
| 根因 | 会话 ID 是"时间戳前缀 + 短随机后缀"，不同 Profile 独立生成会碰撞；用裸 `sessionId` 全局去重时，另一 Profile 的空白会话先到并占住 ID，真实会话被当重复丢弃 |
| 识别特征 | 合并后总数少于各 Profile 之和，且没有任何提示 |
| 守卫 | ① 去重键固定为 `profile::sessionId`；② `dedupeSessionsWithReport` 返回 `dropped` 对账；③ 单测断言跨 Profile 同 ID 必须全部保留；④ 渲染层把 `dropped` 写入 debug 日志 |

## P-005 心跳方法不存在（半开连接永不恢复）

| 项目 | 内容 |
|---|---|
| 症状 | 断网/休眠唤醒后界面长期显示"已连接"，实际收不到任何消息 |
| 根因 | 心跳使用不存在的 `system.ping` → 网关 `-32601` → `.finally` 清理看门狗 → 看门狗**从未生效** |
| 真实方法 | `ping`（`tui_gateway/methods_voice.py`，返回 `{ pong: true }`，WS reader 线程直接应答） |
| 守卫 | ① `EXTRA_METHODS` 白名单逐条登记来源；② 探针每次真实调用 `ping` 并录 fixture；③ 单测断言只有"服务器确实回包"才清理看门狗；④ 契约校验禁止再出现 `system.ping` |

## P-006 凭空假设接口存在（subagent.spawn）

| 项目 | 内容 |
|---|---|
| 症状 | 子代理派生永远失败，错误信息指向业务原因，查不到真相 |
| 根因 | 网关契约里没有 `subagent.spawn`（只有 list/steer/interrupt/tail），请求返回 `-32601` 后被包装成"唤起失败" |
| 真实能力 | 子代理由 Agent 在回合内通过 `delegate_task` 工具派生，客户端只能观察与干预 |
| 守卫 | ① 抛 `UnsupportedCapabilityError`，明确告知能力不存在；② `contract:verify` 扫描所有调用点，方法名不在契约中直接失败；③ 单测断言"禁止向不存在的方法发起 RPC" |

## P-007 响应形状假设错误（rename/disband 永远判失败）

| 项目 | 内容 |
|---|---|
| 症状 | 群聊改名、解散永远返回 false，界面无提示 |
| 根因 | 手写类型声明 `success: boolean`，真实契约是 `groups.rename -> { room }`、`groups.disband -> { tombstone }`，读到 `undefined` 即判失败 |
| 守卫 | ① 契约同步生成结果字段；② 单测按真实形状构造响应并断言成功判定；③ fixture 覆盖 `groups.list` 结构 |

## P-008 下行事件 payload 零校验（界面安静地空白）

| 项目 | 内容 |
|---|---|
| 症状 | 流式输出突然不再显示，控制台没有任何报错 |
| 根因 | 网关契约里 72 个事件的 payload 形状有明确定义，但 reducer 全靠猜字段名；网关改名（如 `text` → `delta`）后解析结果为空，被当成"本轮没有内容" |
| 识别特征 | 事件帧收到了，但 UI 无变化，且无异常 |
| 守卫 | ① `CONTRACT_EVENTS` 由契约自动生成；② `reduceGatewayEvent` 解析前校验 payload 字段白名单，偏差写 warn（同类型只报一次）；③ 单测断言"合法字段不告警 / 契约外字段必告警 / 不中断事件流" |

## P-009 会话双 ID 作用域混淆（resume 4007、title 4001）

| 项目 | 内容 |
|---|---|
| 症状 | `session.resume` 报 4007，`session.title` 报 4001，同一个 id 一会儿能用一会儿不能用 |
| 根因 | `session.create` 同时返回 live id（`8b2728f4`）与 stored id（`20261101_013507_5635da`）。`session.resume` 必须用 **stored id**；其余会话 RPC 用 resume 返回的 **live id** |
| 识别特征 | 两个 id 混用，错误码在 4001/4007 之间跳 |
| 守卫 | ① 探针 fixture 记录两种 id；② 单测断言 resume 返回双 id；③ `docs/gateway/sessions.md` 明确标注作用域 |

## P-010 活跃会话不可删除（4023）

| 项目 | 内容 |
|---|---|
| 症状 | 删除会话失败，提示 "cannot delete an active session" |
| 根因 | `session.delete` 拒绝当前实时通道持有的会话（4023）；另外无消息的会话不落库，删除时返回 4007 |
| 真实约束 | 先 `session.close` 再删除；或删除由 `stored id` 指向的、非活跃的会话 |
| 守卫 | ① 探针把 4023/4007 作为预期守卫记录；② 单测断言空会话删除只能走守卫分支；③ `docs/gateway/sessions.md` 标注前置条件 |

## P-011 网关 preview 仅为用户初始提问导致副标题闪烁，与切会话缺乏代际令牌导致副标题串扰

| 项目 | 内容 |
|---|---|
| 症状 | 会话副标题闪来闪去、变来变去（初次显示"你好"，点击后变成真实回复"哎呀，小仙女可不能挨饿！"，一刷新又退回"你好"）；点击另外一个会话时，其副标题也被错位篡改成前一会话的内容 |
| 根因 | 1. 网关 `GET /api/sessions` 返回的 `preview` 字段仅记录首句用户提问，刷新对账时冲刷覆盖了本地已由真实消息流修正的回复；<br>2. `fetchSessionMessages` 未传 `profile`，专职 Agent（xiaofawang）请求报 404；<br>3. `loadMessages` 缺乏 `generation` 竞态令牌，异步迟滞响应错位写入当前会话的 `state.messages` 与缓存 |
| 识别特征 | 列表初次渲染为用户第一句话，点击进入后短暂变对，定时刷新对账后打回原形；快速切会话时多个会话副标题完全一致 |
| 守卫 | ① `reconcileSessionList` 防倒退守卫（时间戳未推进时保留本地真实回复）；<br>② `sessionPreviewCache` 持久化真实副标题（localStorage）；<br>③ `fetchSessionMessages` 与 `fetchLastMessage` 显式携带 `profile`；<br>④ `activeLoadMessagesGeneration` 严格代际令牌阻断迟滞响应；<br>⑤ 单测 `packages/core/__tests__/session/sessionMerge.test.mjs` (用例 15)；<br>⑥ 真实网关 CDP 端到端测试 `packages/desktop/__tests__/e2e/session-subtitles-live-cdp.test.mjs` |

## P-012 前端临时 id 逃逸为网关截断锚点（回滚必报 4018）

| 项目 | 内容 |
|---|---|
| 症状 | 点回滚后原消息不消失，重发报 `[4018] target user message is no longer in session history` |
| 根因 | `parseRawMessages` 丢弃 `row_id`，回滚把前端自造的 `usr-${Date.now()}` 当 `truncate_before_message_id` 透传；渲染层手拼 truncate 字段 |
| 识别特征 | 网关只认持久 rowId，本地主键进 wire 必失败 |
| 守卫 | ① core `truncatePlan.ts` 唯一裁决 `planTruncate`，`isClientTempId` 拒临时 id；② `InteractiveService.truncateAndSubmit` 双锚互斥单点构造；③ `parseRawMessages` 写入持久 `rowId`；④ 形式化定理 8/9；⑤ 静态门禁拦 renderer 出现 `truncate_before_` |
| 真实契约 | `truncate_before_row_id`（首选）/`truncate_before_message_id`（服务端签发串）二选一 + `confirm_truncate` |

## P-013 流式期间结构短路，工具链整轮后才瞬间刷出

| 项目 | 内容 |
|---|---|
| 症状 | Agent 输出时工具执行链不实时更新，整轮结束后一次性蹦出来 |
| 根因 | `render()` 的 `inOngoingStreamingTurn`（isStreaming 且消息条数不变）使 `messagesChanged` 恒 false；工具事件只改消息内部字段不改条数；工具胶囊无独立增量 DOM 通道 |
| 识别特征 | 正文流式正常（走 `#msg-content-*` 直写），工具胶囊却卡住 |
| 守卫 | ① `MiddlePod` 常驻 `#msg-tools-<id>` 锚点 + 导出 `renderToolCapsuleSlot`；② `toolPatchQueue` 单 RAF 去重直写、容器缺失置 `canvasStructureDirty` 兜底；③ reducer 权威读 `tool_id`（原读 `payload.id` 恒空）；④ 形式化定理 10 |
| 残留风险 | server-priority 消费为"读取即删除"，同会话"截断前已发出、截断后返回"的在途慢响应理论上可提前消费标记（概率极低，未加时序戳）；三处消费接线由 `interactive-stage-wiring-guard.test.mjs` 源码守卫锁定，删除调用行必爆红 |

## P-014 双 id 作用域误用于 branch，且提示不上屏致 Fork"点了没反应"

| 项目 | 内容 |
|---|---|
| 症状 | Fork 按钮点击无任何反应 |
| 根因 | `session.branch` 只接受 live id，代码传 rail 的 stored id → 网关 4001；且 `setTimedDockNotice` 只写 `state.dockNotice` 不 `render()`，失败提示永不现形 |
| 识别特征 | 静默失败：既没切会话也没报错 |
| 守卫 | ① Fork 先 `ensureLiveSessionId()`；② `idempotency_key` 防重试派生双会话；③ `setTimedDockNotice` 现显式 `render()`；④ 单测断言 branch 携幂等键 |

## P-015 @Agent 被当普通文本上行，模型答复"无法调用"

| 项目 | 内容 |
|---|---|
| 症状 | 输入 `@架构王 帮我看看`，模型回复无法调用该 Agent |
| 根因 | `sendMessage` 把含 `@` 的原文直接 `prompt.submit`，从未调用 core `resolveMentionRoute`/`planSendRoute`；且 `parseAgentMention` 旧实现只认行首 `^@`，句中提及静默失效 |
| 识别特征 | 模型收到自然语言里的 `@`，当成对话内容而非调度指令 |
| 守卫 | ① core `planSendRoute` 三态分流（`prompt.background`/`prompt.btw`/`groups.send`）；② `parseAgentMention` 任意位置命中已知 profile；③ 形式化定理 11 断言 cleanText 剥离 `@token`、无命中必 plain |

## P-016 斜杠/文件检索硬编码假数据（命令不全、文件只有两条）

| 项目 | 内容 |
|---|---|
| 症状 | `/` 只有 5 条固定命令；`@` 文件永远只有 README.md 与 docs/architecture.md，不能按关键词检索 |
| 根因 | 输入监听器硬编码命令数组与两个文件对象；`commands.catalog`/`complete.slash`/`complete.path`/`slash.exec` 全未接线；且 `projects.tree` 实际不返回文件（只项目/仓库/会话节点） |
| 识别特征 | "看起来能用、实际是假数据"；离线也能渲染出条目 |
| 守卫 | ① 删除硬编码；② 连接后 `prefetchSlashCatalog`（commands.catalog）快照 + `complete.slash` 实时补全（序列号守卫防迟到覆盖）；③ `@` 文件走 `complete.path`；④ `slash.exec` 按 DispatchType（exec/plugin→output，alias→target，send/prefill/skill→message）分派 |

## P-017 Popper 开合进 dock 快照，每次按键重建 textarea 丢光标与 IME

| 项目 | 内容 |
|---|---|
| 症状 | 连续输入 `/` 或 `@` 补全时输入法组字被打断、光标跳飞 |
| 根因 | `hasDockSnapshotChanged` 计入 `slashPopperOpen/mentionPopperOpen`，开合即整体替换 `.input-dock-container` outerHTML，textarea 连根重建 |
| 识别特征 | 高频 UI 状态触发了容器级 DOM 重建 |
| 守卫 | ① 四个 popper 字段移出 dock 快照；② 固定 `#composer-popper-mount` 占位，`syncComposerPoppers()` 只写该子树；③ 键盘时序军规 |

## P-018 静态存在≠运行时生效（皮肤三源漂移 + 同行 %ERRORLEVEL% 假绿）

| 项目 | 内容 |
|---|---|
| 症状 | registry 有 29 槽与 applySkinToDom 注入函数，但改值不生效、改肤无响应；审计一度误把 registry 当运行时真值；typecheck 曾被验证命令谎报为绿 |
| 根因 | `applySkinToDom`/`BUILTIN_SKINS` 生产调用点为 0（仅单测消费），运行时皮肤唯一生效源是 styles.css 手写 `[data-theme]` 块，tokens.ts THEME_* 为僵尸表；验证侧 cmd 同行 `& echo %ERRORLEVEL%` 在解析期展开，打印的是上一条命令的退出码 |
| 识别特征 | "存在定义+存在消费文件"≠"存在调用链"；带 `&` 拼接的 cmd 验证输出与日志内容矛盾 |
| 守卫 | ① `skins-sot.test.mjs`：标记区外零皮肤槽定义 + git HEAD 双向对账（sources 来源符号精确等值）+ 幂等 check；② 验证一律 `&&` 短路/日志尾部双证，禁同行 ERRORLEVEL；③ emit-skins `--check` 逐字节再生成 |
| 复现命令 | `node --test packages/ui/__tests__/skins-sot.test.mjs`；`cmd /c "node x.js && echo OK"`（对照 `& echo %ERRORLEVEL%` 的行为差异） |

## P-019 styles.css 整体不在门禁扫描面（色值盲区）

| 项目 | 内容 |
|---|---|
| 症状 | 往 styles.css 写任意裸 hex，`npm run gates` 恒报 0 新增 |
| 根因 | `listSourceFiles` 扩展名白名单只有 .ts/.tsx/.js/.mjs，CSS 文件历史上从未进入扫描面；基线"清欠 100 条"的真实构成是组件改名清偿+过期指纹清理，与 CSS 无关 |
| 识别特征 | 门禁 scannedFiles 数字里找不到 css 文件 |
| 守卫 | ① 皮肤块由 `skins-sot` 字节级 check 兜底（当前唯一防线）；② 波③给 styles.css 新增组件级色值规则前，必须先把 css 接入扫描面或以守卫测试逐条兜底（tech-design §5 波③准入项） |
| 复现命令 | `node scripts/gates/run.mjs --json` 观察 scannedFiles 集合 |

---

## 守卫总览

| 守卫 | 命令 | 拦住的坑 |
|---|---|---|
| 失败不可静默 | `npm run gates` | P-001、P-003、P-005 |
| 契约一致性（静态） | `npm run contract:verify` | P-001、P-002、P-006、P-007 |
| 探针覆盖率 | `npm run contract:coverage` | 任何"写了调用但没验证过"的方法 |
| 接口文档同步 | `npm run contract:doc:check` | 文档与契约/探针漂移 |
| 运行时请求守卫 | 内置于 `HermesGatewayClient.call` | P-001、P-002、P-006 |
| 事件契约守卫 | 内置于 `reduceGatewayEvent` | P-008 |
| 真实网关探针 | `npm run probe:gateway` | P-001、P-002、P-005、P-009、P-010 |
| fixture 回归 | `npm test` | P-003、P-007、P-009 |
| 去重对账 | `npm test` + debug 日志 | P-004 |
| 会话副标题防闪烁守卫 | `npm test` + CDP live E2E | P-011 |
| 回滚截断锚点守卫 | `npm run verify:formal`（定理 8/9） | P-012 |
| 流式工具状态机守卫 | `npm run verify:formal`（定理 10） | P-013 |
| 双 id 作用域守卫（branch） | `npm test` + `idempotency_key` 断言 | P-014 |
| @Agent 路由守卫 | `npm run verify:formal`（定理 11） | P-015 |
| 斜杠/文件真实契约守卫 | `npm run contract:coverage` + CDP | P-016 |
| Popper DOM 稳定性守卫 | CDP 场景 + 快照字段约束 | P-017 |
| 皮肤单一真值守卫 | `npm test`（skins-sot 10 用例 + emit check） | P-018 |
| CSS 扫描盲区兜底 | `npm test`（skins-sot 幂等/对账）+ 波③接扫描面 | P-019 |
