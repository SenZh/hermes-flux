# 交接文档：变异测试套件落地与 index.ts 领域拆解（第一阶段 · 2026-11-14）

> **目标读者**：接手本工作的下一个 session 或子代理（Subagent）。  
> **上下文背景**：当前 session 上下文已接近上限，本阶段全部改动已在本地严格通过编译、静态门禁、自证套件、全量单测、CDP 真实浏览器端到端测试与 `verify` 链式验证。  
> **交付物状态**：已落盘在工作区，未提交（以 `git status` / `git diff` 为准）。

---

## 零、一句话结论与大盘指标

本阶段完成了两大核心目标：
1. **工业级变异测试套件（Stryker 10.1.1）正式引入并建立存量消减基盘**：建立领域化调度机制，单次执行时间控制在 15~60 秒，并以实证抓出 `coalesce` 领域 65 个变异体 NoCoverage（得分仅 23.53%）的真实老盲区；
2. **`packages/desktop/src/renderer/index.ts`（1.2万行）完成两轮实质性解耦拆解**：
   - 第一轮：抽出客户端持久化缓存桥接领域（`cache/desktopCacheBridge.ts`）；
   - 第二轮：抽出 Agent 在场与语气状态机领域（`presence/agentPresenceManager.ts`）；
   - **`index.ts` 物理行数由 11857 行实质缩减至 11395 行（净减少 462 行）**；
   - 新增 14 项高杀伤力纯逻辑行为单测，测试套件增加到 156 个文件、1995 个用例（100% 绿灯）。

---

## 一、本次交付清单与文件变更

| 文件路径 | 变更性质 | 核心职责与设计说明 |
|---|---|---|
| `package.json` / `package-lock.json` | 依赖新增 | 安装 `@stryker-mutator/core@10.1.1`、`@stryker-mutator/tap-runner@10.1.1`；注册 `npm run mutation:stryker` |
| `stryker.config.json` | 配置新增 | 默认变异测试配置，配置 `buildCommand: "npm run build:core"` 消除 dist/src 失配，排除 `desktop/release` 等大文件 |
| `scripts/gates/lib/mutation-domains.mjs` | 新增模块 | 变异测试领域注册表，将全量 15,000+ 变异体划分为 `cache`、`coalesce`、`session`、`rpc` 等独立领域并记录基线分 |
| `scripts/gates/mutation-stryker.mjs` | 新增脚本 | 领域化调度执行器，支持 `--list` 与 `--domain=<name>` 运行；设三道硬哨兵（非空、禁全员 NoCoverage、最低门禁分） |
| `packages/desktop/src/renderer/cache/desktopCacheBridge.ts` | 新增领域 | 从 `index.ts` 抽出的客户端缓存双向映射、ViewModel 归一化、IndexWriteQueue 串行写入链与分桶隔离持久化纯逻辑 |
| `packages/desktop/__tests__/unit/desktop-cache-bridge.test.mjs` | 新增单测 | 7 项行为单测：往返保真、临时主键拒签不落盘、外来父会话消息强隔离、FIFO 串行写入验证 |
| `packages/desktop/src/renderer/presence/agentPresenceManager.ts` | 新增领域 | 从 `index.ts` 抽出的 Agent 在场状态机、语气跨档派生、React 指纹防抖、单聊/群聊身份归一化与节拍器生命周期 |
| `packages/desktop/__tests__/unit/agent-presence-manager.test.mjs` | 新增单测 | 7 项行为单测：单聊身份解析、群聊说话者非运行强制 null、时钟隔离、同语气档指纹去重（不含 sinceMs 与正文） |
| `packages/desktop/src/renderer/index.ts` | 核心重构 | 拔除内嵌的缓存转换与在场状态机逻辑，通过 Host 契约注入与薄委托转发；**行数 11857 -> 11395** |
| `packages/desktop/scripts/build.mjs` | 构建更新 | 注册 `desktopCacheBridge` 与 `agentPresenceManager` 的打包配置，声明 external 避免打入 CJS 依赖 |
| `scripts/gates/rules/maintainability.mjs` | 门禁收缩 | 将 `index.ts` 的 `KNOWN_OVERSIZE` 上限从 11857 调低锁定为 11395 行 |
| `packages/desktop/__tests__/unit/agent-presence-wiring.test.mjs` | 守卫对齐 | 将接线测试目标对齐至抽出的领域模块与薄委托，15 项守卫全部通过 |
| `packages/desktop/__tests__/unit/display-kind-wiring.test.mjs` | 守卫对齐 | 兼容持久层回读从抽取的 `desktopCacheBridge.ts` 取证，14 项守卫全部通过 |
| `docs/gateway/*.md` | 文档同步 | 调用点行号变更后，通过 `npm run contract:doc` 自动重构同步 11 个契约文档 |

---

## 二、变异测试体系（Stryker）状态与运行规范

### 2.1 为什么采用领域化（Domain-Driven）而非盲目全量？
1. **算力与时间预算**：全量 Core 有 15,014 个变异体，全量跑一次需半小时以上。划分为领域后：
   - `cache` 领域：217 变异体，运行约 72 秒，得分 77.88%；
   - `coalesce` 领域：119 变异体，运行约 15 秒，得分 23.53%；
2. **防假绿哨兵（Safety Ratchet）**：
   - 测试通过 Node 原生加载 `dist/*.js`，变异在 `src/*.ts`，若漏配 `buildCommand` 变异体会全部变为 `NoCoverage`（假 0 分）；
   - 脚本强制断言：`noCoverage === totalMutants` 时立即抛错阻断。

### 2.2 存量领域消减看板与命令
```bash
# 查看所有支持的领域和门禁状态
node scripts/gates/mutation-stryker.mjs --list

# 针对指定领域执行变异测试
npm run mutation:stryker -- --domain=cache
npm run mutation:stryker -- --domain=coalesce
```

---

## 三、`renderer/index.ts` 重构的实战方法论（必须遵守）

接手者切忌「凭感觉切函数」，必须严格遵循以下已被实证的铁律：

### 3.1 为什么绝不能按函数机械切分？
`renderer/index.ts` 中 95% 的函数在共享闭包内的全局可变状态（如 `state`、定时器句柄、快照引用）。机械移动函数会导致严重的循环引用、隐式写入丢失和调用时序断裂。

### 3.2 正确的重构管道（四步法）
1. **按「状态领域簇」识别边界**：找到专用的可变变量（如 `turnStartedSessionId`、`indexWriteTail`）以及只修改它们的函数集；
2. **声明 `Host` 依赖注入接口**：抽出的模块绝不直接访问全局 `document`、`window` 或全局 `state`，所需外部数据一律通过 `Host` 传入；
3. **先写行为单测，再做替换**：在 `packages/desktop/__tests__/unit/` 下为新模块编写脱离浏览器的纯逻辑单测，用变异思维覆盖等价类和边界；
4. **宿主保留薄委托（Thin Delegation）**：在 `index.ts` 中保留原签名的转发函数，确保现存 17 个读取源码文本的 Wiring Guard 测试不被破坏。

---

## 四、下一步建议任务（按优先级排序）

下一个 session 可以直接沿着当前推进路径继续削减 `index.ts`：

### Task 1: 提示词导航状态机域（Prompt Navigator）抽离（预估 -200 行）
- **涉及代码**：`currentPromptNavigatorMeta`, `buildPromptNavigatorSnapshot`, `resolveActivePromptIndex`（约 3180 ~ 3400 行）；
- **特点**：滚动换算与 Prompt 列表投影纯逻辑，极易抽离并配套纯单测。

### Task 2: 思考等级级联定位域（Model Cascade）（预估 -180 行）
- **涉及代码**：11290 ~ 11550 行的 `showModelCascade`, `computeCascadePosition`, 抑制窗口管理；
- **注意点**：`model-picker-interaction-wiring.test.mjs` 中有读取 `showModelCascade` 和 `model-cascade--flip` 的源码断言，抽取时采用 `presenceSrc` 同款适配方式。

### Task 3: 存量消减：补齐 `tokenCoalescer.ts` 的 RAF 节拍单测
- **现状**：变异得分仅 23.53%（65 个变异体 NoCoverage）；
- **目标**：在 `packages/core/__tests__/coalesce/tokenCoalescer.test.mjs` 中补充定时器步进与动态步长断言，将杀死得分拉升至 70% 门禁线以上。

---

## 五、验收命令速查（本 session 离开前全绿）

```bash
# 1. 编译桌面与依赖
npm run build:desktop

# 2. 全量严格类型推导（0 错误）
npm run typecheck

# 3. 改动集门禁自检（0 新增违规）
npm run gates:changed

# 4. 门禁反向杀伤力自证（12/12 必须通过）
npm run gates:self-proof

# 5. 全量单元测试（156 文件，1995 用例全部通过）
npm test

# 6. CDP 真实浏览器渲染物理回归
node --test packages/desktop/__tests__/cdp/rail-handle-symmetry-cdp.test.mjs packages/desktop/__tests__/cdp/session-list-status-animation-cdp.test.mjs

# 7. 全量交付验收总门禁（必须一键全绿）
npm run verify
```
