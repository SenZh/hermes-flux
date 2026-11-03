# design-review — 设计审查与裁决

## 流程记录

双审执行：主 Agent 自审 → 委派独立审查 sub-agent（review 代理在本 harness spawn 失败 uv_spawn，按规约降级 general 代理承担，只读约束保留）→ 主 Agent 裁决。审查结论 Binding。

## 审查问题清单与处置

| # | 严重度 | 问题（审查员） | 主 Agent 复核 | 处置 |
|---|---|---|---|---|
| 1 | 高 | applySkinToDom/BUILTIN_SKINS 零生产调用；运行时皮肤真值=styles.css [data-theme] 字面块（:42/:105/:170/:234/:929） | ✅ grep 证实（14 命中全在 ui 单测） | tech-design §2.1 重写：生成链替代 CSS 块，F5/F6 改写，I1 输入三方全集 |
| 2 | 高 | 槽表漏真实消费面：--specular-line/--hl-×4/--badge-×15/--theme-thumb-color/--danger-color | ✅ 与既有 grep 样本互证（MiddlePod:409 用 --theme-thumb-color） | 扩展组入表，badge 族干跑裁决跨皮肤恒同则归并节奏层 |
| 3 | 高 | S6 输入面证明不成立：deleteSession 全函数 :2519-2653 引用 render()/focus/合流器/watchdog/dockNotice 等 | ✅ 引文为前轮亲读 | S6 按 core 编排段+壳订阅侧拆分重写；"≤1,500 行"判据移挂波③末 |
| 4 | 中 | 槽数 32 宣称与枚举 29 失配 | ✅ | 改"核心组 38+扩展组干跑定案"，SLOT_IDS.length 对账单测入 test-plan |
| 5 | 中 | cardHover/Active color-mix 降级丢五皮肤差异（warm-paper active==card） | ✅ registry:182 证实 | 两槽保留 |
| 6 | 中 | 阴影"模板+色分量"不可还原逐皮肤结构（ayu/jade 描边分量） | ✅ tokens.ts:118-120 证实 | 每皮肤完整字符串值 |
| 7 | 中 | 几何准源引用错误：tri-rail spec 实为 48/260/380，与实现 52/264/410 相反侧 | ✅ | 准源改实现+AGENTS；spec 订正入 §4 |
| 8 | 中 | "0 裸 fetch"无设计步骤（:940-967 auth 三处）；"4023/4001 0 命中"会被注释打爆 | ✅ | 新增 S5b；grep 口径限"去注释源码" |
| 9 | 中 | InputDock 经 dockHtml 插槽位于 MiddlePod 重建子树（:4598-4622/:4916/:4822），拆舱迁移违反 S4；S4 证据两处失真（querySelector :4695；初始整树 :4548/:4689） | ✅ 机制与前轮读过的覆写事实吻合 | 舱序改 InputDock+MiddlePod 同 PR（或前置移出插槽）；S4 重写 |
| 10 | 中 | build.mjs 实为六段入口，非三段 | ✅ :62/:74/:83 亲验 | F2/S1/S10 改述，aux 入口列入 PR 清单 |
| 11 | 中 | styles.css:679-928 约 20 条皮肤专属组件规则与 suet-jade 幽灵无处置 | ✅ grep 块位证实 | 波① 1a 列入干跑输入逐条归槽/删除/diff 声明 |
| 12 | 低 | 缺 shadcn 标准 --secondary/--muted/--accent 背景族，内置组件"自动换肤"落空 | ✅ | 衍生背景×6 入表 |
| 13 | 低 | S3 体积实测未做却标 ✅ | ✅ | 改"✅（体积预算开放）"，实测报告为 PR-1a 准入附件 |
| 14 | 低 | 判据锚定仓外 synthesized.md 无快照 | ✅ | 已快照 concurrency-baseline.md + SHA256 0DE61AB5…F7FF |
| 15 | 低 | 换肤判据"2 帧断言"语义含糊无正对照；live-gateway"条件允许"是豁免口子 | ✅ | 改节点引用同一性+60px 扰动正对照；豁免引用纪律离线条款并记录 |

## 自审记录（教训）

我的 F5 原判"皮肤体系已有骨架且形状正确"来自 explorer 报告转述 + 文件内容阅读，**未回查消费调用点**——存在≠生效。审查员用"grep BUILTIN_SKINS 生产命中"一步证伪。登记 pitfall：真值源类结论必须追到运行时写入调用面，静态存在性不构成生效证据。

## 裁决

差异点仲裁：主 Agent 与审查员结论无冲突（3 高危全部复核属实并全文落实；8 中危 4 高危级联修订完成；低危中 #14 当场闭环，其余转 PR 准入附件）。审查质量校验：20 处引用抽查、5 处失真认定均有原文定位，严重度分布 3 高/8 中/4 低，维度六项全覆盖含"无问题"理由，**审查有效**。

**最终结论：有条件通过之条件已全部解除，Phase 1 完成，允许进入实施阶段。⛔ 执行仍待 operator 显式 go**（multi-phase playbook 步骤 1：协议与计划宣告后停止）。波①与波②文件边界经审：①(ui/tokens、styles.css、gates、docs)与②(core/src、renderer 编排函数)无同文件交集，并行成立。
