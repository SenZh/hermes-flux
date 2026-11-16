# Hermes Flux 架构拆解执行委托书（第三阶段 · Batch 3）

> **承接代理**：子代理（Subagent）。  
> **任务目标**：将 `packages/desktop/src/renderer/index.ts`（当前 10838 行）中的 **D3: 会话生命周期与设置切换服务**（`sessionOperationService.ts`）与 **D4: 消息加载与历史分页服务**（`messageLoadingService.ts`）完全剥离，目标行数压至 9000 行以下，并保持 100% 绿灯。

---

## 一、必须遵守的架构铁律（违反即一票否决）

1. **单向 Deps 依赖注入模式**：
   - 抽离的模块内部**严禁** `import ... from '../index.js'`（绝对零反向依赖）；
   - 所有外部读取与宿主副作用（`render`、`state` 字段读写、`showToast`、`confirmModal` 等）一律通过 `createXxxService(deps)` 接口传入；
2. **零 `as any` 与严格类型推导**：
   - `npm run typecheck` 必须为 0 错误；
3. **保留单行薄委托（Thin Delegation）**：
   - `index.ts` 内部保留原函数签名的转发函数（如 `function loadMessages(...)`），确保现存 13 个读取源码文本的接线守卫测试不被破坏；
4. **构建与单测闭环**：
   - 在 `packages/desktop/scripts/build.mjs` 中注册新模块打包配置；
   - 在 `packages/desktop/__tests__/unit/` 下为新模块编写脱离浏览器的纯逻辑单测；
   - 及时同步 `scripts/gates/rules/maintainability.mjs` 的 `KNOWN_OVERSIZE` 行数。

---

## 二、本次切分目标清单

### 目标 1：D3 `packages/desktop/src/renderer/services/sessionOperationService.ts`（预估 -800 行）
- **覆盖代码**：
  - 会话创建 `createNewSession`；
  - 会话删除 `deleteSession`（含 `handleArmedOnDelete`、`cancelColdStartFocus`）；
  - 会话重命名 `renameSession`；
  - 会话操作：`pinSession`、`archiveSession`、`exportMarkdown`、`copySessionId`；
  - 会话选择 `selectSession`（含会话草稿暂存与恢复、流式互斥判断、断开与离开前回滚解除 `disarmRollbackOnLeave`）；
  - 模型设置切换：`switchModel`、`applyModelToLiveSession`、`switchReasoning`、`switchApproval`；
  - 会话列表刷新调度：`scheduleSessionsRefresh`。

### 目标 2：D4 `packages/desktop/src/renderer/services/messageLoadingService.ts`（预估 -900 行）
- **覆盖代码**：
  - 核心消息加载：`loadMessages` 与 `loadMessagesInner`；
  - 历史分页漫游：`loadOlderMessages`（含血缘追溯、父会话偏移 `sessionParentOffsetMap`、`hasRemainingParentLineage`、`sessionOvershootRetry` 高估回退重拉、权威历史判定 `sessionHistoryTrust` 与 `syncUntrustedCacheOrderFlag`）；
  - 消息解析与归一化：`parseRawMessages`；
  - 游标缓存状态清理：`forgetOlderCursorState`；
  - 会话副标题与最后一条预览同步：`syncActiveSessionPreviewToRail`。

---

## 三、验收命令清单（必须全部跑通）
1. `npm run build:desktop`
2. `npm run typecheck`
3. `npm run gates:changed`
4. `npm run gates:self-proof`
5. `npm test`
6. `npm run verify`
