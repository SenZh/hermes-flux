# PR-1b 样式层组件规则裁决报告 (styles.css :679-1089)

日期：2026-11-03  
执行泳道：PR-1b（门禁探针 + 皮肤专属规则裁决）  
输入源：`packages/desktop/src/renderer/styles.css` 标记区外 :679-1089 区间规则集

---

## 一、裁决背景与核心原则

在 Phase 1 设计中（`tech-design.md` §2.1 与 `design-review.md` #11），当前前端的一大痛点是 `styles.css` 在标记区外存在大量针对特定皮肤（`jade-white`, `warm-paper`, `ayu-light`, `suet-jade`）的特异选择器（`.session-item.active`, `#conversation-stream`, `.composer-dock` 等），导致样式层级被高优先级选择器穿透覆盖，架空了语义 Token。

本裁决的目标：
1. **逐条判定归宿**：在 "可由槽+recipe 表达（标波③迁移）"、"冗余可删"、"保留（理由）" 三者中严格定性；
2. **零破坏性执行**：只裁决、不提前改动主体 `styles.css`（波③ React 舱迁移时随各舱组件与皮肤系统一同演进，避免与 PR-1a/1c 产生代码合并冲突）；
3. **suet-jade 纯别名核对**：实证确认 `suet-jade` 选择器已全部并入 `jade-white` 同条，不存在孤立别名规则。

---

## 二、suet-jade 别名选择器核验结论

经代码实测扫描，`styles.css` 中所有 `suet-jade` 规则行均已与 `jade-white`、`[data-variant="light"]` 在同一个选择器列表中组合声明：
- 行 834-836：`[data-theme="jade-white"] .session-item.active, [data-theme="suet-jade"] .session-item.active, [data-variant="light"] .session-item.active`
- 行 842-844：`[data-theme="jade-white"] .rail-primary-agent-card.active, [data-theme="suet-jade"] .rail-primary-agent-card.active, [data-variant="light"] .rail-primary-agent-card.active`
- 行 851-853：`[data-theme="jade-white"] #session-search-input, [data-theme="suet-jade"] #session-search-input, [data-variant="light"] #session-search-input`
- 行 859-864：`[data-theme="jade-white"] #conversation-stream, [data-theme="suet-jade"] #conversation-stream, [data-variant="light"] #conversation-stream, ...`
- 行 934-936：`[data-theme="jade-white"] .win-cap-btn:hover, [data-theme="suet-jade"] .win-cap-btn:hover, [data-variant="light"] .win-cap-btn:hover`

**结论**：`styles.css` 中不存在任何独立的 `suet-jade` 规则行。该别名在运行时与 `jade-white` 表现完全等价，在波③舱级迁移时随特定选择器清理一并退役。

---

## 三、逐条规则裁决表 (:679 - :1089)

| 行号区间 | 目标选择器 / 规则块 | 核心样式内容 | 裁决结果 (三选一) | 理由与落地路径说明 |
|---|---|---|---|---|
| :680-682 | `.tool-chevron` | `transition: transform 0.15s ease;` | **保留（理由）** | 工具折叠胶囊通用动画过渡，非皮肤特异样式，跨端通用。 |
| :684-687 | `.tool-file-link:hover` | `color: var(--accent-hover) !important;` | **可由槽+recipe 表达（标波③迁移）** | 波③ MiddlePod 迁移为 React Link 组件时，以 `hover:text-primary-hover` recipe 表达。 |
| :689-696 | `.tool-changed-files-bar` | flex 布局与间距 | **可由槽+recipe 表达（标波③迁移）** | 纯布局容器，波③迁移时直接采用 Tailwind flex/gap 工具类。 |
| :698-711 | `.tool-changed-chip` | 胶囊背景、边框、字体、字号 | **可由槽+recipe 表达（标波③迁移）** | 波③作为原子 Badge 变体，消费 `--panel`、`--border-subtle` 与 `--fs-caption`。 |
| :713-717 | `.tool-changed-chip:hover` | hover 底色与边框色 | **可由槽+recipe 表达（标波③迁移）** | 波③由 Badge 的 hover recipe 变体承载。 |
| :734-815 | `@media (max-width: 768px)` | 移动端左轨抽屉化、会话流通栏、输入舱避让、44px 触控保护 | **保留（理由）** | 核心全平台响应式几何不变量，受单测 `responsive-layout.test.mjs` 硬守护，波④移动端独立壳前必须维持。 |
| :818-821 | `.msg-action-btn:hover` | 操作栏图标 hover 反馈 | **可由槽+recipe 表达（标波③迁移）** | 波③消息行操作栏组件使用 shadcn Button `variant="ghost"` 统一收编。 |
| :828-832 | `.session-item.active` | 默认选中左侧强调色指示线 | **可由槽+recipe 表达（标波③迁移）** | 左轨会话条目选中态，波③ LeftRail 迁移为 React 列表时转为 cva active recipe。 |
| :834-840 | `[data-theme="jade-white"] .session-item.active, [data-theme="suet-jade"] ..., [data-variant="light"] ...` | 浅色模式阴影微调与边框压淡 | **可由槽+recipe 表达（标波③迁移）** | `--shadow-card` 与 `--border-subtle` 在 43 槽表中已逐皮肤差异化定义，无需在外部手写选择器分叉覆写。 |
| :842-848 | `[data-theme="jade-white"] .rail-primary-agent-card.active, ...` | 浅色专职 Bot 卡片选中微调 | **可由槽+recipe 表达（标波③迁移）** | 波③ BotProfileCard 组件直接消费 `--card` 与 `--primary-border` 槽。 |
| :850-856 | `[data-theme="jade-white"] #session-search-input, ...` | `background: var(--bg-card); border-color: ...` | **冗余可删** | `jade-white` 槽表里的 `--input` 已经等于 `#FFFFFF`（`var(--card)`），默认类名已自动满足，此条规则完全冗余。 |
| :858-866 | `[data-theme="jade-white"] #conversation-stream, ... .middle-conversation-pod` | `background: #FFFFFF;` | **可由槽+recipe 表达（标波③迁移）** | 硬编码 `#FFFFFF` 实为该皮肤的 `--background` 槽值，波③ MiddlePod 根容器直接挂接 `bg-background`，拔除此特异规则。 |
| :868-873 | `.code-block-wrapper` | 代码块容器背景、边框、阴影 | **保留（理由）** | 已完全 Token 化（`--code`, `--border-subtle`, `--shadow-card`），波③ Markdown 模块迁移时前置保留。 |
| :875-884 | `code:not(pre code)` | 出版级行内代码排版与中性底色 | **保留（理由）** | 专项重塑的出版级中性排版基线，已完全 Token 化，波③仅需将 11.5px 替换为 `--fs-aux: 12px` 变量。 |
| :886-893 | `.tool-file-link.content-interactive-link` 及 hover | 交互文件链接文字与下划线色 | **可由槽+recipe 表达（标波③迁移）** | 波③ MiddlePod 链接组件通过 Tailwind 交互类表达。 |
| :894-897 | `.code-block-wrapper > div:first-child` | 代码块标题栏底色与底边框 | **可由槽+recipe 表达（标波③迁移）** | 波③ Markdown CodeBlock 头部子组件直接内联。 |
| :898-906 | `.btn-copy-code` 及 hover | 代码复制按钮 | **可由槽+recipe 表达（标波③迁移）** | 波③替换为标准 shadcn Button `variant="ghost"`。 |
| :908-921 | `.composer-dock`, `.composer-textarea` | 浮动输入舱背景、圆角、阴影、占位符 | **可由槽+recipe 表达（标波③迁移）** | 已完全 Token 化（`--card`, `--border-subtle`, `--shadow-dock`），波③迁移至 InputDock React 根容器。 |
| :923-931 | `.micro-pill-option` 及 hover | 输入舱微胶囊选项 | **可由槽+recipe 表达（标波③迁移）** | 波③迁移为 InputDock 内部微型选项 Badge。 |
| :933-939 | `[data-theme="jade-white"] .win-cap-btn:hover, ...` | 浅色窗控 hover 压暗透明度 | **保留（理由）** | 桌面端 Windows 平台原生窗控在浅色下的必要视觉反馈，非普通 UI 像素。 |
| :941-946 | `blockquote` | Markdown 引用块侧边条与背景 | **保留（理由）** | 已完全 Token 化（`--primary`, `--primary-subtle`），排版标准基线。 |
| :948-1003 | `.theme-preview-card-*` | 5 款皮肤色卡缩略图（深/浅/暖/晨曦/赛博） | **保留（理由）** | 换肤选择器内的静态预览色标，各色卡必须忠实展示对应皮肤的核心色相（不受当前激活皮肤影响），属于合法的静态展示资产。 |
| :1004-1006 | `.settings-theme-btn.active` | 皮肤按钮激活发光描边 | **可由槽+recipe 表达（标波③迁移）** | 波③由组件的选中状态 recipe 表达。 |
| :1008-1035 | `[data-theme="warm-paper"]` 专属组件规则 (左轨/对话区/选中卡片/搜索框) | 强制重写背景为 `--bg-rail` / `--bg-card`，取消左侧高亮边 | **可由槽+recipe 表达（标波③迁移）** | warm-paper 的 43 槽表已将 `--background`、`--sidebar` 定准；左侧指示线有无收敛至侧栏条目的 variant recipe，消灭特异选择器。 |
| :1037-1081 | `[data-theme="ayu-light"]` 专属组件规则 (左轨/对话区/气泡/输入框边框) | 强制重写底色、中性石板边框微调 | **可由槽+recipe 表达（标波③迁移）** | 气泡已由 `--chat-user-message-bg` 覆盖；输入框石板边框由 `--primary-border` 覆盖，波③组件统一消费即可消除分叉覆写。 |

---

## 四、裁决统计与后续落地建议

- **总裁决条目数**：25 块规则；
- **可由槽+recipe 表达（标波③迁移）**：17 条（占 68%）；
- **冗余可删**：1 条（占 4%）；
- **保留（理由）**：7 条（占 28%，涵盖响应式媒体查询、出版级行内代码、Markdown 通用容器、原生窗控与皮肤静态色卡）。

**执行安全动作确认**：
1. 本 PR（PR-1b）不触碰 `styles.css` 核心样式主体，保持与 PR-1a（生成链与真值表）及 PR-1c（废弃僵尸表）的零冲突；
2. 本裁决表作为波③（desktop React 化按舱分单）的权威输入，每迁移一个舱（LeftRail / InputDock / MiddlePod / SettingsModal），按本表指引销毁对应的旧特异规则。
