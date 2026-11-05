# Hermes Flux Agent & Gateway 设置系统全景架构与实施映射图谱 (Master Settings Map)

本规范针对 **Hermes Agent** 及 **Hermes Gateway**，深度整合了项目中真实存在的 **258 个 JSON-RPC 2.0 契约**、**15 个双向 ServerRequest 请求**与 **72 个下行事件**，同时横向对齐 **Cursor、Claude Code、Windsurf、OpenCode、VS Code Copilot、Cline/Roo Code** 等顶流竞品的工程实践，确立了全平台（Desktop / Web / iOS / Android）设置系统的终极实施图谱。

---

## 零、 顶层架构与三级级联继承模型 (Cascading Scope Hierarchy)

为了兼顾“全局开箱即用”与“专职数字员工个性化独立沙箱”，Hermes Flux 设置体系严格遵循**三级级联覆盖状态机**：

```text
┌────────────────────────────────────────────────────────────────────────┐
│ Level 1: Global Settings (全局根配置)                                   │
│          物理路径: ~/.hermes/config.yaml + ~/.hermes/.env              │
│          适用范围: 网关底座参数、客户端界面偏好、全局 API Key、默认兜底策略 │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (未指定时默认继承)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Level 2: Profile / Bot Settings (专职数字员工级配置)                    │
│          物理路径: ~/.hermes/profiles/<name>/profile.yaml + SOUL.md     │
│          适用范围: 专职 Bot (如架构师、前端专家) 的独立模型、人设、私有技能与 MCP │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (会话运行时临时覆写)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Level 3: Session / Workspace Override (会话与工作区运行时动态覆盖)       │
│          物理路径: 会话运行时内存状态机 (Server._session_info)          │
│          适用范围: 临时 YOLO 模式、单次攻坚提级推理深度、临时 CWD 切换  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 一、 设置功能全景树 (Master Settings Tree)

设置系统划分为 **12 个核心一级功能域**，共 **58 个二级模块**、**140+ 个原子配置项**：

```text
Hermes Flux Settings (设置中心)
├── 01. 通用外观与极客交互 (General & Appearance)
│   ├── 1.1 主题换肤与 Token 引擎 (Themes & Design Tokens)
│   ├── 1.2 字体排印与代码渲染 (Typography & Code Styling)
│   ├── 1.3 窗口形态与三舱视口布局 (Workspace Layout & Rails)
│   ├── 1.4 国际化与语言包 (i18n & Locales)
│   └── 1.5 快捷键与键盘工作流 (Keybindings & Shortcuts)
├── 02. 模型路由与推理算力 (Models & Inference Providers)
│   ├── 2.1 官方 Nous 算力与订阅管理 (Nous Billing & Subscription)
│   ├── 2.2 多模型提供商接入与 API 密钥池 (Providers & API Keys)
│   ├── 2.3 默认模型 Pin 与降级重试 (Default Model Pin & Fallback)
│   ├── 2.4 推理深度与思维链预算 (Reasoning Effort & Thinking Budget)
│   ├── 2.5 快速服务等级与成本高额预警 (Service Tier & Expensive Warnings)
│   └── 2.6 MoA 混合推理与聚合配置 (Mixture-of-Agents Architecture)
├── 03. 智能体行为与自治安全 (Agent Governance & Security Approvals)
│   ├── 3.1 自治模式与四阶安全审批 (YOLO Mode & Approval Matrix)
│   ├── 3.2 敏感命令黑白名单与 Sudo 凭据 (Command Guard & Sudo Escrow)
│   ├── 3.3 敏感文件防读写隔离网 (Protected Paths & Privacy Fencing)
│   └── 3.4 交互式澄清与反问决策 (Interactive Clarification Engine)
├── 04. 专职员工与数字档案 (Bot Profiles & Agent Personas)
│   ├── 4.1 数字员工矩阵管理 (Profile Roster & Lifecycle)
│   ├── 4.2 灵魂人设与 System Prompt (Soul Editor & System Directives)
│   ├── 4.3 终身记忆体维护与修剪 (Long-Term Memory & Memory.md)
│   └── 4.4 专属视觉指纹与头像资产 (Visual Fingerprint & Avatar Assets)
├── 05. MCP 服务器与扩展协议 (MCP Servers & Ecosystem)
│   ├── 5.1 MCP 预设市场与服务器生命周期 (MCP Catalog & Management)
│   ├── 5.2 传输通道配置 (Transport: Stdio / SSE / Stream)
│   ├── 5.3 环境变量注入与敏感凭据托管 (Env Injection & Secret Masking)
│   ├── 5.4 PKCE OAuth 授权与回调轮询 (OAuth Flow & Tool Probing)
│   └── 5.5 工具级细粒度白名单管控 (Tool-Level Permission Gating)
├── 06. 技能库与插件生态 (Skills & Plugins Hub)
│   ├── 6.1 本地与全局技能管理 (Local & Global Skills Management)
│   ├── 6.2 技能热重载与目录扫描 (Skill Hot Reloading & Directory Watcher)
│   ├── 6.3 官方插件中心 (Plugins Hub & Git Install)
│   └── 6.4 插件专属动态设置 Schema (Plugin Dynamic Settings Form)
├── 07. 工作区、项目与代码时光机 (Projects, Workspaces & Rollback)
│   ├── 7.1 本地工程与工作区扫描策略 (Project Scan & Exclude Policies)
│   ├── 7.2 代码时光机快照与还原 (Rollback Checkpoints & Shadow Git)
│   ├── 7.3 上下文自动压缩与截断策略 (Context Window & Auto-Compress)
│   └── 7.4 任务看板与 Worktree 派生规则 (Kanban & Worktree Spawning)
├── 08. 运行时沙箱与虚拟桌面 (Runtime Sandboxes & Virtual Desktop)
│   ├── 8.1 智能体无头/有头浏览器接管 (Browser Use & CDP Controller)
│   ├── 8.2 Linux Xvnc+Xfce 虚拟桌面沙箱 (Display Sandbox & VNC Remote)
│   ├── 8.3 沙箱 Docker 镜像版本切换 (Sandbox Container Image Switch)
│   └── 8.4 宿主终端 Shell 与执行超时 (Host Terminal Shell & Timeouts)
├── 09. 本地凭据保险库与 SaaS 连接器 (Vault & Connectors)
│   ├── 9.1 本地加密凭据库 (Local Encrypted Vault)
│   ├── 9.2 外部密码管理器联动 (Password Managers: 1Password/Bitwarden)
│   ├── 9.3 托管 SaaS 连接器市场 (Connectors Catalog & Accounts)
│   └── 9.4 组织级连接器访问策略 (Connector Policy & Tool Filtering)
├── 10. 语音、多模态与伴侣系统 (Voice, Vision & Pet System)
│   ├── 10.1 唤醒词引擎与麦克风设备 (Wake Word Listener & Input Audio)
│   ├── 10.2 实时语音识别与双工对讲 (Voice Recording, VAD & STT)
│   ├── 10.3 语音合成 TTS 与插话打断 (Speech Synthesis & Barge-in)
│   └── 10.4 桌面极客伴侣宠物系统 (Desktop Pet Companion & Spritesheet)
├── 11. 网络传输、代理与网关集群 (Network, Proxy & Gateway Cluster)
│   ├── 11.1 网关长连接端点与重连看门狗 (Gateway Endpoint & Watchdog)
│   ├── 11.2 HTTP / HTTPS / SOCKS5 全局代理 (Network Proxy & Bypass)
│   ├── 11.3 自定义 CA 证书与离线离境模式 (Custom CA & Offline Isolation)
│   └── 11.4 多网关集群与分布式 Relay (Gateway Roster & Bot Relay)
└── 12. 遥测隐私、诊断与系统维护 (Telemetry, Privacy & Maintenance)
    ├── 12.1 匿名指标收集与共享遥测 (Shared Metrics & Opt-in Toggles)
    ├── 12.2 敏感数据脱敏与隐私防护模式 (Privacy Shield & Prompt Redaction)
    ├── 12.3 诊断日志分级与 Nous 脱敏导出 (Diagnostics Bundle & Log Level)
    └── 12.4 配置备份、一键迁移与出厂重置 (Config Backup, Export & Reset)
```

---

## 二、 逐项功能详细规范与实施映射表 (Implementation Map)

每个配置项严格注明：**功能名称**、**作用**、**优先级（P0/P1/P2）**、**Gateway 是否提供接口**、**相关接口与契约信息**、以及**前端扩展数据与实施属性**。

### 模块 01. 通用外观与极客交互 (General & Appearance)

| 功能项 | 作用 | 优先级 | Gateway 接口 | 相关接口契约信息 | 前端扩展数据与实施属性 |
|---|---|---|---|---|---|
| **1.1.1 主题模式切换** | 在深色模式（Dark）、浅色模式（Light）、跟随系统（System）间切换 | **P0** | **是** | 事件: `skin.changed`<br>RPC: `config.set({ key: 'display.skin', value })`<br>RPC: `config.get({ key: 'display.skin' })` | • 本地键: `flux.theme.mode`<br>• 默认值: `system`<br>• 联动修改 `<html>` 的 `data-theme` 属性 |
| **1.1.2 29-Color Token 微调** | 调节主色调 Accent、背景卡片底色及物理阴影层级 | **P1** | **是** | RPC: `config.set({ key: 'display.palette', value: paletteJson })` | • 本地色板覆盖表 (CSS 变量映射)<br>• 实时预览与重置默认按钮 |
| **1.1.3 毛玻璃与虚化强度** | 调节输入舱与侧边栏的 `backdrop-filter: blur(Npx)` 强度 | **P2** | **否 (纯前端)** | 纯客户端渲染样式 | • 本地键: `flux.ui.blur_intensity`<br>• 默认: `20px`<br>• 低端机支持一键降级为纯色不透明 |
| **1.1.4 减弱动效模式** | 关闭高频动画与平滑过渡，降低 GPU 占用 | **P1** | **否 (纯前端)** | 响应系统 `@media (prefers-reduced-motion)` | • 本地键: `flux.ui.reduced_motion`<br>• 强制集中动画时钟降频至 0Hz |
| **1.2.1 UI 与代码字体族** | 自由设定界面无衬线字体与编辑器等宽字体（Mono） | **P1** | **否 (纯前端)** | 客户端加载本地系统字体或 WebFont | • 本地键: `flux.font.sans`, `flux.font.mono`<br>• 默认: `JetBrains Mono, Fira Code, Consolas` |
| **1.2.2 字号与阅读缩放** | 调整主聊天流 720px 通道内文字大小 (12px ~ 18px) | **P1** | **否 (纯前端)** | 调节 `:root { --flux-font-base: Nrem }` | • 本地键: `flux.ui.font_size`<br>• 快捷键 `Ctrl + = / - / 0` 联动 |
| **1.2.3 终端与代码高亮主题** | 选择 Diff 审查舱与穿透终端的语法着色方案 | **P1** | **否 (纯前端)** | 集成 Shiki / Prism 渲染主题 | • 本地键: `flux.syntax.theme`<br>• 支持 One Dark, GitHub Light, Catppuccin |
| **1.3.1 视口三舱默认折叠态** | 配置冷启动时左侧抽屉（212px）与右侧检查舱（410px）的开合状态 | **P0** | **是** | 事件: 网关 `pane.reveal` / 本地 `layout.apply`<br>RPC: `config.set({ key: 'desktop.layout', value })` | • 本地键: `flux.layout.state`<br>• 结构: `{ leftDrawer: bool, rightPod: bool }` |
| **1.3.2 悬浮输入舱黄金限宽** | 锁定输入框最大宽度（默认 740px），防止大屏拉伸失衡 | **P1** | **否 (纯前端)** | 客户端容器 CSS 几何约束 | • 常量约束: `max-width: 740px`<br>• 严禁在页面祖先节点注入动态变量 |
| **1.4.1 多语言选择** | 切换工作台界面语言（zh-CN / en-US / 更多语言） | **P0** | **是** | RPC: `i18n.languages({ profile })`<br>RPC: `i18n.catalog({ language, surface: 'desktop' })` | • 本地键: `flux.i18n.locale`<br>• 远端网关动态语言包合并至本地字典 |
| **1.5.1 快捷键映射与录制** | 查看并自定义全局快捷键（呼出、切人、折叠双轨、清屏） | **P1** | **否 (纯前端)** | Electron 全局与窗口局部按键监听 | • 默认表: `Cmd+B`(收起抽屉), `Cmd+\`(收起检查舱), `Cmd+K`(聚焦输入舱), `Cmd+N`(新旁聊) |

---

### 模块 02. 模型路由与推理算力 (Models & Inference Providers)

| 功能项 | 作用 | 优先级 | Gateway 接口 | 相关接口契约信息 | 前端扩展数据与实施属性 |
|---|---|---|---|---|---|
| **2.1.1 官方 Nous 算力仪表盘** | 查看官方提供的算力额度余额、已用 Token、计费周期与充值进度 | **P0** | **是** | RPC: `billing.state({ profile })`<br>RPC: `usage.bars({ profile })`<br>RPC: `free_tier.status({ profile })` | • 展示双色进度条 (`available_dollars`, `used_dollars`)<br>• 刷新频率: 打开面板时主动拉取 |
| **2.1.2 自动充值规则配置** | 设定额度低于指定阈值时自动充值固定金额 | **P1** | **是** | RPC: `billing.auto_reload({ threshold, amount })`<br>RPC: `billing.step_up({ scope: 'billing:manage' })` | • 联动 Device-flow 网页鉴权事件 `billing.step_up.verification` |
| **2.1.3 官方订阅套餐升降级** | 切换订阅 Plan（Free / Pro / Team / Enterprise）并预览资费变更 | **P1** | **是** | RPC: `subscription.state({ profile })`<br>RPC: `subscription.preview({ plan_id })`<br>RPC: `subscription.upgrade({ plan_id })`<br>RPC: `subscription.change({ plan_id })` | • 变更前弹出费用试算卡片 (Prorated Quote)<br>• 支持取消次月续订 (`subscription.change`) |
| **2.2.1 模型提供商启用清单** | 启闭 Anthropic, OpenAI, DeepSeek, Google, Ollama, Bedrock 等 20+ 提供商 | **P0** | **是** | RPC: `model.options({ include_unconfigured: true })`<br>RPC: `config.get({ key: 'providers' })` | • 提供商卡片展示: 图标、状态(Ready/Limited/Error)、账户数量 |
| **2.2.2 API 密钥保存与安全脱敏** | 录入并安全存储各提供商的 API Key（落盘至 `.env`） | **P0** | **是** | RPC: `model.save_key({ provider, key, base_url? })`<br>RPC: `model.disconnect({ provider })`<br>RPC: `reload.env({})` | • 界面前端仅回显掩码 `sk-ant-***ABCD`<br>• 物理存储严禁明文进前端缓存 |
| **2.2.3 自定义 Base URL 与反向代理** | 为 OpenAI / Claude 等官方协议指定自建聚合网关或 OneAPI 路由 | **P0** | **是** | RPC: `config.set({ key: 'providers.<id>.base_url', value })` | • 校验格式: 严格合法的 `http://` 或 `https://` 地址<br>• 支持输入框失焦自动探活 |
| **2.2.4 多账号凭据池与轮询熔断** | 同一提供商配置多个 API Key 轮询使用，自动识别限流冷却 | **P1** | **是** | RPC: `model.options` 返回中的 `_pool_usage_accounts` 结构<br>字段: `accounts: [{ id, label, state, resets_at }]` | • 状态感知: `ready` (正常), `limited` (限流冷却), `unavailable` (密钥失效) |
| **2.3.1 全局默认模型 Pin** | 设定新建会话与通用助理的默认模型（如 Claude 3.7 Sonnet） | **P0** | **是** | RPC: `config.set({ key: 'model', value: modelId, scope: 'global' })`<br>RPC: `config.get({ key: 'model' })` | • 支持模型模糊联想下拉框<br>• 显示上下文窗口容量 (128k / 200k / 1M) |
| **2.3.2 故障自动回退模型** | 当主选模型遇到 429 限流或 500 宕机时，自动无感切换至备用模型 | **P1** | **是** | RPC: `config.set({ key: 'model.fallback', value: fallbackModelId })` | • 本地链式回退策略: Primary ➔ Secondary ➔ Local Ollama |
| **2.4.1 推理深度 (Reasoning Effort)** | 设定深度思考模型的推理算力预算 (low / medium / high / xhigh) | **P0** | **是** | RPC: `config.set({ key: 'reasoning_effort', value, scope })`<br>取值: `low` \| `medium` \| `high` \| `xhigh` | • 联动下行事件 `reasoning.delta` 与 `reasoning.available`<br>• 作用域可单会话生效 |
| **2.5.1 快速模式 (Fast Mode)** | 开关 Anthropic / OpenAI 的高优先级快速推理通道 | **P1** | **是** | RPC: `config.set({ key: 'fast', value: bool })`<br>RPC: `config.set({ key: 'service_tier', value: 'auto'/'standard' })` | • 在输入舱右下角显示闪电徽标指示 |
| **2.5.2 昂贵模型调用阻断预警** | 调用如 o1-high, Opus 等高单价模型前强制弹窗二次确认 | **P0** | **是** | RPC: `config.set({ key: 'confirm_expensive_model', value: bool })`<br>RPC: `config.set({ key: 'model', confirm_expensive_model: true })` | • 网关返回 `confirm_required: true` 时前端阻断下发并呈现费用告警卡 |
| **2.6.1 MoA 聚合推理参数** | 开启多模型混合专家投票模式，设定参会参考模型与聚合裁判模型 | **P2** | **是** | RPC: `config.set({ key: 'moa.enabled', value: bool })`<br>RPC: `config.set({ key: 'moa.references', value: modelList })`<br>RPC: `config.set({ key: 'moa.aggregator', value: aggregatorModel })` | • 联动下行事件 `moa.aggregating`, `moa.progress`, `moa.reference` 实时渲染多路模型对照 |

---

### 模块 03. 智能体行为与自治安全 (Agent Governance & Security Approvals)

| 功能项 | 作用 | 优先级 | Gateway 接口 | 相关接口契约信息 | 前端扩展数据与实施属性 |
|---|---|---|---|---|---|
| **3.1.1 YOLO 自治模式总开关** | 开启无人值守模式：Agent 执行 Shell/写文件无需人工点批准 | **P0** | **是** | RPC: `config.set({ key: 'yolo', value: bool, scope: 'global'/'profile'/'session' })`<br>RPC: `config.get({ key: 'yolo' })` | • 强视觉警告：全屏边缘或顶栏出现琥珀色高亮条<br>• 支持单次会话临时开启 |
| **3.1.2 四阶安全审批矩阵** | 细化安全模式：全自动(yolo)、启发式建议(suggest)、严格(paranoid)、自适应(auto) | **P0** | **是** | RPC: `config.set({ key: 'approval_mode', value: mode })`<br>下行请求: `ServerRequestMap.approval`<br>RPC 回复: `approval.respond({ id, decision: 'allow'/'deny'/'always' })` | • 审批卡片带倒计时超时自动拒绝（配合 `approval.received` 启动时钟） |
| **3.2.1 危险命令阻断防护网** | 设定物理黑名单正则表达式（阻断 `rm -rf /`, `mkfs`, `dd` 等） | **P0** | **是** | RPC: `config.set({ key: 'security.blocked_commands', value: stringArray })`<br>RPC: `cli.exec` 返回 `blocked: true` | • 内置不可消除的系统级最小黑名单<br>• 用户可追加自定义阻断关键字 |
| **3.2.2 Sudo 提升权限托管策略** | 配置 Agent 需要 sudo 时的凭据策略（每次询问、5分钟内免密、禁止提权） | **P1** | **是** | 下行请求: `ServerRequestMap.sudo`<br>RPC 回复: `request.answer({ id, result: { value: password } })` | • 密码在内存中短暂驻留，严禁明文落盘<br>• 支持与系统安全密钥链打通 |
| **3.3.1 敏感文件隐私防护网** | 强制屏蔽敏感文件路径，Agent 绝对无法读取或覆写（如 `.env`, `.git/config`, `~/.ssh`） | **P0** | **是** | RPC: `config.set({ key: 'security.protected_paths', value: globPatterns })` | • 默认内置: `**/.env*`, `**/*id_rsa*`, `**/*.key`, `**/secrets.yaml`<br>• 工具执行前做前置沙箱校验 |
| **3.4.1 智能体主动澄清反问策略** | 设定当需求模糊时，允许 Agent 使用 clarify 工具弹窗反问的上限 (1~5问) | **P1** | **是** | 下行请求: `ServerRequestMap.clarify`<br>RPC: `clarify.lock({ question_id, answer })` | • 前端呈现原子问卷卡片，支持用户多选或自由补充条件后一次性锁定提交 |

---

### 模块 04. 专职员工与数字档案 (Bot Profiles & Agent Personas)

| 功能项 | 作用 | 优先级 | Gateway 接口 | 相关接口契约信息 | 前端扩展数据与实施属性 |
|---|---|---|---|---|---|
| **4.1.1 专职 Bot 花名册与生命周期** | 创建、克隆、查看、归档专职数字员工（如架构师老王、前端小张） | **P0** | **是** | RPC: `profiles.list({})`<br>RPC: `profiles.create({ name, clone_from?, mirror_credentials: true })`<br>RPC: `profiles.describe({ name })` | • 列表展示每个 Bot 的专属目录、状态、绑定模型与头像 |
| **4.1.2 专属配置保存 (Editor Save)** | 一键保存该 Bot 的模型 Pin、人设、专属技能集与 MCP 配置 | **P0** | **是** | RPC: `profiles.configure({ name, model?, soul?, skills?, toolsets?, mcp_servers? })` | • 物理写入 `~/.hermes/profiles/<name>/profile.yaml`<br>• 保证其终身主工位（Bot Chat）不受污染 |
| **4.2.1 灵魂人设编辑器 (SOUL.md)** | 可视化编辑该 Bot 的核心性格、角色职责与专业边界提示词 | **P0** | **是** | RPC: `profiles.configure({ name, soul: markdownContent })`<br>RPC: `profiles.describe({ name })` 中的 `soul` 字段 | • 提供 Markdown 语法高亮与变量占位符模板<br>• 提供“测试对话一键验证”抽屉 |
| **4.3.1 长期记忆浏览与修剪** | 查看该 Bot 沉淀在 `MEMORY.md` 中的经验知识切片，支持单条删除或重写 | **P1** | **是** | RPC: `learning.detail({ profile, node_id })`<br>RPC: `learning.edit({ profile, node_id, content })`<br>RPC: `learning.delete({ profile, node_id })` | • 严格遵守铁律：唯有该 Bot 的专属工位才能回写该记忆，群聊记录严禁污染 |
| **4.4.1 专属色彩指纹与 Avatar 头像** | 设定 Bot 的专属超椭圆头像（Base64/PNG）与 16 进制色彩指纹 | **P1** | **是** | RPC: `profiles.set_asset({ name, asset_type: 'avatar', data_url })`<br>RPC: `profiles.get_asset({ name, asset_type: 'avatar' })` | • 架构师默认靛青 `#4F46E5`、前端洋红 `#DB2777`、审查员琥珀 `#D97706`<br>• 32×32px 物理微轨超椭圆呈现 |

---

### 模块 05. MCP 服务器与扩展协议 (MCP Servers & Ecosystem)

| 功能项 | 作用 | 优先级 | Gateway 接口 | 相关接口契约信息 | 前端扩展数据与实施属性 |
|---|---|---|---|---|---|
| **5.1.1 MCP 官方精选市场 (Catalog)** | 浏览官方精选 MCP 服务器（PostgreSQL, GitHub, Brave Search, Puppeteer 等） | **P0** | **是** | RPC: `mcp.catalog({ profile })` | • 展示预设卡片：Logo、介绍、所需环境变量、安装状态 |
| **5.1.2 添加/移除自定义 MCP** | 手动录入命令行或远程 MCP 服务器并落盘配置 | **P0** | **是** | RPC: `mcp.servers.add({ profile, name, preset?, config })`<br>RPC: `mcp.servers.remove({ profile, name })`<br>RPC: `reload.mcp({})` | • 物理写入对应 Profile 的 `config.yaml`<br>• 添加后自动广播 `reload.mcp` 刷新各会话 |
| **5.2.1 传输通道配置 (Transport)** | 支持配置 `stdio`（子进程命令行命令与参数）与 `sse`（HTTP Server-Sent Events） | **P0** | **是** | `McpServerConfig` 结构: `{ command, args, url, headers, env }` | • 表单智能识别：输入 URL 自动切 SSE，输入路径自动切 Stdio |
| **5.3.1 环境变量注入与密钥脱敏** | 为 MCP 进程注入环境变量，敏感 Key 自动隔离进 `.env` | **P0** | **是** | RPC: `mcp.servers.set_api_key({ profile, server_name, env_key, value })` | • 界面前端只显示 `ENV_VAR_NAME` 绑定关系，不回显明文 Secret |
| **5.4.1 PKCE OAuth 外部授权流** | 对支持 OAuth 的 MCP 服务器（如 GitHub / Slack）发起浏览器登录 | **P1** | **是** | RPC: `mcp.servers.oauth.start({ profile, server_name })`<br>RPC: `mcp.servers.oauth.poll({ profile, server_name, flow_id })`<br>RPC: `mcp.servers.oauth.callback({ profile, redirect_url })`<br>RPC: `mcp.servers.oauth.cancel({ flow_id })` | • 自动唤起系统默认浏览器访问授权页<br>• 轮询直到完成，自动持久化 Access Token |
| **5.5.1 服务器探活与工具白名单** | 实时测试 MCP 连接状态，列出注册的 Tools，支持单个工具开关 | **P0** | **是** | RPC: `mcp.servers.test({ profile, name })`<br>RPC: `mcp.servers.status({ profile })`<br>RPC: `tools.configure({ profile, session_id?, toolsets })` | • 状态徽标: `connected`, `connecting`, `failed`, `disabled`<br>• 工具勾选列表支持搜索与权限收紧 |

---

### 模块 06. 技能库与插件生态 (Skills & Plugins Hub)

| 功能项 | 作用 | 优先级 | Gateway 接口 | 相关接口契约信息 | 前端扩展数据与实施属性 |
|---|---|---|---|---|---|
| **6.1.1 技能清单与启用管控** | 查看所有内置、全局与 Profile 专有技能，按需开关 | **P0** | **是** | RPC: `skills.manage({ action: 'list', profile })` | • 技能卡片显示：名称、描述、触发词（Triggers）、路径 |
| **6.1.2 技能安装与删除** | 从外部 Git 仓库或本地目录安装新技能，或归档废弃技能 | **P1** | **是** | RPC: `skills.manage({ action: 'install'/'remove', identifier })`<br>RPC: `learning.delete({ node_id, kind: 'skill' })` | • 物理文件存储于 `~/.hermes/skills/` 或工作区 `.opencode/skills/` |
| **6.2.1 技能热重载 (Hot Reload)** | 修改 `SKILL.md` 后一键重新扫描加载，无需重启网关 | **P0** | **是** | RPC: `skills.reload({})` | • 对应 CLI `/reload-skills` 契约，输出热加载统计报告 |
| **6.3.1 官方插件中心 (Plugins Hub)** | 浏览、安装、升级、启用或卸载官方与社区扩展插件 | **P1** | **是** | RPC: `plugins.list({})`<br>RPC: `plugins.manage({ action: 'list'/'toggle'/'install'/'update'/'remove' })` | • 包含插件能力变更确认 (`accept_capabilities`)<br>• 提示重启需求 (`restart_required`) |
| **6.4.1 插件专属动态设置 Schema** | 自动根据插件 `manifest.json` 的 `settings_schema` 渲染独立配置表单 | **P1** | **是** | RPC: `plugins.manage({ action: 'settings', key, values: Record<string, any> })` | • 动态支持文本输入、开关、下拉、密码框 (`secret`) |

---

### 模块 07. 工作区、项目与代码时光机 (Projects, Workspaces & Rollback)

| 功能项 | 作用 | 优先级 | Gateway 接口 | 相关接口契约信息 | 前端扩展数据与实施属性 |
|---|---|---|---|---|---|
| **7.1.1 项目管理与主路径绑定** | 创建项目实体，绑定 Primary Path（默认 CWD）与关联文件夹 | **P0** | **是** | RPC: `projects.create({ name, primary_path, folders })`<br>RPC: `projects.list({ profile })`<br>RPC: `projects.set_primary({ project_id, folder })` | • 物理保证单一真值源：防项目路径重复 (错误码 5063 阻断) |
| **7.1.2 代码仓库自动发现与排除策略** | 设定磁盘扫描深度、排除目录（如 `node_modules`, `.git`, `dist`） | **P1** | **是** | RPC: `projects.discover_repos({ scan_paths })`<br>RPC: `projects.record_repos({ repos })`<br>RPC: `config.set({ key: 'desktop.repo_scan_excludes', value })` | • 避免全盘盲扫拖垮性能<br>• 联动项目树实时感知本地 Git 仓库 |
| **7.2.1 代码时光机快照开关** | 开启后，Agent 每次修改代码前自动建立 Shadow Git 快照点 | **P0** | **是** | RPC: `config.set({ key: 'rollback.enabled', value: bool })`<br>RPC: `rollback.list({ session_id })` | • 界面支持按时间轴查看每次操作的代码改动快照 |
| **7.2.2 快照审查对比与一键还原** | 对比工作区与历史快照的 Diff，支持全量回滚或单文件回滚 | **P0** | **是** | RPC: `rollback.diff({ session_id, checkpoint_hash })`<br>RPC: `rollback.restore({ session_id, checkpoint_hash, path? })` | • 结合右侧检查舱（InspectionPod）410px 统一呈现代码高亮 Diff |
| **7.3.1 上下文自动压缩阈值** | 当会话历史 Token 超出安全窗口（如 80%）时触发无损自动压缩 | **P1** | **是** | RPC: `config.set({ key: 'session.auto_compress_threshold', value: 0.8 })`<br>RPC: `session.compress({ session_id, focus? })` | • 压缩过程推送状态事件 `status.update(compacting)`<br>• 保留关键决策锚点 |
| **7.4.1 看板分支与 Worktree 生成模板** | 配置从工单派生后台任务时，Git Worktree 目录命名与分支前缀规范 | **P1** | **否 (客户端/项目级)** | 项目根目录 `.hermes/project.json` 规则 | • 默认规则: `.worktrees/wt-{taskId}-{branchName}`<br>• 支持任务完成后自动清理未提交分支 |

---

### 模块 08. 运行时沙箱与虚拟桌面 (Runtime Sandboxes & Virtual Desktop)

| 功能项 | 作用 | 优先级 | Gateway 接口 | 相关接口契约信息 | 前端扩展数据与实施属性 |
|---|---|---|---|---|---|
| **8.1.1 CDP 浏览器接管模式** | 配置 Agent 浏览器自动化方式：内置无头 CDP、外部独立 Chrome、或有头接管 | **P0** | **是** | RPC: `browser.manage({ action: 'inspect'/'attach'/'drop', use: 'cdp'/'builtin' })`<br>事件: `browser.progress`<br>ServerRequest: `preview.act`, `preview.read` | • 支持设置视口分辨率（默认 1280×800）<br>• 支持在前端内嵌实时预览 Canvas/Iframe |
| **8.2.1 远程虚拟桌面沙箱 (Xvnc + Xfce)** | 启动/停止该 Bot 专属的 Linux 桌面沙箱容器，实现人机协同屏幕控制 | **P1** | **是** | RPC: `display.status({ profile })`<br>RPC: `display.start({ profile })`<br>RPC: `display.stop({ profile, force? })`<br>RPC: `display.lease.acquire({})`<br>RPC: `display.lease.release({})`<br>RPC: `display.thumbnail({ profile })` | • 租赁控制协议：人类接管屏幕时 Agent 挂起输入<br>• 画面通过 `/api/display/ws` 流式传输，带低延迟控制 |
| **8.3.1 沙箱 Docker 镜像切换** | 切换沙箱运行底座（Node.js 全栈镜像、Python 数据科学镜像、基础 Ubuntu） | **P2** | **是** | RPC: `display.switchSandboxImage({ profile, image })`<br>RPC: `display.install({ profile })` | • 切换前校验镜像哈希与包签名<br>• 安装进度通过 `display.install.log` 实时滚动 |
| **8.4.1 宿主 Shell 终端偏好与超时** | 设定默认终端执行器（pwsh / bash / zsh）及单条命令硬超时（默认 120s） | **P0** | **是** | RPC: `config.set({ key: 'terminal.shell', value: 'pwsh'/'bash' })`<br>RPC: `config.set({ key: 'terminal.timeout_ms', value: 120000 })`<br>RPC: `process.list`, `process.kill`, `process.stop` | • 终端尺寸通过 `terminal.resize` 与后端 PTY 保持实时字符网格同步 |

---

### 模块 09. 本地凭据保险库与 SaaS 连接器 (Vault & Connectors)

| 功能项 | 作用 | 优先级 | Gateway 接口 | 相关接口契约信息 | 前端扩展数据与实施属性 |
|---|---|---|---|---|---|
| **9.1.1 本地保险库凭据管理** | 管理加密存储在本地安全库的登录账号、API 令牌、数据库连接串 | **P1** | **是** | RPC: `vault.list({ profile })`<br>RPC: `vault.add({ item: { type, title, username, secret, url } })`<br>RPC: `vault.remove({ id })`<br>ServerRequest: `vault.save_login` | • 主密码加密保存在本地系统 Keychain/DPAPI 中<br>• Agent 填表时由网关代填，前端无需暴露明文 |
| **9.1.2 保险库锁定与解锁** | 支持手动或超时自动锁定本地保险库，输入主口令解密 | **P1** | **是** | RPC: `vault.lock({ name? })`<br>RPC: `vault.unlock({ password })`<br>ServerRequest: `vault.unlock_prompt` | • 支持无操作 15 分钟自动上锁<br>• 移动端支持生物识别（Face ID/指纹）联动 |
| **9.2.1 外部密码管理器接入** | 启用 1Password (CLI/op) 或 Bitwarden 作为凭据真值源 | **P2** | **是** | RPC: `vault.sources({ profile })`<br>RPC: `vault.source.set({ name: '1password'/'bitwarden', enabled: bool })` | • 自动探测本机安装的官方 CLI 探针<br>• 状态展示: `detected`, `configured`, `locked`, `ready` |
| **9.3.1 托管 SaaS 连接器授权** | 管理 GitHub, Jira, Slack, Linear, Google Workspace 等 SaaS 连接授权 | **P1** | **是** | RPC: `connectors.catalog({ profile })`<br>RPC: `connectors.list({ profile })`<br>RPC: `connectors.connect({ connector_slug })`<br>RPC: `connectors.accounts({ profile })`<br>RPC: `connectors.accounts.remove({ account_id })` | • 配合下行事件 `connection.request`, `connection.update`<br>• 浏览器完成 OAuth 后通过 `connectors.operation.wake` 唤醒 |
| **9.4.1 连接器工具访问策略** | 按组织/个人范围限制特定连接器暴露给 Agent 的敏感操作（如禁止发公网评论） | **P1** | **是** | RPC: `connectors.policy.get({ profile })`<br>RPC: `connectors.policy.set({ profile, policy_updates })`<br>RPC: `connectors.tools({ profile, connector_slug })` | • 细粒度策略：只读 (Read-Only)、读写 (Read-Write)、禁止访问 (Blocked) |

---

### 模块 10. 语音、多模态与伴侣系统 (Voice, Vision & Pet System)

| 功能项 | 作用 | 优先级 | Gateway 接口 | 相关接口契约信息 | 前端扩展数据与实施属性 |
|---|---|---|---|---|---|
| **10.1.1 唤醒词总开关与状态** | 开启“Hey Hermes”全局免手语音唤醒功能 | **P1** | **是** | RPC: `wake.status({})`<br>RPC: `wake.start({ surface: 'desktop' })`<br>RPC: `wake.stop({ surface: 'desktop', persist: true })`<br>RPC: `wake.pause({})` / `wake.resume({})` | • 联动下行事件 `wake.detected`<br>• 麦克风录音被占用时自动降级 pause |
| **10.1.2 唤醒词灵敏度与麦克风设备** | 选择录音输入物理声卡，调节触发灵敏度阈值与静音检测 (VAD) | **P1** | **是** | `wake.status` 返回中包含 PortAudio 描述的音频设备清单<br>RPC: `config.set({ key: 'wake_word.sensitivity', value })` | • 设备下拉框展示：设备名、采样率、通道数<br>• 音量波形动态实时计（VU Meter）可视化 |
| **10.2.1 语音对讲与 STT 识别** | 按住空格或点击麦克风发送语音，实时转文字上屏 | **P1** | **是** | RPC: `voice.record({ action: 'start'/'stop' })`<br>RPC: `voice.toggle({ enabled: bool })`<br>事件: `voice.partial`, `voice.transcript`, `voice.status` | • 实时预览转录文字流 (`voice.partial`)<br>• 支持中文普通话、英语高精度识别 |
| **10.3.1 TTS 语音引擎与音色选择** | 配置 Agent 答复时的语音合成服务（Edge TTS / ElevenLabs / OpenAI TTS） | **P1** | **是** | RPC: `config.set({ key: 'voice.tts_engine', value })`<br>RPC: `config.set({ key: 'voice.tts_voice_id', value })`<br>RPC: `voice.tts({ text })` | • 音色试听按钮 (`voice.tts` 播放一小段 Demo)<br>• 语速与音调滑块调节 (0.75x ~ 1.5x) |
| **10.3.2 语音插话打断 (Barge-in)** | 当用户在 Agent 朗读过程中开口说话时，立即静音并打断生成 | **P1** | **是** | 联动下行事件 `voice.interrupted`<br>RPC: `session.interrupt({ session_id })` | • 保证双工自然对话体验，避免两边同时说话造成混乱 |
| **10.4.1 桌面伴侣宠物启用与模型** | 在工作台角落启用极客像素/2D 伴侣宠物，选择外观模型 | **P2** | **是** | RPC: `pet.gallery({})`<br>RPC: `pet.select({ slug })`<br>RPC: `pet.disable({})`<br>RPC: `pet.info({ slug })`<br>事件: `pet.changed` | • 展示宠物图鉴列表（猫咪、机器人、企鹅等）<br>• 从后端拉取 Base64 精灵表 (Spritesheet) 进行 Canvas 逐帧动画渲染 |
| **10.4.2 宠物缩放比例与个性化生成** | 调节宠物缩放倍率 (0.5x ~ 2.0x)，或使用 AI 生成定制专属伴侣 | **P2** | **是** | RPC: `pet.scale({ scale: float })`<br>RPC: `pet.generate({ prompt, style })`<br>RPC: `pet.hatch({ draft_id })`<br>事件: `pet.generate.progress`, `pet.hatch.progress` | • 提供缩放滑块实时生效<br>• 生成进度条展示 |

---

### 模块 11. 网络传输、代理与网关集群 (Network, Proxy & Gateway Cluster)

| 功能项 | 作用 | 优先级 | Gateway 接口 | 相关接口契约信息 | 前端扩展数据与实施属性 |
|---|---|---|---|---|---|
| **11.1.1 网关 WebSocket 地址配置** | 配置连接的 Hermes Gateway 地址（支持 `ws://127.0.0.1:8765` 或公网安全 `wss://`） | **P0** | **否 (核心客户端连接)** | 客户端通信连接参数 | • 本地键: `flux.gateway.url`<br>• 默认值: `ws://127.0.0.1:8765`<br>• 地址变更即时重连 |
| **11.1.2 心跳保活与网络半开看门狗** | 设定 Ping/Pong 应用层心跳周期（默认 5s），超时主动切断并触发指数退避重连 | **P0** | **是** | RPC: `ping({})` ➔ 返回 `{ pong: true, time: timestamp }` | • 延迟指标计算: `RTT = receiveTime - sendTime`<br>• 顶栏右上角淡雅 11px 等宽呈现实时延迟（如 `🟢 12ms`） |
| **11.2.1 全局 HTTP / HTTPS / SOCKS5 代理** | 为网络请求配置统一代理通道（适用于访问公网 AI 服务与 GitHub） | **P0** | **是** | RPC: `config.set({ key: 'network.proxy', value: proxyUrl })`<br>RPC: `reload.env({})` | • 格式: `http://127.0.0.1:7890` 或 `socks5://127.0.0.1:1080`<br>• 提供“代理测试连接”按钮 |
| **11.2.2 代理直连绕过名单 (Bypass)** | 配置不经过代理的局域网与内部网段（如 `localhost, 127.0.0.1, *.internal.company`） | **P1** | **是** | RPC: `config.set({ key: 'network.no_proxy', value: bypassList })` | • 逗号分隔的通配符域名与 IP 段 |
| **11.3.1 自定义 CA 根证书注入** | 企业内网安全自签证书或公司 MitM 代理证书导入 | **P1** | **是** | RPC: `config.set({ key: 'network.ca_bundle_path', value: certPath })` | • 解决企业环境 Node/Python `UNABLE_TO_VERIFY_LEAF_SIGNATURE` 痛点 |
| **11.4.1 多网关节点与分布式 Relay** | 接入跨机器或多机架网关，跨设备协同接收派发信封 | **P2** | **是** | RPC: `bot_relay.roster.sync({ peers })`<br>RPC: `bot_relay.deliver({ envelope })`<br>事件: `bot_relay.outbox.pending` | • 查看集群各网关节点在线状态与路由拓扑 |

---

### 模块 12. 遥测隐私、诊断与系统维护 (Telemetry, Privacy & Maintenance)

| 功能项 | 作用 | 优先级 | Gateway 接口 | 相关接口契约信息 | 前端扩展数据与实施属性 |
|---|---|---|---|---|---|
| **12.1.1 共享指标与匿名遥测开关** | 开关匿名功能使用统计、启动耗时与报错反馈 | **P1** | **是** | RPC: `shared_metrics.status({ profile })`<br>RPC: `shared_metrics.set({ enabled: bool, send: bool })` | • 保证严守隐私准则：未经用户许可默认关闭<br>• 关闭后本地所有 `shared_metrics.*` RPC 彻底静默 |
| **12.2.1 提示词与代码隐私保护盾** | 开启后绝对禁止将任何用户对话、代码片段或项目文件名上传到外部监控平台 | **P0** | **否 (客户端/网关级保护)** | 物理切断外部日志打点与 Trace 追踪 | • 本地键: `flux.privacy.shield_mode`<br>• 默认开启（本地优先架构原则） |
| **12.3.1 客户端与网关日志分级** | 调节日志输出详细程度（TRACE / DEBUG / INFO / WARN / ERROR） | **P1** | **是** | RPC: `config.set({ key: 'log.level', value: level })` | • 生产环境默认 INFO，排查问题可瞬切 DEBUG |
| **12.3.2 诊断数据包一键脱敏打包** | 自动抓取系统环境、崩溃栈、网络状态并执行脱敏后打包，便于售后排障 | **P1** | **是** | RPC: `diagnostics.share_nous({ bundle_id, redactions })` | • 自动抹除所有包含 `sk-`、密码、用户名、绝对主目录路径的敏感字段 |
| **12.4.1 配置全量备份与导入导出** | 一键将全套设置（配置文件、Profile 人设、技能配置）导出为 `.zip` 或 `.yaml` | **P0** | **是** | 基于本地文件系统与 RPC: `config.get({ key: 'full' })` | • 换电脑时一键无损导入恢复全部数字员工与配置 |
| **12.4.2 恢复出厂设置 (Factory Reset)** | 清除所有临时缓存、会话数据库或彻底还原所有配置文件至初始状态 | **P0** | **是** | RPC: `onboarding.reset_setup_profile({})` | • 提供高危红色二次密码/确认弹窗<br>• 执行前自动提示创建备份存档 |

---

## 三、 友商竞品标杆对比与优势分析 (Competitor Matrix)

| 核心设置能力维度 | **Hermes Flux (本项目)** | **Cursor** | **Claude Code** | **Windsurf** | **OpenCode** |
|---|---|---|---|---|---|
| **实体继承模型** | **三级实体级联** (Global ➔ Bot Profile ➔ Session) | 全局 + Workspace 两级 | 仅全局 + CLAUDE.md 单一目录 | 仅全局 + Project 两级 | 全局 + Project 两级 |
| **专职数字员工独立人设** | **原生支持**（多 Profile，各自独立的 Soul, Memory, 技能与 MCP） | ❌ 无（所有聊天共享同一个通用模型身份） | ❌ 无（仅单项目单一 Agent 记忆） | ❌ 无 | ❌ 无独立 Profile 沙箱概念 |
| **模型与提供商路由** | **Nous 官方算力 + 私有 Key 池**（轮询熔断、限流冷却感知、高单价拦截） | 私有 API Key（单一主 Key，无池化冷却轮询） | 绑定 Anthropic 官方账号与 Bedrock | 绑定 Codeium 官方账户 | 支持多提供商但需手动指定 |
| **MCP 生态与安全管控** | **完整全功能**（Catalog 市场 + PKCE OAuth + 细粒度工具开关 + 探活） | 基础（手填 JSON 配置，无 OAuth 自动化） | 基础（命令行增删，无可视化配置） | ❌ 弱支持 | 基础 MCP 配置 |
| **多 Agent 协同与群聊** | **原生支持**（Hosted Rooms，群聊设置与单聊记忆物理正交隔离） | ❌ 无群聊概念 | ❌ 仅单行工作流 | ❌ 无群组概念 | ❌ 无跨智能体研讨室 |
| **沙箱隔离与多模态** | **原生支持**（内置 Xvnc+Xfce 虚拟桌面、Docker 镜像切换、CDP 浏览器、唤醒词） | ❌ 无虚拟桌面沙箱 | ❌ 仅本地直接 Bash 执行 | ❌ 仅本地命令 | ❌ 仅本地命令行 |
| **密码凭据与企业集成** | **原生安全 Vault**（本地加密库 + 1Password/Bitwarden 接入 + SaaS 连接器） | ❌ 依赖明文环境变量 | ❌ 依赖本地 `.env` | ❌ 无内置凭据库 | 仅基础 Secret 占位符 |

---

## 四、 逐步实施路线图 (Step-by-Step Implementation Map)

为了保证后续代码实现时有章可循、稳扎稳打且持续通过质量门禁，落地实施分为 **4 个迭代里程碑 (Phases)**：

```text
┌────────────────────────────────────────────────────────────────────────┐
│ Phase 1: 核心基座与模型连接 (Core Foundations & Model Routing)        │
│ 目标: 跑通设置弹窗 UI 框架、全局与 Bot 级级联状态机、提供商与密钥接入     │
│ 涉及模块: 01 (通用), 02 (模型与算力), 03 (自治与审批)                   │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 2: 数字员工沙箱与工具生态 (Profiles, MCP & Tools Ecosystem)       │
│ 目标: 落地专职 Bot 人设编辑、记忆修剪、MCP 预设市场、PKCE OAuth 与技能重载 │
│ 涉及模块: 04 (数字员工), 05 (MCP 服务器), 06 (技能与插件)              │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 3: 工作区、代码时光机与沙箱 (Workspaces, Rollback & Sandboxes)    │
│ 目标: 落地项目排除扫描规则、代码快照对比还原、CDP 浏览器接管与桌面沙箱    │
│ 涉及模块: 07 (项目与时光机), 08 (沙箱与虚拟桌面), 09 (凭据保险库)      │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 4: 多模态交互、网络诊断与系统加固 (Multimodal, Network & Polish) │
│ 目标: 落地唤醒词麦克风、TTS 语音与插话、网络代理、隐私保护盾与配置备份   │
│ 涉及模块: 10 (语音与伴侣), 11 (网络与集群), 12 (遥测与维护)             │
└────────────────────────────────────────────────────────────────────────┘
```

### 里程碑 1 (Phase 1): 核心基座与模型连接
1. **设置弹窗容器组件 (`SettingsModal.tsx`)**：
   - 基于现有设计系统与 Token 规范，采用“左侧 200px 竖向导航 Tab + 右侧流式配置表单”经典布局；
   - 快捷键 `Cmd + ,`（Windows 为 `Ctrl + ,`）全局呼出，左侧微轨底部 `⚙ 设置` 按钮联动挂载。
2. **设置状态机 (`settingsStore.ts`)**：
   - 封装 `useSettingsStore`，底层通过 `HermesGatewayClient` 统一调度 `config.get` 与 `config.set`；
   - 实现三级级联覆盖推导函数 `resolveEffectiveConfig(key, profile?, sessionId?)`。
3. **模型与提供商配置面板 (`ProvidersSettingsPanel.tsx`)**：
   - 接入 `model.options` 与 `model.save_key`，实现主流提供商 API Key 录入、脱敏与 Base URL 映射；
   - 接入 `confirm_expensive_model` 费用阻断告警与 `yolo` 模式作用域选择。

### 里程碑 2 (Phase 2): 数字员工沙箱与工具生态
1. **数字员工人设面板 (`ProfilesSettingsPanel.tsx`)**：
   - 接入 `profiles.list`、`profiles.describe`、`profiles.configure`；
   - 集成 `SOUL.md` 编辑器与专属 Avatar 头像上传（`profiles.set_asset`）；
   - 接入 `learning.detail` 与 `learning.delete` 实现长期记忆卡片修剪。
2. **MCP 与技能管理面板 (`McpSkillsSettingsPanel.tsx`)**：
   - 接入 `mcp.catalog` 预设一键安装与自定义 Stdio/SSE 服务增删；
   - 接入 PKCE OAuth 完整轮询交互（`mcp.servers.oauth.start/poll/callback`）；
   - 接入 `skills.reload` 实现开发技能热重载。

### 里程碑 3 (Phase 3): 工作区、代码时光机与沙箱
1. **项目与代码时光机面板 (`ProjectsRollbackSettingsPanel.tsx`)**：
   - 接入 `projects.create/set_primary` 与仓库扫描忽略规则配置；
   - 联动右侧 410px 检查舱，呈现 `rollback.list` 与 `rollback.diff` 代码对比还原。
2. **沙箱与终端面板 (`SandboxSettingsPanel.tsx`)**：
   - 接入 `browser.manage` 切换 CDP 浏览器接管；
   - 接入 `display.status/start/stop` 监控虚拟桌面沙箱。
3. **本地保险库面板 (`VaultSettingsPanel.tsx`)**：
   - 接入 `vault.list/add/lock/unlock` 实现敏感 Token 加密托管。

### 里程碑 4 (Phase 4): 多模态交互、网络诊断与系统加固
1. **语音与桌面伴侣面板 (`VoicePetSettingsPanel.tsx`)**：
   - 接入 `wake.status/start/stop` 与音频设备选择，接入 `voice.toggle` 与 TTS 音色试听；
   - 接入 `pet.gallery/select/scale` 渲染伴侣宠物。
2. **网络代理与诊断维护面板 (`NetworkMaintenanceSettingsPanel.tsx`)**：
   - 接入 HTTP/SOCKS5 代理配置与连通性测试；
   - 接入 `shared_metrics.set` 遥测隐私开关；
   - 接入 `config.get({ key: 'full' })` 实现配置全量 JSON/YAML 导出与出厂重置。

---

## 五、 质量保证与门禁不变量 (Engineering Gates Checklist)

后续逐步实现该设置功能时，必须严格遵守 `AGENTS.md` 与 `ENGINEERING_DISCIPLINE.md` 的以下硬不变量：
1. **分层解耦铁律**：所有与 Gateway 通信的逻辑必须留在 `packages/core`，UI 组件（`packages/ui`）严禁直接调用裸网络请求；
2. **零假冒交付与类型安全**：所有配置读写必须使用 `gateway-contract.generated.ts` 中的强类型，严禁 `as any` 逃逸；
3. **失败不致空（Failure Is Not Empty）**：网络断开或网关重启时，设置面板必须明确展示重连中/加载失败状态，严禁吞错渲染空配置；
4. **无休止动画防护**：设置面板折叠或关闭时，所有背景轮询（如 MCP 探活、心跳 Ping）必须立即注销停用，禁止空耗 CPU；
5. **双审一票否决**：每阶段代码落盘必须通过 `npm run gates:changed`、`npm run typecheck`、`npm test` 并委派 `flux-code-reviewer` 与 `flux-style-reviewer` 审查通过。
