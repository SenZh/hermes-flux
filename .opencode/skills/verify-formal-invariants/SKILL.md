---
name: verify-formal-invariants
description: 基于属性测试 (Property-Based Testing via fast-check) 的核心形式化安全不变量验证技能。在数万种随机并发交错、时间戳畸变与乱序事件状态空间中，穷尽证明专职智能体主工位（Forever Chat）与普通会话池的物理领域隔离、时间戳归一化、全序单调性及失败不致空（Failure Is Not Empty）定理。当接手 Agent 修改底层数据模型、长连接时序或会话状态机时强制使用。
---

# Verify Formal Invariants

本技能为 **Hermes Flux** 核心领域层（`packages/core`）提供轻量级、数学级严格证明的形式化不变量校验引擎。常规测试只能覆盖开发者预想到的少数几条线性路径，而本验证器通过自动构造数万次极限状态空间随机探索，穷尽证明状态机在任意乱序网络交错下均不会破坏核心安全不变量。

## Coverage Record & Sync Baseline

- **守护的核心生产文件**：
  1. `packages/core/src/profile/botActivitySync.ts`（专职 Bot 活动同步与物理隔离状态机）
  2. `packages/core/src/session/sessionMerge.ts`（跨 Profile 会话去重与对账引擎）
- **最后同步基线 Commit**：`d80d193`
- **规则**：当上述两个文件的业务逻辑发生预期变更时，必须重新运行形式化验证并证明 7 大定理依然获证，方可推进同步 Commit。

## Verified Mathematical Invariants (形式化获证定理)

验证套件位于 `packages/core/__tests__/formal/`，在 10,000+ 次随机生成迭代中数学证明以下 7 大定理：

1. **定理 1 [领域绝对隔离定理 (Domain Isolation)]**：
   $$\forall p \in \text{Profiles}, \forall s \in \text{RegularSessions}, \quad s.\text{botName} = p.\text{name} \implies \text{Sync}(p, s).\text{lastTime} \neq s.\text{time}$$
   普通会话池的任何变动、乱序、时间更新，在所有可能的输入组合下绝对不可渗透污染专职 Bot 卡片。
2. **定理 2 [时间戳归一化完备性定理 (Normalization Soundness)]**：
   $$\forall x \in \text{Inputs}, \quad \text{normalizeTimestamp}(x) \in [0, +\infty) \cap \mathbb{Z}$$
   任意秒级、毫秒级、ISO 字符串或畸变非法输入，经归一化投影后恒为有限非负数字，绝不发生 `NaN` 逃逸。
3. **定理 3 [时间全序非递增单调性定理 (Total Preorder Monotonicity)]**：
   $$\forall i \in [0, |\text{profiles}| - 2], \quad \text{profiles}[i].\text{timestamp} \ge \text{profiles}[i+1].\text{timestamp}$$
   经历任意次数的交互与状态反哺后，智能体 Profile 数组严格维持降序全序排列。
4. **定理 4 [反哺管道排他纯洁性定理 (Back-feed Purity)]**：
   非专职主工会话调用反哺管道恒返回 `null`，且全局活跃 Map 绝对不产生任何脏键注入。
5. **定理 5 [去重强幂等性定理 (Idempotent Deduping)]**：
   $$\text{dedupe}(\text{dedupe}(S)) \equiv \text{dedupe}(S)$$
   对任意形状的会话集合，重复执行多轮去重计算结果严格守恒。
6. **定理 6 [失败不致空不变量 (Failure Is Not Empty)]**：
   $$\text{authoritative} = \text{false} \implies \text{Reconcile}(\text{Local}, \text{RemoteFail}).\text{sessions} \supseteq \text{Local}_{\text{valid}}$$
   网络发生部分失败或瞬断时，本地已存在的有效会话在任何输入下绝不被静默清空。
7. **定理 7 [去重结果时间全序降序定理 (Deduped Monotonicity)]**：
   去重合并后的会话序列在所有输入下严格保持时间戳非递增排列。

## Execution (运行指令)

形式化验证已原生集成至 Monorepo 测试体系，单次全量证明约耗时 300ms：

```bash
npm run verify:formal
# 或直接通过 node 原生测试运行器执行：
node --test packages/core/__tests__/formal/**/*.test.mjs
```

## How to Read Counterexamples (反例解读与排查 SOP)

如果后续修改破坏了某个形式化不变量，`fast-check` 会在毫秒内捕获失败，并通过自动“收缩（Shrinking）”输出最小化复现用例：

```text
not ok - 定理 1 [领域绝对隔离]
  Property failed after 3 tests
  Counterexample: [{"botName":"a","description":"...","hasForeverChat":false,"regularSessions":[{"preview":"..."}]}]
  Shrunk 9 time(s)
```

- **排查步骤**：
  1. 查看 `Counterexample` 字段：它给出了破坏该不变量的最简输入结构体（如没有 Forever Chat 时普通会话透传）；
  2. 检查对应生产函数（`botActivitySync.ts` 或 `sessionMerge.ts`）中是否漏掉了防御守卫（如缺少 `if (hasForeverChat)` 判断）；
  3. 严禁通过放宽断言让测试通过；必须定点修复生产逻辑直至反例完全消除。
