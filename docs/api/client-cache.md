# 客户端缓存组件 · 接口使用说明

> 代码位置：`packages/core/src/cache/`（纯逻辑 + 存储抽象）、`packages/desktop/src/renderer/cache/`（桌面适配器）
> **原理与流程图**：[`client-cache-principles.md`](./client-cache-principles.md)（为什么这么设计、数据怎么流动）
> 设计文档：[`../architecture/client-cache-and-multi-client-sync-spec.md`](../architecture/client-cache-and-multi-client-sync-spec.md)
> 形式化验证：[`../../.claude/skills/verify-cache-invariants/SKILL.md`](../../.claude/skills/verify-cache-invariants/SKILL.md)

---

## 一、它是什么，不是什么

**是**：一个"启动快照 + 消息尾部"的持久化组件。冷启动时把上次的会话列表和消息正文立刻喂给 `state`，让用户不用等网络。

**不是**：

| 不是 | 为什么 |
|---|---|
| 读穿透缓存 | 运行期所有读都走内存 `state`。缓存只在启动时读一次、权威结果到达后写一次 |
| 数据库 | 不做 schema 迁移、不做事务回滚、不做跨表关联 |
| 权威源 | 权威永远是网关。缓存只是它的一份副本，随时可被覆盖或丢弃 |
| 通用 KV | 消息表按 `(profile, channel, channelId, orderKey)` 四元组索引，不是普通键值 |

一句话：**缓存不参与运行期读路径**。让缓存参与读路径，就必须回答 TTL、写穿透、冲突仲裁，复杂度会指数上升，而收益只是省一次 50ms 的请求。

---

## 二、快速开始

```ts
import { CacheService, type ICacheStore } from '@hermes-flux/core';
import { DesktopCacheStore } from './cache/DesktopCacheStore.js';

const cache = new CacheService(new DesktopCacheStore(), {
  sessionCap: 200,   // 会话 + 群聊共享池上限
  messageCap: 500,   // 每会话消息行上限
});

// 冷启动：先出图
const rows = await cache.readSessions();
state.sessions = rows.filter((r) => r.kind === 'session').map(toViewModel);
state.groupRooms = rows.filter((r) => r.kind === 'group').map(toGroupView);
render();

// 后台对齐完成后：写回
await cache.writeSessions([...groupRows, ...sessionRows]);
```

换平台只需要实现 `ICacheStore`（8 个方法），`CacheService` 一行不用改。

---

## 三、三个必须记住的概念

### 3.1 `orderKey`：唯一的排序与去重依据

| 通道 | `orderKey` 来自 | 说明 |
|---|---|---|
| `session` | 网关行号 `rowId` | REST 行里字段名是 `id`（数字），不是 `row_id` |
| `room` | 群聊事件序号 `seq` | 群聊**没有** `rowId` |

**不要用 `timestamp` 排序**：秒级时间戳归一化后会同秒并列，且客户端时钟与服务端时钟不可比。

### 3.2 `channel` + `channelId`：消息归属

```ts
const ref = { profile: 'default', channel: 'session', channelId: '20261104_105511_e228c5' };
const roomRef = { profile: '', channel: 'room', channelId: 'room-abc' };
```

群聊的 `profile` 固定为空串——hosted rooms 存在网关根库，不属于任何 Profile。写错会让同一房间在不同端产生不同主键。

### 3.3 信封：所有索引都带版本

```jsonc
{ "v": 1, "savedAt": 1730000000000, "items": [ /* ... */ ] }
```

`v` 不匹配直接丢弃重建。**不要写迁移代码**——索引条目少，重建成本等于一次网络请求。

---

## 四、`ICacheStore`：存储适配器接口

实现这个接口就能换介质。参考实现：`MemoryCacheStore`（内存）、`DesktopCacheStore`（localStorage + IndexedDB）。

```ts
interface ICacheStore {
  readIndex(key: CacheIndexKey): Promise<unknown | null>;
  writeIndex(key: CacheIndexKey, value: unknown): Promise<void>;
  removeIndex(key: CacheIndexKey): Promise<void>;

  putMessages(rows: readonly CachedMessageRow[]): Promise<void>;
  listMessages(query: MessageListQuery): Promise<CachedMessageRow[]>;
  deleteMessages(query: MessageDeleteQuery): Promise<number>;
  countMessages(ref: CacheChannelRef): Promise<number>;
  trimChannel(ref: CacheChannelRef, keep: number): Promise<number>;
  dropChannel(ref: CacheChannelRef): Promise<number>;
}
```

| 方法 | 语义要求 |
|---|---|
| `readIndex` | 返回 `null` 表示不存在**或不可读**；不要抛错 |
| `writeIndex` | 整键覆盖，不做部分合并 |
| `putMessages` | 同主键覆盖；单次调用内原子 |
| `listMessages` | 按 `orderKey` **倒序**；`beforeOrderKey` 表示 `<` 不是 `<=` |
| `deleteMessages` | 不传 `aboveOrderKey` 表示删该通道全部；传了表示 `>` |
| `trimChannel` | 只保留最近 `keep` 条，按 `orderKey` 升序删最旧 |

**区间计算不要自己写**，用导出的纯函数：

```ts
import { buildChannelBounds } from '@hermes-flux/core';

const b = buildChannelBounds(ref, 'list-before', 50);
// b.lower = [profile, channel, channelId, 0]
// b.upper = [profile, channel, channelId, 49]
```

它保证三件事：四元组前缀不跨通道、`list-before` 减一、`delete-above` 加一。这三种边界写错都不会报错，只会多带或少带一行。

---

## 五、`CacheService`：编排层

### 5.1 索引

```ts
readSessions(): Promise<CachedSessionSummary[]>        // 会话 + 群聊混合，用 kind 区分
writeSessions(rows): Promise<CachedSessionSummary[]>   // 按 timestamp 倒序裁剪到 sessionCap
readAgents(): Promise<CachedAgentSummary[]>
writeAgents(rows): Promise<void>
readAvatars(): Promise<Record<string, string>>
writeAvatars(items): Promise<void>                     // 非 data:image/ 前缀的项被丢弃
```

**写入时会裁剪**：`writeSessions` 按 `timestamp` 倒序保留前 `sessionCap` 条，返回实际保留的数组。

**会话与群聊共享同一个键**，所以写入时必须只替换自己那一半：

```ts
// 写会话时保留群聊
const existing = await cache.readSessions();
const groups = existing.filter((r) => r.kind === 'group');
await cache.writeSessions([...groups, ...sessions]);

// 写群聊时保留会话
const sessions = existing.filter((r) => r.kind === 'session');
await cache.writeSessions([...sessions, ...rooms]);
```

两个异步写并发会互相覆盖，调用方需要串行化（renderer 里用 `indexWriteTail` 链）。

### 5.2 消息

```ts
openChannel(ref, limit): Promise<{ rows, fenceMax }>
```

打开通道。`rows` 是倒序（新→旧），`fenceMax` 是**当前本地最大 orderKey**。

```ts
appendRows(ref, rows): Promise<{ written, evictedKeys }>
```

实时写入（`message.complete` / `tool.*` 聚合后）。写完立即按 `messageCap` 淘汰。

```ts
applyRemoteWindow(ref, remote, fenceMax, pendingKeys?): Promise<{ rows, evictedKeys, remoteMax }>
```

把一次远端窗口合并进本地。**`fenceMax` 必须是发起请求前的基线**，见第六节。

```ts
truncate(ref, targetOrderKey, survivorMap): Promise<{ rows, removed }>
```

应用截断。`survivorMap` 是 `Map<旧orderKey, 新orderKey | null>`。

```ts
dropChannel(ref): Promise<number>
```

删除整个通道（删除会话时用）。

### 5.3 纯函数（可单独使用）

```ts
sortByOrderAsc(rows)
upsertMessageRows(existing, incoming)      // 幂等；同主键按字段完整度择优
mergeRemoteWindow({ local, remote, fenceMax, remoteMax, pendingKeys })
applyTruncation({ rows, targetOrderKey, survivorMap })
evictToCap(rows, cap)
maxOrderKey(rows)
buildChannelBounds(ref, mode, boundary?)
```

---

## 六、四个典型场景

### 6.1 冷启动

```ts
const rows = await cache.readSessions();
const agents = await cache.readAgents();

if (state.sessions.length === 0) {
  state.sessions = rows.filter((r) => r.kind === 'session').map(toNormalizedSession);
}
if (state.groupRooms.length === 0) {
  state.groupRooms = rows.filter((r) => r.kind === 'group').map(toGroupRoom);
}
if (state.profiles.length === 0) {
  state.profiles = agents.map(toAgentProfile);
}
render();  // 立即出图，不等网络
```

**只在 `state` 为空时填充**，否则会覆盖网络已拉到的更新数据。

### 6.2 打开会话（fence 的正确用法）

```ts
const ref = { profile, channel: 'session', channelId: sessionId };

// ① 先取基线
const { rows, fenceMax } = await cache.openChannel(ref, 500);
if (rows.length > 0) {
  state.messages = rows.map(toViewModel).reverse();
  render();
}

// ② 再拉远端
const outcome = await client.fetchSessionMessages(sessionId, { limit: 50, order: 'latest' });

// ③ 合并时把基线原样传回
if (outcome.status === 'success') {
  const remote = outcome.messages.map((m) => toCachedRow(m, ref));
  await cache.applyRemoteWindow(ref, remote, fenceMax);
}
```

**`fenceMax` 必须在 ② 之前取**。如果传响应到达时的本地最大值，围栏就失效了——拉取期间用户新发的消息会被判为"服务端没有的幽灵"删掉。

### 6.3 实时写入

```ts
// message.complete 到达且 persisted_turn.complete === true
await cache.appendRows(ref, [{
  profile, channel: 'session', channelId,
  orderKey: persistedTurn.final_assistant_row_id,
  role: 'assistant',
  text: payload.text,
  reasoning: payload.reasoning,
  toolCalls: collectedFromToolEvents,
  timestamp: Date.now(),
  status: 'complete',
}]);
```

`persisted_turn.complete === false` 时**不要写**——契约明确说此时行号未被证明。改为触发一次 REST 回拉。

### 6.4 截断

```ts
// 网关确认成功后
const map = new Map<number, number | null>(
  Object.entries(result.survivor_row_id_map ?? {}).map(([k, v]) => [Number(k), v])
);
await cache.truncate(ref, targetOrderKey, map);
```

**不要用"删 `> target`"替代**。截断后幸存行的 `rowId` 会变，只删超界会让旧键与新键并存，同一条消息显示两遍。

`armed` 阶段（用户点了回滚但请求还没返回）**禁止调用**，只改内存。

---

## 七、错误与降级

| 情况 | 组件行为 | 调用方该做什么 |
|---|---|---|
| JSON 损坏 | `readSessions` 返回 `[]` 并清掉该键 | 走首次安装流程 |
| 版本不符 | 同上 | 不要写迁移代码 |
| 存储配额满 | `DesktopCacheStore` 降级到内存 Map | 可选提示用户"本地缓存不可用" |
| IndexedDB 打不开 | 抛错，由调用方 catch | 降级纯内存，功能不中断 |
| 写入失败 | 抛错 | 不影响渲染；下次权威拉取会重试 |

组件**不会把失败伪装成空数据**——除了"键不存在"和"版本不符"这两种确定性的情况，其他异常都会抛出来。

---

## 八、边界与限制（必读）

1. **`orderKey` 必须来自网关**（`rowId` / `seq`）。用客户端自造 ID 会导致重启后主键对不上，产生重复消息。
2. **`hidden` 在 REST 返回里是数字 `0/1`**，不是布尔。`CachedSessionSummary.hidden` 是布尔，转换点只能有一处。
3. **群聊不写 `toolCalls`**。`RoomEvent.payload` 是自由结构，没有工具语义。
4. **消息上限按缓存行计数**，工具调用折叠进所属 assistant 行，不额外占配额。
5. **截断只对 user 行以外生效**。用户行超长时不截断——回滚会用正文填回输入框，截断后会把半截正文当新提问提交。
6. **不做多端冲突合并**。网关是唯一权威，客户端只做"覆盖 + 围栏剔除"。

---

## 九、测试与验证

```bash
# 单元测试（62 条）
node --test packages/core/__tests__/cache/cache-merge.test.mjs \
            packages/core/__tests__/cache/cache-service.test.mjs \
            packages/core/__tests__/cache/cache-bounds.test.mjs \
            packages/core/__tests__/cache/cache-edge-cases.test.mjs

# 形式化验证（5 条定理）
node --test packages/core/__tests__/formal/cache-fence-formal.test.mjs

# 端到端（真实浏览器 + 真实 IndexedDB）
npm run build:desktop
node --test packages/desktop/__tests__/cdp/cache-cold-start-cdp.test.mjs
```

改动 `cacheMerge.ts` / `CacheService.ts` / `ICacheStore.ts` / `DesktopCacheStore.ts` 后，按 `verify-cache-invariants` 技能重跑并确认 5 条定理仍获证。
