# Agent 在场指示器 · 实施规格（供实现/测试/评审使用）

> 分支：`feat/agent-presence-indicator`
> 设计依据：同目录 `design.md`（**已定案，不再讨论视觉**）
> 本文是**唯一实现契约**。实现方不得自行改视觉、改命名、改数据形状；发现契约有硬伤必须先报告，不得静默偏离。

---

## 零、当前进度（不要重复做）

已完成且测试通过：

- `packages/core/src/agent/agentPresence.ts` — 纯函数模块（`deriveAgentPresence` / `presenceTone` / `classifyPresenceTool` / `nextBlinkDelayMs` / `BLINK_MIN_INTERVAL_MS` / `BLINK_MAX_INTERVAL_MS`）
- `packages/core/__tests__/agent/agentPresence.test.mjs` — 45 条断言，`node --test` 全绿

**待做**：core 桶导出、共享头像原语扩展、`ui` 组件与样式与 i18n、`ui` 挂载桥、`desktop` 宿主装配与旧真值面删除、ui 层测试、双审。

---

## 一、环境与命令（本 worktree 特有，务必先看）

本 worktree 用 **bun** 装的依赖，`npm run` 在 PowerShell 下被执行策略拦截。**必须用下列等价命令**：

```bash
# 构建 core
node node_modules/typescript/lib/tsc.js --build packages/core/tsconfig.json

# 构建 ui
node node_modules/typescript/lib/tsc.js --build packages/ui/tsconfig.json

# 构建 desktop（含 css 拷贝与 tailwind）
node packages/desktop/scripts/build.mjs

# 跑单测（ui 测试读 dist，必须先构建）
node --test packages/core/__tests__/agent/agentPresence.test.mjs
node --test packages/ui/__tests__/agent-presence.test.mjs

# 门禁（只扫改动集）
node scripts/gates/run.mjs --changed
```

**不要**执行 `npm install`（`workspace:*` 协议会报 EUNSUPPORTEDPROTOCOL），依赖已就绪。

---

## 二、core：补桶导出

文件：`packages/core/src/index.ts`

在 `export * from './session/activityState.js';` 附近新增一行：

```ts
export * from './agent/agentPresence.js';
```

验收：`node node_modules/typescript/lib/tsc.js --build packages/core/tsconfig.json` 无输出。

---

## 三、共享头像原语：加形状参数（唯一实现，禁止另写）

文件：`packages/ui/src/utils/botAvatar.ts`

`renderBotAvatar` 增加第 5 个可选参数：

```ts
export function renderBotAvatar(
  name: string,
  displayName?: string,
  avatarUrl?: string,
  size = 36,
  shape: 'rounded' | 'circle' = 'rounded',
): string
```

改动点：

1. `avatarUrl` 分支：`border-radius` 按 `shape === 'circle' ? '50%' : '8px'`。
2. 确定性图腾分支：外层 `<rect width="36" height="36" rx="8" .../>` 的 `rx` 按 `shape === 'circle' ? 18 : 8`。
3. 三角形（`xiaofawang`）分支不动——它本身是三角形，圆形裁切会削掉尖角。

**约束**：默认值 `'rounded'` 保证左轨、标题栏、群聊拼图等既有消费者零行为变化。禁止复制出第二个头像函数。

---

## 四、ui 组件

### 4.1 文件与导出

新建 `packages/ui/src/components-react/AgentPresence.tsx`，导出：

```ts
export interface AgentPresenceIdentitySolo {
  kind: 'solo';
  name: string;
  displayName?: string;
  avatar?: string;
}

export interface AgentPresenceIdentityGroup {
  kind: 'group';
  members: string[];
  /** 当前说话者；null 表示未知，必须走降级（不高亮、不加前缀） */
  speaker: string | null;
  profiles: Array<{ name: string; displayName?: string; avatar?: string }>;
}

export interface AgentPresenceSnapshot {
  presence: AgentPresence;              // 来自 @hermes-flux/core
  identity: AgentPresenceIdentitySolo | AgentPresenceIdentityGroup;
  /** 当前语言；纳入 memo 比较，切语言后必须重渲染 */
  locale?: string;
}

export function AgentPresence(props: { snapshot: AgentPresenceSnapshot }): React.ReactElement;
```

在 `packages/ui/src/components-react/conversation/index.ts` 追加：

```ts
export { AgentPresence, type AgentPresenceSnapshot, type AgentPresenceIdentitySolo, type AgentPresenceIdentityGroup } from '../AgentPresence.js';
```

在 `packages/ui/src/index.ts` 追加同名导出（与 `mountPromptNavigator` 同段）。

### 4.2 DOM 契约（测试按此断言，不得改名）

```
<div class="conv-presence" data-presence="<kind>" data-mode="solo|group" data-tone="fresh|patient|long">
  <div class="conv-presence__avatars" data-blinkable="true|false">
    <span class="conv-presence__avatar" data-speaker="true|false" data-lead="true|false">
      <span class="conv-presence__halo" aria-hidden="true"></span>
      <span class="conv-presence__ring" aria-hidden="true"></span>
      <span class="conv-presence__face" aria-hidden="true" data-blink="true|false">
        ...renderBotAvatar 输出（dangerouslySetInnerHTML）...
      </span>
    </span>
    ...群聊其余成员，各一个 .conv-presence__avatar（无 halo / 无 ring）...
  </div>
  <span class="conv-presence__text">
    [<span class="conv-presence__prefix">说话者名</span><span class="conv-presence__sep">·</span>]
    <span class="conv-presence__verb">正在思考</span>
    [<span class="conv-presence__target">gateway.ts</span>]
    [<span class="conv-presence__bars"><i></i><i></i><i></i></span>]
  </span>
</div>
```

规则：

- `idle` 时**不渲染 `.conv-presence__text`**（文案整行退场），头像仍在。
- `failed` / `interrupted` 时 `data-blinkable="false"`，且 `data-blink="false"` 恒定。
- `tool` 态 `.conv-presence__target` 存在；其余态不存在。
- `writing` 态 `.conv-presence__bars` 存在；其余态不存在。
- 群聊时第一个 `.conv-presence__avatar` 是说话者（`data-speaker="true"`），`data-lead="true"`；其余 `data-lead="false"`。
- `speaker === null` 时**所有** `data-speaker="false"`，且不渲染 `.conv-presence__prefix` 与 `.conv-presence__sep`。
- 成员超过 4 个时，第 4 个渲染为计数块：`<span class="conv-presence__avatar conv-presence__avatar--more">+N</span>`，N = `members.length - 3`。

### 4.3 文案映射（全部走 `t()`，零中文字面量）

| presence.kind | tone | i18n key | 参数 |
|---|---|---|---|
| thinking | fresh | `presence.thinking.fresh` | — |
| thinking | patient | `presence.thinking.patient` | — |
| thinking | long | `presence.thinking.long` | — |
| writing | fresh/patient | `presence.writing.fresh` | — |
| writing | long | `presence.writing.long` | — |
| tool | fresh | `presence.tool.<PresenceToolKind>.fresh` | `{target}` |
| tool | patient | `presence.tool.<PresenceToolKind>.patient` | `{target}` |
| tool | long | `presence.tool.<PresenceToolKind>.long` | `{target}` |
| delegating | — | `presence.delegating` | `{profile}` |
| failed | — | `presence.failed` | `{message}` |
| interrupted | — | `presence.interrupted` | — |

`presence.delegating` 的 `profile` 为空时用 `presence.delegatingAnonymous`。
`presence.failed` 的 `message` 先按 `slice(0, 60)` 截断再由实现方传入（截断在组件内做，不进 i18n）。

`target` 展示规则（组件内纯函数 `formatPresenceTarget`，须可测）：
- 路径型（含 `/` 或 `\`）：取「文件名 + 最近一级**非结构性**目录」，用 `/` 连接。
  结构性噪音目录指 `src / lib / dist / build / out / tests / test / __tests__ / packages`——
  它们对「这是哪个模块的文件」零信息量。因此 `packages/core/src/gateway.ts` 展示为
  `core/gateway.ts`（而不是 `src/gateway.ts`，也不是完整路径）；
- 命令型（`command` 类别）：取首行，超过 40 字符截断并加 `…`；
- 其余：首行，超过 40 字符截断并加 `…`。

### 4.4 眨眼时钟

新建 `packages/ui/src/components-react/conversation/usePresenceTicker.ts`：

```ts
/**
 * 眨眼节拍器。
 * 约束：只在 active 且页面可见时推进；卸载/失活/隐藏必须清理定时器，禁止泄漏。
 * 返回 true 表示当前处于「闭眼」帧（约 140ms）。
 */
export function usePresenceTicker(active: boolean, seed: string): boolean;
```

实现要点：

- 用 `setTimeout` 链，间隔取 `nextBlinkDelayMs(seed + ':' + tickIndex)`。
- 闭眼用两个 `setTimeout`（70ms 半程）或一个 140ms 窗口，闭眼结束后再排下一次。
- 监听 `document.visibilityState`：`hidden` 时清除定时器，`visible` 时重排。
- `active === false` 时立即清定时器并返回 `false`。
- **禁止** `requestAnimationFrame` 常驻循环。

### 4.5 挂载桥

文件：`packages/ui/src/components-react/conversation/mount.tsx`

新增，与 `mountPromptNavigator` 完全同构：

```ts
export function mountAgentPresence(
  host: HTMLElement,
  getSnapshot: () => AgentPresenceSnapshot
): ConversationMount
```

并在 `conversation/index.ts` 的 mount 导出行追加 `mountAgentPresence`。

---

## 五、样式（全部写在 `packages/ui/src/styles/conversation.css`，禁止组件内联 style）

**铁律**：`AgentPresence.tsx` 里**不得出现任何 `style={{...}}`**，也不得出现十六进制色值。所有几何与颜色走本文件的类与 Token。这条直接对应门禁 `theme/no-inline-hex` 与 `visual/no-arbitrary-value`。

在文件末尾新增一节，内容如下（可微调数值，不得改类名与结构）：

```css
/* ==========================================================================
   Agent 在场指示器（Presence Indicator）
   设计依据：docs/changes/2026-11-12_agent-presence-indicator/design.md
   约束：
     1. 绝对定位悬浮层，不占流、不改 padding-top、不参与任何高度计算；
     2. 全部动画共用 --presence-beat 主时钟，同相位，视觉上是一个焦点（D6 裁定）；
     3. 无内联 style，颜色与尺寸全部走 Token。
   ========================================================================== */

.conv-presence {
  --presence-beat: 2400ms;
  --presence-size: 56px;
  --presence-gap: 12px;

  position: absolute;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--presence-gap);
  pointer-events: none;
}

/* 椭圆径向遮罩：承担对比度职责（无壳裸文字必须靠它压在滚动内容之上） */
.conv-presence::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: calc(100% + 150px);
  height: calc(100% + 30px);
  border-radius: var(--radius-pill);
  z-index: -1;
  background: radial-gradient(ellipse 56% 120% at 50% 40%, var(--panel) 48%, transparent 100%);
}

.conv-presence__avatars {
  display: flex;
  align-items: center;
  height: var(--presence-size);
}

.conv-presence__avatar {
  position: relative;
  width: var(--presence-size);
  height: var(--presence-size);
  flex: 0 0 auto;
  display: grid;
  place-items: center;
}

/* 叠层：负 margin + 描边。描边不是装饰，没有它相邻头像边界会糊成一片 */
.conv-presence__avatar + .conv-presence__avatar {
  margin-left: -15px;
}

.conv-presence__avatar .conv-presence__face {
  width: var(--presence-size);
  height: var(--presence-size);
  border-radius: 50%;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: var(--card);
  border: 2px solid var(--panel);
  position: relative;
  z-index: 1;
  transform-origin: 50% 78%;
  box-sizing: border-box;
}

.conv-presence[data-mode="group"] .conv-presence__avatar[data-speaker="true"] .conv-presence__face {
  border-color: var(--foreground);
}

/* z-index 从左到右递减：说话者置最左，天然压在最上层，不需要额外提层规则 */
.conv-presence__avatar[data-lead="true"] { z-index: 5; }
.conv-presence__avatar[data-lead="false"]:nth-child(2) { z-index: 4; }
.conv-presence__avatar[data-lead="false"]:nth-child(3) { z-index: 3; }
.conv-presence__avatar[data-lead="false"]:nth-child(4) { z-index: 2; }
.conv-presence__avatar[data-lead="false"]:nth-child(5) { z-index: 1; }

.conv-presence__avatar--more {
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  color: var(--secondary-foreground);
  background: var(--card);
  border: 2px solid var(--panel);
  border-radius: 50%;
  box-sizing: border-box;
}

.conv-presence__halo {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 92px;
  height: 92px;
  margin: -46px 0 0 -46px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--foreground) 24%, transparent) 0%, transparent 70%);
  animation: convPresenceHalo var(--presence-beat) ease-in-out infinite;
  pointer-events: none;
}

.conv-presence__ring {
  position: absolute;
  inset: -5px;
  border-radius: 50%;
  padding: 1.5px;
  background: conic-gradient(
    from 0deg,
    transparent 0deg,
    transparent 186deg,
    var(--foreground) 292deg,
    transparent 356deg
  );
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  animation: convPresenceSpin var(--presence-beat) linear infinite;
  pointer-events: none;
}

/* 终态：环停止、光晕消失、眼睛不眨 */
.conv-presence[data-presence="failed"] .conv-presence__ring {
  animation: none;
  background: conic-gradient(from 0deg, var(--destructive) 0deg, transparent 360deg);
}
.conv-presence[data-presence="failed"] .conv-presence__halo { display: none; }
.conv-presence[data-presence="interrupted"] .conv-presence__ring {
  animation: none;
  background: repeating-conic-gradient(
    from 0deg,
    color-mix(in srgb, var(--muted-foreground) 75%, transparent) 0deg 11deg,
    transparent 11deg 25deg
  );
}
.conv-presence[data-presence="interrupted"] .conv-presence__halo { display: none; }

/* idle：头像常驻但弱化，光晕压到 40% */
.conv-presence[data-presence="idle"] .conv-presence__face { opacity: 0.78; }
.conv-presence[data-presence="idle"] .conv-presence__halo { opacity: 0.4; }
.conv-presence[data-presence="idle"] .conv-presence__ring { display: none; }

/* 形变语言：按状态分化 */
.conv-presence[data-presence="idle"] .conv-presence__face {
  animation: convPresenceBreathe 2600ms ease-in-out infinite;
}
.conv-presence[data-presence="thinking"] .conv-presence__face {
  animation: convPresenceTilt var(--presence-beat) ease-in-out infinite;
}
.conv-presence[data-presence="tool"] .conv-presence__face {
  animation: convPresenceLabor 800ms ease-in-out infinite;
}
.conv-presence[data-presence="writing"] .conv-presence__face {
  animation: convPresenceType 900ms ease-in-out infinite;
}
.conv-presence[data-presence="delegating"] .conv-presence__face {
  animation: convPresenceLook 1800ms ease-in-out infinite;
}
.conv-presence[data-presence="failed"] .conv-presence__face { opacity: 0.75; }
.conv-presence[data-presence="interrupted"] .conv-presence__face { opacity: 0.6; }

/* 群聊：非说话者只挂统一极轻呼吸（同相位，不构成独立焦点） */
.conv-presence[data-mode="group"] .conv-presence__avatar[data-lead="false"] .conv-presence__face {
  animation: convPresenceAmbient 2600ms ease-in-out infinite;
}

/* 眨眼：作用于 SVG 眼组，由 React 写 data-blink 驱动 */
.conv-presence__face svg .conv-presence__eyes,
.conv-presence__face .conv-presence__eyes {
  transform-box: fill-box;
  transform-origin: center;
  transition: transform 140ms cubic-bezier(0.4, 0, 0.2, 1);
}

.conv-presence__face[data-blink="true"] .conv-presence__eyes {
  transform: scaleY(0.08);
}

.conv-presence__text {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: var(--conv-font-sans);
  font-size: var(--conv-meta-size);
  line-height: var(--conv-meta-lh);
  letter-spacing: -0.005em;
  color: var(--foreground);
  max-width: min(420px, calc(100% - 96px));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 3px color-mix(in srgb, var(--background) 92%, transparent);
  animation: convPresenceTextIn 160ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.conv-presence__prefix { color: var(--muted-foreground); }
.conv-presence__sep { color: var(--faint); }
.conv-presence__target {
  font-family: var(--conv-font-mono);
  font-size: var(--conv-meta-size);
  color: var(--secondary-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
}

.conv-presence__verb {
  color: var(--foreground);
}

/* thinking 态文字高光 */
.conv-presence[data-presence="thinking"] .conv-presence__verb {
  background: linear-gradient(
    90deg,
    var(--muted-foreground) 0%,
    var(--foreground) 40%,
    var(--muted-foreground) 86%
  );
  background-size: 230% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: convPresenceShimmer 2200ms linear infinite;
}

/* writing 态打字波 */
.conv-presence__bars {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 11px;
}

.conv-presence__bars > i {
  width: 2px;
  height: 4px;
  border-radius: 1px;
  background: var(--foreground);
  animation: convPresenceWave 900ms ease-in-out infinite;
}

.conv-presence__bars > i:nth-child(2) { animation-delay: 120ms; }
.conv-presence__bars > i:nth-child(3) { animation-delay: 240ms; }

@keyframes convPresenceSpin {
  to { transform: rotate(360deg); }
}

@keyframes convPresenceHalo {
  0%, 100% { opacity: 0.38; transform: scale(0.92); }
  50% { opacity: 0.76; transform: scale(1.06); }
}

@keyframes convPresenceBreathe {
  0%, 100% { transform: scale(1.04, 0.97); }
  50% { transform: scale(0.97, 1.04); }
}

@keyframes convPresenceTilt {
  0%, 100% { transform: rotate(-2.5deg) scaleY(1); }
  50% { transform: rotate(2.5deg) scaleY(1.015); }
}

@keyframes convPresenceLabor {
  0%, 100% { transform: scale(1) rotate(0deg); }
  50% { transform: scale(1.035) rotate(-1.2deg); }
}

@keyframes convPresenceType {
  0%, 100% { transform: scaleY(1) scaleX(1); }
  45% { transform: scaleY(0.97) scaleX(1.02); }
}

@keyframes convPresenceLook {
  0%, 100% { transform: rotate(-3deg) translateX(-1px); }
  50% { transform: rotate(3deg) translateX(1px); }
}

@keyframes convPresenceAmbient {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.015); }
}

@keyframes convPresenceShimmer {
  from { background-position: 180% 0; }
  to { background-position: -80% 0; }
}

@keyframes convPresenceWave {
  0%, 100% { height: 4px; opacity: 0.45; }
  50% { height: 11px; opacity: 1; }
}

@keyframes convPresenceTextIn {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 页面隐藏即停：宿主在 visibilitychange 写 data-app-hidden */
html[data-app-hidden="true"] .conv-presence *,
html[data-app-hidden="true"] .conv-presence *::before,
html[data-app-hidden="true"] .conv-presence *::after {
  animation-play-state: paused;
}

@media (prefers-reduced-motion: reduce) {
  .conv-presence .conv-presence__ring,
  .conv-presence .conv-presence__halo,
  .conv-presence .conv-presence__verb,
  .conv-presence .conv-presence__bars > i,
  .conv-presence .conv-presence__text {
    animation: none;
  }
  .conv-presence .conv-presence__face {
    animation: none;
  }
  .conv-presence .conv-presence__face[data-blink="true"] .conv-presence__eyes {
    transform: none;
  }
}
```

**注意**：`--conv-meta-lh` 若在 `conversation.css` 内未定义，改为 `16px` 字面量（允许 px，因为门禁只管色值与字体族）。`color-mix` 是本仓库既有写法，可放心使用。

---

## 六、i18n

文件：`packages/ui/src/i18n/index.ts`

在 `zhDict` 的 `conversation.*` 段之后新增一节 `presence.*`，并在 `enDict` 同位置加**完全对应**的键（键集合必须 100% 相同，否则 `i18n.test.mjs` 红）。

中文（zhDict）：

```
'presence.thinking.fresh': '正在思考',
'presence.thinking.patient': '想得有点久',
'presence.thinking.long': '还在想',
'presence.writing.fresh': '努力工作中',
'presence.writing.long': '努力工作中，快好了',
'presence.tool.read.fresh': '正在读 {target}',
'presence.tool.read.patient': '还在读 {target}',
'presence.tool.read.long': '读 {target} 花了些时间',
'presence.tool.command.fresh': '正在运行 {target}',
'presence.tool.command.patient': '还在运行 {target}',
'presence.tool.command.long': '{target} 跑了有些久',
'presence.tool.edit.fresh': '正在改 {target}',
'presence.tool.edit.patient': '还在改 {target}',
'presence.tool.edit.long': '改 {target} 花了些时间',
'presence.tool.search.fresh': '正在搜索 {target}',
'presence.tool.search.patient': '还在搜索 {target}',
'presence.tool.search.long': '搜索 {target} 跑了有些久',
'presence.tool.agent.fresh': '正在派活给 {target}',
'presence.tool.agent.patient': '还在等 {target}',
'presence.tool.agent.long': '{target} 那边有点久',
'presence.tool.browser.fresh': '正在打开 {target}',
'presence.tool.browser.patient': '还在打开 {target}',
'presence.tool.browser.long': '打开 {target} 花了些时间',
'presence.tool.other.fresh': '正在执行 {target}',
'presence.tool.other.patient': '还在执行 {target}',
'presence.tool.other.long': '执行 {target} 跑了有些久',
'presence.delegating': '正在派活给 {profile}',
'presence.delegatingAnonymous': '正在派活给子代理',
'presence.failed': '卡住了：{message}',
'presence.interrupted': '已停手',
'presence.aria': 'Agent 当前状态',
```

英文（enDict）：逐键对应，例如 `'presence.thinking.fresh': 'Thinking'`、`'presence.tool.read.fresh': 'Reading {target}'`、`'presence.failed': 'Stuck: {message}'`、`'presence.interrupted': 'Stopped'`、`'presence.aria': 'Agent status'`。

---

## 七、desktop 宿主装配

### 7.1 MiddlePod 模板

文件：`packages/ui/src/components/MiddlePod/MiddlePod.ts`，`renderMiddlePod` 内，在 `#conversation-stream` 之后、`#react-prompt-navigator-host` 之前插入：

```html
<!-- Agent 在场指示器 Host（React 岛，常驻 pod 层，绝不进滚动流） -->
<div id="react-conv-presence-host"></div>
```

**禁止**放进 `#conversation-stream`：那里会被 `activeStream.innerHTML = renderConversationCanvas(...)` 整块销毁（`renderer/index.ts:8236`）。

### 7.2 新增宿主状态（renderer）

文件：`packages/desktop/src/renderer/index.ts`

1. `AppState` 新增三个字段：

```ts
/** 回合开始本地时间戳；用于在场指示器的时长分层 */
turnStartedAt?: number;
/** 终态（失败/中断）的短暂展示；TTL 到期后自动清除并重渲染 */
presenceTerminal?: { kind: 'failed'; message: string } | { kind: 'interrupted' };
/** 群聊当前说话者；null/undefined 表示未知，指示器必须走降级 */
activeGroupSpeaker?: string | null;
```

2. `turn-started` 分支：`state.turnStartedAt = Date.now();` 并清除 `state.presenceTerminal`。
3. `turn-failed` 分支：置 `state.presenceTerminal = { kind: 'failed', message: action.message }`，并用一个 `setTimeout`（`PRESENCE_TERMINAL_TTL_MS = 8000`）到期清空 + `render()`。必须保证重复触发时先 `clearTimeout` 旧定时器。
4. `interruptTurn()`：置 `state.presenceTerminal = { kind: 'interrupted' }`，同样走 TTL 清理。
5. 所有「回合正常结束」路径（`turn-completed`）清空 `turnStartedAt` 与 `presenceTerminal`。
6. 群聊说话者：写 `state.activeGroupSpeaker`。**注意：不要用 `groups.send` 的响应**——
   `groupService.ts:270-283` 的 `sendMessage` 写入的 entry 带 `actorKind: 'user'`，
   它的 `senderProfile` 是**人类用户**，拿它当说话者会高亮一个没在干活的头像（伪造）。
   正确来源是**末条 assistant 消息的 `sender`**，并做 displayName → 成员 profile name 的归一化
   （`sender` 可能是 displayName，而 `members` 存 profile name；不归一化会让组件侧
   「说话者必须在成员里」的守卫永远判定未知，接线看似通了实际永远不高亮）。
   回合未运行时（idle / failed / interrupted）必须置 `null`，绝不沿用上一位。
   若实现成本超出一个函数，允许本 PR 只保留字段与 `null` 降级路径，并在 `design.md` 的 D4a
   下补一行「说话者接线待下一 PR」。**不允许**伪造说话者。

### 7.3 快照与挂载

新增：

```ts
function buildAgentPresenceSnapshot(): AgentPresenceSnapshot {
  // presence：deriveAgentPresence({
  //   isStreaming: 由 resolvePresenceDomain() 统一裁决 —— 单聊读
  //     isStreamingActiveForCurrentSession()，群聊读 activeRunningGroupRoomIds。
  //     【陷阱】群聊回合从不写 state.isStreaming，只读后者会让群聊永久 idle；
  //   message: 末条 assistant 消息（含 thought/content/toolCalls）,
  //   activeSubagents: state.sideAgentCapsules.filter(c => c.kind === 'delegation' && c.status === 'pending').length,
  //   subagentProfile: 同上取第一个的 profile,
  //   lastError / interrupted: 由 state.presenceTerminal 映射,
  //   turnStartedAt: 群聊读自己的回合时钟，单聊必须校验会话归属（否则切会话后会拿 A 的锚点算 B 的时长）,
  //   now: Date.now(),
  // })
  // identity：group 模式用 state.groupRooms 当前房间 + state.profiles + state.activeGroupSpeaker；
  //           否则用 state.profileName / 当前会话 bot 的 displayName 与 avatar。
}
```

**必须同时满足的两条时序约束**（漏任一条功能就是死的）：

1. **必须有推送驱动源**。流式期间宿主**不会**每帧 `render()`（token 走 coalescer 直写 DOM、工具插槽走 rAF 补丁）。若只靠 `render()` 推送，语气档永远停在「正在思考」不升级、工具态不切换。需要一个只在非 idle 时运行的 `setInterval`（1s 量级）驱动 `syncAgentPresence()`，进入 idle 必须 `clearInterval`。
2. **指纹不得包含 `sinceMs` 与正文**。它们每帧变化，进指纹等于关掉去重；语气档（`tone`）已经承载了「时长是否跨档」这一唯一可感知变化。指纹应覆盖 `presence.kind`、`tone`、target、失败原因、身份、说话者、成员、`locale`。

挂载（放在 `syncReactMessageList()` 之后、prompt navigator 之前，理由同 `mountPromptNavigator` 的注释）：

```ts
const presenceHost = document.getElementById('react-conv-presence-host');
if (presenceHost && presenceHost !== agentPresenceHost) {
  // 【规则】全量重建（root.innerHTML = html）会重造 host；旧 root 挂在脱离文档的节点上，
  // 只判 `!update` 会让指示器永久消失。必须按 host 引用判定并显式 unmount。
  updateReactAgentPresence?.();
  ...
}
```

推送：**必须按指纹去重**（同 `getTitlebarSnapshot` 的 `snapshotFingerprint` 手法），否则流式期间每帧都协调一次 React 树。指纹至少包含 `presence.kind`、`presenceTone`、target、message、tone、speaker、members 长度、locale。

### 7.4 删除两处旧真值面（本 PR 的核心减法）

1. 删除函数 `updateActivityPill`（`renderer/index.ts:5647` 起）与它的**全部 11 处调用**（`4346, 4450, 4491, 4691, 4971, 5320, 5401, 5421, 5738, 5745, 5753, 5766, 5807, 5955, 5985` 附近）。
2. 删除 `AppState.agentActivityStatus` 字段（`:697`）及其所有赋值。
3. 删除 `InputDock` 的 `activityStatus` prop 与 `agent-activity-pill` 渲染分支（`packages/ui/src/components/InputDock/InputDock.ts:95, 224, 236-270, 305, 1162, 1202`），以及 `hasDockSnapshotChanged` 中的该字段比较。
4. 删除 `render()` 里三处 `activityStatus:` 传参（`:7871, :7949, :8123`）。

**验收**：全仓 grep `agentActivityStatus`、`updateActivityPill`、`agent-activity-pill`、`activityStatus` 均应为 0 命中（测试文件与设计文档除外）。

---

## 八、必须新增的 ui 测试

新建 `packages/ui/__tests__/agent-presence.test.mjs`，用 `node:test` + `react-dom/server` 的 `renderToStaticMarkup`（与 `conversation-stage.test.mjs` 同法），从 `../dist/components-react/AgentPresence.js` 导入。

必测项（每条都要能在实现被改坏时变红）：

1. **idle**：`data-presence="idle"`；渲染 `.conv-presence__avatar`；**不渲染** `.conv-presence__text`。
2. **thinking 时长分层**：`sinceMs=0` → `data-tone="fresh"` 且文案含 `t('presence.thinking.fresh')`；`sinceMs=9000` → `data-tone="patient"`；`sinceMs=31000` → `data-tone="long"`。
3. **tool 目标裁剪**：`tool: 'read'`、`target: 'packages/core/src/gateway.ts'` → 文案含 `core/gateway.ts`（文件名 + 最近一级非结构性目录）且**不含** `packages/core/src/gateway.ts` 全串。
4. **tool 命令截断**：`tool: 'command'`、target 为 60 字符 → 文案以 `…` 结尾。
5. **writing**：渲染 `.conv-presence__bars` 且含三个 `<i>`。
6. **delegating**：文案含 profile 名；`profile` 为空串时用 `presence.delegatingAnonymous`。
7. **failed**：`data-blinkable="false"`，文案含截断后的 message（>60 字符时以 `…` 结尾）。
8. **interrupted**：`data-blinkable="false"`，文案为 `t('presence.interrupted')`。
9. **群聊 speaker 已知**：第一个 avatar `data-speaker="true"` 且 `data-lead="true"`；第二个 `data-speaker="false"`；渲染 `.conv-presence__prefix` 且含 speaker 名。
10. **群聊 speaker 为 null**：所有 avatar `data-speaker="false"`；**不渲染** `.conv-presence__prefix`。
11. **群聊溢出**：5 个成员 → 渲染 4 个 avatar，最后一个文案为 `+2` 且带 `conv-presence__avatar--more`。
12. **单聊**：不渲染 `.conv-presence__prefix`；`data-mode="solo"`。
13. **无内联 style 与色值**：读 `packages/ui/src/components-react/AgentPresence.tsx` 源码，断言不含 `style={{`，且不含 `/#[0-9a-fA-F]{3,8}\b/` 与 `rgba?(\(`、`hsla?(\(`。
14. **CSS 守卫**：读 `packages/ui/src/styles/conversation.css`，断言包含 `--presence-beat`、`@keyframes convPresenceTilt`、`prefers-reduced-motion` 块内包含 `.conv-presence`、以及 `html[data-app-hidden="true"] .conv-presence`。
15. **空片段不渲染**：`tool` 态 long 档（文案形如 `{target} 跑了有些久`）时，DOM 中**不得**出现空的 `conv-presence__verb`（空 span 会在 flex `gap` 下多出一个 6px 间隙）。
16. **读屏语义**：根节点必须有 `role="status"` 与 `aria-label={t('presence.aria')}`。

同时在 `packages/ui/__tests__/i18n.test.mjs` **之外**不必新增 i18n 断言（键对齐已由既有用例覆盖），但实现方必须本地跑一次 `node --test packages/ui/__tests__/i18n.test.mjs` 确认新键已同步。

---

## 九、验收清单（最终由主 Agent 逐条核）

1. `node node_modules/typescript/lib/tsc.js --build packages/core/tsconfig.json packages/ui/tsconfig.json` 无输出。
2. `node --test packages/core/__tests__/agent/agentPresence.test.mjs` 全绿（45 条）。
3. `node --test packages/ui/__tests__/agent-presence.test.mjs` 全绿（≥14 条）。
4. `node --test packages/ui/__tests__/i18n.test.mjs` 全绿。
5. `node --test packages/ui/__tests__/composer-dock.test.mjs packages/ui/__tests__/conversation-stage.test.mjs packages/ui/__tests__/layout.test.mjs` 全绿（证明删除 activityStatus 未破坏既有契约）。
6. `node scripts/gates/run.mjs --changed` 新增违规 0。
7. 全仓 grep 四个旧标识符零命中（见 §7.4）。
8. `node packages/desktop/scripts/build.mjs` 成功，产物含 `dist/renderer/conversation.css`。
9. 提交拆分为三个 commit：`feat(core)` / `feat(ui)` / `feat(desktop)`，每个 commit 自洽可回滚。

---

## 十、明确不做（防止范围膨胀）

- 不做点击跳转检查舱（D5 已裁定：纯只读）。组件保持零回调、零交互，`pointer-events: none` 不得移除——移除后它会拦截会话流的滚动与选择。
- 不做审批请求的在场表达。
- 不改 `renderGroupCollageAvatar`（左轨与标题栏继续用 2×2 拼图）。
- 不动 `StatusBar`、`Titlebar`。
- 不新增任何 npm 依赖。
- 不改 `docs/architecture/motion-system-and-host-isolation-spec.md`（D6 裁定已记录在 `design.md`，待人工复核该规范时一并更新）。
