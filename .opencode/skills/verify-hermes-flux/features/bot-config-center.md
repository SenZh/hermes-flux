# BOT config center

设置 › BOT 是专职数字员工的唯一配置中枢：顶部 5 槽位头像滑动选择器换人，下方单列编辑基础身份、绑定模型、SOUL.md 与能力矩阵（Toolsets / Skill / MCP），底部保存或重置。所有修改先落壳层草稿池，保存时才写网关；网关照段返回是否真的写入，界面据此决定"成功 / 部分未写 / 需要二次确认"。

## Sub-features

- `hero-carousel`: 固定 5 个槽位，近大远小，滚轮 / 拖拽 / 左右按钮 / 方向键切换，松手吸附后才取详情。
- `basic-identity`: BOT ID 只读可复制；显示名称与职能描述可编辑。
- `model-binding`: 模型下拉按 Provider 分组（`optgroup`），当前模型回显；目录里没有当前模型时置顶标注「[离线/不可用]」且保持选中，绝不静默清空。
- `soul-editor`: 折叠抽屉（Grid `0fr → 1fr`），等宽编辑器、实时字节计数、超 64KB 红色警告，四个胶囊在光标处插入变量 / 模板。
- `capability-matrix`: Toolsets / Skill / MCP 三个折叠区逐项开关；整行可点（label 关联 Switch），非权威清单只读。
- `mcp-status`: 已连接 / 未连接 / 状态未知三态；探活没有结论时必须显示「状态未知」，不画红灯。
- `long-term-memory`: 只读说明卡片，没有任何编辑入口。
- `draft-pool`: 改动实时进壳层草稿池，改回原值自动清脏点，中心头像亮橙点；关闭设置再进入草稿仍在。
- `save-guard`: 逐段核对网关 `applied`；缺段报「部分未写入」并列业务段名；`confirm_required` 走独立确认横幅，只有「仍然保存」才带 `confirm_expensive_model`。
- `failure-keep`: 任何失败都保留草稿并挂错误横幅，绝不回滚表单。

## How to get to it (user POV)

- 顶栏齿轮 / `Ctrl+,` 打开设置，左栏选「BOT」。
- 左轨右键某个 BOT 的「查看/编辑档案」直接打开该 BOT 的配置。
- 顶部头像直接拖拽或滚轮滑动换人；点中心头像上的相机遮罩可换头像。
- 各折叠区点标题展开；改任何字段后底部「保存配置」启用。

## Driving it with control-flux

Preconditions: `npm run build` is fresh, `node scripts/verify/control-flux.mjs doctor` passes. No gateway needed（验证注入权威快照，走真实渲染路径）。

1. Run `node scripts/verify/control-flux.mjs run bot-config-center`.
   Observable: `[data-bot-carousel]` exists and `[data-bot-slot]` count is exactly 5.
2. Read the carousel and basic fields.
   Observable: 至少 4 种不同 `transform`；视口高度 148px；`#bot-id` / `#bot-display-name` / `#bot-description` 齐全；无横向溢出。
3. Read the model select.
   Observable: `#bot-model` 的 value 等于详情里的 model；`optgroup` 数量 ≥ 1（按 Provider 分组）。
4. Read every `[data-bot-section]` before expanding.
   Observable: 每个折叠按钮都有 `aria-controls`，且 `aria-expanded="false"`（design §7.2 默认收起）。
5. Click each `[data-bot-section=...] > button[aria-expanded]` and wait ~400ms.
   Observable: `aria-expanded="true"`；对应 `div.grid` 的 `gridTemplateRows` 脱离 `0px`；内容 `visibility: visible`。
6. Click `[data-bot-capability=browser]`.
   Observable: `window.__fluxState.botDrafts.arch.enabledToolsets` 含 `browser`；保存按钮变为可点。
7. Click the「重置」button.
   Observable: `Object.keys(window.__fluxState.botDrafts).length === 0`。
8. Read the MCP section text.
   Observable: 同时出现「已连接」与「状态未知」；不出现「未连接」；区域内没有红色文字。

## Gotchas

- 能力行整行可点依赖 `<label htmlFor>` 关联 Switch；把行改回 `div` 会静默退回"只有行尾能点"。
- 非权威清单（`authoritative: false`）的开关必须 `disabled`：把它当权威写回会用"读取缺口"覆盖用户真实配置。
- 保存判定必须走 core 的 `evaluateBotConfigureOutcome`，不能在壳层自己读 `result.ok`：网关实测会 `ok:true` 只写一段，也会 `ok:false` 却带 `applied:true`。
- `disabled_skills` 在网关 `applied` 里叫 `skills`；用入参名对账会永远判定"未写入"。
- 内置技能 `hermes-agent` 禁用无效（网关返回成功但读回仍启用），不要在客户端伪造成功提示。
- 折叠过渡是 120ms 展开 / 200ms 收起；点击后立即测量会读到过渡起始帧的 `0px`。
