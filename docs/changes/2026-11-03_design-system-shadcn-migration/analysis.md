# analysis — 认知校准与方案对比

关联：requirements.md　结论先行：**迁移的地基假设已全部转为事实，推荐方案 A（esbuild 管线 + Tailwind CLI + shadcn 岛屿共存）。**

## 一、事实清单（全部本会话亲验，附出处）

| # | 事实 | 证据 |
|---|---|---|
| F1 | ui 包声明的 React/Radix/lucide 依赖**从未安装**（node_modules 根目录 react/react-dom/clsx/cva/tailwind-merge 全 no）且生产代码零调用；components/ui/*.tsx 三个 shadcn 脚手架死文件未导出未消费 | 本会话 dir 检查 + 前轮审计 grep |
| F2 | desktop 构建为**六段** esbuild 入口（main/preload/renderer/messageActions/rollbackTransaction/toolPatchQueue，:24/:37/:50/:62/:74/:83），renderer bundle `platform:browser target:es2022 format:esm`，repo 自带 esbuild.exe | packages/desktop/scripts/build.mjs（审查纠正原"三段"误记，主 Agent 复核属实） |
| F3 | 垂直切片实测通过：本仓 esbuild.exe 编译 React19 tsx（--jsx=automatic）250.7KB min/168ms；@tailwindcss/cli 4.3.4 编译含语义槽位的 tokens.css 10.7KB/43ms；tsc --strict 0 错；产物含 .bg-primary utility 与 [data-theme] 双皮肤变量 | C:\...\Temp\opencode\poc-chain\（dist/app.js、dist/styles.css） |
| F4 | REST 通道在 PAL 契约与 core 注入点**均已存在**：`IPlatformBridge.httpProxy`(:68-76)、`HermesGatewayClient.restFallbackHandler`(:129)；renderer:2562-2570 是绕开既有正路的重复实现 | packages/core/src/pal/IPlatformBridge.ts、core/src/rpc/client.ts |
| F5 | 皮肤骨架 interface 形状正确（29 槽全必填），**但 `applySkinToDom`/`BUILTIN_SKINS` 生产调用点为 0**（仅 ui 单测消费，主 Agent 复核 grep 属实）。运行时唯一生效的皮肤真值源是 desktop `styles.css` 的 `[data-theme]` 字面块（:42/:105/:170/:234/:929）+ 约 20 条皮肤专属组件选择器规则（:679-928，含 session-item.active、user-bubble、composer-dock、win-cap-btn 等态差异） | grep 全 packages + styles.css 块位实测（审查员发现） |
| F6 | 皮肤真值为**三源漂移**：styles.css 字面块（运行时生效）/ themeRegistry.BUILTIN_SKINS（仅测试校验自身）/ tokens.ts THEME_*（barrel+1 测试，僵尸）。同皮肤跨源不同值（obsidian-gold bgWindow #090A0F vs #0E0F12、accent #F59E0B vs #D97706）；`suet-jade` 是只有 CSS 别名块、无注册表实体的幽灵皮肤（styles.css:105/680/688/697/705/780） | 三文件对读 + 审查复核 |
| F7 | 字体仅 2 个变量族（--font-sans/--font-mono，定义在 desktop 壳 styles.css:26-27，不属皮肤体系）；字号/字重/行高/间距/动效 0 Token，散写 px 含半像素（9.5px/10.5px/11.5px 多处）；6 处组件裸写 font-family: monospace 绕过变量 | 本会话 grep 84 命中样本 |
| F8 | 组件层硬编码色 84 处（45 hex + 39 rgb）绕过槽位；现有 theme/no-hardcoded-color 门禁漏检模板内联 style | 前轮审计实测 |
| F9 | DIMENSIONS 13 项几何常量只活在 TS 层，且与 AGENTS.md 声明冲突（leftRailWidth 260 vs 52+212=264）；CSS 侧另有字面量副本 | tokens.ts:166-180 vs AGENTS.md 一.3 |
| F10 | 并发债基线在案（13 真竞态），P0 两条直接落在迁移必经路径上：R-01 loadOlderMessages(:2064-2086)、R-02 ensureLiveSessionId(:2393-2415)；代际守卫模板存在于同文件 loadMessages(:2240) | arena-concurrency/synthesized.md，主 Agent 复核 |
| F11 | mobile 现无独立壳：cpSync desktop dist(:28) + 桥伪装挂 window.hermesDesktop(capacitor-bridge:539-540)；CSS 尾部全局 button 44px 补丁(:104-109) | 前轮审计 |

## 二、推断清单（显式标注，tech-design 环节证明负责闭环）

| # | 推断 | 置信度 | 闭环手段 |
|---|---|---|---|
| I1 | 槽位表（核心组 + 扩展组）足以覆盖全部真实消费面 | 中（审查后下调：原"32 槽"估算漏了 --specular-line/--hl-×4/--badge-×15/--theme-thumb-color/--danger-color 等 styles.css 侧真实槽，及 shadcn 标准 --secondary/--muted/--accent 背景族） | 干跑输入三方全集：themeRegistry 29 值 + styles.css 逐皮肤块全部变量 + 组件 var() 引用面；任一变量无处安放即缺槽，回改槽表 | 
| I2 | React 岛屿与存量字符串模板 DOM 可在同一 document 长期共存（渐进替换） | 中 | 第二 PoC：现网 index.html 挂一个 React 岛屿（本会话未测） |
| I3 | 合流器写 `#msg-content-*` innerHTML(:834) 与 React 所有权边界可切清（消息气泡先不迁 React，外壳先迁） | 中高 | 属设计决策：迁移顺序把 MiddlePod 排最后即可绕开，无需共存期解耦 |
| I4 | 门禁 baseline 指纹机制在文件整体重写后会失效重算，允许按波清理存量 84 处违规而不扩基线 | 高 | run.mjs 按 merge-base 增量判定，重写文件的新版违规为 0 即可 |

## 三、现状与目标差距（G1-G6 对照）

- 差距1（体系性）：皮肤机制有骨架缺扩展（颜色已 Token 化，字体/字号/间距/动效零 Token），加真值双表漂移、几何三重源 → G1/G2 需先"单一源 + 维度扩展 + 漂移收编"。
- 差距2（观感根因）：丑的三个技术根因 = 无原子控件（每舱自拼）、无排版韵律（半像素散值）、假契约（Phantom Props 使组件行为不可复用）。shadcn/cva/React 回调恰一对一解。
- 差距3（拓扑）：G4 的共用抽象面 core 已具备（F4），缺的是把 renderer 7,072 行内的编排逻辑下沉 + mobile 独立编译管道，二者有先后依赖。
- 差距4（债随迁移）：G5 要求竞态修复与对应组件迁移同波交付，禁止"先搬再修"双份工。

## 四、方案对比表

| 方案 | 描述 | 优点 | 缺点 | 风险 | 验证成本 | 推荐理由 | 不选理由 |
|---|---|---|---|---|---|---|---|
| **A（选）esbuild+Tailwind CLI+岛屿共存** | 保留 build.mjs 三段 esbuild，新增 `@tailwindcss/cli` 预编译步 + renderer 入口切 .tsx，shadcn 组件入共享包，三舱逐个波次迁移，MiddlePod 最后（避开合流器双所有权） | F3 已实证全链可行；构建工具零引入；mobile cpSync→独立入口可平滑过渡；风险逐波隔离 | 共存期两套渲染模型并存，规范需标注"新组件必须 React" | I2/I3 | 低（PoC 已完成） | ✅ 推荐：地基假设全部转事实，增量可回滚 | — |
| B | Vite 重建 renderer + 一次性全量 React 化 | dev server HMR 体验 | 双迁移叠加（构建工具+渲染模型同时换），build.mjs 已证明不需要 Vite（F2/F3）；现有 CDP/单测按 dist 结构挂接全断 | 高，失败面不可分割归因 | 中 | — | 一次性全切违背 sequence-verifiable-units；同类事故成本在并发债 R-05"链不可取消"模式里已见 |
| C | 维持字符串模板，仅做 CSS/Token 换肤 | 最省 | 解不了无原子控件、假契约、无动效地基三个根因（F7/F8 + 前轮 Phantom Props 实锤） | "丑"会被再次归因为配色而重复返工 | 低 | — | 治标；且 cva/Tailwind 生态资产用不上，皮肤纪律仍靠人肉 |

## 五、风险登记

| # | 风险 | 落位 | 缓解 |
|---|---|---|---|
| R-a | 共存期组件规范漂移（新代码继续写模板） | 全部波次 | 门禁加 arch/no-new-template-component 探针（ui 内新 .ts 模板导出即阻断，白名单到期清单） |
| R-b | react-dom 250KB min 进 mobile WebView | 波次④ | 当前 renderer 产物本就同捆运行；实测首帧后再定，超标则 react 换 precompile 或代码分割 |
| R-c | CDP 验证资产（verify-hermes-flux features + harness 选择器）随波失效 | 每波 | 每波 live 验证强制重截图基线，旧基线标注适用 SHA |
| R-d | I1 干跑若暴露缺槽，槽位表膨胀伤 G1 | tech-design §2 | 上限硬约束 32，超出项强制归并或降级为节奏层常量 |

## 六、根因结论

用户感知的"丑"，技术根因不在配色选择，在**没有设计系统执行面**：Token 只覆盖颜色一个维度且存在双真值表与 84 处旁路（F6/F7/F8）；组件层没有原子控件和回调契约可供"好看起来"落地（F1 + 前轮实锤）。因此本变更把 G1/G2（体系）排在 G3-G6（栈与拓扑）之前的同一文档内，二者互为地基。
