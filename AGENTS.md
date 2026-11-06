# AGENTS.md - Hermes Flux 全平台工程规范与主控操作指南

本项目是 **Hermes Flux**（面向 Hermes Agent 全生态构建的全平台端到端极客美学工作台，覆盖 Desktop, Web, iOS, Android）的代码库根目录。

> **核心工程原则**：
> 1. **代码共享与单向解耦**：`core`（无界协议与纯状态机）➔ `ui`（表现层、Token 与纯组件）➔ `desktop / mobile / web`（轻量薄壳容器）；
> 2. **零假冒交付与实证杀伤力**：业务逻辑必须有落盘测试且具备变异杀伤力，严禁假测试、弱断言与循环自证；
> 3. **架构分层至高无上**：业务实现 100% 遵守架构分层与领域模型，严禁私自绕过 Core/PAL 编写临时胶水逻辑；
> 4. **项目隔离铁律**：技术细节、架构规范与踩坑经验仅沉淀在本仓库内部，严禁污染中枢与全局。

---

## 零、项目权威设计与技能资产索引 (Documentation & Skills Matrix)

任何功能演进、接口调用、重构修复与审查测试**必须首先研读对应设计规范与技能资产**：

### 1. 架构与设计系统文档索引
| 分类 | 文档路径 | 核心规范与约束 |
|---|---|---|
| **三态对话** | [`docs/architecture/three-conversation-modes-spec.md`](docs/architecture/three-conversation-modes-spec.md) | 普通会话、专职 Bot 主工位、多 Agent 群聊三态模型、展示形态与 Gateway 接口单一真值源 |
| **核心架构** | [`docs/architecture/core-architecture-and-data-flow-spec.md`](docs/architecture/core-architecture-and-data-flow-spec.md) | Monorepo 分层边界、PAL 平台抽象、WebSocket 5 态 FSM、Token 合流引擎 |
| **终极三舱** | [`docs/architecture/ultimate-tri-rail-architecture-spec.md`](docs/architecture/ultimate-tri-rail-architecture-spec.md) | 实体定义(Folder/Workspace/Project/Bot/Group/Session)、左双轨(52px微轨+212px抽屉)、右侧工具舱 |
| **设置中枢** | [`docs/architecture/settings-architecture-and-implementation-map.md`](docs/architecture/settings-architecture-and-implementation-map.md) | 12 大功能域全景设置树、三级级联继承状态机、258 RPC 映射与 4 阶段实施路线图 |
| **协议基线** | [`docs/architecture/gateway-api-and-features-matrix.md`](docs/architecture/gateway-api-and-features-matrix.md) | 官方网关契约基线（257 RPC / 14 反向请求 / 77 下行事件），客户端移动端 Capacitor 8 容器映射 |
| **交互协议** | [`docs/architecture/gateway-client-interaction-protocol.md`](docs/architecture/gateway-client-interaction-protocol.md) | 每次交互的发起方 / 方式（推还是拉）/ 接口名三要素，含连接生命周期、双 ID 语义、六大场景时序与增量对齐能力矩阵 |
| **接口索引** | [`docs/gateway/README.md`](docs/gateway/README.md) | 自动生成的 10 个网关核心模块接口文档与真实探针状态（禁止手动修改） |
| **设计系统** | [`docs/design-system/04-tokens-and-design-system-spec.md`](docs/design-system/04-tokens-and-design-system-spec.md) | 几何/字体栈/DTCG 跨姿态通用；Slate 色表与 Shadow 物理层级**仅 editorial / marketing 姿态**。工程皮肤真值见 `theme-engine-spec.md`；**Hermes Flux 默认 `tool` 姿态，美学裁决以 Aura 工作区 `specs/05-…` 审美宪法为准**（见 `docs/design-system/README.md` 设计真值链） |
| **踩坑登记** | [`docs/architecture/pitfall-registry.md`](docs/architecture/pitfall-registry.md) | 踩坑记录 ➔ 根因 ➔ 守卫探针映射（P-001 ~ P-021，每条坑必须绑定可变红的门禁/单测） |
| **工程纪律** | [`ENGINEERING_DISCIPLINE.md`](ENGINEERING_DISCIPLINE.md) | 工业级工程防御体系、AST 防 AI 糊弄 15 条棘轮、长会话性能预算与平台避坑军规 |
| **路线图** | [`docs/roadmap.md`](docs/roadmap.md) | 全局研发路线图、已落地特性看板、已知缺陷跟踪 |

### 2. 项目专属本地技能索引 (`.opencode/skills/`)
| 技能名称 | 目录路径 | 核心能力与适用场景 |
|---|---|---|
| **verify-hermes-flux** | [`.opencode/skills/verify-hermes-flux/`](.opencode/skills/verify-hermes-flux/) | 驱动真实 Blink 浏览器内核对工作台进行端到端物理行为验证，捕获真实截图存盘至 `artifacts/verification/` |
| **verify-formal-invariants** | [`.opencode/skills/verify-formal-invariants/`](.opencode/skills/verify-formal-invariants/) | 基于 `fast-check` 的形式化安全不变量检验器，在数万次随机并发交错中证明 11 大核心数学定理 |

---

## 一、系统架构分层与核心领域模型 (Architecture & Domain Models)

### 1. Monorepo 单向分层职责
$$\text{packages/desktop} \mid \text{packages/mobile} \mid \text{packages/web} \longrightarrow \text{packages/ui} \longrightarrow \text{packages/core}$$
- **`packages/core`**：纯 TypeScript 无界逻辑层，零 DOM/React/Electron 依赖。承载 JSON-RPC 2.0 Client、WebSocket 5 态 FSM、TokenCoalescer 合流引擎、PlatformBridge 接口规范与纯领域状态机；
- **`packages/ui`**：纯 UI 表现层与组件库。承载全端共享的 React 组件、设计系统 Tokens 与 Markdown 渲染器。禁止调用原生网络与平台私有 IPC；
- **`packages/desktop` / `packages/mobile`**：轻量薄壳容器（Thin Shells）。Desktop 基于 Electron，Mobile 基于 **Capacitor 8 原生容器**（运行 Web 产物，配合原生 Bridge）。**严禁在壳内编写应用级状态机与业务路由编排**。

### 2. 三大会话模式物理正交隔离原则 (Three Conversation Modes Invariant)
详见 [`docs/architecture/three-conversation-modes-spec.md`](docs/architecture/three-conversation-modes-spec.md)：
1. **普通会话 (Scratchpad / Side Session)**：
   - 随用随扔的攻坚排查会话，物理存在于各 Profile 的 `state.db`，`hidden=0`；
   - 允许重命名、删除、归档、单步撤回 (`session.undo`)、历史截断回滚 (`prompt.submit + truncate_before_row_id`) 与分叉 (`session.branch`)；
   - 键入 `@Agent` 分流为 `mention-subagent`（后台异步子任务），对话不写入 Bot 长期记忆（`MEMORY.md`）。
2. **专职 Bot 终身主工位 (Bot Forever Chat / Canonical Chat)**：
   - 专职数字员工唯一绑定的核心工位，固定 `title: 'Bot Chat'` 且 `hidden=1`（通过 `session.set_hidden` 物理保护）；
   - **受物理保护实体**：前端严禁提供删除、归档、单步回滚与 Fork 按钮（由 `deriveSessionKind` 物理阻断）；
   - **严禁冒名覆盖**：绝对禁止扫描普通会话池（`state.sessions`）拿旁聊会话覆盖 Bot 卡片；最新活动统一经 `updateBotLatestActivity` 反哺；
   - **外援与记忆铁律**：键入 `@Agent` 自动分流为 `mention-btw`，走 `prompt.btw` 只读外援胶囊，零 Token 污染当前 Bot 记忆。本模式是全系统**唯一法定**允许更新该 Bot 长期记忆（`MEMORY.md`）的通道。
3. **多 Agent 群聊研讨室 (Group Room / Hosted Room)**：
   - 多 Bot 协同议事空间，存储在网关根层主数据库的 `hosted_rooms` 表中，独立于任何单一 Profile；
   - **通信协议正交隔离**：必须且只能走 **`groups.*`** 系列专用 RPC（`groups.create`, `groups.list`, `groups.state`, `groups.send`, `groups.log`, `groups.stop`, `groups.disband`, `groups.rename`），**绝对禁止调用 `prompt.submit` 与 `session.*` 系列接口**；
   - **发信与审批契约红线**：`groups.send` 必须传 `{ room_id, event_id, payload: { text, thread_id } }`（P-002）；群聊内安全审批必须走专用 **`groups.approve`** 并绑定 `member_id` 与 `execution_generation`（P-020）；
   - **数据流驱动机制**：群聊网关无单会话逐 Token 的 `delta` 事件，多 Agent 回合发言必须通过 `pollGroupRoomUntilSettled` 实施有界轮询（上限 8 轮 × 2.5s），回读 `groups.log` 驱动增量上屏（P-021）；
   - **记忆隔离铁律**：群聊记录仅保存在 `groups.log` 中，**绝对禁止反向回写任何单个参会 Bot 的 `MEMORY.md`**。

### 3. 核心几何规范与设计约束
- **左侧双轨（Left Rail）**：宽度基线 `264px`（`52px` 物理微轨 + `212px` 抽屉工作区），支持通过把手在 264px ~ 480px 之间自由拉伸；快捷键 `Ctrl+B`（macOS 为 `Cmd+B`）收起抽屉收敛至 52px 微轨；
- **悬浮输入舱（Composer Dock）**：底部悬浮居中，**严格锁定黄金限宽 `max-width: 740px`**；群聊模式下禁止发送会话级 `config.set`；群聊键入 `@` 必须精准匹配当前房间参会成员；
- **场景检查舱（Inspection Pod）**：贴靠右侧窗边双列布局，详情工作舱 + 竖向场景轨，宽度基线锁定 `410px`；快捷键 `Ctrl+\`（macOS 为 `Cmd+\`）折叠展开；
- **状态底栏收敛（Status Bar Consolidated）**：状态底栏已从壳层彻底拔除，网关延迟与连接指示点收敛至顶栏右上角（淡雅 11px 等宽读数），垂直空间全部归还对话工作区；
- **顶栏（Titlebar）**：固定高度 `42px`。处于专职 Bot 工位时呈现 Bot 真实头像与 `${name}`，严禁携带 `(Forever Chat)` 冗余后缀与伪 emoji 占位。

### 4. 诊断日志与滚动不变量 (Diagnostics & Scroll)
- 日志统一走 `packages/core/src/log/logger.ts` 的 `createLogger(scope)`，禁止在渲染层直接使用裸 `console.log`；
- 会话流滚动遵循跟随模式：读者距底 $\le 48\text{px}$ 必须贴底，远离时视为阅读历史并严禁自动滚动；
- 严禁对会话长列表使用 `scroll-behavior: smooth`，必须即时定位以吸收排版漂移。

---

## 二、Agent 标准作业流水线 (SOP) 与判定树 (Workflow & Decision Tree)

任何接手本项目的 Agent 严禁凭直觉直接改动代码。必须无条件执行以下标准化四阶段管道：

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                         Hermes Flux Agent 标准作业管道 (SOP)                              │
├──────────────────┬──────────────────┬──────────────────────────┬─────────────────────────┤
│ 1. 范围与规范确认 │ 2. 原子编码与注释 │ 3. 确定性机器自检        │ 4. 强制 Subagent 双审   │
│ (Scope & Spec)   │ (Implementation) │ (Verification Pipeline)  │ (Independent Review)    │
│ 锁定文档与判定树  │ 补齐三要素中文注释│ 执行五阶自检命令 (100%绿)│ 样式审/代码审 (一票否决)│
└──────────────────┴──────────────────┴──────────────────────────┴─────────────────────────┘
```

### 1. 阶段一：范围确认与判定树（增量验证资产准入）
```text
                               【本次改动范围判定】
                                        │
           ┌────────────────────────────┴────────────────────────────┐
           ▼                                                         ▼
【分支 A: 触碰底层状态机/时序/对账】                      【分支 B: 引入全新用户可达独立功能/页面】
(core/src/rpc/*, session/*, botActivitySync 等)           (新操作面板、独立工作区抽屉、新独立功能流)
           │                                                         │
           ▼                                                         ▼
必须在 packages/core/__tests__/formal/                    必须在 .opencode/skills/verify-hermes-flux/
增量追加一条数学定理证明 (fast-check)，                    features/ 按照 4 段式新增 <feature-id>.md，
在 1,000+ 次随机乱序下证明不变量！                        并在 control-flux.mjs 接入驱动捕获真实截图！
(未追加者 Reviewer 一票否决打回)                          (未追加者 Reviewer 一票否决打回)
```

### 2. 阶段二：原子编码与三要素注释规范
- **最小完整变更**：只动当前任务直接相关的最窄代码层，严禁借机进行未经评审的顺手重构；
- **反 AI 糊弄增量棘轮**：坚决不用 `any`，严格声明 Interface / Type，严禁类型断言逃逸；
- **关键代码三要素中文注释**：关键函数、状态机转移与边界处理必须包含中文注释：
  1. **设计意图 (Why)**：为什么这么设计；
  2. **防范的历史坑 (Pitfall)**：规避了历史上什么具体失败模式；
  3. **约束与规则 (Rules)**：不可破坏的状态机或分层不变量。

### 3. 阶段三：确定性机器自检流水线（提交前必跑）
代码修改完成后，主 Agent **必须亲自按顺序运行并通过以下五阶自检命令**：
```bash
npm run gates:changed                           # 1. 静态门禁断言：新增违规数严格为 0
npm run typecheck                               # 2. 静态类型断言：全工作区 0 错误
npm run verify:formal                           # 3. 形式化安全定理断言：11 大数学定理获证，零反例逃逸
node scripts/verify/control-flux.mjs run <feat> # 4. Blink CDP 真实物理渲染验证：捕获截图存盘至 artifacts/verification/
npm run verify                                  # 5. 交付前全量总体验收：门禁 + 契约 + 类型 + 单测 + 形式化 100% 绿灯
```

### 4. 阶段四：强制 Subagent 独立双审（一票否决硬红线）
**主 Agent 绝对禁止自我认证（No Self-Certification）**。自检通过后，主 Agent 必须发起对应的 Subagent 审查：
- **若触碰样式敏感面** ➔ 委派 `flux-style-reviewer`：审查换肤 Token 完整性、i18n 零硬编码、渲染性能红线与几何规范；
- **若触碰代码逻辑面** ➔ 委派 `flux-code-reviewer`：审查架构分层、类型真实性、业务逻辑落盘测试与无遗漏、形式化定理与特征地图增量门禁；
- **双审全部判定 `PASS`** ➔ 方可向用户汇报或提交代码。

---

## 三、自动化质量门禁字典与反例排查 (Automated Gates & Diagnostics)

### 1. 核心门禁命令字典
| 门禁动作 | 执行命令 | 执行场景与通过标准 |
|---|---|---|
| **改动集静态门禁** | `npm run gates:changed` | **改动完随时跑**：基于 `git merge-base` 仅扫描本次触碰文件，**新增阻断违规数严格为 0** |
| **全量静态门禁** | `npm run gates` | 扫描 Monorepo 全量源码，断言无新增架构/换肤/i18n/性能违规，存量债务自动放行 |
| **全栈严格类型** | `npm run typecheck` | 执行 core、ui、desktop 递归类型推导，**0 TS 报错，严禁任何 as any** |
| **全量单测回归** | `npm test` | 执行全工作区单元测试与架构守卫测试，**100% 绿灯，单测用例必须具可证伪性** |
| **形式化不变量证明** | `npm run verify:formal` | **状态机必跑**：基于 fast-check 在 8,500+ 次随机并发交错中证明 11 大数学定理获证 |
| **物理CDP验证与截图** | `node scripts/verify/control-flux.mjs run <feature-id>` | **用户特征必跑**：驱动真实 Blink 内核，捕获物理截图存盘至 `artifacts/verification/` |
| **交付前全量四位一体** | `npm run verify` | **落盘前必跑**：链式执行 `gates` + `contract` + `typecheck` + `test` + `formal`，一键确定交付准入 |
| **网关接口文档同步** | `npm run contract:doc` | 根据 RPC 真实探针重新生成 `docs/gateway/` 契约文档（严禁手改） |
| **债务基线收缩** | `npm run gates:freeze` | **仅在清偿存量债务后执行**：将当前违规指纹重写至 `.baseline.json`（禁止用于洗白新增违规） |

### 2. 债务基线不变量 (Anti-Slop Ratchet Invariant)
- 存量债务记录于 `scripts/gates/.baseline.json`，按指纹严格冻结；
- **基线只允许收缩，绝对禁止扩张**：任何 Agent 严禁私自执行 `gates:freeze` 吸收新增违规。基线指纹若正向增长，CI 直接判定为恶意逃逸并一票否决；
- 只有实质性清偿存量债务后，方可在提交中附带收缩后的基线文件。

### 3. 行内豁免注释规约 (Inline Allowance Contract)
静态扫描若遇到因特殊底层需求产生的假阳性，必须在**违规行紧邻的上一行**显式标注豁免注释（禁止空行）：
- `// gate-arch-allow: 阐明为什么必须使用该桥接/特异语法的具体原因`
- `// gate-theme-allow: 阐明该色值为什么属于非主题面（如文档预览、系统原生按钮）的具体原因`
- `// gate-i18n-allow: 阐明该字符串为什么不属于用户界面呈现文案的具体原因`
- `// gate-perf-allow: 阐明该动效为什么必须保持独立的具体原因`
- `// gate-degrade: 阐明该异常为什么属于可选加速且可以安全降级忽略的具体原因`

### 4. 常见门禁报错排查速查表
| 门禁标识 | 根本原因 | 标准修复方案 | 严禁采用的糊弄手段 |
|---|---|---|---|
| `theme/no-hardcoded-color` | 组件模板或样式中包含硬编码 `#hex` / `rgb()` | 替换为语义匹配的 `var(--accent)`、`var(--bg-card)` 等 Token | 改写为带 alpha 的中性色掩盖、胡乱使用色值 |
| `i18n/no-hardcoded-text` | 组件中存在裸写的中文字面量，或内联三元伪翻译 | 在 `zhDict` 与 `enDict` 同步登记，代码中改写为 `t('key')` | 将中文写进模板变量强行绕过检测 |
| `arch/type-escape` | 出现了 `as any`、`as unknown as T` 或松散字典 | 定义具体的 Interface / Type，使用判别联合表达生命周期 | 声明别名为 `any` 的临时类型进行隐式逃逸 |
| `arch/no-bare-transport` | 渲染层直接调用了原生 `fetch` 或 `new WebSocket` | 经由 `HermesGatewayClient` 或 PAL 平台抽象桥接通信 | 在局部手写 Node 底层网络请求绕开检测 |
| `formal/counterexample` | 形式化验证器通过 fast-check 抓出了使定理失败的反例 | 根据输出的 `Counterexample` 输入结构体，定点补齐底层边界守卫 | 修改测试条件或缩小测试生成空间以迎合通过 |
