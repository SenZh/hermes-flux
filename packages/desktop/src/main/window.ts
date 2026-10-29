/**
 * Hermes Flux Desktop Window Factory
 * Handles platform-specific window styling, Windows 11 Mica/Acrylic, and frameless titlebar.
 */

import { BrowserWindow, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export function createMainWindow(): BrowserWindow {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  const iconPath = path.join(__dirname, '../build/icon.ico');
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    icon: isWin && fs.existsSync(iconPath) ? iconPath : undefined,
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

  // DevTools entry that works on a frameless window: the default application
  // menu accelerator is easy to lose with `autoHideMenuBar` + `frame: false`.
  // Detached mode keeps the panel out of the layout, so inspecting a long
  // conversation cannot resize the stream and shift the viewport.
  win.webContents.on('before-input-event', (event, input) => {
    const withModifier = input.control || input.meta;
    const togglesDevTools =
      input.type === 'keyDown' &&
      ((withModifier && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12');
    if (!togglesDevTools) return;

    event.preventDefault();
    if (win.webContents.isDevToolsOpened()) {
      win.webContents.closeDevTools();
    } else {
      win.webContents.openDevTools({ mode: 'detach' });
    }
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
