# 设置中心重建：方案与验收 (2026-11-08)

前置评审见 [`review.md`](./review.md)。本文只写"改成什么、为什么这样改、如何证明它对"。

---

## 一、信息架构（唯一真值 = `settingsModel.ts` 的 `SETTINGS_SECTIONS`）

| 域 | 数据来源 | 为什么它在设置里 |
|---|---|---|
| **外观** | 本地：`SKINS`（5 皮肤）+ 20 套字体 + 3 档字号 + locale | 唯一每天都会碰的偏好，放第一位 |
| **模型与提供商** | `model.options { include_unconfigured: true }` | 填 API Key 的唯一入口；`model.save_key` / `model.disconnect` 落真实 `.env` |
| **数字员工** | `profiles.list` | 只读花名册 + 跳转已有编辑器（`AgentProfileEditorModal`），不重复造人设表单 |
| **扩展** | `mcp.servers.status` + `skills.manage { action: 'list' }` + `skills.reload` | 运维态观测与热重载，都是已有契约 |
| **连接** | 本地 + `gateway:authenticate` IPC | 唯一需要 IPC 而非 RPC 的域 |
| **关于** | `system:get-info`（`appVersion` / `platform`） | 真实版本号，不再硬编码 |

**被删掉的 12 个域**（`notifications` / `sessions` / `routing` / `keybindings` / `voice` / `integrations` / `tunnels` / `git` / `websearch` / `agents`(旧) / `behavior` / `usage` / `chat`）：网关没有对应契约，旧实现全部是「功能域就绪中」占位页。占位页比没有更糟——它消耗用户的点击去确认"这里什么都没有"。

每个域都对应真实能力，因此 `SETTINGS_SECTIONS` 一旦新增一项，就必须同时给出数据来源；没有来源的域进不来。

---

## 二、数据形状

### 2.1 提供商目录（`packages/core/src/models/providerDirectory.ts`）

与 `modelCatalog.ts` **刻意分开**，因为两者对同一份 `model.options` 响应有相反的可见性要求：

| | 输入舱模型选择器 | 设置页提供商列表 |
|---|---|---|
| 未认证的 provider | 丢弃（一选就失败） | **保留**（否则没有入口填密钥） |
| 全部模型被锁的 provider | 丢弃 | **保留**（用户需要看到"为什么用不了"） |
| 关注点 | 能选什么 | 有什么、缺什么、怎么补 |

`buildProviderDirectory` 的规则：

1. 只认 `providers[]`，无 `slug` 的行丢弃，`slug` 大小写不敏感去重；
2. `authenticated` 缺省视为未知但保留，只有明确 `false` 才标记未认证；
3. `availableModelCount` 扣除 `unavailable_models`，但 `free_tier_pending` 期间不扣（fail-closed 占位不是拒绝）；
4. `warning` / `key_env` / `usage.accounts` / `limit.resets_at` 原样透出；
5. 当前 provider 置顶，其余保持网关顺序。

### 2.2 四态可加载值

```ts
type SettingsLoadable<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string };
```

**这是本次最重要的结构决策。** 旧实现用一个 boolean 混住"没数据"与"加载失败"，结果网关断开时渲染一屏硬编码卡片，用户无法分辨。四态让"空"与"错"在法律上不可混淆，`LoadBoundary` 是唯一的渲染出口。

---

## 三、组件结构

```
packages/ui/src/components-react/settings/
├── settingsModel.ts    纯数据：域注册表、四态、快照与动作契约（零 React/DOM）
├── SettingsModal.tsx   唯一渲染实现
├── mount.tsx           挂载桥（复用 createShellMountUpdater）
└── index.ts            barrel
```

- **单一设置行组件 `SettingRow`**：左标签右控件的骨架只写一次，间距与字阶不会各写一套。
- **`SegmentedControl`**：字号的「小/标准/大」与语言的「中文/English」共用，先例是设计规范里的分段推杆。
- **`ProviderRow`**：内部持有密钥输入草稿，提交后立刻清空，明文不留在任何 state 里。
- **图标全量 `lucide-react` 14px 描边**，与 `Titlebar` / `LeftRail` 同一语言；旧实现的 emoji（`⚙ 🎨 💬 ⬡ ✦`）全部删除。
- **Token 纯净**：颜色只用 `bg-popover` / `bg-sidebar` / `bg-card-active` / `border-border-subtle` / `text-muted-foreground` 等语义类；皮肤色块用 `style={{ background: skin.slots['--background'] }}` 读真值表，不写死色值。
- **关闭即卸载**：`if (!snapshot.isOpen) return null`，不保留隐藏壳，不空耗合成器。

---

## 四、接线

### 4.1 挂载

`packages/desktop/src/renderer/index.ts`：

- 骨架新增 `<div id="react-settings-host" style="display: contents;">`，**常驻不被覆写**；
- `syncReactSettings()` 每帧算快照 JSON 指纹，**内容不变就不推 React**（流式输出期间设置树零重渲染）；
- 旧的 `modalRoot.outerHTML = nextModalHtml`（每帧重建整个弹窗）删除；
- 旧的字幕式 DOM 绑定（`settings-tab-btn` / `settings-theme-btn` / `settings-font-select` / `btn-settings-save-connect` 等 183 行）整段删除。

### 4.2 真实副作用

| 动作 | 落点 |
|---|---|
| 换肤 | `resolveSkinId` → `state.theme` + `localStorage` + `data-theme` |
| 字体/字号 | `saveFontPreferences` + `applyFontPreferences`（写 `:root`） |
| 语言 | `setLocale()` → i18n 单例 + `localStorage` + `document.documentElement.lang` |
| 保存密钥 | `model.save_key` → `reload.env` → 重拉提供商 → 刷新模型目录 |
| 断开提供商 | `model.disconnect` → 重拉 |
| 技能重扫 | `skills.reload` → 重拉 MCP/技能 |
| 连接网关 | 落 state + localStorage → `connect()`（真实 IPC `gateway:authenticate`） |
| 打开员工 | 关设置 → 打开既有 `AgentProfileEditorModal` |

**语言是真修好了**：旧实现 `state.lang` 从未写回，`setLocale()` 全仓仅测试调用，语言按钮零绑定。现在启动时 `syncLocale()` 一次，切换时再次 `syncLocale()`，全站文案跟着变。

### 4.3 快捷键

`Ctrl/Cmd + ,` 呼出（设计规范里承诺但一直没实现），`Esc` 关闭（组件内监听，与 renderer 全局监听并存不冲突）。

---

## 五、顺手修掉的皮肤缺陷

设置页的主按钮暴露了一个**真实的皮肤 Token 缺陷**：`--primary-foreground`（按钮文字）从 `--accent-text`（链接强调色文字）错误提取，导致三套皮肤的主动作按钮对比度只有 1.15 ~ 1.43:1——按钮上的字几乎看不见。

| 皮肤 | 修复前 | 修复后 |
|---|---|---|
| obsidian-gold | 19.15 | 19.15 |
| jade-white | 5.30 | 5.30 |
| warm-paper | **1.30** | 5.17 |
| ayu-light | **1.15** | 7.05 |
| cyber-matrix | **1.43** | 12.45 |

改动只落在 `SKINS` 真值表三行，`styles.css` 由 `emit-skins.mjs --emit` 再生成（`--check` 已通过）。新增 `skin-contrast.test.mjs` 守卫：任一皮肤低于 WCAG AA 4.5:1 立刻变红。

---

## 六、验收矩阵

| 层 | 测试文件 | 断言要点 |
|---|---|---|
| 纯逻辑 | `packages/core/__tests__/models/providerDirectory.test.mjs` | 未配置 provider 保留、计数口径、pending 不扣减、去重与置顶、账号池、MCP/技能投影、`<more:N>` 过滤、字段缺省与透传、非法输入 |
| 日志安全 | `packages/core/__tests__/log/redact.test.mjs` | snake_case / camelCase 凭据键、数组与嵌套、循环引用、不修改入参、`extraKeys` |
| 日志接线 | `packages/core/__tests__/log/rpc-log-redaction.test.mjs` | 真实 `addLogSink` 捕获：`rpc call` / `contract violation` / `mcp.servers.set_api_key` 三条路径均无明文 |
| 编排行为 | `packages/desktop/__tests__/unit/settings-controller.test.mjs` | 未连接、失败透传、畸形 payload、后发先至令牌、`reload.env` 降级、保存失败不整表替换、busy 深度（非对称并发）、幂等/force、单边失败、元素级畸变 |
| 组件渲染 | `packages/ui/__tests__/settings-modal.test.mjs` | 关闭渲染空 DOM、6 个真实域、零竞品域、零 emoji、皮肤互斥、提供商三态、连接表单、扩展页、语言切换真实生效、检索过滤、行级状态机（成功清空/失败保留/取消不报错） |
| 皮肤 | `packages/ui/__tests__/skin-contrast.test.mjs` | 5 套皮肤 × 8 个表面 muted 全部 ≥4.5:1；主按钮 ≥4.5:1；皮肤数量防退化 |
| 接线守卫 | `packages/desktop/__tests__/unit/settings-wiring.test.mjs` | 旧模板彻底移除、宿主不被覆写、语言落 i18n、调用真实契约方法、快照不含明文密码、断开必须二次确认、Esc 兼容输入法 |
| 真机 CDP（离线） | `packages/desktop/__tests__/cdp/settings-center-cdp.test.mjs` | 点顶栏开弹窗、导航六项、点皮肤真换肤并落盘、点 English 真换文案并落盘、无网关时失败态可见、Esc 关闭、两张截图 |
| 真机 CDP（真实网关） | `packages/desktop/__tests__/e2e/settings-center-live-cdp.test.mjs` | 连 0.22.5 网关：页面 provider 集合与 `model.options` 完全一致、当前 provider 置顶、搜索过滤、技能真实渲染、无未捕获异常、两张截图 |

全量结果：`npm test` 977 通过 / 0 失败 / 3 skipped；`npm run gates` 新增违规 0；`npm run typecheck` 0 错误；`npm run verify:formal` 32 通过；`npm run verify` EXIT=0。

真机截图：`artifacts/verification/settings-center-live-providers.png`、`settings-center-live-extensions.png`、`settings-center-appearance.png`、`settings-center-connection.png`。

---

## 七、审查驱动的加固（第二轮）

首轮独立审查（代码 + 样式）共提出 2 条 P0、4 条 P1、14 条 P2。已完成：

- **P0 日志泄露**：`GatewayClient` 的 `rpc call` 与 `contract violation` 共用 `redactParams`，`api_key` / `password` / `token`（含 camelCase）与 `mcp.servers.set_api_key.value` 一律掩码；真实 sink 测试钉住接线。
- **P0 编排零行为测试**：抽出 `settingsController.ts`（依赖注入），14 类行为分支落盘；`build.mjs` 单独编译供测试消费；`npm test` 前置 `build`，杜绝陈旧 dist 假绿。
- **P1 断开无确认**：走 `confirmModal`，取消返回 `{ cancelled: true }`。
- **P1 保存失败清草稿**：抽 `providerRowReducer`，成功才清空、失败保留并显示行级错误、取消不报错。
- **P1 密码进快照**：快照只留 `hasStoredPassword`，表单留空沿用旧密码。
- **P1 忙态双写**：`runBusy` 统一计数，连通性测试与保存/断开/重扫共享同一真值。
- **P1 畸形响应**：`model.options` / `profiles.list` / `mcp.servers.status` / `skills.manage` 形状不符一律 `error`，合法空列表仍为 `ready`。
- **样式 P1**：`--fs-micro` 9→10px 且删除无消费者的 `--fs-overline`（7 档）；四套皮肤 muted 对比度修复并扩到 8 个表面；触控热区 24→28px；删除旧设置页 45 条死样式裸 hex；主题卡层级与预览色块修正；Esc 兼容输入法；打开/关闭焦点归还。
