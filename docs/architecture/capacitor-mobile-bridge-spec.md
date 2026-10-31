# Capacitor 移动端 PlatformBridge 适配层设计规范

> **文档定位**：本文档是 Hermes Flux 移动端（Android + iOS）Capacitor 8 壳工程的完整工程设计规范。  
> **前置依赖**：[core-architecture-and-data-flow-spec.md](./core-architecture-and-data-flow-spec.md)、[desktop-windows-delivery-and-cross-platform-guide.md](./desktop-windows-delivery-and-cross-platform-guide.md)  
> **状态**：设计完成，待实施  
> **最后更新**：2026-10-31

---

## 一、背景与目标

### 1.1 当前现状（实测事实，非推断）

桌面端（Windows/macOS/Linux）已通过 Electron 完整实现了 `IPlatformBridge` 接口：

| 实现位置 | 职责 |
|---|---|
| `packages/desktop/src/preload/index.ts` | 通过 `contextBridge.exposeInMainWorld('hermesDesktop', bridge)` 向渲染进程注入 PAL 桥 |
| `packages/desktop/src/main/ipc.ts` | 15 个 `ipcMain.handle` 注册，覆盖窗口控制、系统信息、剪贴板、Gateway 认证/代理、文件读写/保存、Shell 打开 |

移动端 Capacitor 壳当前状态：

| 项目 | 状态 | 证据 |
|---|---|---|
| 壳工程目录 | 存在但 **untracked**（未入库） | `git status ?? packages/mobile/` |
| 原生代码 | 仅 `MainActivity.java` 空类（`extends BridgeActivity {}`） | 5 行，零业务逻辑 |
| Web 资产 | 整体复制 `desktop/dist/renderer`（SHA256 完全相同） | `prepare-assets.mjs` 第 26 行 `fs.cpSync` |
| Capacitor 插件 | `capacitor.config.json` 声明 `CapacitorHttp.enabled: true`，但 **未安装任何插件 JS 包** | `package.json` 仅有 `@capacitor/android`、`@capacitor/core`、`@capacitor/cli` |
| 插件注册 | `android/app/src/main/assets/capacitor.plugins.json` 内容为 `[]`（空数组） | 原生侧零插件注册 |
| iOS 工程 | **不存在** | `packages/mobile/ios/` 目录 Test-Path = False |
| PAL 桥实现 | **不存在** | 无 `src/` 目录，无任何 TS/JS 业务代码 |

### 1.2 设计目标

1. **实现 Capacitor 版 PlatformBridge**：对齐 Electron 的 `HermesDesktopBridge` 全部 16 个方法，使 renderer 中 `desktopApi?.xxx` 的 16 处调用点在移动端均有等效实现
2. **统一注入机制**：在 `window` 上注入与 `hermesDesktop` 同构的 `hermesMobile` 桥对象，renderer 通过统一适配层选择正确的桥
3. **补齐插件依赖**：安装必需的 Capacitor 官方插件（HTTP 代理、文件系统、剪贴板、分享等）
4. **scaffold iOS 工程**：通过 `cap add ios` 生成 iOS 原生工程骨架
5. **保持薄壳不变量**：`packages/mobile` 严格作为轻量容器，零应用级状态逻辑

---

## 二、架构总览

### 2.1 双端桥注入模型

```
┌──────────────────────────────────────────────────────────────────────┐
│                         renderer/index.ts                           │
│                                                                      │
│   const bridge = window.hermesDesktop    ← Electron 环境             │
│                  ?? window.hermesMobile   ← Capacitor 环境           │
│                  ?? null;                 ← 纯 Web 降级（未来）       │
│                                                                      │
│   bridge?.clipboardWrite(text)   // 统一调用，不关心底层是哪个平台    │
└──────────────────────────────────────────────────────────────────────┘
         │                                    │
         ▼                                    ▼
┌─────────────────────┐          ┌──────────────────────────┐
│  Electron Preload   │          │  Capacitor Bridge Script │
│  (contextBridge →   │          │  (capacitor-bridge.ts →  │
│   ipcRenderer →     │          │   Capacitor Plugins →    │
│   ipcMain)          │          │   Native Layer)          │
└─────────────────────┘          └──────────────────────────┘
         │                                    │
         ▼                                    ▼
┌─────────────────────┐          ┌──────────────────────────┐
│  Node.js 主进程     │          │  Android (Java/Kotlin)   │
│  (fs, net, shell,   │          │  iOS (Swift/ObjC)        │
│   clipboard, dialog)│          │  原生能力由 Capacitor    │
└─────────────────────┘          │  插件自动桥接            │
                                 └──────────────────────────┘
```

### 2.2 关键设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 桥注入方式 | 在 `prepare-assets` 阶段将编译后的 `capacitor-bridge.js` 注入到 `dist/index.html` 的 `<head>` 中 | 确保在 renderer 的 `init()` 执行前 `window.hermesMobile` 已可用；无需修改 esbuild 桌面构建流程 |
| 接口签名 | 100% 对齐 `HermesDesktopBridge`（`preload/index.ts:11-32`） | renderer 的 16 处调用点使用可选链 `desktopApi?.xxx`，统一桥只需将变量指向替换为 `bridge?.xxx` |
| CORS 解决方案 | `@capacitor/core` 内置 CapacitorHttp 自动拦截 `window.fetch` | `capacitor.config.json` 已声明 `CapacitorHttp.enabled: true`，只需安装依赖使其物理生效 |
| 文件系统 | `@capacitor/filesystem` | 覆盖读文件（`readFile`）与保存文件（`saveFile`）；移动端无"另存为"对话框，改为写入 Downloads 目录 |
| 剪贴板 | `@capacitor/clipboard` | 覆盖 `clipboardWrite` 与 `clipboardRead` |
| 外部链接 | `@capacitor/browser` | 覆盖 `openExternal`（在应用内 Chrome Custom Tab / SFSafariViewController 中打开 URL） |
| 分享/保存文件 | `@capacitor/share` | 移动端无原生"另存为"对话框，文件保存后调起系统分享面板让用户选择去向 |
| 触觉反馈 | `@capacitor/haptics` | 移动端交互增强（按钮轻击、破坏性操作警告），桌面端无此能力 |
| 状态栏沉浸 | `@capacitor/status-bar` | 控制系统状态栏样式（暗色/亮色/沉浸式） |
| 窗口控制 | **不适用** | 移动端无窗口最小化/最大化/关闭概念；`minimize`/`maximize`/`unmaximize`/`close` 实现为空操作（no-op） |
| 文件选择对话框 | `@capawesome/capacitor-file-picker` 或原生 `input[type=file]` | `openFileDialog` 的移动端等效；优先使用原生 HTML `<input>` 降级方案 |

---

## 三、Capacitor 插件依赖清单

### 3.1 需安装的插件

在 `packages/mobile/` 目录下执行安装：

```bash
npm install @capacitor/filesystem @capacitor/clipboard @capacitor/browser @capacitor/share @capacitor/haptics @capacitor/status-bar @capacitor/keyboard @capacitor/app
```

| 插件包 | 版本 | 用途 | 对应 Electron IPC |
|---|---|---|---|
| `@capacitor/filesystem` | ^6.0.0 | 文件读取、写入 Downloads | `fs:read-file`、`fs:save-file` |
| `@capacitor/clipboard` | ^6.0.0 | 剪贴板读写 | `clipboard:write-text`、`clipboard:read-text` |
| `@capacitor/browser` | ^6.0.0 | 打开外部链接 | `shell:open-external` |
| `@capacitor/share` | ^6.0.0 | 系统分享面板（保存文件替代方案） | `fs:save-file`（辅助） |
| `@capacitor/haptics` | ^6.0.0 | 触觉反馈 | 桌面端无对应（移动端增强） |
| `@capacitor/status-bar` | ^6.0.0 | 系统状态栏控制 | 桌面端无对应（移动端适配） |
| `@capacitor/keyboard` | ^6.0.0 | 软键盘事件监听与视口避让 | 桌面端无对应（移动端适配） |
| `@capacitor/app` | ^6.0.0 | 应用生命周期（前后台切换） | 桌面端无对应（移动端自愈重连） |

### 3.2 已有但需确认生效的插件

| 项目 | 当前状态 | 需要操作 |
|---|---|---|
| `CapacitorHttp`（内置于 `@capacitor/core`） | `capacitor.config.json` 已启用，但 `capacitor.plugins.json` 为空数组 | 执行 `npx cap sync android` 重新生成插件注册清单 |

### 3.3 安装后执行同步

```bash
npx cap sync android
npx cap sync ios      # iOS scaffold 生成后
```

此命令会：
1. 将 `dist/` Web 资产复制到原生工程 `app/src/main/assets/public/`
2. 自动扫描已安装的 Capacitor 插件，更新 `capacitor.plugins.json` 注册清单
3. 在原生工程中生成插件的桥接代码

---

## 四、CapacitorBridge 实现规范

### 4.1 文件位置与构建

```
packages/mobile/
├── src/
│   └── capacitor-bridge.ts    ← 新增：Capacitor 版 PlatformBridge 实现
├── scripts/
│   ├── prepare-assets.mjs     ← 修改：构建 capacitor-bridge.ts 并注入到 dist/index.html
│   └── build-android.mjs      ← 现有
├── capacitor.config.json
└── package.json
```

### 4.2 `capacitor-bridge.ts` 完整接口实现

以下为完整的接口映射表。每个方法对齐 `HermesDesktopBridge`（`preload/index.ts:11-32`）+ `IPlatformBridge`（`core/src/pal/IPlatformBridge.ts:44-83`）的签名：

```typescript
/**
 * Capacitor Mobile PlatformBridge Implementation
 * 
 * 设计意图 (Why)：
 *   在 Capacitor WebView 环境中注入与 Electron preload 同构的 PlatformBridge，
 *   使 renderer 中所有 `desktopApi?.xxx` 调用点在移动端有等效实现。
 *
 * 约束与规则 (Rules)：
 *   1. 接口签名 100% 对齐 HermesDesktopBridge，不多不少
 *   2. 窗口控制方法（minimize/maximize/unmaximize/close）实现为 no-op
 *   3. 文件保存走 Downloads + 系统分享面板，而非桌面端的"另存为"对话框
 *   4. CORS 问题由 CapacitorHttp 自动拦截 fetch 解决，httpProxy 改为直接 fetch
 */

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Clipboard } from '@capacitor/clipboard';
import { Browser } from '@capacitor/browser';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';

import type { IPlatformBridge, SystemInfo, GatewayAuthResult, WindowControlState } from '@hermes-flux/core';

interface HermesMobileBridge extends IPlatformBridge {
  getDefaultGatewayConfig: () => Promise<{ url: string; key: string; profile: string }>;
  authenticateGateway: (options: {
    url: string;
    username?: string;
    password?: string;
  }) => Promise<GatewayAuthResult>;
  httpProxy: (options: {
    baseUrl: string;
    path: string;
    method?: string;
    token?: string;
    ticket?: string;
    body?: any;
    params?: any;
  }) => Promise<any>;
  openFileDialog: () => Promise<string[] | null>;
  readFile: (path: string) => Promise<string | null>;
  saveFile: (options: {
    fileName: string;
    content: string;
    isBase64?: boolean;
  }) => Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>;
  clipboardWrite: (text: string) => Promise<boolean>;
  clipboardRead: () => Promise<string>;
}
```

### 4.3 逐方法实现规范

#### 4.3.1 系统信息 — `getSystemInfo()`

| 维度 | Electron 实现 | Capacitor 实现 |
|---|---|---|
| 数据来源 | `process.platform`、`process.arch`、`app.getVersion()` | `Capacitor.getPlatform()`、`navigator.userAgent`、`App.getInfo()` |

```typescript
getSystemInfo: async (): Promise<SystemInfo> => {
  const platform = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'
  let appVersion = '0.1.0';
  try {
    const info = await App.getInfo();
    appVersion = info.version;
  } catch {}

  return {
    platform: platform === 'android' ? 'android' : platform === 'ios' ? 'ios' : 'web',
    arch: 'arm64',
    osVersion: navigator.userAgent,
    appVersion,
    isDesktop: false,
    isMobile: true,
    isWeb: false,
  };
},
```

#### 4.3.2 窗口控制 — `minimize/maximize/unmaximize/close/isMaximized/onWindowStateChange`

移动端无窗口概念，全部实现为 no-op：

```typescript
minimize: async () => {},
maximize: async () => false,
unmaximize: async () => {},
close: async () => {
  // 移动端"关闭"行为：退到后台
  await App.minimizeApp();
},
isMaximized: async () => false,
onWindowStateChange: (_callback) => {
  // 移动端无窗口状态变化，返回空解绑函数
  return () => {};
},
```

**设计意图**：renderer 初始化流程中调用 `desktopApi.isMaximized()` 和 `desktopApi.onWindowStateChange()` 用于同步窗口控制按钮状态。移动端不渲染窗口三键（由 CSS `@media (max-width: 768px)` 隐藏），所以这些方法返回默认值即可，不影响 UI 逻辑。

#### 4.3.3 Gateway 配置 — `getDefaultGatewayConfig()`

```typescript
getDefaultGatewayConfig: async () => {
  // 移动端从 localStorage 读取用户配置（与桌面端行为一致）
  // 无环境变量注入能力，默认指向局域网常用地址
  return {
    url: 'http://192.168.1.100:9119',
    key: '',
    profile: 'default',
  };
},
```

**防范的陷阱 (Pitfall)**：移动端不能像 Electron 那样读 `process.env`，默认 Gateway URL 不能写 `127.0.0.1`（手机的 localhost 不是桌面机器）。实际地址由用户在 Onboarding 界面手动输入，此处仅提供合理的初始占位。

#### 4.3.4 Gateway 认证 — `authenticateGateway(options)`

```typescript
authenticateGateway: async (options) => {
  let baseUrl = (options.url || '').trim();
  if (baseUrl.startsWith('ws://')) baseUrl = baseUrl.replace('ws://', 'http://');
  if (baseUrl.startsWith('wss://')) baseUrl = baseUrl.replace('wss://', 'https://');
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) baseUrl = `https://${baseUrl}`;
  baseUrl = baseUrl.replace(/\/+$/, '');

  const start = Date.now();
  try {
    // CapacitorHttp 自动拦截 fetch，CORS 不再是问题
    const statusRes = await fetch(`${baseUrl}/api/status`, {
      headers: { Accept: 'application/json' },
    });
    const latency = Date.now() - start;
    if (!statusRes.ok) {
      return { ok: false, message: `服务返回异常 HTTP ${statusRes.status}`, latency };
    }

    const statusData = await statusRes.json().catch(() => ({}));
    const authRequired = Boolean(statusData.auth_required);

    if (!authRequired) {
      return {
        ok: true,
        message: `网关直连就绪 (无需认证) · 延迟 ${latency}ms`,
        latency,
        version: statusData.version,
      };
    }

    if (!options.username || !options.password) {
      return { ok: false, message: '该网关开启了安全拦截，必须输入用户名与密码', latency };
    }

    // 密码登录
    const loginRes = await fetch(`${baseUrl}/auth/password-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        username: options.username,
        password: options.password,
        provider: 'basic',
      }),
    });

    if (loginRes.status === 401) {
      return { ok: false, message: '认证失败: 用户名或密码错误 (HTTP 401)', latency };
    }
    if (!loginRes.ok) {
      return { ok: false, message: `登录接口异常 HTTP ${loginRes.status}`, latency };
    }

    // 移动端 Cookie 由 CapacitorHttp 原生层自动管理（类似浏览器 Cookie Jar）
    // 无需手动提取 set-cookie 头

    // WS Ticket
    const ticketRes = await fetch(`${baseUrl}/api/auth/ws-ticket`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });

    if (!ticketRes.ok) {
      return { ok: false, message: `获取 WebSocket 凭证失败 HTTP ${ticketRes.status}`, latency };
    }

    const ticketData = await ticketRes.json().catch(() => ({}));
    return {
      ok: true,
      ticket: ticketData.ticket,
      message: `认证成功 · 延迟 ${latency}ms · Gateway v${statusData.version || 'unknown'}`,
      latency,
      version: statusData.version,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: `网络连接失败: ${err.message || '无法访问目标网关'}`,
      latency: Date.now() - start,
    };
  }
},
```

**设计意图 (Why)**：Electron 版的 `authenticateGateway` 在 Node.js 主进程中发起 HTTP 请求，绕过浏览器 CORS 限制，手动提取 `set-cookie` 头并保存到 `activeGatewayCookies` 变量中。移动端因为 `CapacitorHttp.enabled: true`，`fetch` 被原生层拦截，CORS 不再是问题，Cookie 也由原生 Cookie Jar 自动管理，因此不需要手动处理 Cookie。

#### 4.3.5 HTTP REST 代理 — `httpProxy(options)`

```typescript
httpProxy: async (options) => {
  let base = (options.baseUrl || '').trim();
  if (base.startsWith('ws://')) base = base.replace('ws://', 'http://');
  if (base.startsWith('wss://')) base = base.replace('wss://', 'https://');
  if (!base.startsWith('http://') && !base.startsWith('https://')) base = `https://${base}`;
  base = base.replace(/\/+$/, '');

  let fullUrl = `${base}${options.path.startsWith('/') ? '' : '/'}${options.path}`;
  if (options.params && typeof options.params === 'object') {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(options.params)) {
      if (v !== undefined && v !== null) q.append(k, String(v));
    }
    const qs = q.toString();
    if (qs) fullUrl += (fullUrl.includes('?') ? '&' : '?') + qs;
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  if (options.ticket) headers['X-WS-Ticket'] = options.ticket;

  const fetchOptions: RequestInit = { method: options.method || 'GET', headers };
  if (options.body && options.method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(options.body);
  }

  // CapacitorHttp 自动接管 fetch，Cookie 由原生 Cookie Jar 管理
  const res = await fetch(fullUrl, fetchOptions);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) return await res.json();

  // 图像转 Base64 Data URL
  if (contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i.test(options.path)) {
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }

  return await res.text();
},
```

**防范的陷阱 (Pitfall)**：Electron 版用 Node.js `Buffer.from(arrayBuffer).toString('base64')` 做图像转 Base64。WebView 环境无 `Buffer`，改用 `FileReader.readAsDataURL`。

#### 4.3.6 外部链接 — `openExternal(url, content?)`

```typescript
openExternal: async (url: string, _content?: string) => {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    await Browser.open({ url });
    return;
  }
  // 移动端不支持打开本地文件路径（沙箱限制）
  // 如果有 content，保存到临时文件后通过分享面板打开
  if (_content) {
    try {
      const fileName = url.split('/').pop() || 'file.txt';
      const result = await Filesystem.writeFile({
        path: `hermes-temp/${fileName}`,
        data: _content,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
        recursive: true,
      });
      await Share.share({
        title: fileName,
        url: result.uri,
      });
    } catch (err) {
      console.warn('[Mobile PAL] openExternal fallback failed:', err);
    }
  }
},
```

#### 4.3.7 文件选择 — `openFileDialog()`

```typescript
openFileDialog: async () => {
  // 移动端使用 HTML 原生 <input type="file"> 实现文件选择
  return new Promise<string[] | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';
    input.onchange = async () => {
      if (!input.files || input.files.length === 0) {
        resolve(null);
        return;
      }
      const paths: string[] = [];
      for (const file of Array.from(input.files)) {
        paths.push(file.name);
      }
      resolve(paths);
      document.body.removeChild(input);
    };
    input.oncancel = () => {
      resolve(null);
      document.body.removeChild(input);
    };
    document.body.appendChild(input);
    input.click();
  });
},
```

#### 4.3.8 文件读取 — `readFile(path)`

```typescript
readFile: async (filePath: string) => {
  try {
    // 移动端文件读取场景有限：主要用于 InspectionPod 查看 Agent 工具产出的文件内容
    // 这些文件来自 Gateway 工作区（远程），非本地设备文件
    // 实际通过 httpProxy 从 Gateway REST API 获取，此方法作为兜底
    const result = await Filesystem.readFile({
      path: filePath,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    return typeof result.data === 'string' ? result.data : null;
  } catch {
    return null;
  }
},
```

#### 4.3.9 文件保存 — `saveFile(options)`

```typescript
saveFile: async (options) => {
  try {
    const fileName = options.fileName || 'download';
    let data: string;
    let encoding: Encoding | undefined = Encoding.UTF8;

    if (options.content.startsWith('data:')) {
      // Base64 Data URL
      const commaIdx = options.content.indexOf(',');
      data = commaIdx >= 0 ? options.content.slice(commaIdx + 1) : options.content;
      encoding = undefined; // 写入原始 Base64
    } else if (options.isBase64) {
      data = options.content;
      encoding = undefined;
    } else {
      data = options.content;
    }

    // 写入 Downloads 目录
    const result = await Filesystem.writeFile({
      path: fileName,
      data,
      directory: Directory.Documents,
      encoding,
      recursive: true,
    });

    // 调起系统分享面板，让用户决定文件去向
    try {
      await Share.share({
        title: `保存文件: ${fileName}`,
        url: result.uri,
      });
    } catch {
      // 用户取消分享不算失败
    }

    return { success: true, filePath: result.uri };
  } catch (err: any) {
    return { success: false, error: err.message || '保存失败' };
  }
},
```

**设计意图 (Why)**：桌面端通过 `dialog.showSaveDialog` 弹出原生"另存为"对话框让用户选择路径。移动端无此概念，改为写入 Documents 目录后调起系统分享面板（可分享到微信/邮件/文件管理器等），是移动端的标准文件导出模式。

#### 4.3.10 剪贴板 — `clipboardWrite/clipboardRead`

```typescript
clipboardWrite: async (text: string) => {
  try {
    await Clipboard.write({ string: text });
    return true;
  } catch {
    // Fallback 到浏览器 API
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
},

clipboardRead: async () => {
  try {
    const result = await Clipboard.read();
    return result.value || '';
  } catch {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  }
},
```

---

## 五、renderer 适配层改造

### 5.1 统一桥变量

renderer `index.ts` 当前代码（第 126 行）：

```typescript
const desktopApi: HermesDesktopBridge | undefined = window.hermesDesktop;
```

改造为：

```typescript
// 统一平台桥：优先 Electron preload，其次 Capacitor 注入，否则为 null（纯 Web 降级）
const desktopApi: HermesDesktopBridge | undefined =
  window.hermesDesktop ?? window.hermesMobile ?? undefined;
```

**改动范围**：仅此一行。renderer 中全部 16 处 `desktopApi?.xxx` 调用无需修改，因为 `hermesMobile` 的接口签名与 `hermesDesktop` 完全相同。

### 5.2 Window 类型声明扩展

renderer `index.ts` 第 50-53 行当前的 Window 类型扩展：

```typescript
declare global {
  interface Window {
    hermesDesktop?: HermesDesktopBridge;
  }
}
```

扩展为：

```typescript
declare global {
  interface Window {
    hermesDesktop?: HermesDesktopBridge;
    hermesMobile?: HermesDesktopBridge;  // Capacitor 注入，签名完全相同
  }
}
```

### 5.3 平台检测逻辑保持不变

`detectInitialPlatform()`（第 201-214 行）已经正确处理了 `hermesDesktop` 不存在时的移动端 UA 检测分支：
- Android WebView → `return 'android'`
- iOS WebView → `return 'ios'`
- `desktopApi` 不存在 + 小屏 → 推导为移动端

此逻辑无需修改。当 `hermesMobile` 注入后，`desktopApi` 变量（现为统一桥）将非 null，`getSystemInfo()` 返回 `isMobile: true`，后续 `init()` 中第 3673 行的 `state.platform = sys.platform` 会正确覆盖为 `'android'` 或 `'ios'`。

---

## 六、`prepare-assets.mjs` 改造

当前脚本仅执行 `fs.cpSync(rendererDist, mobileDist)`。改造后需增加两步：

1. **编译 `capacitor-bridge.ts`**：用 esbuild 将 `src/capacitor-bridge.ts` 编译为单文件 `capacitor-bridge.js`（bundle 模式，内联所有 Capacitor 插件导入）
2. **注入到 `dist/index.html`**：在 `<head>` 标签内、现有 `<script>` 之前插入 `<script src="capacitor-bridge.js"></script>`

```javascript
// prepare-assets.mjs 增量改造（伪代码）

import { build } from 'esbuild';

// 步骤 2.5：编译 Capacitor Bridge
await build({
  entryPoints: [path.join(mobileRoot, 'src/capacitor-bridge.ts')],
  bundle: true,
  format: 'iife',
  outfile: path.join(mobileDist, 'capacitor-bridge.js'),
  platform: 'browser',
  target: 'es2022',
  external: [],  // 全部内联
});

// 步骤 3：注入到 index.html
let html = fs.readFileSync(path.join(mobileDist, 'index.html'), 'utf-8');
html = html.replace(
  '<head>',
  '<head>\n    <script src="capacitor-bridge.js"></script>'
);
fs.writeFileSync(path.join(mobileDist, 'index.html'), html);
```

---

## 七、iOS 工程 Scaffold

### 7.1 生成 iOS 原生工程

```bash
cd packages/mobile
npm install @capacitor/ios
npx cap add ios
npx cap sync ios
```

此命令将生成 `packages/mobile/ios/` 目录，包含完整的 Xcode 工程：
- `App/App/` — AppDelegate、ViewController（`CAPBridgeViewController` 子类）
- `App/App/public/` — Web 资产副本
- `App/Podfile` — CocoaPods 依赖（Capacitor 在 iOS 用 CocoaPods）

### 7.2 iOS 特有配置

在 `capacitor.config.json` 中追加 iOS 配置：

```json
{
  "ios": {
    "contentInset": "always",
    "allowsLinkPreview": false,
    "scrollEnabled": false
  }
}
```

### 7.3 安全区适配

renderer 的 CSS 已经需要处理安全区，在 `styles.css` 的移动端媒体查询中追加：

```css
@media (max-width: 768px) {
  .flux-titlebar {
    padding-top: env(safe-area-inset-top);
  }
  .input-dock-container {
    padding-bottom: env(safe-area-inset-bottom);
  }
}
```

---

## 八、移动端生命周期与网络自愈

### 8.1 前后台切换重连

Capacitor 的 `@capacitor/app` 提供 `appStateChange` 事件。在 `capacitor-bridge.ts` 中注册：

```typescript
import { App } from '@capacitor/app';

// 前后台切换时通知 renderer 触发重连
App.addListener('appStateChange', (state) => {
  if (state.isActive) {
    // 切回前台：派发自定义事件，renderer 的 connect() 监听此事件
    window.dispatchEvent(new CustomEvent('hermes-app-resume'));
  }
});
```

renderer 中增加监听（在 `init()` 函数末尾）：

```typescript
window.addEventListener('hermes-app-resume', () => {
  // 切回前台立即重连，不等退避定时器
  if (!gatewayClient.isConnected()) {
    connect();
  }
});
```

### 8.2 软键盘避让

```typescript
import { Keyboard } from '@capacitor/keyboard';

Keyboard.addListener('keyboardWillShow', (info) => {
  document.documentElement.style.setProperty('--keyboard-height', `${info.keyboardHeight}px`);
});

Keyboard.addListener('keyboardWillHide', () => {
  document.documentElement.style.setProperty('--keyboard-height', '0px');
});
```

CSS 中使用：

```css
@media (max-width: 768px) {
  .input-dock-container {
    bottom: calc(var(--keyboard-height, 0px) + env(safe-area-inset-bottom));
    transition: bottom 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }
}
```

---

## 九、移动端 UI 差异化处理

### 9.1 需要隐藏的桌面端控件

在移动端视口（`state.platform === 'android' || state.platform === 'ios'`）下：

| 控件 | 处理方式 | 原因 |
|---|---|---|
| 窗口三键（最小化/最大化/关闭） | CSS `display: none` | 移动端无窗口概念 |
| macOS 红绿灯 | CSS `display: none` | 同上 |
| 左侧会话轨（260px） | 默认收起为全屏抽屉（Sheet） | 避免挤占主内容区 |
| 右侧检查舱（410px） | 默认收起为底部 Sheet | 同上 |
| 文件附加按钮 | 保留但改用 HTML `<input type="file">` | 无 `dialog.showOpenDialog` |

### 9.2 需要增加的移动端控件

| 控件 | 位置 | 功能 |
|---|---|---|
| 汉堡菜单按钮 | 标题栏左侧 | 展开左侧会话轨（全屏 Sheet） |
| 下拉刷新指示器 | 对话流顶部 | 触发加载更早历史消息 |

### 9.3 触控热区规范

所有可点击控件在移动端必须满足 **48×48dp** 最小热区：

```css
@media (max-width: 768px) {
  .flux-titlebar button,
  .flux-left-rail button,
  .input-dock-container button,
  .status-bar button {
    min-width: 48px;
    min-height: 48px;
  }
}
```

---

## 十、构建与验证流程

### 10.1 Android 构建

```bash
# 1. 先构建桌面端 renderer（Web 资产源）
npm run build

# 2. 准备移动端资产（复制 + 编译 bridge + 注入）
cd packages/mobile
npm run sync:assets

# 3. 同步 Capacitor（更新原生插件注册）
npx cap sync android

# 4. 构建 APK
npm run build:android
```

### 10.2 iOS 构建

```bash
# 1-3 同上
npx cap sync ios

# 4. 打开 Xcode 工程
npx cap open ios

# 5. 在 Xcode 中选择目标设备，Build & Run
```

### 10.3 验证清单

| 验证项 | 预期结果 | 验证方法 |
|---|---|---|
| 应用启动 | 无白屏，直接显示 Onboarding 或对话界面 | 安装 APK 后启动 |
| Gateway 连接 | 输入局域网 IP 后可连接成功 | Onboarding 界面测试连接 |
| WebSocket 通信 | 可发送消息并接收流式回复 | 发送一条消息观察流式输出 |
| REST 请求 | 无 CORS 报错，`/api/sessions` 等接口正常 | DevTools Network 面板 |
| 剪贴板复制 | 长按消息→复制→粘贴到其他 App | 系统剪贴板验证 |
| 文件保存 | 工具产出文件可保存并通过分享面板导出 | InspectionPod 下载功能 |
| 外部链接 | 点击 URL 在系统浏览器打开 | 消息中的超链接 |
| 前后台切换 | 切回前台后自动重连 | 切到其他 App 再切回 |
| 软键盘避让 | 输入框不被软键盘遮挡 | 点击输入框输入文字 |
| 窗口三键 | 移动端不显示 | 视觉检查 |
| 安全区 | 内容不被刘海/灵动岛遮挡 | iPhone 14 Pro / Pixel 8 验证 |

---

## 十一、文件变更清单

| 操作 | 文件 | 说明 |
|---|---|---|
| **新增** | `packages/mobile/src/capacitor-bridge.ts` | Capacitor 版 PlatformBridge 完整实现 |
| **修改** | `packages/mobile/package.json` | 添加 8 个 Capacitor 插件依赖 + esbuild devDep |
| **修改** | `packages/mobile/scripts/prepare-assets.mjs` | 增加 bridge 编译 + index.html 注入步骤 |
| **修改** | `packages/mobile/capacitor.config.json` | 追加 iOS 配置节 |
| **修改** | `packages/desktop/src/renderer/index.ts` | 第 52 行增加 `hermesMobile` 类型声明；第 126 行统一桥变量 |
| **修改** | `packages/desktop/src/renderer/styles.css` | 移动端媒体查询增加安全区/键盘避让/热区/窗口三键隐藏 |
| **新增** | `packages/mobile/ios/` | 通过 `cap add ios` 生成（整个目录） |

---

## 十二、风险与降级策略

| 风险 | 影响 | 降级方案 |
|---|---|---|
| CapacitorHttp 未正确拦截 fetch | REST 请求 CORS 被浏览器拦截 | `authenticateGateway` 和 `httpProxy` 中的 `fetch` 已能正常工作（WebSocket 不受 CORS 限制），REST 失败时走 WebSocket RPC 双通道兜底 |
| iOS `Filesystem.writeFile` 权限不足 | 文件保存失败 | 降级到 `Blob + URL.createObjectURL + <a download>` 浏览器原生下载 |
| 移动端 `navigator.clipboard` 被系统限制 | 剪贴板写入失败 | 已实现三级降级：Capacitor 原生 → `navigator.clipboard` → `execCommand('copy')` |
| 老旧 Android WebView 不支持某些 ES2022 特性 | JS 执行报错 | Capacitor 8 要求 Android API 24+（Chrome 70+），ES2022 支持完整 |
| 局域网 Gateway 不可达 | 无法连接 | Onboarding 界面提供手动输入 URL + 测试连接功能，已有完整错误提示链路 |
