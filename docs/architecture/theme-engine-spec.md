# Hermes Flux 动态主题引擎与扩展架构设计方案

> **核心目标**：提供全平台（Web/Desktop/iOS/Android）一致的、高扩展性的动态皮肤（Skin/Theme）引擎。支持声明式 JSON/CSS Token 扩展、运行时热重载、第三方皮肤市场分发与自定义导入。

---

## 一、架构分层模型

为了让 UI 极其高级、并且在手机/电脑上切换皮肤时**毫秒级无白屏热切换**，设计三层主题模型：

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. 皮肤定义层 (Skin Manifest & Token Spec)                   │
│    - JSON / YAML 声明式配置 (支持社区独立打包、分享与导入)     │
│    - 定义色彩梯度 (Palette)、光晕属性 (Glow)、磨砂毛玻璃 (Blur) │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. 状态与引擎层 (Aura Theme Engine - packages/ui)            │
│    - Zustand + ThemeProvider 管理当前活跃皮肤               │
│    - CSS Variables / Dynamic Style 映射器                   │
│    - 跨端桥接: Web/Desktop 走 CSS 变量, Mobile 走 ThemeContext│
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. 消费渲染层 (Components)                                   │
│    - 原子组件直接绑定 Token (如 `bg-surface-0`, `aura-glow`) │
│    - 切换皮肤时，仅触发变量变更，不销毁重建 DOM/组件树      │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、标准皮肤协议规范 (Skin Token Specification)

每个皮肤由一个标准的 `skin.json` 定义，结构如下：

```json
{
  "id": "aura-obsidian-gold",
  "name": "Obsidian Gold",
  "displayName": "黑曜琥珀",
  "version": "1.0.0",
  "author": "Hermes Flux Team",
  "mode": "dark",
  "tokens": {
    "surfaces": {
      "base": "#080808",
      "card": "#121212",
      "elevated": "#1A1A1A",
      "glass": "rgba(18, 18, 18, 0.75)",
      "border": "#27272A"
    },
    "accents": {
      "primary": "#FFBF00",
      "primaryGlow": "rgba(255, 191, 0, 0.25)",
      "toolCall": "#00E5FF",
      "thinking": "#A855F7",
      "success": "#10B981",
      "error": "#EF4444"
    },
    "typography": {
      "textPrimary": "#F5F5F7",
      "textSecondary": "#A1A1AA",
      "textMuted": "#52525B",
      "fontMono": "JetBrains Mono"
    },
    "effects": {
      "blurStrength": 20,
      "glowRadius": 16,
      "cardRadius": 14
    }
  }
}
```

---

## 三、扩展机制：用户如何自定义与导入皮肤？

1. **本地可视化调色盘（In-App Creator）**：
   - 客户端内置“皮肤实验室（Skin Studio）”，用户可直接吸取主色、微调底色深浅、调整毛玻璃模糊度，所见即所得实时预览。
2. **免打包热加载（Hot-load via JSON/URL）**：
   - 支持从 GitHub 仓库、Gist 或本地文件导入 `.aura-theme`（JSON）文件，瞬间生效。
3. **社区生态兼容**：
   - 协议向下兼容 Hermes 官方 CLI 的 `display.skin` 规范，实现终端、桌面、手机统一穿同一套衣服。
