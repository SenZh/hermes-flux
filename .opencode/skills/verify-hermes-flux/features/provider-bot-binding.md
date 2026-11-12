# Provider bot binding

在「设置 › 模型与提供商」里，每个提供商行下面是一组 Bot 头像。点头像表达两件不同的事：把这条提供商配置到该 Bot，以及是否把该 Bot 的默认模型切过来。这个特性把它们拆成两步：点头像只展开行内确认条，由用户显式选择「仅启用」或「启用并设为默认」。添加自定义端点弹框里的「保存时配置到」是同一个问题的另一个时机，因此共用同一套头像网格。

## Sub-features

- `confirm-attach`: 点未配置的自定义端点头像不写任何配置，只在行内展开确认条（仅启用 / 启用并设为默认 / 取消）。
- `needs-key`: 其它成员没有可复用密钥时，确认条原位切成密码输入，并写明将执行哪一种意图；此时不得同时出现两个意图按钮。
- `keep-key-shape`: 从补密钥发起的提交期间必须保持密码形态，输入框禁用而不是卸载。
- `attach-a11y`: 确认条是 `role=group` 且有 `aria-labelledby`；展开时焦点进入条内；触发头像声明 `aria-expanded` 与 `aria-controls`。
- `fanout-avatar-grid`: 「保存时配置到」复用同一套 44px 头像网格；保存目标恒勾选且锁定。
- `detach-unchanged`: 已启用但非默认的头像，点击仍然立刻停用；当前默认锁定；读取失败阻断并给原因。

## How to get to it (user POV)

- 设置 › 模型与提供商。找一个还没配置到某个 Bot 的自定义端点。
- 点那个 Bot 的头像：下方展开确认条，不写任何东西。
- 选「仅启用」：该 Bot 得到这条提供商，默认模型不变（有勾、无绿环）。
- 选「启用并设为默认」：默认模型切过去（有勾、有绿环）。
- 添加提供商 › 自定义端点：「保存时配置到」里点头像选择要一并写入的 Bot，当前 Bot 恒勾选且不可取消。

## Driving it with control-flux

Preconditions: `npm run build` is fresh, `node scripts/verify/control-flux.mjs doctor` passes. No gateway needed: the run injects `settingsProviderViews` into `window.__fluxState`.

1. Run `node scripts/verify/control-flux.mjs run provider-bot-binding`.
   Observable: `[data-attach-phase]` count is 0 before any click, and `settingsEndpointProfiles` is unchanged after the strip opens.
2. Click `[data-agent-profile=aura]`.
   Observable: `[data-attach-phase=choosing]` mounts, its `data-attach-profile` is `aura`, it has exactly three buttons, and no `input[type=password]`.
3. Read the strip and the avatar input.
   Observable: strip's first child has `role=group` and a non-empty `aria-labelledby`; the input has `aria-expanded="true"` and an `aria-controls` pointing at the strip; `document.activeElement` is inside the strip.
4. Click the first button (Enable only) with no gateway reachable.
   Observable: the strip stays mounted, and either `[data-attach-phase=needs-key]` mounts or a `[role=alert]` appears inside it; the Cancel button is still enabled.
5. Click Cancel.
   Observable: `[data-attach-phase]` disappears and no success toast follows.
6. Open Add provider › Custom endpoint.
   Observable: the section under `保存时配置到` contains `.agent-grid`; one cell is checked and disabled (the save target), the rest are clickable, every cell has a 44px avatar, and the section holds no visible native checkbox.

## Gotchas

- The confirm strip lives inside `LoadBoundary`'s children. Every binding write triggers `reloadProviderCatalog()`, which sets the snapshot to `loading`; without keeping the previous frame the strip is unmounted mid-submit and the "all disabled" contract breaks.
- `reconcileAttachFlow` is a pure derivation. If its `null` result is not written back to state, a strip can reappear on a cell the user never clicked once that cell returns to `absent`.
- `enable-only` must not be reported as success when the gateway answers `is_current: true` anyway; the toast would say the default model is unchanged while the UI shows a green ring.
- Cancel stays enabled during `submitting` on purpose: the REST proxy can hang, and a disabled Cancel would trap the user inside the settings dialog.
- `artifacts/verification/` is gitignored, so re-run the command to regenerate `evidence.json` and the screenshots instead of trusting a stale copy.
