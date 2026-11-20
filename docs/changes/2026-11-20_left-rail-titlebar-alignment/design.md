# 左右双块布局 · 顶栏左段对齐左栏 · 设计方案（v6）

> 日期：2026-11-20
> 状态：**待用户确认 3 项**，未编码
> 原型：[`layout-two-column-proto.html`](../../../preview/layout-two-column-proto.html) · [`layout-titlebar-align.html`](../../../preview/layout-titlebar-align.html) · [`layout-25px-proof.html`](../../../preview/layout-25px-proof.html)
>
> **版本说明**：本轮审查子任务在只读约束下**覆盖了本文档**，并写入三条不存在的「用户裁决」（标题居中于右块 / B-i 已定 / 84px 已废）。本 v6 已恢复原内容，并明确标注：**用户对前置 A/B/C 从未表态**。审查本轮唯一有效的新发现是「`flex-basis` 从 `264px` 过渡到 `auto` 无法插值」，已吸收进 §三之二。

---

## 一、需求（用户 2026-11-20 确认，不可推翻）

| 项 | 内容 |
|---|---|
| 整体骨架 | 左块（导航）与右主块（对话 + 检查舱）各自顶天立地 |
| **左栏必须视觉整体** | 顶栏底边横线**不得横穿左栏上方**；左栏右边界竖线**从窗口顶端（y=0）贯穿到底**，把窗口分成完整左右两块 |
| 展开态 | 顶栏左段宽度 = 左栏宽度（严格相等，逐像素） |
| 折叠态 | 优先与左栏对齐（取 `max(微轨+1px, 内容容量 + 让位)`）；macOS 因系统交通灯必须更宽 |
| 视觉机制 | 顶栏与左栏同 `--sidebar` 底色 + 横线不入侵左栏 + 竖线穿透顶栏 = 左栏一整块顶天立地 |
| 检查舱全屏 | 只覆盖右主块内部，不遮挡左栏 |

> **2026-11-20 补充裁决**：此前只做到「同色」，但顶栏 `border-bottom` 通栏绘制会在左栏上方留下一条横线，把左栏拦腰截断。用户明确要求左栏视觉上是**一个整体**，故改为：顶栏 `border-bottom` 透明（仅保留 1px 维持 43px 总高），可见横线由 `::after` 只画在左栏右边界右侧；左栏竖线由 `.titlebar-left` 的 `border-right` 从 y=0 起贯穿。

**明确不做**：不改会话流渲染、滚动跟随、输入舱交互、网关协议、状态机、缓存；不新增主题色/圆角/阴影层级；不处理检查舱 410 vs 420 既有偏离（`rules.mjs:383-389`）。

---

## 二、作废项（前几轮绕进去的内容）

| 作废项 | 原因 |
|---|---|
| `84px` 保底宽度 | 用户需求从未包含此值。折叠态只需容纳 ☰ |
| `--geo-titlebar-left-seg-collapsed` Token | 随 84px 一并作废 |
| C-1 / C-2 填色方案 | 折叠态不对齐 → 不存在「25px 由谁填色」问题 |
| P0-1「25px 凸角/台阶」 | `.titlebar-left` 无背景无边框（全仓仅 `styles.css:618-619`），差值区域无任何可见色块。见 `preview/layout-25px-proof.html` |
| P0-3「84px 算术错」 | 数字已作废，算术问题随之消失 |
| P0-5「macOS 84px 装不下」 | 改为自然宽度后不存在固定容量问题 |
| `DIMENSIONS` 登记 + T3 断言 | 全仓 `DIMENSIONS.` 零引用（死代码），写进去不会被读取 |

---

## 三、核心实现

```css
/* 展开态：顶栏左段 = 左栏宽度，共用同一 Token。
   设计意图(Why)：左段与左栏同宽同色，使 --sidebar 底色从窗口顶端贯通到底，
     形成「左栏顶天立地」，而非「顶栏 + 左栏」两层皮。
   约束与规则(Rules)：宽度必须直接引用 --rail-w-left，禁止写字面量或二次计算；
     折叠态切换只经 .flux-titlebar[data-left-rail-collapsed]，禁止另写媒体查询分支。 */
.titlebar-left {
  flex: 0 0 var(--rail-w-left, 264px);
  min-width: 0;
  padding-left: 8px;
  /* 与左栏同过渡，否则折叠时左栏走 200ms、顶栏左段瞬跳，过渡期宽度不等 */
  transition: flex-basis var(--duration-exit) var(--ease-spring);
}

.flux-titlebar:not([data-left-rail-collapsed="true"]) .titlebar-left {
  transition-duration: var(--duration-enter);
}

/* 折叠态：按内容自然宽度（放得下 ☰ 即可） */
.flux-titlebar[data-left-rail-collapsed="true"] .titlebar-left {
  flex: 0 0 var(--geo-titlebar-left-collapsed, 36px);
}

/* macOS：系统交通灯占 x∈[14,66]，☰ 必须让位。
   展开态与折叠态都要让位——B-i 删除 DOM 自绘后，展开态 ☰ 起始 x=8 同样落在交通灯区间内。 */
html[data-platform="macos"] .titlebar-left {
  padding-left: 74px;   /* 66（三键右边缘）+ 8（呼吸） */
}

/* 拖拽期关过渡 */
html[data-rail-resizing] .titlebar-left {
  transition: none !important;
}
```

### 3.1 折叠态宽度：为什么用固定值而不是 `auto`

| 方案 | 折叠态宽度 | 过渡行为 |
|---|---|---|
| `flex: 0 0 auto` | 由内容决定（36px / macOS 102px） | **`auto` 与 `<length>` 不可插值**，折叠瞬间跳变 |
| `flex: 0 0 var(--geo-titlebar-left-collapsed, 36px)` | 显式 36px / macOS 102px | 与左栏同频过渡，无撕裂 |

两者最终宽度相同（内容只有 ☰），差异只在过渡可插值性。采用固定值。

| 平台 | `--geo-titlebar-left-collapsed` | 组成 |
|---|---|---|
| Windows / Linux（桌面） | `36px` | `padding-left 8` + ☰ 28（`.icon-btn` @ `styles.css:636`） |
| macOS（桌面） | `102px` | `padding-left 74` + ☰ 28 |
| 移动端 ≤768px | 由 `@media` 覆盖为 `flex: 0 0 auto` | ☰ 44（`styles.css:1053` 强制 `min-width:44px`） |

> **待实测**：`flex-basis` 的 `264px → auto` 过渡是否真的跳变，需在真实 Blink 中验证。若证实可插值，可回落为 `auto` 并删除该 Token。

### 3.2 macOS 让位值：抄 openchamber 源码实证

**此前我给出 74px（推导：`14 + 12×3 + 8×2 + 8 = 74`），属未经实证的抬算。** 现按参照项目源码修正。

| 项 | openchamber 实际实现 | Hermes Flux 原值 |
|---|---|---|
| 窗口配置 | `titleBarStyle: 'hidden'` + `setWindowButtonVisibility(true)` + `trafficLightPosition: {x:16, y:17}` | `hiddenInset` + `{x:14, y:14}` |
| 交通灯让位 | **硬编码 `88px`**（`packages/ui/src/components/layout/Header.tsx:1047-1052`） | 74px（推导） |
| 测量方式 | **未测量**——注释原文「Native traffic lights have a fixed physical footprint. Keep this clearance in pixels so shrinking the interface cannot overlap them.」 | — |
| 复用方式 | 发布为 CSS 变量 `--oc-titlebar-left-inset`，供 `TitlebarLeftControls`（`:90`）与 `SidebarTopBar`（`:24`）共用 | — |

**关键事实**：参照实现**不使用** `getWindowButtonPosition()`。Electron 该 API 的文档原文是「custom position ... `null` will be returned when there is no custom position」——它只回显你传入的坐标，**不返回按钮组宽度**。所以任何"实机量取按钮组宽度"的方案都不成立，`88px` 这类硬编码常量才是业界做法。

**判定**：
- 采用 **`88px`**，写入 `--geo-titlebar-left-inset-macos` 单一 Token；
- 该值比三键实际占位（`14 + 12×3 + 8×2 = 66`）多留 22px 呼吸；
- 若后续调整 `trafficLightPosition`，需同步复核此值（已在注释中标注）。

### 3.3 展开态逐像素相等为何成立

- 顶栏左段：`flex-basis: 264px`，`box-sizing: border-box`，**无边框** → 右边界 `x = 264`；
- 左栏：`flex-basis: 264px`，`box-sizing: border-box`，`border-right: 1px` 含在 264 内 → 右边界 `x = 264`；
- 两者右边界重合，1px 边框落在 264 之内，**不产生 1px 偏差**；
- 竖线来自 `#flux-left-rail` 的 `border-r`，该元素在 `.flux-body-container` 内（y > 43），故竖线天然只在顶栏下沿以下出现。

### 3.3 `.titlebar-right` 不需要 `flex: 1 1 auto`（驳回审查建议）

`.flux-titlebar` 已是 `justify-content: space-between`（`styles.css:610`），在流子元素只有 `titlebar-left`（固定宽）与 `titlebar-right`（`flex-shrink: 0`）两个，`.titlebar-center` 是 `position: absolute` 不参与 flex。`space-between` 会把两者分别推到首尾，**右块天然贴右**。

改 `flex: 1 1 auto` 会把 `flex-shrink` 从 `0` 变为 `1`，960px 最小窗宽时右段按钮可被压缩——这是回归风险。

### 3.4 标题（`.titlebar-center`）保持现状

**用户未对标题归属表态**。审查两轮分别提议「居中于右块」，但均无用户依据。本版保持现状：绝对居中于整窗（`styles.css:621`），列入 §十二 待确认项。

若改为居中于右块，实测偏移（1440 视口，右栏 420）：

| 状态 | 对话区中心 | 相对窗口中心偏移 |
|---|---|---|
| 展开（左栏 264） | 642 | **78px** |
| 折叠（左栏 59） | 539.5 | **180.5px** |
| 展开↔折叠 标题移动量 | — | **102.5px** |

---

## 四、平台标识（已核实）

**事实**：全仓 `data-platform` / `dataset.platform` 在 `packages/desktop/src` 与 `packages/ui/src` **零匹配**；`styles.css` 无任何 macOS 专属选择器。

```ts
// renderCoordinator.ts 骨架装配处（与现有 dataset 写入同处）
document.documentElement.dataset.platform = state.platform; // 'macos' | 'windows' | 'linux' | ...
```

> **约束**：只允许在 render 路径写一次；写入前比对旧值，相同则不写，避免高频 render 反复触发属性写与样式重算。

---

## 五、移动端覆盖（已核实）

**事实**：`@media (max-width:768px)` 块内**无** `.titlebar-left` 规则；移动端左栏是 `position:fixed` 不占布局宽（`styles.css:975-986`）；`leftRailCollapsedDefault` 全仓零传值点（默认 `false`）→ 390px 视口下 `264 + 右段约160 = 424 > 390`，右侧按钮溢出不可点。

```css
@media (max-width: 768px) {
  /* 移动端左栏是 fixed 浮层、不占布局宽度；顶栏左段不得继承桌面 264px 锁定。 */
  .titlebar-left { flex: 0 0 auto !important; }
}
```

并在 `packages/mobile/scripts/prepare-assets.mjs` 的注入 CSS 中加同义规则，防加载顺序变化。

---

## 六、DOM 骨架改动：检查舱全屏不得覆盖左栏

**事实**：`InspectionPod.ts:87-88` 注释原文「Covers middle stream and left rail completely」，`position:absolute; left:0; z-index:50` 的容器是 `.flux-body-container`，左栏也在其中（`renderCoordinator.ts:731-732`）。与用户裁决冲突。

```text
#flux-app-root                     flex-direction: column
├─ #react-titlebar-host            .flux-titlebar（通栏）
└─ .flux-body-container            flex: 1 row
   ├─ #react-leftrail-host         display: contents → #flux-left-rail
   └─ .flux-main-block             ← 【新增】flex:1; min-width:0; display:flex; position:relative
      ├─ .flux-middle-pod          flex: 1
      └─ #flux-inspector-pod       flex: 0 0 var(--rail-w-right, 420px)
```

连带：
1. `InspectionPod.ts:87-88` 注释必须改写；
2. `renderCoordinator.ts:823-870` 的 `outerHTML` 替换按 `#flux-inspector-pod` id 查询，加父层后仍命中（已确认）；
3. `layout.test.mjs:50-78` **无需修改**（断言对象是样式字符串），但需**新增**：全屏时 `#flux-inspector-pod` 的 `offsetParent === .flux-main-block`；
4. 顺手删 `renderCoordinator.ts:731` 的内联样式（与 `styles.css:696-702` 双真值）。

---

## 七、状态同步：单通道

```ts
// TitlebarProps 新增
leftRailCollapsed: boolean;

// titlebarController.getTitlebarSnapshot()
leftRailCollapsed: state.leftRailCollapsed,

// Titlebar.tsx
<header className="flux-titlebar" data-left-rail-collapsed={String(leftRailCollapsed)}>
```

用 `String(...)` 显式序列化，避免依赖 React 对 boolean `false` 的属性省略行为。

---

## 八、B-i 落地清单（前置 B 选 B-i 时执行）

**已核实**：`window.ts:26-28` 设 `frame:false` + `hiddenInset` + `trafficLightPosition`，系统交通灯可见；`window.ts` 全文无 `setWindowButtonVisibility(false)`；`Titlebar.tsx:37-41` 又自绘一组（DOM 起点 x=20、间距 7）→ 屏幕上 6 个圆点错位重叠。

| # | 动作 | 文件:行 |
|---|---|---|
| 1 | 删除 React 版自绘交通灯 | `Titlebar.tsx:37-41` |
| 2 | 删除字符串版 `macControls` 常量 + 引用 | `Titlebar.ts:36-42`、`:91` |
| 3 | 删除自绘样式（含 `gate-theme-allow` 豁免注释） | `styles.css:638-643` |
| 4 | 改 macOS 断言为「不含」 | `mobile-responsive.test.mjs:131` |
| 5 | 清理 `titlebar.windowControls` i18n（删 DOM 后无消费者） | `chrome.ts:22,125`；需先确认是否有 unused-key 门禁 |
| 6 | 移动端注入 CSS 的 `.mac-traffic-lights` 隐藏规则可留（无害） | `prepare-assets.mjs:77` |
| 7 | 登记 pitfall（建议 P-029：双重交通灯） | `pitfall-registry.md` |

### 8.1 字符串版 Titlebar（P2）

`Titlebar.ts:90` 内联 `flex: 1` **不影响生产**（生产走 `renderCoordinator.ts:507` 的 React 岛）。真实风险是 **e2e-acceptance-harness 与生产几何漂移**。处理：只删 `flex: 1;` 一段（保留 `display / align-items / gap / min-width`）。

---

## 九、测试用例

### 9.1 静态守卫

| # | 断言 | 保护对象 |
|---|---|---|
| T1 | 抽出 `.titlebar-left {…}` 规则块，块内断言 `flex:\s*0 0 var\(--rail-w-left, (\d+)px\)` | 展开态同源 |
| T2 | 存在 `.flux-titlebar[data-left-rail-collapsed="true"] .titlebar-left` 且引用折叠 Token | 折叠态固定值 |
| T3 | `:root` 的 `--geo-titlebar-left-collapsed` 只定义一次 | 单真值 |
| T4 | 合并进现有 `titlebar-geometry.test.mjs:98-114` | 展开态 fallback 与 `LEFT_RAIL_WIDTH` 一致 |
| T5 | 扫描 `Titlebar.ts`，断言无 `titlebar-left" style="[^"]*flex:\s*1` | harness 一致性（非生产） |
| T6 | **UI 渲染测试**：分别渲染 `leftRailCollapsed: true/false`，断言 `data-left-rail-collapsed` 值与 ☰ 存在性 | props 驱动 |
| T7 | macOS 渲染结果**不含** `.mac-traffic-lights` | B-i 落地 |
| T8 | 每个 `[data-theme]` 块内 `--sidebar` 与 `--bg-rail` 值相等 | 多皮肤通栏不断裂 |
| T9 | `@media (max-width:768px)` 块内存在 `.titlebar-left { flex: 0 0 auto }` | 移动端溢出 |
| T10 | 存在 `html[data-platform="macos"] .titlebar-left` 且 `padding-left` ≥ 66 | 交通灯不被覆盖 |
| T11 | `rail-geometry.mjs` 的「折叠态总宽引用 `--geo-micro-rail` + 补偿 1px」保持绿 | 防误改左栏几何 |

### 9.2 真实渲染验证（新增 `scripts/verify/titlebar-align.mjs`）

| # | 断言 |
|---|---|
| 1 | 展开态 `titlebar-left.width === leftRail.width`，**960 / 1280 / 1440 三档各测** |
| 2 | 折叠态 ☰ 完全可见可点；**等 `transitionend` 或宽度稳定满 2 帧** |
| 3 | 拖到 480：两宽度同步；`.titlebar-right` 右边界 ≤ 视口宽，`.win-caption-controls` 未被挤压 |
| 4 | **390×844 折叠态**：`#toggle-left-rail-btn` 可见可点，点击后左栏 `display ≠ none`；`#toggle-inspector-btn`.right ≤ 390 |
| 5 | **全屏时**：`#flux-inspector-pod` 的 `offsetParent === .flux-main-block`；`elementFromPoint` 仍命中 `#flux-left-rail` |
| 6 | **折叠过渡期逐帧采样**：记录 10 帧的 `titlebar-left.width` 与 `leftRail.width`，确认无跳变（验证 §3.1 的过渡可插值性） |
| 7 | 截图存 `artifacts/verification/` |

---

## 十、风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| macOS 系统交通灯实占未知 | `padding-left: 74px` 可能不准 | 需 macOS 实机 `getWindowButtonPosition()` 量取后回填 |
| `flex-basis` 过渡可插值性未实测 | 若不可插值，折叠会有瞬跳 | §9.2 #6 逐帧采样验证 |
| 折叠态不对齐 | 用户若后续要求折叠态严丝合缝，需改回固定宽 | 已明确为需求外 |
| `.flux-main-block` 新增层 | 影响 `querySelector` | 已确认按 id 查询不受影响 |
| 移动端横屏 safe-area | 左段偏出约 47px | `.flux-titlebar` 有 `padding-left: env(safe-area-inset-left)`（`styles.css:606`），`.flux-body-container` 无；实现时补 `calc(... - env(safe-area-inset-left, 0px))` |
| e2e harness 几何漂移 | CDP 断言失真 | T5 |

---

## 十一、实施顺序

1. 新增 `.flux-main-block` + 检查舱全屏作用域；
2. 新增 `data-platform` 写入（带同值跳过）；
3. 改 `.titlebar-left` 展开态宽度 + 过渡 + 拖拽期关过渡；
4. 折叠态固定值 Token + macOS `padding-left` 让位；
5. 移动端媒体查询覆盖；
6. `TitlebarSnapshot` / `TitlebarProps` 新增 `leftRailCollapsed`；
7. B-i 交通灯清理（§八清单）——**仅在前置 B 选 B-i 时**；
8. 扩展测试 T1~T11 + 验证脚本；
9. `npm run gates:changed` + `typecheck` + `test`。

---

## 十二、用户裁决（2026-11-20，已定稿）

| # | 问题 | 裁决 | 落地含义 |
|---|---|---|---|
| **1** | 展开态 ☰ 位置 | **(a) 保持靠左** | `padding-left: 8px` 不变。因 `.titlebar-left` 无背景无边框，展开态无可见差异，验收依赖测试断言 |
| **2** | macOS 交通灯 | **(B-i) 保留系统、删自绘** | 执行 §八 落地清单 7 项 |
| **3** | 标题归属 | **(b) 居中于对话区** | `.titlebar-center` 由「绝对居中于整窗」改为「居中于对话区」 |

### 12.1 裁决 3 的坐标纠正（重要）

用户表述为「居中于右块（展开态左移 78px）」。经复算，**78px 对应的是对话区中心，不是顶栏右块中心**，两者不同：

| 基准 | 区间（1440 视口） | 中心 x | 相对窗口中心 |
|---|---|---|---|
| 窗口 | 0 → 1440 | 720 | — |
| **顶栏右块** | 264 → 1440 | **852** | **右移 132px** |
| **对话区**（排除检查舱 420） | 264 → 1020 | **642** | **左移 78px** |

用户写的 78px 与「对话区中心」严格吻合，故**按对话区实现**。这样标题正好落在对话内容上方居中，而非偏到检查舱上方。

### 12.2 实现方式

`.titlebar-center` 现为 `position: absolute; left: 50%; transform: translate(-50%, -50%)`（相对 `.flux-titlebar`，`styles.css:621`）。

对话区区间 = `[左栏宽, 100% − 检查舱宽]`，其中心：

```
left = (左栏宽 + 100% − 检查舱宽) / 2
```

```css
.titlebar-center {
  /* 居中基准 = 对话区中心，而非窗口中心。
     设计意图(Why)：标题应与对话内容对齐，而非被右侧检查舱拉偏。
     约束与规则(Rules)：左栏宽度必须引用 --rail-w-left（展开）/ 微轨（折叠），
       禁止写字面量；检查舱宽度引用 --rail-w-right。 */
  left: calc((var(--rail-w-left, 264px) + 100% - var(--rail-w-right, 420px)) / 2);
  transform: translate(-50%, -50%);
}

/* 折叠态：左栏宽为微轨 + 1px 边框 */
.flux-titlebar[data-left-rail-collapsed="true"] .titlebar-center {
  left: calc((calc(var(--geo-micro-rail, clamp(58px, 4.2vw, 72px)) + 1px) + 100% - var(--rail-w-right, 420px)) / 2);
}
```

**验算**（1440 视口，检查舱 420）：

| 状态 | 代入 | 结果 | 对照窗口中心 720 |
|---|---|---|---|
| 展开（左栏 264） | `(264 + 1440 − 420) / 2` | **642** | 左移 **78px** ✓ |
| 折叠（左栏 59） | `(59 + 1440 − 420) / 2` | **539.5** | 左移 **180.5px** |

与用户裁决的 78px 严格吻合。

> **已知局限（必须在实现时验证）**：检查舱折叠到 0 时，`--rail-w-right` 变量仍为 420（CSS 变量不随 `flex-basis: 0` 改变），此时公式会把标题算偏 210px。检查舱折叠是次要场景，但实现时必须用真实渲染断言覆盖该状态；若偏移不可接受，需改为运行时同步检查舱实际宽度，或接受该降级并记录。
