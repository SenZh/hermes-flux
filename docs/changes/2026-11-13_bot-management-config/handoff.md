# BOT 配置中枢：上下文交接文档 (Handoff)

- **日期**：2026-11-13
- **分支**：`feat/bot-management-config`
- **设计基线**：[`requirements.md`](requirements.md) v2.3.0、[`design.md`](design.md) v2.2.0、[`ui-interaction-spec.md`](ui-interaction-spec.md) v6.0.0
- **实现修正记录**：[`implementation-notes.md`](implementation-notes.md)
- **当前状态**：第一、二期已交付并通过全量验证（含真实网关 0.23.1 实机回归）；第三期未开始。工作区有大量未提交改动，**不要 reset 或覆盖**。

---

## 一、目标与分期

目标是把设置中心「BOT」分区做成完整配置中枢：花名册、基础身份、头像、模型绑定、SOUL.md、能力矩阵（Toolsets / Skill / MCP）、新建/克隆向导、宿主级离场拦截。

已确定的三期边界：

1. **第一期（已完成）**：框架 + 基础信息（BOT ID / 显示名 / 职能描述）+ 头像更换/恢复 + 草稿池 + 保存/重置 + 加载/空/错误态。
2. **第二期（已完成）**：模型绑定、SOUL.md、能力矩阵（Toolsets / Skill / MCP 探活）、长期记忆说明、逐段 `applied` 校验、快照收敛。
3. **第三期**：新建/克隆向导（两步创建事务）、宿主级离场拦截、默认 BOT 唯一性、`beforeunload` 与主进程配合。

---

## 二、第一期已完成内容

### 用户可见行为

- 设置中心左侧导航显示「BOT / Bots」，`agents` 分区不再是只读列表。
- 顶部 148px 头像滑动选择器，固定 5 个 DOM 槽位，中间 76px、两侧约 58px、最外侧约 40px，透明度下限 0.55。
- 滚轮、拖拽、左右 44×44 按钮、键盘方向键切换；松手吸附；数量 ≥5 环形，<5 平铺且不重复克隆。
- 中心头像悬停出现更换遮罩，选择图片后在客户端居中裁剪为 256×256 WebP；工具条「恢复默认头像」走 `profiles.set_asset({ clear: true })`。
- 基础信息单列：BOT ID 只读 + 复制、显示名称、职能描述。
- 草稿实时写入壳层草稿池；改回原值自动清脏点；有草稿时中心头像显示橙点；关闭设置再进入草稿仍在。
- 保存期间锁输入并显示「正在保存...」；失败保留草稿并挂失败横幅；保存成功后本地投影详情并同步头像缓存。
- 加载骨架、空花名册引导、列表错误重试、详情错误重试。
- 旧内联编辑器 `AgentProfileEditorModal` 已删除；右键「查看/编辑档案」改为打开设置 BOT 面板并选中目标。

### 核心文件

| 文件 | 职责 |
|---|---|
| `packages/core/src/profile/botManagement.ts` | 纯领域模型：`BotManagementStatus`、`BotDetailData`、`BotDraftState`、`parseBotDetail`、`draftFromDetail`、`isBotDraftDirty`、`buildBotConfigureParams`、`applyDraftToDetail`、`validateBotId`、`mergeBotUiMeta`、`mergeMcpStatus`、`mergeSkillInventory` |
| `packages/core/src/profile/profileService.ts` | 新增 `describeBot`、`configureBot`；`configureProfile` 支持 provider / ui_meta / 能力矩阵；`setAsset` 支持 `clear` |
| `packages/core/src/rpc/types.ts` | 对齐真实 `profiles.describe` / `create` / `configure` / `set_asset` 契约 |
| `packages/core/src/rpc/profileNormalize.ts` | `isDefault` 读回 `ui_meta['hermes-bots'].is_default`，显式 false 可取消内置 default 的隐含默认 |
| `packages/ui/src/components-react/settings/BotHeroCarousel.tsx` | 5 槽位选择器、rAF 休眠、滚轮/拖拽、近大远小 |
| `packages/ui/src/components-react/settings/BotManagerView.tsx` | 第一期面板：选择器、工具条、基础信息、保存/重置、状态分流 |
| `packages/ui/src/components-react/settings/settingsModel.ts` | `BotManagementView`、`BotRosterEntry`、`BotModelOption`、`BotWizardView`、`BotExitTarget` 与新增 `SettingsActions` |
| `packages/ui/src/utils/cropAvatar.ts` | 头像 256×256 WebP 居中裁剪，≤2MB / `image/*` 校验 |
| `packages/desktop/src/renderer/botManagementController.ts` | 花名册加载、160ms 详情防抖、令牌丢弃、草稿、保存、头像缓存回调 |
| `packages/desktop/src/renderer/settingsController.ts` | `SettingsProfileRow` 增加 `avatar` / `hasAvatar` / `uiMeta` |
| `packages/desktop/src/renderer/index.ts` | 状态、快照、动作、打开 BOT 面板、旧编辑器接线清理 |
| `scripts/verify/bot-panel-visual.mjs` | 真实 Chrome 渲染 BOT 面板，输出暗/亮截图 |

### 数据形状要点

```ts
type BotManagementStatus =
  | { status: 'uninitialized' }
  | { status: 'fetching_list' }
  | { status: 'list_error'; message: string }
  | { status: 'empty_list' }
  | { status: 'idle'; activeBotId: string }
  | { status: 'loading_detail'; activeBotId: string }
  | { status: 'detail_error'; activeBotId: string; message: string }
  | { status: 'editing'; activeBotId: string }
  | { status: 'saving'; activeBotId: string };
```

- `BotDetailData.skills / toolsets / mcpServers` 都是 `BotCapabilityList { authoritative: boolean; rows: BotCapabilityRow[] }`。
- **保存规则**：只有 `authoritative === true` 的能力清单才允许写入 `disabled_skills` / `enabled_toolsets` / `enabled_mcp_servers`；非权威清单省略字段，避免把读取缺口写成空配置。
- `BotDraftState.avatar` 是判别联合：`unchanged | replace(dataUrl) | clear`。
- `BotManagementView.exitPrompt` 是纯数据 `{ target: BotExitTarget } | null`；**禁止把函数放进快照**，renderer 用 `JSON.stringify(snapshot)` 做渲染指纹。

---

## 三、验证状态

- `npm run typecheck`：通过。
- `npm run gates:changed`：新增违规 0；存量债务 46 条未变化。
- `npm test`：1942 项，1939 通过，0 失败，3 跳过。
- `npm run verify:formal`：46 项全通过。
- `npm run contract:doc:check`：11 个契约文档与契约/探针数据一致（本期新增调用点后已重生成）。
- 相关 130 项测试：`packages/core/__tests__/profile/botManagement.test.mjs`（26 项）、`packages/core/__tests__/profile/profileNormalize.test.mjs`、`packages/desktop/__tests__/unit/bot-management-controller.test.mjs`（23 项）、`packages/ui/__tests__/settings-modal.test.mjs`、`packages/ui/__tests__/components/p0-p1-features.test.mjs`、`packages/ui/__tests__/primitives-consumption.test.mjs` 全部通过。
- 静态真实渲染：`npm run verify:bot-panel` 通过；断言 5 槽位、5 种独立 transform、视口 148px、模型下拉按 Provider 分组、SOUL 抽屉展开、8 个能力开关、无横向溢出。截图：
  - `artifacts/verification/bot-panel-dark.png` / `bot-panel-dark-soul.png` / `bot-panel-dark-capabilities.png`
  - `artifacts/verification/bot-panel-light.png` / `bot-panel-light-soul.png` / `bot-panel-light-capabilities.png`
- 真实 Blink 端到端：`node scripts/verify/control-flux.mjs run bot-config-center` 通过；断言 5 槽位、148px、模型回显、5 个折叠区默认收起且点击后 `grid-template-rows` 脱离 `0px`、能力开关真实写入草稿池、重置清空草稿、MCP 同时显示「已连接 / 状态未知」且无红色，并含一条**负向注入**（注入 `list_error` 后必须画错误原文 + 重试，且不得继续渲染花名册/表单/保存按钮）。证据 `artifacts/verification/bot-config-center/{screenshot.png,evidence.json}`。
- **真实网关实测（0.23.1，本地自建网关，连接信息不入库）**：
  - `npm run verify:bot-panel:live`：真实 `profiles.list` / `profiles.describe` / `skills.manage` / `mcp.servers.status` / `model.options` 喂进真实组件渲染；断言模型回显、SOUL 2940 字节完整渲染、22 个能力开关、标签 emoji 0 个、无横向溢出。截图 `artifacts/verification/bot-panel-live-{dark,light}.png`。
  - `npm run verify:bot-config:live`：真实写链路闭环（仅作用于 `flux-probe-bot`，结束恢复）。断言 `buildBotConfigureParams → profiles.configure → applied 逐段为 true → describe 读回一致 → set_asset 上传/读回/clear → 恢复`；模型保持不变。

---

## 四、真实网关实测结论（契约校准，必须遵守）

实测网关 `0.23.1`，以下都是跑出来的事实，不是推断：

1. **`applied` 是对象，键名与入参不同**：`disabled_skills → applied.skills`、`enabled_toolsets → applied.toolsets`、`enabled_mcp_servers → applied.mcp_servers`。用入参名对账会把"已写入"误判成"没写入"。`evaluateBotConfigureOutcome` 已做折算。
2. **`ok:true` 不等于全部写入**：实测只回 `applied.description`，其余段静默未写。必须逐段核对，缺段报 `partial` 并保留草稿。
3. **`ok:false` 可能带 `applied:true`**：清空 `ui_meta` 时 `ok:false` 但 `applied.ui_meta=true`。判定必须以 `ok` 为准，`applied` 不能覆盖它。
4. **`hermes-agent` 是内置技能，禁用无效**：`applied.skills=true` 但读回仍 `enabled:true`。界面上禁用它不会报错也不会生效——这是网关行为，不要试图在客户端伪造。
5. **`mcp.servers.status` 的行字段是 `tools`，不是 `tool_count`**，且 `connected` 才是探活结论。`mergeMcpStatus` 已兼容两者。
6. **`profiles.describe` 的 `mcp_servers` 为空数组表示"确实没配"**，是权威空清单，不是读取缺口；`authoritative` 只在字段缺失/非数组时为 false。
7. **工具集 `label` 带装饰 emoji**（如 `🔍 Web Search & Scraping`），已在 `parseBotDetail` 剥离，避免正文混图标。
8. **`profiles.configure` 的 `ui_meta` 是整块替换**：传 `{}` 会清空。改名必须带 `mergeBotUiMeta` 合并后的完整对象（已实现）。

---

## 五、第二期已完成内容

### 用户可见行为

- **模型绑定**：`agent` 分区下拉按 Provider 分组；当前模型不在目录时置顶显示「[离线/不可用]」并保持选中；目录整体不可用时给显式说明而不是空下拉。
- **SOUL.md**：折叠抽屉（CSS Grid `0fr → 1fr`，展开 180ms / 收起 120ms），等宽编辑器、实时字节计数、超 64KB 红色警告（软拦截不阻断），四个胶囊：插入用户名 / 插入工作区路径 / 架构师模板 / 审查员模板（在光标处插入）。
- **能力矩阵**：工具能力 / Skill / MCP 三个折叠区逐项开关；非权威清单显示只读提示且开关禁用；MCP 显示连接态与工具数，探活无结论时显示「状态未知」。
- **长期记忆**：只做说明卡片，无任何编辑入口。
- **二次确认**：网关回 `confirm_required` 时挂独立的确认横幅（不是错误横幅），原样透出网关文案，提供「仍然保存 / 暂不保存」，草稿保留。
- **部分写入**：缺段时挂失败横幅并列出未写入的业务段名（职能描述 / SOUL.md / 模型绑定 / Skill / 工具能力 / MCP / 显示名），草稿保留。

### 核心文件（第二期增量）

| 文件 | 职责 |
|---|---|
| `packages/core/src/profile/botManagement.ts` | 新增 `BotConfigureSegment`、`BotConfigureOutcome`、`requestedConfigureSegments`、`evaluateBotConfigureOutcome`、`projectBotRoster`；`buildBotConfigureParams` 增加 `confirmExpensive`；`parseCapabilityList` 剥离装饰 emoji 且兼容 `tool_count`/`tools`；`mergeMcpStatus` 兼容 `tools` |
| `packages/desktop/src/renderer/botManagementController.ts` | `confirmPending` 状态、`saveBot(botId, { confirmExpensive })`、`enrichCapabilities`（MCP 探活 + 技能目录补全）、`dismissError` 同时清确认横幅 |
| `packages/desktop/src/renderer/index.ts` | 快照收敛为 `activeDraft`（其它 BOT 的脏标记走 `roster[].hasDraft`，由 core 的 `projectBotRoster` 现算）、`fetchSkillInventory` / `fetchMcpStatus` 注入、`onDismissBotConfirm` 接线、进入 `agents` 时补装载 provider 目录、模型目录过滤未就绪 provider |
| `packages/ui/src/components-react/settings/BotManagerView.tsx` | 模型下拉、SOUL 抽屉、三个能力区、长期记忆卡片、确认横幅、`BotSection` / `CapabilityRow` / `CapabilitySection` |
| `packages/ui/src/components-react/settings/BotHeroCarousel.tsx` | 由整表 `drafts` 改为 `activeDraft`（配合快照收敛） |
| `packages/ui/src/components-react/settings/settingsModel.ts` | `BotManagementView` 去 `drafts` / 去 `dirtyBotIds`，加 `activeDraft` 与 `confirmPending`；`onSaveBotConfig` 增加 `confirmExpensive` |
| `packages/ui/src/i18n/index.ts` | 新增 `bot.confirmRequired` / `confirmSave` / `confirmDismiss` / `savePartial` / `segment.*` / `modelCatalogUnavailable` / `modelCatalogHint` / `toolsetToggleLabel` / `mcpToggleLabel` / `capabilityNone` |
| `scripts/verify/bot-panel-live.mjs` | 真实网关只读取数 → 真实 SSR → 真实 Blink 渲染断言 + 截图 |
| `scripts/verify/bot-config-live.mjs` | 真实网关写链路闭环验证（探针 Bot，结束恢复） |
| `.hermes/skills/verify-hermes-flux/features/bot-config-center.md` | 特征地图条目：用户入口、逐条驱动步骤与可观察结果、踩坑清单（已在 `features/README.md` 的索引与 runner ID 映射表登记） |

### 数据形状要点

```ts
type BotManagementStatus =
  | { status: 'uninitialized' }
  | { status: 'fetching_list' }
  | { status: 'list_error'; message: string }
  | { status: 'empty_list' }
  | { status: 'idle'; activeBotId: string }
  | { status: 'loading_detail'; activeBotId: string }
  | { status: 'detail_error'; activeBotId: string; message: string }
  | { status: 'editing'; activeBotId: string }
  | { status: 'saving'; activeBotId: string };
```

- `BotDetailData.skills / toolsets / mcpServers` 都是 `BotCapabilityList { authoritative: boolean; rows: BotCapabilityRow[] }`。
- **保存规则**：只有 `authoritative === true` 的能力清单才允许写入 `disabled_skills` / `enabled_toolsets` / `enabled_mcp_servers`；非权威清单省略字段，避免把读取缺口写成空配置。
- `BotDraftState.avatar` 是判别联合：`unchanged | replace(dataUrl) | clear`。
- `BotManagementView` 只带 `activeDraft?: BotDraftState`；**整表草稿池不进快照**（SOUL 64KB × 每帧 `JSON.stringify` 不可接受）。
- `BotManagementView.exitPrompt` 是纯数据 `{ target: BotExitTarget } | null`；`confirmPending` 同理只是 `{ message }`，**禁止把函数放进快照**。
- 保存结论是判别联合，不要在控制器里用布尔拼装：

```ts
type BotConfigureOutcome =
  | { ok: true }
  | { ok: false; kind: 'confirm'; message: string }
  | { ok: false; kind: 'failed'; message: string }
  | { ok: false; kind: 'partial'; missing: BotConfigureSegment[]; message: string };
```

---

## 六、必须知道的实现决策

1. **草稿池在壳层，不在 UI**：`state.botDrafts: Record<string, BotDraftState>`。`SettingsModal` 关闭时会卸载，草稿放组件内会丢，F-18「保存草稿并离开」不可达。
2. **快照只给当前草稿**：`activeDraft` + `roster[].hasDraft`。不再维护 `dirtyBotIds`（与 `hasDraft` 重复，属双真值）。
3. **能力清单有权威性**：`profiles.describe` 没返回某类清单时标 `authoritative: false`；UI 展示但不能写回。`skills.manage` 只用于非权威时补全展示项，不能推导 `disabled_skills`。
4. **保存判定只用 core 的纯函数**：控制器不得自己读 `result.ok` 或 `applied`，否则又会退化成"只看 ok"。
5. **`confirm_expensive_model` 只由确认横幅传入**：普通保存绝不能默认绕过网关守卫。
6. **创建是两步事务**（第三期）：`profiles.create` 成功后再 `profiles.configure(ui_meta.title)`；第二步失败要单独报「已创建但显示名未写入」，不能回滚成创建失败。契约没有 `display_name`。
7. **ID 正则统一**：`/^[a-zA-Z0-9_-]{1,64}$/`，以 requirements F-04 为准；design §7.3 的旧正则已废弃。
8. **默认 BOT 唯一性未解决**：内置 `default` 的顶层 `is_default` 恒真；只给目标写 `ui_meta.is_default=true` 会出现两个默认。第三期二选一：客户端偏好（localStorage）或跨 profile 清除。不要假装 AC-18 已成立。
9. **头像缓存**：`profiles.list` 只回 `has_avatar`，不回头像数据；保存/清除头像后由 `onAvatarChanged` 同步 `profileAvatarCache`、`state.profiles`、`state.settingsProfiles` 与会话 `botAvatar`。
10. **旧编辑器已删除**：`packages/ui/src/components/Bot/AgentProfileEditorModal.ts` 不存在；`packages/ui/src/index.ts` 已删导出；CDP harness 中的旧引用已清理。不要重新引入字符串模板编辑器。
11. **保存成功后必须作废在途能力补全**：`saveBot` 成功分支 `detailToken += 1`。否则保存后状态回到 `idle`，迟到的探活/目录结果会合并进刚投影的新快照，用旧数据覆盖真值。
12. **`hasDraft` 只认键存在**：`projectBotRoster` 用 `hasOwnProperty`，不用 `Boolean(drafts[name])`。壳层任何一处误写 `drafts[id] = undefined` 时，前者仍会亮脏点、后者静默失明（该分支已有变异检验用例）。
13. **两个横幅各有独立的关闭动作**：`onDismissBotError` 只清错误，`onDismissBotConfirm` 只清确认。借用对方的关闭动作会让另一个横幅永远关不掉（假可用）。
14. **同面板单一水槽基准**：BOT 面板内容一律 24px（`px-6`），与 `SettingsModal` 分区标题同线；能力行用 `-mx-2` 抵消行内边距，保证开关行文字与表单控件左边缘对齐。
15. **轮播非中心槽位不渲染 ID**：`text-micro`(10px) 经 `scale(0.52~0.76)` 后有效字号只剩 5~7.6px，是噪点不是信息。只在中心槽位显示 ID。
16. **`will-change` 只在位移期间置位**：`startLoop` 在启动时置 `transform, opacity`，稳态撤回 `auto`。常驻会让 5 个槽位永久占 5 个合成层。

---

## 七、第三期任务（下一步直接接手）

1. 新建/克隆向导：模式切换、ID 校验、重名预检、克隆源、`clone_channels`、`mirror_credentials`；创建成功后刷新花名册并选中新项。
2. 创建后补写显示名（两步事务），第二步失败单独提示。
3. 宿主级离场拦截：`Esc`、Backdrop、关闭按钮、切一级 Tab、全局 `Esc`、`Ctrl+,` 全部收敛到壳层 `requestClose / requestSection`；确认弹窗三选项「放弃修改 / 保存草稿并离开 / 留在当前」。
4. 默认 BOT 唯一性语义定案（见 §六-8）。
5. `beforeunload` 需要主进程配合，单独评估。

第三期开工前必须补齐的两处接线（第二期已铺好数据，但还没接按钮）：

- `BotManagementView.wizard` 目前是壳层给的常量空默认；向导弹窗与 `onSubmitCreateBot` 尚未实现，空态「创建首个 BOT」按钮仍为 `disabled`（禁止假可用）。
- `exitPrompt` 与 `onRegisterBotDirtyGuard` 尚未接线，`SettingsModal` 的关闭路径还没走壳层统一请求。

---

## 八、环境与命令

依赖安装注意：仓库根 `package.json` 的 workspace 包声明使用 `workspace:*`，`npm install` 会报 `EUNSUPPORTEDPROTOCOL`。当前环境是用临时 `pnpm-workspace.yaml` + `pnpm install --ignore-scripts` 安装的，临时文件已删除，`node_modules` 可用。不要把 `pnpm-workspace.yaml` 或 `pnpm-lock.yaml` 提交进仓库。

常用命令：

```bash
npm run typecheck
npm run gates:changed
npm run build:core && npm run build:ui && npm run build:desktop
npm test
npm run verify:bot-panel            # 静态真实渲染（无需网关）
```

真实网关（本地有网关时）：

```bash
# 只读取数 + 真实渲染截图
HERMES_GATEWAY_URL=... HERMES_GATEWAY_USER=... HERMES_GATEWAY_PASSWORD=... \
  npm run verify:bot-panel:live

# 写链路闭环（仅作用于 flux-probe-bot，结束恢复）
HERMES_GATEWAY_URL=... HERMES_GATEWAY_USER=... HERMES_GATEWAY_PASSWORD=... \
  npm run verify:bot-config:live
```

测试使用 `dist` 产物，改完源码先 `npm run build:core` / `build:ui` / `build:desktop` 再跑对应测试。两个 live 脚本在未设置 `HERMES_GATEWAY_URL` 时以退出码 0 跳过。

---

## 九、交接检查清单

接手后先做：

- [ ] `git status` 确认未提交改动仍在，不要 reset / checkout。
- [ ] 读 [`implementation-notes.md`](implementation-notes.md) 的 P0/P1 处置表。
- [ ] 读 `packages/core/src/profile/botManagement.ts` 的导出与注释（尤其 `evaluateBotConfigureOutcome`）。
- [ ] 读 `packages/ui/src/components-react/settings/settingsModel.ts` 的 `BotManagementView` 与 `SettingsActions`。
- [ ] 跑 `npm run typecheck`、`npm test` 与相关 127 项测试，确认基线。
- [ ] 跑 `node scripts/verify/control-flux.mjs run bot-config-center`，确认端到端驱动基线。
- [ ] 第三期先做向导与离场拦截接线，不要顺手改第二期的保存判定。
