# 中间核心交互区与输入舱实施落地规划 (Implementation Plan)

> **关联规范**：[`docs/architecture/interactive-conversation-stage-spec.md`](./interactive-conversation-stage-spec.md)  
> **质量基线**：`npm run verify` (gates + typecheck + test) & CDP 物理测试  

---

## 一、阶段拆解与实施路线图

```text
┌────────────────────────────────────────────────────────────────────────┐
│ Phase 1: packages/core 状态机与协议层 (Core Logic & Protocol)          │
│  - chatQueueStore: 待发队列管理器（不可变冻结、取消/调序/编辑/插队）   │
│  - rollback & truncate: 对话历史截断重发与单步撤销调度                 │
│  - branchService: session.branch 独立会话派生                          │
│  - in-flight steering: session.correction 运行时纠偏接入               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 依赖暴露
┌───────────────────────────────────▼────────────────────────────────────┐
│ Phase 2: packages/ui 表现层组件重构 (UI Components)                    │
│  - MiddlePod 消息行操作栏: 常驻微距排布、精确时间戳、回滚/Fork/复制   │
│  - 深度思考链折叠: Thought Chain 手风琴、呼吸动效与耗时度量            │
│  - 阶梯式 Token 性能仪表: 总 Token 胶囊 + 点击展开 TPS/缓存率 Popover  │
│  - 右上角上下文水位计: 42k/128k 实时占用与灰/金/红警戒色阶             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 联动交互
┌───────────────────────────────────▼────────────────────────────────────┐
│ Phase 3: 悬浮输入舱与多模态赋能 (Composer & Multimodal)                │
│  - Provider 折叠模型选择器: 手风琴分组、即时搜索与 Context 标签        │
│  - 剪贴板与拖拽捕获: Ctrl+V 拦截、10MB 门限、2048px Canvas 等比下采样  │
│  - 斜杠命令与技能 Popper: `/` 自动补全、系统与 Skill 统一分发          │
│  - `@` 智能引用 Popper: `@file` 相对路径注入、单聊/群聊 `@agent` 隔离  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 端到端闭环
┌───────────────────────────────────▼────────────────────────────────────┐
│ Phase 4: 跨端适配与确定性门禁 (Cross-Platform & Quality Gates)         │
│  - 移动端 WebKit 防卡死: flushSync + rAF 键盘焦点编排、动量对抗        │
│  - 单测覆盖: chatQueueStore 调序插队、truncateAndBranch 状态机         │
│  - CDP 无头浏览器物理验证: Pixel 8 移动端视口、44pt 触控热区断言       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 二、模块改动清单与职责划分

| 模块 | 关键文件路径 | 改动类型 | 核心职责 |
|---|---|---|---|
| `packages/core` | `src/store/chatQueueStore.ts` | 新增 | 待发消息队列状态机（不可变快照、生命周期管理、内存释放） |
| `packages/core` | `src/session/rollbackService.ts` | 增强 | 封装 `prompt.submit` 截断与 `session.undo` 单步撤回 |
| `packages/core` | `src/session/branchService.ts` | 增强 | 封装 `session.branch` 基于 `count` 派生独立 Session |
| `packages/core` | `src/slash/slashCatalogService.ts`| 增强 | 聚合网关 `commands.catalog` 与本地命令/Skills 目录 |
| `packages/ui` | `src/components/MiddlePod/MiddlePod.ts` | 重构 | 常驻微距操作栏、思考链折叠、阶梯式 Token 仪表、身份头 |
| `packages/ui` | `src/components/InputDock/InputDock.ts` | 重构 | 740px 限宽输入舱、Provider 折叠选择器、附件托盘与排队抽屉 |
| `packages/ui` | `src/utils/imagePreprocessor.ts` | 新增 | 前端 Canvas 等比自适应下采样与 10MB 门限拦截（纯 UI 层） |
| `packages/desktop`| `src/renderer/index.ts` | 装配 | 接入队列事件流、快捷键映射与跨端状态更新 |
| `packages/mobile` | `src/capacitor-bridge.ts` | 增强 | WebKit 键盘动效编排、`.oc-kb-caret-hold` 与动量对抗 |

---

## 三、确定性验收流水线

1. **静态代码质量门禁**：
   ```bash
   npm run gates:changed    # 静态门禁无新增阻断项
   npm run typecheck        # 0 TS 报错，无 as any
   ```
2. **状态机与核心逻辑单测**：
   ```bash
   node --test packages/core/__tests__/queue/chatQueueStore.test.mjs
   node --test packages/core/__tests__/session/truncateAndBranch.test.mjs
   ```
3. **真实无头浏览器 CDP 物理度量**：
   ```bash
   node --test packages/desktop/__tests__/cdp/interactive-stage-cdp.test.mjs
   ```
