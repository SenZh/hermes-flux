# AGENTS.md - Hermes Aura 全平台美学工作台工程规范与质量门禁指南

本项目是 **Hermes Aura**（面向 Hermes Agent 全生态构建的旗舰级、全平台端到端极客美学工作台，覆盖 Desktop, Web, iOS, Android）的代码库根目录。

> **核心设计哲学**：
> 1. **美学即生产力（Aesthetic First）**：
>    - 彻底告别传统 AI 终端粗糙简陋的极客糙汉风；追求顶级电影级暗黑极简视觉、微距物理受光质感、细腻物理跟手动效与极致排版韵律。
> 2. **代码共享与架构解耦（Monorepo）**：
>    - `packages/core`：无界协议沉淀，承载 JSON-RPC 2.0 通信管道、5态 FSM、全抖动退避重连、流式 Token 合流引擎与平台抽象接口 (PAL)；
>    - `packages/ui`：纯 UI 表现层，承载全端共享的 React/DOM 组件、暗黑主题变量与状态机；
>    - `packages/desktop`、`packages/mobile`、`packages/web`：保持轻量壳容器包装。
> 3. **工程严谨与零假冒交付（Zero-Illusion Engineering）**：
>    - 核心业务逻辑必须有确定性单测覆盖，严禁循环自证伪测试与假类型降级。
> 4. **项目隔离铁律**：
>    - 本项目所有技术细节、架构设计、踩坑经验与流程规范仅沉淀在本目录内部，严禁污染中枢与全局。

---

## 一、工业级自动化质量门禁 (Quality Gates - 一票否决硬红线)

全工作区所有代码修改、功能新增与缺陷修复，在提交或合并前必须无条件通过以下 **5 大硬门禁**。任何一项未通过直接**一票否决**：

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│                   Hermes Aura Production Quality Gate Pipeline                   │
├─────────────────┬──────────────────┬─────────────────┬─────────────────┬─────────┤
│  Gate 1: TYPE   │  Gate 2: TEST    │  Gate 3: INVAR  │  Gate 4: ACCESS │ Gate 5: │
│  全栈严格类型   │  反 AI 假测试    │  正确性不变量   │  物理入口可达   │ CI 回归 │
│ (tsc --noEmit)  │ (真实DI/零Mock)  │ (Failure!=Empty)│ (Tokens强一致)  │ (100%绿)│
└─────────────────┴──────────────────┴─────────────────┴─────────────────┴─────────┘
```

| 门禁代号 | 门禁名称 | 审查标准与执行命令 | 违规一票否决典型场景 |
|---|---|---|---|
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
4. **明确状态演变 (State Diff)**：涉及状态机、并发、长连接时，明确流转前后的精确状态转移。

### 3. 阶段三：验证、审查与落盘 (Verification & Commit)
1. **本地全量 CI 必须全绿**：本地终端无条件执行并通过 `npm run typecheck && npm test && npm run build`；
2. **落盘前 5 关自检**：
   - ① **编译关**：全包 TypeScript 静态编译 0 报错；
   - ② **测试关**：单测 100% 通过，新增逻辑具备确定性反向证伪用例；
   - ③ **规范关**：完全符合设计系统（Token）与跨端隔离规范；
   - ④ **代码质量关**：无调试日志残留、无死代码、无未捕获 Promise rejection；
   - ⑤ **环境纯净关**：无多余临时文件或测试抓包入库。
3. **双审闭环**：自检完成后，通过独立 Subagent 执行代码 Review，确认零缺陷方可合并交付。

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
