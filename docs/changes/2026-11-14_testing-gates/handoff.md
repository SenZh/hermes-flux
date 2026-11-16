# 交接文档：测试门禁体系改造（2026-11-14）

> 目标读者：接手本工作的下一个 session。
> 读完本文应能：知道已经改了什么、哪些结论是实测的、下一步做什么、以及哪些坑已经踩过。

---

## 一、原始需求（用户目标，不要跑偏）

用户要建一套**自动化 loop 流水线**：给 Agent 下需求，Agent 逐层执行编码 / 审查 / 测试 / 验证，最后提 PR。但讨论后发现更前置的问题是：**怎么知道 Agent 写的东西真能满足需求、真能通过校验**。

由此收敛出四个真实诉求：

1. **CI 要真的跑起来**（当时门禁只监听 `main`，而开发在 `dev/v0.1`，等于没门禁）。
2. **新增代码必须 100% 覆盖**，存量走棘轮慢慢补。
3. **变异测试要做**（Stryker），因为覆盖率证明不了断言有没有杀伤力。
4. **新增逻辑必须被感知**并强制配套不变量测试。

以及最新追加的一条：

5. **`renderer/index.ts` 要拆解**，拆之前先建门禁与测试，要求**这个文件覆盖率达到 100%，重构后仍然 100%**。

---

## 二、已完成：依赖修复（已落盘，未提交）

这是整个方案的前置阻断项。原本 CI **从未成功装过依赖**。

### 根因

3 处 `workspace:*` 协议，npm 完全不认：

```
packages/desktop/package.json   @hermes-flux/core: workspace:*
packages/desktop/package.json   @hermes-flux/ui:   workspace:*
packages/ui/package.json        @hermes-flux/core: workspace:*
```

原 CI 写的是 `npm install --ignore-scripts || npm install --legacy-peer-deps`。`||` 右侧对**同一根因**无效，两条分支都报 `EUNSUPPORTEDPROTOCOL`。这是典型的「假兜底」。

### 改动

| 文件 | 改动 |
|---|---|
| `packages/desktop/package.json` | 2 处 `workspace:*` → `*` |
| `packages/ui/package.json` | 1 处 `workspace:*` → `*` |
| `package-lock.json` | 重建。312 → 568 包，补齐 4 个 workspace 条目与 `link: true` |
| `.github/workflows/quality-gates.yml` | `npm install \|\| ...` → `npm ci`，新增 workspace 链接校验步骤 |
| `.gitignore` | 恢复 `bun.lock` 忽略（并加注释说明双锁必漂移），新增 `.stryker-tmp/`、`reports/`、`stryker-output-*.json` |

改后 npm 会生成 file link：

```
node_modules/@hermes-flux/core    => packages/core    LINK
node_modules/@hermes-flux/ui      => packages/ui      LINK
node_modules/@hermes-flux/desktop => packages/desktop LINK
node_modules/@hermes-flux/mobile  => packages/mobile  LINK
```

### 验证结果（全部实测）

| 命令 | 结果 |
|---|---|
| `npm ci --dry-run` | exit 0 |
| `npm install --dry-run` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run gates` | exit 0，无新增违规 |
| `npm run verify:formal` | 46/46 通过 |
| `npm run gates:mutation` | 5/5 变异体全杀 |
| `npm test` | 1968 用例，1965 通过，0 失败 |
| `npm run verify` | **exit 0，全绿** |

### 顺手发现的一个真问题（尚未修）

`tsc --build` 增量编译**不删除已删除源文件的产物**。拉取 BOT 代码后 `AgentProfileEditorModal.ts` 已删，但 `packages/ui/dist/components/Bot/AgentProfileEditorModal.js` 还在，导致 `p0-p1-features.test.mjs` 报「旧内联编辑器产物必须彻底删除」。

- CI 上不触发（干净环境无历史产物）。
- 本地反复遇到，报错信息指向「源码没删干净」，极易误导。
- 临时解法：删 `dist` 重建。**根治建议**：`build` 前置 clean，或用 `tsc --build --clean`。

---

## 三、已完成：两份文档（已落盘，未提交）

| 文件 | 内容 | 状态 |
|---|---|---|
| `docs/testing-strategy.md` | 四层门禁架构、覆盖率机制、变异测试、不变量拦截、CI 编排、禁止事项、落地顺序 | **已知含错误事实，见第五节，需修订** |
| `docs/invariants.md` | 不变量映射表，10 个 formal 文件全部登记 | **格式不可机器解析，需重构，见第五节** |
| `scripts/probe/risk-rank.mjs` | 只读风险排序探针（git churn + 体积 + 依赖数 + 测试引用数） | 可用，保留 |

`AGENTS.md` 索引已加这两份文档（注意：期间因反复 pull 曾出现增删抖动，确认当前已包含）。

---

## 四、已完成的调研结论（实测，可直接引用）

### 4.1 审查发现的五个阻断级问题（已亲自复现）

| # | 事实 | 我的验证方式 |
|---|---|---|
| 1 | CI 装不上依赖 | 复制根 manifest + 4 个 workspace 到临时目录，`npm install --dry-run` 报 `EUNSUPPORTEDPROTOCOL` |
| 2 | **ubuntu 上静默漏跑 30 个测试文件 / 416 用例** | `packages/ui/__tests__` 有 30 个根级文件 + 10 个子目录文件；bash `globstar off` 时 `**` 退化为 `*`，只命中子目录 |
| 3 | `packages/mobile/src` 逃出门禁 | `scripts/gates/run.mjs` 的 `SCAN_ROOTS` 只有 4 项，无 mobile；该包实有 15 处 `as any` |
| 4 | `process.exit(0)` 能伪造全绿 | 写 `assert.equal(1,2)` + `process.exit(0)`，实跑 `pass 1 / fail 0 / EXIT=0` |
| 5 | 2 个 e2e 无执行入口 | 只有 `test:e2e:left-rail`；`session-subtitles-live-cdp`、`settings-center-live-cdp` 不在任何 script |

第 2 条最危险：不报错、不变红，覆盖率数字还好看。**修法**：给 4 个 glob 加引号让 node 自解，或改用 `node --test` 的目录枚举。

### 4.2 红队结论：现有方案只能拦住 2/10 条绕过路径

实测成立的绕过路径：

- **`/* c8 ignore next */`**：新增行根本不进 lcov，`hits===0 → FAIL` 直接失效。比文档里的 `coverage-exempt` 更省事。
- **`.tsx` 整类豁免**：`git diff -- '*.ts'` 不匹配 `.tsx`。实测同一区间 `.ts` 命中 60、`.tsx` 命中 19，交集 0。
- **`fc.constant(1)` + 空断言**：满足「条目存在 + 文件存在 + 含 `fc.assert`」三重校验，但什么都没测。
- **`npm run gates:freeze`**：一条命令吸收全部新增违规，而规则只约束覆盖率基线，管不到 `scripts/gates/.baseline.json`。
- **超时伪装成 killed**：Stryker 把 timeout 计为 killed，加一个慢测试就能刷高分。
- **空 glob**：`node --test "empty/**"` 退出 0。

### 4.3 已存在的假测试（不在原文档里，红队找到）

- `packages/core/__tests__/formal/session-lifecycle-formal.test.mjs:48-62`：`snapshotIds` 是随机字符串数组，永远不可能等于固定串 `'deleted-target'`，`filter` 是恒等操作，断言恒真。**这是 INV-34「防复活墓碑」的唯一守护**，实际只测了一个三行函数。
- `packages/core/__tests__/formal/older-pagination-formal.test.mjs:73`：`covered >= 0 && covered <= messages.length` 是计数器的定义恒等式，删掉血缘过滤逻辑它依然绿。

原文档已记录的三个（含我亲手验证的）：

- `packages/desktop/__tests__/unit/cache-integration-wiring.test.mjs:139-165`：测试内重写 `safeParseJson` 再断言副本。**我实测：删掉生产代码 `renderer/index.ts:991` 的 `validate(parsed)` 类型守卫，该文件仍 12/12 全绿。**
- `packages/core/__tests__/rpc/live-gateway-real.test.mjs:302,304`：`assert.ok(true)` + 只查 `err.message`。
- `packages/ui/__tests__/settings-modal.test.mjs:593,596`：组件与测试同调 `t()`，缺 key 时两侧同时退化成字面量。

### 4.4 Stryker 实测（推翻「装不上」的旧结论）

| 项 | 结论 |
|---|---|
| 包管理器 | 我最初误判为「必须用 bun」。**实际结论：用 npm 就能装**，只要把 `workspace:*` 改成 `*`。bun 只是当时绕过问题的手段 |
| 版本 | 实测装成 10.1.1（文档写 9.0.1 是错的） |
| 适配器 | `@stryker-mutator/tap-runner` 是 `node:test` 的原生适配器，**只到文件粒度**，`perTest` 实际等于 per-file |
| 性能 | toy 文件 9 变异体 2 秒；真实 `cacheMerge.ts` 是 **217 变异体 / 12-28 秒**；全量 core 是 **15014 变异体** |
| **关键缺口** | 测试加载 `dist/*.js`，`mutate` 指向 `src/*.ts`，**必须在配置里加 `buildCommand`**，否则变异体全部 `no-cov`、得分恒 0，而 `break: null` 会让 0 分也返回成功 |
| 其他坑 | tap-runner 会在工作区根写 `stryker-output-<pid>.json`（已加 gitignore）；Stryker 沙箱会复制 `packages/desktop/release/`（672MB），需配 `ignorePatterns` |

### 4.5 覆盖率实测数字（可作棘轮初始值）

| 范围 | 语句 | 分支 | 函数 | 备注 |
|---|---|---|---|---|
| 全量单测 | 91.25 | 81.54 | 81.64 | **文档原写 85.84/81.79/73.56 是错的** |
| 函数总数 | 1182 个，未调用 217（18.4%） | | | 文档误把 formal 的 476 当全量 |
| `verify:formal` 单独 | 64.48 | 74.55 | 19.95 | 复测吻合 |
| 单文件 `cache-merge.test.mjs` | 52.08 | 69.62 | 3.09 | 复测吻合 |

技术坑：

- c8 **绝不能排除 `**/dist/**`**（那是被测对象，排掉后 lcov 为 0 但测试仍 pass）。
- c8 通过 sourcemap 映射回 TS 时，`BRF === 0` 的文件会把 `0/0` 渲染成 `100%` 分支覆盖，这是除零语义而非映射失真。
- lcov 的 `SF:` 路径相对 **cwd**，必须在仓库根执行。
- 行覆盖的 `DA` 分母含注释与空行（约 28%），跨工具比较口径不同。

---

## 五、`docs/testing-strategy.md` 的已知错误（必须修订）

审查确认的事实错误，修订时逐条改：

| 位置 | 原文 | 实际 |
|---|---|---|
| 2.3 | 全量覆盖率 85.84/81.79/73.56 | 91.25/81.54/81.64 |
| 2.3 | 「476 个函数，约 1/4 未调用」 | 476 是 formal 的分母；全量 1182/965，未调用 217 = 18.4% |
| 2.1 | 「CI 实际执行 6 step」（作为现状事实） | 那 6 个 step **从未成功执行过**，因为依赖装不上 |
| 2.2 | 「ubuntu 上 skip → 全绿零执行」 | 当时 CI 根本不跑 `test:cdp`，是未来风险而非现状 |
| 2.2 | `t.skip(` 计数 22 | 三种口径：CDP 目录 19 / desktop 全目录 23 / 全仓 27 |
| 4.1 | `git diff -- '*.ts'` | 漏 `.tsx`、`.mjs`、`.css` |
| 6.1 | Stryker 9.0.1、9 变异体 2 秒 | 10.1.1；真实文件 217 变异体 |
| 6.2 | 配置无 `buildCommand` | **必须加**，否则得分恒 0 |
| 6.4 | 阈值「直到 covered 70%」 | `break` 比的是 total 不是 covered，该表述会导致永远追不上 |
| 5.3 | 「10 个文件覆盖 5 个领域」 | 实际 ≥8 个领域 |
| 5.3 | 「这三个包」 | 待补清单有六个包 |
| 第十章 | 「必须用 bun」 | 已推翻，npm 可用 |

`docs/invariants.md` 的结构性问题：

- **编号撞号**：`INV-31` 与 `INV-31b`、`INV-32~34` 与 `32b~34b`；且 `older-pagination-formal` 内部自称「定理 30~34」，与 provider 的同号异义。
- **区间写法不可解析**：`INV-12~16`、`INV-08~11` 在文本上是一个 token，探针做不了差集。
- **7 处 `同上`**：`INV-22~29` 全部指向同一文件。
- **缺源码锚点列**：没有「被测源码路径 + 符号名」，导致「新增逻辑减去已登记项」的差集在数学上不可计算。
- **三条事实错误**：`INV-34b` 语义完全不符；`INV-01~04` 声称 hidden 断言但文件里无 `hidden`；`INV-18~21` 守护的代码在 `ui/src/components-react/leftRailModel.ts`，不在 `core/agent/`。
- **扫描目录三处口径不一致**：文档写 5 个、数据文件写 8 个、都不含 `models/`。

**建议**：改成 `docs/invariants.json`，schema 化，禁区间、禁同上，每条加 `anchor`（源码符号）与 `test`（单一路径）字段，Markdown 由 JSON 生成。

---

## 六、当前阻塞点：`renderer/index.ts` 的 100% 覆盖

这是用户最新、最硬的要求。**目前无法达成，原因是测量手段缺失，不是测试写得少。**

### 现状事实

| 项 | 数值 |
|---|---|
| 行数 | 12070 |
| 函数 | 218 |
| `document.` | 211 处 |
| `window.` | 48 处 |
| `localStorage` | 95 处 |
| `indexedDB` | 3 处 |
| `addEventListener` | 26 处 |
| 引用它的测试 | 19 个文件，但**全部是 `readFileSync` + 正则断言源码**，不执行它 |

### 为什么测不到

`index.ts` 经 esbuild 打包成 `dist/renderer/index.js`（5.8MB，含 sourcemap）后在**浏览器**里执行。c8 基于 V8 覆盖率，只覆盖 Node 进程，**完全看不到它**。

### 已验证可行的技术路径

1. **CDP `Profiler.startPreciseCoverage`** 能采到 `index.js` 的精确覆盖（我已验证 `Profiler.enable` / `startPreciseCoverage` 均返回成功，`/json` 能找到 page target）。
   - 探测脚本：`%TEMP%\cdp-steps.mjs`（工作正常）
   - 更完整但卡住的版本：`%TEMP%\cdp-cov-probe2.mjs`
   - **卡住原因未定位**：单独跑 `Profiler.*` 三个命令成功，但加了 `Page.navigate` 后进程不退出。怀疑是 Edge 内部页（`edge://sync-confirmation-dialog/`）被选为 target，或 `Page.navigate` 后的等待逻辑有死锁。
   - 修法建议：用 `--headless=new` 时显式 `Target.createTarget` 建新页，或从 `/json` 里按 `url === 'about:blank'` 精确选目标。

2. **esbuild 插桩 + istanbul**：`babel-plugin-istanbul` / `nyc` / `istanbul-lib-instrument` **当前都未安装**，需要新增依赖。这是更稳的路，但改动大。

3. **源 map 反解**：CDP 精准覆盖给的是 `index.js` 的 byte offset，需要结合 `index.js.map` 的 `mappings` 反解回 `index.ts` 行号。**这一步必须有**，否则拿不到「index.ts 的覆盖率」这个用户要的数字。

`index.js.map` 结构已确认：`sources` 413 项，含 `'../../src/renderer/index.ts'`，且 `sourcesContent: true`。

### 建议的推进顺序

1. 先打通 CDP 覆盖采集最小闭环（目标：能打印 `index.js` 的 byte 覆盖率）。
2. 加 sourcemap 反解，输出 `index.ts` 的行覆盖。
3. 把采集挂到现有 CDP 测试上跑（现有 12 个 CDP 文件已经在驱动真实页面）。
4. 拿到基线数字，再谈「拆文件前先补到 100%」。

**必须先承认的现实**：12070 行、211 处 DOM 操作，做到 100% 分支覆盖，靠现有 CDP 测试补全，工作量可能是数周。建议先和用户确认：是「行覆盖 100%」还是「分支覆盖 100%」，两者难度差一个量级。

---

## 七、下一步任务清单（按依赖排序）

### P0 · 立即做

1. **提交已验证的依赖修复**（第二节）。当前工作区干净可提交，`npm run verify` 已全绿。
2. **修 ubuntu glob 漏跑**（4.1 第 2 条）：给 `package.json` 的 4 个 glob 加引号，让 node 自解。验收：ubuntu 与 windows 的 `tests` 计数相等。
3. **建「执行量统计层」**：这是投入产出比最高的一条，一条断言堵四条绕过路径。
   - `node --test --test-reporter json` 输出 `{files, tests, pass, failed, skipped}`。
   - 断言 `files >= 156 && tests >= 1900 && skipped == 0 && failed == 0`。
   - 能同时拦住 `process.exit(0)`、空 glob、目录改名、孤儿文件。
   - 放在 `scripts/verify/all.mjs`，作为 CI 与 pre-commit 的唯一入口。

### P1 · 门禁加固

4. **`SCAN_ROOTS` 补 `packages/mobile/src`**（4.1 第 3 条），跑一次 `--update-baseline` 把 15 处 `as any` 冻结为存量。
5. **加禁止性指令静态规则**：`/* c8 ignore */`、`__tests__/**/process.exit(`、`gate-*-allow` 计数进基线且只降不升。
6. **修 3 处已知假测试**（4.3 前三处）。验收：删 `renderer/index.ts:991` 守卫后测试**必须红**（当前 12/12 绿）。
7. **修 `gates:mutation` 锚点失配**：`scripts/gates/mutation-check.mjs:55-58` 现在是打印警告后 `continue`，改成 `throw`，并断言 `count === 1`（避免锚点变成 2 处时静默错位）。
8. **CI 加 `dev/**` 触发** + 补 `verify:formal` / `contract:*` 进 CI。

### P2 · 覆盖率与变异

9. **`scripts/verify/new-code-coverage.mjs`**：`git diff -U0` 新增行 ∩ lcov `DA` 行，`hits===0 → FAIL`。
   - pathspec 必须含 `'*.ts' '*.tsx' '*.mjs' '*.css'`。
   - 新增行全为注释/空行/纯 `interface`/`type` 时不计入分母。
   - 必须断言 lcov 的 `SF` 数 > 0，否则 throw（防静默归零）。
10. **`scripts/verify/invariant-map.mjs`** + 把 `docs/invariants.md` 改 JSON。
11. **Stryker 接入**：配置必含 `buildCommand`，且加「`noCov === total` 即判配置故障」的哨兵断言。

### P3 · 重构前置

12. **打通 `renderer/index.ts` 覆盖采集**（第六节）。
13. 覆盖率达标后再拆文件。**拆分方式建议**：按领域切成 `renderer/{session,settings,layout,streaming,inspector}/`，每个 500-1500 行，通过显式依赖注入而非全局单例连接。

---

## 八、环境与命令速查

```bash
# 依赖（已修好，干净环境可用）
npm ci --ignore-scripts

# 完整验收（当前全绿）
npm run verify

# 单项
npm run gates                 # 静态门禁
npm run typecheck
npm test                      # 1968 用例
npm run verify:formal         # 46 项不变量
npm run gates:mutation        # 5 个变异点

# 覆盖率（c8 未入依赖，走 npx）
npx --yes c8@10 --reporter=html --reporter=text \
  --exclude="**/__tests__/**" \
  node --test --test-concurrency=1 "packages/desktop/__tests__/unit/**/*.test.mjs"
# 报告在 coverage/index.html

# 风险排序
node scripts/probe/risk-rank.mjs "180 days ago" 20

# 浏览器（CDP 测试用）
# Edge: C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
# 12 个 CDP 文件全部硬编码此路径，需统一改为 scripts/lib/browser-path.mjs
```

---

## 九、踩过的坑（别再踩）

1. **c8 不能排 `**/dist/**`**。排掉后 lcov 0 字节，测试仍 pass，覆盖率报 0。
2. **`npx diff-cover` 是假的**。npm 上那个 0.1.0 是同名占位包，真 diff-cover 是 Python 包。增量覆盖要自己写。
3. **`t.skip()` 会让失败伪装成跳过**。12 个 CDP 文件 19 处，加上找不到浏览器就 skip，CI 上是「全绿零执行」。
4. **`tsc --build` 不清理已删源文件的产物**。删源码后必须清 `dist` 重建。
5. **`bun.lock` 被 gitignore**，不是权威锁。双锁并存已实测漂移过（`package.json` 要 electron 34.2.0，lock 记 `^45.1.0`）。
6. **Stryker 沙箱会复制 672MB 的 `packages/desktop/release/`**，必须配 `ignorePatterns`。
7. **tap-runner 只在文件粒度**，「反查引用某源文件的测试」在统一 barrel 导出（`dist/index.js` 53 行 `export *`）的结构下做不到。
8. **搜代码时 `Select-String -Pattern "a|b"` 在 PowerShell 里行为不一致**，用 grep 工具更可靠。

---

## 十、需要用户裁决的开放问题

1. **`renderer/index.ts` 的 100% 是指行覆盖还是分支覆盖？** 两者工作量差一个量级。当前 211 处 DOM 分支，分支全覆盖可能需数周。
2. **`package-lock.json` 变动 4051 行**，是否接受作为独立提交？
3. **`docs/testing-strategy.md` 是修正还是重写？** 错误条目较多（第五节），重写可能更省事。
4. **CI 成本**：按审计估算，全部 PR 跑 fast+unit+coverage+mutation+formal+gui-smoke 约 14-20 分钟/PR（单 OS），双 OS 22-26 分钟。GitHub Free 私有仓 2000 分钟/月，约 80-90 个 PR 就耗尽。是否需要按分层削减？

---

## 十一、当前工作区状态

```
 M .github/workflows/quality-gates.yml
 M .gitignore
 M AGENTS.md
 M package-lock.json
 M packages/desktop/package.json
 M packages/ui/package.json
?? docs/invariants.md
?? docs/testing-strategy.md
?? scripts/probe/
```

分支 `dev/v0.1`，HEAD `06d8086 merge: BOT 配置中枢第一二期合入 dev/v0.1`。

**建议提交拆分**：

1. `fix(deps): workspace 协议改为 * 并重建 lock`（含 2 个 package.json + package-lock.json）
2. `ci: 修复依赖安装并补 workspace 链接校验`（含 workflow + .gitignore）
3. `docs(testing): 测试体系与不变量映射表`（含 docs + scripts/probe + AGENTS.md 索引）

---

## 十二、临时文件（可删）

`%TEMP%` 下的探测脚本，不属于仓库：

- `cdp-steps.mjs`（可用，CDP 三步验证）
- `cdp-cov-probe2.mjs` / `cdp-coverage-probe.mjs`（卡住，需修）
- `workspace-star-probe/`（`*` 协议验证）
- `ci-verify-probe/`（CI 依赖失败复现）
- `exit-probe/`（`process.exit(0)` 伪造全绿复现）
- `package-lock.json.bak`（重建前的旧 lock）
