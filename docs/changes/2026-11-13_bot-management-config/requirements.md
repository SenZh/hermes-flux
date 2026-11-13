# 需求规格说明书：BOT 全生命周期管理与多维配置中枢 (Requirements Specification)

- **文档版本**：v2.3.0（移除搜索框与昂贵模型开关；骨架尺寸与实现对齐）
- **需求状态**：Approved for Architecture Design（架构设计准入）
- **定档级别**：L2 标准需求（严格对齐 `handbook/clarify.md` 全流程规范）
- **责任归属**：Hermes Flux 前端与交互工程组
- **关联规范**：
  - 设计系统总纲：[`docs/design-system/README.md`](../../design-system/README.md)
  - 设计原型：[`docs/prototypes/bot-hero-selector-dual-theme.html`](../../prototypes/bot-hero-selector-dual-theme.html)
  - 网关探针实证基线：`profiles.*` / `skills.*` / `mcp.*`（真实探针 ✅ 0.22.5 覆盖）

---

## §0 摘要与全景复述 (Executive Summary)

### 0.1 意图复述 (5W2H)
1. **Who (面向角色)**：工作台用户（开发者、系统架构师、Prompt 工程师、智能体编排者）。
2. **What (做什么)**：
   - 将原设置中心内「专职员工」全面重构并彻底归一命名为 **「BOT」**（英文「Bots」）；
   - 彻底废除已落后于设计系统的内联 HTML 模态框（`AgentProfileEditorModal.ts`）；
   - 在设置中心内置**头像滑动选择器 + 双层配置工作舱**（顶部 148px 一行 5 个头像连续滑动，下方高频配置区 + 折叠抽屉）；
   - 端到端闭环支持：BOT 花名册纳管、空白新建与继承克隆、基础身份与头像资产维护、模型绑定、SOUL.md 灵魂人设、能力与工具集（Skills / 内置 Toolsets / MCP Servers）、长期记忆主工位保护说明，以及宿主级未保存拦截与防重防丢机制。
3. **Why (为什么做)**：
   - **体验割裂与设计退化**：当前设置中心仅有只读列表，点击编辑直接关闭设置页弹出一个样式硬编码的旧 HTML 浮层，破坏单页心流且不符合当前 Token 与微距发丝线规范；
   - **配置能力严重残缺**：现存界面仅能改个名字和静态描述，关键的灵魂人设、模型变更、技能插件按 BOT 裁剪、MCP 挂载等核心能力无法在 GUI 中闭环。
4. **Where (系统边界与归属)**：
   - 物理宿主：设置中心（`SettingsModal`）中的「BOT」专属分区；
   - **单向分层至高无上规范**：
     $$\text{packages/desktop (settingsController)} \xrightarrow{\text{注入快照与回调}} \text{packages/ui (BotManagerView)} \xrightarrow{\text{调用纯服务}} \text{packages/core (ProfileService)}$$
5. **How Much (交付边界与指标)**：
   - 包含 20 个原子功能定义（F-01 ~ F-20）；
   - 覆盖 12 维需求探针，EARS 验收标准 100% 覆盖正反路径（共 32 条原子断言）；
   - 0 Token 硬编码、0 TS 类型逃逸、门禁通过率 100%。

---

## §1 范围边界与非目标 (Scope & Boundaries)

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              BOT 管理配置中枢系统边界拓扑                               │
├────────────────────────────────────────┬───────────────────────────────────────────────┤
│           IN SCOPE (第一期必做)        │           OUT OF SCOPE (明确禁止越界)         │
├────────────────────────────────────────┼───────────────────────────────────────────────┤
│ 1. 命名与文案：全面彻底归一更名为 BOT    │ 1. 群聊研讨室 (Group Room) 底层通信与调度逻辑  │
│ 2. 交互形态：一行 5 头像滑动选择器         │ 2. 临时排查会话 (Scratchpad) 的生命周期改造    │
│ 3. BOT 生命周期：花名册、空白新建、克隆 │ 3. 物理删除 BOT 目录 (网关无 RPC，本期禁止删除)│
│ 4. 身份资产：ID、显示名、描述、头像设置 │ 4. 跨机器/跨节点分布式 Bot Relay 路由中继     │
│ 5. 模型配置：绑定模型、提供商           │ 5. 在设置页内直接执行流式对话测试或聊天回放   │
│ 6. 灵魂人设：SOUL.md 提示词等宽编辑器   │ 6. 自动为 BOT 生成人设的外部 AI 魔法生成向导   │
│ 7. 工具矩阵：Skills 禁用/Toolsets/MCP  │ 7. 长期记忆 (learning.*) 人工切片修剪 (见 1.1) │
│ 8. 安全防护：宿主级未保存拦截、草稿永存│ 8. Connectors/Delegation 配置 (未探针，入二期) │
│                                        │ 9. BOT 名称/ID 检索框 (F-02，本期不做)        │
│                                        │ 10. 昂贵模型调用确认开关 (F-11，本期不做)     │
└────────────────────────────────────────┴───────────────────────────────────────────────┘
```

---

## §2 空间骨架与选择器交互规范 (Geometry & Selector)

### 2.1 空间骨架结构与垂直层叠 (Layout & Stacking)
- **设置中心外壳 (SettingsModal)**：维持既有 `w-[900px] max-w-[94vw] h-[min(680px,calc(100vh-96px))]` 几何约束；
- **BOT 面板空间排布**：
  - **外层容器**：`flex flex-col h-full min-h-0 w-full overflow-y-auto` 单一顺畅纵向滚动，不再套第二层 `max-height`；
  - **顶部头像滑动视口**：高度严格控制在 **`148px`**，一行恰好 5 个头像，槽位步进按视口自适应并让开左右各 44px 导航按钮；
  - **工具条**：仅承载「恢复默认头像」，右对齐，不设搜索框；
  - **失败横幅**：仅出错时出现，位于工具条与配置区之间，不遮挡表单；
  - **中部高频配置区**：单列，一行一项，承载 BOT ID、显示名、绑定模型、职能描述、默认 BOT 开关；
  - **中下部折叠抽屉区**：采用 CSS Grid `0fr -> 1fr` 硬件加速展开，承载 SOUL.md 编辑器、Toolsets、Skill、MCP、长期记忆说明；
  - **底部悬浮操作栏**：贴底常驻，承载「新建 / 克隆」「重置」「保存配置」。

### 2.2 5 槽位复用与数量退化规范 (Slot Pooling & Degrade)
- **槽位复用**：DOM 固定初始化 5 个，禁止每帧重建；近大远小全部由 GPU 纯合成层属性驱动：`transform: translate3d(...) scale(...)`；
- **数量退化规范（防止除零崩溃与重复克隆）**：
  - **$N = 0$ (空花名册)**：隐藏滑动器与配置区，居中展示说明与「创建首个 BOT」主按钮；
  - **$N = 1$**：仅正中心展示该 BOT，其余槽位置空（`opacity: 0`），禁用滑动；
  - **$N = 2 \sim 4$**：按实际数量平铺，禁用环形取模，滑动范围夹在 $[0, N-1]$；
  - **$N \ge 5$**：启用完整 5 槽位环形衔接。

---

## §3 全景 CRUD 操作语义与 Gateway 契约映射矩阵

| 业务域 | 操作名称 | CRUD 语义 | 界面动作与作用说明 | 调用的 Gateway 契约 | 核心入参 (Params) | 核心出参 (Result) | 探针覆盖 |
|---|---|---|---|---|---|---|---|
| **花名册** | 拉取花名册 | **Read (查)** | 批量获取系统中已注册的所有 BOT 基础清单（ID、显示名、模型、默认标识） | `profiles.list` | `{ include_sessions: false }` | `{ profiles: AgentProfile[] }` | ✅ 0.22.5 |
| **花名册** | 查询 BOT 详情 | **Read (查)** | 获取选中 BOT 的完整配置档案（人设 SOUL、当前模型、已开启工具集、MCP列表） | `profiles.describe` | `{ name: botId }` | `{ name, description, soul, model, toolsets, mcp_servers }` | ✅ 0.22.5 |
| **生命周期** | 空白新建 BOT | **Create (增)** | 创建一个全新的 BOT 独立配置目录与基础配置 | `profiles.create` | `{ name, description?, soul?, model?, provider?, share_auth: true }` | `{ ok: boolean, name: string, path: string }` | ✅ 0.22.5 |
| **生命周期** | 克隆已有 BOT | **Create (增)** | 基于现有 BOT 完整复制其配置、人设、可选复制消息渠道与授权凭据 | `profiles.create` | `{ name, clone_from: srcId, clone_channels?: boolean, mirror_credentials?: boolean, no_skills?: boolean }` | `{ ok: boolean, name: string, mirrored: boolean }` | ✅ 0.22.5 |
| **生命周期** | 设为默认 BOT | **Update (改)** | 将当前 BOT 设置为主工作区全局默认交互 BOT | `profiles.configure` | `{ name: botId, ui_meta: { 'hermes-bots': { is_default: true } } }` | `{ ok: boolean, applied: string[] }` | ✅ 0.22.5 |
| **基础身份** | 修改显示名 | **Update (改)** | 修改在 UI 列表、聊天标题栏展示的自然语言名称 | `profiles.configure` | `{ name: botId, ui_meta: { 'hermes-bots': { title: newDisplayName } } }` | `{ ok: boolean, applied: string[] }` | ✅ 0.22.5 |
| **基础身份** | 修改功能描述 | **Update (改)** | 更新 BOT 的职责说明，便于编排与检索识别 | `profiles.configure` | `{ name: botId, description: newDesc }` | `{ ok: boolean, applied: string[] }` | ✅ 0.22.5 |
| **头像资产** | 查询头像资产 | **Read (查)** | 查询该 BOT 是否已上传自定义头像图片 | `profiles.get_asset` | `{ name: botId, asset: 'avatar' }` | `{ found: boolean, data: string, mime: string }` | ✅ 0.22.5 |
| **头像资产** | 上传设置头像 | **Update (改)** | 将客户端裁剪好的 Base64 图片写入网关资产目录 | `profiles.set_asset` | `{ name: botId, asset: 'avatar', data: base64Data }` | `{ ok: boolean, asset: 'avatar', size: number }` | ✅ 0.22.5 |
| **头像资产** | 重置为默认图腾 | **Delete (删)** | 删除该 BOT 已绑定的自定义头像，退回几何图腾 | `profiles.set_asset` | `{ name: botId, asset: 'avatar', data: '', clear: true }` | `{ ok: boolean, removed: boolean }` | ✅ 0.22.5 |
| **模型绑定** | 切换主模型 | **Update (改)** | 绑定该 BOT 执行推理任务的主模型与 Provider | `profiles.configure` | `{ name: botId, model: modelId, provider: providerId }` | `{ ok: boolean, applied: string[] }` | ✅ 0.22.5 |
| **模型绑定** | 昂贵模型确认 | **本期不做** | 配置页不提供该开关；拦截属于主工作区调用链路行为，不在 BOT 配置中枢暴露 | — | — | — | — |
| **灵魂人设** | 编辑保存人设 | **Update (改)** | 更新 SOUL.md，重新定义系统提示词与角色边界 | `profiles.configure` | `{ name: botId, soul: markdownContent }` | `{ ok: boolean, applied: string[] }` | ✅ 0.22.5 |
| **能力矩阵** | 禁用指定技能 | **Update (改)** | 在该 BOT 上关闭全局安装的某技能（个性化黑名单） | `profiles.configure` | `{ name: botId, disabled_skills: string[] }` | `{ ok: boolean, applied: string[] }` | ✅ 0.22.5 |
| **能力矩阵** | 查询技能清单 | **Read (查)** | 动态拉取当前 profile 可见的所有已安装技能状态 | `skills.manage` | `{ profile: botId, action: 'list' }` | `{ skills: SkillItem[], total: number }` | ✅ 0.21.6 |
| **能力矩阵** | 启闭内置工具集 | **Update (改)** | 开关 `web_search`, `shell`, `file_ops`, `code_review` | `profiles.configure` | `{ name: botId, enabled_toolsets: string[] }` | `{ ok: boolean, applied: string[] }` | ✅ 0.22.5 |
| **能力矩阵** | 绑定 MCP 服务 | **Update (改)** | 声明该 BOT 启动时需要连接哪些外部 MCP 服务 | `profiles.configure` | `{ name: botId, enabled_mcp_servers: string[] }` | `{ ok: boolean, applied: string[] }` | ✅ 0.22.5 |
| **能力矩阵** | 查 MCP 探活状态 | **Read (查)** | 检视已登记 MCP 服务的实时健康度（在线/离线） | `mcp.servers.status` | `{ profile: botId }` | `{ servers: McpServerStatus[], checked_at: number }` | ✅ 0.21.6 |

---

## §4 细粒度功能规格（20 项原子功能 F-01 ~ F-20 完整闭环）

### 4.1 花名册与选择器域 (F-01 ~ F-03)
- **F-01：头像滑动选择器（一行 5 个，近大远小连续滑动）**：
  - **触发**：切换至 BOT 设置分区；
  - **行为**：在 148px 视口内一行恰好展示 5 个 BOT 头像，中间 76px、两侧约 58px、最外侧约 40px；透明度下限 0.55，保证 5 个全部可辨识；槽位步进按视口自适应并让开左右各 44px 导航按钮，窄窗口下不裁切、不重叠；滚轮与拖拽连续滑动，松手吸附居中；BOT 数量 ≥ 5 时环形衔接，不足 5 个时按实际数量平铺且不做重复克隆；
  - **防抖取数**：滑动中仅消费本地缓存，静止磁吸后施加 160ms 防抖，再触发 `profiles.describe` 获取完整详情。
- **F-02：BOT 快速检索（本期不做）**：
  - **决策**：界面不设搜索框，BOT 切换一律通过滑动选择器完成。原「输入关键字定位」能力移出本期范围，待 BOT 数量增长到需要分组时另立需求。
- **F-03：空花名册与异常兜底引导**：
  - **行为**：当 `profiles` 列表为空时，隐藏滑动器与配置区，居中展示说明与「创建首个 BOT」主按钮；网络或网关报错时展示带具体错误原因的重试卡片。

### 4.2 生命周期管理域 (F-04 ~ F-06)
- **F-04：空白新建向导 (Create Blank)**：
  - **输入校验**：BOT ID 必须匹配 `/^[a-zA-Z0-9_-]{1,64}$/`；中文、空格或特殊字符直接在失焦时标红；前端预检已有 BOT 重复性；
  - **调用**：`profiles.create({ name, description, soul, model, provider, share_auth: true })`；
  - **后置**：成功后调用 `profiles.list` 刷新花名册，选择器平滑滚动至新建项并高亮。
- **F-05：基于已有 BOT 克隆 (Create Clone)**：
  - **行为**：从下拉框选择源 BOT，支持继承通信渠道（`clone_channels`）与凭据（`mirror_credentials`）；
  - **调用**：`profiles.create({ name: newId, clone_from: srcId, clone_channels, mirror_credentials })`。
- **F-06：核心默认 BOT 物理保护与生命周期约束**：
  - **规则**：全系统严格禁止在 UI 上删除任何 BOT（网关无 `profiles.delete` 契约，见 §1.1）；带有 `isDefault: true` 标记的核心 BOT 受最高级物理保护。

### 4.3 基础身份与资产域 (F-07 ~ F-09)
- **F-07：显示名、ID 与功能描述维护**：
  - **行为**：BOT ID 只读并提供一键复制；显示名修改写入 `ui_meta['hermes-bots'].title`；描述修改写入 `description`。
- **F-08：自定义头像上传与图腾重置**：
  - **行为**：选择本地图片后客户端等比压缩为 256×256px WebP，随保存按钮调用 `profiles.set_asset({ name, asset: 'avatar', data })`；点击恢复图腾调用 `profiles.set_asset({ name, asset: 'avatar', data: '', clear: true })`。
- **F-09：设为主工作区默认 BOT**：
  - **调用**：`profiles.configure({ name: botId, ui_meta: { 'hermes-bots': { is_default: true } } })`。

### 4.4 模型与计算绑定域 (F-10 ~ F-11)
- **F-10：主执行模型下拉绑定**：
  - **行为**：按 Provider 分组展示所有可用模型；若当前绑定的模型暂时离线，下拉框置顶展示并标注为「[离线/不可用]」，禁止静默清空。
- **F-11：昂贵模型调用确认（本期不做）**：
  - **决策**：配置页不提供「调用高单价昂贵模型前弹出确认」开关。该拦截属于主工作区调用链路的行为，不在 BOT 配置中枢内暴露。原 `confirm_expensive_model` 前端开关移出本期范围。

### 4.5 灵魂人设域 (F-12 ~ F-13)
- **F-12：SOUL.md 提示词等宽全景编辑器**：
  - **安全边界**：输入框设置 **64KB (约 50,000 字)** 客户端软拦截，超出时在文本框底部标黄警告；
  - **调用**：`profiles.configure({ name: botId, soul: textContent })`。
- **F-13：变量占位符辅助与预设模板**：
  - **行为**：提供预设极客模板一键填充；支持点击插入 `{{user_name}}`、`{{workspace_root}}` 动态变量。

### 4.6 能力、技能与工具集域 (F-14 ~ F-17)
- **F-14：技能个性化黑名单配置**：
  - **行为**：展示技能列表；用户取消勾选的技能被汇聚为 `disabled_skills` 数组，通过 `profiles.configure` 保存。
- **F-15：内置工具集启闭网格**：
  - **行为**：开关 `web_search`, `shell`, `file_ops`, `code_review`，汇总为 `enabled_toolsets` 数组提交。
- **F-16：MCP 外部服务绑定与探活**：
  - **行为**：调用 `mcp.servers.status({ profile: botId })` 呈现绿灯/红灯探活状态；勾选生效项保存至 `enabled_mcp_servers`。
- **F-17：长期记忆主工位保护说明**：
  - **行为**：明确向用户展示说明卡片：“长期记忆由该 BOT 终身主工位 (Forever Chat) 权威收敛维护，配置中枢暂不开放跨上下文人工修剪”。

### 4.7 交互守卫与数据安全域 (F-18 ~ F-20)
- **F-18：局部草稿池与宿主级未保存拦截协议 (Draft Pool & Host Exit Guard)**：
  - **局部草稿映射**：用户输入实时存入 `draftPool: Map<botId, Draft>`，选择器滑动自由流畅不弹窗锁死，中心头像角上显示未保存标记点；
  - **离场拦截**：切换一级 Tab、按 `Esc` 键、点击 Backdrop 时，外层宿主统一呼出「放弃修改 / 保存草稿 / 留在当前」阻断弹窗。
- **F-19：显式失败与草稿绝对保护**：
  - **规则**：无论由于网络断开还是网关返回 4000/4062，**绝对禁止重置或清空表单**；错误信息挂载在面板顶部横幅，草稿 100% 保持。
- **F-20：并发提交防重入与只读锁定**：
  - **规则**：在 `[SAVING]` 状态下，界面对当前所有输入框与卡片切换施加只读锁（Busy Lock），保存按钮呈现微距 Spinner，防止重复连击。

---

## §5 状态机模型与流转图 (FSM)

```text
[UNINITIALIZED] ──(进入 BOT 面板)──> [FETCHING_LIST]
                                          │
            ┌─────────────────────────────┼────────────────────────────┐
            ▼                             ▼                            ▼
      [LIST_ERROR]                  [EMPTY_LIST]                 [IDLE_SELECT]
    (错误卡片+重试)               (首个 BOT 引导)             (默认选中激活首项)
            │                             │                            │
            └──────────(重试刷新)─────────┴────────────────────────────┼──────────────────────────────┐
                                                                       │                              │
                                                      (连续滑动轮播/暂存草稿/!HostExit)              (点击「+ 新建 BOT」)
                                                                       ▼                              ▼
                                                                [SLOT_LERPING]                    [CREATING]
                                                                       │ (稳态磁吸且停机)             │
                                                                       ▼                              │
                                                      ┌──────────> [EDITING] (isDirty=true)           │
                                                      │                │                              │
                                                (修改任一字段)         ├─(试图关窗/切Tab/Esc)        │
                                                      │                ▼                              │
                                                      │        [CONFIRM_HOST_EXIT]                    │
                                                      │           │            │                      │
                                                      │      (点击放弃)    (点击继续)                 │
                                                      │           ▼            │                      │
                                                      │    [放行离场动作]      └─> [EDITING]          │
                                                      │                                               │
                                                      └────────────────┬──────────────────────────────┘
                                                                       │ (点击保存更改 / 立即创建)
                                                                       ▼
                                                                   [SAVING]
                                                                       │
                                                       ┌───────────────┴───────────────┐
                                                       ▼                               ▼
                                                 (RPC 返回 ok)                   (RPC 报错/校验失败)
                                                       │                               │
                                                       ▼                               ▼
                                                 [IDLE_SELECT]               [EDITING] / [CREATING]
                                            (清除 isDirty，Toast 反馈)      (表单顶部挂载显式错误，草稿全量保持)
```

---

## §6 EARS 验收标准（正反路径 100% 覆盖，32 条原子断言）

### 6.1 花名册与选择器域 (AC-01 ~ AC-06)
- **AC-01 (正向)**：`THE SYSTEM SHALL` 将设置中心左侧导航中的对应项统一显示为「BOT」（英文「Bots」）；
- **AC-02 (正向)**：`WHEN` 用户进入 BOT 面板时 `THEN THE SYSTEM SHALL` 调用 `profiles.list` 在 148px 视口内一行渲染 5 个头像（中间最大、两侧次之、最外侧最小且透明度不低于 0.55），并默认选中首项；
- **AC-03 (正向)**：`WHEN` 用户滑动滚轮或拖拽选择器 `THEN THE SYSTEM SHALL` 连续平滑位移并在静止时自动吸附对齐正中 BOT；
- **AC-04 (反向)**：`IF` 花名册中 BOT 数量少于 5 个 `THEN THE SYSTEM SHALL` 按实际数量平铺展示并禁止产生同名重复克隆；
- **AC-05 (反向)**：`IF` 花名册列表为空 `THEN THE SYSTEM SHALL` 隐藏选择器与配置区，呈现「创建首个 BOT」的空数据引导视图；
- **AC-06 (反向)**：`IF` `profiles.list` 接口报错或网络断开 `THEN THE SYSTEM SHALL` 呈现包含真实错误文本的重试卡片。

### 6.2 生命周期域 (AC-07 ~ AC-12)
- **AC-07 (正向)**：`WHEN` 用户提交合法空白新建表单 `THEN THE SYSTEM SHALL` 调用 `profiles.create` 发起创建，并在成功后刷新花名册并高亮新 BOT；
- **AC-08 (反向)**：`IF` 新建时输入的 BOT ID 包含中文或空格 `THEN THE SYSTEM SHALL` 在前端阻止提交并显示格式校验错误；
- **AC-09 (反向)**：`IF` 新建时输入的 BOT ID 与已有 BOT 冲突 `THEN THE SYSTEM SHALL` 在 ID 输入框下方标红提示已存在，且保持表单内容不变；
- **AC-10 (正向)**：`WHEN` 用户选择克隆自源 BOT `THEN THE SYSTEM SHALL` 携带 `clone_from: sourceId` 调用 `profiles.create`；
- **AC-11 (反向)**：`IF` 克隆时选中的源 BOT 已不存在 `THEN THE SYSTEM SHALL` 在表单顶部提示源对象失效并阻止提交；
- **AC-12 (恒定)**：`THE SYSTEM SHALL` 在界面上绝不向用户呈现任何物理删除 BOT 的按钮或操作入口。

### 6.3 基础身份与资产域 (AC-13 ~ AC-18)
- **AC-13 (正向)**：`WHEN` 用户修改显示名并保存 `THEN THE SYSTEM SHALL` 调用 `profiles.configure` 将新名称写入 `ui_meta['hermes-bots'].title`；
- **AC-14 (正向)**：`WHEN` 用户修改描述并保存 `THEN THE SYSTEM SHALL` 调用 `profiles.configure` 将描述写入 `description` 字段；
- **AC-15 (正向)**：`WHEN` 用户上传新头像 `THEN THE SYSTEM SHALL` 在客户端完成裁剪预览，并在保存时调用 `profiles.set_asset` 上传 Base64；
- **AC-16 (反向)**：`IF` 用户上传的头像文件体积超过 2MB 或非图片格式 `THEN THE SYSTEM SHALL` 阻止上传并弹出轻量警告提示；
- **AC-17 (正向)**：`WHEN` 用户点击「恢复默认图腾」并保存 `THEN THE SYSTEM SHALL` 调用 `profiles.set_asset` 携带 `clear: true` 移除自定义头像；
- **AC-18 (正向)**：`WHEN` 用户将当前 BOT 设为默认并保存 `THEN THE SYSTEM SHALL` 写入 `ui_meta` 并将 Default 徽章转移至当前卡片。

### 6.4 模型与灵魂人设域 (AC-19 ~ AC-24)
- **AC-19 (正向)**：`WHEN` 用户切换主模型并保存 `THEN THE SYSTEM SHALL` 调用 `profiles.configure` 绑定 `model` 与 `provider`；
- **AC-20 (反向)**：`IF` 当前绑定的模型在供应商列表中已离线 `THEN THE SYSTEM SHALL` 下拉框保留其值并追加「[离线/不可用]」标注；
- **AC-21 (恒定)**：`THE SYSTEM SHALL` 不在 BOT 配置页提供「昂贵模型调用确认」开关（该能力本期不纳入配置中枢）；
- **AC-22 (正向)**：`WHEN` 用户编辑 SOUL.md 并保存 `THEN THE SYSTEM SHALL` 调用 `profiles.configure` 将 Markdown 内容存入 `soul`；
- **AC-23 (反向)**：`IF` SOUL.md 文本长度超过 64KB `THEN THE SYSTEM SHALL` 在编辑器下方显示超长字符警告条；
- **AC-24 (反向)**：`IF` 保存人设时网关报错 `THEN THE SYSTEM SHALL` 在顶部展示错误原因，且必须 100% 保持当前编辑器中的草稿。

### 6.5 工具、能力与守卫域 (AC-25 ~ AC-32)
- **AC-25 (正向)**：`WHEN` 用户开关某个技能 `THEN THE SYSTEM SHALL` 将所有被关闭的技能汇总为 `disabled_skills` 数组并在保存时提交；
- **AC-26 (正向)**：`WHEN` 用户开关内置工具集 `THEN THE SYSTEM SHALL` 汇总为 `enabled_toolsets` 数组并在保存时提交；
- **AC-27 (正向)**：`WHEN` 用户勾选生效的 MCP 服务 `THEN THE SYSTEM SHALL` 汇总为 `enabled_mcp_servers` 并在保存时提交；
- **AC-28 (正向)**：`WHEN` 选择器切换至已有草稿的 BOT `THEN THE SYSTEM SHALL` 优先从局部草稿池加载已修改的数据并亮起未保存标记点；
- **AC-29 (状态)**：`WHILE` 存在未保存草稿 `IF` 用户尝试切换设置中心其他一级 Tab `THEN THE SYSTEM SHALL` 弹出宿主离场确认对话框；
- **AC-30 (状态)**：`WHILE` 存在未保存草稿 `IF` 用户按下键盘 `Esc` 键或点击 Backdrop `THEN THE SYSTEM SHALL` 阻断关窗并弹出离场确认对话框；
- **AC-31 (行为)**：`WHEN` 用户在离场确认对话框中点击「放弃修改」`THEN THE SYSTEM SHALL` 销毁草稿并放行离开动作；
- **AC-32 (防重)**：`WHILE` 数据处于 `[SAVING]` 状态 `THE SYSTEM SHALL` 对所有输入框与卡片切换施加只读锁，并展示 Loading 旋转态。

---

## §7 国际化双语字典规约 (i18n SSOT)

严格遵守 `Gate 4b` 零硬编码规范，所有文本收敛在 `packages/ui/src/i18n/` 中：

```typescript
export const BOT_I18N_SCHEMA = {
  'settings.sectionAgents': { zh: 'BOT', en: 'Bots' },
  'settings.sectionAgentsDesc': { zh: '管理 BOT 花名册、模型绑定、灵魂人设与工具矩阵', en: 'Manage BOT roster, models, soul personas and toolsets' },
  'bot.searchPlaceholder': { zh: '搜索 BOT 名称、ID 或模型...', en: 'Search BOT name, ID or model...' },
  // 注：F-02 检索本期不做，此键暂不启用
  'bot.emptyRoster': { zh: '暂无配置的 BOT', en: 'No BOTs configured yet' },
  'bot.createFirst': { zh: '创建首个 BOT', en: 'Create First BOT' },
  'bot.createBtn': { zh: '新建 BOT', en: 'New BOT' },
  'bot.cloneFrom': { zh: '克隆自已有 BOT', en: 'Clone from existing BOT' },
  'bot.idLabel': { zh: 'BOT 唯一标识符 (ID)', en: 'BOT Identifier (ID)' },
  'bot.idPlaceholder': { zh: '例如: architect, frontend_agent', en: 'e.g. architect, frontend_agent' },
  'bot.idError': { zh: 'ID 仅允许 1-64 位英文字母、数字、下划线与短横线', en: 'ID must be 1-64 characters of letters, numbers, _ or -' },
  'bot.idConflict': { zh: '该 BOT 标识符已被占用，请使用其他名称', en: 'BOT identifier is already taken' },
  'bot.nameLabel': { zh: '显示名称', en: 'Display Name' },
  'bot.descLabel': { zh: '职能描述', en: 'Description' },
  'bot.avatarUpload': { zh: '更换头像', en: 'Change Avatar' },
  'bot.avatarReset': { zh: '恢复图腾', en: 'Reset to Totem' },
  'bot.setDefault': { zh: '设为默认 BOT', en: 'Set as Default BOT' },
  'bot.modelBinding': { zh: '主推理模型', en: 'Primary Model' },
  'bot.soulTitle': { zh: '灵魂人设 (SOUL.md)', en: 'Soul Persona (SOUL.md)' },
  'bot.soulLengthWarn': { zh: '当前提示词已接近 64KB 阈值，请避免过长输入导致通信超限', en: 'Prompt length approaching 64KB threshold' },
  'bot.skillsTitle': { zh: '技能与能力矩阵', en: 'Skills & Capabilities' },
  'bot.toolsetsTitle': { zh: '内置核心工具集', en: 'Built-in Toolsets' },
  'bot.mcpTitle': { zh: 'MCP 外部服务绑定', en: 'MCP External Servers' },
  'bot.memoryTitle': { zh: '长期记忆与知识切片', en: 'Long-term Memory' },
  'bot.memoryNotice': { zh: '记忆受单向隔离物理保护，仅可在其专属主工位中自然沉淀', en: 'Memory is isolated and only updated via its canonical Forever Chat' },
  'bot.discardConfirmTitle': { zh: '未保存的配置草稿', en: 'Unsaved Changes' },
  'bot.discardConfirmBody': { zh: '当前 BOT 存在尚未保存的修改。如果离开，所有已编辑内容将被丢弃。', en: 'You have unsaved changes. Leaving will discard your edits.' },
  'bot.discardBtn': { zh: '放弃修改', en: 'Discard Changes' },
  'bot.stayBtn': { zh: '留在当前', en: 'Stay Here' },
  'bot.saveBtn': { zh: '保存更改', en: 'Save Changes' },
  'bot.saving': { zh: '正在保存...', en: 'Saving...' },
};
```
