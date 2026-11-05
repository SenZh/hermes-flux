# Hermes Flux 设置中心交互与 UI 终极设计规范 (Settings Interaction & Visual Design Spec)

> **定位说明**：本文档确立了 **Hermes Flux**（全平台 Desktop / Web / iOS / Android）设置体系的终极定稿交互架构（UX Architecture）与高质感视觉设计规范（UI Spec）。
> 核心原则：**文案 100% 务实克制，零中二花哨词汇；UI 与微交互追求极致的物理流动感、磁性滑块与触控手感**。
>
> ⚠️ **姿态与真值**：设置中心属 Hermes Flux 工作台 = **`tool` 姿态**，美学裁决以 `/opt/data/profiles/aura/workspace/specs/05-aesthetic-constitution-and-skin-derivation.md`（Aura 工作区 · 审美宪法） 为准。
> 本文的「物理流动感 / 磁性滑块 / 弹簧过冲」是 **editorial 式微交互**，与宪法 I6
> （动效只承载状态变化、稳态常驻 ≤1、非对称 enter/exit、禁过冲）**存在已知偏离**。
> 交互架构（作用域级联、双模编辑、检索、下钻栈）继续有效；
> **动效参数待按宪法 I6 复核，复核前不得把本文弹簧曲线当作 tool 姿态验收标准**。

---

## 零、 交互形态与空间定位 (Architecture & Ingress)

设置体系由两个正交且独立的视图构成，通过顶栏的分段滑块（Capsule Track）或外部快捷入口呼出：

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Hermes Flux 设置体系架构                               │
├────────────────────────────────────────┬────────────────────────────────────────┤
│ ① 专职数字员工配置 (Agent Persona)     │ ② 系统全局设置 (Global Settings)        │
├────────────────────────────────────────┼────────────────────────────────────────┤
│ • 呼出入口: 微轨/抽屉 Agent 右键 ➔ 配置 │ • 呼出入口: 微轨底部 ⚙ 设置 或 Cmd + ,  │
│ • 核心定位: 专职数字员工独立人设与算力 │ • 核心定位: 网关底座参数、提供商与网络  │
│ • 顶部组件: 磁性滑动胶囊轨 (秒切老王)   │ • 顶栏组件: 纯净主标题与即时检索框      │
│ • 核心项: 系统提示词 (SOUL.md)、绑定   │ • 核心项: 外观、全局模型 Pin、API Key  │
│   模型、思考预算推杆、私有技能与记忆   │   安全托管、HTTP/SOCKS5 代理通道        │
└────────────────────────────────────────┴────────────────────────────────────────┘
```

---

## 一、 核心微交互设计与手感规范 (Micro-Interactions & Feel)

### 1.1 顶部 Agent 磁性滑动选择轨 (Magnetic Slider Track)
- **物理滑块背景 (Glider)**：
  - 轨内常驻一个深色微浮雕滑块背景（`#20242E`，带 1px 半透明亮边与微阴影）；
  - 当用户在老王、小张、老李之间点击切换时，滑块使用**弹簧物理缓动**（`transition: transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1)`）平滑横移对准目标；〔**editorial 式过冲，tool 姿态已知偏离宪法 I6，待复核**：应改非对称 120ms enter / 200ms exit、无过冲〕
  - 按钮按下时附带 `transform: scale(0.97)` 物理按压反馈。
- **内容区平滑十字交叉位移淡入 (Crossfade Animation)**：
  - 切换 Agent 时，右侧表单内容**绝不生硬刷新**；
  - 采用 `slideInFade 0.18s`：透明度从 0 变到 1，Y 轴产生 4px 的极其克制的微位移，视感如丝般顺滑。

### 1.2 思考预算 4 档触控式分段推杆 (Segmented Reasoning Stepper)
- 摒弃死板下拉框，采用**触控式 4 档分段推杆**（Low / Med / High / Max）；
- 内部带有物理推块，点击或拖动刻度时，推块即时滑动，右上方等宽数值实时刷新对应的 Token 预算（如 `48,000 Tokens`）。

### 1.3 推理模型单选芯片组 (Radio Chips Matrix)
- 每个候选模型为一个独立的圆角芯片（如 `Claude 3.7 Sonnet`、`GPT-4o`、`DeepSeek R1`）；
- 芯片左侧带有一个小巧的单选指示环，点击时内部实心圆点带缩放动画浮现，外边框高亮。

### 1.4 仿 iOS 微型精密 Switch 开关
- 尺寸锁定为 `32px × 18px`，内部滑球 `14px`；
- 开启时滑向右侧并点亮强调色，按下时圆球轻微横向拉伸（`width: 17px`），模拟真实物理触控回弹。

---

## 二、 视觉层次与 Design Tokens 规范

所有界面元素严格基于纯黑与冷色阶梯构建：

| UI 元素 | 颜色规范 | 视觉意图 |
|---|---|---|
| **窗口外底色 (Window Body)** | `#0D0E11` | 极度深邃克制的冷灰黑，消灭纯白的刺眼感 |
| **侧边栏 (Sidebar)** | `#090A0D` | 次级深度，形成明确的层级分割 |
| **卡片基底 (Section Card)** | `#13151A` | 悬浮卡片层级，hover 时微提亮至 `#181B22` |
| **细微边框 (Borders)** | `rgba(255, 255, 255, 0.08)` | 1px 细线微光，界限分明但不喧宾夺主 |
| **主操作色 (Brand Blue)** | `#3B82F6` | 单选圆点、激活开关与链接强调色 |
| **在线与成功 (Emerald)** | `#10B981` | 延迟读数、落盘成功指示点 |
| **高反差文字 (Text High)** | `#F8FAFC` | 标题与关键输入内容 |
| **次要说明文字 (Text Mid)** | `#94A3B8` | 配置描述与辅助说明 |

---

## 三、 资产与原型落盘清单

- **真机可交互原型文件**：[`docs/prototypes/settings-astonishing-prototype.html`](docs/prototypes/settings-astonishing-prototype.html)（可在浏览器中打开，亲手操作磁性滑块与分段推杆）
- **本规范文档**：[`docs/design-system/settings-interaction-and-ui-spec.md`](docs/design-system/settings-interaction-and-ui-spec.md)
