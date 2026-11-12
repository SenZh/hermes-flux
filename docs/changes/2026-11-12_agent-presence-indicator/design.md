# Agent 在场指示器（Agent Presence Indicator）设计

> 分支：`feat/agent-presence-indicator`
> 状态：**待 review（未落码）**
> 关联规范：`docs/design-system/README.md`、`docs/architecture/interactive-conversation-stage-spec.md`、`ENGINEERING_DISCIPLINE.md`

---

## 一、目标与判据

**目标**：把「Agent 现在在干什么」从一串英文机器状态，变成对话区顶部居中的**拟人化在场指示器**：头像 + 人话状态 + 语义化动效。它是全系统唯一的 Agent 运行态出口。

**可量化判据**：

| 判据 | 阈值 |
|---|---|
| 运行态真值面数量 | 1（当前 2：`updateActivityPill` + `InputDock.activityStatus`） |
| 状态切换时头像位移 | 0px（两行结构：头像与文案是独立盒子，文字动效不牵动头像） |
| 状态文字切换视觉跳变 | 无（交叉淡入，不整行替换） |
| **常驻 CSS 动画数量** | **1**（头像呼吸形变；眨眼与瞳孔游移为集中时钟事件，占空比 < 3%） |
| idle 态可见性 | **头像常驻**（弱化到 55% 不透明，不显示文案） |
| 流式期间本组件引起的宿主重渲染 | 0（独立 React root，宿主每帧 `render()` 不触碰） |
| 工具文案与轨迹胶囊分类一致 | 100%（共用 `core` 的同一套关键字判定） |

---

## 二、功能边界（做什么 / 不做什么）

### 承载

1. **Agent 运行态**：空闲、思考、执行工具、写正文、委派子代理、失败、被中断。
2. **身份在场**：当前会话的 Agent 头像（专职 Bot / 普通会话 profile / 群聊说话者拼图）。
3. **工具在场细节**：正在跑什么（工具类别 + 目标文件名或命令），这是「拟人化」的信息来源。
4. **时长感知**：同一状态持续过久要升级语气（`正在思考` → `想得有点久` → `还在想`）。

### 不承载

1. **模型标识**：模型名是配置，不是状态。输入舱模型选择器与消息 footer 的 `model-tag` 保留不动。
2. **连接状态**：网关在线/延迟属于顶栏 `titlebar-connection-box`，不重复。
3. **Token / 上下文水位**：属于右上角水位计。
4. **审批请求**：`approval.*` 需要交互按钮，放输入舱，不在只读指示器里混入可点区域。
5. **历史回合统计**：耗时、TPS 留在消息 footer。

### 取代关系（减法）

删除以下两处重复真值面，改由本组件唯一承担：

- `packages/desktop/src/renderer/index.ts` 的 `updateActivityPill()`（`agent-activity-pill` 模板注入）。
- `packages/ui/src/components/InputDock/InputDock.ts` 的 `activityStatus` 渲染分支与 `hasDockSnapshotChanged` 中的 `activityStatus` 比较项。

保留 `state.isStreaming` 等既有状态，只把「状态文案投影」从宿主模板搬到 `core` 纯函数 + `ui` 组件。

---

## 三、领域模型（先定数据形状）

**判别联合**，让非法状态不可表达。落在 `packages/core/src/agent/agentPresence.ts`（纯逻辑，零 DOM）。

```ts
export type AgentPresenceKind =
  | 'idle' | 'thinking' | 'tool' | 'writing' | 'delegating' | 'failed' | 'interrupted';

/** 工具类别：决定图标、动词、以及是否算「写操作」 */
export type PresenceToolKind =
  | 'read' | 'command' | 'edit' | 'search' | 'agent' | 'browser' | 'other';

export type AgentPresence =
  | { kind: 'idle' }
  | { kind: 'thinking'; sinceMs: number }
  | { kind: 'tool'; tool: PresenceToolKind; target: string; runningCount: number; sinceMs: number }
  | { kind: 'writing'; sinceMs: number }
  | { kind: 'delegating'; profile: string; count: number }
  | { kind: 'failed'; message: string }
  | { kind: 'interrupted' };
```

**推导入口**（唯一真值，宿主只喂原始事实）：

```ts
export interface AgentPresenceInput {
  isStreaming: boolean;
  /** 流式末条消息；null 表示无在途回合 */
  message: {
    thought?: string;
    content?: string;
    toolCalls?: ReadonlyArray<{ name: string; status: 'running' | 'completed' | 'failed'; args: string }>;
  } | null;
  /** 未收敛的子代理数量 */
  activeSubagents?: number;
  subagentProfile?: string;
  lastError?: string;
  interrupted?: boolean;
  /** 回合开始本地时间戳；用于时长分层 */
  turnStartedAt?: number;
  now: number;
}

export function deriveAgentPresence(input: AgentPresenceInput): AgentPresence;
```

**优先级（互斥，自上而下短路）**：`failed` → `interrupted` → `delegating` → `tool` → `writing` → `thinking` → `idle`。

理由：错误与中断是终态，必须压过任何在途痕迹；委派比工具更「有主体」；工具比正文更具体（正文流式时也可能同时在跑工具）。

**时长分层**（拟人化语气的唯一来源，纯函数 `presenceTone(presence)`）：

| 状态 | <8s | 8~30s | >30s |
|---|---|---|---|
| thinking | 正在思考 | 想得有点久 | 还在想 |
| tool | 正在{动词}{目标} | 还在{动词}{目标} | {动词}{目标}花了些时间 |
| writing | 努力工作中 | 努力工作中 | 努力工作中，快好了 |

**工具动词表**（`tool` 态的「正在 xxx」必须点名动作，不能只说「执行工具」）：

| `PresenceToolKind` | 匹配的 name 关键字 | 文案模板 | 目标形态 |
|---|---|---|---|
| `read` | `read` / `cat` | 正在读 | 文件名（只留 basename） |
| `command` | `shell` / `bash` / `cmd` / `terminal` | 正在运行 | 命令首行，截断 40 字符 |
| `edit` | `edit` / `patch` / `write` | 正在改 | 文件名 |
| `search` | `grep` / `search` / `find` / `glob` | 正在搜索 | 查询串或 glob，截断 40 字符 |
| `agent` | `subagent` / `agent` / `delegate` | 正在派活给 | Agent profile 名 |
| `browser` | `browser` / `playwright` / `navigate` | 正在打开 | URL 或页面标题 |
| `other` | 其余 | 正在执行 | 工具名 |

动词表必须与 `packages/ui/src/components-react/conversation/ToolCapsule.tsx` 的 `classifyTool()` 共用同一套关键字判定，否则会出现「轨迹里写『读取』、指示器里写『正在运行』」的双标。做法：把 `classifyTool` 的纯判定部分下沉到 `core`，`ui` 侧只保留 `t()` 文案映射。

---

## 四、几何与布局（方向 B · 无壳光晕 · 圆头像 56px · 上下两行，已定案）

```
┌─ flux-titlebar (42px + 1px) ──────────────────────────────┐
├─ flux-middle-pod ─────────────────────────────────────────┤
│                     (24px 上留白)                          │
│                       ╭──────╮                             │
│                       │      │                             │  ← 56px 圆形头像
│                       │  ◉   │                             │
│                       ╰──────╯                             │
│                     (12px 行间距)                          │
│                     正在读 gateway.ts                      │  ← 12px 文案，独立居中
│                                                            │
│  conversation-stream（滚动，内容从下方穿过）                  │
```

**从参考图取什么、不取什么**（重要边界）：

| 参考图的元素 | 是否采纳 | 理由 |
|---|---|---|
| 群聊头像**横排、圆形、轻微重叠** | **采纳** | 这正是「一队人」的排布，比 2×2 拼图更贴题 |
| 头像**圆形** | **采纳** | 圆形比圆角方形更「有人味」：方形像应用图标，圆形像头像 |
| 文字**胶囊底** | **不采纳** | 参考图的胶囊里列的是成员名（`大总管, aura, CodeBoy`），那是成员清单的容器；我们的第二行是**状态文案**，无壳更轻 |
| 胶囊里列成员名 | **不采纳** | 成员已由头像叠层表达，胶囊再列一遍是冗余，且成员一多就撑爆宽度 |

**上下两行换来的三件事**（不是纯排版偏好）：

1. **头像可以放大到 56px 而不再受文字宽度牵制**。单行形态里头像与文字共享一个水平容器，文字变长会把整组推宽，头像位置随文字抖动；拆成两行后头像有独立的居中轴，文字长短只影响自己的行宽，**头像零位移**。
2. **文案可以写长**。工具目标常常是路径，单行形态下必须挤在同一行、被迫截断到 20 字符；两行形态下文案独占一行，`max-width` 放宽到 `min(420px, calc(100% - 96px))`，路径能读到文件名加一级目录。
3. **总高增加，必须重算悬浮层的安全边界**。两行后高 56 + 12 + 16 = **84px**，加 `top: 24px` 后底缘在 **108px**。会话流顶部 `padding-top` 仍为 24px，因此指示器会压住流内第一条消息约 84px——这正是「对比度遮罩」必须存在的原因。

**为什么下压到 24px**：`top: 6px` 时头像紧贴顶栏发丝线，视觉上与顶栏粘连成一体，读起来像「顶栏的第二个元素」而不是「对话区的在场者」。24px 与 `.conv-stream` 的 `--conv-gutter-top: 24px` 同值，构成同一条垂直节奏线。

**无壳的代价与解法**：没有胶囊底，滚动内容会从指示器下方穿过。解法是把「光晕」同时当作可读性遮罩——头像与文字背后铺一层椭圆径向 `--panel` 渐变（`radial-gradient(ellipse 56% 120% at 50% 40%, var(--panel) 48%, transparent 100%)`），边缘柔和到看不出形状。光晕不是装饰，它承担对比度职责。这是本方向唯一必须写死的工程约束。

- **定位**：`.flux-middle-pod` 内绝对定位层，`top: 24px`、`left: 50%`、`translateX(-50%)`、`z-index` 低于 `.conv-dock-scrim`。
- **不占流**：不进 `#conversation-stream`，不改变 `padding-top`，**不参与任何高度计算**。
- **布局**：`display: flex; flex-direction: column; align-items: center; gap: 12px`。头像轴与文案轴是同一根垂直中线，互不推动。
- **头像**：`56px` **圆形**（`border-radius: 50%`）；活动环 `inset: -5px`、`border-radius: 50%`。
- **文案**：单行 `--fs-aux`（12px）/ 行高 16px；正文动词 `--foreground`，目标片段 `--font-mono` 11.5px `--secondary-foreground`；`max-width: min(420px, calc(100% - 96px))`，超出 `text-overflow: ellipsis`。**无背景**。
- **为什么 12px 间距**：6px 时文案贴着头像下沿，读起来像「头像的标签」；12px 后两者是两个独立视觉元素，头像归头像，话归话。

**群聊模式（G1 横排叠层）**：见 §四之二。

---

## 四之二、群聊模式：横排叠层（G1 定案）

群聊与单聊的本质差别：**单聊的「在场者」是唯一的，群聊的在场者是「一个房间 + 其中正在说话的那一个」**。所以头像槽位要同时回答两个问题：这是哪个房间？现在是哪个成员在干活？

**排布直接采用参考图的语言**：圆形头像横排、轻微重叠、一个压一个。这套排布之所以对，是因为它表达的是「一队人」而不是「一个网格」——2×2 拼图是空间隐喻，横排是组织隐喻，而在场指示器要回答的是「谁在干活」，组织隐喻更贴题。

### 定案细节

```
        ╭──╮╭──╮╭──╮╭──╮
        │小││审││测││架│      ← 56px × N 圆形，负 margin -15px 重叠
        ╰──╯╰──╯╰──╯╰──╯
          ↑
      说话者（最左，z-index 最高，描边 --foreground）
```

- **尺寸**：群聊成员 `56px` 圆形，**与单聊头像同尺寸**。参考图里群聊头像和单聊一样大，不因为人多而缩小——缩了就变成「小图标堆」，失去在场感。
- **重叠**：`margin-left: -15px`（首项 0），相邻重叠 15px（27%）。圆形弧线比方形更耐重叠，27% 时仍不遮眼睛。
- **描边**：每个头像 `border: 2px solid var(--panel)`。叠层头像的必需项——没有它，相邻头像的边界会糊成一片。
- **z-index 与说话者位置**：**当前说话者放最左**，`z-index` 从左到右递减。这样「最左压住右侧」的重叠关系与「说话者高亮」天然是同一个位置，**不需要任何额外提层规则**。若把说话者放最右，就得额外给它 `z-index: 10` 去压住左边，会出现「最右突然跳出叠层」的断裂感。
- **说话者高亮**：最左头像 `border-color: var(--foreground)`，其余 `var(--panel)`；活动环挂在最左头像上。
- **溢出**：最多显示 4 个；超过时第 4 位替换为 `+N` 计数块（同 56px 圆形，`--font-mono`，`--secondary-foreground`）。4 人总宽 56 + 3×41 = **179px**。
- **成员不足**：群聊强制 ≥ 2 人（`groupService.ts:165`），2 人时总宽 97px，形态仍成立。

### 与单聊的唯一差别

**只有头像槽位不同，其余完全一致**：同样的 `top: 24px`、同样的 12px 行间距、同样的 12px 无背景文案、同样的主时钟与形变语言。

### 群聊的动效分工（关键，防止焦点扩散）

多个头像**不能全部挂完整形变**——那会立刻违反 D6 刚裁定的「一个焦点」。分工如下：

| 位置 | 形变 | 环 | 光晕 | 眨眼 |
|---|---|---|---|---|
| **最左（说话者）** | 完整状态形变语言（与单聊完全一致） | 有 | 有 | 有 |
| 其余成员 | 仅统一极轻呼吸 `scale(1 ↔ 1.015)`，2.6s | 无 | 无 | 无 |

「其余成员的呼吸」是同相位、同幅度的单一动画，属于背景脉动而非独立焦点——它的作用是让整排头像读起来是「一群活物」而不是「一排图标」。若它们完全静止，最左那个在动、其余不动，会读成「只有一个人在，其他是贴图」，反而破坏团队感。

**代价**：群聊态的常驻动画声明从 3 个变成 4 个（最左的形变/环/光晕 + 其余的统一呼吸）。按 D6 的裁定，它们仍共用 `--presence-beat` 主时钟、同相位，视觉上是一个整体在呼吸，因此仍计为 1 个焦点。

### 文案层

第二行文案在群聊下加说话者前缀：`小发王 · 正在读 a.ts`。前缀用 `--muted-foreground`，与动词的 `--foreground` 拉开层级。**前缀是必须的**——横排叠层里认不出哪一个是「小发王」，文字仍是最精确的通道。

### G1 落地需要的新增状态

`packages/core/src/group/groupService.ts:55` 的 room 只暴露 `members: string[]`，**没有「当前说话者」字段**。而宿主 `packages/desktop/src/renderer/index.ts` 目前也没有维护（grep `speaker` 零命中）。

因此需要新增 `state.activeGroupSpeaker: string | null`，写入点两处：

1. `groups.send` 的响应（自己发的消息，说话者即触发者）；
2. 群聊下行事件里的 `senderProfile`（`groupService.ts:309` 已能取到 `actor.display_name || actor.profile`）。

这是**新增宿主状态**，不是纯表现改动，必须单独提交、单独测。退化路径：若该状态为 `null`（事件未到或字段缺失），横排头像全部用 `--panel` 描边、不显示说话者高亮，文案不加前缀——**降级必须显式可见，不能假装某人正在说话**。

---

## 五、动效设计（方向 B 定案版；每个动效必须回答「它替用户解释了哪个事实」）

### 0. 一条必须先摆上桌的冲突

`docs/architecture/motion-system-and-host-isolation-spec.md:5` 与 `docs/design-system/README.md:163` 写着：`tool` 姿态「**稳态常驻动效 $\le 1$**」。而本次需求要「静止状态也要有动画」「头像要变形，让用户觉得 Agent 真的在动」。这两条直接对撞。

我的判定：**I6 的 $\le 1$ 约束的是「互相竞争焦点的常驻动效数量」，不是「动画属性的个数」**。理由是 I6 的原文语境是「克制、单调收敛、无过冲」，它防的是页面上多个元素各转各的、抢注意力。一个头像上叠了环、光晕、形变三套不同周期的动画，正是它要禁的；而一个头像整体作为**一个生物**在呼吸，环和光晕是同一个节拍的派生，读起来是一个焦点。

因此本方案的做法是：**全组件共用一根 2.4s 主时钟**（`--presence-beat: 2400ms`），头像形变、活动环、呼吸光晕全部挂在同一个周期上，相位对齐。视觉上是一个东西在动，不是一个页面上三个东西在动。

**代价要说清**：这仍是对 I6 的一次重新解读，不是照抄。如果你认为 $\le 1$ 应严格按属性个数执行，那唯一合规的形态是「只保留头像形变，环与光晕全部静态」。这条待你裁定（见 D6）。

### 1. 为什么 56px 圆形头像 + 两行 + 下压改变了动效预算

- **活动环必须跟着改成正圆**。头像从圆角方形改成正圆后，环若是 `border-radius: 16px` 的方环，会露出四个角。环的 `border-radius` 必须是 `50%`。
- **呼吸光晕放大到 92px**（56 × 1.64）。小于 1.5× 会被头像吃掉，大于 1.8× 会像页面光斑。
- **idle 的形变手段被迫更换**。方角头像能靠 `border-radius` 变化来变形，圆形头像的圆角已经顶到 `50%`，没有变形空间，必须改用双轴不等幅缩放。
- **文字独立成行，文字动效不再影响头像**。单行时文字交叉淡入的 `translateY` 会带着头像一起抖；两行后头像只受形变驱动，文案只受文字动效驱动。
- **间距 12px 让形变有呼吸空间**。6px 时头像形变（尤其纵向挤压）会顶到文案行，读起来像文字在跳。12px 是「形变最大幅度 2.2px 仍不接触文案」的最小安全值。

### 2. 头像形变（本方案的核心，按状态分化）

形变全部作用在 `.agent-presence__face` 一个元素上，用 `transform` + `border-radius`，不碰 `width/height`（避免 reflow）。**不同状态用不同的形变语言**，这才是「生动」的来源——不是「都在动」，而是「动的方式不一样」。

| 状态 | 形变语言 | 参数 | 语义 |
|---|---|---|---|
| **idle（待命）** | 呼吸 + 周期性抬头 | `scale(1 ↔ 1.04)` + 圆角 `50%` 恒定（圆形不能变形为椭圆，改 `scale` 双轴不同幅），2.6s；每 9s 叠加一次「抬头」`scaleY(1 ↔ 0.94)` 400ms + 眨眼 | 睡着了但在呼吸，偶尔抬眼看看 |
| **thinking** | 侧头思考 | `rotate(-2.5deg ↔ 2.5deg)` + `scaleY(1 ↔ 1.015)`，2.4s | 脑袋在偏，像人在想事 |
| **tool** | 用力干活 | `scale(1 ↔ 1.035)` + `rotate(0 ↔ -1.2deg)`，0.8s，`steps` 感 | 高频小幅，像在使劲 |
| **writing** | 打字节拍 | `scaleY(1 ↔ 0.97)` + `scaleX(1 ↔ 1.02)`，0.9s，与打字波同周期 | 挤压-回弹，像打字机 |
| **delegating** | 左右张望 | `rotate(-3deg ↔ 3deg)` + `translateX(-1px ↔ 1px)`，1.8s | 在找人，有指向性 |
| **failed** | 静止 | 无动画，`opacity .75` | 停住了 |
| **interrupted** | 静止 | 无动画，`opacity .6` | 停手了 |

**圆形头像改变了 idle 的形变手段**：方角头像可以靠 `border-radius` 从 `11px` 变到 `15px` 来「变形」，圆形头像的圆角已经顶到 `50%`，没有变形空间。所以 idle 改用**双轴不等幅缩放**（`scaleX(1.04) scaleY(0.97)` → `scaleX(0.97) scaleY(1.04)`），效果是头像轻微「挤压—回弹」，像有重量的软体在呼吸。这比单轴缩放更明显，也不会破坏圆形轮廓。

**为什么 idle 要动得看得见**：idle 时如果完全静止，指示器就是一张贴图。用户要的「觉得 Agent 是活的」在 idle 时最需要——因为那是他看这个组件时间最长的状态。第一版 2% 缩放在 44px 上只有 0.9px，肉眼几乎不可见，等于没做。定案放大到 **4% 双轴不等幅**（56px 上约 2.2px 的轴向差异），再叠一个每 9s 的「抬头」（`scaleY` 压到 0.94 再回弹，400ms），把「活的」从「一直在动」升级为「偶尔有动作」。

**idle 不透明度 78%**：62% 下头像与背景的对比度太低，动态反而被压掉了。78% 既明显弱于活动态（100%），又足以让形变被看见。

### 3. 眨眼与瞳孔游移（最强的「活」信号，走集中时钟）

形变是整体的，**眨眼才是「有生命」的强信号**。做法：

- 眼睛是 SVG 里的两个 `<circle>`。眨眼 = `scaleY(1 → 0.08 → 1)`，140ms，作用在 `<g>` 上（`transform-box: fill-box; transform-origin: center`）。
- 眨眼间隔**非等距**：`2800ms + hash(turnId) % 2600ms`，避免机械节拍。间隔由 `core` 的纯函数 `nextBlinkDelayMs(seed)` 算出，可单测。
- 瞳孔游移：`cx` 偏移 ±0.6px，只在 `thinking` 态出现，跟随 shimmer 的 2.2s 周期，像眼睛在扫视。
- **必须走集中时钟，不用 `animation: infinite`**：仓库已有 `packages/ui/src/components-react/conversation/useNow.ts` 的共享秒脉冲范式。这里复用同一范式做 `usePresenceTicker`，只在 `document.visibilityState === 'visible'` 时推进，页面隐藏即停。占空比 < 3%（140ms / 约 4000ms）。

**为什么不用 CSS `infinite` 做眨眼**：CSS 无法表达非等距间隔，等距眨眼会像节拍器，反而更像机器。

### 4. 头像活动环（Activity Ring）

- `conic-gradient` 弧（透明 0~186deg → 高亮 292deg → 透明 356deg），`mask-composite: exclude` 挖成 1.5px 环，**旋转周期锁定 2.4s**（与形变主时钟同相位）。
- 仅 `thinking / tool / writing / delegating` 出现；`failed` 环变 `--destructive` 静态渐变不旋转；`interrupted` 环改 `repeating-conic-gradient` 虚线不旋转。
- **语义**：环在转 = 有工作在进行；环不动 = 没有进展。这是「是否卡住」的即时判据。

### 5. 呼吸光晕（Halo）

- 92px 径向渐变（`--foreground` 12% → 透明 68%），`opacity 0.38↔0.76` + `scale 0.92↔1.06`，**2.4s**。
- idle 态光晕仍在，但 `opacity` 上限压到 0.4（弱化 50%），与头像呼吸同相位。
- **它不再兼任文字遮罩以外的任何职责**。文字仍是无背景裸文字，因此光晕与椭圆渐变仍须一起承担可读性（这是无壳方案唯一必须写死的工程约束）。
- **语义**：活体的在场感。

### 6. 状态文字交叉淡入（不整行替换，且不再牵动头像）

- 旧文字 `opacity 1→0` + `translateY(0)→-3px`，80ms；新文字 `translateY(3px)→0` + `opacity 0→1`，140ms，延迟 60ms。
- **为什么不用宽度动画**：宽度无法 transition（auto），强行动画会掉帧；交叉淡入把「跳变」转为「换气」。

### 7. 思考高光（Thinking Shimmer）

- `linear-gradient(90deg, --muted-foreground, --foreground, --muted-foreground)` + `background-clip: text` + `background-position` 位移，2.2s。
- **语义**：文字在「被点亮」= 内部在运转，而不是静止等待。

### 8. 工具目标（Tool Target）

- `tool` 态第二行：`正在读` + 目标。目标用 `--font-mono` 11.5px，命令截断 40 字符，路径保留末两级。目标片段以 `translateY(4px)→0` + 透明度 120ms 进场；**换目标时只换内容，不重播进场**（否则连续读文件会像霓虹灯）。
- **语义**：把「执行工具」具体化为「在读哪个文件」，这是人化的关键——用户能认出自己的项目。

### 9. 打字波（Typing Wave）

- `writing` 态文案为「努力工作中」，右侧 3 根 2px 竖条，高度 4px↔10px，`animation-delay` 0/120/240ms，**0.9s**（与头像 `scaleY` 同周期，读作「打一下就压一下」）。
- **语义**：正在往外吐字，与 `thinking` 的 shimmer 明确区分。

### 10. 子代理连线（Delegation Link）

- 主头像右侧 10px 出现 26px 子头像，中间 8px 细线从 `scaleX(0)` 展开到 1，160ms。子头像挂在**第一行**（头像行）右侧，与主头像同轴，不挤压胶囊。
- **语义**：活不是我一个人干的——委派拓扑的最轻表达。

### 能耗管制（必须写进代码，不是文档承诺）

| 项 | 做法 |
|---|---|
| 形变 / 环 / 光晕 | 1 根 `--presence-beat: 2400ms` 主时钟，全部同相位；`animation-play-state: paused` 由 `html[data-app-hidden="true"]` 驱动 |
| 眨眼 / 瞳孔 | 走 `usePresenceTicker`（复用 `useNow` 范式），非等距间隔由 `core` 纯函数给；页面隐藏即停 |
| `prefers-reduced-motion: reduce` | 形变降为 `scale` 单轴 0.5 幅度；环与光晕停止；shimmer 与打字波停止；眨眼保留（140ms 短促，不属于持续动效） |
| idle 态 | 头像**常驻**但只有一处极慢呼吸 + 弱化光晕；**文案行整行退场**（高 0），因此总高从 72px 降到 56px——注意这会引起一次高度变化，**必须用 `transition: height 200ms` 而非瞬时塌陷** |
| 焦点竞争 | 同一时刻只有一个元素的形变幅度 > 2%，环与光晕的幅度都压在 6% 以内 |

---

## 六、状态 → 视觉映射表

| kind | 第一行（头像行） | 第二行文案 | 头像形变 | 颜色 |
|---|---|---|---|---|
| **idle** | 44px 头像 + 弱化光晕，**常驻** | —（文案行退场） | 极慢呼吸 `scale 1↔1.02`，3.2s | `--faint` 光晕 |
| thinking | 44px + 旋转环 + 光晕 | 正在思考 / 想得有点久 / 还在想 | 侧头 `rotate ±2.5deg`，2.4s | `--foreground` |
| tool | 同上 | 正在读 `gateway.ts` / 正在运行 `pnpm test` | 用力 `scale 1↔1.035` + `rotate -1.2deg`，0.8s | 动词 `--foreground`，目标 `--secondary-foreground` |
| writing | 同上 | 努力工作中 | 打字节拍 `scaleY 1↔0.97` + `scaleX 1↔1.02`，0.9s | `--foreground` |
| delegating | 主头像 + 子头像连线 | 正在派活给 `flux-code-reviewer` | 左右张望 `rotate ±3deg`，1.8s | `--foreground` |
| failed | 静态红环 | 卡住了：{message 前 40 字} | 静止，`opacity .75` | `--destructive` |
| interrupted | 虚线环 | 已停手 | 静止，`opacity .6` | `--muted-foreground` |

头像尺寸：**56px 圆形**。环 `inset: -5px`、`border-radius: 50%`、环宽 `1.5px`。呼吸光晕直径 **92px**（56 × 1.64）。头像与文案间距 **12px**。文案 `max-width: min(420px, calc(100% - 96px))`，**无背景**。悬浮层 `top: 24px`。总高 **84px**。群聊成员同为 56px 圆形横排，重叠 `-15px`。

**眨眼与瞳孔**在所有非终态（idle / thinking / tool / writing / delegating）都生效，`failed` / `interrupted` 不眨眼——静止的眼睛是「停住了」的最强信号。

---

## 七、分层落点

| 层 | 文件 | 职责 |
|---|---|---|
| core | `packages/core/src/agent/agentPresence.ts` | `deriveAgentPresence` / `presenceTone` / `classifyPresenceTool` / `nextBlinkDelayMs`，纯函数 |
| core | `packages/core/__tests__/agent/agentPresence.test.mjs` | 优先级短路、时长分层、工具分类、眨眼间隔非等距、非法输入 |
| ui | `packages/ui/src/components-react/AgentPresence.tsx` | 纯表现组件，`snapshot` + 零回调（只读指示器）；单聊圆形 56px / 群聊 56px 横排叠层 |
| ui | `packages/ui/src/components-react/conversation/usePresenceTicker.ts` | 眨眼与瞳孔的集中时钟（复用 `useNow` 范式，页面隐藏即停） |
| ui | `packages/ui/src/components-react/conversation/mount.tsx` | 新增 `mountAgentPresence(host, getSnapshot)`，与 `mountPromptNavigator` 同构 |
| ui | `packages/ui/src/styles/conversation.css` | `.agent-presence-*` 全部样式与关键帧 |
| ui | `packages/ui/src/i18n/index.ts` | `presence.*` 文案，zh/en 同步 |
| desktop | `packages/desktop/src/renderer/index.ts` | 建 host、推快照、删 `updateActivityPill` |
| desktop | `packages/ui/src/components/MiddlePod/MiddlePod.ts` | 模板里加 `#react-agent-presence-host`（常驻，绝不进 `#conversation-stream`） |
| docs | `docs/architecture/motion-system-and-host-isolation-spec.md` | 若 D6 采纳「单焦点」解读，需在该文档补一条注记，否则下一个人读 I6 会以为本实现违规 |

**宿主约束（沿用 `mountPromptNavigator` 的血泪教训）**：host 必须挂在 `.flux-middle-pod` 层，禁止放进 `#conversation-stream`——那里会被 `activeStream.innerHTML = renderConversationCanvas(...)` 整块销毁。

---

## 八、验收

1. `npm run typecheck` 0 报错；`npm run gates:changed` 新增违规 0。
2. `npm test`：`agentPresence` 单测必须能在改坏优先级顺序时失败（变异杀伤力）；`nextBlinkDelayMs` 必须验证输出落在 `[2800, 5400]` 且同 seed 稳定、不同 seed 分布不退化。
3. CDP：真实流式回合中，指示器出现 → 切工具 → 切正文 → 回 idle，四段截图存 `artifacts/verification/`。
4. 回归断言：
   - 状态切换过程中头像 `getBoundingClientRect().left` 波动 = 0px（两行结构的核心承诺）；
   - idle 态头像 `opacity` 在 0.5~0.65 之间且仍可见；
   - `document.visibilityState = 'hidden'` 时 `animation-play-state` 为 `paused`。
5. 性能断言：连续 60s 停留在 thinking 态，`PerformanceObserver` 采集 long task 数 = 0，且组件自身不产生 JS 帧循环（眨眼定时器每 ~4s 一次，非 rAF）。
6. `flux-style-reviewer` + `flux-code-reviewer` 双审 PASS。

---

## 九、待用户裁定的开放决策

| # | 决策 | 结论 |
|---|---|---|
| D1 | idle 是否完全退场 | **已改：idle 头像常驻**（不透明度 78%，文案行退场）。原方案「整条退场」与「静止也要有动画」直接冲突，用户要求后者优先 |
| D2 | 是否吃掉流顶部高度 | **已定：悬浮不占流**（绝对定位层，不参与 reflow） |
| D3 | 视觉方向 | **已定：方向 B · 无壳光晕** |
| D3a | 布局 | **已定：上下两行**（头像独占上轴 56px，文案独立下行，间距 12px） |
| D3b | writing 文案 | **已定：努力工作中** |
| D3c | tool 文案 | **已定：正在{动词}{目标}**，动词由工具类别决定，与轨迹胶囊共用判定 |
| D3d | 位置 | **已定：`top: 24px`**（与 `.conv-stream` 的 `--conv-gutter-top` 同值，构成同一条垂直节奏线） |
| D3e | 头像形变 | **已定：按状态分化**（idle 双轴挤压 / thinking 侧头 / tool 用力 / writing 打字节拍 / delegating 张望 / failed·interrupted 静止） |
| **D6** | **I6「稳态常驻动效 ≤ 1」如何解读** | **已裁定：按焦点数量算**。三动画共用 `--presence-beat: 2400ms` 同相位 = 1 个视觉焦点。用户明确选择此解读 |
| D4 | 群聊模式头像形态 | **已定：G1 横排叠层 · 圆形 56px**（`margin-left: -15px` 重叠，说话者置最左并高亮；仅排布取自参考图） |
| D4a | 群聊动效分工 | **已定**：说话者挂完整形变+环+光晕+眨眼；其余成员仅统一极轻呼吸（同相位，不构成独立焦点） |
| D5 | 是否需要点击展开「详细执行轨迹」 | **待定**：A 不需要（推荐，保持纯只读）/ B 点击跳到右侧检查舱 |
| D7 | idle 动效强度 | **已改：4% 双轴不等幅缩放 + 每 9s 抬头 + 不透明度 78%**。圆形头像不能用 `border-radius` 变形，改用 `scaleX/scaleY` 反向挤压 |
| D8 | 头像形态 | **已改：圆形 56px，文案保持无壳裸文字**。只采纳参考图的「圆形 + 群聊横排叠层」，不采纳其文字胶囊与成员名清单 |
