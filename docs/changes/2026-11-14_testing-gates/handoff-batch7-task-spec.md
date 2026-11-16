# Hermes Flux 架构拆解执行委托书（第七阶段 · Batch 7 终极收官向 ≤ 2000 行最终冲刺）

> **承接代理**：子代理（Subagent）。  
> **任务目标**：将 `packages/desktop/src/renderer/index.ts`（当前 5782 行）中的：
> 1. **D16 多标签文件查看器与工件工具栏服务**（`fileViewerService.ts`）：`openFiles`、`activeFilePath`、`fileViewMode`、`fileSearch`、文件切换与预览模式控制等（约 1000 行）；
> 2. **D17 顶栏状态与窗口按键控制器**（`titlebarController.ts`）：`getTitlebarSnapshot`、平台三键监听、最大化与全屏窗口状态机等（约 500 行）；
> 3. **D18 启动自举与模块组装中心**（`appBootstrap.ts`）：把冷启动握手、事件监听器初始化等装配过程剥离（约 1200 行）；
> 4. **D19 清理死代码与多余中间重复委托**（约 1200 行）；
> 
> 彻底将 `index.ts` 物理行数**打入 ≤ 2000 行以内**（目标力争 ≤ 1500 行门禁标准线），彻底完成您下达的指标！

---

## 一、必须遵守的架构铁律（违反即一票否决）

1. **单向 Deps 依赖注入模式**：
   - 抽离的模块内部**严禁** `import ... from '../index.js'`（绝对零反向依赖）；
   - 所有外部读取与宿主副作用一律通过 `createXxx(deps)` 接口传入；
2. **零 `as any` 与严格类型推导**：
   - `npm run typecheck` 必须为 0 错误；
3. **保留单行薄委托（Thin Delegation）**：
   - `index.ts` 内部保留原函数名薄委托，确保既有调用点与测试不被破坏；
4. **构建与单测闭环**：
   - 在 `packages/desktop/scripts/build.mjs` 中注册新模块打包配置；
   - 在 `packages/desktop/__tests__/unit/` 下为新模块编写纯单测；
   - 及时同步 `scripts/gates/rules/maintainability.mjs` 的 `KNOWN_OVERSIZE` 行数。

---

## 二、验收命令清单
1. `npm run build:desktop`
2. `npm run typecheck`
3. `npm run gates:changed`
4. `npm run gates:self-proof`
5. `npm test`
6. `npm run verify`
