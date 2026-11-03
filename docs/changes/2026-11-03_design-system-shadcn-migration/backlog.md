# backlog — 遗留待办（2026-11-03 收工快照）

程序：设计系统 + shadcn 迁移 + 双壳拓扑（tech-design.md 波①②已完成，波③进行中，波④未动）。
本文件是明日恢复工作的唯一入口清单。优先级 P0 最高。

## A. 用户实测新报问题（明日第一批，按序处理）

| # | 优先级 | 问题 | 现状与明日第一步 |
|---|---|---|---|
| A1 | **P0** | 左栏拖拽宽度夹取"未修复" | 提交 37f1b0e 含 clamp 代码（[264,400] + 恢复夹取），但用户实测判定未生效。**明日第一步是取证复现，不是辩解**：确认用户窗口版本（`release\app-win\win-unpacked` 的 app.asar 时间戳 vs 19:3x 重打包）；若版本对，排查真根因候选——拖拽手柄实际驱动的是否还有别的变量（抽屉 flex-basis/min-width 未受同一 clamp 约束）、LeftRail 模板 `var(--rail-w-left,264px)` 的 max-width 侧是否无界、以及"400 上限本身仍太宽"这一产品可能（用户原意可能是根本不该拖宽）。修复验收必须含运行时证据（拖满→关窗→重开→实测宽度），仅单测绿不算修复。 |
| A2 | P1 | 右上角 profile 名称+下拉框要删除 | 产品裁决，覆盖 PR-3a 复审"恢复 profile 下拉"那条（operator 决定优先于审查建议）。处置：Titlebar 移除 profile 展示与下拉；快照字段/回调/样式/单测/CDP 断言同步清理；profile 切换入口去向明日问 operator 一句话或默认只保留设置弹窗内。登记进 PR-3b 任务书一并做。 |
| A3 | P1 | 左下角状态栏延迟读数：字体太大、颜色丑 | 恰好是设计系统的第一块实战：改用节奏层 token（fs-caption 11px 档 + --muted-foreground + --font-mono），具体数值明日按截图定。属 PR-3b StatusBar 顺带项。 |

## B. 在途：PR-3b（LeftRail 舱迁移）

**停线现场（代理回报，2026-11-03 夜）**：工作树仅一个未跟踪草稿文件 `packages/ui/src/components-react/LeftRail.tsx`（含无头像行/摘要/时间格式函数的组件草稿），零提交、零 push、其余未动。明日恢复第一步=审这份草稿后续做（保留勿清）。任务书范围不变：
1. LeftRail 873 行模板 → React（mount 桥照抄 StatusBar/Titlebar 形状，禁空转包装）；S4 不变量逐点核实（宿主不得再被模板覆写）。
2. 会话行重设计（用户定案）：去头像 / 标题主体 / 副标题 12px muted 单行截断 / 时间紧凑化（当日 HH:mm、跨日 M/D、跨年带年）钉右缘 / 行高 48px。**主工位卡数据管道 updateBotLatestActivity/syncBotProfiles 一字不动**（定理 1/3/4 守护）。
3. PR-3a 双审登记七项清偿：SKIN_IDS 派生守卫、`:has([title="在线"])` 改 data-status、gatewayLatencyMs 死字段清除、session-live-pulse 孤儿 keyframes 裁决（集中时钟或删孤儿，禁裸 infinite）、react-shell 测试文案锁改 data 属性、tailwind @source 白名单收紧、barrel 裸导入门禁探针。
4. 验收线：typecheck/test/gates/gates:changed/verify:formal/build/CDP 两 feature/test:cdp/verify 全绿 + ≥2 变异检验，双审后汇报。

## C. 已登记顺延项（不动明日主线，防止遗忘）

| 项 | 归属 | 来源 |
|---|---|---|
| InputDock+MiddlePod 必须同 PR（dockHtml 插槽 S4 约束），流式写权切换在 MiddlePod 舱 | 波③后段 | tech-design §5 |
| InspectionPod 420≠410、StatusBar 28≠22 几何偏差择一对齐 | 波③ | gates 偏差登记 |
| styles.css 不在门禁扫描扩展名（P-019），波③接 CSS 扫描面 | 波③ | pitfall-registry |
| theme 初始化白名单（已做）之外的 enDict 皮肤名补登 | 波③ | 样式审 P2 |
| 翡翠呼吸动效经集中时钟恢复 | 波③/独立小项 | 样式审 P2 |
| 波④：mobile 独立壳（cpSync 废除、bridge implements IPlatformBridge、触控 ≥48dp、视口矩阵回归、废除全局 44px CSS 补丁） | 波④ | tech-design §5 |
| live-gateway 凭证环境补跑（离线豁免的 TC-C 组真实联调） | 波②收尾 | ENGINEERING_DISCIPLINE 四.7 |
| packages/web 文档漂移（已标注"未落地本期范围外"，长期或建或删表述） | 文档 | 审计 |
| 幽灵皮肤 suet-jade 别名一个大版本后移除 | 波③末 | slot-table-decision |
| 337 处字号 + 35 处内联色 warning 存量随舱迁移清零后，探针转 blocking | 波③逐舱 | PR-1b |

## D. 流程债（自我修正记录，防复发）

1. `%ERRORLEVEL%` 同行展开假绿（已修验证方法，P-018 在册）。
2. "PR-3b 已开工"虚报一次（实际未派单，下一轮已补派）——**声明动作前必须已执行动作**。
3. A1 教训：clamp 修复只有单测证据没有运行时证据，用户实测直接推翻"已修复"声明。规则：**面向用户可见行为的修复，验收证据必须是运行时复现，写进明日 A1 执行标准**。
4. 两个执行代理先后以不实理由中断（"环境无法写入"实为已写大半），现场接管流程有效，但派单书应加"失败必须贴原始报错"条款。
