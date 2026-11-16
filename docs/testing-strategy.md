# Hermes Flux 测试体系与门禁策略

> 本文是测试体系的**设计与判定手册**。
> 执行实现见 `scripts/gates/`、`scripts/verify/`、`.github/workflows/quality-gates.yml`；
> 架构门禁见 [`quality-gates.md`](quality-gates.md)；工程红线见 [`../ENGINEERING_DISCIPLINE.md`](../ENGINEERING_DISCIPLINE.md)。
> 不变量清单的单一真值源是 [`invariants.json`](invariants.json)。

---

## 零、结论先行

1. **测试的价值不是"证明代码对"，而是"改坏时立刻响"**。判定一个测试有没有用只有一条标准：把被测代码故意改坏，它会不会红。永远绿的测试价值为零，且占据了你以为有保护的位置。
2. **"跑过了"与"跑够了"是两件事**。退出码只能证明命令没报错，不能证明该跑的都跑了。本仓实测有四种手法让测试少跑却仍退出 0，因此必须有执行量统计层。
3. **新增代码 100% 覆盖执行，存量按棘轮只升不降**。存量里老代码覆盖率很低，立刻要求全局 80% 只会逼出假测试；而新增代码是唯一能要求"零妥协"的边界。
4. **工具无法自动覆盖新功能**，只能证明已有实现的正确性。因此规则是：新增逻辑必须同时交付测试、不变量映射、覆盖率证据，三者缺一，机器不放行。
5. **文件规模是可维护性的硬约束**。单文件超过 1500 行后，修改任何一处都要重新校准全局。本仓已把它变成机器判定的红线，而非自觉。

---

## 一、为什么这样设计（原理）

### 1.1 五类手段各自的盲区

没有任何单一手段能保证质量。它们抓的是不同的东西：

| 手段 | 能抓 | 抓不到 |
|---|---|---|
| 单元测试 | 已知输入下的行为 | 你没想到的输入 |
| 覆盖率 | 哪些代码**从没执行** | 执行了但**没断言** |
| 变异测试 | 断言有没有**杀伤力** | 功能**根本不存在** |
| 属性测试（fast-check） | 不变量在**任意输入**下是否成立 | 不变量**本身写错** |
| 执行量统计 | 该跑的**是否真的跑了** | 跑了但断言无效 |
| 人工审查 | 需求对不对、设计合不合理 | 大规模遗漏（看不过来 1 万行） |

### 1.2 为什么必须"新增 100%"

全局覆盖率是个被平均值污染的数字：

- 老代码拉低均值，让好代码看起来更差；
- 新代码藏在高均值里，没人知道它其实是裸的；
- 追求提高全局数字的最省力路径是**补老代码的简单测试**，而不是测新功能。

只盯增量，才能让每次提交对自己的质量负责。

### 1.3 为什么变异测试不可替代

覆盖率问"这行跑了吗"，变异问问"改坏了会红吗"。前者是必要条件，后者才是充分条件。

本项目已有 `scripts/gates/mutation-check.mjs`（5 个变异点）。它的历史缺陷是**锚点匹配不上时打印警告后 `continue`**，等于静默归零。现已改为：锚点命中次数必须恰好为 1，否则 throw；且施加数与登记数不等也判失败。

---

## 二、现状事实（实测基线）

以下数据全部由实测得出，可作为棘轮初始值与复测基准。**标注「实测定稿」的条目已在本分支修正过原文档的错误结论。**

### 2.1 门禁覆盖缺口（已修）

| 项 | 修正前 | 现状 |
|---|---|---|
| CI 触发分支 | 仅 `main`（开发在 `dev/v0.1`，等于零门禁） | `main` / `dev/**` / `feat/**` |
| CI 未执行 | `verify:formal`、contract 三连、`gates:allow` | 已全部纳入 |
| pre-commit | 7 项 | 9 项（补不变量映射表、豁免预算） |
| CI 自身缺陷 | workflow 无任何静态守护，坏步骤只能靠"推上去看红"发现 | `gates:ci` 三条规则 + 6 组双向自证样本，见 8.3 |

### 2.2 四类"假绿"手法（实测定稿）

**这一节推翻了原文档的三个结论，请以实测为准。**

| 手法 | 实测结果 | 能否被统计层拦下 |
|---|---|---|
| 空 glob（`node --test "empty/**/*.test.mjs"`） | exit=0，tests=0 | **能** |
| 目录改名导致旧 glob 失效 | exit=0，tests=0 | **能** |
| 顶层 `process.exit(0)` | exit=0，tests=1，**pass=1** | **能**（tests 与 files 不成比例） |
| `uncaughtException` 内 `process.exit(0)` | exit=0，tests=1，pass=1 | **能** |
| 断言后置 `process.exit(0)`（原文记载的手法） | **exit=1，fail=1** | 不必拦，Node 24 已防住 |
| 整文件 `t.skip()` | exit=0，pass=0，skipped=N | **能**（计入跳过上限） |

**结论修正**：原文档称「`process.exit(0)` 能伪造全绿」，实测该结论只在**顶层**（测试注册前）或**异常钩子内**成立；常规位置 Node 24 的 test runner 已能正确报告失败。真正需要防的是前两类与整文件 skip。

### 2.3 覆盖率基线（实测定稿）

> 以下为改动前实测，用于说明"同一份代码的数字取决于运行范围"。

| 范围 | 语句 | 分支 | 函数 |
|---|---|---|---|
| 全量单测 | 91.25% | 81.54% | 81.64% |
| `verify:formal` 单独 | 64.48% | 74.55% | 19.95% |
| 单文件 `cache-merge.test.mjs` | 52.08% | 69.62% | 3.09% |

函数覆盖率说明：全量分母为 **1182** 个函数，未调用 **217** 个（18.4%）。原文档写的「476 个函数、约 1/4 未调用」中的 476 是 **formal 套件的分母**，不是全量。

**读法**：同一份代码覆盖率可以是 3% 也可以是 91%，差别只在"跑了哪些测试"。因此任何覆盖率数字必须与运行范围绑定声明，否则无意义。

### 2.4 已修复的假测试（实测定稿）

| 文件 | 机制 | 修复方式 | 证伪验证 |
|---|---|---|---|
| `desktop/__tests__/unit/cache-integration-wiring.test.mjs` | 测试内**重写** `filterDurableOrderKey` / `safeParseJson` 再断言副本 | 逻辑抽成 `renderer/persistence/persistedJson.ts`，测试导入构建产物 | 删掉守卫的 `validate` 分支 → 测试报「带守卫时必须回落」 |
| `core/__tests__/rpc/live-gateway-real.test.mjs` | `assert.ok(true)` + 只断言 `err.message` 非空 | 用可控桥接断言方法名、入参契约、返回值解析 | 删掉解析逻辑 → 状态/进度断言失败 |
| `ui/__tests__/settings-modal.test.mjs` | 组件与测试同调 `t()`，缺 key 时两侧同时退化成字面量 | 改为硬编码中英文锚点 + 断言不得出现未翻译 key | 删掉字典 `settings.presenceTitle` → 测试报「必须渲染「Agent 状态」段」 |

---

## 三、六层门禁架构

```
L0 静态门禁      gates / typecheck / contract                          规则符合性
L0' CI 自守护    gates:ci（workflow 可移植性）/ gates:workspace-links    裁决层自身可信
L1 执行量自证    census（文件数/用例数/失败/跳过）                        证明真的跑了
L2 单元与集成    npm test（node:test）                                   行为正确性
L3 不变量        verify:formal（fast-check）+ invariant-map              性质恒成立
L4 覆盖率        node --experimental-test-coverage + 增量判定             执行完整性
L5 有效性        变异测试（gates:mutation + 锚点唯一性）                   断言杀伤力
L6 真实渲染      CDP / Playwright                                        接线与视觉
```

L0' 是后补的一层：前六层都在管**被测代码**是否符合规则，却没有一层管**裁决者本身**
（CI workflow）是否配得对。三次真实事故证明这个盲区会稳定产出假红与假绿，见 8.3。

**分层原则**：便宜的先跑。L0/L1 亚秒到分钟级，L5/L6 分钟级。

---

## 四、核心机制一：执行量统计层（L1）

### 4.1 判定原理

一条断言同时堵住四类假绿：从 TAP 汇总行读取 `{tests, pass, fail, cancelled, skipped, todo}`，然后断言：

```
文件数 >= 登记下限
tests > 0
tests >= 文件数（每文件至少注册一个用例）
fail === 0 && cancelled === 0
skipped <= 登记上限
```

### 4.2 为什么"文件数下限"必须显式登记

`SUITES.minFiles` 是每个套件的文件数下限，登记在 `scripts/gates/lib/test-targets.mjs`。它拦的是"glob 写错 / 目录改名 / 文件被误删"——这三种情况下 `node --test` 都会安静地跑更少文件并退出 0。

**下限只允许调高。** 调低必须在提交信息里给出理由。

### 4.3 为什么由 Node 枚举而不是 shell glob

原实现写的是裸 glob：

```bash
node --test packages/ui/__tests__/**/*.test.mjs
```

不带引号时由 shell 展开。**bash 默认关闭 globstar，`**` 退化为 `*`，只能命中一层子目录**，于是 `packages/ui/__tests__` 根级 30 个文件在 ubuntu 上整套不跑，而退出码仍为 0。

现在 `listSuiteFiles()` 用 Node 自己递归枚举，跨平台一致；CI 还有一个 `gates:targets` 前置步骤，在执行任何测试前先断言枚举结果（含「`packages/ui/__tests__` 根级文件数 ≥ 25」这条 globstar 退化信号）。

### 4.4 已知环境陷阱

`NODE_TEST_CONTEXT` 会被 `spawnSync` 继承。census 自身若在 node:test 里被调起，子进程看到该变量后认为自己已是测试子进程，直接执行文件而**不产出 TAP 汇总行**，导致断言读到全 null。所有 spawn `node --test` 的地方都必须先 `delete env.NODE_TEST_CONTEXT`。

---

## 五、核心机制二：新增代码 100% 覆盖（L4）

### 5.1 判定原理

```
A. 新增行号集   git diff -U0 <base> ∪ 未跟踪文件整文件
B. 覆盖行数据   node --experimental-test-coverage → lcov → sourcemap 反解回 src 行
C. 判定         A ∩ B 中任何 hits === 0 的行 → FAIL
```

### 5.2 两个必须反解的地方（否则判定静默失效）

1. **dist 行 → src 行**：覆盖率记录的是构建产物 `dist/*.mjs` 的行号，而 `git diff` 给的是 `src/*.ts`。不反解 sourcemap 时两边永不重合，判定会变成"新增 0 行"从而永远通过。反解用 esbuild 自身的 `@jridgewell/trace-mapping`，不新增依赖。
2. **未跟踪文件**：`git diff` 完全看不到未跟踪文件，而新增模块永远是未跟踪的。只靠 diff 会让门禁对新增文件一律放行（实测确认）。必须按"整文件都是新增行"计入。

### 5.3 两种失败必须区分

| 情况 | 含义 | 修复动作 |
|---|---|---|
| 没有构建产物 | 模块未登记进 esbuild 入口清单 | 改 `packages/desktop/scripts/build.mjs` |
| 有产物但无测试 import | 缺测试 | 补测试 |

混在一起会把"没构建"误报成"缺测试"，让人补了测试仍然红。

### 5.4 豁免与计数

- 注释、空行、纯 `import type`、接口字段行不计入分母。
- `/* c8 ignore */` 会被 `test-integrity` 规则判定为违规——它让新增行根本不进 lcov，直接使 `hits===0` 判据失效。
- `scripts/verify|gates|contract|probe/` 不参与判定：它们是人工运行的门禁工具，其可信度靠"判定必须能被证伪"保证，而非行覆盖。

---

## 六、核心机制三：不变量映射（L3）

### 6.1 为什么从 Markdown 改成 JSON

旧版 `docs/invariants.md` 是手写表格，有三个结构性缺陷使机器校验不可能：

1. **编号撞号**：`older-pagination-formal` 与 `provider-attach-flow-formal` 都自称「定理 30~34」，同号异义；
2. **区间写法**：`INV-12~16` 在文本上是一个 token，做不了差集；
3. **7 处「同上」**：多条不变量共用一个路径，无法判断某一条是否真被守护；
4. **无源码锚点**：没有「被测源码路径 + 符号名」，"新增逻辑减去已登记项"在数学上不可计算。

现状：单一真值源是 `docs/invariants.json`，`docs/invariants.md` 由 `--render` 生成，禁止手改。

### 6.2 校验规则

| 规则 | 判定 |
|---|---|
| `id` 唯一且匹配 `INV-<AREA>-<NN>` | 违者 FAIL |
| `test` 为单一真实路径 | 违者 FAIL |
| `test` 文件内含 `fc.assert` | 违者 FAIL |
| `source` 为真实源码路径 | 违者 FAIL |
| `source`+`symbol` 组合唯一 | 违者 FAIL（同一符号承载多条性质时用 `sym#aspect` 消歧） |
| Markdown 与 JSON 一致 | `--check` 违者 FAIL |

### 6.3 尚未覆盖的领域（刻意登记为空）

`core/src/queue/`、`core/src/group/`、`core/src/subagent/` 当前没有任何形式化不变量。新增这些领域的可判定逻辑时应先补映射。

---

## 七、核心机制四：可维护性红线（L0）

### 7.1 单文件行数上限

硬上限 **1500 行**（按物理行计）。存量超限文件登记在 `scripts/gates/rules/maintainability.mjs` 的 `KNOWN_OVERSIZE`，**只允许调低**。文件涨过登记值即阻断，逼出"继续拆"而不是"再放宽一次"。

拆解进展：`packages/desktop/src/renderer/index.ts` 12071 → 11926 行（输入补全领域 + 持久化解析已抽出）。

### 7.2 行内豁免敞口

`gate-*-allow` 是对门禁的合法例外，但它是"让门禁变绿"的最短路径。逐行判成违规会误伤合法豁免，因此改为**总量度量**：`scripts/gates/allow-budget.mjs` 统计仓库全部豁免注释，超过 `BUDGET` 即失败。当前实测 7 条，预算 7（不留余量，留余量等于预授权新增）。

只统计真正的注释行：文档块（行首 `*`）里的写法示例与字符串字面量里的诊断文案都不是豁免申请。

### 7.3 测试完整性规则

| 规则 | 理由 |
|---|---|
| 禁止 `c8 ignore` 注释 | 让新增行不进 lcov，直接使增量覆盖判据失效 |
| 禁止测试文件里的强制成功退出 | 顶层 `exit(0)` 与异常钩子内的 `exit(0)` 能把真实失败吞成 exit=0/pass=1（实测） |
| 豁免注释进 `allow-budget` 总量 | 见 7.2 |

---

## 八、CI 编排

### 8.1 触发器

```yaml
on:
  push:
    branches: [main, 'dev/**', 'feat/**']
  pull_request:
    branches: [main, 'dev/**']
```

### 8.2 作业顺序

| 步骤 | 内容 | 为何在这个位置 |
|---|---|---|
| 安装 | `npm ci --ignore-scripts` | 装不上时后续全是空跑 |
| `gates:workspace-links` | 4 个链接的实体 + 包名 + realpath 三重校验 | 必须在任何门禁之前，且**不能** require 产物（产物要等 `build`） |
| `gates:ci` | workflow 自身的可移植性静态检查 | 改 workflow 时当场拦住跨平台缺陷，见 8.4 |
| `gates:targets` | 枚举自检（不执行测试） | 把"枚举少了"与"跑失败了"分开定位 |
| `gates` | 静态门禁 | 最便宜 |
| `typecheck` | 含 mobile（此前从未被检查） | |
| `npm test` | census 包裹的执行量自证 | |
| `gates:mutation` | 锚点唯一性 + 5 个变异点 | 防止门禁退化成空壳 |
| `gates:allow` / `gates:invariants` | 豁免预算 + 不变量映射 | |
| `verify:formal` | 46 项形式化不变量 | |
| contract 三连 | 契约一致性与文档同步 | **必须拆成三个独立 step**，见 8.4 |
| `build` | 全量构建 | 放最后，前面都过了才值得付构建成本 |

### 8.3 跨平台 shell 语义（三次真实事故，已由 `gates:ci` 机器拦截）

矩阵跑 `ubuntu-latest + windows-latest`，但两者承载脚本的 shell 不同：ubuntu 是 bash，**windows 是 pwsh**。以下三类缺陷都不会在本地暴露，且红的原因与被测代码无关。

| # | 缺陷 | 实测表现 | 机器判定 |
|---|---|---|---|
| P-01 | 构建前 `require.resolve('@hermes-flux/*')` | core 的 `main` 指向被 `.gitignore` 忽略的 `dist/index.js`，两平台稳定 `MODULE_NOT_FOUND` | `ci/no-prebuild-artifact-read` |
| P-02 | 多行 `run: \|` 内联 bash `for ... do` | windows runner 直接 `ParserError: The term 'for' is not recognized` | `ci/no-bash-only-syntax` |
| P-03 | 多行 `run: \|` 连写多条命令 | pwsh 的 step 结果取自**最后一条**原生命令退出码，前面失败被后面成功掩盖（实测：先 `exit 1` 再 `exit 0`，整步判定为**成功**） | `ci/no-masked-command` |

P-03 是三者中最危险的：P-01/P-02 造成假**红**（吵闹但安全），P-03 造成假**绿**。

**约束**：跨平台逻辑一律落在 Node 脚本里（`scripts/gates/verify-*.mjs`），CI 只负责调用；确需内联多行命令时必须显式 `shell: bash` 并首行 `set -e`，或拆成独立 step。

### 8.4 CDP / GUI 测试的现状与风险

12 个 CDP 文件全部硬编码 Windows Edge 路径，找不到浏览器时 `t.skip()`。在 ubuntu runner 上这会变成"全绿但零执行"。

**当前状态：这些测试未纳入 CI**（`test:cdp` 不在 workflow 中），因此风险是"未来把它们纳入 CI 时会假绿"，而非当下假绿。纳入前必须先做两件事：统一浏览器路径解析（找不到时失败而非跳过）、把 skipped 纳入 census 上限。

---

## 九、禁止事项（机器可查）

| # | 规则 | 判定方式 | 状态 |
|---|---|---|---|
| 1 | 不允许新增 `c8 ignore` | `test-integrity/c8-ignore` 静态规则 | 已实现 |
| 2 | 不允许测试内强制成功退出 | `test-integrity/test-exit` 静态规则 | 已实现 |
| 3 | 豁免注释总量只降不升 | `gates:allow` 总量预算 | 已实现 |
| 4 | 不允许单文件涨过登记上限 | `size/oversize-grown` 静态规则 | 已实现 |
| 5 | 不允许下调套件文件数下限 | `SUITES.minFiles` 需人工改且需理由 | 部分（无机器拦截） |
| 6 | 不允许删除 formal 测试文件 | 建议由 census 的 `formal.minFiles` 兜住 | 已实现（下限 10） |
| 7 | CI workflow 不得含 bash 专有语法 | `ci/no-bash-only-syntax`（`gates:ci`） | 已实现 |
| 8 | CI workflow 多行 run 不得连写多条命令 | `ci/no-masked-command`（`gates:ci`） | 已实现 |
| 9 | CI workflow 构建前不得读取产物 | `ci/no-prebuild-artifact-read`（`gates:ci`） | 已实现 |

---

## 十、认知边界（必须承认）

1. **100% 覆盖率 ≠ 0 缺陷**。覆盖率只证明执行，不证明断言有效。
2. **没有工具能证明"补全了"**。只能量化"缺口多大"与"缺口是否在缩小"。
3. **度量体系防退化，防不了需求本身错**。需求对不对只能人判断。
4. **"漏了"在数学上不可判定**。只能靠多层网把概率与代价压到可接受，最后必须留生产验证与人判断。
5. **统计层拦不住"写好但错"的测试**。它能拦住"没跑"，拦不住"跑了但断言恒真"——后者只有变异测试能抓。

任何声称"已全量覆盖、无遗漏"的报告都不成立。可信的报告形态是：**列出覆盖了什么、豁免了什么、哪些没试**——未验证项显式化，比任何覆盖率数字都诚实。

---

## 十一、变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-13 | 初版。基于实测建立四层门禁架构，记录现状基线与假测试三处实证 |
| 2026-11-14 | **实测修正版**：① 四类假绿手法按实测重写（推翻「`process.exit(0)` 能伪造全绿」的绝对结论）；② 覆盖率基线改为 91.25/81.54/81.64，函数分母改为 1182/217；③ Stryker 结论改为 npm 可装、版本 10.1.1、必须配 `buildCommand`；④ 不变量映射改为 JSON 单一真值源 + 九条校验规则；⑤ 新增执行量统计层、增量覆盖率门禁、文件行数上限、豁免敞口预算四套机制；⑥ 三处假测试已修并逐一做过证伪验证 |
