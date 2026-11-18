# 流式结束视口跳上去（Stream-End Jump-up）修复交接

> **交接时间**：2026-11-19
> **当前状态**：业务修复 + 单测/变异门禁闭环，双审（代码审 FAIL → 已整改，样式审 PASS）通过，`npm run verify` 全绿
> **改动位置**：全部在工作区，**尚未 `git commit`**

---

## 一、现象与根因

流式输出结束后，视口整体向上跳离底部。

1. **重复采样导致占位高度漂移**：流式结束后的无消息变更渲染（`fetchSessions`、`scheduleTransitionRefresh`）反复对已可见回合采样，反复改写 `--conv-intrinsic-median-height`（140px → 151px），离屏 `.conv-turn` 的 `contain-intrinsic-size` 随之膨胀，`scrollHeight` 撑高而 `scrollTop` 不动（实测 ΔSh = +528px、ΔSt = 0）。
2. **工具包 DOM 重复挂载**：`ToolSection` 在流式态与收口态复用同一 DOM key，`toolPatchQueue` 直写的补丁节点不会被 React 卸载，收口提交时追加新子节点（实测 `toolsChildren === 2`）。

---

## 二、修复清单

| 文件 | 改动 |
|---|---|
| `packages/desktop/src/renderer/viewport/streamViewportManager.ts` | 2000 槽 FIFO `sampledTurnKeys` 去重；跳过 `data-conv-streaming="true"`；无变化不写变量；ΔSh 视口中性补偿；跳转落定期只写变量不动视口；新增诊断 getter `getSampledTurnKeyCount` / `hasSampledTurnKey` |
| `packages/desktop/src/renderer/renderCoordinator.ts` | 单在途 `armPostRenderPinAnchor`，同步武装 `overflow-anchor: none`，仅向上滚轮让权 |
| `packages/desktop/src/renderer/stream/streamDomOwnership.ts`（新增） | 抽出纯函数 `shouldPatchStreamingTools` 与 `revealStreamingContentDisplay`，让入口层两处判定可脱宿主单测 |
| `packages/desktop/src/renderer/index.ts` | `patchElement` 单所有者守卫委托纯函数；`setMessageContent` 只做 none → block 点亮（1499 行，守住 1500 上限） |
| `packages/desktop/src/renderer/gateway/gatewayEventDispatcher.ts` | 回合收口前置捕获贴底意图，清理补丁队列与计时器 |
| `packages/desktop/src/renderer/services/turnExecutionService.ts` | 中断/超时前置贴底、`settleRunningTools`、单次 render |
| `packages/desktop/src/renderer/services/sessionOperationService.ts` | 切回流式会话补排一次 toolPatch |
| `packages/desktop/src/renderer/stream/tokenStreamWriter.ts` | 正文锚点点亮改为 `display:block`，不再写 `flexDirection` |
| `packages/ui/src/components-react/conversation/ToolCapsule.tsx` | `ToolSection` 增加 `isStreaming`，流式态 `key="streaming"` 空壳、收口态 `key="settled"` 原子交接 |
| `packages/ui/src/components-react/conversation/MessageRow.tsx` | 透传 `isStreaming` |
| `packages/ui/src/components-react/conversation/MarkdownBlock.tsx` | 注释修正：none→block（原文写 none→flex） |
| `scripts/contract/doc.mjs` | 生成文档时跟随原文件行尾，消除 Windows 上的纯行尾噪声 |

---

## 三、验证证据（全部实测）

### 3.1 质量门禁

| 项 | 结果 |
|---|---|
| `npm test` | 201 文件 · 2404 用例 · 2401 通过 · 0 失败 · 3 跳过 |
| `npm run typecheck` | 0 错误 |
| `npm run verify:formal` | 14 文件 · 55 条不变量全部通过 |
| `npm run gates:changed` | 无新增违规 |
| `npm run contract:doc:check` | 11 个文档与契约/探针数据一致 |

### 3.2 变异门禁（`npm run mutation:stryker -- --domain=<name>`）

| 领域 | 实测 | 阈值 |
|---|---|---|
| `streamViewport` | 217/249 = **87.15%**（含 FIFO 淘汰与补偿输入契约） | ≥ 85% |
| `turnSettlement` | 304/361 = **84.21%** | ≥ 80% |
| `sessionSelectToolPatch` | 16/20 = **80.00%** | ≥ 70% |
| `toolSection` | 6/7 = **85.71%**（覆盖分 100%） | ≥ 70% |

### 3.3 真实 Blink 物理验证

`node --test packages/desktop/__tests__/cdp/stream-settle-cdp.test.mjs`（已登记进 `npm run test:cdp`）：

- 流式直写 → 收口：`#msg-tools-a299` 子节点数 `0 → 1 → 1`，工具包唯一，直写残留节点被卸载。
- 同 key 外壳对照实验：子节点数收口后为 **2**，证明断言确实能杀死重复节点回归。
- 占位高度 140px → 320px：ΔSh = **+77,740px**，ΔSt = **+3,180px**，距底从 0 → **74,560px**（缺陷机制在真实内核成立）。
- 收口一帧：可见锚点行位移 **0px**，`scrollHeight` 仅 +120px（离屏补挂载）。

---

## 四、审查结论与整改映射

| 审查项 | 结论 | 整改 |
|---|---|---|
| 样式审（flux-style-reviewer） | PASS | 注释漂移已修；恒真的静态 `.conv-package` 计数断言已移除并指向 CDP 用例 |
| 代码审（flux-code-reviewer） | FAIL → 已整改 | 见下 |
| Blocker 1：`index.ts` 守卫零测试 | 已修 | 抽 `streamDomOwnership.ts` + 四象限/装配守卫用例 |
| Blocker 2：`setMessageContent` 零测试 | 已修 | 同上，`revealStreamingContentDisplay` 四态断言 |
| Blocker 3：FIFO 淘汰假测试 | 已修 | 断言 `2001 → 2000`、最老键被淘汰、重新入样可再记账 |
| Critical 1：`contract:doc:check` 红 | 已修 | 重生成文档并修正生成器行尾跟随 |
| Critical 2：变异域漏掉新逻辑 | 已修 | 分段覆盖 190-215 / 455-540 / 570-760 |
| Major 1：补偿缺跳转期守卫 | 已修 | `isPromptJumpSettling()` 守卫 + 用例 59b |
| Major 2：无真实内核证据 | 已修 | 新增 CDP 用例（见 3.3） |
| Major 3：非流式负向分支缺失 | 已修 | 补 4 条负向用例（非流式/无 ID/消息不存在/工具空数组） |

### 未处理（Minor，明示遗留）

1. `index.ts` 切回会话时立即 `scheduleToolPatch`，React 可能未提交新 DOM，会多一次结构重建；建议改到提交后一帧。
2. `turnExecutionService` 仍有三处「`setTimedDockNotice` 内部 render + 外部再 render」反模式未统一。
3. `streamViewport` 域仍有 7 个 noCov 变异体，位于既有 `scheduleStreamBottomInset`（455-459）与 `captureStreamAnchor` 单行（687），不属本次逻辑。

---

## 五、接手建议

1. 待用户确认后提交，注意 `scripts/gates/build-desktop-unit.mjs` 目前是未跟踪文件，必须 `git add`；`.env` 已被忽略。
2. 提交前复跑 `npm run verify` 与四个变异域，避免文档行号再次漂移。
