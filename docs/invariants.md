# 不变量映射表（Invariant Map）

> **本文件由 `scripts/verify/invariant-map.mjs --render` 生成，禁止手工修改。**
> 单一真值源是 [`invariants.json`](invariants.json)；改内容请改 JSON 再重新生成。
> 设计说明见 [`testing-strategy.md`](testing-strategy.md) 第五章。

## 为什么用 JSON 而不是手写表格

旧版 Markdown 表格有三个结构性缺陷，导致它无法被机器校验：

1. **编号撞号**：两个不同文件都自称「定理 30~34」，同号异义让任何比对失效；
2. **区间写法**：`INV-12~16` 在文本上是一个 token，做不了差集；
3. **7 处「同上」**：多条不变量共用一个路径，无法判断某一条是否真被守护。

JSON 版本强制每条给出唯一 `id`、被测源码 `source`、`symbol` 与单一 `test` 路径，
于是「新增逻辑 − 已登记项」这个差集才在数学上可计算。

## 校验规则

| 规则 | 判定 |
|---|---|
| id 唯一且匹配 `INV-<AREA>-<NN>` | 违者 FAIL |
| `test` 为单一真实路径 | 违者 FAIL |
| `test` 文件内含 `fc.assert` | 违者 FAIL |
| `source` 为真实源码路径 | 违者 FAIL |
| `source`+`symbol` 组合唯一 | 违者 FAIL |

## 总览（35 条，覆盖 8 个领域）

### ATTACH（5 条）

| 编号 | 主题 | 源码锚点 | 守护测试 | 失效模式 |
|---|---|---|---|---|
| `INV-ATTACH-01` | 迟滞响应不串台（令牌不匹配的 settle 不改变字段） | `packages/core/src/models/providerAttachFlow.ts` → `settleAttach` | `provider-attach-flow-formal.test.mjs` | 旧的确认结果写到新目标行上 |
| `INV-ATTACH-02` | 提交中意图不可变 | `packages/core/src/models/providerAttachFlow.ts` → `beginAttach` | `provider-attach-flow-formal.test.mjs` | 提交过程中意图被改写，最终绑定了错误的 Agent |
| `INV-ATTACH-03` | 失败不丢用户输入 | `packages/core/src/models/providerAttachFlow.ts` → `failAttach` | `provider-attach-flow-formal.test.mjs` | 失败后密钥草稿被清空，用户要重新输入 |
| `INV-ATTACH-04` | 取消恒生效且 busy 只由 submitting 决定 | `packages/core/src/models/providerAttachFlow.ts` → `cancelAttach` | `provider-attach-flow-formal.test.mjs` | 取消失效；或不该忙的时候锁死界面 |
| `INV-ATTACH-05` | 目录收敛只挂仍为 absent 的同一格子 | `packages/core/src/models/providerAttachFlow.ts` → `reconcileAttach` | `provider-attach-flow-formal.test.mjs` | 用户刚打开的确认条瞬间消失 |

### BOT（3 条）

| 编号 | 主题 | 源码锚点 | 守护测试 | 失效模式 |
|---|---|---|---|---|
| `INV-BOT-01` | 领域绝对隔离（普通会话不得污染 Bot 卡片） | `packages/core/src/agent/agentPresence.ts` → `syncActiveSessionToBot` | `bot-activity-formal.test.mjs` | 普通会话的活动覆盖专职 Bot 主工位卡片 |
| `INV-BOT-02` | 时间戳归一化完备性 | `packages/core/src/agent/agentPresence.ts` → `normalizeTimestamp` | `bot-activity-formal.test.mjs` | 秒级/毫秒级/ISO 混用导致排序错乱 |
| `INV-BOT-03` | 时间全序非递增单调性 | `packages/core/src/agent/agentPresence.ts` → `applyBotActivity` | `bot-activity-formal.test.mjs` | Bot 列表顺序抖动 |

### CACHE（8 条）

| 编号 | 主题 | 源码锚点 | 守护测试 | 失效模式 |
|---|---|---|---|---|
| `INV-CACHE-01` | 围栏不误删 | `packages/core/src/cache/cacheMerge.ts` → `mergeRemoteWindow#fence` | `cache-fence-formal.test.mjs` | 拉取在途写入被远端快照误删，用户刚发的消息消失 |
| `INV-CACHE-02` | 上限不越界 | `packages/core/src/cache/cacheMerge.ts` → `evictToCap` | `cache-fence-formal.test.mjs` | 通道行数超过 messageCap，内存无界增长 |
| `INV-CACHE-03` | 截断有界 | `packages/core/src/cache/cacheMerge.ts` → `applyTruncation` | `cache-fence-formal.test.mjs` | 截断后残留 orderKey > target 的幽灵行 |
| `INV-CACHE-04` | 窗口合并幂等 | `packages/core/src/cache/cacheMerge.ts` → `mergeRemoteWindow#idempotent` | `cache-fence-formal.test.mjs` | 重复应用同一远端快照产生重复行 |
| `INV-CACHE-05` | pending 不可删 | `packages/core/src/cache/cacheMerge.ts` → `mergeRemoteWindow#pending-survives` | `cache-fence-formal.test.mjs` | 未确认的消息在窗口合并中被清掉 |
| `INV-CACHE-06` | 在途展示序不撞号且强保序 | `packages/core/src/cache/cacheMerge.ts` → `mergeRemoteWindow#displaySeq` | `cache-fence-formal.test.mjs` | 拉取在途期间生成的 displaySeq 与远端冲突，界面错序 |
| `INV-CACHE-07` | appendRows 同键展示序不漂移 | `packages/core/src/cache/cacheMerge.ts` → `appendRows` | `cache-fence-formal.test.mjs` | 重复追加同一批消息时 displaySeq 重新计算，行跳动 |
| `INV-CACHE-08` | 更早分片展示序精确切片 | `packages/core/src/cache/cacheMerge.ts` → `sortByDisplayAsc` | `cache-fence-formal.test.mjs` | 按 orderKey 翻页取 displaySeq 不连续，历史消息顺序错乱 |

### PAGE（2 条）

| 编号 | 主题 | 源码锚点 | 守护测试 | 失效模式 |
|---|---|---|---|---|
| `INV-PAGE-01` | 分页游标单调不减且不越界 | `packages/core/src/session/olderBatchMerge.ts` → `planOlderPagination` | `older-pagination-formal.test.mjs` | 翻页重复加载或跳过消息 |
| `INV-PAGE-02` | 父段不丢失且二次合并强幂等 | `packages/core/src/session/olderBatchMerge.ts` → `planOlderBatchPrependMergeDetailed` | `older-pagination-formal.test.mjs` | 向上翻页后父会话血缘行丢失；重复合并产生重复键 |

### RAIL（5 条）

| 编号 | 主题 | 源码锚点 | 守护测试 | 失效模式 |
|---|---|---|---|---|
| `INV-RAIL-01` | 三权分立互斥（Bot/Group/Session 正交隔离） | `packages/ui/src/components-react/leftRailModel.ts` → `buildLeftRailModel#orthogonal` | `unified-session-list-formal.test.mjs` | 左轨同时出现同一会话的两种身份 |
| `INV-RAIL-02` | 普通会话时间全序降序单调 | `packages/ui/src/components-react/leftRailModel.ts` → `buildLeftRailModel#ordering` | `unified-session-list-formal.test.mjs` | 左轨时间倒序错乱 |
| `INV-RAIL-03` | 墓碑强制驱逐不可侵犯 | `packages/ui/src/components-react/leftRailModel.ts` → `buildLeftRailModel#tombstone` | `unified-session-list-formal.test.mjs` | 已归档项复活 |
| `INV-RAIL-04` | 多源编排强幂等 | `packages/ui/src/components-react/leftRailModel.ts` → `buildLeftRailModel#idempotent` | `unified-session-list-formal.test.mjs` | 二次编排输出不恒等，界面每次刷新都变化 |
| `INV-RAIL-05` | 全失败防御不可致空 | `packages/ui/src/components-react/leftRailModel.ts` → `buildLeftRailModel#failure-not-empty` | `unified-session-list-formal.test.mjs` | 网络失败时本地已有会话被抹除 |

### SESSION（6 条）

| 编号 | 主题 | 源码锚点 | 守护测试 | 失效模式 |
|---|---|---|---|---|
| `INV-SESSION-01` | 会话/代际变更必须丢弃写入 | `packages/core/src/session/guardedRun.ts` → `runGuarded` | `run-guard-formal.test.mjs` | 切换会话后旧写入污染新会话内容 |
| `INV-SESSION-02` | 反复删除收敛且失败保留已成功剪枝 | `packages/core/src/session/SessionLifecycleService.ts` → `deleteSessions` | `session-lifecycle-formal.test.mjs` | 重复删除产生不同结果；部分失败时已成功的清理被回滚 |
| `INV-SESSION-03` | 陈旧全量快照不得复活已删会话 | `packages/core/src/session/SessionLifecycleService.ts` → `deleteSessions#tombstone` | `session-lifecycle-formal.test.mjs` | 慢响应返回的旧快照把已删会话挂回界面（防复活墓碑失效） |
| `INV-SESSION-04` | 跨 Profile 去重强幂等 | `packages/core/src/session/sessionMerge.ts` → `dedupeSessions#idempotent` | `session-merge-formal.test.mjs` | 合并产生重复消息 |
| `INV-SESSION-05` | 失败不可致空（Failure Is Not Empty） | `packages/core/src/session/sessionMerge.ts` → `mergeSessions` | `session-merge-formal.test.mjs` | 网络失败时清空界面，用户看到空列表而不是旧数据 |
| `INV-SESSION-06` | 去重结果时间全序降序单调 | `packages/core/src/session/sessionMerge.ts` → `dedupeSessions#ordering` | `session-merge-formal.test.mjs` | 会话列表时间倒序错乱 |

### STAGE（4 条）

| 编号 | 主题 | 源码锚点 | 守护测试 | 失效模式 |
|---|---|---|---|---|
| `INV-STAGE-01` | 回滚乐观截断往返恒等 | `packages/desktop/src/renderer/rollbackTransaction.ts` → `applyOptimisticCut` | `interactive-stage-formal.test.mjs` | 截断后内容错乱，回滚无法还原原状 |
| `INV-STAGE-02` | 截断锚点排他性与临时 id 零逃逸 | `packages/desktop/src/renderer/rollbackTransaction.ts` → `resolveRollbackTarget` | `interactive-stage-formal.test.mjs` | 回滚锚点错位；客户端临时 id 泄漏到服务端触发 4018 |
| `INV-STAGE-03` | 流式工具状态机收敛 | `packages/core/src/session/eventReducer.ts` → `reduceEvent` | `interactive-stage-formal.test.mjs` | 工具卡状态不收敛，幽灵工具残留 |
| `INV-STAGE-04` | @ 路由排他性与 cleanText 不残留 token | `packages/desktop/src/renderer/mentionToken.ts` → `parseMentionToken` | `interactive-stage-formal.test.mjs` | 通道类型错配；正文里残留 @token 原文 |

### TIME（2 条）

| 编号 | 主题 | 源码锚点 | 守护测试 | 失效模式 |
|---|---|---|---|---|
| `INV-TIME-01` | 时间格式化确定性 | `packages/ui/src/components-react/leftRailModel.ts` → `formatLeftRailTime#deterministic` | `rail-time-format-formal.test.mjs` | 同一时间戳重复渲染出不同文案，界面抖动 |
| `INV-TIME-02` | 时间分桶单调且非法输入安全降级 | `packages/ui/src/components-react/leftRailModel.ts` → `formatLeftRailTime#buckets` | `rail-time-format-formal.test.mjs` | 未来时刻落入昨前桶；非法时间戳抛错或复活旧值 |

## 尚未覆盖的领域（刻意登记为空）

以下领域当前没有任何形式化不变量。新增这些领域的可判定逻辑时应先补映射，
否则它属于「没有被任何性质守护的新逻辑」：

- `core/src/queue/`（写入队列）
- `core/src/group/`（群聊研讨室）
- `core/src/subagent/`（子代理运行时）

