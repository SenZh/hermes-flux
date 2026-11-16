# 交接文档：会话生命周期与消息加载服务拆解（Batch 3 · 2026-11-15）

> **目标读者**：接手本工作的下一个 session 或子代理（Subagent）。  
> **上下文背景**：本阶段完成了 Batch 3 的彻底剥离：将会话 CRUD/配置切换服务 (`sessionOperationService.ts`) 与消息加载/历史漫游服务 (`messageLoadingService.ts`) 从 `packages/desktop/src/renderer/index.ts` 抽出。行数正式击穿 1 万行大关，降至 **9683 行**（累计净减 2174 行）。全量构建、静态门禁、12项自证、166个测试文件（2060个用例）、CDP与总体验收门禁 100% 绿灯。

---

## 一、指标大盘与收益

1. **`renderer/index.ts` 巨石瘦身突破**：
   - 物理行数：由 **10838 行**（Batch 2 交付时）缩减至 **9683 行**（**净减少 1155 行**，累计较原始 11857 行减少 **2174 行**）；
   - `scripts/gates/rules/maintainability.mjs` 中的 `KNOWN_OVERSIZE` 硬上限已收缩至 **`9690`**（只降不升棘轮机制生效）；
2. **测试套件与安全防线**：
   - 新增 2 个独立服务模块（`sessionOperationService.ts` 735 行，`messageLoadingService.ts` 893 行）；
   - 新增 15 项行为单元测试（覆盖草稿恢复、血缘回溯、毒缓存隔离、群聊向早翻页拦截等）；
   - 全套测试文件增加至 **166 个**，测试用例增加至 **2060 个**（2057 通过，3 跳过，0 失败）；
   - 13 个接线守卫测试（Wiring Guards）100% 通过。

---

## 二、当前已抽离的 12 大领域模块清单

| 领域模块 | 物理路径 | 行数 | 核心职责 |
|---|---|---|---|
| **持久缓存桥接** | `cache/desktopCacheBridge.ts` | 338 | 双向对象映射、ViewModel 归一化、串行队列落盘 |
| **在场状态机** | `presence/agentPresenceManager.ts` | 445 | 在场指示器快照、语气跨档、React 指纹防抖、节拍器 |
| **提示词导航** | `navigation/promptNavigatorManager.ts` | 295 | 导航轨快照派生、滚动二分换算、切会话末条锁定、跳转防抖 |
| **思考等级级联** | `cascade/modelCascadeManager.ts` | 190 | 级联面板几何定位（default/flip/inset）、垂直视口夹取、抑制窗口 |
| **流式视口滚动** | `viewport/streamViewportManager.ts` | 320 | 视口 48px 贴底、DOM 锚点捕捉与重放、首屏平滑贴底、底部浮层安全内边距 |
| **左轨实体装饰** | `leftrail/leftRailSnapshotManager.ts` | 280 | 42+ 会话/群聊/Bot 实体装饰、WeakMap 指纹缓存复用、快照判等 |
| **全局应用状态** | `state/appState.ts` | 215 | `AppState` 60+ 字段模型契约、`createInitialState()` 工厂、持久化布局读取 |
| **检查舱动效** | `inspector/inspectorController.ts` | 115 | InspectionPod 宽度动效绑定（防泄漏 detach 机制）、原生/Web 文件下载 |
| **模态弹窗控制** | `events/modalInteractionController.ts` | 538 | 二次确认 ConfirmModal、新建任务/群聊 Modal、右键菜单分发与关闭 |
| **输入舱交互** | `events/inputDockController.ts` | 1295 | 输入框高度自适应（66~220px）、IME 中文组合态防御、回车分派、附件粘贴、斜杠与智能引用联想 |
| **会话生命周期** | `services/sessionOperationService.ts` | 735 | 会话创建/删除/重命名/置顶/归档/导出/切换、模型/思考等级/审批切换、列表刷新防抖 |
| **消息加载服务** | `services/messageLoadingService.ts` | 893 | 消息加载/缓存优先恢复、历史向上分页、血缘追溯、游标重试、副标题反哺 |

---

## 三、下一阶段任务指引（Batch 4：回合执行与网关事件分派解耦）

接手者可直接推进下一波核心拆解，预计可再减 ~1500 行，将 `index.ts` 压至 8000 行出头：

### 任务 1：抽离 `services/turnExecutionService.ts`（预估 -800 行）
- **覆盖代码**：
  - 消息发送路由与回合调度：`routeSend`、`sendComposerPrompt`、`sendGroupMessage`；
  - 待发送队列：`enqueueDraft`、看门狗定时器 `armTurnWatchdog` / `disarmTurnWatchdog`；
  - 附件与多模态数据上行：图片 base64 读取与 `image.attach_bytes`。

### 任务 2：抽离 `gateway/gatewayEventDispatcher.ts`（预估 -700 行）
- **覆盖代码**：
  - WebSocket 连接与断开生命周期：`connect`、`disconnect`；
  - 下行事件解包分发与合流：`applyTurnActions`、`reduceGatewayEvent` 响应处理；
  - 保持流式增量直接管道（TokenCoalescer / toolPatchQueue）与全量渲染解耦。

---

## 四、核心验收命令速查

```bash
# 1. 桌面端构建
npm run build:desktop

# 2. 严格类型检查 (0 错误)
npm run typecheck

# 3. 改动集门禁自检 (0 新增违规)
npm run gates:changed

# 4. 门禁反向杀伤力自证 (12/12 必须通过)
npm run gates:self-proof

# 5. 全量单元测试 (166 文件全部通过)
npm test

# 6. 总体验收门禁
npm run verify
```
