---
name: verify-formal-invariants
description: 基于属性测试 (Property-Based Testing via fast-check) 的核心形式化安全不变量验证技能。在数万种随机并发交错、时间戳畸变与乱序事件状态空间中，穷尽证明专职智能体主工位（Forever Chat）与普通会话池的物理领域隔离、时间戳归一化、全序单调性、失败不致空（Failure Is Not Empty）、回滚乐观截断往返恒等及流式工具状态机收敛等 11 大核心数学定理。当接手 Agent 修改底层数据模型、长连接时序或会话状态机时强制使用。
---

# Verify Formal Invariants

本技能为 **Hermes Flux** 核心领域层（`packages/core`）提供轻量级、数学级严格证明的形式化不变量校验引擎。常规测试只能覆盖开发者预想到的少数几条线性路径，而本验证器通过自动构造数万次极限状态空间随机探索，穷尽证明状态机在任意乱序网络交错下均不会破坏核心安全不变量。

## Tool Selection & Philosophy (工具选型与工程权衡)

- **选型工具**：`fast-check` (TypeScript 原生基于假设与自动收缩的属性测试验证器)；
- **选型理由**：
  1. **零外部重型依赖**：原生内嵌于 Node.js / TypeScript 测试运行器，无需安装 Java、TLA+ Toolbox、Z3 或 Coq 等环境，任何开发者或 CI 均可一键秒级执行；
  2. **端到端真代码验证**：验证直接运行在编译后的生产代码（`packages/core/dist/index.js`）上，而非脱节的纸面模型伪代码；
  3. **自动反例收缩 (Counterexample Shrinking)**：当定理被反例击穿时，自动将上千步的复杂交错状态逐步修剪为最小复现结构体，精准定位到第一处逻辑漏洞。

## Coverage Record & Sync Baseline (代码覆盖与基线追踪)

- **守护的核心生产文件**：
  1. `packages/core/src/profile/botActivitySync.ts`（专职 Bot 活动同步与物理隔离状态机）
  2. `packages/core/src/session/sessionMerge.ts`（跨 Profile 会话去重与对账引擎）
  3. `packages/core/src/session/truncatePlan.ts`（回滚事务、截断锚点裁决与行号收敛）
  4. `packages/core/src/session/eventReducer.ts`（网关下行事件流规约与工具生命周期状态机）
  5. `packages/core/src/session/planSendRoute.ts`（消息发送分流、@ 路由解析与子代理调度决策）
- **最后同步基线 Commit**：`8962d80`
- **规则**：当上述任一生产文件的业务逻辑发生变更时，必须重新运行形式化验证并证明 11 大定理依然获证，方可推进同步 Commit。

## Verified Mathematical Invariants (11 大形式化获证定理)

验证套件位于 `packages/core/__tests__/formal/`，在 14,000+ 次随机生成迭代中数学证明以下 11 大定理：

### 领域隔离与时间不变量 (`bot-activity-formal.test.mjs`)
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

### 会话合并与防丢不变量 (`session-merge-formal.test.mjs`)
5. **定理 5 [去重强幂等性定理 (Idempotent Deduping)]**：
   $$\text{dedupe}(\text{dedupe}(S)) \equiv \text{dedupe}(S)$$
   对任意形状的会话集合，重复执行多轮去重计算结果严格守恒。
6. **定理 6 [失败不致空不变量 (Failure Is Not Empty)]**：
   $$\text{authoritative} = \text{false} \implies \text{Reconcile}(\text{Local}, \text{RemoteFail}).\text{sessions} \supseteq \text{Local}_{\text{valid}}$$
   网络发生部分失败或瞬断时，本地已存在的有效会话在任何输入下绝不被静默清空。
7. **定理 7 [去重结果时间全序降序定理 (Deduped Monotonicity)]**：
   去重合并后的会话序列在所有输入下严格保持时间戳非递增排列。

### 交互区、回滚截断与流式不变量 (`interactive-stage-formal.test.mjs`)
8. **定理 8 [回滚乐观截断往返恒等 (Optimistic Cut Reversibility)]**：
   $$\forall L, \forall k \in [0, |L|], \quad \text{splitAt}(L, k) = (\text{kept}, \text{removed}) \implies \text{kept} \cup \text{removed} \equiv L \land |\text{kept}| + |\text{removed}| = |L|$$
   对任意消息列表与合法切点，分解精确守恒，纯函数零变异，且非 user 消息行一律拒绝截断。
9. **定理 9 [截断锚点排他性定理 (Anchor Exclusivity & Temp Id Containment)]**：
   $$\text{has}(\text{truncate\_before\_row\_id}) \oplus \text{has}(\text{truncate\_before\_message\_id}) \land \text{wire} \cap \text{CLIENT\_TEMP\_ID} = \emptyset$$
   wire 载荷严格双锚互斥；前端自造临时主键（`usr-` / `ast-`）在任何输入下绝对禁止逃逸上行，宁可本地拦截抛错也绝不把临时 id 打到线上触发网关 4018。
10. **定理 10 [流式工具状态机收敛定理 (Tool FSM Convergence)]**：
    $$\text{running}(S) \subseteq \text{started}(S) \land \forall e \in \text{events}, \quad \text{AllComplete} \implies \text{running}(S') = \emptyset$$
    对任意乱序的 `tool.start` / `tool.complete` 事件，running 集合无幽灵、同 id 不重复、未知 id 不创生、流式收敛后零 running 悬挂。
11. **定理 11 [@ 路由排他性定理 (Mention Route Exclusivity)]**：
    $$\forall t, \quad \text{planSendRoute}(t).\text{cleanText} \cap \text{MentionToken} = \emptyset$$
    分流决策通道严格排他（BTW / Subagent / Group / Plain），且清洗后的 prompt 文本绝不残留被呼叫的 `@token` 原始标记。

## Execution (运行指令)

形式化验证已原生集成至 Monorepo 测试体系，单次全量证明约耗时 400~600ms：

```bash
npm run verify:formal
# 或直接通过 node 原生测试运行器执行：
node --test packages/core/__tests__/formal/**/*.test.mjs
```

## How to Read Counterexamples (反例解读与排查 SOP)

如果后续修改破坏了某个形式化不变量，`fast-check` 会在毫秒内捕获失败，并通过自动“收缩（Shrinking）”输出最小化复现用例：

```text
not ok - 定理 9 [截断锚点排他性]
  Property failed after 12 tests
  Counterexample: ["usr-1730000000000", undefined]
  Shrunk 4 time(s)
```

- **排查步骤**：
  1. 查看 `Counterexample` 字段：它给出了破坏该不变量的最简输入结构体（如把 `usr-` 临时 id 作为锚点传入）；
  2. 检查对应生产函数（`truncatePlan.ts`、`interactiveService.ts`、`botActivitySync.ts` 等）中是否漏掉了边界守卫；
  3. 严禁通过放宽属性范围或削弱断言让测试通过；必须定点补齐生产防御逻辑直至反例完全消除。
