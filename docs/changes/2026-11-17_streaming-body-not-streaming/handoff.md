# 流式正文退化为一次性返回 · 排查交接

> 分支：`dev/v0.1` · 网关：`https://fn.hermesflux.com:1519`（凭据在仓库根 `.env`，已 gitignore）
> 状态：**未定位根因**。已取得一组强证据指向「本次响应上游未分段推送正文」，但用户明确反馈该网关历史上是流式的，因此不能据此结案。
> 本文只描述事实与已排除项，不把任何未验证假设写成结论。
>
> ⚠️ **后续结论见 [`findings.md`](./findings.md)**：本文第三节的「上游未分段推送正文」已被推翻——该回合上游确实流式（71 帧 / 2.3s），真正的断点在 UI 层空助手行不产出 `#msg-content-*` 直写锚点。本文保留为排查过程记录，不再作为结论引用。

---

## 一、问题陈述

用户反馈：**对话正文不再是逐段流式出现，而是一次性全部出现**。

关键背景（用户提供，需作为已知事实对待）：
- 同一个 Hermes gateway 之前是流式的，表现正常；
- 最近才出现「一次性全出」；
- 用户没有明确说明是否切换过模型 / provider / 网关版本，**这是首要待确认项**。

容易误判的一点：本轮同时修复了「发送提示词后自动贴底并持续跟随」（commit `6fc4540`）。修复后视口会紧跟内容增长，于是「内容一次性到达」在视觉上更像瞬间铺满，容易被读成「流式退化」。两者是独立问题，排查时不要混。

---

## 二、已取得的实测证据（可复现）

### 2.1 取证工具（本轮新增，未提交）

`scripts/verify/conversation-rebuild-live.mjs` 新增：

1. **页面内 WebSocket 探针**：`Page.addScriptToEvaluateOnNewDocument` 在导航前注入，包装 `window.WebSocket`，统计下行帧：
   - `thinking.delta` → `probe.thinking`
   - `message.delta` / `append-content` → `probe.delta`（只把这两类算作「正文流」）
   - 保存前 3 条正文增量帧样本（截断 240 字符）
2. **R10 用例**：发送一条「逐行输出 60 行」的指令，200ms 粒度采样 DOM 文本长度 30 秒，并与探针的正文增量帧对照。

复现命令：

```bash
FLUX_VERIFY_ONLY=R10 node --env-file=.env scripts/verify/conversation-rebuild-live.mjs
```

证据落盘：`artifacts/verification/conversation-rebuild-live/evidence.json` 的 `R10.metrics.upstream` 与 `R10.metrics.frameSamples`。

### 2.2 最近一次实测结果

| 观测项 | 实测值 |
|---|---|
| 下行帧总数 | 50 |
| `thinking.delta` 帧 | 6（跨度 7819ms） |
| 正文增量帧（`message.delta` / `append-content`） | **0** |
| DOM 文本增长次数（200ms 采样） | 1 次：69 → 548（+479 字符） |

thinking 帧样本（原文）：

```
thinking.delta  text: "( ˘⌣˘)♡ brainstorming..."
thinking.delta  text: ""
thinking.delta  text: "⏳ waiting on provider — retrying in 2s (attempt 1/3)"
```

### 2.3 这组数据能确定什么、不能确定什么

**能确定**：
- 这一次响应里，网关没有发出任何正文增量事件；正文是在 `thinking` 结束之后一次性到齐。
- 前端没有把多个正文增量合并成一次：DOM 的增长次数与上游正文帧数（0）一致，`TokenCoalescer` 没有吞掉任何正文段。

**不能确定**：
- 不能确定「网关永久不流式」。单次采样只覆盖这一次请求、这一个 provider、这一个会话。
- 不能确定根因在网关、provider 还是中转层。`waiting on provider — retrying in 2s (attempt 1/3)` 说明本次请求发生过 provider 重试，而重试后的响应被一次性返回是很常见的退化路径。

---

## 三、前端链路（已排除，供快速定位边界）

正文流式的前端链路如下，只要上游有 `append-content`，DOM 就会逐段增长：

```
网关下行 event(append-content)
  → gatewayEventDispatcher.ts:200  deps.getTokenCoalescer().push({ messageId, delta: action.text })
  → TokenCoalescer（packages/core/src/coalesce/tokenCoalescer.ts）
       · 每帧 2~6 字符的自适应打字机节奏；内容 ≤4 字符时整段投递
       · 只有 flush()（回合完成/取消）才一次性清空剩余缓冲
  → tokenStreamWriter.writeFlushedTokens（packages/desktop/src/renderer/stream/tokenStreamWriter.ts:57-162）
       · 直接写 DOM：contentEl.innerHTML = renderMarkdown(targetMsg.content)
       · 贴底判定见 isNearBottom（本轮改为纳入输入舱安全线）
```

已排除项与依据：

| 假设 | 结论 | 依据 |
|---|---|---|
| `TokenCoalescer` 把多段合并成一次 | 排除 | `step()` 每帧只消费 2~6 字符，且 `push` 即调度 rAF；只有 `flush()` 会整段清空，而 `flush` 由回合完成触发，发生在正文到齐之后 |
| `tokenStreamWriter` 没有写 DOM | 排除 | 第 132 行每帧 `innerHTML = renderMarkdown(...)`；本轮未改动该文件 |
| 跟随逻辑导致内容不刷新 | 排除 | 跟随只写 `scrollTop`，不参与正文渲染；R9 已证明 30/30 帧贴底且内容持续增长 |
| 最近两次提交引入 | 基本排除 | `6fc4540` 只改「待贴底标记转发 / isNearBottom 口径 / 三帧 pin / 群聊轮询」；`7bb9da0` 只是契约文档。两者都不触碰 `append-content → coalescer → writer` 这条正文链路 |

> 如果后续要彻底排除，可在 `gatewayEventDispatcher.ts:200` 临时打点统计 `action.text` 的到达次数；本轮用页面内 WS 探针达到了同等目的，未改产品代码。

---

## 四、待验证假设（按优先级）

1. **provider 重试导致一次性返回**
   - 线索：thinking 帧里出现 `waiting on provider — retrying in 2s (attempt 1/3)`。
   - 验证：换一个稳定的 provider/模型发同一条指令；若恢复逐段到达，则本次为 provider 重试退化，而非网关代码问题。
   - 需查：网关侧该 provider 的重试实现是否在重试后改用非流式请求（很多中转在 retry 时会重新发起非 streaming 调用）。

2. **网关到 provider 的 stream 参数没有透传**
   - 验证：抓网关出站请求（或读网关日志），确认 provider 请求体里 `stream: true` 存在。
   - 对比：同一网关下不同 provider 的表现（有的 provider 支持流式，有的被网关强制非流式）。

3. **中转/反向代理缓冲**
   - 验证：观察 WS 帧的到达时间分布。若正文帧在极短时间内集中到达（例如 `message.complete` 前 50ms 内出现大块 delta），更像缓冲后一次性放行；若根本没有正文 delta、只有最终结果，则更像上游非流式。
   - 工具：R10 的探针已记录 `probe.times`（仅正文帧），可扩展为记录所有帧的 `type/seq/t` 序列。

4. **会话类型或模型差异**
   - 验证：分别在新会话、历史长会话、Bot 主工位、群聊房间各发一条，比较正文增量帧数。
   - 注意：群聊走 `groups.send`/`groups.log` 轮询，本身没有 token 流；不要把群聊的「无 delta」当成缺陷。

5. **请求内容触发非流式路径**
   - 验证：换成极简 prompt（如「输出 10 个数字」）与工具型 prompt 各测一次，看正文增量帧是否出现。
   - 本轮两次测试都带「不要调用任何工具」的强约束，理论上应走纯文本流；若网关对「无工具调用」的回合改用聚合返回，这会成为一条真实线索。

6. **网关版本/配置变更**
   - 验证：核对网关当前版本与最近一次变更（用户侧仓库 `D:\ws\hermes-agent-official`），重点看 `gateway/` 下的流式事件发送与 provider 适配层。

---

## 五、扩展取证的推荐做法

当前探针只统计正文增量帧数量与时间。继续排查时建议把它扩成**完整帧时间线**（不改产品代码）：

```js
// 在 WS_PROBE_SOURCE 内，对每一帧做轻量解析
const m = /"type":\s*"([a-z_.]+)"/.exec(data);
probe.timeline.push({ t: Date.now(), type: m ? m[1] : 'unknown', size: data.length });
```

然后用一次真实请求导出 `timeline`，重点看：

- `message.complete`（或等价终态事件）之前是否存在任何 `append-content`；
- 正文到达的时间是否集中在 1 帧内；
- 是否有 `provider.retry` / `provider.error` 类事件夹在中间。

判定口径建议固定为：

- **上游流式**：`append-content` 帧数 ≥ 5 且首末跨度 ≥ 500ms；
- **上游一次性**：正文增量 0 帧，或全部集中在 100ms 内；
- **前端吞并**：上游流式但 DOM 增长次数 < 3。

R10 已实现这三档判定的前两档；第三档需要上游真的流式才能触发。

---

## 六、当前工作区与提交状态

已提交并推送：

| 提交 | 内容 |
|---|---|
| `6fc4540` | fix(conversation)：发送后自动贴底并跟随流式输出（待贴底单一真值源、isNearBottom 纳入安全线、三帧 pin、群聊轮询不拽底） |
| `7bb9da0` | docs(gateway)：契约文档同步 |

未提交（本轮取证用，建议保留后再决定是否入库）：

- `scripts/verify/conversation-rebuild-live.mjs`：新增 WS 探针、`R10` 用例、`FLUX_VERIFY_ONLY` 过滤。
- `artifacts/verification/conversation-rebuild-live/evidence.json`：最新一次 R10 证据。

---

## 七、快速开始（新 session）

```bash
cd D:\ws\hermes-aura

# 1) 确认基线干净、构建最新
git status --short
npm run build

# 2) 复现一次，只看 R10
FLUX_VERIFY_ONLY=R10 node --env-file=.env scripts/verify/conversation-rebuild-live.mjs

# 3) 读证据
node -e "const e=require('./artifacts/verification/conversation-rebuild-live/evidence.json');const r=e.results.find(x=>x.id==='R10');console.log(JSON.stringify(r.metrics.upstream));console.log(JSON.stringify(r.metrics.frameSamples,null,1))"
```

注意：
- 每条 R10 会向真实会话写入一条测试指令；`FLUX_VERIFY_SKIP_SEND=1` 可跳过发送（此时 R10 会直接 SKIP）。
- 浏览器直跑服务默认占用 9120；若已在运行，先确认 `/__live/identity` 的 `root` 指向本仓（避免看到别的 worktree 的产物）。
- 不要把 `.env` 里的网关地址/账号/密码写进任何被 git 跟踪的文件或提交信息。

---

## 八、完成判据

1. 在**同一个网关**上，能稳定复现「正文一次性到达」与「正文逐段到达」两种状态，并给出切换条件（provider？模型？重试？）；
2. 若属网关/provider 缺陷，给出发送侧证据（出站 `stream` 参数、重试路径、终态事件序列）；
3. 若属前端缺陷，用 R10 的第三档判据（上游流式但 DOM 增长 < 3）复现并修复；
4. 结论落地后，把 R10 从「诊断用例」转为固定回归项，并在本文补上最终根因与修复提交。
