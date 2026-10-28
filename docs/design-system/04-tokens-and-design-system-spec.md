# 跨端设计系统与 Token 规范 (Design Tokens Spec)

> 本规范定义跨端产品（Web、iOS、Android、macOS、Windows）共享的设计 Token 字典与实现代码映射，支持 Tailwind CSS、CSS Variables、SwiftUI 与 React Native / Compose 快速装配。

---

## 1. 空间与网格 Tokens (Spacing & Grid)

### CSS / SCSS 变量定义
```css
:root {
  --space-0:   0px;
  --space-05:  2px;    /* 微型徽标与极细图标内距 */
  --space-1:   4px;    /* 紧凑内距：标签内边距、行间微调 */
  --space-2:   8px;    /* 组内元素基准间距（图标与文字、输入框内距） */
  --space-3:   12px;   /* 小型卡片内边距 */
  --space-4:   16px;   /* 标准组件内边距、移动端边距水槽（Gutter） */
  --space-5:   20px;   /* 适度间隔 */
  --space-6:   24px;   /* 桌面端内容水槽、卡片与卡片间距 */
  --space-8:   32px;   /* 模块间垂直间距 */
  --space-10:  40px;   /* 大模块分割 */
  --space-12:  48px;   /* 页面主章节大留白 */
  --space-16:  64px;   /* 呼吸级大负空间 */
  --space-24:  96px;   /* 落地页 Hero 区块留白 */
}
```

---

## 2. 色彩系统 Tokens (Color System - Slate Palette)

### 2.1 语义色彩映射表
采用冷暖适宜的 **Slate 中性基底**，杜绝刺眼纯黑纯白：

| 语义名称 (Token) | 浅色模式 (Light Mode) | 深色模式 (Dark Mode) | 作用场景与层级 |
|---|---|---|---|
| `surface-canvas` | `#F8FAFC` (Slate-50) | `#0B0F17` (Deep Slate-950) | 全局底层画板与窗口背景 |
| `surface-subtle` | `#F1F5F9` (Slate-100) | `#111827` (Gray-900) | 侧边栏底色、嵌套面板底色 |
| `surface-card` | `#FFFFFF` (Pure White) | `#1E293B` (Slate-800) | 内容卡片、表格行、输入框底色 |
| `surface-elevated`| `#FFFFFF` (White + Shadow)| `#334155` (Slate-700) | 模态弹窗、浮动下拉菜单、Popover |
| `text-primary` | `#0F172A` (Slate-900) | `#F8FAFC` (Slate-50) | 主标题、重要正文、核心数值 |
| `text-secondary` | `#475569` (Slate-600) | `#94A3B8` (Slate-400) | 次级说明文案、副标题、表头 |
| `text-muted` | `#94A3B8` (Slate-400) | `#64748B` (Slate-500) | 占位符、禁用文字、时间戳 |
| `border-subtle` | `#E2E8F0` (Slate-200) | `rgba(255, 255, 255, 0.08)` | 卡片细微外边框、列表分割线 |
| `border-strong` | `#CBD5E1` (Slate-300) | `rgba(255, 255, 255, 0.16)` | 输入框聚焦边框、激活状态卡片 |
| `brand-primary` | `#2563EB` (Blue-600) | `#3B82F6` (Blue-500) | 主操作按钮、高亮链接、主导航 |
| `status-success` | `#16A34A` (Green-600) | `#22C55E` (Green-500) | 成功提示、已完成状态、正向指标 |
| `status-warning` | `#D97706` (Amber-600) | `#F59E0B` (Amber-500) | 警告、待确认、中风险标记 |
| `status-error` | `#DC2626` (Red-600) | `#EF4444` (Red-500) | 报错提示、破坏性操作按钮、负向指标 |

---

## 3. 字体排印 Tokens (Typography Scale)

### 3.1 跨端统一字体栈
- **西文字体栈**：`-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", sans-serif`
- **中文字体栈**：`"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`
- **等宽代码栈**：`"SF Mono", "Fira Code", "Cascadia Code", "JetBrains Mono", Menlo, monospace`

### 3.2 字阶规范 (Major Third Scale ~1.25)
```css
/* Display 大标题 */
.type-display {
  font-size: 2.25rem;       /* 36px */
  line-height: 2.75rem;     /* 44px (1.22) */
  font-weight: 700;
  letter-spacing: -0.025em; /* 标题紧缩字距 */
}

/* H1 页面一级主标题 */
.type-h1 {
  font-size: 1.75rem;       /* 28px */
  line-height: 2.25rem;     /* 36px (1.28) */
  font-weight: 600;
  letter-spacing: -0.02em;
}

/* H2 模块二级标题 */
.type-h2 {
  font-size: 1.25rem;       /* 20px */
  line-height: 1.75rem;     /* 28px (1.40) */
  font-weight: 600;
  letter-spacing: -0.015em;
}

/* H3 卡片标题 */
.type-h3 {
  font-size: 1rem;          /* 16px */
  line-height: 1.5rem;      /* 24px (1.50) */
  font-weight: 600;
  letter-spacing: -0.01em;
}

/* Body 标准正文 */
.type-body {
  font-size: 0.875rem;      /* 14px */
  line-height: 1.375rem;    /* 22px (1.57) */
  font-weight: 400;
  letter-spacing: 0;
}

/* Caption 辅助元数据 */
.type-caption {
  font-size: 0.75rem;       /* 12px */
  line-height: 1.125rem;    /* 18px (1.50) */
  font-weight: 500;
  letter-spacing: 0.01em;   /* 小字舒展字距 */
}
```

---

## 4. 光学与多层阴影 Tokens (Layered Shadows)

高级阴影由**微接触阴影（Key Shadow）**与**环境散射阴影（Ambient Shadow）**合成：

```css
:root {
  /* Level 1: 基础卡片轻悬浮 */
  --shadow-sm: 
    0 1px 2px 0 rgba(15, 23, 42, 0.05),
    0 1px 3px 1px rgba(15, 23, 42, 0.03);

  /* Level 2: 交互悬停（Hover）与小下拉菜单 */
  --shadow-md: 
    0 4px 6px -1px rgba(15, 23, 42, 0.08),
    0 2px 4px -2px rgba(15, 23, 42, 0.05);

  /* Level 3: 模态抽屉、侧边栏悬浮、上下文菜单 */
  --shadow-lg: 
    0 10px 15px -3px rgba(15, 23, 42, 0.10),
    0 4px 6px -4px rgba(15, 23, 42, 0.06);

  /* Level 4: 顶层全局模态弹窗（Dialog） */
  --shadow-xl: 
    0 20px 25px -5px rgba(15, 23, 42, 0.12),
    0 8px 10px -6px rgba(15, 23, 42, 0.08);
}
```

---

## 5. 圆角与连续曲率公式 (Radii & Squircle)

```css
:root {
  --radius-xs:   4px;    /* 标签 Tag、小复选框 Checkbox */
  --radius-sm:   6px;    /* 紧凑按钮、次级操作组件 */
  --radius-md:   8px;    /* 标准输入框、标准按钮 Button */
  --radius-lg:   12px;   /* 内容小卡片、嵌套容器 */
  --radius-xl:   16px;   /* 主内容卡片、弹窗容器 Modal */
  --radius-2xl:  24px;   /* 移动端底部抽屉 Bottom Sheet */
  --radius-full: 9999px; /* 头像、圆角药丸 Badge */
}
```

> **内缩圆角法则（Nested Radius Formula）**：
> 在卡片内部嵌套子元素时，如果子元素圆角与外框圆角相同，会导致视觉畸变。
> **正确的子圆角公式**：
> `R_inner = max(0, R_outer - Padding)`
> 例如：外框卡片 `R_outer = 16px`，卡片内边距 `Padding = 8px`，则内部子卡片圆角必须设为 `R_inner = 8px`。

---

## 6. 动效曲线与微交互物理 Tokens (Motion Specs)

### 6.1 缓动曲线参数
```css
:root {
  /* 退出与消失曲线：极速收拢 */
  --ease-out-fast: cubic-bezier(0.16, 1, 0.3, 1);
  
  /* 进入与展开曲线：从容平滑 */
  --ease-in-smooth: cubic-bezier(0.32, 0, 0.67, 0);

  /* 悬停与状态轻变 */
  --ease-interactive: cubic-bezier(0.4, 0, 0.2, 1);
}
```

### 6.2 物理弹簧参数（Spring Specs - 适用于 Framer Motion / SwiftUI / React Native）
```json
{
  "spring-subtle": {
    "stiffness": 400,
    "damping": 30,
    "mass": 0.8
  },
  "spring-snappy": {
    "stiffness": 300,
    "damping": 24,
    "mass": 1.0
  },
  "spring-bouncy": {
    "stiffness": 200,
    "damping": 15,
    "mass": 1.2
  }
}
```
- **点击交互反馈**：按下瞬间（Scale 0.96，duration: 100ms），抬起回弹（Spring-snappy，duration: 200ms）。
