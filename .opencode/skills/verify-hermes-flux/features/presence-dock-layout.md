# presence-dock-layout · Agent 状态指示器（输入舱上沿变体）

## 1. 启动

```bash
node node_modules/electron/cli.js scripts/verify/agent-presence-screens.cjs
# 等价于（PowerShell 下 npm 被策略拦截时用上面的写法）
npm run verify:presence:dock
```

脚本自带静态伺服：伺服 `packages/desktop/dist/renderer/`，因此**必须先构建**：

```bash
node node_modules/typescript/lib/tsc.js --build packages/core/tsconfig.json packages/ui/tsconfig.json
node packages/desktop/scripts/build.mjs
```

判定就绪：窗口 `did-finish-load` 且 `#flux-app-root` 已挂载（脚本内部固定等待 3.2s 覆盖网关握手）。

## 2. 驱动

四个场景按 `data-layout` 与 `data-presence` 注入，全部通过真实 DOM 选择器量测：

| 场景 | 主题 | 断言重点 |
|---|---|---|
| `stage-thinking` | 黑曜琥珀 | stage 仍为 420×93~94（胶囊底板后文案行 26px）、头像 56px 零位移 |
| `dock-thinking` | 黑曜琥珀 | 头像槽位左沿 == 输入舱左边框（`alignDelta=0`）、间距 8px |
| `dock-idle` | 黑曜琥珀 | 空闲轮播文案常驻、弱化为 `--muted-foreground` |
| `dock-writing-light` | 暖纸 | 浅色皮肤下胶囊底板可见、文案无脏边阴影 |

随后做一次真实设置操作：点顶栏设置 → 外观 → 点「输入框上方」→ 断言 `aria-pressed` 与 `localStorage`，再 `reload()` 断言冷启动恢复。

**量测口径（重要）**：`alignDelta` 必须量 `.conv-presence__avatar` 槽位而不是 `.conv-presence__face`——face 上挂着 `convPresenceTilt` 旋转形变，`getBoundingClientRect()` 会因旋转膨胀到 21px 并左移 1px，量它等于在量动画帧。

## 3. 断言（全部 Binding，任一为 false 即退出码 1）

| 断言 | 不变量 |
|---|---|
| `dockAlignsFaceToDockLeft` | 头像外沿与输入舱左边框逐像素对齐（用户裁定的对齐线） |
| `dockGapIsEight` | 指示器与输入舱上沿固定 8px，且不占 flex 流 |
| `noMaskBehindIndicator` | 指示器背后零背景面（对比度遮罩已整块删除） |
| `dockTextShadowOff` | dock 文案不得带字形阴影（在输入舱上方会变成脏边） |
| `textPlatePresent` | 文案行必须自带胶囊底板（背景不透明） |
| `rootHasNoPlate` | 根节点必须完全透明：底板只能挂在 shrink-to-fit 的文案行上 |
| `dockPlateFitsText` | dock 底板宽度由内容决定（文案 + 头像 + 8px ≤ 指示器宽度），不得铺开 |
| `textInkPixels` | 文案**内容盒**内真实像素墨迹占比 > 2%（内容盒已裁掉描边与内距，字没画出来时掉 0） |
| `textInkCalibrated` | 判据自检：隐藏文案子元素后同一内容盒墨迹必须归零（< 0.5%），证明量到的是字不是 chrome |
| `textSettledOpacity` | 入场动画终态不透明度 == 1（探针用 `getAnimations().finish()` 驱动，不改写被测属性） |
| `disconnectedHidesPresence` | 未连接时真实应用不得留下 `.conv-presence` 子树（已连接环境按条件跳过） |
| `settingsPersists` | 设置切换必须写盘 |
| `coldStartRestoresDock` | 重启后仍为 dock（历史 P0 回归：键名声明晚于 state 会恒回 stage） |

## 4. 产物与清理

- `artifacts/verification/presence-dock-layout/screenshot.png`（stage 场景全屏图）
- `artifacts/verification/presence-dock-layout/<scene>.png`（四场景各一张）
- `artifacts/verification/presence-dock-layout/evidence.json`（几何 + 断言 + 设置闭环）
- 清理：临时 HTTP server 与窗口随进程退出释放；`artifacts/verification/` 永久保留。

## 5. 已知盲区（本探针抓不到的）

1. **骨架是手写复刻**，不来自 `AgentPresence.tsx` 的真实输出。组件侧改名/新增子节点时，
   截图会静默少一块而断言仍绿。守卫用例 `agent-presence.test.mjs` 第 22 条登记了必须复刻的
   契约面（含宿主 id / `presence-host--dock` / 插入位置），能挡住「探针自己删标记」，
   但挡不住「组件改名而探针未跟进」。
2. `data-idle-turn` 恒写 `false`：换句侧头那一帧从未被截（该动作由 `idleQuipScheduler`
   的行为测试覆盖，不靠截图）。
3. 断连态（`gatewayConnected=false`）：真实应用已由 `ensureAgentPresenceHost()` 整段早退，
   **不留任何 `.conv-presence` 子树**（stage 与 dock 统一）。探针在注入前采样宿主，
   断言 `disconnectedHidesPresence`；若探针机本身已连真实网关（输入舱存在），该断言按条件跳过，
   连接态一并记入 `evidence.json` 的 `diagnostics.probeConnected`。
4. 探针不使用 `webPreferences.offscreen`：该选项在部分 Windows/Electron 34 组合上
   退出时以 0xC0000005 崩溃，会让脚本无法作为门禁（实测 `app.exit(0)` 返回 -1073741819）。
   隐藏的普通窗口仍是真实 Blink 渲染与真实排版。
5. 隐藏窗口会冻结动画时间线（`convPresenceTextIn` 停在 opacity 0）。探针用
   `textEl.getAnimations().forEach((a) => a.finish())` 驱动到终态后再截图——**不得**直接写
   `textEl.style.opacity`：那会压掉应用侧任何 opacity 回归（变成自己写值、自己量值）。
