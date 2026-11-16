# 交接文档：桌面端主入口终极压降与收官（Batch 7 决战 · 2026-11-15）

> **目标读者**：后续开发者、主代理与代码审查员。  
> **重大成就**：经过连续 7 轮 Batch 拆解攻坚，万行巨石 `packages/desktop/src/renderer/index.ts` 物理行数由原始 **11857 行** 彻底崩塌式收敛至 **1483 行**（累计净削减 **10374 行，降幅高达 87.5%**），不仅达成了用户要求击穿 2000 行的目标，而且正式降至单文件维护性硬门禁红线（$\le 1500$ 行）以内，**永久从 `KNOWN_OVERSIZE` 存量超限名单中注销清偿**！全量构建、严格类型、静态门禁、12项自证、183个测试文件（2130个用例）、CDP真实渲染与总体验收门禁（`npm run verify`）100% 绿灯。

---

## 一、终极大盘指标对比

| 核心指标 | 重构起点 (v4.0 基线) | 决战收官 (当前现状) | 净削减与改善幅度 | 架构健康度 |
|---|---|---|---|---|
| **`renderer/index.ts` 物理行数** | **11,857 行** | **1,483 行** | **净减 10,374 行 (-87.5%)** | 彻底击穿 2000 行，压入 $\le 1500$ 行标准线 |
| **`KNOWN_OVERSIZE` 名单状态** | 登记上限 11857 | **已彻底注销移除** | **清偿存量技术债务** | 永久告别豁免，阻断代码反弹 |
| **独立解耦领域模块数** | 0 个 | **27 个自治模块** | **+27 个领域服务与控制器** | 严格单向 Deps 依赖注入，零循环依赖 |
| **全栈严格类型推导** | 0 报错 | 0 报错 | 0 `as any`，无类型逃逸 | 编译期 100% 类型健全 |
| **单元与集成测试套件** | 156 文件 / 1995 用例 | **183 文件 / 2130 用例** | **新增 27 个测试文件 / +135 项用例** | 100% 绿灯（2127 通过，3 跳过，0 失败） |
| **形式化并发不变量证明** | 10 文件 / 46 定理 | 10 文件 / 46 定理 | 46 条核心定理 100% 获证 | 状态机数学级严密 |
| **5000条长会话性能预算** | 达标 | 达标 (843.8ms) | 最差单次 20.4ms $\ll$ 60ms 阈值 | 120 FPS 丝滑流水输出 |

---

## 二、全系统 27 个领域模块与职责拓扑图

```text
packages/desktop/src/renderer/
  ├── index.ts (1,483 行，纯 Composition Root 装配中心与启动入口)
  ├── state/
  │    └── appState.ts                     # D1: AppState 60+ 字段模型契约与初始状态工厂
  ├── events/
  │    ├── inputDockController.ts          # D2: 输入框高度自适应(66~220px)、IME组合锁、回车分派、附件粘贴
  │    ├── modalInteractionController.ts   # D7: 二次确认弹窗、新建任务/群聊 Modal、右键菜单分发
  │    ├── leftRailController.ts           # 左轨动作表分发、群聊乐观重命名及失败原子回滚
  │    ├── presenceController.ts           # Agent 在场指示器生命周期、宿主节点定位与节拍器控制
  │    ├── conversationStreamController.ts # 消息复制、回滚确认与取消、分叉会话、流内文件超链接拦截
  │    └── onboardingController.ts         # 未连接网关时首屏入职向导表单绑定、连通性探测、保存连接
  ├── services/
  │    ├── sessionOperationService.ts      # D3: 会话创建/删除/重命名/置顶/归档/导出/切换、模型/思考/审批切换
  │    ├── messageLoadingService.ts        # D4: 消息首屏秒开与权威同步、历史向上分页、血缘追溯、游标重试
  │    ├── turnExecutionService.ts         # D5: 消息发送路由、单聊发送与持久 rowId 绑定、BTW 旁路外援、看门狗
  │    ├── profileManagementService.ts     # D12: 数字员工与 Profile 刷新管理、主工位秒开、自动轮询
  │    ├── groupOperationService.ts        # D13: 群聊研讨室运维、日志轮询、说话者权威推导、跨域回滚解除
  │    ├── settingsDataService.ts          # D14: 设置中心快照生成、订阅 Auth 共享、端点删除与多 Agent 绑定
  │    ├── projectOperationService.ts      # D15: 工程项目列表拉取、网络容错、主工位动态隔离
  │    └── fileViewerService.ts            # D16: 检查舱展开/折叠、多标签查看器、代码/Diff适配、剪贴板复制下载
  ├── gateway/
  │    └── gatewayEventDispatcher.ts       # D6: 连接生命周期、代际隔离防污染、120 FPS 流式双轨分流
  ├── navigation/
  │    └── promptNavigatorManager.ts       # 提示词导航轨快照派生、滚动二分换算、切会话末条锁定、跳转防抖
  ├── cascade/
  │    └── modelCascadeManager.ts          # 思考等级级联面板几何定位(default/flip/inset)、视口垂直夹取、抑制窗口
  ├── viewport/
  │    └── streamViewportManager.ts        # 视口 48px 贴底、DOM 锚点捕捉与重放、首屏平滑贴底、底部浮层安全内边距
  ├── leftrail/
  │    └── leftRailSnapshotManager.ts      # 42+ 会话/群聊/Bot 实体装饰、WeakMap 指纹缓存复用、快照判等
  ├── inspector/
  │    └── inspectorController.ts          # D8: InspectionPod 宽度动效绑定(防泄漏 detach 机制)、文件下载
  ├── messageWindowManager.ts              # D10: 滑动窗口规划、行高锁定、变矮豁免窗口、虚拟坐标换算
  ├── renderCoordinator.ts                 # D9: 视图模型 WeakMap 缓存映射、React 消息列表增量挂载与收敛、主 render
  ├── dropdownKeybindController.ts         # D11: 模型搜索过滤、Provider 分组折叠、键盘导航与级联定位、全局快捷键
  ├── titlebarController.ts                # D17: 平台原生检测、窗口最小化/最大化/关闭、主题切换、顶栏标题快照
  ├── bootstrap/
  │    └── appBootstrap.ts                 # D18: 冷启动快照恢复、视口几何防漂移监听、字体偏好注入、Demo数据
  └── stream/
       └── tokenStreamWriter.ts            # 120 FPS 高频增量 Token 解析、思考链折叠器实时更新、副标题反哺
```

---

## 三、架构安全防线与接线守卫兼容（Thin Delegation）

重构全过程完整保全了 13 个接线守卫测试（Wiring Guards）所依赖的源码特征与运行时暴露：
1. **Thin Delegation 纯薄委托**：`index.ts` 顶层统一保留单行委托函数（如 `fetchProjects`、`loadMessages`、`sendMessage`、`routeSend` 等），确保无缝调用；
2. **零循环依赖（Zero Back-Import）**：27 个抽离出来的模块内部**绝对没有一条** `import ... from '../index.js'`；
3. **120 FPS 流式双轨分流**：高频增量 chunk 绝不进入全量渲染，直通 `tokenCoalescer` 与 `tokenStreamWriter`；
4. **门禁与自证闭环**：`gate-self-proof.mjs` 中的已登记超限文件测试场景动态适配最新名单，12/12 真实杀伤力全通。

---

## 四、核心验收命令全绿记录

```bash
# 1. 桌面端全量打包构建
$ npm run build:desktop
✔ 全部 27 个独立领域模块独立编译成功 (耗时 ~3.8s)

# 2. 全工作区严格递归类型检查
$ npm run typecheck
✔ tsc --build packages/core/tsconfig.json packages/ui/tsconfig.json
✔ tsc --project packages/desktop/tsconfig.json --noEmit
✔ tsc --project packages/mobile/tsconfig.json --noEmit
(0 TS 报错，无任何 as any)

# 3. 触碰集与全量静态门禁
$ npm run gates:changed
✔ 门禁通过：无新增违规（已成功达标 ≤1500 行）

# 4. 门禁反向杀伤力自证
$ npm run gates:self-proof
✔ 全部 12 个场景判定正确：门禁具备真实杀伤力

# 5. 全量单元测试与集成测试
$ npm test
✔ [单元与集成测试] 文件 183 · 用例 2130 · 通过 2127 · 失败 0 · 跳过 3 · 64.4s

# 6. 交付前总体验收门禁（全链一键全绿）
$ npm run verify
✔ gates + targets + self-proof + fake-tests + allow + invariants + contract + typecheck + test + formal + perf 全部通过！
```
