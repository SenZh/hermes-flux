# Hermes Flux 极客美学设计系统 (Geek-Precision Design System)

> **设计宣言**：
> 顶级工具的美学不在于浮夸装饰与彩色光晕，而在于**深邃内敛的黑夜层级、微距精准的发丝线、严谨舒适的排版韵律与极致纯粹的信息专注感**。
> 本设计系统彻底废除历史上的多头真值与争端，确立全平台统一、自洽、开箱即用的单一设计权威。

---

## 一、设计系统核心原则 (First Principles)

1. **界面退后，任务前置 (Subdued Interface, Forefront Content)**：
   系统 95% 以上的视觉面积由纯粹的中性暗调构成，消除视觉杂噪，使代码、日志、对话与思考链成为绝对视觉主角。
2. **纯粹深邃的层次阶梯 (Pure Surface Depth)**：
   彻底放弃高饱和度光晕污染。通过 Canvas ➔ Sidebar ➔ Surface ➔ Card ➔ Elevated 的 5 级沉静灰阶，构建清晰的物理纵深。
3. **微距发丝线与物理质感 (Hairline Precision & Physicality)**：
   以 1px 半透明发丝线代替厚重脏浊的阴影；卡片顶部内嵌 1px 微发光受光线（Specular Line），呈现如精工阳极氧化铝与暗色微晶玻璃般的物理质感。
4. **克制点睛 (Restrained Accent)**：
   强调色严格控制在 5% 以内，仅用于当前激活状态、聚焦输入环与重要提交操作。
5. **严谨瑞士排版节奏 (Swiss Typography Rhythm)**：
   统一 7 档整数阶梯字阶，严格对应行高与字重，根绝散落混乱的字号与行高抖动。
6. **高度抽象与组件复用 (High Abstraction & Component Reusability)**：
   前端实现坚决抵制重复拼装与形态分裂。所有同构或形态相近的视图元素（如普通会话行、群聊行、Agent 工位行）必须提炼为单一的高纯度可复用组件；以基准规格为绝对真值，变体差异通过可选插槽（如 `avatar?: React.ReactNode`）解耦注入，实现“改一处全站同步”。

---

## 二、色彩系统 (Color Architecture)

### 1. 表面层级矩阵 (Surface Hierarchy)
通过精准明度递进表达空间关系，避免界面平铺发扁：

| 语义层级 | CSS Token | 深色模式 (Dark Baseline) | 浅色模式 (Light Baseline) | 使用场景 |
|---|---|---|---|---|
| **L0 Canvas** | `--background` | `#0A0B0E` (极暗沉静黑) | `#F8F9FA` (纯粹纸白) | 窗口最底层背景、外壳基底 |
| **L1 Sidebar** | `--sidebar` | `#0F1015` (微亮侧栏底) | `#F1F3F6` (柔灰导航底) | 52px 微轨与 212px 抽屉 |
| **L2 Surface** | `--panel` | `#13141A` (主面板底色) | `#FFFFFF` (纯白主舞台) | 中间通栏对话舞台、右侧检查舱 |
| **L3 Card** | `--card` | `#181A22` (卡片底色) | `#FFFFFF` (卡片底色) | 消息气泡、工具胶囊、列表行 |
| **L3 Hover** | `--card-hover` | `#1F222D` (悬浮高亮) | `#F3F4F7` (浅色悬浮) | 列表项 Hover、卡片交互态 |
| **L3 Active** | `--card-active` | `#262936` (按压选中) | `#E9ECEF` (按压选中) | 选中项、激活行 |
| **L4 Elevated** | `--popover` | `#1E212B` (浮动层) | `#FFFFFF` (浮动层) | 下拉菜单、设置弹窗、悬浮上下文 |
| **输入框底色** | `--input` | `#121319` (内陷输入) | `#F8F9FA` (内陷输入) | 输入舱底色、表单框底色 |
| **代码背景** | `--code` | `#0A0B0E` (深邃代码块) | `#F1F3F5` (浅色代码块) | 代码块、终端输出底色 |

---

### 2. 前景文本阶梯 (Typography Color Scale)

| 语义层级 | CSS Token | 深色模式 | 浅色模式 | 对比度与用途 |
|---|---|---|---|---|
| **Text Primary** | `--foreground` | `#F3F4F6` (高对比白) | `#111827` (纯粹深黑) | 标题、主要正文、代码、重要操作 |
| **Text Secondary** | `--secondary-foreground` | `#9CA3AF` (中性次级灰) | `#4B5563` (深次级灰) | 说明文字、副标题、输入框文字 |
| **Text Muted** | `--muted-foreground` | `#6B7280` (静音辅助灰) | `#9CA3AF` (浅辅助灰) | 时间戳、元数据、快捷键提示、占位符 |
| **Text Faint** | `--faint` | `#374151` (极淡微弱灰) | `#D1D5DB` (极淡微弱灰) | 细微行号、非活动装饰图标 |

---

### 3. 微距发丝线与物理边框 (Hairline Borders)

| 语义层级 | CSS Token | 深色模式 | 浅色模式 | 用途 |
|---|---|---|---|---|
| **Subtle** | `--border-subtle` | `rgba(255, 255, 255, 0.07)` | `rgba(0, 0, 0, 0.08)` | 列表项分割线、面板细微缝隙 |
| **Default** | `--border` | `rgba(255, 255, 255, 0.12)` | `rgba(0, 0, 0, 0.14)` | 卡片外边框、模块分界线 |
| **Strong** | `--border-strong` | `rgba(255, 255, 255, 0.22)` | `rgba(0, 0, 0, 0.26)` | 选中态边框、输入聚焦边框 |
| **受光高光线** | `--specular-line` | `rgba(255, 255, 255, 0.12)` | `rgba(255, 255, 255, 0.80)` | 窗口或卡片顶部 1px 细微内受光 |

---

### 4. 强调色与语义状态 (Accent & Semantic Tokens)

| 语义层级 | CSS Token | 色值 (基准) | 作用场景 |
|---|---|---|---|
| **主强调色** | `--primary` | `#F59E0B` (琥珀金) 或 `#06B6D4` (冷电青) | 核心提交、激活开关、品牌识别 |
| **主色悬浮** | `--primary-hover` | 比主色明度提高 10% | 主按钮悬浮态 |
| **主色微透底** | `--primary-subtle` | `rgba(var(--primary-rgb), 0.12)` | 激活项浅色背景、徽标底色 |
| **主色边框** | `--primary-border` | `rgba(var(--primary-rgb), 0.35)` | 激活项描边 |
| **主色前景色** | `--primary-foreground` | `#0A0B0E` (深色) / `#FFFFFF` (浅色) | 主按钮文字颜色 |
| **聚焦环** | `--ring` | `rgba(var(--primary-rgb), 0.40)` | 全局键盘焦点光环 |
| **成功 (Success)** | `--success` | `#10B981` (Emerald 翡翠) | 连接成功、构建完成、无缺陷 |
| **警告 (Warning)** | `--warning` | `#F59E0B` (Amber 琥珀) | 降级告警、待确认操作 |
| **危险 (Destructive)** | `--destructive` | `#EF4444` (Crimson 鲜红) | 中断、报错、删除会话、致命异常 |

---

## 三、排版规范与字阶 (Typography Scale)

系统严格采用 7 档整数阶梯，消除排版抖动与模糊微小字号：

```css
:root {
  /* 字体栈 */
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", Consolas, "Cascadia Code", monospace;

  /* 字阶规范：字号 / 行高 / 字重 */
  --fs-hero:     20px; /* line-height: 28px; weight: 600; 用于重点大标题、欢迎页 */
  --fs-title:    16px; /* line-height: 22px; weight: 600; 用于页面与模块一级标 */
  --fs-section:  14px; /* line-height: 20px; weight: 500; 用于分组小标、重要正文 */
  --fs-body:     13px; /* line-height: 19px; weight: 400; 通篇核心正文、消息内容 */
  --fs-aux:      12px; /* line-height: 16px; weight: 400; 辅助文字、次要标签 */
  --fs-caption:  11px; /* line-height: 14px; weight: 500; 时间戳、指示标签 */
  --fs-micro:    10px; /* line-height: 12px; weight: 600; 微型胶囊、键盘快捷键 */
}
```

---

## 四、空间网格、圆角与阴影 (Spacing, Radius & Shadows)

### 1. 8pt / 4pt 间距阶梯
- `space-1`: `4px`（紧凑内距、微调间隙）
- `space-2`: `8px`（组件内部元素标准间隙）
- `space-3`: `12px`（卡片紧凑内边距）
- `space-4`: `16px`（标准内边距、外围间距）
- `space-5`: `20px`（模块间距）
- `space-6`: `24px`（对话区水槽、大间隙）
- `space-8`: `32px`（页面主区域留白）

### 2. 精密圆角系统 (Precision Radius)
- `--radius-window`: `12px`（原生窗口外壳边缘）
- `--radius-panel`: `8px`（主面板、抽屉容器）
- `--radius-card`: `6px`（消息卡片、代码块容器、对话框）
- `--radius-inner`: `4px`（按钮、输入框、下拉项、标签）
- `--radius-pill`: `9999px`（胶囊徽标、脉冲状态点）

### 3. 微距漫反射阴影 (Subtle Ambience Shadows)
彻底消除脏黑大阴影，仅使用自然环境柔和遮蔽：
- `--shadow-card`: `0 1px 3px rgba(0, 0, 0, 0.25)`（卡片微悬浮）
- `--shadow-window`: `0 8px 32px rgba(0, 0, 0, 0.45)`（模态弹窗与主浮层）
- `--shadow-dock`: `0 6px 24px rgba(0, 0, 0, 0.35)`（底部悬浮输入舱）

---

## 五、核心几何常量 (Geometry Single Source of Truth)

全仓桌面端空间骨架唯一约束：

| 几何位置 | 尺寸规范 | 说明 |
|---|---|---|
| **顶栏高度** | `--geo-titlebar: 42px` | 极简净化，仅保留标题、连接态与窗口控制 |
| **左侧微轨** | `--geo-micro-rail: 52px` | 专职 Bot、群聊与会话图标微轨 |
| **左侧抽屉** | `--geo-context-drawer: 212px` | 可伸缩会话与项目列表抽屉 |
| **左双轨基线** | `--geo-left-rail: 264px` | 微轨 (52px) + 抽屉 (212px) 完整宽度，`Ctrl+B` 折叠至 52px |
| **中间对话通栏** | `flex: 1 1 0%` | 通栏顶格展开，内边距 `24px 32px 180px` |
| **底部输入舱** | `--geo-input-dock: 740px` | 黄金限宽收敛居中，人体工学打字聚焦 |
| **右侧检查舱** | `--geo-inspector-pod: 410px` | 竖向场景轨 (62px) + 详情工作舱 (348px)，`Ctrl+\` 折叠 |
