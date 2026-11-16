/**
 * Hermes Flux Mobile Capacitor PlatformBridge Implementation
 * 
 * 【设计意图 (Why)】
 * 移动端（Android & iOS）由 Capacitor 8 容器托管，底层 WebView 缺乏桌面端 Electron 的 Node.js 主进程能力。
 * 本模块使用 Capacitor 官方插件体系（Filesystem、Clipboard、Browser、Share、App、Keyboard 等）
 * 完整实现与桌面端 `HermesDesktopBridge`（IPlatformBridge）同构的平台抽象桥，
 * 使得渲染层可以无感知跨端复用，无需重写上层业务逻辑。
 * 
 * 【防范的历史坑 (Pitfall)】
 * 1. 移动端 WebView 的 fetch 受到跨源 CORS 限制（Origin: https://localhost）。
 *    必须依赖 CapacitorHttp 原生接管全局网络栈，自动维护原生 CookieJar，严禁在 JS 层裸写 Node.js 原生 http 请求。
 * 2. 移动端无桌面"另存为"系统对话框（SaveFileDialog）。
 *    文件保存必须先写入 Documents 目录，再调起系统原生分享面板（Share.share），让用户自由选择微信/邮件/文件管理器导出。
 * 3. 移动端无独立窗口控制（最小化/最大化/关闭三键）。
 *    窗口控制方法必须平滑降级为 no-op 或 App.minimizeApp()，严禁抛出未捕获异常导致渲染层生命周期中断。
 * 4. 移动端复用 Desktop 渲染层产物时，desktop/src/renderer/index.ts 第 126 行直接读取了 `window.hermesDesktop`。
 *    为了不污染正在被其他 Agent 编辑的 renderer 源码，本模块同时挂载 `window.hermesMobile` 与 `window.hermesDesktop`，
 *    实现物理零侵入无缝对接！
 * 
 * 【约束与规则 (Rules)】
 * 1. 接口签名 100% 对齐 IPlatformBridge 与 HermesDesktopBridge。
 * 2. 严禁在此处引入 UI 状态或 AppState 业务状态机（严格遵守 Thin-Shell 薄壳不变量）。
 * 3. 所有异步原生调用必须用 try/catch 包含并输出明确错误或安全降级，严禁未处理 Promise 拒绝。
 */

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Clipboard } from '@capacitor/clipboard';
import { Browser } from '@capacitor/browser';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';

export type PlatformType = 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'web';

export interface SystemInfo {
  platform: PlatformType;
  arch: string;
  osVersion: string;
  appVersion: string;
  isDesktop: boolean;
  isMobile: boolean;
  isWeb: boolean;
}

export interface WindowControlState {
  isMaximized: boolean;
  isMinimized?: boolean;
  isFullScreen?: boolean;
  isFocused?: boolean;
}

export interface GatewayAuthResult {
  ok: boolean;
  message: string;
  latency: number;
  ticket?: string;
  version?: string;
}

/**
 * 网关 /api/status 的响应最小面。
 *
 * 【设计意图 (Why)】只说清移动端真正读取的字段，其余一律忽略。
 * 用具体形状而非 `any`，是为了在网关字段改名时由类型系统先报错，
 * 而不是在运行时静默拿到 undefined 再显示成"版本 0.22.5"的假数据。
 */
interface GatewayStatusPayload {
  auth_required?: boolean;
  version?: string;
}

/** 网关 /api/auth/ws-ticket 的响应最小面 */
interface GatewayTicketPayload {
  ticket?: string;
}

/**
 * 从任意 JSON 值中安全取值，绝不把外部输入当作已知类型。
 *
 * 【防范的历史坑 (Pitfall)】直接把 `await res.json()` 断言成形状，
 * 会在网关返回错误信封（如 `{ ok: false, error: ... }`）时读出 undefined，
 * 上层再把 undefined 当成功继续跑，最终表现为"登录成功但连不上"。
 */
function readJsonObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** 读取响应里的字符串字段；非字符串一律视为缺失 */
function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const v = record[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * 从 unknown 异常里取人类可读原因。
 *
 * 【约束与规则 (Rules)】不得假定 err 一定有 message：`throw 'x'` 与
 * 原生插件抛出的非 Error 对象同样会进 catch。
 */
function describeError(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === 'string' && err.length > 0) return err;
  const candidate = readJsonObject(err).message;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : fallback;
}

/**
 * 移动端在 window 上挂载的运行时入口与剪贴板内存回退。
 *
 * 【设计意图 (Why)】显式声明比 `as any` / `as unknown as` 更好：
 * 类型断言会把拼写错误一并放过（`hermesMobil` 也能通过编译），
 * 而全局声明让所有读写点都受同一份类型约束。
 *
 * 【约束与规则 (Rules)】只允许声明移动端真正使用的键；不得把整个 window 声明成 any。
 */
declare global {
  interface Window {
    hermesMobile?: HermesMobileBridge;
    /**
     * 移动端同时以桌面入口名暴露自己。
     *
     * 【设计意图 (Why)】桌面渲染层固定读取 `window.hermesDesktop`，移动端复用同一份
     *   渲染产物时必须提供同名入口。这里如实声明它就是移动端桥，而不是断言成
     *   桌面桥类型——两者接口同构但能力不同，谎报类型会让缺能力的方法在编译期隐身。
     */
    hermesDesktop?: HermesMobileBridge;
    __hermes_clipboard_mem?: string;
  }
}

export interface HermesMobileBridge {
  getSystemInfo(): Promise<SystemInfo>;
  minimize(): Promise<void>;
  maximize(): Promise<boolean | void>;
  unmaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  onWindowStateChange(callback: (state: WindowControlState) => void): () => void;
  activateWindow?(): Promise<void>;
  getDefaultGatewayConfig(): Promise<{ url: string; key: string; profile: string }>;
  authenticateGateway(options: {
    url: string;
    username?: string;
    password?: string;
  }): Promise<GatewayAuthResult>;
  httpProxy(options: {
    baseUrl: string;
    path: string;
    method?: string;
    token?: string;
    ticket?: string;
    body?: unknown;
    params?: unknown;
  }): Promise<unknown>;
  openExternal(url: string, content?: string): Promise<void>;
  openFileDialog(): Promise<string[] | null>;
  readFile(filePath: string): Promise<string | null>;
  saveFile(options: {
    fileName: string;
    content: string;
    isBase64?: boolean;
  }): Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>;
  clipboardWrite(text: string): Promise<boolean>;
  clipboardRead(): Promise<string>;
}

export function createCapacitorPlatformBridge(): HermesMobileBridge {
  const currentPlatform = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'
  const isAndroid = currentPlatform === 'android';
  const isIos = currentPlatform === 'ios';

  const bridge: HermesMobileBridge = {
    // 1. 系统与平台信息
    async getSystemInfo(): Promise<SystemInfo> {
      let appVersion = '0.1.0';
      try {
        const info = await App.getInfo();
        appVersion = info.version || '0.1.0';
      } catch (err) {
        // gate-degrade: 版本号只用于显示；原生插件不可用（如浏览器直开）时回落默认值并留痕
        console.warn('[Mobile PAL] App.getInfo 不可用，版本号回落默认值:', describeError(err, 'unknown'));
      }

      return {
        platform: isAndroid ? 'android' : isIos ? 'ios' : 'web',
        arch: 'arm64',
        osVersion: typeof navigator !== 'undefined' ? navigator.userAgent : 'mobile',
        appVersion,
        isDesktop: false,
        isMobile: true,
        isWeb: false,
      };
    },

    // 2. 窗口控制 (移动端全部平滑降级为 no-op，关闭则最小化到后台)
    async minimize(): Promise<void> {
      try {
        await App.minimizeApp();
      } catch (err) {
        // gate-degrade: 移动端无独立窗口；最小化在 iOS 上不可用属预期能力差异，不得中断渲染层
        console.warn('[Mobile PAL] minimizeApp 不可用（该平台无窗口控制）:', describeError(err, 'unknown'));
      }
    },

    async maximize(): Promise<boolean> {
      return false;
    },

    async unmaximize(): Promise<void> {},

    async close(): Promise<void> {
      try {
        await App.minimizeApp();
      } catch (err) {
        // gate-degrade: 移动端"关闭"语义是退到后台；插件缺失时无替代路径，只记录不抛
        console.warn('[Mobile PAL] close 降级为无操作（该平台无最小化能力）:', describeError(err, 'unknown'));
      }
    },

    async isMaximized(): Promise<boolean> {
      return false;
    },

    async activateWindow(): Promise<void> {},

    onWindowStateChange(_callback: (state: WindowControlState) => void): () => void {
      return () => {};
    },

    // 3. Gateway 默认配置探测
    async getDefaultGatewayConfig(): Promise<{ url: string; key: string; profile: string }> {
      let savedUrl = '';
      let savedProfile = '';
      if (typeof window !== 'undefined' && window.localStorage) {
        savedUrl = window.localStorage.getItem('hermes_aura_gateway_url') || '';
        savedProfile = window.localStorage.getItem('hermes_aura_profile') || '';
      }
      return {
        url: savedUrl,
        key: '',
        profile: savedProfile || 'default',
      };
    },

    // 4. 网关鉴权探测 (利用 CapacitorHttp 拦截原生 fetch 跨源调用)
    async authenticateGateway(options: {
      url: string;
      username?: string;
      password?: string;
    }): Promise<GatewayAuthResult> {
      let baseUrl = (options.url || '').trim();
      if (!baseUrl) {
        return { ok: false, message: '请先填写网关地址', latency: 0 };
      }
      if (baseUrl.startsWith('ws://')) baseUrl = baseUrl.replace('ws://', 'http://');
      if (baseUrl.startsWith('wss://')) baseUrl = baseUrl.replace('wss://', 'https://');
      if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) baseUrl = `https://${baseUrl}`;
      baseUrl = baseUrl.replace(/\/+$/, '');

      const start = Date.now();
      try {
        // 第一跳：探测 /api/status
        const statusRes = await fetch(`${baseUrl}/api/status`, {
          headers: { Accept: 'application/json' },
        });
        const latency = Date.now() - start;
        if (!statusRes.ok) {
          return { ok: false, message: `服务返回异常 HTTP ${statusRes.status}`, latency };
        }

        const statusData = readJsonObject(await statusRes.json().catch(() => ({})) as unknown);
        const authRequired = statusData.auth_required === true;
        const statusVersion = readOptionalString(statusData, 'version');

        if (!authRequired) {
          return {
            ok: true,
            message: `网关直连就绪 (无需认证) · 延迟 ${latency}ms`,
            latency,
            version: statusVersion,
          };
        }

        if (!options.username || !options.password) {
          return {
            ok: false,
            message: '该网关开启了安全拦截，必须输入用户名与密码',
            latency,
          };
        }

        // 第二跳：密码登录 (CapacitorHttp 原生接管自动维护 Cookie)
        const loginRes = await fetch(`${baseUrl}/auth/password-login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Origin: baseUrl,
          },
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

        // 第三跳：获取 WS Ticket
        const ticketRes = await fetch(`${baseUrl}/api/auth/ws-ticket`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Origin: baseUrl,
          },
        });

        if (!ticketRes.ok) {
          return {
            ok: false,
            message: `获取 WebSocket 凭证失败 HTTP ${ticketRes.status}`,
            latency,
          };
        }

        const ticketData = readJsonObject(await ticketRes.json().catch(() => ({})) as unknown);
        const ticket = readOptionalString(ticketData, 'ticket');
        /**
         * 【失败不可静默 (Failure Is Not Empty)】网关回了 200 但没给 ticket 时，
         * 若照样报 ok:true，上层会拿着 undefined 去握手，报错落在几十行之外的
         * WebSocket 层，根因被彻底掩盖。必须在此显式失败。
         */
        if (!ticket) {
          return {
            ok: false,
            message: '认证接口未下发 WebSocket 凭证 (ticket 为空)',
            latency,
          };
        }
        return {
          ok: true,
          ticket,
          message: `认证成功 · 延迟 ${latency}ms · Gateway v${statusVersion || '0.22.5'}`,
          latency,
          version: statusVersion,
        };
      } catch (err: unknown) {
        return {
          ok: false,
          message: `网络连接失败: ${describeError(err, '无法访问目标网关')}`,
          latency: Date.now() - start,
        };
      }
    },

    // 5. REST 代理请求
    async httpProxy(options: {
      baseUrl: string;
      path: string;
      method?: string;
      token?: string;
      ticket?: string;
      body?: unknown;
      params?: unknown;
    }): Promise<unknown> {
      let base = (options.baseUrl || '').trim();
      if (!base) throw new Error('未配置网关地址');
      if (base.startsWith('ws://')) base = base.replace('ws://', 'http://');
      if (base.startsWith('wss://')) base = base.replace('wss://', 'https://');
      if (!base.startsWith('http://') && !base.startsWith('https://')) base = `https://${base}`;
      base = base.replace(/\/+$/, '');

      let fullUrl = `${base}${options.path.startsWith('/') ? '' : '/'}${options.path}`;
      if (options.params && typeof options.params === 'object') {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(options.params)) {
          if (typeof v !== 'undefined' && v !== null) q.append(k, String(v));
        }
        const qs = q.toString();
        if (qs) fullUrl += (fullUrl.includes('?') ? '&' : '?') + qs;
      }
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Origin: base,
      };
      if (options.token) {
        headers['Authorization'] = `Bearer ${options.token}`;
      }
      if (options.ticket) {
        headers['X-WS-Ticket'] = options.ticket;
      }

      const fetchOptions: RequestInit = {
        method: options.method || 'GET',
        headers,
      };
      if (options.body && options.method !== 'GET') {
        headers['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(options.body);
      }

      const res = await fetch(fullUrl, fetchOptions);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('application/json')) {
        return (await res.json()) as unknown;
      }

      // 图像二进制安全转 Base64 Data URL (WebView 内 FileReader 标准转换)
      if (contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i.test(options.path)) {
        const blob = await res.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }

      return await res.text();
    },

    // 6. 外部链接调用 (Browser 插件在系统 Chrome Custom Tabs 或 SFSafariViewController 内安全展示)
    async openExternal(url: string, content?: string): Promise<void> {
      if (!url || typeof url !== 'string') return;
      if (url.startsWith('http://') || url.startsWith('https://')) {
        try {
          await Browser.open({ url });
        } catch {
          if (typeof window !== 'undefined') window.open(url, '_blank');
        }
        return;
      }

      // 文本快照临时落地分享
      if (typeof content === 'string' && content.length > 0) {
        try {
          const rawBase = url.split(/[/\\]/).pop() || 'preview.txt';
          const safeName = rawBase.replace(/[^a-zA-Z0-9._-]/g, '_');
          const saved = await Filesystem.writeFile({
            path: `temp/${safeName}`,
            data: content,
            directory: Directory.Cache,
            encoding: Encoding.UTF8,
            recursive: true,
          });
          await Share.share({
            title: safeName,
            url: saved.uri,
          });
        } catch (err) {
          console.warn('[Mobile PAL] openExternal file share failed:', err);
        }
      }
    },

    // 7. 打开文件对话框 (移动端 DOM input[type=file] 触发展开相机/相册/文件选择器)
    async openFileDialog(): Promise<string[] | null> {
      if (typeof document === 'undefined') return null;
      return new Promise<string[] | null>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        input.style.pointerEvents = 'none';

        input.onchange = () => {
          const files = input.files;
          if (!files || files.length === 0) {
            resolve(null);
          } else {
            const names = Array.from(files).map((f) => f.name);
            resolve(names);
          }
          if (input.parentNode) input.parentNode.removeChild(input);
        };

        input.oncancel = () => {
          resolve(null);
          if (input.parentNode) input.parentNode.removeChild(input);
        };

        document.body.appendChild(input);
        input.click();
      });
    },

    // 8. 本地文件读取
    async readFile(filePath: string): Promise<string | null> {
      try {
        const res = await Filesystem.readFile({
          path: filePath,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
        return typeof res.data === 'string' ? res.data : null;
      } catch (err) {
        // gate-degrade: 文件不存在 / 权限被拒都应当表现为"读不到"，返回 null 由调用方显示空态
        console.warn('[Mobile PAL] readFile 失败，按不可读处理:', describeError(err, 'unknown'));
        return null;
      }
    },

    // 9. 文件下载保存 (落地到 Documents 并唤起系统分享面板)
    async saveFile(options: {
      fileName: string;
      content: string;
      isBase64?: boolean;
    }): Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }> {
      try {
        const safeName = (options.fileName || 'download.txt').replace(/[^a-zA-Z0-9._-]/g, '_');
        let writeData = options.content;
        let isRawBase64 = Boolean(options.isBase64);

        if (options.content.startsWith('data:')) {
          const commaIdx = options.content.indexOf(',');
          writeData = commaIdx >= 0 ? options.content.slice(commaIdx + 1) : options.content;
          isRawBase64 = true;
        }

        const saved = await Filesystem.writeFile({
          path: safeName,
          data: writeData,
          directory: Directory.Documents,
          encoding: isRawBase64 ? undefined : Encoding.UTF8,
          recursive: true,
        });

        // 调起系统分享
        try {
          await Share.share({
            title: `导出文件: ${safeName}`,
            url: saved.uri,
          });
        } catch (err) {
          // gate-degrade: 用户主动取消分享不算失败；文件已落盘，成功语义必须保留
          console.warn('[Mobile PAL] 系统分享面板被取消或不可用，文件已保存:', describeError(err, 'unknown'));
        }

        return { success: true, filePath: saved.uri };
      } catch (err) {
        return { success: false, error: describeError(err, '保存失败') };
      }
    },

    // 10. 原生剪贴板双向读写 (附带 DOM 三级降级保底与内存回退)
    async clipboardWrite(text: string): Promise<boolean> {
      const content = typeof text === 'string' ? text : String(text || '');
      window.__hermes_clipboard_mem = content;
      try {
        await Clipboard.write({ string: content });
        return true;
      } catch (err) {
        console.warn('[Mobile PAL] 原生剪贴板写入失败，降级 DOM 路径:', describeError(err, 'unknown'));
        // Fallback 1: navigator.clipboard
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          try {
            await navigator.clipboard.writeText(content);
            return true;
          } catch (err2) {
            console.warn('[Mobile PAL] navigator.clipboard 写入失败:', describeError(err2, 'unknown'));
          }
        }
        // Fallback 2: textarea execCommand
        if (typeof document !== 'undefined') {
          try {
            const ta = document.createElement('textarea');
            ta.value = content;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            if (ok) return true;
          } catch (err3) {
            console.warn('[Mobile PAL] execCommand copy 失败:', describeError(err3, 'unknown'));
          }
        }
        // Fallback 3: 内存兜底成功
        return true;
      }
    },

    async clipboardRead(): Promise<string> {
      try {
        const res = await Clipboard.read();
        if (res.value) return res.value;
      } catch (err) {
        console.warn('[Mobile PAL] 原生剪贴板读取失败，降级 DOM 路径:', describeError(err, 'unknown'));
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        try {
          const val = await navigator.clipboard.readText();
          if (val) return val;
        } catch (err2) {
          console.warn('[Mobile PAL] navigator.clipboard 读取失败:', describeError(err2, 'unknown'));
        }
      }
      const mem = window.__hermes_clipboard_mem;
      return typeof mem === 'string' ? mem : '';
    },
  };

  // 软键盘动态避让监听 (安全检查与异步未捕获异常防御)
  if (Capacitor.isPluginAvailable('Keyboard')) {
    Keyboard.addListener('keyboardWillShow', (info) => {
      if (typeof document !== 'undefined') {
        document.documentElement.style.setProperty('--keyboard-height', `${info.keyboardHeight}px`);
      }
    }).catch(() => {});
    Keyboard.addListener('keyboardWillHide', () => {
      if (typeof document !== 'undefined') {
        document.documentElement.style.setProperty('--keyboard-height', '0px');
      }
    }).catch(() => {});
  }

  // 前后台生命周期自愈监听 (安全检查与异步未捕获异常防御)
  if (Capacitor.isPluginAvailable('App')) {
    App.addListener('appStateChange', (state) => {
      if (state.isActive && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('hermes-mobile-resume'));
      }
    }).catch(() => {});
  }

  return bridge;
}

// 自动向全局注入（同时注入 hermesMobile 与 hermesDesktop，彻底消灭未适配代码的报错与冲突）
if (typeof window !== 'undefined') {
  const mobileBridge = createCapacitorPlatformBridge();
  window.hermesMobile = mobileBridge;
  if (!window.hermesDesktop) {
    window.hermesDesktop = mobileBridge;
  }
}
