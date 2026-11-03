# tech-design — 设计系统 + shadcn 迁移 + 双壳拓扑

决策输入（operator 已确认）：5 皮肤保留补值 / 默认 obsidian-gold / 捆绑品牌字体（本设计裁决为 Inter Variable）/ 不建 web 壳 / 波次①②并行③④串行。
用户目标复述：把前端从"字符串模板+双真值皮肤表"迁到成体系的设计系统与皮肤系统，用 shadcn/ui 治"丑、配色乱、按钮杂、无效果"，desktop 与 mobile 独立成壳、数据操作逻辑共用抽象在 core。

## 1. 环节可行性证明矩阵（假设清零）

| 步骤 | 核心动作 | 潜在假设/前提 | 证明手段 | 证据来源 | 结论 | 备选预案 |
|---|---|---|---|---|---|---|
| S1 构建接入 | build.mjs 新增 tailwind CLI 步，renderer 入口 .ts→.tsx | 现有 esbuild 管线不需替换即可承载 React+Tailwind；**六段入口**（main/preload/renderer/messageActions/rollbackTransaction/toolPatchQueue，:24/:37/:50/:62/:74/:83）均需对齐 jsx loader 与 ui dist 消费 | PoC 实测 | 本仓 esbuild.exe bundle React19 tsx 250.7KB/168ms；@tailwindcss/cli 4.3.4 编译 10.7KB/43ms；产物含 .bg-primary utility 与 [data-theme]（poc-chain/dist，analysis F3）；aux 入口为独立纯逻辑包、按同一机制挂接 | ✅ | esbuild postcss 插件内联 |
| S2 ui 包 React 化 | ui tsconfig 加 jsx:react-jsx，组件 .tsx 走 tsc --build | react/@types 可安装（registry 可达） | 实测 npm view/install | poc-chain 43 包 21s 装完（analysis F1：现依赖声明从未安装） | ✅ | 组件入 desktop，ui 只留 tokens |
| S3 字体捆绑 | @fontsource-variable/inter 引入，latin+latin-ext 子集 woff2 进 dist，CJK 回退系统栈 | OFL 许可可商用捆绑；variable woff2 体积可控 | 官方 registry 元数据 + 子集实测 | license: OFL-1.1；实测 latin 47.1KB / latin+ext 130KB / 全量 213KB，预算 400KB 达标 8×（slot-table-decision §四） | ✅ 已证 | 整体回退系统栈（槽位表不变，只改 --font-sans 一条值） |
| S4 共存不变量 | React 容器只允许挂载在"不被模板整树重建触及"的宿主元素上；每舱迁移=用 React root 替换该具名宿主，单向 | 覆写/重建点范围可枚举（审查纠正：不止具名 getElementById） | 源码核对 | 局域覆写经 `root.querySelector`（:4695 附近）按舱宿主定位；**初始挂载存在整树重建分支**（:4548→:4689 `root.innerHTML=html`）与 MiddlePod 宿主重刷（:4916）、`insertAdjacentHTML` 补挂（:4822）；不变量强化为：首个 React 岛屿必须在初始整树挂载完成之后创建，且被迁舱的宿主不得再作为任何 innerHTML/insertAdjacentHTML 的目标；InputDock 经 `dockHtml` 字符串插槽注入 MiddlePod 子树（:4598-4622），故**InputDock 与 MiddlePod 必须同 PR 迁移或先移出插槽依赖** | ✅（约束可执行，波③逐舱 live 截屏 + 节点引用同一性断言） | 提前迁移覆写入口 |
| S5 REST 归位 | renderer 直拼 httpProxy 的旁路收回 core 服务 | PAL 已有契约与注入点 | 源码 | IPlatformBridge.httpProxy :68-76；restFallbackHandler client.ts:129（analysis F4） | ✅ | 无需新抽象 |
| S5b auth 链路归位 | renderer:940/:955/:967 三处裸 fetch（status/password-login/ws-ticket）收回 PAL `authenticateGateway`(:63-67) 与 rest 通道 | 契约已定义、缺实现 | 源码 | 三处行号实测 + 基线指纹 .baseline.json:232-234 清偿路径 | ✅（新增，审查 #8 补入） | 保留三处并逐条 gate-arch-allow 注（不推荐，违 G4） |
| S6 会话编排下沉 | deleteSession(:2519-2653 **全函数**) 拆分：core 认领编排段 close→interrupt→delete→4023 降级→prune，返回 `DeleteOutcome` 枚举（含降级成功/prune 集/多 profile 部分失败）；壳侧订阅者认领其余副作用 | （审查 #3 纠正）原"函数体只引用 gatewayClient/describeRpcError/profile 列表"仅覆盖 :2534-2553，不成立 | 全函数源码精读 | :2519-2653 实际引用 render()/restoreComposerFocus()/openBotChat/handleArmedOnDelete/tokenCoalescer.clear()/disarmTurnWatchdog/state.dockNotice/getEffectiveUrl+desktopApi.httpProxy+currentTicket——均为壳侧可订阅事件或经 S5 归位的通道，无 core 不可达依赖 | ✅（按拆分口径成立；**"renderer≤1,500 行"判据移挂波③末**，波②单独不可验） | 保留壳内但抽纯函数+定理 |
| S7 代际守卫原语 | 抽 `runGuarded(guard, fn)`，模板 loadMessages:2240 双条件 | 既有正确写法可参数化 | 源码 | :2240 `currentGen !== gen || state.activeSessionId !== id` 纯判据 | ✅ | — |
| S8 FSM 转移表 | `LEGAL: Record<FsmState, FsmState[]>` + transitionTo 校验 | 转移集合封闭可枚举 | 源码 | 5 态（fsm.ts:6）+ client.ts 7 处转移调用点（上轮已列） | ✅ | 非法转移先 warn 不 throw（灰度） |
| S9 门禁扩展 | rules.mjs 加 4 探针：模板新文件禁增/裸 hex 扩内联/裸 monospace/裸 font-size px；geo 常量入 CSS var | 自研扫描器可加规则；重写文件基线指纹重算=存量清偿通道 | 机制核对 | run.mjs 按 merge-base 增量判定（analysis I4）；6 处裸 monospace 已定位（F7） | ✅ | 探针先 warning-only 一个波 |
| S10 mobile 独立壳 | capacitor 静态资源目录 + 独立 esbuild 入口复用 core/ui dist；bridge `implements IPlatformBridge` | 技术链与 S1-S2 相同，无新工具 | 同 S1/S2 证据 + prepare-assets 现结构（F11） | ✅ | desktop 壳与 mobile 壳共享一个 app.tsx 入口包，仅入口参数分叉 |
| S11 CDP 资产 | control-flux harness 选择器随波重写，features md 双实现收编（BotProfileCard vs rail-primary-agent-card） | harness 按 index.html+dist 结构 | 既有资产在案（AGENTS.md 二.3） | ✅（机械工） | 波内新增对应 lane |
| S12 i18n 生效修复 | state.lang→setLocale 生产调用点接通（现状 t() 恒 zh-CN，前轮 §3.4 已核实） | t() 纯函数不动 | 源码 | i18n/index.ts:706/708 | ✅ | React context 化（波③后择机） |

Checklist 核对：原子拆解 ✅；假设全部显式且已取证（S3 体积、I1 dry-run 属"设计内容待波①产出"，非可行性假设）；证据含源码行/registry/实测；接口前后契约：tokens.css 输出 var → @theme inline 消费 → utility，同一产物已验证（F3）；运行环境：node22/esbuild.exe/tnpm 镜像实况；证伪兜底：每行有预案。

## 2. 设计系统与皮肤系统规范（G1/G2/G6 落点）

### 2.1 分层：皮肤层（每皮肤一张值表）与节奏层（全局恒定）

**皮肤层语义槽（定案 43 槽，`SLOT_IDS.length === 43` 表驱动对账单测已上线，消解审查 #4 数目歧义）。命名对齐 shadcn 以让内置组件自动换肤。单一真值源与生成链（审查 #1/#2/#11 高危整改 + 双审返工）：** 现状是三源漂移（F6），`skins.ts` 一张表只是第二层抽象的开始；真值收敛必须覆盖 CSS 侧运行时源——波① 用 `skins.ts → 生成 [data-theme] CSS 块` 的生成链**替换 styles.css:42-282/:929 的手写皮肤块**，并逐条裁决 :679-928 约 20 条皮肤专属组件规则（能表达为"角色 recipe+槽"的表达、其余删除或吸收并计入视觉 diff 基线）；themeRegistry.BUILTIN_SKINS 与 tokens.ts.THEME_* 废弃删除（suet-jade 别名块并入 jade-white 值或显式保留注），否则 skins.ts 上线即成第四张僵尸表。干跑输入三方全集：themeRegistry 29 值 + styles.css 逐皮肤块全部变量 + 组件 var() 引用面。

| 组 | 槽（= 生成的 CSS 变量） | 旧来源 |
|---|---|---|
| 底色×10 | `--background`(bgWindow) `--card`(bgCard) `--card-hover`(bgCardHover) `--card-active`(bgCardActive) `--popover`(bgElevated) `--sidebar`(bgRail) `--panel`(bgPanel) `--input`(bgInput) `--code`(bgCode) `--backdrop`(bgBackdrop) | hover/active **保留为槽**（审查 #5：warm-paper 的 active==card 是显式设计，五皮肤增亮/压暗方向不一，color-mix 单式不可复现，降级派生方案作废） |
| 衍生背景×6 | `--secondary`+`--secondary-foreground` `--muted`+`--muted-foreground`(复用 textMuted 值) `--accent`(bg 族)+`--accent-foreground` | 审查 #12：补齐 shadcn 标准背景族，否则内置 Badge/Skeleton/Menu `focus:bg-accent` 无处取值、"自动换肤"承诺落空 |
| 前景字×4 | `--foreground`(textMain) `--secondary-foreground`(textSecondary) `--muted-foreground`(textMuted) `--faint`(textFaint) | 同名迁移 |
| 主色×8 | `--primary`(accent) `--primary-hover` `--primary-dim` `--primary-glow` `--primary-subtle` `--primary-border` `--primary-foreground`(accentText)；`--ring`=`--primary` 引用 | accent 族 7 槽 |
| 状态×4 | `--success`(jadePulse) `--success-glow` `--warning` `--destructive`(并 --danger-color，styles.css:38/143) | jade 族 2 槽；warning/destructive 收编 84 处硬编码红黄（StatusBar 三色点、Titlebar pulse、diff 着色；交通灯属系统原生豁免白名单，gate-theme-allow 注） |
| 边框×3 | `--border`(borderMedium) `--border-subtle` `--border-strong` | 3 槽 |
| 阴影×3 | `--shadow-window` `--shadow-card` `--shadow-dock` | **每皮肤完整字符串值**（审查 #6：原表逐皮肤 y 偏移/扩散不同、ayu/jade 尾挂描边分量，"模板+色分量"不可还原，该方案作废） |
| 扩展组（干跑定案） | `--specular-line`(每皮肤受光内嵌线，styles.css:71/135/199/264/958，InputDock:196/284、renderer:3757 消费) `--hl-comment/--hl-string/--hl-keyword/--hl-number`(代码高亮 4 槽，styles.css:81-84 系，MiddlePod:1964/1968 消费且有断言 layout.test.mjs:534) `--thumb-color`(SettingsModal:279/410、MiddlePod:409) `--badge-{lang}-bg/text/border`(15 槽，InspectionPod:576、MiddlePod:886) | 审查 #2 漏检面。**全部列入皮肤表候选**；badge 族若五皮肤值恒同则归并节奏层（干跑裁决），hl/specular/thumb 为每皮肤值，必入皮肤层 |

类型判据：`interface SkinSlots { [K in typeof SLOT_IDS]: string }` 全必填，新皮肤缺任何槽 = 编译错；`suet-jade` 这类幽灵引用（getNextToggleTheme:336 引用了不存在皮肤）随迁移清除并加表驱动单测。

**节奏层（非皮肤，`tokens.css @theme` 常量段 + `@font-face`）。**
- 字体族×2：`--font-sans: "Inter Variable", -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`；`--font-mono: "JetBrains Mono", "SF Mono", Consolas, monospace`。Inter 子集仅拉丁+CJK 走系统栈（S3），`font-display: swap`，品牌字体类禁止组件内裸写 font-family（S9 探针，6 处存量随波清）。
- 字号 8 档（整数阶梯，消灭 9.5/10.5/11.5px）：`--fs-hero 20 / --fs-title 16 / --fs-section 14 / --fs-body 13 / --fs-aux 12 / --fs-caption 11 / --fs-overline 10 / --fs-micro 9`；字重 3：400/600/700；行高 2：1.25/1.6。
- 角色 recipe（"大标题/小标题/对话框样式"的落点，Tailwind utility 组合而非新槽位）：`title-hero=fs-hero+700+foreground`、`section-title=fs-section+600+secondary-foreground`、`body=fs-body+400+foreground+lh1.6`、`meta=fs-caption+400+muted-foreground+font-mono` 等，定义成 cva 的 variant 或 `@utility`（Tailwind v4 语法），PoC 的 button.tsx 即样例。
- 间距 8 档（4 基数）/圆角 4 档（6/10/14/9999，收编 DIMENSIONS.radius）/动效 3 档 120-200-320ms + ease-out/spring 两曲线（接集中时钟军规）/触控 44。
- 几何 `--geo-*`（titlebar 42、dock 740、pod 410、statusbar 22、micro-rail 52+drawer 212=left-rail 264）。**准源=实现（LeftRail.ts:234-251 `--rail-w-left:264`）+ AGENTS.md**；tri-rail spec 写的 48/260/380 与实现不符，随波①订正该 spec（审查 #7 改口，原"以 tri-rail 为准源"错误）。TS DIMENSIONS 改为从同一声明文件 code-gen，CSS 与 TS 单源。

### 2.2 组件基座与包拓扑

```text
packages/core    数据/协议/编排唯一底座（新增 SessionLifecycleService、runGuarded、FSM 转移表）
packages/ui      tokens（skins.ts+tokens.css 生成器）+ i18n + React 组件库（shadcn 基座 + 业务舱组件，全部 .tsx）
packages/desktop React 壳入口 app-desktop.tsx：窗口控制、托盘、Electron 桥注入
packages/mobile  React 壳入口 app-mobile.tsx：触控变体（同组件 cva size/variant 分叉），独立构建不再 cpSync
```
分层新契约（订正 AGENTS.md/架构文档措辞）：ui 可 import react/tailwind，仍禁网络与平台 API（gates 现有 arch/no-bare-transport 继续适用）；壳禁业务状态机（S6 下沉后由"渲染层文件行数上限"探针守门，desktop renderer ≤1,500 行目标）。

### 2.3 门禁止血（G2 的机器面）

新增探针四条（S9）：①`ui/no-new-template-export`——ui/src/components 下新增/修改的 .ts 模板导出文件即阻断，只减不增（存量清单入 baseline 冻结）；②`theme/no-inline-hex`扩匹配模板字符串内联 style；③`theme/no-raw-monospace`；④`typo/no-literal-font-size`（组件层裸 font-size/px，豁免 tokens.css 定义段）。React 侧等价物：Tailwind arbitrary value `text-[..px]`/`bg-[#..]` 同规则阻断。

## 3. 关键设计裁决（含被拒方案，详见 analysis.md 四/五节）

- 迁移策略=岛屿共存（S4 不变量守门），MiddlePod 最后迁：合流器写 `#msg-content-*`（:834）与 React 所有权冲突面在气泡级；波③前流式域维持模板，规避双写。【设计约束，非未证假设】
- deleteSession 下沉接口（S6 拆分口径）：core `SessionLifecycleService.deleteSession(id, profiles): Promise<DeleteOutcome>` 只完成 close→interrupt→delete→4023 降级→REST 双通道（经 S5 归位后的通道）→返回 prune 集与降级标记的枚举结果；render()/restoreComposerFocus/openBotChat 改选/tokenCoalescer.clear/disarmWatchdog/dockNotice 由壳侧作为 outcome 订阅者执行。错误码语义收进 `RpcErrorCode` 枚举（grep 判据按 scanner 的"去注释源码"口径，审查 #8）；R-09 复活条件序列先交错用例证伪再定墓碑。
- 流式最终态（波③末段起）：`useStreamingMessage()` 订阅 core 合流输出（core 不动，输出接口从 innerHTML 补丁改为 token 流事件），视口写权归 React。R-08 看门狗改静默驱动（append-content 重置 + 总上限只提示不解绑）随下沉一并做。
- 双实现收编：rail-primary-agent-card 视觉迁移进 `BotProfileCard`（React），LeftRail 引用它，7 个僵尸导出组件删除或转正（每个 PR 附消费证据）。

## 4. 文档订正清单（随波① PR 落盘）

AGENTS.md：ui 层描述"DOM 模板组件"→"React 组件库"；"7 大定理"→11（并随 S8 新增定理更新计数）；`packages/web` 表述加"未落地，本期范围外"；几何 212+52 与 DIMENSIONS 统一。**ultimate-tri-rail-architecture-spec.md：微轨 48/左轨 260/检查舱 380 与实现（52/264/410）不符，随波①订正**（审查 #7）。core-architecture-spec.md 分层图与 ui 职责节同步。theme-engine-spec.md 重写为本 §2 的槽位表版。04-tokens 文档并入。pitfall-registry.md 追加"皮肤三源真值漂移"案例并绑定生成链与槽完备性单测。

## 5. 波次（①②并行 → ③ → ④）

- **波①（设计系统地基，PR-1a/1b/1c）**：1a **三源真值面全量审计 + 皮肤表**：干跑输入=themeRegistry 29 值 + styles.css 逐皮肤块全变量 + 组件 var() 引用面三方交集（含 :679-928 约 20 条皮肤专属规则的逐条归槽/删除/diff 声明，消 suet-jade 幽灵）；skins.ts 生成链替换 styles.css 手写皮肤块；5 皮肤全值表；Inter 拉丁子集实测报告（≤400KB 预算）；SLOT_IDS 数目对账单测。1b 门禁 4 探针上线（warning-only）。1c 文档订正 + BUILTIN_SKINS/THEME_* 双僵尸表废弃。
- **波②（core 下沉与并发 P0，PR-2a/2b，与①无文件交集）**：2a SessionLifecycleService（按 S6 拆分口径：core 编排段 + DeleteOutcome，壳侧订阅副作用）+ runGuarded 四路守卫补齐（R-01/R-02/R-03/R-04）+ RpcErrorCode + S5b auth 链路归位；2b FSM 转移表 + 看门狗语义 + 其余编排 + 形式化定理增量（判定树强制项）。前置：synthesized.md 快照进本变更目录并固定哈希（审查 #14）。
- **波③（desktop React 化，PR-3x 按舱分单）**：build.mjs S1 改造（六入口）→ shadcn 基座（Button/Input/Dialog/Menu/Badge/Switch）→ 舱序 Titlebar/StatusBar → SettingsModal/Modal 族 → LeftRail（含双实现收编，附"不改数据源管道"准入注）→ InspectionPod → **InputDock+MiddlePod 同 PR**（审查 #9：dockHtml 字符串插槽 :4598-4622 使 InputDock 位于 MiddlePod 重建子树内，拆开迁移违反 S4 不变量；或前置独立 PR 先把 dock 宿主移出插槽依赖）→ MiddlePod 域收尾（流式写权切换）。每舱 PR 附 CDP 截图基线 + 节点同一性断言 + 门禁转阻断。**"renderer≤1,500 行"判据在本波末验收**（审查 #3）。波③准入三项（三轮复审登记）：theme 初始化按 SKINS 键白名单回退 obsidian-gold（消 state.theme 的 as any 幽灵存档塌陷面，renderer:4522 附近）；enDict 皮肤名补登；删除 THEME B/C/E/D 过渡注释头。LeftRail 会话行重设计（用户实测反馈定案，随波③ LeftRail 迁移 PR 交付）：行内头像移除（微轨已承载 Bot 身份，行内重复且拥挤）；标题保留为第一行主体；副标题保留但降为 12px muted 单行截断（扫描价值=快速定位聊到哪）；时间保留但紧凑化（当日只显 HH:mm，跨日 M/D，跨年带年份），钉行右缘；行高目标 48px。左轨拖拽越界 bug 已于波③前独立修复（clamp [264,400] + 恢复强制夹取）。
- **波④（mobile 独立壳，PR-4x）**：app-mobile.tsx+capacitor 资源管道替换 cpSync、bridge 真 implements IPlatformBridge、触控热区/键盘避让按 ENGINEERING_DISCIPLINE 二.5 视口矩阵回归、CSS 全局 44px 补丁废除。

遗留验证项（非阻断，进测试计划）：I2 React 岛屿与覆写路径共存由波③逐舱 live lane 实证；mobile WebView 字体/包体首帧预算波④ perf 基线测定。

## 6. 根因与验收呼应

丑的三根因（无原子控件/零排版 Token/假契约）分别由 §2.1 角色 recipe、§2.1 节奏层+探针、React 回调模型（PoC button.tsx 已示范 props 真绑定）闭环。G1-G6 判据见 contract.md。
