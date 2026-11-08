# 设置中心评审：现状定性 (2026-11-08)

评审对象：`packages/ui/src/components/SettingsModal/SettingsModal.ts`（1022 行，字符串模板）
调用点：`packages/desktop/src/renderer/index.ts:5476`、`:5654`
结论：**REVISE · 整体重写**。不是样式微调能解决的，症结在信息架构与数据来源。

---

## 一、事实清单（可复现的取证）

### 1. 信息架构是别家的，不是我们的

| 证据 | 位置 | 判定 |
|---|---|---|
| 导航分组字面量 `OPENCHAMBER` / `OPENCHAMBER`(en) | `SettingsModal.ts:148`、i18n `settings.groupOpenchamber` | 直接照抄竞品分组名 |
| 分组 `OPENCODE` | `SettingsModal.ts:178` | 照抄另一个竞品 |
| 导航项 20 个：`notifications` / `sessions` / `routing` / `tunnels` / `git` / `websearch` / `agents` / `behavior` / `keybindings` / `voice` / `integrations` / `extensions` / `usage` / `chat` | `SettingsModal.ts:19-40` | 其中 12 个点进去只有"功能域就绪中"占位（`:999-1021`） |
| `tunnels` 带 `Beta` 徽标 | `SettingsModal.ts:171` | 我们没有任何隧道能力，徽标是假的 |

对照 `docs/architecture/settings-architecture-and-implementation-map.md` 的 12 个功能域：现有实现与它**没有一处对齐**，缺口全部靠占位页填充。

### 2. 提供商页是假的，且直接展示他人私有环境

`SettingsModal.ts:424-439` 硬编码了 7 张卡片：

```
jev / agnes-ai / CPA / FN / magpie / OpenCode
```

这些是**截图里的字符串常量**，不是 `model.options` 的返回值。其中 `jev` 带 i18n 键 `settings.providerJevTitle`（"分类提供方"），说明是从某张参考图逐字抄下来的。`:450-452` 又硬编码了 3 行"已停用提供方" `deepseek / ipraft / vpi`。

真实数据源 `model.options` 在 `packages/core/src/rpc/client.ts:802-861` 已经完全就绪，设置页一次都没调用。

### 3. 死交互（点了没有任何反应）

| 控件 | 位置 | 实际行为 |
|---|---|---|
| 提供商搜索框 | `SettingsModal.ts:373` | 无 `id`、无绑定 |
| "连接提供商"卡 | `:394-421` | 无 `id`、无绑定 |
| 7 张提供商卡 | `:459-531` | 无绑定 |
| 4 个"启用"按钮 | `:548` | 无绑定 |
| 语言切换按钮 | `:934`、`:944` | renderer 里**零绑定**；`state.lang` 从未写回，`setLocale()` 全仓仅测试调用 |
| 主题选择 | `:6182` | 唯一真接线的控件 |
| 字体/字号 | `:6191-6215` | 已接线 |

即：一个 1022 行的弹窗，真正能用的只有主题与字体两项。

### 4. 违反了设计系统的硬约束

| 约束 | 违规点 |
|---|---|
| 图标风格统一（`Titlebar.tsx` / `LeftRail.tsx` 全部用 `lucide-react` 描边图标，14px） | 设置页用 Unicode 字符与 emoji：`⚙ 🎨 💬 🔔 🕒 🔀 ⌨ 🎙 🔌 📦 📊 ℹ 📁 🖥 🏠 ☁ 🌐 👤`（`:150-183`）、`⬡ ✦ 🦿 ✧`（`:424-452`） |
| 5 级表面阶梯 | 弹窗自造 `--bg-card/--bg-rail/--bg-panel` 三层叠加，未使用 `--popover` 语义 |
| 圆角 Token（window 12 / panel 8 / card 6 / inner 4） | 自造 `16px` / `12px` / `10px` / `8px` / `6px` 五种散值 |
| 7 档整数字阶 | 基本合规（用了 `--fs-*`），但 `--fs-hero` 用在弹窗标题（20px）超出层级 |
| 零硬编码色相 | 内联 `rgba(0,0,0,0.68)`、`rgba(0,0,0,0.02)`、`rgba(255,255,255,0.1)` 等 |
| 中英文案全走 `t()` | `'正在测试...'`（`index.ts:6300`）、`'hermes-aura'`（`:225`）、`'A'` 徽标（`:978`） |

### 5. 工程性缺陷

- **每帧全量重建**：`index.ts:5669-5673` 每次 `render()` 都 `modalRoot.outerHTML = nextModalHtml`，流式输出期间设置弹窗每帧被销毁重建。虽然预览里"看不见"，但它违反"React 岛自管子树"的既有约定（左轨已迁移，设置页没迁）。
- **密码明文落 localStorage**：`index.ts:6243-6250` 把网关密码写进 `hermes_flux_password`。
- **`SettingsModalProps` 有 4 个字段从未被传入**：`gateways` / `activeGatewayId` / `autoConnectOnStartup` / `searchQuery`（`:55-58`），组件内部也从不读。
- **静态门禁已有 31 条冻结债务**挂在这个文件上（`scripts/gates/.baseline.json:83-108` 起），全部是硬编码色相与硬编码文案。
- 顶栏 `OpenChamber` 风格的 workspace chip（`:212-227`）硬编码 `hermes-aura`，是当前仓库名，不是用户的项目名。

### 6. 真实可用的能力清单（决定新方案的边界）

已核实存在的 RPC（`contractTable.generated.ts`，共 329 条）：

- 配置：`config.get` / `config.set` / `config.show`
- 模型：`model.options` / `model.save_key` / `model.disconnect` / `reload.env`
- 数字员工：`profiles.list` / `profiles.create` / `profiles.describe` / `profiles.configure` / `profiles.get_asset` / `profiles.set_asset`
- MCP：`mcp.catalog` / `mcp.servers.list` / `mcp.servers.add` / `mcp.servers.remove` / `mcp.servers.status` / `mcp.servers.test` / `mcp.servers.set_api_key` / `mcp.servers.oauth.*`
- 技能：`skills.manage` / `skills.reload`

本地客户端能力（无网关也能用）：主题（6 皮肤，`skins.ts` 单一真值）、字体（20 套 woff2）、字号、左双轨折叠、检查舱折叠、i18n。

**不在能力范围内**（因此新方案不出现）：隧道、Git 设置、网页搜索、通知、用量计费看板、语音、宠物、保险库、代理、遥测 —— 这些要么网关没有契约，要么属于本轮以外的里程碑。

---

## 二、根因

不是"样式没调好"，是**照着一张截图做产品**：把竞品的导航树、竞品的提供商名字、竞品的分组标题整套搬过来，再把我们真实存在的能力（提供商密钥、模型 Pin、MCP、技能）留成占位页。
所以出现三个症状同时成立：**假数据 + 死交互 + 风格不符**。它们是同一个根因的三种表现。

## 三、裁决

`SettingsModal.ts` 整体删除，按 React 岛重建。信息架构以本项目真实契约与 `settings-architecture-and-implementation-map.md` 的功能域交集为准，不做竞品镜像。
