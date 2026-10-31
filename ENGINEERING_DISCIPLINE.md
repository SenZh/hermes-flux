# Hermes Aura 核心工程铁律包 (Ironclad Engineering Discipline)

本铁律包深度吸收并融合了 OpenChamber 全套经过 12,000+ Stars 验证的工业级工程防御体系，是 Hermes Aura（全平台极客美学工作台：Desktop / Web / iOS / Android / VS Code）的最高技术与自动化测试准则，全工作区强制生效，拥有**一票否决权**。

---

## 零、最高元原则 (First Principles)

1. **最小完整变更 (Smallest Complete Change)**：
   每次代码修改必须聚焦于当前问题的完整闭环，在覆盖真实风险的最窄层级验证，严禁借修复之名进行投机性重构或无依据的泛化封装。
2. **零假冒交付 (Zero-Illusion Delivery)**：
   CI 绿灯与 TypeScript 静态推断不代表运行时有效。凡涉及用户可达界面的修改，必须具有**物理入口可达性证明**与**真实运行依据**。
3. **权威优先与防假空 (Authority & Explicit Failure)**：
   实时长连接通道高于持久化历史记录；网络/服务故障绝不可伪装为成功空数据。
4. **反 AI 糊弄增量棘轮 (Anti-Slop Ratchet)**：
   代码必须反映已知真实类型，严禁通过断言降级（`as any`、`as unknown as T`）或全量 Mock 抹杀真实错误。以 `merge-base` 为基准，新增违规数严格为零。
5. **维护者成本函数约束 (Maintainer Cost Function)**：
   审查与设计决策的终极标尺：“接受这项变更，会让维护者在未来一年付出什么维护成本？” 凡无法在心智模型中长久维护的代码，即便测试通过亦必须拒绝。

---

## 一、事前预防军规 (Pre-Flight Ironclad Defenses)

### 1. PR 规模量化分类与讨论停机坪 (PR Sizing & Parking Gate)
* **有效代码行数计算排除法则**：
  计算变更规模时，必须通过 pathspec 显式排除不消耗架构审查精力的噪音文件：
  `**/__tests__/**`、`**/test/**`、`**/tests/**`、`**/*.test.*`、`**/*.spec.*`、`**/*.snap`、`**/bun.lock`、`**/package-lock.json`、`**/pnpm-lock.yaml`、国际化多语言翻译字典（`packages/ui/src/lib/i18n/messages/**`）。
* **六级分类阶梯**：
  - `size:XS`：有效变更行数 $< 10$ 行；
  - `size:S`：$10 \sim 29$ 行；
  - `size:M`：$30 \sim 99$ 行；
  - `size:L`：$100 \sim 499$ 行；
  - `size:XL`：$500 \sim 999$ 行；
  - `size:XXL`：$1,000+$ 行。
* **停机坪自动挂起机制 (Needs-Discussion Parking)**：
  非核心 Collaborator 提交的 `size:XL` 或 `size:XXL` PR，若 PR 描述中未携带已批准的架构讨论链接（匹配 `github.com/.../discussions/\d+`），CI 自动标记 `needs-discussion` 并挂起审查。任何大型变更必须“先文字协商定性，后代码落地实现”，禁止直接提交巨型既成事实代码迫使维护者审阅。

### 2. 仓库资产证据零污染红线 (Repository Evidence Hygiene)
* **禁止测试证据提交入库**：
  单测/端到端测试录屏、CDP 性能抓包 Trace、内存堆快照（Heap Snapshot）、截图（PNG/WebP）、复现请求日志等证据文件，**绝对禁止**提交进 Git 仓库（如 `evidence/`、`pr-evidence/`）；
* 一旦提交入库，二进制大对象将永久污染全量 clone 历史。所有验证证据必须上传至 PR issue 评论或描述中通过 CDN 托管，保持 Git 树轻量纯粹。

### 3. 依赖变更、锁文件与 Workspace 镜像强契约 (Lockfile & Workspace Mirroring Contract)
* **CI 冻结安装硬规则**：
  CI、发布构建与隔离测试运行必须严格使用 `bun install --frozen-lockfile`。
* **版本级联与 Workspace 锁文件重解析**：
  修改 Monorepo 内部包版本或升级依赖时，必须执行 `bun install --lockfile-only --ignore-scripts` 刷新 `bun.lock`。Bun 在打包 `workspace:*` 跨包依赖时按 lockfile 锁定的版本号打包，若仅更新 package.json 而不刷新 lockfile，会导致发布归档携带过时的依赖版本。
* **Renovate 与多分支锁冲突协议**：
  若多个依赖更新 PR 导致 `bun.lock` 冲突，禁止盲目在本地手动 resolve 并强制推送。必须遵循“单流顺序合入”，逐个通过 PR body 中的 rebase checkbox 由机器干净重推。
* **Dockerfile Workspace 镜像强同步**：
  在 `packages/*` 中新增、重命名或删除任何 Workspace 时，**必须立即同步修改 Dockerfile `deps` 阶段**中显式命名的包清单，并本地执行 `docker build .` 验证。若 Dockerfile 遗漏该包，`COPY` 失败或依赖该内部包的子包将在 `frozen-lockfile` 构建时直接炸裂，而通用 CI 并不会默认构建 Docker 镜像。

### 4. 变更前跨端 Surface 显式声明契约 (Name The Surfaces Before Editing)
在编写任何触碰用户可达逻辑的代码前，必须在 PR 描述和设计审查中显式写出 5 端 Surface Matrix 表格：
| 端目标 (Runtime) | 该端预期发生的变化与适配方案 |
|---|---|
| **Web** | 明确是具备完整功能还是服务端降级 |
| **Electron Desktop** | 明确 IPC 权限边界、本地端口交互与系统托盘/窗口行为 |
| **VS Code Extension** | 明确 WebView 挂载范围（如仅挂载子集）与无独立 Server 时的降级 |
| **Hosted Mobile** | 明确触控手势、虚拟键盘 Avoidance 与视口适配 |
| **Capacitor Mobile** | 明确 Native Bridge、后台暂停与物理安全区避让 |

*注：每端必须有一行陈述。“Not applicable (不适用)”是合规的一行；“沉默不提”是一票否决的违规。稳定的不支持降级是合法结果，意外漏掉导致的 Crash 是严重事故。*

### 5. 变更风险五级分类与所有权划分 (Risk Classification)
动手写代码前，必须将本次改动按以下 5 级分类对齐所有权与验证范围：
1. **Local implementation (包内私有改动)**：单包私有组件/Helper。保持可观测行为，仅需运行本包聚焦单测；
2. **Module contract (模块导出契约)**：修改导出的 API/Type/Invariant。检查所有调用方，更新模块 `DOCUMENTATION.md`；
3. **Cross-workspace contract (跨包共享契约)**：涉及 UI 与 Desktop/Mobile/Core 之间的共享类型与通信契约。自顶向下追踪所有物理消费端，必须全工作区 `type-check` 与跨端 Parity 校验；
4. **Persisted / External format (持久化与外部行为)**：SQLite Schema、MMKV 键、JSON 配置、CLI 格式。必须编写缺失值 vs 空数据、版本迁移、乱序写入与回滚测试；
5. **Platform / Native runtime (平台运行时特异行为)**：涉及 Electron Preload、Native Bridge、输入法交互。静态检查无效，必须提供真实 Runtime 物理运行证明。

---

## 二、事中护栏军规 (In-Flight Correctness & Platform Traps)

### 1. 权威状态、通道隔离与慢响应防复活 (Authority & Anti-Resurrection Tombstones)
* **实时与历史解耦**：当前 Agent 会话的活跃度、思维链展开、执行锁状态，**必须**仅由实时通道（WebSocket / 本地 RPC 内存状态）派生；持久化存储仅用于冷启动上下文恢复，严禁从持久化记录反推任务正在执行。
* **单调递增版本号与 CAS 写入 (Compare-And-Swap)**：
  任何向本地或远程提交的实体变更，必须携带版本号或变更指纹。检测到陈旧版本必须主动报告冲突（409 Conflict），禁止静默覆盖。
* **慢响应复活已删除实体防线 (In-Flight Mutation Tombstone Guard)**：
  当执行删除操作时，即使实体在内存中已完全消失，也必须在本地状态机中记录一个带有单调时间戳/Mutation Revision 的**逻辑删除墓碑（Tombstone）**。当之前发出的较早慢速查询请求迟滞返回全量列表时，校验其版本早于删除墓碑，**严禁慢响应将已被用户删除的实体重新复活挂回界面**。

### 2. 严禁失败伪装为空与判别联合契约 (Failure Is Not Empty & Discriminated Unions)
* **API 与 SDK 边界防御**：
  严禁在数据获取层使用 `catch { return []; }` 或 `catch { return {}; }`。
  - 外层具有完整事务回滚机制时，必须显式 `throw error`；
  - 需向下传递时，必须返回 `T | null`，严格保留 `null` 代表“加载失败”，空数组 `[]` 仅代表“权威端确认无数据”。
* **快照比对删除门禁 (Snapshot Diff Guard)**：
  通过比对新旧快照剔除本地已删除实体时，**必须**证明本次快照是一次成功且完整的全量权威拉取。启动初期、过滤视图、或发生部分失败的读取，绝对禁止触发删除逻辑。
* **状态互斥与判别联合契约 (Discriminated Unions)**：
  严禁使用多个可空或布尔字段组合（如 `{ isLoading: boolean, isError: boolean, data?: T }`）表达排他生命周期状态。必须使用精确的判别联合（Discriminated Union，如 `{ status: 'idle' } | { status: 'loading' } | { status: 'success', data: T } | { status: 'error', error: Error }`），使非法状态在类型系统中不可表达。

### 3. 单实体失败隔离与队列配置不可变冻结 (Single-Entity Isolation & Queue Freezing)
* 在多 Agent、多会话并发加载时，单个实体的请求失败不得清除已成功实体的状态；响应体中必须分离 `items: [...]` 与 `incompleteEntityIds: [...]`。
* **消息队列入队配置即时冻结 (Queue Configuration Immutability)**：
  当用户把消息加入待发送队列时，必须在入队瞬间完整快照捕获其 Provider、Model、Agent、Thinking Variant 及挂载工具上下文。严禁在队列消息稍后实际出队发送时，从当前界面已变化的可变状态中重新推断配置，避免“指鹿为马”。

### 4. 活跃资源软上限与防惊群淘汰 (Never Evict In-Use)
* 在 React 组件挂载或渲染执行流中，常规状态下绝对禁止在资源获取函数内同步触发 LRU 淘汰与销毁；
* 缓存超限允许短期软溢出，常规资源回收必须调度至空闲帧（Idle Phase）处理，严禁引发“销毁 -> 重新挂载 -> 再次拉取”的死循环。

### 5. 跨端 CSS 物理视口与 WebKit 键盘动效编排避坑铁律 (Cross-Platform Viewport & Keyboard Choreography)
* **WebKit 滚动容器禁用 CSS Transform**：
  绝对禁止对聊天长列表容器（如 `.chat-scroll`）及其直接内容应用任何 CSS `transform`。WebKit 会丢弃并重建 GPU 合成滚动层，导致长列表在软键盘弹出时发生长达数秒的严重死锁卡死（multi-second stall）。必须保持滚动容器具有固定的 `clientHeight`，通过底部安全区与动态内边距实现视口避让：`max(--oc-kb-layout - --oc-app-bottom-safe, 0)` 配合 `padding-bottom: --oc-kb-scroll-inset`。
* **CSS 自定义属性继承爆炸防护 (Inherited Property Restyle Explosion)**：
  绝对禁止在 `<html>`、`<body>` 或聊天栏等高层容器上频繁写入高频更新的动态 CSS 变量（如 `--scroll-shadow-*`、`--chat-composer-inset`、标题栏宽度）。高层祖先的样式更新会强制级联触发全文档 50,000+ 节点的 Style Recalculation（单次 45-100ms）！高频动态变量必须通过专门的 DOM 注入器直接写入实际消费该变量的叶子节点，或通过 `@property ... { inherits: false }` 显式切断继承树。
* **iOS 动量滚动对抗 (Defeating Momentum Fling)**：
  在 iOS WebKit 处于快速滑动惯性减速状态（Momentum Fling）时，任何通过 JavaScript 同步写入 `scrollTop` 的操作都会被浏览器静默丢弃！必须通过短暂切换 `overflow: hidden` 物理杀死惯性滑动，随后写入目标 `scrollTop`，并连续维持约 20 帧的状态锁定（`setScrollTopDefeatingMomentum`）。
* **软键盘弹出 DOM 切换与焦点时序 (Keyboard Choreography Timing)**：
  绝对禁止在同一个宏任务中同步切换输入框 DOM 结构并调用 `element.focus()`！WKWebView 在 `focus()` 触发软键盘过渡动画期间会停止帧渲染，导致同一帧内的 DOM 变化完全不可见。必须使用 `flushSync()` 先提交 DOM 结构变更，在下一帧 `requestAnimationFrame` 中调用 `focus()`，并在键盘移动期间隐藏光标（`.oc-kb-caret-hold`）防止光标乱跳。
* **全视口矩阵与折叠屏旋转自愈回归**：
  涉及移动端与响应式布局的改动，必须通过 CDP 模拟全套视口矩阵回归：`['before', 'keyboard-open', 'keyboard-closed', 'folded-phone', 'phone-keyboard', 'unfolded', 'rotated', 'landscape-keyboard']`，断言富文本编辑器 DOM 实例未被意外重建（`sameEditor`），且未保存的草稿零丢失。

### 6. 集中式动画时钟与隐形 Compositor 开销防护 (Centralized Duration Ticker)
* **无休止 CSS 动画隐形开销**：
  CSS `infinite` 动画（包含 `steps()` 步进动画）会让操作系统合成器与 GPU 进程每秒持续以 60fps 强行绘制，即便 JS 主线程空闲也会产生高达 15%~66% 的单核 CPU 功耗和发热。
* **单一全局时钟驱动**：
  应用内所有状态指示器、加载 Spinner、闪烁光标必须由单一全局时钟 Hook（如 `useDurationTicker`）统一脉冲驱动（Spinner 4Hz、点状/呼吸 1Hz、分钟级计数器 60s）。
* **非视口与非激活即刻停表**：
  当面板折叠、元素处于 `inert`、Tab 切至后台或元素处于 `opacity: 0` 时，必须立即注销时钟监听，停用所有重绘操作。

### 7. 网络半开防御与主动心跳看门狗 (Half-Open Watchdog & Circuit Breaker)
* 严禁依赖操作系统级 TCP KeepAlive；长连接（WebSocket / RPC）必须维护应用层心跳（Ping/Pong），探测窗口设为 `2 * RTT + Jitter`（默认 5s 无响应即标记为 Half-Open 疑似）；
* 一旦判定 Half-Open，看门狗必须主动调用底层 `socket.destroy()` 强制释放本地句柄，触发断路器进入 `OPEN` 状态；
* 半开恢复后重试未 ACK 的变更请求时，必须携带唯一的 `Idempotency-Key` 与事务租期版本（Lease Epoch），杜绝服务端重复执行或状态脑裂。

### 8. 移动端与系统级 OOM 紧急信号同步排空 (OOM Emergency Eviction Protocol)
* **突破空闲帧的紧急同步例外**：当捕获操作系统级低内存警告（iOS `didReceiveMemoryWarning`、Android `TRIM_MEMORY_RUNNING_CRITICAL`、Desktop `render-process-gone`）时，**绝对禁止**等待空闲帧，必须立刻触发**同步阻塞级紧急排空**；
* **三级梯队降级与骨架化收缩**：
  1. **L1 离线与非视口丢弃**：清空所有后台会话快照、非可视路由虚拟 DOM 缓存、已完成 Agent 的历史折叠思维链；
  2. **视口内实体资产骨架化 (Skeletonization)**：前台正在渲染的活跃实体不得销毁 DOM 节点，但必须同步卸载高清图片解码缓冲区、音频波形 Buffer、富文本语法高亮 AST，原地降级为矢量占位符或纯文本骨架；
  3. **原子紧急落盘与恢复锚点**：对未刷盘的 Dirty State 执行微秒级 MMKV 原子写入，写入崩溃自愈恢复标记，确保进程若遭极端强杀亦可在重启时无损冷恢复。

---

## 三、事后测试与自动化验证铁律 (Post-Flight Testing & Verification)

### 1. 测试进程绝对隔离、超时硬杀与缓冲区截断 (`run-isolated-tests` Watchdog)
* **单文件独立子进程运行**：
  Zustand 全局单例、IPC 模拟桩、HTTP 拦截器在同一个 Node/Bun 进程中运行必然产生模块级单例污染，导致用例依赖加载次序。核心测试集必须由独立 Runner 拉起，每个测试文件在全新子进程中执行。
* **机器并发软上限**：
  测试运行器并发度严格锁定为 `MAX_PARALLEL = 4`，防止瞬时并发打满内存导致机器冻结。
* **双阶段超时硬杀看门狗 (SIGKILL + Pipe Cleanup)**：
  单文件设置严格的 5 分钟硬超时（`FILE_TIMEOUT_MS = 300,000`）。超时触发时直接发送 `SIGKILL`；同时**必须主动显式调用 `child.stdout.destroy()` 与 `child.stderr.destroy()`**。若测试启动的残留孙子进程保持管道打开，仅 kill 主进程会导致 runner 永久无法收到 `close` 事件而卡死。
* **V8 缓冲区环形截断保护 (Tail Truncation)**：
  若测试代码陷入死循环持续输出日志，输出缓冲区会突破 V8 字符串上限导致 Runner 抛出 `RangeError` 崩溃。Runner 必须使用环形缓冲区仅保留尾部 1MB 数据（`OUTPUT_TAIL_BYTES = 1024 * 1024`），丢弃头部溢出数据并打印丢弃字节数。

### 2. 绝对禁止模块假 Mock 与运行时原型劫持 (`no-module-mocking & no-prototype-tampering`)
* **禁止整体劫持**：单测中禁止使用 `vi.mock()` / `jest.mock()` 整体劫持模块；
* **禁止 Monkey-Patching 绕过**：禁止在测试用例内对 `globalThis.*`、`window.*`、第三方库导出对象或类原型链（`*.prototype.*`）执行重新赋值与全局劫持；
* 依赖项必须通过构造参数、依赖注入（DI）或显式接口缝隙传入，单测必须基于真实接口编写。禁止手写 Dummy Helper 测试 Dummy Helper 自欺欺人。

### 3. 15 条增量 AST 防 AI 劣态代码棘轮门禁 (Oxlint Anti-Slop Merge-Base Ratchet)
在 `check:changed` 门禁中，必须以 `git merge-base HEAD origin/main` 为基准计算触碰文件的违规增量。**历史遗留违规允许存在，但本次 PR 引入的新增违规数严格为 0**。必须通过 AST 探针物理执行以下 15 条铁律：
1. `anti-slop/no-chained-type-assertions`：严禁 `(x as any as Y)` 或 `(x as unknown as Y)`；
2. `anti-slop/no-conditional-empty-object-spread`：严禁 `...(cond ? { a } : {})`；
3. `anti-slop/no-known-value-widening`：严禁将已知明确类型拓宽为 `any`、`unknown`、`Record<string, any>`；
4. `anti-slop/no-module-mocking`：严禁全局拦截测试模块；
5. `anti-slop/no-object-parameters`：严禁使用宽泛的 `object` 参数类型；
6. `anti-slop/no-reflect-apply`：严禁使用 `Reflect.apply` 绕过类型系统调用；
7. `anti-slop/no-reflect-get`：严禁使用 `Reflect.get` 逃避字段类型约束；
8. `anti-slop/no-runtime-typeof`：严禁在具有确切 TS 声明的地方使用脆弱的运行时 `typeof x === 'object'` 探测；
9. `anti-slop/no-shape-in-symbol-names`：严禁变量命名包含形态污称（如 `dataObj`、`resArrList`）；
10. `anti-slop/no-unknown-parameters`：严禁未经校验直接传入 `unknown` 参数；
11. `anti-slop/no-unknown-returns`：严禁返回 `unknown` 破坏下游推断；
12. `anti-slop/no-unknown-type-aliases`：严禁声明别名为 `unknown` 的类型；
13. `anti-slop/no-unsafe-dictionary-type`：严禁滥用不安全的松散字典类型；
14. `anti-slop/no-widen-then-assert`：严禁先泛化再强转（Widen-then-assert）；
15. `anti-slop/require-safety-comment-for-type-assertion`：任何不可避免的类型断言必须在上一行附带强契约证据注释（`// SAFETY: [narrowed-by|invariant] ...`）。

### 4. 变异测试硬门禁 (Stryker Mutation Testing Ratchet)
* **禁止无效测试**：严禁提交包含字面量恒等断言（如 `expect(true).toBe(true)`）或仅执行代码无有效断言的“空测试”刷覆盖率；
* **变异得分物理门禁**：核心状态与通信包必须跑通 Stryker 变异测试，突变体得分（Mutation Score）必须 $\ge 85\%$，存活突变体（Surviving Mutants）严格为 0；出现变异体逃逸直接阻断 CI。

### 5. 真实物理渲染与性能探针避坑法则 (CDP Probe & Positive Controls)
* **环境降频排除证明 (Prove Not Throttled)**：
  Chrome 会对后台或被遮挡（Occluded）的窗口自动停止产出帧并降频定时器。性能度量命令必须启动时传参显式关闭 background/occlusion throttling，并度量捕获期间的帧存活性。
* **证明 0 是有效度量而非探针失效 (Positive Control)**：
  测量结果显示 0 帧掉落或 0ms 往往是因为探针根本未触发（如缺少指定标志或目录）。在下结论前，必须注入正向对照扰动（如故意注入 60px 位移测试），确认探针确实在线并能抓到异常。
* **Headless 模拟 GPU 陷阱**：
  Headless Chrome 在无真实显示器时使用纯 CPU 软件模拟 GPU 栅格化，在蒙版与图层滤镜测试中 Headless 可能汇报 39% 虚假提升，而在真实 GPU 上为 0。凡涉及 GPU 合成、透明度、图层重排的性能宣称，必须提供在真实 Headed 硬件环境下的测试数据。
* **内存泄漏判定**：
  内存泄漏检测必须基于采样点的**最小二乘法斜率（Least-squares slope）**，计算真实的持续增长率（`growthPerSecond`），严格过滤 GC 锯齿干扰。

### 6. 跨端 Parity 等价性断言
* 多端（Web ↔ Desktop ↔ Mobile ↔ VS Code）共享逻辑必须编写 Parity 测试，直接将各端输出做 `assert.deepEqual` 断言，确保行为绝对一致。

### 7. 全量真实网关 RPC 自动化联调与物理契约门禁 (Live Gateway RPC Integration Mandate)
* **严禁纯 Mock 自证与假数据降级**：
  凡新增或修改 `packages/core` 中与 Hermes Gateway 通信的基础组件、接口抽象或服务层，**绝对禁止**仅靠单元测试内部的 fake mock 对象蒙混过关。
* **真实子进程物理通信**：
  必须建立真实的端到端集成测试（如 `packages/core/__tests__/rpc/live-gateway-real.test.mjs`），使用 `child_process.spawn` 真实启动本地 Python Gateway（`tui_gateway/entry.py`），通过 `stdin`/`stdout` JSON-RPC 2.0 管道进行真实进程级通信。
* **100% 接口覆盖与 Pydantic 契约排他性断言**：
  涉及的公开 RPC 方法必须全量覆盖（包括专职 Bot 调度、项目工程文件树、多智能体群聊、代码时光机快照、子代理委派控制与会话接力），严禁传未声明的冗余字段（严防服务端 `code 4000: Extra inputs are not permitted` 拦截），并穷尽正向、边界与真实业务守卫错误码（如 `4000` 格式非法、`4001` 会话未激活、`4008` 空会话分支拦截、`4123` 执行器未拉起、`5032` 未配置模型提供商、`5063` 项目路径归属冲突）。
* **全生命周期清理守护**：
  测试套件必须在 `t.after()` 钩子中强制退出并清理 Python 子进程树，释放底层端口与 SQLite 事务锁，严防僵尸进程与句柄泄漏。

### 8. 真实无头浏览器 CDP 物理交互与几何验证门禁 (Headless Browser CDP Physical Verification)
* **真实 Blink 物理渲染引擎驱动**：
  凡新增或修改可复用 UI 表现层组件（如卡片、输入舱、独立对话框、弹窗浮层），在单测之外**必须编写并通过真实无头浏览器（Edge / Chrome）的 CDP 端到端物理测试**（如 `packages/desktop/__tests__/cdp/advanced-systems-cdp.test.mjs`），通过 CDP 协议指令驱动真实的物理 `click()`、输入框内容赋值与真实 DOM 增删，严禁在 HTML harness 内自造假函数。
* **移动端视口仿真与触控热区硬红线**：
  必须通过 CDP `Emulation.setDeviceMetricsOverride` 模拟 Pixel 8（390×844，DPR=3）移动端视口，物理测量可点击控件触控热区（严格断言 $\ge 44\text{pt} / 48\text{dp}$，双向 `offsetWidth >= 44 && offsetHeight >= 44`）；读取 `env(safe-area-inset-bottom)` 计算样式断言底部安全区避让（`computedPaddingBottom >= 12px`）；物理点击半透明背景遮罩（Overlay）断言弹窗完全销毁。
* **动态端口与跨平台临时环境隔离**：
  静态 HTTP 测试服务必须使用 `server.listen(0, '127.0.0.1')` 由操作系统内核动态分配空闲端口，严禁硬编码端口号引发冲突；浏览器缓存与用户数据目录必须使用 `os.tmpdir()` 动态生成隔离路径，严禁硬编码包含个人私有工号或特定机器路径；退出钩子必须发送 CDP `Browser.close` 安全退出进程解开 Windows 文件锁，严禁静默吞掉 `EBUSY / EPERM` 异常。

---

## 四、开发、审查与交付排障管道 (Pipeline & Delivery Protocol)

### 阶段 1：开发期聚焦验证与干净撤退 (Iterative Validation & Clean Abort)
1. **单文件聚焦迭代**：单文件修改调试时，只运行针对当前文件的单个测试。严禁在频繁变动的循环中执行全量 `type-check` 与 `build`（单次全量耗费超 1GB 内存，易导致机器假死）；
2. **遇阻干净撤退 (Aborting Cleanly)**：
   当发现陷入无法解决的类型死结、规范冲突或环境不满足时：
   - 立刻停止投机性修补；
   - 执行 `git checkout -- .` 和 `git clean -fd` 清空当前会话引入的临时修改；
   - 输出受阻的根本原因与尝试过的路径，保持工作区绝对干净。

### 阶段 2：维护者代理 PR Review 裁决协议 (Maintainer-Proxy Review Protocol)
审阅 PR 时必须以维护者代理的身份思考，从以下四阶天梯中**选择且仅选择一个明确裁决**：
1. **DECLINE (拒绝合入)**：
   - 理由：作者个人的小众偏好（Whim）、过度工程化、超出维护心智容量（Unmaintainable Scope）、虚假前提（假 Bug）、或未经 Ideas 讨论的大型产品决策；
   - 处置红线：**关闭 PR，但打捞真正痛点 (Salvage the Ache)**。若底层问题真实存在，在 Issue 跟踪器中检索或提炼出清晰的独立 Issue 追踪，礼貌而坚定地关闭当前 PR，严禁留一句“欢迎重新提交”的空话。
2. **PUSH-BACK (打回修改)**：
   - 理由：方向正确，但修改未彻底消除报错症状，或者残存代码依赖仅作者才知道的外部私有场景；
   - 处置红线：提供**有限且可逐项核验的清晰清单**，每项说明具体错因、后果以及完成的具体标准。清单完成后即应达到合入标准。
3. **MERGE-THEN-FIX (合入并接管修复)**：
   - 理由：PR 已经彻底修复了报错症状，但残余代码风格、多端 Parity 补齐或内部模块规范属于作者不了解的工作区专有知识；
   - 处置红线：由维护者通过 `triage-prs` 工作流直接在本地 Worktree 中补齐修复，**保全原作者署名提交（Author Credit）**，当天合入并消灭残留，严禁将技术债务长期悬挂。
4. **MERGE (直接合入)**：零瑕疵，单测与门禁全部绿灯，直接合入并向作者致谢。

* **"Needs your hands" 极窄门禁准则**：
  只有当人工核验直接阻断一次不可逆操作（如真实数据清空、自动升级重启流、核心鉴权变更）时，才允许向人类维护者提出手动检查请求。普通视觉或低风险变动严禁向维护者抛出模糊的“抽空帮我测一下”清单。

### 阶段 3：交付前强制门禁清单 (14 项全景 Check-List)

发起 PR 或完成最终交付前，必须逐条自检并提供客观依据：

| 门禁项 | 审查核心与执行指令 | 不合格红线 |
|---|---|---|
| **1. 增量类型与死代码** | `bun run type-check` + `bun run dead-code` (knip) | 存在未通过的 TS 类型报错、存在新增的 Knip 未使用符号 |
| **2. 15 条增量 AST 棘轮** | `bun run check:changed`（比对 `origin/main` 的 `merge-base`） | 触碰文件中任何一条 anti-slop AST 违规数量出现新增 |
| **3. 锁文件与依赖一致性** | 检查 `bun.lock` 是否在版本变更时执行了 `--lockfile-only` 刷新 | Dockerfile 遗漏 workspace 显式声明、CI 未启用 `--frozen-lockfile` |
| **4. 变异测试得分与覆盖率** | `bun run test:mutation`（Stryker 变异得分 $\ge 85\%$） | 分支覆盖率低于 95%、存在存活变异体（Surviving Mutants） |
| **5. 子进程单测隔离与超时** | `node scripts/run-isolated-tests.mjs <roots>` | 单测依赖执行次序、依赖 `vi.mock()` 假通过、单文件测试超时卡死 |
| **6. WebKit 滚动与视口避让** | 检查滚动容器禁用 `transform`，检查 CSS 变量叶子直写 | 列表容器使用 `transform` 导致长列表卡死、祖先节点滥用变量强制全树重排 |
| **7. 集中式动画时钟合规** | 检查所有无限动效/指示器是否接入集中时钟 Hook | 存在未经集中管控的 `infinite` / `steps()` 持续占用 Compositor 算力 |
| **8. 容灾、自愈与防复活** | 执行半开断网模拟、慢响应删除并发与系统 OOM 压力事件注入 | 出现请求死锁 Hang、已删除实体被慢响应复活、OOM 下等待 Idle 崩溃 |
| **9. 跨端 Surface 显式矩阵** | PR 描述中提供 5 端完整的 Surface 影响说明表 | 存在任何一端留白或未定义意外穿透 |
| **10. 物理入口可达性证明** | 从物理入口（如 `desktop/src/main.ts` 或 `mobile/App.tsx`）自顶向下追踪挂载 | 共享包写了逻辑，但在目标平台未挂载（死路径） |
| **11. 真实硬件运行声明** | 必须在 PR/汇报中说明：在哪个具体 Runtime、哪个 OS 硬件上完成了唤起复现 | 仅凭“测试跑通”而无物理运行声明者不得交付 |
| **12. 极简沟通与纯净提交** | 汇报与文案剔除 AI 八股套话；检查 Git 提交中严禁包含截图/录屏等大文件 | 提交中包含测试媒体文件、汇报出现“X 而不是 Y”或虚浮叙事一律打回 |
| **13. 真实网关全量 RPC 联调** | `npm run test:live-gateway`（真实拉起 Python 网关进程，覆盖 100% 涉及接口） | 仅靠 Mock 糊弄、遗漏任何公开接口、参数触发 Pydantic `Extra inputs` 阻断 |
| **14. 真实浏览器 CDP 物理交互** | `npm run test:cdp`（真实无头 Edge/Chrome 驱动，物理点击与安全区度量） | 触控热区 $<44\text{pt}$、移动端视口产生横向溢出、遮罩背景点击无法关闭 |

### 强制交付验证三位一体闭环 (Mandatory Delivery Triad Pipeline)
任何代码功能新增、抽象引入或缺陷修复，在声明完成或合并之前，必须在本地依次执行以下三条指令并实现 **100% 绿灯无报错通过**：
1. `npm run verify`：静态质量门禁 (gates) + TypeScript 全栈严格类型 (typecheck) + 全量单元测试 (test)；
2. `npm run test:live-gateway`：本地真实 Python Gateway 进程拉起与 22 个 RPC 接口集成联调测试（穷尽出入参契约与状态流转）；
3. `npm run test:cdp`：本地真实 Blink 内核无头浏览器（Edge/Chrome）启动与 CDP 物理交互、触控热区、安全区避让及视口仿真测试。
三者缺一不可，任何一项缺失或失败，一票否决禁止交付。
