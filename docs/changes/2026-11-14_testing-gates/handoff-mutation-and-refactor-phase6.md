# 交接文档：数字员工、群聊、设置与项目服务解耦（Batch 6 · 2026-11-15）

> **目标读者**：接手本工作的下一个 session 或子代理（Subagent）。  
> **上下文背景**：本阶段完成了 Batch 6 的大规模服务剥离：将 Profile 与数字员工管理服务 (`profileManagementService.ts`)、群聊研讨室运维服务 (`groupOperationService.ts`)、设置中心数据服务 (`settingsDataService.ts`) 以及项目树操作服务 (`projectOperationService.ts`) 彻底从 `packages/desktop/src/renderer/index.ts` 抽出。行数由 7075 行**大幅暴降至 5782 行**（较最初 11857 行**累计净减少 6075 行，减幅已超过 51%**）。全量构建、严格类型、静态门禁、12项自证、175个测试文件（2105个用例）、CDP与总体验收门禁 100% 绿灯。

---

## 一、指标大盘与收益

1. **`renderer/index.ts` 巨石瘦身突破**：
   - 物理行数：由 **7075 行**（Batch 5 交付时）缩减至 **5782 行**（**净减少 1293 行**，累计较原始 11857 行减少 **6075 行**，代码量已经腰斩）；
   - `scripts/gates/rules/maintainability.mjs` 中的 `KNOWN_OVERSIZE` 硬上限已收缩至 **`5790`**（只降不升棘轮机制生效）；
2. **测试套件与安全防线**：
   - 新增 4 个独立服务模块（`profileManagementService.ts` 366 行，`groupOperationService.ts` 238 行，`settingsDataService.ts` 663 行，`projectOperationService.ts` 129 行）；
   - 新增 14 项行为单元测试（覆盖主工位秒开、冷路径回退、群聊权威门、说话者推导、端点动作表、项目列表容错等）；
   - 全套测试文件增加至 **175 个**，测试用例增加至 **2105 个**（2102 通过，3 跳过，0 失败）；
   - 13 个接线守卫测试（Wiring Guards）100% 通过。

---

## 二、当前已抽离的 21 大领域模块清单

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
| **窗口管理**（虚拟窗口已于 2026-11-16 废弃，当前为纯原生流） | `messageWindowManager.ts` | 369 | 纯原生流下仅保留行高锁定与视口校正 |
| **渲染装配协调** | `renderCoordinator.ts` | 836 | 视图模型 WeakMap 缓存映射、React 消息列表增量挂载与收敛、主 render 协调 |
| **下拉热键控制** | `dropdownKeybindController.ts` | 453 | 模型搜索过滤、Provider 分组折叠、键盘导航与级联定位、全局快捷键绑定 |
| **数字员工管理** | `services/profileManagementService.ts` | 366 | Profile 与数字员工管理、主工位秒开、自动轮询与切换 |
| **群聊运维服务** | `services/groupOperationService.ts` | 238 | 群聊拉取、日志轮询、说话者权威推导、跨域回滚解除 |
| **设置数据服务** | `services/settingsDataService.ts` | 663 | 设置中心快照生成、订阅 Auth 共享、端点删除与多 Agent 绑定 |
| **项目操作服务** | `services/projectOperationService.ts` | 129 | 项目列表拉取与网络容错、主工位动态隔离 |

---

## 三、下一阶段任务指引（Batch 7：向 ≤ 2000 行终极目标决战）

`index.ts` 目前剩余 5782 行，主要由：
1. **历史遗留的重复薄委托定义与旧实现桩**（大量在前期 batch 已经抽走但仍留在 index.ts 的辅助函数与多余中间变量，约 1800 行）；
2. **多标签文件浏览器与工具栏视图逻辑**（Multi-tab file viewer & OpenChamber toolbar，`openFiles`、`activeFilePath`、`fileViewMode`，约 900 行）；
3. **顶栏 Titlebar 状态与平台按键逻辑**（`getTitlebarSnapshot`、`windowControls`，约 500 行）；
4. **冷启动装配与初始化自举流程**（`initApp`，约 400 行）；
5. 经过 Batch 7 将上述内容清理并抽离后，`index.ts` 将直接达成 **$\le 2000$ 行以内** 的终极目标！

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

# 5. 全量单元测试 (175 文件全部通过)
npm test

# 6. 总体验收门禁
npm run verify
```
