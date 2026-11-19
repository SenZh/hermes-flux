# 长会话（加载大量历史入缓存后）切走再切回飞到中间 — 深度根因 Review 与修复交接单

> **更新时间**：2026-11-18  
> **当前状态**：已完成全链路代码 Review 与根因定性（暂未改写生产代码，工作区保留上一轮未提交改动供对照）  
> **核心复现前提**：必须先在会话中向上滚动（或通过提示词导航器加载更早历史），使内存缓存 `sessionMessagesCache` 中的消息数超过 120 条（纯原生流下已无虚拟窗口阈值），随后滑到底部看最新消息 ➔ 切到其他会话 ➔ 再切回本会话。

---

## 一、用户复现路径与核心现象

1. **首次刷新进入会话**：只拉取最新一页（`INITIAL_WINDOW_PAGE_SIZE = 50 <= 120`），显示在最底部是正确的；
2. **向上回溯加载大量历史入缓存**：通过向上滑动或提示词浏览器/导航器（`loadOlderMessages`，每页 `OLDER_BATCH_PAGE_SIZE = 500`）加载大量历史消息到 `sessionMessagesCache`（此时 `state.messages.length` 达到数百至上千条，`> MESSAGE_WINDOW_CAPACITY = 120`）；
3. **滑回最底部**：此时视口停在最下面，能看到最新消息；
4. **切出去再切回来**：视口**一定不在最下面**，而是飞在中间很靠上的位置；
5. **再次手动滑到底部、再切出去再切回来**：位置**依然不对**，仍然飞在中间。

---

## 二、为什么上一轮未提交代码（Uncommitted Changes）依然不生效？

上一轮未提交改动（`packages/core/src/viewport/sessionScrollMemory.ts` 与 `packages/desktop/src/renderer/viewport/streamViewportManager.ts`）仅修了：
1. `recordSnapshot` 增加 `nearBottomReservePx`（解决 `paddingBottom = 160px > 48px` 的阈值分裂）；
2. `sampleTurnIntrinsicHeight` 改为采集 `.conv-turn` 并把 `--conv-intrinsic-median-height` 写到 `document.documentElement`；
3. `scrollStreamToContentBottom` 在 `scrollHeight <= clientHeight` 时早退。

**但它漏掉了真正导致「长历史缓存会话切回飞到中间、且再滑到底切回依然复现」的 5 个致命链路缺陷（甚至因 `--conv-intrinsic-median-height` 被抬高到 `402px+` 加剧了 `onscroll` 误判取消）**：

---

## 三、五大核心根因全链路剖析（含精确代码坐标）

### 根因 1（为什么必须加载大量历史 `> 120` 条才必现）：`index.ts` 与 `messageWindowManager.ts` 窗口状态脑裂 + `onscroll` 幽灵滑窗重定位

1. **纯原生流改造半途而废导致状态脑裂**：
   - [`messageWindowManager.ts:153-156`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/messageWindowManager.ts#L153-L156) 已改为「方案 1 纯原生流」：
     ```ts
     messageWindowStart = 0;
     messageWindowEnd = total;
     messageWindowUserExpanded = false;
     ```
     且 `computeVirtualHeightPx()` 恒返回 `0`（[`messageWindowManager.ts:358-360`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/messageWindowManager.ts#L358-L360)），因此 DOM 中**根本不存在 `.conv-virtual-window` 节点**（[`ConversationMessageList.tsx:160`](file:///D:/ws/hermes-aura/packages/ui/src/components-react/conversation/ConversationMessageList.tsx#L160)）。
   - **但 [`messageLoadingService.ts:614-626`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/services/messageLoadingService.ts#L614-L626) 与 [`761-777`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/services/messageLoadingService.ts#L761-L777) 在 `loadOlderMessages()` 加载历史时，仍然按 `MESSAGE_WINDOW_CAPACITY = 100` 计算切片 `[start, start + 100]`**，并通过 `this.deps.setMessageWindowStart(start)` / `setMessageWindowEnd(end)` / `setMessageWindowUserExpanded(true)` 写进了 [`index.ts:709-711`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/index.ts#L709-L711) 的模块级同名变量！
   - 与此同时，[`renderCoordinator.ts:267`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/renderCoordinator.ts#L267) 与 [`363`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/renderCoordinator.ts#L363) 直接调用 `deps.messageWindowManager.ensureMessageWindow(state.messages.length)`，**绕过了 [`index.ts:628`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/index.ts#L628) 的 `syncWindowLocalState()`**！
   - 结果：`messageWindowManager` 内部是 `[0, 600]`，而 `index.ts` 里的 `messageWindowStart` / `messageWindowEnd` 永远卡在 `[start, start + 100]`（或 `[start, start + 120]`），且切会话时 `index.ts` 的 `messageWindowStart` / `messageWindowEnd` **完全不会被重置**！

2. **脑裂直接引发的两个灾难后果**：
   - **后果 A（滑回底部无法解除回溯锁定）**：
     在 [`conversationStreamController.ts:402-412`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/events/conversationStreamController.ts#L402-L412)：
     ```ts
     if (isNearBottomNow) {
       scheduleStreamBottomInset();
       if (getMessageWindowEnd() >= state.messages.length) {
         if (isMessageWindowUserExpanded()) {
           setMessageWindowUserExpanded(false);
           setReaderScrolledSessionId('');
         }
       }
     }
     ```
     因为 `getMessageWindowEnd()` 读的是 `index.ts` 的 `messageWindowEnd`（例如 `100` 或 `449`，小于 `state.messages.length = 600`），`getMessageWindowEnd() >= state.messages.length` **恒为 `false`**！即使读者已经把会话滑到最底部，`readerScrolledSessionId` 和 `messageWindowUserExpanded` 也永远不会被清零！
   - **后果 B（`state.messages.length > 120` 时 `onscroll` 误触发虚拟滑窗重定位与强制 `render()`）**：
     在 [`conversationStreamController.ts:416-528`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/events/conversationStreamController.ts#L416-L528)：
     - 首次刷新只有 50 条消息（`50 <= 120`），不进 `if (state.messages.length > MESSAGE_WINDOW_CAPACITY)`，且 `planUpwardScrollAction` 的 `exceedsCapacity` 为 `false`，所以首次刷新一切正常；
     - 一旦加载历史使 `state.messages.length > 120`，每次滚动事件都会用 `msgWindowStart * avgRowHeight`（`avgRowHeight = 80`）去和真实 `scrollTop` 比较；
     - 因为 DOM 没有 `.conv-virtual-window`，且 600 条消息合并为 ~200 个 `.conv-turn` 后的真实像素高度与 `msgWindowEnd * 80` 完全不同源，`outside` 判定频繁为真，在滚动中途调用 `relocateMessageWindowToIndex(targetIndex)` ➔ `render()`，或触发 `planUpwardScrollAction` 的 `'expand-local-window'`（把 `suppressPinBottomOnce` 置为 `true` 并调用 `render()`）与 `'settle-bottom'`！

> **补充同构死变量 Bug**：
> - [`index.ts:608`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/index.ts#L608) `setSessionSwitchPending: (val) => { sessionSwitchPending = val; }` 写的是 `index.ts:600` 的死变量，根本没写进 `renderCoordinator` 内部的 `sessionSwitchPending`（[`renderCoordinator.ts:221`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/renderCoordinator.ts#L221)）；
> - [`index.ts:747`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/index.ts#L747) `setLastMessagesSnapshot: (v) => { lastMessagesSnapshot = v; }` 写的是 `index.ts:982` 的死变量，没写进 `renderCoordinator` 内部的 `lastMessagesSnapshot`（[`renderCoordinator.ts:223`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/renderCoordinator.ts#L223)）；
> - [`renderCoordinator.ts:931`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/renderCoordinator.ts#L931) 调用的是 `deps.messageWindowManager.markProgrammaticScroll(stream)`（写 `messageWindowManager` 内部私有变量），而 [`conversationStreamController.ts:362`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/events/conversationStreamController.ts#L362) 读的却是 `index.ts:596` 的 `programmaticScrollTarget`！

---

### 根因 2：`streamEl.onscroll` 把 `content-visibility: auto` 展开引发的浏览器自动滚动调整误判为「用户手势」，当场杀死 `pendingSessionEnter`！

查看 [`conversationStreamController.ts:362-395`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/events/conversationStreamController.ts#L362-L395)：
```ts
const progTarget = getProgrammaticScrollTarget();
const previousTop = getLastStreamScrollTop();
const inIgnoreWindow = performance.now() <= getProgrammaticScrollIgnoreUntil();
const isLayoutClamp = inIgnoreWindow && streamEl.scrollTop >= previousTop - 8;
const isProgrammatic =
  (progTarget !== null && Math.abs(streamEl.scrollTop - progTarget) <= 2)
  || isLayoutClamp;

if (progTarget !== null && Math.abs(streamEl.scrollTop - progTarget) <= 2) {
  setProgrammaticScrollTarget(null);
}

if (!isProgrammatic && performance.now() > getLayoutDriftUntil() && Math.abs(streamEl.scrollTop - previousTop) > 4) {
  setInitialBottomSettling(false);
  deps.cancelSessionEnter?.();
  if (streamEl.scrollTop < previousTop - 4) {
    setReaderScrolledSessionId(state.activeSessionId);
    setSettledLayoutSignature(layoutSignature());
  }
}
setLastStreamScrollTop(streamEl.scrollTop);
```

**为什么在长历史会话切回时这里 100% 误杀 `pendingSessionEnter`？**
1. 切回长会话（例如 600 条消息 / 200 个 `.conv-turn`）时，React 重新挂载了 200 个全新的 `.conv-turn` DOM 节点（全部失去 `contain-intrinsic-size: auto` 的历史记忆高度，统一使用 `--conv-intrinsic-median-height` 占位高度）。
2. 首帧 `runPinFrame` 把 `stream.scrollTop` 设为当时的 `maxScroll`（例如 `65626`），并设 `progTarget = 65626`。
3. 第一次 `scroll` 事件到达时，命中 `Math.abs(streamEl.scrollTop - progTarget) <= 2`：
   - 第 384 行**立刻把 `progTarget` 清空为 `null`**；
   - 第 395 行把 `previousTop` 设为 `65626`。
4. 紧接着，Blink 在下一渲染步对视口附近（含上方 1.5 倍视口高度预激活区 `[scrollTop - 1200, scrollTop + 800]`）的 `.conv-turn` 解除 `content-visibility: auto` 跳过并执行真实排版：
   - 上一轮未提交代码把 `--conv-intrinsic-median-height` 采到了 `402px`（因为滑动窗口容量 50 被工具回合主导，而真实均值仅 `241px`、用户提问回合仅 `~60px`）；
   - 当视口上沿附近的回合解除跳过变成真实高度（例如用户提问从 `402px` 变回 `60px`，单回合收缩 `-342px`）时，Blink 的 `overflow-anchor: auto` 或 `scrollHeight` 收缩钳制会将 `streamEl.scrollTop` **向下回调数百像素**（远超 `-8px` 容差）；
   - 或者当视口上方回合比占位高（如 `140px` 展开为 `600px`）时，在 `scroll` 事件派发前 `overflow-anchor: auto` 就已经把 `streamEl.scrollTop` 改离了 `progTarget`（偏差 `> 2px`）！
5. 此时第二个 `scroll` 事件进入 `onscroll`：
   - `progTarget` 已经是 `null`；
   - `isLayoutClamp`（要求 `streamEl.scrollTop >= previousTop - 8`）为 **`false`**；
   - `isProgrammatic` 为 **`false`**；
   - 第 389 行直接执行 **`deps.cancelSessionEnter?.()`**，当场杀死进入计划！
   - 第 391 行直接执行 **`setReaderScrolledSessionId(state.activeSessionId)`**，伪造了「读者主动向上回溯」状态！
6. **真正的用户滚动只能来自真实输入事件（`wheel` / `touchmove` / `keydown` / 滚动条 `pointerdown`）**，绝不能在没有用户输入的情况下把 `content-visibility: auto` + `overflow-anchor: auto` 引发的 `scrollTop` 突变当成用户手势去 `cancelSessionEnter()`！

---

### 根因 3：`content-visibility: auto` + `overflow-anchor: auto` 在全新挂载 200+ 个 `.conv-turn` 时的「顶沿锚定下推效应」与提前收敛

当从会话 B 切回会话 A（缓存命中 600 条消息）时：
1. React 卸载会话 B，挂载会话 A 的 200 个全新 `.conv-turn` 节点。
2. 在 `runPinFrame`（[`streamViewportManager.ts:807-927`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/viewport/streamViewportManager.ts#L807-L927)）把 `stream.scrollTop` 推到占位 `maxScroll` 的那一刻：
   - Blink 的 `content-visibility: auto` **不会在 JS 写 `scrollTop` 时同步解锁**末尾的 `.conv-turn`，而是在动画帧的 Update the Rendering 阶段才解锁视口内及 1.5 倍预激活区内的 `.conv-turn`；
   - 但在 `runPinFrame` 同步测量 `lastRow.getBoundingClientRect().bottom - safeBottom` 时，末行虽然处于 `content-visibility: auto` 的跳过占位态（`!this.isAnchorLaidOut(lastRow)`），它的占位底边却恰好等于 `safeBottom`（`deltaAfter === 0 <= 2`），导致 `aligned` 在占位态下就被判为 `true`！
3. 当下一帧 Blink 真正解锁末尾的 10~15 个 `.conv-turn` 时：
   - 因为 `#conversation-stream` 开启了 `overflow-anchor: auto`（[`conversation.css:101`](file:///D:/ws/hermes-aura/packages/ui/src/styles/conversation.css#L101)），Blink 的 `ScrollAnchor` 选中的锚点是**当前视口顶沿（`streamTop`）的那个回合**（例如倒数第 10 个回合 `Turn 190`），而不是视口底沿！
   - 于是 `Turn 190` 被钉在视口顶沿不动，而 `Turn 191 .. Turn 199`（视口内部的最后 9 个长回合、工具块、代码块）解锁后**向下膨胀数千像素**！
   - 一旦此时 `pendingSessionEnter` 已被根因 2 的 `onscroll` 误杀（或已提前满足帧稳定条件收口），这向下膨胀出来的数千像素就再也无人跟进贴底，视口便稳稳停在倒数第 10~30 条消息（会话中段偏上）！

---

### 根因 4：中途 `render()` 反向覆写 `SessionScrollMemory` + `captureStreamAnchor()` 先改 CSS 变量再读 `scrollHeight` 污染快照（为什么「再滑下来、切出去再切回来，位置依然不对」）

1. **中途 `render()` 把半途位置写进 `SessionScrollMemory`**：
   - 切回会话 A 时，`loadMessagesInner` 先用内存缓存的 600 条消息触发一次同步 `render()`（Render #1），随后发起异步 REST `fetchSessionMessages(limit: 50)`，返回并合并后再触发 `render()`（Render #2），最后 `finally` 把 `state.messagesPhase = 'ready'` 再触发 `render()`（Render #3）。
   - 一旦 `pendingSessionEnter` 在 Render #1 之后被根因 2 取消（`isSessionEnterPending() === false`），Render #2 / Render #3 执行 [`renderCoordinator.ts:617-626`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/renderCoordinator.ts#L617-L626) 时：
     - `enterPending` 为 `false`；
     - `wasNearBottom` 为 `false`（因为底部回合刚向下膨胀了数千像素）；
     - `decideViewportPin` 返回 `capture: true, pinBottom: false, applyAnchor: true`！
     - `chooseViewportAnchor` 立即调用 `deps.captureStreamAnchor()`，把**正停在半空的错误位置（`isNearBottom: false` + 中段 `anchorMessageId`）写进 `SessionScrollMemory`**，并调用 `applyStreamAnchor` 把视口焊死在半空！
2. **`captureStreamAnchor()` 内部读写顺序颠倒（先写 CSS 变量破坏布局、后读 `scrollTop`/`scrollHeight`）**：
   - 查看 [`streamViewportManager.ts:577-595`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/viewport/streamViewportManager.ts#L577-L595)：
     ```ts
     this.sampleTurnIntrinsicHeight(stream, streamTop, streamBottom);
     this.applyIntrinsicHeightVariable(stream);

     if (activeSessionId) {
       this.sessionScrollMemory.recordSnapshot({
         sessionId: activeSessionId,
         scrollTop: stream.scrollTop,
         scrollHeight: stream.scrollHeight,
         clientHeight: stream.clientHeight,
         ...
     ```
   - 当用户把会话 A 重新滑到最底部，然后点击切去会话 B 时，`selectSession(sessionB)` 调用 `captureStreamAnchor()`：
     - 第 577-578 行先执行了 `sampleTurnIntrinsicHeight` 和 `applyIntrinsicHeightVariable(stream)`，直接修改了 `stream` 和 `documentElement` 上的 `--conv-intrinsic-median-height`！
     - 修改该 CSS 变量会立即改变会话 A 中所有当前处于 `content-visibility: auto` 且无 `auto` 记忆高度的离屏回合尺寸（或触发同步重排）；
     - 紧接着第 583-584 行再读 `stream.scrollTop` 与 `stream.scrollHeight`，拿到的是**被新 CSS 变量突变后的 `scrollHeight` 与旧 `scrollTop`**，导致明明在底部却可能算出 `scrollHeight - scrollTop - clientHeight > reserveThreshold`，把离开快照记成 `isNearBottom: false`！
   - 此外，[`streamViewportManager.ts:631`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/viewport/streamViewportManager.ts#L631) 在 `beginSessionEnter` 中将 `pending.phase` 初始值设为 `'ready'`，而 [`renderCoordinator.ts:908`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/renderCoordinator.ts#L908) 却把 `settleSessionEnter(..., state.messagesPhase, ...)` 放在 `requestAnimationFrame` 里异步调用；在 rAF 触发前若 `postCommitPinObservers` 先触发 `reassertActivePin()`，`pending.phase` 会被误认为已经是 `'ready'`。
   - 同时，[`renderCoordinator.ts:510`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/renderCoordinator.ts#L510) 在 `mountReactShellComponents()` 中同步调用 `deps.syncStreamBottomInset()`，此时 `ensureMessageWindow` 刚删掉 `--conv-gutter-bottom`，而 DOM 还是旧会话的内容，导致 [`streamViewportManager.ts:402-403`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/viewport/streamViewportManager.ts#L402-L403) 错误启动 `this.setInitialBottomSettling(true); this.settleInitialBottom();` 与 `pendingSessionEnter` 双轨打架。

---

### 根因 5：`sampleTurnIntrinsicHeight` 采样偏差把 `--conv-intrinsic-median-height` 顶到 `402px+`

查看 [`streamViewportManager.ts:446-470`](file:///D:/ws/hermes-aura/packages/desktop/src/renderer/viewport/streamViewportManager.ts#L446-L470)：
1. `AdaptiveMedianEstimator` 的窗口大小只有 `50`（`windowSize = 50`），而 `sampleTurnIntrinsicHeight` 每次从头到尾遍历全部 `turns`（例如 200 个回合），导致**只有最后 50 个回合留在估算器窗口内**，且跨会话不重置；
2. 首次调用时 `--conv-intrinsic-median-height` 尚未写入 inline style，`readIntrinsicHeightVariable(stream)` 返回 `null`，自锁打断 `if (current !== null && ...)` 不生效，140px 的默认占位回合也会被灌进样本；
3. 一旦已经渲染过的回合（记住 `auto` 高度的回合）与当前中位数不等，每次 `captureStreamAnchor` 都会把它们重复灌入 `medianEstimator`；若末尾多为带工具调用的大回合，中位数会被推高到 `402px+`（远高于包含用户短提问在内的真实均值 `241px`），导致切回时整篇文档初始占位 `scrollHeight` 虚高一倍，进而在回溯恢复（`restore-anchor`）和贴底解锁时引发剧烈高度坍缩与锚点漂移。

---

## 四、下一步修复方案清单（供新 Session 直接执行）

### Step 1：彻底清理 `index.ts` / `messageLoadingService.ts` / `conversationStreamController.ts` 的窗口状态脑裂（消除根因 1）
1. **`index.ts` 与 `messageWindowManager.ts` 单一真值源收敛**：
   - 在 `messageWindowManager.ts` 的 `ensureMessageWindow` 中，既然已是「方案 1 纯原生流」（`messageWindowStart = 0; messageWindowEnd = total; messageWindowUserExpanded = false;`），让 `index.ts` 中所有读取 `messageWindowStart` / `messageWindowEnd` / `messageWindowUserExpanded` / `averageRowHeightPx` 的地方直接委托给 `messageWindowManager.get*()`，消除 `index.ts` 里的同名镜像变量（或确保 `ensureMessageWindow` 内部变化时 100% 同步）；
   - 修复 `index.ts:608` 的 `setSessionSwitchPending`（应调用 `renderCoordinator.setSessionSwitchPending(val)`）与 `index.ts:747` 的 `setLastMessagesSnapshot`；
   - 修复 `renderCoordinator.ts:931` 的 `markProgrammaticScroll`，统一走宿主注入的 `markProgrammaticScroll`（与 `conversationStreamController` 读取的同一个真值源对齐）。
2. **`messageLoadingService.ts` (`loadOlderMessages`)**：
   - 在纯原生流下，`loadOlderMessages` 向上拼接历史后，不要再把 `messageWindowStart` / `messageWindowEnd` 截断成 `100` 条容量（`windowEndFor(..., 100)`），保持 `[0, state.messages.length]` 全量窗口，避免 `getMessageWindowEnd() < state.messages.length` 锁死。
3. **`conversationStreamController.ts` (`streamEl.onscroll`)**：
   - 当处于会话进入落定期（`isSessionEnterPending()`）或 `isInitialBottomSettling()` 时，`onscroll` 在完成手势检测后直接 `return`，绝不执行后续的滑窗扩窗与 `loadOlderMessages` 触发逻辑；
   - 在纯原生流（`computeVirtualHeightPx() === 0` / 无 `.conv-virtual-window`）下，禁用 `onscroll` 中针对虚拟切片窗口的 `slideMessageWindowForward`、`outside -> relocateMessageWindowToIndex` 与 `expand-local-window` 分支，只保留触顶触发 `fetch-older-remote`（`loadOlderMessages`）。

### Step 2：修复 `onscroll` 手势判别与 `runPinFrame` 贴底收敛（消除根因 2 & 3）
1. **防止 `content-visibility: auto` / `overflow-anchor: auto` 排版回调误杀 `pendingSessionEnter`**：
   - 在 `conversationStreamController.ts` 中，不要在第一次 `scroll` 事件命中 `progTarget` 时就立即清空 `progTarget = null` 并在随后的布局 clamp / anchor 调整（`> 8px`）时误判为用户手势；
   - 更稳健的做法：记录最近一次**真实用户输入手势**（`wheel` 向上、`touchmove`、`keydown` PageUp/Home/ArrowUp、或滚动条拖拽 `pointerdown`）的时间戳；在 `isSessionEnterPending()` 期间，**只有存在真实用户输入手势**（而非单纯由 DOM 布局重排 / `content-visibility` 展开引起的被动 `scroll` 事件）才允许调用 `cancelSessionEnter()` 并设置 `readerScrolledSessionId`！
2. **修复 `runPinFrame` 对末行仍处于 `content-visibility: auto` 占位态的判据**：
   - 在 `streamViewportManager.ts` 的 `runPinFrame` 中，当 `lastRow` 存在但 `!this.isAnchorLaidOut(lastRow)`（且未超过宽限帧数）时，`aligned` 必须为 `false`，不得在末行仍是跳过占位块时就提前计入 `alignedStableFrames` 收口；
   - 在 `pin-to-bottom` 计划处于 active/armed 期间，可以考虑临时将 `#conversation-stream` 的 `overflow-anchor` 设为 `none`（或在每次 `ResizeObserver` / `MutationObserver` 触发 `reassertActivePin` 时持续把 `scrollTop` 推到最新 `maxScroll`），防止 `overflow-anchor: auto` 锚定在视口顶沿而把新解锁的底部回合推到视口下方。

### Step 3：修复 `captureStreamAnchor` 读写顺序与生命周期边界（消除根因 4 & 5）
1. **在 `captureStreamAnchor()` 中先读取快照，后采样/更新 CSS 变量**：
   - 在 `streamViewportManager.ts:555-604` 中，必须**先读取** `stream.scrollTop`、`stream.scrollHeight`、`stream.clientHeight` 并调用 `this.sessionScrollMemory.recordSnapshot(...)`，**然后再**执行 `sampleTurnIntrinsicHeight` 与 `applyIntrinsicHeightVariable`（或者不在离开瞬间改写当前 DOM 的 `--conv-intrinsic-median-height`），彻底杜绝「改写 CSS 变量撑大 `scrollHeight` 后立刻读 `scrollHeight` 导致贴底态被误判为非贴底」。
2. **只采样真实已布局的回合（`isAnchorLaidOut(turn)`）**：
   - 在 `sampleTurnIntrinsicHeight` 中，使用 `this.isAnchorLaidOut(turn)`（即 `turn.checkVisibility({ contentVisibilityAuto: true })`）过滤掉所有被 `content-visibility: auto` 跳过的占位回合！这样既不会采到 `140px` 占位值，也无需依赖 fragile 的 `Math.abs(rect.height - current) < 0.5` 自锁打断。
3. **同步传递 `messagesPhase` 并隔离 `syncStreamBottomInset`**：
   - 在 `beginSessionEnter` 或 `loadMessages` 启动时同步将 `pending.phase` 置为 `'loading'`，避免 `reassertActivePin` 抢跑在 `renderCoordinator` 的 `requestAnimationFrame` 之前看到 `'ready'`；
   - 在 `syncStreamBottomInset` 中，当 `this.isSessionEnterPending()` 为 `true` 时，只更新 `--conv-gutter-bottom` 变量，**不要**再调用 `this.setInitialBottomSettling(true); this.settleInitialBottom();`，避免两套贴底循环并发冲突。

---

## 五、交接检查点与验证命令

1. **当前工作区未提交文件**：
   - `packages/core/src/viewport/sessionScrollMemory.ts`
   - `packages/core/__tests__/viewport/sessionScrollMemory.test.mjs`
   - `packages/desktop/src/renderer/viewport/streamViewportManager.ts`
   - `packages/desktop/__tests__/unit/stream-viewport-manager.test.mjs`
   - `docs/changes/2026-11-18_long-session-scroll-restore/handoff.md`（本文件）
2. **验证要求**：
   - 编写复现测试时，**必须模拟「先通过 `loadOlderMessages` 加载多页历史使 `state.messages.length > 200`，再滑到底部，切到另一会话，再切回本会话，以及再次滑到底部切出切回」**的完整链路；
   - 执行全量门禁：`npm run gates:changed`、`npm run typecheck`、`npm test`、`npm run verify:formal`。
