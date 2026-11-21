# BOT config center

设置 › BOT 是专职数字员工的唯一配置中枢：左侧是默认展开的 **204px BOT 列表**（带标题、搜索框、36px 物理正圆头像、名称与可读模型副标题），可点击底部 `PanelLeftClose`/`PanelLeftOpen` 开关按需收起到 64px 纯头像微轨（收起态头像仍保持 36px 正圆，悬停走自定义 `Tooltip` 展示轻名片）；右侧主区采用去框紧凑身份头、**扁平 5 项一级菜单**（`基本信息` / `角色设定` / `工具` / `技能` / `MCP`，菜单项零数字徽标）与按需浮起的底部胶囊保存条。所有修改先落壳层草稿池，保存时才写网关；网关照段返回 `applied`，界面据此决定"成功 / 部分未写 / 需要二次确认"。

## Sub-features

- `bot-roster-rail`: 默认展开 204px BOT 列表（带搜索筛选、`36×36` `shrink-0 aspect-square rounded-full` 零外圈头像、默认徽标、草稿点与模型短名），可点击底部 `PanelLeftClose`/`PanelLeftOpen`（无方向箭头）收起至 64px 微轨；GPU 垂直磁吸滑块 + 4px 主色调指示条；支持 `ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight` 键盘切换。
- `basic-identity`: 去框紧凑身份头集成 `48×48` 正圆头像悬停更换、条件重置图标、只读 ID 与一键复制按钮、当前模型名及工作区默认 BOT 开关；`基本信息` Tab 管理显示名称、绑定模型与职能描述。
- `model-binding`: 模型下拉使用 `Select` 原语按 Provider 分组并带厂商图标，当前模型回显；目录里没有当前模型时置顶标注「[离线/不可用]」且保持选中，绝不静默清空。
- `soul-studio`: Studio 级 `SOUL.md` 编辑器，集成同步行号槽、等宽代码框、超细自适应滚动条（`scrollbar-thin`）、幽灵快捷变量与 Radix `<Menu>` 预置模板菜单、实时行数与 64KB 进度条（超限红色警示）。
- `flat-capability-tabs`: `工具` / `技能` / `MCP` 直接作为一级扁平菜单（无「能力矩阵」嵌套层、菜单名不带数字徽标），每页内置即时搜索、状态胶囊筛选（全部 / 已启用 / 未启用）与高密度双列微距开关行（`<label htmlFor>` 与行外操作插槽物理隔离）；非权威清单只读。
- `mcp-and-skills-admin`: `MCP` 页提供 `+ 新增 MCP` 弹窗（预设目录 `mcp.catalog` + 自定义 `stdio`/`http` + Bearer Token 校验、`mcp.servers.add`）、行内探活（`mcp.servers.test`）与共享 `<McpRemoveConfirmDialog>` 二次确认删除（`mcp.servers.remove`）；`技能` 页提供 `+ 安装技能` 弹窗（`skills.manage` browse/search/install + `skills.reload`）。与「设置 › 扩展」共用弹窗组件。
- `long-term-memory`: 直接可见的只读信息卡（`Surface`），带隔离徽标，没有任何编辑入口。
- `draft-pool`: 改动实时进壳层草稿池，改回原值自动清脏点；仅在有未保存修改时底部浮起胶囊保存条，平常不占位。

## Driving it with control-flux

Preconditions: `npm run build` is fresh, `node scripts/verify/control-flux.mjs doctor` passes. No gateway needed.

1. Run `node scripts/verify/control-flux.mjs run bot-config-center`.
   Observable: `[data-bot-carousel]` 初始处于展开态（`data-bot-rail-expanded="true"`，宽度 `>= 196px`），`[data-bot-rail-filter="true"]` 可见且搜索过滤生效；点击底部 `[data-bot-rail-toggle="true"]` 可收起到 `~64px` 并为头像挂载 `Tooltip` 轻名片，再点击恢复展开。
2. Check 5 flat tabs (zero numbers) and basic fields.
   Observable: `[data-bot-tab]` 为 5 项（`basic/soul/toolsets/skills/mcp`）且均不含数字；`36×36`/`48×48` 头像 1:1 无裁切无 `ring`；`#bot-id` / `#bot-display-name` / `#bot-model` / `#bot-description` 齐全。
3. Switch flat tabs (`soul` / `toolsets` / `mcp`) & capability interactions.
   Observable: `#bot-soul` 可见；`[data-bot-cap-search="toolsets"]` 搜索过滤正常；开关 `[data-bot-capability=browser]` 写入草稿且悬浮保存条浮起；重置清空草稿；`mcp` 页展示「已连接」与「状态未知」（零红色文字）并可打开/关闭 `[data-mcp-add-dialog="true"]`。
4. Click `[data-bot-id="default"]`, dispatch `ArrowDown`, wait 250ms, then inject `list_error`.
   Observable: `list_error` 原样透出且卸载花名册与表单。
