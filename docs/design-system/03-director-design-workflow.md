# 跨端 UI/UE 设计总监全流程工作流 (Director SOP)

> **导言**：
> 顶级的设计从不是灵光乍现的碰运气，而是一套**严密推演、可复现、端到端闭环的工业级工程流水线**。
> 本工作流覆盖从业务目标解构、心智模型映射、空间网格骨架、美学 Token 架构、跨端界面精细化，一直到动效物理学与严苛代码级交付验收门禁的 6 大阶段。

---

## 全流程阶段概览

```
[阶段一: 心智解构与目标] ➔ [阶段二: 空间骨骼与架构] ➔ [阶段三: 美学Token与DNA]
        │                           │                           │
        ▼                           ▼                           ▼
  痛点与心智模型             IA / 8pt线框骨架            色彩/字号/阴影Token
─────────────────────────────────────────────────────────────────────────
[阶段四: 跨端高保真精修] ➔ [阶段五: 物理动效与微交互] ➔ [阶段六: 8大交付验收门禁]
        │                           │                           │
        ▼                           ▼                           ▼
  Mobile/Desktop/Web       Spring弹性 / 退出快于进入     代码还原度 / A11y / 零CLS
```

---

## 阶段一：业务解构与心智模型映射（UX Discovery）

在打开任何设计软件（Figma）画界面之前，必须先回答三个第一性原理问题：

1. **用户真实目标（Goals） vs 表面任务（Tasks）**：
   - 过滤掉产品经理或客户提出的虚假解决方案（如“加一个浮动大按钮”），回归底层意图（如“用户在这一步最想知道的是订单到底有没有付款成功”）。
2. **心智模型推演（Mental Model Mapping）**：
   - 用户在现实生活或同类顶级产品中形成的肌肉记忆与预期是什么？
   - 梳理出系统的**三种状态**：
     - **理想态（Happy Path）**：数据完整时的最佳呈现；
     - **边界与空态（Empty & Edge States）**：0 数据、极长文案、断网、权限缺失时的友好引导；
     - **错误与异常态（Error States）**：输入错误时就近反馈与自愈路径。
3. **软件姿态判定（Software Posture）**：
   - 确定是长时间沉浸的**独占姿态**（降低视觉刺激、最大化工作区），还是用完即走的**暂态姿态**（突出单个核心动作、大字号）。

---

## 阶段二：信息架构与空间骨架搭建（IA & Wireframe）

1. **信息层级裁决（Visual Hierarchy Triage）**：
   - 严格遵循**每屏单一核心主动作原则（One Primary Action per View）**。
   - 对页面所有信息按重要性进行 P0 / P1 / P2 分级，P0 必须在第一视觉焦点 1 秒内被感知。
2. **纯灰度线框推演（Grayscale-first Wireframing）**：
   - **设计禁忌**：过早引入色彩。如果在黑白灰状态下界面的层次、对比和主次逻辑不成立，涂抹上彩色只会掩盖结构的缺陷。
   - 验证格式塔邻近原则：是否通过间距（4px/8px/16px/24px）自然形成了逻辑区块？
3. **跨端导航骨骼对齐**：
   - **移动端**：单手拇指热区规划，底部导航栏（Bottom Bar）≤ 5 项，顶部仅承载全局状态与返回；
   - **桌面端**：左侧树状折叠侧边栏（Sidebar）+ 顶部面包屑（Breadcrumb）+ 全局 Command Palette (Cmd+K)；
   - **Web 端**：响应式折叠汉堡或侧滑抽屉，确保小屏与宽屏平滑降级。

---

## 阶段三：美学系统与 Token 架构定义（Aesthetic DNA）

设计总监必须将美学感性转化为**严谨的数学 Token 系统**，确保全团队在代码与设计中拥有唯一的“真实之源（Single Source of Truth）”。

### 1. 空间与网格 Token（4pt / 8pt Grid）
```css
--space-05: 2px;   /* 极微微调 */
--space-1:  4px;   /* 紧密内距，标签与图例 */
--space-2:  8px;   /* 组内元素基线间距 */
--space-3:  12px;  /* 紧凑卡片内边距 */
--space-4:  16px;  /* 标准容器内边距、跨端水槽标准 */
--space-6:  24px;  /* 卡片与卡片之间的组间距 */
--space-8:  32px;  /* 区块间距 */
--space-12: 48px;  /* 大模块留白 */
--space-16: 64px;  /* 页面级大呼吸负空间 */
```

### 2. 字体阶梯 Token（Type Scale）
以 16px 为基准正文，收紧行高比例：
- `Display`：36px / 44px（Line-height）/ Weight: 700 / Tracking: -0.025em
- `Heading-1`：28px / 36px / Weight: 600 / Tracking: -0.02em
- `Heading-2`：20px / 28px / Weight: 600 / Tracking: -0.015em
- `Heading-3`：16px / 24px / Weight: 600 / Tracking: -0.01em
- `Body-Regular`：14px / 22px / Weight: 400 / Tracking: 0
- `Caption-Meta`：12px / 18px / Weight: 500 / Tracking: 0.01em

### 3. 语义化色彩体系（Semantic Tokens）
- **绝不在组件内写死裸 Hex 码**（如 `#2563EB`），必须全部转化为语义 Token：
  - `bg-surface-canvas`（画板底色）
  - `bg-surface-card`（卡片表面）
  - `bg-surface-elevated`（悬浮面板）
  - `text-primary`、`text-secondary`、`text-muted`
  - `border-subtle`（微弱边界）、`border-strong`
  - `brand-primary`、`brand-primary-hover`、`brand-primary-active`
  - `status-success`、`status-warning`、`status-error`

---

## 阶段四：跨端高保真界面精雕（Multi-Platform Craft）

针对不同终端硬件特性做深度定制，绝非简单的“网页缩放”：

### 1. 移动端（iOS / Android 原生 App）
- **触控区域保证**：所有可点按元素的物理触摸热区必须达到 **44×44 pt (iOS) / 48×48 dp (Android)**。若图标视觉仅有 20px，必须加透明 Padding 扩展热区。
- **安全区处理（Safe Area）**：顶端灵动岛/刘海屏与底端横条（Home Indicator）必须做精准的 `safe-area-inset` 垫高。
- **连续曲率超椭圆**：容器圆角使用 Squircle 连续平滑算法，配合卡片内缩圆角法则（外圆角半径 = 内圆角半径 + 内边距 Padding）。

### 2. 桌面客户端（macOS / Windows 深度工作台）
- **高密度信息排布**：表格与仪表盘支持紧凑模式（Dense Mode），行高压缩至 32px-36px。
- **键盘优先（Keyboard First）**：
  - 全局 Command Palette（`Cmd+K` / `Ctrl+K`）支持秒级搜索与指令跳转；
  - 核心功能必须标注清晰的快捷键提示（Tooltips 带 `⌥+Enter` 等）。
- **右键上下文菜单（Context Menu）**：为专业用户提供符合平台规范的高效右键操作。

### 3. PC Web 响应式体验
- **自适应断点（Breakpoints）**：移动端 (<640px)、平板 (768px-1024px)、标准桌面 (1280px)、超宽带屏 (>1536px)。
- **超宽屏限制**：正文内容容器最大宽度锁死在 `max-w-7xl`（1280px）或正文 `max-w-prose`（65-75 字符），防止宽屏下文字拉成一条细长带导致视线无法追踪。

---

## 阶段五：动效物理学与微交互打磨（Motion & Feedback）

好的动效是空间的延伸，坏的动效是时间的浪费。

1. **动效三定律**：
   - **定律一：因果律与空间连续性（Spatial Continuity）**。元素绝不能凭空出现。模态框必须从点击的卡片锚点处展开放大，关闭时收缩回原处。
   - **定律二：退出快于进入（Exit Faster Than Enter）**。
     - 进入：`250ms - 300ms`（给眼睛适应新信息的时间）；
     - 退出：`150ms - 200ms`（快速让出空间，严禁阻碍用户连击）。
   - **定律三：自然弹性（Spring Dynamics）**。
     - 严禁全屏使用机械 Linear 或纯平淡 Ease-in-out。
     - 弹簧参数标定：`stiffness: 300, damping: 25, mass: 1`，呈现紧凑、利落且带微弹性的高级手感。
2. **移动端触觉反馈编排（Haptic Orchestration）**：
   - 轻量点按（Toggle 开关）：`UIImpactFeedbackGenerator(style: .light)`；
   - 破坏性删除：`UINotificationFeedbackGenerator(.warning)`；
   - 成功提交：`UINotificationFeedbackGenerator(.success)`。

---

## 阶段六：总监级 8 大交付验收门禁（Quality Gate）

代码上线或方案定稿前，必须逐项通过以下 8 道严苛红线：

| 门禁项 | 检验维度 | 硬性合格标准 |
|---|---|---|
| **1. 格式塔空间门禁** | 间距与对齐 | 绝对不存在非 4/8 整数倍的奇数外距；组内距离严格小于组间距离。 |
| **2. 无障碍色彩门禁** | 对比度（A11y） | 正文文本与背景对比度 ≥ **4.5:1**（WCAG AA 级）；大标题 ≥ **3:1**。 |
| **3. 触控热区门禁** | 可点击物理尺寸 | 移动端所有交互控件热区严格 ≥ **44×44 pt**，相邻热区不重叠。 |
| **4. 文本排版门禁** | 行长与行高 | 中文正文单行严控在 30-45 字之间，行高严格在 1.5-1.6 倍，大标题收紧 tracking。 |
| **5. 材质光影门禁** | 阴影与微描边 | 杜绝单层死黑高透明度投影；全部采用双层漫反射阴影，暗色模式搭配 1px 微内描边。 |
| **6. 动效感知门禁** | 持续时间与弹性 | 微交互时长在 150ms-300ms，退出快于进入，使用 Spring 弹簧曲线，无掉帧卡顿。 |
| **7. 异常容错门禁** | 极限边界态 | 覆盖空数据（Empty）、超长溢出（Text Overflow/Ellipsis）、断网与报错 100% 态覆盖。 |
| **8. 性能与 CLS 门禁** | 渲染稳定度 | 图片与异步组件预留固定占位骨架屏（Skeleton），累积布局偏移 **CLS < 0.1**。 |
