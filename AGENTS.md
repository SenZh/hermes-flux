# AGENTS.md - Hermes Flux 全平台美学工作台工程规范与质量门禁指南

本项目是 **Hermes Flux**（面向 Hermes Agent 全生态构建的旗舰级、全平台端到端极客美学工作台，覆盖 Desktop, Web, iOS, Android）的代码库根目录。

> **核心设计哲学**：
> 1. **美学即生产力（Aesthetic First）**：
>    - 彻底告别传统 AI 终端粗糙简陋的极客糙汉风；追求顶级电影级暗黑极简视觉、微距物理受光质感、细腻物理跟手动效与极致排版韵律。
> 2. **代码共享与架构解耦（Monorepo）**：
>    - `packages/core`：无界协议沉淀，承载 JSON-RPC 2.0 通信管道、5态 FSM、全抖动退避重连、流式 Token 合流引擎与平台抽象接口 (PAL)；
>    - `packages/ui`：纯 UI 表现层，承载全端共享的 React/DOM 组件、暗黑主题变量与状态机；
>    - `packages/desktop`、`packages/mobile`、`packages/web`：保持轻量壳容器包装。
> 3. **工程严谨与零假冒交付（Zero-Illusion Engineering）**：
>    - 核心业务逻辑必须有确定性单测覆盖，严禁循环自证伪测试与假类型降级。
> 4. **架构设计至高无上（Architecture-First & Alignment Mandate）**：
>    - **代码实现必须 100% 按照架构设计落地，严禁违背分层绕过 Core/PAL 自建简陋胶水逻辑；代码 Review 与单测设计必须无条件以架构文档为基准验收。**
> 5. **项目隔离铁律**：
>    - 本项目所有技术细节、架构设计、踩坑经验与流程规范仅沉淀在本目录内部，严禁污染中枢与全局。

---

## 零、项目权威架构与设计文档索引 (Architecture Documentation Index)

本代码库沉淀了完整的工业级系统架构与美学规范，任何功能演进、接口调用、重构修复与审查测试**必须首先研读并严格遵守对应设计文档**：

| 文档分类 | 文档名称与绝对路径 | 核心规范与设计约束 |
|---|---|---|
| **核心架构** | [`docs/architecture/core-architecture-and-data-flow-spec.md`](docs/architecture/core-architecture-and-data-flow-spec.md) | **系统全景拓扑与双向数据流规范**：Monorepo 包职责划分、PAL (平台抽象层) 接口定义、WebSocket 5态 FSM、全抖动退避算法、120FPS Token 合流引擎、Zustand 双层 Store 拓扑。 |
| **协议基线** | [`docs/architecture/gateway-api-and-features-matrix.md`](docs/architecture/gateway-api-and-features-matrix.md) | **Hermes Agent 官方协议权威基线**：252 个 RPC 方法、77 个下行推送事件、13 个服务端反向干预请求契约全景，官方 REST `/api/*` 辅助通道规范。 |
| **桌面工程** | [`docs/architecture/desktop-windows-delivery-and-cross-platform-guide.md`](docs/architecture/desktop-windows-delivery-and-cross-platform-guide.md) | **桌面端 Windows 交付与跨平台打包指南**：无边框窗口、Frameless 标题栏穿透、Cookie 跨域宿主代理、Windows 11 Mica 规避与单实例守护。 |
| **工作台重构**| [`docs/architecture/v4-redesign-spec.md`](docs/architecture/v4-redesign-spec.md) | **v4.0 极客美学通栏流式工作台规范**：全宽顶满流式对话舱、740px 黄金居中悬浮输入舱、双列自适应场景检查舱、22px 纯净翡翠状态栏。 |
| **多端流转** | [`docs/architecture/multi-device-shared-session-handover.md`](docs/architecture/multi-device-shared-session-handover.md) | **多设备共享会话与接力流转设计**：跨端会话握手、状态迁移、局域网直连探测与离线同步机制。 |
| **主题引擎** | [`docs/architecture/theme-engine-spec.md`](docs/architecture/theme-engine-spec.md) | **标准化可插拔主题注册表规范**：CSS 变量注入系统、暗黑极夜金/白玉翡翠皮肤、动态 Token 运行时切换。 |
| **问题档案** | [`docs/architecture/known-issues-and-backlog.md`](docs/architecture/known-issues-and-backlog.md) | **已知架构缺陷与演进 Backlog**：技术债务登记簿、时序竞态历史陷阱与中长程规划。 |
| **设计系统 1**| [`docs/design-system/01-classic-books-and-theories.md`](docs/design-system/01-classic-books-and-theories.md) | **经典设计书籍与排版理论基石**：网格系统、微距阅读律动、字体阶梯与对比度科学。 |
| **设计系统 2**| [`docs/design-system/02-aesthetic-philosophy-and-standards.md`](docs/design-system/02-aesthetic-philosophy-and-standards.md) | **美学哲学与电影级暗黑质感标准**：微距物理受光、双层边框高光、极黑纯净空间与翡翠微光点。 |
| **设计系统 3**| [`docs/design-system/03-director-design-workflow.md`](docs/design-system/03-director-design-workflow.md) | **设计总监级评审与审查工作流**：视觉对齐检查清单、不可妥协的工程排版细节。 |
| **设计系统 4**| [`docs/design-system/04-tokens-and-design-system-spec.md`](docs/design-system/04-tokens-and-design-system-spec.md) | **设计系统 Tokens 与物理几何规范**：全色板 Palette、Border Radius、Shadow 物理层级与尺寸规范。 |
| **桌面规范** | [`docs/design-system/desktop-design-system-spec.md`](docs/design-system/desktop-design-system-spec.md) | **桌面端专用设计系统规范**：窗口标题栏尺寸、可拖动分割轨阻尼、快捷键映射标准。 |
| **视觉方向** | [`docs/design-system/visual-directions.md`](docs/design-system/visual-directions.md) | **视觉方向与暗黑微距物理质感指南**：多智能体色彩指纹、思维链展开呼吸律动。 |

---

## 一、工业级自动化质量门禁 (Quality Gates - 一票否决硬红线)

全工作区所有代码修改、功能新增与缺陷修复，在提交或合并前必须无条件通过以下 **6 大硬门禁**。任何一项未通过直接**一票否决**：

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                           Hermes Flux Production Quality Gate Pipeline                           │
├─────────────────┬─────────────────┬──────────────────┬─────────────────┬─────────────────┬───────┤
│ Gate 0: ARCH    │  Gate 1: TYPE   │  Gate 2: TEST    │  Gate 3: INVAR  │  Gate 4: ACCESS │Gate 5:│
│ 架构符合性审查  │  全栈严格类型   │  反 AI 假测试    │  正确性不变量   │  物理入口可达   │CI回归 │
│ (严格按设计编码)│ (tsc --noEmit)  │ (真实DI/零Mock)  │ (Failure!=Empty)│ (Tokens强一致)  │(100%绿│
└─────────────────┴─────────────────┴──────────────────┴─────────────────┴─────────────────┴───────┘
```

| 门禁代号 | 门禁名称 | 审查标准与执行命令 | 违规一票否决典型场景 |
|---|---|---|---|
| **Gate 0** | **架构符合性门禁** | 代码实现必须 100% 符合 `docs/` 设计规范 | 业务层（UI/Renderer）越过 Core/PAL 自行发起裸 `fetch`；破坏 Monorepo 依赖单向拓扑；自行构造未经 Core 校验的临时数据结构 |
| **Gate 1** | **全栈严格类型门禁** | `npm run typecheck`<br>（强制递归对 `core`、`ui`、`desktop` 执行 `tsc --noEmit`，零类型报错） | 出现 `as any`、`as unknown as T`、隐式 any、未声明字段访问（如历史遗留的 `state.authSecret`） |
| **Gate 2** | **反 AI 假测试门禁** | `npm test`<br>（严禁 `vi.mock()` / `jest.mock()` 整体劫持，必须依赖注入与真实 import 生产模块） | 测试文件内自己构造假函数冒充生产实现；只测 Mock 对象的返回值，生产代码修改后测试依然绿灯 |
| **Gate 3** | **正确性不变量门禁** | 显式失败检验（Failure Is Not Empty） | 网络断开、网关异常或解析失败时，界面把错误静默吞掉并展示为空列表，导致用户无法感知真实故障 |
| **Gate 4** | **物理入口与规范门禁** | 布局与设计规范强一致断言 | 修改样式导致偏离 `docs/design-system/` 规范（如 StatusBar 尺寸未保持 22px、输入舱未收敛在 740px） |
| **Gate 5** | **进程隔离与全量回归** | `npm run build && npm test`<br>（全包构建成功且所有单测 100% 通过） | 构建脚本遗漏子包打包；单测执行依赖特定全局状态或时序，独立运行偶发挂起或失败 |

---

## 二、三阶段端到端开发流程 (Development Lifecycle Pipeline)

严禁跳过方案直接动手改代码。任何工程任务必须严格遵循 **分析设计 ➔ 原子实现 ➔ 验证落盘** 三阶段管道流转：

```text
[阶段 1: 分析与设计]
  事实清单确认 ──► 假设树剪枝 ──► 逐步可行性证明 ──► 方案设计双审
                                                          │ 闭环准入
                                                          ▼
[阶段 2: 原子实现]
  锁定最窄范围 ──► 严格类型定义 ──► 核心逻辑编码 ──► 关联单测配套编写
                                                          │ 编码完毕
                                                          ▼
[阶段 3: 验证、审查与落盘]
  本地全量 CI ──► 5关自检通过 ──► 委派 Subagent 独立审查 ──► 最终合并落盘
```

### 1. 阶段一：分析与设计 (Analysis & Design)
1. **建立事实清单**：梳理明确的代码现状、报错堆栈、日志行号与规范契约，严禁凭直觉猜测；
2. **假设树剪枝**：针对疑难问题列出所有可能假设，利用控制变量法和代码调用链纵深排查，迅速证伪无效假设；
3. **逐步证明可行性**：方案中的每个修改点必须在官方接口规范、源码依赖或微型实验中**先证明可行**，严禁带着未经验证的假设推入编码；
4. **方案审查准入**：方案必须交代清晰的 5W2H（修改范围、影响面、代价与回滚路径），方案未经证明闭环前，禁止编写生产代码。

### 2. 阶段二：原子实现 (Atomic Implementation)
1. **最小完整变更 (Smallest Complete Change)**：只动与当前任务直接相关的最窄代码层，严禁借修复之名做投机性重构或无依据的代码搬迁；
2. **反 AI 糊弄增量棘轮 (Anti-Slop Ratchet)**：严格定义所有数据结构接口（Interface / Type），坚决不用 `any`，新增代码必须推动类型覆盖率向上提升；
3. **消除临时胶水代码**：优先复用 Monorepo 现有沉淀（如调用 `packages/core` 的 `HermesGatewayClient` 与 `WebSocketFsm`，严禁在业务层自建重复简陋轮子）；
4. **明确状态演变 (State Diff)**：涉及状态机、并发、长连接时，明确流转前后的精确状态转移；
5. **关键代码必须写清晰注释（Crucial Code Comments Mandate）**：
   - 关键代码（包括架构分层边界、网络/RPC 契约调用、状态机转移、DOM 增量合流、CSS 布局核心约束、防抖与时序补偿）**必须编写清晰、严谨的高密度中文注释**；
   - 注释既是给用户审查代码看的，也是给后续协同与接力的 Agent 看的；
   - 注释必须阐明三要素：① **设计意图 (Why)** 为什么这么写、② **防范的历史坑 (Pitfall)** 规避了什么具体失败模式（如防止 flex 默认 row 导致多段落横向分列排版崩塌、防止跨域剥离 Cookie）、③ **约束与规则 (Rules)** 明确说明调用边界与不可破坏的不变量。

### 3. 阶段三：验证、审查与落盘 (Verification & Commit)
1. **本地全量 CI 必须全绿**：本地终端无条件执行并通过 `npm run typecheck && npm test && npm run build`；
2. **落盘前 5 关自检**：
   - ① **编译关**：全包 TypeScript 静态编译 0 报错；
   - ② **测试关**：单测 100% 通过，新增逻辑具备确定性反向证伪用例；
   - ③ **规范关**：完全符合设计系统（Token）与跨端隔离规范；
   - ④ **代码质量关**：无调试日志残留、无死代码、无未捕获 Promise rejection；
   - ⑤ **环境纯净关**：无多余临时文件或测试抓包入库。
3. **功能与用例双审与 CDP 强验证红线（Ironclad CDP & Subagent Verification Rules）**：
   - 任何功能修复或新增后，**必须编写对应的确定性测试用例**；
   - 任何功能修复或新增后，**必须使用子代理（Subagent）执行真实的 CDP（Chrome DevTools Protocol）浏览器端到端自动化验证**并通过；
   - 所有测试用例设计与测试代码本身，**必须由独立 Subagent 进行 Review 审查验收**（一票否决制：严禁假测试与循环自证）；
   - 主题皮肤支持（Design Tokens 零死色值）与 100% i18n 国际化字典键必须作为自动化测试的强制断言门禁项，通过 `npm test` 自动守护。
4. **双审闭环**：自检与 Subagent 审查全部通过，确认零缺陷方可合并交付。

---

## 三、用例编写与设计规范 (Test Authoring Standards)

测试是工程真实性的基石。编写单元测试与集成测试必须遵守以下铁律：

### 1. 结构标准：严格 AAA 三段式 (Arrange - Act - Assert)
每个测试用例必须具有明确的三个物理分块，结构自明：
```javascript
test('FSM should compute exponential backoff with full jitter within bounds', () => {
  // 1. Arrange: 准备确定性依赖与受控配置
  const fsm = new WebSocketFsm({ initialDelayMs: 100, maxDelayMs: 1000, backoffFactor: 2 });
  
  // 2. Act: 执行目标业务动作
  const delay = fsm.getNextBackoffMs();
  
  // 3. Assert: 执行有价值且具有排他性的断言
  assert.ok(delay >= 0 && delay <= 100, `Delay must fall within [0, 100], got ${delay}`);
});
```

### 2. 覆盖维度必须齐全 (Test Quadrant)
编写测试时，必须覆盖以下四个正交维度：
- **正常确定性路径 (Happy Path)**：标准输入与预期输出的完整映射；
- **极限边界值 (Boundary Limits)**：空数组、零延迟、最大重连次数、长文本溢出、极大/极小视口；
- **负向与混沌注入 (Negative & Chaos)**：网络超时、连接断开、JSON 解析畸变、服务端返回标准 RPC 错误（`-32600 ~ -32603`）；
- **并发与竞态检验 (Concurrency & Race)**：多次高频触发、组件销毁时回调注销、异步排队取消。

### 3. 编写红线与质量要求
- ❌ **禁止循环自证**：严禁在测试中把生产逻辑复制一遍比对；
- ❌ **禁止弱断言糊弄**：严禁仅断言 `assert.ok(result)`，必须针对核心字段断言精确值（如 `assert.equal(result.code, -32602)`）；
- ❌ **禁止吞异常**：涉及 Promise 拒绝必须使用 `assert.rejects(...)` 捕获并核实 Error 实例及属性；
- ✅ **真实模块导入**：测试必须从 `dist/` 或源码包真实 import 被测模块，通过参数注入（DI）解耦外部真实网络与 I/O。

---

## 四、用例审查协议 (Test Review Protocol)

代码审查人员（包括 Subagent Reviewer 与主线程自审）在审查测试用例时，执行以下**五步一票否决核查**：

1. **变异检验（Mutation Testing Check）**：
   - 核心问题：“如果把被测生产代码改错或将返回值置空，该测试会变红吗？”
   - 若故意改错生产逻辑而测试依然显示绿色，该测试判定为**无效假测试，一票否决**。
2. **Mock 隔离性核查**：
   - 检查是否 Mock 了不该 Mock 的核心逻辑；
   - 规范只允许对底层物理传输（如 `WebSocket.send`、文件系统 I/O、HTTP 网络）进行参数捕获注入，**绝不允许 Mock 业务模型与状态机本身**。
3. **断言密度与精确度审查**：
   - 一个合格的测试至少包含对**状态（State Diff）**和**交互契约（Payload Contract）**的双重断言；
   - 杜绝仅靠无报错隐式通过测试（No assertions = No test）。
4. **时序与资源泄露审查**：
   - 检查测试中是否存在未清除的 `setTimeout`、未取消的 `requestAnimationFrame`、未关闭的事件监听；
   - 定时器逻辑必须可控，禁止硬编码 `sleep(3000)` 等待异步，必须使用 Promise 契约推进。
5. **错误信息表达力审查**：
   - 断言失败时必须输出具有可读性的排查信息（如 `assert.ok(cond, '说明预期条件与实际不符原因')`）。

---

## 五、代码与用例双审工作流 (Dual-Review Pipeline)

为了杜绝单点疲劳与认知盲区，所有核心代码修改执行**双审机制**：

```text
[主开发线程]
  完成功能修改与测试编写
  执行 5 关自检核查清单
          │ 自检通过
          ▼
[委派 Subagent 独立审查]
  提供：修改背景、目标、Git Diff
  执行：
    1. 静态漏洞与类型逃逸扫描
    2. 反假测试与测试有效性审查
    3. 设计规范一致性比对
          │ 审查报告回传
          ▼
[架构裁决与终审]
  无异议 ➔ 批准合并落盘
  有异议 ➔ 退回主线程定点修复并复测
```

### 1. Subagent 独立审查操作规范
当功能代码与测试编写完毕后，主线程委派独立无污染的 Subagent 进行只读 Review：
- **输入提供**：准确描述修改目标、提供涉及的文件清单与关键代码差异；
- **审查重点**：
  - 是否存在未显式捕获的异常？
  - 是否存在 `as any` 或降级强转？
  - 新增测试是否具备真实证伪能力？
  - 是否符合 `AGENTS.md` 的 Monorepo 分层与 Token 规范？
- **输出产物**：结构化 Review 报告（包含违规点定位、严重级别、修复建议与合并裁决）。

---

## 六、视觉与设计系统规范 (Design Tokens)

为确保全平台（从手机竖屏到 4K 显示器）具有统一的电影级暗黑质感与高级感，必须遵守以下设计规范：

### 1. 调色板 (Atmospheric Palette)
* **底色背景 (Background)**：
  - `bg-surface-0`: `#080808`（纯黑但带微量暗银深邃感，作为全屏底色）
  - `bg-surface-1`: `#121212`（卡片与侧边栏）
  - `bg-surface-2`: `#1A1A1A`（次级弹窗与激活态）
* **光晕高亮 (Aura Accent)**：
  - `aura-amber`: `#FFBF00`（琥珀暖金，作为主要品牌光晕与运行中呼吸态）
  - `aura-cyan`: `#00E5FF`（冰蓝冷光，作为工具调用与数据流态）
  - `aura-violet`: `#A855F7`（神秘暗紫，作为多智能体与思维链路态）
* **排版文字阶梯 (Text Colors)**：
  - `text-primary`: `#F5F5F7`（95% 亮度纯白，高对比度不刺眼）
  - `text-secondary`: `#A1A1AA`（次要信息与时间戳）
  - `text-muted`: `#52525B`（辅助占位符与微弱提示）

### 2. 空间布局与核心几何规范 (v3.1 Spec)
* **顶栏 (Titlebar)**：固定高度 `42px`，消除内联折叠按键，仅保留左三色灯、中纯标题+7px翡翠微光点、右辅助功能；
* **左侧会话轨 (Left Rail)**：宽度 `260px`，支持一键折叠至 `0px`（`Ctrl+B`），新建会话按钮横向满格；
* **中间对话流 (Middle Pod)**：**100% 通栏全宽顶满侧边栏**，消除 860px 硬居中限制，内边距 `24px 32px 180px`，底部配置 `120px` 渐变柔光遮罩；
* **内嵌输入舱 (Input Dock)**：底部居中悬浮，**严格锁定黄金限宽 `max-width: 740px` (720px~760px)**，内嵌模型选择器、思考深度与审批策略；
* **自适应检查舱 (Inspection Pod)**：总宽度 `410px`，双列布局——左侧详情工作舱 (`348px`) + 贴靠极右窗边竖向场景轨 (`62px`)，竖向排列成果物、浏览器、Git变更与认知记忆；
* **极致精简状态栏 (Status Bar)**：**固定压缩至 `22px`**，彻底拔除调试冗余，仅保留翡翠绿微光点与延迟读数。

---

## 七、多端工程边界划分

* **`packages/core`**：
  - 纯 TypeScript 无界逻辑层，零 DOM/React 依赖；
  - 承载 JSON-RPC 2.0 Client、5-State WebSocket FSM、TokenCoalescer 合流引擎、Platform Abstraction Layer (PAL)。
* **`packages/ui`**：
  - 纯 UI 组件层、Tailwind 配置、暗黑主题变量与设计系统 Tokens；
  - 沉浸式 Markdown/代码审查器、流式时间轴、输入舱、场景检查舱与状态栏。
* **`packages/desktop`**：
  - Electron / Tauri 桌面外壳，支持 macOS, Windows, Linux；
  - 负责本地快捷键唤醒、系统托盘、本地 Gateway 守护进程与双向 IPC 管道。
* **`packages/mobile`**：
  - 兼容 iOS 与 Android 双端；
  - 继承底层 C++ 流式下载与分享（零 JS 堆内存介入，杜绝 JVM OOM），适配灵动岛与触觉反馈。
* **`packages/web`**：
  - 独立 Web 工作台，支持部署为 Web App / PWA，支持公网或内网反代访问。

---

## 八、诊断日志与滚动稳定性红线 (Diagnostics)

### 1. 日志必须走分级 logger

- 唯一入口：`packages/core/src/log/logger.ts` 的 `createLogger(scope)`，禁止在渲染层直接 `console.log` 输出调试信息。
- 级别：`silent < error < warn < info < debug < trace`，默认 `info`；未经打包的开发运行自动以 `?log=debug` 启动。
- 运行期切换：DevTools 执行 `__fluxLog.setLevel('trace')`（会持久化到 `localStorage.hermes_flux_log_level`）。
- 性能敏感路径（`render()`、流式 flush、分页回补）只允许 `debug` / `trace` 级别埋点，且埋点本身不得引入同步布局读取以外的额外开销。

### 2. 会话流滚动不变量 (Scroll Invariants)

- **跟随模式**：读者距底 ≤ `STICK_TO_BOTTOM_THRESHOLD_PX`(48px) 视为"跟随中"，渲染与流式 flush 都必须贴底；
  距底更远视为"正在阅读历史"，任何自动滚动都是缺陷。
- **渲染前判定**：`render()` 必须先在旧 DOM 上判定是否处于跟随模式，再决定贴底还是走 `StreamAnchor` 补偿，
  禁止渲染后再猜。
- **禁止高度估算**：`.message-row` 不得使用 `content-visibility` / `contain-intrinsic-size` 等会用估算高度替代真实布局的属性；
  超长会话的性能靠"窗口化挂载 50 条 + 触顶回补"保证，而不是靠隐藏行的布局。
- **禁止 `scroll-behavior: smooth`**：程序化滚动必须即时生效，平滑滚动会与补偿逻辑叠加成抖动。

---

## 九、接口契约前置验证规范 (API Verification Protocol - 铁律)

在编写、调用或修改任何后端网关接口（JSON-RPC 2.0 方法、REST API、平台 IPC）之前，**严禁凭直觉或假设直接写调用代码**。必须在官方文档、OpenAPI 规范或后端源码中逐项完成**接口前置三要素取证**并闭环：

```text
┌────────────────────────────────────────────────────────────────────────┐
│               API Contract Triad Verification (接口前置三要素)          │
├───────────────────┬───────────────────┬────────────────────────────────┤
│ 1. 存在性确认     │ 2. 功能边界确认   │ 3. 入参与出参契约确认          │
│ (Existence)       │ (Functionality)   │ (Payload & Response Contract)  │
│ 接口是否真实注册  │ 接口究竟做什么    │ 字段名、类型、必填项与返回 Schema│
└───────────────────┴───────────────────┴────────────────────────────────┘
```

### 1. 确认三要素审查清单
1. **要素一：接口是否存在（Existence）**：
   - 查证源：查阅后端 Gateway 源码路由表（如 `server.py`、`routes.py`、RPC 注册清单）或官方文档；
   - 严禁行为：禁止凭经验臆造方法名（如凭空调用 `session.list_all`、`chat.history` 等未注册方法）；
2. **要素二：接口的核心功能与边界（Functionality & Side Effects）**：
   - 查证源：阅读接口实现逻辑，明确其职责边界、错误码含义（如 4007 会话未激活、4001 未授权）以及是否有副作用（如调用后是否会持久化、是否会广播全局通知）；
   - 严禁行为：把只读查询当成状态重置，或误判接口的作用域（如全局会话与 Profile 上下文隔离）；
3. **要素三：精确出入参契约（Payload & Response Contract）**：
   - 查证源：检查 Pydantic Schema / Type 声明，核实每个参数的实名、类型、默认值与合法取值；
   - 严禁行为：传未声明的多余字段（触发服务端的 `Extra inputs are not permitted` 致命报错）；传错类型（如将 string 传为 number、把毫秒时间戳当成秒）；
   - 出参兼容：明确响应数据结构是 `{ messages: [...] }` 还是 `{ history: [...] }` 还是 `{ data: [...] }`，写防御性解包逻辑，禁止单一假设直接访问。

---

## 十、前端工程架构与渲染性能规范 (Frontend Architecture & Performance Standards)

针对富文本、多代码块的大型会话场景，前端渲染必须遵循**局部隔离更新**与**反抖动加载流程**，坚决杜绝因全量重绘导致的界面卡死：

### 1. 渲染架构红线与禁令清单 (Strict Prohibitions)
- ❌ **严禁会话流无辜重绘（Zero Stream Thrashing）**：
  - 点击任何非消息控件（折叠侧边栏、切换检查舱 Tab、打开/关闭设置弹窗、展开模型菜单、输入框输入等），**绝对禁止销毁或重绘 `#conversation-stream` 的 DOM 树**；
  - 必须通过区域 Slot（Titlebar、LeftRail、InspectionPod、StatusBar、InputDock、Modal）进行局部 outerHTML/DOM 替换，保持消息流 100% 原始 DOM 节点不动；
- ❌ **严禁插入 DOM 后同步强制重排（Forced Synchronous Layout）**：
  - 严禁在修改 innerHTML/outerHTML 之后，同一事件循环内直接同步读取 `scrollHeight`、`scrollTop`、`offsetHeight`、`getBoundingClientRect`；
  - 几何计算与滚动补偿必须拆分在 `requestAnimationFrame` 中分帧完成；
- ❌ **严禁高开销 API 混入渲染热链路**：
  - 严禁在渲染循环或列表 map 中调用 `toLocaleTimeString` 等 `Intl` 格式化（必须使用纯算术格式化）；
  - 严禁在渲染热路径上频繁做无缓存的非必要深度反序列化；
- ❌ **严禁分页加载竞态重入**：
  - 向上触顶加载历史时，必须先置加锁标志 `isLoadingOlder = true`，**必须等待第二帧高度补偿完全平移稳定后**方可释放锁，杜绝滚动条归零触发的级联并发雪崩。

### 2. 标准化会话加载与分页流线 (Standard Loading Pipeline)

```text
[用户点击会话 / 切会话]
       │
       ▼
1. 内存/本地缓存秒开 (Cache-First)
   └── 若缓存存在，瞬间渲染最新 50 条 (0ms 白屏)，立即贴底呈现
       │
       ▼
2. 校验通过的 RPC 唤醒 (Verified session.resume)
   └── 携带准确 profile 与 session_id 契约调用网关
       │
       ▼
3. 窗口化挂载与队列分离 (Initial Windowing)
   └── 仅将最新 50 条挂载到 DOM 树 (700KB 缩减至 150KB，渲染排版耗时降 80%)
   └── 剩余早前历史存入内存队列 `sessionOlderQueue`，点亮向上回补指示器
       │
       ▼
4. 触顶无感步进回补 (Incremental 30-item Paging)
   └── stream.scrollTop < 120 且未加载时触发
   └── 加锁 isLoadingOlder = true ➔ 从队列取出 30 条切片前置拼接
   └── 首帧测量高度差：nextScrollTop = prevScrollTop + addedHeight
   └── 次帧吸收字体/排版残余漂移 ➔ 释放加锁标志 isLoadingOlder = false
```
