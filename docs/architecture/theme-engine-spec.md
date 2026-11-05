# Hermes Flux 单一真值皮肤系统规范 (Theme & Skin Engine Spec)

> **定位与核心原则**：
> 彻底终结多源真值漂移（旧 styles.css 手写块、themeRegistry 29 槽表、tokens.ts 僵尸表）。
> 本规范确立 `packages/ui/src/tokens/skins.ts` 为**全仓唯一皮肤真值源**，通过自动化生成链编译至 CSS 标记区，实行严格的 43 槽完备性契约与别名收敛机制。

> ⚠️ **工程契约真值 ≠ 美学真值**：本文约束的是**槽位完备性、别名收敛与生成链**，不定义「什么好看」。
> 其中 `--primary-glow` / `--success-glow` / `--shadow-window|card|dock` / `badge-palette`
> 作为**必填槽**，编码了 editorial 姿态假设（光晕、静态阴影、5 色相类别色）。
> Hermes Flux 默认 **`tool` 姿态**，美学以 `/opt/data/profiles/aura/workspace/specs/05-aesthetic-constitution-and-skin-derivation.md`（Aura 设计总监工作区 · 审美宪法） 的 I1–I6 为准（零静态阴影、单色、动效只承载状态）。
>
> **P1 待办（契约美学中立化）**：装饰槽降为可选并默认 `none`、派生槽改由 L0 规则生成、
> `badge-palette` 类别色收敛为中性块 + 文字标签。**中立化前，不要仅凭本文件生成 tool 姿态皮肤**；
> 参考映射见 Aura 工作区 `specs/skins/linear-dark.json`。

---

## 一、43 语义槽契约规范 (SLOT_IDS Specification)

每个皮肤由 42 个 CSS 变量槽 + 1 个 `badge-palette` 语言徽章调色板槽组成（共 43 槽，强契约 `SLOT_IDS.length === 43`），槽名对齐现代设计系统与 shadcn 规范：

```typescript
// 引用 packages/ui/src/tokens/skins.ts 实码定义
export const SLOT_IDS = [
  // 1. 底色族 (10 槽)
  '--background', '--card', '--card-hover', '--card-active', '--popover',
  '--sidebar', '--panel', '--input', '--code', '--backdrop',
  // 2. 衍生背景族 (2 槽)
  '--secondary', '--muted',
  // 3. 前景字色族 (4 槽)
  '--foreground', '--secondary-foreground', '--muted-foreground', '--faint',
  // 4. 主色族 (8 槽)
  '--primary', '--primary-hover', '--primary-dim', '--primary-glow',
  '--primary-subtle', '--primary-border', '--primary-foreground', '--ring',
  // 5. 状态反馈族 (4 槽)
  '--success', '--success-glow', '--warning', '--destructive',
  // 6. 边框族 (3 槽)
  '--border', '--border-subtle', '--border-strong',
  // 7. 物理层级阴影族 (3 槽)
  '--shadow-window', '--shadow-card', '--shadow-dock',
  // 8. 扩展与高亮族 (8 槽)
  '--hl-comment', '--hl-string', '--hl-keyword', '--hl-number', '--hl-type',
  '--specular-line', '--theme-thumb-color', '--chat-user-message-bg',
  // 9. 多语言徽章调色板 (1 槽)
  'badge-palette'
] as const;
```

### 1.1 槽分组与语义

| 分组 | 包含槽位 | 规范与取值约束 |
|---|---|---|
| **底色族 (10)** | `--background`, `--card`, `--card-hover`, `--card-active`, `--popover`, `--sidebar`, `--panel`, `--input`, `--code`, `--backdrop` | `card-hover`/`active` 保持每皮肤独立定义，禁止使用单一公式粗暴派生；`--sidebar` 对应微轨与左抽屉底色。 |
| **衍生背景 (2)** | `--secondary`, `--muted` | 支撑组件库辅助背景与弱化底色，确保内置组件自动换肤无缺失。 |
| **前景字色 (4)** | `--foreground`, `--secondary-foreground`, `--muted-foreground`, `--faint` | 满足色彩对比度极性约束：深色皮肤使用高亮白/浅灰字，浅色皮肤使用深灰/近黑字。 |
| **主色族 (8)** | `--primary`, `--primary-hover`, `--primary-dim`, `--primary-glow`, `--primary-subtle`, `--primary-border`, `--primary-foreground`, `--ring` | 统一主色视觉传达，包含悬浮态、昏暗态、漫反射光晕、微细背景、细边框与高亮反白前景色。 |
| **状态反馈 (4)** | `--success`, `--success-glow`, `--warning`, `--destructive` | 成功翡翠绿呼吸光晕、警示琥珀黄与危险鲜红。 |
| **边框族 (3)** | `--border`, `--border-subtle`, `--border-strong` | 精确的物理分层描边。 |
| **阴影族 (3)** | `--shadow-window`, `--shadow-card`, `--shadow-dock` | 每皮肤完整的 CSS 阴影字符串，完整保留扩散半径与环境光沉浸质感。 |
| **扩展高亮 (8)** | `--hl-comment`, `--hl-string`, `--hl-keyword`, `--hl-number`, `--hl-type`, `--specular-line`, `--theme-thumb-color`, `--chat-user-message-bg` | 包含代码语法高亮 5 槽、窗口顶部物理受光内嵌微光线 `--specular-line`、滚动条滑块槽与对话气泡槽。 |
| **徽章调色板 (1)** | `badge-palette` | 值为 `'none'` 或对应调色板 ID（如 `'palette-1'`, `'palette-2'`, `'palette-3'`）。非 none 时必须提供 `ts`, `js`, `py`, `html`, `css` 五语言完整的 `bg`/`text`/`border`。 |

---

## 二、单一真值数据模型 (Single Source of Truth)

皮肤在 TypeScript 层面由 `SkinDefinition` 类型严格约束，缺少任何一槽即产生编译期报错：

```typescript
export type SlotId = (typeof SLOT_IDS)[number];

export interface SkinDefinition {
  label: string;
  variant: 'dark' | 'light';
  slots: Record<SlotId, string>;
  sources: Record<SlotId, string>;
}

export const SKINS: Record<string, SkinDefinition> = {
  'obsidian-gold': { ... }, // 黑曜琥珀 (深色基准，全局默认)
  'jade-white':    { ... }, // 极简冷灰 (浅色)
  'ayu-light':     { ... }, // Ayu 晨曦 (主打浅色)
  'warm-paper':    { ... }, // 经典暖白 (浅色)
  'cyber-matrix':  { ... }, // 赛博冷翠 (深色)
};
```

---

## 三、代码生成链与幂等校验 (The Generation Chain)

为了杜绝手写 CSS 与 TypeScript 常量脱节，全仓采用单向编译管道：

$$\text{packages/ui/src/tokens/skins.ts} \xrightarrow{\text{scripts/design-audit/emit-skins.mjs}} \text{packages/desktop/src/renderer/styles.css}$$

### 3.1 标记区边界与保护
`styles.css` 中的皮肤声明必须严格锁定在专属标记区内：
```css
/* === AUTO-GENERATED THEME BLOCKS START === */
[data-theme="obsidian-gold"],
:root[data-theme="obsidian-gold"] {
  --background: #0E0F12;
  --card: #14161C;
  ...
  /* 兼容旧名别名输出 */
  --bg-window: var(--background);
  --bg-card: var(--card);
  ...
}
/* === AUTO-GENERATED THEME BLOCKS END === */
```
- **写入原则**：标记区外严禁手写定义任何皮肤级槽位变量；
- **守卫门禁**：`emit-skins.mjs check` 作为 CI 必测门禁，核对 styles.css 标记区是否与 skins.ts 完全一致，检测到漂移立即阻断。

---

## 四、别名机制与平滑过渡 (Aliases & Backward Compatibility)

### 4.1 皮肤 ID 别名映射 (`SKIN_ALIASES`)
历史遗留或外部输入可能使用已被收编或更名的皮肤标识（例如 `suet-jade`）：
```typescript
export const SKIN_ALIASES: Record<string, string> = {
  'suet-jade': 'jade-white',
};
```
所有消费点在解析 theme ID 时优先经由 `SKIN_ALIASES` 归一化。

### 4.2 旧 CSS 变量兼容层 (`LEGACY_VAR_NAMES`)
为保证老组件在迁移期间平滑运行，生成链自动为 40 个旧变量名生成 `var(--new-slot)` 映射别名：
```typescript
export const LEGACY_VAR_NAMES = [
  '--bg-window', '--bg-card', '--bg-card-hover', '--bg-card-active',
  '--bg-elevated', '--bg-rail', '--bg-panel', '--bg-input', '--bg-code',
  '--bg-backdrop', '--text-main', '--text-secondary', '--text-muted',
  '--text-faint', '--accent', '--accent-hover', '--accent-dim',
  '--accent-glow', '--accent-subtle', '--accent-border', '--accent-text',
  '--jade-pulse', '--jade-glow', '--danger-color', '--border-medium',
  ...
] as const;
```
组件逐步迁移至标准槽位后，相关旧别名将在波③重写时安全退役。

---

## 五、表驱动极速换肤切词器 (`getToggleTheme`)

顶栏快捷换肤与全局快捷键遵循纯表驱动设计，消除硬编码分支：

```typescript
export function getToggleTheme(currentTheme: string): 'obsidian-gold' | 'ayu-light' {
  const resolved = SKIN_ALIASES[currentTheme] ?? currentTheme;
  const skin = SKINS[resolved];
  const isLight = skin ? skin.variant === 'light' : false;
  return isLight ? 'obsidian-gold' : 'ayu-light';
}
```
- **行为确定性**：当前为任何浅色皮肤（`ayu-light`、`jade-white`、`warm-paper` 或别名 `suet-jade`）时，点击切至主打深色 `obsidian-gold`；当前为深色皮肤时，切至主打浅色 `ayu-light`。
