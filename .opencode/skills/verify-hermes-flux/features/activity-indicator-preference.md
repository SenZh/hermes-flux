# Activity indicator preference

设置 › 外观里的「活动指示器」是左轨运行时动效的唯一选择入口。六套变体（流云 / 陀螺 / 轨道 / 突触 / 弹簧 / 旋涡）以卡片并列，卡片里跑的就是左轨里用的同一个 `ActivityIndicator` 运行态，点一下立即更换并落盘，刷新后保持。

## Sub-features

- `six-live-previews`: 六张卡按真值表顺序排列，每张卡内嵌运行态指示器，动画节点真实在跑（不是静态缩略图）。
- `single-selection`: 选中态互斥，来自当前快照而不是默认值；切换后其余卡 `aria-checked="false"`。
- `apply-and-persist`: 点击后 `localStorage.hermes_flux_activity_variant` 写入所选变体，关闭再打开、刷新页面都保持。
- `reduced-motion`: 系统开启「减少动态效果」时六套动效全部停止。
- `page-hidden-pause`: 页面隐藏（`data-page-hidden="true"`）时六套动效全部暂停，不空转合成器。
- `no-clipping`: 两种界面语言下卡片名称与描述都不被截断。

## How to get to it (user POV)

- 顶栏齿轮 / 快捷键打开设置 › 外观。
- 在「界面主题」下方找到「活动指示器」，六张卡并排可直接比较。
- 点任意一张卡：边框高亮立刻切换，左轨下次出现的运行态就用新动效。
- 关闭设置、重启或刷新应用：仍保持上次选择。

## Driving it with control-flux

Preconditions: `npm run build` is fresh, `node scripts/verify/control-flux.mjs doctor` passes. No gateway needed.

1. Run `node scripts/verify/control-flux.mjs run activity-indicator-preference`.
   Observable: `[data-activity-variant]` count is 6, in the order `cloud, gyro, orbit, synapse, spring, matrix`.
2. Read each card's preview.
   Observable: every card contains `[data-activity-preview="<variant>"]` whose inner `[data-status]` is `running`, carries `flux-variant-<variant>`, and has at least one node with `animationName !== 'none'`.
3. Read the selection state.
   Observable: exactly one card has `aria-checked="true"`.
4. Click `[data-activity-variant=orbit]`.
   Observable: `aria-checked` moves to `orbit` only, and `localStorage.hermes_flux_activity_variant === 'orbit'`.
5. Switch the interface language to English and re-read every card's text row.
   Observable: no text row has `scrollWidth > clientWidth`.
6. Emulate `prefers-reduced-motion: reduce`.
   Observable: no node inside any preview reports an active `animation-name`.
7. Set `document.documentElement.dataset.pageHidden = 'true'`.
   Observable: every animated node inside the previews reports `animation-play-state: paused`.
8. Reload the page and open Settings › Appearance again.
   Observable: `orbit` is still the single checked card, and the stored value is still `orbit`.

## Gotchas

- The previews must use the real `ActivityIndicator` with real `flux-variant-*` classes. Rendering any custom thumbnail would pass a naive DOM count while lying about the effect.
- `zoom` (not `transform: scale`) is what enlarges the motif: `transform` does not participate in flex layout and the enlarged dots would overlap the text column.
- The preview hides `.flux-cloud-label` on purpose; the running status word sits next to the variant name and reads as "执行中 流云" otherwise.
- `artifacts/verification/` is gitignored: re-run the command to regenerate `evidence.json` and the screenshot instead of trusting a stale copy.
- Language switch inside the run is a real click on the English segment, not a `__fluxState` poke: `syncLocale()` only runs through the settings action.
