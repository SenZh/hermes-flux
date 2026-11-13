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
| `stage-thinking` | 黑曜琥珀 | stage 仍为 420×84、头像 56px 零位移 |
| `dock-thinking` | 黑曜琥珀 | 头像槽位左沿 == 输入舱左边框（`alignDelta=0`）、间距 8px |
| `dock-idle` | 黑曜琥珀 | 空闲轮播文案常驻、弱化为 `--muted-foreground` |
| `dock-writing-light` | 暖纸 | 浅色皮肤下无对比度遮罩、文案无脏边阴影 |

随后做一次真实设置操作：点顶栏设置 → 外观 → 点「输入框上方」→ 断言 `aria-pressed` 与 `localStorage`，再 `reload()` 断言冷启动恢复。

**量测口径（重要）**：`alignDelta` 必须量 `.conv-presence__avatar` 槽位而不是 `.conv-presence__face`——face 上挂着 `convPresenceTilt` 旋转形变，`getBoundingClientRect()` 会因旋转膨胀到 21px 并左移 1px，量它等于在量动画帧。

## 3. 断言（全部 Binding，任一为 false 即退出码 1）

| 断言 | 不变量 |
|---|---|
| `dockAlignsFaceToDockLeft` | 头像外沿与输入舱左边框逐像素对齐（用户裁定的对齐线） |
| `dockGapIsEight` | 指示器与输入舱上沿固定 8px，且不占 flex 流 |
| `noMaskBehindIndicator` | 指示器背后零背景面（对比度遮罩已整块删除） |
| `dockTextShadowOff` | dock 文案不得带字形阴影（在输入舱上方会变成脏边） |
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
3. 断连态（`gatewayConnected=false`）输入舱整体移除，dock 变体的指示器随之消失；
   stage 变体仍渲染。两个变体在此状态行为分叉，目前无截图覆盖。
4. 探针不使用 `webPreferences.offscreen`：该选项在部分 Windows/Electron 34 组合上
   退出时以 0xC0000005 崩溃，会让脚本无法作为门禁（实测 `app.exit(0)` 返回 -1073741819）。
   隐藏的普通窗口仍是真实 Blink 渲染与真实排版。
