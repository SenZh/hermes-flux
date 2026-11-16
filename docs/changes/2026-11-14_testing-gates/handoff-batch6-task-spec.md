# Hermes Flux 架构拆解执行委托书（第六阶段 · Batch 6 终极收官向 ≤ 2000 行冲刺）

> **承接代理**：子代理（Subagent）。  
> **任务目标**：将 `packages/desktop/src/renderer/index.ts`（当前 7075 行）中的：
> 1. **D12 数字员工与 Profile 刷新服务**（`profileManagementService.ts`）：`fetchProfiles`、`warmBotForeverChats`、`switchProfile`、`refreshProfilesFromServer`、`startProfileAutoRefresh`、`stopProfileAutoRefresh`、`syncSessionBotDisplayNames` 等（约 800 行）；
> 2. **D13 群聊研讨室运维服务**（`groupOperationService.ts`）：`fetchGroupRooms`、`openGroupRoom`、`refreshGroupRoomLog`、`syncGroupRoomLogsToState`、`syncActiveGroupSpeakerFromMessages` 等（约 600 行）；
> 3. **D14 设置中心业务装配与数据服务**（`settingsDataService.ts`）：`fetchSettingsProfiles`、`fetchCustomEndpoints`、`toggleProvider`、`removeCustomEndpoint`、`loadMcpAndSkills` 等设置中心下层数据调用（约 1200 行）；
> 4. **D15 项目树管理与会话归属服务**（`projectOperationService.ts`）：`fetchProjects`、`syncProfileLastMessages`（约 400 行）；
> 
> 彻底剥离上述 4 大块，使 `index.ts` 物理行数**断崖式击穿至 2000 行以内**，甚至收敛至 1500 行以内，彻底从 `maintainability.mjs` 超限名单中移除！

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
