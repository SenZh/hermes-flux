# Hermes Flux 架构拆解执行委托书（第四阶段 · Batch 4）

> **承接代理**：子代理（Subagent）。  
> **任务目标**：将 `packages/desktop/src/renderer/index.ts`（当前 9683 行）中的 **D5: 回合执行与队列控制服务**（`turnExecutionService.ts`）与 **D6: 网关 WebSocket 下行事件分发服务**（`gatewayEventDispatcher.ts`）彻底剥离，目标行数压至 8000 行出头，并保持 100% 绿灯。

---

## 一、必须遵守的架构铁律（违反即一票否决）

1. **单向 Deps 依赖注入模式**：
   - 抽离的模块内部**严禁** `import ... from '../index.js'`（绝对零反向依赖）；
   - 所有外部读取与宿主副作用（`render`、`state` 字段读写、`showToast` 等）一律通过 `createXxx(deps)` 接口传入；
2. **流式 120 FPS 物理双轨分流**：
   - 高频增量 chunk（`append-content`, `append-thought`）**严禁**调用 `render()` 或修改宏观状态；只能直通 `tokenCoalescer` 与 `toolPatchQueue`；
   - 只有低频生命周期边界（`turn-completed`, `turn-failed` 等）才允许调用 `requestRender()`；
3. **零 `as any` 与严格类型推导**：
   - `npm run typecheck` 必须为 0 错误；
4. **保留单行薄委托（Thin Delegation）**：
   - `index.ts` 内部保留原函数签名的转发函数（如 `function routeSend(...)`, `function connect(...)`, `function disconnect(...)`），确保接线守卫测试不被破坏；
5. **构建与单测闭环**：
   - 在 `packages/desktop/scripts/build.mjs` 中注册新模块打包配置；
   - 在 `packages/desktop/__tests__/unit/` 下为新模块编写脱离浏览器的纯逻辑单测；
   - 及时同步 `scripts/gates/rules/maintainability.mjs` 的 `KNOWN_OVERSIZE` 行数。

---

## 二、本次切分目标清单

### 目标 1：D5 `packages/desktop/src/renderer/services/turnExecutionService.ts`（预估 -800 行）
- **覆盖代码**：
  - 消息发送路由：`routeSend`、`sendComposerPrompt`、`sendGroupMessage`；
  - 待发送队列提交与处理：`enqueueDraft`、`handleQueueAction`；
  - 回合看门狗定时器：`armTurnWatchdog`、`disarmTurnWatchdog`、`isStreamingActiveForCurrentSession`；
  - 多模态图片上传附件挂载（base64 字节流发送至 `image.attach_bytes`）；
  - 回合中断：`interruptTurn`；
  - 终态指示器设置：`armPresenceTerminal`、`clearPresenceTerminal`、`setTimedDockNotice`。

### 目标 2：D6 `packages/desktop/src/renderer/gateway/gatewayEventDispatcher.ts`（预估 -700 行）
- **覆盖代码**：
  - 网关连接与断开生命周期：`connect`、`disconnect`；
  - 下行事件解包与流式分派：`handleGatewayEvent`、`applyTurnActions`、`reduceGatewayEvent` 响应消费；
  - 维护连接代际令牌 `connectionEpoch`，防止迟到事件污染当前会话；
  - 状态同步清理：断开时清空运行中与未读集合（`activeRunningSessionIds`, `unreadSessionIds` 等）。

---

## 三、验收命令清单（必须全部跑通）
1. `npm run build:desktop`
2. `npm run typecheck`
3. `npm run gates:changed`
4. `npm run gates:self-proof`
5. `npm test`
6. `npm run verify`
