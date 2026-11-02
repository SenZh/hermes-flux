# 特征契约：中间用户核心交互区与输入舱 (interactive-chat-stage)

> 关联规范：`docs/architecture/interactive-conversation-stage-spec.md`  
> 运行驱动：`node scripts/verify/control-flux.mjs run interactive-chat-stage`  
> 物理截图：`artifacts/verification/interactive-chat-stage/screenshot.png`  
> 数据留证：`artifacts/verification/interactive-chat-stage/evidence.json`

---

## 1. 特征全景与场景定义 (Scope & Scenarios)
本特征覆盖 Hermes Flux 中间核心用户交互区（Main Chat Stage）与 740px 黄金限宽悬浮输入舱（Composer Dock）在三种模式下的交互与视觉契约：
- **操作栏微距图标化**：普通会话下渲染复制与 Fork，彻底移除不稳定重新生成按钮；
- **流式输出时序不变量**：流式生成过程中助手行正文下方严禁出现操作栏与完成耗时/时间戳；流式结束后（`isStreaming === false`）挂载；
- **回滚截断重发**：用户消息行点击“回滚”，提问内容回填输入框，重新发送时携带 `confirm_truncate: true` 与 `truncate_before_row_id`，物理原子抹除历史；
- **附件托盘双层缩略卡片**：用户通过 Ctrl+V 粘贴或拖拽图片/文档时，上层展示高质量微缩图与右上角移除按钮，下层清晰标注逻辑标号（如 `Image 1`, `Doc 1`）与原文件名；
- **斜杠指令与智能引用**：键入 `/` 唤出斜杠命令悬浮面板，键入 `@` 唤出分流智能引用面板（Bot 工位禁用 `@agent`，群聊展示群成员与 `@all`）。

---

## 2. 物理验证时序与驱动步骤 (CDP Verification Pipeline)
1. **输入舱几何约束**：驱动真实 Blink 浏览器读取 `.input-dock-container` 计算样式，断言 `max-width: 740px`；
2. **操作栏纯粹性**：检查助手行操作栏，断言 `[data-action="copy-msg"]` 与 `[data-action="fork-msg"]` 存在且无内联标签文本，断言 `[data-action="regenerate-msg"]` 严格不存在；
3. **回滚回填**：物理点击 `[data-action="rollback-msg"]`，断言 `#dock-prompt-input` 真实获得焦点且文本内容回填；
4. **附件双层卡片**：注入图片与文档附件，断言渲染出 `.composer-attachment-card`，断言上层微缩图与下层 `Image 1`、`Doc 1` 标签存在；
5. **斜杠 Popper 唤出**：在输入框键入 `/` 并派发 `input` 事件，断言 `.composer-slash-popper` 出现并渲染推荐命令；
6. **物理截图与度量留证**：调用 CDP `Page.captureScreenshot` 捕获当前视口存盘。

---

## 3. 核心不变量与防退化规则 (Invariants & Regression Defense)
- **Gate 0 架构单向性**：附件降采样和 DOM 处理在 UI/桌面层，Core 保持无界纯逻辑；
- **Gate 4 换肤与 i18n**：卡片与 Popper 100% 消费 Design Tokens，提示文案走 `t()` 字典；
- **Anti-Slop Ratchet**：全流程零 `any`，严格类型声明；
- **Failure Is Not Empty**：回滚截断和附件挂载失败显式抛错或给出明确 Dock 通知。

---

## 4. 产物与测试证据 (Artifacts)
- 截图：`artifacts/verification/interactive-chat-stage/screenshot.png`
- 结构化数据：`artifacts/verification/interactive-chat-stage/evidence.json`
