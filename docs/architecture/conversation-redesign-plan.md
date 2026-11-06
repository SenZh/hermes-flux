# 对话区表现层演进计划（Plan & TODO）

> 范围：Hermes Flux 中间对话区（Middle Pod）的**表现层**改造。  
> 硬前提：数据输入、输出、更新由其他组件负责；对话区只消费已成形视图模型，负责排版、层级、节奏与状态外观。  
> 顺序：先大后小，先骨架再内容；渲染方式在 P1 切换到 React，CSS 资产先行。  
> 本文件只写计划与规格，不含实现代码。
>
> **术语表**
> - **设计变量（Design Token）**：设计规范层的有语义名字，例如「面板底色」「主文字色」「强调色」。
> - **CSS 变量（CSS Custom Properties）**：代码里的实现，形如 `--panel`，用 `var(--panel)` 消费。
> - **模型用量**：LLM 的 token 计数，即对话区页脚的 `tokenMetrics`，与样式无关。
>
> 本文以下统一使用上述三个词，不再用“Token”泛指样式。
>
> **合成说明（Arena）**：底稿取自候选 B（量化基线、门禁盲区、测试冲突预判、数据契约表、10 条风险）；移植候选 A 的阶段完成定义（附录 B）与里程碑判定语言。跨家族盲评曾推荐 A，主要理由是 B"阶段一越界"；经核对，把四个容器从内联几何迁到 CSS 正是「搭骨架」的实际内容，A 的首阶段只有空文件与 link，搭不出骨架，故维持 B 为底稿，但把首阶段的 CDP harness 与全套几何断言收窄到阶段二，并补第 10 节「19 类内容的演进承接」。另更正盲评的两处误判：B 原文并未称 `MessageViewModel` 只有 8 个字段；根 `package.json` 确实存在 `build:desktop` 脚本。

## 0. 标注与引用约定

- 【事实】可在仓库源码、设计文档或构建脚本中直接核对。
- 【决策】已由用户确认或本计划明确选定，执行时不再讨论。
- 【建议】需要落地时二次确认，未确认前不得当作既有能力。
- 行号以当前工作区为准；凡无法确认的内容标「待核对」，不得据此编码。
- 简称约定：`MiddlePod.ts` = `packages/ui/src/components/MiddlePod/MiddlePod.ts`；`index.ts` = `packages/desktop/src/renderer/index.ts`；`styles.css` = `packages/desktop/src/renderer/styles.css`。
- 表格内未单列标签的规格与风险条目默认视为【决策】；依据列标【事实】的行以其标注为准。

### 0.1 换机接手入口

- **分支**：`feat/visual-system-redesign`
- **预览**：
  - Electron：`npm run build && npm start`
  - 浏览器：`npm run start:browser`，打开 `http://127.0.0.1:9120/?demo=conversation`
  - 不带 `demo` 参数时走真实网关；当前凭据 401，只能停在连接引导页
- **验证**：`npm run typecheck` → `npm test` → `npm run gates:changed`
- **坑**：改过 `scripts/start-browser-live.mjs` 的内联 HTML 后必须杀掉 9120 旧进程再重启，否则浏览器拿到旧 link 列表
- **下一步第一件事**：P2 剩余项里的「diff 逐行着色」或「Markdown 代码块样式迁出内联」

## 1. 目标与非目标

### 1.1 本轮目标

- 【决策】只做表现层：对话区不解析事件、不合并数据、不持有业务状态机；输入输出由宿主与其他组件负责。
- 【决策】先建立整块骨架，再逐层细化；不允许从按钮圆角、字号、色值开始做局部美化。
- 【决策】样式落点选 B：新建 `packages/ui/src/styles/conversation.css`，由 desktop 打包引入，跨端直接复用。
- 【决策】**P1 起 React 化**：对话区用 React 组件渲染，CSS 资产先行且与渲染方式解耦；P0 仍可用字符串模板过渡。
- 【决策】**统一使用新 CSS 变量**：新代码只消费 `--panel/--foreground/--primary/--border` 这一套；旧变量（`--bg-panel/--text-main/--accent`）只保留定义供未迁移组件使用，不再新增引用，全站迁完后删除。
- 【建议】本轮完成后的可量化结果：对话区结构样式集中到一个 CSS 文件；第一批容器不再依赖内联布局；三端模式（普通 / Bot / 群聊）共用同一套组件与几何；web/mobile 可直接复用组件与样式。

### 1.2 现状基线（只列与本计划相关的事实）

| 项 | 现状 | 依据 |
|---|---|---|
| 对话区渲染 | 全部在 `packages/ui/src/components/MiddlePod/MiddlePod.ts`，2101 行、约 96KB；内联样式 202 处、6 位色值 15 处、`rgba()` 17 处、`px` 字面量 413 处、`font-size: Npx` 75 处 | 【事实】文件扫描；结构与样式分布见 `MiddlePod.ts:129-268`、`567-807`、`809-855` |
| 消息视图模型 | 仅 `MessageViewModel`，无 `kind/status/error/attachments` | 【事实】`MiddlePod.ts:24-50` |
| 组件入参 | `MiddlePodProps` 已有连接态、消息、分页、上下文水位、流式标记、旁路胶囊 | 【事实】`MiddlePod.ts:69-84` |
| 画布 | `renderConversationCanvas` 输出 `.content-fluid-canvas`，当前 `gap: 18px` | 【事实】`MiddlePod.ts:129-182` |
| 页面骨架 | `renderMiddlePod` 输出 `.flux-middle-pod.conversation-pod`，滚动流 `#conversation-stream`，底部 120px 遮罩 | 【事实】`MiddlePod.ts:225-268` |
| 全量刷新 | `root.innerHTML = html` | 【事实】`packages/desktop/src/renderer/index.ts:4852` |
| 分区刷新 | `activeStream.innerHTML = renderConversationCanvas(...)` | 【事实】`index.ts:5075-5088` |
| 流式锚点 | `#msg-content-*`、`#msg-thought-*`、`#msg-tools-*` | 【事实】`index.ts:900`、`916`、`959` |
| 操作栏 | 复制 / 回滚 / Fork 走 `data-action` 事件委托 | 【事实】`index.ts:6337-6355` |
| 样式交付 | Tailwind 输入 `packages/ui/src/tailwind-entry.css` 输出 `dist/renderer/tailwind.css`；`styles.css` 直接复制 | 【事实】`packages/desktop/scripts/build.mjs:34-40`、`119-122` |
| HTML 顺序 | `styles.css` → `tailwind.css` | 【事实】`packages/desktop/src/renderer/index.html:7-8` |
| 预览链路 | 浏览器直跑页另写 link 列表 | 【事实】`scripts/start-browser-live.mjs:159-160` |
| 产物校验 | 只查存在性，不排斥新文件 | 【事实】`scripts/verify/control-flux.mjs:39-44` |
| 样式目录 | `packages/ui/src/styles/` 当前不存在，`conversation.css` 不存在 | 【事实】目录扫描 |
| 视觉缺陷 | 思考区硬编码 `#9CA3AF` 与 `rgba(255,255,255,0.08)`；`<details>` 同时出现两个 `style` 属性；用户气泡 82% | 【事实】`MiddlePod.ts:846-847`、`817`、`582` |
| 几何漂移 | 设计文档 264px；实现 `clamp(58px,4.2vw,72px)` + 总宽 296px；`tokens.ts` 又写 260px | 【事实】`docs/design-system/README.md:141`、`styles.css:51-53`、`packages/ui/src/tokens/tokens.ts:9` |
| 设计基准 | 画布 `padding: 24px 32px 180px`、`gap: 16px`；用户气泡 `min(80%,820px)`；输入舱 740px；遮罩 120px | 【事实】`docs/design-system/desktop-design-system-spec.md:78-86`、`103-110` |
| 门禁盲区 | 静态门禁默认只扫 `.ts/.tsx/.js/.mjs`；`isSkinSurface` 不包含 `packages/ui/src/styles/`；但 `.css` 会被判为样式面 | 【事实】`scripts/gates/lib/scanner.mjs:44`、`scripts/gates/rules.mjs:23-30`、`scripts/gates/lib/changed.mjs:86-95` |
| 群聊渲染 | 独立实现，未复用消息组件 | 【事实】`packages/ui/src/components/Group/GroupRoomView.ts:26-76` |

### 1.2.1 基线结论（直接约束方案）

- 【事实】对话区不是「一套干净组件」，而是「一个大字符串模板 + 桌面壳内联样式 + CSS 变量双轨并存」；因此第一阶段必须先把样式落点建立起来，不能直接在模板里继续加类。
- 【事实】刷新粒度是「会话级全量重建 + 三个局部锚点补丁」，不是 React 重渲染；任何包裹层变化都可能影响锚点，P0 必须只碰最外层。
- 【事实】CSS 变量事实上有两套命名，且新 CSS 暂时不在静态门禁的扫描扩展名内；因此「文件建好」不等于「规则生效」，必须补守卫测试。
- 【事实】设计文档的 264px 与实现的 296px 不一致，说明几何真值本身在漂移；对话区 CSS 只能消费变量，不能再写死第三套宽度。
- 【事实】群聊与普通会话渲染路径不同；本轮不能假设「改 MiddlePod 就自动修好群聊」，P2 只做外壳一致性，不合并两条实现。
- 【建议】把这些结论写进 P0 的 PR 描述，防止后续把「样式搬家」误解为「功能重构」。

### 1.3 非目标（本轮总纲，详细排除项见第 9 节）

- 【决策】不做事件消费、字段解析、工具分类、Markdown 解析器替换、合并与去重。
- 【决策】P0 不做 React 化，保留 `MiddlePod.ts` 字符串模板过渡；P1 起切 React，不新建第二套并行实现。
- 【决策】不做数据层改造：不扩 `MessageViewModel` 实现、不调用新 RPC、不改 `eventReducer`、不改会话状态机。
- 【决策】P5 才做 web/mobile 接入；但 P1 起把触控热区、键盘避让、安全区作为 `density` 规格前置，避免接入时补丁式返工。
- 【决策】不改输入舱内部结构、排队逻辑、模型选择器、斜杠与 @ 补全。
- 【决策】不删旧 CSS 变量定义（未迁移组件仍在用）、不修左双轨 264/296 漂移、不改顶栏与检查舱。

## 2. 演进路线

### 2.1 阶段与交付

| 阶段 | 主题 | 主交付 | 预估 | 出口判据 |
|---|---|---|---|---|
| P0 | CSS 地基 + 骨架类 | `conversation.css`、四容器类、构建/预览/测试接入 | 1–2 天 | 截图零差异、守卫测试绿 |
| S（并行） | React spike | 结构 + 流式直写原型、性能数据 | 1–2 天 | FPS / 长任务 / 内存三项达标 |
| P1 | React 骨架 | `Stage / Stream / Turn` 组件、滚动与锚点 hook | 3–5 天 | 三视口无溢出、48px 跟随不变量 |
| P2 | React 消息壳 + 前三类内容 | 用户/助手壳、正文、思考、工具 | 3–4 天 | 三条锚点回归、三模式截图 |
| P3 | React 卡片容器 | 审批、连接、队列、子代理、待办等占位容器 | 3–4 天 | 空壳与状态外观可渲染 |
| P4 | 原子 + 样式变量收口 | 字阶、按钮、焦点、动效、双主题 | 2 天 | `verify` 全绿、双主题截图 |
| P5 | web / mobile 接入 | 复用组件，加 `density` 与平台适配 | 按端排 | 两端真实运行通过 |

【决策】P0 只做 CSS 与骨架类，不改字体、颜色细节与消息内部形态。
【决策】S 与 P0 并行；S 的结论只影响 P1 的流式策略，不影响整体路线。
【决策】P1 起不再新增字符串模板代码；旧模板在 P2 完成前保留回退能力。

### 2.1.1 进度看板（2026-11-06 更新）

> 状态标记：`[x]` 已完成并验证 · `[ ]` 待办 · `[~]` 部分完成

**P0 CSS 地基 —— 已完成 `[x]`**

- [x] 新建 `packages/ui/src/styles/conversation.css`，零色值字面量
- [x] 四容器去内联几何，改 `conversation-pod / conv-stream / conv-canvas / conv-dock-scrim`
- [x] 四容器 `data-conv-layer` 钩子
- [x] 构建复制（`build.mjs`）、`index.html` link、浏览器直跑 link 三处接入
- [x] 守卫测试 `conversation-skeleton.test.mjs`（3 条）
- [x] `layout.test.mjs` 画布断言改为类名 + 钩子，强度不降
- [x] 改造前后截图 SHA-256 一致（零视觉变化）

**S React spike —— 已完成 `[x]`**

- [x] 三种模式基准（React+ref 直写 / React+setState / 字符串 innerHTML）
- [x] 5000 条消息、流式每帧追加，数据落 `artifacts/spike/result.json`
- [x] 结论写入附录 C：采用「React 管结构 + ref 直写正文」
- [x] 排除每 token setState（流式 37.1 FPS、堆持续增长）

**P1 React 骨架 —— 部分完成 `[~]`**

- [x] 新增 `components-react/conversation/`：types / useStreamFollow / TurnGroup / ConversationStream / ConversationStage / mount / index
- [x] `#react-message-list-host` 嵌入式宿主，只接管消息列表
- [x] 宿主挂载/更新/卸载：host 消失或替换先 unmount，杜绝 root 泄漏
- [x] `conversationPush.ts` 纯函数 + 7 条四象限用例（force / 新 id / 流式刚结束 / 收缩 / 清空 / 不推送）
- [x] 流式期间不推快照，正文由 `#msg-content-*` 直写；流式结束边沿收敛一次
- [x] React 分支补 `applyStreamAnchor` 与 `canvasStructureDirty` 复位
- [ ] `ConversationStage` 全量接管外壳（滚动容器 / 输入舱 / 三态分派），当前只用了列表部分
- [ ] 真实页面三视口 CDP 几何断言（1920×1080 / 1440×900 / 1024×768）

**P2 消息壳与三类内容 —— 部分完成 `[~]`**

- [x] 用户气泡：右对齐、`min(80%,820px)`、操作栏移出气泡
- [x] 助手回合：发送者 + 时间、回合末页脚（复制/Fork、模型、耗时、时间）
- [x] 思考折叠：SVG 箭头、时长、摘要（60 字截断）
- [x] 工具胶囊：SVG 图标、中文分类、目标摘要（60 字截断）、耗时、失败标红
- [x] 只读工具聚合为「读取 N 个文件」+ chips
- [x] Markdown 正文统一 13px / 19px（对 renderMarkdown 内联样式使用 !important）
- [x] 轨迹区无外框、行式对齐、统一 26px 行高
- [x] 操作按钮保留 `data-action`，复用宿主事件委托
- [x] 字号/间距/对齐三处用户反馈问题修复（三轮）
- [ ] 文件变更 diff 逐行着色（当前只是等宽文本）
- [ ] Markdown 代码块与表格样式迁出内联（需改 `renderMarkdown`）
- [ ] `toolPatchQueue` 退役（工具卡改数据驱动后）
- [ ] 群聊消息流复用同一套组件

**P3 卡片容器 —— 未开始 `[ ]`**

- [ ] 七类卡片空壳：审批 / 连接 / 队列 / 子代理 / 待办 / 通知 / 未知类型
- [ ] 状态钩子：`data-request-state`、`data-connection-state` 等

**P4 原子与样式变量收口 —— 未开始 `[ ]`**

- [ ] 对话区旧变量引用清零
- [ ] 字阶口径统一（README 7 档 vs styles.css 8 档）
- [ ] 按钮 22px 视觉 + 32px 热区；焦点环；动效 120/200ms
- [ ] 清除 `MiddlePod.ts` 存量裸色值与裸字号（门禁冻结 95 条）

**P5 跨端 —— 未开始 `[ ]`**

- [ ] `density` 变体、44pt 触控、键盘避让、安全区

**验证设施 —— 已完成 `[x]`**

- [x] 浏览器直跑演示模式 `?demo=conversation`
- [x] 真实 Blink 截图落 `artifacts/verification/`


### 2.2 依赖关系

```text
P0 CSS 地基 ────────────────┐
                            ▼
S React spike ─────────► P1 React 骨架
                            ▼
                        P2 消息壳 + 正文/思考/工具
                            ▼
                        P3 卡片容器
                            ▼
                        P4 原子与变量收口
                            ▼
                        P5 web / mobile
```

| 依赖 | 类型 | 说明 |
|---|---|---|
| P1 → P0 | 硬依赖 | 没有 CSS 与骨架类，组件没有可复用的样式资产 |
| P1 → S | 硬依赖 | 流式策略必须先由 spike 定论，否则 P1 可能推倒重来 |
| P2 → P1 | 硬依赖 | 消息壳必须挂在稳定的流容器与回合节奏上 |
| P3 → P2 | 硬依赖 | 卡片位于消息壳内部，壳不稳定会导致锚点反复迁移 |
| P4 → P3 | 硬依赖 | 原子样式必须等块级选择器稳定后再收敛 |
| P5 → P4 | 硬依赖 | 跨端复用需要组件与样式资产冻结 |
| P2 ∥ P3 | 软并行 | 可并行设计，但合并顺序仍然是先二后三 |

### 2.3 里程碑

- **M0（P0）**：`conversation.css` 进入 `dist/renderer/`，四个容器类生效，改造前后截图无可解释差异，守卫测试通过。
- **MS（S）**：spike 三项指标达标，结论（React 全量 / React 外壳 + 直写 / 暂不切）落盘。
- **M1（P1）**：React 骨架运行，三档视口无横向溢出，48px 跟随不变量保持，流式不掉帧。
- **M2（P2）**：用户/助手壳与正文、思考、工具三类内容迁移完成，三条增量锚点各有回归断言。
- **M3（P3）**：卡片容器空壳可渲染，状态钩子齐全，数据由宿主注入。
- **M4（P4）**：字阶与控件原子统一，样式变量收口完成，双主题截图通过，`npm run verify` 全绿。
- **M5（P5）**：web 与 mobile 真实运行，复用同一组件与样式，只加 `density` 与平台适配。

### 2.4 React 化闸门（spike）

【决策】切换依据是跨端时间表，不再讨论“要不要 React”：web/mobile 紧随 desktop，字符串模板会导致事件、滚动、流式、工具补丁四套逻辑在每端重写。

【决策】spike 必须测出四项数据，全部达标才允许 P1 全量 React 化：

| 指标 | 场景 | 达标线 |
|---|---|---|
| 平均帧率 | 5000 条消息窗口滚动 | ≥ 55 FPS，且不低于改造前基线 |
| 单帧长任务 | 50 token/s 流式追加 | P95 ≤ 32ms，均值 ≤ 16ms |
| 内存增量 | 同上运行 5 分钟 | ≤ 20% |
| 滚动跟随 | 贴底时持续追加 | 48px 不变量成立，无可见跳动 |

【决策】任一项不达标，P1 改为“React 渲染外壳 + `ref` 直写流式正文”的混合模式，其余路线不变；混合模式仍不达标时，P1 暂停并回到字符串模板，只保留 P0 的 CSS 资产。

【决策】spike 结论写入本文件附录，作为 P1 的启动依据；不达标的数据不得用“后续优化”掩盖。

> **同步状态（重要）**
> 第 1–3 节已按 P0–P5 + spike 与统一术语改写；第 4 节起的 TODO、数据边界、验收矩阵、风险表、排除项仍沿用旧的「阶段一～五」编号与旧称，尚未同步。阅读第 4 节以后时，以第 2 节的阶段表为准，下一轮逐节改写。

## 3. 每阶段规格

### 3.1 P0：CSS 地基与骨架类

- **范围**：只处理「对话区最外层容器」：`main.conversation-pod`、画布 `.conv-canvas`、滚动流 `.conv-stream`、底部遮罩 `.conv-dock-scrim`；不进入消息行内部。
- **涉及文件**：
  - 新建 `packages/ui/src/styles/conversation.css`。
  - `packages/ui/src/components/MiddlePod/MiddlePod.ts:129-182`、`225-268`。
  - `packages/desktop/scripts/build.mjs:119-122` 之后。
  - `packages/desktop/src/renderer/index.html:7-8`。
  - `scripts/start-browser-live.mjs:159-160`。
  - 新建 `packages/ui/__tests__/conversation-skeleton.test.mjs`；改 `packages/ui/__tests__/layout.test.mjs:175`。
  - CDP harness 与全套几何断言不在本阶段，移到 P1（见第 4 节）。
- **交付物**：
  - CSS 文件包含四个结构选择器与一组 `--conv-*` 几何变量：`--conv-gutter-x: 32px`、`--conv-gutter-top: 24px`、`--conv-bottom-reserve: 180px`、`--conv-canvas-gap: 18px`、`--conv-dock-max: 740px`、`--conv-scrim-height: 120px`；其中 `--conv-dock-max` 只作几何断言常量，不接管 InputDock 内部定位。
  - 【决策】P0 变量值刻意镜像当前实现（含 `gap: 18px`），保证「纯搬家、零视觉变化」；规范值 16px 留到 P1 切换。
  - 四个容器加稳定钩子 `data-conv-layer="stage|canvas|stream|scrim"`，供静态测试与 CDP 几何断言使用。
- **视觉参数**：外层层级与尺寸完全沿用现状；不新增颜色、字号、阴影、圆角；`background` 阶段一用 `var(--background)`（与旧 `--bg-window` 同值，保证零视觉变化），P1 起切到规范值 `var(--panel)`。
- **验收标准**：
  - `dist/renderer/conversation.css` 存在；`index.html` 顺序为 `styles.css` → `conversation.css` → `tailwind.css`。
  - 四个容器不再依赖内联 `display/flex/padding/position/overflow` 等结构声明。
  - 静态守卫测试断言：四选择器存在、四个 `data-conv-layer` 钩子存在、link 顺序正确、无裸色值、无 `font-size: Npx`、无 `smooth`。
  - 改造前后 1440×900 截图无可解释差异；CDP 计算值断言（padding 24/32/180、遮罩 120、`scroll-behavior:auto`、无横向溢出）在 P1 接入。
- **风险与回滚**：CSS 未进产物或顺序错误会导致骨架塌陷；回滚只需撤销 `MiddlePod.ts` 的四个容器改动并移除 link，CSS 文件保留为空壳不影响运行。

### 3.2 P1：React 骨架（Stage / Stream / Turn）

- **范围**：对话区外壳、滚动容器、回合分组、空态/连接中/欢迎页；消息行内部仍暂用现有 HTML，P2 再组件化。
- **前置**：S 的结论决定流式策略（全量 React 或外壳 + `ref` 直写）。
- **架构约束（关键，必须一次做对）**：
  - 新增 `#react-conversation-host`，与 `#react-leftrail-host` 同法：`display:contents`，`createRoot` 只挂一次；`root.innerHTML` 全量重建时不得触碰该宿主。
  - 挂载函数 `mountConversation(host, getSnapshot, actions)` 与左轨同构：只推 props，不重建。
  - 组件树：`ConversationStage`（三态分派）→ `ConversationStream`（滚动）→ `TurnGroup`（回合）→ 消息内容占位。
  - 滚动 hook `useStreamFollow`：距底 ≤48px 跟随，否则不动；禁止 `smooth`；写后不回读几何。
- **交付物**：
  - 三个组件 + 一个滚动 hook；宿主挂载/更新函数。
  - `TurnGroup` 用 `memo`，流式期间不因无关 props 重渲染；消息 HTML 经 `dangerouslySetInnerHTML` 注入，P2 替换为组件。
  - 空态、连接中、欢迎页统一 `.conv-state`，与消息流共用同一内边距。
- **视觉参数**：画布 `padding: 24px 32px 180px`、`gap: 16px`、通栏、背景 `var(--panel)`；回合间距 16 / 紧凑 8；三档视口无横向溢出。
- **验收标准**：
  - 1920×1080、1440×900、1024×768 三档无横向滚动。
  - 距底 ≤48px 才贴底，回看历史时增量不改 `scrollTop`。
  - 流式期间 `TurnGroup` 渲染次数不随 token 增长（用计数断言，不靠肉眼）。
  - 5000 条消息性能用例仍通过（`packages/ui/__tests__/layout.test.mjs:621`）。
- **风险与回滚**：宿主被全量重建会导致 React 树丢失；回滚用特性开关切回字符串模板，宿主留空不影响现有渲染。

### 3.3 P2：消息壳与三类内容

- **范围**：`MessageRow`（user / assistant）、`MessageHeader`、`MessageFooter`、`ActionBar`、`MarkdownBlock`、`ThinkingBlock`、`ToolCapsule`、`ChangedFilesBar`；不进入审批、队列等卡片。
- **锚点策略（按 S 结论二选一）**：
  - 全量 React：正文由组件渲染，流式经外部 store 分片更新；`#msg-content-*` 等 ID 保留以兼容外部定位与测试，但不再是直写目标。
  - 混合模式：消息壳 React，正文与思考仍用 `ref` 直写，三个锚点继续有效。
- **交付物**：
  - 消息壳组件与三类内容组件；`TurnGroup` 内部改为组件组合，不再注入 HTML 字符串。
  - 工具卡改为数据驱动，`toolPatchQueue` 在 P2 验收后退役。
  - 事件从 `data-action` 委托改为 `onClick`，action 名（`copy-msg/rollback-msg/fork-msg`）保持不变，宿主迁移成本最低。
- **视觉参数**：用户气泡 `max-width: min(80%, 820px)`、圆角 `12px 12px 3px 12px`、内距 10/14、背景 `var(--chat-user-message-bg, var(--card))`；助手通栏；footer 仅在回合末条且非流式时出现。
- **验收标准**：三模式（普通 / Bot / 群聊）截图；三条增量通道各一条回归断言；流式期间不出现 footer；复制/回滚/Fork 行为与改造前一致；正文与思考不再有裸色值。
- **风险与回滚**：消息壳重写会改变 DOM 层级，可能影响滚动锚点；按消息类型灰度开关，异常时该类退回旧渲染。

### 3.4 P3：卡片容器（空壳）

- **范围**：`ApprovalCard`、`ConnectionCard`、`QueueTray`、`SubagentTrace`、`TodoPanel`、`NoticeCard`、`UnknownEntry`。
- **定位**：只做容器、状态钩子、空态与禁用态；不接数据、不实现业务逻辑、不改 ViewModel。
- **交付物**：
  - 七类卡片共用一套外壳（1px 细线、`var(--radius-card)`、L3 背景）；差异只靠状态、图标与槽位，禁止复制第二套结构。
  - 状态钩子：`data-request-state`、`data-connection-state`、`data-queue-state`、`data-subagent-status`、`data-revision`、`data-level`、`data-event-name`。
  - 缺失数据时渲染骨架或隐藏，禁止把“没数据”渲染成“已完成”。
- **视觉参数**：卡片内距 12/14，标题 12–13px，正文 12px；危险操作靠 `var(--destructive)`，不用大面积色块。
- **验收标准**：每类卡片至少有 empty / running / done 三态截图；未知类型能渲染兜底条；本轮不新增任何 ViewModel 字段。
- **风险与回滚**：卡片结构一旦被数据层提前绑死，后续字段变化要改组件；每张卡独立开关，默认关闭，异常时整卡隐藏。

### 3.5 P4：原子与样式变量收口

- **范围**：字阶、按钮、图标、徽标、时间戳、状态点、焦点环、动效、滚动条。
- **样式变量收口**：
  - 对话区内旧变量引用清零（`--bg-*`、`--text-*`、`--accent`），只留新变量。
  - 旧变量**定义**保留，供未迁移的 InputDock、InspectionPod、Modal、Group 使用；全站迁完再删。
  - 删除迁移期兜底写法 `var(--panel, var(--bg-panel))`。
- **交付物**：
  - 字阶先定口径：`docs/design-system/README.md` 写 7 档，`styles.css` 写 8 档（多 `--fs-overline`）；未定前只记录不改。
  - 按钮统一「22px 视觉 + 32px 热区」；焦点环 `var(--ring)`；动效只允许 120ms 进场 / 200ms 退场。
  - 清理对话区内的 `!important`、`animation: pulse 1.5s infinite`、`toggle-token-popover` 双绑定（宿主委托或组件本地，二选一）。
- **验收标准**：双主题截图通过；对话区无裸色值、无 `font-size: Npx`；无 `as any`；无 `scroll-behavior: smooth`；`npm run verify` 全绿。
- **风险与回滚**：字阶统一会改变大量行高，风险最高；回滚按「先恢复字号变量、再恢复选择器」两步，禁止一次性回退整阶段。

### 3.6 P5：web / mobile 接入

- **范围**：组件与样式的跨端复用；`density` 变体、44pt 触控热区、键盘避让、安全区、滚动容器差异。
- **原则**：不复制第二套组件或样式；差异只通过 `density`、`maxWidth`、平台能力注入。
- **交付物**：
  - `density: 'compact' | 'regular'` 与移动端热区规格；键盘弹起时输入舱与流容器联动。
  - 移动端安全区（`env(safe-area-inset-*)`）只作用于容器内距，不改组件结构。
- **验收标准**：web 与 mobile 真实运行截图；同一组件在三端渲染结果一致；移动端输入时无键盘遮挡。
- **风险与回滚**：WebView 对 `position: fixed`、滚动容器与键盘行为差异大；按端特性开关，异常时该端退回简化布局。

## 4. TODO 清单

### 4.1 阶段一（当天可执行）

| ID | 动作 | 文件:行 | 命令 / 产物 |
|---|---|---|---|
| P1-01 | 【决策】新建样式文件，写文件头：适用范围、层级约定、禁止事项、Token 依赖 | 新建 `packages/ui/src/styles/conversation.css` | 产物：文件存在 |
| P1-02 | 【决策】写入 `:root` 六个 `--conv-*` 几何变量，值镜像现状 | `conversation.css:1-20` | 产物：变量齐全 |
| P1-03 | 【决策】写入 `.conversation-pod`、`.conv-canvas`、`.conv-stream`、`.conv-dock-scrim` 四个结构选择器 | `conversation.css` | 产物：四选择器可 grep |
| P1-04 | 【决策】根容器改为 `class="flux-middle-pod conversation-pod"`，移除 flex/height/position/background/overflow/width 内联声明 | `MiddlePod.ts:227-237` | 产物：HTML 含 `data-conv-layer="stage"` |
| P1-05 | 【决策】滚动流改为 `class="messages-stream-area conv-stream"`，移除 flex/width/overflow/padding/box-sizing 内联声明 | `MiddlePod.ts:239-248` | 产物：`data-conv-layer="stream"` |
| P1-06 | 【决策】遮罩改为 `class="dock-scrim-fade conv-dock-scrim"`，移除绝对定位与渐变内联声明 | `MiddlePod.ts:253-262` | 产物：`data-conv-layer="scrim"` |
| P1-07 | 【决策】画布改为 `class="content-fluid-canvas conv-canvas"`，移除 width/max/margin/display/gap/position 内联声明 | `MiddlePod.ts:133` | 产物：`data-conv-layer="canvas"` |
| P1-08 | 【决策】在四个容器补 `data-conv-layer` 与 `data-conv-version="1"` | `MiddlePod.ts:133`、`227`、`239`、`253` | 产物：静态断言可定位 |
| P1-09 | 【决策】构建时复制 `conversation.css` 到 `dist/renderer/` | `build.mjs:122` 之后 | 产物：`packages/desktop/dist/renderer/conversation.css` |
| P1-10 | 【决策】HTML 在 `styles.css` 后、`tailwind.css` 前插入 link | `index.html:8` | 产物：三行顺序正确 |
| P1-11 | 【决策】浏览器直跑页同步插入 link | `start-browser-live.mjs:161` 前 | 产物：预览页加载新 CSS |
| P1-12 | 【决策】CDP harness 与几何断言移入阶段二，本阶段不碰测试 harness | — | 见 P2-07～P2-09 |
| P1-13 | 【决策】同上，阶段一不扩大当天范围 | — | 见 P2-07～P2-09 |
| P1-14 | 【决策】新增静态契约测试：四选择器、四 data 钩子、link 顺序、无裸色值、无 `font-size: Npx`、无 smooth；同步把既有 `layout.test.mjs:175` 的「内联 width」断言改为「类名 + data 钩子」，不得降低断言强度 | 新建 `packages/ui/__tests__/conversation-skeleton.test.mjs`；改 `packages/ui/__tests__/layout.test.mjs:175` | 命令：`node --test packages/ui/__tests__/conversation-skeleton.test.mjs` |
| P1-15 | 【决策】CDP 几何断言移入阶段二 | — | 见 P2-08 |
| P1-16 | 【决策】CDP 截图落盘移入阶段二 | — | 见 P2-09 |
| P1-17 | 【决策】构建并确认产物存在 | 无 | 命令：`npm run build:desktop`（根脚本已验证存在）；看 `dist/renderer/conversation.css` 与 `index.html` |
| P1-18 | 【决策】跑改动集门禁 | 无 | 命令：`npm run gates:changed`；标准：新增违规 0 |
| P1-19 | 【决策】跑严格类型 | 无 | 命令：`npm run typecheck`；标准：0 报错、无 `as any` |
| P1-20 | 【决策】跑目标单测 | 无 | 命令：`node --test packages/ui/__tests__/conversation-skeleton.test.mjs` |
| P1-21 | 【决策】跑全量单测 | 无 | 命令：`npm test`；标准：100% 绿灯 |
| P1-22 | 【决策】视觉验收并留档 | 无 | 看 1440×900 / 1920×1080 / 1024×768 截图；产物进 `artifacts/verification/` |

【决策】阶段一当天只允许改上述四个容器与交付链路；**禁止**顺手改用户气泡 82%、思考区色值、字号与工具胶囊。  
【事实】`npm test` 的 glob 已包含 `packages/ui/__tests__/**/*.test.mjs`，P1-14 无需改脚本。  
【事实】`packages/ui/__tests__/layout.test.mjs:175` 现在断言画布 HTML 里出现 `width: 100%`；阶段一移除内联宽度后该断言必然失败，P1-14 必须同步改为类名与 `data-conv-layer` 断言，不能直接删掉。  
【事实】`layout.test.mjs:188` 依赖 `class="flux-middle-pod` 前缀；根容器类名顺序必须保持 `flux-middle-pod` 在首位。

### 4.2 阶段二 TODO

- [ ] 【决策】P2-01 把 `--conv-canvas-gap` 由 18px 切到 16px，画布背景由 `--bg-window` 切到 `--panel`（`conversation.css`）。
- [ ] 【决策】P2-02 画布补齐 `width/max-width: 100%` 与 `box-sizing: border-box`，确认不引入 740px 限制（`conversation.css`）。
- [ ] 【决策】P2-03 滚动流补 `scroll-behavior: auto`、`overscroll-behavior: contain`、`scrollbar-gutter: stable`（`conversation.css`）。
- [ ] 【决策】P2-04 连接中、空会话、欢迎页统一 `.conv-state` 外壳（`MiddlePod.ts:137-144`、`270-454`）。
- [ ] 【建议】P2-05 分页提示改 `.conv-history-indicator`，保留现有 `hasOlderMessages` / `isLoadingOlder` 逻辑（`MiddlePod.ts:146-152`）。
- [ ] 【决策】P2-06 跑三档视口 CDP 与 5000 条性能用例（`npm run test:cdp`、`npm test`）。
- [ ] 【决策】P2-07 交互区与全链路 CDP harness 补 `conversation.css` link（`interactive-stage-harness.html:5`、`e2e-acceptance-harness.html:6`）。
- [ ] 【决策】P2-08 CDP 几何断言：画布 padding 24/32/180、遮罩 120、`scroll-behavior:auto`、三档视口无横向溢出（`interactive-stage-cdp.test.mjs`）。
- [ ] 【建议】P2-09 CDP 截图落盘，命名 `phase2-conv-canvas-<width>.png`。

### 4.3 阶段三 TODO

- [ ] 【决策】P3-01 用户气泡 `max-width` 改为 `min(80%, 820px)`（`MiddlePod.ts:582`）。
- [ ] 【决策】P3-02 用户气泡背景改 `var(--chat-user-message-bg, var(--card))`，去掉旧 `--bg-card` 直连（`MiddlePod.ts:583`）。
- [ ] 【决策】P3-03 助手行、头栏、底栏抽为 `.conv-message` / `.conv-message__header` / `.conv-message__footer` 结构类（`MiddlePod.ts:671-805`）。
- [ ] 【决策】P3-04 行上补 `data-role`、`data-conv-status`、`data-conv-mode`，本轮只写 `complete/streaming`（`MiddlePod.ts:580`、`671`）。
- [ ] 【决策】P3-05 保留 `data-action="copy-msg|rollback-msg|fork-msg"` 名称不变，回归宿主委托（`index.ts:6337-6355`）。
- [ ] 【决策】P3-06 三模式截图与操作项断言（普通 / Bot / 群聊），确认 Bot 与群聊不出现回滚/Fork。

### 4.4 阶段四 TODO

- [ ] 【决策】P4-01 思考块改 `.conv-thought`，删除 `MiddlePod.ts:817` 的重复 `style` 属性。
- [ ] 【决策】P4-02 思考左边线与正文色改 `var(--border-subtle)` / `var(--muted-foreground)`（`MiddlePod.ts:846-847`）。
- [ ] 【决策】P4-03 把 `styles.css:14-20` 的工具胶囊规则迁入 `conversation.css`，删除原处，避免双真值。
- [ ] 【决策】P4-04 diff 的加/减/行号/上下文色改用 `color-mix` 从语义 Token 派生（`MiddlePod.ts:1204-1205`、`1253-1254`、`1515-1516`、`1621-1629`）。
- [ ] 【决策】P4-05 子代理胶囊改 `.side-agent-capsule` 结构类，状态色继续用语义 Token（`MiddlePod.ts:188-223`）。
- [ ] 【决策】P4-06 锚点回归：流式正文、思考、工具补丁三条路径各跑一次（`index.ts:900/916/959`）。

### 4.5 阶段五 TODO

- [ ] 【决策】P5-01 全量清点 `font-size: Npx`，按 `--fs-*` 替换；先定 7 档 / 8 档口径。
- [ ] 【决策】P5-02 按钮统一桌面原子：22px 视觉、32px 热区；移动端 44pt 只写规格。
- [ ] 【决策】P5-03 动效统一 120ms / 200ms，替换 onboarding 的无限 pulse（`MiddlePod.ts:138`）。
- [ ] 【决策】P5-04 修复 `toggle-token-popover` 生产无处理分支的问题，宿主委托或组件本地二选一。
- [ ] 【建议】P5-05 评估 `packages/ui/package.json` 增加 CSS `exports`，不发布、不改移动端。
- [ ] 【决策】P5-06 跑 `npm run verify` 全量门禁，产出双主题、三视口截图矩阵。

## 5. 数据边界

### 5.1 对话区输入 ViewModel

> 【决策】对话区只读以下成形数据；字段缺失时降级为骨架，禁止从正文、工具名、时间戳反推业务含义。  
> 【决策】本轮不实现字段，只把契约固定下来；宿主适配器负责把网关与会话状态整理成该结构。

| 分组 | 字段 | 类型 | 提供方 | 本轮状态 |
|---|---|---|---|---|
| 舞台 | `sessionId` | string | 宿主 | 【事实】外部提供；仅用于 key 与日志，不参与渲染决策 |
| 舞台 | `mode` | `'scratchpad' \| 'foreground' \| 'group'` | 宿主派生 | 【建议】外部提供；阶段三用于操作项可用性 |
| 舞台 | `profileName` | string? | 宿主 | 【事实】已有，`MiddlePodProps:75` |
| 舞台 | `connection.status` | `'connected' \| 'connecting' \| 'disconnected'` | 宿主 | 【建议】由现有三布尔量归一，外部负责 |
| 舞台 | `isStreaming` | boolean | 宿主 | 【事实】已有，`MiddlePodProps:82` |
| 流 | `messages` | `ConversationMessageVM[]` | 宿主 | 【事实】已有；对话区只按给定顺序渲染 |
| 流 | `hasOlderMessages` | boolean | 宿主 | 【事实】已有，`MiddlePodProps:79` |
| 流 | `isLoadingOlder` | boolean | 宿主 | 【事实】已有，`MiddlePodProps:80` |
| 流 | `contextUsage` | `{used,max,percent}`? | 宿主 | 【事实】类型已有、调用点未传（`index.ts:5075-5088`）；本轮允许缺失 |
| 消息 | `id` | string | 宿主 | 【事实】已有；稳定主键，禁止用正文生成 |
| 消息 | `rowId` | number? | 宿主 | 【事实】已有；仅作回滚锚点，非正整数视为缺失 |
| 消息 | `role` | `'user' \| 'assistant' \| 'system'` | 宿主 | 【事实】已有 |
| 消息 | `content` | string | 宿主 | 【事实】已有；外部已完成 Markdown/纯文本归一 |
| 消息 | `timestamp` / `rawTimestamp` | string / number? | 宿主 | 【事实】已有；格式化由外部完成 |
| 消息 | `sender` / `senderAvatar` | string? | 宿主 | 【事实】已有；仅群聊与 Bot 使用 |
| 消息 | `model` | string? | 宿主 | 【事实】已有 |
| 消息 | `thought` | string? | 宿主 | 【事实】已有；对话区不判断完整/摘要 |
| 消息 | `thoughtDurationMs` | number? | 宿主 | 【事实】已有 |
| 消息 | `toolCalls` | `ToolCallVM[]` | 宿主 | 【事实】已有；分类结果由外部给定，对话区不再按名称猜 |
| 消息 | `durationMs` / `ttftMs` | number? | 宿主 | 【事实】已有；当前多处未赋值，缺失即不显示 |
| 消息 | `tokenMetrics` | `{total,input,output,tps,cacheHitPct}`? | 宿主 | 【事实】已有 |
| 消息 | `isGroupRoom` / `isBotRoom` | boolean? | 宿主 | 【事实】已有；等价于 `mode` 的旧口径，阶段三统一 |
| 消息 | `status` | `'pending' \| 'streaming' \| 'complete' \| 'error' \| 'interrupted'` | 宿主 | 【建议】外部待提供；阶段三只消费 `complete/streaming`，其余原样挂 `data-*` |
| 消息 | `partial` | boolean? | 宿主 | 【建议】外部待提供；本轮不显示标记 |
| 消息 | `error` | `{message,retryable?}`? | 宿主 | 【建议】外部待提供；本轮不做错误条 |
| 消息 | `attachments` | `AttachmentVM[]`? | 宿主 | 【建议】外部待提供；本轮不做附件块 |
| 旁路 | `sideAgentCapsules` | `SideAgentCapsuleView[]` | 宿主 | 【事实】已有；阶段四只改外壳 |
| 输入舱 | `dockHtml` | string | 宿主 | 【事实】已有；不透明 HTML，对话区不解析 |
| 连接态 | `testStatus` | `{ok,message,latency}`? | 宿主 | 【事实】已有；只服务 onboarding |

【决策】本轮明确不由对话区提供：`kind` 分类、`labels`、`inline_diff`、`todos`、`pending_approval`、`pending_connection`、`queued`、`moa.*`、`session.usage` 拉取。  
【决策】对话区禁止派生：消息排序、同主键合并、去重、摘要生成、工具名解析、时间戳补全、错误重试判断。

### 5.2 回调清单

| 回调 | 触发 | 载荷 | 现状 | 本轮 |
|---|---|---|---|---|
| `onCopyMessage` | 点击复制 | `{id, text}` | 【事实】`data-action="copy-msg"`，宿主 `index.ts:6340` | 保持名称与行为 |
| `onRollbackMessage` | 点击回滚 | `{id, rowId, text}` | 【事实】`data-action="rollback-msg"`，`index.ts:6346` | 保持名称与行为 |
| `onForkMessage` | 点击 Fork | `{id}` | 【事实】`data-action="fork-msg"`，`index.ts:6352` | 保持名称与行为 |
| `onLoadOlder` | 滚动到顶部附近 | 无 | 【事实】现有滚动加载逻辑在 `index.ts` | 不改，仅样式化提示 |
| `onToggleThought` | 展开/收起思考 | `{id, open}` | 【建议】当前用原生 `<details>`，无回调 | 阶段四可选；默认保持原生 |
| `onOpenToolDetail` | 点击工具胶囊 | `{toolId}` | 【建议】目标为右侧检查舱 | 本轮不接，只留 `data-tool-id` |
| `onToggleTokenMetrics` | 点击 Token 药丸 | `{id}` | 【事实】生产无分支，仅 CDP harness 有绑定 | 阶段五修复，不提前接 |
| `onRetryTurn` | 错误重试 | `{id}` | 【建议】需 `error` 字段 | 本轮不做 |

【决策】回调只表达「用户意图」，不得在表现层直接调用 RPC、写 Store、改缓存；宿主负责把意图映射到 Core。  
【决策】回调失败不得静默：宿主必须给出可见反馈；对话区不吞错、不把失败渲染成成功。

### 5.3 数据契约不变量

- 【决策】顺序即真相：对话区按 `messages` 给定顺序渲染，不排序、不按时间戳重排。
- 【决策】身份即真相：`id` 只用于 DOM 与本地生命周期；`rowId` 只用于回滚锚点；两者不得互相替代。
- 【决策】缺失即降级：字段缺失显示骨架或省略，不得用相似正文、最近一条工具、当前时间伪造。
- 【决策】状态即真相：`status` 由外部给定；表现层不得从 `content` 是否为空推断完成或失败。
- 【决策】单向只读：对话区不修改入参对象；需要派生展示值时只读计算，不写回。

### 5.4 数据流边界示意

```text
网关事件 / 恢复快照 / 本地队列
   → 宿主适配层（事件归并、字段补齐、排序去重、生成 id/rowId/status）
   → 只读 ViewModel
   → 对话区（只排版、层级、节奏、状态外观；不解析、不推断、不写回）
   → 用户意图
   → 宿主事件委托（复制 / 回滚 / Fork / 加载更早；失败反馈由宿主负责）
```

- 【决策】适配层与对话区的边界是「已成形 ViewModel」；适配层内部怎么合并、怎么补字段，不属于本计划。
- 【决策】对话区允许做纯展示归一：`undefined` 显示为空、`timestamp` 直接使用、`toolCalls` 按给定顺序渲染；不允许改变语义。
- 【决策】对话区不允许读取全局 Store、`window` 上的会话状态或网络客户端；所有数据从 props 进入。

## 6. Token 与样式治理

### 6.1 新旧 Token 收敛策略

- 【事实】新轨语义 Token 由 `packages/ui/src/tokens/skins.ts:13` 的 `SLOT_IDS` 定义；旧轨 `--bg-*` / `--text-*` / `--accent` 仍由 `styles.css:67-124` 自动生成并大量使用。
- 【决策】`conversation.css` 新代码一律使用新轨语义 Token；迁移期允许 `var(--panel, var(--bg-panel))` 形式兜底，阶段五统一移除兜底。
- 【决策】不在 `conversation.css` 重定义皮肤槽位；确需新语义（如 diff 底色）时，用 `color-mix` 从 `--success` / `--destructive` 派生，不新增十六进制。
- 【建议】几何只在 `conversation.css` 定义 `--conv-*`；禁止引用 `tokens.ts` 的 `DIMENSIONS`，避免 260/264/296 三套真值继续扩散。

### 6.2 语义类命名

- 【决策】结构类统一 `conv-` 前缀：`conv-canvas`、`conv-stream`、`conv-message`、`conv-thought`、`conv-tool`、`conv-dock-scrim`；舞台沿用既有 `.conversation-pod`，不新增 `conv-stage`，避免同一容器两个入口类。
- 【决策】状态只走 `data-*`：`data-conv-layer`、`data-conv-status`、`data-conv-mode`、`data-role`；禁止 `.is-red`、`.mt-4` 这类表现类。
- 【决策】保留既有 `flux-tool-capsule`、`side-agent-capsule` 等外部测试已依赖的类名；新增结构类与之并存，不重命名既有钩子。

### 6.3 级联与顺序

- 【事实】加载顺序为 `styles.css` → `conversation.css` → `tailwind.css`；`conversation.css` 可覆盖 `styles.css`，但 Tailwind utilities 后加载会覆盖同权重规则。
- 【决策】`conversation.css` 不新增 `!important`；`styles.css:11`、`16-19` 已有 `!important`，阶段四迁移时必须同步删除旧规则，不能双写。
- 【决策】选择器保持低复杂度：不使用 `:has()`、不做全后代通配、不在滚动容器上写 `transform`。

### 6.4 门禁现状与补丁

- 【事实】静态门禁默认扩展名不含 `.css`（`scanner.mjs:44`），`isSkinSurface` 也不含 `packages/ui/src/styles/`（`rules.mjs:23-30`），因此新 CSS 的裸色值不会被 `npm run gates` 拦住。
- 【事实】`.css` 会被 `isStyleSurface` 判为样式面（`changed.mjs:88`），所以样式审查仍会被触发。
- 【决策】阶段一新增 `conversation-skeleton.test.mjs` 作为 CSS 守卫：断言无 6 位十六进制、无 `rgba(`、无 `font-size: Npx`、无 `scroll-behavior: smooth`、必需选择器存在。
- 【建议】后续再评估把 `.css` 纳入 `listSourceFiles` 或给 `isSkinSurface` 增加样式目录；本轮不改门禁引擎，避免扩大风险面。

## 7. 验收与门禁

### 7.1 每阶段固定门禁

| 门禁 | 命令 | 通过标准 |
|---|---|---|
| 构建 | `npm run build` | 产物含 `conversation.css`，HTML 顺序正确 |
| 改动集静态 | `npm run gates:changed` | 新增违规 0 |
| 严格类型 | `npm run typecheck` | 0 TS 报错，无 `as any` |
| 全量单测 | `npm test` | 100% 绿灯 |
| 状态机形式化 | `npm run verify:formal` | 只有触碰状态机才跑；本计划预期不触碰 |
| 全量验收 | `npm run verify` | 阶段五与合并前必跑，全绿 |

### 7.2 视觉与几何验收

- 【决策】截图视口：1920×1080、1440×900、1024×768；模式：普通会话、Bot 工位、群聊；状态：空会话、流式中、长历史、错误/中止（阶段三后）。
- 【决策】截图统一落 `artifacts/verification/`，命名 `phase<N>-conv-<scene>-<width>.png`；未落盘视为未验收。
- 【决策】几何断言：画布 `padding` 24/32/180；遮罩 120；用户气泡 `min(80%,820px)`；输入舱 740；滚动流无横向溢出；`scroll-behavior: auto`。
- 【决策】截图必须基于真实 Blink 内核（Edge/Chrome headless），不得用 DOM 字符串断言替代视觉结论。
- 【建议】阶段一允许「与改造前无差异」作为通过标准；阶段二起才允许出现规范值带来的可解释差异。

### 7.3 性能与不变量

- 【决策】5000 条消息性能用例必须保持通过（`packages/ui/__tests__/layout.test.mjs:621`）。
- 【决策】滚动跟随阈值 48px 不变；流式期间任何增量不得在用户回看时改 `scrollTop`。
- 【决策】三个增量锚点 `#msg-content-*`、`#msg-thought-*`、`#msg-tools-*` 在阶段三、四改造后必须各有一条回归断言。
- 【建议】阶段二增加 `npm run test:perf` 记录基线，阶段五对比，避免 CSS 选择器导致长列表退化。

## 8. 风险清单

| # | 风险 | 触发条件 | 影响 | 缓解 | 回滚 |
|---|---|---|---|---|---|
| R1 | CSS 加载顺序或产物缺失 | link 顺序错、构建未复制、harness 未加 link | 骨架塌陷、样式全丢 | 静态测试断言顺序与产物；构建后人工看 `dist/renderer` | 移除 link 与复制语句，保留内联样式 |
| R2 | 迁移内联样式打断流式锚点 | 改动 `#msg-content-*` / `#msg-thought-*` / `#msg-tools-*` 或包裹层级 | 流式文本停止追加、工具补丁丢失 | 阶段一不碰消息内部；阶段三/四加锚点回归；CDP 流式用例 | 只回退对应阶段的消息壳提交，CSS 保留 |
| R3 | 两套 Token / 三套几何真值继续漂移 | 在 CSS 写死 296、在 TS 引用 `DIMENSIONS`、同时写新旧变量 | 左轨或主题改动不同步 | `conversation.css` 只引用 CSS 变量；不引用 TS 常量；阶段五收敛 | 删除 `--conv-*` 重复定义，恢复继承 |
| R4 | 新 CSS 绕过门禁 | `.css` 不在扫描扩展名内，裸色值仍全绿 | 换肤失效、浅色主题不可读 | 新增 CSS 守卫测试；样式审查强制；双主题截图 | 守卫测试失败即阻断合并 |
| R5 | 级联被 Tailwind utilities 覆盖 | 新类与 utility 同权重，且 utilities 后加载 | 局部样式失效、难定位 | 结构类只做布局；避免与 utility 同属性竞争；必要时提高选择器具体度而不加 `!important` | 回退该选择器，恢复内联 |
| R6 | 长会话性能退化 | 新增复杂选择器、`:has()`、每帧重排 | 滚动卡顿、流式掉帧 | 扁平选择器；5000 条性能门禁；不在滚动容器写 `transform` | 回退阶段二/四 CSS；保留原规则 |
| R7 | 数据边界被突破 | 缺少 `status/kind` 时从正文或工具名推断 | 错误卡片、错误状态、假成功 | 明确 VM 契约；缺失即降级；评审检查是否新增字符串推断 | 删除推断逻辑，恢复中性骨架 |
| R8 | 跨端复用造成 WebKit 问题 | 提前在移动端复用、使用 smooth/transform/固定高度 | 键盘弹起卡死、滚动抖动 | 本轮不导出、不实现移动端；CSS 禁用 smooth 与 transform；阶段五再评估 | 撤回 `exports`，桌面 CSS 独立保留 |
| R9 | 视觉回归覆盖不足 | 只截深色、只截一个视口 | 浅色主题或窄屏破版 | 三视口 × 双主题 × 三模式矩阵；截图落盘 | 以最近一次全绿截图为基线重跑 |
| R10 | 范围蔓延到解析/React 化 | 「顺手」改 `eventReducer`、`MessageViewModel`、组件框架 | 工期失控、回归面扩大 | 第 9 节硬排除；PR 描述逐条对照 | 拆出独立提案，不混入本计划 |

## 9. 不做什么

> 【决策】以下为硬排除项。出现任何一项，视为超出本轮范围，必须拆成独立计划。

- 【决策】不做事件消费与字段解析：不改 `eventReducer`、不接 `session.events.since`、不补 `tool.complete` 字段、不做 `display_kind` 判定。
- 【决策】不做工具分类：不按工具名子串判断读写，不从 `args` 猜路径/命令，不重建 diff。
- 【决策】不做数据层改造：不扩 `MessageViewModel` 实现、不改缓存、不改队列、不改乐观态与墓碑。
- 【决策】不 React 化：不新建 React 消息组件、不替换字符串模板、不迁移 `createRoot` 岛屿。
- 【决策】不做移动端 / Web 端落地：不写 Capacitor 适配、不改软键盘、不做 44pt 触控实现。
- 【决策】不改输入舱内部：不碰排队托盘、模型选择器、附件、斜杠、@ 提及、打断插队。
- 【决策】不做审批卡、连接卡、MoA、待办、通知、群聊消息流的实现；群聊只做外壳一致性，阶段四前不动 `GroupRoomView.ts`。
- 【决策】不改主题与皮肤：不新增色板、不改 `skins.ts`、不重定义 `SLOT_IDS`、不统一全站 Token。
- 【决策】不修左双轨 264/296、不改顶栏 42px、不改检查舱 410px、不拔除/恢复底栏。
- 【决策】不做全量字号替换：阶段五前只允许触碰当前阶段明确列出的块。
- 【决策】不做「顺手」动画、渐变、阴影、玻璃拟态、彩色光晕；不新增 `infinite` 关键帧。
- 【决策】不放宽测试：不删断言、不改成恒真断言、不引入 `as any`、不用字符串包含替代几何断言。
- 【决策】不修改契约生成物、不跑 `contract:doc` 覆盖、不手改 `docs/gateway/`。
- 【决策】不发布包、不升版本、不改 CI 配置、不动 `D:\ws\hermes-aura` 之外的仓库。

【决策】React 化不在本轮，但满足以下任意两条时立项评估：① 有交互的卡片类型 ≥ 8 类；② Web/Mobile 真正落地；③ 单个 `MiddlePod.ts` 超过 150KB，或改一处视觉要动三个地方。立项前先做 1–2 天 spike：React 渲染 5000 条消息窗口 + 模拟 50 token/s 流式，对比现有 `innerHTML` 路径的 FPS 与长任务；数据不过就不做。

---

【决策】执行顺序总结：先让 `conversation.css` 进入真实产物并锁住四个容器（阶段一），再谈画布与流（阶段二），然后才是消息壳（阶段三）、内容块（阶段四）与原子（阶段五）。任何阶段未过截图与门禁，不进入下一阶段。

---

## 10. 19 类内容的演进承接（本轮不做，位置先留）

> 【决策】样式层先占容器与状态钩子，数据由宿主注入；本轮不新增任何 ViewModel 字段、不解析任何事件。以下表格是后续阶段的接口登记，不是本轮交付。

| 内容类 | 目标容器类 | 状态钩子 | 进入条件 |
|---|---|---|---|
| C01 用户文本 | `.conv-message[data-role="user"]` | `data-conv-status` | 本轮已有 |
| C02 助手正文 | `.conv-message__body` | `data-conv-status` | 本轮已有 |
| C03 思考/推理 | `.conv-thought` | `data-expanded` | 本轮已有 |
| C04 工具通用 | `.conv-tool` | `data-tool-status` | 本轮已有外壳 |
| C05 文件读取 | `.conv-tool[data-tool-kind="read"]` | `data-tool-status` | 宿主提供 `kind` |
| C06 文件变更 | `.conv-tool__diff` | `data-diff-state` | 宿主提供 `inline_diff` |
| C07 命令/终端 | `.conv-tool[data-tool-kind="shell"]` | `data-process-state` | 宿主提供进程流 |
| C08 skill/connector/MCP | `.conv-tool[data-tool-kind="connector|mcp"]` | `data-tool-status` | 宿主提供 `labels` |
| C09 子代理委派 | `.conv-delegation` | `data-subagent-status` | 宿主提供 `subagent_id` 等 |
| C10 MoA 聚合 | `.conv-moa` | `data-moa-phase` | 宿主提供 `moa.*` 聚合结果 |
| C11 审批请求 | `.conv-approval` | `data-request-state` | 宿主提供 `pending_approval` |
| C12 连接请求 | `.conv-connection` | `data-connection-state` | 宿主提供 `connection.*` |
| C13 通知/告警 | `.conv-notice` | `data-level` | 宿主提供 `notification.*` |
| C14 待办清单 | `.conv-todo` | `data-revision` | 宿主提供 `todos` |
| C15 排队输入 | `.conv-queue` | `data-queue-state` | 宿主提供队列快照 |
| C16 错误/中止 | `.conv-turn-outcome` | `data-outcome` | 宿主提供 `status/error` |
| C17 附件 | `.conv-attachment` | `data-attachment-kind` | 宿主提供附件 VM |
| C18 群聊条目 | `.conv-group-entry` | `data-actor-kind` | 群聊外壳统一后 |
| C19 未知类型 | `.conv-unknown` | `data-event-name` | 白名单外的兜底 |

【决策】阶段归属：C05–C09 随阶段四内容块推进；C10–C15、C18、C19 属于 **P6 内容卡外壳**，在本轮五阶段之后单独立项；C11/C12 属 **P7 阻塞交互**，在 P6 之后。两阶段都只做样式容器与状态钩子，数据由宿主提供。
【决策】任何一类内容进入前必须同时满足：ViewModel 有对应字段、宿主确认真实数据来源、该类有至少一张真实截图。缺一项不得以占位样式宣称已支持。

---

## 附录 B：阶段完成定义（移植自候选 A）

- **L0 完成**：`conversation.css` 在桌面构建与 live preview 都能加载，四个容器完成类迁移，视觉无可解释差异，证据齐全。
- **L1/L2 完成**：画布与滚动流规则集中管理，四种页面状态结构未变，几何断言与三档视口截图通过。
- **L3 完成**：用户与助手消息壳规则集中管理，三模式权限与操作行为不变，锚点仍在。
- **L4 完成**：内容块样式可独立定位，裸色值清零，三条增量通道各有一条回归断言。
- **L5 完成**：原子控件状态语义词一，双主题与键盘焦点通过，`npm run verify` 全绿。
- **全计划完成**：五个阶段均有改动记录、截图、门禁结果、风险结论和阶段评审；未过证据的阶段不得宣称完成。

---

## 附录 C：React 流式渲染 spike 结果

【事实】环境：Edge headless、1440×900、5000 条消息、流式每帧追加一次（约 60 token/s），同一页面串行跑三种模式。原始数据：`artifacts/spike/result.json`。

| 模式 | 首屏挂载 | 滚动 FPS | 流式 FPS | 最大帧间隔 | 堆变化 |
|---|---:|---:|---:|---:|---:|
| React 结构 + `ref` 直写正文 | 176.5ms | 60.1 | **58.6** | 33.4ms | 7.3 → 5.0 MB（GC 后） |
| React 结构 + `setState` 每 token | 154.9ms | 60.0 | **37.1** | 50.1ms | 9.7 → 20.0 MB（+10.3） |
| 字符串模板 + `innerHTML` 整段重写 | 8.4ms | 60.1 | 60.0 | 16.8ms | 11.5 → 11.6 MB |

【决策】**P1 采用混合模式**：React 渲染结构，正文与思考用 `ref` 直写，禁止每 token `setState`。`setState` 每 token 的流式帧率只有 37 FPS，且堆持续增长，作为反例排除。

【事实】React 首屏挂载 176.5ms，比字符串拼接慢约 20 倍，但只发生一次；滚动帧率与字符串模式持平。

【事实】本 spike 的正文是纯文本，未包含 Markdown 渲染。真实路径中字符串模式每帧要对累计全文重跑 Markdown（O(n²)），因此上表对字符串模式偏有利；混合模式在真实场景不会更差。

【风险】`ref` 直写的最大帧间隔 33.4ms，略高于 32ms 目标线，属于单次抖动；P1 接入真实页面后必须用同一口径复测，不达标则把正文更新改为「每两帧合并一次」。

【约束】spike 源码在 `scripts/spike/`，产物在 `artifacts/spike/`，不进入生产包；结论只用于 P1 的技术选型。
