# 客户端缓存 · 进度与交接

> **最后更新**：2026-11-06 17:32，基线提交 `c13fcba`（已推送到 `origin/feat/gateway-api-full-verification`）
> **换机器接手先读这一页，再读 [`client-cache-principles.md`](./client-cache-principles.md) 的原理部分。**
>
> 同类文档：API 手册 [`client-cache.md`](./client-cache.md) ｜ 设计决策 [`../architecture/client-cache-and-multi-client-sync-spec.md`](../architecture/client-cache-and-multi-client-sync-spec.md)

---

## 一、现在是什么状态（一句话）

**列表能冷启动、消息能离线读、围栏防误删已证明；截断删盘与离线弹层两个缺口未做。**

---

## 二、换机器后 5 分钟恢复环境

```bash
git clone https://github.com/SenZh/hermes-flux.git
cd hermes-flux
git checkout feat/gateway-api-full-verification
npm install                      # 或 bun install --frozen-lockfile
npm run build:core               # core 产物，单测依赖它
npm run build:desktop            # E2E 依赖 dist/renderer
```

> 在工作树而非主仓库里工作时，`node_modules` 不会被复制。需要软链：
> ```powershell
> cmd /c mklink /J node_modules D:\ws\hermes-aura\node_modules
> cmd /c mklink /J packages\ui\node_modules D:\ws\hermes-aura\packages\ui\node_modules
> cmd /c mklink /J packages\desktop\node_modules D:\ws\hermes-aura\packages\desktop\node_modules
> ```

### 跑一遍确认环境没问题

```bash
node --test packages/core/__tests__/cache/*.test.mjs       # 62 条，约 0.2s
node --test packages/core/__tests__/formal/               # 32 条，约 0.5s
node --test packages/desktop/__tests__/cdp/cache-cold-start-cdp.test.mjs  # 11 条，约 13s
```

三条全绿 = 环境就绪，可以继续下面任何一项。

---

## 三、已完成（可验证的）

| # | 能力 | 验证方式 | 状态 |
|---|---|---|---|
| 1 | 会话 / 群聊 / Agent 索引落盘（localStorage） | 单测 + E2E | ✅ |
| 2 | 消息正文落盘（IndexedDB，每会话 500 行） | 单测 + E2E | ✅ |
| 3 | 冷启动先出图（`restoreCacheToState` 在 `connect()` 前） | E2E | ✅ |
| 4 | 权威结果回写缓存（全量成功才写） | E2E | ✅ |
| 5 | 围栏防误删在途写入 | 定理 22 + 单测 + E2E | ✅ |
| 6 | 截断按 `survivor_row_id_map` 重绑定 | 定理 24 + 单测 | ✅ |
| 7 | 群聊权威门（`groups.list` 失败不再清空） | E2E | ✅ |
| 8 | 离线读消息正文 | E2E（`state.messages` 层面） | ✅ |
| 9 | 会话索引 / 消息删除（手工删除） | 单测 | ✅ |

**验证命令**

```bash
npm run typecheck                                   # 0 错误
node scripts/gates/run.mjs --changed                # 新增违规 0
npm test                                            # 710 / 707 / 0 失败
npm run verify:formal                               # 32 / 32
node --test packages/desktop/__tests__/cdp/cache-cold-start-cdp.test.mjs   # 11 / 11
```

---

## 四、待办（按优先级）

### P0-1：截断删除路径未接线

**缺什么**
`cacheService.truncate(ref, targetOrderKey, survivorMap)` 写好了、有定理 24 保证，但**renderer 从来没调用它**。用户回滚截断后，磁盘里的旧消息还在，重启会复活。

**从哪下手**

| 找什么 | 在哪 |
|---|---|
| 回滚的 armed 阶段（只改内存） | `renderer/index.ts` 搜 `applyOptimisticCut` |
| 回滚成功分支（拿 `survivor_row_id_map`） | 搜 `prompt.submit` 的 `truncate_before_row_id` 调用点 |
| 回滚失败/取消恢复 | 搜 `armedSnapshotForRestore` |
| 该调用的服务方法 | `packages/core/src/cache/CacheService.ts` → `truncate` |

**必须遵守的三阶段**（见 `client-cache-principles.md` 第五章 5.4）

```text
armed      → 只改内存 + 存内存快照，磁盘完全不动
成功       → 读 result.survivor_row_id_map，传进 cacheService.truncate
失败/取消  → 恢复内存快照，磁盘从未被触碰
超时       → 内存标 stale + 立即回拉，磁盘不恢复也不删
```

**完成标准**

- 新增 E2E 用例：回滚成功 → 重载 → 被截断的消息不得复现
- 新增 E2E 用例：回滚失败/取消 → 重载 → 历史完整
- `npm run verify:formal` 仍 32/32

---

### P0-2：离线时弹"未连接网关"遮罩

**缺什么**
缓存读进了 `state.messages`，但页面上被连接弹层盖住，用户看不到。E2E 里已留下证据：
`artifacts/verification/cache-offline-blocked-by-connect-panel.txt`

**这是个产品决策，不是纯技术问题**，先定行为再动手：

| 选项 | 说明 |
|---|---|
| A | 离线时**不弹层**，顶部显示"离线"标识，允许浏览缓存内容，写操作禁用 |
| B | 保留弹层，但提供"仅浏览历史"入口 |
| C | 维持现状，把缓存仅当作快速显示（在线时有用） |

`client-cache-principles.md` 第一章写的是"离线可用"，按那个口径应选 A 或 B。**选哪个需要产品确认。**

**完成标准**

- 离线状态下左轨可见、点会话能读到正文（DOM 层面，不只是 `state`）
- E2E 把 `cache-offline-blocked-by-connect-panel` 那个降级记录改回硬断言

---

### P1：其余已知限制

| 项 | 现状 | 要不要做 |
|---|---|---|
| 群聊消息正文缓存 | 只缓存了房间索引，没缓存 `groups.log` 的历史 | 需要时做，`groups.log(since_seq)` 已支持游标 |
| `session.events.since` 增量补拉 | 未接 | 断线超 50 条才缺，桌面端少见，可延后 |
| Agent 无事件 → 聚焦拉取 | 已实现 `profiles.list` 在启动/重连时拉，`window.focus` 未接 | 半行代码的事 |
| 旧 localStorage 键迁移 | `hermes_flux_session_previews` / `bot_activity` 仍在用 | 与缓存并存，会形成两个副标题真值源，需统一 |
| 多端并发写同一会话 | 只覆盖单端 | 网关单权威，暂可接受 |

---

## 五、接手前必须知道的坑

1. **`fenceMax` 必须在发 REST 之前取**
   `openChannel` 返回它，`applyRemoteWindow` 收回它。传响应到达时的本地最大值会让围栏失效，删掉在途新消息。

2. **截断不能退化成"删 > target"**
   网关会重编幸存行 `rowId`，只删超界会导致同一消息存两份。

3. **`orderKey` 只能用网关给的**
   `session` 用 `rowId`（REST 字段名是 `id`），`room` 用 `seq`。客户端自造 ID 会在重启后产生重复消息。

4. **`hidden` 在 REST 里是数字 `0/1`**
   `CachedSessionSummary.hidden` 是布尔，转换点只能有一处。

5. **会话与群聊共用一个索引键**
   写时必须"读现有 → 只替换自己那一半 → 写回"。renderer 用 `indexWriteTail` 串行化。

6. **改了 `packages/gateway` 相关行号就要重跑 `npm run contract:doc`**
   我在 `renderer/index.ts` 顶部插代码后，`docs/gateway/*.md` 里的调用行号全部失配，pre-commit 的 Gate 0d 会拦下来。

7. **`packages/core/src/session/unifiedSessionList.ts` 是死路径**
   已从 core 导出但 desktop 零引用。不要顺手切过去，也不要在缓存任务里清理它。

---

## 六、改了代码之后要跑什么

| 改了哪 | 必跑 |
|---|---|
| `packages/core/src/cache/**` | `npm run build:core` → 62 条单测 → `npm run verify:formal` |
| `packages/desktop/src/renderer/**` | `npm run build:desktop` → 11 条 E2E → `npm test` |
| 任何提交 | pre-commit 会自动跑 Gate 0b/0c/0d + typecheck + test + formal |

`verify-cache-invariants` 技能里有"证明测试仍能失败"的变异步骤，改了围栏或区间计算后建议跟一遍。

---

## 七、关键文件地图

```text
packages/core/src/cache/
├── types.ts              领域类型、信封、版本常量
├── ICacheStore.ts        存储抽象 + buildChannelBounds
├── cacheMerge.ts         纯函数：upsert / 围栏 / 截断 / 淘汰   ← 定理守护的重点
├── MemoryCacheStore.ts   内存实现（测试 + 降级 + 行为基准）
├── CacheService.ts       编排：通道锁、信封读写、上限裁剪
└── index.ts              汇出

packages/desktop/src/renderer/cache/
└── DesktopCacheStore.ts  localStorage（索引）+ IndexedDB（消息）

packages/desktop/src/renderer/index.ts
├── cacheService 实例与 toXxx 转换        ← 搜 "const cacheService"
├── restoreCacheToState / persist*ToCache  ← 接线点
└── loadMessages 里 2.5 段                 ← 磁盘读消息

packages/core/__tests__/
├── cache/                62 条单测（merge / service / bounds / edge-cases）
└── formal/cache-fence-formal.test.mjs   定理 22~26

packages/desktop/__tests__/cdp/
└── cache-cold-start-cdp.test.mjs        11 条 E2E
```

---

## 八、提交历史（这段工作）

```text
c13fcba docs: 补齐缓存设计、交互协议与接口手册
b438456 feat(desktop): 缓存接入渲染层并补冷启动 E2E
e28773b feat(core): 新增客户端缓存子系统与围栏不变量验证
c4f13e5 feat(cache): 上一轮的多层级会话列表聚合引擎（本工作基于此）
```
