# 会话流「回到底部」控件 · 工程实施详细设计（Architecture & Implementation Spec）

> **日期**：2026-11-19  
> **状态**：架构定稿，待编码前实验后直接进入实施  
> **输入基线**：[`design.md`](./design.md)（v2.1 审查吸收版）、[`preview/scroll-to-bottom-prototype.html`](../../../preview/scroll-to-bottom-prototype.html) 及两轮外部审查结论  
> **已锁定产品决策（不得更改）**：
> 1. `dock` 形态：箭头（32px）→ 8px → 头像（28px）→ 8px → 文案胶囊，整组靠输入舱左边框左对齐；
> 2. `stage` 形态：箭头 + 「回到底部」文案胶囊，靠输入舱左端；顶部 56px 图腾保持只读悬浮；
> 3. 隐藏时不保留占位：按钮不占流，头像与文案平滑回到输入舱左边框；
> 4. 点击一次性平滑回底；容器 CSS 严禁声明 `scroll-behavior: smooth`；
> 5. 显隐真值复用既有 `distanceToBottom <= 48`（`STICK_TO_BOTTOM_THRESHOLD_PX`），不新增阈值；
> 6. i18n：`conversation.scrollToEnd`（`回到底部` / `Scroll to end`）、`conversation.scrollToEndAria`（`滚动到会话末尾` / `Scroll to end of conversation`）。

---

## 1. 架构决策

### 1.1 分层边界与模块职责

严格遵守 Monorepo 单向依赖铁律 $\text{packages/desktop} \longrightarrow \text{packages/ui} \longrightarrow \text{packages/core}$：

```text
packages/core/src/viewport/scrollEndMachine.ts
  └─ 纯状态机与判别联合（零 DOM / React / Electron）：
     - VisibilityState / SmoothScrollSessionState 判别联合
     - decideScrollEndVisibility()（distanceToBottom <= 48 与强制隐藏判定）
     - reduceSmoothScrollSession()（点击 / 帧推进 / 高度增长 / 到达 / 超时 / 用户打断 / 切会话 / 断连）
          ▲
          │ import type & pure reducer
packages/ui/src/
  ├─ i18n/messages/conversation.ts                （新增 2 个双语 key）
  ├─ components-react/conversation/
  │   ├─ ScrollToEndButton.tsx                    （纯表现原语：不接收 visible prop）
  │   └─ mount.tsx                                （新增 mountScrollToEndButton）
  └─ styles/conversation.css                      （.dock-actionbar / .scroll-end / dock-presence 样式契约）
          ▲
          │ import component / mount / t / styles
packages/desktop/src/renderer/
  ├─ scrollEndController.ts                       （新增：DOM 宿主装配、显隐同步、rAF 监控、监听绑定）
  ├─ viewport/streamViewportManager.ts            （新增 scrollStreamToEndSmooth + 3 个生命周期回调钩子）
  ├─ events/conversationStreamController.ts       （onscroll 同步显隐 + smoothScrollActive 并入 isProgrammatic）
  ├─ renderCoordinator.ts                         （不改 applyInputDockUpdate 后三行，借 syncAgentPresenceHost 联动）
  ├─ inspector/inspectorController.ts             （补齐 onEntered / onExited 回调通知）
  └─ index.ts                                     （先清理与 appBootstrap 重复的 ~95 行，再单向注入接线）
```

### 1.2 为什么这样切（核心决策依据）

1. **捍卫 `AgentPresence` 只读不变量**：
   `AgentPresence.tsx:25` 与 `conversation.css:3761` 明确约束 `AgentPresence` 为零回调、零交互、`pointer-events: none` 的纯在场表现面；`agent-presence.test.mjs` 的 22 条契约锁死了它的内部 DOM 与视觉语义。把交互按钮独立为 `ScrollToEndButton` 并与 `#react-conv-presence-host` 并列挂在 `.dock-actionbar__inner` 内，既不污染 `AgentPresence`，又共享 740px 锚定基线。
2. **纯逻辑下沉 `core`，满足形式化证明与增量 100% 覆盖门禁**：
   状态转移放在 `packages/core/src/viewport/scrollEndMachine.ts`，可直接用 `fast-check` 在随机事件交错下证明安全不变量（与既有 `INV-VIEW-01..04` 同构）。DOM 副作用全部收口在 `packages/desktop/src/renderer/scrollEndController.ts`，并通过 `packages/desktop/scripts/build.mjs` 注册独立 `.mjs` 构建产物，脱离 `index.ts` 进行确定性单测。
3. **不触发 `index.ts` 1500 行红线与 `wiring #10/#11/#14` 锁**：
   - `index.ts` 当前 1499/1500 行（`maintainability.mjs:37`）。经源码核查，`index.ts:166-172, 1326-1413` 的 `LEFT_RAIL_WIDTH`、`clampLeftRailWidth`、`beginLeftRailResize`、`resetLeftRailWidth`、`bindRailResizeEvents` 已在 `bootstrap/appBootstrap.ts:38-203` 完整存在且已导出，属历史拆分残留的重复定义；先删除重复定义改从 `appBootstrap` 导入，立省 **~95 行**（且无任何 wiring 测试锁死这些函数）。
   - `agent-presence-wiring.test.mjs` #14 硬读取 `index.ts` 中的 `ensureAgentPresenceHost` 与 `syncAgentPresenceHost`，禁止外移；#11 硬校验 `renderCoordinator.ts` 中 `applyInputDockUpdate(); syncAgentPresenceHost(); syncAgentPresence();` 三行紧邻无分支。因此 `scrollEndController` 的宿主同步直接接入 `syncAgentPresenceHost()` 内部与 `ensureAgentPresenceHost()` 的 `dock` 装配之后，零破坏既有锁。

---

## 2. DOM 契约

### 2.1 `dock` 形态最终 DOM

```html
<main class="flux-middle-pod conversation-pod" data-conv-layer="stage">
  <div id="conversation-stream" class="messages-stream-area conv-stream" data-conv-layer="stream">
    ...消息列表...
  </div>
  <!-- stage 回落占位注释：dock 模式下 #react-conv-presence-host 已迁入 .dock-actionbar__inner -->
  <div id="react-prompt-navigator-host"></div>
  <div class="dock-scrim-fade conv-dock-scrim" data-conv-layer="scrim"></div>

  <div class="input-dock-container" data-phase="idle">
    <div class="dock-actionbar" data-at-bottom="false" data-presence-layout="dock">
      <div class="dock-actionbar__inner">
        <div id="react-scroll-end-host">
          <!-- aria-hidden / tabindex 不写进 JSX：由 scrollEndController 命令式维护 -->
          <button
            type="button"
            class="scroll-end"
            aria-label="滚动到会话末尾"
          >
            <span class="scroll-end__icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="4" x2="12" y2="20" />
                <polyline points="5 13 12 20 19 13" />
              </svg>
            </span>
            <span class="scroll-end__label">回到底部</span>
          </button>
        </div>
        <div id="react-conv-presence-host" class="presence-host--dock">
          <!-- AgentPresence (layout="dock", 28px avatar + caption capsule) -->
        </div>
      </div>
    </div>

    <!-- 队列托盘 / dock-notice-stack / 附件轨 / .composer-dock -->
    ...
  </div>
</main>
```

### 2.2 `stage` 形态最终 DOM

```html
<main class="flux-middle-pod conversation-pod" data-conv-layer="stage">
  <div id="conversation-stream" class="messages-stream-area conv-stream" data-conv-layer="stream">
    ...消息列表...
  </div>
  <!-- stage 形态：顶部 56px 大图腾保留在 pod 层，完全只读悬浮 -->
  <div id="react-conv-presence-host">
    <!-- AgentPresence (layout="stage", 56px avatar) -->
  </div>
  <div id="react-prompt-navigator-host"></div>
  <div class="dock-scrim-fade conv-dock-scrim" data-conv-layer="scrim"></div>

  <div class="input-dock-container" data-phase="idle">
    <div class="dock-actionbar" data-at-bottom="false" data-presence-layout="stage">
      <div class="dock-actionbar__inner">
        <div id="react-scroll-end-host">
          <!-- aria-hidden / tabindex 不写进 JSX：由 scrollEndController 命令式维护 -->
          <button
            type="button"
            class="scroll-end"
            aria-label="滚动到会话末尾"
          >
            <span class="scroll-end__icon" aria-hidden="true">...</span>
            <span class="scroll-end__label">回到底部</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 队列托盘 / dock-notice-stack / 附件轨 / .composer-dock -->
    ...
  </div>
</main>
```

### 2.3 节点职责与 `data-*` 属性契约

| 节点 | 职责 | `data-*` / ARIA 属性 | 控制方 |
|---|---|---|---|
| `.dock-actionbar` | 脱离输入舱内部 flex 流的绝对定位操作带（`bottom: calc(100% + 8px)`），随队列/附件轨展开同步上移 | `data-at-bottom="true\|false"`、`data-presence-layout="dock\|stage"`、`data-motion-suppressed="true"`（仅切会话抑制过渡首帧） | `scrollEndController` 直接写 `dataset` |
| `.dock-actionbar__inner` | 与 `.composer-dock` 同宽同位的 740px 左对齐行容器，作为 `.scroll-end` 绝对定位的包含块 | — | `scrollEndController` 创建 |
| `#react-scroll-end-host` | `ScrollToEndButton` 的单一 React 根宿主；`dock` 变体下不占流（按钮绝对定位），仅作为挂载点 | — | `scrollEndController`（创建/卸载） |
| `button.scroll-end` | 纯交互按钮：图标 +（仅 `stage` 展开的）文案；`::after` 在移动端提供 44px 触控热区 | **无 `data-layout`**（形态由 `.dock-actionbar[data-presence-layout]` 单一驱动）；**JSX 不声明** `aria-hidden` / `tabindex`，二者只由 `scrollEndController` 命令式维护 | React 渲染结构；`scrollEndController` 写无障碍态 |
| `#react-conv-presence-host` | `dock` 模式下作为 `.dock-actionbar__inner` 第二个子项（`.presence-host--dock`），靠 `margin-left` 让位；`stage` 模式下回到 `.flux-middle-pod` 流后 | 内部由 `AgentPresence` 写 `data-layout` / `data-presence` 等 | `ensureAgentPresenceHost` 定位，`AgentPresence` 渲染 |

### 2.4 挂载、重建自愈与销毁时机

1. **首次连接 / 全量骨架挂载**：`mountReactShellComponents()` → `syncAgentPresenceHost()` → `ensureAgentPresenceHost(state.presenceLayout)` 只负责 presence host 的定位与返回；紧随其后的 `scrollEndController.syncHost()` 自取 `.input-dock-container`，创建 `.dock-actionbar`，并在 `dock` 形态下把已定位的 `#react-conv-presence-host` 移入 `.dock-actionbar__inner`。**`ensureAgentPresenceHost` 不得反向调用 `scrollEndController`**，避免低层宿主装配函数依赖后创建的高层控制器。
2. **输入舱 `outerHTML` 整块替换（`applyInputDockUpdate()`）**：
   - `existingDock.outerHTML = nextDockHtml` 会连带销毁旧 `.dock-actionbar`、旧 `#react-scroll-end-host` 与（dock 模式下的）旧 `#react-conv-presence-host`。
   - 紧随其后的 `scrollEndController.syncHost()` 同步执行：`ensureActionbar(dock)` 创建新 `.dock-actionbar`，**在 `dock.insertBefore(actionbar, dock.firstElementChild)` 之前**就把缓存的 `lastVisible` 与 `state.presenceLayout` 写进新节点的 `dataset`，消除首帧闪变与假过渡；检测到旧 `hostEl?.isConnected === false` 时卸载旧 React 句柄并在新 `#react-scroll-end-host` 重新挂载；随后把 presence host 重新放入 `actionbar.inner`。
   - **关键竞争防护**：`createRoot().render()` 提交异步于同步 JS 回合，`<button class="scroll-end">` 在同步 `syncHost()` 返回瞬间可能尚未进入 DOM。因此 `ScrollToEndButton` 通过 `useLayoutEffect` 触发 `onCommit` 回调，且 `syncVisibility` 除比较 `lastVisible` 外额外校验 `lastSyncedActionbarEl === actionbarEl && lastSyncedButtonEl === buttonEl && buttonEl.isConnected`；一旦 React 提交新按钮节点，立即把 `aria-hidden` 与 `tabindex` 同步到新 `<button>` 上，且语言切换引起 React 重渲染时不会因 JSX 默认 prop 而覆盖命令式状态。
3. **断开网关 / `dispose()`**：
   `!state.gatewayConnected` 时 `ensureAgentPresenceHost` 与 `scrollEndController.syncHost()` 按对称规则早退清理：取消平滑会话（不写 `instant`）、`unmount()` React root、`.dock-actionbar.remove()`、清空 `hostEl` / `actionbarEl` / `lastSyncedButtonEl` / `lastVisible` / `lastRenderFingerprint`。

---

## 3. CSS 契约

以下规则可直接合入 [`packages/ui/src/styles/conversation.css`](../../../packages/ui/src/styles/conversation.css)（替代并升级原 `#react-conv-presence-host.presence-host--dock` 段），**0 裸色值、0 幽灵变量、0 `scroll-behavior`、0 滚动容器 `transform`**：

```css
/* ==========================================================================
   输入舱上沿操作带（Dock Actionbar & Scroll-To-End Control）
   ========================================================================== */

/*
 * 1. 容器与指针穿透：
 *   【防坑】.input-dock-container > * 默认声明了 pointer-events: auto（conversation.css:1469），
 *   带父级选择器写 pointer-events: none 压过通配直系子元素规则，避免 740×32px 整条拦截消息流点击。
 *   【层级】.input-dock-container 本身已是 z-index: 40 的独立层叠上下文；
 *   actionbar 取 z-index: 1，低于输入舱内的 popper(100) / 模型下拉(200) / 审批菜单(210)。
 */
.input-dock-container > .dock-actionbar {
  --scroll-end-size: 32px;
  --scroll-end-gap: 8px;

  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 1;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

/*
 * 【防坑】不复制 .input-dock-container 的 padding: 0 24px；
 *   桌面端用 calc(100% - 48px) 与 max-width: 740px 自收边对齐输入舱左边框。
 */
.dock-actionbar__inner {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: calc(100% - 48px);
  max-width: 740px;
  height: var(--scroll-end-size);
  pointer-events: none;
}

#react-scroll-end-host {
  pointer-events: none;
}

/*
 * 2. 按钮本体：绝对定位脱离 flex 流，隐藏时不保留占位。
 *   【防坑 A】禁止用 grid 0fr/1fr：在 indefinite 宽度的 flex 子项中 0fr 按 max-content 计算，实测不收缩。
 *   【防坑 B】禁止声明 overflow: hidden 在按钮根盒：否则移动端 ::after 扩出的 44px 触控热区会被裁掉；
 *     标签裁剪只放在 .scroll-end__label 自身。
 *   【防坑 C】dock 下按钮 gap 必须为 0（stage 下改由 .scroll-end__label 的 margin-left 贡献 8px 间距）：
 *     若容器长期保留 gap: 8px，即使 label 宽 0，flex 仍会在 icon 与 0 宽 label 间插入 8px 间隙，
 *     导致 32px 圆钮内的 14px 图标向左偏移 4px 而不居中。
 *   【防坑 D】禁用不存在的 --ease-out：全仓只有 --ease-spring（styles.css:92），退场曲线显式写 cubic-bezier(0.4, 0, 1, 1)。
 *   【防坑 E】焦点环不用 --ring：浅色皮肤 --ring 对比不足，沿用 conversation.css:2554 的 60% 前景混色先例。
 */
.dock-actionbar .scroll-end {
  position: absolute;
  left: 0;
  top: 0;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  min-width: 0;
  min-height: 0;
  height: var(--scroll-end-size);
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill, 9999px);
  background: var(--card);
  box-shadow: var(--specular-line);
  color: var(--secondary-foreground);
  font: inherit;
  cursor: pointer;
  pointer-events: auto;
  user-select: none;
  visibility: visible;
  opacity: 1;
  transition:
    opacity var(--duration-enter, 120ms) var(--ease-spring, cubic-bezier(0.16, 1, 0.3, 1)),
    transform 80ms cubic-bezier(0.16, 1, 0.3, 1),
    background-color 120ms cubic-bezier(0.16, 1, 0.3, 1),
    border-color 120ms cubic-bezier(0.16, 1, 0.3, 1),
    color 120ms cubic-bezier(0.16, 1, 0.3, 1),
    visibility 0s linear 0s;
}

.dock-actionbar .scroll-end:hover {
  color: var(--foreground);
  background: var(--card-hover);
  border-color: var(--border-strong);
}

.dock-actionbar .scroll-end:active {
  background: var(--card-active);
  transform: scale(0.96);
}

.dock-actionbar .scroll-end:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--foreground) 60%, transparent), var(--specular-line);
}

.dock-actionbar[data-presence-layout="dock"] .scroll-end {
  width: var(--scroll-end-size);
}

.dock-actionbar[data-presence-layout="stage"] .scroll-end {
  width: auto;
  padding: 0 12px 0 8px;
}

.scroll-end__icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  transition: transform 80ms cubic-bezier(0.16, 1, 0.3, 1);
}

.scroll-end__icon > svg {
  display: block;
}

.dock-actionbar .scroll-end:hover .scroll-end__icon {
  transform: translateY(1px);
}

.scroll-end__label {
  display: block;
  max-width: 0;
  margin-left: 0;
  opacity: 0;
  overflow: hidden;
  white-space: nowrap;
  font-family: var(--conv-font-sans);
  font-size: var(--fs-caption, 11px);
  line-height: 16px;
  font-weight: 500;
  transition:
    max-width 160ms var(--ease-spring, cubic-bezier(0.16, 1, 0.3, 1)),
    margin-left 160ms var(--ease-spring, cubic-bezier(0.16, 1, 0.3, 1)),
    opacity var(--duration-enter, 120ms) var(--ease-spring, cubic-bezier(0.16, 1, 0.3, 1));
}

.dock-actionbar[data-presence-layout="stage"] .scroll-end__label {
  max-width: 140px;
  margin-left: var(--scroll-end-gap);
  opacity: 1;
}

/*
 * 3. 退场态（按钮贴底隐藏）：
 *   【防坑】退场必须单独声明 200ms cubic-bezier(0.4, 0, 1, 1) 与 visibility 延迟 200ms，
 *   否则会复用进场 120ms 导致与头像 margin-left 退场错拍。
 */
.dock-actionbar[data-at-bottom="true"] .scroll-end {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity var(--duration-exit, 200ms) cubic-bezier(0.4, 0, 1, 1),
    visibility 0s linear var(--duration-exit, 200ms);
}

/*
 * 4. dock 模式下在场指示器宿主：位于 .dock-actionbar__inner 内，靠 margin-left 让位。
 *   【防坑】让位值必须由 calc(var(--scroll-end-size) + var(--scroll-end-gap)) = 40px 推导；
 *   flex: 1 1 auto; min-width: 0; 防止长工具路径顶破右缘导致省略号失效。
 */
.dock-actionbar #react-conv-presence-host.presence-host--dock {
  position: static;
  flex: 1 1 auto;
  min-width: 0;
  margin-left: calc(var(--scroll-end-size) + var(--scroll-end-gap));
  pointer-events: none;
  transition: margin-left var(--duration-enter, 120ms) var(--ease-spring, cubic-bezier(0.16, 1, 0.3, 1));
}

.dock-actionbar[data-at-bottom="true"] #react-conv-presence-host.presence-host--dock {
  margin-left: 0;
  transition: margin-left var(--duration-exit, 200ms) cubic-bezier(0.4, 0, 1, 1);
}

.dock-actionbar #react-conv-presence-host.presence-host--dock > .conv-presence {
  width: 100%;
  max-width: 740px;
  margin: 0;
}

/* 切会话首帧抑制过渡，避免旧会话可见态拖出 200ms 残影 */
.dock-actionbar[data-motion-suppressed="true"] .scroll-end,
.dock-actionbar[data-motion-suppressed="true"] .scroll-end__label,
.dock-actionbar[data-motion-suppressed="true"] #react-conv-presence-host.presence-host--dock {
  transition: none !important;
}

/*
 * 5. 移动端（<= 768px）：
 *   【防坑 A】styles.css:1025-1034 将 .input-dock-container 与 .composer-dock 同设 width: calc(100vw - 24px) !important；
 *     因此窄屏下 .dock-actionbar__inner 必须收回到 width: 100%; max-width: 100%，不能再减 48px，否则会错位 24px。
 *   【防坑 B】prepare-assets.mjs:104 对 <=768px 所有 button 注入 min-width: 44px; min-height: 44px，
 *     会撑破 32px 视觉盒并把隐藏态按钮拉宽；这里以更高特异性压回 min-width: 0; min-height: 0，
 *     可见态用 ::after 居中扩出至少 44×44px 热区，隐藏态 pointer-events: none 避免留下透明热区。
 */
@media (max-width: 768px) {
  .dock-actionbar__inner {
    width: 100%;
    max-width: 100%;
  }

  .dock-actionbar .scroll-end,
  .dock-actionbar[data-at-bottom="true"] .scroll-end {
    min-width: 0;
    min-height: 0;
  }

  .dock-actionbar .scroll-end::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: max(100%, 44px);
    height: max(100%, 44px);
    transform: translate(-50%, -50%);
  }

  .dock-actionbar[data-at-bottom="true"] .scroll-end::after {
    pointer-events: none;
  }
}

/*
 * 6. 减动效：只保留 1ms 透明度切换与让位，关闭 hover 位移与 active 缩放。
 */
@media (prefers-reduced-motion: reduce) {
  .dock-actionbar .scroll-end,
  .dock-actionbar[data-at-bottom="true"] .scroll-end,
  .dock-actionbar .scroll-end__label,
  .dock-actionbar .scroll-end__icon,
  .dock-actionbar #react-conv-presence-host.presence-host--dock,
  .dock-actionbar[data-at-bottom="true"] #react-conv-presence-host.presence-host--dock {
    transition-duration: 1ms !important;
    transition-delay: 0s !important;
  }

  .dock-actionbar .scroll-end:hover .scroll-end__icon,
  .dock-actionbar .scroll-end:active {
    transform: none !important;
  }
}
```

> **待实测项**：① `.dock-actionbar .scroll-end:hover` 使用 `border-color: var(--border-strong)`（比默认 `--border` 更清晰的反馈）在浅色皮肤 `warm-paper` / `ayu-light` 下的视觉对比度（通过 CDP 五套皮肤实景确认）；② `styles.css:1025-1034` 在 `390×844` 下是否与 `.dock-actionbar__inner { width: 100% }` 严格达成 `alignDelta === 0`（见第 8 节实验 3）。

---

## 4. TypeScript 接口

### 4.1 `packages/core/src/viewport/scrollEndMachine.ts`（纯状态机）

```ts
/** 显隐阈值不在 core 重新定义：由 desktop 注入既有 STICK_TO_BOTTOM_THRESHOLD_PX（唯一真值） */
export const SCROLL_TO_END_ARRIVE_TOLERANCE_PX = 2;
export const SCROLL_TO_END_TIMEOUT_MS = 1200;

export type SmoothScrollStopMode = 'none' | 'instant-at-current' | 'converge-to-bottom';

export type SmoothScrollSessionState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'running';
      readonly ticket: number;
      readonly startedAtMs: number;
      readonly targetScrollHeight: number;
      readonly settledCloseFrames: number;
    };

export type SmoothScrollEvent =
  | { readonly type: 'CLICK'; readonly nowMs: number; readonly scrollHeight: number; readonly clientHeight: number; readonly scrollTop: number }
  | { readonly type: 'FRAME'; readonly ticket: number; readonly nowMs: number; readonly scrollHeight: number; readonly clientHeight: number; readonly scrollTop: number }
  | { readonly type: 'SCROLLEND'; readonly ticket: number; readonly nowMs: number; readonly scrollHeight: number; readonly clientHeight: number; readonly scrollTop: number }
  | { readonly type: 'TIMEOUT'; readonly ticket: number; readonly scrollHeight: number; readonly clientHeight: number; readonly scrollTop: number }
  | { readonly type: 'USER_INTERRUPT' }
  | { readonly type: 'SESSION_ENTER' }
  | { readonly type: 'DISCONNECT' };

export type SmoothScrollTransition = {
  readonly state: SmoothScrollSessionState;
  readonly effect:
    | { readonly kind: 'none' }
    | { readonly kind: 'smooth-to'; readonly scrollHeight: number; readonly ticket: number }
    | { readonly kind: 'stop'; readonly mode: SmoothScrollStopMode };
};

export interface ScrollEndVisibilityInput {
  readonly gatewayConnected: boolean;
  readonly enterPending: boolean;
  readonly initialBottomSettling: boolean;
  /** 由 desktop 注入既有 STICK_TO_BOTTOM_THRESHOLD_PX，core 不重复声明 */
  readonly thresholdPx: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly scrollTop: number;
  readonly force?: 'hidden';
}

export function decideScrollEndVisibility(input: ScrollEndVisibilityInput): boolean;
export function reduceSmoothScrollSession(
  current: SmoothScrollSessionState,
  event: SmoothScrollEvent,
  nextTicket: () => number,
): SmoothScrollTransition;
```

### 4.2 `packages/ui/src/components-react/conversation/ScrollToEndButton.tsx` 与 `mount.tsx`

```ts
export interface ScrollToEndButtonProps {
  /** 形态由 `.dock-actionbar[data-presence-layout]` 单一控制；组件始终渲染 icon + label，不接收 layout / visible */
  readonly label: string;
  readonly ariaLabel: string;
  readonly onClick: () => void;
  /** 可选：React 提交按钮节点后同步通知宿主重推命令式 aria-hidden/tabindex */
  readonly onCommit?: () => void;
}
```

```ts
// packages/ui/src/components-react/conversation/mount.tsx
export function mountScrollToEndButton(
  host: HTMLElement,
  getSnapshot: () => ScrollToEndButtonProps,
): ConversationMount;
```

### 4.3 `packages/desktop/src/renderer/scrollEndController.ts`

```ts
import type { ConversationMount, I18nKey } from '@hermes-flux/ui';

export interface EnsureActionbarResult {
  readonly actionbar: HTMLElement;
  readonly inner: HTMLElement;
  readonly scrollEndHost: HTMLElement;
}

export interface SyncVisibilityOptions {
  /** 切会话等场景抑制本帧过渡动画，仅在确实执行隐藏时写入瞬时抑制标记 */
  readonly suppressTransition?: boolean;
  /** 强制重写 DOM（如节点刚重建或 React 刚提交） */
  readonly forceDomWrite?: boolean;
}

export interface CancelSmoothScrollOptions {
  /** 用户打断传 true（对当前流写 instant）；切会话/断连必须传 false */
  readonly stopNativeSmooth: boolean;
  /** 取消后是否强制立刻隐藏按钮 */
  readonly hideImmediately?: boolean;
}

export interface ScrollEndControllerDeps {
  readonly isGatewayConnected: () => boolean;
  readonly getPresenceLayout: () => 'stage' | 'dock';
  readonly getLang: () => string;
  readonly t: (key: I18nKey) => string;
  readonly getStreamElement: () => HTMLElement | null;
  readonly getDockElement: () => HTMLElement | null;
  readonly isSessionEnterPending: () => boolean;
  readonly isInitialBottomSettling: () => boolean;
  readonly scrollStreamToEndSmooth: (targetScrollHeight: number) => boolean;
  readonly scrollStreamToBottomFallback: (reason: string) => void;
  readonly mountButton: (
    host: HTMLElement,
    getProps: () => {
      label: string;
      ariaLabel: string;
      onClick: () => void;
      onCommit?: () => void;
    },
  ) => ConversationMount;
  readonly now?: () => number;
  readonly requestAnimationFrame?: (cb: () => void) => number;
  readonly cancelAnimationFrame?: (id: number) => void;
}

export interface ScrollEndController {
  /** 在输入舱首个子位装配或复用 .dock-actionbar（插入前同步写入缓存 dataset） */
  ensureActionbar(dock: HTMLElement): EnsureActionbarResult;
  /** 校验宿主连通性、挂载/更新 ScrollToEndButton、同步 layout/locale 与显隐 */
  syncHost(): void;
  /** 幂等同步按钮可见性、data-at-bottom、aria-hidden、tabindex 与焦点 blur() */
  syncVisibility(force?: 'hidden', options?: SyncVisibilityOptions): void;
  /** 点击触发平滑回底会话 */
  scrollToEnd(): void;
  /** 平滑会话是否处于 running（供 onscroll isProgrammatic 并入） */
  isSmoothScrollActive(): boolean;
  /** 取消平滑会话（用户打断写 instant；切会话/断连禁写 instant） */
  cancelSmoothScroll(options: CancelSmoothScrollOptions): void;
  /** 绑定 stream / window 上仅与本控制器相关的监听（capture toggle、scrollend、中断手势、window resize） */
  bindStreamListeners(stream: HTMLElement | null): void;
  /** 释放句柄与全部定时器/监听 */
  dispose(): void;
}

export function createScrollEndController(deps: ScrollEndControllerDeps): ScrollEndController;
```

### 4.4 既有模块增量接口扩展

```ts
// 0. packages/desktop/src/renderer/services/sessionOperationService.ts
export interface SessionOperationServiceDeps {
  // ...既有字段不变...
  /** selectSession / openGroupRoom 在 captureStreamAnchor() 之前调用；禁写 instant */
  readonly cancelSmoothScrollOnLeave?: () => void;
}

// 1. packages/desktop/src/renderer/viewport/streamViewportManager.ts
export interface StreamViewportHost {
  // ...既有字段不变...
  /** beginSessionEnter 入口最先触发：用于无条件取消上一会话的平滑回底（禁写 instant） */
  readonly onBeforeSessionEnter?: () => void;
  /** finishPinPlan / settleInitialBottom 收敛或 syncStreamBottomInset 改写高度后触发 */
  readonly onViewportSettled?: () => void;
}

// StreamViewportManager 新增公开方法：
// public scrollStreamToEndSmooth(targetScrollHeight?: number): boolean;

// 2. packages/desktop/src/renderer/events/conversationStreamController.ts
export interface ConversationStreamControllerDeps {
  // ...既有字段不变...
  readonly syncScrollToEndVisibility?: () => void;
  readonly isSmoothScrollActive?: () => boolean;
}

// 3. packages/desktop/src/renderer/inspector/inspectorController.ts
export interface InspectorControllerDeps {
  // ...既有字段不变...
  readonly onMotionSettled?: () => void; // 透传进 attachMotionController 的 onEntered / onExited
}

// 4. packages/desktop/src/renderer/renderCoordinator.ts
// bindInspectorController() 内 attachMotionController 增加 onEntered / onExited 回调 deps.onInspectorMotionSettled?.()
export interface RenderCoordinatorDeps {
  // ...既有字段不变...
  readonly onInspectorMotionSettled?: () => void;
}
```

---

## 5. 状态机

### 5.1 两个正交子状态机（严格解耦）

| 子状态机 | 唯一真值源 | 状态集 | 职责 |
|---|---|---|---|
| **显隐状态** | `decideScrollEndVisibility()` + `lastVisible` | `hidden` (`data-at-bottom="true"`) \| `visible` (`data-at-bottom="false"`) | 控制按钮 CSS 显隐、dock 头像 `margin-left`、`aria-hidden`、`tabindex`、`blur()` |
| **平滑会话状态** | `SmoothScrollSessionState` | `{ status: 'idle' }` \| `{ status: 'running', ticket, startedAtMs, targetScrollHeight, settledCloseFrames }` | 控制 `isSmoothScrollActive()`、续滚、收敛检测、用户打断与超时兜底 |

> **关键不变量**：`distanceToBottom <= 48` **只驱动显隐状态切到 `hidden`**，绝不结束 `SmoothScrollSessionState`；原生平滑滚动在 `48px → 0px` 减速末段仍保持 `status === 'running'`，确保 `onscroll` 中的 `isProgrammatic` 为真，不被误判为用户手势。

### 5.2 平滑会话状态转移表

| 当前态 | 事件 | 条件 | 下一态 | 副作用 |
|---|---|---|---|---|
| `idle` | `CLICK` | `scrollHeight <= clientHeight` 或 `distance <= 2` | `idle` | `syncVisibility('hidden')` |
| `idle` | `CLICK` | `distance > 2` | `running(ticket=T, target=scrollHeight, settledCloseFrames=0)` | 调 `scrollStreamToEndSmooth(scrollHeight)`；启动 `1200ms` 超时 + rAF + `scrollend` |
| `running(T)` | `CLICK` | `distance > 2` | `running(ticket=T', target=scrollHeight, settledCloseFrames=0)` | 旧定时器/rAF 作废，重启平滑至最新 `scrollHeight` |
| `running(T)` | `FRAME` | `ticket !== T` | 不变 | no-op（作废旧帧） |
| `running(T)` | `FRAME` | `distance <= 2` 且 `settledCloseFrames + 1 >= 2` | `idle` | `stop('none')`，清理定时器/监听，调用 `syncVisibility()` |
| `running(T)` | `FRAME` | `distance <= 2` 且 `settledCloseFrames + 1 < 2` | `running(settledCloseFrames + 1)` | 继续等待终帧/scrollend |
| `running(T)` | `FRAME` | `scrollHeight !== targetScrollHeight` 且 `distance > 48` | `running(target=scrollHeight, settledCloseFrames=0)` | **续滚**：再调 `scrollStreamToEndSmooth(scrollHeight)` chase 新底边 |
| `running(T)` | `FRAME` | `nowMs - startedAtMs >= 1200` | `idle` | 若 `distance > 2` 调 `stop('converge-to-bottom')`，否则 `stop('none')` |
| `running(T)` | `SCROLLEND` | `ticket === T` 且 `distance <= 2` | `idle` | `stop('none')`，清理定时器/rAF，调用 `syncVisibility()` |
| `running(T)` | `SCROLLEND` | `ticket === T` 且 `distance > 48` 且未超时 | `running(target=scrollHeight, settledCloseFrames=0)` | **续滚**：因 `content-visibility` 展开导致提前结束，重发 `smooth-to` |
| `running(T)` | `SCROLLEND` | `ticket === T` 且 `2 < distance <= 48`（或已超时） | `idle` | `stop('converge-to-bottom')`（`scrollStreamToBottom` 补齐残差） |
| `running(T)` | `TIMEOUT` | `ticket === T` | `idle` | 若 `distance > 2` 调 `stop('converge-to-bottom')`，否则 `stop('none')` |
| `running(T)` | `USER_INTERRUPT` | — | `idle` | `stop('instant-at-current')`（`stream.scrollTo({ top: stream.scrollTop, behavior: 'instant' })`）+ `syncVisibility()` |
| `running(T)` | `SESSION_ENTER` / `DISCONNECT` | — | `idle` | `stop('none')`（**严禁对旧流写 `instant`**）+ 强制隐藏并抑制动画 |

> `1200ms` 是初值，不是定理：按 §7 E1 的实测总耗时校准，超长会话可放宽到 `2000ms`，但必须保持有限上界；不得改成无超时。

### 5.3 关键场景文字时序

1. **点击与到达**：用户在 `distance = 2000` 点击按钮（若按钮当时有焦点，进入 `running` 启动平滑）→ 每帧 `onscroll` 因 `isSmoothScrollActive() === true` 跳过手势误判并执行 `syncVisibility()` → 当进入 `distance <= 48` 时 `syncVisibility()` 写 `data-at-bottom="true"`、`aria-hidden="true"`、`tabindex="-1"`，若 `document.activeElement === button` 则调用 `button.blur()`，按钮 200ms 淡出、dock 头像 200ms 归零贴边；`SmoothScrollSessionState` 继续维持 `running` → 到达 `<= 2px`（连续 2 帧或 `scrollend`）后回落 `idle`。
2. **内容增高续滚（`content-visibility: auto`）**：平滑滚经离屏 `.conv-turn` 时占位高度替换为真实高度，`scrollHeight` 由 8000 增至 9600 → rAF 检测到 `scrollHeight !== targetScrollHeight && distance > 48` → 刷新 `targetScrollHeight = 9600` 并重发 `scrollTo({ top: 9600 - clientHeight, behavior: 'smooth' })` 追踪新底边；若逼近末段 `scrollend` 时仍残留 `2 < distance <= 48`（或达 `1200ms` 超时且 `distance > 2`），由 `scrollStreamToBottomFallback('scroll-to-end-converge')` 一次性补齐。
3. **用户打断**：平滑进行中收到 `#conversation-stream` 上的 `wheel` / `touchmove` / `pointerdown` 或导航键 `keydown`（`PageUp | PageDown | Home | End | ArrowUp | ArrowDown | ' '`）→ `USER_INTERRUPT` 立即清 rAF/定时器/监听，调用 `stream.scrollTo({ top: stream.scrollTop, behavior: 'instant' })` 在当帧煞停原生动画，状态归 `idle`，调用 `syncVisibility()` 保持或恢复按钮显示。
4. **切会话**：在 `sessionOperationService.selectSession` 调用 `captureStreamAnchor()` **之前**（`sessionOperationService.ts:501` 前）触发 `cancelSmoothScrollOnLeave()` → `cancelSmoothScroll({ stopNativeSmooth: false, hideImmediately: true })` → 清理定时器与 rAF 归 `idle`，**不向旧流写 `instant`**，同步写 `data-at-bottom="true"` 并加 `data-motion-suppressed="true"`（下一 rAF 移除，并加 300ms 超时兜底防止后台标签页残留），抑制旧按钮在新会话上播退场动画或首帧闪烁。`beginSessionEnter` 首行的 `onBeforeSessionEnter()` 只作为第二道幂等兜底，**不得作为首次取消点**：它晚于 `captureStreamAnchor()`，会把平滑半路坐标写进 `SessionScrollMemory`。
5. **首屏落定 / `finishPinPlan` / `settleInitialBottom`**：落定期间 `enterPending || isInitialBottomSettling()` 恒返回 `hidden`，`onscroll` 提前 return 之前先调用 `syncScrollToEndVisibility()` 确保强制隐藏生效；`finishPinPlan()` 与 `settleInitialBottom()` 收口归零 `initialBottomSettling` 后立即调用 `onViewportSettled()` → `syncVisibility()`，若目标会话是历史回溯位（`distance > 48`）则立即进场显示按钮。
6. **容器尺寸/折叠突变**：`#conversation-stream` 绑定捕获阶段 `toggle`（`{ capture: true, passive: true }`）覆盖所有 `<details>` 思维链/工具输出开合；检查舱 `attachMotionController` 注入 `onEntered`/`onExited` 回调；`window` 绑定 `resize`（rAF 合并）；`syncStreamBottomInset()` 结束触发 `onViewportSettled()`；五路统一调用 `syncVisibility()`。
7. **卸载 / 网关断开**：`!state.gatewayConnected` 或 `dispose()` 触发 `DISCONNECT` → `cancelSmoothScroll({ stopNativeSmooth: false })` → 解绑所有 DOM 监听与定时器、卸载 React root、移除 `.dock-actionbar` 并清空所有状态缓存。

---

## 6. 文件级改动清单（按实施顺序）

| 序 | 文件 | 改动内容 | 为什么 | 风险与规避 |
|---|---|---|---|---|
| 1 | `packages/core/src/viewport/scrollEndMachine.ts`（新增）+ `packages/core/src/index.ts` | 新增显隐判定与平滑会话判别联合纯状态机并从 core 导出 | 单一真值源，支持 `fast-check` 形式化证明 | 保持零 DOM/React 依赖 |
| 2 | `packages/ui/src/i18n/messages/conversation.ts` | 在 `zhConversation` 与 `enConversation` 新增 `conversation.scrollToEnd` 与 `conversation.scrollToEndAria` | 满足 Gate 4b i18n 对称性，禁止字面量 | 一行一词条，禁止给对象加类型注解 |
| 3 | `packages/ui/src/components-react/conversation/ScrollToEndButton.tsx`（新增） | 实现纯表现原语：`label`、`ariaLabel`、`onClick`、`onCommit`；**不接收 `visible` / `layout`**，形态交给 CSS | 隔离交互控件，保持 `AgentPresence` 只读 | 禁止内联 `style` / 裸色值 / 中文字面量 |
| 4 | `packages/ui/src/components-react/conversation/mount.tsx` + `index.ts` | 新增并导出 `mountScrollToEndButton` 与 `ScrollToEndButton` | 与 `mountAgentPresence` 同构的 React 挂载桥 | 挂载前校验 `host.isConnected` |
| 5 | `packages/ui/src/styles/conversation.css` | 新增第 3 节完整 CSS 规则，替换旧 `#react-conv-presence-host.presence-host--dock` 绝对定位块 | 实现动作带定位、绝对定位按钮、40px 让位、44px 移动端热区 | 同步更新 `agent-presence.test.mjs` #21；新断言见 §6.1 |
| 6 | `packages/desktop/src/renderer/viewport/streamViewportManager.ts` + `desktopStreamViewport.ts` | `StreamViewportHost` 增 `onBeforeSessionEnter`、`onViewportSettled`；`beginSessionEnter` 入口调前者，`finishPinPlan`/`settleInitialBottom`/`syncStreamBottomInset` 调后者；新增 `scrollStreamToEndSmooth()` | 切会话入口取消旧平滑；落定与底部内边距变化后主动重校 | 保持 `beginSessionEnter` 既有参数兼容旧单测 |
| 7 | `packages/desktop/src/renderer/scrollEndController.ts`（新增） | 实现动作带装配、React 挂卸载、命令式无障碍同步、rAF 监控与打断、`toggle`/`resize` 监听 | 收拢全部副作用与 100% 增量单测覆盖 | 仅单项依赖注入，禁 import `index.ts` |
| 8 | `packages/desktop/src/renderer/events/conversationStreamController.ts` | `onscroll` 首段与 `enterPending/settling` 早退前调 `deps.syncScrollToEndVisibility?.()`；`isProgrammatic` 并入 `Boolean(deps.isSmoothScrollActive?.())` | 主滚动入口同步显隐；防止平滑末段被误判手势 | 不依赖 `markProgrammaticScroll` |
| 9 | `packages/desktop/src/renderer/inspector/inspectorController.ts` + `renderCoordinator.ts` | 检查舱 `attachMotionController` 增 `onEntered` 与 `onExited` 透传 `onInspectorMotionSettled` | 补齐检查舱开合引起列宽/高度变化的显隐重校 | `dispose()` 时确保旧 controller 被 detach |
| 10 | `packages/desktop/src/renderer/index.ts` | **先抽行**：删 `index.ts:166-172`（`LEFT_RAIL_WIDTH`、`clampLeftRailWidth`）与 `index.ts:1326-1413`（`beginLeftRailResize`、`resetLeftRailWidth`、`bindRailResizeEvents`，共 **~95 行**），改为从 `./bootstrap/appBootstrap.js` 导入复用；**再接线**：实例化 `scrollEndController`；`ensureAgentPresenceHost` **保持只做 presence host 定位并返回**，不得反向调用 controller；由 `scrollEndController.syncHost()` 自取 `.input-dock-container`、创建 `.dock-actionbar`、在 dock 形态下把 presence host 移入 `actionbar.inner`；`syncAgentPresenceHost()` 末尾调用 `syncHost()`；`onPresenceLayoutChanged` / `syncLocale` / `bindEvents` 接入重推。抽行后约 1404 行，接线预算 ≤ 40 行，目标 ≤ 1444 行 | 使 `index.ts` 从 1499 行降到 ~1404 行后安全接线，同时 100% 保留 `wiring #11` 与 `#14` 源码锁 | 严禁移动/改写 `ensureAgentPresenceHost` 与 `syncAgentPresenceHost` 的函数声明名与 #14 关键句式 |
| 11 | `packages/desktop/scripts/build.mjs` | 为 `src/renderer/scrollEndController.ts` 添加独立 `esbuild.build`（`external: ['@hermes-flux/core', '@hermes-flux/ui']`） | 满足 L4 增量覆盖率门禁（testing-strategy §5.3） | 实施前先确认 `build.mjs` 是否已有独立渲染模块构建；若无，改为并入既有 renderer bundle，不新增构建目标；必须复用 `SHARED_RUNTIME_EXTERNALS` 防打包 React CJS 报错 |
| 12 | 守卫与探针同步更新 | 同步更新 `agent-presence.test.mjs` #21/#22、`agent-presence-wiring.test.mjs` #10、`scripts/verify/agent-presence-screens.cjs`、`scripts/gates/lib/test-targets.mjs`（调高 `minFiles`） | 消除结构升级带来的旧选择器漂移，保持证据同构 | **不得**削弱 #11/#14 及既有 28px/无背景/对齐线语义；新断言见 §6.1 |
| 13 | 新增测试与形式化不变量 | 新增 `scroll-end-machine-formal.test.mjs`、`scroll-to-end-button.test.mjs`、`scroll-end-controller.test.mjs`、`scroll-to-end-screens.cjs`；登记 `docs/invariants.json` 并跑 `npm run invariants:render` | 满足新增代码 100% 覆盖、变异杀伤力与不变量映射 | 禁止 `c8 ignore` 与弱断言 |

### 6.1 守卫新断言（#21 / #10）

`agent-presence.test.mjs` #21 改为：

- `.input-dock-container > .dock-actionbar` 块必须含 `bottom: calc(100% + 8px)`、`pointer-events: none`、`z-index: 1`；
- `.dock-actionbar #react-conv-presence-host.presence-host--dock` 块必须含 `position: static`、`flex: 1 1 auto`、`min-width: 0`、`margin-left: calc(var(--scroll-end-size) + var(--scroll-end-gap))`；
- `.dock-actionbar[data-at-bottom="true"] #react-conv-presence-host.presence-host--dock` 块必须含 `margin-left: 0`；
- 旧 `#react-conv-presence-host.presence-host--dock { ... bottom: calc(100% + 8px) ... }` 绝对定位块必须已删除。

`agent-presence-wiring.test.mjs` #10 改为：

- `scrollEndController.syncHost()` 必须把 `#react-conv-presence-host` 移入 `.dock-actionbar__inner`；
- `ensureAgentPresenceHost` 函数体内**不得出现** `scrollEndController` 引用；
- `applyInputDockUpdate(); syncAgentPresenceHost(); syncAgentPresence();` 三行紧邻关系保持原样。

---

## 7. 编码前实验

| # | 实验 | 判定阈值 | 失败回退 |
|---|---|---|---|
| 1 | 长会话 `> 120` 条、`content-visibility` 生效，从顶部点击回底 | 最终 `distanceToBottom <= 2`；无 `> 50ms` 长任务；无可见中途停顿 | 启用 `scrollStreamToBottomFallback` 即时定位 |
| 2 | 平滑中途滚轮 / 触摸 / 方向键 | 1 帧内停止平滑，按钮恢复可见，视口不再被续滚 | 改手写 rAF 缓动 |
| 3 | `390×844` 移动窄屏 | 隐藏态按钮 `getBoundingClientRect().width === 0`；可见态视觉盒 32px；44px 热区命中；`alignDelta === 0` | 调整 `actionbar__inner` 宽度基准或热区实现 |
| 4 | 平滑中途切会话 | `captureStreamAnchor` 捕获的是取消后的位置，不是平滑半路坐标；新会话进入后按钮隐藏且无残影 | 前移取消点至 `selectSession` 入口 |
| 5 | dock ↔ stage 切换 | 按钮形态切换、头像零跳变、`data-presence-layout` 与 DOM 一致 | 由 `syncAgentPresenceHost` 单点重推 |

---

## 8. 不变量登记

| 编号 | 不变量 | 源码锚点 | 守护测试 | 用户可见失效模式 |
|---|---|---|---|---|
| `INV-VIEW-05` | 按钮显隐只由 `distanceToBottom <= threshold` 决定；`smoothScrollActive` 生命周期不得改写显隐真值 | `scrollEndMachine.ts` `decideScrollEndVisibility` | `scroll-end-machine-formal.test.mjs` | 平滑末段按钮闪烁 / 已到底仍显示 |
| `INV-VIEW-06` | 切会话取消平滑必须先于锚点捕获，且不得对旧流写 `instant` | `sessionOperationService.ts` `cancelSmoothScrollOnLeave` 调用点 | `scroll-end-controller.test.mjs` + 单据时序断言 | 切回会话位置飞到半路 / 旧流残留滚动事件 |

登记到 `docs/invariants.json` 后必须执行 `npm run invariants:render` 与 `npm run gates:invariants`。

---

## 7. 测试设计（可证伪断言）

### 7.1 单元测试与形式化验证

1. **Core 形式化不变量（`packages/core/__tests__/formal/scroll-end-machine-formal.test.mjs`）**：
   - 使用 `fc.assert` 生成随机操作序列（`CLICK / FRAME / SCROLLEND / TIMEOUT / USER_INTERRUPT / SESSION_ENTER / DISCONNECT` 与任意 `scrollHeight / clientHeight / scrollTop`）：
     - **性质 1（切会话/断连零 `instant` 写入）**：任意 `SESSION_ENTER` 或 `DISCONNECT` 事件后，`state.status === 'idle'` 且输出 `effect` 绝不为 `stop('instant-at-current')`（去掉 `SESSION_ENTER` 分支保护立即反例）。
     - **性质 2（阈值境界与平滑态解耦）**：注入 `thresholdPx = 48` 时，`decideScrollEndVisibility` 在 `distanceToBottom <= 48`（含 `0 / 48`）恒为 `false`，在 `distanceToBottom > 48`（含 `49`）且非强制隐藏时恒为 `true`；且 `FRAME` 在 `2 < distance <= 48` 时若未超时不退出 `running`。
     - **性质 3（`USER_INTERRUPT` 必停且写 `instant`）**：从 `running` 态收到 `USER_INTERRUPT` 必转移到 `idle` 且输出 `stop('instant-at-current')`。
     - **性质 4（有限超时必收敛）**：从 `CLICK` 启动后持续收到 `nowMs - startedAtMs >= 1200` 帧或 `TIMEOUT`，状态必收敛回 `idle`。
2. **UI 表现层单测（`packages/ui/__tests__/scroll-to-end-button.test.mjs`）**：
   - `renderToStaticMarkup` 验证按钮始终**无** `data-layout`、**无** `aria-hidden` / `tabindex`（二者由宿主命令式写）；`label` 来自 `t('conversation.scrollToEnd')`，`aria-label` 来自 `t('conversation.scrollToEndAria')`。
   - 字典校验：切换 `zh-CN` / `en-US` 验证 `conversation.scrollToEnd` 与 `conversation.scrollToEndAria` 非空且不回退成 key 本身。
   - 样式源码守卫：`conversation.css` 中 `.conv-stream` 严禁出现 `scroll-behavior: smooth`；`.dock-actionbar .scroll-end` 严禁含 `grid-template-columns` 与裸色值；`@media (max-width: 768px)` 含 `min-width: 0`、`min-height: 0` 与 `.scroll-end::after` 44px 规则；`prefers-reduced-motion` 含 `1ms` 与 `transform: none`。
   - **可证伪性**：删掉 `ScrollToEndButton` `aria-label`、或给 `.conv-stream` 加回 `scroll-behavior: smooth`、或删去窄屏 `min-width: 0`，对应用例立刻变红。
3. **Desktop 控制器单测（`packages/desktop/__tests__/unit/scroll-end-controller.test.mjs`）**：
   - 导入编译产物 `dist/renderer/scrollEndController.mjs`（保证真实覆盖率命中），挂载真实/桩 DOM 验证：
     - `distanceToBottom = 48` → `data-at-bottom="true"`、`aria-hidden="true"`、`tabindex="-1"`；`49` → `data-at-bottom="false"`、`aria-hidden="false"`、`tabindex="0"`。
     - `distanceToBottom = 40` 在 `running` 期间只隐藏按钮，**不**清 `isSmoothScrollActive()`；到 `<= 2px`（连续 2 帧）或派发 `scrollend` 后才变为 `false`。
     - `scrollHeight` 从 3000 涨至 4500 且 `distance > 48` 时，下一帧 rAF 再次调用 `scrollStreamToEndSmooth(4500)`。
     - `1200ms` 超时且 `distance > 2` 时调用 `scrollStreamToBottomFallback` 并归 `idle`。
     - `wheel` / `touchmove` / `pointerdown` / `PageUp` 立即调用 `scrollTo({ top, behavior: 'instant' })` 并退出 `running`；在 `#dock-prompt-input` 内按 `ArrowUp` 不触发打断。
     - `beginSessionEnter` 入口取消平滑会话：验证 `scrollTo` **未被** 以 `instant` 调用，同时 `data-at-bottom="true"` 且 `data-motion-suppressed="true"`。
     - 隐藏态焦点剥夺：聚焦按钮后滚动到 `distance <= 48`，验证触发了 `button.blur()`。
     - `outerHTML` 重建自愈：替换 `.input-dock-container` 后调 `syncHost()`，验证新 `.dock-actionbar` 插入即带正确 `data-at-bottom`，且 React `onCommit` 把新 `<button>` 的 `aria-hidden` / `tabindex` 对齐。
     - `<details>` 捕获 `toggle`、`window resize`、检查舱 `onEntered`/`onExited`、`finishPinPlan`、`settleInitialBottom` 触发 `syncVisibility()`。

### 7.2 既有守卫同步更新明细

| 文件 & 编号 | 保持不变（不可破坏） | 必须同步更新的断言 |
|---|---|---|
| `agent-presence-wiring.test.mjs` #11 & #14 | **100% 保持原样绿灯**（`applyInputDockUpdate` 后紧邻三行、`ensureAgentPresenceHost` 未连接早退及 `syncAgentPresenceHost` 单次取值） | 无 |
| `agent-presence-wiring.test.mjs` #10 | `presence-host--dock`、`classList.remove('presence-host--dock')`、`#conversation-stream` | `dock.insertBefore(host, dock.firstElementChild)` 更新为校验 `dock` 首位插入 `.dock-actionbar`，且 `host` 放入 `.dock-actionbar__inner`（`actionbar.inner.appendChild(host)`） |
| `packages/ui/__tests__/agent-presence.test.mjs` #21 | 28px、`PRESENCE_DOCK_AVATAR_SIZE`、caption 档、无底板、`pointer-events: none`、无 `padding: 0 24px` | 定位规则由 `#react-conv-presence-host.presence-host--dock` 更新为：`.input-dock-container > .dock-actionbar` 含 `bottom: calc(100% + 8px)` 与 `pointer-events: none`；`#react-conv-presence-host.presence-host--dock` 含 `position: static` 与 `margin-left: calc(var(--scroll-end-size) + var(--scroll-end-gap))` |
| `packages/ui/__tests__/agent-presence.test.mjs` #22 & `scripts/verify/agent-presence-screens.cjs` | `alignDelta === 0`、`gapToDock === 8`、ink 像素校准 | 探针 `injectScript` 在 `dock` 场景按 `.dock-actionbar > .dock-actionbar__inner > [#react-scroll-end-host, #react-conv-presence-host]` 注入并默认置 `data-at-bottom="true"`（隐藏态下 `alignDelta === 0`）；#22 同步校验新宿主结构标记 |

### 7.3 CDP / 真实 Blink 实景验证（`scripts/verify/scroll-to-end-screens.cjs`）

在真实 Electron Blink 窗口中跑通以下端到端断言并落盘 `artifacts/verification/scroll-to-end/`：
1. 桌面端 `1280×820`（`obsidian-gold` 深色 & `warm-paper` 浅色）：
   - 上滚（`distance > 48`）：`dock` 下按钮 32×32、`alignDelta_btn === 0`、头像左沿与输入舱左沿差 `40px`；`stage` 下按钮含中文「回到底部」且顶部 56px 图腾坐标零位移。
   - 滚回 `distance <= 48`：按钮 `opacity === 0` / `visibility === hidden`，`dock` 头像左沿回到 `alignDelta === 0`。
   - 语言切换 EN：`scroll-end` 文案为 `Scroll to end`，`aria-label` 为 `Scroll to end of conversation`。
   - 队列托盘 / 附件轨展开：`.dock-actionbar` 随输入舱上移，`bottom` 距托盘顶边保持 `8px`；`/ ` 与 `@` popper / 模型下拉 / 审批菜单展开时覆盖在 `.dock-actionbar` 之上（不被遮挡）。
   - `<details>` 展开/收起、检查舱展开/收起、窗口 `resize`：`distance` 跨过 48px 后按钮当帧同步显隐。
2. 移动端窄屏 `390×844`：
   - 隐藏态按钮 `getBoundingClientRect().width === 0`（或 `visibility === 'hidden'` 且不占位），头像 `alignDelta === 0`；
   - 可见态按钮视觉盒 `width === 32, height === 32`，`getComputedStyle(btn, '::after').width === '44px'` 且 `height === '44px'`。

---

## 8. 编码前实验（必须先跑，再编码）

| # | 实验名称 | 操作步骤 | 定量判定阈值 | 失败回退方案 |
|---|---|---|---|---|
| E1 | **长会话 `content-visibility: auto` 平滑回底** | 在真实 Electron 窗口构建 `> 120` 轮 `.conv-turn` 会话（开启 `content-visibility: auto` + `contain-intrinsic-size: auto var(--conv-intrinsic-median-height, 140px)`），视口置顶（`scrollTop = 0`），触发状态机点击平滑回底，采样每帧 `scrollHeight`、`scrollTop`、`PerformanceObserver` longtask 与 `scrollend`。 | ① 终态 `distanceToBottom <= 2`；② 总耗时 `<= 1200ms`；③ 单帧/主线程长任务无 `> 50ms` 卡顿；④ 肉眼与坐标轨迹无明显中途停顿或倒跳。 | 若真实长会话出现中途停顿或明显跳变，点击回底降级为 `streamViewportManager.scrollStreamToBottom('scroll-to-end')` 即时定位（按钮仍走 200ms 退场，视觉规格不变）。 |
| E2 | **`smoothScrollActive` 与用户滚轮 1 帧打断** | 在 E1 平滑进行到约 200ms 时，在 `#conversation-stream` 派发真实滚轮 `wheel`（`deltaY = -120`）与 `touchmove`，记录之后 5 帧的 `scrollTop`、`isSmoothScrollActive()` 与 `data-at-bottom`。 | ① 打断事件后 **1 帧内** `isSmoothScrollActive() === false`；② 后续帧 `scrollTop` 不再向下续滚（位移漂移 `<= 1px`）；③ `data-at-bottom="false"`（按钮立即可见）。 | 若 Chromium 在少数平台对 `scrollTo({ top: scrollTop, behavior: 'instant' })` 存在延迟生效，改用自研 rAF `easeOutCubic` 步进写 `stream.scrollTop` 替代原生 `behavior: 'smooth'`（此时 `cancel` 仅需 `cancelAnimationFrame`，1 帧必停）。 |
| E3 | **移动端 `390×844` 窄屏热区与对齐实测** | 加载含 `prepare-assets.mjs` 注入规则的 `mobile/dist` 样式（`390×844` 视口），分别测隐藏态与可见态（`dock` / `stage`）。 | ① 隐藏态头像 `alignDelta === 0`，按钮不可点击且不把头像推离左边框；② 可见态 `.scroll-end` 视觉盒 `32×32px`（`dock`），`::after` 计算尺寸 `>= 44×44px`。 | 若因 `overflow` 祖先或样式表顺序导致 `::after` 尺寸或 `alignDelta` 偏差，检查 `styles.css` 注入顺序并调整 `@media (max-width: 768px)` 选择器权重（绝不用 `min-width: 44px` 撑破视觉盒）。 |

---

## 9. 风险登记

| 风险 | 触发条件 | 观测信号 | 处置 |
|---|---|---|---|
| `content-visibility: auto` 占位高度替换导致原生平滑停在半路 | 长会话从顶部滚到底，途中大量离屏 `.conv-turn` 展开使 `scrollHeight` 突增 | `scrollend` 触发或 1200ms 超时时 `distanceToBottom > 2`，按钮卡在可见态 | rAF 检测 `scrollHeight` 变化且 `distance > 48` 时续滚；终态兜底调 `scrollStreamToBottom`；若 E1 失败整体回退即时定位 |
| `smooth` 末段减速被 `onscroll` 误判为用户手势 | 按钮在 `<= 48px` 隐藏时同步清除了 `smoothScrollActive` | `onscroll` 误触发 `cancelSessionEnter` 或写入 `readerScrolledSessionId` | 强制解耦：`<= 48` 只改显隐，`smoothScrollActive` 必须保持至 `scrollend` / 连续 2 帧 `<= 2px` / 超时 |
| 切会话对旧流写 `instant` 引起竞态或残影 | `beginSessionEnter` 未在入口取消或取消时写了 `scrollTo(instant)` | 新会话首帧闪现旧位置按钮或旧流派发滞后 `scroll` 事件 | 在 `beginSessionEnter` 入口调用 `onBeforeSessionEnter()`，传 `stopNativeSmooth: false` + `suppressTransition: true` |
| `outerHTML` 替换输入舱或 React 异步提交导致 DOM 状态丢失 | 输入流式草稿/附件/语言/布局切换重建 `.input-dock-container` | 按钮 `aria-hidden` 与视觉不一致，或头像跳回 0 再跳到 40px | 插入新 `.dock-actionbar` 前先写 `dataset`；React `useLayoutEffect` `onCommit` + `isConnected` 校验兜底重刷 |
| 移动端 `44px` 全局规则撑破 32px 按钮或隐藏态推走头像 | `prepare-assets.mjs` 的 `button { min-width: 44px }` 命中 `.scroll-end` | `390×844` 下 `alignDelta > 0` 或按钮变成 44×44px | `@media (max-width: 768px)` 用更高特异性置 `min-width: 0; min-height: 0`，热区改由无 `overflow: hidden` 裁剪的 `::after` 承担 |
| 门禁红线：`index.ts` 超 1500 行或漏配构建产物 | 直接往 `index.ts` 塞逻辑或忘改 `build.mjs` | `size/oversize-new` 报错或增量覆盖率门禁报未覆盖 | 先删 `index.ts` 与 `appBootstrap.ts` 重复的 ~95 行左右轨拖拽；在 `build.mjs` 注册 `scrollEndController.mjs` |
| `tokenStreamWriter` 在 `distance <= 168px` 提前 snap | 流式输出中点击回底，接近底部 `paddingBottom + 8` 时 `followBottom` 变真 | 平滑滚动末段最后 160px 突然跳底 | `tokenStreamWriter` 的 `isStreamNearBottom` 保持既有契约即可，若 E1 实测有明显跳跃可在 `isStreamNearBottom` 传入前跳过平滑态（记录进风险观测） |

---

## 10. 与既有不变量的对应

### 10.1 与既有不变量的对齐关系

| 既有编号 / 守卫 | 对应模块 | 本设计的对齐方式 |
|---|---|---|
| `INV-VIEW-01` ~ `INV-VIEW-04` | `core/src/viewport/*` | **只增不改**：`SessionScrollMemory` 仅认 `captureStreamAnchor` 与 `planSessionEnter`，本控件不自建记忆；`decideViewportPin` 与 `beginSessionEnter` 的入口优先于平滑回底（入口立即取消平滑） |
| `ENGINEERING_DISCIPLINE.md` §三.1 / §三.2 | `conversation.css` / `streamViewportManager` | 容器 CSS **绝不写** `scroll-behavior: smooth`；显隐阈值严格同源 `STICK_TO_BOTTOM_THRESHOLD_PX = 48` |
| `AgentPresence` 只读不变量 | `AgentPresence.tsx` / `agent-presence.test.mjs` | `AgentPresence` 零改动；动作带以兄弟节点并列组合，保持 `AgentPresence` `pointer-events: none` 与零回调 |
| `agent-presence-wiring.test.mjs` #11 & #14 | `renderCoordinator.ts` / `index.ts` | #11 三行紧邻结构与 #14 函数体内早退逻辑原封不动保留 |

### 10.2 建议新增不变量（登记入 `docs/invariants.json`）

新增后须执行 `npm run invariants:render` 同步 `docs/invariants.md`，并通过 `npm run gates:invariants` 校验：

| 建议编号 | `topic` | `source` | `symbol` | `test` | `failure` |
|---|---|---|---|---|---|
| `INV-VIEW-05` | 回到底部显隐边界恒与 48px 贴底阈值同源且落定期必隐藏 | `packages/core/src/viewport/scrollEndMachine.ts` | `decideScrollEndVisibility` | `packages/core/__tests__/formal/scroll-end-machine-formal.test.mjs` | 贴底时按钮仍可见遮挡内容，或切会话/首屏落定期误闪现按钮 |
| `INV-VIEW-06` | 平滑回底状态机：≤48 不断会话、用户打断写 instant、切会话/断连零写旧流 | `packages/core/src/viewport/scrollEndMachine.ts` | `reduceSmoothScrollSession` | `packages/core/__tests__/formal/scroll-end-machine-formal.test.mjs` | 平滑末段被误判为用户手势；或切会话向旧流写 instant 污染新会话视口 |
