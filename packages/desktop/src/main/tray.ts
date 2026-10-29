/**
 * Hermes Flux Desktop System Tray
 */

import { Tray, Menu, app, BrowserWindow, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

export class HermesFluxTray {
  private tray: Tray | null = null;

  constructor(private mainWindow: BrowserWindow) {}

  public init(): void {
    let icon: Electron.NativeImage;
    // Prefer the 512px PNG so Windows can downsample a clean glyph for both the
    // 16px tray and the 32px overflow area; the ICO stays as a fallback.
    const trayPngPath = path.join(__dirname, '../build/icon.png');
    const trayIconPath = path.join(__dirname, '../build/icon.ico');
    if (fs.existsSync(trayPngPath)) {
      icon = nativeImage.createFromPath(trayPngPath).resize({ width: 16, height: 16 });
    } else if (fs.existsSync(trayIconPath)) {
      icon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 });
    } else {
      icon = nativeImage.createFromBuffer(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2Nk+M/wn4EIwMjIwMDwn+E/AwN+RVjV4FNHMxhGDQAYMAhQp9jYw88/mQwMAERjFQYk1T3FAAAAAElFTkSuQmCC',
          'base64'
        )
      );
    }

    try {
      this.tray = new Tray(icon);
      this.tray.setToolTip('Hermes Flux Workspace');

      const contextMenu = Menu.buildFromTemplate([
        {
          label: '显示 Hermes Flux',
          click: () => {
            this.mainWindow.show();
            this.mainWindow.focus();
          },
        },
        { type: 'separator' },
        {
          label: '退出',
          click: () => {
            app.quit();
          },
        },
      ]);

      this.tray.setContextMenu(contextMenu);
      this.tray.on('double-click', () => {
        this.mainWindow.show();
        this.mainWindow.focus();
      });
    } catch (e) {
      console.warn('[Tray] System tray creation skipped or not supported:', e);
    }
  }

  public destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
