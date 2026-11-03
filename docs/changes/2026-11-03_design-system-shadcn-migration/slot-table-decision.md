# slot-table-decision — 皮肤槽位表定案（PR-1a 审计结论）

输入：`slot-audit-report.md`（scripts/design-audit/slot-audit.mjs v2 输出，可重跑）。本报告为槽表、扩展组、幽灵 Token 缺陷与 Inter 预算的裁决记录。

## 一、三源对账裁决

1. **registry 29 槽 ↔ styles.css 皮肤块：值零漂移、名全对齐。** F6 修正表述：真实问题不是"运行时两源打架"，而是"registry 生成链未接入运行时（applySkinToDom 零调用）+ styles.css 手写块独自生效 + tokens.ts 僵尸表"。两源合一（生成链替代手写块）后 registry 表即升格为唯一真值，风险低。
2. **suet-jade 幽灵皮肤**：CSS 有声明块（与 jade-white 共享）+ 5 条专属规则，registry 无实体。裁决：别名选择器保留一个大版本（`[data-theme="jade-white"], [data-theme="suet-jade"]` 由生成链一并产出，兼容存量 localStorage 值），注册表不建实体；皮肤专属规则按 §3 归槽后删除别名分支。
3. **badge 族 distinct=3/5 皮肤**：跨皮肤不恒同，**不满足归并节奏层条件**。但 15 槽/皮肤伤"皮肤表小而完备"目标。裁决：收编为"文件类型调色板"独立子表（palette: 3 个变体 × 5 类型 × bg/text/border），皮肤值只声明 `badge-palette: <变体id>` 一个槽。皮肤表 +1 槽替代 +15 槽，新增语言 badge 只扩调色板不扩皮肤接口。
4. **hl 族实测 5 槽**（comment/string/keyword/number/type，审查员记 4 漏 type）：代码高亮语义色，每皮肤独立值，保留扩展组 5 槽。
5. specular-line、theme-thumb-color、chat-user-message-bg 各 1 槽入扩展组；danger-color 并入设计内 `--destructive`。
6. **审计口径 artifact**（v3 待修）：`--token` 命中来自注释文本，脚本未剥离注释；不影响分类裁决（已人工定位）。

## 二、定案槽表

皮肤层 = **定案 43 槽**（U1 编码修订：原估 47 未计 --secondary/--muted 派生复用、--accent 名位保留给波③ cva recipe 不占皮肤槽、badge 族折叠为 1 个 palette 选择槽）。构成：底色 12（含 hover/active/衍生 secondary/muted）+ 前景字 4 + 品牌 8（含 ring）+ 状态 4 + 边框 3 + 阴影 3（每皮肤完整字符串）+ hl×5 + specular + thumb + chat-bubble + badge-palette×1。新增皮肤填一张 43 值表；`SLOT_IDS.length === 43` 对账单测已上线（skins-sot.test.mjs）。节奏层（`:root`）：--font-sans/--font-mono/--radius-*/--duration-*/--rail-w-*（运行时 setProperty 驱动，属几何持久化层非皮肤）。

## 三、Ghost Token 缺陷清单（PR-1a 必须顺手修复，修复即 G6 观感收益）

| 悬空变量 | 引用点 | 归槽方案 |
|---|---|---|
| `--bg-hover` | InputDock.ts:782/:836/:1020 | → `--card-hover`（已定案槽） |
| `--bg-surface-1` | InputDock.ts:380/:413/:605/:972、MiddlePod:1264/:1329（带回退） | → `--popover`；无回退 4 处直接改名 |
| `--bg-main` | LeftRail.ts:547 | → `--background` |
| `--success` | MiddlePod.ts:190 | → `--success`（本就是状态槽位设计，随核心表落地） |

7 个引用文件共 11 处。同时门禁新增探针 `theme/ghost-token`（引用面 ⊆ 定义面 反向对账，slot-audit 逻辑收编为常驻门禁），防复发——该缺陷此前未被任何门禁抓到，属于"同一坑写第二遍"的 Encode-in-structure 义务。

## 五、双审返工披露（FAIL 裁决后补记，均为声明过的裁决项）

1. cyber-matrix badge-palette=none：HEAD 该皮肤无 badge 变量，生成链不得凭空发色（P0）；其余四皮肤 badge 折叠为 3 个调色板（值恒同组归并）。
2. `--hl-type` 派生链修正为 `--hl-number`（观察：消费者本就有 `var(--hl-type, var(--hl-number, …))` 回退链，接 primary 会让 JSX 属性着色实变琥珀，接 hl-number 则运行时值与旧回退完全一致，零视觉 diff。此前 primary 派生为偏差，已改）。
3. `--danger-color` 在缺值皮肤以 `#EF4444` 输出：与 HEAD `:root` 全局值同值上提为皮肤槽（零视觉 diff），语义是 destructive 从节奏层升格皮肤层，未来各皮肤可调红。HEAD 对账守卫已把 :root 值并入合法来源。
4. `--warning` 常数 `#F59E0B` 为唯一声明的发明值（收编 StatusBar/Titlebar 既有硬编码琥珀），FAB 白名单入测。
5. 幽灵改名实为 **10 处**（InputDock 7、MiddlePod 2、LeftRail 1）；前报 11 把 MiddlePod:190 `var(--success)` 计入，该处非改名而是"定义升格自动归位"。汇报数字与 diff 对齐（审查 P2）。
6. :679-928 皮肤专属组件规则的逐条归槽/删除裁决移交 **PR-1b**（contract 判据行已改线申报）。

## 四、Inter 子集实测（S3 闭环，从"预算开放"升为"已证"）

| 方案 | 体积 |
|---|---|
| latin 单子集（variable，全字重一根轴） | **48,256 B ≈ 47.1KB** |
| latin + latin-ext | 133,324 B ≈ 130KB |
| 全子集 | 218,512 B ≈ 213KB |

预算 ≤400KB 的达标倍数 ≥8×。**裁决：捆绑 latin + latin-ext（130KB），CJK 走系统栈，`font-display: swap`**。降级预案保留（改 --font-sans 一行）。桌面/web/mobile 三端同捆。
