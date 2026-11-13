# 活动指示器变体偏好（设置 › 外观）

> 状态：**已落码并验证**
> 涉及层：`packages/ui`（tokens / 设置面板 / 样式）、`packages/desktop`（宿主接线）
> 前序：`docs/changes/2026-11-12_agent-presence-indicator/`（左轨三态指示器的组件化）

---

## 一、需求与判据

**需求**：`ActivityIndicatorVariant` 已经是组件能力（cloud / gyro / orbit / synapse / spring / matrix 六套纯 HTML/CSS 动效），
但用户无从选择——变体只存在于 `LeftRailProps.activityVariant` 这个内部 prop 上，没有任何入口。

**判据**：

| 判据 | 阈值 |
|---|---|
| 可选变体数量 | 6（与 `tokens/activityIndicator.ts` 真值表一致） |
| 设置页预览与左轨实际效果 | 同一组件、同一类名、同一份 CSS；零静态占位图 |
| 预览可见动画 | 每张卡至少 1 个运行时 `animation-name ≠ none` 的节点 |
| 切换生效延迟 | 点击即 `render()`，无需确认按钮、无需重启 |
| 偏好持久化 | `localStorage.hermes_flux_activity_variant`，刷新后恢复 |
| 脏值容错 | 非白名单值一律回落 `cloud`，不得把非法类名写进 DOM |

---

## 二、真值面与分层落点

| 层 | 文件 | 职责 |
|---|---|---|
| tokens | `packages/ui/src/tokens/activityIndicator.ts` | 变体枚举、展示顺序、默认值、localStorage 读写与白名单收敛 |
| ui 表现 | `packages/ui/src/components-react/primitives/ActivityIndicator.tsx` | 从 tokens 取类型（原文件内的联合类型删除，避免两套真值） |
| ui 设置 | `packages/ui/src/components-react/settings/SettingsModal.tsx` | 外观页新增「活动指示器」段：六张卡，卡内直接挂载运行态组件 |
| ui 模型 | `packages/ui/src/components-react/settings/settingsModel.ts` | 快照加 `activityVariant`，动作加 `onActivityVariantChange` |
| ui 样式 | `packages/ui/src/tailwind-entry.css` | `@utility activity-variant-preview`：放大预览、隐藏状态词、固定起点 |
| ui 样式 | `packages/ui/src/styles/conversation.css` | 修 `prefers-reduced-motion` 对 synapse / matrix 的降级权重（见 §三） |
| host | `packages/desktop/src/renderer/index.ts` | 冷启动读取偏好、切换时落盘、推进设置快照与左轨快照 |
| verify | `scripts/verify/control-flux.mjs` + `.claude/skills/verify-hermes-flux/features/activity-indicator-preference.md` | 注册可重放的验证分支（六卡动效、落盘、语言截断、减弱动效、页面隐藏暂停、刷新恢复） |

**为什么类型下沉到 tokens**：变体枚举现在被表现组件、设置面板、偏好持久化与宿主共同消费；
放在组件文件里会让"表现组件"反向成为数据真值，且宿主只能经组件模块拿到类型。

---

## 三、界面与交互

- 位置：设置 › 外观 › 主题之后、字体之前。
- 布局：2 列卡片网格（与皮肤卡同构：`rounded-panel` + 选中 `border-primary bg-primary-subtle`）。
- 卡内：左侧为真实 `ActivityIndicator state="running"`（`entityKind="session"`），右侧为变体名 + 一句动效描述。
- 预览放大：`zoom: 2`（**不是 `transform: scale`**）。`transform` 不参与 flex 布局，
  放大后的点阵会压到右侧文字；`zoom` 参与布局，间距与命中区才是真实的。
- 预览隐藏 `.flux-cloud-label`：运行态状态词（「执行中」）与右侧变体名并排会被连读成
  「执行中 流云」；这里要比较的只有动效本体，状态词在左轨里原样保留。
- 无障碍：外层容器 `role="radiogroup"`，卡片 `role="radio" aria-checked`；
  预览整体 `aria-hidden`，避免读屏把六份「执行中」念一遍。

---

## 三之二、顺带修掉的既有降级漏洞

设置页把六套动效并排后暴露了一个既有缺陷：`prefers-reduced-motion: reduce` 里
synapse / matrix 的停止规则写成单类名（`.flux-synapse-cell` / `.flux-matrix-dot`，specificity 0,1,0），
而运行态动画声明在 `.flux-cloud-indicator--running .flux-synapse-cell`（0,2,0）上，
**权重不够，媒体查询里写了也压不住**——减弱动效下这两套仍在放电。

修法：降级规则补上同样的父选择器，与运行规则同权重。真实渲染验证：reduce 下预览内活跃动画节点从 32 → 0。
守卫测试 `activity-indicator-preference.test.mjs` 直接读 `conversation.css` 断言这两条选择器，防止回退。

同时英文描述全部压到 40 字符以内：卡片文本列实测可用宽约 228px，
「Swirling particles converging fast, the liveliest」这类长句会被 `truncate` 吃成省略号；
驱动脚本会切到 English 后逐行量 `scrollWidth > clientWidth`。

---

## 四、验收与证据

| 项 | 结果 |
|---|---|
| `tsc --build packages/ui/tsconfig.json` | 通过 |
| `tsc --project packages/desktop/tsconfig.json --noEmit` | 通过 |
| `node --test packages/ui/__tests__/**` | 397 passed / 0 failed |
| `node --test packages/desktop/__tests__/unit/**` | 432 passed / 0 failed |
| `node --test scripts/__tests__/**` | 46 passed / 0 failed |
| `node scripts/gates/run.mjs --changed` | 新增违规 0 |
| 真实渲染验证（headless Edge + 生产产物） | 6 张卡全部运行态、点击 orbit 后落盘并互斥选中、English 文案零截断、reduce 下活跃动画 0 个、页面隐藏时 72 个动画节点全部 paused、刷新后仍为 orbit |

证据：`artifacts/verification/activity-indicator-preference/`（`screenshot.png` + `evidence.json`），
可用 `node scripts/verify/control-flux.mjs run activity-indicator-preference` 重放。

单测钉住的契约：

1. `activity-indicator-preference.test.mjs`：白名单收敛、默认回落、读写抛错降级、往返一致；
   以及三条 CSS 守卫（reduce 降级必须与运行规则同权重且真的 `animation: none`、页面隐藏暂停块覆盖四类载体、
   预览必须用 `zoom` 且不得用 `transform: scale`）；
2. `settings-modal.test.mjs`：六张卡顺序（`indexOf` 递增，反转列表会红）、每卡内嵌运行态组件、选中态互斥且来自快照；
3. `react-left-rail.test.mjs`：`activityVariant` 真的透传到会话行、群聊行与微轨角标，缺省回 `cloud`；
   静态渲染快照同样携带变体，缺省回 `cloud`；
4. `settings-wiring.test.mjs`：切换动作必须落盘所选值（不是常量）、缓存比较器必须比较变体、卡片点击必须传自身变体。

---

## 六、已知残留（本次不修，避免范围膨胀）

- `just-completed` 完成跃迁的五处降级（gyro / orbit / spring / synapse / matrix）与运行规则权重仍不对齐，
  减弱动效下仍会播放一次 360~560ms 的进场。单次、无合成器常驻、不构成能耗或频闪风险；
  与本次修掉的常驻无限动画不是同一严重度，留待下次触碰这段 CSS 时一并收口。
- `--flux-activity-blue*` 三个色相仍是 `packages/desktop/src/renderer/styles.css` 的手写值，未进皮肤表；
  属于前序「活动指示器」变更的债，不在本次 diff 内。

## 七、明确不做

- 不做按实体类型分别设置变体（会话 / Bot / 群聊共用一套，避免三份偏好互相漂移）。
- 不做实时预览的独立播放控制（设置页只在打开时挂载，关闭即卸载，动画不常驻）。
- 不新增任何依赖，不引入 SVG（六套动效继续遵守纯 HTML/CSS 约束）。
