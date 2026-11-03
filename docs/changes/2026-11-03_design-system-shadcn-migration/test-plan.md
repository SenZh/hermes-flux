# test-plan — 测试方案设计（摘要级，波内细化）

判据基准：contract.md 逐条 + requirements.md G1-G6。五阶自检命令链（gates:changed/typecheck/verify:formal/control-flux run/npm run verify）对每个波 PR 全量执行，AGENTS.md 二.3 不变。

## 单元/属性层
| 项 | 覆盖 | 类型 |
|---|---|---|
| skins.ts 槽完备性 | 每个 SkinSlots 实现含全部 43 槽（SLOT_IDS.length 对账）且值可解析；variant 明暗逐皮肤精确断言；无 badge 皮肤显式 badge-palette:none；标记区外零手写皮肤块；与 git HEAD 原始块双向对账（同名零漂移、新名仅同源派生） | 单测（skins-sot.test.mjs，7 用例） |
| CSS 变量生成器 | generate → var 名与 SLOT_IDS 一一对应、无重复 | 单测 |
| FSM 合法转移 | fast-check：随机转移序列仅产出 LEGAL 表内路径；非法请求态被拒或降级 | 定理新增（S8，判定树强制） |
| runGuarded 代际原语 | fast-check：任意交错下"恢复后状态已变 ⇒ 写入被丢弃"，未变 ⇒ 必达 | 定理新增 |
| SessionLifecycleService.deleteSession | 4023 降级、部分失败、prune 后列表不含目标（先交错用例证伪 R-09 复活序列，结论决定墓碑去留） | 单测+真实 gateway 探针（live-gateway 管道，条件允许时） |
| 看门狗 | 静默驱动：delta/tool 事件重置计时；总上限触发只告警不解绑流式 | 单测（假 timer） |
| i18n 生效 | state.lang → setLocale 生产链路断言 t() 输出随皮肤语言变化 | 单测 |

## Live 层（CDP，verify-hermes-flux 管道）
每舱 PR 必附：①该舱物理渲染截图基线（换肤 2 皮肤 × 明暗 data-theme 切换后截屏，验证 0 硬编码残留面）②按钮/弹窗物理点击与键盘导航（Radix focus 环走 --ring）③流式消息在波③末段切换写权后的打字机完整性（无翻倍、无丢字，对照 synthesized.md §4.3）④Regression lane against trunk。波④追加视口矩阵回归全套（keyboard-open/folded/rotated 等 8 态，断言编辑器实例不重建、草稿零丢失）。

## Perf 层
波①：Inter 拉丁子集字节数实测（预算：单 woff2 ≤400KB，超标换子集切分）。波③末：desktop 首帧渲染 trunk vs head 对照（react 运行时增量，预算：TTI 增幅 ≤80ms，绝对值以 trunk 基线先测）。波④：mobile WebView 冷启（PoC 测得 react-dom 全量 bundle 250.7KB 为已知成本，进预算）。

## 门禁/存量清偿度量
84 处硬编码色、6 处裸 monospace、字号半像素散值：每波 PR 后 `npm run gates` 违规指纹基线单调收缩数字写入 PR 描述（禁止 freeze 洗白新增）。
