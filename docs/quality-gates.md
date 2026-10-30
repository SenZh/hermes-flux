# Hermes Flux 自动化门禁与 Agent 质量保障体系

> 本文件是门禁体系的**操作手册**。规则正文在 `AGENTS.md` 与 `ENGINEERING_DISCIPLINE.md`，
> 可执行实现在 `scripts/gates/`，Agent 编排在 `opencode.jsonc` 与 `.opencode/`。

---

## 一、整体结构

```
规则正文  AGENTS.md / ENGINEERING_DISCIPLINE.md      ← 人读的规范
   │
   ▼
可执行门禁  scripts/gates/                            ← 机器执行的判定
   ├─ rules.mjs          四条规则（架构 / 换肤 / i18n / 性能）
   ├─ run.mjs            统一执行器（棘轮 / 报告 / baseline）
   ├─ .baseline.json     存量债务冻结清单（只允许收缩）
   └─ lib/
       ├─ scanner.mjs    注释剥离与行号映射（门禁的地基）
       ├─ changed.mjs    改动集识别
       └─ reporter.mjs   人读表格 + 机器 JSON 双口径
   │
   ▼
强制触发  .githooks/pre-commit.mjs   /  .github/workflows/quality-gates.yml
   │
   ▼
审查编排  opencode.jsonc + .opencode/agents/ + .opencode/commands/
```

**核心原则：规则只有一份实现。** CI、pre-commit、Agent 自检全部调用
`node scripts/gates/run.mjs`，不存在第二套口径。

---

## 二、快速使用

| 场景 | 命令 |
|---|---|
| 日常开发自检 | `npm run gates` |
| 只查本次改动 | `npm run gates:changed` |
| 严格模式（存量也拦） | `npm run gates:strict` |
| Agent 消费的 JSON | `npm run gates:json` |
| 交付前完整验证 | `npm run verify` |
| 债务清偿后收缩基线 | `npm run gates:freeze` |

安装钩子（新克隆仓库首次执行）：

```bash
git config core.hooksPath .githooks
```

> `npm install` 的 `prepare` 脚本已自动完成此步。钩子入口是 sh shim，
> 实际逻辑在 `pre-commit.mjs`，因此在 Windows PowerShell 下同样可用。

---

## 三、四条规则的真实边界

### Gate 0 · 架构符合性

| 规则 | 判定 |
|---|---|
| `arch/layer-direction` | `core` 不得依赖 `ui`/`desktop`/`electron`；`ui` 不得依赖 `desktop`/`electron` |
| `arch/type-escape` | 禁止 `as any`、`as unknown as`、`: any`、`<any>` |
| `arch/no-bare-transport` | UI/渲染层禁止裸 `fetch` / `new WebSocket` / `XMLHttpRequest` |

### Gate 4a · 换肤一致性

- 扫描面：`packages/ui/src/components/**`、`packages/desktop/src/renderer/**`、`packages/ui/src/i18n/**`
- 拦截：任何**带色相**的字面量颜色（hex / rgb / hsl）
- **放行**：中性遮蔽色 `rgba(0,0,0,x)`、`rgba(255,255,255,x)`、`#000`、`#fff`
  —— 它们的语义是「压暗/提亮一层」，不承载色相，跨皮肤保持中性
- **豁免**：`packages/ui/src/tokens/**` 是调色板权威源，本身不参与扫描

> 这条边界很关键。若把中性遮蔽色也拦，会立刻产生上百条无意义违规，
> 棘轮基线随即失效，门禁当天就会被注释掉。

### Gate 4b · i18n

- 拦截：组件与渲染层中的任何中文字面量
- 放行：`packages/ui/src/i18n/index.ts`（字典本身）、`tokens/**`（皮肤显示名属于数据）
- 自动遮蔽：模板字符串里的 `<!-- HTML 注释 -->` 与 `/* CSS 注释 */` 不算文案

### Gate 4c · 性能不变量

| 规则 | 拦截对象 |
|---|---|
| `perf/infinite-animation` | 无休止 CSS 动画（合成器 60fps 空转） |
| `perf/smooth-scroll` | `scroll-behavior: smooth`（与滚动补偿叠加成抖动） |
| `perf/estimated-height` | `content-visibility` / `contain-intrinsic-size`（破坏跟随模式判定） |
| `perf/intl-in-hot-path` | 渲染热路径的 `toLocaleTimeString` / `Intl.*` |

---

## 四、债务棘轮：为什么存量不阻断

**问题**：一次性把 314 条存量违规全部变红，门禁当天就会被注释掉，永久失效。

**方案**：债务冻结 + 新增零容忍。

```
每条违规 → 生成指纹 ruleId::file::内容短哈希
         → 出现在 baseline 中 → 计入「存量债务」，不阻断
         → 不在 baseline 中     → 计入「新增违规」，阻断提交
```

三个关键设计：

1. **指纹不含行号**：上方插入一行代码不会让债务失效或凭空新增。
2. **逐条对冲而非按计数**：修一条又加一条不会互相抵消。
3. **baseline 只允许收缩**：扩张等于把新违规洗成存量债务，这是严重违规。

清偿后执行 `npm run gates:freeze` 收缩基线。只有全量扫描才计入「已清偿」数量——
改动集扫描只能看到少数文件，若照样统计就会得出「一次提交清偿 300 条」的假结论。

---

## 五、Agent 审查编排

| Agent | 模式 | 权限 | 职责 |
|---|---|---|---|
| `flux-build` | primary | 可写 | 实现 + 跑门禁 + 委派审查 |
| `flux-style-reviewer` | subagent | **只读** | 换肤 / i18n / 性能 / 布局审查 |
| `flux-code-reviewer` | subagent | **只读** | 架构 / 类型 / 状态 / 测试有效性审查 |
| `flux-gate-fixer` | subagent | 可写（窄） | 只修门禁阻断项 |

### 强制触发规则

| 改动类型 | 必须触发的审查 |
|---|---|
| 触及 `ui/src/components/**`、`ui/src/tokens/**`、`desktop/src/renderer/**`、任何 `.css` | `flux-style-reviewer` |
| 任何 `.ts` / `.mjs` 代码改动 | `flux-code-reviewer` |

命令入口：

```
/flux-gate                     完整交付前自检
/flux-review-style [范围]      委派样式审查
/flux-review-code [范围]       委派代码审查
```

### 为什么审查者必须只读

审查者若能改代码，就会「边审边改」，结论失去独立性——被改过的地方一定「通过」了。
因此 `flux-style-reviewer` 与 `flux-code-reviewer` 在 `opencode.jsonc` 与
`.opencode/agents/*.md` frontmatter 两处都禁止 `edit`，并由
`scripts/gates/verify-config.mjs` 做一致性断言。

同时禁止 `explore` / `general` 派生孙 Agent，防止审查链无限递归与责任下推。

---

## 六、豁免机制

静态模式必然存在误报。豁免必须**写进代码、可被 review 审计**，不能塞进脚本白名单：

```ts
// gate-theme-allow: 该色值来自运行时注入的品牌 logo SVG，不属于主题色
const brandFill = '#3178C6';
```

| 标签 | 作用规则 |
|---|---|
| `gate-arch-allow` | Gate 0 |
| `gate-theme-allow` | Gate 4a |
| `gate-i18n-allow` | Gate 4b |
| `gate-perf-allow` | Gate 4c |

约束：只对违规行**同一行或上一行**生效，中间隔空行不继承。

---

## 七、门禁自身的可信度

门禁必须被门禁验证，否则会退化成永远绿灯的空壳。

`packages/core/__tests__/architecture/gate-engine.test.mjs` 用 33 个用例证明：

- **规则真的会红**：每条规则都有「故意违规 fixture」，规则若被改成 `return []` 立刻变红；
- **不误报**：中性遮蔽色、HTML 实体 `&#039;`、注释中的示例色值、`var(--token)` 引用、
  `t('key')` 调用均验证放行；
- **扫描器正确性**：注释遮蔽保留行号与长度、URL 中 `//` 不触发遮蔽、
  模板字符串内 HTML/CSS 注释被正确遮蔽、转义引号不提前结束字符串态。

---

## 八、已知缺口（必须诚实记录）

以下问题**已确认存在但尚未修复**，属于存量债务：

1. **Token 体系缺少语义化危险色**。当前 `SkinDefinition` 没有 `danger` / `dangerSubtle` 系列，
   导致错误态红（`#EF4444`）无法换肤。修复需扩展 Token 并同步补齐全部 3 个已注册皮肤，
   否则切皮肤时颜色会塌陷为 `undefined`。
2. **StatusBar 高度与规范不一致**。`docs/design-system/04-tokens-and-design-system-spec.md`
   与 `AGENTS.md` 规定 22px，实现为 28px。
3. **渲染层 107 处违规**（`packages/desktop/src/renderer/index.ts`），
   包含 572 处中文字面量、多处 `as any`、3 处 `toLocaleTimeString` 热路径调用。
   该文件是最大的债务集中地，需要专项偿还。
4. **`skeleton` 换肤测试仅覆盖 InspectionPod**。`design-tokens-guardrails.test.mjs`
   只断言了单个组件，其余 6 个组件的零死色值由本门禁静态保障，但缺少渲染级断言。

---

## 九、交付前 12 项检查对照

`ENGINEERING_DISCIPLINE.md` 阶段 3 的 12 项检查，本体系的覆盖情况：

| 检查项 | 覆盖状态 |
|---|---|
| 1. 增量类型与死代码 | ✅ `npm run typecheck`（未接入 knip） |
| 2. 增量 AST 棘轮 | ✅ 已实现 4 类规则（未实现完整 15 条 Oxlint） |
| 3. 锁文件一致性 | ⚠️ 本项目用 npm 而非 bun，`npm ci` 已入 CI |
| 4. 变异测试 | ❌ Stryker 未接入，当前依赖 `flux-code-reviewer` 做人工变异检验 |
| 5. 子进程单测隔离 | ❌ 未实现 `run-isolated-tests.mjs` |
| 6. WebKit 滚动避让 | ✅ `perf/*` 规则静态拦截 |
| 7. 集中式动画时钟 | ✅ `perf/infinite-animation` 静态拦截 |
| 8. 容灾与防复活 | ❌ 无自动化，依赖代码审查维度 3 |
| 9. 跨端 Surface 矩阵 | ❌ 无自动化模板 |
| 10. 物理入口可达性 | ❌ 无自动化 |
| 11. 真实硬件运行声明 | ❌ 属于流程约束，无法静态验证 |
| 12. 极简沟通与纯净提交 | ⚠️ 部分：`.gitignore` 未显式拦截 `evidence/` |

未覆盖项不是「已解决」，只是尚未实现。任何声称「12 项全通过」的结论都是不成立的。
