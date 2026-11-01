# Hermes Flux 中间核心交互区与输入舱架构规范 (Main Chat Stage & Composer Dock Spec)

> **版本**：v1.1.0 (经过审查治理纠偏，100% 对齐网关权威契约与工程防灾不变量)  
> **状态**：Normative (权威设计基准)  
> **适用终端**：Desktop (macOS / Windows / Linux), Web, Mobile (iOS / Android Capacitor)  
> **关联协议**：Hermes Gateway JSON-RPC 2.0 & REST Protocol Baseline  

---

## 一、系统定位与设计哲学 (Vision & Philosophy)

中间核心交互区（Main Chat Stage）是用户与 Hermes Agent 进行全链路协同的第一触点。本规范统摄**对话展示流 (Message Stream)** 与 **悬浮输入舱 (Composer Dock)** 的视觉排版、状态流转、并发排队与跨端行为，确立以下不可动摇的工程哲学：

1. **信息分层与极客克制**：
   - 拒绝大面积刺眼色块与冗余调试噪点；
   - 核心操作栏（复制、回滚、Fork 等）常驻但保持微距低对比度；
   - Token 消耗与 TPS 采用阶梯式折叠展现，首层仅展示总 Token 胶囊，深层看板按需展开。
2. **状态透明与掌控感 (Full State Awareness)**：
   - 工具调用按“读折叠/写展开”智能呈现；
   - 深度思考链（Thought Chain）自适应折叠与计时；
   - 委派子任务实时透视运行态；
   - 用户连续发送多条指令时，通过“排队托盘 + 动态打断插队 + 运行时轻量纠偏 (Steering)”赋予用户绝对控制权。
3. **跨端同构与零妥协体验 (Cross-Platform Parity)**：
   - 桌面端锁定 740px 黄金阅读限宽；
   - 移动端（iOS / Android）保持相同业务能力，触控热区严格保证 $\ge 44\text{pt}/48\text{dp}$，配合虚拟键盘避让与物理安全区收敛。

---

## 二、架构拓扑与 Monorepo 分层职责 (Architectural Boundaries)

严格遵守 Hermes Flux 单向数据流拓扑，严禁业务表现层绕过 Core 发起裸网络请求：

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                packages/ui (纯 UI 表现层)                              │
│  - components/MiddlePod: 对话流渲染器、时间戳、常驻微距操作栏、思考链折叠、折叠 Token 仪表 │
│  - components/InputDock: 740px 悬浮输入舱、Provider 折叠模型选择器、附件暂存托盘          │
│  - components/QueueManager: 本地排队抽屉、多条消息调序/编辑/取消、打断插队控制器          │
│  - components/SlashPopper: `/` 斜杠指令与 Skill 联想补全悬浮窗                          │
│  - components/MentionPopper: `@file` 与 `@agent` 智能引用悬浮窗                         │
│  - utils/imagePreprocessor: 仅在表现层执行 Canvas 降采样（Core 保持纯逻辑，零 DOM 依赖） │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ 消费 Store 与驱动 Action
┌───────────────────────────────────────────▼────────────────────────────────────────────┐
│                                packages/core (无界业务层)                              │
│  - store/chatQueueStore.ts: 待发送消息队列，实现配置不可变冻结 (Queue Immutability)    │
│  - service/rollbackService.ts: 代码时光机与 prompt.submit 历史截断调度                 │
│  - service/branchService.ts: 基于消息索引节点的 session.branch 独立会话派生            │
│  - service/slashCatalogService.ts: commands.catalog 与 skills 统一检索与补全            │
│  - rpc/client.ts: prompt.submit (含 queued/truncate 标识)、session.correction 纠偏    │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ 宿主运行时承载
              ┌─────────────────────────────┴─────────────────────────────┐
              ▼                                                           ▼
┌───────────────────────────┐                               ┌───────────────────────────┐
│     packages/desktop      │                               │      packages/mobile      │
│ - Electron 无边框宿主     │                               │ - Capacitor 8 容器        │
│ - 本地文件路径拖拽安全转换 │                               │ - 原生软键盘高度监听与避让│
│ - 桌面剪贴板大图直读      │                               │ - 48dp 触控放大与安全区   │
└───────────────────────────┘                               └───────────────────────────┘
```

---

## 三、中间核心区全景功能树 (Feature Tree Matrix)

```text
中间核心交互区 (Main Chat Stage)
├── 1. 顶部上下文水位监控区 (Top Context Gauge Bar)
│   └── 1.1 上下文窗口监控 (Context Window Gauge)
│       ├── 右上角常驻：当前占用 Token / 模型最大容量（如 42k / 128k）与百分比读数
│       ├── 警戒色阶：常规暗银灰 (<70%) ➔ 琥珀暖金 (70%~90%) ➔ 翡翠品红高危 (>90%)
│       └── 网关数据源：映射自 `session.usage` 返回之 `context_used` / `context_max`
│
├── 2. 对话展示流 (Message Stream)
│   ├── 2.1 用户消息行 (User Message Row)
│   │   ├── 视觉气泡：高对比度黑曜背景、微距圆角与安全文本排版
│   │   └── 底部常驻微距操作栏 (Bottom Action Bar)
│   │       ├── 发送时刻：精确时间戳（如 14:28:05）
│   │       ├── 复制 (Copy)：一键提取提问纯文本
│   │       ├── 回滚 (Rollback)：仅普通会话可用，将提问内容回填底部输入框，
│   │       │   重发时通过 `truncate_before_row_id` 物理截断后续上下文
│   │       └── 分支 (Fork)：仅普通会话可用，调用 `session.branch(count)` 派生独立 Session
│   │
│   ├── 2.2 助手/AI 消息行 (Assistant Message Row)
│   │   ├── 身份感知头栏 (Header)
│   │   │   ├── 单聊模式：Hermes 极客微标与主模型标签
│   │   │   └── 群聊模式 (Group Chat)：强显出话 Agent 头像、专属角色昵称与颜色指纹
│   │   ├── 深度思考链展示 (Thought Chain / Reasoning)
│   │   │   ├── 折叠式手风琴：思考中保持呼吸闪烁动效，折叠栏显示“已思考 X 秒”
│   │   │   └── 点击展开：展示模型推理过程纯文本/Markdown，支持独立复制
│   │   ├── 正文流式渲染：安全 Markdown、公式、代码高亮、行号与一键复制
│   │   ├── 工具调用与委派展示 (Tool Invocations & Delegations)
│   │   │   ├── 读类工具：执行完毕自动折叠为单行 28px 紧凑胶囊（工具名、用时、绿点）
│   │   │   ├── 写类工具：保持展开或内联显示精简 Diff，支持跳至右侧检查舱深入查看
│   │   │   └── 委派子任务：显示父子拓扑卡片、呼吸态与 `subagent.interrupt` 紧急打断
│   │   └── 底部综合元数据与操作条 (Footer & Telemetry)
│   │       ├── 基础动作：复制 Markdown、基于当前节点 Fork 会话、重新生成
│   │       ├── 基础指标：模型名称、首字响应耗时 (TTFT)、整轮回答耗时、完成时间戳
│   │       └── 阶梯式 Token 与性能仪表 (Collapsible Token Metrics)
│   │           ├── 第一层（常驻外露）：总 Token 消耗药丸（如 1,420 tokens）
│   │           └── 第二层（点击/Hover 展开 Popover）：
│   │               ├── 动态生成速率：实时 TPS (Tokens Per Second)
│   │               ├── 实际调用模型全名 (Model Identifier)
│   │               ├── 输入 Token (Prompt) / 输出 Token (Completion)
│   │               └── 缓存系统：缓存命中 Token 数、缓存命中比例 (Cache Hit Ratio)
│   │
│   └── 2.3 视口滚动不变量 (Scroll Invariants)
│       └── 贴底判定：仅当读者距底 $\le 48\text{px}$ 时启用流式贴底；回看历史时绝对禁止强制拉拽
│
└── 3. 悬浮输入舱 (Composer Dock, 740px 黄金限宽)
    ├── 3.1 待发送消息队列与运行时交互 (Pending Queue & In-Flight Control)
    │   ├── 队列挂载托盘：当存在 $\ge 1$ 条排队消息时，输入框上方滑出半透明胶囊栏
    │   ├── 队列三项管理：单条取消 (Delete)、自由调序 (Reorder 上移/下移)、重新编辑 (Edit 回填)
    │   ├── 强行打断插队：一键调用 `session.interrupt` 刹停当前生成，将队列顶部消息立即推入
    │   ├── 运行时纠偏 (In-Flight Steering)：Agent 执行中支持发送轻量纠偏指导 (`session.correction`)
    │   └── 配置快照冻结：入队瞬时锁定 Provider、Model、Agent、附件，杜绝配置漂移
    │
    ├── 3.2 模型与 Provider 选择器 (Model Picker)
    │   ├── Provider 折叠手风琴：按 OpenAI、Anthropic、DeepSeek、Local/Ollama 分组折叠展开
    │   ├── 搜索过滤：输入即时过滤模型 ID 与别名
    │   └── 元数据徽章：单模型 Context 极限长度标识、是否支持 Vision 多模态
    │
    ├── 3.3 多模态与剪贴板输入
    │   ├── Ctrl+V 粘贴监听：自动捕获图片 Blob、外部文件、本地路径
    │   ├── 尺寸保护：单张图片限 10MB；长边 $> 2048\text{px}$ 在 UI 层使用 Canvas 等比自适应下采样
    │   ├── 拖拽支持 (Drag & Drop)：悬停高亮提示，跨平台支持本地文件与图片拖入
    │   ├── 附件暂存托盘：输入框上方显示图片缩略图、PDF 徽章，发送前支持单个删除
    │   └── 附件生命周期管理：排队期间内存暂存，出队发送前调网关 attach，取消时自动销毁内存
    │
    ├── 3.4 斜杠命令系统 (Slash Commands)
    │   ├── 补全悬浮面板：键入 `/` 唤出，键盘上下选定、Tab 补全
    │   ├── 系统与 Skill 混合检索：同时呈现内置命令与已注册 Skill（如 `code-review`）
    │   └── 填参交互模式：选定命令后仅上屏至输入框（如 `/model `），等待用户补全参数后回车提交
    │
    └── 3.5 `@` 智能引用与调度系统
        ├── 普通会话模式：
        │   ├── `@file`：模糊搜索本地 Project 树与知识库，以相对路径形式嵌入 Prompt
        │   └── `@agent`：拉取已配置 Profile 清单，支持单次定向委派专家 Agent
        ├── Bot 专职工位模式：
        │   └── 禁用 `@agent`（防止上下文污染），仅保留 `@file` 本地文档引用
        └── 群聊房间模式 (Group Chat)：
            ├── `@agent`：仅拉取本房间已入驻成员，支持精准单点唤醒（未提及成员静默旁听）
            └── `@all` / `@everyone`：唤醒全员，交由群聊 driver 自治协同讨论
```

---

## 四、核心交互与状态机流转规约 (Detailed Interaction Specifications)

### 4.1 回滚 (Rollback) 与 历史截断流线
* **可用边界**：仅在“普通会话”中启用。在 Bot 专职工位与群聊房间中，操作栏中不渲染“回滚”按钮。
* **机制分离（严禁混淆单步撤回与历史截断）**：
  * **单步撤销 (Stack Undo)**：仅用于撤销最近一轮对话，底层调用 `session.undo(intent: 'undo')`。
  * **历史第 $N$ 轮截断回滚 (Truncate & Regenerate)**：
    1. 用户点击历史第 $N$ 条提问下方的“回滚”；
    2. 客户端弹出确认微卡片（提示：“此操作将截断该轮次之后的所有记录并重新编辑”）；
    3. 确认后，客户端提取第 $N$ 条提问的文本与附件，**自动回填到底部输入框**，光标自动聚焦至尾部；
    4. 用户修改完毕点击发送时，客户端调用 `prompt.submit`，传入：
       ```typescript
       {
         session_id: activeSessionId,
         text: modifiedPromptText,
         confirm_truncate: true,
         truncate_before_row_id: targetRowId // 或 truncate_before_message_id
       }
       ```
    5. 网关根据 `truncate_before_row_id` 自动从数据库中原子裁撤该节点后续的所有记录，并以新的提问开启后续流式生成，保证状态一致性。

### 4.2 Fork 分支会话流线
* **可用边界**：仅在“普通会话”中启用。
* **时序与动作**：
  1. 用户在任意回合点击“Fork”；
  2. 客户端计算当前节点的累积消息条数 `count`；
  3. 调用网关 `session.branch({ session_id, count, name: 'Fork of ...' })`；
  4. 网关生成全新 `session_id` 并克隆前置历史；
  5. 客户端自动将左侧会话抽屉激活项切换至新会话，主视窗无缝挂载新历史，原会话完好无损。

### 4.3 多消息排队 (Queue)、打断插队 (Interrupt) 与运行时纠偏 (Steering) 状态机

```text
[用户回车发送提问]
       │
  Agent 是否忙碌？ (isGenerating || isToolRunning)
   ├── 否 ──► 直接执行 prompt.submit (status: streaming)
   └── 是 ──► 用户选择交互分支：
               │
               ├─────────────────────────┬─────────────────────────┐
               ▼                         ▼                         ▼
         [分支 A: 入队排队]         [分支 B: 运行时纠偏]       [分支 C: 强制插队]
    1. 冻结配置与附件内存快照    1. 保持当前生成不中断     1. 调用 session.interrupt 强制刹车
    2. 写入 pendingQueueStore   2. 调 session.correction   2. 网关确认中断后立即将排队第一条
    3. 弹出队列挂载抽屉            3. 网关返回 steered 注入     调用 prompt.submit 提交执行
               │
               ▼
    当前轮次正常收到 turn_complete
    弹出队列头部元素 ➔ 执行网关 attach ➔ 调用 prompt.submit 提交下一轮
```

* **队列内可变操作与附件生命周期**：
  * **取消 (Delete)**：从数组剔除该项；若该项包含本地图片/文件，立即调用 `URL.revokeObjectURL` 释放内存；
  * **调序 (Reorder)**：数组元素位置互换（`reorder(sourceIndex, targetIndex)`）；
  * **编辑 (Edit)**：将队列中该项取出并回填至当前输入框，允许用户重新组织文字与附件后再次入队；
  * **出队挂载时机 (Lifecycle Guard)**：严禁在排队时直接调用网关的 `image.attach_bytes`！网关的附件通道为会话全局下一轮消费模式，排队期间必须在前端持有 Base64/Blob，仅在出队发送前置微任务中按序挂载。

---

## 五、网关 RPC 接口契约权威对照表 (Gateway Contract Mapping)

本对照表 100% 对齐 `packages/core/src/rpc/contracts/gateway-contract.generated.ts`，杜绝任何字段臆造：

| 业务场景 | 调用的 RPC / REST 接口 | 权威入参 (Payload Contract) | 权威出参 (Response Contract) | 守卫与错误处理 |
|---|---|---|---|---|
| **单步会话撤回** | `session.undo` | `{ session_id: string, intent?: 'undo' \| 'retry' }` | `{ removed: number }` | 仅用于撤销最近一步；失败显式提示 |
| **历史截断重新生成** | `prompt.submit` | `{ session_id: string, text: string, confirm_truncate: true, truncate_before_row_id: number }` | `PromptSubmitResult` (`status: 'streaming' \| 'queued' ...`) | 用于历史第 N 轮截断，原子替换历史 |
| **代码时光机还原** | `rollback.restore` | `{ session_id: string, hash: string }` | `{ success: boolean, restored_files: string[] }` | 工作区冲突拦截（4001 鉴权/守卫） |
| **消息节点 Fork** | `session.branch` | `{ session_id: string, count?: number, name?: string }` | `SessionBranchResult` (`session_id, parent, messages`) | 空会话拦截（4008 守卫） |
| **强制紧急打断** | `session.interrupt` | `{ session_id: string }` | `SessionInterruptResult` (`status: 'interrupted'`) | 幂等操作，已停止则返回 not_interrupted |
| **运行时轻量纠偏** | `session.correction` | `{ session_id: string, text: string }` | `SessionCorrectionResult` (`status: 'queued' \| 'redirected' \| 'rejected'`) | Agent 执行走偏时的运行时指导 |
| **排队消息提交** | `prompt.submit` | `{ session_id: string, text: string, queued: true }` | `PromptSubmitResult` (`status: 'queued'`) | 格式严格对齐，严禁未声明冗余字段 |
| **斜杠与技能检索** | `commands.catalog` | `{ session_id?: string }` | `CommandsCatalogResult` (`commands, skills, categories`) | 本地与网关目录合并展示 |
| **斜杠指令执行** | `slash.exec` | `{ session_id: string, command: string }` | `SlashExecResult` (`output?: string, type?: DispatchType`) | 兼容 `skill` / `prefill` / `exec` 调度 |
| **上下文用量拉取** | `session.usage` | `{ session_id: string }` | `SessionUsageResult` (`context_used, context_max, avg_tps, cache_hit_pct`) | 驱动右上角水位计与 Hover 详细看板 |
| **剪贴板图片挂载** | `image.attach_bytes` | `{ session_id: string, content_base64?: string, data?: string, filename?: string }` | `AttachedImageResult` (`attached: boolean, name, width, height, path, bytes`) | 10MB 拦截与长边 $>2048\text{px}$ 前端降采样 |
| **本地文件路径挂载** | `file.attach` | `{ session_id: string, path?: string, data_url?: string, name?: string }` | `FileAttachResult` (`attached: boolean, filename: string, path: string, bytes: number`) | Desktop 用 `path`，Web 沙箱用 `data_url` |

---

## 六、移动端 (Capacitor Mobile) 专用适配与防卡死铁律

虽然桌面与移动端在业务能力上 100% 同构，但必须严格执行 `ENGINEERING_DISCIPLINE.md` 针对 WebKit 的底层避坑铁律：

1. **软键盘动效编排与焦点时序 (Keyboard Choreography Timing)**：
   * **绝对禁止在同一个宏任务中同步切换输入框 DOM 结构并调用 `element.focus()`**！
   * 必须使用 `flushSync()` 先提交 DOM 结构变更；
   * 在随后的 `requestAnimationFrame` 中调用 `focus()`；
   * 在键盘移动过渡期间，为输入框挂载 `.oc-kb-caret-hold` 类隐藏光标，防止光标乱跳。
2. **iOS 动量滚动物理对抗 (Defeating Momentum Fling)**：
   * 在 iOS WebKit 处于快速滑动惯性减速状态（Momentum Fling）时，任何 JavaScript 同步写入 `scrollTop` 都会被浏览器静默丢弃！
   * 必须通过 `setScrollTopDefeatingMomentum` 机制：短暂切换容器 `overflow: hidden` 物理杀死惯性滑动，随后写入目标 `scrollTop`，并连续维持约 20 帧的状态锁定，保证流式贴底绝对稳定。
3. **滚动容器禁用 CSS Transform**：
   * 绝对禁止对长列表容器（`.chat-scroll`）及其直接内容应用任何 CSS `transform`；
   * 软键盘弹起时，由 Capacitor 桥动态更新 CSS 变量 `--keyboard-height`，输入舱使用 `padding-bottom: max(var(--keyboard-height), env(safe-area-inset-bottom))` 向上平移，保持容器 `clientHeight` 恒定，杜绝 WebKit 重建 GPU 合成层导致的卡死。
4. **触控热区放大 (Touch Geometry $\ge 44\text{pt}$)**：
   * 移动端操作按钮通过透明内边距（`padding: 10px 14px`）撑开物理点击热区，确保单次点击面积 $\ge 44\times 44\text{pt}$，严禁手指误触。
5. **输入舱小屏自适应**：
   * 桌面端严格锁定 `max-width: 740px` 黄金居中限宽；
   * 移动端小屏（$\le 768\text{px}$）自适应为 100% 满屏通栏，左右各保留 `16px` 安全物理内边距。

---

## 七、质量门禁与验收测试标准 (Acceptance Criteria & Gates)

本设计规范受 `ENGINEERING_DISCIPLINE.md` 铁律保护，后续实现必须通过以下自动化验证：

1. **Gate 1: 严格类型断言**：全流程涉及的参数类型（`PromptSubmitParams`、`SessionUsageResult`、`ImageAttachBytesParams`、`FileAttachParams`）100% 对齐 Generated Contract，0 TS 报错，严禁 `as any`。
2. **Gate 2: 状态机动态时序单测**：
   - 编写 `packages/core/__tests__/queue/chatQueueStore.test.mjs`，验证入队冻结、多附件内存释放、调序、打断插队时序；
   - 编写 `packages/core/__tests__/session/truncateAndBranch.test.mjs`，验证 `prompt.submit` 截断与 `session.branch(count)` 成功截断与派生。
3. **Gate 3: CDP 物理交互与触控热区验证**：
   - 在真实无头 Edge/Chrome 环境下仿真 Pixel 8 移动端视口与桌面 1920x1080 视口；
   - 断言常驻操作栏高度 $\ge 44\text{px}$，断言输入框 740px 限宽，断言排队卡片增删与 DOM 局部更新零重绘。
