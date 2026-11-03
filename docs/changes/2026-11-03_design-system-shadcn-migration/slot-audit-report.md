# 三源皮肤真值面审计报告 v3（scripts/design-audit/slot-audit.mjs 输出，可重跑）

生成时点：2026-11-03T09:49:48.315Z。重跑本脚本会覆写本报告，引用时以时点为准。v3 变更：:root 节奏层与运行时几何白名单并入定义面，消 v2 "引用面裸奔"误报（审查 P1）。

registry 槽数=29 registry 皮肤=[obsidian-gold, jade-white, ayu-light, warm-paper, cyber-matrix] css 皮肤=[obsidian-gold, jade-white, suet-jade, warm-paper, ayu-light, cyber-matrix] 变量宇宙=89 OK=54


## 非 OK 分类（槽表定案的直接输入）

| 变量 | 注册表 | CSS块 | 引用文件数 | 分类 |
|---|---|---|---|---|
| `--background` |  | ✓ | 1 | GAP·CSS有值组件在用但注册表缺槽 |
| `--badge-css-bg` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--badge-css-border` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--badge-css-text` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--badge-html-bg` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--badge-html-border` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--badge-html-text` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--badge-js-bg` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--badge-js-border` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--badge-js-text` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--badge-py-bg` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--badge-py-border` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--badge-py-text` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--badge-ts-bg` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--badge-ts-border` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--badge-ts-text` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--card-hover` |  | ✓ | 1 | GAP·CSS有值组件在用但注册表缺槽 |
| `--chat-user-message-bg` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--danger-color` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--duration-fast` |  |  | 1 | OK·节奏层(:root 定义) |
| `--font-mono` |  |  | 10 | OK·节奏层(:root 定义) |
| `--font-sans` |  |  | 4 | OK·节奏层(:root 定义) |
| `--hl-comment` |  | ✓ | 1 | GAP·CSS有值组件在用但注册表缺槽 |
| `--hl-keyword` |  | ✓ | 1 | GAP·CSS有值组件在用但注册表缺槽 |
| `--hl-number` |  | ✓ | 1 | GAP·CSS有值组件在用但注册表缺槽 |
| `--hl-string` |  | ✓ | 1 | GAP·CSS有值组件在用但注册表缺槽 |
| `--hl-type` |  | ✓ | 1 | GAP·CSS有值组件在用但注册表缺槽 |
| `--popover` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--radius-window` |  |  | 2 | OK·节奏层(:root 定义) |
| `--rail-w-left` |  |  | 1 | OK·运行时几何(setProperty) |
| `--rail-w-right` |  |  | 1 | OK·运行时几何(setProperty) |
| `--specular-line` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--success` |  | ✓ | 1 | GAP·CSS有值组件在用但注册表缺槽 |
| `--theme-thumb-color` |  | ✓ | 2 | GAP·CSS有值组件在用但注册表缺槽 |
| `--token` |  |  | 3 | GAP·引用面裸奔（皮肤块/注册表/:root 三处都无值） |

## registry 与 styles.css 值漂移（F6 量化）

- （无漂移或 registry 解析 0 皮肤，须核查）

## CSS 侧扩展槽候选（53 个，均不在 registry 29 槽内）

- --backdrop  `  ` --background  `  ` --badge-css-bg  `  ` --badge-css-border  `  ` --badge-css-text  `  ` --badge-html-bg  `  ` --badge-html-border  `  ` --badge-html-text  `  ` --badge-js-bg  `  ` --badge-js-border  `  ` --badge-js-text  `  ` --badge-py-bg  `  ` --badge-py-border  `  ` --badge-py-text  `  ` --badge-ts-bg  `  ` --badge-ts-border  `  ` --badge-ts-text  `  ` --border  `  ` --card  `  ` --card-active  `  ` --card-hover  `  ` --chat-user-message-bg  `  ` --code  `  ` --danger-color  `  ` --destructive  `  ` --faint  `  ` --foreground  `  ` --hl-comment  `  ` --hl-keyword  `  ` --hl-number  `  ` --hl-string  `  ` --hl-type  `  ` --input  `  ` --muted  `  ` --muted-foreground  `  ` --panel  `  ` --popover  `  ` --primary  `  ` --primary-border  `  ` --primary-dim  `  ` --primary-foreground  `  ` --primary-glow  `  ` --primary-hover  `  ` --primary-subtle  `  ` --ring  `  ` --secondary  `  ` --secondary-foreground  `  ` --sidebar  `  ` --specular-line  `  ` --success  `  ` --success-glow  `  ` --theme-thumb-color  `  ` --warning

## badge 族跨皮肤恒同裁决（不同值数=1 → 归并节奏层候选）

| 变量 | 有值皮肤数 | 不同值数 |
|---|---|---|
| `--badge-css-bg` | 5 | 3 |
| `--badge-css-border` | 5 | 3 |
| `--badge-css-text` | 5 | 3 |
| `--badge-html-bg` | 5 | 3 |
| `--badge-html-border` | 5 | 3 |
| `--badge-html-text` | 5 | 3 |
| `--badge-js-bg` | 5 | 3 |
| `--badge-js-border` | 5 | 3 |
| `--badge-js-text` | 5 | 3 |
| `--badge-py-bg` | 5 | 3 |
| `--badge-py-border` | 5 | 3 |
| `--badge-py-text` | 5 | 3 |
| `--badge-ts-bg` | 5 | 3 |
| `--badge-ts-border` | 5 | 3 |
| `--badge-ts-text` | 5 | 3 |

## 皮肤专属组件规则（波①1a 逐条归槽/删除/diff 输入）

- **jade-white**（5 条）：`[data-theme="jade-white"] .session-item.active, [data-theme="suet-jade"] .session-item.active, [data`; `[data-theme="jade-white"] .rail-primary-agent-card.active, [data-theme="suet-jade"] .rail-primary-ag`; `[data-theme="jade-white"] #session-search-input, [data-theme="suet-jade"] #session-search-input, [da`; `[data-theme="jade-white"] #conversation-stream, [data-theme="jade-white"] .middle-conversation-pod, `; `[data-theme="jade-white"] .win-cap-btn:hover, [data-theme="suet-jade"] .win-cap-btn:hover, [data-var`
- **suet-jade**（5 条）：`[data-theme="jade-white"] .session-item.active, [data-theme="suet-jade"] .session-item.active, [data`; `[data-theme="jade-white"] .rail-primary-agent-card.active, [data-theme="suet-jade"] .rail-primary-ag`; `[data-theme="jade-white"] #session-search-input, [data-theme="suet-jade"] #session-search-input, [da`; `[data-theme="jade-white"] #conversation-stream, [data-theme="jade-white"] .middle-conversation-pod, `; `[data-theme="jade-white"] .win-cap-btn:hover, [data-theme="suet-jade"] .win-cap-btn:hover, [data-var`
- **warm-paper**（5 条）：`[data-theme="warm-paper"] #flux-left-rail, [data-theme="warm-paper"] .flux-left-rail`; `[data-theme="warm-paper"] #conversation-stream, [data-theme="warm-paper"] .middle-conversation-pod`; `[data-theme="warm-paper"] .session-item.active`; `[data-theme="warm-paper"] .rail-primary-agent-card.active`; `[data-theme="warm-paper"] #session-search-input`
- **ayu-light**（8 条）：`[data-theme="ayu-light"] #flux-left-rail, [data-theme="ayu-light"] .flux-left-rail`; `[data-theme="ayu-light"] #conversation-stream, [data-theme="ayu-light"] .middle-conversation-pod`; `[data-theme="ayu-light"] .session-item.active`; `[data-theme="ayu-light"] .rail-primary-agent-card.active`; `[data-theme="ayu-light"] #session-search-input`; `[data-theme="ayu-light"] .user-bubble`; `[data-theme="ayu-light"] .composer-dock`; `[data-theme="ayu-light"] .composer-dock:focus-within`

## 皮肤名对账

- 幽灵（CSS 有 registry 无）：suet-jade
- 无运行时 CSS 块（registry 有 CSS 无）：无