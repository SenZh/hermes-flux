# Agent 在场指示器 · 第二套布局（输入舱上沿）与空闲轮播

> 日期：2026-11-13
> 上游：`docs/changes/2026-11-12_agent-presence-indicator/`（指标器本体与状态机）
> 裁决：方案 A（贴输入舱上沿、头像与输入舱左边缘对齐）；两套效果并存，由外观设置切换；空闲态保留弱化头像 + 俏皮短句轮播 + 空闲动作。

---

## 一、需求与裁定

| 项 | 裁定 | 备注 |
|---|---|---|
| 布局方案 | **方案 A**：输入舱上沿左对齐 | 头像外沿 = 输入舱左边框 |
| 两套关系 | **并存 + 设置切换** | 设置 → 外观 → Agent 状态 → 显示位置 |
| 空闲态 | **保留弱化头像** | 不再“高度归零退场” |
| 空闲文案 | **轮播，俏皮** | 9s 一句，8 条池，中文/英文各一套 |
| 空闲动作 | **换句同拍侧一次头** | 420ms，与文案淡入同拍 |

---

## 二、几何契约（dock 变体）

| 项 | 值 | 约束 |
|---|---|---|
| 容器宽 | `100%`，`max-width: 740px`，`margin: 0 auto` | 必须与 `.input-card-box.composer-dock` 完全一致 |
| 水平位置 | `justify-content: flex-start` | 头像槽位左沿对齐输入舱左边框（实测 `alignDelta = 0`） |
| 头像 | `--presence-size: 28px` | SVG/img 由 `.conv-presence__face > svg` 等比缩放；组件侧 `PRESENCE_DOCK_AVATAR_SIZE` 必须同值 |
| 间距 | 头像 ↔ 文案 `8px` | 4px 网格 |
| 文案 | `var(--fs-caption, 11px)` + `line-height: 16px` | 必须锁整数档：`calc(var(--conv-meta-size) - 1px)` 在字号小/大档会得到 10.7px / 13.6px，违反 7 档整数阶梯 |
| 与输入舱纵向间距 | `8px` | 宿主 `bottom: calc(100% + 8px)` |
| 环 / 重叠 | `inset: -2px` / `margin-left: -8px` | 4px 网格 |
| 光晕 | **不挂**（`display: none`） | 92px 光晕压在 28px 头像上只剩一团脏雾；且输入舱上沿是打字视线锚点，再叠常驻脉冲会构成第三重动效焦点 |
| 文案底板 | 基础 `.conv-presence__text` 的 **shrink-to-fit 胶囊**：`--card` 底色 + 1px `--border`（**不是 `--border-subtle`**：后者在 `--card` 同色底上轮廓会消失）+ `--radius-pill` + `--specular-line` 顶部内受光；dock 内距收紧 `4px 8px`（stage 为 `4px 12px`） | 底板宽度由「动词 + 目标」的真实宽度决定，**永不按 740px 容器铺开**；变体侧禁止重复声明 `background` |
| 字形阴影 | **全局撤掉** | 隔离已由胶囊底板承担；`--background` 背景色晕叠在卡片边缘会变成一圈脏影（浅色皮肤尤甚） |

**不占流（硬约束）**：宿主 `.presence-host--dock` 在 `.input-dock-container` 内绝对定位，**不参与 flex 布局**。任何“用 margin 让出空间”的写法都会把输入舱顶起来，而输入舱高度会随 placeholder 换行、附件轨、队列变化——一旦占流就是持续上下跳。

**宽度真值单源**：宿主自身不留 gutter（不复制 `.input-dock-container` 的 `padding: 0 24px`），内层用 `calc(100% - 48px)` 自己收边；容器 padding 改了也不会静默错位。

---

## 三、空闲轮播契约

1. **文案池**：`presence.idle.0` … `presence.idle.7`（8 条），键表在 `AgentPresence.tsx` 以 `as const satisfies readonly I18nKey[]` 声明（`t()` 的键是字面量联合，模板字符串无法通过类型检查），并在模块加载期硬校验长度等于 core 的 `IDLE_QUIP_COUNT`（脱钩时宁可启动即失败，也不要静默少一句）。
2. **选取**：`core/agent/agentPresence.ts` 的 `pickIdleQuipIndex(seed, tick)`：
   - 起点与步长都由身份 seed 派生（FNV-1a），同一身份序列恒定，不同身份序列不同；
   - 步长必须与条数**互质**（模块级常量表，启动时按欧几里得算法筛一次），保证一个周期遍历全部文案；
   - 禁止 `Math.random()`：不可复现，且每次重渲染都会跳句。
3. **节拍**：调度逻辑下沉到 `conversation/idleQuipScheduler.ts` 的注入式 `createIdleQuipScheduler`（`start` / `stop` / `visibilityChanged` / `current`），hook `useIdleQuipTicker` 只做 React 生命周期与调度器之间的桥。间隔 `IDLE_QUIP_INTERVAL_MS = 9000`；`tick` 变化时 `turning` 置真 420ms。
   - 【为什么抽出调度器】定时器语义（重复排程、隐藏不停表、卸载泄漏、非空闲不复位）是本模块唯一的真风险面，而它在 `renderToStaticMarkup` 下完全不可观测（effect 不执行）。抽出后可用假定时器在 node 里逐拍断言。
4. **空闲动作**：`.conv-presence__avatar[data-idle-turn="true"]` 播放 `convPresenceIdleTurn`（420ms，一次性）。
   - 挂 **avatar** 而不是 face：face 已被 `convPresenceBreathe`（2600ms infinite）占用，同元素第二条 `animation` 会覆盖前者；
   - 不允许空闲态再挂无限动画（单一焦点不变量）；`prefers-reduced-motion` 白名单必须包含 `.conv-presence__avatar`。
5. **退场契约废弃**：`data-empty` / `:has()` 的“高度归零”规则已删除——空闲态高度恒为 93~94px（stage：56 头像 + 12 间距 + 26 文案行，实测 93）/ 28px（dock），不再弹跳。
6. **无障碍**：空闲轮播行带 `aria-hidden="true"`。`role="status"` 隐含 polite live region，每 9s 换句会让读屏永久性每 9 秒播报一遍整行；空闲短句是氛围文案，必须对辅助技术静音。
7. **群聊 seed 用排序后的成员表**：`orderGroupMembers` 会把说话者提到最左，直接拿它做 seed 会导致说话者一换、眨眼节拍与轮播起点被无谓重置。

---

## 四、宿主装配

- 单帧顺序：`syncAgentPresenceHost()`（内部先 `ensureAgentPresenceHost(state.presenceLayout)` 定位，再按 host 引用 + `isConnected` 判定是否重挂）→ 输入舱变更 → **再次** `syncAgentPresenceHost()` + `syncAgentPresence()`。
- **输入舱三条变更路径收敛为单一出口**：断连移除 / `outerHTML` 整块替换 / 首次 `insertAdjacentHTML` 全部合进 `applyInputDockUpdate()`，调用之后紧跟唯一一次重校。
  - 历史缺陷：重校写进某一条分支，另外两条分支就会让指示器永久消失；三条分支各写一次又无法证明没有遗漏。收敛成单一出口后，「三条路径都在函数体内」与「重校在调用点之后且不在任何分支内」两条都可被源码守卫证伪。
- **host 存活守卫**：`syncAgentPresence` 开头判 `!agentPresenceHost?.isConnected` 并就地重校，作为第二道自愈（兜住外部销毁）。
- **未连接不渲染（2026-11-13 用户裁定）**：`ensureAgentPresenceHost()` 开头 `if (!state.gatewayConnected)` 直接卸载 root、移除 host、清指纹、停节拍器并返回 `null`。理由：没有连接就没有「在场者」，而 stage 指示器悬浮在对话区顶部，真实实测会压在 onboarding 卡片标题上（卡片顶边 107 / 指示器底边 160，重叠 53px）。
  - **必须用 `ensure` 的返回值**：MiddlePod 模板里有一个同 `id` 的静态空宿主；`syncAgentPresenceHost` 若在 ensure 之后再 `getElementById` 取一次，未连接时返回的 `null` 会被那个空 div 覆盖，守卫等于没写（真实缺陷，已由 wiring 第 14 条锁死）。
- 布局偏好：`localStorage['hermes_flux_presence_layout']`，缺省 `stage`。
  - **键名常量必须声明在 `const state` 之前**：`state` 初始化会调用 `readPresenceLayout()`，键名若声明在其后，打包成 `var` 后读到 `undefined`，`getItem(undefined)` 恒为 null → 用户选了 dock，重启后又跳回顶部（真实缺陷）。
  - 读写失败不静默：`console.warn`，日志用英文（i18n 门禁只允许面向用户的文案进字典）。
- 布局进指纹：`agentPresenceFingerprint` 必须取 `snapshot.layout`（不得写死 `'stage'`），否则切换后组件仍按旧变体渲染。
- 切换动作：写盘 → 清 `agentPresenceHost` 引用 → 清指纹 → `render()`（缺任一步都会出现「host 换了但不重挂」或「首帧被去重吞掉」）。

---

## 五、验证

**复现命令**（PowerShell 下 `npm` 被策略拦截时用第一种）：

```bash
node node_modules/electron/cli.js scripts/verify/agent-presence-screens.cjs
npm run verify:presence:dock
```

脚本伺服 `packages/desktop/dist/renderer/`，需先 `npm run build`。四个场景 + 设置切换闭环，六条断言全为 Binding（任一为 false 即退出码 1）。

- 真实应用壳实测（Electron/Blink，加载构建产物）：
  - `dock`：presence `740 × 28`，头像槽位左沿 == 输入舱左边框（`alignDelta = 0`），`gapToDock = 8px`，文案 11px caption 档；
  - `stage`：`420 × 93~94`（文案行 26px = 16 行高 + 4/4 内距 + 1/1 描边，实测总高 93）、`top = 67`，头像 56px 零位移；
  - 指示器背后 `::before` 的 `content` 与 `backgroundImage` 均为 `none`（无遮罩面）。
  - 量测口径：`alignDelta` 量 avatar 槽位而非 face —— face 上挂 `convPresenceTilt` 旋转形变，`getBoundingClientRect()` 会膨胀到 21px 并左移 1px。
- 设置中心：外观分区渲染「Agent 状态 / 显示位置」，点击「输入框上方」后 `aria-pressed` 与 `localStorage` 同步为 `dock`；`reload()` 后仍为 `dock`（冷启动恢复）。
- 门禁：`gates:changed` 无新增违规；`typecheck` 0 错误；全量单测 `1894` 条 `1891` 通过、`0` 失败；`verify:presence` 14/14 PASS、`verify:presence:dock` 6/6 断言、两者退出码均为 0。

**探针环境约束**：两个探针都不得使用 `webPreferences.offscreen` —— 该选项在部分 Windows/Electron 34 组合上退出时以 `0xC0000005` 崩溃（实测 `app.exit(0)` 返回 `-1073741819`），会让脚本无法作为门禁。隐藏的普通窗口仍是真实 Blink 渲染与真实排版。

---

## 六、后续可调项

- 头像 28px / 文案 11px 为现行取值（2026-11-13 由 20px 上调：20px 在 740px 输入舱旁读作一枚状态圆点而非一张脸，用户裁定「再大一点点」）。文字行按用户裁定**保留**，不做静默退场；空闲氛围句照旧每 9s 轮播。若还要更轻，下限建议 24px（需同步环与光晕）。
- 空闲文案池目前 8 条，扩充只需追加 `presence.idle.N` 与 `IDLE_QUIP_KEYS`（两侧必须同时改，单测 `pickIdleQuipIndex` 会守住遍历性）。
