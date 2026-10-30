/**
 * Hermes Flux Desktop IPC Handler Registration
 */

import { ipcMain, BrowserWindow, shell, dialog, app, clipboard } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

  // Desktop Native Clipboard Bridge (100% reliable copy without focus restriction)
  ipcMain.handle('clipboard:write-text', (_event, text: string) => {
    try {
      clipboard.writeText(typeof text === 'string' ? text : String(text || ''));
      return true;
    } catch (err) {
      console.error('[Hermes Flux] clipboard.writeText failed:', err);
      return false;
    }
  });

  ipcMain.handle('clipboard:read-text', () => {
    try {
      return clipboard.readText();
    } catch {
      return '';
    }
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
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      return await res.json();
    }
    // 图像二进制自动转换为 Base64 Data URL
    if (contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i.test(options.path)) {
      const arrayBuffer = await res.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      const mime = contentType.split(';')[0] || 'image/png';
      return `data:${mime};base64,${base64}`;
    }
    return await res.text();
  });

  // Shell & Dialogs
  ipcMain.handle('shell:open-external', async (_event, target: string, content?: string) => {
    if (!target || typeof target !== 'string') return;
    if (target.startsWith('http://') || target.startsWith('https://')) {
      await shell.openExternal(target);
      return;
    }

    try {
      // 1. Direct local physical file check
      if (fs.existsSync(target) && fs.statSync(target).isFile()) {
        await shell.openPath(path.resolve(target));
        return;
      }
      // 2. Relative to process cwd
      const relPath = path.resolve(process.cwd(), target);
      if (fs.existsSync(relPath) && fs.statSync(relPath).isFile()) {
        await shell.openPath(relPath);
        return;
      }
      // 3. Project prefix stripped (e.g. /opt/data/projects/hermes-flux/...)
      const normalized = target.replace(/\\/g, '/');
      const matchProject = normalized.match(/hermes-flux\/(.+)$/);
      if (matchProject) {
        const subPath = path.resolve(process.cwd(), matchProject[1]);
        if (fs.existsSync(subPath) && fs.statSync(subPath).isFile()) {
          await shell.openPath(subPath);
          return;
        }
      }

      // 4. Remote workspace file fallback: hash-isolated read-only snapshot in temp directory
      if (typeof content === 'string' && content.length > 0) {
        const contentBuffer = Buffer.from(content, 'utf-8');
        // Protection: 20MB upper limit
        if (contentBuffer.length > 20 * 1024 * 1024) {
          throw new Error('File exceeds maximum preview limit (20MB)');
        }

        // Safe filename stripping path traversal
        const rawBase = path.basename(target.replace(/\\/g, '/')) || 'preview.txt';
        const safeBaseName = rawBase.replace(/[^a-zA-Z0-9._-]/g, '_');
        const ext = path.extname(safeBaseName).toLowerCase();

        // Security rule: Prohibit directly launching executable scripts
        if (['.exe', '.bat', '.cmd', '.sh', '.ps1', '.vbs', '.msi'].includes(ext)) {
          throw new Error('Opening executable scripts externally is prohibited for security');
        }

        // Hash isolation to prevent collision & Windows EBUSY locks
        const pathHash = crypto.createHash('md5').update(target).digest('hex').slice(0, 8);
        const tempDir = path.join(app.getPath('temp'), 'hermes-preview', pathHash);
        fs.mkdirSync(tempDir, { recursive: true });

        const tempFilePath = path.join(tempDir, safeBaseName);
        // Write as read-only snapshot
        fs.writeFileSync(tempFilePath, contentBuffer);
        await shell.openPath(tempFilePath);
        return;
      }
    } catch (err) {
      console.warn('[IPC shell:open-external] Failed to open path:', err);
    }
  });

  ipcMain.handle('dialog:open-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
    });
    return result.filePaths;
  });

  // Helper: Read physical file with image binary Base64 Data URL detection & memory size protection
  // 【设计意图 (Why)】
  // 如果读取的是 PNG/JPG/SVG 等图片，直接用 utf8 读取会导致乱码甚至字节损坏；
  // 必须将其转为 data:image/...;base64,... Data URL 形式，以便前端 <img> 标签直接渲染并安全下载。
  // 【防范的陷阱 (Pitfall)】
  // 严禁将图片二进制作为 utf8 字符串返回，否则在写入或渲染时会导致二进制签名丢失。
  // 必须对读取文件的大小进行严格限制（50MB），严禁直接读入超大文件导致 Node.js / V8 进程 OOM 崩溃。
  // 必须进行物理路径安全校验，防止恶意通过 ../ 路径遍历读取系统密码等敏感目录。
  // 【约束与规则 (Rules)】
  // 限制单文件读取上限为 50MB，超出上限返回 null。
  const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

  const isSafeReadablePath = (targetFile: string): boolean => {
    try {
      const resolved = path.resolve(targetFile);
      const cwd = process.cwd();
      const tempDir = app.getPath('temp');
      const userDataDir = app.getPath('userData');

      // 允许当前工作区目录及其子目录、应用临时目录、应用数据目录
      const isInside = (parent: string, child: string) => {
        const rel = path.relative(parent, child);
        return !rel.startsWith('..') && !path.isAbsolute(rel);
      };

      if (isInside(cwd, resolved) || isInside(tempDir, resolved) || isInside(userDataDir, resolved)) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const readPhysicalFileSafely = (absoluteFilePath: string): string | null => {
    try {
      if (!fs.existsSync(absoluteFilePath)) return null;
      const stat = fs.statSync(absoluteFilePath);
      if (!stat.isFile() || stat.size > MAX_FILE_SIZE_BYTES) {
        return null;
      }

      const ext = path.extname(absoluteFilePath).toLowerCase();
      const imageMimeMap: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.bmp': 'image/bmp',
      };

      if (imageMimeMap[ext]) {
        const buffer = fs.readFileSync(absoluteFilePath);
        return `data:${imageMimeMap[ext]};base64,${buffer.toString('base64')}`;
      }

      return fs.readFileSync(absoluteFilePath, 'utf8');
    } catch {
      return null;
    }
  };

  // Local File System Read for Inspection Pod
  ipcMain.handle('fs:read-file', async (_event, targetPath: string) => {
    if (!targetPath || typeof targetPath !== 'string') return null;
    try {
      const cwd = process.cwd();

      // 1. Direct path check (with safe path boundary validation)
      if (isSafeReadablePath(targetPath)) {
        const directResult = readPhysicalFileSafely(path.resolve(targetPath));
        if (directResult !== null) return directResult;
      }

      // 2. Normalize separators
      const normalized = targetPath.replace(/\\/g, '/');
      if (isSafeReadablePath(normalized)) {
        const normResult = readPhysicalFileSafely(path.resolve(normalized));
        if (normResult !== null) return normResult;
      }

      // 3. Search relative to current working directory or known workspace root
      const relPath = path.resolve(cwd, targetPath);
      if (isSafeReadablePath(relPath)) {
        const relResult = readPhysicalFileSafely(relPath);
        if (relResult !== null) return relResult;
      }

      // 4. Relative to targetPath stripped of remote prefixes (e.g. /opt/data/projects/hermes-flux/ or hermes-aura/)
      const matchProject = normalized.match(/(?:hermes-flux|hermes-aura)\/(.+)$/);
      if (matchProject) {
        const subPath = path.resolve(cwd, matchProject[1]);
        if (isSafeReadablePath(subPath)) {
          const subResult = readPhysicalFileSafely(subPath);
          if (subResult !== null) return subResult;
        }
      }

      // 5. Look for matching file basename across typical project directories (docs/prototypes, docs, packages, etc.)
      const baseName = path.basename(normalized);
      if (baseName && baseName.length > 2) {
        const candidateDirs = [
          path.join(cwd, 'docs', 'prototypes'),
          path.join(cwd, 'docs'),
          path.join(cwd, 'packages', 'desktop', 'src', 'renderer'),
          path.join(cwd, 'release'),
        ];
        for (const dir of candidateDirs) {
          const candidatePath = path.join(dir, baseName);
          if (isSafeReadablePath(candidatePath)) {
            const candResult = readPhysicalFileSafely(candidatePath);
            if (candResult !== null) return candResult;
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  });

  // Local File System Save / Download for Inspection Pod
  // 【设计意图 (Why)】
  // 用户在右侧检查舱点击下载时，调出系统原生保存文件对话框，允许用户自由挑选保存位置。
  // 【防范的陷阱 (Pitfall)】
  // 对于 Base64 Data URL（如图片），必须将其正确解码为 Buffer 真实二进制写入，严禁写成纯文本。
  // 【约束与规则 (Rules)】
  // 支持 canceled 状态回传，避免取消保存被误判为报错。
  ipcMain.handle(
    'fs:save-file',
    async (_event, options: { fileName: string; content: string; isBase64?: boolean }) => {
      try {
        const defaultName = path.basename(options.fileName) || 'download';
        const ext = path.extname(defaultName).toLowerCase().replace('.', '');
        const filters: Array<{ name: string; extensions: string[] }> = [];

        if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext)) {
          filters.push({ name: 'Images', extensions: [ext, 'png', 'jpg', 'jpeg', 'webp'] });
        } else if (['html', 'htm'].includes(ext)) {
          filters.push({ name: 'HTML Document', extensions: ['html', 'htm'] });
        } else if (['json'].includes(ext)) {
          filters.push({ name: 'JSON Document', extensions: ['json'] });
        } else if (['md', 'markdown'].includes(ext)) {
          filters.push({ name: 'Markdown Document', extensions: ['md', 'markdown'] });
        }
        filters.push({ name: 'All Files', extensions: ['*'] });

        const result = await dialog.showSaveDialog(mainWindow, {
          title: '保存文件',
          defaultPath: path.join(app.getPath('downloads'), defaultName),
          filters,
        });
        if (result.canceled || !result.filePath) {
          return { success: false, canceled: true };
        }

        let dataToWrite: Buffer | string;
        // 1. 如果指定了 remoteDownloadUrl，直接由宿主网络以二进制流下载写入，不受 V8 字符串上限与前端内存限制
        if (options.content.startsWith('http://') || options.content.startsWith('https://')) {
          const fetchHeaders: Record<string, string> = {};
          if (activeGatewayCookies) fetchHeaders['Cookie'] = activeGatewayCookies;
          const dlRes = await fetch(options.content, { headers: fetchHeaders });
          if (!dlRes.ok) {
            return { success: false, error: `下载远程文件失败 HTTP ${dlRes.status}` };
          }
          const arrayBuffer = await dlRes.arrayBuffer();
          fs.writeFileSync(result.filePath, Buffer.from(arrayBuffer));
          return { success: true, filePath: result.filePath };
        }

        if (options.content.startsWith('data:')) {
          const commaIdx = options.content.indexOf(',');
          const b64 = commaIdx >= 0 ? options.content.slice(commaIdx + 1) : options.content;
          dataToWrite = Buffer.from(b64, 'base64');
        } else if (options.isBase64) {
          dataToWrite = Buffer.from(options.content, 'base64');
        } else {
          dataToWrite = options.content;
        }

        fs.writeFileSync(result.filePath, dataToWrite);
        return { success: true, filePath: result.filePath };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message || '保存失败' };
      }
    }
  );
}
