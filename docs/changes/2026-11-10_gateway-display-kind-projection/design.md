# 网关 display_kind 显示投影设计

> 状态：待复审
> 范围：Hermes Flux 客户端三包（core / ui / desktop）
> 前置审查：本文件是 `review设计方案` 结论中 6 个阻塞项的补齐版

---

## 一、目标

外部渠道消息进入工作台后，用户气泡里只显示人说的话。

网关是 NousResearch/hermes-agent 官方产品，不可改。所有判别动作在客户端完成，依据是官方已经写在 `messages` 表里的 `display_kind` 与 `display_metadata` 两列，不靠文本猜测。

最小完整变更：把这两个字段从接入边界搬到视图模型，并在渲染层按官方语义分派。

---

## 二、官方事实基线

来源：`hermes-agent.nousresearch.com/docs/developer-guide/session-storage`、`session-history.py`、`agent/prompt_builder.py`、`gateway/response_filters.py`，以及官方提交 `4546cd4`、`f1d5c99`、`a4bc1ca`。

| display_kind | 官方语义 | 官方客户端渲染 |
|---|---|---|
| `hidden` | 模型专用脚手架 | 整行跳过 |
| `model_switch` | 会话中途换模型 | 时间线标记 |
| `async_delegation_complete` | 异步子代理批量完成 | 时间线标记，带 task_count |
| `process_complete` | 后台进程结束 | 时间线标记，带 display_text |
| `steer` | 当中插话 | 用户气泡，显示原话 |
| `auto_continue` | 崩溃恢复续跑 | 时间线标记 |
| `internal_notification` | 网关自注入通知 | 时间线通知 |
| `skill_invocation` | 斜杠技能调用 | 用户气泡，显示 /skill args |

`skill_invocation` 保持用户气泡。官方 `_history_to_messages` 把技能行的 `text` 投影成 `/skill args`，它本来就是一次人类发起的调用，画成气泡是对的，因此不进 `TIMELINE_KINDS`。

官方明文约束两条。其一，`Both fields are absent for genuine user input; never infer origin from the prompt text`。其二，`[System:` 前缀的 role=user 行 `must never render as a user bubble`。

---

## 三、核心决策

### 决策 1：不删除行，保留 `state.messages` 的服务端行序

上一版设计在 `parseRawMessages` 出口删行，会同时打破四处下标依赖。改为保留全部行，只在渲染层决定画不画。

理由有三条。

1. `calculateForkCount` 是 `msgIdx + 1`，删行会让 fork 切点整体偏移。虽然官方 issue #40950 说明该值本来就与网关 raw history 行数不等，但那是既有缺陷，不能在本期叠加新的偏移。
2. `sessionServerOffset` 与分页 offset 是服务端行数口径，与本地可见行数脱钩。保留行序，两者天然一致。
3. 官方 desktop 就是这么做的。`toTranscriptMessages` 对 `hidden` 跳过，对其它 kind 映射成 `event` 行，数组长度不变。

有一条口径必须先说清楚，否则会被误读。行序守恒约束的是「客户端数组与它本次收到的服务端数组逐行对应」，不是「REST 与 RPC 两条路径行数相等」。官方 `_history_to_messages` 在 RPC 侧已经把 `hidden` 行 `continue` 掉了，所以同一会话两条路径拿到的行数本来就可能不同。这一点既有行为不变，本期不引入新的差异。

代价是窗口内会夹带不可见行。用第 5 条决策消解。

### 决策 2：唯一判别点放在 `parseRawMessages`，输出带 `displayKind` 的行

`parseRawMessages` 是 REST 与 `session.resume` 两条接入路径的唯一汇合点。判别只在这里做一次。

判别规则按优先级。

1. `m.display_kind === 'hidden'` → 标记 `hidden`
2. `m.display_kind` 命中官方枚举 → 按该 kind 标记
3. role 为 user 且正文 `lstrip().startsWith('[System:')` → 标记 `hidden`（官方同款前缀嗅探，覆盖旧版本未打标的存量行）
4. 未知 kind 或缺失 → 标记 `user`，原样显示

第 2 条排在第 3 条之前是关键。`model_switch` 行的正文本身就是 `[System: ...]`，若让前缀嗅探先跑，这条会被整行吞掉，换模型就彻底不可见了。显式标注永远高于嗅探。

第 4 条是硬规则。契约未定义的 kind 一律当普通用户消息，不得静默隐藏。

**判别只贴标签，不改正文，不删行。** 这一条是决策 1 的落地细节，也是本设计最容易写错的地方。正文一律取决策 3 那条取值链的结果，判别本身不改一个字。

`parseRawMessages` 现有第 2845 到 2855 行有一条守卫，非 assistant 且正文为空的行直接 `continue`。官方 `_project_for_display` 会把独立压缩摘要投影成 `content: ""` 加 `display_kind: "hidden"`，正文真的为空。这种行一旦被守卫删掉，行序守恒立刻失效。因此空正文守卫必须先判 kind，`kind !== 'user'` 的行无条件保留。

副作用一处。`resolveCopyContent`（`messageActions.ts:40`）复制的是 `content`，所以 `steer` 行复制出来的是用户原话，不是带 marker 的原文。这是想要的结果，无需额外改动。

### 决策 3：两条接入路径统一走一个正文取值链

REST 与 RPC 返回形状不同，这是上一版最大的漏洞。

| 路径 | 正文位置 | 是否已解包 |
|---|---|---|
| REST `/api/sessions/{id}/messages` | `display_content` 优先，`content` 兜底 | `display_content` 已由网关解好 |
| RPC `session.resume` | `text` | 已由 `_history_to_messages` 解好 |

取值链定为 `display_content → text → content`。

客户端不再自己解 `[OUT-OF-BAND USER MESSAGE]` 包装。官方 `4546cd4` 已经在 REST 侧把用户原话放进 `display_content`，本地再解一遍是重复校验不可靠输入。

### 决策 4：`display_metadata` 必须窄化后再用

官方 `0c40f00` 明确旧后端会返回未解析的 JSON 文本。直接 `in` 索引会抛 TypeError，官方 desktop 因此白屏过一次（issue #70586）。

窄化规则：先判 `typeof === 'string'` 则 `JSON.parse` 兜底，再判是否对象，然后只取两个字段。`task_count` 必须是有限数字，`display_text` 必须是字符串。

### 决策 5：窗口与平均行高保持下标口径

保留不可见行会让「窗口条数」与「DOM 行数」分离。这里不改分母口径，仍然用窗口下标条数。

理由。虚拟坐标系本来就按**下标**推进：`computeContentOffsetPx = messageWindowStart × 平均行高`，`computeVirtualHeightPx = 总条数 × 平均行高`。若把分母改成可见行数，`contentH / 可见数` 得到的平均行高乘以下标起点会系统性地偏大，滚动条位置反而不准。保持 `平均行高 = contentH / 下标条数`，则 `窗口占位 = 下标跨度 × 平均行高 ≡ contentH`，自洽。

隐藏行是低频事件（压缩交接、换模型），偏差可忽略。`index.ts` 的 `lockAverageRowHeight` 与 `computeVirtualHeightPx` 因此只需加注释说明，不改逻辑。

### 决策 6：`findPreviousUserPrompt` 与左侧栏预览跳过非人类行

`findPreviousUserPrompt` 取最后一条 `role === 'user'`，而 `[System:` 行与 `steer` 行都是 role=user。回滚后会把机器文本回填进输入框。

改为取最后一条 `displayKind === 'user'`。

`syncActiveSessionPreviewToRail` 同理，避免左侧栏副标题显示机器文本。

还有第三处，容易被漏。`bindTurnRowIds`（`rollbackTransaction.ts:236-246`）把 `persisted_turn.user_row_id` 绑定到助手行之前最近一条 `role === 'user'` 的行。若最近那条是 `steer` 行或 `[System:` 行，回滚锚点就会绑到错误的行上，下一次回滚截断错位置。改为只匹配 `displayKind === 'user'` 的行。

这一处是本期唯一会让回滚出错的地方，必须和 `findPreviousUserPrompt` 一起改。

### 决策 7：与既有 compactionFilter 的关系

`packages/core/src/session/compactionFilter.ts` 是当前唯一在跑的用户气泡过滤器，靠 `[CONTEXT COMPACTION` 前缀切分。它是 display_kind 缺失时期的文本兜底。

本期不删除它，但降级为二级兜底。执行顺序定为先 kind 后前缀。`displayKind === 'hidden'` 时直接不上屏，不再走 `sanitizeCompactedMessage`。kind 缺失时才回落到现有前缀切分。

理由。官方 `_project_for_display` 会把独立压缩摘要投影成 `content: ""` 加 `display_kind: "hidden"`，也就是新会话已经有 kind。存量会话没有，仍需前缀兜底。两条路径并存但优先级明确，不会互相打架。

`packages/desktop/src/renderer/index.ts:2991` 那段 `text.startsWith('[CONTEXT COMPACTION')` 的翻页过滤同理，改为优先看 kind。

### 决策 8：分组与末条判定必须跳过不可见行

保留不可见行会带来两个渲染层副作用，都要一并处理。

其一，`groupTurns`（`TurnGroup.tsx:133`）按 role 连续分组。若某个回合全部由 `hidden` 行组成，`MessageRow` 全部返回 null，但 `TurnGroup` 仍会输出一个带 `data-conv-turn` 的空 div，制造无意义间距。**在 `ConversationMessageList` 里分组前先剔除 `renderable === false` 的行**。这一层过滤只影响视图，不动 `state.messages`，因此行序与 `decideConversationPush` 的 id 对账都不受影响。

其二，`buildConversationSnapshot`（`index.ts:5951`）的 `lastMessageId` 取窗口末条。若末条是隐藏行，真正可见的最后一条就拿不到 `isLastInTurn` 与流式状态。改为取**窗口内最后一条可见行**的 id。

这两处是决策 1 的必要配套，漏掉任何一处都会出现「有一条消息不显示页脚」或「对话末尾多出一段空白」。

### 决策 9：样本 1 的无标注来源块，接受有限兜底

`Gateway message origin (JSON data, ...)` 由 `gateway/run_busy.py:478` 产生，官方 issue #127973 承认它尚未打标。这是官方缺口，不是我们能补的。

兜底条件写死三条全中才剥。首行为该固定声明，次行为可解析 JSON 且含 `platform` 键，第三行为固定收尾句。任一不满足即原样显示。

这条是有意接受的妥协，不是判别通道。风险是用户恰好手打这三行，概率极低且后果只是少显示一段文本，不会删掉用户真实提问（真实提问在这三行之后）。

---

## 四、数据形状

### 判别结果

```ts
/** 官方单聊消息的显示类型；'user' 表示真实人类正文。 */
export type MessageDisplayKind =
  | 'user'
  | 'hidden'
  | 'model_switch'
  | 'async_delegation_complete'
  | 'process_complete'
  | 'steer'
  | 'auto_continue'
  | 'internal_notification'
  | 'skill_invocation';
```

### 窄化后的元数据

```ts
export interface MessageDisplayMetadata {
  task_count?: number;
  display_text?: string;
}
```

### 三处视图模型各加两个可选字段

`MessageViewModel`（`MiddlePod.ts:19`）、`CachedMessageRow`（`cache/types.ts:77`）、`ConversationMessageVM`（`conversation/types.ts:28`）统一追加：

```ts
displayKind?: MessageDisplayKind;
displayMetadata?: MessageDisplayMetadata;
```

三个字段全部可选，缺失即 `'user'`。这条保证旧缓存行、旧网关、本地乐观行三者都无需迁移。

`renderable` 不进持久层。它是 `displayKind` 的纯派生量（`displayKind !== 'hidden'`），落盘会引入两份真相。缓存行只存 `displayKind`，还原时由 `projectDisplay` 或一个一行的 `isRenderable(kind)` 复算。

### 判别纯函数

新增 `packages/core/src/session/displayKind.ts`。

```ts
export interface RawDisplayInput {
  role: string;
  displayKind?: unknown;
  displayContent?: unknown;
  text?: unknown;
  content?: unknown;
  metadata?: unknown;
}

export interface DisplayProjection {
  kind: MessageDisplayKind;
  /** 已经过取值链的正文；hidden 时仍保留原文，只由 renderable 决定画不画 */
  text: string;
  /** 是否上屏。仅 hidden 为 false；其余为 true */
  renderable: boolean;
  metadata?: MessageDisplayMetadata;
}

export function projectDisplay(input: RawDisplayInput): DisplayProjection;
```

纯函数，零 IO，可单测。`hidden` 行的 `text` 保留原文，`renderable` 为 false。这样 `parseRawMessages` 既能保住行序，缓存里也留着可回溯的原始内容。

---

## 五、改动清单

### core

| 文件 | 改动 |
|---|---|
| `src/session/displayKind.ts` | 新建，`projectDisplay` 与两个类型 |
| `src/index.ts` | 导出新模块 |
| `src/rpc/client.ts:112` | `SessionMessageRecord` 无需改动，它已是开放索引签名；仅在注释里登记三个已知字段名 |
| `src/cache/types.ts:77` | `CachedMessageRow` 追加两个可选字段 |

### ui

| 文件 | 改动 |
|---|---|
| `src/components/MiddlePod/MiddlePod.ts:19` | `MessageViewModel` 追加两个可选字段 |
| `src/components-react/conversation/types.ts:28` | `ConversationMessageVM` 追加两个可选字段 |
| `src/components-react/conversation/MessageRow.tsx` | `renderable === false` 返回 null；时间线类 kind 渲染标记行；`steer` 走用户气泡但正文用投影结果 |
| `src/components-react/conversation/ConversationMessageList.tsx:19` | `groupTurns` 前剔除不可见行，避免空回合 div |
| `src/components-react/conversation/TurnGroup.tsx:41` | `areEqual` 增加 `displayKind` 比较，否则标记行不随类型切换刷新 |
| `src/i18n/index.ts` | 新增 5 个 key，zh 与 en 同步 |

### desktop

| 文件 | 改动 |
|---|---|
| `src/renderer/index.ts:2677` `parseRawMessages` | 改为薄包装，实现在 `transcriptRows.ts` |
| `src/renderer/transcriptRows.ts` | 新建，网关行 → 视图模型的纯函数（唯一翻译点，可直接单测） |
| `src/renderer/index.ts:258` `toMessageViewModel` | 缓存行还原时带回两个字段 |
| `src/renderer/index.ts:283` `toCachedMessage` | 落缓存时写入两个字段 |
| `src/renderer/index.ts:5977` `buildConversationSnapshot` | 快照映射带上两个字段；`lastMessageId` 改取窗口内最后一条可见行 |
| `src/renderer/index.ts:5856` `conversationVmCache` | 缓存键加入 `displayKind`，否则同文本不同 kind 命中旧对象 |
| `src/renderer/index.ts:5897` `lockAverageRowHeight` | 分母改为窗口内可见行数 |
| `src/renderer/index.ts:5939` 虚拟高度 | 分子改为全量可见行数 |
| `src/renderer/index.ts:3085` 左侧栏预览 | 取最后一条可见消息 |
| `src/renderer/index.ts:2991` 翻页压缩过滤 | 优先看 kind，kind 缺失才回落到 `[CONTEXT COMPACTION` 前缀 |
| `src/renderer/messageActions.ts:59` `findPreviousUserPrompt` | 跳过非 `'user'` kind |
| `src/renderer/rollbackTransaction.ts:236` `bindTurnRowIds` | 绑定 user_row_id 时跳过非 `'user'` kind，否则回滚锚点绑到机器行 |
| `src/renderer/index.ts` `exportMarkdown` | 导出口径与视图一致：hidden 不导出，事件标 `### Event` |

### 保留但降级

`packages/core/src/session/compactionFilter.ts` 的 `sanitizeCompactedMessage` 保留，作为 kind 缺失时的二级兜底。调用点从「无条件执行」改为「仅当 `displayKind` 为 `'user'` 时执行」。存量会话靠它，新会话靠 kind。

### 不动的部分

不碰 `CachedMessageRow` 的主键与 `orderKey` 语义，只加两个旁路字段，缓存合并与淘汰逻辑不受影响。

不碰 `session.branch` 的 `count` 计算。那是上游 issue #40950 记录的既有缺陷，本期只保证不叠加新偏移。

不碰群聊。`groups.log` 的 `GroupMessageEntry` 没有该字段，本期范围外。

---

## 六、i18n 新增 key

| key | zh | en |
|---|---|---|
| `conversation.modelChanged` | 已切换模型 | Model Changed |
| `conversation.backgroundFinished` | 后台进程已结束 | Background Process Finished |
| `conversation.delegationFinished` | 后台任务已完成 | Background Agents Finished |
| `conversation.systemNotice` | 系统通知 | System Notice |
| `conversation.autoContinued` | 会话已自动续跑 | Session Auto-Continued |

`async_delegation_complete` 有 `task_count` 时渲染为 `后台任务已完成 · {count}`，无则退化为不带计数。

---

## 七、不变量与失败模式

| 不变量 | 违反后果 | 守卫 |
|---|---|---|
| `state.messages` 行序恒等于本次收到的服务端数组 | fork 切点漂移、分页 offset 错位 | `parseRawMessages` 不删行，单测断言输出长度等于输入长度 |
| 未知 kind 恒按 `user` 显示 | 静默吞掉用户真实消息 | 单测穷举未知字符串与 null |
| `hidden` 行只标记不上屏，正文不丢 | 空气泡占位，或行被空正文守卫删掉 | 单测断言 `renderable === false` 且 `text` 非空 |
| 全隐藏回合成不了空 div | 对话末尾多余间距 | ui 单测断言全 hidden 输入不产出 `data-conv-turn` |
| 末条可见行仍拿到页脚与流式态 | 最后一条无时间与操作按钮 | desktop 单测断言末条为 hidden 时 `isLastInTurn` 落在前一条可见行 |
| 两条接入路径正文一致 | REST 与 RPC 切换后同一消息显示不同 | 单测用同一逻辑行分别构造两份输入，断言投影结果相等 |
| `display_metadata` 为字符串时不抛异常 | 整块消息区白屏 | 单测喂 JSON 文本与非 JSON 文本各一次 |

---

## 八、测试计划

### core 单测 `packages/core/__tests__/session/display-kind.test.mjs`

- 八种官方 kind 逐个断言投影结果。
- 未知 kind、`null`、缺字段三种输入断言回落到 `user`。
- 四条真实样本逐条断言：样本 1 剥壳、样本 2 三段拆分、样本 3 取原话、样本 4 画时间线标记。
- `display_metadata` 三态：对象、JSON 字符串、非法字符串。
- 反例：正文正常出现 `background process` 字样且无 kind 时不得被切。

### desktop 单测 `packages/desktop/__tests__/unit/display-kind-wiring.test.mjs`

- `parseRawMessages` 输入 N 行输出 N 行，长度守恒。
- `displayKind` 能穿过 `toCachedMessage` → `toMessageViewModel` 往返不丢。
- `findPreviousUserPrompt` 跳过 `[System:` 行。

### ui 单测 `packages/ui/__tests__/conversation-stage.test.mjs` 追加

- `hidden` 行不产出 `data-msg-id` 节点。
- `hidden` 行仍留在 `state.messages`，长度守恒断言在 desktop 侧。
- `model_switch` 行产出标记节点且不含用户气泡类名。
- 两套视图模型字段集合一致（防漂移断言）。

### 门禁与实证

- `npm run gates:changed`、`npm run typecheck`、`npm test`。
- CDP 注入四条样本，截图对比修复前后气泡高度。

---

## 九、未闭环项

`display_metadata.process_complete.display_text` 的准确键名未实测。设计按 `display_text` 写，落地前抓一条真实行确认。若键名不符，退化路径是渲染不带参数的中性文案，不会崩。

`session.branch.count` 是否计入 display_kind 行，未取证。本期不依赖该答案。

---

## 十、补齐对照

本文件针对前置审查的 6 个阻塞项逐条补齐。

| 阻塞项 | 补齐位置 |
|---|---|
| 过滤层未决策 | 决策 1 与决策 2，明确不删行、只贴标签 |
| 改动点漏视图模型与快照缓存 | 第五节三张表逐条列出，core 3 处、ui 6 处、desktop 11 处 |
| 未读 `display_content` | 决策 3 的取值链 |
| `display_metadata` 未窄化 | 决策 4 |
| fork count 与 offset 会被删行破坏 | 决策 1，不删行即不破坏 |
| `session.branch.count` 语义未取证 | 第九节未闭环项，本期不依赖 |

审查中的 4 个重要问题同样归位。样本 1 无官方标注归决策 9，`findPreviousUserPrompt` 归决策 6，冷启动缓存归决策 1 与第四节字段设计，群聊范围归第五节不动的部分。

审查报告未覆盖、本轮自查补出的 3 处，一并写入。

- 空正文守卫会删掉 `hidden` 行，破坏行序守恒（决策 2）。
- 全隐藏回合会渲染出空 `data-conv-turn` div（决策 8）。
- `bindTurnRowIds` 会把回滚锚点绑到 `steer` 行（决策 6）。

---

## 十一、回滚方案

改动全部是新增可选字段加判别分支，无 schema 迁移。回滚即 revert 代码。

唯一残留是 IndexedDB 里已写入的 `displayKind` 字段。旧代码读它不到，会忽略，不影响任何行为。
