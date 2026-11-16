# 交接文档：测试门禁体系改造（2026-11-14 · 完成态）

> 本文替代同目录下 `handoff.md` 的「下一步」部分。
> 目标读者：接手本工作的下一个 session。
> 读完本文应能：知道**已经落地了什么**、**每个结论是怎么验证的**、**还剩什么没做**。
> 提交清单以 `git log --oneline dev/v0.1..HEAD` 为准（本文不写死数量，避免自指）。

---

## 零、一句话结论

分支 `feat/testing-gates-hardening` 上的全部提交（清单见 `git log --oneline dev/v0.1..HEAD`），把「测试体系」从**口号与手写文档**
变成**可被机器证伪的六层门禁**，并给出了每一层「确实会红」的实证。

关键判据：**门禁自证套件 12/12 通过**——它证明的不是"测试通过"，而是"门禁在被违反时确实会红"。

---

## 一、交付清单

| # | 提交 | 核心内容 |
|---|---|---|
| 1 | `fix(deps)` | `workspace:*` → `*`、重建 lock、CI 改 `npm ci`。修掉"CI 从未装成依赖" |
| 2 | `feat(gates): 执行量统计层` | census：文件数/用例数/失败/跳过四维断言 + 9 条自证测试 |
| 3 | `feat(gates): 行数上限 + 测试完整性` | `packages/mobile/src` 纳入扫描、1500 行上限、禁 c8 ignore 与测试内 exit(0) |
| 4 | `ci: 补 dev/** 触发` | CI 触发分支、formal/contract/allow 作业、glob 漏跑修复 |
| 5 | `fix(tests): 三处假测试` | 三处均做过「删生产代码必须变红」的实证 |
| 6 | `feat(verify): 增量覆盖率门禁` | dist→src sourcemap 反解、未跟踪文件计入、双向验证 |
| 7 | `docs(testing): 不变量改 JSON` | 35 条不变量、9 条校验规则、10 条证伪测试 |
| 8 | `refactor(renderer): 输入补全领域` | index.ts 12071 → 11949 |
| 9 | `refactor(renderer): 持久化解析` | index.ts → 11926；修 allow 正则漏计数字标签 |
| 10 | `refactor(renderer): Bot 活动持久化` | index.ts → 11881 |
| 11 | `refactor(renderer): 会话草稿持久化` | index.ts → 11857 |
| 12 | `feat(verify): 门禁自证套件` | 12 个场景证明门禁杀伤力 |

---

## 二、已落地的六层门禁

```
L0 静态门禁      gates / typecheck（含 mobile）/ contract        规则符合性
L1 执行量自证    census-targets + census-check                    证明真的跑了
L2 单元与集成    npm test（census 包裹）                          行为正确性
L3 不变量        verify:formal + invariant-map --check            性质恒成立
L4 覆盖率        coverage:new（sourcemap 反解 + 增量判定）          执行完整性
L5 有效性        gates:mutation / self-proof / fake-tests         三层杀伤力（见下）
L6 真实渲染      CDP（未纳入 CI，见第五节风险）
```

### L5 的三层杀伤力，各管一件事

| 命令 | 问的问题 | 手法 |
|---|---|---|
| `gates:mutation` | 改坏**被测逻辑**，测试会红吗 | 变异 scanner/rules 实现 |
| `gates:self-proof` | 污染**门禁判定条件**，门禁会红吗 | 制造空 glob / 假 exit / 超限文件 |
| `gates:fake-tests` | 删掉**生产实现**，测试会红吗 | 变异 dist 产物并断言失败原因对得上 |

只做其中任一层都会留下盲区：
第一层不知道测试有没有真的连到生产代码；
第二层不知道门禁在被违反时是不是真的会红；
第三层不知道测试是不是在自证。

### 每层的实证入口

| 层 | 命令 | 它证明什么 |
|---|---|---|
| L0 | `npm run gates` | 无新增违规（存量 105 条已冻结） |
| L1 | `npm run gates:targets` | 154 文件 / 10 文件，根级 30 个 UI 测试被覆盖 |
| L2 | `npm test` | 1981 用例、1978 通过、0 失败、3 跳过（外部前置） |
| L3 | `npm run gates:invariants` | 35 条不变量，测试真实存在且含 `fc.assert` |
| L4 | `npm run coverage:new` | 新增可执行行必须 executed |
| L5 | `npm run gates:self-proof` | **12 个场景全部判定正确** |
| L5 | `npm run gates:fake-tests` | **5 条变异全部被杀死，原因逐条命中** |
| L6 | （人工） | 见第五节 |

---

## 三、实测修正的既有错误结论

接手时文档里有若干错误事实。以下每条都经过实测，**请以本节为准**。

| 原结论 | 实测 | 影响 |
|---|---|---|
| 全量覆盖率 85.84/81.79/73.56 | **91.25/81.54/81.64** | 棘轮初始值全错 |
| 476 个函数，约 1/4 未调用 | 476 是 **formal 套件**分母；全量 **1182/217（18.4%）** | 缺口被低估 |
| `process.exit(0)` 能伪造全绿 | 只在**顶层**（注册前）或 `uncaughtException` 内成立；常规位置 Node 24 已报 fail | 防御重点转移 |
| Stryker 必须用 bun | **npm 可装**（依赖修复后），版本 **10.1.1** | 工具链可用 |
| Stryker 配置无需 buildCommand | **必须加**，否则全部 `no-cov`、得分恒 0 且 `break:null` 让其通过 | 否则变异门禁形同虚设 |
| CI 实际执行 6 step | 那 6 步**从未成功执行过** | "已验证"是错觉 |
| ubuntu skip → 全绿零执行 | 当时 CI 根本不跑 `test:cdp`，是**未来风险** | 优先级下调 |
| `INV-12~16` 是合法编号 | 区间写法**无法做差集**，且存在同号异义 | 已改 JSON |

---

## 四、三处假测试：修复方式与实证

| 文件 | 原机制 | 修复后 | 删代码实证结果 |
|---|---|---|---|
| `cache-integration-wiring` | 测试内重写 `filterDurableOrderKey`/`safeParseJson` | 逻辑抽到 `persistence/persistedJson.ts`，测试导入产物 | 删 `validate` 分支 → 报「带守卫时必须回落」 |
| `live-gateway-real` | `assert.ok(true)` + 只查 `err.message` | 可控桥接断言方法名/入参契约/返回值解析 | 删解析 → 状态与进度断言失败 |
| `settings-modal` | 组件与测试同调 `t()` | 硬编码中英文锚点 + 断言无未翻译 key | 删字典 key → 报「必须渲染「Agent 状态」段」 |

新增的领域测试同样做过实证：
- `bot-activity-store`：删 `persist()` → 报「必须落盘：storage 中应出现该键」
- `session-drafts`：删 `persist()` → 报「必须落盘，否则重启后丢失」

---

## 五、尚未完成 / 已知风险

### 5.1 CDP / GUI 测试仍未纳入 CI（风险最高）

12 个 CDP 文件**全部硬编码 Windows Edge 路径**，找不到浏览器时 `t.skip()`。
在 ubuntu runner 上会变成"全绿但零执行"。

**当前状态**：`test:cdp` 不在 workflow 中，所以风险是「一旦纳入就假绿」，不是当下假绿。

**纳入前必须先做**：
1. 新建 `scripts/lib/browser-path.mjs`，解析顺序为 显式环境变量 → Playwright Chromium → 系统 Edge/Chrome，全失败时 **throw 而非 skip**；
2. 12 个文件统一改用该解析器；
3. 把 CDP 的 skipped 纳入 census 上限（当前为 0）。

### 5.2 Stryker 未接入

配置要求已明确（`buildCommand` 必配 + `noCov === total` 哨兵断言），但本分支未落地。
理由是它需要约 15-30 分钟/次 的算力预算，与本分支"先把地基打对"的目标冲突。
现有 `gates:mutation`（5 个变异点 + 锚点唯一性断言）已覆盖门禁引擎自身的证伪性。

### 5.3 `renderer/index.ts` 仍是 11857 行

已完成三处整簇抽取（输入补全、持久化解析、Bot 活动、会话草稿）。
剩余的 95% 函数**无法按函数机械抽取**——实测 218 个顶层函数中只有 11 个能独立提取，
其余都依赖 `render` / `bindEvents` / `sendMessage` 这些核心函数共享的可变状态。

**往下拆的正确路径**（不是切函数，而是切状态簇）：

| 候选领域 | 状态数 | 宿主函数数 | 写入是否闭合 | 结论 |
|---|---|---|---|---|
| 模型级联 | 3 | 1 | 否（2 个外部写者） | 需先消除外部写入 |
| rail 快照 | 3 | 3 | 否（`activityIndicatorVariant` 被设置页写） | 需先收拢写入 |
| presence 快照 | 3 | 4 | 否（`turnStartedSessionId` 分散） | 需先收拢写入 |
| 分页窗口 | 20 | 3 | 否（18 个不闭合） | 成本最高，最后做 |

**推荐做法**：先把「写入点」收拢到领域内部（例如把 `bindEvents` 里的滚动状态写入
改为调用领域导出的命名操作），再整簇搬走。这比直接搬函数更慢但不会破坏行为。

### 5.4 增量覆盖率门禁未纳入 CI

`coverage:new` 已可用并做过双向验证，但未加进 `npm run verify`——
它需要跑一整套带覆盖率的测试（约 90 秒），会让每次提交都变慢。

**建议**：只在 CI 与 pre-push 跑，不进 pre-commit。CI 加一步即可：
```yaml
- name: Gate 4 · 增量覆盖率（新增代码必须被执行）
  run: npm run coverage:new -- --base=origin/${{ github.base_ref }}
```

### 5.5 套件文件数下限无机器拦截

`SUITES.minFiles` 被调低只能靠人工 review 发现。可以考虑给
`test-targets.mjs` 的 `minFiles` 加内容指纹，但那会让"合法新增测试后调整下限"
变得很麻烦，收益不明显，暂不做。

---

## 六、命令速查

```bash
# 依赖（已修好，干净环境可用）
npm ci --ignore-scripts

# 完整验收（当前全绿）
npm run verify

# 门禁自证：证明每个门禁确实会红（12 个场景）
npm run gates:self-proof

# 单项
npm run gates             # 静态门禁
npm run gates:targets     # 套件枚举自检（不执行测试）
npm run gates:allow       # 豁免敞口预算
npm run gates:invariants  # 不变量映射表
npm run gates:ci          # CI workflow 可移植性（bash 语法 / 命令掩盖 / 构建前读产物）
npm run gates:workspace-links # workspace 链接三重校验（CI 第一步）
npm run gates:mutation    # 门禁引擎变异检验
npm run typecheck         # 含 mobile
npm test                  # census 包裹的单元测试
npm run verify:formal     # 46 项形式化不变量

# 覆盖率
npm run coverage:new -- --base=origin/dev/v0.1

# 不变量映射表：改 JSON 后重新生成视图
npm run invariants:render
```

---

## 七、本次踩过的新坑（不要再踩）

1. **`NODE_TEST_CONTEXT` 会被 `spawnSync` 继承**。子进程看到它后认为自己是测试子进程，
   直接执行文件而**不产出 TAP 汇总行**，导致 census 读到全 null。所有 spawn `node --test`
   的地方都必须先 `delete env.NODE_TEST_CONTEXT`。
2. **`git diff` 看不到未跟踪文件**。新增模块永远是未跟踪的，只靠 diff 会让增量覆盖率
   门禁对新增文件一律放行。必须额外用 `git ls-files --others` 按"整文件都是新增行"计入。
3. **覆盖率记录的是 dist 行号，diff 给的是 src 行号**。不反解 sourcemap 时两边永不重合，
   判定会静默变成"新增 0 行"从而永远通过。反解用 `@jridgewell/trace-mapping`（esbuild 自身依赖，不需新增）。
4. **`node -e` 里的顶层 `await` 在 CI 的 bash 下不可用**。写成独立脚本文件，不要内联。
5. **正则字符类 `[a-z-]` 不含数字**。`gate-i18n-allow` 的 `18` 让整条豁免漏计，
   实测表现为"新增豁免后预算仍是 7/7 余量 0"。已修正为 `[a-z0-9-]`。
6. **ASCII 与中文注释混合时，正则锚点容易失配**。抽取脚本应锚定结构（`const X =`）
   而不是注释文案。
7. **`tsc --build` 不清理已删源文件的产物**。删源码后必须清 `dist` 重建，否则旧产物
   会让守卫测试误报"源码没删干净"。
8. **源码守卫测试不要锁死函数名**。草稿持久化抽出后，
   `persistDraftsToStorage() >= 4` 的守卫立刻假红——它保护的是"各处都覆盖到草稿"，
   应该断言 `sessionDrafts.set/delete` 的分布，而不是某个内部函数被调几次。

9. **性能基准的"平均值"测的是机器有多忙，不是组件有多快**。
   同一份代码：单独运行 p95 = 13.8ms（20 次采样 0 次越界），
   在 `npm run verify` 链里 23~25.4ms（多次随机越界）。
   平均值把 GC 时间摊进每一步，样本落在噪声量级上，断言就变成抽奖。
   现在改为「每步取最小值 → 10 步中位数」+「单次硬上限」双判据：
   前者对真实退化敏感（退化会让最小值一起变慢）、不被 GC 尖峰污染，
   后者抓"最小值好看但出现一次 200ms 停顿"。
   敏感性已实证：注入 14ms 延迟（约 50% 退化）会被精确拦截。

10. **证伪器的 `expect` 必须校准到真实断言文案**。第一次跑 3/5 被判"原因不匹配"，
    实际是测试确实红了、但报的是另一条断言（我的 expect 猜错了文案）。
    另一条更值得注意：把 `resolved !== null` 直接抹掉会变成**语法错误**，
    exit != 0 但原因不是断言——证伪器正确地把它判为"无效"，
    改用语义等价替换 `resolved.length > 0` 后才算有效杀害。
    这正是"不能只看 exit code"的价值。

11. **CI workflow 本身是无守护的盲区**。本分支自己新增的 `Verify workspace links`
    步骤，一次带进两个必挂缺陷：`require.resolve('@hermes-flux/core')` 写在
    `npm run build` 之前（core 的 main 指向被 .gitignore 忽略的 dist/），
    以及内联 bash `for p in ...; do ... done` 在 windows runner 的 pwsh 下 ParserError。
    更刺眼的是**该步骤的注释已写明"不 require.resolve，用 require 判定会假红"，
    而代码恰是 require.resolve**——注释与实现自相矛盾，说明它从未被执行过。
    现已由 `gates:ci` 三条规则机器拦截（见第 8.3 节），并配 6 组双向自证样本。

12. **pwsh 的 step 结果取自最后一条命令的退出码**。多行 `run: |` 里先 `exit 1`
    再 `exit 0`，整步判定为**成功**。这比 CI 假红危险得多——假红吵闹但安全，
    假绿会把真缺陷放进主干。contract 三连因此从一条多行 run 拆成三个独立 step。
    这条是实测结论（`pwsh -File` 复现），不是推断。

13. **"给新门禁补自证"不能只补在本地脚本上**。`gates:ci` 的前一版解析器把
    step 缩进算错（`indentOf(group + 'x') - 1 === stepsIndent`），解析出 0 个 step，
    于是"全部通过"。若自证样本只断言 `failures.length === 0`，
    这个 bug 会完全隐形。因此每个用例必须同时断言**解析出的 step 数量**与命中的规则 id。

---

## 八、门禁自证套件：本次最重要的产物

`scripts/verify/gate-self-proof.mjs` 的 14 个场景，每个都同时给出
「应当失败」与「应当放行」两侧。**只断言"会红"的场景是不够的**——
一个见谁都报的坏实现也能全绿通过，那等于用另一个假测试去验证假测试。

当前 14 个场景：

```
census（5）
  ✔ 空 glob：exit=0 tests=0
  ✔ 目录改名：旧 glob exit=0/tests=0，新 glob tests=1
  ✔ 顶层 process.exit(0)：exit=0 fail=0 tests<=1
  ✔ 整文件 t.skip：exit=0 skipped=2
  ✔ 正常文件反向对照：tests=1 fail=0 skipped=0

targets（1）
  ✔ unit=154(min 149) ui根级=30(min 25) formal=10(min 10)

size（2）
  ✔ 等于上限放行、超一行阻断
  ✔ 已登记文件等于登记值放行、超一行阻断

test-integrity（1）
  ✔ c8 ignore=1 exit(0)=1 exit(1)=0

invariant-map（2）
  ✔ 映射表自身合格
  ✔ Markdown 与 JSON 一致

allow-budget（1）
  ✔ 敞口在预算内且 i18n 标签已计入

ci（2）
  ✔ 真实 workflow 21 个 step 零违规（bash 语法 / 命令掩盖 / 构建前读产物）
  ✔ 3 组样本双向判定正确（坏样本命中、好样本放行）
```

新增门禁时必须同步在此加场景。这是让"门禁不会腐化"的唯一低成本手段。
