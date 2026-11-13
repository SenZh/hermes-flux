# 架构与交互设计方案：BOT 选择与配置中枢 (Architecture & UI Design)

- **文档版本**：v2.2.0（移除搜索框与昂贵模型开关；槽位步进改自适应；草稿与保存语义校正）
- **需求基线**：[`docs/changes/2026-11-13_bot-management-config/requirements.md`](requirements.md)
- **设计原型**：[`docs/prototypes/bot-hero-selector-dual-theme.html`](../../prototypes/bot-hero-selector-dual-theme.html)
- **视觉准则**：遵循 [`docs/design-system/README.md`](../../design-system/README.md)（极客精准美学、5 级表面阶梯、微距发丝线、4px 整数网格、法定皮肤变量、5 槽位复用、rAF 稳态休眠与 GPU 合成加速）

---

## 一、系统总体架构与单向分层 (Architecture & Data Flow)

严格遵循 Monorepo 铁律：
$$\text{packages/desktop} \longrightarrow \text{packages/ui} \longrightarrow \text{packages/core}$$

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. packages/core (纯 TypeScript 领域模型与 RPC 封装，零 DOM / 零 React)                 │
│    • ProfileService: listProfiles, describeProfile, createProfile, configureProfile,   │
│                      getAsset, setAsset                                                │
│    • Types & Contracts: AgentProfile, ProfilesCreateParams, ProfilesConfigureParams    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 2. packages/ui (纯 UI 表现层与 React 视图组件，无原生网络 / 无私有 IPC)                │
│    • BotManagerView.tsx:                                                               │
│      ├─ BotHeroCarousel (5 节点常驻池 Slot Pooling，rAF 稳态休眠，GPU 纯合成层变换)    │
│      ├─ BotPrimaryConfigShelf (一级默认常驻：显示名、模型、默认开关、职能描述)         │
│      ├─ BotAdvancedAccordion (二级折叠抽屉：遵循 CSS Grid 0fr->1fr 契约，SOUL.md)      │
│      └─ BotCreateWizardModal (新建 / 克隆 BOT 专属受控弹窗向导)                        │
│    • Local Draft Pool: Map<string, BotDraftState> 局部内存草稿池，滑动秒级无感暂存    │
│    • Token 映射: 100% 绑定 packages/ui/src/tokens/skins.ts 法定槽位，零 Ghost Token    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 3. packages/desktop (宿主容器薄壳与控制中枢)                                           │
│    • settingsController.ts:                                                            │
│      管理 BOT 花名册状态机、静止磁吸防抖 (Debounce on Settle)、宿主级离场脏拦截        │
│      (Host-Level Dirty Guard)、调用 ProfileService 完成原子持久化并推送快照            │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、状态机判别联合模型 (Discriminated Unions)

依据《ENGINEERING_DISCIPLINE.md》第二节第 3 条，彻底禁止松散的散装布尔状态，定义完整的状态判别联合：

```typescript
// packages/ui/src/components-react/settings/botManagementTypes.ts

/** BOT 管理中枢的主状态机（判别联合，非法状态在类型系统中不可表达） */
export type BotManagementState =
  | { status: 'uninitialized' }
  | { status: 'fetching_list' }
  | { status: 'list_error'; message: string }
  | { status: 'empty_list' }
  | { status: 'idle'; activeBotId: string; activeDetail: BotDetailData }
  | { status: 'slot_lerping'; activeBotId: string }
  | { status: 'editing'; activeBotId: string; draft: BotDraftState }
  | { status: 'saving'; activeBotId: string; lockUi: true }
  | { status: 'confirm_host_exit'; pendingAction: () => void };

/** 单个 BOT 的内存草稿结构 */
export interface BotDraftState {
  displayName: string;
  description: string;
  model: string;
  provider: string;
  isDefault: boolean;
  soul: string;
  avatarBase64?: string;
  clearAvatar?: boolean;
  disabledSkills: string[];
  enabledToolsets: string[];
  enabledMcpServers: string[];
  confirmExpensiveModel: boolean;
  isDirty: boolean;
}

/** 详情数据模型 */
export interface BotDetailData {
  id: string;
  name: string;
  displayName: string;
  description: string;
  model: string;
  provider?: string;
  soul: string;
  avatar?: string;
  isDefault: boolean;
  skills: Array<{ id: string; name: string; enabled: boolean }>;
  toolsets: Array<{ id: string; name: string; enabled: boolean }>;
  mcpServers: Array<{ id: string; name: string; online: boolean; enabled: boolean }>;
}
```

---

## 三、SettingsSnapshot 与 SettingsActions 契约扩展规范

在 `packages/ui/src/components-react/settings/settingsModel.ts` 中新增 BOT 专属数据槽与抽象回调出口：

```typescript
// 扩展 packages/ui/src/components-react/settings/settingsModel.ts

export interface SettingsSnapshot {
  // ... 既有 appearance, providers 等字段
  botManagement: {
    state: BotManagementState;
    roster: Array<{
      id: string;
      displayName: string;
      model: string;
      avatar?: string;
      isDefault: boolean;
      hasDraft: boolean;
    }>;
    activeBotId: string;
    activeDetail?: BotDetailData;
    availableModels: Array<{ id: string; name: string; provider: string; isExpensive?: boolean }>;
    isBusy: boolean;
    isWizardOpen: boolean;
    wizardMode: 'blank' | 'clone';
  };
}

export interface SettingsActions {
  // ... 既有回调
  /** 选择器滑动静止吸附后，通知宿主加载该 BOT 完整配置详情 */
  onSelectBotSettle: (botId: string) => Promise<void>;

  /** 保存指定 BOT 的全量配置（原子提交 profiles.configure 与 profiles.set_asset） */
  onSaveBotConfig: (botId: string, draft: BotDraftState) => Promise<SettingsActionResult>;

  /** 重置当前 BOT 的所有未保存修改并清空其草稿 */
  onResetBotDraft: (botId: string) => void;

  /** 打开新建/克隆向导 Modal */
  onOpenBotWizard: (mode: 'blank' | 'clone') => void;

  /** 关闭新建向导 Modal */
  onCloseBotWizard: () => void;

  /** 提交创建全新 BOT (profiles.create) */
  onSubmitCreateBot: (params: {
    name: string;
    displayName: string;
    description?: string;
    soul?: string;
    model?: string;
    provider?: string;
    cloneFrom?: string;
    cloneChannels?: boolean;
    mirrorCredentials?: boolean;
  }) => Promise<SettingsActionResult>;

  /** 注册宿主级未保存脏检查守卫（切换一级 Tab、Esc 关窗、Backdrop 时回调此钩子） */
  registerDirtyGuard: (guard: () => boolean) => void;
}
```

---

## 四、BOT 选择器插值与数量退化模型 (BotSelector)

### 4.1 5 槽位复用与纯 GPU 变换 (Slot Pooling)
- **固定 5 个 DOM 容器**：尺寸统一固定为基准 `76px × 76px`，近大远小**100% 走 `transform: translate3d(...) scale(...)` 硬件合成层**，彻底杜绝修改宽高引发的 Reflow 排版回流。
- **数学插值模型**：
  $$\text{scale} = \max(0.50, 1.0 - |d| \times 0.24)$$
  $$\text{opacity} = \max(0.55, 1.0 - |d| \times 0.22)$$
  $$\text{posX} = d \times \text{STEP}$$
  透明度下限锁定 **0.55**，保证最外侧槽位仍可辨识（此前公式会让最外侧降到 0.048，实测「一行 5 个」被读成 3 个）。
- **槽位步进**：
  $$\text{STEP} = \max\left(56,\ \min\left(\frac{W}{5},\ \frac{W}{4} - 68\right)\right)$$
  其中 $W$ 为滑动区宽度。上限 $W/5$ 保证一行均分；上限 $W/4 - 68$ 保证最外侧头像中心距边缘不小于「导航按钮左距 4 + 按钮宽 44 + 半个头像 20」，窄窗口下不被箭头压住。
- **中心槽位固定归属**：`isCenter` 判定改为 `rel === 0`（而非 `|rel| < 0.35` 的浮点阈值），保证任意时刻恰有一个槽位是中心，不会出现「无中心」空档导致悬停编辑遮罩消失。

### 4.2 数量退化规范 ($N < 5$)
为了杜绝小样本数据下的除零异常与重复克隆渲染，制定严格的退化阶梯：
- **$N = 0$**：隐藏滑动器与配置区，呈现空花名册引导态与「创建首个 BOT」主按钮；
- **$N = 1$**：仅正中心渲染该 BOT（Scale 1.0），其余 4 个槽位置空（`opacity: 0`、`pointer-events: none`），禁用滑动；
- **$N = 2 \sim 4$**：按实际数量平铺，禁用环形取模，`target` 夹在 $[0, N-1]$；
- **$N \ge 5$**：启用完整 5 槽位环形衔接（`mod(center + rel, N)`）。

### 4.3 动效物理学、休眠机制与拖拽接管
- **rAF 稳态休眠与唤醒**：死区阈值设定为 $\Delta = |O_{\text{target}} - O| < 0.001$。静止时彻底注销 `requestAnimationFrame`，达成 0% CPU 占用；
- **拖拽无突跳接管 (Seamless Drag Takeover)**：使用 Pointer Events + `setPointerCapture`，按下瞬间记录 `dragStartOffset = offset; target = offset;`，消除接管瞬间跳帧；
- **拖拽兜底**：`pointerup` / `pointercancel` / `window.blur` 三处统一复位 `dragging`，避免在窗口外松手导致状态卡死、吸附永久失效；
- **滚轮累加器**：按 `deltaMode` 归一化，消费后立即清零，解锁时再清一次，消除残余符号导致的「跳错方向」；
- **静止磁吸防抖取数 (Debounce on Settle)**：滑动中完全由本地轻量数据驱动，仅当彻底静止吸附对齐（Lerp 终止）后施加 **160ms 防抖**，才向 Controller 发起 `onSelectBotSettle(botId)` 详情取数，防止滑动引发高频并发 RPC 风暴。

---

## 五、两套法定皮肤 Design Tokens 严格映射 (Dual Theme Tokens)

严格遵循 Monorepo `packages/ui/src/tokens/skins.ts` 单一真值表，杜绝一切生造的 Ghost Token：

| 界面元素 | 暗色基准 (obsidian-gold / 极客暗) | 浅色基准 (jade-white / 极简冷灰) | 法定 Token 槽位 | 规范说明 |
|---|---|---|---|---|
| **外壳卡片底色** | `#1B1C23` | `#FFFFFF` | `var(--card)` | L0 容器基础表面 |
| **区块面板底色** | `#16171D` | `#FFFFFF` | `var(--panel)` | L1 模块化面板 |
| **微距发丝分割线** | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.06)` | `var(--border-subtle)` | 1px 微距物理分割线 |
| **高对比边框** | `rgba(255,255,255,0.16)` | `rgba(0,0,0,0.20)` | `var(--border-strong)` | 输入框悬浮与焦点外框 |
| **表单输入框底色** | `#131419` | `#F8F9FA` | `var(--input)` | 凹陷式交互表面 |
| **SOUL.md 代码视窗** | `#0E0F13` | `#F1F3F5` | `var(--code)` | 沉浸式等宽代码底色（浅色跟随冷灰，严禁反插深色） |
| **主高亮强调色** | `#FFFFFF` (配合主题高亮) | `#0D7A5E` (极简松石绿) | `var(--primary)` | 焦点环、主按钮、激活指示 |
| **主色前景** | `#0E0F13` | `#FFFFFF` | `var(--primary-foreground)` | 主按钮文字、开关打开态旋钮 |
| **正文主文字** | `#E8E9EC` | `#111827` | `var(--foreground)` | 13px 主标题与核心内容、头像首字母 |
| **次级文字** | `#9CA3AF` | `#4B5563` | `var(--secondary-foreground)` | BOT ID 等次要标识 |
| **说明文字** | `#8E949E` | `#616873` | `var(--muted-foreground)` | 11px / 12px 辅助说明文本 |
| **装饰/非活动图形** | `#3E4148` | `#D1D5DB` | `var(--faint)` | 仅限非活动状态点、行号、装饰图标 |
| **焦点指示环** | `rgba(255,255,255,0.30)` | `#0D7A5E` | `var(--ring)` | 选中描边与 `:focus-visible` 外环 |

> **使用红线**：`--faint` 禁止承载任何解释性正文（暗色 1.75:1、浅色 1.40:1，等于不可见）；头像首字母与按钮文字禁止硬编码 `#fff`；开关旋钮禁止硬编码颜色。

---

## 六、排版字阶与 4px 空间网格契约 (Typography & Spacing)

### 6.1 7 档整数排版字阶
- `--fs-hero`: 20px (用于新建 BOT 模式切换大标题)
- `--fs-title`: 16px (用于面板大标题)
- `--fs-section`: 14px (用于二级折叠抽屉标题)
- `--fs-body`: 13px (用于表单输入框内容、主要按钮文字)
- `--fs-aux`: 12px (用于输入框标签 Label、次级字段)
- `--fs-caption`: 11px (用于 SOUL.md 代码视窗、职能描述辅助)
- `--fs-micro`: 10px (用于 BOT 英文 ID 微距标签、安全字数提示)
- **严禁任何 10.5px、11.5px、12.5px 或动态计算产出的小数字号**。

### 6.2 4px 整数网格
- 所有外边距、内边距、间隙尺寸严格对齐 4px / 8px 整数倍（`p-2` 8px / `p-3` 12px / `p-4` 16px / `gap-2` 8px / `gap-3` 12px）；
- 槽位步进不再写死常量，按 §4.1 公式随视口宽度计算（4px 网格约束作用于内边距与间隙，不作用于动态步进）；
- 左右翻页按钮触控热区补齐至 **44×44 pt**，符合 iOS HIG 规范。

---

## 七、关键交互流程与安全防护闭环 (Interaction & Guards)

### 7.1 本地草稿池与非阻塞滑动体验 (Local Draft Pool)
- **机制**：前端组件维护 `drafts: Map<string, BotDraftState>`，草稿是**完整可编辑快照**，覆盖 `name / desc / soul / model / isDefault / avatar / disabledSkills / enabledToolsets / enabledMcpServers` 全部字段：
  - 用户改动任意字段，实时写入当前 BOT 的草稿；改动与持久化快照深比较相等时自动清除草稿；
  - 选择器滑动完全自由、流畅、零弹窗阻断。滑到其他 BOT 时展示其数据，滑回原 BOT 时自动恢复草稿，中心头像角上亮起未保存标记点；
  - **保存**必须把草稿整包写回持久化数据（`Object.assign(bot, draft)`），仅删除草稿而不回写会导致「保存后脏点复活」；
- **宿主级离场拦截 (Host-Level Exit Guard)**：
  通过 `registerDirtyGuard` 注入钩子。当外层宿主检测到用户试图：① 切换设置页左侧一级 Tab（外观/网络等）；② 按下键盘 `Esc` 键；③ 点击 Backdrop 遮罩或右上角关窗按钮；④ 关闭窗口（`beforeunload`）时，宿主控制器执行全局拦截并呼出「放弃修改 / 留在当前」确认弹窗。

### 7.2 折叠抽屉动效契约 (Accordion Transition)
- 遵循 `grid-template-rows: 0fr -> 1fr` 标准硬件加速折叠契约：
  - 展开时：`grid-template-rows: 1fr`，过渡时间 **180ms**，曲线 `cubic-bezier(0.16, 1, 0.3, 1)`；
  - 折叠时：`grid-template-rows: 0fr`，过渡时间 **120ms**，干净利落。

### 7.3 头像资产与新建向导受控流
- **头像上传**：悬停中心头像出现编辑遮罩 → 点击调起文件选择（校验图片类型与 ≤2MB）→ 客户端等比裁剪为 256×256px WebP → 写入草稿 `avatar`，**不直接改持久化数据**，toast 明示「未保存」；「恢复默认头像」写 `avatar: null` 墓碑语义，使「重置」可还原；
- **新建向导 Modal**：受控组件，由 `SettingsSnapshot.botManagement.isWizardOpen` 驱动显隐；表单含模式切换（空白/克隆）、BOT ID（`/^[a-z0-9-]{2,32}$/` + 重名预检，实时标红）、显示名称、绑定模型；克隆模式追加源 BOT 选择与继承选项；提交调用 `onSubmitCreateBot`，成功后自动定位至新建项并高亮。

### 7.4 失败处理与防重入
- **失败横幅**：错误信息挂载于工具条与配置区之间的横幅（`role="alert"`，带关闭按钮），**绝不重置或清空表单**；
- **防重入**：提交期间 `保存` 按钮 `disabled` 并显示「保存中…」，配置区施加只读锁，防止连击覆盖。
