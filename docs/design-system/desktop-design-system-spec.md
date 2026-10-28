# Hermes Aura Desktop 极客美学设计系统规范 (Desktop Design System Spec)

> **版本**：v3.1-Director Masterpiece (通栏全宽对话流 · 740px黄金收敛输入舱 · OpenChamber竖向场景轨 · 极致精简微条)  
> **主持架构师**：Aura 设计总监兼首席 UI/UE 架构师 (Profile: aura)  
> **适用平台**：macOS / Windows / Linux 桌面原生及 Web 生产力工作台  
> **核心原则**：顶栏极致净化、中间通栏顶格对话流、输入舱黄金收敛居中、右边栏 OpenChamber 竖向多模态场景轨、状态栏极致精简微条、微距物理受光高级质感。

---

## 1. 桌面端空间骨架与净化架构 (Desktop Spatial Anatomy & Purified Architecture)

桌面端作为复杂任务（Coding Agent + 个人全能助理）的中枢工作台，必须在高信息密度与纯粹专注力之间取得最高境界的平衡。v3.1 架构彻底落实用户修改意见：消除侧栏内联关闭按钮、将中间消息流左右顶满侧边栏、将输入框收窄至黄金宽度（740px）、将右边栏改造为参考 OpenChamber 的竖向场景导航轨，并对底部状态栏实施极致精简。

### 1.1 空间布局总览矩阵

```
+----------------------------------------------------------------------------------------------------------------------+
| [● ● ●] [◀]  ● Q4 跨境供应链智能对账引擎开发                                            [中 / EN]  [☼/☾]  [▶]        |
+-------------------+-------------------------------------------------------------+------------------------------------+
|  LEFT RAIL        |  MIDDLE CONVERSATION POD (FLUID CANVAS)                     |  RIGHT INSPECTION POD              |
|  (会话与导航轨)    |  (核心对话流 · 100% 通栏顶格铺满 · 优雅内边距 32px)             |  (OpenChamber 竖向场景导航检查舱)    |
|                   |                                                             |                                    |
|  Width: 260px     |  Canvas Width: 100% 全宽顶到侧边栏 (无空荡两翼)              |  Total Width: 410px                |
|  Collapsible(0px) |  Padding: 24px 32px 180px (开阔舒展阅读)                     |  Collapsible (0px)                 |
|  Shortcut: Ctrl+B |  Bottom Scrim: 120px 渐变柔光遮罩 (杜绝滚动死锁与遮挡)        |  Shortcut: Cmd+\                   |
|                   |                                                             |                                    |
|  [+ 新建会话]      |  +-------------------------------------------------------+  |  [V-Rail: 62px] | [Detail: 348px]  |
|  (全宽无内联按键)  |  | FLOATING INPUT DOCK (黄金限宽居中 max-width: 740px)    |  |  [成果物 (1)]   | 成果物审阅标头   |
|  [搜索 Cmd+K]     |  | [Prompt Textarea]                                     |  |  [浏览器 (●)]   | 4指标网格与报告  |
|                   |  | [⚡ Hermes-3 70B ▾] [🧠思考:关/低/中/高] [🛡️审批:..] [⇡] |  |  [Git变更(+28)] | 或 60FPS CDP视口 |
|                   |  +-------------------------------------------------------+  |  [认知记忆 (4)] | 或 代码Diff/画像 |
+-------------------+-------------------------------------------------------------+------------------------------------+
| STATUS BAR (极致微条): ● 已连接 21ms                                                                                 |
+----------------------------------------------------------------------------------------------------------------------+
```

| 布局区域 | 尺寸规范 (Tokens) | 自适应与布局约束 | 职责与交互定义 |
|---|---|---|---|
| **窗口外壳 (Window Shell)** | `100vw * 100vh` 铺满 | 居中弹性收放，无边框原生沉浸感 | 系统级深浅基底、亚克力毛玻璃滤镜、窗体环境阴影与 1px 微发光切边 |
| **净化顶栏 (Window Titlebar)** | Height: `42px` 固定 | 两端固定控件（各 `250px`），中间弹性居中 | **彻底拔除模型/温度等冗余堆叠**。左侧红绿灯+侧栏折叠，中间纯粹会话标题+微光脉冲点，右侧语言/主题/右栏开关 |
| **左侧会话轨 (Left Rail)** | `var(--rail-width): 260px` | 支持一键折叠至 `0px`（`Ctrl+B` 或顶栏按钮） | **拔除内联折叠按钮**，新建会话按钮横向满格；活跃/归档分组、用户信息与认证徽章 |
| **中间对话舱 (Middle Pod)** | `flex: 1 1 0%` (`min-width: 0`) | **100% 全宽铺满顶到侧边栏**，`padding: 24px 32px 180px` | 消息气泡自然舒展顶格展开，消除过往 860px 在宽屏下两侧留出的大块空荡空白 |
| **内嵌控制输入舱 (Input Dock)** | **`max-width: 740px` 黄金约束** | 底部悬浮居中，黄金收敛（720px~760px） | 人体工学打字聚焦，**内嵌集成**模型选择器、思考深度、审批策略微型胶囊与发送高光按钮 |
| **自适应检查舱 (Context Deck)** | `var(--inspector-width): 410px` | 支持一键折叠至 `0px`（`Cmd/Ctrl+\\`） | **OpenChamber 竖向场景导航轨 (62px)** + 详情工作舱 (348px)，垂直排列四大核心模块 |
| **极致精简状态栏 (Status Bar)** | Height: `22px` 极简一体化微条 | 贴底固定横贯，去除全部低信噪比字符 | **干掉网关就绪、干掉会话ID、干掉右侧模型与Token统计**；仅保留静谧翡翠微光点与延迟读数 |

---

## 2. 界面纯化与折叠控制规范 (Purified Surface & Inline Button Elimination)

为了彻底消除界面视觉噪音与重复控件，v3.1 执行严格的净化契约：

### 2.1 剔除清单与净化契约
- ❌ **彻底拔除左侧栏内联折叠按钮 (`btnRailCollapseInline`)**：左边栏顶部 `+ 新建会话` 获得完整宽度展开空间，视觉笃定干净；
- ❌ **彻底拔除右检查舱内联关闭按钮 (`btnInspectorCloseInline`)**：右边栏不再需要挤占标题栏的额外叉号/箭头；
- ❌ **统一折叠触发入口**：
  - 左栏折叠：顶栏左翼图标按钮 `btnToggleLeftRail` 或原生快捷键 `Ctrl+B` / `Cmd+B`；
  - 右栏折叠：顶栏右翼图标按钮 `btnToggleInspector` 或原生快捷键 `Cmd+\` / `Ctrl+\`；
- ❌ **彻底清除顶栏模型、温度、分词与调试条**：聚焦会话标题本身。

### 2.2 顶栏留存与微交互要素
顶栏高度统一为 **`42px`**：
1. **左翼窗口控制区 (250px)**：macOS 物理受光三色灯（红 `#FF5F56`、黄 `#FFBD2E`、绿 `#27C93F`）、1px 垂直分隔线、左栏折叠按钮（带即时微光反馈）；
2. **中心会话专注区 (Flex: 1 居中)**：纯粹的会话标题文本与 **`session-live-pulse` 翡翠微光呼吸点**（7px 圆点，`2.4s` 缓慢物理光晕律动）；
3. **右翼全局辅助区 (250px 右对齐)**：统一高度 `28px` 的双语秒切胶囊（`中 / EN`）、深浅双色基准滑块（`黑曜琥珀 / 羊脂白玉`）、垂直分隔线与右侧检查舱折叠按钮。

---

## 3. 中间对话区全宽通栏与输入舱黄金限宽 (Full-Span Canvas & Golden Dock)

### 3.1 对话区左右顶格全屏通栏
过往设计中，中间消息流采用了硬编码的 `max-width: 860px; margin: 0 auto;`，导致在宽屏显示器或折叠侧边栏时，对话流两侧留下大量空旷死区，不仅视觉散漫，而且代码块与复杂财务表格被迫挤压。

**v3.1 重构规范**：
```css
.conversation-pod {
  flex: 1 1 0%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  background: var(--bg-panel);
  overflow: hidden;
}

/* 中间对话栏宽度保证全屏，左右顶到侧边栏，保留优雅内边距 */
.content-fluid-canvas {
  width: 100%;
  max-width: 100%;
  margin: 0;
  box-sizing: border-box;
  padding: 24px 32px 180px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
```
- **用户气泡**：`max-width: min(80%, 820px)`，靠右自然对齐，阅读舒适；
- **助手气泡**：`width: 100%` 通栏延展，思维推理链卡片、工具调用胶囊、Diff代码块与交付物卡片在侧边栏之间舒展铺陈；
- **防遮挡柔光层**：底部保持 `120px` 的渐变柔光遮罩（`.dock-scrim-fade`），确保长文本滑动时不产生锯齿截断。

### 3.2 输入舱黄金限宽收敛 (max-width: 740px)
输入框不可跟随对话区无限拉伸（避免宽屏下一行输入极长导致眼球横跳疲劳），必须严格锁定在 **740px (720px~760px 黄金范围)** 居中悬浮：

```css
.input-dock-container {
  position: absolute;
  bottom: 16px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  padding: 0 24px;
  pointer-events: none;
  z-index: 40;
}

.input-card-box {
  pointer-events: auto;
  width: 100%;
  max-width: 740px; /* 黄金限宽 740px，精巧收敛，打字聚集感极佳 */
  background: var(--bg-backdrop);
  backdrop-filter: blur(28px);
  -webkit-backdrop-filter: blur(28px);
  border: 1px solid var(--border-medium);
  box-shadow: var(--shadow-dock), var(--specular-line);
  border-radius: 14px;
  padding: 10px 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
```

---

## 4. OpenChamber 竖向多模态场景轨体系 (OpenChamber Vertical Navigation Deck)

### 4.1 为什么采用竖向导航？
在传统横向胶囊 Tab 设计中，390px 宽度的侧边栏顶部横向塞入 4 个标签，导致：
1. **中英文排版逼仄**：英文下 `Artifacts` / `Browser` / `Git Diff` / `Memory` 极易溢出或被迫截断文字；
2. **场景层级混乱**：场景切换与下方的文件操作栏挤在同一水平线，形成双重横条视觉疲劳；
3. **缺乏状态指征**：横向小胶囊无法清晰承载像 CDP 60FPS 实时绿点、Git `+28` 增量角标、成果物数量等高频动态反馈。

### 4.2 OpenChamber 竖向场景轨架构
借鉴 OpenChamber 经典工程侧栏范式，将检查舱（`.inspection-pod`）解构为 **双列协同布局**（详情舱在左，场景导航轨贴靠窗口最右边缘）：
- **总宽度**：`410px`（宽屏自适应，折叠时平滑过渡至 `0px`）；
- **详情工作舱 (`.inspector-detail-area`)**：宽度 `348px`，背景为面板底色（`var(--bg-panel)`），展示当前激活场景的工作台；
- **最右侧场景轨 (`.inspector-vertical-rail`)**：宽度固定 `62px`，底色为基底轨道色（`var(--bg-rail)`），贴靠窗口极右边缘（Far-Right Docking），与现代 IDE 侧栏规范一致。

```
+-------------------------------------------------------------+
| [Detail Area Header: 38px]          | [V-Rail: 62px]        |
| 成果物审阅 | Q4_Settlement_Audit...  |                       |
+-------------------------------------+                       |
| [Detail Content Pane: 348px]        | [ 成果物 (1) ]  <--   |
|                                     |  (高光+指示条)        |
| [文件标头 + 导出PDF + 复制MD]        |                       |
|                                     | [ 浏览器 (●) ]        |
| [2x2 财务审计对账指标网格]           |  (60FPS脉冲绿点)     |
| - 核对总单数: 1,420 笔               |                       |
| - 完全对齐率: 99.79%                 | [ Git变更(+28) ]      |
| - 汇差总敞口: $142.50                |  (代码增删微角标)    |
| - 处理策略: 自动平账补偿             |                       |
|                                     | [ 认知记忆 (4) ]      |
| [审计终审结论卡片 PASSED]            |  (待办完成率微角标)  |
+-------------------------------------------------------------+
```

### 4.3 竖向导航项微交互标准
每个导航项（`.vertical-tab-item`）包含：
1. **左侧物理受光指示条 (`.vertical-tab-indicator`)**：激活时纵向平滑展开（`scaleY(1)`），高饱和琥珀金/翡翠绿；
2. **图标与状态角标徽章 (`.vertical-tab-badge`)**：
   - 成果物：角标 `1`；
   - 远程浏览器：`● CDP 60FPS` 翠绿呼吸灯；
   - Git 变更：`+28` 增量高亮徽章；
   - 认知记忆：待办任务计数角标 `4`；
3. **高清晰两行微排版**：10px 字体，居中紧凑对齐，中英切换绝不折行或截断；
4. **动态详情标头联动 (`#inspectorScenarioTag` & `#inspectorScenarioSub`)**：点击任一竖向 Tab，右侧详情区顶部标头瞬时平滑更新。

---

## 5. 状态栏彻底极致精简微条规范 (Ultra-Minimal Status Micro-Bar)

用户明确指令：**“网关就绪 HTTP2 干掉，会话 #AURA-LIVE-088 干掉，右下角 status-group-right 干掉”**。

在自动化 Agent 工作流中，底部常驻密集的网络握手串、内部随机编号与分词读数具有极强的工业调试痕迹，对生产力用户而言属于纯粹的视觉负资产。

### 5.1 极致微条设计准则
- **高度压缩至 `22px`**：从原先 26px 压至 22px，减少无谓纵向空间挤占；
- **纯粹单一状态源**：彻底清除右侧全部内容（模型、思考等级、Token 计数、耗时），清除网关协议与内部会话 Hash；
- **仅保留微弱心跳绿点与延迟微字**：
  ```html
  <footer class="status-bar">
    <div class="status-minimal">
      <span class="status-dot-active" title="Connected · 21ms"></span>
      <span class="status-connected-text" data-i18n="status_connected">已连接</span>
      <span class="status-latency num-tabular">21ms</span>
    </div>
  </footer>
  ```
- **视觉感受**：如同一台高精度专业仪器上的常亮指示灯，静谧、稳定、不抢戏。

---

## 6. 电影级双色基准与物理微距质感 (Cinematic Optics & Themes)

### 6.1 Theme A: 【黑曜琥珀 (Obsidian Gold)】
- 底板 `#090A0F`，侧栏 `#0E1015`，卡片 `#151720`；
- 高纯度暖金琥珀色 `#F59E0B` / `#FBBF24` 辉光；
- 1px 天光高光线：`inset 0 1px 0 0 rgba(255, 255, 255, 0.10)`；
- 悬浮输入舱阴影：`0 20px 48px -10px rgba(0, 0, 0, 0.75)`。

### 6.2 Theme B: 【羊脂白玉 (Suet White Jade)】
- 拒绝生硬死白，采用凝脂白 `#F4F6F9` 与乳白 `#FAFAFC`；
- 帝王凝碧翡翠绿 `#0D7A5E` / `#0B6850`，文本对比度高于 `12.5:1`；
- 活跃会话与竖向 Tab 注入细致左侧指示光条与 `0 2px 8px rgba(15, 23, 42, 0.04)` 微阴影，消除同色融和失真；
- 深色暗夜青灰 `#0F172A` 正文，长时间阅读无眩光。

---

## 7. 工业级交付门禁与落地核查清单 (Production Release Gate)

| 门禁项 | 审查标准 | 验证手段 | 状态 |
|---|---|---|---|
| **状态栏极致精简门禁** | 拔除“网关就绪 HTTP2”、“会话 #AURA-LIVE-088”及右下角模型/Token/耗时；仅留绿点与连接字 | 真实 DOM 比对与多模态视觉审校 | ✅ PASSED (`22px` 极简一体化微条) |
| **内联折叠按钮消除门禁** | 拔除 `btnRailCollapseInline` 与 `btnInspectorCloseInline`；侧栏统一由顶栏按键及快捷键控制 | 自动化检索与点击交互测试 | ✅ PASSED (完全根除视觉冗余) |
| **对话流通栏顶满门禁** | 中间消息流左右自然顶到侧边栏（`max-width: 100%`, `padding: 24px 32px`），消除宽屏两侧空荡 | 浏览器计算样式与布局宽度断言 | ✅ PASSED (通栏开阔自然铺满) |
| **输入舱黄金限宽门禁** | 输入舱最大宽度限定 `740px` (720px~760px) 居中悬浮，兼顾聚合打字感与防拉伸 | 响应式多断点尺寸检查 | ✅ PASSED (`max-width: 740px` 黄金约束) |
| **OpenChamber 竖向场景轨门禁** | 右边栏采用 62px 竖向导航轨 + 348px 详情舱，垂直排列成果物/浏览器/Git/记忆 | 真实垂直 Tab 切换与联动测试 | ✅ PASSED (4大场景竖向流转顺畅) |
| **电影级微距质感门禁** | 具备 1px 细微天光高光、多层半透明描边与深浅双色高奢质感，无泥泞土味 | 视觉多模态模型严格审校 | ✅ PASSED (黑曜琥珀 / 羊脂白玉双顶级) |
| **双语防豆腐块门禁** | 中英双语字体 100% 覆盖，字库本地化防御，无任何豆腐块 `□` | 截图视觉语义扫描校验 | ✅ PASSED (零豆腐块无刷新瞬切) |
