# 会话流「回到底部」控件 · 设计方案（v2，审查吸收版）

> 日期：2026-11-19
> 状态：设计已修订，待编码前实验
> 原型：[`preview/scroll-to-bottom-prototype.html`](../../../preview/scroll-to-bottom-prototype.html)
> 外部审查：第一轮 PASS WITH CHANGES（2 P0 / 6 P1 / 3 P2）；第二轮复核 PASS WITH CHANGES（1 P0 / 4 P1 / 3 P2），两轮均已吸收。

---

## 一、需求与最终裁决

| 项 | 裁决 |
|---|---|
| Dock 排列 | **箭头 32px → 8px → 头像 28px → 8px → 文案胶囊**，整组靠输入舱左边框 |
| Stage 排列 | **箭头 + 「回到底部」文案** 胶囊，靠输入舱左端；顶部 56px 图腾保持只读悬浮 |
| 隐藏占位 | **不保留**：按钮宽度/边距/内距/描边收缩归零，头像与文案回到左边框 |
| 点击回底 | 一次性平滑滚动；`scroll-behavior` 不写进容器 CSS |
| 显隐真值 | 复用既有 `distanceToBottom <= 48`，不新增阈值 |
| 文案 | `conversation.scrollToEnd`：中文「回到底部」/ 英文「Scroll to end」 |

**明确不做**：不把箭头放进 `AgentPresence`；不加未读角标；不加光晕/无限脉冲；不在 `index.ts` 新增多行逻辑（该文件仅剩 1 行余量）。

---

## 二、现状取证（已按本轮源码复核修正）

| 事实 | 证据 |
|---|---|
| `AgentPresence` 只读、`pointer-events: none`、零回调 | `AgentPresence.tsx:21-28`；`conversation.css:3759` |
| dock 宽度 740、与输入舱同宽同位 | `conversation.css:3761-3777` |
| dock 宿主绝对定位在输入舱上沿 8px | `conversation.css:3847-3856` |
| 滚动唯一入口是 `#conversation-stream.onscroll` | `conversationStreamController.ts:390` |
| 贴底判定 `distanceToBottom <= 48` 已存在 | `conversationStreamController.ts:443-444` |
| 回底路径 `scrollStreamToBottom` 存在 | `streamViewportManager.ts:328-349` |
| 宿主装配收敛在 `ensureAgentPresenceHost` | `index.ts:1136-1176` |
| **虚拟窗口已废弃**：`messageWindowStart = 0`、`messageWindowEnd = total`、`computeVirtualHeightPx() = 0` | `messageWindowManager.ts:153-156, 354-360` |
| DOM 中不会渲染 `.conv-virtual-window` | `ConversationMessageList.tsx:60,82,160-170` |
| 长会话性能依赖 `content-visibility: auto` + 估算占位 | `conversation.css:181-182` |
| `markProgrammaticScroll` 记录**起点**，忽略窗 180ms / 80ms | `index.ts:621-624`；`messageWindowManager.ts:122-125` |
| 输入舱单一出口 `applyInputDockUpdate()` 在 renderCoordinator | `renderCoordinator.ts:919-940`；`inputDockController.updateDock` 无调用方 |
| `index.ts` 已 1499 行，门禁上限 1500 | `scripts/gates/rules/maintainability.mjs:37` |

> **结论**：方案 v1 中“虚拟窗口搬迁 + `windowRect.bottom`”的假设失效，已从本版删除。当前真实风险是 `content-visibility: auto` 的占位高度替换。

---

## 三、UI 规格

### 3.1 Dock

```text
┌──────────────────── 740px 输入舱宽 ────────────────────┐
│  (↓)   (头像)   [ 正在读取  conversation.css ]          │  ← 上沿 +8px，行高 32px
├────────────────────────────────────────────────────────┤
│                       输入舱                            │
└────────────────────────────────────────────────────────┘
```

| 项 | 值 |
|---|---|
| 排列 | `display: flex; align-items: center; justify-content: flex-start;` |
| 间距 | 箭头↔头像 `8px`；头像↔文案 `8px` |
| 箭头 | 32×32，`--radius-pill`，`--card` 底 + `1px --border` + `--specular-line` |
| 图标 | `ArrowDown` 14×14，`stroke-width: 2`，`--secondary-foreground`；hover `--foreground` |
| 头像 | 沿用 `.conv-presence` dock 28px，不新建头像实现 |
| 文案 | 沿用 `.conv-presence__text` 胶囊，`11px / 16px` |
| 锚点 | 左沿与输入舱左边框严格对齐 |

隐藏态：按钮绝对定位，`opacity: 0` + `visibility: hidden`，不占流也不保留占位；dock 头像的 `margin-left` 从 `40px` 归零，头像与文案回到输入舱左边框。

### 3.2 Stage

```text
(↓) 回到底部
├──────────────────────────┤
│          输入舱           │
└──────────────────────────┘
```

| 项 | 值 |
|---|---|
| 位置 | 输入舱上沿左端，`bottom: calc(100% + 8px)` |
| 形态 | 胶囊：箭头 14px + `gap: 8px` + 文案 11px；高 32px；`padding: 0 12px 0 8px` |
| 右端 | 空置 |
| 顶部图腾 | 保持 56px 居中悬浮，零交互、零移动 |
| 隐藏态 | 同 dock，宽度收缩归零，不保留占位 |

### 3.3 Token

| 属性 | 值 |
|---|---|
| 底色 / hover / active | `--card` / `--card-hover` / `--card-active` |
| 描边 | `1px solid --border` |
| 内受光 | `box-shadow: var(--specular-line)` |
| 圆角 | `var(--radius-pill, 9999px)` |
| 图标色 | `--secondary-foreground`，hover `--foreground` |
| 焦点环 | `box-shadow: 0 0 0 1px color-mix(in oklab, var(--foreground) 60%, transparent)` |

> 焦点环不改成 `--ring`：`conversation.css:2550-2553` 的 prompt rail 已明确记录“`--ring` 在浅色皮肤对比不足”，本控件沿用同一先例，并在样式审查时说明理由。

---

## 四、动效规格

| 阶段 | 时长 | 缓动 | 属性 |
|---|---|---|---|
| 进场 | 120ms | `cubic-bezier(0.16, 1, 0.3, 1)` | `grid-template-columns 0fr→1fr`（或宽度变量）、`margin-right 0→8px`、`padding`、`border-width`、`opacity 0→1` |
| 退场 | 200ms | `cubic-bezier(0.4, 0, 1, 1)` | 反向归零；`visibility` 延迟 200ms |
| hover | 80ms | `ease-out` | 图标 `translateY(1px)`；底色/描边/文字色 |
| 按压 | 80ms | `ease-out` | `transform: scale(0.96)` |
| 形态切换 | 160ms | `cubic-bezier(0.16, 1, 0.3, 1)` | 文案展开/收起 |

收缩与让位实现（`data-at-bottom` 与 `data-presence-layout` 统一写在 `.dock-actionbar` 上）：

```css
.dock-actionbar { position: relative; }

/* 按钮绝对定位：不占流，隐藏即不保留占位 */
.scroll-end {
  position: absolute;
  left: 0;
  top: 0;
  transition: opacity 120ms var(--ease-spring);
}
.dock-actionbar[data-at-bottom="true"] .scroll-end {
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 200ms cubic-bezier(0.4, 0, 1, 1),
    visibility 0s linear 200ms;
}

/* dock 下头像让位：40px = 箭头 32 + 间距 8；隐藏时归零，头像平滑贴边 */
.dock-actionbar .dock-presence {
  margin-left: 40px;
  transition: margin-left 120ms var(--ease-spring);
}
.dock-actionbar[data-at-bottom="true"] .dock-presence {
  margin-left: 0;
  transition: margin-left 200ms cubic-bezier(0.4, 0, 1, 1);
}
```

**为什么不用 `grid 0fr/1fr`**：`.scroll-end__slot` 作为 flex 子项宽度是 `auto`（indefinite），fr 轨道在 indefinite 容器中按 `max-content` 计算，`0fr` 不会收缩；实测原型中 `data-at-bottom="true"` 后按钮仍然可见。绝对定位 + `margin-left` 让位是数值过渡，无死区、无 min-content 争用。

四个已确认的坑，禁止再犯：

1. `--ease-out` 在全仓不存在，只有 `--ease-spring`；幽灵变量会让整条 `transition` 失效（`theme/ghost-token` 门禁）；
2. 让位值 `40px` 必须由「箭头 32 + 间距 8」推导，禁止写孤立魔法数；
3. 退场必须单独声明 `200ms cubic-bezier(0.4, 0, 1, 1)`，否则会按进场 120ms 收口，与 `opacity` 错拍；
4. `data-at-bottom` 必须挂在 `.dock-actionbar`，不能写到按钮宿主的 `#react-scroll-end-host`，否则父级选择器匹配不到。

约束：

1. 进退场分别声明 transition；
2. 禁止弹性过冲；
3. 滚动容器禁止 `transform`；
4. `prefers-reduced-motion: reduce`：只保留透明度，宽度过渡 `1ms`，关闭 hover/active 位移与缩放；
5. 移动端隐藏态必须显式 `min-width: 0; min-height: 0;`（见 §8.4）。

---

## 五、状态判定与同步

```text
distanceToBottom = scrollHeight - scrollTop - clientHeight
isNearBottomNow  = distanceToBottom <= 48
buttonVisible    = !isNearBottomNow
```

### 5.1 幂等同步函数

新增 `syncScrollToEndVisibility(force?: 'hidden'): void`：

- 只做三件事：读距离、计算可见性、在值变化时写 `dataset`；
- 不进入 React 状态，不触发列表重渲染；
- 用 `lastVisible` 布尔缓存过滤无变化写入；
- `ScrollToEndButton` **不接收 `visible` prop**：可见性、`aria-hidden`、`tabindex` 全部由本函数统一写入 DOM，避免语言切换触发 React `update()` 时用旧 prop 覆盖命令式状态；
- `.dock-actionbar` 被 `outerHTML` 重建前，先把当前 `lastVisible` 与 `state.presenceLayout` 写进新节点 `dataset` 再插入；重建后以 `actionbarEl?.isConnected` 校验，不能只信 `lastVisible` 缓存。

### 5.2 必须覆盖的同步路径

| 路径 | 处理 |
|---|---|
| `onscroll` | 正常同步；这是主路径 |
| `enterPending` / `isInitialBottomSettling()` | 强制隐藏（现有 `onscroll` 在此提前 return，必须补） |
| 切会话 `beginSessionEnter` / `onSessionSwitched` | 强制隐藏，抑制进场动画 |
| `finishPinPlan()` / `settleInitialBottom()` 结束 | 主动同步（这两处不派发 `scroll` 事件） |
| `applyInputDockUpdate` 后 | 由 `syncAgentPresenceHost()` 内部统一重校 |
| `syncStreamBottomInset()` 后 | 主动同步（`--conv-gutter-bottom` 变化影响可用高度） |
| 输入舱高度、检查舱开合、`<details>` 开合、window resize | `#conversation-stream` 捕获阶段 `toggle` 监听（`{ capture: true, passive: true }`）+ inspector `onEntered` / `onExited` + `window` `resize`；禁止新增全局 ResizeObserver 常驻 |

> 现有 `onscroll` 主体是同步执行，只有 `schedulePromptNavigatorSync` 走 rAF；不要假设“既有 rAF 节流”可直接复用。新同步函数自身做 `lastVisible` 去重即可，不额外引入逐帧开销。

---

## 六、点击回底

### 6.1 真实风险

`content-visibility: auto` 的回合在视口外以估算高度占位。平滑滚动途经它们时，占位高度被替换为真实高度，`scrollHeight` 持续漂移；原生 `scrollTo({ behavior: 'smooth' })` 不追踪新的底边，可能停在半路，按钮不退场。

### 6.2 平滑会话状态机

```text
idle
  └─ click → running（记录 startedAt，目标 = 当前 scrollHeight）
running
  ├─ 每帧：distanceToBottom <= 48 → 隐藏按钮（不清 smoothScrollActive）
  ├─ 每帧：scrollHeight 增长且距底 > 48 → 续滚到最新 scrollHeight
  ├─ scrollend / distanceToBottom <= 2 / 1200ms 超时 → 收敛检查：到不了则即时补齐 → done
  ├─ 用户 wheel/touchmove/pointerdown/翻页键 → cancel
  └─ beginSessionEnter 入口 / 组件卸载 → cancel（切会话不对旧流写 instant）
```

- **按钮可见性 ≠ 平滑会话生命周期**：`<= 48` 只负责隐藏按钮，`smoothScrollActive` 必须保持到 `scrollend` / `<= 2px` / 超时，否则原生减速末段会被 `onscroll` 误判为用户手势，触发 `cancelSessionEnter`；

- `cancel` 必须显式打断原生平滑：`stream.scrollTo({ top: stream.scrollTop, behavior: 'instant' })`；
- `smoothScrollActive` 必须并入 `onscroll` 的 `isProgrammatic` 判定，否则第 2 帧起会被误判为用户手势；
- **不得**依赖 `markProgrammaticScroll`：它记录的是调用瞬间的起点，忽略窗只有 80~180ms，与 300~800ms 的平滑滚动不兼容；
- `scrollend` 不支持时用 rAF 轮询 + 超时兜底。

### 6.3 回退方案

若真实长会话实测仍出现中途停滞或明显跳变，降级为 `scrollStreamToBottom('scroll-to-end control')` 即时定位；按钮仍走 200ms 退场。视觉规格不变。

---

## 七、i18n

| key | zh-CN | en-US |
|---|---|---|
| `conversation.scrollToEnd` | 回到底部 | Scroll to end |
| `conversation.scrollToEndAria` | 滚动到会话末尾 | Scroll to end of conversation |

落点：`packages/ui/src/i18n/messages/conversation.ts` 两套字典。组件内禁止中文字面量。

---

## 八、技术方案与落点

### 8.1 DOM 契约

```html
<div class="input-dock-container">
  <div class="dock-actionbar">                 <!-- 新增，绝对定位 bottom: 100% + 8px，z-index: 1 -->
    <div class="dock-actionbar__inner">        <!-- 740px 容器，flex 行 -->
      <div id="react-scroll-end-host"></div>   <!-- 箭头 React root，按钮绝对定位不占流 -->
      <div id="react-conv-presence-host"></div><!-- presence root，仅 dock 形态放入 -->
    </div>
  </div>
  ...输入舱...
</div>
```

硬约束：

- `#react-conv-presence-host` 在 actionbar 内必须 `flex: 1 1 auto; min-width: 0;`，否则长工具目标无法触发 `.conv-presence__target` 的省略号并溢出右缘；
- `stage` 形态下 `#react-conv-presence-host` 不放入 actionbar（留在 `.flux-middle-pod`），actionbar 只渲染箭头；
- `.dock-actionbar` 不复制 `.input-dock-container` 的 `padding: 0 24px`，内层自行收边；
- `.input-dock-container > .dock-actionbar` 必须显式 `pointer-events: none`（用带父级的选择器压过 `.input-dock-container > *` 的 `pointer-events: auto`），仅可见态按钮恢复 `auto`；
- `z-index: 1`：队列/附件轨展开时 actionbar 随输入舱上移、不被遮挡；popper / 审批下拉（`z-index: 100/210`）按设计盖在 actionbar 之上，不得反过来遮挡弹出层。

### 8.2 形态与语言同步

真实 DOM 中 `.conv-presence` 的 `data-layout` 只在 stage/dock 各自位置存在，不能作为 actionbar 的祖先状态。按钮形态由 actionbar 自身的 `data-presence-layout` 驱动：

- `syncAgentPresenceHost()` 在定位 presence 的同时写 `dock-actionbar.dataset.presenceLayout = state.presenceLayout`；
- `onPresenceLayoutChanged`、`syncLocale`、`applyInputDockUpdate` 之后各重推一次；
- 按钮的 `labeled` 形态只认 `data-presence-layout="stage"`，不依赖 `.conv-presence` 祖先。

### 8.3 改动清单（修正版）

| 文件 | 改动 |
|---|---|
| `packages/ui/src/components-react/conversation/ScrollToEndButton.tsx` | 新增纯表现原语：`layout: 'icon' \| 'labeled'`、`onClick`、`label`、`ariaLabel`；**不接收 `visible`** |
| `packages/ui/src/styles/conversation.css` | 新增 `dock-actionbar`、按钮绝对定位与 `margin-left` 让位、进退场过渡；改写 dock 宿主定位 |
| **新增** `packages/desktop/src/renderer/scrollEndController.ts` | 宿主装配、`syncScrollToEndVisibility`、平滑会话状态机、用户输入打断 |
| `packages/desktop/src/renderer/renderCoordinator.ts` | 在 `applyInputDockUpdate()` 之后**不改既有相邻三行**，把 actionbar 重校并入 `syncAgentPresenceHost()` 的依赖实现 |
| `packages/desktop/src/renderer/index.ts` | 1499/1500 行：先从 `index.ts:1326-1413` 抽出左右轨拖拽（约 87 行，无 wiring 源码锁），再接入控制器；**禁止外移 `ensureAgentPresenceHost` / `syncAgentPresenceHost`**（#10/#14 锁死） |
| `packages/desktop/src/renderer/events/conversationStreamController.ts` | `onscroll` 内调用 `syncScrollToEndVisibility()`；`isProgrammatic` 并入 `smoothScrollActive` |
| `packages/desktop/src/renderer/viewport/streamViewportManager.ts` | 新增 `scrollStreamToEndSmooth()` 与收敛/回退；`finishPinPlan`/`settleInitialBottom` 结束回调 |
| `packages/ui/src/i18n/messages/conversation.ts` | 新增两个 key |

### 8.4 移动端与窄窗

`packages/mobile/scripts/prepare-assets.mjs:104-110` 对 `@media (max-width: 768px)` 下所有 `button` 注入 `min-width: 44px; min-height: 44px`。CSS 中 `min-width` 优先于 `max-width`，会让“隐藏态宽度 0”失效，把 dock 头像推走。

处置：

- 隐藏态显式 `min-width: 0; min-height: 0;`，并在同一 `@media` 中再次覆盖；
- **可见态视觉盒必须保持 32px**：dock 为 `min-width: 32px; min-height: 32px`，stage 为 `height: 32px`；移动端 44px 热区用 `::after { content: ''; position: absolute; inset: -6px; }` 扩出，禁止把视觉盒撑到 44px；
- 隐藏态同时 `pointer-events: none`，避免留下 44px 透明热区；
- `.dock-actionbar__inner` 的宽度基准与 `.composer-dock` 一致；窄屏下 `.input-dock-container` 已被 `styles.css:1025-1034` 强制改写，actionbar 不得再叠加 `calc(100% - 48px)` 的二次收边；
- 移动端验证：`390×844` 下隐藏态按钮 `getBoundingClientRect().width === 0`，头像与输入舱左边框 `alignDelta === 0`。

### 8.5 必须同步更新的守卫

| 守卫 | 断言 |
|---|---|
| `packages/ui/__tests__/agent-presence.test.mjs` #21 | `#react-conv-presence-host.presence-host--dock` 必须含 `bottom: calc(100% + 8px)` 与 `pointer-events: none` |
| `packages/ui/__tests__/agent-presence.test.mjs` #22 | `dock.insertBefore(host, dock.firstElementChild)` |
| `packages/desktop/__tests__/unit/agent-presence-wiring.test.mjs` #10 | dock host 插到 `.input-dock-container` 首位 |
| `packages/desktop/__tests__/unit/agent-presence-wiring.test.mjs` #11 | `applyInputDockUpdate();` 后必须紧跟 `syncAgentPresenceHost(); syncAgentPresence();` |
| `packages/desktop/__tests__/unit/agent-presence-wiring.test.mjs` #14 | 硬读 `RENDERER` 源码校验 `ensureAgentPresenceHost` / `syncAgentPresenceHost`，禁止外移 |
| `scripts/verify/agent-presence-screens.cjs` | 实景探针中的 `presence-host--dock` 选择器 |

结构改造后这些断言要么保留兼容的兼容层，要么成对更新；不得静默失效。

---

## 九、风险与回退

| 风险 | 影响 | 处置 |
|---|---|---|
| `content-visibility` 高度漂移导致平滑滚动停半路 | 按钮不退场 | `scrollend` + 每帧收敛 + 超时续滚；失败回退即时定位 |
| `smooth` 与用户手势判定冲突 | 视口被错误取消/拽回 | 显式 `smoothScrollActive` + 输入事件即时打断 |
| dock 宿主结构改造击穿既有守卫 | 测试红 | 逐条更新 §8.5 列出的 5 处守卫 |
| 移动端 44px 最小热区覆盖隐藏态 | 头像被推走 | 隐藏态 `min-width: 0` + 窄屏媒体查询覆盖 |
| `index.ts` 行数门禁 | 直接阻断 | 业务逻辑全部落在新 `scrollEndController.ts` |
| 高频滚动写 DOM | 与流式写正文竞争 | `lastVisible` 去重；只在值变化时写 dataset |
| 输入舱弹出层遮挡 actionbar | 交互被盖住 | actionbar `z-index: 1`；三种展开态实测 |

---

## 十、测试计划

### 10.1 单元

- `distanceToBottom = 48 / 49` 边界：隐藏 / 显示；
- 程序化滚动与用户手势不混淆；
- `smoothScrollActive` 期间不触发 `cancelSessionEnter`；
- 用户 `wheel` / `touchmove` / `pointerdown` 立即打断并清理平滑会话；
- 首屏落定期强制隐藏；切会话强制隐藏且不播进场；
- `finishPinPlan` / `settleInitialBottom` 结束后主动同步；
- 隐藏态 `tabindex = -1`、`aria-hidden = true`、若聚焦则 `blur()`；
- dock DOM 顺序：箭头 → 头像 → 文案；
- 隐藏态 CSS：`grid-template-columns: 0fr`、`margin-right: 0`、`padding: 0`、`border-width: 0`、`min-width: 0`；
- stage/dock 切换：按钮形态跟随 `data-presence-layout`，不依赖 `.conv-presence` 祖先；
- 中英文切换：文案与 `aria-label` 同步。

### 10.2 CDP / 真实渲染

- 向上滚动 → 进场；回到 48px 内 → 退场；
- 点击 → 到达末尾、按钮消失；
- 长会话 `> 120` 条、`content-visibility: auto` 生效：从顶平滑到底，记录最终 `distanceToBottom`、长任务、是否中途停滞；
- 队列 / 附件轨展开态：actionbar 随输入舱上移，不被遮挡；
- popper / 审批下拉展开态：弹出层正确盖在 actionbar 之上，actionbar 不反遮挡；
- `<details>` 展开 / 收起、检查舱开合、窗口 resize：按钮显隐立即同步；
- `390×844` 移动窄屏：隐藏态宽度 0、可见态视觉盒 32px、`alignDelta = 0`；
- stage/dock 切换与语言切换。

### 10.3 门禁

`npm run gates:changed`、`npm run typecheck`、`npm test`、`npm run verify:formal`、`npm run verify` 全绿。

---

## 十一、编码前必须完成的实验

| 实验 | 判定标准 | 失败处置 |
|---|---|---|
| 长会话平滑回底（`> 120` 条，`content-visibility` 生效） | 最终 `distanceToBottom <= 48`，无 > 50ms 长任务，无可见停顿 | 启用即时定位回退 |
| `smoothScrollActive` 与用户滚轮打断 | 滚轮后 1 帧内停止平滑，视口不再被续滚 | 改用手写 rAF 缓动 |
| 移动端隐藏态宽度 | `getBoundingClientRect().width === 0` | 增加窄屏覆盖规则 |

---

## 十二、审查吸收记录

| 编号 | 审查结论 | 本版处置 |
|---|---|---|
| P0-1 | 虚拟窗口假设失效；真实风险是 `content-visibility` 漂移 | 删除虚拟窗口描述；§6 重写为收敛检测 + 续滚 + 回退 |
| P0-2 | `markProgrammaticScroll` 与 smooth 不兼容 | 新增 `smoothScrollActive` 状态机与显式打断；不依赖旧标记 |
| P1-1 | 输入舱单一出口指错文件 | 改为 `renderCoordinator.applyInputDockUpdate`；不破坏既有相邻三行 |
| P1-2 | 未列全既有守卫 | §8.5 补全 5 处守卫与实景探针 |
| P1-3 | 形态/语言同步链路缺失 | §8.2 用 actionbar `data-presence-layout` 驱动，不依赖 `.conv-presence` 祖先 |
| P1-4 | 移动端 44px 最小热区击穿隐藏态 | §8.4 隐藏态 `min-width/min-height: 0` + 窄屏覆盖 |
| P1-5 | 状态漏同步路径 | §5.2 列出 7 条路径与幂等函数 |
| P1-6 | flex 宽度、收缩死区、4px 网格、动效参数 | §3.1/§4 修正为 8px 网格、grid 0fr/1fr、补 transform 过渡、reduced-motion 关闭位移 |
| P2-1 | actionbar 与弹层层叠未声明 | §8.1 `z-index: 1` + 三种展开态实测 |
| P2-2 | 退场焦点残留 | §10.1 增加 `blur()` 断言 |
| P2-3 | `index.ts` 仅剩 1 行 | §8.3 业务逻辑全部移入新 `scrollEndController.ts` |
| 二轮 P0-1 | `grid 0fr/1fr` 片段 4 处失效 | §4 改为绝对定位 + `margin-left` 让位；实测 `0fr` 在 indefinite flex 子项中按 `max-content` 计算，根本不收缩 |
| 二轮 P1-A | `<=48` 提前结束平滑会话，与原生减速冲突 | §6.2 按钮隐藏与 `smoothScrollActive` 生命周期解耦，保持到 `scrollend` / `<=2px` / 超时 |
| 二轮 P1-B | 切会话取消时机晚于锚点捕获 | §6.2 在 `beginSessionEnter` 入口取消；切会话不向旧流写 `instant` |
| 二轮 P1-C | 语言/布局切换、`outerHTML` 重建失步；`visible` prop 冲突 | §5.1/§8.2 移除 `visible`，重建前写 dataset 并校验 `isConnected`，指纹并入 `syncAgentPresence()` |
| 二轮 P1-D | 移动端 44px 撑破可见态 32px 操作带 | §8.4 可见态视觉盒锁 32px，44px 用 `::after` 热区 |
| 二轮 P2-A | actionbar 指针劫持与 popper 口径矛盾 | §8.1 带父级选择器 `pointer-events: none`；§10.2 区分队列/附件轨与 popper 的层叠预期 |
| 二轮 P2-B | `index.ts` 抽行目标未定；漏 wiring #14 | §8.3 指定先抽 `index.ts:1326-1413`；§8.5 补 #14 |
| 二轮 P2-C | `<details>` / 检查舱无现成观察点 | §5.2 补捕获阶段 `toggle`、inspector `onEntered`/`onExited`、窗口 `resize` |
