# 跨端设计系统与 Token 规范 (Design Tokens Spec)

> **定位与原则**：
> 本规范定义 Hermes Flux 跨端（Desktop, Web, iOS, Android）共享的设计 Token 字典与实现代码映射。
> 统一采用**新极客精准美学 (Neo-Geek Precision)**，所有组件、主题与样式均以本规范为唯一设计真值。

---

## 1. 空间与网格 Tokens (Spacing & Grid)

系统严格基于 **4px/8px 空间节奏**：

```css
:root {
  --space-0:    0px;
  --space-05:   2px;    /* 微型徽标、指示点微距 */
  --space-1:    4px;    /* 紧凑内距：标签内边距、行间微调 */
  --space-2:    8px;    /* 组内元素基准间距（图标与文字、输入框内距） */
  --space-3:    12px;   /* 小型卡片内边距、列表项间距 */
  --space-4:    16px;   /* 标准组件内边距、容器边距 */
  --space-5:    20px;   /* 模块适度间隔 */
  --space-6:    24px;   /* 桌面端内容水槽、卡片与卡片大间距 */
  --space-8:    32px;   /* 模块间垂直大留白 */
  --space-10:   40px;   /* 章节大留白 */
  --space-12:   48px;   /* 页面主屏垂直留白 */
}
```

---

## 2. 色彩系统 Tokens (Color System)

色彩以中性暗调为绝对基石，消灭浮夸光晕，强化发丝线边缘与明度对比。

### 2.1 核心语义映射表

| 语义 Token | 深色模式 (Dark Baseline) | 浅色模式 (Light Baseline) | 作用场景与层级 |
|---|---|---|---|
| `--background` | `#0E0F13` (Zinc-950) | `#F8F9FA` (Gray-50) | 全局底层画板与窗口根底色 |
| `--sidebar` | `#131419` (Zinc-900) | `#F1F3F6` (Gray-100) | 左侧微轨与抽屉导航区背景 |
| `--panel` | `#16171D` (Zinc-850) | `#FFFFFF` (Pure White) | 中间主会话工作台、右侧检查舱 |
| `--card` | `#1B1C23` (Zinc-800) | `#FFFFFF` (Pure White) | 消息气泡卡片、列表行、容器卡片 |
| `--card-hover` | `#22242D` (Zinc-750) | `#F3F4F7` (Gray-100) | 交互悬浮态背景 |
| `--card-active` | `#292B37` (Zinc-700) | `#E9ECEF` (Gray-200) | 选中与激活态背景 |
| `--popover` | `#1B1C23` (Zinc-800) | `#FFFFFF` (Pure White) | 悬浮下拉菜单、模态弹窗、Popover |
| `--input` | `#131419` (Zinc-900) | `#F8F9FA` (Gray-50) | 表单输入框、底部输入舱容器 |
| `--code` | `#0E0F13` (Zinc-950) | `#F1F3F5` (Gray-100) | 代码块、终端命令行底色 |
| `--backdrop` | `rgba(20, 21, 28, 0.90)` | `rgba(248, 249, 250, 0.80)` | 模态全屏遮罩蒙层 |

### 2.2 文本与前景阶梯

| 语义 Token | 深色模式 | 浅色模式 | 作用场景 |
|---|---|---|---|
| `--foreground` | `#F3F4F6` (Gray-100) | `#111827` (Gray-900) | 主标题、重要正文、主要代码 |
| `--secondary-foreground`| `#9CA3AF` (Gray-400) | `#4B5563` (Gray-600) | 次级说明文案、副标题、表头 |
| `--muted-foreground` | `#7C8291` (静音辅助灰) | `#6B7280` (Gray-500) | 占位符、辅助时间戳、快捷键说明 |
| `--faint` | `#374151` (Gray-700) | `#D1D5DB` (Gray-300) | 行号、最弱辅助指示器 |

### 2.3 边框与发丝线 (Borders)

| 语义 Token | 深色模式 | 浅色模式 | 作用场景 |
|---|---|---|---|
| `--border-subtle` | `rgba(255, 255, 255, 0.07)` | `rgba(0, 0, 0, 0.08)` | 极细分割线、卡片次要边线 |
| `--border` | `rgba(255, 255, 255, 0.12)` | `rgba(0, 0, 0, 0.14)` | 核心卡片外边框、模块分界线 |
| `--border-strong` | `rgba(255, 255, 255, 0.22)` | `rgba(0, 0, 0, 0.26)` | 聚焦状态边框、激活卡片轮廓 |
| `--specular-line` | `rgba(255, 255, 255, 0.12)` | `rgba(255, 255, 255, 0.80)` | 顶部 1px 细微内受光高光线 |

### 2.4 强调色与反馈 (Accent & Feedback)

| 语义 Token | 色值 | 说明 |
|---|---|---|
| `--primary` | `#FFFFFF` (高纯柔白) | 核心品牌焦点、高光操作 |
| `--primary-hover` | `#E5E7EB` | 主按钮悬浮态 |
| `--primary-dim` | `#9CA3AF` | 主色弱化态 |
| `--primary-subtle` | `rgba(255, 255, 255, 0.06)` | 激活项浅色透底 |
| `--primary-border` | `rgba(255, 255, 255, 0.20)` | 激活项细边框 |
| `--primary-foreground` | `#0E0F13` (深色) / `#FFFFFF` (浅色) | 主操作按钮前景色 |
| `--ring` | `rgba(255, 255, 255, 0.30)` | 全局聚焦环 (Focus Ring) |
| `--success` | `#10B981` (Emerald) | 运行正常、已连接、构建成功 |
| `--warning` | `#F59E0B` (Amber) | 告警、待确认操作 |
| `--destructive` | `#EF4444` (Crimson) | 报错、中断、危险删除操作 |

---

## 3. 字体排印 Tokens (Typography Scale)

### 3.1 跨端统一字体栈
- **西文字体栈**：`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`
- **中文字体栈**：`"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`
- **等宽代码栈**：`"JetBrains Mono", "SF Mono", Consolas, "Fira Code", monospace`

### 3.2 整数阶梯字阶
```css
/* 7 档严格排版阶梯 */
--fs-hero:     20px; /* 28px line-height, 600 weight: 突出大标 */
--fs-title:    16px; /* 22px line-height, 600 weight: 页面主标题 */
--fs-section:  14px; /* 20px line-height, 500 weight: 卡片标、重要段落 */
--fs-body:     13px; /* 19px line-height, 400 weight: 通用正文、对话流 */
--fs-aux:      12px; /* 16px line-height, 400 weight: 次级辅助、标签 */
--fs-caption:  11px; /* 14px line-height, 500 weight: 元数据、时间戳 */
--fs-micro:    10px; /* 12px line-height, 600 weight: 最小胶囊、快捷键 */
```

---

## 4. 几何与圆角 Tokens (Geometry & Radius)

```css
:root {
  /* 圆角阶梯 */
  --radius-window: 12px;   /* 桌面窗口外壳 */
  --radius-panel:  8px;    /* 抽屉与大工作舱容器 */
  --radius-card:   6px;    /* 内容卡片、代码块 */
  --radius-inner:  4px;    /* 按钮、输入框、下拉项 */
  --radius-pill:   9999px; /* 状态胶囊、徽标 */

  /* 核心几何单源尺寸 */
  --geo-titlebar:        42px;   /* 顶栏固定高度 */
  --geo-micro-rail:      52px;   /* 左侧微轨宽度 */
  --geo-context-drawer:  212px;  /* 左侧抽屉宽度 */
  --geo-left-rail:       264px;  /* 左双轨基线宽度 (52 + 212) */
  --geo-resize-handle:   6px;    /* 拖拽把手基准宽度 */
  --geo-inspector-pod:   410px;  /* 右侧检查舱基准宽度 */
  --geo-input-dock:      740px;  /* 底部输入舱黄金收敛限宽 */
}
```

---

## 5. 阴影系统 (Shadow Hierarchy)

绝不使用粗暴的纯黑大扩散阴影，采用环境光多重微距衰减：
```css
:root {
  --shadow-card:   0 1px 3px rgba(0, 0, 0, 0.25);
  --shadow-window: 0 8px 32px rgba(0, 0, 0, 0.45);
  --shadow-dock:   0 6px 24px rgba(0, 0, 0, 0.35);
}
```
