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

---

## 十一、自动化门禁执行命令字典与基线不变量 (Automated Gate Commands & Baseline Invariants)

任何接手本项目的 Agent 严禁凭感觉开发。本地开发与提交前**必须通过执行以下确定性命令完成自检与验证**，执行结果作为交付的物理依据：

### 1. 核心门禁命令字典

| 动作 | 命令 | 执行场景与通过标准 |
|---|---|---|
| **改动集静态门禁** | `npm run gates:changed` | **改动完随时跑**：基于 `git merge-base` 仅扫描本次触碰文件，**新增阻断违规数严格为 0** |
| **全量静态门禁** | `npm run gates` | 扫描 Monorepo 全量源码，断言无新增架构/换肤/i18n/性能违规，存量债务自动放行 |
| **全栈严格类型** | `npm run typecheck` | 执行 core、ui、desktop 递归类型推导，**0 TS 报错，严禁任何 as any** |
| **全量单测回归** | `npm test` | 执行全工作区单元测试与架构守卫测试，**100% 绿灯，单测用例必须具可证伪性** |
| **交付前三位一体** | `npm run verify` | **落盘前必跑**：链式执行 `gates` + `typecheck` + `test`，一键确定是否满足交付准入 |
| **真实无头 CDP** | `node --test packages/desktop/__tests__/cdp/openchamber-toolbar.test.mjs` | 验证真实 Edge/Chrome 浏览器无头环境渲染、样式与事件绑定的真实物理行为 |
| **门禁自身变异检验** | `npm run gates:mutation` | 故意注入 5 处历史真实缺陷，断言门禁测试必须 100% 变红（证明门禁具备真实杀伤力） |
| **Agent 配置一致性** | `npm run gates:config` | 验证 `opencode.jsonc` 与 `.opencode/agents/` 审查者只读权限与步骤上限一致性 |
| **债务基线收缩** | `npm run gates:freeze` | **仅在清偿存量债务后执行**：将当前违规指纹重写至 `.baseline.json`（禁止用于洗白新增） |

### 2. 债务基线不变量 (Anti-Slop Ratchet Invariant)

- 存量债务记录于 `scripts/gates/.baseline.json`，按 `ruleId::file::hash(snippet)` 多重集指纹严格冻结；
- **基线只允许收缩，绝对禁止扩张**：任何 Agent 严禁为了让提交变绿而私自执行 `npm run gates:freeze` 吸收新增违规。基线指纹条目数若发生正向增长，CI 将直接判定为恶意逃逸并一票否决；
- 只有当针对存量债务进行了实质性重构清偿后，方可在 PR 中附带收缩后的基线文件提交。

### 3. 严格行内豁免注释规约 (Inline Allowance Contract)

静态扫描若遇到因特殊底层需求（如 InspectionPod 预览 iframe 必须保持白纸底、网关错误码英文字符串映射）产生的假阳性，**严禁修改规则文件放宽规则**，必须在**违规行紧邻的上一行**显式标注合规豁免注释：
- 架构规则豁免：`// gate-arch-allow: 阐明为什么必须使用该桥接/特异语法的具体原因`
- 换肤规则豁免：`// gate-theme-allow: 阐明该色值为什么属于非主题面（如文档预览、系统原生按钮）的具体原因`
- 国际化豁免：`// gate-i18n-allow: 阐明该中文字符串为什么不属于用户界面呈现文案的具体原因`
- 性能规则豁免：`// gate-perf-allow: 阐明该动效为什么必须保持独立的具体原因`

*注：豁免注释与违规行之间严禁插入空行；Subagent 审查时必须逐条核实豁免理由，无正当理由滥用豁免直接打回。*

---

## 十二、Agent 自主闭环开发与强制双审 SOP (Agent Autonomous Execution & Review SOP)

本项目由 Agent 自主推进工程落地。任何 Agent 在执行修改任务时，**必须无条件执行以下四阶段标准化作业管道，严禁跳步自行交付**：

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                         Hermes Flux Agent 标准作业管道 (SOP)                              │
├──────────────────┬──────────────────┬──────────────────────────┬─────────────────────────┤
│ 1. 范围与规范确认 │ 2. 原子编码与注释 │ 3. 确定性机器自检        │ 4. 委派 Subagent 双审   │
│ (Scope & Spec)   │ (Implementation) │ (Verification)           │ (Independent Review)    │
│ 锁定风险与设计文档│ 补齐三要素中文注释│ npm run verify (100%绿)  │ 样式审/代码审 (Binding) │
└──────────────────┴──────────────────┴──────────────────────────┴─────────────────────────┘
```

### 1. 第一步：范围判定与规范核准
- 检查本次改动是否触碰以下敏感边界：
  - **样式敏感面**：`packages/ui/src/components/**`、`packages/ui/src/tokens/**`、`packages/desktop/src/renderer/**`、任何 `.css`/`.scss`；
  - **代码逻辑面**：Monorepo 内任何 `.ts`、`.mjs` 源码；
- 动手改代码前，必须先读本目录对应设计文档（`docs/design-system/` 或 `docs/architecture/`）。

### 2. 第二步：原子实现与必须注释
- 遵循最小完整变更，禁止顺手重构无关代码；
- 所有关键代码必须包含**三要素中文注释**：
  1. **设计意图 (Why)**：为什么这么设计；
  2. **防范的历史坑 (Pitfall)**：规避了历史上什么具体失败模式；
  3. **约束与规则 (Rules)**：不可破坏的状态机或分层不变量。

### 3. 第三步：确定性机器自检
代码修改完成后，主 Agent **必须亲自按顺序运行并通过以下检查**：
```bash
npm run gates:changed    # 静态门禁断言：新增违规数必须为 0
npm run typecheck        # 静态类型断言：0 错误
npm test                 # 单测回归断言：100% 通过
```

### 4. 第四步：强制 Subagent 独立双审（一票否决硬红线）

**主 Agent 绝对禁止自我认证（No Self-Certification）**。自检通过后，主 Agent 必须根据改动面发起对应的 Subagent 审查：

1. **若改动触碰样式敏感面 ➔ 强制委派 `flux-style-reviewer`**：
   - **委派指令**：调用 `subagent` 工具，`agent: "flux-style-reviewer"`，传入改动文件清单与背景；
   - **审查维度**：
     - ① 换肤 Token 完整性（零硬编码色相，中性黑白遮罩除外）；
     - ② i18n 双字典同步与零内联三元；
     - ③ 渲染性能红线（无休止动画、平滑滚动、估算高度、Intl 污染）；
     - ④ 几何规范约束（740px 限宽、410px 检查舱）；
   - **裁决契约**：结论为 `FAIL` 时，主 Agent 必须针对指出项进行定点修复，严禁强行交付。

2. **若改动触碰代码逻辑面 ➔ 强制委派 `flux-code-reviewer`**：
   - **委派指令**：调用 `subagent` 工具，`agent: "flux-code-reviewer"`，传入改动背景与 Git Diff；
   - **审查维度**：
     - ① 架构分层（Core 零 DOM/UI、UI 零 Desktop、零裸 fetch）；
     - ② 类型真实性（零新增 `as any`，断言必带 `// SAFETY:`）；
     - ③ 状态正确性（网络失败严禁伪装为空、判别联合状态机）；
     - ④ **测试有效性变异检验（把生产代码改错，测试必须变红；测试依然绿灯判定假测试一票否决）**；
   - **裁决契约**：结论为 `FAIL` 时，必须修复所有阻塞项并重新过审。

3. **遇到阻断修复 ➔ 委派 `flux-gate-fixer`**：
   - 仅用于定点修复门禁阻断项，遵循最小改动原则，严禁借修复之名做重构或放宽规则。

4. **双审全部判定 `PASS` ➔ 方可向用户汇报或提交代码**。

---

## 十三、常见门禁报错排查速查表 (Gate Troubleshooting Cheatsheet)

| 门禁报错标识 | 根本原因 | 标准修复方案 | 严禁采用的糊弄手段 |
|---|---|---|---|
| `theme/no-hardcoded-color` | 组件模板或内联样式中包含带色相的 `#hex` / `rgb()` | 替换为语义匹配的 `var(--accent)`、`var(--bg-card)` 等 Token | 改写为带 alpha 的中性色掩盖、或胡乱使用 `--accent` 冒充警告色 |
| `i18n/no-hardcoded-text` | 组件中存在裸写的中文字面量，或使用内联三元伪翻译 | 在 `zhDict` 与 `enDict` 同步登记键值，代码中改写为 `t('key')` | 将中文写进模板变量、或用 `gate-i18n-allow` 强行放行 |
| `arch/type-escape` | 出现了 `as any`、`as unknown as T` 或 `payload: any` | 定义具体的 Interface / Type，复杂状态使用 Discriminated Union | 声明别名为 `any` 的临时类型进行隐式逃逸 |
| `arch/no-bare-transport` | 渲染层或组件层直接调用了原生 `fetch(` 或 `new WebSocket(` | 经由 `HermesGatewayClient` 或 PAL 平台抽象桥接通信 | 在局部手写 Node `http.request` 绕开检测 |
| `perf/infinite-animation` | 出现了未受控的 CSS `animation: ... infinite` 持续占用 Compositor | 接入应用全局 `useDurationTicker` 时钟，并在面板折叠时注销监听 | 伪造超长固定秒数动画（如 `animation-iteration-count: 99999`） |
| `layout/input-dock-width` | 输入舱样式移除了 `max-width: 740px` | 恢复 740px 黄金限宽约束，保持中央工作流居中聚焦 | 使用动态 JS 算宽度绕过静态规则 |

---

## 十四、长会话（5000+条）极端性能保障与模拟测试铁律 (Long-Session Performance & Simulation SOP)

长会话（5000+ 条对话、20MB+ 文本、大量代码块与深度思考链）是 AI 桌面终端最容易发生**内存雪崩、主线程冻结与视口剧烈抖动**的重灾区。任何涉及消息加载、渲染管道或滚动补偿的代码，**必须无条件执行本章规约，并通过确定性性能压测门禁**：

### 1. 长会话四大致命失败模式与底层避坑因果链 (Failure Modes & Pitfalls)

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 长会话极端性能瓶颈与防灾拓扑                                            │
├──────────────────────────┬──────────────────────────┬──────────────────────────┬────────────────────────┤
│ 1. 传输与反序列化饿死    │ 2. DOM 节点爆炸与排版黑洞│ 3. 滚动锚定与高度漂移    │ 4. 异步资源与定时器泄漏│
│ (Serialization Wall)     │ (DOM Tree Thrashing)     │ (Scroll Drift / Jumping) │ (Resource Leaks)       │
│ 50MB JSON 阻塞事件循环   │ 250,000 节点致 GPU 崩溃  │ 触顶加载上页视口剧烈抽搐 │ 历史消息挂载数百死循环 │
│ ➔ 采用 REST 分页切片拉取 │ ➔ 50 条 Initial Windowing│ ➔ 双帧 rAF 吸收排版漂移  │ ➔ 静态骨架化 + 统一时钟│
└──────────────────────────┴──────────────────────────┴──────────────────────────┴────────────────────────┘
```

1. **传输反序列化饿死 (Event Loop Starvation)**：
   - **痛点**：5000 条全量历史通过单一 WebSocket 推送，V8 主线程在执行巨型 `JSON.parse` 时会发生持续 300ms~1500ms 的长任务阻塞（Long Task），期间应用完全无响应；
   - **防御不变量**：**严禁在会话激活时全量拉取 5000 条消息**！必须走 REST 快速分页：冷启动仅拉取最新 50 条（`<50ms` 返回），剩余历史存入服务端与本地缓存队列，由用户触顶触发。
2. **DOM 节点爆炸与排版黑洞 (DOM & Style Recalculation Explosion)**：
   - **痛点**：每条消息平均产生 30~50 个 DOM 节点（Markdown 块、GFM 表格、代码高亮、思考折叠轨、工具胶囊）。5000 条全量挂载将瞬间产生 150,000~250,000 个 DOM 节点，触发浏览器 GPU 进程崩溃（OOM / Aw, Snap!）；
   - **防御不变量**：**物理挂载严格锁定 Initial Window 50 条**！超出会话窗口的历史消息绝对禁止驻留 DOM 树，渲染耗时严格约束在 `15ms` 预算以内。
3. **滚动锚定与高度跳动漂移 (Scroll Anchoring & Momentum Drift)**：
   - **痛点**：当用户向上触顶加载前 30 条历史时，顶部注入新节点导致 `scrollHeight` 突变。若同步写入 `scrollTop`，因字体渲染度量（Font Metrics）与异步排版延迟，视口会剧烈抖动跳跃甚至归零，触发二次加载雪崩；
   - **防御不变量**：**必须执行双帧 `requestAnimationFrame` 吸收漂移**：
     - 首帧（Frame 1）：写入理论高度补偿 `nextScrollTop = prevScrollTop + (nextStream.scrollHeight - prevScrollHeight)`；
     - 次帧（Frame 2）：重新测量排版收敛后的微小残余偏差 `drift = settledAdded - addedHeight`，当 `|drift| >= 1px` 时进行微像素校准，校准完成后方可释放 `isLoadingOlder = false` 互斥锁。
4. **历史工具调用定时器泄漏 (Runaway Timer Leak)**：
   - **痛点**：历史 5000 条消息中若存在未终结状态的工具调用，若每个组件实例创建独立的 `setInterval` 跑秒表，将产生数百个活跃定时器空转，CPU 持续占用 50%+；
   - **防御不变量**：历史消息工具胶囊**必须静态化**，严禁挂载独立定时器；全局运行指示必须接入集中时钟 `useDurationTicker`。

---

### 2. 确定性模拟测试 SOP (Deterministic 5000-Message Simulation SOP)

测试长会话性能严禁依赖手动制造测试账号。必须通过自动化脚本生成**绝对可重复、无噪音抖动、覆盖正交业务场景的合成数据集**：

1. **确定性合成数据分布矩阵 (Synthetic Distribution Matrix)**：
   - **40% 普通交互短文本**（模拟日常问答与命令下达）；
   - **25% 复杂 Markdown**（包含超长无序/有序列表、任务清单、多列 GFM 复杂表格）；
   - **15% 多语言代码块**（覆盖 Python / TypeScript / Rust / Logcat，50~200 行真实源码）；
   - **10% 深度推理思考链**（Thought Chain，数百字折叠思考过程）；
   - **10% 工具调用与多工具聚合胶囊**（Shell 命令、读写文件、Diff 片段）。
2. **模拟测试执行命令**：
   ```bash
   # 执行 5000 条长会话性能预算压测门禁
   npm run test:perf
   ```

---

### 3. 长会话性能预算硬红线表 (Performance Budget Redlines)

任何涉及会话流、渲染器、Markdown 引擎或分页逻辑的代码修改，必须通过以下指标断言，**超标任何一项直接一票否决**：

| 性能度量维度 | 指标与采样方式 | 硬预算红线 (Budget Limit) | 违规判定与处置措施 |
|---|---|---|---|
| **5000 条内存驻留** | 5000 条实体反序列化后的 V8 Heap 增量 | **$\le 40\text{MB}$** | 超标代表数据模型存在字段冗余或无用闭包引用，阻断合入 |
| **首屏窗口化渲染耗时** | 仅挂载最新 50 条消息的 HTML 生成耗时 | **$\le 15\text{ms}$** | 超标代表模板字符串拼接或正则过重，阻断合入 |
| **首屏物理节点隔离** | HTML 文本中必须含最新消息、严禁含超出窗口的早期消息 | **必须隔离早期 ID** | 发现第 1 条消息即代表窗口化失效（全量渲染），一票否决 |
| **触顶步进回补耗时** | 向上拼接 30 条切片并重新排版的平均耗时 | **$\le 25\text{ms}$ / 次** | 超标代表列表合并未解耦或引起全量重排，阻断合入 |
| **视口位移抖动残差** | 触顶加载前后视口锚定元素的物理位移差 | **$\le 1\text{px}$** | 发生肉眼可见跳跃，判定滚动补偿逻辑失效，阻断合入 |
| **常驻无休止定时器** | 历史长会话加载后活跃的自执行轮询器数量 | **严格为 0** | 出现定时器泄漏，判定为严重资源隐患，阻断合入 |

---

### 4. 性能守护门禁在 Agent 工作流中的集成

- **单测守护**：`packages/ui/__tests__/layout.test.mjs` 中的 `Gate 4e` 测试已原生集成 5000 条长会话性能基准，任何人在本地执行 `npm test` 或 `npm run verify` 时，该门禁均会自动运行并拦截超标改动；
- **CI 阻断**：GitHub Actions CI 流水线会在每次 PR 时自动运行 `test:perf`，超时或超预算直接红灯阻断合并。

---

## 十五、OpenChamber 进阶工程角色与代码极简治理 SOP (Code Simplification & Isolated Testing)

深度吸收 OpenChamber（12,000+ Stars）经过实战验证的防腐化工程体系，引入**代码极简治理**与**子进程测试绝对隔离**两大杀手锏：

### 1. 代码极简专员 `flux-simplifier` 的定位与介入时机

AI 生成的代码天然具备“过度工程化”的倾向（过度包装单次调用的 helper、多层嵌套条件、嵌套三元、大段复述语法的冗余注释）。
- **介入时机**：**在主 Agent 完成功能编写、提交门禁审查之前强制介入**；
- **核心定位**：做清晰度提升与冗余剔除，**100% 保持确定性可观测行为不变**；
- **命令入口**：`/flux-simplify [范围]` 或直接委派 `flux-simplifier` 子 Agent。

### 2. 极简代码治理五大准则 (Code Simplification Principles)

1. **消除过度抽象 (Anti-Premature-Abstraction)**：
   - 严禁为了“假想未来可能复用”而封装只被调用一次的薄包装函数；
   - 保持主流程线性自明，减少多层无意义的阅读跳转。
2. **守卫条件平铺 (Early Returns)**：
   - 强制使用 Guard Clauses 尽早 return 退出异常分支；
   - **代码缩进嵌套绝对禁止超过 3 层**。
3. **展开晦涩的嵌套三元**：
   - 严禁出现两层及以上的嵌套三元表达式（`a ? b ? c : d : e`），必须改写为小而自明的临时变量或 `if/else` 分支。
4. **注释去水分与暗坑提炼**：
   - 彻底删除单纯翻译语法的废话注释；
   - 必须保留并强化**阐明为什么这么写 (Why)、规避了什么具体失败模式 (Pitfall)、不可破坏的不变量 (Rules)** 的三要素中文注释。
5. **行为绝对保真 (Behavior Preservation)**：
   - 输入、输出、副作用、抛出的 Error 类型、微任务时序绝对不变；
   - **严禁修改任何测试断言来迁就代码简化**。

### 3. 子进程单测绝对隔离运行器 (`run-isolated-tests`)

UI 全局 Store、会话缓存与 IPC 桩在同一个 Node 进程中顺序执行必然发生内存单例泄漏，导致测试按加载顺序偶发挂死。
- **运行命令**：`npm run test:isolated`；
- **工程约束**：
  - 每个测试文件在全新 Node 子进程中独立拉起，彻底阻断跨文件污染；
  - 机器并发度锁死为 `4`，防打满 CPU 冻结机器；
  - 单文件 120 秒超时 SIGKILL 看门狗，杜绝死循环挂死 CI。

### 4. 维护者代理 PR Review 四阶天梯 (Maintainer-Proxy Verdict Ladder)

任何 Agent 在审查他人或外部 PR 时，必须以维护者代理的身份思考，从以下四阶天梯中**选择且仅选择一个明确裁决**：

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   维护者代理审查裁决四阶天梯 (Verdict Ladder)            │
├─────────────────┬──────────────────────────────────────────────────────┤
│ 1. DECLINE      │ 拒绝合入：过度工程化、偏好型重构、虚假前提。关闭但打捞痛点 │
├─────────────────┼──────────────────────────────────────────────────────┤
│ 2. PUSH-BACK    │ 打回修改：方向正确但未消除症状，提供有限可核验清单    │
├─────────────────┼──────────────────────────────────────────────────────┤
│ 3. MERGE-THEN-FIX│ 接管修复：症状已彻底根治，仅残存工作区专有风格需补齐 │
├─────────────────┼──────────────────────────────────────────────────────┤
│ 4. MERGE        │ 直接合入：零瑕疵，闭环证伪，门禁与单测 100% 绿灯      │
└─────────────────┴──────────────────────────────────────────────────────┘
```


