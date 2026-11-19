# 流式正文退化为一次性返回 · 根因分析与修复方案

> 分支：`dev/v0.1` · 网关：本仓 `.env` 所配真实网关（凭据不入库）
> 状态：**已修复并实机验证**（R10 PASS：上游 71 帧 / 2416ms，正文锚点写入 154 次）。本文取代 `handoff.md` 的假设排序。
> 实施与门禁记录见第八节；方案在设计评审后由 `keepEmptyAnchor` prop 改为 `anchorId` 判据（理由见 4.1-①）。
> 取证脚本：`scripts/verify/conversation-rebuild-live.mjs`（未提交，含 WS 帧时间线、rAF 心跳、`innerHTML` 写入探针、`Map.set` 调用栈探针、出站 `session_id` 探针）

---

## 一、结论

正文增量**全部到达浏览器**，也**全部进了合流缓冲并逐帧消费**，但 `tokenStreamWriter` 每帧执行 `document.getElementById('msg-content-<id>')` 时都拿到 `null`：**流式首帧的直写锚点从未存在**。直写全程空转，`content` 只在内存累积；直到 `message.complete` 把 `state.isStreaming` 翻成 false 触发一次 React 推送，`MessageRow` / `MarkdownBlock` 才首次用非空正文挂载锚点，整段一次性上屏。

两处「消除空白占位」守卫叠加造成：

| 提交 | 日期 | 文件 | 守卫 |
|---|---|---|---|
| `89ca860` | 2026-11-07 | `packages/ui/src/components-react/conversation/MarkdownBlock.tsx:36` | `if (!content.trim()) return null;` —— 空正文不产出 `#msg-content-*` 锚点 |
| `b22147c` | 2026-11-09 | `packages/ui/src/components-react/conversation/MessageRow.tsx:123` | 助手行「正文/思考/工具」全空即整行 `return null` —— 连行都不挂载 |

两次提交各自的动机都成立（消除历史回放里的空占位块、压缩归档页的空白块），但都没有意识到：**空的助手行正是流式第一帧的必经状态**，而正文直写是"只 patch 已存在锚点、绝不创建节点"的设计。

---

## 二、证据链

### 2.1 上游确实在流式（排除网关/provider/中继）

| 观测项 | 值 |
|---|---|
| `message.delta` 帧数 / 跨度 | **71 帧 / 2330ms** |
| 每帧 `text` 长度 | 1~11 字符，合计约 650 |
| `message.complete.status` | `complete` |
| 帧顶层 `params.session_id` | `aecc46f8` |
| 客户端 `prompt.submit` 的 `session_id` | `aecc46f8`（一致，排除会话过滤丢帧） |

### 2.2 reducer 与合流器均正常（排除丢帧与节奏问题）

`Map.prototype.set` 探针抓到两条调用栈，均命中本回合真实消费路径：

```
Map.set ← TokenCoalescer.push ← applyTurnActions ← handleGatewayEvent
Map.set ← TokenCoalescer.step ← tick            （rAF 内逐帧消费）
```

即 `append-content` 已产出、已入缓冲、已在 rAF 内消费。rAF 稳定 57~60Hz，`visibilityState=visible`（排除后台节流伪影）。

### 2.3 DOM 侧唯一的异常：锚点从来不存在

| 观测项 | 值 |
|---|---|
| `Element.prototype.innerHTML` 对 `id^="msg-content-"` 的写入 | **1 次**，发生在回合结束 |
| 对 `id^="msg-thought-"` 的写入 | **0 次** |
| delta 窗口内 `[id^="msg-content-"]` 最后一项 | 仍是**上一轮**的 `ast-…45009` |
| 本轮 `ast-…` 行首次出现 | delta 结束后约 300ms |
| 正文上屏形态 | 69 → 658，一次跳变 |

### 2.4 代码级闭环（三段联动）

1. 发送时 `assistantMsg.content = ''`（`turnExecutionService.ts:619-626`），`state.isStreaming = true` 后立即 `render()`（`:635-642`）。
2. 该次渲染里 `MessageRow` 命中整行判空 → `return null`，**行不挂载**；即使放行，`MarkdownBlock` 仍会因空正文 `return null`，**锚点不产出**。
3. `tokenStreamWriter.writeFlushedTokens` 的 deps 面（`tokenStreamWriter.ts:32-40`）没有 render / mount / push 能力，只能 `getElementById` 后 patch（`:124-133`）；拿到 `null` 就静默跳过，**不触发任何渲染**。

`message.complete` → `turn-completed` 时 `state.isStreaming=false`（`gatewayEventDispatcher.ts:380`）→ `decideConversationPush` 的 `justStoppedStreaming` 分支放行（`conversationPush.ts:36`）→ React 首次以非空正文挂载 → 一次 `innerHTML` 写入。

### 2.5 为什么门禁没拦住

- `packages/ui/__tests__/layout.test.mjs:180` 与 `conversation-stage.test.mjs` 的正文夹具**全为非空 content**，无「空正文 + 正在流式」用例。
- `packages/desktop/__tests__/unit/tokenStreamWriter.test.mjs` 跑在 Node，无 `document` 真实桩，`contentEl === null` 分支属未覆盖区间。

---

## 三、深层风险（修复必须一并考虑）

`renderCoordinator` 维护 `renderedMessageIds`，用于 `decideConversationPush` 判断"是否出现新 id"。当前实现把**空助手行**在 `MessageRow` 返回 `null` 的情况下也记为"已渲染"：流式期间"新 id 必须推送"的规则因此被绕过——列表认为已经挂过该行，后续不再重推。

这对修复的影响：

- 只要**发送时那次 `render()`** 能真正挂载空行（即门禁放行），锚点就位，后续无需任何重推；
- 但若修复只放宽 `MarkdownBlock` 而**不放宽 `MessageRow` 整行判空**，行仍不挂载，`renderedMessageIds` 仍记"已渲染"，锚点永远补不上——这正是必须两处同改的原因。

不拟在本轮改动 `renderCoordinator` 的记账口径（收益低、回归面大），但需作为遗留项登记。

---

## 四、修复方案（方案 A，待实施）

### 4.1 改动清单

**① `packages/ui/src/components-react/conversation/MarkdownBlock.tsx`**

不新增 prop，改用「有无 `anchorId`」作判据（**设计变更，理由见下**）：

```tsx
export interface MarkdownBlockProps {
  content: string;
  /** 流式直写锚点 ID，缺省时不生成 */
  anchorId?: string;
  className?: string;
  knownFiles?: readonly string[];
}

// 空正文一律不渲染可见容器（守 89ca860 的间距意图），但「有 anchorId」的行必须保住隐形锚点：
// tokenStreamWriter 只 patch 已存在节点，它没有 render / mount 能力；流式首帧正文必然为空，
// 此处 return null 会让后续每一帧直写空转，直到回合结束才整段一次上屏。
// 锚点以 display:none 隐形存在、首帧直写时由 writer 的 none → flex 翻牌点亮。
if (!content.trim()) {
  if (!anchorId) return null;
  return <div id={anchorId} className={`conv-markdown${className ? ` ${className}` : ''}`} style={{ display: 'none' }} />;
}

return <div id={anchorId} … dangerouslySetInnerHTML={{ __html: html }} />;
```

**为何放弃 `keepEmptyAnchor` prop**：设计初稿用额外 prop 精确放行「流式末行」，但那要求 `MessageRow` 里那行 `<MarkdownBlock … />` 新增实参——该行在产物中属于同一条 `_jsxs(...)` 语句，`sourcemap` 不产生独立执行记录，`coverage:new` 会把它判成「新增可映射行 0 覆盖」。改为组件内按 `anchorId` 自洽判定后，`MessageRow` 的调用行**完全不动**，且任何带锚点语义的空正文行（含未来新增场景）都天然可被直写。

**② `packages/ui/src/components-react/conversation/MessageRow.tsx`**（只改整行守卫，调用行不动）

```tsx
// 【流式锚点契约】isStreaming 的精确语义是「当前回合的最后一行」：
// ConversationMessageList:147 → TurnGroup:126 双重收窄，历史回合恒为 false。
// 空助手行是流式首帧的必经状态，此时必须挂载行，否则 #msg-content-* 锚点不存在，
// tokenStreamWriter 的直写全部空转。
// 【唯一真值源】挂载只认本 prop；VM 的 message.isStreaming（renderCoordinator.ts:269-270）
// 语义是「窗口内最后一条可见消息」，只用于状态标签，不得作为挂锚点依据。
if (!isUser && !hasContent && !hasThought && !hasTools && !isStreaming) {
  return null;
}
```

**为什么不回潮 `89ca860` / `b22147c` 的原始意图**：`isStreaming` 只对"当前流式回合的最后一行"为真；历史回放行、压缩归档页的中间助手行全部保持 `false`，空占位块不会再出现。非流式但有工具的助手行即使走到 `MarkdownBlock`，拿到的也是 `display:none` 的隐形锚点，高度为 0、不参与 flex 布局。

**③ `packages/desktop/src/renderer/stream/tokenStreamWriter.ts`（方案 A 的必要配套，不是可选优化）**

```ts
const contentEl = document.getElementById(`msg-content-${targetMsg.id}`);
if (!contentEl) {
  // 【可观测性 (Why)】直写依赖锚点已存在，而 renderCoordinator.ts:351-354 在
  // requestUpdate 返回后就把 id 记为「已渲染」——提交若未落地，锚点缺失将长期无人发现，
  // 症状与未修复时完全一致。缺锚点必须留痕并计数，供 R10 断言为 0。
  // 【为何不把 setMessageContent 也计数】终态收敛路径（index.ts 的 setMessageContent）
  // 只写 state + 可选 DOM，不参与流式判据；在同一计数里混入非流式语义会让
  // missingAnchor 的含义漂移，且该文件已有 1500 行硬上限。观测只落在流式热路径。
  missingAnchor += 1;
  logStream.trace('stream-anchor-miss', { id: targetMsg.id });
}
```

理由（代码审查 P1-1）：方案 A 的全部收益押在"发送那次 `root.render()` 提交成功"上，而 `renderedMessageIds` 记的是"已请求渲染"而非"DOM 已存在"。没有这条观测，方案 A 会把可复现缺陷换成不可复现缺陷。此项为实施前置条件。

### 4.2 思考锚点（同构缺口，**本批不修**）

`MessageRow.tsx:190` 是 `message.thought ? <StreamRow>… : null`。思考先于正文到达，首帧 `thought` 为空 → `#msg-thought-*` 同样不存在 → 思考也只能最后一次性出现（实测 `thoughtWrites = 0`）。

**结论：本批只做正文锚点（A2），思考锚点另开改动。** 样式审查给出的否决理由（P1）：

- `StreamRow` 的 `expandable` 走 `<details class="conv-row"><summary>`，`.conv-row__summary` 有 `min-height: 32px; padding: 4px 8px; margin: 0 -8px`（`conversation.css:234-253`），`thought` 为空时只剩图标 + 箭头 + `t('conversation.thought')`，产出一条 **32px 高、可点击、展开后全空的折叠条**；
- `.conv-row__thought` 的 `margin: 4px 0 6px 8px`（`conversation.css:428-440`）即使内容为空仍占 10px，合计 **42px 首帧留白**；
- 更关键：流式期间 `decideConversationPush` 抑制重推，空壳结构**无法**在首个 thought token 到达后升级为带 target 的正常思考行（`tokenStreamWriter` 只改 `summary span:last-child` 文本，不改结构）。

若后续要做 A1，必须同时满足：空 thought 分支改用独立的「思考中」文案（新增 i18n 中英双登记）+ 微呼吸点 + `.conv-row__thought:empty { margin: 0; padding: 0; border: 0; }`，并用真实浏览器复看折叠条形态与结构升级路径。改动面远大于「改动小」，不纳入本批。

### 4.3 测试计划（先写用例，后改实现）

**断言纪律**：一律落在「行级（`data-msg-id`）」与「锚点级（`id="msg-content-*"`）」两个粒度；**禁止用 `.conv-turn` 计数**判定空行是否渲染——`TurnGroup.tsx:111-117` 无条件渲染 turn 外壳，空助手行今天也会产出 `<div class="conv-turn" data-conv-turn="ast-x">`，按它断言会因错误原因变红。

1. `packages/ui/__tests__/conversation-stage.test.mjs`｜**流式空行产锚点**（修复前必红）
   ```js
   renderMessages([{ id: 'ast-x', role: 'assistant', content: '', thought: '', timestamp: '12:00' }], { isStreaming: true })
   // 断言：html.includes('data-msg-id="ast-x"')
   //       && /<div id="msg-content-ast-x"[^>]*style="display:\s*none"/.test(html)
   ```
2. 同上｜**非流式空行不产行**（锁 `b22147c`）
   `{ isStreaming: false }` → `!html.includes('data-msg-id="ast-x"')` ∧ `!html.includes('conv-message--assistant')`；注释写明「不得断言 `conv-turn` 缺席」。
3. 同上｜**双重收窄**（锁 `TurnGroup.tsx:126`）
   同 turn 三条空 assistant 行 + `isStreaming=true` → 只有末行产出 `msg-content-*`。
4. 同上｜**流式态工具不聚合**（`TurnGroup.tsx:87` 的 `isStreaming ||` 目前零守护）
   多 assistant 行 + 多工具 + `isStreaming=true` → 工具仍各自挂 `msg-tools-*`，不聚合到首条。
5. `packages/ui/__tests__/layout.test.mjs`｜跨 `mode`（scratchpad / foreground / group）两档守卫
   - 非流式 + 有工具 + 空正文 ⇒ 行存在但**无** `conv-message__body`、**无** `msg-content-*` 锚点（锁 `89ca860`，同时守护 `keepEmptyAnchor` 默认必须为 `false`）；
   - 流式 + 有工具 + 空正文 ⇒ 锚点存在且 `display:none`（工具型回合的必然中间态，原先无人定义、无人锁定）。
   - 补「历史 turn 含工具 + 空正文 + 恰为末 turn + `snapshot.isStreaming=true`」窄窗口用例：明确断言**不**产出空正文容器，或显式记录为可接受回潮——二选一写死，不得沉默。
6. `packages/desktop/__tests__/unit/tokenStreamWriter.test.mjs`｜**双路径 DOM 契约**（替换「不抛错」这类恒等断言；桩范式见 `desktop-stream-viewport.test.mjs:20-27`）
   - 命中 `msg-content-m1` ⇒ `el.innerHTML` 含渲染结果、`el.style.flexDirection === 'column'`、`display:'none'` 被翻成 `'flex'`（覆盖 `tokenStreamWriter.ts:126-132`）；
   - 未命中 ⇒ `logStream.trace('stream-anchor-miss', { id: 'm1' })` 被调用。
   - **分工声明**：本单测只证明 writer 自身行为，不能证明"React 那次渲染真的产出了锚点"，后者只能由第 7 项 CDP 覆盖。

7. E2E（判据见第六节）与 `fake-test-killer` 登记：在 `scripts/verify/fake-test-killer.mjs:61` 的 `MUTATIONS` 加一条 `MessageRow` 整行判空的 dist 变异（`find: /!isStreaming/, replace: ''`），`expect` 填用例 1 的断言文案，让"用例会不会红"由 `npm run verify` 机器证明。
8. **可选但推荐**：`docs/invariants.json` 登记 `INV-STREAM-01`（UI 层在登记范围内，`INV-RAIL-01..05` 的 source 就是 ui 文件）。注意 `scripts/verify/invariant-map.mjs:88` 强制 test 内含 `fc.assert`，必须写成属性测试：任意 `messages × isStreaming` 组合下「流式末条 assistant 恒含 `msg-content-` 锚点 ∧ 非流式全空行恒无 `data-msg-id`」。跨包引 ui dist 的先例见 `packages/core/__tests__/formal/rail-time-format-formal.test.mjs:19`。

### 4.4 门禁（含真实拦截力分级）

```bash
npm run gates:changed      # 形式通过：静态规则不含"空占位/锚点存在"
npm run typecheck          # 形式通过：布尔条件写反也能过
npm test                   # 唯一真拦截（前提：新用例进已登记套件；SUITES.unit.roots 已含 ui 与 desktop/unit）
npm run verify:formal      # 形式通过：只跑 core 的 formal 套件，与本次改动零交集
npm run coverage:new       # 必须单独跑：不在 `npm run verify` 链路内（package.json:56 vs :68）
npm run verify             # 含 gates:fake-tests（登记变异后变真拦截）与 gates:invariants（登记不变量后生效）
```

该契约的正确层级是 **UI 单测（主）+ 真实渲染 R10（补）+ 不变量属性测试（棘轮）**；静态与 formal 层无能为力，不得据此宣称已验证。

### 4.5 方案 B（备选，不推荐）

`tokenStreamWriter` 在 `contentEl === null` 时自建容器插入消息行。缺点：绕过 React 的节点所有权，后续重渲染可能重复挂载或错位。

### 4.6 实施注意（样式审查给出，均为 P2）

1. **空容器归零规则缺口**：`conversation.css:750-754` 现有 `:empty` 归零只覆盖 `.assistant-content:empty, .conv-tools:empty`，缺 `.conv-markdown:empty`。本方案的空锚点高度本就是 0（`renderMarkdown('')` 返回 `''`，`.conv-markdown` 无 padding/margin/min-height），暂不需要该规则；但若后续补，**必须带 `!important`**——`tokenStreamWriter.ts:124-131` 会写内联 `contentEl.style.display = 'flex'`，普通规则会被内联样式反超。与既有 `.conv-tools:empty` 保持同一写法并在注释点明优先级契约。
2. **恒空 turn 的估算高度**：`.conv-turn` 是 `content-visibility: auto; contain-intrinsic-size: auto var(--conv-intrinsic-median-height, 140px)`（`conversation.css:136-142`）。空 turn 在视口内时走真实布局（无 CLS），但视口外会以 140px 计入 `scrollHeight` 与 `getAverageRowHeightPx()`，可能拉偏 `scrollHeight` 与占位估算。实施后用真实浏览器观测 `scrollHeight` 与平均行高，必要时给空 turn 加 `contain-intrinsic-size: 0`。
3. **首帧静默窗**：首个 token 到达前（本次实测 6.5s）用户只看到提问气泡下方静止空白。可选加一个微呼吸点（2.4s、集中时钟），不引入文案即无需 i18n，不阻塞本批。
4. **群聊 header 场景的 gap**：`.conv-message` 是 `display:flex; flex-direction:column; gap: var(--conv-item-gap)`（`conversation.css:148-156`），群聊 `isFirstInTurn && sender` 会渲染 `.conv-message__header`（`:181-188`）。采用隐形锚点（`display:none`）后它不参与 flex 布局，gap 风险消失；仍需在群聊模式复核首个 token 翻牌成 `display:flex` 后的间距与工具胶囊相对位置。
5. **首写会改 Markdown 盒模型**：`tokenStreamWriter.ts:126-131` 首次直写无条件写 `contentEl.style.display='flex'; flexDirection='column'`，而 `.conv-markdown` 的段落 margin 折叠、列表缩进、`.md-pre` 横向滚动都按 block 流设计。这是既存路径（任何非空正文首帧都会触发），但方案 A 让它在「空→首字」这一帧必然发生一次。补一条 CDP 断言：流式结束后 `.conv-markdown` 内 `p` 的 `margin-bottom` 与静态回合一致、`.md-pre` 仍可横向滚动，避免将来把排版回归误归因到本次改动。

---

## 五、并行发现：CPA provider 被关闭（与本次现象无关）

排查起点该会话模型为 `cpa/gemini-3.8-flash`，其 provider「CPA」在 Magpie 中被关闭，稳定 404：

```
HTTP 404: CPA is switched off in Magpie, so "cpa/gemini-3.8-flash" is not served;
switch it on again in Magpie's Providers to use it
```

3 次重试全败，终态 `status=error`，`message.complete.text` 是 358 字符错误说明，正文 delta 必然为 0。**把这段错误文案当成"正文一次性到达"就会直接误判为流式退化**——`handoff.md` 正是这样走偏的。

已临时把该会话切到 `group/deepseek-v4.1-flash` 取得成功回合以完成取证。CPA 需人工在 Magpie → Providers 恢复；恢复前切回 `cpa/*` 会继续 404。

---

## 六、R10 判据（已落地：采样 100ms，以 `contentWrites` 为权威）

**权威信号必须是 `contentWrites`，不是 `growthSteps`。** 现脚本的 `growthSteps` 取自 `[data-msg-id]` 最后一条非空行的 `textContent`，思考行与工具胶囊同样计入：修复后若思考仍整段闪现（本批 A2），思考文本增长会抬高 `growthSteps` → **假 PASS**；而 200ms 采样下 500~800ms 的合法流式最多 3 个样本，`growthSteps < 3` 又会 **假 FAIL**。

改造口径（实施时逐条落地）：

```
PASS 当且仅当：
  1. complete.status !== 'error'
  2. bodyDeltaFrames >= 5 且 frameSpanMs >= 500
  3. delta 窗口内 rafHz >= 10
  4. contentWrites >= 5            // 当前基线 1，这是缺陷本体的直接指纹
  5. domAfterDelta.total 在 delta 窗口内单调递增 >= 5 次
  6. missingAnchor === 0
辅助（不参与判定）：growthSteps、lengths
采样周期：200ms → 100ms
```

补充规则：

- `complete.status === 'error'`、上游非流式、`rafStalled`、缺输入舱/发送按钮等一律 SKIP，且**必须单独打印「本轮未验证流式增量」**，禁止与 PASS 混计为验收通过；
- 第 4 档「前端吞并」与第 5 档「锚点缺失」症状相同（都是一次性上屏）但根因不同，必须分开报告。

---

## 七、未闭环项

| 项 | 说明 |
|---|---|
| ~~修复尚未实施~~ | **已实施并实机验证**，见第八节 |
| `renderedMessageIds` 记账口径 | 仍是"已请求渲染"而非"DOM 已存在"；已由 `missingAnchor` 观测兜住可发现性，口径本身建议另开改动 |
| 思考锚点 | 已退回 A2（本批只修正文）；A1 会产生 32px 空折叠条且结构无法在流式中升级，需独立改动 + 真实浏览器复看 |
| 群聊/Bot 主工位空锚点 gap | 隐形锚点不参与 flex 布局，风险已规避；仍建议在群聊 `header` 场景人工看一次首个 token 翻牌 |
| `coverage:new` 未进 verify | `package.json:56` 与 `:68` 不同链路，需单独执行；本轮已单独跑到达标 |
| CPA provider | 需人工在 Magpie → Providers 恢复，属环境问题 |

---

## 八、实施与验证记录

### 8.1 改动文件

| 文件 | 改动 |
|---|---|
| `packages/ui/src/components-react/conversation/MarkdownBlock.tsx` | 空正文且有 `anchorId` 时输出 `display:none` 隐形锚点（不新增 prop） |
| `packages/ui/src/components-react/conversation/MessageRow.tsx` | 整行判空追加 `&& !isStreaming`；调用行保持不变 |
| `packages/desktop/src/renderer/stream/tokenStreamWriter.ts` | 缺锚点计数 `anchorsMissing` + `trace('stream-anchor-miss')`，写入 flush 统计 |
| `packages/ui/__tests__/streaming-anchor-contract.test.mjs` | 新增 5 条结构化用例（流式锚点 / 非流式不占位 / 工具先行 / 仅末行 / 工具不聚合） |
| `packages/ui/__tests__/streaming-anchor-formal.test.mjs` | 新增 INV-STREAM-01 属性测试（定理 27/28，各 300 组随机） |
| `packages/desktop/__tests__/unit/tokenStreamWriter.test.mjs` | 新增 2 条：命中锚点点亮直写、缺锚点留痕并计入 flush |
| `docs/invariants.json` / `docs/invariants.md` | 登记 `INV-STREAM-01` |
| `scripts/verify/fake-test-killer.mjs` | 登记 2 条变异：MessageRow 守卫回潮、MarkdownBlock 锚点回潮 |
| `scripts/verify/conversation-rebuild-live.mjs` | 采样 200ms → 100ms；判据以 `contentWrites` + 锚点总量增长为权威 |

### 8.2 门禁结果（本机实测）

| 门禁 | 结果 |
|---|---|
| `npm run build` | ✅ |
| `npm run typecheck` | ✅ 0 错误 |
| `npm test` | ✅ 198 文件 / 2310 用例 / 2307 通过 / 0 失败 / 3 跳过 |
| `npm run gates:changed` | ✅ 无新增违规 |
| `npm run gates:fake-tests` | ✅ 7/7 变异被杀死（含新增 2 条） |
| `npm run gates:invariants` + `invariants:render` | ✅ 41 条，Markdown 视图一致 |
| `npm run coverage:new` | ✅ 新增行 100%、分支 100% |
| `npm run verify:formal` | ✅ 55 用例 |

### 8.3 实机验收（真实网关 + 真实 Blink）

```
FLUX_VERIFY_ONLY=R10 node --env-file=.env scripts/verify/conversation-rebuild-live.mjs
✔ R10 PASS：上游 71 帧 / 2416ms；正文锚点写入 154 次、锚点总量增长 39 次；rAF 60Hz
```

修复前同一条命令为：正文锚点写入 **1 次**、锚点总量增长 **0 次**，判 FAIL「前端吞并」。

> 环境提示：R10 依赖页面可见（rAF 会因窗口隐藏而停摆）。本轮曾出现一次 `rAF 0Hz → SKIP`，重跑即恢复；SKIP 不计入验收通过。

### 8.4 提交状态

本轮所有改动仍在工作区，尚未 commit。
