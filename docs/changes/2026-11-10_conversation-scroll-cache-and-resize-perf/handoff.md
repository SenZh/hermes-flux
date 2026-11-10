# 长会话滚动与边栏拖拽性能 · 交接说明

> **提交**：`e423607`（`origin/dev/v0.1`）
> **日期**：2026-11-10
> **验证会话**：`20261017_155949_6b41a97a`（标题「安卓开发」，**7,745 条消息 / 505 万字符**）

---

## 一、这次解决的是什么

用户报三个现象，实测后归为两个独立缺陷：

1. **长会话越滑越卡，边栏拖拽随之恶化** —— 消息窗口只扩不缩，挂载量随回溯轮次单调增长。
2. **有界窗口改造后原生滚动条乱飞** —— `scrollHeight` 只反映挂载段，thumb 长度与位置随窗口跳变。

另附带修复：边栏拖拽宽度双写（上一轮引入的回归）、向上滚动触顶卡死、缓存容量与分页读取。

---

## 二、真实体量基线（先记住这个数字）

| 项 | 值 |
|---|---|
| 消息总数 | **7,745**（`offset >= 8000` 返回 0 条） |
| 总字符 | 5,054,255 |
| 平均每条 | 585 字符 |
| 单条最大 | 5,878 字符 |

早期对话里出现过「5000 条」的说法，是少算了。以后判断该会话的性能问题，以 7,745 为准。

---

## 三、改了什么

### 1. 消息窗口：开放区间 → 有界滑动区间

`packages/desktop/src/renderer/messageWindow.ts`

- 窗口从 `[start, total)` 改为 `[start, end)`，容量硬上限 `DEFAULT_WINDOW_CAPACITY = 120`。
- `planMessageWindow` 接收 `capacity`、返回 `end`，任何状态迁移都不得突破容量。
- 新增 `windowEndFor(start, total, capacity, initialWindow)` —— **end 的唯一推导入口**，禁止别处另算。
- 新增 `slideMessageWindowDown` —— 向下滚动时回收顶部。
- `expandMessageWindowStart` 增加 `maxStart` 上界参数。

### 2. 渲染层接线

`packages/desktop/src/renderer/index.ts`

- 新增 `messageWindowEnd` 状态与 `MESSAGE_WINDOW_CAPACITY = 120`。
- 切片统一改为 `slice(messageWindowStart, messageWindowEnd)`（两处）。
- `onscroll` 新增向下回收：距底部不足一屏时调 `slideMessageWindowForward()`。
- 新增 `averageRowHeightPx` / `lockAverageRowHeight()` / `computeVirtualHeightPx()` / `computeContentOffsetPx()`。
- 新增 `scheduleVirtualHeightSync()` —— 未锁定行高时逐帧重试最多 8 帧。
- 新增 `relocateMessageWindowToIndex()` —— 拖滚动条跳转时按行高换算目标索引。

### 3. 虚拟视口（滚动条稳定的核心）

`packages/ui/src/components-react/conversation/types.ts`

- `ConversationSnapshot` 新增两个可选字段：`contentOffsetPx`、`virtualHeightPx`。

`packages/ui/src/components-react/conversation/ConversationMessageList.tsx`

- 消息数超过容量时，渲染 `.conv-virtual-viewport`（`height = 总条数 × 平均行高`）内套 `.conv-virtual-window`（`position: absolute; top = 窗口起点 × 平均行高`）。
- 未超过容量时退化为原来的扁平渲染，短会话零影响。

`packages/ui/src/styles/conversation.css`

- 新增 `.conv-virtual-viewport` / `.conv-virtual-window` 两条规则。

### 4. 缓存容量与分页

`packages/core/src/cache/CacheService.ts`

- `DEFAULT_MESSAGE_CAP` 500 → **5000**。
- 新增 `readOlderRows(ref, beforeOrderKey, limit)` —— 向上翻页的本地优先读取入口，走通道串行锁。

`packages/desktop/src/renderer/index.ts`

- `MESSAGE_CACHE_LIMIT` 2000 → 5000。
- `loadOlderMessages` 顶部增加 Cache-First 分支：本地命中直接渲染，未命中才打网关。
- 首屏 REST 返回后 `sessionServerOffset` 改为取 `Math.max(旧值, serverKnownCount)`，防止游标倒退重拉。

### 5. 边栏拖拽

`packages/desktop/src/renderer/index.ts`

- 左右轨拖拽**只写** `--rail-w-left` / `--rail-w-right`，**不再触碰元素内联几何**。
- 松手时先落定变量，`requestAnimationFrame` 后再撤 `data-rail-resizing`，避免 0.12s 过渡从终点重播。

`packages/desktop/src/renderer/styles.css`

- 移除 `html[data-rail-resizing] *` 全局通配符。
- 移除 `#conversation-stream` 上的 `contain: strict`（`size` containment 会让滚动容器按「无内容」计算尺寸）。

---

## 四、实测数据（同一会话，真实网关数据）

### 拖拽帧间隔

| 阶段 | 修复前 | 修复后 |
|---|---|---|
| 首屏 | 28.9ms | 18.2ms |
| 触顶 13 轮 | 37.1ms | — |
| 触顶 28 轮 | 47.9ms | **15.9ms** |
| 滑回底部 | 60.7ms | **16.3ms** |
| 超 50ms 帧数 | 12 | **0** |
| 挂载 DOM 节点 | 4,059 → 11,568 单调涨 | **85~157 恒定** |

### 滚动条

| 指标 | 结果 |
|---|---|
| `scrollHeight` 取值集合 | 单值 **1,262,752**（全程恒定） |
| 空白帧数（滚到该处却看不到内容） | **0** |
| thumb 非单调次数 | **0** |
| 拖滚动条 9 个比例点 | `firstVisibleIndex` 151/773/1933/3106/3879/4667/5803/6969/7597，严格线性 |

### 回溯顺序

向上 30 轮 `firstIdx` 序列 `7624 → 7583 → … → 6463`，严格单调变早；向下精确反向。

### 缓存分页

`readOlderRows` 返回按 `orderKey` 倒序的更早行，跨通道隔离正确（63 项缓存单测全绿）。

---

## 五、门禁状态

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 0 错误 |
| `npm test` | **1048 pass / 0 fail / 3 skipped** |
| `npm run verify:formal` | 32 / 32 |
| `gates:changed` | 新增违规 0 |
| pre-commit 门禁（含 Gate 0d 契约同步） | 全通过 |

---

## 六、下一任必须先知道的坑

1. **平均行高的分母口径**
   必须用「内容总高 ÷ **窗口内消息条数**」，不能用 DOM 行数。一条消息会渲染成多个 `data-msg-id` 节点，用行数会把平均行高算小一半。实测用错口径时滚 11,050px 只推进 36 条消息。

2. **行高必须每会话锁定一次**
   锁定时机在 React 提交之后，`scheduleVirtualHeightSync` 会重试最多 8 帧。**首次挂载路径（`mountMessageList` 分支）也必须调用**，否则会停在默认值 96，虚拟高度永不生效。

3. **窗口搬迁不要改写 `scrollTop`**
   虚拟视口已按新起点补偿内容位置。强制改写会吞掉用户滚动距离。只有视口彻底脱离窗口覆盖范围（拖滚动条）时才兜底定位。

4. **锚点不能反推窗口**
   `applyStreamAnchor` 里曾加过「锚点落在窗口外就反查索引搬窗口」的逻辑，会与「加载更早批次跳向新内容」的意图打架，实测导致向上回溯时 rowId 在 30486~35221 之间来回震荡。已删除。

5. **失败过的两个方案，别再试**
   - 上下双占位块：产生反馈回路（搬迁改占位高度 → 改 `scrollHeight` → 又触发搬迁），`scrollHeight` 从 758k 涨到 5M。
   - 只钉 canvas `min-height`：内容与虚拟高度不对齐，滚动条比例失真且出现空白。

6. **容量 120 是实测折中值**
   调大减少窗口搬动次数，但每帧重排成本线性上升；调小反之。不是理论推导。

---

## 七、已知偏差与未做的事

- **滚动条位置是估算值**
  用单一平均行高而非真实高度表。消息高度分布极不均匀时（例如夹带超长代码块）会有偏差。要彻底精确需维护每条消息的实测高度表，成本高，当前场景不值得。

- **向上翻页的 Cache-First 只读 100 行**
  `loadOlderMessages` 里 `readOlderRows(..., 100)` 是硬编码。缓存有 5000 行容量，可考虑按需放大。

- **`contain: strict` 与 `content-visibility` 已移除**
  它们曾是长会话的兜底手段，但有副作用（size containment 让滚动容器按无内容计算、`contain-intrinsic-size` 让滚动位置漂移）。现在靠有界窗口从根上解决，不需要它们。

---

## 八、验证脚本

都在 `%LOCALAPPDATA%\Temp\opencode\`：

| 脚本 | 用途 |
|---|---|
| `real-attach.mjs` | 附着真实浏览器 CDP |
| `real-depth.mjs` | 探查会话真实总量与分页边界 |
| `real-scroll.mjs` | 真实滚动驱动与挂载量观测 |
| `real-stress.mjs` | 触顶压力测试与帧间隔测量 |
| `verify-sb4.mjs` | 滚动条稳定性与滚动比例 |
| `verify-final.mjs` | 终验（高度恒定 / 空白 / 单调 / 拖拽） |
| `verify-gradual.mjs` | 渐进滚动逐轮采样 |

**认证方式**：同源复用 9120 服务端已建立的网关 Cookie，`POST /__gw/auth` 免密换 ticket，再用 `POST /__gw/proxy` 拉真实消息。不需要密码。

---

## 九、本机环境备忘

- 包管理器是 **bun**（`bun.lock` + `workspace:*`），`npm install` 会报 `EUNSUPPORTEDPROTOCOL`。
- PowerShell 执行策略禁止 `npm.ps1`，所有命令必须 `cmd /c "npm run ..."`。
- 9120 直跑服务：`cmd /c "npm run start:browser"`。**源码改动必须重新 `npm run build` 才生效**，它伺服的永远是 `dist/`。
