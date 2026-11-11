---
name: verify-hermes-flux
description: Hermes Flux 桌面端与 Web 工作台端到端物理行为验证技能。驱动真实 Blink 浏览器内核加载构建产物，操控专职智能体主工位、会话流、研讨室与输入舱，并捕获确定性截图与状态证据。当需要对工作台做用户视角的端到端功能验证、回归防退化或发布前验货时使用。
---

# Verify Hermes Flux

Hermes Flux 是面向 Hermes Agent 全生态构建的全平台端到端极客美学工作台。本技能提供确定性、可脚本化驱动的真实物理行为验证管道：冷启动拉起实例、执行真实用户操作、验证状态机流转并捕获带时间戳与状态快照的视觉证据。

## Launch

验证引擎采用轻量同构隔离 Harness 驱动编译后的生产静态包（`packages/desktop/dist/` 与 `@hermes-flux/core`、`@hermes-flux/ui`）。

- **启动命令**：
  ```bash
  node scripts/verify/control-flux.mjs run <feature-id>
  ```
- **判定就绪条件**：
  静态伺服端口与 CDP 调试端口（由内核动态分配非 0 端口）监听成功，Blink 引擎完成首帧排版，DOM 树中出现 `#flux-app-root` 且 `window.cdpApp` 或 `window.__fluxState` 完成挂载。
- **环境隔离要求**：
  禁止固定硬编码端口；浏览器 `user-data-dir` 严格采用 `path.join(os.tmpdir(), 'flux-verify-<timestamp>')` 临时沙箱，确保并发驱动时不产生锁冲突或会话状态污染。

## Doctor

在开始任何驱动前，执行以下只读健康探测，确保当前构建与宿主环境处于可驱动态：

- **执行指令**：
  ```bash
  node scripts/verify/control-flux.mjs doctor
  ```
- **健康判断依据**：
  1. 系统中检测到已安装的 Microsoft Edge 或 Google Chrome 浏览器（探测路径优先）；
  2. 核心构建产物齐全：`packages/core/dist/index.js`、`packages/ui/dist/index.js`、`packages/desktop/dist/renderer/index.js`；若缺少必须先执行 `npm run build`。

## Drive

验证驱动脚本位于 `scripts/verify/control-flux.mjs`。所有交互必须通过真实 DOM 选择器与 CDP 指令驱动，严禁绕过 UI 调用内部私有 setter。

- **核心稳定手柄（Stable Handles）**：
  - 专职 Bot 抽屉卡片：`.rail-primary-agent-card`（带 `data-primary-bot` 与 `data-profile`）
  - 专职 Bot 微轨图标：`.station-agent-badge`（带 `data-station-profile`）
  - 普通会话条目：`.session-item`（带 `data-id` 与 `data-title`）
  - 群聊房间条目：`.rail-group-item`（带 `data-room-id`）
  - 顶栏实时标题：`.session-title-text`
  - 黄金限宽输入舱：`#dock-prompt-input`（textarea）
  - 消息发送按钮：`#dock-send-btn`（button）
  - 运行中呼吸脉冲：`.activity-pulse-indicator`
  - 未读翡翠绿点：`.activity-unread-badge`

- **驱动执行规范**：
  对照 `features/<feature-id>.md` 中的四段式步骤执行，断言状态演进（State Diff）与最终可见渲染。

## Evidence

所有验证过程必须沉淀真实、可追溯且在清理后依然保留的物理凭证。

- **存储目录**：`artifacts/verification/<feature-id>/`
- **凭证规范**：
  1. **全屏物理截图**：`<feature-id>/screenshot.png`（由 CDP `Page.captureScreenshot` 真实渲染捕获）；
  2. **状态快照 JSON**：`<feature-id>/evidence.json`（记录用例 ID、持续毫秒、最终 Titlebar 呈现文本、DOM 节点计算结果与成功状态）。

## Cleanup

驱动结束后执行进程优雅解耦与临时资产清理。

- **安全关闭时序**：
  1. 向 CDP 发送 `Browser.close` 协议指令，通知 Blink 主进程安全退出；
  2. 关闭 WebSocket 调试长连接；
  3. 终止本地静态 HTTP Server 句柄；
  4. 移除 `os.tmpdir()` 目录下的 `flux-verify-*` 临时数据目录，解开 Windows 文件锁；
  5. **绝对保留** `artifacts/verification/` 下的凭证文件，严禁被 cleanup 误删。

## Helpers

- `node scripts/verify/control-flux.mjs doctor`：只读健康检查；
- `node scripts/verify/control-flux.mjs run bot-primary-chat`：专职 Bot 主工位对话与时序状态联动验证；
- `node scripts/verify/control-flux.mjs run session-management`：会话生命周期与草稿保全验证；
- `node scripts/verify/control-flux.mjs run group-room`：多智能体研讨室协同验证；
- `node scripts/verify/control-flux.mjs run input-dock-controls`：输入舱黄金限宽与模型控制验证。
- `node scripts/verify/control-flux.mjs run prompt-navigator-rail`：提示词导航轨命中带宽度、面板 8 行 40px 节奏、无序号槽位与浮层遮蔽验证。
