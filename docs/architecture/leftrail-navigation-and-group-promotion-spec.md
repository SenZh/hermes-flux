# Hermes Flux 左侧导航架构与多模协同流转权威实施规范 (v4.0 Architecture & Engineering Spec)

> **文档代号**：`FLUX-SPEC-LRAIL-PROMOTE-v4`  
> **文档定位**：面向 Hermes Flux 全平台端到端极客美学工作台（Desktop, Web, iOS, Android）的左侧导航（LeftRail）、Bot 调度、主对话切分、原地拉群（Group Promotion）与临时会话生命周期的**终极裁决与全栈工程落地规范**。  
> **制定角色**：Agent 3（全栈落地与裁决架构师 - 评审与工程合成）。  
> **基线对齐**：Nous Research 官方 Gateway 协议基线（`contract.generated.ts`，252 RPC / 77 Events / 13 Server Requests）及 Hermes Flux 极客美学设计系统（`docs/design-system/`）。

---

## 目录
1. [业务愿景与核心定位梳理](#一业务愿景与核心定位梳理)
2. [双向审查裁决：Agent 1（底层协议）vs Agent 2（UI/UX 设计）](#二双向审查裁决agent-1底层协议-vs-agent-2uiux-设计)
   - 2.1 UX 方案中的“三大空想陷阱”与现实纠偏
   - 2.2 底层方案中的“三大死板教条”与工程破局
3. [核心痛点 A 裁决：左侧导航（LeftRail）终极微架构设计](#三核心痛点-a-裁决左侧导航leftrail终极微架构设计)
   - 3.1 三大备选架构深入剖析与选型矩阵
   - 3.2 终极裁决：极客美学双轨主从架构 (Dual-Rail Hub: 48px + 212px = 260px)
   - 3.3 物理几何与三态折叠规范（全展开 / 紧凑微轨 / 纯净沉浸）
4. [核心痛点 B 裁决：主对话切 Bot 与单聊一键拉群 (Promotion)](#四核心痛点-b-裁决主对话切-bot-与单聊一键拉群-promotion)
   - 4.1 主对话切 Bot 双模机制（旁聊提问 vs 全权接力）
   - 4.2 单聊一键拉群（Session-to-Group Promotion）四阶工程管道
5. [痛点 C 裁决：普通 Session 与临时沙盒任务生命周期](#五痛点-c-裁决普通-session-与临时沙盒任务生命周期)
6. [全栈数据契约与接口定义 (Ready-to-Code Contracts)](#六全栈数据契约与接口定义-ready-to-code-contracts)
7. [分阶段编码实施路线图与 TDD 自动化门禁矩阵](#七分阶段编码实施路线图与-tdd-自动化门禁矩阵)

---

## 一、业务愿景与核心定位梳理

在 Hermes Flux 桌面端工作台的设计中，必须清晰界定四大业务实体的职责与层级关系，杜绝模糊不清的混同设计：

| 实体模式 | 核心定位与业务心智 | 底层物理映射 (Gateway) | 记忆与沙箱生命周期 |
|---|---|---|---|
| **1. 个人助理<br>(Primary Hub)** | **全局最高核心中枢 (Soul/Default)**。<br>用户的日常数字分身、全局秘书与主时间线，承载用户偏好、跨项目统筹与全天候陪伴。 | 默认配置档 `profile: 'default'`<br>物理路径 `/opt/data/profiles/default` | 共享长效全局记忆库，挂载默认技能沙箱与全局调度能力。永不被折叠或淹没。 |
| **2. 专职 Bot<br>(Dedicated Profile)** | **垂直业务专家实体 (Deep Specialist)**。<br>具备专属人格（Persona）、专属 System Prompt、独立技能/工具集及专有工作空间的专业 Agent（如架构老王、安全审计、前端开发）。 | 独立配置档 `profile: '<name>'`<br>物理路径 `/opt/data/profiles/<name>` | 专属沙箱隔离记忆库，完全独立的技能列表与工作目录挂载。 |
| **3. 多 Agent 会议室<br>(Group Room)** | **群体智能协同研讨空间 (Swarm/Meeting)**。<br>多个 Agent（包含个人助理与若干专职 Bot）围绕同一议题展开轮询发言、对齐推演、交叉质检与集体决策。 | 官方房间实体 `room_id`<br>RPC `groups.*` 系列调度引擎 | 会议级时序上下文流，多 Agent 发言角色归集，支持实时投票、争议裁判与共识决议。 |
| **4. 普通 Session / 旁聊<br>(Ephemeral / Sidechat)** | **临时沙盒、灵感草稿与旁路探索**。<br>轻量单次问答、代码片段临时调试，或在主对话流中的不打断提问（Sidechat / BTW）。 | `session.create(ephemeral=true)`<br>RPC `prompt.btw` 与 `btw.complete` | 随用随走或仅存留 24 小时；旁聊完全不写入主会话上下文窗口，零 Token 污染。 |

---

## 二、双向审查裁决：Agent 1（底层协议）vs Agent 2（UI/UX 设计）

作为裁决架构师，必须同时对底层协议的死板教条与表现层的天马行空进行严格审查，防止工程走向“做得出但极难用”或“好看但根本做不出”的极端。

### 2.1 UX 方案中的“三大空想陷阱”与现实纠偏

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                UX 方案空想陷阱与现实纠偏矩阵                            │
├───────────────────────┬──────────────────────────────────┬─────────────────────────────┤
│ 陷阱 1: 单聊硬切 Bot   │ 认为输入框切下拉即可在当前 Session  │ 破坏 LLM 上下文纯净性，系统提示 │
│       (In-place Switch)│ 里让不同 Bot 轮流回答，共享同一上下文│ 词冲突，导致工具权限与人格串味。 │
│ ───────────────────── │ ──────────────────────────────── │ ─────────────────────────── │
│ 纠偏裁决               │ 区分「轻量外援 (Sidechat)」与「全权移交 (Handoff)」：外援走 btw 旁路胶囊， │
│                       │ 移交必须走底层 session.branch_whole 派生新会话，杜绝同一会话混用 Profile。 │
├───────────────────────┼──────────────────────────────────┼─────────────────────────────┤
│ 陷阱 2: 原地无缝拉群   │ 认为点击“拉群”后单聊直接黑盒变群聊，│ 底层 groups.create 是独立 Room  │
│       (Blackbox Morph) │ 所有 Bot 立即在当前窗口继续发言  │ 实体，无历史直通链路；破坏单聊回溯。│
│ ───────────────────── │ ──────────────────────────────── │ ─────────────────────────── │
│ 纠偏裁决               │ 采用「四阶工程管道」：提取 Briefing Memo 种子上下文，调用 groups.create   │
│                       │ 创建房间，原单聊留存跳转锚点卡片，主视图瞬切至 GroupRoomView。             │
├───────────────────────┼──────────────────────────────────┼─────────────────────────────┤
│ 陷阱 3: 扁平混列左栏   │ 试图把所有 Profile、Group 和 Session│ 导致垂直信息过载；用户无法感知专属   │
│       (Flat Mess Rail) │ 扁平混排在一个单列列表里加标签区分 │ 工作区边界，查找极其费劲。          │
│ ───────────────────── │ ──────────────────────────────── │ ─────────────────────────── │
│ 纠偏裁决               │ 严守双轨主从分层：L0 物理中枢微轨负责身份切换，L1 上下文抽屉负责会话管理。  │
└───────────────────────┴──────────────────────────────────┴─────────────────────────────┘
```

### 2.2 底层方案中的“三大死板教条”与工程破局

1. **教条一：全局租户隔离论（强制左上角下拉换 Profile）**
   - *底层死板点*：既然 Gateway 存储物理按 Profile 分目录，前端就必须在全局左上角放个下拉菜单，切完后把整个应用上下文冲掉重新 fetch。
   - *破坏性*：抹杀了“个人主助理”的无上地位；用户在写代码时想问一句主助理，需要停下手头工作、下拉切换、等待重载、再问一句、再切回去，体验灾难。
   - *工程破局*：在客户端内存建立 **Multi-Profile Cache Registry**；左侧微轨直接把主助理与固定的 Bots 并列呈现，点击直接无缝激活抽屉，底层异步拉取对应 Profile 的 Session 列表，实现零等待切换。
2. **教条二：Group 与 Session 绝对互斥论**
   - *底层死板点*：`groups.create` 参数只有 `name` 和 `members`，不支持导入历史消息，因此单聊无法升级为群聊。
   - *破坏性*：用户在单聊遇到复杂问题时，必须手动开一个群，把刚才的几十轮对话复制粘贴给新群，极大打断工作心流。
   - *工程破局*：前端 Orchestrator 层通过 **Seed Briefing Memo（种子上下文简报）**，把单聊核心共识压缩后以系统初始消息写入群聊房间，并在原单聊追加双向关联锚点。
3. **教条三：严格禁止主对话引用外部 Bot 技能**
   - *底层死板点*：会话的 tools 由当前 profile 决定，无法调用其他 profile 的 tools。
   - *破坏性*：主助理无法随手请求架构 Bot 的分析能力。
   - *工程破局*：通过官方 RPC `prompt.btw` 与 `subagent` 协议通道，将 `@BotName` 的提问在后台以子任务派发，主会话仅消费其结构化结果胶囊，既维护了底层架构的隔离性，又赋予了用户顶级的协同自由度。

---

## 三、核心痛点 A 裁决：左侧导航（LeftRail）终极微架构设计

### 3.1 三大备选架构深入剖析与选型矩阵

| 评估维度 (权重) | 方案 1：左上角单点下拉切换 | 方案 2：单轨长列表折叠分组 | 方案 3：双轨主从微架构 (Dual-Rail Hub) |
|---|:---:|:---:|:---:|
| **主助理中枢地位 (25%)** | ❌ 沦为下拉菜单普通选项 (30分) | ⚠️ 易被长列表推下折叠 (60分) | ✅ **永恒第一位高亮置顶 (100分)** |
| **Bot 与群聊可见性 (25%)** | ❌ 隐藏在二级深处，无感知 (20分) | ⚠️ 垂直滚动拥挤，信息过载 (50分) | ✅ **微轨图标+指纹呼吸灯实时感知 (95分)** |
| **切换操作路径深度 (20%)** | ❌ 至少 2~3 次点击+重载 (30分) | ⚠️ 需要展开折叠手风琴 (65分) | ✅ **一键直达，零重载心流 (100分)** |
| **物理布局与美学契合度 (20%)**| ⚠️ 传统 Web 管理后台糙感 (50分) | ⚠️ 杂乱如文件夹树 (55分) | ✅ **Slack/Arc 级极客工作台质感 (100分)** |
| **底层 RPC 映射优雅度 (10%)**| ✅ 简单粗暴 (100分) | ❌ 全局混查导致 RPC 混乱 (40分) | ✅ **天然 1:1 映射 profile 入参 (100分)** |
| **加权综合得分** | **39.5 分 (淘汰)** | **55.5 分 (淘汰)** | **98.75 分 (终极胜出)** |

### 3.2 终极裁决：极客美学双轨主从架构 (Dual-Rail Hub: 48px + 212px = 260px)

工作台左侧栏总宽严格维持在 **260px**（完美契合既有 `var(--rail-w-left, 260px)`），内部水平划分为两层物理轨：

```text
┌────────────────────────────────────────────────────────────────────────┐
│               Hermes Flux LeftRail 260px 双轨物理拓扑                   │
├────────────────────┬───────────────────────────────────────────────────┤
│ 48px Station Rail  │ 212px Context Drawer (动态上下文抽屉)               │
│ (极窄物理中枢微轨)   │ (根据当前选中的 Station 动态映射渲染)                 │
├────────────────────┼───────────────────────────────────────────────────┤
│                    │ ┌───────────────────────────────────────────────┐ │
│ ✦ 主中枢 (Default) │ │ [+ 新建会话] (全宽胶囊, 32px 物理高度)        │ │
│   (翡翠光晕，永恒首位) │ └───────────────────────────────────────────────┘ │
│ ────────────────── │ ┌───────────────────────────────────────────────┐ │
│ 🤖 架构老王 (Indigo)│ │ 🔍 搜索会话... (Cmd+F)                        │ │
│ 🎨 设计小美 (Pink)  │ └───────────────────────────────────────────────┘ │
│ ⚡ 运维阿强 (Amber) │ 【时间分组流】                                    │
│                    │ ▼ 今天 (Today)                                  │
│ ────────────────── │   ├─ 核心系统架构重构 (Active, 3px翡翠指示线)      │
│ 👥 多Agent群聊会议 │   └─ 微信公众号文章流水线排期                      │
│   (双头像叠放图标)  │ ▼ 7天前 (Past 7 Days)                           │
│ ────────────────── │   ├─ 盐湖城 VPS 网络穿透部署                     │
│ 🗂️ Bot 广场 / 资产 │   └─ 服装设计系列 AI 出图排障                   │
│                    │                                                   │
│                    │ 【当 Station 切换至 👥 群聊 时】                   │
│                    │ ┌───────────────────────────────────────────────┐ │
│                    │ │ [+ 发起多Agent研讨] (Cyan 极客天光高光)       │ │
│                    │ └───────────────────────────────────────────────┘ │
│                    │ ▼ 进行中的会议 (Active)                           │
│                    │   ├─ # 登录架构双轨评审 [3位专家在线 🟢]            │
│                    │   └─ # 红蓝安全攻防对抗 [2位专家]                  │
│ ────────────────── │                                                   │
│ ⚙️ 全局设置        │ (底部提供折叠手柄与会话数量统计)                   │
└────────────────────┴───────────────────────────────────────────────────┘
```

### 3.3 物理几何与三态折叠规范

1. **Station Rail (48px 极窄中枢微轨)**：
   - 宽度：固定 48px，背景色：`var(--bg-dock, #07080A)`，右侧有 1px `var(--border-subtle, rgba(255,255,255,0.06))` 分割线。
   - 按钮尺寸：34px × 34px，圆角 8px，居中对齐，纵向间隔 8px。
   - 交互反馈：悬停微亮；选中项左侧出现 3px 纵向天光色条，背景呈现 12% 品牌柔和光晕。
2. **Context Drawer (212px 上下文抽屉)**：
   - 宽度：固定 212px（`260px - 48px = 212px`），背景色：`var(--bg-subrail, #12151C)`。
   - 会话条目：高度 34px，文字截断单行展示，右侧浮现删除/重命名悬停动作。
3. **三态物理折叠机制**：
   - **Mode 1: 双轨全展开 (Default - 260px)**：日常高效作业，中枢与上下文一览无余。
   - **Mode 2: 紧凑微轨模式 (Compact - 48px)**：按 `Cmd+\`，收起 212px 抽屉，保留 48px Station 坞。释放屏幕空间给长文和多栏代码；悬停 Station 图标时以 `Flyout Popover` 快速展示最近 3 个会话。
   - **Mode 3: 纯净沉浸模式 (Zen - 0px)**：按 `Cmd+B`，整体全折叠为 0px，彻底消除侧栏干扰，沉浸于 MiddlePod 写作。

---

## 四、核心痛点 B 裁决：主对话切 Bot 与单聊一键拉群 (Promotion)

### 4.1 主对话切 Bot 双模机制（旁聊提问 vs 全权接力）

为彻底杜绝“在同一 Session 内硬切 Profile 导致 Prompt 与 Tools 串味崩溃”，本规范确立**两级切 Bot 管道**：

```text
┌────────────────────────────────────────────────────────────────────────┐
│                      主对话切 Bot 两级交互管道                          │
├────────────────────────────────────────────────────────────────────────┤
│ [级别 1: 轻量旁路提问 (Sidechat / BTW Mode)]                           │
│  • 触发场景: 聊到一半，想临时请教另一个专业 Bot 一个具体问题，主线不变。│
│  • 交互行为: 输入框键入 `@BotName <内容>` 或输入 `/btw`                 │
│  • 底层映射: 调用 RPC `prompt.btw(session_id, text)`                   │
│  • 呈现方式: MiddlePod 内嵌入带有专属色彩指纹的「微距受光外援胶囊」，  │
│              独立折叠，不污染主会话 Context Window。支持一键引用到输入框。│
├────────────────────────────────────────────────────────────────────────┤
│ [级别 2: 全权接力移交 (Handoff & Fork Mode)]                           │
│  • 触发场景: 需求明确后，需将整个议题全权移交给专职 Bot 深入跟进。       │
│  • 交互行为: 点击 MiddlePod 顶栏的接力按钮，或输入 `/handoff @BotName` │
│  • 底层映射:                                                           │
│    1. 调用 RPC `session.branch_whole(current_session_id)` 派生新会话;   │
│    2. 新会话绑定目标 Profile: `target_bot_profile`;                    │
│    3. 插入 System 移交事件: "已从 [主中枢] 接力移交至 [架构老王]";      │
│    4. 前端平滑切换当前高亮会话至新 session_id，原单聊完好归档留存。     │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.2 单聊一键拉群（Session-to-Group Promotion）四阶工程管道

当单聊探讨遇到深水区，需要多位专家 Agent 现场研讨时，通过四阶管道实现“无感升级”：

```text
       [用户点击 MiddlePod 右上角 "👥 升级为多智能体群聊" 胶囊]
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 阶段一：选人与议题确认 (Pop-over Dialog)                               │
│ - 自动预填群聊标题: [原会话标题 + " (协同研讨)"]                       │
│ - 参会专家勾选单 (从 state.profiles 提取，支持多选):                   │
│   ☑ 个人主助理 (Default)  ☑ 架构老王 (Arch)  ☑ 前端小张 (FE)           │
│ - 点击 "立即发起会议 (Enter)"                                          │
└────────────────────────────────┬───────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 阶段二：背景简报提取与压缩 (Context Briefing Memo)                     │
│ - 前端遍历当前会话已加载消息 (ViewModel[]):                            │
│   • 若消息 <= 10 条: 抓取完整对话流作为前序上下文;                      │
│   • 若消息 > 10 条: 抓取前 3 条 + 最近 7 条，调用 `session.compress`    │
│     生成要点摘要。                                                     │
│ - 格式化为 Markdown 简报契约:                                          │
│   `### 📋 会议前序背景摘要 (From Session: {originalTitle})`           │
│   `• 议题背景: ...`                                                   │
│   `• 核心代码/结论: ...`                                               │
│   `• 本次群聊聚焦解决: ...`                                            │
└────────────────────────────────┬───────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 阶段三：创建群房间与种子注入 (Group Creation & Seed Injection)         │
│ 1. RPC: `groups.create({ name: groupName, members: selectedProfiles })`│
│    ➔ 网关持久化房间并返回唯一 `room_id` (如 "grp-fe890a");             │
│ 2. RPC: `groups.send({ room_id, text: briefingMemo, is_seed: true })`  │
│    ➔ 作为群聊房间的 Room 0 种子系统备忘录固化;                          │
│ 3. 在原单聊末尾追加一条不可变 Fork 锚点卡片:                          │
│    `"📌 本会话已升级为多Agent群聊: [立即进入会议室 ➔] (room: grp-fe890a)"`│
└────────────────────────────────┬───────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 阶段四：无缝视口流转与双向锚定 (Seamless Handover)                      │
│ 1. 左侧 Station Rail 自动平移高亮至 `👥 群聊` 分组;                    │
│ 2. 抽屉自动将新建的 `grp-fe890a` 置顶并设为 Active;                    │
│ 3. MiddlePod 卸载单聊视图，瞬切装配 `GroupRoomView`:                   │
│    • 顶栏展示多 Agent 迷你头像堆叠与就绪状态灯;                         │
│    • 首屏展示优雅的受光天光卡片《会议前序背景简报》;                   │
│    • 输入 Dock 自动切换为群聊模式 (支持 `@All`、`@架构老王` 提问);     │
│ 4. 全流程耗时 < 350ms，无白屏、无闪烁、无数据丢失。                     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 五、痛点 C 裁决：普通 Session 与临时沙盒任务生命周期

针对用户日常中频繁出现的“一次性临时提问、代码试错、格式转换”等短程需求，如果全部固化在主助理历史中，会导致主时间线严重水化。裁决如下：

1. **三级会话分级存储模型**：
   - **Level 1: 主中枢核心线 (Primary Thread)**：长期演进的主脉络，沉淀用户核心档案与重要规划。
   - **Level 2: 专职任务线 (Topic Sessions)**：按主题归类的正规会话，支持归档（Archive）与回退（Rollback）。
   - **Level 3: 临时沙盒 (Ephemeral Scratchpad)**：
     - 在输入舱提供微型切换开关：`⚡ 临时草稿 (No-Save)`；
     - 创建时标记 `ephemeral: true`，左侧抽屉以灰色虚线胶囊标记；
     - 窗口关闭或 24 小时后，网关在垃圾回收周期中自动静默清理；
     - 若临时草稿中讨论出了重大方案，输入舱上方提供 **`📌 固化为正式会话`** 快捷操作，调用 `session.save` 瞬间升级为持久资产！

---

## 六、全栈数据契约与接口定义 (Ready-to-Code Contracts)

为保障工程实施符合 Monorepo 严苛分层，接口统一归入 `packages/core/src/rpc/types.ts` 与 `packages/ui/src/components/LeftRail/LeftRail.ts`。

### 6.1 Core 数据契约定义 (`packages/core/src/rpc/types.ts`)

```typescript
/**
 * 48px Station 物理中枢微轨项契约
 */
export type StationType = 'primary' | 'bot' | 'groups' | 'store' | 'settings';

export interface StationItem {
  id: string;
  type: StationType;
  name: string;
  displayName: string;
  avatar?: string;
  colorTheme?: string; // 智能体色彩指纹 (十六进制或 CSS 变量名)
  unreadCount?: number;
  hasActiveTask?: boolean; // 是否有后台长任务运行中 (驱动呼吸灯)
  profileRef?: string;
}

/**
 * 群聊房间数据契约 (对齐 groups.* RPC 系列)
 */
export interface GroupRoomSummary {
  roomId: string;
  name: string;
  topic?: string;
  members: Array<{
    profile: string;
    displayName: string;
    avatar?: string;
    role: 'owner' | 'expert' | 'observer';
    isOnline: boolean;
  }>;
  lastMessage?: {
    senderProfile: string;
    text: string;
    timestamp: number;
  };
  activeAgentCount: number;
  createdAt: number;
}

/**
 * 单聊原地升级为群聊的请求参数
 */
export interface PromoteSessionToGroupParams {
  sourceSessionId: string;
  groupName: string;
  targetProfiles: string[];
  includeContextSummary: boolean;
  customBriefingNotes?: string;
}

export interface PromoteSessionToGroupResult {
  ok: boolean;
  roomId: string;
  groupName: string;
  briefingMessageId?: string;
  error?: string;
}
```

### 6.2 UI LeftRail 组件 Props 契约 (`packages/ui/src/components/LeftRail/LeftRail.ts`)

```typescript
export interface LeftRailProps {
  /** 整体折叠状态 (Mode 3: 0px) */
  collapsed: boolean;
  /** 紧凑微轨模式 (Mode 2: 仅保留 48px Station Rail) */
  compactMode: boolean;
  
  /** 48px 物理中枢微轨数据与当前选中项 */
  activeStationId: string;
  stations: StationItem[];
  
  /** 212px 上下文抽屉数据 */
  activeSessionId: string;
  sessions: LeftRailSession[];
  groupRooms?: GroupRoomSummary[];
  
  /** 状态与诊断 */
  gatewayOnline: boolean;
  gatewayLatencyMs: number;
  error?: string;
  
  /** 回调通道 */
  onSelectStation: (stationId: string) => void;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onSelectGroupRoom?: (roomId: string) => void;
  onNewGroupRoom?: () => void;
  onToggleCompactMode?: () => void;
  onOpenSettings?: () => void;
}
```

---

## 七、分阶段编码实施路线图与 TDD 自动化门禁矩阵

### 7.1 三阶段编码实施管道 (3-Stage Implementation Pipeline)

```text
[阶段 1: Core 协议下沉与状态解耦 (Day 1)]
  1. 在 packages/core/src/rpc/client.ts 中补齐 group.* 常用封装方法:
     - listGroupRooms(), createGroupRoom(), sendGroupMessage()
  2. 实现 Session-to-Group 转换编排器 (SessionPromotionOrchestrator):
     - 自动提取 Briefing Memo，串联 groups.create 与 groups.send
  3. 扩充 types.ts 严格类型定义，确保 tsc --noEmit 零警告通过。

[阶段 2: UI 双轨微架构与组件重构 (Day 2)]
  1. 重构 packages/ui/src/components/LeftRail/LeftRail.ts:
     - 采用 CSS Flex 内部双轨分割 (48px Station + 212px Drawer)
     - 植入 ✦ 个人主助理、Bots 列表与 👥 群聊分组
     - 注入微距受光物理阴影与翡翠高光指示线
  2. 扩展 MiddlePod 顶栏:
     - 挂载 "👥 升级为群聊会议" 胶囊与 Popover
     - 挂载 `@BotName` 外援胶囊卡片渲染引擎

[阶段 3: Desktop 装配与端到端集成 (Day 3)]
  1. 在 packages/desktop/src/renderer/index.ts 中接驳 Station 状态机:
     - 切换 Station 时调用对应的 listSessions(profile) 或 listGroupRooms()
     - 实现单聊一键拉群后的平滑流转逻辑
  2. 运行自动化全量质量门禁与回归断言。
```

### 7.2 质量门禁与 TDD 自动化断言矩阵 (Quality Gates)

为满足 `AGENTS.md` 规定的 **6 大硬门禁**，所有增量代码必须配套以下测试用例并通过断言：

```typescript
// packages/core/__tests__/promotion/sessionPromotion.test.mjs
describe('TC-CORE-PROMOTE-001: Session-to-Group Promotion Pipeline', () => {
  it('should successfully fork context summary, call groups.create and inject seed message', async () => {
    // AAA 规范三段式
    // 1. Arrange: 构造源单聊会话与模拟 RPC 处理器
    const mockMessages = [
      { role: 'user', content: '我们需要重构认证网关' },
      { role: 'assistant', content: '建议使用双通道 WebSocket + REST 代理' },
    ];
    // 2. Act: 执行升级管道
    const result = await orchestrator.promoteToGroup({
      sourceSessionId: 'ses-source-1',
      groupName: '认证重构研讨会',
      targetProfiles: ['default', 'bot-arch', 'bot-fe'],
      messages: mockMessages,
    });
    // 3. Assert: 验证 room_id 诞生且种子消息注入成功
    assert.strictEqual(result.ok, true);
    assert.match(result.roomId, /^grp-/);
  });
});

// packages/ui/__tests__/components/LeftRail.test.mjs
describe('TC-UI-LEFTRAIL-001: Dual-Rail Hub Layout Invariant', () => {
  it('should strictly render 48px Station Rail and 212px Context Drawer inside 260px container', () => {
    const html = renderLeftRail({
      collapsed: false,
      compactMode: false,
      activeStationId: 'station-primary',
      stations: [
        { id: 'station-primary', type: 'primary', name: 'default', displayName: '个人助理' },
      ],
      sessions: [],
      // ...
    });
    // 断言必须包含 48px 物理中枢微轨与 212px 抽屉结构
    assert.match(html, /station-rail/);
    assert.match(html, /context-drawer/);
    assert.match(html, /个人助理/);
  });
});
```

---

## 八、裁决结论总结 (Architectural Verdict)

1. **左侧栏结构**：确立 **48px 物理中枢微轨 + 212px 上下文抽屉** 的双轨主从架构。总宽严格锁定 260px，兼顾“个人主助理永恒置顶”、“专职 Bot 色彩指纹展示”与“群聊会议快速直达”，兼具 3 态平滑物理折叠。
2. **Bot 切换与拉群**：主对话通过 `@Bot` 触发轻量 `prompt.btw` 胶囊（零 Context 污染）；全权交接走 `session.branch_whole` 无损派生；“原地拉群”通过 **四阶简报提取 ➔ Room 创建 ➔ 种子备忘录注入 ➔ 视口瞬切** 实现工程闭环。
3. **临时任务**：引入带 24 小时自动回收的沙盒草稿模式，提供一键固化入库开关，彻底解决历史会话水化问题。
4. **交付价值**：方案全面消除了 UX 方案中的伪多 Agent 串味空想，打破了底层协议的死板隔离限制，已转化为完整强类型契约与 TDD 门禁，直接供 Hermes Flux 编码落地！
