# 提示词导航轨（Prompt Navigator Rail）设计方案 v2

> 状态：待复审
> 日期：2026-11-10
> 参考实现：OpenChamber `packages/ui/src/components/chat/components/PromptNavigatorRail.tsx`
> 目标仓库：Hermes Flux `dev/v0.1`
> v2 说明：按首轮架构审查的 6 项阻塞问题修订，整改对照见第 13 节。

## 1. 范围与目标

给长会话加一条贴右侧的提示词导航轨。每一根横杠代表一次用户输入。悬停显示预览，点击跳到该轮对话。

验收口径，不用"快"这类词：

- 从会话底部出发，不滚动正文，只用轨道就能到达任意一次已加载的提问。
- 跳转后目标消息顶部与视口顶部相差不超过 12px。
- 7745 条消息、约 3870 次提问的会话里，轨道 DOM 节点不超过 30 个 tick。

不做的事：

- 不做对话内容搜索。导航按位置，不按关键词。
- 不做多选、书签、批注。
- 不改消息列表的虚拟视口与窗口容量。
- 不引入第三方依赖。
- 第一版不做"加载更早服务端历史"按钮。见第 12 节。

## 2. 现状与约束

### 2.1 现有链路

宿主 `packages/desktop/src/renderer/index.ts` 持有全量消息 `state.messages`，按 `messageWindowStart` 与 `messageWindowEnd` 切片成最多 120 条，交给 `ConversationMessageList` 渲染。见 `index.ts:5946-5964`。

虚拟高度由「总条数乘平均行高」得到，只在总条数超过 120 时启用。见 `index.ts:5939-5943`、`ConversationMessageList.tsx:52,82`。

平均行高在每个会话首次挂载后锁定一次，默认值 96。见 `index.ts:5892-5920`。

滚动容器是 `#conversation-stream`，监听通过属性赋值单点绑定。见 `index.ts:7989`。

窗口搬迁原语已存在，能做到"把窗口搬到某个索引周围"。见 `index.ts:2463-2474`。按索引精确对齐视口的能力不存在，本轮新增。

React 岛模式已经成熟。标题栏、左轨、设置中心、消息列表各自一个 `createRoot`，宿主只在内容变化时推快照。见 `index.ts:6296-6344`、`mount.tsx:27-72`。

### 2.2 硬约束

- 颜色只能用语义 Token，禁止裸写 `#hex` 与 `rgb()`。见 `docs/design-system/README.md:150-151`。
- 滚动容器禁止声明 `transform`。见 `docs/design-system/README.md:164`。
- 会话流禁止 `scroll-behavior: smooth`。见 `docs/design-system/README.md:152-154`。
- 新 UI 组件必须用 React 与 CSS 变量，禁止新增字符串模板式 DOM。见 `docs/design-system/README.md:155-156`。
- `components-react/` 下禁止中文字面量，文案走 i18n。见 `scripts/gates/rules.mjs:228-256`。
- i18n 是扁平字典，中英文必须成对。见 `packages/ui/src/i18n/index.ts:1-6`。
- 单测只跑 `**/*.test.mjs`，见 `package.json:23`。`src/**/*.test.ts` 不会被执test，还会被编进 `dist`。

### 2.3 三个前提及核验结果

1. pod 骨架只整体重建一次。`root.innerHTML` 在 `!bodyContainer` 分支内执行，`renderMiddlePod` 全仓只有一处调用。见 `index.ts:6476-6577`、`index.ts:6487`。host 节点稳定。
2. 滚动只有一个监听点。全仓只有 `streamEl.onscroll = () => {}`，见 `index.ts:7989`。
3. 跳转需要新增精确定位。现有 `syncScrollTopToWindow` 只在视口完全脱离窗口时兜底，不会把某条消息对到视口顶部。见 `index.ts:2489`。

## 3. 候选方案对比

### 候选 A：独立 React 岛，宿主算当前位置（推荐）

在 `renderMiddlePod` 里加一个常驻 host，挂在 pod 层。新增 `mountPromptNavigator`，与标题栏、左轨同构。组件只接收快照。

- 优点：职责干净，组件不碰行高口径；与现有四个 React 岛同构；滚动时组件内部 state 不被重建。
- 缺点：多一个 React 根与一个 update 入口。

### 候选 B：并入 ConversationSnapshot，跟消息列表一起渲染

- 问题：`ConversationMessageList` 挂在 `.conv-canvas` 内，节点在滚动容器里。轨道会滚走，必须 portal 才能固定。
- 问题：快照每次流式提交都重建，轨道跟着整棵 reconcile。

### 候选 C：字符串模板加事件委托

- 否决：违反「新 UI 必须 React」的规则。滚动时替换节点会丢 hover 与焦点。

### 结论

选 A。收益是 host 节点与组件内部 state 稳定，不是"不 reconcile"。快照变化时组件仍会 reconcile，只是树很小。

## 4. 数据模型

```ts
// packages/ui/src/lib/promptNavigator.ts
export interface PromptEntry {
  /** 用户消息 id，同时作为 tick 的业务标识 */
  id: string;
  /** 该消息在 state.messages 中的下标，只用于渲染与位置换算 */
  index: number;
  /** 压成单行的预览，最长 160 字符 */
  preview: string;
}

export interface PromptNavigatorSnapshot {
  prompts: readonly PromptEntry[];
  /** 指向 prompts 的下标，-1 表示尚未定位 */
  activeIndex: number;
  locale?: string;
}

export interface PromptNavigatorActions {
  /** 传消息 id，不传易失下标 */
  onSelect: (messageId: string) => void;
}
```

动作契约只传 id。消息下标会被前置翻页整体平移，见 `index.ts:2926`、`index.ts:2998`，跨边界传下标必然出错。宿主用 id 反查。

第一版不含 `canLoadEarlier`、`isLoadingEarlier`、`onLoadEarlier`。首轮审查指出这三个字段与"不放按钮"的决策矛盾，直接删除。

## 5. 纯函数契约

放 `packages/ui/src/lib/promptNavigator.ts`，零 DOM，可单测。

```ts
export const PROMPT_PREVIEW_MAX_CHARS = 160;
export const RAIL_VISIBLE_TICKS = 30;
export const RAIL_TICK_PITCH_PX = 12;

export function normalizePromptPreview(content: string): string;

export function buildPromptEntries(
  messages: readonly { id: string; role: string; content: string }[],
): PromptEntry[];

export function resolveActivePromptIndex(
  prompts: readonly PromptEntry[],
  messageIndex: number,
): number;

export function planTickWindow(
  total: number,
  activeIndex: number,
  capacity?: number,
): { start: number; end: number; hasMoreAbove: boolean; hasMoreBelow: boolean };

export function tickWidth(
  distance: number,
  isActive: boolean,
  isHighlighted: boolean,
): number;
```

行为约定，每条都要有对应用例：

- `normalizePromptPreview`：所有空白压成一个空格，去首尾，超过 160 截断并补省略号。空内容返回空串。
- `buildPromptEntries`：只保留 `role === 'user'`。`id` 为空或非字符串的条目直接剔除，避免后续选择器匹配到所有空 id 节点。按入参顺序编号，不排序去重。前置条件：`prompts` 按 `index` 严格升序，由本函数保证。
- `resolveActivePromptIndex`：二分查找，返回最后一个 `prompts[i].index <= messageIndex` 的下标。`messageIndex` 非有限数按 0 处理，小于首条返回 0，大于末条返回最后一条，空数组返回 -1。
- `planTickWindow`：`capacity` 非正数时取 `RAIL_VISIBLE_TICKS`。`total === 0` 返回 `{start:0,end:0,hasMoreAbove:false,hasMoreBelow:false}`。`activeIndex < 0` 或越界时按 `total - 1` 处理。`total <= capacity` 时窗口覆盖全部。否则 `start` 夹在 `0` 与 `total - capacity` 之间，让当前项尽量居中。`hasMoreAbove = start > 0`，`hasMoreBelow = end < total`。
- `tickWidth`：基准 10px，当前项 14px，悬停 20px。距离衰减表 `[1, 0.6, 0.35, 0.15]`，距离 4 及以上归零。

宿主的滚动换算放 `packages/desktop/src/renderer/promptNavigator.ts`，同样不依赖 DOM：

```ts
export function promptMessageIndexAtScrollTop(input: {
  scrollTop: number;
  rowHeight: number;
  paddingTop: number;
  readLinePx: number;
  total: number;
}): number;

/** 从同一条消息的多个节点矩形里取最靠上的可见 top。 */
export function topmostRectTop(rects: readonly { top: number; height: number }[]): number | null;

export function shouldRebuildPromptIndex(input: {
  sessionId: string;
  currentSessionId: string;
  cachedMessagesRef: readonly unknown[] | null;
  messagesRef: readonly unknown[];
}): boolean;
```

`promptMessageIndexAtScrollTop` 同时覆盖虚拟化与非虚拟化两种情况。非虚拟化时窗口起点恒为 0，公式相同。公式为 `floor(max(0, scrollTop - paddingTop + readLinePx) / rowHeight)`，最后 `clamp(0, total - 1)`。`rowHeight` 小于 1 时按 96 处理。

`paddingTop` 取 `.conv-stream` 的 `padding-top`，当前是 24px，见 `conversation.css:29`、`conversation.css:92`。宿主读一次 `getComputedStyle` 并缓存，切换皮肤不需要重读。

## 6. 组件契约

`packages/ui/src/components-react/conversation/PromptNavigatorRail.tsx`。

```tsx
export interface PromptNavigatorRailProps {
  snapshot: PromptNavigatorSnapshot;
  actions: PromptNavigatorActions;
  capacity?: number;
}
```

### 6.1 结构

五层：

1. `nav`，绝对定位在 pod 右侧垂直居中，`pointer-events: none`，`aria-label` 走 i18n。
2. `gutter`，可交互命中面，`role="listbox"`，`tabIndex={0}`，`aria-activedescendant` 指向当前高亮 tick。高度严格等于 `visibleCount * 12`。
3. `tape`，在 gutter 内，用 `translateY(-start * 12)` 滑动窗口。`key` 取 `prompts[0]?.id`，避免插入新消息时播放一次假滑行。
4. `tick`，绝对定位在 tape 上，`role="option"`，`aria-current` 标记当前项，`aria-label` 是预览文本，自身 `pointer-events: none`。
5. `panel`，悬停时出现在轨道左侧，是全部 prompt 的可滚列表。面板是 gutter 的子节点，和参考实现一致。四条事件边界必须写死：面板的 `mousemove` 与 `click` 一律 `stopPropagation`，避免冒泡到 gutter 的指针换算；`wheel` 不能用 React 的 `onWheel`，React 17 起在根容器上以 passive 方式注册，`preventDefault` 无效。必须在 `useEffect` 里用 `panel.addEventListener('wheel', handler, { passive: false })`，handler 内先 `preventDefault` 再 `stopPropagation`；面板 `mouseenter` 取消收起定时器并调 `stopCarousel()`，`mouseleave` 重新计时；面板本身不是原生滚动容器，用 `overflow: hidden` 加绝对定位加遮罩，滚轮按 40px 步进改写 `translateY`。

第一版不用 overscan。30 条 tick 就是渲染上限，`planTickWindow` 的 `end - start` 不得超过 `capacity`。

### 6.2 窗口外的可达性，两条通路都必须有

首轮审查的阻塞项指出，只靠 30 个可见 tick 加当前项居中，约 3870 次提问里只能点到周围 15 条。两条通路补齐：

**边缘轮播（carousel）。** 指针进入 gutter 上下 18px 热区后，每 80ms 步进一条，`hasMoreAbove` 与 `hasMoreBelow` 为假时停。离开热区或卸载时清除定时器。步进时同步把 `highlightedIndex` 平移到指针所在的相对位置，避免高亮与 tick 脱节。

**面板全量列表。** 面板不是单条预览，而是最多 8 行可见的滚动列表，行高 40px。滚轮以非被动监听接管，一步滚一行，不滚正文。高亮行始终保留上下 2 行上下文，只有贴近边缘才滑动。这样窗口外的提问也能被悬停、预览、点击。

`planTickWindow` 返回的两个 `hasMore` 布尔值同时喂给遮罩渐变与 carousel，和参考实现一致。

### 6.3 位置与高亮优先级

- `highlightedIndex !== null` 时，tape 不跟随 `activeIndex`，用户正在浏览就不打扰。但 tape 必须跟随 `highlightedIndex`：任何一次高亮移动，包括方向键、Home、End、轮播步进，都先调 `ensureWindowContains(next)` 把目标滚进窗口，再设置高亮。否则高亮会落到未渲染的 tick 上，`aria-activedescendant` 指向不存在的节点，按键表现为无反应。
- 否则 tape 让 `activeIndex` 尽量居中。
- `prompts` 引用变化且长度增加时，平移 `windowStart` 与 `highlightedIndex`，不收起面板。参考实现同一策略，见 `PromptNavigatorRail.tsx:179-193`。
- 指针离开 gutter 后延迟 160ms 收起面板，允许指针横移进面板。

### 6.4 命中带宽度

参考实现的两档是「常规 28px，消息列压到 gutter 底下时缩到 12px」，不是 96px 视觉加宽命中。Hermes 的 `.conv-canvas` 最大宽 1024px 居中，见 `conversation.css:104`。中间舱 1100px 时两侧只留 38px，96px 命中带会压住正文右缘约 58px，吞掉文本选择、代码块横向滚动与气泡右缘点击。

规则：gutter 宽 28px，命中带就是 28px。组件只观察稳定祖先 `.flux-middle-pod`，因为 `#conversation-stream` 内的 `.conv-canvas` 会被 `activeStream.innerHTML = renderConversationCanvas(...)` 整节点替换，见 `index.ts:6794`，绑在旧节点上的观察器会永久失效。每次回调内部重新 `container.querySelector('.conv-canvas')`，查不到就直接返回。取画布右边界与 pod 右边界的间距，小于 40px 时切到 12px。切换只改宽度，不改 tick 几何。

### 6.5 无障碍

- `nav` 有 `aria-label`。
- `gutter` 是 `listbox`，`tabIndex=0`，`aria-activedescendant` 指向高亮项。
- 每个 tick 是 `option`，带 `aria-selected`、`aria-current`、`aria-label`。
- 方向键上下移动高亮，每次移动先 `ensureWindowContains` 再改写 `highlightedIndex`。`Enter` 或空格选中，`Esc` 退出并收起面板。
- 装饰性的横杠本身 `aria-hidden`。

第一版不做全局快捷键。参考实现的 `mod+k n` 依赖命令面板体系，Hermes 没有。

## 7. 宿主接线与状态归属

### 7.1 模块拆分

宿主侧可单测的纯逻辑必须独立成模块，照 `messageWindow.ts` 与 `conversationPush.ts` 的先例。见 `build.mjs:136-147`。

- `packages/desktop/src/renderer/promptNavigator.ts`：第 5 节末尾的三个函数。
- 在 `build.mjs` 的模块列表里追加 `promptNavigator`，让它产出 `dist/renderer/promptNavigator.mjs`。
- `index.ts` 只做接线，不放可测逻辑。

### 7.2 模块级状态

```ts
const PROMPT_READ_LINE_PX = 100;
let promptNavigatorSnapshot: PromptNavigatorSnapshot | null = null;
let promptNavigatorEntries: PromptEntry[] = [];
let promptNavigatorCache: { sessionId: string; messagesRef: readonly unknown[] } | null = null;
let lastPromptNavigatorSnapshot: PromptNavigatorSnapshot | null = null;
let updateReactPromptNavigator: (() => void) | null = null;
let promptJumpSeq = 0;
let promptJumpSettling = false;
let streamPaddingTopPx = 24;
```

`streamPaddingTopPx` 在首帧从 `.conv-stream` 的 `getComputedStyle` 读一次，见 `conversation.css:29`。`PROMPT_READ_LINE_PX` 注释必须写明它和 48px 贴底跟随阈值无关，禁止合并。

缓存 key 用「会话 id 加消息数组引用」，不用长度加末条 id。等长替换是真实场景，见 `index.ts:3238`、`index.ts:3347`。命中时返回同一个 `entries` 引用，组件不会因为新数组而平移或收起面板。

### 7.3 挂载

host 放在 `.flux-middle-pod` 下，`#conversation-stream` 之后，dock 之前。两条禁令：

- 不能挂进 `#conversation-stream`。`activeStream.innerHTML = renderConversationCanvas(...)` 会整体替换它，见 `index.ts:6794`。
- host 不能被任何 `innerHTML` 或 `outerHTML` 当作目标。

挂载代码插在 `mountReactShellComponents` 末尾的 `syncReactMessageList()` 之后，见 `index.ts:6347`。放在它之前的话，首帧 host 已存在但消息列表还没建，快照读到的窗口信息是旧的。

```ts
const navHost = document.getElementById('react-prompt-navigator-host');
if (navHost && !updateReactPromptNavigator) {
  updateReactPromptNavigator = mountPromptNavigator(navHost, getPromptNavigatorSnapshot, createPromptNavigatorActions());
}
syncPromptNavigator();

function syncPromptNavigator(): void {
  if (!updateReactPromptNavigator) return;
  const snapshot = getPromptNavigatorSnapshot();
  if (snapshot === lastPromptNavigatorSnapshot) return;
  lastPromptNavigatorSnapshot = snapshot;
  updateReactPromptNavigator();
}
```

推送只有 `syncPromptNavigator` 一个入口。当前位置、重建、跳转完成后都调它。

`getPromptNavigatorSnapshot()` 只返回模块级 `promptNavigatorSnapshot`，为 null 时返回一个冻结的空快照常量。禁止在这个函数里构造新对象。否则每次 `render()` 都会产生新引用，去重失效，每个 render 推一次 React 岛。

新快照只能由 `syncPromptNavigatorFromScroll` 与重建路径产生，且必须复用同一个 `prompts` 引用。

### 7.4 当前位置

在 `streamEl.onscroll` 的**第一行**调用 `syncPromptNavigatorFromScroll()`，位置在 `index.ts:7990` 之前。理由：这个 handler 有 6 处 `return`，冷却期与加载期会早退，见 `index.ts:7996`、`index.ts:8013`、`index.ts:8036`、`index.ts:8052`、`index.ts:8062`、`index.ts:8067`。写在中段会让导航位置在每次扩窗、滑动、跳转后冻结。

```ts
function syncPromptNavigatorFromScroll(): void {
  if (promptNavigatorEntries.length === 0) return;
  // 重建与位置计算必须同一会话，否则会话切换瞬间会拿新会话的 total 去算旧会话的 entries。
  if (promptNavigatorCache?.sessionId !== state.activeSessionId) return;
  const total = state.messages.length;
  if (total <= 0) return;
  const stream = document.getElementById('conversation-stream');
  if (!stream) return;
  const messageIndex = promptMessageIndexAtScrollTop({
    scrollTop: stream.scrollTop,
    rowHeight: averageRowHeightPx,
    paddingTop: streamPaddingTopPx,
    readLinePx: PROMPT_READ_LINE_PX,
    total,
  });
  const next = resolveActivePromptIndex(promptNavigatorEntries, messageIndex);
  if (next === (promptNavigatorSnapshot?.activeIndex ?? -1)) return;
  promptNavigatorSnapshot = { prompts: promptNavigatorEntries, activeIndex: next, locale: state.lang };
  syncPromptNavigator();
}
```

只有跨过一条 prompt 才换快照引用，滚动过程本身不触发 React 更新。

`lockAverageRowHeight()` 返回 true 的分支里也要调用一次。首轮审查指出，锁定行高时只重算虚拟高度与占位，没有重算当前位置，见 `index.ts:2504-2520`。若 `scrollTop` 已在底部，不会再产生 scroll 事件，导航会一直停在 96 的口径。

`PROMPT_READ_LINE_PX = 100`，注释必须写明它和 48px 贴底跟随阈值无关，禁止合并。

### 7.5 跳转

```ts
function jumpToPrompt(messageId: string): void {
  const index = state.messages.findIndex((m) => m.id === messageId);
  if (index < 0) return;

  promptJumpSeq += 1;
  const seq = promptJumpSeq;
  promptJumpSettling = true;
  suppressPinBottomOnce = true;
  streamScrollCooldown = true;
  // 语义上读者已离开尾部，掐掉 scheduleVirtualHeightSync 里的 scrollStreamToBottom。
  messageWindowUserExpanded = true;
  relocateMessageWindowToIndex(index);
  canvasStructureDirty = true;
  render();
  settlePromptJump(messageId, seq, 0, 0);
}

function settlePromptJump(messageId: string, seq: number, attempt: number, wait: number): void {
  requestAnimationFrame(() => {
    if (seq !== promptJumpSeq) return;
    // 跳转途中切会话或回滚时目标可能已不存在，每帧按 id 重查，不用入场时的下标。
    const index = state.messages.findIndex((m) => m.id === messageId);
    if (index < 0) {
      releasePromptJump(seq);
      return;
    }
    // 行高锁定帧会嵌套一次 render 并安排 stabilizeStreamAnchor，等它落定再定位。
    if (!averageRowHeightLocked && wait < 8) {
      settlePromptJump(messageId, seq, attempt, wait + 1);
      return;
    }
    const stream = document.getElementById('conversation-stream');
    if (!stream) {
      releasePromptJump(seq);
      return;
    }
    if (attempt === 0) {
      const rough = index * averageRowHeightPx;
      stream.scrollTop = Math.max(0, Math.min(rough, stream.scrollHeight - stream.clientHeight));
    }
    const nodes = stream.querySelectorAll<HTMLElement>(`[data-msg-id="${CSS.escape(messageId)}"]`);
    const top = topmostRectTop(Array.from(nodes, (node) => node.getBoundingClientRect()));
    if (top !== null) {
      const delta = top - stream.getBoundingClientRect().top;
      stream.scrollTop += delta - 12;
      syncPromptNavigatorFromScroll();
      releasePromptJump(seq);
      return;
    }
    if (attempt < 8) {
      settlePromptJump(messageId, seq, attempt + 1, wait);
      return;
    }
    logScroll.warn('prompt jump target not mounted', { messageId, attempt });
    releasePromptJump(seq);
  });
}

/**
 * 延迟一帧释放两个标志。
 * 锁定行高那一帧会再注册一次尾随锚点校正，它在下一帧运行；
 * 提前释放会让 stabilizeStreamAnchor 把刚写入的位移按反数抵消。
 * 自身写出的 scroll 事件也在下一帧派发，冷却锁必须活到那时，否则会触发一次多余扩窗。
 */
function releasePromptJump(seq: number): void {
  requestAnimationFrame(() => {
    if (seq !== promptJumpSeq) return;
    promptJumpSettling = false;
    streamScrollCooldown = false;
  });
}
```

九条要点，每条对应一个已知缺陷：

- 用 id 反查下标，而且每帧都查。前置翻页会把历史插到数组头，闭包里的下标已经失效，见 `index.ts:2926`、`index.ts:2998`。跳转途中切会话时目标可能已不在数组里，直接释放。
- `releasePromptJump` 延迟一帧释放 `promptJumpSettling` 与 `streamScrollCooldown`。锁定帧的尾随锚点校正与自身写出的 scroll 事件都在下一帧运行，提前释放会让前者抵消位移，后者触发一次多余扩窗。
- `promptJumpSeq` 丢弃迟到回调。连点两根 tick 时，先到的 rAF 不能覆盖后一次跳转。
- `suppressPinBottomOnce = true`。否则贴底读者会先被拉到 `scrollHeight` 再跳回，闪两帧。既有范式见 `index.ts:2419`。
- `messageWindowUserExpanded = true`。目标已在窗口内时 `relocateMessageWindowToIndex` 返回 false，不会置这个标志，见 `index.ts:2468-2471`。锁定行高的 rAF 随后会调 `scrollStreamToBottom`，见 `index.ts:2516-2518`，把跳转改成回到底部。切会话后立刻点 tick 必中。
- `promptJumpSettling` 屏蔽 render 自带的两个锚点写入者。`applyStreamAnchor` 与 `stabilizeStreamAnchor` 首行各加 `if (promptJumpSettling) return;`。它们用的是跳转前捕获的锚点，见 `index.ts:6376`、`index.ts:6845-6852`，会把 settle 写入的位移按反数抵消。
- 等行高锁定后再定位。锁定帧会嵌套 render 与锚点校正，先落定再写。
- `streamScrollCooldown = true`。跳转落点必然命中向上扩窗判定，见 `index.ts:8046-8058`，会多触发一次 `expandMessageWindow()` 与全量 `render()`。
- 最多 8 帧重试。仓库自己记录过单次 rAF 会错过 React 提交，见 `index.ts:2496-2502`。超限显式告警，不静默放弃。
- 多节点取最上矩形。一条消息会渲染出多个 `data-msg-id` 节点：行本体在 `MessageRow.tsx:72` 与 `MessageRow.tsx:113`，页脚操作按钮在 `MessageFooter.tsx:92`。按钮的 top 恒大于行本体，取最小即行本体。

`canvasStructureDirty` 在 `relocateMessageWindowToIndex` 内部已经置位，见 `index.ts:2472`，外层不必再置。

### 7.6 会话切换与回滚

`promptNavigatorCache.sessionId` 或 `messagesRef` 变化时整表重建。回滚导致数组替换同样命中。

重建后不能一律取末条。前置翻页每次都会返回新数组，见 `packages/core/src/session/olderBatchMerge.ts` 的 `planOlderBatchPrependMerge`，向上加载一次历史就触发一次重建。若取末条，读者停在顶部，轨道窗口与高亮会整体跳到末尾，而且不会自愈：该路径的锚点补偿在虚拟坐标下约为 0，见 `index.ts:5457-5461`，`syncScrollTopToWindow` 又只在视口脱离窗口时才写，见 `index.ts:2489`，都不会产生新的 scroll 事件。

规则：切会话时 `activeIndex` 取末条。其余重建一律在重建末尾直接调一次 `syncPromptNavigatorFromScroll()`，按当前 `scrollTop` 重算。判定依据是 `promptNavigatorCache.sessionId !== state.activeSessionId`，在重建前先记住这个布尔。

写入顺序固定：重建只写 `promptNavigatorEntries` 与 `promptNavigatorCache`。`activeIndex` 一律只由 `syncPromptNavigatorFromScroll()` 写。重建函数不得先算一个 `activeIndex` 再返回快照，否则会被随后的同步调用覆盖。

## 8. 影响与改动清单

### 新增文件

| 文件 | 职责 |
|---|---|
| `packages/ui/src/lib/promptNavigator.ts` | 类型与五个纯函数 |
| `packages/ui/src/components-react/conversation/PromptNavigatorRail.tsx` | 轨道、轮播、悬停面板 |
| `packages/ui/__tests__/prompt-navigator-model.test.mjs` | 纯函数单测，从 `../dist/lib/promptNavigator.js` 导入 |
| `packages/desktop/src/renderer/promptNavigator.ts` | 滚动换算、矩形取顶、缓存判定 |
| `packages/desktop/__tests__/unit/prompt-navigator.test.mjs` | 宿主纯逻辑单测，从 `../../dist/renderer/promptNavigator.mjs` 导入 |

### 修改文件

| 文件 | 改动 | 风险 |
|---|---|---|
| `packages/ui/src/components/MiddlePod/MiddlePod.ts` | `renderMiddlePod` 增加 host，位置在 stream 之后、dock 之前 | 低 |
| `packages/ui/src/components-react/conversation/mount.tsx` | 新增 `mountPromptNavigator` | 低 |
| `packages/ui/src/components-react/conversation/index.ts` | 导出组件与类型 | 低 |
| `packages/ui/src/index.ts` | 追加 `export * from './lib/promptNavigator.js';`，宿主只从 barrel 导入 | 低 |
| `packages/ui/src/styles/conversation.css` | 新增 `.conv-prompt-rail` 系列，含面板几何与 z-index | 中 |
| `packages/ui/src/i18n/index.ts` | 新增 3 个 key，中英各一份 | 低 |
| `packages/desktop/scripts/build.mjs` | 模块列表追加 `promptNavigator` | 低 |
| `packages/desktop/src/renderer/index.ts` | 快照、缓存、当前位置、跳转、挂载、滚动钩子 | 中 |

### i18n 键

| 键 | 中文 | 英文 |
|---|---|---|
| `conversation.promptNavigator.aria` | 提示词导航 | Prompt navigator |
| `conversation.promptNavigator.currentPrompt` | 当前提示 | Current prompt |
| `conversation.promptNavigator.emptyPreview` | 空内容 | Empty message |

### 调用链

`streamEl.onscroll` 第一行调用 `syncPromptNavigatorFromScroll`，读 `averageRowHeightPx` 与 `promptNavigatorEntries`，写快照，调用 React 的 `update`。点击走 `jumpToPrompt`，改写窗口与 `scrollTop`，再回写一次快照。全程纯内存，不碰网关、缓存服务与持久化。

## 9. 样式映射

| 参考实现 | Hermes Flux | 说明 |
|---|---|---|
| gutter 28px，窄列 12px | `28px`，间距小于 40px 时 `12px` | 两档自适应，不做 96px 命中带 |
| tick 高 2px | `2px` | 视觉一致 |
| tick 宽 10 / 14 / 20 | `10px` / `14px` / `20px` | 三档 |
| 间距 12px | `var(--conv-rail-pitch, 12px)` | TS 常量与 CSS 变量同源 |
| 常规横杠 | `var(--muted-foreground)` | 语义 Token；禁止用前景百分比混色，浅色皮肤会掉到 2:1 以下 |
| 悬停横杠 | `var(--secondary-foreground)` | 三档中最中间的一档 |
| 当前横杠 | `var(--foreground)` | 实心 |
| 面板表面 | `var(--popover)` + `1px var(--border)` + `var(--shadow-window)` + `var(--specular-line)` | L4 浮层；`--shadow-card` 在两个浅色皮肤自带 `0 0 0 1px` 描边，与 border 并存会叠成双线，故用 `--shadow-window`；受光线只能进 box-shadow，写 border-color 会被整条丢弃 |
| 面板宽 | `min(20rem, calc(100vw - 7rem))` | 夹住视口 |
| 面板行高 | `40px`（8pt 网格整数倍），可见 8 行 | 行内只留预览正文，不加序号 |
| 面板内缩 | `8px` | `--conv-prompt-panel-pad`，走 8pt 网格；行内再让 8px，文字左缘合计 16px |
| 列表行 | 常规 `var(--secondary-foreground)`，悬停/当前 `var(--foreground)` | 悬停 7% 前景混色底，当前 2px 左侧条 |
| 面板文字 | `var(--conv-meta-size)` | 禁止内联字号，见 `rules.mjs:708-719` |
| 遮罩 | `linear-gradient` 上下 24px | 有更多项时显示 |
| 过渡 | `120ms` 变宽与面板进场，`200ms` 滑行 | 设计系统 120 进 200 出 |

z-index：轨道 `20`，面板 `30`。底部遮罩是 `10`，见 `conversation.css:123`。dock 由宿主 `insertAdjacentHTML` 追加在 pod 末尾，见 `index.ts:6709-6710`。轨道必须在 dock 之前插入，否则会被 dock 盖住。

隐藏条件：

- `prompts.length < 2` 不渲染。
- 媒体查询 `max-width: 720px` 不渲染。
- 未连接或会话为空时快照直接给空数组。

## 10. 测试与验收

### 10.1 维度预扫描

| 维度 | 相关性 | 说明 |
|---|---|---|
| D1 输入完整性 | 相关 | 空消息、空内容、超长、空 id |
| D2 业务规则 | 相关 | 只取 user、截断、窗口容量、当前项归属 |
| D3 状态流转 | 相关 | 跨条、窗口滑动、会话切换、回滚 |
| D4 数据依赖 | 相关 | 全量与切片、缓存命中与失效 |
| D5 环境依赖 | N/A | 纯前端，无网络 |
| D6 权限与安全 | 相关 | 预览注入、选择器转义 |
| D7 并发与时序 | 相关 | 流式追加、跳转连点、rAF 迟到 |
| D8 非功能 | 相关 | DOM 上限、滚动不更新 |
| D9 数据一致性 | 相关 | 下标与消息数组同源 |

### 10.2 可落盘单测

`packages/ui/__tests__/prompt-navigator-model.test.mjs`，覆盖 TC-001 至 TC-016、TC-020、TC-024、TC-025。

`packages/desktop/__tests__/unit/prompt-navigator.test.mjs`，覆盖 TC-017 至 TC-019、TC-021 至 TC-023。

TC-026 与 TC-027 需要 React 渲染计数与真实 DOM，放 10.4 的 CDP 验收。

| 编号 | 用例 | 类型 | 优先级 |
|---|---|---|---|
| TC-001 | 三条用户加两条助手，只产出三条 prompt | 正向 | P0 |
| TC-002 | 空数组返回空数组 | 边界 | P0 |
| TC-003 | 预览压空白并截断到 160 | 正向 | P0 |
| TC-004 | 空内容返回空预览 | 边界 | P1 |
| TC-005 | 下标落在两条之间，归属前一条 | 正向 | P0 |
| TC-006 | 下标小于首条，返回 0 | 边界 | P1 |
| TC-007 | 空 prompts 返回 -1 | 边界 | P0 |
| TC-008 | 总数小于容量，窗口覆盖全部 | 边界 | P0 |
| TC-009 | 总数等于容量，窗口不越界 | 边界 | P1 |
| TC-010 | 总数大于容量且当前项居中 | 正向 | P0 |
| TC-011 | 当前项在首条，`hasMoreAbove=false` | 边界 | P1 |
| TC-012 | 当前项在末条，`hasMoreBelow=false` | 边界 | P1 |
| TC-013 | 宽度衰减在距离 0 到 4 的取值 | 正向 | P1 |
| TC-014 | 当前 14、悬停 20、普通 10 | 正向 | P1 |
| TC-015 | 预览含尖括号与引号时按纯文本输出 | 攻击 | P0 |
| TC-016 | 空 id 条目被剔除 | 攻击 | P1 |
| TC-017 | 流式追加助手消息不重建 prompt 表 | 组合 | P0 |
| TC-018 | 等长替换消息数组时重建 prompt 表 | 组合 | P1 |
| TC-019 | 切会话后当前项回到末条 | 组合 | P0 |
| TC-020 | 38 条 prompt 时窗口长度不超过容量 30 | 非功能 | P1 |
| TC-021 | 同一会话与同一数组引用连续判定 1000 次都返回不重建 | 非功能 | P1 |
| TC-022 | 同一条消息多个矩形时取最上 | 边界 | P1 |
| TC-023 | 非虚拟化的 120 条会话里滚动换算正确 | 组合 | P1 |
| TC-024 | 窗口容量为 1 时窗口恒等于当前项 | 边界 | P2 |
| TC-025 | `activeIndex=-1` 时窗口对齐末条 | 边界 | P1 |
| TC-026 | 连续滚动 1000 次、跨越 0 条 prompt 时轨道 React 提交数为 0 | 非功能 | P1 |
| TC-027 | 7745 条会话里 tick 节点数不超过 30 | 非功能 | P1 |

### 10.3 覆盖矩阵

| 维度 | 覆盖项 | 用例 |
|---|---|---|
| D1 | 空数组、空内容、超长、空 id | TC-002、TC-004、TC-003、TC-016 |
| D2 | 只取 user、截断、容量、归属 | TC-001、TC-003、TC-008 至 TC-012、TC-005、TC-020 |
| D3 | 跨条、滑动、切会话、回滚 | TC-005、TC-010、TC-019、TC-018 |
| D4 | 全量与切片、缓存 | TC-017、TC-018、TC-023 |
| D6 | 注入、选择器转义 | TC-015、TC-016 |
| D7 | 流式追加、跳转竞态 | TC-017、TC-022 |
| D8 | DOM 上限、滚动不更新 | TC-020、TC-021、TC-026、TC-027 |
| D9 | 下标同源、多节点取顶 | TC-001、TC-022 |

关键覆盖 P0 与 P1 共 26 条，全覆盖。P2 共 1 条，覆盖 1 条。关键覆盖率 100%，普通覆盖率 100%。

### 10.4 物理验收

单测覆盖不到几何、命中带与遮挡。按 ENGINEERING_DISCIPLINE 的零假冒交付，补一轮 CDP 验收，参照 `packages/desktop/__tests__/cdp/conversation-perf-cdp.test.mjs` 与 `verify-hermes-flux` skill。

必须采集六项证据：

1. 轨道宽度为 28px，窄列窗口下为 12px。
2. 轨道命中带不覆盖 `.conv-canvas` 右缘，正文右缘 8px 内点击可选中文本。
3. 悬停面板可见 8 行，滚轮滚面板不滚正文。
4. 从底部跳到第 1 条与第 2000 条 prompt，视口差不超过 12px，且不出现两帧闪跳。
5. 连续滚动 1000 次，跨越 0 条 prompt 时轨道的 React 提交计数为 0。
6. 7745 条会话里 tick 节点数不超过 30，滑动轨道时命中带宽度不抖动。

## 11. 风险与回滚

| 风险 | 触发条件 | 应对 |
|---|---|---|
| 行高估算导致落点偏移 | 消息高度差异大 | 8 帧重试加 DOM 实测校正 |
| 滚动热路径变重 | 每次 scroll 都重建快照 | 跨条才换引用，TC-021 用计数器断言 |
| 内存增长 | 5000 条消息全量预览 | 每条截断 160 字符，按会话失效 |
| 跳转触发全量重渲 | 120 行 React 树加 Markdown 复算 | 与拖滚动条跳转同构，可接受；已上冷却锁 |
| 与输入舱遮挡 | 轨道与 dock 同层 | host 插在 dock 之前，轨道 z-index 20 |
| 预览注入 | 用户输入含 HTML | React 文本节点，不拼 HTML |
| 回滚后索引错位 | 数组变短或等长替换 | 缓存 key 含数组引用 |
| 窄列吞点击 | 视口 1100px 左右 | 28px 与 12px 自适应 |

回滚方案：删除新增文件与 host 节点，移除 `syncPromptNavigatorFromScroll` 调用与 `build.mjs` 登记。不触碰消息窗口、虚拟高度与滚动锚定。

## 12. 开放决策

1. 「加载更早服务端历史」按钮不进第一版。`state.hasOlderMessages` 的语义是服务端还有更早，不是本地未挂载。放了会让用户以为能看到缓存里的内容。
2. 群聊模式是否显示。建议显示，每条用户消息仍然唯一。若产品认为多 Agent 发言让「当前轮」不唯一，可先隐藏。
3. 全局快捷键不做。Hermes 没有统一命令面板，单独加一个 `mod+k n` 会与输入框快捷键冲突。

## 13. 首轮审查整改对照

| 阻塞项 | 处置 |
|---|---|
| 窗口外不可达 | 第 6.2 节补边缘轮播与面板全量滚动，`planTickWindow` 返回两个 `hasMore` |
| 96px 命中带吞正文 | 第 6.4 节改 28px 与 12px 两档，ResizeObserver 判窄列 |
| 测试放 `src/**/*.test.ts` 不执行还进 dist | 第 8 节改放 `__tests__/*.test.mjs`，从 `dist` 导入 |
| 宿主逻辑不可测、漏 `build.mjs` | 第 7.1 节抽 `src/renderer/promptNavigator.ts`，第 8 节登记 |
| 契约空洞 | 第 5 节补齐 `-1`、越界、`capacity`、升序、空 id、`tickWidth` 三参 |
| 跳转三处缺陷 | 第 7.5 节按 id 反查、序列守卫、8 帧重试、`suppressPin`、冷却锁、最上矩形 |

其余重要问题已并入正文：onscroll 第一行执行、锁定行高后重算、缓存用数组引用、无障碍契约、i18n 键清单、面板几何与 z-index、非虚拟化分支、padding 补偿、CDP 验收。

## 14. 复审整改对照

| 复审问题 | 处置 |
|---|---|
| P0-1 前置翻页把指示器甩到底部 | 第 7.6 节改为重建后按 `scrollTop` 重算，只有切会话取末条 |
| P0-2 跳转被 render 的写链改写 | 第 7.5 节加 `messageWindowUserExpanded`、`promptJumpSettling`、等行高锁定再定位 |
| P1-1 面板事件边界未定义 | 第 6.1 节写死父子关系、`stopPropagation`、收起定时器 |
| P1-2 漏 barrel 导出 | 第 8 节补 `packages/ui/src/index.ts` |
| P1-3 ResizeObserver 绑在会被替换的节点 | 第 6.4 节只观察稳定祖先，回调内重查画布 |
| P1-4 TC-021 无法在单测落地 | 第 10.2 节改断言对象，渲染计数移到 CDP |
| P1-5 DOM 上限 34 与 30 不一致且缺用例 | 第 1 节改 30，恢复 TC-020 与 TC-027 |
| P1-6 键盘把高亮移到窗口外 | 第 6.3 与 6.5 节加 `ensureWindowContains` |
| P2-1 常量与状态未登记 | 第 7.2 节补 `PROMPT_READ_LINE_PX`、`streamPaddingTopPx`、`promptJumpSettling` |
| P2-2 `syncPromptNavigator` 未定义 | 第 7.3 节抽成具名函数，全篇单一推送入口 |
| P2-3 会话切换瞬间算错位置 | 第 7.4 节加会话守卫 |

终审又提出 3 项 P1 与 4 项 P2，同样已并入正文：

| 终审问题 | 处置 |
|---|---|
| P1-A 标志清除早一帧，锁定帧锚点会抵消跳转 | 第 7.5 节抽 `releasePromptJump`，延迟一帧释放并带序列守卫 |
| P1-B 快照引用未写死，TC-026 会失效 | 第 7.3 节规定只返回模块级引用 |
| P1-C `wheel` 缺 `preventDefault`，会同时滚正文 | 第 6.1 节改原生非被动监听 |
| P2-A 跳转途中切会话 | 第 7.5 节每帧按 id 重查 |
| P2-B TC-024 归属与 D7 映射 | 第 10.2 与 10.3 节修正 |
| P2-C 面板未停轮播 | 第 6.1 节 `mouseenter` 调 `stopCarousel` |
| P2-D 重建写入顺序 | 第 7.6 节写死只写 entries 与 cache |
