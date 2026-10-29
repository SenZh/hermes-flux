/**
 * Hermes Aura Desktop Window Factory
 * Handles platform-specific window styling, Windows 11 Mica/Acrylic, and frameless titlebar.
 */

import { BrowserWindow, app } from 'electron';
import path from 'node:path';

export function createMainWindow(): BrowserWindow {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#090A0F',
    show: false,
    autoHideMenuBar: true,
    // Multi-platform frame configuration:
    frame: !isWin && !isMac ? true : false,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    vibrancy: isMac ? 'under-window' : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      spellcheck: false,
    },
  });

  // Disable setBackgroundMaterial('mica'/'acrylic') on Windows:
  // In Windows 11 frameless mode, Mica material alters the DWM maximization bounds,
  // preventing Electron from pushing WS_THICKFRAME resize borders outside the screen,
  // causing a 2px semi-transparent desktop background leak at the top/right edges.
  // Using pure opaque canvas background eliminates border leaking completely.

  // Graceful show on ready-to-show to prevent visual flash
  win.once('ready-to-show', () => {
    win.show();
  });

  // Forward window state changes to renderer for caption button updates
  win.on('maximize', () => {
    win.webContents.send('window:state-changed', { isMaximized: true });
  });

  win.on('unmaximize', () => {
    win.webContents.send('window:state-changed', { isMaximized: false });
  });

  return win;
}
