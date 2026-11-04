# backlog — 遗留待办（2026-11-04 更新：PR-3d 左轨形态已交付）

程序：设计系统 + shadcn 迁移 + 双壳拓扑（tech-design.md 波①②已完成，波③进行中，波④未动）。
本文件是恢复工作的唯一入口清单。优先级 P0 最高。

## 已交付（2026-11-04，PR-3c + PR-3d）

**PR-3c 把手几何单一真值源**（d916f88 红基线 → 9112ce9 修复）：用户实测左轨拖拽蓝带 8px、右轨 3px。运行时像素复现定根因：左 Tailwind w-2 骑跨边界、右模板内联 6px 被 pod overflow:hidden 裁半。修复：`--geo-resize-handle: 6px` 唯一真值源、双侧完整落轨内、高亮 `color-mix(var(--primary))` 随皮肤、≤768px 物理剥离、滚动容器 `mr` 让带消除把手/滚动条命中劫持（双审 P1）。守卫：`rail-handle-sot.test.mjs` + `rail-handle-symmetry-cdp.test.mjs`（真实 renderer 驱动）。

**PR-3d 左轨形态收尾**（用户 7 项反馈中的 2/4/5）：微轨底部 +/‹ 删除（折叠入口收编顶栏与 Ctrl+B，renderer 5539 旧死绑定清除）；时间格式化器收敛为唯一真值源 `formatLeftRailTime`（当日 HH:mm / 昨天 / 前天 / M/D / YYYY/M/D，renderer formatSessionTime 委托），时间内联标题行不再挤副标题；左轨上限 320→480（用户定案，覆盖 A1 的 320）；会话/群聊 header 放大至 13px、删 ⌄/› 文本箭头、右侧 + 新建入口按甲板打开 NewTaskModal（新增 initialType，双调用点同参守卫防漂移）。守卫：`rail-cockpit-form-cdp.test.mjs`（注入快照物理点击 + 出图 artifacts/verification/pr3d-left-rail-form.png）+ formal 定理 18-21。

## 已交付（2026-11-04，三个提交）

`a3a0e6a` → `282267f` → `b6d6546`，全部通过 `typecheck / test(607) / gates / gates:changed / verify:formal(17) / test:cdp(27)` 与提交钩全量门禁。

| 项 | 结论 |
|---|---|
| **A1 左轨拖拽夹取** | **根因已用真实 Blink 复现并定位**：`packages/desktop/release/win-unpacked`（11:37）与 `release/dist/win-unpacked`（14:10）两份 app.asar 里仍是旧代码 `[200,500]` 且无 clamp，用户测到的就是旧包。源码侧早已生效（拖满=400→夹到 320，关窗重开仍 320）。修复：边界收敛到唯一真值源 `LEFT_RAIL_WIDTH={264,320,264}`，上限从 400 收紧到 **320**（backlog A1 原文"400 上限本身仍太宽"的产品意图），拖拽与冷启动恢复共用 `clampLeftRailWidth`。运行时证据：拖拽→320、回拖→264、越界存档 900→320。**〔2026-11-04 PR-3d 订正：用户实测 320 过窄，定案放宽至 `{264,480,264}`，见上表 PR-3d〕** |
| **A2 顶栏 profile 下拉** | 已删除组件、快照字段、回调、样式与测试断言；身份切换入口保留在左轨专职 Bot 卡片与设置弹窗。 |
| **A3 状态栏延迟读数** | 走节奏层 `--fs-caption` + `--muted-foreground` + `font-mono` + `tabular-nums`，状态栏固定 22px。 |
| **A4-1 primitives 零消费** | 左轨强制消费 Button / Input / Badge（群聊行操作、搜索框、项目计数）。新增 `primitives-consumption.test.mjs`：consumed 集合只增不减、pending 必须写明落地 PR、pending 期间不得被偷偷消费。Dialog / Menu / Switch 仍 pending，指向 SettingsModal / ContextMenu 舱。 |
| **B PR-3b 左轨迁移** | 873 行模板删除，改为 `leftRailModel.ts`（纯派生）+ `LeftRail.tsx`（映射）+ `types.ts`（类型）+ `botAvatar.ts`（头像资产）+ `leftRailStaticRender.ts`（测试入口）。会话行按用户定案重设计：去头像 / 标题主体 / 副标题 12px muted 单行截断 / 时间紧凑化钉右缘 / 行高 48px。主工位卡数据管道一字未动（仍只吃 profile 快照，有断言防冒名）。 |
| **PR-3a 双审七项** | 全部清偿并各自落守卫测试，集中在 `pr3a-review-payoff.test.mjs`。 |
| **A4-2 产物时序** | 已在执行中遵守：改 tailwind-entry 必先 build 再 test；本次 `test` 之前都跑了 build。 |

## 审计后新增的登记项

| # | 优先级 | 问题 | 现状 |
|---|---|---|---|
| C1 | P1 | **移动端触控热区 36px < 48dp** | 实测（Pixel 8 390×844 DPR3）：微轨 Bot 徽章、群聊/项目/新建按钮均 36×36，群聊行操作按钮 24×24。**这是旧模板既有尺寸，非本次回归**（git show 旧模板同为 36/34px）。归属波④ mobile 独立壳统一整改，需在 `styles.css` 移动端块补 min-height/min-width 或改 cva size 变体。**〔2026-11-04 PR-3d 追记：微轨新建按钮删除后，新建入口迁移为 header 的 `rail-new-session-btn/rail-new-group-btn`，视觉 24×24，已加 `after:-inset-1.5` 透明扩展把命中区兜回 36px；波④仍需统一抬到 48dp〕** |
| C2 | P1 | **流式期左轨整列重渲染** | 每次 token flush → `updateBotLatestActivity` → render → `mountReactShellComponents` 全量 root.render；`SessionRow`/`GroupRow` 未加 `React.memo`，头像 `dangerouslySetInnerHTML` 每次重建字符串。当前会话数少未暴露，长会话需实测后再决定是否加 memo（先测后改，禁止凭推测优化）。 |
| C3 | P2 | 项目手风琴默认展开策略变更 | 旧模板仅第一项展开，新实现用原生 `<details>` 全部折叠。已补回 `data-project-id` 与 `rail-proj-{id}` 选择器。 |
| C4 | P2 | `state.isMoreSessionsExpanded` / `state.isBotsGroupExpanded` 成死字段 | 两个字段的绑定已随模板删除，字段本身仍在 AppState。下个舱迁移时一并清。 |
| C5 | P2 | 群聊拼图头像中真实资产与字母块混排 | 资产缺失时的合理兜底，视觉略有割裂。等网关头像覆盖率提升后自然消失。 |

## C. 已登记顺延项（不动主线，防止遗忘）

| 项 | 归属 | 来源 |
|---|---|---|
| InputDock+MiddlePod 必须同 PR（dockHtml 插槽 S4 约束），流式写权切换在 MiddlePod 舱 | 波③后段 | tech-design §5 |
| InspectionPod 420≠410 几何偏差择一对齐 | 波③ | gates 偏差登记 |
| styles.css 不在门禁扫描扩展名（P-019），波③接 CSS 扫描面 | 波③ | pitfall-registry |
| theme 初始化白名单（已做）之外的 enDict 皮肤名补登 | 波③ | 样式审 P2 |
| 翡翠呼吸动效经集中时钟恢复（本轮已删孤儿 jadePulse，待 ticker 接入） | 波③/独立小项 | 样式审 P2 |
| 存量裸 `font-size` 59 条随舱迁移清零后，探针转 blocking | 波③逐舱 | PR-1b |
| 波④：mobile 独立壳（cpSync 废除、bridge implements IPlatformBridge、触控 ≥48dp、视口矩阵回归、废除全局 44px CSS 补丁） | 波④ | tech-design §5 |
| live-gateway 凭证环境补跑（离线豁免的 TC-C 组真实联调） | 波②收尾 | ENGINEERING_DISCIPLINE 四.7 |
| packages/web 文档漂移（已标注"未落地本期范围外"） | 文档 | 审计 |
| 幽灵皮肤 suet-jade 别名一个大版本后移除 | 波③末 | slot-table-decision |

## D. 流程债（自我修正记录，防复发）

1. `%ERRORLEVEL%` 同行展开假绿（已修验证方法，P-018 在册）。
2. "PR-3b 已开工"虚报一次 —— 声明动作前必须已执行动作。
3. **A1 教训升级**：用户可见行为的修复，验收证据必须是运行时复现。本次已用真实 Blink 完成"拖满→重载→实测宽度"链路，并额外定位到"用户测的是旧打包产物"这一真因。
4. **本轮新增教训（截图取证不可省）**：左轨 React 化后第一版"测试全绿"，但真实截图显示会话行、群聊行、手风琴全是白底方块 —— 因为 tailwind 入口刻意不含 preflight，原生 `button`/`input` 保留 UA 白底。**单测与 typecheck 无法发现这类缺陷**，凡触碰视觉必须出图。修复是把控件基线写进 `@layer base`（unlayered 会压过 utility）。
5. **本轮新增教训（把手层级）**：把手放在 `overflow: hidden` 的抽屉内会被裁掉，命中测试落到抽屉上，物理拖拽完全失效。已移到 `aside` 直属层级并加断言。
6. **本轮新增教训（删代码必须核对被删能力）**：`renderGroupCollageAvatar` 随模板删除后群聊行静默退化为纯文字，是双审 P0 抓出来的。模板迁移前必须逐项列出"旧模板提供但新组件未提供"的能力清单。
7. 提交钩两次因产物时序失败：改样式映射/组件类名后必须 build 再 test。
