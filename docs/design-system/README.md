# Hermes Flux 设计系统与美学方法论总索引

> **设计总监寄语**：
> “高级美学不是浮夸装饰的堆砌，而是对**黑色的层次、光的衰减、微距边框、数学秩序与呼吸流动感**的极致掌控。顶级 UI/UE 设计工作流是以认知心智为底座、瑞士网格与排版韵律为骨架、语义化 Token 为血液、跨端物理触感为灵魂的工程闭环。”

---

## 目录导航

| 文档 | 模块定位 | 核心要点 |
|---|---|---|
| [`01-classic-books-and-theories.md`](01-classic-books-and-theories.md) | **经典著作研读与理论模型萃取** | 涵盖 Norman 认知心理学、Cooper 交互精髓、Müller-Brockmann 网格法则、Bringhurst 排版圣经、三大平台原生指南与 Atomic Design。 |
| [`02-aesthetic-philosophy-and-standards.md`](02-aesthetic-philosophy-and-standards.md) | **美学哲学与鉴赏标准** | 深度解构“什么叫高级（克制与降噪）”、“什么叫美（数学比例与呼吸感）”、“什么叫漂亮（精细质感与灵动微交互）”。 |
| [`03-director-design-workflow.md`](03-director-design-workflow.md) | **总监级跨端全流程设计工作流 (SOP)** | 从心智模型解构、信息架构、Token 架构、跨端界面打磨、动效物理学到 8 大交付验收门禁的 6 阶段标准 SOP。 |
| [`04-tokens-and-design-system-spec.md`](04-tokens-and-design-system-spec.md) | **跨端设计系统与 Token 规范（editorial / marketing 姿态）** | 几何/字体栈/DTCG/断点为跨姿态通用；Slate 色表、36px/700 字阶、双光源阴影、Spring 参数**仅 editorial 生效**。已标注迁移说明，工程皮肤真值见 [`theme-engine-spec.md`](../architecture/theme-engine-spec.md)。 |
| **审美宪法（元层，外部权威）** | Aura 工作区 `specs/05-…` | 六条不变量 I1–I6 + 五步推导算法；**Hermes Flux 默认 `tool` 姿态以此为准**，是所有规范冲突的唯一裁决者。 |
| [`settings-interaction-and-ui-spec.md`](settings-interaction-and-ui-spec.md) | **设置中心交互与 UI 终极设计规范** | 居中沉浸式指挥模态、极客双模（表单↔YAML）、三级作用域级联指示器、0延迟全文检索与移动端下钻栈。 |
| [`visual-directions.md`](visual-directions.md) | **Aura 首批 4 套顶级美学视觉方向** | 黑曜琥珀 (Obsidian Gold)、赛博银翼 (Titanium Frost)、深邃紫域 (Astral Void)、纸墨微光 (Mono Minimal)。 |

---

## 跨端美学三棱镜模型

```
                     [ 高级 Sophisticated ]
                     克制 / 降噪 / 秩序 / 隐形
                              ▲
                             / \
                            /   \
                           /     \
    [ 美 Aesthetic ]      ◄───────►      [ 漂亮 Striking ]
  比例 / 负空间 / 排版韵律               微质感 / 物理动效 / 微交互
```

1. **高级（Sophisticated）**：让界面退后，让信息与任务前置。依靠严密的 8pt 空间节奏和层级自洽，消除一切不必要的视觉噪音。
2. **美（Aesthetic）**：建立在黄金分割与瑞士网格之上的数学和谐，字距、行高、留白如建筑般稳固而富有韵律。
3. **漂亮（Striking & Delightful）· 仅 editorial / marketing 姿态**：像素级的平滑连续曲率（Squircle）、真实物理环境映射的双光源阴影、符合自然惯性（Spring Damping）的动效微反馈。
   > **`tool` 姿态（会话 / Agent / 工具执行 / 三舱工作台）不适用**：按宪法 I1/I4/I6 → 零装饰、1px 发丝线、零静态阴影、动效只承载状态变化。

---

## 跨端落地准则 (Desktop / Web / Mobile)

- **移动端（Mobile iOS/Android）**：聚焦触控热区（≥44pt/48dp）、安全区避让、拇指自然操作扇形区、原生触觉反馈（Haptics）与手势中断平滑性。
- **桌面原生端（macOS/Windows）**：聚焦高密度信息承载、键盘快捷键全覆盖、鼠标悬停与右键上下文菜单、多窗口状态记忆与亚克力/云母材质融合。
- **PC Web 响应式**：聚焦流式弹性栅格（Fluid Grid）、移动端到超宽带屏的多断点自适应、CLS（累积布局偏移）为零与纯键盘可访问性（WCAG 2.1 AA）。

---

## 设计真值链与姿态分治（Design Truth Chain）

> 本仓库历史上存在**两套互相矛盾的美学指令**：`02`/`03`/`04`/`README` 描述
> 双光源阴影 + 60-30-10 + Spring + Squircle，而 Hermes Flux 工作台实际是 `tool` 姿态，
> 按宪法应为零阴影 / 98% 中性 / 动效只承载状态。现统一裁决如下：

| 层级 | 文档 | 定位 |
|---|---|---|
| **L-1** | **Aura 工作区 `specs/05-aesthetic-constitution-and-skin-derivation.md`** | **元层裁决者**，I1–I6 全姿态生效 |
| L0 | 本仓库 `AGENTS.md` | 工程纪律与文档索引 |
| L1 | `docs/design-system/02-…` | 美学哲学（含 posture 分治矩阵） |
| L2 | `docs/design-system/04-…` | **editorial / marketing 姿态** Token 字典 |
| L2′ | `specs/skins/linear-dark.json`（Aura 工作区） | **tool 姿态** L2 映射（Hermes Flux 默认） |
| ENG | `docs/architecture/theme-engine-spec.md` | **工程契约真值**（43 槽完备性），不等于美学真值 |

**姿态判定**：三舱工作台 / 会话 / Agent / 工具执行 = `tool`（默认）；展示页 / 营销页 = `marketing`；编辑排版页 = `editorial`。
**冲突时以宪法 + posture 为准，不得自行调和数值。**

⚠️ **已知待办（P1 契约中立化）**：43 槽中的 `--primary-glow` / `--success-glow` /
`--shadow-window|card|dock` 为**必填槽**，等于强制每套皮肤携带光晕与静态阴影；
`badge-palette` 用 5 个色相区分语言，与宪法 I3 单色公理冲突。
在契约中立化前，**不要仅凭 `theme-engine-spec.md` 生成 tool 姿态皮肤**。

防复发：改动任一规范后跑 `node /opt/data/profiles/aura/workspace/specs/aesthetic-invariants.mjs consistency`。
