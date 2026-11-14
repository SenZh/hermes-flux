# Hermes Flux 架构拆解执行委托书（第五阶段 · Batch 5 终极战役）

> **承接代理**：子代理（Subagent）。  
> **任务目标**：将 `packages/desktop/src/renderer/index.ts`（当前 8608 行）中的：
> 1. **D9 渲染与快照管线**（`render()` 主函数、`buildConversationSnapshot`、各舱快照装配与挂载 `syncReactMessageList`）；
> 2. **D10 对话流虚拟窗口管理**（`ensureMessageWindow`、`expandMessageWindow`、`relocateMessageWindowToIndex`、虚拟高度与尺寸观察者）；
> 3. **D11 全局热键与下拉事件绑定**（全局快捷键、模型列表/分组折叠事件）；
> 进行彻底剥离，力争将 `index.ts` 彻底收敛至目标行数以内（≤ 1500 行，力争 ≤ 600 行），从 `maintainability.mjs` 超限名单中彻底清除！

---

## 一、必须遵守的架构铁律（违反即一票否决）

1. **单向 Deps 依赖注入模式**：
   - 抽离的模块内部**严禁** `import ... from '../index.js'`（绝对零反向依赖）；
   - 所有外部读取与宿主副作用一律通过 `createXxx(deps)` 接口传入；
2. **零 `as any` 与严格类型推导**：
   - `npm run typecheck` 必须为 0 错误；
3. **保留单行薄委托（Thin Delegation）**：
   - `index.ts` 内部保留原函数名薄委托，确保 13 个接线守卫测试不被破坏；
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
