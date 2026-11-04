# Hermes Flux 设置中心交互与 UI 终极设计规范 (Settings Interaction & Visual Design Spec)

> **定位说明**：本文档确立了 **Hermes Flux**（桌面端 Electron、Web、移动端 iOS/Android Capacitor 8）设置体系的终极定稿交互架构（UX Architecture）与高保真视觉设计规范（UI Spec）。
> 核心定稿原则：**系统全局设置 (Global Settings Modal)** 与 **专职数字员工配置 (Agent Persona Modal)** 彻底正交解耦，彻底去除多余的切人下拉框与 YAML 代码展示，界面纯粹聚焦于专业可视化图形表单。

---

## 零、 两套正交悬浮舱交互架构 (Two Orthogonal Modals)

针对用户心智模型的极致降噪，系统确立两套互不干扰、物理独立的居中沉浸悬浮舱：

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Hermes Flux 双舱设置体系                               │
├────────────────────────────────────────┬────────────────────────────────────────┤
│ ① 系统全局设置舱 (Global Settings)      │ ② 专职 Agent 配置舱 (Agent Persona)     │
├────────────────────────────────────────┼────────────────────────────────────────┤
│ • 呼出入口: 微轨底部 ⚙ 设置 或 Cmd + ,  │ • 呼出入口: 微轨/抽屉 Agent 右键 ➔ 配置 │
│ • 核心定位: 网关全局底座、网络、提供商 │ • 核心定位: 单一 Bot 的灵魂人设、模型   │
│ • 特征: 纯粹全局，零混淆切人下拉框     │ • 特征: 顶部横向滑动条，可秒切选 Bot    │
│ • 涉及模块: 外观、API Key 池、安全、   │ • 涉及模块: SOUL.md 人设、专属模型 Pin、│
│   沙箱桌面、凭据库、代理、遥测维护     │   专属技能与 MCP、长期记忆修剪、头像    │
└────────────────────────────────────────┴────────────────────────────────────────┘
```

---

## 一、 舱室一：系统全局设置舱 (Global Settings Modal)

### 1.1 视觉几何与空间规范
- **尺寸规格**：桌面端居中模态 `width: min(980px, 92vw); height: min(680px, 86vh);`，圆角 `border-radius: 12px`；
- **材质背景**：基底采用 `var(--bg-card, #0D0D0D)`，外层遮罩采用 `rgba(0, 0, 0, 0.72)` + `backdrop-filter: blur(14px)`；
- **边框与阴影**：`border: 1px solid rgba(255, 255, 255, 0.1)`，物理阴影 `box-shadow: 0 20px 50px rgba(0, 0, 0, 0.9)`；
- **顶栏结构 (42px)**：
  - 左侧：`⚙ 系统全局设置`（纯净主标题）；
  - 中间：`[ 🔍 搜索全局设置项... (Cmd+F) ]` 全局倒排索引搜索框（宽 260px）；
  - 右侧：`[ ESC ✕ ]` 快捷退出指示。
  - **彻底去除**：左上角下拉切换框、右上角 YAML/表单分段控制器。

### 1.2 导航目录 (左侧 180px 导航轨)
仅承载真正的系统与网关全局项：
1. **🎨 外观与极客交互**：主题换肤、字体排印、三舱默认折叠、多语言与快捷键；
2. **🧠 模型与 API Key 池**：全局默认模型 Pin、官方 Nous 算力订阅、各提供商 API Key 录入与 Base URL、高额消费阻断预警；
3. **🛡️ 全局安全与自治审批**：全局 YOLO 自治模式、四阶安全审批等级（suggest/paranoid）、系统级危险命令黑名单、Sudo 凭据托管；
4. **🔌 全局 MCP 市场**：官方 Catalog 市场精选、全局 Stdio/SSE 服务增删、OAuth PKCE 授权与工具探活；
5. **📁 工作区与代码时光机**：项目 Primary Path 绑定、磁盘仓库自动发现排除名单（`node_modules` 等）、代码时光机快照开关；
6. **🖥️ 运行时沙箱与虚拟桌面**：CDP 浏览器接管模式、Xvnc+Xfce 虚拟桌面沙箱状态、默认 Shell 与命令超时；
7. **🔐 本地凭据保险库**：本地加密凭据库、1Password/Bitwarden 外部密码管理器接入、SaaS 连接器授权；
8. **🌐 网络代理与网关集群**：网关 WebSocket 地址与心跳保活、HTTP/SOCKS5 全局代理与 Bypass 名单、企业自定义 CA 根证书；
9. **📊 遥测隐私与系统维护**：匿名共享指标 Opt-in、提示词隐私保护盾、诊断日志导出、配置全量备份与出厂重置。

---

## 二、 舱室二：专职 Agent 独立配置舱 (Agent Persona Modal)

### 2.1 触发入口 (Multiple Entrypoints)
- **入口 1（主入口）**：在左侧 52px 微轨或抽屉的任意 Agent 头像（如架构师老王）上**点击鼠标右键** ➔ 弹出上下文菜单 ➔ 选择 `⚙ 配置专职员工 (Configure Agent)`；
- **入口 2**：当前处于该专职 Bot 的主工位（Canonical Chat）时，点击顶栏（Titlebar）Bot 名称右侧的微型设置图标；
- **入口 3**：在聊天输入框键入 `@老王` 弹出的成员卡片上点击配置。

### 2.2 顶部 Agent 横向快速切换滑动条 (Agent Slider Selector)
- **从哪个 Agent 进去，默认就显示该 Agent 的配置**；
- 弹窗顶部固定一排**横向滚动滑动条（Agent Pills Slider）**：
  - 每个胶囊包含：该 Bot 专属色彩头像圆点 + 中文角色全名（如 `[🔵 架构师 · 老王]`、`[🟣 前端专家 · 小张]`、`[🟠 审查专员 · 老李]`）；
  - 激活的 Agent 呈现高亮微光背景与白字；
  - **点击或左右滑动即刻秒切**：用户进入老王配置后，若想顺便查看小张的配置，**无需关闭弹窗重新右键**，直接点击顶部滑动条的小张胶囊，右侧内容流 0 延迟无刷新切换为小张的配置！
  - 结尾提供 `[ + 新建员工 ]` 虚线快捷按钮，点击直接打开新建引导。

### 2.3 专职 Bot 配置专属目录 (左侧 150px)
内容 100% 聚焦于该数字员工的专属生命周期：
1. **📜 灵魂人设 (SOUL.md)**：
   - 视觉直观呈现 Markdown 提示词文本框；
   - 设定该角色的专业边界、行为铁律与工作风格；
   - 物理自动落盘至 `~/.hermes/profiles/<name>/profile.yaml`。
2. **🎯 专属模型绑定 (Model Pin)**：
   - 单独为该 Bot 指定最适配的模型（如老王绑定推理能力最强的 `Claude 3.7 Sonnet`，小张绑定多模态与代码速度更快的 `GPT-4o`）；
   - 包含独立思考预算等级滑块（Reasoning Effort: low / medium / high / xhigh）。
3. **⚡ 专属技能与 MCP (Private Skills & Toolsets)**：
   - 为该角色勾选专属的私有技能包与 MCP 工具集（如老王勾选 `architecture-review` 与 `verify-formal-invariants`；前端小张勾选 `ui-ux-pro-max` 与 `emil-design-eng`）。
4. **🧠 长期记忆体维护 (Memory.md)**：
   - 查看该 Bot 沉淀在 `MEMORY.md` 中的历史记忆切片；
   - 支持单条修剪、编辑与删除，确保记忆库的高信噪比。
5. **🎨 视觉指纹与头像 (Visual Fingerprint)**：
   - 上传 32×32px 超椭圆头像（Base64/PNG）；
   - 选取该角色的 16 进制主题色（架构师靛青 `#4F46E5`、前端洋红 `#DB2777`、审查员琥珀 `#D97706`）。

---

## 三、 响应式与跨端 Capacitor 8 容器适配

1. **移动端手势交互**：
   - 在手机端，两套悬浮舱均平滑转为全屏 Navigation Page；
   - 专职 Agent 配置舱顶部的滑动条支持**原生惯性横向跟手滑动**；
   - 触控热区严格锁定 $\ge 44\text{pt}$；
   - 左上角统一提供 `< 返回` 按钮，支持屏幕左边缘右滑手势返回。
2. **键盘工作流**：
   - 全局设置：按 `Cmd + ,` 呼出，按 `ESC` 退出；
   - 专职 Agent 配置：在 Agent 上按快捷键 `Cmd + I`（或右键）呼出，按 `ESC` 退出；
   - 顶栏输入框按 `Cmd + F` 即刻聚焦。

---

## 四、 资产落盘与原型存盘

- **高保真可交互原型文件**：[`docs/prototypes/settings-refined-prototype.html`](docs/prototypes/settings-refined-prototype.html)（支持在任意浏览器中打开体验滑动条切换老王、小张、老李及全局设置舱）；
- **本设计规范文档**：[`docs/design-system/settings-interaction-and-ui-spec.md`](docs/design-system/settings-interaction-and-ui-spec.md)。
