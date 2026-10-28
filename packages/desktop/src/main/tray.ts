/**
 * Hermes Aura Desktop System Tray
 */

import { Tray, Menu, app, BrowserWindow, nativeImage } from 'electron';

export class HermesAuraTray {
  private tray: Tray | null = null;

  constructor(private mainWindow: BrowserWindow) {}

  public init(): void {
    // 16x16 transparent dot or simple icon for tray
    const icon = nativeImage.createFromBuffer(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2Nk+M/wn4EIwMjIwMDwn+E/AwN+RVjV4FNHMxhGDQAYMAhQp9jYw88/mQwMAERjFQYk1T3FAAAAAElFTkSuQmCC',
        'base64'
      )
    );

    try {
      this.tray = new Tray(icon);
      this.tray.setToolTip('Hermes Aura Workspace');

      const contextMenu = Menu.buildFromTemplate([
        {
          label: '显示 Hermes Aura',
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
