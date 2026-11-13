# Handoff · Agent 在场指示器（Dock 变体与空闲轮播）交接备忘

> 交付 Commit：`b6facb8` on `dev/v0.1`  
> 状态：代码已合入主干并推送到远端，全量门禁全绿（1908 tests / 0 fail / 46 formal theorems pass）  
> 适用场景：想要继续微调 dock 布局视觉细节、空闲文案与动作物理学、或扩展专属 Agent 交互。

---

## 一、当前已落地全景与技术机理

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        AgentPresence 表现层状态机                       │
├───────────────────────────────────┬────────────────────────────────────┤
│           Stage 布局 (默认)        │           Dock 布局 (新方案)        │
│  - 位置: .flux-middle-pod 顶部居中 │  - 位置: .input-dock 顶部左对齐贴边 │
│  - 头像: 56px 大图腾/大图片        │  - 头像: 28px 微型原生适配 (1px 边框)│
│  - 文案: 13px 双层阴影压在对话流   │  - 文案: 11px caption 整数档，无阴影│
│  - 特色: 92px 呼吸光晕 + 旋转外环   │  - 特色: 去光晕、去阴影、零脏边     │
└───────────────────────────────────┴────────────────────────────────────┘
                                    │
                       共用数据源与统一状态机
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  - 状态真值: deriveAgentPresence (thinking / writing / tool / idle)    │
│  - 身份解析: resolvePresenceSoloIdentity / resolvePresenceGroupIdentity│
│  - 空闲轮播: idleQuipScheduler (9s 间隔, 420ms 侧头, FNV 互质步长遍历)  │
│  - 设置中枢: localStorage['hermes_flux_presence_layout'] 持久化        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 二、关键涉及源码与修改锚点

| 文件路径 | 核心行号/函数 | 职责与修改要点 |
|---|---|---|
| `packages/ui/src/components-react/AgentPresence.tsx` | `AgentPresence()`<br>`buildFaceHtml()` | **尺寸下发与 DOM 契约**：根据 `layout === 'dock' ? PRESENCE_DOCK_AVATAR_SIZE(28) : 56` 下发 `avatarSize`；绑定 `data-layout`、`data-idle-quip`、`data-idle-turn`，文案行带 `aria-hidden`。 |
| `packages/ui/src/styles/conversation.css` | `3320-3330`<br>`3582-3640` | **样式与缩放防御**：`.conv-presence__face > svg, img` 强制带 `!important` 覆盖内联样式；dock 下重设 `--presence-size: 28px`、`max-width: 740px`、`justify-content: flex-start`、`border-width: 1px`；隐藏 halo 与 text-shadow。 |
| `packages/ui/src/components-react/conversation/idleQuipScheduler.ts` | `createIdleQuipScheduler()` | **可测的纯定时器调度器**：9s 推进 tick、420ms 侧头、页面隐藏停表、回到前台不补播、stop 清空复位。 |
| `packages/ui/src/components-react/conversation/usePresenceTicker.ts` | `useIdleQuipTicker()` | **React Hook 桥**：将调度器与组件生命周期和 `visibilitychange` 事件对齐。 |
| `packages/core/src/agent/agentPresence.ts` | `pickIdleQuipIndex()`<br>`IDLE_COPRIME_STEPS` | **确定性轮播算法**：FNV-1a 派生起点，配合欧几里得互质步长，保证一个周期（8 拍）遍历所有短句且无随机跳动。 |
| `packages/desktop/src/renderer/index.ts` | `ensureAgentPresenceHost()`<br>`syncAgentPresenceHost()`<br>`applyInputDockUpdate()` | **宿主生命周期自愈**：将输入舱的删除/替换/新建收敛为单一出口，其后立即重校 host；并在 `syncAgentPresence` 增加 `!isConnected` 防御；`PRESENCE_LAYOUT_STORAGE_KEY` 声明在 state 前杜绝冷启动回落。 |
| `packages/ui/src/components-react/settings/SettingsModal.tsx` | `AppearancePanel` | **设置项呈现**：在外观分区渲染「Agent 状态 / 显示位置」SegmentedControl 切换控件。 |
| `packages/ui/src/i18n/index.ts` | `presence.idle.*`<br>`settings.presence*` | **中英文对称字典**：8 条俏皮短句与 4 条设置项文案。 |

---

## 三、四大物理避坑军规（已踩并填好）

1. **内联样式必须 `!important` 压制**：`botAvatar.ts` 内部对图片直接拼接了 `style="width: 56px; ..."`，普通 CSS 类优先级（0020）压不过内联样式（1000）。凡涉及多尺寸场景，必须在源头按 `avatarSize` 下发，且 CSS 必须带 `!important` 兜底。
2. **输入舱替换销毁宿主（生命周期陷阱）**：输入舱每次内容变化执行 `existingDock.outerHTML = nextDockHtml`，dock 变体的 host 作为其首子节点会连带被注销。重校逻辑必须紧跟在 `applyInputDockUpdate()` 之后，绝不能写在替换发生前。
3. **常量声明顺序破坏冷启动**：TS 源码虽然类型推导通过，但打包成单一 IIFE 时常量若是 `var`，在 `state` 初始化之前读取会拿到 `undefined`，静默回退默认值。偏好常量必须物理声明在 `state` 之前。
4. **无障碍 Live Region 噪音**：指示器根节点带 `role="status"`（隐含 `aria-live="polite"`）。空闲短句属于氛围文案，必须加 `aria-hidden="true"`，否则屏幕阅读器会每 9 秒强制播报整行。

---

## 四、下一阶段可深入优化的方向 (Backlog)

### 1. 动效物理学精细打磨
- **换句时的侧头曲线**：当前是 `convPresenceIdleTurn`（`0% -> -3deg -> 2deg -> 0%`，420ms `ease-in-out`）。可微调关键帧，例如加入微小的 `scale(0.98)` 呼吸下沉，让侧头更具“思考灵动感”。
- **眨眼与侧头的相位解耦**：当前眨眼时钟（2.8~5.4s 随机抖动）与侧头（固定 9s）独立运行，极低概率会在侧头瞬间同时眨眼。若追求极致原生感，可在侧头时暂停眨眼排程。

### 2. 空闲文案智能化与个性化
- **按 Bot 档案分流文案**：当前是全 Bot 共享 8 条通用短句。可在 `AgentPresence.tsx` 中读取当前 Bot 的 `name` 或标签，若是评审员（如 `flux-code-reviewer`）轮播“盯着代码找茬中”，若是主助手则轮播“在角落里等你派活”。
- **长空闲静默降级**：当用户超过 5 分钟未打字时，可把轮播间隔拉长至 30s~60s，或文案降为更低对比度（`--faint`），避免余光持续感知文字闪烁。

### 3. 断连态（无网关）表现收敛
- 目前网关未连接时，输入舱被完整移除，dock 变体的指示器随之消失（而 stage 变体仍在）。可考虑在连接面板的顶端保留微型 dock 指示器，或在断连时统一优雅退场。

---

## 五、常用验证与调试命令

```bash
# 1. 编译全工作区产物（改完 TS/CSS 后必跑）
npm run build
# 或单独快速编译桌面端渲染进程：
node packages/desktop/scripts/build.mjs

# 2. 跑单元测试与接线守卫（100% 必须全绿）
node --test packages/ui/__tests__/agent-presence.test.mjs packages/ui/__tests__/idle-quip-scheduler.test.mjs packages/desktop/__tests__/unit/agent-presence-wiring.test.mjs packages/core/__tests__/agent/agentPresence.test.mjs

# 3. 运行真实 Blink 物理渲染与截图探针
npm run verify:presence:dock
# （产物保存在 artifacts/verification/presence-dock-layout/）

# 4. 改动集质量门禁校验
npm run gates:changed
```
