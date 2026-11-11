---
target: conversation 区设计（字号/间距/颜色）
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 4
target_identity: "file:D:\\workspace\\hermes-aura\\packages\\ui\\src\\styles\\conversation.css"
target_fingerprint: "sha256:4736dc7274ae39f075fd5bead0bf760cc1b87dac42a44ac3cc217fb26d8fea7e"
target_path: "D:\\workspace\\hermes-aura\\packages\\ui\\src\\styles\\conversation.css"
timestamp: 2026-11-06T10-47-50Z
slug: packages-ui-src-styles-conversation-css
---
Method: dual-agent (A: flux-style-reviewer · B: general；两评估隔离并行，A 完成前未注入 B 的检测器结果)

# 🎨 Hermes Flux conversation 区 UI & Style Review

- **审查判定：REVISE（FAIL，一票否决）** — P0×1 / P1×4 / P2×4
- **审查范围**：用户点名的三维度（文字大小·字号 / 间距 / 颜色），按 `docs/design-system/style-review-spec.md` 六大维度核验
- **触碰文件**：`packages/ui/src/styles/conversation.css`（主）、`packages/ui/src/components-react/conversation/*.tsx`、`packages/desktop/src/renderer/styles.css`（Token 真值面）、`packages/ui/src/tailwind-entry.css`、`packages/ui/src/tokens/skins.ts`（皮肤生成源）

## 结论先行

骨架是克制的：`conversation.css` 全文 100% `var(--*)`、零裸色相、零 `font-size: Npx` 字面量，中性 `--panel` 基底 + 1px `--border-subtle` 发丝线、无光晕渐变、无 `infinite` 动效、滚动容器 `scroll-behavior: auto` 且无 `transform`，符合「界面退后、内容主角」。但排版与色彩真值存在硬缺陷，且门禁 `--changed` 的空跑全绿不构成放行依据：**运行时 `--fs-micro` 是 9px 而非规范 10px，行高出现 26px/18px 越界，8 组间距脱离 4pt 网格，最严重的是 `--muted-foreground` 在默认深色皮肤仅 3.17:1、浅色仅 2.54:1，12 处元数据在浅色下几不可读。**

## 一、三维度核验总览

| 维度 | 规范真值 | 运行时实测（默认 obsidian-gold） | 判定 |
|---|---|---|---|
| 字号 / 字阶 | 7 档整数阶梯，`--fs-micro=10px/12px` | 实际 8 档（多 `--fs-overline:10px`），`--fs-micro=9px`；正文 13px/19px 正确 | **不合规 P1** |
| 行高 | `{28,22,20,19,16,14,12}` 与字号锁定 | 26px（思考/工具行）、18px（思考正文）越界；16px 配 9px micro 档位错配；19px 三处为字面量 + `!important` | **不合规 P1** |
| 间距 | 4pt 网格 `4/8/12/16/20/24/32/40/48`，2px 微距 | `6px`×5、`1px`×2、`18px`、`21px`×2、`10px`、`26px`×2 共 8 组碎值 | **不合规 P1** |
| 颜色 / Token 纯粹性 | 零裸色相，状态色只用语义 Token | 全文 `var(--*)`，失败态仅 `--destructive` | 合规 |
| 颜色 / 对比度 | WCAG AA 4.5:1 | `--muted-foreground` 深 3.17:1 / 浅 2.54:1，承载 12 处元数据 | **不合规 P0** |
| 颜色 / 表面层级 | L2 `--panel` → L3 `--card` 一级明度差 | jade-white / warm-paper / cyber 下 bubble=card=panel=`#FFFFFF`，比值 1.000 | 不合规 P2 |

## 二、问题清单（带 file:line、修复值、影响面）

### P0 — `--muted-foreground` 全皮肤未达 WCAG AA

- **位置**：定义 `styles.css:95,180,264,348,432`（生成源 `packages/ui/src/tokens/skins.ts:121,215,309,403,497`）；消费 `conversation.css:166,173,197,214,224,243,261,272,291,374,393,413`
- **事实**：obsidian `#636773`=3.17:1、jade-white `#9CA3AF`=2.54:1、warm-paper `#8C959F`=2.59:1、ayu-light `#6E7781`=3.88:1，仅 cyber `#4ADE80`=10.48:1 达标；连 `README.md:51` 规范自写的 `#6B7280/#16171D` 也仅 3.70:1。检测器独立命中 `low-contrast 3.2:1`。浅色 2.54:1 同时跌破 4.5:1 与 3:1 两档门槛，时间戳、模型名、思考摘要、工具目标/耗时/chips/输出/页脚在浅色皮肤下近乎不可读。
- **修复**：① 消费侧最小止血：12 处改 `var(--secondary-foreground)`（各皮肤实测 5.45~7.56:1 达标）；② 真值侧改 `skins.ts` 并重新生成皮肤表（obsidian→`#8E939E` 5.80、jade-white→`#6B7280` 4.83、warm-paper/ayu-light→`#57606A` 5.45），**禁止手改 `styles.css` 皮肤块（auto-generated，手改无效）**；③ 同步修 `README.md:51`、`04-tokens-and-design-system-spec.md:56` 的不达标规范值。
- **影响面**：全站（muted 是全局 Token），需双主题截图 + 全量 `verify`。

### P1-1 — 字阶口径 8 档 vs 7 档，`--fs-micro: 9px`

- **位置**：`styles.css:32-39`、`tailwind-entry.css:79`；消费 `conversation.css:165,271,405,412,430,452`
- **事实**：多 `--fs-overline:10px`，`--fs-micro:9px`；规范要求 7 档且 micro=10px。detector 命中 `undersized-ui-text 9px functional text (below 11px floor)` ×2，CDP `getComputedStyle` 实测 `.conv-message__meta` / `.conv-tool__time` = 9px。`conversation-redesign-plan.md:164,314,396` 自承「字阶口径统一」未完成。
- **修复**：删 `--fs-overline`，`--fs-micro`→10px，`styles.css :root` 收敛为 `20/16/14/13/12/11/10`；`tailwind-entry.css:79` fallback 同步 10px；`conversation.css` 6 处引用自动跟随。
- **影响面**：全站（`LeftRail.tsx:272-273` 的 `text-micro` 亦消费 9px fallback），改后需重跑 `typecheck` + `gates`。

### P1-2 — 行高越界与档位错配

- **位置**：`conversation.css:187,232,358`（另 `102,129,141,453`）
- **事实**：`26px`（思考/工具 summary，配 13px body）与 `18px`（思考正文，配 12px aux）不在 7 档集合；`16px`（L453）在集合内却配 9px micro，属档位错配；L102/129/141 的 `19px` 值虽正确却是字面量 + `!important`，与 `--fs-body` 未同源，字阶调整即抖动。CDP 实测 `.conv-tool__name` lineHeight 26px、`.conv-thought__body` 18px。
- **修复**：L187/L358→`19px`，L180/L351 `min-height`→`24px`；L232→`16px`；L453→`12px`；抽 `--lh-*` 行高 Token 与字阶绑定，移除对 `renderMarkdown` 内联样式的 `19px !important` 硬压。
- **裁决说明**：A 判 L453 16px 为错配（P1），B 按「是否在集合内」判 OK。采纳 A 的档位逻辑，但降级为 P2（字阶统一后 micro=10px/12px，16px 会更显松散），不列入 P1 硬阻断。

### P1-3 — 8 组非 4pt 网格碎间距

| 行号 | 原值 | 修复值 |
|---|---|---|
| 228 | `margin: 4px 0 6px 18px` | `4px 0 8px 16px` |
| 240 | `gap: 6px` | `8px` |
| 312 | `padding: 1px 6px` | `2px 8px` |
| 322 | `gap: 6px` | `8px` |
| 425 | `padding: 1px 6px` | `2px 8px` |
| 439 / 445 | `margin: 2px 0 4px 21px` | `2px 0 4px 20px` |
| 446 | `padding: 8px 10px` | `8px 12px` |
| 180 / 351 | `min-height: 26px` | `24px` |

`6px` 出现 5 次集中在胶囊与状态块，破坏 `style-review-spec.md:45` 的留白律动。**豁免**：L23 `180px`、L25 `120px`、L89 `820px` 是 `README.md:142` 明示的几何常量，不计违规。

### P1-4 — 桌面热区 22px < 28px，移动端双真值

- **位置**：`conversation.css:285-286,462-466`；`styles.css:1044-1047`
- **事实**：桌面 `.msg-action-btn` 为 22×22px，违反 `style-review-spec.md:28`「桌面 ≥28px」；移动端 `conversation.css` 给 48px，`styles.css:1044-1047` 另给 `36px !important`，两套真值且 36px < 44pt。
- **修复**：桌面→`28×28px`（或 22px 视觉 + `::before` 透明 32px 热区）；删 `styles.css:1044-1047`，移动端单点收敛到 `conversation.css` 的 48px。

### P2（4 条）

1. **气泡 L3 语义塌陷**：jade-white / warm-paper / cyber 下 `--chat-user-message-bg` = `--card` = `--panel` = `#FFFFFF`（1.000），仅靠 1px `--border` 区分，L2→L3 纵深塌陷；改 `var(--card-hover)`（1.112）或叠 `var(--shadow-card)`。
2. **死选择器**：`styles.css:1117,1119,1121,1272,1300` 的 `.middle-conversation-pod` 在组件 DOM 中不存在（真实为 `ConversationStage.tsx:45` 的 `.conversation-pod`），5 处主题规则永不命中。
3. **`!important` 双真值**：`conversation.css:140-141,147` 为反压 `MiddlePod.ts:1806,1822,1832-1833` 的 `renderMarkdown` 内联字号；`redesign-plan.md:316` 自承未完成，须与 P1-2 一并排期避免二次抖动。
4. **移动端热区双真值**（已含于 P1-4）。

## 三、确定性证据交叉验证

| 证据源 | 命中 |
|---|---|
| `impeccable detect --json`（HTML 入口 + 复制样式表） | `low-contrast 3.2:1` ×2、`undersized-ui-text 9px` ×2、`pulsing-dot` ×1，EXIT=2 |
| WCAG 脚本（`conv-audit/contrast.mjs`） | 深 3.17:1 / 浅 2.54:1；`--secondary-foreground` 5.80 / 7.56:1 |
| CDP `getComputedStyle`（obsidian-gold） | `--fs-micro 9px`、`--muted-foreground #636773`、`.conv-tool__name` lineHeight 26px、`.conv-thought__body` 18px、bubble 13px/19px |

三方对 `9px` 与 `3.2:1` 独立印证。浏览器截图 `.../conv-audit/conversation.png` 已落盘、`readyState=complete`、6 个选择器均返回有效计算样式；本会话模型不支持图像输入，故未做主观视觉判读，仅以计算样式为证。另：直接对 `.tsx` / 裸 `.css` 跑 detector 返回零 findings，须以 HTML 为入口才加载关联样式表，此处已用临时 HTML 复现。

## 四、Design Health Score（补充：样式专项，非主结论）

| # | Heuristic | 分 | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | 工具状态仅 `failed` 换色，running/success 无视觉区分 |
| 2 | Match System / Real World | 3 | 文案 100% `t()`，术语自然；分类靠名字子串属内容契约问题，非本次范围 |
| 3 | User Control and Freedom | 2 | 22px 纯图标热区，无焦点环声明 |
| 4 | Consistency and Standards | 2 | 8 档 vs 7 档、9px vs 10px、26/18px 行高、6/21/10px 碎间距、48px/36px 双真值 |
| 5 | Error Prevention | 3 | 失败态有 `--destructive` 语义色 |
| 6 | Recognition Rather Than Recall | 3 | 按钮有 `aria-label`/`title`，但纯图标无文字标签 |
| 7 | Flexibility and Efficiency | 3 | 复制/回滚/分叉、流式贴底跟随齐备，无快捷键证据 |
| 8 | Aesthetic and Minimalist Design | 2 | 骨架克制，被 9px 字 + 2.5:1 + 碎间距拉低 |
| 9 | Error Recovery | 3 | `data-tool-status='failed'` + 回滚/分叉入口 |
| 10 | Help and Documentation | 2 | 仅 `title`/`aria-label`，无上下文帮助 |
| **Total** | | **25/40** | **Acceptable（20–27），需显著改进** |

**Design Specificity**：LLM 评审与确定性扫描一致 —— 视觉语言是「深邃中性暗调 + 发丝线 + 整数排版」，确实为 Hermes Flux 的新极客精准美学所专有，不是通用聊天 UI；但同一套设计意图在执行层被 9px 微字号与低对比度削弱，属于「方向对、落地糙」，而非「可替换的品类通用皮」。

## 五、What's Working / Persona Red Flags / Minor Observations

**What's Working**：① `conversation.css` 零裸色相、零字号字面量，换肤通道干净；② 中性 `--panel` + 1px 发丝线 + 无渐变光晕 + 无 `infinite` + 即时滚动，符合「界面退后、内容主角」；③ 组件抽象到位（`MessageFooter`/`ActionButton`/`ToolSection`/`ReadGroup`，`TurnGroup` 带 `React.memo`），i18n `zhDict`/`enDict` 对称、100% `t()` 包裹。

**Persona Red Flags**：
- **Sam（无障碍依赖）**：9px 元数据 + 浅色 2.54:1 + 22px 纯图标按钮无焦点环 → 读不到时间戳与工具耗时，键盘 Tab 后难以定位当前操作。
- **Alex（高效用户）**：22px 热区 + 无快捷键证据，复制/回滚/Fork 需精确点击；工具状态仅 failed 换色，running/success 无区分，扫读执行轨迹只能靠文字猜。

**Minor Observations**：① `npm run gates:changed` 空跑全绿（`scannedFiles:0`，改动已随 `53b0b60` 提交），且 `typo-font-size` 只抓 `font-size:Npx` 字面量，抓不到 `--fs-micro:9px` / `line-height:26px` / 4pt 网格 / WCAG，属假阴性，不能当放行依据；② detector 报的 `pulsing-dot`（`styles.css:764-785` 的 `infinite fluxActivityPulse`）来自顶栏连接指示器，非 `conversation.css` 引入，按 `ENGINEERING_DISCIPLINE`「禁止无休止独立动效」应另行排查，不计入本次三维度；③ `index.html:7-9` link 的 `conversation.css` / `tailwind.css` 在 `src` 下不存在（构建后复制产物），仅影响静态探测器读取，非运行时缺陷。

## 六、落地清单与代价（5W2H）

1. **止血 P0**：12 处消费侧改 `--secondary-foreground` + 改 `skins.ts` 重新生成皮肤表 + 双主题截图复核。代价：全站 muted 语义变化，需全量 `verify`。
2. **字阶收口 P1-1/1-2**：改 `styles.css :root`（删 overline、micro=10px）+ `tailwind-entry.css` fallback + 抽 `--lh-*` Token + 移除 `!important`。代价：影响 `LeftRail.tsx` 的 `text-micro`，须 `npm run typecheck`。
3. **网格与热区 P1-3/1-4**：8 组间距 + 28px 桌面热区 + 删 `styles.css:1044-1047` 的 36px 规则。代价：窄，纯 CSS。
4. **验收**：`npm run gates:changed`（须先产生改动才有意义）、`npm run typecheck`、`npm test`、`npm run verify:formal`、`npm run verify` 全绿；补 CSS 守卫测试断言 `--fs-micro=10px`、行高集合、4pt 网格、WCAG AA，把本次门禁假阴性补上。
5. **排期**：P0 与 P1 应同批修复后复审；P2 四项可并入同批，其中 `!important`/`renderMarkdown` 技术债须与行高修复一起做，避免二次排版抖动。
