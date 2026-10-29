/**
 * Hermes Flux Desktop Main Process
 */

import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createMainWindow } from './window';
import { registerIpcHandlers } from './ipc';
import { HermesFluxTray } from './tray';

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
    const legacyDir = path.join(appDataRoot, 'Hermes Aura');

    if (currentDir === legacyDir) return;
    if (fs.existsSync(currentDir)) return;
    if (!fs.existsSync(legacyDir)) return;

    // Skip regenerable caches so the first launch after the rename stays fast.
    const skipped = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'logs']);
    fs.cpSync(legacyDir, currentDir, {
      recursive: true,
      filter: (source) => !skipped.has(path.basename(source)),
    });
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
