# clean-light-theme / ayu-light-theme 特征验证规范 (4 段式契约)

## 1. 特征背景与设计意图 (Why)
Hermes Flux 工作台追求全平台端到端极客美学。为满足在明亮办公光线下的高可读性、专注阅读与长久编程需求，全面改造并重塑了浅色皮肤系统，完整落地来自 OpenChamber 原生配置的经典 Ayu 晨曦浅色皮肤（`ayu-light`）。
- **解决的痛点 (Pitfall)**：规避界面过浅过亮发飘的问题，将边栏与对话底板适度调深，使物理层次更沉稳扎实；同时输入框杜绝使用天青高亮边框，回归纯粹温暖的石板中性边框；
- **核心设计哲学 (Rules)**：
  - **Ayu 晨曦 (`ayu-light`)**：基于微暖沉稳羊皮纸底板（`#F8F4EA`）、深一度抽屉底衬（`#EFE9DE`）、石板水墨炭灰字（`#394049`），晴空天青色（`#4AA8C8`）仅作为点睛微点缀（代码高亮/状态标），输入框锁定温润石板中性边框（`#D5CBB9`）；
  - **极简冷灰 (`jade-white`)**：基于 Slate 中性冷灰底板（`#F8FAFC`）、纯白内容白板与墨翡冷翠强调色（`#0D7A5E`），达到 WCAG AAA 级高对比度（> 4.5:1）。

## 2. 架构与契约约束 (Contract & Rules)
1. **单一真理源**：由 `packages/ui/src/tokens/themeRegistry.ts` 与 `tokens.ts` 集中派发 29 个语义色彩 Token，包含 `obsidian-gold`、`ayu-light`、`jade-white` 与 `cyber-matrix`；
2. **极速零白屏热重载**：切换皮肤通过切换根节点 `data-theme="ayu-light"` 与 `data-variant="light"` 瞬间切换 CSS 变量，不触发任何 DOM 树解构或组件卸载重排；
3. **分层物理层级 (ayu-light)**：
   - 窗口底层底板：`--bg-window: #FAF9F8`
   - 左侧微轨与抽屉：`--bg-rail: #F4F4F3`
   - 悬浮卡片与工作区白板：`--bg-card: #FFFFFF`
   - 代码块与预览底衬：`--bg-code: #F4F4F3`
   - 文本主色：`--text-main: #24292F`
   - 强调天青：`--accent: #4AA8C8`（纯点缀）
   - 用户提问气泡：`--chat-user-message-bg: #F5F4F0`
   - 输入框边框：锁定中性浅灰 `--border-medium: #D8D8D6`，聚焦态 `--border-strong: #8C8C8A`，杜绝天青色外边框
   - 行内代码：低饱和中性灰衬底 `var(--bg-panel)` + 深墨字 `var(--text-main)`，杜绝蓝色膏药块

## 3. 驱动与验证时序 (Verification Sequence)
1. 启动本地真实 Blink 浏览器内核驱动会话；
2. 调度执行 `app.theme = 'ayu-light'` 触发热重载；
3. 校验根 DOM 属性 `data-theme="ayu-light"` 并在计算样式中提取 `--bg-window` 与 `--text-main`；
4. 注入包含 Markdown 标题、列表、引用块与 TSX 代码块（包含标签、属性、字符串与 JSX 块注释）的真实对话流；
5. 校验代码块 `.code-block-wrapper`、悬浮输入舱 `.composer-dock`、用户气泡 `.user-bubble` 与选中态会话项 `.session-item.active` 的物理装配；
6. 捕获真实物理渲染截图并存盘至 `artifacts/verification/clean-light-theme/screenshot.png`。

## 4. 机器断言与验收证据 (Machine Assertion & Artifacts)
- **静态门禁验证**：`npm run gates:changed` 新增阻断数必须严格为 0；
- **全栈类型推导**：`npm run typecheck` 0 TS 报错；
- **形式化不变量**：`npm run verify:formal` 11 大数学定理持续获证；
- **物理渲染产物**：
  - 截图留存：`artifacts/verification/clean-light-theme/screenshot.png`
  - 机器证据：`artifacts/verification/clean-light-theme/evidence.json`
