# AGENTS.md - Hermes Flux 全平台工程规范与主控索引总纲

本项目是 **Hermes Flux**（全平台端到端极客美学工作台，覆盖 Desktop, Web, iOS, Android）的代码库根目录。

> **核心工程原则**：
> 1. **代码共享与单向解耦**：`core`（无界协议与纯状态机）➔ `ui`（表现层、Token 与纯组件）➔ `desktop / mobile / web`（轻量薄壳容器）；
> 2. **零假冒交付与实证杀伤力**：业务逻辑必须有落盘测试且具备变异杀伤力，严禁假测试、弱断言与循环自证；
> 3. **架构分层至高无上**：业务实现 100% 遵守架构分层与领域模型，严禁私自绕过 Core/PAL 编写临时胶水逻辑；
> 4. **项目隔离铁律**：技术细节、架构规范与踩坑经验仅沉淀在本仓库内部，严禁污染中枢与全局；
> 5. **UI 高度抽象与组件复用**：前端实现禁止为不同业务实体分别重复编写同构视图代码（如会话行、群聊行、Agent卡片等）；必须以基准样式抽象单一可复用组件，通过可选 Props 扩展差异，严禁样式漂移与双标实现。

---

## 零、权威规范与提示词资产索引 (Documentation & Prompts Index)

任何功能演进、UI 视觉打磨、接口调用、重构修复与审查测试**必须首先研读对应提示词与设计规范**：

### 1. UI 视觉、设计系统与审查规范 (`docs/design-system/`)
| 资产名称 | 路径 | 核心要点与适用场景 |
|---|---|---|
| **设计系统总纲** | [`docs/design-system/README.md`](docs/design-system/README.md) | **【强制】凡涉及 UI/视觉/样式/排版必须先读**。新极客精准美学、5 级表面阶梯（L0~L4）、1px 微距发丝线、7 档整数排版字阶、核心几何约束（42px顶栏/264px左双轨/740px输入舱/410px检查舱/拔除底栏）、高度抽象与组件复用铁律 |
| **UI 与体验审查规范** | [`docs/design-system/style-review-spec.md`](docs/design-system/style-review-spec.md) | **【强制】样式审查专员 Specification**。Token 纯粹性、几何一致性、排版无抖动、i18n 完整性、组件复用度与动效物理学六大审查维度，结论 Binding（一票否决） |
| **设计 Token 规范** | [`docs/design-system/04-tokens-and-design-system-spec.md`](docs/design-system/04-tokens-and-design-system-spec.md) | 全端空间网格、色彩阶梯、字体排印、圆角与阴影层级规范 |
| **桌面端设计规范** | [`docs/design-system/desktop-design-system-spec.md`](docs/design-system/desktop-design-system-spec.md) | 空间骨架、通栏对话流、52+212px 双轨折叠、740px 黄金输入舱与 410px 竖向检查舱 |
| **设置体系交互规范** | [`docs/design-system/settings-interaction-and-ui-spec.md`](docs/design-system/settings-interaction-and-ui-spec.md) | 设置中心正交悬浮舱交互、分栏布局与 Token 映射规范 |

### 2. 系统核心架构与领域设计规范 (`docs/architecture/`)
| 分类 | 文档路径 | 核心规范与约束 |
|---|---|---|
| **三态对话模型** | [`docs/architecture/three-conversation-modes-spec.md`](docs/architecture/three-conversation-modes-spec.md) | 普通会话、专职 Bot 主工位、多 Agent 群聊三态物理隔离模型与网关协议分流 |
| **核心架构与数据流** | [`docs/architecture/core-architecture-and-data-flow-spec.md`](docs/architecture/core-architecture-and-data-flow-spec.md) | Monorepo 分层边界、PAL 平台抽象、WebSocket 5 态 FSM、Token 合流引擎 |
| **终极三舱** | [`docs/architecture/ultimate-tri-rail-architecture-spec.md`](docs/architecture/ultimate-tri-rail-architecture-spec.md) | 实体定义(Folder/Workspace/Project/Bot/Group/Session)、左双轨(52px微轨+212px抽屉)、右侧工具舱 |
| **设置中枢** | [`docs/architecture/settings-architecture-and-implementation-map.md`](docs/architecture/settings-architecture-and-implementation-map.md) | 12 大功能域全景设置树、三级级联继承状态机、258 RPC 映射与 4 阶段实施路线图 |
| **协议基线与特性** | [`docs/architecture/gateway-api-and-features-matrix.md`](docs/architecture/gateway-api-and-features-matrix.md) | 官方网关契约基线（257 RPC / 14 反向请求 / 77 下行事件），客户端 Capacitor 8 容器映射 |
| **网关交互协议** | [`docs/architecture/gateway-client-interaction-protocol.md`](docs/architecture/gateway-client-interaction-protocol.md) | 每次交互的发起方 / 方式（推还是拉）/ 接口名三要素，含连接生命周期、双 ID 语义、六大场景时序与增量对齐能力矩阵 |
| **客户端缓存** | [`docs/api/client-cache-status.md`](docs/api/client-cache-status.md) | **进度与交接**：当前状态、换机恢复命令、两个 P0 待办、七个必知坑点位 |
| **网关接口索引** | [`docs/gateway/README.md`](docs/gateway/README.md) | 自动生成的 10 个网关核心模块接口文档与真实探针状态（禁止手动修改） |
| **设计系统** | [`docs/design-system/04-tokens-and-design-system-spec.md`](docs/design-system/04-tokens-and-design-system-spec.md) | 几何/字体栈/DTCG 跨姿态通用；Slate 色表与 Shadow 物理层级仅 editorial/marketing 姿态；Hermes Flux 默认 tool 姿态 |
| **踩坑登记表** | [`docs/architecture/pitfall-registry.md`](docs/architecture/pitfall-registry.md) | 踩坑记录 ➔ 根因 ➔ 守卫探针映射（P-001 ~ P-021） |
| **动效与宿主隔离** | [`docs/architecture/motion-system-and-host-isolation-spec.md`](docs/architecture/motion-system-and-host-isolation-spec.md) | 跨端通用动效引擎、Version CAS 状态机、动态 Token 探测、Grid 折叠契约与宿主渐进改造规范 |
| **工程纪律总纲** | [`ENGINEERING_DISCIPLINE.md`](ENGINEERING_DISCIPLINE.md) | 工业级工程防御体系、AST 防 AI 糊弄 15 条棘轮、长会话性能预算与平台避坑军规 |
| **研发路线图** | [`docs/roadmap.md`](docs/roadmap.md) | 全局研发路线图、已落地特性看板、已知缺陷跟踪 |

### 3. 本地专属自动化验证技能 (`.opencode/skills/`)
| 技能名称 | 目录路径 | 核心能力与适用场景 |
|---|---|---|
| **verify-hermes-flux** | [`.opencode/skills/verify-hermes-flux/`](.opencode/skills/verify-hermes-flux/) | 驱动真实 Blink 浏览器内核对工作台进行物理渲染验证，捕获截图存盘至 `artifacts/verification/` |
| **verify-formal-invariants** | [`.opencode/skills/verify-formal-invariants/`](.opencode/skills/verify-formal-invariants/) | 基于 `fast-check` 的形式化安全不变量检验器，在随机并发交错中证明核心数学定理 |
| **verify-cache-invariants** | [`.opencode/skills/verify-cache-invariants/`](.opencode/skills/verify-cache-invariants/) | 客户端缓存子系统的形式化安全不变量验证，在随机操作交错中证明定理 22~26 |

---

## 一、系统架构分层与核心领域模型 (Architecture & Domain Models)

### 1. Monorepo 单向分层职责
$$\text{packages/desktop} \mid \text{packages/mobile} \mid \text{packages/web} \longrightarrow \text{packages/ui} \longrightarrow \text{packages/core}$$
- **`packages/core`**：纯 TypeScript 无界逻辑层，零 DOM/React/Electron 依赖。承载 JSON-RPC 2.0 客户端、WebSocket 状态机、Token 合流引擎与纯领域模型；
- **`packages/ui`**：纯 UI 表现层与组件库。承载全端共享的 React 组件、设计系统 Tokens、样式与 Markdown 渲染器。禁止调用原生网络与平台私有 IPC；
- **`packages/desktop` / `packages/mobile`**：轻量薄壳容器。Desktop 基于 Electron，Mobile 基于 Capacitor 8。**严禁在壳内编写应用级状态机与业务路由编排**。

### 2. 三大会话模式物理正交隔离原则
详见 [`docs/architecture/three-conversation-modes-spec.md`](docs/architecture/three-conversation-modes-spec.md)：
1. **普通会话 (Scratchpad / Side Session)**：
   随用随扔的排查会话，物理存在于各 Profile 的 `state.db` (`hidden=0`)；允许重命名、删除、单步撤回 (`session.undo`) 与分叉 (`session.branch`)。
2. **专职 Bot 终身主工位 (Bot Forever Chat)**：
   专职数字员工唯一绑定的核心工位，物理保护 (`hidden=1`)；前端严禁提供删除、归档与单步回滚按钮；键入 `@Agent` 分流为 `prompt.btw` 只读外援胶囊；**全系统唯一法定允许更新该 Bot `MEMORY.md` 的通道**。
3. **多 Agent 群聊研讨室 (Group Room)**：
   多 Bot 协同议事空间，存储于主数据库 `hosted_rooms`；通信必须且只能走 **`groups.*`** 系列专用 RPC，严禁调用 `prompt.submit`；记录保存在 `groups.log`，严禁回写单个 Bot 的 `MEMORY.md`。

---

## 二、Agent 标准作业流水线 (Workflow SOP)

接手本项目的 Agent 严禁凭直觉改动代码，必须无条件执行以下标准化四阶段管道：

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                         Hermes Flux Agent 标准作业管道 (SOP)                              │
├──────────────────┬──────────────────┬──────────────────────────┬─────────────────────────┤
│ 1. 范围与规范确认 │ 2. 原子编码与注释 │ 3. 确定性机器自检        │ 4. 强制 Subagent 双审   │
│ (Scope & Spec)   │ (Implementation) │ (Verification Pipeline)  │ (Independent Review)    │
│ 锁定文档与提示词  │ 补齐三要素中文注释│ 执行全量自检 (100% 绿灯) │ 样式审/代码审 (一票否决)│
└──────────────────┴──────────────────┴──────────────────────────┴─────────────────────────┘
```

1. **阶段一（范围确认）**：修改 UI/视觉先读 [`docs/design-system/README.md`](docs/design-system/README.md)；修改状态机需准备形式化定理验证；引入新功能需补充测试用例。
2. **阶段二（原子编码）**：最小完整变更，禁止任何 `as any`，关键函数注明三要素（设计意图 Why、防范历史坑 Pitfall、约束规则 Rules）。
3. **阶段三（机器自检）**：必须亲自执行并通过五阶自检命令（见下表）。
4. **阶段四（独立双审）**：禁止自我认证；触碰样式委派 `flux-style-reviewer` 审查；触碰逻辑委派 `flux-code-reviewer` 审查；双审全 PASS 方可向用户汇报。

---

## 三、自动化质量门禁速查表 (Automated Gates)

| 门禁动作 | 执行命令 | 执行场景与通过标准 |
|---|---|---|
| **改动集静态门禁** | `npm run gates:changed` | **改动完随时跑**：基于 `merge-base` 仅扫描触碰文件，**新增违规数严格为 0** |
| **全量静态门禁** | `npm run gates` | 扫描全量源码，断言无新增架构、换肤、文案与性能违规 |
| **全栈严格类型** | `npm run typecheck` | 执行 core、ui、desktop 递归类型推导，**0 TS 报错，严禁 as any** |
| **全量单测回归** | `npm test` | 执行全工作区单元测试与架构守卫测试，**100% 绿灯（630+ 测试全部通过）** |
| **形式化不变量证明** | `npm run verify:formal` | **状态机必跑**：基于 fast-check 在随机并发交错中证明数学定理 |
| **网关文档同步** | `npm run contract:doc` | 根据 RPC 真实探针重新生成 `docs/gateway/` 契约文档（严禁手改） |
| **交付前总体验收** | `npm run verify` | **落盘前必跑**：链式执行 gates + contract + typecheck + test + formal，全绿通过 |
