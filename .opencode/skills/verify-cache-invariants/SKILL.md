---
name: verify-cache-invariants
description: 客户端缓存子系统的形式化安全不变量验证。当修改 `packages/core/src/cache/` 下的合并、围栏、截断或淘汰逻辑，或调整消息缓存上限与权威门语义时必须使用。在随机操作交错中证明五条定理：拉取在途写入不被误删、行数不超上限、截断有界、窗口合并幂等、pending 行不可删。触发词：缓存不变量、cache fence、消息缓存、围栏、截断重绑定、缓存上限、verify-cache。
---

# Verify Cache Invariants

缓存最容易出错的不是"存"，而是"拉回来的和本地已有的怎么合"。这类错误单测很难覆盖——它只在一个很窄的交错里出现（拉取在途时写入），却会让用户的消息凭空消失。

本技能用 `fast-check` 在随机操作序列下验证缓存子系统，跑的是编译后的真实代码（`packages/core/dist/index.js`），不是手写模型。

## Tool Selection & Philosophy (工具选型与理由)

- **选型**：`fast-check`（TypeScript 原生属性测试，带自动反例收缩）。

- **为什么不是 TLA+**：这套性质确实是时序问题，TLA+ 是常规选择。但这个项目已经有 fast-check 基础设施（`packages/core/__tests__/formal/` 下已跑 27 条定理），且手写 TLA+ 模型只能证明"模型是对的"，证不了"代码是对的"。用生成器直接驱动真实函数，反例可以直接在代码里复现。

- **为什么不是普通单测**：`mergeRemoteWindow` 的围栏条件由三个布尔项共同决定（`> remoteMax`、`<= fenceMax`、`not pending`）。手工写用例很难覆盖三者交叉的边界，而随机序列几百次就能撞出来。

## Coverage Record & Sync Baseline (覆盖记录与基线)

- **守护的生产文件**：
  1. `packages/core/src/cache/cacheMerge.ts`（upsert 择优、围栏合并、截断重绑定、淘汰）
  2. `packages/core/src/cache/CacheService.ts`（通道串行锁、索引信封、上限裁剪、applyRemoteWindow / truncate 编排）
  3. `packages/core/src/cache/MemoryCacheStore.ts`（存储行为基准）
  4. `packages/core/src/cache/ICacheStore.ts`（接口语义 + `buildChannelBounds` 主键区间计算）
  5. `packages/desktop/src/renderer/cache/DesktopCacheStore.ts`（IndexedDB / localStorage 适配器，语义须与内存实现一致）

- **测试文件**：
  - `packages/core/__tests__/formal/cache-fence-formal.test.mjs`（5 条形式化定理）
  - `packages/core/__tests__/cache/cache-merge.test.mjs`（合并纯函数，15 条）
  - `packages/core/__tests__/cache/cache-service.test.mjs`（服务编排与并发，17 条）
  - `packages/core/__tests__/cache/cache-bounds.test.mjs`（主键区间边界，10 条）
  - `packages/core/__tests__/cache/cache-edge-cases.test.mjs`（信封/守卫/空输入/跨通道隔离，20 条）

- **最后确认基线 Commit**：`c4f13e5`（`cache/` 子系统为本轮新增，尚未提交；提交后把这里推进到该提交）

- **推进规则**：上述任一文件的行为发生变更后，必须重跑本技能并确认 5 条定理仍然获证，才可以把基线 Commit 往后推。只改注释或类型不算变更，但要确认 `npm run build:core` 产出的 `dist` 与源码一致。

## Verified Invariants (5 条定理)

验证套件：`packages/core/__tests__/formal/cache-fence-formal.test.mjs`。

### 定理 22 [围栏不误删]
调用前已存在、且 `orderKey > fenceMax` 的行，在 `applyRemoteWindow` 之后必须仍然存在。

**它防的事故**：拉取在途时用户发了一条消息，响应回来带的旧 `max(rowId)` 把这条新消息判为"服务端没有的幽灵"删掉。用户刚发的话消失。

**怎么在代码里认它**：`mergeRemoteWindow` 的 `isWithinFence` 判断（`row.orderKey <= fenceMax`）。删掉它这条定理立刻失败，其余四条仍然通过——这个隔离性就是它有效的证据。

### 定理 23 [上限不变量]
任意 append / 拉取 / 截断序列之后，单通道行数不超过 `messageCap`。

**它防的事故**：淘汰只按时间戳排序，同秒多行时无法定序，导致超限堆积或删错行。

### 定理 24 [截断有界]
无 survivor 映射时，截断后所有行的 `orderKey <= target`。

**它防的事故**：截断只删了内存、没删磁盘，重启后幽灵消息整段复活。

### 定理 25 [窗口合并幂等]
相同的 `(remote, fenceMax)` 连续应用两次，第二次不再改变行集合、也不再剔除任何行。

**它防的事故**：重复拉取（多端信号、重连、去抖失效）导致行集合持续漂移或反复触发写盘。

### 定理 26 [pending 不可删]
`pendingKeys` 中的行，在窗口合并后必须仍然存在。

**它防的事故**：本端刚提交、还没被网关确认的消息，被一次并发回拉当成幽灵删掉；用户以为发出去了，实际本地和服务端都没有。

## How to Run

```bash
npm run build:core
node --test packages/core/__tests__/formal/cache-fence-formal.test.mjs
```

单次约 0.3 秒。`numRuns` 每条定理 150~200，需要更深搜索时在用例里临时调大，不要写死成大数拖慢日常门禁。

全量形式化回归（含既有 27 条定理）：

```bash
npm run verify:formal
```

## Telling a Real Bug from a Modeling Error

反例输出会直接给出导致失败的输入结构。按下面三条判：

1. **反例里的行都在同一通道、`orderKey` 合法（正整数）** → 大概率是真 bug，去看围栏或淘汰的边界比较。
2. **反例里出现重复主键或 `orderKey = 0`** → 先怀疑生成器写错了，不是代码问题。本套件的生成器约束 `orderKey ∈ [1, 80]`，且写入前都做了 `dedupe`。
3. **只有定理 23 失败、其余都过** → 去看 `trimChannel` 与 `evictToCap` 的上限口径是否一致（一个是存储层裁、一个是纯函数裁）。

**严禁**为了让测试变绿去放宽生成器范围或删掉断言。反例是证据，不是障碍。如果确实需要收窄，先在技能里补一条"范围与假设"，说明为什么这个输入不在覆盖范围内。

## Prove the Check Still Bites (证明验证有效)

改完围栏或淘汰逻辑后，按这个方式确认测试没有退化成空断言：

1. 把 `packages/core/src/cache/cacheMerge.ts` 里 `isWithinFence` 临时改成 `true`；
2. `npm run build:core && node --test packages/core/__tests__/formal/cache-fence-formal.test.mjs`；
3. 必须看到 **定理 22 失败、其余四条通过**；
4. 改回去，重新 build，确认 5/5 通过。

只有定理 22 单独失败才说明这条断言是精准的。如果五条一起红，说明你对代码的改动影响面比预期大，要先查清楚再继续。

## Scope & Limits (验证到什么程度)

**覆盖**：内存状态机（合并、围栏、截断、淘汰、并发串行）在随机操作序列下的行为。

**不覆盖**：

- IndexedDB 的事务原子性与游标边界（`DesktopCacheStore` 只做了类型检查，没有跑真实浏览器）；
- 多端并发写同一会话；
- 真实网络时序与部分失败（`authoritative` 的判断在调用方）；
- 单条消息超长截断（512KB 规则）；
- 消息体迁移与旧键兼容。

这些要等 `verify-hermes-flux` 的 CDP 物理验证覆盖，不要用本技能的结果去宣称"缓存整体正确"。
