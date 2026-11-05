# Hermes Flux 跨端通用动效组件与宿主隔离技术方案与实施规范
> **文档标识**：`HF-SPEC-MOTION-AND-HOST-ISOLATION-20261106`  
> **文档状态**：已过审定稿 (Arena Synthesized: Candidate 2 Base + Candidate 1 Grafts)  
> **架构分层**：`packages/core/src/motion` ➔ `packages/ui/src/motion` ➔ `packages/desktop` / `packages/mobile` / `packages/web`  
> **设计姿态**：Hermes Flux 三舱工作台 = **`tool` 姿态**（严格落实审美宪法 I6，零静态阴影，动效只承载状态变化，严禁弹性过冲，稳态常驻动效 $\le 1$）

---

## 目录
- [一、方案定位与 5W2H 宏观架构设计](#一方案定位与-5w2h-宏观架构设计)
- [二、分层解耦与 Monorepo 物理拓扑](#二分层解耦与-monorepo-物理拓扑)
- [三、单调递增 Version CAS 五态状态机 (MotionFSM)](#三单调递增-version-cas-五态状态机-motionfsm)
- [四、动态 CSS Token 探测与换肤单一真值源](#四动态-css-token-探测与换肤单一真值源)
- [五、高性能 CSS 渲染约束与几何结构契约](#五高性能-css-渲染约束与几何结构契约)
- [六、幽灵焦点治理与 Focus Return Protocol](#六幽灵焦点治理与-focus-return-protocol)
- [七、历史纯 TS 模板宿主渐进改造实施范式](#七历史纯-ts-模板宿主渐进改造实施范式)
- [八、标准 7 列环节可行性证明矩阵 (假设清零)](#八标准-7-列环节可行性证明矩阵-假设清零)
- [九、质量门禁与变异杀伤力测试规范](#九质量门禁与变异杀伤力测试规范)

---

## 一、方案定位与 5W2H 宏观架构设计

### 1.1 现状诊断与核心痛点
Hermes Flux 前端工程正处于从历史纯 TypeScript 字符串模板向现代 React 岛屿（React Shell Hosts）平滑演进的混合期。系统在动效与生命周期管理上面临三大结构性阻断：
1. **退场动效瞬间断头**：由于宿主调度器（`packages/desktop/src/renderer/index.ts:4837, 4910-4995`）使用 `outerHTML = ...` 粗暴替换或 `.remove()` 物理拔除节点，元素在退出帧尚未播放前即被主线程抹杀，导致退场动画完全丢失；
2. **状态时序竞态与冒泡误杀**：依赖不可靠的裸 `transitionend` 监听，子元素（如按钮 hover）动画结束冒泡至外层，误触发退场清理；快速双击（Flapping）时旧定时器未取消，造成新弹窗弹出一半突然被误杀；
3. **性能衰减与参数漂移**：误在通栏折叠处过渡 `width` 或在长消息流中引入 `transform` 破坏 WebKit 硬件加速；散落硬编码毫秒与非规范弹簧过冲（Overshoot），违背 Hermes Flux 严谨克制的极客工具宪法。

### 1.2 5W2H 宏观架构定位
- **What（是什么）**：跨端、跨宿主的轻量通用动效状态机引擎 + 基于数据属性（`data-motion`）与宿主插槽（Shell Mount Slot）的退场保活机制 + 严格对齐宪法 I6 的非对称 Token 体系。
- **Why（为什么做）**：在彻底根治退场断头、冒泡误杀、幽灵焦点与布局重排的前提下，统一全平台动效微交互质感，实现纯模板与 React 岛的高复用同构。
- **Who（谁负责/谁消费）**：
  - 核心状态机与协议：`packages/core`（纯 TypeScript，零 DOM 依赖）；
  - DOM 控制器与组件：`packages/ui`（供 Desktop、Web、Mobile 四端共享）；
  - 宿主挂载：`packages/desktop/src/renderer` 与 `packages/mobile` 薄壳。
- **Where（代码落点）**：
  - `packages/core/src/motion/`（状态机核心与时钟接口）；
  - `packages/ui/src/motion/`（DOM 属性控制器、React 适配层与样式契约）；
  - `packages/desktop/src/renderer/styles.css`（注册动效 Token）；
  - `packages/ui/src/tokens/skins.ts`（皮肤单一真值源对齐）。
- **When（演进步骤）**：四阶段推进：① Core/UI 基础设施 ➔ ② 宿主插槽与 Token ➔ ③ 关键容器（SettingsModal / InspectionPod）改造 ➔ ④ 门禁收敛与基线清偿。
- **How（技术机理）**：单调递增 Version CAS 状态机 + `transitionend` 靶心断言 + `min-height: 0` CSS Grid 结构契约 + HTML5 `inert` 焦点阻断。
- **How Much（性能与开销预算）**：
  - 零外部 npm 依赖，核心引擎压缩后体积 $\le 2\text{KB}$；
  - 动效 100% 运行在 GPU 合成层，长会话下稳定 60/120fps，绝对禁止通栏 Reflow。

---

## 二、分层解耦与 Monorepo 物理拓扑

严格捍卫 `core ➔ ui ➔ desktop / mobile / web` 的单向依赖拓扑，严禁逆向污染：

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        Hermes Flux 统一动效分层架构 (Synthesized)                      │
├─────────────────────────┬──────────────────────────────────────────────────────────────┤
│ 1. 业务表现层           │ 纯模板渲染节点 (Template DOM)   │ React 岛组件 (<MotionView>) │
│    (Presentation)       │ [data-motion-state] 属性驱动    │ useMotionPresence() Hook    │
├─────────────────────────┼─────────────────────────────────┴────────────────────────────┤
│ 2. DOM 控制与表现契约   │ attachMotionController / VanillaMotionPresence (零框架依赖)  │
│    (packages/ui/motion) │ 动态 CSS Token 探测 + HTML5 inert 焦点阻断 + 靶心冒泡隔离     │
├─────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 3. 核心无界逻辑与状态机 │ MotionFSM (纯 TypeScript 5 态判别联合状态机)                 │
│    (packages/core/motion│ 单调自增 Version CAS 防重入机制 + 同构时钟接口 (Node.js 免崩溃) │
└─────────────────────────┴──────────────────────────────────────────────────────────────┘
```

- **`packages/core/src/motion/`**：承载纯无界状态机 `MotionFSM`、版本控制与状态转移表，零 DOM、零 React 依赖。具备离线单测与 `fast-check` 形式化验证能力；
- **`packages/ui/src/motion/`**：承载纯原生 DOM 控制器 `attachMotionController`、动态 Token 探测、React 适配器 `<MotionView>` 与 `useMotionPresence`，统一通过 `packages/ui/src/index.ts` 导出；
- **薄壳宿主**：Desktop、Web、iOS、Android 四端共享 `desktop/dist/renderer` 产物，天然获得同一份动效行为；VS Code 扩展显式标注为当前未覆盖端，保持诚实交付。

---

## 三、单调递增 Version CAS 五态状态机 (MotionFSM)

### 3.1 5 态判别联合状态定义
彻底消除多布尔标志位（如 `isEntering && isExiting`）产生的非法状态空间，建立数学自洽的判别联合：

```typescript
export type MotionStatus = 'idle' | 'entering' | 'entered' | 'exiting' | 'exited';

export interface MotionState {
  readonly status: MotionStatus;
  readonly version: number;
}

export type MotionEvent =
  | { type: 'ENTER' }
  | { type: 'EXIT' }
  | { type: 'TRANSITION_END'; version: number; propertyName?: string }
  | { type: 'TIMEOUT_FALLBACK'; version: number };
```

### 3.2 状态转移矩阵与 CAS 机制 (Anti-Flapping)
为每个动效实例维护一个单调自增的整型版本戳 `version: number`：
1. 每次显式状态转移（`ENTER` / `EXIT`）强制 `version++`；
2. 异步回调（`transitionend`、Watchdog `setTimeout`）触发时，必须持票比对 `event.version === this.version`；版本过期的一律静默废弃；
3. **反向中断平滑过渡 (Reverse Transition)**：在 `exiting` 阶段中途再次触发 `ENTER` 时，不强制跳跃重置到起始帧，而是基于当前插值位置立即推进至 `entering`，递增版本使旧退场定时器失效，消除视觉闪烁。

```text
                    ┌──────────────────┐
                    │      idle        │ (未激活 / 隐藏)
                    └─────────┬────────┘
                              │ ENTER [version = v + 1]
                              ▼
                    ┌──────────────────┐
     ┌─────────────►│    entering      │ (入场过渡中 120ms)
     │              └─────────┬────────┘
     │                        │ TRANSITION_END (version === v)
     │                        ▼
     │              ┌──────────────────┐
     │              │     entered      │ (入场终态 / 完全可交互)
     │              └─────────┬────────┘
     │ EXIT 中途打断          │ EXIT [version = v + 1]
     │ ENTER 逆向推进         ▼
     │ [version = v + 1]   ┌──────────────────┐
     └─────────────────────┤     exiting      │ (退场过渡中 200ms / 注入 inert)
                           └─────────┬────────┘
                                     │ TRANSITION_END (version === v) 或 超时安全兜底
                                     ▼
                           ┌──────────────────┐
                           │      exited      │ (退场终态 / 物理清理或 display:none)
                           └──────────────────┘
```

### 3.3 靶心断言与事件冒泡严格隔离
`TransitionEvent` 具有冒泡特性（`bubbles: true`）。针对容器内部子元素（如输入框聚焦、按钮 hover）动画结束冒泡的隐患，控制器必须执行三阶守卫拦截：

```typescript
function handleTransitionEnd(event: TransitionEvent) {
  // 1. 靶心断言：物理触发源必须为当前绑定的宿主本身，彻底阻断子节点冒泡误杀
  if (event.target !== event.currentTarget) return;

  // 2. 主属性白名单过滤：忽略背景色等无关微变，仅匹配核心位移/透明度属性
  if (expectedProperty && event.propertyName !== expectedProperty) return;

  // 3. 版本 CAS 核验：杜绝过期异步回调
  fsm.dispatch({ type: 'TRANSITION_END', version: currentToken, propertyName: event.propertyName });
}
```

---

## 四、动态 CSS Token 探测与换肤单一真值源

### 4.1 官方设计宪法 I6 参数定案
依据 Hermes Flux 审美宪法 I6（`tool` 姿态：克制、单调收敛、无过冲），彻底废除带有娱乐色彩的弹簧过冲曲线，确立非对称进退场规范：

| 动效场景 | 推荐时长 | 缓动曲线 | 过冲 (Overshoot) | 作用场景 |
|---|---|---|:---:|---|
| **入场 (Enter)** | `120ms` | `--ease-spring: cubic-bezier(0.16, 1, 0.3, 1)` | **0%** | 模态框展现、抽屉展开、下拉唤起 |
| **退场 (Exit)** | `200ms` | `--ease-spring: cubic-bezier(0.16, 1, 0.3, 1)` | **0%** | 模态框收起、抽屉关闭、轻量清理 |
| **快捷键触发 (Keyboard)** | `0ms` 或 `80ms` | `linear` | **0%** | `Ctrl+B`、`Ctrl+\` 等高频键盘交互 |

### 4.2 运行时 Token 动态探测与静态回退
拒绝在 TypeScript 代码中硬编码固定的毫秒数值，确保换肤系统（5 大内置皮肤）对动效参数拥有单一统治权：

```typescript
// packages/ui/src/motion/motion-tokens.ts
export interface MotionDurationContract {
  durationEnter: number;
  durationExit: number;
  fallbackBuffer: number;
}

const STATIC_FALLBACK_TOKENS: MotionDurationContract = {
  durationEnter: 120,
  durationExit: 200,
  fallbackBuffer: 50,
};

export function resolveMotionTokens(el?: HTMLElement): MotionDurationContract {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return STATIC_FALLBACK_TOKENS;
  }

  const target = el || document.documentElement;
  const style = window.getComputedStyle(target);
  const parseMs = (val: string, fallback: number): number => {
    const trimmed = (val || '').trim();
    if (trimmed.endsWith('ms')) return parseFloat(trimmed) || fallback;
    if (trimmed.endsWith('s')) return (parseFloat(trimmed) * 1000) || fallback;
    return fallback;
  };

  return {
    durationEnter: parseMs(style.getPropertyValue('--duration-enter'), 120),
    durationExit: parseMs(style.getPropertyValue('--duration-exit'), 200),
    fallbackBuffer: 50,
  };
}
```

### 4.3 Node.js 单测与无障碍环境探测
在 `useDurationTicker` 与动效引擎中严密防护运行环境，杜绝在单测运行抛出 `TypeError: window.matchMedia is not a function`：

```typescript
export function isReducedMotionPreferred(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false; // Node.js 单测环境默认关闭降频，避免定时器死锁
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
```

---

## 五、高性能 CSS 渲染约束与几何结构契约

### 5.1 WebKit 滚动容器硬件防线 (Zero-Transform Invariant)
根据 `scripts/gates/rules.mjs:283-288`（`perf/no-transform-scroll`）以及 WebKit 软键盘弹出 GPU 合成层重建假死 3~5 秒的重大已知历史红线：
- **绝对禁令**：在聊天长列表滚动容器（`#conversation-stream`、`.middle-pod`）及其任何直接父容器上，**严禁声明 `transform` 与 `filter`**；
- **抽屉与检查舱定位**：主抽屉（`LeftRail`）与检查舱（`InspectionPod`）必须采用独立的 `position: fixed` 或绝对定位浮层，在独立的 GPU 图层上执行位移，不得改变主对话流的 Containing Block。

### 5.2 局部折叠 Single-Child Inner Wrapper 几何结构契约
采用现代 CSS Grid `grid-template-rows: 0fr -> 1fr` 机制替换性能低下的 JS 高度测量与 `max-height` 粗暴估算。为解决 CSS Grid 规范中直接子元素 `min-height: auto` 阻碍高度坍塌至 0 的物理陷阱，必须严格执行以下 HTML/CSS 结构契约：

```css
/* packages/desktop/src/renderer/styles.css 中的折叠规范契约 */
.flux-motion-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--duration-exit) var(--ease-spring);
  contain: layout paint; /* 隔绝局部重排向外部扩散 */
}

.flux-motion-collapse[data-motion-state="entering"],
.flux-motion-collapse[data-motion-state="entered"] {
  grid-template-rows: 1fr;
  transition-duration: var(--duration-enter);
}

/* 强制结构契约：直接子元素必须且仅有单层 Wrapper，且必须显式声明 min-height: 0 与 overflow: hidden */
.flux-motion-collapse > .flux-motion-collapse-wrapper {
  min-height: 0;
  overflow: hidden;
}
```

---

## 六、幽灵焦点治理与 Focus Return Protocol

### 6.1 退场过程 HTML5 原生 `inert` 注入
为彻底消灭“模态框退场中/隐藏后，用户按 `Tab` 键焦点穿透进入不可见表单项”的幽灵焦点漏洞：
1. **进入 `exiting` 瞬间**：控制器同步为宿主容器注入 `inert` 属性与 `aria-hidden="true"`；
2. **浏览器物理隔离**：带有 `inert` 属性的节点及其全部子孙元素将立刻从浏览器的 Tab 键焦点遍历链和 Accessibility Tree 中剥离，指针事件完全失效；
3. **退场完成 `exited`**：施加 `display: none` 双重兜底。

### 6.2 Focus Return Protocol (焦点安全原路返还契约)
模态框呼出时往往导致键盘用户的焦点上下文断裂。方案建立了确定性的焦点归还链条：
1. **呼出捕获**：在调用 `enter(triggerEl)` 时，控制器自动捕获传入的 `triggerEl`（或当前 `document.activeElement as HTMLElement`）；
2. **退出复原**：当退场动画收敛至 `exited` 且完成 `inert` 注入后，控制器自动调度微任务执行 `savedTriggerEl.focus()`，将焦点原路送回唤起按钮，确保键盘无障碍导航链路完好不断。

---

## 七、历史纯 TS 模板宿主渐进改造实施范式

以最小侵入（Minimal Complete Change）原则改造存量纯字符串模板组件，保留纯函数特性，仅替换 DOM 调度策略：

### 7.1 范式一：设置中心悬浮舱 (`SettingsModal.ts`) 改造
```typescript
// packages/ui/src/components/SettingsModal/SettingsModal.ts
export function renderSettingsModal(props: SettingsModalProps): string {
  // 不再直接因 !props.isOpen 返回空内容，而是常驻根容器，由 data-motion-state 决定显隐与过渡
  return `
    <div id="flux-settings-modal-root"
         class="settings-modal-backdrop flux-motion-backdrop"
         data-motion-state="${props.isOpen ? 'entered' : 'idle'}"
         ${props.isOpen ? '' : 'inert aria-hidden="true" style="display: none;"'}>
      <div class="settings-modal-dialog flux-motion-dialog" role="dialog" aria-modal="true">
        <!-- 弹窗内部 HTML 保持 100% 现状不变 -->
      </div>
    </div>
  `;
}
```

```typescript
// packages/desktop/src/renderer/index.ts 调度端
let settingsController: ReturnType<typeof attachMotionController> | null = null;

function toggleSettingsModal(isOpen: boolean, triggerEl?: HTMLElement) {
  const modalEl = document.getElementById('flux-settings-modal-root');
  if (!modalEl) return;

  if (!settingsController) {
    settingsController = attachMotionController(modalEl, {
      motionType: 'modal',
      triggerProperty: 'opacity',
      returnFocus: true,
      onExited: () => {
        modalEl.style.display = 'none';
      },
    });
  }

  if (isOpen) {
    modalEl.style.display = 'flex';
    void settingsController.enter(triggerEl);
  } else {
    void settingsController.exit();
  }
}
```

### 7.2 范式二：复合检查舱 (`InspectionPod.ts`) 抽屉加速改造
废弃原先在 `InspectionPod.ts:113` 中声明且已被 `:52` 提前跳出失效的内联 `transition: width 0.15s`，改为基于 `transform: translate3d` 的硬件加速抽屉：

```typescript
// packages/ui/src/components/InspectionPod/InspectionPod.ts
export function renderInspectionPod(props: InspectionPodProps): string {
  // 抽屉节点常驻，通过 data-motion-state 驱动硬件位移，废弃 width 尺寸突变
  return `
    <aside id="flux-inspector-pod"
           class="flux-inspector-pod flux-motion-drawer-right"
           data-motion-state="${props.collapsed ? 'idle' : 'entered'}"
           ${props.collapsed ? 'inert style="display: none;"' : ''}>
      <!-- 内部场景轨与工作舱视图保持不变 -->
    </aside>
  `;
}
```

---

## 八、标准 7 列环节可行性证明矩阵 (假设清零)

依循《ENGINEERING_DISCIPLINE.md》最高元原则，对方案全部 7 个改动环节实施确定性假设清零：

| 步骤 | 核心动作 | 潜在假设 / 前提 | 证明手段 | 证据来源 | 结论 | 备选预案 |
|---|---|---|---|---|:---:|---|
| **S1. Token 注册** | `styles.css` 注册 `--duration-enter: 120ms` / `--duration-exit: 200ms` | CSS 变量定义不会被 Tailwind v4 或局部规则意外覆盖 | 源码审计与运行时读取 | `tailwind-entry.css:80` 注释证实 `:root` 为时长单一真值源；实测 `getComputedStyle` 可读 | ✅ **已证** | 回退至 `skins.ts` 单一真值表注入 |
| **S2. 状态机无界化** | `packages/core/src/motion/` 落地 `MotionFSM` | 纯 FSM 可完全脱离 DOM/React 运行，支持毫秒级同步测试 | 单元测试实测 | `fast-check` 随机并发交错模型检验，零 DOM 依赖 | ✅ **已证** | 允许携带纯逻辑环境标记 |
| **S3. 靶心冒泡隔离** | 控制器中校验 `e.target === e.currentTarget` | Web 标准 `TransitionEvent` 在 Chrome/Safari/Edge 中物理属性一致 | W3C 规范与 CDP 验证 | `CSS Transitions Level 1` 标准规定 `target` 为派发节点；CDP 冒泡测试通过 | ✅ **已证** | 增加特定类名白名单断言 |
| **S4. CSS Grid 折叠** | `0fr ➔ 1fr` 配合 `min-height: 0` 结构契约 | 在主流浏览器及 Android WebView 下可稳定平滑坍缩至 0px | 真实 Blink/WebKit 跑原型 | `docs/prototypes/desktop-v8-director-grade.html:236` 验证；设置 `min-height: 0` 零高度收缩成立 | ✅ **已证** | 对低版本 WebView 降级为 `display: none` |
| **S5. WebKit 滚动防线** | 抽屉位移脱离主会话滚动容器，独立图层加速 | 避免触发 WebKit 重建硬件图层导致键盘弹出假死 3~5 秒 | 门禁探针与源码审查 | `scripts/gates/rules.mjs:283` 已存在 `perf/no-transform-scroll` 规则守护 | ✅ **已证** | 强制执行 AST 门禁静态拦截 |
| **S6. 幽灵焦点治理** | 退场时注入 HTML5 原生 `inert` 属性 | Electron 34 (Chromium 132) 及现代移动端全面支持 `inert` | CanIUse 与环境校验 | Chromium 102+ 全面原生支持 `inert`；Electron 34.2.0 内核完全覆盖 | ✅ **已证** | 对古老容器 polyfill `tabindex="-1"` |
| **S7. 纯模板渐进改造** | 废弃 `outerHTML` 粗暴抹杀，改为常驻根容器 + 控制器挂接 | 宿主仅需做极小改动，无需全量推翻重写为 React | 源码路径追踪 | `index.ts:4837, 4910` 锚点明确可定位，具备局部切流条件 | ✅ **已证** | 针对特异容器设立独立 Shell Mount Slot |

---

## 九、质量门禁与变异杀伤力测试规范

### 9.1 单元测试与变异杀伤力断言矩阵 (Lethality Tests)
在 `packages/ui/__tests__/motion-system.test.mjs` 中建立自动化回归防线，用例必须具备可证伪性：
1. **冒泡拦截杀伤力断言**：在目标容器内构造子元素并派发冒泡的 `transitionend` 事件，断言外层状态机恒定处于 `exiting`，严禁提前流转为 `exited`（变异检验：若注释掉 `e.target === e.currentTarget`，测试必须变红）；
2. **重入打断 CAS 杀伤力断言**：在退场第 50ms 注入 `ENTER` 事件，断言 `version` 递增，且原本挂起的 250ms 超时定时器被彻底消除（变异检验：若注释掉版本比对逻辑，测试必须变红）；
3. **Node.js 环境免崩溃断言**：在 `window === undefined` 或 `window.matchMedia === undefined` 下实例化控制器，断言零异常抛出且平滑降级。

### 9.2 静态门禁与基线收敛策略 (Gate Ratchet)
1. **`perf/infinite-animation` 存量债务清偿**：
   - 伴随集中时钟 `GlobalDurationTicker` 落地，按 `Titlebar ➔ InputDock ➔ MiddlePod` 顺序分批收编 8 处裸 infinite；
   - 每次收编完成后，运行 `npm run gates:freeze` 干净收缩 `.baseline.json` 中的存量指纹，严禁基线回弹反涨；
2. **交付前完整流水线验收**：
   ```bash
   npm run gates:changed    # 新增阻断违规严格为 0
   npm run typecheck        # 全工作区严格类型推导 0 错误
   npm test                 # 全量单测 100% 绿灯 (包含新增动效变异测试)
   npm run verify           # 交付前四位一体总体验收
   ```
