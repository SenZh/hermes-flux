# Hermes Flux 核心技术架构与双向数据交互设计规范
> **Document Status**: Production Architecture Specification (工业级架构设计方案)  
> **Target System**: Hermes Flux Universal Geek Workspace (Desktop, Web, iOS, Android, VS Code)  
> **Author**: Principal Systems Architect  
> **Date**: October 2026  
> **Governing Discipline**: `ENGINEERING_DISCIPLINE.md` & `AGENTS.md` (Zero-Illusion Engineering)

---

## 目录
1. [架构愿景与全景拓扑 (System Vision & Architecture Topology)](#一架构愿景与全景拓扑)
2. [全平台 Monorepo 技术框架选型与分层规范](#二全平台-monorepo-技术框架选型与分层规范)
   - 2.1 依赖拓扑与包结构划分 (`packages/*`)
   - 2.2 `packages/core`：无界协议与核心算法沉淀
   - 2.3 `packages/ui`：纯净 React 19 + Tailwind CSS 4 美学工程
   - 2.4 `packages/desktop`：Electron / Tauri 深度整合与本地宿主守护
   - 2.5 `packages/mobile`：Capacitor vs Expo 选型与 C++ 零内存流式继承
   - 2.6 `packages/web`：独立 Web 工作台与 PWA 流水线
   - 2.7 平台抽象适配层 (Platform Abstraction Layer - PAL)
3. [核心通信管道与 WebSocket 状态机](#三核心通信管道与-websocket-状态机)
   - 3.1 客户端五态有限状态机 (FSM)
   - 3.2 全抖动指数退避重连算法 (Exponential Backoff with Full Jitter)
   - 3.3 滑动心跳看门狗与应用层半开检测 (Half-Open Watchdog)
   - 3.4 三态断路器熔断机制 (Circuit Breaker)
4. [双向全双工交互流架构设计](#四双向全双工交互流架构设计)
   - 4.1 Client ➔ Gateway (RPC 请求发起与响应关联管道)
   - 4.2 Gateway ➔ Client (77 种下行事件高效分发与 React 渲染合流)
   - 4.3 超高频流式 Token 渲染合流引擎 (Streaming Token Render Coalescing)
   - 4.4 Gateway ➔ Client (13 种服务端反向干预请求挂起、弹窗与闭环回传)
5. [离线恢复与数据一致性防御体系](#五离线恢复与数据一致性防御体系)
   - 5.1 单调递增版本戳与 CAS (Compare-And-Swap) 并发仲裁
   - 5.2 单实体失败隔离 (Single-Entity Failure Isolation)
   - 5.3 慢响应复活防线与逻辑删除墓碑机制 (In-Flight Mutation Tombstones)
   - 5.4 离线待发消息队列与入队配置不可变冻结 (Immutable Queue Snapshotting)
6. [状态管理拓扑与高敏内存治理](#六状态管理拓扑与高敏内存治理)
   - 6.1 Zustand 双层 Store 拓扑 (Global Session Store + Domain Slice Stores)
   - 6.2 移动端与系统级 OOM 紧急排空协议 (OOM Emergency Eviction Protocol)
   - 6.3 视口内活跃实体骨架化 (Skeletonization)
7. [工业级落地路线图与验收硬门禁](#七工业级落地路线图与验收硬门禁)

---

## 一、架构愿景与全景拓扑

Hermes Flux 是面向 Hermes Agent 全生态构建的端到端、跨平台极客美学工作台。系统不仅需要支撑官方 **252 个 RPC 方法、77 种推送事件与 13 种服务端反向干预请求**，更必须在 **Desktop (macOS / Windows / Linux)**、**Mobile (iOS / Android)**、**Web 工作台** 以及 **VS Code Extension** 之间实现最高达 85% 以上的代码共享率，同时在各个宿主平台提供原生级的性能、触觉震动、物理视口交互与电影级暗黑质感。

### 1.1 系统全景分层架构图

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               Hermes Flux Applications                                 │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐  ┌─────────────┐  │
│  │ packages/desktop  │  │  packages/mobile  │  │   packages/web    │  │  (VS Code)  │  │
│  │ Electron / Tauri  │  │  Expo SDK / Cap.  │  │   Vite PWA Shell  │  │ Extension   │  │
│  │ Tray, PTY, Window │  │  Safe Area, Live  │  │   ServiceWorker   │  │ Webview     │  │
│  │ Daemon Watchdog   │  │  Activity, C++ FS │  │   Edge CDN Caching│  │ Host Bridge │  │
│  └─────────┬─────────┘  └─────────┬─────────┘  └─────────┬─────────┘  └──────┬──────┘  │
└────────────┼──────────────────────┼──────────────────────┼───────────────────┼─────────┘
             │                      │                      │                   │
┌────────────▼──────────────────────▼──────────────────────▼───────────────────▼─────────┐
│                                packages/ui (Pure Presentation)                         │
│  • React 19 Client Tree (Concurrent Rendering, useTransition, Actions, Suspense)       │
│  • Tailwind CSS 4 Design Tokens (Dynamic CSS Variables, Zero-Runtime Theme Engine)      │
│  • Aesthetic Component Library (Fluid Timeline, Thinking Fold, Tool Capsule, Diff View)│
│  • Centralized Animation Ticker (Single-Clock RAF Dispatcher, Idle Pause)              │
│  • Virtualized Stream List (Zero-Lag Markdown / Code Chunking, DOM Node Reuse)         │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
┌──────────────────────────────────────────▼─────────────────────────────────────────────┐
│                                packages/core (Pure TypeScript)                         │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Platform Abstraction Layer (PAL - IStorage, INetwork, IFileStream, INativeBridge)│  │
│  ├──────────────────────────────────────────────────────────────────────────────────┤  │
│  │ State Machine & Pipeline Engine:                                                 │  │
│  │  • WebSocket FSM: 5-State Circuit Breaker, Exponential Jitter, Half-Open Watchdog│  │
│  │  • RPC Pipeline: Monotonic ID, PendingRpcRegistry, Epoch-Lease, AbortController │  │
│  │  • Coalescing Engine: RAF Buffer, Micro-batching Stream Delta (120 FPS Throttle) │  │
│  │  • Reverse Intervention Engine: 13 Server Requests Suspender & Modal Stack        │  │
│  │  • Consistency Engine: CAS Monotonic Stamps, Tombstone Guard, Single-Entity Iso  │  │
│  │  • State Topology: Zustand Two-Tier Stores + L1/L2/L3 OOM Emergency Eviction    │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │ JSON-RPC 2.0 over WebSocket / WSS
┌──────────────────────────────────────────▼─────────────────────────────────────────────┐
│                     Hermes Gateway (Official Gateway Daemon)                           │
│     252 RPC Methods ◄──────────────► 77 Server Events ◄──────────────► 13 Requests     │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 跨端 Surface Matrix 显式声明

遵循《ENGINEERING_DISCIPLINE.md》前置军规，任何技术框架与数据流设计必须显式声明全端 Surface 运行行为：

| 端目标 (Runtime) | 物理外壳 / 宿主 | 通信信道 | 存储驱动 | 特异能力适配与物理降级 |
|---|---|---|---|---|
| **Web** | Vite PWA / SPA | 标准 WebSocket / WSS | IndexedDB + LocalStorage | 无本地 PTY；文件通过原生 Blob/Stream 管道下载；离线时通过 ServiceWorker 拦截静态资产。 |
| **Desktop** | Electron 34+ (支持 Tauri 2 架构切分) | WebSocket (直连本地/远程) + IPC | 本地加密 SQLite / FS | 支持嵌入式本地终端 (node-pty)、系统托盘图标、全局快捷键唤醒、后台本地 Gateway 进程守护与重启。 |
| **Mobile (iOS)** | Expo SDK 52+ / Capacitor 7 | WebSocket (带原生网络状态绑定) | MMKV (react-native-mmkv) | 适配 iOS 灵动岛 (Dynamic Island / Live Activity)；刘海屏 Safe Area 避让；WKWebView 惯性滑动锁防卡死。 |
| **Mobile (Android)** | Expo SDK 52+ / Capacitor 7 | WebSocket (带前后台常驻保持) | MMKV (高性能 JNI 映射) | **C++ 零内存流式下载**（直写私有 Cache 后通过 NIO 拷入 SAF 目录，彻底杜绝 JVM OOM）；触觉微振反馈。 |
| **VS Code** | VS Code Webview Extension | VS Code Extension Host IPC 转接 | `vscode.ExtensionContext.globalState` | 降级隐藏系统级配置与桌面进程启停面板；专注于代码审查、Diff 恢复、当前工程上下文与会话交互。 |

---

## 二、全平台 Monorepo 技术框架选型与分层规范

### 2.1 依赖拓扑与包结构划分

采用 **Bun Workspace + Turborepo** 作为统一 monorepo 工具链，严格禁止跨包双向依赖与底层循环引用。代码仓库结构如下：

```text
hermes-flux/
├── package.json               # Root Workspace 配置
├── turbo.json                 # Turborepo 并行构建与拓扑依赖调度规则
├── packages/
│   ├── core/                  # [纯 TS 核心库] 协议、状态机、RPC、事件总线、数据一致性、PAL 契约
│   ├── ui/                    # [纯 React 19 UI 库] Tailwind 4、设计系统原子、流式聊天、Markdown、主题
│   ├── desktop/               # [桌面端宿主] Electron 主进程、Preload、PTY 代理、本地 Gateway 守护
│   ├── mobile/                # [移动端双端] Expo / React Native，iOS 灵动岛、Android C++ 下载插件
│   └── web/                   # [Web 工作台] Vite PWA、ServiceWorker、Nginx 反代配置模版
```

依赖拓扑强制单向流动：
$$\text{desktop / mobile / web} \longrightarrow \text{packages/ui} \longrightarrow \text{packages/core}$$
`packages/core` 绝对禁止依赖任何 UI 框架（React/DOM/React Native），确保纯逻辑可 100% 独立于 Node/Bun/Browser 运行时进行无桩单测。

---

### 2.2 `packages/core`：无界协议与核心算法沉淀

`packages/core` 是 Aura 全平台的无界面大脑，负责收敛所有非 UI 相关的逻辑契约：
1. **官方协议强类型字典**：基于 `gateway-api-and-features-matrix.md` 自动化生成的 252 个 RPC 入参/出参接口、77 种下行事件判别联合（Discriminated Unions）与 13 种服务端反向干预结构。
2. **连接生命周期与状态机**：含双向滑动心跳、退避重连、半开探测与断路器。
3. **RPC 交互管线**：挂起映射、并发冲突仲裁、CAS 算法与超时策略。
4. **流式数据帧合流器**：高频数据批量调度器。
5. **离线与一致性引擎**：逻辑墓碑存储、不可变队列快照、版本仲裁。

---

### 2.3 `packages/ui`：纯净 React 19 + Tailwind CSS 4 美学工程

#### 1. 纯净 React 19 架构约束
- **零平台特异性 DOM 泄露**：UI 内部绝不直接调用 `window.electron`、`navigator.userAgent` 或 `expo-*` 原生模块。所有与宿主平台的交互必须通过 `packages/core` 注入的 `IPlatformAdapter` 契约完成。
- **React 19 并发渲染利用**：
  - 流式文本更新采用 `useDeferredValue` 与 `useTransition`，防止长文本高频打字阻塞用户点击与输入框响应。
  - 数据提交全面拥抱 React 19 **Actions** 与 `useActionState`，将加载态、错误边界与乐观更新原生统一。
- **集中式单一动画时钟 (Centralized Duration Ticker)**：
  严格执行《ENGINEERING_DISCIPLINE.md》，彻底禁止组件分散使用 CSS `animation: infinite` 产生隐形 GPU 合成消耗。通过核心 Hook `useDurationTicker` 驱动呼吸光晕、打字光标与加载 Spinner：

```typescript
// packages/ui/src/hooks/useDurationTicker.ts
import { useEffect, useState } from 'react';

type TickerFrequency = 'spinner' | 'pulse' | 'counter';

class GlobalTicker {
  private static instance: GlobalTicker;
  private listeners = new Map<TickerFrequency, Set<(time: number) => void>>();
  private timers = new Map<TickerFrequency, ReturnType<typeof setInterval>>();

  private constructor() {
    this.listeners.set('spinner', new Set()); // 4 Hz (250ms)
    this.listeners.set('pulse', new Set());   // 1 Hz (1000ms)
    this.listeners.set('counter', new Set()); // 1/60 Hz (60000ms)
  }

  public static getInstance(): GlobalTicker {
    if (!GlobalTicker.instance) GlobalTicker.instance = new GlobalTicker();
    return GlobalTicker.instance;
  }

  public subscribe(freq: TickerFrequency, cb: (time: number) => void): () => void {
    const set = this.listeners.get(freq)!;
    set.add(cb);
    if (set.size === 1) this.startTimer(freq);
    return () => {
      set.delete(cb);
      if (set.size === 0) this.stopTimer(freq);
    };
  }

  private startTimer(freq: TickerFrequency) {
    const intervalMs = freq === 'spinner' ? 250 : freq === 'pulse' ? 1000 : 60000;
    this.timers.set(freq, setInterval(() => {
      const now = performance.now();
      this.listeners.get(freq)?.forEach(cb => cb(now));
    }, intervalMs));
  }

  private stopTimer(freq: TickerFrequency) {
    const timer = this.timers.get(freq);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(freq);
    }
  }
}

export function useDurationTicker(freq: TickerFrequency = 'pulse'): number {
  const [tick, setTick] = useState<number>(() => performance.now());
  useEffect(() => {
    return GlobalTicker.getInstance().subscribe(freq, (now) => setTick(now));
  }, [freq]);
  return tick;
}
```

#### 2. Tailwind CSS 4 动态主题管道
在 Tailwind 4 原生 CSS 层级（CSS Cascade Layers & `@theme` 指令）上构建零运行时开销主题系统：
- 避免在 `<html>` 或根节点频繁更新多层级继承变量；
- 建立 `@theme` 静态映射，动态切换仅替换 `:root[data-skin="..."]` 属性，样式计算完全交由 GPU / CSSOM 处理，JS 运行时 0ms 开销。

---

### 2.4 `packages/desktop`：Electron / Tauri 深度整合与本地宿主守护

#### 1. 框架选型深度权衡与决议

| 维度 | Electron 方案 | Tauri 2.0 方案 | 决议与架构取舍 |
|---|---|---|---|
| **生态成熟度** | 工业级成熟度极高，VS Code、Slack 标配验证。 | 快速演进中，生态插件与复杂 Webview 调试相对年轻。 | **首发采用 Electron 34+ 打造旗舰桌面版**，确立绝对生产力基线。 |
| **本地终端支持** | `node-pty` 成熟稳定，C++ 绑定终端与 PTY 进程隔离完备。 | 需通过 Rust `portable-pty` 封装，多平台边缘行为需额外维护。 | 桌面版必须支持嵌入式全功能 CLI 伪终端，Electron + `node-pty` 成熟度更优。 |
| **内存与包体体积** | 包体 ~85MB，基线内存 ~120MB。 | 包体 ~15MB，基线内存 ~40MB。 | 架构上预留 **Tauri 2 Bridge 抽象**，通过 `packages/core/pal` 实现无痛双模态编译支持。 |
| **本地网关守护** | Node.js 原生 `child_process.spawn` 看门狗监控极度轻便。 | Rust 线程并发守护能力强。 | Electron 主进程可直接承担 Gateway 本地常驻子进程的存活监控与日志切分。 |

#### 2. Electron 主进程核心职能
- **本地网关守护进程 (Local Gateway Watchdog)**：当用户选择“本地单机离线运行”时，Electron 主进程负责启动本地 Python/Hermes Gateway 二进制或服务，通过 IPC 汇报服务状态，异常崩溃时自动重启并记录崩溃堆栈。
- **嵌入式终端代理 (node-pty Bridge)**：主进程与渲染进程通过安全双向 IPC 流实现毫秒级伪终端交互，支持 ANSI 颜色、窗口大小 Resize 同步与二进制输出分片。
- **系统级美学集成**：macOS 启用 `titleBarStyle: 'hiddenInset'` 与 `vibrancy: 'under-window'`；Windows 11 启用 `backgroundMaterial: 'mica'`，使工作台视觉与系统底层深度融合。

---

### 2.5 `packages/mobile`：Capacitor vs Expo 选型与 C++ 零内存流式继承

#### 1. 框架选型深度权衡与决议

| 维度 | Capacitor 方案 | Expo SDK 52+ (React Native) 方案 | 架构裁决与理由 |
|---|---|---|---|
| **渲染层本质** | 系统原生 WebKit (WKWebView / WebView) | 原生控件树映射 (Fabric 原生组件) 或混合宿主 | **选定 Expo SDK 52+** 作为核心移动基础架构。 |
| **滚动与键盘动效** | iOS WebKit 在键盘升起时有严重的滚动重绘死锁与惯性滑动丢帧风险。 | 原生 iOS/Android 键盘联动与滚动视图由底层驱动，物理跟手性与 120Hz 刷新率无懈可击。 | 移动端极致美学要求触控必须具备物理级阻尼与弹性，原生驱动不可替代。 |
| **成熟资产复用** | 无法直接复用已验证的原生 Java/Kotlin 插件。 | **可 100% 继承并无缝衔接 `hermes-android` 已验证的所有原生插件与工程纪律**。 | 规避二次踩坑，直接复用既有模块。 |

#### 2. 深度继承：底层 C++ / 原生零内存流式下载与分享架构
在移动端处理大文件、代码仓库归档（ZIP）或大附件时，若将二进制流先读取到 JS 堆（如 `base64` 编码字符串），iOS/Android 会发生瞬时 $2\sim4\times$ 内存膨胀，瞬间触发系统级 `OOM (OutOfMemory)` 强杀。

Aura Mobile 严格继承并在 iOS/Android 双端同构落地 **两阶段安全流式管道 (Two-Phase Safe Stream Pipeline)**：

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        Two-Phase Zero-Memory Streaming Pipeline                         │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 阶段一：原生直写沙盒私有缓存 (Direct Native Stream)                                      │
│                                                                                        │
│  Remote URL ──────────► [ Native C++ / OkHttp / NSURLSession ]                         │
│                                │                                                       │
│                                ├──► [150ms Throttled Event] ──► JS Thread: 瞬时网速/进度│
│                                ▼                                                       │
│                       Local App Cache Dir                                              │
│                   (Paths.cache/hermes_dl_tmp.bin)                                      │
│                  (零 JS 堆内存介入，彻底杜绝 JVM/V8 OOM)                                │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 阶段二：底层原子拷贝至公共存储 (Atomic Zero-Copy Persistence)                             │
│                                                                                        │
│      Local App Cache Dir                                                               │
│               │                                                                        │
│               ▼ [ Native NIO channel.transferTo / sendfile() ]                         │
│      Android SAF / iOS App Group Shared Container                                      │
│               │                                                                        │
│               ├──► 自动同名防冲突仲裁 (resolveFileNameConflict: app (1).apk)              │
│               ├──► 覆写前显式 unlink 同名节点 (规避 DocumentFile 伪复制)                  │
│               └──► 清理临时私有缓存文件                                                │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Android 侧实现准则**：严格使用 `File.createDownloadTask` 流式直写私有安全缓存 `Paths.cache`，下载完毕后通过底层 Java NIO `FileChannel.transferTo` 写入 SAF 目录；同名覆盖前必须先 `existingFile.delete()`。
- **iOS 侧实现准则**：通过 `NSURLSessionDownloadTask` 直接将后台网络流落盘到沙盒 `NSTemporaryDirectory`，完成后通过 `NSFileManager` 移动到目标沙盒或调起 `UIActivityViewController` 原生分享面板，JS 引擎全程仅接收数字型进度事件。

#### 3. iOS 灵动岛 (Dynamic Island) 与 Live Activity 深度适配
通过 ActivityKit 原生扩展，当移动端退至后台或锁屏时，为 Agent 任务维持灵动岛实时监控：
- **思考中态**：灵动岛收缩为暗紫微光呼吸环，展示当前 Agent 思考步数与上下文占比；
- **工具调用态**：展开为冰蓝胶囊卡片，滚动显示当前执行的命令名（如 `bash: cargo test`）与瞬时执行耗时；
- **反向干预态 (Approval / Clarify)**：灵动岛展开为警示悬浮窗并触发 Haptic 强烈提示，用户长按即可快速选择【允许】或【阻断】。

---

### 2.6 `packages/web`：独立 Web 工作台与 PWA 流水线

1. **ServiceWorker 离线流与静态资源缓存**：
   - 离线时缓存工作台 UI Shell、字体（`JetBrains Mono`、`PingFang SC`）与静态图标；
   - 捕获异常 502/504 网关错误，呈现优雅的离线诊断卡片，而非浏览器原始白屏。
2. **反向代理与端口复用**：
   - 提供标准 Nginx 反代配置模版，将单端口 `/ws` 代理至网关 WebSocket，`/` 代理至 SPA 静态资源，彻底消除跨域与 Mixed-Content 阻碍。

---

### 2.7 平台抽象适配层 (Platform Abstraction Layer - PAL)

为了确保 `packages/ui` 与 `packages/core` 拥有 100% 跨端可移植性与可测试性，定义统一的抽象接口契约：

```typescript
// packages/core/src/pal/types.ts

export interface IStorageDriver {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  multiGet(keys: string[]): Promise<Record<string, string | null>>;
  multiSet(kvMap: Record<string, string>): Promise<void>;
}

export interface IFileStreamer {
  downloadStream(
    url: string,
    targetFileName: string,
    onProgress: (bytesWritten: number, totalBytes: number) => void
  ): Promise<{ localPath: string }>;
  openFile(localPath: string, mimeType?: string): Promise<void>;
  shareFile(localPath: string, mimeType?: string): Promise<void>;
}

export interface INativeBridge {
  triggerHaptic(type: 'light' | 'medium' | 'heavy' | 'warning' | 'success'): void;
  copyToClipboard(text: string): Promise<void>;
  readClipboard(): Promise<string>;
  showNotification(title: string, body: string, payload?: Record<string, unknown>): Promise<void>;
  promptBiometrics(reason: string): Promise<boolean>;
  getAppLifecycle(): 'active' | 'background' | 'inactive';
}

export interface IPlatformAdapter {
  platform: 'desktop' | 'mobile-ios' | 'mobile-android' | 'web' | 'vscode';
  storage: IStorageDriver;
  fileStreamer: IFileStreamer;
  native: INativeBridge;
}
```

各端外壳在启动时将真实适配器实例化，并在初始化根容器时通过依赖注入（DI）注入 `CoreRuntime`。单元测试时直接注入 `InMemoryStorageDriver` 与 `NoopNativeBridge`，**严禁使用 `vi.mock()` 劫持全局模块**。

---

## 三、核心通信管道与 WebSocket 状态机

### 3.1 客户端五态有限状态机 (FSM)

长连接客户端不仅需要处理常规的打开与关闭，还必须精准表达离线断网、服务端拒绝、抖动重连以及断路器熔断保护。严禁使用分散的布尔状态组合，必须采用**判别联合有限状态机**：

```text
       ┌──────────────────────────────┐
       │                              │
       ▼                              │ (Socket Error / TCP Reset)
┌──────────────┐   connect()   ┌──────────────┐   Handshake OK   ┌──────────────┐
│ DISCONNECTED ├──────────────►│  CONNECTING  ├─────────────────►│  CONNECTED   │
└──────────────┘               └──────┬───────┘                  └──────┬───────┘
       ▲                              │                                 │
       │                              ▼ (Timeout / Handshake Fail)      │ (Watchdog Half-Open /
       │                       ┌──────────────┐                         │  Network Drop)
       │ (Max Retries / Fatal) │    ERROR     │                         │
       └───────────────────────┤ (CircuitOpen)│◄────────────────────────┘
                               └──────┬───────┘
                                      │
                                      ▼ (Backoff Timer Triggered)
                               ┌──────────────┐
                               │ RECONNECTING │
                               └──────────────┘
```

#### 状态判别联合定义
```typescript
// packages/core/src/network/fsm.ts

export type ConnectionState =
  | { status: 'DISCONNECTED'; reason?: string }
  | { status: 'CONNECTING'; url: string; attempt: number; startedAt: number }
  | { status: 'CONNECTED'; url: string; connectedAt: number; latencyMs: number }
  | { status: 'RECONNECTING'; attempt: number; nextRetryDelayMs: number }
  | { status: 'ERROR'; error: Error; code?: number; willRetry: boolean };
```

---

### 3.2 全抖动指数退避重连算法 (Exponential Backoff with Full Jitter)

当网关重启、网络基站切换或断路器试探时，成百上千个全平台客户端可能在同一毫秒发起连接，引发**惊群风暴 (Thundering Herd)**。为此，必须采用经过数学严谨证明的 **Full Jitter（全随机抖动）指数退避算法**：

$$t_{\text{sleep}} = \text{random}(0, \; \min(t_{\max}, \; t_{\text{base}} \times 2^{\text{attempt}}))$$

```typescript
// packages/core/src/network/backoff.ts

export interface BackoffConfig {
  baseDelayMs: number;    // 基准延迟，如 1000ms
  maxDelayMs: number;     // 上限延迟，如 30000ms
  factor: number;         // 放大因子，默认 2
}

export class BackoffPolicy {
  private attempt = 0;

  constructor(private config: BackoffConfig = { baseDelayMs: 1000, maxDelayMs: 30000, factor: 2 }) {}

  public nextDelayMs(): number {
    const rawDelay = this.config.baseDelayMs * Math.pow(this.config.factor, this.attempt);
    const cappedDelay = Math.min(this.config.maxDelayMs, rawDelay);
    // Full Jitter 核心公式：从 0 到 cappedDelay 均匀随机分布
    const delayWithJitter = Math.floor(Math.random() * cappedDelay);
    this.attempt++;
    return delayWithJitter;
  }

  public reset(): void {
    this.attempt = 0;
  }

  public get currentAttempt(): number {
    return this.attempt;
  }
}
```

---

### 3.3 滑动心跳看门狗与应用层半开检测 (Half-Open Watchdog)

#### 核心痛点与排雷
在移动蜂窝网络（如电梯断网、基站切换）或 Wi-Fi 静默断开时，底层的操作系统级 TCP KeepAlive 探测可能长达数十分钟才上报断开（甚至静默挂死），导致客户端处于**网络半开（Half-Open）**假活死锁态。

#### 权威看门狗设计规约
严格遵守《ENGINEERING_DISCIPLINE.md》：
1. **探测窗口收敛**：心跳周期必须设为 $2 \times \text{RTT} + \text{Jitter}$（基线 10s 发送一次 `ping`，容忍阈值严格设为 **5s**，超时无 `pong` 直接判定为半开死锁）；
2. **主动句柄硬杀**：一旦判定 Half-Open，看门狗绝对禁止等待浏览器内核超时，**必须主动调用底层的 `socket.destroy()` 或 `ws.close(4008, 'Half-Open Watchdog Eviction')` 强行释放本地文件句柄**，立即将 FSM 置为 `ERROR` 并启动断路器重连流；
3. **滑动更新机制**：任何下行数据包（包含 77 种业务事件中的任意一条）到达时，均滑动重置心跳看门狗定时器，避免在密集的流式打字期间冗余发送 Ping 包。

```typescript
// packages/core/src/network/watchdog.ts

export class SlidingHeartbeatWatchdog {
  private pingTimer: ReturnType<typeof setTimeout> | null = null;
  private pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private isAwaitingPong = false;

  constructor(
    private readonly sendPing: () => void,
    private readonly onHalfOpenDetected: () => void,
    private readonly pingIntervalMs = 10000,
    private readonly pongTimeoutMs = 5000
  ) {}

  public start(): void {
    this.resetTimer();
  }

  public onTrafficReceived(): void {
    // 任何下行流量均证明长连接健康，滑动顺延心跳窗口
    this.isAwaitingPong = false;
    if (this.pongTimeoutTimer) {
      clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
    this.resetTimer();
  }

  public onPongReceived(): void {
    this.onTrafficReceived();
  }

  private resetTimer(): void {
    if (this.pingTimer) clearTimeout(this.pingTimer);
    this.pingTimer = setTimeout(() => this.dispatchPing(), this.pingIntervalMs);
  }

  private dispatchPing(): void {
    this.isAwaitingPong = true;
    this.sendPing();

    this.pongTimeoutTimer = setTimeout(() => {
      if (this.isAwaitingPong) {
        // 5s 未收到 Pong 响应，确诊 Half-Open 半开死锁
        this.onHalfOpenDetected();
      }
    }, this.pongTimeoutMs);
  }

  public stop(): void {
    if (this.pingTimer) clearTimeout(this.pingTimer);
    if (this.pongTimeoutTimer) clearTimeout(this.pongTimeoutTimer);
    this.isAwaitingPong = false;
  }
}
```

---

### 3.4 三态断路器熔断机制 (Circuit Breaker)

为防止服务端在持续过载、Crash 重启循环或网关认证崩溃时，客户端频繁发起无意义的高频重连击穿网关，在 FSM 外侧挂载工业级三态断路器：

```text
       连续失败 ≥ 5 次且到达阈值
  ┌─────────────────────────────────┐
  │                                 ▼
┌──────────┐   探针成功        ┌──────────┐
│  CLOSED  │◄──────────────────┤HALF_OPEN │
│(正常通行)│                   │(试探放行)│
└──────────┘                   └────┬─────┘
  ▲                                 │ 探针失败 (立即重回熔断)
  │                                 ▼
  │ 冷却计时器到达 (60s)       ┌──────────┐
  └────────────────────────────┤   OPEN   │
                               │(彻底熔断)│
                               └──────────┘
```

- **CLOSED**：断路器闭合，网络流量畅通。记录滑动 10 次连接请求的失败率；
- **OPEN**：连续失败达到 5 次或失败率超过 50% 时触发熔断。状态机停止任何自动重试，向 UI 广播【网关服务暂时不可用，进入冷却期】；
- **HALF_OPEN**：在经过冷却周期（如 60s）后，断路器仅放行一次试探性探测。若探测成功则恢复 CLOSED 并清空失败计数；若探测失败立即再次熔断进入 OPEN。

---

## 四、双向全双工交互流架构设计

### 4.1 Client ➔ Gateway (RPC 请求发起与响应关联管道)

遵循标准的 **JSON-RPC 2.0 规范**，覆盖官方全量 252 个方法：

```json
{
  "jsonrpc": "2.0",
  "id": "rpc-10482-1730000000",
  "method": "prompt.submit",
  "params": {
    "session_id": "ses-9921",
    "text": "Check system metrics",
    "idempotency_key": "idem-uuid-99a",
    "lease_epoch": 4
  }
}
```

#### 1. 单调自增 ID 与挂起生命周期字典 (`PendingRpcRegistry`)
所有发出的 RPC 均返回一个强类型的 TypeScript Promise。底层通过单调自增 ID 建立字典，杜绝内存泄漏：

```typescript
// packages/core/src/rpc/client.ts

interface PendingRpc {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeoutTimer: ReturnType<typeof setTimeout>;
  createdAt: number;
}

export class RpcClient {
  private seq = 0;
  private pending = new Map<string, PendingRpc>();

  constructor(
    private readonly sendRaw: (msg: string) => void,
    private readonly defaultTimeoutMs = 30000
  ) {}

  public async call<TResult, TParams = Record<string, unknown>>(
    method: string,
    params: TParams,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<TResult> {
    if (options?.signal?.aborted) {
      throw new Error(`RPC [${method}] aborted before dispatch`);
    }

    const id = `rpc-${++this.seq}-${Date.now()}`;
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise<TResult>((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC [${method}] timed out after ${timeoutMs}ms (ID: ${id})`));
      }, timeoutMs);

      const entry: PendingRpc = {
        method,
        resolve: resolve as (v: unknown) => void,
        reject,
        timeoutTimer,
        createdAt: Date.now()
      };

      this.pending.set(id, entry);

      // 支持外层 AbortSignal 级联取消
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          clearTimeout(timeoutTimer);
          this.pending.delete(id);
          reject(new Error(`RPC [${method}] aborted by caller (ID: ${id})`));
        }, { once: true });
      }

      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params
      });

      this.sendRaw(payload);
    });
  }

  public handleIncomingMessage(rawText: string): boolean {
    let msg: any;
    try {
      msg = JSON.parse(rawText);
    } catch {
      return false;
    }

    // 判断是否为 RPC 响应（携带 id 且包含 result 或 error）
    if (msg && typeof msg.id === 'string' && (msg.result !== undefined || msg.error !== undefined)) {
      const pendingEntry = this.pending.get(msg.id);
      if (!pendingEntry) return false;

      clearTimeout(pendingEntry.timeoutTimer);
      this.pending.delete(msg.id);

      if (msg.error) {
        pendingEntry.reject(new Error(`RPC Error [${msg.error.code}]: ${msg.error.message}`));
      } else {
        pendingEntry.resolve(msg.result);
      }
      return true;
    }
    return false;
  }

  public purgeAll(reason: string): void {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timeoutTimer);
      entry.reject(new Error(`RPC connection purged: ${reason} (ID: ${id})`));
    }
    this.pending.clear();
  }
}
```

---

### 4.2 Gateway ➔ Client (77 种下行事件高效分发与 React 渲染合流)

Gateway 在任务执行期间通过长连接下推 77 种异步事件。我们按数据特征将其分为三级管线：

| 级别 | 代表事件 | 数据特征 | 处理策略 |
|---|---|---|---|
| **L1: 超高频流式数据** | `message.delta`<br>`reasoning.delta`<br>`thinking.delta` | 100~200 Hz，小微文本片段，瞬时吞吐极高 | **非受控 RAF 帧缓冲环形队列**，微任务微批处理，合流为 60/120 FPS 渲染 |
| **L2: 离散结构化业务状态** | `tool.start` / `complete`<br>`subagent.*`<br>`status.update` | 1~5 Hz，关键生命周期变更，结构完整 | 直接进入对应 Zustand 切片 Store，触发局部组件挂起与精确重绘 |
| **L3: 全局数据变更广播** | `sessions.changed`<br>`projects.changed`<br>`cron.changed` | 偶发广播，跨设备/跨客户端同步 | 触发 TanStack Query **去惊群防抖局部失效 (Invalidate Queries)** |

---

### 4.3 超高频流式 Token 渲染合流引擎 (Streaming Token Render Coalescing)

#### 1. 传统痛点与性能陷阱
当服务端以每秒 150 个 Token 输出流式打字时，若前端直接在 WebSocket `onmessage` 内部同步调用 React 的 `setState((prev) => prev + token)`：
- 每秒触发 150 次 React 重新协调与 DOM 计算；
- 触发长列表滚动容器强制回流（Reflow）与文本布局计算；
- 在手机低配芯片或 4K 高分屏上会导致严重掉帧、电池过热、输入框按键卡顿（Multi-second input lag）。

#### 2. 合流引擎架构与实现
采用 **非受控环形缓冲区 (RAF Buffer) + `useSyncExternalStore` 订阅**：
1. WebSocket 收到 `message.delta` 时，仅将其以 $O(1)$ 时间复杂度 push 进底层内存队列，**绝不调用 React `setState`**；
2. 调度单一的 `requestAnimationFrame` 驱动时钟；
3. 在下一个显示器垂直同步帧（VSync，16.6ms 或 8.3ms）到达时，一次性取出当前帧积压的所有 Token 片段，合流拼接为单次字符串更新，通知 React 统一消费。

```typescript
// packages/core/src/pipeline/streamCoalescer.ts

export class TokenStreamCoalescer {
  private buffer: string[] = [];
  private rafId: number | null = null;
  private subscribers = new Set<(flushedChunk: string) => void>();

  public append(token: string): void {
    this.buffer.push(token);
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.flush());
    }
  }

  public subscribe(cb: (flushedChunk: string) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private flush(): void {
    this.rafId = null;
    if (this.buffer.length === 0) return;

    // 单次批处理：将该物理帧期间累积的所有 Token 拼接
    const combined = this.buffer.join('');
    this.buffer = [];

    // 通知所有观察者（React 外部存储同步挂载）
    for (const sub of this.subscribers) {
      sub(combined);
    }
  }

  public reset(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.buffer = [];
  }
}
```

---

### 4.4 Gateway ➔ Client (13 种服务端反向干预请求挂起、弹窗与闭环回传)

#### 1. 反向请求本质与协议差异
不同于单纯的通知事件，**Server Request 是服务端 Agent 主动向前端发起的阻塞性等待请求**，包含 `id`、`method` 与需要人类裁决的参数：

```json
{
  "jsonrpc": "2.0",
  "id": "srv-req-55102",
  "method": "approval",
  "params": {
    "action": "bash",
    "command": "rm -rf ./build/dist",
    "risk_level": "critical",
    "reason": "Clean build directory before distribution packaging"
  }
}
```

#### 2. 13 种服务端反向干预请求全览映射

| 请求方法 (`method`) | 核心参数特征 | UI 呈现形式与模态交互组件 | 允许的用户动作与回传 Payload |
|---|---|---|---|
| **`approval`** | `action`, `command`, `risk_level`, `reason` | **暗红微光警告确认弹窗 (Danger Modal)**：代码参数高亮、风险评级徽标、Diff 审查。 | • `allow_once: true`<br>• `allow_permanent: true`<br>• `reject: true` (带可选修正输入) |
| **`clarify`** | `questions: Array<{ id, title, options, recommended, multiSelect }>` | **多维结构化决策问卷卡片 (Questionnaire Sheet)**：支持多选、推荐标记高亮、用户自定义输入。 | 回传问卷答案字典：`{ answers: { [questionId]: string[] } }` |
| **`sudo`** | `prompt`, `user` | **系统安全提权面板**：安全脱敏密码框，与系统 Keychain/密码管理器联动。 | 回传 `{ password: string }` 或取消 |
| **`secret`** | `missing_keys: string[]`, `service_name` | **机密凭据填报卡片**：支持从本地 Vault 拾取已有密钥，或现场录入。 | 回传填报的键值对字典：`{ secrets: Record<string, string> }` |
| **`vault.code`** | `service`, `account`, `digits` (通常 6 位) | **2FA 双因子动态码弹窗**：带自动聚焦的 6 位独立数字小键盘，支持短信粘贴。 | 回传 `{ code: string }` |
| **`vault.save_login`** | `domain`, `username`, `password_hint` | **凭据入库气泡提示**：在对话栏上方弹出悬浮卡片提示是否保存该站点。 | 回传 `{ save: boolean, alias?: string }` |
| **`vault.unlock_prompt`**| `vault_id`, `reason` | **生物识别与主密码解锁面板**：调起 iOS Face ID / Android 指纹或输入 Master Password。 | 回传解锁凭据密钥签名或取消 |
| **其余 6 种扩展请求** (如环境配置确认、端口冲突裁定、重名覆盖决策等) | 各种特异环境上下文 | 通用交互式决策抽屉 (Action Sheet) | 回传结构化选择索引或自定义 Payload |

#### 3. 客户端挂起拦截器与回传闭环架构 (`InterventionSuspender`)

```typescript
// packages/core/src/intervention/suspender.ts

export interface ServerInterventionRequest {
  id: string; // 服务端下发的消息 ID，回传时必须原样绑定
  method: string;
  params: Record<string, any>;
  receivedAt: number;
}

export interface InterventionResolution {
  approved: boolean;
  payload?: Record<string, any>;
  errorReason?: string;
}

export class InterventionSuspender {
  private activeRequests = new Map<string, ServerInterventionRequest>();
  private listeners = new Set<(requests: ServerInterventionRequest[]) => void>();

  constructor(private readonly sendRawResponse: (payload: string) => void) {}

  public handleIncomingServerRequest(req: ServerInterventionRequest): void {
    this.activeRequests.set(req.id, req);
    this.notify();
  }

  public resolve(requestId: string, resolution: InterventionResolution): void {
    const req = this.activeRequests.get(requestId);
    if (!req) return;

    this.activeRequests.delete(requestId);
    this.notify();

    let responsePayload: string;
    if (resolution.approved) {
      responsePayload = JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        result: resolution.payload ?? { ok: true }
      });
    } else {
      responsePayload = JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        error: {
          code: -32000,
          message: resolution.errorReason ?? 'User rejected intervention request'
        }
      });
    }

    this.sendRawResponse(responsePayload);
  }

  public subscribe(cb: (requests: ServerInterventionRequest[]) => void): () => void {
    this.listeners.add(cb);
    cb(Array.from(this.activeRequests.values()));
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    const list = Array.from(this.activeRequests.values());
    for (const listener of this.listeners) {
      listener(list);
    }
  }
}
```

UI 顶层容器订阅 `InterventionSuspender`，当检测到有挂起请求时，依据 `method` 将其压入全局模态栈展示；用户在 UI 完成操作后调用 `resolve()`，生成标准的 JSON-RPC 2.0 响应回填服务端，Agent 解除挂起并继续向下执行。

---

## 五、离线恢复与数据一致性防御体系

### 5.1 单调递增版本戳与 CAS (Compare-And-Swap) 并发仲裁

当多设备（如用户的电脑端桌面工作台与手机端 Aura App 同时在线）操作同一会话、修改配置文件或更新定时任务时，可能发生并发修改覆盖。

1. **版本戳契约**：所有可变实体（Session、Profile、Cron Job、Skill）必须具备单调递增的 `revision`（自增整数）或 `etag`（哈希版本）；
2. **CAS 写入**：客户端提交变更时，请求体必须携带已知前序版本号 `assert_revision`；
3. **冲突拒绝**：网关若发现当前实体的 `current_revision !== assert_revision`，拒绝本次写入并返回 `409 Conflict`，携带远端最新快照；
4. **客户端合并**：Aura 捕获 409 异常后，通过三向对比（Local Draft vs Base Snapshot vs Remote Newest）弹出局部冲突合并抽屉，严禁静默覆盖。

---

### 5.2 单实体失败隔离 (Single-Entity Failure Isolation)

严格遵循《ENGINEERING_DISCIPLINE.md》事中军规：
- 在并发拉取多个会话详情、子 Agent 运行图或文件树时，**单个实体的加载/解析失败，绝对禁止清空已成功的同批次实体状态**；
- API 与 Core 契约必须严格区分全量成功与部分成功，返回判别数据结构：

```typescript
export interface BatchFetchResult<T> {
  items: T[];                                // 成功拉取到的实体集合
  incompleteEntityIds: string[];             // 明确拉取失败的实体 ID 集合
  errors: Array<{ id: string; error: string }>; // 详细失败依据
}
```
UI 仅针对 `incompleteEntityIds` 展示局部骨架重试占位符，保持其他健康实体可正常交互。

---

### 5.3 慢响应复活防线与逻辑删除墓碑机制 (In-Flight Mutation Tombstones)

#### 1. 经典时序致死陷阱
1. 用户在客户端点击【删除会话 Ses-A】；
2. 本地前端状态机立即将 Ses-A 从列表移除；
3. 但在删除操作发起前的一瞬间，用户下拉刷新发出了一次耗时 1.5 秒的 `session.list` 慢速全量拉取请求；
4. 此时，删除请求在 100ms 内成功完成；但在 1.5 秒后，先前的全量查询才慢吞吞返回，响应体中依然包含已被删除的 Ses-A；
5. 若前端简单地执行 `setSessions(response.items)`，**已被用户删除的会话将瞬间在界面“复活”！**

#### 2. 逻辑删除墓碑守卫实现
Aura 状态机维护一个带有生存周期的 **墓碑表 (Tombstone Registry)**：
- 删除实体时，在本地记录一条墓碑：`{ id: 'ses-A', deletedAt: Date.now(), minValidRevision: R }`；
- 任何慢速请求返回全量数据时，必须先流经 `Tombstone Guard` 过滤器：凡是包含在墓碑表中且版本未超过删除墓碑的实体，**被强制物理剔除**；
- 墓碑生命周期设为 30 秒（覆盖最大网络 RTT），超时后自动垃圾回收。

```typescript
// packages/core/src/consistency/tombstones.ts

export class TombstoneGuard {
  private tombstones = new Map<string, number>(); // entityId -> deletedAt
  private readonly ttlMs = 30000;

  public markDeleted(id: string): void {
    this.tombstones.set(id, Date.now());
  }

  public filterEntities<T extends { id: string }>(entities: T[]): T[] {
    const now = Date.now();
    return entities.filter(entity => {
      const deletedAt = this.tombstones.get(entity.id);
      if (!deletedAt) return true;
      if (now - deletedAt > this.ttlMs) {
        this.tombstones.delete(entity.id);
        return true;
      }
      // 实体处于墓碑保护期内，坚决拦截，杜绝慢响应复活
      return false;
    });
  }
}
```

---

### 5.4 离线待发消息队列与入队配置不可变冻结 (Immutable Queue Snapshotting)

当设备断网时，用户依然可以继续向当前会话输入 Prompt。Aura 建立持久化离线消息发送队列：
- **入队时刻即刻深拷贝冻结**：消息被用户点击发送入队的瞬间，必须**完整深拷贝**捕获当前生效的 Provider、Model（如 `gpt-4o`）、Temperature、Thinking Mode（Thinking Variant: `high`/`low`）、已挂载的技能列表与工作目录上下文；
- **禁止漂移反推**：严禁在断网 5 分钟后网络恢复、消息真正出队发送时，从界面当前的可变状态动态提取配置；避免用户在断网期间切换了模型，导致先前的历史消息被用错误的新模型发出。

---

## 六、状态管理拓扑与高敏内存治理

### 6.1 Zustand 双层 Store 拓扑 (Global Session Store + Domain Slice Stores)

为了在全端承载巨量数据（包含长会话、复杂工具输出、代码 Diff）的同时保证极速启动与零内存臃肿，采用**双层 Store 架构**：

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   Layer 1: Global Session & Gateway Store              │
│  (全局常驻内存，生命周期贯穿 App 运行全过程，轻量元数据)                │
│  • WebSocket FSM & 断路器状态                                           │
│  • 活跃会话元数据 (Active Session ID, Title, Status, Token Usage)       │
│  • 全局反向干预挂起栈 (Active Intervention Requests)                  │
│  • 系统级 Toast / 通知 / 主题皮肤 ID                                    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
        按需懒加载 (Lazy Load) / 视口离开可淘汰 (Evictable)
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│                   Layer 2: Domain Slice Stores (切片子 Store)          │
│  ┌───────────────────────┐  ┌───────────────────────┐                  │
│  │ Chat Stream Store     │  │ Workspace FS Store    │                  │
│  │ (活跃对话长列表、     │  │ (工作区工程目录树、   │                  │
│  │  思维链展开状态)      │  │  当前打开文件 AST)    │                  │
│  └───────────────────────┘  └───────────────────────┘                  │
│  ┌───────────────────────┐  ┌───────────────────────┐                  │
│  │ Cron Automation Store │  │ Petdex / Journey Store│                  │
│  │ (定时任务列表、日志)  │  │ (宠物孵化、成长足迹)  │                  │
│  └───────────────────────┘  └───────────────────────┘                  │
└────────────────────────────────────────────────────────────────────────┘
```

- **Layer 1 全局 Store** 保持极简，仅保留 ID 与元数据引用，内存常驻占用 $< 2\text{MB}$；
- **Layer 2 领域切片 Store** 仅在用户导航进入对应路由页面时才动态初始化。离开页面时，切片 Store 保持在软上限缓存中；当面临内存压力时，非前台切片直接注销重置。

---

### 6.2 移动端与系统级 OOM 紧急排空协议 (OOM Emergency Eviction Protocol)

严格遵循《ENGINEERING_DISCIPLINE.md》第二条第 8 款：当捕获操作系统级低内存告警时，**绝对禁止等待空闲帧，必须立刻触发同步阻塞级紧急三级排空**：

```text
[ OS Low Memory Warning ]
   (iOS: didReceiveMemoryWarning / Android: TRIM_MEMORY_RUNNING_CRITICAL)
       │
       ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Level 1: 离线与非视口丢弃 (L1 Eviction)                                │
│ • 立即注销所有后台未激活的 Layer 2 切片 Store                          │
│ • 清空非当前可视路由的虚拟 DOM 节点与预取缓存                          │
│ • 折叠并释放非前台已完成 Agent 的历史思维链字符串                      │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Level 2: 视口内活跃实体骨架化 (L2 Skeletonization)                     │
│ • 绝对禁止销毁正在交互的前台组件 DOM                                   │
│ • 同步卸载所有高清图片解码纹理缓冲区 (Texture Buffer)                   │
│ • 同步卸载音频波形数据、Markdown 代码语法高亮 AST 复杂树               │
│ • 原地降级为轻量级矢量占位符与纯文本骨架                               │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Level 3: 原子紧急落盘与自愈锚点 (L3 Persistence)                       │
│ • 对未持久化的会话 Draft 执行微秒级 MMKV / SQLite 原子写入             │
│ • 写入冷启动自愈恢复标记 (Self-Healing Recovery Flag)                  │
│ • 若极端情况下应用仍被系统强杀，重启时可 100% 无损还原上下文           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 七、工业级落地路线图与验收硬门禁

### 7.1 分阶段实施落地编排

```text
2026 Q4 (阶段一: 协议与通信内核)
  ├── 1. packages/core: 交付 252 RPC / 77 Events / 13 Requests 强类型生成契约
  ├── 2. packages/core: 落地 WebSocket FSM、指数抖动重连、滑动看门狗与断路器
  └── 3. packages/core: 编写 100% 隔离单测，通过 Stryker 变异测试 (Score ≥ 85%)

2026 Q4 - 2027 Q1 (阶段二: UI 美学与合流引擎)
  ├── 1. packages/ui: 搭建 React 19 + Tailwind 4 原子组件体系与单一动画时钟
  ├── 2. packages/ui: 落地流式 Token 渲染合流器 (120 FPS RAF Buffer)
  └── 3. packages/ui: 实现 13 种反向干预模态弹窗交互栈 (Approval / Clarify 等)

2027 Q1 (阶段三: 全端宿主集成与跨端 Parity)
  ├── 1. packages/desktop: Electron 主进程、node-pty 终端代理、本地 Gateway 守护
  ├── 2. packages/mobile: 迁移并验证 C++ 零内存流式下载管道、iOS 灵动岛联动
  └── 3. packages/web: Vite PWA 离线工作台与 Nginx 生产模版

2027 Q2 (阶段四: 全面硬门禁验收与交付)
  └── 全平台跑通 7 道质量硬门禁，完成真机 CDP 性能探针测试与 Parity 断言
```

### 7.2 交付验收 7 道自动化硬门禁 (Ironclad Gates)

任何提交合并至 `main` 之前，必须在 CI 隔离容器中无警告通过以下 7 道关卡：

1. **类型零假冒门禁**：`tsc --noEmit` 严格通过，全库 `any` 增量严格为 0；
2. **反 AI 劣态代码棘轮门禁 (Oxlint Anti-Slop)**：以 `merge-base` 为基准，15 条 AST 规则（严禁模块假 Mock、严禁双重类型断言等）违规增量为 0；
3. **单测进程隔离与变异门禁**：通过 `run-isolated-tests` 子进程隔离测试，Stryker 变异测试得分 $\ge 85\%$，存活变异体严格为 0；
4. **权威状态防假空门禁**：网络/服务异常分支必须保留 `null` 或抛出明确错误，严禁以 `[]` 或 `{}` 冒充权威端空数据；
5. **C++ 零内存流式管道断言**：自动化测试必须断言二进制下载路径中绝不存在 `base64()` 或大字符串中间态；
6. **全视口自愈回归门禁**：包含软键盘弹出、折叠屏开合与横竖屏旋转测试，DOM 实例无异常卸载重建，草稿 0 丢失；
7. **真实 CDP 帧率与内存探针门禁**：在真实 Headed 硬件环境下测试流式打字 10 分钟，内存增长斜率（Least-squares slope）$< 0.05\text{MB/min}$，平均帧率保持在 $60 \sim 120\text{ FPS}$。

---
*本文档为 Hermes Flux 项目跨端架构的唯一权威技术规范，任何偏离本规范的实现变更均须通过架构停机坪讨论程序批准。*
