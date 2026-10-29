# Hermes Flux ✨

> **The Elegant Universal Workspace for Hermes Agent**  
> 全平台极客美学工作台（覆盖 Desktop、Web、iOS 与 Android）

---

## 愿景：美学即生产力 (Aesthetic First)

传统 AI 命令行和大多数社区客户端充斥着糙汉极客风（生硬黑底绿字、粗糙弹窗、长段代码滑动卡顿）。

**Hermes Flux** 的核心使命是：**为 Hermes Agent 打造一套具有顶级电影级暗黑美学、顺滑微交互与统一设计语言的跨端生产力工作台**。无论在 Mac 宽屏显示器、iPad、还是 iPhone / Android 竖屏上，每一次与智能体的交互都赏心悦目。

---

## 核心架构：现代 Monorepo (单核驱动，多端开花)

```text
hermes-flux/
├── packages/
│   ├── ui/         # [核心] 跨端共享 React 19 UI、Tailwind 4 设计系统、Zustand 状态
│   ├── desktop/    # [桌面端] macOS, Windows, Linux (Electron / Tauri 深度集成)
│   ├── mobile/     # [移动端] iOS & Android 双端原生体验 (继承 C++ 零内存防 OOM)
│   └── web/        # [Web / PWA] 独立浏览器工作台
```

---

## 顶级美学规范速览 (Aura Design System)

* **深邃背景**：`#080808` 暗银微颗粒黑底，杜绝廉价纯黑死板。
* **光晕高亮**：
  * **琥珀暖金 (`#FFBF00`)**：系统默认状态光环，沉稳内敛。
  * **冰蓝流光 (`#00E5FF`)**：数据流与工具调用执行态。
  * **暗紫链路 (`#A855F7`)**：多智能体思考与协同。
* **排版尺度**：采用 Apple 与现代设计系统同款比例，中文使用 PingFang / HarmonyOS 优化字体栈，代码采用 JetBrains Mono 等宽字体。

---

## 核心架构与设计规范索引

* [核心技术架构与双向数据交互设计规范](docs/architecture/core-architecture-and-data-flow-spec.md)
* [官方网关 252 RPC / 77 事件 / 13 反向请求全量映射表](docs/architecture/gateway-api-and-features-matrix.md)
* [动态主题引擎与扩展架构设计方案](docs/architecture/theme-engine-spec.md)
* [视觉设计哲学与设计系统规范 (Tokens)](docs/design-system/04-tokens-and-design-system-spec.md)
* [工程纪律与自动化测试门禁 (Ironclad Disciplines)](ENGINEERING_DISCIPLINE.md)

