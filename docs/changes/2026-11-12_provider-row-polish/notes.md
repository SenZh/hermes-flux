# 提供商行打磨 · 2026-11-12

## 用户诉求

1. 图例改为"绿环 = 该 Bot 使用的默认模型"，删掉"勾选 = 已配置"；删掉"生效于 · 点格子切换"。
2. 列表行不显示 provider URL / 配置文件路径；"N 个模型"与提供商名同一排。
3. cpa 只显示 `deepseek-v4.1-flash`，实际只有 `cpa/gemini-3.8-flash`。
4. "查看模型"的模型图标不对，必须与输入舱模型切换器同一个图标。
5. 切到 flux-probe-bot 后点 fn 行里的头像，无法把该 Bot 的默认 provider 切成 fn。

## 根因（真网关实测）

| 现象 | 证据 | 根因 |
|---|---|---|
| cpa 模型列表错误 | 同一 profile：`/api/providers/custom-endpoints` 的 cpa.models = `[deepseek-v4.1-flash]`；`/api/model/options?explicit_only=true` 的 cpa.models = `[cpa/gemini-3.8-flash]` | 前者是 config.yaml 的声明目录，后者是网关现算的运行时目录；`mergeProviderViews` 把声明目录放在优先位 |
| 点头像不切默认 | 点击前 `state=absent`；点击后 `state=ready`、网关 `current.provider` 仍为 `xai-oauth` | attach 固定 `makeDefault:false`，且 `ready` 格子的点击是 `noop`，没有把已配置端点提为默认的路径 |
| 模型图标错误 | 设置页用 lucide 通用描边图形（Anthropic=Brain、OpenAI=Zap）；输入舱用 lobe 品牌 SVG | 两套图标实现；品牌判定没有复用 `describeModelVendorIcon` |

## 改动

- `providerViews.ts`：运行时目录优先、端点声明兜底；`ProfileModelOption.currentModel` 读取 `model.options` 顶层 `model`，补全 `active` 槽位的"当前模型"；新增 `resolveBindingDefaultModel`；`attach` 计划携带 `makeDefault: true`。
- `desktop/renderer/index.ts`：勾选空头像时 `makeDefault` 走计划值，模型取运行时目录里真实存在的那个。
- `ProvidersAdminPanel.tsx`：类型/数量与名称同排；URL 与配置文件路径不展示（订阅只保留套餐等人类可读片段）。
- `ModelPicker.tsx` + `vendorIcon.ts`：抽出 `describeVendorIcon` / `describeModelVendorIcon`，字符串模板与 React 共用同一份判定；设置页模型行改用 lobe 品牌资产。
- i18n：图例与"生效于"文案。

## 验证

- 真网关 CDP（flux-probe-bot）：
  - fn 空头像点击后 `state=active`、`ring-success` 出现、网关 `current.provider=fn`。
  - cpa 空头像点击后网关 `current.model=cpa/gemini-3.8-flash`，证明废弃的声明模型被替换。
  - cpa 弹框只剩 `cpa/gemini-3.8-flash`，图标为 `icons/lobe/google-color.svg` 且图片成功解码。
  - 已恢复：flux-probe-bot 无自定义端点，默认 `xai-oauth / grok-4.5`。
  - 每个 Bot 在整张表里恰好一个绿环（fn: 4 个，xai: 1 个，cpa: 0 个）。
- `npm run gates:changed`、`npm run typecheck`、`npm test`（1553 用例，1550 pass / 3 skip）、`npm run verify:formal`（41 用例）全绿。
- 落盘守卫：`draftForBindingAttach`（core 纯函数，含端点定义/密钥/运行时模型）、`currentIsDefault`（控制器，含 `custom:` id 归一化与响应缺行）、`describeDetail`（UI 纯函数，含 URL/路径各分支）、`providerViews` 的目录优先级与 `currentModel` 优先序、`settings-wiring` 对壳层完整守卫表达式的断言。
- 证据：`artifacts/verification/providers-admin/evidence-2026-11-12.json`、`panel-attached-2026-11-12.png`、`model-dialog-2026-11-12.png`、`panel-restored-2026-11-12.png`。

## 已知边界

- 已配置但非默认的端点，格子点击仍是取消绑定；切默认走"查看模型"。这是为了保留成员解绑能力，槽位语义（绑定 vs 默认）在格子的 title 与绿环上区分。
- 订阅格子保持只读：客户端无法替用户选一个"默认模型"，且取消绑定等于退出登录。
