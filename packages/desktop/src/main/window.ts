/**
 * Hermes Flux Desktop Window Factory
 * Handles platform-specific window styling, Windows 11 Mica/Acrylic, and frameless titlebar.
 */

import { BrowserWindow, Menu, MenuItem, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { resolveTitlebarMaximized } from './windowControl';

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

  /**
   * 设计意图 (Why)：全屏与最大化在标题栏共用同一个"还原"图标，进入/退出全屏必须同步广播，
   *   否则全屏后图标停在"最大化"，点击行为与图标预期相反。
   * 防范的历史坑 (Pitfall)：历史只监听 maximize/unmaximize，全屏切换完全不广播，
   *   渲染层无从得知窗口已进入全屏。
   * 约束与规则 (Rules)：退出全屏必须回读 isMaximized() 真值 —— 从最大化态进全屏再退出时
   *   窗口会恢复最大化，硬编码 false 会让图标与实际窗口态反向。
   */
  win.on('enter-full-screen', () => {
    win.webContents.send('window:state-changed', {
      isMaximized: resolveTitlebarMaximized({ isFullScreen: true, isMaximized: win.isMaximized() }),
    });
  });

  win.on('leave-full-screen', () => {
    // 退出全屏后 isFullScreen 已为 false，此处必须回读窗口真实的 isMaximized()，
    // 从最大化态进全屏再退出会恢复最大化，硬编码 false 会让图标与实际窗口态反向。
    win.webContents.send('window:state-changed', {
      isMaximized: resolveTitlebarMaximized({ isFullScreen: false, isMaximized: win.isMaximized() }),
    });
  });

  // Native desktop context menu: enable standard Copy/Cut/Paste/SelectAll across the app
  win.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu();

    if (params.selectionText && params.selectionText.trim().length > 0) {
      menu.append(new MenuItem({ label: '复制 (Copy)', role: 'copy' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: '全选 (Select All)', role: 'selectAll' }));
      menu.popup({ window: win });
    } else if (params.isEditable) {
      menu.append(new MenuItem({ label: '剪切 (Cut)', role: 'cut' }));
      menu.append(new MenuItem({ label: '复制 (Copy)', role: 'copy' }));
      menu.append(new MenuItem({ label: '粘贴 (Paste)', role: 'paste' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: '全选 (Select All)', role: 'selectAll' }));
      menu.popup({ window: win });
    }
  });

  return win;
}
