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
