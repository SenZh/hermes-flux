# BOT 配置中枢：实现修正与分期记录 (Implementation Notes)

- **关联需求**：[`requirements.md`](requirements.md) v2.3.0
- **关联设计**：[`design.md`](design.md) v2.2.0
- **交互规范**：[`ui-interaction-spec.md`](ui-interaction-spec.md) v6.0.0
- **本文性质**：实现阶段对设计文档的**修正记录**。凡与 design.md 冲突处，以本文与已落地代码为准，后续把修正回灌进设计文档。

---

## 一、分期边界（先框架，后能力）

### 第一期（已完成）

只交付「框架 + 基本信息 + 头像」：

1. 设置中心 `agents` 分区更名 BOT，替换只读列表；
2. 5 槽位头像滑动选择器（148px、近大远小、滚轮/拖拽/键盘、N<5 退化）；
3. 基础信息单列：BOT ID（只读+复制）、显示名称、职能描述；
4. 头像：中心头像悬停更换、客户端 256×256 WebP 裁剪、恢复默认头像；
5. 草稿池、未保存标记、重置、保存（`profiles.configure` + `profiles.set_asset`）；
6. 列表加载、空态、错误态、详情加载态。

**明确不做**：模型绑定、SOUL.md、Toolsets/Skill/MCP、长期记忆说明、新建/克隆向导、宿主级离场拦截、`beforeunload`。这些入口在第一期不渲染半成品，不出现假可用按钮。

### 第二期（已完成）

模型绑定、SOUL.md 编辑器与模板、能力矩阵（Toolsets/Skill/MCP 探活）、长期记忆说明、逐段 `applied` 校验、快照收敛（`activeDraft`）。

### 第三期（未开始）

新建/克隆向导（含两步创建事务）、宿主级离场拦截（含多入口统一）、`beforeunload` 与主进程配合、默认 BOT 唯一性语义。

---

## 二、设计审查的 P0 处置

| 编号 | 问题 | 处置 | 落地位置 |
|---|---|---|---|
| P0-1 | `confirm_host_exit.pendingAction: () => void` 进入快照，`JSON.stringify` 静默丢函数导致渲染指纹失明 | 状态机只保留纯数据；待执行动作由壳层闭包持有，快照用 `exitPrompt.target` 表达 | `core/profile/botManagement.ts` 的 `BotManagementStatus`；`ui/.../settingsModel.ts` 的 `BotExitTarget` |
| P0-2 | 能力清单无「权威性」判据，缺字段时保存 `[]` 会清空用户配置 | 每类清单引入 `authoritative`；非权威清单一律不提交对应字段；`describeBot` 保留 `enabled/label/tool_count` | `core/profile/botManagement.ts` 的 `BotCapabilityList`、`parseBotDetail`、`buildBotConfigureParams`；`ProfileService.describeBot` |
| P0-3 | 创建带 `display_name`（契约无此字段）；ID 正则两处冲突 | 统一 `BOT_ID_PATTERN=/^[a-zA-Z0-9_-]{1,64}$/`；创建改为 `profiles.create` → 成功后 `profiles.configure(ui_meta.title)` 两步，第二步失败单独报「已创建但显示名未写入」 | 第三期实现；`core/profile/botManagement.ts` 的 `validateBotId` |
| P0-4 | 默认 BOT 无唯一性，`default` 顶层 `is_default` 恒真，徽章不会转移 | 归一化已能读回 `ui_meta['hermes-bots'].is_default`，并允许显式 false 取消内置默认；唯一性语义在第三期二选一落地（客户端偏好或跨 profile 清除） | `core/rpc/profileNormalize.ts`；第三期决策 |
| P0-5 | 草稿池归 UI 组件，设置关闭即销毁，「保存草稿并离开」不可达 | 草稿池上提 renderer `state.botDrafts`，跨设置挂载存活；UI 只消费快照 | `desktop/src/renderer/index.ts`；`settingsModel.ts` 的 `BotManagementView.drafts` |

## 三、P1 处置

| 编号 | 问题 | 处置 |
|---|---|---|
| P1-1 | 全量草稿进快照，每次 render JSON.stringify | **第二期已处置**：快照收敛为 `activeDraft`（仅当前 BOT）；其它 BOT 的脏标记由 `roster[].hasDraft` 表达，不再额外维护 `dirtyBotIds`（与 `hasDraft` 重复属双真值） |
| P1-2 | `ui_meta` 合并缺数据源，改名会抹掉 `is_default` 与群聊房间 | `SettingsProfileRow.uiMeta` 由 `loadProfiles` 填充；保存走 `mergeBotUiMeta` 保留其它键 |
| P1-3 | `ok:true` 不等于全部写入，守卫模型会静默不写 | **第二期已处置**：`evaluateBotConfigureOutcome` 逐段核对 `applied`（入参名已折算成 `applied` 段名）；缺段报 `partial` 并保留草稿；`confirm_required` 走独立确认横幅，「仍然保存」才带 `confirm_expensive_model` |
| P1-4 | `availableModels` 与 `providerViews` 双真值 | **第二期已处置**：`availableModels` 在 snapshot 层由 `state.settingsProviderViews` 现算派生，不新增第二份存储；进入 `agents` 分区时补装载 provider 目录；未就绪 provider 不进下拉，当前模型离线时置顶占位 |
| P1-5 | 头像缺 `hasAvatar` 门控与保存后缓存同步 | 预取条件改 `hasAvatar && !avatar`；保存/清除后同步 `profileAvatarCache` 与 `state.profiles`，花名册头像只认 `AgentProfile.avatar` |
| P1-6 | 布局与双 Esc 入口 | 第一期只改右侧内容容器（`agents` 分区不套 `px-6 py-4 overflow-y-auto`）；第三期统一 `requestClose/requestSection` 并覆盖 `Esc`、Backdrop、关闭按钮、切 Tab、全局 Esc、`Ctrl+,` |
| P1-7 | 缺 `loading_detail` / `detail_error`，切 BOT 会显示上一个人的详情 | core 状态机已包含；`loading_detail` 禁用保存，`detail_error` 清空 `activeDetail` 并给重试 |
| P1-8 | 旧编辑器迁移遗漏 | 第一期删除 `AgentProfileEditorModal` 与 renderer 全部接线；`bot-edit` 改为打开设置 BOT 面板并选中；3 处测试改造为对新面板的断言 |
| P1-9 | `botRoster()` 空列表伪造 1 个 BOT | BOT 面板不复用 `bots`/`botRoster()`，花名册只认 `botManagement.status` 与 `settingsProfiles` |
| P1-10 | 能力矩阵无探活，MCP 状态只能靠 describe | **第二期已处置**：`selectBot` 完成后由 `enrichCapabilities` 并发拉 `mcp.servers.status` 与（非权威时）`skills.manage`；探活失败 `online` 保持 `undefined`，界面显示「状态未知」 |
| P1-11 | 工具集 label 里的 emoji 会混进正文 | **第二期已处置**：`parseCapabilityList` 剥离前导装饰 emoji（纯 emoji 标签保留原值） |
| P1-12 | 部分写入/确认没有专门的界面出口 | **第二期已处置**：`confirmPending` 独立横幅（区分于错误横幅），`bot.savePartial` 用 `bot.segment.*` 列业务段名 |

## 四、与设计文档的已知差异

1. **状态机**：design.md §2 的 `slot_lerping` / `editing` / `confirm_host_exit` 不再作为独立快照状态使用；实际状态见 `BotManagementStatus`。脏状态由草稿池表达，不再塞进状态机。
2. **草稿池**：design.md §1/§7.1 的「UI 组件内 Map」改为壳层 `state.botDrafts`，理由见 P0-5；快照只暴露当前 BOT 的 `activeDraft`（P1-1）。
3. **能力清单**：design.md §2 的裸数组改为 `BotCapabilityList { authoritative, rows }`。
4. **默认 BOT**：第一期只写/读 `ui_meta['hermes-bots'].is_default`，不承诺跨 profile 唯一；唯一性在第三期定案。
5. **模型目录**：第一期不渲染模型下拉；第二期由 `state.settingsProviderViews` 派生 `availableModels`（snapshot 现算，非第二份存储）。
6. **离场拦截**：第一期不实现；第三期起所有入口统一走壳层请求函数。

## 五、第二期实现事实（真实网关 0.23.1 校准）

1. **`applied` 键名与入参不同**：`disabled_skills → skills`、`enabled_toolsets → toolsets`、`enabled_mcp_servers → mcp_servers`。对账必须折算，否则永远判定"未写入"。
2. **`ok:true` 可能只写了一部分**（实测只回 `applied.description`）；**`ok:false` 也可能带 `applied:true`**（清空 `ui_meta`）。判定顺序必须是：`confirm_required` → `ok !== true` → 逐段核对。
3. **`hermes-agent` 内置技能禁用无效**：`applied.skills=true` 但读回仍启用。界面不伪造成功，也不会报错；工作区技能的禁止正常生效（已实测 `github`）。
4. **`mcp.servers.status` 行字段是 `tools`**（不是 `tool_count`），`connected` 才是探活结论；`MergeMcpStatus` 同时兼容两者。
5. **`mcp_servers: []` 是权威空清单**（确实没配），不是读取缺口；`authoritative` 仅在字段缺失/非数组时为 false。
6. **`ui_meta` 是整块替换**：传 `{}` 即清空；改名必须带 `mergeBotUiMeta` 合并后的完整对象。
7. **工具集 label 带装饰 emoji**，已在 core 剥离，避免正文混图标破坏排版基线。
