/**
 * Hermes Flux Desktop Main Process
 */

import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '@hermes-flux/core';
import { createMainWindow } from './window';
import { registerIpcHandlers } from './ipc';
import { HermesFluxTray } from './tray';
import { initFileLogging } from './logFile';

const appLog = createLogger('main');

/**
 * One-time migration of the legacy "Hermes Aura" profile directory.
 * productName changed (Hermes Aura -> Hermes Flux), which relocates Electron's
 * userData folder; copy the old profile over so gateway credentials, theme,
 * language and rail widths survive the rename.
 */
function migrateLegacyUserData(): void {
  try {
    const appDataRoot = app.getPath('appData');
    const currentDir = app.getPath('userData');

    // Candidate legacy directories in priority order:
    const candidates = [
      path.join(appDataRoot, '@hermes-flux', 'desktop'),
      path.join(appDataRoot, '@hermes-aura', 'desktop'),
      path.join(appDataRoot, 'Hermes Aura'),
      path.join(appDataRoot, 'Hermes'),
    ];

    // Helper: determine if a directory contains real Local Storage data
    const hasValidLevelDb = (dir: string): boolean => {
      const ldbPath = path.join(dir, 'Local Storage', 'leveldb');
      if (!fs.existsSync(ldbPath)) return false;
      try {
        const files = fs.readdirSync(ldbPath);
        return files.some(
          (f) =>
            (f.endsWith('.ldb') || f.endsWith('.log')) &&
            fs.statSync(path.join(ldbPath, f)).size > 100
        );
      // gate-degrade: 探测旧配置目录是否可用，读不到即视为不可迁移，属于探测型调用
      } catch {
        return false;
      }
    };

    if (hasValidLevelDb(currentDir)) return;

    for (const legacyDir of candidates) {
      if (currentDir === legacyDir) continue;
      if (!fs.existsSync(legacyDir)) continue;
      if (hasValidLevelDb(legacyDir)) {
        console.log(`[Hermes Flux] Migrating profile from ${legacyDir} -> ${currentDir}`);
        const skipped = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'logs']);
        fs.cpSync(legacyDir, currentDir, {
          recursive: true,
          filter: (source) => !skipped.has(path.basename(source)),
        });
        break;
      }
    }
  } catch (error) {
    // Migration is best-effort: a fresh profile is still a valid state.
    console.error('[Hermes Flux] Legacy profile migration failed:', error);
  }
}

migrateLegacyUserData();

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
let mainWindow: BrowserWindow | null = null;
let trayManager: HermesFluxTray | null = null;

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  /**
   * Renderer diagnostics level. An unpackaged run (npm start / dev build) opens
   * the window with `?log=debug` so streaming and paging timings are visible
   * without touching storage; FUS_LOG_LEVEL overrides it either way.
   */
  const rendererLogLevel = process.env.FUS_LOG_LEVEL || (app.isPackaged ? '' : 'debug');
  const loadRenderer = (win: BrowserWindow): void => {
    const indexPath = path.join(__dirname, '../renderer/index.html');
    void (rendererLogLevel
      ? win.loadFile(indexPath, { query: { log: rendererLogLevel } })
      : win.loadFile(indexPath));
  };

  // Enable Remote Debugging Port for CDP testing & automation
  app.commandLine.appendSwitch('remote-debugging-port', '9222');

  /**
   * 文件日志必须在创建窗口之前初始化：
   * 主进程启动早期的窗口创建失败、迁移异常与单实例冲突都需要留下证据。
   */
  let fileLogHandle: ReturnType<typeof initFileLogging> | null = null;
  try {
    fileLogHandle = initFileLogging(app.getPath('userData'));
    appLog.info('desktop boot', {
      appVersion: app.getVersion(),
      packaged: app.isPackaged,
      platform: process.platform,
      logDir: fileLogHandle.logDir,
    });
  } catch (err) {
    appLog.error('file logging init failed', err);
  }

  // 主进程未捕获异常同样必须落盘，否则崩溃后只剩一个空白窗口
  process.on('uncaughtException', (err) => {
    appLog.error('uncaughtException', err);
  });
  process.on('unhandledRejection', (reason) => {
    appLog.error('unhandledRejection', reason);
  });

  app.on('before-quit', () => {
    void fileLogHandle?.flush();
  });

  app.whenReady().then(() => {
    // Create main window
    const win = createMainWindow();
    mainWindow = win;

    // Register IPC channels
    registerIpcHandlers(win);

    // Initialize tray
    trayManager = new HermesFluxTray(win);
    trayManager.init();

    // Load renderer bundle
    loadRenderer(win);

    appLog.info('main window ready', { rendererLogLevel: rendererLogLevel || 'info' });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const next = createMainWindow();
        mainWindow = next;
        registerIpcHandlers(next);
        loadRenderer(next);
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      if (trayManager) trayManager.destroy();
      app.quit();
    }
  });
}
