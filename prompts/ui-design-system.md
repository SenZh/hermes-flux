# Hermes Flux UI 视觉与设计系统规范提示词 (UI & Design System Spec)

> **使用指引**：
> 当任务涉及 UI 界面开发、视觉风格重塑、设计系统变更、组件排版打磨、换肤 Token 调整或前端体验优化时，**必须首先读取并严格遵循本提示词**。

---

## 一、核心美学与设计原则 (Aesthetic Philosophy)

本项目坚决贯彻 **新极客精准美学 (Neo-Geek Precision)**，彻底弃用浮夸装饰与彩色大光晕：

1. **界面退后，任务前置 (Subdued Interface)**：
   界面 95% 以上由纯粹沉静的中性灰阶构成，消除所有不必要的视觉噪点，让代码、对话、日志与交付物成为绝对视觉焦点。
2. **纯粹深邃的层次阶梯 (Pure Surface Depth)**：
   通过 `Canvas ➔ Sidebar ➔ Surface ➔ Card ➔ Elevated` 5 级明度递进，建立自然有序的物理纵深，杜绝界面发扁平或发脏灰。
3. **微距发丝线与物理质感 (Hairline Precision & Physicality)**：
   以 1px 半透明发丝线取代大面积模糊扩散的深色阴影；浮动卡片顶部统一内嵌 1px 半透明微发光受光线（`--specular-line`），呈现阳极氧化铝与精密微晶玻璃质感。
4. **克制点睛 (Restrained Accent)**：
   强调色面积严格控制在 5% 以内，仅用于当前激活状态、聚焦输入环与主提交按钮。
5. **严谨瑞士排版节奏 (Swiss Typography Rhythm)**：
   采用 7 档严格整数阶梯，字号与行高一一锁定，杜绝散落字号与长文本排版抖动。

---

## 二、色彩系统与表面层级 (Color Tokens & Surfaces)

### 1. 五级表面矩阵 (Surface Hierarchy)

| 语义层级 | CSS Token | 深色模式 (Dark Baseline) | 浅色模式 (Light Baseline) | 角色与使用场景 |
|---|---|---|---|---|
| **L0 Canvas** | `--background` | `#0E0F13` (温润深冷碳灰) | `#F8F9FA` (纯粹纸白) | 窗口最底层背景、外壳基底 |
| **L1 Sidebar** | `--sidebar` | `#131419` (深微冷碳灰底) | `#F1F3F6` (柔灰导航底) | 微轨与上下文抽屉导航区 |
| **L2 Surface** | `--panel` | `#16171D` (主面板底色) | `#FFFFFF` (纯白主舞台) | 中间通栏对话区、右侧检查舱 |
| **L3 Card** | `--card` | `#1B1C23` (卡片底色) | `#FFFFFF` (纯白卡片) | 消息气泡卡片、列表行容器 |
| **L3 Hover** | `--card-hover` | `#22242D` (交互悬浮) | `#F1F3F6` (浅色悬浮) | 列表项 Hover、卡片交互态 |
| **L3 Active** | `--card-active` | `#292B37` (按压选中) | `#E5E7EB` (按压选中) | 选中项、激活行 |
| **L4 Elevated** | `--popover` | `#1B1C23` (浮动层) | `#FFFFFF` (浮动层) | 模态弹窗、下拉菜单、上下文浮层 |
| **输入框底色** | `--input` | `#131419` (沉陷输入) | `#F8F9FA` (沉陷输入) | 底部悬浮输入舱、表单输入框 |
| **代码块底色** | `--code` | `#0E0F13` (深邃代码底) | `#F1F3F5` (浅色代码底) | 代码块、终端命令行输出 |

---

### 2. 前景字色阶梯 (Text Hierarchy)

| 语义层级 | CSS Token | 深色模式 | 浅色模式 | 场景与对比度 |
|---|---|---|---|---|
| **Text Primary** | `--foreground` | `#F3F4F6` (高对比白) | `#111827` (纯粹深黑) | 标题、主要消息内容、代码文字 |
| **Text Secondary** | `--secondary-foreground` | `#9CA3AF` (中性次级灰) | `#4B5563` (深次级灰) | 说明文案、副标题、输入框文字 |
| **Text Muted** | `--muted-foreground` | `#6B7280` (静音辅助灰) | `#9CA3AF` (浅辅助灰) | 时间戳、快捷键徽标、占位符 |
| **Text Faint** | `--faint` | `#374151` (微弱灰) | `#D1D5DB` (微弱灰) | 代码行号、最弱非活动装饰 |

---

### 3. 微距发丝线与物理边框 (Hairline Borders)

| 语义层级 | CSS Token | 取值 (深色 / 浅色) | 使用场景 |
|---|---|---|---|
| **Subtle** | `--border-subtle` | `rgba(255, 255, 255, 0.06)` / `rgba(0, 0, 0, 0.06)` | 列表项分割线、细微边缘 |
| **Default** | `--border` | `rgba(255, 255, 255, 0.10)` / `rgba(0, 0, 0, 0.10)` | 核心卡片描边、模块分界线 |
| **Strong** | `--border-strong` | `rgba(255, 255, 255, 0.20)` / `rgba(0, 0, 0, 0.20)` | 聚焦边框、激活卡片轮廓 |
| **受光高光线** | `--specular-line` | `inset 0 1px 0 0 rgba(255, 255, 255, 0.08)` | 窗口或卡片顶部 1px 细微内受光 |

---

### 4. 强调色与反馈 (Accent & Feedback)

| 语义层级 | CSS Token | 基准色值 | 用途 |
|---|---|---|---|
| **主强调色** | `--primary` | `#FFFFFF` (高纯柔白) | 核心提交、激活切换、高光指示 |
| **主色悬浮** | `--primary-hover` | `#E5E7EB` | 主按钮悬浮态 |
| **主色微透底** | `--primary-subtle`| `rgba(255, 255, 255, 0.06)` | 激活项浅色透底、标签背景 |
| **主色边框** | `--primary-border`| `rgba(255, 255, 255, 0.20)` | 激活项外边框 |
| **聚焦环** | `--ring` | `rgba(255, 255, 255, 0.30)` | 全局键盘焦点外圈光环 |
| **成功态** | `--success` | `#10B981` (Emerald) | 连接成功、构建完成、无异常 |
| **警告态** | `--warning` | `#F59E0B` (Amber) | 降级提示、待确认危险操作 |
| **危险态** | `--destructive` | `#EF4444` (Crimson) | 中断、报错、删除操作 |

---

## 三、排版规范与字阶 (Typography Scale)

禁止散落写死字号，必须严格走 7 档排版节奏变量：

```css
:root {
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", Consolas, "Cascadia Code", monospace;

  /* 7 档严格排版阶梯：字号 / 行高 / 字重 */
  --fs-hero:     20px; /* line-height: 28px; weight: 600; 欢迎页、突出大标 */
  --fs-title:    16px; /* line-height: 22px; weight: 600; 页面一级标题 */
  --fs-section:  14px; /* line-height: 20px; weight: 500; 卡片标头、重要段落 */
  --fs-body:     13px; /* line-height: 19px; weight: 400; 通用正文、对话气泡流 */
  --fs-aux:      12px; /* line-height: 16px; weight: 400; 辅助说明、次级标签 */
  --fs-caption:  11px; /* line-height: 14px; weight: 500; 时间戳、指示标签 */
  --fs-micro:    10px; /* line-height: 12px; weight: 600; 微型胶囊、键盘快捷键 */
}
```

---

## 四、空间几何与圆角规范 (Spatial Geometry & Radius)

### 1. 核心骨架尺寸唯一真值
- **顶栏高度**：固定 **`42px`**（连接状态点与 21ms 延迟收敛至顶栏右上角）；
- **左侧双轨**：基线 **`264px`**（**`52px` 物理微轨 + `212px` 上下文抽屉**，`Ctrl+B` 收敛至 52px）；
- **悬浮输入舱**：严格锁定黄金限宽 **`max-width: 740px`**，居中悬浮；
- **右侧检查舱**：基线 **`410px`**（**`62px` 竖向场景轨 + `348px` 详情舱**，`Ctrl+\` 折叠）；
- **底部状态栏**：**已彻底拔除（高度 0px）**，垂直空间全部释放给对话工作区。

### 2. 精密圆角系统
- `--radius-window: 12px`（桌面原生外壳边缘）
- `--radius-panel: 8px`（抽屉与大工作舱容器）
- `--radius-card: 6px`（消息气泡卡片、代码块容器、对话框）
- `--radius-inner: 4px`（按钮、输入框、下拉项、标签）
- `--radius-pill: 9999px`（微型胶囊、脉冲指示点）

---

## 五、工程实现与换肤避坑铁律 (Engineering Defenses)

1. **严禁硬编码色相**：
   组件模板或 CSS 中禁止直接裸写 `#hex`、`rgb()`、`hsl()`，必须使用语义 Token（如 `var(--panel)`、`var(--foreground)`、`var(--border)`）。
2. **滚动跟随与防抖动**：
   - 会话流滚动容器禁止使用 `scroll-behavior: smooth`，必须即时定位，防止高频流式输出排版抖动；
   - 滚动跟随阈值：读者距底部 $\le 48\text{px}$ 时紧密贴底，远离时保持静止以允许翻阅历史。
3. **消灭 innerHTML 模板历史包袱**：
   新 UI 组件一律采用 React 18 + Tailwind / CSS Variables 编写，禁止再新增基于字符串拼接的命令式 DOM 模板。
4. **高度抽象与组件复用铁律 (High Abstraction & Reusable Components)**：
   前端实现禁止出现同构或形态相近元素的复制粘贴与重复手写（如会话行、群聊行、Agent 卡片等）。同类型视图必须高度抽象为单一的基础可复用组件：
   - **尺寸与间距以基准对齐**：必须选定一个通用业务形态（如普通会话）作为基准真值，所有衍生变体在高度、内边距、外边距、圆角与字阶上严格 100% 保持一致；
   - **可选插槽扩展变体**：变体特性（如头像 Avatar、操作栏、状态徽标）必须作为可选 Props 注入（如 `avatar?: React.ReactNode`），不支持头像的业务形态直接缺省，严禁私自派生第二套 HTML/JSX 结构；
   - **杜绝样式漂移与双标**：任何通用排版与视觉样式的变更必须在基础复用组件内一次性完成，保证全端全业务形态自动同步。
