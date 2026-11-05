# Hermes Flux 核心工程纪律 (Core Engineering Discipline)

本项目是全平台极客美学工作台。工程纪律聚焦于**消除架构腐化、杜绝假空伪证、保障极致性能与状态机严密性**。

---

## 一、最高元原则 (First Principles)

1. **最小完整变更 (Smallest Complete Change)**：
   每次代码修改必须聚焦于当前问题的完整闭环，在覆盖真实风险的最窄层级验证，严禁借修复之名进行投机性重构或无依据的过度抽象。
2. **零假冒交付 (Zero-Illusion Delivery)**：
   静态推断通过不代表运行时有效。涉及可达界面的修改，必须具有真实运行依据与有效断言；单测必须具备证伪性，严禁恒等空断言。
3. **权威优先与失败不可静默 (Authority & Explicit Failure)**：
   实时长连接通道高于持久化冷启动快照；网络与服务故障绝不可静默捕获吞为空数据（Failure Is Not Empty）。允许降级，但降级必须显式可观测。
4. **单向分层至高无上 (Strict Unidirectional Decoupling)**：
   $$\text{packages/desktop} \mid \text{packages/mobile} \mid \text{packages/web} \longrightarrow \text{packages/ui} \longrightarrow \text{packages/core}$$
   - `core` 纯无界协议与领域模型，零 DOM、零 React、零 Electron 依赖；
   - `ui` 纯表现层，禁止调用私有平台 IPC 或绕开 Core 发送裸网络请求；
   - 平台壳层仅做轻量宿主容器，严禁在壳内编写应用级业务状态机。

---

## 二、长连接与会话状态机不变量 (State Machine Invariants)

1. **三态会话物理隔离**：
   - **普通会话 (Scratchpad)**：独立排查池，支持截断、撤销、分叉与重命名；
   - **专职 Bot 主工位 (Forever Chat)**：`hidden=1` 物理保护，禁止前端提供删除/归档，唯一法定更新 Bot `MEMORY.md` 通道；
   - **多 Agent 群聊研讨室 (Group Room)**：独立数据库空间，仅走 `groups.*` 专用 RPC，严禁反向回写单个 Bot 长期记忆。
2. **慢响应防复活 (Anti-Resurrection Tombstone)**：
   执行删除实体后，本地状态机必须记录带单调版本的逻辑删除墓碑。在途迟滞慢响应返回的陈旧全量快照，严禁将已删实体复活挂回界面。
3. **判别联合契约 (Discriminated Unions)**：
   生命周期状态必须使用判别联合表达（如 `{ status: 'idle' } | { status: 'loading' } | { status: 'success' } | { status: 'error' }`），禁止使用多个松散的 boolean 字段拼凑状态，使非法状态在类型系统中不可表达。

---

## 三、渲染性能与前端体验军规 (Performance Invariants)

1. **会话流即时定位**：
   长消息列表容器绝对禁止使用 `scroll-behavior: smooth`，必须即时定位以吸收高频流式输出与排版漂移。
2. **视口滚动跟随不变量**：
   读者视口距离底部 $\le 48\text{px}$ 时紧密跟随贴底；远离时视为用户正在回溯翻阅历史，严禁自动滚动打扰用户视线。
3. **动画与指示器能耗防线**：
   禁止在界面中滥用未经管制的 `infinite` 关键帧动效，避免无意义占满合成器与 GPU 算力。
4. **长列表窗口化挂载**：
   超长消息会话采用视口窗口化（Windowed Mounting）策略渲染，维持 100 左右活跃节点数，确保上万条消息长会话下丝滑流畅。

---

## 四、自动化质量门禁基线 (Automated Quality Gates)

提交或合并代码前，本地必须跑通五大核心验证：
1. `npm run gates:changed`：改动集静态门禁（分层依赖、类型逃逸、换肤 Token 零硬编码，新增违规严格为 0）；
2. `npm run typecheck`：全栈严格类型推导（0 TS 错误）；
3. `npm test`：全量单测回归（100% 绿灯通过）；
4. `npm run verify:formal`：fast-check 形式化并发不变量验证（核心定理零反例获证）；
5. `npm run verify`：交付前全量总体验收（gates + contract + typecheck + test + formal 一键全绿）。
