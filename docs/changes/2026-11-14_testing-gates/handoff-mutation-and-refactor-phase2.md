# 交接文档：变异测试攻坚与 renderer/index.ts 领域拆解（Batch 1 & 2 · 2026-11-14）

> **目标读者**：接手本工作的下一个 session 或子代理（Subagent）。  
> **上下文背景**：本阶段完成了工业级变异测试（Stryker）对 `tokenCoalescer` 的盲区清零，并对 `packages/desktop/src/renderer/index.ts` 实施了两波大规模解耦拆分（Batch 1 + Batch 2），物理行数由 11857 行缩减至 10838 行。全量编译、静态门禁、12项自证套件、164个测试文件（2045个用例）、CDP真实渲染与 `verify` 链式验证 100% 绿灯。

---

## 一、指标大盘与收益

1. **变异测试得分飞跃 (`coalesce` 领域)**：
   - 变异体总数：119 个；
   - 未覆盖 (NoCoverage)：由 65 个降至 **0 个（100% 覆盖）**；
   - 变异得分 (Mutation Score)：由 23.53% 提升至 **76.47%**（硬门禁锁紧至 $\ge 70\%$）；
2. **`renderer/index.ts` 巨石瘦身**：
   - 物理行数：由 **11857 行** 缩减至 **10838 行**（净减 1019 行）；
   - `scripts/gates/rules/maintainability.mjs` 中的 `KNOWN_OVERSIZE` 硬上限已收缩至 **`10845`**（只降不升棘轮机制生效）；
3. **测试套件与安全防线**：
   - 新增 10 个独立领域模块与 42 项行为单测；
   - 全套测试文件增加至 **164 个**，测试用例增加至 **2045 个**（2042 通过，3 跳过，0 失败）；
   - 13 个读取源码文本断言的接线守卫测试（Wiring Guards）100% 成立。

---

## 二、已抽离的 10 大领域模块清单

| 领域模块 | 物理路径 | 核心职责 |
|---|---|---|
| **持久缓存桥接** | `cache/desktopCacheBridge.ts` | 双向对象映射、ViewModel 归一化、串行队列落盘 |
| **在场状态机** | `presence/agentPresenceManager.ts` | 在场指示器快照、语气跨档、React 指纹防抖、节拍器 |
| **提示词导航** | `navigation/promptNavigatorManager.ts` | 导航轨快照派生、滚动二分换算、切会话末条锁定、跳转防抖 |
| **思考等级级联** | `cascade/modelCascadeManager.ts` | 级联面板几何定位（default/flip/inset）、垂直视口夹取、抑制窗口 |
| **流式视口滚动** | `viewport/streamViewportManager.ts` | 视口 48px 贴底、DOM 锚点捕捉与重放、首屏平滑贴底、底部浮层安全内边距 |
| **左轨实体装饰** | `leftrail/leftRailSnapshotManager.ts` | 42+ 会话/群聊/Bot 实体装饰、WeakMap 指纹缓存复用、快照判等 |
| **全局应用状态** | `state/appState.ts` | `AppState` 60+ 字段模型契约、`createInitialState()` 工厂、持久化布局读取 |
| **检查舱动效** | `inspector/inspectorController.ts` | InspectionPod 宽度动效绑定（防泄漏 detach 机制）、原生/Web 文件下载 |
| **模态弹窗控制** | `events/modalInteractionController.ts` | 二次确认 ConfirmModal、新建任务/群聊 Modal、右键菜单分发与关闭 |
| **输入舱交互** | `events/inputDockController.ts` | 输入框高度自适应（66~220px）、IME 中文组合态防御、回车分派、附件粘贴、斜杠与智能引用联想 |

---

## 三、下一阶段任务指引（Batch 3：会话与消息数据服务拆解）

接手者可直接推进下一波核心拆解，预计可再减 ~1700 行：

### 任务 1：抽离 `services/sessionOperationService.ts`（预估 -800 行）
- **职责范围**：
  - 会话创建 `createNewSession`、删除 `deleteSession`、重命名 `renameSession`、置顶 `pinSession`、归档 `archiveSession`、导出 `exportMarkdown`、复制 ID `copySessionId`；
  - 模型切换 `switchModel`、思考等级切换 `switchReasoning`、审批模式切换 `switchApproval`；
  - 关联接线：`index.ts` 必须保留对应的同名薄委托。

### 任务 2：抽离 `services/messageLoadingService.ts`（预估 -900 行）
- **职责范围**：
  - 消息加载 `loadMessages` / `loadMessagesInner`；
  - 历史分页拉取 `loadOlderMessages`（含血缘追溯、权威游标回退 `sessionOvershootRetry`、合并计划器 `planOlderBatchPrependMergeDetailed`）。

---

## 四、核心验收命令速查

```bash
# 1. 编译
npm run build:desktop

# 2. 严格类型检查 (0 错误)
npm run typecheck

# 3. 改动集门禁自检 (0 新增违规)
npm run gates:changed

# 4. 门禁反向杀伤力自证 (12/12 必须通过)
npm run gates:self-proof

# 5. 全量单元测试 (164 文件全部通过)
npm test

# 6. 总体验收门禁
npm run verify
```
