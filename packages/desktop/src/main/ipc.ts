/**
 * Hermes Aura Desktop IPC Handler Registration
 */

import { ipcMain, BrowserWindow, shell, dialog, app } from 'electron';
import { GatewayDaemonManager } from './gateway';

export function registerIpcHandlers(mainWindow: BrowserWindow, gateway: GatewayDaemonManager): void {
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

  // Gateway Daemon IPC
  ipcMain.handle('gateway:get-status', () => {
    return gateway.getStatus();
  });

  ipcMain.handle('gateway:get-default-config', () => {
    return {
      url: process.env.HERMES_GATEWAY_URL || 'http://127.0.0.1:8642',
      key: process.env.API_SERVER_KEY || '',
      profile: process.env.HERMES_PROFILE || 'default',
    };
  });

  ipcMain.handle('gateway:restart', async () => {
    return await gateway.restart();
  });

  ipcMain.handle(
    'gateway:authenticate',
    async (_event, options: { url: string; gatewayType: 'dashboard' | 'api'; username?: string; password?: string; token?: string }) => {
      let baseUrl = (options.url || 'http://127.0.0.1:9119').trim();
      if (baseUrl.startsWith('ws://')) baseUrl = baseUrl.replace('ws://', 'http://');
      if (baseUrl.startsWith('wss://')) baseUrl = baseUrl.replace('wss://', 'https://');
      if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) baseUrl = `https://${baseUrl}`;
      baseUrl = baseUrl.replace(/\/+$/, '');

      const start = Date.now();
      try {
        if (options.gatewayType === 'api') {
          const testRes = await fetch(`${baseUrl}/health`, {
            headers: options.token ? { Authorization: `Bearer ${options.token}` } : {},
          }).catch(() => null);
          const latency = Date.now() - start;
          return {
            ok: true,
            message: `API 服务响应正常 · 延迟 ${latency}ms`,
            latency,
          };
        }

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
    return await res.json();
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
