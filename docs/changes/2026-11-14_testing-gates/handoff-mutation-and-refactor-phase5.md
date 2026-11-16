# 交接文档：渲染协调、虚拟窗口与热键解耦（Batch 5 · 2026-11-15）

> **目标读者**：接手本工作的下一个 session 或子代理（Subagent）。  
> **上下文背景**：本阶段完成了 Batch 5 终极攻坚战：将渲染装配协调管线 (`renderCoordinator.ts`)、对话流虚拟窗口管理 (`messageWindowManager.ts`) 以及模型下拉与热键控制器 (`dropdownKeybindController.ts`) 从 `packages/desktop/src/renderer/index.ts` 抽出。行数由 8608 行进一步大幅削减至 **7075 行**（较最初 11857 行**累计净减 4782 行**）。全量构建、严格类型、静态门禁、12项自证、171个测试文件（2091个用例）、CDP与总体验收门禁 100% 绿灯。

---

## 一、指标大盘与收益

1. **`renderer/index.ts` 巨石瘦身突破**：
   - 物理行数：由 **8608 行**（Batch 4 交付时）缩减至 **7075 行**（**净减少 1533 行**，累计较原始 11857 行减少 **4782 行**）；
   - `scripts/gates/rules/maintainability.mjs` 中的 `KNOWN_OVERSIZE` 硬上限已收缩至 **`7080`**（只降不升棘轮机制生效）；
2. **测试套件与安全防线**：
   - 新增 3 个独立领域模块（`renderCoordinator.ts` 836 行，`messageWindowManager.ts` 369 行，`dropdownKeybindController.ts` 453 行）；
   - 新增 19 项行为单元测试（覆盖窗口切片、滑动规划、行高锁定、快照模型装配、弱引用缓存、思考等级白名单校验、全局快捷键等）；
   - 全套测试文件增加至 **171 个**，测试用例增加至 **2091 个**（2088 通过，3 跳过，0 失败）；
   - 13 个接线守卫测试（Wiring Guards）100% 通过。

---

## 二、当前已抽离的 17 大领域模块清单

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
| **回合执行服务** | `services/turnExecutionService.ts` | 838 | 消息发送路由分发、单聊发送与 rowId 绑定、BTW 旁路路由分流、群聊专属发送、看门狗定时器与中断 |
| **网关事件分派** | `gateway/gatewayEventDispatcher.ts` | 686 | 连接生命周期、代际隔离防污染、120 FPS 流式双轨分流（高频 delta 零 render 直通）、下行事件解包 |
| **虚拟窗口管理** | `messageWindowManager.ts` | 369 | 滑动窗口规划、行高锁定、变矮豁免、虚拟坐标换算 |
| **渲染装配协调** | `renderCoordinator.ts` | 836 | 视图模型 WeakMap 缓存映射、React 消息列表增量挂载与收敛、主 render 协调 |
| **下拉热键控制** | `dropdownKeybindController.ts` | 453 | 模型搜索过滤、Provider 分组折叠、键盘导航与级联定位、全局快捷键绑定 |

---

## 三、下一阶段任务指引（Batch 6：剩余长逻辑清场与向 ≤2000 行最终冲刺）

`index.ts` 剩余 7075 行主要由以下几块构成：
1. **数字员工与 Profile 刷新管理**（`fetchProfiles`、`warmBotForeverChats`、`switchProfile`、`refreshProfilesFromServer`，约 800 行）；
2. **群聊研讨室运维与日志轮询**（`openGroupRoom`、`refreshGroupRoomLog`、`fetchGroupRooms`，约 600 行）；
3. **设置中心业务面板装配与数据拉取**（`fetchSettingsProfiles`、`fetchCustomEndpoints`、`toggleProvider`，约 1200 行）；
4. **项目树管理与会话归属**（`fetchProjects`、`syncProfileLastMessages`，约 400 行）；
5. 抽离上述 4 大块后，`index.ts` 将彻底被压入 **2000 行以内**，完成终极目标。

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

# 5. 全量单元测试 (171 文件全部通过)
npm test

# 6. 总体验收门禁
npm run verify
```
