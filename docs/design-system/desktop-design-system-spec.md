# Hermes Flux Desktop 极客美学设计系统规范 (Desktop Design System Spec)

> **版本**：v4.0 Pure Precision (通栏全宽对话流 · 740px黄金输入舱 · 微轨 clamp + 自适应抽屉左双轨 · 顶栏轻量集成延迟 · 纯粹微距物理受光)  
> **适用平台**：macOS / Windows / Linux 桌面原生及 Web 生产力工作台  
> **核心原则**：顶栏极致净化、中间通栏顶格对话流、输入舱黄金收敛居中、左侧微轨（`clamp(58px, 4.2vw, 72px)`）+ 自适应抽屉双轨导航、右侧竖向多模态检查舱、彻底拔除底部冗余状态栏、发丝线微距物理受光。

---

## 1. 桌面端空间骨架 (Desktop Spatial Architecture)

桌面端作为复杂任务（Coding Agent + 个人全能助理）的中枢工作台，必须在高信息密度与纯粹专注力之间取得最高境界的平衡。
全面推行左双轨（微轨 `clamp(58px, 4.2vw, 72px)` + 自适应抽屉）、通栏顶格工作台、740px 黄金悬浮输入舱与 410px 右检查舱；状态栏已彻底从底部拔除，延迟读数与连接态轻量收敛至顶栏右上角，将全屏纵向空间百分之百归还给对话与创作区。

### 1.1 空间布局总览矩阵

```
+----------------------------------------------------------------------------------------------------------------------+
| [● ● ●] [◀]  ● Q4 跨境供应链智能对账引擎开发                                   [● 已连接 21ms]  [中 / EN]  [☼/☾]  [▶]  |
+-------------------+-------------------------------------------------------------+------------------------------------+
|  LEFT DUAL-RAIL   |  MIDDLE CONVERSATION POD (FLUID CANVAS)                     |  RIGHT INSPECTION POD              |
|  (左侧双轨架构)    |  (核心对话流 · 100% 通栏顶格铺满 · 优雅内边距 32px)             |  (竖向场景导航检查舱)               |
|                   |                                                             |                                    |
|  Micro-Rail:58~72|  Canvas Width: 100% 全宽顶到侧边栏 (无空荡两翼)              |  Total Width: 410px                |
|  Drawer: flex-1  |  Padding: 24px 32px 180px (开阔舒展阅读)                     |  Collapsible (0px)                 |
|  Total: 264px*   |  Bottom Scrim: 120px 渐变柔光遮罩 (杜绝滚动死锁与遮挡)        |  Shortcut: Cmd+\                   |
|  Shortcut: Ctrl+B |                                                             |                                    |
|  (折叠至微轨总宽) |  +-------------------------------------------------------+  |  [V-Rail: 62px] | [Detail: 348px]  |
|                   |  | FLOATING INPUT DOCK (黄金限宽居中 max-width: 740px)    |  |  [成果物 (1)]   | 成果物审阅标头   |
|  [专职Bot列表]    |  | [Prompt Textarea]                                     |  |  [浏览器 (●)]   | 4指标网格与报告  |
|  [群聊研讨室]     |  | [⚡ Hermes-3 70B ▾] [🧠思考:关/低/中/高] [🛡️审批:..] [⇡] |  |  [Git变更(+28)] | 或 60FPS CDP视口 |
|  [排查会话池]     |  +-------------------------------------------------------+  |  [认知记忆 (4)] | 或 代码Diff/画像 |
+-------------------+-------------------------------------------------------------+------------------------------------+
```

> \* ASCII 图为示意：微轨实际宽 `clamp(58px, 4.2vw, 72px)`，抽屉由 `flex: 1 1 0%` 吸收剩余（1440 视口约 202px），展开总宽由 `--rail-w-left` 决定（默认 `264px`，可拖 `264~480px`）。

| 布局区域 | 尺寸规范 (Tokens) | 自适应与布局约束 | 职责与交互定义 |
|---|---|---|---|
| **窗口外壳 (Window Shell)** | `100vw * 100vh` 铺满 | 沉浸式无边框视口 | 系统级深浅基底、1px 微发光切边与极细阴影 |
| **净化顶栏 (Window Titlebar)** | 内容高 `42px` + `1px` 下边框（总高 43px） | 两端固定控件，中间弹性居中 | 顶栏左侧原生交通灯+侧栏折叠，中间纯粹会话标题，右侧优雅收敛连接状态点+21ms延迟+语言/主题切换+右检查舱折叠；依赖顶栏的 `fixed` 定位统一用 `calc(var(--geo-titlebar) + 1px)` |
| **左侧双轨 (Left Dual-Rail)** | 展开总宽 `--rail-w-left`（默认 `264px`，可拖 `264~480px`）；抽屉 `flex-1` 吸收剩余（1440 视口约 `202px`）；微轨 `clamp(58px, 4.2vw, 72px)` | 支持一键折叠抽屉收敛至微轨（`Ctrl+B`） | 微轨承载专职 Bot、群聊研讨室与排查会话池图标切换，内层无条件补偿 `1px` 右边框（折叠态补回内容区，展开态由抽屉预算吸收）；抽屉展示展开详情与新建会话入口 |
| **中间对话舱 (Middle Pod)** | `flex: 1 1 0%` (`min-width: 0`) | **100% 全宽铺满顶到侧边栏**，`padding: 24px 32px 180px` | 消息气泡自然舒展顶格展开，消除宽屏两侧空荡死区 |
| **悬浮输入舱 (Input Dock)** | **`max-width: 740px` 黄金限宽** | 底部悬浮居中，黄金收敛（720px~760px） | 人体工学打字聚焦，内嵌集成模型选择器、思考深度、审批策略与发送按钮 |
| **自适应检查舱 (Context Deck)** | `410px` 基线 | 支持一键折叠至 `0px`（`Cmd/Ctrl+\\`） | 竖向场景导航轨 (62px) + 详情工作舱 (348px) |
| **底部状态栏 (Status Bar)** | **彻底拔除** | 高度 `0px`，空间完全释放归还舞台 | 网关连接状态与毫秒级延迟读数收敛至顶栏右上角（淡雅 11px 等宽数字） |

---

## 2. 界面纯化与折叠控制规范 (Purified Surface)

### 2.1 剔除清单与净化契约
- ❌ **彻底拔除左侧栏内联折叠按钮**：左边栏顶部 `+ 新建会话` 获得完整宽度展开空间，视觉干净利落；
- ❌ **彻底拔除右检查舱内联关闭按钮**：右边栏不再需要挤占标题栏的额外叉号/箭头；
- ❌ **彻底拔除底部独立状态栏**：消除 22px 纵向死区，连接状态与延迟并入顶栏；
- ❌ **统一折叠触发入口**：
  - 左栏折叠：顶栏左翼图标按钮或快捷键 `Ctrl+B`（macOS 为 `Cmd+B`），收起抽屉收敛至微轨总宽 `calc(var(--geo-micro-rail) + 1px)`；
  - 右栏折叠：顶栏右翼图标按钮或快捷键 `Ctrl+\`（macOS 为 `Cmd+\`），完全折叠展开。

---

## 3. 中间对话区全宽通栏与输入舱黄金限宽

### 3.1 对话区左右顶格全屏通栏
```css
.conversation-pod {
  flex: 1 1 0%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  background: var(--panel);
  overflow: hidden;
}

.content-fluid-canvas {
  width: 100%;
  max-width: 100%;
  margin: 0;
  box-sizing: border-box;
  padding: 24px 32px 180px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
```
- **用户气泡**：`max-width: min(80%, 820px)`，靠右自然对齐；
- **助手气泡**：`width: 100%` 通栏延展，思维推理链、工具调用胶囊在侧边栏之间舒展铺陈；
- **防遮挡柔光层**：底部保持 `120px` 渐变柔光遮罩（`.dock-scrim-fade`），确保长文本滑动时不产生视觉截断。

### 3.2 输入舱黄金限宽收敛 (max-width: 740px)
输入框不可跟随对话区无限拉伸（避免宽屏下一行输入极长导致眼球横跳疲劳），严格锁定在 **740px** 居中悬浮：
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
  max-width: 740px;
  background: var(--input);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-dock);
}
```
