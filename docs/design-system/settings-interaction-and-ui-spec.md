# Hermes Flux 设置中心交互与 UI 终极设计规范 (Settings Interaction & Visual Design Spec)

> **定位说明**：本文档确立了 **Hermes Flux**（全平台 Desktop / Web / iOS / Android）设置体系的终极定稿交互架构（UX Architecture）与高保真赛博极客美学视觉设计规范（UI Spec）。
> 核心设计飞跃：彻底打破平庸的 CMS 表单刻板印象，将专职数字员工配置升华至**“全息赛博数字员工神经工位 (Neural Cyber-Core Persona)”**，全局配置升华为**“网关神经控制中枢 (Gateway Neural Grid)”**，实现令人惊艳的视觉深度与流动物理感。

---

## 零、 惊艳化重构设计哲学 (Astonishing Aesthetic Principles)

1. **智能体生命实体感 (Agent Entity Immersion)**：
   - 专职数字员工不是数据库里的一行记录，而是一个**“赛博全息实体 / 神经装甲核心”**；
   - 每个 Agent 拥有专属的光谱能量波长（架构老王: 靛青冷萃 `#6366F1`、前端小张: 霓虹洋红 `#EC4899`、审查老李: 熔岩琥珀 `#F59E0B`）；
   - 切换 Agent 时，整个视口背景的**微光环境色（Ambient Glow）与顶栏指示核（Pulsing Orb）**发生丝滑流光渐变。
2. **微距物理质感与双光源微光 (Specular Rim Lights & Depth)**：
   - 纯黑深邃宇宙底色（`#050507` ➔ `#0A0C10` ➔ `#10131A`），彻底消灭灰白平庸；
   - 卡片边缘附带 1px 细微镜面高光边缘（Specular Highlights）与 3px 专属色彩能量光柱；
   - 所有可点击组件遵循 Emil Kowalski 物理动效：按下带有 `transform: scale(0.97)` 弹簧反馈，拨动开关带有电容接通光效。

---

## 一、 舱室一：专职 Agent 全息工位舱 (Neural Cyber-Core Persona)

### 1.1 触发入口 (Multiple Fast Ingresses)
- **微轨/抽屉右键**：在任意 Agent 头像上点击右键 ➔ 弹出上下文菜单 ➔ 选择 `⚙ 配置专职员工`；
- **主工位顶栏入口**：处于该专职 Bot 工位时，点击顶栏名称旁的专属徽章；
- **从哪个 Agent 进去，默认就点亮该 Agent 的全息卡牌**！

### 1.2 顶部全息卡牌滑动器 (Holographic Persona Carousel)
- 顶部固定一排精致的全息工卡卡牌（Persona Cards）：
  - 架构师老王：`CHIEF ARCHITECT · S`，靛蓝渐变头像 + 在线翡翠微光点；
  - 前端专家小张：`PIXEL DIRECTOR · S`，洋红渐变头像；
  - 审查专员老李：`GATE GUARDIAN · S`，琥珀金渐变头像；
- **点击或左右滑动即刻秒切**：点击小张，弹窗背景光瞬间转为霓虹洋红，右侧内容流 0 延迟无刷新切换为小张的人设、模型与记忆。

### 1.3 核心组件模态
1. **📜 神经灵魂人设代码舱 (SOUL.md Directives)**：
   - 顶栏带快速指令胶囊：点击 `[+ 注入: 先行证明铁律]` 或 `[+ 注入: fast-check门禁]`，直接将专业架构指令无缝追加至底层提示词；
   - 等宽字体与深黑终端底色，带微光聚焦边框。
2. **⚛️ 算力核心反应堆 (Compute Core Reactor)**：
   - 摒弃死板下拉框，采用反应堆参数网格；
   - 呈现绑定的推理引擎与思考深度预算（Reasoning Effort: low / medium / high / xhigh）。
3. **⚡ 赛博技能插槽 (Neural Skill Chips)**：
   - 技能呈现为高科技插件芯片插槽；
   - 带物理接通指示灯，点击拨动即实现热插拔开启与关闭。
4. **💎 突触记忆体晶片 (Synaptic Memory Fragments)**：
   - 查看该 Bot 沉淀在 `MEMORY.md` 中的历史记忆切片；
   - 半透明微光晶体卡片，悬停微光浮现，支持一键单条修剪。

---

## 二、 舱室二：系统全局设置中枢 (Gateway Neural Grid)

### 2.1 触发入口
- 微轨底部 `⚙ 设置` 图标或全局快捷键 `Cmd + ,` 呼出。

### 2.2 视觉与交互规范
- **顶部实时遥测带 (Telemetry Ribbon)**：
  - 呈现实时网关 RTT 延迟读数（如 `12ms`）、当前活跃会话数、今日 Token 吞吐量与网关版本号；
- **模型与 API Key 安全保险库 (Cryptographic Key Vaults)**：
  - 各提供商（Anthropic, OpenAI, DeepSeek, Bedrock）以金属保险箱卡片排布；
  - 密钥严格脱敏，带实时连通呼吸灯（`在线就绪 🟢`）；
- **全局网络代理通道**：
  - 直观展示代理通道（HTTP/SOCKS5）与快速测速探针。

---

## 三、 资产落盘与原型文件

- **高保真可交互惊艳原型**：[`docs/prototypes/settings-astonishing-prototype.html`](docs/prototypes/settings-astonishing-prototype.html)（支持在任意浏览器中打开体验全息卡牌切换、环境光流转、技能芯片插拔与记忆体修剪）；
- **本规范文档**：[`docs/design-system/settings-interaction-and-ui-spec.md`](docs/design-system/settings-interaction-and-ui-spec.md)。
