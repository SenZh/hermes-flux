# 消息流滚动流畅度、长会话本地缓存与边栏调整性能优化技术方案

> **文件归档**：`docs/changes/2026-11-10_conversation-scroll-cache-and-resize-perf/design.md`  
> **创建日期**：2026-11-10  
> **基线分支**：`dev/v0.1`  
> **关联议题**：会话向上滚动撞顶卡顿、长会话（5000条）本地缓存与翻页查询、边栏拖拽重排掉帧

---

## 一、目标与背景

### 1.1 业务诉求与现象
1. **向上滚动不跟手与触顶卡顿**：
   用户向上滑动查看更早历史消息时，滑一部分后触顶卡住，手势中断，必须再次划动才能继续。
2. **长会话（5000条）历史离线缓存与翻页未命中**：
   目前本地缓存容量仅为 500 行（`DEFAULT_MESSAGE_CAP = 500`），且向上翻页加载更早消息时（`loadOlderMessages`）直接发起网关 REST 网络请求（`offset=100, limit=500`），未优先利用 IndexedDB 本地已有的缓存。
3. **边栏拖拽调整大小时严重卡顿**：
   当消息条数增多时，拖拽左边栏（LeftRail）或右边栏（InspectionPod）调整宽度时出现明显掉帧与卡顿。

### 1.2 量化优化目标
| 场景 | 当前现状 | 优化后目标 |
|---|---|---|
| **边栏拖拽调整帧率** | 5~15 FPS（明显掉帧卡滞） | 稳定 60~120 FPS（丝滑跟手） |
| **向上翻页历史读取耗时** | 200~600ms（走网关网络） | 本地命中时 0~5ms（IndexedDB 秒开） |
| **触顶滑动手势连续性** | 撞顶 `scrollTop === 0` 动量归零被中断 | 提前 800px 静默加载，惯性滑动不中断 |
| **单会话本地缓存容量** | 500 行（超出即淘汰） | 5000 行（支持高密度长会话完整离线回溯） |
| **DOM 节点重排开销** | $O(N)$ 随历史全量深度 Reflow | $O(1)$ 视口外跳过 Layout，仅计算可见区域 |

---

## 二、架构设计与技术因果链

### 2.1 边栏调整大小性能优化（切断全树 Reflow 链条）
1. **PointerMove rAF 批处理合并**：
   - 指针事件（鼠标/触摸板）每秒可派发上百次，直接同步写 `style.setProperty('--rail-w-left', ...)` 造成高频样式计算。
   - 引入 `requestAnimationFrame` 状态锁（`resizeRafPending`），每个渲染周期（vsync）仅提交一次最终宽度，合并高频无效写入。
2. **CSS 离屏遏制（`content-visibility: auto` 与 `contain`）**：
   - 中间消息流采用 `flex: 1` 伸缩，边栏变动会改变中场宽度，迫使所有子消息重新计算文本折行与布局。
   - 对 `.conv-turn` 与 `.msg-row` 应用 `content-visibility: auto; contain-intrinsic-size: auto 80px; contain: layout style;`。
   - 浏览器引擎自动感知视口，视口外的上千条历史消息直接跳过排版与绘制，重排开销降为 $O(1)$。
3. **消除通配符样式匹配**：
   - 废除 `html[data-rail-resizing] *`，避免数万节点全局样式重算。

### 2.2 缓存容量扩容与翻页接口扩展（Core CacheService）
1. **扩容上限**：
   - `DEFAULT_MESSAGE_CAP` 从 500 升级至 5000，并在 options 中保持可配置。
2. **新增向上翻页查询接口**：
   - 利用 `ICacheStore` 已有的 `beforeOrderKey` 原生能力，在 `CacheService` 暴露 `readOlderRows(ref, beforeOrderKey, limit)`。
   - 保持严格通道串行锁 `withChannelLock`，避免与在途写入冲突。

### 2.3 消息翻页本地优先与动量保护（Desktop Renderer）
1. **本地优先加载策略**：
   - `loadOlderMessages()` 先获取当前视口中最旧消息的 `rowId` 作为 `beforeOrderKey`。
   - 优先调用 `cacheService.readOlderRows(cacheRef, beforeOrderKey, 100)`。
   - 若本地命中，直接使用 `planOlderBatchPrependMerge` 拼入顶部，0ms 极速呈现。
   - 仅当本地返回空（本地耗尽）时，才向网关发起 `fetchSessionMessages`，并在返回后持久化回写本地缓存。
2. **预加载提前量调大**：
   - 将触顶判断从硬编码的 `scrollTop < 240` 调整为 `scrollTop < Math.max(800, clientHeight * 1.0)`。
   - 在用户离顶部还有一整屏时静默拉取并挂载，保证 `scrollTop` 永不触碰物理 0，彻底防止浏览器杀掉惯性动量。
3. **向上滑动手势放行**：
   - 在本地仍有未呈现数据或正处于向上滑动手势时，放宽冷却拦截，保障连续滑动的自然跟手性。
