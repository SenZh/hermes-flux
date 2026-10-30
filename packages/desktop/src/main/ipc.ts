/**
 * Hermes Flux Desktop IPC Handler Registration
 */

import { ipcMain, BrowserWindow, shell, dialog, app } from 'electron';

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  let activeGatewayCookies = '';

  // Window management IPC
  ipcMain.handle('window:minimize', () => {
    mainWindow.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return mainWindow.isMaximized();
  });

  ipcMain.handle('window:unmaximize', () => {
    mainWindow.unmaximize();
  });

  ipcMain.handle('window:close', () => {
    mainWindow.close();
  });

  ipcMain.handle('window:is-maximized', () => {
    return mainWindow.isMaximized();
  });

  // System & Platform Info
  ipcMain.handle('system:get-info', () => {
    return {
      platform: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
      arch: process.arch,
      osVersion: process.getSystemVersion?.() || 'unknown',
      appVersion: app.getVersion(),
      isDesktop: true,
      isMobile: false,
      isWeb: false,
    };
  });

  ipcMain.handle('gateway:get-default-config', () => {
    return {
      url: process.env.HERMES_GATEWAY_URL || 'http://127.0.0.1:9119',
      key: '',
      profile: process.env.HERMES_PROFILE || 'default',
    };
  });

  ipcMain.handle(
    'gateway:authenticate',
    async (_event, options: { url: string; username?: string; password?: string }) => {
      let baseUrl = (options.url || 'http://127.0.0.1:9119').trim();
      if (baseUrl.startsWith('ws://')) baseUrl = baseUrl.replace('ws://', 'http://');
      if (baseUrl.startsWith('wss://')) baseUrl = baseUrl.replace('wss://', 'https://');
      if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) baseUrl = `https://${baseUrl}`;
      baseUrl = baseUrl.replace(/\/+$/, '');

      const start = Date.now();
      try {
        // Dashboard flow: GET /api/status
        const statusRes = await fetch(`${baseUrl}/api/status`, {
          headers: { Accept: 'application/json' },
        });
        const latency = Date.now() - start;
        if (!statusRes.ok) {
          return { ok: false, message: `服务返回异常 HTTP ${statusRes.status}`, latency };
        }

        const statusData: any = await statusRes.json().catch(() => ({}));
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
          return {
            ok: false,
            message: '该网关开启了安全拦截，必须输入用户名与密码',
            latency,
          };
        }

        // Password login in Node environment
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

        // Extract cookie header
        let cookies = '';
        if (typeof (loginRes.headers as any).getSetCookie === 'function') {
          cookies = (loginRes.headers as any).getSetCookie().join('; ');
        } else {
          cookies = loginRes.headers.get('set-cookie') || '';
        }
        activeGatewayCookies = cookies;

        // Mint WS Ticket
        const ticketRes = await fetch(`${baseUrl}/api/auth/ws-ticket`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Cookie: cookies,
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

        const ticketData: any = await ticketRes.json().catch(() => ({}));
        return {
          ok: true,
          ticket: ticketData.ticket,
          message: `认证成功 · 延迟 ${latency}ms · Gateway v${statusData.version || '0.22.5'}`,
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
    }
  );

  // HTTP REST Proxy (bypasses browser CORS / cookie constraints in desktop)
  // 【设计意图 (Why)】
  // Electron 渲染层运行在 file:// 协议沙箱中，直接 fetch 跨域调用网关会被浏览器剥离 Cookie。
  // 主进程作为受信任的 Node.js 宿主，不受浏览器 Cookie 策略约束。
  // 【防范的陷阱 (Pitfall)】
  // 必须把登录提取的 activeGatewayCookies 持久化并自动注入请求头，否则网关会返回 401 Unauthorized (reason: no_cookie)。
  ipcMain.handle('gateway:http-proxy', async (_event, options: {
    baseUrl: string;
    path: string;
    method?: string;
    token?: string;
    ticket?: string;
    body?: any;
    params?: any;
  }) => {
    let base = (options.baseUrl || 'http://127.0.0.1:9119').trim();
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
    if (activeGatewayCookies) {
      headers['Cookie'] = activeGatewayCookies;
    }
    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }
    if (options.ticket) {
      headers['X-WS-Ticket'] = options.ticket;
    }

    const fetchOptions: any = {
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
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await res.json();
    }
    return await res.text();
  });

  // Shell & Dialogs
  ipcMain.handle('shell:open-external', async (_event, url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      await shell.openExternal(url);
    }
  });

  ipcMain.handle('dialog:open-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
    });
    return result.filePaths;
  });
}
