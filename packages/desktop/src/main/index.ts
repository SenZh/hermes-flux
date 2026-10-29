/**
 * Hermes Aura Desktop Main Process
 */

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { createMainWindow } from './window';
import { registerIpcHandlers } from './ipc';
import { HermesAuraTray } from './tray';

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
let mainWindow: BrowserWindow | null = null;
let trayManager: HermesAuraTray | null = null;

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Create main window
    mainWindow = createMainWindow();

    // Register IPC channels
    registerIpcHandlers(mainWindow);

    // Initialize tray
    trayManager = new HermesAuraTray(mainWindow);
    trayManager.init();

    // Load renderer bundle
    const indexPath = path.join(__dirname, '../renderer/index.html');
    mainWindow.loadFile(indexPath);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
        registerIpcHandlers(mainWindow);
        mainWindow.loadFile(indexPath);
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
